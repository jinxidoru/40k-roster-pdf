#!/usr/bin/env node
// Build a printable quick-reference PDF from a New Recruit / BattleScribe roster
// export (newrecruit.eu / rosterSchema).
//
//   node scripts/build.js <roster.json> [--renderer id] [--set k=v] [--typ-only] [--no-open]
//
// Writes build/<name>.typ and, unless --typ-only, compiles it to
// build/<name>.pdf with `typst` (using the bundled font) and opens it.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { parseRoster, isNewRecruitRoster } from '../src/parse.js';
import { byId, defaultRenderer, renderers } from '../src/render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FONT_DIR = join(ROOT, 'assets', 'fonts');

const args = process.argv.slice(2);
const typOnly = args.includes('--typ-only');
const noOpen = args.includes('--no-open');

// --renderer <id> and repeated --set key=value.
const options = {};
let rendererId = defaultRenderer.id;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--renderer') rendererId = args[++i];
  else if (args[i] === '--set') {
    const [k, ...rest] = String(args[++i] || '').split('=');
    if (k) options[k] = rest.join('=');
  }
}
const input = args.find((a) => !a.startsWith('--') && a !== rendererId && !isOptionValue(a));

function isOptionValue(a) {
  const idx = args.indexOf(a);
  return idx > 0 && (args[idx - 1] === '--renderer' || args[idx - 1] === '--set');
}

if (!input) {
  console.error('Usage: node scripts/build.js <roster.json> [--renderer id] [--set k=v] [--typ-only] [--no-open]');
  console.error(`Renderers: ${renderers.map((r) => r.id).join(', ')}`);
  process.exit(1);
}

const renderer = byId[rendererId];
if (!renderer) {
  console.error(`Unknown renderer "${rendererId}". Available: ${renderers.map((r) => r.id).join(', ')}`);
  process.exit(1);
}

const raw = JSON.parse(readFileSync(input, 'utf8'));
if (!isNewRecruitRoster(raw)) {
  console.error(`${input} does not look like a New Recruit / BattleScribe roster export (no top-level "roster").`);
  process.exit(1);
}
const army = parseRoster(raw);

// Optional bundled core-keyword definitions (scripts/build-keywords.js). Absent
// (file removed) → glossary falls back to roster-embedded definitions only.
const kwPath = join(ROOT, 'src', 'keywords.json');
if (existsSync(kwPath)) {
  try { army.coreGlossary = JSON.parse(readFileSync(kwPath, 'utf8')).keywords || {}; }
  catch { /* ignore a malformed keywords file */ }
}

const outDir = join(ROOT, 'build');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const stem = basename(input).replace(/\.json$/i, '');
const typPath = join(outDir, `${stem}.typ`);
const pdfPath = join(outDir, `${stem}.pdf`);

writeFileSync(typPath, renderer.render(army, options), 'utf8');
console.log(`Wrote ${typPath}  (renderer: ${renderer.id})`);

console.log(`\n${army.meta.name} — ${army.meta.faction} · ${army.meta.detachment} · ${army.meta.points} pts`);
console.log(`${army.units.length} unit(s):`);
for (const u of army.units) {
  const weapons = [...u.ranged, ...u.melee].map((w) => w.name).join(', ') || '(none)';
  const mult = u.count > 1 ? ` ×${u.count}` : '';
  const models = u.models > 1 ? ` [${u.models} models]` : '';
  const enh = u.enhancement ? `, +${u.enhancement.name}` : '';
  console.log(`  ✓ ${u.name}${mult}${models}${enh}`);
  console.log(`      weapons: ${weapons}`);
}
if (army.warnings.length) {
  console.log(`\n⚠ ${army.warnings.length} note(s):`);
  for (const w of army.warnings) console.log(`  - ${w}`);
}

if (typOnly) process.exit(0);

// --ignore-system-fonts so the CLI uses only the bundled Arimo + Typst's
// embedded fonts — matching the browser (typst.ts) exactly, so output and glyph
// coverage (weapon icons, etc.) are identical in both.
const res = spawnSync(
  'typst',
  ['compile', '--font-path', FONT_DIR, '--ignore-system-fonts', typPath, pdfPath],
  { stdio: 'inherit' },
);
if (res.error) {
  console.error(`\nCould not run "typst" (${res.error.code}). Install it (brew install typst) or re-run with --typ-only.`);
  process.exit(1);
}
if (res.status !== 0) process.exit(res.status);
console.log(`\nWrote ${pdfPath}`);

if (!noOpen) openFile(pdfPath);

function openFile(path) {
  const cmd =
    process.platform === 'darwin' ? 'open' :
    process.platform === 'win32' ? 'cmd' :
    'xdg-open';
  const cmdArgs = process.platform === 'win32' ? ['/c', 'start', '', path] : [path];
  try {
    spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // Opening is a convenience; ignore failures (e.g. headless environments).
  }
}

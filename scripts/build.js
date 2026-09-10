#!/usr/bin/env node
// Build a printable quick-reference PDF from a New Recruit / BattleScribe
// roster export (newrecruit.eu / rosterSchema).
//
//   node scripts/build.js Fishies.json [--typ-only] [--no-open]
//
// Writes build/<name>.typ and, unless --typ-only, compiles it to
// build/<name>.pdf with `typst` and opens it.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { parseNewRecruit } from '../src/newrecruit.js';
import { renderTypst } from '../src/typst.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const typOnly = args.includes('--typ-only');
const noOpen = args.includes('--no-open');
const input = args.find((a) => !a.startsWith('--'));

if (!input) {
  console.error('Usage: node scripts/build.js <newrecruit-export.json> [--typ-only] [--no-open]');
  process.exit(1);
}

const army = parseNewRecruit(input);

const outDir = join(ROOT, 'build');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const stem = basename(input).replace(/\.json$/i, '');
const typPath = join(outDir, `${stem}.typ`);
const pdfPath = join(outDir, `${stem}.pdf`);

writeFileSync(typPath, renderTypst(army), 'utf8');
console.log(`Wrote ${typPath}`);

// Report what was read from the roster.
console.log(`\n${army.meta.name} — ${army.meta.faction} · ${army.meta.detachment} · ${army.meta.points} pts`);
console.log(`${army.units.length} unit(s):`);
for (const u of army.units) {
  const weapons = [...u.ranged, ...u.melee].map((w) => w.name).join(', ') || '(none)';
  const enh = u.enhancement ? `, +${u.enhancement.name}` : '';
  console.log(`  ✓ ${u.name}${u.models > 1 ? ` (x${u.models})` : ''}${enh}`);
  console.log(`      weapons: ${weapons}`);
}
if (army.warnings.length) {
  console.log(`\n⚠ ${army.warnings.length} note(s):`);
  for (const w of army.warnings) console.log(`  - ${w}`);
}

if (typOnly) process.exit(0);

const res = spawnSync('typst', ['compile', typPath, pdfPath], { stdio: 'inherit' });
if (res.error) {
  console.error(`\nCould not run "typst" (${res.error.code}). Install it (brew install typst) or re-run with --typ-only.`);
  process.exit(1);
}
if (res.status !== 0) process.exit(res.status);
console.log(`\nWrote ${pdfPath}`);

if (!noOpen) openFile(pdfPath);

// Open a file with the OS default application.
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

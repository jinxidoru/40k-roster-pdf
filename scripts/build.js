#!/usr/bin/env node
// CLI: build a printable quick-reference PDF from an army JSON.
//
//   node scripts/build.js armies/imperial-fists.json [--typ-only]
//
// Writes build/<army>.typ and, unless --typ-only, compiles it to
// build/<army>.pdf with `typst`.

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadArmy } from '../src/army.js';
import { isNewRecruitRoster, parseNewRecruit } from '../src/newrecruit.js';
import { renderTypst } from '../src/typst.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const typOnly = args.includes('--typ-only');
const input = args.find((a) => !a.startsWith('--'));

if (!input) {
  console.error('Usage: node scripts/build.js <army.json|newrecruit-export.json> [--typ-only]');
  process.exit(1);
}

// A New Recruit / BattleScribe roster export has a top-level `roster`; a native
// army definition has `units`. Dispatch on which one this is.
const raw = JSON.parse(readFileSync(input, 'utf8'));
const isRoster = isNewRecruitRoster(raw);
const army = isRoster ? parseNewRecruit(input) : loadArmy(input);
console.log(`Source: ${isRoster ? 'New Recruit roster export' : 'native army JSON'}`);

const outDir = join(ROOT, 'build');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const stem = basename(input).replace(/\.json$/i, '');
const typPath = join(outDir, `${stem}.typ`);
const pdfPath = join(outDir, `${stem}.pdf`);

writeFileSync(typPath, renderTypst(army), 'utf8');
console.log(`Wrote ${typPath}`);

// Report resolution results.
console.log(`\nResolved ${army.units.length} unit(s):`);
for (const u of army.units) {
  const weapons = [...u.ranged, ...u.melee].map((w) => w.name).join(', ') || '(none)';
  const enh = u.enhancement ? `, +${u.enhancement.name}` : '';
  console.log(`  ✓ ${u.name}${u.models > 1 ? ` (x${u.models})` : ''}${enh}`);
  console.log(`      weapons: ${weapons}`);
}
if (army.enhancementPool && army.enhancementPool.length) {
  console.log(`\nEnhancements available in "${army.meta.detachment}" (assign with "enhancement": "<name>" on a unit):`);
  for (const e of army.enhancementPool) {
    const used = army.enhancements.some((u) => u.name === e.name) ? ' [selected]' : '';
    console.log(`  • ${e.name} (${e.points} pts)${used}`);
  }
}
if (army.warnings.length) {
  console.log(`\n⚠ ${army.warnings.length} warning(s):`);
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

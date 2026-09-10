#!/usr/bin/env node
// CLI: build a printable quick-reference PDF from an army JSON.
//
//   node scripts/build.js armies/imperial-fists.json [--typ-only]
//
// Writes build/<army>.typ and, unless --typ-only, compiles it to
// build/<army>.pdf with `typst`.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadArmy } from '../src/army.js';
import { renderTypst } from '../src/typst.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const typOnly = args.includes('--typ-only');
const input = args.find((a) => !a.startsWith('--'));

if (!input) {
  console.error('Usage: node scripts/build.js <army.json> [--typ-only]');
  process.exit(1);
}

const army = loadArmy(input);

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
  const w = u.ranged.length + u.melee.length;
  console.log(`  ✓ ${u.name}${u.models > 1 ? ` (x${u.models})` : ''} — ${w} weapon(s), ${u.abilities.length} ability(ies)${u.enhancement ? `, +${u.enhancement.name}` : ''}`);
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

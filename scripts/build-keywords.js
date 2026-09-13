#!/usr/bin/env node
// Regenerate src/keywords.json — a name -> definition map of the core 10e/11e
// weapon/ability keywords (Lethal Hits, Sustained Hits, …). These are NOT in
// New Recruit roster exports, so the glossary can't define them from a roster
// alone; this fills that gap.
//
//   node scripts/build-keywords.js [path-to-catalogue.json]
//
// With no argument it fetches the BSData community catalogue. The 940 KB source
// is never committed — only the small extracted map in src/keywords.json is.
//
// NOTE: src/keywords.json is the ONLY file that carries the rules TEXT. If it
// must be removed (e.g. a rights holder objects), delete that one file — the app
// degrades gracefully to roster-embedded definitions only. This script and the
// app code contain no rules text.

import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'src', 'keywords.json');
const SOURCE_URL =
  'https://raw.githubusercontent.com/BSData/wh40k-11e/main/Warhammer%2040%2C000.json';

// Same base-name reduction the renderer uses, so we can drop value-variants
// ("Scouts 9\"", "Feel No Pain 5+") and keep one entry per keyword.
function kwBase(s) {
  return String(s || '')
    .replace(/ /g, ' ')
    .toLowerCase()
    .split(':')[0]
    .replace(/\s+(d?\d+\+?|\d\+)$/, '')
    .split('-')[0]
    .trim();
}

async function loadCatalogue(arg) {
  if (arg) return JSON.parse(readFileSync(arg, 'utf8'));
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`fetch ${SOURCE_URL} -> HTTP ${res.status}`);
  return res.json();
}

const catalogue = await loadCatalogue(process.argv[2]);
const rules = catalogue?.gameSystem?.sharedRules || [];
if (!rules.length) {
  console.error('No gameSystem.sharedRules found — is this the 40k game-system file?');
  process.exit(1);
}

// One entry per base keyword; prefer the shortest name (the plain base form).
const byBase = new Map();
for (const r of rules) {
  if (!r || typeof r.name !== 'string' || typeof r.description !== 'string' || !r.description.trim()) continue;
  const b = kwBase(r.name);
  if (!b) continue;
  const cur = byBase.get(b);
  if (!cur || r.name.length < cur.name.length) byBase.set(b, { name: r.name, description: r.description });
}

const keywords = {};
for (const { name, description } of [...byBase.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  keywords[name] = description;
}

const out = {
  _meta: {
    source: SOURCE_URL,
    note: 'Core keyword rules text, extracted by scripts/build-keywords.js. Game data © Games Workshop. Delete this file to remove all bundled rules text; the app falls back to roster-embedded definitions.',
    keywordCount: Object.keys(keywords).length,
  },
  keywords,
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`Wrote ${OUT} — ${out._meta.keywordCount} keywords`);

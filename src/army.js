// Load an army definition, match its units against the catalogue, and
// resolve datasheets, enhancements, and detachment/army rules.

import { readFileSync } from 'node:fs';
import { loadCatalogues, walk } from './catalogue.js';
import { resolveDatasheet } from './resolve.js';

// Faction name -> catalogue file(s). The army JSON may override with an
// explicit `catalogues` array; this is just the convenience default.
const FACTION_CATALOGUES = {
  'imperial fists': ['Imperium - Imperial Fists'],
  'ultramarines': ['Imperium - Ultramarines'],
  'blood angels': ['Imperium - Blood Angels'],
  'dark angels': ['Imperium - Dark Angels'],
  'space wolves': ['Imperium - Space Wolves'],
  'black templars': ['Imperium - Black Templars'],
  'salamanders': ['Imperium - Salamanders'],
  'iron hands': ['Imperium - Iron Hands'],
  'raven guard': ['Imperium - Raven Guard'],
  'white scars': ['Imperium - White Scars'],
  'space marines': ['Imperium - Space Marines'],
  'deathwatch': ['Imperium - Deathwatch'],
  'grey knights': ['Imperium - Grey Knights'],
};

function cataloguesForArmy(army) {
  if (Array.isArray(army.catalogues) && army.catalogues.length) return army.catalogues;
  const key = (army.faction || '').toLowerCase().trim();
  if (FACTION_CATALOGUES[key]) return FACTION_CATALOGUES[key];
  throw new Error(
    `Cannot determine catalogue for faction "${army.faction}". ` +
    `Add a "catalogues" array to the army JSON (e.g. ["Imperium - Space Marines"]).`,
  );
}

// Levenshtein for "did you mean" suggestions on a missed unit name.
function distance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return dp[a.length][b.length];
}

function suggest(name, unitsByName) {
  const lc = name.toLowerCase();
  return [...unitsByName.keys()]
    .map((k) => [k, distance(lc, k)])
    .sort((x, y) => x[1] - y[1])
    .slice(0, 5)
    .map(([k]) => unitsByName.get(k)[0].name);
}

// Resolve enhancements for a detachment. Enhancement groups are named
// "<Detachment> Enhancements"; their child selectionEntries are the
// enhancements, each with an Abilities profile and a pts cost.
function resolveEnhancements(catalogues, wantName) {
  const groupName = `${wantName} Enhancements`.toLowerCase();
  const out = [];
  for (const cat of catalogues) {
    for (const node of walk(cat)) {
      if ((node.name || '').toLowerCase() !== groupName) continue;
      for (const se of node.selectionEntries || []) {
        const ability = (se.profiles || []).find((p) => p.typeName === 'Abilities');
        const text = ability
          ? (ability.characteristics?.find((c) => c.name === 'Description')?.$text || '')
          : '';
        const pts = (se.costs || []).find((c) => c.name === 'pts');
        out.push({ name: se.name, points: pts ? Number(pts.value) : null, text });
      }
    }
  }
  return out;
}

export function loadArmy(path) {
  const army = JSON.parse(readFileSync(path, 'utf8'));
  const catalogueNames = cataloguesForArmy(army);
  const { catalogues, byId, unitsByName, warnings } = loadCatalogues(catalogueNames);

  const units = [];
  const enhancementPool = army.detachment
    ? resolveEnhancements(catalogues, army.detachment)
    : [];
  const enhByName = new Map(enhancementPool.map((e) => [e.name.toLowerCase(), e]));
  const usedEnhancements = [];

  for (const req of army.units || []) {
    const name = req.sheet || req.name;
    const matches = unitsByName.get((name || '').toLowerCase()) || [];
    if (matches.length === 0) {
      warnings.push(`No datasheet matched "${name}". Did you mean: ${suggest(name, unitsByName).join(', ')}?`);
      continue;
    }
    let preferred = matches[0];
    if (matches.length > 1) {
      // Prefer a unit-type entry over a bare model when both share a name.
      preferred = matches.find((m) => m.type === 'unit') || matches[0];
      warnings.push(
        `"${name}" is ambiguous (${matches.length} entries); using the first ${preferred.type}. ` +
        `Rename in the army JSON to disambiguate if this is wrong.`,
      );
    }
    const ds = resolveDatasheet(preferred, byId);
    units.push(attachExtras(ds, req, enhByName, usedEnhancements));
  }

  return {
    meta: {
      name: army.name || 'Untitled Army',
      faction: army.faction || '',
      detachment: army.detachment || '',
      points: army.points ?? null,
    },
    units,
    enhancements: usedEnhancements,
    stratagems: army.stratagems || [],
    warnings,
  };
}

function attachExtras(ds, req, enhByName, usedEnhancements) {
  ds.models = req.models || 1;
  ds.attach = req.attach || [];
  ds.note = req.note || '';
  if (req.enhancement) {
    const e = enhByName.get(req.enhancement.toLowerCase());
    if (e) {
      ds.enhancement = e;
      if (!usedEnhancements.some((u) => u.name === e.name)) usedEnhancements.push(e);
    } else {
      ds.enhancementMissing = req.enhancement;
    }
  }
  return ds;
}

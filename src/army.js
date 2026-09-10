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

// Normalize a weapon name for loose matching: lowercase, drop the ➤ profile
// marker and punctuation, collapse whitespace ("Multi-melta" -> "multi melta").
function normalizeWeapon(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/➤/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Does a weapon profile name loosely match a loadout term? Full-name substring
// first, then a per-token fuzzy pass (edit distance ≤1) so "absolver" matches
// "Absolvor bolt pistol". Deliberately does NOT do token-substring matching,
// which would wrongly match "fragstorm" against "...Storm Bolter".
function weaponMatchesTerm(weaponName, term) {
  const w = normalizeWeapon(weaponName);
  const t = normalizeWeapon(term);
  if (!t) return false;
  if (w.includes(t)) return true;
  const wt = w.split(' ');
  return t.split(' ').every((tok) =>
    wt.some((x) => x === tok || (Math.min(tok.length, x.length) >= 4 && distance(tok, x) <= 1)),
  );
}

// Pick the weapons a single loadout term selects. If the term names a weapon
// exactly (normalized), only those exact weapons count — so "bolt pistol"
// selects "Bolt pistol" and not "Heavy Bolt Pistol". Otherwise fall back to the
// loose match.
function selectForTerm(weapons, term) {
  const nt = normalizeWeapon(term);
  const exact = weapons.filter((w) => normalizeWeapon(w.name) === nt);
  if (exact.length) return exact;
  return weapons.filter((w) => weaponMatchesTerm(w.name, term));
}

// Keep only the weapons named in a loadout; warn about terms that matched none.
function filterWeapons(ds, terms, warnings) {
  const all = [...ds.ranged, ...ds.melee];
  const keep = new Set();
  for (const t of terms) {
    const sel = selectForTerm(all, t);
    if (!sel.length) {
      warnings.push(`${ds.name}: loadout weapon "${t}" matched no profile on this datasheet.`);
    }
    for (const w of sel) keep.add(w);
  }
  ds.ranged = ds.ranged.filter((w) => keep.has(w));
  ds.melee = ds.melee.filter((w) => keep.has(w));
}

// Look up an enhancement by name: exact (case-insensitive) then closest match.
function findEnhancement(name, enhByName, pool) {
  const lc = name.toLowerCase();
  if (enhByName.has(lc)) return enhByName.get(lc);
  let best = null;
  let bestD = Infinity;
  for (const e of pool) {
    const d = distance(lc, e.name.toLowerCase());
    if (d < bestD) { bestD = d; best = e; }
  }
  if (best && bestD <= Math.max(3, Math.floor(best.name.length * 0.34))) return best;
  return null;
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
    units.push(attachExtras(ds, req, { enhByName, pool: enhancementPool, used: usedEnhancements, warnings }));
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
    enhancementPool,
    stratagems: army.stratagems || [],
    warnings,
  };
}

function attachExtras(ds, req, ctx) {
  ds.models = req.models || 1;
  ds.attach = req.attach || [];
  ds.note = req.note || '';
  if (Array.isArray(req.weapons) && req.weapons.length) {
    filterWeapons(ds, req.weapons, ctx.warnings);
  }
  if (req.enhancement) {
    const e = findEnhancement(req.enhancement, ctx.enhByName, ctx.pool);
    if (e) {
      ds.enhancement = e;
      if (!ctx.used.some((u) => u.name === e.name)) ctx.used.push(e);
    } else {
      ds.enhancementMissing = req.enhancement;
      const opts = ctx.pool.map((x) => x.name).join(', ') || '(none in this detachment)';
      ctx.warnings.push(`${ds.name}: enhancement "${req.enhancement}" not found. Available: ${opts}.`);
    }
  }
  return ds;
}

// Parse a New Recruit / BattleScribe *roster* export (rosterSchema) into the
// same army shape that army.js produces, so the existing Typst renderer can
// consume it unchanged.
//
// Unlike a catalogue, a roster is already resolved: every chosen unit embeds
// its Unit/weapon/ability profiles and its exact wargear. We therefore read
// datasheets straight out of the roster (no catalogue lookup needed), which
// gives the precise loadout the player picked and real per-unit points.

import { readFileSync } from 'node:fs';

// Selections that describe list configuration rather than a unit on the table.
const CONFIG_CATEGORIES = new Set(['Configuration']);

function charMap(profile) {
  const m = {};
  for (const c of profile.characteristics || []) m[c.name] = (c.$text ?? '').trim();
  return m;
}

function* subtree(sel) {
  yield sel;
  for (const c of sel.selections || []) yield* subtree(c);
}

function primaryCategory(sel) {
  const p = (sel.categories || []).find((c) => c.primary);
  return p ? p.name : '';
}

function isWeaponSelection(sel) {
  return (sel.categories || []).some(
    (c) => c.name === 'Ranged Weapon' || c.name === 'Melee Weapon',
  );
}

function isEnhancement(sel) {
  return (sel.categories || []).some((c) => /enhancement/i.test(c.name || ''));
}

function unitPoints(sel) {
  const pts = (sel.costs || []).find((c) => c.name === 'pts');
  return pts ? Number(pts.value) : null;
}

// Build one datasheet object (matching resolve.js output) from a unit selection.
function buildDatasheet(sel) {
  const stats = [];
  const ranged = [];
  const melee = [];
  const abilities = [];
  const seenStat = new Set();
  const seenWeapon = new Set();
  const seenAbility = new Set();
  let models = 0;
  let enhancement = null;

  for (const node of subtree(sel)) {
    if (node.type === 'model') models += node.number || 1;

    const weaponNode = isWeaponSelection(node);
    const enhancementNode = isEnhancement(node);

    if (enhancementNode) {
      const ability = (node.profiles || []).find((p) => p.typeName === 'Abilities');
      const text = ability ? (charMap(ability).Description || '') : '';
      enhancement = { name: node.name, points: unitPoints(node), text };
      continue; // don't fold the enhancement's ability into the unit's abilities
    }

    for (const p of node.profiles || []) {
      const tn = p.typeName;
      if (tn === 'Unit' || tn === 'Transport') {
        const chars = charMap(p);
        const sig = JSON.stringify(chars);
        if (seenStat.has(sig)) continue;
        seenStat.add(sig);
        stats.push({ name: p.name, chars, type: tn });
      } else if (tn === 'Ranged Weapons' || tn === 'Melee Weapons') {
        const chars = charMap(p);
        const key = p.name + '|' + JSON.stringify(chars);
        if (seenWeapon.has(key)) continue;
        seenWeapon.add(key);
        (tn === 'Ranged Weapons' ? ranged : melee).push({ name: p.name, chars });
      } else if (tn === 'Abilities' && !weaponNode) {
        if (seenAbility.has(p.name)) continue;
        seenAbility.add(p.name);
        abilities.push({ name: p.name, text: charMap(p).Description || '' });
      }
    }
  }

  const keywords = [];
  const factions = [];
  for (const c of sel.categories || []) {
    const n = c.name || '';
    if (n.startsWith('Faction:')) factions.push(n.replace('Faction:', '').trim());
    else if (n && n !== 'Unit') keywords.push(n);
  }

  const ds = {
    name: sel.name,
    entryType: sel.type,
    stats,
    ranged,
    melee,
    abilities,
    rules: [],
    keywords,
    factions,
    points: unitPoints(sel),
    models: models || sel.number || 1,
    attach: [],
    note: '',
  };
  if (enhancement) ds.enhancement = enhancement;
  return ds;
}

// The chosen detachment lives as the child of the "Detachment" config selection.
function findDetachment(forces) {
  for (const force of forces) {
    for (const sel of force.selections || []) {
      if (sel.name === 'Detachment' && (sel.selections || []).length) {
        return sel.selections[0].name;
      }
    }
  }
  return '';
}

// Army-wide rules (e.g. Oath of Moment), de-duplicated by name.
function collectForceRules(forces) {
  const seen = new Set();
  const rules = [];
  for (const force of forces) {
    for (const r of force.rules || []) {
      if (!r.name || seen.has(r.name)) continue;
      seen.add(r.name);
      rules.push({ name: r.name, text: r.description || '' });
    }
  }
  return rules;
}

function factionFromCatalogue(name) {
  // "Imperium - Adeptus Astartes - Imperial Fists" -> "Imperial Fists"
  const parts = String(name || '').split(' - ');
  return parts.length ? parts[parts.length - 1] : name || '';
}

export function isNewRecruitRoster(json) {
  return !!(json && json.roster && Array.isArray(json.roster.forces));
}

export function parseNewRecruit(path) {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  const roster = json.roster;
  const forces = roster.forces || [];
  const warnings = [];

  const units = [];
  const usedEnhancements = [];
  for (const force of forces) {
    for (const sel of force.selections || []) {
      if (CONFIG_CATEGORIES.has(primaryCategory(sel))) continue;
      if (sel.type !== 'model' && sel.type !== 'unit') continue;
      const ds = buildDatasheet(sel);
      if (ds.enhancement && !usedEnhancements.some((e) => e.name === ds.enhancement.name)) {
        usedEnhancements.push(ds.enhancement);
      }
      units.push(ds);
    }
  }

  // Attach army-wide rules to the first unit so the renderer's shared
  // rules section (which de-dupes across units) lists them once.
  const forceRules = collectForceRules(forces);
  if (units.length && forceRules.length) units[0].rules = forceRules;

  const totalCost = (roster.costs || []).find((c) => c.name === 'pts');
  const points = totalCost
    ? Number(totalCost.value)
    : units.reduce((sum, u) => sum + (u.points || 0), 0);

  const detachment = findDetachment(forces);
  if (detachment) {
    warnings.push(
      `Detachment "${detachment}" set. Detachment rules and stratagems are not ` +
      `included in New Recruit exports — add stratagems manually if you want them.`,
    );
  }

  return {
    meta: {
      name: roster.name || 'Untitled Army',
      faction: factionFromCatalogue(forces[0]?.catalogueName),
      detachment,
      points,
    },
    units,
    enhancements: usedEnhancements,
    enhancementPool: [],
    stratagems: [],
    warnings,
  };
}

// Parse a New Recruit / BattleScribe *roster* export (rosterSchema) into a
// clean army model the renderers consume. Pure JS (browser-safe): takes the
// already-parsed JSON object, does no I/O.
//
// A roster is already resolved: every chosen unit embeds its Unit/weapon/ability
// profiles and its exact wargear, so we read datasheets straight out of it — the
// precise loadout the player picked, with real per-unit points.

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

// Build one datasheet object from a unit selection.
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
        // "Leader" and "Support" only list which units this model can attach to
        // — reference for list-building, not needed during play.
        if (/^(leader|support)$/i.test(p.name)) continue;
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

// Army-wide and detachment rules, de-duplicated by name. Force-level rules
// (e.g. Oath of Moment) plus rules attached to the chosen Detachment selection
// (e.g. Wrath of Dorn) — but NOT weapon keyword USRs, which live on weapons.
function collectArmyRules(forces) {
  const seen = new Set();
  const rules = [];
  const add = (r) => {
    if (r && r.name && !seen.has(r.name)) {
      seen.add(r.name);
      rules.push({ name: r.name, text: r.description || '' });
    }
  };
  for (const force of forces) {
    for (const r of force.rules || []) add(r);
    for (const sel of force.selections || []) {
      if (primaryCategory(sel) === 'Configuration' && sel.name === 'Detachment') {
        for (const node of subtree(sel)) for (const r of node.rules || []) add(r);
      }
    }
  }
  return rules;
}

// A chosen Configuration option, e.g. Battle Size -> "Incursion".
function findConfigChoice(forces, name) {
  for (const force of forces) {
    for (const sel of force.selections || []) {
      if (sel.name === name && (sel.selections || []).length) {
        return sel.selections[0].name;
      }
    }
  }
  return '';
}

function factionFromCatalogue(name) {
  // "Imperium - Adeptus Astartes - Imperial Fists" -> "Imperial Fists"
  const parts = String(name || '').split(' - ');
  return parts.length ? parts[parts.length - 1] : name || '';
}

// Merge units that are identical in every respect (datasheet, model count,
// loadout, abilities, enhancement) into one entry carrying a `count`.
function coalesceUnits(units) {
  const out = [];
  const byKey = new Map();
  for (const u of units) {
    const key = JSON.stringify({
      name: u.name,
      models: u.models,
      ranged: u.ranged,
      melee: u.melee,
      stats: u.stats,
      abilities: u.abilities,
      enhancement: u.enhancement ? u.enhancement.name : null,
    });
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      u.count = 1;
      byKey.set(key, u);
      out.push(u);
    }
  }
  return out;
}

export function isNewRecruitRoster(json) {
  return !!(json && json.roster && Array.isArray(json.roster.forces));
}

// Parse an already-JSON-decoded roster export into the army model.
export function parseRoster(json) {
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

  // Collapse identical units (same datasheet + loadout) into one with a count.
  const coalesced = coalesceUnits(units);

  // Attach army-wide + detachment rules to the first unit so the renderer's
  // shared rules section (which de-dupes across units) lists them once.
  const armyRules = collectArmyRules(forces);
  if (coalesced.length && armyRules.length) coalesced[0].rules = armyRules;

  const totalCost = (roster.costs || []).find((c) => c.name === 'pts');
  const points = totalCost
    ? Number(totalCost.value)
    : units.reduce((sum, u) => sum + (u.points || 0), 0);

  const detachment = findDetachment(forces);
  const battleSize = findConfigChoice(forces, 'Battle Size').split(' (')[0];

  return {
    meta: {
      name: roster.name || 'Untitled Army',
      faction: factionFromCatalogue(forces[0]?.catalogueName),
      detachment,
      battleSize,
      points,
    },
    units: coalesced,
    enhancements: usedEnhancements,
    enhancementPool: [],
    stratagems: [],
    warnings,
  };
}

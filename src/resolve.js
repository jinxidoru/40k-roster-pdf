// Resolve a BSData unit/model entry into a datasheet's raw profile buckets.
//
// Structure of a unit in this dataset (verified against Space Marines):
//   unit entry
//     .profiles[]                 -> datasheet Abilities (e.g. "Hail of Bolts")
//     .selectionEntryGroups[]     -> groups holding the model entries
//         .selectionEntries[]     -> model entries (type: "model")
//             .profiles[]         -> Unit stat line (M/T/Sv/W/Ld/OC/InSv)
//             .entryLinks[]       -> weapons (targetId -> shared weapon entry)
//             .selectionEntryGroups[] -> weapon-choice groups of entryLinks
//     .entryLinks[]               -> ALSO enhancement/crusade groups -> do NOT
//                                    follow these for abilities (they carry
//                                    dozens of unrelated Abilities profiles).
//
// So we run two scoped traversals:
//   - stats + abilities: descend selectionEntries / selectionEntryGroups only.
//   - weapons: descend those PLUS entryLinks, keeping only weapon profiles.

const WEAPON_TYPES = new Set(['Ranged Weapons', 'Melee Weapons']);

function charMap(profile) {
  const m = {};
  for (const c of profile.characteristics || []) m[c.name] = (c.$text ?? '').trim();
  return m;
}

// Traverse selectionEntries + selectionEntryGroups (the composition tree),
// yielding every entry including the root. Does NOT follow entryLinks.
function* composition(entry, seen = new Set()) {
  if (!entry || seen.has(entry)) return;
  seen.add(entry);
  yield entry;
  for (const se of entry.selectionEntries || []) yield* composition(se, seen);
  for (const g of entry.selectionEntryGroups || []) {
    for (const se of g.selectionEntries || []) yield* composition(se, seen);
    // groups can also nest groups
    for (const gg of g.selectionEntryGroups || []) {
      for (const se of gg.selectionEntries || []) yield* composition(se, seen);
    }
  }
}

// Collect weapon profiles reachable through composition AND entryLinks.
function collectWeapons(entry, byId, out, seenIds = new Set(), depth = 0) {
  if (!entry || depth > 8) return;
  for (const p of entry.profiles || []) {
    if (WEAPON_TYPES.has(p.typeName)) out.push(p);
  }
  for (const se of entry.selectionEntries || []) {
    collectWeapons(se, byId, out, seenIds, depth + 1);
  }
  for (const g of entry.selectionEntryGroups || []) {
    collectWeapons(g, byId, out, seenIds, depth + 1);
  }
  for (const link of entry.entryLinks || []) {
    const tid = link.targetId;
    if (!tid || seenIds.has(tid)) continue;
    seenIds.add(tid);
    const target = byId.get(tid);
    if (target) collectWeapons(target, byId, out, seenIds, depth + 1);
  }
}

// Resolve an Abilities/rule infoLink target to { name, text } if possible.
function resolveInfoLink(link, byId) {
  const target = byId.get(link.targetId);
  if (target && target.characteristics) {
    const m = charMap(target);
    const text = m.Description || Object.values(m)[0] || '';
    return { name: target.name || link.name, text };
  }
  // Shared rules live elsewhere; fall back to the link name only.
  if (target && Array.isArray(target.characteristics)) {
    return { name: target.name || link.name, text: '' };
  }
  return { name: link.name, text: target?.description || '' };
}

// Main entry: turn a unit/model catalogue entry into a resolved datasheet.
export function resolveDatasheet(entry, byId) {
  const stats = [];
  const abilities = [];
  const seenAbility = new Set();
  const seenStat = new Set();

  for (const node of composition(entry)) {
    for (const p of node.profiles || []) {
      if (p.typeName === 'Unit' || p.typeName === 'Transport') {
        const chars = charMap(p);
        // Collapse identical stat lines (many model entries share one profile).
        const sig = JSON.stringify(chars);
        if (seenStat.has(sig)) continue;
        seenStat.add(sig);
        stats.push({ name: p.name, chars, type: p.typeName });
      } else if (p.typeName === 'Abilities') {
        const key = p.name + '|' + (p.characteristics?.[0]?.$text || '');
        if (!seenAbility.has(key)) {
          seenAbility.add(key);
          const m = charMap(p);
          abilities.push({ name: p.name, text: m.Description || Object.values(m)[0] || '' });
        }
      }
    }
  }

  const rawWeapons = [];
  collectWeapons(entry, byId, rawWeapons);
  const ranged = dedupeWeapons(rawWeapons.filter((p) => p.typeName === 'Ranged Weapons'));
  const melee = dedupeWeapons(rawWeapons.filter((p) => p.typeName === 'Melee Weapons'));

  // Keywords from category links, minus internal/faction bookkeeping.
  const keywords = [];
  const seenKw = new Set();
  for (const cl of entry.categoryLinks || []) {
    const n = cl.name || '';
    if (!n || n.startsWith('Faction:') || seenKw.has(n)) continue;
    seenKw.add(n);
    keywords.push(n);
  }
  const factions = (entry.categoryLinks || [])
    .filter((cl) => (cl.name || '').startsWith('Faction:'))
    .map((cl) => cl.name.replace('Faction:', '').trim());

  // Core/army rules referenced by infoLinks (Oath of Moment, Deep Strike, ...).
  const rules = [];
  const seenRule = new Set();
  for (const il of entry.infoLinks || []) {
    const r = resolveInfoLink(il, byId);
    if (r.name && !seenRule.has(r.name)) { seenRule.add(r.name); rules.push(r); }
  }

  const pts = (entry.costs || []).find((c) => c.name === 'pts');

  return {
    name: entry.name,
    entryType: entry.type,
    stats,
    ranged,
    melee,
    abilities,
    rules,
    keywords,
    factions,
    points: pts ? Number(pts.value) : null,
  };
}

function dedupeWeapons(profiles) {
  const seen = new Set();
  const out = [];
  for (const p of profiles) {
    const m = charMap(p);
    const key = p.name + '|' + JSON.stringify(m);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: p.name, chars: m });
  }
  return out;
}

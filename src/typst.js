// Emit a self-contained Typst document from a resolved army (see army.js).
// Data-derived text is emitted as Typst string literals (which render
// literally, with no markup interpretation), so we only escape backslash and
// quotes and needn't worry about #, *, $, etc. in unit/ability text.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HELPERS = join(__dirname, '..', 'templates', 'helpers.typ');

// Clean rules text: drop nbsp, strip the dataset's **/^^ markup, collapse space.
function clean(s) {
  return String(s ?? '')
    .replace(/ /g, ' ')
    .replace(/[\^*~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Typst string literal.
function ts(s) {
  return '"' + clean(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

const dash = '[—]';

function statVal(chars, key) {
  const v = (chars[key] ?? '').trim();
  return v === '' ? null : v;
}

// The stat line shown for a unit in the roster: prefer the profile named like
// the unit, else the first.
function primaryStat(u) {
  if (!u.stats.length) return null;
  return u.stats.find((s) => s.name === u.name) || u.stats[0];
}

function rosterTable(units) {
  const cols = ['Unit', 'M', 'T', 'Sv', 'Inv', 'W', 'Ld', 'OC', 'Pts'];
  const rows = [];
  for (const u of units) {
    const s = primaryStat(u);
    const c = s ? s.chars : {};
    const label = u.models > 1 ? `${u.name} (${u.models})` : u.name;
    const cells = [
      ts(label),
      ts(statVal(c, 'M') || '—'),
      ts(statVal(c, 'T') || '—'),
      ts(statVal(c, 'Sv') || '—'),
      ts(statVal(c, 'InSv') || '—'),
      ts(statVal(c, 'W') || '—'),
      ts(statVal(c, 'LD') || '—'),
      ts(statVal(c, 'OC') || '—'),
      u.points == null ? dash : ts(String(u.points)),
    ];
    rows.push(cells.join(', '));
  }
  const header = cols.map((c) => `hc[${c}]`).join(', ');
  return (
    `#table(\n` +
    `  columns: (1fr, auto, auto, auto, auto, auto, auto, auto, auto),\n` +
    `  align: (left, center, center, center, center, center, center, center, center),\n` +
    `  ${header},\n` +
    rows.map((r) => `  ${r},`).join('\n') +
    `\n)\n`
  );
}

function weaponTable(u) {
  const all = [
    ...u.ranged.map((w) => ({ ...w, kind: 'R' })),
    ...u.melee.map((w) => ({ ...w, kind: 'M' })),
  ];
  if (!all.length) return '';
  const rows = all.map((w) => {
    const c = w.chars;
    const skill = c.BS || c.WS || '—';
    const kw = clean(c.Keywords || '');
    return [
      `[${w.kind}]`,
      ts(w.name),
      ts(c.Range || '—'),
      ts(c.A || '—'),
      ts(skill),
      ts(c.S || '—'),
      ts(c.AP || '—'),
      ts(c.D || '—'),
      ts(kw || '—'),
    ].join(', ');
  });
  const header = ['', 'Weapon', 'Rng', 'A', 'BS/WS', 'S', 'AP', 'D', 'Keywords']
    .map((h) => `hc[${h}]`)
    .join(', ');
  return (
    `#table(\n` +
    `  columns: (auto, 1fr, auto, auto, auto, auto, auto, auto, 1.3fr),\n` +
    `  align: (center, left, center, center, center, center, center, center, left),\n` +
    `  ${header},\n` +
    rows.map((r) => `  ${r},`).join('\n') +
    `\n)\n`
  );
}

function unitDetail(u) {
  let out = '';
  const parts = [];
  if (u.models > 1) parts.push(`${u.models} models`);
  if (u.points != null) parts.push(`${u.points} pts`);
  if (u.keywords.length) parts.push(u.keywords.join(', '));
  out += `#unitband(${ts(u.name)}, ${ts(parts.join('  ·  '))})\n`;

  // Distinct stat lines (sergeant + body) if they differ.
  if (u.stats.length > 1) {
    const lines = u.stats.map((s) => {
      const c = s.chars;
      const inv = statVal(c, 'InSv') ? ` Inv${c.InSv}` : '';
      return `${s.name}: M${c.M} T${c.T} Sv${c.Sv} W${c.W} Ld${c.LD} OC${c.OC}${inv}`;
    });
    out += `#text(size: 6.8pt, fill: luma(90))[${ts(lines.join('    |    '))}]\n\n`;
  }

  const wt = weaponTable(u);
  if (wt) out += wt + '\n';

  if (u.abilities.length) {
    out += `#text(size: 6.9pt)[#text(weight: "bold")[Abilities. ] ${abilitiesInline(u.abilities)}]\n\n`;
  }

  if (u.enhancement) {
    out += `#text(size: 6.9pt, fill: accent)[#text(weight: "bold")[Enhancement — ${ts(u.enhancement.name)} (${u.enhancement.points} pts). ] ${ts(u.enhancement.text)}]\n\n`;
  }
  if (u.enhancementMissing) {
    out += `#text(size: 6.9pt, fill: red)[Enhancement not found: ${ts(u.enhancementMissing)}]\n\n`;
  }
  out += `#v(3pt)\n`;
  return out;
}

// Render an abilities list with bold names inline.
function abilitiesInline(abilities) {
  return abilities
    .map((a) => {
      const t = clean(a.text);
      const name = `#text(weight: "bold")[${ts(a.name)}]`;
      return t ? `${name} ${ts(t)}` : name;
    })
    .join(`  #text(fill: luma(180))[|]  `);
}

export function renderTypst(army) {
  const helpers = readFileSync(HELPERS, 'utf8');
  let doc = helpers + '\n\n';

  const sub = [army.meta.faction, army.meta.detachment, army.meta.points ? `${army.meta.points} pts` : '']
    .filter(Boolean)
    .join('  ·  ');
  doc += `#sheettitle(${ts(army.meta.name)}, ${ts(sub)})\n\n`;

  doc += `#section("Roster")\n`;
  doc += rosterTable(army.units) + '\n';

  doc += `#section("Datasheets")\n`;
  for (const u of army.units) doc += unitDetail(u);

  if (army.enhancements.length) {
    doc += `#section("Enhancements")\n`;
    for (const e of army.enhancements) {
      doc += `#text(size: 7pt)[#text(weight: "bold")[${ts(e.name)} (${e.points} pts). ] ${ts(e.text)}]\n\n`;
    }
  }

  if (army.stratagems.length) {
    doc += `#section("Stratagems")\n`;
    for (const s of army.stratagems) {
      const head = `${s.name} — ${s.cp}CP${s.phase ? ` · ${s.phase}` : ''}`;
      doc += `#text(size: 7pt)[#text(weight: "bold")[${ts(head)}. ] ${ts(s.text || '')}]\n\n`;
    }
  }

  // Shared army/detachment rules referenced by the units (names + any text).
  const seen = new Set();
  const rules = [];
  for (const u of army.units) {
    for (const r of u.rules || []) {
      if (!seen.has(r.name)) { seen.add(r.name); rules.push(r); }
    }
  }
  if (rules.length) {
    doc += `#section("Army & Detachment Rules")\n`;
    for (const r of rules) {
      const t = clean(r.text);
      doc += t
        ? `#text(size: 7pt)[#text(weight: "bold")[${ts(r.name)}. ] ${ts(t)}]\n\n`
        : `#text(size: 7pt)[#text(weight: "bold")[${ts(r.name)}] #text(fill: luma(150))[(see rulebook)]]\n\n`;
    }
  }

  return doc;
}

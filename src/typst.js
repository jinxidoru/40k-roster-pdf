// Emit a self-contained Typst document from a resolved army (see army.js).
// Data-derived text is emitted as Typst string literals (which render
// literally, with no markup interpretation), so we only escape backslash and
// quotes and needn't worry about #, *, $, etc. in unit/ability text.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HELPERS = join(__dirname, '..', 'templates', 'helpers.typ');

// Faction accent colors (header bar / borders). Chosen dark enough that the
// bar's white bold text stays readable. Matched case-insensitively; the first
// key found as a substring of the army's faction wins, else DEFAULT_ACCENT.
const FACTION_COLORS = {
  orks: '#4c7a2c',                 // Goff green
  'imperial fists': '#c8102e',     // (their yellow is unreadable under white text)
  'blood angels': '#8f1a1a',
  'dark angels': '#1f3d2b',
  'space wolves': '#3a5566',
  ultramarines: '#1f3a6e',
  'grey knights': '#3b4a52',
  necrons: '#2f6b4f',
  aeldari: '#2b6b8f',
  drukhari: '#3a2b4f',
  tyranids: '#5a2b6b',
  "t'au empire": '#8a5a1f',
  tau: '#8a5a1f',
  "adepta sororitas": '#6b1f2b',
  'astra militarum': '#4a5230',
  'adeptus custodes': '#7a5a12',
  'adeptus mechanicus': '#7a1f1f',
  'chaos space marines': '#3f2b2b',
  'death guard': '#5a5f2a',
  'thousand sons': '#1f6b6b',
  'world eaters': '#7a1f1f',
  'leagues of votann': '#7a5a1f',
  'genestealer cults': '#6b2b5a',
};
const DEFAULT_ACCENT = '#c8102e';

function accentFor(faction) {
  const f = (faction || '').toLowerCase();
  if (FACTION_COLORS[f]) return FACTION_COLORS[f];
  for (const key of Object.keys(FACTION_COLORS)) {
    if (f.includes(key)) return FACTION_COLORS[key];
  }
  return DEFAULT_ACCENT;
}

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
    // Header keeps its accent cells; body rows get faint alternating shading so
    // the eye can track a row across the table.
    `  fill: (_, row) => if row != 0 and calc.odd(row) { rgb("#f2f2f2") },\n` +
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
    const range = c.Range && c.Range !== 'Melee' ? c.Range : '—';
    return [
      `[${w.kind}]`,
      ts(w.name),
      ts(range),
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
  const parts = [];
  const meta = [];
  if (u.models > 1) meta.push(`${u.models} models`);
  if (u.points != null) meta.push(`${u.points} pts`);
  if (u.keywords.length) meta.push(u.keywords.join(', '));
  parts.push(`#unitband(${ts(u.name)}, ${ts(meta.join('  ·  '))})`);

  // Distinct stat lines (sergeant + body) if they differ.
  if (u.stats.length > 1) {
    const lines = u.stats.map((s) => {
      const c = s.chars;
      const inv = statVal(c, 'InSv') ? ` Inv${c.InSv}` : '';
      return `${s.name}: M${c.M} T${c.T} Sv${c.Sv} W${c.W} Ld${c.LD} OC${c.OC}${inv}`;
    });
    parts.push(`#text(size: 6.8pt, fill: luma(90))[${ts(lines.join('    |    '))}]`);
  }

  const wt = weaponTable(u);
  if (wt) parts.push(wt.trimEnd());

  if (u.abilities.length) {
    parts.push(`#text(size: 6.9pt)[${abilitiesInline(u.abilities)}]`);
  }
  if (u.enhancement) {
    parts.push(`#text(size: 6.9pt, fill: accent)[#text(weight: "bold")[Enhancement — ${ts(u.enhancement.name)} (${u.enhancement.points} pts). ] ${ts(u.enhancement.text)}]`);
  }
  if (u.enhancementMissing) {
    parts.push(`#text(size: 6.9pt, fill: red)[Enhancement not found: ${ts(u.enhancementMissing)}]`);
  }

  // Keep each datasheet whole: never split a unit across a page boundary.
  return `#block(breakable: false, width: 100%)[\n${parts.join('\n\n')}\n]\n#v(3pt)\n\n`;
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
  // Inject the faction accent BEFORE the helpers so its functions capture it.
  const accent = `#let accent = rgb("${accentFor(army.meta.faction)}")\n`;
  let doc = accent + helpers + '\n\n';

  const sub = [
    army.meta.faction,
    army.meta.detachment,
    army.meta.battleSize,
    army.meta.points ? `${army.meta.points} pts` : '',
  ]
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

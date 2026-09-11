// "Compact" renderer — a dense whole-army quick-reference on US Letter.
// render(army, options) -> Typst source string. Pure/browser-safe.

import {
  accentFor, clean, formatKeywords, ts, mk, statVal,
} from './shared.js';

// Typst preamble (page/style + helper functions). `accent` is the faction color.
function preamble(accent) {
  return `#let accent = rgb("${accent}")
#set page(paper: "us-letter", margin: (x: 9mm, y: 8mm))
#set text(font: ("Arimo", "Helvetica Neue", "Arial"), size: 7.6pt)
#set par(leading: 0.42em)
#let ink = rgb("#1a1a1a")
#let faint = luma(150)
#let band = luma(238)
#set table(inset: (x: 4pt, y: 2.2pt), stroke: 0.3pt + luma(200))
#let hc(body) = table.cell(fill: accent, text(fill: white, weight: "bold", size: 7pt, body))
#let sheettitle(name, sub) = {
  block(width: 100%, fill: accent, inset: (x: 6pt, y: 5pt), radius: 2pt)[
    #text(fill: white, weight: "bold", size: 13pt, name)
    #h(1fr)
    #text(fill: white, size: 8pt, sub)
  ]
  v(2pt)
}
#let section(title) = {
  v(4pt)
  block(width: 100%, fill: band, inset: (x: 5pt, y: 3pt), radius: 1.5pt)[
    #text(weight: "bold", size: 9pt, fill: ink, upper(title))
  ]
  v(2pt)
}
#let unitband(name, meta) = {
  block(width: 100%, inset: (x: 4pt, y: 2.5pt), fill: luma(248), stroke: (bottom: 0.6pt + accent))[
    #text(weight: "bold", size: 8.5pt, name)
    #h(1fr)
    #text(size: 7pt, fill: faint, meta)
  ]
}
`;
}

// Stat characteristic order shown in the roster table (after the Unit column).
const STAT_KEYS = ['M', 'T', 'Sv', 'InSv', 'W', 'LD', 'OC'];

function statCells(chars) {
  return STAT_KEYS.map((k) => ts(statVal(chars, k) || '—'));
}

// Main profile = the one named like the unit, else the first; others are secondary.
function splitProfiles(u) {
  if (!u.stats.length) return { main: null, secondary: [] };
  const main = u.stats.find((s) => s.name === u.name) || u.stats[0];
  return { main, secondary: u.stats.filter((s) => s !== main) };
}

function rosterTable(units) {
  const rows = [];
  const shaded = []; // 1-based data-row indices to shade (whole unit shares parity)
  let row = 1;
  units.forEach((u, ui) => {
    const shade = ui % 2 === 1;
    const { main, secondary } = splitProfiles(u);
    const chars = main ? main.chars : {};

    const base = u.models > 1 ? `${u.name} (${u.models})` : u.name;
    const label = u.count > 1 ? `${base} ×${u.count}` : base;
    rows.push([
      ts(label),
      ...statCells(chars),
      u.points == null ? ts('—') : ts(String(u.points)),
    ].join(', '));
    if (shade) shaded.push(row);
    row += 1;

    // Secondary profiles: indented, italic/faint, no points.
    for (const s of secondary) {
      const nameCell = `[#h(1em)#text(fill: luma(110), style: "italic")[${mk(s.name)}]]`;
      rows.push([
        nameCell,
        ...STAT_KEYS.map((k) => `[#text(fill: luma(110))[${mk(statVal(s.chars, k) || '—')}]]`),
        ts(''),
      ].join(', '));
      if (shade) shaded.push(row);
      row += 1;
    }
  });

  const cols = ['Unit', 'M', 'T', 'Sv', 'Inv', 'W', 'Ld', 'OC', 'Pts'];
  const header = cols.map((c) => `hc[${c}]`).join(', ');
  const shadedArr = `(${shaded.join(', ')}${shaded.length === 1 ? ',' : ''})`;
  return (
    `#table(\n` +
    `  columns: (1fr, auto, auto, auto, auto, auto, auto, auto, auto),\n` +
    `  align: (left, center, center, center, center, center, center, center, center),\n` +
    `  fill: (_, r) => if ${shadedArr}.contains(r) { rgb("#f2f2f2") },\n` +
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
    const kw = formatKeywords(c.Keywords || '');
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

// Abilities inline: bold Name — text, no surrounding quotes, faint pipe between.
function abilitiesInline(abilities) {
  return abilities
    .map((a) => {
      const t = clean(a.text);
      const name = `#text(weight: "bold")[${mk(a.name)}]`;
      return t ? `${name} — ${mk(t)}` : name;
    })
    .join('  #text(fill: luma(180))[|]  ');
}

function unitDetail(u) {
  const parts = [];

  // Title meta: model count and keywords (UPPERCASE); points omitted here.
  const meta = [];
  if (u.models > 1) meta.push(`${u.models} models`);
  if (u.keywords.length) meta.push(u.keywords.join(', ').toUpperCase());
  const title = u.count > 1 ? `${u.name} ×${u.count}` : u.name;
  parts.push(`#unitband(${ts(title)}, ${ts(meta.join('  ·  '))})`);

  // Distinct stat lines (sergeant + body) if they differ.
  if (u.stats.length > 1) {
    const lines = u.stats.map((s) => {
      const c = s.chars;
      const inv = statVal(c, 'InSv') ? ` Inv${c.InSv}` : '';
      return `${s.name}: M${c.M} T${c.T} Sv${c.Sv} W${c.W} Ld${c.LD} OC${c.OC}${inv}`;
    });
    parts.push(`#text(size: 6.8pt, fill: luma(90))[${mk(lines.join('    |    '))}]`);
  }

  const wt = weaponTable(u);
  if (wt) parts.push(wt.trimEnd());

  if (u.abilities.length) {
    parts.push(`#text(size: 6.9pt)[${abilitiesInline(u.abilities)}]`);
  }
  if (u.enhancement) {
    parts.push(`#text(size: 6.9pt, fill: accent)[#text(weight: "bold")[Enhancement — ${mk(u.enhancement.name)} (${u.enhancement.points} pts) — ] ${mk(clean(u.enhancement.text))}]`);
  }
  if (u.enhancementMissing) {
    parts.push(`#text(size: 6.9pt, fill: red)[Enhancement not found: ${mk(u.enhancementMissing)}]`);
  }

  // Keep each datasheet whole: never split a unit across a page boundary.
  return `#block(breakable: false, width: 100%)[\n${parts.join('\n\n')}\n]\n#v(3pt)\n\n`;
}

function render(army, _options = {}) {
  const accent = accentFor(army.meta.faction);
  let doc = preamble(accent) + '\n\n';

  const sub = [
    army.meta.faction,
    army.meta.detachment,
    army.meta.battleSize,
    army.meta.points ? `${army.meta.points} pts` : '',
  ]
    .filter(Boolean)
    .join('  ·  ');
  doc += `#sheettitle(${ts(army.meta.name)}, ${ts(sub)})\n\n`;

  // Alphabetize units for both the roster table and the datasheet section.
  const units = [...army.units].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );

  doc += rosterTable(units) + '\n';
  for (const u of units) doc += unitDetail(u);

  if (army.enhancements.length) {
    doc += `#section("Enhancements")\n`;
    for (const e of army.enhancements) {
      doc += `#text(size: 7pt)[#text(weight: "bold")[${mk(e.name)} (${e.points} pts) — ] ${mk(clean(e.text))}]\n\n`;
    }
  }

  if (army.stratagems.length) {
    doc += `#section("Stratagems")\n`;
    for (const s of army.stratagems) {
      const head = `${s.name} — ${s.cp}CP${s.phase ? ` · ${s.phase}` : ''}`;
      doc += `#text(size: 7pt)[#text(weight: "bold")[${mk(head)} — ] ${mk(clean(s.text || ''))}]\n\n`;
    }
  }

  // Shared army/detachment rules (names + any text), de-duplicated.
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
        ? `#text(size: 7pt)[#text(weight: "bold")[${mk(r.name)} — ] ${mk(t)}]\n\n`
        : `#text(size: 7pt)[#text(weight: "bold")[${mk(r.name)}] #text(fill: luma(150))[(see rulebook)]]\n\n`;
    }
  }

  return doc;
}

export default {
  id: 'compact',
  name: 'Compact',
  description: 'Dense whole-army quick-reference on US Letter.',
  options: [],
  render,
};

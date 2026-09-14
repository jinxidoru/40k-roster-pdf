// "Standard" renderer — a dense whole-army quick-reference on US Letter.
// render(army, options) -> Typst source string. Pure/browser-safe.

import {
  clean, formatKeywords, ts, mk, statVal,
  splitProfiles, rosterGroups, subsetKeywords, datasheetGroups, resolveAccent,
} from './shared.js';

// Typst preamble (page/style + helper functions). `accent` is the faction color,
// `paper` a Typst paper name (e.g. "us-letter", "a4").
function preamble(accent, paper) {
  return `#let accent = rgb("${accent}")
#set page(paper: "${paper}", margin: (x: 9mm, y: 8mm))
#set text(font: ("Arimo", "Helvetica Neue", "Arial"), size: 7.6pt)
#set par(leading: 0.42em)
#let ink = rgb("#1a1a1a")
#let faint = luma(150)
#let band = luma(238)
// Readable text color on the accent: dark on light accents (e.g. yellow), else white.
#let onaccent = {
  let c = accent.components()
  let lum = 0.299 * (c.at(0) / 100%) + 0.587 * (c.at(1) / 100%) + 0.114 * (c.at(2) / 100%)
  if lum > 0.62 { rgb("#1a1a1a") } else { white }
}
#set table(inset: (x: 4pt, y: 2.2pt), stroke: 0.3pt + luma(200))
#let hc(body) = table.cell(fill: accent, text(fill: onaccent, weight: "bold", size: 7pt, body))
// Weapon-kind marker locked into a fixed box so the glyph never changes row
// height; dy nudges the glyph vertically (crosshair sits a touch high).
#let ico(g, dy: 0pt) = box(width: 9pt, height: 0.85em, align(center + horizon, move(dy: dy, text(size: 8pt, g))))
#let sheettitle(name, sub) = {
  block(width: 100%, fill: accent, inset: (x: 6pt, y: 5pt), radius: 2pt)[
    #text(fill: onaccent, weight: "bold", size: 13pt, name)
    #h(1fr)
    #text(fill: onaccent, size: 8pt, sub)
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
    #grid(
      columns: (auto, 1fr), column-gutter: 16pt, align: top,
      text(weight: "bold", size: 8.5pt, name),
      align(right, text(size: 7pt, fill: faint, meta)),
    )
  ]
}
`;
}

// Stat characteristic order shown in the roster table (after the Unit column).
const STAT_KEYS = ['M', 'T', 'Sv', 'InSv', 'W', 'LD', 'OC'];

function statCells(chars) {
  return STAT_KEYS.map((k) => ts(statVal(chars, k) || '—'));
}

// Unit name cell: bold name (+ model count in parens), then any surfaced subset
// keywords after an em-dash in a lighter color.
function unitNameCell(u) {
  const models = u.models > 1 ? ` (${u.models})` : '';
  const kw = subsetKeywords(u.keywords || []);
  const tail = kw.length ? ` #text(fill: luma(130))[— ${mk(kw.join(', ').toUpperCase())}]` : '';
  return `[#text(weight: "bold")[${mk(u.name + models)}]${tail}]`;
}

// `opts`: { showPoints, showCount }. showCount adds a leading quantity column
// (only when some unit is present in multiples).
function rosterTable(units, opts = {}) {
  const groups = rosterGroups(units);
  const showCount = groups.some((g) => g.count > 1);
  const showPoints = opts.showPoints !== false;
  const rows = [];
  for (const g of groups) {
    const u = g.unit;
    const { main, secondary } = splitProfiles(u);
    const chars = main ? main.chars : {};
    rows.push([
      ...(showCount ? [ts(String(g.count))] : []),
      unitNameCell(u),
      ...statCells(chars),
      ...(showPoints ? [u.points == null ? ts('—') : ts(String(u.points))] : []),
    ].join(', '));

    // Secondary profiles: indented, italic/faint, no count/points.
    for (const s of secondary) {
      rows.push([
        ...(showCount ? [ts('')] : []),
        `[#h(1em)#text(fill: luma(110), style: "italic")[${mk(s.name)}]]`,
        ...STAT_KEYS.map((k) => `[#text(fill: luma(110))[${mk(statVal(s.chars, k) || '—')}]]`),
        ...(showPoints ? [ts('')] : []),
      ].join(', '));
    }
  }

  const cols = [
    ...(showCount ? ['#'] : []), 'Unit', 'M', 'T', 'Sv', 'Inv', 'W', 'Ld', 'OC',
    ...(showPoints ? ['Pts'] : []),
  ];
  const colSpec = [
    ...(showCount ? ['auto'] : []), '1fr', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto',
    ...(showPoints ? ['auto'] : []),
  ];
  const align = [
    ...(showCount ? ['center'] : []), 'left', 'center', 'center', 'center', 'center', 'center', 'center', 'center',
    ...(showPoints ? ['center'] : []),
  ];
  // '#' is special in Typst markup — escape it in the count-column header.
  const header = cols.map((c) => `hc[${c === '#' ? '\\#' : c}]`).join(', ');
  return (
    `#table(\n` +
    `  columns: (${colSpec.join(', ')}),\n` +
    `  align: (${align.join(', ')}),\n` +
    `  fill: (_, r) => if r != 0 and calc.odd(r) { rgb("#f2f2f2") },\n` +
    `  ${header},\n` +
    rows.map((r) => `  ${r},`).join('\n') +
    `\n)\n`
  );
}

function weaponTable(u, opts = {}) {
  const all = [
    ...u.ranged.map((w) => ({ ...w, kind: 'R' })),
    ...u.melee.map((w) => ({ ...w, kind: 'M' })),
  ];
  if (!all.length) return '';
  const rows = all.map((w) => {
    const c = w.chars;
    const skill = c.BS || c.WS || '—';
    let kw = formatKeywords(c.Keywords || '');
    if (opts.weaponKeywordsCaps && kw) kw = kw.toUpperCase();
    const range = c.Range && c.Range !== 'Melee' ? c.Range : '—';
    const marker = w.kind === 'R' ? 'ico("⌖", dy: -0.5pt)' : 'ico("⚔")';
    return [
      marker,
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
  // With headers off, there's no header row: shade even rows so the first data
  // row stays clear, and pull the table up tight against the unit-name band.
  const headerless = opts.weaponHeaders === false;
  const fill = headerless
    ? `  fill: (_, r) => if calc.even(r) and r != 0 { rgb("#f2f2f2") },\n`
    : `  fill: (_, r) => if r != 0 and calc.odd(r) { rgb("#f2f2f2") },\n`;
  const table =
    `#table(\n` +
    `  columns: (auto, 1fr, auto, auto, auto, auto, auto, auto, 1.3fr),\n` +
    `  align: (center, left, center, center, center, center, center, center, left),\n` +
    fill +
    (headerless ? '' : `  ${header},\n`) +
    rows.map((r) => `  ${r},`).join('\n') +
    `\n)\n`;
  return headerless ? `#block(above: 2pt, breakable: false)[\n${table}]\n` : table;
}

// Abilities inline: bold Name — text, no surrounding quotes, faint pipe between.
const ABIL_SEP = '  #text(fill: luma(180))[|]  ';
function abilityItem(a) {
  const t = clean(a.text);
  const name = `#text(weight: "bold")[${mk(a.name)}]`;
  return t ? `${name} — ${mk(t)}` : name;
}

function unitDetail(u, opts = {}) {
  const parts = [];

  // Title meta: model count and keywords (UPPERCASE); points/unit-count omitted.
  const meta = [];
  if (u.models > 1) meta.push(`${u.models} models`);
  if (u.keywords.length) meta.push(u.keywords.join(', ').toUpperCase());
  parts.push(`#unitband(${ts(u.name)}, ${ts(meta.join('  ·  '))})`);

  // (Stat profiles — including alternate/secondary — live only in the top table.)

  const wt = weaponTable(u, opts);
  if (wt) parts.push(wt.trimEnd());

  // Core / Faction ability keywords. Either on their own compact line (default)
  // or folded into the front of the abilities line as "*Core* — …".
  const cf = [];
  if (u.core && u.core.length) cf.push({ label: 'Core', vals: u.core });
  if (u.faction && u.faction.length) cf.push({ label: 'Faction', vals: u.faction });
  const inAbilities = opts.coreFactionInAbilities === true;

  if (!inAbilities && cf.length) {
    const line = cf
      .map(({ label, vals }) => `#text(weight: "bold")[${label}: ] ${mk(vals.join(', '))}`)
      .join('    #text(fill: luma(180))[·]    ');
    parts.push(`#text(size: 6.6pt, fill: luma(70))[${line}]`);
  }

  const items = [];
  if (inAbilities) {
    for (const { label, vals } of cf) items.push(`#text(weight: "bold")[${label}] — ${mk(vals.join(', '))}`);
  }
  for (const a of u.abilities) items.push(abilityItem(a));
  if (items.length) {
    parts.push(`#text(size: 6.9pt)[${items.join(ABIL_SEP)}]`);
  }
  // Enhancements: the coalesced list (units differing only by enhancement share
  // one datasheet), else this unit's single enhancement.
  const enhancements = opts.enhancements || (u.enhancement ? [u.enhancement] : []);
  for (const e of enhancements) {
    parts.push(`#text(size: 6.9pt, fill: accent)[#text(weight: "bold")[Enhancement — ${mk(e.name)} (${e.points} pts) — ] ${mk(clean(e.text || ''))}]`);
  }
  if (u.enhancementMissing) {
    parts.push(`#text(size: 6.9pt, fill: red)[Enhancement not found: ${mk(u.enhancementMissing)}]`);
  }

  // Keep each datasheet whole: never split a unit across a page boundary.
  return `#block(breakable: false, width: 100%)[\n${parts.join('\n\n')}\n]\n#v(3pt)\n\n`;
}

// Typst paper names. "us-statement" is 5.5×8.5in = Half Letter (half of US
// Letter), the US analogue of A5.
const PAPERS = { 'us-letter': 'us-letter', 'half-letter': 'us-statement', a4: 'a4', a5: 'a5' };

// Options may arrive as real booleans (checkbox) or "true"/"false" strings
// (persisted/query). Normalize to a boolean with an explicit default.
function bool(v, def) {
  if (v === undefined || v === null || v === '') return def;
  return v === true || v === 'true';
}

// Keyword-glossary mode: 'none' | 'include' | 'separate'. Accepts legacy values
// (true / 'show' -> 'include') so older persisted/CLI values still work.
function glossaryMode(v) {
  if (v === 'include' || v === 'separate') return v;
  if (v === 'show' || v === true || v === 'true') return 'include';
  return 'none';
}

// Reduce a keyword token to a base name for matching against glossary keys:
// drop conditional (":…"), a trailing value ("1", "4+", "D3"), and any subtype
// after a hyphen ("Anti-infantry" -> "anti", "Close-quarters" -> "close").
function kwBase(s) {
  return String(s || '')
    .replace(/ /g, ' ')
    .toLowerCase()
    .split(':')[0]
    .replace(/\s+(d?\d+\+?|\d\+)$/, '')
    .split('-')[0]
    .trim();
}

function render(army, options = {}) {
  const accent = resolveAccent(options, army);
  const paper = PAPERS[options.paper] || 'us-letter';
  const opts = {
    weaponHeaders: bool(options.weaponHeaders, true),
    weaponKeywordsCaps: bool(options.weaponKeywordsCaps, false),
    coreFactionInAbilities: bool(options.coreFactionInAbilities, true),
    keywordGlossary: glossaryMode(options.keywordGlossary),
  };
  let doc = preamble(accent, paper) + '\n\n';

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

  doc += rosterTable(units, { showPoints: bool(options.showPoints, true) }) + '\n';
  // Datasheets: units differing only by enhancement share one datasheet, which
  // lists all their enhancements.
  for (const g of datasheetGroups(units)) doc += unitDetail(g.unit, { ...opts, enhancements: g.enhancements });

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

  // Keyword glossary: define every weapon/core keyword the army references AND
  // the export actually carries text for. Referenced-but-undefined keywords
  // (e.g. Lethal Hits — never defined in the export) are counted, not invented.
  if (opts.keywordGlossary !== 'none') {
    const refBases = new Set();
    for (const u of army.units) {
      for (const w of [...u.ranged, ...u.melee]) {
        for (const part of String(w.chars.Keywords || '').split(',')) {
          const b = kwBase(part);
          if (b) refBases.add(b);
        }
      }
      for (const c of u.core || []) { const b = kwBase(c); if (b) refBases.add(b); }
    }
    // Combine roster-embedded definitions (authoritative for this list) with the
    // bundled core-keyword fallback (army.coreGlossary), keyed by base name so
    // value-variants and cross-source duplicates collapse. Roster wins; core
    // fills gaps. coreGlossary is absent if src/keywords.json was removed.
    const byBase = new Map();
    const add = (name, text) => {
      const b = kwBase(name);
      if (!b || !refBases.has(b) || byBase.has(b)) return;
      byBase.set(b, { name, text });
    };
    for (const [name, text] of Object.entries(army.glossary || {})) add(name, text);
    for (const [name, text] of Object.entries(army.coreGlossary || {})) add(name, text);

    const entries = [...byBase.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    const undefinedCount = [...refBases].filter((b) => b && !byBase.has(b)).length;

    if (entries.length) {
      if (opts.keywordGlossary === 'separate') doc += `#pagebreak()\n`;
      doc += `#section("Keyword Glossary")\n`;
      for (const { name, text } of entries) {
        doc += `#text(size: 7pt)[#text(weight: "bold")[${mk(name)} — ] ${mk(clean(text))}]\n\n`;
      }
      if (undefinedCount) {
        doc += `#text(size: 6.4pt, fill: luma(150), style: "italic")[${undefinedCount} other referenced keyword${undefinedCount === 1 ? '' : 's'} ${undefinedCount === 1 ? 'has' : 'have'} no definition available.]\n\n`;
      }
    }
  }

  return doc;
}

export default {
  id: 'standard',
  name: 'Standard',
  description: 'Dense whole-army quick-reference on one or two pages.',
  options: [
    {
      key: 'paper',
      label: 'Page size',
      type: 'select',
      default: 'us-letter',
      help: 'Physical page size for the sheet. US Letter and A4 are full-size; A5 is a compact half-of-A4 format (fits more pages, smaller print).',
      choices: [
        { value: 'us-letter', label: 'US Letter' },
        { value: 'half-letter', label: 'Half Letter' },
        { value: 'a4', label: 'A4' },
        { value: 'a5', label: 'A5' },
      ],
    },
    {
      key: 'showPoints',
      label: 'Points column',
      type: 'bool',
      default: true,
      help: 'Show a Pts column in the roster summary table with each unit’s points cost. Turn off for a cleaner table when points aren’t needed.',
    },
    {
      key: 'weaponHeaders',
      label: 'Weapon table headers',
      type: 'bool',
      default: true,
      help: 'Show the column-header row (Weapon / Rng / A / BS-WS / S / AP / D / Keywords) above each unit’s weapons. Turn off to drop the repeated headers and tuck the weapon table tight under the unit’s name band — denser, but you lose the column labels.',
    },
    {
      key: 'weaponKeywordsCaps',
      label: 'Weapon keywords in caps',
      type: 'bool',
      default: false,
      help: 'Render every weapon keyword in ALL CAPS (e.g. “ASSAULT, RAPID FIRE 1”) instead of Title Case. Matches the look of the official datasheets.',
    },
    {
      key: 'coreFactionInAbilities',
      label: 'Core/Faction in ability list',
      type: 'bool',
      default: true,
      help: 'Fold each unit’s Core and Faction ability keywords into the front of its abilities line (e.g. “Core — Deep Strike, Infiltrators | Faction — Oath of Moment”) instead of showing them on their own separate line above the abilities.',
    },
    {
      key: 'keywordGlossary',
      label: 'Keyword glossary',
      type: 'select',
      default: 'none',
      help: 'A section defining every referenced weapon/core keyword the roster export includes rules text for (keywords it doesn’t define, e.g. Lethal Hits, are only counted in a footnote). “Include” appends it after the army rules; “Separate page” starts it on a fresh page.',
      choices: [
        { value: 'none', label: 'None' },
        { value: 'include', label: 'Include' },
        { value: 'separate', label: 'Separate page' },
      ],
    },
    {
      key: 'accent',
      label: 'Accent color',
      type: 'color',
      default: 'faction',
      help: 'Color for the title bar and table headers. Default uses the army’s faction/sub-faction color; header text switches to dark automatically on light colors.',
    },
  ],
  render,
};

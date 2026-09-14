// Shared building blocks for the "cards" renderer: card sizes, the Typst
// preamble (primitives + the measure-based packer that splits one unit across
// as many cards as its content needs), a unit-view extractor, and the five
// style variants. Pure/browser-safe — everything returns Typst source strings.

import {
  clean, formatKeywords, ts, mk, statVal,
  splitProfiles, rosterGroups, subsetKeywords, datasheetGroups, resolveAccent,
} from './shared.js';

// Re-exported so cards.js (which imports renderer helpers from here) gets it too.
export { resolveAccent };

// Card sizes in millimetres. Standard = Magic/Poker (63×88mm ≈ 2.5×3.5in).
// Add more entries later (Bridge 57×89, Tarot 70×120, …) — the option is built
// to extend.
export const CARD_SIZES = {
  standard: { w: 63, h: 88, label: 'Standard (Magic / Poker)' },
  tarot: { w: 70, h: 120, label: 'Tarot' },
};

// The main (bulk) profile — matches the unit name, else the first profile.
function mainProfile(u) {
  if (!u.stats || !u.stats.length) return {};
  const lc = u.name.toLowerCase();
  const singular = lc.replace(/s$/, '');
  return (
    u.stats.find((s) => s.name.toLowerCase() === lc) ||
    u.stats.find((s) => s.name.toLowerCase() === singular) ||
    u.stats.find((s) => lc.startsWith(s.name.toLowerCase())) ||
    u.stats[0]
  ).chars || {};
}

// Normalize a unit into the fields the card styles consume.
export function unitView(u) {
  const chars = mainProfile(u);
  // Append an inch mark to values that are a plain number (Movement, Range).
  const inches = (v) => { const t = String(v).replace(/["″]+$/, '').trim(); return /\d$/.test(t) ? t + '″' : t; };
  const mv = statVal(chars, 'M');
  const invRaw = statVal(chars, 'InSv');
  const invuln = invRaw && !/^[-—]$/.test(invRaw) ? invRaw : null; // shown as a shield, not a rail cell
  const stats = [
    ['M', mv == null ? null : inches(mv)],
    ['T', statVal(chars, 'T')],
    ['Sv', statVal(chars, 'Sv')],
    ['W', statVal(chars, 'W')],
    ['Ld', statVal(chars, 'LD')],
    ['OC', statVal(chars, 'OC')],
  ].filter(([, v]) => v != null);

  const weapons = [
    ...u.ranged.map((w) => ({ ...w, kind: 'R' })),
    ...u.melee.map((w) => ({ ...w, kind: 'M' })),
  ].map((w) => {
    const c = w.chars;
    // "N/A" (e.g. Torrent's skill) and blanks render as an em-dash.
    const na = (v) => { const t = String(v || '').trim(); return t === '' || /^n\/?a$/i.test(t) ? '—' : t; };
    const rng = c.Range && c.Range !== 'Melee' ? na(c.Range) : '—';
    return {
      kind: w.kind,
      name: w.name,
      range: rng === '—' ? '—' : inches(rng),
      a: na(c.A),
      skill: na(c.BS || c.WS),
      s: na(c.S),
      ap: na(c.AP),
      d: na(c.D),
      kw: formatKeywords(c.Keywords || ''),
    };
  });

  return {
    title: u.name, // unit count/points intentionally omitted from the card title
    meta: '', // points/model-count intentionally omitted from cards
    keywords: (u.keywords || []).join(', '),
    stats,
    invuln,
    weapons,
    abilities: u.abilities || [],
    core: u.core || [],
    faction: u.faction || [],
    enhancements: u.enhancement ? [u.enhancement] : [],
  };
}

// Group army units into cards: units differing only by enhancement share one
// card, which lists all their enhancements (see datasheetGroups). The view's
// enhancements come from the merged group, not the single representative unit.
export function cardGroups(army) {
  return datasheetGroups(army.units).sort((a, b) =>
    a.unit.name.localeCompare(b.unit.name, undefined, { sensitivity: 'base' }));
}
export function groupView(group) {
  const v = unitView(group.unit);
  v.enhancements = group.enhancements;
  return v;
}

// Typst preamble: colors, primitives, and the packer. `accent` is a hex string;
// `titlefont` is the display font family for the unit name.
export function preamble(accent, titlefont = 'Anton') {
  return `#let accent = rgb("${accent}")
#let ink = rgb("#1a1a1a")
#let faint = luma(120)
#let band = luma(238)
// Title/display font (chosen per style).
#let titlefont = "${titlefont}"
// Width of the full-bleed colored border around each card.
#let cardbleed = 1.25mm
// Readable text color on the accent: dark on light accents (e.g. yellow), else white.
#let onaccent = {
  let c = accent.components()
  let lum = 0.299 * (c.at(0) / 100%) + 0.587 * (c.at(1) / 100%) + 0.114 * (c.at(2) / 100%)
  if lum > 0.62 { rgb("#1a1a1a") } else { white }
}
#set text(font: ("Arimo", "Helvetica Neue", "Arial"), fill: ink, size: 7.4pt)
#set par(leading: 0.4em)

// --- primitives ------------------------------------------------------------
// A stat "coin": value large, label small beneath, in an accent ring.
#let statcoin(label, val) = align(center + top, stack(
    dir: ttb, spacing: 1pt,
    box(width: 7mm, height: 7mm, radius: 50%, fill: white, stroke: 1.1pt + accent, inset: 0pt,
      align(center + horizon, text(weight: "bold", size: 8pt, val))),
    text(size: 5.2pt, fill: faint, weight: "bold", upper(label)),
  ))
// Distribute coins evenly across the full card width so they never overflow.
#let statcoins(pairs) = grid(columns: pairs.map(_ => 1fr), align: center + top,
  ..pairs.map(p => statcoin(p.at(0), p.at(1))))

// A horizontal segmented stat bar: labeled cells side by side.
#let statbar(pairs) = grid(
  columns: pairs.map(_ => 1fr),
  stroke: 0.4pt + luma(200),
  ..pairs.map(p => box(inset: (y: 2pt), align(center)[
    #text(size: 5.5pt, fill: faint, weight: "bold", upper(p.at(0)))\ #text(weight: "bold", size: 9pt, p.at(1))
  ]))
)

// A stat "box": a rounded chip with the label on an accent strip up top and the
// value large on white beneath (game-UI style).
// stack(spacing: 0) glues the label strip to the number (no block gap between).
#let railcell(label, val) = box(width: 100%, radius: 1mm, clip: true, stroke: 0.5pt + accent,
  stack(dir: ttb, spacing: 0pt,
    block(width: 100%, fill: accent, inset: (y: 0.5mm),
      align(center, text(fill: onaccent, weight: "bold", size: 4.6pt, tracking: 0.3pt, upper(label)))),
    block(width: 100%, fill: white, inset: (top: 0.4mm, bottom: 0.6mm),
      align(center, text(fill: ink, font: titlefont, weight: 700, size: 12pt, val)))))

// Invulnerable save as a curved shield: accent outline, black number (sized to
// match the stat boxes), no label. The TOP edge is left unstroked so the accent
// "INV" strip above it meets a straight line (like the other stat boxes) with no
// seam — the white body fills up to y=0 and the outline is only the sides + point.
#let shield(val) = {
  let w = 8.5mm
  let h = 9mm
  box(width: w, height: h, {
    place(top + left, curve(
      stroke: none,
      fill: white,
      curve.move((0mm, 0mm)),
      curve.line((w, 0mm)),
      curve.line((w, 0.42 * h)),
      curve.cubic((w, 0.75 * h), (0.62 * w, 0.95 * h), (0.5 * w, h)),
      curve.cubic((0.38 * w, 0.95 * h), (0mm, 0.75 * h), (0mm, 0.42 * h)),
      curve.close(),
    ))
    place(top + left, curve(
      stroke: 0.5pt + accent, // match the stat-box outline weight
      fill: none,
      curve.move((0mm, 0mm)),
      curve.line((0mm, 0.42 * h)),
      curve.cubic((0mm, 0.75 * h), (0.38 * w, 0.95 * h), (0.5 * w, h)),
      curve.cubic((0.62 * w, 0.95 * h), (w, 0.75 * h), (w, 0.42 * h)),
      curve.line((w, 0mm)),
    ))
    place(center + horizon, dy: -0.9mm, text(fill: ink, font: titlefont, weight: 700, size: 12pt, val))
  })
}

// Invuln stat: an "INV" label strip (matching the stat boxes) glued directly to
// the shield. The strip's straight bottom continues into the shield's side
// outline — one connected unit, no gap.
#let invcell(val) = align(center, box(width: 8.5mm, stack(dir: ttb, spacing: 0pt,
  block(width: 100%, fill: accent, radius: (top: 1mm), inset: (y: 0.5mm),
    align(center, text(fill: onaccent, weight: "bold", size: 4.6pt, tracking: 0.3pt, "INV"))),
  shield(val),
)))

// Keyword chips.
#let chip(t) = box(fill: band, inset: (x: 3pt, y: 1pt), radius: 2pt, text(size: 5.6pt, fill: luma(60), t))
#let chips(list) = box(width: 100%)[#list.map(chip).join(h(2pt))]

// A faint section label (Weapons / Abilities).
#let seclabel(t) = block(width: 100%, inset: (top: 1.5pt, bottom: 0.5pt),
  text(size: 5.6pt, fill: accent, weight: "bold", tracking: 0.4pt, upper(t)))

// A single hard rule (e.g. at the bottom of the weapon list).
#let hardline = block(width: 100%, inset: (y: 2.2pt), line(length: 100%, stroke: 0.6pt + luma(120)))

// A weapon row (two lines): kind tag + name + keywords on line 1, the stat line
// (range/attacks/skill/S/AP/D) indented beneath.
#let wkind(k) = box(width: 8pt, height: 8pt, radius: 50%, fill: if k == "R" { accent } else { luma(90) },
  align(center + horizon, text(fill: if k == "R" { onaccent } else { white }, size: 5pt, weight: "bold", k)))
#let statcell(lbl, v) = box[#text(size: 5pt, fill: faint, weight: "bold", lbl) #text(size: 6.2pt, v)]
#let wrow(k, name, rng, a, sk, s, ap, d, kw) = block(width: 100%, inset: (y: 1.4pt))[
  #grid(columns: (auto, 1fr), column-gutter: 3pt, align: horizon,
    wkind(k),
    [#text(weight: "bold", size: 6.9pt, name)#if kw != "" [  #text(size: 5.7pt, fill: luma(110))[#kw]]],
  )
  #pad(left: 11pt, top: 0.5pt)[#grid(columns: (auto,) * 6, column-gutter: 5pt,
    statcell("R", rng), statcell("A", a), statcell([BS/WS], sk), statcell("S", s), statcell("AP", ap), statcell("D", d))]
]

// Alternate weapon row: stats as bare values separated by faint pipes, no labels.
#let wrowpipe(k, name, rng, a, sk, s, ap, d, kw) = block(width: 100%, inset: (y: 1.4pt))[
  #grid(columns: (auto, 1fr), column-gutter: 3pt, align: horizon,
    wkind(k),
    [#text(weight: "bold", size: 6.9pt, name)#if kw != "" [  #text(size: 5.7pt, fill: luma(110))[#kw]]],
  )
  #pad(left: 11pt, top: 0.5pt, text(size: 6.5pt, fill: luma(70))[#(rng, a, sk, s, ap, d).join(text(fill: luma(185))[ #h(2pt)|#h(2pt) ])])
]

// Stat line: six equal-width, centered cells separated by pipes.
#let statline(rng, a, sk, s, ap, d) = {
  let vals = (rng, a, sk, s, ap, d)
  let cols = ()
  let cells = ()
  for (i, v) in vals.enumerate() {
    if i > 0 { cols.push(auto); cells.push(align(center + horizon, text(size: 6.2pt, fill: luma(195))[|])) }
    cols.push(1fr); cells.push(align(center + horizon, text(size: 6.6pt, fill: ink, v)))
  }
  grid(columns: cols, ..cells)
}
// Weapon body: name, then the equal-width stat line, then keywords.
#let wbody(name, rng, a, sk, s, ap, d, kw) = stack(dir: ttb, spacing: 2.4pt,
  text(weight: "bold", size: 7pt, name),
  statline(rng, a, sk, s, ap, d),
  ..(if kw != "" { (text(size: 5.7pt, fill: luma(70), kw),) } else { () }),
)
// Flush: name flush left, no kind marker.
#let wrowflush(k, name, rng, a, sk, s, ap, d, kw) = block(width: 100%, inset: (y: 1.8pt),
  wbody(name, rng, a, sk, s, ap, d, kw))
// Tagged: R/M oval to the left of the name.
#let wrowtag(k, name, rng, a, sk, s, ap, d, kw) = block(width: 100%, inset: (y: 1.8pt),
  grid(columns: (auto, 1fr), column-gutter: 3.5pt, align: top,
    wkind(k), wbody(name, rng, a, sk, s, ap, d, kw)))

// Full-bleed title bar (no radius — the card clips the corners). The unit name
// uses Oswald, a condensed display sans that fits long names.
#let titlebar(name, sz) = block(width: 100%, fill: accent, inset: (x: 2.5mm, y: 1.5mm),
  text(font: titlefont, fill: onaccent, weight: 700, size: sz + 1pt, name))

// Full-bleed keyword band: neutral grey (same for every faction), black caps.
#let kwband(txt) = block(width: 100%, fill: luma(230), inset: (x: 2.5mm, y: 1mm),
  text(size: 5.9pt, fill: ink, weight: "bold", tracking: 0.2pt, upper(txt)))

// Thin full-bleed accent border around the whole card so an imprecise cut still
// leaves a clean colored edge. Content lives in the inner white area.
// round: rounded outer corners (preview) vs square (PDF, for clean cutting).
// The inner box is square so the title bar meets the border with no white seam.
#let cardframe(cw, ch, body, round: true) = box(width: cw, height: ch,
  radius: (if round { 2mm } else { 0mm }), fill: accent, clip: true, inset: cardbleed,
  box(width: 100%, height: 100%, radius: 0mm, clip: true, fill: white, stroke: none, body))

// An ability paragraph.
#let abil(name, body) = block(width: 100%, inset: (y: 1pt), text(size: 6.6pt)[#text(weight: "bold", name)#if body != "" [ — #body]])
// An enhancement paragraph — same text color as abilities; the "Enhancements"
// section label above it (accent) is what sets it apart.
#let enh(name, body) = block(width: 100%, inset: (y: 1pt), text(size: 6.6pt)[#text(weight: "bold", name)#if body != "" [ — #body]])

// --- packer ----------------------------------------------------------------
// Split \`blocks\` across as many cards as needed so nothing overflows, drawing
// each with \`frame(index, total, body)\`. \`header\` (if any) repeats on every
// card. \`cw\` is the flowing content width; \`availH\` the card's content height.
// header is measured at headerW (full card width — it bleeds); flowing blocks
// at bodyW (padded). frame(i, n, header, body) composes the card: full-bleed
// header on top, padded body beneath.
// firstReserve reserves extra height on the FIRST card only (for a bottom-pinned
// footer that appears on card 1 of a multi-card unit but not continuation cards).
#let packcards(headerW, header, bodyW, availH, gap, blocks, frame, firstReserve: 0pt) = context {
  let hh = if header == none { 0pt } else { measure(box(width: headerW, header)).height }
  let cards = ()
  let cur = ()
  let curH = 0pt
  for b in blocks {
    let h = measure(box(width: bodyW, b)).height + gap
    let avail = availH - hh - (if cards.len() == 0 { firstReserve } else { 0pt })
    if curH + h > avail and cur.len() > 0 {
      cards.push(cur); cur = (); curH = 0pt
    }
    cur.push(b); curH += h
  }
  if cur.len() > 0 or cards.len() == 0 { cards.push(cur) }
  for (i, c) in cards.enumerate() {
    frame(i, cards.len(), header, stack(spacing: gap, ..c))
  }
}

// Build ONE unit's cards as an array of fixed-size (cw×ch) card boxes. Call
// within a #context (uses measure). Single source of truth for the app preview
// (stack the array) and the PDF (concatenate arrays across units, then tile).
//   u: (title: str, keywords: str, rail: ((label, val)...), invuln: str | none,
//       blocks: (content...))
#let makecards(u, cw, ch, round: true, invBottom: false) = {
  let ipad = 2.6mm
  let railW = 10mm
  let gap = 2pt
  let innerW = cw - 2 * cardbleed
  let innerH = ch - 2 * cardbleed
  let header = stack(spacing: 0pt, titlebar(u.title, 10pt),
    ..(if u.keywords != "" { (kwband(u.keywords),) } else { () }))
  let headerH = measure(box(width: innerW, header)).height
  let bodyW = innerW - railW - 2 * ipad
  let avail = innerH - headerH - ipad - 0.8mm
  let cards = ()
  let cur = ()
  let curH = 0pt
  for b in u.blocks {
    let bh = measure(box(width: bodyW, b)).height + gap
    if curH + bh > avail and cur.len() > 0 { cards.push(cur); cur = (); curH = 0pt }
    cur.push(b); curH += bh
  }
  if cur.len() > 0 or cards.len() == 0 { cards.push(cur) }
  let railitems = u.rail.map(p => railcell(p.at(0), p.at(1)))
  if u.invuln != none {
    if invBottom { railitems.push(invcell(u.invuln)) } else {
      let svi = u.rail.position(p => p.at(0) == "Sv")
      railitems.insert(if svi == none { railitems.len() } else { svi + 1 }, invcell(u.invuln))
    }
  }
  let rail = box(width: railW, height: 100%, inset: (left: 1.3mm, right: 0.3mm, top: 1mm, bottom: 1mm),
    align(top, stack(dir: ttb, spacing: 1.6mm, ..railitems)))
  let n = cards.len()
  cards.enumerate().map(pair => {
    let i = pair.at(0)
    let bodyblock = block(width: 100%, inset: (x: ipad, top: 0.8mm, bottom: ipad), stack(spacing: gap, ..pair.at(1)))
    cardframe(cw, ch, round: round, {
      grid(rows: (auto, 1fr),
        header,
        if i == 0 { grid(columns: (railW, 1fr), rail, bodyblock) } else { bodyblock },
      )
      if n > 1 { place(top + right, dx: -1mm, dy: 1mm, box(fill: accent, inset: (x: 2.5pt, y: 0.8pt), radius: 2pt, text(size: 5pt, fill: onaccent, weight: "bold", str(i + 1) + "/" + str(n)))) }
    })
  })
}
`;
}

// --- block builders (JS -> Typst content expressions) ----------------------
const arrayLit = (arr) => `(${arr.join(', ')}${arr.length === 1 ? ',' : ''})`;
const statPairs = (view) => arrayLit(view.stats.map(([l, v]) => `(${ts(l)}, ${ts(v)})`));
const kwArr = (view) => (view.keywords ? view.keywords.split(',').map((s) => s.trim()).filter(Boolean) : []);
const chipsCall = (view) => `chips(${arrayLit(kwArr(view).map(ts))})`;

// Weapon keywords: uppercased, optionally bracketed ([BLAST, TORRENT]).
const fmtKw = (kw, mode) => {
  if (!kw) return '';
  const up = kw.toUpperCase();
  return mode === 'brackets' ? `[${up}]` : up;
};
// `fn` is the Typst weapon-row function (wrowflush / wrowtag / …).
const weaponBlock = (w, fn, kwMode) =>
  `${fn}(${ts(w.kind)}, ${ts(w.name)}, ${ts(w.range)}, ${ts(w.a)}, ${ts(w.skill)}, ${ts(w.s)}, ${ts(w.ap)}, ${ts(w.d)}, ${ts(fmtKw(w.kw, kwMode))})`;

function abilityBlocks(view) {
  const out = [];
  if (view.core.length) out.push(`abil(${ts('Core')}, ${ts(view.core.join(', '))})`);
  if (view.faction.length) out.push(`abil(${ts('Faction')}, ${ts(view.faction.join(', '))})`);
  for (const a of view.abilities) out.push(`abil(${ts(a.name)}, ${ts(clean(a.text))})`);
  return out;
}

// Enhancements as their own accent-colored blocks (kept separate from abilities).
function enhancementBlocks(view) {
  return (view.enhancements || []).map((e) => {
    const name = e.points != null ? `${e.name} (${e.points} pts)` : e.name;
    return `enh(${ts(name)}, ${ts(clean(e.text || ''))})`;
  });
}

// Shared flowing-block list: weapons (via `fn`), then abilities, then a labelled
// Enhancements section (separate from abilities). `headings` toggles the
// WEAPONS / ABILITIES section labels (off for now — the no-headings look).
function bodyBlocks(view, fn = 'wrow', kwMode = 'caps', headings = false) {
  const blocks = [];
  const wb = view.weapons.map((wp) => weaponBlock(wp, fn, kwMode));
  const ab = abilityBlocks(view);
  const eb = enhancementBlocks(view);
  if (wb.length) { if (headings) blocks.push(`seclabel(${ts('Weapons')})`); blocks.push(...wb); }
  if (wb.length && (ab.length || eb.length)) blocks.push('hardline'); // rule below the weapon list
  if (ab.length) { if (headings) blocks.push(`seclabel(${ts('Abilities')})`); blocks.push(...ab); }
  if (eb.length) {
    // Always label the enhancements so they're clearly set apart from abilities.
    blocks.push(`seclabel(${ts(eb.length === 1 ? 'Enhancement' : 'Enhancements')})`);
    blocks.push(...eb);
  }
  return arrayLit(blocks);
}

// Full-bleed card frame: header spans edge-to-edge (colored areas bleed); the
// flowing body gets horizontal padding. (i+1)/n badge when a unit spans cards.
const fbFrame = (pad = 'pad') => `(i, n, header, body) => {
    cardframe(cardW, cardH, {
      if header != none { header }
      block(width: 100%, inset: (x: ${pad}, top: 0.8mm, bottom: ${pad}), body)
      if n > 1 { place(top + right, dx: -1mm, dy: 1mm, box(fill: accent, inset: (x: 2.5pt, y: 0.8pt), radius: 2pt, text(size: 5pt, fill: onaccent, weight: "bold", str(i + 1) + "/" + str(n)))) }
    })
    v(3.5mm)
  }`;

// Style 1 — stat coins connected to (overlapping) the header; grey keyword band.
function s1(view, w, h, blocksLit) {
  const kws = kwArr(view);
  const header = `{
    stack(spacing: 0pt, titlebar(${ts(view.title)}, 10pt)${kws.length ? `, kwband(${ts(view.keywords)})` : ''})
    v(-3.4mm)
    block(width: 100%, inset: (x: pad), statcoins(${statPairs(view)}))
  }`;
  return `#{
  let cardW = ${w}mm
  let cardH = ${h}mm
  let pad = 3.2mm
  let gap = 2.2pt
  let frame = ${fbFrame()}
  packcards(cardW - 2mm, ${header}, cardW - 2mm - 2 * pad, cardH - 2mm - pad - 0.8mm, gap, ${blocksLit}, frame)
}`;
}

// Style 3 — full-bleed title, keyword band directly beneath, then a stat bar.
function s3(view, w, h, blocksLit) {
  const kws = kwArr(view);
  const header = `{
    stack(spacing: 0pt, titlebar(${ts(view.title)}, 10pt)${kws.length ? `, kwband(${ts(view.keywords)})` : ''})
    block(width: 100%, inset: (x: pad, top: 1.4mm), statbar(${statPairs(view)}))
  }`;
  return `#{
  let cardW = ${w}mm
  let cardH = ${h}mm
  let pad = 3.2mm
  let gap = 2.2pt
  let frame = ${fbFrame()}
  packcards(cardW - 2mm, ${header}, cardW - 2mm - 2 * pad, cardH - 2mm - pad - 0.8mm, gap, ${blocksLit}, frame)
}`;
}

// Style 4 — Poster: full-bleed title, oversized stat numerals (type below).
function s4(view, w, h, blocksLit) {
  const kws = kwArr(view);
  const cols = view.stats.map(() => '1fr').join(', ');
  const cells = view.stats
    .map(([l, v]) => `align(center)[#text(size: 13pt, weight: "bold")[${mk(v)}]#linebreak()#text(size: 5.5pt, fill: faint)[${mk(l)}]]`)
    .join(', ');
  const header = `{
    stack(spacing: 0pt, titlebar(${ts(view.title)}, 15pt)${kws.length ? `, kwband(${ts(view.keywords)})` : ''})
    block(width: 100%, inset: (x: pad, top: 2mm), grid(columns: (${cols}), column-gutter: 1mm, ${cells}))
  }`;
  return `#{
  let cardW = ${w}mm
  let cardH = ${h}mm
  let pad = 4.2mm
  let gap = 2.6pt
  let frame = ${fbFrame()}
  packcards(cardW - 2mm, ${header}, cardW - 2mm - 2 * pad, cardH - 2mm - pad - 0.8mm, gap, ${blocksLit}, frame)
}`;
}

// Style 5 — Compact: thin full-bleed title + inline stat line, tight padding.
function s5(view, w, h, blocksLit) {
  const kws = kwArr(view);
  const inlineStats = view.stats.map(([l, v]) => `*${l}* ${v}`).join('  ');
  const header = `{
    stack(spacing: 0pt, titlebar(${ts(view.title)}, 8pt)${kws.length ? `, kwband(${ts(view.keywords)})` : ''})
    block(width: 100%, inset: (x: pad, top: 0.8mm), text(size: 6.4pt)[${inlineStats}])
  }`;
  return `#{
  set text(size: 6.8pt)
  let cardW = ${w}mm
  let cardH = ${h}mm
  let pad = 2.4mm
  let gap = 1.6pt
  let frame = ${fbFrame()}
  packcards(cardW - 2mm, ${header}, cardW - 2mm - 2 * pad, cardH - 2mm - pad - 0.8mm, gap, ${blocksLit}, frame)
}`;
}

// Style 2 — Left stat rail (number on top, type below), full-bleed accent rail.
function s2(view, w, h, blocksLit) {
  const kws = kwArr(view);
  const railCells = view.stats.map(([l, v]) => `railcell(${ts(l)}, ${ts(v)})`).join(', ');
  const header = `{
    stack(spacing: 0pt,
      block(width: 100%, inset: (x: ipad, top: ipad, bottom: 0.8mm), text(weight: "bold", size: 9.5pt, ${ts(view.title)}))${kws.length ? `,
      kwband(${ts(view.keywords)})` : ''})
  }`;
  return `#{
  let cardW = ${w}mm
  let cardH = ${h}mm
  let railW = 12mm
  let ipad = 2.6mm
  let gap = 2pt
  let frame = (i, n, header, body) => {
    let content = box(width: 100%, height: 100%, {
      if header != none { header }
      block(width: 100%, inset: (x: ipad, top: 0.8mm, bottom: ipad), body)
      if n > 1 { place(bottom + right, dx: -1mm, dy: -1mm, text(size: 5pt, fill: faint, str(i + 1) + "/" + str(n))) }
    })
    cardframe(cardW, cardH,
      if i == 0 {
        grid(columns: (railW, 1fr),
          box(width: railW, height: 100%, fill: accent, inset: (x: 1mm, y: 3mm), stack(dir: ttb, spacing: 1.2mm, ${railCells})),
          content,
        )
      } else { content })
    v(3.5mm)
  }
  packcards(cardW - 2mm - railW, ${header}, cardW - 2mm - railW - 2 * ipad, cardH - 2mm - 2 * ipad, gap, ${blocksLit}, frame)
}`;
}

// Style 6 — main stats pinned to the bottom of the card (first card only),
// like Magic power/toughness. Continuation cards have no bottom bar.
function s6(view, w, h, blocksLit) {
  const kws = kwArr(view);
  const header = `{
    stack(spacing: 0pt, titlebar(${ts(view.title)}, 10pt)${kws.length ? `, kwband(${ts(view.keywords)})` : ''})
  }`;
  return `#{
  let cardW = ${w}mm
  let cardH = ${h}mm
  let pad = 3.2mm
  let gap = 2.2pt
  let footer = block(width: 100%, fill: luma(238), stroke: (top: 0.6pt + luma(180)), inset: (x: pad, y: 1.6mm), statbar(${statPairs(view)}))
  let frame = (i, n, header, body) => {
    cardframe(cardW, cardH, {
      if header != none { header }
      block(width: 100%, inset: (x: pad, top: 0.8mm), body)
      if i == 0 { place(bottom, footer) }
      if n > 1 { place(top + right, dx: -1mm, dy: 1mm, box(fill: accent, inset: (x: 2.5pt, y: 0.8pt), radius: 2pt, text(size: 5pt, fill: onaccent, weight: "bold", str(i + 1) + "/" + str(n)))) }
    })
    v(3.5mm)
  }
  packcards(cardW - 2mm, ${header}, cardW - 2mm - 2 * pad, cardH - 2mm - 0.8mm, gap, ${blocksLit}, frame, firstReserve: 11mm)
}`;
}

// Weapon stats standardized on the flush pipe treatment across all styles, so
// the comparison is now purely about layout (header/stat arrangement).
// Odd styles use flush weapon rows (no marker); even styles add the R/M oval,
// so both weapon treatments are visible side by side.
// Style 7 — like Style 2 but the accent rail starts BELOW the full-width
// title + keyword band, and (like Style 2) only on the first card.
function s7(view, w, h, blocksLit, opts = {}) {
  const kws = kwArr(view);
  const railCells = view.stats.map(([l, v]) => `railcell(${ts(l)}, ${ts(v)})`).join(', ');
  const railFill = opts.railBg === 'grey' ? 'luma(233)' : 'none';
  const invItem = view.invuln ? `, invcell(${ts(view.invuln)})` : ''; // last in the rail lineup
  const header = `{
    stack(spacing: 0pt, titlebar(${ts(view.title)}, 10pt)${kws.length ? `, kwband(${ts(view.keywords)})` : ''})
  }`;
  return `#{
  let cardW = ${w}mm
  let cardH = ${h}mm
  let railW = 10mm
  let ipad = 2.6mm
  let gap = 2pt
  let frame = (i, n, header, body) => {
    let bodyblock = block(width: 100%, inset: (x: ipad, top: 0.8mm, bottom: ipad), body)
    cardframe(cardW, cardH, {
      grid(rows: (auto, 1fr),
        if header != none { header } else { [] },
        if i == 0 {
          grid(columns: (railW, 1fr),
            box(width: railW, height: 100%, fill: ${railFill}, inset: (left: 1.3mm, right: 0.3mm, top: 1mm, bottom: 1mm),
              align(top, stack(dir: ttb, spacing: 1.6mm, ${railCells}${invItem}))),
            bodyblock,
          )
        } else { bodyblock },
      )
      if n > 1 { place(top + right, dx: -1mm, dy: 1mm, box(fill: accent, inset: (x: 2.5pt, y: 0.8pt), radius: 2pt, text(size: 5pt, fill: onaccent, weight: "bold", str(i + 1) + "/" + str(n)))) }
    })
    v(3.5mm)
  }
  packcards(cardW - 2mm, ${header}, cardW - 2mm - railW - 2 * ipad, cardH - 2mm - 2 * ipad, gap, ${blocksLit}, frame)
}`;
}

// All three designs share the Style-7 layout (rail below keywords, grey rail,
// stat boxes, R/M oval, invuln shield) and differ only by the title font.
const STYLES = {
  1: { name: 'Cards (Anton title)', build: s7, wm: 'wrowtag', kwMode: 'caps', font: 'Anton' },
};

export function styleList() {
  return Object.entries(STYLES).map(([id, s]) => ({ id: Number(id), name: s.name }));
}

// Typst body for one unit's cards in the given style (calls the packer).
export function renderUnitCards(view, styleId, w, h) {
  const s = STYLES[styleId] || STYLES[1];
  return s.build(view, w, h, bodyBlocks(view, s.wm, s.kwMode), s);
}

// A full standalone Typst doc: one unit's cards stacked vertically (auto height).
export function renderStyleDoc(view, styleId, sizeKey, accentHex) {
  const s = STYLES[styleId] || STYLES[1];
  const { w, h } = CARD_SIZES[sizeKey] || CARD_SIZES.standard;
  return `${preamble(accentHex, s.font || 'Chakra Petch')}
#set page(width: ${w + 16}mm, height: auto, margin: 8mm)

${renderUnitCards(view, styleId, w, h)}
`;
}

// --- data-driven rendering (single Anton design) for the main app ----------
const PAPER_MM = { 'us-letter': [215.9, 279.4], a4: [210, 297] };

// A Typst dict describing one unit for makecards().
function unitDict(view) {
  const rail = `(${view.stats.map(([l, v]) => `(${ts(l)}, ${ts(v)})`).join(', ')})`;
  return `(title: ${ts(view.title)}, keywords: ${ts(view.keywords)}, rail: ${rail}, invuln: ${view.invuln ? ts(view.invuln) : 'none'}, blocks: ${bodyBlocks(view, 'wrowtag', 'caps')})`;
}

// One unit's cards, stacked on an auto-height page — for the per-card preview
// (rounded corners).
export function previewUnitDoc(view, sizeKey, accentHex, opts = {}) {
  const { w, h } = CARD_SIZES[sizeKey] || CARD_SIZES.standard;
  const inv = opts.invBottom ? 'true' : 'false';
  return `${preamble(accentHex, 'Anton')}
#set page(width: ${w + 8}mm, height: auto, margin: 4mm)
#context {
  stack(dir: ttb, spacing: 4mm, ..makecards(${unitDict(view)}, ${w}mm, ${h}mm, round: true, invBottom: ${inv}))
}
`;
}

// Selected units' cards imposed onto the print sheet: uniform butt-cut grid,
// centered, with short cut ticks in the outer margins at each gridline.
export function imposeDoc(views, sizeKey, paperKey, accentHex, opts = {}) {
  const { w, h } = CARD_SIZES[sizeKey] || CARD_SIZES.standard;
  const [pw, ph] = PAPER_MM[paperKey] || PAPER_MM['us-letter'];
  const units = views.map(unitDict).join(',\n    ');
  const inv = opts.invBottom ? 'true' : 'false';
  // Army-summary card copies (0/1/2). The summary is DESIGNED landscape (wide
  // table); in the PDF it's rotated 90° into a portrait cell so the physical
  // card cuts like the others but the text reads landscape. Rotation via place
  // in a fixed cw×ch box (no reflow — the most compatible form).
  const copies = Math.max(0, Math.min(2, opts.summaryCopies || 0));
  const summaryLit = (opts.army && copies > 0)
    ? summaryCardsLit(opts.army, w, h, false, { showPoints: opts.showPoints }) // landscape, square corners
    : '()';
  return `${preamble(accentHex, 'Anton')}
#set page(width: ${pw}mm, height: ${ph}mm, margin: 0pt)
#context {
  let cw = ${w}mm
  let ch = ${h}mm
  let all = ()
  // Landscape summary card(s) rotated into portrait cells; repeated once per
  // requested copy (the extra copy is for your opponent).
  let summary = (${summaryLit}).map(c => box(width: cw, height: ch, clip: true, place(center + horizon, rotate(90deg, c))))
  for _c in range(${copies}) { all = all + summary }
  for u in (${units}) { all = all + makecards(u, cw, ch, round: false, invBottom: ${inv}) }
  let cols = calc.max(1, calc.floor(${pw}mm / cw))
  let rows = calc.max(1, calc.floor(${ph}mm / ch))
  let per = cols * rows
  let mx = (${pw}mm - cols * cw) / 2
  let my = (${ph}mm - rows * ch) / 2
  let tick = 0.3pt + accent
  let pages = calc.ceil(all.len() / per)
  for p in range(pages) {
    let chunk = all.slice(p * per, calc.min((p + 1) * per, all.len()))
    place(top + left, dx: mx, dy: my,
      grid(columns: (cw,) * cols, rows: (ch,) * rows, column-gutter: 0pt, row-gutter: 0pt, ..chunk))
    for k in range(cols + 1) {
      let x = mx + k * cw
      place(top + left, dx: x, dy: my - 3mm, line(length: 2.5mm, angle: 90deg, stroke: tick))
      place(top + left, dx: x, dy: my + rows * ch + 0.5mm, line(length: 2.5mm, angle: 90deg, stroke: tick))
    }
    for k in range(rows + 1) {
      let y = my + k * ch
      place(top + left, dx: mx - 3mm, dy: y, line(length: 2.5mm, stroke: tick))
      place(top + left, dx: mx + cols * cw + 0.5mm, dy: y, line(length: 2.5mm, stroke: tick))
    }
    if p < pages - 1 { pagebreak() }
  }
}
`;
}

// Cards available for selection, one per datasheet group: [{ index, name }].
export function unitList(army) {
  return cardGroups(army).map((g, i) => ({ index: i, name: g.unit.name }));
}

// --- army summary card ------------------------------------------------------
// A stat table of every unit, mirroring Standard's roster table: units are
// de-duplicated (leading count column only when some appear in multiples),
// alternate profiles show as indented italic rows, subset keywords follow the
// name after an em-dash, the Pts column is optional, and rows are alphabetized.
// Two layouts share this model: LANDSCAPE for the on-screen preview, and a
// PORTRAIT card (header at top, like the unit cards) for the imposed PDF.
const SUMMARY_STAT_KEYS = ['M', 'T', 'Sv', 'InSv', 'W', 'LD', 'OC'];

// Font sizes (pt) for the landscape summary table.
const SUMMARY_SIZE = {
  landscape: { name: 6.2, kw: 5, cell: 6.2, secName: 6, secCell: 6, header: 5.5, inset: 3 },
};

// Build the shared table model (columns + rows) for the army summary.
function summaryModel(army, opts, S) {
  const showPoints = opts.showPoints !== false;
  const groups = rosterGroups(army.units).sort((a, b) =>
    a.unit.name.localeCompare(b.unit.name, undefined, { sensitivity: 'base' }));
  const showCount = groups.some((g) => g.count > 1);
  const meta = [
    army.meta.faction, army.meta.detachment, army.meta.battleSize,
    army.meta.points != null ? `${army.meta.points} pts` : '',
    `${groups.length} datasheet${groups.length === 1 ? '' : 's'}`,
  ].filter(Boolean).join('  ·  ');

  const cols = [
    ...(showCount ? ['#'] : []), 'Unit', 'M', 'T', 'Sv', 'Inv', 'W', 'Ld', 'OC',
    ...(showPoints ? ['Pts'] : []),
  ];
  const colSpec = [
    ...(showCount ? ['auto'] : []), '1fr', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto',
    ...(showPoints ? ['auto'] : []),
  ];
  const alignSpec = [
    ...(showCount ? ['center'] : []), 'left', 'center', 'center', 'center', 'center', 'center', 'center', 'center',
    ...(showPoints ? ['center'] : []),
  ];
  const headerRow = cols
    .map((c) => `table.cell(fill: accent)[#text(fill: onaccent, weight: "bold", size: ${S.header}pt)[${mk(c)}]]`)
    .join(', ');

  const nameCell = (u) => {
    const models = u.models > 1 ? ` (${u.models})` : '';
    const kw = subsetKeywords(u.keywords || []);
    const tail = kw.length
      ? ` #text(fill: luma(130), size: ${S.kw}pt, weight: "regular")[— ${mk(kw.join(', ').toUpperCase())}]`
      : '';
    return `[#text(size: ${S.name}pt, weight: "bold")[${mk(u.name + models)}]${tail}]`;
  };

  const rows = [];
  for (const g of groups) {
    const u = g.unit;
    const { main, secondary } = splitProfiles(u);
    const chars = main ? main.chars : {};
    rows.push([
      ...(showCount ? [`[#text(size: ${S.cell}pt)[${mk(String(g.count))}]]`] : []),
      nameCell(u),
      ...SUMMARY_STAT_KEYS.map((k) => `[#text(size: ${S.cell}pt)[${mk(statVal(chars, k) || '—')}]]`),
      ...(showPoints ? [`[#text(size: ${S.cell}pt)[${mk(u.points != null ? String(u.points) : '—')}]]`] : []),
    ].join(', '));
    for (const s of secondary) {
      rows.push([
        ...(showCount ? ['[]'] : []),
        `[#h(0.6em)#text(size: ${S.secName}pt, fill: luma(110), style: "italic")[${mk(s.name)}]]`,
        ...SUMMARY_STAT_KEYS.map((k) => `[#text(size: ${S.secCell}pt, fill: luma(110))[${mk(statVal(s.chars, k) || '—')}]]`),
        ...(showPoints ? ['[]'] : []),
      ].join(', '));
    }
  }
  return { meta, colSpec, alignSpec, headerRow, rows, inset: S.inset };
}

function summaryTableExpr(model, chunk) {
  return `table(
      columns: (${model.colSpec.join(', ')}),
      align: (${model.alignSpec.join(', ')}),
      inset: (x: ${model.inset}pt, y: 1.4pt), stroke: 0.3pt + luma(215),
      fill: (_, r) => if r != 0 and calc.odd(r) { luma(245) },
      ${model.headerRow},
      ${chunk.map((r) => `      ${r},`).join('\n')}
    )`;
}

function chunkRows(rows, perCard) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += perCard) chunks.push(rows.slice(i, i + perCard));
  if (!chunks.length) chunks.push([]);
  return chunks;
}

// LANDSCAPE cards for the on-screen preview (width = portrait height). Overflows
// onto extra cards; each repeats the army header.
function summaryCardsLit(army, cw, ch, round = true, opts = {}) {
  const lw = ch, lh = cw;
  const model = summaryModel(army, opts, SUMMARY_SIZE.landscape);
  const perCard = Math.max(4, Math.floor((lh - 20) / 3.4));
  const cards = chunkRows(model.rows, perCard).map((chunk) => `cardframe(${lw}mm, ${lh}mm, round: ${round}, {
      block(width: 100%, fill: accent, inset: (x: 3mm, y: 1.6mm), {
        text(font: titlefont, fill: onaccent, weight: 700, size: 13pt, ${ts(army.meta.name)})
        linebreak()
        text(fill: onaccent, size: 6pt, ${ts(model.meta)})
      })
      block(width: 100%, inset: (x: 2.5mm, top: 1.5mm, bottom: 2mm), ${summaryTableExpr(model, chunk)})
    })`);
  return `(${cards.join(',\n    ')}${cards.length === 1 ? ',' : ''})`;
}

// Standalone preview doc for the army-summary card(s), stacked (landscape).
export function summaryCardDoc(army, sizeKey, accentHex, opts = {}) {
  const { w, h } = CARD_SIZES[sizeKey] || CARD_SIZES.standard;
  const cards = summaryCardsLit(army, w, h, true, opts);
  return `${preamble(accentHex, 'Anton')}
#set page(width: ${h + 8}mm, height: auto, margin: 4mm)
#stack(dir: ttb, spacing: 4mm, ..(${cards}))
`;
}

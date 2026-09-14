// Shared helpers for Typst-emitting renderers. Pure JS (browser-safe): no
// Node imports, no I/O — renderers return a Typst source string.

// Faction accent colors (header bar / borders). Chosen dark enough that white
// bold text stays readable on them. Matched case-insensitively; the first key
// found as a substring of the army's faction wins, else DEFAULT_ACCENT.
export const FACTION_COLORS = {
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
  'adepta sororitas': '#6b1f2b',
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
export const DEFAULT_ACCENT = '#c8102e';

export function accentFor(faction) {
  const f = (faction || '').toLowerCase();
  if (FACTION_COLORS[f]) return FACTION_COLORS[f];
  for (const key of Object.keys(FACTION_COLORS)) {
    if (f.includes(key)) return FACTION_COLORS[key];
  }
  return DEFAULT_ACCENT;
}

// A palette of faction / sub-faction "true" colors for the card color picker.
// Cards use contrast-aware text, so light colors (e.g. Imperial Fists yellow)
// stay readable — unlike accentFor(), which is tuned for white-on-color headers.
// Ordered for the dropdown; longer/more-specific names first so substring
// matching prefers a chapter over its parent.
export const FACTION_PALETTE = [
  { name: 'Ultramarines', color: '#0d407f' },
  { name: 'Imperial Fists', color: '#f0c018' },
  { name: 'Crimson Fists', color: '#2b3a6b' },
  { name: 'Blood Angels', color: '#9a1115' },
  { name: 'Dark Angels', color: '#14432a' },
  { name: 'Space Wolves', color: '#5f7686' },
  { name: 'Salamanders', color: '#1c5b3a' },
  { name: 'Raven Guard', color: '#20242a' },
  { name: 'White Scars', color: '#c9ccce' },
  { name: 'Iron Hands', color: '#2b2f33' },
  { name: 'Black Templars', color: '#141414' },
  { name: 'Deathwatch', color: '#26292e' },
  { name: 'Grey Knights', color: '#49585f' },
  { name: 'Adeptus Custodes', color: '#b8912b' },
  { name: 'Adepta Sororitas', color: '#6b1f2b' },
  { name: 'Astra Militarum', color: '#4a5230' },
  { name: 'Adeptus Mechanicus', color: '#7a1f1f' },
  { name: 'Imperial Knights', color: '#3a3f57' },
  { name: 'Space Marines', color: '#0d407f' },
  { name: 'Death Guard', color: '#6b6f39' },
  { name: 'Thousand Sons', color: '#1f6b6b' },
  { name: "World Eaters", color: '#8a1a1a' },
  { name: "Emperor's Children", color: '#7a2b6b' },
  { name: 'Word Bearers', color: '#6b1f1f' },
  { name: 'Black Legion', color: '#1a1a1a' },
  { name: 'Chaos Knights', color: '#2b2b3a' },
  { name: 'Chaos Space Marines', color: '#3f2b2b' },
  { name: 'Chaos Daemons', color: '#5a2b2b' },
  { name: 'Orks', color: '#4c7a2c' },
  { name: 'Drukhari', color: '#3a2b4f' },
  { name: 'Aeldari', color: '#2b6b8f' },
  { name: 'Ynnari', color: '#4a2b5a' },
  { name: 'Necrons', color: '#2f6b4f' },
  { name: 'Tyranids', color: '#5a2b6b' },
  { name: 'Genestealer Cults', color: '#6b2b5a' },
  { name: "T'au Empire", color: '#8a5a1f' },
  { name: 'Leagues of Votann', color: '#7a5a1f' },
];

// The true palette color for a faction (substring match), or null if unknown.
export function paletteColorFor(faction) {
  const f = (faction || '').toLowerCase();
  const hit = FACTION_PALETTE.find((e) => f.includes(e.name.toLowerCase()));
  return hit ? hit.color : null;
}

// Accent resolution shared by all renderers: an explicit #hex from the color
// option wins, else the faction's true palette color, else the readability-tuned
// faction accent. Renderers that put white-on-accent text should pair this with
// a contrast-aware text color (see `onaccent` in the preambles).
export function resolveAccent(options, army) {
  const a = options && options.accent;
  if (typeof a === 'string' && /^#[0-9a-fA-F]{6}$/.test(a)) return a;
  const faction = army && army.meta && army.meta.faction;
  return paletteColorFor(faction) || accentFor(faction);
}

// --- roster/summary table helpers (shared by Standard + Cards summary) ------
// Unit keywords worth surfacing next to the name in the roster/summary tables.
export const SUBSET_KEYWORDS = [
  'infantry', 'swarm', 'beast', 'monster', 'vehicle', 'psyker',
  'character', 'fly', 'titanic', 'mounted',
];
export function subsetKeywords(keywords) {
  const seen = new Set();
  const out = [];
  for (const k of keywords || []) {
    const lc = String(k).toLowerCase();
    if (SUBSET_KEYWORDS.includes(lc) && !seen.has(lc)) { seen.add(lc); out.push(k); }
  }
  return out;
}

// The main profile is the bulk trooper, whose name matches the unit (e.g.
// "Warbiker" for "Warbikers"); leader/variant profiles are secondary. Match
// exact, then singular, then name-is-a-prefix, else first. Alternate profiles
// whose characteristics are identical to the main profile (e.g. a "Warbiker
// Nob" statted the same as "Warbiker") are dropped — they add nothing to the
// list — as are duplicate alternates.
export function splitProfiles(u) {
  if (!u.stats || !u.stats.length) return { main: null, secondary: [] };
  const nameLc = u.name.toLowerCase();
  const singular = nameLc.replace(/s$/, '');
  const main =
    u.stats.find((s) => s.name.toLowerCase() === nameLc) ||
    u.stats.find((s) => s.name.toLowerCase() === singular) ||
    u.stats.find((s) => nameLc.startsWith(s.name.toLowerCase())) ||
    u.stats[0];
  const mainSig = JSON.stringify(main.chars);
  const seen = new Set([mainSig]);
  const secondary = [];
  for (const s of u.stats) {
    if (s === main) continue;
    const sig = JSON.stringify(s.chars);
    if (seen.has(sig)) continue; // identical to the main (or an earlier) profile
    seen.add(sig);
    secondary.push(s);
  }
  return { main, secondary };
}

// Group units that share a datasheet identity but differ only by enhancement
// into one entry, merging their enhancements. Units are identical in every
// other respect (name, models, stats, weapons, abilities, keywords) — parse.js
// has already collapsed fully-identical units (with a count), so this mainly
// merges enhancement variants of the same datasheet. Order is preserved.
export function datasheetGroups(units) {
  const map = new Map();
  const order = [];
  for (const u of units) {
    const sig = JSON.stringify({
      name: u.name, models: u.models, stats: u.stats,
      ranged: u.ranged, melee: u.melee, abilities: u.abilities,
      keywords: u.keywords, core: u.core, faction: u.faction,
    });
    const enh = u.enhancement ? [u.enhancement] : [];
    const g = map.get(sig);
    if (g) {
      g.count += u.count || 1;
      for (const e of enh) if (!g.enhancements.some((x) => x.name === e.name)) g.enhancements.push(e);
    } else {
      const ng = { unit: u, count: u.count || 1, enhancements: [...enh] };
      map.set(sig, ng);
      order.push(ng);
    }
  }
  return order;
}

// Group units that render identically in a table (same name/models/points/
// stats), summing their counts.
export function rosterGroups(units) {
  const map = new Map();
  const order = [];
  for (const u of units) {
    const sig = JSON.stringify({ name: u.name, models: u.models, points: u.points, stats: u.stats });
    const g = map.get(sig);
    if (g) g.count += u.count || 1;
    else { const ng = { unit: u, count: u.count || 1 }; map.set(sig, ng); order.push(ng); }
  }
  return order;
}

// Clean rules/ability text: drop nbsp, strip the dataset's **/^^ markup, strip
// wrapping quotes, collapse whitespace.
export function clean(s) {
  return String(s ?? '')
    .replace(/ /g, ' ')
    .replace(/[\^*~]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
}

// De-shout ALL-CAPS words (2+ letters) to Title Case; leave already-cased words
// and tokens like "D6" untouched (some catalogues author keywords in caps).
export function deShout(s) {
  return String(s ?? '').replace(/[A-Za-z]+/g, (w) =>
    /^[A-Z]{2,}$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w,
  );
}

// Format a weapon Keywords string: de-shout casing and turn the data's
// conditional shorthand "Lethal Hits: non-Monster/Vehicle" into the clearer
// "Lethal Hits (vs non-Monster/Vehicle)".
export function formatKeywords(raw) {
  const s = deShout(clean(raw));
  if (!s) return s;
  return s
    .split(',')
    .map((part) => {
      const t = part.trim();
      const i = t.indexOf(':');
      if (i === -1) return t;
      return `${t.slice(0, i).trim()} (vs ${t.slice(i + 1).trim()})`;
    })
    .join(', ');
}

// A Typst string LITERAL, e.g. `"foo"`. Use in code/argument positions
// (function args, table cells) where a bare string is a value.
export function ts(s) {
  return '"' + clean(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// Text as MARKUP CONTENT via an evaluated string, e.g. `#"foo"`. Use inside
// `[ ... ]` blocks: a bare `"foo"` there renders its quote characters, but
// `#"foo"` evaluates to the string and renders the text without quotes.
export function mk(s) {
  return '#' + ts(s);
}

// A characteristic value, or null when blank.
export function statVal(chars, key) {
  const v = (chars[key] ?? '').trim();
  return v === '' ? null : v;
}

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

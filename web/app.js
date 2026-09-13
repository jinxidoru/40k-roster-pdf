// Web UI: New Recruit roster JSON -> Typst -> PDF, entirely client-side.
// Local modules (parse/render) are imported statically (fast); the heavy
// typst.ts engine is imported dynamically behind a loading spinner, and the PDF
// regenerates automatically on upload or when any option changes.

import { parseRoster, isNewRecruitRoster } from '../src/parse.js';
import { renderers, byId, defaultRenderer } from '../src/render.js';

const TYPST_VERSION = '0.7.0';
const CDN = `https://cdn.jsdelivr.net/npm`;
const WASM = {
  compiler: `${CDN}/@myriaddreamin/typst-ts-web-compiler@${TYPST_VERSION}/pkg/typst_ts_web_compiler_bg.wasm`,
  renderer: `${CDN}/@myriaddreamin/typst-ts-renderer@${TYPST_VERSION}/pkg/typst_ts_renderer_bg.wasm`,
};
const FONTS = ['Arimo-Regular.ttf', 'Arimo-Bold.ttf', 'Arimo-Italic.ttf', 'Arimo-BoldItalic.ttf']
  .map((f) => new URL(`assets/fonts/${f}`, document.baseURI).href);
const LS_KEY = '40k-roster-pdf/settings';

const $ = (id) => document.getElementById(id);
const els = {
  loading: $('loading'), app: $('app'), drop: $('drop'), file: $('file'), pick: $('pick'),
  renderer: $('renderer'), options: $('options'), status: $('status'),
  summary: $('summary'), print: $('print'), download: $('download'), viewer: $('viewer'),
};

// Print the currently-previewed PDF directly. The blob URL is same-origin, so
// the iframe's built-in PDF viewer can be driven straight to the print dialog.
els.print.onclick = () => {
  els.viewer.contentWindow?.focus();
  els.viewer.contentWindow?.print();
};

const MODULES = {
  snippet: `${CDN}/@myriaddreamin/typst.ts@${TYPST_VERSION}/contrib/snippet/+esm`,
  options: `${CDN}/@myriaddreamin/typst.ts@${TYPST_VERSION}/options.init/+esm`,
};

let worker = null;
let ready = false;
let army = null;
let lastUrl = null;
let latestId = 0; // newest render request; older worker results are ignored

// --- persisted settings ----------------------------------------------------
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
}
function saveSettings() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}
const settings = loadSettings();
settings.options ||= {};

// First-visit page-size default from the user's region (timezone proxy; no
// permission prompt): UK/Europe -> A4, otherwise US Letter.
function defaultPaper() {
  try {
    if (/^Europe\//.test(Intl.DateTimeFormat().resolvedOptions().timeZone || '')) return 'a4';
  } catch { /* ignore */ }
  return 'us-letter';
}

// --- renderer picker -------------------------------------------------------
for (const r of renderers) {
  const opt = document.createElement('option');
  opt.value = r.id;
  opt.textContent = r.name;
  els.renderer.appendChild(opt);
}
els.renderer.value = byId[settings.renderer] ? settings.renderer : defaultRenderer.id;
els.renderer.addEventListener('change', () => {
  settings.renderer = els.renderer.value;
  buildOptions();
  saveSettings();
  regenerate();
});

// --- options UI (from the renderer's schema, values persisted) -------------

// Circular-i glyph carrying an option's longer explanation as a hover/focus
// tooltip (native title). Kept a sibling of the label so it never toggles the
// control it explains.
function infoIcon(text) {
  const span = document.createElement('span');
  span.className = 'info';
  span.title = text;
  span.tabIndex = 0;
  span.setAttribute('aria-label', text);
  span.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>';
  return span;
}

function buildOptions() {
  const r = byId[els.renderer.value] || defaultRenderer;
  els.options.innerHTML = '';
  for (const opt of r.options || []) {
    let val = settings.options[opt.key];
    if (val === undefined) val = opt.key === 'paper' ? defaultPaper() : opt.default;
    settings.options[opt.key] = val;

    const row = document.createElement('div');
    row.className = 'opt';
    const id = `opt-${opt.key}`;

    const name = document.createElement('div');
    name.className = 'opt-name';
    const lbl = document.createElement('label');
    lbl.htmlFor = id;
    lbl.textContent = opt.label;
    name.appendChild(lbl);
    if (opt.help) name.appendChild(infoIcon(opt.help));
    row.appendChild(name);

    if (opt.type === 'select') {
      const sel = document.createElement('select');
      sel.id = id;
      for (const c of opt.choices) {
        const o = document.createElement('option');
        o.value = c.value;
        o.textContent = c.label;
        sel.appendChild(o);
      }
      sel.value = val;
      sel.addEventListener('change', () => {
        settings.options[opt.key] = sel.value;
        saveSettings();
        regenerate();
      });
      row.appendChild(sel);
    } else if (opt.type === 'bool') {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = id;
      cb.checked = !!val;
      cb.addEventListener('change', () => {
        settings.options[opt.key] = cb.checked;
        saveSettings();
        regenerate();
      });
      row.appendChild(cb);
    }
    // future option types (number/color) get their controls here
    els.options.appendChild(row);
  }
}

// --- file intake -----------------------------------------------------------
els.pick.addEventListener('click', () => els.file.click());
els.file.addEventListener('change', () => els.file.files[0] && loadFile(els.file.files[0]));
['dragover', 'dragenter'].forEach((ev) =>
  els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) =>
  els.drop.addEventListener(ev, () => els.drop.classList.remove('over')));
els.drop.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) loadFile(f);
});

async function loadFile(file) {
  try {
    loadRoster(JSON.parse(await file.text()));
  } catch (err) {
    setStatus(`Could not read that file: ${err.message}`, true);
  }
}

function loadRoster(json) {
  if (!isNewRecruitRoster(json)) {
    setStatus('That file is not a New Recruit / BattleScribe roster export (no "roster" section).', true);
    return;
  }
  army = parseRoster(json);
  els.summary.textContent = `${army.meta.name} — ${army.meta.faction} · ${army.meta.detachment} · ${army.meta.points} pts · ${army.units.length} datasheets`;
  // One anonymous event per loaded roster (not per re-render), plus the faction.
  track('pdf-generated');
  track(`faction/${slug(army.meta.faction) || 'unknown'}`);
  regenerate();
}

// Dev-only convenience: ?preload=<name> auto-loads staging/<name> so testing
// doesn't require dropping a file each reload. Localhost only — staging/ is
// gitignored and never deployed, so this is inert on the live site.
function isLocalhost() {
  const h = location.hostname;
  return /^(localhost|127\.|0\.0\.0\.0|::1|\[::1\])/.test(h) || h.endsWith('.local');
}
async function preloadFromQuery() {
  const name = new URLSearchParams(location.search).get('preload');
  if (!name || !isLocalhost()) return;
  const safe = name.replace(/[^\w.\- ]/g, ''); // strip path separators etc.
  try {
    const res = await fetch(`staging/${encodeURIComponent(safe)}`);
    if (!res.ok) { setStatus(`Preload failed: staging/${safe} (HTTP ${res.status})`, true); return; }
    loadRoster(await res.json());
  } catch (err) {
    setStatus(`Preload failed: ${err.message}`, true);
  }
}

// --- typst engine (in a worker) + generation --------------------------------
function initEngine() {
  return new Promise((resolve, reject) => {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onerror = (e) => { console.error('worker.onerror', e); reject(new Error(e.message || 'worker failed to load')); };
    worker.onmessageerror = (e) => console.error('worker.onmessageerror', e);
    const watchdog = setTimeout(() => {
      const p = els.loading.querySelector('p');
      if (p) p.textContent = 'Still loading… open the console (F12) if this persists.';
    }, 20000);
    worker.onmessage = (e) => {
      const m = e.data;
      console.debug('worker →', m.type, m.message || '');
      if (m.type === 'ready') { clearTimeout(watchdog); ready = true; resolve(); return; }
      if (m.type === 'init-error') { clearTimeout(watchdog); reject(new Error(m.message)); return; }
      if (m.id !== latestId) return; // a newer request superseded this result
      if (m.type === 'result') {
        const blob = new Blob([m.bytes], { type: 'application/pdf' });
        if (lastUrl) URL.revokeObjectURL(lastUrl);
        lastUrl = URL.createObjectURL(blob);
        els.viewer.src = lastUrl;
        els.download.href = lastUrl;
        els.download.download = `${army.meta.name}.pdf`;
        els.download.hidden = false;
        els.print.hidden = false;
        setStatus('');
      } else if (m.type === 'error') {
        setStatus(`Failed to generate PDF: ${m.message}`, true);
      }
    };
    worker.postMessage({ type: 'init', modules: MODULES, fonts: FONTS, wasm: WASM });
  });
}

// Rendering the Typst source is cheap (main thread); the compile runs in the
// worker. Each request bumps latestId so an in-flight render is superseded.
function regenerate() {
  if (!army || !ready) return;
  const renderer = byId[els.renderer.value] || defaultRenderer;
  let mainContent;
  try {
    mainContent = renderer.render(army, { ...settings.options });
  } catch (err) {
    setStatus(`Render error: ${err.message || err}`, true);
    return;
  }
  const id = ++latestId;
  worker.postMessage({ type: 'render', id, mainContent });
}

function setStatus(msg, isError = false) {
  els.status.textContent = msg;
  els.status.classList.toggle('error', isError);
}

// Fire an anonymous GoatCounter event (no-op on localhost, where the script
// isn't loaded, so local runs are never counted).
function track(path) {
  if (window.goatcounter && window.goatcounter.count) {
    window.goatcounter.count({ path, title: path, event: true });
  }
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// --- boot: build controls (hidden), load engine, then reveal ---------------
buildOptions();
initEngine()
  .then(() => {
    els.loading.hidden = true;
    els.app.hidden = false;
    preloadFromQuery();
  })
  .catch((err) => {
    els.loading.innerHTML = `<p class="error">Couldn't load the PDF engine: ${err.message || err}</p>`;
  });

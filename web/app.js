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
  summary: $('summary'), download: $('download'), viewer: $('viewer'),
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
function buildOptions() {
  const r = byId[els.renderer.value] || defaultRenderer;
  els.options.innerHTML = '';
  for (const opt of r.options || []) {
    let val = settings.options[opt.key];
    if (val === undefined) val = opt.key === 'paper' ? defaultPaper() : opt.default;
    settings.options[opt.key] = val;

    if (opt.type === 'select') {
      const wrap = document.createElement('label');
      wrap.className = 'opt';
      wrap.append(`${opt.label} `);
      const sel = document.createElement('select');
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
      wrap.appendChild(sel);
      els.options.appendChild(wrap);
    }
    // future option types (bool/number/color) get their controls here
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
    const json = JSON.parse(await file.text());
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
  } catch (err) {
    setStatus(`Could not read that file: ${err.message}`, true);
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
  setStatus('Rendering…');
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
  })
  .catch((err) => {
    els.loading.innerHTML = `<p class="error">Couldn't load the PDF engine: ${err.message || err}</p>`;
  });

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
const FONTS = ['Arimo-Regular.ttf', 'Arimo-Bold.ttf', 'Arimo-Italic.ttf', 'Arimo-BoldItalic.ttf', 'Anton.ttf']
  .map((f) => new URL(`assets/fonts/${f}`, document.baseURI).href);
const LS_KEY = '40k-roster-pdf/settings';

const $ = (id) => document.getElementById(id);
const els = {
  loading: $('loading'), app: $('app'), drop: $('drop'), file: $('file'), pick: $('pick'),
  renderer: $('renderer'), renderOptions: $('render-options'), options: $('options'), status: $('status'),
  summary: $('summary'), print: $('print'), download: $('download'),
  viewer: $('viewer'), printFrame: $('print-frame'), selectAll: $('select-all'),
};

// Select/unselect all cards (per-card renderers only).
els.selectAll.addEventListener('click', () => {
  if (!currentRenderer || !currentRenderer.perCardPreview) return;
  const units = currentRenderer.unitList(army);
  const allSelected = units.every((u) => cardSelection.has(u.index));
  cardSelection.clear();
  if (!allSelected) units.forEach((u) => cardSelection.add(u.index));
  els.viewer.querySelectorAll('.card-item').forEach((item) => {
    const cb = item.querySelector('input');
    cb.checked = cardSelection.has(Number(cb.dataset.idx));
    item.classList.toggle('unchecked', !cb.checked);
  });
  syncSelectAllLabel();
  invalidatePdf();
});

// Preview is SVG (fast). The PDF is compiled lazily — only when the user
// actually downloads or prints — so toggling options only pays for the SVG.
els.print.onclick = async () => {
  try {
    const url = await ensurePdf();
    if (els.printFrame.src === url) {
      els.printFrame.contentWindow?.focus();
      els.printFrame.contentWindow?.print();
    } else {
      els.printFrame.onload = () => {
        els.printFrame.onload = null;
        els.printFrame.contentWindow?.focus();
        els.printFrame.contentWindow?.print();
      };
      els.printFrame.src = url;
    }
  } catch (err) {
    setStatus(`Couldn't build PDF: ${err.message || err}`, true);
  }
};
els.download.addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    const url = await ensurePdf();
    const a = document.createElement('a');
    a.href = url;
    a.download = `${army.meta.name}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    setStatus(`Couldn't build PDF: ${err.message || err}`, true);
  }
});

const MODULES = {
  snippet: `${CDN}/@myriaddreamin/typst.ts@${TYPST_VERSION}/contrib/snippet/+esm`,
  options: `${CDN}/@myriaddreamin/typst.ts@${TYPST_VERSION}/options.init/+esm`,
};

let worker = null;
let ready = false;
let army = null;
let coreGlossary = {}; // bundled core-keyword definitions; {} if src/keywords.json is absent
let currentRenderer = null;
let currentOptions = {};
let previewToken = 0; // supersedes stale single-preview renders
const cardSelection = new Set(); // selected unit indices (perCardPreview renderers)
let currentContent = ''; // Typst source of the single-doc preview (non-card renderers)
let pdfUrl = null; // cached PDF blob URL, or null if stale
let reqId = 0; // shared id space for render + pdf worker requests
const renderWaiters = new Map(); // id -> { resolve, reject } for render -> svg
const pdfWaiters = new Map(); // id -> { resolve, reject } for pdf -> bytes

// Send Typst source to the worker; resolves with the rendered SVG string.
function renderSvg(mainContent) {
  const id = ++reqId;
  return new Promise((resolve, reject) => {
    renderWaiters.set(id, { resolve, reject });
    worker.postMessage({ type: 'render', id, mainContent });
  });
}

function invalidatePdf() {
  if (pdfUrl) { URL.revokeObjectURL(pdfUrl); pdfUrl = null; }
}

// Compile (or reuse) the print PDF on demand. For per-card renderers this
// imposes only the selected cards.
function ensurePdf() {
  if (pdfUrl) return Promise.resolve(pdfUrl);
  let printContent;
  try {
    const opts = { ...currentOptions };
    if (currentRenderer && currentRenderer.perCardPreview) {
      opts.selected = [...cardSelection].sort((a, b) => a - b);
    }
    printContent = currentRenderer.render(army, opts, 'print');
  } catch (err) {
    return Promise.reject(err);
  }
  const id = ++reqId;
  return new Promise((resolve, reject) => {
    pdfWaiters.set(id, { resolve, reject });
    worker.postMessage({ type: 'pdf', id, mainContent: printContent });
  }).then((bytes) => {
    pdfUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    return pdfUrl;
  });
}

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
      // A persisted value that's no longer a valid choice (e.g. an old boolean
      // for an option that became a dropdown) falls back to the default.
      if (!opt.choices.some((c) => c.value === val)) {
        val = opt.default;
        settings.options[opt.key] = val;
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
  army.coreGlossary = coreGlossary;
  cardSelection.clear();
  army.units.forEach((_u, i) => cardSelection.add(i)); // default: all cards selected
  els.renderOptions.hidden = false;
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
// Load the bundled core-keyword definitions. Absent file (removed on purpose)
// or any error → coreGlossary stays {} and the glossary quietly falls back to
// roster-embedded definitions only. Never rejects.
async function loadCoreKeywords() {
  try {
    const res = await fetch('src/keywords.json');
    if (res.ok) coreGlossary = (await res.json()).keywords || {};
  } catch { /* feature simply off */ }
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
      // On-demand PDF replies (own id space; not tied to the latest preview).
      if (m.type === 'pdf-result') {
        const w = pdfWaiters.get(m.id);
        if (w) { pdfWaiters.delete(m.id); w.resolve(m.bytes); }
        return;
      }
      if (m.type === 'pdf-error') {
        const w = pdfWaiters.get(m.id);
        if (w) { pdfWaiters.delete(m.id); w.reject(new Error(m.message)); }
        return;
      }
      if (m.type === 'result') {
        const w = renderWaiters.get(m.id);
        if (w) { renderWaiters.delete(m.id); w.resolve(m.svg); }
        return;
      }
      if (m.type === 'error') {
        const w = renderWaiters.get(m.id);
        if (w) { renderWaiters.delete(m.id); w.reject(new Error(m.message)); }
        return;
      }
    };
    worker.postMessage({ type: 'init', modules: MODULES, fonts: FONTS, wasm: WASM });
  });
}

// Rendering the Typst source is cheap (main thread); the compile runs in the
// worker. previewToken supersedes stale single-preview renders.
function regenerate() {
  if (!army || !ready) return;
  currentRenderer = byId[els.renderer.value] || defaultRenderer;
  currentOptions = { ...settings.options };
  invalidatePdf();
  const token = ++previewToken;
  if (currentRenderer.perCardPreview) renderCards(token);
  else renderSingle(token);
}

// Single-document preview (Standard): one SVG filling the viewer.
function renderSingle(token) {
  els.selectAll.hidden = true;
  els.viewer.classList.remove('cards');
  let mainContent;
  try { mainContent = currentRenderer.render(army, currentOptions); }
  catch (err) { setStatus(`Render error: ${err.message || err}`, true); return; }
  currentContent = mainContent;
  const y = els.viewer.scrollTop;
  renderSvg(mainContent).then((svg) => {
    if (token !== previewToken) return;
    els.viewer.innerHTML = svg;
    markPageBreaks();
    els.viewer.scrollTop = y;
    els.download.hidden = false;
    els.print.hidden = false;
    setStatus('');
  }).catch((err) => { if (token === previewToken) setStatus(`Failed to render: ${err.message || err}`, true); });
}

// Per-card preview (Cards): a grid of individual cards, each with a checkbox.
// Unchecked cards are excluded from the PDF.
function renderCards(token) {
  const units = currentRenderer.unitList(army);
  els.selectAll.hidden = false;
  syncSelectAllLabel();
  els.viewer.classList.add('cards');
  els.viewer.innerHTML = '';
  els.download.hidden = false;
  els.print.hidden = false;
  setStatus('');
  for (const { index, name } of units) {
    const item = document.createElement('div');
    item.className = 'card-item';
    const label = document.createElement('label');
    label.className = 'card-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = cardSelection.has(index);
    cb.dataset.idx = String(index);
    const nm = document.createElement('span');
    nm.className = 'card-name';
    nm.textContent = name;
    label.append(cb, nm);
    const out = document.createElement('div');
    out.className = 'card-out';
    out.textContent = '…';
    item.append(label, out);
    item.classList.toggle('unchecked', !cb.checked);
    els.viewer.appendChild(item);
    cb.addEventListener('change', () => {
      if (cb.checked) cardSelection.add(index); else cardSelection.delete(index);
      item.classList.toggle('unchecked', !cb.checked);
      syncSelectAllLabel();
      invalidatePdf();
    });
    renderSvg(currentRenderer.previewUnit(army, index, currentOptions))
      .then((svg) => { if (token === previewToken) out.innerHTML = svg; })
      .catch((err) => { out.innerHTML = `<pre class="err">${err.message || err}</pre>`; });
  }
}

function syncSelectAllLabel() {
  if (!army || !currentRenderer || !currentRenderer.perCardPreview) return;
  const total = currentRenderer.unitList(army).length;
  els.selectAll.textContent = cardSelection.size >= total ? 'Unselect all' : 'Select all';
}

// Paper dimensions in points (Typst's SVG user units), for locating page breaks.
const PAGE_PT = {
  'us-letter': [612, 792],
  a4: [595.28, 841.89],
  a5: [419.53, 595.28],
};

// typst.ts returns one combined SVG for the whole document, so page boundaries
// aren't visually distinct. Overlay a dashed "Page N" separator at each break,
// positioned from the paper height (purely cosmetic — never touches the render).
function addSep(topPx, label) {
  const sep = document.createElement('div');
  sep.className = 'page-sep';
  sep.style.top = `${topPx}px`;
  sep.dataset.label = label;
  els.viewer.appendChild(sep);
}
function markPageBreaks() {
  els.viewer.querySelectorAll('.page-sep').forEach((e) => e.remove());
  if (els.viewer.classList.contains('cards')) return; // no page markers in card mode
  const svgs = [...els.viewer.querySelectorAll('svg')];
  const base = els.viewer.getBoundingClientRect().top - els.viewer.scrollTop;
  if (svgs.length > 1) {
    // One <svg> per page: a break at the top of each page after the first.
    for (let i = 1; i < svgs.length; i++) {
      addSep(svgs[i].getBoundingClientRect().top - base, `Page ${i + 1}`);
    }
  } else if (svgs.length === 1) {
    // One combined <svg>: split the rendered height by the page count, which we
    // get from the aspect ratio (unit-independent).
    const svg = svgs[0];
    const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    const rect = svg.getBoundingClientRect();
    const [pw, ph] = PAGE_PT[settings.options.paper] || PAGE_PT['us-letter'];
    const pages = vb.length === 4 && vb[2]
      ? Math.max(1, Math.round((vb[3] / vb[2]) / (ph / pw)))
      : 1;
    for (let i = 1; i < pages; i++) {
      addSep(rect.top - base + (i * rect.height) / pages, `Page ${i + 1}`);
    }
  }
}
// Reposition markers when the preview width changes (scale depends on it).
let pageBreakTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(pageBreakTimer);
  pageBreakTimer = setTimeout(markPageBreaks, 150);
});

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

// --- boot: build controls (hidden), load engine + keywords, then reveal -----
buildOptions();
Promise.all([initEngine(), loadCoreKeywords()])
  .then(() => {
    els.loading.hidden = true;
    els.app.hidden = false;
    preloadFromQuery();
  })
  .catch((err) => {
    els.loading.innerHTML = `<p class="error">Couldn't load the PDF engine: ${err.message || err}</p>`;
  });

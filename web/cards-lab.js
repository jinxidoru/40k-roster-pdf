// Dev-only lab: render every card style for a short and a long unit so styles
// can be compared in a browser. Not linked from the app. Localhost only (it
// reads a roster from staging/, which isn't deployed). Reuses web/worker.js.

import { parseRoster, isNewRecruitRoster } from '../src/parse.js';
import { accentFor } from '../src/renderers/shared.js';
import { unitView, renderStyleDoc, styleList, CARD_SIZES } from '../src/renderers/cards-lib.js';

// typst.ts config — mirrors web/app.js.
const TYPST_VERSION = '0.7.0';
const CDN = 'https://cdn.jsdelivr.net/npm';
const WASM = {
  compiler: `${CDN}/@myriaddreamin/typst-ts-web-compiler@${TYPST_VERSION}/pkg/typst_ts_web_compiler_bg.wasm`,
  renderer: `${CDN}/@myriaddreamin/typst-ts-renderer@${TYPST_VERSION}/pkg/typst_ts_renderer_bg.wasm`,
};
// The lab lives in /web/, but assets are at the repo root — resolve fonts there
// (../assets), otherwise they 404 and every font falls back to the same default.
const FONTS = ['Arimo-Regular.ttf', 'Arimo-Bold.ttf', 'Arimo-Italic.ttf', 'Arimo-BoldItalic.ttf', 'Anton.ttf']
  .map((f) => new URL(`../assets/fonts/${f}`, document.baseURI).href);
const MODULES = {
  snippet: `${CDN}/@myriaddreamin/typst.ts@${TYPST_VERSION}/contrib/snippet/+esm`,
  options: `${CDN}/@myriaddreamin/typst.ts@${TYPST_VERSION}/options.init/+esm`,
};

const $ = (id) => document.getElementById(id);
const setStatus = (m) => { $('status').textContent = m; };

// --- worker plumbing (init + a render->svg request map) --------------------
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let reqId = 0;
const waiters = new Map();
let onReady, onReadyErr;
const ready = new Promise((res, rej) => { onReady = res; onReadyErr = rej; });
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'ready') return onReady();
  if (m.type === 'init-error') return onReadyErr(new Error(m.message));
  const w = waiters.get(m.id);
  if (!w) return;
  waiters.delete(m.id);
  if (m.type === 'result') w.resolve(m.svg);
  else if (m.type === 'error') w.reject(new Error(m.message));
};
worker.onerror = (e) => onReadyErr(new Error(e.message || 'worker failed'));
function renderSvg(mainContent) {
  const id = ++reqId;
  return new Promise((resolve, reject) => {
    waiters.set(id, { resolve, reject });
    worker.postMessage({ type: 'render', id, mainContent });
  });
}

// --- roster + unit selection ------------------------------------------------
let army = null;

async function loadRoster() {
  const name = new URLSearchParams(location.search).get('preload') || 'Fishies.json';
  const res = await fetch(`../staging/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`staging/${name} → HTTP ${res.status}`);
  const json = await res.json();
  if (!isNewRecruitRoster(json)) throw new Error('not a New Recruit roster');
  army = parseRoster(json);
  $('roster').textContent = `${army.meta.name} — ${army.meta.faction}`;
}

const contentSize = (u) => u.ranged.length + u.melee.length + u.abilities.length + u.core.length + u.faction.length;

function pickUnits() {
  const sorted = [...army.units].sort((a, b) => contentSize(a) - contentSize(b));
  const picks = [sorted[0], sorted[Math.floor(sorted.length / 2)], sorted[sorted.length - 1]];
  return [...new Set(picks)].filter(Boolean); // up to 3 distinct units
}

// --- render all styles ------------------------------------------------------
async function renderAll() {
  const sizeKey = $('size').value;
  const accent = accentFor(army.meta.faction);
  const units = pickUnits();

  const grid = $('grid');
  grid.innerHTML = '';
  for (const { id, name } of styleList()) {
    const section = document.createElement('section');
    section.className = 'style';
    section.innerHTML = `<h2>Style ${id} — ${name}</h2><div class="pair"></div>`;
    grid.appendChild(section);
    const pair = section.querySelector('.pair');

    for (const unit of units) {
      const col = document.createElement('div');
      col.className = 'col';
      col.innerHTML = `<div class="cap">${unit.name}</div><div class="out">…</div>`;
      pair.appendChild(col);
      try {
        const svg = await renderSvg(renderStyleDoc(unitView(unit), id, sizeKey, accent));
        col.querySelector('.out').innerHTML = svg;
      } catch (err) {
        col.querySelector('.out').innerHTML = `<pre class="err">${String(err.message || err)}</pre>`;
      }
    }
    setStatus(`Rendered style ${id}…`);
  }
  setStatus('Done.');
}

// --- boot -------------------------------------------------------------------
function fillSizes() {
  const sel = $('size');
  for (const [key, s] of Object.entries(CARD_SIZES)) {
    const o = document.createElement('option');
    o.value = key;
    o.textContent = `${s.label} (${s.w}×${s.h}mm)`;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => renderAll().catch((e) => setStatus(String(e))));
}

(async () => {
  fillSizes();
  try {
    setStatus('Loading roster…');
    await loadRoster();
    setStatus('Loading PDF engine…');
    worker.postMessage({ type: 'init', modules: MODULES, fonts: FONTS, wasm: WASM });
    await ready;
    setStatus('Rendering…');
    await renderAll();
  } catch (err) {
    setStatus(`Error: ${err.message || err}`);
  }
})();

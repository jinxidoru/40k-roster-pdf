// Web UI: New Recruit roster JSON -> Typst -> PDF, entirely client-side.
// Reuses the same pure modules as the CLI; Typst compiles via typst.ts (WASM).

// jsDelivr's /+esm build rewrites the snippet's internal *bare* dynamic imports
// (…/contrib/global-compiler, etc.) to resolvable CDN URLs, which a plain
// no-bundler browser can't do with the raw .mjs.
import { $typst, TypstSnippet } from 'https://cdn.jsdelivr.net/npm/@myriaddreamin/typst.ts@0.7.0/contrib/snippet/+esm';
import { parseRoster, isNewRecruitRoster } from '../src/parse.js';
import { renderers, byId, defaultRenderer } from '../src/render.js';

const TYPST_VERSION = '0.7.0';
const WASM = {
  compiler: `https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler@${TYPST_VERSION}/pkg/typst_ts_web_compiler_bg.wasm`,
  renderer: `https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-renderer@${TYPST_VERSION}/pkg/typst_ts_renderer_bg.wasm`,
};
// Bundled font (Arimo) so the sheet's font resolves the same as the CLI. Paths
// are relative to the page (index.html at the site root).
const FONTS = [
  'Arimo-Regular.ttf', 'Arimo-Bold.ttf', 'Arimo-Italic.ttf', 'Arimo-BoldItalic.ttf',
].map((f) => new URL(`assets/fonts/${f}`, document.baseURI).href);

const $ = (id) => document.getElementById(id);
const els = {
  drop: $('drop'), file: $('file'), pick: $('pick'), renderer: $('renderer'),
  options: $('options'), generate: $('generate'), status: $('status'),
  summary: $('summary'), download: $('download'), viewer: $('viewer'),
};

let army = null;      // parsed roster
let typstReady = null; // Promise, initialized on first generate
let lastUrl = null;    // object URL to revoke

// --- renderer picker -------------------------------------------------------
for (const r of renderers) {
  const opt = document.createElement('option');
  opt.value = r.id;
  opt.textContent = r.name;
  els.renderer.appendChild(opt);
}
els.renderer.value = defaultRenderer.id;
els.renderer.addEventListener('change', buildOptions);
buildOptions();

// --- per-renderer options UI (built from the renderer's options schema) -----
function buildOptions() {
  const r = byId[els.renderer.value] || defaultRenderer;
  els.options.innerHTML = '';
  for (const opt of r.options || []) {
    if (opt.type === 'select') {
      const wrap = document.createElement('label');
      wrap.className = 'opt';
      wrap.append(`${opt.label} `);
      const sel = document.createElement('select');
      sel.dataset.key = opt.key;
      for (const c of opt.choices) {
        const o = document.createElement('option');
        o.value = c.value;
        o.textContent = c.label;
        sel.appendChild(o);
      }
      sel.value = opt.default;
      wrap.appendChild(sel);
      els.options.appendChild(wrap);
    }
    // future option types (bool/number/color) get their controls here
  }
}

function collectOptions() {
  const out = {};
  els.options.querySelectorAll('[data-key]').forEach((el) => { out[el.dataset.key] = el.value; });
  return out;
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
  setStatus(`Reading ${file.name}…`);
  try {
    const json = JSON.parse(await file.text());
    if (!isNewRecruitRoster(json)) {
      setStatus('That file is not a New Recruit / BattleScribe roster export (no "roster" section).', true);
      return;
    }
    army = parseRoster(json);
    els.summary.textContent = `${army.meta.name} — ${army.meta.faction} · ${army.meta.detachment} · ${army.meta.points} pts · ${army.units.length} datasheets`;
    els.generate.disabled = false;
    setStatus('Ready. Click “Generate PDF”.');
  } catch (err) {
    setStatus(`Could not read that file: ${err.message}`, true);
  }
}

// --- generate --------------------------------------------------------------
els.generate.addEventListener('click', generate);

function initTypst() {
  if (typstReady) return typstReady;
  $typst.setCompilerInitOptions({
    beforeBuild: FONTS.map((u) => TypstSnippet.preloadFontFromUrl(u)),
    getModule: () => WASM.compiler,
  });
  $typst.setRendererInitOptions({ getModule: () => WASM.renderer });
  typstReady = Promise.resolve();
  return typstReady;
}

async function generate() {
  if (!army) return;
  els.generate.disabled = true;
  setStatus('Loading Typst (first run downloads ~a few MB)…');
  try {
    await initTypst();
    const renderer = byId[els.renderer.value] || defaultRenderer;
    const mainContent = renderer.render(army, collectOptions());
    setStatus('Rendering PDF…');
    const data = await $typst.pdf({ mainContent });
    const blob = new Blob([data], { type: 'application/pdf' });
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(blob);
    els.viewer.src = lastUrl;
    els.download.href = lastUrl;
    els.download.download = `${army.meta.name}.pdf`;
    els.download.hidden = false;
    setStatus('Done.');
  } catch (err) {
    console.error(err);
    setStatus(`Failed to generate PDF: ${err.message || err}`, true);
  } finally {
    els.generate.disabled = false;
  }
}

function setStatus(msg, isError = false) {
  els.status.textContent = msg;
  els.status.classList.toggle('error', isError);
}

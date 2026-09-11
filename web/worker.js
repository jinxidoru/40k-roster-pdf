// Module worker: runs the typst.ts engine off the main thread so the UI stays
// responsive and a newer render request supersedes an older one (the main
// thread ignores results whose id is no longer the latest).

let $typst = null;
let initing = null;

async function ensureInit({ modules, fonts, wasm }) {
  if (initing) return initing;
  initing = (async () => {
    const [snip, init] = await Promise.all([
      import(modules.snippet),
      import(modules.options),
    ]);
    $typst = snip.$typst;
    $typst.setCompilerInitOptions({
      beforeBuild: [init.preloadRemoteFonts(fonts)],
      getModule: () => wasm.compiler,
    });
    $typst.setRendererInitOptions({ getModule: () => wasm.renderer });
    // Warm up: force WASM + font download so the first real render is fast.
    await $typst.pdf({ mainContent: '#set page(width: 20pt, height: 20pt)\n#text(font: "Arimo")[.]' });
  })();
  return initing;
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      await ensureInit(m);
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'init-error', message: String((err && err.message) || err) });
    }
  } else if (m.type === 'render') {
    try {
      const data = await $typst.pdf({ mainContent: m.mainContent });
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      self.postMessage({ type: 'result', id: m.id, bytes }, [bytes.buffer]);
    } catch (err) {
      self.postMessage({ type: 'error', id: m.id, message: String((err && err.message) || err) });
    }
  }
};

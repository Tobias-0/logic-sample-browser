/* Browser-preview fallback.
   Under Electron the preload has already defined window.api and this no-ops.
   Opened in a plain browser, it serves dev-library.json so the interface can
   be worked on without launching the app. */
if (!window.api) {
  const mem = { favs: [] };
  window.api = {
    loadLibrary: () => fetch('dev-library.json').then((r) => r.json()),
    getRoot: () => Promise.resolve('(preview)'),
    chooseRoot: () => Promise.resolve(null),
    getState: () => Promise.resolve(mem),
    setState: (p) => Object.assign(mem, p),
    reveal: () => {},
    setTheme: () => {},
    startDrag: () => {},
    onProgress: () => {},
  };
}

'use strict';
const { app, BrowserWindow, ipcMain, shell, nativeImage, nativeTheme, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { scan } = require('./scan');

const DEFAULT_ROOT = path.join(app.getPath('home'), 'Music/Logic/Splice/sounds/packs');

let win = null;
const store = {
  file: () => path.join(app.getPath('userData'), 'state.json'),
  read() {
    try { return JSON.parse(fs.readFileSync(this.file(), 'utf8')); } catch { return {}; }
  },
  write(patch) {
    const next = { ...this.read(), ...patch };
    try {
      fs.mkdirSync(path.dirname(this.file()), { recursive: true });
      fs.writeFileSync(this.file(), JSON.stringify(next));
    } catch {}
    return next;
  },
};
const cacheFile = () => path.join(app.getPath('userData'), 'library.json');

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#0B0B0C',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Lets the renderer load audio straight off disk for preview.
      webSecurity: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer/index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

/* ---------------------------- IPC ---------------------------- */

ipcMain.handle('library:root', () => store.read().root || DEFAULT_ROOT);

ipcMain.handle('library:load', async (_e, { rescan }) => {
  const root = store.read().root || DEFAULT_ROOT;
  if (!rescan) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
      if (cached && cached.root === root && Array.isArray(cached.samples)) return cached;
    } catch {}
  }
  if (!fs.existsSync(root)) return { root, samples: [], scannedAt: Date.now(), missing: true };
  const data = scan(root, (done, total) => {
    if (win && !win.isDestroyed()) win.webContents.send('library:progress', { done, total });
  });
  try { fs.writeFileSync(cacheFile(), JSON.stringify(data)); } catch {}
  return data;
});

ipcMain.handle('library:chooseRoot', async () => {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    message: 'Choose your sample library folder',
  });
  if (res.canceled || !res.filePaths[0]) return null;
  store.write({ root: res.filePaths[0] });
  return res.filePaths[0];
});

ipcMain.handle('state:get', () => store.read());
ipcMain.handle('state:set', (_e, patch) => store.write(patch));

ipcMain.on('sample:reveal', (_e, filePath) => { shell.showItemInFolder(filePath); });

// Keep the traffic lights and the window's own background in step with the
// interface, so a light window never flashes a dark frame on resize.
ipcMain.on('theme:set', (_e, pref) => {
  if (!['system', 'light', 'dark'].includes(pref)) return;
  nativeTheme.themeSource = pref;
  if (win && !win.isDestroyed()) {
    win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#0B0B0C' : '#FFFFFF');
  }
});

// The whole point: a real macOS file drag, identical to dragging out of Finder,
// so Logic receives the actual file rather than a browser download.
const dragIcon = nativeImage
  .createFromPath(path.join(__dirname, 'assets/drag.png'))
  .resize({ width: 48, height: 48 });
ipcMain.on('sample:drag', (e, files) => {
  const list = (Array.isArray(files) ? files : [files]).filter((f) => f && fs.existsSync(f));
  if (!list.length) return;
  try {
    e.sender.startDrag(
      list.length === 1
        ? { file: list[0], icon: dragIcon }
        : { file: list[0], files: list, icon: dragIcon }
    );
  } catch {}
});

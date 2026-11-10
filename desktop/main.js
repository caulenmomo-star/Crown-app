/* Kingpin for Mac and Windows: its own window, Dock/taskbar icon and menus. It starts Kingpin's engine (server.py,
   with a Python that comes inside the app, so nothing needs installing) and shows Kingpin in a window. Your data is
   in the same place as before (Application Support/Crown on a Mac, %APPDATA%\Crown on Windows), so it opens
   whatever you already have.
   It can also be linked to your Kingpin Online account: then it opens the online account (like the iPhone app) so it
   stays in sync with your phone and anyone you share the account with, and offers once to add this computer's data. */
'use strict';
const { app, BrowserWindow, Menu, shell, dialog, nativeTheme, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

app.setName('Kingpin');
if (!app.requestSingleInstanceLock()) { app.quit(); }

let engine = null, win = null, appUrl = '', quitting = false, log = '';
const ONLINE = 'https://crowntools.vercel.app/';
// which Kingpin this app shows: 'online' (your Kingpin Online account) or 'local' (data on this computer only)
const confPath = () => path.join(app.getPath('userData'), 'kingpin-desktop.json');
function readConf() { try { return JSON.parse(fs.readFileSync(confPath(), 'utf8')) || {}; } catch (_) { return null; } }
function writeConf(c) { if (SMOKE) return; try { fs.mkdirSync(path.dirname(confPath()), { recursive: true }); fs.writeFileSync(confPath(), JSON.stringify(c, null, 2)); } catch (_) { } }
let conf = null;
// build check (GitHub): KINGPIN_SMOKE=online|local opens that mode, checks the page can talk to the app, writes the result to KINGPIN_SMOKE_OUT and quits
const SMOKE = process.env.KINGPIN_SMOKE || '';
const dataDir = () => process.env.CROWN_DATA || (process.platform === 'darwin' ? path.join(app.getPath('home'), 'Library', 'Application Support', 'Crown') : process.platform === 'win32' ? path.join(process.env.APPDATA || app.getPath('appData'), 'Crown') : path.join(process.env.XDG_DATA_HOME || path.join(app.getPath('home'), '.local', 'share'), 'Crown'));
const localVault = () => path.join(dataDir(), 'vault.json');
function hasLocal() { try { const b = JSON.parse(fs.readFileSync(localVault(), 'utf8')); return !!(b && !b.erased && b.ct); } catch (_) { return false; } }
const fromApp = e => { try { const u = (e.senderFrame && e.senderFrame.url) || e.sender.getURL(); return !!appUrl && u.startsWith(appUrl); } catch (_) { return false; } };
ipcMain.on('kd:info', e => { e.returnValue = fromApp(e) ? { mode: conf.mode, hasLocal: hasLocal(), imported: !!conf.imported, platform: process.platform } : null; });
ipcMain.handle('kd:readLocal', e => { if (!fromApp(e)) return null; try { return JSON.parse(fs.readFileSync(localVault(), 'utf8')); } catch (_) { return null; } });
ipcMain.on('kd:imported', (e, v) => { if (!fromApp(e)) return; conf.imported = !!v; writeConf(conf); });
ipcMain.on('kd:mode', (e, m) => { if (fromApp(e) && (m === 'online' || m === 'local')) switchMode(m); });
// switching starts Kingpin again in the other mode (the window saves first as it closes)
function switchMode(m) {
  conf.mode = m; writeConf(conf);
  app.relaunch(); quitting = true; app.quit();
}
const res = (...p) => app.isPackaged ? path.join(process.resourcesPath, ...p) : path.join(__dirname, ...p);
function pythonPath() {
  const base = res('python');
  const cands = process.platform === 'win32' ? [path.join(base, 'python.exe')] : [path.join(base, 'bin', 'python3'), path.join(base, 'bin', 'python3.12')];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return process.platform === 'win32' ? 'python' : 'python3'; // when running from the source folder
}
function ping(url) {
  return new Promise(ok => {
    const req = http.get(url + 'api/ping', { headers: { 'X-Crown': '1' }, timeout: 1500 }, r => { r.resume(); ok(r.statusCode === 200); });
    req.on('error', () => ok(false)); req.on('timeout', () => { req.destroy(); ok(false); });
  });
}
function startEngine() {
  return new Promise((resolve, reject) => {
    const env = Object.assign({}, process.env, { CROWN_NO_BROWSER: '1', PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', CROWN_DESKTOP: '1' });
    try {
      engine = spawn(pythonPath(), ['-u', res('engine', 'server.py')], { env, cwd: res('engine'), windowsHide: true });
    } catch (e) { reject(e); return; }
    let done = false;
    const onText = d => {
      const t = d.toString(); log = (log + t).slice(-8000);
      const m = t.match(/https?:\/\/127\.0\.0\.1:\d+\//);
      if (m && !done) { done = true; resolve(m[0]); }
    };
    engine.stdout.on('data', onText); engine.stderr.on('data', onText);
    engine.on('error', e => { if (!done) { done = true; reject(e); } });
    engine.on('exit', code => {
      const was = engine; engine = null;
      if (!done) { done = true; reject(new Error('Kingpin’s engine stopped (' + code + ').\n\n' + log.slice(-1500))); return; }
      // "already running": an older window or the old Start Kingpin is open — the URL it printed still works
      if (quitting || !was || code === 0) return;
      if (win && !win.isDestroyed()) {
        dialog.showMessageBox(win, { type: 'error', message: 'Kingpin’s engine stopped', detail: log.slice(-1500), buttons: ['Restart', 'Quit'] })
          .then(r => { if (r.response === 0) boot(); else app.quit(); });
      }
    });
  });
}
async function waitReady(url) {
  for (let i = 0; i < 80; i++) { if (await ping(url)) return true; await new Promise(r => setTimeout(r, 250)); }
  return false;
}
function makeWindow() {
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 380, minHeight: 500, show: false, title: 'Kingpin',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0d12' : '#f6f7fb',
    icon: process.platform === 'win32' ? res('icon.ico') : undefined,
    titleBarStyle: process.platform === 'darwin' ? 'default' : undefined,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true, preload: path.join(__dirname, 'preload.js') },
  });
  win.once('ready-to-show', () => win.show());
  if (SMOKE) {
    const out = r => { try { fs.writeFileSync(process.env.KINGPIN_SMOKE_OUT || path.join(app.getPath('temp'), 'kingpin-smoke.json'), JSON.stringify(r)); } catch (_) { } try { if (engine) engine.kill(); } catch (_) { } app.exit(r.ok ? 0 : 1); };
    setTimeout(() => out({ ok: false, error: 'timed out' }), 90000);
    win.webContents.once('did-finish-load', () => setTimeout(() => win.webContents.executeJavaScript(`(async () => { const k = window.kingpinDesktop; return { mode: k && k.mode, hasLocal: k && k.hasLocal, local: k ? !!(await k.readLocal()) : null, title: document.title, url: location.href, hasLock: !!document.getElementById('lock') }; })()`)
      .then(r => out(Object.assign(r, { ok: r.mode === SMOKE && r.hasLock && (SMOKE === 'online' || (r.hasLocal && r.local)) })), e => out({ ok: false, error: String(e) })), 1500));
  }
  // links to other sites (Target, tracking pages, news) open in your normal browser
  win.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith(appUrl)) return { action: 'allow', overrideBrowserWindowOptions: { width: 900, height: 1000, autoHideMenuBar: true } }; if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(appUrl)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  // save anything not saved yet before the window closes (the page's own "leave page?" check can't show here)
  win.webContents.on('will-prevent-unload', e => e.preventDefault());
  win.on('close', e => {
    if (win.__saved) return;
    e.preventDefault();
    const w = win, finish = () => { if (w.isDestroyed()) return; w.__saved = true; w.close(); };
    const t = setTimeout(finish, 5000);
    w.webContents.executeJavaScript("(async () => { try { if (typeof cryptoKey !== 'undefined' && cryptoKey && (pendingSave || saving)) await saveNow({ force: true }); } catch (e) {} return true; })()")
      .catch(() => { }).then(() => { clearTimeout(t); finish(); });
  });
  // Kingpin Online can't be reached (no internet): try again, or open this computer's copy
  win.webContents.on('did-fail-load', (e, code, desc, url, main) => {
    if (!main || code === -3 || conf.mode !== 'online' || !win || win.isDestroyed()) return;
    dialog.showMessageBox(win, { type: 'warning', message: 'Can’t reach Kingpin Online', detail: `Check your internet connection. (${desc})\n\nYou can also open the copy of Kingpin stored on this computer — changes made there don’t sync.`, buttons: ['Try again', 'Use this computer’s copy', 'Quit'], defaultId: 0, cancelId: 0 })
      .then(r => { if (r.response === 0) win.loadURL(appUrl); else if (r.response === 1) switchMode('local'); else app.quit(); });
  });
  // a quit (or a switch between online / this computer) waits for the save above, then carries on
  win.on('closed', () => { win = null; if (quitting) app.quit(); });
  return win;
}
async function boot() {
  if (!conf && SMOKE) conf = { mode: SMOKE };
  if (!conf) {
    conf = readConf();
    if (!conf || !conf.mode) {
      // first time with this version: ask once
      const had = hasLocal();
      const r = await dialog.showMessageBox({ type: 'question', message: 'Link Kingpin to your Kingpin Online account?', detail: 'Linked, this computer, your phone and anyone you share the account with all see the same profiles, cards, orders and everything else, kept in sync.' + (had ? '\n\nYour data on this computer is added to the account after you sign in (nothing is deleted).' : '') + '\n\nYou can change this anytime in Settings.', buttons: ['Link to Kingpin Online', 'Keep it on this computer only'], defaultId: 0, cancelId: 1 });
      conf = Object.assign(conf || {}, { mode: r.response === 0 ? 'online' : 'local' }); writeConf(conf);
    }
  }
  menu();
  if (conf.mode === 'online') {
    appUrl = ONLINE;
    if (!win || win.isDestroyed()) makeWindow();
    win.loadURL(appUrl).catch(() => { }); // a failed load is handled by did-fail-load
    return;
  }
  try {
    appUrl = await startEngine();
    if (!await waitReady(appUrl)) throw new Error('Kingpin’s engine didn’t answer.\n\n' + log.slice(-1500));
    if (!win || win.isDestroyed()) makeWindow();
    await win.loadURL(appUrl);
  } catch (e) {
    dialog.showErrorBox('Kingpin couldn’t start', String(e && e.message || e));
    app.quit();
  }
}
function menu() {
  const mac = process.platform === 'darwin';
  const go = page => () => { if (win) win.webContents.executeJavaScript(`try { go(${JSON.stringify(page)}) } catch (e) {}`).catch(() => { }); };
  const tmpl = [
    ...(mac ? [{ label: 'Kingpin', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'Cmd+,', click: go('settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'File', submenu: [{ label: 'New Profile', accelerator: 'CmdOrCtrl+N', click: () => { if (win) win.webContents.executeJavaScript("try { go('profiles'); setTimeout(() => document.getElementById('addProfile') && document.getElementById('addProfile').click(), 150) } catch (e) {}").catch(() => { }); } },
      { type: 'separator' }, ...(mac ? [{ role: 'close' }] : [{ label: 'Settings', accelerator: 'Ctrl+,', click: go('settings') }, { type: 'separator' }, { role: 'quit' }])] },
    { role: 'editMenu' },
    { label: 'Go', submenu: [['Dashboard', 'dashboard', '1'], ['News', 'news', '2'], ['Profiles', 'profiles', '3'], ['Accounts', 'accounts', '4'], ['Cards', 'cards', '5'], ['SKU lists', 'skus', '6'], ['Orders', 'orders', '7'], ['Packages', 'packages', '8'], ['Inventory', 'inventory', '9']].map(([l, p, k]) => ({ label: l, accelerator: 'CmdOrCtrl+' + k, click: go(p) })) },
    { label: 'View', submenu: [{ role: 'reload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Open Kingpin in my browser', click: () => appUrl && shell.openExternal(appUrl) },
      { label: conf && conf.mode === 'online' ? 'Use only this computer’s data…' : 'Link to my Kingpin Online account…', click: async () => {
        const online = conf.mode === 'online';
        const r = await dialog.showMessageBox(win || undefined, { type: 'question', message: online ? 'Use only this computer’s data?' : 'Link to your Kingpin Online account?', detail: online ? 'Kingpin goes back to the data stored on this computer. It won’t see changes made online or on your phone until you link it again.' : 'Kingpin opens your online account (sign in, or create one) and offers to add this computer’s data to it. Nothing is deleted.', buttons: [online ? 'Use this computer only' : 'Link it', 'Cancel'], defaultId: 0, cancelId: 1 });
        if (r.response === 0) switchMode(online ? 'local' : 'online');
      } }, { label: 'Show my data folder', click: () => shell.openPath(process.platform === 'darwin' ? path.join(app.getPath('home'), 'Library', 'Application Support', 'Crown') : path.join(app.getPath('appData'), 'Crown')) }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tmpl));
}
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.whenReady().then(boot);
app.on('activate', () => { if (!win && appUrl) { makeWindow(); win.loadURL(appUrl); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => {
  if (!engine) return;
  // ask Kingpin's engine to stop, then make sure it's gone
  try { const r = http.request(appUrl + 'api/shutdown', { method: 'POST', headers: { 'X-Crown': '1', 'Content-Type': 'application/json' }, timeout: 1500 }); r.on('error', () => { }); r.end('{}'); } catch (_) { }
  const e = engine; setTimeout(() => { try { e.kill(); } catch (_) { } }, 1200);
});

/* Crown Tools - installing Crown Tools as an app: one tap where the browser supports it (Chrome / Edge on PC, Mac
   and Android), step-by-step help where it doesn't (iPhone / iPad Safari, Mac Safari). */
'use strict';
const INSTALL = { prompt: null };
const isInstalled = () => (window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches)) || navigator.standalone === true;
function deviceKind() {
  const ua = navigator.userAgent;
  if (/iPhone|iPod/.test(ua)) return 'iphone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ipad';
  if (/Android/.test(ua)) return 'android';
  if (/Macintosh/.test(ua)) return 'mac';
  if (/Windows/.test(ua)) return 'windows';
  return 'other';
}
function browserKind() {
  const ua = navigator.userAgent;
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'edge';
  if (/CriOS|Chrome\//.test(ua)) return 'chrome';
  if (/FxiOS|Firefox\//.test(ua)) return 'firefox';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}
const SHARE_ICON = '<svg class="inl" viewBox="0 0 24 24" aria-label="Share"><path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// what to do on this device, as a short list of steps
function installSteps(dev, br) {
  dev = dev || deviceKind(); br = br || browserKind();
  if (dev === 'iphone' || dev === 'ipad') return [`Open <b>${esc(location.host)}</b> in Safari${br === 'chrome' ? ' (or Chrome)' : ''}.`, `Tap the Share button ${SHARE_ICON}${dev === 'iphone' ? ' at the bottom' : ' at the top'}.`, 'Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.', 'Open Crown Tools from your home screen — it runs full screen like any other app.'];
  if (dev === 'mac' && br === 'safari') return ['In Safari’s menu bar choose <b>File → Add to Dock…</b>', 'Click <b>Add</b>. Crown Tools opens in its own window from the Dock and Launchpad.'];
  if (br === 'chrome' || br === 'edge') return [`Click <b>Install</b> below, or the install icon at the right end of ${br === 'edge' ? 'Edge' : 'Chrome'}’s address bar.`, `Crown Tools opens in its own window and shows up in your ${dev === 'mac' ? 'Dock and Launchpad' : dev === 'windows' ? 'Start menu and taskbar' : 'apps'}.`];
  if (dev === 'android') return ['Tap the ⋮ menu in Chrome.', 'Tap <b>Install app</b> (or <b>Add to Home screen</b>).'];
  return ['Open Crown Tools in Chrome or Edge on a computer, or Safari on an iPhone or iPad, to install it as an app.'];
}
async function doInstall() {
  const p = INSTALL.prompt; if (!p) return false;
  INSTALL.prompt = null; p.prompt();
  try { const r = await p.userChoice; if (r && r.outcome === 'accepted') toast('Installing Crown Tools…'); } catch (_) { }
  refreshInstallBits(); return true;
}
function installCardHtml() {
  const dev = deviceKind(), br = browserKind(), steps = installSteps(dev, br);
  if (isInstalled()) return `<div class="card getapp" id="getApp" style="margin-bottom:14px"><h3>📲 Crown Tools app</h3><div class="small muted">You’re using the installed app on this device. To add it to another one, open <b>${esc(location.host)}</b> there and follow the steps in Settings, or visit <a href="install.html" target="_blank" rel="noopener">${esc(location.host)}/install.html</a>.</div></div>`;
  return `<div class="card getapp" id="getApp" style="margin-bottom:14px"><h3>📲 Get the app<span class="spacer"></span>${INSTALL.prompt ? '<button class="primary sm" id="getAppGo">Install Crown Tools</button>' : ''}</h3>
    <div class="small muted" style="margin-bottom:8px">Install Crown Tools on this ${dev === 'iphone' ? 'iPhone' : dev === 'ipad' ? 'iPad' : dev === 'android' ? 'phone' : 'computer'} so it opens in its own window with its own icon. Same account and data on every device — and it updates itself.</div>
    <ol class="steps">${steps.map(s => `<li>${s}</li>`).join('')}</ol>
    <div class="small faint" style="margin-top:8px">Other devices: <a href="install.html" target="_blank" rel="noopener">install steps for iPhone, Mac and PC</a></div></div>`;
}
function wireInstallCard() { const b = $('#getAppGo'); if (b) b.onclick = doInstall; }
// the "Install app" buttons in the menu and on the sign-in screen appear only when one tap will do it
function refreshInstallBits() {
  const can = !!INSTALL.prompt && !isInstalled();
  ['#installNav', '#installLock'].forEach(s => { const el = $(s); if (el) el.hidden = !can; });
  if (route && route.page === 'settings' && $('#getApp')) { $('#getApp').outerHTML = installCardHtml(); wireInstallCard(); }
}
// iPhone / iPad: there's no install button, so show the steps once (and again only if you ask)
function maybeShowIosTip() {
  const dev = deviceKind(); if ((dev !== 'iphone' && dev !== 'ipad') || isInstalled()) return;
  try { if (localStorage.getItem('crown.iosTip')) return; } catch (_) { return; }
  const el = $('#installTip'); if (!el) return;
  el.innerHTML = `<div class="itip-body"><b>Install Crown Tools on your ${dev === 'iphone' ? 'iPhone' : 'iPad'}</b><span>Tap ${SHARE_ICON} then <b>Add to Home Screen</b>.</span></div><button class="ghost sm" id="installTipX" aria-label="Dismiss">✕</button>`;
  el.hidden = false;
  $('#installTipX').onclick = () => { el.hidden = true; try { localStorage.setItem('crown.iosTip', '1'); } catch (_) { } };
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); INSTALL.prompt = e; refreshInstallBits(); });
window.addEventListener('appinstalled', () => { INSTALL.prompt = null; refreshInstallBits(); toast('Crown Tools is installed 👑'); });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { }); });
}
document.addEventListener('click', e => { if (e.target.closest('#installNav, #installLock')) { e.preventDefault(); doInstall(); } });
document.documentElement.classList.toggle('installed', isInstalled());

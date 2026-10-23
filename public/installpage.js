/* The public "Get Crown Tools" page: shows the steps for the device you're on, with a one-tap Install where the
   browser supports it. */
'use strict';
(function () {
  const $ = s => document.querySelector(s), ua = navigator.userAgent;
  const dev = /iPhone|iPod/.test(ua) ? 'iphone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'ipad' : /Android/.test(ua) ? 'android' : /Macintosh/.test(ua) ? 'mac' : /Windows/.test(ua) ? 'windows' : 'other';
  const br = /Edg(e|A|iOS)?\//.test(ua) ? 'edge' : /CriOS|Chrome\//.test(ua) ? 'chrome' : /FxiOS|Firefox\//.test(ua) ? 'firefox' : /Safari\//.test(ua) ? 'safari' : 'other';
  const installed = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  document.querySelectorAll('.host').forEach(el => { el.textContent = location.host; });
  const names = { iphone: 'iPhone', ipad: 'iPad', mac: 'Mac', windows: 'Windows PC', android: 'Android' };
  const card = document.querySelector(`.dev[data-dev="${dev === 'ipad' ? 'iphone' : dev}"]`);
  if (card) card.classList.add('mine');
  if (dev !== 'other') {
    $('#here').hidden = false; $('#hereTitle').textContent = `Install on your ${names[dev]}`;
    let steps;
    if (dev === 'iphone' || dev === 'ipad') steps = [br === 'safari' || br === 'chrome' ? 'Tap the <b>Share</b> button ' + (dev === 'iphone' ? 'at the bottom' : 'at the top') + ' of the screen.' : 'Open this page in <b>Safari</b>, then tap the <b>Share</b> button.', 'Tap <b>Add to Home Screen</b>, then <b>Add</b>.', 'Open Crown Tools from your home screen.'];
    else if (dev === 'mac' && br === 'safari') steps = ['Choose <b>File → Add to Dock…</b> in the menu bar.', 'Click <b>Add</b>.'];
    else if (br === 'chrome' || br === 'edge') steps = ['Click <b>Install Crown Tools</b> below (or the install icon at the right end of the address bar).', 'Crown Tools opens in its own window.'];
    else steps = [`Open this page in <b>${dev === 'android' ? 'Chrome' : 'Chrome or Edge'}</b> to install.`];
    $('#hereSteps').innerHTML = steps.map(s => `<li>${s}</li>`).join('');
  }
  if (installed) { $('#done').hidden = false; $('#hereSteps').hidden = true; }
  let prompt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); prompt = e; $('#go').hidden = false; });
  window.addEventListener('appinstalled', () => { $('#go').hidden = true; $('#done').hidden = false; });
  $('#go').onclick = async () => { if (!prompt) return; const p = prompt; prompt = null; p.prompt(); try { await p.userChoice; } catch (_) { } $('#go').hidden = true; };
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) navigator.serviceWorker.register('sw.js').catch(() => { });
})();

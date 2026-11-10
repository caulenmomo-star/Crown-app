/* Kingpin - keeps the Mac and Windows apps (and Start Kingpin) up to date by themselves.
   The engine downloads the newest screens from the website in the background (see server.py "updates"). If you're on
   the lock screen they're switched in right away; if you're working, Kingpin offers "Restart now" (it saves first)
   and otherwise uses them the next time it opens. A version that also needs a new engine says "Get the new download".
   Kingpin Online and the iPhone app always load the newest version anyway, so none of this runs there. */
'use strict';
const UP = { info: null, told: '', timer: 0 };
const upVt = v => (String(v || '').match(/\d+/g) || ['0']).slice(0, 4).map(Number);
const upNewer = (a, b) => { const x = upVt(a), y = upVt(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; } return false; };
const upLocal = () => typeof SERVER !== 'undefined' && SERVER && !CLOUD;
async function upApply() {
  try {
    if (cryptoKey && (pendingSave || saving)) await saveNow({ force: true });
    await api('/api/update/apply', {});
  } catch (_) { }
  location.reload();
}
async function upCheck(force) {
  if (!upLocal()) return null;
  let u;
  try { u = await api(force ? '/api/update/check' : '/api/update', force ? {} : undefined); } catch (_) { return null; }
  UP.info = u;
  if (u.ready && upNewer(u.ready, VERSION)) {
    // still on the lock screen with nothing typed: switch now
    const pw = document.getElementById('pw1');
    if (!cryptoKey && !(pw && pw.value) && !document.querySelector('dialog[open]')) { upApply(); return u; }
    if (UP.told !== u.ready && cryptoKey) {
      UP.told = u.ready;
      toast(`Kingpin ${u.ready} is ready — it’s used next time Kingpin opens`, { action: 'Restart now', onAction: upApply, ms: 20000 });
    }
  } else if (u.needsDownload && UP.told !== 'dl' + u.needsDownload && cryptoKey) {
    UP.told = 'dl' + u.needsDownload;
    toast(`Kingpin ${u.needsDownload} needs a new download for this computer`, { action: 'Get it', onAction: () => window.open(u.releases, '_blank'), ms: 20000 });
  }
  if (typeof route !== 'undefined' && route.page === 'settings' && document.getElementById('stUpd')) upSettingsDraw();
  return u;
}
function upSettingsHtml() {
  if (!upLocal()) return '';
  return `<div class="card"><h3>Updates</h3><div id="stUpd" class="small muted">Checking…</div>
    <div class="hstack" style="margin-top:10px;gap:8px;flex-wrap:wrap"><button class="sm" id="stUpdCheck">Check now</button><button class="sm primary" id="stUpdGo" hidden>Restart now</button><button class="sm" id="stUpdDl" hidden>Get the new download</button></div></div>`;
}
function upSettingsDraw() {
  const box = document.getElementById('stUpd'), u = UP.info; if (!box) return;
  if (!u) { box.textContent = 'Couldn’t reach the update check.'; return; }
  const ago = u.checked ? `last checked ${fmtDT(u.checked * 1000)}` : 'not checked yet';
  const msg = !u.auto ? 'Automatic updates are off for this copy.'
    : u.ready && upNewer(u.ready, VERSION) ? `<b>Kingpin ${esc(u.ready)} is downloaded.</b> It’s used next time Kingpin opens, or restart now.`
    : u.needsDownload ? `<b>Kingpin ${esc(u.needsDownload)}</b> needs a new download for this computer (it changes the part that runs in the background).`
    : u.state === 'checking' || u.state === 'downloading' ? 'Downloading the newest version…'
    : u.state === 'error' ? `Couldn’t update just now (${esc(u.error)}). Kingpin tries again later.`
    : 'You’re on the newest version. Kingpin keeps itself up to date — new versions download in the background.';
  box.innerHTML = `${msg}<div class="faint" style="margin-top:4px">Showing v${esc(VERSION)} · app v${esc(u.bundled)} · ${esc(ago)}</div>`;
  $('#stUpdGo').hidden = !(u.ready && upNewer(u.ready, VERSION));
  $('#stUpdDl').hidden = !u.needsDownload;
}
function wireUpSettings() {
  if (!document.getElementById('stUpd')) return;
  upSettingsDraw();
  $('#stUpdCheck').onclick = async () => { $('#stUpd').textContent = 'Checking…'; $('#stUpdCheck').disabled = true; await upCheck(true); $('#stUpdCheck').disabled = false; upSettingsDraw(); };
  $('#stUpdGo').onclick = upApply;
  $('#stUpdDl').onclick = () => UP.info && window.open(UP.info.releases, '_blank');
  if (!UP.info) upCheck(false).then(upSettingsDraw);
}
function wireUpdates() {
  // the first check runs a moment after the engine starts; look again soon, then every 30 minutes
  [4000, 15000, 45000].forEach(ms => setTimeout(() => upCheck(false), ms));
  clearInterval(UP.timer); UP.timer = setInterval(() => upCheck(false), 30 * 60000);
  // and ask the website directly every couple of hours, so a fix reaches a Kingpin that stays open all day
  clearInterval(UP.timer2); UP.timer2 = setInterval(() => upCheck(true), 2 * 3600e3);
}

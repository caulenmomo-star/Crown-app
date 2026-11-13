/* Kingpin - background alerts on your phone (Kingpin Online only, opt-in).
   With it on, Kingpin Online keeps a small watch list - your inbox app passwords, tracking numbers, house names and a
   few order details - encrypted with a server key, checks every few minutes even when Kingpin is closed everywhere,
   and sends push notifications: new orders, shipped, out for delivery, delivered, problems, and each morning
   "Today: Elm St 3 · Oak Ave 1". The watch list is updated whenever your data changes; turning it off erases it.
   Each phone/computer turns notifications on for itself (iPhone: from the home-screen app). */
'use strict';
const BG = { info: null, busy: false, sent: '', timer: 0 };
const bgPrefs = () => Object.assign({ orders: true, shipped: true, ofd: true, delivered: true, problems: true, summary: true, summaryHour: 8 }, state.settings.bgPrefs || {});
const bgPushOk = () => typeof window !== 'undefined' && !window.kingpinDesktop && 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
const bgIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const bgStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
function bgDeviceName() {
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (bgIOS() && !/iPhone/.test(ua)) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'This device';
}
// what the server needs to watch: as little as possible
function bgBundle() {
  const hName = id => { const h = id && houseById(id); return h ? houseLabel(h) : ''; };
  const cut = Date.now() - 60 * 864e5, emailHouse = {};
  const orders = state.orders.filter(o => !isDead(o) && new Date(o.orderDate || o.createdAt || 0).getTime() > cut).map(o => {
    if (o.recipientEmail && o.houseId) emailHouse[String(o.recipientEmail).toLowerCase()] = hName(o.houseId);
    return { n: o.orderNumber || '', st: o.store || '', h: hName(o.houseId), item: (typeof shortTitle === 'function' ? shortTitle(o) : '').slice(0, 60),
      tr: (o.tracking || []).filter(t => t.number && !(t.live && t.live.status === 'delivered')).map(t => ({ n: t.number, c: t.carrier || '' })) };
  });
  return {
    v: 1, tz: -new Date().getTimezoneOffset(), prefs: bgPrefs(),
    imap: (state.imapAccounts || []).filter(a => a.user && a.pass && a.host).map(a => ({ id: a.id, label: a.label || '', user: a.user, pass: a.pass, host: a.host, port: a.port, ssl: a.ssl !== false, folder: a.folder || 'INBOX' })),
    stores: Parser.STORES.filter(s => s.key !== 'other').map(s => ({ k: s.key, l: s.label, d: s.domains || [] })),
    orders, emailHouse, carriers: carrierKeys(), s17Key: s17Key(), easypostKey: state.settings.easypostKey || '',
  };
}
// keep the watch list current (a little after changes, only if something it uses changed)
function bgSoon() {
  if (!CLOUD || !state.settings.bgOn) return;
  clearTimeout(BG.timer); BG.timer = setTimeout(bgSync, 20000);
}
async function bgSync(force) {
  if (!CLOUD || !cryptoKey || !state.settings.bgOn) return;
  const b = bgBundle(), j = JSON.stringify(Object.assign({}, b, { tz: 0 })) + b.tz;
  if (!force && j === BG.sent) return;
  try { const r = await api('/api/bg/update', { bundle: b }); BG.sent = j; if (r && r.on === false && state.settings.bgOn) { state.settings.bgOn = false; save(); } } catch (_) { }
}
async function bgMySub() {
  if (!bgPushOk()) return null;
  try { const reg = await navigator.serviceWorker.ready; return await reg.pushManager.getSubscription(); } catch (_) { return null; }
}
async function bgStatus() {
  const s = await bgMySub();
  try { BG.info = await api('/api/bg/status', { endpoint: s ? s.endpoint : '' }); } catch (e) { BG.info = { ok: false, error: e.message }; }
  BG.mine = !!(s && BG.info && (BG.info.devices || []).some(d => d.me));
  return BG.info;
}
// this device: ask permission, subscribe, tell Kingpin Online
async function bgSubscribeHere() {
  if (!bgPushOk()) { toast(window.kingpinDesktop ? 'Turn them on from your phone — the computer app can’t get push notifications' : bgIOS() && !bgStandalone() ? 'On iPhone, open Kingpin from its home-screen icon first (Share → Add to Home Screen)' : 'This browser can’t get push notifications'); return false; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Notifications are blocked for Kingpin — allow them in this device’s settings'); return false; }
  const reg = await navigator.serviceWorker.ready;
  const info = BG.info && BG.info.vapid ? BG.info : await bgStatus();
  const key = Uint8Array.from(atob(info.vapid.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((info.vapid.length + 3) % 4)), c => c.charCodeAt(0));
  let sub = await reg.pushManager.getSubscription();
  if (sub && sub.options && sub.options.applicationServerKey) {
    const old = new Uint8Array(sub.options.applicationServerKey);
    if (old.length !== key.length || old.some((v, i) => v !== key[i])) { await sub.unsubscribe(); sub = null; }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api('/api/bg/subscribe', { sub: sub.toJSON(), name: bgDeviceName() });
  return true;
}
function bgCardHtml() {
  if (!CLOUD) return '';
  const on = !!state.settings.bgOn, P = bgPrefs(), i = BG.info || {};
  const head = `<div class="card" id="bgCard"><h3>Phone notifications</h3>`;
  if (!on) return head + `<div class="small muted">Get notified even when Kingpin is closed everywhere: new orders, shipped, out for delivery, delivered, problems, and every morning which house has deliveries today.</div>
    <div class="note small" style="margin-top:10px">To do this, Kingpin Online keeps a small watch list for your account — your inbox app passwords, tracking numbers, house names and order details — encrypted with a server key instead of your password. It only reads mail, never sends or deletes. Turning it off erases the list. You can also cancel the inbox app password anytime at appleid.apple.com.</div>
    <button class="primary" id="bgOn" style="margin-top:10px">Turn on phone notifications</button></div>`;
  const devs = i.devices || [];
  return head + `<div class="small muted">On — Kingpin Online checks your inboxes and ${i.watching != null ? plural(i.watching, 'package') : 'packages'} every few minutes${i.ran ? `, last ${fmtDT(i.ran * 1000)}` : ''}.${i.err ? ` <span style="color:var(--warn)">Last problem: ${esc(i.err)}</span>` : ''}</div>
    <div style="margin-top:10px"><b class="small">This ${esc(bgDeviceName().toLowerCase())}</b>: ${BG.mine ? '<span class="small" style="color:var(--ok)">getting notifications</span> <button class="ghost sm" id="bgHereOff">Stop on this device</button>' : bgPushOk() ? '<button class="sm primary" id="bgHere">Get notifications here</button>' : `<span class="small muted">${window.kingpinDesktop ? 'The computer app can’t get push notifications — turn them on from your phone.' : bgIOS() && !bgStandalone() ? 'Open Kingpin from its home-screen icon (Share → Add to Home Screen) to get notifications on this iPhone.' : 'This browser can’t get push notifications.'}</span>`}</div>
    ${devs.length ? `<div class="small muted" style="margin-top:6px">Getting them: ${devs.map(d => esc(d.name || 'device') + (d.me ? ' (this one)' : '')).join(', ')}</div>` : `<div class="small" style="margin-top:6px;color:var(--warn)">No device is getting notifications yet.</div>`}
    <div class="bgprefs" style="margin-top:12px">${[['orders', 'New orders'], ['shipped', 'Shipped'], ['ofd', 'Out for delivery'], ['delivered', 'Delivered'], ['problems', 'Cancelled, payment & delivery problems'], ['summary', 'Morning summary']].map(([k, l]) => `<label class="check"><input type="checkbox" data-bgp="${k}" ${P[k] ? 'checked' : ''}> ${l}</label>`).join('')}
      <label class="small muted" style="display:flex;align-items:center;gap:6px">Summary at <select id="bgHour" style="width:auto">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${+P.summaryHour === h ? 'selected' : ''}>${h === 0 ? '12 AM' : h < 12 ? h + ' AM' : h === 12 ? '12 PM' : (h - 12) + ' PM'}</option>`).join('')}</select></label></div>
    ${(i.log || []).length ? `<details style="margin-top:10px"><summary class="small">Recent notifications</summary><div class="list" style="margin-top:6px">${i.log.map(l => `<div class="li"><div style="flex:1;min-width:0"><div class="small"><b>${esc(l.title)}</b></div><div class="small muted ellipsis">${esc(l.body)}</div></div><span class="small faint">${fmtDT(l.t * 1000)}</span></div>`).join('')}</div></details>` : ''}
    <div class="hstack" style="margin-top:12px;gap:8px;flex-wrap:wrap"><button class="sm" id="bgTest">Send a test</button><button class="sm danger" id="bgOff">Turn off and erase</button></div></div>`;
}
function wireBgCard() {
  const card = document.getElementById('bgCard'); if (!card) return;
  const redraw = () => { const c = document.getElementById('bgCard'); if (c) { c.outerHTML = bgCardHtml(); wireBgCard(); } };
  if (state.settings.bgOn && !BG.info && !BG.busy) { BG.busy = true; bgStatus().then(() => { BG.busy = false; redraw(); }); }
  const on = $('#bgOn');
  if (on) on.onclick = async () => {
    if (!await ask('Turn on phone notifications?\n\nKingpin Online will keep a watch list for your account — inbox app passwords, tracking numbers, house names and order details — encrypted with a server key, so it can check while Kingpin is closed. It only reads your mail. Turning it off erases it.', { ok: 'Turn on' })) return;
    on.disabled = true; on.textContent = 'Turning on…';
    try {
      await api('/api/bg/enable', { bundle: bgBundle() });
      state.settings.bgOn = true; save(); BG.sent = '';
      await bgStatus();
      if (bgPushOk()) { try { await bgSubscribeHere(); } catch (e) { toast(e.message || 'Couldn’t turn on notifications on this device'); } }
      await bgStatus(); redraw();
      toast(BG.mine ? 'Phone notifications are on' : 'On — now turn on notifications on your phone (Settings there)');
    } catch (e) { toast(e.message || 'Couldn’t turn it on'); on.disabled = false; on.textContent = 'Turn on phone notifications'; }
  };
  const here = $('#bgHere');
  if (here) here.onclick = async () => { here.disabled = true; try { if (await bgSubscribeHere()) toast('This device will get notifications'); } catch (e) { toast(e.message || 'Couldn’t turn on notifications here'); } await bgStatus(); redraw(); };
  const hOff = $('#bgHereOff');
  if (hOff) hOff.onclick = async () => { const s = await bgMySub(); try { if (s) { await api('/api/bg/unsubscribe', { endpoint: s.endpoint }); await s.unsubscribe(); } } catch (_) { } await bgStatus(); redraw(); };
  const t = $('#bgTest');
  if (t) t.onclick = async () => { try { const r = await api('/api/bg/test', {}); toast(r.sent ? `Sent to ${plural(r.sent, 'device')}` : 'No device is getting notifications yet'); } catch (e) { toast(e.message); } };
  const off = $('#bgOff');
  if (off) off.onclick = async () => {
    if (!await ask('Turn off phone notifications?\n\nKingpin Online erases the watch list (inbox passwords, tracking numbers, houses) and stops checking.', { ok: 'Turn off and erase', danger: true })) return;
    try { await api('/api/bg/disable', {}); const s = await bgMySub(); if (s) await s.unsubscribe().catch(() => { }); } catch (e) { toast(e.message); return; }
    state.settings.bgOn = false; BG.info = null; BG.sent = ''; save(); redraw(); toast('Phone notifications off — the watch list was erased');
  };
  card.querySelectorAll('[data-bgp]').forEach(c => c.onchange = () => { state.settings.bgPrefs = Object.assign(bgPrefs(), { [c.dataset.bgp]: c.checked }); save(); bgSync(true); });
  if ($('#bgHour')) $('#bgHour').onchange = e => { state.settings.bgPrefs = Object.assign(bgPrefs(), { summaryHour: +e.target.value }); save(); bgSync(true); };
}
// every save may change what's watched (new tracking numbers, inboxes…)
if (typeof save === 'function') {
  const _save = save;
  save = function () { const r = _save.apply(this, arguments); bgSoon(); return r; };
}

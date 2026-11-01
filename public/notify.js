/* Crown Tools - notifications. Watches your orders, pre-orders, bot checkouts and ACO clients for anything new
   (shipped, delivered, cancelled, a pre-order card that needs updating, a client's checkout, an invoice that's
   overdue) and lists it under the bell. With device notifications on, each one also pops up on this computer or
   phone while Crown Tools is open or installed. Kept inside your encrypted data so every device shows the same list. */
'use strict';
const NOTIF_KINDS = [
  ['order', 'New orders', '🛒'], ['shipped', 'Shipped', '🚚'], ['out', 'Out for delivery', '📦'], ['delivered', 'Delivered', '✅'],
  ['late', 'Running late', '⏰'], ['problem', 'Delivery problems', '⚠️'], ['cancelled', 'Cancelled', '✕'], ['preorder', 'Pre-order payment', '💳'], ['checkout', 'Bot checkouts', '🤖'],
  ['aco', 'ACO client checkouts', '👥'], ['invoice', 'Invoices', '🧾'],
];
const NOTIF_ICON = Object.fromEntries(NOTIF_KINDS.map(k => [k[0], k[2]]));
const notifOn = k => ((state.settings.notifyKinds || {})[k]) !== false;
const NF = { open: false, timer: 0 };
function notifList() { if (!Array.isArray(state.notifications)) state.notifications = []; return state.notifications; }
const notifUnread = () => notifList().filter(n => !n.read).length;
// add one notification (and pop it up on this device when that's turned on)
function addNotif(kind, title, body, nav, key) {
  if (!notifOn(kind)) return null;
  const L = notifList();
  if (key && L.some(n => n.key === key)) return null;
  const n = { id: uid(), at: new Date().toISOString(), kind, title: String(title || '').slice(0, 140), body: String(body || '').slice(0, 300), nav: nav || '', key: key || '', read: false };
  L.unshift(n); if (L.length > 300) L.length = 300;
  devicePop(n);
  return n;
}
function devicePop(n, force) {
  if (!state.settings.notify || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (!force && document.visibilityState === 'visible' && document.hasFocus()) return; // you're looking at Crown Tools already
  const opts = { body: n.body, tag: n.key || n.id, icon: 'ct-icon-192.png', badge: 'ct-icon-192.png', data: { nav: n.nav } };
  const title = (NOTIF_ICON[n.kind] || '👑') + ' ' + n.title;
  if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) navigator.serviceWorker.getRegistration().then(r => r ? r.showNotification(title, opts) : new Notification(title, opts)).catch(() => { try { new Notification(title, opts); } catch (_) { } });
  else { try { new Notification(title, opts); } catch (_) { } }
}
if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.crownNav && cryptoKey) go(...String(e.data.crownNav).split('/')); });

/* ---------- watching for changes ---------- */
// what we last saw of each order: "status|pre-order payment state"
const orderSig = o => o.status + '|' + (typeof isPreorderOrder === 'function' && isPreorderOrder(o) ? payState(o).k : '');
const oName = o => { const t = typeof shortTitle === 'function' ? shortTitle(o) : ''; return t || ((Parser.storeInfo(o.store) || {}).label + ' #' + (o.orderNumber || '—')); };
const oWhere = o => { const h = o.houseId && houseById(o.houseId); return [(Parser.storeInfo(o.store) || {}).label, h ? houseLabel(h) : '', o.total != null ? fmtMoney(o.total) : ''].filter(Boolean).join(' · '); };
// a change you made by hand doesn't need a notification
const byHand = o => { const h = (o.history || [])[o.history.length - 1]; return !!h && h.source === 'manual'; };
function notifScan() {
  if (!cryptoKey || !state.orders) return 0;
  const snap = state.notifSnap, fresh = {}; let added = 0;
  for (const o of state.orders) fresh[o.id] = orderSig(o);
  NF.snapChanged = !snap || Object.keys(snap).length !== state.orders.length || state.orders.some(o => snap[o.id] !== fresh[o.id]);
  if (!snap) { state.notifSnap = fresh; return 0; } // first run: remember where everything is, no flood
  const batch = {}; const push = (kind, o, title, body, key) => { (batch[kind] = batch[kind] || []).push({ o, title, body, key }); };
  for (const o of state.orders) {
    const was = snap[o.id], now = fresh[o.id]; if (was === now) continue;
    const [ws, wp] = (was || '|').split('|'), [ns, np] = now.split('|');
    if (byHand(o) && was) continue;
    // first time we see it (a fresh sync) but it already needs a new card, or was already cancelled for it: say so
    if (!was && (np === 'declined' || np === 'lost')) { const s = payState(o); push('preorder', o, (np === 'lost' ? 'Cancelled — card wasn’t updated: ' : 'Pre-order needs a new card: ') + oName(o), (np === 'declined' && s.due ? 'Fix by ' + fmtDate(s.due, { weekday: true }) + ' · ' : '') + (s.last4 ? 'Declined •••• ' + s.last4 + ' · ' : '') + oWhere(o), (np === 'lost' ? 'lost:' : 'pay:') + o.id + (np === 'lost' ? '' : ':' + (s.at || ''))); continue; }
    if (!was) { if (!isDead(o)) { if (o.source === 'bot') push('checkout', o, 'Bot checkout: ' + oName(o), [o.bot ? botLabel(o.bot.bot) : '', oWhere(o)].filter(Boolean).join(' · '), 'new:' + o.id); else push('order', o, 'New order: ' + oName(o), oWhere(o), 'new:' + o.id); } continue; }
    if (ns !== ws) {
      if (ns === 'shipped') push('shipped', o, 'Shipped: ' + oName(o), (o.eta ? 'Arrives ' + fmtDate(o.eta, { weekday: true }) + ' · ' : '') + oWhere(o), 'st:' + o.id + ':shipped');
      else if (ns === 'out') push('out', o, 'Out for delivery: ' + oName(o), oWhere(o), 'st:' + o.id + ':out');
      else if (ns === 'delivered') push('delivered', o, 'Delivered: ' + oName(o), oWhere(o), 'st:' + o.id + ':delivered');
      else if (ns === 'cancelled' && np !== 'lost') { const c = typeof cancelInfo === 'function' ? cancelInfo(o) : null; push('cancelled', o, 'Cancelled: ' + oName(o), (c ? CANCEL_KINDS[c.kind].l + ' · ' : '') + oWhere(o), 'st:' + o.id + ':cancelled'); }
    }
    if (np !== wp && np) {
      if (np === 'declined') push('preorder', o, 'Pre-order needs a new card: ' + oName(o), (() => { const s = payState(o); return (s.due ? 'Fix by ' + fmtDate(s.due, { weekday: true }) + ' · ' : '') + (s.last4 ? 'Declined •••• ' + s.last4 + ' · ' : '') + oWhere(o); })(), 'pay:' + o.id + ':' + (payState(o).at || ''));
      else if (np === 'lost') push('preorder', o, 'Cancelled — card wasn’t updated: ' + oName(o), (payState(o).last4 ? 'Declined •••• ' + payState(o).last4 + ' · ' : '') + oWhere(o), 'lost:' + o.id);
      else if (np === 'paid' && wp === 'declined') push('preorder', o, 'Pre-order payment updated: ' + oName(o), 'Charged — pre-order secured · ' + oWhere(o), 'pay:' + o.id + ':paid');
    }
  }
  // lots at once (a first sync, a re-read): one summary instead of a pile
  const nav = { checkout: 'orders', order: 'orders', shipped: 'orders', out: 'orders', delivered: 'orders', cancelled: 'orders', preorder: 'preorders' };
  const LBL = { checkout: 'bot checkouts', order: 'new orders', shipped: 'orders shipped', out: 'orders out for delivery', delivered: 'orders delivered', cancelled: 'orders cancelled', preorder: 'pre-order payment updates' };
  for (const [kind, list] of Object.entries(batch)) {
    if (list.length > 5) { if (addNotif(kind, `${list.length} ${LBL[kind]}`, list.slice(0, 3).map(x => x.title.replace(/^[^:]+:\s*/, '')).join(' · ') + (list.length > 3 ? ' …' : ''), nav[kind], kind + ':' + Date.now())) added++; }
    else for (const x of list) if (addNotif(kind, x.title, x.body, nav[kind] || 'orders', x.key)) added++;
  }
  // once a day: pre-orders that auto-cancel by tomorrow, and orders past their delivery date
  const tk = todayKey(), tmr = dayKey(new Date(Date.now() + 864e5));
  if (typeof payState === 'function') for (const o of state.orders) {
    if (!isPreorderOrder(o)) continue; const s = payState(o);
    if (s.k === 'declined' && s.due && s.due >= tk && s.due <= tmr && addNotif('preorder', `Update the card today: ${oName(o)}`, `Target auto-cancels it ${s.due === tk ? 'today' : 'tomorrow'} · ${oWhere(o)}`, 'preorders', 'due:' + o.id + ':' + s.due)) added++;
  }
  for (const o of state.orders) if (o.status === 'shipped' && o.eta && o.eta < tk && dayKey(new Date(Date.now() - 2 * 864e5)) <= o.eta && addNotif('late', 'Running late: ' + oName(o), 'Was due ' + fmtDate(o.eta, { weekday: true }) + ' · ' + oWhere(o), 'orders', 'late:' + o.id + ':' + o.eta)) added++;
  if (typeof acoOverdueNotifs === 'function') added += acoOverdueNotifs();
  state.notifSnap = fresh;
  if (added) renderBell();
  return added;
}
// re-check shortly after anything is saved (email sync, tracking, Discord, ACO...) and every 10 minutes
// the snapshot is saved too, so a change that happens while Crown Tools is closed still gets noticed next time
function scheduleNotifScan() { clearTimeout(NF.timer); NF.timer = setTimeout(() => { if (notifScan() || NF.snapChanged) { NF.snapChanged = false; save(); } }, 1500); }
setInterval(() => { if (cryptoKey && (notifScan() || NF.snapChanged)) { NF.snapChanged = false; save(); } }, 10 * 60e3);

/* ---------- the bell ---------- */
function renderBell() {
  const n = cryptoKey ? notifUnread() : 0;
  $$('.bellbtn .bcount').forEach(el => { el.textContent = n > 99 ? '99+' : String(n); el.hidden = !n; });
  $$('.bellbtn').forEach(b => b.setAttribute('aria-label', n ? `Notifications, ${n} new` : 'Notifications'));
  if (NF.open) renderNotifPanel();
}
function renderNotifPanel() {
  const L = notifList();
  $('#notifBody').innerHTML = L.length ? `<div class="list nlist">${L.slice(0, 120).map(n => `<div class="li click nitem ${n.read ? '' : 'unread'}" data-nid="${n.id}"><span class="nicon">${NOTIF_ICON[n.kind] || '👑'}</span><div class="mmain"><div class="t2">${esc(n.title)}</div>${n.body ? `<div class="small muted">${esc(n.body)}</div>` : ''}<div class="small faint">${esc(ago(+new Date(n.at)))}</div></div></div>`).join('')}</div>`
    : '<div class="empty sm">Nothing yet. New orders, shipments, deliveries, cancellations, pre-order card problems and ACO checkouts show up here.</div>';
  $('#notifAll').disabled = !notifUnread(); $('#notifClear').disabled = !L.length;
}
function openNotifs() { NF.open = true; renderNotifPanel(); openDlg('dlgNotif'); }
function wireNotifs() {
  document.addEventListener('click', e => { if (e.target.closest('.bellbtn')) { e.preventDefault(); openNotifs(); } });
  $('#dlgNotif').addEventListener('close', () => { NF.open = false; });
  $('#notifBody').onclick = e => { const it = e.target.closest('[data-nid]'); if (!it) return; const n = notifList().find(x => x.id === it.dataset.nid); if (!n) return; n.read = true; save(); renderBell(); closeDlg('dlgNotif'); if (n.nav) go(...n.nav.split('/')); };
  $('#notifAll').onclick = () => { notifList().forEach(n => n.read = true); save(); renderBell(); };
  $('#notifClear').onclick = () => { state.notifications = []; save(); renderBell(); };
  $('#notifSet').onclick = () => { closeDlg('dlgNotif'); go('settings'); setTimeout(() => { const c = $('#notifCard'); if (c) c.scrollIntoView({ block: 'start' }); }, 120); };
}
// Settings → Notifications
function notifCardHtml() {
  const S = state.settings, K = S.notifyKinds || {}, blocked = typeof Notification !== 'undefined' && Notification.permission === 'denied', none = typeof Notification === 'undefined';
  return `<div class="card" id="notifCard"><h3>Notifications</h3>
    <div class="small muted" style="margin-bottom:8px">Everything new shows under the 🔔 bell. Turn on pop-ups to get them on this device too while Crown Tools is open or installed as an app.</div>
    <div class="chips"><button class="chip ${S.notify ? 'on' : ''}" id="stNotify">${S.notify ? 'Pop-ups on' : 'Pop-ups off'}</button><button class="chip" id="stNotifyTest" ${S.notify ? '' : 'hidden'}>Send a test</button></div>
    ${S.notify && blocked ? '<div class="note warn">Your browser is blocking notifications for Crown Tools. Allow them in the browser’s site settings.</div>' : ''}
    ${none ? '<div class="note small">This browser can’t show notifications. On iPhone, install Crown Tools to your home screen first (Share → Add to Home Screen).</div>' : ''}
    <div class="section">Tell me about</div>
    <div class="chips" id="stNotifyKinds">${NOTIF_KINDS.map(([k, l, i]) => `<button class="chip ${K[k] !== false ? 'on' : ''}" data-nk="${k}">${i} ${l}</button>`).join('')}</div></div>`;
}
function wireNotifCard() {
  const S = state.settings;
  $('#stNotify').onclick = async () => {
    if (!S.notify && typeof Notification !== 'undefined' && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch (_) { } }
    S.notify = !S.notify; save(); PAGES.settings.render();
  };
  $('#stNotifyTest').onclick = () => { const n = { id: uid(), kind: 'delivered', title: 'Notifications are working', body: 'This is what a Crown Tools notification looks like 👑', nav: 'dashboard' }; if (typeof Notification === 'undefined' || Notification.permission !== 'granted') { toast('Allow notifications for Crown Tools in your browser first'); return; } devicePop(n, true); toast('Test sent'); };
  $('#stNotifyKinds').onclick = e => { const b = e.target.closest('[data-nk]'); if (!b) return; S.notifyKinds = Object.assign({}, S.notifyKinds); S.notifyKinds[b.dataset.nk] = S.notifyKinds[b.dataset.nk] === false; save(); PAGES.settings.render(); };
}

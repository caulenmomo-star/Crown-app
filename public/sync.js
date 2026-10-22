/* Crown Tools - email sync engine, auto-sync, notifications, live tracking. */
'use strict';
const READER_VER = 5; // 5: cancellation reasons
let syncing = false, syncTimer = null, syncNextAt = 0;
const syncingIds = new Set(), syncProgress = {};
const MAX_SEEN = 40000;
// Online, every request signs in to the mailbox again, so use bigger batches and more at once.
const batchSize = () => CLOUD ? 30 : 20, parallel = () => CLOUD ? 6 : 3;
let seenSet = null, seenArr = null;
function seen() { if (!seenSet || seenArr !== state.seenIds) { seenSet = new Set(state.seenIds); seenArr = state.seenIds; } return seenSet; }
function markSeen(id) {
  if (!id || seen().has(id)) return;
  state.seenIds.push(id); seenSet.add(id);
  if (state.seenIds.length > MAX_SEEN) { state.seenIds.splice(0, state.seenIds.length - MAX_SEEN); seenSet = null; }
}
function addUnparsed(m, reason, store) {
  if (state.unparsed.some(u => u.messageId === m.messageId)) return;
  if (!Parser.looksLikeOrderMail(m.subject, store || Parser.detectStore(m.from, m.subject, ''))) return; // promos etc. never get listed
  if (isIgnoredSender(m.from)) return;
  state.unparsed.unshift({ messageId: m.messageId, subject: m.subject || '(no subject)', from: m.from || '', date: m.date || '', reason });
  if (state.unparsed.length > 200) state.unparsed.length = 200;
}
function softRefresh() {
  const a = document.activeElement;
  if (a && $('#main').contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) renderNav(); else refresh();
}
function setSyncStat() {
  const el = $('#syncStat'); if (!el) return;
  const accs = state.imapAccounts.filter(a => a.enabled !== false);
  let kind = '', text = 'Email sync off';
  if (!SERVER && state.imapAccounts.length) { kind = 'warn'; text = 'Email sync needs the helper'; }
  else if (syncing) { kind = 'busy'; text = 'Syncing email…'; }
  else if (accs.length) {
    const bad = accs.filter(a => a.lastResult && a.lastResult.error);
    const last = Math.max(0, ...accs.map(a => a.lastSync || 0));
    if (bad.length) { kind = 'bad'; text = plural(bad.length, 'inbox') + ' need attention'; }
    else { kind = last ? 'ok' : 'warn'; text = last ? 'Email synced ' + ago(last) : 'Not synced yet'; }
  }
  el.innerHTML = `<span class="dot ${kind}"></span><span class="ellipsis">${esc(text)}</span>`;
  const sd = $('#syncDot'); if (sd) { sd.className = 'sdot ' + kind; }
  const sb = $('#syncNowNav'); if (sb) { sb.title = text; sb.classList.toggle('spin', kind === 'busy'); }
  el.style.cursor = 'pointer'; el.onclick = () => go('inboxes');
}
setInterval(() => { if (cryptoKey) setSyncStat(); }, 30000);
let progressTimer = 0;
function showProgress() { if (progressTimer) return; progressTimer = setTimeout(() => { progressTimer = 0; if (route.page === 'inboxes' && cryptoKey) PAGES.inboxes.render(); }, 250); }

async function syncAccount(a, totals, opts) {
  opts = opts || {};
  syncingIds.add(a.id); syncProgress[a.id] = 'looking for order emails…'; showProgress();
  const res = { found: 0, created: 0, updated: 0, error: '' };
  const since = opts.days ? new Date(Date.now() - opts.days * 864e5) : a.lastSync ? new Date(a.lastSync - 3 * 864e5) : new Date(Date.now() - (a.lookback || 60) * 864e5);
  const tracked = state.settings.trackedStores && state.settings.trackedStores.length ? new Set(state.settings.trackedStores) : null;
  const label = a.label || a.user;
  const acc = accPayload(a);
  const process = m => {
    markSeen(m.messageId);
    let p = null;
    try { p = Parser.parseOrderEmail(m); } catch (e) { console.error('parse failed', e); addUnparsed(m, 'reader error'); return; }
    if (!p) return;
    res.found++;
    if (tracked && !tracked.has(p.store) && !(String(p.store).startsWith('shop:') && tracked.has('__shopify'))) return;
    const out = applyEmail(p, label, { reapply: !!opts.reapply });
    if (out.ignored) { res.found--; return; }
    if (out.skipped) { addUnparsed(m, out.skipped, p.store); return; }
    if (out.created) { res.created++; totals.created++; }
    else if (out.changed) {
      res.updated++; totals.updated++;
      const s = out.order.status; if (s === 'shipped' || s === 'ready' || s === 'out') totals.shipped++; else if (s === 'delivered') totals.delivered++; else if (isDead(out.order)) totals.cancelled++;
    }
  };
  try {
    const incremental = !opts.days && a.lastUid && a.uidValidity && a.folderSynced === (a.folder || 'INBOX');
    const scan = await api('/api/imap/scan', { account: acc, since: dayKey(since), afterUid: incremental ? a.lastUid : 0, uidValidity: incremental ? a.uidValidity : '', keywords: Parser.SUBJECT_KEYWORDS, patterns: Parser.SUBJECT_PATTERNS });
    if (!cryptoKey) return res;
    const skip = opts.fresh ? new Set() : seen();
    // When re-reading, only re-download emails for orders that are still on their way (to fix dates / statuses).
    const activeMids = new Set(); if (opts.reapply) state.orders.filter(isActive).forEach(o => (o.messageIds || []).forEach(m => activeMids.add(m)));
    const seenAll = seen();
    // Decide from the subject + sender alone whether an email is worth downloading at all.
    const todo = scan.candidates.filter(c => {
      if (activeMids.has(c.mid)) return true;
      if (!opts.full && (skip.has(c.mid) || (opts.reapply && seenAll.has(c.mid)))) return false;
      const junk = !Parser.classifyStatus(c.subject) || (c.from && isIgnoredSender(c.from)) || (c.from && !state.settings.trackUnknown && Parser.isNonStoreSender(c.from, c.subject));
      if (junk) { markSeen(c.mid); return false; }
      return true;
    });
    let done = 0, failedMin = Infinity, failMsg = '';
    const B = batchSize(); const chunks = []; for (let i = 0; i < todo.length; i += B) chunks.push(todo.slice(i, i + B));
    const total = todo.length;
    syncProgress[a.id] = total ? `reading 0 of ${total}` : ''; showProgress();
    let next = 0;
    const worker = async () => {
      while (next < chunks.length && cryptoKey) {
        const chunk = chunks[next++];
        try {
          const r = await api('/api/imap/bodies', { account: acc, uids: chunk.map(c => c.uid) });
          if (!cryptoKey) return;
          for (const m of r.messages) { if (m.error) { failedMin = Math.min(failedMin, m.uid); failMsg = m.error; } else process(m); }
          const later = r.deferred || [];
          if (later.length) chunks.push(chunk.filter(c => later.includes(c.uid))); // too big for one trip — fetch the rest next
          done += chunk.length - later.length;
        } catch (e) { failedMin = Math.min(failedMin, ...chunk.map(c => c.uid)); failMsg = e.message; done += chunk.length; }
        syncProgress[a.id] = `reading ${done} of ${total}`; showProgress();
      }
    };
    await Promise.all(Array.from({ length: Math.min(parallel(), chunks.length) }, worker));
    if (!cryptoKey) return res;
    a.uidValidity = scan.uidValidity || '';
    a.folderSynced = a.folder || 'INBOX';
    if (failedMin < Infinity) {
      // retry the ones that failed next time (and anything after them)
      a.lastUid = Math.max(incremental ? a.lastUid : 0, failedMin - 1);
      res.error = `Couldn’t download some emails (${failMsg}). They’ll be retried next sync.`;
    } else a.lastUid = Math.max(incremental ? a.lastUid : 0, scan.maxUid || 0);
    a.lastSync = Date.now(); a.lastResult = Object.assign({ at: Date.now(), mode: scan.mode, scanned: scan.scanned }, res);
  } catch (e) {
    res.error = e.message; a.lastResult = Object.assign({ at: Date.now() }, res);
  } finally {
    syncingIds.delete(a.id); delete syncProgress[a.id];
    state.syncLog.unshift({ at: Date.now(), label, found: res.found, created: res.created, updated: res.updated, error: res.error });
    if (state.syncLog.length > 60) state.syncLog.length = 60;
  }
  return res;
}
async function syncAll(manual, ids, opts) {
  if (!cryptoKey) return;
  if (!SERVER) { if (manual) toast('Email sync needs Crown Tools’ helper — open Crown Tools with Start Crown Tools'); return; }
  if (syncing) { if (manual) toast('Already syncing…'); return; }
  const accs = state.imapAccounts.filter(a => ids ? ids.includes(a.id) : a.enabled !== false);
  if (!accs.length) { if (manual) toast(state.imapAccounts.length ? 'All inboxes are paused' : 'Add an inbox first'); return; }
  syncing = true; clearTimeout(syncTimer); setSyncStat(); softRefresh();
  const totals = { created: 0, updated: 0, shipped: 0, delivered: 0, cancelled: 0 };
  const before = accs.map(a => JSON.stringify([a.lastResult && a.lastResult.error, a.uidValidity, a.lastSync ? 1 : 0])).join();
  let foundAny = false;
  const errors = [];
  try { await Promise.all(accs.map(async a => { const r = await syncAccount(a, totals, opts); if (r.found) foundAny = true; if (r.error) errors.push((a.label || a.user) + ': ' + r.error); })); }
  finally { syncing = false; }
  if (!cryptoKey) return;
  lastUndo = null; if (typeof relinkCheckouts === 'function') relinkCheckouts(); invalidateStats();
  const after = accs.map(a => JSON.stringify([a.lastResult && a.lastResult.error, a.uidValidity, a.lastSync ? 1 : 0])).join();
  if (foundAny || before !== after || pendingSave || manual) save(); // nothing new = nothing to save
  if (typeof rematchScans === 'function' && rematchScans()) save();
  scheduleSync(); setSyncStat(); softRefresh();
  if (typeof Alerts !== 'undefined') Alerts.run();
  setTimeout(() => refreshStaleTracking(), 1500);
  const parts = [];
  if (totals.created) parts.push(plural(totals.created, 'new order'));
  if (totals.shipped) parts.push(totals.shipped + ' shipped');
  if (totals.delivered) parts.push(totals.delivered + ' delivered');
  if (totals.cancelled) parts.push(totals.cancelled + ' cancelled');
  const otherUpd = totals.updated - totals.shipped - totals.delivered - totals.cancelled; if (otherUpd > 0) parts.push(plural(otherUpd, 'update'));
  if (parts.length && state.settings.notify && typeof Notification !== 'undefined' && Notification.permission === 'granted') { try { new Notification('Crown Tools', { body: parts.join(' · ') }); } catch (_) { } }
  if (manual) toast(errors.length ? errors[0] : parts.length ? 'Sync done: ' + parts.join(', ') : 'Sync done — nothing new');
}
async function rescan(id, days) {
  const a = state.imapAccounts.find(x => x.id === id); if (!a) return;
  if (!await ask(`Re-read every order email from the last ${days} days of ${a.label || a.user}?\n\nThis refills totals, items, pictures, addresses and tracking. Nothing is duplicated, but orders you deleted from that period will come back.`)) { if (route.page === 'inboxes') PAGES.inboxes.render(); return; }
  syncAll(true, [id], { days, fresh: true, reapply: true, full: true }).then(() => { if (!cryptoKey) return; regroupHouses(); state.orders.forEach(fillImages); autoLinkAll(); invalidateStats(); save(); refresh(); });
}
function scheduleSync() {
  clearTimeout(syncTimer); syncNextAt = 0;
  const m = state.settings.autoSyncMin;
  if (!SERVER || !cryptoKey || !m || !state.imapAccounts.some(a => a.enabled !== false)) return;
  syncNextAt = Date.now() + m * 60000;
  syncTimer = setTimeout(() => { if (document.visibilityState === 'hidden') { scheduleSync(); return; } syncAll(false); }, m * 60000);
}
function onUnlocked() {
  if (state.settings.theme) applyTheme(state.settings.theme);
  if (typeof maybeShowChangelog === 'function') maybeShowChangelog();
  // Drop anything in "couldn't read" that isn't a real-looking store order email (old builds listed promos there).
  const keepUn = state.unparsed.filter(u => Parser.looksLikeOrderMail(u.subject, Parser.detectStore(u.from, u.subject, '')) && !isIgnoredSender(u.from));
  if (keepUn.length !== state.unparsed.length) { state.unparsed = keepUn; save(); }
  if (state.ordersVer !== 2 && state.orders.length) {
    const merged = mergeSameNumber(); state.ordersVer = 2; invalidateStats(); save(); refresh();
    // Re-read recent emails once with the improved reader so delivery dates and delivered statuses get corrected.
    if (SERVER && state.imapAccounts.some(a => a.enabled !== false)) setTimeout(() => syncAll(false, null, { days: 45, fresh: true, reapply: true }), 2500);
    const junk = state.orders.filter(isSuspicious).length, dup = suggestedDuplicates().length;
    if (merged || junk || dup) setTimeout(() => toast(`Cleanup: merged ${plural(merged, 'duplicate order')}${junk || dup ? ` · ${junk + dup} more to review on the Orders page` : ''}`), 800);
  }
  // arrival dates only come from shipping emails / carrier tracking; confirmation guesses become "original order said"
  if (state.etaVer !== 3 && state.orders.length) { cleanEtas(); pruneUnparsed(); state.etaVer = 3; invalidateStats(); save(); refresh(); }
  if (state.houseVer !== 4 && state.orders.length) { regroupHouses(); invalidateStats(); save(); refresh(); }
  // 0.4.0: the email reader was rebuilt against real store emails (totals, items + pictures, addresses, tracking,
  // out-for-delivery). Re-read every order email once so existing orders fill in, then relink profiles and houses.
  const needReread = state.readerVer !== READER_VER;
  if (needReread) { if (SERVER && state.imapAccounts.some(a => a.enabled !== false)) setTimeout(() => rereadAll(true), 1500); else if (!state.imapAccounts.length) state.readerVer = READER_VER; }
  // one time: data made before auto-lock had a default gets 15 minutes (can be set back to Never in Settings)
  if (!state.settings.lockDefault) { if (!state.settings.autoLockMin) state.settings.autoLockMin = 15; state.settings.lockDefault = 1; save(); }
  if (state.syncVer !== 1) { if (!state.settings.autoSyncMin) state.settings.autoSyncMin = 5; state.syncVer = 1; save(); }
  setTimeout(() => refreshStaleTracking(), 4000);
  setTimeout(() => { if (cryptoKey && typeof refreshPrices === 'function') refreshPrices(false, true); }, 9000);
  // keep TCGplayer median prices fresh on a 6-hour cycle while the app is open.
  // The heartbeat ticks every 30 min; refreshPrices self-gates on the 6h throttle, so it only fetches once 6h have passed.
  if (!window._priceTimer) window._priceTimer = setInterval(() => { if (cryptoKey && typeof refreshPrices === 'function') refreshPrices(false, true); }, 30 * 60e3);
  setSyncStat(); scheduleSync();
  const m = state.settings.autoSyncMin; const accs = state.imapAccounts.filter(a => a.enabled !== false);
  // always catch up when Crown Tools is opened (the schedule only controls checks while it stays open)
  if (!needReread && SERVER && accs.length && accs.some(a => !a.lastSync || Date.now() - a.lastSync > Math.max(1, m || 2) * 60000)) setTimeout(() => syncAll(false), 2500);
}
// Re-read every order email in the lookback window with the current reader and refresh every order, house and link.
// Runs once automatically after a reader upgrade (it waits for any sync already running, never skips), and from the
// "Re-read all order emails" button. Only marked done when every inbox read without errors, so it retries otherwise.
let rereading = false;
// Older readers glued words onto order numbers ("102003655603099ARE" from "...#102003655603099are about to ship").
// Re-derive each email order's number from its email subjects so the pieces merge back into one order.
function fixOrderNumbers() {
  let n = 0;
  for (const o of state.orders) {
    if (o.source !== 'email' || !o.orderNumber) continue;
    const cur = Parser.normOrderNo(o.orderNumber);
    for (const e of o.emails || []) {
      const v = Parser.extractOrderNumber(e.subject || '', ''); const nv = Parser.normOrderNo(v);
      if (nv && nv !== cur && nv.length >= 6 && cur.startsWith(nv) && /^[A-Z]+$/.test(cur.slice(nv.length))) { o.orderNumber = v; n++; break; }
    }
    if (/^\d{6,}[A-Z]{2,}$/.test(Parser.normOrderNo(o.orderNumber))) { o.orderNumber = Parser.normOrderNo(o.orderNumber).replace(/[A-Z]+$/, ''); n++; }
  }
  return n;
}
async function rereadAll(auto) {
  if (rereading || !cryptoKey || !SERVER) return; rereading = true;
  try {
    const accs = state.imapAccounts.filter(a => a.enabled !== false); if (!accs.length) return;
    for (let i = 0; i < 1200 && syncing; i++) await new Promise(r => setTimeout(r, 500)); // wait for a running sync to finish
    if (!cryptoKey) return;
    const fixed = fixOrderNumbers(), merged0 = mergeSameNumber(); if (fixed || merged0) { invalidateStats(); save(); refresh(); }
    toast(auto ? 'Crown Tools’ email reader was upgraded — re-reading your order emails to fill in totals, items, pictures and addresses…' : 'Re-reading all order emails…');
    const days = Math.min(180, Math.max(60, ...accs.map(a => a.lookback || 60), state.settings.firstLookback || 60));
    await syncAll(false, accs.map(a => a.id), { days, fresh: true, reapply: true, full: true });
    if (!cryptoKey) return;
    const failed = accs.filter(a => a.lastResult && a.lastResult.error);
    fixOrderNumbers(); mergeSameNumber(); cleanEtas(); pruneUnparsed(); regroupHouses(); state.orders.forEach(fillImages); autoLinkAll(); pruneHouses(); invalidateStats();
    if (!failed.length) state.readerVer = READER_VER;
    save(); refresh();
    const withPics = state.orders.filter(o => (o.items || []).some(i => i.image)).length, inHouse = state.orders.filter(o => o.houseId).length;
    toast(failed.length ? `Re-read finished with problems: ${failed[0].lastResult.error} — it will try again next time` : `Re-read finished — ${inHouse} of ${plural(state.orders.length, 'order')} in houses, ${withPics} with pictures`);
  } finally { rereading = false; }
}
function onLocked() { clearTimeout(syncTimer); syncNextAt = 0; seenSet = null; }
// catch up right away when you come back to Crown Tools
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible' || !cryptoKey || syncing || rereading || !SERVER) return; const m = state.settings.autoSyncMin; const accs = state.imapAccounts.filter(a => a.enabled !== false); if (accs.length && accs.some(a => Date.now() - (a.lastSync || 0) > 60000)) syncAll(false); if (typeof refreshPrices === 'function') refreshPrices(false, true); });
$('#syncNowNav').onclick = () => syncAll(true);
$('#scanNav').onclick = () => openUniversalScanner();
Scan.wire(); wireItemDlg(); wireSaleDlg(); wireExpDlg(); wireFix(); wireAccDlg(); wireAccImport(); wireCardDlg(); wireCardAdd(); wireCardAssign(); wireBuilder(); $('#buildBtn').onclick = openBuilder; $('#addrBtn').onclick = () => openAddresses(view !== 'all' ? view : state.categories[0].id);

/* ---------- live tracking (EasyPost via helper) ---------- */
const EP_CARRIER = { UPS: 'UPS', USPS: 'USPS', FedEx: 'FedEx', DHL: 'DHLExpress', OnTrac: 'OnTrac', 'Canada Post': 'CanadaPost' };
const carrierKeys = () => { const c = state.settings.carriers || {}; return { ups: c.ups && c.ups.id ? c.ups : null, fedex: c.fedex && c.fedex.id ? c.fedex : null, usps: c.usps && c.usps.id ? c.usps : null }; };
// Is there any way to look packages up? (UPS / FedEx developer keys, an EasyPost key, or the Mac helper trying ups.com)
const trackingReady = () => { const k = carrierKeys(); return !!(k.ups || k.fedex || k.usps || state.settings.easypostKey || (SERVER && !CLOUD)); };
const ymdOnly = v => { const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : (v ? dayKey(new Date(v)) : ''); };
// Apply what the carrier says to the order: the real arrival date, out for delivery, delivered (and on which day).
function applyTracking(o) {
  if (isDead(o)) return;
  const live = (o.tracking || []).map(t => t.live).filter(Boolean); if (!live.length) return;
  const pending = live.filter(l => l.status !== 'delivered');
  if (!pending.length && live.length === o.tracking.length) {
    const day = live.map(l => l.deliveredOn).filter(Boolean).sort().pop();
    if (o.status !== 'delivered') setStatus(o, 'delivered', day ? day + 'T12:00:00' : new Date().toISOString(), 'tracking');
    if (day && (!o.deliveredFromEmail || !o.deliveredAt)) o.deliveredAt = day + 'T12:00:00';
    return;
  }
  if (pending.some(l => l.status === 'out_for_delivery') && STATUS[o.status].r < STATUS.out.r) setStatus(o, 'out', new Date().toISOString(), 'tracking');
  else if (pending.some(l => ['in_transit', 'out_for_delivery'].includes(l.status)) && STATUS[o.status].r < STATUS.shipped.r) setStatus(o, 'shipped', new Date().toISOString(), 'tracking');
  // the carrier's estimate is the truth for the arrival date (latest package wins); a date you typed in stays
  const est = pending.map(l => l.est).filter(Boolean).sort().pop();
  if (est && !o.etaLocked && isActive(o)) { o.eta = est; o.etaEnd = ''; o.etaFrom = (pending.find(l => l.est === est) || {}).carrier + ' tracking'; o.etaAt = new Date().toISOString(); }
}
async function liveTrack(orderId, idx, btn, quiet) {
  const o = state.orders.find(x => x.id === orderId); if (!o || !o.tracking[idx]) return false;
  if (!SERVER) { if (!quiet) toast('Live tracking needs Crown Tools’ helper running'); return false; }
  const t = o.tracking[idx];
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  try {
    const r = await api('/api/track', { apiKey: state.settings.easypostKey, carriers: carrierKeys(), tracking: t.number, carrier: EP_CARRIER[t.carrier] || '' });
    if (!cryptoKey) return false;
    const evs = r.events || [];
    const delDay = r.deliveredOn ? ymdOnly(r.deliveredOn) : r.status === 'delivered' ? ymdOnly((evs.slice(-1)[0] || {}).date) : '';
    t.live = { status: r.status, est: ymdOnly(r.est), deliveredOn: delDay, carrier: r.carrier || t.carrier || '', text: r.statusText || '', events: evs, publicUrl: r.publicUrl, checkedAt: Date.now() };
    if (r.carrier && !t.carrier) t.carrier = r.carrier;
    applyTracking(o);
    o.updatedAt = Date.now(); save();
    if ($('#dlgOrder').open && curOrder && curOrder.id === o.id) { curOrder = JSON.parse(JSON.stringify(o)); renderOrderDlg(); }
    if (!quiet) softRefresh();
    return true;
  } catch (e) {
    t.liveError = { msg: e.message, at: Date.now() };
    if (!quiet) toast(e.message); if (btn) { btn.disabled = false; btn.textContent = 'Live tracking'; } return false;
  }
}
// After each sync (and when you open Crown Tools), quietly check packages that haven't been checked recently.
let trackBusy = false;
async function refreshStaleTracking(force) {
  if (trackBusy || !SERVER || !trackingReady()) return; trackBusy = true;
  try {
    const jobs = []; const stale = Date.now() - (force ? 0 : 2 * 3600e3);
    state.orders.filter(o => isActive(o) && o.tracking.length).forEach(o => o.tracking.forEach((t, i) => {
      if (t.live && t.live.status === 'delivered') return;
      if (!force && t.liveError && Date.now() - t.liveError.at < 3600e3) return; // don't hammer a failing lookup
      if (!t.live || (t.live.checkedAt || 0) < stale) jobs.push([o.id, i, t.live ? t.live.checkedAt || 0 : 0]);
    }));
    jobs.sort((a, b) => a[2] - b[2]);
    let n = 0; const list = jobs.slice(0, force ? 150 : 60);
    for (let i = 0; i < list.length; i += 4) { if (!cryptoKey) return; const r = await Promise.all(list.slice(i, i + 4).map(([id, k]) => liveTrack(id, k, null, true))); n += r.filter(Boolean).length; }
    if (n) { invalidateStats(); softRefresh(); if (typeof Alerts !== 'undefined') Alerts.run(); }
    return n;
  } finally { trackBusy = false; }
}
async function refreshAllTracking() {
  const total = state.orders.filter(o => isActive(o) && o.tracking.length).reduce((a, o) => a + o.tracking.length, 0);
  if (!total) { toast('No active orders with tracking numbers'); return; }
  if (!trackingReady()) { toast('Add your free UPS / FedEx / USPS keys in Settings → Carrier tracking first'); return; }
  toast(`Checking ${plural(Math.min(total, 150), 'package')}…`);
  const ok = await refreshStaleTracking(true) || 0;
  softRefresh(); const errs = state.orders.flatMap(o => o.tracking).filter(t => t.liveError && Date.now() - t.liveError.at < 120000);
  toast(`Updated ${plural(ok, 'package')}${errs.length ? ' · ' + errs.length + ' failed: ' + errs[0].liveError.msg : ''}`);
}

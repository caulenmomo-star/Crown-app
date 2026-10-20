/* Crown - email sync engine, auto-sync, notifications, live tracking. */
'use strict';
let syncing = false, syncTimer = null, syncNextAt = 0;
const syncingIds = new Set(), syncProgress = {};
const MAX_SEEN = 40000;
const BODY_BATCH = 20, PARALLEL = 3;
let seenSet = null, seenArr = null;
function seen() { if (!seenSet || seenArr !== state.seenIds) { seenSet = new Set(state.seenIds); seenArr = state.seenIds; } return seenSet; }
function markSeen(id) {
  if (!id || seen().has(id)) return;
  state.seenIds.push(id); seenSet.add(id);
  if (state.seenIds.length > MAX_SEEN) { state.seenIds.splice(0, state.seenIds.length - MAX_SEEN); seenSet = null; }
}
function addUnparsed(m, reason) {
  if (state.unparsed.some(u => u.messageId === m.messageId)) return;
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
    if (tracked && !tracked.has(p.store)) return;
    const out = applyEmail(p, label, { reapply: !!opts.reapply });
    if (out.ignored) { res.found--; return; }
    if (out.skipped) { addUnparsed(m, out.skipped); return; }
    if (out.created) { res.created++; totals.created++; }
    else if (out.changed) {
      res.updated++; totals.updated++;
      const s = out.order.status; if (s === 'shipped' || s === 'ready') totals.shipped++; else if (s === 'delivered') totals.delivered++; else if (isDead(out.order)) totals.cancelled++;
    }
  };
  try {
    const incremental = !opts.days && a.lastUid && a.uidValidity && a.folderSynced === (a.folder || 'INBOX');
    const scan = await api('/api/imap/scan', { account: acc, since: dayKey(since), afterUid: incremental ? a.lastUid : 0, uidValidity: incremental ? a.uidValidity : '', keywords: Parser.SUBJECT_KEYWORDS, patterns: Parser.SUBJECT_PATTERNS });
    if (!cryptoKey) return res;
    const skip = opts.fresh ? new Set() : seen();
    const todo = scan.candidates.filter(c => !skip.has(c.mid));
    let done = 0, failedMin = Infinity, failMsg = '';
    const chunks = []; for (let i = 0; i < todo.length; i += BODY_BATCH) chunks.push(todo.slice(i, i + BODY_BATCH));
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
    await Promise.all(Array.from({ length: Math.min(PARALLEL, chunks.length) }, worker));
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
  if (!SERVER) { if (manual) toast('Email sync needs Crown’s helper — open Crown with Start Crown.command'); return; }
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
  lastUndo = null; invalidateStats();
  const after = accs.map(a => JSON.stringify([a.lastResult && a.lastResult.error, a.uidValidity, a.lastSync ? 1 : 0])).join();
  if (foundAny || before !== after || pendingSave || manual) save(); // nothing new = nothing to save
  scheduleSync(); setSyncStat(); softRefresh();
  const parts = [];
  if (totals.created) parts.push(plural(totals.created, 'new order'));
  if (totals.shipped) parts.push(totals.shipped + ' shipped');
  if (totals.delivered) parts.push(totals.delivered + ' delivered');
  if (totals.cancelled) parts.push(totals.cancelled + ' cancelled');
  const otherUpd = totals.updated - totals.shipped - totals.delivered - totals.cancelled; if (otherUpd > 0) parts.push(plural(otherUpd, 'update'));
  if (parts.length && state.settings.notify && typeof Notification !== 'undefined' && Notification.permission === 'granted') { try { new Notification('Crown', { body: parts.join(' · ') }); } catch (_) { } }
  if (manual) toast(errors.length ? errors[0] : parts.length ? 'Sync done: ' + parts.join(', ') : 'Sync done — nothing new');
}
function rescan(id, days) {
  const a = state.imapAccounts.find(x => x.id === id); if (!a) return;
  if (!confirm(`Re-read the last ${days} days of ${a.label || a.user}?\n\nThis refreshes delivery dates and statuses. Nothing is duplicated, but orders you deleted from that period will come back.`)) { if (route.page === 'inboxes') PAGES.inboxes.render(); return; }
  syncAll(true, [id], { days, fresh: true, reapply: true });
}
function scheduleSync() {
  clearTimeout(syncTimer); syncNextAt = 0;
  const m = state.settings.autoSyncMin;
  if (!SERVER || !cryptoKey || !m || !state.imapAccounts.some(a => a.enabled !== false)) return;
  syncNextAt = Date.now() + m * 60000;
  syncTimer = setTimeout(() => { if (document.visibilityState === 'hidden') { scheduleSync(); return; } syncAll(false); }, m * 60000);
}
function onUnlocked() {
  if (state.ordersVer !== 2 && state.orders.length) {
    const merged = mergeSameNumber(); state.ordersVer = 2; invalidateStats(); save(); refresh();
    // Re-read recent emails once with the improved reader so delivery dates and delivered statuses get corrected.
    if (SERVER && state.imapAccounts.some(a => a.enabled !== false)) setTimeout(() => syncAll(false, null, { days: Math.min(120, Math.max(30, ...state.imapAccounts.map(a => a.lookback || 60))), fresh: true, reapply: true }), 2500);
    const junk = state.orders.filter(isSuspicious).length, dup = suggestedDuplicates().length;
    if (merged || junk || dup) setTimeout(() => toast(`Cleanup: merged ${plural(merged, 'duplicate order')}${junk || dup ? ` · ${junk + dup} more to review on the Orders page` : ''}`), 800);
  }
  if (state.houseVer !== 2 && state.orders.length) { regroupHouses(); invalidateStats(); save(); refresh(); }
  setSyncStat(); scheduleSync();
  const m = state.settings.autoSyncMin; const accs = state.imapAccounts.filter(a => a.enabled !== false);
  if (SERVER && m && accs.length && accs.some(a => !a.lastSync || Date.now() - a.lastSync > m * 60000)) setTimeout(() => syncAll(false), 2500);
}
function onLocked() { clearTimeout(syncTimer); syncNextAt = 0; seenSet = null; }
// catch up right away when you come back to Crown
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible' || !cryptoKey || syncing || !SERVER) return; const m = state.settings.autoSyncMin; const accs = state.imapAccounts.filter(a => a.enabled !== false); if (m && accs.length && accs.some(a => Date.now() - (a.lastSync || 0) > 60000)) syncAll(false); });
$('#syncNowNav').onclick = () => syncAll(true);

/* ---------- live tracking (EasyPost via helper) ---------- */
const EP_CARRIER = { UPS: 'UPS', USPS: 'USPS', FedEx: 'FedEx', DHL: 'DHLExpress' };
async function liveTrack(orderId, idx, btn, quiet) {
  const o = state.orders.find(x => x.id === orderId); if (!o || !o.tracking[idx]) return false;
  if (!SERVER) { if (!quiet) toast('Live tracking needs Crown’s helper running'); return false; }
  const t = o.tracking[idx];
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  try {
    const r = await api('/api/track', { apiKey: state.settings.easypostKey, tracking: t.number, carrier: EP_CARRIER[t.carrier] || '' });
    if (!cryptoKey) return false;
    t.live = { status: r.status, est: r.est ? dayKey(new Date(r.est)) : '', events: r.events, publicUrl: r.publicUrl, checkedAt: Date.now() };
    if (r.carrier && !t.carrier) t.carrier = r.carrier;
    if (r.status === 'delivered' && o.status !== 'delivered' && !isDead(o)) { const last = (r.events || []).slice(-1)[0]; setStatus(o, 'delivered', last && last.date || new Date().toISOString(), 'tracking'); }
    else if (['in_transit', 'out_for_delivery'].includes(r.status) && STATUS[o.status].r < STATUS.shipped.r) setStatus(o, 'shipped', new Date().toISOString(), 'tracking');
    if (t.live.est && isActive(o)) o.eta = t.live.est;
    o.updatedAt = Date.now(); save();
    if ($('#dlgOrder').open && curOrder && curOrder.id === o.id) { curOrder = JSON.parse(JSON.stringify(o)); renderOrderDlg(); }
    if (!quiet) softRefresh();
    return true;
  } catch (e) { if (!quiet) toast(e.message); if (btn) { btn.disabled = false; btn.textContent = 'Live tracking'; } return false; }
}
async function refreshAllTracking() {
  const jobs = []; state.orders.filter(o => isActive(o) && o.tracking.length).slice(0, 60).forEach(o => o.tracking.forEach((t, i) => jobs.push([o.id, i])));
  if (!jobs.length) { toast('No active orders with tracking numbers'); return; }
  toast(`Checking ${plural(jobs.length, 'package')}…`); let ok = 0;
  for (const [id, i] of jobs) { if (!cryptoKey) return; if (await liveTrack(id, i, null, true)) ok++; }
  softRefresh(); toast(`Updated ${ok} of ${plural(jobs.length, 'package')}${ok < jobs.length ? ' — check your EasyPost key if this keeps failing' : ''}`);
}

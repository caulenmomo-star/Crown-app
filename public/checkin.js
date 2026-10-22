/* Crown Tools - check-in (delivered boxes stay flagged until you scan them in) and Discord alerts per house. */
'use strict';

/* ---------- check-in ---------- */
// Only deliveries after check-in was turned on are flagged, so years of old orders don't all show up at once.
function checkinSince() { return state.settings.checkinSince || ''; }
const pkgCheckedIn = t => !!(t && t.checkedAt);
function orderCheckedIn(o) {
  if (o.checkin) return true;
  const tr = (o.tracking || []).filter(t => t.number);
  return tr.length > 0 && tr.every(pkgCheckedIn);
}
function needsCheckin(o) {
  if (o.status !== 'delivered' || orderCheckedIn(o) || o.checkinSkip) return false;
  const since = checkinSince(); if (!since) return false;
  const d = toDate(o.deliveredAt) || toDate((o.history || []).filter(h => h.status === 'delivered').map(h => h.date).pop());
  return !!d && dayKey(d) >= since;
}
function checkinWaiting() { return state.orders.filter(needsCheckin).sort((a, b) => String(b.deliveredAt).localeCompare(String(a.deliveredAt))); }
function boxesLeft(o) { const tr = (o.tracking || []).filter(t => t.number); return tr.length ? tr.filter(t => !pkgCheckedIn(t)).length : 1; }

// Mark one package (or the whole order) as in hand. A box you scan is delivered, even if the carrier hasn't said so yet.
function checkIn(o, idx, how) {
  const now = new Date().toISOString();
  if (idx != null && o.tracking[idx]) o.tracking[idx].checkedAt = now; else { o.checkin = { at: now, how: how || 'manual' }; (o.tracking || []).forEach(t => { if (!t.checkedAt) t.checkedAt = now; }); }
  if (o.status !== 'delivered' && !isDead(o)) setStatus(o, 'delivered', now, how === 'scan' ? 'scan' : 'manual', 'Checked in');
  if (orderCheckedIn(o) && !o.checkin) o.checkin = { at: now, how: how || 'manual' };
  o.updatedAt = Date.now();
  if (orderCheckedIn(o)) { Alerts.queue(o, 'checkin'); if (typeof invAfterCheckin === 'function') invAfterCheckin(o); }
}
function undoCheckIn(o) { delete o.checkin; (o.tracking || []).forEach(t => delete t.checkedAt); o.updatedAt = Date.now(); }

// What happens when a label is scanned on the check-in screen
function scanLabel(code) {
  const hit = findPackage(code);
  if (!hit) {
    state.unmatchedScans = [{ code, at: Date.now() }].concat((state.unmatchedScans || []).filter(x => x.code !== code)).slice(0, 50); save();
    return { ok: false, warn: true, msg: 'Not in any order yet — saved under “Scanned, no order”' };
  }
  const { o, i } = hit; const h = o.houseId && houseById(o.houseId);
  if (pkgCheckedIn(o.tracking[i])) return { ok: true, warn: true, msg: `Already checked in · ${shortTitle(o) || '#' + o.orderNumber}` };
  checkIn(o, i, 'scan'); save(); softRefresh();
  const left = boxesLeft(o);
  return { ok: true, msg: `✓ ${shortTitle(o) || '#' + o.orderNumber}${h ? ' → ' + houseLabel(h) : ''}${left ? ` · ${left} more box${left === 1 ? '' : 'es'} in this order` : ''}` };
}
// One scanner for everything: shipping labels check in, product barcodes go to inventory
async function scanAnything(code) {
  if (findPackage(code)) return scanLabel(code);
  if (isProductCode(code) && typeof invScanCode === 'function') return invScanCode(code);
  return scanLabel(code);
}
function openCheckinScanner() {
  Scan.open({ title: 'Check in packages', sub: 'Scan the barcode on each shipping label. Keep going — every box is checked off as you scan it.', hint: 'Point the camera at the label’s barcode', onCode: c => scanLabel(c), onClose: () => softRefresh() });
}
function openUniversalScanner() {
  Scan.open({ title: 'Scan', sub: 'Shipping labels are checked in. Product barcodes open in Inventory.', hint: 'Point the camera at any barcode', onCode: c => scanAnything(c), onClose: () => softRefresh() });
}

PAGES.checkin = {
  render() {
    const pg = $('#pg-checkin');
    if (!checkinSince()) {
      pg.innerHTML = `<div class="pagehead"><h1>Check-in</h1></div>
        <div class="card" style="max-width:640px"><h3>📦 Scan boxes in as they arrive</h3>
        <div class="muted" style="margin-bottom:12px">When an order is delivered it stays flagged here until you scan its shipping label (or tap Check in). You always know which boxes made it into your hands and which are still sitting on a porch — per house.</div>
        <div class="hstack" style="flex-wrap:wrap"><button class="primary" id="ciOn">Turn on check-in</button><select id="ciFrom" style="width:auto"><option value="0">Starting today</option><option value="3">Include the last 3 days</option><option value="7">Include the last 7 days</option><option value="30">Include the last 30 days</option></select></div></div>`;
      $('#ciOn').onclick = () => { const n = +$('#ciFrom').value; state.settings.checkinSince = dayKey(new Date(Date.now() - n * 864e5)); save(); refresh(); };
      return;
    }
    const wait = checkinWaiting();
    const byHouse = new Map(); wait.forEach(o => { const k = o.houseId || ''; if (!byHouse.has(k)) byHouse.set(k, []); byHouse.get(k).push(o); });
    const groups = [...byHouse.entries()].sort((a, b) => b[1].length - a[1].length);
    const recent = state.orders.filter(o => o.checkin && Date.now() - (toDate(o.checkin.at) || 0) < 3 * 864e5).sort((a, b) => String(b.checkin.at).localeCompare(String(a.checkin.at))).slice(0, 12);
    const un = state.unmatchedScans || [];
    const row = o => { const left = boxesLeft(o), tot = (o.tracking || []).filter(t => t.number).length; return `<div class="li dli ciitem">
        ${thumb(orderImage(o), 'sm')}<div class="mmain click" data-order="${o.id}"><div class="t2">${esc(shortTitle(o)) || '#' + esc(o.orderNumber)}</div><div class="small muted ellipsis">${esc(Parser.storeInfo(o.store).label)} · delivered ${esc(relDay(o.deliveredAt))}${tot > 1 ? ` · ${tot - left} of ${tot} boxes in` : ''}${o.tracking[0] ? ' · <span class="mono">…' + esc(String(o.tracking[0].number).slice(-6)) + '</span>' : ''}</div></div>
        <div class="dright hstack" style="gap:6px"><button class="sm" data-ci="${o.id}">Check in</button><button class="ghost sm" data-ciskip="${o.id}" title="Not coming / don’t track">✕</button></div></div>`; };
    pg.innerHTML = `<div class="pagehead"><h1>Check-in</h1><span class="sub">${wait.length ? plural(wait.length, 'delivered order') + ' not checked in' : 'Everything delivered is checked in'}</span><div class="spacer"></div>
        <button class="primary" id="ciScan">📷 Scan labels</button>${wait.length ? '<button id="ciAll">Check in all</button>' : ''}<button class="ghost" id="ciSettings">Settings</button></div>
      ${groups.length ? groups.map(([hid, os]) => { const h = houseById(hid); return `<div class="card" style="margin-bottom:12px"><h3>${h ? '🏠 ' + esc(houseLabel(h)) : 'No house'} <span class="badge">${plural(sum(os, boxesLeft), 'box', 'boxes')}</span><span class="spacer"></span>${h ? `<button class="ghost sm" data-nav="houses/${h.id}">House ›</button>` : ''}</h3><div class="list">${os.map(row).join('')}</div></div>`; }).join('')
        : `<div class="empty">All clear. 👑 Delivered boxes show up here until you scan them in.</div>`}
      ${un.length ? `<div class="card" style="margin-bottom:12px"><h3>Scanned, no order <span class="badge">${un.length}</span><span class="spacer"></span><button class="ghost sm" id="ciUnClear">Clear</button></h3><div class="small muted" style="margin-bottom:8px">These labels didn’t match any order’s tracking number. They’re checked again after each email sync.</div><div class="list">${un.map(x => `<div class="li"><span class="mono small" style="flex:1;min-width:0;overflow-wrap:anywhere">${esc(x.code)}</span><span class="small faint">${esc(ago(x.at))}</span></div>`).join('')}</div></div>` : ''}
      ${recent.length ? `<div class="card"><h3>Checked in recently</h3><div class="list">${recent.map(o => `<div class="li dli">${thumb(orderImage(o), 'sm')}<div class="mmain click" data-order="${o.id}"><div class="t2">${esc(shortTitle(o)) || '#' + esc(o.orderNumber)}</div><div class="small muted ellipsis">${o.houseId ? esc(houseLabel(houseById(o.houseId))) + ' · ' : ''}${esc(fmtDT(o.checkin.at))}${o.checkin.how === 'scan' ? ' · scanned' : ''}</div></div><button class="ghost sm" data-ciundo="${o.id}">Undo</button></div>`).join('')}</div></div>` : ''}`;
    $('#ciScan').onclick = openCheckinScanner;
    $('#ciSettings').onclick = () => { go('settings'); setTimeout(() => { const c = $('#alertCard'); if (c) c.scrollIntoView({ block: 'start' }); }, 120); };
    if ($('#ciAll')) $('#ciAll').onclick = async () => { if (!await ask(`Check in all ${plural(wait.length, 'order')}?`)) return; snapshot('check in all'); wait.forEach(o => checkIn(o, null, 'manual')); save(); refresh(); Alerts.run(); toast('Checked in', { undo: true }); };
    if ($('#ciUnClear')) $('#ciUnClear').onclick = () => { state.unmatchedScans = []; save(); refresh(); };
    pg.querySelectorAll('[data-ci]').forEach(b => b.onclick = () => { const o = state.orders.find(x => x.id === b.dataset.ci); if (!o) return; checkIn(o, null, 'manual'); save(); refresh(); Alerts.run(); });
    pg.querySelectorAll('[data-ciskip]').forEach(b => b.onclick = () => { const o = state.orders.find(x => x.id === b.dataset.ciskip); if (!o) return; snapshot('skip check-in'); o.checkinSkip = true; o.updatedAt = Date.now(); save(); refresh(); toast('Removed from check-in', { undo: true }); });
    pg.querySelectorAll('[data-ciundo]').forEach(b => b.onclick = () => { const o = state.orders.find(x => x.id === b.dataset.ciundo); if (!o) return; undoCheckIn(o); save(); refresh(); });
    pg.querySelectorAll('[data-order]').forEach(el => el.onclick = () => openOrder(el.dataset.order));
  },
};
// After a sync: labels scanned before their order email arrived get checked in now
function rematchScans() {
  const un = state.unmatchedScans || []; if (!un.length) return 0;
  let n = 0; state.unmatchedScans = un.filter(x => { const hit = findPackage(x.code); if (!hit) return true; if (!pkgCheckedIn(hit.o.tracking[hit.i])) { checkIn(hit.o, hit.i, 'scan'); n++; } return false; });
  return n;
}

/* ---------- Discord alerts ---------- */
const Alerts = (() => {
  const COLORS = { delivered: 0x3ecf8e, out: 0xff7a45, shipped: 0xf5a524, checkin: 0x7c8cff, cancelled: 0xef5b5b };
  const TITLES = { delivered: '📦 Delivered', out: '🚚 Out for delivery', shipped: '✈️ Shipped', checkin: '✅ Checked in', cancelled: '❌ Cancelled' };
  const S = () => state.settings.alerts || {};
  const hookFor = o => { const h = o.houseId && houseById(o.houseId); return (h && h.discord) || S().url || ''; };
  let busy = false;
  // only changes that happen after alerts were turned on are sent - never a flood of old orders
  function statusTime(o, st) { const h = (o.history || []).filter(x => x.status === st).map(x => x.date).sort().pop(); return h ? (toDate(h) || new Date(0)).getTime() : 0; }
  function due() {
    const a = S(); if (!a.on || !a.since) return [];
    const out = [];
    for (const o of state.orders) {
      if (!hookFor(o)) continue;
      const sent = o.alerted || {};
      for (const ev of ['out', 'delivered', 'cancelled']) {
        if (!a[ev] || sent[ev]) continue;
        if (ev === 'cancelled' ? !isDead(o) : o.status !== ev) continue;
        const t = statusTime(o, ev === 'cancelled' ? o.status : ev);
        if (t >= a.since && Date.now() - t < 3 * 864e5) out.push([o, ev]);
      }
    }
    return out;
  }
  function embed(o, ev) {
    const h = o.houseId && houseById(o.houseId); const tr = (o.tracking || [])[0];
    const items = (o.items || []).slice(0, 6).map(i => `${qtyOf(i)}× ${i.name}`).join('\n') || o.subject || 'Order';
    const fields = [{ name: 'Store', value: Parser.storeInfo(o.store).label, inline: true }];
    if (o.orderNumber) fields.push({ name: 'Order', value: '#' + o.orderNumber, inline: true });
    if (o.total != null && o.total !== '') fields.push({ name: 'Total', value: fmtMoney(o.total), inline: true });
    if (h) fields.push({ name: 'House', value: houseLabel(h) + (h.nickname ? '\n' + houseAddr(h) : ''), inline: false });
    if (o.name) fields.push({ name: 'Name on order', value: o.name, inline: true });
    if (tr) fields.push({ name: (tr.carrier || 'Tracking'), value: tr.number, inline: true });
    const prof = o.profileId && profileById(o.profileId); if (prof) fields.push({ name: 'Profile', value: prof.name || '—', inline: true });
    return { title: TITLES[ev] + (h ? ' — ' + houseLabel(h) : ''), description: items.slice(0, 900), color: COLORS[ev], fields, thumbnail: orderImage(o) ? { url: orderImage(o) } : undefined, timestamp: new Date().toISOString(), footer: { text: 'Crown Tools' } };
  }
  const pending = [];
  function queue(o, ev) { const a = S(); if (!a.on || !a[ev] || !hookFor(o)) return; if ((o.alerted || {})[ev]) return; pending.push([o, ev]); }
  async function run() {
    if (busy || !cryptoKey || !SERVER) return; busy = true;
    try {
      const list = due().concat(pending.splice(0));
      if (!list.length) return;
      const seen = new Set(); const byHook = new Map();
      for (const [o, ev] of list) { const k = o.id + ev; if (seen.has(k)) continue; seen.add(k); const u = hookFor(o); if (!byHook.has(u)) byHook.set(u, []); byHook.get(u).push([o, ev]); }
      let sent = 0, err = '';
      for (const [url, items] of byHook) {
        for (let i = 0; i < items.length; i += 10) {
          const chunk = items.slice(i, i + 10);
          chunk.forEach(([o, ev]) => { o.alerted = Object.assign({}, o.alerted, { [ev]: Date.now() }); }); // mark first so two devices don't both send
          try { await api('/api/discord', { url, payload: { username: 'Crown Tools', embeds: chunk.map(([o, ev]) => embed(o, ev)) } }); sent += chunk.length; }
          catch (e) { err = e.message; if (/doesn't exist|isn't a Discord/.test(e.message)) break; chunk.forEach(([o, ev]) => { delete o.alerted[ev]; }); }
        }
      }
      if (sent || err) save();
      if (err) state.settings.alerts = Object.assign({}, S(), { lastError: err, lastErrorAt: Date.now() });
    } finally { busy = false; }
  }
  async function test(url, h) {
    await api('/api/discord', { url, payload: { username: 'Crown Tools', embeds: [{ title: '👑 Crown Tools is connected' + (h ? ' — ' + houseLabel(h) : ''), description: h ? 'Alerts for this house will show up here.' : 'Delivery alerts will show up here.', color: 0x7c8cff, timestamp: new Date().toISOString() }] } });
  }
  return { run, queue, test, embed };
})();

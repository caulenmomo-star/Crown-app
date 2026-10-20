/* Crown - Orders & Houses: data model, email ingestion, profile linking, house grouping, pages, dialogs. */
'use strict';

/* ================= data helpers ================= */
const profileById = id => state.profiles.find(p => p.id === id);
const houseById = id => state.houses.find(h => h.id === id);
const houseOrders = id => state.orders.filter(o => o.houseId === id);
const houseLabel = h => h ? (h.nickname || h.addr1 || 'Unknown house') : '—';
const houseAddr = h => h ? [h.addr1, [h.city, [h.state, h.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ') : '';
const orderAddr = o => [o.addr1, o.addr2, o.city, [o.state, o.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
const orderTitle = o => o.items && o.items.length ? o.items[0].name + (o.items.length > 1 ? ` +${o.items.length - 1} more` : '') : (o.subject || '');
const itemCount = o => sum(o.items || [], i => Number(i.qty) || 1);
function findOrder(no, store) {
  const n = Parser.normOrderNo(no); if (!n) return null;
  return state.orders.find(o => Parser.normOrderNo(o.orderNumber) === n && (!store || !o.store || store === 'other' || o.store === 'other' || o.store === store)) || null;
}
function newOrder(fields) {
  return Object.assign({ id: uid(), orderNumber: '', store: 'other', status: 'placed', orderDate: new Date().toISOString(), total: null, items: [], recipientEmail: '', name: '', addr1: '', addr2: '', city: '', state: '', zip: '', houseId: '', profileId: '', profileLink: '', last4: '', tracking: [], eta: '', deliveredAt: '', notes: '', history: [], emails: [], messageIds: [], source: 'manual', createdAt: Date.now(), updatedAt: Date.now() }, fields || {});
}
function setStatus(o, status, date, source, note) {
  if (!STATUS[status]) return false;
  const prev = o.status;
  o.history.push({ status, date: date || new Date().toISOString(), source: source || 'manual', note: note || '' });
  o.history.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  o.status = status;
  if (status === 'delivered' && !o.deliveredAt) o.deliveredAt = date || new Date().toISOString();
  return prev !== status;
}

/* ---------- houses ---------- */
function titleAddr(s) { return String(s || '').replace(/\b([a-z])([a-z]*)/gi, (m, a, b) => /^(ne|nw|se|sw|n|s|e|w|po)$/i.test(m) ? m.toUpperCase() : a.toUpperCase() + b.toLowerCase()); }
function resolveHouse(o) {
  const key = Parser.houseKey(o.addr1, o.zip);
  if (!key) { o.houseId = ''; return null; }
  let h = state.houses.find(h => (h.keys || []).includes(key));
  if (!h) {
    // tolerate a missing ZIP on one side
    const street = key.split('|')[0];
    h = state.houses.find(h => (h.keys || []).some(k => k.split('|')[0] === street && (!k.split('|')[1] || !key.split('|')[1])));
  }
  if (!h) { h = { id: uid(), keys: [key], addr1: titleAddr(o.addr1), city: titleAddr(o.city), state: String(o.state || '').toUpperCase(), zip: Parser.zip5(o.zip), nickname: '', notes: '', createdAt: Date.now() }; state.houses.push(h); }
  else if (!h.keys.includes(key)) h.keys.push(key);
  if (!h.zip && o.zip) h.zip = Parser.zip5(o.zip);
  if (!h.city && o.city) h.city = titleAddr(o.city);
  if (!h.state && o.state) h.state = String(o.state).toUpperCase();
  o.houseId = h.id; return h;
}
function pruneHouses() { const used = new Set(state.orders.map(o => o.houseId)); state.houses = state.houses.filter(h => used.has(h.id) || h.nickname || h.notes); }

/* ---------- profile linking ---------- */
function autoLink(o) {
  if (o.profileLink === 'manual' && profileById(o.profileId)) return;
  let id = '', how = '';
  const email = String(o.recipientEmail || '').toLowerCase().trim();
  if (email) { const m = state.profiles.filter(p => String(p.email || '').toLowerCase().trim() === email); if (m.length === 1) { id = m[0].id; how = 'email'; } }
  if (!id && o.addr1) {
    const uk = Parser.unitKey(o.addr1, o.addr2, o.zip);
    const last = String(o.name || '').trim().split(/\s+/).pop().toLowerCase();
    let m = state.profiles.filter(p => Parser.unitKey(p.shipAddr1, p.shipAddr2, p.shipZip) === uk);
    if (m.length > 1 && last) m = m.filter(p => String(p.shipLast || '').toLowerCase() === last);
    if (m.length > 1 && o.last4) m = m.filter(p => String(p.cardNumber || '').replace(/\D/g, '').endsWith(o.last4));
    if (m.length === 1) { id = m[0].id; how = 'address'; }
  }
  if (!id && o.last4) { const m = state.profiles.filter(p => String(p.cardNumber || '').replace(/\D/g, '').endsWith(o.last4) && (!o.zip || Parser.zip5(p.shipZip) === Parser.zip5(o.zip))); if (m.length === 1) { id = m[0].id; how = 'card'; } }
  if (id) { o.profileId = id; o.profileLink = how; }
  else if (o.profileLink && o.profileLink !== 'manual') { o.profileId = ''; o.profileLink = ''; }
  else if (o.profileLink === 'manual' && !profileById(o.profileId)) { o.profileId = ''; o.profileLink = ''; }
}
function autoLinkAll() { state.orders.forEach(autoLink); if (typeof invalidateStats === 'function') invalidateStats(); }
const LINK_LABEL = { email: 'matched by email', address: 'matched by address', card: 'matched by card', manual: 'linked by you', bot: 'from bot checkout' };

/* ---------- email ingestion ---------- */
function applyEmail(r, accountLabel) {
  // r = Parser.parseOrderEmail(...) result
  let o = r.orderNumber ? findOrder(r.orderNumber, r.store) : null;
  let created = false;
  if (!o) {
    if (!r.orderNumber) return { skipped: 'no order number' };
    o = newOrder({ orderNumber: r.orderNumber, store: r.store, status: r.status, orderDate: r.date, source: 'email', history: [] });
    o.history.push({ status: r.status, date: r.date, source: 'email', note: r.subject });
    if (r.status === 'delivered') o.deliveredAt = r.date;
    state.orders.push(o); created = true;
  }
  if (o.messageIds.includes(r.messageId)) return { order: o, created: false, changed: false };
  const before = o.status;
  if (r.messageId) o.messageIds.push(r.messageId);
  o.emails.push({ messageId: r.messageId, subject: r.subject, date: r.date, status: r.status, from: r.from, inbox: accountLabel || '' });
  if (!created) {
    const rankNew = STATUS[r.status].r, rankOld = (STATUS[o.status] || STATUS.placed).r;
    if (rankNew >= rankOld) setStatus(o, r.status, r.date, 'email', r.subject);
    else o.history.push({ status: r.status, date: r.date, source: 'email', note: r.subject + ' (older email)' }), o.history.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }
  if (r.store && r.store !== 'other' && (!o.store || o.store === 'other')) o.store = r.store;
  if (r.date && (!o.orderDate || r.date < o.orderDate)) o.orderDate = r.date;
  if (r.total != null && (o.total == null || r.status === 'confirmed' && o.source === 'email' && !o.totalLocked)) o.total = r.total;
  if (r.items && r.items.length && !o.items.length) o.items = r.items;
  if (r.to && !o.recipientEmail) o.recipientEmail = r.to;
  if (r.last4 && !o.last4) o.last4 = r.last4;
  if (r.name && !o.name) o.name = r.name;
  if (r.address && r.address.addr1 && !o.addr1) Object.assign(o, { addr1: r.address.addr1, addr2: r.address.addr2, city: r.address.city, state: r.address.state, zip: r.address.zip });
  if (r.address && r.address.name && !o.name) o.name = r.address.name;
  if (r.eta && !['delivered', 'cancelled', 'refunded'].includes(r.status)) o.eta = r.eta;
  if (r.status === 'delivered' && (!o.deliveredAt || r.date > o.deliveredAt)) o.deliveredAt = r.date;
  for (const t of r.tracking || []) if (!o.tracking.some(x => x.number === t.number)) o.tracking.push({ number: t.number, carrier: t.carrier });
  resolveHouse(o); autoLink(o);
  o.updatedAt = Date.now();
  return { order: o, created, changed: created || before !== o.status, from: before };
}

/* ================= shared order list ================= */
function orderMiniList(orders, opts) {
  if (!orders.length) return `<div class="empty sm">${esc((opts && opts.empty) || 'No orders.')}</div>`;
  return `<div class="list">${orders.map(o => `<div class="li click" data-order="${o.id}">
    <div style="width:64px" class="small muted">${fmtDate(o.orderDate)}</div>
    <div style="flex:1;min-width:0"><div class="ellipsis">${esc(orderTitle(o)) || '<span class="muted">Order ' + esc(o.orderNumber) + '</span>'}</div><div class="small muted ellipsis">${Parser.storeInfo(o.store).label} · #${esc(o.orderNumber || '—')}${o.name ? ' · ' + esc(o.name) : ''}</div></div>
    <div class="right" style="width:86px">${fmtMoney(o.total)}</div><div style="width:120px" class="right">${statusBadge(o.status)}</div></div>`).join('')}</div>`;
}
document.addEventListener('click', e => { const r = e.target.closest('[data-order]'); if (r && !r.closest('#profOrders') && !e.target.closest('input,button,a,select')) { const d = r.closest('dialog'); if (d && d.id !== 'dlgOrder') d.close(); openOrder(r.dataset.order); } });

/* ================= orders page ================= */
const OF = { q: '', status: 'all', store: '', profile: '', house: '', range: 'all', sort: 'date', dir: -1, page: 0 };
let oSelected = new Set();
const RANGE_OPTS = [['all', 'All time'], ['today', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['year', 'This year']];
function rangeBounds(r) {
  const now = new Date(), start = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (r === 'today') return [start(now), null];
  if (/^\d+$/.test(r)) return [new Date(start(now).getTime() - (Number(r) - 1) * 864e5), null];
  if (r === 'month') return [new Date(now.getFullYear(), now.getMonth(), 1), null];
  if (r === 'lastmonth') return [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 1)];
  if (r === 'year') return [new Date(now.getFullYear(), 0, 1), null];
  return [null, null];
}
function inRange(iso, r) { const [a, b] = rangeBounds(r); const d = toDate(iso); if (!d) return r === 'all'; return (!a || d >= a) && (!b || d < b); }
const STATUS_TABS = [['all', 'All'], ['active', 'Active'], ['shipped', 'In transit'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']];
function statusTabMatch(o, t) { if (t === 'all') return true; if (t === 'active') return isActive(o); if (t === 'shipped') return o.status === 'shipped' || o.status === 'ready'; if (t === 'cancelled') return isDead(o); return o.status === t; }
function filteredOrders(ignoreStatus) {
  const q = OF.q.trim().toLowerCase();
  return state.orders.filter(o => {
    if (!ignoreStatus && !statusTabMatch(o, OF.status)) return false;
    if (OF.store && o.store !== OF.store) return false;
    if (OF.profile === '__none' ? o.profileId : OF.profile && o.profileId !== OF.profile) return false;
    if (OF.house === '__none' ? o.houseId : OF.house && o.houseId !== OF.house) return false;
    if (!inRange(o.orderDate, OF.range)) return false;
    if (!q) return true;
    const p = profileById(o.profileId);
    return [o.orderNumber, o.name, o.recipientEmail, orderAddr(o), o.notes, p && p.name, Parser.storeInfo(o.store).label, ...(o.items || []).map(i => i.name), ...(o.tracking || []).map(t => t.number)].some(v => String(v || '').toLowerCase().includes(q));
  });
}
function sortOrders(list) {
  const k = OF.sort, d = OF.dir;
  const val = o => ({ date: o.orderDate || '', store: Parser.storeInfo(o.store).label, no: o.orderNumber, item: orderTitle(o).toLowerCase(), total: Number(o.total) || 0, status: (STATUS[o.status] || {}).r || 0, profile: (profileById(o.profileId) || {}).name || '~', house: houseLabel(houseById(o.houseId)), eta: o.deliveredAt || o.eta || '' }[k]);
  return list.slice().sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * d; });
}
PAGES.orders = {
  render() {
    const pg = $('#pg-orders');
    const base = filteredOrders(true);
    const list = sortOrders(base.filter(o => statusTabMatch(o, OF.status)));
    for (const id of [...oSelected]) if (!state.orders.some(o => o.id === id)) oSelected.delete(id);
    const PER = 100, pages = Math.max(1, Math.ceil(list.length / PER)); OF.page = clamp(OF.page, 0, pages - 1);
    const shown = list.slice(OF.page * PER, OF.page * PER + PER);
    const stores = Array.from(new Set(state.orders.map(o => o.store))).sort();
    const usedHouses = state.houses.filter(h => houseOrders(h.id).length);
    const cols = [['date', 'Date'], ['store', 'Store'], ['no', 'Order #'], ['item', 'Items'], ['total', 'Total', 'right'], ['status', 'Status'], ['profile', 'Profile'], ['house', 'House'], ['eta', 'Arrives']];
    const unlinked = state.orders.filter(o => !o.profileId).length;
    pg.innerHTML = `<div class="pagehead"><h1>Orders</h1><span class="sub">${plural(list.length, 'order')} · ${fmtMoney(sum(list, orderSpend))} spent</span><div class="spacer"></div>
      <button id="oBot">Paste bot checkout</button><button id="oImp">Import</button><button id="oExp">Export</button>${state.settings.easypostKey ? '<button id="oTrack">Refresh tracking</button>' : ''}<button class="primary" id="oAdd">+ Add order</button></div>
      <div class="toolbar"><input class="search" data-search id="oQ" placeholder="Search order #, item, name, address, tracking…  ( / )" value="${esc(OF.q)}">
        <div class="chips">${STATUS_TABS.map(([k, l]) => `<button class="chip ${OF.status === k ? 'on' : ''}" data-st="${k}">${l}<span class="n">${base.filter(o => statusTabMatch(o, k)).length}</span></button>`).join('')}</div></div>
      <div class="toolbar">
        <select id="oStore"><option value="">All stores</option>${stores.map(s => `<option value="${s}" ${OF.store === s ? 'selected' : ''}>${esc(Parser.storeInfo(s).label)}</option>`).join('')}</select>
        <select id="oProf"><option value="">All profiles</option><option value="__none" ${OF.profile === '__none' ? 'selected' : ''}>Not linked (${unlinked})</option>${state.profiles.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true })).map(p => `<option value="${p.id}" ${OF.profile === p.id ? 'selected' : ''}>${esc(p.name || 'Untitled')}</option>`).join('')}</select>
        <select id="oHouse"><option value="">All houses</option><option value="__none" ${OF.house === '__none' ? 'selected' : ''}>No address</option>${usedHouses.map(h => `<option value="${h.id}" ${OF.house === h.id ? 'selected' : ''}>${esc(houseLabel(h))}</option>`).join('')}</select>
        <select id="oRange">${RANGE_OPTS.map(([v, l]) => `<option value="${v}" ${OF.range === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        ${OF.q || OF.store || OF.profile || OF.house || OF.range !== 'all' || OF.status !== 'all' ? '<button class="ghost sm" id="oReset">Reset filters</button>' : ''}
      </div>
      <div class="selbar" ${oSelected.size ? '' : 'hidden'}><strong>${oSelected.size} selected</strong>
        <select id="oSetStatus"><option value="">Set status…</option>${STATUSES.map(s => `<option value="${s.k}">${s.l}</option>`).join('')}</select>
        <select id="oSetProf"><option value="">Link to profile…</option><option value="__auto">Auto-match again</option><option value="__none">Unlink</option>${state.profiles.map(p => `<option value="${p.id}">${esc(p.name || 'Untitled')}</option>`).join('')}</select>
        <button class="sm danger" id="oDel">Delete</button><div class="spacer"></div><button class="sm ghost" id="oClear">Clear selection</button></div>
      <div class="tablewrap"><table><thead><tr><th class="cb"><input type="checkbox" id="oAll" ${shown.length && shown.every(o => oSelected.has(o.id)) ? 'checked' : ''} aria-label="Select all"></th>${cols.map(([k, l, c]) => `<th class="sort ${c || ''}" data-sort="${k}">${l}${OF.sort === k ? `<span class="arr">${OF.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`).join('')}<th>Tracking</th></tr></thead>
      <tbody>${shown.map(o => { const p = profileById(o.profileId), h = houseById(o.houseId); return `<tr data-oid="${o.id}" class="${oSelected.has(o.id) ? 'sel' : ''}">
        <td class="cb"><input type="checkbox" data-ocb="${o.id}" ${oSelected.has(o.id) ? 'checked' : ''} aria-label="Select"></td>
        <td>${fmtDate(o.orderDate)}</td><td>${storeBadge(o.store)}</td><td class="mono small">${esc(o.orderNumber || '—')}</td>
        <td class="ellipsis" style="max-width:300px" title="${esc((o.items || []).map(i => i.qty + '× ' + i.name).join('\n'))}">${esc(orderTitle(o)) || '<span class="faint">—</span>'}</td>
        <td class="right">${fmtMoney(o.total)}</td><td>${statusBadge(o.status)}</td>
        <td>${p ? esc(p.name || 'Untitled') : '<span class="faint">—</span>'}</td>
        <td class="ellipsis" style="max-width:180px">${h ? esc(houseLabel(h)) : '<span class="faint">—</span>'}</td>
        <td>${o.status === 'delivered' ? `<span style="color:var(--ok)">${fmtDate(o.deliveredAt || o.eta)}</span>` : isDead(o) ? '<span class="faint">—</span>' : o.eta ? `${fmtDate(o.eta)} <span class="faint small">${relDay(o.eta)}</span>` : '<span class="faint">—</span>'}</td>
        <td>${(o.tracking || []).slice(0, 1).map(t => `<a href="${esc(t.live && t.live.publicUrl || Parser.trackingUrl(t.number, t.carrier))}" target="_blank" rel="noopener" class="small">${esc(t.carrier || 'Track')}</a>`).join('')}${o.tracking.length > 1 ? ` <span class="faint small">+${o.tracking.length - 1}</span>` : ''}</td></tr>`; }).join('')}</tbody></table>
      ${list.length ? '' : `<div class="empty">${state.orders.length ? 'No orders match these filters.' : 'No orders yet. Connect an inbox on the <a href="#inboxes">Inboxes</a> page and Crown will pull them in automatically, or add / import / paste them here.'}</div>`}</div>
      ${pages > 1 ? `<div class="pager">Page ${OF.page + 1} of ${pages}<button class="sm" id="oPrev" ${OF.page ? '' : 'disabled'}>‹ Prev</button><button class="sm" id="oNext" ${OF.page < pages - 1 ? '' : 'disabled'}>Next ›</button></div>` : ''}`;
    const rr = () => PAGES.orders.render();
    $('#oQ').oninput = debounce(e => { OF.q = e.target.value; OF.page = 0; rr(); setTimeout(() => { const i = $('#oQ'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 160);
    pg.querySelector('.chips').onclick = e => { const b = e.target.closest('[data-st]'); if (b) { OF.status = b.dataset.st; OF.page = 0; rr(); } };
    $('#oStore').onchange = e => { OF.store = e.target.value; OF.page = 0; rr(); };
    $('#oProf').onchange = e => { OF.profile = e.target.value; OF.page = 0; rr(); };
    $('#oHouse').onchange = e => { OF.house = e.target.value; OF.page = 0; rr(); };
    $('#oRange').onchange = e => { OF.range = e.target.value; OF.page = 0; rr(); };
    if ($('#oReset')) $('#oReset').onclick = () => { Object.assign(OF, { q: '', status: 'all', store: '', profile: '', house: '', range: 'all', page: 0 }); rr(); };
    if ($('#oPrev')) $('#oPrev').onclick = () => { OF.page--; rr(); };
    if ($('#oNext')) $('#oNext').onclick = () => { OF.page++; rr(); };
    $$('#pg-orders th.sort').forEach(th => th.onclick = () => { const k = th.dataset.sort; if (OF.sort === k) OF.dir *= -1; else { OF.sort = k; OF.dir = ['date', 'total', 'eta', 'status'].includes(k) ? -1 : 1; } rr(); });
    $('#oAll').onchange = e => { shown.forEach(o => e.target.checked ? oSelected.add(o.id) : oSelected.delete(o.id)); rr(); };
    pg.querySelector('tbody').onclick = e => { const cb = e.target.dataset.ocb; if (cb) { e.target.checked ? oSelected.add(cb) : oSelected.delete(cb); rr(); return; } if (e.target.closest('a')) return; const tr = e.target.closest('tr'); if (tr) openOrder(tr.dataset.oid); };
    if ($('#oClear')) $('#oClear').onclick = () => { oSelected.clear(); rr(); };
    if ($('#oSetStatus')) $('#oSetStatus').onchange = e => { const s = e.target.value; if (!s) return; snapshot('set status'); state.orders.forEach(o => { if (oSelected.has(o.id) && o.status !== s) { setStatus(o, s, null, 'manual'); o.updatedAt = Date.now(); } }); save(); refresh(); toast(`Marked ${plural(oSelected.size, 'order')} ${STATUS[s].l.toLowerCase()}`, { undo: true }); };
    if ($('#oSetProf')) $('#oSetProf').onchange = e => { const v = e.target.value; if (!v) return; snapshot('link profile'); state.orders.forEach(o => { if (!oSelected.has(o.id)) return; if (v === '__auto') { o.profileLink = ''; autoLink(o); } else if (v === '__none') { o.profileId = ''; o.profileLink = ''; } else { o.profileId = v; o.profileLink = 'manual'; } }); invalidateStats(); save(); refresh(); toast('Updated profile links', { undo: true }); };
    if ($('#oDel')) $('#oDel').onclick = () => { const n = oSelected.size; if (!confirm(`Delete ${plural(n, 'order')}? If they came from email they won’t come back on the next sync.`)) return; snapshot('delete orders'); state.orders = state.orders.filter(o => !oSelected.has(o.id)); oSelected.clear(); pruneHouses(); save(); refresh(); toast(`Deleted ${plural(n, 'order')}`, { undo: true }); };
    $('#oAdd').onclick = () => openOrder(null);
    $('#oBot').onclick = openBotPaste; $('#oImp').onclick = openOrderImport; $('#oExp').onclick = () => exportOrders(list);
    if ($('#oTrack')) $('#oTrack').onclick = () => refreshAllTracking();
  },
};
function exportOrders(list) {
  if (!list.length) { toast('Nothing to export'); return; }
  const rows = list.map(o => { const p = profileById(o.profileId), h = houseById(o.houseId); return { date: dayKey(toDate(o.orderDate) || new Date()), store: Parser.storeInfo(o.store).label, order_number: o.orderNumber, status: STATUS[o.status].l, total: o.total ?? '', items: (o.items || []).map(i => `${i.qty}x ${i.name}${i.price != null ? ' @ ' + i.price : ''}`).join(' | '), item_count: itemCount(o), profile: p ? p.name : '', link: o.profileLink || '', name: o.name, email: o.recipientEmail, address1: o.addr1, address2: o.addr2, city: o.city, state: o.state, zip: o.zip, house: h ? houseLabel(h) : '', eta: o.eta, delivered: o.deliveredAt ? dayKey(toDate(o.deliveredAt)) : '', tracking: (o.tracking || []).map(t => t.number).join(' '), card_last4: o.last4, notes: o.notes }; });
  download(`crown-orders-${stamp()}.csv`, toCSV(Object.keys(rows[0]), rows), 'text/csv'); toast(`Exported ${plural(list.length, 'order')}`);
}

/* ================= order dialog ================= */
let curOrder = null, ordTab = 'overview', ordIsNew = false;
function openOrder(id, tab) {
  ordIsNew = !id;
  const o = id ? state.orders.find(x => x.id === id) : newOrder();
  if (!o) return;
  curOrder = ordIsNew ? o : JSON.parse(JSON.stringify(o));
  ordTab = ordIsNew ? 'edit' : (tab || 'overview');
  renderOrderDlg(); openDlg('dlgOrder');
}
function renderOrderDlg() {
  const o = curOrder;
  $('#ordTitle').textContent = ordIsNew ? 'New order' : (Parser.storeInfo(o.store).label + ' #' + (o.orderNumber || '—'));
  $('#ordBadges').innerHTML = ordIsNew ? '' : statusBadge(o.status) + (o.source ? `<span class="badge">${esc({ email: 'from email', manual: 'added by you', bot: 'bot checkout', import: 'imported' }[o.source] || o.source)}</span>` : '');
  $('#ordTabs').innerHTML = ['overview', 'edit', 'emails'].filter(t => !ordIsNew || t === 'edit').map(t => `<button class="tab ${ordTab === t ? 'on' : ''}" data-tab="${t}">${{ overview: 'Overview', edit: 'Edit', emails: `Emails (${(o.emails || []).length})` }[t]}</button>`).join('');
  $('#ordDelete').hidden = ordIsNew; $('#ordSave').hidden = ordTab !== 'edit';
  const b = $('#ordBody');
  if (ordTab === 'overview') {
    const p = profileById(o.profileId), h = houseById(o.houseId);
    b.innerHTML = `<div class="cols2"><div>
      <div class="kv">
        <div class="k">Store</div><div>${storeBadge(o.store)}</div>
        <div class="k">Order #</div><div class="mono">${esc(o.orderNumber || '—')}</div>
        <div class="k">Placed</div><div>${fmtDT(o.orderDate)}</div>
        <div class="k">Total</div><div><b>${fmtMoney(o.total)}</b>${isDead(o) ? ' <span class="faint small">(not counted — ' + STATUS[o.status].l.toLowerCase() + ')</span>' : ''}</div>
        <div class="k">Status</div><div><select id="ovStatus" style="width:auto">${STATUSES.map(s => `<option value="${s.k}" ${o.status === s.k ? 'selected' : ''}>${s.l}</option>`).join('')}</select></div>
        <div class="k">${o.status === 'delivered' ? 'Delivered' : 'Arrives'}</div><div>${o.status === 'delivered' ? fmtDate(o.deliveredAt || o.eta, { weekday: true }) : o.eta ? fmtDate(o.eta, { weekday: true }) + ` <span class="faint">${relDay(o.eta)}</span>` : '—'}</div>
        <div class="k">Profile</div><div><select id="ovProf"><option value="">— Not linked —</option>${state.profiles.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true })).map(x => `<option value="${x.id}" ${x.id === o.profileId ? 'selected' : ''}>${esc(x.name || 'Untitled')}</option>`).join('')}</select>
          <div class="small faint" style="margin-top:3px">${o.profileId ? esc(LINK_LABEL[o.profileLink] || '') : 'Pick the profile that checked this out.'}${o.profileLink === 'manual' ? ' · <button class="linkbtn" id="ovAuto">auto-match instead</button>' : ''}</div></div>
        <div class="k">House</div><div>${h ? `<a href="#houses/${h.id}" data-closeorder>${esc(houseLabel(h))}</a>` : '<span class="faint">No address yet</span>'}</div>
        <div class="k">Ship to</div><div>${esc(o.name || '')}${o.name ? '<br>' : ''}${esc(orderAddr(o)) || '<span class="faint">—</span>'}</div>
        <div class="k">Sent to</div><div>${esc(o.recipientEmail || '—')}</div>
        <div class="k">Card</div><div>${o.last4 ? '•••• ' + esc(o.last4) : '—'}</div>
      </div>
      <div class="section">Notes</div><textarea id="ovNotes" style="min-height:70px;font-family:inherit;font-size:13px" placeholder="Add a note…">${esc(o.notes)}</textarea>
    </div><div>
      <div class="section" style="margin-top:0">Items (${itemCount(o)})</div>
      ${o.items.length ? `<div class="list">${o.items.map(i => `<div class="li"><div class="badge">${i.qty || 1}×</div><div style="flex:1;min-width:0" class="ellipsis" title="${esc(i.name)}">${esc(i.name)}</div><div class="muted">${i.price != null ? fmtMoney(i.price) : ''}</div></div>`).join('')}</div>` : '<div class="faint small">No items detected. Add them on the Edit tab.</div>'}
      <div class="section">Tracking</div>
      ${o.tracking.length ? o.tracking.map((t, i) => `<div class="card" style="padding:10px 12px;margin-bottom:8px"><div class="hstack"><b>${esc(t.carrier || 'Carrier')}</b><a class="mono small" href="${esc(t.live && t.live.publicUrl || Parser.trackingUrl(t.number, t.carrier))}" target="_blank" rel="noopener">${esc(t.number)} ↗</a><div class="spacer"></div>${state.settings.easypostKey ? `<button class="sm" data-live="${i}">${t.live ? '↻ Refresh' : 'Live tracking'}</button>` : ''}</div>
        ${t.live ? `<div class="small" style="margin-top:6px">${esc(String(t.live.status || '').replace(/_/g, ' '))}${t.live.est ? ' · est. ' + fmtDate(t.live.est) : ''} <span class="faint">· checked ${ago(t.live.checkedAt)}</span></div>${(t.live.events || []).slice(-4).reverse().map(ev => `<div class="small muted" style="margin-top:3px">${fmtDT(ev.date)} — ${esc(ev.message)}${ev.location ? ' · ' + esc(ev.location) : ''}</div>`).join('')}` : ''}</div>`).join('') : `<div class="faint small">No tracking numbers yet — they’re added automatically from shipping emails.${state.settings.easypostKey ? '' : ' Add an EasyPost key in Settings for live tracking.'}</div>`}
      <div class="section">Timeline</div>
      <div class="timeline">${o.history.length ? o.history.slice().reverse().map(hh => `<div class="tl" style="--c:${(STATUS[hh.status] || STATUS.placed).c}"><div><b>${esc((STATUS[hh.status] || {}).l || hh.status)}</b> <span class="faint small">${fmtDT(hh.date)} · ${esc(hh.source)}</span></div>${hh.note ? `<div class="small muted ellipsis">${esc(hh.note)}</div>` : ''}</div>`).join('') : '<div class="faint small">No history yet.</div>'}</div>
    </div></div>`;
    $('#ovStatus').onchange = e => { const real = state.orders.find(x => x.id === o.id); snapshot('change status'); setStatus(real, e.target.value, null, 'manual'); real.updatedAt = Date.now(); curOrder = JSON.parse(JSON.stringify(real)); save(); renderOrderDlg(); refresh(); };
    $('#ovProf').onchange = e => { const real = state.orders.find(x => x.id === o.id); snapshot('link profile'); real.profileId = e.target.value; real.profileLink = e.target.value ? 'manual' : ''; if (!e.target.value) autoLink(real); curOrder = JSON.parse(JSON.stringify(real)); invalidateStats(); save(); renderOrderDlg(); refresh(); };
    if ($('#ovAuto')) $('#ovAuto').onclick = () => { const real = state.orders.find(x => x.id === o.id); real.profileLink = ''; real.profileId = ''; autoLink(real); curOrder = JSON.parse(JSON.stringify(real)); invalidateStats(); save(); renderOrderDlg(); refresh(); };
    $('#ovNotes').onchange = e => { const real = state.orders.find(x => x.id === o.id); real.notes = e.target.value; curOrder.notes = real.notes; save(); };
    $$('#ordBody [data-live]').forEach(btn => btn.onclick = () => liveTrack(o.id, +btn.dataset.live, btn));
    $$('#ordBody [data-closeorder]').forEach(a => a.onclick = () => closeDlg('dlgOrder'));
  } else if (ordTab === 'edit') {
    const v = k => esc(o[k] ?? '');
    const dt = toDate(o.orderDate) || new Date();
    b.innerHTML = `<div class="fgrid">
      <div><label>Store</label><select id="oeStore">${Parser.STORES.map(s => `<option value="${s.key}" ${o.store === s.key ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></div>
      <div><label>Order #</label><input id="oeNo" value="${v('orderNumber')}"></div>
      <div><label>Status</label><select id="oeStatus">${STATUSES.map(s => `<option value="${s.k}" ${o.status === s.k ? 'selected' : ''}>${s.l}</option>`).join('')}</select></div>
      <div><label>Total ($)</label><input id="oeTotal" inputmode="decimal" value="${o.total ?? ''}"></div>
      <div><label>Order date</label><input id="oeDate" type="date" value="${dayKey(dt)}"></div>
      <div><label>Arrives (ETA)</label><input id="oeEta" type="date" value="${v('eta')}"></div>
      <div><label>Delivered on</label><input id="oeDel" type="date" value="${o.deliveredAt ? dayKey(toDate(o.deliveredAt)) : ''}"></div>
      <div><label>Card last 4</label><input id="oeL4" maxlength="4" inputmode="numeric" value="${v('last4')}"></div>
    </div>
    <div class="section">Shipping</div><div class="fgrid">
      <div class="s2"><label>Recipient name</label><input id="oeName" value="${v('name')}"></div><div class="s2"><label>Sent to email</label><input id="oeEmail" value="${v('recipientEmail')}"></div>
      <div class="s2"><label>Address 1</label><input id="oeA1" value="${v('addr1')}"></div><div class="s2"><label>Address 2</label><input id="oeA2" value="${v('addr2')}"></div>
      <div class="s2"><label>City</label><input id="oeCity" value="${v('city')}"></div><div><label>State</label><input id="oeState" value="${v('state')}"></div><div><label>ZIP</label><input id="oeZip" value="${v('zip')}"></div>
    </div>
    <div class="section">Items <span style="text-transform:none;letter-spacing:0;font-weight:400">— one per line: <code>2 x Item name | 49.99</code></span></div>
    <textarea id="oeItems" style="min-height:90px">${esc((o.items || []).map(i => `${i.qty || 1} x ${i.name}${i.price != null ? ' | ' + i.price : ''}`).join('\n'))}</textarea>
    <div class="section">Tracking numbers <span style="text-transform:none;letter-spacing:0;font-weight:400">— one per line</span></div>
    <textarea id="oeTrk" style="min-height:60px">${esc((o.tracking || []).map(t => t.number).join('\n'))}</textarea>
    <div class="section">Notes</div><textarea id="oeNotes" style="min-height:60px;font-family:inherit;font-size:13px">${esc(o.notes)}</textarea>`;
  } else {
    b.innerHTML = (o.emails || []).length ? `<div class="list">${o.emails.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map(m => `<div class="li"><div style="width:120px" class="small muted">${fmtDT(m.date)}</div><div style="flex:1;min-width:0"><div class="ellipsis">${esc(m.subject)}</div><div class="small faint ellipsis">${esc(m.from)}${m.inbox ? ' · ' + esc(m.inbox) : ''}</div></div>${statusBadge(m.status)}</div>`).join('')}</div>` : '<div class="empty sm">No emails for this order — it was added by hand, imported, or pasted from a bot.</div>';
  }
}
$('#ordTabs').onclick = e => { const t = e.target.closest('.tab'); if (!t) return; ordTab = t.dataset.tab; renderOrderDlg(); };
function parseItemsText(t) {
  return String(t || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(\d{1,4})\s*[x×]\s*(.+?)(?:\s*\|\s*\$?([\d,]+(?:\.\d{1,2})?))?$/i);
    if (m) return { qty: +m[1], name: m[2].trim(), price: m[3] != null ? Number(m[3].replace(/,/g, '')) : null };
    const m2 = l.match(/^(.+?)(?:\s*\|\s*\$?([\d,]+(?:\.\d{1,2})?))?$/);
    return { qty: 1, name: m2[1].trim(), price: m2[2] != null ? Number(m2[2].replace(/,/g, '')) : null };
  });
}
$('#ordSave').onclick = () => {
  const o = curOrder; const g = id => $('#' + id).value.trim();
  const no = g('oeNo');
  const dupe = no && state.orders.find(x => x.id !== o.id && Parser.normOrderNo(x.orderNumber) === Parser.normOrderNo(no));
  if (dupe && !confirm(`Another order already has #${no}. Save anyway?`)) return;
  snapshot(ordIsNew ? 'add order' : 'edit order');
  const real = ordIsNew ? o : state.orders.find(x => x.id === o.id);
  const tot = g('oeTotal').replace(/[$,]/g, '');
  Object.assign(real, { store: g('oeStore'), orderNumber: no, total: tot === '' ? null : (Number.isFinite(Number(tot)) ? Math.round(Number(tot) * 100) / 100 : real.total), eta: g('oeEta'), last4: g('oeL4').replace(/\D/g, '').slice(-4), name: g('oeName'), recipientEmail: g('oeEmail').toLowerCase(), addr1: g('oeA1'), addr2: g('oeA2'), city: g('oeCity'), state: g('oeState').toUpperCase(), zip: g('oeZip'), notes: $('#oeNotes').value, items: parseItemsText($('#oeItems').value), updatedAt: Date.now() });
  if (real.total != null) real.totalLocked = true;
  const dVal = g('oeDate'); if (dVal && dVal !== dayKey(toDate(real.orderDate) || new Date())) { const d = parseDay(dVal); const old = toDate(real.orderDate) || new Date(); d.setHours(old.getHours(), old.getMinutes()); real.orderDate = d.toISOString(); }
  const del = g('oeDel'); real.deliveredAt = del ? (dayKey(toDate(real.deliveredAt) || new Date(0)) === del ? real.deliveredAt : parseDay(del).toISOString()) : '';
  const nums = $('#oeTrk').value.split(/\s*\n\s*/).map(s => s.replace(/\s+/g, '').toUpperCase()).filter(Boolean);
  real.tracking = nums.map(n => real.tracking.find(t => t.number === n) || { number: n, carrier: Parser.detectCarrier(n) });
  const st = g('oeStatus'); if (st !== real.status || ordIsNew) setStatus(real, st, ordIsNew ? real.orderDate : null, 'manual');
  if (ordIsNew) state.orders.push(real);
  resolveHouse(real); autoLink(real); pruneHouses(); invalidateStats();
  save(); refresh(); toast(ordIsNew ? 'Order added' : 'Order saved', { undo: true });
  ordIsNew = false; curOrder = JSON.parse(JSON.stringify(real)); ordTab = 'overview'; renderOrderDlg();
};
$('#ordDelete').onclick = () => { if (!confirm('Delete this order?')) return; snapshot('delete order'); state.orders = state.orders.filter(x => x.id !== curOrder.id); oSelected.delete(curOrder.id); pruneHouses(); closeDlg('dlgOrder'); save(); refresh(); toast('Order deleted', { undo: true }); };

/* ================= order import (CSV) ================= */
const O_ALIASES = {
  orderNumber: ['order', 'ordernumber', 'orderno', 'orderid', 'ordernum', 'order#', 'confirmation', 'confirmationnumber'],
  store: ['store', 'site', 'retailer', 'website', 'shop', 'merchant'],
  orderDate: ['date', 'orderdate', 'time', 'timestamp', 'placed', 'placedat', 'createdat', 'checkouttime'],
  total: ['total', 'price', 'amount', 'ordertotal', 'cost', 'spent', 'totalprice'],
  status: ['status', 'orderstatus', 'state_'],
  recipientEmail: ['email', 'account', 'recipient', 'recipientemail', 'accountemail'],
  profile: ['profile', 'profilename', 'checkoutprofile'],
  item: ['product', 'item', 'items', 'productname', 'itemname', 'sku', 'description', 'title'],
  qty: ['qty', 'quantity', 'count'],
  tracking: ['tracking', 'trackingnumber', 'trackingno', 'tracking#'],
  name: ['recipientname', 'shipname', 'fullname', 'customer', 'customername'],
  addr1: ['address', 'address1', 'addressline1', 'street', 'shippingaddress'],
  addr2: ['address2', 'addressline2', 'apt', 'unit'],
  city: ['city'], state: ['state', 'province'], zip: ['zip', 'zipcode', 'postal', 'postalcode'],
  eta: ['eta', 'arrives', 'estimateddelivery', 'deliverydate'],
  notes: ['notes', 'note', 'comment'],
};
const O_MAP = {}; for (const [k, arr] of Object.entries(O_ALIASES)) arr.forEach(a => O_MAP[norm(a)] = k);
let oimp = null;
function openOrderImport() { $('#oimpText').value = ''; oimpAnalyze(); openDlg('dlgOrderImport'); }
function oimpAnalyze() {
  const rows = parseDelimited($('#oimpText').value);
  if (rows.length < 2) { oimp = null; $('#oimpPreview').textContent = rows.length ? 'Add at least one data row under the headers.' : ''; $('#oimpMap').innerHTML = ''; $('#oimpGo').disabled = true; return; }
  const headers = rows[0].map(h => String(h).trim()); const map = headers.map(h => O_MAP[norm(h)] || null);
  oimp = { map, rows: rows.slice(1) };
  $('#oimpPreview').innerHTML = `<b>${rows.length - 1}</b> rows found. Column matching:`;
  $('#oimpMap').innerHTML = headers.map((h, i) => `<span class="badge ${map[i] ? '' : 'bad'}">${esc(h)} → ${esc(map[i] || 'ignored')}</span>`).join('');
  $('#oimpGo').disabled = !map.includes('orderNumber') && !map.includes('item');
  if ($('#oimpGo').disabled) $('#oimpPreview').innerHTML += ' <span style="color:var(--danger)">Needs at least an order number or product column.</span>';
}
$('#oimpText').oninput = oimpAnalyze;
$('#oimpFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; $('#oimpText').value = await f.text(); e.target.value = ''; oimpAnalyze(); };
function statusFromText(s) { s = String(s || '').toLowerCase(); if (!s) return ''; for (const st of STATUSES) if (s.includes(st.k) || s.includes(st.l.toLowerCase())) return st.k; if (/cancel/.test(s)) return 'cancelled'; if (/ship|transit/.test(s)) return 'shipped'; if (/success|placed|checked/.test(s)) return 'placed'; return Parser.classifyStatus(s) || ''; }
function storeFromText(s) { if (!s) return 'other'; const k = Parser.STORES.find(x => x.key === norm(s) || norm(x.label) === norm(s)); return k ? k.key : Parser.detectStore('', String(s), ''); }
function profileByName(n) { n = String(n || '').trim().toLowerCase(); if (!n) return null; return state.profiles.find(p => String(p.name || '').trim().toLowerCase() === n) || null; }
$('#oimpGo').onclick = () => {
  if (!oimp) return; snapshot('import orders'); let added = 0, updated = 0;
  for (const r of oimp.rows) {
    const v = {}; oimp.map.forEach((k, i) => { if (k && String(r[i] ?? '').trim() !== '') v[k] = String(r[i]).trim(); });
    if (!v.orderNumber && !v.item) continue;
    let o = v.orderNumber ? findOrder(v.orderNumber, v.store ? storeFromText(v.store) : '') : null;
    const isNew = !o;
    if (!o) o = newOrder({ source: 'import', history: [] });
    if (v.orderNumber) o.orderNumber = v.orderNumber;
    if (v.store) o.store = storeFromText(v.store);
    if (v.orderDate) { const d = toDate(v.orderDate) || new Date(v.orderDate); if (d && !Number.isNaN(d.getTime())) o.orderDate = d.toISOString(); }
    if (v.total && (isNew || o.total == null)) { const t = Number(v.total.replace(/[$,]/g, '')); if (Number.isFinite(t)) o.total = t; }
    if (v.item && !o.items.length) o.items = [{ name: v.item, qty: Number(v.qty) || 1, price: o.total != null && (Number(v.qty) || 1) ? Math.round(o.total / (Number(v.qty) || 1) * 100) / 100 : null }];
    for (const k of ['recipientEmail', 'name', 'addr1', 'addr2', 'city', 'state', 'zip', 'notes']) if (v[k] && !o[k]) o[k] = k === 'recipientEmail' ? v[k].toLowerCase() : v[k];
    if (v.eta) { const d = toDate(v.eta); if (d) o.eta = dayKey(d); }
    if (v.tracking) v.tracking.split(/[\s,;]+/).filter(Boolean).forEach(n => { n = n.toUpperCase(); if (!o.tracking.some(t => t.number === n)) o.tracking.push({ number: n, carrier: Parser.detectCarrier(n) }); });
    const st = statusFromText(v.status) || (isNew ? 'placed' : '');
    if (st && (isNew || STATUS[st].r >= STATUS[o.status].r)) setStatus(o, st, isNew ? o.orderDate : null, 'import');
    const p = profileByName(v.profile); if (p) { o.profileId = p.id; o.profileLink = 'manual'; }
    o.updatedAt = Date.now();
    if (isNew) { state.orders.push(o); added++; } else updated++;
    resolveHouse(o); autoLink(o);
  }
  invalidateStats(); closeDlg('dlgOrderImport'); save(); refresh(); toast(`Imported ${plural(added, 'new order')}${updated ? `, updated ${updated}` : ''}`, { undo: true });
};

/* ================= bot checkout paste ================= */
const BOT_KEYS = {
  store: ['site', 'store', 'retailer', 'website', 'module', 'shop'], item: ['product', 'item', 'product name', 'items', 'name', 'title'], price: ['price', 'total', 'amount', 'cost', 'order total'],
  profile: ['profile', 'profile name', 'billing profile', 'profiles'], order: ['order', 'order number', 'order #', 'order id', 'order no', 'order#', 'confirmation'],
  email: ['email', 'account', 'account email'], qty: ['qty', 'quantity'], size: ['size', 'variant', 'sku'],
};
const BOT_LOOKUP = {}; for (const [k, arr] of Object.entries(BOT_KEYS)) arr.forEach(a => BOT_LOOKUP[norm(a)] = k);
function parseBotText(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map(l => l.replace(/[*_`|>]+/g, '').replace(/^[\s:•\-]+/, '').trim());
  const recs = []; let cur = {};
  const push = () => { if (cur.item || cur.order || cur.profile) recs.push(cur); cur = {}; };
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i]; if (!L) continue;
    let key = null, val = null;
    const m = L.match(/^([A-Za-z #]{2,22}?)\s*[:\-–]\s*(.+)$/);
    if (m && BOT_LOOKUP[norm(m[1])]) { key = BOT_LOOKUP[norm(m[1])]; val = m[2].trim(); }
    else if (BOT_LOOKUP[norm(L)] && i + 1 < lines.length) {
      let j = i + 1; while (j < lines.length && !lines[j]) j++;
      if (j < lines.length && !BOT_LOOKUP[norm(lines[j])]) { key = BOT_LOOKUP[norm(L)]; val = lines[j]; i = j; }
    } else if (/success|checked out|checkout (complete|success)|order placed/i.test(L) && Object.keys(cur).length) { push(); continue; }
    if (!key) continue;
    if (cur[key] != null) push();
    cur[key] = val;
  }
  push();
  return recs.map(r => {
    const price = r.price ? Number(String(r.price).replace(/[^0-9.]/g, '')) : null;
    const orderNo = r.order ? (String(r.order).match(/[A-Z0-9][A-Z0-9\-]{4,}/i) || [''])[0] : '';
    return { store: r.store ? storeFromText(r.store) : 'other', storeText: r.store || '', item: r.item ? r.item + (r.size && !/^\d{6,}$/.test(r.size) ? ' — ' + r.size : '') : '', price: Number.isFinite(price) ? price : null, qty: Number(r.qty) || 1, profileName: r.profile || '', profile: profileByName(r.profile), order: orderNo, email: r.email || '' };
  });
}
let botRecs = [];
function openBotPaste() { $('#botText').value = ''; botPreview(); openDlg('dlgBot'); }
function botPreview() {
  botRecs = parseBotText($('#botText').value);
  $('#botGo').disabled = !botRecs.length;
  $('#botPreview').innerHTML = botRecs.length ? `<div class="small muted" style="margin-bottom:6px">Found ${plural(botRecs.length, 'checkout')}:</div><div class="list">${botRecs.map(r => { const ex = r.order && findOrder(r.order, r.store); return `<div class="li"><div style="flex:1;min-width:0"><div class="ellipsis">${esc(r.item || '(no product)')}</div><div class="small muted">${storeBadge(r.store)} ${r.order ? '#' + esc(r.order) : ''} · ${r.price != null ? fmtMoney(r.price) : 'no price'} · ${r.profile ? '✓ ' + esc(r.profile.name) : r.profileName ? `<span style="color:var(--warn)">profile “${esc(r.profileName)}” not found</span>` : 'no profile'}</div></div><span class="badge">${ex ? 'links to existing order' : 'new order'}</span></div>`; }).join('')}</div>` : ($('#botText').value.trim() ? '<div class="note warn">Couldn’t find any checkout details. Make sure the paste includes labels like Product, Price, Profile or Order.</div>' : '');
}
$('#botText').oninput = debounce(botPreview, 150);
$('#botGo').onclick = () => {
  snapshot('bot checkouts'); let added = 0, linked = 0;
  for (const r of botRecs) {
    let o = r.order ? findOrder(r.order, r.store) : null;
    if (!o) { o = newOrder({ orderNumber: r.order, store: r.store, source: 'bot', history: [] }); setStatus(o, 'placed', o.orderDate, 'bot', 'Pasted bot checkout'); state.orders.push(o); added++; } else linked++;
    if (r.item && !o.items.length) o.items = [{ name: r.item, qty: r.qty, price: r.price != null ? Math.round(r.price / r.qty * 100) / 100 : null }];
    if (r.price != null && o.total == null) o.total = r.price;
    if (r.store !== 'other' && o.store === 'other') o.store = r.store;
    if (r.email && !o.recipientEmail) o.recipientEmail = r.email.toLowerCase();
    if (r.profile) { o.profileId = r.profile.id; o.profileLink = 'manual'; if (!o.addr1 && r.profile.shipAddr1) { Object.assign(o, { name: shipName(r.profile), addr1: r.profile.shipAddr1, addr2: r.profile.shipAddr2, city: r.profile.shipCity, state: r.profile.shipState, zip: r.profile.shipZip }); } }
    o.updatedAt = Date.now(); resolveHouse(o); autoLink(o);
  }
  invalidateStats(); closeDlg('dlgBot'); save(); refresh(); toast(`Added ${plural(added, 'order')}${linked ? `, linked ${linked} existing` : ''}`, { undo: true });
};

/* ================= houses ================= */
const HF = { q: '', sort: 'orders' };
function houseStats(h) {
  const os = houseOrders(h.id);
  const names = {}, units = {}, profs = {};
  os.forEach(o => { if (o.name) names[o.name] = (names[o.name] || 0) + 1; if (o.addr2) units[o.addr2] = (units[o.addr2] || 0) + 1; if (o.profileId) profs[o.profileId] = (profs[o.profileId] || 0) + 1; });
  const by = {}; STATUSES.forEach(s => by[s.k] = 0); os.forEach(o => by[o.status] = (by[o.status] || 0) + 1);
  const last = os.reduce((a, o) => o.orderDate > a ? o.orderDate : a, '');
  return { os, n: os.length, spent: sum(os, orderSpend), active: os.filter(isActive).length, delivered: by.delivered, dead: by.cancelled + by.refunded, by, names, units, profs, last };
}
PAGES.houses = {
  render(arg) {
    if (arg) return renderHouse(arg);
    const pg = $('#pg-houses'); const q = HF.q.trim().toLowerCase();
    let hs = state.houses.map(h => ({ h, s: houseStats(h) })).filter(x => x.s.n || x.h.nickname || x.h.notes);
    const total = hs.length;
    if (q) hs = hs.filter(({ h, s }) => [h.nickname, houseAddr(h), ...Object.keys(s.names), ...Object.keys(s.units)].some(v => String(v || '').toLowerCase().includes(q)));
    const sorters = { orders: (a, b) => b.s.n - a.s.n, spent: (a, b) => b.s.spent - a.s.spent, active: (a, b) => b.s.active - a.s.active || b.s.n - a.s.n, recent: (a, b) => String(b.s.last).localeCompare(String(a.s.last)), az: (a, b) => houseLabel(a.h).localeCompare(houseLabel(b.h), undefined, { numeric: true }) };
    hs.sort(sorters[HF.sort] || sorters.orders);
    const noAddr = state.orders.filter(o => !o.houseId).length;
    pg.innerHTML = `<div class="pagehead"><h1>Houses</h1><span class="sub">${plural(total, 'house')} · grouped by street address (apt / unit ignored)</span></div>
      <div class="toolbar"><input class="search" data-search id="hQ" placeholder="Search address, name, unit…  ( / )" value="${esc(HF.q)}">
      <div class="chips">${[['orders', 'Most orders'], ['spent', 'Most spent'], ['active', 'Most active'], ['recent', 'Newest'], ['az', 'A–Z']].map(([k, l]) => `<button class="chip ${HF.sort === k ? 'on' : ''}" data-hs="${k}">${l}</button>`).join('')}</div></div>
      ${noAddr ? `<div class="note" style="margin:0 0 12px">${plural(noAddr, 'order')} ${noAddr === 1 ? 'has' : 'have'} no shipping address yet, so ${noAddr === 1 ? 'it isn’t' : 'they aren’t'} in a house. Addresses come from order confirmation emails. <a href="#orders" onclick="OF.house='__none'">See them</a></div>` : ''}
      ${hs.length ? `<div class="housegrid">${hs.map(({ h, s }) => `<div class="house" data-house="${h.id}">
        <div class="t ellipsis">${esc(houseLabel(h))}</div><div class="a ellipsis">${esc(h.nickname ? houseAddr(h) : [h.city, [h.state, h.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '))}</div>
        <div class="stats"><div><b>${s.n}</b>orders</div><div><b>${fmtMoney(s.spent, true)}</b>spent</div><div><b>${s.active}</b>active</div><div><b>${Object.keys(s.names).length}</b>names</div></div>
        <div class="bar">${STATUSES.filter(st => s.by[st.k]).map(st => `<span title="${st.l}: ${s.by[st.k]}" style="width:${s.by[st.k] / s.n * 100}%;background:${st.c}"></span>`).join('')}</div>
        <div class="small faint" style="margin-top:8px">${s.last ? 'Last order ' + fmtDate(s.last) : ''}</div></div>`).join('')}</div>` : `<div class="empty">${total ? 'No houses match.' : 'No houses yet. Houses are created automatically from the shipping address on your order emails.'}</div>`}`;
    $('#hQ').oninput = debounce(e => { HF.q = e.target.value; PAGES.houses.render(); const i = $('#hQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 160);
    pg.querySelector('.toolbar .chips').onclick = e => { const b = e.target.closest('[data-hs]'); if (b) { HF.sort = b.dataset.hs; PAGES.houses.render(); } };
    pg.onclick = e => { const c = e.target.closest('[data-house]'); if (c) go('houses', c.dataset.house); };
  },
};
function renderHouse(id) {
  const pg = $('#pg-houses'); const h = houseById(id);
  pg.onclick = null;
  if (!h) { pg.innerHTML = `<div class="empty">That house no longer exists. <a href="#houses">Back to houses</a></div>`; return; }
  const s = houseStats(h);
  const groups = [['Active', s.os.filter(isActive)], ['Delivered', s.os.filter(o => o.status === 'delivered')], ['Cancelled & refunded', s.os.filter(isDead)]];
  const chipsOf = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span class="badge">${esc(k)} <span class="faint">${n}</span></span>`).join(' ') || '<span class="faint small">None</span>';
  const others = state.houses.filter(x => x.id !== h.id && houseOrders(x.id).length);
  pg.innerHTML = `<div class="pagehead"><button class="ghost sm" data-nav="houses">‹ Houses</button><h1>${esc(houseLabel(h))}</h1><span class="sub">${esc(houseAddr(h))}</span><div class="spacer"></div>
    <button id="hNick">${h.nickname ? 'Rename' : 'Give it a nickname'}</button>
    <select id="hMerge" style="width:auto"><option value="">Merge into…</option>${others.map(x => `<option value="${x.id}">${esc(houseLabel(x))}</option>`).join('')}</select></div>
    <div class="kpis">
      <div class="kpi"><div class="l">Orders</div><div class="v">${s.n}</div><div class="d">${itemCount({ items: s.os.flatMap(o => o.items || []) })} items</div></div>
      <div class="kpi"><div class="l">Spent</div><div class="v">${fmtMoney(s.spent)}</div></div>
      <div class="kpi"><div class="l">Active</div><div class="v">${s.active}</div></div>
      <div class="kpi"><div class="l">Delivered</div><div class="v">${s.delivered}</div></div>
      <div class="kpi"><div class="l">Cancelled</div><div class="v">${s.dead}</div><div class="d">${s.n ? Math.round((s.n - s.dead) / s.n * 100) + '% stick rate' : ''}</div></div>
    </div>
    <div class="cols3" style="margin-bottom:14px">
      <div class="card"><h3>Names used</h3>${chipsOf(s.names)}</div>
      <div class="card"><h3>Units / line 2 used</h3>${chipsOf(s.units)}</div>
      <div class="card"><h3>Profiles</h3>${Object.keys(s.profs).length ? Object.entries(s.profs).sort((a, b) => b[1] - a[1]).map(([pid, n]) => { const p = profileById(pid); return p ? `<button class="chip" data-prof="${pid}">${esc(p.name || 'Untitled')} <span class="n">${n}</span></button>` : ''; }).join(' ') : '<span class="faint small">No linked profiles</span>'}</div>
    </div>
    <div class="card" style="margin-bottom:14px"><h3>Notes</h3><textarea id="hNotes" style="min-height:60px;font-family:inherit;font-size:13px" placeholder="Gate code, who lives here, drop-off notes…">${esc(h.notes || '')}</textarea></div>
    ${groups.map(([l, os]) => `<div class="card" style="margin-bottom:14px"><h3>${l} <span class="badge">${os.length}</span><span class="spacer"></span>${os.length ? fmtMoney(sum(os, o => isDead(o) ? Number(o.total) || 0 : orderSpend(o))) : ''}</h3>${orderMiniList(os.sort((a, b) => String(b.orderDate).localeCompare(String(a.orderDate))), { empty: 'None' })}</div>`).join('')}`;
  $('#hNick').onclick = () => { const n = prompt('Nickname for this house (leave empty to use the address)', h.nickname || ''); if (n === null) return; h.nickname = n.trim(); save(); refresh(); };
  $('#hNotes').onchange = e => { h.notes = e.target.value; save(); };
  $('#hMerge').onchange = e => {
    const to = houseById(e.target.value); if (!to) return;
    if (!confirm(`Move all ${plural(s.n, 'order')} from “${houseLabel(h)}” into “${houseLabel(to)}”? Future emails for this address will go there too.`)) { e.target.value = ''; return; }
    snapshot('merge houses'); s.os.forEach(o => o.houseId = to.id); to.keys = Array.from(new Set([...(to.keys || []), ...(h.keys || [])]));
    if (h.notes) to.notes = [to.notes, h.notes].filter(Boolean).join('\n');
    state.houses = state.houses.filter(x => x.id !== h.id); save(); go('houses', to.id); toast('Houses merged', { undo: true });
  };
  pg.querySelectorAll('[data-prof]').forEach(b => b.onclick = () => openProfile(b.dataset.prof));
}

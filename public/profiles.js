/* Crown - Profiles: categories, table, edit, mass import, bulk edit, address line 2, quick tools, export. */
'use strict';
const FIELDS = [
  { k: 'name', l: 'Profile name', g: 'General', w: 2 },
  { k: 'email', l: 'Email', g: 'General', w: 1 },
  { k: 'phone', l: 'Phone', g: 'General', w: 1 },
  { k: 'shipFirst', l: 'First name', g: 'Shipping', w: 2 },
  { k: 'shipLast', l: 'Last name', g: 'Shipping', w: 2 },
  { k: 'shipAddr1', l: 'Address 1', g: 'Shipping', w: 2 },
  { k: 'shipAddr2', l: 'Address 2', g: 'Shipping', w: 2 },
  { k: 'shipCity', l: 'City', g: 'Shipping', w: 1 },
  { k: 'shipState', l: 'State', g: 'Shipping', w: 1 },
  { k: 'shipZip', l: 'ZIP', g: 'Shipping', w: 1 },
  { k: 'shipCountry', l: 'Country', g: 'Shipping', w: 1 },
  { k: 'sameBilling', l: 'Billing same as shipping', g: 'Billing', bool: true },
  { k: 'billFirst', l: 'First name', g: 'Billing', w: 2 },
  { k: 'billLast', l: 'Last name', g: 'Billing', w: 2 },
  { k: 'billAddr1', l: 'Address 1', g: 'Billing', w: 2 },
  { k: 'billAddr2', l: 'Address 2', g: 'Billing', w: 2 },
  { k: 'billCity', l: 'City', g: 'Billing', w: 1 },
  { k: 'billState', l: 'State', g: 'Billing', w: 1 },
  { k: 'billZip', l: 'ZIP', g: 'Billing', w: 1 },
  { k: 'billCountry', l: 'Country', g: 'Billing', w: 1 },
  { k: 'cardName', l: 'Cardholder name', g: 'Payment', w: 2 },
  { k: 'cardNumber', l: 'Card number', g: 'Payment', w: 2 },
  { k: 'cardExpMonth', l: 'Exp month (MM)', g: 'Payment', w: 1 },
  { k: 'cardExpYear', l: 'Exp year (YYYY)', g: 'Payment', w: 1 },
  { k: 'cardCvv', l: 'CVV', g: 'Payment', w: 1 },
];
const FIELD = Object.fromEntries(FIELDS.map(f => [f.k, f]));
const fullLabel = f => (f.g === 'Shipping' || f.g === 'Billing') && !f.bool ? `${f.g} ${f.l.toLowerCase()}` : f.l;
const ALIASES = {
  name: ['profile', 'profilename', 'title', 'profiletitle'],
  email: ['emailaddress', 'mail', 'useremail'],
  phone: ['phonenumber', 'tel', 'telephone', 'mobile', 'shippingphone'],
  shipFirst: ['first', 'firstname', 'fname', 'shippingfirstname', 'shipfirstname', 'shippingfirst'],
  shipLast: ['last', 'lastname', 'lname', 'shippinglastname', 'shiplastname', 'shippinglast'],
  shipAddr1: ['address', 'address1', 'addressline1', 'street', 'shippingaddress', 'shippingaddress1', 'shipaddress', 'shipaddress1', 'shippingline1'],
  shipAddr2: ['address2', 'addressline2', 'apt', 'unit', 'suite', 'shippingaddress2', 'shipaddress2', 'shippingline2'],
  shipCity: ['city', 'shippingcity', 'town'],
  shipState: ['state', 'province', 'region', 'shippingstate'],
  shipZip: ['zip', 'zipcode', 'postal', 'postalcode', 'postcode', 'shippingzip', 'shippingpostcode', 'shippingpostalcode'],
  shipCountry: ['country', 'shippingcountry', 'countrycode'],
  sameBilling: ['billingsameasshipping', 'sameasshipping', 'samebilling', 'billingmatchesshipping', 'sameshippingasbilling'],
  billFirst: ['billingfirstname', 'billingfirst'], billLast: ['billinglastname', 'billinglast'],
  billAddr1: ['billingaddress', 'billingaddress1', 'billaddress', 'billaddress1', 'billingline1'],
  billAddr2: ['billingaddress2', 'billaddress2', 'billingline2'],
  billCity: ['billingcity'], billState: ['billingstate'], billZip: ['billingzip', 'billingzipcode', 'billingpostalcode', 'billingpostcode'], billCountry: ['billingcountry'],
  cardName: ['cardholder', 'cardholdername', 'nameoncard', 'ccname', 'cardname'],
  cardNumber: ['card', 'cardnumber', 'cardnum', 'ccnumber', 'cc', 'number', 'ccnum', 'creditcard'],
  cardExpMonth: ['expmonth', 'expirymonth', 'expirationmonth', 'month', 'ccmonth', 'mm', 'cardexpmonth'],
  cardExpYear: ['expyear', 'expiryyear', 'expirationyear', 'year', 'ccyear', 'yy', 'yyyy', 'cardexpyear'],
  cardCvv: ['cvv', 'cvc', 'cvv2', 'securitycode', 'csc', 'cardcvv', 'cardcvc'],
  _exp: ['exp', 'expiry', 'expiration', 'expdate', 'expirationdate'],
  _category: ['category', 'group', 'folder', 'profilegroup'],
};
const HEADER_MAP = {};
for (const f of FIELDS) { HEADER_MAP[norm(f.k)] = f.k; HEADER_MAP[norm(fullLabel(f))] = f.k; }
for (const [k, arr] of Object.entries(ALIASES)) arr.forEach(a => HEADER_MAP[a] = k);

let view = 'all', selected = new Set(), search = '', issuesOnly = false, psort = { key: '', dir: 1 };
const catName = id => (state.categories.find(c => c.id === id) || {}).name || '—';
const catOptions = sel => state.categories.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
function ensureCategory(name) { name = String(name).trim(); if (!name) return null; let c = state.categories.find(c => c.name.toLowerCase() === name.toLowerCase()); if (!c) { c = { id: uid(), name }; state.categories.push(c); } return c.id; }
function blankProfile(catId) { const p = { id: uid(), categoryId: catId, notes: '', createdAt: Date.now() }; FIELDS.forEach(f => p[f.k] = f.bool ? true : ''); p.shipCountry = 'US'; p.billCountry = 'US'; return p; }
const fixState = v => { v = String(v || '').trim(); return (typeof STATE_ABBR !== 'undefined' && STATE_ABBR[v.toLowerCase()]) || v.toUpperCase(); };
const cardDigits = n => String(n || '').replace(/\D/g, '');
const cardMask = n => { n = cardDigits(n); return n ? '•••• ' + n.slice(-4) : ''; };
function luhn(n) { n = cardDigits(n); if (n.length < 12 || n.length > 19) return false; let s = 0, alt = false; for (let i = n.length - 1; i >= 0; i--) { let d = +n[i]; if (alt) { d *= 2; if (d > 9) d -= 9; } s += d; alt = !alt; } return s % 10 === 0; }
function cardBrand(n) { n = cardDigits(n); if (/^4/.test(n)) return 'Visa'; if (/^(5[1-5]|2[2-7])/.test(n)) return 'Mastercard'; if (/^3[47]/.test(n)) return 'Amex'; if (/^(6011|65|64[4-9])/.test(n)) return 'Discover'; if (/^35/.test(n)) return 'JCB'; return n ? 'Card' : ''; }
const shipName = p => [p.shipFirst, p.shipLast].filter(Boolean).join(' ');

/* duplicates & health */
let dupIndex = null;
function buildDupIndex() {
  const by = { card: {}, email: {}, addr: {} };
  for (const p of state.profiles) {
    const c = cardDigits(p.cardNumber); if (c) (by.card[c] = by.card[c] || []).push(p.id);
    const e = String(p.email || '').toLowerCase().trim(); if (e) (by.email[e] = by.email[e] || []).push(p.id);
    const a = Parser.unitKey(p.shipAddr1, p.shipAddr2, p.shipZip); if (a) (by.addr[a] = by.addr[a] || []).push(p.id);
  }
  dupIndex = by;
}
function health(p) {
  const out = [];
  const need = [['name', 'profile name'], ['email', 'email'], ['shipFirst', 'first name'], ['shipLast', 'last name'], ['shipAddr1', 'address'], ['shipCity', 'city'], ['shipState', 'state'], ['shipZip', 'ZIP'], ['cardNumber', 'card number'], ['cardExpMonth', 'exp month'], ['cardExpYear', 'exp year'], ['cardCvv', 'CVV']];
  const missing = need.filter(([k]) => !String(p[k] || '').trim()).map(([, l]) => l);
  if (missing.length) out.push('Missing ' + missing.join(', '));
  const c = cardDigits(p.cardNumber);
  if (c && !luhn(c)) out.push('Card number fails the checksum (likely a typo)');
  const m = Number(p.cardExpMonth), y = Number(String(p.cardExpYear).length === 2 ? '20' + p.cardExpYear : p.cardExpYear);
  if (m && y) { const now = new Date(); if (y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth() + 1)) out.push('Card expired ' + pad2(m) + '/' + y); if (m < 1 || m > 12) out.push('Exp month should be 01–12'); }
  if (p.cardCvv && !/^\d{3,4}$/.test(String(p.cardCvv))) out.push('CVV should be 3–4 digits');
  if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) out.push('Email looks invalid');
  if (p.shipZip && !/^\d{5}(-\d{4})?$/.test(String(p.shipZip)) && (p.shipCountry || 'US').toUpperCase() === 'US') out.push('ZIP should be 5 digits');
  if (dupIndex) {
    if (c && (dupIndex.card[c] || []).length > 1) out.push('Same card as ' + plural(dupIndex.card[c].length - 1, 'other profile'));
    const e = String(p.email || '').toLowerCase().trim(); if (e && (dupIndex.email[e] || []).length > 1) out.push('Same email as ' + plural(dupIndex.email[e].length - 1, 'other profile'));
  }
  return out;
}

function visibleProfiles() {
  const q = search.trim().toLowerCase();
  let list = state.profiles.filter(p => {
    if (view !== 'all' && p.categoryId !== view) return false;
    if (issuesOnly && !health(p).length) return false;
    if (!q) return true;
    return [p.name, p.email, p.shipFirst, p.shipLast, p.shipAddr1, p.shipAddr2, p.shipCity, p.shipState, p.shipZip, p.phone, cardDigits(p.cardNumber).slice(-4), p.notes].some(v => String(v || '').toLowerCase().includes(q));
  });
  if (psort.key) {
    const st = profileStats();
    const val = p => ({ name: p.name, email: p.email, ship: shipName(p), city: p.shipCity, state: p.shipState, orders: (st[p.id] || {}).n || 0, spent: (st[p.id] || {}).spent || 0 }[psort.key]);
    list = list.slice().sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'number' ? x - y : String(x || '').localeCompare(String(y || ''), undefined, { numeric: true })) * psort.dir; });
  }
  return list;
}
function selectedTargets() { const v = visibleProfiles(); if (!selected.size) return v; return v.filter(p => selected.has(p.id)).concat(state.profiles.filter(p => selected.has(p.id) && !v.includes(p))); }
function targetLabel() { const n = selectedTargets().length; return `— ${selected.size ? '' : 'all '}${n} ${selected.size ? 'selected ' : ''}profile${n === 1 ? '' : 's'}${selected.size ? '' : (view === 'all' ? '' : ' in ' + catName(view))}`; }
let _pstats = null;
function profileStats() {
  if (_pstats) return _pstats;
  const m = {};
  for (const o of state.orders) if (o.profileId) { const s = m[o.profileId] = m[o.profileId] || { n: 0, spent: 0, live: 0 }; s.n++; s.spent += orderSpend(o); if (!isDead(o)) s.live++; }
  _pstats = m; return m;
}
function invalidateStats() { _pstats = null; }

/* ---------- render ---------- */
PAGES.profiles = { render() { invalidateStats(); buildDupIndex(); renderCats(); renderTable(); } };
function renderCats() {
  const counts = {}; state.profiles.forEach(p => counts[p.categoryId] = (counts[p.categoryId] || 0) + 1);
  let h = `<div class="cat ${view === 'all' ? 'active' : ''}" data-id="all"><span>All profiles</span><span class="n">${state.profiles.length}</span></div>`;
  h += state.categories.map(c => `<div class="cat ${view === c.id ? 'active' : ''}" data-id="${c.id}"><span class="ellipsis">${esc(c.name)}</span><span class="n">${counts[c.id] || 0}</span><span class="act"><button data-ren="${c.id}" title="Rename">Rename</button><button data-del="${c.id}" title="Delete">✕</button></span></div>`).join('');
  $('#cats').innerHTML = h;
  $('#catCol').style.display = view === 'all' ? '' : 'none';
  if (view !== 'all' && !state.categories.some(c => c.id === view)) view = 'all';
}
function renderTable() {
  const list = visibleProfiles(); const st = profileStats();
  for (const id of [...selected]) if (!state.profiles.some(p => p.id === id)) selected.delete(id);
  const showCat = view === 'all';
  const issues = state.profiles.filter(p => health(p).length).length;
  $('#issuesChip').classList.toggle('on', issuesOnly);
  $('#issuesChip').innerHTML = `⚠ Issues only<span class="n">${issues}</span>`;
  $('#profSub').textContent = (view === 'all' ? 'All categories' : catName(view)) + ' · ' + plural(list.length, 'profile');
  $$('#pg-profiles th.sort').forEach(th => { th.querySelector('.arr')?.remove(); if (th.dataset.sort === psort.key) th.insertAdjacentHTML('beforeend', `<span class="arr">${psort.dir > 0 ? '▲' : '▼'}</span>`); });
  $('#rows').innerHTML = list.map(p => {
    const h = health(p); const s = st[p.id] || {};
    return `<tr data-id="${p.id}" class="${selected.has(p.id) ? 'sel' : ''}">
    <td class="cb"><input type="checkbox" data-cb="${p.id}" ${selected.has(p.id) ? 'checked' : ''} aria-label="Select"></td>
    <td><strong>${esc(p.name) || '<span class="muted">Untitled</span>'}</strong>${h.length ? ` <span class="warnicon" title="${esc(h.join('\n'))}">⚠</span>` : ''}</td>
    <td>${esc(p.email)}</td><td>${esc(shipName(p))}</td>
    <td>${esc(p.shipCity)}</td><td>${esc(p.shipState)}</td><td>${p.cardNumber ? `<span class="faint small">${cardBrand(p.cardNumber)}</span> ${cardMask(p.cardNumber)}` : ''}</td>
    <td>${p.cardExpMonth || p.cardExpYear ? esc(`${p.cardExpMonth}/${String(p.cardExpYear).slice(-2)}`) : ''}</td>
    <td class="right">${s.n || ''}</td><td class="right">${s.n ? fmtMoney(s.spent) : ''}</td>
    ${showCat ? `<td><span class="badge">${esc(catName(p.categoryId))}</span></td>` : ''}</tr>`;
  }).join('');
  const empty = $('#empty');
  if (!list.length) { empty.hidden = false; empty.innerHTML = search ? 'No profiles match your search.' : issuesOnly ? 'No profiles with issues. 👑' : 'No profiles here yet. Use <b>Mass import</b> to paste a batch, or <b>+ Add profile</b>.'; } else empty.hidden = true;
  $('#selAll').checked = list.length > 0 && list.every(p => selected.has(p.id));
  $('#selbar').hidden = selected.size === 0;
  $('#selCount').textContent = `${selected.size} selected`;
  $('#moveSel').innerHTML = `<option value="">Move to…</option>` + catOptions('');
}
$('#cats').onclick = e => {
  const ren = e.target.dataset.ren, del = e.target.dataset.del;
  if (ren) { const c = state.categories.find(c => c.id === ren); const n = prompt('Rename category', c.name); if (n && n.trim()) { c.name = n.trim(); save(); refresh(); } return; }
  if (del) {
    const n = state.profiles.filter(p => p.categoryId === del).length;
    if (state.categories.length === 1) { toast('You need at least one category'); return; }
    if (!confirm(`Delete category "${catName(del)}"${n ? ` and its ${plural(n, 'profile')}` : ''}?`)) return;
    snapshot('delete category'); const gone = new Set(state.profiles.filter(p => p.categoryId === del).map(p => p.id));
    state.profiles = state.profiles.filter(p => p.categoryId !== del); state.categories = state.categories.filter(c => c.id !== del);
    state.orders.forEach(o => { if (gone.has(o.profileId)) { o.profileId = ''; o.profileLink = ''; } });
    if (view === del) view = 'all'; selected.clear(); save(); refresh(); toast('Category deleted', { undo: true }); return;
  }
  const row = e.target.closest('.cat'); if (row) { view = row.dataset.id; selected.clear(); renderCats(); renderTable(); }
};
$('#addCat').onclick = () => { const n = prompt('Category name (e.g. Target, Walmart, Pokémon drops)'); if (n && n.trim()) { const id = ensureCategory(n); view = id; save(); refresh(); } };
$('#rows').onclick = e => {
  const cb = e.target.dataset.cb;
  if (cb) { e.target.checked ? selected.add(cb) : selected.delete(cb); renderTable(); return; }
  const tr = e.target.closest('tr'); if (tr) openProfile(tr.dataset.id);
};
$('#selAll').onchange = e => { visibleProfiles().forEach(p => e.target.checked ? selected.add(p.id) : selected.delete(p.id)); renderTable(); };
$('#search').oninput = debounce(e => { search = e.target.value; renderTable(); }, 120);
$('#issuesChip').onclick = () => { issuesOnly = !issuesOnly; renderTable(); };
$('#clearSel').onclick = () => { selected.clear(); renderTable(); };
$$('#pg-profiles th.sort').forEach(th => th.onclick = () => { const k = th.dataset.sort; if (psort.key === k) { if (psort.dir === -1) psort = { key: '', dir: 1 }; else psort.dir = -1; } else psort = { key: k, dir: ['orders', 'spent'].includes(k) ? -1 : 1 }; renderTable(); });
$('#moveSel').onchange = e => { const to = e.target.value; if (!to) return; snapshot('move profiles'); const n = selected.size; state.profiles.forEach(p => { if (selected.has(p.id)) p.categoryId = to; }); save(); refresh(); toast(`Moved ${plural(n, 'profile')} to ${catName(to)}`, { undo: true }); };
$('#dupBtn').onclick = () => { snapshot('duplicate'); const copies = state.profiles.filter(p => selected.has(p.id)).map(p => Object.assign({}, p, { id: uid(), name: (p.name || 'Profile') + ' copy', createdAt: Date.now() })); state.profiles.push(...copies); selected = new Set(copies.map(c => c.id)); save(); refresh(); toast(`Duplicated ${plural(copies.length, 'profile')}`, { undo: true }); };
$('#delBtn').onclick = () => {
  const n = selected.size; if (!confirm(`Delete ${plural(n, 'profile')}?`)) return;
  snapshot('delete profiles'); state.profiles = state.profiles.filter(p => !selected.has(p.id));
  state.orders.forEach(o => { if (selected.has(o.profileId)) { o.profileId = ''; o.profileLink = ''; } });
  selected.clear(); save(); refresh(); toast(`Deleted ${plural(n, 'profile')}`, { undo: true });
};

/* ---------- single profile ---------- */
let editing = null;
function openProfile(id) {
  const isNew = !id;
  editing = isNew ? blankProfile(view !== 'all' ? view : state.categories[0].id) : Object.assign({}, state.profiles.find(p => p.id === id));
  if (!editing || !editing.id) return;
  $('#profTitle').textContent = isNew ? 'New profile' : (editing.name || 'Edit profile');
  const h = isNew ? [] : health(editing);
  $('#profHealth').innerHTML = h.length ? `<span class="badge" style="border-color:#5a4520;color:#ecc87c" title="${esc(h.join('\n'))}">⚠ ${plural(h.length, 'issue')}</span>` : (isNew ? '' : '<span class="badge" style="color:#7fe0b2">✓ Looks good</span>');
  $('#profDelete').hidden = isNew;
  let html = `<div class="fgrid"><div class="s2"><label>Category</label><select data-k="categoryId">${catOptions(editing.categoryId)}</select></div><div class="s2"><label>Notes</label><input data-k="notes" value="${esc(editing.notes)}" placeholder="Anything to remember about this profile"></div></div>`;
  for (const g of ['General', 'Shipping', 'Billing', 'Payment']) {
    html += `<div class="section">${g}</div><div class="fgrid">`;
    for (const f of FIELDS.filter(f => f.g === g)) {
      if (f.bool) { html += `<div class="s4"><label class="check"><input type="checkbox" data-k="${f.k}" ${editing[f.k] ? 'checked' : ''}> ${f.l}</label></div>`; continue; }
      const extra = ['cardNumber', 'cardCvv', 'cardExpMonth', 'cardExpYear', 'phone', 'shipZip', 'billZip'].includes(f.k) ? 'inputmode="numeric" autocomplete="off"' : 'autocomplete="off"';
      html += `<div class="${f.w === 2 ? 's2' : ''}" ${g === 'Billing' ? 'data-bill' : ''}><label>${f.l}${f.k === 'cardNumber' ? ' <span id="brandLbl" class="faint"></span>' : ''}</label><input data-k="${f.k}" value="${esc(editing[f.k])}" ${extra}></div>`;
    }
    html += '</div>';
  }
  if (h.length) html += `<div class="note warn">${h.map(esc).join('<br>')}</div>`;
  $('#profBody').innerHTML = html;
  const sync = () => { const same = $('#profBody [data-k=sameBilling]').checked; $$('#profBody [data-bill]').forEach(el => el.hidden = same); };
  $('#profBody [data-k=sameBilling]').onchange = sync; sync();
  const brand = () => { const v = $('#profBody [data-k=cardNumber]').value; $('#brandLbl').textContent = v ? cardBrand(v) + (luhn(v) ? ' ✓' : ' — check number') : ''; };
  $('#profBody [data-k=cardNumber]').oninput = brand; brand();
  const orders = isNew ? [] : state.orders.filter(o => o.profileId === editing.id).sort((a, b) => String(b.orderDate).localeCompare(String(a.orderDate)));
  $('#profTabs').innerHTML = `<button class="tab on" data-tab="details">Details</button><button class="tab" data-tab="orders" ${isNew ? 'hidden' : ''}>Orders (${orders.length})</button>`;
  $('#profOrders').innerHTML = orders.length ? `<div class="kpis"><div class="kpi"><div class="l">Orders</div><div class="v">${orders.length}</div></div><div class="kpi"><div class="l">Spent</div><div class="v">${fmtMoney(sum(orders, orderSpend))}</div></div><div class="kpi"><div class="l">Stuck</div><div class="v">${orders.filter(o => !isDead(o)).length}</div><div class="d">${Math.round(orders.filter(o => !isDead(o)).length / orders.length * 100)}% stick rate</div></div></div>` + orderMiniList(orders) : '<div class="empty sm">No orders linked to this profile yet. Orders link automatically when the order email was sent to this profile’s email, or you can link one from the order.</div>';
  $('#profBody').hidden = false; $('#profOrders').hidden = true;
  openDlg('dlgProfile');
}
$('#profTabs').onclick = e => { const t = e.target.closest('.tab'); if (!t) return; $$('#profTabs .tab').forEach(x => x.classList.toggle('on', x === t)); $('#profBody').hidden = t.dataset.tab !== 'details'; $('#profOrders').hidden = t.dataset.tab !== 'orders'; $('#profSave').hidden = t.dataset.tab !== 'details'; };
$('#profOrders').onclick = e => { const r = e.target.closest('[data-order]'); if (r) { closeDlg('dlgProfile'); openOrder(r.dataset.order); } };
$('#addProfile').onclick = () => openProfile(null);
$('#profSave').onclick = () => {
  $$('#profBody [data-k]').forEach(el => { editing[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value.trim(); });
  editing.cardNumber = cardDigits(editing.cardNumber) || editing.cardNumber;
  if (editing.cardExpMonth && /^\d$/.test(editing.cardExpMonth)) editing.cardExpMonth = '0' + editing.cardExpMonth;
  if (/^\d{2}$/.test(editing.cardExpYear)) editing.cardExpYear = '20' + editing.cardExpYear;
  editing.shipState = fixState(editing.shipState); editing.billState = fixState(editing.billState);
  editing.updatedAt = Date.now();
  snapshot('edit profile');
  const i = state.profiles.findIndex(p => p.id === editing.id);
  if (i >= 0) state.profiles[i] = editing; else state.profiles.push(editing);
  autoLinkAll(); closeDlg('dlgProfile'); save(); refresh(); toast('Saved', { undo: true });
};
$('#profDelete').onclick = () => {
  if (!confirm('Delete this profile?')) return;
  snapshot('delete profile'); const id = editing.id;
  state.profiles = state.profiles.filter(p => p.id !== id); selected.delete(id);
  state.orders.forEach(o => { if (o.profileId === id) { o.profileId = ''; o.profileLink = ''; } });
  closeDlg('dlgProfile'); save(); refresh(); toast('Profile deleted', { undo: true });
};

/* ---------- mass import ---------- */
const truthy = v => !/^(no|n|false|0|off)$/i.test(String(v).trim());
let impParsed = null;
function impAnalyze() {
  let text = $('#impText').value.trim();
  if (/^[\[{]/.test(text)) { // JSON (array of objects, or {profiles:[...]})
    try {
      let j = JSON.parse(text); if (!Array.isArray(j)) j = j.profiles || Object.values(j);
      const keys = Array.from(new Set(j.flatMap(o => Object.keys(o || {}))));
      text = [keys.join('\t'), ...j.map(o => keys.map(k => String(o[k] ?? '').replace(/[\t\n]/g, ' ')).join('\t'))].join('\n');
    } catch (_) { }
  }
  const rows = parseDelimited(text);
  if (rows.length < 2) { impParsed = null; $('#impPreview').textContent = rows.length ? 'Add at least one data row under the headers.' : ''; $('#impMap').innerHTML = ''; $('#impGo').disabled = true; return; }
  const headers = rows[0].map(h => String(h).trim()); const map = headers.map(h => HEADER_MAP[norm(h)] || null);
  impParsed = { map, rows: rows.slice(1) };
  $('#impPreview').innerHTML = `<b>${rows.length - 1}</b> ${rows.length > 2 ? 'profiles' : 'profile'} found. Column matching:`;
  $('#impMap').innerHTML = headers.map((h, i) => { const k = map[i]; const lbl = k === '_exp' ? 'Exp (MM/YY)' : k === '_category' ? 'Category' : k ? fullLabel(FIELD[k]) : 'ignored'; return `<span class="badge ${k ? '' : 'bad'}">${esc(h)} → ${esc(lbl)}</span>`; }).join('');
  $('#impGo').disabled = false;
}
$('#impText').oninput = impAnalyze;
$('#impFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; $('#impText').value = await f.text(); e.target.value = ''; impAnalyze(); };
$('#importBtn').onclick = () => {
  $('#impCat').innerHTML = catOptions(view !== 'all' ? view : state.categories[0].id) + '<option value="__new">+ New category…</option>';
  $('#impText').value = ''; impAnalyze(); openDlg('dlgImport');
};
$('#impCat').onchange = e => { if (e.target.value === '__new') { const n = prompt('New category name'); const id = n && ensureCategory(n); $('#impCat').innerHTML = catOptions(id || state.categories[0].id) + '<option value="__new">+ New category…</option>'; renderCats(); } };
$('#impGo').onclick = () => {
  if (!impParsed) return;
  snapshot('import profiles');
  const baseCat = $('#impCat').value; const added = []; const counter = {};
  for (const r of impParsed.rows) {
    let catId = baseCat; const p = blankProfile(catId); let hasBill = false, sameSet = false;
    impParsed.map.forEach((k, i) => {
      const v = String(r[i] ?? '').trim(); if (!k || v === '') return;
      if (k === '_category') { catId = ensureCategory(v) || baseCat; return; }
      if (k === '_exp') { const m = v.match(/(\d{1,2})\s*[\/\-]\s*(\d{2,4})/); if (m) { p.cardExpMonth = m[1].padStart(2, '0'); p.cardExpYear = m[2].length === 2 ? '20' + m[2] : m[2]; } return; }
      if (k === 'sameBilling') { p.sameBilling = truthy(v); sameSet = true; return; }
      if (k.startsWith('bill')) hasBill = true;
      p[k] = v;
    });
    p.categoryId = catId;
    if (!sameSet) p.sameBilling = !hasBill;
    p.cardNumber = cardDigits(p.cardNumber) || p.cardNumber;
    if (p.cardExpMonth) p.cardExpMonth = String(p.cardExpMonth).padStart(2, '0');
    if (/^\d{2}$/.test(p.cardExpYear)) p.cardExpYear = '20' + p.cardExpYear;
    p.shipState = fixState(p.shipState); p.billState = fixState(p.billState);
    if (!p.name) { counter[catId] = (counter[catId] || state.profiles.filter(x => x.categoryId === catId).length) + 1; p.name = `${catName(catId)} ${counter[catId]}`; }
    added.push(p);
  }
  state.profiles.push(...added); selected = new Set(added.map(p => p.id));
  autoLinkAll(); closeDlg('dlgImport'); save(); refresh(); toast(`Imported ${plural(added.length, 'profile')}`, { undo: true });
};
$('#tmplBtn').onclick = () => download('crown-profile-template.csv', ['category', ...FIELDS.map(f => f.k)].join(',') + '\n', 'text/csv');

/* ---------- bulk edit ---------- */
function bulkRowHtml() {
  return `<div class="row bulkrow" style="margin-bottom:10px">
    <div><label>Field</label><select class="bf">${FIELDS.map(f => `<option value="${f.k}">${esc(fullLabel(f))}</option>`).join('')}<option value="notes">Notes</option></select></div>
    <div><label>Action</label><select class="bm"><option value="set">Set to</option><option value="replace">Find &amp; replace</option><option value="append">Add to end</option><option value="prepend">Add to start</option><option value="clear">Clear</option></select></div>
    <div class="bv1w"><label class="bv1l">Value</label><input class="bv1"></div>
    <div class="bv2w" hidden><label>Replace with</label><input class="bv2"></div>
    <button class="brm fixed" title="Remove">✕</button></div>`;
}
function wireBulkRow(el) {
  const upd = () => {
    const m = el.querySelector('.bm').value, f = FIELD[el.querySelector('.bf').value] || {};
    el.querySelector('.bv1w').hidden = m === 'clear'; el.querySelector('.bv2w').hidden = m !== 'replace';
    el.querySelector('.bv1l').textContent = m === 'replace' ? 'Find' : (f.bool && m === 'set' ? 'Value (yes / no)' : 'Value');
  };
  el.querySelector('.bm').onchange = upd; el.querySelector('.bf').onchange = upd;
  el.querySelector('.brm').onclick = () => { if ($('#bulkRows').children.length > 1) el.remove(); };
  upd();
}
function addBulkRow() { $('#bulkRows').insertAdjacentHTML('beforeend', bulkRowHtml()); wireBulkRow($('#bulkRows').lastElementChild); }
$('#bulkAddRow').onclick = addBulkRow;
$('#bulkBtn').onclick = () => { if (!selectedTargets().length) { toast('No profiles to edit yet'); return; } $('#bulkRows').innerHTML = ''; addBulkRow(); $('#bulkCount').textContent = targetLabel(); openDlg('dlgBulk'); };
const fillTokens = (s, p, i) => String(s).replace(/\{r:(\d+)-(\d+)\}/g, (_, a, b) => rint(+a, +b)).replace(/\{n\}/g, i + 1).replace(/\{name\}/g, p.name || '').replace(/\{first\}/g, p.shipFirst || '').replace(/\{last\}/g, p.shipLast || '');
$('#bulkGo').onclick = () => {
  const ops = $$('.bulkrow').map(el => ({ k: el.querySelector('.bf').value, m: el.querySelector('.bm').value, v1: el.querySelector('.bv1').value, v2: el.querySelector('.bv2').value }));
  const targets = selectedTargets(); snapshot('bulk edit');
  targets.forEach((p, i) => {
    for (const o of ops) {
      const f = FIELD[o.k] || {};
      if (f.bool) { if (o.m === 'set') p[o.k] = truthy(o.v1); else if (o.m === 'clear') p[o.k] = true; continue; }
      const c = String(p[o.k] ?? '');
      if (o.m === 'set') p[o.k] = fillTokens(o.v1, p, i);
      else if (o.m === 'clear') p[o.k] = '';
      else if (o.m === 'append') p[o.k] = c + fillTokens(o.v1, p, i);
      else if (o.m === 'prepend') p[o.k] = fillTokens(o.v1, p, i) + c;
      else if (o.m === 'replace' && o.v1) p[o.k] = c.split(o.v1).join(fillTokens(o.v2, p, i));
      if (o.k === 'cardNumber') p[o.k] = cardDigits(p[o.k]) || p[o.k];
    }
    p.updatedAt = Date.now();
  });
  autoLinkAll(); closeDlg('dlgBulk'); save(); refresh(); toast(`Updated ${plural(targets.length, 'profile')}`, { undo: true });
};

/* ---------- address line 2 (all taps, no typing) ---------- */
const UNIT_TYPES = ['Apt', 'Apt.', 'Unit', 'Suite', 'Ste', '#', 'Room', 'Rm', 'Bldg', 'Fl', 'Floor', 'Lot', 'Trlr', 'Spc', 'Dept'];
const LETTERS = 'ABCDEFGH'.split('');
const BLOCKS = [[1, 50], [51, 99], [100, 199], [200, 299], [300, 399], [400, 499], [500, 599], [600, 699], [700, 799], [800, 899], [900, 999], [1000, 1099], [2000, 2099]];
const RANGES = ['1-9', '1-50', '1-99', '10-99', '100-499', '100-999', '1-999', '1000-4999', '1000-9999'];
const STARTS = [1, 2, 10, 100, 101, 200, 201, 300, 301, 400, 500, 1000, 1001];
const STEPS = [1, 2, 3, 5, 10, 100];
const L2 = { target: 'ship', exist: 'replace', types: new Set(['Apt']), mode: 'rand', block: 2, picked: new Set(), shuf: false, start: 101, step: 1, range: '100-999', unique: true, letter: 'never', letters: new Set(['A', 'B', 'C', 'D']) };
let l2Gen = [];
const chip = (attrs, label, on) => `<button type="button" class="chip ${on ? 'on' : ''}" ${attrs}>${esc(label)}</button>`;
const segL2 = (key, opts) => `<div class="chips">${opts.map(([v, l]) => chip(`data-seg="${key}" data-val="${v}"`, l, L2[key] === v)).join('')}</div>`;
const selL2 = (key, opts, fmt = x => x) => `<select data-sel="${key}" style="width:auto;min-width:140px">${opts.map((o, i) => { const v = Array.isArray(o) ? i : o; return `<option value="${v}" ${String(L2[key]) === String(v) ? 'selected' : ''}>${esc(fmt(o))}</option>`; }).join('')}</select>`;
function l2Render() {
  let h = `<div class="section">Apply to</div>${segL2('target', [['ship', 'Shipping'], ['bill', 'Billing'], ['both', 'Both']])}
  <div class="section">If a profile already has a line 2</div>${segL2('exist', [['replace', 'Replace it'], ['skip', 'Leave it alone']])}
  <div class="section">Unit type <span style="text-transform:none;letter-spacing:0;font-weight:400">— pick one, or several to mix them randomly</span></div>
  <div class="chips">${UNIT_TYPES.map(t => chip(`data-type="${esc(t)}"`, t, L2.types.has(t))).join('')}${chip('data-type="__none"', 'None (number only)', L2.types.has('__none'))}</div>
  <div class="section">Numbers</div>${segL2('mode', [['pick', 'Pick numbers'], ['seq', 'Count up'], ['rand', 'Random']])}`;
  if (L2.mode === 'pick') {
    const [a, b] = BLOCKS[L2.block]; const nums = []; for (let x = a; x <= b; x++) nums.push(x);
    h += `<div class="hstack" style="margin-top:10px">${selL2('block', BLOCKS, ([x, y]) => `${x}–${y}`)}${chip('data-act="all"', 'Select all shown', false)}${chip('data-act="clear"', 'Clear all', false)}${chip('data-tog="shuf"', 'Shuffle order', L2.shuf)}<span class="small muted">${L2.picked.size} picked</span></div>
      <div class="chips numgrid" style="margin-top:8px">${nums.map(x => chip(`data-num="${x}"`, x, L2.picked.has(x))).join('')}</div>
      <div class="small muted" style="margin-top:6px">Picks are kept when you switch ranges. If you pick fewer numbers than profiles, they repeat.</div>`;
  } else if (L2.mode === 'seq') {
    h += `<div class="hstack" style="margin-top:10px"><div><label>Start at</label>${selL2('start', STARTS)}</div><div><label>Go up by</label>${selL2('step', STEPS)}</div></div>`;
  } else {
    h += `<div class="hstack" style="margin-top:10px;align-items:end"><div><label>Range</label>${selL2('range', RANGES, r => r.replace('-', '–'))}</div>${chip('data-tog="unique"', 'No repeats', L2.unique)}</div>`;
  }
  h += `<div class="section">Letter on the end (e.g. 4B)</div>${segL2('letter', [['never', 'No letters'], ['some', 'Sometimes'], ['always', 'Always']])}`;
  if (L2.letter !== 'never') h += `<div class="chips" style="margin-top:8px">${LETTERS.map(l => chip(`data-letter="${l}"`, l, L2.letters.has(l))).join('')}</div>`;
  h += `<div class="section">Preview</div><div id="l2Preview" class="small"></div><div class="chips" style="margin-top:8px">${chip('data-act="reroll"', '↻ Re-roll', false)}</div>`;
  const body = $('#l2Body'), top = body.scrollTop; body.innerHTML = h; body.scrollTop = top;
  l2Generate();
}
function l2Generate() {
  const n = selectedTargets().length; let nums = [];
  if (L2.mode === 'pick') { const p = [...L2.picked].sort((a, b) => a - b).map(String); if (L2.shuf) shuffle(p); nums = p.length ? Array.from({ length: n }, (_, i) => p[i % p.length]) : []; }
  else if (L2.mode === 'seq') nums = Array.from({ length: n }, (_, i) => String(+L2.start + i * +L2.step));
  else { const [lo, hi] = L2.range.split('-').map(Number), used = new Set(), space = hi - lo + 1; for (let i = 0; i < n; i++) { let s = String(rint(lo, hi)), t = 0; while (L2.unique && n <= space && used.has(s) && t++ < 1000) s = String(rint(lo, hi)); used.add(s); nums.push(s); } }
  const lets = [...L2.letters].sort(), types = [...L2.types];
  l2Gen = nums.map(v => {
    if (lets.length && (L2.letter === 'always' || (L2.letter === 'some' && Math.random() < .4))) v += lets[rint(0, lets.length - 1)];
    const d = types.length ? types[rint(0, types.length - 1)] : '';
    return d === '__none' || !d ? v : d === '#' ? `#${v}` : `${d} ${v}`;
  });
  const tg = selectedTargets(), pv = $('#l2Preview');
  if (!l2Gen.length) { pv.innerHTML = '<span class="muted">Tap some numbers above to see a preview.</span>'; $('#l2Go').disabled = true; return; }
  $('#l2Go').disabled = false;
  pv.innerHTML = tg.slice(0, 6).map((p, i) => `<div style="padding:3px 0"><span class="muted">${esc(p.name || 'Untitled')}:</span> ${esc(p.shipAddr1 || '(no address)')}, <b>${esc(l2Gen[i])}</b></div>`).join('') + (tg.length > 6 ? `<div class="muted" style="padding-top:3px">…and ${tg.length - 6} more</div>` : '');
}
$('#l2Body').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return; const d = b.dataset;
  if (d.seg) L2[d.seg] = d.val;
  else if (d.type) { const s = L2.types; if (d.type === '__none') { s.clear(); s.add('__none'); } else { s.delete('__none'); s.has(d.type) && s.size > 1 ? s.delete(d.type) : s.add(d.type); } }
  else if (d.num) { const x = +d.num; L2.picked.has(x) ? L2.picked.delete(x) : L2.picked.add(x); }
  else if (d.letter) { const s = L2.letters; s.has(d.letter) && s.size > 1 ? s.delete(d.letter) : s.add(d.letter); }
  else if (d.tog) L2[d.tog] = !L2[d.tog];
  else if (d.act === 'all') { const [a, z] = BLOCKS[L2.block]; for (let x = a; x <= z; x++) L2.picked.add(x); }
  else if (d.act === 'clear') L2.picked.clear();
  else if (d.act === 'reroll') { l2Generate(); return; }
  l2Render();
});
$('#l2Body').addEventListener('change', e => { const k = e.target.dataset.sel; if (!k) return; L2[k] = k === 'range' ? e.target.value : +e.target.value; l2Render(); });
$('#l2Btn').onclick = () => { if (!selectedTargets().length) { toast('No profiles to edit yet — import or add some first'); return; } $('#l2Count').textContent = targetLabel(); l2Render(); openDlg('dlgL2'); };
function copyShipToBill(p) { ['First', 'Last', 'Addr1', 'Addr2', 'City', 'State', 'Zip', 'Country'].forEach(s => p['bill' + s] = p['ship' + s]); p.sameBilling = false; }
$('#l2Go').onclick = () => {
  const tg = selectedTargets(), target = L2.target, skip = L2.exist === 'skip'; let changed = 0;
  snapshot('address line 2');
  tg.forEach((p, i) => {
    const v = l2Gen[i]; if (v == null) return; let did = false;
    if (target === 'ship' || target === 'both') { if (!(skip && p.shipAddr2)) { p.shipAddr2 = v; did = true; } }
    if (target === 'bill' || (target === 'both' && !p.sameBilling)) { if (p.sameBilling) copyShipToBill(p); if (!(skip && p.billAddr2)) { p.billAddr2 = v; did = true; } }
    if (did) { changed++; p.updatedAt = Date.now(); }
  });
  autoLinkAll(); closeDlg('dlgL2'); save(); refresh(); toast(`Updated line 2 on ${plural(changed, 'profile')}`, { undo: true });
};

/* ---------- quick tools ---------- */
const STATE_ABBR = { alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC', 'puerto rico': 'PR' };
const titleCase = s => String(s || '').toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase()).replace(/\b(Ne|Nw|Se|Sw|Po)\b/g, m => m.toUpperCase());
const STREET_ABBR = { street: 'St', avenue: 'Ave', road: 'Rd', drive: 'Dr', lane: 'Ln', court: 'Ct', boulevard: 'Blvd', place: 'Pl', circle: 'Cir', parkway: 'Pkwy', highway: 'Hwy', terrace: 'Ter', north: 'N', south: 'S', east: 'E', west: 'W', apartment: 'Apt', suite: 'Ste' };
const abbrStreet = s => String(s || '').replace(/\b[a-z]+\b/gi, w => STREET_ABBR[w.toLowerCase()] || w);
const ADDR_KEYS = ['shipAddr1', 'shipAddr2', 'shipCity', 'billAddr1', 'billAddr2', 'billCity'];
const NAME_KEYS = ['shipFirst', 'shipLast', 'billFirst', 'billLast', 'cardName'];
const QUICK = [
  { id: 'same', t: 'Billing same as shipping', d: 'Turn on “billing same as shipping”.', fn: p => { p.sameBilling = true; } },
  { id: 'copy', t: 'Copy shipping → billing', d: 'Fill billing with the shipping address and turn off “same as shipping”.', fn: p => copyShipToBill(p) },
  { id: 'clear2', t: 'Clear address line 2', d: 'Remove line 2 from shipping and billing.', fn: p => { p.shipAddr2 = ''; p.billAddr2 = ''; } },
  { id: 'title', t: 'Capitalize names & addresses', d: 'john SMITH → John Smith, 12 main st → 12 Main St.', fn: p => { [...NAME_KEYS, ...ADDR_KEYS].forEach(k => p[k] = titleCase(p[k])); } },
  { id: 'upper', t: 'UPPERCASE addresses', d: 'Some bots and stores prefer all caps.', fn: p => { ADDR_KEYS.forEach(k => p[k] = String(p[k] || '').toUpperCase()); } },
  { id: 'abbr', t: 'Abbreviate street words', d: 'Street → St, Avenue → Ave, North → N…', fn: p => { ['shipAddr1', 'billAddr1'].forEach(k => p[k] = abbrStreet(p[k])); } },
  { id: 'state', t: 'States to 2-letter codes', d: 'Utah → UT, New York → NY.', fn: p => { ['shipState', 'billState'].forEach(k => { const v = String(p[k] || '').trim(); p[k] = STATE_ABBR[v.toLowerCase()] || v.toUpperCase(); }); } },
  { id: 'phone', t: 'Phones: digits only', d: '(801) 555-1234 → 8015551234.', fn: p => { p.phone = String(p.phone || '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1'); } },
  { id: 'phonefmt', t: 'Phones: (555) 555-5555', d: 'Standard US format.', fn: p => { const d = String(p.phone || '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1'); if (d.length === 10) p.phone = `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`; } },
  { id: 'phonerand', t: 'Randomize phone last 4', d: 'Keeps the area code and prefix, new random last 4 digits.', fn: p => { const d = String(p.phone || '').replace(/\D/g, ''); if (d.length >= 10) p.phone = d.slice(0, d.length - 4) + String(rint(0, 9999)).padStart(4, '0'); } },
  { id: 'cardname', t: 'Cardholder = shipping name', d: 'Set the cardholder name to the shipping first + last name.', fn: p => { if (shipName(p)) p.cardName = shipName(p); } },
  { id: 'yyyy', t: 'Exp year to 4 digits', d: '27 → 2027, and months to 2 digits (7 → 07).', fn: p => { if (/^\d{2}$/.test(p.cardExpYear)) p.cardExpYear = '20' + p.cardExpYear; if (/^\d$/.test(p.cardExpMonth)) p.cardExpMonth = '0' + p.cardExpMonth; } },
  { id: 'trim', t: 'Clean up spaces', d: 'Trim extra spaces in every field.', fn: p => { FIELDS.forEach(f => { if (!f.bool && typeof p[f.k] === 'string') p[f.k] = p[f.k].replace(/\s+/g, ' ').trim(); }); } },
  { id: 'rename', t: 'Rename to category + number', d: 'Target 1, Target 2… in the current order.', fn: (p, i) => { p.name = catName(p.categoryId) + ' ' + (i + 1); } },
];
$('#quickBtn').onclick = () => {
  if (!selectedTargets().length) { toast('No profiles to edit yet'); return; }
  $('#quickCount').textContent = targetLabel();
  $('#quickList').innerHTML = QUICK.map(q => `<div class="li"><div style="flex:1;min-width:0"><div>${esc(q.t)}</div><div class="small muted">${esc(q.d)}</div></div><button class="sm" data-q="${q.id}">Apply</button></div>`).join('');
  openDlg('dlgQuick');
};
$('#quickList').onclick = e => {
  const b = e.target.closest('[data-q]'); if (!b) return; const q = QUICK.find(x => x.id === b.dataset.q);
  const tg = selectedTargets(); snapshot(q.t);
  tg.forEach((p, i) => { q.fn(p, i); p.updatedAt = Date.now(); });
  autoLinkAll(); save(); refresh(); $('#quickCount').textContent = targetLabel();
  b.textContent = '✓ Done'; setTimeout(() => { b.textContent = 'Apply'; }, 1400);
  toast(`${q.t}: ${plural(tg.length, 'profile')}`, { undo: true });
};

/* ---------- export ---------- */
const EXP = { scope: 'view', fmt: 'csv' };
function renderExport() {
  $('#expScope').innerHTML = [['sel', `Selected (${selected.size})`], ['view', `Current view (${visibleProfiles().length})`], ['all', `All (${state.profiles.length})`]].map(([v, l]) => `<button class="chip ${EXP.scope === v ? 'on' : ''}" data-v="${v}" ${v === 'sel' && !selected.size ? 'disabled' : ''}>${l}</button>`).join('');
  $('#expFmt').innerHTML = [['csv', 'CSV (spreadsheet)'], ['json', 'JSON']].map(([v, l]) => `<button class="chip ${EXP.fmt === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('');
}
$('#expScope').onclick = e => { const b = e.target.closest('[data-v]'); if (b && !b.disabled) { EXP.scope = b.dataset.v; renderExport(); } };
$('#expFmt').onclick = e => { const b = e.target.closest('[data-v]'); if (b) { EXP.fmt = b.dataset.v; renderExport(); } };
$('#exportBtn').onclick = () => { EXP.scope = selected.size ? 'sel' : 'view'; renderExport(); openDlg('dlgExport'); };
$('#expGo').onclick = () => {
  const list = EXP.scope === 'sel' ? state.profiles.filter(p => selected.has(p.id)) : EXP.scope === 'view' ? visibleProfiles() : state.profiles;
  if (!list.length) { toast('Nothing to export'); return; }
  const rows = list.map(p => { const o = { category: catName(p.categoryId) }; FIELDS.forEach(f => { let v = p[f.k]; if (f.bool) v = v ? 'yes' : 'no'; if (f.g === 'Billing' && !f.bool && p.sameBilling) v = p['ship' + f.k.slice(4)]; o[f.k] = v ?? ''; }); o.notes = p.notes || ''; return o; });
  if (EXP.fmt === 'json') download(`crown-profiles-${stamp()}.json`, JSON.stringify(rows, null, 2), 'application/json');
  else download(`crown-profiles-${stamp()}.csv`, toCSV(Object.keys(rows[0]), rows), 'text/csv');
  closeDlg('dlgExport'); toast(`Exported ${plural(list.length, 'profile')}`);
};

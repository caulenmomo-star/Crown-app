/* Crown Tools - register (record a sale), sales log, expenses and profit. */
'use strict';
// Fee estimates per selling platform: percent of the sale + a flat amount per order. Editable in each sale and in Settings.
const PLATFORMS = [
  { k: 'ebay', l: 'eBay', pct: 13.6, flat: 0.4 },
  { k: 'tcgplayer', l: 'TCGplayer', pct: 13.25, flat: 0.3 },
  { k: 'whatnot', l: 'Whatnot', pct: 10.9, flat: 0.3 },
  { k: 'mercari', l: 'Mercari', pct: 10, flat: 0.5 },
  { k: 'facebook', l: 'Facebook', pct: 10, flat: 0 },
  { k: 'stockx', l: 'StockX', pct: 12, flat: 0 },
  { k: 'discord', l: 'Discord / DM', pct: 0, flat: 0 },
  { k: 'local', l: 'In person', pct: 0, flat: 0 },
  { k: 'other', l: 'Other', pct: 0, flat: 0 },
];
const platformInfo = k => PLATFORMS.find(p => p.k === k) || PLATFORMS[PLATFORMS.length - 1];
const feeFor = k => Object.assign({}, platformInfo(k), (state.settings.platformFees || {})[k] || {});
const EXP_CATS = ['Shipping supplies', 'Postage', 'Bots & software', 'Proxies', 'Servers', 'ACO / cook groups', 'Fees', 'Travel', 'Other'];
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const saleRevenue = s => sum(s.lines || [], l => (Number(l.price) || 0) * (Number(l.qty) || 0));
const saleCost = s => sum(s.lines || [], l => l.cost == null ? 0 : Number(l.cost) * (Number(l.qty) || 0));
const saleProfit = s => saleRevenue(s) - saleCost(s) - (Number(s.fees) || 0) - (Number(s.shipping) || 0);
const SL = { range: '30', tab: 'overview', q: '' };

/* ---------- register (record / edit a sale) ---------- */
let curSale = null, saleIsNew = false, saleOrig = null;
function openSale(itemIds, saleId) {
  const ex = saleId && (state.sales || []).find(s => s.id === saleId);
  saleIsNew = !ex; saleOrig = ex ? JSON.parse(JSON.stringify(ex)) : null;
  curSale = ex ? JSON.parse(JSON.stringify(ex)) : { id: uid(), date: todayKey(), platform: state.settings.lastPlatform || 'ebay', lines: [], fees: null, feesAuto: true, shipping: null, buyer: '', notes: '', createdAt: Date.now() };
  (itemIds || []).forEach(id => addSaleLine(invById(id)));
  renderSale(); openDlg('dlgSale');
}
function addSaleLine(it, name) {
  if (it) { const l = curSale.lines.find(x => x.itemId === it.id); if (l) { l.qty++; return; } const mv = unitValue(it); curSale.lines.push({ itemId: it.id, name: it.name, qty: 1, price: mv != null ? r2(mv) : null, cost: it.cost == null ? null : Number(it.cost), image: it.image || (it.market && it.market.image) || '' }); }
  else curSale.lines.push({ itemId: '', name: name || '', qty: 1, price: null, cost: null, image: '' });
}
function autoFees() { const f = feeFor(curSale.platform); const rev = saleRevenue(curSale); return rev ? r2(rev * (Number(f.pct) || 0) / 100 + (Number(f.flat) || 0)) : 0; }
function readSale() {
  if (!$('#slDate')) return;
  curSale.date = $('#slDate').value || todayKey(); curSale.platform = $('#slPlat').value; curSale.buyer = $('#slBuyer').value.trim(); curSale.notes = $('#slNotes').value;
  $$('#slLines [data-ln]').forEach(row => { const l = curSale.lines[+row.dataset.ln]; if (!l) return; const q = row.querySelector('[data-f=qty]'), p = row.querySelector('[data-f=price]'), c = row.querySelector('[data-f=cost]'), n = row.querySelector('[data-f=name]');
    if (q) l.qty = Math.max(1, Math.round(Number(q.value) || 1)); if (p) l.price = p.value.trim() === '' ? null : r2(p.value.replace(/[$,]/g, '')); if (c) l.cost = c.value.trim() === '' ? null : r2(c.value.replace(/[$,]/g, '')); if (n) l.name = n.value; });
  const fv = $('#slFees').value.trim(); curSale.feesAuto = fv === '' || curSale.feesAuto && Number(fv) === curSale._lastAuto; curSale.fees = fv === '' ? null : r2(fv.replace(/[$,]/g, ''));
  const sv = $('#slShip').value.trim(); curSale.shipping = sv === '' ? null : r2(sv.replace(/[$,]/g, ''));
}
function renderSale() {
  const s = curSale;
  if (s.feesAuto !== false) { s.fees = autoFees(); }
  s._lastAuto = autoFees();
  const rev = saleRevenue(s), cost = saleCost(s), prof = rev - cost - (Number(s.fees) || 0) - (Number(s.shipping) || 0);
  const f = feeFor(s.platform);
  const inv = (state.inventory || []).filter(i => (Number(i.qty) || 0) > 0 || s.lines.some(l => l.itemId === i.id)).sort((a, b) => a.name.localeCompare(b.name));
  $('#saleTitle').textContent = saleIsNew ? 'Record a sale' : 'Sale';
  $('#saleBody').innerHTML = `<div class="cols3 tight"><div><label>Date</label><input type="date" id="slDate" value="${esc(s.date)}"></div>
      <div><label>Sold on</label><select id="slPlat">${PLATFORMS.map(p => `<option value="${p.k}" ${s.platform === p.k ? 'selected' : ''}>${p.l}</option>`).join('')}</select></div>
      <div><label>Buyer (optional)</label><input id="slBuyer" value="${esc(s.buyer)}"></div></div>
    <div class="section">Items</div>
    <div id="slLines">${s.lines.length ? s.lines.map((l, i) => { const it = l.itemId && invById(l.itemId); return `<div class="saleline" data-ln="${i}">${thumb(l.image, 'sm')}
        <div class="sl-name">${it ? `<div class="t2">${esc(l.name)}</div><div class="small faint">${esc(it.qty)} in stock</div>` : `<input data-f="name" value="${esc(l.name)}" placeholder="Item name">`}</div>
        <div class="sl-f"><label>Qty</label><input data-f="qty" inputmode="numeric" value="${esc(l.qty)}"></div>
        <div class="sl-f"><label>Sold for, each</label><input data-f="price" inputmode="decimal" value="${l.price ?? ''}" placeholder="$"></div>
        <div class="sl-f"><label>Cost each</label><input data-f="cost" inputmode="decimal" value="${l.cost ?? ''}" placeholder="$"></div>
        <button class="ghost sm" data-rm="${i}" title="Remove">✕</button></div>`; }).join('') : '<div class="small muted" style="margin-bottom:8px">Add what you sold from your inventory, scan it, or type it in.</div>'}</div>
    <div class="hstack" style="flex-wrap:wrap;gap:6px;margin-top:6px"><select id="slPick" style="flex:1;min-width:180px"><option value="">＋ Add from inventory…</option>${inv.map(i => `<option value="${i.id}">${esc(i.name)} (${esc(i.qty || 0)})</option>`).join('')}</select><button id="slScan">📷 Scan</button><button class="ghost" id="slFree">Type one in</button></div>
    <div class="cols2 tight" style="margin-top:12px"><div><label>Platform fees ($) <span class="faint small">${f.pct || f.flat ? `est. ${f.pct}% + ${fmtMoney(f.flat)}` : ''}</span></label><input id="slFees" inputmode="decimal" value="${s.fees ?? ''}"></div>
      <div><label>Shipping you paid ($)</label><input id="slShip" inputmode="decimal" value="${s.shipping ?? ''}" placeholder="0"></div></div>
    <div style="margin-top:10px"><label>Notes</label><input id="slNotes" value="${esc(s.notes)}" placeholder="Tracking, payment, anything"></div>
    <div class="salesum"><div><span>Sold for</span><b>${fmtMoney(rev)}</b></div><div><span>Cost</span><b>${fmtMoney(cost)}</b></div><div><span>Fees + shipping</span><b>${fmtMoney((Number(s.fees) || 0) + (Number(s.shipping) || 0))}</b></div><div class="${prof >= 0 ? 'pos' : 'neg'}"><span>Profit</span><b>${prof >= 0 ? '' : '−'}${fmtMoney(Math.abs(prof))}</b></div></div>`;
  $('#saleDelete').hidden = saleIsNew;
  const rer = () => { readSale(); renderSale(); };
  $$('#saleBody input, #saleBody select').forEach(el => { if (el.id === 'slPick') return; el.onchange = rer; });
  $('#slPlat').onchange = () => { readSale(); curSale.feesAuto = true; renderSale(); };
  $('#slFees').oninput = () => { curSale.feesAuto = false; };
  $('#slPick').onchange = e => { readSale(); const it = invById(e.target.value); if (it) addSaleLine(it); renderSale(); };
  $('#slFree').onclick = () => { readSale(); addSaleLine(null, ''); renderSale(); const ins = $$('#slLines [data-f=name]'); if (ins.length) ins[ins.length - 1].focus(); };
  $('#slScan').onclick = () => { readSale(); Scan.open({ title: 'Scan what you sold', sub: 'Scan each product’s barcode.', onCode: c => { const it = findItemFor('', String(c).replace(/\D/g, '')); if (!it) return { ok: false, msg: 'Not in your inventory' }; addSaleLine(it); return { ok: true, msg: '+1 ' + it.name }; }, onClose: () => { if ($('#dlgSale').open) renderSale(); } }); };
  $$('#slLines [data-rm]').forEach(b => b.onclick = () => { readSale(); curSale.lines.splice(+b.dataset.rm, 1); renderSale(); });
}
// Stock changes: a new sale takes units out; editing gives the old ones back first; deleting can put them back.
function applyStock(sale, dir) { for (const l of sale.lines || []) { const it = l.itemId && invById(l.itemId); if (it) { it.qty = Math.max(0, (Number(it.qty) || 0) - dir * (Number(l.qty) || 0)); it.updatedAt = Date.now(); } } }
function wireSaleDlg() {
  $('#saleSave').onclick = () => {
    readSale(); const s = curSale;
    s.lines = s.lines.filter(l => l.itemId || String(l.name || '').trim());
    if (!s.lines.length) { toast('Add at least one item'); return; }
    if (s.lines.some(l => l.price == null)) { toast('Enter what each item sold for'); return; }
    for (const l of s.lines) { const it = l.itemId && invById(l.itemId); const was = saleOrig ? sum(saleOrig.lines.filter(x => x.itemId === l.itemId), x => x.qty) : 0; if (it && (Number(it.qty) || 0) + was < l.qty) { toast(`Only ${it.qty} of “${it.name}” in stock`); return; } }
    snapshot(saleIsNew ? 'record sale' : 'edit sale');
    if (saleOrig) applyStock(saleOrig, -1);
    applyStock(s, 1);
    const clean = Object.assign({}, s); delete clean._lastAuto; clean.updatedAt = Date.now();
    state.sales = (state.sales || []).filter(x => x.id !== clean.id).concat([clean]);
    state.settings.lastPlatform = s.platform;
    save(); closeDlg('dlgSale'); refresh(); toast(saleIsNew ? `Sale recorded · profit ${fmtMoney(saleProfit(clean))}` : 'Sale saved', { undo: true });
  };
  $('#saleDelete').onclick = async () => {
    if (!await ask('Delete this sale?\n\nThe items go back into your inventory.', { ok: 'Delete sale', danger: true })) return;
    snapshot('delete sale'); if (saleOrig) applyStock(saleOrig, -1);
    state.sales = state.sales.filter(x => x.id !== curSale.id); save(); closeDlg('dlgSale'); refresh(); toast('Sale deleted', { undo: true });
  };
}

/* ---------- expenses ---------- */
let curExp = null;
function openExpense(id) {
  const ex = id && (state.expenses || []).find(e => e.id === id);
  curExp = ex ? Object.assign({}, ex) : { id: uid(), date: todayKey(), category: state.settings.lastExpCat || EXP_CATS[0], amount: null, note: '', createdAt: Date.now() };
  $('#expBody').innerHTML = `<div class="cols2 tight"><div><label>Date</label><input type="date" id="exDate" value="${esc(curExp.date)}"></div><div><label>Amount ($)</label><input id="exAmt" inputmode="decimal" value="${curExp.amount ?? ''}"></div></div>
    <div style="margin-top:10px"><label>Category</label><select id="exCat">${EXP_CATS.map(c => `<option ${c === curExp.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
    <div style="margin-top:10px"><label>What for</label><input id="exNote" value="${esc(curExp.note)}" placeholder="Valor renewal, bubble mailers…"></div>`;
  $('#expDelete').hidden = !ex; openDlg('dlgExpense');
  setTimeout(() => { if (!isCompact()) $('#exAmt').focus(); }, 50);
}
function wireExpDlg() {
  $('#expSave').onclick = () => {
    const amt = r2(String($('#exAmt').value).replace(/[$,]/g, '')); if (!(amt > 0)) { toast('Enter the amount'); return; }
    Object.assign(curExp, { date: $('#exDate').value || todayKey(), amount: amt, category: $('#exCat').value, note: $('#exNote').value.trim(), updatedAt: Date.now() });
    state.settings.lastExpCat = curExp.category;
    state.expenses = (state.expenses || []).filter(e => e.id !== curExp.id).concat([curExp]); save(); closeDlg('dlgExpense'); refresh(); toast('Expense saved');
  };
  $('#expDelete').onclick = async () => { if (!await ask('Delete this expense?')) return; snapshot('delete expense'); state.expenses = state.expenses.filter(e => e.id !== curExp.id); save(); closeDlg('dlgExpense'); refresh(); toast('Deleted', { undo: true }); };
}

/* ---------- sales page ---------- */
function inSpan(day, spec) { const [a, b] = rangeSpan(spec); const d = parseDay(day); if (!d) return false; return (!a || d >= a) && (!b || d < b); }
PAGES.sales = {
  render() {
    const pg = $('#pg-sales');
    const sales = (state.sales || []).filter(s => inSpan(s.date, SL.range)).sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.createdAt || 0) - (a.createdAt || 0));
    const exps = (state.expenses || []).filter(e => inSpan(e.date, SL.range)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const rev = sum(sales, saleRevenue), cogs = sum(sales, saleCost), fees = sum(sales, s => s.fees), ship = sum(sales, s => s.shipping), exp = sum(exps, e => e.amount);
    const net = rev - cogs - fees - ship - exp;
    const units = sum(sales, s => sum(s.lines, l => l.qty));
    // chart: by month for long ranges, by day otherwise
    const [a, b] = rangeSpan(SL.range);
    const first = a || parseDay([...(state.sales || []).map(s => s.date), ...(state.expenses || []).map(e => e.date)].sort()[0]) || new Date();
    const end = b ? new Date(b.getTime() - 864e5) : new Date();
    const spanDays = Math.round((end - first) / 864e5) + 1, monthly = spanDays > 62;
    const buckets = []; const idx = {};
    if (monthly) { for (let d = new Date(first.getFullYear(), first.getMonth(), 1); d <= end && buckets.length < 60; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) { const k = d.getFullYear() + '-' + pad2(d.getMonth() + 1); idx[k] = buckets.length; buckets.push({ k, label: d.toLocaleDateString('en-US', { month: 'short' }), value: 0 }); } }
    else { for (let d = new Date(first.getFullYear(), first.getMonth(), first.getDate()); d <= end && buckets.length < 70; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) { const k = dayKey(d); idx[k] = buckets.length; buckets.push({ k, label: (d.getMonth() + 1) + '/' + d.getDate(), value: 0 }); } }
    const bk = day => idx[monthly ? String(day).slice(0, 7) : day];
    sales.forEach(s => { const i = bk(s.date); if (i != null) buckets[i].value += saleProfit(s); });
    exps.forEach(e => { const i = bk(e.date); if (i != null) buckets[i].value -= Number(e.amount) || 0; });
    buckets.forEach(x => x.title = `${x.label}: ${fmtMoney(x.value)} profit`);
    const byPlat = {}; sales.forEach(s => { const k = s.platform; byPlat[k] = byPlat[k] || { v: 0, n: 0, p: 0 }; byPlat[k].v += saleRevenue(s); byPlat[k].n++; byPlat[k].p += saleProfit(s); });
    // each line's share of the sale's fees and shipping, by what it sold for
    const byItem = {}; sales.forEach(s => { const r = saleRevenue(s) || 1, extra = (Number(s.fees) || 0) + (Number(s.shipping) || 0); s.lines.forEach(l => { const k = l.name, v = (l.price || 0) * l.qty; byItem[k] = byItem[k] || { q: 0, v: 0, p: 0 }; byItem[k].q += l.qty; byItem[k].v += v; byItem[k].p += v - (l.cost || 0) * l.qty - extra * v / r; }); });
    const q = SL.q.trim().toLowerCase();
    const shownSales = q ? sales.filter(s => [s.buyer, s.notes, platformInfo(s.platform).l, ...s.lines.map(l => l.name)].some(v => String(v || '').toLowerCase().includes(q))) : sales;
    const tabs = [['overview', 'Profit'], ['sales', 'Sales log'], ['expenses', 'Expenses']];
    pg.innerHTML = `<div class="pagehead"><h1>Sales</h1><span class="sub">${esc(rangeLabel(SL.range))}</span><div class="spacer"></div>
        <button class="primary" id="slNew">＋ Record sale</button><button id="slExp">＋ Expense</button><button class="ghost" id="slCsv">Export</button></div>
      <div class="hstack rangebar" style="flex-wrap:wrap;gap:6px;margin-bottom:12px"><div class="chips" id="slRange">${SP_RANGES.map(([k, l]) => `<button class="chip ${SL.range === k ? 'on' : ''}" data-sr="${k}">${l}</button>`).join('')}</div></div>
      <div class="kpis">
        <div class="kpi"><div class="l">Net profit</div><div class="v ${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '' : '−'}${fmtMoney(Math.abs(net), true)}</div><div class="d">${rev ? Math.round(net / rev * 100) + '% margin' : '&nbsp;'}</div></div>
        <div class="kpi"><div class="l">Sales</div><div class="v">${fmtMoney(rev, true)}</div><div class="d">${plural(sales.length, 'sale')} · ${plural(units, 'unit')}</div></div>
        <div class="kpi"><div class="l">Cost of goods</div><div class="v">${fmtMoney(cogs, true)}</div><div class="d">what those items cost you</div></div>
        <div class="kpi"><div class="l">Fees + shipping</div><div class="v">${fmtMoney(fees + ship, true)}</div><div class="d">${fmtMoney(fees, true)} fees · ${fmtMoney(ship, true)} shipping</div></div>
        <div class="kpi"><div class="l">Expenses</div><div class="v">${fmtMoney(exp, true)}</div><div class="d">${plural(exps.length, 'expense')}</div></div>
      </div>
      <div class="tabs" id="slTabs">${tabs.map(([k, l]) => `<button class="tab ${SL.tab === k ? 'on' : ''}" data-st="${k}">${l}</button>`).join('')}</div>
      ${SL.tab === 'overview' ? `<div class="card" style="margin-bottom:14px"><h3>Profit ${monthly ? 'by month' : 'by day'}<span class="spacer"></span><span class="muted" style="font-weight:400">after cost, fees, shipping and expenses</span></h3>${buckets.length ? svgBars(buckets, { signed: true }) : '<div class="empty sm">No sales yet.</div>'}</div>
        <div class="cols2"><div class="card"><h3>By platform</h3>${Object.keys(byPlat).length ? hbars(Object.entries(byPlat).sort((a, b) => b[1].v - a[1].v).map(([k, x]) => ({ name: platformInfo(k).l, v: x.v, n: x.n, p: x.p, c: 'var(--accent)' })), { fmt: r => fmtMoney(r.v) + ' · ' + plural(r.n, 'sale') + ' · ' + fmtMoney(r.p) + ' profit' }) : '<div class="empty sm">—</div>'}</div>
          <div class="card"><h3>Top items</h3>${Object.keys(byItem).length ? `<div class="list">${Object.entries(byItem).sort((a, b) => b[1].p - a[1].p).slice(0, 8).map(([n, x]) => `<div class="li"><div class="mmain"><div class="t2">${esc(n)}</div><div class="small muted">${plural(x.q, 'unit')} · ${fmtMoney(x.v)}</div></div><div class="dright small ${x.p >= 0 ? 'pos' : 'neg'}">${x.p >= 0 ? '+' : '−'}${fmtMoney(Math.abs(x.p))}</div></div>`).join('')}</div>` : '<div class="empty sm">—</div>'}</div></div>`
      : SL.tab === 'sales' ? `<div class="toolbar"><input class="search" data-search id="slQ" placeholder="Search item, buyer, platform…  ( / )" value="${esc(SL.q)}"></div>
        ${shownSales.length ? `<div class="list">${shownSales.map(s => { const p = saleProfit(s); return `<div class="li click dli" data-sale="${s.id}">${thumb((s.lines.find(l => l.image) || {}).image, 'sm')}<div class="mmain"><div class="t2">${esc(s.lines.map(l => (l.qty > 1 ? l.qty + '× ' : '') + l.name).join(', '))}</div><div class="small muted ellipsis">${esc(fmtDate(s.date))} · ${esc(platformInfo(s.platform).l)}${s.buyer ? ' · ' + esc(s.buyer) : ''}</div></div><div class="dright"><b>${fmtMoney(saleRevenue(s))}</b><div class="small ${p >= 0 ? 'pos' : 'neg'}">${p >= 0 ? '+' : '−'}${fmtMoney(Math.abs(p))}</div></div></div>`; }).join('')}</div>` : `<div class="empty">${(state.sales || []).length ? 'No sales in this range.' : 'No sales yet. Tap <b>Record sale</b> when you sell something — Crown Tools takes it out of your inventory and works out your profit after fees and shipping.'}</div>`}`
      : `${exps.length ? `<div class="list">${exps.map(e => `<div class="li click" data-exp="${e.id}"><div class="mmain"><div class="t2">${esc(e.note || e.category)}</div><div class="small muted">${esc(fmtDate(e.date))} · ${esc(e.category)}</div></div><div class="dright"><b>${fmtMoney(e.amount)}</b></div></div>`).join('')}</div>` : '<div class="empty">No expenses in this range. Add bot renewals, proxies, shipping supplies and other costs so your profit is real.</div>'}`}`;
    $('#slNew').onclick = () => openSale([]);
    $('#slExp').onclick = () => openExpense();
    $('#slCsv').onclick = () => {
      const rows = (state.sales || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).flatMap(s => s.lines.map((l, i) => ({ date: s.date, platform: platformInfo(s.platform).l, item: l.name, qty: l.qty, price_each: l.price, cost_each: l.cost ?? '', fees: i ? '' : s.fees ?? '', shipping: i ? '' : s.shipping ?? '', profit: i ? '' : r2(saleProfit(s)), buyer: s.buyer, notes: s.notes })));
      const ex = (state.expenses || []).map(e => ({ date: e.date, platform: 'EXPENSE', item: e.category + (e.note ? ' — ' + e.note : ''), qty: '', price_each: '', cost_each: '', fees: '', shipping: '', profit: -e.amount, buyer: '', notes: '' }));
      download(`crown-tools-sales-${stamp()}.csv`, toCSV(['date', 'platform', 'item', 'qty', 'price_each', 'cost_each', 'fees', 'shipping', 'profit', 'buyer', 'notes'], rows.concat(ex)), 'text/csv');
    };
    $('#slRange').onclick = e => { const b = e.target.closest('[data-sr]'); if (b) { SL.range = b.dataset.sr; PAGES.sales.render(); } };
    $('#slTabs').onclick = e => { const b = e.target.closest('[data-st]'); if (b) { SL.tab = b.dataset.st; PAGES.sales.render(); } };
    if ($('#slQ')) $('#slQ').oninput = debounce(e => { SL.q = e.target.value; PAGES.sales.render(); const i = $('#slQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 160);
    pg.querySelectorAll('[data-sale]').forEach(el => el.onclick = () => openSale([], el.dataset.sale));
    pg.querySelectorAll('[data-exp]').forEach(el => el.onclick = () => openExpense(el.dataset.exp));
  },
};

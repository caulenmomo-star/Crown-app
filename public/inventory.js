/* Crown Tools - inventory (scan any barcode to look it up, restock it or add it) and live TCGplayer market prices. */
'use strict';
const INV = { q: '', sort: 'value', show: 'stock' };
const invById = id => (state.inventory || []).find(x => x.id === id);
const invKey = n => String(n || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/^\s*pok[eé]mon\s+(?:trading\s+card\s+game|tcg)\s*[:\-–—]\s*/, '').replace(/[^a-z0-9]/g, '');
function newItem(f) { return Object.assign({ id: uid(), name: '', upc: '', sku: '', qty: 0, cost: null, value: null, image: '', location: '', notes: '', market: null, createdAt: Date.now(), updatedAt: Date.now() }, f || {}); }
// The market price used for value: TCGplayer market (chosen printing), else low/mid, else the price you typed in
function mPrice(m) { if (!m || !m.prices) return null; const p = m.prices[m.sub] || m.prices.Normal || Object.values(m.prices)[0] || {}; const v = p.market ?? p.mid ?? p.low; return v == null ? null : Number(v); }
const unitValue = it => { const m = mPrice(it.market); return m != null ? m : (it.value != null && it.value !== '' ? Number(it.value) : null); };
const itemValue = it => { const v = unitValue(it); return v == null ? null : v * (Number(it.qty) || 0); };
const itemCost = it => it.cost == null || it.cost === '' ? null : Number(it.cost) * (Number(it.qty) || 0);
function invStats(list) {
  const units = sum(list, i => Math.max(0, Number(i.qty) || 0));
  const cost = sum(list, i => itemCost(i) || 0), value = sum(list, i => itemValue(i) || 0);
  const priced = list.filter(i => unitValue(i) != null && (Number(i.qty) || 0) > 0);
  const costPriced = sum(priced, i => itemCost(i) || 0), valPriced = sum(priced, i => itemValue(i) || 0);
  return { units, cost, value, gain: valPriced - costPriced, priced: priced.length };
}
// Add units to an item, keeping a running average cost
function addStock(it, qty, unitCost) {
  const q0 = Math.max(0, Number(it.qty) || 0), q = Number(qty) || 0;
  if (unitCost != null && unitCost !== '' && q > 0) {
    const c0 = it.cost == null || it.cost === '' ? null : Number(it.cost);
    it.cost = c0 == null || q0 === 0 ? Math.round(Number(unitCost) * 100) / 100 : Math.round((c0 * q0 + Number(unitCost) * q) / (q0 + q) * 100) / 100;
  }
  it.qty = Math.max(0, q0 + q); it.updatedAt = Date.now();
}
// Product names differ between stores and barcode databases ("Pokemon TCG: Scarlet & Violet Prismatic Evolutions
// Elite Trainer Box" vs "Prismatic Evolutions Elite Trainer Box"), so compare them without the brand words.
const NOISE = /\b(?:pok[eé]mon|tcg|trading|card|cards|game|the|and|scarlet|violet|sv|official|new|sealed|english|en|us)\b/g;
const coreKey = n => String(n || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' ').replace(NOISE, ' ').replace(/\betb\b/g, 'elite trainer box').replace(/[^a-z0-9]/g, '');
function findItemFor(name, upc) {
  const inv = state.inventory || [];
  if (upc) { const x = inv.find(i => i.upc && i.upc === upc); if (x) return x; }
  const k = invKey(name); if (k.length < 4) return null;
  const exact = inv.find(i => invKey(i.name) === k) || inv.find(i => i.market && invKey(i.market.name) === k); if (exact) return exact;
  const c = coreKey(name); if (c.length < 12) return null;
  return inv.find(i => [i.name, i.market && i.market.name].some(n => { const d = coreKey(n); return d.length >= 12 && (d === c || (Math.min(d.length, c.length) >= 16 && (d.includes(c) || c.includes(d)))); })) || null;
}

/* ---------- orders → inventory ---------- */
function orderInvLines(o) { return (o.items || []).filter(i => qtyOf(i) > 0 && i.name).map(i => ({ name: i.name, qty: qtyOf(i), price: i.price, image: i.image || '' })); }
function addOrderToInventory(o) {
  if (o.invAdded) return 0; let n = 0;
  for (const l of orderInvLines(o)) {
    let it = findItemFor(l.name, '');
    if (!it) { it = newItem({ name: l.name, image: l.image }); state.inventory.push(it); }
    if (!it.image && l.image) it.image = l.image;
    addStock(it, l.qty, l.price); n += l.qty;
    it.sources = (it.sources || []).concat([{ orderId: o.id, qty: l.qty, at: Date.now() }]).slice(-50);
  }
  o.invAdded = Date.now(); o.updatedAt = Date.now();
  return n;
}
function invAfterCheckin(o) { if (state.settings.invOnCheckin && !o.invAdded && orderInvLines(o).length) addOrderToInventory(o); }
function openFromOrders() {
  const list = state.orders.filter(o => o.status === 'delivered' && !o.invAdded && orderInvLines(o).length).sort((a, b) => String(b.deliveredAt || b.orderDate).localeCompare(String(a.deliveredAt || a.orderDate)));
  const sel = new Set();
  const draw = () => {
    $('#ifoBody').innerHTML = list.length ? `<div class="small muted" style="margin-bottom:8px">Delivered orders that aren’t in your inventory yet. Each item is added with what you paid as its cost.</div>
      <div class="hstack" style="margin-bottom:8px"><button class="ghost sm" id="ifoAll">${sel.size === list.length ? 'Select none' : 'Select all'}</button><span class="small faint">${sel.size} selected</span></div>
      <div class="list">${list.slice(0, 300).map(o => `<label class="li click ifo"><input type="checkbox" data-ifo="${o.id}" ${sel.has(o.id) ? 'checked' : ''}>${thumb(orderImage(o), 'sm')}<div class="mmain"><div class="t2">${esc(shortTitle(o)) || '#' + esc(o.orderNumber)}</div><div class="small muted ellipsis">${esc(Parser.storeInfo(o.store).label)} · ${esc(fmtDate(o.deliveredAt || o.orderDate))} · ${plural(sum(orderInvLines(o), l => l.qty), 'unit')}${o.total != null ? ' · ' + fmtMoney(o.total) : ''}</div></div></label>`).join('')}</div>`
      : '<div class="empty sm">Every delivered order is already in your inventory.</div>';
    $('#ifoGo').disabled = !sel.size; $('#ifoGo').textContent = sel.size ? `Add ${plural(sel.size, 'order')}` : 'Add';
    if ($('#ifoAll')) $('#ifoAll').onclick = () => { if (sel.size === list.length) sel.clear(); else list.forEach(o => sel.add(o.id)); draw(); };
    $$('#ifoBody [data-ifo]').forEach(c => c.onchange = () => { c.checked ? sel.add(c.dataset.ifo) : sel.delete(c.dataset.ifo); $('#ifoGo').disabled = !sel.size; $('#ifoGo').textContent = sel.size ? `Add ${plural(sel.size, 'order')}` : 'Add'; });
  };
  $('#ifoGo').onclick = () => { snapshot('add orders to inventory'); let n = 0; list.filter(o => sel.has(o.id)).forEach(o => n += addOrderToInventory(o)); save(); closeDlg('dlgInvOrders'); refresh(); toast(`Added ${plural(n, 'unit')} to inventory`, { undo: true }); };
  draw(); openDlg('dlgInvOrders');
}

/* ---------- scanning product barcodes ---------- */
let invScanMode = 'add';
async function lookupUpc(code) { try { const r = await api('/api/upc', { code }); return r.found ? r : null; } catch (e) { return { error: e.message }; } }
// From the Inventory scanner: +1 / −1 / look up. From the universal scanner: open the item.
async function invScanCode(code, mode) {
  const c = String(code).replace(/\D/g, '');
  mode = mode || (Scan.open_ && $('#scanModes') && !$('#scanModes').hidden ? invScanMode : 'look');
  let it = findItemFor('', c), looked = null;
  // a barcode we haven't seen: look it up, and if it's a product you already have (from an order), remember the barcode on it
  if (!it) { looked = await lookupUpc(c); const same = looked && looked.name && findItemFor(looked.name, ''); if (same) { it = same; if (!it.upc) { it.upc = c; it.updatedAt = Date.now(); save(); } } }
  if (mode === 'look') {
    Scan.close();
    if (it) { openItem(it.id); return { ok: true, msg: it.name, close: true }; }
    const r = looked;
    openItem(null, { upc: c, name: r && r.name || '', image: r && r.image || '' }, r && r.error ? r.error : r ? '' : 'This barcode isn’t in the free lookup — type the name.');
    return { ok: true, msg: 'New item', close: true };
  }
  if (!it) {
    if (mode === 'remove') return { ok: false, msg: 'Not in your inventory' };
    const r = looked;
    it = newItem({ upc: c, name: (r && r.name) || 'Item ' + c, image: (r && r.image) || '' }); state.inventory.push(it);
  }
  if (mode === 'remove') { if ((Number(it.qty) || 0) <= 0) return { ok: false, warn: true, msg: `${it.name} is already at 0` }; it.qty = (Number(it.qty) || 0) - 1; }
  else addStock(it, 1, null);
  it.updatedAt = Date.now(); save(); if (route.page === 'inventory') softRefresh();
  return { ok: true, msg: `${mode === 'remove' ? '−1' : '+1'} ${it.name} · now ${it.qty}` };
}
function openInvScanner() {
  Scan.open({ title: 'Scan products', sub: 'Scan the barcode (UPC) on each product.', hint: 'Point the camera at the product barcode', modes: true, onCode: c => isProductCode(c) || /^\d{6,14}$/.test(c) ? invScanCode(c, invScanMode) : { ok: false, msg: 'That isn’t a product barcode' }, onClose: () => { $('#scanModes').hidden = true; softRefresh(); } });
  const m = $('#scanModes'); m.hidden = false;
  const draw = () => { m.innerHTML = [['add', '＋1 Restock / add'], ['remove', '−1 Remove'], ['look', 'Look up']].map(([k, l]) => `<button class="chip ${invScanMode === k ? 'on' : ''}" data-sm="${k}">${l}</button>`).join(''); };
  draw(); m.onclick = e => { const b = e.target.closest('[data-sm]'); if (b) { invScanMode = b.dataset.sm; draw(); } };
}

/* ---------- market prices (TCGplayer, via tcgcsv.com) ---------- */
const GAME_ORDER = [/^pok[eé]mon$/i, /pok[eé]mon japan/i, /^magic/i, /one piece/i, /lorcana/i, /yu-?gi-?oh/i, /star wars/i, /dragon ball/i, /digimon/i, /flesh/i];
let marketCats = null;
async function loadCats() {
  if (marketCats) return marketCats;
  const r = await api('/api/market/categories', {});
  const rank = c => { const i = GAME_ORDER.findIndex(re => re.test(c.name)); return i < 0 ? 99 : i; };
  marketCats = r.categories.filter(c => c.name).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return marketCats;
}
let pricesBusy = false;
async function refreshPrices(force, quiet) {
  const linked = (state.inventory || []).filter(i => i.market && i.market.id);
  if (!linked.length || !SERVER) return 0;
  if (pricesBusy) { if (!force) return 0; await new Promise(res => { const t = setInterval(() => { if (!pricesBusy) { clearInterval(t); res(); } }, 150); }); }
  const last = state.settings.pricesAt || 0;
  if (!force && Date.now() - last < 12 * 3600e3) return 0;
  pricesBusy = true;
  try {
    const r = await api('/api/market/prices', { fresh: !!force, items: linked.map(i => ({ cat: i.market.cat, group: i.market.group, id: i.market.id })) });
    const day = todayKey(); let n = 0;
    for (const it of linked) {
      const p = r.prices[String(it.market.id)]; if (!p) continue;
      it.market.prices = p; it.market.at = Date.now();
      const v = mPrice(it.market);
      if (v != null) { const h = it.market.history || (it.market.history = []); const last = h[h.length - 1]; if (last && last[0] === day) last[1] = v; else h.push([day, v]); if (h.length > 400) h.splice(0, h.length - 400); }
      n++;
    }
    state.settings.pricesAt = Date.now(); save();
    if (!quiet) toast(`Updated ${plural(n, 'price')}${r.failedSets ? ' · ' + r.failedSets + ' sets didn’t load' : ''}`);
    if (route.page === 'inventory') softRefresh();
    return n;
  } catch (e) { if (!quiet) toast(e.message); return 0; }
  finally { pricesBusy = false; }
}
function sparkline(hist, w, h) {
  const pts = (hist || []).slice(-90); if (pts.length < 2) return '';
  const vs = pts.map(p => p[1]); const lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1) * w).toFixed(1)},${(h - 3 - (p[1] - lo) / span * (h - 6)).toFixed(1)}`).join('');
  const up = vs[vs.length - 1] >= vs[0];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${up ? 'var(--ok)' : 'var(--danger)'}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}
function priceChart(hist) {
  const pts = (hist || []).slice(-180); if (pts.length < 2) return '<div class="small faint">Price history builds up day by day once the item is linked.</div>';
  const W = 560, H = 150, vs = pts.map(p => p[1]); const lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const x = i => 40 + i / (pts.length - 1) * (W - 50), y = v => 10 + (1 - (v - lo) / span) * (H - 34);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="pchart" role="img" aria-label="Price history">
    <line x1="40" x2="${W - 10}" y1="${y(hi)}" y2="${y(hi)}" class="grid"/><line x1="40" x2="${W - 10}" y1="${y(lo)}" y2="${y(lo)}" class="grid"/>
    <text x="36" y="${y(hi) + 4}" text-anchor="end">${esc(fmtMoney(hi, true))}</text><text x="36" y="${y(lo) + 4}" text-anchor="end">${esc(fmtMoney(lo, true))}</text>
    <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
    <text x="40" y="${H - 4}">${esc(fmtDate(pts[0][0]))}</text><text x="${W - 10}" y="${H - 4}" text-anchor="end">${esc(fmtDate(pts[pts.length - 1][0]))}</text></svg>`;
}

/* ---------- item dialog ---------- */
let curItem = null, itemIsNew = false, mSearch = { cat: '', q: '', results: null, busy: false, err: '', sealed: true };
function openItem(id, prefill, note) {
  const it = id ? invById(id) : null; itemIsNew = !it;
  curItem = JSON.parse(JSON.stringify(it || newItem(Object.assign({ qty: 1 }, prefill || {}))));
  curItem._note = note || '';
  mSearch = Object.assign(mSearch, { q: '', results: null, err: '', busy: false });
  if (!mSearch.q && curItem.name) mSearch.q = curItem.name.replace(/^\s*pok[eé]mon\s+(?:trading\s+card\s+game|tcg)\s*[:\-–—]\s*/i, '').slice(0, 60);
  renderItem(); openDlg('dlgItem');
}
function readItemForm() {
  const v = id => ($('#' + id) || {}).value;
  if (!$('#iName')) return;
  curItem.name = v('iName').trim(); curItem.upc = v('iUpc').replace(/\D/g, ''); curItem.qty = Math.max(0, Math.round(Number(v('iQty')) || 0));
  curItem.cost = v('iCost').trim() === '' ? null : Math.round(Number(v('iCost').replace(/[$,]/g, '')) * 100) / 100;
  curItem.value = v('iValue').trim() === '' ? null : Math.round(Number(v('iValue').replace(/[$,]/g, '')) * 100) / 100;
  curItem.location = v('iLoc').trim(); curItem.notes = v('iNotes'); curItem.image = v('iImg').trim();
}
function renderItem() {
  const it = curItem; const m = it.market;
  $('#itemTitle').textContent = itemIsNew ? 'New item' : it.name || 'Item';
  const mp = mPrice(m);
  const subs = m && m.prices ? Object.keys(m.prices) : [];
  $('#itemBody').innerHTML = `${it._note ? `<div class="note warn small" style="margin-bottom:10px">${esc(it._note)}</div>` : ''}
    <div class="itemtop">${thumb(it.image || (m && m.image), 'lg')}<div style="flex:1;min-width:0">
      <div><label>Name</label><input id="iName" value="${esc(it.name)}" placeholder="Prismatic Evolutions Elite Trainer Box"></div>
      <div class="cols3 tight" style="margin-top:8px"><div><label>In stock</label><div class="qtybox"><button class="sm" data-iq="-1">−</button><input id="iQty" inputmode="numeric" value="${esc(it.qty)}"><button class="sm" data-iq="1">＋</button></div></div>
      <div><label>Cost each ($)</label><input id="iCost" inputmode="decimal" value="${it.cost ?? ''}" placeholder="what you paid"></div>
      <div><label>Your value each ($)</label><input id="iValue" inputmode="decimal" value="${it.value ?? ''}" placeholder="${mp != null ? 'using TCGplayer' : 'optional'}"></div></div></div></div>
    <div class="cols2 tight" style="margin-top:10px"><div><label>Barcode (UPC)</label><div class="hstack" style="gap:6px"><input id="iUpc" inputmode="numeric" value="${esc(it.upc)}" placeholder="scan or type" style="flex:1;min-width:0"><button id="iUpcScan" title="Scan the barcode" aria-label="Scan the barcode">📷</button></div></div>
      <div><label>Location</label><input id="iLoc" value="${esc(it.location)}" placeholder="Shelf, bin, house…"></div></div>
    <div style="margin-top:10px"><label>Picture link</label><input id="iImg" value="${esc(it.image)}" placeholder="https://…"></div>
    <div style="margin-top:10px"><label>Notes</label><textarea id="iNotes" style="min-height:48px">${esc(it.notes)}</textarea></div>
    <div class="section">Market price (TCGplayer)</div>
    ${m && m.id ? `<div class="card mcard"><div class="hstack" style="align-items:flex-start;gap:12px">${thumb(m.image, 'sm')}<div style="flex:1;min-width:0"><div class="t2">${esc(m.name)}</div><div class="small muted">${esc(m.setName || '')}${m.at ? ' · updated ' + esc(ago(m.at)) : ''}</div>
        ${subs.length > 1 ? `<select id="iSub" style="width:auto;margin-top:6px">${subs.map(s => `<option ${s === (m.sub || subs[0]) ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>` : ''}</div>
        <div class="dright"><div class="mprice">${fmtMoney(mp)}</div><div class="small faint">market each</div>${(() => { const p = (m.prices || {})[m.sub] || (m.prices || {}).Normal || Object.values(m.prices || {})[0] || {}; return `<div class="small faint">low ${fmtMoney(p.low)} · mid ${fmtMoney(p.mid)}</div>`; })()}</div></div>
        ${priceChart(m.history)}
        <div class="hstack" style="margin-top:8px;flex-wrap:wrap">${m.url ? `<a class="small" href="${esc(m.url)}" target="_blank" rel="noopener">Open on TCGplayer ↗</a>` : ''}<span class="spacer"></span><button class="ghost sm" id="iUnlink">Unlink</button><button class="sm" id="iRelink">Change</button></div></div>` : ''}
    <div id="iMarket" ${m && m.id && !mSearch.open ? 'hidden' : ''}>
      <div class="small muted" style="margin-bottom:6px">Link this item to its TCGplayer product to track the market price and its history every day.</div>
      <div class="hstack" style="flex-wrap:wrap;gap:6px"><select id="mCat" style="width:auto;max-width:180px"><option value="">Loading games…</option></select><input id="mQ" value="${esc(mSearch.q)}" placeholder="Search: prismatic etb, 151 booster bundle…" style="flex:1;min-width:180px"><button id="mGo">Search</button></div>
      <label class="check small" style="margin-top:6px"><input type="checkbox" id="mSealed" ${mSearch.sealed ? 'checked' : ''}> Sealed products only</label>
      <div id="mRes" style="margin-top:8px">${mSearch.busy ? '<div class="small muted">Searching TCGplayer…</div>' : mSearch.err ? `<div class="err">${esc(mSearch.err)}</div>` : mSearch.results ? (mSearch.results.length ? `<div class="list mres">${mSearch.results.map((r, i) => { const p = r.prices.Normal || Object.values(r.prices)[0] || {}; return `<div class="li click dli" data-mpick="${i}">${thumb(r.image, 'sm')}<div class="mmain"><div class="t2">${esc(r.name)}</div><div class="small muted ellipsis">${esc(r.setName)}</div></div><div class="dright"><b>${fmtMoney(p.market ?? p.mid ?? p.low)}</b><div class="small faint">market</div></div></div>`; }).join('')}</div>` : '<div class="small muted">Nothing found. Try fewer words, or untick “Sealed products only”.</div>') : ''}</div>
    </div>
    ${!itemIsNew && (it.sources || []).length ? `<div class="section">From orders</div><div class="small muted">${(it.sources || []).slice(-6).reverse().map(s => { const o = state.orders.find(x => x.id === s.orderId); return o ? `<a href="#" data-iorder="${o.id}">${esc(Parser.storeInfo(o.store).label)} #${esc(o.orderNumber || '—')}</a> (${s.qty})` : ''; }).filter(Boolean).join(' · ')}</div>` : ''}`;
  $('#itemDelete').hidden = itemIsNew; $('#itemSell').hidden = itemIsNew || typeof openSale !== 'function';
  $$('#itemBody [data-iq]').forEach(b => b.onclick = () => { readItemForm(); curItem.qty = Math.max(0, (Number(curItem.qty) || 0) + Number(b.dataset.iq)); $('#iQty').value = curItem.qty; });
  $('#iUpcScan').onclick = () => { readItemForm(); Scan.open({ title: 'Scan the product barcode', single: true, onCode: c => { curItem.upc = String(c).replace(/\D/g, ''); renderItem(); return { ok: true, msg: 'Got it', close: true }; } }); };
  if ($('#iUnlink')) $('#iUnlink').onclick = () => { readItemForm(); curItem.market = null; mSearch.open = true; renderItem(); };
  if ($('#iRelink')) $('#iRelink').onclick = () => { readItemForm(); mSearch.open = true; renderItem(); };
  if ($('#iSub')) $('#iSub').onchange = e => { readItemForm(); curItem.market.sub = e.target.value; renderItem(); };
  $$('#itemBody [data-iorder]').forEach(a => a.onclick = e => { e.preventDefault(); closeDlg('dlgItem'); openOrder(a.dataset.iorder); });
  // market search
  const mcat = $('#mCat');
  if (mcat) {
    loadCats().then(cats => { if (!$('#mCat')) return; if (!mSearch.cat) mSearch.cat = String((cats[0] || {}).id || ''); $('#mCat').innerHTML = cats.map(c => `<option value="${c.id}" ${String(c.id) === String(mSearch.cat) ? 'selected' : ''}>${esc(c.name)}</option>`).join(''); })
      .catch(e => { if ($('#mCat')) $('#mCat').innerHTML = '<option value="">Unavailable</option>'; mSearch.err = e.message; if ($('#mRes')) $('#mRes').innerHTML = `<div class="err">${esc(e.message)}</div>`; });
    mcat.onchange = e => { mSearch.cat = e.target.value; };
    const go = async () => {
      readItemForm(); mSearch.q = $('#mQ').value.trim(); mSearch.sealed = $('#mSealed').checked; mSearch.cat = $('#mCat').value || mSearch.cat;
      if (!mSearch.q) return; mSearch.busy = true; mSearch.err = ''; mSearch.open = true; renderItem();
      try { const r = await api('/api/market/search', { cat: mSearch.cat, q: mSearch.q, sealed: mSearch.sealed }); mSearch.results = r.results; }
      catch (e) { mSearch.err = e.message; mSearch.results = null; }
      mSearch.busy = false; if ($('#dlgItem').open) renderItem();
    };
    $('#mGo').onclick = go; $('#mQ').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
    $$('#itemBody [data-mpick]').forEach(el => el.onclick = () => {
      readItemForm(); const r = mSearch.results[+el.dataset.mpick];
      const subs = Object.keys(r.prices || {});
      curItem.market = { src: 'tcgplayer', id: r.id, cat: r.cat, group: r.group, name: r.name, setName: r.setName, image: r.image, url: r.url, prices: r.prices, sub: subs.includes('Normal') ? 'Normal' : subs[0] || '', at: Date.now(), history: [] };
      const v = mPrice(curItem.market); if (v != null) curItem.market.history.push([todayKey(), v]);
      if (!curItem.name) curItem.name = r.name; if (!curItem.image) curItem.image = r.image;
      mSearch.open = false; mSearch.results = null; renderItem();
    });
  }
}
function wireItemDlg() {
  $('#itemSave').onclick = () => {
    readItemForm(); if (!curItem.name) { toast('Give the item a name'); return; }
    const clean = Object.assign({}, curItem); delete clean._note; clean.updatedAt = Date.now();
    const i = state.inventory.findIndex(x => x.id === clean.id);
    if (i >= 0) state.inventory[i] = clean; else state.inventory.push(clean);
    save(); closeDlg('dlgItem'); refresh(); toast(itemIsNew ? 'Added to inventory' : 'Saved');
  };
  $('#itemDelete').onclick = async () => { if (!await ask(`Delete “${curItem.name}” from your inventory?`)) return; snapshot('delete item'); state.inventory = state.inventory.filter(x => x.id !== curItem.id); save(); closeDlg('dlgItem'); refresh(); toast('Deleted', { undo: true }); };
  $('#itemSell').onclick = () => { readItemForm(); const id = curItem.id; closeDlg('dlgItem'); openSale([id]); };
}

/* ---------- inventory page ---------- */
PAGES.inventory = {
  render() {
    const pg = $('#pg-inventory'); const all = state.inventory || [];
    let list = all.slice(); const q = INV.q.trim().toLowerCase();
    if (INV.show === 'stock') list = list.filter(i => (Number(i.qty) || 0) > 0);
    else if (INV.show === 'out') list = list.filter(i => !(Number(i.qty) > 0));
    if (q) list = list.filter(i => [i.name, i.upc, i.location, i.notes, i.market && i.market.name, i.market && i.market.setName].some(v => String(v || '').toLowerCase().includes(q)));
    const S = { value: (a, b) => (itemValue(b) || 0) - (itemValue(a) || 0), qty: (a, b) => (b.qty || 0) - (a.qty || 0), gain: (a, b) => ((itemValue(b) || 0) - (itemCost(b) || 0)) - ((itemValue(a) || 0) - (itemCost(a) || 0)), az: (a, b) => a.name.localeCompare(b.name), recent: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) };
    list.sort(S[INV.sort] || S.value);
    const st = invStats(all.filter(i => (Number(i.qty) || 0) > 0));
    const fromOrders = state.orders.filter(o => o.status === 'delivered' && !o.invAdded && orderInvLines(o).length).length;
    const linked = all.filter(i => i.market && i.market.id).length;
    pg.innerHTML = `<div class="pagehead"><h1>Inventory</h1><span class="sub">${plural(all.length, 'item')}${linked ? ` · ${linked} with live TCGplayer prices${state.settings.pricesAt ? ' (updated ' + esc(ago(state.settings.pricesAt)) + ')' : ''}` : ''}</span><div class="spacer"></div>
        <button class="primary" id="invScan">📷 Scan</button><button id="invAdd">Add item</button>${fromOrders ? `<button id="invOrders">Add from orders <span class="badge">${fromOrders}</span></button>` : ''}${linked ? `<button class="ghost" id="invPrices">Refresh prices</button>` : ''}</div>
      <div class="kpis">
        <div class="kpi"><div class="l">Units in stock</div><div class="v">${st.units}</div><div class="d">${plural(all.filter(i => (Number(i.qty) || 0) > 0).length, 'product')}</div></div>
        <div class="kpi"><div class="l">Cost</div><div class="v">${fmtMoney(st.cost, true)}</div><div class="d">what you paid</div></div>
        <div class="kpi"><div class="l">Market value</div><div class="v">${fmtMoney(st.value, true)}</div><div class="d">${st.priced ? plural(st.priced, 'product') + ' priced' : 'link items to TCGplayer'}</div></div>
        <div class="kpi"><div class="l">Unrealized gain</div><div class="v ${st.gain >= 0 ? 'pos' : 'neg'}">${st.priced ? (st.gain >= 0 ? '+' : '−') + fmtMoney(Math.abs(st.gain), true) : '—'}</div><div class="d">on priced items</div></div>
      </div>
      <div class="toolbar"><input class="search" data-search id="invQ" placeholder="Search name, barcode, location…  ( / )" value="${esc(INV.q)}">
        <div class="chips" id="invShow">${[['stock', 'In stock'], ['out', 'Sold out'], ['all', 'All']].map(([k, l]) => `<button class="chip ${INV.show === k ? 'on' : ''}" data-is="${k}">${l}</button>`).join('')}</div>
        <select id="invSort" style="width:auto">${[['value', 'Most value'], ['gain', 'Biggest gain'], ['qty', 'Most units'], ['recent', 'Recently changed'], ['az', 'A–Z']].map(([k, l]) => `<option value="${k}" ${INV.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      ${list.length ? `<div class="list invlist">${list.map(i => { const uv = unitValue(i), v = itemValue(i), c = itemCost(i); const g = v != null && c != null ? v - c : null; return `<div class="li click dli inv" data-item="${i.id}">${thumb(i.image || (i.market && i.market.image), 'sm')}
          <div class="mmain"><div class="t2">${esc(i.name || 'Untitled')}</div><div class="small muted ellipsis">${i.cost != null ? 'cost ' + fmtMoney(i.cost) + ' · ' : ''}${uv != null ? (i.market && mPrice(i.market) != null ? 'market ' : 'value ') + fmtMoney(uv) : 'no price'}${i.location ? ' · ' + esc(i.location) : ''}</div></div>
          ${i.market ? sparkline(i.market.history, 64, 24) : ''}
          <div class="dright"><div class="qtyb">×${esc(i.qty || 0)}</div>${v != null ? `<div class="small">${fmtMoney(v)}</div>` : ''}${g != null ? `<div class="small ${g >= 0 ? 'pos' : 'neg'}">${g >= 0 ? '+' : '−'}${fmtMoney(Math.abs(g))}</div>` : ''}</div></div>`; }).join('')}</div>`
        : `<div class="empty">${all.length ? 'Nothing matches.' : 'No inventory yet. Tap <b>Scan</b> to scan product barcodes, <b>Add item</b> to type one in, or add the items from your delivered orders.'}</div>`}`;
    $('#invScan').onclick = openInvScanner;
    $('#invAdd').onclick = () => openItem(null);
    if ($('#invOrders')) $('#invOrders').onclick = openFromOrders;
    if ($('#invPrices')) $('#invPrices').onclick = () => refreshPrices(true);
    $('#invQ').oninput = debounce(e => { INV.q = e.target.value; PAGES.inventory.render(); const i = $('#invQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 160);
    $('#invShow').onclick = e => { const b = e.target.closest('[data-is]'); if (b) { INV.show = b.dataset.is; PAGES.inventory.render(); } };
    $('#invSort').onchange = e => { INV.sort = e.target.value; PAGES.inventory.render(); };
    pg.querySelectorAll('[data-item]').forEach(el => el.onclick = () => openItem(el.dataset.item));
    refreshPrices(false, true);
  },
};

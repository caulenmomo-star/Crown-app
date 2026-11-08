/* Kingpin - SKU lists. Saved lists of product SKUs (Target TCINs, Walmart item numbers, Best Buy SKUs, product links
   or barcodes) to paste into checkout bots. Each SKU is looked up on the store's own product page for its name and
   picture; its price comes from that page when it shows one, from what you paid in your orders, or from you. The
   TCGplayer value shows too when it's a trading-card product. */
'use strict';
const SK = { list: '', q: '', busy: 0, view: 'lists' };
const SKU_STORES = ['Target', 'Walmart', 'Best Buy', 'Pokémon Center', 'GameStop', 'Costco', "Sam's Club", 'Amazon', 'Other'];
const skuListById = id => (state.skuLists || []).find(l => l.id === id);
function newSkuList(name, store) { return { id: uid(), name: String(name || '').trim() || 'SKU list', store: store || 'Target', notes: '', items: [], createdAt: Date.now(), updatedAt: Date.now() }; }
const skuTouch = l => { l.updatedAt = Date.now(); };
// the SKU part of whatever was typed: a Target link becomes its TCIN, a Walmart link its item number, a Best Buy link its SKU
function skuFromText(t) {
  t = String(t || '').trim(); if (!t) return null;
  const url = (t.match(/https?:\/\/\S+/) || [])[0] || '';
  if (url) {
    const tg = url.match(/target\.com\/.*?\/A-(\d{6,12})/i); if (tg) return { sku: tg[1], url, store: 'Target' };
    const wm = url.match(/walmart\.com\/ip\/(?:[^/?#]+\/)?(\d{5,14})/i); if (wm) return { sku: wm[1], url, store: 'Walmart' };
    const bb = url.match(/bestbuy\.com\/.*?(?:skuId=|\/)(\d{7})(?:\.p|\b)/i); if (bb) return { sku: bb[1], url, store: 'Best Buy' };
    const pc = url.match(/pokemoncenter\.com\/product\/([\w-]+)/i); if (pc) return { sku: pc[1].toUpperCase(), url, store: 'Pokémon Center' };
    return { sku: url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 80), url, store: '' };
  }
  const s = t.replace(/^#/, '').trim();
  if (/^\d{3}-\d{2}-\d{4}$/.test(s)) return { sku: s, url: '', store: 'Target', dpci: true }; // Target DPCI
  if (!/^[\w.\-]{3,40}$/.test(s)) return null;
  return { sku: s.toUpperCase(), url: '', store: '' };
}
// split a pasted pile into SKUs: one per line, or separated by commas / spaces
function parseSkuText(text) {
  const out = [], seen = new Set();
  for (const line of String(text || '').split(/\r?\n/)) {
    const parts = /https?:\/\//.test(line) ? line.split(/\s+/) : line.split(/[,;\s\t]+/);
    for (const p of parts) { const x = skuFromText(p); if (x && !seen.has(x.sku)) { seen.add(x.sku); out.push(x); } }
  }
  return out;
}
// what you paid for this product in your own orders (matched by Target's product picture, then by name)
function skuPaid(it) {
  const pic = String(it.image || '').match(/GUEST_[\w-]+/), k = ivKey(it.name || '');
  let best = null;
  for (const o of state.orders) {
    if (isDead(o)) continue;
    for (const i of o.items || []) {
      const hit = (pic && String(i.image || '').includes(pic[0])) || (k && k.length > 8 && ivKey(i.name) === k);
      if (!hit || !(Number(i.price) > 0)) continue;
      if (!best || String(o.orderDate) > String(best.date)) best = { price: Number(i.price), date: o.orderDate, n: 0 };
    }
  }
  if (best) best.n = state.orders.filter(o => !isDead(o) && (o.items || []).some(i => (pic && String(i.image || '').includes(pic[0])) || (k && k.length > 8 && ivKey(i.name) === k))).length;
  return best;
}
// the price to show: what you typed > the store page > what you last paid
function skuPrice(it) {
  if (it.myPrice != null && it.myPrice !== '') return { v: Number(it.myPrice), from: 'you' };
  if (it.price != null) return { v: Number(it.price), from: it.priceFrom || 'store' };
  const p = skuPaid(it); if (p) return { v: p.price, from: 'paid', date: p.date };
  return null;
}
function skuMarket(it) {
  if (!it.name || typeof linkFor !== 'function') return null;
  const l = linkFor(it.name); const v = l ? ivPrice(l) : null; return v == null ? null : { v, l };
}
async function skuLookup(list, it, force) {
  if (!SERVER) return;
  if (!force && it.lookedAt && Date.now() - it.lookedAt < 3 * 864e5 && it.name) return;
  SK.busy++; it.looking = true; skuRefresh();
  try {
    const r = await api('/api/skuinfo', { sku: it.url || it.sku, store: it.store || list.store });
    if (!cryptoKey) return;
    if (r.found) {
      if (!it.nameByYou) it.name = r.name || it.name;
      it.image = r.image || it.image; it.price = r.price != null ? r.price : null; it.priceFrom = r.priceFrom || '';
      if (r.url) it.link = r.url; delete it.lookErr;
    } else it.lookErr = r.why || 'Couldn’t find this product.';
    it.lookedAt = Date.now();
    // trading-card products: find the TCGplayer value too (in the background)
    if (it.name && typeof matchItem === 'function' && !linkFor(it.name)) matchItem(it.name).then(() => { save(); skuRefresh(); }).catch(() => {});
  } catch (e) { it.lookErr = e.message; it.lookedAt = Date.now(); }
  finally { delete it.looking; SK.busy--; skuTouch(list); save(); skuRefresh(); }
}
async function skuLookupAll(list, force) {
  const todo = list.items.filter(it => force || !it.lookedAt);
  for (let i = 0; i < todo.length; i += 3) await Promise.all(todo.slice(i, i + 3).map(it => skuLookup(list, it, force)));
}
let skuRT = 0; function skuRefresh() { clearTimeout(skuRT); skuRT = setTimeout(() => { if (route.page === 'skus' && cryptoKey) PAGES.skus.render(); }, 120); }
const skuStoreLink = (it, list) => it.link || it.url || ((it.store || list.store) === 'Target' && /^\d{6,12}$/.test(it.sku) ? 'https://www.target.com/p/-/A-' + it.sku : '');
// text for the bot: one per line, or comma separated
const skuExport = (l, how) => l.items.map(i => i.sku).join(how === 'comma' ? ',' : '\n');

PAGES.skus = {
  render() {
    const pg = $('#pg-skus'); const L = state.skuLists || (state.skuLists = []);
    if (!skuListById(SK.list)) SK.list = (L[0] || {}).id || '';
    const l = skuListById(SK.list);
    const side = L.map(x => `<div class="cat ${x.id === SK.list ? 'active' : ''}" data-skl="${x.id}"><span class="ellipsis">${esc(x.name)}</span><span class="n">${x.items.length}</span></div>`).join('');
    const q = SK.q.trim().toLowerCase();
    const items = l ? l.items.filter(i => !q || [i.sku, i.name, i.notes].some(v => String(v || '').toLowerCase().includes(q))) : [];
    const total = l ? l.items.reduce((s, i) => { const p = skuPrice(i); return s + (p ? p.v * (Number(i.qty) || 1) : 0); }, 0) : 0;
    const seg = `<div class="seg" id="skView"><button data-skv="lists" class="${SK.view === 'lists' ? 'on' : ''}">My lists</button><button data-skv="products" class="${SK.view === 'products' ? 'on' : ''}">Pokémon products</button></div>`;
    if (SK.view === 'products') {
      pg.innerHTML = `<div class="pagehead"><h1>SKU lists</h1><span class="sub">Pokémon drops on Target, with their TCINs</span><div class="spacer"></div>${seg}</div>${pkCatalogHtml(l)}`;
      $('#skView').onclick = e => { const b = e.target.closest('[data-skv]'); if (b) { SK.view = b.dataset.skv; PAGES.skus.render(); } };
      wirePkCatalog(pg, l); return;
    }
    pg.innerHTML = `<div class="pagehead"><h1>SKU lists</h1><span class="sub">${plural(L.length, 'list')} · ${plural(L.reduce((s, x) => s + x.items.length, 0), 'SKU')}</span><div class="spacer"></div>${seg}<button class="primary" id="sklNew">+ New list</button></div>
      ${L.length ? `<div class="split"><div class="catlist">${side}<button id="sklNew3" class="ghost" style="width:100%;margin-top:6px;text-align:left">+ New list</button></div><div style="min-width:0">
        <div class="card"><div class="hstack" style="flex-wrap:wrap;gap:8px"><h3 style="margin:0;flex:1;min-width:160px" class="ellipsis">${esc(l.name)}</h3>
          <select id="sklStore" style="width:auto" aria-label="Store">${SKU_STORES.map(s => `<option ${s === l.store ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
          <button class="sm ghost" id="sklRen">Rename</button><button class="sm ghost" id="sklDup">Duplicate</button><button class="sm ghost danger" id="sklDel">Delete</button></div>
          <textarea id="sklAdd" rows="3" placeholder="Paste SKUs or product links — one per line, or separated by commas. ${l.store === 'Target' ? 'Target: the TCIN (the number after A- in the link) or the whole link.' : 'A product link works best — Kingpin reads the product from it.'}" style="margin-top:10px"></textarea>
          <div class="hstack" style="margin-top:8px;flex-wrap:wrap;gap:8px"><button class="primary" id="sklAddBtn">Add SKUs</button><span class="small faint">Each one is looked up for its name, picture and price.</span><span class="spacer"></span><button class="sm ghost" id="sklBrowse">Browse Pokémon products</button></div></div>
        ${pkSuggestHtml(l)}
        ${l.items.length ? `<div class="card"><div class="hstack" style="flex-wrap:wrap;gap:8px;margin-bottom:10px"><b>For your bot</b><span class="small faint">${plural(l.items.length, 'SKU')}${total ? ' · about ' + fmtMoney(total) + ' for everything' : ''}</span><span class="spacer"></span>
            <button class="sm" id="sklCopyLines">Copy, one per line</button><button class="sm" id="sklCopyComma">Copy, comma separated</button><button class="sm ghost" id="sklCsv">Download CSV</button></div>
          <textarea readonly id="sklOut" rows="${Math.min(6, Math.max(2, l.items.length))}" class="mono" style="font-size:12px">${esc(skuExport(l))}</textarea></div>
          <div class="toolbar"><input class="search" data-search id="sklQ" placeholder="Search this list…" value="${esc(SK.q)}"><span class="spacer"></span>${SERVER ? `<button class="sm ghost" id="sklLook" ${SK.busy ? 'disabled' : ''}>${SK.busy ? 'Looking up…' : '↻ Look up again'}</button>` : ''}</div>
          <div class="tablewrap"><table class="tbl skutbl"><thead><tr><th>Product</th><th>SKU</th><th class="num">Price</th><th class="num">Value</th><th class="num">Qty</th><th></th></tr></thead><tbody>
          ${items.map(i => { const p = skuPrice(i), m = skuMarket(i), link = skuStoreLink(i, l), paid = skuPaid(i);
            return `<tr data-ski="${i.id}"><td><div class="hstack" style="gap:10px;min-width:0">${thumb(i.image)}<div style="min-width:0"><div class="ellipsis skuname">${i.looking ? '<span class="faint">Looking up…</span>' : i.name ? esc(i.name) : `<span class="faint">${esc(i.lookErr || (SERVER ? 'Not looked up yet' : 'Type a name'))}</span>`}</div>
                <div class="small faint ellipsis">${[i.store && i.store !== l.store ? i.store : '', paid ? `bought ${paid.n === 1 ? 'once' : paid.n + ' times'}` : '', i.notes].filter(Boolean).map(esc).join(' · ')}${link ? ` <a href="${esc(link)}" target="_blank" rel="noopener">${esc(i.store || l.store)} ↗</a>` : ''}</div></div></div></td>
              <td class="mono">${esc(i.sku)} <button class="ghost sm icopy" data-skcopy="${esc(i.sku)}" title="Copy SKU" aria-label="Copy SKU">⧉</button></td>
              <td class="num">${p ? `<b>${fmtMoney(p.v)}</b><div class="small faint">${p.from === 'you' ? 'you typed' : p.from === 'paid' ? 'you paid' + (p.date ? ' ' + esc(fmtDate(p.date)) : '') : esc(p.from)}</div>` : '<span class="faint">—</span>'}</td>
              <td class="num">${m ? `<b>${fmtMoney(m.v)}</b><div class="small faint">TCGplayer</div>` : '<span class="faint">—</span>'}</td>
              <td class="num"><input class="skqty" data-skqty="${i.id}" type="number" min="1" max="99" value="${Number(i.qty) || 1}" inputmode="numeric" aria-label="Quantity"></td>
              <td class="num" style="white-space:nowrap"><button class="sm ghost" data-skedit="${i.id}">Edit</button><button class="sm ghost" data-skdel="${i.id}" aria-label="Remove">✕</button></td></tr>`; }).join('')}
          </tbody></table></div>
          <div class="skucards">${items.map(i => { const p = skuPrice(i), m = skuMarket(i), link = skuStoreLink(i, l), paid = skuPaid(i);
            return `<details class="skucard" data-ski="${i.id}"><summary>${thumb(i.image)}<div class="scmain"><div class="scname">${i.looking ? '<span class="faint">Looking up…</span>' : i.name ? esc(typeof pkShort === 'function' ? pkShort(i.name) : i.name) : `<span class="faint">${esc(i.lookErr || 'Not looked up yet')}</span>`}</div>
                <div class="small muted"><span class="mono">${esc(i.sku)}</span>${p ? ' · <b>' + fmtMoney(p.v) + '</b>' : ''}${(Number(i.qty) || 1) > 1 ? ' · ×' + (Number(i.qty) || 1) : ''}</div></div>
                <button class="ghost sm icopy" data-skcopy="${esc(i.sku)}" title="Copy SKU" aria-label="Copy SKU">⧉</button><span class="scchev" aria-hidden="true">▾</span></summary>
              <div class="scmore">
                <div class="scrow"><span class="muted">Price</span><span>${p ? `<b>${fmtMoney(p.v)}</b> <span class="small faint">${p.from === 'you' ? 'you typed' : p.from === 'paid' ? 'you paid' + (p.date ? ' ' + esc(fmtDate(p.date)) : '') : esc(p.from)}</span>` : '<span class="faint">—</span>'}</span></div>
                <div class="scrow"><span class="muted">Value</span><span>${m ? `<b>${fmtMoney(m.v)}</b> <span class="small faint">TCGplayer</span>` : '<span class="faint">—</span>'}</span></div>
                ${paid || i.notes ? `<div class="scrow"><span class="muted">Notes</span><span class="small">${[paid ? `bought ${paid.n === 1 ? 'once' : paid.n + ' times'}` : '', i.notes].filter(Boolean).map(esc).join(' · ')}</span></div>` : ''}
                <div class="scrow"><span class="muted">Quantity</span><input class="skqty" data-skqty="${i.id}" type="number" min="1" max="99" value="${Number(i.qty) || 1}" inputmode="numeric" aria-label="Quantity"></div>
                <div class="hstack" style="gap:8px;margin-top:8px">${link ? `<a class="btn" href="${esc(link)}" target="_blank" rel="noopener">${esc(i.store || l.store)} ↗</a>` : ''}<span class="spacer"></span><button class="sm" data-skedit="${i.id}">Edit</button><button class="sm danger" data-skdel="${i.id}">Remove</button></div>
              </div></details>`; }).join('')}</div>${!items.length ? '<div class="empty">No SKUs match.</div>' : ''}` : `<div class="empty">No SKUs in this list yet. Paste some above.</div>`}
      </div></div>` : `<div class="empty">Save the SKUs you run in your bots, grouped into lists like “Pokémon restock” or “Target drops”. Paste a pile of SKUs or product links and Kingpin shows what each product is and what it costs. <div style="margin-top:12px"><button class="primary" id="sklNew2">Make your first list</button></div></div>`}`;
    const mk = async () => { const n = await askText('New SKU list', '', { placeholder: 'Pokémon restock, Target drops…', ok: 'Make list' }); if (!n || !n.trim()) return; const x = newSkuList(n, l ? l.store : 'Target'); state.skuLists.push(x); SK.list = x.id; save(); PAGES.skus.render(); setTimeout(() => $('#sklAdd') && $('#sklAdd').focus(), 50); };
    $('#sklNew').onclick = mk; if ($('#sklNew2')) $('#sklNew2').onclick = mk; if ($('#sklNew3')) $('#sklNew3').onclick = mk;
    pg.querySelectorAll('[data-skl]').forEach(b => b.onclick = () => { SK.list = b.dataset.skl; SK.q = ''; PAGES.skus.render(); });
    $('#skView').onclick = e => { const b = e.target.closest('[data-skv]'); if (b) { SK.view = b.dataset.skv; PAGES.skus.render(); } };
    if (!l) return;
    $('#sklBrowse').onclick = () => { SK.view = 'products'; PAGES.skus.render(); };
    wirePkSuggest(pg, l);
    $('#sklStore').onchange = e => { l.store = e.target.value; skuTouch(l); save(); PAGES.skus.render(); };
    $('#sklRen').onclick = async () => { const n = await askText('Rename list', l.name); if (n && n.trim()) { l.name = n.trim(); skuTouch(l); save(); PAGES.skus.render(); } };
    $('#sklDup').onclick = () => { const x = JSON.parse(JSON.stringify(l)); x.id = uid(); x.name = l.name + ' copy'; x.items.forEach(i => i.id = uid()); x.createdAt = x.updatedAt = Date.now(); state.skuLists.push(x); SK.list = x.id; save(); PAGES.skus.render(); toast('List copied'); };
    $('#sklDel').onclick = async () => { if (!await ask(`Delete the list “${l.name}”${l.items.length ? ` and its ${plural(l.items.length, 'SKU')}` : ''}?`, { ok: 'Delete', danger: true })) return; snapshot('delete SKU list'); state.skuLists = state.skuLists.filter(x => x.id !== l.id); SK.list = ''; save(); PAGES.skus.render(); toast('List deleted', { undo: true }); };
    $('#sklAddBtn').onclick = () => {
      const got = parseSkuText($('#sklAdd').value); if (!got.length) { toast('No SKUs found — paste numbers or product links'); return; }
      const have = new Set(l.items.map(i => i.sku)); const fresh = got.filter(g => !have.has(g.sku));
      fresh.forEach(g => l.items.push({ id: uid(), sku: g.sku, url: g.url || '', store: g.store && g.store !== l.store ? g.store : '', qty: 1, name: '', notes: '', addedAt: Date.now() }));
      skuTouch(l); save(); $('#sklAdd').value = '';
      toast(fresh.length ? `Added ${plural(fresh.length, 'SKU')}${got.length > fresh.length ? ` · ${got.length - fresh.length} already in the list` : ''}` : 'Those SKUs are already in the list');
      PAGES.skus.render(); skuLookupAll(l);
    };
    $('#sklAdd').onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#sklAddBtn').click(); };
    if (!l.items.length) return;
    $('#sklCopyLines').onclick = () => copyText(skuExport(l), 'SKUs');
    $('#sklCopyComma').onclick = () => copyText(skuExport(l, 'comma'), 'SKUs');
    $('#sklCsv').onclick = () => download(`kingpin-skus-${l.name.replace(/[^\w-]+/g, '-').toLowerCase()}.csv`, toCSV(['sku', 'name', 'qty', 'price', 'store', 'link', 'notes'], l.items.map(i => { const p = skuPrice(i); return { sku: i.sku, name: i.name, qty: Number(i.qty) || 1, price: p ? p.v.toFixed(2) : '', store: i.store || l.store, link: skuStoreLink(i, l), notes: i.notes }; })), 'text/csv');
    $('#sklQ').oninput = debounce(e => { SK.q = e.target.value; PAGES.skus.render(); const q = $('#sklQ'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 200);
    if ($('#sklLook')) $('#sklLook').onclick = () => skuLookupAll(l, true);
    const tb = pg.querySelector('.skutbl'), cards = pg.querySelector('.skucards');
    tb.onchange = e => { const q = e.target.closest('[data-skqty]'); if (!q) return; const it = l.items.find(i => i.id === q.dataset.skqty); it.qty = Math.max(1, Math.min(99, parseInt(q.value, 10) || 1)); skuTouch(l); save(); };
    tb.onclick = async e => {
      const cp = e.target.closest('[data-skcopy]'); if (cp) { copyText(cp.dataset.skcopy, 'SKU'); return; }
      const del = e.target.closest('[data-skdel]'); if (del) { snapshot('remove SKU'); l.items = l.items.filter(i => i.id !== del.dataset.skdel); skuTouch(l); save(); PAGES.skus.render(); toast('SKU removed', { undo: true }); return; }
      const ed = e.target.closest('[data-skedit]'); if (ed) openSkuEdit(l, l.items.find(i => i.id === ed.dataset.skedit));
    };
    // phones: the same buttons, in the tap-to-open rows (copying doesn't open the row)
    if (cards) { cards.onchange = tb.onchange; cards.onclick = e => { if (e.target.closest('[data-skcopy]')) e.preventDefault(); return tb.onclick(e); }; }
  },
};
// edit one SKU: its name, your price, notes
function openSkuEdit(l, it) {
  if (!it) return;
  $('#dlgSkuBody').innerHTML = `<div class="fgrid"><div class="s2"><label>SKU</label><input id="skeSku" class="mono" value="${esc(it.sku)}" autocomplete="off"></div>
    <div class="s2"><label>Product name</label><input id="skeName" value="${esc(it.name || '')}" placeholder="Filled in by the lookup" autocomplete="off"></div>
    <div><label>Your price (optional)</label><input id="skePrice" inputmode="decimal" value="${it.myPrice != null && it.myPrice !== '' ? esc(String(it.myPrice)) : ''}" placeholder="${(() => { const p = skuPrice(Object.assign({}, it, { myPrice: null })); return p ? fmtMoney(p.v) : '$0.00'; })()}"></div>
    <div><label>Qty</label><input id="skeQty" type="number" min="1" max="99" value="${Number(it.qty) || 1}"></div>
    <div class="s2"><label>Notes</label><input id="skeNotes" value="${esc(it.notes || '')}" placeholder="Max price, which bot, drop time…" autocomplete="off"></div></div>
    ${it.lookErr ? `<div class="note warn small" style="margin-top:10px">${esc(it.lookErr)}</div>` : ''}`;
  $('#dlgSku').showModal();
  $('#skeSave').onclick = () => {
    const sku = $('#skeSku').value.trim(); if (!sku) { toast('The SKU can’t be empty'); return; }
    if (sku !== it.sku && l.items.some(i => i !== it && i.sku === sku)) { toast('That SKU is already in the list'); return; }
    const changed = sku !== it.sku; it.sku = sku; if (changed) { it.url = ''; it.link = ''; delete it.lookedAt; it.name = ''; it.image = ''; it.price = null; }
    const nm = $('#skeName').value.trim(); if (!changed && nm !== (it.name || '')) { it.name = nm; it.nameByYou = !!nm; }
    const pr = $('#skePrice').value.replace(/[^\d.]/g, ''); it.myPrice = pr ? Number(pr) : null;
    it.qty = Math.max(1, Math.min(99, parseInt($('#skeQty').value, 10) || 1)); it.notes = $('#skeNotes').value.trim();
    skuTouch(l); save(); $('#dlgSku').close(); PAGES.skus.render(); if (changed) skuLookup(l, it, true);
  };
}

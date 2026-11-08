/* Kingpin - what the things you order are worth. Each product you've ordered is matched once to its TCGplayer
   product (by name and product type - an ETB never matches a booster bundle) and priced at the TCGplayer median, so
   the Checkout card can show an estimated profit. Matches are remembered and can be fixed in "Review prices". */
'use strict';
const IV = { busy: false, queue: [], done: 0, total: 0, onUpdate: null, _ix: null, _ixLen: -1 };
const ivKey = n => String(n || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const IV_NOISE = new Set('pokemon tcg trading card cards game the and of with for new sealed english exclusive center scarlet violet sv official item items count ct a an in by from'.split(' '));
const IV_TYPES = [['elite trainer box', /elite trainer box|\betb\b/], ['booster bundle', /booster bundle/], ['booster box', /booster (box|display)/], ['booster pack', /sleeved booster|booster pack|\bbooster\b(?! (bundle|box|display))/],
  ['premium collection', /premium collection|ultra premium/], ['build & battle', /build (and|&) battle/], ['tin', /\btins?\b/], ['blister', /blister|checklane|3 ?pack|three pack/], ['collection', /collection|box set|gift box|\bbox\b/], ['binder', /binder|portfolio/]];
const ivType = n => { n = String(n || '').toLowerCase(); for (const [k, re] of IV_TYPES) if (re.test(n)) return k; return ''; };
const ivWords = n => ivKey(n).split(' ').filter(w => w && w.length > 1 && !IV_NOISE.has(w));
function ivIndex() {
  const L = state.itemLinks || [];
  if (IV._ix && IV._ixLen === L.length && IV._ixRef === L) return IV._ix;
  IV._ix = new Map(L.map(l => [l.id, l])); IV._ixLen = L.length; IV._ixRef = L; return IV._ix;
}
// the link for a product name: your Inventory link first (you set that one by hand), then the remembered match
function linkFor(name) {
  const k = ivKey(name); if (!k) return null;
  const inv = (state.inventory || []).find(i => i.market && i.market.id && (ivKey(i.name) === k || ivKey(i.market.name) === k));
  if (inv) return { id: k, pid: inv.market.id, cat: inv.market.cat, group: inv.market.group, pname: inv.market.name, set: inv.market.setName, image: inv.market.image, prices: inv.market.prices, sub: inv.market.sub, by: 'inventory' };
  return ivIndex().get(k) || null;
}
// The price an item is valued at: the lower of TCGplayer's market price (what it actually sold for recently) and its
// median listing (the middle asking price). Asking prices for hyped sets and pre-orders run well above real sales.
function sellCfg() { return { basis: 'low' }; }
function ivPrice(l, basis) {
  if (!l || l.none || !l.prices) return null; const p = l.prices[l.sub] || l.prices.Normal || Object.values(l.prices)[0] || {};
  const b = basis || 'low', m = p.market != null ? Number(p.market) : null, d = p.mid != null ? Number(p.mid) : null;
  const v = b === 'mid' ? (d ?? m ?? p.low) : b === 'market' ? (m ?? d ?? p.low) : (m != null && d != null ? Math.min(m, d) : (m ?? d ?? p.low));
  return v == null ? null : Number(v);
}
function putLink(rec) {
  state.itemLinks = state.itemLinks || [];
  const i = state.itemLinks.findIndex(l => l.id === rec.id); rec.updatedAt = Date.now();
  if (i >= 0) state.itemLinks[i] = Object.assign({}, state.itemLinks[i], rec); else state.itemLinks.push(rec);
  IV._ix = null;
}

/* ---------- matching one product ---------- */
async function ivCategory(name) {
  const n = String(name || '').toLowerCase(); let want;
  if (/one piece/.test(n)) want = /one piece/i; else if (/lorcana/.test(n)) want = /lorcana/i; else if (/yu-?gi-?oh/.test(n)) want = /yu-?gi-?oh/i;
  else if (/\bmagic\b|\bmtg\b/.test(n)) want = /^magic/i; else if (/pok[eé]mon/.test(n) && /japan/.test(n)) want = /pok[eé]mon japan/i;
  else if (/pok[eé]mon|\bpkmn\b/.test(n) || ivType(n)) want = /^pok[eé]mon$/i; else return null; // LEGO, consoles… aren't on TCGplayer
  const cats = await loadCats(); const c = cats.find(x => want.test(x.name)); return c ? c.id : null;
}
function ivScore(itemName, r) {
  const a = ivWords(itemName), b = new Set(ivWords(r.name + ' ' + (r.setName || '')));
  if (!a.length) return 0;
  const t = ivType(itemName), rt = ivType(r.name);
  if (t && rt !== t) return 0;
  if (!t && rt) return 0;
  return a.filter(w => b.has(w)).length / a.length;
}
/* ---------- StockX: prices for things that aren't trading cards (LEGO, consoles, sneakers, collectibles) ---------- */
const stockxReady = () => !!(SERVER && state.settings.stockx && (state.settings.stockx.refresh || state.settings.stockx.access));
async function sxCall(path, body) {
  const r = await api(path, Object.assign({ auth: state.settings.stockx }, body));
  if (r.auth) { state.settings.stockx = Object.assign({}, state.settings.stockx, r.auth); save(); }
  return r;
}
function stockxConnect() {
  const n = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
  try { localStorage.setItem('crown.sxstate', n); } catch (_) { }
  location.href = '/api/stockx/login?state=' + n;
}
// coming back from StockX sign-in: the tokens arrive in the link's #part; keep them until the vault is open
(function () {
  const m = location.hash.match(/^#stockx=([A-Za-z0-9_\-]+)/); if (!m) return;
  try { sessionStorage.setItem('crown.sxpending', m[1]); } catch (_) { }
  history.replaceState(null, '', location.pathname + '#settings');
})();
function takeStockxPending() {
  let raw = ''; try { raw = sessionStorage.getItem('crown.sxpending') || ''; sessionStorage.removeItem('crown.sxpending'); } catch (_) { }
  if (!raw) return;
  let p = null; try { p = JSON.parse(atob(raw.replace(/-/g, '+').replace(/_/g, '/'))); } catch (_) { }
  let want = ''; try { want = localStorage.getItem('crown.sxstate') || ''; localStorage.removeItem('crown.sxstate'); } catch (_) { }
  if (!p || p.error) { toast(p && p.error ? p.error : 'StockX sign-in didn’t finish — try again'); return; }
  if (!want || p.state !== want || !p.auth || !p.auth.access) { toast('StockX sign-in didn’t match this device — try again'); return; }
  state.settings.stockx = Object.assign({}, p.auth, { connectedAt: Date.now() });
  // give everything StockX can price another try now
  (state.itemLinks || []).forEach(l => { if (l.none && l.by === 'auto') l.tried = 0; });
  save(); toast('StockX connected — pricing LEGO, consoles, sneakers and more');
  if (route.page === 'settings') PAGES.settings.render();
}
function stockxDisconnect() { delete state.settings.stockx; save(); }
const sxScore = (name, r) => { const a = ivWords(name), b = new Set(ivWords(r.title + ' ' + r.brand + ' ' + (r.style || ''))); if (!a.length) return 0; return a.filter(w => b.has(w)).length / a.length; };
function sxLink(id, name, x, prices, by, score) {
  const p = prices[x.id] || {};
  return { id, name, none: false, src: 'stockx', pid: x.id, pname: x.title, set: x.brand || 'StockX', url: x.urlKey ? 'https://stockx.com/' + x.urlKey : '', image: '', prices: { StockX: { market: p.value ?? null, mid: p.ask ?? p.value ?? null, low: p.bid ?? null } }, sub: 'StockX', at: Date.now(), tried: Date.now(), by, score };
}
async function matchStockx(name) {
  const id = ivKey(name), q = ivWords(name).slice(0, 8).join(' ') || name;
  let r; try { r = await sxCall('/api/stockx/search', { q }); } catch (e) { return putLink({ id, name, none: true, why: 'StockX: ' + e.message, tried: Date.now(), by: 'auto' }); }
  let best = null; for (const x of r.results || []) { const sc = sxScore(name, x); if (sc >= 0.6 && (!best || sc > best.sc)) best = { sc, x }; }
  if (!best) return putLink({ id, name, none: true, why: 'No match on StockX', tried: Date.now(), by: 'auto' });
  let pr = {}; try { pr = (await sxCall('/api/stockx/prices', { ids: [best.x.id] })).prices || {}; } catch (_) { }
  return putLink(sxLink(id, name, best.x, pr, 'auto', Math.round(best.sc * 100) / 100));
}
async function matchItem(name) {
  const cat = await ivCategory(name); const id = ivKey(name);
  if (!cat) return stockxReady() ? matchStockx(name) : putLink({ id, name, none: true, why: 'Not a trading-card product — connect StockX in Settings to price it', tried: Date.now(), by: 'auto' });
  const words = ivWords(name), type = ivType(name), typeWords = type ? type.split(/\W+/).filter(w => w.length > 1) : [];
  const core = words.filter(w => !typeWords.includes(w));
  const tries = [words, typeWords.concat(core.slice().sort((x, y) => y.length - x.length).slice(0, 2)), core.slice().sort((x, y) => y.length - x.length).slice(0, 2)]
    .map(t => Array.from(new Set(t)).join(' ')).filter((q, i, arr) => q && arr.indexOf(q) === i);
  let best = null;
  for (const q of tries) {
    let r; try { r = await api('/api/market/search', { cat, q, sealed: true }); } catch (e) { continue; }
    for (const x of r.results || []) { const sc = ivScore(name, x); if (sc >= 0.6 && (!best || sc > best.sc)) best = { sc, x }; }
    if (best && best.sc >= 0.85) break;
  }
  if (!best) return stockxReady() ? matchStockx(name) : putLink({ id, name, none: true, why: 'No match on TCGplayer', tried: Date.now(), by: 'auto' });
  const x = best.x, subs = Object.keys(x.prices || {});
  return putLink({ id, name, none: false, pid: x.id, cat: x.cat, group: x.group, pname: x.name, set: x.setName, image: x.image, url: x.url, prices: x.prices, setDate: x.setDate || '', sub: subs.includes('Normal') ? 'Normal' : subs[0] || '', at: Date.now(), tried: Date.now(), by: 'auto', score: Math.round(best.sc * 100) / 100 });
}
// match every product in these orders that hasn't been tried in the last 3 days (in the background, two at a time)
function ensureLinks(orders) {
  if (!SERVER || !cryptoKey) return;
  const names = new Map();
  for (const o of orders) if (!isDead(o)) for (const i of o.items || []) if (i.name && qtyOf(i) > 0) names.set(ivKey(i.name), i.name);
  const ix = ivIndex(), fresh = Date.now() - 3 * 864e5;
  for (const [k, n] of names) { const l = linkFor(n); if (l && (l.by !== 'auto' || !l.none || (l.tried || 0) > fresh)) continue; if (!ix.has(k) || (ix.get(k).tried || 0) <= fresh) if (!IV.queue.some(q => ivKey(q) === k)) { IV.queue.push(n); IV.total++; } }
  ivRun();
}
async function ivRun() {
  if (IV.busy || !IV.queue.length) return; IV.busy = true;
  let lastSave = Date.now();
  const worker = async () => { while (IV.queue.length && cryptoKey) { const n = IV.queue.shift(); try { await matchItem(n); } catch (_) { } IV.done++; if (Date.now() - lastSave > 4000) { lastSave = Date.now(); save(); if (IV.onUpdate) IV.onUpdate(); } } };
  try { await Promise.all([worker(), worker()]); } finally { IV.busy = false; }
  if (!cryptoKey) return;
  save(); if (IV.onUpdate) IV.onUpdate();
  if (!IV.queue.length) { IV.done = IV.total = 0; }
}
// keep matched prices fresh on the same 6-hour rhythm as Inventory
async function refreshLinkPrices(force) {
  const all = (state.itemLinks || []).filter(l => l.pid && !l.none && l.src !== 'manual'); if (!all.length || !SERVER) return 0;
  if (!force && Date.now() - (state.settings.linkPricesAt || 0) < 6 * 3600e3) return 0;
  const linked = all.filter(l => !l.src), sx = all.filter(l => l.src === 'stockx');
  if (sx.length && stockxReady()) {
    try { const r = await sxCall('/api/stockx/prices', { ids: sx.map(l => l.pid) }); for (const l of sx) { const p = r.prices[l.pid]; if (p) { l.prices = { StockX: { market: p.value ?? null, mid: p.ask ?? p.value ?? null, low: p.bid ?? null } }; l.at = Date.now(); l.updatedAt = Date.now(); } } } catch (_) { }
  }
  if (!linked.length) { state.settings.linkPricesAt = Date.now(); save(); if (IV.onUpdate) IV.onUpdate(); return sx.length; }
  try {
    const r = await api('/api/market/prices', { fresh: !!force, items: linked.map(l => ({ cat: l.cat, group: l.group, id: l.pid })) });
    let n = 0; for (const l of linked) { const p = r.prices[String(l.pid)]; if (p) { l.prices = p; l.at = Date.now(); l.updatedAt = Date.now(); n++; } }
    state.settings.linkPricesAt = Date.now(); save(); if (IV.onUpdate) IV.onUpdate(); return n;
  } catch (_) { return 0; }
}

/* ---------- estimated profit for a set of orders ---------- */
// what each product cost you (what you paid, with the order's tax and shipping spread in), by product name
function productCosts(orders) {
  const m = new Map();
  for (const o of orders) {
    if (isDead(o)) continue;
    const items = (o.items || []).filter(i => qtyOf(i) > 0); if (!items.length) continue;
    const sub = sum(items, i => (Number(i.price) || 0) * qtyOf(i));
    const ratio = sub > 0 && o.total != null && o.total !== '' ? Math.min(1.6, Math.max(0.85, Number(o.total) / sub)) : 1.08;
    for (const i of items) {
      const q = qtyOf(i), c = i.price != null && i.price !== '' ? Number(i.price) * ratio : items.length === 1 && o.total != null && o.total !== '' ? Number(o.total) / q : null;
      const g = m.get(i.name) || { name: i.name, qty: 0, costQty: 0, cost: 0 }; g.qty += q;
      if (c != null && isFinite(c)) { g.costQty += q; g.cost += c * q; }
      m.set(i.name, g);
    }
  }
  return m;
}
// Estimated profit, counting only orders that are secured (shipped, out for delivery, ready or delivered): what those
// items are worth at TCGplayer minus what you paid. Pending orders (including pre-orders) are worked out the same way
// but kept separate in .pend - most can still be cancelled.
function profitPart(orders) {
  const t = { value: 0, cost: 0, profit: 0, units: 0, priced: 0, unpriced: 0, pending: 0, orders: orders.length };
  for (const g of productCosts(orders).values()) {
    t.units += g.qty;
    const l = linkFor(g.name), v = ivPrice(l);
    if (v == null || !g.costQty) { t.unpriced += g.qty; if (!l) t.pending += g.qty; continue; }
    t.unpriced += g.qty - g.costQty;
    t.value += v * g.costQty; t.cost += g.cost; t.priced += g.costQty;
  }
  t.profit = t.value - t.cost;
  return t;
}
function profitOf(orders) {
  const sec = profitPart(orders.filter(o => !isDead(o) && isStuck(o)));
  sec.pend = profitPart(orders.filter(o => !isDead(o) && !isStuck(o)));
  return sec;
}

/* ---------- pictures for the canvas (fetched through Kingpin so the card can still be saved) ---------- */
const IMG = new Map();
function loadImg(url) {
  if (!url) return Promise.resolve(null);
  const hit = IMG.get(url); if (hit) return hit;
  const p = (async () => {
    let src = url;
    if (!/^data:image\//.test(url)) { if (!SERVER) return null; const r = await api('/api/img', { url }); src = `data:${r.type};base64,${r.data}`; }
    return await new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  })().catch(() => null);
  IMG.set(url, p); return p;
}

/* ---------- review the matches ---------- */
let ivReview = { q: {}, res: {}, src: {} };
const ivDefSrc = n => ivType(n) || /pok[eé]mon|tcg|one piece|lorcana|yu-?gi-?oh|magic|mtg/i.test(n) ? 'tcg' : 'stockx';
function openPriceReview(orders) {
  const costs = productCosts(orders);
  const names = [...costs.values()].map(g => [g.name, g.qty, g]).sort((a, b) => ((ivPrice(linkFor(b[0])) || 0) * b[1]) - ((ivPrice(linkFor(a[0])) || 0) * a[1]) || b[1] - a[1]);
  ivReview = { q: {}, res: {}, src: {}, names };
  renderPriceReview(); openDlg('dlgPrices');
}
function renderPriceReview() {
  const names = ivReview.names || [];
  $('#prBody').innerHTML = `<div class="small muted" style="margin-bottom:10px">Trading cards are matched to TCGplayer and valued at the lower of the market price (recent sales) and median listing.${stockxReady() ? ' Everything else is matched to StockX and valued between the highest bid and lowest ask.' : ' Connect StockX in Settings to price LEGO, consoles, sneakers and more.'} Profit is that minus what you paid. Biggest first — fix a wrong match by searching, set a price yourself, or mark it as not priced.</div>
    <div class="list">${names.map(([n, q]) => { const l = linkFor(n), v = ivPrice(l), k = ivKey(n); const res = ivReview.res[k];
      return `<div class="li prrow"><div class="mmain"><div class="t2 ellipsis">${esc(n)}</div>
        <div class="small ${l && !l.none ? 'muted' : 'faint'} ellipsis">${l && !l.none ? `→ ${esc(l.pname)}${l.set ? ' · ' + esc(l.set) : ''}${l.src === 'stockx' ? ' · StockX' : l.src === 'manual' ? '' : ' · TCGplayer'}${l.by === 'inventory' ? ' · from Inventory' : l.by === 'you' ? ' · set by you' : ''}` : l ? esc(l.why || 'Not priced') : 'Matching…'}</div>
        ${res ? `<div class="prres">${res.length ? res.slice(0, 6).map((x, j) => (x.src === 'stockx' ? `<button class="sm" data-prpick="${k}|${j}">${esc(x.title)} <span class="faint">· ${esc(x.brand || 'StockX')}${x.style ? ' · ' + esc(x.style) : ''} · StockX</span></button>` : `<button class="sm" data-prpick="${k}|${j}">${esc(x.name)} <span class="faint">· ${esc(x.setName || '')} · ${fmtMoney((x.prices.Normal || Object.values(x.prices)[0] || {}).mid)}</span></button>`)).join('') : '<span class="small faint">Nothing found — try other words.</span>'}</div>` : ''}
        <div class="prsearch" ${ivReview.q[k] != null ? '' : 'hidden'}><input data-prq="${k}" value="${esc(ivReview.q[k] || '')}" placeholder="Search for the product"><select data-prsrc="${k}" style="width:auto">${['tcg', 'stockx'].map(o => `<option value="${o}" ${(ivReview.src[k] || ivDefSrc(n)) === o ? 'selected' : ''}>${o === 'tcg' ? 'TCGplayer' : 'StockX'}</option>`).join('')}</select><button class="sm" data-prgo="${k}">Search</button></div>
        <div class="prsearch" ${ivReview.q[k] != null ? '' : 'hidden'}><input data-prset="${k}" inputmode="decimal" placeholder="Or type what one is worth ($)" value="${l && l.src === 'manual' ? esc(ivPrice(l)) : ''}"><button class="sm" data-prsetgo="${k}">Use my price</button></div></div>
        <div class="dright"><b>${v != null ? fmtMoney(v) : '—'}</b><div class="small faint">${q}× ordered</div>${(() => { const g = (ivReview.names.find(x => x[0] === n) || [])[2]; if (v == null || !g || !g.costQty) return ''; const each = v - g.cost / g.costQty; return `<div class="small ${each >= 0 ? 'pos' : 'neg'}" title="Each: worth ${fmtMoney(v)} − paid ${fmtMoney(g.cost / g.costQty)}">${fmtSigned(each)} each · ${fmtSigned(each * g.costQty)}</div>`; })()}<div class="hstack" style="gap:4px;justify-content:flex-end;margin-top:4px"><button class="ghost sm" data-prfix="${k}">Change</button>${l && !l.none && l.by !== 'inventory' ? `<button class="ghost sm" data-prnone="${k}" title="Don’t price this product">✕</button>` : ''}</div></div></div>`; }).join('') || '<div class="empty sm">No products in this range.</div>'}</div>`;
}
function wirePriceReview() {
  const nameOf = k => ((ivReview.names || []).find(([n]) => ivKey(n) === k) || [''])[0];
  $('#prBody').addEventListener('click', async e => {
    const fix = e.target.closest('[data-prfix]'); if (fix) { const k = fix.dataset.prfix; ivReview.q[k] = ivReview.q[k] != null ? ivReview.q[k] : ivWords(nameOf(k)).join(' '); renderPriceReview(); return; }
    const setgo = e.target.closest('[data-prsetgo]'); if (setgo) {
      const k = setgo.dataset.prsetgo, v = Number(String(($(`#prBody [data-prset="${k}"]`) || {}).value || '').replace(/[$,\s]/g, ''));
      if (!(v > 0) || v > 1e6) { toast('Type a price like 89.99'); return; }
      putLink({ id: k, name: nameOf(k), none: false, src: 'manual', pid: '', pname: 'Your price', set: '', prices: { Manual: { market: Math.round(v * 100) / 100, mid: Math.round(v * 100) / 100 } }, sub: 'Manual', at: Date.now(), tried: Date.now(), by: 'you' });
      delete ivReview.q[k]; delete ivReview.res[k]; save(); renderPriceReview(); if (IV.onUpdate) IV.onUpdate(); toast('Price saved'); return;
    }
    const none = e.target.closest('[data-prnone]'); if (none) { const k = none.dataset.prnone; putLink({ id: k, name: nameOf(k), none: true, why: 'Marked as not priced', by: 'you', tried: Date.now() }); save(); renderPriceReview(); if (IV.onUpdate) IV.onUpdate(); return; }
    const go = e.target.closest('[data-prgo]'); if (go) {
      const k = go.dataset.prgo, q = ($(`#prBody [data-prq="${k}"]`).value || '').trim(); ivReview.q[k] = q; if (!q) return;
      go.disabled = true; go.textContent = 'Searching…';
      const src = ($(`#prBody [data-prsrc="${k}"]`) || {}).value || ivDefSrc(nameOf(k)); ivReview.src[k] = src;
      try {
        if (src === 'stockx') { if (!stockxReady()) throw new Error('Connect StockX in Settings first'); const r = await sxCall('/api/stockx/search', { q }); ivReview.res[k] = (r.results || []).map(x => Object.assign({ src: 'stockx' }, x)); }
        else { const cat = (await ivCategory(nameOf(k))) || (await loadCats())[0].id; const r = await api('/api/market/search', { cat, q, sealed: true }); ivReview.res[k] = r.results || []; }
      } catch (err) { toast(err.message); }
      renderPriceReview(); return;
    }
    const pick = e.target.closest('[data-prpick]'); if (pick) {
      const [k, j] = pick.dataset.prpick.split('|'); const x = ivReview.res[k][+j];
      if (x.src === 'stockx') { let pr = {}; try { pr = (await sxCall('/api/stockx/prices', { ids: [x.id] })).prices || {}; } catch (err) { toast(err.message); } putLink(sxLink(k, nameOf(k), x, pr, 'you')); delete ivReview.res[k]; delete ivReview.q[k]; save(); renderPriceReview(); if (IV.onUpdate) IV.onUpdate(); toast('Matched on StockX'); return; }
      const subs = Object.keys(x.prices || {});
      putLink({ id: k, name: nameOf(k), none: false, pid: x.id, cat: x.cat, group: x.group, pname: x.name, set: x.setName, image: x.image, url: x.url, prices: x.prices, sub: subs.includes('Normal') ? 'Normal' : subs[0] || '', at: Date.now(), tried: Date.now(), by: 'you' });
      delete ivReview.res[k]; delete ivReview.q[k]; save(); renderPriceReview(); if (IV.onUpdate) IV.onUpdate(); toast('Matched on TCGplayer');
    }
  });
  $('#prBody').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.prq) { e.preventDefault(); const b = $(`#prBody [data-prgo="${e.target.dataset.prq}"]`); if (b) b.click(); } });
}

/* ---------- Settings → StockX ---------- */
const SXS = { configured: null };
function stockxCardHtml() {
  const S = state.settings, on = stockxReady(), n = (state.itemLinks || []).filter(l => l.src === 'stockx' && !l.none).length;
  if (SXS.configured === null && SERVER) api('/api/stockx/status', {}).then(r => { SXS.configured = !!r.configured; if (route.page === 'settings' && $('#sxCard')) $('#sxCard').outerHTML = stockxCardHtml(), wireStockxCard(); }).catch(() => { SXS.configured = false; });
  return `<div class="card" id="sxCard"><h3>StockX prices ${on ? '<span class="badge"><i style="background:var(--ok)"></i>connected</span>' : ''}</h3>
    <div class="small muted" style="margin-bottom:10px">Trading cards are priced from TCGplayer. Connect StockX to also price LEGO, consoles, sneakers and other collectibles in Inventory and the estimated profit. Valued between StockX’s highest bid and lowest ask.</div>
    ${on ? `<div class="small">${plural(n, 'product')} priced from StockX · connected ${esc(ago(S.stockx.connectedAt || 0))}</div><div class="hstack" style="margin-top:10px"><button id="sxRefresh">Update StockX prices</button><button class="ghost" id="sxOff">Disconnect</button></div>`
      : !SERVER ? '<div class="note small">Open Kingpin with Start Kingpin (or online) to connect StockX.</div>'
      : SXS.configured === false ? '<div class="note small">StockX isn’t set up on this Kingpin yet. The owner adds a StockX developer app (STOCKX_CLIENT_ID, STOCKX_CLIENT_SECRET and STOCKX_API_KEY) — see the setup notes.</div>'
      : '<button class="primary" id="sxOn">Connect StockX</button><div class="small faint" style="margin-top:6px">You sign in on StockX’s own site; Kingpin never sees your StockX password.</div>'}</div>`;
}
function wireStockxCard() {
  if ($('#sxOn')) $('#sxOn').onclick = stockxConnect;
  if ($('#sxOff')) $('#sxOff').onclick = async () => { if (!await ask('Disconnect StockX?\n\nPrices already matched stay until you change them.')) return; stockxDisconnect(); PAGES.settings.render(); toast('StockX disconnected'); };
  if ($('#sxRefresh')) $('#sxRefresh').onclick = async e => { e.target.disabled = true; e.target.textContent = 'Updating…'; const n = await refreshLinkPrices(true); toast(n ? 'Prices updated' : 'Nothing to update'); PAGES.settings.render(); };
}

/* Crown Tools - what the things you order are worth. Each product you've ordered is matched once to its TCGplayer
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
function ivPrice(l) { if (!l || l.none || !l.prices) return null; const p = l.prices[l.sub] || l.prices.Normal || Object.values(l.prices)[0] || {}; const v = p.mid ?? p.market ?? p.low; return v == null ? null : Number(v); }
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
async function matchItem(name) {
  const cat = await ivCategory(name); const id = ivKey(name);
  if (!cat) return putLink({ id, name, none: true, why: 'Not a trading-card product', tried: Date.now(), by: 'auto' });
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
  if (!best) return putLink({ id, name, none: true, why: 'No match on TCGplayer', tried: Date.now(), by: 'auto' });
  const x = best.x, subs = Object.keys(x.prices || {});
  return putLink({ id, name, none: false, pid: x.id, cat: x.cat, group: x.group, pname: x.name, set: x.setName, image: x.image, url: x.url, prices: x.prices, sub: subs.includes('Normal') ? 'Normal' : subs[0] || '', at: Date.now(), tried: Date.now(), by: 'auto', score: Math.round(best.sc * 100) / 100 });
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
  const linked = (state.itemLinks || []).filter(l => l.pid && !l.none); if (!linked.length || !SERVER) return 0;
  if (!force && Date.now() - (state.settings.linkPricesAt || 0) < 6 * 3600e3) return 0;
  try {
    const r = await api('/api/market/prices', { fresh: !!force, items: linked.map(l => ({ cat: l.cat, group: l.group, id: l.pid })) });
    let n = 0; for (const l of linked) { const p = r.prices[String(l.pid)]; if (p) { l.prices = p; l.at = Date.now(); l.updatedAt = Date.now(); n++; } }
    state.settings.linkPricesAt = Date.now(); save(); if (IV.onUpdate) IV.onUpdate(); return n;
  } catch (_) { return 0; }
}

/* ---------- estimated profit for a set of orders ---------- */
// value = TCGplayer median × quantity; cost = what you paid for that item, with the order's tax and shipping spread in
function profitOf(orders) {
  const t = { value: 0, cost: 0, profit: 0, units: 0, priced: 0, unpriced: 0, pending: 0 };
  for (const o of orders) {
    if (isDead(o)) continue;
    const items = (o.items || []).filter(i => qtyOf(i) > 0); if (!items.length) continue;
    const sub = sum(items, i => (Number(i.price) || 0) * qtyOf(i));
    const ratio = sub > 0 && o.total != null && o.total !== '' ? Math.min(1.6, Math.max(0.85, Number(o.total) / sub)) : 1.08;
    for (const i of items) {
      const q = qtyOf(i); t.units += q;
      const l = linkFor(i.name), v = ivPrice(l);
      let c = i.price != null && i.price !== '' ? Number(i.price) * ratio : items.length === 1 && o.total != null && o.total !== '' ? Number(o.total) / q : null;
      if (v == null || c == null || !isFinite(c)) { t.unpriced += q; if (!l) t.pending += q; continue; }
      t.value += v * q; t.cost += c * q; t.priced += q;
    }
  }
  t.profit = t.value - t.cost;
  return t;
}

/* ---------- pictures for the canvas (fetched through Crown Tools so the card can still be saved) ---------- */
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
let ivReview = { q: {}, res: {} };
function openPriceReview(names) {
  ivReview = { q: {}, res: {}, names };
  renderPriceReview(); openDlg('dlgPrices');
}
function renderPriceReview() {
  const names = ivReview.names || [];
  $('#prBody').innerHTML = `<div class="small muted" style="margin-bottom:10px">Each product is matched to TCGplayer and valued at the TCGplayer median. Fix a wrong match by searching for the right product, or mark it as not on TCGplayer.</div>
    <div class="list">${names.map(([n, q]) => { const l = linkFor(n), v = ivPrice(l), k = ivKey(n); const res = ivReview.res[k];
      return `<div class="li prrow"><div class="mmain"><div class="t2 ellipsis">${esc(n)}</div>
        <div class="small ${l && !l.none ? 'muted' : 'faint'} ellipsis">${l && !l.none ? `→ ${esc(l.pname)}${l.set ? ' · ' + esc(l.set) : ''}${l.by === 'inventory' ? ' · from Inventory' : l.by === 'you' ? ' · set by you' : ''}` : l ? esc(l.why || 'Not priced') : 'Matching…'}</div>
        ${res ? `<div class="prres">${res.length ? res.slice(0, 6).map((x, j) => `<button class="sm" data-prpick="${k}|${j}">${esc(x.name)} <span class="faint">· ${esc(x.setName || '')} · ${fmtMoney((x.prices.Normal || Object.values(x.prices)[0] || {}).mid)}</span></button>`).join('') : '<span class="small faint">Nothing found — try other words.</span>'}</div>` : ''}
        <div class="prsearch" ${ivReview.q[k] != null ? '' : 'hidden'}><input data-prq="${k}" value="${esc(ivReview.q[k] || '')}" placeholder="Search TCGplayer"><button class="sm" data-prgo="${k}">Search</button></div></div>
        <div class="dright"><b>${v != null ? fmtMoney(v) : '—'}</b><div class="small faint">${q}× ordered</div><div class="hstack" style="gap:4px;justify-content:flex-end;margin-top:4px"><button class="ghost sm" data-prfix="${k}">Change</button>${l && !l.none && l.by !== 'inventory' ? `<button class="ghost sm" data-prnone="${k}" title="Not on TCGplayer">✕</button>` : ''}</div></div></div>`; }).join('') || '<div class="empty sm">No products in this range.</div>'}</div>`;
}
function wirePriceReview() {
  const nameOf = k => ((ivReview.names || []).find(([n]) => ivKey(n) === k) || [''])[0];
  $('#prBody').addEventListener('click', async e => {
    const fix = e.target.closest('[data-prfix]'); if (fix) { const k = fix.dataset.prfix; ivReview.q[k] = ivReview.q[k] != null ? ivReview.q[k] : ivWords(nameOf(k)).join(' '); renderPriceReview(); return; }
    const none = e.target.closest('[data-prnone]'); if (none) { const k = none.dataset.prnone; putLink({ id: k, name: nameOf(k), none: true, why: 'Marked not on TCGplayer', by: 'you', tried: Date.now() }); save(); renderPriceReview(); if (IV.onUpdate) IV.onUpdate(); return; }
    const go = e.target.closest('[data-prgo]'); if (go) {
      const k = go.dataset.prgo, q = ($(`#prBody [data-prq="${k}"]`).value || '').trim(); ivReview.q[k] = q; if (!q) return;
      go.disabled = true; go.textContent = 'Searching…';
      try { const cat = (await ivCategory(nameOf(k))) || (await loadCats())[0].id; const r = await api('/api/market/search', { cat, q, sealed: true }); ivReview.res[k] = r.results || []; } catch (err) { toast(err.message); }
      renderPriceReview(); return;
    }
    const pick = e.target.closest('[data-prpick]'); if (pick) {
      const [k, j] = pick.dataset.prpick.split('|'); const x = ivReview.res[k][+j]; const subs = Object.keys(x.prices || {});
      putLink({ id: k, name: nameOf(k), none: false, pid: x.id, cat: x.cat, group: x.group, pname: x.name, set: x.setName, image: x.image, url: x.url, prices: x.prices, sub: subs.includes('Normal') ? 'Normal' : subs[0] || '', at: Date.now(), tried: Date.now(), by: 'you' });
      delete ivReview.res[k]; delete ivReview.q[k]; save(); renderPriceReview(); if (IV.onUpdate) IV.onUpdate(); toast('Matched — priced at the TCGplayer median');
    }
  });
  $('#prBody').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.prq) { e.preventDefault(); const b = $(`#prBody [data-prgo="${e.target.dataset.prq}"]`); if (b) b.click(); } });
}

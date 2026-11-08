/* Kingpin - Pokémon products. Every Pokémon trading-card product on Target's site with its TCIN, sorted by set and
   product type, newest listings first. The list comes from Target's public product index (read once a day by
   Kingpin Online and shared), sets and release dates from TCGplayer. Shown on the SKU lists page: browse, filter,
   copy SKUs or add them to a list in one click; and as suggestions at the top of a Target SKU list. */
'use strict';
const PKD = { cat: null, at: 0, busy: false, err: '', byT: new Map(), sets: new Map(), tried: 0 };
const PKV = { q: '', set: '', type: '', group: 'set', imports: false, onlyTarget: false, shown: 120, sel: new Set() };
const PK_TYPE_ORDER = ['Elite Trainer Box', 'Booster Bundle', 'Booster Box', 'Premium Collection', 'Collection Box', 'Tin', 'Mini Tin', 'Blister', 'Sleeved Booster', 'Booster Pack', 'Build & Battle', 'Deck', 'Binder / Poster', 'Surprise Box', 'Other'];
const pkByTcin = t => PKD.byT.get(String(t)) || null;
const pkImg = (c, w) => c && c.img ? `https://target.scene7.com/is/image/Target/${encodeURIComponent(c.img)}?wid=${w || 96}&hei=${w || 96}&qlt=80&fmt=webp` : '';
const pkShort = n => String(n || '').replace(/^Pok[eé]mon\s+(?:TCG\s+)?(?:Trading Card Game\s*)?(?:TCG\s+)?/i, '').replace(/^[:\-–— ]+/, '') || n;
const pkSetName = id => (PKD.sets.get(String(id)) || {}).name || '';
const pkSetDate = id => (PKD.sets.get(String(id)) || {}).date || '';
function pkIndex(cat) {
  PKD.cat = cat; PKD.at = cat.at || 0;
  PKD.byT = new Map((cat.items || []).map(x => [String(x.t), x]));
  PKD.sets = new Map((cat.sets || []).map(s => [String(s.id), s]));
}
function pkLoadCache() {
  if (PKD.cat) return;
  try { const j = JSON.parse(localStorage.getItem('crown.pkCat') || 'null'); if (j && Array.isArray(j.items)) pkIndex(j); } catch (_) { }
}
// the shared list is updated once a day; this device asks for it at most every few hours
async function pkFetch(force) {
  if (PKD.busy || !SERVER) return;
  if (!force && PKD.cat && Date.now() - (PKD.tried || 0) < 3 * 3600000 && Date.now() - PKD.at < 26 * 3600000) return;
  PKD.busy = true; PKD.err = ''; PKD.tried = Date.now(); pkRedraw();
  try {
    const r = await api('/api/pk/catalog', { fresh: !!force });
    const slim = { at: r.at, items: r.items, sets: r.sets };
    pkIndex(slim);
    try { localStorage.setItem('crown.pkCat', JSON.stringify(slim)); } catch (_) { }
    if (force) toast(`Product list updated · ${plural(r.items.length, 'product')}`);
  } catch (e) { PKD.err = e.message || String(e); if (force) toast(PKD.err); }
  PKD.busy = false; pkRedraw();
}
function pkRedraw() { if (typeof route === 'undefined') return; if (route.page === 'skus') PAGES.skus.render(); else if (route.page === 'news') PAGES.news.render(); }
// products a news story is about: the set it names, narrowed to the product types it names
function pkMatchText(text, n) {
  if (!PKD.cat) return [];
  const t = ' ' + String(text || '').toLowerCase().replace(/é/g, 'e').replace(/[^a-z0-9&]+/g, ' ') + ' ';
  const sets = [...PKD.sets.values()].filter(s => { const k = ' ' + s.name.toLowerCase().replace(/é/g, 'e').replace(/[^a-z0-9&]+/g, ' ').replace(/^(scarlet & violet|sword & shield|mega evolution) /, '').trim() + ' '; return k.trim().length > 3 && t.includes(k); });
  if (!sets.length) return [];
  const ids = new Set(sets.map(s => String(s.id)));
  const types = [['Elite Trainer Box', /elite trainer|\betb\b/], ['Booster Bundle', /booster bundle/], ['Booster Box', /booster (box|display)/], ['Premium Collection', /premium collection|\bupc\b|\bspc\b/], ['Tin', /\btins?\b/], ['Mini Tin', /mini tin/], ['Blister', /blister/], ['Booster Pack', /booster packs?/], ['Collection Box', /collection/]].filter(([, rx]) => rx.test(t)).map(x => x[0]);
  return (PKD.cat.items || []).filter(x => ids.has(String(x.s)) && !x.imp && !x.gone && (!types.length || types.includes(x.ty))).sort((a, b) => (b.o - a.o) || (+b.t - +a.t)).slice(0, n || 8);
}
function pkShown() {
  if (!PKD.cat) return [];
  const q = PKV.q.trim().toLowerCase(), words = q.split(/\s+/).filter(Boolean);
  return PKD.cat.items.filter(x => {
    if (x.gone) return false;
    if (!PKV.imports && x.imp) return false;
    if (PKV.onlyTarget && !x.o) return false;
    if (PKV.set && String(x.s) !== PKV.set) return false;
    if (PKV.type && x.ty !== PKV.type) return false;
    if (words.length) { const h = (x.n + ' ' + x.t + ' ' + pkSetName(x.s) + ' ' + x.ty).toLowerCase(); if (!words.every(w => h.includes(w))) return false; }
    return true;
  });
}
function pkGroupsOf(list) {
  const g = new Map(), key = x => PKV.group === 'set' ? (x.s ? 's' + x.s : 'z') : PKV.group === 'type' ? x.ty : PKV.group === 'seen' ? (x.f ? new Date(x.f).toISOString().slice(0, 7) : '0') : 'all';
  for (const x of list) { const k = key(x); if (!g.has(k)) g.set(k, []); g.get(k).push(x); }
  const label = k => PKV.group === 'set' ? (k === 'z' ? ['Not matched to a set', ''] : [pkSetName(k.slice(1)), pkSetDate(k.slice(1)) ? 'released ' + fmtDate(pkSetDate(k.slice(1))) : '']) : PKV.group === 'type' ? [k, ''] : PKV.group === 'seen' ? [k === '0' ? 'On Target before Kingpin started watching' : 'New on Target in ' + new Date(k + '-15').toLocaleString(undefined, { month: 'long', year: 'numeric' }), ''] : ['All products', ''];
  const order = [...g.keys()].sort((a, b) => PKV.group === 'set' ? (a === 'z') - (b === 'z') || String(pkSetDate(b.slice(1))).localeCompare(String(pkSetDate(a.slice(1)))) : PKV.group === 'type' ? PK_TYPE_ORDER.indexOf(a) - PK_TYPE_ORDER.indexOf(b) : String(b).localeCompare(String(a)));
  return order.map(k => ({ k, title: label(k)[0], sub: label(k)[1], items: g.get(k) }));
}
function pkTargetList(l) { return l && (l.store === 'Target' || !l.store); }
function pkRowHtml(x, l) {
  const has = l && l.items.some(i => i.sku === x.t);
  return `<div class="pkrow ${PKV.sel.has(x.t) ? 'sel' : ''}" data-pk="${esc(x.t)}"><input type="checkbox" data-pkcb="${esc(x.t)}" ${PKV.sel.has(x.t) ? 'checked' : ''} aria-label="Select">
    ${x.img ? `<img src="${esc(pkImg(x, 96))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : '<span class="nph"></span>'}
    <div class="pkmain"><div class="t ellipsis" title="${esc(x.n)}">${esc(pkShort(x.n))}</div><div class="small muted ellipsis">${esc([x.ty, x.s && PKV.group !== 'set' ? pkSetName(x.s) : '', x.f && Date.now() - x.f < 14 * 86400000 ? 'new ' + newsAgo(x.f) : '', x.imp ? 'marketplace / import' : '', x.o ? 'Target listing' : ''].filter(Boolean).join(' · '))}</div></div>
    <span class="mono pksku">${esc(x.t)} <button class="ghost sm icopy" data-pkcopy="${esc(x.t)}" title="Copy TCIN" aria-label="Copy TCIN">⧉</button></span>
    <a class="small" href="https://www.target.com/p/-/A-${esc(x.t)}" target="_blank" rel="noopener">Target ↗</a>
    ${l ? (has ? '<span class="btn-done small">✓ In list</span>' : `<button class="primary sm" data-pkadd="${esc(x.t)}">+ Add</button>`) : ''}</div>`;
}
function pkCatalogHtml(l) {
  pkLoadCache(); if (!PKD.busy && SERVER) setTimeout(() => pkFetch(false), 0);
  if (!PKD.cat) return `<div class="empty">${PKD.busy ? 'Getting the Pokémon product list… (the first time can take a minute)' : PKD.err ? esc(PKD.err) + ' <button class="sm" id="pkRetry">Try again</button>' : SERVER ? 'Loading…' : 'The product list needs Kingpin running (the app or Kingpin Online).'}</div>`;
  const list = pkShown(), groups = pkGroupsOf(list), sets = [...PKD.sets.values()].filter(s => PKD.cat.items.some(x => String(x.s) === String(s.id))), types = PK_TYPE_ORDER.filter(t => PKD.cat.items.some(x => x.ty === t));
  let left = PKV.shown;
  const lists = state.skuLists || [];
  return `<div class="toolbar pktools"><input class="search" data-search id="pkQ" placeholder="Search products or TCINs…" value="${esc(PKV.q)}">
      <select id="pkSet" style="width:auto" aria-label="Set"><option value="">All sets</option>${sets.map(s => `<option value="${esc(s.id)}" ${PKV.set === String(s.id) ? 'selected' : ''}>${esc(s.name)}${s.date ? ' · ' + esc(s.date.slice(0, 7)) : ''}</option>`).join('')}</select>
      <select id="pkGroup" style="width:auto" aria-label="Group by">${[['set', 'Group by set'], ['type', 'Group by type'], ['seen', 'Group by when it showed up'], ['none', 'Newest first']].map(([v, t]) => `<option value="${v}" ${PKV.group === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label class="check small" style="width:auto"><input type="checkbox" id="pkOnly" ${PKV.onlyTarget ? 'checked' : ''}> Target’s own listings only</label>
      <label class="check small" style="width:auto"><input type="checkbox" id="pkImp" ${PKV.imports ? 'checked' : ''}> Include marketplace & imports</label></div>
    <div class="chips" id="pkTypes" style="margin-bottom:10px"><button class="chip ${!PKV.type ? 'on' : ''}" data-pkty="">All types</button>${types.map(t => `<button class="chip ${PKV.type === t ? 'on' : ''}" data-pkty="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <div class="hstack pkselbar" style="flex-wrap:wrap;gap:8px;margin-bottom:8px"><b>${plural(list.length, 'product')}</b>${PKV.sel.size ? `<span class="small">${PKV.sel.size} selected</span>` : ''}<span class="spacer"></span>
      ${lists.length ? `<label class="small muted hstack" style="gap:6px">List <select id="pkList" style="width:auto">${lists.map(x => `<option value="${x.id}" ${l && x.id === l.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
      <button class="sm" id="pkCopy">Copy ${PKV.sel.size ? 'selected' : 'shown'} TCINs</button><button class="sm primary" id="pkAddSel">${PKV.sel.size ? `Add ${PKV.sel.size} to list` : lists.length ? 'Add shown to list' : '+ New list with these'}</button>${PKV.sel.size ? '<button class="sm ghost" id="pkClr">Clear</button>' : ''}</div>
    <div class="pkgroups">${groups.map(g => { if (left <= 0) return ''; const its = g.items.slice(0, left); left -= its.length;
      return `<div class="pkgroup"><div class="pkghead"><b>${esc(g.title)}</b> <span class="small faint">${esc(g.sub)}${g.sub ? ' · ' : ''}${plural(g.items.length, 'product')}</span><button class="ghost sm" data-pkgsel="${esc(g.k)}">Select all</button></div>${its.map(x => pkRowHtml(x, l)).join('')}</div>`; }).join('')}</div>
    ${list.length > PKV.shown ? `<div style="text-align:center;margin:12px"><button id="pkMore">Show more (${list.length - PKV.shown} left)</button></div>` : ''}
    ${!list.length ? '<div class="empty">No products match.</div>' : ''}
    <div class="small faint" style="margin-top:12px">Every Pokémon trading-card product on Target’s site, from Target’s public product index · updated ${esc(newsAgo(PKD.at))}${PKD.busy ? ' · updating…' : ''} · <button class="linkbtn small" id="pkRefresh" ${PKD.busy ? 'disabled' : ''}>Update now</button>. Sets and release dates: TCGplayer. “When it showed up” starts from the day Kingpin first saw the product.</div>`;
}
function pkAddTcins(l, tcins) {
  const have = new Set(l.items.map(i => i.sku)), fresh = tcins.filter(t => !have.has(t));
  fresh.forEach(t => { const x = pkByTcin(t) || {}; l.items.push({ id: uid(), sku: t, url: 'https://www.target.com/p/-/A-' + t, store: l.store && l.store !== 'Target' ? 'Target' : '', qty: 1, name: x.n ? pkShort(x.n) : '', image: x.img ? `https://target.scene7.com/is/image/Target/${x.img}` : '', notes: '', addedAt: Date.now() }); });
  skuTouch(l); save();
  toast(fresh.length ? `Added ${plural(fresh.length, 'SKU')} to “${l.name}”${tcins.length > fresh.length ? ` · ${tcins.length - fresh.length} already there` : ''}` : `Already in “${l.name}”`);
  if (fresh.length && typeof skuLookupAll === 'function') skuLookupAll(l);
}
async function pkTargetListFor(l) {
  const lists = state.skuLists || (state.skuLists = []);
  const pick = $('#pkList') ? skuListById($('#pkList').value) : l;
  if (pick) return pick;
  const n = await askText('New SKU list', 'Target drops', { ok: 'Make list' }); if (!n || !n.trim()) return null;
  const x = newSkuList(n.trim(), 'Target'); lists.push(x); SK.list = x.id; return x;
}
function wirePkCatalog(pg, l) {
  if ($('#pkRetry')) $('#pkRetry').onclick = () => pkFetch(true);
  if (!PKD.cat) return;
  const rer = () => PAGES.skus.render();
  $('#pkQ').oninput = debounce(e => { PKV.q = e.target.value; PKV.shown = 120; rer(); }, 200);
  $('#pkSet').onchange = e => { PKV.set = e.target.value; PKV.shown = 120; rer(); };
  $('#pkGroup').onchange = e => { PKV.group = e.target.value; rer(); };
  $('#pkOnly').onchange = e => { PKV.onlyTarget = e.target.checked; rer(); };
  $('#pkImp').onchange = e => { PKV.imports = e.target.checked; rer(); };
  $('#pkTypes').onclick = e => { const b = e.target.closest('[data-pkty]'); if (!b) return; PKV.type = b.dataset.pkty; PKV.shown = 120; rer(); };
  if ($('#pkList')) $('#pkList').onchange = e => { SK.list = e.target.value; rer(); };
  if ($('#pkMore')) $('#pkMore').onclick = () => { PKV.shown += 200; rer(); };
  $('#pkRefresh').onclick = () => pkFetch(true);
  if ($('#pkClr')) $('#pkClr').onclick = () => { PKV.sel.clear(); rer(); };
  $('#pkCopy').onclick = () => { const t = PKV.sel.size ? [...PKV.sel] : pkShown().map(x => x.t); copyText(t.join('\n'), plural(t.length, 'TCIN')); };
  $('#pkAddSel').onclick = async () => { const t = PKV.sel.size ? [...PKV.sel] : pkShown().slice(0, 300).map(x => x.t); if (!PKV.sel.size && t.length > 30 && !await ask(`Add all ${t.length} shown products to the list?`, { ok: 'Add them' })) return; const x = await pkTargetListFor(l); if (!x) return; pkAddTcins(x, t); PKV.sel.clear(); rer(); };
  pg.querySelector('.pkgroups').onclick = async e => {
    const cp = e.target.closest('[data-pkcopy]'); if (cp) { copyText(cp.dataset.pkcopy, 'TCIN'); return; }
    const ad = e.target.closest('[data-pkadd]'); if (ad) { const x = await pkTargetListFor(l); if (x) { pkAddTcins(x, [ad.dataset.pkadd]); rer(); } return; }
    const gs = e.target.closest('[data-pkgsel]'); if (gs) { const g = pkGroupsOf(pkShown()).find(x => x.k === gs.dataset.pkgsel); if (g) { const all = g.items.every(x => PKV.sel.has(x.t)); g.items.forEach(x => all ? PKV.sel.delete(x.t) : PKV.sel.add(x.t)); rer(); } return; }
    const cb = e.target.closest('[data-pkcb]'); if (cb) { cb.checked ? PKV.sel.add(cb.dataset.pkcb) : PKV.sel.delete(cb.dataset.pkcb); rer(); }
  };
}
// a short "suggested" box at the top of a Target SKU list: the newest Target listings and products in today's news
function pkSuggest(l) {
  if (!PKD.cat || !pkTargetList(l)) return [];
  const have = new Set(l.items.map(i => i.sku)), hide = new Set((l.pkHide || []).map(String)), out = [], seen = new Set();
  const push = (x, why) => { if (!x || seen.has(x.t) || have.has(x.t) || hide.has(x.t) || x.imp || x.gone) return; seen.add(x.t); out.push({ x, why }); };
  const cut = Date.now() - 2 * 86400000;
  if (typeof NW !== 'undefined') for (const it of NW.items) { if (!(it.date > cut)) continue; for (const s of it.skus || []) if (s.store === 'Target') push(pkByTcin(s.sku), 'In the news ' + newsAgo(it.date)); for (const x of pkMatchText(it.title, 3)) push(x, 'In the news ' + newsAgo(it.date)); if (out.length >= 4) break; }
  const fresh = PKD.cat.items.filter(x => x.f && x.f > Date.now() - 7 * 86400000).sort((a, b) => b.f - a.f);
  for (const x of fresh) { push(x, 'New on Target ' + newsAgo(x.f)); if (out.length >= 6) break; }
  const newest = [...PKD.sets.values()].sort((a, b) => String(b.date).localeCompare(String(a.date))).filter(s => s.date && s.date <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10))[0];
  if (out.length < 6 && newest) for (const x of PKD.cat.items.filter(x => String(x.s) === String(newest.id) && x.o && ['Elite Trainer Box', 'Booster Bundle', 'Booster Box', 'Premium Collection', 'Blister', 'Collection Box', 'Tin'].includes(x.ty))) { push(x, 'Newest set: ' + newest.name); if (out.length >= 6) break; }
  return out.slice(0, 6);
}
function pkSuggestHtml(l) {
  pkLoadCache(); if (!PKD.busy && SERVER) setTimeout(() => pkFetch(false), 0);
  const sug = pkSuggest(l); if (!sug.length) return '';
  return `<div class="card pksug"><div class="hstack" style="justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:4px"><div><b>Suggested for this list</b> <span class="small faint">new on Target, in the news, or from the newest set</span></div><span><button class="sm" id="pkSugAll">Add all ${sug.length}</button> <button class="sm ghost" id="pkSugHide" title="Hide these suggestions">Hide</button></span></div>
    ${sug.map(({ x, why }) => `<div class="pkrow"><span></span>${x.img ? `<img src="${esc(pkImg(x, 96))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : '<span class="nph"></span>'}<div class="pkmain"><div class="t ellipsis">${esc(pkShort(x.n))}</div><div class="small muted"><span class="mono">TCIN ${esc(x.t)}</span> · ${esc(x.ty)}</div></div><span class="ntag ${/news/.test(why) ? 'drop' : 'restock'}">${esc(why)}</span><span></span><button class="primary sm" data-pksug="${esc(x.t)}">+ Add</button></div>`).join('')}</div>`;
}
function wirePkSuggest(pg, l) {
  const box = pg.querySelector('.pksug'); if (!box) return;
  const sug = pkSuggest(l);
  box.onclick = e => { const b = e.target.closest('[data-pksug]'); if (b) { pkAddTcins(l, [b.dataset.pksug]); PAGES.skus.render(); } };
  $('#pkSugAll').onclick = () => { pkAddTcins(l, sug.map(s => s.x.t)); PAGES.skus.render(); };
  $('#pkSugHide').onclick = () => { l.pkHide = (l.pkHide || []).concat(sug.map(s => s.x.t)).slice(-400); skuTouch(l); save(); PAGES.skus.render(); };
}

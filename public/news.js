/* Kingpin - News. Pokémon news from public news sites (PokéBeach, PokéJungle, Polygon, Dexerto, Nintendo Life…),
   read on a schedule you pick (1, 2, 4, 6 or 12 times a day) or whenever you hit Refresh. Headlines only in the list,
   grouped by day; click one to read it, see the products it mentions with their Target SKUs, add them to a SKU list,
   save it or set a reminder. The articles themselves are public and are kept on this device only; what you've read,
   saved and your reminders are kept with your data so every device agrees. */
'use strict';
const NEWS_KINDS = { drop: ['Drop', 'drop'], raffle: ['Raffle', 'raffle'], change: ['Change', 'change'], restock: ['Restock', 'restock'], news: ['News', 'news'] };
const NEWS_FILTERS = [['all', 'All'], ['today', 'Today'], ['drop', 'Drops'], ['raffle', 'Raffles'], ['change', 'Changes'], ['restock', 'Restocks'], ['tcg', 'TCG only'], ['saved', '★ Saved']];
const NEWS_FREQ = [[0, 'Only when I refresh'], [1, 'Once a day'], [2, 'Twice a day'], [4, '4 times a day'], [6, '6 times a day'], [12, 'Every 2 hours']];
const NW = { items: [], at: 0, sources: [], builtin: [], busy: false, err: '', filter: 'all', q: '', open: '', more: false, timer: 0, showSrc: false };
const NEWS_KEEP = 21 * 86400000;
function newsCfg() {
  const s = state.settings || (state.settings = {});
  const n = s.news || (s.news = {});
  if (n.freq == null) n.freq = 4;
  n.off = Array.isArray(n.off) ? n.off : []; n.custom = Array.isArray(n.custom) ? n.custom : [];
  n.read = n.read && typeof n.read === 'object' ? n.read : {}; n.saved = n.saved && typeof n.saved === 'object' ? n.saved : {};
  n.reminders = Array.isArray(n.reminders) ? n.reminders : [];
  return n;
}
// the articles live on this device (they're public and can be big); saved ones are copied into your data
function newsLoadCache() {
  try { const j = JSON.parse(localStorage.getItem('crown.newsCache') || 'null'); if (j && Array.isArray(j.items)) { NW.items = j.items; NW.at = j.at || 0; NW.sources = j.sources || []; NW.builtin = j.builtin || []; } } catch (_) { }
}
function newsSaveCache() {
  const cut = Date.now() - NEWS_KEEP, slim = NW.items.filter(i => !i.date || i.date > cut).slice(0, 300).map(i => Object.assign({}, i, { text: String(i.text || '').slice(0, 6000) }));
  for (let n = slim.length; n > 20; n = Math.floor(n * .7)) { try { localStorage.setItem('crown.newsCache', JSON.stringify({ at: NW.at, items: slim.slice(0, n), sources: NW.sources, builtin: NW.builtin })); return; } catch (_) { } }
}
const newsAll = () => { const c = newsCfg(), have = new Set(NW.items.map(i => i.id)); return NW.items.concat(Object.values(c.saved).filter(s => s && s.id && !have.has(s.id))); };
const newsById = id => newsAll().find(i => i.id === id);
const newsUnread = () => { const c = newsCfg(), cut = Date.now() - 2 * 86400000; return NW.items.filter(i => i.date > cut && !c.read[i.id]).length; };
function newsAgo(ms) {
  if (!ms) return '';
  const d = Date.now() - ms, m = Math.round(d / 60000);
  if (m < 1) return 'just now'; if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60); if (h < 24) return h + 'h ago';
  const days = Math.round(h / 24); return days < 7 ? days + 'd ago' : fmtDate(new Date(ms).toISOString());
}
function newsDay(ms) {
  if (!ms) return 'Earlier';
  const d = new Date(ms), t = new Date(); t.setHours(0, 0, 0, 0);
  if (d >= t) return 'Today';
  if (d >= new Date(t.getTime() - 86400000)) return 'Yesterday';
  if (d >= new Date(t.getTime() - 6 * 86400000)) return 'This week';
  return 'Earlier';
}
// quick facts read from the article: which stores, a purchase limit
function newsFacts(it) {
  const t = (it.title + '\n' + it.text).slice(0, 5000), out = [];
  const stores = ['Target', 'Walmart', 'Best Buy', 'Pokémon Center', 'GameStop', 'Amazon', 'Costco', "Sam's Club", 'Barnes & Noble', 'Dick’s'].filter(s => new RegExp('\\b' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('é', '[eé]') + '\\b', 'i').test(t));
  if (stores.length) out.push(['Stores', stores.slice(0, 3).join(', ') + (stores.length > 3 ? '…' : '')]);
  const lim = t.match(/\blimit(?:ed)?(?: of| to)? (\d{1,2})\b|\b(\d{1,2}) per (?:customer|guest|household|person|order|account)\b/i);
  if (lim) out.push(['Limit', (lim[1] || lim[2]) + ' per ' + ((t.match(/per (customer|guest|household|person|order|account)/i) || [])[1] || 'customer').toLowerCase()]);
  const pr = t.match(/\$\d{1,4}(?:\.\d{2})?/); if (pr) out.push(['Price mentioned', pr[0]]);
  return out;
}
// products the article mentions: SKUs written in it, plus Target products from the catalog that match its set and product type
function newsProducts(it) {
  const out = [], seen = new Set();
  for (const s of it.skus || []) { const k = s.store + ':' + s.sku; if (seen.has(k)) continue; seen.add(k); const c = s.store === 'Target' && typeof pkByTcin === 'function' ? pkByTcin(s.sku) : null; out.push({ store: s.store, sku: s.sku, name: s.name || (c && c.n) || '', url: s.url, img: c ? pkImg(c, 96) : '', from: 'article' }); }
  if (typeof pkMatchText === 'function') for (const c of pkMatchText(it.title + ' ' + String(it.text || '').slice(0, 1500), 8)) { const k = 'Target:' + c.t; if (seen.has(k)) continue; seen.add(k); out.push({ store: 'Target', sku: c.t, name: c.n, url: 'https://www.target.com/p/-/A-' + c.t, img: pkImg(c, 96), from: 'match' }); }
  return out.slice(0, 14);
}
async function newsRefresh(manual) {
  if (NW.busy || !SERVER) return;
  const c = newsCfg(); NW.busy = true; NW.err = ''; if (route.page === 'news') PAGES.news.render();
  try {
    const r = await api('/api/news', { off: c.off, custom: c.custom, fresh: !!manual });
    const prev = new Map(NW.items.map(i => [i.id, i]));
    NW.items = r.items.map(i => Object.assign(prev.get(i.id) || {}, i)); NW.at = r.at; NW.sources = r.sources || []; NW.builtin = r.builtin || [];
    // merge the same story posted by several sites (same title)
    const byT = new Map(); NW.items = NW.items.filter(i => { const k = norm(i.title).slice(0, 80); if (byT.has(k)) { const a = byT.get(k); a.also = (a.also || []).concat(i.srcName).filter((x, j, A) => A.indexOf(x) === j); return false; } byT.set(k, i); return true; });
    c.lastFetch = Date.now(); newsSaveCache();
    // read marks older than a month aren't needed any more
    const cut = Date.now() - 35 * 86400000; for (const [k, v] of Object.entries(c.read)) if (v < cut) delete c.read[k];
    save(); renderNav();
    const bad = NW.sources.filter(s => !s.ok);
    if (manual) toast(`News updated · ${plural(NW.items.length, 'story', 'stories')}${bad.length ? ` · ${plural(bad.length, 'site')} didn’t answer` : ''}`);
  } catch (e) { NW.err = e.message || String(e); if (manual) toast(NW.err); }
  NW.busy = false; if (route.page === 'news') PAGES.news.render();
}
// on the schedule you picked; checked every few minutes while Kingpin is open
function newsTick() {
  const c = newsCfg(), every = c.freq ? 86400000 / c.freq : 0;
  if (every && cryptoKey && SERVER && Date.now() - (c.lastFetch || 0) > every) newsRefresh(false);
  // reminders
  const now = Date.now(); let fired = false;
  for (const r of c.reminders) if (!r.done && r.at <= now) {
    r.done = true; fired = true; const it = newsById(r.id);
    addNotif('news', 'Reminder: ' + (it ? it.title : 'a news story'), it ? it.srcName : '', 'news/' + r.id, 'nrem:' + r.id + ':' + r.at);
    toast('⏰ ' + (it ? it.title : 'News reminder'));
  }
  if (fired) { c.reminders = c.reminders.filter(r => !r.done || now - r.at < 86400000); save(); renderNav(); }
}
function newsShown() {
  const c = newsCfg(), q = NW.q.trim().toLowerCase(), f = NW.filter, today = new Date(); today.setHours(0, 0, 0, 0);
  return newsAll().filter(i => {
    if (f === 'saved' && !c.saved[i.id]) return false;
    if (f === 'today' && !(i.date >= today.getTime())) return false;
    if (NEWS_KINDS[f] && i.kind !== f) return false;
    if (f === 'tcg' && !i.tcg) return false;
    if (q && ![i.title, i.srcName, i.text].some(v => String(v || '').toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => (b.date || 0) - (a.date || 0));
}
const newsTag = k => { const x = NEWS_KINDS[k] || NEWS_KINDS.news; return `<span class="ntag ${x[1]}">${x[0]}</span>`; };
function newsArticleHtml(it) {
  const c = newsCfg(), facts = newsFacts(it), prods = newsProducts(it), paras = String(it.text || '').split(/\n\n+/).filter(Boolean), long = paras.length > 8 && !NW.more;
  const lists = (state.skuLists || []), rem = c.reminders.find(r => r.id === it.id && !r.done);
  return `<div class="narticle">
    <div class="nmeta">${newsTag(it.kind)}<span>${esc(it.srcName)}${it.also && it.also.length ? ' · also on ' + esc(it.also.join(', ')) : ''} · ${esc(it.date ? fmtDT(new Date(it.date).toISOString()) : '')}</span></div>
    <h2>${esc(it.title)}</h2>
    ${facts.length ? `<div class="nfacts">${facts.map(([l, v]) => `<div><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div></div>`).join('')}</div>` : ''}
    ${it.image ? `<img class="nimg" src="${esc(it.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
    <div class="ntext">${(long ? paras.slice(0, 8) : paras).map(p => `<p>${esc(p)}</p>`).join('') || '<p class="faint">This site only shares the headline. Open the original to read it.</p>'}${long ? '<button class="linkbtn" id="nwMore">Read the rest</button>' : ''}</div>
    ${prods.length ? `<div class="nprods"><div class="hstack" style="justify-content:space-between;margin-bottom:6px"><b>Products${prods.some(p => p.from === 'match') ? ' it mentions' : ''}</b>${lists.length ? `<label class="small muted hstack" style="gap:6px">Add to <select id="nwList" style="width:auto">${lists.map(l => `<option value="${l.id}" ${l.id === (c.lastList || '') ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}<option value="__new">+ New list…</option></select></label>` : ''}</div>
      ${prods.map((p, i) => { const inL = lists.find(l => l.id === (c.lastList || (lists[0] || {}).id)); const has = inL && inL.items.some(x => x.sku === p.sku);
        return `<div class="nprod">${p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : '<span class="nph"></span>'}<div style="min-width:0"><div class="ellipsis t">${esc(p.name || p.store + ' product')}</div><div class="small muted"><span class="mono">${esc(p.store === 'Target' ? 'TCIN ' : p.store + ' ')}${esc(p.sku)}</span> <button class="ghost sm icopy" data-ncopy="${esc(p.sku)}" title="Copy SKU" aria-label="Copy SKU">⧉</button>${p.url ? ` · <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.store)} ↗</a>` : ''}${p.from === 'match' ? ' · <span class="faint">matched by name</span>' : ''}</div></div>
          ${has ? `<span class="btn-done">✓ In “${esc(inL.name)}”</span>` : `<button class="primary sm" data-nadd="${i}">+ Add to list</button>`}</div>`; }).join('')}</div>` : ''}
    <div class="hstack nacts" style="flex-wrap:wrap;gap:8px;margin-top:14px">
      ${prods.length > 1 ? `<button class="primary" id="nwAddAll">Add all ${prods.length} to a SKU list</button><button id="nwCopy">Copy SKUs</button>` : ''}
      <button id="nwRemind">${rem ? '⏰ ' + esc(fmtDT(new Date(rem.at).toISOString())) : 'Remind me…'}</button>
      <button id="nwSave">${c.saved[it.id] ? '★ Saved' : '☆ Save'}</button>
      <a class="btn" href="${esc(it.link)}" target="_blank" rel="noopener">Open original ↗</a>
    </div>
    <div class="nsrc">Source: ${esc(it.srcName)} · <a href="${esc(it.link)}" target="_blank" rel="noopener">${esc((it.link.match(/^https?:\/\/(?:www\.)?([^/]+)/) || [])[1] || 'link')}</a></div></div>`;
}
async function newsPickList(c) {
  const lists = state.skuLists || (state.skuLists = []);
  let id = $('#nwList') ? $('#nwList').value : (c.lastList || (lists[0] || {}).id);
  if (!id || id === '__new' || !skuListById(id)) {
    const n = await askText('New SKU list', 'Target drops', { ok: 'Make list' }); if (!n || !n.trim()) return null;
    const l = newSkuList(n.trim(), 'Target'); lists.push(l); id = l.id;
  }
  c.lastList = id; return skuListById(id);
}
function newsAddToList(l, prods) {
  const have = new Set(l.items.map(i => i.sku)), fresh = prods.filter(p => !have.has(p.sku));
  fresh.forEach(p => l.items.push({ id: uid(), sku: p.sku, url: p.url || '', store: p.store !== l.store ? p.store : '', qty: 1, name: p.name || '', image: p.img ? p.img.replace(/\?.*$/, '') : '', notes: '', addedAt: Date.now() }));
  skuTouch(l); save();
  toast(fresh.length ? `Added ${plural(fresh.length, 'SKU')} to “${l.name}”` : `Already in “${l.name}”`, { action: fresh.length ? 'Open list' : '', onAction: () => { SK.list = l.id; go('skus'); } });
  if (fresh.length && typeof skuLookupAll === 'function') skuLookupAll(l);
}
async function newsRemind(it) {
  const c = newsCfg(), cur = c.reminders.find(r => r.id === it.id && !r.done);
  const d = new Date(Date.now() + 3600000); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const pad = n => String(n).padStart(2, '0'), def = cur ? new Date(cur.at) : d;
  const v = await askText('Remind me at', `${def.getFullYear()}-${pad(def.getMonth() + 1)}-${pad(def.getDate())} ${pad(def.getHours())}:${pad(def.getMinutes())}`, { ok: cur ? 'Change reminder' : 'Set reminder', placeholder: 'YYYY-MM-DD HH:MM' });
  if (v == null) return;
  if (!v.trim()) { c.reminders = c.reminders.filter(r => r !== cur); save(); toast('Reminder removed'); return; }
  const m = v.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/);
  const at = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : NaN;
  if (!at || at < Date.now() - 60000) { toast('Type a time that’s still coming, like ' + `${def.getFullYear()}-${pad(def.getMonth() + 1)}-${pad(def.getDate())} 01:45`); return; }
  c.reminders = c.reminders.filter(r => r !== cur); c.reminders.push({ id: it.id, at, done: false });
  if (!c.saved[it.id]) c.saved[it.id] = newsSlim(it);
  save(); toast('⏰ Reminder set for ' + fmtDT(new Date(at).toISOString()));
}
const newsSlim = it => ({ id: it.id, src: it.src, srcName: it.srcName, title: it.title, link: it.link, date: it.date, text: String(it.text || '').slice(0, 4000), image: it.image, skus: it.skus, kind: it.kind, tcg: it.tcg, savedAt: Date.now() });
function newsSourcesHtml() {
  const c = newsCfg(), st = new Map(NW.sources.map(s => [s.id, s]));
  const b = (NW.builtin.length ? NW.builtin : NW.sources.filter(s => !String(s.id).startsWith('c-'))).map(s => { const x = st.get(s.id); return `<label class="check nsrcrow"><input type="checkbox" data-nsrc="${esc(s.id)}" ${c.off.includes(s.id) ? '' : 'checked'}> ${esc(s.name)} ${x ? (x.ok ? `<span class="small faint">${plural(x.count, 'story', 'stories')}</span>` : `<span class="small neg">${esc(x.error || 'not answering')}</span>`) : ''}</label>`; }).join('');
  return `<div class="card nsources"><div class="hstack" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><b>News sites</b><label class="small muted hstack" style="gap:6px">Check for news <select id="nwFreq" style="width:auto">${NEWS_FREQ.map(([v, l]) => `<option value="${v}" ${+c.freq === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <div class="nsrcgrid">${b || '<span class="faint small">Refresh once to see the list of sites.</span>'}</div>
    ${c.custom.length ? `<div style="margin-top:8px">${c.custom.map((x, i) => { const r = NW.sources.find(z => z.url === x.url); return `<div class="hstack small" style="gap:6px"><span class="ellipsis">${esc(x.name || x.url)}</span>${r ? (r.ok ? `<span class="faint">${plural(r.count, 'story', 'stories')}</span>` : `<span class="neg">${esc(r.error)}</span>`) : ''}<button class="ghost sm" data-ncdel="${i}">Remove</button></div>`; }).join('')}</div>` : ''}
    <div class="hstack" style="margin-top:8px;gap:6px;flex-wrap:wrap"><input id="nwFeed" placeholder="Add a site’s news feed (RSS) address" style="flex:1;min-width:200px"><button class="sm" id="nwFeedAdd">Add site</button></div>
    <div class="small faint" style="margin-top:6px">Public news feeds only. Articles stay on this device; what you’ve read and saved syncs with your data.</div></div>`;
}
PAGES.news = {
  render() {
    const pg = $('#pg-news'), c = newsCfg();
    if (!NW.items.length && !NW.at) newsLoadCache();
    if (route.arg && newsById(route.arg)) { NW.open = route.arg; }
    const list = newsShown(), phone = isCompact();
    // on a phone, coming back to News shows the headlines again (not the last story you read)
    if (NW.seenHash !== location.hash) { NW.seenHash = location.hash; if (phone && !route.arg) NW.open = ''; }
    if (NW.open && !newsById(NW.open)) NW.open = '';
    if (!NW.open && !phone && list.length) NW.open = list[0].id;
    const cur = NW.open && newsById(NW.open);
    if (cur && !c.read[cur.id]) { c.read[cur.id] = Date.now(); clearTimeout(NW.saveT); NW.saveT = setTimeout(() => { save(); renderNav(); }, 400); }
    const groups = []; for (const i of list.slice(0, 200)) { const d = newsDay(i.date); let g = groups.find(x => x[0] === d); if (!g) groups.push(g = [d, []]); g[1].push(i); }
    const bad = NW.sources.filter(s => !s.ok).length, every = c.freq ? 24 / c.freq : 0;
    const head = `<div class="pagehead"><h1>News</h1><span class="sub">${NW.at ? `From ${plural(NW.sources.filter(s => s.ok).length, 'news site')} · updated ${esc(newsAgo(NW.at))}${every ? ` · checks every ${every >= 24 ? 'day' : every + 'h'}` : ''}` : 'Pokémon news from public news sites'}</span><div class="spacer"></div>
      <button id="nwSrcBtn" class="${NW.showSrc ? 'on' : ''}">Sites & schedule${bad ? ` <span class="neg">· ${bad}</span>` : ''}</button><button class="primary" id="nwRefresh" ${NW.busy || !SERVER ? 'disabled' : ''}>${NW.busy ? 'Checking…' : '↻ Refresh'}</button></div>`;
    const showArt = phone && cur;
    pg.innerHTML = head + (NW.showSrc ? newsSourcesHtml() : '') + (NW.err ? `<div class="note bad" style="margin-bottom:10px">${esc(NW.err)}</div>` : '') + (showArt ? `<button class="ghost" id="nwBack" style="margin-bottom:8px">‹ All news</button><div class="card">${newsArticleHtml(cur)}</div>` : `
      <div class="toolbar"><input class="search" data-search id="nwQ" placeholder="Search news…" value="${esc(NW.q)}"><div class="chips" id="nwChips">${NEWS_FILTERS.map(([k, l]) => `<button class="chip ${NW.filter === k ? 'on' : ''}" data-nf="${k}">${l}</button>`).join('')}</div><span class="spacer"></span>${newsUnread() ? '<button class="sm ghost" id="nwAllRead">Mark all read</button>' : ''}</div>
      ${list.length ? `<div class="nsplit"><div class="nwlist" data-keepscroll>${groups.map(([d, its]) => `<div class="nday">${esc(d)}</div>` + its.map(i => `<button class="nwitem ${i.id === NW.open && !phone ? 'on' : ''} ${c.read[i.id] ? '' : 'nunread'}" data-nid="${esc(i.id)}">${newsTag(i.kind)}<span class="nmain"><span class="t">${esc(i.title)}</span><span class="m">${esc(i.srcName)}${(i.skus || []).length ? ' · ' + plural(i.skus.length, 'SKU') : ''}${c.saved[i.id] ? ' · ★' : ''}</span></span><span class="when">${esc(newsAgo(i.date))}</span></button>`).join('')).join('')}</div>
        ${phone ? '' : `<div class="card nart">${cur ? newsArticleHtml(cur) : '<div class="empty">Pick a story.</div>'}</div>`}</div>`
        : `<div class="empty">${NW.busy ? 'Checking the news sites…' : NW.at ? 'Nothing matches.' : SERVER ? 'No news yet. Hit Refresh to check the news sites.' : 'News needs Kingpin running (the app or Kingpin Online).'}</div>`}`);
    const r = $('#nwRefresh'); if (r) r.onclick = () => newsRefresh(true);
    $('#nwSrcBtn').onclick = () => { NW.showSrc = !NW.showSrc; PAGES.news.render(); };
    if ($('#nwBack')) $('#nwBack').onclick = () => { NW.open = ''; if (route.arg) go('news'); else PAGES.news.render(); };
    if ($('#nwQ')) $('#nwQ').oninput = debounce(e => { NW.q = e.target.value; PAGES.news.render(); }, 200);
    if ($('#nwChips')) $('#nwChips').onclick = e => { const b = e.target.closest('[data-nf]'); if (!b) return; NW.filter = b.dataset.nf; NW.open = ''; PAGES.news.render(); };
    if ($('#nwAllRead')) $('#nwAllRead').onclick = () => { NW.items.forEach(i => { if (!c.read[i.id]) c.read[i.id] = Date.now(); }); save(); renderNav(); PAGES.news.render(); };
    const nl = pg.querySelector('.nwlist'); if (nl) nl.onclick = e => { const b = e.target.closest('[data-nid]'); if (!b) return; NW.open = b.dataset.nid; NW.more = false; if (phone) { $('#main').scrollTop = 0; } PAGES.news.render(); };
    // sites and schedule
    if (NW.showSrc) {
      $('#nwFreq').onchange = e => { c.freq = +e.target.value; save(); PAGES.news.render(); };
      pg.querySelectorAll('[data-nsrc]').forEach(b => b.onchange = () => { const id = b.dataset.nsrc; c.off = b.checked ? c.off.filter(x => x !== id) : c.off.concat(id); save(); });
      pg.querySelectorAll('[data-ncdel]').forEach(b => b.onclick = () => { c.custom.splice(+b.dataset.ncdel, 1); save(); PAGES.news.render(); });
      $('#nwFeedAdd').onclick = () => { const u = $('#nwFeed').value.trim(); if (!/^https?:\/\/\S+\.\S+/.test(u)) { toast('Paste the feed’s web address, starting with https://'); return; } if (c.custom.some(x => x.url === u)) { toast('That site is already on the list'); return; } c.custom.push({ url: u, name: (u.match(/^https?:\/\/(?:www\.)?([^/]+)/) || [])[1] || u, pokeOnly: true }); save(); $('#nwFeed').value = ''; toast('Site added — refreshing'); newsRefresh(true); };
    }
    if (!cur) return;
    const art = pg.querySelector('.narticle'); if (!art) return;
    if ($('#nwMore')) $('#nwMore').onclick = () => { NW.more = true; PAGES.news.render(); };
    if ($('#nwList')) $('#nwList').onchange = async e => { if (e.target.value === '__new') { const l = await newsPickList(c); if (l) save(); } else { c.lastList = e.target.value; save(); } PAGES.news.render(); };
    const prods = newsProducts(cur);
    art.onclick = async e => {
      const cp = e.target.closest('[data-ncopy]'); if (cp) { copyText(cp.dataset.ncopy, 'SKU'); return; }
      const ad = e.target.closest('[data-nadd]'); if (ad) { const l = await newsPickList(c); if (l) { newsAddToList(l, [prods[+ad.dataset.nadd]]); PAGES.news.render(); } }
    };
    if ($('#nwAddAll')) $('#nwAddAll').onclick = async () => { const l = await newsPickList(c); if (l) { newsAddToList(l, prods); PAGES.news.render(); } };
    if ($('#nwCopy')) $('#nwCopy').onclick = () => copyText(prods.map(p => p.sku).join('\n'), plural(prods.length, 'SKU'));
    $('#nwSave').onclick = () => { if (c.saved[cur.id]) delete c.saved[cur.id]; else c.saved[cur.id] = newsSlim(cur); save(); PAGES.news.render(); };
    $('#nwRemind').onclick = async () => { await newsRemind(cur); PAGES.news.render(); };
  },
};
function wireNews() {
  newsLoadCache();
  // leaving News (runs before the page switch draws anything)
  window.addEventListener('hashchange', () => { if (!/^#news\b/.test(location.hash)) NW.seenHash = ''; }, true);
  clearInterval(NW.timer); NW.timer = setInterval(newsTick, 60000);
  setTimeout(newsTick, 4000);
}

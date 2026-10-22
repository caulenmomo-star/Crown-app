/* Crown Tools - Dashboard, Calendar, Spending (+ share card), Inboxes, Settings. */
'use strict';

// second line for dashboard rows: store, where it's going, what it cost
// just a colored dot for the status (name shows on hover / long-press)
function statusDot(st) { const S = STATUS[st] || {}; return `<span class="stdot" style="background:${S.c || 'var(--faint)'}" title="${esc(S.l || st)}" aria-label="${esc(S.l || st)}"></span>`; }
function dashSub(o) { const h = o.houseId && houseById(o.houseId); return [o.total != null ? fmtMoney(o.total) : '', h ? '→ ' + esc(houseLabel(h)) : '', esc(Parser.storeInfo(o.store).label)].filter(Boolean).join(' · '); }
function svgBars(buckets, opts) {
  // buckets: [{label, value, title}]; opts.signed draws losses below a zero line
  const ph = isPhone(), W = ph ? 380 : 900, H = ph ? 200 : 220, P = { l: ph ? 44 : 50, r: 6, t: 10, b: 24 };
  const signed = !!(opts && opts.signed) && buckets.some(b => b.value < 0);
  const nice0 = m => { m = Math.max(1, m); const e = Math.pow(10, Math.floor(Math.log10(m))); const f = m / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; };
  const maxV = nice0(Math.max(0, ...buckets.map(b => b.value))), minV = signed ? nice0(Math.max(0, ...buckets.map(b => -b.value))) : 0;
  const iw = W - P.l - P.r, ih = H - P.t - P.b, bw = iw / Math.max(1, buckets.length);
  const yOf = v => P.t + ih * (maxV - v) / (maxV + minV);
  const every = Math.max(1, Math.ceil(buckets.length / (ph ? 6 : 12)));
  let g = '';
  const ticks = signed ? [-minV, -minV / 2, 0, maxV / 2, maxV] : [0, maxV / 4, maxV / 2, maxV * 3 / 4, maxV];
  for (const v of ticks) { const y = yOf(v); g += `<line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="${v === 0 && signed ? 1.5 : 1}"/><text x="${P.l - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="var(--faint)">${esc((v < 0 ? '−' : '') + fmtMoney(Math.abs(v), true).replace('.00', ''))}</text>`; }
  const y0 = yOf(0);
  buckets.forEach((b, i) => {
    const x = P.l + i * bw, yv = yOf(b.value), top = Math.min(yv, y0), h = Math.abs(y0 - yv);
    const col = b.value < 0 ? 'var(--danger)' : ((opts && opts.color) || 'var(--accent)');
    g += `<rect x="${x + bw * 0.14}" y="${top}" width="${Math.max(1, bw * 0.72)}" height="${Math.max(0, h)}" rx="${Math.min(4, bw * 0.2)}" fill="${col}" opacity="${b.value ? 0.95 : 0}"><title>${esc(b.title || b.label + ': ' + fmtMoney(b.value))}</title></rect>`;
    if (i % every === 0) g += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--faint)">${esc(b.label)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc((opts && opts.label) || 'Chart')}">${g}</svg>`;
}
function hbars(rows, opts) {
  if (!rows.length) return '<div class="empty sm">Nothing yet.</div>';
  const max = Math.max(...rows.map(r => r.v)) || 1;
  return rows.map(r => `<div class="hbar ${r.click ? 'click' : ''}" ${r.attrs || ''} style="${r.attrs ? 'cursor:pointer' : ''}"><div class="nm" title="${esc(r.name)}">${r.html || esc(r.name)}</div><div class="tr"><div class="fl" style="width:${r.v / max * 100}%;background:${r.c || 'var(--accent)'}"></div></div><div class="vl">${(opts && opts.fmt ? opts.fmt(r) : fmtMoney(r.v))}</div></div>`).join('');
}
function greet() { const h = new Date().getHours(); return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }

/* ================= dashboard ================= */
const DASH = (() => { try { return Object.assign({ days: 30, from: '', to: '' }, JSON.parse(localStorage.getItem('crown.dash') || '{}')); } catch (_) { return { days: 30, from: '', to: '' }; } })();
PAGES.dashboard = {
  render() {
    const pg = $('#pg-dashboard'); const now = new Date(); const tk = todayKey();
    const mStart = new Date(now.getFullYear(), now.getMonth(), 1), lmStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const inM = o => { const d = toDate(o.orderDate); return d && d >= mStart; };
    const inLM = o => { const d = toDate(o.orderDate); return d && d >= lmStart && d < mStart && d.getDate() <= now.getDate(); };
    const thisM = state.orders.filter(inM), lastM = state.orders.filter(inLM);
    const spentM = sum(thisM, orderSpend), spentLM = sum(lastM, orderSpend);
    const transit = state.orders.filter(inTransit);
    const d30 = state.orders.filter(o => inRange(o.orderDate, '30'));
    const si30 = stickInfo(d30), stick = si30.rate;
    const soon = state.orders.filter(o => isActive(o) && o.eta && o.eta <= dayKey(new Date(Date.now() + 1 * 864e5)) && o.eta >= tk);
    const upcoming = state.orders.filter(o => isActive(o) && o.eta && o.eta >= tk).sort((a, b) => a.eta.localeCompare(b.eta)).slice(0, 8);
    const overdue = state.orders.filter(o => isActive(o) && o.eta && o.eta < tk && (inTransit(o) || o.status === 'confirmed'));
    const events = state.orders.flatMap(o => (o.history || []).map(h => ({ o, h }))).sort((a, b) => String(b.h.date).localeCompare(String(a.h.date))).slice(0, 9);
    // spending chart: any number of days, or a custom From–To
    let dFrom, dTo;
    if (DASH.from || DASH.to) { dFrom = parseDay(DASH.from) || parseDay(DASH.to); dTo = parseDay(DASH.to) || new Date(now.getFullYear(), now.getMonth(), now.getDate()); if (dFrom > dTo) [dFrom, dTo] = [dTo, dFrom]; }
    else { dTo = new Date(now.getFullYear(), now.getMonth(), now.getDate()); dFrom = new Date(dTo.getFullYear(), dTo.getMonth(), dTo.getDate() - (DASH.days - 1)); }
    const days = []; for (let d = new Date(dFrom); d <= dTo && days.length < 400; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) days.push({ k: dayKey(d), label: (d.getMonth() + 1) + '/' + d.getDate(), value: 0, n: 0 });
    const dIdx = Object.fromEntries(days.map((d, i) => [d.k, i]));
    state.orders.forEach(o => { const d = toDate(o.orderDate); if (!d) return; const i = dIdx[dayKey(d)]; if (i != null) { days[i].value += orderSpend(o); if (!isDead(o)) days[i].n++; } });
    days.forEach(d => d.title = `${d.label}: ${fmtMoney(d.value)} · ${plural(d.n, 'order')}`);
    let bars = days; if (days.length > 120) { bars = []; for (let i = 0; i < days.length; i += 7) { const w = days.slice(i, i + 7); bars.push({ label: w[0].label, value: sum(w, d => d.value), n: sum(w, d => d.n), title: `Week of ${w[0].label}: ${fmtMoney(sum(w, d => d.value))} · ${plural(sum(w, d => d.n), 'order')}` }); } }
    const dLabel = DASH.from || DASH.to ? `${fmtDate(dayKey(dFrom))} – ${fmtDate(dayKey(dTo))}` : DASH.days === 1 ? 'Today' : `Last ${DASH.days} days`;
    const dOrders = sum(days, d => d.n);
    const inSel = state.orders.filter(o => { const d = toDate(o.orderDate); return d && dIdx[dayKey(d)] != null; });
    const dDead = inSel.filter(isDead).length, dItems = sum(inSel.filter(o => !isDead(o)), itemCount);
    const unlinked = state.orders.filter(o => !o.profileId && !isDead(o)).length;
    const noAddr = state.orders.filter(o => !o.houseId && !isDead(o)).length;
    buildDupIndex(); const badProfiles = state.profiles.filter(p => health(p).length).length;
    const badInbox = state.imapAccounts.filter(a => a.enabled !== false && a.lastResult && a.lastResult.error);
    const attention = [
      overdue.length && [`${plural(overdue.length, 'order')} past the expected delivery date`, 'orders', () => { OF.status = 'active'; }],
      unlinked && [`${plural(unlinked, 'order')} not linked to a profile`, 'orders', () => { OF.profile = '__none'; OF.status = 'all'; }],
      noAddr && [`${plural(noAddr, 'order')} without a shipping address (no house)`, 'orders', () => { OF.house = '__none'; OF.status = 'all'; }],
      badProfiles && [`${plural(badProfiles, 'profile')} with issues (expired cards, typos, missing info)`, 'profiles', () => { issuesOnly = true; }],
      ...badInbox.map(a => [`Inbox ${a.label || a.user}: ${a.lastResult.error}`, 'inboxes', null]),
      (() => { const accs = state.imapAccounts.filter(a => a.enabled !== false); if (!accs.length) return false; const last = Math.max(0, ...accs.map(a => a.lastSync || 0)); return Date.now() - last > 3 * 3600e3 && [`Email last checked ${last ? ago(last) : 'never'} — tap to check now`, 'dashboard', () => syncAll(true)]; })(),
      state.unparsed.length && [`${plural(state.unparsed.length, 'order email')} Crown Tools couldn’t read`, 'inboxes', null],
      (() => { const n = suggestedDuplicates().length; return n && [`${plural(n, 'possible duplicate order')} to review`, 'orders', () => setTimeout(() => { cleanTab = 'dupes'; renderCleanup(); openDlg('dlgClean'); }, 50)]; })(),
      (() => { const n = state.orders.filter(isSuspicious).length; return n && [`${plural(n, 'order')} that don’t look like real store orders`, 'orders', () => setTimeout(() => { cleanTab = 'junk'; renderCleanup(); openDlg('dlgClean'); }, 50)]; })(),
    ].filter(Boolean);
    pg.innerHTML = `<div class="pagehead"><h1>${greet()} 👑</h1><span class="sub">${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span><div class="spacer"></div>
      ${state.imapAccounts.length ? `<button id="dSync" ${syncing ? 'disabled' : ''}>${syncing ? 'Syncing…' : 'Sync email now'}</button>` : ''}<button class="primary" data-nav="orders">View orders</button></div>
      ${!state.imapAccounts.length ? `<div class="card" style="margin-bottom:16px;border-color:#2b3863;background:linear-gradient(135deg,#161c33,#141821)"><h3>📬 Connect your email to track orders automatically</h3><div class="muted" style="margin-bottom:12px">Crown Tools reads order confirmations, shipping and delivery emails from Target, Walmart, Pokémon Center, Best Buy and more. It builds your order list, houses, calendar and spending for you — read-only, it never changes your mail.</div><button class="primary" data-nav="inboxes">Connect an inbox</button></div>` : ''}
      <div class="hstack rangebar" style="flex-wrap:wrap;gap:6px;margin-bottom:12px"><span class="small muted">Show</span><div class="chips" id="dDays">${[1, 3, 7, 14, 30, 60, 90, 180, 365].map(n => `<button class="chip ${!DASH.from && !DASH.to && DASH.days === n ? 'on' : ''}" data-dd="${n}">${n === 1 ? 'Today' : n + 'd'}</button>`).join('')}</div>
        <span class="hstack rangeins" style="gap:6px"><input type="number" id="dN" min="1" max="400" placeholder="days" style="width:72px" value="${!DASH.from && !DASH.to && ![1, 3, 7, 14, 30, 60, 90, 180, 365].includes(DASH.days) ? DASH.days : ''}"><input type="date" id="dFrom" style="width:auto" value="${DASH.from || ''}"><span class="faint">to</span><input type="date" id="dTo" style="width:auto" value="${DASH.to || ''}"></span></div>
      <div class="kpis">
        <div class="kpi"><div class="l">Spent · ${esc(dLabel)}</div><div class="v">${fmtMoney(sum(days, d => d.value))}</div><div class="d">This month ${fmtMoney(spentM)}${spentLM ? ' · ' + (spentM >= spentLM ? '▲ ' : '▼ ') + fmtMoney(Math.abs(spentM - spentLM)) + ' vs last' : ''}</div></div>
        <div class="kpi"><div class="l">Orders · ${esc(dLabel)}</div><div class="v">${dOrders}</div><div class="d">${dDead} cancelled · ${dItems} items</div></div>
        <div class="kpi"><div class="l">In transit</div><div class="v">${transit.length}</div><div class="d">${soon.length ? soon.length + ' arriving by tomorrow' : '&nbsp;'}</div></div>
        ${(() => { const si = stickInfo(inSel); return `<div class="kpi"><div class="l">Stick rate · ${esc(dLabel)}</div><div class="v">${si.rate == null ? '—' : si.rate + '%'}</div><div class="d">${inSel.length ? `${si.stuck} shipped · ${si.dead} cancelled${si.pending ? ' · ' + si.pending + ' pending' : ''}` : '&nbsp;'}</div></div>`; })()}
        <div class="kpi"><div class="l">Profiles</div><div class="v">${state.profiles.length}</div><div class="d">${state.categories.length} categories</div></div>
        <div class="kpi"><div class="l">Houses</div><div class="v">${state.houses.filter(h => houseOrders(h.id).length).length}</div><div class="d">&nbsp;</div></div>
        ${(state.inventory || []).length ? (() => { const st = invStats((state.inventory || []).filter(i => (Number(i.qty) || 0) > 0)); return `<div class="kpi click" data-nav="inventory"><div class="l">Inventory</div><div class="v">${fmtMoney(st.value || st.cost, true)}</div><div class="d">${st.units} units${st.priced ? ' · ' + (st.gain >= 0 ? '+' : '−') + fmtMoney(Math.abs(st.gain), true) : ''}</div></div>`; })() : ''}
        ${(state.sales || []).length ? (() => { const m0 = dayKey(new Date(now.getFullYear(), now.getMonth(), 1)); const ss = state.sales.filter(x => x.date >= m0), ex = (state.expenses || []).filter(x => x.date >= m0); const p = sum(ss, saleProfit) - sum(ex, x => x.amount); return `<div class="kpi click" data-nav="sales"><div class="l">Profit this month</div><div class="v ${p >= 0 ? 'pos' : 'neg'}">${p >= 0 ? '' : '−'}${fmtMoney(Math.abs(p), true)}</div><div class="d">${plural(ss.length, 'sale')}</div></div>`; })() : ''}
      </div>
      <div class="cols2" style="margin-bottom:14px">
        <div class="card"><h3>Upcoming deliveries<span class="spacer"></span><button class="ghost sm" data-nav="calendar">Calendar ›</button></h3>
          ${upcoming.length ? `<div class="list">${upcoming.map(o => `<div class="li click dli" data-order="${o.id}">${thumb(orderImage(o), 'sm')}<div class="mmain"><div class="t2" title="${esc(orderTitle(o))}">${esc(shortTitle(o)) || '#' + esc(o.orderNumber)}</div><div class="small muted ellipsis">${dashSub(o)}</div></div><div class="dright"><b>${fmtDate(o.eta, { weekday: true })}</b><div class="small faint">${statusDot(o.status)}${relDay(o.eta)}</div></div></div>`).join('')}</div>` : '<div class="empty sm">Nothing on the way with a delivery date.</div>'}</div>
        <div class="card"><h3>Recent activity</h3>
          ${events.length ? `<div class="list">${events.map(({ o, h }) => `<div class="li click dli" data-order="${o.id}">${thumb(orderImage(o), 'sm')}<div class="mmain"><div class="t2" title="${esc(orderTitle(o))}">${esc(shortTitle(o)) || '#' + esc(o.orderNumber)}</div><div class="small muted ellipsis">${dashSub(o)}</div></div><div class="dright"><div class="small faint nowrap">${statusDot(h.status)}${fmtDT(h.date)}</div></div></div>`).join('')}</div>` : '<div class="empty sm">No activity yet.</div>'}</div>
      </div>
      <div class="cols2">
        <div class="card"><h3>Spending · ${esc(dLabel)}<span class="spacer"></span><span class="muted" style="font-weight:400">${fmtMoney(sum(days, d => d.value))} · ${plural(dOrders, 'order')}</span><button class="ghost sm" data-nav="spending">Details ›</button></h3>
          ${svgBars(bars)}</div>
        <div class="card"><h3>Needs attention</h3>${attention.length ? `<div class="list">${attention.map((a, i) => `<div class="li click" data-att="${i}"><span class="warnicon">⚠</span><div style="flex:1">${esc(a[0])}</div><span class="faint">›</span></div>`).join('')}</div>` : '<div class="empty sm">All clear. 👑</div>'}</div>
      </div>`;
    if ($('#dSync')) $('#dSync').onclick = () => syncAll(true);
    const dsave = () => { try { localStorage.setItem('crown.dash', JSON.stringify(DASH)); } catch (_) { } PAGES.dashboard.render(); };
    $('#dDays').onclick = e => { const b = e.target.closest('[data-dd]'); if (b) { DASH.days = +b.dataset.dd; DASH.from = DASH.to = ''; dsave(); } };
    $('#dN').onchange = e => { const n = Math.round(+e.target.value); if (n >= 1 && n <= 400) { DASH.days = n; DASH.from = DASH.to = ''; dsave(); } };
    $('#dFrom').onchange = $('#dTo').onchange = () => { DASH.from = $('#dFrom').value; DASH.to = $('#dTo').value; dsave(); };
    pg.querySelectorAll('[data-att]').forEach(el => el.onclick = () => { const a = attention[+el.dataset.att]; if (a[2]) a[2](); go(a[1]); });
  },
};

/* ================= calendar ================= */
const CAL = { y: new Date().getFullYear(), m: new Date().getMonth(), sel: todayKey(), show: { eta: true, del: true, plc: true } };
function calIndex() {
  const idx = {}; const add = (k, t, o) => { if (!k) return; (idx[k] = idx[k] || { eta: [], del: [], plc: [] })[t].push(o); };
  state.orders.forEach(o => {
    if (o.orderDate) add(dayKey(toDate(o.orderDate)), 'plc', o);
    if (o.status === 'delivered') add(o.deliveredAt ? dayKey(toDate(o.deliveredAt)) : o.eta, 'del', o);
    else if (!isDead(o) && o.eta) add(o.eta, 'eta', o);
  });
  return idx;
}
PAGES.calendar = {
  render() {
    const pg = $('#pg-calendar'); const idx = calIndex(); const tk = todayKey();
    const first = new Date(CAL.y, CAL.m, 1); const start = new Date(CAL.y, CAL.m, 1 - first.getDay());
    const cells = []; for (let i = 0; i < 42; i++) cells.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    const monthOrders = state.orders.filter(o => { const d = toDate(o.orderDate); return d && d.getFullYear() === CAL.y && d.getMonth() === CAL.m; });
    const sel = idx[CAL.sel] || { eta: [], del: [], plc: [] };
    pg.innerHTML = `<div class="pagehead"><h1>Calendar</h1><span class="sub">${plural(monthOrders.filter(o => !isDead(o)).length, 'order')} · ${fmtMoney(sum(monthOrders, orderSpend))} this month</span></div>
      <div class="calnav"><button id="cPrev" aria-label="Previous month">‹</button><b class="calmonth">${first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</b><button id="cNext" aria-label="Next month">›</button><button id="cToday">Today</button><div class="spacer"></div>
      <div class="chips"><button class="chip ${CAL.show.eta ? 'on' : ''}" data-cs="eta">Arriving</button><button class="chip ${CAL.show.del ? 'on' : ''}" data-cs="del">Delivered</button><button class="chip ${CAL.show.plc ? 'on' : ''}" data-cs="plc">Ordered</button></div></div>
      <div class="calhead">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div>${d}</div>`).join('')}</div>
      <div class="calgrid">${cells.map(d => { const k = dayKey(d); const e = idx[k] || { eta: [], del: [], plc: [] }; return `<div class="day ${d.getMonth() !== CAL.m ? 'out' : ''} ${k === tk ? 'today' : ''} ${k === CAL.sel ? 'sel' : ''}" data-day="${k}"><div class="dn">${d.getDate()}</div>
        ${CAL.show.eta && e.eta.length ? `<div class="ev eta" title="${e.eta.length} arriving"><span class="evi">📦</span> <b>${e.eta.length}</b><span class="evl"> arriving</span></div>` : ''}${CAL.show.del && e.del.length ? `<div class="ev del" title="${e.del.length} delivered"><span class="evi">✓</span> <b>${e.del.length}</b><span class="evl"> delivered</span></div>` : ''}${CAL.show.plc && e.plc.length ? `<div class="ev plc" title="${e.plc.length} ordered"><span class="evi">🛒</span> <b>${e.plc.length}</b><span class="evl"> · ${fmtMoney(sum(e.plc, orderSpend), true)}</span></div>` : ''}</div>`; }).join('')}</div>
      <div class="card" style="margin-top:14px"><h3>${fmtDate(CAL.sel, { weekday: true, year: true })} <span class="faint" style="font-weight:400">${relDay(CAL.sel)}</span></h3>
        ${[['Arriving', sel.eta], ['Delivered', sel.del], ['Ordered', sel.plc]].filter(([, l]) => l.length).map(([t, l]) => `<div class="section">${t} (${l.length})</div>${orderMiniList(l)}`).join('') || '<div class="empty sm">Nothing on this day.</div>'}</div>`;
    const mv = d => { const n = new Date(CAL.y, CAL.m + d, 1); CAL.y = n.getFullYear(); CAL.m = n.getMonth(); PAGES.calendar.render(); };
    $('#cPrev').onclick = () => mv(-1); $('#cNext').onclick = () => mv(1);
    $('#cToday').onclick = () => { const n = new Date(); CAL.y = n.getFullYear(); CAL.m = n.getMonth(); CAL.sel = todayKey(); PAGES.calendar.render(); };
    pg.querySelectorAll('[data-cs]').forEach(b => b.onclick = () => { CAL.show[b.dataset.cs] = !CAL.show[b.dataset.cs]; PAGES.calendar.render(); });
    pg.querySelector('.calgrid').onclick = e => { const c = e.target.closest('[data-day]'); if (!c) return; CAL.sel = c.dataset.day; const d = parseDay(CAL.sel); if (d.getMonth() !== CAL.m) { CAL.y = d.getFullYear(); CAL.m = d.getMonth(); } PAGES.calendar.render(); };
  },
};

/* ================= spending ================= */
const SP = { range: '30', theme: 'aurora' };
const SP_RANGES = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['year', 'This year'], ['365', '12 months'], ['all', 'All time']];
// A date range is a preset key ('30', 'month', ...), a month 'm:2026-09', or a custom span 'c:2026-09-01:2026-09-30'.
function rangeSpan(spec) {
  const now = new Date();
  if (spec.startsWith('m:')) { const [y, m] = spec.slice(2).split('-').map(Number); return [new Date(y, m - 1, 1), new Date(y, m, 1)]; }
  if (spec.startsWith('c:')) { const [, a, b] = spec.split(':'); const s0 = a ? parseDay(a) : null, e0 = b ? parseDay(b) : null; return [s0, e0 ? new Date(e0.getFullYear(), e0.getMonth(), e0.getDate() + 1) : null]; }
  if (spec === 'today') return [new Date(now.getFullYear(), now.getMonth(), now.getDate()), null];
  if (spec === 'yesterday') return [new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1), new Date(now.getFullYear(), now.getMonth(), now.getDate())];
  return rangeBounds(spec);
}
function rangeLabel(spec) {
  if (spec.startsWith('m:')) { const [y, m] = spec.slice(2).split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); }
  if (spec.startsWith('c:')) {
    const [, a, b] = spec.split(':'); const f = d => parseDay(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return a && b ? (a === b ? f(a) : f(a) + ' – ' + f(b)) : a ? 'Since ' + f(a) : b ? 'Through ' + f(b) : 'All time';
  }
  return { today: 'Today', yesterday: 'Yesterday', 7: 'Last 7 days', 30: 'Last 30 days', 90: 'Last 90 days', month: 'This month', lastmonth: 'Last month', year: 'This year', 365: 'Last 12 months', all: 'All time' }[spec] || spec;
}
function ordersInRange(spec) { const [a, b] = rangeSpan(spec); return state.orders.filter(o => { const d = toDate(o.orderDate); if (!d) return spec === 'all'; return (!a || d >= a) && (!b || d < b); }); }
function spRangeLabel() { return rangeLabel(SP.range); }
function spOrders() { return ordersInRange(SP.range); }
function spStats(list) {
  const live = list.filter(o => !isDead(o)), dead = list.filter(isDead);
  const spent = sum(live, orderSpend);
  const group = (keyFn, nameFn) => { const m = {}; live.forEach(o => { const k = keyFn(o); if (!k) return; const g = m[k] = m[k] || { k, v: 0, n: 0 }; g.v += orderSpend(o); g.n++; }); return Object.values(m).sort((a, b) => b.v - a.v).map(g => Object.assign(g, { name: nameFn(g.k) })); };
  const items = {}; live.forEach(o => (o.items || []).forEach(i => { const q = qtyOf(i); if (!q) return; const k = i.name; const g = items[k] = items[k] || { name: k, qty: 0, v: 0, image: '' }; g.qty += q; g.v += (Number(i.price) || 0) * q; if (!g.image && i.image) g.image = i.image; }));
  const si = stickInfo(list);
  const cardOf = o => { const p = profileById(o.profileId); const l4 = o.last4 || (p && String(p.cardNumber || '').replace(/\D/g, '').slice(-4)); return l4 || ''; };
  return {
    list, live, dead, spent, items: sum(live, itemCount), avg: live.length ? spent / live.length : 0, deadSpent: sum(dead, o => Number(o.total) || 0),
    stick: si.rate, stuck: list.filter(isStuck), pending: list.filter(isPending), pendingSpent: sum(list.filter(isPending), orderSpend), cancelledItems: sum(list, o => isDead(o) ? itemCount(o) + cancelledCount(o) : cancelledCount(o)),
    byStore: group(o => o.store, k => Parser.storeInfo(k).label), byHouse: group(o => o.houseId, k => houseLabel(houseById(k))), byProfile: group(o => o.profileId, k => (profileById(k) || {}).name || 'Untitled'), byCard: group(cardOf, k => '•••• ' + k),
    topItems: Object.values(items).sort((a, b) => b.qty - a.qty || b.v - a.v).slice(0, 8),
  };
}
function spBuckets(list) {
  const ds = list.map(o => toDate(o.orderDate)).filter(Boolean);
  const now = new Date();
  let [start, end] = rangeSpan(SP.range); end = end || new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (!start) start = ds.length ? new Date(Math.min(...ds)) : new Date(now.getFullYear(), now.getMonth(), 1);
  start = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const spanDays = Math.max(1, Math.round((end - start) / 864e5));
  const unit = spanDays <= 62 ? 'day' : spanDays <= 210 ? 'week' : 'month';
  const keyOf = d => unit === 'day' ? dayKey(d) : unit === 'week' ? dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay())) : d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  const buckets = []; const idx = {};
  for (let d = unit === 'week' ? new Date(start.getFullYear(), start.getMonth(), start.getDate() - start.getDay()) : unit === 'month' ? new Date(start.getFullYear(), start.getMonth(), 1) : new Date(start); d < end; d = unit === 'day' ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1) : unit === 'week' ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7) : new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const k = keyOf(d); idx[k] = buckets.length;
    buckets.push({ k, label: unit === 'month' ? d.toLocaleDateString('en-US', { month: 'short' }) + (d.getMonth() === 0 ? " '" + String(d.getFullYear()).slice(2) : '') : (d.getMonth() + 1) + '/' + d.getDate(), value: 0, n: 0 });
    if (buckets.length > 400) break;
  }
  list.forEach(o => { const d = toDate(o.orderDate); if (!d) return; const i = idx[keyOf(d)]; if (i != null) { buckets[i].value += orderSpend(o); if (!isDead(o)) buckets[i].n++; } });
  buckets.forEach(b => b.title = `${unit === 'week' ? 'Week of ' : ''}${b.label}: ${fmtMoney(b.value)} · ${plural(b.n, 'order')}`);
  return { buckets, unit };
}
PAGES.spending = {
  render() {
    const pg = $('#pg-spending'); const list = spOrders(); const s = spStats(list); const { buckets, unit } = spBuckets(list);
    const cardSpec = SHARE.range === 'page' ? SP.range : SHARE.range; const cs = cardSpec === SP.range ? s : spStats(ordersInRange(cardSpec));
    const months = []; const n = new Date(); for (let i = 0; i < 24; i++) { const d = new Date(n.getFullYear(), n.getMonth() - i, 1); months.push([`m:${d.getFullYear()}-${pad2(d.getMonth() + 1)}`, d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })]); }
    pg.innerHTML = `<div class="pagehead"><h1>Spending</h1><span class="sub">${esc(spRangeLabel())}</span><div class="spacer"></div>
      <div class="chips">${SP_RANGES.map(([k, l]) => `<button class="chip ${SP.range === k ? 'on' : ''}" data-sr="${k}">${l}</button>`).join('')}</div>
      <select id="spMonth" style="width:auto"><option value="">Pick a month…</option>${months.map(([k, l]) => `<option value="${k}" ${SP.range === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="hstack" style="gap:6px"><input type="date" id="spFrom" style="width:auto" value="${SP.range.startsWith('c:') ? SP.range.split(':')[1] : ''}" title="From"><span class="faint">to</span><input type="date" id="spTo" style="width:auto" value="${SP.range.startsWith('c:') ? SP.range.split(':')[2] : ''}" title="To"></span></div>
      <div class="kpis">
        <div class="kpi"><div class="l">Spent</div><div class="v">${fmtMoney(s.spent)}</div><div class="d">${s.pending.length ? fmtMoney(s.pendingSpent) + ' still pending · ' : ''}cancelled not counted</div></div>
        <div class="kpi"><div class="l">Orders that stuck</div><div class="v">${s.stuck.length}</div><div class="d">${s.pending.length ? s.pending.length + ' pending · ' : ''}${s.items} items</div></div>
        <div class="kpi"><div class="l">Average order</div><div class="v">${fmtMoney(s.avg)}</div></div>
        <div class="kpi"><div class="l">Stick rate</div><div class="v">${s.stick == null ? '—' : s.stick + '%'}</div><div class="d">${s.dead.length} cancelled (${fmtMoney(s.deadSpent)})${s.cancelledItems ? ' · ' + s.cancelledItems + ' items' : ''}</div></div>
        <div class="kpi"><div class="l">Top store</div><div class="v" style="font-size:19px">${s.byStore[0] ? esc(s.byStore[0].name) : '—'}</div><div class="d">${s.byStore[0] ? fmtMoney(s.byStore[0].v) : '&nbsp;'}</div></div>
      </div>
      <div class="card" style="margin-bottom:14px"><h3>Spent per ${unit}</h3>${svgBars(buckets)}</div>
      <div class="cols2" style="margin-bottom:14px">
        <div class="card"><h3>By store</h3>${hbars(s.byStore.map(g => ({ name: g.name, v: g.v, c: Parser.storeInfo(g.k).color, n: g.n })), { fmt: r => fmtMoney(r.v) + ' · ' + r.n })}</div>
        <div class="card"><h3>By house</h3>${hbars(s.byHouse.slice(0, 10).map(g => ({ name: g.name, v: g.v, n: g.n, attrs: `data-nav="houses/${g.k}"` })), { fmt: r => fmtMoney(r.v) + ' · ' + r.n })}</div>
        <div class="card"><h3>By profile</h3>${hbars(s.byProfile.slice(0, 10).map(g => ({ name: g.name, v: g.v, n: g.n, c: 'var(--ok)' })), { fmt: r => fmtMoney(r.v) + ' · ' + r.n })}</div>
        <div class="card"><h3>By card</h3>${hbars(s.byCard.slice(0, 10).map(g => ({ name: g.name, v: g.v, n: g.n, c: 'var(--gold)' })), { fmt: r => fmtMoney(r.v) + ' · ' + r.n })}</div>
      </div>
      <div class="card" style="margin-bottom:14px"><h3>Top items</h3>${s.topItems.length ? `<div class="list">${s.topItems.map(i => `<div class="li"><div class="badge">${i.qty}×</div><div style="flex:1;min-width:0" class="ellipsis">${esc(i.name)}</div><div class="muted">${i.v ? fmtMoney(i.v) : ''}</div></div>`).join('')}</div>` : '<div class="empty sm">No item details yet.</div>'}</div>
      <div class="card"><h3>Checkout card <span class="faint" style="font-weight:400">— a shareable recap</span></h3>
        <div class="sharewrap"><canvas id="shareCanvas" width="1080" height="1350"></canvas><div>
          <div class="section" style="margin-top:0">Date range</div>
          <div class="chips" id="shRange">${[['page', 'Same as page'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['7', '7 days'], ['30', '30 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['year', 'This year'], ['all', 'All time']].map(([k, l]) => `<button class="chip ${SHARE.range === k ? 'on' : ''}" data-shr="${k}">${l}</button>`).join('')}</div>
          <div class="hstack" style="gap:6px;margin-top:8px"><input type="date" id="shFrom" style="width:auto" value="${SHARE.range.startsWith('c:') ? SHARE.range.split(':')[1] : ''}"><span class="faint">to</span><input type="date" id="shTo" style="width:auto" value="${SHARE.range.startsWith('c:') ? SHARE.range.split(':')[2] : ''}"></div>
          <div class="small faint" style="margin-top:6px">${esc(rangeLabel(cardSpec))} · ${plural(cs.list.length, 'order')}</div>
          <div class="section">Theme</div><div class="chips">${Object.keys(THEMES).map(t => `<button class="chip ${SP.theme === t ? 'on' : ''}" data-th="${t}">${THEMES[t].name}</button>`).join('')}</div>
          <div class="section">Show</div><div class="chips">${[['money', 'Dollar amounts'], ['items', 'Top items'], ['store', 'Top store']].map(([k, l]) => `<button class="chip ${SHARE[k] ? 'on' : ''}" data-sh="${k}">${l}</button>`).join('')}</div>
          <div class="hstack" style="margin-top:16px"><button class="primary" id="shDl">Download PNG</button><button id="shCopy">Copy image</button></div>
          <div class="small faint" style="margin-top:10px">The card never includes addresses, names, emails or card numbers.</div></div></div></div>`;
    pg.querySelector('.pagehead .chips').onclick = e => { const b = e.target.closest('[data-sr]'); if (b) { SP.range = b.dataset.sr; PAGES.spending.render(); } };
    $('#spMonth').onchange = e => { if (e.target.value) { SP.range = e.target.value; PAGES.spending.render(); } };
    pg.querySelectorAll('[data-th]').forEach(b => b.onclick = () => { SP.theme = b.dataset.th; PAGES.spending.render(); });
    pg.querySelectorAll('[data-sh]').forEach(b => b.onclick = () => { SHARE[b.dataset.sh] = !SHARE[b.dataset.sh]; PAGES.spending.render(); });
    drawShareCard($('#shareCanvas'), cs, rangeLabel(cardSpec));
    const custom = (a, b) => { const f = $(a).value, t = $(b).value; if (!f && !t) return null; return 'c:' + (f || '') + ':' + (t || ''); };
    $('#spFrom').onchange = $('#spTo').onchange = () => { const c = custom('#spFrom', '#spTo'); if (c) { SP.range = c; PAGES.spending.render(); } };
    $('#shFrom').onchange = $('#shTo').onchange = () => { const c = custom('#shFrom', '#shTo'); if (c) { SHARE.range = c; PAGES.spending.render(); } };
    $('#shRange').onclick = e => { const b = e.target.closest('[data-shr]'); if (b) { SHARE.range = b.dataset.shr; PAGES.spending.render(); } };
    $('#shDl').onclick = () => { $('#shareCanvas').toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `crown-recap-${stamp()}.png`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }, 'image/png'); };
    $('#shCopy').onclick = () => { $('#shareCanvas').toBlob(async b => { try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); toast('Image copied — paste it into Discord'); } catch (_) { toast('Your browser blocked copying. Use Download instead.'); } }, 'image/png'); };
  },
};
const SHARE = { money: true, items: true, store: true, range: 'page' };
const THEMES = {
  aurora: { name: 'Aurora', bg: ['#0b1020', '#1b1748', '#0d3b3a'], blobs: ['#7c8cff', '#2dd4bf'], accent: '#a5b4fc' },
  ice: { name: 'Ice', bg: ['#07111f', '#0c2d4d', '#0a4f73'], blobs: ['#7dd3fc', '#e0f2fe'], accent: '#bae6fd' },
  nebula: { name: 'Nebula', bg: ['#14051f', '#3b0d5c', '#6b1047'], blobs: ['#c084fc', '#f472b6'], accent: '#f5d0fe' },
  ember: { name: 'Ember', bg: ['#160803', '#4a1607', '#7a2e05'], blobs: ['#fb923c', '#facc15'], accent: '#fde68a' },
  gold: { name: 'Gold', bg: ['#0c0a05', '#231b07', '#3a2b08'], blobs: ['#f5c451', '#fff3c4'], accent: '#f5c451' },
  mono: { name: 'Mono', bg: ['#0a0a0a', '#151515', '#222222'], blobs: ['#9ca3af', '#4b5563'], accent: '#e5e7eb' },
};
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function fitFont(ctx, text, maxW, weight, size, F) { let s = size; ctx.font = `${weight} ${s}px ${F}`; while (s > 18 && ctx.measureText(String(text)).width > maxW) { s -= 2; ctx.font = `${weight} ${s}px ${F}`; } return s; }
function fitText(ctx, text, maxW) { text = String(text); if (ctx.measureText(text).width <= maxW) return text; while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1); return text + '…'; }
function drawShareCard(cv, s, label) {
  const ctx = cv.getContext('2d'); const W = cv.width, H = cv.height; const T = THEMES[SP.theme] || THEMES.aurora;
  const F = '-apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, "Segoe UI", sans-serif';
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, T.bg[0]); g.addColorStop(0.55, T.bg[1]); g.addColorStop(1, T.bg[2]); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  [[W * 0.85, H * 0.12, 520, T.blobs[0]], [W * 0.1, H * 0.78, 600, T.blobs[1]]].forEach(([x, y, r, c]) => { const rg = ctx.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, c + '55'); rg.addColorStop(1, c + '00'); ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H); });
  ctx.fillStyle = '#f5c451'; ctx.save(); ctx.translate(80, 86); ctx.scale(2.6, 2.6); ctx.beginPath(); ctx.moveTo(3, 18); ctx.lineTo(21, 18); ctx.lineTo(22, 7); ctx.lineTo(16.5, 11); ctx.lineTo(12, 4); ctx.lineTo(7.5, 11); ctx.lineTo(2, 7); ctx.closePath(); ctx.fill(); ctx.fillRect(3, 19.5, 18, 2); ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.font = `700 34px ${F}`; ctx.textBaseline = 'alphabetic'; ctx.fillText('CHECKOUT RECAP', 160, 132);
  ctx.fillStyle = T.accent; ctx.font = `500 30px ${F}`; ctx.fillText(label || spRangeLabel(), 80, 230);
  const big = SHARE.money ? fmtMoney(s.spent, s.spent >= 100000) : String(s.live.length);
  ctx.fillStyle = '#fff'; fitFont(ctx, big, W - 160, 800, SHARE.money ? 150 : 170, F); ctx.fillText(big, 72, 392);
  ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = `500 34px ${F}`; ctx.fillText(SHARE.money ? 'spent · cancellations not counted' : (s.live.length === 1 ? 'order secured' : 'orders secured'), 80, 470);
  const boxes = [[SHARE.money ? String(s.live.length) : String(s.items), SHARE.money ? 'Orders' : 'Items'], [s.stick == null ? '—' : s.stick + '%', 'Stick rate'], [SHARE.money ? USD0.format(Math.round(s.avg)) : String(s.dead.length), SHARE.money ? 'Avg order' : 'Cancelled'], [String(s.items), 'Items']].slice(0, SHARE.money ? 4 : 3);
  const bw = (W - 160 - (boxes.length - 1) * 24) / boxes.length;
  boxes.forEach(([v, l], i) => { const x = 80 + i * (bw + 24), y = 520; ctx.fillStyle = 'rgba(255,255,255,.08)'; rr(ctx, x, y, bw, 170, 26); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = '#fff'; fitFont(ctx, v, bw - 48, 750, 56, F); ctx.fillText(v, x + 26, y + 92); ctx.fillStyle = 'rgba(255,255,255,.65)'; ctx.font = `500 26px ${F}`; ctx.fillText(l, x + 26, y + 138); });
  let y = 770;
  if (SHARE.store && s.byStore[0]) { ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = `600 24px ${F}`; ctx.fillText('TOP STORE', 80, y); y += 56; ctx.fillStyle = Parser.storeInfo(s.byStore[0].k).color; ctx.beginPath(); ctx.arc(96, y - 14, 14, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = `700 44px ${F}`; ctx.fillText(s.byStore[0].name + '  ·  ' + plural(s.byStore[0].n, 'order'), 128, y); y += 74; }
  if (SHARE.items && s.topItems.length) { ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = `600 24px ${F}`; ctx.fillText('TOP ITEMS', 80, y); y += 50; s.topItems.slice(0, 4).forEach(it => { if (y > H - 150) return; ctx.fillStyle = T.accent; ctx.font = `700 34px ${F}`; ctx.fillText(it.qty + '×', 80, y); ctx.fillStyle = '#fff'; ctx.font = `500 34px ${F}`; ctx.fillText(fitText(ctx, it.name, W - 260), 160, y); y += 54; }); }
  ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.font = `500 24px ${F}`; ctx.fillText('Made with Crown Tools · ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), 80, H - 70);
}

/* ================= inboxes ================= */
const PROVIDERS = {
  gmail: { name: 'Gmail', host: 'imap.gmail.com', port: 993, folder: '[Gmail]/All Mail', help: 'Gmail needs an <b>App Password</b>, not your normal password. Turn on 2-Step Verification, then create one at <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">myaccount.google.com/apppasswords</a>. Paste the 16 letters below.' },
  icloud: { name: 'iCloud', host: 'imap.mail.me.com', port: 993, folder: 'INBOX', help: 'iCloud needs an <b>app-specific password</b>. Create one at <a href="https://account.apple.com" target="_blank" rel="noopener">account.apple.com</a> → Sign-In and Security → App-Specific Passwords. Use your full @icloud.com address. Hide My Email relays work — they all land in this inbox.' },
  yahoo: { name: 'Yahoo', host: 'imap.mail.yahoo.com', port: 993, folder: 'INBOX', help: 'Yahoo needs an <b>app password</b>: Account Info → Account Security → Generate app password.' },
  outlook: { name: 'Outlook / Hotmail', host: 'outlook.office365.com', port: 993, folder: 'INBOX', help: 'Microsoft is phasing out password sign-in for IMAP. If the test fails, set Outlook to forward order emails to a Gmail or iCloud inbox and connect that instead.' },
  aol: { name: 'AOL', host: 'imap.aol.com', port: 993, folder: 'INBOX', help: 'AOL needs an <b>app password</b>: Account Security → Generate app password.' },
  zoho: { name: 'Zoho', host: 'imap.zoho.com', port: 993, folder: 'INBOX', help: 'Use your Zoho address. If you use 2-factor sign-in, create an app-specific password in Zoho Accounts → Security.' },
  privateemail: { name: 'Namecheap Private Email', host: 'mail.privateemail.com', port: 993, folder: 'INBOX', help: 'Great for catch-all domains. Use the mailbox address and its password.' },
  other: { name: 'Other', host: '', port: 993, folder: 'INBOX', help: 'Enter your provider’s IMAP server details (usually in their help pages under “IMAP settings”).' },
};
const LOOKBACKS = [14, 30, 60, 90, 180, 365];
let inboxEdit = null, inboxFolders = null;
function openInbox(id) {
  const a = id && state.imapAccounts.find(x => x.id === id);
  inboxEdit = a ? Object.assign({}, a) : { id: uid(), provider: 'gmail', label: '', host: PROVIDERS.gmail.host, port: 993, ssl: true, user: '', pass: '', folder: PROVIDERS.gmail.folder, lookback: state.settings.firstLookback || 60, enabled: true, lastSync: 0, lastResult: null, createdAt: Date.now(), _new: true };
  inboxFolders = null; $('#inboxTitle').textContent = a ? 'Edit inbox' : 'Add inbox'; $('#inboxStatus').innerHTML = '';
  renderInboxDlg(); openDlg('dlgInbox');
}
function renderInboxDlg() {
  const a = inboxEdit, P = PROVIDERS[a.provider] || PROVIDERS.other;
  const folders = inboxFolders ? inboxFolders.map(f => f.name) : Array.from(new Set(['INBOX', a.folder, P.folder].filter(Boolean)));
  $('#inboxBody').innerHTML = `<div class="section" style="margin-top:0">Provider</div><div class="chips" id="ibProv">${Object.entries(PROVIDERS).map(([k, p]) => `<button class="chip ${a.provider === k ? 'on' : ''}" data-p="${k}">${p.name}</button>`).join('')}</div>
    <div class="note">${P.help}</div>
    <div class="fgrid" style="margin-top:14px">
      <div class="s2"><label>Email address</label><input id="ibUser" type="email" autocomplete="off" value="${esc(a.user)}" placeholder="you@example.com"></div>
      <div class="s2"><label>App password</label><input id="ibPass" type="password" autocomplete="new-password" value="${esc(a.pass)}" placeholder="${a.pass ? '' : 'paste it here'}"></div>
      <div class="s2"><label>Nickname (optional)</label><input id="ibLabel" value="${esc(a.label)}" placeholder="e.g. Catch-all, Main Gmail"></div>
      <div class="s2"><label>Folder to read ${inboxFolders ? '' : '<span class="faint">— test the connection to list all folders</span>'}</label><select id="ibFolder">${folders.map(f => `<option ${f === a.folder ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select></div>
    </div>
    <div class="section">On the first sync, look back</div><div class="chips" id="ibLook">${LOOKBACKS.map(d => `<button class="chip ${a.lookback === d ? 'on' : ''}" data-d="${d}">${d} days</button>`).join('')}</div>
    <details style="margin-top:14px" ${a.provider === 'other' ? 'open' : ''}><summary class="small muted" style="cursor:pointer">Server settings</summary>
      <div class="fgrid" style="margin-top:10px"><div class="s2"><label>IMAP server</label><input id="ibHost" value="${esc(a.host)}" placeholder="imap.example.com"></div><div><label>Port</label><input id="ibPort" inputmode="numeric" value="${esc(a.port)}"></div><div><label>&nbsp;</label><label class="check"><input type="checkbox" id="ibSsl" ${a.ssl !== false ? 'checked' : ''}> Use SSL</label></div></div></details>
    <div class="small faint" style="margin-top:12px">Crown Tools only reads mail (it never marks anything read, moves or deletes it). Your password is stored encrypted with the rest of your data and is only ever sent to your mail provider.</div>`;
  $('#ibProv').onclick = e => { const b = e.target.closest('[data-p]'); if (!b) return; collectInbox(); const p = PROVIDERS[b.dataset.p]; Object.assign(inboxEdit, { provider: b.dataset.p, host: p.host || inboxEdit.host, port: p.port, ssl: true, folder: p.folder }); inboxFolders = null; renderInboxDlg(); };
  $('#ibLook').onclick = e => { const b = e.target.closest('[data-d]'); if (!b) return; collectInbox(); inboxEdit.lookback = +b.dataset.d; renderInboxDlg(); };
}
function collectInbox() {
  const a = inboxEdit; if (!$('#ibUser')) return a;
  a.user = $('#ibUser').value.trim(); a.pass = $('#ibPass').value.replace(/\s+/g, a.provider === 'gmail' ? '' : ' ').trim(); a.label = $('#ibLabel').value.trim(); a.folder = $('#ibFolder').value;
  a.host = $('#ibHost').value.trim(); a.port = Number($('#ibPort').value) || 993; a.ssl = $('#ibSsl').checked; return a;
}
const accPayload = a => ({ host: a.host, port: a.port, ssl: a.ssl !== false, user: a.user, pass: a.pass, folder: a.folder || 'INBOX', gmail: a.provider === 'gmail' });
$('#inboxTest').onclick = async () => {
  const a = collectInbox(); const st = $('#inboxStatus');
  if (!SERVER) { st.innerHTML = '<span style="color:var(--danger)">Open Crown Tools with Start Crown Tools to connect email.</span>'; return; }
  if (!a.user || !a.pass || !a.host) { st.innerHTML = '<span style="color:var(--danger)">Fill in the email, app password and server first.</span>'; return; }
  st.innerHTML = '<span class="muted">Connecting…</span>'; $('#inboxTest').disabled = true;
  try {
    const f = await api('/api/imap/folders', { account: accPayload(a) });
    inboxFolders = f.folders;
    if (!inboxFolders.some(x => x.name === a.folder)) a.folder = (inboxFolders.find(x => x.special === 'all') || inboxFolders.find(x => x.name.toUpperCase() === 'INBOX') || inboxFolders[0] || { name: 'INBOX' }).name;
    renderInboxDlg();
    await api('/api/imap/test', { account: accPayload(a) });
    $('#inboxStatus').innerHTML = `<span style="color:var(--ok)">✓ Connected — ${plural(inboxFolders.length, 'folder')} found</span>`;
  } catch (e) { $('#inboxStatus').innerHTML = `<span style="color:var(--danger)">${esc(e.message)}</span>`; }
  finally { $('#inboxTest').disabled = false; }
};
$('#inboxSave').onclick = () => {
  const a = collectInbox();
  if (!a.user || !a.pass) { $('#inboxStatus').innerHTML = '<span style="color:var(--danger)">Enter the email address and app password.</span>'; return; }
  if (!a.host) { $('#inboxStatus').innerHTML = '<span style="color:var(--danger)">Enter the IMAP server under Server settings.</span>'; return; }
  const isNew = !!a._new; delete a._new;
  const i = state.imapAccounts.findIndex(x => x.id === a.id);
  if (i >= 0) { const old = state.imapAccounts[i]; if (old.user !== a.user || old.folder !== a.folder || old.host !== a.host) { a.lastSync = 0; a.lastUid = 0; a.uidValidity = ''; } state.imapAccounts[i] = a; } else state.imapAccounts.push(a);
  closeDlg('dlgInbox'); save(); refresh(); toast(isNew ? 'Inbox added — syncing now' : 'Inbox saved');
  if (isNew && SERVER) syncAll(true, [a.id]);
};
PAGES.inboxes = {
  render() {
    const pg = $('#pg-inboxes'); const S = state.settings;
    pg.innerHTML = `<div class="pagehead"><h1>Inboxes</h1><span class="sub">Crown Tools reads order emails from these and keeps your orders up to date</span><div class="spacer"></div>
      ${state.imapAccounts.length ? `<button id="ibReread" ${syncing || rereading || !SERVER ? 'disabled' : ''} title="Re-read every order email and refill totals, items, pictures, addresses and houses">${rereading ? 'Re-reading…' : 'Re-read all order emails'}</button><button id="ibSyncAll" ${syncing || !SERVER ? 'disabled' : ''}>${syncing ? 'Syncing…' : 'Sync all now'}</button>` : ''}<button class="primary" id="ibAdd">+ Add inbox</button></div>
      ${!SERVER ? '<div class="note bad" style="margin:0 0 14px">Email sync needs Crown Tools’ helper. Close this tab and open Crown Tools with <b>Start Crown Tools</b>.</div>' : ''}
      <div class="card" style="margin-bottom:14px"><h3>Automatic sync</h3><div class="chips" id="ibAuto">${[[0, 'Only when I open it'], [1, 'Every minute'], [2, 'Every 2 min'], [5, 'Every 5 min'], [15, 'Every 15 min'], [30, 'Every 30 min']].map(([v, l]) => `<button class="chip ${S.autoSyncMin === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div><div class="small faint" style="margin-top:8px">Crown Tools always checks your email when you open it or come back to it, then on this schedule while it’s open.${syncNextAt && S.autoSyncMin ? ' Next sync ' + new Date(syncNextAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + '.' : ''}</div></div>
      ${state.imapAccounts.length ? `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(340px,1fr));margin-bottom:14px">${state.imapAccounts.map(a => { const r = a.lastResult; const busy = syncingIds.has(a.id); const P = PROVIDERS[a.provider] || PROVIDERS.other; return `<div class="card">
        <h3><span class="dot ${busy ? 'busy' : a.enabled === false ? '' : r && r.error ? 'bad' : a.lastSync ? 'ok' : 'warn'}"></span><span class="ellipsis">${esc(a.label || a.user)}</span><span class="spacer"></span><span class="badge">${esc(P.name)}</span></h3>
        <div class="small muted">${esc(a.user)} · ${esc(a.folder || 'INBOX')}</div>
        <div class="small" style="margin-top:8px">${busy ? '<span style="color:var(--info)">Syncing…' + (syncProgress[a.id] ? ' ' + esc(syncProgress[a.id]) : '') + '</span>' : a.enabled === false ? '<span class="faint">Paused</span>' : r && r.error ? `<span style="color:var(--danger)">${esc(r.error)}</span>` : a.lastSync ? `Last sync ${ago(a.lastSync)} · ${plural(r.found || 0, 'order email')} read · ${r.created || 0} new · ${r.updated || 0} updated` : '<span class="faint">Not synced yet</span>'}</div>
        <div class="hstack" style="margin-top:12px"><button class="sm" data-ia="sync" data-id="${a.id}" ${busy || !SERVER ? 'disabled' : ''}>Sync now</button><select class="sm" data-ia="rescan" data-id="${a.id}" style="width:auto;padding:4px 8px;font-size:12px" ${busy || !SERVER ? 'disabled' : ''}><option value="">Rescan…</option>${LOOKBACKS.map(d => `<option value="${d}">Last ${d} days</option>`).join('')}</select><button class="sm" data-ia="edit" data-id="${a.id}">Edit</button><button class="sm" data-ia="toggle" data-id="${a.id}">${a.enabled === false ? 'Resume' : 'Pause'}</button><button class="sm danger" data-ia="del" data-id="${a.id}">Remove</button></div></div>`; }).join('')}</div>`
        : `<div class="card" style="margin-bottom:14px"><div class="empty">No inboxes yet. Add the inbox your order emails go to — Gmail, iCloud (including Hide My Email), Yahoo, catch-all domains and more.</div></div>`}
      <div class="cols2">
        <div class="card"><h3>Emails Crown Tools couldn’t read <span class="badge">${state.unparsed.length}</span><span class="spacer"></span>${state.unparsed.length ? '<button class="sm ghost" id="ibClearUn">Clear</button>' : ''}</h3>
          ${state.unparsed.length ? `<div class="small muted" style="margin-bottom:8px">These looked like order emails but had no order number Crown Tools could find. If a store’s emails keep landing here, send a sample to Claude so the reader can be tuned.</div><div class="list">${state.unparsed.slice(0, 40).map(u => `<div class="li"><div style="flex:1;min-width:0"><div class="ellipsis">${esc(u.subject)}</div><div class="small faint ellipsis">${esc(u.from)} · ${fmtDT(u.date)}</div></div><button class="sm" data-unhide="${esc(u.messageId)}">Hide</button><button class="sm" data-unign="${esc(Parser.senderKey(u.from))}" ${Parser.senderKey(u.from) ? '' : 'disabled'}>Ignore sender</button></div>`).join('')}</div>` : '<div class="empty sm">Nothing here. 👑</div>'}</div>
        <div class="card"><h3>Sync log</h3>${state.syncLog.length ? `<div class="list">${state.syncLog.slice(0, 25).map(l => `<div class="li"><span class="dot ${l.error ? 'bad' : 'ok'}"></span><div style="flex:1;min-width:0" class="small"><div class="ellipsis">${esc(l.label)}: ${l.error ? esc(l.error) : `${plural(l.found, 'email')} read · ${l.created} new · ${l.updated} updated`}</div><div class="faint">${fmtDT(l.at)}</div></div></div>`).join('')}</div>` : '<div class="empty sm">No syncs yet.</div>'}</div>
      </div>`;
    $('#ibAdd').onclick = () => openInbox(null);
    if ($('#ibSyncAll')) $('#ibSyncAll').onclick = () => syncAll(true);
    if ($('#ibReread')) $('#ibReread').onclick = async () => { if (await ask('Re-read every order email from your inboxes?\n\nThis refills totals, items, pictures, addresses and houses for all your orders. It can take a few minutes.')) { rereadAll(false); setTimeout(() => PAGES.inboxes.render(), 300); } };
    $('#ibAuto').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; state.settings.autoSyncMin = +b.dataset.v; save(); scheduleSync(); PAGES.inboxes.render(); };
    if ($('#ibClearUn')) $('#ibClearUn').onclick = () => { state.unparsed = []; save(); refresh(); };
    pg.querySelectorAll('[data-unhide]').forEach(b => b.onclick = () => { state.unparsed = state.unparsed.filter(u => u.messageId !== b.dataset.unhide); save(); refresh(); });
    pg.querySelectorAll('[data-unign]').forEach(b => b.onclick = () => { const k = b.dataset.unign; if (!k) return; state.settings.ignoredSenders = Array.from(new Set([...(state.settings.ignoredSenders || []), k])); state.unparsed = state.unparsed.filter(u => Parser.senderKey(u.from) !== k); save(); refresh(); toast('Emails from ' + k + ' will be ignored'); });
    pg.querySelectorAll('[data-ia]').forEach(el => {
      const id = el.dataset.id, a = state.imapAccounts.find(x => x.id === id);
      if (el.dataset.ia === 'rescan') { el.onchange = () => { const d = +el.value; if (!d) return; rescan(id, d); }; return; }
      el.onclick = async () => {
        if (el.dataset.ia === 'sync') syncAll(true, [id]);
        else if (el.dataset.ia === 'edit') openInbox(id);
        else if (el.dataset.ia === 'toggle') { a.enabled = a.enabled === false; save(); refresh(); }
        else if (el.dataset.ia === 'del') { if (!await ask(`Remove ${a.label || a.user}? Orders already found stay in Crown Tools.`)) return; state.imapAccounts = state.imapAccounts.filter(x => x.id !== id); save(); refresh(); }
      };
    });
  },
};

/* ================= settings ================= */
let serverInfo = null;
PAGES.settings = {
  async render() {
    const pg = $('#pg-settings'); const S = state.settings;
    const trackAll = !S.trackedStores || !S.trackedStores.length;
    pg.innerHTML = `<div class="pagehead"><h1>Settings</h1></div>
      ${CLOUD && typeof Account !== 'undefined' ? Account.card() : ''}
      <div class="cols2">
        <div class="card"><h3>Security</h3>
          <div class="small muted" style="margin-bottom:8px">Lock automatically after</div>
          <div class="chips" id="stLock">${[[0, 'Never'], [5, '5 min'], [15, '15 min'], [30, '30 min'], [60, '1 hour']].map(([v, l]) => `<button class="chip ${S.autoLockMin === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>
          <div class="hstack" style="margin-top:14px"><button id="stPass">Change password</button><button id="stLockNow">Lock now</button></div></div>
        <div class="card"><h3>Notifications</h3>
          <div class="small muted" style="margin-bottom:8px">Show a notification on this device when email sync finds new orders, shipments, deliveries or cancellations.</div>
          <div class="chips"><button class="chip ${S.notify ? 'on' : ''}" id="stNotify">${S.notify ? 'On' : 'Off'}</button></div>
          ${S.notify && typeof Notification !== 'undefined' && Notification.permission === 'denied' ? '<div class="note warn">Your browser is blocking notifications for Crown Tools. Allow them in the browser’s site settings.</div>' : ''}</div>
        <div class="card" id="carrierCard"><h3>Carrier tracking</h3>
          <div class="small muted" style="margin-bottom:10px">With these free keys Crown Tools asks UPS, FedEx and USPS directly for every package: the real delivery date, out for delivery and delivered. Orders and the calendar update on their own after every sync. Keys stay encrypted inside your Crown Tools data.</div>
          ${[['ups', 'UPS', 'https://developer.ups.com', 'Sign in at developer.ups.com with a free UPS account → Apps → Create App (choose “I want to integrate UPS technology into my business”, add the <b>Tracking</b> API) → copy the Client ID and Client Secret.'],
             ['fedex', 'FedEx', 'https://developer.fedex.com', 'Sign in at developer.fedex.com with a free FedEx account → My Projects → Create API Project → pick <b>Track API</b> → choose Production → copy the API Key (Client ID) and Secret Key.'],
             ['usps', 'USPS', 'https://developers.usps.com', 'Sign in at developers.usps.com with a free USPS Business account → Apps → Add App → add the <b>Tracking</b> API → copy the Consumer Key (Client ID) and Consumer Secret.']].map(([k, label, url, how]) => { const c = (S.carriers || {})[k] || {}; return `
          <div class="section" style="margin-top:6px">${label} ${c.id ? '<span class="badge"><i style="background:var(--ok)"></i>connected</span>' : ''}</div>
          <div class="small faint" style="margin-bottom:6px">${how} <a href="${url}" target="_blank" rel="noopener">Open ${label} developer site ↗</a></div>
          <div class="hstack" style="flex-wrap:wrap"><input id="c_${k}_id" autocomplete="off" placeholder="${label} Client ID / API key" value="${esc(c.id || '')}" style="flex:1;min-width:180px"><input id="c_${k}_sec" type="password" autocomplete="off" placeholder="Client Secret" value="${esc(c.secret || '')}" style="flex:1;min-width:160px"><button data-csave="${k}">Save &amp; test</button>${c.id ? `<button class="ghost" data-cdel="${k}">Remove</button>` : ''}</div>`; }).join('')}
          <div class="section">EasyPost (optional — DHL, OnTrac, LaserShip, Canada Post, Purolator, Asendia and 100+ more)</div>
          <div class="hstack"><input id="stEp" type="password" autocomplete="off" placeholder="EZ… API key" value="${esc(S.easypostKey)}" style="flex:1;min-width:200px"><button id="stEpSave">Save key</button></div>
          <div class="hstack" style="margin-top:12px"><button id="stTrackNow">Check all packages now</button></div></div>
        <div class="card"><h3>Stores to track</h3>
          <div class="small muted" style="margin-bottom:8px">Order emails from stores that aren’t selected are skipped. Leave all on to track everything.</div>
          <div class="chips" id="stStores"><button class="chip ${trackAll ? 'on' : ''}" data-s="__all">All stores</button>${Parser.STORES.filter(s => s.key !== 'other').sort((a, b) => a.label.localeCompare(b.label)).concat([{ key: '__shopify', label: 'Any Shopify store' }]).map(s => `<button class="chip ${!trackAll && S.trackedStores.includes(s.key) ? 'on' : ''}" data-s="${s.key}">${esc(s.label)}</button>`).join('')}</div>
          <div class="section">Stores Crown Tools doesn’t recognize</div>
          <div class="small muted" style="margin-bottom:8px">Off by default, so food delivery, app receipts and other non-store emails don’t become orders.</div>
          <div class="chips"><button class="chip ${S.trackUnknown ? '' : 'on'}" id="stUnkOff">Ignore them</button><button class="chip ${S.trackUnknown ? 'on' : ''}" id="stUnkOn">Track them too</button></div>
          ${(S.ignoredSenders || []).length ? `<div class="section">Ignored senders</div><div class="chips">${S.ignoredSenders.map(k => `<button class="chip" data-unign="${esc(k)}" title="Stop ignoring">${esc(k)} ✕</button>`).join('')}</div>` : ''}</div>
        <div class="card" id="alertCard"><h3>Discord alerts</h3>
          <div class="small muted" style="margin-bottom:10px">Post to a Discord channel when a package is out for delivery, delivered or cancelled. Give a house its own webhook to send that house’s alerts to its own channel. Alerts go out whenever Crown Tools checks your email on any of your devices.</div>
          ${(() => { const A = S.alerts || {}; return `
          <div class="hstack" style="flex-wrap:wrap"><input id="alUrl" type="password" autocomplete="off" placeholder="https://discord.com/api/webhooks/…" value="${esc(A.url || '')}" style="flex:1;min-width:220px"><button id="alSave">Save &amp; test</button>${A.url ? '<button class="ghost" id="alDel">Remove</button>' : ''}</div>
          <div class="small faint" style="margin-top:6px">In Discord: Server Settings → Integrations → Webhooks → New Webhook → pick the channel → Copy Webhook URL.</div>
          <div class="section">Send an alert when an order is</div>
          <div class="chips" id="alEv">${[['out', 'Out for delivery'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['checkin', 'Checked in']].map(([k, l]) => `<button class="chip ${A[k] ? 'on' : ''}" data-al="${k}">${l}</button>`).join('')}</div>
          <div class="section">Per-house channels</div>
          ${state.houses.filter(h => houseOrders(h.id).length).length ? `<div class="list">${state.houses.filter(h => houseOrders(h.id).length).sort((a, b) => houseLabel(a).localeCompare(houseLabel(b), undefined, { numeric: true })).slice(0, 60).map(h => `<div class="li"><div class="mmain" style="min-width:120px"><div class="t2">${esc(houseLabel(h))}</div></div><input type="password" autocomplete="off" data-hook="${h.id}" placeholder="${A.url ? 'Uses the main webhook' : 'Webhook link'}" value="${esc(h.discord || '')}" style="flex:1;min-width:140px"></div>`).join('')}</div>` : '<div class="small faint">Houses show up here once orders have addresses.</div>'}
          ${A.lastError ? `<div class="note warn small" style="margin-top:8px">Last alert failed (${esc(ago(A.lastErrorAt))}): ${esc(A.lastError)}</div>` : ''}`; })()}</div>
        <div class="card"><h3>Inventory & check-in</h3>
          <div class="section" style="margin-top:0">Check-in</div>
          <div class="small muted" style="margin-bottom:8px">Optional. Scan shipping labels as boxes arrive to mark them as in hand. Nothing is flagged or nagged about either way.</div>
          <div class="chips"><button class="chip ${S.checkinSince ? 'on' : ''}" id="stCiOn">${S.checkinSince ? 'Check-in on' : 'Check-in off'}</button><button class="chip ${S.invOnCheckin ? 'on' : ''}" id="stInvCi">Add items to inventory when checked in</button></div>
          <div class="section">Selling fees (estimates — match them to your accounts)</div>
          <div class="feegrid">${PLATFORMS.filter(p => p.pct || p.flat || (S.platformFees || {})[p.k]).map(p => { const f = feeFor(p.k); return `<div class="feerow"><span>${esc(p.l)}</span><input data-fee="${p.k}" data-ff="pct" inputmode="decimal" value="${esc(f.pct)}"><span class="faint">% +</span><input data-fee="${p.k}" data-ff="flat" inputmode="decimal" value="${esc(f.flat)}"><span class="faint">$</span></div>`; }).join('')}</div></div>
        <div class="card"><h3>Backups</h3>
          <div class="small muted" style="margin-bottom:10px">${CLOUD ? 'Crown Tools Online saves every change instantly and keeps automatic backups (one every 15 minutes while you work, last 20 kept). Everything is encrypted with your password before it leaves this device.' : SERVER ? 'Crown Tools saves your encrypted data to its <b>data</b> folder and keeps automatic backups (one every 15 minutes while you work, last 60 kept).' : 'Open Crown Tools with Start Crown Tools to get automatic backups on disk.'} You can also download a backup file anytime — it stays encrypted with your password.</div>
          <div class="hstack"><button id="stBackup">Download backup</button><button id="stRestore">Restore from file…</button></div>
          <div id="stBackups" style="margin-top:12px"></div></div>
        <div class="card"><h3>Data tools</h3>
          <div class="list">
            <div class="li"><div style="flex:1"><div>Re-match orders to profiles</div><div class="small muted">Re-run automatic linking (email → address → card). Links you set by hand are kept.</div></div><button class="sm" id="stRelink">Run</button></div>
            <div class="li"><div style="flex:1"><div>Rebuild houses</div><div class="small muted">Regroup every order by street address only (apt / unit / line 2 ignored). Nicknames and notes are kept.</div></div><button class="sm" id="stRehouse">Run</button></div>
            <div class="li"><div style="flex:1"><div>Export everything to CSV</div><div class="small muted">Profiles and orders as two spreadsheet files (not encrypted).</div></div><button class="sm" id="stCsv">Export</button></div>
            <div class="li"><div style="flex:1"><div style="color:var(--danger)">Delete all orders</div><div class="small muted">Profiles and inboxes stay. Next sync re-reads emails from the inbox look-back window.</div></div><button class="sm danger" id="stWipe">Delete</button></div>
          </div></div>
      </div>
      <div class="small faint" style="margin-top:16px">Crown Tools v${VERSION}${CLOUD ? ' · Crown Tools Online' : ''}</div>`;
    $('#stLock').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; S.autoLockMin = +b.dataset.v; save(); PAGES.settings.render(); };
    $('#stPass').onclick = () => { ['cpOld', 'cpNew', 'cpNew2'].forEach(i => $('#' + i).value = ''); $('#cpErr').textContent = ''; openDlg('dlgPass'); };
    $('#stLockNow').onclick = () => lock();
    if (CLOUD && typeof Account !== 'undefined') Account.wireCard();
    $('#stNotify').onclick = async () => { if (!S.notify && typeof Notification !== 'undefined' && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch (_) { } } S.notify = !S.notify; save(); PAGES.settings.render(); if (S.notify && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('Crown Tools', { body: 'Notifications are on 👑' }); };
    $('#stUnkOff').onclick = () => { S.trackUnknown = false; save(); PAGES.settings.render(); };
    $('#stUnkOn').onclick = () => { S.trackUnknown = true; save(); PAGES.settings.render(); };
    pg.querySelectorAll('[data-unign]').forEach(b => b.onclick = () => { S.ignoredSenders = (S.ignoredSenders || []).filter(k => k !== b.dataset.unign); save(); PAGES.settings.render(); });
    $('#stEpSave').onclick = () => { S.easypostKey = $('#stEp').value.trim(); save(); toast(S.easypostKey ? 'EasyPost key saved' : 'EasyPost key removed'); };
    $$('#carrierCard [data-csave]').forEach(b => b.onclick = async () => {
      const k = b.dataset.csave, id = $('#c_' + k + '_id').value.trim(), secret = $('#c_' + k + '_sec').value.trim();
      if (!id || !secret) { toast('Paste both the Client ID and the Client Secret'); return; }
      b.disabled = true; b.textContent = 'Testing…';
      try { await api('/api/carriertest', { carrier: k, id, secret }); S.carriers = Object.assign({}, S.carriers, { [k]: { id, secret } }); save(); toast(({ ups: 'UPS', fedex: 'FedEx', usps: 'USPS' }[k]) + ' connected — checking your packages…'); PAGES.settings.render(); refreshStaleTracking(true); }
      catch (e) { toast(e.message); b.disabled = false; b.textContent = 'Save & test'; }
    });
    $$('#carrierCard [data-cdel]').forEach(b => b.onclick = () => { const c = Object.assign({}, S.carriers); delete c[b.dataset.cdel]; S.carriers = c; save(); PAGES.settings.render(); });
    $('#stTrackNow').onclick = () => refreshAllTracking();
    $('#alSave').onclick = async () => {
      const url = $('#alUrl').value.trim(); if (!url) { toast('Paste the webhook link from Discord'); return; }
      const b = $('#alSave'); b.disabled = true; b.textContent = 'Testing…';
      try { await Alerts.test(url); const A = Object.assign({ out: true, delivered: true, cancelled: false, checkin: false }, S.alerts || {}); S.alerts = Object.assign(A, { url, on: true, since: (S.alerts || {}).since || Date.now(), lastError: '' }); save(); toast('Connected — check your Discord channel'); PAGES.settings.render(); }
      catch (e) { toast(e.message); b.disabled = false; b.textContent = 'Save & test'; }
    };
    if ($('#alDel')) $('#alDel').onclick = () => { S.alerts = Object.assign({}, S.alerts, { url: '' }); if (!state.houses.some(h => h.discord)) S.alerts.on = false; save(); PAGES.settings.render(); };
    $('#alEv').onclick = e => { const b = e.target.closest('[data-al]'); if (!b) return; const A = Object.assign({}, S.alerts); A[b.dataset.al] = !A[b.dataset.al]; if (!A.since) A.since = Date.now(); S.alerts = A; save(); PAGES.settings.render(); };
    $$('#alertCard [data-hook]').forEach(inp => inp.onchange = async () => {
      const h = houseById(inp.dataset.hook); if (!h) return; const url = inp.value.trim();
      if (url) { try { await Alerts.test(url, h); toast('Connected — test sent to Discord'); } catch (e) { toast(e.message); inp.value = h.discord || ''; return; } }
      h.discord = url; h.updatedAt = Date.now();
      if (url) S.alerts = Object.assign({ out: true, delivered: true }, S.alerts, { on: true, since: (S.alerts || {}).since || Date.now() });
      save();
    });
    $('#stCiOn').onclick = () => { S.checkinSince = S.checkinSince ? '' : todayKey(); save(); PAGES.settings.render(); };
    $('#stInvCi').onclick = () => { S.invOnCheckin = !S.invOnCheckin; save(); PAGES.settings.render(); };
    $$('[data-fee]').forEach(inp => inp.onchange = () => { const k = inp.dataset.fee; const f = Object.assign({}, (S.platformFees || {})[k]); f[inp.dataset.ff] = Math.max(0, Number(inp.value) || 0); S.platformFees = Object.assign({}, S.platformFees, { [k]: f }); save(); });
    $('#stStores').onclick = e => { const b = e.target.closest('[data-s]'); if (!b) return; const k = b.dataset.s; if (k === '__all') S.trackedStores = []; else { const set = new Set(S.trackedStores || []); set.has(k) ? set.delete(k) : set.add(k); S.trackedStores = [...set]; } save(); PAGES.settings.render(); };
    $('#stBackup').onclick = async () => { const blob = await encryptState(cryptoKey, salt); download(`crown-backup-${stamp()}.json`, JSON.stringify(blob), 'application/json'); toast('Encrypted backup downloaded'); };
    $('#stRestore').onclick = () => $('#restoreFile').click();
    $('#stRelink').onclick = () => { snapshot('re-match'); state.orders.forEach(o => { if (o.profileLink !== 'manual') { o.profileLink = ''; o.profileId = ''; } }); autoLinkAll(); save(); refresh(); toast(`Linked ${state.orders.filter(o => o.profileId).length} of ${plural(state.orders.length, 'order')}`, { undo: true }); };
    $('#stRehouse').onclick = () => { snapshot('rebuild houses'); regroupHouses(); save(); refresh(); toast(`${plural(state.houses.filter(h => houseOrders(h.id).length).length, 'house')} after rebuild`, { undo: true }); };
    $('#stCsv').onclick = () => {
      if (state.profiles.length) { const rows = state.profiles.map(p => { const o = { category: catName(p.categoryId) }; FIELDS.forEach(f => o[f.k] = f.bool ? (p[f.k] ? 'yes' : 'no') : p[f.k] ?? ''); o.notes = p.notes; return o; }); download(`crown-profiles-${stamp()}.csv`, toCSV(Object.keys(rows[0]), rows), 'text/csv'); }
      if (state.orders.length) setTimeout(() => exportOrders(state.orders), 400);
      if (!state.profiles.length && !state.orders.length) toast('Nothing to export yet');
    };
    $('#stWipe').onclick = async () => { if (!await ask(`Delete all ${plural(state.orders.length, 'order')}?`)) return; snapshot('delete all orders'); state.orders = []; state.houses = state.houses.filter(h => h.nickname || h.notes); state.seenIds = []; state.unparsed = []; state.imapAccounts.forEach(a => { a.lastSync = 0; a.lastUid = 0; a.uidValidity = ''; }); save(); refresh(); toast('All orders deleted', { undo: true }); };
    if (SERVER) {
      try {
        if (!serverInfo) serverInfo = await api('/api/ping');
        const b = (await api('/api/backups')).backups;
        const box = $('#stBackups'); if (!box) return;
        box.innerHTML = b.length ? `<div class="small muted" style="margin-bottom:4px">Automatic backups</div><div class="list">${b.slice(0, 8).map(x => `<div class="li"><div style="flex:1" class="small">${fmtDT(x.mtime * 1000)} <span class="faint">· ${Math.max(1, Math.round(x.size / 1024))} KB</span></div><button class="sm" data-bk="${esc(x.name)}">Restore</button></div>`).join('')}</div>${b.length > 8 ? `<div class="small faint">+${b.length - 8} older${CLOUD ? '' : ' in the data/backups folder'}</div>` : ''}` : '<div class="small faint">No automatic backups yet — the first one is made 15 minutes after you start working.</div>';
        box.querySelectorAll('[data-bk]').forEach(el => el.onclick = async () => { try { const r = await api('/api/backups/' + encodeURIComponent(el.dataset.bk)); await restoreFromBlob(r.vault); } catch (e) { toast(e.message); } });
        const foot = pg.lastElementChild; if (foot && serverInfo && serverInfo.dataDir) foot.innerHTML = `Crown Tools v${VERSION} · data folder: ${esc(serverInfo.dataDir)}`;
      } catch (_) { }
    }
  },
};
$('#restoreFile').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { await restoreFromBlob(JSON.parse(await f.text())); } catch (err) { toast(err.message); } };
$('#cpGo').onclick = async () => {
  const o = $('#cpOld').value, n = $('#cpNew').value, n2 = $('#cpNew2').value; $('#cpErr').textContent = '';
  if (n.length < (CLOUD ? 8 : 6)) { $('#cpErr').textContent = `Use at least ${CLOUD ? 8 : 6} characters.`; return; }
  if (n !== n2) { $('#cpErr').textContent = 'New passwords don’t match.'; return; }
  $('#cpGo').disabled = true;
  try {
    try { await decryptBlob(await encryptState(cryptoKey, salt), o); } catch (_) { $('#cpErr').textContent = 'Current password is wrong.'; return; }
    const oldKey = cryptoKey, oldSalt = salt;
    const newSalt = crypto.getRandomValues(new Uint8Array(16)); const ks = await deriveKeys(n, newSalt);
    salt = newSalt; cryptoKey = ks.key;
    if (CLOUD) {
      try { await saveNow({ force: true, newAuthKey: ks.auth }); } catch (_) { }
      if (!lastSaveOk) { salt = oldSalt; cryptoKey = oldKey; $('#cpErr').textContent = 'Couldn’t change it right now — check your connection and try again.'; return; }
    } else await saveNow();
    closeDlg('dlgPass'); toast(CLOUD ? 'Password changed. Your other devices will ask for the new one.' : 'Password changed. Old backup files still use the old password.');
  } finally { $('#cpGo').disabled = false; }
};

/* Kingpin - packages. Every package on your orders in one place, with what the carrier says right now: a progress
   bar, the arrival date and delivery window, the latest scan, every scan so far, where it was left, and anything that
   needs a look (a delivery problem, an arrival date that slipped, a package past its date, or one with no new scans
   for days). The details come straight from UPS, FedEx and USPS with your free developer keys (Settings → Carrier
   tracking), or EasyPost for other carriers. */
'use strict';
const PK = { f: '', q: '', open: new Set(), limit: 120 };
const PK_LABEL = { pre_transit: 'Label created', in_transit: 'On the way', out_for_delivery: 'Out for delivery', delivered: 'Delivered', exception: 'Delivery problem' };
const PK_CLS = { pre_transit: 's-confirmed', in_transit: 's-transit', out_for_delivery: 's-late', delivered: 's-delivered', exception: 's-dead' };
const PK_STEPS = ['Label created', 'Shipped', 'Out for delivery', 'Delivered'];
const PK_STEP = { pre_transit: 0, in_transit: 1, exception: 1, out_for_delivery: 2, delivered: 3 };
const PK_STUCK_DAYS = 4;
const PK_OLD_DAYS = 14; // no news for this long and no upcoming date: it was almost surely delivered
// the last scan the carrier gave us (older saved lookups don't have .last)
const pkLast = l => l ? (l.last || (l.events || []).slice(-1)[0] || null) : null;
// "by 9:00 PM", "10:00 AM – 2:00 PM": UPS sends HHMMSS, FedEx sends date-times
function pkTime(v) {
  const s = String(v || ''); let m = s.match(/^(\d{2})(\d{2})(\d{2})?$/) || s.match(/T(\d{2}):(\d{2})/);
  if (!m) return ''; const h = +m[1], mi = m[2];
  if (h === 0 && mi === '00') return ''; // midnight means the carrier only gave a date
  return (h % 12 || 12) + ':' + mi + (h < 12 ? ' AM' : ' PM');
}
function pkWindow(l) {
  const w = l && l.window; if (!w) return '';
  const a = pkTime(w[0]), b = pkTime(w[1]);
  return a && b && a !== b ? a + ' – ' + b : b ? 'by ' + b : a ? 'from ' + a : '';
}
// everything the page needs to know about one package
function pkgInfo(o, t, i) {
  // just added to 17TRACK and nothing back yet: go by the emails until the first scans arrive
  const l = t.live && !t.live.pending ? t.live : null, waiting = !!(t.live && t.live.pending);
  let st = l ? l.status : ({ delivered: 'delivered', out: 'out_for_delivery', shipped: 'in_transit' }[o.status] || 'pre_transit');
  if (!(st in PK_STEP)) st = st === 'unknown' || !st ? (o.status === 'delivered' ? 'delivered' : 'pre_transit') : st === 'available_for_pickup' ? 'exception' : 'in_transit';
  if (st !== 'delivered' && o.status === 'delivered' && !l) st = 'delivered';
  const last = pkLast(l), lastD = last ? toDate(last.date) : null;
  const quiet = lastD ? Math.floor((Date.now() - lastD) / 864e5) : null;
  const est = st === 'delivered' ? '' : l ? (l.est || '') : (o.status === 'shipped' || o.status === 'out' ? o.eta || '' : '');
  const delivered = st === 'delivered';
  const deliveredOn = delivered ? (l && l.deliveredOn) || (o.deliveredAt ? dayKey(toDate(o.deliveredAt) || new Date()) : '') : '';
  const delayed = !delivered && !!(l && l.est && l.firstEst && l.est > l.firstEst);
  const late = !delivered && st !== 'out_for_delivery' && !!est && est < todayKey();
  const stuck = !delivered && st !== 'out_for_delivery' && st !== 'exception' && quiet != null && quiet >= PK_STUCK_DAYS;
  const kind = typeof trkKind === 'function' ? trkKind(t) : 'other', ep = !!state.settings.easypostKey;
  const canLook = kind !== 'other' || ep || !!s17Key();
  // can Kingpin look it up right now? (its carrier's keys, EasyPost, or the Mac app reading ups.com)
  const lookable = !!carrierKeys()[kind] || !!s17Key() || ep || (kind === 'ups' && SERVER && !CLOUD);
  // old: nothing new (no scan, no email) for 2 weeks and no arrival date coming up
  const newest = [last && last.date, o.statusAt, o.orderDate].map(v => v ? toDate(v) : null).filter(Boolean).reduce((a, b) => (b > a ? b : a), null);
  const age = newest ? Math.floor((Date.now() - newest) / 864e5) : 999;
  const old = !delivered && age >= PK_OLD_DAYS && !(est && est >= dayKey(new Date(Date.now() - 3 * 864e5)));
  return { o, t, i, l, st, last, quiet, est, delivered, deliveredOn, delayed, late, stuck, kind, canLook, lookable, waiting, old, age, problem: !old && (st === 'exception' || delayed || late || stuck), key: o.id + ':' + i };
}
function allPackages() {
  const out = [];
  state.orders.forEach(o => { if (isDead(o) || !(o.tracking || []).length) return; o.tracking.forEach((t, i) => { if (t && t.number && !t.hidden) out.push(pkgInfo(o, t, i)); }); });
  return out;
}
const pkRecent = x => { if (!x.delivered) return true; const d = x.deliveredOn || dayKey(new Date(x.o.updatedAt || 0)); return d >= dayKey(new Date(Date.now() - 30 * 864e5)); };
const PK_FILTERS = [
  ['transit', 'On the way', x => !x.delivered && !x.old],
  ['problems', 'Needs a look', x => x.problem],
  ['out', 'Out for delivery', x => x.st === 'out_for_delivery' && !x.old],
  ['today', 'Arriving today', x => !x.delivered && x.st !== 'out_for_delivery' && x.est === todayKey()],
  ['delivered', 'Delivered', x => x.delivered && pkRecent(x)],
  ['old', 'Old — probably delivered', x => x.old],
  ['all', 'All', x => pkRecent(x)],
];
const pkProblemCount = () => allPackages().filter(x => x.problem).length;
// you know it arrived: mark it delivered (on its arrival date if that's passed, otherwise today)
function pkMarkDelivered(list) {
  if (!list.length) return;
  snapshot(list.length === 1 ? 'mark package delivered' : 'mark packages delivered');
  for (const x of list) {
    const day = x.est && x.est <= todayKey() ? x.est : todayKey(), prev = x.t.live || {};
    x.t.live = Object.assign({}, prev, { status: 'delivered', deliveredOn: day, est: '', text: 'Marked delivered by you', manual: true, pending: false, checkedAt: Date.now(), events: prev.events || [], carrier: prev.carrier || x.t.carrier || '' });
    delete x.t.liveError; applyTracking(x.o); x.o.updatedAt = Date.now();
  }
  invalidateStats(); save(); toast(list.length === 1 ? 'Marked delivered' : `Marked ${plural(list.length, 'package')} delivered`, { undo: true }); softRefresh();
}
// what's wrong, in plain words (empty when nothing is)
function pkIssue(x) {
  const l = x.l || {};
  if (x.old) return { c: 'warn', t: `Nothing new for ${x.age} days — this was probably delivered. Mark it delivered or hide it.` };
  if (x.st === 'exception') return { c: 'bad', t: l.problem || l.text || 'The carrier reported a problem with this package.' };
  if (x.delayed) return { c: 'warn', t: `Running behind — ${x.l.carrier || 'the carrier'} first said ${fmtDate(x.l.firstEst, { weekday: true })}, now ${fmtDate(x.est, { weekday: true })}.` + (l.problem ? ' ' + l.problem : '') };
  if (x.late) return { c: 'warn', t: `Was due ${fmtDate(x.est, { weekday: true })} and hasn’t arrived yet.` };
  if (x.stuck) return { c: 'warn', t: x.st === 'pre_transit' ? `The label was made but the carrier hasn’t had the package for ${x.quiet} days. The store may not have handed it over yet.` : `No new scans in ${x.quiet} days.` };
  return null;
}
// progress bar + step names
function pkBar(x) {
  const n = PK_STEP[x.st], bad = x.st === 'exception' || x.problem;
  return `<div class="pkprog"><div class="pkbar ${bad ? 'x' : ''}">${PK_STEPS.map((_, k) => `<span class="${k <= n ? 'on' : ''}"></span>`).join('')}</div>
    <div class="pksteps">${PK_STEPS.map((s, k) => `<span class="${k === n ? 'cur' : ''}">${s}</span>`).join('')}</div></div>`;
}
// every scan, newest first
function pkScans(x) {
  const evs = ((x.l && x.l.events) || []).slice().reverse(); if (!evs.length) return '';
  return `<details class="pktl" data-pkd="${esc(x.key)}" ${PK.open.has(x.key) ? 'open' : ''}><summary>${evs.length === 1 ? '1 scan' : 'All ' + evs.length + ' scans'}</summary>
    <ol>${evs.map(e => `<li class="${e.x ? 'x' : ''}"><b>${esc(e.message || 'Scan')}</b><span>${[e.location, e.date ? fmtDT(e.date) : ''].filter(Boolean).map(esc).join(' · ')}</span></li>`).join('')}</ol></details>`;
}
// one line of extra details: service, weight, from → to, who signed
function pkExtras(x) {
  const l = x.l || {};
  const bits = [l.service, l.weight, l.from && l.to ? l.from + ' → ' + l.to : l.from ? 'From ' + l.from : l.to ? 'To ' + l.to : '', l.signedBy ? 'Signed by ' + l.signedBy : ''].filter(Boolean);
  return bits.length ? `<div class="small faint pkx">${bits.map(esc).join(' · ')}</div>` : '';
}
function pkStatusText(x) {
  const l = x.l; const t = l && l.text && x.st !== 'pre_transit' && x.st !== 'exception' ? l.text : PK_LABEL[x.st];
  return t.length > 70 ? t.slice(0, 68) + '…' : t;
}
function pkCardHtml(x) {
  const { o, t, l } = x, img = orderImage(o), h = houseById(o.houseId), issue = pkIssue(x);
  const url = l && l.publicUrl || Parser.trackingUrl(t.number, t.carrier), last = x.last;
  const err = t.liveError && (!l || t.liveError.at > (l.checkedAt || 0)) ? t.liveError.msg : '';
  const when = x.delivered ? `<div><span>Delivered</span><b>${x.deliveredOn ? esc(fmtDate(x.deliveredOn, { weekday: true })) : '—'}</b><i>${x.deliveredOn ? esc(relDay(x.deliveredOn)) : ''}</i></div>`
    : `<div class="${x.late ? 'late' : x.delayed ? 'soon' : ''}"><span>Arrives</span><b>${x.est ? esc(fmtDate(x.est, { weekday: true })) : '—'}</b><i>${x.est ? esc([relDay(x.est), x.est >= todayKey() ? pkWindow(l) : ''].filter(Boolean).join(' · ')) : l ? 'no date yet' : 'not checked yet'}</i></div>`;
  const lastBox = last ? `<div class="wide"><span>Latest scan</span><b class="ellipsis">${esc(last.message || '—')}</b><i class="ellipsis">${esc([last.location, last.date ? (relDay(last.date) === 'today' && pkTime(String(last.date)) ? 'today ' + pkTime(String(last.date)) : fmtDT(last.date)) : ''].filter(Boolean).join(' · '))}</i></div>`
    : `<div class="wide"><span>Latest scan</span><b>—</b><i>${l ? 'none yet' : x.waiting ? 'added to 17TRACK — first scans in a few minutes' : !x.canLook ? 'open the carrier’s site' : x.lookable ? 'checking soon' : 'add a tracking key to see scans'}</i></div>`;
  const third = x.delivered && l && l.leftAt ? `<div><span>Left at</span><b class="ellipsis">${esc(l.leftAt)}</b></div>` : `<div><span>${h ? 'House' : 'Profile'}</span><b class="ellipsis">${h ? esc(houseLabel(h)) : esc((profileById(o.profileId) || {}).name || '—')}</b></div>`;
  return `<div class="ocard pkcard pk-${x.st}${x.problem ? ' pk-warn' : ''}" data-pk="${esc(x.key)}">
    <div class="otop"><div class="opic${img ? '' : ' none'}">${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '📦'}</div>
      <div class="omain"><div class="otitle">${esc(shortTitle(o)) || 'Order #' + esc(o.orderNumber || '—')}</div>
        <div class="ometa"><b>${esc((l && l.carrier) || t.carrier || 'Carrier')}</b><span class="mono ellipsis">${esc(t.number)}</span><button class="ghost sm icopy" data-pkcopy="${esc(t.number)}" title="Copy tracking number" aria-label="Copy tracking number">⧉</button></div></div></div>
    <span class="ostat ${x.st === 'exception' ? 's-dead' : x.problem ? 's-late' : PK_CLS[x.st]}"><i style="background:${x.st === 'exception' ? 'var(--danger)' : x.problem ? 'var(--warn)' : x.delivered ? 'var(--ok)' : 'var(--accent)'}"></i>${esc(pkStatusText(x))}</span>
    ${pkBar(x)}
    ${issue ? `<div class="note ${issue.c} small pkissue">${issue.c === 'bad' ? '⚠️' : '⏰'} ${esc(issue.t)}</div>` : ''}
    <div class="prefacts pkfacts">${when}${lastBox}${third}</div>
    ${pkExtras(x)}${pkScans(x)}
    ${err ? `<div class="small" style="color:var(--warn)">${esc(err)}</div>` : ''}
    <div class="iacts">${SERVER && x.lookable && !x.delivered ? `<button class="sm" data-pkref="${esc(x.key)}">↻ Refresh</button>` : ''}<a class="small pklink" href="${esc(url)}" target="_blank" rel="noopener">${esc((l && l.carrier) || t.carrier || 'Carrier')} site ↗</a>${!x.delivered ? `<button class="sm${x.old ? ' primary' : ' ghost'}" data-pkdel="${esc(x.key)}">✓ Delivered</button>` : ''}<span class="spacer"></span>${l && l.checkedAt ? `<span class="small faint">checked ${esc(ago(l.checkedAt))}</span>` : ''}<button class="sm ghost" data-pkhide="${esc(x.key)}" title="Remove from Packages (the order stays)">Hide</button><button class="sm ghost" data-pkopen="${o.id}">Order</button></div></div>`;
}
// the same details inside an order's window
function pkOrderBlock(o, t, i) {
  const x = pkgInfo(o, t, i), issue = pkIssue(x);
  if (x.waiting) return `<div class="small faint" style="margin-top:6px">Added to 17TRACK — the first scans show up in a few minutes.</div>`;
  if (!t.live) return issue ? `<div class="note ${issue.c} small" style="margin-top:6px">${esc(issue.t)}</div>` : '';
  const l = x.l, last = x.last;
  return `<div style="margin-top:10px">${pkBar(x)}</div>
    <div class="small" style="margin-top:6px"><b>${esc(l.text || PK_LABEL[x.st])}</b>${x.delivered && x.deliveredOn ? ' · delivered ' + esc(fmtDate(x.deliveredOn, { weekday: true })) + (l.leftAt ? ' · ' + esc(l.leftAt) : '') : x.est ? ' · arrives ' + esc(fmtDate(x.est, { weekday: true })) + (x.est >= todayKey() && pkWindow(l) ? ' ' + esc(pkWindow(l)) : '') : ''} <span class="faint">· checked ${esc(ago(l.checkedAt))}</span></div>
    ${issue ? `<div class="note ${issue.c} small" style="margin-top:6px">${esc(issue.t)}</div>` : ''}
    ${last ? `<div class="small muted" style="margin-top:4px">Latest: ${esc(last.message || '')}${last.location ? ' · ' + esc(last.location) : ''}${last.date ? ' · ' + esc(fmtDT(last.date)) : ''}</div>` : ''}
    ${pkExtras(x)}${pkScans(x)}`;
}
PAGES.packages = {
  render() {
    const pg = $('#pg-packages'), all = allPackages();
    const cnt = k => all.filter(PK_FILTERS.find(f => f[0] === k)[2]).length;
    if (!PK.f) PK.f = 'transit';
    const f = PK_FILTERS.find(x => x[0] === PK.f) || PK_FILTERS[0], q = PK.q.trim().toLowerCase();
    const list = all.filter(f[2]).filter(x => !q || [x.t.number, x.t.carrier, x.o.orderNumber, orderTitle(x.o), (houseById(x.o.houseId) && houseLabel(houseById(x.o.houseId))), (profileById(x.o.profileId) || {}).name, x.l && x.l.text, x.l && x.l.to].some(v => String(v || '').toLowerCase().includes(q)));
    const rank = x => x.st === 'exception' ? 0 : x.problem ? 1 : x.st === 'out_for_delivery' ? 2 : x.delivered ? 5 : x.est === todayKey() ? 3 : 4;
    list.sort((a, b) => rank(a) - rank(b) || (a.delivered ? String(b.deliveredOn).localeCompare(String(a.deliveredOn)) : String(a.est || '9999').localeCompare(String(b.est || '9999'))) || String(b.o.orderDate).localeCompare(String(a.o.orderDate)));
    const onWay = cnt('transit'), out = cnt('out'), today = cnt('today'), probs = cnt('problems');
    const week = all.filter(x => x.delivered && x.deliveredOn && x.deliveredOn >= dayKey(new Date(Date.now() - 6 * 864e5))).length;
    const keys = carrierKeys(), anyKeys = !!(keys.ups || keys.fedex || keys.usps || s17Key() || state.settings.easypostKey), ready = trackingReady(), checked = all.map(x => x.l && x.l.checkedAt || 0).reduce((a, b) => Math.max(a, b), 0);
    const shown = list.slice(0, PK.limit);
    pg.innerHTML = `<div class="pagehead"><h1>Packages</h1><span class="sub">${plural(onWay, 'package')} on the way${checked ? ' · checked ' + esc(ago(checked)) : ''}</span><div class="spacer"></div>
        ${ready && SERVER ? '<button id="pkNow">Check all now</button>' : ''}<button class="primary" data-nav="orders">All orders</button></div>
      ${!anyKeys ? `<div class="note warn pkkeys"><b>${ready ? 'Live tracking is only partly on.' : 'Live tracking is off.'}</b>${ready ? ' Right now only UPS packages are checked (from ups.com).' : ''} Add a 17TRACK key (200 packages free, no carrier account needed) and every package here gets the carrier’s scans, arrival date, where it was left and problem alerts. Until then, packages show what the shipping emails said. <button class="sm primary" id="pkSetup">Set up tracking</button></div>` : ''}
      ${all.length ? `<div class="hero"><div class="hero-l">On the way</div><div class="hero-v">${onWay}</div><div class="hero-s">${out ? `<b>${out} out for delivery</b> · ` : ''}${today ? `${today} arriving today · ` : ''}${probs ? `${probs} need${probs === 1 ? 's' : ''} a look` : 'nothing needs a look 👑'}${cnt('old') ? ` · <button class="ghost sm pkoldlink" data-pkf="old">${cnt('old')} old, probably delivered</button>` : ''}</div>
        <div class="hero-tiles"><button class="htile" data-pkf="out"><span>Out for delivery</span><b>${out}</b><i>${out ? 'arriving today' : 'none right now'}</i></button><button class="htile" data-pkf="today"><span>Arriving today</span><b>${today}</b><i>${esc(fmtDate(todayKey(), { weekday: true }))}</i></button><button class="htile" data-pkf="problems"><span>Needs a look</span><b>${probs}</b><i>${probs ? 'problems, delays, no scans' : 'all moving'}</i></button><button class="htile" data-pkf="delivered"><span>Delivered</span><b>${week}</b><i>last 7 days</i></button></div></div>` : ''}
      <div class="toolbar"><input class="search" data-search id="pkQ" placeholder="Search tracking #, order #, item, house, city…" value="${esc(PK.q)}">
        <div class="pills" id="pkF">${PK_FILTERS.map(([k, l]) => `<button class="chip ${PK.f === k ? 'on' : ''}" data-pkf="${k}">${l}<span class="n">${cnt(k)}</span></button>`).join('')}</div></div>
      ${PK.f === 'old' && shown.length ? `<div class="docbar" style="margin-bottom:12px"><div class="docmsg"><b>${plural(list.length, 'package')} with no news for over 2 weeks</b><span class="small">No scans, no emails and no upcoming date — these almost surely arrived. They don’t count as on the way.</span></div><div class="docacts"><button class="sm primary" id="pkOldAll">Mark all ${list.length} delivered</button></div></div>` : ''}
      ${shown.length ? `<div class="olist pklist">${shown.map(pkCardHtml).join('')}</div>${list.length > shown.length ? `<div style="text-align:center;margin-top:12px"><button id="pkMore">Show ${Math.min(120, list.length - shown.length)} more</button></div>` : ''}`
        : `<div class="empty">${all.length ? (PK.f === 'problems' ? 'Every package is moving on time. 👑' : PK.f === 'out' ? 'Nothing is out for delivery right now.' : PK.f === 'today' ? 'Nothing is due today.' : PK.f === 'transit' ? 'Nothing on the way right now.' : PK.f === 'old' ? 'No old packages — everything has news. 👑' : 'No packages match.') : 'No packages yet. Tracking numbers come in automatically from shipping emails, and every one shows up here.'}</div>`}
      <div class="note small">Packages show up here as soon as a shipping email with a tracking number syncs. With 17TRACK or carrier keys, Kingpin checks while it’s open: every 30 minutes once a package is out for delivery, every hour when it’s due within a day, and every 2 hours otherwise. <b>Needs a look</b> means the carrier reported a problem, the arrival date moved later, it’s past its date, or there haven’t been any new scans for ${PK_STUCK_DAYS} days.</div>`;
    $('#pkQ').oninput = debounce(e => { PK.q = e.target.value; PK.limit = 120; PAGES.packages.render(); }, 160);
    pg.querySelectorAll('[data-pkf]').forEach(b => b.onclick = () => { PK.f = b.dataset.pkf; PK.limit = 120; PAGES.packages.render(); });
    if ($('#pkNow')) $('#pkNow').onclick = () => refreshAllTracking();
    if ($('#pkSetup')) $('#pkSetup').onclick = () => { go('settings'); setTimeout(() => { const c = $('#carrierCard'); if (c) c.scrollIntoView({ block: 'start' }); }, 150); };
    if ($('#pkOldAll')) $('#pkOldAll').onclick = async () => { if (!await ask(`Mark ${plural(list.length, 'package')} delivered?\n\nTheir orders move to Delivered. You can undo this.`, { ok: 'Mark delivered' })) return; pkMarkDelivered(list); };
    if ($('#pkMore')) $('#pkMore').onclick = () => { PK.limit += 120; PAGES.packages.render(); };
    const ol = pg.querySelector('.pklist');
    if (ol) ol.onclick = e => {
      const cp = e.target.closest('[data-pkcopy]'); if (cp) { e.stopPropagation(); copyText(cp.dataset.pkcopy, 'Tracking number'); return; }
      const sm = e.target.closest('summary'); if (sm) { const d = sm.parentElement; setTimeout(() => { d.open ? PK.open.add(d.dataset.pkd) : PK.open.delete(d.dataset.pkd); }, 0); return; }
      const rf = e.target.closest('[data-pkref]'); if (rf) { e.stopPropagation(); const [id, i] = rf.dataset.pkref.split(':'); liveTrack(id, +i, rf); return; }
      const dl = e.target.closest('[data-pkdel]'); if (dl) { const x = all.find(y => y.key === dl.dataset.pkdel); if (x) pkMarkDelivered([x]); return; }
      const hd = e.target.closest('[data-pkhide]'); if (hd) { const x = all.find(y => y.key === hd.dataset.pkhide); if (x) { snapshot('hide package'); x.t.hidden = true; x.o.updatedAt = Date.now(); save(); toast('Hidden from Packages', { undo: true }); PAGES.packages.render(); } return; }
      const op = e.target.closest('[data-pkopen]'); if (op) { openOrder(op.dataset.pkopen); return; }
      if (e.target.closest('button, a, details')) return;
      const c = e.target.closest('[data-pk]'); if (c) openOrder(c.dataset.pk.split(':')[0]);
    };
  },
};

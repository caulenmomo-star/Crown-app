/* Crown Tools - profile doctor: which profiles are burned (their orders keep getting cancelled) or broken, why,
   and a careful "smart line 2" fix that only ever changes address line 2. */
'use strict';
const isCancelled = o => o.status === 'cancelled';
const UNIT_RE = /^(apt\.?|apartment|unit|suite|ste\.?|#|no\.?|room|rm\.?|bldg\.?|building|fl\.?|floor|lot|trlr|spc|space|dept\.?)?\s*#?\s*(\d{1,5})\s*-?\s*([a-z])?$/i;
const TYPE_NORM = { 'apt.': 'Apt', apt: 'Apt', apartment: 'Apt', unit: 'Unit', suite: 'Suite', 'ste.': 'Ste', ste: 'Ste', '#': '#', 'no.': '#', no: '#', room: 'Room', rm: 'Rm', 'rm.': 'Rm', bldg: 'Bldg', 'bldg.': 'Bldg', building: 'Bldg', fl: 'Fl', 'fl.': 'Fl', floor: 'Floor', lot: 'Lot', trlr: 'Trlr', spc: 'Spc', space: 'Spc', dept: 'Dept', 'dept.': 'Dept' };
function unitStyle(s) {
  const m = String(s || '').trim().match(UNIT_RE); if (!m) return null;
  return { type: m[1] ? TYPE_NORM[m[1].toLowerCase()] || 'Apt' : '', digits: m[2].length, letter: !!m[3] };
}
const pHouse = p => Parser.houseKey(p.shipAddr1, p.shipZip);
const oHouse = o => Parser.houseKey(o.addr1, o.zip);
const unitOf = (addr1, addr2) => Parser.normUnit([Parser.splitUnit(addr1).unit, addr2].filter(Boolean).join(' '));
const oDay = o => (toDate(o.orderDate) || new Date(0)).getTime();

/* ---------- reading the order history ---------- */
let _doc = null;
function doctorIndex() {
  if (_doc) return _doc;
  const byProfile = new Map(), byUnit = new Map(), byCard = new Map(), byHouse = new Map();
  const push = (m, k, o) => { if (!k) return; let a = m.get(k); if (!a) m.set(k, a = []); a.push(o); };
  for (const o of state.orders) {
    push(byProfile, o.profileId, o);
    const h = oHouse(o); if (h) { push(byHouse, h, o); push(byUnit, h + '#' + unitOf(o.addr1, o.addr2), o); }
    if (o.last4) push(byCard, o.last4, o);
  }
  _doc = { byProfile, byUnit, byCard, byHouse };
  return _doc;
}
const tally = list => { let stuck = 0, dead = 0, pending = 0; for (const o of list) { if (isStuck(o)) stuck++; else if (isCancelled(o)) dead++; else if (isPending(o)) pending++; } return { stuck, dead, pending, n: list.length }; };
// Only orders placed with the profile's current line 2 say anything about it - after a change it starts with a clean slate.
function currentOrders(p, list) {
  const since = p.l2ChangedAt || 0, cur = unitOf(p.shipAddr1, p.shipAddr2);
  return list.filter(o => oDay(o) >= since && (!o.addr1 || !cur || unitOf(o.addr1, o.addr2) === cur || !unitOf(o.addr1, o.addr2)));
}
const SEVERE = /^Missing .*(card number|address|exp|CVV)|fails the checksum|Card expired/;

/* ---------- why an order was cancelled ---------- */
// limit  - quantity / purchase limit: this house had already got the same item through (the house is maxed), or the
//          store said so. On a jigged address (one with a line 2) that means the jig didn't get past the limit; with no
//          line 2 it's expected.
// demand - item demand: nothing for that item got through to the house - the 50/50 kind, or the store said sold out.
// flag   - the store said payment, policy or fraud review.
// You can set it yourself on any order (o.cancelWhy); what you set always wins.
const CANCEL_KINDS = {
  limit: { l: 'Quantity limit', short: 'limit', c: 'var(--accent)' },
  demand: { l: 'Item demand', short: 'demand', c: 'var(--warn)' },
  flag: { l: 'Payment / policy', short: 'flag', c: 'var(--danger)' },
};
const LIMIT_WINDOW = 14 * 864e5;
const prodKeys = o => (o.items || []).map(i => i.name).filter(Boolean);
function sameProduct(a, b) {
  const ka = itemKey(a), kb = itemKey(b); if (!ka || !kb) return false;
  if (ka === kb) return true;
  const ca = typeof coreKey === 'function' ? coreKey(a) : ka, cb = typeof coreKey === 'function' ? coreKey(b) : kb;
  if (ca && ca === cb) return true;
  return Math.min(ca.length, cb.length) >= 12 && (ca.includes(cb) || cb.includes(ca));
}
const isJig = o => !!unitOf(o.addr1 || '', o.addr2 || '');
let _cinfo = null;
// same-product orders that got through to this house around the same time
function limitHits(o) {
  const hk = oHouse(o); if (!hk) return [];
  const t = oDay(o), names = prodKeys(o);
  return (doctorIndex().byHouse.get(hk) || []).filter(x => x !== o && isStuck(x) && (!o.store || !x.store || x.store === o.store) && Math.abs(oDay(x) - t) <= LIMIT_WINDOW)
    .filter(x => { const xn = prodKeys(x); return names.length && xn.length ? names.some(a => xn.some(b => sameProduct(a, b))) : Math.abs(oDay(x) - t) <= 3 * 864e5; });
}
function cancelInfo(o) {
  if (!o || !isCancelled(o)) return null;
  if (!_cinfo) _cinfo = new Map();
  if (_cinfo.has(o.id)) return _cinfo.get(o.id);
  let r; const jig = isJig(o), hits = limitHits(o);
  if (CANCEL_KINDS[o.cancelWhy]) r = { kind: o.cancelWhy, by: 'you', why: 'Set by you' };
  else if (CANCEL_KINDS[o.cancelReason]) r = { kind: o.cancelReason, by: 'email', why: 'The store’s email said so' };
  else if (hits.length) r = { kind: 'limit', by: 'house', why: `${plural(hits.length, 'order')} of this item already got through to this house` };
  else r = { kind: 'demand', by: 'house', why: oHouse(o) ? 'Nothing for this item got through to this house' : 'No address to compare against' };
  r.jig = jig;
  // A line 2 is "caught" when the item got through to the house on a different address (the plain one or another
  // line 2) and this line 2 still hit the limit - the store matched it to the house. Hitting the limit on the very
  // address that already got it through (plain or the same line 2) just means that address is maxed - expected.
  const u = unitOf(o.addr1 || '', o.addr2 || '');
  r.caught = r.kind === 'limit' && jig && (hits.length ? hits.some(x => unitOf(x.addr1 || '', x.addr2 || '') !== u) : true);
  r.expected = r.kind === 'limit' && !r.caught;
  _cinfo.set(o.id, r);
  return r;
}
const cancelKind = o => { const c = cancelInfo(o); return c ? c.kind : ''; };
function cancelChip(o) {
  const c = cancelInfo(o); if (!c) return '';
  const K = CANCEL_KINDS[c.kind];
  const tip = `${K.l}${c.kind === 'limit' ? (c.caught ? ' on a line 2 — the jig didn’t get past the limit' : c.jig ? ' on a line 2 that had already got it through — that address is maxed, expected' : ' on the plain address — expected, the house is maxed') : ''}. ${c.why}.`;
  return `<span class="cchip cc-${c.kind}${c.expected ? ' cc-ok' : ''}" title="${esc(tip)}">${esc(K.short)}${c.caught ? ' · line 2' : ''}</span>`;
}
// counts by kind for a list of orders
function cancelTally(list) {
  const t = { demand: 0, flag: 0, limit: 0, limitJig: 0, limitPlain: 0 };
  for (const o of list) { const c = cancelInfo(o); if (!c) continue; t[c.kind]++; if (c.kind === 'limit') t[c.caught ? 'limitJig' : 'limitPlain']++; }
  return t;
}

/* ---------- the verdict for one profile ---------- */
// level: 'bad' (change it), 'watch', 'good', 'new' (no orders yet), plus plain-English reasons and what to do.
function profileVerdict(p) {
  const ix = doctorIndex();
  const all = (ix.byProfile.get(p.id) || []).slice().sort((a, b) => oDay(a) - oDay(b));
  const cur = currentOrders(p, all);
  const t = tally(cur), tAll = tally(all), ck = cancelTally(cur), ckAll = cancelTally(all);
  const reasons = [], fixes = new Set(); let level = 'good';
  const bump = l => { const r = { new: 0, good: 1, watch: 2, bad: 3 }; if (r[l] > r[level]) level = l; };
  const curL2 = p.shipAddr2 || Parser.splitUnit(p.shipAddr1 || '').unit || '';
  // 1. Quantity limit on a line 2: the jig didn't get past the house limit - the store tied this line 2 to the house.
  //    (A limit on the plain address with no line 2 is expected - the house is maxed - so it never counts against it.)
  const limJig = cur.filter(o => cancelKind(o) === 'limit' && cancelInfo(o).caught);
  if (limJig.length) {
    const lastLim = Math.max(...limJig.map(oDay));
    const stuckAfter = cur.filter(o => isStuck(o) && isJig(o) && oDay(o) > lastLim).length;
    const what = curL2 ? `Line 2 “${curL2}”` : 'This line 2';
    if (!stuckAfter) { bump('bad'); reasons.push(`${what} didn’t get past the quantity limit (${plural(limJig.length, 'time')}) — the store matched it to the house`); fixes.add('l2'); }
    else { bump('watch'); reasons.push(`${what} hit the quantity limit ${plural(limJig.length, 'time')}, but ${stuckAfter} got through after`); }
  }
  // 2. Item demand (and payment / policy flags): one cancel is a coin flip, so it takes several to call a profile bad.
  //    Quantity-limit cancels are left out here - they say nothing about the profile itself.
  const judged = cur.filter(o => isStuck(o) || (isCancelled(o) && cancelKind(o) !== 'limit'));
  const dem = ck.demand, rate = judged.length ? t.stuck / judged.length : 1;
  const last4 = judged.slice(-4);
  if (dem >= 4 && t.stuck === 0) { bump('bad'); reasons.push(`${dem} orders cancelled for item demand and none got through`); fixes.add('l2'); }
  else if (last4.length === 4 && last4.every(o => isCancelled(o) && cancelKind(o) === 'demand')) { bump('bad'); reasons.push('The last 4 orders were all cancelled for item demand'); fixes.add('l2'); }
  else if (judged.length >= 6 && rate <= 0.2) { bump('bad'); reasons.push(`Only ${Math.round(rate * 100)}% get through (${t.stuck} of ${judged.length}, not counting quantity limits)`); fixes.add('l2'); }
  else if (dem >= 2 && t.stuck === 0) { bump('watch'); reasons.push(`${plural(dem, 'item-demand cancel')} and nothing through yet — could still be bad luck`); }
  else if (dem >= 3 && rate < 0.4) { bump('watch'); reasons.push(`${plural(dem, 'item-demand cancel')}, ${t.stuck} through`); }
  if (ck.flag >= 2) { bump('bad'); reasons.push(`Cancelled for payment / policy ${ck.flag} times`); fixes.add('card'); }
  else if (ck.flag === 1) { bump('watch'); reasons.push('Cancelled once for payment / policy'); }
  // 3. the exact address (street + line 2) no matter which profile used it
  const hk = pHouse(p), uk = hk && hk + '#' + unitOf(p.shipAddr1, p.shipAddr2);
  if (uk && unitOf(p.shipAddr1, p.shipAddr2)) {
    const since = Date.now() - 120 * 864e5;
    const onUnit = (ix.byUnit.get(uk) || []).filter(o => oDay(o) >= Math.max(since, p.l2ChangedAt || 0) && o.profileId !== p.id);
    const others = onUnit.filter(o => cancelKind(o) === 'limit' && cancelInfo(o).caught);
    if (others.length && !limJig.length) { bump('bad'); reasons.push(`“${curL2}” here hit the quantity limit on another profile — the store has tied it to the house`); fixes.add('l2'); }
    const u = tally(onUnit.filter(o => cancelKind(o) !== 'limit')), ud = cancelTally(onUnit);
    if (ud.demand + ud.flag >= 4 && u.stuck === 0) { bump('bad'); reasons.push(`“${curL2}” at this address was cancelled ${ud.demand + ud.flag} times on other profiles`); fixes.add('l2'); }
  }
  // 4. the card: cancelled (not for limits) at several different houses and never through
  const l4 = cardDigits(p.cardNumber).slice(-4);
  if (l4) {
    const onCard = (ix.byCard.get(l4) || []).filter(o => !o.profileId || o.profileId === p.id || profileById(o.profileId) && cardDigits(profileById(o.profileId).cardNumber).slice(-4) === l4);
    const bad = onCard.filter(o => isCancelled(o) && cancelKind(o) !== 'limit'), houses = new Set(bad.map(oHouse).filter(Boolean));
    if (bad.length >= 4 && !onCard.some(isStuck) && houses.size >= 2) { bump('bad'); reasons.push(`Card •••• ${l4} was cancelled ${bad.length} times at ${houses.size} different addresses`); fixes.add('card'); }
  }
  // 5. details that stop a checkout outright
  const h = health(p).filter(x => !/^Same (card|email) as/.test(x)), severe = h.filter(x => SEVERE.test(x)); // sharing a card or inbox is normal
  if (severe.length) { bump('bad'); reasons.push(...severe); fixes.add('data'); }
  else if (h.length) { bump('watch'); reasons.push(...h); fixes.add('data'); }
  if (level === 'good' && !cur.length) level = 'new'; // nothing placed with the current details yet
  if (level === 'good' && ck.limitPlain) reasons.push(`${plural(ck.limitPlain, 'quantity-limit cancel')} where that address had already got the item — expected, it was maxed`);
  return { level, reasons, fixes: [...fixes], stuck: tAll.stuck, dead: tAll.dead, pending: tAll.pending, curStuck: t.stuck, curDead: t.dead, orders: all.length,
    demand: ckAll.demand, flag: ckAll.flag, limit: ckAll.limit, limitJig: ckAll.limitJig, limitPlain: ckAll.limitPlain };
}
const LEVEL = { bad: { l: 'Change it', c: 'var(--danger)' }, watch: { l: 'Watch', c: 'var(--warn)' }, good: { l: 'Good', c: 'var(--ok)' }, new: { l: 'Not used yet', c: 'var(--faint)' } };
let _verd = null;
function verdicts() {
  if (_verd) return _verd;
  if (typeof buildDupIndex === 'function') buildDupIndex();
  _verd = new Map(state.profiles.map(p => [p.id, profileVerdict(p)]));
  return _verd;
}
function invalidateDoctor() { _doc = null; _verd = null; _globalStyles = null; _cinfo = null; }
const verdictOf = p => verdicts().get(p.id) || profileVerdict(p);

/* ---------- smart line 2 ---------- */
// New line 2s copy the style that has actually been getting through at that house (Apt 3 digits, Unit 2 digits + letter…),
// never reuse a line 2 that was ever used at that house, and are unique across the batch. Nothing else is touched.
function houseUnits(hk) {
  const ix = doctorIndex(), used = new Set(), good = [];
  for (const o of ix.byHouse.get(hk) || []) { const u = unitOf(o.addr1, o.addr2); if (u) used.add(u); if (isStuck(o) && o.addr2) { const s = unitStyle(o.addr2); if (s) good.push(s); } }
  for (const p of state.profiles) if (pHouse(p) === hk) { const u = unitOf(p.shipAddr1, p.shipAddr2); if (u) used.add(u); (p.l2History || []).forEach(x => used.add(Parser.normUnit(x.old))); }
  return { used, good };
}
let _globalStyles = null;
function globalGoodStyles() {
  if (_globalStyles) return _globalStyles;
  const g = []; for (const o of state.orders) if (isStuck(o) && o.addr2) { const s = unitStyle(o.addr2); if (s) g.push(s); }
  return (_globalStyles = g);
}
function pickStyle(p, good, force) {
  if (force && force !== 'auto') return { type: force === 'none' ? '' : force, digits: 3, letter: false };
  const pool = good.length ? good : globalGoodStyles();
  if (pool.length) return pool[rint(0, pool.length - 1)];
  return unitStyle(p.shipAddr2) || { type: 'Apt', digits: 3, letter: false };
}
function makeUnit(st, used, taken) {
  const lo = st.digits <= 1 ? 1 : Math.pow(10, st.digits - 1), hi = Math.pow(10, st.digits) - 1;
  for (let i = 0; i < 400; i++) {
    let v = String(rint(lo, hi)); if (st.letter) v += 'ABCDEF'[rint(0, 5)];
    const txt = !st.type ? v : st.type === '#' ? '#' + v : st.type + ' ' + v;
    const k = Parser.normUnit(txt);
    if (!used.has(k) && !taken.has(k)) { taken.add(k); return txt; }
  }
  return null;
}
function planLine2(list, opts) {
  opts = opts || {}; const taken = new Set(), cache = new Map(), out = [];
  _globalStyles = null;
  for (const p of list) {
    const row = { p, old: p.shipAddr2 || '', next: '', skip: '', why: (verdictOf(p).reasons[0] || '') };
    if (!p.shipAddr1) row.skip = 'No shipping address';
    else if (Parser.splitUnit(p.shipAddr1).unit) row.skip = `The unit is inside address line 1 (“${p.shipAddr1}”) — change it by hand`;
    else {
      const hk = pHouse(p); if (!cache.has(hk)) cache.set(hk, houseUnits(hk));
      const hu = cache.get(hk);
      row.next = makeUnit(pickStyle(p, hu.good, opts.style), hu.used, taken) || '';
      if (!row.next) row.skip = 'Couldn’t find an unused line 2 for this house';
    }
    row.on = !row.skip; out.push(row);
  }
  return out;
}
// billing follows shipping only when it was a copy of shipping
const billFollows = p => p.sameBilling || (p.billAddr1 && p.billAddr1 === p.shipAddr1 && (p.billAddr2 || '') === (p.shipAddr2 || '') && (p.billZip || '') === (p.shipZip || ''));
function applyLine2(rows) {
  let n = 0; const ids = [];
  for (const r of rows) {
    if (!r.on || r.skip || !r.next || r.next === r.old) continue;
    const p = state.profiles.find(x => x.id === r.p.id); if (!p) continue;
    const follow = billFollows(p) && !p.sameBilling;
    p.l2History = (p.l2History || []).concat([{ old: p.shipAddr2 || '', new: r.next, at: Date.now() }]).slice(-20);
    p.shipAddr2 = r.next; if (follow) p.billAddr2 = r.next;
    p.l2ChangedAt = Date.now(); p.updatedAt = Date.now(); n++; ids.push(p.id);
  }
  return { n, ids };
}

/* ---------- the fix dialog ---------- */
let fixRows = [], fixStyle = 'auto';
function openFixLine2(list) {
  fixRows = planLine2(list, { style: fixStyle });
  renderFix(); openDlg('dlgFixL2');
}
function renderFix() {
  const on = fixRows.filter(r => r.on && !r.skip).length;
  $('#fixBody').innerHTML = `<div class="small muted" style="margin-bottom:10px">Only <b>address line 2</b> changes (and billing line 2 when billing is a copy of shipping). Names, emails, cards and line 1 stay exactly as they are. New line 2s follow the style that has been getting orders through at each house, and never repeat one already used there.</div>
    <div class="hstack" style="flex-wrap:wrap;gap:6px;margin-bottom:10px"><span class="small muted">Style</span><div class="chips" id="fixStyle">${[['auto', 'Match what works'], ['Apt', 'Apt'], ['Unit', 'Unit'], ['Ste', 'Ste'], ['#', '#'], ['none', 'Number only']].map(([k, l]) => `<button class="chip ${fixStyle === k ? 'on' : ''}" data-fs="${esc(k)}">${esc(l)}</button>`).join('')}</div><span class="spacer"></span><button class="sm" id="fixReroll">↻ New numbers</button></div>
    <div class="fixlist">${fixRows.map((r, i) => `<div class="fixrow ${r.skip ? 'skip' : ''}">
      <input type="checkbox" data-fon="${i}" ${r.on && !r.skip ? 'checked' : ''} ${r.skip ? 'disabled' : ''} aria-label="Change this profile">
      <div class="fx-main"><div class="t2">${esc(r.p.name || 'Untitled')}</div><div class="small muted ellipsis">${esc(r.p.shipAddr1 || '')}${r.p.shipCity ? ', ' + esc(r.p.shipCity) : ''}</div>${r.why ? `<div class="small" style="color:var(--danger)">${esc(r.why)}</div>` : ''}${r.skip ? `<div class="small" style="color:var(--warn)">${esc(r.skip)}</div>` : ''}</div>
      <div class="fx-old"><span class="small faint">Now</span><div>${esc(r.old) || '<span class="faint">(empty)</span>'}</div></div>
      <div class="fx-new"><span class="small faint">New</span>${r.skip ? '<div class="faint">—</div>' : `<input data-fnew="${i}" value="${esc(r.next)}" maxlength="30">`}</div></div>`).join('')}</div>`;
  $('#fixGo').disabled = !on; $('#fixGo').textContent = on ? `Change line 2 on ${plural(on, 'profile')}` : 'Nothing to change';
  $('#fixCount').textContent = `· ${plural(fixRows.length, 'profile')}`;
}
function wireFix() {
  $('#fixBody').addEventListener('click', e => {
    const s = e.target.closest('[data-fs]'); if (s) { fixStyle = s.dataset.fs; fixRows = planLine2(fixRows.map(r => r.p), { style: fixStyle }); renderFix(); return; }
    if (e.target.id === 'fixReroll') { const off = new Set(fixRows.filter(r => !r.on).map(r => r.p.id)); fixRows = planLine2(fixRows.map(r => r.p), { style: fixStyle }); fixRows.forEach(r => { if (off.has(r.p.id)) r.on = false; }); renderFix(); }
  });
  $('#fixBody').addEventListener('change', e => {
    const i = e.target.dataset.fon; if (i != null) { fixRows[+i].on = e.target.checked; const on = fixRows.filter(r => r.on && !r.skip).length; $('#fixGo').disabled = !on; $('#fixGo').textContent = on ? `Change line 2 on ${plural(on, 'profile')}` : 'Nothing to change'; return; }
    const j = e.target.dataset.fnew; if (j != null) { const v = e.target.value.replace(/\s+/g, ' ').trim(); fixRows[+j].next = v; if (!v) fixRows[+j].on = false; }
  });
  $('#fixGo').onclick = async () => {
    const rows = fixRows.filter(r => r.on && !r.skip && r.next);
    // typed-in values: never the same as another row or something already used at that house
    const seen = new Set();
    for (const r of rows) { const k = pHouse(r.p) + '#' + Parser.normUnit(r.next); if (seen.has(k)) { toast(`Two profiles at the same house would get “${r.next}”`); return; } seen.add(k); }
    if (!await ask(`Change address line 2 on ${plural(rows.length, 'profile')}?\n\nNothing else on these profiles changes, and you can undo it right after.`, { ok: 'Change line 2' })) return;
    snapshot('fix line 2');
    const res = applyLine2(rows);
    autoLinkAll(); invalidateDoctor(); closeDlg('dlgFixL2'); save(); refresh();
    toast(`Changed line 2 on ${plural(res.n, 'profile')} — export them to your bots to use the new line 2`, { undo: true });
    if (res.ids.length && typeof selected !== 'undefined') { selected = new Set(res.ids); if (route.page === 'profiles') renderTable(); }
  };
}

/* ---------- the doctor panel on the Profiles page ---------- */
function doctorSummary() {
  const v = verdicts(); const c = { bad: 0, watch: 0, good: 0, new: 0 }; const badL2 = [];
  for (const p of state.profiles) { const r = v.get(p.id); if (!r) continue; c[r.level]++; if (r.level === 'bad' && r.fixes.includes('l2')) badL2.push(p); }
  return { c, badL2 };
}
function doctorBanner() {
  if (!state.profiles.length) return '';
  const { c, badL2 } = doctorSummary();
  if (!c.bad && !c.watch) return '';
  return `<div class="docbar ${c.bad ? 'bad' : 'watch'}"><div class="docmsg"><b>${c.bad ? plural(c.bad, 'profile') + ' should be changed' : plural(c.watch, 'profile') + ' to keep an eye on'}</b><span class="small">${c.bad ? (badL2.length ? `${badL2.length} of them need a new line 2 — the store keeps cancelling it, or tied it to the house at the quantity limit.` : 'They have problems that will stop a checkout.') : 'Some recent cancellations, nothing serious yet.'}${c.bad && c.watch ? ' · ' + c.watch + ' more to watch' : ''}</span></div>
    <div class="docacts">${c.bad ? `<button class="sm" data-pf="bad">Show them</button>` : `<button class="sm" data-pf="watch">Show them</button>`}${badL2.length ? `<button class="sm primary" id="docFixAll">New line 2 for ${badL2.length}</button>` : ''}</div></div>`;
}

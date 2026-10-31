/* Crown Tools - pre-orders. Stores email when a pre-order's card is declined (so you can update it) and again when the
   updated card is charged. This page lists every pre-order with where its payment stands, so you can see at a glance
   which declined ones you've already updated and which you still need to fix. */
'use strict';
const PRE = { f: '', q: '' };
const isPreorderOrder = o => !!o.preorder || (o.payEvents || []).some(e => e.kind === 'declined');
// where a pre-order's payment stands
//   declined - the store says the card was declined and nothing since: update the card
//   updated  - you marked it updated; waiting for the store's "payment successful" email
//   paid     - the store charged the updated card (its email, or the order shipped)
//   waiting  - no payment problems, waiting for release day
//   released - shipped / delivered with no payment problems
//   dead     - cancelled or refunded
function payState(o) {
  const ev = o.payEvents || [], last = k => { for (let i = ev.length - 1; i >= 0; i--) if (ev[i].kind === k) return ev[i]; return null; };
  const d = last('declined'), p = last('paid'), D = d ? d.date : '', P = p ? p.date : '', F = o.payFixedAt || '';
  const declines = ev.filter(e => e.kind === 'declined').length, shippedNow = isStuck(o);
  if (isDead(o)) return { k: 'dead', declines, at: o.statusAt || '' };
  if (D && (P > D || shippedNow)) return { k: 'paid', declines, at: P > D ? P : o.statusAt || '', by: P > D ? 'email' : 'shipped', fixedAt: F > D ? F : '' };
  if (D && F > D) return { k: 'updated', declines, at: F, declinedAt: D };
  if (D) return { k: 'declined', declines, at: D, last4: d.last4 || o.last4 || '' };
  if (shippedNow) return { k: 'released', declines, at: o.statusAt || '' };
  return { k: 'waiting', declines, at: '' };
}
const PAY_STATES = {
  declined: { l: 'Card declined — update it', short: 'Needs a new card', cls: 's-dead', dot: 'var(--danger)' },
  updated: { l: 'You updated it — waiting for the store to charge it', short: 'Updated', cls: 's-late', dot: 'var(--warn)' },
  paid: { l: 'Paid with the updated card', short: 'Paid', cls: 's-delivered', dot: 'var(--ok)' },
  waiting: { l: 'Waiting for release day', short: 'Waiting', cls: 's-confirmed', dot: 'var(--accent)' },
  released: { l: 'Released', short: 'Released', cls: 's-transit', dot: 'var(--info)' },
  dead: { l: 'Cancelled', short: 'Cancelled', cls: 's-dead', dot: 'var(--faint)' },
};
const PRE_FILTERS = [['todo', 'Needs a new card', s => s.k === 'declined'], ['updated', 'Updated', s => s.k === 'updated' || s.k === 'paid'], ['waiting', 'Waiting for release', s => s.k === 'waiting'], ['released', 'Released', s => s.k === 'released'], ['dead', 'Cancelled', s => s.k === 'dead'], ['all', 'All', () => true]];
const preTodoCount = () => state.orders.filter(o => isPreorderOrder(o) && payState(o).k === 'declined').length;
// small chip for order lists ("Pre-order · card declined")
function preChip(o) {
  if (!isPreorderOrder(o)) return '';
  const s = payState(o); const t = s.k === 'declined' ? 'Pre-order · card declined' : s.k === 'updated' ? 'Pre-order · card updated' : s.k === 'paid' ? 'Pre-order · paid' : 'Pre-order' + (o.releaseDate && s.k === 'waiting' ? ' · ' + fmtDate(o.releaseDate) : '');
  return `<span class="prechip pc-${s.k}">${esc(t)}</span>`;
}
function relShort(k) { const r = relDay(k); return /^(today|tomorrow|yesterday)$/.test(r) ? r : fmtDate(k); }
function preCardHtml(o) {
  const s = payState(o), S = PAY_STATES[s.k], img = orderImage(o), p = profileById(o.profileId), h = houseById(o.houseId);
  const rel = o.releaseDate || o.eta || o.estEta || '';
  const steps = (o.payEvents || []).map(e => ({ t: e.kind === 'declined' ? 'Card declined' : 'Payment went through', d: e.date, c: e.kind === 'declined' ? 'neg' : 'pos' }));
  if (o.payFixedAt) steps.push({ t: 'You updated the card', d: o.payFixedAt, c: '' });
  steps.sort((a, b) => String(a.d).localeCompare(String(b.d)));
  const card = s.k === 'declined' ? s.last4 : o.last4;
  return `<div class="ocard pcard pc-${s.k}" data-pre="${o.id}">
    <div class="otop"><div class="opic${img ? '' : ' none'}">${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '📦'}</div>
      <div class="omain"><div class="otitle">${esc(shortTitle(o)) || 'Order #' + esc(o.orderNumber || '—')}</div><div class="ometa">${storeBadge(o.store)}<span class="mono">#${esc(o.orderNumber || '—')}</span><button class="ghost sm icopy" data-precopy="${esc(o.orderNumber || '')}" title="Copy order number" aria-label="Copy order number">⧉</button></div></div></div>
    <span class="ostat ${S.cls}"><i style="background:${S.dot}"></i>${esc(S.l)}${s.k === 'declined' && s.declines > 1 ? ` (${s.declines}×)` : ''}</span>
    <div class="prefacts">
      <div><span>Releases</span><b>${rel ? esc(fmtDate(rel)) : '—'}</b>${rel && rel >= todayKey() ? `<i>${esc(relDay(rel))}</i>` : ''}</div>
      <div><span>Card</span><b>${card ? '•••• ' + esc(card) : '—'}</b></div>
      <div><span>Total</span><b>${o.total != null ? fmtMoney(o.total) : '—'}</b></div>
      <div><span>Profile</span><b class="ellipsis">${p ? esc(p.name || 'Untitled') : '—'}</b>${o.recipientEmail ? `<i class="ellipsis">${esc(o.recipientEmail)}</i>` : ''}</div>
    </div>
    ${steps.length ? `<div class="pretl">${steps.map(x => `<span class="${x.c}">${esc(x.t)} <b>${esc(fmtDate(x.d))}</b></span>`).join('<i>›</i>')}</div>` : ''}
    <div class="iacts">${s.k === 'declined' ? `<button class="sm primary" data-prefix="${o.id}">✓ I updated the card</button>` : ''}${s.k === 'updated' ? `<button class="sm" data-preundo="${o.id}">Not updated yet</button>` : ''}<span class="spacer"></span>${h ? `<span class="small faint ellipsis" style="max-width:45%">⌂ ${esc(houseLabel(h))}</span>` : ''}<button class="sm ghost" data-preopen="${o.id}">Open order</button></div></div>`;
}
PAGES.preorders = {
  render() {
    const pg = $('#pg-preorders');
    const all = state.orders.filter(isPreorderOrder).map(o => ({ o, s: payState(o) }));
    const cnt = k => all.filter(x => PRE_FILTERS.find(f => f[0] === k)[2](x.s)).length;
    if (!PRE.f) PRE.f = cnt('todo') ? 'todo' : 'all';
    const f = PRE_FILTERS.find(x => x[0] === PRE.f) || PRE_FILTERS[5], q = PRE.q.trim().toLowerCase();
    const list = all.filter(x => f[2](x.s)).filter(({ o }) => !q || [o.orderNumber, orderTitle(o), (profileById(o.profileId) || {}).name, o.recipientEmail, o.last4, Parser.storeInfo(o.store).label].some(v => String(v || '').toLowerCase().includes(q)));
    const urgent = x => x.s.k === 'declined' ? 0 : x.s.k === 'updated' ? 1 : 2;
    list.sort((a, b) => urgent(a) - urgent(b) || String(a.o.releaseDate || '9999').localeCompare(String(b.o.releaseDate || '9999')) || String(b.o.orderDate).localeCompare(String(a.o.orderDate)));
    const todo = cnt('todo'), upd = all.filter(x => x.s.k === 'updated').length, paid = all.filter(x => x.s.k === 'paid').length;
    const soon = all.filter(x => x.s.k === 'declined' && x.o.releaseDate && x.o.releaseDate <= dayKey(new Date(Date.now() + 7 * 864e5))).length;
    pg.innerHTML = `<div class="pagehead"><h1>Pre-orders</h1><span class="sub">${plural(all.length, 'pre-order')}${todo ? ` · ${todo} need${todo === 1 ? 's' : ''} a new card` : ''}</span><div class="spacer"></div>
        ${PRE.f === 'todo' && todo > 1 ? '<button id="preAllFix">Mark all shown as updated</button>' : ''}<button class="primary" data-nav="orders">All orders</button></div>
      ${all.length ? `<div class="hero ${todo ? 'prehero' : ''}"><div class="hero-l">Need a new card</div><div class="hero-v">${todo}</div><div class="hero-s">${todo ? (soon ? `${soon} release${soon === 1 ? 's' : ''} within a week — fix ${soon === 1 ? 'that one' : 'those'} first` : 'Update the card on each, then tap “I updated the card”') : 'Every declined pre-order has been updated 👑'}</div>
        <div class="hero-tiles"><button class="htile" data-pref="updated"><span>Updated</span><b>${upd + paid}</b><i>${paid} charged${upd ? ` · ${upd} waiting on the store` : ''}</i></button><button class="htile" data-pref="waiting"><span>Waiting for release</span><b>${cnt('waiting')}</b><i>no payment problems</i></button><button class="htile" data-pref="released"><span>Released</span><b>${cnt('released')}</b><i>shipped or delivered</i></button><button class="htile" data-pref="dead"><span>Cancelled</span><b>${cnt('dead')}</b><i>pre-orders</i></button></div></div>` : ''}
      <div class="toolbar"><input class="search" data-search id="preQ" placeholder="Search order #, item, profile, email, last 4…" value="${esc(PRE.q)}">
        <div class="pills" id="preF">${PRE_FILTERS.map(([k, l]) => `<button class="chip ${PRE.f === k ? 'on' : ''}" data-pref="${k}">${l}<span class="n">${cnt(k)}</span></button>`).join('')}</div></div>
      ${list.length ? `<div class="olist">${list.map(x => preCardHtml(x.o)).join('')}</div>`
        : `<div class="empty">${all.length ? (PRE.f === 'todo' ? 'Nothing needs a new card right now. 👑' : 'No pre-orders match.') : 'No pre-orders yet. Crown Tools spots pre-orders from the store’s emails — the order confirmation, the “we’ll charge your card soon” reminder, and the card-declined and payment-successful emails — and lists them here so you can see which declined ones you’ve already updated.'}</div>`}
      <div class="note small">How it works: when a store emails that a pre-order’s card was declined, it shows up under <b>Needs a new card</b>. After you change the card on the store’s site, tap <b>I updated the card</b> so you know it’s done. When the store’s “payment successful” email arrives (or the order ships) it turns <b>Paid</b> by itself.</div>`;
    $('#preQ').oninput = debounce(e => { PRE.q = e.target.value; PAGES.preorders.render(); }, 160);
    pg.querySelectorAll('[data-pref]').forEach(b => b.onclick = () => { PRE.f = b.dataset.pref; PAGES.preorders.render(); });
    if ($('#preAllFix')) $('#preAllFix').onclick = async () => { const ids = list.filter(x => x.s.k === 'declined').map(x => x.o.id); if (!await ask(`Mark ${plural(ids.length, 'pre-order')} as updated?\n\nDo this once you’ve changed the card on each of them.`)) return; snapshot('mark pre-orders updated'); const now = new Date().toISOString(); state.orders.forEach(o => { if (ids.includes(o.id)) { o.payFixedAt = now; o.updatedAt = Date.now(); } }); save(); refresh(); toast(`Marked ${plural(ids.length, 'pre-order')} updated`, { undo: true }); };
    const ol = pg.querySelector('.olist');
    if (ol) ol.onclick = e => {
      const fix = e.target.closest('[data-prefix]'), un = e.target.closest('[data-preundo]'), cp = e.target.closest('[data-precopy]');
      if (cp) { e.stopPropagation(); copyText(cp.dataset.precopy, 'Order number'); return; }
      if (fix || un) {
        e.stopPropagation(); const o = state.orders.find(x => x.id === (fix || un).dataset[fix ? 'prefix' : 'preundo']); if (!o) return;
        snapshot(fix ? 'card updated' : 'card not updated'); if (fix) o.payFixedAt = new Date().toISOString(); else delete o.payFixedAt; o.updatedAt = Date.now(); save(); refresh();
        toast(fix ? 'Marked updated' : 'Back to needs a new card', { undo: true }); return;
      }
      const op = e.target.closest('[data-preopen]'); if (op) { openOrder(op.dataset.preopen); return; }
      if (e.target.closest('button, a')) return;
      const c = e.target.closest('[data-pre]'); if (c) openOrder(c.dataset.pre);
    };
  },
};

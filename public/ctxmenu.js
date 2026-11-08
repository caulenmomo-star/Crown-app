/* Kingpin - right-click menus, like a real app.
   Right-click a profile, account, card or order for the things you'd do to it: open it, move it to another group,
   set its status, copy it, duplicate it, delete it. If it's part of what you've selected, the action applies to all of
   them; if not, it becomes the selection (the way Finder works). Text boxes and links keep the normal menu so copy and
   paste still work. Keyboard: arrows to move, Enter to pick, Esc to close. */
'use strict';
// what each list's right-click menu offers. sel: the selection Set. Items run the same buttons the selection bar has.
const CTX = [
  { page: 'profiles', row: '#rows tr[data-id]', attr: 'data-id', set: () => selected, setSel: s => { selected = s; }, draw: () => renderTable(), noun: 'profile',
    items: id => [
      { label: 'Open', key: 'Enter', run: () => openProfile(id), one: true },
      '-',
      { label: 'Move to', sub: '#moveSel' },
      { label: 'Edit selected…', click: '#selEditBtn' },
      { label: 'Duplicate', click: '#dupBtn' },
      { label: 'Export…', click: '#selExportBtn' },
      '-',
      { label: 'Copy email', run: ids => ctxCopy(ids.map(x => (prof(x) || {}).email), 'Email') },
      { label: 'Copy address', run: ids => ctxCopy(ids.map(x => { const p = prof(x) || {}; return [p.shipAddr1, p.shipAddr2, `${p.shipCity || ''}, ${p.shipState || ''} ${p.shipZip || ''}`.trim()].filter(Boolean).join(', '); }), 'Address') },
      '-',
      { label: 'Delete', danger: true, click: '#delBtn' },
    ] },
  { page: 'accounts', row: 'tr[data-acc]', attr: 'data-acc', set: () => accSel, setSel: s => { accSel = s; }, draw: () => PAGES.accounts.render(), noun: 'account',
    items: id => [
      { label: 'Open', key: 'Enter', run: () => openAccount(id), one: true },
      '-',
      { label: 'Edit selected…', click: '#acEditSel' },
      { label: 'Move to group', sub: '#acMove' },
      { label: 'Set status', sub: '#acSetStatus' },
      '-',
      { label: 'Copy login (email:password)', click: '#acCopySel' },
      { label: 'Copy email', run: ids => ctxCopy(ids.map(x => ((state.accounts || []).find(a => a.id === x) || {}).email), 'Email') },
      '-',
      { label: 'Delete', danger: true, click: '#acDelSel' },
    ] },
  { page: 'cards', row: 'tr[data-card]', attr: 'data-card', set: () => cardSel, setSel: s => { cardSel = s; }, draw: () => PAGES.cards.render(), noun: 'card',
    items: id => [
      { label: 'Open', key: 'Enter', run: () => openCard(id), one: true },
      '-',
      { label: 'Edit selected…', click: '#cdEditSel' },
      { label: 'Move to group', sub: '#cdMove' },
      { label: 'Set status', sub: '#cdSetStatus' },
      { label: 'Put on profiles…', click: '#cdAssignSel' },
      '-',
      { label: 'Copy card details', click: '#cdCopySel' },
      '-',
      { label: 'Delete', danger: true, click: '#cdDel' },
    ] },
  { page: 'accounts', row: 'tr[data-eml]', attr: 'data-eml', set: () => emlSel, setSel: s => { emlSel = s; }, draw: () => PAGES.accounts.render(), noun: 'email',
    items: id => [
      { label: 'Edit…', key: 'Enter', run: () => meEditEmails([id]), one: true },
      { label: 'Edit selected…', click: '#emEditSel' },
      { label: 'Move to group', sub: '#emMove' },
      '-',
      { label: 'Copy', click: '#emCopySel' },
      '-',
      { label: 'Delete', danger: true, click: '#emDelSel' },
    ] },
  { page: 'orders', row: '.otable tr[data-oid], .olist .ocard[data-oid]', attr: 'data-oid', set: () => oSelected, setSel: s => { oSelected = s; }, draw: () => PAGES.orders.render(), noun: 'order',
    items: id => [
      { label: 'Open', key: 'Enter', run: () => openOrder(id), one: true },
      '-',
      { label: 'Edit selected…', click: '#oEditSel' },
      { label: 'Set status', sub: '#oSetStatus' },
      '-',
      { label: 'Copy order number', run: ids => ctxCopy(ids.map(x => (state.orders.find(o => o.id === x) || {}).orderNumber), 'Order number') },
      { label: 'Copy tracking number', run: ids => ctxCopy(ids.flatMap(x => ((state.orders.find(o => o.id === x) || {}).tracking || []).map(t => t && t.number)), 'Tracking number') },
      '-',
      { label: 'Delete', danger: true, click: '#oDel' },
    ] },
];
const prof = id => state.profiles.find(p => p.id === id);
function ctxCopy(vals, what) {
  vals = vals.map(v => String(v || '').trim()).filter(Boolean);
  if (!vals.length) { toast(`No ${what.toLowerCase()} to copy`); return; }
  copyText(vals.join('\n'), vals.length > 1 ? `${vals.length} × ${what.toLowerCase()}` : what);
}
let ctxEl = null, ctxSubEl = null;
function ctxClose() { if (ctxSubEl) { ctxSubEl.remove(); ctxSubEl = null; } if (ctxEl) { ctxEl.remove(); ctxEl = null; } }
function ctxPlace(el, x, y, alt) {
  const r = el.getBoundingClientRect(), W = innerWidth, H = innerHeight;
  if (x + r.width > W - 6) x = alt != null ? alt - r.width : W - r.width - 6;
  if (y + r.height > H - 6) y = Math.max(6, H - r.height - 6);
  el.style.left = Math.max(6, x) + 'px'; el.style.top = Math.max(6, y) + 'px';
}
// a submenu is the options of one of the selection bar's dropdowns (move to group, set status…)
function ctxSubItems(sel) {
  const s = document.querySelector(sel); if (!s) return [];
  return [...s.options].filter(o => o.value !== '' && !o.disabled).map(o => ({ label: o.textContent.replace(/…$/, '…'), run: () => { s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); } }));
}
function ctxBuild(items, cls) {
  const m = document.createElement('div'); m.className = 'ctxmenu' + (cls ? ' ' + cls : ''); m.setAttribute('role', 'menu');
  m.innerHTML = items.map((it, i) => it === '-' ? '<div class="ctxsep" role="separator"></div>' : it.head ? `<div class="ctxhead">${esc(it.label)}</div>`
    : `<button type="button" role="menuitem" class="ctxitem${it.danger ? ' danger' : ''}${it.sub ? ' hassub' : ''}" data-ctx="${i}" ${it.disabled ? 'disabled' : ''}><span>${esc(it.label)}</span>${it.sub ? '<span class="ctxarrow">›</span>' : it.hint ? `<span class="ctxhint">${esc(it.hint)}</span>` : ''}</button>`).join('');
  document.body.appendChild(m); return m;
}
function ctxOpenSub(btn, it) {
  if (ctxSubEl) { ctxSubEl.remove(); ctxSubEl = null; }
  const subs = ctxSubItems(it.sub); if (!subs.length) return;
  ctxSubEl = ctxBuild(subs, 'sub'); ctxSubEl.__items = subs; ctxSubEl.__parentBtn = btn;
  const r = btn.getBoundingClientRect(); ctxPlace(ctxSubEl, r.right - 2, r.top - 5, r.left + 2);
  $$('.ctxitem.open', ctxEl).forEach(b => b.classList.remove('open')); btn.classList.add('open');
  return ctxSubEl;
}
function ctxShow(x, y, items, run) {
  ctxClose();
  ctxEl = ctxBuild(items); ctxEl.__items = items; ctxEl.__run = run; ctxEl.__at = Date.now();
  ctxPlace(ctxEl, x, y);
  const first = ctxEl.querySelector('.ctxitem:not([disabled])'); if (first) first.focus({ preventScroll: true });
}
function ctxActivate(btn) {
  const m = btn.closest('.ctxmenu'), it = m.__items[+btn.dataset.ctx]; if (!it || btn.disabled) return;
  if (it.sub) { const s = ctxOpenSub(btn, it); if (s) { const f = s.querySelector('.ctxitem'); if (f) f.focus({ preventScroll: true }); } return; }
  const run = (m === ctxSubEl ? ctxEl : m).__run; ctxClose(); run(it);
}
function wireCtxMenu() {
  document.addEventListener('contextmenu', e => {
    const t = e.target; if (!(t instanceof Element)) return;
    // keep the browser's menu where it's useful: typing boxes, links, and text you've highlighted
    if (t.closest('input, textarea, select, [contenteditable], a[href]') || String(getSelection() || '').trim()) return;
    if (typeof cryptoKey === 'undefined' || !cryptoKey || document.querySelector('dialog[open]')) { if (t.closest('#app')) e.preventDefault(); return; }
    const g = CTX.find(c => typeof route !== 'undefined' && route.page === c.page && t.closest(c.row));
    if (!g) {
      // anywhere else in the app: no web-page menu (Back, Save as, Print…) — just what makes sense here
      if (!t.closest('#app')) return;
      e.preventDefault();
      const items = [{ label: 'Undo', hint: '⌘Z', run: () => undo(), disabled: typeof lastUndo === 'undefined' || !lastUndo }, '-', { label: 'Reload', run: () => location.reload() }];
      ctxShow(e.clientX, e.clientY, items, it => it.run()); return;
    }
    e.preventDefault();
    const row = t.closest(g.row), id = row.getAttribute(g.attr), S = g.set();
    // right-clicking something outside the selection makes it the selection, like Finder
    if (!S.has(id)) { g.setSel(new Set([id])); if (typeof SR_ANCHOR !== 'undefined') SR_ANCHOR[g.attr === 'data-oid' ? 'data-ocb' : g.attr === 'data-id' ? 'data-cb' : g.attr === 'data-acc' ? 'data-acb' : 'data-ccb'] = id; g.draw(); }
    const n = g.set().size, items = g.items(id).map(it => it === '-' ? it : Object.assign({}, it, it.one && n > 1 ? { label: it.label + ' this one' } : {}));
    // a heading says how many it'll act on
    ctxShow(e.clientX, e.clientY, [{ label: n > 1 ? `${n} ${g.noun}s selected` : `1 ${g.noun}`, head: true }, ...items], it => {
      if (it.run) it.run(it.one ? id : [...g.set()]);
      else if (it.click) { const b = document.querySelector(it.click); if (b) b.click(); }
    });
  });
  document.addEventListener('click', e => {
    const b = e.target instanceof Element && e.target.closest('.ctxitem'); if (b) { e.preventDefault(); e.stopPropagation(); ctxActivate(b); return; }
    if (ctxEl && !(e.target instanceof Element && e.target.closest('.ctxmenu'))) ctxClose();
  }, true);
  document.addEventListener('pointerdown', e => { if (ctxEl && !(e.target instanceof Element && e.target.closest('.ctxmenu'))) ctxClose(); }, true);
  document.addEventListener('mouseover', e => {
    const b = e.target instanceof Element && e.target.closest('.ctxitem'); if (!b) return;
    const m = b.closest('.ctxmenu'); if (m !== ctxEl) { if (!b.disabled && document.activeElement !== b) b.focus({ preventScroll: true }); return; }
    const it = m.__items[+b.dataset.ctx]; if (!b.disabled && document.activeElement !== b) b.focus({ preventScroll: true });
    if (it && it.sub && !b.disabled) { if (!ctxSubEl || ctxSubEl.__parentBtn !== b) ctxOpenSub(b, it); }
    else if (ctxSubEl) { ctxSubEl.remove(); ctxSubEl = null; $$('.ctxitem.open', ctxEl).forEach(x => x.classList.remove('open')); }
  });
  document.addEventListener('keydown', e => {
    if (!ctxEl) return;
    const m = ctxSubEl && ctxSubEl.contains(document.activeElement) ? ctxSubEl : ctxEl;
    const btns = [...m.querySelectorAll('.ctxitem:not([disabled])')], i = btns.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (m === ctxSubEl) { const p = ctxSubEl.__parentBtn; ctxSubEl.remove(); ctxSubEl = null; p.classList.remove('open'); p.focus({ preventScroll: true }); } else ctxClose(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = btns.length; if (n) btns[((i < 0 ? (e.key === 'ArrowDown' ? -1 : 0) : i) + (e.key === 'ArrowDown' ? 1 : -1) + n) % n].focus({ preventScroll: true }); }
    else if (e.key === 'ArrowRight' && i >= 0 && btns[i].classList.contains('hassub')) { e.preventDefault(); ctxActivate(btns[i]); }
    else if (e.key === 'ArrowLeft' && m === ctxSubEl) { e.preventDefault(); const p = ctxSubEl.__parentBtn; ctxSubEl.remove(); ctxSubEl = null; p.classList.remove('open'); p.focus({ preventScroll: true }); }
    else if ((e.key === 'Enter' || e.key === ' ') && i >= 0) { e.preventDefault(); ctxActivate(btns[i]); }
    else if (e.key === 'Tab') { e.preventDefault(); }
  }, true);
  // close when the page moves or the window changes (but not from the list keeping its place right after opening)
  window.addEventListener('scroll', e => { if (ctxEl && Date.now() - ctxEl.__at > 300 && !(e.target instanceof Element && e.target.closest('.ctxmenu'))) ctxClose(); }, true);
  ['resize', 'blur', 'hashchange'].forEach(ev => window.addEventListener(ev, () => { if (ctxEl) ctxClose(); }));
}

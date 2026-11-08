/* Crown Tools - selecting lots of things at once, the way a file list works:
   - Shift-click a checkbox (or a row): selects (or unselects) everything between it and the last one you clicked.
   - Cmd/Ctrl-click a row: adds or removes just that row, without opening it.
   - Cmd/Ctrl+A: selects everything shown on the page. Esc: clears the selection.
   Works on Profiles, Accounts, Cards, Orders (table and cards), and the checkbox lists in windows. */
'use strict';
// lists whose selection lives in a Set: the checkbox attribute, the row, the Set, how to redraw, the "all" box
const SELR = [
  { attr: 'data-cb', row: '#rows tr[data-id]', set: () => selected, draw: () => renderTable(), all: '#selAll', page: 'profiles' },
  { attr: 'data-acb', row: 'tr[data-acc]', set: () => accSel, draw: () => PAGES.accounts.render(), all: '#acAll', page: 'accounts' },
  { attr: 'data-ccb', row: 'tr[data-card]', set: () => cardSel, draw: () => PAGES.cards.render(), all: '#cdAll', page: 'cards' },
  { attr: 'data-ocb', row: '.otable tr[data-oid]', set: () => oSelected, draw: () => PAGES.orders.render(), all: '#oAll', page: 'orders' },
  // order cards (no checkbox): selecting works once select mode is on or something is selected
  { attr: 'data-oid', row: '.olist .ocard[data-oid]', cards: true, set: () => oSelected, draw: () => PAGES.orders.render(), page: 'orders', on: () => oSelMode || oSelected.size > 0 },
];
// checkbox lists in windows: their own change handlers do the work
const SELR_DOM = ['data-ifo', 'data-fon', 'data-pbk'];
const SR_ANCHOR = {};
const srShown = el => !!(el.offsetParent || el.getClientRects().length);
function srIds(g) {
  const els = g.cards ? $$(g.row) : $$(`input[type="checkbox"][${g.attr}]`);
  const out = []; for (const el of els) if (srShown(el)) { const id = el.getAttribute(g.attr); if (id && !out.includes(id)) out.push(id); }
  return out;
}
function srRange(g, from, to) {
  const ids = srIds(g), a = ids.indexOf(from), b = ids.indexOf(to);
  if (a < 0 || b < 0) return null;
  return ids.slice(Math.min(a, b), Math.max(a, b) + 1);
}
const srTyping = el => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !(el.tagName === 'INPUT' && /^(checkbox|radio|button|submit)$/.test(el.type)));
const srDialogOpen = () => !!document.querySelector('dialog[open]');
function wireSelRange() {
  // no text highlighting when shift-clicking down a list
  document.addEventListener('mousedown', e => {
    if (!e.shiftKey || !(e.target instanceof Element)) return;
    if (e.target.closest(SELR.map(g => g.row).join(',') + ',' + SELR_DOM.map(a => `[${a}]`).join(',') + ',label.li')) e.preventDefault();
  }, true);
  document.addEventListener('click', e => {
    const t = e.target; if (!(t instanceof Element)) return;
    // checkbox lists in windows
    const dcb = t.closest(SELR_DOM.map(a => `input[type="checkbox"][${a}]`).join(','));
    if (dcb) {
      const attr = SELR_DOM.find(a => dcb.hasAttribute(a)), id = dcb.getAttribute(attr), box = dcb.closest('dialog, .page') || document;
      const prev = SR_ANCHOR[attr]; SR_ANCHOR[attr] = id;
      if (!e.shiftKey || prev == null || prev === id) return;
      const els = [...box.querySelectorAll(`input[type="checkbox"][${attr}]`)].filter(srShown), ids = els.map(x => x.getAttribute(attr));
      const a = ids.indexOf(prev), b = ids.indexOf(id); if (a < 0 || b < 0) return;
      for (const x of els.slice(Math.min(a, b), Math.max(a, b) + 1)) if (x !== dcb && x.checked !== dcb.checked && !x.disabled) { x.checked = dcb.checked; x.dispatchEvent(new Event('change', { bubbles: true })); }
      return;
    }
    for (const g of SELR) {
      if (typeof route === 'undefined' || route.page !== g.page) continue;
      if (g.cards) {
        const card = t.closest(g.row); if (!card || !g.on() && !(e.metaKey || e.ctrlKey || e.shiftKey)) continue;
        if (t.closest('a, button, input, select, textarea')) return;
        const id = card.getAttribute(g.attr);
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          e.preventDefault(); e.stopPropagation();
          const S = g.set(), prev = SR_ANCHOR[g.attr];
          if (e.shiftKey && prev != null) (srRange(g, prev, id) || [id]).forEach(x => S.add(x));
          else S.has(id) ? S.delete(id) : S.add(id);
          SR_ANCHOR[g.attr] = id; g.draw();
        } else SR_ANCHOR[g.attr] = id;
        return;
      }
      const cb = t.closest(`input[type="checkbox"][${g.attr}]`);
      if (cb) {
        const id = cb.getAttribute(g.attr), prev = SR_ANCHOR[g.attr]; SR_ANCHOR[g.attr] = id;
        // the list's own handler sets this one and redraws; we add the ones in between first
        if (e.shiftKey && prev != null && prev !== id) { const S = g.set(); (srRange(g, prev, id) || []).forEach(x => { if (x !== id) cb.checked ? S.add(x) : S.delete(x); }); }
        return;
      }
      const row = t.closest(g.row);
      if (row && (e.shiftKey || e.metaKey || e.ctrlKey) && !t.closest('a, button, input, select, textarea, [contenteditable]')) {
        const box = row.querySelector(`[${g.attr}]`); if (!box) continue;
        e.preventDefault(); e.stopPropagation();
        const id = box.getAttribute(g.attr), S = g.set(), prev = SR_ANCHOR[g.attr];
        if (e.shiftKey && prev != null) (srRange(g, prev, id) || [id]).forEach(x => S.add(x));
        else S.has(id) ? S.delete(id) : S.add(id);
        SR_ANCHOR[g.attr] = id; g.draw();
        return;
      }
    }
  }, true);
  document.addEventListener('keydown', e => {
    if (srDialogOpen() || srTyping(document.activeElement) || typeof route === 'undefined' || !cryptoKey) return;
    const g = SELR.find(x => x.page === route.page && !x.cards); if (!g) return;
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') {
      const ids = route.page === 'orders' && typeof oView === 'function' && oView() === 'cards' ? srIds(SELR.find(x => x.cards)) : srIds(g);
      if (!ids.length) return;
      e.preventDefault(); const S = g.set(); ids.forEach(x => S.add(x)); g.draw();
      toast(`Selected ${plural(ids.length, 'item')} · Esc to clear`);
    } else if (e.key === 'Escape' && g.set().size) {
      e.preventDefault(); g.set().clear(); SR_ANCHOR[g.attr] = null; g.draw();
    }
  });
}

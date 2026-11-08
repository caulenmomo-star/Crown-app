/* Kingpin - fits every page on a phone without scrolling sideways.
   - A row of filter chips that doesn't fit becomes one dropdown (picking from it clicks the same chip).
   - A page's action buttons that don't fit: the main button stays, the rest go under "More".
   Runs after anything on the page is redrawn; on a computer or tablet nothing changes. */
'use strict';
const PF_Q = window.matchMedia('(max-width:760px)');
const pfShown = el => !!(el.offsetParent || el.getClientRects().length);
// a chip's words, with its count in brackets: "All 8" → "All (8)"
function pfLabel(b) {
  if (!b.textContent.trim()) return b.getAttribute('aria-label') || b.title || '';
  const parts = [...b.childNodes].map(n => n.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const last = parts[parts.length - 1];
  if (parts.length > 1 && /^[\d,.$]+$/.test(last)) return parts.slice(0, -1).join(' ') + ' (' + last + ')';
  return parts.join(' ');
}
function pfStrip(st) {
  if (!pfShown(st) && !st.dataset.pf) return;
  const btns = [...st.children].filter(b => b.tagName === 'BUTTON' && !b.hidden && getComputedStyle(b).display !== 'none');
  if (!st.dataset.pf) {
    if (btns.length < 3 || [...st.children].some(c => c.tagName !== 'BUTTON' && c.tagName !== 'SPAN')) return;
    if (st.scrollWidth <= st.clientWidth + 4 && st.getBoundingClientRect().right <= document.documentElement.clientWidth + 1) return;
    st.dataset.pf = '1'; st.classList.add('pfhid');
    const sel = document.createElement('select'); sel.className = 'pfsel'; sel.setAttribute('aria-label', st.getAttribute('aria-label') || 'Show');
    sel.onchange = () => { const b = (st.__btns || [])[+sel.value]; if (b) b.click(); };
    st.parentNode.insertBefore(sel, st); st.__sel = sel;
  }
  // keep the dropdown matching the chips (they can change without the page being redrawn)
  const on = btns.findIndex(b => b.classList.contains('on') || b.classList.contains('active') || b.getAttribute('aria-pressed') === 'true');
  const sig = btns.map(pfLabel).join('|') + '#' + on;
  if (st.__sig === sig || !st.__sel) return;
  st.__sig = sig; st.__btns = btns;
  st.__sel.innerHTML = btns.map((b, i) => `<option value="${i}" ${i === on ? 'selected' : ''}>${esc(pfLabel(b))}</option>`).join('') + (on < 0 ? '<option value="" selected disabled hidden>Choose…</option>' : '');
}
// a page's buttons (or a toolbar's): on a phone the main one stays and the rest go under "More"
function pfActs(box, btnsOnly) {
  if (box.dataset.pf || !pfShown(box)) return;
  const kids = [...box.children].filter(pfShown);
  const isBtn = k => (k.tagName === 'BUTTON' || k.tagName === 'A') && !k.classList.contains('pfmore');
  const prim = kids.find(k => isBtn(k) && k.classList.contains('primary'));
  // keep the main button and whatever else fits on one line beside it; only the rest go under "More"
  const avail = box.getBoundingClientRect().width || box.parentElement.getBoundingClientRect().width, gap = 8, moreW = 84;
  // the main button first, then ones marked to stay in view (like 📷 From photos), then the rest
  const order = [prim, ...kids.filter(k => k !== prim && k.hasAttribute('data-pfkeep')), ...kids.filter(k => k !== prim && !k.hasAttribute('data-pfkeep'))].filter(Boolean);
  let used = 0; const keep = new Set(), rest = [];
  for (const k of order) {
    const w = k.getBoundingClientRect().width + gap;
    if (!isBtn(k)) { keep.add(k); if (!btnsOnly) used += w; continue; }  // in a toolbar the search box and filters sit on their own lines
    if (k === prim || (!btnsOnly && used + w + moreW <= avail)) { keep.add(k); used += w; } else rest.push(k);  // toolbars: all extra buttons in one More, next to the filters
  }
  // nothing left over that a "More" would save
  if (rest.length === 0 || (!btnsOnly && rest.length === 1 && used + rest[0].getBoundingClientRect().width + gap <= avail)) return;
  box.dataset.pf = '1';
  rest.forEach(k => k.classList.add('pfhid'));
  const more = document.createElement('button'); more.type = 'button'; more.className = 'pfmore'; more.textContent = 'More ▾';
  more.onclick = e => {
    e.stopPropagation();
    const r = more.getBoundingClientRect();
    ctxShow(Math.max(8, r.right - 220), r.bottom + 4, rest.map(k => ({ label: pfLabel(k) || 'Action', el: k, disabled: k.disabled })), it => it.el.click());
  };
  box.appendChild(more);
}
let pfT = 0;
function pfRun() {
  if (!PF_Q.matches) return;
  document.querySelectorAll('#main .chips, #main .pills').forEach(pfStrip);
  // chips that only change highlight (no redraw) — check again shortly after any click

  document.querySelectorAll('#main .pacts').forEach(pfActs);
  document.querySelectorAll('#main .toolbar').forEach(tb => { const btns = [...tb.children].filter(k => k.tagName === 'BUTTON' && pfShown(k) && !k.classList.contains('primary')); if (btns.length >= 2) pfActs(tb, true); });
}
function wirePhoneFit() {
  document.addEventListener('click', () => setTimeout(pfRun, 60), true);
  new MutationObserver(() => { cancelAnimationFrame(pfT); pfT = requestAnimationFrame(pfRun); }).observe(document.getElementById('main'), { childList: true, subtree: true });
  // turning the phone (or resizing a window) re-draws the page so the right layout shows
  PF_Q.addEventListener('change', () => { if (typeof renderPage === 'function' && cryptoKey) renderPage(); });
  pfRun();
}

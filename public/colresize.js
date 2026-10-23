/* Crown Tools - resizable table columns (Profiles, Orders, Accounts, Cards) on computers. Drag the edge of a column
   header to make it wider or narrower; the table scrolls sideways when it's wider than the screen, so nothing on the
   right gets cut off. Widths are remembered on this device; double-click an edge to put the table back to normal. */
'use strict';
const RESIZABLE = { ptable: 'profiles', otable: 'orders', atable: 'accounts', ctable: 'cards' };
const colKey = th => th.dataset.sort || th.dataset.col || th.textContent.replace(/[▲▼]/g, '').trim().toLowerCase() || 'col';
const loadCols = k => { try { return JSON.parse(localStorage.getItem('crown.cols.' + k) || 'null'); } catch (_) { return null; } };
const saveCols = (k, v) => { try { v ? localStorage.setItem('crown.cols.' + k, JSON.stringify(v)) : localStorage.removeItem('crown.cols.' + k); } catch (_) { } };
// the narrowest a column can be and still show its heading in full
function headMin(th) { const c = th.cloneNode(true); c.querySelectorAll('.colgrip').forEach(g => g.remove()); const m = document.createElement('span'); m.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:' + getComputedStyle(th).font; m.textContent = c.textContent.trim(); document.body.appendChild(m); const w = m.getBoundingClientRect().width; m.remove(); const cs = getComputedStyle(th); return Math.ceil(w + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 14); }
const isTableMode = () => window.matchMedia('(min-width: 1101px)').matches;
function tableKey(t) { for (const c in RESIZABLE) if (t.classList.contains(c)) return RESIZABLE[c]; return ''; }
const visibleThs = t => [...t.querySelectorAll('thead th')].filter(th => th.offsetParent !== null || getComputedStyle(th).display !== 'none');
// apply saved widths: the table switches to fixed columns and becomes exactly as wide as its columns
function applyCols(t) {
  const k = tableKey(t), saved = loadCols(k), ths = [...t.querySelectorAll('thead th')];
  if (!saved || !isTableMode()) { t.classList.remove('colsized'); t.style.width = ''; ths.forEach(th => { th.style.width = ''; }); return; }
  let total = 0;
  for (const th of ths) {
    if (getComputedStyle(th).display === 'none') continue;
    const w = th.classList.contains('cb') ? 36 : (saved[colKey(th)] || Math.max(60, Math.round(th.getBoundingClientRect().width)) || 120);
    th.style.width = w + 'px'; total += w;
  }
  t.classList.add('colsized'); t.style.width = total + 'px';
}
function enhanceTable(t) {
  if (!tableKey(t) || t.dataset.resizable) { if (t.dataset.resizable) applyCols(t); return; }
  t.dataset.resizable = '1';
  const wrap = t.closest('.tablewrap'); if (wrap) wrap.classList.add('scrollwrap'); // scrolls in its own box: header stays put, sideways scrollbar in view
  t.querySelectorAll('thead th').forEach(th => {
    if (th.classList.contains('cb') || th.querySelector('.colgrip')) return;
    const g = document.createElement('span'); g.className = 'colgrip'; g.title = 'Drag to resize · double-click to reset'; g.setAttribute('aria-hidden', 'true'); th.appendChild(g);
  });
  applyCols(t);
}
let colDrag = null, swallowClick = false;
document.addEventListener('pointerdown', e => {
  const g = e.target.closest('.colgrip'); if (!g || !isTableMode()) return;
  e.preventDefault(); e.stopPropagation();
  const th = g.parentElement, t = th.closest('table'), k = tableKey(t);
  // first drag: freeze every column at the width it has now, so only the one you drag changes
  let saved = loadCols(k);
  if (!saved) { saved = {}; visibleThs(t).forEach(x => { if (!x.classList.contains('cb')) saved[colKey(x)] = Math.max(Math.round(x.getBoundingClientRect().width), headMin(x)); }); saveCols(k, saved); applyCols(t); }
  colDrag = { th, t, k, x: e.clientX, w: th.getBoundingClientRect().width, saved, min: Math.min(48, headMin(th)) };
  document.body.classList.add('colresizing'); g.setPointerCapture && g.setPointerCapture(e.pointerId);
}, true);
document.addEventListener('pointermove', e => {
  if (!colDrag) return;
  const w = Math.max(colDrag.min, Math.round(colDrag.w + e.clientX - colDrag.x));
  colDrag.saved[colKey(colDrag.th)] = w; colDrag.th.style.width = w + 'px';
  let total = 0; [...colDrag.t.querySelectorAll('thead th')].forEach(x => { if (getComputedStyle(x).display !== 'none') total += parseFloat(x.style.width) || x.getBoundingClientRect().width; });
  colDrag.t.style.width = total + 'px';
});
document.addEventListener('pointerup', () => {
  if (!colDrag) return;
  saveCols(colDrag.k, colDrag.saved); colDrag = null; swallowClick = true; setTimeout(() => { swallowClick = false; }, 50);
  document.body.classList.remove('colresizing');
});
// a drag shouldn't also sort the column
document.addEventListener('click', e => { if (swallowClick && e.target.closest('th')) { e.preventDefault(); e.stopPropagation(); swallowClick = false; } }, true);
document.addEventListener('dblclick', e => {
  const g = e.target.closest('.colgrip'); if (!g) return;
  e.preventDefault(); e.stopPropagation();
  const t = g.closest('table'); saveCols(tableKey(t), null); applyCols(t); toast('Columns back to normal');
}, true);
// fit the table's box to the screen below it, so its sideways scrollbar is always in view
function fitWrap(t) {
  const w = t.closest('.tablewrap'); if (!w) return;
  if (!isTableMode()) { w.style.maxHeight = ''; return; }
  const sc = w.closest('#main'), top = w.getBoundingClientRect().top + (sc ? sc.scrollTop : window.scrollY) - (sc ? sc.getBoundingClientRect().top : 0);
  const avail = (sc ? sc.clientHeight : window.innerHeight) - top - 18;
  w.style.maxHeight = Math.max(320, Math.round(avail)) + 'px';
}
// tables are re-drawn often: pick up new ones, and re-apply when the window crosses into or out of table layout
let colTick = 0;
const colScan = () => { colTick = 0; document.querySelectorAll(Object.keys(RESIZABLE).map(c => 'table.' + c).join(',')).forEach(t => { enhanceTable(t); if (t.offsetParent) fitWrap(t); }); };
new MutationObserver(() => { if (!colTick) colTick = requestAnimationFrame(colScan); }).observe(document.getElementById('main') || document.body, { childList: true, subtree: true });
window.addEventListener('resize', () => { if (!colTick) colTick = requestAnimationFrame(() => { colTick = 0; document.querySelectorAll('table[data-resizable]').forEach(t => { applyCols(t); if (t.offsetParent) fitWrap(t); }); }); });

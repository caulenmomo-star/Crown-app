/* Kingpin - on phones, category / group lists (Profiles, Accounts, Cards) fold into one dropdown button that
   shows the one you're looking at, instead of a wall of chips. Tap it to pick another, rename or add one. */
'use strict';
function catLabel(cl) {
  const add = cl.querySelector(':scope > button:not(.catdrop)'), kind = add ? add.textContent.replace(/^\+\s*new\s*/i, '').trim() : 'category';
  const act = cl.querySelector('.cat.active') || cl.querySelector('.cat');
  const name = act ? (act.querySelector('span') || act).textContent.trim() : '';
  const n = act && act.querySelector('.n') ? act.querySelector('.n').textContent.trim() : '';
  return { kind: kind.charAt(0).toUpperCase() + kind.slice(1), name, n };
}
function enhanceCatlist(cl) {
  let b = cl.querySelector(':scope > .catdrop');
  if (!b) { b = document.createElement('button'); b.type = 'button'; b.className = 'catdrop'; cl.prepend(b); }
  const L = catLabel(cl), html = `<span class="cdk">${esc(L.kind)}</span><span class="cdn ellipsis">${esc(L.name)}</span>${L.n ? `<span class="cdc">${esc(L.n)}</span>` : ''}<span class="cda">${cl.classList.contains('open') ? '▴' : '▾'}</span>`;
  if (b.innerHTML !== html) b.innerHTML = html;
  b.setAttribute('aria-expanded', cl.classList.contains('open') ? 'true' : 'false');
}
let catTick = 0;
const catScan = () => { catTick = 0; document.querySelectorAll('#main .catlist').forEach(enhanceCatlist); };
new MutationObserver(() => { if (!catTick) catTick = requestAnimationFrame(catScan); }).observe(document.getElementById('main') || document.body, { childList: true, subtree: true });
document.addEventListener('click', e => {
  const b = e.target.closest('.catdrop');
  if (b) { const cl = b.parentElement; cl.classList.toggle('open'); enhanceCatlist(cl); return; }
  // picking a category closes the dropdown (renaming / deleting / adding keeps it open)
  const c = e.target.closest('.catlist .cat');
  if (c && !e.target.closest('.act, button')) { const cl = c.closest('.catlist'); setTimeout(() => { const now = document.contains(cl) ? cl : null; if (now) { now.classList.remove('open'); enhanceCatlist(now); } }, 0); }
}, true);

/* Kingpin - keeps the browser and password managers from typing your login email into search and filter boxes.
   Saved logins only go into the sign-in fields; every other box is marked "don't fill", and if something still gets
   filled without you typing, it's cleared straight away. */
'use strict';
// boxes that are meant for logins: leave these alone
const NAF_LOGIN = 'input[type="password"], #acEmail, #lockUser, [autocomplete="username"], [autocomplete="current-password"], [autocomplete="new-password"], [autocomplete^="cc-"]';
let nafKeyAt = 0;
function nafMark(el) {
  if (!(el instanceof HTMLInputElement) || el.dataset.naf || el.matches(NAF_LOGIN)) return;
  if (!/^(text|search|email|tel|url|)$/.test(el.type)) return;
  el.dataset.naf = '1'; el.dataset.nafTyped = el.value; // whatever the app put there itself is fine
  if (!el.getAttribute('autocomplete')) el.setAttribute('autocomplete', 'off');
  // what each password manager looks for to skip a field
  el.setAttribute('data-1p-ignore', ''); el.setAttribute('data-lpignore', 'true'); el.setAttribute('data-bwignore', ''); el.setAttribute('data-form-type', 'other');
  // Chrome fills by the field's name, so give search boxes a name that isn't "email" or "username"
  if (!el.name && (el.classList.contains('search') || /search|filter/i.test(el.id + ' ' + (el.placeholder || '')))) el.name = 'crown-find-' + (el.id || 'box');
}
const nafIsSearch = el => el instanceof HTMLInputElement && (el.classList.contains('search') || el.type === 'search' || /search|filter|^q$/i.test(el.id) || /^search/i.test(el.placeholder || ''));
function wireNoAutofill() {
  document.querySelectorAll('input').forEach(nafMark);
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.tagName === 'INPUT') nafMark(n); else n.querySelectorAll && n.querySelectorAll('input').forEach(nafMark); } }).observe(document.body, { childList: true, subtree: true });
  // anything you type, paste or drop counts as you
  for (const ev of ['keydown', 'paste', 'drop', 'compositionend', 'cut']) document.addEventListener(ev, () => { nafKeyAt = Date.now(); }, true);
  // an email in a search box you didn't type yourself (what you typed is remembered, so it's never cleared)
  const looksFilled = el => /\S+@\S+\.\S+/.test(el.value) && el.value !== el.dataset.nafTyped && Date.now() - nafKeyAt > 1500;
  const undo = el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); };
  // a search box that changes without you typing (autofill) is put back to empty
  document.addEventListener('input', e => { const el = e.target; if (!nafIsSearch(el)) return; if (Date.now() - nafKeyAt <= 1500) el.dataset.nafTyped = el.value; else if (looksFilled(el)) undo(el); }, true);
  document.addEventListener('animationstart', e => { if (e.animationName === 'nafFilled' && nafIsSearch(e.target)) setTimeout(() => { if (looksFilled(e.target)) undo(e.target); }, 0); }, true);
  // some browsers fill silently (no event): check the search boxes right after unlocking and a few times after
  const sweep = () => document.querySelectorAll('input').forEach(el => { if (nafIsSearch(el) && el !== document.activeElement && looksFilled(el)) undo(el); });
  [300, 1200, 3000].forEach(t => setTimeout(sweep, t));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(sweep, 400); });
  window.addEventListener('focus', () => setTimeout(sweep, 400));
  // and again whenever the app opens after the lock screen
  const app = document.getElementById('app');
  if (app) new MutationObserver(() => { if (!app.hidden) [100, 600, 1500].forEach(t => setTimeout(sweep, t)); }).observe(app, { attributes: true, attributeFilter: ['hidden'] });
  // the lock screen has a hidden sign-in name, so saved logins go there instead of the first box they find
  const u = document.getElementById('lockUser'); if (u) { try { u.value = localStorage.getItem('crown.email') || 'Kingpin'; } catch (_) { u.value = 'Kingpin'; } }
  window.nafSweep = sweep;
}

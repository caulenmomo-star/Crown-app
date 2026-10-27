// Typing must never lose the box you're typing in (on a phone that closes the keyboard). When a page redraws while
// you're in one of its boxes, that box is kept exactly as it is - text, cursor, keyboard - and only the rest changes.
for (const k of Object.keys(PAGES)) {
  const orig = PAGES[k].render;
  PAGES[k].render = function (...args) {
    const a = document.activeElement, pg = document.getElementById('pg-' + k);
    const keep = a && pg && pg.contains(a) && a.id && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(checkbox|radio|file|range|date|button|submit)$/i.test(a.type))) ? a : null;
    const res = orig.apply(this, args);
    const swap = () => {
      if (!keep || keep.isConnected) return;
      const fresh = document.getElementById(keep.id);
      if (!fresh || fresh === keep || fresh.tagName !== keep.tagName) return;
      ['oninput', 'onkeydown', 'onkeyup', 'onchange', 'onfocus', 'onblur', 'onpaste', 'onsearch'].forEach(h => { keep[h] = fresh[h]; });
      fresh.replaceWith(keep);
      if (document.activeElement !== keep) keep.focus({ preventScroll: true });
    };
    swap(); if (res && typeof res.then === 'function') res.then(swap);
    return res;
  };
}
Crown.boot();

/* Kingpin - edit many at once (profiles, accounts, cards, orders).
   Every field starts as "Keep as is". Only a field you actually change is written to the selected items; anything you
   don't touch stays exactly as it is on each one. A field can also be emptied on purpose with "Clear".
   spec: { noun, items: () => [objects], fields: [{ k, l, g?, type: 'text'|'select'|'bool'|'date'|'area', opts?: () => [[value, label]],
           secret?, get?(o), set?(o, v, i), clear?: false, newOpt?: { label, make: async () => value }, hint? }],
           apply?(changedItems, dirtyKeys) → after writing, tokens?: true }   */
'use strict';
const ME = { spec: null, list: [], dirty: new Map() };   // k → { v } or { clear: true }
const meVal = (f, o) => f.get ? f.get(o) : o[f.k];
const meNorm = v => v == null ? '' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v);
function meDialog() {
  let d = document.getElementById('dlgMass');
  if (d) return d;
  document.body.insertAdjacentHTML('beforeend', `<dialog id="dlgMass" class="wide">
    <div class="dhead"><span id="meTitle">Edit</span><span class="muted" id="meSub" style="font-weight:400"></span><button class="ghost sm x" data-close>✕</button></div>
    <div class="dbody"><div class="note" style="margin:0 0 12px">Only the fields you change are saved. Everything you leave as <b>Keep as is</b> stays exactly the same on each one.</div>
      <div id="meRows"></div><div id="meExtra"></div></div>
    <div class="dfoot"><span class="small muted" id="meSum" style="margin-right:auto"></span><button data-close>Cancel</button><button class="primary" id="meGo" disabled>Apply</button></div></dialog>`);
  d = document.getElementById('dlgMass');
  d.addEventListener('close', () => { ME.spec = null; ME.dirty.clear(); });
  return d;
}
// what's on the selected items now: the same value on all of them, or "N different"
function meNow(f) {
  const vals = new Set(ME.list.map(o => meNorm(meVal(f, o))));
  if (vals.size === 1) {
    const v = [...vals][0];
    if (v === '') return { same: true, text: 'empty on all' };
    if (f.secret) return { same: true, text: 'the same on all' };
    const opt = f.opts ? f.opts().find(([x]) => String(x) === v) : null;
    return { same: true, v, text: (opt ? opt[1] : f.type === 'bool' ? (v === 'yes' ? 'Yes' : 'No') : v) + ' on all' };
  }
  return { same: false, text: `${vals.size} different` };
}
function meControl(f, now) {
  const id = 'me_' + f.k, dz = ME.dirty.get(f.k);
  if (f.type === 'select' || f.type === 'bool') {
    const opts = f.type === 'bool' ? [['yes', 'Yes'], ['no', 'No']] : f.opts();
    return `<select id="${id}" data-mek="${f.k}"><option value="__keep">Keep as is (${esc(now.text)})</option>${opts.map(([v, l]) => `<option value="${esc(v)}" ${dz && !dz.clear && String(dz.v) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}${f.newOpt ? `<option value="__new">${esc(f.newOpt.label)}</option>` : ''}</select>`;
  }
  const ph = dz && dz.clear ? 'Will be emptied' : `Keep as is (${now.text})`;
  const val = dz && !dz.clear ? esc(dz.v) : '';
  if (f.type === 'area') return `<textarea id="${id}" data-mek="${f.k}" rows="2" placeholder="${esc(ph)}" ${dz && dz.clear ? 'disabled' : ''}>${val}</textarea>`;
  return `<input id="${id}" data-mek="${f.k}" ${f.type === 'date' && dz && !dz.clear ? 'type="date"' : f.type === 'date' ? 'type="text" onfocus="this.type=\'date\'"' : ''} ${f.secret ? 'autocomplete="off" data-lpignore="true" data-1p-ignore' : ''} placeholder="${esc(ph)}" value="${val}" ${dz && dz.clear ? 'disabled' : ''}>`;
}
function meRowHtml(f) {
  const now = meNow(f), dz = ME.dirty.get(f.k);
  const canClear = f.clear !== false && f.type !== 'bool' && !(f.type === 'select' && !f.clearTo);
  return `<div class="merow ${dz ? 'dirty' : ''}" data-merow="${f.k}"><label for="me_${f.k}">${esc(f.l)}${dz ? `<span class="mechg">${dz.clear ? 'will be emptied' : 'will change'}</span>` : ''}</label>
    <div class="mectl">${meControl(f, now)}
      ${canClear && !dz ? `<button type="button" class="ghost sm" data-meclear="${f.k}" title="Empty this field on all of them">Clear</button>` : ''}
      ${dz ? `<button type="button" class="ghost sm" data-mekeep="${f.k}" title="Leave this field as it is">Keep as is</button>` : ''}</div>
    ${f.hint ? `<div class="small faint">${esc(f.hint)}</div>` : ''}</div>`;
}
function meDraw(focusK) {
  const s = ME.spec; if (!s) return;
  let g = null, h = '';
  for (const f of s.fields) {
    if (f.g && f.g !== g) { g = f.g; h += `<div class="megrp">${esc(g)}</div>`; }
    h += meRowHtml(f);
  }
  $('#meRows').innerHTML = h;
  meSum();
  if (focusK) { const el = document.getElementById('me_' + focusK); if (el && !el.disabled) el.focus(); }
}
function meSum() {
  const n = ME.dirty.size, s = ME.spec;
  $('#meSum').textContent = n ? `${plural(n, 'field')} will change on ${plural(ME.list.length, s.noun)}` : 'Nothing changed yet';
  $('#meGo').disabled = !n;
  $('#meGo').textContent = n ? `Apply to ${plural(ME.list.length, s.noun)}` : 'Apply';
}
function meField(k) { return ME.spec && ME.spec.fields.find(f => f.k === k); }
function meWire() {
  const box = $('#meRows');
  box.oninput = box.onchange = async e => {
    const el = e.target.closest('[data-mek]'); if (!el) return;
    const f = meField(el.dataset.mek); if (!f) return;
    if ((el.tagName === 'SELECT') !== (e.type === 'change')) return;   // selects on change, typing on input (each once)
    let v = el.value;
    if (el.tagName === 'SELECT') {
      if (v === '__new' && f.newOpt) { const nv = await f.newOpt.make(); if (nv == null || nv === '') { el.value = ME.dirty.has(f.k) ? String(ME.dirty.get(f.k).v) : '__keep'; return; } v = nv; }
      if (v === '__keep') ME.dirty.delete(f.k); else ME.dirty.set(f.k, { v });
      meDraw(); return;
    }
    // typing: a field counts as changed once it has something in it (to empty it on purpose, use Clear)
    const was = ME.dirty.has(f.k);
    if (v === '') ME.dirty.delete(f.k); else ME.dirty.set(f.k, { v });
    if (was !== ME.dirty.has(f.k)) { const row = el.closest('.merow'), pos = el.selectionStart; row.outerHTML = meRowHtml(f); const ne = document.getElementById('me_' + f.k); if (ne) { ne.focus(); try { ne.setSelectionRange(pos, pos); } catch (_) { } } }
    meSum();
  };
  box.onclick = e => {
    const c = e.target.closest('[data-meclear]'), k = e.target.closest('[data-mekeep]');
    if (c) { ME.dirty.set(c.dataset.meclear, { clear: true }); meDraw(); }
    if (k) { ME.dirty.delete(k.dataset.mekeep); meDraw(k.dataset.mekeep); }
  };
}
function massEdit(spec) {
  const list = spec.items();
  if (!list.length) { toast(`Select some ${spec.noun}s first`); return; }
  const d = meDialog();
  ME.spec = spec; ME.list = list; ME.dirty.clear();
  $('#meTitle').textContent = `Edit ${plural(list.length, spec.noun)}`;
  $('#meSub').textContent = '';
  $('#meExtra').innerHTML = spec.extra || '';
  meWire(); meDraw();
  $('#meGo').onclick = () => meApply();
  if (spec.wireExtra) spec.wireExtra();
  openDlg('dlgMass');
  d.querySelector('.dbody').scrollTop = 0;
}
function meApply() {
  const s = ME.spec; if (!s || !ME.dirty.size) return;
  const keys = [...ME.dirty.keys()], list = ME.list, n = keys.length;
  snapshot('edit ' + s.noun + 's');
  list.forEach((o, i) => {
    for (const k of keys) {
      const f = meField(k), dz = ME.dirty.get(k);
      let v = dz.clear ? (f.clearTo != null ? f.clearTo : '') : dz.v;
      if (f.type === 'bool') v = v === 'yes';
      else if (!dz.clear && s.tokens && typeof v === 'string') v = s.tokens(v, o, i);
      if (f.set) f.set(o, v, i); else o[k] = v;
    }
    o.updatedAt = Date.now();
  });
  if (s.apply) s.apply(list, keys);
  closeDlg('dlgMass'); save(); refresh();
  toast(`Changed ${plural(n, 'field')} on ${plural(list.length, s.noun)}`, { undo: true });
}

/* ---------- what each list can edit ---------- */
const meStores = () => Parser.STORES.filter(s => s.key !== 'other' && s.key !== 'custom').slice().sort((a, b) => a.label.localeCompare(b.label)).map(s => [s.key, s.label]);
const meCatOpts = () => state.categories.map(c => [c.id, c.name]);
function meEditProfiles() {
  massEdit({
    noun: 'profile', items: () => selected.size ? selectedTargets() : [],
    tokens: (s, p, i) => fillTokens(s, p, i),
    fields: [
      { k: 'categoryId', l: 'Group', g: 'General', type: 'select', opts: meCatOpts, clear: false, newOpt: { label: '+ New group…', make: async () => { const n = await askText('New group', '', { ok: 'Add group' }); return n && n.trim() ? ensureCategory(n) : null; } } },
      ...FIELDS.map(f => ({ k: f.k, l: f.l, g: f.g, type: f.bool ? 'bool' : 'text', secret: /cardNumber|cardCvv|emailPassword/.test(f.k),
        get: f.bool ? (p => f.k === 'sameBilling' ? p.sameBilling !== false : !!(p[f.k] ?? f.def)) : undefined,
        set: f.k === 'cardNumber' ? ((p, v) => { p.cardNumber = cardDigits(v) || v; }) : undefined })),
      { k: 'notes', l: 'Notes', g: 'Notes', type: 'area' },
    ],
    extra: `<div class="small muted" style="margin-top:12px">Tip: <b>{n}</b> numbers them in order, <b>{r:10-99}</b> adds a random number, <b>{first}</b> <b>{last}</b> <b>{name}</b> pull from each profile. For find &amp; replace or adding to the end of a field, use <a href="#" id="meAdv">Find &amp; replace…</a></div>`,
    wireExtra: () => { const a = $('#meAdv'); if (a) a.onclick = e => { e.preventDefault(); closeDlg('dlgMass'); $('#bulkBtn').click(); }; },
    apply: () => { if (typeof autoLinkAll === 'function') autoLinkAll(); },
  });
}
function meEditAccounts() {
  massEdit({
    noun: 'account', items: () => (state.accounts || []).filter(a => accSel.has(a.id)),
    tokens: (s, a, i) => String(s).replace(/\{n\}/g, i + 1).replace(/\{r:(\d+)-(\d+)\}/g, (_, x, y) => rint(+x, +y)),
    fields: [
      { k: 'status', l: 'Status', type: 'select', opts: () => ACC_STATUS.map(s => [s.k, s.l]), clear: false },
      { k: 'groupId', l: 'Group', type: 'select', opts: () => [['', 'No group'], ...(state.accountGroups || []).map(g => [g.id, g.name])], clear: false, newOpt: { label: '+ New group…', make: async () => { const n = await askText('New account group', '', { ok: 'Add group' }); return n && n.trim() ? ensureAccGroup(n) : null; } } },
      { k: 'store', l: 'Store', type: 'select', opts: meStores, clear: false },
      { k: 'profileId', l: 'Profile', type: 'select', opts: () => [['', 'No profile'], ...state.profiles.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true })).map(p => [p.id, p.name || 'Untitled'])], clear: false },
      { k: 'password', l: 'Password', type: 'text', secret: true },
      { k: 'phone', l: 'Phone', type: 'text' },
      { k: 'notes', l: 'Notes', type: 'area' },
    ],
  });
}
function meEditCards() {
  massEdit({
    noun: 'card', items: () => (state.cards || []).filter(c => cardSel.has(c.id)),
    fields: [
      { k: 'status', l: 'Status', type: 'select', opts: () => CARD_STATUS.map(s => [s.k, s.l]), clear: false },
      { k: 'groupId', l: 'Group', type: 'select', opts: () => [['', 'No group'], ...(state.cardGroups || []).map(g => [g.id, g.name])], clear: false, newOpt: { label: '+ New group…', make: async () => { const n = await askText('New card group', '', { ok: 'Add group' }); if (!n || !n.trim()) return null; const g = newCardGroup(n); state.cardGroups.push(g); return g.id; } } },
      { k: 'name', l: 'Name on card', type: 'text' },
      { k: 'month', l: 'Exp month (MM)', type: 'text', set: (c, v) => { c.month = v ? String(v).replace(/\D/g, '').padStart(2, '0').slice(-2) : ''; } },
      { k: 'year', l: 'Exp year (YYYY)', type: 'text', set: (c, v) => { v = String(v || '').replace(/\D/g, ''); c.year = v.length === 2 ? '20' + v : v; } },
      { k: 'cvv', l: 'CVV', type: 'text', secret: true },
      { k: 'notes', l: 'Notes', type: 'area' },
    ],
  });
}
function meEditOrders() {
  massEdit({
    noun: 'order', items: () => state.orders.filter(o => oSelected.has(o.id)),
    fields: [
      { k: 'status', l: 'Status', type: 'select', opts: () => STATUSES.map(s => [s.k, s.l]), clear: false, set: (o, v) => { if (o.status !== v) setStatus(o, v, null, 'manual'); } },
      { k: 'profileId', l: 'Profile', type: 'select', clear: false, opts: () => [['__auto', 'Match automatically again'], ['__none', 'Not linked'], ...state.profiles.map(p => [p.id, p.name || 'Untitled'])],
        get: o => o.profileId || '__none',
        set: (o, v) => { if (v === '__auto') { o.profileLink = ''; autoLink(o); } else if (v === '__none') { o.profileId = ''; o.profileLink = ''; } else { o.profileId = v; o.profileLink = 'manual'; } resolveHouse(o); } },
      { k: 'store', l: 'Store', type: 'select', clear: false, opts: meStores },
      { k: 'last4', l: 'Card last 4', type: 'text', set: (o, v) => { o.last4 = String(v || '').replace(/\D/g, '').slice(-4); } },
      { k: 'eta', l: 'Arriving by', type: 'date' },
      { k: 'notes', l: 'Notes', type: 'area' },
    ],
    apply: () => { if (typeof pruneHouses === 'function') pruneHouses(); if (typeof invalidateStats === 'function') invalidateStats(); },
  });
}

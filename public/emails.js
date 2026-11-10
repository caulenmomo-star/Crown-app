/* Kingpin - a plain list of email addresses (iCloud Hide My Email, Outlook, Gmail, your own domain…) in groups.
   Shown as the "Email list" tab on the Accounts page. Paste any amount at once (from a list, a spreadsheet, or a
   copy of the iCloud HME page — the addresses are picked out of whatever's pasted), see which ones are already on a
   profile or a store login, and use a group's unused ones in the profile builder. */
'use strict';
const EF = { q: '', group: 'all', use: 'all', prov: '', store: '', sort: 'added' };
let emlSel = new Set();
const emlGroupById = id => (state.emailGroups || []).find(g => g.id === id);
function ensureEmlGroup(name) {
  name = String(name || '').trim(); if (!name) return '';
  if (!state.emailGroups) state.emailGroups = [];
  let g = state.emailGroups.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!g) { g = { id: uid(), name, createdAt: Date.now() }; state.emailGroups.push(g); }
  return g.id;
}
function emlProvider(e) {
  const d = String(e || '').split('@')[1] || '';
  if (/^(icloud|me|mac)\.com$/i.test(d)) return 'iCloud';
  if (/^(outlook|hotmail|live|msn)\.[a-z.]+$/i.test(d)) return 'Outlook';
  if (/^(gmail|googlemail)\.com$/i.test(d)) return 'Gmail';
  if (/^(yahoo|ymail|rocketmail)\.[a-z.]+$/i.test(d)) return 'Yahoo';
  if (/^(proton\.me|protonmail\.(com|ch)|pm\.me)$/i.test(d)) return 'Proton';
  if (/^(aol|aim)\.com$/i.test(d)) return 'AOL';
  return d.toLowerCase();
}
// every address in any pasted text: lists, "email:password" lines, spreadsheets, a copied web page
function emlExtract(text) {
  const out = [], seen = new Set();
  for (const m of String(text || '').matchAll(/[a-z0-9][a-z0-9._%+'-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi)) { const e = m[0].toLowerCase().replace(/\.+$/, ''); if (!seen.has(e)) { seen.add(e); out.push(e); } }
  return out;
}
// where each address is already used: on which profiles, and which stores have a login saved with it
const emlAccKey = a => a.store === 'custom' ? 'c:' + norm(a.storeName) : a.store;
// the same address however it was typed or pasted (capitals, spaces, invisible characters, "mailto:")
const emlKey = e => String(e || '').normalize('NFKC').replace(/[\s\u200b-\u200f\u2060\ufeff]/g, '').replace(/^mailto:/i, '').toLowerCase();
// which stores a profile is for, from its name: "Target Account #18", "abc.def_Target", "PKC 3", "BBY main"…
const EML_STORE_WORDS = { pokemoncenter: ['pkc', 'pokemon center', 'pokemoncenter', 'pokemon'], bestbuy: ['bby', 'bestbuy'], walmart: ['wmt'], samsclub: ['sams', 'sams club'], amazon: ['amz'], gamestop: ['gme'] };
let _emlStoreRx = null;
function emlStoreRx() {
  if (_emlStoreRx) return _emlStoreRx;
  const flat = t => ' ' + String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  const words = [];
  for (const st of Parser.STORES) {
    if (st.key === 'other') continue;
    const w = new Set([st.label, ...(st.alias || []), ...(EML_STORE_WORDS[st.key] || [])]); if (st.key.length >= 4) w.add(st.key);
    w.forEach(x => { const f = flat(x); if (f.trim().length >= 3) words.push([f, st.key, st.label]); });
  }
  return (_emlStoreRx = { flat, words });
}
function emlProfileStores(name) {
  const R = emlStoreRx(), n = R.flat(name), out = new Map();
  for (const [w, k, l] of R.words) if (n.includes(w)) out.set(k, l);
  return out;
}
function emlUseIndex() {
  const ix = new Map(), get = e => { e = emlKey(e); if (!e) return null; let x = ix.get(e); if (!x) ix.set(e, x = { profiles: [], accounts: 0, stores: new Map(), logins: new Set(), from: new Map() }); return x; };
  const addProf = (x, p) => { x.profiles.push(p.name || 'Untitled'); emlProfileStores(p.name).forEach((l, k) => { if (!x.stores.has(k)) x.stores.set(k, l); if (!x.from.has(k)) x.from.set(k, p.name); }); };
  (state.accounts || []).forEach(a => { const x = get(a.email); if (!x) return; const k = emlAccKey(a); x.accounts++; x.logins.add(k); x.stores.set(k, a.store === 'custom' ? (a.storeName || 'Other') : Parser.storeInfo(a.store).label); });
  state.profiles.forEach(p => { const x = get(p.email); if (x) addProf(x, p); });
  // a profile named after the address (no email on it) counts too, the same way the store logins find it
  if (typeof accMatchProfile === 'function') (state.emails || []).forEach(e => { const x = ix.get(emlKey(e.email)); if (x && x.profiles.length) return; const m = accMatchProfile({ email: e.email, store: '' }); if (m) addProf(get(e.email), m.p); });
  const seen = new Map(); ix.forEach(x => x.stores.forEach((l, k) => seen.set(k, l)));
  return { get: e => ix.get(emlKey(e)), has: e => ix.has(emlKey(e)), stores: seen };
}
// stores for the "Store accounts" filter: the ones you have logins for first, then the rest
function emlStoreChoices(ix) {
  const have = new Map(ix ? ix.stores : []); (state.accounts || []).forEach(a => have.set(emlAccKey(a), a.store === 'custom' ? (a.storeName || 'Other') : Parser.storeInfo(a.store).label));
  const rest = Parser.STORES.filter(x => x.key !== 'other' && !have.has(x.key)).map(x => [x.key, x.label]);
  return { have: [...have].sort((a, b) => a[1].localeCompare(b[1])), rest: rest.sort((a, b) => a[1].localeCompare(b[1])) };
}
const emlStoreLabel = k => { for (const [kk, l] of [].concat(emlStoreChoices().have, emlStoreChoices().rest)) if (kk === k) return l; return k; };
function emlFiltered(ix) {
  const q = EF.q.trim().toLowerCase();
  const list = (state.emails || []).filter(e => {
    if (EF.group === 'none' ? emlGroupById(e.groupId) : EF.group !== 'all' && e.groupId !== EF.group) return false;
    const used = ix.has(e.email);
    if (EF.use === 'unused' && used) return false;
    if (EF.use === 'used' && !used) return false;
    if (EF.prov && emlProvider(e.email) !== EF.prov) return false;
    if (EF.store) { const u = ix.get(e.email), st = u ? u.stores : null;
      if (EF.store === 'none' ? st && st.size : EF.store === 'any' ? !(st && st.size) : EF.store.startsWith('has:') ? !(st && st.has(EF.store.slice(4))) : EF.store.startsWith('not:') && st && st.has(EF.store.slice(4))) return false; }
    if (!q) return true;
    const u = ix.get(e.email);
    return [e.email, e.notes, (emlGroupById(e.groupId) || {}).name, u && u.profiles.join(' '), u && [...u.stores.values()].join(' ')].some(v => String(v || '').toLowerCase().includes(q));
  });
  if (EF.sort === 'az') list.sort((a, b) => a.email.localeCompare(b.email, undefined, { numeric: true }));
  else if (EF.sort === 'fewest' || EF.sort === 'most') { const n = e => { const u = ix.get(e.email); return u ? u.stores.size : 0; }; list.sort((a, b) => EF.sort === 'fewest' ? n(a) - n(b) : n(b) - n(a)); }
  else if (EF.sort === 'newest') list.reverse();
  return list;
}
// store logins as store badges (each store once), then the profile(s) on this address
const emlStoresHtml = u => !u || !u.stores.size ? '<span class="faint">None</span>' : `<span class="estores">${[...u.stores].sort((a, b) => a[1].localeCompare(b[1])).map(([k, l]) => { const b = k.startsWith('c:') ? `<span class="badge"><i style="background:var(--faint)"></i>${esc(l)}</span>` : storeBadge(k); return u.logins.has(k) ? b : b.replace('<span class="badge"', `<span class="badge fromprof" title="${esc('From the profile “' + u.from.get(k) + '” — no store login saved for it yet')}"`); }).join('')}</span>`;
const emlUsedHtml = u => !u || !u.profiles.length ? '<span class="faint">—</span>' : u.profiles.length > 2 ? esc(plural(u.profiles.length, 'profile')) : `<span class="ellipsis">${u.profiles.map(esc).join(', ')}</span>`;
function emlRender(pg) {
  if (!state.emails) state.emails = [];
  if (!state.emailGroups) state.emailGroups = [];
  const all = state.emails, ix = emlUseIndex(), list = emlFiltered(ix);
  for (const id of [...emlSel]) if (!all.some(e => e.id === id)) emlSel.delete(id);
  const n = id => all.filter(e => id === 'none' ? !emlGroupById(e.groupId) : e.groupId === id).length;
  const provs = [...new Set(all.map(e => emlProvider(e.email)))].sort();
  const unused = all.filter(e => !ix.has(e.email)).length;
  pg.innerHTML = `<div class="pagehead"><h1>Accounts</h1><span class="sub">${plural(all.length, 'email')}${all.length ? ` · ${unused} unused` : ''}</span><div class="spacer"></div>
      <button id="emExp" ${all.length ? '' : 'disabled'}>Export</button><button class="primary" id="emAdd">+ Add emails</button></div>
    ${accTabsHtml()}
    <div class="split"><div class="catlist"><div id="egList"><div class="cat ${EF.group === 'all' ? 'active' : ''}" data-eg="all"><span>All emails</span><span class="n">${all.length}</span></div>${state.emailGroups.map(g => `<div class="cat ${EF.group === g.id ? 'active' : ''}" data-eg="${g.id}"><span class="ellipsis">${esc(g.name)}</span><span class="n">${n(g.id)}</span><span class="act"><button data-egren="${g.id}">Rename</button><button data-egdel="${g.id}">✕</button></span></div>`).join('')}${state.emailGroups.length && n('none') ? `<div class="cat ${EF.group === 'none' ? 'active' : ''}" data-eg="none"><span class="faint">No group</span><span class="n">${n('none')}</span></div>` : ''}</div><button id="egAdd" class="ghost" style="width:100%;margin-top:6px;text-align:left">+ New group</button></div><div style="min-width:0">
      <div class="toolbar"><input class="search" data-search id="emQ" placeholder="Search emails, notes…  ( / )" value="${esc(EF.q)}">
        ${provs.length > 1 ? `<select id="emProv"><option value="">All kinds</option>${provs.map(p => `<option ${EF.prov === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>` : ''}
        <select id="emStore" title="Filter by the stores these emails have logins on">${(() => { const c = emlStoreChoices(ix), o = (v, l) => `<option value="${esc(v)}" ${EF.store === v ? 'selected' : ''}>${esc(l)}</option>`;
          return o('', 'Any store accounts') + o('none', 'No store account yet') + o('any', 'Has a store account') + (c.have.length ? `<optgroup label="Has an account on">${c.have.map(([k, l]) => o('has:' + k, 'On ' + l)).join('')}</optgroup>` : '') + `<optgroup label="No account on">${c.have.concat(c.rest).map(([k, l]) => o('not:' + k, 'Not on ' + l)).join('')}</optgroup>`; })()}</select>
        <select id="emSort" title="Sort">${[['added', 'Oldest first'], ['newest', 'Newest first'], ['az', 'A–Z'], ['fewest', 'Fewest stores first'], ['most', 'Most stores first']].map(([k, l]) => `<option value="${k}" ${EF.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <div class="chips" id="emUse">${[['all', 'All'], ['unused', 'Unused'], ['used', 'Used']].map(([k, l]) => `<button class="chip ${EF.use === k ? 'on' : ''}" data-eu="${k}">${l}</button>`).join('')}</div>
        ${list.length ? `<button class="sm primary" id="emCopyAll" title="Copies these emails, one per line — ready to paste into a generator">Copy ${list.length === all.length ? 'all ' : ''}${plural(list.length, 'email')}</button>` : ''}</div>
      ${EF.store ? `<div class="small muted" style="margin:-4px 0 8px">${esc(plural(list.length, 'email'))} ${EF.store === 'none' ? 'with no store account yet' : EF.store === 'any' ? 'with at least one store account' : EF.store.startsWith('has:') ? 'with a ' + emlStoreLabel(EF.store.slice(4)) + ' account' : 'without a ' + emlStoreLabel(EF.store.slice(4)) + ' account'} · <button class="linkbtn" id="emStoreClr">show all</button></div>` : ''}
      ${emlSel.size ? `<div class="selbar"><strong>${emlSel.size} selected</strong><button class="sm primary" id="emEditSel">Edit selected</button><select id="emMove" style="width:auto"><option value="">Move to group…</option><option value="-">No group</option>${state.emailGroups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}<option value="__new">+ New group…</option></select><button class="sm" id="emCopySel">Copy</button><button class="sm danger" id="emDelSel">Delete</button><div class="spacer"></div><button class="sm ghost" id="emClrSel">Clear</button></div>` : ''}
      ${list.length ? `<div class="tablewrap"><table class="atable etable"><thead><tr><th class="cb"><input type="checkbox" id="emAll" title="Select all (⌘A / Ctrl+A) · Shift-click to select a range" ${list.every(e => emlSel.has(e.id)) ? 'checked' : ''} aria-label="Select all"></th><th>Email</th><th>Kind</th><th>Group</th><th>Store accounts</th><th>Profile</th><th>Notes</th></tr></thead><tbody>
        ${list.slice(0, 1500).map(e => `<tr data-eml="${e.id}" class="${emlSel.has(e.id) ? 'sel' : ''}"><td class="cb"><input type="checkbox" data-ecb="${e.id}" ${emlSel.has(e.id) ? 'checked' : ''} aria-label="Select"></td>
          <td class="a-email"><div class="cellflex"><span class="ellipsis">${esc(e.email)}</span><button class="ghost sm icopy" data-ecopy="${e.id}" title="Copy email" aria-label="Copy email">⧉</button></div></td>
          <td class="a-store"><span class="tag">${esc(emlProvider(e.email))}</span></td>
          <td class="a-grp">${emlGroupById(e.groupId) ? `<span class="tag">${esc(emlGroupById(e.groupId).name)}</span>` : '<span class="faint">—</span>'}</td>
          <td class="e-stores">${emlStoresHtml(ix.get(e.email))}</td>
          <td class="a-prof">${emlUsedHtml(ix.get(e.email))}</td>
          <td class="e-notes small muted ellipsis" style="max-width:220px">${esc(e.notes || '')}</td></tr>`).join('')}</tbody></table></div>${list.some(e => { const u = ix.get(e.email); return u && u.stores.size > u.logins.size; }) ? `<div class="small faint" style="padding:8px 2px">Dashed stores come from a profile’s name (like “Target Account #18” or “…_Target”) — there’s no login saved for them under Store logins.</div>` : ''}${list.length > 1500 ? `<div class="small muted" style="padding:8px">Showing 1,500 of ${list.length} — search or pick a group to see the rest.</div>` : ''}`
      : `<div class="empty">${all.length ? 'No emails match.' : 'Keep every address you use for checkouts here — iCloud Hide My Email, Outlook, Gmail, your own domain — in groups. <b>+ Add emails</b> takes a pasted list, a spreadsheet column or a copy of the Hide My Email page; the addresses are picked out of it.'}</div>`}
    </div></div>`;
  wireAccTabs();
  $('#emAdd').onclick = () => openEmlAdd();
  $('#emExp').onclick = () => { const rows = emlFiltered(ix).map(e => ({ email: e.email, kind: emlProvider(e.email), group: (emlGroupById(e.groupId) || {}).name || '', store_accounts: (u => u ? [...u.stores.values()].sort().join('; ') : '')(ix.get(e.email)), profile: (u => u ? u.profiles.join('; ') : '')(ix.get(e.email)), notes: e.notes || '' })); download(`kingpin-emails-${stamp()}.csv`, toCSV(['email', 'kind', 'group', 'store_accounts', 'profile', 'notes'], rows), 'text/csv'); toast(`Exported ${plural(rows.length, 'email')}`); };
  $('#egAdd').onclick = async () => { const nm = await askText('New email group', '', { placeholder: 'iCloud HME main, Outlook batch 2…', ok: 'Add group' }); if (nm && nm.trim()) { snapshot('add email group'); EF.group = ensureEmlGroup(nm); save(); PAGES.accounts.render(); } };
  $('#egList').onclick = async e => {
    const ren = e.target.dataset.egren, del = e.target.dataset.egdel;
    if (ren) { const g = emlGroupById(ren); const nm = await askText('Rename group', g.name); if (nm && nm.trim()) { snapshot('rename email group'); g.name = nm.trim(); save(); PAGES.accounts.render(); } return; }
    if (del) { const g = emlGroupById(del); if (!await ask(`Delete group “${g.name}”?\n\nIts emails stay — they just won’t be in a group.`)) return; snapshot('delete email group'); state.emailGroups = state.emailGroups.filter(x => x.id !== del); state.emails.forEach(x => { if (x.groupId === del) x.groupId = ''; }); if (EF.group === del) EF.group = 'all'; save(); PAGES.accounts.render(); return; }
    const row = e.target.closest('[data-eg]'); if (row) { EF.group = row.dataset.eg; emlSel.clear(); PAGES.accounts.render(); }
  };
  $('#emQ').oninput = debounce(e => { EF.q = e.target.value; PAGES.accounts.render(); const i = $('#emQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 160);
  if ($('#emProv')) $('#emProv').onchange = e => { EF.prov = e.target.value; PAGES.accounts.render(); };
  $('#emStore').onchange = e => { EF.store = e.target.value; emlSel.clear(); PAGES.accounts.render(); };
  $('#emSort').onchange = e => { EF.sort = e.target.value; PAGES.accounts.render(); };
  if ($('#emStoreClr')) $('#emStoreClr').onclick = () => { EF.store = ''; PAGES.accounts.render(); };
  if ($('#emCopyAll')) $('#emCopyAll').onclick = () => copyText(list.map(x => x.email).join('\n'), plural(list.length, 'email'));
  $('#emUse').onclick = e => { const b = e.target.closest('[data-eu]'); if (b) { EF.use = b.dataset.eu; PAGES.accounts.render(); } };
  if ($('#emAll')) $('#emAll').onchange = e => { list.forEach(x => e.target.checked ? emlSel.add(x.id) : emlSel.delete(x.id)); PAGES.accounts.render(); };
  if ($('#emClrSel')) $('#emClrSel').onclick = () => { emlSel.clear(); PAGES.accounts.render(); };
  if ($('#emEditSel')) $('#emEditSel').onclick = () => meEditEmails();
  if ($('#emCopySel')) $('#emCopySel').onclick = () => copyText(state.emails.filter(x => emlSel.has(x.id)).map(x => x.email).join('\n'), plural(emlSel.size, 'email'));
  if ($('#emMove')) $('#emMove').onchange = async e => { let v = e.target.value; if (!v) return; if (v === '__new') { const nm = await askText('New email group', '', { ok: 'Add group' }); if (!nm || !nm.trim()) { e.target.value = ''; return; } v = ensureEmlGroup(nm); } snapshot('move emails'); const k = emlSel.size; state.emails.forEach(x => { if (emlSel.has(x.id)) { x.groupId = v === '-' ? '' : v; x.updatedAt = Date.now(); } }); save(); PAGES.accounts.render(); toast(`Moved ${plural(k, 'email')}`, { undo: true }); };
  if ($('#emDelSel')) $('#emDelSel').onclick = async () => { const k = emlSel.size; if (!await ask(`Delete ${plural(k, 'email')} from the list?\n\nProfiles and store logins using them aren’t changed.`)) return; snapshot('delete emails'); state.emails = state.emails.filter(x => !emlSel.has(x.id)); emlSel.clear(); save(); PAGES.accounts.render(); toast(`Deleted ${plural(k, 'email')}`, { undo: true }); };
  pg.querySelector('tbody') && pg.querySelector('tbody').addEventListener('click', e => {
    const cb = e.target.dataset.ecb; if (cb) { e.target.checked ? emlSel.add(cb) : emlSel.delete(cb); PAGES.accounts.render(); return; }
    const cp = e.target.closest('[data-ecopy]'); if (cp) { const x = state.emails.find(y => y.id === cp.dataset.ecopy); if (x) copyText(x.email, 'Email'); return; }
    const tr = e.target.closest('tr[data-eml]'); if (!tr) return;
    if (emlSel.size && isCompact()) { const id = tr.dataset.eml; emlSel.has(id) ? emlSel.delete(id) : emlSel.add(id); PAGES.accounts.render(); return; }
    meEditEmails([tr.dataset.eml]);
  });
}
// the two tabs on the Accounts page
function accTabsHtml() {
  return `<div class="tabs" id="accTabs"><button class="tab ${AF.view !== 'emails' ? 'on' : ''}" data-av="logins">Store logins <span class="n">${(state.accounts || []).length}</span></button><button class="tab ${AF.view === 'emails' ? 'on' : ''}" data-av="emails">Email list <span class="n">${(state.emails || []).length}</span></button></div>`;
}
function wireAccTabs() { const t = $('#accTabs'); if (t) t.onclick = e => { const b = e.target.closest('[data-av]'); if (b && AF.view !== b.dataset.av) { AF.view = b.dataset.av; accSel.clear(); emlSel.clear(); PAGES.accounts.render(); } }; }

/* ---------- add many ---------- */
function openEmlAdd() {
  if (!document.getElementById('dlgEmlAdd')) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="dlgEmlAdd"><div class="dhead">Add emails<button class="ghost sm x" data-close>✕</button></div>
      <div class="dbody"><div class="small muted" style="margin-bottom:8px">Paste any amount — one per line, email:password lines, a spreadsheet column, or a copy of the iCloud Hide My Email page. Every address in it is picked out.</div>
        <textarea id="eaText" rows="8" spellcheck="false" placeholder="abc.def_12@icloud.com&#10;xyz123@outlook.com&#10;…"></textarea>
        <div class="fgrid" style="margin-top:10px"><div class="s2"><label>Group</label><select id="eaGroup"></select></div><div class="s2"><label>Notes for these (optional)</label><input id="eaNotes" placeholder="e.g. made Nov 2026"></div></div>
        <div class="small" id="eaSum" style="margin-top:8px"></div></div>
      <div class="dfoot"><button data-close>Cancel</button><button class="primary" id="eaGo" disabled>Add</button></div></dialog>`);
    const upd = () => {
      const found = emlExtract($('#eaText').value), have = new Set((state.emails || []).map(e => e.email)), fresh = found.filter(e => !have.has(e));
      $('#eaSum').innerHTML = found.length ? `<b>${plural(fresh.length, 'new email')}</b>${found.length - fresh.length ? ` · <span class="muted">${found.length - fresh.length} already in your list (skipped)</span>` : ''}${fresh.length ? ` · ${esc([...new Set(fresh.map(emlProvider))].slice(0, 4).join(', '))}` : ''}` : $('#eaText').value.trim() ? '<span style="color:var(--danger)">No email addresses found</span>' : '';
      $('#eaGo').disabled = !fresh.length; $('#eaGo').textContent = fresh.length ? `Add ${plural(fresh.length, 'email')}` : 'Add';
      return fresh;
    };
    $('#eaText').oninput = debounce(upd, 120);
    $('#eaGroup').onchange = async e => { if (e.target.value !== '__new') return; const nm = await askText('New email group', '', { ok: 'Add group' }); const id = nm && nm.trim() ? ensureEmlGroup(nm) : ''; $('#eaGroup').innerHTML = emlGroupOpts(id); };
    $('#eaGo').onclick = () => {
      const fresh = upd(); if (!fresh.length) return;
      snapshot('add emails'); const g = $('#eaGroup').value === '__new' ? '' : $('#eaGroup').value, notes = $('#eaNotes').value.trim(), t = Date.now();
      fresh.forEach((e, i) => state.emails.push({ id: uid(), email: e, groupId: g, notes, createdAt: t + i, updatedAt: t + i }));
      closeDlg('dlgEmlAdd'); save(); PAGES.accounts.render(); toast(`Added ${plural(fresh.length, 'email')}`, { undo: true });
    };
  }
  if (!state.emails) state.emails = [];
  $('#eaText').value = ''; $('#eaNotes').value = ''; $('#eaSum').innerHTML = ''; $('#eaGo').disabled = true; $('#eaGo').textContent = 'Add';
  $('#eaGroup').innerHTML = emlGroupOpts(EF.group !== 'all' && EF.group !== 'none' ? EF.group : '');
  openDlg('dlgEmlAdd');
  setTimeout(() => { if (!isCompact()) $('#eaText').focus(); }, 50);
}
const emlGroupOpts = sel => `<option value="">No group</option>${(state.emailGroups || []).map(g => `<option value="${g.id}" ${sel === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}<option value="__new">+ New group…</option>`;

/* ---------- edit (one or many) ---------- */
function meEditEmails(ids) {
  const one = ids && ids.length === 1;
  massEdit({
    noun: 'email', items: () => (state.emails || []).filter(e => ids ? ids.includes(e.id) : emlSel.has(e.id)),
    fields: [
      ...(one ? [{ k: 'email', l: 'Email', type: 'text', clear: false, set: (e, v) => { const x = emlExtract(v)[0]; if (x) e.email = x; } }] : []),
      { k: 'groupId', l: 'Group', type: 'select', opts: () => [['', 'No group'], ...(state.emailGroups || []).map(g => [g.id, g.name])], clear: false, newOpt: { label: '+ New group…', make: async () => { const nm = await askText('New email group', '', { ok: 'Add group' }); return nm && nm.trim() ? ensureEmlGroup(nm) : null; } } },
      { k: 'notes', l: 'Notes', type: 'area' },
    ],
    extra: one ? `<div style="margin-top:12px"><button class="sm danger" id="emDelOne">Delete this email</button></div>` : '',
    wireExtra: () => { const b = $('#emDelOne'); if (b) b.onclick = async () => { if (!await ask('Delete this email from the list?')) return; snapshot('delete email'); state.emails = state.emails.filter(x => x.id !== ids[0]); emlSel.delete(ids[0]); closeDlg('dlgMass'); save(); PAGES.accounts.render(); toast('Deleted', { undo: true }); }; },
  });
}
// the profile builder's "My email list": a group's addresses not on any profile yet, in the order they were added
function emlFree(group, all) {
  const used = all ? new Set() : new Set(state.profiles.map(p => String(p.email || '').toLowerCase().trim()));
  return (state.emails || []).filter(e => (group === 'all' || (group === 'none' ? !emlGroupById(e.groupId) : e.groupId === group)) && !used.has(e.email)).map(e => e.email);
}

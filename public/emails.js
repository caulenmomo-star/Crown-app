/* Kingpin - a plain list of email addresses (iCloud Hide My Email, Outlook, Gmail, your own domain…) in groups.
   Shown as the "Email list" tab on the Accounts page. Paste any amount at once (from a list, a spreadsheet, or a
   copy of the iCloud HME page — the addresses are picked out of whatever's pasted), see which ones are already on a
   profile or a store login, and use a group's unused ones in the profile builder. */
'use strict';
const EF = { q: '', group: 'all', use: 'all', prov: '' };
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
// where each address is already used
function emlUseIndex() {
  const ix = new Map(), add = (e, k, v) => { e = String(e || '').toLowerCase().trim(); if (!e) return; const x = ix.get(e) || { profiles: [], accounts: 0 }; if (k === 'p') x.profiles.push(v); else x.accounts++; ix.set(e, x); };
  state.profiles.forEach(p => add(p.email, 'p', p.name || 'Untitled'));
  (state.accounts || []).forEach(a => add(a.email, 'a'));
  return ix;
}
function emlFiltered(ix) {
  const q = EF.q.trim().toLowerCase();
  return (state.emails || []).filter(e => {
    if (EF.group === 'none' ? emlGroupById(e.groupId) : EF.group !== 'all' && e.groupId !== EF.group) return false;
    const used = ix.has(e.email);
    if (EF.use === 'unused' && used) return false;
    if (EF.use === 'used' && !used) return false;
    if (EF.prov && emlProvider(e.email) !== EF.prov) return false;
    return !q || [e.email, e.notes, (emlGroupById(e.groupId) || {}).name].some(v => String(v || '').toLowerCase().includes(q));
  });
}
const emlUsedHtml = u => !u ? '<span class="faint">Unused</span>' : [u.profiles.length ? (u.profiles.length > 2 ? plural(u.profiles.length, 'profile') : 'Profile ' + u.profiles.map(esc).join(', ')) : '', u.accounts ? plural(u.accounts, 'store login') : ''].filter(Boolean).join(' · ');
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
        <div class="chips" id="emUse">${[['all', 'All'], ['unused', 'Unused'], ['used', 'Used']].map(([k, l]) => `<button class="chip ${EF.use === k ? 'on' : ''}" data-eu="${k}">${l}</button>`).join('')}</div></div>
      ${emlSel.size ? `<div class="selbar"><strong>${emlSel.size} selected</strong><button class="sm primary" id="emEditSel">Edit selected</button><select id="emMove" style="width:auto"><option value="">Move to group…</option><option value="-">No group</option>${state.emailGroups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}<option value="__new">+ New group…</option></select><button class="sm" id="emCopySel">Copy</button><button class="sm danger" id="emDelSel">Delete</button><div class="spacer"></div><button class="sm ghost" id="emClrSel">Clear</button></div>` : ''}
      ${list.length ? `<div class="tablewrap"><table class="atable etable"><thead><tr><th class="cb"><input type="checkbox" id="emAll" title="Select all (⌘A / Ctrl+A) · Shift-click to select a range" ${list.every(e => emlSel.has(e.id)) ? 'checked' : ''} aria-label="Select all"></th><th>Email</th><th>Kind</th><th>Group</th><th>Used on</th><th>Notes</th></tr></thead><tbody>
        ${list.slice(0, 1500).map(e => `<tr data-eml="${e.id}" class="${emlSel.has(e.id) ? 'sel' : ''}"><td class="cb"><input type="checkbox" data-ecb="${e.id}" ${emlSel.has(e.id) ? 'checked' : ''} aria-label="Select"></td>
          <td class="a-email"><div class="cellflex"><span class="ellipsis">${esc(e.email)}</span><button class="ghost sm icopy" data-ecopy="${e.id}" title="Copy email" aria-label="Copy email">⧉</button></div></td>
          <td class="a-store"><span class="tag">${esc(emlProvider(e.email))}</span></td>
          <td class="a-grp">${emlGroupById(e.groupId) ? `<span class="tag">${esc(emlGroupById(e.groupId).name)}</span>` : '<span class="faint">—</span>'}</td>
          <td class="a-prof">${emlUsedHtml(ix.get(e.email))}</td>
          <td class="e-notes small muted ellipsis" style="max-width:220px">${esc(e.notes || '')}</td></tr>`).join('')}</tbody></table></div>${list.length > 1500 ? `<div class="small muted" style="padding:8px">Showing 1,500 of ${list.length} — search or pick a group to see the rest.</div>` : ''}`
      : `<div class="empty">${all.length ? 'No emails match.' : 'Keep every address you use for checkouts here — iCloud Hide My Email, Outlook, Gmail, your own domain — in groups. <b>+ Add emails</b> takes a pasted list, a spreadsheet column or a copy of the Hide My Email page; the addresses are picked out of it.'}</div>`}
    </div></div>`;
  wireAccTabs();
  $('#emAdd').onclick = () => openEmlAdd();
  $('#emExp').onclick = () => { const rows = emlFiltered(ix).map(e => ({ email: e.email, kind: emlProvider(e.email), group: (emlGroupById(e.groupId) || {}).name || '', used_on: (u => !u ? '' : [...u.profiles, u.accounts ? u.accounts + ' store login(s)' : ''].filter(Boolean).join('; '))(ix.get(e.email)), notes: e.notes || '' })); download(`kingpin-emails-${stamp()}.csv`, toCSV(['email', 'kind', 'group', 'used_on', 'notes'], rows), 'text/csv'); toast(`Exported ${plural(rows.length, 'email')}`); };
  $('#egAdd').onclick = async () => { const nm = await askText('New email group', '', { placeholder: 'iCloud HME main, Outlook batch 2…', ok: 'Add group' }); if (nm && nm.trim()) { snapshot('add email group'); EF.group = ensureEmlGroup(nm); save(); PAGES.accounts.render(); } };
  $('#egList').onclick = async e => {
    const ren = e.target.dataset.egren, del = e.target.dataset.egdel;
    if (ren) { const g = emlGroupById(ren); const nm = await askText('Rename group', g.name); if (nm && nm.trim()) { snapshot('rename email group'); g.name = nm.trim(); save(); PAGES.accounts.render(); } return; }
    if (del) { const g = emlGroupById(del); if (!await ask(`Delete group “${g.name}”?\n\nIts emails stay — they just won’t be in a group.`)) return; snapshot('delete email group'); state.emailGroups = state.emailGroups.filter(x => x.id !== del); state.emails.forEach(x => { if (x.groupId === del) x.groupId = ''; }); if (EF.group === del) EF.group = 'all'; save(); PAGES.accounts.render(); return; }
    const row = e.target.closest('[data-eg]'); if (row) { EF.group = row.dataset.eg; emlSel.clear(); PAGES.accounts.render(); }
  };
  $('#emQ').oninput = debounce(e => { EF.q = e.target.value; PAGES.accounts.render(); const i = $('#emQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 160);
  if ($('#emProv')) $('#emProv').onchange = e => { EF.prov = e.target.value; PAGES.accounts.render(); };
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

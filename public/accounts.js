/* Crown Tools - store accounts: every Target / Walmart / Pokémon Center… login with its password, status and profile.
   Saved inside your encrypted Crown Tools data like everything else. */
'use strict';
const ACC_STATUS = [
  { k: 'active', l: 'Working', c: 'var(--ok)' },
  { k: 'new', l: 'Not used yet', c: 'var(--faint)' },
  { k: 'needs', l: 'Needs attention', c: 'var(--warn)' },
  { k: 'locked', l: 'Locked', c: 'var(--danger)' },
  { k: 'banned', l: 'Banned', c: 'var(--danger)' },
];
const ACCS = Object.fromEntries(ACC_STATUS.map(s => [s.k, s]));
const AF = { q: '', store: '', status: 'all', reveal: new Set() };
let accSel = new Set();
const accStoreLabel = a => a.store === 'custom' ? (a.storeName || 'Other') : Parser.storeInfo(a.store).label;
const accStoreBadge = a => a.store === 'custom' ? `<span class="badge"><i style="background:var(--faint)"></i>${esc(a.storeName || 'Other')}</span>` : storeBadge(a.store);
function newAccount(f) { return Object.assign({ id: uid(), store: 'target', storeName: '', email: '', password: '', phone: '', profileId: '', status: 'new', notes: '', createdAt: Date.now(), updatedAt: Date.now() }, f || {}); }
const accKey = a => (a.store === 'custom' ? 'c:' + norm(a.storeName) : a.store) + '|' + String(a.email || '').toLowerCase().trim();

// Orders sent to this email at this store tell how the account is doing
let _accIx = null;
function accOrderIndex() {
  if (_accIx) return _accIx;
  const m = new Map();
  for (const o of state.orders) { const e = o.recipientEmail ? normEmail(o.recipientEmail) : ''; if (!e) continue; const k = o.store + '|' + e; let a = m.get(k); if (!a) m.set(k, a = []); a.push(o); const k2 = '*|' + e; let b = m.get(k2); if (!b) m.set(k2, b = []); b.push(o); }
  return (_accIx = m);
}
function accOrders(a) { const e = normEmail(a.email || ''); if (!e) return []; const ix = accOrderIndex(); return a.store === 'custom' ? (ix.get('*|' + e) || []) : (ix.get(a.store + '|' + e) || []); }
function accProfile(a) { return a.profileId ? profileById(a.profileId) : null; }
// a profile with the same email is the natural match
function suggestProfile(a) { const e = String(a.email || '').toLowerCase().trim(); return e ? state.profiles.find(p => String(p.email || '').toLowerCase().trim() === e) || null : null; }

async function copyText(t, what) {
  try { await navigator.clipboard.writeText(t); toast((what || 'Copied') + ' copied'); }
  catch (_) { const i = document.createElement('textarea'); i.value = t; document.body.appendChild(i); i.select(); try { document.execCommand('copy'); toast((what || 'Copied') + ' copied'); } catch (e) { toast('Couldn’t copy — select it and copy by hand'); } i.remove(); }
}
function strongPassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%&*?'];
  const r = n => { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] % n; };
  let p = sets.map(s => s[r(s.length)]).join(''); const all = sets.join('');
  while (p.length < 16) p += all[r(all.length)];
  return p.split('').sort(() => r(3) - 1).join('');
}

function filteredAccounts() {
  const q = AF.q.trim().toLowerCase();
  return (state.accounts || []).filter(a => {
    if (AF.store && (a.store === 'custom' ? 'c:' + norm(a.storeName) : a.store) !== AF.store) return false;
    if (AF.status !== 'all' && a.status !== AF.status) return false;
    if (!q) return true;
    const p = accProfile(a);
    return [a.email, accStoreLabel(a), a.notes, a.phone, p && p.name].some(v => String(v || '').toLowerCase().includes(q));
  }).sort((x, y) => accStoreLabel(x).localeCompare(accStoreLabel(y)) || String(x.email).localeCompare(String(y.email)));
}

PAGES.accounts = {
  render() {
    _accIx = null;
    const pg = $('#pg-accounts'); const all = state.accounts || [];
    const list = filteredAccounts();
    for (const id of [...accSel]) if (!all.some(a => a.id === id)) accSel.delete(id);
    const cnt = k => all.filter(a => a.status === k).length;
    const stores = [...new Map(all.map(a => [a.store === 'custom' ? 'c:' + norm(a.storeName) : a.store, accStoreLabel(a)])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    pg.innerHTML = `<div class="pagehead"><h1>Accounts</h1><span class="sub">${plural(all.length, 'store account')}${stores.length ? ' · ' + plural(stores.length, 'store') : ''}</span><div class="spacer"></div>
        <button id="acImp">Import</button><button id="acExp" ${all.length ? '' : 'disabled'}>Export</button><button class="primary" id="acAdd">+ Add account</button></div>
      ${all.length ? `<div class="kpis">
        <div class="kpi"><div class="l">Working</div><div class="v">${cnt('active')}</div><div class="d">${cnt('new')} not used yet</div></div>
        <div class="kpi"><div class="l">Needs attention</div><div class="v">${cnt('needs')}</div><div class="d">verify, reset, 2FA</div></div>
        <div class="kpi"><div class="l">Locked or banned</div><div class="v ${cnt('locked') + cnt('banned') ? 'neg' : ''}">${cnt('locked') + cnt('banned')}</div><div class="d">${cnt('locked')} locked · ${cnt('banned')} banned</div></div>
        <div class="kpi"><div class="l">With orders</div><div class="v">${all.filter(a => accOrders(a).length).length}</div><div class="d">matched by email</div></div></div>` : ''}
      <div class="toolbar"><input class="search" data-search id="acQ" placeholder="Search email, store, profile, notes…  ( / )" value="${esc(AF.q)}">
        <select id="acStore"><option value="">All stores</option>${stores.map(([k, l]) => `<option value="${esc(k)}" ${AF.store === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <div class="chips" id="acStatus">${[['all', 'All']].concat(ACC_STATUS.map(s => [s.k, s.l])).map(([k, l]) => `<button class="chip ${AF.status === k ? 'on' : ''}" data-as="${k}">${esc(l)}${k !== 'all' ? `<span class="n">${cnt(k)}</span>` : ''}</button>`).join('')}</div></div>
      ${accSel.size ? `<div class="selbar"><strong>${accSel.size} selected</strong><select id="acSetStatus" style="width:auto"><option value="">Set status…</option>${ACC_STATUS.map(s => `<option value="${s.k}">${s.l}</option>`).join('')}</select><button class="sm" id="acCopySel">Copy email:password</button><button class="sm danger" id="acDelSel">Delete</button><div class="spacer"></div><button class="sm ghost" id="acClrSel">Clear</button></div>` : ''}
      ${list.length ? `<div class="tablewrap"><table class="atable"><thead><tr><th class="cb"><input type="checkbox" id="acAll" ${list.every(a => accSel.has(a.id)) ? 'checked' : ''} aria-label="Select all"></th><th>Store</th><th>Email / username</th><th>Password</th><th>Status</th><th>Profile</th><th class="right">Orders</th></tr></thead><tbody>
        ${list.map(a => { const os = accOrders(a), st = ACCS[a.status] || ACCS.new, p = accProfile(a), shown = AF.reveal.has(a.id); const t = tally(os);
          return `<tr data-acc="${a.id}" class="${accSel.has(a.id) ? 'sel' : ''}"><td class="cb"><input type="checkbox" data-acb="${a.id}" ${accSel.has(a.id) ? 'checked' : ''} aria-label="Select"></td>
          <td class="a-store">${accStoreBadge(a)}</td>
          <td class="a-email"><div class="cellflex"><span class="ellipsis">${esc(a.email) || '<span class="faint">—</span>'}</span>${a.email ? `<button class="ghost sm icopy" data-copy="email" data-id="${a.id}" title="Copy email" aria-label="Copy email">⧉</button>` : ''}</div></td>
          <td class="a-pw"><div class="cellflex"><span class="mono pw">${a.password ? (shown ? esc(a.password) : '••••••••••') : '<span class="faint">—</span>'}</span>${a.password ? `<button class="ghost sm icopy" data-reveal="${a.id}" title="${shown ? 'Hide' : 'Show'} password" aria-label="${shown ? 'Hide' : 'Show'} password">${shown ? 'Hide' : 'Show'}</button><button class="ghost sm icopy" data-copy="pw" data-id="${a.id}" title="Copy password" aria-label="Copy password">⧉</button>` : ''}</div></td>
          <td class="a-st"><span class="hpill"><i style="background:${st.c}"></i>${esc(st.l)}</span></td>
          <td class="a-prof">${p ? esc(p.name || 'Untitled') : '<span class="faint">—</span>'}</td>
          <td class="right a-n">${os.length ? `${os.length}<span class="small faint"> · ${t.stuck}✓ ${t.dead}✕</span>` : '<span class="faint">—</span>'}</td></tr>`; }).join('')}</tbody></table></div>`
        : `<div class="empty">${all.length ? 'No accounts match.' : 'No accounts yet. Save every store login here — email, password, which profile it goes with and whether it still works. <b>Import</b> takes email:password lists or a spreadsheet.'}</div>`}`;
    $('#acAdd').onclick = () => openAccount(null);
    $('#acImp').onclick = openAccImport;
    $('#acExp').onclick = () => openAccExport();
    $('#acQ').oninput = debounce(e => { AF.q = e.target.value; PAGES.accounts.render(); const i = $('#acQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 160);
    $('#acStore').onchange = e => { AF.store = e.target.value; PAGES.accounts.render(); };
    $('#acStatus').onclick = e => { const b = e.target.closest('[data-as]'); if (b) { AF.status = b.dataset.as; PAGES.accounts.render(); } };
    if ($('#acAll')) $('#acAll').onchange = e => { list.forEach(a => e.target.checked ? accSel.add(a.id) : accSel.delete(a.id)); PAGES.accounts.render(); };
    if ($('#acClrSel')) $('#acClrSel').onclick = () => { accSel.clear(); PAGES.accounts.render(); };
    if ($('#acSetStatus')) $('#acSetStatus').onchange = e => { const v = e.target.value; if (!v) return; snapshot('account status'); state.accounts.forEach(a => { if (accSel.has(a.id)) { a.status = v; a.updatedAt = Date.now(); } }); save(); toast(`Marked ${plural(accSel.size, 'account')} ${ACCS[v].l.toLowerCase()}`, { undo: true }); PAGES.accounts.render(); };
    if ($('#acCopySel')) $('#acCopySel').onclick = () => copyText(state.accounts.filter(a => accSel.has(a.id)).map(a => `${a.email}:${a.password}`).join('\n'), plural(accSel.size, 'login'));
    if ($('#acDelSel')) $('#acDelSel').onclick = async () => { const n = accSel.size; if (!await ask(`Delete ${plural(n, 'account')}?\n\nTheir saved passwords are removed from Crown Tools.`)) return; snapshot('delete accounts'); state.accounts = state.accounts.filter(a => !accSel.has(a.id)); accSel.clear(); save(); refresh(); toast(`Deleted ${plural(n, 'account')}`, { undo: true }); };
    pg.querySelector('tbody') && pg.querySelector('tbody').addEventListener('click', e => {
      const cb = e.target.dataset.acb; if (cb) { e.target.checked ? accSel.add(cb) : accSel.delete(cb); PAGES.accounts.render(); return; }
      const rv = e.target.closest('[data-reveal]'); if (rv) { const id = rv.dataset.reveal; AF.reveal.has(id) ? AF.reveal.delete(id) : AF.reveal.add(id); PAGES.accounts.render(); return; }
      const cp = e.target.closest('[data-copy]'); if (cp) { const a = state.accounts.find(x => x.id === cp.dataset.id); if (a) copyText(cp.dataset.copy === 'pw' ? a.password : a.email, cp.dataset.copy === 'pw' ? 'Password' : 'Email'); return; }
      const tr = e.target.closest('tr[data-acc]'); if (!tr) return;
      if (accSel.size && isCompact()) { const id = tr.dataset.acc; accSel.has(id) ? accSel.delete(id) : accSel.add(id); PAGES.accounts.render(); return; }
      openAccount(tr.dataset.acc);
    });
  },
};

/* ---------- one account ---------- */
let curAcc = null, accIsNew = false;
const storeOptions = sel => Parser.STORES.filter(s => s.key !== 'other').slice().sort((a, b) => a.label.localeCompare(b.label)).map(s => `<option value="${s.key}" ${sel === s.key ? 'selected' : ''}>${esc(s.label)}</option>`).join('') + `<option value="custom" ${sel === 'custom' ? 'selected' : ''}>Another store…</option>`;
function openAccount(id, prefill) {
  const a = id && state.accounts.find(x => x.id === id); accIsNew = !a;
  curAcc = Object.assign({}, a || newAccount(prefill));
  if (accIsNew && !curAcc.profileId) { const p = suggestProfile(curAcc); if (p) curAcc.profileId = p.id; }
  renderAccount(); openDlg('dlgAcct');
  if (accIsNew) setTimeout(() => { if (!isCompact()) $('#aEmail').focus(); }, 60);
}
function readAccount() {
  if (!$('#aEmail')) return;
  curAcc.store = $('#aStore').value; curAcc.storeName = $('#aStoreName') ? $('#aStoreName').value.trim() : curAcc.storeName;
  curAcc.email = $('#aEmail').value.trim(); curAcc.password = $('#aPw').value; curAcc.phone = $('#aPhone').value.trim();
  curAcc.profileId = $('#aProf').value; curAcc.status = $('#aStatus').value; curAcc.notes = $('#aNotes').value;
}
function renderAccount() {
  const a = curAcc; const os = accIsNew ? [] : accOrders(a).sort((x, y) => String(y.orderDate).localeCompare(String(x.orderDate)));
  $('#acctTitle').textContent = accIsNew ? 'New account' : accStoreLabel(a) + ' account';
  const sp = suggestProfile(a);
  $('#acctBody').innerHTML = `<div class="fgrid">
      <div class="s2"><label>Store</label><select id="aStore">${storeOptions(a.store)}</select></div>
      <div class="s2" ${a.store === 'custom' ? '' : 'hidden'} id="aStoreNameWrap"><label>Store name</label><input id="aStoreName" value="${esc(a.storeName)}" placeholder="e.g. Kith"></div>
      <div class="s2"><label>Email or username</label><input id="aEmail" value="${esc(a.email)}" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
      <div class="s2"><label>Password</label><div class="hstack" style="gap:6px"><input id="aPw" type="password" value="${esc(a.password)}" autocomplete="new-password" spellcheck="false" style="flex:1;min-width:0"><button class="sm" id="aPwShow">Show</button><button class="sm" id="aPwCopy">Copy</button><button class="sm" id="aPwGen" title="Make a strong password">Generate</button></div></div>
      <div class="s2"><label>Phone on the account</label><input id="aPhone" value="${esc(a.phone)}" inputmode="tel" autocomplete="off"></div>
      <div class="s2"><label>Status</label><select id="aStatus">${ACC_STATUS.map(s => `<option value="${s.k}" ${a.status === s.k ? 'selected' : ''}>${s.l}</option>`).join('')}</select></div>
      <div class="s2"><label>Profile</label><select id="aProf"><option value="">— None —</option>${state.profiles.slice().sort((x, y) => String(x.name).localeCompare(String(y.name), undefined, { numeric: true })).map(p => `<option value="${p.id}" ${a.profileId === p.id ? 'selected' : ''}>${esc(p.name || 'Untitled')}</option>`).join('')}</select>${!a.profileId && sp ? `<div class="small faint" style="margin-top:3px">“${esc(sp.name)}” uses this email — <button class="linkbtn" id="aUseSug">link it</button></div>` : ''}</div>
      <div class="s4"><label>Notes</label><textarea id="aNotes" style="min-height:60px;font-family:inherit;font-size:13px" placeholder="Security answers, 2FA app, when it was made…">${esc(a.notes)}</textarea></div></div>
    ${os.length ? `<div class="section">Orders sent to this email at ${esc(accStoreLabel(a))}</div>${(() => { const si = stickInfo(os); return `<div class="small muted" style="margin-bottom:6px">${si.stuck} stuck · ${si.dead} cancelled${si.pending ? ' · ' + si.pending + ' pending' : ''}${si.rate != null ? ' · ' + si.rate + '% stick rate' : ''}</div>`; })()}${orderMiniList(os.slice(0, 12))}` : ''}`;
  $('#acctDelete').hidden = accIsNew;
  $('#aStore').onchange = () => { readAccount(); renderAccount(); };
  $('#aPwShow').onclick = e => { const i = $('#aPw'); i.type = i.type === 'password' ? 'text' : 'password'; e.target.textContent = i.type === 'password' ? 'Show' : 'Hide'; };
  $('#aPwCopy').onclick = () => copyText($('#aPw').value, 'Password');
  $('#aPwGen').onclick = () => { const i = $('#aPw'); i.value = strongPassword(); i.type = 'text'; };
  if ($('#aUseSug')) $('#aUseSug').onclick = () => { readAccount(); curAcc.profileId = sp.id; renderAccount(); };
  $$('#acctBody [data-order]').forEach(el => el.onclick = () => { closeDlg('dlgAcct'); openOrder(el.dataset.order); });
}
function wireAccDlg() {
  $('#acctSave').onclick = () => {
    readAccount();
    if (!curAcc.email) { toast('Enter the email or username'); return; }
    if (curAcc.store === 'custom' && !curAcc.storeName) { toast('Type the store name'); return; }
    const dup = state.accounts.find(x => x.id !== curAcc.id && accKey(x) === accKey(curAcc));
    if (dup) { toast(`There’s already a ${accStoreLabel(curAcc)} account for ${curAcc.email}`); return; }
    curAcc.updatedAt = Date.now(); snapshot(accIsNew ? 'add account' : 'edit account');
    state.accounts = state.accounts.filter(x => x.id !== curAcc.id).concat([curAcc]);
    save(); closeDlg('dlgAcct'); refresh(); toast(accIsNew ? 'Account saved' : 'Saved', { undo: true });
  };
  $('#acctDelete').onclick = async () => { if (!await ask('Delete this account?\n\nIts saved password is removed from Crown Tools.')) return; snapshot('delete account'); state.accounts = state.accounts.filter(x => x.id !== curAcc.id); save(); closeDlg('dlgAcct'); refresh(); toast('Account deleted', { undo: true }); };
}

/* ---------- import: email:password lists or spreadsheets ---------- */
const ACC_COLS = { email: ['email', 'username', 'login', 'user', 'accountemail', 'emailaddress'], password: ['password', 'pass', 'pw', 'pwd', 'accountpassword'], store: ['store', 'site', 'retailer', 'website', 'shop'], phone: ['phone', 'phonenumber', 'mobile'], profile: ['profile', 'profilename'], status: ['status', 'state'], notes: ['notes', 'note', 'comment', 'comments'] };
const ACC_MAP = {}; for (const [k, arr] of Object.entries(ACC_COLS)) arr.forEach(a => ACC_MAP[a] = k);
function parseAccountsText(text, defStore) {
  const t = String(text || '').replace(/^﻿/, '').trim(); if (!t) return [];
  const lines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const first = lines[0].toLowerCase();
  const out = [];
  // spreadsheet with a header row
  if (/[,\t;]/.test(lines[0]) && /(email|username|login|user)/.test(first) && /(pass|pw)/.test(first)) {
    const rows = parseDelimited(t); const head = rows.shift().map(h => ACC_MAP[norm(h)] || '');
    for (const r of rows) {
      const v = {}; head.forEach((k, i) => { if (k && String(r[i] ?? '').trim()) v[k] = String(r[i]).trim(); });
      if (!v.email) continue; out.push(v);
    }
  } else {
    // email:password  /  email:password:store  /  email,password  /  email password
    for (const l of lines) {
      const m = l.match(/^\s*([^\s:,;|\t]+@[^\s:,;|\t]+|[^\s:,;|\t]{3,})\s*[:,;|\t]\s*(\S(?:.*?\S)?)\s*$/); if (!m) continue;
      let pw = m[2], store = '';
      const tail = pw.match(/^(.*?)\s*[:|\t]\s*([A-Za-z][A-Za-z0-9 .'&\-]{2,30})$/); // email:password:store
      if (tail && Parser.STORES.some(s => norm(s.label) === norm(tail[2]) || s.key === norm(tail[2]))) { pw = tail[1]; store = tail[2]; }
      out.push({ email: m[1], password: pw, store });
    }
  }
  return out.map(v => {
    const sk = v.store ? (Parser.STORES.find(s => s.key === norm(v.store) || norm(s.label) === norm(v.store)) || {}).key : '';
    const st = v.status ? (ACC_STATUS.find(s => norm(s.l) === norm(v.status) || s.k === norm(v.status)) || (/ban/i.test(v.status) ? ACCS.banned : /lock/i.test(v.status) ? ACCS.locked : /work|good|active|ok/i.test(v.status) ? ACCS.active : null)) : null;
    const p = v.profile ? state.profiles.find(x => String(x.name || '').trim().toLowerCase() === v.profile.trim().toLowerCase()) : null;
    return newAccount({ store: sk || (v.store ? 'custom' : defStore), storeName: sk ? '' : (v.store || ''), email: v.email, password: v.password || '', phone: v.phone || '', status: st ? st.k : 'new', notes: v.notes || '', profileId: p ? p.id : '' });
  });
}
let accImp = [];
function openAccImport() {
  $('#aiText').value = ''; $('#aiStore').innerHTML = storeOptions(state.settings.lastAccStore || 'target').replace('<option value="custom"', '<option value="custom" hidden'); accImpPreview(); openDlg('dlgAccImport');
}
function accImpPreview() {
  accImp = parseAccountsText($('#aiText').value, $('#aiStore').value);
  accImp.forEach(a => { if (!a.profileId) { const p = suggestProfile(a); if (p) a.profileId = p.id; } });
  const existing = new Map((state.accounts || []).map(a => [accKey(a), a]));
  const upd = accImp.filter(a => existing.has(accKey(a))).length;
  $('#aiPreview').innerHTML = accImp.length ? `Found <b>${plural(accImp.length, 'account')}</b>${upd ? ` · ${upd} already saved (their password and details get updated)` : ''}${accImp.some(a => a.profileId) ? ` · ${accImp.filter(a => a.profileId).length} matched to a profile by email` : ''}.<div class="list" style="margin-top:8px;max-height:200px;overflow:auto">${accImp.slice(0, 50).map(a => `<div class="li small">${accStoreBadge(a)}<span class="ellipsis" style="flex:1">${esc(a.email)}</span><span class="mono faint">${a.password ? '•'.repeat(Math.min(10, a.password.length)) : 'no password'}</span></div>`).join('')}</div>` : '<span class="faint">Paste lines like <span class="mono">name@gmail.com:Password123</span>, or a spreadsheet with email and password columns.</span>';
  $('#aiGo').disabled = !accImp.length; $('#aiGo').textContent = accImp.length ? `Import ${plural(accImp.length, 'account')}` : 'Import';
}
function wireAccImport() {
  $('#aiText').oninput = debounce(accImpPreview, 150); $('#aiStore').onchange = accImpPreview;
  $('#aiFile').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; $('#aiText').value = await f.text(); accImpPreview(); };
  $('#aiGo').onclick = () => {
    if (!accImp.length) return; snapshot('import accounts');
    const byKey = new Map(state.accounts.map(a => [accKey(a), a])); let added = 0, updated = 0;
    for (const a of accImp) {
      const ex = byKey.get(accKey(a));
      if (ex) { if (a.password) ex.password = a.password; if (a.phone) ex.phone = a.phone; if (a.notes) ex.notes = [ex.notes, a.notes].filter(Boolean).join('\n'); if (a.profileId && !ex.profileId) ex.profileId = a.profileId; if (a.status !== 'new') ex.status = a.status; ex.updatedAt = Date.now(); updated++; }
      else { state.accounts.push(a); byKey.set(accKey(a), a); added++; }
    }
    state.settings.lastAccStore = $('#aiStore').value;
    save(); closeDlg('dlgAccImport'); refresh(); toast(`Imported: ${added} new${updated ? `, ${updated} updated` : ''}`, { undo: true });
  };
}

/* ---------- export ---------- */
function openAccExport() {
  const list = accSel.size ? state.accounts.filter(a => accSel.has(a.id)) : filteredAccounts();
  $('#aeCount').textContent = `${plural(list.length, 'account')}${accSel.size ? ' selected' : AF.store || AF.status !== 'all' || AF.q ? ' shown' : ''}`;
  $('#aeCsv').onclick = () => { download(`crown-tools-accounts-${stamp()}.csv`, toCSV(['store', 'email', 'password', 'phone', 'status', 'profile', 'notes'], list.map(a => ({ store: accStoreLabel(a), email: a.email, password: a.password, phone: a.phone, status: (ACCS[a.status] || ACCS.new).l, profile: (accProfile(a) || {}).name || '', notes: a.notes }))), 'text/csv'); closeDlg('dlgAccExport'); };
  $('#aeTxt').onclick = () => { download(`crown-tools-accounts-${stamp()}.txt`, list.map(a => `${a.email}:${a.password}`).join('\n') + '\n', 'text/plain'); closeDlg('dlgAccExport'); };
  $('#aeCopy').onclick = () => { copyText(list.map(a => `${a.email}:${a.password}`).join('\n'), plural(list.length, 'login')); closeDlg('dlgAccExport'); };
  openDlg('dlgAccExport');
}
// Profile dialog: the store accounts that belong to this profile
function profileAccountsHtml(p) {
  const e = String(p.email || '').toLowerCase().trim();
  const list = (state.accounts || []).filter(a => a.profileId === p.id || (e && !a.profileId && String(a.email || '').toLowerCase().trim() === e));
  if (!list.length) return '';
  return `<div class="section">Store accounts</div><div class="list">${list.map(a => { const st = ACCS[a.status] || ACCS.new; return `<div class="li small">${accStoreBadge(a)}<span class="ellipsis" style="flex:1">${esc(a.email)}</span><span class="hpill"><i style="background:${st.c}"></i>${esc(st.l)}</span></div>`; }).join('')}</div>`;
}

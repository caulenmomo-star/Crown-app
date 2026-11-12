/* Kingpin - Mailbox: every email in an inbox, to find things and clean up.
   - "Emails": the whole inbox, newest first. Search who it's from, who it was sent to (each Hide My Email address),
     the subject - and with "Search inside emails" the mail server also searches the message text.
   - "Sent to": one row per address the mail came to (every Hide My Email address). "From": one row per sender.
     "Kinds": the same kind of email together ("Target · Your order #… has shipped", "Target newsletters") with how
     much space they take, so a whole kind can be selected and deleted at once.
   - Click an email to read it. Delete moves emails to the inbox's trash (Deleted Messages on iCloud).
   The list is kept on this device, encrypted with your Kingpin key, so opening it again only loads what's new. */
'use strict';
const MB = { acc: '', folder: 'INBOX', rows: [], key: '', validity: '', loaded: false, loading: false, prog: null, err: '', at: 0,
  view: 'all', q: '', srv: null, range: 'all', from: '', to: '', sort: 't', dir: -1, sel: new Set(), last: -1, show: 200,
  f: null, folders: {}, run: 0, gsort: 'n', unread: false };
const MB_VIEWS = [['all', 'Emails'], ['to', 'Sent to'], ['from', 'From'], ['type', 'Kinds']];
const fmtSize = n => n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : (n || 0) + ' B';
const mbAccs = () => (state.imapAccounts || []).filter(a => a.user && a.pass && a.host);
const mbAcc = () => mbAccs().find(a => a.id === MB.acc) || mbAccs()[0] || null;
const mbPayload = a => Object.assign(accPayload(a), { folder: MB.folder });
// one row per email: [uid, time, from name, from address, sent to, subject, size, read, newsletter]
const mbRow = r => ({ uid: r[0], t: r[1], fn: r[2], fa: r[3], to: r[4], s: r[5], z: r[6], seen: !!r[7], nl: !!r[8] });
const mbPack = x => [x.uid, x.t, x.fn, x.fa, x.to, x.s, x.z, x.seen ? 1 : 0, x.nl ? 1 : 0];
// "the same kind of email": same sender (site), subject with numbers / names taken out; newsletters by sender
const mbSite = a => { const d = String(a || '').split('@')[1] || ''; const p = d.split('.'); return p.length > 2 && !/^(co|com|org|net)$/.test(p[p.length - 2]) ? p.slice(-2).join('.') : p.length > 2 ? p.slice(-3).join('.') : d; };
const mbSubjKey = s => String(s || '').toLowerCase().replace(/^\s*((re|fwd?|fw)\s*:\s*)+/g, '').replace(/[#№]?\s*\b[a-z]{0,4}\d[\d-]{2,}\w*/g, '#').replace(/\$\s?\d[\d,.]*/g, '$').replace(/\d+/g, '#').replace(/[^a-z#$&]+/g, ' ').trim();
function mbKind(x) {
  if (!x.k) x.k = x.nl ? x.fa + '|news' : mbSite(x.fa) + '|' + mbSubjKey(x.s);
  return x.k;
}
function mbKindLabel(x) {
  const who = x.fn || mbSite(x.fa);
  return x.nl ? `${who} · newsletters & promos` : `${who} · ${String(x.s || '(no subject)').replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, '').replace(/(^|\s)[#№]?\s?[A-Za-z]{0,4}\d[\d-]{2,}\w*/g, '$1#…').slice(0, 90)}`;
}

/* ---------- loading (only what's new; the list is cached on this device, encrypted) ---------- */
function mbDB() {
  return new Promise((ok, bad) => { try { const r = indexedDB.open('kingpin-mail', 1); r.onupgradeneeded = () => r.result.createObjectStore('lists'); r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); } catch (e) { bad(e); } });
}
async function mbCacheGet(key) {
  try { const db = await mbDB(); const blob = await new Promise((ok, bad) => { const q = db.transaction('lists').objectStore('lists').get(key); q.onsuccess = () => ok(q.result); q.onerror = () => bad(q.error); }); return blob && cryptoKey ? await decryptWithKey(blob, cryptoKey) : null; } catch (_) { return null; }
}
async function mbCachePut(key, val) {
  try { const blob = await encryptJSON(cryptoKey, salt, JSON.stringify(val)); const db = await mbDB(); await new Promise((ok, bad) => { const t = db.transaction('lists', 'readwrite'); t.objectStore('lists').put(blob, key); t.oncomplete = ok; t.onerror = () => bad(t.error); }); } catch (_) { }
}
async function mbCacheClear() { try { const db = await mbDB(); await new Promise(ok => { const t = db.transaction('lists', 'readwrite'); t.objectStore('lists').clear(); t.oncomplete = ok; t.onerror = ok; }); } catch (_) { } }
const mbSave = () => mbCachePut(MB.key, { v: 1, validity: MB.validity, at: MB.at, rows: MB.rows.map(mbPack) });
async function mbLoad(fresh) {
  const a = mbAcc(); if (!a || MB.loading) return;
  if (!SERVER) { MB.err = 'Reading your email needs Kingpin Online or the Kingpin app.'; mbRender(); return; }
  const run = ++MB.run, key = a.id + '|' + MB.folder;
  MB.loading = true; MB.err = ''; MB.prog = { done: 0, total: 0, step: 'Checking the inbox…' }; mbRender();
  try {
    if (MB.key !== key) {
      MB.key = key; MB.rows = []; MB.sel.clear(); MB.srv = null; MB.validity = '';
      const c = fresh ? null : await mbCacheGet(key);
      if (run !== MB.run) return;
      if (c && c.rows) { MB.rows = c.rows.map(mbRow); MB.validity = c.validity || ''; MB.at = c.at || 0; MB.loaded = true; mbRender(); }
    }
    const u = await api('/api/imap/uids', { account: mbPayload(a) });
    if (run !== MB.run) return;
    if (u.uidValidity && MB.validity && u.uidValidity !== MB.validity) MB.rows = [];
    MB.validity = u.uidValidity;
    const live = new Set(u.uids), have = new Set(MB.rows.map(x => x.uid));
    MB.rows = MB.rows.filter(x => live.has(x.uid));                     // deleted somewhere else
    for (const id of [...MB.sel]) if (!live.has(id)) MB.sel.delete(id);
    const need = u.uids.filter(id => !have.has(id)).sort((x, y) => y - x); // newest first
    MB.prog = { done: 0, total: need.length, step: need.length ? 'Loading emails' : '' };
    let batch = 0;
    for (let i = 0; i < need.length; i += 1000) {
      const r = await api('/api/imap/headers', { account: mbPayload(a), uids: need.slice(i, i + 1000) });
      if (run !== MB.run) return;
      MB.rows.push(...r.rows.map(mbRow));
      MB.prog.done = Math.min(need.length, i + 1000);
      MB.loaded = true; mbRender();
      if (++batch % 5 === 0) mbSave();
    }
    MB.at = Date.now(); MB.loaded = true; mbSave();
  } catch (e) { if (run === MB.run) MB.err = e.message || 'Couldn’t read this inbox.'; }
  finally { if (run === MB.run) { MB.loading = false; MB.prog = null; mbRender(); } }
}
async function mbFolders() {
  const a = mbAcc(); if (!a || MB.folders[a.id] || !SERVER) return;
  MB.folders[a.id] = 'loading';
  try { MB.folders[a.id] = (await api('/api/imap/folders', { account: accPayload(a) })).folders || []; } catch (_) { MB.folders[a.id] = null; }
  mbRender();
}

/* ---------- filtering ---------- */
function mbRangeStart() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return { today: +d, '7': +d - 6 * 864e5, '30': +d - 29 * 864e5, '90': +d - 89 * 864e5, year: +new Date(d.getFullYear(), 0, 1) }[MB.range] || 0;
}
function mbFiltered(skipFocus) {
  const words = MB.q.toLowerCase().split(/\s+/).filter(Boolean), srv = MB.srv && MB.srv.q === MB.q.trim() ? MB.srv.uids : null;
  const t0 = MB.range === 'custom' ? (MB.from ? +new Date(MB.from + 'T00:00') : 0) : mbRangeStart(), t1 = MB.range === 'custom' && MB.to ? +new Date(MB.to + 'T23:59:59') : Infinity;
  const f = skipFocus ? null : MB.f;
  return MB.rows.filter(x => {
    if (x.t < t0 || x.t > t1) return false;
    if (MB.unread && x.seen) return false;
    if (f && (f.by === 'to' ? x.to !== f.v : f.by === 'from' ? x.fa !== f.v : mbKind(x) !== f.v)) return false;
    if (!words.length) return true;
    if (srv && srv.has(x.uid)) return true;
    const hay = (x.fn + ' ' + x.fa + ' ' + x.to + ' ' + x.s).toLowerCase();
    return words.every(w => hay.includes(w));
  });
}
function mbSorted(list) {
  const k = MB.sort, d = MB.dir;
  const val = x => k === 't' ? x.t : k === 'z' ? x.z : k === 'to' ? x.to : k === 'from' ? (x.fn || x.fa).toLowerCase() : String(x.s).toLowerCase();
  return list.slice().sort((a, b) => { const p = val(a), q = val(b); return (p < q ? -1 : p > q ? 1 : 0) * d || (b.t - a.t); });
}
function mbGroups(list, by) {
  const m = new Map();
  for (const x of list) {
    const k = by === 'to' ? x.to || '(no address)' : by === 'from' ? x.fa || '(unknown sender)' : mbKind(x);
    let g = m.get(k); if (!g) m.set(k, g = { k, n: 0, z: 0, t: 0, x, unread: 0 });
    g.n++; g.z += x.z; if (x.t > g.t) { g.t = x.t; g.x = x; } if (!x.seen) g.unread++;
  }
  const gs = [...m.values()];
  const s = MB.gsort;
  gs.sort((a, b) => s === 'z' ? b.z - a.z : s === 't' ? b.t - a.t : s === 'a' ? String(a.k).localeCompare(String(b.k)) : b.n - a.n || b.t - a.t);
  return gs;
}

/* ---------- page ---------- */
function mbWhen(t) {
  if (!t) return '—';
  const d = new Date(t), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return fmtDate(d);
}
const mbHi = (s, words) => { let h = esc(s); for (const w of words) if (w.length > 1) h = h.replace(new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&/g, '&amp;') + ')', 'ig'), '<mark>$1</mark>'); return h; };
function mbRender() { if (route.page === 'mail') PAGES.mail.render(); }
PAGES.mail = {
  render() {
    const pg = $('#pg-mail'); if (!pg) return;
    const accs = mbAccs(), a = mbAcc();
    if (!a) {
      pg.innerHTML = `<div class="pagehead"><h1>Mailbox</h1></div><div class="empty">Add an inbox first (Email → Inboxes). Then every email in it shows here: search by the address it was sent to (each Hide My Email address), who sent it or what it says, and clear out piles of the same email at once.<div style="margin-top:12px"><button class="primary" id="mbGoInbox">Go to Inboxes</button></div></div>`;
      $('#mbGoInbox').onclick = () => go('inboxes');
      return;
    }
    if (MB.acc !== a.id) MB.acc = a.id;
    const key = a.id + '|' + MB.folder;
    if (MB.key !== key && !MB.loading) { setTimeout(() => mbLoad(), 0); }
    mbFolders();
    const words = MB.q.toLowerCase().split(/\s+/).filter(Boolean);
    const base = mbFiltered(true), list = MB.f ? mbFiltered() : base;
    const total = MB.rows.reduce((s, x) => s + x.z, 0);
    const fl = Array.isArray(MB.folders[a.id]) ? MB.folders[a.id] : null;
    const prog = MB.prog && MB.prog.total ? `<div class="mbprog"><div class="small">${esc(MB.prog.step)} — ${MB.prog.done.toLocaleString()} of ${MB.prog.total.toLocaleString()} (newest first)</div><div class="bar"><i style="width:${Math.round(MB.prog.done / MB.prog.total * 100)}%"></i></div></div>` : MB.loading ? `<div class="small muted mbprog">${esc((MB.prog && MB.prog.step) || 'Checking the inbox…')}</div>` : '';
    const srvBtn = words.length && !(MB.srv && MB.srv.q === MB.q.trim()) ? `<button class="sm" id="mbSrv" title="Also look inside the emails (the mail server searches the message text)">Search inside emails too</button>` : MB.srv && MB.srv.q === MB.q.trim() ? `<span class="small muted">${MB.srv.busy ? 'Searching inside emails…' : `Inside emails: ${plural(MB.srv.uids.size, 'match', 'matches')}`}</span>` : '';
    const focus = MB.f ? `<div class="mbfocus"><span class="small muted">${{ to: 'Sent to', from: 'From', type: 'Kind' }[MB.f.by]}</span> <b class="ellipsis">${esc(MB.f.label || MB.f.v)}</b> <span class="small muted">${plural(list.length, 'email')} · ${fmtSize(list.reduce((s, x) => s + x.z, 0))}</span>${MB.f.by === 'to' ? `<button class="ghost sm" id="mbCopyTo" title="Copy this address">⧉</button>` : ''}<div class="spacer"></div><button class="sm" id="mbFocusSel">Select all ${list.length.toLocaleString()}</button><button class="ghost sm" id="mbFocusX">✕ Show everything</button></div>` : '';
    let body = '';
    if (!MB.loaded && MB.loading) body = `<div class="empty">Opening ${esc(a.label || a.user)}…</div>`;
    else if (MB.view === 'all' || MB.f) body = mbListHtml(list, words);
    else body = mbGroupsHtml(mbGroups(base, MB.view));
    const nSel = MB.sel.size, selZ = nSel ? MB.rows.reduce((s, x) => s + (MB.sel.has(x.uid) ? x.z : 0), 0) : 0;
    pg.innerHTML = `<div class="pagehead"><h1>Mailbox</h1><span class="sub">${MB.loaded ? `${MB.rows.length.toLocaleString()} emails · ${fmtSize(total)}` : ''}${MB.at ? ` · updated ${mbWhen(MB.at)}` : ''}</span><div class="spacer"></div>
        <button id="mbRefresh" ${MB.loading ? 'disabled' : ''}>${MB.loading ? 'Loading…' : '↻ Refresh'}</button></div>
      <div class="mbbar">
        ${accs.length > 1 ? `<select id="mbAcc" title="Inbox">${accs.map(x => `<option value="${x.id}" ${x.id === a.id ? 'selected' : ''}>${esc(x.label || x.user)}</option>`).join('')}</select>` : `<span class="mbacc ellipsis" title="${esc(a.user)}">${esc(a.label || a.user)}</span>`}
        <select id="mbFolder" title="Folder">${(fl || [{ name: MB.folder }]).map(f => `<option ${f.name === MB.folder ? 'selected' : ''} value="${esc(f.name)}">${esc(f.name === 'INBOX' ? 'Inbox' : f.name)}</option>`).join('')}${fl && !fl.some(f => f.name === MB.folder) ? `<option selected>${esc(MB.folder)}</option>` : ''}</select>
        <select id="mbRange" title="When it was sent">${[['all', 'Any time'], ['today', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['year', 'This year'], ['custom', 'Custom dates…']].map(([k, l]) => `<option value="${k}" ${MB.range === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        ${MB.range === 'custom' ? `<span class="mbdates"><input type="date" id="mbFrom" value="${esc(MB.from)}" aria-label="From"><span class="muted">–</span><input type="date" id="mbTo" value="${esc(MB.to)}" aria-label="To"></span>` : ''}
        <label class="small mbunread"><input type="checkbox" id="mbUnread" ${MB.unread ? 'checked' : ''}> Unread only</label>
      </div>
      ${prog}${MB.err ? `<div class="note warn small" style="margin-bottom:10px">${esc(MB.err)}</div>` : ''}
      <div class="toolbar mbsearch"><input class="search" data-search id="mbQ" placeholder="Search address, sender, subject…  ( / )" value="${esc(MB.q)}" autocomplete="off">${srvBtn}</div>
      <div class="seg mbviews" id="mbViews">${MB_VIEWS.map(([k, l]) => `<button data-mbv="${k}" class="${MB.view === k && !MB.f ? 'on' : ''}">${l}${k !== 'all' && MB.loaded ? ` <span class="n">${mbGroups(base, k).length.toLocaleString()}</span>` : k === 'all' && MB.loaded ? ` <span class="n">${base.length.toLocaleString()}</span>` : ''}</button>`).join('')}</div>
      ${focus}
      ${nSel ? `<div class="selbar mbsel"><strong>${nSel.toLocaleString()} selected</strong><span class="small muted">${fmtSize(selZ)}</span><button class="sm danger" id="mbDel">Delete</button><button class="sm" id="mbCopySel" title="Copy the addresses they were sent to">Copy addresses</button><div class="spacer"></div><button class="sm ghost" id="mbClr">Clear</button></div>` : ''}
      ${body}`;
    mbWire(pg, list, base);
  },
};
function mbListHtml(list, words) {
  if (!list.length) return `<div class="empty">${MB.rows.length ? 'No emails match.' : MB.loading ? 'Loading…' : 'This folder is empty.'}</div>`;
  const rows = mbSorted(list), shown = rows.slice(0, MB.show), all = rows.length && rows.every(x => MB.sel.has(x.uid));
  const th = (k, l, cls) => `<th class="${cls || ''}"><button class="thsort ${MB.sort === k ? 'on' : ''}" data-mbs="${k}">${l}${MB.sort === k ? (MB.dir < 0 ? ' ↓' : ' ↑') : ''}</button></th>`;
  return `<div class="tablewrap"><table class="mbtable"><thead><tr><th class="cb"><input type="checkbox" id="mbAll" ${all ? 'checked' : ''} aria-label="Select all ${rows.length}" title="Select all ${rows.length.toLocaleString()} shown"></th>${th('t', 'Date', 'mb-t')}${th('to', 'Sent to', 'mb-to')}${th('from', 'From', 'mb-from')}${th('s', 'Subject', 'mb-s')}${th('z', 'Size', 'mb-z')}</tr></thead><tbody>
    ${shown.map((x, i) => `<tr data-mb="${x.uid}" data-i="${i}" class="${MB.sel.has(x.uid) ? 'sel' : ''} ${x.seen ? '' : 'unread'}"><td class="cb"><input type="checkbox" data-mbc="${x.uid}" ${MB.sel.has(x.uid) ? 'checked' : ''} aria-label="Select"></td>
      <td class="mb-t small">${mbWhen(x.t)}</td><td class="mb-to ellipsis" title="${esc(x.to)}">${mbHi(x.to, words)}</td><td class="mb-from ellipsis" title="${esc(x.fa)}">${mbHi(x.fn || x.fa, words)}</td><td class="mb-s ellipsis">${x.nl ? '<span class="mbnl" title="Newsletter / promo">▤</span>' : ''}${mbHi(x.s || '(no subject)', words)}</td><td class="mb-z small muted">${fmtSize(x.z)}</td></tr>`).join('')}
  </tbody></table></div>${rows.length > shown.length ? `<div class="mbmore"><span class="small muted">Showing ${shown.length.toLocaleString()} of ${rows.length.toLocaleString()}</span><button class="sm" id="mbMore">Show ${Math.min(500, rows.length - shown.length).toLocaleString()} more</button></div>` : ''}`;
}
function mbGroupsHtml(gs) {
  if (!gs.length) return `<div class="empty">${MB.loading ? 'Loading…' : 'No emails match.'}</div>`;
  const by = MB.view, top = gs.slice(0, 400);
  const lbl = g => by === 'type' ? mbKindLabel(g.x) : by === 'from' ? (g.x.fn ? `${g.x.fn} <span class="faint">${esc(g.k)}</span>` : esc(g.k)) : esc(g.k);
  const sortSel = `<select id="mbGSort" class="mbgsort">${[['n', 'Most emails'], ['z', 'Most space'], ['t', 'Newest'], ['a', 'A–Z']].map(([k, l]) => `<option value="${k}" ${MB.gsort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  return `<div class="mbghead"><span class="small muted">${plural(gs.length, by === 'to' ? 'address' : by === 'from' ? 'sender' : 'kind', by === 'to' ? 'addresses' : null)}${by === 'type' ? ' — the same email over and over shows up as one row' : ''}</span><div class="spacer"></div>${sortSel}</div>
    <div class="mbgroups">${top.map(g => { const ids = MB.rows.length ? null : null; return `<div class="mbg" data-mbg="${esc(g.k)}"><input type="checkbox" data-mbgc="${esc(g.k)}" aria-label="Select all ${g.n}" title="Select all ${g.n}"><div class="mbgmain"><div class="ellipsis mbgname">${by === 'type' ? esc(lbl(g)) : lbl(g)}</div><div class="small muted ellipsis">${by === 'to' ? `${esc(g.x.fn || g.x.fa)} · ${esc(g.x.s)}` : by === 'from' ? esc(g.x.s) : `to ${esc(g.x.to)}`}</div></div><div class="mbgnum"><b>${g.n.toLocaleString()}</b><span class="small muted">${fmtSize(g.z)} · ${mbWhen(g.t)}</span></div>${by === 'to' ? `<button class="ghost sm icopy" data-mbcopy="${esc(g.k)}" title="Copy address">⧉</button>` : ''}</div>`; }).join('')}</div>
    ${gs.length > top.length ? `<div class="small muted mbmore">Showing the top 400 — search to narrow it down.</div>` : ''}`;
}
function mbWire(pg, list, base) {
  const a = mbAcc();
  $('#mbRefresh').onclick = () => mbLoad();
  if ($('#mbAcc')) $('#mbAcc').onchange = e => { MB.acc = e.target.value; MB.folder = 'INBOX'; MB.f = null; MB.sel.clear(); MB.run++; MB.loading = false; MB.key = ''; mbRender(); };
  $('#mbFolder').onchange = e => { MB.folder = e.target.value; MB.f = null; MB.sel.clear(); MB.run++; MB.loading = false; MB.key = ''; mbRender(); };
  $('#mbRange').onchange = e => { MB.range = e.target.value; MB.show = 200; mbRender(); };
  if ($('#mbFrom')) { $('#mbFrom').onchange = e => { MB.from = e.target.value; mbRender(); }; $('#mbTo').onchange = e => { MB.to = e.target.value; mbRender(); }; }
  $('#mbUnread').onchange = e => { MB.unread = e.target.checked; mbRender(); };
  $('#mbQ').oninput = debounce(e => { MB.q = e.target.value; MB.show = 200; mbRender(); const i = $('#mbQ'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 180);
  if ($('#mbSrv')) $('#mbSrv').onclick = async () => {
    const q = MB.q.trim(); MB.srv = { q, uids: new Set(), busy: true }; mbRender();
    try { const r = await api('/api/imap/search', { account: mbPayload(a), q }); if (MB.srv && MB.srv.q === q) { MB.srv = { q, uids: new Set(r.uids) }; if (MB.view !== 'all' && !MB.f) MB.view = 'all'; } }
    catch (e) { MB.srv = null; toast(e.message || 'Couldn’t search inside the emails'); }
    mbRender();
  };
  $('#mbViews').onclick = e => { const b = e.target.closest('[data-mbv]'); if (!b) return; MB.view = b.dataset.mbv; MB.f = null; MB.show = 200; mbRender(); };
  if ($('#mbGSort')) $('#mbGSort').onchange = e => { MB.gsort = e.target.value; mbRender(); };
  if ($('#mbFocusX')) $('#mbFocusX').onclick = () => { MB.f = null; mbRender(); };
  if ($('#mbFocusSel')) $('#mbFocusSel').onclick = () => { list.forEach(x => MB.sel.add(x.uid)); mbRender(); };
  if ($('#mbCopyTo')) $('#mbCopyTo').onclick = () => copyText(MB.f.v, 'Address');
  if ($('#mbMore')) $('#mbMore').onclick = () => { MB.show += 500; mbRender(); };
  if ($('#mbClr')) $('#mbClr').onclick = () => { MB.sel.clear(); mbRender(); };
  if ($('#mbDel')) $('#mbDel').onclick = () => mbDelete([...MB.sel]);
  if ($('#mbCopySel')) $('#mbCopySel').onclick = () => { const s = [...new Set(MB.rows.filter(x => MB.sel.has(x.uid)).map(x => x.to).filter(Boolean))]; copyText(s.join('\n'), plural(s.length, 'address', 'addresses')); };
  if ($('#mbAll')) $('#mbAll').onchange = e => { const rows = mbSorted(list); rows.forEach(x => e.target.checked ? MB.sel.add(x.uid) : MB.sel.delete(x.uid)); mbRender(); };
  pg.querySelectorAll('[data-mbs]').forEach(b => b.onclick = () => { const k = b.dataset.mbs; if (MB.sort === k) MB.dir = -MB.dir; else { MB.sort = k; MB.dir = k === 't' || k === 'z' ? -1 : 1; } mbRender(); });
  const tb = pg.querySelector('.mbtable tbody');
  if (tb) tb.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-mb]'); if (!tr) return;
    const uid = +tr.dataset.mb, i = +tr.dataset.i, cb = e.target.closest('[data-mbc]');
    if (cb || e.shiftKey || e.metaKey || e.ctrlKey) {
      if (!cb) e.preventDefault();
      const rows = mbSorted(list).slice(0, MB.show);
      if (e.shiftKey && MB.last >= 0) { const [p, q] = [Math.min(MB.last, i), Math.max(MB.last, i)]; const on = !MB.sel.has(uid) || !!cb; for (let k = p; k <= q; k++) on ? MB.sel.add(rows[k].uid) : MB.sel.delete(rows[k].uid); }
      else MB.sel.has(uid) ? MB.sel.delete(uid) : MB.sel.add(uid);
      MB.last = i; mbRender(); return;
    }
    mbOpen(uid, mbSorted(list).map(x => x.uid));
  });
  const gl = pg.querySelector('.mbgroups');
  if (gl) gl.addEventListener('click', e => {
    const cp = e.target.closest('[data-mbcopy]'); if (cp) { copyText(cp.dataset.mbcopy, 'Address'); return; }
    const gc = e.target.closest('[data-mbgc]');
    const by = MB.view, k = (gc || e.target.closest('[data-mbg]') || {}).dataset;
    if (!k) return;
    const v = gc ? gc.dataset.mbgc : k.mbg;
    const inG = base.filter(x => (by === 'to' ? (x.to || '(no address)') : by === 'from' ? (x.fa || '(unknown sender)') : mbKind(x)) === v);
    if (gc) { const on = gc.checked; inG.forEach(x => on ? MB.sel.add(x.uid) : MB.sel.delete(x.uid)); mbRender(); return; }
    MB.f = { by, v, label: by === 'type' ? mbKindLabel(inG[0]) : by === 'from' && inG[0].fn ? `${inG[0].fn} (${v})` : v }; MB.show = 200; mbRender(); window.scrollTo(0, 0);
  });
  // group checkboxes show whether the whole group is selected
  pg.querySelectorAll('[data-mbgc]').forEach(c => { const v = c.dataset.mbgc, by = MB.view; const inG = base.filter(x => (by === 'to' ? (x.to || '(no address)') : by === 'from' ? (x.fa || '(unknown sender)') : mbKind(x)) === v); const n = inG.filter(x => MB.sel.has(x.uid)).length; c.checked = n && n === inG.length; c.indeterminate = n > 0 && n < inG.length; });
}

/* ---------- delete ---------- */
async function mbDelete(uids) {
  const a = mbAcc(); if (!a || !uids.length) return;
  const rows = MB.rows.filter(x => uids.includes(x.uid)), z = rows.reduce((s, x) => s + x.z, 0);
  const inTrash = /trash|deleted/i.test(MB.folder);
  if (!await ask(inTrash ? `Delete ${plural(rows.length, 'email')} for good (${fmtSize(z)})?\n\nThey’re already in the trash, so this can’t be undone.` : `Move ${plural(rows.length, 'email')} (${fmtSize(z)}) to the trash?\n\nYou can still get them back from the inbox’s trash (on iCloud: Deleted Messages, kept for 30 days).`, { ok: inTrash ? 'Delete for good' : `Delete ${rows.length.toLocaleString()}`, danger: true })) return;
  const all = uids.slice(); let done = 0, where = '';
  toast(`Deleting ${plural(all.length, 'email')}…`, { ms: 60000 });
  try {
    for (let i = 0; i < all.length; i += 1000) {
      const part = all.slice(i, i + 1000);
      const r = await api('/api/imap/delete', { account: mbPayload(a), uids: part });
      done += r.moved; where = r.permanent ? '' : r.trash;
      const gone = new Set(part); MB.rows = MB.rows.filter(x => !gone.has(x.uid)); part.forEach(u => MB.sel.delete(u));
      mbRender();
    }
    mbSave();
    toast(where ? `Moved ${plural(done, 'email')} to ${where}` : `Deleted ${plural(done, 'email')}`, { ms: 6000 });
  } catch (e) { mbSave(); toast((done ? `Deleted ${plural(done, 'email')}, then: ` : '') + (e.message || 'Couldn’t delete those emails')); }
  if (MB.f && !mbFiltered().length) MB.f = null;
  closeDlg('dlgMail'); mbRender();
}

/* ---------- reading one email ---------- */
const MBR = { uid: 0, list: [], pics: false, msg: null };
function mbOpen(uid, list) {
  MBR.uid = uid; MBR.list = list || MBR.list; MBR.msg = null;
  if (!document.getElementById('dlgMail')) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="dlgMail" class="wide mbread"><div class="dhead"><span class="ellipsis" id="mrSubj">Email</span><button class="ghost sm x" data-close>✕</button></div>
      <div class="dbody"><div id="mrHead" class="mrhead"></div><div class="mrsim small" id="mrSim"><span class="muted">Show all:</span><button class="chip" data-mrf="to">sent to this address</button><button class="chip" data-mrf="from">from this sender</button><button class="chip" data-mrf="type">emails like this</button></div><div id="mrFiles"></div><div id="mrPics" class="small muted" hidden></div><iframe id="mrBody" sandbox="allow-popups allow-popups-to-escape-sandbox" title="Email"></iframe></div>
      <div class="dfoot"><button class="sm" id="mrPrev" title="Newer (←)">‹</button><button class="sm" id="mrNext" title="Older (→)">›</button><div class="spacer"></div><button class="sm danger" id="mrDel">Delete</button></div></dialog>`);
    const d = $('#dlgMail');
    d.addEventListener('keydown', e => { if (e.target.closest('input,select,textarea')) return; if (e.key === 'ArrowLeft') $('#mrPrev').click(); if (e.key === 'ArrowRight') $('#mrNext').click(); });
    $('#mrPrev').onclick = () => { const i = MBR.list.indexOf(MBR.uid); if (i > 0) mbOpen(MBR.list[i - 1]); };
    $('#mrNext').onclick = () => { const i = MBR.list.indexOf(MBR.uid); if (i >= 0 && i < MBR.list.length - 1) mbOpen(MBR.list[i + 1]); };
    $('#mrDel').onclick = () => mbDelete([MBR.uid]);
    $('#mrSim').onclick = e => {
      const b = e.target.closest('[data-mrf]'); const x = MB.rows.find(r => r.uid === MBR.uid); if (!b || !x) return;
      const f = b.dataset.mrf;
      if (f === 'to') mbFocus('to', x.to, x.to); else if (f === 'from') mbFocus('from', x.fa, x.fn ? `${x.fn} (${x.fa})` : x.fa); else mbFocus('type', mbKind(x), mbKindLabel(x));
    };
  }
  const x = MB.rows.find(r => r.uid === uid) || {};
  $('#mrSubj').textContent = x.s || '(no subject)';
  $('#mrHead').innerHTML = mbHeadHtml(x, null);
  $('#mrFiles').innerHTML = ''; $('#mrPics').hidden = true;
  const fr = $('#mrBody'); fr.srcdoc = '<p style="font:14px system-ui;color:#888;padding:16px">Loading…</p>';
  const i = MBR.list.indexOf(uid); $('#mrPrev').disabled = i <= 0; $('#mrNext').disabled = i < 0 || i >= MBR.list.length - 1;
  openDlg('dlgMail');
  const a = mbAcc();
  api('/api/imap/message', { account: mbPayload(a), uid }).then(m => {
    if (MBR.uid !== uid) return;
    MBR.msg = m; MBR.pics = false;
    $('#mrHead').innerHTML = mbHeadHtml(x, m);
    $('#mrFiles').innerHTML = (m.files || []).length ? `<div class="mrfiles small">📎 ${m.files.map(f => `${esc(f.name)} <span class="faint">${fmtSize(f.size)}</span>`).join(' · ')}</div>` : '';
    mbShowBody(m);
    const c = $('#mrHead').querySelector('[data-mrcopy]'); if (c) c.onclick = () => copyText(c.dataset.mrcopy, 'Address');
  }).catch(e => { if (MBR.uid === uid) fr.srcdoc = `<p style="font:14px system-ui;color:#c55;padding:16px">${esc(e.message || 'Couldn’t open this email.')}</p>`; });
}
function mbFocus(by, v, label) { closeDlg('dlgMail'); MB.f = { by, v, label }; MB.show = 200; go('mail'); mbRender(); }
function mbHeadHtml(x, m) {
  const to = m ? m.sentTo || x.to : x.to;
  return `<div class="mrrow"><span class="muted">From</span><span class="ellipsis">${esc(m ? m.from : (x.fn ? `${x.fn} <${x.fa}>` : x.fa))}</span></div>
    <div class="mrrow"><span class="muted">Sent to</span><span class="ellipsis"><b>${esc(to || '—')}</b></span>${to ? `<button class="ghost sm icopy" data-mrcopy="${esc(to)}" title="Copy">⧉</button>` : ''}</div>
    <div class="mrrow"><span class="muted">Date</span><span>${m && m.date ? fmtDT(m.date) : x.t ? fmtDT(x.t) : '—'}</span>${x.z ? `<span class="faint small" style="margin-left:auto">${fmtSize(x.z)}</span>` : ''}</div>`;
}
// the email's own HTML, made safe: no scripts or forms, links open in a new tab, pictures only when you ask
function mbSafeHtml(html, pics) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,iframe,object,embed,form,meta[http-equiv],link[rel=import],base').forEach(n => n.remove());
  let blocked = 0;
  doc.querySelectorAll('*').forEach(n => {
    for (const at of [...n.attributes]) {
      const nm = at.name.toLowerCase(), v = at.value.trim().toLowerCase();
      if (nm.startsWith('on') || ((nm === 'href' || nm === 'src' || nm === 'action' || nm === 'xlink:href') && v.startsWith('javascript:'))) n.removeAttribute(at.name);
    }
    if (n.tagName === 'A') { n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener noreferrer'); }
    if (!pics && (n.tagName === 'IMG' || n.tagName === 'IMAGE') && /^https?:/i.test(n.getAttribute('src') || '')) { n.setAttribute('data-src', n.getAttribute('src')); n.removeAttribute('src'); n.removeAttribute('srcset'); blocked++; }
    if (!pics && n.style && /url\(/i.test(n.getAttribute('style') || '')) { n.setAttribute('style', n.getAttribute('style').replace(/url\([^)]*\)/gi, 'none')); blocked++; }
    if (!pics && n.hasAttribute && n.hasAttribute('background')) { n.removeAttribute('background'); blocked++; }
  });
  if (!pics) doc.querySelectorAll('style').forEach(s => { if (/url\(/i.test(s.textContent)) { s.textContent = s.textContent.replace(/url\([^)]*\)/gi, 'none'); blocked++; } });
  const head = '<meta charset="utf-8"><base target="_blank"><style>html,body{margin:0;padding:12px;background:#fff;color:#111;font:14px/1.45 -apple-system,system-ui,Segoe UI,sans-serif;word-wrap:break-word}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}</style>';
  return { html: '<!doctype html><html><head>' + head + '</head><body>' + doc.body.innerHTML + '</body></html>', blocked };
}
function mbShowBody(m) {
  const fr = $('#mrBody');
  if (m.html) {
    const r = mbSafeHtml(m.html, MBR.pics);
    fr.srcdoc = r.html;
    const p = $('#mrPics');
    if (r.blocked && !MBR.pics) { p.hidden = false; p.innerHTML = `Pictures are hidden so the sender can’t tell you opened it. <button class="linkbtn" id="mrShowPics">Show pictures</button>`; $('#mrShowPics').onclick = () => { MBR.pics = true; p.hidden = true; mbShowBody(m); }; }
    else p.hidden = true;
  } else {
    fr.srcdoc = '<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:14px;background:#fff;color:#111;font:14px/1.5 -apple-system,system-ui,sans-serif;white-space:pre-wrap;word-wrap:break-word}</style>' + esc(m.text || '(this email has no text)');
  }
  if (m.cut) toast('This email is very large — only the first part is shown');
}

/* Crown Tools - saved cards in groups (e.g. "Cap One VCCs", "Amex"). Bulk-paste thousands at once from a bank's
   virtual-card page, a spreadsheet or a CSV; assign a group across profiles; see which cards keep getting cancelled. */
'use strict';
const CARD_STATUS = [
  { k: 'active', l: 'Working', c: 'var(--ok)' },
  { k: 'unused', l: 'Unused', c: 'var(--faint)' },
  { k: 'used', l: 'Used up', c: 'var(--muted)' },
  { k: 'dead', l: 'Dead', c: 'var(--danger)' },
];
const CARDS = Object.fromEntries(CARD_STATUS.map(s => [s.k, s]));
const cardById = id => (state.cards || []).find(c => c.id === id);
const cardGroupById = id => (state.cardGroups || []).find(g => g.id === id);
const cardExp = c => c.month || c.year ? `${c.month || '??'}/${String(c.year || '').slice(-2) || '??'}` : '';
const cardExpired = c => { const m = +c.month, y = +String(c.year).length === 2 ? +('20' + c.year) : +c.year; if (!m || !y) return false; const n = new Date(); return y < n.getFullYear() || (y === n.getFullYear() && m < n.getMonth() + 1); };
let cardGroupView = 'all';
const CF = { q: '', status: 'all', reveal: new Set() };
let cardSel = new Set();

function newCardGroup(name) { return { id: uid(), name: String(name || '').trim() || 'Cards', createdAt: Date.now() }; }
function newCard(f) { return Object.assign({ id: uid(), groupId: '', number: '', month: '', year: '', cvv: '', name: '', status: 'unused', notes: '', createdAt: Date.now() }, f || {}); }
function ensureCardGroup(name) {
  name = String(name || '').trim(); if (!name) return (state.cardGroups[0] || {}).id || '';
  let g = state.cardGroups.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!g) { g = newCardGroup(name); state.cardGroups.push(g); }
  return g.id;
}

/* ---------- parsing a pile of cards ---------- */
const normExpYear = y => { y = String(y || '').replace(/\D/g, ''); return y.length === 2 ? '20' + y : y; };
const normExpMonth = m => { m = String(m || '').replace(/\D/g, ''); return m && m.length === 1 ? '0' + m : m; };
// Pull every card out of whatever was pasted: a spreadsheet with headers, or free text from a bank page.
function parseCards(text) {
  text = String(text || '').replace(/ /g, ' '); if (!text.trim()) return { cards: [], skipped: 0 };
  const out = []; let skipped = 0; const seen = new Set();
  const add = (number, month, year, cvv, name) => {
    const n = cardDigits(number); if (!luhn(n)) { if (n.length >= 12) skipped++; return; }
    if (seen.has(n)) return; seen.add(n);
    out.push({ number: n, month: normExpMonth(month), year: normExpYear(year), cvv: String(cvv || '').replace(/\D/g, '').slice(0, 4), name: String(name || '').trim() });
  };
  const first = (text.split(/\r?\n/)[0] || '').toLowerCase();
  const delimited = /[,\t;]/.test(first) && /(card|number|pan|cc)/.test(first) && out.length === 0;
  if (delimited) {
    const rows = parseDelimited(text); const head = rows.shift().map(h => ACC_CARD_MAP[norm(h)] || '');
    if (head.includes('number')) {
      for (const r of rows) { const v = {}; head.forEach((k, i) => { if (k) v[k] = String(r[i] ?? '').trim(); });
        let mo = v.month, yr = v.year; if (!mo && v.exp) { const m = v.exp.match(/(\d{1,2})\s*[\/\-]\s*(\d{2,4})/); if (m) { mo = m[1]; yr = m[2]; } }
        add(v.number, mo, yr, v.cvv, v.name); }
      return { cards: out, skipped };
    }
  }
  // free text / email page: find each card number, then the exp and CVV near it
  const re = /(?:\d[ \-]?){13,19}/g; let m; const hits = [];
  while ((m = re.exec(text))) { const n = cardDigits(m[0]); if (n.length >= 13 && n.length <= 19 && luhn(n)) hits.push({ n, start: m.index, end: m.index + m[0].length }); else if (n.length >= 13 && n.length <= 19) skipped++; }
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]; const win = text.slice(h.end, Math.min(text.length, (hits[i + 1] ? hits[i + 1].start : h.end + 120)));
    let mo = '', yr = '', cvv = '';
    // right after the number on the same stretch: "MM sep YYYY (sep CVV)" or "MM/YY"
    const inline = win.match(/^[\s:,|\-]*?(0?[1-9]|1[0-2])\s*[\/\-,|\s]\s*((?:20)?\d{2})(?:[\s:,|\-]+(\d{3,4}))?\b/);
    if (inline) { mo = inline[1]; yr = inline[2]; cvv = inline[3] || ''; }
    else { const em = win.match(/\b(0?[1-9]|1[0-2])\s*[\/\-]\s*((?:20)?\d{2})\b/); if (em) { mo = em[1]; yr = em[2]; } }
    if (!cvv) { const rest = win.replace(inline ? inline[0] : (mo ? mo + '/' + yr : ''), ''); const cv = rest.match(/(?:cvv|cvc|csc|security\s*code|cid)\D{0,6}(\d{3,4})\b/i) || rest.match(/\b(\d{3,4})\b/); if (cv) cvv = cv[1]; }
    add(h.n, mo, yr, cvv, '');
  }
  return { cards: out, skipped };
}
const ACC_CARD_COLS = { number: ['cardnumber', 'card', 'number', 'ccnumber', 'cc', 'pan', 'cardnum'], exp: ['exp', 'expiry', 'expiration', 'expdate', 'expirationdate'], month: ['expmonth', 'month', 'mm', 'ccmonth'], year: ['expyear', 'year', 'yy', 'yyyy', 'ccyear'], cvv: ['cvv', 'cvc', 'csc', 'cid', 'securitycode', 'cvv2'], name: ['name', 'cardholder', 'cardname', 'holder'] };
const ACC_CARD_MAP = {}; for (const [k, arr] of Object.entries(ACC_CARD_COLS)) arr.forEach(a => ACC_CARD_MAP[a] = k);

/* ---------- card health from order results ---------- */
function cardOrderTally(last4) {
  if (!last4) return { stuck: 0, dead: 0, pending: 0, n: 0 };
  const ix = typeof doctorIndex === 'function' ? doctorIndex() : null;
  const list = ix ? (ix.byCard.get(last4) || []) : state.orders.filter(o => o.last4 === last4);
  return tally(list);
}
function cardVerdict(c) {
  if (cardExpired(c)) return { level: 'dead', why: 'Expired' };
  if (c.status === 'dead') return { level: 'dead', why: 'Marked dead' };
  const t = cardOrderTally(cardDigits(c.number).slice(-4));
  if (t.dead >= 3 && t.stuck === 0) return { level: 'dead', why: `Cancelled ${t.dead} times, nothing shipped` };
  if (t.stuck) return { level: 'active', why: `${t.stuck} stuck` };
  if (t.dead) return { level: 'watch', why: `${t.dead} cancelled` };
  return { level: c.status === 'used' ? 'used' : 'unused', why: '' };
}

/* ---------- page ---------- */
const cardGroupCount = id => (state.cards || []).filter(c => c.groupId === id).length;
function visibleCards() {
  const q = CF.q.trim().toLowerCase();
  return (state.cards || []).filter(c => {
    if (cardGroupView !== 'all' && c.groupId !== cardGroupView) return false;
    if (CF.status !== 'all' && c.status !== CF.status) return false;
    if (!q) return true;
    return [c.number.slice(-4), c.name, c.notes, cardExp(c)].some(v => String(v || '').toLowerCase().includes(q));
  });
}
PAGES.cards = {
  render() {
    const pg = $('#pg-cards'); const all = state.cards || [];
    const list = visibleCards();
    for (const id of [...cardSel]) if (!all.some(c => c.id === id)) cardSel.delete(id);
    let h = `<div class="cat ${cardGroupView === 'all' ? 'active' : ''}" data-cg="all"><span>All cards</span><span class="n">${all.length}</span></div>`;
    h += (state.cardGroups || []).map(g => `<div class="cat ${cardGroupView === g.id ? 'active' : ''}" data-cg="${g.id}"><span class="ellipsis">${esc(g.name)}</span><span class="n">${cardGroupCount(g.id)}</span><span class="act"><button data-cgren="${g.id}">Rename</button><button data-cgdel="${g.id}">✕</button></span></div>`).join('');
    const cnt = k => (cardGroupView === 'all' ? all : all.filter(c => c.groupId === cardGroupView)).filter(c => cardVerdict(c).level === (k === 'dead' ? 'dead' : k) || (k === 'active' && cardVerdict(c).level === 'active')).length;
    const dead = (cardGroupView === 'all' ? all : all.filter(c => c.groupId === cardGroupView)).filter(c => cardVerdict(c).level === 'dead').length;
    pg.innerHTML = `<div class="pagehead"><h1>Cards</h1><span class="sub">${plural(all.length, 'card')}${state.cardGroups.length ? ' · ' + plural(state.cardGroups.length, 'group') : ''}</span><div class="spacer"></div>
        <button id="cdAdd">＋ Add cards</button><button id="cdAssign" ${all.length ? '' : 'disabled'}>Assign to profiles</button><button id="cdExp" ${all.length ? '' : 'disabled'}>Export</button></div>
      <div class="split"><div class="catlist"><div id="cgList">${h}</div><button id="cgAdd" class="ghost" style="width:100%;margin-top:6px;text-align:left">+ New group</button></div>
      <div style="min-width:0">
        ${dead ? `<div class="docbar bad" style="margin-bottom:12px"><div class="docmsg"><b>${plural(dead, 'card')} looks dead</b><span class="small">Expired, or cancelled every time with nothing shipping.</span></div><div class="docacts"><button class="sm" data-cf="dead">Show them</button></div></div>` : ''}
        <div class="toolbar"><input class="search" data-search id="cdQ" placeholder="Search last 4, name, notes…  ( / )" value="${esc(CF.q)}">
          <div class="chips" id="cdStatus">${[['all', 'All']].concat(CARD_STATUS.map(s => [s.k, s.l])).map(([k, l]) => `<button class="chip ${CF.status === k ? 'on' : ''}" data-cf="${k}">${esc(l)}</button>`).join('')}</div></div>
        ${cardSel.size ? `<div class="selbar"><strong>${cardSel.size} selected</strong><select id="cdMove" style="width:auto"><option value="">Move to group…</option>${state.cardGroups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select><select id="cdSetStatus" style="width:auto"><option value="">Set status…</option>${CARD_STATUS.map(s => `<option value="${s.k}">${s.l}</option>`).join('')}</select><button class="sm danger" id="cdDel">Delete</button><div class="spacer"></div><button class="sm ghost" id="cdClr">Clear</button></div>` : ''}
        ${list.length ? `<div class="tablewrap"><table class="atable ctable"><thead><tr><th class="cb"><input type="checkbox" id="cdAll" ${list.every(c => cardSel.has(c.id)) ? 'checked' : ''}></th><th>Card</th><th>Exp</th><th>CVV</th><th>Group</th><th>Health</th><th class="right">Orders</th></tr></thead><tbody>
          ${list.map(c => { const v = cardVerdict(c), shown = CF.reveal.has(c.id), t = cardOrderTally(cardDigits(c.number).slice(-4)), g = cardGroupById(c.groupId); return `<tr data-card="${c.id}" class="${cardSel.has(c.id) ? 'sel' : ''}"><td class="cb"><input type="checkbox" data-ccb="${c.id}" ${cardSel.has(c.id) ? 'checked' : ''}></td>
            <td class="c-num"><div class="cellflex"><span class="faint small">${esc(cardBrand(c.number))}</span> <span class="mono">${shown ? esc(c.number.replace(/(.{4})/g, '$1 ').trim()) : '•••• ' + esc(c.number.slice(-4))}</span><button class="ghost sm icopy" data-creveal="${c.id}">${shown ? 'Hide' : 'Show'}</button><button class="ghost sm icopy" data-ccopy="${c.id}" title="Copy number">⧉</button></div></td>
            <td class="c-exp ${cardExpired(c) ? 'bad' : ''}">${esc(cardExp(c)) || '<span class="faint">—</span>'}</td><td class="mono">${shown ? esc(c.cvv) : (c.cvv ? '•••' : '')}</td>
            <td>${g ? esc(g.name) : '<span class="faint">—</span>'}</td><td><span class="hpill"><i style="background:${LEVEL[v.level] ? LEVEL[v.level].c : CARDS[v.level] ? CARDS[v.level].c : 'var(--faint)'}"></i>${esc(v.level === 'watch' ? 'Watch' : (CARDS[v.level] || {}).l || LEVEL[v.level].l)}</span>${v.why ? `<div class="small faint">${esc(v.why)}</div>` : ''}</td>
            <td class="right">${t.n ? `${t.n}<span class="small faint"> · ${t.stuck}✓ ${t.dead}✕</span>` : '<span class="faint">—</span>'}</td></tr>`; }).join('')}</tbody></table></div>`
          : `<div class="empty">${all.length ? 'No cards match.' : 'No cards yet. Make a group like “Cap One VCCs”, then <b>Add cards</b> and paste them straight from your bank’s virtual-card page or a spreadsheet.'}</div>`}
      </div></div>`;
    $('#cdAdd').onclick = () => openCardAdd(cardGroupView !== 'all' ? cardGroupView : (state.cardGroups[0] || {}).id);
    $('#cgAdd').onclick = async () => { const n = await askText('New card group', '', { placeholder: 'Cap One VCCs, Amex…', ok: 'Add group' }); if (n && n.trim()) { snapshot('add card group'); const id = ensureCardGroup(n); cardGroupView = id; save(); refresh(); } };
    if ($('#cdAssign')) $('#cdAssign').onclick = () => openCardAssign(cardGroupView !== 'all' ? cardGroupView : '');
    if ($('#cdExp')) $('#cdExp').onclick = openCardExport;
    $('#cgList').onclick = async e => {
      const ren = e.target.dataset.cgren, del = e.target.dataset.cgdel;
      if (ren) { const g = cardGroupById(ren); const n = await askText('Rename group', g.name); if (n && n.trim()) { g.name = n.trim(); save(); refresh(); } return; }
      if (del) { const n = cardGroupCount(del); if (!await ask(`Delete group “${cardGroupById(del).name}”${n ? ` and its ${plural(n, 'card')}` : ''}?`)) return; snapshot('delete card group'); state.cards = state.cards.filter(c => c.groupId !== del); state.cardGroups = state.cardGroups.filter(g => g.id !== del); if (cardGroupView === del) cardGroupView = 'all'; save(); refresh(); toast('Group deleted', { undo: true }); return; }
      const row = e.target.closest('[data-cg]'); if (row) { cardGroupView = row.dataset.cg; cardSel.clear(); PAGES.cards.render(); }
    };
    $('#cdQ').oninput = debounce(e => { CF.q = e.target.value; PAGES.cards.render(); const i = $('#cdQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 160);
    pg.querySelectorAll('[data-cf]').forEach(b => b.onclick = () => { CF.status = b.dataset.cf; PAGES.cards.render(); });
    if ($('#cdAll')) $('#cdAll').onchange = e => { list.forEach(c => e.target.checked ? cardSel.add(c.id) : cardSel.delete(c.id)); PAGES.cards.render(); };
    if ($('#cdClr')) $('#cdClr').onclick = () => { cardSel.clear(); PAGES.cards.render(); };
    if ($('#cdMove')) $('#cdMove').onchange = e => { if (!e.target.value) return; snapshot('move cards'); state.cards.forEach(c => { if (cardSel.has(c.id)) c.groupId = e.target.value; }); save(); toast(`Moved ${plural(cardSel.size, 'card')}`, { undo: true }); PAGES.cards.render(); };
    if ($('#cdSetStatus')) $('#cdSetStatus').onchange = e => { if (!e.target.value) return; snapshot('card status'); state.cards.forEach(c => { if (cardSel.has(c.id)) c.status = e.target.value; }); save(); PAGES.cards.render(); };
    if ($('#cdDel')) $('#cdDel').onclick = async () => { const n = cardSel.size; if (!await ask(`Delete ${plural(n, 'card')}?`)) return; snapshot('delete cards'); state.cards = state.cards.filter(c => !cardSel.has(c.id)); cardSel.clear(); save(); refresh(); toast(`Deleted ${plural(n, 'card')}`, { undo: true }); };
    pg.querySelector('tbody') && pg.querySelector('tbody').addEventListener('click', e => {
      const cb = e.target.dataset.ccb; if (cb) { e.target.checked ? cardSel.add(cb) : cardSel.delete(cb); PAGES.cards.render(); return; }
      const rv = e.target.closest('[data-creveal]'); if (rv) { const id = rv.dataset.creveal; CF.reveal.has(id) ? CF.reveal.delete(id) : CF.reveal.add(id); PAGES.cards.render(); return; }
      const cp = e.target.closest('[data-ccopy]'); if (cp) { const c = cardById(cp.dataset.ccopy); if (c) copyText(c.number, 'Card number'); return; }
      const tr = e.target.closest('tr[data-card]'); if (!tr) return;
      if (cardSel.size && isCompact()) { const id = tr.dataset.card; cardSel.has(id) ? cardSel.delete(id) : cardSel.add(id); PAGES.cards.render(); return; }
      openCard(tr.dataset.card);
    });
  },
};

/* ---------- one card ---------- */
let curCard = null, cardIsNew = false;
function openCard(id) {
  const c = cardById(id); cardIsNew = !c; curCard = Object.assign({}, c || newCard({ groupId: cardGroupView !== 'all' ? cardGroupView : (state.cardGroups[0] || {}).id }));
  const used = state.profiles.filter(p => cardDigits(p.cardNumber) === cardDigits(curCard.number)).length;
  $('#cardTitle').textContent = cardIsNew ? 'New card' : (cardBrand(curCard.number) + ' ' + curCard.number.slice(-4));
  $('#cardBody').innerHTML = `<div class="fgrid">
      <div class="s4"><label>Card number</label><input id="cNum" inputmode="numeric" autocomplete="off" value="${esc(curCard.number)}"></div>
      <div><label>Exp month</label><input id="cMo" inputmode="numeric" maxlength="2" value="${esc(curCard.month)}"></div>
      <div><label>Exp year</label><input id="cYr" inputmode="numeric" maxlength="4" value="${esc(curCard.year)}"></div>
      <div><label>CVV</label><input id="cCvv" inputmode="numeric" maxlength="4" value="${esc(curCard.cvv)}"></div>
      <div><label>Status</label><select id="cStatus">${CARD_STATUS.map(s => `<option value="${s.k}" ${curCard.status === s.k ? 'selected' : ''}>${s.l}</option>`).join('')}</select></div>
      <div class="s2"><label>Group</label><select id="cGroup">${state.cardGroups.map(g => `<option value="${g.id}" ${curCard.groupId === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('') || '<option value="">(no groups)</option>'}</select></div>
      <div class="s2"><label>Name on card (optional)</label><input id="cName" value="${esc(curCard.name)}" autocomplete="off"></div>
      <div class="s4"><label>Notes</label><input id="cNotes" value="${esc(curCard.notes)}"></div></div>
    ${used ? `<div class="small muted" style="margin-top:10px">On ${plural(used, 'profile')}. ${(() => { const t = cardOrderTally(cardDigits(curCard.number).slice(-4)); return t.n ? `${t.stuck} stuck · ${t.dead} cancelled across its orders.` : ''; })()}</div>` : ''}`;
  $('#cardDelete').hidden = cardIsNew; openDlg('dlgCard');
}
function wireCardDlg() {
  $('#cardSave').onclick = () => {
    const n = cardDigits($('#cNum').value); if (!luhn(n)) { toast('That card number doesn’t look right'); return; }
    if (state.cards.some(c => c.id !== curCard.id && cardDigits(c.number) === n)) { toast('That card is already saved'); return; }
    Object.assign(curCard, { number: n, month: normExpMonth($('#cMo').value), year: normExpYear($('#cYr').value), cvv: $('#cCvv').value.replace(/\D/g, ''), status: $('#cStatus').value, groupId: $('#cGroup').value, name: $('#cName').value.trim(), notes: $('#cNotes').value.trim(), updatedAt: Date.now() });
    snapshot(cardIsNew ? 'add card' : 'edit card'); state.cards = state.cards.filter(c => c.id !== curCard.id).concat([curCard]); save(); closeDlg('dlgCard'); refresh(); toast(cardIsNew ? 'Card saved' : 'Saved', { undo: true });
  };
  $('#cardDelete').onclick = async () => { if (!await ask('Delete this card?')) return; snapshot('delete card'); state.cards = state.cards.filter(c => c.id !== curCard.id); save(); closeDlg('dlgCard'); refresh(); toast('Card deleted', { undo: true }); };
}

/* ---------- bulk add ---------- */
let cardAdd = { cards: [], skipped: 0 };
function openCardAdd(groupId) {
  if (!state.cardGroups.length) { ensureCardGroup('My cards'); save(); }
  $('#caGroup').innerHTML = state.cardGroups.map(g => `<option value="${g.id}" ${g.id === groupId ? 'selected' : ''}>${esc(g.name)}</option>`).join('') + '<option value="__new">+ New group…</option>';
  $('#caText').value = ''; cardAdd = { cards: [], skipped: 0 }; cardAddPreview(); openDlg('dlgCardAdd');
}
function cardAddPreview() {
  cardAdd = parseCards($('#caText').value);
  const existing = new Set((state.cards || []).map(c => cardDigits(c.number)));
  const dupes = cardAdd.cards.filter(c => existing.has(c.number)).length; const fresh = cardAdd.cards.length - dupes;
  $('#caPreview').innerHTML = cardAdd.cards.length || cardAdd.skipped ? `Found <b>${plural(cardAdd.cards.length, 'card')}</b>${dupes ? ` · ${dupes} already saved` : ''}${cardAdd.skipped ? ` · ${cardAdd.skipped} skipped (bad number)` : ''}.<div class="list" style="margin-top:8px;max-height:220px;overflow:auto">${cardAdd.cards.slice(0, 60).map(c => `<div class="li small"><span class="faint">${esc(cardBrand(c.number))}</span><span class="mono" style="flex:1">•••• ${esc(c.number.slice(-4))}</span><span class="faint">${esc(cardExp(c) || 'no exp')}${c.cvv ? ' · cvv' : ''}</span>${existing.has(c.number) ? '<span class="faint small">dup</span>' : ''}</div>`).join('')}${cardAdd.cards.length > 60 ? `<div class="small muted" style="padding:6px 0">…and ${cardAdd.cards.length - 60} more</div>` : ''}</div>` : '<span class="faint">Paste cards here. Works with a spreadsheet (number, exp, CVV columns) or whatever you copy off a bank’s virtual-card page.</span>';
  $('#caGo').disabled = !fresh; $('#caGo').textContent = fresh ? `Add ${plural(fresh, 'card')}` : 'Add cards';
}
function wireCardAdd() {
  $('#caText').oninput = debounce(cardAddPreview, 200);
  $('#caFile').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; $('#caText').value = await f.text(); cardAddPreview(); };
  $('#caGroup').onchange = async e => { if (e.target.value === '__new') { const n = await askText('New card group', '', { ok: 'Add group' }); const id = n && n.trim() ? ensureCardGroup(n) : (state.cardGroups[0] || {}).id; save(); openCardAdd(id); } };
  $('#caGo').onclick = () => {
    let gid = $('#caGroup').value; if (gid === '__new') gid = (state.cardGroups[0] || {}).id;
    const existing = new Set((state.cards || []).map(c => cardDigits(c.number)));
    const fresh = cardAdd.cards.filter(c => !existing.has(c.number)); if (!fresh.length) return;
    snapshot('add cards'); fresh.forEach(c => state.cards.push(newCard(Object.assign({ groupId: gid, status: 'unused' }, c))));
    cardGroupView = gid; save(); closeDlg('dlgCardAdd'); refresh(); toast(`Added ${plural(fresh.length, 'card')}`, { undo: true });
  };
}

/* ---------- assign a group to profiles ---------- */
let cardAssign = { group: '', scope: 'all', per: 1 };
function cardsForAssign() { return (state.cards || []).filter(c => c.groupId === cardAssign.group && !cardExpired(c) && c.status !== 'dead').sort((a, b) => (a.status === 'unused' ? 0 : 1) - (b.status === 'unused' ? 0 : 1)); }
function assignTargets() {
  const list = state.profiles;
  if (cardAssign.scope === 'selected' && typeof selected !== 'undefined' && selected.size) return list.filter(p => selected.has(p.id));
  if (cardAssign.scope === 'nocard') return list.filter(p => !cardDigits(p.cardNumber));
  if (/^cat:/.test(cardAssign.scope)) return list.filter(p => p.categoryId === cardAssign.scope.slice(4));
  return list;
}
function openCardAssign(groupId) {
  cardAssign = { group: groupId || (state.cardGroups[0] || {}).id || '', scope: (typeof selected !== 'undefined' && selected.size) ? 'selected' : 'all', per: 1 };
  renderCardAssign(); openDlg('dlgCardAssign');
}
function renderCardAssign() {
  const cards = cardsForAssign(), targets = assignTargets(); const need = Math.ceil(targets.length / Math.max(1, cardAssign.per));
  const scopes = [['all', `All profiles (${state.profiles.length})`]];
  if (typeof selected !== 'undefined' && selected.size) scopes.unshift(['selected', `Selected profiles (${selected.size})`]);
  scopes.push(['nocard', `Profiles with no card (${state.profiles.filter(p => !cardDigits(p.cardNumber)).length})`]);
  state.categories.forEach(c => scopes.push(['cat:' + c.id, `Group: ${c.name} (${state.profiles.filter(p => p.categoryId === c.id).length})`]));
  $('#caaBody').innerHTML = `<div class="fgrid"><div class="s2"><label>Card group</label><select id="caaGroup">${state.cardGroups.map(g => `<option value="${g.id}" ${cardAssign.group === g.id ? 'selected' : ''}>${esc(g.name)} (${(state.cards || []).filter(c => c.groupId === g.id).length})</option>`).join('')}</select></div>
      <div class="s2"><label>Put onto</label><select id="caaScope">${scopes.map(([v, l]) => `<option value="${v}" ${cardAssign.scope === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div><label>Profiles per card</label><input id="caaPer" inputmode="numeric" value="${esc(cardAssign.per)}"></div></div>
    <div class="note ${cards.length >= need ? '' : 'warn'} small" style="margin-top:12px">${targets.length} profiles · ${plural(cards.length, 'usable card')} in the group · ${cardAssign.per} per card.${cards.length < need ? ` Not enough cards — need ${need}. Add cards or raise profiles per card.` : ' Cards are spread evenly; each profile’s old card is replaced.'}</div>`;
  $('#caaGo').disabled = !cards.length || !targets.length || cards.length < need;
  $('#caaGo').textContent = targets.length ? `Put cards on ${plural(targets.length, 'profile')}` : 'Assign';
  $('#caaGroup').onchange = e => { cardAssign.group = e.target.value; renderCardAssign(); };
  $('#caaScope').onchange = e => { cardAssign.scope = e.target.value; renderCardAssign(); };
  $('#caaPer').oninput = e => { cardAssign.per = Math.max(1, Math.round(+e.target.value || 1)); const c = cardsForAssign(), t = assignTargets(), nd = Math.ceil(t.length / Math.max(1, cardAssign.per)); $('#caaGo').disabled = !c.length || !t.length || c.length < nd; };
}
function wireCardAssign() {
  $('#caaGo').onclick = async () => {
    const cards = cardsForAssign(), targets = assignTargets(), per = Math.max(1, cardAssign.per);
    if (!cards.length || !targets.length) return;
    if (!await ask(`Put ${cardGroupById(cardAssign.group).name} cards onto ${plural(targets.length, 'profile')}?\n\nEach profile’s current card is replaced. You can undo this.`, { ok: 'Put cards on' })) return;
    snapshot('assign cards');
    targets.forEach((p, i) => { const c = cards[Math.floor(i / per) % cards.length]; Object.assign(p, { cardNumber: c.number, cardExpMonth: c.month, cardExpYear: c.year, cardCvv: c.cvv, cardName: c.name || p.cardName || `${p.shipFirst} ${p.shipLast}`.trim() }); p.updatedAt = Date.now(); });
    autoLinkAll(); save(); closeDlg('dlgCardAssign'); refresh(); toast(`Put cards on ${plural(targets.length, 'profile')}`, { undo: true });
  };
}
function openCardExport() {
  const list = cardSel.size ? state.cards.filter(c => cardSel.has(c.id)) : visibleCards();
  download(`crown-tools-cards-${stamp()}.csv`, toCSV(['number', 'month', 'year', 'cvv', 'name', 'group', 'status'], list.map(c => ({ number: c.number, month: c.month, year: c.year, cvv: c.cvv, name: c.name, group: (cardGroupById(c.groupId) || {}).name || '', status: (CARDS[c.status] || {}).l || c.status }))), 'text/csv');
  toast(`Exported ${plural(list.length, 'card')}`);
}

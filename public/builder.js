/* Crown Tools - profile builder: make many profiles for one house at once, each with its own details
   (address jig, unique line 2, names, emails, phones) and your cards spread across them. Nothing is created until you say so. */
'use strict';
const FIRST_NAMES = 'James Michael Robert John David William Richard Joseph Thomas Christopher Charles Daniel Matthew Anthony Mark Steven Paul Andrew Joshua Kevin Brian George Timothy Ryan Jacob Nicholas Eric Jonathan Justin Brandon Tyler Aaron Adam Nathan Zachary Kyle Ethan Logan Caleb Mason Mary Patricia Jennifer Linda Elizabeth Barbara Susan Jessica Sarah Karen Lisa Nancy Betty Sandra Ashley Emily Kimberly Michelle Amanda Melissa Stephanie Rebecca Laura Amy Rachel Hannah Samantha Lauren Megan Olivia Emma Madison Abigail Chloe Grace Natalie Brooke Kayla Taylor'.split(' ');
const LAST_NAMES = 'Smith Johnson Williams Brown Jones Garcia Miller Davis Rodriguez Martinez Hernandez Lopez Wilson Anderson Thomas Taylor Moore Jackson Martin Lee Thompson White Harris Clark Lewis Robinson Walker Young Allen King Wright Scott Torres Hill Green Adams Baker Nelson Carter Mitchell Roberts Turner Phillips Campbell Parker Evans Edwards Collins Stewart Morris Murphy Cook Rogers Morgan Peterson Cooper Reed Bailey Bell Howard Ward Cox Richardson Wood Watson Brooks Bennett Gray Hughes Price Sanders Myers Long Ross Foster Jensen Larsen Christensen Hansen'.split(' ');
const pickOne = a => a[rint(0, a.length - 1)];
const LETTERS3 = () => Array.from({ length: 3 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[rint(0, 23)]).join('');
const PB = { cat: '', count: 10, prefix: '', house: '', addr1: '', city: '', st: '', zip: '', jig1: 'none', l2: 'smart', names: 'random', first: '', last: '', email: 'catchall', domain: '', gmail: '', accStore: 'target', phone: 'random', area: '', phoneFixed: '', cardGroup: '', cards: new Set(), perCard: 5, pasted: '', oneCheckout: false };
let pbRows = [];

function knownCards() {
  const m = new Map();
  for (const p of state.profiles) { const n = cardDigits(p.cardNumber); if (n && luhn(n) && !m.has(n)) m.set(n, { number: n, month: p.cardExpMonth, year: p.cardExpYear, cvv: p.cardCvv, name: p.cardName || '', uses: 0 }); if (m.has(n)) m.get(n).uses++; }
  return [...m.values()];
}
function pastedCards() {
  const out = [];
  for (const l of String(PB.pasted || '').split(/\r?\n/)) {
    const parts = l.split(/[|,;:\t ]+/).map(x => x.trim()).filter(Boolean); if (!parts.length) continue;
    const n = cardDigits(parts[0]); if (!luhn(n)) continue;
    let mm = parts[1] || '', yy = parts[2] || '', cvv = parts[3] || '';
    const both = mm.match(/^(\d{1,2})\/(\d{2,4})$/); if (both) { cvv = yy; mm = both[1]; yy = both[2]; }
    if (/^\d$/.test(mm)) mm = '0' + mm; if (/^\d{2}$/.test(yy)) yy = '20' + yy;
    out.push({ number: n, month: mm, year: yy, cvv, name: parts.slice(4).join(' ') });
  }
  return out;
}
function savedChoices() { const out = []; for (const c of state.categories) for (const a of c.addresses || []) out.push({ v: 's:' + c.id + '|' + a.id, label: (a.label ? a.label + ' — ' : '') + addrText(a), cat: c }); return out; }
function houseChoices() { return state.houses.filter(h => h.addr1 && h.zip).map(h => ({ id: h.id, label: houseLabel(h), h })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })); }
function pbAddress() {
  if (PB.house && PB.house.startsWith('s:')) { const a = findSavedAddress(PB.house.slice(2)); if (a) return { addr1: a.addr1, city: a.city, st: a.state, zip: a.zip }; }
  else if (PB.house) { const h = houseById(PB.house); if (h) { const c = cleanAddr({ addr1: h.addr1, city: h.city, state: h.state, zip: h.zip }); return { addr1: c.addr1, city: c.city, st: c.state, zip: c.zip }; } }
  return { addr1: PB.addr1.trim(), city: PB.city.trim(), st: fixState(PB.st), zip: PB.zip.trim() };
}
function gmailVariant(base, used) {
  const m = String(base || '').toLowerCase().match(/^([^@+]+)(?:\+[^@]*)?@(gmail\.com|googlemail\.com)$/); if (!m) return '';
  const user = m[1].replace(/\./g, '');
  for (let i = 0; i < 200; i++) {
    let u = ''; for (let j = 0; j < user.length; j++) { u += user[j]; if (j < user.length - 1 && Math.random() < 0.3) u += '.'; }
    const e = (i > 40 ? u + '+' + rint(10, 9999) : u) + '@gmail.com'; if (!used.has(e)) { used.add(e); return e; }
  }
  return '';
}
function freeAccounts() {
  const usedEmails = new Set(state.profiles.map(p => String(p.email || '').toLowerCase().trim()));
  return (state.accounts || []).filter(a => a.store === PB.accStore && !a.profileId && ['new', 'active'].includes(a.status) && a.email.includes('@') && !usedEmails.has(a.email.toLowerCase().trim()));
}
// Build the planned profiles (not saved yet)
function pbPlan() {
  const ad = pbAddress(); const n = clamp(Math.round(+PB.count || 0), 0, 500);
  if (!ad.addr1 || !ad.zip || !n) return { rows: [], err: !n ? 'How many profiles?' : 'Pick a house or type the address (street and ZIP at least).' };
  let cards;
  if (PB.cardGroup) cards = (state.cards || []).filter(c => c.groupId === PB.cardGroup && !cardExpired(c) && c.status !== 'dead').map(c => ({ number: c.number, month: c.month, year: c.year, cvv: c.cvv, name: c.name }));
  else cards = [...knownCards().filter(c => PB.cards.has(c.number)), ...pastedCards()];
  const per = Math.max(1, +PB.perCard || 1);
  if (cards.length && cards.length * per < n) return { rows: [], err: `${plural(cards.length, 'card')} × ${per} per card only covers ${cards.length * per} profiles — add cards or allow more per card.` };
  const hk = Parser.houseKey(ad.addr1, ad.zip); const hu = houseUnits(hk); const taken = new Set();
  const usedEmails = new Set(state.profiles.map(p => String(p.email || '').toLowerCase().trim())); const accs = PB.email === 'accounts' ? freeAccounts() : [];
  if (PB.email === 'accounts' && accs.length < n) return { rows: [], err: `Only ${plural(accs.length, 'unused ' + Parser.storeInfo(PB.accStore).label + ' account')} saved in Accounts — make fewer profiles or add accounts.` };
  if (PB.email === 'catchall' && !/^[a-z0-9.\-]+\.[a-z]{2,}$/i.test(PB.domain.trim().replace(/^@/, ''))) return { rows: [], err: 'Type your catch-all domain (like mydomain.com).' };
  if (PB.email === 'gmail' && !gmailVariant(PB.gmail, new Set())) return { rows: [], err: 'Type the Gmail address to make variations of.' };
  if (PB.names === 'same' && (!PB.first.trim() || !PB.last.trim())) return { rows: [], err: 'Type the first and last name.' };
  const prefix = (PB.prefix || catName(PB.cat) || 'Profile').trim();
  const nums = state.profiles.map(p => (String(p.name || '').match(new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+(\\d+)$', 'i')) || [])[1]).filter(Boolean).map(Number);
  let next = (nums.length ? Math.max(...nums) : 0) + 1;
  const area = (String(PB.area || '').replace(/\D/g, '') || (state.profiles.map(p => String(p.phone || '').replace(/\D/g, '').slice(-10, -7)).find(Boolean)) || '801').slice(0, 3);
  const rows = [];
  for (let i = 0; i < n; i++) {
    let first = PB.first.trim(), last = PB.last.trim();
    if (PB.names === 'random') { first = pickOne(FIRST_NAMES); last = pickOne(LAST_NAMES); }
    else if (PB.names === 'first') { first = pickOne(FIRST_NAMES); last = last || pickOne(LAST_NAMES); }
    let a1 = ad.addr1;
    if (PB.jig1 === 'before') a1 = LETTERS3() + ' ' + ad.addr1; else if (PB.jig1 === 'after') a1 = ad.addr1 + ' ' + LETTERS3();
    let a2 = '';
    if (PB.l2 === 'smart') a2 = makeUnit(pickStyle({ shipAddr2: '' }, hu.good, 'auto'), hu.used, taken) || '';
    let email = '', acc = null;
    if (PB.email === 'catchall') { const d = PB.domain.trim().replace(/^@/, ''); for (let t = 0; t < 50 && (!email || usedEmails.has(email)); t++) email = [`${first}.${last}${rint(10, 999)}`, `${first}${last[0] || ''}${rint(100, 9999)}`, `${first[0] || ''}${last}${rint(10, 999)}`][rint(0, 2)].toLowerCase().replace(/[^a-z0-9.]/g, '') + '@' + d; usedEmails.add(email); }
    else if (PB.email === 'gmail') email = gmailVariant(PB.gmail, usedEmails);
    else if (PB.email === 'accounts') { acc = accs[i]; email = acc.email; }
    const phone = PB.phone === 'same' ? String(PB.phoneFixed || '').replace(/\D/g, '') : area + String(rint(2, 9)) + String(rint(0, 99)).padStart(2, '0') + String(rint(0, 9999)).padStart(4, '0');
    const card = cards.length ? cards[Math.floor(i / per)] : null;
    rows.push({ name: `${prefix} ${next++}`, first, last, a1, a2, city: ad.city, st: ad.st, zip: ad.zip, email, acc, phone, card });
  }
  return { rows, err: '' };
}
function renderBuilder() {
  const hs = houseChoices(), kc = knownCards(), plan = pbPlan(); pbRows = plan.rows;
  const seg = (k, opts) => `<div class="chips">${opts.map(([v, l]) => `<button type="button" class="chip ${PB[k] === v ? 'on' : ''}" data-pb="${k}" data-v="${v}">${esc(l)}</button>`).join('')}</div>`;
  const pc = pastedCards().length, fa = PB.email === 'accounts' ? freeAccounts().length : 0;
  $('#pbBody').innerHTML = `<div class="fgrid">
      <div class="s2"><label>Put them in</label><select data-pbi="cat">${catOptions(PB.cat)}</select></div>
      <div><label>How many</label><input data-pbi="count" inputmode="numeric" value="${esc(PB.count)}"></div>
      <div><label>Name them</label><input data-pbi="prefix" value="${esc(PB.prefix)}" placeholder="${esc(catName(PB.cat))} 1, 2, 3…"></div></div>
    <div class="section">Address</div>
    <div class="fgrid"><div class="s4"><select data-pbi="house"><option value="">Type an address…</option>${(() => { const sv = savedChoices(); const mine = sv.filter(x => x.cat.id === PB.cat), other = sv.filter(x => x.cat.id !== PB.cat); return (mine.length ? `<optgroup label="Saved in ${esc(catName(PB.cat))}">${mine.map(x => `<option value="${esc(x.v)}" ${PB.house === x.v ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</optgroup>` : '') + (other.length ? `<optgroup label="Saved in other groups">${other.map(x => `<option value="${esc(x.v)}" ${PB.house === x.v ? 'selected' : ''}>${esc(x.label)} (${esc(x.cat.name)})</option>`).join('')}</optgroup>` : ''); })()}<optgroup label="Houses from your orders">${hs.map(x => `<option value="${x.id}" ${PB.house === x.id ? 'selected' : ''}>${esc(x.label)} — ${esc([x.h.city, x.h.state, x.h.zip].filter(Boolean).join(' '))}</option>`).join('')}</optgroup></select></div>
      ${PB.house ? '' : `<div class="s2"><label>Street</label><input data-pbi="addr1" value="${esc(PB.addr1)}" placeholder="11662 S 2670 W"></div><div><label>City</label><input data-pbi="city" value="${esc(PB.city)}"></div><div><label>State · ZIP</label><div class="hstack" style="gap:6px"><input data-pbi="st" value="${esc(PB.st)}" style="width:64px" maxlength="20"><input data-pbi="zip" value="${esc(PB.zip)}" inputmode="numeric" style="flex:1;min-width:0"></div></div>`}</div>
    <div class="hstack pbopts"><span class="small muted">Line 1</span>${seg('jig1', [['none', 'As is'], ['before', 'XYZ before'], ['after', 'XYZ after']])}</div>
    <div class="hstack pbopts"><span class="small muted">Line 2</span>${seg('l2', [['smart', 'Unique for each (smart)'], ['none', 'Leave empty']])}</div>
    <div class="section">Names</div>${seg('names', [['random', 'Random names'], ['first', 'Random first names'], ['same', 'One name for all']])}
    ${PB.names !== 'random' ? `<div class="fgrid" style="margin-top:8px">${PB.names === 'same' ? `<div class="s2"><label>First name</label><input data-pbi="first" value="${esc(PB.first)}"></div>` : ''}<div class="s2"><label>Last name${PB.names === 'first' ? ' (empty = random)' : ''}</label><input data-pbi="last" value="${esc(PB.last)}"></div></div>` : ''}
    <div class="section">Emails</div>${seg('email', [['catchall', 'Catch-all domain'], ['gmail', 'Gmail dot trick'], ['accounts', 'My saved accounts'], ['none', 'Leave empty']])}
    <div style="margin-top:8px">${PB.email === 'catchall' ? `<input data-pbi="domain" value="${esc(PB.domain)}" placeholder="yourdomain.com">` : PB.email === 'gmail' ? `<input data-pbi="gmail" value="${esc(PB.gmail)}" placeholder="yourname@gmail.com"><div class="small faint" style="margin-top:4px">Gmail ignores dots, so every variation lands in the same inbox.</div>` : PB.email === 'accounts' ? `<div class="hstack" style="gap:8px"><select data-pbi="accStore" style="width:auto">${Parser.STORES.filter(s => s.key !== 'other').sort((a, b) => a.label.localeCompare(b.label)).map(s => `<option value="${s.key}" ${PB.accStore === s.key ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select><span class="small muted">${plural(fa, 'unused account')} — each new profile gets one and they’re linked together</span></div>` : ''}</div>
    <div class="section">Phone</div>${seg('phone', [['random', 'Random numbers'], ['same', 'One number for all']])}
    <div style="margin-top:8px">${PB.phone === 'random' ? `<input data-pbi="area" value="${esc(PB.area)}" placeholder="Area code (default: from your profiles)" inputmode="numeric" maxlength="3" style="max-width:280px">` : `<input data-pbi="phoneFixed" value="${esc(PB.phoneFixed)}" inputmode="tel" style="max-width:280px">`}</div>
    <div class="section">Cards</div>
    ${(state.cardGroups || []).length ? `<div class="hstack pbopts"><span class="small muted">Card group</span><select data-pbi="cardGroup" style="width:auto;min-width:160px"><option value="">Pick cards below</option>${state.cardGroups.map(g => `<option value="${g.id}" ${PB.cardGroup === g.id ? 'selected' : ''}>${esc(g.name)} (${(state.cards || []).filter(c => c.groupId === g.id && !cardExpired(c) && c.status !== 'dead').length})</option>`).join('')}</select><a class="small linkbtn" data-pbnav="cards">Manage cards</a></div>` : ''}
    ${PB.cardGroup ? '' : `${kc.length ? `<div class="small muted" style="margin-bottom:6px">Cards already on your profiles:</div><div class="chips">${kc.map(c => `<button type="button" class="chip ${PB.cards.has(c.number) ? 'on' : ''}" data-pbc="${c.number}">${esc(cardBrand(c.number))} ${esc(c.number.slice(-4))} <span class="n">${c.uses}</span></button>`).join('')}</div>` : ''}
    `}<div style="margin-top:8px" ${PB.cardGroup?'hidden':''}><label>…or paste cards (number | MM | YYYY | CVV, one per line)</label><textarea data-pbi="pasted" style="min-height:64px" spellcheck="false" placeholder="4111111111111111|12|2029|123">${esc(PB.pasted)}</textarea>${PB.pasted.trim() ? `<div class="small ${pc ? 'faint' : ''}" style="margin-top:3px;${pc ? '' : 'color:var(--danger)'}">${pc ? plural(pc, 'valid card') : 'No valid card numbers found'}</div>` : ''}</div>
    <div class="hstack pbopts"><span class="small muted">Profiles per card</span><input data-pbi="perCard" inputmode="numeric" value="${esc(PB.perCard)}" style="width:80px"></div>
    <label class="check small" style="margin-top:8px"><input type="checkbox" data-pbk="oneCheckout" ${PB.oneCheckout ? 'checked' : ''}> Only one checkout per profile</label>
    <div class="section">Preview</div>
    ${plan.err ? `<div class="note warn small">${esc(plan.err)}</div>` : `<div class="pbprev">${pbRows.slice(0, 8).map(r => `<div class="pbrow"><b>${esc(r.name)}</b><span>${esc(r.first)} ${esc(r.last)}</span><span>${esc(r.a1)}${r.a2 ? ', ' + esc(r.a2) : ''}</span><span class="faint">${esc(r.email || '—')}</span><span class="faint">${r.card ? '•••• ' + esc(r.card.number.slice(-4)) : 'no card'}</span></div>`).join('')}${pbRows.length > 8 ? `<div class="small muted" style="padding:6px 0">…and ${pbRows.length - 8} more</div>` : ''}</div>`}`;
  $('#pbGo').disabled = !pbRows.length; $('#pbGo').textContent = pbRows.length ? `Create ${plural(pbRows.length, 'profile')}` : 'Create';
}
function openBuilder() {
  if (!PB.cat || !state.categories.some(c => c.id === PB.cat)) PB.cat = view !== 'all' ? view : state.categories[0].id;
  renderBuilder(); openDlg('dlgBuild');
}
function wireBuilder() {
  const body = $('#pbBody'); const rer = debounce(() => { const a = document.activeElement, k = a && a.dataset && a.dataset.pbi, pos = a && a.selectionStart; renderBuilder(); if (k) { const el = $(`#pbBody [data-pbi="${k}"]`); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (_) { } } } }, 350);
  body.addEventListener('click', e => {
    const b = e.target.closest('[data-pb]'); if (b) { PB[b.dataset.pb] = b.dataset.v; renderBuilder(); return; }
    const c = e.target.closest('[data-pbc]'); if (c) { const n = c.dataset.pbc; PB.cards.has(n) ? PB.cards.delete(n) : PB.cards.add(n); renderBuilder(); return; }
    const nv = e.target.closest('[data-pbnav]'); if (nv) { closeDlg('dlgBuild'); go(nv.dataset.pbnav); }
  });
  body.addEventListener('input', e => { const k = e.target.dataset.pbi; if (!k || e.target.tagName === 'SELECT') return; PB[k] = e.target.value; rer(); });
  body.addEventListener('change', e => { const k = e.target.dataset.pbi; if (k && e.target.tagName === 'SELECT') { PB[k] = e.target.value; renderBuilder(); } const kk = e.target.dataset.pbk; if (kk) PB[kk] = e.target.checked; });
  $('#pbReroll').onclick = () => renderBuilder();
  $('#pbGo').onclick = async () => {
    const rows = pbRows.slice(); if (!rows.length) return;
    if (!await ask(`Create ${plural(rows.length, 'profile')} in ${catName(PB.cat)}?`, { ok: 'Create profiles' })) return;
    snapshot('build profiles'); const ids = [];
    for (const r of rows) {
      const p = blankProfile(PB.cat);
      Object.assign(p, { name: r.name, email: r.email, phone: r.phone, shipFirst: r.first, shipLast: r.last, shipAddr1: r.a1, shipAddr2: r.a2, shipCity: r.city, shipState: r.st, shipZip: r.zip, shipCountry: 'US', sameBilling: true, oneCheckout: !!PB.oneCheckout, updatedAt: Date.now() });
      if (r.card) Object.assign(p, { cardNumber: r.card.number, cardExpMonth: r.card.month, cardExpYear: r.card.year, cardCvv: r.card.cvv, cardName: r.card.name || `${r.first} ${r.last}` });
      if (r.acc) { const a = state.accounts.find(x => x.id === r.acc.id); if (a) { a.profileId = p.id; a.updatedAt = Date.now(); } }
      state.profiles.push(p); ids.push(p.id);
    }
    if (!PB.house) saveGroupAddress(PB.cat, { addr1: rows[0].a1.replace(/ [A-Z]{3}$/, '').replace(/^[A-Z]{3} /, ''), city: rows[0].city, state: rows[0].st, zip: rows[0].zip });
    view = PB.cat; selected = new Set(ids); autoLinkAll(); save(); closeDlg('dlgBuild'); go('profiles'); refresh();
    toast(`Created ${plural(rows.length, 'profile')} — they’re selected, so Export sends just these to your bot`, { undo: true });
  };
}

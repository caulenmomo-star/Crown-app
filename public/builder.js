/* Kingpin - profile builder: make many profiles for one house at once, each with its own details
   (address jig, unique line 2, names, emails, phones) and your cards spread across them. Nothing is created until you say so. */
'use strict';
const FIRST_NAMES = 'James Michael Robert John David William Richard Joseph Thomas Christopher Charles Daniel Matthew Anthony Mark Steven Paul Andrew Joshua Kevin Brian George Timothy Ryan Jacob Nicholas Eric Jonathan Justin Brandon Tyler Aaron Adam Nathan Zachary Kyle Ethan Logan Caleb Mason Mary Patricia Jennifer Linda Elizabeth Barbara Susan Jessica Sarah Karen Lisa Nancy Betty Sandra Ashley Emily Kimberly Michelle Amanda Melissa Stephanie Rebecca Laura Amy Rachel Hannah Samantha Lauren Megan Olivia Emma Madison Abigail Chloe Grace Natalie Brooke Kayla Taylor'.split(' ');
const LAST_NAMES = 'Smith Johnson Williams Brown Jones Garcia Miller Davis Rodriguez Martinez Hernandez Lopez Wilson Anderson Thomas Taylor Moore Jackson Martin Lee Thompson White Harris Clark Lewis Robinson Walker Young Allen King Wright Scott Torres Hill Green Adams Baker Nelson Carter Mitchell Roberts Turner Phillips Campbell Parker Evans Edwards Collins Stewart Morris Murphy Cook Rogers Morgan Peterson Cooper Reed Bailey Bell Howard Ward Cox Richardson Wood Watson Brooks Bennett Gray Hughes Price Sanders Myers Long Ross Foster Jensen Larsen Christensen Hansen'.split(' ');
const pickOne = a => a[rint(0, a.length - 1)];
const LETTERS3 = () => Array.from({ length: 3 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[rint(0, 23)]).join('');
const PB = { cat: '', count: 10, prefix: '', start: '', addrs: [], addr1: '', city: '', st: '', zip: '', jig1: 'none', l2: 'smart', l2digits: '3', l2letter: false, l2pick: ['Apt', 'Unit', 'Suite', '#'], plain: false, plainN: '1', names: 'random', first: '', last: '', email: 'catchall', domain: '', gmail: '', accGroup: 'all', accAll: false, emailsPasted: '', phone: 'random', area: '', phoneFixed: '', cardSel: new Set(), cgOpen: new Set(), cardOrder: 'alt', cards: new Set(), perCard: 5, pasted: '', oneCheckout: false };
// line 2 styles you can pick (besides Smart and Leave empty); "mix" picks one of Apt / Unit / Suite / # for each profile
const PB_L2 = [['smart', 'Smart — copy what gets through at that house'], ['Apt', 'Apt 123'], ['Unit', 'Unit 123'], ['Suite', 'Suite 123'], ['Ste', 'Ste 123'], ['#', '#123'], ['Bldg', 'Bldg 123'], ['Room', 'Room 123'], ['Lot', 'Lot 123'], ['Fl', 'Fl 123'], ['mix', 'Mix (Apt / Unit / Suite / #)'], ['custom', 'Custom mix — pick which ones'], ['num', 'Number only (123)'], ['none', 'Leave empty']];
// pasted emails: one per line (or separated by commas/spaces); "email:password" lines keep just the email
function pastedEmails() {
  const seen = new Set(), out = [];
  for (const t of String(PB.emailsPasted || '').split(/[\s,;]+/)) { const e = t.split(':')[0].trim().toLowerCase(); if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e) && !seen.has(e)) { seen.add(e); out.push(e); } }
  return out;
}
let pbRows = [];
// cards you can build with: not expired, not marked dead
const pbUsable = c => c && !cardExpired(c) && c.status !== 'dead';
const pbCardsIn = gid => (state.cards || []).filter(c => c.groupId === gid && pbUsable(c));
function pbCardUses() { const m = new Map(); for (const p of state.profiles) { const n = cardDigits(p.cardNumber); if (n) m.set(n, (m.get(n) || 0) + 1); } return m; }
// the cards this build will use: the ones ticked in your card groups (alternating between groups, or one group after
// another), then cards from your profiles and pasted ones — each card once
function pbCards() {
  const lists = (state.cardGroups || []).map(g => pbCardsIn(g.id).filter(c => PB.cardSel.has(c.id))).filter(l => l.length);
  const fromGroups = [];
  if (PB.cardOrder === 'alt') { for (let i = 0; lists.some(l => i < l.length); i++) for (const l of lists) if (i < l.length) fromGroups.push(l[i]); }
  else lists.forEach(l => fromGroups.push(...l));
  const seen = new Set(), out = [];
  for (const c of [...fromGroups.map(c => ({ number: cardDigits(c.number), month: c.month, year: c.year, cvv: c.cvv, name: c.name, group: (cardGroupById(c.groupId) || {}).name || '' })), ...knownCards().filter(c => PB.cards.has(c.number)), ...pastedCards()]) {
    if (!c.number || seen.has(c.number)) continue; seen.add(c.number); out.push(c);
  }
  return out;
}
// a line 2 nobody at this house has used: random first, then every possible one in turn so a busy house never runs out early
function pbUnit(st, used, taken) {
  const u = makeUnit(st, used, taken); if (u) return u;
  const lo = st.digits <= 1 ? 1 : Math.pow(10, st.digits - 1), hi = Math.pow(10, st.digits) - 1, letters = st.letter ? 'ABCDEF'.split('') : [''];
  const all = []; for (let v = lo; v <= hi; v++) for (const L of letters) all.push(String(v) + L);
  for (let i = all.length - 1; i > 0; i--) { const j = rint(0, i); [all[i], all[j]] = [all[j], all[i]]; }
  for (const v of all) { const txt = !st.type ? v : st.type === '#' ? '#' + v : st.type + ' ' + v, k = Parser.normUnit(txt); if (!used.has(k) && !taken.has(k)) { taken.add(k); return txt; } }
  return null;
}

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
// every address the builder can offer: saved addresses (this group first), then houses from orders
function addrOptions() {
  const out = [];
  for (const c of [state.categories.find(x => x.id === PB.cat)].concat(state.categories.filter(x => x.id !== PB.cat)).filter(Boolean))
    for (const a of c.addresses || []) out.push({ key: 's:' + c.id + '|' + a.id, addr1: a.addr1, city: a.city, st: a.state, zip: a.zip, label: a.label || a.addr1, sub: addrText(a), group: c.id === PB.cat ? '' : c.name });
  for (const h of state.houses.filter(h => h.addr1 && h.zip).sort((a, b) => houseLabel(a).localeCompare(houseLabel(b), undefined, { numeric: true }))) {
    const c = cleanAddr({ addr1: h.addr1, city: h.city, state: h.state, zip: h.zip }); if (!c.addr1 || !c.zip) continue;
    out.push({ key: 'h:' + h.id, addr1: c.addr1, city: c.city, st: c.state, zip: c.zip, label: houseLabel(h), sub: [c.city, c.st, c.zip].filter(Boolean).join(' '), group: 'house' });
  }
  // drop options whose house is already represented by a saved address
  const seen = new Set(); return out.filter(o => { const k = Parser.houseKey(o.addr1, o.zip); if (o.group === 'house' && seen.has(k)) return false; seen.add(k); return true; });
}
const pbAddrToggle = o => { const i = PB.addrs.findIndex(a => a.key === o.key); if (i >= 0) PB.addrs.splice(i, 1); else PB.addrs.push({ key: o.key, addr1: o.addr1, city: o.city, st: o.st, zip: o.zip, label: o.label }); };
function pbAddrList() {
  if (PB.addrs.length) return PB.addrs.map(a => ({ addr1: a.addr1, city: a.city, st: a.st, zip: a.zip }));
  const a = { addr1: PB.addr1.trim(), city: PB.city.trim(), st: fixState(PB.st), zip: PB.zip.trim() };
  return a.addr1 && a.zip ? [a] : [];
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
// accounts in the account group you picked (or all groups). Unused only (the default): not on a profile yet, not already
// a profile's email and not locked/banned. "All accounts": every account with an email, used or not.
function freeAccounts(group, all) {
  const g = group === undefined ? PB.accGroup : group, every = all === undefined ? PB.accAll : all;
  const usedEmails = every ? new Set() : new Set(state.profiles.map(p => String(p.email || '').toLowerCase().trim()));
  const seen = new Set();
  return (state.accounts || []).filter(a => {
    if (!(g === 'all' || (g === 'none' ? !(a.groupId && accGroupById(a.groupId)) : a.groupId === g))) return false;
    const e = String(a.email || '').toLowerCase().trim(); if (!e.includes('@') || seen.has(e)) return false;
    if (!every && (a.profileId || !['new', 'active'].includes(a.status) || usedEmails.has(e))) return false;
    seen.add(e); return true;
  });
}
const pbAccWord = () => PB.accAll ? 'account' : 'unused account';
// the line 2 styles a custom mix can use ('' = number only)
const PB_L2PICK = [['Apt', 'Apt'], ['Unit', 'Unit'], ['Suite', 'Suite'], ['Ste', 'Ste'], ['#', '#'], ['Bldg', 'Bldg'], ['Room', 'Room'], ['Lot', 'Lot'], ['Fl', 'Fl'], ['num', 'Number only']];
// the numbers the names will start at: what you typed, else 1, else after the last one already used
function pbNameStart(prefix) {
  const nums = state.profiles.map(p => (String(p.name || '').match(new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+(\\d+)$', 'i')) || [])[1]).filter(Boolean).map(Number);
  const typed = parseInt(PB.start, 10);
  return { start: typed > 0 ? typed : (nums.length ? Math.max(...nums) + 1 : 1), taken: new Set(nums) };
}
// Build the planned profiles (not saved yet)
function pbPlan() {
  // "How many" is the total; plain profiles (no jig) are part of it, the rest get jigs
  const addrs = pbAddrList(); const n = clamp(Math.round(+PB.count || 0), 0, 1000);
  const plainPer = PB.plain ? clamp(Math.round(+PB.plainN || 0), 0, 50) : 0;
  if (!n) return { rows: [], err: 'How many profiles?' };
  if (!addrs.length) return { rows: [], err: 'Pick at least one address, or type one in.' };
  const nPlain = plainPer * addrs.length;
  if (nPlain > n) return { rows: [], err: `${plural(plainPer, 'plain profile')} for each of ${plural(addrs.length, 'address')} is ${nPlain} — more than the ${n} you asked for. Make more profiles or fewer plain ones.` };
  const nJig = n - nPlain;
  const cards = pbCards();
  const per = Math.max(1, Math.round(+PB.perCard || 1));
  if (cards.length && cards.length * per < n) return { rows: [], err: `${plural(cards.length, 'card')} × ${per} per card covers ${cards.length * per} profiles, not ${n} — tick more cards or allow ${Math.ceil(n / cards.length)} per card.` };
  // each house keeps its own line-2 pool so a 2nd address doesn't collide with the 1st
  const huCache = new Map();
  const huFor = ad => { const hk = Parser.houseKey(ad.addr1, ad.zip); if (!huCache.has(hk)) huCache.set(hk, { hu: houseUnits(hk), taken: new Set() }); return huCache.get(hk); };
  const usedEmails = new Set(state.profiles.map(p => String(p.email || '').toLowerCase().trim())); const accs = PB.email === 'accounts' ? freeAccounts() : [];
  if (PB.email === 'accounts' && accs.length < n) return { rows: [], err: `Only ${plural(accs.length, pbAccWord())} in ${PB.accGroup === 'all' ? 'Accounts' : '“' + ((accGroupById(PB.accGroup) || {}).name || 'No group') + '”'} for ${plural(n, 'profile')} — make fewer profiles, pick another group${PB.accAll ? '' : ', switch to All accounts'} or add accounts.` };
  if (PB.l2 === 'custom' && !(PB.l2pick || []).length) return { rows: [], err: 'Pick at least one line 2 style for your custom mix.' };
  const pem = PB.email === 'paste' ? pastedEmails() : [];
  if (PB.email === 'paste' && pem.length < n) return { rows: [], err: pem.length ? `${plural(pem.length, 'email')} pasted for ${plural(n, 'profile')} — paste ${n - pem.length} more.` : 'Paste the emails to use, one per line.' };
  if (PB.email === 'catchall' && !/^[a-z0-9.\-]+\.[a-z]{2,}$/i.test(PB.domain.trim().replace(/^@/, ''))) return { rows: [], err: 'Type your catch-all domain (like mydomain.com).' };
  if (PB.email === 'gmail' && !gmailVariant(PB.gmail, new Set())) return { rows: [], err: 'Type the Gmail address to make variations of.' };
  if (PB.names === 'same' && (!PB.first.trim() || !PB.last.trim())) return { rows: [], err: 'Type the first and last name.' };
  const prefix = (PB.prefix || catName(PB.cat) || 'Profile').trim();
  let next = pbNameStart(prefix).start;
  const area = (String(PB.area || '').replace(/\D/g, '') || (state.profiles.map(p => String(p.phone || '').replace(/\D/g, '').slice(-10, -7)).find(Boolean)) || '801').slice(0, 3);
  const rows = [];
  // the plain profiles (no jig) come first, then the jigged ones spread over the addresses
  const plan = [];
  for (const ad of addrs) for (let k = 0; k < plainPer; k++) plan.push({ ad, plain: true });
  for (let i = 0; i < nJig; i++) plan.push({ ad: addrs[i % addrs.length], plain: false });
  const MIX = PB.l2 === 'custom' ? PB.l2pick.map(x => x === 'num' ? '' : x) : ['Apt', 'Unit', 'Suite', '#'], digits = clamp(parseInt(PB.l2digits, 10) || 3, 1, 4);
  for (let i = 0; i < n; i++) {
    const { ad, plain } = plan[i]; const { hu, taken } = huFor(ad);
    let first = PB.first.trim(), last = PB.last.trim();
    if (PB.names === 'random') { first = pickOne(FIRST_NAMES); last = pickOne(LAST_NAMES); }
    else if (PB.names === 'first') { first = pickOne(FIRST_NAMES); last = last || pickOne(LAST_NAMES); }
    let a1 = ad.addr1;
    if (!plain && PB.jig1 === 'before') a1 = LETTERS3() + ' ' + ad.addr1; else if (!plain && PB.jig1 === 'after') a1 = ad.addr1 + ' ' + LETTERS3();
    let a2 = '';
    if (!plain && PB.l2 !== 'none') {
      a2 = PB.l2 === 'smart' ? pbUnit(pickStyle({ shipAddr2: '' }, hu.good, 'auto'), hu.used, taken) : pbUnit({ type: PB.l2 === 'num' ? '' : PB.l2 === 'mix' || PB.l2 === 'custom' ? MIX[rint(0, MIX.length - 1)] : PB.l2, digits, letter: !!PB.l2letter }, hu.used, taken);
      if (!a2) return { rows: [], err: `${ad.addr1} has run out of unused line 2s with ${plural(digits, 'digit')}${PB.l2letter ? ' and a letter' : ''} — pick more digits${PB.l2letter ? '' : ' or add a letter'}, or put fewer profiles on this address.` };
    }
    let email = '', acc = null;
    if (PB.email === 'catchall') { const d = PB.domain.trim().replace(/^@/, ''); for (let t = 0; t < 50 && (!email || usedEmails.has(email)); t++) email = [`${first}.${last}${rint(10, 999)}`, `${first}${last[0] || ''}${rint(100, 9999)}`, `${first[0] || ''}${last}${rint(10, 999)}`][rint(0, 2)].toLowerCase().replace(/[^a-z0-9.]/g, '') + '@' + d; usedEmails.add(email); }
    else if (PB.email === 'gmail') email = gmailVariant(PB.gmail, usedEmails);
    else if (PB.email === 'accounts') { acc = accs[i]; email = acc.email; }
    else if (PB.email === 'paste') email = pem[i];
    const phone = PB.phone === 'same' ? String(PB.phoneFixed || '').replace(/\D/g, '') : area + String(rint(2, 9)) + String(rint(0, 99)).padStart(2, '0') + String(rint(0, 9999)).padStart(4, '0');
    const card = cards.length ? cards[Math.floor(i / per)] : null;
    rows.push({ name: `${prefix} ${next++}`, first, last, a1, a2, city: ad.city, st: ad.st, zip: ad.zip, email, acc, phone, card, plain });
  }
  return { rows, err: '' };
}
function renderBuilder() {
  const kc = knownCards(), plan = pbPlan(); pbRows = plan.rows;
  const seg = (k, opts) => `<div class="chips">${opts.map(([v, l]) => `<button type="button" class="chip ${PB[k] === v ? 'on' : ''}" data-pb="${k}" data-v="${v}">${esc(l)}</button>`).join('')}</div>`;
  const pc = pastedCards().length, fa = PB.email === 'accounts' ? freeAccounts().length : 0;
  $('#pbBody').innerHTML = `<div class="fgrid">
      <div class="s2"><label>Put them in</label><select data-pbi="cat">${catOptions(PB.cat)}</select></div>
      <div><label>How many</label><input data-pbi="count" inputmode="numeric" value="${esc(PB.count)}"></div>
      <div><label>Name them</label><input data-pbi="prefix" value="${esc(PB.prefix)}" placeholder="${esc(catName(PB.cat))} 1, 2, 3…"></div></div>
    ${(() => { const pre = (PB.prefix || catName(PB.cat) || 'Profile').trim(), ns = pbNameStart(pre), clash = parseInt(PB.start, 10) > 0 && Array.from({ length: Math.max(1, pbRows.length) }, (_, k) => ns.start + k).some(x => ns.taken.has(x));
      return `<div class="hstack pbopts" style="flex-wrap:wrap"><span class="small muted">Numbered</span><span class="small"><b>${esc(pre)} ${ns.start}</b>, <b>${esc(pre)} ${ns.start + 1}</b>, <b>${esc(pre)} ${ns.start + 2}</b>…</span><span class="small muted" style="margin-left:8px">start at</span><input data-pbi="start" inputmode="numeric" value="${esc(PB.start)}" placeholder="${ns.start}" style="width:80px">${clash ? `<span class="small" style="color:var(--warn)">Some of these names already exist</span>` : ''}</div>`; })()}
    <div class="section">Addresses ${PB.addrs.length ? `<span style="text-transform:none;letter-spacing:0;font-weight:400">— ${plural(PB.addrs.length, 'address')}, profiles split evenly</span>` : ''}</div>
    ${(() => { const opts = addrOptions(); const sel = new Set(PB.addrs.map(a => a.key)); return opts.length ? `<div class="small muted" style="margin-bottom:6px">Tap the addresses to build on — pick as many as you want.</div><div class="addrchips">${opts.slice(0, 60).map(o => `<button type="button" class="addrchip ${sel.has(o.key) ? 'on' : ''}" data-addtoggle="${esc(o.key)}"><span class="ac-l">${esc(o.label)}</span><span class="ac-s">${esc(o.sub)}${o.group && o.group !== 'house' ? ' · ' + esc(o.group) : ''}</span></button>`).join('')}</div>` : ''; })()}
    ${PB.addrs.filter(a => a.key.startsWith('m:')).length ? `<div class="list" style="margin-top:8px">${PB.addrs.filter(a => a.key.startsWith('m:')).map(a => `<div class="li small"><span style="flex:1">${esc(addrText({ addr1: a.addr1, city: a.city, state: a.st, zip: a.zip }))}</span><button class="ghost sm" data-addrm="${esc(a.key)}">✕</button></div>`).join('')}</div>` : ''}
    <details class="addmanual" ${addrOptions().length ? '' : 'open'}><summary class="small">＋ Type an address</summary>
      <div class="fgrid" style="margin-top:8px"><div class="s2"><label>Street</label><input data-pbi="addr1" value="${esc(PB.addr1)}" placeholder="11662 S 2670 W"></div><div><label>City</label><input data-pbi="city" value="${esc(PB.city)}"></div><div><label>State · ZIP</label><div class="hstack" style="gap:6px"><input data-pbi="st" value="${esc(PB.st)}" style="width:64px" maxlength="20"><input data-pbi="zip" value="${esc(PB.zip)}" inputmode="numeric" style="flex:1;min-width:0"></div></div></div>
      <button class="sm" id="pbAddAddr" style="margin-top:8px">Add this address${PB.addrs.length ? ' to the list' : ''}</button></details>
    <div class="hstack pbopts"><span class="small muted">Line 1</span>${seg('jig1', [['none', 'As is'], ['before', 'XYZ before'], ['after', 'XYZ after']])}</div>
    <div class="hstack pbopts" style="flex-wrap:wrap"><span class="small muted">Line 2</span><select data-pbi="l2" style="width:auto;min-width:220px">${PB_L2.map(([v, l]) => `<option value="${esc(v)}" ${PB.l2 === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      ${PB.l2 !== 'smart' && PB.l2 !== 'none' ? `<select data-pbi="l2digits" style="width:auto" aria-label="Digits">${['1', '2', '3', '4'].map(d => `<option value="${d}" ${PB.l2digits === d ? 'selected' : ''}>${d} digit${d === '1' ? '' : 's'}</option>`).join('')}</select><label class="check small" style="width:auto"><input type="checkbox" data-pbk="l2letter" ${PB.l2letter ? 'checked' : ''}> add a letter (12B)</label>` : ''}</div>
    ${PB.l2 === 'custom' ? `<div class="chips" style="margin-top:6px" aria-label="Line 2 styles to use">${PB_L2PICK.map(([v, l]) => `<button type="button" class="chip ${PB.l2pick.includes(v) ? 'on' : ''}" data-pbl2="${esc(v)}" aria-pressed="${PB.l2pick.includes(v)}">${PB.l2pick.includes(v) ? '✓ ' : ''}${esc(l)}</button>`).join('')}</div>
      <div class="small faint" style="margin-top:3px">Each profile gets one of the ones you tick, picked at random${PB.l2pick.length ? ` — like ${esc(PB.l2pick.slice(0, 3).map(x => x === 'num' ? '123' : x === '#' ? '#123' : x + ' 123').join(', '))}` : ''}.</div>` : ''}
    <div class="small faint" style="margin:-4px 0 8px">${PB.l2 === 'smart' ? 'Smart copies the line 2 style that has been getting through at each house.' : PB.l2 === 'none' ? 'No line 2 on these profiles.' : 'Every profile gets its own line 2 — never one already used at that house.'}</div>
    <label class="check small"><input type="checkbox" data-pbk="plain" ${PB.plain ? 'checked' : ''}> Also make plain profiles with no jig at all (the address exactly as is, no line 2)</label>
    ${PB.plain ? (() => { const na = pbAddrList().length, np = (Math.round(+PB.plainN || 0)) * na, tot = Math.round(+PB.count || 0); return `<div class="hstack pbopts"><span class="small muted">Plain per address</span><input data-pbi="plainN" inputmode="numeric" value="${esc(PB.plainN)}" style="width:70px"><span class="small muted">— part of the ${tot}: <b>${np}</b> plain${na ? ` (${plural(na, 'address')})` : ''} + <b>${Math.max(0, tot - np)}</b> with jigs</span></div>`; })() : ''}
    <div class="section">Names</div>${seg('names', [['random', 'Random names'], ['first', 'Random first names'], ['same', 'One name for all']])}
    ${PB.names !== 'random' ? `<div class="fgrid" style="margin-top:8px">${PB.names === 'same' ? `<div class="s2"><label>First name</label><input data-pbi="first" value="${esc(PB.first)}"></div>` : ''}<div class="s2"><label>Last name${PB.names === 'first' ? ' (empty = random)' : ''}</label><input data-pbi="last" value="${esc(PB.last)}"></div></div>` : ''}
    <div class="section">Emails</div>${seg('email', [['catchall', 'Catch-all domain'], ['gmail', 'Gmail dot trick'], ['accounts', 'My saved accounts'], ['paste', 'Paste emails'], ['none', 'Leave empty']])}
    <div style="margin-top:8px">${PB.email === 'catchall' ? `<input data-pbi="domain" value="${esc(PB.domain)}" placeholder="yourdomain.com">` : PB.email === 'gmail' ? `<input data-pbi="gmail" value="${esc(PB.gmail)}" placeholder="yourname@gmail.com"><div class="small faint" style="margin-top:4px">Gmail ignores dots, so every variation lands in the same inbox.</div>` : PB.email === 'accounts' ? `<div class="hstack" style="gap:8px;flex-wrap:wrap"><div class="chips"><button type="button" class="chip ${PB.accAll ? '' : 'on'}" data-pbacc="unused">Unused only</button><button type="button" class="chip ${PB.accAll ? 'on' : ''}" data-pbacc="all">All accounts</button></div><select data-pbi="accGroup" style="width:auto;min-width:200px">${(() => { const w = PB.accAll ? '' : ' unused'; return `<option value="all" ${PB.accGroup === 'all' ? 'selected' : ''}>All account groups (${freeAccounts('all').length}${w})</option>${(state.accountGroups || []).map(g => `<option value="${g.id}" ${PB.accGroup === g.id ? 'selected' : ''}>${esc(g.name)} (${freeAccounts(g.id).length}${w})</option>`).join('')}${(state.accounts || []).some(a => !(a.groupId && accGroupById(a.groupId))) && (state.accountGroups || []).length ? `<option value="none" ${PB.accGroup === 'none' ? 'selected' : ''}>No group (${freeAccounts('none').length}${w})</option>` : ''}`; })()}</select></div><div class="small muted" style="margin-top:4px">${PB.accAll ? `${plural(fa, 'account')}, used or not — each new profile gets one. Accounts already on a profile stay linked to that one.` : `${plural(fa, 'unused account')} — each new profile gets one and they’re linked together`}</div>`
      : PB.email === 'paste' ? `<textarea data-pbi="emailsPasted" style="min-height:90px" spellcheck="false" placeholder="one@example.com\ntwo@example.com\n…or email:password lines">${esc(PB.emailsPasted)}</textarea><div class="small ${pastedEmails().length >= (pbRows.length || +PB.count || 0) ? 'faint' : ''}" style="margin-top:3px">${plural(pastedEmails().length, 'email')} — used in order, one per profile${PB.emailsPasted.trim() && !pastedEmails().length ? ' · <span style="color:var(--danger)">no email addresses found</span>' : ''}</div>` : ''}</div>
    <div class="section">Phone</div>${seg('phone', [['random', 'Random numbers'], ['same', 'One number for all']])}
    <div style="margin-top:8px">${PB.phone === 'random' ? `<input data-pbi="area" value="${esc(PB.area)}" placeholder="Area code (default: from your profiles)" inputmode="numeric" maxlength="3" style="max-width:280px">` : `<input data-pbi="phoneFixed" value="${esc(PB.phoneFixed)}" inputmode="tel" style="max-width:280px">`}</div>
    <div class="section">Cards</div>
    ${(() => { const groups = state.cardGroups || [], uses = pbCardUses(), all = pbCards(), per = Math.max(1, Math.round(+PB.perCard || 1)), tot = Math.round(+PB.count || 0);
      const gsel = groups.filter(g => pbCardsIn(g.id).some(c => PB.cardSel.has(c.id)));
      return `${groups.length ? `<div class="small muted" style="margin-bottom:6px">Tick card groups — mix as many as you want. Open a group to pick only some of its cards.</div>
      <div class="pbcgs">${groups.map(g => { const us = pbCardsIn(g.id), n = us.filter(c => PB.cardSel.has(c.id)).length, open = PB.cgOpen.has(g.id);
        return `<div class="pbcg ${n ? 'on' : ''}"><div class="pbcghead"><label class="check" style="flex:1;min-width:0"><input type="checkbox" data-pbcg="${g.id}" ${n && n === us.length ? 'checked' : ''} ${n && n < us.length ? 'data-indet="1"' : ''} ${us.length ? '' : 'disabled'}> <span class="ellipsis">${esc(g.name)}</span></label><span class="small muted">${n ? n + ' of ' : ''}${plural(us.length, 'card')}</span>${us.length ? `<button type="button" class="ghost sm" data-pbcgopen="${g.id}" aria-expanded="${open}">${open ? 'Done ▴' : 'Pick cards ▾'}</button>` : ''}</div>
        ${open ? `<div class="pbcglist"><div class="hstack" style="gap:6px;margin-bottom:4px"><button type="button" class="sm ghost" data-pbcgset="${g.id}" data-v="all">All</button><button type="button" class="sm ghost" data-pbcgset="${g.id}" data-v="none">None</button><button type="button" class="sm ghost" data-pbcgset="${g.id}" data-v="fresh">Only ones not on a profile</button></div>
          ${us.map(c => { const u = uses.get(cardDigits(c.number)) || 0; return `<label class="check small pbcard" title="${esc(cardBrand(c.number))} ending ${esc(cardDigits(c.number).slice(-4))}${u ? ' · on ' + plural(u, 'profile') : ' · not on a profile yet'}"><input type="checkbox" data-pbcard="${c.id}" ${PB.cardSel.has(c.id) ? 'checked' : ''}><span class="mono nw">•••• ${esc(cardDigits(c.number).slice(-4))}</span><span class="faint nw">${esc(c.month)}/${esc(String(c.year).slice(-2))}</span><span class="ellipsis grow">${esc(c.name || cardBrand(c.number))}</span>${u ? `<span class="faint nw">on ${plural(u, 'profile')}</span>` : '<span class="nw pbfresh">unused</span>'}</label>`; }).join('')}</div>` : ''}</div>`; }).join('')}</div>
      ${gsel.length > 1 ? `<div class="hstack pbopts"><span class="small muted">Order</span><div class="chips"><button type="button" class="chip ${PB.cardOrder === 'alt' ? 'on' : ''}" data-pb="cardOrder" data-v="alt">Alternate between groups</button><button type="button" class="chip ${PB.cardOrder === 'seq' ? 'on' : ''}" data-pb="cardOrder" data-v="seq">One group after another</button></div></div>` : ''}
      <a class="small linkbtn" data-pbnav="cards">Manage cards</a>` : ''}
      <details class="addmanual" ${!groups.length || PB.pasted.trim() || PB.cards.size ? 'open' : ''} style="margin-top:8px"><summary class="small">＋ Cards already on your profiles, or paste cards</summary>
        ${kc.length ? `<div class="small muted" style="margin:6px 0">Cards already on your profiles:</div><div class="chips">${kc.map(c => `<button type="button" class="chip ${PB.cards.has(c.number) ? 'on' : ''}" data-pbc="${c.number}">${esc(cardBrand(c.number))} ${esc(c.number.slice(-4))} <span class="n">${c.uses}</span></button>`).join('')}</div>` : ''}
        <div style="margin-top:8px"><label>Paste cards (number | MM | YYYY | CVV, one per line)</label><textarea data-pbi="pasted" style="min-height:64px" spellcheck="false" placeholder="4111111111111111|12|2029|123">${esc(PB.pasted)}</textarea>${PB.pasted.trim() ? `<div class="small ${pc ? 'faint' : ''}" style="margin-top:3px;${pc ? '' : 'color:var(--danger)'}">${pc ? plural(pc, 'valid card') : 'No valid card numbers found'}</div>` : ''}</div></details>
      <div class="small ${all.length && all.length * per < tot ? '' : 'muted'}" style="margin-top:8px;${all.length && all.length * per < tot ? 'color:var(--warn)' : ''}">${all.length ? `<b>${plural(all.length, 'card')}</b> × ${per} per card = room for ${all.length * per} profiles${tot ? ` · you’re making ${tot}${all.length * per >= tot ? ` (${plural(Math.ceil(tot / per), 'card')} used)` : ''}` : ''}` : 'No cards picked — the profiles are made without a card.'}</div>`; })()}
    <div class="hstack pbopts"><span class="small muted">Profiles per card</span><input data-pbi="perCard" inputmode="numeric" value="${esc(PB.perCard)}" style="width:80px"></div>
    <label class="check small" style="margin-top:8px"><input type="checkbox" data-pbk="oneCheckout" ${PB.oneCheckout ? 'checked' : ''}> Only one checkout per profile</label>
    <div class="section">Preview</div>
    ${plan.err ? `<div class="note warn small">${esc(plan.err)}</div>` : `<div class="pbprev">${pbRows.slice(0, 8).map(r => `<div class="pbrow"><b>${esc(r.name)}</b><span>${esc(r.first)} ${esc(r.last)}</span><span>${esc(r.a1)}${r.a2 ? ', ' + esc(r.a2) : ''}${r.plain ? ' <span class="badge">no jig</span>' : ''}</span><span class="faint">${esc(r.email || '—')}</span><span class="faint">${r.card ? '•••• ' + esc(r.card.number.slice(-4)) : 'no card'}</span></div>`).join('')}${pbRows.length > 8 ? `<div class="small muted" style="padding:6px 0">…and ${pbRows.length - 8} more</div>` : ''}</div>`}`;
  $$('#pbBody [data-indet]').forEach(x => { x.indeterminate = true; });
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
    const go1 = e.target.closest('[data-pbcgopen]'); if (go1) { const g = go1.dataset.pbcgopen; PB.cgOpen.has(g) ? PB.cgOpen.delete(g) : PB.cgOpen.add(g); renderBuilder(); return; }
    const gs = e.target.closest('[data-pbcgset]'); if (gs) { const uses = pbCardUses(); pbCardsIn(gs.dataset.pbcgset).forEach(c => { const on = gs.dataset.v === 'all' || (gs.dataset.v === 'fresh' && !uses.get(cardDigits(c.number))); on ? PB.cardSel.add(c.id) : PB.cardSel.delete(c.id); }); renderBuilder(); return; }
    const c = e.target.closest('[data-pbc]'); if (c) { const n = c.dataset.pbc; PB.cards.has(n) ? PB.cards.delete(n) : PB.cards.add(n); renderBuilder(); return; }
    const at = e.target.closest('[data-addtoggle]'); if (at) { const o = addrOptions().find(x => x.key === at.dataset.addtoggle); if (o) pbAddrToggle(o); renderBuilder(); return; }
    const arm = e.target.closest('[data-addrm]'); if (arm) { PB.addrs = PB.addrs.filter(a => a.key !== arm.dataset.addrm); renderBuilder(); return; }
    if (e.target.closest('#pbAddAddr')) { const a = cleanAddr({ addr1: PB.addr1, city: PB.city, state: PB.st, zip: PB.zip }); if (!a.addr1 || !/^\d{5}$/.test(a.zip)) { toast('Type a street and 5-digit ZIP'); return; } PB.addrs.push({ key: 'm:' + uid(), addr1: a.addr1, city: a.city, st: a.state, zip: a.zip, label: a.addr1 }); PB.addr1 = PB.city = PB.st = PB.zip = ''; renderBuilder(); return; }
    const ac = e.target.closest('[data-pbacc]'); if (ac) { PB.accAll = ac.dataset.pbacc === 'all'; renderBuilder(); return; }
    const l2b = e.target.closest('[data-pbl2]'); if (l2b) { const v = l2b.dataset.pbl2; PB.l2pick = PB.l2pick.includes(v) ? PB.l2pick.filter(x => x !== v) : PB_L2PICK.map(x => x[0]).filter(x => x === v || PB.l2pick.includes(x)); renderBuilder(); return; }
    const nv = e.target.closest('[data-pbnav]'); if (nv) { closeDlg('dlgBuild'); go(nv.dataset.pbnav); }
  });
  body.addEventListener('input', e => { const k = e.target.dataset.pbi; if (!k || e.target.tagName === 'SELECT') return; PB[k] = e.target.value; rer(); });
  body.addEventListener('change', e => { const k = e.target.dataset.pbi; if (k && e.target.tagName === 'SELECT') { PB[k] = e.target.value; renderBuilder(); } const cg = e.target.dataset.pbcg; if (cg) { const us = pbCardsIn(cg), on = e.target.checked; us.forEach(c => on ? PB.cardSel.add(c.id) : PB.cardSel.delete(c.id)); renderBuilder(); return; }
    const cd = e.target.dataset.pbcard; if (cd) { e.target.checked ? PB.cardSel.add(cd) : PB.cardSel.delete(cd); clearTimeout(PB._rt); PB._rt = setTimeout(renderBuilder, 0); return; }  // shift-click ticks a whole range, then one redraw
    const kk = e.target.dataset.pbk; if (kk) { PB[kk] = e.target.checked; if (kk !== 'oneCheckout') renderBuilder(); } });
  $('#pbReroll').onclick = () => renderBuilder();
  $('#pbGo').onclick = async () => {
    const rows = pbRows.slice(); if (!rows.length) return;
    if (!await ask(`Create ${plural(rows.length, 'profile')} in ${catName(PB.cat)}?`, { ok: 'Create profiles' })) return;
    snapshot('build profiles'); const ids = [];
    for (const r of rows) {
      const p = blankProfile(PB.cat);
      Object.assign(p, { name: r.name, email: r.email, phone: r.phone, shipFirst: r.first, shipLast: r.last, shipAddr1: r.a1, shipAddr2: r.a2, shipCity: r.city, shipState: r.st, shipZip: r.zip, shipCountry: 'US', sameBilling: true, oneCheckout: !!PB.oneCheckout, updatedAt: Date.now() });
      if (r.card) Object.assign(p, { cardNumber: r.card.number, cardExpMonth: r.card.month, cardExpYear: r.card.year, cardCvv: r.card.cvv, cardName: r.card.name || `${r.first} ${r.last}` });
      if (r.acc) { const a = state.accounts.find(x => x.id === r.acc.id); if (a && !a.profileId) { a.profileId = p.id; a.updatedAt = Date.now(); } }
      state.profiles.push(p); ids.push(p.id);
    }
    (PB.addrs.length ? PB.addrs : pbAddrList()).forEach(a => saveGroupAddress(PB.cat, { addr1: a.addr1, city: a.city, state: a.st, zip: a.zip }));
    PB.addrs = []; PB.addr1 = PB.city = PB.st = PB.zip = ''; PB.pasted = '';
    view = PB.cat; selected = new Set(ids); autoLinkAll(); save(); closeDlg('dlgBuild'); go('profiles'); refresh();
    toast(`Created ${plural(rows.length, 'profile')} — they’re selected, so Export sends just these to your bot`, { undo: true });
  };
}

/* Crown Tools - saved addresses per profile group. Only the main address is kept (street, city, state, ZIP):
   line 2 and jig letters are stripped, so every new profile starts from the clean address. */
'use strict';
const cleanAddr = a => {
  const street = titleAddr(Parser.cleanStreet(a.addr1 || '') || '').replace(/\s+/g, ' ').trim();
  return { addr1: street, city: titleCase(String(a.city || '').trim()), state: fixState(a.state || ''), zip: Parser.zip5(String(a.zip || '').trim()) };
};
const addrKey = a => Parser.houseKey(a.addr1, a.zip);
const addrText = a => [a.addr1, [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');
function groupAddresses(catId) { const c = state.categories.find(x => x.id === catId); return c ? (c.addresses = c.addresses || []) : []; }
// Add to a group unless the same house is already saved there. Returns the saved entry (new or existing).
function saveGroupAddress(catId, raw, label) {
  const c = state.categories.find(x => x.id === catId); if (!c) return null;
  const a = cleanAddr(raw); if (!a.addr1 || !a.zip) return null;
  c.addresses = c.addresses || [];
  const k = addrKey(a); const have = k && c.addresses.find(x => addrKey(x) === k);
  if (have) return have;
  const e = Object.assign({ id: uid(), label: label || '', createdAt: Date.now() }, a); c.addresses.push(e); c.updatedAt = Date.now();
  return e;
}
const fromProfile = p => ({ addr1: p.shipAddr1, city: p.shipCity, state: p.shipState, zip: p.shipZip });

/* ---------- the group's address book ---------- */
let addrCat = '';
function openAddresses(catId) { addrCat = catId; renderAddresses(); openDlg('dlgAddrs'); }
function renderAddresses() {
  const list = groupAddresses(addrCat);
  const inGroup = state.profiles.filter(p => p.categoryId === addrCat && p.shipAddr1 && p.shipZip);
  const missing = new Map(); for (const p of inGroup) { const a = cleanAddr(fromProfile(p)); const k = addrKey(a); if (k && !list.some(x => addrKey(x) === k) && !missing.has(k)) missing.set(k, a); }
  const uses = a => state.profiles.filter(p => p.categoryId === addrCat && addrKey(cleanAddr(fromProfile(p))) === addrKey(a)).length;
  $('#addrTitle').innerHTML = `Saved addresses ${state.categories.length > 1 ? `<select id="addrCatSel" style="width:auto;margin-left:8px">${catOptions(addrCat)}</select>` : '· ' + esc(catName(addrCat))}`;
  $('#addrBody').innerHTML = `<div class="small muted" style="margin-bottom:10px">Only the main address is saved — no line 2 and no jig letters. Pick one when you add or build profiles in this group.</div>
    ${missing.size ? `<div class="note small" style="margin-bottom:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span style="flex:1">${plural(missing.size, 'address')} used by profiles in this group ${missing.size === 1 ? 'isn’t' : 'aren’t'} saved yet.</span><button class="sm" id="addrPull">Save ${missing.size === 1 ? 'it' : 'them'}</button></div>` : ''}
    ${list.length ? `<div class="list">${list.map(a => `<div class="li"><div class="mmain"><div class="t2">${esc(a.label || a.addr1)}</div><div class="small muted">${esc(addrText(a))}${uses(a) ? ' · ' + plural(uses(a), 'profile') : ''}</div></div><button class="ghost sm" data-arename="${a.id}">Name</button><button class="ghost sm" data-adel="${a.id}" aria-label="Remove">✕</button></div>`).join('')}</div>` : '<div class="empty sm">No saved addresses in this group yet.</div>'}
    <div class="section">Add an address</div>
    <div class="fgrid"><div class="s2"><label>Street</label><input id="naStreet" placeholder="11662 S 2670 W" autocomplete="off"></div><div><label>City</label><input id="naCity" autocomplete="off"></div><div><label>State · ZIP</label><div class="hstack" style="gap:6px"><input id="naState" style="width:64px" maxlength="20" autocomplete="off"><input id="naZip" inputmode="numeric" style="flex:1;min-width:0" autocomplete="off"></div></div>
    <div class="s2"><label>Nickname (optional)</label><input id="naLabel" placeholder="Mom’s house" autocomplete="off"></div></div>
    <div class="hstack" style="margin-top:10px"><button class="primary" id="naAdd">Save address</button><span class="small faint" id="naNote"></span></div>`;
  if ($('#addrCatSel')) $('#addrCatSel').onchange = e => { addrCat = e.target.value; renderAddresses(); };
  if ($('#addrPull')) $('#addrPull').onclick = () => { snapshot('save addresses'); missing.forEach(a => saveGroupAddress(addrCat, a)); save(); renderAddresses(); toast(`Saved ${plural(missing.size, 'address')}`, { undo: true }); };
  $('#naAdd').onclick = () => {
    const raw = { addr1: $('#naStreet').value, city: $('#naCity').value, state: $('#naState').value, zip: $('#naZip').value };
    const a = cleanAddr(raw); if (!a.addr1 || !/^\d{5}$/.test(a.zip)) { $('#naNote').textContent = 'Type at least the street and a 5-digit ZIP.'; return; }
    const before = groupAddresses(addrCat).length; const e = saveGroupAddress(addrCat, raw, $('#naLabel').value.trim());
    save(); renderAddresses(); toast(groupAddresses(addrCat).length > before ? `Saved ${e.addr1}` : 'That address is already saved');
  };
  $$('#addrBody [data-adel]').forEach(b => b.onclick = () => { const c = state.categories.find(x => x.id === addrCat); snapshot('remove address'); c.addresses = c.addresses.filter(x => x.id !== b.dataset.adel); save(); renderAddresses(); toast('Removed', { undo: true }); });
  $$('#addrBody [data-arename]').forEach(b => b.onclick = async () => { const a = groupAddresses(addrCat).find(x => x.id === b.dataset.arename); const n = await askText('Nickname for this address', a.label || '', { placeholder: 'Leave empty to show the street' }); if (n === null) return; a.label = n.trim(); save(); renderAddresses(); });
}
// "Use a saved address" picker for the profile dialog: every group's addresses, this group's first
function savedAddressOptions(catId) {
  const groups = [state.categories.find(c => c.id === catId)].concat(state.categories.filter(c => c.id !== catId)).filter(c => c && (c.addresses || []).length);
  return groups.map(c => `<optgroup label="${esc(c.name)}">${c.addresses.map(a => `<option value="${c.id}|${a.id}">${esc(a.label ? a.label + ' — ' + addrText(a) : addrText(a))}</option>`).join('')}</optgroup>`).join('');
}
function findSavedAddress(v) { const [cid, aid] = String(v || '').split('|'); return groupAddresses(cid).find(a => a.id === aid) || null; }

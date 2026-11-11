/* Kingpin - bring data from another Kingpin into this one (one-time, adds - never deletes):
   - the Mac/Windows app's own data when you link it to your Kingpin Online account
   - any backup file ("Add from a backup file…" in Settings)
   Records already here are matched and skipped (same card number, same profile, same order number, same inbox…), groups
   with the same name are joined, and links between records (a card's group, an order's profile…) are kept. */
'use strict';
const KD = typeof window !== 'undefined' && window.kingpinDesktop ? window.kingpinDesktop : null;   // inside the Mac/Windows app
let kdImported = !!(KD && KD.imported);
const kdMarkImported = () => { kdImported = true; if (KD) KD.setImported(true); };
const IMPORT_KEYS = ['categories', 'cardGroups', 'accountGroups', 'emailGroups', 'profiles', 'houses', 'cards', 'accounts', 'emails', 'imapAccounts', 'inventory', 'orders', 'sales', 'expenses', 'discordFeeds', 'botCheckouts', 'itemLinks', 'acoClients', 'acoCheckouts', 'acoInvoices', 'skuLists'];
const lowS = v => String(v || '').trim().toLowerCase();
const digitsS = v => String(v || '').replace(/\D/g, '');
// what makes two records "the same" when they were made separately (different ids)
const IMPORT_NK = {
  categories: x => x.name ? 'n:' + lowS(x.name) : '', cardGroups: x => x.name ? 'n:' + lowS(x.name) : '', accountGroups: x => x.name ? 'n:' + lowS(x.name) : '', emailGroups: x => x.name ? 'n:' + lowS(x.name) : '',
  // the same person/address/card is the same profile whatever it's called (a bot may have renamed it, e.g. "abc_Target")
  profiles: x => (x.email || x.shipAddr1 || x.cardNumber) ? [lowS(x.email), lowS(x.shipAddr1), lowS(x.shipAddr2), digitsS(x.shipZip).slice(0, 5), digitsS(x.cardNumber), lowS(x.shipFirst), lowS(x.shipLast)].join('|') : '',
  cards: x => digitsS(x.number) ? 'c:' + digitsS(x.number) : '',
  accounts: x => x.email ? lowS(x.store) + '|' + lowS(x.email) : '',
  emails: x => lowS(x.email),
  imapAccounts: x => x.user ? lowS(x.user) + '|' + lowS(x.host || '') : '',
  orders: x => { const n = typeof Parser !== 'undefined' ? Parser.normOrderNo(x.orderNumber || '') : lowS(x.orderNumber); return n ? n + '|' + lowS(x.store) : ''; },
  houses: x => { const a = lowS((x.keys || [])[0] || x.addr1 || x.address); return a ? a + '|' + digitsS(x.zip).slice(0, 5) : ''; },
  sales: x => !(x.lines || []).length ? '' : [x.date, (x.lines || []).map(l => lowS(l.name) + 'x' + l.qty + '@' + l.price).join(','), x.platform].join('|'),
  expenses: x => [x.date, x.amount, lowS(x.note)].join('|'),
  discordFeeds: x => lowS(x.url || x.webhook || x.channel || ''),
  skuLists: x => x.name ? 'n:' + lowS(x.name) : '',
};
// which list an id field points into
const IMPORT_REFS = { categoryId: 'categories', profileId: 'profiles', houseId: 'houses', itemId: 'inventory', clientId: 'acoClients', orderId: 'orders', invoiceId: 'acoInvoices', botId: 'botCheckouts' };
const IMPORT_GROUP_OF = { cards: 'cardGroups', accounts: 'accountGroups', emails: 'emailGroups' };
function importPlan(src, dst) {
  const plan = { add: {}, skip: {}, map: {} };
  for (const k of IMPORT_KEYS) {
    const have = dst[k] || [], ids = new Set(have.map(x => x.id)), nk = IMPORT_NK[k];
    const keys = new Map(); if (nk) have.forEach(x => { const v = nk(x); if (v && v !== '|' && !/^\|+$/.test(v)) keys.set(v, x.id); });
    plan.map[k] = {}; plan.add[k] = []; plan.skip[k] = 0;
    for (const x of src[k] || []) {
      if (!x || !x.id) continue;
      if (ids.has(x.id)) { plan.map[k][x.id] = x.id; plan.skip[k]++; continue; }            // already here (same record)
      const v = nk ? nk(x) : '';
      if (v && keys.has(v) && !/^\|+$/.test(v)) { plan.map[k][x.id] = keys.get(v); plan.skip[k]++; continue; }  // the same thing, made separately
      plan.add[k].push(x); plan.map[k][x.id] = x.id; if (v) keys.set(v, x.id);
    }
  }
  return plan;
}
function importApply(src) {
  const plan = importPlan(src, state);
  const remap = (o, k) => {
    const c = JSON.parse(JSON.stringify(o));
    for (const [f, list] of Object.entries(IMPORT_REFS)) if (c[f] && plan.map[list] && plan.map[list][c[f]]) c[f] = plan.map[list][c[f]];
    if (IMPORT_GROUP_OF[k] && c.groupId && plan.map[IMPORT_GROUP_OF[k]][c.groupId]) c.groupId = plan.map[IMPORT_GROUP_OF[k]][c.groupId];
    if (Array.isArray(c.inboxIds)) c.inboxIds = [...new Set(c.inboxIds.map(i => plan.map.imapAccounts[i] || i))];
    if (k === 'sales') (c.lines || []).forEach(l => { if (l.itemId && plan.map.inventory[l.itemId]) l.itemId = plan.map.inventory[l.itemId]; });
    return c;
  };
  const added = {};
  for (const k of IMPORT_KEYS) { if (!plan.add[k].length) continue; state[k] = (state[k] || []).concat(plan.add[k].map(x => remap(x, k))); added[k] = plan.add[k].length; }
  // emails already read on the other copy aren't read again
  const seen = new Set(state.seenIds || []); for (const id of src.seenIds || []) if (!seen.has(id)) { seen.add(id); (state.seenIds = state.seenIds || []).push(id); }
  if (typeof dedupeAfterMerge === 'function') dedupeAfterMerge();
  return { added, skip: plan.skip };
}
const IMPORT_NAMES = { profiles: 'profile', cards: 'card', accounts: 'store login', emails: 'email', imapAccounts: 'inbox', orders: 'order', inventory: 'inventory item', sales: 'sale', expenses: 'expense', categories: 'profile group', cardGroups: 'card group', accountGroups: 'account group', emailGroups: 'email group', houses: 'house', skuLists: 'SKU list', acoClients: 'ACO client', acoCheckouts: 'ACO checkout', acoInvoices: 'invoice', discordFeeds: 'Discord feed', botCheckouts: 'bot checkout', itemLinks: 'item link' };
function importSummary(counts) {
  const parts = Object.entries(counts).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).map(([k, n]) => plural(n, IMPORT_NAMES[k] || k));
  return parts.length ? parts.join(', ') : 'nothing new';
}
// decrypt another copy (try this account's password first - it's usually the same)
async function importOpen(blob, title) {
  let pw = typeof lastUnlockPw === 'string' ? lastUnlockPw : '', data = null;
  for (let tries = 0; tries < 5 && !data; tries++) {
    if (pw) { try { data = (await decryptBlob(blob, pw)).data; break; } catch (_) { } }
    pw = await askPassword(title, tries || !lastUnlockPw ? 'Enter the password that copy of Kingpin uses.' : 'That copy uses a different password. Enter it to open it.');
    if (pw == null) return null;
  }
  if (!data) toast('Wrong password — that copy wasn’t opened');
  return data && migrate(data);
}
async function importFlow(blob, from) {
  const src = await importOpen(blob, from === 'desktop' ? 'Data on this computer' : 'Add from a backup');
  if (!src) return false;
  const plan = importPlan(src, state), add = {}; for (const k of IMPORT_KEYS) add[k] = plan.add[k].length;
  const total = Object.values(add).reduce((a, b) => a + b, 0), same = Object.values(plan.skip).reduce((a, b) => a + b, 0);
  if (!total) { toast(`Everything there is already here (${plural(same, 'record')} matched)`); if (from === 'desktop') kdMarkImported(); return true; }
  const ok = await ask(`${from === 'desktop' ? 'Add this computer’s Kingpin data to your account?' : 'Add this backup to your data?'}\n\nNew: ${importSummary(add)}.\n${same ? `Already here (skipped): ${plural(same, 'record')}.\n` : ''}\nNothing already here is changed or lost.`, { ok: `Add ${plural(total, 'record')}` });
  if (!ok) { if (from === 'desktop' && !kdImported) { kdMarkImported(); toast('Not added. You can add it anytime in Settings → This computer.', { ms: 8000 }); } return false; }
  snapshot('add data from ' + (from === 'desktop' ? 'this computer' : 'a backup'));
  const r = importApply(src);
  save(); if (typeof saveNow === 'function') await saveNow({ force: true }); refresh();
  if (from === 'desktop') kdMarkImported();
  toast(`Added ${importSummary(r.added)}`, { undo: true, ms: 9000 });
  return true;
}
// Settings: "Add from a backup file…" (merge, unlike Restore which replaces)
function wireImportFile() {
  const b = document.getElementById('stMerge'); if (!b) return;
  let inp = document.getElementById('mergeFile');
  if (!inp) { inp = document.createElement('input'); inp.type = 'file'; inp.id = 'mergeFile'; inp.accept = '.json,application/json'; inp.hidden = true; document.body.appendChild(inp); }
  b.onclick = () => inp.click();
  inp.onchange = async () => {
    const f = inp.files[0]; inp.value = ''; if (!f) return;
    let blob; try { blob = JSON.parse(await f.text()); } catch (_) { toast('That file isn’t a Kingpin backup'); return; }
    if (!validBlob(blob)) { toast('That file isn’t a Kingpin backup'); return; }
    try { await importFlow(blob, 'file'); } catch (e) { toast(e.message || 'Couldn’t add that backup'); }
  };
}

/* ---------- the Mac / Windows app ---------- */
// Settings card: link this computer to Kingpin Online / back to this computer only
const OLD_DESKTOP = () => !KD && typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent) && !CLOUD;   // the Mac/Windows app from before 0.20.10
const DL_PAGE = 'https://github.com/caulenmomo-star/Crown-app/releases/latest';   // Kingpin-Mac-…zip / Kingpin-Windows.zip
function desktopLinkCardHtml() {
  if (OLD_DESKTOP()) return `<div class="card"><h3>Kingpin Online</h3><div class="small muted">The newest Mac and Windows app can link to your Kingpin Online account, so this computer and your phone stay in sync. Get the new download (your data on this computer is kept).</div>
    <button class="primary" id="kdGetNew" style="margin-top:10px">Get the new download</button></div>`;
  if (!KD) return '';
  if (KD.mode === 'online') return `<div class="card"><h3>This computer</h3><div class="small muted">This app is using your <b>Kingpin Online</b> account, so it stays in sync with your phone and anyone else signed in to it.</div>
    ${KD.hasLocal ? `<div class="hstack" style="margin-top:10px;gap:8px;flex-wrap:wrap"><button class="sm" id="kdImport">${kdImported ? 'Add this computer’s data again' : 'Add this computer’s data to my account'}</button></div>` : ''}
    <div class="hstack" style="margin-top:10px"><button class="ghost sm" id="kdLocal">Use only this computer instead…</button></div></div>`;
  return `<div class="card"><h3>Kingpin Online</h3><div class="small muted">Right now this app keeps its data on this computer only. Link it to your Kingpin Online account and everything stays in sync between this computer, your phone and anyone you share the account with. Your data here is added to the account (nothing is deleted).</div>
    <button class="primary" id="kdOnline" style="margin-top:10px">Link to my Kingpin Online account</button></div>`;
}
function wireDesktopLink() {
  const gn = document.getElementById('kdGetNew'); if (gn) gn.onclick = () => window.open(DL_PAGE, '_blank');
  if (!KD) return;
  const on = document.getElementById('kdOnline'), loc = document.getElementById('kdLocal'), imp = document.getElementById('kdImport');
  if (on) on.onclick = async () => {
    if (!await ask('Link this computer to Kingpin Online?\n\nKingpin will open your online account here (sign in, or create one). Then it offers to add the data from this computer to it.', { ok: 'Link it' })) return;
    try { if (cryptoKey && (pendingSave || saving)) await saveNow({ force: true }); } catch (_) { }
    KD.setMode('online');
  };
  if (loc) loc.onclick = async () => {
    if (!await ask('Use only this computer?\n\nThis app goes back to the data stored on this computer. It won’t see changes made online or on your phone until you link it again.', { ok: 'Use this computer only' })) return;
    KD.setMode('local');
  };
  if (imp) imp.onclick = async () => { try { const blob = await KD.readLocal(); if (!blob) { toast('No data on this computer'); return; } await importFlow(blob, 'desktop'); PAGES.settings.render(); } catch (e) { toast(e.message || 'Couldn’t read this computer’s data'); } };
}
// right after signing in online on the Mac/Windows app the first time: offer to bring this computer's data in
async function desktopOfferImport() {
  if (OLD_DESKTOP()) {   // once per computer: point the old app at the new download
    let told = false; try { told = localStorage.getItem('crown.linkTip') === '1'; localStorage.setItem('crown.linkTip', '1'); } catch (_) { told = true; }
    if (!told) toast('New: link this computer to Kingpin Online so it stays in sync with your phone', { action: 'How', onAction: () => go('settings'), ms: 15000 });
    return;
  }
  if (!KD || KD.mode !== 'online' || !CLOUD || !KD.hasLocal || kdImported || desktopOfferImport.done || !cryptoKey) return;
  if (document.querySelector('dialog[open]')) { setTimeout(desktopOfferImport, 1500); return; }   // after "what's new" etc.
  desktopOfferImport.done = true;
  let blob; try { blob = await KD.readLocal(); } catch (_) { return; }
  if (!blob || !validBlob(blob)) { kdMarkImported(); return; }
  try { await importFlow(blob, 'desktop'); } catch (e) { toast(e.message || 'Couldn’t add this computer’s data'); }
}

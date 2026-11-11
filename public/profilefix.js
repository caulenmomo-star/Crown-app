/* Kingpin - "Fix profile names": profiles whose name ends in a store, like "abc.def_Target".
   - a copy of a profile you already have (same name without the store, or the same email + address + card + name on
     the card) is removed, and everything that pointed at it (orders, store logins) points at the one you kept;
   - every other one gets its name back without the store ("abc.def_Target" → "abc.def").
   Offered once when such names are found, and any time from Settings → Data tools. Undo works right after. */
'use strict';
const NF_STORE_WORDS = () => {
  const w = new Set();
  for (const s of Parser.STORES) { if (s.key === 'other') continue; w.add(s.label); (s.alias || []).forEach(a => w.add(a)); if (s.key.length >= 4) w.add(s.key); }
  ['PKC', 'Pokemon Center', 'PokemonCenter', 'BBY', 'BestBuy', 'Sams', 'SamsClub'].forEach(x => w.add(x));
  return [...w];
};
let _nfRx = null;
function nfRx() {
  if (_nfRx) return _nfRx;
  const alt = NF_STORE_WORDS().map(x => x.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[ _-]?')).sort((a, b) => b.length - a.length).join('|');
  return (_nfRx = new RegExp(`^(.*\\S)_(?:${alt})$`, 'i'));
}
// "abc.def_Target" → "abc.def"; anything else → null
function nfBaseName(name) {
  const n = String(name || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const m = n.match(nfRx()); if (!m) return null;
  return String(name).trim().slice(0, m[1].length).trim() || null;
}
const nfLow = v => String(v || '').trim().toLowerCase();
const nfSame = (a, b) => ['email', 'shipAddr1', 'shipAddr2', 'shipZip', 'shipFirst', 'shipLast'].every(k => nfLow(a[k]) === nfLow(b[k])) && String(a.cardNumber || '').replace(/\D/g, '') === String(b.cardNumber || '').replace(/\D/g, '');
function nfPlan() {
  const rename = [], copies = [];
  const byName = new Map(); for (const p of state.profiles) { if (nfBaseName(p.name) != null) continue; const k = nfLow(p.name); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(p); }
  const plain = state.profiles.filter(p => nfBaseName(p.name) == null);
  for (const p of state.profiles) {
    const base = nfBaseName(p.name); if (base == null) continue;
    // a copy: same name without the store and the same email, or every detail the same
    const twin = (byName.get(nfLow(base)) || []).find(t => nfLow(t.email) === nfLow(p.email)) || plain.find(t => nfLow(t.email) && nfSame(t, p));
    if (twin) copies.push({ p, keep: twin }); else rename.push({ p, to: base });
  }
  return { rename, copies };
}
function nfApply(plan) {
  const drop = new Map(plan.copies.map(c => [c.p.id, c.keep])), names = new Map();
  for (const r of plan.rename) { names.set(r.p.name, r.to); r.p.name = r.to; r.p.updatedAt = Date.now(); }
  for (const c of plan.copies) names.set(c.p.name, c.keep.name);
  // whatever pointed at a removed copy now points at the profile that's kept
  for (const o of state.orders) if (drop.has(o.profileId)) { o.profileId = drop.get(o.profileId).id; o.updatedAt = Date.now(); }
  for (const a of state.accounts || []) if (drop.has(a.profileId)) { a.profileId = drop.get(a.profileId).id; a.updatedAt = Date.now(); }
  // ACO clients list their profiles by name
  for (const cl of state.acoClients || []) if ((cl.profiles || []).some(n => names.has(n))) { cl.profiles = [...new Set(cl.profiles.map(n => names.get(n) || n))]; cl.updatedAt = Date.now(); }
  // a card that was only on a removed copy keeps pointing at the kept profile (cards follow profiles by number anyway)
  const had = new Set(state.profiles.filter(p => drop.has(p.id)).map(p => p.categoryId));
  state.profiles = state.profiles.filter(p => !drop.has(p.id));
  // a profile group that only held copies goes too (never the last group)
  for (const cid of had) if (state.categories.length > 1 && !state.profiles.some(p => p.categoryId === cid) && !((state.categories.find(c => c.id === cid) || {}).addresses || []).length) { state.categories = state.categories.filter(c => c.id !== cid); if (typeof view !== 'undefined' && view === cid) view = 'all'; }
  if (typeof selected !== 'undefined' && selected.size) for (const id of drop.keys()) selected.delete(id);
  if (typeof _accPIx !== 'undefined') _accPIx = null;
}
function nfSummary(plan) {
  const parts = [];
  if (plan.copies.length) parts.push(`${plural(plan.copies.length, 'copy', 'copies')} of profiles you already have will be removed (their orders and store logins move to the one you keep)`);
  if (plan.rename.length) parts.push(`${plural(plan.rename.length, 'profile')} get${plan.rename.length === 1 ? 's' : ''} the store taken off the name`);
  const ex = plan.rename.slice(0, 3).map(r => `“${r.p.name}” → “${r.to}”`).concat(plan.copies.slice(0, plan.rename.length ? 1 : 3).map(c => `“${c.p.name}” (copy of “${c.keep.name}”)`));
  return parts.join('.\n') + '.' + (ex.length ? '\n\nFor example: ' + ex.join(', ') + '.' : '');
}
async function nfRun(fromPrompt) {
  const plan = nfPlan(), n = plan.rename.length + plan.copies.length;
  if (!n) { if (!fromPrompt) toast('No profile names end in a store — nothing to fix'); return false; }
  const ok = await ask(`Fix ${plural(n, 'profile name')} ending in a store (like “_Target”)?\n\n${nfSummary(plan)}\n\nYou can undo this right after.`, { ok: `Fix ${plural(n, 'profile')}` });
  if (!ok) { if (fromPrompt) toast('Left as is. Settings → Data tools → Fix profile names does it anytime.', { ms: 7000 }); return false; }
  snapshot('fix profile names');
  nfApply(plan); save(); refresh();
  toast(`Fixed ${plural(n, 'profile')}${plan.copies.length ? ` · ${plural(plan.copies.length, 'copy', 'copies')} removed` : ''}`, { undo: true, ms: 12000 });
  return true;
}
// once per account, right after unlocking: offer it if names ending in "_<store>" were already there when you opened
// Kingpin (never in the middle of work, e.g. right after importing a bot file)
function nfOffer(tries) {
  tries = tries || 0;
  if (!cryptoKey || state.settings.pfAsked || tries > 6) return;
  if (!tries && !state.profiles.some(p => nfBaseName(p.name) != null)) return;
  if (document.querySelector('dialog[open]')) { setTimeout(() => nfOffer(tries + 1), 1500); return; }
  state.settings.pfAsked = Date.now(); save();
  nfRun(true);
}

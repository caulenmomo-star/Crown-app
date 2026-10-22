/* Crown Tools - core: state, encryption, storage, server API, navigation, undo, shared helpers. */
'use strict';
const VERSION = '0.9.2'; // prerelease: stays 0.x until Crown Tools is finished (see changelog.js)
const $ = (s, el) => (el || document).querySelector(s);
/* ---------- look: themes (kept per device for the lock screen, and in your data so every device matches) ---------- */
const THEMES_UI = [['crown', 'Crown', 'Graphite and gold'], ['daylight', 'Daylight', 'Light with indigo'], ['midnight', 'Midnight', 'Navy and emerald'], ['ember', 'Ember', 'Charcoal and red'],
  ['royal', 'Royal', 'Deep purple and violet'], ['forest', 'Forest', 'Dark green and lime'], ['mono', 'Mono', 'Black and white'], ['ocean', 'Ocean', 'Light with teal'], ['cherry', 'Cherry', 'Light with red'],
  ['auto', 'Match my device', 'Daylight by day, Crown at night']];
const THEME_BAR = { crown: '#17181b', daylight: '#f3f4f6', midnight: '#0d1526', ember: '#161314', royal: '#140f22', forest: '#0f1914', mono: '#111111', ocean: '#eef3f4', cherry: '#f6f3f3' };
const DEFAULT_THEME = 'crown';
function applyTheme(t) {
  t = THEMES_UI.some(x => x[0] === t) ? t : DEFAULT_THEME;
  const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const real = t === 'auto' ? (dark ? 'crown' : 'daylight') : t;
  document.documentElement.dataset.theme = real;
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = THEME_BAR[real] || '#17181b';
  try { localStorage.setItem('crown.theme', t); } catch (_) { }
  return t;
}
applyTheme((() => { try { return localStorage.getItem('crown.theme') || DEFAULT_THEME; } catch (_) { return DEFAULT_THEME; } })());
if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { let t; try { t = localStorage.getItem('crown.theme'); } catch (_) { } if (t === 'auto') applyTheme('auto'); });
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const sum = (arr, f) => arr.reduce((a, x) => a + (Number(f ? f(x) : x) || 0), 0);
const rint = (a, b) => { a = Math.ceil(a); b = Math.floor(b); if (b < a) [a, b] = [b, a]; return a + Math.floor(Math.random() * (b - a + 1)); };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const plural = (n, w, p) => n + ' ' + (n === 1 ? w : (p || w + 's'));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ---------- money & dates ---------- */
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const USD0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtMoney = (n, whole) => (n == null || n === '' || !Number.isFinite(Number(n))) ? '—' : (whole && Math.abs(n) >= 1000 ? USD0 : USD).format(Number(n));
const pad2 = n => String(n).padStart(2, '0');
const dayKey = d => { d = d instanceof Date ? d : new Date(d); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
const parseDay = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const todayKey = () => dayKey(new Date());
const toDate = v => { if (!v) return null; if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return parseDay(v); const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
function fmtDate(v, opt) { const d = toDate(v); if (!d) return '—'; const sameYear = d.getFullYear() === new Date().getFullYear(); return d.toLocaleDateString('en-US', Object.assign({ month: 'short', day: 'numeric' }, sameYear && !(opt && opt.year) ? {} : { year: 'numeric' }, opt && opt.weekday ? { weekday: 'short' } : {})); }
function fmtDT(v) { const d = toDate(v); if (!d) return '—'; return fmtDate(d) + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
function relDay(v) {
  const d = toDate(v); if (!d) return '';
  const a = parseDay(dayKey(d)), b = parseDay(todayKey()); const diff = Math.round((a - b) / 864e5);
  if (diff === 0) return 'today'; if (diff === 1) return 'tomorrow'; if (diff === -1) return 'yesterday';
  return diff > 0 ? 'in ' + diff + ' days' : Math.abs(diff) + ' days ago';
}
function ago(ms) { if (!ms) return 'never'; const s = Math.round((Date.now() - ms) / 1000); if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + 'm ago'; if (s < 86400) return Math.round(s / 3600) + 'h ago'; return Math.round(s / 86400) + 'd ago'; }

/* ---------- statuses ---------- */
const STATUSES = [
  { k: 'placed', l: 'Placed', c: '#8b93a3', r: 1 },
  { k: 'confirmed', l: 'Confirmed', c: '#7c8cff', r: 2 },
  { k: 'shipped', l: 'Shipped', c: '#f5a524', r: 3 },
  { k: 'ready', l: 'Ready for pickup', c: '#22c3c3', r: 3 },
  { k: 'out', l: 'Out for delivery', c: '#ff7a45', r: 3.5 },
  { k: 'delivered', l: 'Delivered', c: '#3ecf8e', r: 4 },
  { k: 'cancelled', l: 'Cancelled', c: '#ef5b5b', r: 5 },
  { k: 'refunded', l: 'Refunded', c: '#b07cff', r: 5 },
];
const STATUS = Object.fromEntries(STATUSES.map(s => [s.k, s]));
const statusBadge = k => { const s = STATUS[k] || STATUS.placed; return `<span class="badge"><i style="background:${s.c}"></i>${esc(s.l)}</span>`; };
const storeBadge = k => { const s = Parser.storeInfo(k); return `<span class="badge"><i style="background:${s.color}"></i>${esc(s.label)}</span>`; };
const isDead = o => o.status === 'cancelled' || o.status === 'refunded';
const isActive = o => ['placed', 'confirmed', 'shipped', 'ready', 'out'].includes(o.status);
const inTransit = o => o.status === 'shipped' || o.status === 'ready' || o.status === 'out';
// Quantity of an item still in the order (a cancelled-down item can be 0; a missing qty means 1).
const qtyOf = i => i.qty == null || i.qty === '' ? 1 : Math.max(0, Number(i.qty) || 0);
const orderSpend = o => isDead(o) ? 0 : (o.total != null && o.total !== '' && Number.isFinite(Number(o.total)) ? Number(o.total) : sum(o.items || [], i => (Number(i.price) || 0) * qtyOf(i)));
// "Stuck" = the store actually shipped it (or it's ready / delivered). Placed & confirmed orders can still be cancelled,
// so they're "pending" and left out of the stick rate until they ship or get cancelled.
const isStuck = o => ['shipped', 'out', 'ready', 'delivered'].includes(o.status);
const isPending = o => o.status === 'placed' || o.status === 'confirmed';
function stickInfo(list) {
  const stuck = list.filter(isStuck).length, dead = list.filter(isDead).length, pending = list.filter(isPending).length;
  return { stuck, dead, pending, rate: stuck + dead ? Math.round(stuck / (stuck + dead) * 100) : null };
}

/* ---------- state ---------- */
const DEFAULT_SETTINGS = { trackUnknown: false, ignoredSenders: [], autoSyncMin: 15, notify: false, autoLockMin: 0, easypostKey: '', carriers: {}, firstLookback: 60, trackedStores: [], alerts: {}, invOnCheckin: true, platformFees: {} };
function blankState() {
  return { v: 2, categories: [{ id: uid(), name: 'Main' }], profiles: [], orders: [], houses: [], accounts: [], cardGroups: [], cards: [], inventory: [], sales: [], expenses: [], unmatchedScans: [], imapAccounts: [], seenIds: [], unparsed: [], syncLog: [], settings: Object.assign({}, DEFAULT_SETTINGS), createdAt: Date.now() };
}
function migrate(s) {
  s = s && typeof s === 'object' ? s : {};
  const b = blankState();
  for (const k of Object.keys(b)) if (s[k] === undefined) s[k] = b[k];
  if (!Array.isArray(s.categories) || !s.categories.length) s.categories = b.categories;
  s.settings = Object.assign({}, DEFAULT_SETTINGS, s.settings || {});
  for (const k of ['accounts', 'cardGroups', 'cards', 'inventory', 'sales', 'expenses', 'unmatchedScans']) if (!Array.isArray(s[k])) s[k] = [];
  s.profiles.forEach(p => { if (!p.id) p.id = uid(); if (p.notes == null) p.notes = ''; if (!p.categoryId || !s.categories.some(c => c.id === p.categoryId)) p.categoryId = s.categories[0].id; });
  s.orders.forEach(o => { o.items = o.items || []; o.tracking = o.tracking || []; o.history = o.history || []; o.messageIds = o.messageIds || []; o.emails = o.emails || []; });
  s.v = 2;
  return s;
}
let state = blankState();
let cryptoKey = null, salt = null, vaultBlob = null, SERVER = false;
let CLOUD = false, cloudInfo = {}, authKey = null, acctEmail = null, rev = 0, baseJSON = null, cloudExists = false, pendingRestore = null;

/* ---------- server API ---------- */
// A newer Crown Tools is running (or was deployed): this tab's code is old, so it must reload before it can save.
function showOutdated() {
  if (document.getElementById('outdatedBar')) return;
  const d = document.createElement('div'); d.id = 'outdatedBar';
  d.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:9999;background:var(--panel2);border:1px solid var(--warnLine);color:var(--warnText);padding:10px 14px;border-radius:12px;display:flex;gap:12px;align-items:center;box-shadow:0 8px 30px rgba(0,0,0,.4)';
  d.innerHTML = '<span>Crown Tools was updated — reload to keep saving.</span><button class="primary sm">Reload</button>';
  d.querySelector('button').onclick = () => location.reload(); document.body.appendChild(d);
}
async function api(path, body, method) {
  let res;
  const headers = { 'X-Crown': '1', 'X-Crown-App': VERSION };
  if (body) headers['Content-Type'] = 'application/json';
  if (CLOUD && authKey) { headers['X-Crown-Auth'] = authKey; if (acctEmail) headers['X-Crown-Email'] = acctEmail; }
  try {
    res = await fetch(path, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  } catch (e) { throw new Error(CLOUD ? 'Can’t reach Crown Tools Online — check your internet connection.' : 'Crown Tools’ helper isn’t running. Open Crown Tools with “Start Crown Tools”.'); }
  let j = null; try { j = await res.json(); } catch (_) { }
  if (j && j.outdated) showOutdated();
  if (j && j.noAccess && cryptoKey && typeof Account !== 'undefined') Account.lostAccess(j.reason);
  if (!res.ok || !j || j.ok === false) { const err = new Error((j && j.error) || ('Request failed (' + res.status + ')')); err.data = j || {}; throw err; }
  return j;
}

/* ---------- crypto ---------- */
const enc = new TextEncoder(), dec = new TextDecoder();
function b64e(buf) { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
function b64d(s) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
// One PBKDF2 run gives 64 bytes: the first 32 are the encryption key (identical to older Crown Tools / Profile Manager
// vaults), the last 32 are an access key that proves the password to Crown Tools Online without revealing it.
async function deriveKeys(pw, saltBytes) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations: 250000, hash: 'SHA-256' }, base, 512));
  const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return { key, auth: b64e(bits.slice(32)) };
}
async function deriveKey(pw, saltBytes) { return (await deriveKeys(pw, saltBytes)).key; }
const canZip = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
async function pipeBytes(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
async function encryptJSON(k, s, json) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  let pt = enc.encode(json), z = 0;
  if (canZip) { pt = await pipeBytes(pt, new CompressionStream('gzip')); z = 1; }
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, pt);
  return Object.assign({ app: 'crown', v: 2, salt: b64e(s), iv: b64e(iv), ct: b64e(ct), savedAt: Date.now() }, z ? { z: 1 } : {});
}
async function encryptState(k, s) { return encryptJSON(k, s, JSON.stringify(state)); }
async function decryptWithKey(blob, k) {
  let pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(blob.iv) }, k, b64d(blob.ct)));
  if (blob.z) {
    if (!canZip) throw new Error('This browser is too old to open this data. Update your browser.');
    pt = await pipeBytes(pt, new DecompressionStream('gzip'));
  }
  return JSON.parse(dec.decode(pt));
}
async function decryptBlob(blob, pw) {
  const s = b64d(blob.salt); const ks = await deriveKeys(pw, s);
  const data = await decryptWithKey(blob, ks.key);
  return { key: ks.key, auth: ks.auth, salt: s, data };
}

/* ---------- local + disk storage ---------- */
const LS_KEY = 'crown.vault.v2';
function readLocal() { if (CLOUD) return null; try { const v = localStorage.getItem(LS_KEY); return v ? JSON.parse(v) : null; } catch (_) { return null; } }
function writeLocal(blob) { if (CLOUD) return true; try { localStorage.setItem(LS_KEY, JSON.stringify(blob)); return true; } catch (_) { return false; } }
const validBlob = b => !!(b && !b.erased && typeof b.salt === 'string' && typeof b.iv === 'string' && typeof b.ct === 'string');
let saveTimer = null, saving = false, pendingSave = false, lastSaveOk = true;
function save() { pendingSave = true; setSaveStat('busy', 'Saving…'); clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, CLOUD ? 700 : 400); }
async function saveNow(opts) {
  clearTimeout(saveTimer);
  if (!cryptoKey) return;
  if (saving) { saveTimer = setTimeout(saveNow, 300); return; }
  if (CLOUD && typeof syncing !== 'undefined' && syncing && !(opts && opts.force)) { pendingSave = true; return; } // saved when the email sync finishes
  saving = true; pendingSave = false;
  try {
    if (CLOUD) await cloudSave(opts);
    else {
      const blob = await encryptState(cryptoKey, salt);
      vaultBlob = blob;
      const localOk = writeLocal(blob);
      let diskOk = !SERVER;
      if (SERVER) { try { await api('/api/vault', blob, 'PUT'); diskOk = true; } catch (e) { diskOk = false; } }
      lastSaveOk = localOk && diskOk;
      if (lastSaveOk) setSaveStat('ok', 'Saved ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
      else if (!diskOk) setSaveStat('bad', 'Not saved to disk — is Crown Tools’ window open?');
      else setSaveStat('warn', 'Saved to disk only (browser storage full)');
    }
  } catch (e) { lastSaveOk = false; pendingSave = true; setSaveStat('bad', 'Not saved: ' + e.message); clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 15000); }
  finally { saving = false; }
}

/* ---------- Crown Tools Online: saving, pulling and merging between devices ---------- */
async function cloudSave(opts) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const json = JSON.stringify(state);
    const blob = await encryptJSON(cryptoKey, salt, json);
    try {
      const body = { vault: blob, baseRev: rev };
      if (opts && opts.newAuthKey) body.newAuthKey = opts.newAuthKey;
      const r = await api('/api/vault', body, 'PUT');
      rev = r.rev; baseJSON = json; vaultBlob = blob; lastSaveOk = true;
      if (opts && opts.newAuthKey) authKey = opts.newAuthKey;
      setSaveStat('ok', 'Saved ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
      return;
    } catch (e) {
      if (e.data && e.data.auth) { lock('Your password was changed on another device. Unlock with the new password.'); throw e; }
      if (!(e.data && e.data.conflict)) throw e;
      await pullAndMerge(true); // someone else saved first: fold their changes in, then try again
      if (!cryptoKey) return;
    }
  }
  throw new Error('Too many changes at once from other devices — will retry.');
}
let pulling = false;
async function pullAndMerge(fromSave) {
  if (!CLOUD || !cryptoKey || pulling) return false;
  pulling = true;
  try {
    const r = await api('/api/vault');
    if (!r.vault) return false;
    let remote;
    try { remote = await decryptWithKey(r.vault, cryptoKey); }
    catch (_) { lock('Your password was changed on another device. Unlock with the new password.'); return false; }
    const localJSON = JSON.stringify(state);
    const hasLocal = baseJSON !== null && localJSON !== baseJSON;
    const merged = hasLocal ? mergeStates(JSON.parse(baseJSON), state, remote) : remote;
    state = migrate(merged); dedupeAfterMerge();
    rev = r.rev; baseJSON = JSON.stringify(remote);
    if (JSON.stringify(state) !== baseJSON && !fromSave) save();
    if (typeof invalidateStats === 'function') invalidateStats();
    if (typeof softRefresh === 'function') softRefresh(); else refresh();
    return true;
  } finally { pulling = false; }
}
async function pollRemote() {
  if (!CLOUD || !cryptoKey || saving || pendingSave || pulling || document.visibilityState === 'hidden') return;
  if (typeof syncing !== 'undefined' && syncing) return;
  try { const r = await api('/api/rev'); if (r.rev !== rev) await pullAndMerge(); }
  catch (e) { if (e.data && e.data.auth) lock('Your password was changed on another device. Unlock with the new password.'); }
}
setInterval(pollRemote, 30000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pollRemote(); });

// Three-way merge: base = last version both sides agreed on. Records are matched by id;
// whichever side changed a record wins (newest edit if both did); deletes on either side stick.
function mergeStates(base, local, remote) {
  const J = x => JSON.stringify(x);
  const out = Object.assign({}, remote);
  for (const k of ['categories', 'profiles', 'accounts', 'cardGroups', 'cards', 'orders', 'houses', 'imapAccounts', 'inventory', 'sales', 'expenses']) {
    const b = base[k] || [], l = local[k] || [], r = remote[k] || [];
    const bm = new Map(b.map(x => [x.id, x])), lm = new Map(l.map(x => [x.id, x])), rm = new Map(r.map(x => [x.id, x]));
    const list = [];
    for (const x of r) {
      const bx = bm.get(x.id), lx = lm.get(x.id);
      if (!lx) { if (bx && J(x) === J(bx)) continue; list.push(x); continue; }
      if (J(lx) === J(bx)) list.push(x);
      else if (J(x) === J(bx)) list.push(lx);
      else list.push((lx.updatedAt || 0) >= (x.updatedAt || 0) ? lx : x);
    }
    for (const x of l) if (!rm.has(x.id)) { const bx = bm.get(x.id); if (bx && J(x) === J(bx)) continue; list.push(x); }
    out[k] = list;
  }
  for (const k of ['readerVer', 'ordersVer', 'houseVer', 'etaVer', 'syncVer']) { const v = Math.max(Number(local[k]) || 0, Number(remote[k]) || 0); if (v) out[k] = v; }
  out.settings = Object.assign({}, remote.settings || {});
  for (const k of Object.keys(local.settings || {})) if (J(local.settings[k]) !== J((base.settings || {})[k])) out.settings[k] = local.settings[k];
  const seen = new Set(); out.seenIds = [];
  for (const id of [].concat(remote.seenIds || [], local.seenIds || [])) if (!seen.has(id)) { seen.add(id); out.seenIds.push(id); }
  if (out.seenIds.length > 40000) out.seenIds = out.seenIds.slice(-40000);
  const um = new Map(); for (const u of [].concat(remote.unparsed || [], local.unparsed || [])) if (!um.has(u.messageId)) um.set(u.messageId, u);
  out.unparsed = J(local.unparsed) === J(base.unparsed) ? (remote.unparsed || []) : (J(remote.unparsed) === J(base.unparsed) ? (local.unparsed || []) : [...um.values()].slice(0, 200));
  const lg = new Map(); for (const x of [].concat(remote.syncLog || [], local.syncLog || [])) lg.set(x.at + '|' + x.label, x);
  out.syncLog = [...lg.values()].sort((a, b) => b.at - a.at).slice(0, 60);
  return out;
}
// Two devices syncing the same inbox at once can each create the same order - fold duplicates together.
function dedupeAfterMerge() {
  if (typeof Parser === 'undefined') return;
  if (typeof mergeSameNumber === 'function') { mergeSameNumber(); dedupeHousesOnly(); return; }
  const byNo = new Map(), drop = new Set();
  for (const o of state.orders) {
    const k = Parser.normOrderNo(o.orderNumber); if (!k) continue;
    const key = k + '|' + (o.store || '');
    const keep = byNo.get(key);
    if (!keep) { byNo.set(key, o); continue; }
    for (const m of o.messageIds || []) if (!keep.messageIds.includes(m)) keep.messageIds.push(m);
    for (const e of o.emails || []) if (!keep.emails.some(x => x.messageId === e.messageId)) keep.emails.push(e);
    for (const h of o.history || []) if (!keep.history.some(x => x.date === h.date && x.status === h.status)) keep.history.push(h);
    keep.history.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (typeof STATUS !== 'undefined' && (STATUS[o.status] || {}).r > (STATUS[keep.status] || {}).r) keep.status = o.status;
    for (const f of ['total', 'eta', 'deliveredAt', 'name', 'addr1', 'addr2', 'city', 'state', 'zip', 'recipientEmail', 'last4', 'profileId', 'profileLink', 'houseId', 'notes']) if ((keep[f] == null || keep[f] === '') && o[f]) keep[f] = o[f];
    if (!keep.items.length && o.items.length) keep.items = o.items;
    for (const t of o.tracking || []) if (!keep.tracking.some(x => x.number === t.number)) keep.tracking.push(t);
    drop.add(o.id);
  }
  if (drop.size) state.orders = state.orders.filter(o => !drop.has(o.id));
  dedupeHousesOnly();
}
function dedupeHousesOnly() {
  const hk = new Map(), remap = new Map();
  for (const h of state.houses) for (const k of h.keys || []) { if (hk.has(k) && hk.get(k) !== h) remap.set(h.id, hk.get(k)); else hk.set(k, h); }
  if (remap.size) {
    for (const [from, to] of remap) { const fh = state.houses.find(h => h.id === from); if (fh) { to.keys = Array.from(new Set([...(to.keys || []), ...(fh.keys || [])])); if (!to.nickname) to.nickname = fh.nickname; if (!to.discord && fh.discord) to.discord = fh.discord; if (fh.notes && !to.notes) to.notes = fh.notes; } }
    state.orders.forEach(o => { if (remap.has(o.houseId)) o.houseId = remap.get(o.houseId).id; });
    state.houses = state.houses.filter(h => !remap.has(h.id));
  }
}
function setSaveStat(kind, text) { const el = $('#saveStat'); if (el) el.innerHTML = `<span class="dot ${kind}"></span><span class="ellipsis">${esc(text)}</span>`; }
window.addEventListener('beforeunload', e => { if (cryptoKey && (pendingSave || saving)) { saveNow({ force: true }); e.preventDefault(); e.returnValue = ''; } });

/* ---------- undo (last action) ---------- */
let lastUndo = null;
function snapshot(label) { lastUndo = { label, json: JSON.stringify(state) }; }
function undo() {
  if (!lastUndo) return;
  state = migrate(JSON.parse(lastUndo.json)); const l = lastUndo.label; lastUndo = null;
  if (typeof selected !== 'undefined') selected.clear();
  save(); refresh(); toast('Undid: ' + l);
}
function toast(msg, opts) {
  const t = $('#toast'); $('#toastMsg').textContent = msg;
  const b = $('#toastBtn'); b.hidden = !(opts && opts.undo && lastUndo);
  b.onclick = () => { t.classList.remove('show'); undo(); };
  t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), opts && opts.undo ? 7000 : 2800);
}
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500); }

/* ---------- CSV ---------- */
function parseDelimited(text) {
  text = String(text || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const first = text.split('\n')[0];
  const d = first.includes('\t') ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"' && cell === '') q = true;
    else if (c === d) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}
const csvCell = v => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) || /^[=+\-@]/.test(v) && isNaN(Number(v)) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const toCSV = (cols, rows) => [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\n');
const stamp = () => dayKey(new Date());

const isPhone = () => window.matchMedia('(max-width:760px)').matches;
const isCompact = () => window.matchMedia('(max-width:1100px)').matches; // phones + tablets: lists are cards, tap selects in Select mode
// re-draw when a window crosses between phone and desktop layouts (rotating an iPad, resizing a Windows/Mac window)
window.matchMedia('(max-width:760px)').addEventListener('change', () => { if (typeof refresh === 'function') try { refresh(); } catch (_) { } });
/* ---------- dialogs ---------- */
// Crown Tools' own yes/no and type-a-name boxes. The browser's built-in confirm()/prompt() pop-ups are blocked or
// skipped in some places (iPhone home-screen apps, in-app browsers), which made buttons silently do nothing.
let askQueue = Promise.resolve();
function ask(text, opts) { return askBox(Object.assign({ text }, opts || {})).then(v => v !== null); }
function askText(text, value, opts) { return askBox(Object.assign({ text, input: true, value: value || '' }, opts || {})).then(v => v === null ? null : v); }
function askBox(o) {
  const run = () => new Promise(resolve => {
    const d = document.getElementById('dlgAsk'); let result = null;
    const lines = String(o.text || '').split('\n\n'); const title = o.title || (lines.length > 1 ? lines.shift() : (o.input ? '' : 'Are you sure?'));
    $('#askTitle').textContent = title || (o.input ? lines.shift() : '');
    $('#askText').innerHTML = lines.filter(Boolean).map(l => `<p>${esc(l).replace(/\n/g, '<br>')}</p>`).join('');
    const inp = $('#askInput'); inp.hidden = !o.input; inp.value = o.value || ''; inp.placeholder = o.placeholder || '';
    const ok = $('#askOk'); ok.textContent = o.ok || (o.input ? 'Save' : 'OK'); ok.className = 'primary' + (o.danger || /delete|remove|erase/i.test(o.text) && !o.input ? ' dangerbtn' : '');
    const done = v => { result = v; d.close(); };
    ok.onclick = () => done(o.input ? inp.value : true);
    $('#askCancel').onclick = () => done(null);
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); done(inp.value); } };
    d.onclose = () => resolve(result);
    d.showModal(); setTimeout(() => (o.input ? inp : ok).focus(), 30);
  });
  const p = askQueue.then(run); askQueue = p.catch(() => { }); return p;
}
function openDlg(id) { const d = document.getElementById(id); if (!d.open) d.showModal(); return d; }
function closeDlg(id) { const d = document.getElementById(id); if (d.open) d.close(); }
document.addEventListener('click', e => { const b = e.target.closest('[data-close]'); if (b) b.closest('dialog').close(); });
document.addEventListener('mousedown', e => { if (e.target.tagName === 'DIALOG' && e.target.open) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target._outside = true; } });
document.addEventListener('mouseup', e => { if (e.target.tagName === 'DIALOG' && e.target._outside) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); } $$('dialog').forEach(d => d._outside = false); });

/* ---------- navigation ---------- */
const ICONS = {
  dashboard: '<path d="M3 3h8v10H3zM13 3h8v6h-8zM13 11h8v10h-8zM3 15h8v6H3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  profiles: '<circle cx="9" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 010 7M18 14.6c1.8.7 3 2.5 3.5 5.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  orders: '<path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z M3.5 7.5L12 12l8.5-4.5M12 12v9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  houses: '<path d="M3 11l9-7 9 7M5 9.5V20h5v-6h4v6h5V9.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  spending: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  inboxes: '<path d="M3 13l2.5-8h13L21 13v6H3z M3 13h5l1.5 2.5h5L16 13h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  more: '<circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/>',
  news: '<path d="M12 3l2.5 5.5L20 9.3l-4 4 1 5.7-5-2.8-5 2.8 1-5.7-4-4 5.5-.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M8.5 10.5V7.8a3.5 3.5 0 017 0v2.7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  inventory: '<path d="M4 8.5L12 4l8 4.5v7L12 20l-8-4.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M4 8.5l8 4.5 8-4.5M12 13v7M8 6.3l8 4.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  sales: '<path d="M3 17l5.5-5.5 4 4L21 7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 7h6v6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  accounts: '<rect x="3.5" y="5" width="17" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="11" r="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5.8 16.2c.6-1.7 1.8-2.5 3.2-2.5s2.6.8 3.2 2.5M14.5 10h3.5M14.5 13.5h3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  cards: '<rect x="3" y="5.5" width="18" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 9.5h18M6.5 14.5h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  checkin: '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 12.3l2.4 2.4 4.8-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  settings: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
};
// Pages are grouped into a few hubs. The phone shows one bottom tab per hub, with the hub's pages as sub-tabs;
// computers show the hubs as sidebar sections. Keeps the bottom bar short instead of a long "More" list.
const HUBS = [
  { k: 'home', l: 'Home', side: '', icon: 'dashboard', pages: [['dashboard', 'Dashboard']] },
  { k: 'checkout', l: 'Checkout', side: 'Checkout', icon: 'profiles', pages: [['profiles', 'Profiles'], ['accounts', 'Accounts'], ['cards', 'Cards']] },
  { k: 'track', l: 'Orders', side: 'Orders & tracking', icon: 'orders', pages: [['orders', 'Orders'], ['calendar', 'Calendar'], ['houses', 'Houses'], ['checkin', 'Check-in']] },
  { k: 'resell', l: 'Resell', side: 'Reselling', icon: 'inventory', pages: [['inventory', 'Inventory'], ['sales', 'Sales'], ['spending', 'Spending']] },
  { k: 'setup', l: 'More', side: 'Setup', icon: 'more', pages: [['inboxes', 'Inboxes'], ['settings', 'Settings']] },
];
const NAV = HUBS.flatMap(h => h.pages);
const PAGE_LABEL = Object.fromEntries(NAV);
const hubOf = p => (HUBS.find(h => h.pages.some(x => x[0] === p)) || HUBS[0]).k;
const hubByKey = k => HUBS.find(h => h.k === k) || HUBS[0];
const hubLast = {};
const PAGES = {};
let route = { page: 'dashboard', arg: '' };
function go(page, arg) { const h = '#' + page + (arg ? '/' + arg : ''); if (location.hash !== h) location.hash = h; else applyRoute(); }
function applyRoute() {
  const [p, a] = (location.hash.slice(1) || 'dashboard').split('/');
  route = { page: PAGES[p] ? p : 'dashboard', arg: a ? decodeURIComponent(a) : '' };
  hubLast[hubOf(route.page)] = route.page;
  $$('#main > section.page').forEach(s => s.hidden = s.dataset.page !== route.page);
  renderNav(); renderPage(); $('#main').scrollTop = 0;
}
window.addEventListener('hashchange', () => { if (cryptoKey) applyRoute(); });
function navCounts() { return { profiles: state.profiles.length, orders: state.orders.length, houses: state.houses.filter(h => houseOrders(h.id).length).length, inboxes: state.imapAccounts.length, inventory: sum(state.inventory || [], i => Math.max(0, Number(i.qty) || 0)), accounts: (state.accounts || []).length, cards: (state.cards || []).length }; }
const navItem = (k, l, counts) => `<button class="navitem ${route.page === k ? 'active' : ''}" data-nav="${k}"><svg viewBox="0 0 24 24">${ICONS[k]}</svg>${l}${counts[k] ? `<span class="count">${counts[k]}</span>` : ''}</button>`;
function renderNav() {
  const counts = navCounts();
  // computer sidebar: each hub is a section
  $('#navlist').innerHTML = HUBS.map(h => (h.side ? `<div class="navgroup">${h.side}</div>` : '') + h.pages.map(([k, l]) => navItem(k, l, counts)).join('')).join('');
  // phone bottom bar: one tab per hub
  const curHub = hubOf(route.page);
  $('#tabbar').innerHTML = HUBS.map(h => `<button class="tabitem ${curHub === h.k ? 'active' : ''}" data-hub="${h.k}" aria-label="${h.l}"><svg viewBox="0 0 24 24">${ICONS[h.icon]}</svg><span>${h.l}</span></button>`).join('');
  // phone sub-tabs: the current hub's pages
  const hub = hubByKey(curHub), sn = $('#subnav');
  if (sn) { sn.hidden = hub.pages.length < 2; sn.innerHTML = hub.pages.length < 2 ? '' : hub.pages.map(([k, l]) => `<button class="subtab ${route.page === k ? 'on' : ''}" data-nav="${k}">${l}${counts[k] ? `<span class="n">${counts[k]}</span>` : ''}</button>`).join(''); }
}
function openHub(k) { const h = hubByKey(k); const last = hubLast[k]; go(last && h.pages.some(p => p[0] === last) ? last : h.pages[0][0]); }
// Page action buttons sit after the header's spacer. Group them so phones can show them as one swipeable row.
function wrapActs(root) {
  (root || document).querySelectorAll('.pagehead').forEach(ph => {
    if (ph.querySelector(':scope > .pacts')) return;
    const sp = ph.querySelector(':scope > .spacer'); if (!sp) return;
    const acts = []; for (let n = sp.nextElementSibling; n; n = n.nextElementSibling) acts.push(n);
    if (!acts.length) return;
    const box = document.createElement('div'); box.className = 'pacts'; acts.forEach(a => box.appendChild(a)); ph.appendChild(box);
  });
}
new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.matches('.pagehead') || n.querySelector('.pagehead'))) { wrapActs(m.target); return; } }).observe(document.getElementById('main') || document.body, { childList: true, subtree: true });
function renderPage() { try { PAGES[route.page].render(route.arg); wrapActs($('#pg-' + route.page)); } catch (e) { console.error(e); $('#pg-' + route.page).innerHTML = `<div class="note bad">Something went wrong showing this page: ${esc(e.message)}</div>`; } }
function refresh() { if (!cryptoKey) return; renderNav(); renderPage(); }
document.addEventListener('click', e => {
  const hb = e.target.closest('[data-hub]'); if (hb) { openHub(hb.dataset.hub); return; }
  const n = e.target.closest('[data-nav]'); if (n) { const [p, a] = n.dataset.nav.split('/'); if ((n.classList.contains('navitem') || n.classList.contains('subtab')) && typeof resetPageFilters === 'function') resetPageFilters(p); go(p, a); }
});

/* ---------- lock / unlock ---------- */
const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('crown') : null;
const TAB_ID = uid();
if (bc) bc.onmessage = e => { if (e.data && e.data.type === 'unlocked' && e.data.tab !== TAB_ID && cryptoKey && !CLOUD) { lock('Crown Tools was unlocked in another tab, so this tab locked itself to keep your data in sync.'); } };
async function loadBlob() {
  const local = readLocal(); let remote = null;
  if (SERVER && !CLOUD) { try { remote = (await api('/api/vault')).vault; } catch (_) { } }
  const cands = [remote, local].filter(validBlob);
  cands.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  vaultBlob = cands[0] || null;
  return cands;
}
function lockMode() { return CLOUD ? (pendingRestore ? 'restore' : cloudExists ? 'unlock' : 'create') : (vaultBlob ? 'unlock' : 'create'); }
function renderLockUI() {
  const mode = lockMode();
  $('#pw2wrap').hidden = mode !== 'create';
  $('#codeWrap').hidden = !(CLOUD && (mode === 'create' || mode === 'restore'));
  $('#resetBtn').hidden = mode !== 'unlock';
  $('#lockRestore').hidden = CLOUD && mode !== 'create';
  $('#lockCancelRestore').hidden = mode !== 'restore';
  $('#lockSub').textContent = mode === 'unlock' ? 'Enter your password to unlock.'
    : mode === 'restore' ? 'Enter the password this backup was made with' + (CLOUD ? ', plus your setup code.' : '.')
      : CLOUD ? 'Welcome to Crown Tools Online. Enter your setup code and create a password. Everything is encrypted with your password on this device before it’s saved — it can’t be recovered, so pick one you’ll remember.'
        : 'Create a password. Everything in Crown Tools is encrypted with it. It can’t be recovered, so pick one you’ll remember.';
  $('#lockBtn').textContent = mode === 'unlock' ? 'Unlock' : mode === 'restore' ? 'Restore & open' : 'Create & open';
  $('#lockBtn').disabled = false;
}
async function setupLock(msg) {
  if (CLOUD && cloudInfo.accounts && typeof Account !== 'undefined') { Account.show(msg); return; }
  $('#app').hidden = true; $('#lock').hidden = false;
  $('#pw1').value = ''; $('#pw2').value = ''; $('#lockErr').textContent = msg || '';
  if (!window.crypto || !crypto.subtle) { $('#lockSub').textContent = CLOUD ? 'This browser can’t encrypt here. Update your browser (Safari, Chrome or Edge).' : 'This browser can’t encrypt here. Open Crown Tools in Chrome, Edge or Safari using Start Crown Tools.'; return; }
  if (CLOUD) {
    try { const s = await api('/api/salt'); cloudExists = !!s.exists; }
    catch (e) { $('#lockSub').textContent = e.message; $('#lockBtn').disabled = true; return; }
  } else await loadBlob();
  renderLockUI();
  setTimeout(() => { if (!/(iPad|iPhone)/.test(navigator.userAgent)) $('#pw1').focus(); }, 60);
}
async function doUnlock() {
  const pw = $('#pw1').value; $('#lockErr').textContent = '';
  const mode = lockMode();
  if (!pw) { $('#lockErr').textContent = 'Enter your password.'; return; }
  const code = ($('#setupCode').value || '').trim();
  if (CLOUD && (mode === 'create' || mode === 'restore') && !code) { $('#lockErr').textContent = 'Enter your setup code.'; return; }
  $('#lockBtn').disabled = true; $('#lockBtn').textContent = mode === 'unlock' ? 'Unlocking…' : mode === 'restore' ? 'Restoring…' : 'Creating…';
  try {
    if (mode === 'restore') {
      let out; try { out = await decryptBlob(pendingRestore, pw); } catch (_) { throw new Error('That password doesn’t open this backup.'); }
      if (CLOUD) {
        const blob = Object.assign({}, pendingRestore, { savedAt: Date.now() });
        await api('/api/setup', { code, authKey: out.auth, vault: blob });
        authKey = out.auth; rev = 1; baseJSON = JSON.stringify(out.data);
      }
      cryptoKey = out.key; salt = out.salt; state = migrate(out.data); pendingRestore = null; cloudExists = true;
      if (CLOUD) baseJSON = JSON.stringify(state); else await saveNow();
    } else if (mode === 'create') {
      if (pw.length < 6) throw new Error('Use at least 6 characters.');
      if (pw !== $('#pw2').value) throw new Error('Passwords don’t match.');
      salt = crypto.getRandomValues(new Uint8Array(16)); const ks = await deriveKeys(pw, salt);
      state = blankState();
      if (CLOUD) {
        const json = JSON.stringify(state); const blob = await encryptJSON(ks.key, salt, json);
        const r = await api('/api/setup', { code, authKey: ks.auth, vault: blob });
        authKey = ks.auth; rev = r.rev; baseJSON = json; cloudExists = true; cryptoKey = ks.key;
      } else { cryptoKey = ks.key; await saveNow(); }
    } else if (CLOUD) {
      const s = await api('/api/salt'); if (!s.exists) { cloudExists = false; renderLockUI(); throw new Error('Crown Tools Online has no data yet — set it up first.'); }
      salt = b64d(s.salt); const ks = await deriveKeys(pw, salt);
      authKey = ks.auth;
      let r; try { r = await api('/api/vault'); } catch (e) { authKey = null; throw e; }
      let data; try { data = await decryptWithKey(r.vault, ks.key); } catch (_) { authKey = null; throw new Error('Wrong password.'); }
      cryptoKey = ks.key; salt = b64d(r.vault.salt); state = migrate(data); rev = r.rev; baseJSON = JSON.stringify(data);
    } else {
      const cands = await loadBlob(); let out = null;
      for (const c of cands) { try { out = await decryptBlob(c, pw); break; } catch (_) { } }
      if (!out) throw new Error('Wrong password.');
      cryptoKey = out.key; salt = out.salt; state = migrate(out.data);
      if (cands[0] && out && cands.length > 1) save(); // re-sync both copies
    }
    if (bc) bc.postMessage({ type: 'unlocked', tab: TAB_ID });
    $('#setupCode').value = '';
    $('#lock').hidden = true; $('#app').hidden = false; $('#noServerBanner').hidden = SERVER;
    lastActivity = Date.now(); applyRoute(); if (typeof onUnlocked === 'function') onUnlocked();
  } catch (e) { cryptoKey = null; if (CLOUD && mode !== 'unlock') authKey = null; $('#lockErr').textContent = e.message; }
  finally { renderLockUI(); }
}
async function lock(msg) {
  if (cryptoKey && (pendingSave || saving)) { try { await saveNow({ force: true }); } catch (_) { } }
  cryptoKey = null; authKey = null; baseJSON = null; rev = 0; state = blankState(); lastUndo = null;
  if (typeof selected !== 'undefined') selected.clear();
  $$('dialog').forEach(d => d.open && d.close());
  if (typeof onLocked === 'function') onLocked();
  if (CLOUD && cloudInfo.accounts && typeof Account !== 'undefined') { acctEmail = null; Account.signOut(); Account.show(msg); return; }
  setupLock(msg);
}
let lastActivity = Date.now();
['mousemove', 'keydown', 'mousedown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true }));
setInterval(() => { const m = state.settings && state.settings.autoLockMin; if (cryptoKey && m && Date.now() - lastActivity > m * 60000) lock('Locked after ' + m + ' minutes of inactivity.'); }, 20000);

function askPassword(title, text) {
  return new Promise(resolve => {
    $('#apTitle').textContent = title; $('#apText').textContent = text; $('#apPw').value = ''; $('#apErr').textContent = '';
    const d = openDlg('dlgAskPw'); setTimeout(() => $('#apPw').focus(), 50);
    const done = v => { d.onclose = null; if (d.open) d.close(); resolve(v); };
    $('#apGo').onclick = () => done($('#apPw').value);
    $('#apPw').onkeydown = e => { if (e.key === 'Enter') done($('#apPw').value); };
    d.onclose = () => resolve(null);
  });
}
async function restoreFromBlob(blob) {
  if (!validBlob(blob)) throw new Error('That file isn’t a Crown Tools or Profile Manager backup.');
  if (CLOUD && !cryptoKey) { pendingRestore = blob; $('#lockErr').textContent = ''; renderLockUI(); return true; }
  if (!await ask('Replace everything currently in Crown Tools with this backup?\n\nYou’ll unlock it with the password that backup was made with.')) return false;
  if (CLOUD) {
    const pw = await askPassword('Restore backup', 'Enter the password this backup was made with.');
    if (pw == null) return false;
    let out; try { out = await decryptBlob(blob, pw); } catch (_) { throw new Error('That password doesn’t open this backup.'); }
    await api('/api/restore', { vault: Object.assign({}, blob, { savedAt: Date.now() }), newAuthKey: out.auth });
    cryptoKey = null; authKey = null; baseJSON = null; state = blankState();
    await lock('Backup restored — unlock with the password it was made with.');
    return true;
  }
  blob = Object.assign({}, blob, { savedAt: Date.now() });
  writeLocal(blob);
  if (SERVER) await api('/api/vault', blob, 'PUT');
  cryptoKey = null; await setupLock('Backup restored — enter the password it was made with.');
  return true;
}

/* ---------- boot ---------- */
const Crown = {
  async boot() {
    $('#verLbl').textContent = 'v' + VERSION; $('#verLbl').title = 'What’s new'; $('#verLbl').style.cursor = 'pointer'; $('#verLbl').onclick = e => { e.stopPropagation(); openChangelog(); };
    if (location.protocol.startsWith('http')) {
      try { const p = await api('/api/ping'); SERVER = true; CLOUD = !!p.cloud; cloudInfo = p; } catch (_) { SERVER = false; }
    }
    document.documentElement.classList.toggle('cloud', CLOUD);
    $('#lockBtn').onclick = doUnlock;
    ['#pw1', '#pw2', '#setupCode'].forEach(s => $(s).addEventListener('keydown', e => { if (e.key === 'Enter') doUnlock(); }));
    $('#resetBtn').onclick = async () => {
      if (CLOUD) {
        const code = await askText('Forgot your password?\n\nThis permanently erases ALL Crown Tools Online data (profiles, orders, inboxes and online backups). Enter your setup code to continue:');
        if (!code) return;
        if (!await ask('Last chance — erase everything in Crown Tools Online?', { ok: 'Erase everything', danger: true })) return;
        try { await api('/api/reset', { code }); cloudExists = false; setupLock('Everything was erased. Set Crown Tools up again below.'); } catch (e) { $('#lockErr').textContent = e.message; }
        return;
      }
      if (!await ask('This permanently erases ALL Crown Tools data on this computer (profiles, orders, inboxes).\n\nOnly do this if you can’t remember your password. Continue?')) return;
      if (!await ask('Last chance — erase everything?', { ok: 'Erase everything', danger: true })) return;
      try { localStorage.removeItem(LS_KEY); } catch (_) { }
      if (SERVER) { try { await api('/api/vault', { app: 'crown', v: 2, salt: 'x', iv: 'x', ct: 'x', erased: true, savedAt: Date.now() }, 'PUT'); } catch (_) { } }
      vaultBlob = null; setupLock();
    };
    $('#lockRestore').onclick = () => $('#lockRestoreFile').click();
    $('#lockCancelRestore').onclick = () => { pendingRestore = null; $('#lockErr').textContent = ''; renderLockUI(); };
    $('#lockRestoreFile').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { await restoreFromBlob(JSON.parse(await f.text())); } catch (err) { $('#lockErr').textContent = err.message.includes('JSON') ? 'That file isn’t a Crown Tools backup.' : err.message; } };
    $('#lockNow').onclick = () => lock();
    document.addEventListener('keydown', e => {
      if (!cryptoKey) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && lastUndo) { e.preventDefault(); undo(); }
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !$$('dialog').some(d => d.open)) {
        const s = route.page === 'profiles' ? $('#search') : $('#pg-' + route.page + ' input[data-search]'); if (s) { e.preventDefault(); s.focus(); }
      }
    });
    if (CLOUD && cloudInfo.accounts && typeof Account !== 'undefined') await Account.boot(); else await setupLock();
  },
};

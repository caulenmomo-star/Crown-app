/* Crown Tools - bot checkouts from Discord. A Discord bot in your server reads the channel(s) your checkout bots
   (Valor, Shikari, Hayha, Stellar…) post to. Each successful checkout is linked to its order (by order number), its
   profile (by profile name), the profile's house and the store account (by email). A checkout whose profile isn't
   one of yours (a client's) waits until a matching order email turns up, so it never counts as your order on its own. */
'use strict';
const BOT_NAMES = { valor: 'Valor', shikari: 'Shikari', hayha: 'Hayha', stellar: 'Stellar', aycd: 'AYCD', cyber: 'Cyber', other: 'Bot' };
const botLabel = b => BOT_NAMES[b] || 'Bot';
const DSC = { busy: false, lastRun: 0, timer: 0, note: '' };

/* ---------- reading one Discord post ---------- */
const HTML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#8212': '—', '#8211': '–', '#8217': '’', '#8216': '‘', '#233': 'é', '#174': '®', '#8482': '™' };
const dDecode = t => String(t == null ? '' : t).replace(/&(#?\w+);/g, (m, c) => HTML_ENT[c] != null ? HTML_ENT[c] : /^#\d+$/.test(c) ? String.fromCharCode(+c.slice(1)) : m);
// Discord markdown off: spoilers ||x||, **bold**, `code`, [text](link), <links>
const dClean = v => dDecode(v).replace(/\|\|/g, '').replace(/\*\*|__|~~|`/g, '').replace(/\[([^\]]+)\]\((?:https?:)?[^)]*\)/g, '$1').replace(/<(https?:[^>]+)>/g, '$1').replace(/\s+/g, ' ').trim();
const D_KEYS = {
  site: ['site', 'store', 'retailer', 'website', 'module'], item: ['product', 'item', 'product name', 'items', 'title'], price: ['price', 'total', 'order total', 'amount'],
  qty: ['quantity', 'qty'], order: ['order number', 'order #', 'order id', 'order', 'order no', 'order no.', 'confirmation', 'order#'], profile: ['profile', 'profile name', 'billing profile'],
  account: ['email', 'account', 'account email', 'login'], mode: ['mode', 'task mode'], size: ['size', 'variant'], sku: ['sku', 'pid', 'tcin'],
};
const D_LOOKUP = {}; for (const [k, arr] of Object.entries(D_KEYS)) arr.forEach(a => D_LOOKUP[a] = k);
function dFields(e) { const out = {}; for (const f of e.fields || []) { const k = D_LOOKUP[String(f.name || '').toLowerCase().replace(/[:*_`|]/g, '').trim()]; const v = dClean(f.value); if (k && v && !(k in out) && !/^(n\/a|none|-|—)$/i.test(v)) out[k] = v; } return out; }
function dBot(m, e, f) {
  const names = (e.fields || []).map(x => String(x.name || '').toLowerCase()).join('|');
  if (/anti-cancel|used shape|proxy group|harvester proxy/.test(names)) return 'hayha'; // Hayha posts through a "Stellar Checkout" webhook
  const hay = [m.author, e.author, e.footer, e.title].join(' ').toLowerCase();
  for (const k of ['hayha', 'shikari', 'valor', 'stellar', 'aycd', 'cyber']) if (hay.includes(k)) return k;
  return 'other';
}
function dKind(e, f) {
  const hay = (e.title + ' ' + e.author + ' ' + e.description).toLowerCase();
  if (/declin|fail|error|out of stock|oos\b|carted|payment (issue|failed)/.test(e.title.toLowerCase() + ' ' + e.author.toLowerCase())) return 'fail';
  if (/checked out|successful checkout|checkout success|success|order placed|placed order|checkout complete/.test(hay)) return 'success';
  return f.order ? 'success' : '';
}
// -> list of checkouts found in one message (usually one)
function parseDiscordPost(m) {
  const out = [];
  (m.embeds || []).forEach((e0, i) => {
    const e = { title: e0.title || '', description: e0.description || '', author: e0.author || '', footer: e0.footer || '', fields: e0.fields || [], thumb: e0.thumb || '' };
    const f = dFields(e); const kind = dKind(e, f); if (kind !== 'success') return;
    let item = f.item || '', price = f.price ? Number(String(f.price).replace(/[^0-9.]/g, '')) : null;
    const ip = item.match(/^(.*?)\s*[-–—]\s*\$\s*([\d,]+(?:\.\d+)?)\s*$/); if (ip) { item = ip[1].trim(); if (price == null) price = Number(ip[2].replace(/,/g, '')); }
    if (!item && e.description) { const d = String(e.description).split(/\n/).map(dClean).find(Boolean) || ''; if (d && d.length < 200 && !/checked out|success/i.test(d)) item = d; } // Shikari: product link in the description
    const qty = Math.max(1, parseInt(f.qty, 10) || 1);
    const order = f.order ? (String(f.order).match(/[A-Z0-9][A-Z0-9\-]{4,}/i) || [''])[0] : '';
    out.push({
      id: m.id + (i ? ':' + i : ''), msg: m.id, ch: m.channel, at: m.at || '', bot: dBot(m, e, f),
      store: f.site ? storeFromText(f.site) : 'other', storeText: f.site || '', item: item + (f.size && !/^(n\/a|one size|os)$/i.test(f.size) && !/^\d{6,}$/.test(f.size) ? ' — ' + f.size : ''),
      price: Number.isFinite(price) ? price : null, qty, order, profile: f.profile || '', account: (f.account || '').toLowerCase(), mode: f.mode || '', image: e.thumb || '', orderId: '',
    });
  });
  return out;
}

/* ---------- linking a checkout to orders, profiles, houses and accounts ---------- */
function linkCheckout(c) {
  const prof = c.profile ? profileByName(c.profile) : null;
  let o = c.order ? findOrder(c.order, c.store) : null;
  if (!o && c.orderId) o = state.orders.find(x => x.id === c.orderId) || null;
  if (!o && !prof) return null; // not one of your profiles: wait for the order email so a client's checkout never counts as yours
  if (!o) {
    o = newOrder({ orderNumber: c.order, store: c.store, source: 'bot', orderDate: c.at || new Date().toISOString(), history: [] });
    setStatus(o, 'placed', o.orderDate, 'bot', `${botLabel(c.bot)} checkout (Discord)`); state.orders.push(o);
  }
  o.bot = { bot: c.bot, mode: c.mode, profile: c.profile, account: c.account, at: c.at, msg: c.msg, ch: c.ch };
  // bots post the price of one unit
  if (c.item && !(o.items || []).length) o.items = [{ name: c.item, qty: c.qty, price: c.price, image: c.image || '' }];
  if (c.price != null && o.total == null) o.total = Math.round(c.price * c.qty * 100) / 100;
  if (c.store !== 'other' && (!o.store || o.store === 'other')) o.store = c.store;
  if (c.account && /@/.test(c.account) && !o.recipientEmail) o.recipientEmail = c.account;
  if (prof && (!o.profileId || o.profileLink !== 'manual')) { o.profileId = prof.id; o.profileLink = 'bot'; }
  if (prof && !o.addr1 && prof.shipAddr1) Object.assign(o, { name: o.name || shipName(prof), addr1: prof.shipAddr1, addr2: prof.shipAddr2, city: prof.shipCity, state: prof.shipState, zip: prof.shipZip });
  const acc = c.account && (state.accounts || []).find(a => String(a.email || '').toLowerCase() === c.account && (a.store === o.store || a.store === 'custom'));
  if (acc) { o.accountId = acc.id; if (acc.profileId == null || acc.profileId === '') { if (prof) { acc.profileId = prof.id; acc.updatedAt = Date.now(); } } }
  if (!o.profileId) autoLink(o);
  resolveHouse(o); o.updatedAt = Date.now();
  c.orderId = o.id;
  return o;
}
// checkouts still waiting: try again (after new order emails, or after you add the profile)
function relinkCheckouts() {
  let n = 0;
  for (const c of state.botCheckouts || []) if (!c.orderId) { if (linkCheckout(c)) { c.updatedAt = Date.now(); n++; } }
  if (n) { invalidateStats(); save(); }
  return n;
}
function ingestPosts(msgs) {
  const have = new Set((state.botCheckouts || []).map(c => c.id)); let added = 0, linked = 0;
  for (const m of msgs) for (const c of parseDiscordPost(m)) {
    if (have.has(c.id)) continue; have.add(c.id);
    c.updatedAt = Date.now(); state.botCheckouts.push(c); added++;
    if (linkCheckout(c)) linked++;
  }
  if (state.botCheckouts.length > 6000) state.botCheckouts = state.botCheckouts.slice(-6000);
  return { added, linked };
}

/* ---------- reading the channels ---------- */
const dToken = () => String(state.settings.discordToken || '').trim();
async function syncDiscord(manual) {
  if (!cryptoKey || !SERVER || DSC.busy) return;
  const feeds = (state.discordFeeds || []).filter(f => f.enabled !== false);
  if (!dToken() || !feeds.length) { if (manual) toast('Add your Discord bot token and a channel first'); return; }
  DSC.busy = true; DSC.lastRun = Date.now(); if (route.page === 'inboxes') softRefresh();
  let added = 0, linked = 0;
  try {
    for (const f of feeds) {
      try {
        for (let round = 0; round < 6; round++) {
          const since = dayKey(new Date(Date.now() - (state.settings.discordLookback || 30) * 864e5));
          const r = await api('/api/discord/read', { token: dToken(), channel: f.id, after: f.lastId || '', since, maxPages: 10 });
          if (!cryptoKey) return;
          const res = ingestPosts(r.messages || []); added += res.added; linked += res.linked;
          f.count = (f.count || 0) + res.added; if (r.last) f.lastId = r.last;
          if (!r.more) break;
        }
        f.error = ''; f.lastSync = Date.now();
      } catch (e) { f.error = e.message; }
      f.updatedAt = Date.now();
    }
    linked += relinkCheckouts();
  } finally { DSC.busy = false; }
  invalidateStats(); save(); refresh();
  if (manual) toast(added ? `Read ${plural(added, 'checkout')} from Discord${linked ? ` · ${linked} linked to orders` : ''}` : 'No new checkouts on Discord');
}
// same rhythm as email ("Automatic sync"), checked every minute while Crown Tools is open
setInterval(() => {
  if (!cryptoKey || document.visibilityState === 'hidden') return;
  const m = state.settings.autoSyncMin; if (!m) return;
  if (Date.now() - DSC.lastRun >= m * 60000) syncDiscord(false);
}, 60000);

/* ---------- the Discord card on the Inboxes page ---------- */
function discordCard() {
  const feeds = state.discordFeeds || [], cs = state.botCheckouts || [], has = !!dToken();
  const linkedN = cs.filter(c => c.orderId).length, waiting = cs.filter(c => !c.orderId);
  const recent = cs.slice(-12).reverse();
  return `<div class="card" id="dscCard" style="margin-bottom:14px"><h3>🤖 Bot checkouts from Discord<span class="spacer"></span>${has && feeds.length ? `<button class="sm" id="dscSync" ${DSC.busy || !SERVER ? 'disabled' : ''}>${DSC.busy ? 'Reading…' : 'Check Discord now'}</button>` : ''}</h3>
    <div class="small muted" style="margin-bottom:10px">Reads the success posts Valor, Shikari, Hayha and Stellar send to your Discord, and links each one to its order, profile, house and store account. A checkout on a profile that isn’t in Crown Tools (a client’s) waits until its order email shows up.</div>
    <details class="dschow" ${has ? '' : 'open'}><summary>How to connect it</summary><ol class="small">
      <li>Use the Discord bot that’s already in your server (the one your ACO site uses), or make one: <b>discord.com/developers</b> → New Application → <b>Bot</b> → turn on <b>Message Content Intent</b> → <b>Reset Token</b> and copy it.</li>
      <li>If it’s a new bot: <b>OAuth2 → URL Generator</b> → tick <b>bot</b>, then <b>View Channels</b> and <b>Read Message History</b> → open the link and add it to your server.</li>
      <li>In Discord, turn on <b>Settings → Advanced → Developer Mode</b>, right-click your checkout channel → <b>Copy Channel ID</b>.</li>
      <li>Paste both below. The token is kept in your encrypted Crown Tools data — never anywhere else.</li></ol></details>
    <div class="fgrid" style="margin-top:10px"><div class="s2"><label>Bot token</label><div class="hstack" style="gap:6px"><input id="dscTok" type="password" autocomplete="off" placeholder="${has ? 'Saved — paste a new one to replace it' : 'Paste your bot token'}" style="flex:1;min-width:0"><button class="sm" id="dscTokSave">${has ? 'Replace' : 'Save'}</button>${has ? '<button class="sm ghost" id="dscTokDel">Remove</button>' : ''}</div></div>
      <div class="s2"><label>Add a channel</label><div class="hstack" style="gap:6px"><input id="dscCh" inputmode="numeric" placeholder="Channel ID, like 1529575631556444282" style="flex:1;min-width:0" ${has ? '' : 'disabled'}><button class="sm primary" id="dscChAdd" ${has && SERVER ? '' : 'disabled'}>Add</button></div><div class="small faint" id="dscNote" style="margin-top:4px">${esc(DSC.note)}</div></div></div>
    ${feeds.length ? `<div class="list" style="margin-top:10px">${feeds.map(f => `<div class="li"><span class="dot ${f.enabled === false ? '' : f.error ? 'bad' : f.lastSync ? 'ok' : 'warn'}"></span><div class="mmain"><div class="t2">#${esc(f.name || f.id)}</div><div class="small ${f.error ? '' : 'muted'}" ${f.error ? 'style="color:var(--danger)"' : ''}>${f.error ? esc(f.error) : f.enabled === false ? 'Paused' : f.lastSync ? `Checked ${esc(ago(f.lastSync))} · ${plural(f.count || 0, 'checkout')} read` : 'Not read yet'}</div></div><button class="sm ghost" data-dsc="toggle" data-id="${f.id}">${f.enabled === false ? 'Resume' : 'Pause'}</button><button class="sm ghost" data-dsc="del" data-id="${f.id}" aria-label="Remove">✕</button></div>`).join('')}</div>` : ''}
    <div class="hstack" style="margin-top:10px;flex-wrap:wrap;gap:6px"><span class="small muted">First read goes back</span><div class="chips" id="dscBack">${[7, 30, 60, 90].map(d => `<button class="chip ${(state.settings.discordLookback || 30) === d ? 'on' : ''}" data-v="${d}">${d} days</button>`).join('')}</div></div>
    ${cs.length ? `<div class="section">Recent checkouts · ${linkedN} linked${waiting.length ? ` · ${waiting.length} waiting for an order email` : ''}</div><div class="list">${recent.map(c => { const o = c.orderId && state.orders.find(x => x.id === c.orderId); return `<div class="li ${o ? 'click' : ''}" ${o ? `data-order="${o.id}"` : ''}><div class="mmain"><div class="t2 ellipsis">${esc(c.item || '(no product name)')}</div><div class="small muted ellipsis">${esc(botLabel(c.bot))} · ${esc(Parser.storeInfo(c.store).label)}${c.profile ? ' · ' + esc(c.profile) : ''}${c.order ? ' · #' + esc(c.order) : ''} · ${esc(fmtDT(c.at))}</div></div><span class="small ${o ? '' : 'faint'} nowrap">${o ? '✓ linked' : 'waiting'}</span></div>`; }).join('')}</div>` : ''}
  </div>`;
}
function wireDiscordCard() {
  const card = $('#dscCard'); if (!card) return;
  const note = t => { DSC.note = t; const n = $('#dscNote'); if (n) n.textContent = t; };
  if ($('#dscSync')) $('#dscSync').onclick = () => syncDiscord(true);
  $('#dscTokSave').onclick = async () => {
    const t = $('#dscTok').value.trim(); if (!t) { toast('Paste the bot token first'); return; }
    $('#dscTokSave').disabled = true; note('Checking the token…');
    try { const r = await api('/api/discord/check', { token: t }); state.settings.discordToken = t.replace(/^bot\s+/i, ''); save(); note(`Connected as ${r.bot}. Now add the channel your bots post checkouts to.`); PAGES.inboxes.render(); }
    catch (e) { note(e.message); $('#dscTokSave').disabled = false; }
  };
  if ($('#dscTokDel')) $('#dscTokDel').onclick = async () => { if (!await ask('Remove the Discord bot token? Checkouts already read stay in Crown Tools.')) return; state.settings.discordToken = ''; save(); note(''); PAGES.inboxes.render(); };
  $('#dscChAdd').onclick = async () => {
    const id = $('#dscCh').value.replace(/\D/g, ''); if (!id) { toast('Paste a channel ID'); return; }
    if ((state.discordFeeds || []).some(f => f.id === id)) { toast('That channel is already added'); return; }
    $('#dscChAdd').disabled = true; note('Checking the channel…');
    try {
      const r = await api('/api/discord/check', { token: dToken(), channel: id });
      state.discordFeeds.push({ id, name: r.name || '', guild: r.guild || '', enabled: true, lastId: '', count: 0, updatedAt: Date.now() }); save();
      note(r.contentBlocked ? 'Added, but Discord is hiding the post contents from the bot. In the Developer Portal → Bot, turn on Message Content Intent.' : `Added #${r.name || id}. Reading it now…`);
      PAGES.inboxes.render(); syncDiscord(false);
    } catch (e) { note(e.message); $('#dscChAdd').disabled = false; }
  };
  card.querySelectorAll('[data-dsc]').forEach(b => b.onclick = async () => {
    const f = state.discordFeeds.find(x => x.id === b.dataset.id); if (!f) return;
    if (b.dataset.dsc === 'toggle') { f.enabled = f.enabled === false; f.updatedAt = Date.now(); save(); PAGES.inboxes.render(); }
    else if (await ask(`Stop reading #${f.name || f.id}? Checkouts already read stay in Crown Tools.`)) { state.discordFeeds = state.discordFeeds.filter(x => x.id !== f.id); save(); PAGES.inboxes.render(); }
  });
  $('#dscBack').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; state.settings.discordLookback = +b.dataset.v; save(); PAGES.inboxes.render(); };
}

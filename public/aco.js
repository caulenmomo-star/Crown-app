/* Crown Tools - ACO (checking out for clients). Each client has the bot profile names that are theirs. When your bot
   posts a checkout on one of those profiles, it shows up here as that client's successful checkout, with the time,
   item, store and bot - it never becomes one of your own orders, since the order, card and tracking are the client's.
   Fees are worked out per client, invoices are made from the checkouts you haven't billed yet, and each invoice can
   be sent as a link (with a card payment link through your own Stripe account if you add one) and tracked to paid. */
'use strict';
const ACO = { tab: 'clients', ckClient: '', ckStatus: 'all', ckRange: '30', ckQ: '', invStatus: 'open', stripeChecked: 0 };
const ACO_DEF = { business: '', unit: 0, pct: 0, perOrder: 0, dueDays: 3, prefix: 'INV-', next: 1, venmo: '', cashapp: '', zelle: '', paypal: '', payNote: '', stripeKey: '', template: 'Got you! {qty}× {item} from {store} at {time}. Fee: {fee}' };
const acoCfg = () => Object.assign({}, ACO_DEF, state.settings.aco || {});
const acoSet = patch => { state.settings.aco = Object.assign({}, acoCfg(), patch); };
const acoClient = id => (state.acoClients || []).find(c => c.id === id);
const acoInvoice = id => (state.acoInvoices || []).find(i => i.id === id);
const acoCk = id => (state.acoCheckouts || []).find(c => c.id === id);
const money2 = v => Math.round((Number(v) || 0) * 100) / 100;
const numIn = v => { const n = Number(String(v == null ? '' : v).replace(/[$,%\s]/g, '')); return Number.isFinite(n) && n >= 0 ? n : 0; };

/* ---------- which client a bot profile belongs to ---------- */
// a client's profile names, one per line; "Ashley*" matches every profile that starts with Ashley
function acoClientForProfile(name) {
  const n = String(name || '').trim().toLowerCase(); if (!n) return null;
  let best = null;
  for (const c of state.acoClients || []) {
    if (c.active === false) continue;
    for (const raw of c.profiles || []) {
      const p = String(raw || '').trim().toLowerCase(); if (!p) continue;
      if (p.endsWith('*') ? n.startsWith(p.slice(0, -1)) && p.length > 1 : n === p) { if (!best || !p.endsWith('*')) best = c; if (!p.endsWith('*')) return c; }
    }
  }
  return best;
}
// a bot checkout on a client's profile: record it for the client (once) and keep it out of your orders
function acoClaimCheckout(c, clientId) {
  const cl = clientId ? acoClient(clientId) : acoClientForProfile(c.profile); if (!cl) return false;
  c.clientId = cl.id; c.orderId = ''; c.updatedAt = Date.now();
  if (!(state.acoCheckouts || []).some(k => k.botId === c.id)) {
    const k = { id: uid(), clientId: cl.id, src: 'bot', botId: c.id, at: c.at || new Date().toISOString(), store: c.store || 'other', item: c.item || 'Item', qty: Math.max(1, Number(c.qty) || 1), price: c.price ?? null, profile: c.profile || '', bot: c.bot || '', order: c.order || '', image: c.image || '', status: 'success', invoiceId: '', note: '', createdAt: Date.now(), updatedAt: Date.now() };
    state.acoCheckouts.push(k);
    // only fresh ones pop up - sorting a backlog of old checkouts doesn't flood the bell
    if (typeof addNotif === 'function' && Date.now() - (toDate(k.at) || new Date()).getTime() < 2 * 864e5) addNotif('aco', `${cl.name}: ${k.qty}× ${acoShort(k.item)}`, `${Parser.storeInfo(k.store).label} · ${typeof botLabel === 'function' ? botLabel(k.bot) : 'Bot'} · ${fmtDT(k.at)}`, 'aco', 'aco:' + k.id);
  }
  return true;
}
const acoShort = n => (typeof shortName === 'function' ? shortName(n) : String(n || '')).slice(0, 90);
// bot checkouts that aren't yours (no profile of yours) and aren't a client's yet
const acoUnclaimed = () => (state.botCheckouts || []).filter(c => !c.orderId && !c.clientId && !c.acoIgnored);

/* ---------- money ---------- */
function acoFeeRule(cl) { const d = acoCfg(), f = cl && cl.fee; return f && f.custom ? { unit: numIn(f.unit), pct: numIn(f.pct), perOrder: numIn(f.perOrder) } : { unit: numIn(d.unit), pct: numIn(d.pct), perOrder: numIn(d.perOrder) }; }
function acoFee(k) {
  if (!k || k.status !== 'success') return 0;
  if (k.feeOverride != null && k.feeOverride !== '') return money2(k.feeOverride);
  const r = acoFeeRule(acoClient(k.clientId)), q = Math.max(1, Number(k.qty) || 1);
  return money2(r.unit * q + (r.pct / 100) * (Number(k.price) || 0) * q + r.perOrder);
}
const acoFeeText = cl => { const r = acoFeeRule(cl), p = []; if (r.unit) p.push(fmtMoney(r.unit) + ' per item'); if (r.pct) p.push(r.pct + '% of the price'); if (r.perOrder) p.push(fmtMoney(r.perOrder) + ' per checkout'); return p.join(' + ') || 'No fee set'; };
const acoInvTotal = inv => money2(sum(inv.lines || [], l => (Number(l.amount) || 0)) - (Number(inv.discount) || 0));
const acoInvLive = inv => inv.status !== 'void';
const acoOverdue = inv => inv.status === 'sent' && inv.due && inv.due < todayKey();
const acoUnbilled = clientId => (state.acoCheckouts || []).filter(k => k.status === 'success' && !k.invoiceId && (!clientId || k.clientId === clientId));
const acoUnbilledCount = () => acoUnbilled().length;
function acoClientStats(cl) {
  const ks = (state.acoCheckouts || []).filter(k => k.clientId === cl.id), ok = ks.filter(k => k.status === 'success');
  const invs = (state.acoInvoices || []).filter(i => i.clientId === cl.id && acoInvLive(i));
  const owed = sum(invs.filter(i => i.status === 'sent'), acoInvTotal), unbilled = sum(acoUnbilled(cl.id), acoFee);
  return { checkouts: ok.length, units: sum(ok, k => Number(k.qty) || 1), cancelled: ks.length - ok.length, fees: sum(ok, acoFee), paid: sum(invs.filter(i => i.status === 'paid'), acoInvTotal), owed, unbilled, last: ks.map(k => k.at).sort().pop() || '', overdue: invs.filter(acoOverdue).length };
}
function acoFillTemplate(k) {
  const cl = acoClient(k.clientId);
  return String(acoCfg().template || ACO_DEF.template).replace(/\{(\w+)\}/g, (m, w) => ({ client: cl ? cl.name : '', qty: k.qty, item: acoShort(k.item), store: Parser.storeInfo(k.store).label, time: fmtDT(k.at), date: fmtDate(k.at), price: k.price != null ? fmtMoney(k.price) : '', fee: fmtMoney(acoFee(k)), order: k.order || '', bot: typeof botLabel === 'function' ? botLabel(k.bot) : '' }[w] ?? m));
}

/* ---------- the page ---------- */
PAGES.aco = {
  render() {
    const pg = $('#pg-aco'); const C = state.acoClients || [], K = state.acoCheckouts || [], I = state.acoInvoices || [];
    const m0 = dayKey(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const monthK = K.filter(k => k.status === 'success' && dayKey(toDate(k.at) || new Date()) >= m0);
    const owedInv = sum(I.filter(i => i.status === 'sent'), acoInvTotal), unbilled = sum(acoUnbilled(), acoFee);
    const paidMonth = sum(I.filter(i => i.status === 'paid' && (i.paidAt || '').slice(0, 10) >= m0), acoInvTotal), overdue = I.filter(acoOverdue);
    const unclaimed = acoUnclaimed();
    pg.innerHTML = `<div class="pagehead"><h1>ACO</h1><span class="sub">${plural(C.filter(c => c.active !== false).length, 'client')}${unclaimed.length ? ` · ${unclaimed.length} checkout${unclaimed.length === 1 ? '' : 's'} to sort` : ''}</span><div class="spacer"></div>
        <button id="acoAddCk">+ Checkout</button><button id="acoNewInv" ${C.length ? '' : 'disabled'}>New invoice</button><button class="primary" id="acoAddCl">+ Client</button></div>
      ${ACO.tab === 'clients' ? `<div class="hero acohero"><div class="hero-l">Owed to you</div><div class="hero-v">${fmtMoney(owedInv + unbilled)}</div>
        <div class="hero-s">${fmtMoney(owedInv)} on sent invoices · ${fmtMoney(unbilled)} not invoiced yet</div>
        <div class="hero-tiles"><button class="htile" data-acotab="checkouts"><span>Earned this month</span><b>${fmtMoney(sum(monthK, acoFee))}</b><i>${plural(monthK.length, 'checkout')} · ${sum(monthK, k => Number(k.qty) || 1)} items</i></button>
          <button class="htile" data-acotab="invoices"><span>Paid this month</span><b>${fmtMoney(paidMonth)}</b><i>${plural(I.filter(i => i.status === 'paid' && (i.paidAt || '').slice(0, 10) >= m0).length, 'invoice')}</i></button>
          <button class="htile" data-acotab="invoices" data-acoinv="overdue"><span>Overdue</span><b>${overdue.length}</b><i>${overdue.length ? fmtMoney(sum(overdue, acoInvTotal)) : 'nothing late'}</i></button>
          <button class="htile" data-acotab="clients"><span>Clients</span><b>${C.filter(c => c.active !== false).length}</b><i>${C.length ? C.filter(c => acoClientStats(c).last >= m0).length + ' active this month' : 'add your first'}</i></button></div></div>` : ''}
      ${unclaimed.length && C.length && ACO.tab !== 'checkouts' ? `<div class="note warn small" style="margin:0 0 12px;display:flex;gap:10px;align-items:center"><span style="flex:1"><b>${plural(unclaimed.length, 'bot checkout')}</b> on profiles that aren’t yours or a client’s yet. Tell Crown Tools whose they are and it remembers the profile.</span><button class="sm" data-acotab="checkouts" data-acounc="1">Sort them</button></div>` : ''}
      <div class="hstack" style="margin-bottom:12px"><div class="seg" id="acoTabs">${[['clients', 'Clients'], ['checkouts', 'Checkouts'], ['invoices', 'Invoices'], ['setup', 'Setup']].map(([k, l]) => `<button data-acotab="${k}" class="${ACO.tab === k ? 'on' : ''}">${l}${k === 'checkouts' && acoUnbilledCount() ? ` <span class="badge">${acoUnbilledCount()}</span>` : ''}</button>`).join('')}</div></div>
      <div id="acoBody">${ACO.tab === 'clients' ? acoClientsHtml() : ACO.tab === 'checkouts' ? acoCheckoutsHtml() : ACO.tab === 'invoices' ? acoInvoicesHtml() : acoSetupHtml()}</div>`;
    pg.onclick = acoClick;
    if (ACO.tab === 'checkouts') { $('#acoCkQ').oninput = debounce(e => { ACO.ckQ = e.target.value; PAGES.aco.render(); }, 160); $('#acoCkClient').onchange = e => { ACO.ckClient = e.target.value; PAGES.aco.render(); }; }
    if (ACO.tab === 'setup') wireAcoSetup();
    acoAutoCheckStripe();
  },
};
function acoClientsHtml() {
  const C = (state.acoClients || []).slice().sort((a, b) => (a.active === false) - (b.active === false) || String(acoClientStats(b).last).localeCompare(String(acoClientStats(a).last)) || a.name.localeCompare(b.name));
  if (!C.length) return `<div class="empty">No clients yet. Add a client with the bot profile names you run for them — their checkouts then show up here on their own, with the time, item and fee.<div style="margin-top:12px"><button class="primary" id="acoAddCl2">+ Add your first client</button></div></div>`;
  return `<div class="olist">${C.map(c => { const s = acoClientStats(c); return `<div class="ocard acocl ${c.active === false ? 'out' : ''}" data-acocl="${c.id}">
    <div class="otop"><div class="acoav">${esc((c.name || '?').trim().charAt(0).toUpperCase())}</div><div class="omain"><div class="otitle">${esc(c.name)}${c.active === false ? ' <span class="badge">paused</span>' : ''}</div>
      <div class="ometa">${plural((c.profiles || []).length, 'profile')} · ${esc(acoFeeText(c))}</div></div></div>
    <div class="prefacts"><div><span>Checkouts</span><b>${s.checkouts}</b><i>${s.units} items</i></div><div><span>Not invoiced</span><b>${fmtMoney(s.unbilled)}</b></div><div><span>Owed</span><b class="${s.overdue ? 'neg' : ''}">${fmtMoney(s.owed)}</b>${s.overdue ? `<i style="color:var(--danger)">${s.overdue} overdue</i>` : ''}</div><div><span>Last checkout</span><b>${s.last ? esc(fmtDate(s.last)) : '—'}</b>${s.last ? `<i>${esc(relDay(s.last))}</i>` : ''}</div></div>
    <div class="iacts">${s.unbilled > 0 ? `<button class="sm primary" data-acoinvfor="${c.id}">Invoice ${fmtMoney(s.unbilled)}</button>` : ''}<span class="spacer"></span><button class="sm ghost" data-acoclopen="${c.id}">Open</button></div></div>`; }).join('')}</div>`;
}
function acoCheckoutsHtml() {
  const C = state.acoClients || [], q = ACO.ckQ.trim().toLowerCase();
  const unc = acoUnclaimed();
  let list = (state.acoCheckouts || []).filter(k => (!ACO.ckClient || k.clientId === ACO.ckClient) && (ACO.ckRange === 'all' || inRange(k.at, ACO.ckRange)));
  if (ACO.ckStatus === 'unbilled') list = list.filter(k => k.status === 'success' && !k.invoiceId); else if (ACO.ckStatus === 'cancelled') list = list.filter(k => k.status !== 'success'); else if (ACO.ckStatus === 'billed') list = list.filter(k => k.invoiceId);
  if (q) list = list.filter(k => [k.item, k.profile, k.order, (acoClient(k.clientId) || {}).name, Parser.storeInfo(k.store).label].some(v => String(v || '').toLowerCase().includes(q)));
  list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return `${unc.length && C.length ? `<div class="card" id="acoUnc" style="margin-bottom:14px"><h3>Whose checkouts are these? <span class="badge">${unc.length}</span></h3><div class="small muted" style="margin-bottom:8px">Your bot checked these out on profiles that aren’t in Crown Tools and aren’t on a client yet. Pick the client — Crown Tools adds the profile to that client so the next ones sort themselves.</div>
      <div class="list">${unc.slice().sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 40).map(c => `<div class="li"><div class="mmain"><div class="t2">${esc(c.qty)}× ${esc(acoShort(c.item))}</div><div class="small muted">${esc(Parser.storeInfo(c.store).label)} · profile <b>${esc(c.profile || '—')}</b> · ${esc(typeof botLabel === 'function' ? botLabel(c.bot) : '')} · ${esc(fmtDT(c.at))}</div></div>
        <select data-acoassign="${esc(c.id)}" style="width:auto;max-width:46%"><option value="">Whose is this?</option>${C.filter(x => x.active !== false).map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}<option value="__mine">Mine (not ACO)</option><option value="__skip">Ignore</option></select></div>`).join('')}</div></div>` : ''}
    <div class="toolbar"><input class="search" data-search id="acoCkQ" placeholder="Search item, profile, client, order #…" value="${esc(ACO.ckQ)}">
      <select id="acoCkClient" style="width:auto"><option value="">All clients</option>${C.map(c => `<option value="${c.id}" ${ACO.ckClient === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <div class="pills">${[['all', 'All'], ['unbilled', 'Not invoiced'], ['billed', 'Invoiced'], ['cancelled', 'Cancelled']].map(([k, l]) => `<button class="chip ${ACO.ckStatus === k ? 'on' : ''}" data-acockst="${k}">${l}</button>`).join('')}</div>
      <div class="pills">${[['today', 'Today'], ['7', '7D'], ['30', '30D'], ['month', 'This month'], ['all', 'All time']].map(([k, l]) => `<button class="chip ${ACO.ckRange === k ? 'on' : ''}" data-acockr="${k}">${l}</button>`).join('')}</div></div>
    ${list.length ? `<div class="small muted" style="margin:0 0 8px">${plural(list.length, 'checkout')} · ${sum(list.filter(k => k.status === 'success'), k => Number(k.qty) || 1)} items · ${fmtMoney(sum(list, acoFee))} in fees</div><div class="list acoks">${list.map(k => { const cl = acoClient(k.clientId), inv = k.invoiceId && acoInvoice(k.invoiceId); return `<div class="li acok ${k.status !== 'success' ? 'dead' : ''}">${thumb(k.image, 'sm')}<div class="mmain"><div class="t2">${esc(k.qty)}× ${esc(acoShort(k.item))}</div>
        <div class="small muted">${esc(cl ? cl.name : 'No client')} · ${esc(Parser.storeInfo(k.store).label)}${k.profile ? ' · ' + esc(k.profile) : ''}${k.bot ? ' · ' + esc(typeof botLabel === 'function' ? botLabel(k.bot) : k.bot) : ''}${k.order ? ' · #' + esc(k.order) : ''}</div>
        <div class="small faint">${esc(fmtDT(k.at))}${k.price != null ? ' · ' + fmtMoney(k.price) + ' each' : ''}${k.note ? ' · ' + esc(k.note) : ''}</div></div>
        <div class="dright"><b>${k.status === 'success' ? fmtMoney(acoFee(k)) : '<span class="faint">no fee</span>'}</b><div class="small">${k.status !== 'success' ? '<span class="neg">Cancelled</span>' : inv ? `<span class="${inv.status === 'paid' ? 'pos' : 'muted'}">${esc(inv.number)} · ${inv.status === 'paid' ? 'paid' : inv.status === 'void' ? 'void' : 'sent'}</span>` : '<span class="muted">not invoiced</span>'}</div>
        <div class="hstack" style="gap:4px;justify-content:flex-end;margin-top:4px"><button class="ghost sm" data-acockcopy="${k.id}" title="Copy a message for the client">Copy update</button><button class="ghost sm" data-acockedit="${k.id}">Edit</button></div></div></div>`; }).join('')}</div>`
      : `<div class="empty">${(state.acoCheckouts || []).length ? 'No checkouts match.' : 'No client checkouts yet. They show up here when your bot checks out on a client’s profile, or add one with <b>+ Checkout</b>.'}</div>`}`;
}
function acoInvoicesHtml() {
  const I = (state.acoInvoices || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.number).localeCompare(String(a.number)));
  const f = { open: i => i.status === 'sent' || i.status === 'draft', overdue: acoOverdue, paid: i => i.status === 'paid', all: () => true }[ACO.invStatus] || (() => true);
  const list = I.filter(f);
  return `<div class="pills" style="margin-bottom:12px">${[['open', 'Open', I.filter(i => i.status === 'sent' || i.status === 'draft').length], ['overdue', 'Overdue', I.filter(acoOverdue).length], ['paid', 'Paid', I.filter(i => i.status === 'paid').length], ['all', 'All', I.length]].map(([k, l, n]) => `<button class="chip ${ACO.invStatus === k ? 'on' : ''}" data-acoinv="${k}">${l}<span class="n">${n}</span></button>`).join('')}</div>
    ${list.length ? `<div class="list">${list.map(i => { const cl = acoClient(i.clientId); return `<div class="li click" data-acoinvopen="${i.id}"><span class="invst is-${acoOverdue(i) ? 'overdue' : i.status}">${acoOverdue(i) ? 'Overdue' : { draft: 'Draft', sent: 'Sent', paid: 'Paid', void: 'Void' }[i.status]}</span><div class="mmain"><div class="t2">${esc(i.number)} · ${esc(cl ? cl.name : 'Client removed')}</div><div class="small muted">${esc(fmtDate(i.date))}${i.status === 'paid' ? ' · paid ' + esc(fmtDate(i.paidAt)) + (i.paidVia ? ' (' + esc(i.paidVia) + ')' : '') : i.due ? ' · due ' + esc(fmtDate(i.due)) : ''} · ${plural((i.lines || []).length, 'line')}</div></div><div class="dright"><b>${fmtMoney(acoInvTotal(i))}</b></div></div>`; }).join('')}</div>`
      : `<div class="empty">${I.length ? 'No invoices here.' : 'No invoices yet. Open a client and tap <b>New invoice</b> — it fills in every checkout you haven’t billed yet.'}</div>`}`;
}
function acoSetupHtml() {
  const d = acoCfg();
  return `<div class="cols2"><div class="card"><h3>Your business</h3>
      <label>Name on invoices</label><input id="acsBiz" value="${esc(d.business)}" placeholder="e.g. Crown Cooks">
      <div class="section">Default fee</div><div class="small muted" style="margin-bottom:6px">Used for every client unless you set a different fee on the client. Only successful checkouts are charged.</div>
      <div class="cols3 tight"><div><label>Per item ($)</label><input id="acsUnit" inputmode="decimal" value="${esc(d.unit || '')}" placeholder="0"></div><div><label>% of the price</label><input id="acsPct" inputmode="decimal" value="${esc(d.pct || '')}" placeholder="0"></div><div><label>Per checkout ($)</label><input id="acsOrder" inputmode="decimal" value="${esc(d.perOrder || '')}" placeholder="0"></div></div>
      <div class="cols2 tight" style="margin-top:8px"><div><label>Invoices are due after (days)</label><input id="acsDue" inputmode="numeric" value="${esc(d.dueDays)}"></div><div><label>Invoice number starts with</label><input id="acsPrefix" value="${esc(d.prefix)}"></div></div>
      <div class="section">Message to a client after a checkout</div><input id="acsTpl" value="${esc(d.template)}"><div class="small faint" style="margin-top:4px">Fill-ins: {client} {qty} {item} {store} {time} {date} {price} {fee} {order} {bot}</div></div>
    <div class="card"><h3>Getting paid</h3><div class="small muted" style="margin-bottom:8px">Shown on every invoice. Fill in the ones you use.</div>
      <div class="cols2 tight"><div><label>Venmo</label><input id="acsVenmo" value="${esc(d.venmo)}" placeholder="@your-name"></div><div><label>Cash App</label><input id="acsCash" value="${esc(d.cashapp)}" placeholder="$yourtag"></div><div><label>Zelle</label><input id="acsZelle" value="${esc(d.zelle)}" placeholder="email or phone"></div><div><label>PayPal</label><input id="acsPaypal" value="${esc(d.paypal)}" placeholder="paypal.me/yourname"></div></div>
      <label style="margin-top:8px">Note on invoices</label><input id="acsNote" value="${esc(d.payNote)}" placeholder="e.g. Friends & family only, include the invoice number">
      <div class="section">Card payments with Stripe <span class="small faint">(optional)</span></div>
      <div class="small muted" style="margin-bottom:6px">Add a Stripe secret or restricted key and each invoice gets a “Pay with card” link. Crown Tools checks Stripe and marks the invoice paid on its own. Make a restricted key at dashboard.stripe.com → Developers → API keys with write access to Prices and Payment Links and read access to Checkout Sessions.</div>
      <div class="hstack"><input id="acsStripe" type="password" autocomplete="off" placeholder="rk_live_… or sk_live_…" value="${esc(d.stripeKey)}" style="flex:1;min-width:200px"><button id="acsStripeTest">Save &amp; test</button></div></div></div>
    <div class="hstack" style="margin-top:12px"><button class="primary" id="acsSave">Save</button></div>`;
}
function wireAcoSetup() {
  const read = () => ({ business: $('#acsBiz').value.trim(), unit: numIn($('#acsUnit').value), pct: numIn($('#acsPct').value), perOrder: numIn($('#acsOrder').value), dueDays: Math.min(90, Math.round(numIn($('#acsDue').value))), prefix: $('#acsPrefix').value.trim().slice(0, 12), template: $('#acsTpl').value.trim() || ACO_DEF.template, venmo: $('#acsVenmo').value.trim(), cashapp: $('#acsCash').value.trim(), zelle: $('#acsZelle').value.trim(), paypal: $('#acsPaypal').value.trim(), payNote: $('#acsNote').value.trim(), stripeKey: $('#acsStripe').value.trim() });
  $('#acsSave').onclick = () => { snapshot('ACO setup'); acoSet(read()); save(); toast('Saved'); PAGES.aco.render(); };
  $('#acsStripeTest').onclick = async e => {
    acoSet(read()); save(); const k = acoCfg().stripeKey; if (!k) { toast('Paste your Stripe key first'); return; }
    e.target.disabled = true; e.target.textContent = 'Testing…';
    try { const r = await api('/api/aco/stripe/test', { key: k }); toast('Stripe connected' + (r.account ? ' — ' + r.account : '')); } catch (err) { toast(err.message); }
    e.target.disabled = false; e.target.textContent = 'Save & test';
  };
}
async function acoClick(e) {
  const t = e.target;
  const tab = t.closest('[data-acotab]'); if (tab) { ACO.tab = tab.dataset.acotab; if (tab.dataset.acoinv) ACO.invStatus = tab.dataset.acoinv; PAGES.aco.render(); if (tab.dataset.acounc) setTimeout(() => { const u = $('#acoUnc'); if (u) u.scrollIntoView({ block: 'start' }); }, 50); return; }
  if (t.closest('#acoAddCl, #acoAddCl2')) { openAcoClient(null); return; }
  if (t.closest('#acoAddCk')) { if (!(state.acoClients || []).length) { toast('Add a client first'); return; } openAcoCk(null); return; }
  if (t.closest('#acoNewInv')) { const cl = (state.acoClients || []).find(c => acoUnbilled(c.id).length) || state.acoClients[0]; openAcoInvoice(null, cl && cl.id); return; }
  const op = t.closest('[data-acoclopen]'); if (op) { openAcoClient(op.dataset.acoclopen); return; }
  const invf = t.closest('[data-acoinvfor]'); if (invf) { openAcoInvoice(null, invf.dataset.acoinvfor); return; }
  const st = t.closest('[data-acockst]'); if (st) { ACO.ckStatus = st.dataset.acockst; PAGES.aco.render(); return; }
  const rg = t.closest('[data-acockr]'); if (rg) { ACO.ckRange = rg.dataset.acockr; PAGES.aco.render(); return; }
  const iv = t.closest('[data-acoinv]'); if (iv) { ACO.invStatus = iv.dataset.acoinv; PAGES.aco.render(); return; }
  const ivo = t.closest('[data-acoinvopen]'); if (ivo) { openAcoInvoice(ivo.dataset.acoinvopen); return; }
  const cp = t.closest('[data-acockcopy]'); if (cp) { const k = acoCk(cp.dataset.acockcopy); if (k) copyText(acoFillTemplate(k), 'Message'); return; }
  const ed = t.closest('[data-acockedit]'); if (ed) { openAcoCk(ed.dataset.acockedit); return; }
  const card = t.closest('[data-acocl]'); if (card && !t.closest('button, select, input')) { openAcoClient(card.dataset.acocl); return; }
}
document.addEventListener('change', e => {
  const s = e.target.closest('[data-acoassign]'); if (!s || !s.value) return;
  const c = (state.botCheckouts || []).find(x => x.id === s.dataset.acoassign); if (!c) return;
  snapshot('sort checkout');
  if (s.value === '__skip') { c.acoIgnored = true; c.updatedAt = Date.now(); }
  else if (s.value === '__mine') { c.acoIgnored = true; c.updatedAt = Date.now(); toast('Left out of ACO — add the profile in Profiles to link it to your orders'); }
  else { const cl = acoClient(s.value); if (cl && c.profile && !acoClientForProfile(c.profile)) { cl.profiles = (cl.profiles || []).concat([c.profile]); cl.updatedAt = Date.now(); } acoClaimCheckout(c, s.value); (state.botCheckouts || []).forEach(x => { if (!x.orderId && !x.clientId && !x.acoIgnored && acoClientForProfile(x.profile)) acoClaimCheckout(x); }); toast(`Added to ${cl ? cl.name : 'the client'}`, { undo: true }); }
  save(); PAGES.aco.render();
});

/* ---------- one client ---------- */
let curCl = null, clIsNew = false, clTab = 'details';
function openAcoClient(id) {
  const c = id && acoClient(id); clIsNew = !c; clTab = 'details';
  curCl = JSON.parse(JSON.stringify(c || { id: uid(), name: '', email: '', phone: '', discord: '', profiles: [], fee: { custom: false, unit: '', pct: '', perOrder: '' }, notes: '', active: true, createdAt: Date.now() }));
  renderAcoClient(); openDlg('dlgAcoClient');
  if (clIsNew) setTimeout(() => { if (!isCompact()) $('#clName').focus(); }, 60);
}
function readAcoClient() {
  if (!$('#clName')) return;
  curCl.name = $('#clName').value.trim(); curCl.email = $('#clEmail').value.trim(); curCl.phone = $('#clPhone').value.trim(); curCl.discord = $('#clDiscord').value.trim();
  curCl.profiles = Array.from(new Set($('#clProfiles').value.split(/[\n,]/).map(x => x.trim()).filter(Boolean)));
  curCl.fee = { custom: $('#clFeeCustom').checked, unit: $('#clUnit').value.trim(), pct: $('#clPct').value.trim(), perOrder: $('#clOrder').value.trim() };
  curCl.notes = $('#clNotes').value; curCl.active = !$('#clPaused').checked;
}
function renderAcoClient() {
  const c = curCl, s = clIsNew ? null : acoClientStats(acoClient(c.id) || c);
  $('#clTitle').textContent = clIsNew ? 'New client' : c.name || 'Client';
  $('#clTabs').innerHTML = clIsNew ? '' : [['details', 'Details'], ['checkouts', `Checkouts (${(state.acoCheckouts || []).filter(k => k.clientId === c.id).length})`], ['invoices', `Invoices (${(state.acoInvoices || []).filter(i => i.clientId === c.id).length})`]].map(([k, l]) => `<button class="tab ${clTab === k ? 'on' : ''}" data-cltab="${k}">${l}</button>`).join('');
  $('#clTabs').hidden = clIsNew; $('#clDelete').hidden = clIsNew; $('#clSave').hidden = clTab !== 'details'; $('#clInvoice').hidden = clIsNew || !acoUnbilled(c.id).length;
  if (!clIsNew) $('#clInvoice').textContent = 'Invoice ' + fmtMoney(sum(acoUnbilled(c.id), acoFee));
  const b = $('#clBody');
  if (clTab === 'details') {
    const d = acoCfg();
    b.innerHTML = `${s ? `<div class="kpis" style="margin-bottom:14px"><div class="kpi"><div class="l">Checkouts</div><div class="v">${s.checkouts}</div><div class="d">${s.units} items${s.cancelled ? ' · ' + s.cancelled + ' cancelled' : ''}</div></div><div class="kpi"><div class="l">Fees earned</div><div class="v">${fmtMoney(s.fees)}</div><div class="d">${fmtMoney(s.paid)} paid</div></div><div class="kpi"><div class="l">Owed</div><div class="v ${s.overdue ? 'neg' : ''}">${fmtMoney(s.owed + s.unbilled)}</div><div class="d">${fmtMoney(s.unbilled)} not invoiced</div></div></div>` : ''}
      <div class="fgrid"><div class="s2"><label>Name</label><input id="clName" value="${esc(c.name)}" placeholder="Ashley R."></div>
        <div class="s2"><label>Email</label><input id="clEmail" type="email" value="${esc(c.email)}" autocapitalize="off" placeholder="for invoices"></div>
        <div class="s2"><label>Phone</label><input id="clPhone" inputmode="tel" value="${esc(c.phone)}"></div>
        <div class="s2"><label>Discord</label><input id="clDiscord" value="${esc(c.discord)}" placeholder="username"></div>
        <div class="s4"><label>Their bot profile names</label><textarea id="clProfiles" style="min-height:70px;font-family:inherit;font-size:13px" placeholder="One per line, exactly as the bot shows them. End with * to match every profile that starts with it, e.g. Ashley*">${esc((c.profiles || []).join('\n'))}</textarea>
          <div class="small faint" style="margin-top:3px">When your bot checks out on one of these, it’s logged here as this client’s checkout — never as your own order.</div></div>
        <div class="s4"><label class="check"><input type="checkbox" id="clFeeCustom" ${c.fee && c.fee.custom ? 'checked' : ''}> Different fee for this client <span class="small faint">(default: ${esc(acoFeeText(null))})</span></label></div>
        <div class="s4 cols3 tight" id="clFeeBox" ${c.fee && c.fee.custom ? '' : 'hidden'}><div><label>Per item ($)</label><input id="clUnit" inputmode="decimal" value="${esc(c.fee ? c.fee.unit : '')}" placeholder="${esc(d.unit || 0)}"></div><div><label>% of the price</label><input id="clPct" inputmode="decimal" value="${esc(c.fee ? c.fee.pct : '')}" placeholder="${esc(d.pct || 0)}"></div><div><label>Per checkout ($)</label><input id="clOrder" inputmode="decimal" value="${esc(c.fee ? c.fee.perOrder : '')}" placeholder="${esc(d.perOrder || 0)}"></div></div>
        <div class="s4"><label>Notes</label><textarea id="clNotes" style="min-height:54px;font-family:inherit;font-size:13px" placeholder="What they want, limits, how they like to be paid…">${esc(c.notes)}</textarea></div>
        <div class="s4"><label class="check"><input type="checkbox" id="clPaused" ${c.active === false ? 'checked' : ''}> Paused — don’t log new checkouts for this client</label></div></div>`;
    $('#clFeeCustom').onchange = e => { $('#clFeeBox').hidden = !e.target.checked; };
  } else if (clTab === 'checkouts') {
    const ks = (state.acoCheckouts || []).filter(k => k.clientId === c.id).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    b.innerHTML = ks.length ? `<div class="list">${ks.map(k => `<div class="li"><div class="mmain"><div class="t2">${esc(k.qty)}× ${esc(acoShort(k.item))}</div><div class="small muted">${esc(fmtDT(k.at))} · ${esc(Parser.storeInfo(k.store).label)}${k.profile ? ' · ' + esc(k.profile) : ''}${k.order ? ' · #' + esc(k.order) : ''}</div></div><div class="dright"><b>${k.status === 'success' ? fmtMoney(acoFee(k)) : '<span class="neg">Cancelled</span>'}</b><div class="small muted">${k.invoiceId ? esc((acoInvoice(k.invoiceId) || {}).number || '') : k.status === 'success' ? 'not invoiced' : ''}</div><button class="ghost sm" data-clckcopy="${k.id}">Copy update</button></div></div>`).join('')}</div>` : '<div class="empty sm">No checkouts for this client yet.</div>';
  } else {
    const is = (state.acoInvoices || []).filter(i => i.clientId === c.id).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    b.innerHTML = is.length ? `<div class="list">${is.map(i => `<div class="li click" data-clinv="${i.id}"><span class="invst is-${acoOverdue(i) ? 'overdue' : i.status}">${acoOverdue(i) ? 'Overdue' : { draft: 'Draft', sent: 'Sent', paid: 'Paid', void: 'Void' }[i.status]}</span><div class="mmain"><div class="t2">${esc(i.number)}</div><div class="small muted">${esc(fmtDate(i.date))}</div></div><div class="dright"><b>${fmtMoney(acoInvTotal(i))}</b></div></div>`).join('')}</div>` : '<div class="empty sm">No invoices for this client yet.</div>';
  }
}
function wireAcoClient() {
  $('#clTabs').onclick = e => { const b = e.target.closest('[data-cltab]'); if (!b) return; if (clTab === 'details') readAcoClient(); clTab = b.dataset.cltab; renderAcoClient(); };
  $('#clBody').onclick = e => {
    const cp = e.target.closest('[data-clckcopy]'); if (cp) { const k = acoCk(cp.dataset.clckcopy); if (k) copyText(acoFillTemplate(k), 'Message'); return; }
    const iv = e.target.closest('[data-clinv]'); if (iv) { closeDlg('dlgAcoClient'); openAcoInvoice(iv.dataset.clinv); }
  };
  $('#clSave').onclick = () => {
    readAcoClient();
    if (!curCl.name) { toast('Give the client a name'); return; }
    const taken = curCl.profiles.find(p => (state.acoClients || []).some(o => o.id !== curCl.id && (o.profiles || []).some(x => x.trim().toLowerCase() === p.toLowerCase())));
    if (taken) { toast(`“${taken}” is already on another client`); return; }
    const mine = curCl.profiles.find(p => !p.endsWith('*') && profileByName(p));
    snapshot(clIsNew ? 'add client' : 'edit client'); curCl.updatedAt = Date.now();
    state.acoClients = (state.acoClients || []).filter(x => x.id !== curCl.id).concat([curCl]);
    // checkouts already waiting on these profiles join the client now
    let n = 0; for (const c of state.botCheckouts || []) if (!c.orderId && !c.clientId && acoClientForProfile(c.profile) && acoClientForProfile(c.profile).id === curCl.id && acoClaimCheckout(c)) n++;
    save(); closeDlg('dlgAcoClient'); refresh();
    toast((clIsNew ? 'Client added' : 'Saved') + (n ? ` · ${plural(n, 'checkout')} linked` : '') + (mine ? ` — note: “${mine}” is also one of your own profiles` : ''), { undo: true });
  };
  $('#clDelete').onclick = async () => {
    const ks = (state.acoCheckouts || []).filter(k => k.clientId === curCl.id).length;
    if (!await ask(`Delete ${curCl.name || 'this client'}?${ks ? `\n\nTheir ${plural(ks, 'checkout')} and invoices are deleted too.` : ''}`)) return;
    snapshot('delete client');
    const invIds = new Set((state.acoInvoices || []).filter(i => i.clientId === curCl.id).map(i => i.id));
    state.acoClients = state.acoClients.filter(x => x.id !== curCl.id); state.acoCheckouts = state.acoCheckouts.filter(k => k.clientId !== curCl.id); state.acoInvoices = state.acoInvoices.filter(i => !invIds.has(i.id));
    (state.botCheckouts || []).forEach(c => { if (c.clientId === curCl.id) { c.clientId = ''; c.updatedAt = Date.now(); } });
    save(); closeDlg('dlgAcoClient'); refresh(); toast('Client deleted', { undo: true });
  };
  $('#clInvoice').onclick = () => { if (clTab === 'details') readAcoClient(); const id = curCl.id; closeDlg('dlgAcoClient'); openAcoInvoice(null, id); };
}

/* ---------- one checkout (add by hand / edit) ---------- */
let curCk = null, ckIsNew = false;
function openAcoCk(id) {
  const k = id && acoCk(id); ckIsNew = !k;
  curCk = JSON.parse(JSON.stringify(k || { id: uid(), clientId: ACO.ckClient || ((state.acoClients || []).find(c => c.active !== false) || {}).id || '', src: 'manual', at: new Date().toISOString(), store: 'target', item: '', qty: 1, price: null, profile: '', bot: '', order: '', image: '', status: 'success', invoiceId: '', note: '', createdAt: Date.now() }));
  const d = toDate(curCk.at) || new Date(), local = new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
  const inv = curCk.invoiceId && acoInvoice(curCk.invoiceId);
  $('#ckTitle').textContent = ckIsNew ? 'Add a client checkout' : 'Checkout';
  $('#ckBody').innerHTML = `${inv ? `<div class="note small" style="margin:0 0 10px">On invoice ${esc(inv.number)} (${esc(inv.status)}). Changing the fee here doesn’t change that invoice.</div>` : ''}<div class="fgrid">
    <div class="s2"><label>Client</label><select id="ckClient">${(state.acoClients || []).map(c => `<option value="${c.id}" ${curCk.clientId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    <div class="s2"><label>When</label><input id="ckAt" type="datetime-local" value="${local}"></div>
    <div class="s4"><label>Item</label><input id="ckItem" value="${esc(curCk.item)}" placeholder="Pokémon TCG: 30th Celebration Elite Trainer Box"></div>
    <div><label>Quantity</label><input id="ckQty" inputmode="numeric" value="${esc(curCk.qty)}"></div>
    <div><label>Price each ($)</label><input id="ckPrice" inputmode="decimal" value="${curCk.price ?? ''}"></div>
    <div class="s2"><label>Store</label><select id="ckStore">${Parser.STORES.filter(s => s.key !== 'other').slice().sort((a, b) => a.label.localeCompare(b.label)).map(s => `<option value="${s.key}" ${curCk.store === s.key ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}<option value="other" ${curCk.store === 'other' ? 'selected' : ''}>Other</option></select></div>
    <div class="s2"><label>Profile</label><input id="ckProfile" value="${esc(curCk.profile)}"></div>
    <div class="s2"><label>Order # <span class="faint">(optional)</span></label><input id="ckOrder" value="${esc(curCk.order)}"></div>
    <div class="s2"><label>Status</label><select id="ckStatus"><option value="success" ${curCk.status === 'success' ? 'selected' : ''}>Checked out — charge the fee</option><option value="cancelled" ${curCk.status !== 'success' ? 'selected' : ''}>Cancelled — no fee</option></select></div>
    <div class="s2"><label>Fee ($) <span class="faint">(leave empty to use the client’s fee)</span></label><input id="ckFee" inputmode="decimal" value="${curCk.feeOverride ?? ''}" placeholder="${esc(fmtMoney(acoFee(Object.assign({}, curCk, { feeOverride: null }))))}"></div>
    <div class="s4"><label>Note</label><input id="ckNote" value="${esc(curCk.note)}"></div></div>`;
  $('#ckDelete').hidden = ckIsNew;
  openDlg('dlgAcoCk');
}
function wireAcoCk() {
  $('#ckSave').onclick = () => {
    const at = $('#ckAt').value ? new Date($('#ckAt').value) : new Date();
    Object.assign(curCk, { clientId: $('#ckClient').value, at: isNaN(at) ? new Date().toISOString() : at.toISOString(), item: $('#ckItem').value.trim(), qty: Math.max(1, Math.round(numIn($('#ckQty').value)) || 1), price: $('#ckPrice').value.trim() === '' ? null : money2(numIn($('#ckPrice').value)), store: $('#ckStore').value, profile: $('#ckProfile').value.trim(), order: $('#ckOrder').value.trim(), status: $('#ckStatus').value, feeOverride: $('#ckFee').value.trim() === '' ? null : money2(numIn($('#ckFee').value)), note: $('#ckNote').value.trim(), updatedAt: Date.now() });
    if (!curCk.clientId) { toast('Pick a client'); return; }
    if (!curCk.item) { toast('What was checked out?'); return; }
    snapshot(ckIsNew ? 'add checkout' : 'edit checkout');
    state.acoCheckouts = (state.acoCheckouts || []).filter(k => k.id !== curCk.id).concat([curCk]);
    save(); closeDlg('dlgAcoCk'); refresh(); toast(ckIsNew ? 'Checkout added' : 'Saved', { undo: true });
  };
  $('#ckDelete').onclick = async () => {
    if (!await ask('Delete this checkout?' + (curCk.invoiceId ? '\n\nIt stays on the invoice it was billed on.' : ''))) return;
    snapshot('delete checkout'); state.acoCheckouts = state.acoCheckouts.filter(k => k.id !== curCk.id);
    const b = curCk.botId && (state.botCheckouts || []).find(c => c.id === curCk.botId); if (b) { b.acoIgnored = true; b.updatedAt = Date.now(); }
    save(); closeDlg('dlgAcoCk'); refresh(); toast('Deleted', { undo: true });
  };
}

/* ---------- invoices ---------- */
let curInv = null, invIsNew = false;
const invLineFor = k => ({ id: uid(), checkoutId: k.id, desc: `${k.qty}× ${acoShort(k.item)} — ${Parser.storeInfo(k.store).label}, ${fmtDT(k.at)}${k.order ? ', order #' + k.order : ''}`, amount: acoFee(k) });
function openAcoInvoice(id, clientId) {
  const inv = id && acoInvoice(id); invIsNew = !inv;
  if (!inv && !(state.acoClients || []).length) { toast('Add a client first'); return; }
  const d = acoCfg(), today = todayKey();
  curInv = JSON.parse(JSON.stringify(inv || { id: uid(), number: '', clientId: clientId || state.acoClients[0].id, date: today, due: dayKey(new Date(Date.now() + d.dueDays * 864e5)), lines: [], discount: 0, notes: '', status: 'draft', createdAt: Date.now() }));
  if (invIsNew) curInv.lines = acoUnbilled(curInv.clientId).sort((a, b) => String(a.at).localeCompare(String(b.at))).map(invLineFor);
  renderAcoInvoice(); openDlg('dlgAcoInv');
}
function readAcoInvoice() {
  if (!$('#ivClient')) return;
  if (curInv.status === 'draft') {
    curInv.clientId = $('#ivClient').value; curInv.date = $('#ivDate').value || todayKey(); curInv.due = $('#ivDue').value || '';
    $$('#ivLines [data-ivl]').forEach(r => { const l = curInv.lines.find(x => x.id === r.dataset.ivl); if (!l) return; l.desc = r.querySelector('.ivdesc').value; l.amount = money2(numIn(r.querySelector('.ivamt').value)); });
    curInv.discount = money2(numIn($('#ivDisc').value));
  }
  curInv.notes = $('#ivNotes').value;
}
function invPayload(inv) {
  const d = acoCfg(), cl = acoClient(inv.clientId) || {};
  return { v: 1, biz: d.business || 'Invoice', num: inv.number, date: inv.date, due: inv.due, client: cl.name || '', lines: (inv.lines || []).map(l => [l.desc, Number(l.amount) || 0]), disc: Number(inv.discount) || 0, total: acoInvTotal(inv), status: inv.status, paidAt: inv.paidAt || '', notes: inv.notes || '',
    pay: { venmo: d.venmo, cashapp: d.cashapp, zelle: d.zelle, paypal: d.paypal, note: d.payNote, card: inv.stripe && inv.stripe.url && inv.status !== 'paid' ? inv.stripe.url : '' } };
}
const b64url = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const invLink = inv => location.origin + location.pathname.replace(/[^/]*$/, '') + 'invoice.html#' + b64url(JSON.stringify(invPayload(inv)));
function invText(inv) {
  const cl = acoClient(inv.clientId) || {}, d = acoCfg(), P = invPayload(inv).pay;
  const how = [P.card ? 'Card: ' + P.card : '', P.venmo ? 'Venmo ' + P.venmo : '', P.cashapp ? 'Cash App ' + P.cashapp : '', P.zelle ? 'Zelle ' + P.zelle : '', P.paypal ? 'PayPal ' + P.paypal : ''].filter(Boolean);
  return `Hi ${cl.name || 'there'}, here’s invoice ${inv.number}${d.business ? ' from ' + d.business : ''} for ${fmtMoney(acoInvTotal(inv))}${inv.due ? ', due ' + fmtDate(inv.due) : ''}.\n\n${(inv.lines || []).map(l => `• ${l.desc}: ${fmtMoney(l.amount)}`).join('\n')}${inv.discount ? `\n• Discount: −${fmtMoney(inv.discount)}` : ''}\nTotal: ${fmtMoney(acoInvTotal(inv))}\n\n${how.length ? 'Pay with ' + how.join(' · ') + '\n' : ''}${P.note ? P.note + '\n' : ''}Invoice: ${invLink(inv)}`;
}
function renderAcoInvoice() {
  const inv = curInv, ed = inv.status === 'draft', cl = acoClient(inv.clientId), d = acoCfg();
  const avail = acoUnbilled(inv.clientId).filter(k => !inv.lines.some(l => l.checkoutId === k.id));
  $('#ivTitle').textContent = inv.number ? `Invoice ${inv.number}` : 'New invoice';
  $('#ivBadge').innerHTML = `<span class="invst is-${acoOverdue(inv) ? 'overdue' : inv.status}">${acoOverdue(inv) ? 'Overdue' : { draft: 'Draft', sent: 'Sent', paid: 'Paid', void: 'Void' }[inv.status]}</span>`;
  $('#ivBody').innerHTML = `<div class="fgrid"><div class="s2"><label>Client</label><select id="ivClient" ${ed ? '' : 'disabled'}>${(state.acoClients || []).map(c => `<option value="${c.id}" ${inv.clientId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div><label>Date</label><input id="ivDate" type="date" value="${esc(inv.date)}" ${ed ? '' : 'disabled'}></div><div><label>Due</label><input id="ivDue" type="date" value="${esc(inv.due)}" ${ed ? '' : 'disabled'}></div></div>
    <div class="section">What they’re paying for</div>
    <div id="ivLines">${inv.lines.length ? inv.lines.map(l => `<div class="ivline" data-ivl="${l.id}"><input class="ivdesc" value="${esc(l.desc)}" ${ed ? '' : 'disabled'} aria-label="Description"><input class="ivamt" inputmode="decimal" value="${esc(money2(l.amount).toFixed(2))}" ${ed ? '' : 'disabled'} aria-label="Amount">${ed ? `<button class="ghost sm" data-ivdel="${l.id}" aria-label="Remove line">✕</button>` : ''}</div>`).join('') : '<div class="small faint">No lines yet.</div>'}</div>
    ${ed ? `<div class="hstack" style="margin-top:8px;flex-wrap:wrap"><button class="sm" id="ivAddLine">+ Line</button>${avail.length ? `<button class="sm" id="ivAddAll">+ ${plural(avail.length, 'checkout')} not invoiced (${fmtMoney(sum(avail, acoFee))})</button>` : ''}</div>` : ''}
    <div class="ivtotals"><div><span>Discount</span><input id="ivDisc" inputmode="decimal" value="${esc(inv.discount ? money2(inv.discount).toFixed(2) : '')}" placeholder="0.00" ${ed ? '' : 'disabled'}></div><div class="ivtot"><span>Total</span><b id="ivTotal">${fmtMoney(acoInvTotal(inv))}</b></div></div>
    <label style="margin-top:10px">Note on the invoice</label><input id="ivNotes" value="${esc(inv.notes)}" placeholder="Thanks for the business!">
    ${inv.status !== 'draft' ? `<div class="section">Send it</div><div class="hstack" style="flex-wrap:wrap"><button class="sm" id="ivView">Open invoice ↗</button><button class="sm" id="ivCopyLink">Copy link</button><button class="sm" id="ivCopyText">Copy message</button>${cl && cl.email ? '<button class="sm" id="ivEmail">Email it</button>' : ''}${d.stripeKey && inv.status === 'sent' ? (inv.stripe && inv.stripe.url ? '<button class="sm" id="ivStripeCheck">Check card payment</button>' : '<button class="sm" id="ivStripe">Add card payment link</button>') : ''}</div>
      ${inv.stripe && inv.stripe.url ? `<div class="small muted" style="margin-top:6px">Card payment link: <a href="${esc(inv.stripe.url)}" target="_blank" rel="noopener">${esc(inv.stripe.url.replace(/^https:\/\//, '').slice(0, 48))}…</a>${inv.stripe.checkedAt ? ' · checked ' + esc(ago(inv.stripe.checkedAt)) : ''}</div>` : ''}
      ${inv.sentAt ? `<div class="small faint" style="margin-top:6px">Sent ${esc(fmtDT(inv.sentAt))}${inv.paidAt ? ' · paid ' + esc(fmtDT(inv.paidAt)) + (inv.paidVia ? ' with ' + esc(inv.paidVia) : '') : ''}</div>` : ''}` : ''}`;
  const f = $('#dlgAcoInv .dfoot');
  f.innerHTML = `${!invIsNew && (inv.status === 'draft' || inv.status === 'void') ? '<button class="danger" id="ivDelete">Delete</button>' : ''}${inv.status === 'sent' || inv.status === 'paid' ? `<button class="ghost" id="ivVoid">${inv.status === 'paid' ? 'Mark unpaid' : 'Void'}</button>` : ''}<div class="spacer"></div>
    ${inv.status === 'draft' ? '<button id="ivSaveDraft">Save draft</button><button class="primary" id="ivFinish">Create invoice</button>' : ''}
    ${inv.status === 'sent' ? '<select id="ivPaidVia" style="width:auto"><option value="">Paid with…</option><option>Venmo</option><option>Cash App</option><option>Zelle</option><option>PayPal</option><option>Card</option><option>Cash</option><option>Other</option></select><button class="primary" id="ivPaid">Mark paid</button>' : ''}
    ${inv.status === 'void' ? '<button id="ivReopen">Reopen</button>' : ''}<button class="ghost" data-close>Close</button>`;
  wireAcoInvoiceBits();
}
function invCommit(status) {
  readAcoInvoice();
  if (!curInv.lines.length || acoInvTotal(curInv) <= 0) { if (status !== 'draft') { toast('Add at least one line with an amount'); return false; } }
  if (curInv.lines.some(l => !String(l.desc || '').trim())) { toast('Every line needs a description'); return false; }
  if (status !== 'draft' && curInv.due && curInv.due < curInv.date) { toast('The due date is before the invoice date'); return false; }
  snapshot(invIsNew ? 'new invoice' : 'edit invoice');
  if (status === 'sent' && !curInv.number) { const d = acoCfg(); let n = Math.max(1, Number(d.next) || 1); const used = new Set((state.acoInvoices || []).map(i => i.number)); while (used.has(d.prefix + String(n).padStart(4, '0'))) n++; curInv.number = d.prefix + String(n).padStart(4, '0'); acoSet({ next: n + 1 }); }
  if (status === 'sent' && curInv.status === 'draft') curInv.sentAt = new Date().toISOString();
  curInv.status = status; curInv.total = acoInvTotal(curInv); curInv.updatedAt = Date.now();
  // the checkouts on this invoice are now billed; ones taken off it are free again
  const onIt = new Set(curInv.lines.map(l => l.checkoutId).filter(Boolean));
  (state.acoCheckouts || []).forEach(k => { if (onIt.has(k.id) && status !== 'void') { if (k.invoiceId !== curInv.id) { k.invoiceId = curInv.id; k.updatedAt = Date.now(); } } else if (k.invoiceId === curInv.id) { k.invoiceId = ''; k.updatedAt = Date.now(); } });
  state.acoInvoices = (state.acoInvoices || []).filter(i => i.id !== curInv.id).concat([JSON.parse(JSON.stringify(curInv))]);
  invIsNew = false; save(); refresh();
  return true;
}
function wireAcoInvoiceBits() {
  const $f = s => $('#dlgAcoInv ' + s);
  const retotal = () => { readAcoInvoice(); $('#ivTotal').textContent = fmtMoney(acoInvTotal(curInv)); };
  $$('#ivLines .ivamt, #ivDisc').forEach(i => i.oninput = retotal);
  $('#ivClient').onchange = () => { readAcoInvoice(); if (invIsNew || !curInv.lines.some(l => l.checkoutId)) curInv.lines = acoUnbilled(curInv.clientId).map(invLineFor); renderAcoInvoice(); };
  $('#ivLines').onclick = e => { const d = e.target.closest('[data-ivdel]'); if (!d) return; readAcoInvoice(); curInv.lines = curInv.lines.filter(l => l.id !== d.dataset.ivdel); renderAcoInvoice(); };
  if ($('#ivAddLine')) $('#ivAddLine').onclick = () => { readAcoInvoice(); curInv.lines.push({ id: uid(), checkoutId: '', desc: '', amount: 0 }); renderAcoInvoice(); const r = $$('#ivLines .ivdesc').pop(); if (r) r.focus(); };
  if ($('#ivAddAll')) $('#ivAddAll').onclick = () => { readAcoInvoice(); acoUnbilled(curInv.clientId).filter(k => !curInv.lines.some(l => l.checkoutId === k.id)).forEach(k => curInv.lines.push(invLineFor(k))); renderAcoInvoice(); };
  if ($f('#ivSaveDraft')) $f('#ivSaveDraft').onclick = () => { if (invCommit('draft')) { renderAcoInvoice(); toast('Draft saved'); } };
  if ($f('#ivFinish')) $f('#ivFinish').onclick = () => { if (invCommit('sent')) { renderAcoInvoice(); toast(`Invoice ${curInv.number} created — send it with the buttons below`); } };
  if ($f('#ivPaid')) $f('#ivPaid').onclick = () => { readAcoInvoice(); curInv.paidAt = new Date().toISOString(); curInv.paidVia = $('#ivPaidVia').value; if (invCommit('paid')) { renderAcoInvoice(); toast(`${curInv.number} paid 👑`, { undo: true }); } };
  if ($f('#ivVoid')) $f('#ivVoid').onclick = async () => { if (curInv.status === 'paid') { delete curInv.paidAt; delete curInv.paidVia; if (invCommit('sent')) renderAcoInvoice(); return; } if (!await ask(`Void ${curInv.number}?\n\nIts checkouts go back to “not invoiced”.`)) return; if (invCommit('void')) renderAcoInvoice(); };
  if ($f('#ivReopen')) $f('#ivReopen').onclick = () => { const busy = curInv.lines.some(l => l.checkoutId && (acoCk(l.checkoutId) || {}).invoiceId && acoCk(l.checkoutId).invoiceId !== curInv.id); if (busy) { toast('Some of its checkouts are on another invoice now'); return; } if (invCommit('sent')) renderAcoInvoice(); };
  if ($f('#ivDelete')) $f('#ivDelete').onclick = async () => { if (!await ask('Delete this invoice?')) return; snapshot('delete invoice'); (state.acoCheckouts || []).forEach(k => { if (k.invoiceId === curInv.id) { k.invoiceId = ''; k.updatedAt = Date.now(); } }); state.acoInvoices = state.acoInvoices.filter(i => i.id !== curInv.id); save(); closeDlg('dlgAcoInv'); refresh(); toast('Invoice deleted', { undo: true }); };
  if ($('#ivView')) $('#ivView').onclick = () => { readAcoInvoice(); window.open(invLink(curInv), '_blank', 'noopener'); };
  if ($('#ivCopyLink')) $('#ivCopyLink').onclick = () => { readAcoInvoice(); copyText(invLink(curInv), 'Invoice link'); };
  if ($('#ivCopyText')) $('#ivCopyText').onclick = () => { readAcoInvoice(); copyText(invText(curInv), 'Message'); };
  if ($('#ivEmail')) $('#ivEmail').onclick = () => { readAcoInvoice(); const cl = acoClient(curInv.clientId); location.href = `mailto:${encodeURIComponent(cl.email)}?subject=${encodeURIComponent(`Invoice ${curInv.number}${acoCfg().business ? ' from ' + acoCfg().business : ''}`)}&body=${encodeURIComponent(invText(curInv))}`; };
  if ($('#ivStripe')) $('#ivStripe').onclick = async e => {
    readAcoInvoice(); e.target.disabled = true; e.target.textContent = 'Making the link…';
    try { const cl = acoClient(curInv.clientId) || {}; const r = await api('/api/aco/stripe/link', { key: acoCfg().stripeKey, amount: Math.round(acoInvTotal(curInv) * 100), name: `Invoice ${curInv.number}${acoCfg().business ? ' — ' + acoCfg().business : ''}`, invoice: curInv.number, client: cl.name || '' }); curInv.stripe = { url: r.url, link: r.id, at: Date.now() }; invCommit(curInv.status); renderAcoInvoice(); toast('Card payment link added — it’s on the invoice now'); }
    catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = 'Add card payment link'; }
  };
  if ($('#ivStripeCheck')) $('#ivStripeCheck').onclick = async () => { const n = await acoCheckStripe([acoInvoice(curInv.id)], true); curInv = JSON.parse(JSON.stringify(acoInvoice(curInv.id))); renderAcoInvoice(); toast(n ? 'Paid by card 👑' : 'No card payment yet'); };
}
// card payments: ask Stripe whether each sent invoice's payment link has been paid
async function acoCheckStripe(list, manual) {
  const key = acoCfg().stripeKey; if (!key || !SERVER) return 0;
  let n = 0;
  for (const inv of list.filter(i => i && i.status === 'sent' && i.stripe && i.stripe.link)) {
    try {
      const r = await api('/api/aco/stripe/check', { key, link: inv.stripe.link });
      inv.stripe.checkedAt = Date.now(); inv.updatedAt = Date.now();
      if (r.paid) { inv.status = 'paid'; inv.paidAt = r.paidAt || new Date().toISOString(); inv.paidVia = 'Card'; n++; const cl = acoClient(inv.clientId); if (typeof addNotif === 'function') addNotif('invoice', `${inv.number} paid by card`, `${cl ? cl.name : ''} · ${fmtMoney(acoInvTotal(inv))}`, 'aco', 'paid:' + inv.id); }
    } catch (e) { if (manual) toast(e.message); }
  }
  save(); if (n && route.page === 'aco') PAGES.aco.render();
  return n;
}
function acoAutoCheckStripe() { if (Date.now() - ACO.stripeChecked < 5 * 60e3) return; ACO.stripeChecked = Date.now(); const l = (state.acoInvoices || []).filter(i => i.status === 'sent' && i.stripe && i.stripe.link); if (l.length) setTimeout(() => acoCheckStripe(l, false), 800); }
// once a day: invoices that just went past their due date
function acoOverdueNotifs() { let n = 0; for (const i of state.acoInvoices || []) if (acoOverdue(i)) { const cl = acoClient(i.clientId); if (typeof addNotif === 'function' && addNotif('invoice', `${i.number} is overdue`, `${cl ? cl.name : ''} · ${fmtMoney(acoInvTotal(i))} · was due ${fmtDate(i.due)}`, 'aco', 'overdue:' + i.id + ':' + i.due)) n++; } return n; }
function wireAco() { wireAcoClient(); wireAcoCk(); }

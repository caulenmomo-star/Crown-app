/* Crown Tools Admin - a separate website for the owner: customers, free access, billing settings, discounts, activity. */
'use strict';
const API = (window.CROWN_API || (/^(localhost|127\.)/.test(location.hostname) ? location.origin.replace(/:\d+$/, ':' + (new URLSearchParams(location.search).get('api') || '8870')) : 'https://crowntools.vercel.app')) + '/api';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let token = sessionStorage.getItem('ct.admin') || '', me = sessionStorage.getItem('ct.adminEmail') || '';
let tab = sessionStorage.getItem('ct.tab') || 'dash', U = { q: '', filter: 'all' }, SET = null;

async function api(path, body) {
  const headers = { 'X-Crown': '1' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  let res, j = null;
  try { res = await fetch(API + path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' }); }
  catch (_) { throw new Error('Can’t reach Crown Tools. Check your connection.'); }
  try { j = await res.json(); } catch (_) { }
  if (!j || j.ok === false) {
    const e = new Error((j && j.error) || 'Request failed (' + res.status + ')'); e.data = j || {};
    if (j && j.auth && token && !/login|setup|password/.test(path)) { signOut('Your admin session ended. Sign in again.'); }
    throw e;
  }
  return j;
}
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2600); }
const money = (c, cur) => (Number(c || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: (cur || 'usd').toUpperCase() });
const det = d => esc(d || '').replace(/@(\d{9,})/g, (m, t) => date(+t));
const date = t => t ? new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const dtime = t => t ? new Date(t * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const REASON = { active: 'Paying', trial: 'Trial', free: 'Free access', grace: 'Payment failed', verify: 'Email not confirmed', unpaid: 'Not subscribed', canceled: 'Canceled', expired: 'Free access ended', suspended: 'Suspended' };
const badge = r => `<span class="badge b-${esc(r.suspended ? 'suspended' : r.reason)}">${esc(r.suspended ? 'Suspended' : REASON[r.reason] || r.reason)}</span>`;
function planText(r) {
  if (r.reason === 'free') return r.compUntil === 'forever' ? 'Free, no end date' : 'Free until ' + date(r.compUntil);
  if (r.subStatus && r.periodEnd) return (r.cancelAtPeriodEnd ? 'Ends ' : r.reason === 'trial' ? 'Trial ends ' : 'Renews ') + date(r.periodEnd);
  return r.subStatus || '—';
}

/* ---------- sign in / first-time setup ---------- */
function b32() { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; const b = crypto.getRandomValues(new Uint8Array(20)); let bits = '', out = ''; b.forEach(x => bits += x.toString(2).padStart(8, '0')); for (let i = 0; i + 5 <= bits.length; i += 5) out += a[parseInt(bits.slice(i, i + 5), 2)]; return out; }
async function gate(msg) {
  $('#app').hidden = true; $('#gate').hidden = false;
  let st; try { st = await api('/admin/status'); } catch (e) { $('#gateBox').innerHTML = `<h1><span class="mark">♛</span>Crown Tools Admin</h1><div class="err">${esc(e.message)}</div>`; return; }
  if (!st.setup) return setupForm();
  $('#gateBox').innerHTML = `<h1><span class="mark">♛</span>Crown Tools Admin</h1><div class="muted small">Owner sign-in. Customers can’t use this site.</div>
    ${msg ? `<div class="note">${esc(msg)}</div>` : ''}
    <label>Email</label><input id="gEmail" type="email" autocomplete="username" value="${esc(me)}">
    <label>Password</label><input id="gPw" type="password" autocomplete="current-password">
    <label>6-digit code from your authenticator app</label><input id="gCode" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123456">
    <button class="primary" id="gGo">Sign in</button><div class="err" id="gErr"></div>`;
  const go = async () => {
    $('#gGo').disabled = true; $('#gErr').textContent = '';
    try { const r = await api('/admin/login', { email: $('#gEmail').value, password: $('#gPw').value, code: $('#gCode').value }); token = r.token; me = r.email; sessionStorage.setItem('ct.admin', token); sessionStorage.setItem('ct.adminEmail', me); start(); }
    catch (e) { $('#gErr').textContent = e.message; } finally { if ($('#gGo')) $('#gGo').disabled = false; }
  };
  $('#gGo').onclick = go; ['#gEmail', '#gPw', '#gCode'].forEach(s => $(s).addEventListener('keydown', e => { if (e.key === 'Enter') go(); }));
  setTimeout(() => (me ? $('#gPw') : $('#gEmail')).focus(), 50);
}
function setupForm() {
  const secret = b32(); const pretty = secret.match(/.{1,4}/g).join(' ');
  $('#gateBox').innerHTML = `<h1><span class="mark">♛</span>Set up your admin account</h1>
    <div class="muted small">One time only. You need the setup code from your Crown Tools project settings.</div>
    <label>Setup code</label><input id="sCode" autocomplete="off" autocapitalize="characters" placeholder="XXXX-XXXX-XXXX">
    <label>Your email</label><input id="sEmail" type="email" autocomplete="username">
    <label>Admin password (at least 10 characters)</label><input id="sPw" type="password" autocomplete="new-password">
    <label>Confirm password</label><input id="sPw2" type="password" autocomplete="new-password">
    <div class="sec">2-step sign-in</div>
    <div class="small muted">Add Crown Tools Admin to an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password or iPhone Passwords). On your phone, tap the button. On a computer, choose “Enter a setup key” in the app and type this key:</div>
    <div class="secret" style="margin-top:10px">${pretty}</div>
    <div class="actions"><a class="badge" style="padding:8px 12px" href="otpauth://totp/Crown%20Tools%20Admin?secret=${secret}&issuer=Crown%20Tools">Add to authenticator app</a><button id="sCopy">Copy key</button></div>
    <label>Then enter the 6-digit code it shows</label><input id="sTotp" inputmode="numeric" autocomplete="one-time-code" maxlength="7">
    <button class="primary" id="sGo">Create admin account</button><div class="err" id="sErr"></div>`;
  $('#sCopy').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(secret).then(() => toast('Key copied')); };
  $('#sGo').onclick = async () => {
    $('#sErr').textContent = '';
    if ($('#sPw').value !== $('#sPw2').value) { $('#sErr').textContent = 'Passwords don’t match.'; return; }
    $('#sGo').disabled = true;
    try { await api('/admin/setup', { code: $('#sCode').value, email: $('#sEmail').value, password: $('#sPw').value, totpSecret: secret, totpCode: $('#sTotp').value }); me = $('#sEmail').value.trim().toLowerCase(); gate('Admin account created. Sign in with a fresh code.'); }
    catch (e) { $('#sErr').textContent = e.message; $('#sGo').disabled = false; }
  };
}
async function signOut(msg) { try { if (token) await fetch(API + '/admin/logout', { method: 'POST', headers: { 'X-Crown': '1', Authorization: 'Bearer ' + token } }); } catch (_) { } token = ''; sessionStorage.removeItem('ct.admin'); gate(msg); }

/* ---------- app shell ---------- */
const TABS = [['dash', 'Dashboard'], ['users', 'Customers'], ['settings', 'Pricing & settings'], ['coupons', 'Discount codes'], ['activity', 'Activity']];
function start() {
  $('#gate').hidden = true; $('#gateBox').innerHTML = ''; $('#app').hidden = false; $('#whoEmail').textContent = me;
  $('#signOut').onclick = () => signOut();
  renderTabs(); show(tab);
}
function renderTabs() { $('#tabs').innerHTML = TABS.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join(''); $$('#tabs [data-t]').forEach(b => b.onclick = () => show(b.dataset.t)); }
async function show(t) { tab = t; sessionStorage.setItem('ct.tab', t); renderTabs(); $('#main').innerHTML = '<div class="muted">Loading…</div>'; try { await VIEWS[t](); } catch (e) { $('#main').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; } }

const VIEWS = {
  async dash() {
    const { stats: s, settings } = await api('/admin/stats'); SET = settings;
    const k = (l, v, d) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;
    const check = (ok, t, help) => `<li><span class="${ok ? 'okdot' : 'nodot'}"></span><div><b>${t}</b>${ok ? '' : `<div class="small muted">${help}</div>`}</div></li>`;
    $('#main').innerHTML = `<h2>Dashboard</h2>
      <div class="kpis">${k('Monthly revenue', money(s.mrrCents, s.currency), 'estimated from paying customers')}${k('Paying', s.paying)}${k('Have access', s.access, `${s.trial} trial · ${s.free} free`)}${k('Waiting to pay', s.unpaid, 'signed up, no access')}${k('Payment failed', s.pastDue)}${k('Canceled', s.canceled)}${k('New this week', s.new7, s.new30 + ' in 30 days')}${k('All accounts', s.total, s.suspended ? s.suspended + ' suspended' : '')}</div>
      <div class="card"><h3>Launch checklist</h3><ul class="checklist">
        ${check(s.billingReady, 'Payments connected (Stripe ' + (s.stripeMode === 'live' ? 'LIVE' : 'test mode') + ')', 'Add STRIPE_SECRET_KEY to the Crown Tools project in Vercel.')}
        ${check(s.webhookReady, 'Stripe webhook connected', 'In Stripe, add a webhook to https://crowntools.vercel.app/api/billing/webhook and put its signing secret in STRIPE_WEBHOOK_SECRET.')}
        ${check(s.mailReady, 'Emails can be sent (confirmations, password resets)', 'Add CROWN_SMTP_USER and CROWN_SMTP_PASS (a Gmail app password) in Vercel. Until then sign-ups don’t need to confirm their email.')}
        ${check(settings.signupsOpen, 'Sign-ups are open', 'Turn on sign-ups under Pricing & settings.')}
        ${check(s.stripeMode === 'live', 'Taking real payments', 'You’re in Stripe test mode. Switch to live keys when you’re ready to charge.')}
      </ul></div>
      ${s.legacyData ? '<div class="note warn">Your earlier single-user Crown Tools data is still waiting to be moved into an account. Create your account in the app with “I have a setup code”.</div>' : ''}`;
  },
  async users() {
    $('#main').innerHTML = `<h2>Customers</h2>
      <div class="toolbar"><input id="uq" placeholder="Search email, note…" value="${esc(U.q)}">
        <div class="chips">${[['all', 'All'], ['access', 'Has access'], ['paying', 'Paying'], ['free', 'Free'], ['trial', 'Trial'], ['waiting', 'Waiting to pay'], ['pastdue', 'Payment failed'], ['unverified', 'Unconfirmed email'], ['suspended', 'Suspended']].map(([v, l]) => `<button class="chip ${U.filter === v ? 'on' : ''}" data-f="${v}">${l}</button>`).join('')}</div></div>
      <div id="ulist"><div class="muted">Loading…</div></div>`;
    let t; $('#uq').oninput = e => { clearTimeout(t); t = setTimeout(() => { U.q = e.target.value; loadUsers(); }, 250); };
    $$('[data-f]').forEach(b => b.onclick = () => { U.filter = b.dataset.f; $$('[data-f]').forEach(x => x.classList.toggle('on', x === b)); loadUsers(); });
    loadUsers();
  },
  async settings() {
    const { settings: s } = await api('/admin/stats'); SET = s;
    $('#main').innerHTML = `<h2>Pricing & settings</h2>
      <div class="card"><h3>Subscription</h3>
        <div class="row"><div><label>Monthly price</label><input id="sPrice" inputmode="decimal" value="${(s.priceCents / 100).toFixed(2)}"></div>
        <div><label>Currency</label><select id="sCur">${['usd', 'cad', 'gbp', 'eur', 'aud'].map(c => `<option ${c === s.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div><label>Free trial (days, 0 = none)</label><input id="sTrial" inputmode="numeric" value="${s.trialDays}"></div>
        <div><label>Grace period after a failed payment (days)</label><input id="sGrace" inputmode="numeric" value="${s.graceDays}"></div></div>
        <div class="small muted" style="margin-top:8px">New subscribers pay the new price. Existing subscribers keep the price they signed up at until you change them in Stripe.</div></div>
      <div class="card"><h3>Sign-ups</h3>
        <label class="row" style="align-items:center;gap:10px;color:var(--text)"><input type="checkbox" id="sOpen" ${s.signupsOpen ? 'checked' : ''} style="flex:0"> <span>Anyone can create an account</span></label>
        <label class="row" style="align-items:center;gap:10px;color:var(--text)"><input type="checkbox" id="sVer" ${s.requireVerify ? 'checked' : ''} style="flex:0"> <span>Customers must confirm their email before they can pay (only when email sending is set up)</span></label></div>
      <div class="card"><h3>Announcement</h3><div class="small muted">Shown to every customer at the top of the app and on the sign-in screen. Leave empty for none.</div>
        <textarea id="sAnn" rows="3" style="margin-top:8px">${esc(s.announcement)}</textarea></div>
      <button class="primary" id="sSave" style="width:auto;padding:10px 22px">Save settings</button><span class="err" id="sErr"></span>
      <div class="card" style="margin-top:18px"><h3>Admin password</h3><div class="row"><div><label>Current password</label><input id="pOld" type="password"></div><div><label>New password</label><input id="pNew" type="password"></div></div><div class="actions"><button id="pGo">Change password</button></div></div>`;
    $('#sSave').onclick = async () => {
      $('#sErr').textContent = '';
      const price = Math.round(parseFloat($('#sPrice').value.replace(/[^0-9.]/g, '')) * 100);
      if (!(price >= 50)) { $('#sErr').textContent = 'Enter a price, like 15.00'; return; }
      try { await api('/admin/settings', { priceCents: price, currency: $('#sCur').value, trialDays: +$('#sTrial').value || 0, graceDays: +$('#sGrace').value || 0, signupsOpen: $('#sOpen').checked, requireVerify: $('#sVer').checked, announcement: $('#sAnn').value }); toast('Settings saved'); }
      catch (e) { $('#sErr').textContent = e.message; }
    };
    $('#pGo').onclick = async () => { try { await api('/admin/password', { old: $('#pOld').value, new: $('#pNew').value }); toast('Admin password changed'); $('#pOld').value = $('#pNew').value = ''; } catch (e) { toast(e.message); } };
  },
  async coupons() {
    const r = await api('/admin/coupons');
    $('#main').innerHTML = `<h2>Discount codes</h2>
      ${r.billingReady ? '' : '<div class="note warn">Connect Stripe first (see the Dashboard checklist).</div>'}
      <div class="card"><h3>New code</h3><div class="row">
        <div><label>Code</label><input id="cCode" placeholder="LAUNCH50" autocapitalize="characters"></div>
        <div><label>Percent off</label><input id="cPct" inputmode="numeric" placeholder="50"></div>
        <div><label>…or dollars off</label><input id="cAmt" inputmode="decimal" placeholder="5.00"></div>
        <div><label>How long</label><select id="cDur"><option value="once">First month only</option><option value="repeating">Several months</option><option value="forever">Every month</option></select></div>
        <div id="cMonW" hidden><label>Months</label><input id="cMon" inputmode="numeric" value="3"></div></div>
        <div class="actions"><button class="primary" id="cGo" ${r.billingReady ? '' : 'disabled'} style="width:auto">Create code</button></div>
        <div class="small muted">Customers type the code on the Stripe checkout page.</div></div>
      <div class="tw"><table><thead><tr><th>Code</th><th>Discount</th><th>Lasts</th><th>Used</th><th></th></tr></thead><tbody>
        ${r.coupons.map(c => `<tr><td class="mono">${esc(c.code)}</td><td>${c.percentOff ? c.percentOff + '%' : money(c.amountOff)} off</td><td>${c.duration === 'repeating' ? c.months + ' months' : c.duration === 'once' ? 'first month' : 'forever'}</td><td>${c.times}</td><td>${c.active ? `<button class="danger" data-off="${esc(c.id)}">Turn off</button>` : '<span class="faint">off</span>'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No codes yet.</td></tr>'}</tbody></table></div>`;
    $('#cDur').onchange = () => { $('#cMonW').hidden = $('#cDur').value !== 'repeating'; };
    $('#cGo').onclick = async () => {
      const amt = $('#cAmt').value ? Math.round(parseFloat($('#cAmt').value) * 100) : 0;
      try { await api('/admin/coupon', { code: $('#cCode').value, percentOff: +$('#cPct').value || 0, amountOffCents: amt, duration: $('#cDur').value, months: +$('#cMon').value || 1 }); toast('Code created'); show('coupons'); } catch (e) { toast(e.message); }
    };
    $$('[data-off]').forEach(b => b.onclick = async () => { try { await api('/admin/coupon/off', { id: b.dataset.off }); show('coupons'); } catch (e) { toast(e.message); } });
  },
  async activity() {
    const r = await api('/admin/audit');
    $('#main').innerHTML = `<h2>Activity</h2><div class="card log">${r.log.map(x => `<div><span class="faint">${dtime(x.at)}</span> · <b>${esc(x.actor)}</b> ${esc(x.action)} ${x.detail ? '<span class="muted">' + det(x.detail) + '</span>' : ''}</div>`).join('') || '<div class="muted">Nothing yet.</div>'}</div>`;
  },
};

async function loadUsers() {
  const r = await api('/admin/users?q=' + encodeURIComponent(U.q) + '&filter=' + U.filter);
  $('#ulist').innerHTML = `<div class="small muted" style="margin-bottom:8px">${r.total} account${r.total === 1 ? '' : 's'}</div>
    <div class="tw"><table class="users"><thead><tr><th>Email</th><th>Status</th><th>Plan</th><th>Joined</th><th>Last used</th></tr></thead><tbody>
    ${r.users.map(u => `<tr data-u="${u.id}"><td class="e">${esc(u.email)}${u.verified ? '' : ' <span class="faint small">unconfirmed</span>'}</td><td class="s">${badge(u)}</td><td class="m">${esc(planText(u))}${u.note ? ' · ' + esc(u.note) : ''}</td><td class="x">${date(u.createdAt)}</td><td class="x">${date(u.lastSeen)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No accounts match.</td></tr>'}</tbody></table></div>`;
  $$('[data-u]').forEach(tr => tr.onclick = () => openUser(tr.dataset.u));
}

async function openUser(id) {
  const d = $('#dlg'); $('#dlgBody').innerHTML = '<div class="db muted">Loading…</div>'; if (!d.open) d.showModal();
  let u; try { u = (await api('/admin/user/' + id)).user; } catch (e) { $('#dlgBody').innerHTML = `<div class="db err">${esc(e.message)}</div>`; return; }
  const test = !/live/.test(u.customerId || '') ? 'test/' : '';
  $('#dlgBody').innerHTML = `<div class="dh"><b>${esc(u.email)}</b>${badge(u)}<button class="ghost" id="dX">✕</button></div><div class="db">
    <div class="kv"><div class="k">Access</div><div>${u.access ? 'Yes' : 'No'} — ${esc(REASON[u.reason] || u.reason)}</div>
      <div class="k">Plan</div><div>${esc(planText(u))}</div>
      <div class="k">Stripe</div><div>${u.customerId ? `<a href="https://dashboard.stripe.com/${test}customers/${esc(u.customerId)}" target="_blank" rel="noopener">${esc(u.customerId)}</a> · ${esc(u.subStatus || 'no subscription')}` : '—'}</div>
      <div class="k">Email confirmed</div><div>${u.verified ? 'Yes' : 'No'}</div>
      <div class="k">Joined</div><div>${dtime(u.createdAt)} · agreed to ${money(u.agreedPrice)}/mo</div>
      <div class="k">Last used</div><div>${dtime(u.lastSeen)}</div>
      <div class="k">Data</div><div>${Math.round((u.vaultSize || 0) / 1024)} KB encrypted · ${u.backups} backups</div></div>
    <div class="sec">Free access (skip payment)</div>
    <div class="chips">${[[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year']].map(([v, l]) => `<button class="chip" data-g="${v}">${l}</button>`).join('')}<button class="chip" data-g="forever">No end date</button></div>
    <div class="row" style="margin-top:8px"><div><label>…or until a date</label><input type="date" id="gUntil"></div><div><label>Custom days</label><input id="gDays" inputmode="numeric" placeholder="14"></div><div><label>Note (who/why)</label><input id="gNote" placeholder="Friend, giveaway…" value="${esc(u.compNote)}"></div></div>
    <label style="display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" id="gExtend" checked> Add to any free time they already have</label>
    <div class="actions"><button class="primary" id="grantGo" style="width:auto">Give free access</button>${u.compUntil ? '<button id="gRevoke">Remove free access</button>' : ''}</div>
    <div class="sec">Account</div>
    <div class="actions">${u.suspended ? '<button id="aUnsus">Unsuspend</button>' : '<button class="danger" id="aSus">Suspend</button>'}${u.verified ? '' : '<button id="aVer">Mark email confirmed</button><button id="aRes">Resend confirmation</button>'}${u.customerId ? '<button id="aSync">Refresh from Stripe</button>' : ''}</div>
    <label>Private note</label><div class="row"><input id="aNote" value="${esc(u.note)}"><button id="aNoteGo" style="flex:0 0 auto">Save note</button></div>
    <div class="sec">History</div><div class="log">${u.history.map(x => `<div><span class="faint">${dtime(x.at)}</span> · ${esc(x.actor)} ${esc(x.action)} <span class="muted">${det(x.detail)}</span></div>`).join('') || '<div class="muted">—</div>'}</div>
    <div class="sec">Danger zone</div><div class="actions"><button class="danger" id="aDel">Delete account…</button></div>
    <div class="err" id="uErr"></div></div>`;
  const act = async (what, body, msg) => { $('#uErr').textContent = ''; try { const r = await api(`/admin/user/${id}/${what}`, body || {}); toast(msg || 'Done'); if (r.deleted) { d.close(); loadUsers(); return; } openUser(id); if ($('#ulist')) loadUsers(); } catch (e) { $('#uErr').textContent = e.message; } };
  $('#dX').onclick = () => d.close();
  $$('[data-g]').forEach(b => b.onclick = () => act('grant', b.dataset.g === 'forever' ? { forever: true, note: $('#gNote').value } : { days: +b.dataset.g, extend: $('#gExtend').checked, note: $('#gNote').value }, 'Free access given'));
  $('#grantGo').onclick = () => { const until = $('#gUntil').value, days = +$('#gDays').value; if (until) act('grant', { until: new Date(until + 'T23:59:59').getTime() / 1000, note: $('#gNote').value }, 'Free access given'); else if (days) act('grant', { days, extend: $('#gExtend').checked, note: $('#gNote').value }, 'Free access given'); else $('#uErr').textContent = 'Pick a length, a date or a number of days.'; };
  if ($('#gRevoke')) $('#gRevoke').onclick = () => act('revoke', {}, 'Free access removed');
  if ($('#aSus')) $('#aSus').onclick = () => act('suspend', { note: $('#aNote').value }, 'Suspended');
  if ($('#aUnsus')) $('#aUnsus').onclick = () => act('unsuspend', {}, 'Unsuspended');
  if ($('#aVer')) $('#aVer').onclick = () => act('verify', {}, 'Marked confirmed');
  if ($('#aRes')) $('#aRes').onclick = () => act('resend', {}, 'Confirmation sent');
  if ($('#aSync')) $('#aSync').onclick = () => act('sync', {}, 'Refreshed');
  $('#aNoteGo').onclick = () => act('note', { note: $('#aNote').value }, 'Note saved');
  $('#aDel').onclick = () => {
    $('#aDel').outerHTML = `<div style="flex:1 1 100%"><div class="small muted">This cancels their subscription and erases their data for good. Type <b>${esc(u.email)}</b> to confirm.</div><div class="row" style="margin-top:6px"><input id="aDelT" autocomplete="off"><button class="danger" id="aDelGo" style="flex:0 0 auto">Delete for good</button></div></div>`;
    $('#aDelGo').onclick = () => act('delete', { confirm: $('#aDelT').value }, 'Account deleted');
  };
}

if (token) { api('/admin/stats').then(start).catch(() => gate()); } else gate();

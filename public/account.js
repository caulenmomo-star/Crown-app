/* Crown Tools Online - accounts: sign in, create account (with the price up front), confirm email, subscribe,
   forgot password, and the Account card in Settings. Only used online; the Mac/Windows app keeps its own lock screen. */
'use strict';
const Account = (() => {
  let acct = null;          // { email, ... } from the server once signed in
  let keys = null;          // { key, auth, salt } derived from the password, kept in memory only
  let panel = 'signin';
  let notice = '';
  const P = () => cloudInfo.price || { cents: 1500, currency: 'usd', trialDays: 0 };
  const money = (c, cur) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: (cur || 'usd').toUpperCase(), minimumFractionDigits: c % 100 ? 2 : 0 });
  const priceText = () => money(P().cents, P().currency) + '/month';
  const remember = e => { try { localStorage.setItem('crown.email', e); } catch (_) { } };
  const remembered = () => { try { return localStorage.getItem('crown.email') || ''; } catch (_) { return ''; } };
  const params = new URLSearchParams(location.search);
  const urlVerify = params.get('verify'), urlReset = params.get('reset'), urlBilling = params.get('billing');
  if (urlVerify || urlReset || urlBilling) history.replaceState(null, '', location.pathname + location.hash);

  function show(msg) {
    $('#app').hidden = true; $('#lock').hidden = true; $('#acct').hidden = false;
    if (msg) notice = msg;
    render();
  }
  function setPanel(p, msg) { panel = p; notice = msg || ''; render(); }
  function errBox(t) { return `<div class="err" id="acErr">${esc(t || '')}</div>`; }
  function head(sub) { return `<div class="logo">${$('#lock .logo').innerHTML}</div>${sub ? `<div class="muted small acsub">${sub}</div>` : ''}${notice ? `<div class="note good acnote">${esc(notice)}</div>` : ''}`; }
  function render() {
    const box = $('#acctBox'); const pr = priceText();
    const ann = cloudInfo.announcement ? `<div class="note acnote">${esc(cloudInfo.announcement)}</div>` : '';
    if (panel === 'signin') {
      box.innerHTML = head('Sign in to your account.') + ann + `
        <div class="field"><label for="acEmail">Email</label><input id="acEmail" type="email" autocomplete="username" inputmode="email" autocapitalize="off" value="${esc(remembered())}"></div>
        <div class="field"><label for="acPw">Password</label><input id="acPw" type="password" autocomplete="current-password"></div>
        <button class="primary" id="acGo">Sign in</button>${errBox()}
        <div class="hstack acfoot"><button class="linkbtn" data-ap="forgot">Forgot password?</button><span class="spacer"></span>${cloudInfo.signupsOpen !== false ? '<button class="linkbtn" data-ap="signup">Create an account</button>' : ''}</div>`;
      $('#acGo').onclick = signIn; enter(['#acEmail', '#acPw'], signIn);
      focusFirst(remembered() ? '#acPw' : '#acEmail');
    } else if (panel === 'signup') {
      box.innerHTML = head('Create your Crown Tools account.') + `
        <div class="pricecard"><div class="pc1"><b>${esc(pr)}</b>${P().trialDays ? ` <span class="badge">${P().trialDays}-day free trial</span>` : ''}</div>
          <div class="small muted">Crown Tools is a paid monthly subscription. Creating an account is free — you’ll subscribe on the next screen to start using it. Cancel anytime.</div></div>
        <div class="field"><label for="acEmail">Email</label><input id="acEmail" type="email" autocomplete="username" inputmode="email" autocapitalize="off"></div>
        <div class="field"><label for="acPw">Password</label><input id="acPw" type="password" autocomplete="new-password" placeholder="At least ${MIN_PW} characters"></div>
        <div class="field"><label for="acPw2">Confirm password</label><input id="acPw2" type="password" autocomplete="new-password"></div>
        <div class="note warn small">Your password also locks your data on this device — nobody, not even Crown Tools, can read it or recover it. If you forget it, you can reset it but you’ll start with empty data.</div>
        <label class="check accheck"><input type="checkbox" id="acAgree"> <span>I understand Crown Tools costs <b>${esc(pr)}</b> after I create my account, and I agree to the <a href="terms.html" target="_blank" rel="noopener">Terms</a> and <a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.</span></label>
        <div class="field" id="acClaimWrap" hidden><label for="acClaim">Setup code (only to bring over data from your earlier Crown Tools)</label><input id="acClaim" autocomplete="off" autocapitalize="characters" placeholder="XXXX-XXXX-XXXX"></div>
        <button class="primary" id="acGo">Create account</button>${errBox()}
        <div class="hstack acfoot"><button class="linkbtn" data-ap="signin">I already have an account</button><span class="spacer"></span><button class="linkbtn" id="acShowClaim">I have a setup code</button></div>`;
      $('#acGo').onclick = signUp; enter(['#acEmail', '#acPw', '#acPw2'], signUp);
      $('#acShowClaim').onclick = () => { $('#acClaimWrap').hidden = false; $('#acShowClaim').hidden = true; $('#acClaim').focus(); };
      focusFirst('#acEmail');
    } else if (panel === 'forgot') {
      box.innerHTML = head('Forgot your password?') + `
        <div class="small muted" style="margin-top:6px">We’ll email you a link to choose a new one. Because your data is locked with your old password, resetting starts you with empty data. Backups made with the old password can still be restored if you remember it later.</div>
        <div class="field"><label for="acEmail">Email</label><input id="acEmail" type="email" autocomplete="username" value="${esc(remembered())}"></div>
        <button class="primary" id="acGo">Email me a reset link</button>${errBox()}
        <div class="hstack acfoot"><button class="linkbtn" data-ap="signin">Back to sign in</button></div>`;
      $('#acGo').onclick = forgot; enter(['#acEmail'], forgot); focusFirst('#acEmail');
    } else if (panel === 'reset') {
      box.innerHTML = head('Choose a new password.') + `
        <div class="note warn small">Your old data stays locked with the old password, so you’ll start with empty data. Your subscription is not affected.</div>
        <div class="field"><label for="acPw">New password</label><input id="acPw" type="password" autocomplete="new-password"></div>
        <div class="field"><label for="acPw2">Confirm new password</label><input id="acPw2" type="password" autocomplete="new-password"></div>
        <button class="primary" id="acGo">Save new password</button>${errBox()}`;
      $('#acGo').onclick = resetPw; enter(['#acPw', '#acPw2'], resetPw); focusFirst('#acPw');
    } else if (panel === 'verify') {
      box.innerHTML = head('Confirm your email') + `
        <div class="small muted" style="margin:8px 0 14px">We sent a link to <b>${esc(acct.email)}</b>. Open it on any device, then come back here.</div>
        <button class="primary" id="acCheck">I’ve confirmed it — continue</button>
        <button id="acResend" style="width:100%;margin-top:8px">Send the link again</button>${errBox()}
        <div class="hstack acfoot"><button class="linkbtn" id="acOut">Sign out</button></div>`;
      $('#acCheck').onclick = () => afterAuth(true);
      $('#acResend').onclick = async () => { try { await api('/api/auth/resend', {}); notice = 'Sent — check your inbox (and spam).'; render(); } catch (e) { $('#acErr').textContent = e.message; } };
      $('#acOut').onclick = signOut;
    } else if (panel === 'paywall') {
      const r = acct.reason;
      const why = { canceled: 'Your subscription has ended.', expired: 'Your free access has ended.', suspended: 'This account is suspended. Contact support if you think this is a mistake.', unpaid: '' }[r] || '';
      const sub = acct.sub || {};
      const pastDue = sub.status === 'past_due' || sub.status === 'unpaid';
      box.innerHTML = head(why || 'One more step: start your subscription.') + ann + (r === 'suspended' ? '' : `
        <div class="pricecard big"><div class="pc1"><b>${esc(priceText())}</b>${P().trialDays && !acct.trialUsed ? ` <span class="badge">${P().trialDays}-day free trial</span>` : ''}</div>
          <ul class="plist"><li>Profiles for Valor, Hayha, Stellar, Shikari and AYCD</li><li>Orders read from your email automatically</li><li>Houses, delivery calendar and spending</li><li>Works on your phone, iPad, Windows and Mac</li><li>Encrypted — only you can read your data</li></ul></div>
        ${pastDue ? '<div class="note warn small">Your last payment didn’t go through. Update your card to keep using Crown Tools.</div>' : ''}
        ${cloudInfo.billingReady ? `<button class="primary" id="acPay">${pastDue && sub.hasCustomer ? 'Update payment method' : 'Subscribe — ' + esc(priceText())}</button><div class="small faint" style="margin-top:8px;text-align:center">Secure checkout by Stripe. Have a discount code? Enter it at checkout.</div>` : '<div class="note warn">Subscriptions open soon. You’ll get access as soon as the owner turns them on.</div>'}`) + `
        ${errBox()}
        <div class="hstack acfoot"><button class="linkbtn" id="acRefresh">Already paid? Check again</button><span class="spacer"></span><button class="linkbtn" id="acExport">Download my data</button><button class="linkbtn" id="acOut">Sign out</button></div>`;
      if ($('#acPay')) $('#acPay').onclick = pay;
      $('#acRefresh').onclick = () => afterAuth(true, true);
      $('#acExport').onclick = exportData;
      $('#acOut').onclick = signOut;
    } else if (panel === 'wait') {
      box.innerHTML = head('Finishing up…') + `<div class="small muted" style="margin-top:8px">Confirming your payment with Stripe. This takes a few seconds.</div>${errBox()}`;
    }
    box.querySelectorAll('[data-ap]').forEach(b => b.onclick = () => setPanel(b.dataset.ap));
  }
  const enter = (sels, fn) => sels.forEach(s => { const el = $(s); if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') fn(); }); });
  const focusFirst = s => setTimeout(() => { const a = document.activeElement; if (!/(iPad|iPhone)/.test(navigator.userAgent) && (!a || a === document.body)) { const el = $(s); if (el && !el.value) el.focus(); } }, 60);
  const busy = (on, label) => { const b = $('#acGo') || $('#acPay'); if (b) { b.disabled = on; if (label) b.dataset.label = b.dataset.label || b.textContent; b.textContent = on ? label : (b.dataset.label || b.textContent); } };
  const fail = e => { const el = $('#acErr'); if (el) el.textContent = e.message || String(e); busy(false); };

  async function signIn() {
    const email = $('#acEmail').value.trim().toLowerCase(), pw = $('#acPw').value;
    if (!email || !pw) return fail(new Error('Enter your email and password.'));
    busy(true, 'Signing in…');
    try {
      const s = await api('/api/auth/salt', { email });
      const k = await deriveKeys(pw, b64d(s.salt));
      keys = { key: k.key, auth: k.auth, salt: b64d(s.salt), pw };
      acctEmail = email; authKey = k.auth;
      const a = await api('/api/account');
      acct = a.account; remember(email);
      await afterAuth();
    } catch (e) { authKey = null; acctEmail = null; keys = null; fail(e); }
  }
  async function signUp() {
    const email = $('#acEmail').value.trim().toLowerCase(), pw = $('#acPw').value, pw2 = $('#acPw2').value;
    const claim = ($('#acClaim') && $('#acClaim').value || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[a-z0-9-]{2,}$/i.test(email)) return fail(new Error('Enter a valid email address.'));
    if (pw.length < MIN_PW) return fail(new Error(PW_HINT));
    if (pw !== pw2) return fail(new Error('Passwords don’t match.'));
    if (!$('#acAgree').checked) return fail(new Error('Please tick the box to confirm the price and Terms.'));
    busy(true, 'Creating account…');
    try {
      let saltBytes = crypto.getRandomValues(new Uint8Array(16));
      if (claim) saltBytes = b64d((await api('/api/auth/legacy', { code: claim })).salt);
      const k = await deriveKeys(pw, saltBytes);
      const json = JSON.stringify(blankState());
      const vault = await encryptJSON(k.key, saltBytes, json);
      const r = await api('/api/auth/signup', { email, authKey: k.auth, salt: b64e(saltBytes), vault, agree: true, claimCode: claim || undefined });
      keys = { key: k.key, auth: k.auth, salt: saltBytes, pw }; acctEmail = email; authKey = k.auth; acct = r.account; remember(email);
      if (r.verifySent) notice = 'Account created. We sent a confirmation link to your email.';
      await afterAuth();
    } catch (e) { authKey = null; acctEmail = null; keys = null; fail(e); }
  }
  async function afterAuth(refresh, syncBilling) {
    try {
      if (refresh || !acct) acct = (await api('/api/account')).account;
      if (!acct.access && (syncBilling || urlBilling === 'success') && acct.sub && acct.sub.hasCustomer !== undefined) {
        // just back from checkout: ask Stripe directly so access turns on without waiting for the webhook
        setPanel('wait');
        for (let i = 0; i < 8 && !acct.access; i++) { try { acct = (await api('/api/billing/sync', {})).account; } catch (_) { } if (!acct.access) await new Promise(r => setTimeout(r, 2000)); }
      }
      if (!acct.access) { notice = urlBilling === 'cancel' ? 'Checkout was canceled — no charge was made.' : notice; setPanel(acct.reason === 'verify' ? 'verify' : 'paywall', notice); return; }
      await openVault();
    } catch (e) { if (e.data && e.data.auth) { signOut(); fail(e); } else fail(e); }
  }
  async function openVault() {
    const r = await api('/api/vault');
    if (!r.vault) throw new Error('Your data couldn’t be found. Contact support.');
    let k = keys.key, s = keys.salt;
    if (r.vault.salt !== b64e(keys.salt)) { s = b64d(r.vault.salt); k = (await deriveKeys(keys.pw, s)).key; }
    let data; try { data = await decryptWithKey(r.vault, k); } catch (_) { throw new Error('Your password doesn’t open your saved data.'); }
    cryptoKey = k; salt = s; state = migrate(data); rev = r.rev; baseJSON = JSON.stringify(data); acct = r.account || acct;
    keys.pw = null; notice = '';
    $('#acct').hidden = true; $('#lock').hidden = true; $('#app').hidden = false; $('#noServerBanner').hidden = true;
    lastActivity = Date.now(); applyRoute(); if (typeof onUnlocked === 'function') onUnlocked();
    showAnnouncement();
  }
  async function pay() {
    busy(true, 'Opening checkout…');
    try {
      const sub = acct.sub || {};
      const r = (sub.status === 'past_due' || sub.status === 'unpaid') && sub.hasCustomer ? await api('/api/billing/portal', {}) : await api('/api/billing/checkout', {});
      location.href = r.url;
    } catch (e) { fail(e); }
  }
  async function forgot() {
    const email = $('#acEmail').value.trim().toLowerCase();
    if (!email) return fail(new Error('Enter your email.'));
    busy(true, 'Sending…');
    try { const r = await api('/api/auth/forgot', { email }); setPanel('signin', r.mailReady ? 'If that email has an account, a reset link is on its way.' : 'Password resets by email aren’t set up yet — contact support.'); }
    catch (e) { fail(e); }
  }
  async function resetPw() {
    const pw = $('#acPw').value, pw2 = $('#acPw2').value;
    if (pw.length < MIN_PW) return fail(new Error(PW_HINT));
    if (pw !== pw2) return fail(new Error('Passwords don’t match.'));
    busy(true, 'Saving…');
    try {
      const s = crypto.getRandomValues(new Uint8Array(16)); const k = await deriveKeys(pw, s);
      const vault = await encryptJSON(k.key, s, JSON.stringify(blankState()));
      const r = await api('/api/auth/reset', { token: urlReset, authKey: k.auth, vault });
      remember(r.email); setPanel('signin', 'Password changed. Sign in with your new password.');
    } catch (e) { fail(e); }
  }
  async function exportData() {
    try { const r = await api('/api/export'); if (!r.vault) throw new Error('No data saved yet.'); download(`crown-tools-backup-${stamp()}.json`, JSON.stringify(r.vault), 'application/json'); }
    catch (e) { fail(e); }
  }
  function signOut() { authKey = null; acctEmail = null; keys = null; acct = null; setPanel('signin'); }
  function showAnnouncement() {
    const t = (acct && acct.announcement) || cloudInfo.announcement; const bar = $('#annBar');
    if (!bar) return; bar.hidden = !t; bar.querySelector('span').textContent = t || '';
  }
  // the server said this account lost access mid-session (subscription ended, suspended…)
  async function lostAccess(reason) {
    if (cryptoKey && (pendingSave || saving)) { try { await saveNow({ force: true }); } catch (_) { } }
    cryptoKey = null; baseJSON = null; state = blankState();
    $$('dialog').forEach(d => d.open && d.close());
    if (typeof onLocked === 'function') onLocked();
    try { acct = (await api('/api/account')).account; } catch (_) { acct = Object.assign({}, acct, { access: false, reason }); }
    show(); setPanel(acct.reason === 'verify' ? 'verify' : 'paywall');
  }
  async function boot() {
    if (urlVerify) {
      try { const r = await api('/api/auth/verify', { token: urlVerify }); remember(r.email); notice = 'Email confirmed. Sign in to continue.'; }
      catch (e) { notice = e.message; }
    }
    if (urlReset) { panel = 'reset'; }
    else if (urlBilling === 'success') notice = 'Payment received — sign in to start using Crown Tools.';
    else if (urlBilling === 'cancel') notice = 'Checkout was canceled — no charge was made. Sign in to try again.';
    show();
  }
  // Settings > Account card
  function card() {
    if (!acct) return '';
    const s = acct.sub || {}, c = acct.comp || {};
    const when = t => t ? new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    let status = '';
    if (acct.reason === 'free') status = c.until === 'forever' ? 'Free access (no end date)' : 'Free access until ' + when(c.until);
    else if (acct.reason === 'trial') status = 'Free trial — first charge ' + when(s.periodEnd);
    else if (acct.reason === 'grace') status = 'Payment failed — update your card by ' + when((s.periodEnd || 0) + (acct.graceDays || 0) * 86400);
    else if (s.cancelAtPeriodEnd) status = 'Canceled — access until ' + when(s.periodEnd);
    else if (acct.reason === 'active') status = 'Subscribed — renews ' + when(s.periodEnd);
    else status = 'No active subscription';
    return `<div class="card" style="margin-bottom:14px"><h3>Account</h3>
      <div class="kv"><div class="k">Email</div><div>${esc(acct.email)}${acct.verified ? '' : ' <span class="badge">not confirmed</span>'}</div>
      <div class="k">Plan</div><div>${esc(status)}</div><div class="k">Price</div><div>${esc(priceText())}</div></div>
      <div class="hstack" style="margin-top:12px">${s.hasCustomer ? '<button id="stBilling">Manage billing</button>' : ''}<button id="stSignOut">Sign out</button><span class="spacer"></span><button class="danger" id="stDelAcct">Delete account</button></div></div>`;
  }
  function wireCard() {
    if ($('#stBilling')) $('#stBilling').onclick = async () => { try { location.href = (await api('/api/billing/portal', {})).url; } catch (e) { toast(e.message); } };
    if ($('#stSignOut')) $('#stSignOut').onclick = () => lock();
    if ($('#stDelAcct')) $('#stDelAcct').onclick = async () => {
      const typed = await askText('Delete your account?\n\nThis cancels your subscription and permanently erases your profiles, orders, inboxes and online backups. Download a backup first if you might want them.\n\nType your email to confirm.', '', { ok: 'Delete account', danger: true, placeholder: acct.email });
      if (typed == null) return;
      if (typed.trim().toLowerCase() !== acct.email) { toast('Email didn’t match — nothing was deleted'); return; }
      try { await api('/api/account/delete', {}); cryptoKey = null; authKey = null; acctEmail = null; acct = null; keys = null; state = blankState(); setPanel('signin', 'Your account was deleted.'); show(); }
      catch (e) { toast(e.message); }
    };
  }
  return { boot, show, setPanel, lostAccess, card, wireCard, get acct() { return acct; }, signOut };
})();

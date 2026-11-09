/* Kingpin Online - two-step sign-in and signed-in devices.
   With two-step sign-in on, your email and password aren't enough: each new phone, computer or browser also needs a
   6-digit code from an authenticator app (iPhone Passwords, Google Authenticator, Authy, 1Password…) once. After that
   the device is remembered until you remove it here (or it goes 60 days unused). Lost your phone? A recovery code
   works instead of a code, once each. */
'use strict';
const TFA = { devices: null, approving: null };
const devKey = email => 'crown.dev.' + String(email || '').toLowerCase();
function devToken(email) { try { return localStorage.getItem(devKey(email)) || ''; } catch (_) { return ''; } }
function setDevToken(email, tok) { try { if (tok) localStorage.setItem(devKey(email), tok); else localStorage.removeItem(devKey(email)); } catch (_) { } }
// "iPhone · Safari", "Mac · Chrome", "Windows · Kingpin app"
function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'A device';
  const br = /Electron/.test(ua) ? 'Kingpin app' : /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  return `${os} · ${br}`;
}
// asked once when the server says this device needs a code; every waiting request then carries on
function tfaApprove() {
  if (TFA.approving) return TFA.approving;
  TFA.approving = (async () => {
    let msg = 'Two-step sign-in\n\nOpen your authenticator app and type the 6-digit Kingpin code to approve this device. (Lost your phone? A recovery code works too.)';
    for (let tries = 0; tries < 6; tries++) {
      const code = await askText(msg, '', { ok: 'Approve', placeholder: '123 456' });
      if (code === null) return false;
      try {
        const r = await api('/api/auth/device', { code, name: deviceName() });
        if (r.token) setDevToken(acctEmail, r.token);
        if (r.usedRecovery) setTimeout(() => toast(`Recovery code used — ${plural(r.recoveryLeft, 'code')} left. Make new ones in Settings → Security.`, { ms: 9000 }), 600);
        return true;
      } catch (e) { msg = `Two-step sign-in\n\n${e.message}`; }
    }
    return false;
  })().finally(() => { TFA.approving = null; });
  return TFA.approving;
}

/* ---------- Settings → Security ---------- */
function tfaCardHtml() {
  if (!CLOUD || typeof Account === 'undefined') return '';
  const a = Account.info && Account.info() || {};
  return `<div class="tfabox" id="tfaBox">
    <div class="section">Two-step sign-in</div>
    ${a.tfa ? `<div class="small"><span class="hpill"><i style="background:var(--ok)"></i>On</span> New devices need a code from your authenticator app. ${a.recoveryLeft != null ? `<span class="${a.recoveryLeft < 3 ? 'neg' : 'muted'}">${plural(a.recoveryLeft, 'recovery code')} left.</span>` : ''}</div>
      <div class="hstack" style="margin-top:8px;gap:8px;flex-wrap:wrap"><button class="sm" id="tfaDevices">Signed-in devices</button><button class="sm" id="tfaRecovery">New recovery codes</button><button class="sm ghost" id="tfaOff">Turn off</button></div>`
    : `<div class="small muted">Right now your email and password are all it takes to open Kingpin. Turn this on and each new phone or computer also needs a 6-digit code from an authenticator app — once, then it’s remembered.</div>
      <button class="sm primary" id="tfaOn" style="margin-top:8px">Turn on two-step sign-in</button>`}
  </div>`;
}
function wireTfaCard(fresh) {
  // another device may have changed it: check with the server once each time Settings opens
  if (!fresh && CLOUD && typeof Account !== 'undefined' && Account.reload) Account.reload().then(() => { const box = $('#tfaBox'); if (!box) return; const html = tfaCardHtml(); if (box.outerHTML !== html) { box.outerHTML = html; wireTfaCard(true); } }).catch(() => { });
  const on = $('#tfaOn'), off = $('#tfaOff'), dv = $('#tfaDevices'), rc = $('#tfaRecovery');
  if (on) on.onclick = tfaSetup;
  if (dv) dv.onclick = tfaDevicesOpen;
  if (off) off.onclick = async () => {
    const code = await askText('Turn off two-step sign-in?\n\nYour email and password alone will open Kingpin again on any device. Enter a current code from your authenticator app to confirm.', '', { ok: 'Turn off', placeholder: '123 456' });
    if (code === null) return;
    try { await api('/api/auth/tfa/disable', { code }); setDevToken(acctEmail, ''); await Account.reload(); toast('Two-step sign-in is off'); PAGES.settings.render(); } catch (e) { toast(e.message); }
  };
  if (rc) rc.onclick = async () => {
    const code = await askText('New recovery codes\n\nYour old recovery codes stop working. Enter a current code from your authenticator app.', '', { ok: 'Make new codes', placeholder: '123 456' });
    if (code === null) return;
    try { const r = await api('/api/auth/tfa/recovery', { code }); await Account.reload(); tfaShowCodes(r.recovery); } catch (e) { toast(e.message); }
  };
}
function tfaDialog() {
  if (document.getElementById('dlgTfa')) return;
  document.body.insertAdjacentHTML('beforeend', `<dialog id="dlgTfa" class="narrow"><div class="dhead" id="tfaTitle">Two-step sign-in<button class="ghost sm x" data-close>✕</button></div><div class="dbody" id="tfaBody"></div><div class="dfoot" id="tfaFoot"></div></dialog>`);
}
async function tfaSetup() {
  let r; try { r = await api('/api/auth/tfa/start', {}); } catch (e) { toast(e.message); return; }
  tfaDialog();
  const pretty = r.secret.replace(/(.{4})/g, '$1 ').trim();
  $('#tfaTitle').firstChild.textContent = 'Turn on two-step sign-in';
  $('#tfaBody').innerHTML = `<ol class="tfasteps">
      <li>Open an authenticator app — on iPhone the built-in <b>Passwords</b> app works (or Google Authenticator, Authy, 1Password).</li>
      <li>${/iPhone|iPad|Android/.test(navigator.userAgent) ? `Add Kingpin to it:<div style="margin:8px 0"><a class="btn primary tfaadd" href="${esc(r.uri)}">Add to my authenticator app</a></div><div class="small muted">Setting it up on a different device? Scan this:</div>` : 'Scan this code with your phone:'}
        <div class="tfaqr">${qrSvg(r.uri, 190)}</div>
        <div class="small muted">Can’t scan? Type this setup key instead: <span class="mono tfakey">${esc(pretty)}</span> <button class="ghost sm" id="tfaCopyKey">Copy</button></div></li>
      <li>Type the 6-digit code it shows:<input id="tfaCode" inputmode="numeric" autocomplete="one-time-code" placeholder="123 456" style="margin-top:6px;max-width:180px"><div class="small" id="tfaErr" style="color:var(--danger);margin-top:4px"></div></li></ol>`;
  $('#tfaFoot').innerHTML = `<button data-close>Cancel</button><button class="primary" id="tfaGo">Turn on</button>`;
  $('#tfaCopyKey').onclick = () => copyText(r.secret, 'Setup key');
  const go = async () => {
    $('#tfaGo').disabled = true; $('#tfaErr').textContent = '';
    try {
      const x = await api('/api/auth/tfa/enable', { code: $('#tfaCode').value, name: deviceName() });
      setDevToken(acctEmail, x.token); await Account.reload();
      tfaShowCodes(x.recovery, true); PAGES.settings.render();
    } catch (e) { $('#tfaErr').textContent = e.message; $('#tfaGo').disabled = false; }
  };
  $('#tfaGo').onclick = go; $('#tfaCode').onkeydown = e => { if (e.key === 'Enter') go(); };
  openDlg('dlgTfa'); setTimeout(() => $('#tfaCode').focus(), 50);
}
function tfaShowCodes(codes, first) {
  tfaDialog();
  $('#tfaTitle').firstChild.textContent = first ? 'Two-step sign-in is on' : 'New recovery codes';
  $('#tfaBody').innerHTML = `${first ? '<div class="small" style="margin-bottom:10px">This device is approved. Any other phone or computer will ask for a code from your authenticator app the first time.</div>' : ''}
    <div class="small"><b>Save these recovery codes</b> somewhere safe (not on this phone). If you ever lose your phone, each one gets you in once instead of a code.</div>
    <div class="tfacodes mono">${codes.map(c => `<span>${esc(c)}</span>`).join('')}</div>
    <div class="small muted">Sharing Kingpin with someone you trust? They’ll need a code from your authenticator app the first time they sign in on their device — or give them one of these recovery codes.</div>`;
  $('#tfaFoot').innerHTML = `<button id="tfaCopyCodes">Copy codes</button><button class="primary" data-close>I saved them</button>`;
  $('#tfaCopyCodes').onclick = () => copyText('Kingpin recovery codes\n' + codes.join('\n'), 'Recovery codes');
  openDlg('dlgTfa');
}
async function tfaDevicesOpen() {
  tfaDialog();
  $('#tfaTitle').firstChild.textContent = 'Signed-in devices';
  $('#tfaBody').innerHTML = '<div class="small muted">Loading…</div>';
  $('#tfaFoot').innerHTML = `<button class="danger" id="tfaOthers" style="margin-right:auto">Sign out all others</button><button class="primary" data-close>Done</button>`;
  openDlg('dlgTfa');
  const draw = list => {
    $('#tfaBody').innerHTML = `<div class="small muted" style="margin-bottom:8px">Devices approved with a code. Removing one means it needs a code again — if it’s not yours, change your password too.</div>
      <div class="list">${list.map(d => `<div class="li"><div class="mmain"><div class="t2">${esc(d.name)}${d.me ? ' <span class="tag">This device</span>' : ''}</div><div class="small muted">Last used ${esc(fmtDT((d.lastSeen || d.at) * 1000))} · added ${esc(fmtDate(new Date(d.at * 1000).toISOString()))}</div></div>${d.me ? '' : `<button class="sm danger" data-tfarm="${esc(d.id)}">Remove</button>`}</div>`).join('') || '<div class="small muted">No devices.</div>'}</div>`;
    $('#tfaOthers').disabled = !list.some(d => !d.me);
    $$('#tfaBody [data-tfarm]').forEach(b => b.onclick = async () => { try { draw((await api('/api/auth/devices', { remove: b.dataset.tfarm })).devices); toast('Removed'); } catch (e) { toast(e.message); } });
  };
  $('#tfaOthers').onclick = async () => { if (!await ask('Sign out every other device?\n\nEach one will need a code from your authenticator app to get back in.', { ok: 'Sign them out', danger: true })) return; try { draw((await api('/api/auth/devices', { remove: 'others' })).devices); toast('Signed out all other devices'); } catch (e) { toast(e.message); } };
  try { draw((await api('/api/auth/devices', {})).devices); } catch (e) { $('#tfaBody').innerHTML = `<div class="small">${esc(e.message)}</div>`; }
}

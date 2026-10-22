/* Crown Tools - barcode scanning: the phone/computer camera, a photo, a USB or Bluetooth scanner, or typing.
   One scanner for everything: shipping labels (check-in) and product barcodes (inventory). */
'use strict';
const Scan = (() => {
  let libP = null, cam = null, startP = null, opts = null, lastCode = '', lastAt = 0, running = false, handling = false;
  const log = [];
  function loadLib() {
    if (window.Html5Qrcode) return Promise.resolve();
    if (libP) return libP;
    libP = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'vendor/html5-qrcode.min.js';
      s.onload = () => res(); s.onerror = () => { libP = null; rej(new Error('Couldn’t load the scanner.')); };
      document.head.appendChild(s);
    });
    return libP;
  }
  function formats() {
    const F = window.Html5QrcodeSupportedFormats || {};
    return ['CODE_128', 'CODE_39', 'CODE_93', 'UPC_A', 'UPC_E', 'EAN_13', 'EAN_8', 'ITF', 'QR_CODE', 'DATA_MATRIX', 'PDF_417', 'CODABAR'].map(k => F[k]).filter(v => v != null);
  }
  function setMsg(t, kind) { const el = $('#scanMsg'); if (el) { el.textContent = t || ''; el.className = 'scanmsg ' + (kind || ''); } }
  function renderLog() {
    const el = $('#scanLog'); if (!el) return;
    el.innerHTML = log.slice(0, 12).map(x => `<div class="scanrow ${x.kind || ''}"><span class="mono small">${esc(x.code.length > 34 ? x.code.slice(0, 16) + '…' + x.code.slice(-12) : x.code)}</span><span class="small">${esc(x.msg || '')}</span></div>`).join('');
  }
  async function handle(raw, how) {
    const code = String(raw || '').replace(/[\u0000-\u001f\u001d]/g, '').trim();
    if (!code || !opts || handling) return;
    // the camera sees the same label many times a second: ignore repeats for a few seconds
    if (code === lastCode && Date.now() - lastAt < 4000) return;
    lastCode = code; lastAt = Date.now(); handling = true;
    try { if (navigator.vibrate) navigator.vibrate(60); } catch (_) { }
    let r;
    try { r = await opts.onCode(code, how); } catch (e) { r = { ok: false, msg: e.message }; }
    handling = false;
    r = r || { ok: true, msg: 'Scanned' };
    log.unshift({ code, msg: r.msg, kind: r.ok ? 'good' : r.warn ? 'warn' : 'bad' }); renderLog();
    setMsg(r.msg, r.ok ? 'good' : r.warn ? 'warn' : 'bad');
    if (r.close || (opts && opts.single && r.ok)) close();
  }
  async function startCamera() {
    if (running) return;
    const box = $('#scanCam');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { box.innerHTML = '<div class="camoff">This browser can’t use the camera here. Use “Take a photo” or type the number below.</div>'; return; }
    // The scanner reads frames at the size its element is laid out, so lay it out big (1280px) and shrink it on screen
    // with a transform - thin label barcodes need the camera's full resolution.
    const VW = 1280, sc = (box.clientWidth || 340) / VW;
    box.innerHTML = `<div class="scanstage"><div id="scanVideo" style="width:${VW}px;transform:scale(${sc});transform-origin:0 0"></div></div>`; setMsg('Starting camera…');
    try {
      await loadLib();
      cam = new Html5Qrcode('scanVideo', { formatsToSupport: formats(), useBarCodeDetectorIfSupported: true, verbose: false });
      // read the whole frame at the camera's real resolution (thin 1D label barcodes need every pixel); a CSS guide shows where to aim
      startP = cam.start({ facingMode: 'environment' }, { fps: 10, disableFlip: false, videoConstraints: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } },
        txt => handle(txt, 'camera'), () => { });
      await startP;
      if (!$('#scanVideo')) return;
      const v = $('#scanVideo video'), fit = () => { const st = $('#scanCam .scanstage'); if (!st || !v) return; st.style.height = Math.round(($('#scanVideo').offsetHeight || v.offsetHeight || 720) * sc) + 'px'; };
      fit(); if (v) v.addEventListener('loadedmetadata', fit); setTimeout(fit, 400);
      $('#scanCam').insertAdjacentHTML('beforeend', '<div class="aim"></div>');
      running = true; setMsg(opts.hint || 'Point the camera at a barcode');
    } catch (e) {
      running = false; cam = null;
      const denied = /permission|notallowed|denied/i.test(String(e && (e.name || e.message || e)));
      box.innerHTML = `<div class="camoff">${denied ? 'Camera access was blocked. Allow the camera for this site in your browser settings, or use “Take a photo” / type the number below.' : 'Couldn’t start the camera. Use “Take a photo” or type the number below.'}</div>`;
      setMsg('');
    }
  }
  async function stopCamera() {
    const c = cam; cam = null; running = false;
    if (startP) { try { await startP; } catch (_) { } startP = null; } // stopping mid-start leaves the camera on
    if (c) { try { await c.stop(); } catch (_) { } try { c.clear(); } catch (_) { } }
  }
  async function fromPhoto(file) {
    if (!file) return;
    setMsg('Reading the photo…');
    try {
      await loadLib();
      const holder = document.createElement('div'); holder.id = 'scanFileTmp'; holder.style.display = 'none'; document.body.appendChild(holder);
      const tmp = new Html5Qrcode('scanFileTmp', { formatsToSupport: formats(), useBarCodeDetectorIfSupported: true, verbose: false });
      try { const txt = await tmp.scanFile(file, false); lastCode = ''; await handle(txt, 'photo'); }
      finally { try { tmp.clear(); } catch (_) { } holder.remove(); }
    } catch (e) { setMsg('No barcode found in that photo — get closer and make sure it’s sharp.', 'bad'); }
  }
  function open(o) {
    opts = o || {}; lastCode = ''; log.length = 0;
    $('#scanTitle').textContent = opts.title || 'Scan';
    $('#scanHint').textContent = opts.sub || '';
    $('#scanInput').value = ''; $('#scanInput').placeholder = opts.placeholder || 'Or type / use a barcode scanner, then Enter';
    renderLog(); setMsg(''); $('#scanModes').hidden = !opts.modes;
    const d = openDlg('dlgScan');
    d.onclose = () => { stopCamera(); if (opts && opts.onClose) try { opts.onClose(); } catch (_) { } opts = null; };
    // USB / Bluetooth scanners type the code and press Enter: keep the box focused on computers
    setTimeout(() => { if (!isCompact()) $('#scanInput').focus(); }, 60);
    if (opts.camera !== false && (isCompact() || opts.camera === true)) startCamera();
    else $('#scanCam').innerHTML = `<button class="camstart" id="scanCamBtn">📷 Use the camera</button>`;
    const cb = $('#scanCamBtn'); if (cb) cb.onclick = () => startCamera();
  }
  function close() { closeDlg('dlgScan'); }
  function wire() {
    $('#scanInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const v = e.target.value; e.target.value = ''; lastCode = ''; handle(v, 'typed'); } });
    $('#scanGo').onclick = () => { const v = $('#scanInput').value; $('#scanInput').value = ''; lastCode = ''; handle(v, 'typed'); };
    $('#scanPhoto').onclick = () => $('#scanFile').click();
    $('#scanFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; fromPhoto(f); };
  }
  return { open, close, wire, handle, get open_() { return !!opts; } };
})();

/* ---------- reading shipping labels ---------- */
// Turn whatever a label barcode holds into the tracking numbers it could be.
//  USPS: "420" + ZIP (5 or 9 digits) + the tracking number.  FedEx: long barcodes end with the 12/15-digit number.
function labelCandidates(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const out = new Set([s]);
  let m = s.match(/^420(\d{5}|\d{9})(9[2-5]\d{18,24}|[A-Z]{2}\d{9}US)$/); if (m) out.add(m[2]);
  m = s.match(/^420\d{5}(\d{4})?(\d{20,30})$/); if (m) out.add(m[2]);
  if (/^\d{22,40}$/.test(s)) { out.add(s.slice(-12)); out.add(s.slice(-15)); out.add(s.slice(-20)); out.add(s.slice(-22)); }
  return [...out].filter(x => x.length >= 8);
}
function findPackage(raw) {
  const cands = labelCandidates(raw); const s = cands[0] || '';
  for (const o of state.orders) {
    (o.tracking || []).forEach((t, i) => { t._i = i; });
    for (const t of o.tracking || []) {
      const n = String(t.number || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if (n.length < 8) continue;
      if (cands.includes(n) || (n.length >= 12 && s.endsWith(n)) || (s.length >= 12 && n.endsWith(s))) return { o, t, i: t._i };
    }
  }
  return null;
}
// A product barcode (UPC / EAN) rather than a shipping label
const isProductCode = c => /^\d{8}$|^\d{12,14}$/.test(String(c || '').trim()) && !/^(?:420\d{5}|9[2-5]\d{18})/.test(String(c).trim());

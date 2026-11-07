/* Crown Tools - add cards from photos. Pick photos or screenshots of the front of each card (an Amex has its 4-digit
   CID on the front), and Crown Tools reads the number, expiry, CID and name on this device with the Tesseract text
   reader in vendor/ocr. The pictures are never uploaded or saved: only the cards you add are kept, encrypted. */
'use strict';
const CardScan = (() => {
  let w = null, seq = 0;
  const waits = new Map();
  function worker() {
    if (w) return w;
    w = new Worker('vendor/ocr/ocr-worker.js');
    w.onmessage = e => { const p = waits.get(e.data.id); if (!p) return; waits.delete(e.data.id); e.data.error ? p.rej(new Error(e.data.error)) : p.res(e.data.text || ''); };
    w.onerror = () => { for (const p of waits.values()) p.rej(new Error('The text reader stopped. Try again.')); waits.clear(); try { w.terminate(); } catch (e) {} w = null; };
    return w;
  }
  const ocr = (bytes, psm) => new Promise((res, rej) => { const id = ++seq; waits.set(id, { res, rej }); worker().postMessage({ id, image: bytes, psm }, [bytes.buffer]); });
  const warm = () => new Promise(res => { const id = 'warm'; waits.set(id, { res, rej: res }); worker().postMessage({ id }); });
  // the photo, cleaned up for reading: straight grey, stretched contrast, a good size; and the same thing inverted
  // (light text on a dark card)
  async function variants(file) {
    let bmp;
    try { bmp = await createImageBitmap(file); } catch (e) { throw new Error('That file isn’t a picture Crown Tools can open.'); }
    const k = Math.min(2.5, 1800 / Math.max(bmp.width, bmp.height)), W = Math.max(1, Math.round(bmp.width * k)), H = Math.max(1, Math.round(bmp.height * k));
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0, W, H); if (bmp.close) bmp.close();
    const img = cx.getImageData(0, 0, W, H), d = img.data, hist = new Uint32Array(256), g = new Uint8ClampedArray(W * H);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) { const v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; g[j] = v; hist[v]++; }
    const pct = q => { let n = 0; const t = W * H * q; for (let v = 0; v < 256; v++) { n += hist[v]; if (n >= t) return v; } return 255; };
    const lo = pct(0.02), hi = Math.max(lo + 1, pct(0.98)), sc = 255 / (hi - lo);
    let mean = 0; for (let j = 0; j < g.length; j++) { g[j] = (g[j] - lo) * sc; mean += g[j]; } mean /= g.length;
    const make = inv => { for (let i = 0, j = 0; i < d.length; i += 4, j++) { const v = inv ? 255 - g[j] : g[j]; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; } cx.putImageData(img, 0, 0);
      return new Promise(res => cv.toBlob(async b => res(new Uint8Array(await b.arrayBuffer())), 'image/png')); };
    // dark card: read the inverted one first
    const dark = mean < 110;
    const a = await make(dark), b = await make(!dark);
    return [a, b];
  }
  async function read(file) {
    const [a, b] = await variants(file);
    const texts = [];
    const tryOne = async (bytes, psm) => { texts.push(await ocr(bytes.slice(), psm)); return parseCardText(texts.join('\n')); };
    let r = await tryOne(a, 11);
    const done = x => x.number && x.month && (x.cvv || !/^3[47]/.test(x.number)) && x.name;
    if (!done(r)) r = await tryOne(b, 11);
    if (!done(r)) r = await tryOne(a, 6);
    return Object.assign(r, { text: texts.join('\n----\n') });
  }
  return { read, warm };
})();

// ---- turning the text into card fields
const CS_STOP = new Set('AMERICAN EXPRESS AMEX MEMBER SINCE VALID THRU GOOD UNTIL EXPIRES EXPIRY EXP DATE CARD CARDHOLDER CARDMEMBER PLATINUM GOLD GREEN BLUE CASH BUSINESS CORPORATE DELTA SKYMILES HILTON HONORS MARRIOTT BONVOY RESERVE SAPPHIRE PREFERRED VIRTUAL NUMBER SECURITY CODE CID CVV CVC DEBIT CREDIT VISA MASTERCARD DISCOVER BANK CAPITAL ONE CHASE NAME ON THE ACCOUNT PREPAID REWARDS SIGNATURE WORLD ELITE INFINITE PRIVATE CLIENT CENTURION BLACK SILVER EVERYDAY BRILLIANT ASPIRE SURPASS ACTIVATE COPY HIDE SHOW DETAILS ADD WALLET LOCK FREEZE CARDS'.split(' '));
function csLuhn(s) { let t = 0; for (let i = 0; i < s.length; i++) { let n = +s[s.length - 1 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9; } t += n; } return s.length >= 13 && t % 10 === 0; }
// fix letters the reader mixes up with digits, only inside number-looking pieces
const csDigits = t => t.replace(/[0-9OoIl|SBZ]{2,}/g, m => (m.replace(/\D/g, '').length * 2 >= m.length ? m.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2') : m));
function parseCardText(text) {
  const raw = String(text || ''), lines = raw.split(/\r?\n/).map(l => csDigits(l).trim()).filter(Boolean);
  const out = { number: '', month: '', year: '', cvv: '', name: '', sure: {} };
  // card number: a 15- or 16-digit run on one line that passes the card-number check (Amex 4-6-5, others 4-4-4-4)
  const found = [];
  lines.forEach((l, li) => {
    const groups = l.match(/\d+/g) || [];
    for (let s = 0; s < groups.length; s++) for (let e = s; e < groups.length; e++) {
      const n = groups.slice(s, e + 1).join(''); if (n.length > 19) break;
      if ((n.length === 15 && /^3[47]/.test(n)) || (n.length === 16 && /^[3-6]/.test(n))) if (csLuhn(n)) found.push({ n, li, groups: groups.slice(s, e + 1) });
    }
    const all = l.replace(/\D/g, '');
    if (!found.some(f => f.li === li)) for (const len of [15, 16]) for (let i = 0; i + len <= all.length; i++) { const n = all.slice(i, i + len); if (((len === 15 && /^3[47]/.test(n)) || (len === 16 && /^[3-6]/.test(n))) && csLuhn(n)) found.push({ n, li, groups: [] }); }
  });
  const best = found.find(f => /^3[47]/.test(f.n) && f.n.length === 15) || found[0];
  if (best) { out.number = best.n; out.sure.number = true; }
  // expiry: MM/YY after "thru / exp / expires / valid / good"; otherwise the latest date that isn't "member since"
  const now = new Date(), cy = now.getFullYear();
  const dates = [];
  lines.forEach((l, li) => {
    const re = /(0[1-9]|1[0-2])\s?[\/\-.]\s?(20\d{2}|\d{2})(?!\d)/g; let m;
    while ((m = re.exec(l))) {
      const before = (lines[li - 1] || '') + ' ' + l.slice(0, m.index);
      const y = m[2].length === 2 ? 2000 + +m[2] : +m[2];
      if (/SINCE\s*$/i.test(l.slice(0, m.index))) continue;
      dates.push({ mo: m[1], y, labeled: /(THRU|EXP|EXPIRES?|EXPIRY|VALID|GOOD|UNTIL)\W*$/i.test(before.trim()) || /(THRU|EXP|EXPIRES?|EXPIRY|VALID|GOOD)/i.test(before.slice(-30)) });
    }
  });
  const okDates = dates.filter(x => x.y >= cy - 1 && x.y <= cy + 12);
  const dt = okDates.find(x => x.labeled) || okDates.sort((a, b) => b.y - a.y || b.mo - a.mo)[0];
  if (dt) { out.month = dt.mo; out.year = String(dt.y); out.sure.exp = !!dt.labeled || okDates.length === 1; }
  // security code: after a label (CID / CVV / CVC / security code), else for an Amex the 4-digit number printed above the card number
  const lab = raw.replace(/\r/g, '').match(/(?:CID|CVV2?|CVC2?|CSC|SECURITY\s*CODE|SEC(?:URITY)?\.?\s*#)\W{0,12}(\d{3,4})(?!\d)/i) || raw.match(/(?:CID|CVV2?|CVC2?|SECURITY\s*CODE)\s*\n\s*(\d{3,4})(?!\d)/i);
  if (lab) { out.cvv = lab[1]; out.sure.cvv = true; }
  else if (/^3[47]/.test(out.number)) {
    const numParts = new Set(best ? best.groups : []);
    const cands = [];
    lines.forEach((l, li) => {
      if (best && li === best.li) return;
      for (const m of l.matchAll(/(?<![\d\/])(\d{4})(?![\d\/])/g)) {
        if (numParts.has(m[1]) || out.number.includes(m[1]) && l.replace(/\D/g, '').length > 6) continue;
        if (/(SINCE|THRU|EXP)/i.test(l)) continue;
        cands.push({ v: m[1], alone: l.replace(/\s/g, '') === m[1], near: best ? Math.abs(li - best.li) : 9 });
      }
    });
    cands.sort((a, b) => (b.alone - a.alone) || (a.near - b.near));
    if (cands[0]) { out.cvv = cands[0].v; out.sure.cvv = cands.length === 1 && cands[0].alone; }
  }
  // name: after "name", or a line of 2-4 words that aren't card words (the lowest one on the card)
  const nm = raw.match(/NAME(?:\s+ON\s+CARD)?\s*[:\n]\s*([A-Za-z][A-Za-z.'\- ]{2,30})/i);
  const okName = s => { const ws = s.trim().split(/\s+/); return ws.length >= 2 && ws.length <= 4 && ws.every(x => /^[A-Za-z][A-Za-z.'\-]*$/.test(x)) && !ws.some(x => CS_STOP.has(x.toUpperCase().replace(/\.$/, ''))) && s.trim().length <= 28; };
  if (nm && okName(nm[1])) { out.name = nm[1].trim(); out.sure.name = true; }
  else { const c = lines.map(l => l.replace(/[^A-Za-z.'\- ]/g, ' ').replace(/\s+/g, ' ').trim()).filter(okName); if (c.length) out.name = c[c.length - 1]; }
  if (out.name === out.name.toUpperCase()) out.name = out.name.toLowerCase().replace(/\b[a-z]/g, ch => ch.toUpperCase());
  return out;
}

// ---- the window
let CSX = { rows: [], group: '' };
function openCardScan(groupId) {
  if (!state.cardGroups.length) { ensureCardGroup('My cards'); save(); }
  CSX = { rows: [], group: groupId && cardGroupById(groupId) ? groupId : (cardGroupView !== 'all' && cardGroupById(cardGroupView) ? cardGroupView : (state.cardGroups[0] || {}).id) };
  $('#csGroup').innerHTML = state.cardGroups.map(g => `<option value="${g.id}" ${g.id === CSX.group ? 'selected' : ''}>${esc(g.name)}</option>`).join('') + '<option value="__new">+ New group…</option>';
  csRender(); openDlg('dlgCardScan');
  CardScan.warm(); // start loading the reader while you pick photos
}
const csExisting = () => new Set((state.cards || []).map(c => cardDigits(c.number)));
// seen: number -> id of the first row with it (later rows with the same number are the duplicates)
function csSeen() { const m = new Map(); CSX.rows.forEach(r => { const n = cardDigits(r.number); if (n && !m.has(n)) m.set(n, r.id); }); return m; }
function csRowState(r, have, seen) {
  const n = cardDigits(r.number);
  if (r.reading) return { c: '', t: 'Reading…' };
  if (r.error) return { c: 'bad', t: r.error };
  if (!n) return { c: 'bad', t: 'No card number found — type it in' };
  if (!luhn(n)) return { c: 'bad', t: 'That isn’t a real card number — check it' };
  if (have.has(n)) return { c: 'dup', t: 'Already saved' };
  if (seen.get(n) !== r.id) return { c: 'dup', t: 'Already in this list' };
  if (!r.month || !r.year) return { c: 'need', t: 'Add the expiry' };
  if (/^3[47]/.test(n) && !/^\d{4}$/.test(r.cvv)) return { c: 'need', t: 'Add the 4-digit CID from the front of the card' };
  if (!/^3[47]/.test(n) && !/^\d{3}$/.test(r.cvv)) return { c: 'warn', t: 'No CVV — it’s on the back; add it if your bot needs it' };
  if (!r.sure || !r.sure.cvv) return { c: 'warn', t: 'Check the security code' };
  return { c: 'ok', t: 'Ready' };
}
function csRowHtml(r, x) {
  return `<div class="csrow cs-${x.c}" data-csr="${r.id}">
      <div class="csimg">${r.url ? `<img src="${r.url}" alt="">` : '<span>⌨︎</span>'}</div>
      <div class="csf"><div class="fgrid">
        <div class="s2"><label>Card number</label><input class="mono" data-csk="number" value="${esc(r.number)}" inputmode="numeric" autocomplete="cc-number" placeholder="${r.reading ? 'Reading…' : '3782 822463 10005'}" ${r.reading ? 'disabled' : ''}></div>
        <div><label>Expiry</label><input data-csk="exp" value="${esc(r.month ? r.month + '/' + String(r.year).slice(-2) : '')}" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/YY" ${r.reading ? 'disabled' : ''}></div>
        <div><label>${/^3[47]/.test(cardDigits(r.number)) ? 'CID (front)' : 'CVV'}</label><input class="mono" data-csk="cvv" value="${esc(r.cvv)}" inputmode="numeric" autocomplete="cc-csc" maxlength="4" ${r.reading ? 'disabled' : ''}></div>
        <div class="s2"><label>Name on card</label><input data-csk="name" value="${esc(r.name)}" autocomplete="cc-name" ${r.reading ? 'disabled' : ''}></div>
      </div><div class="small csst">${x.c === 'ok' ? '✓ ' : x.c === 'warn' || x.c === 'need' ? '⚠ ' : ''}${esc(x.t)}${cardDigits(r.number) ? ` · <span class="faint">${esc(cardBrand(cardDigits(r.number)))}</span>` : ''}</div></div>
      <button class="ghost sm" data-csdel="${r.id}" aria-label="Remove">✕</button></div>`;
}
function csRender() {
  const have = csExisting(), seen = csSeen();
  const st = CSX.rows.map(r => csRowState(r, have, seen));
  $('#csList').innerHTML = CSX.rows.length ? CSX.rows.map((r, i) => csRowHtml(r, st[i])).join('')
    : `<div class="csdrop" id="csDrop"><b>Drop card photos or screenshots here</b><span class="small muted">or use the buttons above. One card per picture, front side.</span></div>`;
  csFoot(st);
}
// refresh each row's colour and message and the totals, without redrawing the boxes you're typing in
function csStatus() {
  const have = csExisting(), seen = csSeen();
  const st = CSX.rows.map(r => csRowState(r, have, seen));
  CSX.rows.forEach((r, i) => {
    const el = $(`#csList [data-csr="${r.id}"]`); if (!el) return;
    el.className = 'csrow cs-' + st[i].c; const n = cardDigits(r.number);
    el.querySelector('.csst').innerHTML = `${st[i].c === 'ok' ? '✓ ' : st[i].c === 'warn' || st[i].c === 'need' ? '⚠ ' : ''}${esc(st[i].t)}${n ? ` · <span class="faint">${esc(cardBrand(n))}</span>` : ''}`;
    const lab = el.querySelector('[data-csk="cvv"]'); if (lab) lab.previousElementSibling.textContent = /^3[47]/.test(n) ? 'CID (front)' : 'CVV';
  });
  csFoot(st);
}
function csFoot(st) {
  const ready = st.filter(x => x.c === 'ok' || x.c === 'warn').length, need = st.filter(x => x.c === 'need').length, reading = CSX.rows.filter(r => r.reading).length;
  $('#csGo').disabled = !ready || !!reading;
  $('#csGo').textContent = reading ? `Reading ${plural(reading, 'picture')}…` : ready ? `Add ${plural(ready, 'card')}` : 'Add cards';
  const warn = st.filter(s => s.c === 'warn').length, no = st.filter(s => s.c === 'bad' || s.c === 'dup').length;
  $('#csSum').textContent = CSX.rows.length ? `${plural(CSX.rows.length, 'card')} · ${ready} ready${warn ? ` · ${warn} to double-check` : ''}${need ? ` · ${need} missing something` : ''}${no ? ` · ${no} won’t be added` : ''}` : '';
}
async function csAddFiles(files) {
  const imgs = [...files].filter(f => /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name || ''));
  if (!imgs.length) { toast('Pick photos or screenshots of the cards'); return; }
  const rows = imgs.map(f => ({ id: uid(), file: f, url: URL.createObjectURL(f), reading: true, number: '', month: '', year: '', cvv: '', name: '' }));
  CSX.rows.push(...rows); csRender();
  for (const r of rows) {
    if (!$('#dlgCardScan').open) return;
    try {
      const x = await CardScan.read(r.file);
      Object.assign(r, { number: x.number ? cardFmt(x.number) : '', month: x.month, year: x.year, cvv: x.cvv, name: x.name, sure: x.sure, text: x.text });
    } catch (e) { r.error = e.message; }
    r.reading = false; delete r.file;
    const el = $(`#csList [data-csr="${r.id}"]`);
    if (el) { el.outerHTML = csRowHtml(r, { c: '', t: '' }); csStatus(); } else csRender();
  }
}
const cardFmt = n => /^3[47]\d{13}$/.test(n) ? n.replace(/^(\d{4})(\d{6})(\d{5})$/, '$1 $2 $3') : n.replace(/(\d{4})(?=\d)/g, '$1 ');
function wireCardScan() {
  const pick = $('#csFiles'), cam = $('#csCam');
  $('#csPick').onclick = () => pick.click(); $('#csTake').onclick = () => cam.click();
  pick.onchange = e => { const f = [...e.target.files]; e.target.value = ''; csAddFiles(f); };
  cam.onchange = e => { const f = [...e.target.files]; e.target.value = ''; csAddFiles(f); };
  $('#csType').onclick = () => { CSX.rows.push({ id: uid(), number: '', month: '', year: '', cvv: '', name: '', sure: { cvv: true } }); csRender(); const last = $('#csList').lastElementChild; if (last) { last.scrollIntoView({ block: 'nearest' }); last.querySelector('input').focus(); } };
  $('#csGroup').onchange = async e => { if (e.target.value === '__new') { const n = await askText('New card group', '', { ok: 'Add group' }); const id = n && n.trim() ? ensureCardGroup(n) : CSX.group; save(); CSX.group = id; $('#csGroup').innerHTML = state.cardGroups.map(g => `<option value="${g.id}" ${g.id === id ? 'selected' : ''}>${esc(g.name)}</option>`).join('') + '<option value="__new">+ New group…</option>'; } else CSX.group = e.target.value; };
  const box = $('#dlgCardScan');
  box.addEventListener('dragover', e => { e.preventDefault(); });
  box.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files.length) csAddFiles(e.dataTransfer.files); });
  box.addEventListener('paste', e => { const f = [...(e.clipboardData || {}).files || []]; if (f.length) { e.preventDefault(); csAddFiles(f); } });
  const list = $('#csList');
  list.addEventListener('input', e => {
    const inp = e.target.closest('[data-csk]'), row = e.target.closest('[data-csr]'); if (!inp || !row) return;
    const r = CSX.rows.find(x => x.id === row.dataset.csr); if (!r) return; const k = inp.dataset.csk, v = inp.value;
    if (k === 'exp') { const m = v.replace(/\s/g, '').match(/^(\d{1,2})\D?(\d{2}|\d{4})$/); if (m && +m[1] >= 1 && +m[1] <= 12) { r.month = String(+m[1]).padStart(2, '0'); r.year = m[2].length === 2 ? '20' + m[2] : m[2]; } else { r.month = ''; r.year = ''; } }
    else if (k === 'cvv') { r.cvv = v.replace(/\D/g, '').slice(0, 4); r.sure = Object.assign({}, r.sure, { cvv: true }); }
    else r[k] = v;
    csStatus();
  });
  list.addEventListener('click', e => { const d = e.target.closest('[data-csdel]'); if (!d) return; const r = CSX.rows.find(x => x.id === d.dataset.csdel); if (r && r.url) URL.revokeObjectURL(r.url); CSX.rows = CSX.rows.filter(x => x.id !== d.dataset.csdel); csRender(); });
  box.addEventListener('close', () => { CSX.rows.forEach(r => r.url && URL.revokeObjectURL(r.url)); CSX.rows = []; });
  $('#csGo').onclick = () => {
    const have = csExisting(), seen = csSeen();
    const ok = CSX.rows.filter(r => { const s = csRowState(r, have, seen); return s.c === 'ok' || s.c === 'warn'; });
    if (!ok.length) return;
    let gid = $('#csGroup').value; if (gid === '__new' || !cardGroupById(gid)) gid = (state.cardGroups[0] || {}).id;
    snapshot('add cards from photos');
    ok.forEach(r => state.cards.push(newCard({ groupId: gid, status: 'unused', number: cardDigits(r.number), month: r.month, year: r.year, cvv: String(r.cvv || '').replace(/\D/g, ''), name: String(r.name || '').trim() })));
    const g = cardGroupById(gid), made = pairProfileGroup(g);
    cardGroupView = gid; save(); closeDlg('dlgCardScan'); refresh();
    toast(`Added ${plural(ok.length, 'card')} to ${g ? g.name : 'the group'}${made ? ` · made a profile group “${g.name}” to match` : ''}`, { undo: true });
  };
}

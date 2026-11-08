/* Kingpin - add cards from photos. Either one picture per card (a screenshot of a virtual card, or a card with
   everything on the front) or two (front and back, like an Amex: name and 4-digit CID on the front, number and expiry
   on the back - the two are matched up into one card). Kingpin reads them on this device with the Tesseract text
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
  const ocr = (bytes, psm, digits) => new Promise((res, rej) => { const id = ++seq; waits.set(id, { res, rej }); worker().postMessage({ id, image: bytes, psm, digits: !!digits }, [bytes.buffer]); });
  const warm = () => new Promise(res => { const id = 'warm'; waits.set(id, { res, rej: res }); worker().postMessage({ id }); });
  // the photo, cleaned up for reading: straight grey, stretched contrast, a good size; and the same thing inverted
  // (light text on a dark card)
  async function variants(file) {
    let bmp;
    try { bmp = await createImageBitmap(file); } catch (e) { throw new Error('That file isn’t a picture Kingpin can open.'); }
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
    // local versions: each pixel against its surroundings (glare, coloured cards, a black stripe across the back),
    // one for light text and one for dark text; the likelier one first
    const r = Math.max(8, Math.round(Math.min(W, H) / 30)), ii = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += g[y * W + x]; ii[(y + 1) * (W + 1) + x + 1] = ii[y * (W + 1) + x + 1] + row; } }
    const loc = light => {
      for (let y = 0, j = 0; y < H; y++) {
        const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
        for (let x = 0; x < W; x++, j++) {
          const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
          const m = (ii[y1 * (W + 1) + x1] - ii[y0 * (W + 1) + x1] - ii[y1 * (W + 1) + x0] + ii[y0 * (W + 1) + x0]) / ((y1 - y0) * (x1 - x0));
          const ink = light ? g[j] - m > 12 : m - g[j] > 12, v = ink ? 0 : 255, i = j * 4;
          d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
        }
      }
      cx.putImageData(img, 0, 0);
      return new Promise(res => cv.toBlob(async bl => res(new Uint8Array(await bl.arrayBuffer())), 'image/png'));
    };
    const l1 = await loc(dark), l2 = await loc(!dark);
    return [a, l1, l2, b];
  }
  // done(text) says when enough was read; otherwise every pass: cleaned up, two local versions (one read for digits
  // only), and inverted. Each pass is a separate reading, so the card number can be checked by how many agree.
  async function read(file, done) {
    const [a, l1, l2, b] = await variants(file), texts = [], digs = [];
    for (const [v, digits] of [[a], [l1], [l1, true], [l2], [b], [a, true]]) {
      (digits ? digs : texts).push(await ocr(v.slice(), 11, digits));
      if (done(texts.join('\n'), digs.join('\n'))) break;
    }
    return { text: texts.join('\n'), digits: digs.join('\n') };
  }
  return { read, warm };
})();

// ---- turning the text into card fields
const CS_STOP = new Set('AMERICAN EXPRESS AMEX MEMBER SINCE VALID THRU GOOD UNTIL EXPIRES EXPIRY EXP DATE CARD CARDHOLDER CARDMEMBER PLATINUM GOLD GREEN BLUE CASH BUSINESS CORPORATE DELTA SKYMILES HILTON HONORS MARRIOTT BONVOY RESERVE SAPPHIRE PREFERRED VIRTUAL NUMBER SECURITY CODE CID CVV CVC DEBIT CREDIT VISA MASTERCARD DISCOVER BANK CAPITAL ONE CHASE NAME ON THE ACCOUNT PREPAID REWARDS SIGNATURE WORLD ELITE INFINITE PRIVATE CLIENT CENTURION BLACK SILVER EVERYDAY BRILLIANT ASPIRE SURPASS ACTIVATE COPY HIDE SHOW DETAILS ADD WALLET LOCK FREEZE CARDS LLC INC CORP CO COMPANY LTD GROUP SERVICES ENTERPRISES HOLDINGS'.split(' '));
function csLuhn(s) { let t = 0; for (let i = 0; i < s.length; i++) { let n = +s[s.length - 1 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9; } t += n; } return s.length >= 13 && t % 10 === 0; }
// fix letters the reader mixes up with digits, only inside number-looking pieces
const csDigits = t => t.replace(/[0-9OoIl|SBZ]{2,}/g, m => (m.replace(/\D/g, '').length * 2 >= m.length ? m.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2') : m));
function parseCardText(text) {
  const raw = String(text || ''), lines = raw.split(/\r?\n/).map(l => csDigits(l).trim()).filter(Boolean);
  const out = { number: '', month: '', year: '', cvv: '', name: '', sure: {} };
  // card number: a 15- or 16-digit run on one line that passes the card-number check (Amex 4-6-5, others 4-4-4-4)
  const found = [];
  // on a card-number line a "7" is often read as "/": try that too (only kept if the number passes the card check)
  const tries = [];
  lines.forEach((l, li) => { tries.push([l, li, false]); if (/\d\/|\/\d/.test(l) && l.replace(/\D/g, '').length >= 10 && !/(THRU|EXP|SINCE|VALID)/i.test(l)) { tries.push([l.replace(/\//g, '7'), li, true]); tries.push([l.replace(/\//g, '1'), li, true]); } });
  const shaped = gs => { const k = gs.map(x => x.length).join('-'); return k === '4-6-5' || k === '4-4-4-4'; };
  tries.forEach(([l, li, fixed]) => {
    const groups = l.match(/\d+/g) || [];
    if (fixed) { // a corrected line only counts with the exact card layout
      for (let s0 = 0; s0 < groups.length; s0++) for (const len of [3, 4]) { const gs = groups.slice(s0, s0 + len); const n = gs.join(''); if (gs.length === len && shaped(gs) && csLuhn(n)) found.push({ n, li, groups: gs }); }
      return;
    }
    for (let s0 = 0; s0 < groups.length; s0++) for (const len of [3, 4]) { const gs = groups.slice(s0, s0 + len); const n = gs.join(''); if (gs.length === len && shaped(gs) && /^[3-6]/.test(n) && csLuhn(n)) found.push({ n, li, groups: gs }); }
    // a run of digits with no spaces (a screenshot): only when it's exactly a card number long
    for (const g of groups) if (((g.length === 15 && /^3[47]/.test(g)) || (g.length === 16 && /^[3-6]/.test(g))) && csLuhn(g) && !found.some(f => f.li === li && f.n === g)) found.push({ n: g, li, groups: [g] });
  });
  // several reading passes: the number they agree on most wins (an Amex first)
  const votes = new Map(); found.forEach(f => votes.set(f.n, (votes.get(f.n) || 0) + 1));
  const rank = f => (/^3[47]/.test(f.n) && f.n.length === 15 ? 100 : 0) + votes.get(f.n);
  const best = found.slice().sort((a, b) => rank(b) - rank(a))[0];
  // trusted when two separate readings agree on it (or it sits under a "card number" label); otherwise it gets checked
  if (best) { out.number = best.n; out.votes = votes.get(best.n); out.sure.number = out.votes >= 2 || /(CARD\s*(NUMBER|NO)|ACCOUNT\s*NUMBER)/i.test(lines[best.li - 1] || ''); }
  // expiry: MM/YY after "thru / exp / expires / valid / good"; otherwise the latest date that isn't "member since"
  const now = new Date(), cy = now.getFullYear();
  const dates = [];
  lines.forEach((l, li) => {
    l = l.replace(/((?:THRU|EXP\w*|VALID|GOOD)\W{0,3})[689]([1-9])(\s?[\/\-.]\s?\d{2})/i, '$10$2$3'); // "THRU 92/31", "63/29": a misread 0
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

// one picture: everything from the normal readings; the digits-only readings only count toward the card number
function csParsePic(text, digits) {
  const r = parseCardText(text), d = digits ? parseCardText(digits) : { number: '', votes: 0 };
  if (d.number) {
    if (d.number === r.number) r.votes = (r.votes || 0) + d.votes;
    else if (!r.number || d.votes > (r.votes || 0)) { r.number = d.number; r.votes = d.votes; r.sure.number = false; }
  }
  if (r.number) r.sure.number = r.votes >= 2 || !!r.sure.number;
  return r;
}

// the front of an Amex: the 4-digit CID printed on its own, and the name (no card number)
function csFront(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => csDigits(l).trim()).filter(Boolean), cands = [];
  for (const l of lines) {
    if (/(SINCE|THRU|EXP|VALID)/i.test(l) || l.replace(/\D/g, '').length > 8) continue;
    for (const m of l.matchAll(/(?<![\d\/])(\d{4})(?![\d\/])/g)) cands.push({ v: m[1], alone: l.replace(/\s/g, '') === m[1] });
  }
  const uniq = [...new Map(cands.map(c => [c.v, c])).values()].sort((a, b) => b.alone - a.alone);
  const p = parseCardText(text);
  const lab = p.sure.cvv && /^\d{4}$/.test(p.cvv) ? p.cvv : '';
  return { cid: lab || (uniq[0] || {}).v || '', cidSure: !!lab || (uniq.length === 1 && uniq[0].alone), name: p.name };
}

// ---- the window
// CSX.pics: every picture in the order added; rows are made from them (one or two per card, see csRows).
// CSX.typed: cards typed by hand. CSX.edits: your changes to a row, by row key (its pictures' ids).
let CSX = { pics: [], typed: [], edits: {}, group: '' };
const csPairs = () => state.settings.cardScanPairs !== false;
const csSameName = () => (state.settings.cardScanSame && String(state.settings.cardScanName || '').trim()) || '';
function openCardScan(groupId) {
  if (!state.cardGroups.length) { ensureCardGroup('My cards'); save(); }
  CSX = { pics: [], typed: [], edits: {}, group: groupId && cardGroupById(groupId) ? groupId : (cardGroupView !== 'all' && cardGroupById(cardGroupView) ? cardGroupView : (state.cardGroups[0] || {}).id) };
  $('#csGroup').innerHTML = state.cardGroups.map(g => `<option value="${g.id}" ${g.id === CSX.group ? 'selected' : ''}>${esc(g.name)}</option>`).join('') + '<option value="__new">+ New group…</option>';
  $('#csPairs').checked = csPairs(); $('#csSame').checked = !!state.settings.cardScanSame; $('#csName').value = state.settings.cardScanName || ''; $('#csName').disabled = !state.settings.cardScanSame;
  csRender(); openDlg('dlgCardScan');
  CardScan.warm(); // start loading the reader while you pick photos
}
// group the pictures into cards: one per card, or two per card in the order they were added (1+2, 3+4, …).
// Which of the two is the front is worked out from what's on them.
function csGroups() {
  if (!csPairs()) return CSX.pics.map(p => [p]);
  const out = []; for (let i = 0; i < CSX.pics.length; i += 2) out.push(CSX.pics.slice(i, i + 2));
  return out;
}
// one card's fields from its pictures, plus anything you typed
function csRows() {
  const same = csSameName();
  const rows = csGroups().map(ps => {
    const key = ps.map(p => p.id).join('+');
    // the back: the picture with a card number (if both have one, the one read more consistently)
    const withNum = ps.filter(p => p.read && p.read.number).sort((x, y) => (y.read.votes || 0) - (x.read.votes || 0));
    const back = withNum[0] || null, front = ps.find(p => p !== back) || null;
    const rd = back ? back.read : (ps.find(p => p.read) || {}).read || {};
    const amex = /^3[47]/.test(rd.number || '');
    let cvv = '', cvvSure = false;
    if (front && front.front && front.front.cid && (!front.read || !front.read.number)) { cvv = front.front.cid; cvvSure = front.front.cidSure; }
    else if (rd.cvv && (!amex || /^\d{4}$/.test(rd.cvv)) && (ps.length === 1 || !csPairs())) { cvv = rd.cvv; cvvSure = !!(rd.sure && rd.sure.cvv); }
    const r = { id: key, pics: ps, reading: ps.some(p => p.reading), error: ps.every(p => p.error) ? ps[0].error : '',
      number: rd.number ? cardFmt(rd.number) : '', month: rd.month || '', year: rd.year || '', cvv,
      name: (front && front.front && front.front.name) || rd.name || '', sure: { cvv: cvvSure, number: !!(rd.sure && rd.sure.number) },
      alone: csPairs() && ps.length === 1 && !ps[0].reading, twoNums: withNum.length > 1 && withNum[0].read.number !== withNum[1].read.number };
    const ed = CSX.edits[key] || {};
    Object.assign(r, ed);
    r.sure = { cvv: ed.edCvv ? true : cvvSure, number: ed.numOk || ed.number != null ? true : r.sure.number };
    if (same) r.name = same;
    return r;
  });
  return rows.concat(CSX.typed.map(t => Object.assign({}, t, same ? { name: same } : {})));
}
const csExisting = () => new Set((state.cards || []).map(c => cardDigits(c.number)));
// seen: number -> id of the first row with it (later rows with the same number are the duplicates)
function csSeen(rows) { const m = new Map(); rows.forEach(r => { const n = cardDigits(r.number); if (n && !m.has(n)) m.set(n, r.id); }); return m; }
function csRowState(r, have, seen) {
  const n = cardDigits(r.number);
  if (r.reading) return { c: '', t: 'Reading…' };
  if (r.error) return { c: 'bad', t: r.error };
  if (!n) return { c: 'bad', t: r.alone ? 'Only one picture — add the other side of this card, or type the number' : (r.pics || []).length === 2 ? 'Couldn’t read a card number on either picture — type it in' : 'No card number found — type it in' };
  if (!luhn(n)) return { c: 'bad', t: 'That isn’t a real card number — check it' };
  if (have.has(n)) return { c: 'dup', t: 'Already saved' };
  if (seen.get(n) !== r.id) return { c: 'dup', t: 'Already in this list' };
  if (!r.sure || !r.sure.number) return { c: 'need', t: 'Check this number against the picture (tap it to zoom in)', ok: true };
  if (!r.month || !r.year) return { c: 'need', t: 'Add the expiry' };
  if (/^3[47]/.test(n) && !/^\d{4}$/.test(r.cvv)) return { c: 'need', t: r.alone ? 'Add the front of this card (or type its 4-digit CID)' : 'Add the 4-digit CID from the front of the card' };
  if (!/^3[47]/.test(n) && !/^\d{3,4}$/.test(r.cvv)) return { c: 'warn', t: 'No CVV — it’s on the back; add it if your bot needs it' };
  if (!r.name) return { c: 'warn', t: 'No name — type it, or use “Same name on every card”' };
  if (r.twoNums) return { c: 'warn', t: 'Both pictures show a card number — make sure they’re the same card' };
  if (!r.sure || !r.sure.cvv) return { c: 'warn', t: 'Check the security code' };
  return { c: 'ok', t: 'Ready' };
}
const csStIcon = x => x.c === 'ok' ? '✓ ' : x.c === 'warn' || x.c === 'need' ? '⚠ ' : '';
const csStHtml = (r, x) => `${csStIcon(x)}${esc(x.t)}${x.ok ? ` <button class="sm primary csok" data-csok="${esc(r.id)}">✓ Number is right</button>` : ''}${cardDigits(r.number) ? ` · <span class="faint">${esc(cardBrand(cardDigits(r.number)))}</span>` : ''}`;
function csRowHtml(r, x) {
  const dis = r.reading ? 'disabled' : '', same = !!csSameName();
  const pics = (r.pics || []).map(p => `<img src="${p.url}" alt="Card picture — tap to zoom" data-cszoom="${p.id}">`).join('');
  return `<div class="csrow cs-${x.c}" data-csr="${esc(r.id)}">
      <div class="csimg${r.pics && r.pics.length === 2 ? ' two' : ''}">${pics || '<span>⌨︎</span>'}</div>
      <div class="csf"><div class="fgrid">
        <div class="s2"><label>Card number</label><input class="mono" data-csk="number" value="${esc(r.number)}" inputmode="numeric" autocomplete="cc-number" placeholder="${r.reading ? 'Reading…' : '3782 822463 10005'}" ${dis}></div>
        <div><label>Expiry</label><input data-csk="exp" value="${esc(r.month ? r.month + '/' + String(r.year).slice(-2) : '')}" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/YY" ${dis}></div>
        <div><label>${/^3[47]/.test(cardDigits(r.number)) ? 'CID (front)' : 'CVV'}</label><input class="mono" data-csk="cvv" value="${esc(r.cvv)}" inputmode="numeric" autocomplete="cc-csc" maxlength="4" ${dis}></div>
        <div class="s2"><label>Name on card</label><input data-csk="name" value="${esc(r.name)}" autocomplete="cc-name" ${dis || (same ? 'disabled title="Using the same name for every card"' : '')}></div>
      </div><div class="small csst">${csStHtml(r, x)}</div></div>
      <button class="ghost sm" data-csdel="${esc(r.id)}" aria-label="Remove">✕</button></div>`;
}
function csRender() {
  const rows = csRows(), have = csExisting(), seen = csSeen(rows);
  const st = rows.map(r => csRowState(r, have, seen));
  $('#csList').innerHTML = rows.length ? rows.map((r, i) => csRowHtml(r, st[i])).join('')
    : `<div class="csdrop" id="csDrop"><b>Drop card photos or screenshots here</b><span class="small muted">or use the buttons above. ${csPairs() ? 'Two pictures per card — front and back, one card after another.' : 'One picture per card.'}</span></div>`;
  csFoot(rows, st);
}
// refresh each row's colour and message and the totals, without redrawing the boxes you're typing in
function csStatus() {
  const rows = csRows(), have = csExisting(), seen = csSeen(rows);
  const st = rows.map(r => csRowState(r, have, seen));
  rows.forEach((r, i) => {
    const el = [...$('#csList').querySelectorAll('[data-csr]')].find(e => e.dataset.csr === r.id); if (!el) return;
    el.className = 'csrow cs-' + st[i].c; const n = cardDigits(r.number);
    el.querySelector('.csst').innerHTML = csStHtml(r, st[i]);
    const lab = el.querySelector('[data-csk="cvv"]'); if (lab) lab.previousElementSibling.textContent = /^3[47]/.test(n) ? 'CID (front)' : 'CVV';
  });
  csFoot(rows, st);
}
function csFoot(rows, st) {
  const ready = st.filter(x => x.c === 'ok' || x.c === 'warn').length, need = st.filter(x => x.c === 'need').length, reading = CSX.pics.filter(p => p.reading).length;
  $('#csGo').disabled = !ready || !!reading;
  $('#csGo').textContent = reading ? `Reading ${plural(reading, 'picture')}…` : ready ? `Add ${plural(ready, 'card')}` : 'Add cards';
  const warn = st.filter(s => s.c === 'warn').length, no = st.filter(s => s.c === 'bad' || s.c === 'dup').length;
  $('#csSum').textContent = rows.length ? `${CSX.pics.length ? plural(CSX.pics.length, 'picture') + ' → ' : ''}${plural(rows.length, 'card')} · ${ready} ready${warn ? ` · ${warn} to double-check` : ''}${need ? ` · ${need} missing something` : ''}${no ? ` · ${no} won’t be added` : ''}` : '';
}
async function csAddFiles(files) {
  const imgs = [...files].filter(f => /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name || ''));
  if (!imgs.length) { toast('Pick photos or screenshots of the cards'); return; }
  const pics = imgs.map(f => ({ id: uid(), file: f, url: URL.createObjectURL(f), reading: true }));
  CSX.pics.push(...pics); csRender();
  for (const p of pics) {
    if (!$('#dlgCardScan').open || !CSX.pics.includes(p)) continue;
    try {
      // enough read: the back (number + expiry), or the front (a 4-digit code on its own line + a name)
      // stop early only when the whole card is there (number, expiry and, for an Amex, its 4-digit CID); a front or a
      // back on its own gets every pass, so nothing on it is missed
      const got = await CardScan.read(p.file, (t, d) => { const r = csParsePic(t, d); return !!(r.number && r.votes >= 3 && r.month && (!/^3[47]/.test(r.number) || (r.sure.cvv && /^\d{4}$/.test(r.cvv)))); });
      const text = got.text; p.read = csParsePic(got.text, got.digits); p.front = csFront(text); p.text = text + '\n--- digits ---\n' + got.digits;
      if (!p.read.number && !p.front.cid && !p.front.name) p.error = 'Couldn’t read this picture — try a sharper photo, or type the card';
    } catch (e) { p.error = e.message; }
    p.reading = false; delete p.file;
    if (state.settings.cardScanSame && !String(state.settings.cardScanName || '').trim()) { const nm = (p.front && p.front.name) || (p.read && p.read.name); if (nm) { state.settings.cardScanName = nm; $('#csName').value = nm; save(); } }
    csRender();
  }
}
// a picture, big, to check the number against; and a way to take out a picture that doesn't belong
function csZoom(id) {
  const p = CSX.pics.find(x => x.id === id); if (!p) return;
  const i = CSX.pics.indexOf(p), ov = document.createElement('div'); ov.className = 'cszoom';
  ov.innerHTML = `<img src="${p.url}" alt=""><div class="cszbar"><span class="small">Picture ${i + 1} of ${CSX.pics.length}</span><span class="spacer"></span><button class="sm" data-zdel>Remove this picture</button><button class="sm primary" data-zx>Close</button></div>`;
  const close = () => { ov.remove(); document.removeEventListener('keydown', esc1, true); };
  const esc1 = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
  ov.onclick = e => {
    if (e.target.closest('[data-zdel]')) { URL.revokeObjectURL(p.url); CSX.pics = CSX.pics.filter(x => x !== p); close(); csRender(); toast(csPairs() ? 'Picture removed — the pictures after it pair up again' : 'Picture removed'); return; }
    if (e.target.closest('[data-zx]') || e.target === ov) close();
  };
  document.addEventListener('keydown', esc1, true);
  $('#dlgCardScan').appendChild(ov);
}
const cardFmt = n => /^3[47]\d{13}$/.test(n) ? n.replace(/^(\d{4})(\d{6})(\d{5})$/, '$1 $2 $3') : n.replace(/(\d{4})(?=\d)/g, '$1 ');
function wireCardScan() {
  const pick = $('#csFiles'), cam = $('#csCam');
  $('#csPick').onclick = () => pick.click(); $('#csTake').onclick = () => cam.click();
  pick.onchange = e => { const f = [...e.target.files]; e.target.value = ''; csAddFiles(f); };
  cam.onchange = e => { const f = [...e.target.files]; e.target.value = ''; csAddFiles(f); };
  $('#csType').onclick = () => { CSX.typed.push({ id: 't' + uid(), number: '', month: '', year: '', cvv: '', name: '', sure: { cvv: true, number: true } }); csRender(); const last = $('#csList').lastElementChild; if (last) { last.scrollIntoView({ block: 'nearest' }); last.querySelector('input').focus(); } };
  $('#csGroup').onchange = async e => { if (e.target.value === '__new') { const n = await askText('New card group', '', { ok: 'Add group' }); const id = n && n.trim() ? ensureCardGroup(n) : CSX.group; save(); CSX.group = id; $('#csGroup').innerHTML = state.cardGroups.map(g => `<option value="${g.id}" ${g.id === id ? 'selected' : ''}>${esc(g.name)}</option>`).join('') + '<option value="__new">+ New group…</option>'; } else CSX.group = e.target.value; };
  $('#csPairs').onchange = e => { state.settings.cardScanPairs = e.target.checked; save(); CSX.edits = {}; csRender(); };
  $('#csSame').onchange = e => {
    state.settings.cardScanSame = e.target.checked; $('#csName').disabled = !e.target.checked;
    if (e.target.checked && !String(state.settings.cardScanName || '').trim()) { const r = csRows().find(x => x.name); if (r) { state.settings.cardScanName = r.name; $('#csName').value = r.name; } }
    save(); csRender(); if (e.target.checked && !$('#csName').value) $('#csName').focus();
  };
  $('#csName').oninput = debounce(e => { state.settings.cardScanName = e.target.value.trim(); save(); csRender(); }, 250);
  const box = $('#dlgCardScan');
  box.addEventListener('dragover', e => { e.preventDefault(); });
  box.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files.length) csAddFiles(e.dataTransfer.files); });
  box.addEventListener('paste', e => { const f = [...(e.clipboardData || {}).files || []]; if (f.length) { e.preventDefault(); csAddFiles(f); } });
  const list = $('#csList');
  list.addEventListener('input', e => {
    const inp = e.target.closest('[data-csk]'), row = e.target.closest('[data-csr]'); if (!inp || !row) return;
    const key = row.dataset.csr, k = inp.dataset.csk, v = inp.value;
    const tgt = CSX.typed.find(t => t.id === key) || (CSX.edits[key] = CSX.edits[key] || {});
    if (k === 'exp') { const m = v.replace(/\s/g, '').match(/^(\d{1,2})\D?(\d{2}|\d{4})$/); if (m && +m[1] >= 1 && +m[1] <= 12) { tgt.month = String(+m[1]).padStart(2, '0'); tgt.year = m[2].length === 2 ? '20' + m[2] : m[2]; } else { tgt.month = ''; tgt.year = ''; } }
    else if (k === 'cvv') { tgt.cvv = v.replace(/\D/g, '').slice(0, 4); tgt.edCvv = true; }
    else if (k === 'number') { tgt.number = v; tgt.numOk = true; }
    else tgt[k] = v;
    csStatus();
  });
  list.addEventListener('click', e => {
    const ok = e.target.closest('[data-csok]'); if (ok) { (CSX.edits[ok.dataset.csok] = CSX.edits[ok.dataset.csok] || {}).numOk = true; csStatus(); return; }
    const z = e.target.closest('[data-cszoom]'); if (z) { csZoom(z.dataset.cszoom); return; }
    const d = e.target.closest('[data-csdel]'); if (!d) return; const key = d.dataset.csdel;
    if (CSX.typed.some(t => t.id === key)) CSX.typed = CSX.typed.filter(t => t.id !== key);
    else { const ids = new Set(key.split('+')); CSX.pics.filter(p => ids.has(p.id)).forEach(p => URL.revokeObjectURL(p.url)); CSX.pics = CSX.pics.filter(p => !ids.has(p.id)); delete CSX.edits[key]; }
    csRender();
  });
  box.addEventListener('close', () => { CSX.pics.forEach(p => URL.revokeObjectURL(p.url)); CSX.pics = []; CSX.typed = []; CSX.edits = {}; });
  $('#csGo').onclick = () => {
    const rows = csRows(), have = csExisting(), seen = csSeen(rows);
    const ok = rows.filter(r => { const s = csRowState(r, have, seen); return s.c === 'ok' || s.c === 'warn'; });
    if (!ok.length) return;
    let gid = $('#csGroup').value; if (gid === '__new' || !cardGroupById(gid)) gid = (state.cardGroups[0] || {}).id;
    snapshot('add cards from photos');
    ok.forEach(r => state.cards.push(newCard({ groupId: gid, status: 'unused', number: cardDigits(r.number), month: r.month, year: r.year, cvv: String(r.cvv || '').replace(/\D/g, ''), name: String(r.name || '').trim() })));
    const g = cardGroupById(gid), made = pairProfileGroup(g);
    cardGroupView = gid; save(); closeDlg('dlgCardScan'); refresh();
    toast(`Added ${plural(ok.length, 'card')} to ${g ? g.name : 'the group'}${made ? ` · made a profile group “${g.name}” to match` : ''}`, { undo: true });
  };
}

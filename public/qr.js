/* Kingpin - a small QR code maker (byte mode, medium error correction, versions 1-10: up to ~210 characters).
   Used to show the two-step sign-in setup code so an authenticator app can scan it. qrSvg(text) → SVG markup. */
'use strict';
const QR = (() => {
  // per version (1-10), medium error correction: [ec codewords per block, [blocks, data codewords]...]
  const EC_M = [null, [10, [1, 16]], [16, [1, 28]], [26, [1, 44]], [18, [2, 32]], [24, [2, 43]], [16, [4, 27]], [18, [4, 31]], [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]], [26, [4, 43], [1, 44]]];
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  // GF(256) with x^8 + x^4 + x^3 + x^2 + 1
  const mul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z & 0xFF; };
  function divisor(deg) {
    const r = new Array(deg).fill(0); r[deg - 1] = 1; let root = 1;
    for (let i = 0; i < deg; i++) { for (let j = 0; j < deg; j++) { r[j] = mul(r[j], root); if (j + 1 < deg) r[j] ^= r[j + 1]; } root = mul(root, 0x02); }
    return r;
  }
  function remainder(data, div) {
    const r = new Array(div.length).fill(0);
    for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= mul(c, f); }); }
    return r;
  }
  const dataCap = v => EC_M[v].slice(1).reduce((a, [n, d]) => a + n * d, 0);
  function encode(text) {
    const bytes = [...new TextEncoder().encode(text)];
    let v = 1;
    for (; v <= 10; v++) if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataCap(v) * 8) break;
    if (v > 10) throw new Error('Too long for a QR code');
    // bits: byte mode, length, data, terminator, padding
    const bits = []; const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
    const cap = dataCap(v) * 8;
    put(0, Math.min(4, cap - bits.length)); while (bits.length % 8) bits.push(0);
    for (let p = 0xEC; bits.length < cap; p ^= 0xEC ^ 0x11) put(p, 8);
    const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    // split into blocks, add error correction, interleave
    const [ecLen, ...groups] = EC_M[v], div = divisor(ecLen), blocks = []; let k = 0;
    for (const [n, d] of groups) for (let i = 0; i < n; i++) { const dat = data.slice(k, k + d); k += d; blocks.push({ dat, ec: remainder(dat, div) }); }
    const out = [], maxD = Math.max(...blocks.map(b => b.dat.length));
    for (let i = 0; i < maxD; i++) blocks.forEach(b => { if (i < b.dat.length) out.push(b.dat[i]); });
    for (let i = 0; i < ecLen; i++) blocks.forEach(b => out.push(b.ec[i]));
    return { v, cw: out };
  }
  function build(text, forceMask) {
    const { v, cw } = encode(text), size = 17 + 4 * v;
    const mod = [...Array(size)].map(() => new Array(size).fill(false)), fn = [...Array(size)].map(() => new Array(size).fill(false));
    const set = (x, y, dark) => { mod[y][x] = !!dark; fn[y][x] = true; };
    // timing, finders, alignment
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= size || y >= size) continue; const d = Math.max(Math.abs(dx), Math.abs(dy)); set(x, y, d !== 2 && d !== 4); } };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const al = ALIGN[v];
    al.forEach((ay, i) => al.forEach((ax, j) => { if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }));
    // format (written for real after picking a mask) and version areas
    const format = mask => {
      const d = (0 << 3) | mask; let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const b = ((d << 10) | r) ^ 0x5412, bit = i => ((b >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);
    };
    format(0);
    if (v >= 7) { let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25); const b = (v << 12) | r; for (let i = 0; i < 18; i++) { const bit = ((b >>> i) & 1) === 1, a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, bit); set(c, a, bit); } }
    // data, zig-zag from the bottom right
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && i < cw.length * 8) { mod[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
      }
    }
    const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0, (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
    const applyMask = m => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x]; };
    // the mask with the fewest look-alike patterns (runs, 2×2 blocks, finder-like rows, dark/light balance)
    const penalty = () => {
      let p = 0; const run = line => { let s = 0, c = 1; for (let k = 1; k <= line.length; k++) { if (k < line.length && line[k] === line[k - 1]) c++; else { if (c >= 5) s += c - 2; c = 1; } } return s; };
      const finderLike = line => { let s = 0; const str = line.map(b => b ? 1 : 0).join(''); for (const pat of ['10111010000', '00001011101']) { let at = str.indexOf(pat); while (at >= 0) { s += 40; at = str.indexOf(pat, at + 1); } } return s; };
      for (let y = 0; y < size; y++) { p += run(mod[y]) + finderLike(mod[y]); }
      for (let x = 0; x < size; x++) { const col = mod.map(r => r[x]); p += run(col) + finderLike(col); }
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = mod[y][x]; if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3; }
      const dark = mod.reduce((a, r) => a + r.filter(Boolean).length, 0), total = size * size;
      p += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
      return p;
    };
    let best = 0, bestP = Infinity;
    for (let m = 0; m < 8; m++) { applyMask(m); format(m); const pp = penalty(); if (pp < bestP) { bestP = pp; best = m; } applyMask(m); }
    if (forceMask != null) best = forceMask;
    applyMask(best); format(best);
    return mod;
  }
  // px: about how big; it's rounded to whole pixels per square so the code stays crisp (and scans easily)
  function svg(text, px, fm) {
    const m = build(text, fm), n = m.length, q = 4, s = n + q * 2;
    px = Math.max(2, Math.round((px || 200) / s)) * s;
    let d = ''; m.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x + q} ${y + q}h1v1h-1z`; }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${px || 200}" height="${px || 200}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }
  return { build, svg };
})();
const qrSvg = (text, px) => QR.svg(text, px);

/* Kingpin - sales in and out.
   Export: one row per item, one row per sale, or expenses (CSV that Excel / Google Sheets / Numbers open).
   Import: paste from any spreadsheet, or load a CSV / TSV / .xlsx file. Kingpin works out which column is which
   (with or without a header row), groups rows into sales, matches items to your inventory, and shows exactly what
   it will add before anything is saved. Plain lines work too: "2x Booster Bundle @ 45", "ETB $110 ebay 3/4". */
'use strict';

/* ---------- export ---------- */
function salesInRange() { return (state.sales || []).filter(s => inSpan(s.date, SL.range)).sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.createdAt || 0) - (b.createdAt || 0)); }
function salesExportMenu(btn) {
  const r = btn.getBoundingClientRect(), lbl = rangeLabel(SL.range).toLowerCase();
  const n = salesInRange().length, ne = (state.expenses || []).filter(e => inSpan(e.date, SL.range)).length;
  ctxShow(Math.max(8, r.right - 280), r.bottom + 4, [
    { label: `Sales, one row per item (${lbl})`, k: 'items', disabled: !n },
    { label: `Sales, one row per sale (${lbl})`, k: 'sales', disabled: !n },
    { label: `Expenses (${lbl})`, k: 'exp', disabled: !ne },
  ], it => salesExport(it.k));
}
function salesExport(kind) {
  const list = salesInRange(), tag = SL.range === 'all' ? 'all' : rangeLabel(SL.range).toLowerCase().replace(/[^\w]+/g, '-');
  const plat = s => platformInfo(s.platform).l;
  if (kind === 'items') {
    // fees, shipping and profit sit on each sale's first row, so adding a column up gives the right total
    const rows = list.flatMap((s, n) => s.lines.map((l, i) => ({ sale: n + 1, date: s.date, platform: plat(s), item: l.name, qty: l.qty, price_each: l.price, line_total: r2((l.price || 0) * l.qty), cost_each: l.cost ?? '', fees: i ? '' : s.fees ?? '', shipping: i ? '' : s.shipping ?? '', profit: i ? '' : r2(saleProfit(s)), buyer: i ? '' : s.buyer, notes: i ? '' : s.notes })));
    download(`kingpin-sales-items-${tag}-${stamp()}.csv`, toCSV(['sale', 'date', 'platform', 'item', 'qty', 'price_each', 'line_total', 'cost_each', 'fees', 'shipping', 'profit', 'buyer', 'notes'], rows), 'text/csv');
    toast(`Exported ${plural(list.length, 'sale')} (${plural(rows.length, 'row')})`);
  } else if (kind === 'sales') {
    const rows = list.map((s, n) => ({ sale: n + 1, date: s.date, platform: plat(s), items: saleTitle(s), units: sum(s.lines, l => l.qty), sold_for: r2(saleRevenue(s)), cost: r2(saleCost(s)), fees: s.fees ?? '', shipping: s.shipping ?? '', profit: r2(saleProfit(s)), buyer: s.buyer, notes: s.notes }));
    download(`kingpin-sales-${tag}-${stamp()}.csv`, toCSV(['sale', 'date', 'platform', 'items', 'units', 'sold_for', 'cost', 'fees', 'shipping', 'profit', 'buyer', 'notes'], rows), 'text/csv');
    toast(`Exported ${plural(list.length, 'sale')}`);
  } else {
    const ex = (state.expenses || []).filter(e => inSpan(e.date, SL.range)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    download(`kingpin-expenses-${tag}-${stamp()}.csv`, toCSV(['date', 'category', 'amount', 'what_for'], ex.map(e => ({ date: e.date, category: e.category, amount: e.amount, what_for: e.note }))), 'text/csv');
    toast(`Exported ${plural(ex.length, 'expense')}`);
  }
}

/* ---------- reading values the way people actually type them ---------- */
const SI_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function siYmd(y, m, d) {
  y = +y; m = +m; d = +d; if (y < 100) y += 2000;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 1990 && y < 2100)) return '';
  return `${y}-${pad2(m)}-${pad2(d)}`;
}
// no year: this year, unless that's more than a couple of days in the future (then last year)
function siNoYear(m, d) { const now = new Date(); let y = now.getFullYear(); const t = new Date(y, m - 1, d); if (t - now > 2 * 864e5) y--; return siYmd(y, m, d); }
function siDate(v, serial) {
  const s = String(v ?? '').trim(); if (!s) return '';
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return siYmd(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/))) return +m[1] > 12 ? siYmd(m[3], m[2], m[1]) : siYmd(m[3], m[1], m[2]);
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})$/))) return siNoYear(+m[1], +m[2]);
  if (serial && /^\d{5}(\.\d+)?$/.test(s) && +s > 30000 && +s < 70000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 864e5); return siYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  if ((m = s.match(/^(?:[a-z]{3,9},?\s+)?([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i))) { const mo = SI_MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1; if (mo) return m[3] ? siYmd(m[3], mo, m[2]) : siNoYear(mo, +m[2]); }
  if ((m = s.match(/^(\d{1,2})\s+([a-z]{3,9})\.?(?:,?\s+(\d{4}))?\b/i))) { const mo = SI_MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1; if (mo) return m[3] ? siYmd(m[3], mo, m[1]) : siNoYear(mo, +m[1]); }
  return '';
}
function siMoney(v) {
  let s = String(v ?? '').trim(); if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /^[-−–]/.test(s.replace(/[$\s]/g, '')) || /^\$\s*[-−]/.test(s);
  s = s.replace(/[^\d.,]/g, '');
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.'); else s = s.replace(/,/g, '');
  if (!s || isNaN(+s)) return null;
  return r2(neg ? -(+s) : +s);
}
const siKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function siPlatform(v) {
  const s = String(v || '').toLowerCase(); if (!s.trim()) return '';
  const T = [['ebay', /e-?bay/], ['tcgplayer', /tcg ?player|\btcg\b/], ['whatnot', /whatnot/], ['mercari', /mercari/], ['facebook', /facebook|\bfb\b|marketplace|\bfbm\b/], ['stockx', /stock ?x/], ['discord', /discord|\bdms?\b|twitter|instagram|\big\b|reddit/], ['local', /in[ -]?person|local|meet ?up|\bcash\b|card show|\blgs\b|\bshow\b/]];
  for (const [k, re] of T) if (re.test(s)) return k;
  const p = PLATFORMS.find(x => siKey(x.l) === siKey(s)); return p ? p.k : '';
}

/* ---------- columns ---------- */
const SI_ROLES = [['', 'Skip this column'], ['date', 'Date'], ['item', 'Item'], ['qty', 'Quantity'], ['price', 'Sold for, each'], ['total', 'Sold for, total for the row'], ['cost', 'Cost each'], ['costTotal', 'Cost, total for the row'], ['fees', 'Fees'], ['shipping', 'Shipping'], ['platform', 'Sold on'], ['buyer', 'Buyer'], ['notes', 'Notes'], ['sale', 'Sale / order number']];
const SI_ALIASES = {
  date: ['date', 'solddate', 'saledate', 'datesold', 'orderdate', 'day', 'when', 'transactiondate', 'created', 'paiddate', 'saleday', 'dateofsale'],
  item: ['item', 'items', 'product', 'productname', 'name', 'title', 'itemname', 'itemtitle', 'description', 'what', 'listing', 'listingtitle', 'card', 'sku', 'productdescription'],
  qty: ['qty', 'quantity', 'units', 'count', 'qtysold', 'quantitysold', 'pcs', 'unitssold', 'amountsold', 'howmany', 'number', 'no'],
  price: ['price', 'priceeach', 'unitprice', 'soldfor', 'soldprice', 'saleprice', 'each', 'priceper', 'perunit', 'sellprice', 'sellingprice', 'soldforeach', 'soldat', 'pricesold', 'eachprice', 'priceperitem', 'perItem'.toLowerCase(), 'ea', 'sold'],
  total: ['total', 'linetotal', 'amount', 'gross', 'revenue', 'subtotal', 'totalprice', 'soldfortotal', 'itemtotal', 'totalsale', 'saleamount', 'grosssales', 'soldtotal', 'totalsold', 'payout', 'sales'],
  cost: ['cost', 'costeach', 'cogs', 'paid', 'buyprice', 'purchaseprice', 'unitcost', 'boughtfor', 'costper', 'retail', 'boughtat', 'paideach', 'buycost', 'costprice', 'mycost'],
  costTotal: ['totalcost', 'costtotal', 'linecost', 'totalpaid', 'paidtotal'],
  fees: ['fees', 'fee', 'platformfee', 'platformfees', 'sellingfees', 'finalvaluefee', 'commission', 'ebayfees', 'ebayfee', 'fvf', 'transactionfees', 'transactionfee', 'tcgfees', 'processingfees'],
  shipping: ['shipping', 'postage', 'label', 'shippingcost', 'shippingpaid', 'shipcost', 'labelcost', 'ship', 'shippinglabel', 'postagecost'],
  platform: ['platform', 'soldon', 'site', 'marketplace', 'channel', 'where', 'venue', 'source', 'via', 'market', 'store'],
  buyer: ['buyer', 'customer', 'soldto', 'buyername', 'client', 'username', 'buyerusername', 'to', 'who'],
  notes: ['notes', 'note', 'comments', 'comment', 'memo', 'tracking', 'trackingnumber', 'details', 'info'],
  sale: ['sale', 'saleid', 'saleno', 'salenumber', 'orderid', 'order', 'ordernumber', 'orderno', 'transactionid', 'transaction', 'invoice', 'invoiceno', 'ref', 'reference', 'id', 'deal', 'dealid', 'deal'],
};
const SI_IGNORE = ['profit', 'net', 'netprofit', 'margin', 'roi', 'profitloss', 'pl', 'gain', 'units', 'items'];
function siRoleOf(h) {
  const k = siKey(h); if (!k) return null;
  for (const [r, al] of Object.entries(SI_ALIASES)) if (al.includes(k)) return r;
  if (SI_IGNORE.includes(k)) return '';
  // looser: "Sold price ($)", "Qty sold", "Date of sale", "Total cost"
  const has = (...w) => w.some(x => k.includes(x));
  if (has('profit', 'margin', 'roi')) return '';
  if (has('date', 'when')) return 'date';
  if (has('qty', 'quantity', 'units')) return 'qty';
  if (has('fee', 'commission')) return 'fees';
  if (has('ship', 'postage', 'label')) return 'shipping';
  if (has('cost', 'cogs', 'paid', 'bought', 'retail')) return has('total') ? 'costTotal' : 'cost';
  if (has('each', 'unit', 'per')) return 'price';
  if (has('total', 'gross', 'revenue', 'amount')) return 'total';
  if (has('price', 'sold', 'sale')) return 'price';
  if (has('platform', 'site', 'market', 'channel')) return 'platform';
  if (has('buyer', 'customer')) return 'buyer';
  if (has('order', 'invoice', 'transaction')) return 'sale';
  if (has('item', 'product', 'name', 'title', 'desc')) return 'item';
  if (has('note', 'comment', 'memo')) return 'notes';
  return null;
}
const siIsMoneyish = v => /^\(?\s*[-−]?\s*\$?\s*[-−]?\d[\d,]*(\.\d{1,2})?\s*\)?$/.test(String(v).trim()) || /^\$?\d+,\d{2}$/.test(String(v).trim());
// guess what each column is from what's in it (for sheets without a header row)
function siGuessCols(rows) {
  const n = Math.max(...rows.map(r => r.length)), sample = rows.slice(0, 60), roles = Array(n).fill('');
  const st = [];
  for (let j = 0; j < n; j++) {
    const v = sample.map(r => String(r[j] ?? '').trim()).filter(Boolean), L = v.length || 1;
    st.push({ j, n: v.length, date: v.filter(x => siDate(x, true) && !/^\d+(\.\d+)?$/.test(x) || /^\d{5}$/.test(x) && siDate(x, true)).length / L,
      plat: v.filter(x => siPlatform(x)).length / L, money: v.filter(siIsMoneyish).length / L,
      int: v.filter(x => /^\d{1,3}$/.test(x)).length / L, max: Math.max(0, ...v.map(x => Math.abs(siMoney(x) || 0))),
      dollar: v.filter(x => /\$|\.\d\d$/.test(x)).length / L, alpha: v.reduce((a, x) => a + (x.match(/[a-z]/gi) || []).length, 0) / L });
  }
  const used = new Set(), take = (j, r) => { roles[j] = r; used.add(j); };
  const dc = st.filter(c => c.n && c.date >= 0.6).sort((a, b) => b.date - a.date)[0]; if (dc) take(dc.j, 'date');
  const pc = st.filter(c => !used.has(c.j) && c.n && c.plat >= 0.6)[0]; if (pc) take(pc.j, 'platform');
  const nums = st.filter(c => !used.has(c.j) && c.n && c.money >= 0.8);
  // a small whole-number column next to bigger money columns is the quantity
  const qc = nums.filter(c => c.int >= 0.95 && c.max <= 50 && c.dollar === 0 && c.n >= sample.length * 0.5 && nums.some(o => o !== c && o.max > c.max))[0]; if (qc) take(qc.j, 'qty');
  const money = nums.filter(c => !used.has(c.j));
  ['price', 'cost', 'fees', 'shipping'].forEach((r, i) => { if (money[i]) take(money[i].j, r); });
  const texts = st.filter(c => !used.has(c.j) && c.n && c.alpha >= 2).sort((a, b) => b.alpha - a.alpha);
  if (texts[0]) take(texts[0].j, 'item');
  return roles;
}
function siHeader(row) {
  const roles = row.map(siRoleOf), known = roles.filter(r => r != null).length;
  const valueish = row.filter(c => siIsMoneyish(c) || siDate(c)).length;
  return known >= 2 && valueish === 0 ? roles.map(r => r || '') : null;
}

/* ---------- plain lines: "2x Booster Bundle @ 45", "ETB $110 ebay 3/4" ---------- */
function siLine(line) {
  let s = ' ' + String(line).replace(/\s+/g, ' ').trim() + ' ';
  const out = { item: '', qty: 1, price: null, total: null, cost: null, date: '', platform: '', buyer: '', notes: '' };
  let m;
  // date
  const dre = [/\s(\d{4}-\d{1,2}-\d{1,2})\s/, /\s(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s/, /\s((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)\s/i];
  for (const re of dre) if ((m = s.match(re)) && siDate(m[1])) { out.date = siDate(m[1]); s = s.replace(m[1], ' '); break; }
  // platform words
  const pw = s.match(/\s(?:on\s+|via\s+)?(e-?bay|tcg ?player|whatnot|mercari|facebook|fb marketplace|fbm|fb|stock ?x|discord|in[ -]person|local|meet ?up)\s/i);
  if (pw) { out.platform = siPlatform(pw[1]); s = s.replace(pw[0], ' '); }
  // cost: "cost 80" / "paid 80" / "bought 80"
  if ((m = s.match(/\s(?:cost|paid|bought(?: for| at)?|cogs)\s*:?\s*\$?\s*(\d[\d,]*(?:\.\d{1,2})?)\s/i))) { out.cost = siMoney(m[1]); s = s.replace(m[0], ' '); }
  // quantity: "2x", "2 x", "x2", "qty 2", "2 ×"
  s = s.replace(/^\s(?:sold|sale|selling)\s+/i, ' ');
  if ((m = s.match(/^\s(\d{1,2})\s+(?=[a-z])/i)) || (m = s.match(/\s(\d{1,3})\s*[x×]\s/i)) || (m = s.match(/\s(\d{1,3})[x×](?=[a-z])/i)) || (m = s.match(/\s[x×]\s?(\d{1,3})\s/i)) || (m = s.match(/\sqty:?\s*(\d{1,3})\s/i))) { out.qty = Math.max(1, +m[1]); s = s.replace(m[0], ' '); }
  // price: "@ 45" / "45 each" / "45 ea" is per item; "for 220" with more than one is the total; else the last $ amount / number at the end
  if ((m = s.match(/\s@\s*\$?\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(?:each|ea\.?|apiece)?\s/i)) || (m = s.match(/\s\$?\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(?:each|ea\.?|apiece|\/ea|per)\s/i))) { out.price = siMoney(m[1]); s = s.replace(m[0], ' '); }
  else if ((m = s.match(/\s(?:for|total|=)\s*\$?\s*(\d[\d,]*(?:\.\d{1,2})?)\s/i))) { const v = siMoney(m[1]); if (out.qty > 1) out.total = v; else out.price = v; s = s.replace(m[0], ' '); }
  else {
    const all = [...s.matchAll(/\s(\$\s*\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*\.\d{1,2}|\d{1,6})(?=[\s,;|]|$)/g)];
    const dol = all.filter(x => x[1].includes('$')), pick = (dol.length ? dol : all).pop();
    if (pick) { out.price = siMoney(pick[1]); s = s.slice(0, pick.index) + ' ' + s.slice(pick.index + pick[0].length); }
  }
  // "to @buyer" / "to John"
  if ((m = s.match(/\s(?:to|buyer:?)\s+(@?[\w.]+)\s/i))) { out.buyer = m[1].replace(/^@/, ''); s = s.replace(m[0], ' '); }
  out.item = s.replace(/\s[-–—:|,;]+\s/g, ' ').replace(/^[\s\-–—:|,;$@]+|[\s\-–—:|,;$@]+$/g, '').replace(/\s+/g, ' ').trim();
  return out;
}

/* ---------- inventory matching ---------- */
const siNorm = s => ' ' + String(s || '').toLowerCase().replace(/pok[eé]mon|tcg|the|a /g, ' ').replace(/elite trainer box/g, 'etb').replace(/[^a-z0-9]+/g, ' ').replace(/(\w{3,})s\b/g, '$1').replace(/\s+/g, ' ').trim() + ' ';
function siMatchInv(name) {
  const n = siNorm(name); if (n.trim().length < 2) return null;
  let best = null, bs = 0;
  for (const it of state.inventory || []) {
    const v = siNorm(it.name); if (!v.trim()) continue;
    let sc = 0;
    if (v === n) sc = 100;
    else { const a = n.trim().split(' '), b = new Set(v.trim().split(' ')); const hit = a.filter(w => b.has(w)).length; if (hit === a.length && a.length >= 2) sc = 60 + hit; else if (hit >= 2 && hit / Math.max(a.length, b.size) >= 0.6) sc = 30 + hit; }
    if (sc > bs) { bs = sc; best = it; }
  }
  return bs >= 32 ? best : null;
}

/* ---------- reading a whole paste / file into sales ---------- */
const SI = { rows: [], roles: [], header: false, mode: 'auto', plain: false, stock: false, fillCost: true, estFees: true, skipDup: true, src: '' };
function siLoad(rows, src) {
  rows = rows.map(r => r.map(c => String(c ?? '').trim())).filter(r => r.some(Boolean));
  SI.src = src || ''; SI.rows = rows; SI.plain = false; SI.header = false; SI.roles = [];
  if (!rows.length) return;
  const multi = rows.filter(r => r.filter(Boolean).length > 1).length;
  if (multi < rows.length * 0.5) { SI.plain = true; SI.rows = rows.map(r => [r.filter(Boolean).join(' ')]); return; }
  const h = siHeader(rows[0]);
  if (h) {
    SI.header = true; SI.roles = h; const g = siGuessCols(rows.slice(1));
    SI.roles = SI.roles.map((r, j) => r || (rows[0][j] ? '' : g[j] || ''));
    // what's in a column beats its heading when they disagree about dates ("Sold on" full of dates is the date)
    if (!SI.roles.includes('date')) { const j = g.indexOf('date'); if (j >= 0) SI.roles[j] = 'date'; }
  }
  else SI.roles = siGuessCols(rows);
  // two "total" columns and no each-price: the first is the price total
  if (!SI.roles.includes('price') && !SI.roles.includes('total')) { const j = SI.roles.indexOf('cost'); if (j >= 0 && !SI.header) SI.roles[j] = 'price'; }
}
function siRecords() {
  if (SI.plain) return SI.rows.map(r => siLine(r[0]));
  const body = SI.header ? SI.rows.slice(1) : SI.rows, R = SI.roles, serial = true;
  const col = (r, k) => { const j = R.indexOf(k); return j < 0 ? '' : r[j] ?? ''; };
  return body.map(r => {
    const o = { item: col(r, 'item'), qty: null, price: siMoney(col(r, 'price')), total: siMoney(col(r, 'total')), cost: siMoney(col(r, 'cost')), costTotal: siMoney(col(r, 'costTotal')),
      fees: siMoney(col(r, 'fees')), shipping: siMoney(col(r, 'shipping')), date: siDate(col(r, 'date'), serial), platform: siPlatform(col(r, 'platform')), platRaw: col(r, 'platform'),
      buyer: col(r, 'buyer'), notes: col(r, 'notes'), sale: col(r, 'sale') };
    const q = String(col(r, 'qty')).replace(/[^\d.]/g, ''); o.qty = q ? Math.max(1, Math.round(+q)) : null;
    // "2x Booster Bundle" in the item cell
    const m = String(o.item).match(/^\s*(\d{1,3})\s*[x×]\s+(.+)$/i) || String(o.item).match(/^(.+?)\s+[x×]\s?(\d{1,3})\s*$/i);
    if (m && o.qty == null) { const d = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]]; o.qty = +d[0]; o.item = d[1].trim(); }
    if (o.qty == null) o.qty = 1;
    if (!o.item && !SI.roles.includes('item')) { const t = r.filter((c, j) => !R[j] && /[a-z]/i.test(c)).sort((a, b) => b.length - a.length)[0]; if (t) o.item = t; }
    // "Sold on" text that isn't a known platform stays in the notes
    if (o.platRaw && !o.platform) o.notes = [o.notes, 'Sold on ' + o.platRaw].filter(Boolean).join(' · ');
    return o;
  });
}
// rows → sales. auto: a sale/order number column groups rows; otherwise rows for the same buyer on the same day are
// one deal, and a row with no date belongs to the sale above it
function siBuild() {
  const recs = siRecords().filter(o => o.item || o.price != null || o.total != null);
  const sales = []; let cur = null;
  const start = o => { cur = { date: o.date || '', platform: o.platform || '', buyer: o.buyer || '', notes: o.notes || '', fees: null, shipping: null, lines: [], key: o.sale || '' }; sales.push(cur); };
  const dateless = recs.every(o => !o.date);
  recs.forEach((o, i) => {
    let newSale;
    if (SI.mode === 'each') newSale = true;
    else if (SI.mode === 'one') newSale = !cur;
    else if (o.sale) newSale = !cur || cur.key !== o.sale;
    else if (!cur) newSale = true;
    else if (SI.plain) newSale = !!o.date && o.date !== cur.date;
    else if (!o.date) newSale = dateless && !!(o.buyer && cur.buyer && o.buyer !== cur.buyer);   // a row with no date carries on the sale above it
    else newSale = !(o.date === cur.date && o.buyer && o.buyer === cur.buyer && (o.platform || cur.platform) === cur.platform);
    if (newSale) start(o);
    if (o.date && !cur.date) cur.date = o.date;
    if (o.platform && !cur.platform) cur.platform = o.platform;
    if (o.buyer && !cur.buyer) cur.buyer = o.buyer;
    if (o.notes && !cur.notes.includes(o.notes)) cur.notes = [cur.notes, o.notes].filter(Boolean).join(' · ');
    if (o.fees != null) cur.fees = r2((cur.fees || 0) + o.fees);
    if (o.shipping != null) cur.shipping = r2((cur.shipping || 0) + o.shipping);
    const qty = o.qty || 1;
    const price = o.price != null ? o.price : o.total != null ? r2(o.total / qty) : null;
    const cost = o.cost != null ? o.cost : o.costTotal != null ? r2(o.costTotal / qty) : null;
    if (o.item || price != null) cur.lines.push({ name: o.item || 'Item', qty, price, cost });
  });
  // each line matched to your inventory; a missing cost comes from it
  const today = todayKey();
  sales.forEach(s => {
    if (!s.date) s.date = today; if (!s.platform) s.platform = 'other';
    s.lines.forEach(l => { const it = siMatchInv(l.name); l.inv = it; if (it && l.cost == null && SI.fillCost && it.cost != null) { l.cost = Number(it.cost); l.costFrom = true; } });
    s.noPrice = s.lines.filter(l => l.price == null).length;
    s.dup = (state.sales || []).some(x => x.date === s.date && saleTitle(x) === saleTitle(s) && Math.abs(saleRevenue(x) - saleRevenue(s)) < 0.01);
  });
  return sales.filter(s => s.lines.length);
}

/* ---------- reading .xlsx without any library ---------- */
async function siUnzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const files = {}, td = new TextDecoder();
  for (let i = 0; i < n && dv.getUint32(p, true) === 0x02014b50; i++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    files[td.decode(u8.subarray(p + 46, p + 46 + nl))] = { method, csize, off }; p += 46 + nl + xl + cl;
  }
  return {
    names: Object.keys(files),
    async text(name) {
      const f = files[name]; if (!f) return null;
      const st = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true), data = u8.subarray(st, st + f.csize);
      if (f.method === 0) return td.decode(data);
      return await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    },
  };
}
async function siReadXlsx(buf) {
  const z = await siUnzip(buf), xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const ss = await z.text('xl/sharedStrings.xml');
  const strs = ss ? [...xml(ss).getElementsByTagName('si')].map(si => [...si.getElementsByTagName('t')].map(t => t.textContent).join('')) : [];
  // first sheet in the workbook's order
  let sheet = 'xl/worksheets/sheet1.xml';
  const wb = await z.text('xl/workbook.xml'), rels = await z.text('xl/_rels/workbook.xml.rels');
  if (wb && rels) { const first = xml(wb).getElementsByTagName('sheet')[0]; const rid = first && (first.getAttribute('r:id') || first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')); const rel = rid && [...xml(rels).getElementsByTagName('Relationship')].find(r => r.getAttribute('Id') === rid); if (rel) { const t = rel.getAttribute('Target').replace(/^\//, ''); sheet = t.startsWith('xl/') ? t : 'xl/' + t; } }
  const sx = await z.text(sheet) || await z.text(z.names.filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0]);
  if (!sx) throw new Error('no sheet');
  const rows = [];
  for (const r of xml(sx).getElementsByTagName('row')) {
    const row = [];
    for (const c of r.getElementsByTagName('c')) {
      const ref = c.getAttribute('r') || '', col = ref.replace(/\d+/g, '').split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0];
      let val = t === 's' ? strs[+(v && v.textContent)] : t === 'inlineStr' ? [...c.getElementsByTagName('t')].map(x => x.textContent).join('') : v ? v.textContent : '';
      if (t !== 's' && t !== 'inlineStr' && t !== 'str' && /^-?\d+\.\d{6,}$/.test(val)) val = String(r2(+val));
      row[col >= 0 ? col : row.length] = val ?? '';
    }
    rows.push(Array.from(row, x => x ?? ''));
  }
  return rows;
}

/* ---------- the import window ---------- */
function siDialog() {
  if (document.getElementById('dlgSalesImp')) return;
  document.body.insertAdjacentHTML('beforeend', `<dialog id="dlgSalesImp" class="wide">
    <div class="dhead">Import sales<button class="ghost sm x" data-close>✕</button></div>
    <div class="dbody">
      <div class="small muted" style="margin-bottom:8px">Paste rows from Excel, Google Sheets or Numbers (with or without the header row), or load a CSV / .xlsx file. Plain lines work too, one item per line, like <code>2x Booster Bundle @ 45</code> or <code>ETB 110 ebay 3/4</code>.</div>
      <textarea id="siText" rows="6" placeholder="Paste here…" spellcheck="false"></textarea>
      <div class="hstack" style="gap:8px;margin-top:8px;flex-wrap:wrap"><input type="file" id="siFile" accept=".csv,.tsv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden><button type="button" id="siPick">Load a file…</button><span class="small faint" id="siSrc"></span></div>
      <div id="siPrev"></div>
    </div>
    <div class="dfoot"><span class="small muted" id="siSum" style="margin-right:auto"></span><button data-close>Cancel</button><button class="primary" id="siGo" disabled>Import</button></div></dialog>`);
  const d = document.getElementById('dlgSalesImp');
  $('#siText').oninput = debounce(() => { siLoad(parseDelimited($('#siText').value), ''); $('#siSrc').textContent = ''; siDraw(); }, 200);
  $('#siPick').onclick = () => $('#siFile').click();
  $('#siFile').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      let rows;
      if (/\.xlsx$/i.test(f.name) || /spreadsheetml/.test(f.type)) rows = await siReadXlsx(await f.arrayBuffer());
      else if (/\.xls$/i.test(f.name) || /\.numbers$/i.test(f.name)) { toast('Save it as .xlsx or CSV first (File → Export), then load that'); return; }
      else rows = parseDelimited(await f.text());
      $('#siText').value = ''; siLoad(rows, f.name); $('#siSrc').textContent = `${f.name} · ${plural(rows.length, 'row')}`; siDraw();
    } catch (err) { toast('Couldn’t read that file. Try saving it as CSV.'); }
  };
  d.querySelector('.dbody').addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-sirole]')) { SI.roles[+t.dataset.sirole] = t.value; siDraw(); }
    else if (t.id === 'siHead') { SI.header = t.checked; if (!SI.header) SI.roles = siGuessCols(SI.rows); else { const h = siHeader(SI.rows[0]) || SI.rows[0].map(siRoleOf).map(r => r || ''); SI.roles = h; } siDraw(); }
    else if (t.matches('[data-siopt]')) { SI[t.dataset.siopt] = t.checked; siDraw(); }
  });
  d.querySelector('.dbody').addEventListener('click', e => { const b = e.target.closest('[data-simode]'); if (b) { SI.mode = b.dataset.simode; siDraw(); } });
  $('#siGo').onclick = siImport;
}
let SI_SALES = [];
function siDraw() {
  const box = $('#siPrev');
  if (!SI.rows.length) { box.innerHTML = ''; $('#siSum').textContent = ''; $('#siGo').disabled = true; SI_SALES = []; return; }
  SI_SALES = siBuild();
  const take = SI_SALES.filter(s => !(SI.skipDup && s.dup)), lines = sum(take, s => s.lines.length), noP = sum(take, s => s.noPrice);
  const rev = sum(take, s => sum(s.lines, l => (l.price || 0) * l.qty)), matched = sum(take, s => s.lines.filter(l => l.inv).length), dups = SI_SALES.filter(s => s.dup).length;
  const ncol = Math.max(...SI.rows.map(r => r.length));
  const sample = (SI.header ? SI.rows.slice(1) : SI.rows).slice(0, 3);
  box.innerHTML = `${SI.plain ? '' : `<div class="section" style="margin-top:14px">Columns <span class="faint small" style="font-weight:400">— fix any Kingpin guessed wrong</span></div>
    <label class="small hstack" style="gap:6px;width:auto;margin-bottom:6px"><input type="checkbox" id="siHead" ${SI.header ? 'checked' : ''} style="width:auto"> The first row is headings</label>
    <div class="tablewrap sitable"><table class="atable"><thead><tr>${Array.from({ length: ncol }, (_, j) => `<th><select data-sirole="${j}" aria-label="Column ${j + 1}">${SI_ROLES.map(([k, l]) => `<option value="${k}" ${(SI.roles[j] || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>${SI.header ? `<div class="small faint ellipsis">${esc(SI.rows[0][j] || '')}</div>` : ''}</th>`).join('')}</tr></thead>
      <tbody>${sample.map(r => `<tr>${Array.from({ length: ncol }, (_, j) => `<td class="ellipsis ${SI.roles[j] ? '' : 'faint'}" style="max-width:180px">${esc(r[j] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`}
    <div class="section" style="margin-top:14px">Sales</div>
    <div class="hstack" style="gap:8px;flex-wrap:wrap;margin-bottom:8px"><div class="seg">${[['auto', 'Automatic'], ['each', 'Each row a sale'], ['one', 'All one sale']].map(([k, l]) => `<button type="button" data-simode="${k}" class="${SI.mode === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="list siprev">${SI_SALES.slice(0, 80).map(s => `<div class="li ${SI.skipDup && s.dup ? 'faint' : ''}"><div class="mmain"><div class="t2">${esc(fmtDate(s.date))} · ${esc(platformInfo(s.platform).l)}${s.buyer ? ' · ' + esc(s.buyer) : ''}${s.dup ? ' <span class="tag">already in Kingpin</span>' : ''}</div>
        ${s.lines.map(l => `<div class="small">${l.qty > 1 ? l.qty + '× ' : ''}${esc(l.name)} — ${l.price != null ? fmtMoney(l.price) + (l.qty > 1 ? ' each' : '') : '<b class="neg">no price</b>'}${l.cost != null ? ` <span class="faint">· cost ${fmtMoney(l.cost)}${l.costFrom ? ' (from inventory)' : ''}</span>` : ''}${l.inv ? ` <span class="tag" title="Matched to your inventory">${esc(l.inv.name)}</span>` : ''}</div>`).join('')}
        ${s.fees != null || s.shipping != null ? `<div class="small faint">${s.fees != null ? 'fees ' + fmtMoney(s.fees) : ''}${s.fees != null && s.shipping != null ? ' · ' : ''}${s.shipping != null ? 'shipping ' + fmtMoney(s.shipping) : ''}</div>` : ''}</div>
        <div class="dright"><b>${fmtMoney(sum(s.lines, l => (l.price || 0) * l.qty))}</b></div></div>`).join('')}${SI_SALES.length > 80 ? `<div class="small muted" style="padding:8px">…and ${SI_SALES.length - 80} more</div>` : ''}</div>
    <div class="siopts">
      <label class="small hstack" style="gap:6px;width:auto"><input type="checkbox" data-siopt="estFees" ${SI.estFees ? 'checked' : ''} style="width:auto"> Estimate platform fees where the sheet has none</label>
      <label class="small hstack" style="gap:6px;width:auto"><input type="checkbox" data-siopt="fillCost" ${SI.fillCost ? 'checked' : ''} style="width:auto"> Use my inventory’s cost when a row has no cost</label>
      ${matched ? `<label class="small hstack" style="gap:6px;width:auto"><input type="checkbox" data-siopt="stock" ${SI.stock ? 'checked' : ''} style="width:auto"> Take the ${plural(sum(take, s => sum(s.lines.filter(l => l.inv), l => l.qty)), 'matched unit')} out of my inventory</label>` : ''}
      ${dups ? `<label class="small hstack" style="gap:6px;width:auto"><input type="checkbox" data-siopt="skipDup" ${SI.skipDup ? 'checked' : ''} style="width:auto"> Skip ${plural(dups, 'sale')} already in Kingpin</label>` : ''}</div>`;
  $('#siSum').textContent = take.length ? `${plural(take.length, 'sale')} · ${plural(lines, 'item')} · ${fmtMoney(rev)}${noP ? ` · ${noP} with no price (skipped)` : ''}` : 'Nothing to import yet';
  $('#siGo').disabled = !take.length || take.every(s => s.lines.every(l => l.price == null));
  $('#siGo').textContent = take.length ? `Import ${plural(take.length, 'sale')}` : 'Import';
}
function openSalesImport() {
  siDialog();
  Object.assign(SI, { rows: [], roles: [], header: false, mode: 'auto', plain: false, src: '' });
  $('#siText').value = ''; $('#siSrc').textContent = ''; siDraw();
  openDlg('dlgSalesImp');
}
function siImport() {
  const take = SI_SALES.filter(s => !(SI.skipDup && s.dup));
  if (!take.length) return;
  snapshot('import sales');
  let n = 0, short = 0;
  const left = new Map();   // stock left per item while taking units out
  take.forEach(s => {
    const lines = s.lines.filter(l => l.price != null).map(l => {
      const out = { itemId: '', name: l.inv && SI.stock ? l.inv.name : l.name, qty: l.qty, price: l.price, cost: l.cost, image: l.inv ? (l.inv.image || (l.inv.market && l.inv.market.image) || '') : '' };
      if (l.inv && SI.stock) {
        const have = left.has(l.inv.id) ? left.get(l.inv.id) : Number(l.inv.qty) || 0;
        if (have >= l.qty) { out.itemId = l.inv.id; left.set(l.inv.id, have - l.qty); } else short++;
      }
      return out;
    });
    if (!lines.length) return;
    const sale = { id: uid(), date: s.date, platform: s.platform, lines, fees: s.fees, feesAuto: false, shipping: s.shipping, buyer: s.buyer, notes: s.notes, source: 'import', createdAt: Date.now() + n, updatedAt: Date.now() };
    if (sale.fees == null && SI.estFees) { const f = feeFor(sale.platform), rev = saleRevenue(sale); sale.fees = rev ? r2(rev * (Number(f.pct) || 0) / 100 + (Number(f.flat) || 0)) : 0; }
    if (SI.stock) applyStock(sale, 1);
    (state.sales = state.sales || []).push(sale); n++;
  });
  save(); closeDlg('dlgSalesImp');
  // show what was just imported
  const dates = take.map(s => s.date).sort();
  if (dates.length && !inSpan(dates[0], SL.range)) SL.range = 'all';
  SL.tab = 'sales'; refresh();
  toast(`Imported ${plural(n, 'sale')}${short ? ` · ${short} not taken out of inventory (not enough in stock)` : ''}`, { undo: true });
}

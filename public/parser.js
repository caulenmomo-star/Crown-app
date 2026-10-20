/* Crown - order email parser (pure functions; no DOM, no state).
   Turns a retailer email into a normalized order update. Best-effort and
   template-agnostic: it looks for the patterns that show up across almost
   every retailer's confirmation / shipping / delivery / cancellation email. */
(function (root) {
  'use strict';

  const STORES = [
    { key: 'target', label: 'Target', color: '#e0384a', domains: ['target.com'] },
    { key: 'walmart', label: 'Walmart', color: '#4aa3ff', domains: ['walmart.com'] },
    { key: 'pokemoncenter', label: 'Pokémon Center', color: '#ffcb05', domains: ['pokemoncenter.com'], alias: ['pokemon center'] },
    { key: 'bestbuy', label: 'Best Buy', color: '#ffd23f', domains: ['bestbuy.com'] },
    { key: 'amazon', label: 'Amazon', color: '#ff9900', domains: ['amazon.com'] },
    { key: 'gamestop', label: 'GameStop', color: '#d1323a', domains: ['gamestop.com'] },
    { key: 'costco', label: 'Costco', color: '#c8102e', domains: ['costco.com'] },
    { key: 'samsclub', label: "Sam's Club", color: '#2f8fd1', domains: ['samsclub.com'], alias: ['sams club'] },
    { key: 'walgreens', label: 'Walgreens', color: '#e31837', domains: ['walgreens.com'] },
    { key: 'bn', label: 'Barnes & Noble', color: '#3f9a4b', domains: ['barnesandnoble.com', 'bn.com'], alias: ['barnes and noble'] },
    { key: 'newegg', label: 'Newegg', color: '#f8951d', domains: ['newegg.com'] },
    { key: 'kohls', label: "Kohl's", color: '#8c5bb0', domains: ['kohls.com'], alias: ['kohls'] },
    { key: 'menards', label: 'Menards', color: '#ff7a1a', domains: ['menards.com'] },
    { key: 'playstation', label: 'PlayStation Direct', color: '#3e6fd8', domains: ['direct.playstation.com', 'playstation.com'] },
    { key: 'topps', label: 'Topps', color: '#e9473f', domains: ['topps.com'] },
    { key: 'funko', label: 'Funko', color: '#34b3e4', domains: ['funko.com'] },
    { key: 'lego', label: 'LEGO', color: '#f6c400', domains: ['lego.com'] },
    { key: 'nike', label: 'Nike', color: '#e7e7e7', domains: ['nike.com'] },
    { key: 'footlocker', label: 'Foot Locker', color: '#d6d6d6', domains: ['footlocker.com'] },
    { key: 'other', label: 'Other', color: '#8b93a7', domains: [] },
  ];
  const STORE_BY_KEY = Object.fromEntries(STORES.map(s => [s.key, s]));
  const storeInfo = k => STORE_BY_KEY[k] || STORE_BY_KEY.other;

  // ---------------------------------------------------------------- status
  // Subjects that are never real order updates: surveys, reviews, promos.
  const SURVEY = ['guest survey', 'survey', 'we want to hear', 'how did we do', 'how was', 'rate your', 'rate us', 'review your', 'write a review', 'leave a review', 'tell us about', 'feedback', 'did you enjoy'];
  const PROMO = /(\d+\s?% off|\bsale\b|\bdeals?\b|\bcoupon|\bpromo|\bsave \$|\bsave up\b|\bfree shipping\b|\brewards?\b|\bpoints\b|\bnewsletter|\bwishlist|\bback in stock|\bprice drop|\bjust dropped|\bnew arrivals?|\bdon'?t miss|\blast chance|\babandon|\bleft in your cart|\bstill thinking|\bunsubscribe)/i;
  const CANCELLED = ['had to cancel', 'order canceled', 'order cancelled', 'order was canceled', 'order was cancelled', 'been canceled', 'been cancelled', 'canceled:', 'cancelled:', 'cancellation', 'item canceled', 'item cancelled', 'items canceled', 'items cancelled', 'item was canceled', 'item was cancelled', 'unable to fulfill', "couldn't fulfill", 'could not fulfill'];
  const REFUNDED = ['refund issued', 'refund has been', 'your refund', 'refund processed', 'refund confirmation', 'return received', 'return has been processed'];
  const DELIVERED = ['delivered', 'was picked up', 'has been picked up', 'picked up your order', 'has arrived', 'have arrived', 'order is here', 'package is here', 'items are here', 'order arrived', 'package arrived'];
  const READY = ['ready for pickup', 'ready for drive up', 'ready to pick up', 'is ready for pick'];
  const SHIPPED = ['shipped', 'has shipped', 'on its way', 'is on the way', 'are on the way', 'out for delivery', 'tracking number', 'has been dispatched', 'in transit', 'shipment'];
  const CONFIRMED = ['order confirm', 'thanks for your order', 'thank you for your order', 'thanks for your delivery order', 'thanks for your pickup order', 'thanks for your drive up order', 'thanks for your shipping order', 'order received', 'order placed', "we've got your order", 'we got your order', 'order successful', 'purchase successful', 'checkout successful', 'purchase confirmation', 'thanks for your purchase', 'thank you for your purchase', 'order is confirmed', 'order has been received', 'order acknowledgement', 'order acknowledgment', 'we received your order', 'order was placed', 'order has been placed', 'order was received'];
  const SUBJECT_KEYWORDS = Array.from(new Set([].concat(CANCELLED, REFUNDED, DELIVERED, READY, SHIPPED, CONFIRMED)));
  const SUBJECT_PATTERNS = ['thanks for your [a-z ]{0,20}order', '\\border (?:was |has been |is )?(?:received|placed|confirmed)\\b', '^\\s*(order\\s+)?cancel(l)?ed\\s*:', 'order\\s*#?\\s*\\d{6,}'];

  function classifyStatus(subject) {
    const s = String(subject || '').toLowerCase();
    if (!s.trim()) return null;
    if (SURVEY.some(k => s.includes(k)) || PROMO.test(s)) return null;
    if (REFUNDED.some(k => s.includes(k))) return 'refunded';
    if (CANCELLED.some(k => s.includes(k)) || /^\s*(order\s+)?cancel(l)?ed\s*:/i.test(s)) return 'cancelled';
    if (DELIVERED.some(k => s.includes(k)) && !/not\s+delivered|delivery\s+(attempt|exception|delay)/.test(s) && (/\b(order|package|item|items|shipment|parcel|purchase)\b/.test(s) || /^\s*delivered\s*:/.test(s) || /#\s?\d{5,}/.test(s) || /\b(arrived|is here|are here)\b/.test(s))) return 'delivered';
    if (READY.some(k => s.includes(k))) return 'ready';
    if (SHIPPED.some(k => s.includes(k))) return 'shipped';
    if (CONFIRMED.some(k => s.includes(k)) || /thanks for your [a-z ]{0,20}order/i.test(s)) return 'confirmed';
    if (/order\s*#?\s*\d{6,}/i.test(s) || /\border (?:was |has been |is )?(?:received|placed|confirmed)\b/i.test(s)) return 'confirmed';
    return null;
  }

  // ---------------------------------------------------------------- text helpers
  const ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: '-', mdash: '-', hellip: '...', reg: '®', copy: '©', trade: '™', bull: '•', middot: '·', zwnj: '', zwj: '', shy: '', eacute: 'é', Eacute: 'É' };
  function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try { return code ? String.fromCodePoint(code) : ''; } catch (_) { return ''; }
      }
      return Object.prototype.hasOwnProperty.call(ENT, e) ? ENT[e] : m;
    });
  }
  function htmlToText(html) {
    if (!html) return '';
    let s = String(html)
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(style|script|head|title)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6]|table|tbody|thead|section|article|header|footer|ul|ol|blockquote|center)>/gi, '\n')
      .replace(/<(td|th)[^>]*>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
    s = decodeEntities(s).replace(/[​-‍⁠﻿͏­]/g, '');
    return s.split('\n').map(l => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean).join('\n');
  }
  const flat = t => String(t || '').replace(/\s*\n+\s*/g, ', ').replace(/(,\s*){2,}/g, ', ').replace(/[ \t]+/g, ' ');

  // ---------------------------------------------------------------- store
  function domainsIn(from) { return (String(from || '').toLowerCase().match(/@([a-z0-9.\-]+)/g) || []).map(d => d.slice(1)); }
  function detectStore(from, subject, text) {
    const f = String(from || '').toLowerCase();
    const doms = domainsIn(f);
    for (const s of STORES) for (const d of s.domains) {
      if (doms.some(x => x === d || x.endsWith('.' + d))) return s.key;
      // relay addresses (iCloud Hide My Email etc.) embed the sender: "target_com_abc@privaterelay..."
      const flatD = d.replace(/\./g, '_');
      if (f.includes(flatD) || f.includes(d + '_') || f.includes('_at_' + d)) return s.key;
    }
    const name = (f.match(/^\s*"?([^"<@]+?)"?\s*</) || [])[1] || '';
    const hay = [name, subject, String(text || '').slice(0, 6000)];
    for (const h of hay) {
      const t = String(h || '').toLowerCase();
      if (!t) continue;
      for (const s of STORES) {
        if (s.key === 'other') continue;
        const names = [s.label.toLowerCase()].concat(s.alias || []).concat(s.domains);
        if (names.some(n => new RegExp('(^|[^a-z])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)').test(t))) return s.key;
      }
    }
    return 'other';
  }

  // ---------------------------------------------------------------- fields
  function extractOrderNumber(subject, text) {
    const pats = [
      /\b(\d{3}-\d{7}-\d{7})\b/,                                             // Amazon
      /\b(BBY01-\d{9,14})\b/i,                                               // Best Buy
      /order\s*(?:number|no\.?|#)?\s*[:#]?\s*(\d{7}-\d{8})\b/i,               // Walmart
      /order\s*(?:number|no\.?|#|id)?\s*[:#\-]?\s*(\d{6,9}-?\d{0,8})\b/i,     // Target & generic numeric
      /order\s*(?:number|no\.?|#|id)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-]{5,24})\b/i, // generic alphanumeric
      /\b#\s?([A-Z0-9]{2,6}-?\d{5,14})\b/,                                   // "#P001234567"
    ];
    for (const src of [subject, text]) {
      const s = String(src || '');
      for (const re of pats) {
        const m = s.match(re);
        if (m && /\d/.test(m[1]) && m[1].replace(/\D/g, '').length >= 5) return m[1].toUpperCase();
      }
    }
    return '';
  }
  const normOrderNo = n => String(n || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  function money(v) { const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; }
  function extractTotal(text) {
    const t = String(text || '');
    const strong = t.match(/(?:order total|grand total|total charged|amount charged|total paid|payment total|you paid|total amount|order amount|estimated total)\s*[:\-]?\s*(?:USD\s*)?\$\s*([\d,]+\.\d{2})/i);
    if (strong) return money(strong[1]);
    let last = null; const re = /\btotal\b\s*[:\-]?\s*(?:USD\s*)?\$\s*([\d,]+\.\d{2})/gi; let m;
    while ((m = re.exec(t))) last = m[1];
    return last != null ? money(last) : null;
  }

  function extractItems(text) {
    const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
    const items = [];
    const bad = /^(qty|quantity|price|item|items|subtotal|total|tax|shipping|estimated|order|delivers?|ship|sold by|ships? from|arrives?|get it|\$|each|details|view|track)/i;
    const priceOf = s => { const m = String(s || '').match(/\$\s*([\d,]+\.\d{2})/); return m ? money(m[1]) : null; };
    for (let i = 0; i < lines.length && items.length < 25; i++) {
      const L = lines[i];
      const q = L.match(/\b(?:qty|quantity)\s*[:x]?\s*(\d{1,3})\b/i);
      if (!q) continue;
      let name = L.slice(0, q.index).replace(/[\s,:\-|•]+$/, '').trim();
      if (name.length < 4 || bad.test(name)) {
        for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
          const c = lines[j];
          if (c.length >= 4 && !bad.test(c) && !/^\$?[\d,.\s]+$/.test(c) && !/\b(?:qty|quantity)\b/i.test(c)) { name = c; break; }
        }
      }
      if (!name || name.length < 4 || bad.test(name)) continue;
      name = name.replace(/\s*\$\s*[\d,]+\.\d{2}.*$/, '').slice(0, 160).trim();
      const price = priceOf(L.slice(q.index)) ?? priceOf(lines[i + 1]) ?? priceOf(L);
      const key = name.toLowerCase();
      const prev = items.find(x => x.name.toLowerCase() === key);
      if (prev) continue;
      items.push({ name, qty: Number(q[1]) || 1, price });
    }
    return items;
  }

  const ADDR_LABEL = /(?:delivers?\s*to|deliver(?:ing|ed)?\s*to|ship(?:ping|ped|s)?\s*to|shipping address|delivery address|ship-to|sending to|your order will be delivered to)\s*:?\s*/i;
  function extractAddress(text) {
    const f = flat(text);
    const re = new RegExp(ADDR_LABEL.source + '([^\\n]{5,220}?,\\s*[A-Z]{2}\\s+\\d{5}(?:-\\d{4})?)', 'i');
    const m = f.match(re);
    if (!m) return null;
    let cap = m[1].trim().replace(/^[,\s]+/, '').replace(/\s{2,}/g, ' ');
    if (!/[a-z]/i.test(cap) || !/\s/.test(cap) || !cap.includes(',')) return null;
    if (!/\d/.test(cap.split(',').slice(0, -1).join(','))) return null; // needs a street number
    return cap;
  }
  const looksLikeName = s => /^[A-Za-z][A-Za-z'.\-]*(?:\s+[A-Za-z][A-Za-z'.\-]*){0,3}$/.test(s) && !/\d/.test(s);
  const UNIT_RE = /\b(apt\.?|apartment|unit|suite|ste\.?|#|rm\.?|room|bldg\.?|building|fl\.?|floor|lot|trlr|trailer|spc|space|dept|po box)\s*#?\s*[a-z0-9\-]+/i;
  // Split "123 Main St Apt 4" -> { street: "123 Main St", unit: "Apt 4" }. Handles units at the end, in the
  // middle ("123 Main St Bldg 2 Apt 4"), up front ("Apt 4, 123 Main St" / "#4 123 Main St") and bare trailing
  // unit numbers after a street suffix or direction ("123 Main St 4B", "11662 S 2670 W 12").
  const UNIT_WORDS = '(?:apt|apartment|unit|suite|ste|rm|room|bldg|building|fl|flr|floor|lot|trlr|trailer|spc|space|dept|box|no|number)';
  const UNIT_VAL = '(?:[a-z]?-?\\d[a-z0-9\\-]*|[a-z](?![a-z]))';
  const UNIT_ANY = new RegExp('(?:^|[\\s,]+)((?:' + UNIT_WORDS + '\\.?\\s*#?\\s*' + UNIT_VAL + '|#\\s*[a-z0-9\\-]+)(?:[\\s,]+.*)?)$', 'i');
  const UNIT_LEAD = new RegExp('^((?:' + UNIT_WORDS + '\\.?\\s*#?\\s*' + UNIT_VAL + '|#\\s*[a-z0-9\\-]+))[\\s,]+(?=\\d)', 'i');
  const SUFFIX = '(?:st|str|street|ave|av|avenue|rd|road|dr|drive|ln|lane|ct|court|blvd|boulevard|way|pl|place|cir|circle|pkwy|parkway|hwy|highway|ter|terrace|trl|trail|loop|row|run|pass|pike|sq|square|n|s|e|w|ne|nw|se|sw|north|south|east|west|northeast|northwest|southeast|southwest)';
  const BARE_TAIL = new RegExp('^(.*\\b' + SUFFIX + '\\.?)\\s+(\\d{1,5}[a-z]?|[a-df-mo-rt-vx-z])$', 'i');
  function splitUnit(addr1) {
    let s = String(addr1 || '').replace(/\s+/g, ' ').trim(); const units = [];
    const lead = s.match(UNIT_LEAD); if (lead) { units.push(lead[1]); s = s.slice(lead[0].length); }
    const any = s.match(UNIT_ANY);
    if (any && any.index > 0 && /\d/.test(s.slice(0, any.index))) { units.push(any[1]); s = s.slice(0, any.index); }
    const bare = s.match(BARE_TAIL);
    if (bare && /\d/.test(bare[1])) { units.push(bare[2]); s = bare[1]; }
    return { street: s.replace(/[\s,#]+$/, '').trim(), unit: units.join(' ').replace(/\s+/g, ' ').trim() };
  }
  function parseAddress(raw) {
    const out = { name: '', addr1: '', addr2: '', city: '', state: '', zip: '' };
    if (!raw) return out;
    let parts = String(raw).split(',').map(p => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1] || '';
    const sz = last.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (sz) { out.state = sz[1].toUpperCase(); out.zip = sz[2]; parts = parts.slice(0, -1); }
    if (parts.length && looksLikeName(parts[0]) && parts.length >= 3) { out.name = parts.shift(); }
    else if (parts.length >= 3 && !/\d/.test(parts[0])) { out.name = parts.shift(); }
    if (parts.length) out.city = parts.pop();
    if (parts.length) out.addr1 = parts.shift();
    if (parts.length) out.addr2 = parts.join(', ');
    // "Apt 3, 123 Main St" - the unit came first as its own part
    if (out.addr1 && out.addr2 && !/^\d/.test(out.addr1) && /^\d/.test(out.addr2)) { const u = out.addr1; out.addr1 = out.addr2.split(',')[0].trim(); out.addr2 = [u].concat(out.addr2.split(',').slice(1).map(x => x.trim()).filter(Boolean)).join(', '); }
    const su = splitUnit(out.addr1);
    if (su.unit) { out.addr1 = su.street; out.addr2 = [su.unit, out.addr2].filter(Boolean).join(', '); }
    return out;
  }
  function extractName(text) {
    const t = String(text || '');
    const m1 = t.match(/thanks for your (?:[a-z ]{0,20})?order,\s*([A-Z][a-zA-Z'\-]+)/i);
    if (m1) return m1[1];
    const m2 = t.match(/\b(?:hi|hello|dear|hey)\s+([A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+)?)\s*[,!]/);
    return m2 ? m2[1] : '';
  }

  // Dates are parsed by hand (not new Date("Oct 21 2026")) because Safari can't read those strings.
  const MONTH_IDX = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
  const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
  const DATE_WORD = '\\b' + MONTH + '\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?:,?\\s+\\d{4})?';
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  function refDate(refISO) { const r = refISO ? new Date(refISO) : new Date(); return Number.isNaN(r.getTime()) ? new Date() : r; }
  function isoFrom(str, refISO) {
    const ref = refDate(refISO); const s = String(str || '').trim().toLowerCase();
    let y, m, d, hasYear = false, mm = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (mm) { m = +mm[1] - 1; d = +mm[2]; if (mm[3]) { y = +mm[3]; if (y < 100) y += 2000; hasYear = true; } }
    else {
      mm = s.match(new RegExp('^(' + MONTH + ')\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?$', 'i'));
      if (!mm) return '';
      m = MONTH_IDX[mm[1].replace('.', '')]; d = +mm[2]; if (mm[3]) { y = +mm[3]; hasYear = true; }
    }
    if (m == null || m < 0 || m > 11 || d < 1 || d > 31) return '';
    if (!hasYear) {
      y = ref.getFullYear(); const c = new Date(y, m, d);
      if (c.getTime() < ref.getTime() - 60 * 864e5) y++; else if (c.getTime() - ref.getTime() > 300 * 864e5) y--;
    }
    const dt = new Date(y, m, d); return dt.getMonth() === m ? ymd(dt) : '';
  }
  function relDayIso(word, refISO) {
    const ref = refDate(refISO); const base = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()); const w = word.toLowerCase();
    if (w === 'today') return ymd(base);
    if (w === 'tomorrow') return ymd(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1));
    const i = DAYS.findIndex(x => x.startsWith(w.slice(0, 3))); if (i < 0) return '';
    const diff = (i - base.getDay() + 7) % 7; return ymd(new Date(base.getFullYear(), base.getMonth(), base.getDate() + diff));
  }
  // Phrases that introduce an arrival date. Not "Delivers to:" / "Delivery address" (those are addresses).
  const ETA_TRIG = '(?:arriv(?:es|ing|al)?(?:\\s+(?:by|on))?|get it(?:\\s+by)?|estimated\\s+(?:delivery|arrival)(?:\\s+date)?|expected\\s+(?:delivery|arrival|by)|delivery\\s+(?:date|by|estimate|expected|window)|deliver(?:s|ing|ed)?\\s+(?:by|on)|will\\s+be\\s+delivered(?:\\s+(?:by|on))?|should\\s+arrive|ready\\s+(?:for\\s+pick\\s?up\\s+)?by|pick\\s?up\\s+by|eta|deliver(?:s|ing)?(?=\\s+(?:mon|tue|wed|thu|fri|sat|sun|' + MONTH.replace('\\.?', '') + '|\\d)))';
  function extractEta(text, refISO) {
    const t = String(text || '');
    const gap = '\\b[^.\\n]{0,28}?';
    let m = t.match(new RegExp(ETA_TRIG + gap + '(' + DATE_WORD + ')', 'i')); if (m) { const v = isoFrom(m[1].replace(/\s+/g, ' '), refISO); if (v) return v; }
    m = t.match(new RegExp(ETA_TRIG + gap + '\\b(\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?)\\b', 'i')); if (m) { const v = isoFrom(m[1], refISO); if (v) return v; }
    m = t.match(new RegExp(ETA_TRIG + '\\s+(?:by\\s+|on\\s+|this\\s+)?(today|tomorrow|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\\b', 'i')); if (m) { const v = relDayIso(m[1], refISO); if (v) return v; }
    return '';
  }

  function detectCarrier(n) {
    n = String(n || '').replace(/\s+/g, '').toUpperCase();
    if (!n) return '';
    if (/^1Z[0-9A-Z]{16}$/.test(n)) return 'UPS';
    if (/^(92|93|94|95|00)\d{18,24}$/.test(n) || /^[A-Z]{2}\d{9}US$/.test(n)) return 'USPS';
    if (/^(\d{12}|\d{15}|\d{20}|\d{22})$/.test(n)) return 'FedEx';
    if (/^\d{10,11}$/.test(n)) return 'DHL';
    if (/^TBA\d{9,12}$/.test(n)) return 'Amazon';
    return '';
  }
  function trackingUrl(num, carrier) {
    const n = String(num || '').replace(/\s+/g, '').toUpperCase(); if (!n) return '';
    const c = carrier || detectCarrier(n); const e = encodeURIComponent(n);
    switch (c) {
      case 'UPS': return 'https://www.ups.com/track?tracknum=' + e;
      case 'USPS': return 'https://tools.usps.com/go/TrackConfirmAction?tLabels=' + e;
      case 'FedEx': return 'https://www.fedex.com/fedextrack/?trknbr=' + e;
      case 'DHL': return 'https://www.dhl.com/us-en/home/tracking.html?tracking-id=' + e;
      case 'Amazon': return 'https://track.amazon.com/tracking/' + e;
      default: return 'https://parcelsapp.com/en/tracking/' + e;
    }
  }
  function extractTracking(text, orderNumber) {
    const t = String(text || ''); const found = [];
    const add = n => { n = n.replace(/\s+/g, '').toUpperCase(); if (n && n !== normOrderNo(orderNumber) && !found.some(f => f.number === n)) found.push({ number: n, carrier: detectCarrier(n) }); };
    (t.match(/\b1Z[0-9A-Z]{16}\b/gi) || []).forEach(add);
    (t.match(/\b9[2-5]\d{18,24}\b/g) || []).forEach(add);
    (t.match(/\b[A-Z]{2}\d{9}US\b/g) || []).forEach(add);
    (t.match(/\bTBA\d{9,12}\b/g) || []).forEach(add);
    const re = /tracking\s*(?:number|no\.?|#|id)?\s*[:#]?\s*([A-Z0-9 ]{10,34})/gi; let m;
    while ((m = re.exec(t))) {
      const cand = m[1].trim().split(/\s{2,}/)[0].replace(/\s+/g, '');
      if (/^\d{10,22}$/.test(cand) || /^[A-Z0-9]{10,30}$/.test(cand) && /\d{6}/.test(cand)) add(cand);
    }
    return found.filter(f => f.carrier || f.number.length >= 12).slice(0, 6);
  }
  function extractLast4(text) {
    const m = String(text || '').match(/(?:ending in|ending with|ending|ends in|card\s*[*•x]{2,}|[*•]{3,}|x{3,})\s*[:#]?\s*(\d{4})\b/i);
    return m ? m[1] : '';
  }

  // ---------------------------------------------------------------- addresses / houses
  const WORDS = { street: 'st', str: 'st', avenue: 'ave', av: 'ave', road: 'rd', drive: 'dr', lane: 'ln', court: 'ct', boulevard: 'blvd', place: 'pl', circle: 'cir', parkway: 'pkwy', highway: 'hwy', terrace: 'ter', square: 'sq', trail: 'trl', north: 'n', south: 's', east: 'e', west: 'w', northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw', apartment: 'apt', suite: 'ste', building: 'bldg', floor: 'fl', room: 'rm', mount: 'mt', point: 'pt', crossing: 'xing', expressway: 'expy', freeway: 'fwy', center: 'ctr', heights: 'hts', junction: 'jct', mountain: 'mtn', ridge: 'rdg', valley: 'vly', view: 'vw', village: 'vlg' };
  // Houses are grouped on the street address ONLY - any apt / unit / suite / line 2 is ignored.
  function normStreet(addr1) {
    let s = splitUnit(addr1).street.toLowerCase();
    s = s.replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim();
    return s.split(' ').map(w => WORDS[w] || w).join(' ');
  }
  const normUnit = a => String(a || '').toLowerCase().replace(/\b(apartment|apt|unit|suite|ste|#|room|rm|no|number|bldg|building|fl|floor|lot|trlr|spc|space)\b/g, '').replace(/[^a-z0-9]/g, '');
  const zip5 = z => String(z || '').slice(0, 5);
  const houseKey = (addr1, zip) => { const s = normStreet(addr1); return s ? s + '|' + zip5(zip) : ''; };
  const unitKey = (addr1, addr2, zip) => { const h = houseKey(addr1, zip); return h ? h + '|' + normUnit([splitUnit(addr1).unit, addr2].filter(Boolean).join(' ')) : ''; };

  // ---------------------------------------------------------------- main
  function parseOrderEmail(m) {
    const subject = String(m.subject || '');
    const status = classifyStatus(subject);
    if (!status) return null;
    const A = m.text && (String(m.text).trim().length > 60 || !m.html) ? String(m.text) : '';
    const B = m.html ? htmlToText(m.html) : '';
    const sources = [A, B].filter(Boolean);
    if (!sources.length) sources.push('');
    const pick = fn => { for (const s of sources) { const v = fn(s); if (v && (!Array.isArray(v) || v.length)) return v; } return Array.isArray(fn('')) ? [] : (fn === extractTotal ? null : ''); };
    const orderNumber = (() => { for (const s of sources) { const v = extractOrderNumber(subject, s); if (v) return v; } return ''; })();
    const rawAddr = pick(extractAddress);
    const addr = parseAddress(rawAddr || '');
    const text = sources.join('\n');
    return {
      status,
      store: detectStore(m.from, subject, text),
      orderNumber,
      subject,
      from: m.from || '',
      to: (m.to || [])[0] || '',
      date: m.date || new Date().toISOString(),
      messageId: m.messageId || '',
      name: addr.name || pick(extractName) || '',
      address: addr,
      rawAddress: rawAddr || '',
      eta: (() => { for (const s of sources) { const v = extractEta(s, m.date); if (v) return v; } return ''; })(),
      total: pick(extractTotal),
      tracking: (() => { for (const s of sources) { const v = extractTracking(s, orderNumber); if (v.length) return v; } return []; })(),
      last4: pick(extractLast4),
      items: pick(extractItems),
    };
  }

  // A sender key for "ignore this sender": the whole domain for normal stores, the exact address for relay
  // / personal-mail addresses (so ignoring one Hide-My-Email relay doesn't block every store).
  function senderKey(from) {
    const m = String(from || '').toLowerCase().match(/[a-z0-9._%+\-]+@([a-z0-9.\-]+)/); if (!m) return '';
    const dom = m[1];
    if (/privaterelay|icloud\.com|me\.com|mac\.com|gmail\.com|googlemail|yahoo|outlook|hotmail|live\.com|aol\.com|relay|forward/.test(dom)) return m[0];
    const parts = dom.split('.'); return parts.slice(-2).join('.');
  }
  const API = { STORES, storeInfo, SUBJECT_KEYWORDS, SUBJECT_PATTERNS, classifyStatus, htmlToText, decodeEntities, detectStore, extractOrderNumber, normOrderNo, extractTotal, extractItems, extractAddress, parseAddress, extractName, extractEta, detectCarrier, trackingUrl, extractTracking, extractLast4, normStreet, normUnit, splitUnit, senderKey, zip5, houseKey, unitKey, parseOrderEmail, isoFrom };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.Parser = API;
})(typeof window !== 'undefined' ? window : globalThis);

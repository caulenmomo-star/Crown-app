/* Crown Tools - order email parser (pure functions; no DOM, no state).
   Turns a retailer email into a normalized order update. Best-effort and
   template-agnostic: it looks for the patterns that show up across almost
   every retailer's confirmation / shipping / delivery / cancellation email. */
(function (root) {
  'use strict';

  const STORES = [
    { key: 'target', label: 'Target', color: '#e0384a', domains: ['target.com'] },
    { key: 'walmart', label: 'Walmart', color: '#4aa3ff', domains: ['walmart.com'] },
    { key: 'pokemoncenter', label: 'Pokémon Center', color: '#ffcb05', domains: ['pokemoncenter.com', 'pokemon.com'], alias: ['pokemon center'] },
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
    { key: 'playstation', label: 'PlayStation Direct', color: '#3e6fd8', domains: ['direct.playstation.com', 'playstation.com', 'sony.com'], alias: ['playstation direct'] },
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
  const CANCELLED = ['had to cancel', 'order canceled', 'order cancelled', 'order was canceled', 'order was cancelled', 'been canceled', 'been cancelled', 'canceled:', 'cancelled:', 'cancellation', 'item canceled', 'item cancelled', 'items canceled', 'items cancelled', 'item was canceled', 'item was cancelled', 'unable to fulfill', "couldn't fulfill", 'could not fulfill', 'we canceled', 'we cancelled', 'canceled your', 'cancelled your'];
  const REFUNDED = ['refund issued', 'refund has been', 'your refund', 'refund processed', 'refund confirmation', 'return received', 'return has been processed', 'refunded'];
  const DELIVERED = ['delivered', 'arrived:', 'was picked up', 'has been picked up', 'picked up your order', 'has arrived', 'have arrived', 'order is here', 'package is here', 'items are here', 'order arrived', 'package arrived', 'items arrived', 'item arrived'];
  const READY = ['ready for pickup', 'ready for drive up', 'ready to pick up', 'is ready for pick', 'ready for curbside', 'ready for in-store pickup'];
  const OUT = ['out for delivery', 'arrive today', 'arrives today', 'arriving today', 'coming today', 'delivering today', 'will be delivered today'];
  const SHIPPED = ['shipped', 'has shipped', 'on its way', 'is on the way', 'are on the way', 'on their way', 'tracking number', 'has been dispatched', 'in transit', 'shipment', 'about to ship', 'ready to ship', 'getting ready to ship', 'preparing to ship', 'arrive tomorrow', 'arrives tomorrow', 'arriving tomorrow', 'arriving soon', 'arrives soon', 'headed your way', 'heading your way', 'on the move', 'label created', 'has been sent', 'have been sent', 'shipping update', 'package update', 'tracking info', 'tracking update'];
  const CONFIRMED = ['order confirm', 'thanks for your order', 'thank you for your order', 'thanks for your delivery order', 'thanks for your pickup order', 'thanks for your drive up order', 'thanks for your shipping order', 'thanks for shopping', 'thank you for shopping', "here's your order", 'here is your order', 'order received', 'order placed', "we've got your order", 'we got your order', 'order successful', 'purchase successful', 'checkout successful', 'purchase confirmation', 'thanks for your purchase', 'thank you for your purchase', 'order is confirmed', 'order has been received', 'order acknowledgement', 'order acknowledgment', 'we received your order', 'order was placed', 'order has been placed', 'order was received', 'your preorder', 'your pre-order', 'preorder payment', 'pre-order payment', 'preorder is', 'pre-order is', 'release day', "we're on it", 'your receipt', 'order details', 'order update', 'order status'];
  const SUBJECT_KEYWORDS = Array.from(new Set([].concat(CANCELLED, REFUNDED, DELIVERED, READY, OUT, SHIPPED, CONFIRMED)));
  // Python-compatible regexes (the helper filters subjects with these too).
  const SUBJECT_PATTERNS = ['thanks for your [a-z ]{0,20}order', '\\border (?:was |has been |is )?(?:received|placed|confirmed)\\b', '^\\s*(order\\s+)?cancel(l)?ed\\s*:', 'order\\s*(?:number|no\\.?)?\\s*#?\\s*:?\\s*\\d{6,}', '#\\s*:?\\s*\\d{9,}', '\\barriv(?:e|es|ed|ing)\\b', '\\border\\s*#\\s*:?\\s*[a-z]{0,4}-?\\d{4,}'];
  const SUBJECT_RES = SUBJECT_PATTERNS.map(p => new RegExp(p, 'i'));
  const has = (s, list) => list.some(k => s.includes(k));

  function classifyStatus(subject) {
    const s = String(subject || '').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ');
    if (!s.trim()) return null;
    if (has(s, SURVEY) || PROMO.test(s)) return null;
    if (/\b(not|never)\s+(been\s+)?(shipped|delivered)\b|delivery\s+(attempt|exception|delay)|\bdelayed\b|\brunning late\b/.test(s) && !has(s, CANCELLED)) return /order|#\s*\d/.test(s) ? 'shipped' : null;
    if (has(s, REFUNDED) && !/refund (?:policy|request)/.test(s)) return 'refunded';
    if (has(s, CANCELLED) || /^\s*(order\s+)?cancel(l)?ed\s*:/i.test(s)) return 'cancelled';
    if (has(s, DELIVERED) && (/\b(order|package|item|items|shipment|parcel|purchase|preorder)\b/.test(s) || /^\s*(delivered|arrived)\s*:?/.test(s) || /#\s?\d{5,}/.test(s))) return 'delivered';
    if (has(s, READY)) return 'ready';
    if (has(s, OUT)) return 'out';
    if (has(s, SHIPPED)) return 'shipped';
    if (has(s, CONFIRMED) || /thanks for your [a-z ]{0,20}order/.test(s)) return 'confirmed';
    if (/\border\s*#\s*:?\s*[a-z]{0,4}-?\d{4,}/.test(s) || /order\s*(?:number|no\.?)?\s*#?\s*:?\s*\d{6,}/.test(s) || /#\s*:?\s*\d{9,}/.test(s) || /\border (?:was |has been |is )?(?:received|placed|confirmed)\b/.test(s)) return 'confirmed';
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
  // Images in an email: [{src, alt}] in document order. Used to find each item's picture.
  function attr(tag, name) { const m = tag.match(new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i')); return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '').trim() : ''; }
  // Clearly-not-a-product pictures (logos, social icons, tracking pixels, banners).
  const TRACKER_IMG = /\/o\/|opentracker|\/gp\/r\.html|realtime\.bestbuy|\/open\.|pixel|spacer|beacon|1x1|blank\.gif/i;
  const JUNK_IMG = /logo|[_\-\/]icons?[_\-\/.]|arrow|bullseye|joy-|social|facebook|twitter|instagram|pinterest|youtube|tiktok|app-?store|google-?play|appdownload|appphone|checkmark|thumbs_|steptracker|ops_(?:visa|master|amex|disc)|\/dam\/|\/dfw\/|\/dfwrs\/|circlecard|baseactivity|freesdd/i;
  const JUNK_ALT = /logo|icon|arrow|\bvisa\b|mastercard|amex|discover|card image|app store|google play|visit us|follow us|bullseye|circle card|shopping bag|delivering an order|bringing an order|holding a|walmart (?:home|plus|cash)|^x$|youtube|instagram|tiktok|facebook|pinterest|^completed$|deal of the day|outlet|support|confirm/i;
  function productImage(img, strict) {
    if (!img || !/^https:\/\//i.test(img.src) || TRACKER_IMG.test(img.src)) return false;
    if (img.alt && JUNK_ALT.test(img.alt)) return false;
    if (strict && JUNK_IMG.test(img.src)) return false;
    const w = parseInt(img.w, 10) || 0, h = parseInt(img.h, 10) || 0;
    return !((w && w < 40) || (h && h < 30));
  }
  function htmlToText(html, imgs) {
    if (!html) return '';
    let s = String(html)
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(style|script|head|title)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6]|table|tbody|thead|section|article|header|footer|ul|ol|blockquote|center)>/gi, '\n')
      .replace(/<(td|th)[^>]*>/gi, ' ')
      .replace(/<img\b[^>]*>/gi, t => { if (!imgs) return ' '; imgs.push({ src: attr(t, 'src'), alt: attr(t, 'alt'), w: attr(t, 'width'), h: attr(t, 'height') }); return '\n\u27E6img:' + (imgs.length - 1) + '\u27E7\n'; })
      .replace(/<[^>]+>/g, ' ');
    s = decodeEntities(s).replace(/[\u200B-\u200D\u2060\uFEFF\u034F\u00AD\u2007\u202A-\u202E]/g, '');
    return s.split('\n').map(l => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean).join('\n').replace(/\n:\s*/g, ': ');
  }
  // Plain-text parts: decode stray entities, drop long tracking links and invisible padding characters.
  function cleanPlain(t) {
    return decodeEntities(String(t || '')).replace(/[\u200B-\u200D\u2060\uFEFF\u034F\u00AD\u2007\u202A-\u202E]/g, '')
      .replace(/\[([^\]]*)\]\((https?:[^)]+)\)/g, '$1').replace(/<?https?:\/\/\S+>?/g, ' ')
      .split('\n').map(l => l.replace(/[ \t\u00A0]+/g, ' ').trim()).filter(Boolean).join('\n');
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
      const t = String(h || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
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
      /\b(\d{3}-\d{7}-\d{7})\b/,                                                      // Amazon
      /\b(BBY01-\d{9,14})\b/i,                                                        // Best Buy
      /\border\s*(?:number|no\.?|#|id)?[\s:#]*(\d{7}-\d{8})(?!\d)/i,                    // Walmart
      /\border\s*(?:number|no\.?|#|id)?[\s:#\-]*(\d{6,22}(?:-\d{2,12})?)(?!\d)/i,       // Target & generic numeric
      /\border\s*(?:number|no\.?|#|id)[\s:#]*([A-Z0-9][A-Z0-9\-]{5,24})\b/i,             // generic alphanumeric
      /#\s*:?\s*(\d{9,22})(?!\d)/,                                                     // "... payment soon #102003655603099"
      /\b#\s?([A-Z]{1,6}-?\d{5,14})\b/,                                                // "#P001234567"
    ];
    for (const src of [subject, text]) {
      const s = String(src || '').replace(/[\u200E\u200F\u202A-\u202E]/g, '');
      for (const re of pats) {
        const m = s.match(re);
        if (m && /\d/.test(m[1]) && m[1].replace(/\D/g, '').length >= 5) return m[1].toUpperCase();
      }
    }
    return '';
  }
  const normOrderNo = n => String(n || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  function money(v) { const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; }
  const AMT = '(?:USD\\s*)?\\$\\s*([\\d,]+\\.\\d{2})|([\\d,]+\\.\\d{2})\\s*USD';
  // A payment line ("we processed a payment of $X", "we'll reauthorize $X") can cover only part of an order,
  // so it's only used when the email has no real order total.
  function extractPayment(text) {
    const m = String(text || '').match(new RegExp('(?:processed|charged|(?:re)?authoriz(?:e|ed))\\s+(?:a\\s+)?(?:payment\\s+)?(?:of|for)\\s+(?:' + AMT + ')', 'i'));
    return m ? money(m[1] || m[2]) : null;
  }
  function extractTotal(text) {
    const t = String(text || '');
    // "Order total ... $150.41" - the label may sit a line or a short phrase away from the amount.
    const strong = new RegExp('(?:order total|grand total|total charged|amount charged|total paid|payment total|you paid|total amount|order amount|estimated total|total due|charged to your card)[^$\\d]{0,60}?(?:' + AMT + ')', 'i');
    let m = t.match(strong); if (m) return money(m[1] || m[2]);
    // last plain "Total" (not subtotal, not "you saved a total of")
    let last = null; const re = new RegExp('\\btotal\\b[\\s:\\-]*(?:' + AMT + ')', 'gi');
    while ((m = re.exec(t))) {
      const before = t.slice(Math.max(0, m.index - 12), m.index).toLowerCase();
      if (/sub\s*$/.test(before) || /(saved|savings|save)\s+(a\s+)?$/.test(before)) continue;
      last = m[1] || m[2];
    }
    if (last != null) return money(last);
    m = t.match(/\b(?:order\s+)?subtotal\b[^$\n]{0,30}\n?\s*\$\s*([\d,]+\.\d{2})/i); // some stores (Pokémon Center) only show a subtotal
    return m ? money(m[1]) : null;
  }
  function extractSubtotal(text) { const m = String(text || '').match(/\bsubtotal\b[^$\n]{0,30}\n?\s*\$\s*([\d,]+\.\d{2})/i); return m ? money(m[1]) : null; }

  // Items: every "Qty: N" (same line or the next) is one item; its name is the nearest real line above it.
  // Pictures come from the email's <img> tags: the one whose alt text matches the name, else the closest one above.
  const IMG_MARK = /^\u27E6img:(\d+)\u27E7$/;
  const NOT_NAME = /^(qty|quantity|price|item|items|subtotal|total|tax|estimated|order|delivers?|ship|shipping|sold by|ships? from|arrives?|arriving|get it|\$|each|details|view|track|model|sku|upc|dpci|tcin|color|size|style|note|pre-?ordered|preorder|status|in stock|free|return|rate|write a review|delivered|items? delivered|fulfilled by|seller|condition|gift|protection|plan|warranty|qty:|edit|remove|buy again)\b/i;
  const normName = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/^(quantity\s+\d+\s+items?\s+|product image for:?\s*)/, '').replace(/[^a-z0-9]+/g, '');
  function nameMatches(a, b) {
    const x = normName(a), y = normName(b); if (x.length < 6 || y.length < 6) return false;
    const n = Math.min(x.length, y.length, 28); return x.slice(0, n) === y.slice(0, n) || x.includes(y.slice(0, 24)) || y.includes(x.slice(0, 24));
  }
  function extractItems(text, imgs) {
    imgs = imgs || [];
    const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
    const items = [];
    const priceOf = s => { const m = String(s || '').match(/\$\s*([\d,]+\.\d{2})/); return m ? money(m[1]) : null; };
    const isPriceLine = s => /^[\s$\d,.\/a-z]*\$\s*[\d,]+\.\d{2}[\s\/a-z.]*$/i.test(s) && !/[a-z]{4,}/i.test(s.replace(/\b(each|ea|usd|per|unit)\b/gi, ''));
    const okName = c => c && c.length >= 4 && !IMG_MARK.test(c) && !NOT_NAME.test(c) && !/^[\s$\d,.:#\-\/x]+$/i.test(c) && /[a-z]{2}/i.test(c) && !/:\s*$/.test(c) && !/\b(?:qty|quantity)\b/i.test(c) && !isPriceLine(c);
    for (let i = 0; i < lines.length && items.length < 40; i++) {
      const L = lines[i];
      let q = L.match(/\b(?:qty|quantity)\s*[:x]?\s*(\d{1,3})\b/i), qty;
      let nameLimit = i;
      if (q) qty = +q[1];
      else if (/^(?:qty|quantity)\s*:?$/i.test(L) && /^\d{1,3}$/.test(lines[i + 1] || '')) { qty = +lines[i + 1]; q = { index: 0 }; }
      else continue;
      let name = L.slice(0, q.index).replace(/[\s,:\-|•]+$/, '').trim(), at = i;
      if (!okName(name)) {
        name = '';
        for (let j = nameLimit - 1; j >= Math.max(0, nameLimit - 8); j--) {
          const c = lines[j];
          if (/\b(?:qty|quantity)\b/i.test(c) && j < i) break; // the previous item
          if (okName(c)) { name = c; at = j; break; }
        }
      }
      if (!name) continue;
      name = name.replace(/\s*\$\s*[\d,]+\.\d{2}.*$/, '').replace(/\s+/g, ' ').slice(0, 160).trim();
      // price: on the qty line, or in the lines between the name and a few lines past the qty
      let price = null, each = false;
      for (let j = at; j <= Math.min(lines.length - 1, i + 3); j++) {
        if (j > i && /\b(?:qty|quantity)\b/i.test(lines[j])) break;
        const v = priceOf(lines[j]); if (v != null && !/total|subtotal|tax|shipping|saved|was\s*\$/i.test(lines[j])) { price = v; each = /\/\s*ea|\beach\b|\bea\b|per item/i.test(lines[j]); break; }
      }
      // picture: alt text matches the name, else the nearest product picture just above the name
      let image = '';
      const alt = imgs.find(im => !im.used && im.alt && nameMatches(im.alt, name) && productImage(im, false));
      if (alt) { image = alt.src; alt.used = true; }
      else for (let j = at - 1; j >= Math.max(0, at - 6); j--) {
        const mk = lines[j].match(IMG_MARK); if (!mk) { if (/\b(?:qty|quantity)\b/i.test(lines[j])) break; continue; }
        const im = imgs[+mk[1]]; if (im && !im.used && productImage(im, true)) { image = im.src; im.used = true; break; }
      }
      if (items.some(x => x.name.toLowerCase() === name.toLowerCase())) continue;
      items.push({ name, qty: qty || 1, price, each, image });
    }
    // Table layout (PlayStation Direct): a "Quantity" column header, then rows of name / number / ... / price
    if (!items.length && lines.some(l => /^(?:qty|quantity)$/i.test(l))) {
      const start = lines.findIndex(l => /^(?:qty|quantity)$/i.test(l));
      for (let i = start + 1; i < lines.length - 1 && items.length < 40; i++) {
        if (/^(subtotal|total|order summary|estimated)/i.test(lines[i])) break;
        if (!okName(lines[i]) || !/^\d{1,3}$/.test(lines[i + 1])) continue;
        let price = null; for (let j = i + 2; j <= Math.min(lines.length - 1, i + 4); j++) { const v = priceOf(lines[j]); if (v != null) { price = v; break; } }
        items.push({ name: lines[i].slice(0, 160), qty: +lines[i + 1] || 1, price, each: false, image: '' });
        i++;
      }
    }
    // Walmart-style: names live only in picture alt text - "quantity 5 item Pokemon Trading Card Game ..."
    for (const im of imgs) {
      const m = String(im.alt || '').match(/^quantity\s+(\d{1,3})\s+items?\s+(.{4,})$/i);
      if (!m || !productImage(im, false)) continue;
      const name = m[2].trim().slice(0, 160);
      const have = items.find(x => nameMatches(x.name, name));
      if (have) { if (!have.image) have.image = im.src; continue; }
      items.push({ name, qty: +m[1] || 1, price: null, each: false, image: im.src });
    }
    return items;
  }
  // Prices next to an item are usually per-unit ("$69.99 / ea") but some stores show the line total.
  // Use the order subtotal to tell which, then store a per-unit price.
  function settlePrices(items, subtotal) {
    const unknown = items.filter(i => i.price != null && !i.each && i.qty > 1);
    if (unknown.length && subtotal != null) {
      const asLine = items.reduce((a, i) => a + (i.price || 0) * (i.each || !unknown.includes(i) ? i.qty : 1), 0);
      if (Math.abs(asLine - subtotal) < 0.05) unknown.forEach(i => { i.price = Math.round(i.price / i.qty * 100) / 100; });
    }
    return items.map(i => { const o = { name: i.name, qty: i.qty, price: i.price }; if (i.image) o.image = i.image; return o; });
  }

  const ADDR_LABEL = /(?:delivers?\s*to|deliver(?:ing|ed)?\s*to|ship(?:ping|ped|s)?\s*to|shipping address|delivery address|ship-to|sending to|your order will be delivered to)\s*:?\s*/i;
  const ST_ZIP = ',\\s*[A-Z]{2},?\\s+\\d{5}(?:-\\d{4})?(?![\\d])';
  const HQ_ZIPS = /\b(98004|55423|98109|55403|72716|94043|98052|95014|10001)\b/; // store head offices in email footers
  const okAddr = cap => /[a-z]/i.test(cap) && /\s/.test(cap) && cap.includes(',') && /\d/.test(cap.split(',').slice(0, -1).join(','));
  function extractAddress(text) {
    const f = flat(text);
    const re = new RegExp(ADDR_LABEL.source + '([^\\n]{5,220}?' + ST_ZIP + ')', 'i');
    const m = f.match(re);
    if (m) {
      const cap = m[1].trim().replace(/^[,\s]+/, '').replace(/\s{2,}/g, ' ');
      if (okAddr(cap)) return cap;
    }
    // No label (Walmart): a line that is a whole street address - "11662 S 2670 W, Riverton, UT, 84065, USA"
    const lines = String(text || '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i].trim();
      if (/©|\(c\)\s*\d{4}|all rights reserved|inc\.|corporate|headquarters/i.test(L)) break;
      const mm = L.match(new RegExp('^((?:[A-Za-z][A-Za-z.\'\\-]+(?:\\s+[A-Za-z][A-Za-z.\'\\-]+){0,3},\\s*)?\\d{1,6}\\s+[^,]{2,60},(?:\\s*[^,]{1,40},)?\\s*[A-Za-z .\'\\-]{2,30}' + ST_ZIP + ')(?:,\\s*(?:USA|US|United States))?$', 'i'));
      if (mm && !HQ_ZIPS.test(mm[1]) && okAddr(mm[1])) return mm[1];
    }
    return null;
  }
  // Amazon only shows "evelyn - HERRIMAN, UT": a name and a town, no street.
  function extractShortRecipient(text) {
    const m = String(text || '').match(/^([A-Za-z][A-Za-z .'\-]{1,40}?)\s+-\s+([A-Za-z][A-Za-z .'\-]{1,40}),\s*([A-Z]{2})$/m);
    return m ? { name: m[1].trim(), city: m[2].trim(), state: m[3] } : null;
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
  const FUZZY_UNIT = ['suite', 'apartment', 'unit', 'apt', 'building', 'bldg', 'room', 'floor', 'space', 'trailer', 'lot', 'ste'];
  function splitUnit(addr1) {
    let s = String(addr1 || '').replace(/\s+/g, ' ').trim(); const units = [];
    const lead = s.match(UNIT_LEAD); if (lead) { units.push(lead[1]); s = s.slice(lead[0].length); }
    const any = s.match(UNIT_ANY);
    if (any && any.index > 0 && /\d/.test(s.slice(0, any.index))) { units.push(any[1]); s = s.slice(0, any.index); }
    // letter-only unit jigs at the end: "Apt JAS", "Suite MGW", "No. RCH"
    { const m = s.match(/^(.*\d.*?)[\s,]+((?:apt|apartment|unit|suite|ste|fl|flr|floor|bldg|building|rm|room|no|dept|lot|spc|space)\.?\s*#?\s*[a-z]{1,4})$/i); if (m && /\s/.test(m[1]) && !KNOWN_TOK(fixTok(m[2].split(/[\s.#]+/).pop().toLowerCase()))) { units.push(m[2]); s = m[1]; } }
    // misspelled unit words from address jigs: "Suuite 635", "Apartmnet 4", "Unti 9"
    { const toks = s.split(' '); for (let j = 2; j < toks.length - 1; j++) { const w = toks[j].toLowerCase().replace(/[^a-z]/g, ''); if (w.length >= 3 && /\d/.test(toks[j + 1]) && FUZZY_UNIT.some(u => Math.abs(u.length - w.length) <= 2 && dl(u, w) <= (u.length >= 5 ? 2 : 1))) { units.push(toks.slice(j).join(' ')); s = toks.slice(0, j).join(' '); break; } } }
    const bare = s.match(BARE_TAIL);
    if (bare && /\d/.test(bare[1])) { units.push(bare[2]); s = bare[1]; }
    return { street: s.replace(/[\s,#]+$/, '').trim(), unit: units.join(' ').replace(/\s+/g, ' ').trim() };
  }
  function parseAddress(raw) {
    const out = { name: '', addr1: '', addr2: '', city: '', state: '', zip: '' };
    if (!raw) return out;
    const norm = String(raw).replace(/,\s*(?:USA|US|United States)\s*$/i, '').replace(/,\s*([A-Za-z]{2}),\s*(\d{5}(?:-\d{4})?)\s*$/, ', $1 $2');
    let parts = norm.split(',').map(p => p.trim()).filter(Boolean);
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
  const DATE_WORD = '\\b' + MONTH + '\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?:,?[ \\t]+(?:19|20)\\d{2}\\b)?(?!\\d)';
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
  // "Arrives Thu, Sep 17 – Tue, Sep 22": the end of a delivery window, when the email gives one.
  function extractEtaEnd(text, refISO, eta) {
    if (!eta) return '';
    const m = String(text || '').match(new RegExp(ETA_TRIG + '\\b[^.\\n]{0,28}?' + DATE_WORD + '\\s*(?:–|—|-|to|through|and)\\s*(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\\s*)?(' + DATE_WORD + '|\\d{1,2}\\b)', 'i'));
    if (!m) return '';
    let v = /^\d{1,2}$/.test(m[1]) ? eta.slice(0, 8) + String(m[1]).padStart(2, '0') : isoFrom(m[1].replace(/\s+/g, ' '), refISO);
    return v && v > eta ? v : '';
  }
  function extractEta(text, refISO) {
    const t = String(text || '');
    const gap = '\\b[^.\\n]{0,28}?(?:\\n[^.\\n]{0,14}?)?';
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
    const t = String(text || '');
    const m = t.match(/(?:ending in|ending with|ending|ends in|card\s*[*•x]{2,}|[*•]{3,}|x{3,})\s*[:#]?\s*(\d{4})\b/i) ||
      t.match(/\b(?:visa|master\s?card|amex|american express|discover|debit|credit|card)\b[^\d\n]{0,14}?[*•]+\s*(\d{4})\b/i);
    return m ? m[1] : '';
  }
  // "Delivered September 19, 2026" / "Delivered on Sat, Sep 19" / "Delivered today"
  function extractDeliveredOn(text, refISO) {
    const t = String(text || '');
    let m = t.match(new RegExp('\\bdelivered\\s+(?:on\\s+)?(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\\s+)?(' + DATE_WORD + ')', 'i'));
    if (m) { const v = isoFrom(m[1].replace(/\s+/g, ' '), refISO); if (v) return v; }
    m = t.match(/\bdelivered\s+(today|yesterday)\b/i);
    if (m) { const r = refDate(refISO); const d = new Date(r.getFullYear(), r.getMonth(), r.getDate() - (m[1].toLowerCase() === 'yesterday' ? 1 : 0)); return ymd(d); }
    return '';
  }

  // ---------------------------------------------------------------- addresses / houses
  const WORDS = { street: 'st', str: 'st', avenue: 'ave', av: 'ave', road: 'rd', drive: 'dr', lane: 'ln', court: 'ct', boulevard: 'blvd', place: 'pl', circle: 'cir', parkway: 'pkwy', highway: 'hwy', terrace: 'ter', square: 'sq', trail: 'trl', north: 'n', south: 's', east: 'e', west: 'w', northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw', apartment: 'apt', suite: 'ste', building: 'bldg', floor: 'fl', room: 'rm', mount: 'mt', point: 'pt', crossing: 'xing', expressway: 'expy', freeway: 'fwy', center: 'ctr', heights: 'hts', junction: 'jct', mountain: 'mtn', ridge: 'rdg', valley: 'vly', view: 'vw', village: 'vlg' };
  // Houses are grouped on the street address ONLY - any apt / unit / suite / line 2 is ignored.
  function normStreet(addr1) {
    let s = splitUnit(addr1).street.toLowerCase();
    s = s.replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim();
    return s.split(' ').map(w => WORDS[w] || w).join(' ');
  }
  // ---- fuzzy house matching: bots "jig" addresses (3 random letters before/after, typos like "Suoth"),
  // so a house is identified by house number + ZIP, then the street compared loosely.
  const DIRS = { n: 1, s: 1, e: 1, w: 1, ne: 1, nw: 1, se: 1, sw: 1 };
  const SUFFIXES = { st: 1, ave: 1, rd: 1, dr: 1, ln: 1, ct: 1, blvd: 1, pl: 1, cir: 1, pkwy: 1, hwy: 1, ter: 1, sq: 1, trl: 1, way: 1, loop: 1, cv: 1, cove: 1, run: 1, row: 1, pass: 1, pike: 1, xing: 1, expy: 1, fwy: 1, aly: 1, bnd: 1, path: 1, walk: 1 };
  const FULL = Object.keys(WORDS).filter(w => w.length >= 4 && (DIRS[WORDS[w]] || SUFFIXES[WORDS[w]]));
  function dl(a, b) { // Damerau-Levenshtein (a swapped pair of letters counts as one typo)
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    const d = Array.from({ length: m + 1 }, (_, i) => [i].concat(Array(n).fill(0))); for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[m][n];
  }
  const KNOWN_TOK = t => !!(DIRS[t] || SUFFIXES[t]);
  // "Suoth" -> "s", "Stret" -> "st": a near-miss of a direction / street-type word becomes that word
  function fixTok(t) {
    if (WORDS[t]) return WORDS[t];
    if (t.length >= 4 && /^[a-z]+$/.test(t)) { for (const w of FULL) if (Math.abs(w.length - t.length) <= 1 && dl(w, t) <= 1) return WORDS[w]; }
    return t;
  }
  function houseSig(addr1, zip) {
    let raw = splitUnit(addr1).street.toLowerCase().replace(/[.,#()\[\]\-_/\\|*'"]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!raw) return null;
    let toks = raw.split(' ');
    // house number: the first token with digits; letters glued on ("xqz11662", "11662abc") are jig
    let i = toks.findIndex(t => /\d/.test(t));
    if (i < 0) return null;
    if (i > 2) i = -1; // a number far into the line is part of the street name, not the house number
    let num = '';
    if (i >= 0) { const m = toks[i].match(/^[a-z]{0,4}(\d+)([a-z]{0,4})$/); if (m) { num = m[1]; toks = toks.slice(i + 1); } }
    if (!num) return null;
    toks = toks.map(fixTok);
    // a trailing 2-4 letter token that isn't a street word is a jig ("11662 S 2670 W XQZ"), if a street remains
    if (toks.length > 1) { const last = toks[toks.length - 1]; if (/^[a-z]{2,4}$/.test(last) && !KNOWN_TOK(last)) { const rest = toks.slice(0, -1); if (rest.some(t => /\d/.test(t) || !KNOWN_TOK(t))) toks = rest; } }
    const nums = toks.filter(t => /\d/.test(t)).map(t => t.replace(/\D/g, ''));
    const core = toks.filter(t => !/\d/.test(t) && !KNOWN_TOK(t)).join('');
    const dirs = toks.filter(t => DIRS[t]).join('');
    return { num, zip: zip5(zip), nums: nums.join(','), core, dirs, key: num + '|' + zip5(zip) };
  }
  // Same house: same number, compatible ZIP, same street numbers (Utah grid "2670 W") and a close street name.
  function sameHouse(a, b) {
    if (!a || !b || a.num !== b.num) return false;
    if (a.zip && b.zip && a.zip !== b.zip) return false;
    if (a.nums !== b.nums && a.nums && b.nums) return false;
    if (a.core === b.core) return a.nums === b.nums || !a.nums || !b.nums || !!a.core;
    if (!a.core || !b.core) return !!(a.nums && a.nums === b.nums); // grid address with/without a stray word
    if (a.core.startsWith(b.core) || b.core.startsWith(a.core)) return Math.min(a.core.length, b.core.length) >= 4;
    const d = dl(a.core, b.core), L = Math.max(a.core.length, b.core.length);
    return d <= (L >= 10 ? 3 : L >= 6 ? 2 : 1);
  }
  // Street with jigs and unit removed, in the original letters, for showing on the Houses page.
  function cleanStreet(addr1) {
    const st = splitUnit(addr1).street.replace(/\s+/g, ' ').trim(); let toks = st.split(' ');
    const i = toks.findIndex(t => /\d/.test(t));
    if (i > 0 && i <= 2) toks = toks.slice(i);
    if (toks.length) toks[0] = toks[0].replace(/^[A-Za-z]{1,4}(?=\d)/, '').replace(/(\d)[A-Za-z]{2,4}$/, '$1');
    if (toks.length > 2) { const last = toks[toks.length - 1].toLowerCase().replace(/[^a-z]/g, ''); if (/^[a-z]{2,4}$/.test(last) && !KNOWN_TOK(fixTok(last))) toks = toks.slice(0, -1); }
    return toks.join(' ').replace(/[\s,\-]+$/, '');
  }
  const normUnit = a => String(a || '').toLowerCase().replace(/\b(apartment|apt|unit|suite|ste|#|room|rm|no|number|bldg|building|fl|floor|lot|trlr|spc|space)\b/g, '').replace(/[^a-z0-9]/g, '');
  const zip5 = z => String(z || '').slice(0, 5);
  const houseKey = (addr1, zip) => { const h = houseSig(addr1, zip); return h ? h.key + '|' + h.nums + '|' + h.core : ''; };
  const unitKey = (addr1, addr2, zip) => { const h = houseKey(addr1, zip); return h ? h + '|' + normUnit([splitUnit(addr1).unit, addr2].filter(Boolean).join(' ')) : ''; };

  // ---------------------------------------------------------------- main
  // Everything after these lines is store recommendations, not your order.
  const RECS = /^(up next, just for you|you might also like|check everything off your list|you may also like|recommended for you|customers (also|who) bought|more to explore|inspired by your|picked for you|explore everything|shop similar|related items|trending now|don.t miss today)/i;
  const cutRecs = t => { const ls = String(t || '').split('\n'); const i = ls.findIndex(l => RECS.test(l.trim())); return (i > 0 ? ls.slice(0, i) : ls).join('\n'); };
  function parseOrderEmail(m) {
    const subject = String(m.subject || '');
    const status = classifyStatus(subject);
    if (!status) return null;
    const imgs = [];
    const H = m.html ? htmlToText(m.html, imgs) : '';            // keeps ⟦img:N⟧ markers for item pictures
    const Hc = H.split('\n').filter(l => !IMG_MARK.test(l)).join('\n');
    const P = m.text ? cleanPlain(m.text) : '';
    let sources = [Hc, P].filter(x => x && x.length > 40);
    if (!sources.length) sources = [Hc || P || ''];
    const first = fn => { for (const s of sources) { const v = fn(s); if (v != null && v !== '' && (!Array.isArray(v) || v.length)) return v; } return null; };
    const orderNumber = (() => { for (const s of sources) { const v = extractOrderNumber(subject, s); if (v) return v; } return extractOrderNumber(subject, ''); })();
    const rawAddr = first(extractAddress);
    const addr = parseAddress(rawAddr || '');
    const short = rawAddr ? null : first(extractShortRecipient);
    if (short) Object.assign(addr, { name: short.name, city: short.city, state: short.state });
    const text = sources.join('\n');
    let items = H ? extractItems(cutRecs(H), imgs) : [];
    if (P) { const alt = extractItems(cutRecs(P), []); if (alt.length > items.length) items = alt; }
    // Amazon: 'Shipped 2 items: Party Supplies' / 'Ordered: "Name..." and 2 more items'
    if (!items.length) {
      const am = subject.match(/^(?:ordered|shipped|delivered|arriving|out for delivery|now arriving)\s*(\d+)?\s*(?:items?)?\s*:\s*"?([^"]{3,140}?)"?(?:\s+and\s+\d+\s+more\s+items?)?\s*$/i);
      if (am) items = [{ name: am[2].trim(), qty: +am[1] || 1, price: null, each: false, image: '' }];
    }
    const sub = first(extractSubtotal);
    return {
      status,
      store: detectStore(m.from, subject, text),
      orderNumber,
      subject,
      from: m.from || '',
      to: (m.to || [])[0] || '',
      date: m.date || new Date().toISOString(),
      messageId: m.messageId || '',
      name: addr.name || first(extractName) || '',
      address: addr,
      rawAddress: rawAddr || '',
      eta: (() => { for (const s of sources) { const v = extractEta(s, m.date); if (v) return v; } return ''; })(),
      etaEnd: (() => { for (const s of sources) { const e = extractEta(s, m.date); if (e) return extractEtaEnd(s, m.date, e); } return ''; })(),
      deliveredOn: status === 'delivered' ? first(s => extractDeliveredOn(s, m.date)) || '' : '',
      total: first(extractTotal) ?? first(extractPayment),
      totalKind: first(extractTotal) != null ? 'order' : first(extractPayment) != null ? 'payment' : '',
      tracking: (() => { for (const s of sources) { const v = extractTracking(s, orderNumber); if (v.length) return v; } return []; })(),
      last4: first(extractLast4) || '',
      items: settlePrices(items, sub),
      // "We had to cancel an item in your order" - only part of the order is cancelled
      partial: status === 'cancelled' && (/\b(an item|some items|one item|1 item|items? in your order|items? from your order|part of your order|an item from|some of your items)\b/i.test(subject) || /\b(rest of your order|remaining items?|other items? (?:in|from) your order)\b/i.test(text)),
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
  // True when the sender is a normal company domain that isn't one of the known stores (Uber, Apple, newsletters...).
  // Relay / personal addresses return false - those need the email body to tell which store sent them.
  function isNonStoreSender(from, subject) {
    const k = senderKey(from); if (!k || k.includes('@')) return false;
    return detectStore(from, subject, '') === 'other';
  }
  // Worth showing under "couldn't read": a known store's email whose subject is clearly about an order.
  function looksLikeOrderMail(subject, store) {
    return store !== 'other' && /\b(order|purchase|shipment|package|pickup|delivery)\b/i.test(String(subject || '')) && !!classifyStatus(subject);
  }
  const API = { extractEtaEnd, houseSig, sameHouse, cleanStreet, dl, extractPayment, extractDeliveredOn, extractShortRecipient, cleanPlain, settlePrices, extractSubtotal, productImage, STORES, storeInfo, SUBJECT_KEYWORDS, SUBJECT_PATTERNS, classifyStatus, htmlToText, decodeEntities, detectStore, extractOrderNumber, normOrderNo, extractTotal, extractItems, extractAddress, parseAddress, extractName, extractEta, detectCarrier, trackingUrl, extractTracking, extractLast4, normStreet, normUnit, splitUnit, senderKey, isNonStoreSender, looksLikeOrderMail, zip5, houseKey, unitKey, parseOrderEmail, isoFrom };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.Parser = API;
})(typeof window !== 'undefined' ? window : globalThis);

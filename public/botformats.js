/* Crown Tools - profile files for checkout bots: Valor, Hayha, Stellar, Shikari and AYCD.
   Each format can read a bot's export into Crown Tools profiles and write profiles back out in that bot's exact layout. */
'use strict';
const BotFormats = (() => {
  const STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia', PR: 'Puerto Rico' };
  const CODES = Object.fromEntries(Object.entries(STATES).map(([c, n]) => [n.toLowerCase(), c]));
  const code = s => { s = String(s || '').trim(); if (!s) return ''; return CODES[s.toLowerCase()] || (STATES[s.toUpperCase()] ? s.toUpperCase() : s); };
  const full = s => STATES[code(s)] || String(s || '');
  const COUNTRY_NAMES = { US: 'United States', CA: 'Canada', GB: 'United Kingdom', UK: 'United Kingdom' };
  const ccode = s => { s = String(s || '').trim(); if (!s) return 'US'; const hit = Object.entries(COUNTRY_NAMES).find(([, n]) => n.toLowerCase() === s.toLowerCase()); return hit ? hit[0] : /^(usa|united states of america)$/i.test(s) ? 'US' : s.toUpperCase(); };
  const cname = s => COUNTRY_NAMES[ccode(s)] || s;
  const digits = s => String(s || '').replace(/\D/g, '');
  const brand = n => { n = digits(n); if (/^4/.test(n)) return 'Visa'; if (/^(5[1-5]|2[2-7])/.test(n)) return 'Mastercard'; if (/^3[47]/.test(n)) return 'Amex'; if (/^(6011|65|64[4-9])/.test(n)) return 'Discover'; if (/^35/.test(n)) return 'JCB'; return ''; };
  const mm = m => { const d = digits(m); return d ? String(+d).padStart(2, '0') : ''; };
  const yyyy = y => { const d = digits(y); return !d ? '' : d.length <= 2 ? '20' + d.padStart(2, '0') : d; };
  const uuid = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  const splitName = n => { const p = String(n || '').trim().split(/\s+/); return { first: p.length > 1 ? p.slice(0, -1).join(' ') : p[0] || '', last: p.length > 1 ? p[p.length - 1] : '' }; };
  const dash = ph => { const d = digits(ph); return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d.length === 11 && d[0] === '1' ? `${d.slice(1, 4)}-${d.slice(4, 7)}-${d.slice(7)}` : String(ph || ''); };
  const group4 = n => { const d = digits(n); return /^3[47]/.test(d) && d.length === 15 ? `${d.slice(0, 4)} ${d.slice(4, 10)} ${d.slice(10)}` : d.replace(/(.{4})(?=.)/g, '$1 '); };
  const csvCell = v => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };

  // a Crown Tools profile with every field filled the same way, whatever the source
  function blank() { return { name: '', email: '', emailPassword: '', phone: '', shipFirst: '', shipLast: '', shipAddr1: '', shipAddr2: '', shipCity: '', shipState: '', shipZip: '', shipCountry: 'US', sameBilling: true, billFirst: '', billLast: '', billAddr1: '', billAddr2: '', billCity: '', billState: '', billZip: '', billCountry: 'US', cardName: '', cardNumber: '', cardExpMonth: '', cardExpYear: '', cardCvv: '', notes: '', oneCheckout: false }; }
  function finish(p) {
    p.phone = digits(p.phone); p.cardNumber = digits(p.cardNumber); p.cardExpMonth = mm(p.cardExpMonth); p.cardExpYear = yyyy(p.cardExpYear);
    p.shipState = code(p.shipState); p.billState = code(p.billState); p.shipCountry = ccode(p.shipCountry); p.billCountry = ccode(p.billCountry || p.shipCountry);
    if (!p.cardName) p.cardName = [p.shipFirst, p.shipLast].filter(Boolean).join(' ');
    // billing that repeats shipping is stored as "same as shipping"
    const same = ['First', 'Last', 'Addr1', 'Addr2', 'City', 'State', 'Zip'].every(k => String(p['bill' + k] || '').trim().toLowerCase() === String(p['ship' + k] || '').trim().toLowerCase());
    if (p.sameBilling || same || !p.billAddr1) { p.sameBilling = true; ['First', 'Last', 'Addr1', 'Addr2', 'City', 'State', 'Zip', 'Country'].forEach(k => p['bill' + k] = ''); }
    return p;
  }
  // what the exporters use: billing falls back to shipping when they're the same
  function view(p) {
    const s = !!p.sameBilling || !p.billAddr1; const b = k => s ? p['ship' + k] : p['bill' + k];
    return {
      name: p.name || '', email: p.email || '', emailPassword: p.emailPassword || '', phone: digits(p.phone), notes: p.notes || '', same: s, one: !!p.oneCheckout,
      ship: { first: p.shipFirst || '', last: p.shipLast || '', a1: p.shipAddr1 || '', a2: p.shipAddr2 || '', city: p.shipCity || '', state: code(p.shipState), zip: p.shipZip || '', country: ccode(p.shipCountry) },
      bill: { first: b('First') || '', last: b('Last') || '', a1: b('Addr1') || '', a2: b('Addr2') || '', city: b('City') || '', state: code(b('State')), zip: b('Zip') || '', country: ccode(b('Country') || p.shipCountry) },
      card: { name: p.cardName || [p.shipFirst, p.shipLast].filter(Boolean).join(' '), num: digits(p.cardNumber), mm: mm(p.cardExpMonth), yyyy: yyyy(p.cardExpYear), cvv: String(p.cardCvv || ''), brand: brand(p.cardNumber) },
    };
  }

  const FORMATS = [
    {
      id: 'valor', name: 'Valor', ext: '.valor.json', color: '#7c5cff', mark: 'V',
      detect: j => j && !Array.isArray(j) && typeof j === 'object' && Object.values(j).some(v => v && v.card && v.shipping && 'addressLine1' in v.shipping),
      read: j => Object.values(j).filter(v => v && v.card).map(v => {
        const p = blank(), s = v.shipping || {}, b = v.billing || {}, c = v.card || {}; const [em, ey] = String(c.expiration || '').split('/');
        Object.assign(p, { name: v.name, email: v.email, emailPassword: v.emailPassword || '', phone: v.phoneNumber, sameBilling: v.billingSameAsShipping !== false, oneCheckout: !!v.oneCheckout,
          shipFirst: s.firstName, shipLast: s.lastName, shipAddr1: s.addressLine1, shipAddr2: s.addressLine2, shipCity: s.city, shipState: s.state, shipZip: s.zipCode, shipCountry: s.countryCode || s.countryName,
          billFirst: b.firstName, billLast: b.lastName, billAddr1: b.addressLine1, billAddr2: b.addressLine2, billCity: b.city, billState: b.state, billZip: b.zipCode, billCountry: b.countryCode || b.countryName,
          cardName: c.holder, cardNumber: c.number, cardExpMonth: em, cardExpYear: ey, cardCvv: c.cvv });
        return finish(p);
      }),
      write: list => { const out = {}; list.map(view).forEach(v => {
        const a = x => ({ firstName: x.first, lastName: x.last, addressLine1: x.a1, addressLine2: x.a2, city: x.city, countryName: cname(x.country), countryCode: x.country, state: full(x.state), zipCode: x.zip });
        const id = uuid();
        out[id] = { name: v.name, email: v.email, emailPassword: v.emailPassword, phoneNumber: dash(v.phone), billingSameAsShipping: v.same, oneCheckout: v.one, quickTask: false,
          card: { holder: v.card.name, number: group4(v.card.num), expiration: `${v.card.mm}/${v.card.yyyy.slice(-2)}`, cvv: v.card.cvv, type: (v.card.brand || 'card').toLowerCase() },
          shipping: a(v.ship), billing: a(v.bill), id, totalSpent: 0 };
      }); return JSON.stringify(out, null, 2); },
    },
    {
      id: 'hayha', name: 'Hayha', ext: '.Hayha', color: '#ef5b5b', mark: 'H',
      detect: j => Array.isArray(j) && j.some(v => v && v.cardInfo && v.shipping),
      read: j => j.filter(v => v && v.cardInfo).map(v => {
        const p = blank(), s = v.shipping || {}, b = v.billing || {}, c = v.cardInfo || {}; const st = x => x && typeof x === 'object' ? (x.shortCode || x.name) : x;
        Object.assign(p, { name: v.name, email: s.email || b.email, phone: s.phone || b.phone, sameBilling: v.sameAsBilling !== false, oneCheckout: !!v.oneCheckout,
          shipFirst: s.firstName, shipLast: s.lastName, shipAddr1: s.address, shipAddr2: s.address2, shipCity: s.city, shipState: st(s.state), shipZip: s.zipCode, shipCountry: s.country,
          billFirst: b.firstName, billLast: b.lastName, billAddr1: b.address, billAddr2: b.address2, billCity: b.city, billState: st(b.state), billZip: b.zipCode, billCountry: b.country,
          cardName: c.holder, cardNumber: c.cardNumber, cardExpMonth: c.expMonth, cardExpYear: c.expYear, cardCvv: c.cvv });
        return finish(p);
      }),
      write: list => JSON.stringify(list.map(view).map(v => {
        const a = x => ({ firstName: x.first, lastName: x.last, email: v.email, phone: v.phone, address: x.a1, address2: x.a2, country: cname(x.country), state: { shortCode: x.state, name: full(x.state) }, city: x.city, zipCode: x.zip });
        return { name: v.name, shipping: a(v.ship), cardInfo: { cardNumber: v.card.num, holder: v.card.name, expMonth: v.card.mm, expYear: Number(v.card.yyyy) || v.card.yyyy, cvv: v.card.cvv }, oneCheckout: v.one, sameAsBilling: v.same, billing: a(v.bill), groupId: uuid(), id: uuid() };
      }), null, 2),
    },
    {
      id: 'stellar', name: 'Stellar', ext: '.stellar.json', color: '#4fb3ff', mark: 'S',
      detect: j => Array.isArray(j) && j.some(v => v && v.payment && v.shipping && 'profileName' in v),
      read: j => j.filter(v => v && v.payment).map(v => {
        const p = blank(), s = v.shipping || {}, b = v.billing || {}, c = v.payment || {};
        Object.assign(p, { name: v.profileName, email: v.email, phone: v.phone, sameBilling: v.billingAsShipping !== false, oneCheckout: !!v.oneCheckoutPerProfile,
          shipFirst: s.firstName, shipLast: s.lastName, shipAddr1: s.address, shipAddr2: s.address2, shipCity: s.city, shipState: s.state, shipZip: s.zipcode, shipCountry: s.country,
          billFirst: b.firstName, billLast: b.lastName, billAddr1: b.address, billAddr2: b.address2, billCity: b.city, billState: b.state, billZip: b.zipcode, billCountry: b.country,
          cardName: c.cardName, cardNumber: c.cardNumber, cardExpMonth: c.cardMonth, cardExpYear: c.cardYear, cardCvv: c.cardCvv });
        return finish(p);
      }),
      write: list => JSON.stringify(list.map(view).map(v => {
        const a = x => ({ firstName: x.first, lastName: x.last, country: x.country, address: x.a1, address2: x.a2, state: x.state, city: x.city, zipcode: x.zip });
        return { profileName: v.name, email: v.email, phone: v.phone, shipping: a(v.ship), billingAsShipping: v.same, oneCheckoutPerProfile: v.one, billing: a(v.bill),
          payment: { cardName: v.card.name, cardType: v.card.brand || 'Card', cardNumber: v.card.num, cardMonth: v.card.mm, cardYear: v.card.yyyy.slice(-2), cardCvv: v.card.cvv } };
      }), null, 2),
    },
    {
      id: 'shikari', name: 'Shikari', ext: '.shikari.csv', color: '#3ecf8e', mark: 'Sh', csv: true,
      HEAD: ['profile_name', 'first_name', 'last_name', 'email', 'email_password', 'phone_num', 'cc_number', 'cc_exp_month', 'cc_exp_year', 'cc_cvv', 'shipping_street', 'shipping_street_2', 'shipping_city', 'shipping_state', 'shipping_zip_code', 'shipping_country', 'billing_first_name', 'billing_last_name', 'billing_street', 'billing_street_2', 'billing_city', 'billing_state', 'billing_zip_code', 'billing_country'],
      detectCsv: head => ['profile_name', 'cc_number', 'shipping_street'].every(h => head.includes(h)),
      readRows: (head, rows) => rows.map(r => {
        const g = k => { const i = head.indexOf(k); return i < 0 ? '' : String(r[i] ?? '').trim(); }; const p = blank();
        const hasBill = !!g('billing_street');
        Object.assign(p, { name: g('profile_name'), email: g('email'), emailPassword: g('email_password'), phone: g('phone_num'),
          shipFirst: g('first_name'), shipLast: g('last_name'), shipAddr1: g('shipping_street'), shipAddr2: g('shipping_street_2'), shipCity: g('shipping_city'), shipState: g('shipping_state'), shipZip: g('shipping_zip_code'), shipCountry: g('shipping_country'),
          sameBilling: !hasBill, billFirst: g('billing_first_name'), billLast: g('billing_last_name'), billAddr1: g('billing_street'), billAddr2: g('billing_street_2'), billCity: g('billing_city'), billState: g('billing_state'), billZip: g('billing_zip_code'), billCountry: g('billing_country'),
          cardNumber: g('cc_number'), cardExpMonth: g('cc_exp_month'), cardExpYear: g('cc_exp_year'), cardCvv: g('cc_cvv') });
        return finish(p);
      }).filter(p => p.name || p.email || p.cardNumber),
      write(list) {
        const rows = list.map(view).map(v => [v.name, v.ship.first, v.ship.last, v.email, v.emailPassword, v.phone, v.card.num, v.card.mm ? String(+v.card.mm) : '', v.card.yyyy, v.card.cvv, v.ship.a1, v.ship.a2, v.ship.city, v.ship.state, v.ship.zip, v.ship.country,
          ...(v.same ? ['', '', '', '', '', '', '', ''] : [v.bill.first, v.bill.last, v.bill.a1, v.bill.a2, v.bill.city, v.bill.state, v.bill.zip, v.bill.country])]);
        return [this.HEAD, ...rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n';
      },
    },
    {
      id: 'aycd', name: 'AYCD', ext: '.aycd.json', color: '#f5a524', mark: 'A',
      detect: j => Array.isArray(j) && j.some(v => v && v.paymentDetails && (v.shippingAddress || v.billingAddress)),
      read: j => j.filter(v => v && v.paymentDetails).map(v => {
        const p = blank(), s = v.shippingAddress || {}, b = v.billingAddress || {}, c = v.paymentDetails || {}; const sn = splitName(s.name), bn = splitName(b.name);
        Object.assign(p, { name: v.name, notes: v.notes || '', email: s.email || b.email, phone: s.phone || b.phone, sameBilling: v.sameBillingAndShippingAddress !== false, oneCheckout: !!v.onlyCheckoutOnce,
          shipFirst: sn.first, shipLast: sn.last, shipAddr1: s.line1, shipAddr2: [s.line2, s.line3].filter(Boolean).join(' '), shipCity: s.city, shipState: s.state, shipZip: s.postCode, shipCountry: s.country,
          billFirst: bn.first, billLast: bn.last, billAddr1: b.line1, billAddr2: [b.line2, b.line3].filter(Boolean).join(' '), billCity: b.city, billState: b.state, billZip: b.postCode, billCountry: b.country,
          cardName: c.nameOnCard, cardNumber: c.cardNumber, cardExpMonth: c.cardExpMonth, cardExpYear: c.cardExpYear, cardCvv: c.cardCvv });
        return finish(p);
      }),
      write: list => JSON.stringify(list.map(view).map(v => {
        const a = x => ({ name: [x.first, x.last].filter(Boolean).join(' '), email: v.email, phone: v.phone, line1: x.a1, line2: x.a2, line3: '', postCode: x.zip, city: x.city, country: cname(x.country), state: full(x.state) });
        return { name: v.name, notes: v.notes, billingAddress: a(v.bill), shippingAddress: a(v.ship),
          paymentDetails: { nameOnCard: v.card.name, cardType: v.card.brand || 'Card', cardNumber: v.card.num, cardExpMonth: v.card.mm, cardExpYear: v.card.yyyy, cardCvv: v.card.cvv },
          sameBillingAndShippingAddress: v.same, onlyCheckoutOnce: v.one, matchNameOnCardAndAddress: false };
      }), null, 2),
    },
  ];
  const byId = Object.fromEntries(FORMATS.map(f => [f.id, f]));

  // Work out which bot a pasted/loaded file came from. Returns { format, profiles } or null.
  function read(text, parseCsv) {
    const t = String(text || '').replace(/^﻿/, '').trim(); if (!t) return null;
    if (/^[\[{]/.test(t)) {
      let j; try { j = JSON.parse(t); } catch (_) { return null; }
      for (const f of FORMATS) if (f.detect && f.detect(j)) return { format: f, profiles: f.read(j) };
      return null;
    }
    const rows = parseCsv(t); if (rows.length < 2) return null;
    const head = rows[0].map(h => String(h).trim().toLowerCase());
    for (const f of FORMATS) if (f.detectCsv && f.detectCsv(head)) return { format: f, profiles: f.readRows(head, rows.slice(1)) };
    return null;
  }
  return { FORMATS, byId, read, view, brand, full, code };
})();
if (typeof module !== 'undefined') module.exports = BotFormats;

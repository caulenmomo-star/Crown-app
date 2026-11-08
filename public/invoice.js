/* Kingpin - a shareable invoice. Everything on the page comes from the part of the link after the #, which
   browsers never send to a server, so nothing about the invoice is stored online. */
'use strict';
(function () {
  const el = document.getElementById('inv');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = v => '$' + (Math.round((Number(v) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const date = k => { if (!k) return ''; const d = new Date(String(k).length === 10 ? k + 'T12:00:00' : k); return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
  const safeUrl = u => /^https:\/\/[^\s"'<>]+$/.test(String(u || '')) ? u : '';
  let d = null;
  try { const raw = location.hash.slice(1).replace(/-/g, '+').replace(/_/g, '/'); d = JSON.parse(decodeURIComponent(escape(atob(raw)))); } catch (_) { }
  if (!d || !Array.isArray(d.lines)) { el.innerHTML = '<div class="sheet"><p>This invoice link is incomplete. Ask for the link again.</p></div>'; return; }
  const today = new Date().toISOString().slice(0, 10);
  const st = d.status === 'paid' ? 'paid' : d.status === 'void' ? 'void' : d.due && d.due < today ? 'overdue' : 'open';
  const P = d.pay || {}, tag = s => String(s || '').trim();
  const venmo = tag(P.venmo).replace(/^@/, ''), cash = tag(P.cashapp).replace(/^\$/, ''), pp = tag(P.paypal).replace(/^https?:\/\//, '').replace(/^(www\.)?paypal\.me\//i, '');
  const ways = [
    safeUrl(P.card) ? `<a class="way card" href="${esc(P.card)}" target="_blank" rel="noopener">💳 Pay ${money(d.total)} with card</a>` : '',
    venmo ? `<a class="way" href="https://venmo.com/u/${encodeURIComponent(venmo)}" target="_blank" rel="noopener">Venmo @${esc(venmo)}</a>` : '',
    cash ? `<a class="way" href="https://cash.app/$${encodeURIComponent(cash)}/${(Number(d.total) || 0).toFixed(2)}" target="_blank" rel="noopener">Cash App $${esc(cash)}</a>` : '',
    pp ? `<a class="way" href="https://paypal.me/${encodeURIComponent(pp)}/${(Number(d.total) || 0).toFixed(2)}" target="_blank" rel="noopener">PayPal ${esc(pp)}</a>` : '',
    tag(P.zelle) ? `<span class="way">Zelle ${esc(P.zelle)}</span>` : '',
  ].filter(Boolean);
  document.title = `${d.num ? 'Invoice ' + d.num : 'Invoice'}${d.biz ? ' · ' + d.biz : ''}`;
  el.innerHTML = `<div class="btns"><button type="button" id="pr">Print or save as PDF</button></div><div class="sheet">
    <div class="top"><div><div class="biz">${esc(d.biz || 'Invoice')}</div></div><div style="text-align:right"><div class="label">Invoice</div><div class="num">${esc(d.num || '')}</div><span class="status ${st}">${{ paid: 'Paid', void: 'Void', overdue: 'Overdue', open: 'Due' }[st]}</span></div></div>
    <div class="meta"><div><span class="label">Billed to</span><b>${esc(d.client || '')}</b></div><div><span class="label">Date</span><b>${esc(date(d.date))}</b></div><div><span class="label">${st === 'paid' ? 'Paid' : 'Due'}</span><b>${esc(st === 'paid' ? date(d.paidAt) || 'Yes' : date(d.due) || 'On receipt')}</b></div></div>
    <table><thead><tr><th>Description</th><th class="amt">Amount</th></tr></thead><tbody>${d.lines.map(l => `<tr><td>${esc(l[0])}</td><td class="amt">${money(l[1])}</td></tr>`).join('')}</tbody></table>
    ${d.disc ? `<div class="tot"><span>Discount</span><span>−${money(d.disc)}</span></div>` : ''}
    <div class="grand"><span class="label">Total${st === 'paid' ? '' : ' due'}</span><b>${money(d.total)}</b></div>
    ${d.notes ? `<p class="note">${esc(d.notes)}</p>` : ''}
    ${st === 'paid' ? '<div class="paidstamp">Paid — thank you!</div>' : st === 'void' ? '<div class="paidstamp" style="background:#eef0f4;color:#5d6574">This invoice was cancelled.</div>' : ways.length || P.note ? `<div class="pay"><h2>How to pay</h2>${ways.length ? `<div class="ways">${ways.join('')}</div>` : ''}${P.note ? `<p class="note">${esc(P.note)}</p>` : ''}${d.num ? `<p class="note">Please include <b>${esc(d.num)}</b> with your payment.</p>` : ''}</div>` : ''}
  </div><div class="foot">Made with Kingpin</div>`;
  document.getElementById('pr').onclick = () => window.print();
})();

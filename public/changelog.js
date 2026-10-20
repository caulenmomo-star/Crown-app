/* Crown - release notes. Crown is in prerelease, so versions stay at 0.x until it's finished. */
'use strict';
const CHANGELOG = [
  { v: '0.4.1', date: '2026-10-20', title: 'Second pass', items: [
    'Walmart “Shipped:”, “Arrived:” and “Canceled:” emails and Pokémon Center confirmations are now read correctly, all tested against your real emails.',
    'Orders whose emails have no street address (Amazon, PlayStation, cancellations) go into the house of the profile they’re linked to.',
    'Stores that send no pictures (Pokémon Center) borrow the picture from another order of the same product.',
    'Profile matching is about 18× faster with big lists, and details that don’t match now count against a profile.',
    'After an update, an old open Crown tab can no longer save over your data. It shows a Reload button instead.',
    'Editing an order keeps its item pictures and doesn’t lock the total unless you changed it.',
  ] },
  { v: '0.4.0', date: '2026-10-20', title: 'Real-email reader', items: [
    'Rebuilt the email reader against real Target, Walmart, Best Buy, Amazon, Pokémon Center and PlayStation Direct emails.',
    'Order totals now come through, including Target’s “Order total”, Walmart’s “Includes all fees” total, Amazon’s “20.39 USD” and Pokémon Center’s subtotal.',
    'Item pictures: each item shows its product photo in the order list, the order details and the house pages.',
    'Items are read from more layouts (Qty on the next line, Walmart picture labels, PlayStation tables), and prices are worked out per unit.',
    'Shipping addresses are read from more layouts (“UT, 84065”, unlabeled Walmart addresses, multi-line Best Buy and Pokémon Center), so houses link up.',
    'Smarter profile linking: it weighs email, street, unit, name, card and town together and links only to a clear match. Gmail dots and +tags count as the same inbox.',
    'Statuses follow real emails: “about to ship” and “arrives tomorrow” are Shipped, “arrive today” is the new Out for delivery status, and “Items have arrived” is Delivered with the real delivery day.',
    'Confirmation emails like “Thanks for shopping with us! Here’s your order #:…” and preorder payment emails are no longer skipped.',
    'Promo emails like “New Outerwear Has Arrived” are never read as orders.',
    'Existing orders are re-read once automatically after this update so they fill in.',
    'With an EasyPost key, packages are re-checked automatically after each sync.',
    'Versions now use 0.x numbers while Crown is in prerelease, and this changelog was added.',
  ] },
  { v: '0.3.0', date: '2026-10-19', title: 'Faster and cleaner', items: [
    'Much faster email reading. Promos, surveys and non-store emails are skipped before downloading.',
    'Houses group by street address only, ignoring apartment, unit and line 2.',
    'Duplicate and not-an-order cleanup, arrival date and delivered-status fixes.',
    'Data carries over between updates automatically, and multiple devices stay in sync.',
  ] },
  { v: '0.2.0', date: '2026-10-18', title: 'Order tracker and Crown Online', items: [
    'Order tracker with IMAP email reading, delivery tracking, houses, a spending card and profile linking.',
    'Crown Online runs on any device, including iPad, with end-to-end encryption.',
  ] },
  { v: '0.1.0', date: '2026-10-17', title: 'Profile manager', items: [
    'Checkout-bot profile manager with categories, mass import, individual and bulk edits, and a tap-to-pick address line 2 tool.',
  ] },
];
function renderChangelog() {
  $('#newsBody').innerHTML = CHANGELOG.map((r, i) => `<div class="card" style="padding:14px 16px;margin-bottom:10px${i ? '' : ';border-color:#5a4520'}">
    <div class="hstack"><b>v${esc(r.v)}</b><span class="muted">${esc(r.title)}</span><div class="spacer"></div><span class="small faint">${esc(r.date)}</span></div>
    <ul style="margin:8px 0 0 18px;padding:0">${r.items.map(t => `<li class="small" style="margin:4px 0">${esc(t)}</li>`).join('')}</ul></div>`).join('');
}
function openChangelog() { renderChangelog(); openDlg('dlgNews'); }
// show the notes once after an update
function maybeShowChangelog() {
  let seen = ''; try { seen = localStorage.getItem('crown.seenVersion') || ''; } catch (_) { }
  if (seen !== VERSION) { try { localStorage.setItem('crown.seenVersion', VERSION); } catch (_) { } if (seen) setTimeout(openChangelog, 1200); }
}

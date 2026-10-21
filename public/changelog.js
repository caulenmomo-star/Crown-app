/* Crown - release notes. Crown is in prerelease, so versions stay at 0.x until it's finished. */
'use strict';
const CHANGELOG = [
  { v: '0.4.6', date: '2026-10-20', title: 'Live UPS & FedEx dates, fresh re-read', items: [
    'New Carrier tracking in Settings: paste your free UPS and FedEx developer keys and Crown asks the carriers directly for every package. You get the real delivery date (like UPS’s “Tomorrow, Oct 21”), out for delivery, and delivered on the actual day. Packages are checked when you open Crown and after every sync.',
    'Fixed a time-zone bug that could put live-tracking dates one day early.',
    'Your order emails are re-read once more with the current reader. An earlier version had marked them as done, so they never got the fixes. This fills in totals, addresses, houses and statuses, and repairs numbers like “…539ARE”.',
    'The Dashboard has a day selector at the top (Today, 3–365 days, any number of days, or From–To dates). Spent, orders, items and stick rate follow it.',
    'Item pictures are bigger in the Orders list and order details.',
    'Order details show where the arrival date came from: the live carrier status or the shipping email.',
  ] },
  { v: '0.4.5', date: '2026-10-20', title: 'Real delivery dates only', items: [
    'An order only gets an arrival date once a shipping email (shipped with tracking, out for delivery, or ready for pickup) gives one. That’s the date the calendar, Dashboard and Orders list use.',
    'The date from the order confirmation is kept separately as “Original order said …”. Orders that haven’t shipped show “not shipped · est. …” instead of a fake arrival date.',
    'Existing orders are fixed automatically: arrival dates that came from confirmation emails become the original estimate.',
  ] },
  { v: '0.4.4', date: '2026-10-20', title: 'Smarter houses, delivery windows', items: [
    'Houses now look past address jigs and typos. “XQZ 11662 S 2670 W”, “11662 S 2670 W ABC”, “abc11662…”, “11662 Suoth 2670 Wset” and “11662 South 2670 West” are all one house. Crown matches the house number and ZIP, then compares the street loosely, while different house numbers, streets and ZIPs stay separate.',
    'Your existing houses are merged automatically when you open Crown. Nicknames and notes are kept, and each house shows the spelling most of its orders use.',
    'Profiles with jigged addresses still link to their orders.',
    'Delivery windows like “Arrives Thu, Sep 17 – Tue, Sep 22” are kept as a window, and each order shows which email its arrival date came from.',
  ] },
  { v: '0.4.3', date: '2026-10-20', title: 'Correct numbers, clear all, recap range', items: [
    'New “Clear all orders” button on the Orders page. You can undo it right away, or have Crown rebuild every order fresh from your email.',
    'Stick rate is now correct: only orders that shipped, are out for delivery, are ready or were delivered count as stuck. Placed and confirmed orders show as “pending” until they ship or get cancelled.',
    'Partial cancellations (“we had to cancel an item”) no longer cancel the whole order. Only those items are removed, and their share of the total comes off.',
    'Item quantities count correctly. A fully cancelled item counts as 0, not 1.',
    'A preorder payment or shipment charge no longer replaces the real order total.',
    'Spending shows money still pending and how many items were cancelled.',
    'The checkout recap card has its own date range: Today, Yesterday, 7 or 30 days, this month, last month, this year, all time, or any custom From–To dates. The Spending page also accepts custom dates.',
  ] },
  { v: '0.4.2', date: '2026-10-20', title: 'Re-read fix', items: [
    'Fixed: the one-time re-read after updating was skipped whenever a normal sync started first, so existing orders never got their pictures, totals or addresses. It now waits for the other sync and always runs.',
    'The re-read only counts as done when every inbox read without errors. Otherwise it tries again next time.',
    'New “Re-read all order emails” button on the Inboxes page, so you can refill everything whenever you want.',
    'Old orders whose numbers had words stuck on the end (like “…099ARE”) are repaired and merged back into the right order.',
    'When the re-read finishes, Crown tells you how many orders are in houses and how many have pictures.',
  ] },
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

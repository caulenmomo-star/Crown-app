/* Crown Tools - release notes. Crown Tools is in prerelease, so versions stay at 0.x until it's finished. */
'use strict';
const CHANGELOG = [
  { v: '0.9.7', date: '2026-10-22', title: 'Checkout card upgrades', items: [
    'Use your own photo as the Checkout card background, and save it as PNG or JPG.',
    'Top items now show a picture of each product.',
    'Added an estimated profit: what your items are worth at the TCGplayer median minus what you paid.',
  ] },
  { v: '0.9.6', date: '2026-10-22', title: 'Checkout card on the dashboard', items: [
    'The shareable Checkout card now sits at the top of the dashboard, with a cleaner, more compact layout.',
  ] },
  { v: '0.9.5', date: '2026-10-22', title: 'Cards & profile groups', items: [
    'Adding cards makes a matching profile group, and each card shows which profile it’s on.',
  ] },
  { v: '0.9.4', date: '2026-10-22', title: 'Discord checkouts & cancel reasons', items: [
    'Connect Discord to read your bots’ checkouts and link them to orders, profiles, houses and accounts.',
    'Cancelled orders now show why — quantity limit or item demand.',
    'Profile health now counts item-demand cancels separately and flags a line 2 that hit the quantity limit.',
  ] },
  { v: '0.9.3', date: '2026-10-22', title: 'Calendar & security', items: [
    'The calendar now groups each day’s orders by the house they’re going to.',
    'Auto-lock is on by default (15 minutes) and locks right away when you come back after being away.',
    'New passwords need at least 12 characters.',
  ] },
  { v: '0.9.2', date: '2026-10-22', title: 'Checkout card', items: [
    'The Checkout card now always shows at the top of the dashboard.',
  ] },
  { v: '0.9.1', date: '2026-10-22', title: 'Dashboard & prices', items: [
    'Added a Checkout card to the top of the dashboard — profiles, accounts and cards at a glance.',
    'Inventory now tracks the TCGplayer median price and refreshes it every 6 hours.',
  ] },
  { v: '0.9.0', date: '2026-10-21', title: 'Profiles, accounts, cards', items: [
    'Reworked the Profiles section: every profile now gets a health rating from its real order results, and the ones that keep getting cancelled can be fixed with a new address line 2 in one tap (nothing else on the profile changes).',
    'Added a profile builder — make hundreds of profiles for a house at once.',
    'Added saved addresses per profile group.',
    'Added Accounts — save every store login and password.',
    'Added Cards — save cards in groups, paste thousands at once, and spread a group across your profiles.',
    'Tidied the menu into sections (Checkout, Orders, Reselling) so there’s less to dig through on a phone.',
  ] },
  { v: '0.8.0', date: '2026-10-21', title: 'New look', items: [
    'New default look plus nine themes to pick from in Settings.',
    'Cleaner, roomier layout on computers.',
  ] },
  { v: '0.7.0', date: '2026-10-21', title: 'Inventory, prices, sales', items: [
    'Added Inventory with a barcode scanner and live TCGplayer prices.',
    'Added Sales with fees, expenses and profit.',
    'Added Discord delivery alerts and optional package check-in.',
    'More stores and carriers, plus free USPS tracking.',
  ] },
  { v: '0.6.0', date: '2026-10-21', title: 'Accounts and subscriptions', items: [
    'Crown Tools Online now has accounts: anyone can sign up with their email and a password, and each account’s data is kept separate and encrypted with that person’s own password.',
    'The sign-up screen shows the monthly price up front, and people tick a box to agree before their account is made. After signing up they confirm their email, then subscribe on a separate screen to get access.',
    'Subscriptions are paid monthly through Stripe. Customers can update their card or cancel from Settings → Account → Manage billing. If a payment fails, access continues for a short grace period.',
    'New separate admin website for the owner, protected by a password and authenticator codes: see revenue and sign-ups, find customers, give free access for any length of time, suspend accounts, change the price and trial, make discount codes, post an announcement, and review an activity log.',
    'The server checks every request: data, email sync and tracking only work for accounts that are paid or have free access.',
    'Forgot password, delete account, and draft Terms, Privacy and Refund pages.',
    'Stricter browser security rules for the app and admin site.',
  ] },
  { v: '0.5.4', date: '2026-10-21', title: 'Profiles in Valor, Hayha, Stellar, Shikari and AYCD files', items: [
    'Export: pick Valor, Hayha, Stellar, Shikari or AYCD and you get a file in that bot’s exact layout (.valor.json, .Hayha, .stellar.json, .shikari.csv, .aycd.json), ready to load into the bot. Your last choice is remembered.',
    'Import: load or paste a profile file from any of those bots and Crown Tools recognizes it automatically.',
    'Importing the same file again updates the profiles that are already there (same name in the category) instead of making copies.',
    'Profiles now keep the email password and the “one checkout per profile” setting that Valor and Shikari files carry.',
    'Exported files are named after the category, like “Target.valor.json”.',
  ] },
  { v: '0.5.3', date: '2026-10-21', title: 'Adding categories works on phones', items: [
    'Fixed: “+ New category” did nothing on iPhone. Phones (especially home-screen apps) can block the browser’s built-in pop-ups, so Crown Tools now uses its own box to type a name or confirm.',
    'Same fix for renaming and deleting categories, house nicknames, deleting orders and profiles, merging houses, removing inboxes, re-reading email and resetting a forgotten password.',
    'Buttons no longer stay highlighted after you tap them.',
  ] },
  { v: '0.5.2', date: '2026-10-21', title: 'Email is checked every time you open the app', items: [
    'Fixed: with automatic sync set to Off, new emails were never read on their own, so delivered and “arrives today” emails didn’t show and the calendar kept old dates. Crown Tools now checks your email every time you open it or come back to it.',
    'Automatic sync that was Off is switched to every 5 minutes. You can change it on the Inboxes page; “Only when I open it” replaces Off.',
    'Home shows a warning under Needs attention when email hasn’t been checked for more than 3 hours. Tap it to check now.',
  ] },
  { v: '0.5.1', date: '2026-10-21', title: 'Tell orders apart at a glance', items: [
    'Home: Upcoming deliveries and Recent activity now show each item’s picture, a name on up to two lines, the house it’s going to and the total.',
    'Short lists drop the “Pokémon Trading Card Game:” part every item shares, so you see “30th Celebration Elite Trainer Box” instead of a cut-off name. The full name is still in the order.',
    'Quantities over one show up front, like “2× Scarlet & Violet Booster Bundle”.',
    'The status on those Home lists is now just a colored dot: orange shipped, green delivered, red cancelled.',
  ] },
  { v: '0.5.0', date: '2026-10-21', title: 'Crown Tools: made for phones, Windows and Mac', items: [
    'New name: Crown is now Crown Tools, with a new app icon.',
    'Phones: a bottom tab bar (Home, Orders, Calendar, Houses, More) and a slim top bar with Sync and Lock.',
    'Phones: orders and profiles show as easy-to-tap cards with the picture, total, status, arrival date and house. Tap Select to pick several at once.',
    'Phones: every pop-up opens full screen, page buttons sit in one row you can swipe, and filters scroll sideways instead of piling up.',
    'Phones: the calendar shows a count for each day. Tap a day to see its orders underneath.',
    'Phones: add it to your home screen and it opens full screen like an app.',
    'Windows: double-click “Start Crown Tools.bat”. If Python is missing it offers to install it. Mac keeps “Start Crown Tools.command”.',
    'Windows: thin dark scrollbars, and saving waits a moment if antivirus is holding the data file.',
    'Charts are redrawn to fit when you rotate a phone or resize a window.',
  ] },
  { v: '0.4.8', date: '2026-10-21', title: 'House names: successful orders only', items: [
    'Each house’s Names used, Units / line 2 used and Profiles now count only successful orders (shipped or delivered) by default.',
    'A Successful orders / All orders switch above them shows everything, including cancelled and pending orders. Crown Tools remembers your choice.',
  ] },
  { v: '0.4.7', date: '2026-10-20', title: 'Checked against your real orders', items: [
    'Fixed: orders whose arrival date had been copied from the order confirmation by older versions kept that guess. Now only a shipping email, live carrier tracking or a date you typed counts as the arrival date. The rest show as “Original order said …”.',
    'Houses: misspelled unit words (“Suuite 635”, “Apartmnet 4”) and letter-only unit jigs (“Apt JAS”, “No. RCH”) are recognized, so those addresses join their main house instead of making new ones.',
    '“Couldn’t read” no longer lists emails that have since been read.',
    'Walmart’s “You might also like” section is no longer read as part of the order.',
  ] },
  { v: '0.4.6', date: '2026-10-20', title: 'Live UPS & FedEx dates, fresh re-read', items: [
    'New Carrier tracking in Settings: paste your free UPS and FedEx developer keys and Crown Tools asks the carriers directly for every package. You get the real delivery date (like UPS’s “Tomorrow, Oct 21”), out for delivery, and delivered on the actual day. Packages are checked when you open Crown Tools and after every sync.',
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
    'Houses now look past address jigs and typos. “XQZ 11662 S 2670 W”, “11662 S 2670 W ABC”, “abc11662…”, “11662 Suoth 2670 Wset” and “11662 South 2670 West” are all one house. Crown Tools matches the house number and ZIP, then compares the street loosely, while different house numbers, streets and ZIPs stay separate.',
    'Your existing houses are merged automatically when you open Crown Tools. Nicknames and notes are kept, and each house shows the spelling most of its orders use.',
    'Profiles with jigged addresses still link to their orders.',
    'Delivery windows like “Arrives Thu, Sep 17 – Tue, Sep 22” are kept as a window, and each order shows which email its arrival date came from.',
  ] },
  { v: '0.4.3', date: '2026-10-20', title: 'Correct numbers, clear all, recap range', items: [
    'New “Clear all orders” button on the Orders page. You can undo it right away, or have Crown Tools rebuild every order fresh from your email.',
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
    'When the re-read finishes, Crown Tools tells you how many orders are in houses and how many have pictures.',
  ] },
  { v: '0.4.1', date: '2026-10-20', title: 'Second pass', items: [
    'Walmart “Shipped:”, “Arrived:” and “Canceled:” emails and Pokémon Center confirmations are now read correctly, all tested against your real emails.',
    'Orders whose emails have no street address (Amazon, PlayStation, cancellations) go into the house of the profile they’re linked to.',
    'Stores that send no pictures (Pokémon Center) borrow the picture from another order of the same product.',
    'Profile matching is about 18× faster with big lists, and details that don’t match now count against a profile.',
    'After an update, an old open Crown Tools tab can no longer save over your data. It shows a Reload button instead.',
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
    'Versions now use 0.x numbers while Crown Tools is in prerelease, and this changelog was added.',
  ] },
  { v: '0.3.0', date: '2026-10-19', title: 'Faster and cleaner', items: [
    'Much faster email reading. Promos, surveys and non-store emails are skipped before downloading.',
    'Houses group by street address only, ignoring apartment, unit and line 2.',
    'Duplicate and not-an-order cleanup, arrival date and delivered-status fixes.',
    'Data carries over between updates automatically, and multiple devices stay in sync.',
  ] },
  { v: '0.2.0', date: '2026-10-18', title: 'Order tracker and Crown Tools Online', items: [
    'Order tracker with IMAP email reading, delivery tracking, houses, a spending card and profile linking.',
    'Crown Tools Online runs on any device, including iPad, with end-to-end encryption.',
  ] },
  { v: '0.1.0', date: '2026-10-17', title: 'Profile manager', items: [
    'Checkout-bot profile manager with categories, mass import, individual and bulk edits, and a tap-to-pick address line 2 tool.',
  ] },
];
function renderChangelog() {
  $('#newsBody').innerHTML = CHANGELOG.map((r, i) => `<div class="card" style="padding:14px 16px;margin-bottom:10px${i ? '' : ';border-color:var(--warnLine)'}">
    <div class="hstack"><b>v${esc(r.v)}</b><span class="muted">${esc(r.title)}</span><div class="spacer"></div><span class="small faint">${esc(r.date)}</span></div>
    <ul style="margin:8px 0 0 18px;padding:0">${r.items.map(t => `<li class="small" style="margin:4px 0">${esc(t)}</li>`).join('')}</ul></div>`).join('');
}
function openChangelog() { renderChangelog(); openDlg('dlgNews'); }
// show the notes once after an update
function maybeShowChangelog() {
  let seen = ''; try { seen = localStorage.getItem('crown.seenVersion') || ''; } catch (_) { }
  if (seen !== VERSION) { try { localStorage.setItem('crown.seenVersion', VERSION); } catch (_) { } if (seen) setTimeout(openChangelog, 1200); }
}

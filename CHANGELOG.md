# Crown Tools changelog

Crown Tools is in prerelease, so versions stay at 0.x until it’s finished.

## v0.5.4 — Profiles in Valor, Hayha, Stellar, Shikari and AYCD files (2026-10-21)

- Export: pick Valor, Hayha, Stellar, Shikari or AYCD and you get a file in that bot’s exact layout (.valor.json, .Hayha, .stellar.json, .shikari.csv, .aycd.json), ready to load into the bot. Your last choice is remembered.
- Import: load or paste a profile file from any of those bots and Crown Tools recognizes it automatically.
- Importing the same file again updates the profiles that are already there (same name in the category) instead of making copies.
- Profiles now keep the email password and the “one checkout per profile” setting that Valor and Shikari files carry.
- Exported files are named after the category, like “Target.valor.json”.

## v0.5.3 — Adding categories works on phones (2026-10-21)

- Fixed: “+ New category” did nothing on iPhone. Phones (especially home-screen apps) can block the browser’s built-in pop-ups, so Crown Tools now uses its own box to type a name or confirm.
- Same fix for renaming and deleting categories, house nicknames, deleting orders and profiles, merging houses, removing inboxes, re-reading email and resetting a forgotten password.
- Buttons no longer stay highlighted after you tap them.

## v0.5.2 — Email is checked every time you open the app (2026-10-21)

- Fixed: with automatic sync set to Off, new emails were never read on their own, so delivered and “arrives today” emails didn’t show and the calendar kept old dates. Crown Tools now checks your email every time you open it or come back to it.
- Automatic sync that was Off is switched to every 5 minutes. You can change it on the Inboxes page; “Only when I open it” replaces Off.
- Home shows a warning under Needs attention when email hasn’t been checked for more than 3 hours. Tap it to check now.

## v0.5.1 — Tell orders apart at a glance (2026-10-21)

- Home: Upcoming deliveries and Recent activity now show each item’s picture, a name on up to two lines, the house it’s going to and the total.
- Short lists drop the “Pokémon Trading Card Game:” part every item shares, so you see “30th Celebration Elite Trainer Box” instead of a cut-off name. The full name is still in the order.
- Quantities over one show up front, like “2× Scarlet & Violet Booster Bundle”.
- The status on those Home lists is now just a colored dot: orange shipped, green delivered, red cancelled.

## v0.5.0 — Crown Tools: made for phones, Windows and Mac (2026-10-21)

- New name: Crown is now Crown Tools, with a new app icon.
- Phones: a bottom tab bar (Home, Orders, Calendar, Houses, More) and a slim top bar with Sync and Lock.
- Phones: orders and profiles show as easy-to-tap cards with the picture, total, status, arrival date and house. Tap Select to pick several at once.
- Phones: every pop-up opens full screen, page buttons sit in one row you can swipe, and filters scroll sideways instead of piling up.
- Phones: the calendar shows a count for each day. Tap a day to see its orders underneath.
- Phones: add it to your home screen and it opens full screen like an app.
- Windows: double-click “Start Crown Tools.bat”. If Python is missing it offers to install it. Mac keeps “Start Crown Tools.command”.
- Windows: thin dark scrollbars, and saving waits a moment if antivirus is holding the data file.
- Charts are redrawn to fit when you rotate a phone or resize a window.

## v0.4.8 — House names: successful orders only (2026-10-21)

- Each house’s Names used, Units / line 2 used and Profiles now count only successful orders (shipped or delivered) by default.
- A Successful orders / All orders switch above them shows everything, including cancelled and pending orders. Crown Tools remembers your choice.

## v0.4.7 — Checked against your real orders (2026-10-20)

- Fixed: orders whose arrival date had been copied from the order confirmation by older versions kept that guess. Now only a shipping email, live carrier tracking or a date you typed counts as the arrival date. The rest show as “Original order said …”.
- Houses: misspelled unit words (“Suuite 635”, “Apartmnet 4”) and letter-only unit jigs (“Apt JAS”, “No. RCH”) are recognized, so those addresses join their main house instead of making new ones.
- “Couldn’t read” no longer lists emails that have since been read.
- Walmart’s “You might also like” section is no longer read as part of the order.

## v0.4.6 — Live UPS & FedEx dates, fresh re-read (2026-10-20)

- New Carrier tracking in Settings: paste your free UPS and FedEx developer keys and Crown Tools asks the carriers directly for every package. You get the real delivery date (like UPS’s “Tomorrow, Oct 21”), out for delivery, and delivered on the actual day. Packages are checked when you open Crown Tools and after every sync.
- Fixed a time-zone bug that could put live-tracking dates one day early.
- Your order emails are re-read once more with the current reader. An earlier version had marked them as done, so they never got the fixes. This fills in totals, addresses, houses and statuses, and repairs numbers like “…539ARE”.
- The Dashboard has a day selector at the top (Today, 3–365 days, any number of days, or From–To dates). Spent, orders, items and stick rate follow it.
- Item pictures are bigger in the Orders list and order details.
- Order details show where the arrival date came from: the live carrier status or the shipping email.

## v0.4.5 — Real delivery dates only (2026-10-20)

- An order only gets an arrival date once a shipping email (shipped with tracking, out for delivery, or ready for pickup) gives one. That’s the date the calendar, Dashboard and Orders list use.
- The date from the order confirmation is kept separately as “Original order said …”. Orders that haven’t shipped show “not shipped · est. …” instead of a fake arrival date.
- Existing orders are fixed automatically: arrival dates that came from confirmation emails become the original estimate.

## v0.4.4 — Smarter houses, delivery windows (2026-10-20)

- Houses now look past address jigs and typos. “XQZ 11662 S 2670 W”, “11662 S 2670 W ABC”, “abc11662…”, “11662 Suoth 2670 Wset” and “11662 South 2670 West” are all one house. Crown Tools matches the house number and ZIP, then compares the street loosely, while different house numbers, streets and ZIPs stay separate.
- Your existing houses are merged automatically when you open Crown Tools. Nicknames and notes are kept, and each house shows the spelling most of its orders use.
- Profiles with jigged addresses still link to their orders.
- Delivery windows like “Arrives Thu, Sep 17 – Tue, Sep 22” are kept as a window, and each order shows which email its arrival date came from.

## v0.4.3 — Correct numbers, clear all, recap range (2026-10-20)

- New “Clear all orders” button on the Orders page. You can undo it right away, or have Crown Tools rebuild every order fresh from your email.
- Stick rate is now correct: only orders that shipped, are out for delivery, are ready or were delivered count as stuck. Placed and confirmed orders show as “pending” until they ship or get cancelled.
- Partial cancellations (“we had to cancel an item”) no longer cancel the whole order. Only those items are removed, and their share of the total comes off.
- Item quantities count correctly. A fully cancelled item counts as 0, not 1.
- A preorder payment or shipment charge no longer replaces the real order total.
- Spending shows money still pending and how many items were cancelled.
- The checkout recap card has its own date range: Today, Yesterday, 7 or 30 days, this month, last month, this year, all time, or any custom From–To dates. The Spending page also accepts custom dates.

## v0.4.2 — Re-read fix (2026-10-20)

- Fixed: the one-time re-read after updating was skipped whenever a normal sync started first, so existing orders never got their pictures, totals or addresses. It now waits for the other sync and always runs.
- The re-read only counts as done when every inbox read without errors. Otherwise it tries again next time.
- New “Re-read all order emails” button on the Inboxes page, so you can refill everything whenever you want.
- Old orders whose numbers had words stuck on the end (like “…099ARE”) are repaired and merged back into the right order.
- When the re-read finishes, Crown Tools tells you how many orders are in houses and how many have pictures.

## v0.4.1 — Second pass (2026-10-20)

- Walmart “Shipped:”, “Arrived:” and “Canceled:” emails and Pokémon Center confirmations are now read correctly, all tested against your real emails.
- Orders whose emails have no street address (Amazon, PlayStation, cancellations) go into the house of the profile they’re linked to.
- Stores that send no pictures (Pokémon Center) borrow the picture from another order of the same product.
- Profile matching is about 18× faster with big lists, and details that don’t match now count against a profile.
- After an update, an old open Crown Tools tab can no longer save over your data. It shows a Reload button instead.
- Editing an order keeps its item pictures and doesn’t lock the total unless you changed it.

## v0.4.0 — Real-email reader (2026-10-20)

- Rebuilt the email reader against real Target, Walmart, Best Buy, Amazon, Pokémon Center and PlayStation Direct emails.
- Order totals now come through, including Target’s “Order total”, Walmart’s “Includes all fees” total, Amazon’s “20.39 USD” and Pokémon Center’s subtotal.
- Item pictures: each item shows its product photo in the order list, the order details and the house pages.
- Items are read from more layouts (Qty on the next line, Walmart picture labels, PlayStation tables), and prices are worked out per unit.
- Shipping addresses are read from more layouts (“UT, 84065”, unlabeled Walmart addresses, multi-line Best Buy and Pokémon Center), so houses link up.
- Smarter profile linking: it weighs email, street, unit, name, card and town together and links only to a clear match. Gmail dots and +tags count as the same inbox.
- Statuses follow real emails: “about to ship” and “arrives tomorrow” are Shipped, “arrive today” is the new Out for delivery status, and “Items have arrived” is Delivered with the real delivery day.
- Confirmation emails like “Thanks for shopping with us! Here’s your order #:…” and preorder payment emails are no longer skipped.
- Promo emails like “New Outerwear Has Arrived” are never read as orders.
- Existing orders are re-read once automatically after this update so they fill in.
- With an EasyPost key, packages are re-checked automatically after each sync.
- Versions now use 0.x numbers while Crown Tools is in prerelease, and this changelog was added.

## v0.3.0 — Faster and cleaner (2026-10-19)

- Much faster email reading. Promos, surveys and non-store emails are skipped before downloading.
- Houses group by street address only, ignoring apartment, unit and line 2.
- Duplicate and not-an-order cleanup, arrival date and delivered-status fixes.
- Data carries over between updates automatically, and multiple devices stay in sync.

## v0.2.0 — Order tracker and Crown Tools Online (2026-10-18)

- Order tracker with IMAP email reading, delivery tracking, houses, a spending card and profile linking.
- Crown Tools Online runs on any device, including iPad, with end-to-end encryption.

## v0.1.0 — Profile manager (2026-10-17)

- Checkout-bot profile manager with categories, mass import, individual and bulk edits, and a tap-to-pick address line 2 tool.

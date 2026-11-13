/* Kingpin - release notes. Kingpin is in prerelease, so versions stay at 0.x until it's finished. */
'use strict';
const CHANGELOG = [
  { v: '0.22.1', date: '2026-11-12', title: 'Full item names', items: [
    'Order popups show every item’s full name, wrapping onto more lines instead of cutting off.',
    'Order lists on phones show longer names and the full order number, with a lighter status label.',
  ] },
  { v: '0.22.0', date: '2026-11-12', title: 'Phone notifications, even when Kingpin is closed', items: [
    'Settings → Phone notifications: Kingpin Online checks your inboxes and packages every few minutes and sends alerts to your phone: new orders, shipped, out for delivery, delivered, cancellations and delays, grouped by house.',
    'A morning summary of today’s deliveries per house, at the hour you pick. Turn each kind on or off, and send a test.',
    'Off until you turn it on. Your inbox logins are kept encrypted for this, and turning it off erases them. On iPhone it works from the home-screen app.',
  ] },
  { v: '0.21.1', date: '2026-11-12', title: 'Mailbox: attachments, pictures and more', items: [
    'Attachments: Download any of them, Open PDFs, and View or Copy pictures. Big files come down in pieces, and only the one you pick.',
    'Pictures in an email stay hidden. “Pick pictures” lists each one so you can Load, Copy or Save just the ones you want. “Show all” shows them in the email.',
    'Opening an email now only downloads its text. The More… menu has Mark as unread, Copy the text, Save the email (.eml), Print and Move to another folder. Opening an email marks it read, like a mail app.',
  ] },
  { v: '0.21.0', date: '2026-11-12', title: 'Mailbox: find any email, clear out the clutter', items: [
    'New Email section with a Mailbox page that shows every email in your inbox, newest first. Search by the address it was sent to (each Hide My Email address), who sent it or the subject. “Search inside emails too” also searches the message text.',
    'Group them by Sent to (one row per Hide My Email address), From or Kinds. Kinds puts the same email together, like “Target · newsletters & promos” or “Target · Thanks for your order #…”, with how much space each takes.',
    'Tick a whole address, sender or kind, or shift-click a range, and delete them in one go. They go to the inbox’s trash (Deleted Messages on iCloud), so you can still get them back.',
    'Click an email to read it. Pictures stay hidden until you ask, so senders can’t tell you opened it. Filter by date (today, 7, 30 or 90 days, or your own dates) or unread only, and sort by any column.',
    'The list is kept on your device, encrypted, so it opens instantly and only loads new mail. Inboxes moved to the Email section too.',
  ] },
  { v: '0.20.15', date: '2026-11-11', title: 'Warning for third-party SKUs', items: [
    'SKU lists: when you add a Target SKU that’s sold by another seller (a Target Plus partner or other third party), Kingpin warns you right away, says who sells it, and offers to remove it.',
    'Third-party SKUs are tagged “⚠ 3rd party” with the seller’s name. A bar above the list lets you show just those or remove them all.',
    'SKUs already in your lists are checked too, in the background.',
  ] },
  { v: '0.20.14', date: '2026-11-11', title: 'Stick rate right after a drop, est. profit for pending orders', items: [
    'Stick rate is now checkouts that weren’t cancelled out of all checkouts. Orders that haven’t shipped yet (including pre-orders) count until they’re cancelled, so a fresh drop shows its real rate instead of 0%.',
    'Est. profit shows for orders that haven’t shipped yet, marked “if they ship”, when nothing in the range has shipped.',
    'Picking a range on the dashboard sets the checkout card to the same range.',
  ] },
  { v: '0.20.13', date: '2026-11-10', title: 'Fix profile names ending in a store', items: [
    'Profiles named like “abc.def_Target” get their name back without the store. Copies of profiles you already have are removed, and their orders and store logins move to the profile you keep.',
    'Kingpin offers this once when it finds such names. It’s also in Settings → Data tools → Fix profile names, and Undo works right after.',
    'Adding a computer’s data to your account no longer adds a second copy of a profile just because its name is different.',
  ] },
  { v: '0.20.12', date: '2026-11-10', title: 'Email list finds accounts from profile names', items: [
    'Email list “Store accounts” also counts profiles named for a store, like “Target Account #18”, “abc.def_Target” or “PKC 3”, so emails you only have on bot profiles show their store too. These show with a dashed outline, meaning there’s no saved login for them under Store logins. The store filters and Copy use them too.',
    'Emails match even with different capitals, stray spaces or invisible characters from copying.',
  ] },
  { v: '0.20.11', date: '2026-11-10', title: 'Accounts know their profile, email list shows stores', items: [
    'Store logins show their profile automatically: the profile with the same email, or one named after the address. Profiles you add later are picked up too. A profile you chose yourself still wins.',
    'Email list: a “Store accounts” column shows every store each address has a login on. Filter by “No store account yet”, “On Target”, “Not on Walmart” and so on, and sort by fewest or most stores.',
    'One tap copies the emails you’re looking at, one per line, ready to paste into a generator.',
  ] },
  { v: '0.20.10', date: '2026-11-10', title: 'Mac and Windows apps stay in sync with your account', items: [
    'The Mac and Windows apps can link to your Kingpin Online account, so your computer, your phone and anyone you share the account with see the same data. The new download asks once when it opens. You can switch anytime in Settings.',
    'When you link, Kingpin offers to add the data already on that computer to your account. Anything you already have there (same card, profile, order, inbox or group) isn’t added twice.',
    'Settings → Backups: “Add from a backup…” adds what’s new from a backup file without replacing anything.',
  ] },
  { v: '0.20.9', date: '2026-11-10', title: 'Stats per inbox works with Hide My Email', items: [
    'Dashboard “Stats for” now places every order under the inbox it came into, including iCloud Hide My Email and other made-up addresses. iCloud addresses count toward your iCloud inbox, Gmail addresses toward Gmail, and your own domains toward whichever inbox their orders come into.',
    'Phone: the date range is one dropdown with “Custom…” in it, and the custom dates only show when you pick it.',
  ] },
  { v: '0.20.8', date: '2026-11-09', title: 'Fix: Mac/Windows app saving after updating itself', items: [
    'After the Mac and Windows apps updated themselves, saving to disk stopped (“Not saved to disk”). Fixed. Anything you did meanwhile was kept on this computer and is saved to disk again the next time Kingpin opens.',
    'The apps also check the website for updates every couple of hours while open.',
  ] },
  { v: '0.20.7', date: '2026-11-09', title: 'Stats per inbox, cancelled orders out of the way', items: [
    'Dashboard: “Stats for” lets you pick All inboxes, one inbox or several at once (plus orders added by hand). Totals, charts, activity and the checkout card all follow it, and it’s remembered on every device.',
    'Each order now remembers which inbox its emails came to. Older orders are matched up automatically the next time Kingpin opens.',
    'Cancelled orders are hidden from the All tab on Orders and from the dashboard’s Recent activity. Untick “Hide cancelled” to see them again; the Cancelled tab always lists them.',
  ] },
  { v: '0.20.6', date: '2026-11-09', title: 'Pick which stores each inbox syncs', items: [
    'When you add an inbox, choose the stores it reads. Its first sync and every automatic sync only read emails from those stores.',
    '“Sync now” asks which stores to sync each time, starting from that inbox’s saved stores. Tick “Also use these for automatic syncs” to change what’s saved.',
    'A store left out of a sync is caught up the next time it’s included, so nothing is missed. Emails from other stores aren’t downloaded at all.',
    'Menards orders are read properly now: order number (MCOM…), items with quantity and price, delivery address, and status updates like “On the way”.',
  ] },
  { v: '0.20.5', date: '2026-11-08', title: 'Two-step sign-in, slimmer orders on phones', items: [
    'Kingpin Online: turn on two-step sign-in in Settings → Security. Each new phone or computer then needs a 6-digit code from an authenticator app, once.',
    'Recovery codes in case you lose your phone. You can see your signed-in devices, remove one, or sign out all the others.',
    'Orders on a phone are now slim rows: picture, name, store and date, a progress bar, price and status. About twice as many fit on the screen.',
    'The Windows app opens in about a second, and the downloads are much smaller.',
  ] },
  { v: '0.20.4', date: '2026-11-08', title: 'The Mac and Windows apps update themselves', items: [
    'Kingpin for Mac and Windows downloads new versions in the background and checks every file before using it.',
    'On the lock screen it switches right away. While you’re working it offers “Restart now” (it saves first), or uses the new version next time it opens.',
    'Settings → Updates shows your version and has Check now. Rarely, a version needs a new download from the website, and Kingpin will say so.',
  ] },
  { v: '0.20.3', date: '2026-11-08', title: 'Edit many at once, multi-item sales, email list', items: [
    'Edit selected on Profiles, Accounts, Cards and Orders (selection bar or right-click). Every field starts as “Keep as is”. Only fields you change are saved; use Clear to empty a field.',
    'Sales: one sale can hold several items, each at its own price. “＋ at another price” sells another of the same item for a different amount.',
    'Sales export: one row per item, one row per sale, or expenses. Import from a paste, CSV or .xlsx. Kingpin works out the columns, groups rows into sales, matches your inventory and shows a preview first.',
    'Accounts → Email list: keep iCloud Hide My Email, Outlook and other addresses in groups, see which are used, and build profiles from a group’s unused ones.',
  ] },
  { v: '0.20.2', date: '2026-11-08', title: 'Profile builder: right count, mixed card groups', items: [
    '“How many” is now the total. Plain profiles (no jig) are part of it, not added on top, and the builder shows the split: plain vs with jigs.',
    'Cards: tick as many card groups as you want, and open any group to pick exactly which cards to use. Shift-click picks a range, and “Only ones not on a profile” skips used cards.',
    'With more than one group you choose: alternate between groups, or one group after another. It shows how many profiles your cards cover.',
    'If an address runs out of unused line 2s (for example 1 digit), the builder says so. It never makes duplicate addresses quietly.',
  ] },
  { v: '0.20.1', date: '2026-11-08', title: 'Drops only, and made for phones', items: [
    'Pokémon products now shows only what Target drops online: Target’s own listings of ETBs, bundles, displays, blisters, collection and premium boxes and tins from the last two years. Single packs, decks, accessories and other sellers are gone. “Everything on Target” still shows the full list.',
    'Suggestions and news matches use the drops list too.',
    'Phones: nothing scrolls sideways any more. Rows of filters are a dropdown, extra buttons are under “More”, and the page tabs fit on screen.',
    'Phones: SKU lists are tidy rows. Tap one for its price, value, quantity, link, Edit and Remove.',
  ] },
  { v: '0.20.0', date: '2026-11-08', title: 'Kingpin: News and every Pokémon SKU', items: [
    'Crown Tools is now Kingpin, with a new icon and a cleaner dark background. Your data, sign-in and settings are unchanged.',
    'New News page under Dashboard. Pokémon news from public news sites is sorted into Drops, Raffles, Changes, Restocks and News, and grouped by day.',
    'Click a headline to read it, see the products it mentions with their SKUs, add them to a SKU list in one click, save it, or set a reminder.',
    'News checks on its own 1, 2, 4, 6 or 12 times a day (you choose), or when you hit Refresh. You can switch sites off or add your own.',
    'SKU lists now has a Pokémon products tab: every Pokémon trading-card product on Target with its TCIN. Group it by set, type or when it showed up, filter it, and copy or add SKUs in one click.',
    'Target SKU lists suggest new SKUs: new on Target, in the news, or from the newest set.',
  ] },
  { v: '0.19.0', date: '2026-11-08', title: 'Right-click menus, lists keep their place', items: [
    'Right-click a profile, account, card or order to open it, move it to another group, set its status, copy it, duplicate it or delete it. If it’s part of your selection, the action applies to everything selected.',
    'Arrow keys, Enter and Esc work in these menus. Text boxes and links still get the normal copy/paste menu.',
    'Clicking or shift-clicking in a long list no longer jumps you to the top. The row you clicked stays exactly where it was.',
    'Your browser or password manager no longer fills your login email into the search boxes. If one still does, it’s cleared right away. An email you type yourself is kept.',
  ] },
  { v: '0.18.4', date: '2026-11-07', title: 'Builder: all accounts and custom line 2', items: [
    'Saved accounts: switch between “Unused only” and “All accounts”. All accounts can reuse ones already on a profile, and their existing link stays as it is.',
    'Line 2 “Custom mix”: tick exactly which styles to use (Apt, Unit, Suite, Ste, #, Bldg, Room, Lot, Fl, number only).',
  ] },
  { v: '0.18.3', date: '2026-11-07', title: 'Profile builder: emails, line 2 and names', items: [
    'Saved accounts now lists your account groups. Pick one, or use all of them.',
    'New “Paste emails” option: paste a list (email:password lines work too) and each profile gets the next one.',
    'Line 2 dropdown: Smart, Apt, Unit, Suite, Ste, #, Bldg, Room, Lot, Fl, a mix, number only or empty. You can also choose how many digits and add a letter.',
    'Optional plain profiles: the address exactly as is with no jig, one or more per address.',
    'Names count up from 1, like PKC Amex 1, PKC Amex 2, and carry on from the last one. You can also set where they start.',
  ] },
  { v: '0.18.2', date: '2026-11-07', title: 'Select lots at once', items: [
    'Shift-click a checkbox or a row to select everything between it and the last one you clicked. This works on Profiles, Accounts, Cards, Orders and the lists in windows.',
    'Cmd/Ctrl-click a row to select it without opening it. Cmd/Ctrl+A selects everything shown, and Esc clears the selection.',
    'Selected profiles: Edit fields and Export are right in the selection bar.',
    'Selected cards: Copy them, or put just those cards on profiles.',
  ] },
  { v: '0.18.1', date: '2026-11-06', title: 'Card photos you can trust', items: [
    '“2 pictures per card” now always pairs pictures 1+2, 3+4 and so on, with either side first in each pair.',
    'A card number is only trusted when separate readings of the photo agree. Otherwise Kingpin asks you to check it against the photo first.',
    'Tap a picture to see it full size, and remove a stray picture so the rest pair up again.',
    'An extra digits-only reading makes card numbers more accurate.',
  ] },
  { v: '0.18.0', date: '2026-11-06', title: 'Front and back card photos', items: [
    '“2 pictures per card” for cards like an Amex: the name and CID come from the front, the number and expiry from the back. 10 pictures make 5 cards.',
    'Kingpin works out which picture is which side. If one is missing, only that card is flagged; the cards after it stay paired correctly.',
    '“Same name on every card” fills in one name for the whole batch.',
    'Reads photos more reliably: coloured cards, dark cards, glare and the black stripe on the back.',
  ] },
  { v: '0.17.1', date: '2026-11-06', title: 'Invite-only sign-up', items: [
    'While payments are off, sign-up says Kingpin is invite-only and free, with no price shown.',
    'New accounts see a “waiting for access” screen. Once the owner lets them in, “Check again” opens the app.',
  ] },
  { v: '0.17.0', date: '2026-11-06', title: 'Cards from photos', items: [
    'Add cards from photos or screenshots: Cards → From photos. Kingpin reads the number, expiry, Amex CID and name, and you check each card before adding it.',
    'The pictures are read on your device and never uploaded or saved.',
    'Bad numbers, cards already saved and cards picked twice are flagged. Missing expiries or Amex CIDs have to be filled in before adding.',
  ] },
  { v: '0.16.1', date: '2026-11-06', title: 'Missing profile cards', items: [
    'A card group made from a profile group now lists every card on its profiles. Cards also saved in another group are marked “Also in” with that group’s name.',
    'It also says which profiles have a card number with a typo, and you can move the other group’s cards into it with one tap.',
  ] },
  { v: '0.16.0', date: '2026-11-06', title: 'SKU lists', items: [
    'New SKU lists under Checkout. Save the SKUs you run in your bots, paste them in as numbers or product links, and copy them out one per line or comma separated.',
    'Each SKU shows its product name and picture, with the price from the store, from what you paid in your orders, or what you type in. Trading-card products show their TCGplayer value too.',
    'The cards on your profiles are added to Cards automatically, in a group named after each profile group.',
    'Packages with no news for two weeks move to “Old — probably delivered”. Mark them all delivered at once, mark one delivered, or hide it.',
  ] },
  { v: '0.15.0', date: '2026-11-01', title: '17TRACK tracking', items: [
    'Track any UPS, FedEx, USPS, OnTrac, LaserShip or DHL package with a 17TRACK key, including packages shipped to you. No carrier account needed.',
    'New packages are added to 17TRACK automatically and checked together. Each package counts once against your 17TRACK plan.',
    'Settings shows how many packages your 17TRACK plan has left and warns you when it’s running low.',
  ] },
  { v: '0.14.0', date: '2026-11-01', title: 'Packages', items: [
    'New Packages page: every package on your orders with a progress bar, the arrival date and delivery window, and the latest scan.',
    'Open any package to see every scan, plus the service, weight, where it shipped from and where it was left.',
    '“Needs a look” finds delivery problems, arrival dates that moved later, packages past their date and ones with no new scans for 4 days, with a notification.',
    'Packages are checked more often once they’re close: every 30 minutes when out for delivery.',
    'When USPS says there have been too many checks, Kingpin waits and tries again later instead of failing.',
  ] },
  { v: '0.13.1', date: '2026-11-01', title: 'Pre-orders: card not updated', items: [
    'Pre-orders cancelled for item demand or a quantity limit no longer show on the Pre-orders page.',
    'New “Cancelled — card not updated” group for pre-orders the store cancelled because the card wasn’t changed in time, with how many happened today.',
    'Those cancels are labeled “card not updated” everywhere and don’t count against a profile.',
    'Notifications now catch changes that happened while Kingpin was closed.',
  ] },
  { v: '0.13.0', date: '2026-10-31', title: 'ACO, notifications and StockX', items: [
    'New ACO section: clients, their bot profiles, every checkout on them with the time, item and fee, and invoices.',
    'Client checkouts from your bot never become your own orders. Unknown profiles wait for you to say whose they are.',
    'Invoices: a link your client can open, a message to copy, email, and card payments through your own Stripe that mark it paid on their own.',
    'Notifications: a bell with new orders, shipments, deliveries, cancellations, pre-order card problems, client checkouts and overdue invoices, plus pop-ups on this device.',
    'StockX prices for LEGO, consoles, sneakers and other collectibles, and you can type a price yourself for anything.',
    'Fixed: plurals like “addresses” and “inboxes”.',
  ] },
  { v: '0.12.4', date: '2026-10-31', title: 'Cleaner calendar', items: [
    'The calendar no longer lists cancelled orders under Ordered or counts them in a day’s spending.',
  ] },
  { v: '0.12.3', date: '2026-10-31', title: 'Fix-by dates', items: [
    'Target’s “Please update your payment soon” email puts the order under Needs updating, with the declined card.',
    'Each one shows the date Target will auto-cancel it, sorted soonest first, with a warning when it’s due by tomorrow.',
  ] },
  { v: '0.12.2', date: '2026-10-31', title: 'Target payment updates', items: [
    'Target’s “Success! Your payment method was updated” email marks the pre-order Updated, with the new card’s last 4.',
  ] },
  { v: '0.12.1', date: '2026-10-31', title: 'Simpler dashboard and pre-orders', items: [
    'One summary card on the dashboard, now with estimated profit; Share turns it into a picture.',
    'On phones, profile categories and card / account groups fold into one dropdown.',
    'Pre-orders now show three things: needs updating, updated, or went through.',
    'Reads many more wordings of “update your payment” emails, and orders that haven’t shipped after 10 days count as pre-orders.',
    'Payment emails now join the original pre-order instead of showing up as new orders, and its history reads “charge failed”, “payment updated”.',
  ] },
  { v: '0.12.0', date: '2026-10-31', title: 'Pre-orders', items: [
    'New Pre-orders page: see which pre-orders had a declined card and which ones you’ve already updated.',
    'Reads the store’s card-declined and payment-successful emails, plus release dates.',
    'Tap “I updated the card” after fixing one; it turns Paid when the store charges it.',
    'Pre-orders are labeled in your orders, and the dashboard tells you when a card needs updating.',
  ] },
  { v: '0.11.0', date: '2026-10-26', title: 'Friendlier look', items: [
    'New 3D background and big summary cards on Dashboard, Orders and Inventory.',
    'Orders can show as picture cards with a progress bar and when they arrive.',
    'Inventory shows picture cards with paid, worth and gain, plus quick + / − and Sell.',
    'Account groups.',
    'Profile health: only item-demand cancels count; pending orders count as went through.',
    'Estimated profit counts only shipped and delivered orders, at the lower TCGplayer price.',
    'Fixed: typing in search boxes no longer closes the phone keyboard; pages no longer slide sideways; the calendar stays up to date.',
  ] },
  { v: '0.10.1', date: '2026-10-22', title: 'Resizable columns', items: [
    'Drag the edge of a column header to resize it in Profiles, Orders, Accounts and Cards — double-click to reset.',
    'Tables scroll sideways inside their own box, so the columns on the right are always reachable.',
  ] },
  { v: '0.10.0', date: '2026-10-22', title: 'Kingpin app', items: [
    'Install Kingpin as an app on iPhone, iPad, Mac and PC — its own icon and window, same account everywhere.',
    'Added a Get the app card in Settings and an install page with steps for each device.',
  ] },
  { v: '0.9.10', date: '2026-10-22', title: 'Simpler profit', items: [
    'The profit on the Checkout card now shows just the number.',
  ] },
  { v: '0.9.9', date: '2026-10-22', title: 'Clearer profit', items: [
    'The Checkout card now shows how profit is worked out: TCGplayer value minus what you paid.',
    'Review prices shows the profit on each product, biggest first.',
  ] },
  { v: '0.9.8', date: '2026-10-22', title: 'Cleaner Checkout card', items: [
    'Simplified the Checkout card.',
  ] },
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
    'Kingpin Online now has accounts: anyone can sign up with their email and a password, and each account’s data is kept separate and encrypted with that person’s own password.',
    'The sign-up screen shows the monthly price up front, and people tick a box to agree before their account is made. After signing up they confirm their email, then subscribe on a separate screen to get access.',
    'Subscriptions are paid monthly through Stripe. Customers can update their card or cancel from Settings → Account → Manage billing. If a payment fails, access continues for a short grace period.',
    'New separate admin website for the owner, protected by a password and authenticator codes: see revenue and sign-ups, find customers, give free access for any length of time, suspend accounts, change the price and trial, make discount codes, post an announcement, and review an activity log.',
    'The server checks every request: data, email sync and tracking only work for accounts that are paid or have free access.',
    'Forgot password, delete account, and draft Terms, Privacy and Refund pages.',
    'Stricter browser security rules for the app and admin site.',
  ] },
  { v: '0.5.4', date: '2026-10-21', title: 'Profiles in Valor, Hayha, Stellar, Shikari and AYCD files', items: [
    'Export: pick Valor, Hayha, Stellar, Shikari or AYCD and you get a file in that bot’s exact layout (.valor.json, .Hayha, .stellar.json, .shikari.csv, .aycd.json), ready to load into the bot. Your last choice is remembered.',
    'Import: load or paste a profile file from any of those bots and Kingpin recognizes it automatically.',
    'Importing the same file again updates the profiles that are already there (same name in the category) instead of making copies.',
    'Profiles now keep the email password and the “one checkout per profile” setting that Valor and Shikari files carry.',
    'Exported files are named after the category, like “Target.valor.json”.',
  ] },
  { v: '0.5.3', date: '2026-10-21', title: 'Adding categories works on phones', items: [
    'Fixed: “+ New category” did nothing on iPhone. Phones (especially home-screen apps) can block the browser’s built-in pop-ups, so Kingpin now uses its own box to type a name or confirm.',
    'Same fix for renaming and deleting categories, house nicknames, deleting orders and profiles, merging houses, removing inboxes, re-reading email and resetting a forgotten password.',
    'Buttons no longer stay highlighted after you tap them.',
  ] },
  { v: '0.5.2', date: '2026-10-21', title: 'Email is checked every time you open the app', items: [
    'Fixed: with automatic sync set to Off, new emails were never read on their own, so delivered and “arrives today” emails didn’t show and the calendar kept old dates. Kingpin now checks your email every time you open it or come back to it.',
    'Automatic sync that was Off is switched to every 5 minutes. You can change it on the Inboxes page; “Only when I open it” replaces Off.',
    'Home shows a warning under Needs attention when email hasn’t been checked for more than 3 hours. Tap it to check now.',
  ] },
  { v: '0.5.1', date: '2026-10-21', title: 'Tell orders apart at a glance', items: [
    'Home: Upcoming deliveries and Recent activity now show each item’s picture, a name on up to two lines, the house it’s going to and the total.',
    'Short lists drop the “Pokémon Trading Card Game:” part every item shares, so you see “30th Celebration Elite Trainer Box” instead of a cut-off name. The full name is still in the order.',
    'Quantities over one show up front, like “2× Scarlet & Violet Booster Bundle”.',
    'The status on those Home lists is now just a colored dot: orange shipped, green delivered, red cancelled.',
  ] },
  { v: '0.5.0', date: '2026-10-21', title: 'Kingpin: made for phones, Windows and Mac', items: [
    'New name: Crown is now Kingpin, with a new app icon.',
    'Phones: a bottom tab bar (Home, Orders, Calendar, Houses, More) and a slim top bar with Sync and Lock.',
    'Phones: orders and profiles show as easy-to-tap cards with the picture, total, status, arrival date and house. Tap Select to pick several at once.',
    'Phones: every pop-up opens full screen, page buttons sit in one row you can swipe, and filters scroll sideways instead of piling up.',
    'Phones: the calendar shows a count for each day. Tap a day to see its orders underneath.',
    'Phones: add it to your home screen and it opens full screen like an app.',
    'Windows: double-click “Start Kingpin.bat”. If Python is missing it offers to install it. Mac keeps “Start Kingpin.command”.',
    'Windows: thin dark scrollbars, and saving waits a moment if antivirus is holding the data file.',
    'Charts are redrawn to fit when you rotate a phone or resize a window.',
  ] },
  { v: '0.4.8', date: '2026-10-21', title: 'House names: successful orders only', items: [
    'Each house’s Names used, Units / line 2 used and Profiles now count only successful orders (shipped or delivered) by default.',
    'A Successful orders / All orders switch above them shows everything, including cancelled and pending orders. Kingpin remembers your choice.',
  ] },
  { v: '0.4.7', date: '2026-10-20', title: 'Checked against your real orders', items: [
    'Fixed: orders whose arrival date had been copied from the order confirmation by older versions kept that guess. Now only a shipping email, live carrier tracking or a date you typed counts as the arrival date. The rest show as “Original order said …”.',
    'Houses: misspelled unit words (“Suuite 635”, “Apartmnet 4”) and letter-only unit jigs (“Apt JAS”, “No. RCH”) are recognized, so those addresses join their main house instead of making new ones.',
    '“Couldn’t read” no longer lists emails that have since been read.',
    'Walmart’s “You might also like” section is no longer read as part of the order.',
  ] },
  { v: '0.4.6', date: '2026-10-20', title: 'Live UPS & FedEx dates, fresh re-read', items: [
    'New Carrier tracking in Settings: paste your free UPS and FedEx developer keys and Kingpin asks the carriers directly for every package. You get the real delivery date (like UPS’s “Tomorrow, Oct 21”), out for delivery, and delivered on the actual day. Packages are checked when you open Kingpin and after every sync.',
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
    'Houses now look past address jigs and typos. “XQZ 11662 S 2670 W”, “11662 S 2670 W ABC”, “abc11662…”, “11662 Suoth 2670 Wset” and “11662 South 2670 West” are all one house. Kingpin matches the house number and ZIP, then compares the street loosely, while different house numbers, streets and ZIPs stay separate.',
    'Your existing houses are merged automatically when you open Kingpin. Nicknames and notes are kept, and each house shows the spelling most of its orders use.',
    'Profiles with jigged addresses still link to their orders.',
    'Delivery windows like “Arrives Thu, Sep 17 – Tue, Sep 22” are kept as a window, and each order shows which email its arrival date came from.',
  ] },
  { v: '0.4.3', date: '2026-10-20', title: 'Correct numbers, clear all, recap range', items: [
    'New “Clear all orders” button on the Orders page. You can undo it right away, or have Kingpin rebuild every order fresh from your email.',
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
    'When the re-read finishes, Kingpin tells you how many orders are in houses and how many have pictures.',
  ] },
  { v: '0.4.1', date: '2026-10-20', title: 'Second pass', items: [
    'Walmart “Shipped:”, “Arrived:” and “Canceled:” emails and Pokémon Center confirmations are now read correctly, all tested against your real emails.',
    'Orders whose emails have no street address (Amazon, PlayStation, cancellations) go into the house of the profile they’re linked to.',
    'Stores that send no pictures (Pokémon Center) borrow the picture from another order of the same product.',
    'Profile matching is about 18× faster with big lists, and details that don’t match now count against a profile.',
    'After an update, an old open Kingpin tab can no longer save over your data. It shows a Reload button instead.',
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
    'Versions now use 0.x numbers while Kingpin is in prerelease, and this changelog was added.',
  ] },
  { v: '0.3.0', date: '2026-10-19', title: 'Faster and cleaner', items: [
    'Much faster email reading. Promos, surveys and non-store emails are skipped before downloading.',
    'Houses group by street address only, ignoring apartment, unit and line 2.',
    'Duplicate and not-an-order cleanup, arrival date and delivered-status fixes.',
    'Data carries over between updates automatically, and multiple devices stay in sync.',
  ] },
  { v: '0.2.0', date: '2026-10-18', title: 'Order tracker and Kingpin Online', items: [
    'Order tracker with IMAP email reading, delivery tracking, houses, a spending card and profile linking.',
    'Kingpin Online runs on any device, including iPad, with end-to-end encryption.',
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

# Crown changelog

Crown is in prerelease, so versions stay at 0.x until it’s finished.

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
- Versions now use 0.x numbers while Crown is in prerelease, and this changelog was added.

## v0.3.0 — Faster and cleaner (2026-10-19)

- Much faster email reading. Promos, surveys and non-store emails are skipped before downloading.
- Houses group by street address only, ignoring apartment, unit and line 2.
- Duplicate and not-an-order cleanup, arrival date and delivered-status fixes.
- Data carries over between updates automatically, and multiple devices stay in sync.

## v0.2.0 — Order tracker and Crown Online (2026-10-18)

- Order tracker with IMAP email reading, delivery tracking, houses, a spending card and profile linking.
- Crown Online runs on any device, including iPad, with end-to-end encryption.

## v0.1.0 — Profile manager (2026-10-17)

- Checkout-bot profile manager with categories, mass import, individual and bulk edits, and a tap-to-pick address line 2 tool.

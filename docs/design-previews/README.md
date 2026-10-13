# Two ways to see it

The same prelaunch message, in two visual directions. These are screenshots of the
implemented pages, not mockups. Open either image for the full-size preview.

| A — Original | B — After hours |
| --- | --- |
| Cream, forest green, soft shapes and a quieter pace. | Charcoal, citron, oversized type and geometric exchange artwork. |
| Route: `/` | Route: `/alternate` |
| ![Original desktop design](original-desktop.png) | ![After hours desktop design](alternate-desktop.png) |
| ![Original mobile design](original-mobile.png) | ![After hours mobile design](alternate-mobile.png) |

Captured from the production build in Chromium at 1440 × 1000 and 390 × 844
(full-page captures). Both pages have A/B navigation, visible keyboard focus and
the same link to the on-device collection. The working name is still configured in
`src/lib/site.ts`. Vercel is selected; a public deployment is pending hosting access.

## The collection

Both designs open the same `/portfolio` workflow. These screenshots use fictional test
entries to show card details, quantities, binder assignment and page/pocket notes. New
collections start empty; these example cards are not added to anyone’s collection.

| Desktop collection | Mobile collection |
| --- | --- |
| ![Desktop card collection](portfolio-desktop.png) | ![Mobile card collection](portfolio-mobile.png) |

Cards are saved in the current browser. JSON export/import moves them between devices
or domains; accounts and automatic synchronization are not connected.


## Card movement and graded-card targets

Collection cards now tilt and lift in 3D with pointer, touch and keyboard interaction.
The sidebar offers independent motion and sound controls. Sound is off by default;
Preview shuffle plays the synthesized card rustle after enabling it. Reduced-motion
preferences keep cards still.

The `/alerts` page stores graded-card buying and selling targets. These production
screenshots use fictional cards and manually entered example prices, not market data.
A new watchlist starts empty. Target status refers to the last entered price and its
recorded timestamp; live pricing and background notifications are not connected.

| Desktop price alerts | Mobile price alerts |
| --- | --- |
| ![Desktop graded-card targets](alerts-desktop.png) | ![Mobile graded-card targets](alerts-mobile.png) |

Export alert backups separately from collection backups when moving devices or domains.

## The broader portfolio

`/inventory` tracks CS:GO / CS2 skins, books and custom collectibles. Each category has
its own details, while quantity, condition, location, notes and optional manual values
work across them. Buying and selling targets compare the last entered unit estimate.

| Desktop portfolio | Mobile portfolio |
| --- | --- |
| ![Desktop skins, books and collectible portfolio](inventory-desktop.png) | ![Mobile skins, books and collectible portfolio](inventory-mobile.png) |

These production screenshots contain fictional entries and prices. Summary totals include
quantities and show priced coverage; currencies are kept separate. Trading cards keep
their binder workflow, accessible through the same navigation. Back up the broader
inventory separately from cards and graded-card alerts. Steam inventories and live
market prices are not connected.

## Website sources and optional accounts

`/sources` keeps public HTTPS product links and manually recorded prices for any item.
The examples below are fictional. Saving a source does not fetch the website or enable
automatic tracking; each source clearly shows its manual status.

| Desktop websites | Mobile websites |
| --- | --- |
| ![Desktop website sources](sources-desktop.png) | ![Mobile website sources](sources-mobile.png) |

`/account` shows the prepared Google and Apple options. Both remain unavailable until
a real authentication integration is connected. Local collections require no account.

| Desktop account preparation | Mobile account preparation |
| --- | --- |
| ![Desktop account preparation](account-desktop.png) | ![Mobile account preparation](account-mobile.png) |

# Privacy Policy — Bridge Classroom Fetch

**Last updated:** 8 August 2026

> The published policy is
> **<https://bridge-classroom.org/privacy#extension>**, and that is the URL the
> store listings point at. It covers the whole path — this extension *and* what
> Bridge Classroom does with results once they arrive. This file is the
> extension-side detail, kept beside the code it describes.

## Overview

Bridge Classroom Fetch is a browser extension that reads bridge results
from pages you are already looking at, and hands them to Bridge Classroom for
analysis. It runs only on the sites listed below, and only when you click its
button.

## What it reads

When you click **Analyze in Bridge Classroom** on a supported results page, the
extension reads that game's results: contracts, declarers, tricks, scores,
matchpoint or IMP comparisons, player identifiers as the site publishes them,
and — on Bridge Base Online — the cardplay for your own table.

Supported sites:

- `live.acbl.org` — ACBL tournament results
- `my.acbl.org` — ACBL club game results
- `bridgebase.com` and `webutil.bridgebase.com` — Bridge Base Online results

It reads nothing on any other site, and nothing on these sites until you ask it
to.

## What it stores, and for how long

Results are held in the browser's extension storage, on your device, only long
enough to pass them to the page you are being taken to. They are deleted as soon
as that page receives them, and in any case within **one hour**.

Your Bridge Base username is cached on the same one-hour basis, so you do not
have to re-enter it during a session. It is never sent anywhere.

The only thing kept indefinitely is which Bridge Classroom domain you prefer
(`.org` or `.com`), so the extension opens the one you use. This identifies
nobody.

Nothing else is retained. There is no history, no profile, and no accumulation
of past games inside the extension.

## Where results go

Results are sent only to **bridge-classroom.org** or **bridge-classroom.com**,
by opening a page there — the same thing that happens if you upload a file to
the site yourself. You can see the destination in your browser's address bar
every time.

Nothing is sent anywhere else *by the extension*. It contains no analytics, no
telemetry, no advertising, no tracking, and no third-party service of any kind.

Once results reach Bridge Classroom, the
[Bridge Classroom privacy policy](https://bridge-classroom.org/privacy#extension)
governs them, and it is worth reading rather than assuming — the site does more
with them than the extension does:

- If you are **signed in to Bridge Classroom**, the game is also saved to your
  account so it is available on your other devices. If you are not signed in,
  nothing reaches the server at all.
- Opening a **single board** sends that deal — the cards, the dealer, and the
  vulnerability, with no names attached — to our own bidding service, which
  returns the auction a robot would have bid. Double-dummy results come with the
  ACBL data or are computed on your device.

## Other players' names

When reading Bridge Base Online tournament results, the extension deliberately
requests the results page **without signing in**, because Bridge Base then
withholds other players' real names. Your opponents are recorded only by their
Bridge Base usernames.

Results from the ACBL sites do include player names and ACBL numbers, because
those sites publish them — in a club game you generally know the players, and
the names are the point of the analysis.

## What it does not do

- No personal information is collected: no name, email, or account credentials
- No browsing history is read or recorded
- Your logins are never read, stored, or transmitted. The extension relies on
  the sessions already in your browser, exactly as the sites' own pages do
- No data is sold or shared with anyone

## Permissions

| Permission | Why |
|---|---|
| `storage` | Holding results for up to an hour between reading them and handing them over |
| `tabs` | Opening the Bridge Classroom page with your results, and finding an already-open results tab to read from |
| `scripting` | The ACBL sites reject requests made from the extension's background; the read is performed inside your own tab on that site instead |
| Site access to the sites listed above | Reading the results you asked for |

## Source code

This extension is open source and released into the public domain under
[The Unlicense](https://github.com/bridge-craftwork/bridge-classroom-fetch/blob/main/LICENSE).
You can read exactly what it does:

https://github.com/bridge-craftwork/bridge-classroom-fetch

## Contact

Questions about this policy: open an issue at
https://github.com/bridge-craftwork/bridge-classroom-fetch/issues

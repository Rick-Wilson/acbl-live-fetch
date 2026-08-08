# Store Review — test procedures, screenshots, permission justifications

For submitting to the Chrome Web Store, Firefox Add-ons and the Mac App Store.
Everything a reviewer needs to exercise the extension, and everything we have to
declare.

The central fact: **three of the four sources can be exercised with no account at
all**, including a real club game with a full field. Reviewers should be pointed
at those first. Only the BBO history features and ACBL Live tournaments need a
third-party login, which is friction we cannot remove.

---

## 1. What a reviewer can reach without an account

Verified in a clean browser profile, August 2026 — see the summary table in
[data-sources.md](data-sources.md).

| Path | Account needed? |
|---|---|
| **BBO hand viewer** (`tools/handviewer.html?lin=…`) | **No** |
| **BBO tournament summary** (`tview.php`) | **No** |
| **ACBL club games** (`my.acbl.org`) | **No** — Cloudflare check, then results |
| BBO hands list / travellers / history | BBO login |
| ACBL Live tournaments (`live.acbl.org`) | ACBL login (behind Cloudflare) |

The two ACBL properties differ. `live.acbl.org` shows a Cloudflare check and then
an ACBL sign-in prompt, so it needs credentials. `my.acbl.org` shows the
Cloudflare check and then the results — club games are public, so a reviewer can
test that path with no account.

**Three of the four sources are therefore reviewable without any login**,
including one real club game with a full field of results.

---

## 2. Primary test procedure — no account required

This exercises the whole pipeline: content-script injection, extraction, envelope
construction, and hand-off to the analyzer. **Takes about a minute.**

1. Install the extension.
2. Open this URL — a complete bridge deal encoded in the URL itself:

   ```
   https://www.bridgebase.com/tools/handviewer.html?bbo=y&lin=pn%7CFairways4%2Caam135%2Cbrosh%2Ckemistry%7Cst%7C%7Cmd%7C4ST543HQT73DAJ875C%2CS976H92DT3CJ87432%2CSQHAJ64DQ94CKQT65%2CSAKJ82HK85DK62CA9%7Csv%7Cn%7Crh%7C%7Cah%7CBoard+2%7Cmb%7C1S%7Cmb%7CP%7Cmb%7CP%7Cmb%7CP%7Cpc%7CDA%7Cpc%7CD3%7Cpc%7CD4%7Cpc%7CD6%7C
   ```

3. **Expected:** an "Analyze in Bridge Classroom" button appears in the row of
   controls at the bottom of the page, alongside Rewind / Previous / Next /
   Options / Play.
4. Click it.
5. **Expected:** a new tab opens at `bridge-classroom.org` showing the deal's
   analysis. No login is requested at any point.

**No network request is made to fetch the deal** — it is read from the URL. This
is the cheapest possible demonstration that the extension does what it claims.

### Secondary, still no account required

**A real club game with a full field** — the most representative demonstration:

```
https://my.acbl.org/club-results/details/1455416
```

A Cloudflare check appears first for a fresh browser profile; it clears by
itself. The results then display without a login, and the button appears in the
page navigation. Clicking it extracts every board and section of that game.

**A public BBO tournament summary:**

```
https://webutil.bridgebase.com/v2/tview.php?t=30567-1785967200&u=kemistry
```

The button appears as a top-right overlay on this page and extracts the event.

---

## 3. Procedures that need credentials

Supply test accounts in each store's reviewer-notes field. **Two separate
accounts are needed**; they are unrelated services.

| Service | Needed for | Where to sign in |
|---|---|---|
| BBO (free) | hands list, travellers, history batch | `bridgebase.com` |
| ACBL | `live.acbl.org` tournaments only | `live.acbl.org` |

`my.acbl.org` needs no account — see the previous section.

Suggested reviewer note:

> You can test this extension end to end **without any account** — see the three
> URLs in the test procedure, which need no login. A Cloudflare check may appear
> on the ACBL links; it clears by itself and is not part of the extension. Test
> credentials for the two account-based paths are below.

**BBO path:** sign in at bridgebase.com, then open
`https://www.bridgebase.com/myhands/hands.php?tourney=<id>-&username=<account>`.
The button appears top-right; clicking it fetches every board in that session.

**ACBL Live path:** sign in at live.acbl.org, open any event scorecard
(`/event/<sanction>/<event>/<session>/scores/<section>/<direction>/<pair>`).
A Cloudflare check appears first for a fresh browser profile.

---

## 4. Screenshots to prepare

Store listings need these; the parenthetical is what each has to make obvious.

1. **Button on the hand viewer** — the control row with our button in it.
   *(Shows the extension integrating with the page, not covering it.)*
2. **Button on a results page** — an `my.acbl.org` club game, which needs no
   login and so can be reproduced by anyone.
   *(Shows the primary real-world use.)*
3. **Extraction in progress** — button in its "Extracting…" state.
   *(Shows feedback during the operation.)*
4. **The analysis result** — the Bridge Classroom page after hand-off.
   *(Shows the payoff, and that data goes somewhere useful.)*
5. **History picker** — the BBO lobby date-range UI.
   *(Shows the batch feature.)*

Capture at 1280×800, the Chrome Web Store's preferred size. Avoid showing real
opponents' names where practical: the hand viewer screenshot uses BBO usernames
only, which is why it makes a good lead image.

---

## 5. Permission justifications

Chrome requires a written justification per permission. Current manifest:

| Permission | Justification |
|---|---|
| `storage` | Holds the extracted results briefly (1-hour expiry) between extraction and hand-off to the analyzer page, plus user preferences. Nothing is transmitted anywhere else. |
| `tabs` | Opens the analyzer page with the extracted results, and locates an already-open results tab to read from. |
| `scripting` | Both ACBL sites reject requests made from the extension's background worker with HTTP 403, so the fetch is issued from inside one of the user's own tabs on that site instead. This is required for the site's own protections to be satisfied — a session on `live.acbl.org`, bot-protection clearance on `my.acbl.org`. |
| Host: `live.acbl.org`, `my.acbl.org` | Reading the user's own tournament and club results. |
| Host: `www.bridgebase.com`, `webutil.bridgebase.com` | Reading the user's own BBO results. |
| Host: `bridge-classroom.{org,com}` | Delivering the results to the analyzer the user chose to send them to. |

### Before submitting

- **Remove `http://localhost:3001/game-analysis/*`** from `host_permissions`. It
  backs the local development workflow in `CLAUDE.md` and has no business in a
  published build — a localhost permission in a store listing invites questions
  for no user benefit. Ship it via a separate unpacked build.
- **Do not ship the `INGEST_TEST=1` build.** It adds `localhost`, `127.0.0.1`
  and a GitHub Pages origin for end-to-end testing.

---

## 6. Data-use declarations

All three stores ask what data is collected and where it goes. The accurate
answers:

- **What is read:** bridge game results from sites the user is already viewing —
  contracts, scores, and the user's own cardplay.
- **Where it goes:** only to `bridge-classroom.org` / `.com`, the analyzer the
  user is choosing to send it to, by opening a tab. There is no analytics, no
  telemetry, and no third-party endpoint.
- **Personal information:** BBO data is captured **without** real player names by
  deliberate design — the tournament summary is fetched without credentials
  precisely so BBO withholds identities (see `coverage.player_names` in
  [normalized-schema.md](normalized-schema.md)). ACBL sources do publish real
  names and player numbers, and those are captured, because on a club game the
  user generally knows the players and the names are the point.
- **A privacy policy is required** by the Chrome Web Store for any extension
  handling user data, and must be linked from the listing.

### Where the policy lives

One document, on bridge-classroom.org, with a clearly-headed *Browser extension*
section; that URL goes in the listing. A separate document isn't needed, but
pointing the listing at a general site policy that never mentions the extension
does get rejected — reviewers look for the requested permissions to be described.

The division: the extension is a conduit plus a short-lived cache **on the user's
own device**. Once results reach bridge-classroom.org the main policy governs
them. When back-end storage of hand data ships (ADR 0001), that change belongs in
the main document, not this section.

### Draft — extension section

> **Browser extension**
>
> The Bridge Classroom browser extension reads bridge results from pages you are
> already viewing on supported sites — ACBL Live, my.acbl.org and Bridge Base
> Online — when you click its button. It does not run on other sites, and it does
> not read anything until you ask it to.
>
> Results are held briefly in the browser's own extension storage, on your
> device, so they can be passed to the analysis page you are being taken to. They
> are deleted as soon as the page receives them, and in any case within one hour.
> Your Bridge Base username is cached on the same one-hour basis so you don't
> have to re-enter it; it is never sent anywhere.
>
> The only setting kept indefinitely is which Bridge Classroom domain you prefer
> (.org or .com), so the extension opens the one you use. This identifies nobody.
>
> Results are sent only to bridge-classroom.org or bridge-classroom.com, by
> opening a page there — the same thing that happens if you upload a file
> yourself. Nothing is sent to any other service. The extension contains no
> analytics or tracking of any kind.
>
> When reading Bridge Base tournament results, the extension deliberately
> requests the results page **without signing in**, because Bridge Base then
> withholds other players' real names. Your opponents are recorded only by their
> Bridge Base usernames. Results from ACBL sites do include player names and
> numbers, because those sites publish them.
>
> Once results reach Bridge Classroom, the rest of this policy applies to them.

---

## 7. Known review friction

**Some features need a third-party account.** The BBO history features and ACBL
Live tournaments read the user's own results from sites that require sign-in.
Mitigated by leading with the three paths that need nothing.

**Cloudflare on both ACBL properties.** A reviewer with a fresh profile meets an
interstitial before the page loads — on `live.acbl.org` a login prompt follows,
on `my.acbl.org` the results do. Worth mentioning in reviewer notes so the
interstitial isn't mistaken for the extension misbehaving.

**The extension appears to do nothing on unsupported pages.** By design: the
button only injects on recognised result pages. A reviewer opening
`bridgebase.com` generally will see no UI. Say so explicitly in the notes.

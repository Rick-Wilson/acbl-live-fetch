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
   https://www.bridgebase.com/tools/handviewer.html?bbo=y&lin=pn%7CSouth%2CWest%2CNorth%2CEast%7Cst%7C%7Cmd%7C3S789TQH5KD2C2478T%2CS2456JAH6TD57TKC6%2CS3H78JD4689JQC39J%2C%7Crh%7C%7Cah%7CBoard%201%7Csv%7Co%7Cmb%7Cp%7Cmb%7C2C%7Cmb%7C2S%7Cmb%7Cp%7Cmb%7Cp%7Cmb%7C3H%7Cmb%7Cp%7Cmb%7C3N%7Cmb%7Cp%7Cmb%7Cp%7Cmb%7Cp%7Cpc%7CDQ%7Cpc%7CD3%7Cpc%7CD2%7Cpc%7CDK%7Cpc%7CHT%7Cpc%7CH7%7Cpc%7CH2%7Cpc%7CHK%7Cpc%7CST%7Cpc%7CS2%7Cpc%7CS3%7Cpc%7CSK%7Cpc%7CHA%7Cpc%7CH5%7Cpc%7CH6%7Cpc%7CH8%7Cpc%7CHQ%7Cpc%7CS7%7Cpc%7CS4%7Cpc%7CHJ%7Cpc%7CH9%7Cpc%7CS8%7Cpc%7CS5%7Cpc%7CD4%7Cpc%7CH4%7Cpc%7CS9%7Cpc%7CS6%7Cpc%7CD6%7Cpc%7CH3%7Cpc%7CSQ%7Cpc%7CSJ%7Cpc%7CD8%7Cpc%7CDA%7Cpc%7CC2%7Cpc%7CD5%7Cpc%7CD9%7Cpc%7CCA%7Cpc%7CC4%7Cpc%7CC6%7Cpc%7CC3%7Cpc%7CCK%7Cpc%7CC7%7Cpc%7CD7%7Cpc%7CC9%7Cpc%7CCQ%7Cpc%7CC8%7Cpc%7CDT%7Cpc%7CCJ%7Cpc%7CC5%7Cpc%7CCT%7Cpc%7CSA%7Cpc%7CDJ%7C
   ```

   A complete deal: 3NT, an eleven-call auction, and all 52 cards. The four
   `pn|` names are the seat names rather than real BBO handles — the players are
   embedded in the URL in plain text, so there is no reason to put anyone's
   account name into store reviewer notes or a screenshot.

3. **Expected:** a **"Bridge Classroom"** button appears in the row of controls
   at the bottom of the page, alongside Rewind / Previous / Next / Options / DD
   / Play — all of which are BBO's own.

   The label is the short one here. Everywhere else the button reads "Analyze
   in Bridge Classroom"; on the hand viewer it is shortened to fit BBO's
   control row (`sourceContent.js`, the `btn.textContent` beside the control-row
   injection). A reviewer following this script literally would otherwise look
   for the wrong text.

   **Take screenshots in a profile with other bridge extensions disabled.**
   BBO Helper injects into the same rows we do — on the hands list it adds
   PBN / LIN / HTML buttons under Movie and Traveller. The two coexist happily
   in daily use, since they cover different ground (see
   [prior-art.md](prior-art.md)); the problem is only in a screenshot, where a
   viewer has no way to tell whose button is whose and would reasonably assume
   every one of them is ours.
4. Click it.
5. **Expected:** a new tab opens at `bridge-classroom.org` showing the deal's
   analysis. No login is requested at any point.

   All thirteen tricks should appear. **Test with complete deals** — or with
   deals that run to a claim, which is as complete as a real one gets. A LIN
   that stops early transfers faithfully and then looks broken at the far end:
   an earlier version of this procedure used a deal carrying four cards, and the
   analyzer's empty play was mistaken for a failure to transfer. It was not.
   Nothing downstream can distinguish "the data stops here" from "the extension
   dropped it", so do not hand a reviewer a deal that stops.

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

## 3a. Listing copy

Reusable across all four stores. Each has a different length limit; the short
summary below fits the tightest (Chrome's 132 characters).

**Name:** Bridge Classroom Fetch

**Short summary** (132 chars):

> Send your bridge results from ACBL Live, my.acbl.org and BBO to Bridge
> Classroom for analysis, with one click.

**Description:**

> Bridge results are easy to look at and hard to learn from. This extension
> takes the game you are already looking at — an ACBL tournament, a club game,
> or a Bridge Base Online session — and sends it to Bridge Classroom, where it
> can be analysed properly.
>
> Click the button on any supported results page. The extension reads that
> game's boards, contracts, scores and comparisons, and opens Bridge Classroom
> with them. No downloading files, no uploading them again.
>
> Supported sites:
> • live.acbl.org — tournament results
> • my.acbl.org — club game results
> • Bridge Base Online — tournament results and single deals
>
> On Bridge Base Online it also captures the cardplay for your own table, so
> your play can be reviewed hand by hand. Other players' real names are
> deliberately not collected from BBO.
>
> The extension only runs on those sites, only when you click it, and sends
> results only to Bridge Classroom. No analytics, no tracking, no accounts.
>
> Open source and public domain:
> https://github.com/bridge-craftwork/bridge-classroom-fetch

**Category:** Productivity (Chrome/Edge) · Other (Firefox) · Utilities (Mac App
Store)

**Support / homepage:** https://github.com/bridge-craftwork/bridge-classroom-fetch
**Privacy policy:** https://bridge-classroom.org/privacy#extension

## 3b. Per-store differences

| | Chrome | Edge | Firefox | Safari |
|---|---|---|---|---|
| Artifact | `-chrome.zip` | `-edge.zip` | `-firefox.zip` **+ `-source.zip`** | Mac app from Xcode |
| Built by | `scripts/package-stores.sh` | same | same | Xcode archive |
| Extra manifest | — | — | `browser_specific_settings.gecko.id` (already in `vite.config.js`) | — |
| Account | Chrome Web Store developer | Microsoft Partner Center | addons.mozilla.org | Apple Developer Program |
| Notable | Permission justifications required per permission | Mirrors Chrome | **Source archive required** because the upload is minified; reviewers rebuild it | Ships as an app; needs an app icon set and its own version/build numbers |

Firefox reviewers need to reproduce the build. The source archive is produced by
`git archive` from `HEAD`, so commit before packaging; note `npm ci` then
`BROWSER=firefox npm run build` in the reviewer notes.

### 3bb. Safari: the Xcode project does not track new files

`package-stores.sh` copies `dist/safari/` into
`safari/…/Shared (Extension)/Resources/`, but **Xcode only bundles what
`project.pbxproj` references.** The project lists the extension's resources
individually — `manifest.json`, `service-worker-loader.js`, and `assets` as a
folder reference. Anything else on disk is invisible to the build.

This bit us once. `icons/` was added to the extension after the Xcode project
was generated, so the copy landed on disk, the project never referenced it, and
the built `.appex` shipped a manifest declaring four icon paths that did not
exist inside the bundle. Chrome, Edge and Firefox were all fine — they zip a
directory, so nothing can go missing. Safari is the only target where the
packaging step and the bundling step disagree.

`icons` is now registered as a folder reference beside `assets`, in both the iOS
and macOS extension targets. **If a future build ever emits a new top-level file
or folder into `dist/`, add it to the Xcode project too.** To check rather than
assume, build and diff:

```bash
xcodebuild -scheme "Bridge Classroom Fetch (macOS)" -configuration Debug \
  -derivedDataPath /tmp/dd build
diff -rq dist/safari \
  "/tmp/dd/Build/Products/Debug/Bridge Classroom Fetch.app/Contents/PlugIns/Bridge Classroom Fetch Extension.appex/Contents/Resources"
```

It should report no differences. A folder reference (blue in Xcode, `lastKnownFileType = folder`)
tracks its contents automatically, so files *inside* `icons/` and `assets/` need
no further action — only new top-level entries do.

### 3c. addons-linter, and what it says

AMO runs Mozilla's `addons-linter` on upload. Run it first:

```bash
npm run build:firefox
npx web-ext lint --source-dir dist/firefox
```

**Current state: 0 errors, 2 warnings**, both expected and both explainable.

**`UNSAFE_VAR_ASSIGNMENT` ×2 — false positives, and worth pre-empting in the
reviewer notes.** Both land in the bundled `background.js` chunk, and both are
inside **linkedom's own DOM implementation** — its `innerHTML` accessor and its
fragment parser. We bundle linkedom because MV3 service workers do not expose
`DOMParser` and the parsers need one (`src/background.js`). Nothing in our
source assigns to `innerHTML` at all; `grep -rn innerHTML src/` returns nothing.
The linter is flagging a vendored library implementing the DOM, not this
extension writing markup into a page.

**`data_collection_permissions` is required for new Firefox extensions.** It is
declared in `vite.config.js` as the explicit `required: ['none']` — the
extension collects nothing, and Mozilla wants that said rather than omitted.

That key set the version floors. It landed in Firefox 140 and Firefox for
Android 142, so the previous `strict_min_version: 121.0` (chosen only for MV3
service-worker support) made the declaration a lint error. The manifest now
carries `gecko.strict_min_version: 140.0` and a separate
`gecko_android.strict_min_version: 142.0`. **This drops Firefox 121–139**, which
is the cost of the declaration; the alternative is shipping without it and
arguing with a reviewer.

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

### Two ways to capture, because Cloudflare blocks one of them

`tools/screenshot-session.js` launches Chromium with the viewport emulated at
exactly 1280×800 and captures the page only, so there is no chrome to crop and
no guessing at window size. Use it for **BBO pages** — 1 and 5.

**It cannot reach `my.acbl.org`.** That site is behind a Cloudflare check which
loops forever under automation: the "Verify you are a human" box passes, spins,
and asks again. Using real Chrome, clearing `navigator.webdriver` and dropping
`--enable-automation` were not enough; Cloudflare also detects the CDP
attachment, and Playwright cannot drive a page without CDP. Going further means
fingerprint evasion, which is not worth it for a screenshot.

So take **2, 3 and 4 in ordinary Chrome**, where the check passes as it does for
any user:

1. Load `dist/chrome` unpacked at `chrome://extensions`
2. **⌘⇧M** → **Responsive** → **1280 × 800**; the **⋮** menu → *Add device pixel
   ratio* → **2**
3. **⌘⇧P** → *Capture screenshot* → saves the viewport only, at 2560×1600

For a before/after pair, hide the injected elements from the console, shoot,
then restore and shoot again — the same trick `--pair` uses, and exact for the
same reason:

```js
const I = '[id^="bridge-classroom-"]'
document.querySelectorAll(I).forEach((e) => (e.style.visibility = 'hidden'))  // before
document.querySelectorAll(I).forEach((e) => (e.style.visibility = ''))        // after
```

### One set of five serves all four stores

**Capture at 1280×800.** It is accepted everywhere, so there is no need to shoot
per store:

| Store | Accepted size | Format | Count |
|---|---|---|---|
| Chrome Web Store | 1280×800 (or 640×400) | PNG / JPEG | 1–5 |
| Edge Add-ons | 1280×800 | PNG | 1–6 |
| Firefox AMO | 1280×800 | PNG | 1+ |
| Apple App Store | 1280×800, 1440×900, 2560×1600, 2880×1800 | PNG / JPEG | 1–10 |

**Crop the browser chrome out of every shot.** Apple's review guidelines
prohibit showing competitor browsers in App Store screenshots, so a Safari
extension listing displaying Chrome's tab bar and omnibox invites a rejection
from the slowest store to argue with. Cropping sidesteps it: all five images
above are in-page UI, and not one needs a tab bar, an omnibox or a toolbar icon
to make its point. Cropped, they are browser-neutral and the same files go to
all four.

That also means the shots can be taken in whichever browser is convenient —
Chrome is fine — as long as nothing browser-specific survives the crop.

**On a Retina display, shoot 1280×800 logical and macOS records 2560×1600
actual pixels.** That is a valid Apple size as it stands and downscales cleanly
to 1280×800 for the other three, so capture once and export twice rather than
shooting at a size that leaves nothing sharp for the Mac App Store.

The only reason to shoot per store would be an image deliberately showing
browser UI — the toolbar icon sitting in its own toolbar, say. None of the five
do, so this is optional, and it would mean a separate capture in each browser.

**Avoid showing real opponents' names where practical.** The hand viewer
screenshot uses BBO usernames only, which is why it makes a good lead image —
and the test URL in § 2 now carries seat names rather than real handles, so it
is safe to shoot as-is.

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
| Content script on `bridge-classroom.{org,com}` | Delivering the results to the page the user is taken to, which then forwards them to the chosen tool. No host permission is requested for these domains — the content-script match is sufficient. |

### Before submitting

- ~~Remove `http://localhost:3001/game-analysis/*` from `host_permissions`.~~
  Done — removed when the `/game-analysis/` hand-off was retired. Local
  development now uses the `devIngestUrl` override, which needs no manifest
  entry.
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

### Published — 8 August 2026

The section is live at **https://bridge-classroom.org/privacy#extension**, in
`docs/privacy.html` of the `Bridge-Classroom` repo. That URL is what goes in every
listing. `PRIVACY.md` at this repo's root stays as the extension-side detail and
links to it; the site document is canonical.

It ships wider than the draft above, because back-end storage *has* since shipped
and the analyzer reaches two outside services. Three things the draft did not say,
all verified in the code rather than assumed:

- **Signed-in captures are archived server-side.** The `/ingest/` page POSTs the
  whole normalized envelope to `api.bridge-classroom.{org,com}/api/club-games`
  (the `bc-archive` sink). Anonymous users are untouched — "this capture stays in
  this browser". The archive is **not** end-to-end encrypted, unlike practice
  activity, and it carries other players' ACBL names and numbers.
- **Opening a board sends the deal to `bba.harmonicsystems.com`** for the robot
  auction. Cards, dealer and vulnerability only — no names. This is our own
  service, *not* a third party, so it needs no third-party disclosure; it is
  described because the data does leave the page. Not extension-specific; a
  hand-uploaded game does the same.
- **Double-dummy never leaves the browser.** It arrives in the ACBL data, or —
  for BBO captures, whose adapter emits `double_dummy: null` — is solved by our
  `bridge-solver` wasm running in a worker, vendored at
  `Bridge-Game-Analysis/static/solver/`. Until August 2026 this was a
  third-party call to `dds.bridgewebs.com` (BSOL); that was removed, with no
  network fallback, precisely so the listing can claim what it claims. If a
  future change reintroduces an outbound solver, this section and the published
  policy both have to change.
- **Single-board replays route to `solver.bridge-classroom.org`** with the hand in
  the URL as `?lin=`.

So the draft's "Nothing is sent to any other service" is true of the *extension*
and false of the *site*, which is precisely why the two documents are scoped the
way they are. Keep that boundary if either is edited.

---

## 6a. Blockers before any submission

**~~Icons — nothing exists yet~~ — drawn, wired, and rendered.** A mortarboard
in white on the `#1a73e8` tile that matches the injected button. Source is
`icons/icon.svg`; `node scripts/render-icons.mjs` rasterises every size below
via Chromium and fills the Safari asset catalog. `manifest.json` now has both
`icons` and an `action`, so there is a toolbar button where there was none.

The Mac app gets its own canvas, because a toolbar icon and a Dock icon are not
the same object: Apple's grid insets the artwork to 824×824 within a 1024 canvas
with a 185.4 corner radius, and a full-bleed tile reads as visibly larger and
squarer than everything beside it. The script composes that variant by lifting
`<g id="glyph">` out of `icon.svg`, so the two icons cannot drift apart — edit
the mark once.

**~~Sign-off on the artwork~~ — approved, 10 August 2026.** Rick approved the
mortarboard after seeing it render in Chrome, Edge and Safari. It is a drawn
mark rather than a designed one, and it ships as it stands.

The dark and tinted iOS variants in the asset catalog remain deliberately
empty; Xcode falls back to the light one, and filling them means drawing them.

Sizes, for reference:

| Store | Needs |
|---|---|
| Chrome | 128×128 store icon; manifest `icons` 16/32/48/128 expected |
| Edge | 300×300 store logo, plus the manifest icons |
| Firefox | at least 48×48 and 96×96 |
| Safari | a full macOS AppIcon set, 16 through 1024 |

This is a design decision rather than a packaging one, so it is deliberately not
guessed at here. A placeholder set can be generated to prove the pipeline end to
end, but the shipped artwork should be real.

**The green spade is taken.** Bridge Solver (see [prior-art.md](prior-art.md))
ships a spade on a green tile, does an adjacent job — "extract bridge hands from
results pages and load them into Bridge Solver Online" — and sits in the same
toolbar as us on the machines that matter. Reusing the site's green spade
favicon, the obvious move, would produce two near-identical 16px icons side by
side. Differentiate on **silhouette**, not shade: at 16px the outline is all
anyone reads, and colour alone won't separate them.

**~~Privacy policy URL~~ — done.** https://bridge-classroom.org/privacy#extension
(see *Where the policy lives* above). Needs the `Bridge-Classroom` repo deployed
before it resolves.

**~~Version number~~ — 1.0.0.** The first public release. Four places carry it,
and they are not all the same string by default:

| Where | Note |
|---|---|
| `manifest.json` | canonical; `PROVIDER.version` reads it, so the payload follows |
| `package.json` + lock | `npm version 1.0.0 --no-git-tag-version` |
| Xcode `MARKETING_VERSION` | was the template's `1.0`, which is *not* `1.0.0` |
| Xcode `CURRENT_PROJECT_VERSION` | build number, at 1; bump per Safari **upload**, not per release |

Bump it with one command, from the folder holding the `.xcodeproj`:

```bash
cd "safari/Bridge Classroom Fetch"
xcrun agvtool new-version -all 2      # what-version -terse to check
```

That updates all four targets across both configurations and leaves
`MARKETING_VERSION` alone. Only `project.pbxproj` changes — the Info.plists
agvtool names are generated.

The first upload can go as build 1. App Store Connect refuses a second upload
reusing a build number, so this is for re-uploading against the same 1.0.0
after a rejection.

`safari/…/Shared (Extension)/Resources/manifest.json` also carries it, but that
is packaging output — re-run `package-stores.sh` rather than editing it.

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

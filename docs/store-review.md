# Store Review — test procedures, screenshots, permission justifications

For submitting to the Chrome Web Store, Firefox Add-ons and the Mac App Store.
Everything a reviewer needs to exercise the extension, and everything we have to
declare.

The central fact: **three of the four sources can be exercised with no account at
all**, including a real club game with a full field. Reviewers should be pointed
at those first — they demonstrate every part of the extension, and a reviewer
can reproduce them completely.

**We supply no test credentials.** The BBO history features and ACBL Live
tournaments need a third-party login, and neither account can responsibly be
handed over — see § 3, which also covers what to say instead and the screen
recording that stands in for them.

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

## 3. Procedures that need credentials — and why we supply none

**We cannot hand a reviewer a BBO account, and should not hand over an ACBL
one.** This is a constraint to design the reviewer notes around, not a gap to
apologise for.

- **BBO allows one session per user.** A reviewer signing in with our account
  signs us out, and four stores reviewing in parallel would evict each other
  mid-test. Sharing one login cannot work even in principle.
- **A fresh BBO account would not help.** The features that need the login —
  hands list, travellers, history batch — read *results of sessions you have
  played*. A new account has none, so a reviewer would sign in and correctly
  find nothing. Manufacturing history means actually playing tournaments.
- **The ACBL account is a real membership** tied to a person, with masterpoint
  records and personal data behind it. Handing those credentials to reviewers
  at four companies is not something to do casually.

### What to put in the reviewer-notes field instead

> **No account is needed to test this extension end to end.** Three of the four
> supported sources are fully public, including a real club game with a
> complete field of results — the procedure below takes about a minute and
> exercises the whole pipeline: injection, extraction, and hand-off.
>
> Two further sources need a third-party login (Bridge Base Online, ACBL Live).
> We cannot supply credentials for these: BBO permits only one active session
> per account, so a shared login would sign reviewers out of each other's
> sessions, and a new account has no played history to read. The ACBL account
> is a personal membership record. **Short recordings of both authenticated
> paths are at
> https://bridge-craftwork.github.io/bridge-classroom-fetch/demo/**, showing the
> same behaviour the public paths demonstrate, against data that requires a
> login. Opponents' names are obscured there, for the same reason the extension
> does not collect them.
>
> A Cloudflare check may appear on the ACBL links. It clears by itself, is not
> part of the extension, and if a fetch is refused the extension now says so
> and asks you to reload.

Lead with § 2's public procedure. It is the strongest thing we have: a reviewer
can reproduce it completely, and it shows every part of the extension working.

### The recordings

Three clips of about **30 seconds each**, one per authenticated path, rather
than a single long video: a reviewer can open the one they care about, and each
stands alone if a store's notes field only takes one URL.

They live on the extension's **own** Pages site, not `bridge-classroom.org`.
The privacy policy is shared because the extension is a component of Bridge
Classroom; these are the extension's own assets.

**They are a reviewer aid, not a listing asset.** No store listing links them
and no marketing points at them; they exist so a reviewer can see the two paths
we cannot hand them credentials for. The page is `noindex` and is not linked
from anywhere.

That said, **treat them as fully public.** This repository is public, so the
files are browsable on GitHub and present in the commit history whether or not
anyone has the URL — `noindex` keeps them out of search results, it does not
make them unlisted. Every clip was anonymised on that assumption, which is why
publishing them here is fine. If they ever need to be genuinely link-only, that
means a private repo with its own Pages deploy, or an unlisted video host.

```
https://bridge-craftwork.github.io/bridge-classroom-fetch/demo/
```

`demo/index.html` is built and committed — it carries the explanation of why no
credentials are supplied, so the page stands on its own if a reviewer opens it
cold. It expects three files beside it:

| File | Shows |
|---|---|
| `demo/bbo-hands-list.mp4` | The button in BBO's hands-list header; one session extracted across the field |
| `demo/bbo-history-batch.mp4` | The lobby date-range menu, the progress count, the batch result |
| `demo/acbl-live-tournament.mp4` | `live.acbl.org`, the button beside the `h1`, one event extracted |

`.github/workflows/pages.yml` publishes `demo/` to `/demo/` alongside the test
ingester, on any push touching those paths.

**Recording notes.**

- Clean profile, other bridge extensions disabled — BBO Helper injects into the
  same rows (§ 2).
- **Blur, record, blur again, cut the middle.** The console swaps live in the
  DOM, so the moment the analyzer renders in its new tab the real names are on
  camera. The fix is not region masking — it is sequencing:

  1. On the source page, run the blur/relabel snippet.
  2. Start recording. Click the button.
  3. Let the result render, then stop or pause.
  4. Run the snippet again on the page that just rendered.
  5. Resume, and record the rest.
  6. Trim out the seconds between steps 3 and 4, where the names were clear.

  If the recorder has no pause — QuickTime and macOS's own ⌘⇧5 do not — record
  straight through and cut that stretch in the edit instead. Same result.

  A video is no less public than a screenshot, and a BBO traveller shows a full
  field, so **check the finished file around the cut** before publishing. One
  stray frame is a lot of real names, and unlike a screenshot you cannot see it
  in a glance.

- **Record the page area, not the browser window** — ⌘⇧5 → *Record Selected
  Portion*. Same reason the screenshots are cropped: Apple's guidelines
  prohibit showing a competitor browser, and cropping to the tab makes one
  recording usable for all four stores. Nothing validates a linked video's
  dimensions, so it need not be pixel-exact, but staying near the 1280×800
  device-mode viewport keeps it consistent with the stills.

  These are **reviewer aids, not App Previews.** App Previews appear on a Mac
  App Store product page and have strict rules — fixed resolutions, 15–30
  seconds, uploaded through App Store Connect rather than linked. They are
  optional and this submission needs none.

**Encoding.** At 30 seconds these land at a few MB each, comfortably inside
GitHub's limits — but re-encode rather than committing QuickTime's `.mov`:

```bash
ffmpeg -i raw.mov -vf scale=1280:-2 -c:v libx264 -crf 28 -preset slow \
       -pix_fmt yuv420p -movflags +faststart -an demo/bbo-hands-list.mp4
```

`+faststart` puts the index at the front so playback begins before the file has
finished downloading. `-an` drops audio, which these do not need.

**Two limits worth knowing.** GitHub rejects any file over **100 MB**, and
**Git LFS must not be used** — Pages serves the LFS pointer rather than the
video, which looks like it works until a reviewer receives 130 bytes of text.

**All three are recorded and committed**, and published at the URL above.

**`acbl-live-tournament.mp4` is a release behind, and is being re-recorded for
1.1.0.** It was shot on 11 August; the ACBL Live work landed on the 13th. What
it shows — the button beside the `h1` on an event summary, then the analysis —
still happens, so nothing in it is a lie. What it omits is now the interesting
part: that page asks which pair before it fetches, and the label counts a
percentage while it does. The clip exists to show a reviewer the path they
cannot log in to, so it should show the path as built.

The other two are unaffected. `bbo-history-batch.mp4` shows the *BBO* lobby
batch, which was never touched — only ACBL Live's date-range batch was removed.

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

**New source files are not new top-level entries.** 1.1.0 added three modules —
`src/ui/acblResultsList.js`, `pairPicker.js`, `extractProgress.js` — and needed
no Xcode change, because Vite bundles them into the existing `assets/` chunks:
they are imported by `sourceContent.js` rather than being fresh entry points.
Checked rather than assumed — `ls dist/safari` before and after still reports
exactly `assets`, `icons`, `manifest.json`, `service-worker-loader.js`.

What *would* need registering is a new **entry point**: another content script
or an HTML page in `manifest.json`, which @crxjs emits with its own loader
beside `service-worker-loader.js`. That is the trigger to watch for, not "a file
was added to `src/`".

### 3bc. Safari: what the archive actually needs

Checked by archiving rather than by reading, August 2026. `xcodebuild -scheme
"Bridge Classroom Fetch (macOS)" -configuration Release archive` **succeeds**,
and the archived app carries 1.1.0 / build 1 with the extension's resources
byte-identical to `dist/safari`.

**Sandboxing is already correct, and there is no `.entitlements` file to look
for.** Current Xcode synthesises entitlements from build settings, so the
absence of a file is not the absence of a sandbox. Verified against the signed
archive with `codesign -d --entitlements`:

| | App | Extension |
|---|:--:|:--:|
| `com.apple.security.app-sandbox` | ✅ | ✅ |
| `com.apple.security.files.user-selected.read-only` | ✅ | ✅ |
| `com.apple.security.network.client` | ✅ | — |

That is an exact match for Xcode's own `macOS Safari Extension App` and
`macOS Safari Extension` templates, which set `ENABLE_APP_SANDBOX`,
`ENABLE_HARDENED_RUNTIME`, `ENABLE_USER_SELECTED_FILES = readonly`, and
`ENABLE_OUTGOING_NETWORK_CONNECTIONS` **on the app only**. The extension needs
no network entitlement: its fetches are made by Safari's own networking on
behalf of the web extension, not by the `.appex`, which exists only to host the
native-messaging handler. That was read off Apple's templates rather than
reasoned about — the templates are at
`/Applications/Xcode.app/Contents/Developer/Library/Xcode/Templates/Project Templates/MultiPlatform/Application/`.

**`LSApplicationCategoryType` was missing, and the archive said so.** The build
emitted `warning: No App Category is set for target`, and the archived
`Info.plist` had no category key. App Store Connect requires one. Fixed by
adding `INFOPLIST_KEY_LSApplicationCategoryType = "public.app-category.utilities"`
to both macOS App configurations — the idiomatic route here, since
`GENERATE_INFOPLIST_FILE = YES` and the plists on disk hold almost nothing. It
agrees with the *Utilities* category in § 3a. The warning is gone and the key is
in the archive.

**Signing for the store is not yet possible from this machine, and that is
normal.** The two identities present are `Developer ID Application` — which is
for distributing *outside* the store — and `Apple Development`. Neither is an
App Store distribution identity, and there are no provisioning profiles. The
local archive signs with `Apple Development`; Xcode's **Distribute App ▸ App
Store Connect** flow creates the distribution certificate and profile on
demand. Do not pass `-allowProvisioningUpdates` to a scripted build to force
this: it mints certificates in the developer account as a side effect.

**The version floors were the converter's, and they were wrong.** Raised to
**macOS 11.0** and **iOS 16.4**, from 10.14 and 15.0. The reasoning is specific
to this extension, so it is worth keeping:

- **MV3 alone is not the constraint.** Safari has supported `manifest_version: 3`
  since **Safari 15.4**, not 16.4 — an easy thing to misremember, and it was
  misremembered here first.
- **The constraint is the service worker's `import`.** `dist/safari/service-worker-loader.js`
  is one line — `import './assets/background.js-*.js';` — and Safari had a bug
  where a **background service worker failed to import scripts**, fixed in
  **Safari 16.4**. Below that the background worker plausibly never starts, which
  is the whole extension, not a degraded corner of it.
- **Safari 16.4 shipped for macOS Big Sur, Monterey and Ventura**, and as
  iOS/iPadOS 16.4. So macOS 11 is the oldest macOS that can reach a fixed Safari,
  and iOS 16.4 is exactly where the fix landed. Xcode independently recommends
  11.0 for macOS.

A deployment target cannot enforce a Safari version, so a Big Sur user who has
never updated Safari can still install and find it broken. The floor removes the
systems that *cannot* work; it cannot remove the ones that merely have not
updated.

### Both platforms, one record

`safari-web-extension-converter` produced iOS **and** macOS targets, and they
share the bundle identifier `org.bridge-classroom.bridge-classroom-fetch`, so
App Store Connect holds them as two platforms on one app record.

**Submitting only macOS misses the point of Safari.** Safari is the only browser
engine on iPad — there is no Chrome or Firefox to fall back on — which is the
argument in CLAUDE.md for why iPadOS punches above its share. Both are archived
for 1.1.0:

```bash
xcodebuild -scheme "Bridge Classroom Fetch (macOS)" -configuration Release \
  -archivePath /tmp/BCF.xcarchive archive
xcodebuild -scheme "Bridge Classroom Fetch (iOS)" -configuration Release \
  -destination "generic/platform=iOS" -archivePath /tmp/BCF-ios.xcarchive archive
```

Both succeed, both carry 1.1.0 build 1, and both bundle the extension's
`assets`, `icons`, `manifest.json` and `service-worker-loader.js`. The iOS
archive reports `MinimumOSVersion 16.4`; the macOS one `LSMinimumSystemVersion
11.0` and the Utilities category.

**iPad needs its own screenshots.** Apple requires iPad-sized images, and the
2560×1600 masters do not qualify — they are the Mac size. That is the one piece
of genuinely new work the iOS platform adds; see
[screenshot-set.md](screenshot-set.md) § iPad.

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
declared in `vite.config.js`, and it says
`required: ['personallyIdentifyingInfo', 'websiteContent']`.

It said `none` until 1.0.1, and that was wrong. `none` means "does not collect
or transmit any personal data", and the extension does transmit: `Player` is
`{ name, acbl_id, … }` — a real name and a national-body number — sent
off-device to `bridge-classroom.org` whenever the source is ACBL. There is no
server and no telemetry here, which is what made `none` feel right; but
"collect" in every store's sense means *leaves the device*, not *reaches us*.
The same mistake was made on Chrome's disclosure and corrected there too — see
[submission-answers.md](submission-answers.md) § Data use, which is the longer
version of this note. Keep the three in step.

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
| Host: `tinyurl.bridgebase.com` | BBO's lobby mints a short link rather than handing over a deal — its Export ▸ Handviewer menu produces one — so the redirect must be followed to reach what it points at. Used only to resolve those links. |
| Content script on `bridge-classroom.{org,com}` | Delivering the results to the page the user is taken to, which then forwards them to the chosen tool. No host permission is requested for these domains — the content-script match is sufficient. |

**Paste-ready wording for every field is in [submission-answers.md](submission-answers.md)**, kept in step with this table.

### Tightening candidates — deferred again, to 1.2.0

Audited after submitting 1.0.0. **None of these were changed at the time**:
Chrome had 1.0.0 in review, and editing the manifest would have meant either
resubmitting Chrome — restarting the review clock — or shipping the other three
stores a different 1.0.0 than Chrome was reviewing. Parity was worth more than
a tightening that changes no user-visible behaviour.

**Still not done in 1.1.0, and this time the reason is different.** The note
below says both belong in a version bump, and 1.1.0 is one — so it was
considered rather than overlooked. Against it: 1.1.0 is already resubmitting to
four stores at once, both changes rewrite justification text that has been
through review once, and both want a QA pass on all four browsers to prove
nothing regressed. Neither is visible to a user. Adding that to a release whose
purpose is to get the ACBL Live fix out is spending risk on tidiness.

They go in **1.2.0**, on their own, where a four-browser pass is the whole job
and a rejection costs nothing else.

**`tabs` can be dropped.** Verified empirically, not inferred: built without it,
loaded the extension, opened a `www.bridgebase.com` tab, and called
`chrome.tabs.query({url: 'https://www.bridgebase.com/*'})` from the service
worker. It matched the tab and `tab.url` was populated, because the `url` filter
is honoured given *either* the `tabs` permission or host permissions for the
tab — and we hold the latter for every origin the query is ever built from
(`fetchViaTab` derives the pattern from the URL it is fetching).

Everything else `tabs` is used for needs no permission at all: `create`,
`remove`, `sendMessage`, and `onUpdated` reading `changeInfo.status` — only
`url`, `title` and `favIconUrl` on that event are gated.

**Host permissions are broader than the code uses**, on BBO in particular. The
content-script matches are already path-scoped; the host permissions were never
narrowed to agree with them.

| Declared | Actually fetched |
|---|---|
| `https://www.bridgebase.com/*` | `/myhands/hands.php`, `/myhands/fetchlin.php`, `/tools/handviewer.html`, and `/v3/*` for the lobby content script |
| `https://webutil.bridgebase.com/*` | `/v2/tview.php` only |
| `https://tinyurl.bridgebase.com/*` | redirect resolution only — already effectively narrow |
| `https://live.acbl.org/*` | `/event/*` |
| `https://my.acbl.org/*` | `/club-results/*` |

The two ACBL hosts are SPAs building URLs dynamically, so narrowing those wants
testing rather than a confident edit. The BBO ones are safe to scope by path.

Doing both would reduce what the listing warns users about and reads well in a
re-review. Neither changes behaviour, so both belong in a version bump rather
than a hurried resubmission.

### Before submitting

- ~~Remove `http://localhost:3001/game-analysis/*` from `host_permissions`.~~
  Done — removed when the `/game-analysis/` hand-off was retired. Local
  development uses the `devIngestUrl` override **plus the `INGEST_TEST=1`
  build**: the override only says where to send the payload, and the content
  script that delivers it matches `bridge-classroom.{org,com}` alone. This
  entry, README.md and CLAUDE.md all used to claim the override was sufficient
  on its own. It is not, and the failure is silent — the hand-off hangs on a
  page with nothing listening.
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

**~~Version number~~ — 1.1.0.** Four places carry it, and they are not all the
same string by default:

| Where | Note |
|---|---|
| `manifest.json` | canonical; `PROVIDER.version` reads it, so the payload follows |
| `package.json` + lock | `npm version 1.1.0 --no-git-tag-version` |
| Xcode `MARKETING_VERSION` | eight occurrences in `project.pbxproj` — four targets × two configurations |
| Xcode `CURRENT_PROJECT_VERSION` | build number, at 1; bump per Safari **upload**, not per release |

**A minor, not a patch, and the number had to move.** 1.0.0 was the first public
release; 1.0.1 corrected the Firefox data declaration and went to AMO on 11
August. Everything in PRs #5–#9 landed on the 12th and 13th — *after* that
upload — so the working tree and the build in AMO's queue were both calling
themselves 1.0.1 while differing by a removed feature. That alone forces a bump.
1.1.0 rather than 1.0.2 because the ACBL Live date-range batch was removed and
replaced with per-row links, the pair picker is new, section coverage narrowed
to the user's own, and the envelope went 1.1 → 1.4 — 1.2 for those
changes, then 1.4 for the two ACBL E-W seat-order fixes, which a consumer must
branch on to read anything a released build already produced. 1.3 is skipped
deliberately: Bridge Classroom's ingest door already stamps it on envelopes
whose players it corrected and whose double-dummy table it did not, so a
producer must never publish it (seat-order-contract.md § Consumer rule).

**Bump `MARKETING_VERSION` in `project.pbxproj`, not with agvtool.** There is an
`agvtool new-marketing-version`, and on this project it does nothing useful: it
substitutes `CFBundleShortVersionString` in the four `Info.plist`s, which do not
contain that key — Xcode generates it from the build setting — and it leaves
`MARKETING_VERSION` alone. It reports "Updated …" for each plist regardless, so
it looks like it worked. `sed -i '' 's/MARKETING_VERSION = 1.0.1;/MARKETING_VERSION = 1.1.0;/g'`
over `project.pbxproj` is what actually moves it; expect eight hits.

The **build** number is agvtool's, and that command does work:

```bash
cd "safari/Bridge Classroom Fetch"
xcrun agvtool new-version -all 2      # what-version -terse to check
```

That updates all four targets across both configurations and leaves
`MARKETING_VERSION` alone — which is exactly why it cannot be used for the
marketing version. Only `project.pbxproj` changes.

**1.1.0 goes up as build 1**, since nothing has ever been uploaded to App Store
Connect. Connect refuses a second upload reusing a build number, so bump to 2
only when re-uploading against 1.1.0 after a rejection.

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

**On iPhone and iPad the extension does nothing until website permission is
granted, and nothing says so.** Enabling it in Settings is only half the job;
Safari grants page access per site, separately, and until then no content script
runs. There is no prompt unless the user opens the page menu, no console error,
and no visible difference from a broken build.

Confirmed on a real iPhone, iOS 26.6, August 2026 — and it is not the same
journey on the two devices, which is what made it confusing:

| | iPad | iPhone |
|---|---|---|
| Extensions button | puzzle-piece, directly in the toolbar | none — folded into the page menu |
| Address bar | top | usually **bottom** |
| How the extension surfaces | visible immediately | a warning indicator inside the page menu |

Someone who has granted it on an iPad will look for a puzzle-piece on the phone
and not find one, and reasonably conclude the extension did not install. The
Apple reviewer notes in [submission-answers.md](submission-answers.md) walk
through the iPhone route explicitly for exactly this reason.

**The extension appears to do nothing on unsupported pages.** By design: the
button only injects on recognised result pages. A reviewer opening
`bridgebase.com` generally will see no UI. Say so explicitly in the notes.

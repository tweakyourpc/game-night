# Game Night: implementation plan

*Status: in progress since 2026-10-11. Revision 2, below, supersedes the original plan
where they differ.*

A reusable, independently installable multiplayer tabletop platform, built from the
Crabbles project source. Each installation is a separate Google Sheet, Apps Script
project and web app. The live Crabbles deployment is reference material only: this
project never pushes to it and never reads or writes its spreadsheet.

## Revision 2: decisions and build order

**Names:**
- Platform: **Game Night**. Code licence: **MIT**.
- The word game is **Wordwright**: the public name for the Crabbles rules. Its
  internal game id `wordwright` is new, because nothing from the live instance is
  migrated.
- Display names come from configuration (`src/config/names.js`).

**Games:**
- Wordwright (ported)
- then, in this order: **Four in a Row**, **Dots and Boxes** (2-4 players),
  **Checkers** (American / English draughts), and a **five-dice scorecard game**
  (display name configurable, default **"Fivefold"**)

**Artwork excluded from the kit:**
- the 1948 board photograph
- **all** raster letter-tile pictures: both the photographed tiles and the generated
  birch tiles

Tiles are drawn as SVG from theme colours. The CRABBLES board and its three variants
stay as optional Wordwright boards; there's also a procedural board that needs no
artwork. A build-time check refuses known excluded files.

**What doesn't exist yet:** the repository started with only this plan. The lobby,
tables, invitations and Meet that the game requirements build on are written here
first.

**Build order:**
1. Platform core (server): store, identity and sessions, group settings, tables,
   matches (generic commit rule with follow-ups), sync, outbox, maintenance, replay
   builder. Simulated-service tests, including fault injection and fresh-install
   tests.
2. Client shell: entry, lobby, tables, match frame, themes (Walnut Parlor, Slate
   Study), sound, poller, metrics, invitations, Meet.
3. Wordwright on the platform: the Crabbles rules ported with their tests, SVG tiles,
   optional boards, dictionary service, score preview.
4. Four in a Row → Dots and Boxes → Checkers → Fivefold: each with rule tests,
   integration tests (convergence, stale, duplicate, reconnect, completed), and
   browser checks at desktop and phone widths in both themes.
5. Replay playback, then capability-detected export, plus the EffectCraft converter
   with its own drawn tiles.
6. Docs (README, install, clasp, troubleshooting, identity, authoring, per-game How to
   Play), PDFs regenerated from their HTML sources, `dist/` build, release ZIP, and
   verification scans (old branding, excluded artwork, live ids, tokens, personal
   data).

Real Apps Script deployment checks are separate from simulated tests and happen only
after you push to the new instance.

---

## 0. Findings from the current source

`SCRABBLE_ONLINE`: 75/75 tests pass. Fault injection against that code found two
recovery bugs. Both are fixed here first.

| Fault after a move is saved | What happens now | Fix in this kit |
|---|---|---|
| Statistics write fails | The move stands and the retry returns `duplicate`. Stats are **never recorded**, the move **never reaches the log**, and maintenance only repairs emails. | Post-commit work becomes idempotent **follow-ups**, tracked by `doneRev`. Retries and maintenance re-run them, and stats are recomputed from finished matches rather than incremented. |
| Revision-cache write fails | The sheet is at revision 1, but `poll` reports revision 0 from the stale cache **for up to 6 hours**. | The cache entry is **invalidated before** the commit and written after it. A failed write leaves a cache miss, and a miss reads the sheet. Short TTLs (60 s). |
| Moves-log append fails | Same as statistics: never repaired. | The log is rebuilt from the match's own event list, and appends are idempotent per `(match, seq)`. |

Other inherited issues are also addressed:
- player keys are stored in plaintext in the Players sheet (they'll be hashed)
- game creation and the "first move" have no table concept
- a single `Assets.html` mixes theme and game artwork
- `setup_` assumes a standalone script

---

## 1. Concepts and data structures

All durable state lives in the installation's own spreadsheet. CacheService holds only
hints (revisions, presence), and everything works if the cache is empty.

### Sheets (one tab each; headers created by setup, then migrated by schema version)

**Settings** (`key`, `value`)

| key | meaning |
|---|---|
| `install_id` | Random id made at setup; used to detect copied installations |
| `schema_version` | Data layout version, for upgrade migrations |
| `group_name` | Shown on the entry screen and in invitations |
| `entry_code` | The group passcode (plaintext, visible to admins and members inside the lobby) |
| `identity_mode` | `trusted` (pick your name) or `pin` (each member has a personal PIN); see §5 |
| `turn_emails` | `no` / `yes` |
| `default_theme` | Theme id for new tables |
| `asset_base_url` | Optional: where theme artwork is served from in copy/paste installs (§6) |

**Members**

| column | |
|---|---|
| `id` | Stable member id (never reused) |
| `name` | Display name (unique, case-insensitive) |
| `email` | Optional; only for invitations and optional emails |
| `role` | `admin` or `member`. The installer becomes the first admin. |
| `pin_hash` | Salted SHA-256 hash; only used in `pin` mode |
| `avatar` | Drive file id |
| `status` | `active` or `removed` |
| `created` | |
| `stats` | JSON, **derived** (recomputed from finished matches; never incremented in place) |

**Sessions** (one per device; this is what a browser holds)

| column | |
|---|---|
| `token_hash` | SHA-256 of the session token. The token itself is **never stored**. |
| `member_id` | |
| `created`, `last_seen` | |
| `label` | e.g. "Chrome on Android" |
| `revoked` | |

**Tables** (a gathering that outlives its matches)

| column | |
|---|---|
| `id` | |
| `share_key` | Random, used in table links. **Not** an authentication token. |
| `title` | |
| `host_id` | |
| `game_id` | e.g. `crabbles` |
| `theme_id` | |
| `options` | JSON: `{ autostart: false, invite_only: false, game_options: {} }` |
| `seats` | JSON: `[{ member_id, ready, joined_at }]`, in seating order |
| `invited` | JSON: member ids and emails invited |
| `meet_url` | Optional, `https://` only |
| `status` | `open` (gathering), `playing`, or `closed` |
| `current_match_id` | |
| `match_count` | |
| `rev`, `created_action` | `rev` for revision checks; `created_action` makes create retry-safe |
| `created`, `updated` | |

**Matches** (one game's authoritative state)

| column | |
|---|---|
| `id` | `<tableId>-<n>`: **deterministic**, so starting a match is retry-safe |
| `table_id` | |
| `game_id`, `game_version`, `rules_version` | |
| `theme_id` | |
| `players` | JSON: `[{ member_id, name }]`, display names snapshotted at the start |
| `status` | `active`, `finished`, or `abandoned` |
| `rev` | |
| `state` | JSON, the game's own (private) state |
| `result` | JSON: `{ winners: [ids], ranking?, scores?, adjustments: [...] }` |
| `actions` | JSON, the last 40 action ids, for duplicates |
| `done_rev` | Follow-ups completed through this revision |
| `created`, `updated` | |

**Events** (public, append-only; replays and logs come from here)

| column | |
|---|---|
| `match_id`, `seq` | Idempotent key |
| `rev` | |
| `actor` | |
| `type` | |
| `public` | JSON, only what every player may see |
| `at` | |

**Outbox** (as today: idempotent keys, claimed under the lock, sent outside it,
exponential backoff). Big video files never go here or in CacheService.

### Commit rule (every mutation: tables, matches, membership)

1. Take the script lock, then `store.refresh()`.
2. Authenticate the session, then authorize the action (member, host, admin, or seated
   player).
3. If `actionId` is already recorded, return the stored result (`duplicate: true`) **and
   re-run follow-ups**.
4. If `expectedRevision` doesn't match, return `STALE` with the fresh view. Nothing is
   written.
5. Invalidate the cache hint, apply on a copy, write the row (**the commit point**),
   and record `actionId`.
6. **Follow-ups**, each idempotent:
   - append events by `(match, seq)`
   - recompute the stats of affected members from finished matches
   - queue emails by key
   - publish the cache hint

   Then set `done_rev = rev`.
7. Release the lock, then send mail and do any Drive work.

A 10-minute maintenance job (optional trigger), plus every request opportunistically
(bounded), re-runs follow-ups wherever `done_rev < rev`.

**Starting a match** creates `Matches[<tableId>-<n+1>]` if absent, then updates the table.
If the table update fails, the retry finds the match and finishes the table update. A
second start of the same `n` never makes a second match.

---

## 2. Game interface (`src/games/<id>/`)

A game is two plain-JavaScript objects with no Apps Script calls, so they run in Node
tests, in Apps Script, and in the browser.

```js
// rules.js: runs on the server (authoritative) and in Node tests
var GAME = {
  id: 'checkers', name: 'Checkers', version: '1.0.0', rulesVersion: 1,
  players: { min: 2, max: 2 },                 // never assumed by the platform
  options: [],                                 // declared options, validated by the platform
  setup: function (ctx) {},                    // ctx = {players:[ids], options, rng, services} -> state
  actors: function (state) {},                 // ids allowed to act now ([] when over); simultaneous play allowed
  legal: function (state, playerId) {},        // optional list of legal actions, for hints and bots
  apply: function (state, playerId, action, ctx) {},
      // -> {ok:false, error} | {ok:true, state, events:[{type, public}], result?}
      // must validate; the platform passes a copy; result present = game over
  view: function (state, viewerId) {},         // what this viewer may see (null = spectator)
  summary: function (state, players) {},       // one line for the lobby ("Ann 120 · Bob 98" or "Ann to move")
  replayInit: function (players, options) {}   // the public starting position for replays
};
```

```js
// ui.js: runs in the browser
var GAME_UI = {
  mount: function (el, view, api, theme) {},   // render into el; api.act(action) sends an action
  update: function (view, prevView) {},
  dispose: function () {},
  replay: {                                     // canvas playback, shared by preview and video export
    duration: function (events) {},
    draw: function (ctx, events, t, theme) {}
  },
  sounds: { /* e.g. place: 'tile', capture: 'clack' */ }
};
```

Nothing assumes scores, turn rotation, or player counts:
- `actors` can stay the same player (multiple jumps in checkers, extra turns in dots
  and boxes) or list several players at once.
- `result.scores` is optional.
- `players.min/max` is per game.

**Crabbles** becomes `src/games/crabbles/` (the current `Rules.js`, unchanged in
behaviour, plus an adapter). The dictionary is a platform service (`ctx.services.dict`).

**Second game: Checkers** (recommended over dots and boxes). It exercises:
- exactly 2 players
- no scores
- multi-jump turns where the same player keeps acting
- forced captures
- a different board geometry

Chess comes later, on the same interface.

---

## 3. Themes (`src/themes/<id>/theme.json` + artwork)

A theme controls looks only and never touches rules. It's versioned:

```json
{
  "id": "walnut", "name": "Walnut Parlor", "version": "1.0.0", "schema": 1,
  "colors": { "bg": "#1d1712", "panel": "#2a2119", "ink": "#f4ead8", "muted": "#b9a88f",
              "accent": "#d9a956", "good": "#7fc28a", "bad": "#e0796b", "line": "#4a3b2d" },
  "fonts": { "display": "Cinzel", "body": "system-ui", "files": ["Cinzel.ttf"] },
  "textures": { "table": "felt.webp", "panel": null },
  "borders": { "radius": 10, "frame": "walnut-frame.webp" },
  "controls": { "button": "raised", "focusRing": "#d9a956" },
  "sounds": { "place": "synth:wood-tap", "invalid": "synth:thud", "turn": "synth:chime", "win": "synth:arpeggio" },
  "games": {
    "crabbles": { "board": "crabbles-maple.jpg", "grid": "crabbles.grid.json", "tiles": "tiles-birch/" },
    "checkers": { "board": "procedural", "light": "#e9c99a", "dark": "#7a4a2a", "pieces": ["#f1e3c8", "#3a241a"] }
  }
}
```

- **Shared components** (buttons, cards, seat chips, dialogs, the lobby, toasts) only
  read CSS variables generated from `colors`, `fonts`, `borders` and `controls`.
- **Game artwork** is optional per game. A game falls back to procedural drawing in
  theme colours, so any theme works with any game.
- **Proof of reuse:**
  - two games, one theme: Crabbles and Checkers in **Walnut Parlor**
  - one game, two themes: Crabbles in **Walnut Parlor** (the Maple board) and in
    **Slate Study** (the slate board), and Checkers in both
- **Sounds:** synthesised with WebAudio by default, so there are no audio files to
  license. A theme may name audio files instead.

`tools/build_themes.mjs` packs every theme into `dist/apps-script/Theme_<id>.html`
(data URLs), checks the schema and size, and writes `dist/themes/<id>/` (plain files for
URL hosting).

---

## 4. Lobby, tables, invitations, Meet, sound

- **Entry:**
  - the group code, then identity: in `trusted` mode tap your name or add one; in `pin`
    mode, name plus PIN
  - this creates a **session** for the device
  - the URL never carries a session token; the token lives in `localStorage` and is
    sent with each call
- **Lobby:**
  - the game catalogue (each game with its player range and available themes)
  - open tables (host, game, theme, seats filled, invited, Meet icon)
  - ongoing matches (spectate later)
  - who's here (presence, cache only)
- **Tables:**
  - create, which is retry-safe through `created_action`
  - take or leave a seat, toggle ready
  - invite members or emails
  - host-only: start, change game or theme, transfer host, close
  - optional autostart, explicitly off by default
  - starting requires the seat count to be within the game's range and everyone
    seated to be ready
  - **losing presence never removes a seat or moves the host**
  - after a match ends, the table returns to `open` with the same seats and Meet link,
    showing **Rematch**, **Change game** and the previous matches
- **Table links:** `…/exec?t=<share_key>`. Opening one enters the group (code if
  needed), then the table.
- **Copyable invitation text** (email, chat, Meet chat): the group name, what's being
  played, the table link, and **optionally** the code, with a checkbox that's off by
  default. **Never a session token.**
- **Email invitations** go through the outbox.
- **Meet:**
  - the host pastes a link; the platform accepts `https://meet.google.com/...` and
    warns on other `https://` links
  - a **Join call** button opens it with `window.open(url, '_blank', 'noopener')` from a
    click
  - the game doesn't depend on the call
  - automatic Meet creation is listed as future work (it needs the Calendar or Meet
    API and a different deployment model)
- **Sound:** on/off and volume in the header, stored per device in `localStorage`,
  muted by default until the first click (browser autoplay rules).
- **Polling:**
  - one scheduler, as today: never overlapping, generation-guarded, faster with
    others present, slower when idle or in the background, refreshing on focus
  - the lobby uses a group-level revision hint
  - unfinished input (placed tiles, a partial checkers move) is kept across refreshes
    and `STALE` replies
  - `?debug=1` shows timings; the server logs one line per call

---

## 5. Identity model (explicit product choice)

| | `trusted` (default, like Crabbles today) | `pin` |
|---|---|---|
| Entry | Group code, then tap your name | Group code, then name and personal PIN |
| Protects against | Outsiders without the code | Members using each other's names |
| Weakness | Anyone with the code can pick any name | PINs can be forgotten (an admin can reset them) |
| Session | A per-device token (hashed in the sheet), revocable by admins | Same |

Not offered: Google sign-in per player. With "execute as me" and "Anyone" access, Apps
Script can't reliably tell who the visitor's Google account is. Doing that needs
"execute as user", which would give every player access to the spreadsheet and so
expose hidden information. This is documented in `docs/identity.md`.

---

## 6. Installation approach

**Primary: browser only, from a template spreadsheet.**

1. The maintainer publishes a **template Google Sheet** containing a **bound** Apps
   Script project (prebuilt files from `dist/apps-script/`) and empty tabs. Copying a
   Sheet copies its bound script.
2. The installer opens the maintainer's `…/copy` link and chooses **Make a copy**.
3. In their copy: **Game Night ▸ Set up this copy** (a custom menu). Google asks for
   authorisation (the guide explains the unverified-app screen). Setup:
   - **detects a copied install** by comparing the stored `install_id` and sheet id with
     the active spreadsheet
   - **wipes** anything inherited: properties, sessions, members, tables, matches,
     events, outbox, the code, setup flags
   - creates fresh Drive folders, a new `install_id`, and the admin's first session
   - asks for the group name and code
   - makes the installer admin
4. Then deploy (copying a Sheet does **not** deploy anything): **Extensions ▸ Apps
   Script ▸ Deploy ▸ New deployment ▸ Web app**, with **Execute as: Me** and **Who has
   access: Anyone**. Copy the URL.
5. Paste the URL into **Game Night ▸ Finish setup**, which stores it for invitation
   links. Open the URL and share it and the code.

**Fallback: copy/paste.** For people who can't use the template.
- Create a blank Sheet, then **Extensions ▸ Apps Script**.
- Create each file listed in `dist/apps-script/MANIFEST.txt` and paste in its contents
  (about 10 files).
- Turn on "Show appsscript.json" and paste that too.
- Then do steps 3 to 5.

Large artwork isn't pasted: themes load their pictures from `asset_base_url`, which
defaults to the versioned GitHub release via jsDelivr. The guide doesn't call this a
"ZIP import"; it's plain file creation in the editor.

**Developers: clasp (optional).**
- `npm run new-instance` runs `clasp create --type sheets --title "<name>"` to make a
  **new** Sheet and bound project, and writes a fresh `.clasp.json`.
- `npm run build && clasp push`.
- No `.clasp.json` is distributed: `.gitignore` excludes it, and
  `.clasp.json.example` documents the format.

**Upgrades** keep data:
- Replace the script files (paste, or `clasp push`), then **Deploy ▸ Manage
  deployments ▸ Edit ▸ New version**, which keeps the URL.
- On first use, `schema_version` runs idempotent migrations.
- Data and settings live in the sheet and script properties, so they survive.

---

## 7. File-level layout (new repository)

```
game-night/
  README.md  LICENSE  NOTICE.md (attribution inventory)  VERSION  CHANGELOG.md
  package.json            build/test scripts (developers only)
  .clasp.json.example     .gitignore (excludes .clasp.json, build/, data/)
  src/
    platform/             server, plain JS (shared global scope as in Apps Script)
      Store.js            sheet adapter: table schemas, memo, refresh, idempotent append
      Identity.js         group code, members, sessions (hashed), roles, PIN mode
      Tables.js           create/seat/ready/invite/host/meet/start/rematch/close
      Matches.js          generic commit rule around GAME.apply, follow-ups, view
      Replay.js           replay v1 builder (public events + snapshots + adjustments)
      Outbox.js           queue/claim/send/backoff (from Crabbles)
      Maintenance.js      follow-up repair, table expiry, stats recompute
      Catalog.js          game and theme registry
      Api.js              public actions, argument limits, the commit wrapper
    appsscript/           Apps Script only: Server.js (doGet, call, menus, setup, Drive/Mail/Cache adapters), appsscript.json
    client/               Index.html, Shell.html (lobby, tables, dialogs, sound, poller, metrics), Style.html (theme variables)
    games/crabbles/       rules.js (from Rules.js), adapter.js, ui.js, replay.js, assets (grid)
    games/checkers/       rules.js, ui.js, replay.js
    themes/walnut/ themes/slate/      theme.json + artwork
  tools/
    build.mjs             src -> dist/apps-script (concatenated .gs and html, manifest, version stamp)
    build_themes.mjs      themes -> Theme_<id>.html and dist/themes/
    make_tiles.py make_boards.py calibrate_board.py   (from Crabbles; contributor tools)
    dev_server.js         local preview with simulated services
    new_instance.mjs      fresh clasp association (wraps clasp create --type sheets)
    replay_to_recipe.mjs  replay v1 -> EffectCraft render_game recipe (compatibility)
  test/
    fake/appsscript.js    simulated SpreadsheetApp/Cache/Lock/Mail/Drive/Properties/Ui/ScriptApp,
                          including "copy the spreadsheet" (properties and data copied) for fresh-install tests
    platform/*.test.js    identity, tables, matches, follow-ups and fault injection, outbox, polling contract
    games/*.test.js       crabbles (the existing 75 tests ported), checkers rules
    install/*.test.js     fresh install, copied template, re-run setup, upgrade migration
  dist/                   prebuilt release files (committed on release tags)
    apps-script/          the files to paste or push, MANIFEST.txt
    themes/
  docs/
    PLAN.md (this file)  install.md (browser-only, primary)  clasp.md  troubleshooting.md
    identity.md  game-authoring.md  theme-authoring.md  replay-format.md  upgrading.md
    licenses.md (inventory: code, fonts, word list, artwork, sounds)
```

---

## 8. Replay format v1 (`docs/replay-format.md`)

```json
{
  "format": "tabletop-replay", "version": 1,
  "game": { "id": "crabbles", "version": "1.0.0", "rulesVersion": 1 },
  "theme": { "id": "walnut", "version": "1.0.0" },
  "match": { "id": "t8f2-3", "table": "t8f2", "started": "...", "ended": "..." },
  "players": [ { "id": "m1", "name": "Ann" }, { "id": "m2", "name": "Bob" } ],
  "options": {},
  "initial": { },
  "events": [ { "seq": 1, "actor": "m1", "type": "play", "public": { } } ],
  "final": { "status": "finished", "winners": ["m1"], "scores": { "m1": 245, "m2": 198 },
             "adjustments": [ { "player": "m2", "points": -7, "reason": "unplayed tiles" } ] }
}
```

- Stable player ids and display names snapshotted at the start.
- Final adjustments are explicit, never inferred.
- No hidden information.
- `tools/replay_to_recipe.mjs` converts Crabbles replays to the current `render_game.py`
  recipe (`mode: game`), so the EffectCraft workflow keeps working.

**Browser playback:** play, pause, scrub and speed, using `GAME_UI.replay.draw` on a
canvas.

**Export**, after detecting what the browser supports:
- **WebCodecs** (`VideoEncoder` with H.264, plus a pinned MP4 muxer from a CDN)
- **MediaRecorder** (`isTypeSupported` picks MP4 or WebM, in real time, and only while
  the tab is visible)
- otherwise **no export**, with a message and the recipe download as the alternative

There's no promise of background encoding or universal MP4. Delivery is a direct
download where the sandbox allows it, otherwise a chunked upload to temporary **Drive**
files (never CacheService), assembled into `videos/`.

---

## 9. Stages and acceptance criteria

| Stage | Delivers | Accepted when |
|---|---|---|
| **1. Reliability and isolated instance** | New repo; the Crabbles source ported; follow-ups with `done_rev`; cache invalidated before commit; derived stats; hashed session tokens; bound-script setup with copy detection; `new_instance.mjs`; fake services that can copy a spreadsheet | All 75 original tests pass after porting. New fault-injection tests cover statistics, event logging and cache publication failing, then retry or maintenance repairing everything **exactly once** (stats counted once, one event row per seq, one email per key). A simulated template copy re-initialises with a new `install_id`, empty members and sessions, and no inherited code or flags. Setup run twice is harmless. |
| **2. Platform, themes, lobby, tables (Crabbles)** | Platform services; catalogue; Walnut and Slate themes; lobby; persistent tables; Crabbles as a registered game | Tables survive matches (rematch and change game keep seats and Meet). Two people taking the last seat yields one winner. Start respects game min/max and readiness; autostart is opt-in. Presence loss never removes seats or moves the host. Match start is retry-safe across "match created, table update failed". Browser check: two sessions converge, lobby polling never overlaps, unfinished input survives. |
| **3. Invitations, Meet, sound** | Share links, invitation text, email invites through the outbox, Meet link and button, sound controls | Invitation text and links contain no session token (scanned in tests). Meet opens only from a click, in a new tab, and the game works without it. Mute and volume persist per device. Sound starts only after a user gesture. |
| **4. Second game (Checkers)** | `games/checkers` on the same interface | Rules tests: forced capture, multi-jump with the same actor, promotion, no legal moves = loss, 2 players exactly. Checkers and Crabbles share one theme; Checkers renders in two themes. No platform code branches on the game id. |
| **5. Replay, then export** | Replay v1 builder; browser playback; capability-detected export; Drive chunk upload; EffectCraft converter | Replays contain no hidden fields (tested). Playback matches the final position. Export is offered only when supported. Chunks go to Drive temporary files and are cleaned up. The converted recipe renders with the existing `render_game.py`. |
| **6. Install kit and release** | `dist/` prebuilt files; template preparation; docs; licence inventory; `v0.1.0` release ZIP | **Simulated:** a clean install from `dist/` in the fake services, the template-copy scenario, and an upgrade migration. **Real:** you push to a new instance, deploy the web app, and run through the browser-only guide in a fresh Google account or a second copy. I check the live page in Chrome and report each guide step that didn't match. |

At each stage I'll report what was built, the test results, the browser checks, and
what remains.

---

## 10. Limits and risks to agree on now

- **I can't complete Google's authorisation or deployment steps for you.** "Real
  deployment" checks happen after you push and deploy. I can then test the live page.
- **Template sheet.** Whether Script Properties are copied along with a Sheet isn't
  something I'll rely on: setup detects a copy by comparing ids and resets regardless.
- **jsDelivr** for artwork in copy/paste installs depends on a public GitHub release.
  Template and clasp installs embed artwork and don't depend on it.
- **Artwork rights.**
  - Ships in the public kit: the CRABBLES board (yours; you confirm the licence), the
    generated tiles and board variants, and Cinzel (OFL).
  - Kept out of the public kit: the 1948 board photograph and its tile photos, whose
    source and rights are unknown. They can stay in your private instance.
  - The ENABLE word list is public domain. Setup downloads it rather than bundling it.
- **Names.** "Crabbles" is close to a trademark (noted earlier). Consider a different
  public name for the kit's demo game.
- **Apps Script quotas.** Busy lobbies polling every few seconds add up. The optional
  Firebase signal design from Crabbles carries over.

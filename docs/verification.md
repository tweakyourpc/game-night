# Local verification and handoff

## Verified locally

- `npm test`: all 13 test files pass. With test isolation disabled to report individual cases, 184/184 pass, zero skipped. Original Crabbles baseline: 75/75 tests pass from the adjacent source checkout, read-only. Wordwright's rule suite passes 28/28, including two new resignation cases.
- Packaged browser bundle (`dist/apps-script`) opened in headless Chrome. All five games displayed instructions, created and started a table, resisted an injected stale pre-start poll, rendered in Walnut and Slate at 1280px and 390px, and downloaded replay JSON. Wordwright's tap and drag rack sorting and an out-of-turn resignation were exercised in the packaged browser check.
- Recorder construction failure was injected in the browser. The game and replay export remained available; browser tests also checked poll overlap and discarded results from a stopped poll generation.
- Five How to Play PDFs were regenerated from each `howto.html` plus the game preview. Each is one US Letter page. The print tool now writes the PDFs directly and reserves the header area for the preview. Every final PDF was rendered and inspected; the Wordwright text matches the rack, resignation, and normal finish rules, and the Fivefold dice preview is readable.
- `npm run build` emits the Apps Script bundle and `dist/game-night-v0.1.0.zip`. The build compiles scripts, audits source raster files and encoded image payloads, preserves notices, and reopens/scans the ZIP.
- The copied-project fake tests check inherited IDs before setup and distinct sessions after setup. The font and OFL are byte-identical to the supplied project copies; OFL also matches Google Fonts' authoritative bytes.

## Wordwright computer opponent (2026-10-12)

- `workspace-quality-gate` passed: 190 individual tests, Apps Script bundle build, and release content audit.
- The packaged browser passed `tools/bot-browser-check.mjs` at 1280px and 390px. It created a private computer table, refreshed during the computer's turn, observed the committed move, and checked the replay. The full five-game packaged browser check also passed at both widths.
- Tests cover opening, extension, crossing, blanks, exchange/pass, bounded search, duplicate and stale calls, word-list failures, rematch restrictions, replay events, and rack privacy.
- The bound test Apps Script project received the seven packaged files. Version 7 was created and the existing test web app deployment was updated to version 7; clasp confirmed that mapping. A cold bot turn has **not** yet been benchmarked in that real deployment. Do not treat local harness timing as this release gate or publish a new GitHub release until the benchmark is complete.

## Google state

A separate spreadsheet and bound Apps Script project were created with clasp. Version 4 was configured as a web app with anonymous access and execution as the deploying account. An initial public smoke check returned HTTP 403. The owner subsequently reported successful setup, administrator sign-in and a second player signed in on a phone. Those are user-reported smoke results, not completion of the full Google acceptance suite. The original 403 cause was not independently established. The deployment does not use the existing Crabbles instance. Keep the [Google acceptance checklist](google-acceptance.md) pending until each item is actually tested, using the [operator checklist](operator-checklist.md) to organize testing.

The existing local commit was not rewritten. No existing Crabbles deployment was accessed.

## Release accuracy

The runtime now includes local Wordwright rack sorting, resignation and clearer early-end wording. This changes `Code.gs` and `Index.html` from the earlier reviewed release candidate, so that archive comparison no longer applies. The rebuilt release ZIP is audited after packaging and must be reviewed before any GitHub upload.

Remaining Crabbles/Scrabble references identify the supplied rules source, historical design record, excluded-image fingerprints, or artwork provenance. The current public game name is Wordwright. `docs/PLAN.md` preserves superseded proposals and is excluded from the installation archive. Synthetic players, emails, tokens and game state in source tests and the local harness are development fixtures, not installation data; tests, harness, private clasp bindings and local verification captures are excluded from the ZIP.

Automatic Meet creation, replay-file import UI, WebCodecs export, timed session expiry, automatic game archival and cross-instance data migration are not implemented. See [README limitations](../README.md#limits), [replay format](replay-format.md), and [identity](identity.md). Custom board attribution remains unresolved as described in [licences](licenses.md).

# Local verification and handoff

## Verified locally

- `npm test`: all 13 test files pass. Running each case individually reports 181 tests, zero skipped. Original Crabbles baseline: 75/75 tests pass from the adjacent source checkout, read-only. Wordwright's carried-over rule suite: 26/26 passes.
- Packaged browser bundle (`dist/apps-script`) opened in headless Chrome. All five games displayed instructions, created and started a table, resisted an injected stale pre-start poll, rendered in Walnut and Slate at 1280px and 390px, and downloaded replay JSON.
- Recorder construction failure was injected in the browser. The game and replay export remained available; browser tests also checked poll overlap and discarded results from a stopped poll generation.
- Five How to Play PDFs were regenerated from each `howto.html` plus the game preview. Each is one US Letter page. Every page was rendered and visually inspected; text extraction found current names/rules and no old branding/placeholders.
- `npm run build` emits the Apps Script bundle and `dist/game-night-v0.1.0.zip`. The build compiles scripts, audits source raster files and encoded image payloads, preserves notices, and reopens/scans the ZIP.
- The copied-project fake tests check inherited IDs before setup and distinct sessions after setup. The font and OFL are byte-identical to the supplied project copies; OFL also matches Google Fonts' authoritative bytes.

## Google state

A separate spreadsheet and bound Apps Script project were created with clasp. The current deployment is version 4 and its entry point is configured as a web app with anonymous access and execution as the deploying account. A public smoke check returned HTTP 403 before the owner completed setup and authorization. The owner must open the spreadsheet, run **Game Night → Set up this spreadsheet…**, and complete Google authorization before players can sign in. The deployment does not use the existing Crabbles instance. The [Google acceptance checklist](google-acceptance.md) remains pending until the owner runs it in the deployed page.

The existing local commit was not rewritten. No existing Crabbles deployment was accessed.

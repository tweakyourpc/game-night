# Game Night v0.1.0

![Game Night: turn a Google Sheet into your own online game room, play five games with people on separate devices, and keep files and replays in Google Drive.](assets/github/game-night-hero.png)

A multiplayer kit you install in your own Google Sheet and bound Apps Script project.

**Start with [browser-only installation](docs/install.md).** No clasp, Node, Python, terminal, hosted asset service, or spreadsheet template is required. The release includes files to paste into Google's editor; it is not a ZIP importer. No public template is currently provided.

Before setting up a regular group, decide which Google account should run Game Night. A separate account is an optional way to keep Game Night invitations and Drive files apart from personal or everyday work activity. The account you deploy under sends app email and stores app files; game records stay in the spreadsheet. This can be a personal Google account or an organization-managed account. Workspace, mail delegation, and special service-account configuration are not required. See [installation](docs/install.md) and [identity/access](docs/identity.md).

## Implemented

- Wordwright (2-4), Four in a Row (2), Dots and Boxes (2-4), Checkers (2), and Fivefold (2-4).
- Persistent tables, seats/readiness, host transfer, rematches, invitations, optional turn email, and pasted Meet links.
- Walnut Parlor and Slate Study themes, synthesized sound, keyboard/touch controls, procedural boards and four optional Wordwright board pictures.
- Server-authoritative moves, revision checks, retry identifiers, repairable follow-ups, session hashes and admin PINs.
- Public-event replay playback and JSON download; conditional real-time browser video recording; admin Drive saves.

## Limits

This is a locally verified release candidate, **not production-ready**. Google authorization, quotas, iframe behavior, copied-sheet deployment, mail and Drive permissions still require the [acceptance checklist](docs/google-acceptance.md). There is no Google account authentication for players. Trusted mode allows anyone with the shared code to choose any ordinary member's name. See [identity and access](docs/identity.md).

No automatic Meet creation, universal MP4 export, WebCodecs encoder, cloud synchronization service, or public spreadsheet template is implemented. Recording requires a visible tab and compatible browser APIs/codec/canvas security; JSON export remains independent. Storage uses Sheets cells, including match action history, so sufficiently long games can reach Google's cell limit. There is no automatic archival or data migration from a live Crabbles instance.

The Maple, Walnut, Felt and Slate images were carried over from the supplied project. Their known origin and unresolved rights are recorded in [licences](docs/licenses.md); inclusion is not a claim of legal clearance.

## Guides

[Setup](docs/install.md) · [Optional clasp](docs/clasp.md) · [Troubleshooting](docs/troubleshooting.md) · [Identity](docs/identity.md) · [Games](docs/game-authoring.md) · [Themes](docs/theme-authoring.md) · [Replay v1](docs/replay-format.md) · [Upgrade/backup](docs/upgrading.md) · [Licences](docs/licenses.md) · [Verification](docs/verification.md)

## Optional local development

Node 20+ runs `npm test` and `npm run build` (ZIP utility also required). `npm run test:cases` reports individual test counts. `dist/apps-script` is generated; edit `src` instead. Browser/PDF checks additionally need Playwright and Chrome. Board regeneration and the optional EffectCraft converter need Python 3 and Pillow; EffectCraft rendering also needs `effectcraft-cli`. None of these are installation requirements.

For a local preview, allocate a port first: `PORT=$(portbroker alloc --name game-night-dev)` then `node tools/dev_server.js --port "$PORT"`. It binds to LAN and uses synthetic demo accounts only. Without `--words <ENABLE-file>` its test dictionary accepts all words. Never use that harness as the Google deployment.

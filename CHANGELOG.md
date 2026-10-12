# Changes

## Unreleased

- Add Play vs Computer for a private, dictionary-checked Wordwright match with a human first move.
- Add a bounded Wordwright computer search, server-authorized and idempotent bot turns, automatic turn requests after refresh, and computer names in tables, scores and replays.
- Keep computer seats separate from members and sessions; restrict computer tables to Wordwright rematches.
- Add focused bot tests and a packaged browser check for desktop, phone and reconnect behavior. A cold turn benchmark on a real Apps Script test deployment remains a release gate.

## 0.1.0

Initial local installation kit: five games, shared themes, tables, replay/export, browser-only setup and optional development tools. Includes script-bound copy protection, stale-response guards, scoped upload cleanup and content-based release checks. Google deployment acceptance remains pending.

---
title: "Wordwright bot turn contract"
created_at: "2026-10-12T04:44:41.656966+00:00"
type: "pending-writeback"
---

# Summary

Bot seats and moves share the match commit path without member sessions.

# Rules

- Reserve bot action IDs, authenticate the requesting human, and keep bot IDs out of member-only flows.

# Verify next time

- Run quality gate, packaged desktop and phone browser checks, and a cold turn benchmark on a separate Apps Script test deployment before release.

# Prevents

- Duplicate bot commits, leaked racks, incorrect member stats, and release based only on local timing.

# Look here first

- src/platform/matches.js; src/platform/tables.js; src/games/wordwright/bot.js

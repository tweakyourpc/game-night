---
title: "Game Night test deployment and push gate"
created_at: "2026-10-12T04:54:37.646924+00:00"
type: "pending-writeback"
---

# Summary

The Wordwright bot was uploaded to the bound test Apps Script project as version 7 and GitHub main at 0fa398d; the real cold-turn benchmark remains open.

# Rules

- Before a new GitHub release, benchmark a cold bot turn on the real test web app; confirm clasp deployment version and public page content after redeploy.

# Verify next time

- Run workspace-quality-gate before push; inspect git status after the pre-push hook because the release ZIP is timestamp-sensitive.

# Prevents

- Treating a successful upload or local harness timing as a validated real bot turn, or leaving an accidental generated ZIP diff.

# Look here first

- docs/verification.md; CHANGELOG.md; tools/build.mjs

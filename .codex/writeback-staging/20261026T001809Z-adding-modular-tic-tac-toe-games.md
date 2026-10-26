---
title: "Adding modular Tic-tac-toe games"
created_at: "2026-10-26T00:18:09.128244+00:00"
type: "pending-writeback"
---

# Summary

Game modules are auto-discovered from src/games/<id>/rules.js and should provide rules, UI, help text, tests, and a display name.

# Rules

- Keep game rules server-authoritative; expose a stable view snapshot and implement the documented rules.js/ui.js contracts.

# Verify next time

- Run npm test and npm run build; packaging may require zip subprocess permission.

# Prevents

- Do not add a central registry entry when the assembler already discovers game folders.

# Look here first

- docs/game-authoring.md

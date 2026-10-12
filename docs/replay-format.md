# Replay format v1

The implemented discriminator is `format: "game-night-replay"`, `version: 1`. The earlier plan's `tabletop-replay` example was not implemented. All timestamps are Unix milliseconds, not ISO strings.

| Field | Meaning |
|---|---|
| `platform` | configured platform name |
| `game` | `id`, display `name`, module `version`, `rulesVersion`, platform `schemaVersion` |
| `theme` | `id`; v1 does not snapshot theme version or tokens |
| `match` | `id`, `table`, `tableTitle`, `started`, nullable `ended`, `status` |
| `players` | ordered `{id,name}` snapshots |
| `options` | validated game options |
| `events` | ordered `{seq,rev,actor,type,at,public}` records |
| `final` | null while active; otherwise `{status,winners,scores,adjustments,reason}` |
| `exportedBy` | exporting member ID |

Revision zero has a `start` event containing `public.snapshot`. Each committed revision's final event includes a new public spectator snapshot. Playback groups by revision and applies snapshots, preserving actual dice rolls and end adjustments without rerunning randomness. Game events include Wordwright play/exchange/pass/resign, Four in a Row drop, Dots line, Checkers move and draw/resign actions, Fivefold roll/score, plus end/abandoned events. Wordwright's public snapshot includes resigned player IDs; a resignation ends a two-player match immediately or skips that player in a larger match. Inspect each rules module for the versioned public payload. Private racks and draw bags must never appear in snapshots.

The in-app player supports play/pause, first/last, previous/next, scrub and speed for all five games. There is no arbitrary replay-file import UI yet. JSON download is independent of video recording. The latter uses MediaRecorder only after runtime codec and canvas checks, in real time while visible, producing the supported WebM or MP4 type. No WebCodecs path is implemented.

Admins may save JSON and chunked video to the owner's Drive. Video is limited to 12 chunks of 1,800,000 raw bytes in the browser. Server upload keys include installation and session ownership; completion is retryable, cancellation removes owned pieces, and maintenance retries old cleanup after 24 hours. Expired upload metadata is discarded, so completion retries are not retained indefinitely.

The optional `tools/effectcraft/render_replay.py` accepts Wordwright v1 only and writes a deterministic recipe, drawn letter tiles and JSX. Python 3/Pillow are required. `--board drawn` is the default; `--board walnut` and other retained boards are optional. `--render` additionally requires EffectCraft CLI. Existing tests verify identical recipe/assets/script output, not successful video rendering in EffectCraft.

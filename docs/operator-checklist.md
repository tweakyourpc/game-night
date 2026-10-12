# Operator checklist

Use this after [browser setup](install.md) and before inviting a regular group. This locally verified release candidate is **not production-ready**. Record results privately without session tokens, PINs, group codes, personal addresses, or private links in public reports.

- [ ] Keep the game spreadsheet and `Game Night files` Drive folder private to trusted administrators. Players need only the web-app link and group code.
- [ ] Save the group code and admin PIN securely. Choose trusted or PIN mode deliberately; see [identity and access](identity.md). Never put these secrets in GitHub or a release archive.
- [ ] Use a separate browser profile for administrator testing. Test two or more independent player sessions in other profiles or devices, including simultaneous actions and mobile layout.
- [ ] Send a test invitation and, if enabled, a turn reminder. Confirm MailApp uses the intended deployment account. Create the repair trigger and run manual repairs using that same account so queued email uses the intended sender too.
- [ ] Save a replay to Drive and confirm the `Game Night files` folder and exported files belong to the intended account. Check temporary video uploads and cleanup where video is supported.
- [ ] Test copied-sheet isolation in a private copy before inviting a regular group: reject inherited access before setup, use fresh identities after setup and a separate deployment, and confirm the original Sheet and Drive contents remain unchanged.
- [ ] Test refresh, reconnect after a lost connection, and rematch with independent player sessions. Accepted moves and table seats should persist.
- [ ] Test invalid/revoked-session recovery using a disposable player and admin removal, then reload that player's page and confirm sign-in is required. **Timed session expiry is not implemented in v0.1.0:** do not mark an expiry timer as tested or promise automatic sign-out. Signing out revokes that device; changing the group code alone does not revoke existing sessions.
- [ ] Download replay JSON after a game and inspect it. Test browser video recording only when runtime APIs, codec and permissions support it; a failed recording must leave JSON download and the game working.
- [ ] Paste and open a meeting link if desired. Automatic Meet creation is not implemented.
- [ ] Review spreadsheet storage growth and old replay/video files in Drive. Back up before removing files; v0.1.0 has no automatic game archival. Do not delete active game rows or in-progress upload pieces. Follow [upgrade and backup guidance](upgrading.md).
- [ ] Keep the [Google acceptance checklist](google-acceptance.md) incomplete until each item has actually been tested on Google. Local tests and successful setup alone do not establish deployment readiness.

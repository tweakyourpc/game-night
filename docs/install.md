# Browser-only installation

Use a Google account that can create Sheets and deploy Apps Script web apps. Your Workspace administrator may prohibit public web apps. A current desktop browser and the extracted release ZIP are enough; use a text editor to copy file contents. Do not use your existing live game spreadsheet.

Before setup, decide which Google account should run this installation. For a regular family or coworker group, you may prefer a dedicated account so Game Night mail and Drive files stay separate from your personal or everyday work account. This is a recommendation, not a requirement: either a personal Google account or an organization-managed Google account can be used if it can authorize the requested services and deploy the web app. The selected deployment account sends invitations and reminders through MailApp and owns the app's Drive files; the game data itself stays in the spreadsheet. Game Night does not configure shared mailboxes or delegation. Any mail delegation is managed separately through Google. You do not need a Google Cloud service account.

1. Extract `game-night-v0.1.0.zip`. Open its `apps-script` folder and `MANIFEST.txt`.
2. Using the Google account you chose to run the installation, create a **blank spreadsheet**, name it Game Night, and select **Extensions → Apps Script**. This creates the required bound project.
3. Name the script project. Replace all contents of the default `Code.gs` with `apps-script/Code.gs` from the kit.
4. Beside **Files**, click **+ → HTML**, enter `Index` (without `.html`), and paste all of `Index.html`.
5. Repeat **+ → HTML** for each of `asset_wordwright_board_maple`, `asset_wordwright_board_walnut`, `asset_wordwright_board_felt`, and `asset_wordwright_board_slate`. Paste the corresponding `.html` contents, including the long data URL. These are data files, not pages to open. All artwork is embedded; no CDN configuration is needed. The drawn board also works without these optional files.
6. Open **Project Settings** (gear), enable **Show “appsscript.json” manifest file in editor**, return to the editor and replace the manifest with the supplied `appsscript.json`. Save all files. Do not create `MANIFEST.txt`, documentation or PDFs as script files.
7. Return to the spreadsheet and reload it. Choose **Game Night → Set up this spreadsheet…** from the spreadsheet menu. Do not run `gnSetup` from the Apps Script editor: setup uses spreadsheet dialogs and requires the spreadsheet UI.
8. Authorize using the Google account chosen to run this installation. Review Google's permission list. For your own unverified script Google may show a warning; proceed only after reviewing your copied code and confirming the project/account. An organization policy can block authorization. Google interface wording varies.
9. Enter group name, a shared group code (4-100 characters), your display name, and a 4-8 digit admin PIN. Save the PIN separately. Setup creates the data tabs and binds this script project to this sheet. Default sign-in is trusted; admins always need a PIN. Repeating setup on the same installation preserves data.
10. In Apps Script select **Deploy → New deployment → Select type (gear) → Web app**. Set **Execute as: Me** and **Who has access: Anyone**, then **Deploy** and authorize if prompted. The deploying account runs all server services. If “Anyone” is unavailable, consult your administrator; do not assume anonymous visitors can join.
11. Copy the **Web app URL** ending in `/exec`. Open it, enter the group code, choose your admin name and enter the PIN. The script obtains its deployed URL automatically for invitations; there is no “Finish setup” menu.
12. Share the web-app URL and group code privately. Players do not need spreadsheet access. Complete [Google acceptance](google-acceptance.md) using separate browser profiles before regular use. Optionally choose **Game Night → Turn on automatic repairs**; the owner's trigger runs every ten minutes.

Keep the Sheet private to trusted administrators: it contains private racks, group code, email addresses and hashes. Data stays in this spreadsheet. On first use, the owner's Drive receives a `Game Night files` folder with `data` (downloaded dictionary), `replays` (admin exports), and `uploads` (temporary video pieces). Browser downloads stay on the player's device. Email is sent by the deploying account through MailApp. Meet simply opens a pasted HTTPS link and has its own permissions.

## Actual authorization scopes

The supplied manifest requests `spreadsheets` (bound data and validated web-app opening by ID), `script.container.ui` (setup menus/dialogs), `drive` (dictionary and export folders/files), `script.send_mail` (invitations and optional reminders), `script.external_request` (ENABLE download), `script.scriptapp` (optional repair trigger), and `userinfo.email` (installer's initial email). No Calendar, Meet API, Gmail API or Firebase service is used. These broad built-in service scopes are requested even if you never use an optional feature.

## Copies

A copy is a new instance, not an upgrade or data restore. The code checks both the current script ID and sheet/install IDs before reading inherited identifiers. Before setup, a copy's web requests and repair actions fail closed. Setup asks before erasing inherited game tabs and script properties; it never cleans up the original owner's Drive. Each copy needs its own deployment. Physical copying still duplicates the spreadsheet contents for its new owner to read; isolation does not undo that disclosure.

Google references: [bound scripts](https://developers.google.com/apps-script/guides/bound), [web-app deployment](https://developers.google.com/apps-script/guides/web), [authorization](https://developers.google.com/apps-script/guides/services/authorization).

# Optional clasp workflow

Clasp is for developers; follow [browser setup](install.md) without it if you prefer. Install Node and Google's `@google/clasp` CLI, and enable the Apps Script API in your Google account settings if required by clasp.

Create a new blank Sheet and bound script through **Extensions → Apps Script** first. In that project's **Project Settings**, copy its Script ID. In a private local checkout, copy `.clasp.json.example` to `.clasp.json`, replace only `REPLACE_WITH_NEW_BOUND_SCRIPT_ID`, and keep `rootDir` as `dist/apps-script`. For a new installation, never reuse another installation's binding; see [upgrading](upgrading.md) for an existing installation. Sign in to clasp with the account chosen in [browser setup](install.md). With the release ZIP, use its already-generated `apps-script` files as `dist/apps-script` in your private workspace. In a source checkout, run `npm run build` to generate them. Run `clasp status` and carefully verify the target project before `clasp push`. Clasp uploads were used for a separate test installation; complete Google acceptance remains pending.

Only `.gs`, `.html` and the manifest belong in the Apps Script project. Configure clasp exclusions if your installed CLI lists `MANIFEST.txt`. Use the browser setup menu and browser deployment steps after upload. Keep `.clasp.json` and clasp login credentials private and out of version control. The example contains no real ID.

[Official clasp guide](https://developers.google.com/apps-script/guides/clasp).

# Upgrades and backups

Before replacing code, pause play, save the current release and make a private backup of the spreadsheet using **File → Make a copy**. Also back up the owner's `Game Night files` Drive folder separately, and retain the Apps Script version/deployment details privately. Spreadsheet copies do not reliably preserve deployment settings, triggers or script properties. A backup contains private data; do not publish it.

Upgrade the **same bound project** by replacing the generated files from the new release. Review its release notes and manifest scopes. In **Deploy → Manage deployments**, edit the existing web app, select **New version**, and deploy; keeping that deployment keeps its URL. Do not run fresh-copy setup to upgrade. Existing schema version 1 is preserved. The migration mechanism is idempotent, but v0.1.0 defines no version-to-version migration yet. Do not claim a migration has been validated when none exists.

For rollback, select the previous deployed script version in that same project. Future schema changes may prevent rollback and require release-specific recovery. Test a backup and recovery plan before depending on the service.

A copied sheet is deliberately blocked as an installation until fresh setup, which erases inherited game tabs and bindings. To recover data, restore reviewed backup tab contents into the **original bound spreadsheet** while traffic is stopped, preserving its current installation bindings and Settings identifiers. Restore Drive data separately if needed. There is no automated cross-instance restore or merge tool. Never paste original bindings into a new copy to bypass isolation.

Early local development installs lacking the SCRIPT_ID binding must not run fresh setup expecting to keep data. If you have such a private test install, back it up and review its bindings deliberately in the script editor after verifying ownership. There is no automatic legacy rebinding on web requests or validated migration procedure for those early installs. A separate current test installation has been deployed; that does not establish upgrade or recovery acceptance.

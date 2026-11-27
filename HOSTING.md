# Hosting and Netlify retirement — staged migration

This is the first stage of the replacement originally proposed in #552.
The new static game host is GitHub Pages; Windows and Android continue to use
their existing canonical local-save-folder engine. Android uses native Google
Drive authorization; Windows uses Google Drive for Desktop. No save formats,
folder-write behavior, native permissions, or existing cloud accounts are changed.

## Enable and verify Pages

1. In GitHub repository Settings → Pages, set the deployment source to
   GitHub Actions.
2. Merge this stage only after reviewing the changes. The deployment workflow
   runs for main changes under docs/ and can also be triggered manually on main.
3. Verify https://oolnokk.github.io/HobunjiHollowUnity/ loads the game, assets,
   character creator, preview tools, and ordinary local saves. GitHub Pages
   uses a different origin from Netlify, so its browser storage starts empty.
   It does not automatically inherit existing saves or permissions.
4. Keep the original Netlify deployment available throughout the migration.
   Do not change DNS, disable Identity, delete Blobs, or delete the old site
   before confirming recovery and migration.

## Existing player saves

- On Windows, configure Google Drive for Desktop and select the existing
  save directory using Local Save Folder, not the Drive root.
- On Android, follow android/README.md to configure and authorize native
  Drive, select the same save directory, and explicitly load it before enabling
  writes. The required OAuth and restricted-scope setup is outside this repo.
- In a supported desktop browser, use its local folder chooser with a
  Google Drive for Desktop directory. On browsers without a folder picker,
  ordinary browser saves remain available, but direct browser Drive sync is
  not yet implemented. Use the installed app for Drive access.
- If a save exists only in Netlify, first preserve any newer local progress.
  Open the original Netlify deployment, authenticate, and explicitly choose
  the intended cloud revision using the existing conflict controls. Restore
  it to that browser and back up to a **new empty** local folder using the
  existing folder UI. Verify the backup can be loaded before copying it
  into a Google Drive directory. Never overwrite an existing Drive save
  without a separate backup and explicit reconciliation. Do not use a
  disposable Festival Test save for migration.

## Remaining work before final retirement

- Implement browser OAuth and Drive access as a transport for the current
  canonical save-folder layout, not the independent snapshot JSON used in
  the September prototype #552. Keep credentials out of source, preserve
  selected-folder authorization, bounded writes and conflict/recovery rules.
- Verify live Google authorization, browser/Android/PC round trips, reconnect,
  conflicting revisions, interrupted writes, and migration on real devices.
- Verify Pages deploy and relative paths and compare actual storage usage.
- Only after existing Netlify saves have been recovered and the replacement
  is validated, remove netlify.toml, Netlify functions and dependencies,
  the legacy browser client, and migration-only account UI.

The legacy service remains intentionally present for recovery. Do not treat
this stage as complete removal of Netlify or a validated direct browser Drive
implementation.

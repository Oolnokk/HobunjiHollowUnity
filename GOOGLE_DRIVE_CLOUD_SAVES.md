# Google Drive Cloud Saves

Hobunji Hollow keeps the browser save (`localStorage`) as the live gameplay save and optionally mirrors the portable snapshot into a Google Drive folder chosen by the player.

No Netlify Identity, Functions, or Blobs backend is required for cloud saves.

## Architecture

- `docs/js/save-snapshot-core.js` captures/restores the same `hobunjiSaveMeta` + `hobunji_farm_layout_v3:*` boundary used by the local-folder backup.
- `docs/js/google-drive-cloud-save-config.js` contains the browser-visible Google OAuth/Picker identifiers.
- `docs/js/google-drive-cloud-save.js` owns Google Identity Services authorization, Google Picker folder selection, Drive REST reads/writes, autosync, conflict handling, and mobile-visible diagnostics.
- The selected Drive folder is remembered locally by folder ID. The OAuth access token is **not** persisted to `localStorage`.
- The Drive file is named `Hobunji Hollow Save.json` and contains a revisioned envelope around the normal Hobunji save snapshot.

## Google Cloud setup

A Google Cloud project is required once for the deployed game.

1. Enable **Google Drive API** and **Google Picker API**.
2. Configure the OAuth consent screen.
3. Create an **OAuth 2.0 Client ID** of type **Web application**.
4. Add every real game origin that should be allowed to authorize, for example the production site and any deliberate test origin.
5. Create an API key for Picker. Restrict it to **Websites**, allowing the game referrers **and `https://docs.google.com/*`** because Picker runs inside a Google-hosted iframe. Under API restrictions, allow **Google Picker API** and **Google Drive API**.
6. Copy the OAuth client ID, API key, and numeric Google Cloud project number into `docs/js/google-drive-cloud-save-config.js` as `clientId`, `apiKey`, and `appId`.

These three values are public browser configuration, not client secrets. Do not add an OAuth client secret to the game.

## Permissions

The game requests only:

`https://www.googleapis.com/auth/drive.file`

That scope is intended for files the app creates or files/folders the player explicitly shares with the app through Google Picker. The player chooses the save folder from the standard Drive Picker UI.

## Runtime flow

1. The game saves to the browser exactly as before.
2. The player opens **Cloud Save**, connects Google Drive, and chooses a folder.
3. An explicit first sync either creates `Hobunji Hollow Save.json` or detects an existing Drive copy.
4. After a successful explicit sync, autosync is armed.
5. Local changes are detected by the existing save snapshot fingerprint and uploaded on the autosync interval.
6. If Drive's revision differs from the revision this browser last synced, autosync pauses and the UI asks which copy to keep.
7. Losing Drive authorization/network access never removes or blocks the browser save. The panel exposes the failure and allows reconnection without DevTools.

## Authorization lifetime

This is a static browser integration, so there is no backend holding refresh tokens. Google Identity Services supplies short-lived access tokens. The client attempts a no-prompt token request for automatic sync when possible; if Google/browser policy requires user interaction, autosync pauses and the player reconnects from the Cloud Save panel. Local saving continues normally throughout.

## Debugging on mobile

The Cloud Save panel contains an expandable debug block with:

- provider and availability state
- whether a Drive token is active and its expiration time
- selected account/folder metadata
- remote revision/file metadata
- local link revision/fingerprint state
- dirty/autosync state

The same information and actions remain available through `window.__hobunjiCloudSaveDebug` when a console is available.

## Migration from the retired Netlify save backend

The Drive client does not read Netlify Blobs. Before shutting down an old Netlify deployment that contains the only copy of a save, first load that save into a browser using the old build, then open the Drive-enabled build with the resulting browser save and push that browser copy to Drive.

Once a browser has the desired local save, no Netlify account or backend data is needed by the new system.

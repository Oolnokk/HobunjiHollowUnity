# Hosting and Netlify retirement

GitHub Pages hosts the static game. Android (native Google authorization),
Windows (Google Drive for Desktop), and browsers (direct Drive REST transport)
use the current LocalSaveFolder portable layout: characters/, worlds/,
farm-layouts/, patterns/, recovery/ and manifest.json. No separate cloud
snapshot format is introduced.

## Enable and verify Pages

In repository Settings → Pages choose GitHub Actions. After merging, the
deployment workflow publishes docs/ to
https://oolnokk.github.io/HobunjiHollowUnity/. The Pages origin has separate
browser storage; it does not inherit Netlify's browser saves or permissions.
Keep the original Netlify deployment until old account saves have been recovered.

## Browser Drive setup

1. In Google Cloud enable Drive API, configure the OAuth consent screen and
   add test users as appropriate. Create a Web application OAuth client.
2. Add https://oolnokk.github.io as an authorized JavaScript origin
   (or a dedicated HTTPS test host that you control; shared GitHack preview origins cannot authorize Drive). Enter the public client ID in
   docs/js/browser-drive-config.js for a deployment default, or paste it
   in the in-game selector. Never put a client secret or access token in
   source. No Google Picker/API key is required; paste the dedicated folder URL.
3. The full Drive scope is restricted and requires consent/verification as
   applicable; drive.file does not automatically include files written by
   another client (e.g. Windows Drive sync). The adapter restricts all game
   I/O to the selected dedicated folder and its recognized save directories.
   Access tokens are memory-only; reconnect after reload/expiry. In-game reconnect preserves live progress; use Save to Folder only when the previous remote baseline remains verified. If a pending file is missing its canonical name after an interruption, preserve it and its previous copy and repair the name in Drive before reconnecting.
4. Choose Local Save Folder → Connect Google Drive, paste the URL of the
   existing dedicated game save directory, and authorize. Choose Load from
   Folder to explicitly accept the remote baseline. A new empty folder may
   be initialized only by that explicit choice. Keep other devices closed
   while playing. On a conflict or interrupted write stop, preserve any
   unsaved browser progress, then reconnect/load or use recovery.
5. Verify browser/Android/Windows round trips, permission expiry, a changed
   remote file, large uploads, interruption, and actual Google CORS/popup
   behavior before replacing the old site. Google Drive has no transactional
   multi-file compare-and-swap; staged file publication and prior version
   backups do not make simultaneous play safe.

## Migrate old saves

On Windows choose the existing Drive for Desktop game directory using Local
Save Folder. On Android follow android/README.md for native setup. If a save
exists only in Netlify, preserve newer local progress first. Open the original
Netlify deployment, authenticate, choose the intended cloud revision, restore
to that browser and back up to a new empty local folder. Verify the backup
before copying to Drive; never overwrite another save without reconciliation.
Do not migrate a disposable Festival Test timeline.

## Retirement gate

Do not disable the old service, delete Identity/Blobs, or change DNS until
existing saves have been recovered and the production Drive round trip has
passed. The legacy client and server functions are intentionally retained for
recovery on their original host, not used by Pages or native applications.
After verification remove the legacy client, Netlify functions, configuration
and package dependencies in a follow-up cutover. This is an explicit
data-preservation gate, not a requirement to run Netlify for the new game.

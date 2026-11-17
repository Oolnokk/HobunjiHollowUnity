# Hobunji Hollow — Windows desktop edition

This is an Electron shell around the existing `docs/` game, not a fork of its
gameplay or save code. The Windows installer includes the same Three.js r128
script dependencies the browser edition loads from CDNs.

## Build and run

On Windows, install Node.js, then open a terminal in the repository root:

```powershell
cd desktop
npm install
npm start
npm run dist:win
```

The installer appears in `desktop/dist/Hobunji-Hollow-Setup-0.1.0.exe`.
The **Windows desktop installer** GitHub Actions workflow also builds an
installer for this PR; download it from that workflow run's artifacts.
No merge is needed to build or test the PR version.

## Automatically updating the installed Windows game

An installer is a snapshot of the bundled `docs/` game, **not a live GitHub checkout**.
An existing installation does not see `main` changes immediately. When the
Windows installer workflow is present on `main`, a push that changes `docs/`,
`desktop/`, or its build/test files produces a new versioned Windows installer
and a public GitHub Release containing `latest.yml`, the installer and its
blockmap. **Only a successful release becomes eligible for automatic updates.**
PR workflow artifacts and unpublished commits are not update sources.

Installed Windows builds check for releases shortly after launch and about every
four hours while the app remains open. A newer release opens a dedicated update
screen and downloads in the background. Choose **Install & Restart** after the
download finishes, or **Later** to keep playing. You can reopen this screen at
**View → Check for Updates**. The updater never installs silently when you quit.
In a development run (`npm start`) the screen explains that update checks
require an installed build.

Before restarting, the application uses **the same final-save operation** as the
normal Quit action. It waits for a connected/armed local save folder to sync or
for the browser fallback to finish, then restarts; a failed or unarmed folder
offers Retry Save, Restart Without Saving, and Cancel Update. Cancelling keeps
the current installed version and the downloaded update. Windows user data,
the game's persistent Chromium profile and connected save directory are not
replaced by an application update.

The initial PR artifact has version `0.1.0`. Published `main` installers
use incrementing `0.1.<workflow run number>` versions so older installations
can distinguish a new release. GitHub must allow Actions to create Releases
(`contents: write` permission); without a published, non-draft release there
is nothing for clients to download. Don't publish unrelated GitHub Releases
as the repository's "latest" release unless they contain compatible Windows
update artifacts. Release tagging is `desktop-v<version>`.

## Using your existing Google Drive save directory

1. Use Google Drive for Desktop to ensure your game save folder is locally
   available on the PC (not an online-only placeholder).
2. Run the installed game and use its existing **Local Save Folder** controls.
   Choose the *save directory itself*, not the entire Google Drive directory.
3. **Load from Folder** first. Do not write a blank new install's browser save
   into the populated folder. Use the existing conflict/recovery controls if
   another device has made changes.
4. Once a save has been explicitly loaded or saved and autosync is armed, the
   existing folder autosync remains active during play. Closing the window
   additionally attempts a final save and offers Retry/Cancel on failure.
   If a folder is connected but autosync was never armed, closing warns that
   only the browser fallback was saved so you do not mistake it for a Drive sync.
5. Open **View → Save Folder Status** to inspect folder name, autosync status,
   recent operation, and error without Developer Tools.

### When the folder picker reports a canceled or blocked selection

The Windows picker can produce an `AbortError` both when Cancel is clicked and
when Chromium/Windows refuses access to a selected directory. The game now
shows the underlying message instead of the generic "Folder access was not
completed" warning. Open **View → Save Folder Status** to inspect **Last
operation**, **Error**, and **Native picker** without developer tools.

If you selected a folder but received an error, choose the exact game-save
directory again, not the Google Drive root or a Windows system directory.
Ensure Google Drive for Desktop has downloaded the directory locally (make it
available offline). A protected-directory prompt requires your explicit
approval; choosing another folder or Cancel must not silently reconnect a
different save. Never delete the existing save directory while troubleshooting.
When the folder successfully connects, use **Load from Folder** before writing
a new installation's browser-only save into that location.

The desktop application has its own persistent Chromium profile, so existing
Chrome/Opera browser storage and directory permissions are *not* inherited.
The save files themselves are the same format; there is no new desktop save
format.

Do not run simultaneous writes from the browser, desktop app, and another
machine; Google Drive is not a transactional database and may create conflicts.

## Known limits

- This first installer and its auto-updates are **not code signed**. Windows SmartScreen may warn; production distribution should be code signed.
- The main game's Three.js dependencies are bundled for offline play, but some
  opt-in editor features and Netlify cloud sign-in still require internet.
- Windows smoke tests are required to verify the native folder picker, remembered
  permissions and full updater download/install/restart cycle. Unit tests alone
  cannot exercise Windows filesystem permissions or unsigned installer prompts.

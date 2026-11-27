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

The executable, installer shortcuts, game window, and update window use
`docs/assets/hud/icon_hobunji.png` rather than Electron's default icon.
The original artwork is 107×107 pixels; `npm run dist:win` automatically makes a
512×512 pixel-perfect packaging copy at `desktop/build/icon.png` (ignored by
Git). Both the ordinary and Friends Windows installers share this icon.
The `pngjs` dependency is used only while building, not shipped with the game.
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

## Friends Edition: automatically update only after developer approval

The ordinary **Hobunji Hollow** desktop install continues to receive successful
public releases generated from changes to main. Friends use a separate installer,
**Hobunji Hollow Tester**, with a distinct Windows app identity, installation
name and Chromium profile. Both editions bundle the same game from the selected
source commit; they do not maintain separate gameplay codebases.

A normal push to main **does not publish a Friends update**. To approve the
current main commit for testers:

1. Open **Actions → Publish approved Friends Windows build** in GitHub.
2. Choose **Run workflow** on branch **main** and enter **PUBLISH**.
3. Verify the run passes both jobs. It builds the Friends installer, publishes
   an explicitly tagged GitHub *prerelease* and only then advances the
   dedicated update feed in the friends-update-feed branch.
4. On first installation, give friends the
   Hobunji-Hollow-Tester-Setup-0.2.<run number>.exe asset from the approved
   friends-v0.2.<run number> release. Subsequent approved versions install
   through the existing in-game updater.

Friends' installed copies check their own feed about eight seconds after
launch and every four hours. They **automatically download an approved update**
and display the update window. The player selects **Install & Restart** or
**Later**; updates are never installed silently on quitting. The existing
save-before-restart / retry / cancel protection is shared by both editions.
If no Friends release was approved, no new Friends update is available,
regardless of how many commits were merged into main.

The Friends feed is the public HTTPS
https://raw.githubusercontent.com/Oolnokk/HobunjiHollowUnity/friends-update-feed/latest.yml.
It contains a checksum and immutable GitHub Release asset URL. It is deliberately
**not** the main GitHub releases/latest feed; Friends releases are prereleases
so they cannot become the normal desktop updater's latest stable build.
There is no automatic publishing trigger for the Friends workflow. GitHub may
cache the feed briefly, so publication is not necessarily detected immediately.

The two Windows applications store browser save data and folder permissions in
separate profiles. To use an existing shared Google Drive save, explicitly select
and load the intended save folder inside Friends Edition before saving. Do not
run both editions against the same folder simultaneously. This is a public,
developer-approved tester distribution, **not access-controlled**: anybody with
a public release URL can download that installer. Both editions are unsigned;
Windows SmartScreen warnings remain possible.

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
operation**, **Error**, **Native picker**, and **File-system permission** without developer tools.

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

## Checking whether Windows is actually using your GPU

The desktop executable requests Electron's `force_high_performance_gpu` preference before Chromium starts. This is a preference, not a guarantee: Windows graphics settings, display connections, and driver configuration can still select Intel graphics.

**Verify the Renderer field** in View → Graphics Status after restarting. `ANGLE (Intel ...)` means the game still renders through Intel, even if NVIDIA is listed as a detected adapter. `ANGLE (NVIDIA ...)` confirms that the game context uses the NVIDIA GPU. The report also distinguishes the requested preference from the renderer actually selected.

Open **View → Graphics Status** in the installed game (no developer console).
The report lists the Chromium WebGL acceleration state, detected/active display
adapters, and the **main game's live WebGL renderer**, when it is available.
Use **Copy Details** to paste the full result into a support conversation.

- A renderer containing **SwiftShader**, **llvmpipe**, or **Microsoft Basic Render
  Driver** signals a software fallback. WebGL working does not by itself prove
  hardware acceleration.
- An ANGLE renderer naming an Intel/AMD/NVIDIA GPU plus Chromium's accelerated
  WebGL status suggests hardware rendering; it does **not** guarantee the
  discrete GPU is selected or that the game's framerate is GPU-bound.
- If multiple GPUs are present, Windows **Settings → System → Display →
  Graphics** can set the installed Hobunji Hollow executable to *High
  performance*. Restart the game after changing the Windows GPU preference.
  Windows Task Manager's **GPU engine** column can help validate active usage.
- A failed or not-yet-initialized game WebGL canvas produces a diagnostic
  message; the status operation never forces a new renderer or changes
  acceleration flags. Heavy work on the JavaScript main/render thread can
  still cause low FPS even when the correct GPU is active.

## If Save and Quit appears stuck

Window close triggers the existing live-game final-save operation, which may wait
on Google Drive or a busy renderer. The desktop main process now checks for
a delayed save after 12 seconds and displays a native Windows dialog with
**Keep Waiting**, **Quit Without Saving**, or **Cancel Close**. Clicking the
window X again while a save is pending opens the same escape options immediately.

- **Keep Waiting** leaves the save running and offers the choices again after
  another delay if it still has not finished.
- **Cancel Close** leaves the game open; a save that finishes later must not
  unexpectedly exit the game.
- **Quit Without Saving** deliberately terminates the game immediately, with
  an explicit warning that recent progress may be lost or a Google Drive
  write interrupted. It never happens automatically.

The **Game → Quit Without Saving…** menu offers this same emergency exit
even when no ordinary close is pending, and **View → Shutdown Status**
reports whether a save is stuck without relying on DevTools.

This is an escape hatch, not a promise that a hung write can be safely
aborted. Prefer waiting for the save when possible and verify Drive files
before resuming if you chose to force exit.

## Known limits

- This first installer and its auto-updates are **not code signed**. Windows SmartScreen may warn; production distribution should be code signed.
- The main game's Three.js dependencies are bundled for offline play, but some
  opt-in editor features still require internet. Use the existing Google Drive for Desktop save folder. See [HOSTING.md](../HOSTING.md) for migration of older web-only account saves.
- Windows smoke tests are required to verify the native folder picker, remembered
  permissions and full updater download/install/restart cycle. Unit tests alone
  cannot exercise Windows filesystem permissions or unsigned installer prompts.

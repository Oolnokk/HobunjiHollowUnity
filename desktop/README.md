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
5. Open **View → Save Folder Status** to inspect folder name, autosync status,
   recent operation, and error without Developer Tools.

The desktop application has its own persistent Chromium profile, so existing
Chrome/Opera browser storage and directory permissions are *not* inherited.
The save files themselves are the same format; there is no new desktop save
format.

Do not run simultaneous writes from the browser, desktop app, and another
machine; Google Drive is not a transactional database and may create conflicts.

## Known limits

- This first installer is **not code signed**. Windows SmartScreen may warn.
- The main game's Three.js dependencies are bundled for offline play, but some
  opt-in editor features and Netlify cloud sign-in still require internet.
- A Windows smoke test is required to verify the native folder picker and
  remembered permissions after restart. Unit tests alone cannot check Windows
  filesystem permissions.

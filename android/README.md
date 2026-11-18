# Hobunji Hollow for Android

This APK wraps the **same game** under docs/, rendered with Android WebView and
Three.js r128. It is not a Unity rewrite and does not introduce another save
format. The APK bundles the ordinary game assets and core Three.js scripts.

## Download or build

Open the PR's Android APK GitHub Actions run, download the
Hobunji-Hollow-Android-APK artifact, extract the ZIP, and install app-debug.apk.
Allow installation from the downloaded APK's source if Android asks.

You can also open android/ in Android Studio, or run these commands inside
that directory with JDK 17, SDK 36, Gradle 9.6.0 and Node installed:

    npm install
    gradle :app:assembleDebug

Debug APKs use an ephemeral signing certificate on each CI runner. To update
between different CI builds you may need to uninstall first; **synchronize or
back up saves before uninstalling**, because it clears the app's browser
fallback data and folder choice.

## Automatic app updates (separate from Google Drive save sync)

The Android edition now follows the Windows updater's release model. **Only
published, stable Android releases from main** are update candidates; ordinary
PR artifacts and Windows installers are not update feeds. Signed installations
check GitHub Releases roughly eight seconds after opening and every four hours
while the game remains open. On unmetered connections, a newer APK downloads
automatically to the private app cache. On metered networks, the app asks first.
The download is bounded and checked against GitHub's SHA-256 digest, package
identity, version and the **currently installed signing certificate**.

After the download, **Save & Install** waits for the existing game folder save
(or browser fallback). If saving is paused, disconnected or fails, the screen
offers Retry, Cancel, or an explicit Install Without Saving override. Android
then opens its **own package installer confirmation**. Android does not allow
this sideloaded app to silently install an update, and may require that you
enable *Allow from this source* in Settings. The updater never changes the
Google Drive sync directory, the saved WebView profile or folder permissions.
To check manually, press Android Back -> **Check for Updates**.

### One-time release-signing setup

PR artifacts are debug builds signed by a temporary CI key; **they cannot
update in place across CI runners**. Set up one permanent private Android
keystore for production. **Do not commit or share the keystore.** Store four
GitHub Actions repository secrets (Settings -> Secrets and variables -> Actions):

- `HOBUNJI_ANDROID_KEYSTORE_BASE64`: base64-encoded entire release keystore
- `HOBUNJI_ANDROID_KEY_ALIAS`: release key alias
- `HOBUNJI_ANDROID_KEYSTORE_PASSWORD`: keystore password
- `HOBUNJI_ANDROID_KEY_PASSWORD`: release key password

For instance, generate the keystore locally using JDK's keytool:

    keytool -genkeypair -v -keystore hobunji-android-release.jks -alias hobunji-hollow -keyalg RSA -keysize 3072 -validity 10000

Encode the .jks using a local base64 tool and paste the encoded text into
the corresponding secret. Retain an offline backup of the keystore/passwords:
**losing the key permanently breaks in-place updates** for previously signed
Android installs. Never put these credentials in a PR or debug log.

Once the workflow is merged into main and these secrets are configured,
successful main pushes affecting docs/ or android/ build an Android release
with versionCode 1000 + that workflow's run number and versionName
0.1.<run number>. The workflow publishes `android-v<version>` containing
a signed APK and its checksum. Windows desktop releases are untouched.
Without these four secrets, CI still produces the debug APK but **does not
publish Android automatic updates**.

If you installed an older PR debug APK, **first sync or back up your saves**,
uninstall that debug copy, and install the *first signed Android release* once.
The old debug APK intentionally disables auto-update downloads and explains
this limitation from Check for Updates. Subsequent signed releases can replace
that stable installation without uninstalling or erasing app data, subject to
Android's installation confirmation and matching certificate.

## Automatically synchronize with the same Google Drive saves as your PC

1. Use an Android folder sync app such as FolderSync or Autosync for Google
   Drive. Pair a local Android folder (e.g. Documents/HobunjiSaves) with the
   already synchronized game-save folder on Google Drive.
2. Let that app download the entire folder, including manifest.json,
   characters/, worlds/, farm-layouts/, patterns/ and recovery/.
3. Open the Hobunji Hollow APK. In Local Save Folder choose Android's system
   folder picker and grant **read/write** access to that local directory.
4. **Load from Folder first.** Verify your farm before enabling automatic saves
   or writing any game state. This avoids replacing your PC saves with an empty
   new mobile profile.
5. The game writes to the selected directory automatically once its existing
   autosync has been armed. The Android sync app sends changes to Google Drive,
   which the PC Drive client downloads.

This is **periodic**, not real-time, synchronization. Avoid playing on both
devices simultaneously. Let both sync apps finish before switching.
Google Drive can create conflicting versions; don't delete recovery copies.

The Android system picker may prohibit choosing certain storage roots.
Directly choosing Google Drive as a documents provider may not support the
rename/write operations; prefer an ordinary local directory mirrored by the
sync app.

## Persistence and safety

The app uses a restricted Android Storage Access Framework (SAF) directory
tree and a securely origin-scoped message bridge. The game still calls the
existing LocalSaveFolder API; Android-specific handles are serialized to a
small token in IndexedDB and rehydrated at the next startup. No all-files
storage permission or silent Google-account access is requested.

Native save writes are staged in temporary files and then published with
rename/backup steps. If a provider refuses the safe rename procedure, the
game reports an error rather than truncating the previous canonical save.

Android's Back action offers Save and Exit. An incomplete folder sync produces
a Retry/Keep Playing/Exit Anyway warning. Backgrounding requests a best-effort
autosave, but Android may stop a process before any write finishes.

The Android Back menu also has **Check Nelk Art**. Tap it while playing:
the installed game will attempt a complete Nelk body, caped-tail, spectacles,
and eye composition and show a copyable PASS/FAIL report with its error and
previous compositor failure count. A PASS while the live animal remains plain
points to the world's texture application/retry path, not missing Nelk assets.

The existing Save Diagnostics interface works inside the APK without DevTools.
The bridge itself exposes window.HobunjiAndroidFiles.getDebug() for diagnostics.

## Limits

- PR artifacts are temporary-key debug APKs; stable auto-updates require the one-time signing setup above.
- Real-device smoke testing is still required to validate GPU rendering,
  touch/controller input, persisted folder permission after restart, Android
  provider renames, and Google Drive round-trip syncing.
- Optional online editors and remote services require network access.

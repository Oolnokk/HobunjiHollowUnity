package com.oolnokk.hobunjihollow;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.ConnectivityManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Automatic checks/downloads of published, signed Android main releases.
 * Unlike Windows, the final APK install always requires Android's system UI.
 * This class never sees the game's filesystem permissions or save data.
 */
final class AndroidUpdateController {
    interface SaveGate {
        void requestSaveBeforeUpdate();
    }

    private static final String TAG = "HobunjiAndroidUpdate";
    private static final long CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000L;
    private static final int FIRST_CHECK_DELAY_MS = 8000;
    private static final int MAX_FEED_BYTES = 3 * 1024 * 1024;
    private static final int MAX_RELEASE_PAGES = 10; // Windows and Android share one GitHub release list; Android releases can be beyond the first 100.

    private final Activity activity; // Owns notifications, Android system installer and main-thread handlers.
    private final SaveGate saveGate; // Reuses the game's exact save-before-exit operation.
    private final Handler main = new Handler(Looper.getMainLooper()); // Never display UI from the download worker.
    private final ExecutorService worker = Executors.newSingleThreadExecutor(); // Serializes release checks and downloads.
    private Candidate candidate; // Highest eligible Android release, never a Windows installer or PR artifact.
    private File verifiedApk; // Local, digest-checked and signer-checked installable APK.
    private AlertDialog downloadDialog; // Dismissible native progress screen while a release downloads.
    private boolean busy; // Blocks duplicate checks/downloads.
    private boolean savingToInstall; // Only the resulting native save-gate callback may start the installer.
    private boolean invokingInstaller; // Suppresses redundant background autosave during the OS installation handoff.
    private boolean closed; // Stops callbacks when the game activity has been destroyed.
    private long lastCheckedAt; // Four-hour throttling uses elapsedRealtime, not device clock time.

    private static final class Candidate {
        final String tag, url, sha256; // Trusted GitHub release metadata and cryptographic digest.
        final long code, size; // Expected Android package version and maximum download size.
        Candidate(String tag, String url, String sha256, long code, long size) {
            this.tag = tag; this.url = url; this.sha256 = sha256; this.code = code; this.size = size;
        }
    }

    AndroidUpdateController(Activity activity, SaveGate saveGate) {
        this.activity = activity;
        this.saveGate = saveGate;
    }

    void start() {
        main.postDelayed(() -> check(false), FIRST_CHECK_DELAY_MS);
        main.postDelayed(new Runnable() {
            @Override public void run() {
                if (closed) return;
                check(false);
                main.postDelayed(this, CHECK_INTERVAL_MS);
            }
        }, CHECK_INTERVAL_MS);
    }

    void check(boolean manual) {
        if (BuildConfig.DEBUG) {
            if (manual) showInfo("Debug APK update limitation", "This PR APK uses a temporary debug signing certificate. "
                    + "It cannot update in place to a stable signed release. Back up or sync your saves, install the first "
                    + "stable release once, then future releases update automatically without clearing app data.");
            return;
        }
        if (closed || savingToInstall) return;
        if (busy) {
            if (manual) showInfo("Android update", "An update check or download is already in progress.");
            return;
        }
        if (!manual && lastCheckedAt > 0
                && SystemClock.elapsedRealtime() - lastCheckedAt < CHECK_INTERVAL_MS) return;
        lastCheckedAt = SystemClock.elapsedRealtime();
        busy = true;
        if (manual) toast("Checking published Android updates…");
        worker.execute(() -> {
            try {
                Candidate selected = discoverLatest();
                main.post(() -> {
                    busy = false;
                    if (closed || activity.isFinishing()) return;
                    if (selected == null) {
                        if (manual) showInfo("Android updates", "No newer signed Android release is available.");
                        return;
                    }
                    if (candidate != null && candidate.code == selected.code && verifiedApk != null
                            && verifiedApk.isFile()) {
                        if (manual) showReady();
                        return;
                    }
                    candidate = selected;
                    verifiedApk = null;
                    if (isUnmetered()) {
                        downloadCandidate(selected);
                    } else {
                        new AlertDialog.Builder(activity).setTitle("Hobunji Hollow update")
                                .setMessage(selected.tag + " is available. This download may be around "
                                        + Math.round(selected.size / (1024.0 * 1024.0))
                                        + " MB. Mobile data may be charged.")
                                .setPositiveButton("Download", (d, w) -> downloadCandidate(selected))
                                .setNegativeButton("Later", (d, w) -> {}).show();
                    }
                });
            } catch (Exception error) {
                Log.w(TAG, "Update check failed", error);
                main.post(() -> {
                    busy = false;
                    if (manual && !closed) showInfo("Android update check failed",
                            String.valueOf(error.getMessage()));
                });
            }
        });
    }

    private long installedVersion() throws Exception {
        return activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).getLongVersionCode();
    }

    private static HttpURLConnection request(String value, String accept) throws Exception {
        URL url = new URL(value);
        if (!"https".equalsIgnoreCase(url.getProtocol())) throw new SecurityException("Only HTTPS updates are allowed.");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setRequestProperty("User-Agent", "Hobunji-Hollow-Android");
        connection.setRequestProperty("Accept", accept);
        connection.setInstanceFollowRedirects(true);
        return connection;
    }

    private JSONArray fetchReleasePage(int page) throws Exception {
        HttpURLConnection conn = request(AndroidUpdatePolicy.RELEASE_API + "&page=" + page, "application/vnd.github+json");
        try {
            if (conn.getResponseCode() != 200) throw new Exception("GitHub Releases HTTP " + conn.getResponseCode());
            ByteArrayOutputStream buffer = new ByteArrayOutputStream(); // Bound a public page response before JSON parsing.
            try (InputStream in = conn.getInputStream()) {
                byte[] bytes = new byte[8192];
                for (int n; (n = in.read(bytes)) != -1;) {
                    if (buffer.size() + n > MAX_FEED_BYTES) throw new Exception("GitHub release page is too large.");
                    buffer.write(bytes, 0, n);
                }
            }
            return new JSONArray(buffer.toString("UTF-8"));
        } finally { conn.disconnect(); }
    }

    private Candidate discoverLatest() throws Exception {
        long installed = installedVersion(); // Compare only to the currently installed Android package.
        for (int page = 1; page <= MAX_RELEASE_PAGES; page++) {
            JSONArray releases = fetchReleasePage(page);
            Candidate selected = null; // Highest eligible Android code on this newest-first release page.
            boolean sawAndroidRelease = false; // Stop once Android releases appear; older pages cannot be newer main builds.
            for (int i = 0; i < releases.length(); i++) {
                JSONObject release = releases.optJSONObject(i);
                if (release == null || release.optBoolean("draft") || release.optBoolean("prerelease")) continue;
                String tag = release.optString("tag_name");
                long code = AndroidUpdatePolicy.versionCodeFromTag(tag);
                if (code < 0) continue; // Never offer the Windows desktop installer as an APK.
                sawAndroidRelease = true;
                if (code <= installed || (selected != null && code <= selected.code)) continue;
                String expectedName = "Hobunji-Hollow-Android-" + tag.substring("android-v".length()) + ".apk";
                JSONArray assets = release.optJSONArray("assets");
                if (assets == null) continue;
                for (int j = 0; j < assets.length(); j++) {
                    JSONObject asset = assets.optJSONObject(j);
                    if (asset == null || !expectedName.equals(asset.optString("name"))) continue;
                    if (!"uploaded".equals(asset.optString("state"))) continue;
                    String url = asset.optString("browser_download_url");
                    String sha = AndroidUpdatePolicy.hexDigest(asset.optString("digest"));
                    long size = asset.optLong("size", 0);
                    if (sha == null || !AndroidUpdatePolicy.safeSize(size)
                            || !AndroidUpdatePolicy.safeAssetUrl(tag, url)) continue;
                    selected = new Candidate(tag, url, sha, code, size);
                }
            }
            if (sawAndroidRelease || releases.length() < 100) return selected;
        }
        throw new Exception("Unable to locate Android releases within the newest 1,000 GitHub releases.");
    }

    private boolean isUnmetered() {
        ConnectivityManager network = (ConnectivityManager) activity.getSystemService(Activity.CONNECTIVITY_SERVICE);
        return network != null && !network.isActiveNetworkMetered();
    }

    private void downloadCandidate(Candidate selected) {
        if (busy || closed) return;
        busy = true;
        showDownloadProgress(selected); // Show real progress without forcing the player to stop playing.
        worker.execute(() -> {
            try {
                File apk = downloadAndVerify(selected);
                main.post(() -> {
                    closeDownloadProgress();
                    busy = false;
                    if (closed || activity.isFinishing()) return;
                    if (candidate != null && candidate.code == selected.code) {
                        verifiedApk = apk;
                        showReady();
                    }
                });
            } catch (Exception error) {
                Log.e(TAG, "Android update could not be prepared", error);
                main.post(() -> {
                    closeDownloadProgress();
                    busy = false;
                    if (!closed) showInfo("Android update unavailable", error.getMessage()
                            + "\nThe existing installation and saves were not modified.");
                });
            }
        });
    }

    private static String digestHex(byte[] digest) {
        StringBuilder result = new StringBuilder();
        for (byte value : digest) result.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return result.toString();
    }

    private File downloadAndVerify(Candidate release) throws Exception {
        File dir = new File(activity.getCacheDir(), "updates"); // Private app cache, not the user's Google Drive folder.
        if (!dir.isDirectory() && !dir.mkdirs()) throw new Exception("Could not prepare the update cache.");
        File apk = new File(dir, "hobunji-" + release.code + ".apk");
        File staging = new File(dir, "hobunji-" + release.code + ".staging.apk"); // Android PackageManager expects an APK path when checking its signing certificate.
        if (apk.isFile()) {
            if (verifyDownloaded(apk, release)) return apk;
            if (!apk.delete()) throw new Exception("Could not discard an old update download.");
        }
        if (staging.exists() && !staging.delete()) throw new Exception("Could not reset a partial update.");
        HttpURLConnection conn = request(release.url, "application/octet-stream");
        long total = 0;
        long nextProgress = 2L * 1024 * 1024; // Throttle cross-thread UI updates during 180 MB downloads.
        MessageDigest hash = MessageDigest.getInstance("SHA-256");
        try {
            if (conn.getResponseCode() != 200) throw new Exception("APK download HTTP " + conn.getResponseCode());
            URL finalUrl = conn.getURL();
            if (!"https".equalsIgnoreCase(finalUrl.getProtocol())) throw new SecurityException("Unsafe APK redirect.");
            try (InputStream input = conn.getInputStream(); FileOutputStream output = new FileOutputStream(staging)) {
                byte[] bytes = new byte[64 * 1024];
                for (int n; (n = input.read(bytes)) != -1;) {
                    total += n;
                    if (total > AndroidUpdatePolicy.MAX_APK_BYTES || total > release.size) {
                        throw new Exception("APK exceeded its published size.");
                    }
                    hash.update(bytes, 0, n);
                    output.write(bytes, 0, n);
                    if (total >= nextProgress) {
                        postDownloadPercent(release, total);
                        nextProgress = total + 2L * 1024 * 1024;
                    }
                }
                output.getFD().sync();
            }
            if (total != release.size || !digestHex(hash.digest()).equals(release.sha256))
                throw new SecurityException("APK length or SHA-256 did not match GitHub Release metadata.");
            main.post(() -> {
                if (downloadDialog != null && downloadDialog.isShowing()) {
                    downloadDialog.setMessage("Download complete. Verifying APK signature and version…");
                }
            });
            verifyApkSignatureAndVersion(staging, release);
            if (!staging.renameTo(apk)) throw new Exception("Could not publish verified APK.");
            return apk;
        } finally {
            conn.disconnect();
            if (staging.isFile()) staging.delete(); // An interrupted transfer must never be shown as installable.
        }
    }

    private boolean verifyDownloaded(File file, Candidate release) throws Exception {
        if (file.length() != release.size) return false;
        MessageDigest hash = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new java.io.FileInputStream(file)) {
            byte[] bytes = new byte[64 * 1024];
            for (int n; (n = input.read(bytes)) != -1;) hash.update(bytes, 0, n);
        }
        if (!digestHex(hash.digest()).equals(release.sha256)) return false;
        verifyApkSignatureAndVersion(file, release);
        return true;
    }

    private void verifyApkSignatureAndVersion(File apk, Candidate release) throws Exception {
        PackageManager pm = activity.getPackageManager();
        PackageInfo incoming = pm.getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.GET_SIGNING_CERTIFICATES);
        PackageInfo installed = pm.getPackageInfo(activity.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
        if (incoming == null || incoming.signingInfo == null || installed.signingInfo == null)
            throw new SecurityException("Android could not verify APK signing information.");
        if (!activity.getPackageName().equals(incoming.packageName) || incoming.getLongVersionCode() != release.code)
            throw new SecurityException("Downloaded package identity or version is not the expected update.");
        Signature[] newSigners = incoming.signingInfo.getApkContentsSigners();
        Signature[] oldSigners = installed.signingInfo.getApkContentsSigners();
        if (newSigners == null || oldSigners == null || newSigners.length != 1 || oldSigners.length != 1
                || !Arrays.equals(newSigners, oldSigners)) {
            throw new SecurityException("The installed app is signed with another certificate. "
                    + "Debug CI APKs use temporary keys and cannot update in place to signed releases. "
                    + "Back up or synchronize saves before changing installation channels.");
        }
        if (release.code <= installed.getLongVersionCode()) throw new SecurityException("Cannot install an older version.");
    }

    private void showDownloadProgress(Candidate selected) {
        if (closed || activity.isFinishing()) return;
        closeDownloadProgress();
        downloadDialog = new AlertDialog.Builder(activity)
                .setTitle("Downloading Hobunji Hollow update")
                .setMessage(selected.tag + " — 0%\nYou can keep playing while this downloads.")
                .setNegativeButton("Continue Playing", (dialog, which) -> {})
                .create(); // Dismissing this screen never cancels or corrupts a staged download.
        downloadDialog.show();
    }

    private void postDownloadPercent(Candidate selected, long bytes) {
        int percent = (int) Math.min(100L, Math.round(100.0 * bytes / selected.size)); // Grounded percentage from published asset length.
        main.post(() -> {
            if (!closed && downloadDialog != null && downloadDialog.isShowing()) {
                downloadDialog.setMessage(selected.tag + " — " + percent + "% downloaded"
                        + "\nYou can keep playing while this downloads.");
            }
        });
    }

    private void closeDownloadProgress() {
        if (downloadDialog != null) {
            downloadDialog.dismiss();
            downloadDialog = null;
        }
    }

    private void showReady() {
        if (closed || verifiedApk == null) return;
        new AlertDialog.Builder(activity).setTitle("Hobunji Hollow update ready")
                .setMessage(candidate.tag + " has been downloaded and verified.\n"
                        + "Save the game, then Android will ask you to approve installation. "
                        + "Your existing app data and selected save-folder permission are preserved.")
                .setPositiveButton("Save & Install", (d, w) -> install())
                .setNegativeButton("Later", (d, w) -> {}).show();
    }

    private void install() {
        if (closed || busy || savingToInstall || verifiedApk == null || !verifiedApk.isFile()) return;
        savingToInstall = true;
        saveGate.requestSaveBeforeUpdate(); // No system installer until the game replies with its actual save status.
    }

    void onSaveResult(JSONObject result) {
        if (!savingToInstall || closed) return;
        savingToInstall = false;
        if (result.optBoolean("ok") && !"paused".equals(result.optString("mode"))) {
            invokeInstaller();
            return;
        }
        new AlertDialog.Builder(activity).setTitle("Save before updating")
                .setMessage("The final save did not complete: " + result.optString("error",
                        "Saving is paused or the save folder is unavailable.")
                        + "\nYour Google Drive folder might not contain the latest changes.")
                .setPositiveButton("Retry Save", (d, w) -> install())
                .setNeutralButton("Install Without Saving", (d, w) -> invokeInstaller())
                .setNegativeButton("Cancel Update", (d, w) -> {}).show();
    }

    private void invokeInstaller() {
        if (verifiedApk == null || !verifiedApk.isFile()) return;
        if (!activity.getPackageManager().canRequestPackageInstalls()) {
            new AlertDialog.Builder(activity).setTitle("Allow APK installation")
                    .setMessage("Android requires you to grant this app permission to request installation. "
                            + "Return here and tap Check for Updates after granting it.")
                    .setPositiveButton("Open Settings", (d, w) -> {
                        Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + activity.getPackageName()));
                        activity.startActivity(settings);
                    }).setNegativeButton("Later", (d, w) -> {}).show();
            return;
        }
        try {
            // Only verified APKs from the private cache enter Android's own install screen.
            Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".apkprovider", verifiedApk);
            Intent intent = new Intent(Intent.ACTION_INSTALL_PACKAGE);
            intent.setData(uri);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            invokingInstaller = true;
            activity.startActivity(intent);
        } catch (Exception error) {
            invokingInstaller = false;
            Log.e(TAG, "Could not start Android system installer", error);
            showInfo("Install failed", String.valueOf(error.getMessage()));
        }
    }

    boolean isInvokingInstaller() { return invokingInstaller; }
    void onResume() { invokingInstaller = false; }

    private void toast(String message) {
        main.post(() -> { if (!closed && !activity.isFinishing()) Toast.makeText(activity, message, Toast.LENGTH_LONG).show(); });
    }

    private void showInfo(String title, String message) {
        if (closed || activity.isFinishing()) return;
        new AlertDialog.Builder(activity).setTitle(title).setMessage(message)
                .setPositiveButton("OK", (d, w) -> {}).show();
    }

    void close() {
        closed = true;
        closeDownloadProgress();
        main.removeCallbacksAndMessages(null);
        worker.shutdownNow();
    }
}

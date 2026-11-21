package com.oolnokk.hobunjihollow;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.IntentSender;
import java.io.IOException;
import android.os.SystemClock;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;
import java.util.Arrays;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.webkit.ConsoleMessage;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Fullscreen installed version of the existing Hobunji Hollow WebGL game. */
public final class MainActivity extends Activity {
    private static final String TAG = "HobunjiAndroid";
    private static final String GAME_ORIGIN = "https://appassets.androidplatform.net";
    private static final String GAME_URL = GAME_ORIGIN + "/assets/game/index.html";
    private static final int PICK_FOLDER = 1201;
    private static final int PICK_FILE = 1202;
    private static final int PICK_DRIVE_AUTH = 1203;
    private static final long DRIVE_TOKEN_REFRESH_MS = 45L * 60L * 1000L; // Reauthorize in native code ahead of access-token expiry.

    private final ExecutorService io = Executors.newSingleThreadExecutor(); // Serializes SAF file operations and keeps large saves off the UI thread.
    private AndroidFolderBackend files; // Owns selected-directory permission and open read/write sessions.
    private AndroidDriveBackend drive; // Google Drive REST adapter; shares the existing game's file-handle operations.
    private long driveTokenAt; // Refresh threshold for the native-only Google access token.
    private boolean drivePickerActive; // Distinguishes folder-selection consent from normal reconnect consent.
    private String pendingDriveRootId; // Chosen via restricted Google Picker; persist only after separate full access approval.
    private boolean driveAuthorizationBusy; // One native authorization dialog at a time.
    private AndroidUpdateController updates; // Checks signed main releases without touching the game's saves.
    private WebView web; // Persistent WebView storage is the game's browser fallback.
    private JavaScriptReplyProxy pickerReply; // Outstanding user-initiated folder-choice response.
    private int pickerRequestId = -1; // Matches chooser result to the pending JS request.
    private ValueCallback<Uri[]> filePickerCallback; // Standard HTML input-file chooser.
    private boolean exitPending = false; // Prevents multiple concurrent quit/save dialogs.

    @Override public void onCreate(Bundle savedState) {
        super.onCreate(savedState);
        files = new AndroidFolderBackend(this);
        drive = new AndroidDriveBackend(this); // No Google account or scope is requested until the player chooses Drive.
        updates = new AndroidUpdateController(this, this::askGameToSaveForUpdate); // Shared final-save gate before opening Android's installer.
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);

        web = new WebView(this);
        setContentView(web);
        WebSettings settings = web.getSettings(); // The existing three.js canvas requires JS and persistent DOM storage.
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        web.setWebViewClient(new WebViewClientCompat() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (url.toString().startsWith(GAME_ORIGIN + "/assets/")) return false;
                if (request.isForMainFrame() && ("https".equals(url.getScheme()) || "http".equals(url.getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, url)); }
                    catch (Exception error) { Toast.makeText(MainActivity.this, "No app can open that link.", Toast.LENGTH_LONG).show(); }
                    return true;
                }
                return request.isForMainFrame();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage message) {
                Log.d(TAG, message.messageLevel() + " " + message.sourceId() + ":" + message.lineNumber() + " " + message.message());
                return true;
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePickerCallback != null) filePickerCallback.onReceiveValue(null);
                filePickerCallback = callback;
                try { startActivityForResult(params.createIntent(), PICK_FILE); }
                catch (Exception error) {
                    filePickerCallback = null;
                    callback.onReceiveValue(null);
                }
                return true;
            }
        });

        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            new AlertDialog.Builder(this).setTitle("Android WebView update required")
                    .setMessage("Update Android System WebView in Google Play to use secure save-folder access.")
                    .setPositiveButton("Close", (dialog, which) -> finish()).show();
            return;
        }

        // Exact origin + main-frame checks prevent untrusted iframe code or
        // third-party CDNs from obtaining the user's saved document-tree grant.
        WebViewCompat.addWebMessageListener(web, "HobunjiAndroidHost",
                Collections.singleton(GAME_ORIGIN),
                (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                    if (!isMainFrame || !GAME_ORIGIN.equals(String.valueOf(sourceOrigin))) return;
                    onNativeMessage(message, replyProxy);
                });
        web.loadUrl(GAME_URL);
        updates.start(); // Checks shortly after launch and every four hours while the app is open.
    }

    private void reply(JavaScriptReplyProxy to, int id, Object result, Exception error) {
        try {
            JSONObject packet = new JSONObject().put("id", id).put("ok", error == null);
            if (error == null) packet.put("result", result);
            else packet.put("error", new JSONObject()
                    .put("name", error instanceof java.io.FileNotFoundException ? "NotFoundError" : error instanceof android.os.OperationCanceledException ? "AbortError" : "NotAllowedError")
                    .put("message", error.getMessage() != null ? error.getMessage() : String.valueOf(error)));
            runOnUiThread(() -> to.postMessage(packet.toString()));
        } catch (Exception failure) { Log.e(TAG, "Could not reply to game", failure); }
    }

    private void onNativeMessage(WebMessageCompat message, JavaScriptReplyProxy proxy) {
        try {
            JSONObject packet = new JSONObject(message.getData());
            int id = packet.getInt("id");
            String op = packet.getString("op");
            JSONObject args = packet.optJSONObject("args");
            if (args == null) args = new JSONObject();
            if ("choose".equals(op)) {
                if (pickerReply != null || driveAuthorizationBusy) {
                    reply(proxy, id, null, new IllegalStateException("A save-folder chooser is already open."));
                    return;
                }
                pickerReply = proxy;
                pickerRequestId = id;
                new AlertDialog.Builder(this).setTitle("Where should Hobunji Hollow save?")
                        .setItems(new String[] { "Google Drive (direct connection)", "Folder on this phone" },
                                (dialog, which) -> {
                                    if (which == 0) startDriveAuthorization(true, true);
                                    else startPhoneFolderPicker();
                                })
                        .setOnCancelListener(dialog -> finishFolderChoice(null,
                                new android.os.OperationCanceledException("Save folder selection cancelled.")))
                        .show();
                return;
            }
            if ("driveAuthorize".equals(op)) {
                String chosenTree = args.optString("tree");
                if (!drive.rootTree().equals(chosenTree) || drive.rootId().isEmpty()) {
                    reply(proxy, id, null, new SecurityException("This Google Drive folder has not been chosen."));
                    return;
                }
                if (pickerReply != null || driveAuthorizationBusy) {
                    reply(proxy, id, null, new IllegalStateException("Another save-folder authorization is running."));
                    return;
                }
                pickerReply = proxy;
                pickerRequestId = id;
                startDriveAuthorization(false, true);
                return;
            }
            if ("permission".equals(op) && args.optString("tree").startsWith("drive:")) {
                final JSONObject requested = args;
                if (!drive.rootTree().equals(requested.optString("tree"))) {
                    reply(proxy, id, new JSONObject().put("granted", false), null);
                    return;
                }
                ensureDriveToken(false, (allowed, error) -> {
                    try { reply(proxy, id, new JSONObject().put("granted", allowed), null); }
                    catch (Exception failure) { reply(proxy, id, null, failure); }
                });
                return;
            }
            if ("nelkArtDiagnostics".equals(op)) {
                showNelkArtDiagnostics(args);
                return;
            }
            if ("updateSaveResult".equals(op)) {
                final JSONObject report = args;
                runOnUiThread(() -> updates.onSaveResult(report)); // Installer dialogs belong on Android's UI thread.
                return;
            }
            if ("quitResult".equals(op)) {
                final JSONObject report = args;
                runOnUiThread(() -> onQuitSaved(report)); // Stay on the UI thread for the save-failure dialog.
                return;
            }
            final JSONObject requested = args;
            final boolean usesDrive = requested.optString("tree").startsWith("drive:");
            if (usesDrive) {
                if (!drive.rootTree().equals(requested.optString("tree"))) {
                    reply(proxy, id, null, new SecurityException("The requested Drive folder was not approved by Google Picker."));
                    return;
                }
                ensureDriveToken(false, (allowed, error) -> {
                    if (!allowed) {
                        reply(proxy, id, null, error == null
                                ? new SecurityException("Reconnect your Google Drive folder in Local Save Folder.")
                                : error);
                        return;
                    }
                    dispatchFileRequest(true, op, requested, proxy, id);
                });
            } else {
                dispatchFileRequest(false, op, requested, proxy, id);
            }
        } catch (Exception error) { Log.e(TAG, "Invalid Android save request", error); }
    }

    /** Only the selected app-origin WebView may submit these operations. */
    private void dispatchFileRequest(boolean usesDrive, String op, JSONObject requested,
                                     JavaScriptReplyProxy proxy, int id) {
        io.execute(() -> {
            try {
                reply(proxy, id, usesDrive ? drive.dispatch(op, requested) : files.dispatch(op, requested), null);
            } catch (Exception error) {
                if (usesDrive && error instanceof SecurityException) driveTokenAt = 0; // Retry native authorization on next request.
                Log.e(TAG, "Save operation " + op + " failed", error);
                reply(proxy, id, null, error);
            }
        });
    }

    private void startPhoneFolderPicker() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try { startActivityForResult(intent, PICK_FOLDER); }
        catch (Exception error) { finishFolderChoice(null, error); }
    }

    private void finishFolderChoice(JSONObject payload, Exception error) {
        JavaScriptReplyProxy to = pickerReply; // Only the currently pending user request receives the selected handle.
        int requestId = pickerRequestId;
        pickerReply = null;
        pickerRequestId = -1;
        driveAuthorizationBusy = false;
        pendingDriveRootId = null;
        if (to != null) reply(to, requestId, payload, error);
    }

    private interface TokenCallback { void done(boolean allowed, Exception error); }

    private AuthorizationRequest driveRequest(boolean showPicker) {
        AuthorizationRequest.Builder request = AuthorizationRequest.builder()
                .setRequestedScopes(Arrays.asList(new Scope(showPicker
                        ? "https://www.googleapis.com/auth/drive.file"
                        : "https://www.googleapis.com/auth/drive")))
                .setOptOutIncludingGrantedScopes(true); // Picker cannot mix scopes; full permission follows in a separate consent.
        if (showPicker) {
            request.addResourceParameter(AuthorizationRequest.ResourceParameter.PICKER_OAUTH_TRIGGER, "true");
            request.addResourceParameter(AuthorizationRequest.ResourceParameter.PICKER_ALLOW_FOLDER_SELECTION, "true");
            request.addResourceParameter(AuthorizationRequest.ResourceParameter.PICKER_ALLOW_MULTIPLE, "false");
            request.setPrompt(AuthorizationRequest.Prompt.CONSENT | AuthorizationRequest.Prompt.SELECT_ACCOUNT);
        }
        return request.build();
    }

    private void applyToken(AuthorizationResult result) {
        drive.setToken(result.getAccessToken());
        driveTokenAt = SystemClock.elapsedRealtime();
    }

    private void startDriveAuthorization(boolean showPicker, boolean interactive) {
        drivePickerActive = showPicker;
        driveAuthorizationBusy = true;
        Identity.getAuthorizationClient(this).authorize(driveRequest(showPicker))
                .addOnSuccessListener(result -> {
                    if (result.hasResolution()) {
                        if (!interactive) {
                            driveAuthorizationBusy = false;
                            return;
                        }
                        try {
                            startIntentSenderForResult(result.getPendingIntent().getIntentSender(),
                                    PICK_DRIVE_AUTH, null, 0, 0, 0);
                        } catch (IntentSender.SendIntentException error) {
                            finishFolderChoice(null, error);
                        }
                    } else {
                        driveAuthorizationBusy = false;
                        completeDriveAuthorization(result);
                    }
                })
                .addOnFailureListener(error -> finishFolderChoice(null, error));
    }

    private void completeDriveAuthorization(AuthorizationResult result) {
        if (drivePickerActive) {
            String selected = result.getTokenResponseParams() == null ? ""
                    : result.getTokenResponseParams().getString("picked_file_ids", "");
            if (selected.isEmpty() || selected.contains(",")) {
                finishFolderChoice(null, new IOException("Choose exactly one Google Drive save folder."));
                return;
            }
            pendingDriveRootId = selected; // Persist only after Google's second, explicit authorization.
            drivePickerActive = false;
            // drive.file cannot read existing PC-authored children inside a picked
            // directory. Request full Drive scope separately, then enforce the
            // picked-folder sandbox ourselves. Do not promise a false migration.
            new AlertDialog.Builder(this).setTitle("Allow access to your existing PC saves?")
                    .setMessage("Google's folder-only permission cannot read all existing save files within that folder. "
                            + "To synchronize the same PC saves, Android requires broader Google Drive authorization. "
                            + "Hobunji Hollow will only read and write the folder you selected. "
                            + "You can cancel without changing any saves.")
                    .setPositiveButton("Continue", (dialog, which) -> startDriveAuthorization(false, true))
                    .setNegativeButton("Cancel", (dialog, which) -> finishFolderChoice(null,
                            new android.os.OperationCanceledException("Google Drive connection cancelled.")))
                    .show();
            return;
        }
        try { applyToken(result); }
        catch (Exception error) { finishFolderChoice(null, error); return; }
        if (pendingDriveRootId != null) {
            final String root = pendingDriveRootId; // Validation/persistence stays off the UI thread.
            io.execute(() -> {
                try {
                    drive.rememberRoot(root, "Google Drive saves");
                    finishFolderChoice(new JSONObject().put("tree", drive.rootTree())
                            .put("name", drive.rootName()), null);
                } catch (Exception error) { finishFolderChoice(null, error); }
            });
        } else {
            try { finishFolderChoice(new JSONObject().put("granted", true), null); }
            catch (Exception error) { finishFolderChoice(null, error); }
        }
    }

    private void ensureDriveToken(boolean interactive, TokenCallback callback) {
        if (driveTokenAt != 0 && SystemClock.elapsedRealtime() - driveTokenAt < DRIVE_TOKEN_REFRESH_MS) {
            callback.done(true, null);
            return;
        }
        Identity.getAuthorizationClient(this).authorize(driveRequest(false))
                .addOnSuccessListener(result -> {
                    if (result.hasResolution()) {
                        callback.done(false, new SecurityException("Google Drive sign-in is required. Use Reconnect in Local Save Folder."));
                    } else {
                        try { applyToken(result); callback.done(true, null); }
                        catch (Exception error) { callback.done(false, error); }
                    }
                })
                .addOnFailureListener(error -> callback.done(false, error));
    }

    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == PICK_FILE) {
            if (filePickerCallback != null) {
                filePickerCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
                filePickerCallback = null;
            }
            return;
        }
        if (code == PICK_DRIVE_AUTH) {
            driveAuthorizationBusy = false;
            if (pickerReply == null) return;
            if (result != RESULT_OK || data == null) {
                finishFolderChoice(null, new android.os.OperationCanceledException("Google Drive authorization was cancelled."));
                return;
            }
            try { completeDriveAuthorization(Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(data)); }
            catch (Exception error) { finishFolderChoice(null, error); }
            return;
        }
        if (code != PICK_FOLDER || pickerReply == null) return;
        JavaScriptReplyProxy proxy = pickerReply;
        int id = pickerRequestId;
        pickerReply = null;
        pickerRequestId = -1;
        if (result != RESULT_OK || data == null || data.getData() == null) {
            reply(proxy, id, null, new android.os.OperationCanceledException("Folder selection cancelled."));
            return;
        }
        Uri uri = data.getData();
        try {
            int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            getContentResolver().takePersistableUriPermission(uri, flags);
            if ((flags & Intent.FLAG_GRANT_WRITE_URI_PERMISSION) == 0) {
                throw new SecurityException("Choose a folder that permits writing save files.");
            }
            files.remember(uri);
            androidx.documentfile.provider.DocumentFile folder = androidx.documentfile.provider.DocumentFile.fromTreeUri(this, uri);
            String name = folder == null ? "Hobunji Saves" : folder.getName();
            reply(proxy, id, new JSONObject().put("tree", uri.toString())
                    .put("name", name == null ? "Hobunji Saves" : name), null);
        } catch (Exception error) {
            reply(proxy, id, null, error);
        }
    }

    @Override protected void onPause() {
        if (web != null && !updates.isInvokingInstaller()) {
            // The ordinary 30-second timer may be suspended in Android's
            // background; ask the existing save owner for a best-effort flush.
            web.evaluateJavascript("window.HobunjiAndroidFiles?.syncOnPause?.().catch(()=>{});", null);
        }
        super.onPause();
    }

    @Override public void onBackPressed() {
        if (exitPending || web == null) return;
        new AlertDialog.Builder(this).setTitle("Hobunji Hollow")
                .setItems(new String[] { "Keep Playing", "Save and Exit", "Check for Updates", "Check Nelk Art" },
                        (dialog, which) -> {
                            if (which == 1) askGameToSave();
                            if (which == 2) updates.check(true);
                            if (which == 3) checkNelkArt();
                        })
                .show();
    }

    private void askGameToSaveForUpdate() {
        if (web == null || web.getUrl() == null) {
            try {
                updates.onSaveResult(new JSONObject().put("ok", false)
                        .put("error", "The game has not finished loading."));
            } catch (Exception error) { Log.e(TAG, "Could not report update save state", error); }
            return;
        }
        // Wait for the same canonical folder/browser write as Save and Exit,
        // but report separately so the game window stays alive until installation.
        web.evaluateJavascript("(async()=>{let result;try{result=await window.HobunjiAndroidFiles.saveBeforeExit();}"
                + "catch(error){result={ok:false,error:String(error)}}"
                + "window.HobunjiAndroidHost.postMessage(JSON.stringify({id:-3,op:'updateSaveResult',args:result}));})();", null);
    }

    @Override protected void onResume() {
        super.onResume();
        if (updates != null) updates.onResume();
    }

    private void checkNelkArt() {
        // Runs only on request; no recurring GPU readback or diagnostic polling.
        web.evaluateJavascript("(async()=>{let report;try{report=await window.HobunjiAndroidFiles.diagnoseNelkArt();}"
                + "catch(error){report={ok:false,error:String(error)}}"
                + "window.HobunjiAndroidHost.postMessage(JSON.stringify({id:-2,op:'nelkArtDiagnostics',args:report}));})();", null);
    }

    private void showNelkArtDiagnostics(JSONObject result) {
        // On-device report is selectable/copyable without adb, a laptop, or DevTools.
        String message = "Fresh Nelk composition: " + (result.optBoolean("ok") ? "PASS" : "FAIL")
                + "\nCanvas: " + result.optString("pixels", "not produced")
                + "\nPrevious composition failures: " + result.optInt("previousFailures")
                + "\nTotal failures: " + result.optInt("totalFailures")
                + "\nError: " + result.optString("error", "(none)")
                + "\nLast compositor error: " + result.optString("lastFailure", "(none)")
                + "\nStorage bridge error: " + result.optString("bridgeError", "(none)")
                + "\n\nIf this test passes but a live Nelk is still plain, its avatar frame/apply path needs investigation.";
        runOnUiThread(() -> {
            if (isFinishing()) return;
            new AlertDialog.Builder(this).setTitle("Nelk artwork diagnostics")
                .setMessage(message)
                .setPositiveButton("Copy Report", (dialog, which) -> {
                    android.content.ClipboardManager clipboard = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                    if (clipboard != null) {
                        clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Nelk artwork diagnostics", message));
                        Toast.makeText(this, "Nelk report copied", Toast.LENGTH_SHORT).show();
                    }
                }).setNegativeButton("Close", (dialog, which) -> {}).show();
        });
    }

    private void askGameToSave() {
        if (exitPending) return;
        exitPending = true;
        web.evaluateJavascript("(async()=>{try{const saved=await window.HobunjiAndroidFiles.saveBeforeExit();"
                + "window.HobunjiAndroidHost.postMessage(JSON.stringify({id:-1,op:'quitResult',args:saved}));}"
                + "catch(e){window.HobunjiAndroidHost.postMessage(JSON.stringify({id:-1,op:'quitResult',"
                + "args:{ok:false,error:String(e)}}));}})();", null);
    }

    private void onQuitSaved(JSONObject result) {
        if (!exitPending) return;
        exitPending = false;
        if (result.optBoolean("ok", false)) {
            finish();
            return;
        }
        new AlertDialog.Builder(this).setTitle("Save was not completed")
                .setMessage(result.optString("error", "The local save folder may not contain the latest game data."))
                .setPositiveButton("Retry", (dialog, which) -> askGameToSave())
                .setNeutralButton("Exit Anyway", (dialog, which) -> finish())
                .setNegativeButton("Keep Playing", (dialog, which) -> {})
                .show();
    }

    @Override protected void onDestroy() {
        if (updates != null) updates.close();
        io.execute(() -> {
            files.close();
            drive.close();
        });
        io.shutdown();
        if (filePickerCallback != null) {
            filePickerCallback.onReceiveValue(null);
            filePickerCallback = null;
        }
        if (web != null) web.destroy();
        super.onDestroy();
    }
}

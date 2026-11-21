package com.oolnokk.hobunjihollow;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * The game's existing File System Access bridge backed by a user-picked Google
 * Drive folder. Native authorization never crosses into the WebView. The root
 * is pinned locally after Google Picker returns it; arbitrary JS file IDs are
 * not accepted as new roots.
 */
final class AndroidDriveBackend {
    private static final String PREFS = "hobunji-direct-drive";
    private static final String ROOT_ID = "selectedRoot";
    private static final String BASE = "https://www.googleapis.com/drive/v3/files";
    private static final String UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
    private static final String DIRECTORY = "application/vnd.google-apps.folder";
    private static final int CHUNK = 48 * 1024;
    private static final int MAX_PATH = 24;
    private final Context context; // Provides private, bounded-memory staging files and the selected root preference.
    private final SharedPreferences prefs; // Stores only selected folder ID and display name, never an OAuth token.
    private final Map<String, InputStream> readers = new HashMap<>(); // Open Drive media streams keyed by opaque native session IDs.
    private final Map<String, WriteSession> writers = new HashMap<>(); // Pending files staged in app cache until commit.
    private volatile String token; // Short-lived native-only Google Identity authorization; not persisted.

    private static final class WriteSession {
        final File staging; // Local temporary bytes; upload only after close succeeds.
        final String parentId, canonicalName, previousId, previousVersion, mime; // Optimistic remote-state guard.
        final OutputStream stream; // Bounded stream for the game's 48 KiB message chunks.
        WriteSession(File staging, OutputStream stream, String parent, String name, String id, String version, String mime) {
            this.staging = staging; this.stream = stream; parentId = parent;
            canonicalName = name; previousId = id; previousVersion = version; this.mime = mime;
        }
    }

    AndroidDriveBackend(Context context) {
        this.context = context;
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    String rootId() { return prefs.getString(ROOT_ID, ""); }
    String rootTree() { return "drive:" + rootId(); }
    String rootName() { return prefs.getString("rootName", "Google Drive saves"); }

    void setToken(String accessToken) {
        if (accessToken == null || accessToken.isEmpty()) throw new IllegalArgumentException("Google Drive authorization was not granted.");
        token = accessToken;
    }

    void rememberRoot(String id, String name) throws Exception {
        if (!validId(id)) throw new IOException("Invalid Google Drive folder ID.");
        JSONObject folder = metadata(id);
        if (!DIRECTORY.equals(folder.optString("mimeType")) || folder.optBoolean("trashed"))
            throw new IOException("Select a folder in Google Drive, not an individual file.");
        if (!prefs.edit().putString(ROOT_ID, id).putString("rootName", name).commit())
            throw new IOException("Could not remember selected Google Drive folder.");
    }

    private static boolean validId(String id) {
        return id != null && id.matches("[A-Za-z0-9_-]{10,256}");
    }

    private static String encode(String part) throws Exception {
        return URLEncoder.encode(part, "UTF-8");
    }

    private String checkedRoot(JSONObject args) throws Exception {
        String selected = rootId();
        if (!validId(selected) || !("drive:" + selected).equals(args.optString("tree")))
            throw new SecurityException("This Drive folder has not been approved using Google Picker.");
        if (token == null) throw new SecurityException("Google Drive authorization expired. Reconnect from Local Save Folder.");
        return selected;
    }

    private static JSONArray safePath(JSONObject args) throws Exception {
        JSONArray path = args.optJSONArray("path");
        if (path == null || path.length() > MAX_PATH) throw new IOException("Invalid Drive save path.");
        for (int i = 0; i < path.length(); i++) {
            String part = path.getString(i);
            if (part.isEmpty() || part.length() > 200 || ".".equals(part) || "..".equals(part)
                    || part.indexOf('/') >= 0 || part.indexOf('\\') >= 0)
                throw new IOException("Invalid Drive save filename.");
            for (int j = 0; j < part.length(); j++) if (part.charAt(j) < 32) throw new IOException("Control character in Drive filename.");
        }
        return path;
    }

    private HttpURLConnection connection(String raw, String method, String mime) throws Exception {
        URL url = new URL(raw);
        if (!"https".equals(url.getProtocol()) || !"www.googleapis.com".equals(url.getHost()))
            throw new SecurityException("Drive requests must use the official Google API endpoint.");
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod(method);
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(90000);
        conn.setRequestProperty("Authorization", "Bearer " + token);
        if (mime != null) conn.setRequestProperty("Content-Type", mime);
        conn.setInstanceFollowRedirects(false); // Never forward bearer credentials to a redirect target.
        return conn;
    }

    private static byte[] readLimited(InputStream in, int limit) throws Exception {
        try (InputStream source = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            for (int n; (n = source.read(buf)) != -1;) {
                if (out.size() + n > limit) throw new IOException("Drive response exceeded the permitted size.");
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
    }

    private static void verify(HttpURLConnection conn, int... allowed) throws Exception {
        int code = conn.getResponseCode();
        for (int candidate : allowed) if (code == candidate) return;
        String detail = "";
        if (conn.getErrorStream() != null)
            detail = new String(readLimited(conn.getErrorStream(), 4096), StandardCharsets.UTF_8);
        if (code == 401 || code == 403) throw new SecurityException("Drive access was denied (" + code + "). Reconnect your account.");
        if (code == 404) throw new java.io.FileNotFoundException("Google Drive file or folder is inaccessible.");
        throw new IOException("Google Drive returned HTTP " + code + ": " + detail);
    }

    private JSONObject json(String url, String method, JSONObject body) throws Exception {
        HttpURLConnection conn = connection(url, method, body == null ? null : "application/json; charset=UTF-8");
        try {
            if (body != null) {
                conn.setDoOutput(true);
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream output = conn.getOutputStream()) { output.write(bytes); }
            }
            verify(conn, 200, 201);
            return new JSONObject(new String(readLimited(conn.getInputStream(), 2 * 1024 * 1024), StandardCharsets.UTF_8));
        } finally { conn.disconnect(); }
    }

    private JSONObject metadata(String id) throws Exception {
        if (!validId(id)) throw new IOException("Invalid Drive file ID.");
        return json(BASE + "/" + encode(id) + "?fields=id,name,mimeType,size,modifiedTime,version,trashed,parents", "GET", null);
    }

    private JSONArray children(String parentId, String name) throws Exception {
        if (!validId(parentId)) throw new IOException("Invalid Drive parent ID.");
        JSONArray matches = new JSONArray();
        String page = null;
        do {
            String query = "'" + parentId.replace("'", "\\'") + "' in parents and trashed = false";
            if (name != null) query += " and name = '" + name.replace("\\", "\\\\").replace("'", "\\'") + "'";
            String url = BASE + "?q=" + encode(query) + "&fields=" + encode("nextPageToken,files(id,name,mimeType,size,modifiedTime,version)")
                    + "&pageSize=1000" + (page == null ? "" : "&pageToken=" + encode(page));
            JSONObject result = json(url, "GET", null);
            JSONArray files = result.optJSONArray("files");
            if (files != null) for (int i = 0; i < files.length(); i++) matches.put(files.getJSONObject(i));
            page = result.optString("nextPageToken", "");
        } while (page != null && !page.isEmpty() && matches.length() < 10000);
        if (matches.length() >= 10000) throw new IOException("The Drive folder contains too many files to enumerate safely.");
        return matches;
    }

    private JSONObject child(String parent, String name) throws Exception {
        JSONArray matches = children(parent, name);
        if (matches.length() > 1) throw new IOException("Ambiguous duplicate names in Google Drive: " + name + ". Resolve duplicates before saving.");
        return matches.length() == 0 ? null : matches.getJSONObject(0);
    }

    private JSONObject create(String parent, String name, String type) throws Exception {
        return json(BASE + "?fields=id,name,mimeType,size,modifiedTime,version", "POST",
                new JSONObject().put("name", name).put("mimeType", type).put("parents", new JSONArray().put(parent)));
    }

    private String parent(JSONObject args, int size, boolean createMissing) throws Exception {
        String folder = checkedRoot(args);
        JSONArray parts = safePath(args);
        for (int i = 0; i < size; i++) {
            String name = parts.getString(i);
            JSONObject next = child(folder, name);
            if (next == null) {
                if (!createMissing) throw new java.io.FileNotFoundException("Missing Drive save directory " + name);
                next = create(folder, name, DIRECTORY);
            }
            if (!DIRECTORY.equals(next.optString("mimeType"))) throw new IOException("Drive save directory name is occupied by a file: " + name);
            folder = next.getString("id");
        }
        return folder;
    }

    private JSONObject item(JSONObject args, boolean create, boolean directory) throws Exception {
        JSONArray path = safePath(args);
        if (path.length() == 0) return metadata(checkedRoot(args));
        String parent = parent(args, path.length() - 1, create);
        String name = path.getString(path.length() - 1);
        JSONObject item = child(parent, name);
        if (item == null) {
            if (!create) throw new java.io.FileNotFoundException("Missing Drive save item: " + name);
            item = create(parent, name, directory ? DIRECTORY : mimeFor(name));
        }
        if (directory != DIRECTORY.equals(item.optString("mimeType"))) throw new IOException("Wrong Google Drive save entry type: " + name);
        return item;
    }

    private static String mimeFor(String name) { return name.endsWith(".png") ? "image/png" : "application/json"; }

    private String sessionId() { return UUID.randomUUID().toString(); }

    private JSONObject startRead(JSONObject args) throws Exception {
        JSONObject file = item(args, false, false);
        HttpURLConnection conn = connection(BASE + "/" + encode(file.getString("id")) + "?alt=media", "GET", null);
        try {
            verify(conn, 200);
            String id = sessionId();
            readers.put(id, new java.io.FilterInputStream(conn.getInputStream()) {
                @Override public void close() throws IOException { super.close(); conn.disconnect(); }
            });
            return new JSONObject().put("id", id);
        } catch (Exception error) { conn.disconnect(); throw error; }
    }

    private JSONObject readChunk(JSONObject args) throws Exception {
        String id = args.getString("id");
        InputStream stream = readers.get(id);
        if (stream == null) throw new IOException("Unknown Drive read session.");
        byte[] data = new byte[CHUNK];
        int count = stream.read(data);
        if (count < 0) return new JSONObject().put("base64", "").put("eof", true);
        return new JSONObject().put("base64", Base64.encodeToString(data, 0, count, Base64.NO_WRAP))
                .put("eof", false);
    }

    private JSONObject startWrite(JSONObject args) throws Exception {
        JSONArray parts = safePath(args);
        if (parts.length() == 0) throw new IOException("Cannot replace a Drive folder.");
        String parentId = parent(args, parts.length() - 1, false);
        String name = parts.getString(parts.length() - 1);
        JSONObject old = child(parentId, name);
        if (old != null && DIRECTORY.equals(old.optString("mimeType"))) throw new IOException("Cannot overwrite a Google Drive directory.");
        File file = File.createTempFile("hobunji-drive-", ".part", context.getCacheDir());
        String id = sessionId();
        writers.put(id, new WriteSession(file, new FileOutputStream(file), parentId, name,
                old == null ? null : old.getString("id"),
                old == null ? null : old.optString("version"), mimeFor(name)));
        return new JSONObject().put("id", id);
    }

    private void verifyUnchanged(WriteSession write) throws Exception {
        JSONObject now = child(write.parentId, write.canonicalName);
        if (write.previousId == null) {
            if (now != null) throw new IOException("Drive file was created on another device. Load or reconcile before saving.");
        } else if (now == null || !write.previousId.equals(now.optString("id"))
                || !write.previousVersion.equals(now.optString("version"))) {
            throw new IOException("Drive save changed on another device. Existing Drive data was not overwritten; Load from Folder or recover.");
        }
    }

    private JSONObject upload(WriteSession session) throws Exception {
        JSONObject metadata = new JSONObject().put("name", session.canonicalName)
                .put("parents", new JSONArray().put(session.parentId))
                .put("mimeType", session.mime);
        String boundary = "hobunji-" + UUID.randomUUID().toString();
        byte[] prefix = ("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
                + metadata + "\r\n--" + boundary + "\r\nContent-Type: " + session.mime + "\r\n\r\n")
                .getBytes(StandardCharsets.UTF_8);
        byte[] suffix = ("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8);
        // Create a completely uploaded new revision before modifying its canonical filename.
        String draftName = ".hobunji-pending-" + UUID.randomUUID();
        metadata.put("name", draftName);
        prefix = ("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
                + metadata + "\r\n--" + boundary + "\r\nContent-Type: " + session.mime + "\r\n\r\n")
                .getBytes(StandardCharsets.UTF_8);
        HttpURLConnection conn = connection(UPLOAD + "?uploadType=multipart&fields=id,name,version", "POST",
                "multipart/related; boundary=" + boundary);
        try {
            conn.setDoOutput(true);
            conn.setChunkedStreamingMode(64 * 1024);
            try (OutputStream dst = conn.getOutputStream(); InputStream src = new FileInputStream(session.staging)) {
                dst.write(prefix);
                byte[] bytes = new byte[64 * 1024];
                for (int n; (n = src.read(bytes)) != -1;) dst.write(bytes, 0, n);
                dst.write(suffix);
            }
            verify(conn, 200, 201);
            return new JSONObject(new String(readLimited(conn.getInputStream(), 16384), StandardCharsets.UTF_8));
        } finally { conn.disconnect(); }
    }

    private void rename(String id, String name) throws Exception {
        json(BASE + "/" + encode(id) + "?fields=id,name", "PATCH", new JSONObject().put("name", name));
    }

    private void trash(String id) throws Exception {
        json(BASE + "/" + encode(id) + "?fields=id,trashed", "PATCH", new JSONObject().put("trashed", true));
    }

    private JSONObject commit(JSONObject args) throws Exception {
        WriteSession write = writers.remove(args.getString("id"));
        if (write == null) throw new IOException("Unknown Drive writer.");
        try {
            write.stream.close();
            verifyUnchanged(write);
            JSONObject draft = upload(write);
            String draftId = draft.getString("id");
            try {
                verifyUnchanged(write);
                // A recoverable pre-write backup protects the last canonical version.
                // Drive's v3 API does not provide a documented atomic compare-and-swap
                // on media writes, so we refuse stale versions and keep backups.
                if (write.previousId != null) {
                    JSONObject copied = json(BASE + "/" + encode(write.previousId) + "/copy?fields=id", "POST",
                            new JSONObject().put("name", ".hobunji-previous-" + write.canonicalName + "-" + UUID.randomUUID())
                                    .put("parents", new JSONArray().put(write.parentId)));
                    if (!validId(copied.optString("id"))) throw new IOException("Drive backup was not confirmed.");
                    rename(write.previousId, ".hobunji-replaced-" + write.canonicalName + "-" + UUID.randomUUID());
                }
                rename(draftId, write.canonicalName);
                return new JSONObject().put("saved", true);
            } catch (Exception error) {
                // Leave a new draft recoverable if the canonical publication failed.
                // Never trash it when a previous canonical could have been renamed.
                throw error;
            }
        } finally {
            write.staging.delete();
        }
    }

    JSONObject dispatch(String op, JSONObject args) throws Exception {
        if ("permission".equals(op)) return new JSONObject().put("granted", token != null && rootId().length() > 0);
        if ("readChunk".equals(op)) return readChunk(args);
        if ("closeRead".equals(op)) {
            InputStream stream = readers.remove(args.getString("id"));
            if (stream != null) stream.close();
            return new JSONObject();
        }
        if ("writeChunk".equals(op)) {
            WriteSession write = writers.get(args.getString("id"));
            if (write == null) throw new IOException("Unknown Drive writer.");
            byte[] bytes = Base64.decode(args.getString("base64"), Base64.DEFAULT);
            if (bytes.length > CHUNK) throw new IOException("Drive write chunk too large.");
            write.stream.write(bytes);
            return new JSONObject();
        }
        if ("abortWrite".equals(op)) {
            WriteSession write = writers.remove(args.getString("id"));
            if (write != null) { write.stream.close(); write.staging.delete(); }
            return new JSONObject();
        }
        if ("commitWrite".equals(op)) return commit(args);
        checkedRoot(args);
        if ("directory".equals(op)) { item(args, args.optBoolean("create"), true); return new JSONObject(); }
        if ("file".equals(op)) { item(args, args.optBoolean("create"), false); return new JSONObject(); }
        if ("stat".equals(op)) {
            JSONObject file = item(args, false, false);
            long modified = 0;
            try { modified = java.time.Instant.parse(file.optString("modifiedTime")).toEpochMilli(); }
            catch (Exception ignored) {}
            return new JSONObject().put("size", file.optLong("size", 0)).put("modified", modified);
        }
        if ("list".equals(op)) {
            JSONArray path = safePath(args);
            String folderId = parent(args, path.length(), false);
            JSONArray items = children(folderId, null);
            JSONArray response = new JSONArray();
            for (int i = 0; i < items.length(); i++) {
                JSONObject file = items.getJSONObject(i);
                String name = file.optString("name");
                if (name.startsWith(".hobunji-")) continue; // Keep emergency backups out of normal canonical discovery.
                response.put(new JSONObject().put("name", name)
                        .put("kind", DIRECTORY.equals(file.optString("mimeType")) ? "directory" : "file"));
            }
            return new JSONObject().put("items", response);
        }
        if ("openRead".equals(op)) return startRead(args);
        if ("openWrite".equals(op)) return startWrite(args);
        if ("remove".equals(op)) {
            JSONArray path = safePath(args);
            if (path.length() == 0) throw new IOException("Cannot delete your Drive save root.");
            JSONObject file = item(args, false, false);
            trash(file.getString("id"));
            return new JSONObject();
        }
        throw new IOException("Unknown Google Drive file operation: " + op);
    }

    void close() {
        for (InputStream stream : readers.values()) try { stream.close(); } catch (IOException ignored) {}
        readers.clear();
        for (WriteSession write : writers.values()) {
            try { write.stream.close(); } catch (IOException ignored) {}
            write.staging.delete();
        }
        writers.clear();
        token = null;
    }
}

package com.oolnokk.hobunjihollow;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.net.Uri;
import android.util.Base64;
import androidx.documentfile.provider.DocumentFile;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * All Android filesystem access is restricted to the SAF directory approved by
 * the player. No external-storage or MANAGE_EXTERNAL_STORAGE permissions.
 * Executed only by MainActivity's single-threaded I/O executor.
 */
final class AndroidFolderBackend {
    static final String PREFS = "hobunji-android-saves";
    static final String TREE_KEY = "selectedTree";

    private final Context context;
    private final SharedPreferences prefs;
    private final Map<String, InputStream> readers = new HashMap<>(); // Active chunk readers.
    private final Map<String, StagedWrite> writers = new HashMap<>(); // Pending, never-yet-canonical saves.

    private static final class StagedWrite {
        final DocumentFile parent;
        final DocumentFile pending;
        final String canonicalName;
        final OutputStream stream;
        long expectedBytes = 0L; // Verifies every streamed byte made it into the published canonical file.
        StagedWrite(DocumentFile parent, DocumentFile pending, String canonicalName, OutputStream stream) {
            this.parent = parent;
            this.pending = pending;
            this.canonicalName = canonicalName;
            this.stream = stream;
        }
    }

    AndroidFolderBackend(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    void remember(Uri tree) {
        prefs.edit().putString(TREE_KEY, tree.toString()).apply();
    }

    boolean hasPermission(String uri) {
        if (uri == null || !uri.equals(prefs.getString(TREE_KEY, null))) return false;
        for (UriPermission grant : context.getContentResolver().getPersistedUriPermissions()) {
            if (uri.equals(grant.getUri().toString()) && grant.isReadPermission() && grant.isWritePermission()) return true;
        }
        return false;
    }

    private DocumentFile root(String uri) throws IOException {
        if (!hasPermission(uri)) throw new IOException("Save-folder permission is missing. Reconnect the folder.");
        DocumentFile root = DocumentFile.fromTreeUri(context, Uri.parse(uri));
        if (root == null || !root.exists() || !root.isDirectory()) throw new IOException("The selected save folder no longer exists.");
        return root;
    }

    static String safeName(String name) throws IOException {
        if (name == null || name.isEmpty() || name.equals(".") || name.equals("..") || name.length() > 200
                || name.indexOf('/') >= 0 || name.indexOf('\\') >= 0) {
            throw new IOException("Invalid document path segment.");
        }
        for (int i = 0; i < name.length(); i++) if (name.charAt(i) < 0x20) throw new IOException("Control characters are forbidden in paths.");
        return name;
    }

    private String[] segments(JSONObject args) throws JSONException, IOException {
        JSONArray list = args.optJSONArray("path");
        if (list == null || list.length() > 24) throw new IOException("Invalid document path.");
        String[] path = new String[list.length()];
        for (int i = 0; i < path.length; i++) {
            Object segment = list.get(i);
            if (!(segment instanceof String)) throw new IOException("Path must contain only names.");
            path[i] = safeName((String) segment);
        }
        return path;
    }

    private DocumentFile find(JSONObject args, boolean create, boolean dir) throws Exception {
        DocumentFile cursor = root(args.getString("tree"));
        String[] path = segments(args);
        if (path.length == 0) {
            if (!dir) throw new IOException("Expected a file, not the save root.");
            return cursor;
        }
        for (int i = 0; i < path.length; i++) {
            String name = path[i];
            boolean needsDirectory = i < path.length - 1 || dir;
            DocumentFile child = cursor.findFile(name);
            if (child == null && create) {
                child = needsDirectory ? cursor.createDirectory(name)
                        : cursor.createFile(name.toLowerCase().endsWith(".png") ? "image/png" : "application/json", name);
            }
            if (child == null) throw new java.io.FileNotFoundException("Missing save item: " + name);
            if (needsDirectory != child.isDirectory()) throw new IOException("Save item has the wrong type: " + name);
            cursor = child;
        }
        return cursor;
    }

    private DocumentFile findFile(JSONObject args) throws Exception { return find(args, false, false); }
    private DocumentFile findDirectory(JSONObject args) throws Exception { return find(args, false, true); }

    private JSONObject stat(JSONObject args) throws Exception {
        DocumentFile file = findFile(args);
        return new JSONObject().put("size", Math.max(0L, file.length())).put("modified", file.lastModified());
    }

    private JSONArray list(JSONObject args) throws Exception {
        JSONArray values = new JSONArray();
        for (DocumentFile child : findDirectory(args).listFiles()) {
            String name = child.getName();
            if (name == null || name.isEmpty()) continue;
            values.put(new JSONObject().put("name", name).put("kind", child.isDirectory() ? "directory" : "file"));
        }
        return values;
    }

    private JSONObject openRead(JSONObject args) throws Exception {
        InputStream stream = context.getContentResolver().openInputStream(findFile(args).getUri());
        if (stream == null) throw new IOException("Could not open save file for reading.");
        String id = UUID.randomUUID().toString();
        readers.put(id, stream);
        return new JSONObject().put("id", id);
    }

    private JSONObject readChunk(JSONObject args) throws Exception {
        InputStream stream = readers.get(args.getString("id"));
        if (stream == null) throw new IOException("Unknown save read session.");
        byte[] buffer = new byte[48 * 1024];
        int count = stream.read(buffer);
        return new JSONObject()
                .put("base64", count > 0 ? Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP) : "")
                .put("eof", count < 0);
    }

    private JSONObject openWrite(JSONObject args) throws Exception {
        String[] path = segments(args);
        if (path.length == 0) throw new IOException("Cannot overwrite the save directory.");
        JSONObject parentArgs = new JSONObject(args.toString());
        JSONArray parentSegments = new JSONArray();
        for (int i = 0; i < path.length - 1; i++) parentSegments.put(path[i]);
        parentArgs.put("path", parentSegments);
        DocumentFile parent = findDirectory(parentArgs);
        String pendingName = "_hobunji-pending-" + UUID.randomUUID().toString() + ".tmp";
        String type = path[path.length - 1].toLowerCase(java.util.Locale.ROOT).endsWith(".png")
                ? "image/png" : "application/json"; // Keep the final canonical MIME type when publishing the staged file.
        DocumentFile pending = parent.createFile(type, pendingName);
        if (pending == null) throw new IOException("Could not stage a new save file.");
        try {
            OutputStream stream = context.getContentResolver().openOutputStream(pending.getUri(), "wt");
            if (stream == null) throw new IOException("Android storage provider refused the write.");
            String id = UUID.randomUUID().toString();
            writers.put(id, new StagedWrite(parent, pending, path[path.length - 1], stream));
            return new JSONObject().put("id", id);
        } catch (Exception error) {
            pending.delete();
            throw error;
        }
    }

    private JSONObject writeChunk(JSONObject args) throws Exception {
        StagedWrite session = writers.get(args.getString("id"));
        if (session == null) throw new IOException("Unknown save write session.");
        String base64 = args.getString("base64");
        if (base64.length() > 80_000) throw new IOException("Android save chunk too large.");
        byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
        if (bytes.length > 48 * 1024) throw new IOException("Decoded save chunk too large.");
        session.stream.write(bytes);
        session.expectedBytes += bytes.length;
        return new JSONObject().put("written", bytes.length);
    }

    private JSONObject abortWrite(JSONObject args) throws Exception {
        StagedWrite session = writers.remove(args.getString("id"));
        if (session != null) {
            try { session.stream.close(); } finally { session.pending.delete(); }
        }
        return new JSONObject().put("aborted", true);
    }

    private JSONObject commitWrite(JSONObject args) throws Exception {
        StagedWrite session = writers.remove(args.getString("id"));
        if (session == null) throw new IOException("Unknown save write session.");
        try {
            session.stream.flush();
            session.stream.close();
        } catch (Exception error) {
            session.pending.delete();
            throw error;
        }
        DocumentFile original = session.parent.findFile(session.canonicalName);
        if (original != null && !original.isFile()) {
            session.pending.delete();
            throw new IOException("Canonical save destination is not a file.");
        }
        // Rename the prior canonical file aside BEFORE publishing staged bytes.
        // A provider that cannot rename safely fails rather than truncating the save.
        boolean oldRenamed = false;
        String backupName = session.canonicalName + ".android-backup-" + UUID.randomUUID();
        if (original != null) {
            oldRenamed = original.renameTo(backupName);
            if (!oldRenamed) {
                session.pending.delete();
                throw new IOException("Storage provider cannot safely rename the old save; original was preserved.");
            }
        }
        if (!session.pending.renameTo(session.canonicalName)) {
            if (oldRenamed) original.renameTo(session.canonicalName);
            session.pending.delete();
            throw new IOException("Could not publish staged save; prior version retained as " + backupName);
        }
        // Provider rename operations sometimes silently change an extension.
        // Keep the previous version if the canonical name cannot be found.
        DocumentFile published = session.parent.findFile(session.canonicalName);
        if (published == null || !published.isFile() || published.length() != session.expectedBytes) {
            if (published != null) published.delete();
            if (oldRenamed) original.renameTo(session.canonicalName);
            throw new IOException("Storage provider did not publish the expected canonical filename; previous save was retained.");
        }
        // A leftover backup is safer than deleting the only surviving prior version.
        if (oldRenamed && original != null) original.delete();
        return new JSONObject().put("saved", true);
    }

    JSONObject dispatch(String op, JSONObject args) throws Exception {
        switch (op) {
            case "permission":
                return new JSONObject().put("granted", hasPermission(args.getString("tree")));
            case "directory":
                find(args, args.optBoolean("create", false), true);
                return new JSONObject().put("ok", true);
            case "file":
                find(args, args.optBoolean("create", false), false);
                return new JSONObject().put("ok", true);
            case "stat": return stat(args);
            case "list": return new JSONObject().put("items", list(args));
            case "remove":
                String[] path = segments(args);
                if (path.length == 0) throw new IOException("Cannot delete the save root.");
                DocumentFile entry = find(args, false, false);
                if (!entry.delete()) throw new IOException("Could not delete save file.");
                return new JSONObject().put("deleted", true);
            case "openRead": return openRead(args);
            case "readChunk": return readChunk(args);
            case "closeRead":
                InputStream stream = readers.remove(args.getString("id"));
                if (stream != null) stream.close();
                return new JSONObject().put("closed", true);
            case "openWrite": return openWrite(args);
            case "writeChunk": return writeChunk(args);
            case "commitWrite": return commitWrite(args);
            case "abortWrite": return abortWrite(args);
            default: throw new IOException("Unknown Android save operation.");
        }
    }

    void close() {
        for (InputStream stream : readers.values()) try { stream.close(); } catch (Exception ignored) {}
        readers.clear();
        for (StagedWrite session : writers.values()) {
            try { session.stream.close(); } catch (Exception ignored) {}
            session.pending.delete();
        }
        writers.clear();
    }
}

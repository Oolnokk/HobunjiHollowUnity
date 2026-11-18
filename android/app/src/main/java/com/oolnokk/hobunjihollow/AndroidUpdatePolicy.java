package com.oolnokk.hobunjihollow;

import java.util.Locale;

/** Pure rules shared by the Android release checker and its JVM unit tests. */
final class AndroidUpdatePolicy {
    static final String ANDROID_TAG_PREFIX = "android-v0.1.";
    static final String RELEASE_API = "https://api.github.com/repos/Oolnokk/HobunjiHollowUnity/releases?per_page=100";
    static final int RELEASE_VERSION_OFFSET = 1000;
    static final long MAX_APK_BYTES = 600L * 1024 * 1024;

    private AndroidUpdatePolicy() {}

    static long versionCodeFromTag(String tag) {
        if (tag == null || !tag.startsWith(ANDROID_TAG_PREFIX)) return -1;
        String suffix = tag.substring(ANDROID_TAG_PREFIX.length());
        if (suffix.isEmpty() || !suffix.matches("[1-9][0-9]{0,8}")) return -1;
        try {
            long code = RELEASE_VERSION_OFFSET + Long.parseLong(suffix);
            return code <= Integer.MAX_VALUE ? code : -1;
        } catch (NumberFormatException ex) { return -1; }
    }

    static boolean isNewer(String tag, long installedCode) {
        return versionCodeFromTag(tag) > installedCode;
    }

    static boolean safeAssetUrl(String tag, String url) {
        if (versionCodeFromTag(tag) < 0 || url == null) return false;
        String prefix = "https://github.com/Oolnokk/HobunjiHollowUnity/releases/download/" + tag + "/";
        return url.startsWith(prefix) && url.endsWith(".apk")
                && url.length() > prefix.length() + 4
                && url.substring(prefix.length()).matches("[A-Za-z0-9._-]+");
    }

    static String hexDigest(String digest) {
        if (digest == null || !digest.matches("sha256:[a-fA-F0-9]{64}")) return null;
        return digest.substring("sha256:".length()).toLowerCase(Locale.ROOT);
    }

    static boolean safeSize(long bytes) {
        return bytes > 0 && bytes <= MAX_APK_BYTES;
    }
}

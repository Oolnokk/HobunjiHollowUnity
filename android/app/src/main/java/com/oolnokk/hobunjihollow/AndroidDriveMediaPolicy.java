package com.oolnokk.hobunjihollow;

import java.net.URL;
import java.util.Locale;

/** Strict URL allowlist for Drive's redirect-based binary downloads. */
final class AndroidDriveMediaPolicy {
    private AndroidDriveMediaPolicy() {}

    static boolean canDownload(URL url) {
        if (url == null || !"https".equalsIgnoreCase(url.getProtocol()) ||
                url.getUserInfo() != null || (url.getPort() != -1 && url.getPort() != 443)) return false;
        String host = url.getHost().toLowerCase(Locale.ROOT); // A suffix must include a dot to reject evilgoogleapis.com.
        return "www.googleapis.com".equals(host) ||
                host.endsWith(".googleapis.com") ||
                host.endsWith(".googleusercontent.com");
    }

    static boolean needsBearer(URL url) {
        return canDownload(url) && "www.googleapis.com".equalsIgnoreCase(url.getHost());
    }
}

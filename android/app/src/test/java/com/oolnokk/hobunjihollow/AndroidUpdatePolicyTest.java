package com.oolnokk.hobunjihollow;

import org.junit.Test;
import static org.junit.Assert.*;

public class AndroidUpdatePolicyTest {
    @Test public void onlyMonotonicAndroidReleaseVersionsAreEligible() {
        assertEquals(1001, AndroidUpdatePolicy.versionCodeFromTag("android-v0.1.1"));
        assertEquals(1234, AndroidUpdatePolicy.versionCodeFromTag("android-v0.1.234"));
        assertTrue(AndroidUpdatePolicy.isNewer("android-v0.1.235", 1234));
        assertFalse(AndroidUpdatePolicy.isNewer("android-v0.1.234", 1234));
        assertFalse(AndroidUpdatePolicy.isNewer("android-v0.1.233", 1234));
        assertEquals(-1, AndroidUpdatePolicy.versionCodeFromTag("desktop-v0.1.50"));
        assertEquals(-1, AndroidUpdatePolicy.versionCodeFromTag("android-v0.1.01"));
        assertEquals(-1, AndroidUpdatePolicy.versionCodeFromTag("android-v0.1.x"));
        assertEquals(1000000999, AndroidUpdatePolicy.versionCodeFromTag("android-v0.1.999999999"));
    }

    @Test public void rejectsUnrelatedReleaseAndTraversalUrls() {
        String url = "https://github.com/Oolnokk/HobunjiHollowUnity/releases/download/android-v0.1.235/Hobunji-Hollow-Android-0.1.235.apk";
        assertTrue(AndroidUpdatePolicy.safeAssetUrl("android-v0.1.235", url));
        assertFalse(AndroidUpdatePolicy.safeAssetUrl("android-v0.1.236", url));
        assertFalse(AndroidUpdatePolicy.safeAssetUrl("android-v0.1.235", "http://github.com/Oolnokk/HobunjiHollowUnity/releases/download/android-v0.1.235/test.apk"));
        assertFalse(AndroidUpdatePolicy.safeAssetUrl("android-v0.1.235", url + "?redirect=1"));
        assertFalse(AndroidUpdatePolicy.safeAssetUrl("android-v0.1.235", url.replace("Hobunji-Hollow-Android-0.1.235.apk", "../unsafe.apk")));
        assertFalse(AndroidUpdatePolicy.safeAssetUrl("android-v0.1.235", url.replace("HobunjiHollowUnity", "UntrustedGame")));
    }

    @Test public void requiresCryptographicDigestAndBoundedPayload() {
        String value = "0123456789ABCDEF".repeat(4);
        assertEquals(value.toLowerCase(), AndroidUpdatePolicy.hexDigest("sha256:" + value));
        assertNull(AndroidUpdatePolicy.hexDigest("sha1:" + value));
        assertNull(AndroidUpdatePolicy.hexDigest("sha256:broken"));
        assertTrue(AndroidUpdatePolicy.safeSize(170 * 1024 * 1024));
        assertFalse(AndroidUpdatePolicy.safeSize(0));
        assertFalse(AndroidUpdatePolicy.safeSize(AndroidUpdatePolicy.MAX_APK_BYTES + 1));
    }
}

package com.oolnokk.hobunjihollow;

import org.junit.Test;
import static org.junit.Assert.*;
import java.net.URL;

/** Protect bearer credentials when Google redirects Drive binary downloads. */
public class AndroidDriveMediaPolicyTest {
    @Test public void theOfficialDriveOriginReceivesTheBearer() throws Exception {
        URL drive = new URL("https://www.googleapis.com/drive/v3/files/abc?alt=media");
        assertTrue(AndroidDriveMediaPolicy.canDownload(drive));
        assertTrue(AndroidDriveMediaPolicy.needsBearer(drive));
    }

    @Test public void signedGoogleMediaRedirectsDoNotReceiveBearer() throws Exception {
        URL media = new URL("https://j5-apidata.googleusercontent.com/download/drive/v3/files/abc?token=xyz");
        assertTrue(AndroidDriveMediaPolicy.canDownload(media));
        assertFalse(AndroidDriveMediaPolicy.needsBearer(media));
        URL googleApiMedia = new URL("https://content.googleapis.com/download/drive/v3/files/abc");
        assertTrue(AndroidDriveMediaPolicy.canDownload(googleApiMedia));
        assertFalse(AndroidDriveMediaPolicy.needsBearer(googleApiMedia));
    }

    @Test public void redirectsToUnknownOriginsOrUnsafeProtocolsAreRejected() throws Exception {
        assertFalse(AndroidDriveMediaPolicy.canDownload(new URL("http://www.googleapis.com/drive/v3/files/abc")));
        assertFalse(AndroidDriveMediaPolicy.canDownload(new URL("https://evilgoogleapis.com/steal")));
        assertFalse(AndroidDriveMediaPolicy.canDownload(new URL("https://www.googleapis.com.evil.example/steal")));
        assertFalse(AndroidDriveMediaPolicy.canDownload(new URL("https://googleusercontent.com.attacker.example/steal")));
        assertFalse(AndroidDriveMediaPolicy.canDownload(new URL("https://www.googleapis.com:444/download")));
        assertFalse(AndroidDriveMediaPolicy.canDownload(new URL("https://evil@www.googleapis.com/drive/v3/files/abc")));
        assertFalse(AndroidDriveMediaPolicy.canDownload(new URL("ftp://www.googleapis.com/save")));
        assertTrue(AndroidDriveMediaPolicy.canDownload(new URL("https://www.googleapis.com:443/drive/v3/files/abc")));
    }
}

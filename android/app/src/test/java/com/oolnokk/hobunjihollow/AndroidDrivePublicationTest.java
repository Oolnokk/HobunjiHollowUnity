package com.oolnokk.hobunjihollow;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

/** Runs the production publication policy against a deterministic fake Drive. */
public class AndroidDrivePublicationTest {
    private static final class Fake implements AndroidDrivePublication.Remote {
        final Map<String, String> files = new LinkedHashMap<>(); // Google file ID to remote filename.
        boolean concurrentChange; // Another writer changed the previous version before commit.
        boolean failPublish; // Google's draft rename rejects without modifying the file.
        boolean failRollback; // Google rejects restoration of the previous canonical name.
        boolean lostOldAck; // Old rename happened but its HTTP acknowledgement vanished.
        boolean lostNewAck; // New rename happened but its HTTP acknowledgement vanished.
        boolean anotherWriterPublishes; // Second device creates a canonical between the two renames.

        Fake(boolean existing) {
            files.put("draftId", ".hobunji-pending");
            if (existing) files.put("oldId", "world.json");
        }

        @Override public void verifyUnchanged() throws Exception {
            if (concurrentChange) throw new IOException("File version changed on another device.");
        }

        @Override public void rename(String id, String name) throws Exception {
            if ("draftId".equals(id) && failPublish) throw new IOException("Publish failed");
            if ("oldId".equals(id) && "world.json".equals(name) && failRollback)
                throw new IOException("Rollback failed");
            if (!files.containsKey(id)) throw new IOException("Unknown remote ID");
            files.put(id, name);
            if ("oldId".equals(id) && name.startsWith(".hobunji-previous-")) {
                if (anotherWriterPublishes) files.put("externalId", "world.json");
                if (lostOldAck) throw new IOException("Old rename acknowledgement lost");
            }
            if ("draftId".equals(id) && "world.json".equals(name) && lostNewAck)
                throw new IOException("New rename acknowledgement lost");
        }

        @Override public String canonicalId() {
            for (Map.Entry<String, String> entry : files.entrySet())
                if ("world.json".equals(entry.getValue())) return entry.getKey();
            return null;
        }

        String get(String id) { return files.get(id); }
    }

    @Test public void newSavePublishesWithoutARecoveryCopy() throws Exception {
        Fake drive = new Fake(false);
        assertFalse(AndroidDrivePublication.publish("world.json", "draftId", null, drive));
        assertEquals("world.json", drive.get("draftId"));
        assertEquals(1, drive.files.size());
    }

    @Test public void overwriteRetainsOneOldVersionRatherThanTwoCopies() throws Exception {
        Fake drive = new Fake(true);
        assertTrue(AndroidDrivePublication.publish("world.json", "draftId", "oldId", drive));
        assertEquals("world.json", drive.get("draftId"));
        assertTrue(drive.get("oldId").startsWith(".hobunji-previous-world.json-"));
        assertEquals(2, drive.files.size());
    }

    @Test public void failedPublishRestoresOriginalName() throws Exception {
        Fake drive = new Fake(true);
        drive.failPublish = true;
        try {
            AndroidDrivePublication.publish("world.json", "draftId", "oldId", drive);
            fail("Expected publication failure");
        } catch (IOException error) { assertEquals("Publish failed", error.getMessage()); }
        assertEquals("world.json", drive.get("oldId"));
        assertEquals(".hobunji-pending", drive.get("draftId"));
    }

    @Test public void failedRollbackRetainsARecoverablePreviousVersion() throws Exception {
        Fake drive = new Fake(true);
        drive.failPublish = true;
        drive.failRollback = true;
        try {
            AndroidDrivePublication.publish("world.json", "draftId", "oldId", drive);
            fail("Expected publication failure");
        } catch (IOException error) {
            assertEquals(1, error.getSuppressed().length);
            assertTrue(error.getSuppressed()[0].getMessage().contains("restoration was not confirmed"));
        }
        assertTrue(drive.get("oldId").startsWith(".hobunji-previous-world.json-"));
        assertEquals(".hobunji-pending", drive.get("draftId"));
    }

    @Test public void staleVersionIsNeverRenamed() throws Exception {
        Fake drive = new Fake(true);
        drive.concurrentChange = true;
        try {
            AndroidDrivePublication.publish("world.json", "draftId", "oldId", drive);
            fail("Expected version conflict");
        } catch (IOException ignored) {}
        assertEquals("world.json", drive.get("oldId"));
    }

    @Test public void lostAckForOldMoveRestoresOldSaveName() throws Exception {
        Fake drive = new Fake(true);
        drive.lostOldAck = true;
        try {
            AndroidDrivePublication.publish("world.json", "draftId", "oldId", drive);
            fail("Expected uncertain old rename failure");
        } catch (IOException ignored) {}
        assertEquals("world.json", drive.get("oldId"));
        assertEquals(".hobunji-pending", drive.get("draftId"));
    }

    @Test public void lostAckForNewPublishRecognizesCompletedSave() throws Exception {
        Fake drive = new Fake(true);
        drive.lostNewAck = true;
        assertTrue(AndroidDrivePublication.publish("world.json", "draftId", "oldId", drive));
        assertEquals("world.json", drive.get("draftId"));
        assertTrue(drive.get("oldId").startsWith(".hobunji-previous-world.json-"));
    }

    @Test public void raceWithAnotherWriterDoesNotClobberTheirCanonical() throws Exception {
        Fake drive = new Fake(true);
        drive.anotherWriterPublishes = true;
        try {
            AndroidDrivePublication.publish("world.json", "draftId", "oldId", drive);
            fail("Expected competing writer conflict");
        } catch (IOException ignored) {}
        assertEquals("world.json", drive.get("externalId"));
        assertTrue(drive.get("oldId").startsWith(".hobunji-previous-world.json-"));
        assertEquals(".hobunji-pending", drive.get("draftId"));
    }
}

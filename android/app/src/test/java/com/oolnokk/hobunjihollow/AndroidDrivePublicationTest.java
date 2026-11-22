package com.oolnokk.hobunjihollow;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

/** Exercises the actual publication decision, not a source-text assertion. */
public class AndroidDrivePublicationTest {
    private static final class Fake implements AndroidDrivePublication.Remote {
        final Map<String, String> files = new LinkedHashMap<>(); // In-memory Drive ID -> canonical/backup filenames.
        boolean concurrentChange; // A second device modifies the saved version before the first rename.
        boolean failPublish; // Google rejects the draft's canonical rename after the old version was retained.
        boolean failRollback; // A second failed rename should leave the old backup recoverable.

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
            if (!files.containsKey(id)) throw new IOException("Missing Google file ID");
            files.put(id, name);
        }

        @Override public boolean canonicalExists() {
            return files.containsValue("world.json");
        }

        String get(String id) { return files.get(id); }
    }

    @Test public void firstUploadPublishesWithoutARecoveryFile() throws Exception {
        Fake drive = new Fake(false);
        assertFalse(AndroidDrivePublication.publish("world.json", "draftId", null, drive));
        assertEquals("world.json", drive.get("draftId"));
        assertEquals(1, drive.files.size());
    }

    @Test public void overwriteLeavesOnePreviousVersionInsteadOfTwo() throws Exception {
        Fake drive = new Fake(true);
        assertTrue(AndroidDrivePublication.publish("world.json", "draftId", "oldId", drive));
        assertEquals("world.json", drive.get("draftId"));
        assertTrue(drive.get("oldId").startsWith(".hobunji-previous-world.json-"));
        assertEquals(2, drive.files.size());
    }

    @Test public void failedPublishRestoresTheOriginalCanonical() throws Exception {
        Fake drive = new Fake(true);
        drive.failPublish = true;
        try {
            AndroidDrivePublication.publish("world.json", "draftId", "oldId", drive);
            fail("Expected publication rejection");
        } catch (IOException error) {
            assertEquals("Publish failed", error.getMessage());
        }
        assertEquals("world.json", drive.get("oldId"));
        assertEquals(".hobunji-pending", drive.get("draftId"));
    }

    @Test public void failedRollbackRetainsThePreviousSaveUnderAnExplicitRecoveryName() throws Exception {
        Fake drive = new Fake(true);
        drive.failPublish = true;
        drive.failRollback = true;
        try {
            AndroidDrivePublication.publish("world.json", "draftId", "oldId", drive);
            fail("Expected publication rejection");
        } catch (IOException error) {
            assertEquals(1, error.getSuppressed().length);
            assertTrue(error.getSuppressed()[0].getMessage().contains("recovery name"));
        }
        assertTrue(drive.get("oldId").startsWith(".hobunji-previous-world.json-"));
        assertEquals(".hobunji-pending", drive.get("draftId"));
    }

    @Test public void staleVersionNeverRenamesThePreviousFile() throws Exception {
        Fake drive = new Fake(true);
        drive.concurrentChange = true;
        try {
            AndroidDrivePublication.publish("world.json", "draftId", "oldId", drive);
            fail("Expected version conflict");
        } catch (IOException ignored) {}
        assertEquals("world.json", drive.get("oldId"));
        assertEquals(".hobunji-pending", drive.get("draftId"));
    }
}

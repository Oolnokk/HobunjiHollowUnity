package com.oolnokk.hobunjihollow;

import java.io.IOException;
import java.util.UUID;

/**
 * Small, testable remote publication transaction for existing canonical saves.
 * Google Drive has no atomic rename/CAS across two file resources. This
 * minimizes the non-atomic interval, verifies just before switching, and
 * restores the old canonical name if the new file cannot be published.
 */
final class AndroidDrivePublication {
    interface Remote {
        void verifyUnchanged() throws Exception;
        void rename(String id, String name) throws Exception;
        boolean canonicalExists() throws Exception;
    }

    private AndroidDrivePublication() {}

    /** Returns true if a recoverable previous-version file was created. */
    static boolean publish(String name, String pendingId, String previousId, Remote remote) throws Exception {
        remote.verifyUnchanged();
        boolean moved = false; // True only after Google confirms the old canonical file was renamed.
        if (previousId != null) {
            remote.rename(previousId, ".hobunji-previous-" + name + "-" + UUID.randomUUID());
            moved = true;
        }
        try {
            // A second device could publish between our version check and the
            // rename; fail instead of knowingly adding a duplicate canonical.
            if (remote.canonicalExists())
                throw new IOException("Google Drive changed during publication. The previous save was retained.");
            remote.rename(pendingId, name);
            return moved;
        } catch (Exception publishFailure) {
            if (moved) {
                try {
                    if (!remote.canonicalExists()) remote.rename(previousId, name);
                    else publishFailure.addSuppressed(new IOException(
                            "Another device published the canonical file while rolling back; the previous save remains as a recovery copy."));
                } catch (Exception rollbackFailure) {
                    publishFailure.addSuppressed(new IOException(
                            "The previous save is still present under its recovery name, but restoring the canonical name failed.",
                            rollbackFailure));
                }
            }
            throw publishFailure;
        }
    }
}

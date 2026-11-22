package com.oolnokk.hobunjihollow;

import java.io.IOException;
import java.util.UUID;

/**
 * Minimal, independently tested commit/rollback policy for Drive saves.
 * Google Drive v3 does not expose atomic compare-and-swap across file renames;
 * recover safely from network failures where a rename may have happened even
 * though Android never received its HTTP success response.
 */
final class AndroidDrivePublication {
    interface Remote {
        void verifyUnchanged() throws Exception;
        void rename(String id, String name) throws Exception;
        String canonicalId() throws Exception; // Ground each decision in Google's current file ID, not a guessed status.
    }

    private AndroidDrivePublication() {}

    /** True if an old canonical file was successfully preserved as a backup. */
    static boolean publish(String name, String pendingId, String previousId, Remote remote) throws Exception {
        remote.verifyUnchanged();
        boolean movedOld = false; // Set only after verifying that the previous ID no longer owns the canonical name.
        if (previousId != null) {
            try {
                remote.rename(previousId, ".hobunji-previous-" + name + "-" + UUID.randomUUID());
                movedOld = true;
            } catch (Exception uncertainMove) {
                // Google might have committed the move and lost the response.
                // Recover the previous canonical name only if no other file has it.
                try {
                    String current = remote.canonicalId();
                    if (current == null) remote.rename(previousId, name);
                    else if (!previousId.equals(current)) uncertainMove.addSuppressed(
                            new IOException("Another device changed the canonical name; the earlier file remains recoverable."));
                } catch (Exception recoveryFailure) { uncertainMove.addSuppressed(recoveryFailure); }
                throw uncertainMove;
            }
        }
        try {
            if (remote.canonicalId() != null)
                throw new IOException("Another device published a canonical save during this upload.");
            remote.rename(pendingId, name);
            if (!pendingId.equals(remote.canonicalId()))
                throw new IOException("Google Drive did not confirm the staged file as canonical.");
            return movedOld;
        } catch (Exception uncertainPublish) {
            try {
                String current = remote.canonicalId();
                if (pendingId.equals(current)) return movedOld; // Upload published but acknowledgement was lost.
                if (movedOld && current == null) {
                    remote.rename(previousId, name);
                } else if (movedOld) {
                    uncertainPublish.addSuppressed(new IOException(
                            "The old save remains in recovery: another file now owns the canonical name."));
                }
            } catch (Exception rollbackFailure) {
                uncertainPublish.addSuppressed(new IOException(
                        "Google Drive's prior save remains recoverable, but canonical restoration was not confirmed.",
                        rollbackFailure));
            }
            throw uncertainPublish;
        }
    }
}

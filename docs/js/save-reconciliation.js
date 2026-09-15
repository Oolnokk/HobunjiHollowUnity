// Hobunji Save Reconciliation — pure three-way comparison for filesystem/Drive transports.
// Timestamps and revision counters are diagnostic only; content hashes decide whether each side changed from the shared baseline.
(() => {
  'use strict';

  if (window.HobunjiSaveReconciliation) return;

  function contentHash(envelope) {
    return envelope?.contentHash ? String(envelope.contentHash) : null;
  }

  function result(state, recommendedAction, safeAutomatic, details = {}) {
    return {
      state,
      recommendedAction,
      safeAutomatic,
      ...details,
    };
  }

  function decide({ localEnvelope = null, externalEnvelope = null, baselineContentHash = null } = {}) {
    const localHash = contentHash(localEnvelope); // Current durable local content identity compared against the remembered common base.
    const externalHash = contentHash(externalEnvelope); // Current folder/Drive content identity compared against the same remembered base.
    const baselineHash = baselineContentHash ? String(baselineContentHash) : null; // Last content hash this device knows both sides had in common.

    if (!localHash && !externalHash) {
      return result('empty', 'none', true, { localHash, externalHash, baselineHash, localChanged: false, externalChanged: false });
    }

    if (localHash && externalHash && localHash === externalHash) {
      return result('identical', 'none', true, {
        localHash,
        externalHash,
        baselineHash,
        localChanged: baselineHash ? localHash !== baselineHash : false,
        externalChanged: baselineHash ? externalHash !== baselineHash : false,
      });
    }

    if (!baselineHash) {
      if (localHash && !externalHash) {
        return result('local-only-no-baseline', 'push-local', false, {
          localHash,
          externalHash,
          baselineHash,
          localChanged: true,
          externalChanged: false,
        });
      }
      if (!localHash && externalHash) {
        return result('external-only-no-baseline', 'pull-external', false, {
          localHash,
          externalHash,
          baselineHash,
          localChanged: false,
          externalChanged: true,
        });
      }
      return result('first-link-needs-direction', 'choose-direction', false, {
        localHash,
        externalHash,
        baselineHash,
        localChanged: true,
        externalChanged: true,
      });
    }

    const localChanged = localHash !== baselineHash; // True when the local branch moved since the last common content hash.
    const externalChanged = externalHash !== baselineHash; // True when the folder/Drive branch moved since the last common content hash.

    if (!localHash) {
      return result('local-missing', externalChanged ? 'pull-external' : 'recover-local', false, {
        localHash,
        externalHash,
        baselineHash,
        localChanged,
        externalChanged,
      });
    }

    if (!externalHash) {
      return result('external-missing', 'choose-direction', false, {
        localHash,
        externalHash,
        baselineHash,
        localChanged,
        externalChanged: true,
      });
    }

    if (localChanged && !externalChanged) {
      return result('local-only-change', 'push-local', true, {
        localHash,
        externalHash,
        baselineHash,
        localChanged,
        externalChanged,
      });
    }

    if (!localChanged && externalChanged) {
      return result('external-only-change', 'pull-external', true, {
        localHash,
        externalHash,
        baselineHash,
        localChanged,
        externalChanged,
      });
    }

    return result('conflict', 'preserve-both', false, {
      localHash,
      externalHash,
      baselineHash,
      localChanged,
      externalChanged,
    });
  }

  window.HobunjiSaveReconciliation = Object.freeze({ decide });
})();

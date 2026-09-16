// Folder Save Transaction Journal — pure transaction-record and recovery-decision helpers.
// Filesystem ownership stays in local-save-folder-core.js; this module deliberately
// contains no File System Access API calls so recovery rules are easy to test and tweak.
(() => {
  'use strict';

  if (window.HobunjiFolderTransactionJournal) return;

  const VERSION = 1; // Journal schema version stored with every pending canonical-folder transaction.

  function sortById(items) {
    return [...(items || [])].sort((a, b) => String(a?.id || '').localeCompare(String(b?.id || '')));
  }

  function normalizeLayouts(layouts) {
    const normalized = {}; // Stable key order prevents filesystem directory iteration order from changing snapshot comparisons.
    for (const key of Object.keys(layouts || {}).sort()) normalized[key] = layouts[key];
    return normalized;
  }

  function normalizeSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const meta = snapshot.meta || {};
    return {
      snapshotVersion: Number(snapshot.snapshotVersion) || 1,
      meta: {
        version: meta.version ?? 1,
        characters: sortById(meta.characters),
        worlds: sortById(meta.worlds),
      },
      farmLayouts: normalizeLayouts(snapshot.farmLayouts),
    };
  }

  function snapshotsMatch(a, b) {
    const left = normalizeSnapshot(a);
    const right = normalizeSnapshot(b);
    if (!left || !right) return false;
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function validSnapshotEnvelope(value) {
    return !!(
      value &&
      typeof value === 'object' &&
      Number.isFinite(Number(value.savedAt)) &&
      normalizeSnapshot(value.snapshot)
    );
  }

  function validateRecord(record) {
    if (!record || record.journalVersion !== VERSION) throw new Error('Unsupported folder transaction journal version.');
    if (!record.transactionId || typeof record.transactionId !== 'string') throw new Error('Folder transaction journal is missing its transaction id.');
    if (!validSnapshotEnvelope(record.target)) throw new Error('Folder transaction journal target snapshot is invalid.');
    if (record.before != null && !validSnapshotEnvelope(record.before)) throw new Error('Folder transaction journal before snapshot is invalid.');
    return record;
  }

  function createRecord({ transactionId, startedAt = Date.now(), source = 'save', before = null, target }) {
    const record = {
      journalVersion: VERSION,
      transactionId: String(transactionId || ''),
      startedAt: Number(startedAt) || Date.now(),
      source: String(source || 'save'),
      before,
      target,
    };
    return validateRecord(record);
  }

  function decideRecovery(record, currentSnapshot) {
    const valid = validateRecord(record); // Invalid journals fail closed in the folder core instead of guessing which canonical files are trustworthy.
    if (snapshotsMatch(currentSnapshot, valid.target.snapshot)) {
      return { action: 'finalize-target', envelope: valid.target };
    }
    if (valid.before?.snapshot) {
      return { action: 'rollback-before', envelope: valid.before };
    }
    return { action: 'finish-target', envelope: valid.target };
  }

  window.HobunjiFolderTransactionJournal = Object.freeze({
    VERSION,
    normalizeSnapshot,
    snapshotsMatch,
    validateRecord,
    createRecord,
    decideRecovery,
  });
})();

// Hobunji Save Envelope — transport-neutral wrapper around the portable save snapshot.
// The content hash covers gameplay state only; transport metadata stays outside the snapshot.
(() => {
  'use strict';

  if (window.HobunjiSaveEnvelope) return;

  const FORMAT = 'hobunji-primary-save'; // Written into every canonical bundle so readers can reject unrelated JSON files.
  const FORMAT_VERSION = 1; // Incremented only when this envelope schema changes, not when gameplay save data changes.

  function snapshotApi() {
    return window.HobunjiSaveSnapshot || null;
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== 'object') return value;
    const output = {}; // Receives object keys in stable lexical order for deterministic hashing.
    for (const key of Object.keys(value).sort()) output[key] = canonicalize(value[key]);
    return output;
  }

  function stableStringify(value) {
    return JSON.stringify(canonicalize(value));
  }

  function validateSnapshot(snapshot) {
    const api = snapshotApi(); // Reuses the existing snapshot validator when it has loaded before this module.
    if (api?.validate) return api.validate(snapshot);
    if (!snapshot || typeof snapshot !== 'object') throw new Error('Save snapshot is missing.');
    if (!snapshot.meta || typeof snapshot.meta !== 'object') throw new Error('Save snapshot has no meta object.');
    if (!Array.isArray(snapshot.meta.characters)) throw new Error('Save snapshot has no character list.');
    if (!Array.isArray(snapshot.meta.worlds)) throw new Error('Save snapshot has no world list.');
    if (!snapshot.farmLayouts || typeof snapshot.farmLayouts !== 'object' || Array.isArray(snapshot.farmLayouts)) {
      throw new Error('Save snapshot has invalid farm layouts.');
    }
    return snapshot;
  }

  function cryptoApi() {
    const api = window.crypto; // Supplies random UUIDs and SHA-256 without introducing an external dependency.
    if (!api?.subtle) throw new Error('Web Crypto is unavailable; canonical save hashing cannot run safely.');
    return api;
  }

  function randomId() {
    const api = cryptoApi(); // Generates the stable save-set id used across future revisions of one linked save.
    if (typeof api.randomUUID === 'function') return api.randomUUID();
    const bytes = new Uint8Array(16); // Fallback entropy source for browsers that expose subtle crypto but not randomUUID().
    api.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')); // Converted into an RFC 4122-style UUID string.
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
  }

  async function sha256Text(text) {
    const bytes = new TextEncoder().encode(String(text)); // Encoded stable JSON bytes passed to SubtleCrypto.
    const digest = await cryptoApi().subtle.digest('SHA-256', bytes); // SHA-256 digest used for content identity and conflict reconciliation.
    const hex = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join(''); // Human/debug-friendly digest representation.
    return `sha256:${hex}`;
  }

  async function contentHash(snapshot) {
    validateSnapshot(snapshot);
    return sha256Text(stableStringify(snapshot));
  }

  function validateStructure(envelope) {
    if (!envelope || typeof envelope !== 'object') throw new Error('Save envelope is missing.');
    if (envelope.format !== FORMAT) throw new Error(`Unsupported save envelope format: ${String(envelope.format || 'missing')}.`);
    if (Number(envelope.formatVersion) !== FORMAT_VERSION) {
      throw new Error(`Unsupported save envelope version: ${String(envelope.formatVersion || 'missing')}.`);
    }
    if (!envelope.saveSetId || typeof envelope.saveSetId !== 'string') throw new Error('Save envelope has no save-set id.');
    if (!Number.isInteger(envelope.revision) || envelope.revision < 1) throw new Error('Save envelope has an invalid revision.');
    if (!/^sha256:[0-9a-f]{64}$/i.test(String(envelope.contentHash || ''))) throw new Error('Save envelope has an invalid content hash.');
    if (envelope.parentContentHash != null && !/^sha256:[0-9a-f]{64}$/i.test(String(envelope.parentContentHash))) {
      throw new Error('Save envelope has an invalid parent content hash.');
    }
    if (!envelope.writerId || typeof envelope.writerId !== 'string') throw new Error('Save envelope has no writer id.');
    if (!Number.isFinite(Number(envelope.writtenAt)) || Number(envelope.writtenAt) <= 0) throw new Error('Save envelope has an invalid write time.');
    validateSnapshot(envelope.snapshot);
    return envelope;
  }

  async function create(snapshot, options = {}) {
    const snapshotCopy = cloneJson(validateSnapshot(snapshot)); // Detached copy prevents later gameplay mutation from changing an already-created envelope.
    const parentEnvelope = options.parentEnvelope ? validateStructure(options.parentEnvelope) : null; // Supplies default save-set/revision ancestry when creating the next revision.
    const saveSetId = String(options.saveSetId || parentEnvelope?.saveSetId || randomId()); // Stable identifier shared by all revisions of one portable save set.
    const explicitRevision = Number(options.revision); // Optional caller override used by migration/tests; normal writes increment the parent revision.
    const revision = Number.isInteger(explicitRevision) && explicitRevision >= 1
      ? explicitRevision
      : ((Number(parentEnvelope?.revision) || 0) + 1); // Monotonic app-level revision used for diagnostics, never as sole conflict authority.
    const parentContentHash = options.parentContentHash !== undefined
      ? (options.parentContentHash || null)
      : (parentEnvelope?.contentHash || null); // Immediate ancestry retained for diagnostics while three-way sync uses the remembered baseline hash.
    const writerId = String(options.writerId || 'unknown-writer'); // Anonymous installation id describing the writer without exposing a device name.
    const writtenAt = Number(options.writtenAt) > 0 ? Number(options.writtenAt) : Date.now(); // Informational timestamp shown in UI but never used to choose a conflict winner.
    const hash = await contentHash(snapshotCopy); // Gameplay-content identity used by reconciliation and post-write verification.

    return {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      saveSetId,
      revision,
      contentHash: hash,
      parentContentHash,
      writerId,
      writtenAt,
      snapshot: snapshotCopy,
    };
  }

  async function verify(envelope) {
    validateStructure(envelope);
    const computedHash = await contentHash(envelope.snapshot); // Recomputed payload identity detects truncation, stale writes, and manual corruption.
    return {
      ok: computedHash === envelope.contentHash,
      expectedHash: envelope.contentHash,
      computedHash,
    };
  }

  async function parse(text, { verifyHash = true } = {}) {
    let envelope; // Parsed canonical bundle returned only after structural/hash validation succeeds.
    try {
      envelope = JSON.parse(String(text));
    } catch (error) {
      throw new Error(`Canonical save JSON is unreadable: ${String(error?.message || error)}`);
    }
    validateStructure(envelope);
    if (verifyHash) {
      const result = await verify(envelope); // Hash verification prevents a partially-written canonical file from becoming authoritative.
      if (!result.ok) throw new Error(`Canonical save hash mismatch: expected ${result.expectedHash}, computed ${result.computedHash}.`);
    }
    return envelope;
  }

  function serialize(envelope, { pretty = false } = {}) {
    validateStructure(envelope);
    return JSON.stringify(envelope, null, pretty ? 2 : 0);
  }

  function summary(envelope) {
    validateStructure(envelope);
    const api = snapshotApi(); // Existing snapshot summary keeps character/world/layout counts consistent with older cloud diagnostics.
    return {
      format: envelope.format,
      formatVersion: envelope.formatVersion,
      saveSetId: envelope.saveSetId,
      revision: envelope.revision,
      contentHash: envelope.contentHash,
      parentContentHash: envelope.parentContentHash || null,
      writerId: envelope.writerId,
      writtenAt: envelope.writtenAt,
      snapshot: api?.summary ? api.summary(envelope.snapshot) : null,
    };
  }

  window.HobunjiSaveEnvelope = Object.freeze({
    FORMAT,
    FORMAT_VERSION,
    stableStringify,
    contentHash,
    validateStructure,
    create,
    verify,
    parse,
    serialize,
    summary,
  });
})();

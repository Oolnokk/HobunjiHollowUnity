'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { TextEncoder } = require('util');
const { webcrypto } = require('crypto');

const root = path.resolve(__dirname, '..'); // Resolves browser-module paths from this regression script.
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8'); // Loads production browser modules verbatim for VM execution.

function makeSnapshot() {
  return {
    snapshotVersion: 1,
    meta: {
      version: 1,
      characters: [{ id: 'char-a', nickname: 'Tester', inventory: { berries: 3 } }],
      worlds: [{ id: 'world-a', label: 'Hollow', calendar: { day: 12 } }],
    },
    farmLayouts: {
      'world-a': { worldId: 'world-a', tiles: [[1, 2, 3]] },
    },
  };
}

async function main() {
  const window = { crypto: webcrypto }; // Browser-global stub consumed by the envelope and reconciliation modules.
  const context = vm.createContext({ window, TextEncoder, console }); // VM context executes production browser files without a DOM.
  window.window = window;

  vm.runInContext(read('docs/js/save-sync-envelope.js'), context, { filename: 'save-sync-envelope.js' });
  vm.runInContext(read('docs/js/save-reconciliation.js'), context, { filename: 'save-reconciliation.js' });

  const envelopeApi = window.HobunjiSaveEnvelope; // Production envelope API exercised below for deterministic content identity and tamper detection.
  const reconcile = window.HobunjiSaveReconciliation; // Pure three-way decision API exercised below for offline/cross-device safety.

  const snapshotA = makeSnapshot(); // Baseline gameplay state used to prove stable hashing across key-order differences.
  const snapshotAReordered = {
    farmLayouts: snapshotA.farmLayouts,
    meta: {
      worlds: snapshotA.meta.worlds,
      characters: snapshotA.meta.characters,
      version: 1,
    },
    snapshotVersion: 1,
  }; // Semantically-identical object with different insertion order; its hash must remain identical.

  const hashA = await envelopeApi.contentHash(snapshotA); // Canonical baseline hash reused by reconciliation tests.
  const hashAReordered = await envelopeApi.contentHash(snapshotAReordered); // Hash of reordered keys proves canonical serialization.
  assert.equal(hashA, hashAReordered, 'content hash is stable across object key insertion order');

  const envelopeA = await envelopeApi.create(snapshotA, {
    saveSetId: 'save-set-a',
    revision: 7,
    writerId: 'device-a',
    writtenAt: 1000,
  }); // Known baseline envelope supplies deterministic ancestry for later revisions.
  assert.equal(envelopeA.contentHash, hashA, 'created envelope uses the canonical gameplay content hash');
  assert.equal(envelopeA.parentContentHash, null, 'first envelope has no parent hash');

  const snapshotB = makeSnapshot(); // Local branch state changed while the external copy remains at A.
  snapshotB.meta.characters[0].inventory.berries = 4;
  const envelopeB = await envelopeApi.create(snapshotB, {
    parentEnvelope: envelopeA,
    writerId: 'device-a',
    writtenAt: 2000,
  });
  assert.equal(envelopeB.saveSetId, envelopeA.saveSetId, 'child envelope preserves the save-set id');
  assert.equal(envelopeB.revision, 8, 'child envelope increments the app-level revision');
  assert.equal(envelopeB.parentContentHash, envelopeA.contentHash, 'child envelope records immediate content ancestry');

  const serializedB = envelopeApi.serialize(envelopeB); // Production serialization text round-tripped through hash verification.
  const parsedB = await envelopeApi.parse(serializedB);
  assert.equal(parsedB.contentHash, envelopeB.contentHash, 'serialized canonical bundle verifies and round-trips');

  const tampered = JSON.parse(serializedB); // Mutated copy simulates a partial/manual external edit without updating the hash.
  tampered.snapshot.meta.characters[0].inventory.berries = 999;
  await assert.rejects(() => envelopeApi.parse(JSON.stringify(tampered)), /hash mismatch/i, 'tampered canonical bundle is rejected');

  const snapshotC = makeSnapshot(); // Independent external branch diverging from the same A baseline.
  snapshotC.meta.worlds[0].calendar.day = 13;
  const envelopeC = await envelopeApi.create(snapshotC, {
    parentEnvelope: envelopeA,
    writerId: 'device-b',
    writtenAt: 2100,
  });

  assert.equal(reconcile.decide({ localEnvelope: envelopeA, externalEnvelope: envelopeA, baselineContentHash: envelopeA.contentHash }).state, 'identical');
  assert.equal(reconcile.decide({ localEnvelope: envelopeB, externalEnvelope: envelopeA, baselineContentHash: envelopeA.contentHash }).state, 'local-only-change');
  assert.equal(reconcile.decide({ localEnvelope: envelopeA, externalEnvelope: envelopeC, baselineContentHash: envelopeA.contentHash }).state, 'external-only-change');
  assert.equal(reconcile.decide({ localEnvelope: envelopeB, externalEnvelope: envelopeC, baselineContentHash: envelopeA.contentHash }).state, 'conflict');
  assert.equal(reconcile.decide({ localEnvelope: envelopeB, externalEnvelope: envelopeC }).state, 'first-link-needs-direction');
  assert.equal(reconcile.decide({ localEnvelope: envelopeB, externalEnvelope: null, baselineContentHash: envelopeA.contentHash }).state, 'external-missing');

  const snapshotManySaves = makeSnapshot(); // Represents many offline local commits since the last shared A baseline.
  snapshotManySaves.meta.characters[0].inventory.berries = 42;
  const envelopeManySaves = await envelopeApi.create(snapshotManySaves, {
    saveSetId: envelopeA.saveSetId,
    revision: 57,
    parentContentHash: 'sha256:' + 'b'.repeat(64),
    writerId: 'device-a',
    writtenAt: 9000,
  });
  const manySaveDecision = reconcile.decide({
    localEnvelope: envelopeManySaves,
    externalEnvelope: envelopeA,
    baselineContentHash: envelopeA.contentHash,
  }); // Three-way comparison must not require the local envelope's immediate parent to equal the remote hash.
  assert.equal(manySaveDecision.state, 'local-only-change', 'many offline saves still reconcile from the remembered common baseline');
  assert.equal(manySaveDecision.safeAutomatic, true, 'local-only movement from a common baseline is safe to push automatically');

  console.log('Save sync foundation regression checks passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

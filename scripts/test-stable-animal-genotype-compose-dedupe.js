'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const pending = [];
let composeCalls = 0;
const renderer = {
  genotypeSignature(kind, genotype) {
    return kind + ':' + (genotype?.base?.color || 'none');
  },
  composeFrame(kind, frame, genotype, blinkShut) {
    composeCalls++;
    return new Promise((resolve, reject) => pending.push({ resolve, reject, kind, frame, genotype, blinkShut }));
  },
};

const progression = {
  trees: { companion: [], mount: [], shoulderPet: [] },
  activeEntryForRole() { return null; },
  perkRank() { return 0; },
};

const context = {
  window: null,
  console,
  Promise,
  StableAnimalProgression: progression,
  CreatureGeneticsRender: renderer,
};
context.window = context;
vm.createContext(context);
vm.runInContext(
  fs.readFileSync('docs/js/stable-animal-perk-adjustments.js', 'utf8'),
  context,
  { filename: 'stable-animal-perk-adjustments.js' }
);

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

(async () => {
  const genotype = { base: { color: '#445566' } };
  const first = context.CreatureGeneticsRender.composeFrame('gar-wolf', 'run1', genotype, false);
  const duplicate = context.CreatureGeneticsRender.composeFrame('gar-wolf', 'run1', genotype, false);

  assert.strictEqual(first, duplicate, 'simultaneous identical genotype renders should share the same in-flight promise');
  await flush();
  assert.equal(composeCalls, 1, 'only one underlying canvas composition should start for duplicate per-frame requests');
  let debug = context.StableAnimalPerkAdjustments.getDebug().genotypeCompose;
  assert.deepEqual(JSON.parse(JSON.stringify(debug)), { inFlight: 1, requests: 2, dedupHits: 1 });

  const firstCanvas = { id: 'first-canvas' };
  pending.shift().resolve(firstCanvas);
  const resolved = await Promise.all([first, duplicate]);
  assert.strictEqual(resolved[0], firstCanvas);
  assert.strictEqual(resolved[1], firstCanvas);
  await flush();
  assert.equal(context.StableAnimalPerkAdjustments.getDebug().genotypeCompose.inFlight, 0, 'resolved composites must leave no permanent promise/cache entry');

  const later = context.CreatureGeneticsRender.composeFrame('gar-wolf', 'run1', genotype, false);
  await flush();
  assert.equal(composeCalls, 2, 'a later request after settlement should remain owned by the normal renderer/cache path');
  pending.shift().resolve({ id: 'later-canvas' });
  await later;
  await flush();

  const run2 = context.CreatureGeneticsRender.composeFrame('gar-wolf', 'run2', genotype, false);
  const blink = context.CreatureGeneticsRender.composeFrame('gar-wolf', 'run1', genotype, true);
  await flush();
  assert.equal(composeCalls, 4, 'different frame/blink identities must not be deduplicated together');
  pending.shift().resolve({ id: 'run2' });
  pending.shift().resolve({ id: 'blink' });
  await Promise.all([run2, blink]);
  await flush();

  const failing = context.CreatureGeneticsRender.composeFrame('gar-wolf', 'idle', genotype, false);
  await flush();
  assert.equal(composeCalls, 5);
  pending.shift().reject(new Error('synthetic compose failure'));
  await assert.rejects(failing, /synthetic compose failure/);
  await flush();
  assert.equal(context.StableAnimalPerkAdjustments.getDebug().genotypeCompose.inFlight, 0, 'failed composites must also release the in-flight entry so the renderer can retry');

  const retry = context.CreatureGeneticsRender.composeFrame('gar-wolf', 'idle', genotype, false);
  await flush();
  assert.equal(composeCalls, 6, 'a failed composite should be retryable on the next request');
  pending.shift().resolve({ id: 'retry' });
  await retry;

  debug = context.StableAnimalPerkAdjustments.getDebug().genotypeCompose;
  assert.equal(debug.requests, 7);
  assert.equal(debug.dedupHits, 1);
  console.log('Stable animal genotype compose in-flight dedupe tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

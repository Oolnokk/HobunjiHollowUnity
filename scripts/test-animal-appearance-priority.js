'use strict';
const assert = require('node:assert/strict'); // Assertions for real composer queue behavior.
const fs = require('node:fs'); // Read the shipped compositor, not a duplicate scheduler.
const vm = require('node:vm'); // Execute the production queue in a minimal browser-like context.

const source = fs.readFileSync('docs/js/creature-genetics-render.js', 'utf8'); // Authoritative animal colors/patterns compositor.
const start = source.indexOf('  function safePrefetchPlayerPetFrameAssets('); // Reuses the real scheduler without recreating its implementation.
const stop = source.indexOf('  async function composeFrameNow(', start); // Substitutes only the heavyweight canvas renderer.
assert(start >= 0 && stop > start, 'animal renderer must contain the priority queue');
const scheduler = source.slice(start, stop); // Includes the exact queue priorities, fairness and promotion code.

function harness(failFrame = null, failPrefetch = false) {
  const calls = []; // Records the order complete animal frames are actually composed.
  const prefetch = []; // Records which owned pets have their artwork loaded early.
  const context = { calls, prefetch, failFrame, failPrefetch, Date, Promise, console, window: {} }; // No DOM or real network needed for scheduling.
  vm.runInNewContext(
    [
      "function genotypeSignature(kind, genes) { return genes?.sig || 'same'; }",
      "function eyeStateKey(state) { return state ? 'b' : 'o'; }",
      "function prefetchPlayerPetFrameAssets(kind, frame) { prefetch.push(kind + '/' + frame); if (failPrefetch) throw new Error('optional image lookup unavailable'); }",
      "async function composeFrameNow(kind, frame) { calls.push(frame); if (frame === failFrame) throw new Error('incomplete colors or patterns'); return frame; }",
      scheduler,
      "globalThis.api = { composeFrame, promoteFrame, snapshot: () => ({ pending: composePending, active: composeActive, failures: composeFailures, petStarts: composePetStarts, promotions: composePromotions }) };",
    ].join('\n'),
    context,
    { filename: 'creature-genetics-render.js (real scheduler)' },
  );
  return { ...context, api: context.api };
}

async function checkPriorities() {
  const h = harness(); // Source-executed single-job priority behavior.
  const jobs = [
    h.api.composeFrame('wolf', 'wild1', { sig: 'w1' }),
    h.api.composeFrame('wolf', 'wild2', { sig: 'w2' }),
    h.api.composeFrame('wolf', 'owned', { sig: 'p' }, false, { priority: 'pet' }),
    h.api.composeFrame('wolf', 'farm', { sig: 'f' }, false, { priority: 'farm' }),
  ];
  assert.equal((await Promise.all(jobs)).join(','), 'wild1,wild2,owned,farm', 'each consumer receives its own correct composition');
  assert.equal(h.calls.join(','), 'owned,farm,wild1,wild2', 'complete pet appearance outranks farm animals and wildlife');
  assert.equal(h.prefetch.join(','), 'wolf/owned', 'prefetch only player-owned appearance art');
  assert.equal(h.api.snapshot().pending, 0);
  assert.equal(h.api.snapshot().active, 0);
}
async function checkFairness() {
  const h = harness(); // No farm/wildlife starvation during many pet requests.
  const jobs = [];
  for (let i = 1; i <= 5; i++) jobs.push(h.api.composeFrame('wolf', 'pet' + i, { sig: 'p' + i }, false, 'pet'));
  jobs.push(h.api.composeFrame('wolf', 'wild', { sig: 'w' }));
  await Promise.all(jobs);
  assert.equal(h.calls.join(','), 'pet1,pet2,pet3,pet4,wild,pet5', 'four-pet burst gives non-pet work a fairness turn');
}
async function checkPromotionAndRetry() {
  const h = harness('bad'); // A wild request upgraded by a pet must not be composited twice.
  const jobs = [
    h.api.composeFrame('wolf', 'wild', { sig: 'w' }),
    h.api.composeFrame('wolf', 'promoted', { sig: 'p' }),
    h.api.composeFrame('wolf', 'bad', { sig: 'b' }),
  ];
  assert.equal(h.api.promoteFrame('wolf', 'promoted', 'p', false, 'pet'), true);
  assert.equal(h.api.promoteFrame('wolf', 'promoted', 'p', false, 'pet'), false, 'second promotion does not duplicate/reorder completed request');
  const settled = await Promise.allSettled(jobs);
  assert.equal(h.calls.join(','), 'promoted,wild,bad');
  assert.equal(settled[2].status, 'rejected', 'failed composite must reject instead of caching incomplete patterns');
  assert.equal(settled[0].status, 'fulfilled');
  assert.equal(h.api.snapshot().failures, 1);
  assert.equal(h.api.snapshot().promotions, 1);
  assert.equal(h.prefetch.join(','), 'wolf/promoted', 'promoting an in-flight wildlife request begins the required pet pattern downloads');
  assert.equal(h.api.snapshot().pending, 0, 'failed work always releases the queue');
}
async function checkOptionalPrefetchFailure() {
  const h = harness(null, true); // Source-art discovery is advisory; a missing CDN file must not strand a pet's compositor job.
  const jobs = [
    h.api.composeFrame('wolf', 'wild', { sig: 'w' }),
    h.api.composeFrame('wolf', 'promoted', { sig: 'p' }),
    h.api.composeFrame('wolf', 'owned', { sig: 'pet' }, false, { priority: 'pet' }),
  ];
  assert.equal(h.api.promoteFrame('wolf', 'promoted', 'p', false, 'pet'), true,
    'an optional prefetch failure must not prevent wild-to-pet queue promotion');
  const frames = await Promise.all(jobs); // Both direct and promoted pet work still reaches the canonical renderer.
  assert.equal(frames.join(','), 'wild,promoted,owned');
  assert.equal(h.calls.join(','), 'promoted,owned,wild', 'an earlier promoted pet retains FIFO order ahead of a later pet request');
  assert.equal(h.api.snapshot().pending, 0);
  assert.equal(h.api.snapshot().failures, 0, 'only actual pixel-compose failures count as failures');
}
(async () => {
  await checkPriorities();
  await checkFairness();
  await checkPromotionAndRetry();
  await checkOptionalPrefetchFailure();
  console.log('Animal colors, patterns, pet-first scheduling, fairness, promotion and retry passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

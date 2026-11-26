#!/usr/bin/env node
'use strict';

// Native Node regression for the Animation Author's expensive startup pipeline.
// Run via: node scripts/run-tests.js animation-author-startup-prefetch
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const page = fs.readFileSync('docs/tools/animation-author/index.html', 'utf8'); // Production editor HTML and inline startup implementation.
const start = page.indexOf('async function executeOrderedPrefetch('); // Locates the exact production download scheduler.
const end = page.indexOf('\nasync function loadRepositoryRuntime(', start); // The following function is the caller, not part of the scheduler.
assert.ok(start > 0 && end > start, 'ordered prefetch helper remains a standalone testable function');
const prefetch = vm.runInNewContext('(' + page.slice(start, end) + ')', { Promise, Math, Error }); // Invokes production logic, not a test-side rewrite.

assert.match(page, /await executeOrderedPrefetch\(REQUIRED_SCRIPTS,/, 'every required runtime script uses bounded parallel prefetch');
assert.match(page, /await executeClassicScript\(prepareRepositoryScript\(sourceCode, relativePath, settings\), sourceUrl\)/,
  'script preparation and execution remain sequential and use their real source URL');
assert.match(page, /stableRevision \? 'default' : 'no-store'/,
  'commit-pinned downloads may be cached, unresolved mutable branch names remain fresh');
assert.match(page, /const databaseDownload = fetchRepoJson\(settings\.dbPath\)/,
  'independent NPC database download overlaps the runtime startup');
const ready = page.slice(page.indexOf('async function onAnimationRepositoryReady()'), page.indexOf('\nasync function initAnimationWorkspaceScene()'));
assert.doesNotMatch(ready, /await loadSingleAvatarAnimationCatalog\(/,
  'initial Multi and Full Character Scale readiness does not block on recursive tree scanning');
const mode = page.slice(page.indexOf('async function setAnimationAuthorMode('), page.indexOf('\nfunction renderAnimationModeChrome('));
assert.match(mode, /mode === 'single' && !animationAuthor\.single\.catalog\.length/,
  'Single-Avatar mode starts its catalog when requested');
assert.match(page, /const untouchedFallback = single\.source\?\.id === 'custom:fallback' && !single\.dirty/,
  'the first catalog animation replaces only an untouched temporary Single-Avatar default');
const library = page.slice(page.indexOf('function renderAnimationNpcLibrary()'), page.indexOf('\nfunction makePortraitCanvas(', page.indexOf('function renderAnimationNpcLibrary()')));
assert.match(library, /new IntersectionObserver\(/, 'NPC previews are lazily observed');
assert.match(library, /enqueueThumbnail\(canvas, npc\)/, 'visible previews reuse the existing single-render worker');
assert.doesNotMatch(library, /buildAvatarRender\(npc\)/, 'hidden NPCs are not rendered eagerly in a burst');
assert.match(page, /thumbnailStartupBlocked: false/, 'the repository loader owns a startup thumbnail gate');
assert.match(page, /if \(state\.thumbnailStartupBlocked\) return;/, 'background rendering cannot start before the workspace is ready');
assert.match(page, /finally \{\s*state\.thumbnailStartupBlocked = false;\s*runThumbnailQueue\(\);/,
  'thumbnail rendering resumes on both successful startup and failure');

async function orderedAndBounded() {
  const inputs = Array.from({ length: 20 }, (_, i) => i); // Numbered stand-in script paths used to test original dependency order.
  const executions = []; // Asserts scripts execute in their declared order even when fetches finish out of order.
  let active = 0, peak = 0; // Measures simultaneous requests and detects accidental unbounded fetches.
  await prefetch(inputs, async value => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, (value % 4) * 3 + 1));
    active--;
    return { value };
  }, async (item, index) => {
    assert.equal(item.value, index, 'the fetched source belongs to the expected script');
    executions.push(index);
  }, 4);
  assert.deepEqual(executions, inputs, 'evaluation order follows REQUIRED_SCRIPTS, never network response order');
  assert.ok(peak > 1 && peak <= 4, 'downloads run concurrently but stay under the mobile cap');
}

async function noRunawayBuffer() {
  const started = []; // Records pending download slots while the first dependency is deliberately blocked.
  let releaseFirst; // Keeps the first script pending so later ones cannot be consumed.
  const gate = new Promise(resolve => { releaseFirst = resolve; });
  const execute = prefetch(Array.from({ length: 12 }, (_, i) => i), async item => {
    started.push(item);
    if (item === 0) await gate;
    return item;
  }, async () => {}, 4);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(started, [0, 1, 2, 3], 'a blocked first script cannot buffer more than four downloaded sources');
  releaseFirst();
  await execute;
  assert.equal(started.length, 12, 'all sources resume after the initial dependency');
}

function visibleThumbnailOnly() {
  const first = { dataset: { maaThumb: 'first' }, isConnected: true }; // One visible NPC thumbnail, not a required startup image.
  const second = { dataset: { maaThumb: 'second' }, isConnected: true }; // Remains hidden until an observer callback arrives.
  const requests = []; // Captures only actual portrait-render work queued by the editor.
  const observers = []; // Lets the regression simulate a viewport intersection without Chromium.
  const container = {
    innerHTML: '',
    querySelectorAll(selector) {
      if (selector === '[data-add-npc]') return [{ dataset: { addNpc: 'first' }, addEventListener() {} }];
      if (selector === 'canvas[data-maa-thumb]') return [first, second];
      return [];
    },
  };
  const documentState = {
    state: { npcs: [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }] },
    $: id => id === 'maaNpcResults' ? container : { value: '' },
    matchesNpc: () => true, escapeHtml: String,
    enqueueThumbnail: (canvas, npc) => requests.push(npc.id),
    addNpcAnimationActor() {},
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; this.stopped = false; observers.push(this); }
      disconnect() { this.stopped = true; }
      observe() {}
      unobserve() {}
    },
  }; // Minimal DOM and visibility proxy for the real editor's NPC library builder.
  const start = page.indexOf('let maaNpcThumbnailObserver = null;');
  const end = page.indexOf('\nfunction makePortraitCanvas(', start);
  assert.ok(start > 0 && end > start, 'library function is independently inspectable');
  const render = new Function(...Object.keys(documentState),
    page.slice(start, end) + '\nreturn renderAnimationNpcLibrary;')(...Object.values(documentState));
  render();
  assert.deepEqual(requests, [], 'hidden NPC portraits never begin rendering on library initialization');
  assert.equal(observers.length, 1, 'observer registered once on first render');
  observers[0].callback([{ target: first, isIntersecting: true }]);
  assert.deepEqual(requests, ['first'], 'entering the viewport queues only the visible portrait');
  render();
  assert.equal(observers[0].stopped, true, 'a library redraw disconnects stale image observers');
}

async function failurePaths() {
  const completed = []; // Records what ran before a simulated failed network response.
  await assert.rejects(
    prefetch([0, 1, 2, 3, 4], async item => {
      if (item === 2) throw Error('simulated HTTP error');
      return item;
    }, async (_source, index) => { completed.push(index); }, 3),
    /simulated HTTP error/,
    'a failed download still interrupts the editor before executing future scripts'
  );
  assert.deepEqual(completed, [0, 1]);
  await assert.rejects(
    prefetch([0, 1], async item => item, async (_source, index) => {
      if (index === 1) throw Error('simulated broken script');
    }, 2),
    /simulated broken script/,
    'a script execution failure still propagates to the existing mobile diagnostics'
  );
}

(async () => {
  await orderedAndBounded();
  await noRunawayBuffer();
  visibleThumbnailOnly();
  await failurePaths();
  console.log('Animation Author startup: ordered bounded downloads, lazy previews, lazy catalog and failure handling PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });

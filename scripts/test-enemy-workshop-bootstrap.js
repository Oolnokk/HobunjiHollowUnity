'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');
const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
(async () => {
  let queue = [];
  const window = {};
  const document = {
    readyState: 'complete',
    currentScript: {
      src: 'https://game.test/docs/js/attachment-rig-latest-authored-snapshot.js',
    },
    createElement: () => ({}),
    head: { appendChild: (s) => queue.push(s) },
  };
  const location = {
    href: 'https://game.test/docs/tools/enemy-loadout-editor/index.html',
    pathname: '/docs/tools/enemy-loadout-editor/index.html',
  };
  vm.runInNewContext(
    fs.readFileSync(
      'docs/js/attachment-rig-latest-authored-snapshot.js',
      'utf8',
    ),
    { window, document, location, URL, console },
  );
  let done = false;
  window.HobunjiLatestAuthoredRigReady.then(() => {
    done = true;
  });
  await tick();
  assert(queue.length === 1);
  queue.shift().onload();
  await tick();
  assert.equal(
    done,
    false,
    'nested rig bootstrap must not finish after its first child',
  );
  let count = 1;
  while (queue.length) {
    queue.shift().onload();
    count++;
    await tick();
  }
  await window.HobunjiLatestAuthoredRigReady;
  assert(count > 15);
  assert(done);
  queue = [];
  let resolveNested;
  const nested = new Promise((resolve) => {
    resolveNested = resolve;
  });
  window.HobunjiLatestAuthoredRigReady = nested;
  document.currentScript.src =
    'https://game.test/docs/js/held-action-animations.js';
  vm.runInNewContext(
    fs.readFileSync('docs/js/held-action-animations.js', 'utf8'),
    { window, document, location, URL, console, Promise },
  );
  await tick();
  let hit = false;
  while (queue.length) {
    const script = queue.shift();
    if (script.src.includes('/attachment-rig-latest-authored-snapshot.js')) {
      script.onload();
      hit = true;
      break;
    }
    script.onload();
    await tick();
  }
  assert(hit, 'the hand bootstrap loads the real nested rig owner');
  await tick();
  assert.equal(
    queue.length,
    0,
    'the hand frame driver must wait while species and mount wrappers are still loading',
  );
  resolveNested();
  await tick();
  assert(
    queue.length === 1,
    'hand dependencies resume once nested rig readiness resolves',
  );
  while (queue.length) {
    queue.shift().onload();
    await tick();
  }
  await window.HobunjiHandRuntimeReady;
  console.log(
    'Enemy workshop: one nested rig bootstrap finishes before the shared hand driver; no double compound-avatar installation',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

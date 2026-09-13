'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const guardPath = path.join(repoRoot, 'docs/js/session-persistence-startup-guard.js');
const loaderPath = path.join(repoRoot, 'docs/js/local-save-folder.js');
const source = fs.readFileSync(guardPath, 'utf8');
const loaderSource = fs.readFileSync(loaderPath, 'utf8');

const guardLoadAt = loaderSource.indexOf('session-persistence-startup-guard.js');
const localFolderCoreAt = loaderSource.indexOf('local-save-folder-core.js');
assert.ok(guardLoadAt >= 0, 'local save bootstrap loads the session persistence startup guard');
assert.ok(localFolderCoreAt > guardLoadAt, 'startup guard loads before local-folder beforeunload persistence');

const listeners = new Map();
const logs = [];
const window = {
  __hobunjiGameStarted: false,
  __farmLog(message, level) { logs.push({ message, level }); },
  addEventListener(type, listener, options) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push({ listener, capture: options === true || !!options?.capture });
  },
};

function dispatch(type) {
  let stopped = false;
  const event = {
    type,
    stopImmediatePropagation() { stopped = true; },
  };
  const ordered = [...(listeners.get(type) || [])].sort((a, b) => Number(b.capture) - Number(a.capture));
  for (const entry of ordered) {
    entry.listener.call(window, event);
    if (stopped) break;
  }
}

vm.runInContext(source, vm.createContext({ window, console }), {
  filename: 'session-persistence-startup-guard.js',
});

let exitSaveCalls = 0;
window.addEventListener('beforeunload', () => { exitSaveCalls += 1; });
window.addEventListener('pagehide', () => { exitSaveCalls += 1; });

// Reproduce the reported failure window: game.js has created starter/default
// live collections, but spawnPlayerAvatar() has not finished restoring the
// selected character's persisted member data yet.
dispatch('beforeunload');
dispatch('pagehide');
assert.equal(exitSaveCalls, 0, 'early tab close cannot reach exit persistence while player state is hydrating');
assert.equal(window.HobunjiSessionPersistenceStartupGuard.debugState().blockedExitFlushCount, 2);
assert.equal(window.HobunjiSessionPersistenceStartupGuard.debugState().lastBlockedEvent, 'pagehide');
assert.equal(logs.length, 2, 'blocked exit saves are visible through the in-game debug logger');

// Once spawnPlayerAvatar() reaches its existing final ready assignment, the
// guard becomes transparent and the same exit handlers run normally.
window.__hobunjiGameStarted = true;
dispatch('beforeunload');
dispatch('pagehide');
assert.equal(exitSaveCalls, 2, 'fully hydrated sessions keep normal exit persistence');
assert.equal(window.HobunjiSessionPersistenceStartupGuard.isHydrated(), true);
assert.equal(window.HobunjiSessionPersistenceStartupGuard.debugState().blockedExitFlushCount, 2, 'normal saves do not increment the blocked counter');

console.log('session persistence startup guard regression: ok');

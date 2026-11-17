'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm'); // Executes the actual renderer close-save script without Electron or browser globals.
const { persistBeforeClose, CLOSE_SAVE_SCRIPT } = require('../desktop/close-save.cjs'); // Same final-save operation executed by Electron.
const { GAME_URL, isGameUrl, getGameAsset, localizeGameHtml } = require('../desktop/game-protocol.cjs');

const repo = path.resolve(__dirname, '..'); // Root of the game and desktop packages.
const roots = { gameRoot: path.join(repo, 'docs'), vendorRoot: path.join(repo, 'desktop', 'vendor') }; // File-routing fixtures for the pure protocol helper.
const mapped = url => getGameAsset(url, roots);

assert.equal(GAME_URL, 'hobunji://game/index.html');
assert.equal(isGameUrl(GAME_URL), true);
assert.equal(isGameUrl('https://example.com/index.html'), false);
assert.equal(isGameUrl('hobunji://wrong/index.html'), false);
assert.equal(mapped(GAME_URL).file, path.join(repo, 'docs', 'index.html'));
assert.equal(mapped('hobunji://game/').file, path.join(repo, 'docs', 'index.html'));
assert.equal(mapped('hobunji://game/js/GLTFLoader.js?cache=sample-token').file, path.join(repo, 'docs', 'js', 'GLTFLoader.js'));
assert.equal(mapped('hobunji://game/__desktop_vendor__/three.min.js').kind, 'vendor');
assert.equal(mapped('hobunji://game/__desktop_vendor__/TransformControls.js').kind, 'vendor');

for (const value of [
  'hobunji://wrong/index.html',
  'hobunji://game/__desktop_vendor__/missing.js',
  'hobunji://game/../../secrets.txt',
  'hobunji://game/%2e%2e/%2e%2e/secrets.txt',
  'hobunji://game/assets/%5cWindows',
  'hobunji://game/%00bad',
  'https://example.com/secret',
]) assert.equal(mapped(value), null, 'Blocked unexpected path: ' + value);

const index = fs.readFileSync(path.join(roots.gameRoot, 'index.html'), 'utf8');
const localized = localizeGameHtml(index);
assert.ok(localized.includes('src="/__desktop_vendor__/three.min.js"'));
assert.ok(localized.includes('src="/__desktop_vendor__/TransformControls.js"'));
assert.ok(!localized.includes('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'));
assert.ok(!localized.includes('https://unpkg.com/three@0.128.0/examples/js/controls/TransformControls.js'));
assert.ok(localized.includes('js/local-save-folder.js'), 'Retains existing save code');
assert.ok(localized.includes('game.js'), 'Retains original game entry point');

const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'desktop', 'package.json'), 'utf8'));
assert.equal(manifest.dependencies.three, '0.128.0');
assert.equal(manifest.build.win.target, 'nsis');
assert.ok(manifest.build.extraResources.some(x => x.from === '../docs' && x.to === 'game'));
assert.ok(manifest.build.extraResources.some(x => x.to === 'vendor/three.min.js'));
assert.ok(manifest.build.extraResources.some(x => x.to === 'vendor/TransformControls.js'));
assert.ok(manifest.build.files.includes('close-save.cjs'), 'Final-save policy ships inside the installed app');
const main = fs.readFileSync(path.join(repo, 'desktop', 'main.cjs'), 'utf8');
assert.ok(main.includes('nodeIntegration: false'));
assert.ok(main.includes('contextIsolation: true'));
assert.ok(main.includes('sandbox: true'));
assert.ok(main.includes("require('./close-save.cjs')"), 'Desktop main uses the independently tested save policy');
assert.ok(main.includes('CLOSE_SAVE_SCRIPT'));
assert.ok(main.includes('autoSyncArmed'));

// Each path exercises the real save policy rather than inspecting source text.
async function checkClosePersistence() {
  const calls = []; // Records the ordering of the existing save APIs.
  const folder = {
    getStatus: () => ({ state: 'ready', folderName: 'Hobunji Saves', autoSyncArmed: true }),
    syncNow: async options => { calls.push(['folder', options.reason]); return { state: 'ready', lastAction: 'saved-browser-to-folder' }; },
  }; // Canonical folder writer used for successful close scenarios.
  const runtime = {
    isReady: () => true, // Live serializer readiness must gate writes to the primary save folder.
    captureSnapshot: () => ({ ok: true, captured: true, snapshot: {} }), // Real writer snapshots live gameplay before disk writes.
    flushNow: async options => { calls.push(['browser', options.reason]); return { ok: true, captured: true }; },
  }; // Live browser fallback used whenever the folder is not writable.
  const game = { LocalSaveFolder: folder, HobunjiRuntimeSave: runtime, __hobunjiGameStarted: true }; // Game facade provided by the renderer.

  let output = await persistBeforeClose(game);
  assert.equal(output.ok, true);
  assert.equal(output.mode, 'folder');
  assert.deepEqual(calls, [['folder', 'desktop-window-close']], 'Armed folder write completes without a redundant browser save');

  calls.length = 0;
  output = await vm.runInNewContext(CLOSE_SAVE_SCRIPT, { window: game });
  assert.equal(output.mode, 'folder', 'Serialized renderer script runs without Node APIs');
  assert.equal(calls.length, 1);

  // A ready folder is not proof that the live game's serializer is ready.
  calls.length = 0;
  runtime.isReady = () => false;
  output = await persistBeforeClose(game);
  assert.equal(output.ok, false, 'Do not mirror an outdated browser snapshot when the live serializer is unavailable');
  assert.match(output.error, /serializer is not ready/);
  assert.equal(calls.length, 0, 'Unsafe folder save must never be started');
  runtime.isReady = () => true;
  const liveCapture = runtime.captureSnapshot; // Restored after asserting a missing capture API is rejected.
  delete runtime.captureSnapshot;
  output = await persistBeforeClose(game);
  assert.equal(output.ok, false, 'The serializer must provide a live capture method');
  runtime.captureSnapshot = liveCapture;

  calls.length = 0;
  game.HobunjiAutosavePause = { isPaused: () => true };
  output = await persistBeforeClose(game);
  assert.equal(output.mode, 'paused');
  assert.equal(calls.length, 0, 'Explicit autosave pause is preserved');
  delete game.HobunjiAutosavePause;

  folder.syncNow = async () => ({ state: 'ready', lastAction: 'save-error', lastError: 'Disk is read-only' });
  output = await persistBeforeClose(game);
  assert.equal(output.ok, false);
  assert.match(output.error, /Disk is read-only/);

  folder.syncNow = async () => ({ state: 'ready', lastAction: 'saved-browser-to-folder', dataLossRisk: 'Missing world' });
  output = await persistBeforeClose(game);
  assert.equal(output.ok, false);
  assert.match(output.error, /Missing world/);

  folder.syncNow = async () => ({ state: 'ready', lastAction: 'permission-restored-awaiting-choice' });
  output = await persistBeforeClose(game);
  assert.equal(output.ok, false, 'A ready folder with no completed write must not authorize quitting');

  folder.syncNow = async () => ({ state: 'ready', lastAction: 'saved-primary-recovery-error', lastError: 'Recovery history unavailable' });
  output = await persistBeforeClose(game);
  assert.equal(output.ok, true, 'A completed primary save is valid even if secondary recovery history failed');

  folder.syncNow = async () => null;
  output = await persistBeforeClose(game);
  assert.equal(output.ok, false, 'Missing save status must never count as success');

  calls.length = 0;
  folder.getStatus = () => ({ state: 'ready', folderName: 'Hobunji Saves', autoSyncArmed: false });
  output = await persistBeforeClose(game);
  assert.equal(output.ok, false, 'Connected-but-unarmed folder must display a safe quit warning');
  assert.match(output.error, /not armed/);
  assert.deepEqual(calls, [['browser', 'desktop-window-close']], 'Browser fallback still saves live state before warning');

  calls.length = 0;
  folder.getStatus = () => ({ state: 'needs-permission', folderName: 'Hobunji Saves', autoSyncArmed: false });
  output = await persistBeforeClose(game);
  assert.equal(output.ok, false, 'Disconnected Google Drive folder cannot silently be treated as synchronized');
  assert.deepEqual(calls, [['browser', 'desktop-window-close']]);

  delete game.LocalSaveFolder;
  calls.length = 0;
  output = await persistBeforeClose(game);
  assert.equal(output.ok, true, 'Without a configured folder, live browser saves remain supported');
  assert.deepEqual(calls, [['browser', 'desktop-window-close']]);

  runtime.flushNow = () => ({ ok: true, captured: false });
  output = await persistBeforeClose(game);
  assert.equal(output.ok, false, 'A flush that succeeded without capturing gameplay may never authorize an exit');
  assert.match(output.error, /not captured/);

  runtime.flushNow = () => ({ ok: false, error: 'Storage quota exceeded' });
  output = await persistBeforeClose(game);
  assert.equal(output.ok, false);
  assert.match(output.error, /Storage quota exceeded/);

  delete game.HobunjiRuntimeSave;
  output = await persistBeforeClose(game);
  assert.equal(output.ok, false, 'A missing live serializer cannot silently discard a running game');

  game.__hobunjiGameStarted = false;
  output = await persistBeforeClose(game);
  assert.equal(output.ok, true, 'Closing before gameplay initializes requires no live save');

  console.log('Windows desktop: final-save policy handles armed, paused, unarmed, disconnected and failed writes');
}

checkClosePersistence().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

console.log('Windows desktop protocol, path safety, bundled scripts, persistence and installer configuration OK');

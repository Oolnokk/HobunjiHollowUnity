'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm'); // Executes the actual renderer close-save script without Electron or browser globals.
const { persistBeforeClose, CLOSE_SAVE_SCRIPT } = require('../desktop/close-save.cjs'); // Same final-save operation executed by Electron.
const { GAME_URL, isGameUrl, getGameAsset, localizeGameHtml } = require('../desktop/game-protocol.cjs');
const { configureSaveFolderPermissions } = require('../desktop/save-folder-permissions.cjs'); // Exercised with simulated Electron session events.

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
assert.ok(manifest.build.files.includes('save-folder-permissions.cjs'), 'Native picker policy ships inside the installed app');
const main = fs.readFileSync(path.join(repo, 'desktop', 'main.cjs'), 'utf8');
assert.ok(main.includes('nodeIntegration: false'));
assert.ok(main.includes('contextIsolation: true'));
assert.ok(main.includes('sandbox: true'));
assert.ok(main.includes("require('./close-save.cjs')"), 'Desktop main uses the independently tested save policy');
assert.ok(main.includes('CLOSE_SAVE_SCRIPT'));
assert.ok(main.includes('autoSyncArmed'));

async function checkFolderPickerPermissions() {
  let requestHandler, checkHandler, restrictedHandler; // Captures the actual handlers that Electron receives.
  let nextResponse = 1; // Simulates explicit Allow / Choose Another / Cancel on protected Windows folders.
  let prompts = 0; // Ensures an untrusted document cannot display a privileged permission prompt.
  const gameContents = { getURL: () => GAME_URL }; // Trusted installed game renderer.
  const foreignContents = { getURL: () => 'https://example.invalid' }; // Must never inherit file access.
  const gameWindow = { webContents: gameContents, isDestroyed: () => false }; // Single authorized BrowserWindow.
  const ses = {
    setPermissionRequestHandler: handler => { requestHandler = handler; },
    setPermissionCheckHandler: handler => { checkHandler = handler; },
    on: (event, handler) => { if (event === 'file-system-access-restricted') restrictedHandler = handler; },
  }; // Only the Electron session surface used by the permission module.
  const guard = configureSaveFolderPermissions({
    session: ses, getGameWindow: () => gameWindow,
    dialog: { showMessageBox: async () => { prompts++; return { response: nextResponse }; } },
  });
  assert.equal(checkHandler(gameContents, 'fileSystem', GAME_URL), true, 'Game folder permission passes');
  assert.equal(checkHandler(gameContents, 'fileSystem', undefined), true, 'Missing Chromium origin falls back to the owned game window');
  assert.equal(checkHandler(null, 'fileSystem', 'hobunji://game'), true, 'Origin-only filesystem checks are supported');
  assert.equal(checkHandler(null, 'fileSystem', undefined), false, 'An anonymous origin cannot acquire filesystem access');
  assert.equal(checkHandler(gameContents, 'fileSystem', 'https://example.invalid'), false, 'Foreign permission origin is denied');
  assert.equal(checkHandler(gameContents, 'fileSystem', GAME_URL, { requestingUrl: 'https://example.invalid' }), false, 'Cross-origin iframe cannot borrow the main window permission');
  assert.equal(checkHandler(foreignContents, 'fileSystem', GAME_URL), false, 'Foreign WebContents cannot borrow folder permission');
  assert.equal(checkHandler(gameContents, 'camera', GAME_URL), false, 'Unlisted permissions remain denied');
  let requested = null; // Records Electron permission-request callback results.
  requestHandler(gameContents, 'fileSystem', value => { requested = value; }, { requestingUrl: GAME_URL });
  assert.equal(requested, true);
  requestHandler(gameContents, 'fileSystem', value => { requested = value; }, { requestingUrl: 'https://example.invalid' });
  assert.equal(requested, false);
  let restrictedDecision = null; // Records the native sensitive-path callback.
  await restrictedHandler(null, { origin: 'hobunji://game', webContents: null }, value => { restrictedDecision = value; });
  assert.equal(restrictedDecision, 'allow', 'Null webContents may still present an explicit protected-folder confirmation');
  assert.equal(guard.getDebugStatus().lastRestriction, 'Protected folder explicitly allowed');
  nextResponse = 0;
  await restrictedHandler(null, { origin: GAME_URL, webContents: gameContents }, value => { restrictedDecision = value; });
  assert.equal(restrictedDecision, 'tryAgain', 'Choose Another Folder reopens the native picker');
  nextResponse = 2;
  await restrictedHandler(null, { origin: GAME_URL, webContents: gameContents }, value => { restrictedDecision = value; });
  assert.equal(restrictedDecision, 'deny', 'Cancel is never treated as permission');
  const promptCount = prompts;
  await restrictedHandler(null, { origin: 'https://example.invalid', webContents: gameContents }, value => { restrictedDecision = value; });
  assert.equal(restrictedDecision, 'deny', 'Untrusted restricted-folder requests are denied');
  assert.equal(prompts, promptCount, 'Untrusted requests never get an Allow This Folder prompt');
  console.log('Desktop folder permission policies and restricted-path decisions OK');
}

async function checkFolderPickerAbort() {
  const source = fs.readFileSync(path.join(roots.gameRoot, 'js/local-save-folder-core.js'), 'utf8'); // Actual browser persistence code.
  const window = {
    addEventListener() {},
    showDirectoryPicker: async () => { const error = new Error('Windows denied folder access'); error.name = 'AbortError'; throw error; },
  }; // A Chromium picker that rejects after a folder is selected.
  const db = {
    transaction: () => ({ objectStore: () => ({
      get: () => {
        const request = {}; // Empty existing IndexedDB handle store on a new installation.
        queueMicrotask(() => { request.result = null; request.onsuccess?.(); });
        return request;
      },
    }) }),
  };
  const indexedDB = {
    open: () => {
      const request = {}; // Async IndexedDB open mirrors the renderer's real initialization sequence.
      queueMicrotask(() => { request.result = db; request.onsuccess?.(); });
      return request;
    },
  };
  vm.runInNewContext(source, { window, indexedDB, console, setInterval, clearInterval, setTimeout, clearTimeout });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(window.LocalSaveFolder.getStatus().state, 'not-configured');
  const aborted = await window.LocalSaveFolder.chooseFolder();
  assert.equal(aborted.state, 'not-configured', 'Canceled/blocked picker does not connect a phantom folder');
  assert.equal(aborted.lastAction, 'folder-picker-aborted', 'Chromium AbortError is no longer silently discarded');
  assert.match(aborted.lastError, /Windows denied folder access/, 'Visible diagnostics retain the original rejection reason');
  const primary = fs.readFileSync(path.join(roots.gameRoot, 'js/folder-save-primary.js'), 'utf8'); // Real gate logic, isolated for the early-return scenario.
  const start = primary.indexOf('  async function establishPrimaryFolder(mode) {');
  const end = primary.indexOf('  async function refreshOnboardingIfNeeded(', start);
  assert.ok(start >= 0 && end > start, 'Primary folder gate can be isolated for a safe-cancel regression');
  const factory = new Function('localSave', 'localStorage', 'SAVE_META_KEY', `
    let lastUiError = '';
    let lastUiAction = '';
    ${primary.slice(start, end)}
    return establishPrimaryFolder;
  `);
  let loads = 0; // A canceled Change Folder must not load a previously connected (ready) folder.
  const oldFolder = {
    state: 'ready', lastAction: 'folder-picker-aborted', lastError: 'Picker access blocked',
  };
  const folder = {
    isSupported: () => true,
    getStatus: () => oldFolder,
    changeFolder: async () => oldFolder,
    chooseFolder: async () => oldFolder,
    reconnect: async () => oldFolder,
    loadFromFolder: async () => { loads++; throw new Error('Should never load old folder'); },
  };
  const establish = factory(folder, { getItem: () => null }, 'hobunjiSaveMeta');
  for (const mode of ['choose', 'change', 'reconnect']) {
    const result = await establish(mode);
    assert.equal(result.ok, false, 'Aborted ' + mode + ' reports failure even when the old handle is ready');
    assert.equal(result.message, 'Picker access blocked');
  }
  assert.equal(loads, 0, 'Cancel or blocked selection never triggers an old-folder load');
  console.log('Renderer directory-picker rejection and stale-handle safety OK');
}

checkFolderPickerPermissions().catch(error => { console.error(error); process.exitCode = 1; });
checkFolderPickerAbort().catch(error => { console.error(error); process.exitCode = 1; });

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

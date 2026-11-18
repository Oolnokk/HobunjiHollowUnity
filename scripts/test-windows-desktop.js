'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm'); // Executes the actual renderer close-save script without Electron or browser globals.
const { persistBeforeClose, CLOSE_SAVE_SCRIPT } = require('../desktop/close-save.cjs'); // Same final-save operation executed by Electron.
const { GAME_URL, isGameUrl, getGameAsset, localizeGameHtml } = require('../desktop/game-protocol.cjs');
const { configureSaveFolderPermissions } = require('../desktop/save-folder-permissions.cjs'); // Exercised with simulated Electron session events.
const { WEBGL_STATUS_SCRIPT, describeGraphicsStatus, showGraphicsStatus } = require('../desktop/gpu-diagnostics.cjs'); // On-demand desktop graphics status; never requires a user console.

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
assert.ok(manifest.build.files.includes('gpu-diagnostics.cjs'), 'Graphics diagnostics ship inside the Windows installer');
const main = fs.readFileSync(path.join(repo, 'desktop', 'main.cjs'), 'utf8');
assert.ok(main.includes('nodeIntegration: false'));
assert.ok(main.includes('contextIsolation: true'));
assert.ok(main.includes('sandbox: true'));
assert.ok(main.includes("require('./close-save.cjs')"), 'Desktop main uses the independently tested save policy');
assert.ok(main.includes('CLOSE_SAVE_SCRIPT'));
assert.ok(main.includes('autoSyncArmed'));
assert.ok(main.includes("label: 'Graphics Status'"), 'Game View menu exposes an accessible GPU status dialog');
assert.ok(main.includes('showGraphicsStatus({'), 'Desktop GPU status invokes the tested diagnostic helper');
assert.equal((main.match(/app\.commandLine\.appendSwitch\('force_high_performance_gpu'\)/g) || []).length, 1,
  'Desktop opts into the documented high-performance discrete GPU switch exactly once');
assert.ok(main.indexOf("app.commandLine.appendSwitch('force_high_performance_gpu')") < main.indexOf('app.whenReady()'),
  'GPU preference must be set before Chromium/Electron initialization');
assert.ok(!main.includes("app.commandLine.appendSwitch('force_low_power_gpu')"),
  'Desktop must not also request the integrated/low-power GPU');

// Exercise actual Electron bootstrap order without launching a real Electron window.
const startupCalls = []; // Records GPU preference, protocol registration and second-instance handling in the production main entry point.
const fakeElectronApp = {
  isPackaged: false,
  commandLine: { appendSwitch: name => startupCalls.push('switch:' + name) },
  requestSingleInstanceLock: () => { startupCalls.push('single-instance-lock'); return false; },
  quit: () => startupCalls.push('quit'),
  on: () => {},
}; // Forces the harmless second-instance startup path; no game or updater window is created.
vm.runInNewContext(main, {
  require: name => name === 'electron'
    ? { app: fakeElectronApp, protocol: { registerSchemesAsPrivileged: () => startupCalls.push('protocol') } }
    : name === 'electron-updater' ? { autoUpdater: {} }
      : name.startsWith('./') ? require(path.join(repo, 'desktop', name)) : require(name),
  __dirname: path.join(repo, 'desktop'),
  process, console,
});
assert.deepEqual(startupCalls, ['switch:force_high_performance_gpu', 'protocol', 'single-instance-lock', 'quit'],
  'High-performance GPU preference is actually applied before protocol initialization and app startup');

async function checkGraphicsStatus() {
  const software = describeGraphicsStatus({
    accelerationEnabled: true,
    features: { webgl: 'enabled', gpu_compositing: 'enabled', gpu_rasterization: 'enabled' },
    gpuInfo: { gpuDevice: [{ vendorId: 0x10de, deviceId: 0x1b80, active: true }], auxAttributes: { softwareRendering: false } },
    webgl: { state: 'ready', unmaskedRenderer: 'Google SwiftShader', vendor: 'Google', version: 'WebGL 1', width: 800, height: 600, pixelRatio: 1, contextLost: false },
  });
  assert.match(software, /Software rendering is indicated/, 'SwiftShader is reported as software rendering despite the enabled acceleration setting');
  const hardware = describeGraphicsStatus({
    accelerationEnabled: true, features: { webgl: 'enabled' },
    gpuInfo: { gpuDevice: [{ vendorString: 'NVIDIA', deviceString: 'GeForce GTX', active: true }] },
    webgl: { state: 'ready', unmaskedRenderer: 'ANGLE (NVIDIA GeForce GTX)', unmaskedVendor: 'NVIDIA',
      version: 'WebGL 2', width: 1024, height: 768, pixelRatio: 1.5, contextLost: false },
  });
  assert.match(hardware, /NVIDIA GeForce GTX \[active\]/, 'Native adapter list displays the active card');
  assert.match(hardware, /WebGL is active and Chromium reports an accelerated path/, 'Accelerated WebGL is distinguished from software and uncertain status');
  assert.match(describeGraphicsStatus({}), /Could not confirm a hardware WebGL path/, 'Missing GPU data is explicitly uncertain');

  const fakeGl = {
    VENDOR: 1, RENDERER: 2, VERSION: 3,
    getExtension: key => key === 'WEBGL_debug_renderer_info' ? { UNMASKED_VENDOR_WEBGL: 4, UNMASKED_RENDERER_WEBGL: 5 } : null,
    getParameter: key => ({ 1: 'WebKit', 2: 'WebKit WebGL', 3: 'WebGL 1', 4: 'NVIDIA Corporation', 5: 'ANGLE (NVIDIA GeForce GTX)' })[key],
    isContextLost: () => false,
  }; // Already-created Three.js WebGL context exposed by the game canvas.
  let contextCalls = 0; // Confirms only the game's canvas is used; no expensive frame readbacks or additional renderers.
  const webglCanvas = { width: 1200, height: 700, getContext: () => { contextCalls++; return fakeGl; } };
  const page = { document: { querySelector: selector => selector === '#threeContainer canvas' ? webglCanvas : null },
    window: { devicePixelRatio: 1.25 } };
  const diagnostics = vm.runInNewContext(WEBGL_STATUS_SCRIPT, page);
  assert.equal(diagnostics.state, 'ready', 'Renderer diagnostics read a live WebGL context');
  assert.equal(diagnostics.unmaskedRenderer, 'ANGLE (NVIDIA GeForce GTX)');
  assert.equal(diagnostics.width, 1200);
  assert.equal(contextCalls, 1, 'Already-created WebGL context is reused exactly once');
  assert.equal(vm.runInNewContext(WEBGL_STATUS_SCRIPT, { document: { querySelector: () => null }, window: {} }).state,
    'not-ready', 'A game still loading has an honest diagnostic status');

  let copied = null; // Tests the in-app Copy Details button for users without developer tools.
  let displayed = null; // Captures the dialog content to verify the actual graphics status reaches the screen.
  const gameWindow = { isDestroyed: () => false, webContents: { executeJavaScript: async script => vm.runInNewContext(script, page) } };
  const report = await showGraphicsStatus({
    app: { isHardwareAccelerationEnabled: () => true,
      commandLine: { hasSwitch: name => name === 'force_high_performance_gpu' },
      getGPUFeatureStatus: () => ({ webgl: 'enabled', gpu_compositing: 'enabled' }),
      getGPUInfo: async level => { assert.equal(level, 'basic'); return { gpuDevice: [{ active: true, deviceString: 'GeForce GTX' }] }; } },
    dialog: { showMessageBox: async (_win, dialog) => { displayed = dialog; return { response: 0 }; } },
    clipboard: { writeText: text => { copied = text; } }, getGameWindow: () => gameWindow,
  });
  assert.equal(displayed.title, 'Hobunji Hollow — Graphics Status');
  assert.equal(copied, report, 'GPU status can be copied directly from the game');
  assert.match(report, /ANGLE \(NVIDIA GeForce GTX\)/);
  assert.match(report, /Discrete GPU preference: requested at startup/, 'Native diagnostics proves this build actually requested the dedicated adapter');
  assert.match(describeGraphicsStatus({ highPerformanceRequested: true,
    webgl: { state: 'ready', unmaskedRenderer: 'ANGLE (Intel HD Graphics 530)' },
    features: { webgl: 'enabled' } }), /Renderer: ANGLE \(Intel/,
    'Even after a discrete GPU preference, the actual Intel WebGL renderer is reported without being misrepresented');

  const missingGpu = await showGraphicsStatus({
    app: { isHardwareAccelerationEnabled: () => true,
      getGPUFeatureStatus: () => ({ webgl: 'unavailable_software' }),
      getGPUInfo: async () => { throw new Error('GPU reporting unavailable'); } },
    dialog: { showMessageBox: async (_win, details) => { displayed = details; return { response: 1 }; } },
    getGameWindow: () => ({ isDestroyed: () => false,
      webContents: { executeJavaScript: async () => ({ state: 'unavailable', error: 'No WebGL context yet' }) } }),
  });
  assert.match(missingGpu, /GPU reporting unavailable/, 'Missing native GPU info does not prevent displaying WebGL failure');
  assert.match(missingGpu, /Software rendering is indicated/, 'Chromium software fallback appears in report without a WebGL context');
  assert.equal(displayed.buttons[1], 'Close');
  console.log('Windows graphics status: renderer detection, native GPU flags, fallback and Copy Details OK');
}

checkGraphicsStatus().catch(error => { console.error(error); process.exitCode = 1; });

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
  assert.equal(guard.getDebugStatus().lastFileSystemCheck, 'request denied (renderer present)', 'Desktop diagnostics report ordinary permission rejection');
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
  // Choose/Change failures must not reload the old handle. Reconnect is a
  // deliberate operation on that handle and sets its own fresh status.
  for (const mode of ['choose', 'change']) {
    const result = await establish(mode);
    assert.equal(result.ok, false, 'Aborted ' + mode + ' reports failure even when the old handle is ready');
    assert.equal(result.message, 'Picker access blocked');
  }
  assert.equal(loads, 0, 'Cancel or blocked selection never triggers an old-folder load');
  oldFolder.lastAction = 'choose-error';
  oldFolder.lastError = 'IndexedDB could not store the directory handle';
  for (const mode of ['choose', 'change']) {
    const result = await establish(mode);
    assert.equal(result.ok, false, 'Non-Abort ' + mode + ' errors do not load the old ready folder');
    assert.match(result.message, /IndexedDB/);
  }
  assert.equal(loads, 0, 'Neither picker nor IndexedDB failures can load the previous folder');

  console.log('Renderer directory-picker rejection and stale-handle safety OK');
}

async function checkFolderSwitchTransactions() {
  const source = fs.readFileSync(path.join(roots.gameRoot, 'js/local-save-folder-core.js'), 'utf8'); // Exercise production folder selection and persistence sequencing.
  const missing = () => Object.assign(new Error('File is absent'), { name: 'NotFoundError' }); // Empty portable save directory fixture.
  const handle = name => ({
    name, queryPermission: async () => 'granted',
    getDirectoryHandle: async () => { throw missing(); },
    getFileHandle: async () => { throw missing(); },
  }); // Minimal FileSystemDirectoryHandle sufficient for read-only folder inspection.
  const oldHandle = handle('Existing Saves'); // Previously connected folder must remain authoritative until a new selection commits.
  const newHandle = handle('Google Drive Saves'); // Candidate directory must not receive writes during a failed transition.
  let storedHandle = oldHandle; // Mimics the last durable IndexedDB handle, inspected after each selection.
  let failPut = false; // Simulates a browser profile/IndexedDB storage failure.
  let puts = 0; // Ensures picker rejection cannot alter persisted folder selection.
  const db = { transaction: () => {
    const tx = {
      objectStore: () => ({
        get: () => {
          const request = {}; // Startup reads the previously remembered handle.
          queueMicrotask(() => { request.result = storedHandle; request.onsuccess?.(); });
          return request;
        },
        put: value => {
          puts++;
          queueMicrotask(() => {
            if (failPut) {
              tx.error = Object.assign(new Error('IndexedDB transaction aborted'), { name: 'AbortError' });
              tx.onerror?.();
            } else {
              storedHandle = value;
              tx.oncomplete?.();
            }
          });
        },
      }),
    }; // IndexedDB transaction completes asynchronously as in Chromium.
    return tx;
  } };
  const indexedDB = { open: () => {
    const request = {}; // Simulate browser initialization without a real Windows filesystem.
    queueMicrotask(() => { request.result = db; request.onsuccess?.(); });
    return request;
  } };
  const window = { addEventListener() {}, showDirectoryPicker: async () => newHandle }; // Replaced with failing native-picker variants below.
  vm.runInNewContext(source, { window, indexedDB, console, setInterval, clearInterval, setTimeout, clearTimeout });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(window.LocalSaveFolder.getStatus().state, 'ready', 'Existing saved folder initializes as ready');
  assert.equal(window.LocalSaveFolder.getStatus().folderName, 'Existing Saves');
  for (const name of ['AbortError', 'NotAllowedError', 'SecurityError']) {
    window.showDirectoryPicker = async () => { throw Object.assign(new Error('Native picker rejected'), { name }); };
    const result = await window.LocalSaveFolder.chooseFolder();
    assert.equal(result.state, 'ready', name + ' leaves the old folder connected');
    assert.equal(result.folderName, 'Existing Saves');
    assert.equal(result.lastAction, name === 'AbortError' ? 'folder-picker-aborted' : 'choose-error');
    assert.equal(storedHandle, oldHandle);
  }
  assert.equal(puts, 0, 'Picker errors never write a different IndexedDB handle');

  window.showDirectoryPicker = async () => newHandle;
  failPut = true;
  const databaseFailure = await window.LocalSaveFolder.chooseFolder();
  assert.equal(databaseFailure.lastAction, 'choose-error', 'An IndexedDB AbortError is not confused with picker cancellation');
  assert.equal(databaseFailure.state, 'ready', 'Failed IndexedDB write leaves the existing folder ready');
  assert.equal(databaseFailure.folderName, 'Existing Saves', 'Failed IndexedDB write preserves the active directory handle');
  assert.equal(storedHandle, oldHandle, 'Failed IndexedDB write preserves the remembered directory handle');
  assert.match(databaseFailure.lastError, /IndexedDB transaction aborted/);

  failPut = false;
  const connected = await window.LocalSaveFolder.chooseFolder();
  assert.equal(connected.state, 'ready', 'Successful folder switch eventually becomes ready');
  assert.equal(connected.folderName, 'Google Drive Saves', 'New folder becomes active only after persistence succeeds');
  assert.equal(storedHandle, newHandle, 'New folder is remembered after success');
  assert.equal(connected.autoSyncArmed, false, 'Selecting another directory never initiates automatic writes before an explicit load/save');

  const denied = name => Object.assign(new Error(name + ' is inaccessible on Google Drive'), { name: 'NotAllowedError' }); // Represents an offline or permission-denied directory.
  const blockedCharacters = { ...handle('Blocked Characters'), getDirectoryHandle: async name => {
    if (name === 'characters') throw denied(name);
    throw missing();
  } }; // Read denial must not be mistaken for an empty folder.
  window.showDirectoryPicker = async () => blockedCharacters;
  const unreadableCharacters = await window.LocalSaveFolder.chooseFolder();
  assert.equal(unreadableCharacters.state, 'error', 'Inaccessible character directory blocks folder initialization');
  assert.match(unreadableCharacters.lastError, /Could not access characters save directory/);
  assert.equal(unreadableCharacters.autoSyncArmed, false, 'Folder-access failures do not arm autosync');

  const blockedFarm = { ...handle('Blocked Farm'), getDirectoryHandle: async name => {
    if (name === 'farm-layouts') throw denied(name);
    throw missing();
  } }; // Existing folder farm data cannot silently disappear due to an I/O error.
  window.showDirectoryPicker = async () => blockedFarm;
  const unreadableFarm = await window.LocalSaveFolder.chooseFolder();
  assert.equal(unreadableFarm.state, 'error', 'Inaccessible farm-layout directory blocks folder initialization');
  assert.match(unreadableFarm.lastError, /Could not access farm-layouts save directory/);
  assert.equal(unreadableFarm.autoSyncArmed, false, 'Failed farm inspection cannot write an apparent empty farm');
  console.log('Folder switching and inaccessible cloud-save directory safety OK');
}

checkFolderPickerPermissions().catch(error => { console.error(error); process.exitCode = 1; });
checkFolderPickerAbort().catch(error => { console.error(error); process.exitCode = 1; });
checkFolderSwitchTransactions().catch(error => { console.error(error); process.exitCode = 1; });

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

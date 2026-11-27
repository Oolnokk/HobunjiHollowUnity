'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createDesktopUpdates, CHANNELS, RELEASES_URL, clampPercent } = require('../desktop/update-controller.cjs');

const root = path.resolve(__dirname, '..'); // Local checkout used to validate the packaged resources.
assert.equal(clampPercent(-20), 0);
assert.equal(clampPercent(101), 100);
assert.equal(clampPercent(NaN), 0);

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'desktop/package.json'), 'utf8'));
for (const name of ['update-controller.cjs', 'update-preload.cjs', 'update.html', 'update-ui.js']) {
  assert.ok(manifest.build.files.includes(name), name + ' must ship inside the installer');
}
assert.ok(manifest.dependencies['electron-updater'], 'Auto-updater must be a runtime dependency');
assert.deepEqual(manifest.build.publish.map(x => x.provider), ['github']);
assert.equal(manifest.build.publish[0].owner, 'Oolnokk');
assert.equal(manifest.build.publish[0].repo, 'HobunjiHollowUnity');
assert.ok(manifest.scripts['dist:win'].includes('--publish never'), 'Only main CI publishes updates');

const html = fs.readFileSync(path.join(root, 'desktop/update.html'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'desktop/update-ui.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'desktop/update-preload.cjs'), 'utf8');
const main = fs.readFileSync(path.join(root, 'desktop/main.cjs'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/windows-desktop.yml'), 'utf8');
assert.match(html, /Content-Security-Policy/);
assert.match(html, /Install &amp; Restart/);
assert.match(ui, /'retrying'/, 'Check Now is disabled during retry backoff');
assert.match(ui, /Retry Update Check/, 'Manual retry is labelled after failure');
assert.match(ui, /textContent/, 'Errors/remote release text must not be injected as HTML');
assert.ok(!ui.includes('innerHTML'), 'Update UI must never render untrusted HTML');
assert.match(ui, /\['saving', 'installing'\]\.includes\(phase\)/, 'Later is disabled while saving or restarting');
assert.match(preload, /contextBridge.exposeInMainWorld/);
assert.match(main, /prepareUpdateRestart/);
assert.match(main, /CLOSE_SAVE_SCRIPT/);
assert.match(main, /cancelPreparedRestart/);
assert.match(main, /outcome\.mode !== 'paused'/, 'Dev Companion save freeze must not authorize an update restart');
assert.match(main, /Saving is deliberately paused/, 'Save pause needs an explicit warning');
assert.match(main, /Check for Updates/);
assert.match(workflow, /branches:\s*\n\s*- main/);
assert.match(workflow, /docs\/\*\*/);
assert.match(workflow, /gh release create/);
assert.match(workflow, /latest\.yml/);
assert.match(workflow, /github\.event_name == 'push'/);
assert.match(workflow, /npm version --no-git-tag-version/);

class FakeWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options; // Captures the security preferences applied to the update window.
    this.visible = false; // Allows asserting that Later hides the update screen.
    this.webContents = new EventEmitter(); // IPC origin and outgoing renderer messages.
    this.webContents.isDestroyed = () => false;
    this.webContents.setWindowOpenHandler = handler => { this.newWindowHandler = handler; };
    this.webContents.send = (channel, data) => { this.lastMessage = { channel, data }; };
    FakeWindow.instances.push(this);
  }
  isDestroyed() { return false; }
  loadFile(filename) {
    assert.ok(fs.existsSync(filename), 'Updates window must load only bundled HTML');
    this.webContents.emit('did-finish-load');
    this.emit('ready-to-show');
    return Promise.resolve();
  }
  show() { this.visible = true; }
  hide() { this.visible = false; }
  focus() {}
  close() { this.emit('closed'); }
}
FakeWindow.instances = [];

async function checkUpdater() {
  const handlers = new Map(); // Simulates ipcMain.handle without exposing any game IPC.
  const calls = []; // Records updater network, save and install ordering.
  const updater = new EventEmitter(); // Emits the actual electron-updater event names.
  updater.checkForUpdates = async () => {
    calls.push('check');
    updater.emit('checking-for-update');
    updater.emit('update-available', { version: '0.1.42' });
  };
  updater.quitAndInstall = () => { calls.push('install'); };
  let allowRestart = false; // First restart is cancelled to verify no premature installation.
  let holdSave = false; // Simulates a long-running Google Drive folder write.
  let releaseSave = null; // Test control resolves the simulated save operation.
  const updates = createDesktopUpdates({
    app: { getVersion: () => '0.1.0', isPackaged: true },
    BrowserWindow: FakeWindow,
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    shell: { openExternal: url => { assert.equal(url, RELEASES_URL); calls.push('releases'); } },
    autoUpdater: updater, getGameWindow: () => null,
    prepareRestart: () => {
      calls.push('save');
      return holdSave ? new Promise(resolve => { releaseSave = resolve; }) : Promise.resolve(allowRestart);
    },
    cancelPreparedRestart: () => calls.push('rearm-close'),
    logger: { error: () => {} },
  });
  updates.start({ autoCheck: false });
  updates.start({ autoCheck: false });
  assert.equal(handlers.size, Object.keys(CHANNELS).length - 1, 'Handlers installed exactly once');
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowPrerelease, false);
  await updates.checkNow();
  assert.equal(updates.snapshot().phase, 'downloading');
  assert.equal(FakeWindow.instances.length, 1);
  const win = FakeWindow.instances[0];
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.newWindowHandler().action, 'deny');
  assert.equal(win.visible, true);
  assert.equal(win.lastMessage.data.targetVersion, '0.1.42');

  updater.emit('download-progress', { percent: 57.3 });
  assert.equal(updates.snapshot().percent, 57.3);
  await handlers.get(CHANNELS.later)({ sender: win.webContents });
  assert.equal(win.visible, false);
  updater.emit('update-downloaded', { version: '0.1.42' });
  assert.equal(updates.snapshot().phase, 'downloaded');
  assert.equal(win.visible, false, 'Later must not be undone by background download completion');
  await updates.checkNow();
  assert.deepEqual(calls, ['check'], 'Downloaded updates must not be overwritten by a recheck');
  assert.throws(() => handlers.get(CHANNELS.status)({ sender: {} }), /only available in the update window/);
  updates.open();
  assert.equal(win.visible, true);
  assert.equal((await handlers.get(CHANNELS.status)({ sender: win.webContents })).percent, 100);

  holdSave = true;
  const pendingInstall = updates.install(); // Save is held pending while user attempts to dismiss the window.
  assert.equal(updates.snapshot().phase, 'saving');
  const prematureClose = { prevented: false, preventDefault() { this.prevented = true; } }; // Simulates the native close event.
  win.emit('close', prematureClose);
  assert.equal(prematureClose.prevented, true, 'Closing update window cannot cancel a running save');
  await handlers.get(CHANNELS.later)({ sender: win.webContents });
  assert.equal(win.visible, true, 'Later is ignored while saving');
  releaseSave(false);
  await pendingInstall;
  holdSave = false;
  assert.equal(updates.snapshot().phase, 'downloaded', 'Cancelled saves must preserve the downloaded update');
  assert.deepEqual(calls, ['check', 'save']);
  allowRestart = true;
  await updates.install();
  assert.equal(updates.snapshot().phase, 'installing');
  assert.deepEqual(calls, ['check', 'save', 'save', 'install'], 'Save precedes installer restart');
  updater.emit('error', new Error('Installer failed'));
  assert.equal(updates.snapshot().phase, 'error');
  assert.equal(calls.at(-1), 'rearm-close', 'Closing must be guarded again on installer failure');
  await handlers.get(CHANNELS.releases)({ sender: win.webContents });
  assert.equal(calls.at(-1), 'releases');

  const devUpdater = new EventEmitter(); // Unpackaged runs should not make an updater network request.
  devUpdater.checkForUpdates = () => { throw new Error('unexpected dev update check'); };
  const dev = createDesktopUpdates({
    app: { getVersion: () => '0.1.0', isPackaged: false },
    BrowserWindow: FakeWindow,
    ipcMain: { handle: () => {} },
    shell: { openExternal: () => {} },
    autoUpdater: devUpdater,
    getGameWindow: () => null, prepareRestart: async () => false,
  });
  dev.start({ autoCheck: false });
  await dev.checkNow();
  assert.equal(dev.snapshot().phase, 'unsupported');
  console.log('Windows desktop updater: release feed, sandbox, IPC, progress, Later, safe restart and errors OK');
}

async function checkRetryRecovery() {
  const timeout = Object.assign(new Error('Cannot parse releases feed: Error: HttpError: 504\nHeaders: {"set-cookie":"secret-test-cookie"}\nXML: <feed>private</feed>'), { code: 'ERR_UPDATER_INVALID_RELEASE_FEED' });
  const malformed = Object.assign(new Error('Cannot parse releases feed: invalid XML\nXML: <feed>private</feed>'), { code: 'ERR_UPDATER_INVALID_RELEASE_FEED' });
  const delays = []; // Captures the exact backoff schedule without wall-clock sleeps.
  const logs = []; // Verifies safe diagnostics for both event and promise rejection.
  const updater = new EventEmitter();
  let attempts = 0;
  let failure = timeout;
  let recoverOnAttempt = 0;
  let duringDelay = null;
  let downloadReject = null;
  updater.checkForUpdates = async () => {
    attempts++;
    updater.emit('checking-for-update');
    if (failure && attempts !== recoverOnAttempt) {
      updater.emit('error', failure);
      throw failure;
    }
    if (downloadReject) {
      updater.emit('update-available', { version: '0.1.99' });
      return { downloadPromise: downloadReject };
    }
    updater.emit('update-not-available');
  };
  const updates = createDesktopUpdates({
    app: { getVersion: () => '0.1.0', isPackaged: true },
    BrowserWindow: FakeWindow, ipcMain: { handle: () => {} }, shell: {},
    autoUpdater: updater, getGameWindow: () => null, prepareRestart: async () => false,
    logger: { error: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    delayRetry: async ms => {
      delays.push(ms);
      assert.equal(updates.snapshot().phase, 'retrying');
      assert.match(updates.snapshot().error, /HTTP 504/);
      if (duringDelay) await duringDelay();
    },
  });
  updates.start({ autoCheck: false });
  assert.equal(updater.logger, null, 'Disable raw upstream response logging');
  duringDelay = async () => {
    const before = attempts;
    await updates.checkNow();
    assert.equal(attempts, before, 'Manual/periodic checks cannot overlap a retry');
  };
  await updates.checkNow();
  assert.deepEqual(delays, [5000, 15000, 30000]);
  assert.equal(attempts, 4);
  assert.equal(updates.snapshot().phase, 'error');
  assert.match(updates.snapshot().error, /HTTP 504/);
  assert.equal(logs.length, 4, 'One diagnostic per failed attempt, not per error event');
  assert.doesNotMatch(JSON.stringify([logs, updates.snapshot()]), /secret-test-cookie|<feed>|set-cookie/);
  recoverOnAttempt = attempts + 2;
  delays.length = 0;
  await updates.checkNow();
  assert.deepEqual(delays, [5000]);
  assert.equal(updates.snapshot().phase, 'current');
  assert.equal(updates.snapshot().error, null);
  failure = malformed;
  delays.length = 0;
  await updates.checkNow();
  assert.equal(updates.snapshot().phase, 'error');
  assert.match(updates.snapshot().error, /metadata/);
  assert.deepEqual(delays, [], 'Malformed metadata is not retried');
  for (const [error, expected] of [
    [Object.assign(new Error('not found'), { statusCode: 404 }), /HTTP 404/],
    [Object.assign(new Error('denied'), { statusCode: 403 }), /HTTP 403/],
  ]) {
    failure = error;
    await updates.checkNow();
    assert.match(updates.snapshot().error, expected);
    assert.deepEqual(delays, [], 'Permanent HTTP errors are not retried');
  }

  // A rejected auto-download must be consumed, without starting a large download retry loop.
  failure = null;
  let rejectDownload;
  downloadReject = new Promise((_resolve, reject) => { rejectDownload = reject; });
  await updates.checkNow();
  assert.equal(updates.snapshot().phase, 'downloading');
  const beforeDownloadError = logs.length;
  updater.emit('error', timeout);
  rejectDownload(timeout);
  await Promise.resolve();
  assert.equal(updates.snapshot().phase, 'error');
  assert.match(updates.snapshot().message, /Download failed/);
  assert.equal(logs.length, beforeDownloadError + 1);
  assert.deepEqual(delays, []);
  downloadReject = null;
  await updates.checkNow();
  assert.equal(updates.snapshot().phase, 'current');
  console.log('Windows desktop updater: bounded retries, recovery, safe errors and download rejection OK');
}

checkUpdater().then(checkRetryRecovery).catch(error => {
  console.error(error);
  process.exitCode = 1;
});

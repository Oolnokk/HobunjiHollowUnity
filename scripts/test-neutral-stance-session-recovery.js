'use strict';
// Reproduce a lost stance JSON request and a lost module script during startup.
// Both must recover within one game session while preserving locally authored Neutral.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function timerHarness() {
  const tasks = new Map(); // Synthetic browser timers used to trigger retry attempts deterministically.
  let nextId = 0; // Unique timer identifier for clearTimeout and our test runner.
  return {
    tasks,
    setTimeout(callback, delay) { const id = ++nextId; tasks.set(id, { callback, delay }); return id; },
    clearTimeout(id) { tasks.delete(id); },
    run(delay) {
      const match = [...tasks].find(([, task]) => task.delay === delay); // The next scheduled retry with the expected backoff.
      assert.ok(match, `expected ${delay}ms retry timer`);
      tasks.delete(match[0]);
      match[1].callback();
    },
  };
}

async function testStanceJsonRecovery() {
  const committed = JSON.parse(fs.readFileSync('docs/config/combat/weapon-idle-stances.json', 'utf8')); // Committed baseline fetched after the simulated outage.
  committed.stances.lightWeapon.z = 0.23; // Simulates a newly authored committed stance that an older local override lacks.
  const local = JSON.parse(JSON.stringify(committed)); // Browser override must remain stronger than the downloaded JSON.
  delete local.stances.lightWeapon;
  local.stances.heavyWeapon.y = 0.71;
  const incomplete = JSON.parse(JSON.stringify(committed)); // A cached/partial JSON response must not silently lock one stance to fallback.
  delete incomplete.stances.lightWeapon;
  const timers = timerHarness(); // Controls retry backoff independently of real wall time.
  const logs = []; // Diagnostic lines emitted by the production stance loader.
  let requests = 0; // Count the attempted JSON fetches to detect a permanent one-shot failure.
  const window = { __farmLog: message => logs.push(message) };
  const context = vm.createContext({
    window, console, performance: { now: () => 0 },
    localStorage: { getItem(key) { return key === 'hobunji.weaponIdleStances.v1' ? JSON.stringify(local) : null; } },
    fetch() {
      requests += 1;
      if (requests === 1) return Promise.reject(new Error('temporary connection failure'));
      return Promise.resolve({ ok: true, json: async () => requests === 2 ? incomplete : committed });
    },
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
  });
  for (const filename of ['docs/js/combat/shared-attack-pose.js', 'docs/js/weapon-tool-stances.js']) {
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  }
  const runtime = window.WeaponToolStances; // Public API used by EquipmentPanel and the debug snapshot.
  runtime.init({ TOOL_ITEM_DEFS: {} });
  assert.equal(runtime.poses.heavyWeapon.y, 0.71, 'local pose must be ready before the network response');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1);
  assert.equal(runtime.debugSnapshot().stanceConfigLoaded, false);
  assert.equal(runtime.debugSnapshot().stanceConfigRetryPending, true);
  timers.run(1000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 2, 'a failed request must retry without another init');
  assert.equal(runtime.debugSnapshot().stanceConfigLoaded, false, 'partial config cannot claim success while missing one stance');
  assert.equal(runtime.debugSnapshot().stanceConfigFailures, 2);
  timers.run(2000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 3, 'an incomplete config must retry until all authored stances exist');
  assert.equal(runtime.debugSnapshot().stanceConfigLoaded, true);
  assert.equal(runtime.debugSnapshot().stanceConfigFailures, 0);
  assert.equal(runtime.debugSnapshot().stanceConfigLastError, null);
  assert.equal(runtime.debugSnapshot().stanceConfigSource, 'local-override');
  assert.equal(runtime.poses.heavyWeapon.y, 0.71, 'fetch success must not discard local authored stance');
  assert.equal(runtime.poses.lightWeapon.z, 0.23, 'a partial local override cannot mask a newer committed stance');
  assert.ok(logs.some(line => line.includes('retry in 1000ms')), 'failures should be diagnosable on mobile');
  assert.equal(timers.tasks.size, 0, 'success must clear all retry timers');
  await runtime.reloadConfig();
  assert.equal(requests, 4, 'manual reload still allows refreshing after success');
}

function testDynamicScriptRecovery() {
  const timers = timerHarness(); // Simulates the dynamic script retry timer without browser network access.
  const scripts = []; // Captures inserted script elements so tests can trigger onerror/onload.
  const initialized = []; // Records injection of the original EquipmentPanel deps after recovery.
  const document = {
    addEventListener() {},
    querySelector(selector) { return scripts.find(script => script.isConnected && selector === 'script[data-weapon-tool-stances]') || null; },
    createElement(tag) {
      assert.equal(tag, 'script');
      return {
        dataset: {}, isConnected: false,
        remove() { this.isConnected = false; },
      };
    },
    head: {
      appendChild(script) { script.isConnected = true; scripts.push(script); },
    },
  };
  const window = {
    Combat: {}, MeleePoseSpacing: {},
    EquipmentPanel: { init(deps) { return deps; } },
  };
  vm.runInNewContext(fs.readFileSync('docs/js/combat/combat-loadout.js', 'utf8'), {
    window, document, console,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
  }, { filename: 'docs/js/combat/combat-loadout.js' });
  assert.equal(scripts.length, 1, 'initial stance script starts immediately');
  const deps = { id: 'equipment-dependencies' }; // Injected EquipmentPanel payload must survive the failed script request.
  window.EquipmentPanel.init(deps);
  scripts[0].onerror();
  assert.equal(scripts[0].isConnected, false, 'failed scripts must be removed to permit retries');
  timers.run(1000);
  assert.equal(scripts.length, 2, 'a missing stance module is retried in the same session');
  scripts[0].onerror();
  scripts[0].onload();
  assert.equal(timers.tasks.size, 1, 'stale script events cannot cancel or duplicate the active load deadline');
  window.WeaponToolStances = { init(value) { initialized.push(value); } };
  scripts[1].onload();
  assert.deepEqual(initialized, [deps], 'recovered module receives the captured EquipmentPanel deps');
  assert.equal(timers.tasks.size, 0, 'successful script load clears its deadline');
}

function testEditorExtensionScriptRecovery() {
  const source = fs.readFileSync('docs/js/panel-ui-core.js', 'utf8'); // Production attack-editor-only script loader.
  const start = source.indexOf('// The attack editor has a small extension');
  const end = source.indexOf('// The procedural animator', start);
  assert.ok(start >= 0 && end > start, 'PanelUI routes the stance editor extension');
  const timers = timerHarness(); // Runs in-page retry timers without a real network.
  const scripts = []; // Captures the editor's dynamic script tags to simulate their lifecycle.
  const messages = []; // User-visible debug lines for mobile, even when logDebug is ES-module-scoped.
  const window = {};
  const document = {
    head: { appendChild(script) { script.isConnected = true; scripts.push(script); } },
    getElementById(id) {
      return id === 'logBody' ? { prepend(line) { messages.push(line.textContent); } } : null;
    },
    createElement(tag) {
      if (tag === 'div') return { className: '', textContent: '' };
      assert.equal(tag, 'script');
      return { isConnected: false, remove() { this.isConnected = false; } };
    },
  };
  vm.runInNewContext(source.slice(start, end), {
    window, document, location: { pathname: '/tools/attack-animation-editor/index.html' },
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    Math,
  });
  assert.equal(scripts.length, 1, 'stance editor extension starts immediately');
  scripts[0].onerror();
  assert.equal(scripts[0].isConnected, false, 'failed extension must be removable for retry');
  assert.ok(messages.some(message => message.includes('retrying in 1s')), 'extension errors appear in mobile editor diagnostics');
  timers.run(1000);
  assert.equal(scripts.length, 2, 'extension retries without reloading the page');
  scripts[0].onerror();
  scripts[0].onload();
  assert.equal(timers.tasks.size, 1, 'stale extension callbacks cannot disrupt the new request');
  scripts[1].onload(); // A CDN/script parse failure can fire onload without installing the editor extension.
  assert.ok(messages.some(message => message.includes('extension did not initialize')), 'successful transport cannot mask failed initialization');
  timers.run(2000);
  assert.equal(scripts.length, 3, 'invalid initialization triggers another request');
  window.AttackIdleStanceEditor = { getConfig() {} };
  scripts[2].onload();
  assert.equal(timers.tasks.size, 0, 'loaded extension has no remaining retry or timeout tasks');
}

async function testAttackEditorStillPresetRecovery() {
  const html = fs.readFileSync('docs/tools/attack-animation-editor/index.html', 'utf8'); // Production still-preset loader embedded in the editor page.
  const start = html.indexOf('const WEAPON_IDLE_POSE_FIELDS = '); // Module boundary that can be executed without constructing a WebGL preview.
  const end = html.indexOf('function applyPreset(preset)', start); // Excludes the independent animation template/UI handler.
  assert.ok(start >= 0 && end > start, 'editor idle preset fetch loader exists');
  const config = JSON.parse(fs.readFileSync('docs/config/combat/weapon-idle-stances.json', 'utf8')); // A changed authored stance used to verify live preview refresh.
  config.stances.heavyWeapon.y = 0.93;
  const fallback = { ...config.stances.heavyWeapon, y: 0.27 }; // Original in-page placeholder pose.
  const presets = [
    { id: 'heavy_weapon_idle', neutral: { ...fallback }, windup: { ...fallback }, strike: { ...fallback } },
    { id: 'light_weapon_idle', neutral: { ...config.stances.lightWeapon }, windup: { ...config.stances.lightWeapon }, strike: { ...config.stances.lightWeapon } },
  ]; // The two real action templates that the loader modifies.
  const anim = { poses: { neutral: { ...fallback }, windup: { ...fallback }, strike: { ...fallback } } }; // Active still-action preview must recover in-place.
  const timers = timerHarness(); // Simulates the editor's recoverable network outage.
  let requests = 0; // Verifies a failed fetch is followed by another fetch.
  let panelSyncs = 0; // Verifies the live action's three pose panels are refreshed.
  const logs = []; // Tracks mobile-visible diagnostic messages.
  vm.runInNewContext(html.slice(start, end), {
    TOOL_PRESETS: presets, anim, AbortController: undefined,
    fetch: async () => {
      requests += 1;
      if (requests === 1) throw new Error('temporary error');
      return { ok: true, json: async () => config };
    },
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    currentAction: () => ({ templateId: 'heavy_weapon_idle' }),
    syncPosePanelFromState() { panelSyncs += 1; },
    refreshJsonView() {}, refreshPreviewDebug() {}, logDebug: msg => logs.push(msg),
    Number, Math, console,
  });
  await new Promise(resolve => setImmediate(resolve));
  timers.run(1000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 2, 'still-action presets must recover without navigating away');
  assert.equal(anim.poses.neutral.y, 0.93, 'active fallback still stance must update when committed config recovers');
  assert.equal(panelSyncs, 3, 'all three visible phases must resynchronize');
  assert.ok(logs.some(line => line.includes('retrying in 1s')), 'the editor reports recovery attempts in its on-screen log');
}

(async () => {
  await testStanceJsonRecovery();
  testDynamicScriptRecovery();
  testEditorExtensionScriptRecovery();
  await testAttackEditorStillPresetRecovery();
  console.log('Neutral stance JSON, module and editor retries, local overrides and init ordering PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });

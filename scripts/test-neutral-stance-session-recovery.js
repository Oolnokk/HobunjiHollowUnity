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
  window.WeaponToolStances = { init(value) { initialized.push(value); } };
  scripts[1].onload();
  assert.deepEqual(initialized, [deps], 'recovered module receives the captured EquipmentPanel deps');
  assert.equal(timers.tasks.size, 0, 'successful script load clears its deadline');
}

(async () => {
  await testStanceJsonRecovery();
  testDynamicScriptRecovery();
  console.log('Neutral stance JSON and module retries, local overrides and init ordering PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });

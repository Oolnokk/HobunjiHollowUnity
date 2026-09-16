// Locks in the single-gamepad-polling-authority invariant.
//
// Controller input used to be five independent requestAnimationFrame loops,
// each calling navigator.getGamepads() and applying its own deadzone, with
// ownership arbitrated by monkey-patching ControllerUI.isActive. This test
// keeps consumers collapsed behind ControllerInput and ensures shipped builds
// always bootstrap the shared RuntimeFrameScheduler before later consumers.
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const read = path => fs.readFileSync(path, 'utf8');

const authority = read('docs/js/controller-input.js');
const selection = read('docs/js/controller-selection-ui.js');
const uiNav = read('docs/js/controller-ui-nav.js');
const socialWheel = read('docs/js/social-action-wheel.js');
const music = read('docs/js/music-minigame.js');
const archetypes = read('docs/js/combat/ranged-weapon-archetypes.js');
const game = read('docs/game.js');

// ── the authority itself ────────────────────────────────────────────
for (const api of ['subscribe', 'setOwner', 'gameplaySuspended', 'PRIORITY', 'thresholdFor']) {
  assert.ok(authority.includes(api), `ControllerInput must expose ${api}`);
}
assert.match(authority, /RuntimeFrameScheduler\?\.register/, 'the authority prefers the global RuntimeFrameScheduler when available');
assert.match(authority, /SCHEDULER_ID\s*=\s*'controller-input'/, 'controller polling has a stable scheduler identity');
assert.doesNotMatch(authority, /requestAnimationFrame\(pollFrame\)/, 'pollFrame must never self-schedule a permanent controller RAF');
assert.match(authority, /requestAnimationFrame\(fallbackFrame\)/, 'older standalone contexts retain one explicit compatibility RAF fallback');
assert.match(
  authority,
  /pressedSet\.add|releasedSet\.add/,
  'the authority derives press/release edges once per controller frame for every consumer',
);
assert.match(
  authority,
  /hobunji-controller-owner-change/,
  'setOwner still emits the existing owner-change event game.js listens for',
);

// Prove executable scheduler preference, not just source spelling: when the
// global scheduler exists ControllerInput registers exactly once and schedules
// no private browser RAF of its own.
let schedulerRecord = null;
let directRafCalls = 0;
const schedulerContext = {
  window: {
    RuntimeFrameScheduler: {
      register(id, callback, options) {
        schedulerRecord = { id, callback, options };
        return () => { schedulerRecord = null; };
      },
    },
    dispatchEvent() {},
  },
  navigator: { getGamepads: () => [] },
  document: { readyState: 'complete', hasFocus: () => true },
  performance: { now: () => 100 },
  requestAnimationFrame() { directRafCalls += 1; return directRafCalls; },
  cancelAnimationFrame() {},
  CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
  console,
  URL,
  Set,
  Map,
  Math,
  Number,
  String,
  Object,
};
vm.runInNewContext(authority, schedulerContext, { filename: 'controller-input.js' });
assert.equal(schedulerRecord?.id, 'controller-input', 'ControllerInput registers under its stable scheduler id');
assert.equal(schedulerRecord?.options?.phase, 'input', 'controller polling advertises input cadence in scheduler diagnostics');
assert.equal(directRafCalls, 0, 'scheduler-backed ControllerInput starts no private requestAnimationFrame loop');
schedulerRecord.callback({ timestamp: 250, deltaMs: 16.7, frameId: 1 });
assert.equal(schedulerContext.window.ControllerInput.getDebug().frameId, 1, 'one scheduler callback produces one shared controller frame');
assert.equal(schedulerContext.window.ControllerInput.getDebug().cadenceOwner, 'RuntimeFrameScheduler', 'mobile diagnostics report scheduler ownership');

// Prove the shipped parser path cannot silently select the fallback just because
// index.html omitted an explicit scheduler script tag. ControllerInput inserts
// the feature-agnostic scheduler beside itself before later scripts are parsed.
let bootstrapMarkup = '';
let domReadyHandler = null;
const bootstrapContext = {
  window: { dispatchEvent() {} },
  navigator: { getGamepads: () => [] },
  document: {
    readyState: 'loading',
    currentScript: { src: 'https://example.test/docs/js/controller-input.js?v=test' },
    write(markup) { bootstrapMarkup += markup; },
    addEventListener(type, handler) { if (type === 'DOMContentLoaded') domReadyHandler = handler; },
    hasFocus: () => true,
  },
  performance: { now: () => 100 },
  requestAnimationFrame() { throw new Error('shipped bootstrap must not start the fallback before DOMContentLoaded'); },
  cancelAnimationFrame() {},
  CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
  console,
  URL,
  Set,
  Map,
  Math,
  Number,
  String,
  Object,
};
vm.runInNewContext(authority, bootstrapContext, { filename: 'controller-input.js' });
assert.match(bootstrapMarkup, /runtime-frame-scheduler\.js\?v=20260916main1/, 'shipped ControllerInput parser-inserts the scheduler when index omits it');
assert.equal(typeof domReadyHandler, 'function', 'controller cadence installation still waits for DOMContentLoaded after parser bootstrap');
assert.ok(fs.existsSync('docs/js/runtime-frame-scheduler.js'), 'the parser-bootstrap target must exist in the shipped tree');

// ── exactly one gamepad polling authority across all consumers ─────
// Modules allowed to touch navigator.getGamepads directly, and why.
const ALLOWED_DIRECT_GAMEPAD_ACCESS = {
  'docs/js/controller-input.js': 'the authority itself',
  'docs/js/input-settings-panel.js': 'binding capture needs raw pads, and only while listening',
  'docs/js/dev-zone-gate.js': 'deliberately wraps getGamepads to neutralize input at blocked entrances',
  'docs/js/title-screen-runtime.js': 'deliberately wraps getGamepads to gate input behind the title screen',
};

function listJsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) listJsFiles(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const offenders = [];
for (const file of [...listJsFiles('docs/js'), 'docs/game.js']) {
  if (ALLOWED_DIRECT_GAMEPAD_ACCESS[file]) continue;
  // Ignore prose: only flag real calls.
  const callSites = read(file)
    .split('\n')
    .filter(line => /navigator\.getGamepads\s*(\?\.)?\s*\(/.test(line) && !line.trim().startsWith('//'));
  if (callSites.length) offenders.push(`${file} (${callSites.length})`);
}
assert.deepStrictEqual(
  offenders, [],
  `these modules must read ControllerInput.frame() instead of polling gamepads themselves:\n  ${offenders.join('\n  ')}`,
);

// ── every consumer is a subscriber, not its own loop ────────────────
const consumers = [
  ['controller-selection-ui', selection, 'PRIORITY.selection'],
  ['controller-ui-nav', uiNav, 'PRIORITY.menuNav'],
  ['social-action-wheel', socialWheel, 'PRIORITY.socialWheel'],
  ['music-minigame', music, 'PRIORITY.music'],
];
// Tolerates the call being wrapped across lines.
const subscribesAs = (source, name) =>
  new RegExp(`ControllerInput\\?\\.subscribe\\?\\.\\(\\s*'${name}'`).test(source);

for (const [name, source, priority] of consumers) {
  assert.ok(subscribesAs(source, name), `${name} must join the shared controller frame by name`);
  assert.ok(source.includes(priority), `${name} must declare its shared-loop priority`);
}
assert.ok(
  subscribesAs(archetypes, 'ranged-thrown-charge'),
  'the thrown-charge release watcher must share the controller frame too',
);
assert.ok(
  !/requestAnimationFrame\(poll/.test(archetypes),
  'ranged-weapon-archetypes must not keep a private gamepad loop',
);

// ── ownership is declared, never patched ────────────────────────────
assert.ok(
  !selection.includes('ui.isActive = wrapped'),
  'controller-selection-ui must not replace ControllerUI.isActive; it declares ownership through the registry',
);
assert.ok(
  !selection.includes('__controllerSelectionOwnerGate'),
  'the ControllerUI.isActive owner-gate patch must be gone entirely',
);
assert.match(
  selection,
  /ControllerInput\?\.setOwner\?\.\(`selection:\$\{selector\.kind\}`\)/,
  'held selectors declare their ownership centrally',
);
assert.match(
  uiNav,
  /ControllerInput\?\.setOwner\?\.\('menu'\)/,
  'the menu navigator declares menu ownership centrally',
);
assert.match(
  game,
  /ControllerInput\?\.gameplaySuspended\?\.\(\)/,
  'gameplay dispatch stands down via the explicit registry predicate',
);

// ── loader/bootstrap ordering ───────────────────────────────────────
const index = read('docs/index.html');
const authorityAt = index.indexOf('js/controller-input.js?v=');
assert.ok(authorityAt > 0, 'controller-input.js must be loaded from index.html');
for (const later of ['js/controller-ui-nav.js?v=', 'js/music-minigame.js?v=']) {
  const at = index.indexOf(later);
  assert.ok(at > authorityAt, `${later} must load after the polling authority`);
}
const schedulerAt = index.indexOf('js/runtime-frame-scheduler.js?v=');
if (schedulerAt >= 0) {
  assert.ok(schedulerAt < authorityAt, 'an explicit RuntimeFrameScheduler tag must load before ControllerInput');
} else {
  assert.match(authority, /document\.write\(`?<script src=/, 'when index omits the scheduler, ControllerInput must parser-bootstrap it');
}

console.log('controller input authority and shipped scheduler bootstrap: OK');

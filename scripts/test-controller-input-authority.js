// Locks in the single-gamepad-polling-authority invariant.
//
// Controller input used to be five independent requestAnimationFrame loops,
// each calling navigator.getGamepads() and applying its own deadzone, with
// ownership arbitrated by monkey-patching ControllerUI.isActive. This test
// keeps it collapsed to one loop that consumers subscribe to.
'use strict';

const assert = require('assert');
const fs = require('fs');

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
assert.match(authority, /requestAnimationFrame\(pollFrame\)/, 'the authority owns the one polling loop');
assert.match(
  authority,
  /pressedSet\.add|releasedSet\.add/,
  'the authority derives press/release edges once per frame for every consumer',
);
assert.match(
  authority,
  /hobunji-controller-owner-change/,
  'setOwner still emits the existing owner-change event game.js listens for',
);

// ── exactly one polling loop across all controller consumers ────────
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
  assert.ok(subscribesAs(source, name), `${name} must join the shared frame loop by name`);
  assert.ok(source.includes(priority), `${name} must declare its shared-loop priority`);
}
assert.ok(
  subscribesAs(archetypes, 'ranged-thrown-charge'),
  'the thrown-charge release watcher must share the frame loop too',
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

// ── the authority loads before anything that subscribes ─────────────
const index = read('docs/index.html');
const authorityAt = index.indexOf('js/controller-input.js?v=');
assert.ok(authorityAt > 0, 'controller-input.js must be loaded from index.html');
for (const later of ['js/controller-ui-nav.js?v=', 'js/music-minigame.js?v=']) {
  const at = index.indexOf(later);
  assert.ok(at > authorityAt, `${later} must load after the polling authority`);
}

console.log('controller input authority: OK');

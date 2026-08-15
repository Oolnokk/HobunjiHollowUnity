#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const capture = source('docs/js/held-seed-desktop-capture.js'); // Used to pin the desktop semantic-action adapter that is already loaded before game.js.
const settings = source('docs/js/input-settings-panel.js'); // Used to pin the player-facing Settings rows and their live remap notification.
const loader = source('docs/js/combat/combat-config-loader.js'); // Used to ensure the adapter remains in the established held-item bootstrap order.
const config = source('docs/config/scratchbones-config.js'); // Used to prove the displayed/action routing follows authored configurable bindings rather than stale hard-coded badges.
const game = source('docs/game.js'); // Used to document the old mismatch this adapter must override without editing crop semantics.

assert.match(config, /\{ "id": "action1", "label": "Tool\/Item Action 1", "desktop": "Space"/,
  'authored action1 desktop binding is Space');
assert.match(config, /\{ "id": "action2", "label": "Tool\/Item Action 2", "desktop": "KeyQ"/,
  'authored action2 desktop binding is Q');
assert.match(config, /\{ "id": "action3", "label": "Tool\/Item Action 3", "desktop": "KeyR"/,
  'authored action3 desktop binding is R');
assert.match(game, /const DESK_KEYS = \['E', 'Q', 'F3', 'F4'\]/,
  'regression fixture confirms game.js still writes the stale legacy desktop badges that need correcting at runtime');

assert.match(settings, /const ACTION_BUTTON_IDS = new Set\(\['action1', 'action2', 'action3', 'action4', 'action5'\]\)/,
  'Settings explicitly recognizes the five visible gameplay action buttons');
assert.match(settings, /return `Action Button \$\{slot\}`/,
  'Settings labels action1..action5 as Action Button 1..5 for the player');
assert.match(settings, /new CustomEvent\('hobunji-input-bindings-changed'/,
  'saving a player remap broadcasts a live binding-change notification');
assert.match(settings, /saveBindingChange\(device, action\.id\)/,
  'desktop and controller action rows persist through the shared binding-change path');
assert.match(settings, /deps\.inputBindings\[device\]\[action\.id\] = code;[\s\S]*?saveBindingChange\(device, action\.id\)/,
  'desktop key capture stores the newly pressed key and immediately publishes the remap');

assert.match(capture, /const ACTION_BUTTON_IDS = \['btnAction1', 'btnAction2', 'btnAction3', 'btnItemAction1', 'btnItemAction2'\]/,
  'desktop adapter follows the five buttons actually rendered in the action arch');
assert.match(capture, /actionIdForDesktopCode\(event\.code\)[\s\S]*?actionSlotFromId\(actionId\)/,
  'physical keyboard input resolves through the configurable semantic action binding table');
assert.match(capture, /button\.dispatchEvent\(makePointerEvent\('pointerdown'/,
  'keydown enters the exact pointerdown path used by a working on-screen button tap');
assert.match(capture, /press\.button\.dispatchEvent\(makePointerEvent\(cancel \? 'pointercancel' : 'pointerup'/,
  'keyup completes the exact pointerup path used by the on-screen button');
assert.match(capture, /ownedCodes\.add\(event\.code\)[\s\S]*?claim\(event\)/,
  'claimed action keys cannot fall through into game.js and execute a separately recomputed action');
assert.match(capture, /event\.code === 'KeyQ' && actionId === 'action2'/,
  'Q hold is special only while the player actually has Q assigned to Action Button 2');
assert.doesNotMatch(capture, /if \(event\.code === 'KeyQ'\) \{\s*beginQHold/,
  'physical Q is no longer unconditionally reserved when the player remaps it to another action');
assert.match(capture, /window\._desktopSelectionArc\?\.openItem\?\.\(\)/,
  'default Q hold still preserves the existing item selector affordance');
assert.match(capture, /syncRenderedKeyBadges[\s\S]*?desktopCodeForAction\(`action\$\{index \+ 1\}`\)/,
  'visible action-button key badges are derived from the real configured action-slot bindings');
assert.match(capture, /window\.addEventListener\('hobunji-input-bindings-changed', onBindingsChanged\)/,
  'the HUD/router listens for Settings remaps immediately');
assert.match(capture, /onBindingsChanged[\s\S]*?scheduleBadgeSync\(\)/,
  'a desktop remap schedules the visible key badge to update without waiting for another action refresh');
assert.match(capture, /if \(code === 'Space'\) return 'SPACE'/,
  'Space gets a readable action-button badge instead of the stale E label');
assert.match(capture, /window\.HobunjiDesktopActionSlotRouter = api;[\s\S]*?window\.HobunjiHeldSeedDesktopCapture = api/,
  'new generic routing is exposed for diagnostics while preserving the existing loader readiness name');

const heldIndex = loader.indexOf('held-seed-action-bridge.js');
const desktopIndex = loader.indexOf('held-seed-desktop-capture.js?v=20260814a');
const alcoholIndex = loader.indexOf('alcohol-gameplay-bridge.js');
assert.ok(heldIndex >= 0 && desktopIndex > heldIndex && alcoholIndex > desktopIndex,
  'desktop action adapter still loads after the pointer/plant owner and before later held-item providers');

console.log('player-configurable rendered action-key routing tests passed');

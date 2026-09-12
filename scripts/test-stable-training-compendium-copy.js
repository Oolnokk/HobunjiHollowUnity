'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const oldKicker = 'Not active progression yet';
const oldText = 'Stable rows currently show a level value, but the Stable UI explicitly marks creature leveling as coming later. Do not expect that number to advance through normal play yet.';
const kicker = { textContent: oldKicker };
const body = { textContent: oldText };
const root = { querySelectorAll: () => [kicker, body] };
let renders = 0;
const context = {
  window: null,
  document: { getElementById: id => id === 'mpCompendium' ? root : null },
  CompendiumUI: {
    install() { return true; },
    open() { return true; },
    render() { renders++; kicker.textContent = oldKicker; body.textContent = oldText; return true; },
  },
  console,
};
context.window = context;
context.window.queueMicrotask = fn => fn();
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/stable-training-compendium-patch.js', 'utf8'), context, { filename: 'stable-training-compendium-patch.js' });

assert.equal(context.StableTrainingCompendiumPatch.installed, true, 'Stable Compendium copy patch installs');
context.CompendiumUI.render();
assert.equal(renders, 1, 'original Compendium render still runs exactly once');
assert.equal(kicker.textContent, 'Level 10 animal training', 'obsolete coming-soon kicker is replaced');
assert.match(body.textContent, /gain XP while active, up to level 10/i, 'Compendium explains live Stable XP progression');
assert.match(body.textContent, /Tap an animal in the Stable to expand its perk tree/i, 'Compendium documents the player-facing expandable tree workflow');

const bridge = fs.readFileSync('docs/js/livestock-nursery-install-bridge.js', 'utf8');
assert.match(bridge, /StableTrainingCompendiumPatch/, 'farm feature bootstrap loads the current Stable Compendium copy');
console.log('Stable Compendium copy regression tests passed.');

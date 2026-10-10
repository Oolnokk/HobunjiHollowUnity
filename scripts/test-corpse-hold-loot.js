// Hold-to-loot bodies (js/corpse-hold-loot.js): Action 1 held on a body that
// asks for a hold fills the HUD and loots once on completion; a hit or a
// release resets it; one body per press.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const root = path.join(__dirname, '..');
const classes = new Set();
const el = { classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) }, style: {}, textContent: '' };
const context = { console, document: { getElementById: () => el } };
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'docs/js/corpse-hold-loot.js'), 'utf8'), context, { filename: 'corpse-hold-loot.js' });
const Hold = context.CorpseHoldLoot;

let held = false;
let action = Hold.HOLD_ACTION;
let looted = 0;
const toasts = [];
const body = { id: 'corpse_1', holdSeconds: 2, holdLabel: 'Searching...', onAction(a) { assert.equal(a, 'obj_loot_corpse'); looted++; return { ok: true, message: 'Looted the skeleton' }; } };
let aimed = body;
Hold.init({ getActiveAction: () => action, getActionHeldDown: () => held, getAimedHoldCorpse: () => aimed, showToast: msg => toasts.push(msg) });

Hold.update(0.5);
assert.equal(looted, 0, 'nothing happens without holding');
held = true;
for (let i = 0; i < 3; i++) Hold.update(0.5);
assert(classes.has('visible') && el.style.width === '75%', 'HUD fills while held');
assert.equal(looted, 0, 'not looted before the hold completes');
Hold.update(0.5);
assert.equal(looted, 1, 'looted once the 2s hold completes');
assert.deepEqual(toasts, ['Looted the skeleton'], 'loot result is shown');
assert(!classes.has('visible'), 'HUD hides when done');
for (let i = 0; i < 6; i++) Hold.update(0.5);
assert.equal(looted, 1, 'one body per press: release before the next');

held = false; Hold.update(0.1); held = true;
Hold.update(1.5);
Hold.interrupt();
assert(!classes.has('visible'), 'a hit cancels the hold');
Hold.update(1);
assert.equal(looted, 1, 'stays cancelled until the button is released');

held = false; Hold.update(0.1); held = true;
action = 'dig';
Hold.update(3);
assert.equal(looted, 1, 'only the hold-loot action drives it');
action = Hold.HOLD_ACTION;
aimed = null;
Hold.update(3);
assert.equal(looted, 1, 'nothing aimed, nothing looted');
console.log('PASS corpse-hold-loot');

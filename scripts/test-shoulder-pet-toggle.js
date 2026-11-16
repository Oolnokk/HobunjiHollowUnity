'use strict';
// Alt+P shoulder pet toggle: runs the real module against a fake stable, and
// checks the hotkey is routed through QolHotkeys without stealing plain P.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function loadToggle() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('docs/js/shoulder-pet-toggle.js', 'utf8'), sandbox);
  return sandbox.window.ShoulderPetToggle;
}

function harness(stable, activeId) {
  const state = { activeId, saves: 0, toasts: [] };
  const toggle = loadToggle();
  toggle.init({
    getStable: () => stable,
    getActiveId: () => state.activeId,
    setActiveId: id => { state.activeId = id; },
    saveStable: () => { state.saves++; },
    stableEntryRole: entry => entry.role,
    showToast: (msg, ok) => state.toasts.push({ msg, ok }),
  });
  return { toggle, state };
}

const stable = [
  { id: 'dog', name: 'Rex', role: 'companion' },
  { id: 'bird', name: 'Nono', role: 'shoulderPet' },
  { id: 'mouse', name: 'Pip', role: 'shoulderPet' },
];

// Dequip, then re-equip the same pet (not just the first eligible one).
{
  const { toggle, state } = harness(stable, 'mouse');
  assert.strictEqual(toggle.toggle(), 'dequipped');
  assert.strictEqual(state.activeId, null);
  assert.strictEqual(toggle.toggle(), 'equipped');
  assert.strictEqual(state.activeId, 'mouse', 're-equips the pet that was dequipped');
  assert.strictEqual(state.saves, 2, 'each toggle persists the stable');
}

// Nothing equipped yet: picks the first shoulder-pet entry, never a companion.
{
  const { toggle, state } = harness(stable, null);
  assert.strictEqual(toggle.toggle(), 'equipped');
  assert.strictEqual(state.activeId, 'bird');
}

// Stowed or missing pets are skipped, and an empty stable reports failure.
{
  const { toggle, state } = harness([{ id: 'bird', role: 'shoulderPet', stowed: true }, { id: 'dog', role: 'companion' }], null);
  assert.strictEqual(toggle.toggle(), null);
  assert.strictEqual(state.activeId, null);
  assert.strictEqual(state.toasts.at(-1).ok, false);
}

// The remembered pet was removed from the stable meanwhile: fall back cleanly.
{
  const list = stable.slice();
  const { toggle, state } = harness(list, 'mouse');
  toggle.toggle();
  list.splice(2, 1);
  assert.strictEqual(toggle.toggle(), 'equipped');
  assert.strictEqual(state.activeId, 'bird');
}

// QolHotkeys routes Alt+P to the toggle and leaves plain P (Progress) alone.
{
  const src = fs.readFileSync('docs/js/qol-hotkeys.js', 'utf8');
  const noop = () => {};
  const el = { addEventListener: noop, classList: { toggle: noop }, querySelector: () => null, style: {} };
  const sandbox = {
    window: { addEventListener: noop },
    document: { body: el, getElementById: () => el, querySelector: () => null, querySelectorAll: () => [], createElement: () => el, head: el, addEventListener: noop },
    localStorage: { getItem: () => null, setItem: noop },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  let toggles = 0;
  sandbox.window.QolHotkeys.init({ toggleShoulderPet: () => { toggles++; }, isBlocked: () => false, isMenuOpen: () => false });
  const key = extra => Object.assign({ code: 'KeyP', key: 'p', repeat: false, preventDefault: noop }, extra);
  assert.strictEqual(sandbox.window.QolHotkeys.handleKey(key({ altKey: true })), true);
  assert.strictEqual(toggles, 1);
  assert.strictEqual(sandbox.window.QolHotkeys.handleKey(key({ altKey: true, repeat: true })), true);
  assert.strictEqual(toggles, 1, 'held key does not re-toggle');
  assert.strictEqual(sandbox.window.QolHotkeys.handleKey(key({ altKey: true, ctrlKey: true })), false, 'Ctrl+Alt+P is not ours');
  assert.strictEqual(toggles, 1);
}

console.log('shoulder pet toggle ok');

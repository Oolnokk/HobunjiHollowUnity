'use strict';
const assert = require('node:assert/strict'); // Checks runtime behavior without a browser or game renderer.
const fs = require('node:fs'); // Reads the shipped owners rather than duplicate test implementations.
const vm = require('node:vm'); // Executes owner functions with lightweight dependencies.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Contains the common mobile/keyboard/controller dispatcher.
const fishing = fs.readFileSync('docs/js/fishing-minigame.js', 'utf8'); // Contains camera cleanup and catch reward presentation.
const nav = fs.readFileSync('docs/js/controller-ui-nav.js', 'utf8'); // Contains focus ownership across menu transitions.
function ownerFunction(source, name, indent = '  ') {
  const start = source.indexOf(`${indent}function ${name}(`); // Locates the real function declaration.
  assert(start >= 0, `missing owner ${name}`);
  const end = source.indexOf(`\n${indent}}`, start); // Owner-level closing indentation excludes nested branches.
  return source.slice(start, end + indent.length + 2);
}
const calls = []; // Captures fishing exits without activating combat or placement systems.
const input = { window: { Fishing: { state: null, close: () => calls.push('close') } } }; // Every other gameplay dependency is intentionally absent to prove early ownership.
vm.runInNewContext(ownerFunction(game, 'performContextAction', '      ') + ownerFunction(game, 'runInputAction', '      '), input);
for (const phase of ['cast', 'waiting', 'bite', 'active', 'caught']) {
  input.window.Fishing.state = { active: true, phase };
  input.runInputAction('dodge', 'press');
  input.runInputAction('dodge', 'release');
  input.performContextAction();
}
assert.equal(calls.length, 10, 'every phase exits once per press via controller and mobile, never on release');

const cleanup = { // Exercises the cleanup actually called by Fishing.close, including catch-view camera restoration.
  fishingMinigame: { active: true, phase: 'caught' },
  fishingOverlayEl: { classList: { remove() {} }, innerHTML: 'ring' }, fishingEls: {},
  _prevCameraMode: 'normal', _prevCameraTarget: { x: 2 }, _prevCameraOffsets: { yaw: 0.3 },
  cancelFishingThrowWindup: () => calls.push('windup'), hideFishCatchView: () => calls.push('hide-catch'),
  setNonFishingArcControlsHidden: hidden => calls.push(['controls', hidden]),
  deps: { hideActionPrompt() {}, setHeldMode: mode => calls.push(['held', mode]), setActiveTool: tool => calls.push(['tool', tool]),
    refreshActionBar() {}, setCameraMode: mode => calls.push(['camera', mode]), setCameraTarget: target => calls.push(['target', target]),
    setCameraOrientationOffsets: offsets => calls.push(['offsets', offsets]) },
};
vm.runInNewContext(ownerFunction(fishing, 'closeFishingMinigame'), cleanup);
cleanup.closeFishingMinigame();
assert.equal(cleanup.fishingMinigame, null);
assert.equal(cleanup._prevCameraMode, null);
assert.equal(cleanup._prevCameraOffsets, null);
assert.equal(cleanup.fishingOverlayEl.innerHTML, '');
assert(calls.some(call => Array.isArray(call) && call[0] === 'camera' && call[1] === 'normal'));
assert(calls.some(call => Array.isArray(call) && call[0] === 'held' && call[1] === 'tool'));
const rewards = { fishingMinigame: { gulletRewards: ['12 Gold', '1 Bronze Circlet'] }, fishCatchViewEls: { rewards: { textContent: '', hidden: true } } }; // Granted labels are displayed safely as text.
vm.runInNewContext(ownerFunction(fishing, 'refreshCatchRewards'), rewards);
rewards.refreshCatchRewards();
assert.equal(rewards.fishCatchViewEls.rewards.textContent, 'Gullet Fish treasure:\n12 Gold\n1 Bronze Circlet');
assert.equal(rewards.fishCatchViewEls.rewards.hidden, false);
rewards.fishingMinigame = {};
rewards.refreshCatchRewards();
assert.equal(rewards.fishCatchViewEls.rewards.hidden, true, 'next cast cannot show stale treasure');

const main = { name: 'main' }, child = { name: 'submenu' }; // Represents a submenu opened while its main menu remains visible.
const mainButton = { closest: () => main }, childButton = { closest: () => child }; // Each target resolves to its registered owner.
const panels = { PANEL_SELECTOR: 'panel', knownPanels: new Set([main, child]), targetsInPanel: panel => panel === main ? [mainButton, childButton] : [childButton] }; // Main descendants include the nested submenu for exclusion coverage.
vm.runInNewContext(['owningRegisteredPanel', 'belongsToNavigation', 'navigationTargets'].map(name => ownerFunction(nav, name)).join('\n'), panels);
assert.equal(panels.belongsToNavigation(mainButton, child), false, 'submenu rejects underlying main menu focus');
assert.equal(panels.navigationTargets(child).length, 1);
assert.equal(panels.navigationTargets(child)[0], childButton);
assert.equal(panels.navigationTargets(main)[0], mainButton);
assert.equal(panels.navigationTargets(main).length, 1, 'main menu excludes separately-owned nested menus');
console.log('Fishing cancellation, camera restoration, treasure captions and menu ownership passed');

const directions = []; // Captures directional navigation while a numeric input has focus.
const navigate = { currentTarget: { tagName: 'INPUT', type: 'number', value: '17' }, move: dir => directions.push(dir), moveVector: (x, y) => directions.push([x, y]) };
vm.runInNewContext(ownerFunction(nav, 'moveOrAdjust') + ownerFunction(nav, 'moveVectorOrAdjust'), navigate);
navigate.moveOrAdjust('left');
navigate.moveVectorOrAdjust(1, 0.1);
assert.equal(navigate.currentTarget.value, '17', 'directional browsing never changes a focused numeric value');
assert.equal(directions.length, 2, 'both digital and analog input continue navigation');
for (const panel of [main, child]) panel.querySelector = () => null;
for (const button of [mainButton, childButton]) {
  button.hasAttribute = () => false;
  button.getBoundingClientRect = () => ({ top: 0, left: 0 });
}
panels.stack = [main];
panels.currentTarget = mainButton;
panels.lastFocusedByPanel = new WeakMap();
panels.document = { activeElement: mainButton };
panels.window = {};
panels.isNavTarget = panels.isVisible = () => true;
panels.isDisabled = () => false;
panels.updateHintBar = () => {};
panels.setFocus = target => { panels.currentTarget = target; };
panels.visiblePanels = () => [main, child];
vm.runInNewContext(['activePanel', 'reconcileStack', 'activatePanel', 'pickDefaultTarget'].map(name => ownerFunction(nav, name)).join('\n'), panels);
panels.reconcileStack();
assert.equal(panels.currentTarget, childButton, 'opening a submenu immediately transfers focus');
panels.visiblePanels = () => [main];
panels.document.activeElement = childButton;
panels.reconcileStack();
assert.equal(panels.currentTarget, mainButton, 'closing the submenu restores the main menu target');

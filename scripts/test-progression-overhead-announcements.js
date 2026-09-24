#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function source(relativePath) {
  return fs.readFileSync(relativePath, 'utf8');
}

function testWorldPopupBridge() {
  const shown = []; // Captures the real AmbientDialogue.show contract used for each progression announcement.
  const timers = []; // Captures serialization timers so the test can advance the queued announcement deterministically.
  const portraitRoot = { // Avatar-only root WorldPopupText should select instead of the held-item-bearing player container.
    name: 'player_portrait',
    parent: {},
    userData: { portraitModelHeight: 1.8, portraitModelWidth: 0.9, portraitVerticalPlacementRatio: 0.5 },
    updateWorldMatrix() {},
    localToWorld(vector) { return vector; },
  };
  const heldItemRoot = { name: 'held_item', userData: {} }; // Traversed first to prove non-avatar attachments cannot become the announcement anchor.
  const playerRoot = {
    name: 'player_root',
    traverse(visitor) { visitor(heldItemRoot); visitor(portraitRoot); },
    updateWorldMatrix() {},
    getWorldPosition(vector) { return vector; },
  }; // Stand-in for the live player container, including the direct held-item child described by animal-subtle-elevation-bridge.js.
  const context = {
    console,
    window: null,
    document: { fonts: null },
    localStorage: { getItem() { return null; }, setItem() {} },
    performance: { now: () => 1000 },
    queueMicrotask,
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
  };
  context.window = context;
  context.AmbientDialogue = {
    show(root, text, options) {
      shown.push({ root, text, options });
      return { root, text, options };
    },
  };
  vm.createContext(context);
  vm.runInContext(source('docs/js/world-popup-text.js'), context, { filename: 'world-popup-text.js' });

  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    clone() { return new Vector3(this.x, this.y, this.z); }
  }
  context.WorldPopupText.init({ playerRoot, THREE: { Vector3 } });
  assert.equal(context.WorldPopupText.queueLevelUp('Mining Level 1!'), true, 'Skill level-up should be accepted by the shared bridge');
  assert.equal(shown.length, 1, 'first progression announcement should render immediately');
  assert.equal(shown[0].root, portraitRoot, 'announcement should anchor to the portrait/body root, not the held-item-bearing player container');
  assert.equal(shown[0].text, 'Mining Level 1!');
  assert.equal(shown[0].options.mode, 'overhead', 'progression text should use the same overhead Ambient Dialogue mode as animal discovery text');
  assert.equal(shown[0].options.tone, 'animal', 'progression text should use the animal-discovery popup palette');
  assert.equal(shown[0].options.durationMs, 1600, 'progression text should use the short animal-discovery lifetime');

  assert.equal(context.WorldPopupText.queueLevelUp('Hatchet Mastery Rank 1!'), true, 'Mastery rank-up should share the same bridge');
  assert.equal(shown.length, 1, 'simultaneous progression announcements must queue instead of overlap');
  assert.equal(context.WorldPopupText.debugSnapshot().levelUpQueueLength, 1, 'debug snapshot should expose pending progression announcements');
  assert.equal(timers.length, 1, 'first announcement should own one queue-advance timer');

  timers[0].fn();
  assert.equal(shown.length, 2, 'queued progression announcement should render after the prior one finishes');
  assert.equal(shown[1].text, 'Hatchet Mastery Rank 1!');
  assert.equal(shown[1].root, portraitRoot);
  assert.equal(shown[1].options.mode, 'overhead');
}

function testSkillRouting() {
  const levelUps = []; // Records SkillSystem milestones routed into the shared overhead announcement bridge.
  const toasts = []; // Records legacy fallback toasts; none should be needed while the bridge accepts announcements.
  const context = {
    console,
    window: {
      WorldPopupText: {
        queueReward() {},
        queueLevelUp(text) { levelUps.push(text); return true; },
      },
    },
    document: { querySelector() { return null; } },
    queueMicrotask,
  };
  vm.createContext(context);
  vm.runInContext(source('docs/js/skill-system.js'), context, { filename: 'skill-system.js' });
  context.window.SkillSystem.init({
    saveSkillProgress() {},
    getFoodEffectStacks() { return 0; },
    showToast(text) { toasts.push(text); },
  });
  context.window.SkillSystem.restore({ skillExperience: { mining: 0 } });
  context.window.SkillSystem.award('mining', 20, 'progression announcement regression');

  assert.equal(context.window.SkillSystem.level('mining'), 1);
  assert.deepEqual(levelUps, ['Mining Level 1!'], 'Skill threshold should announce above the player');
  assert.deepEqual(toasts, [], 'accepted overhead Skill announcements should replace the old level-up toast');
}

function testMasteryRouting() {
  const levelUps = []; // Records every mastery threshold routed into the shared overhead announcement bridge.
  const toasts = []; // Records legacy fallback toasts; none should be needed while the bridge accepts announcements.
  const gear = { tools: {}, toolMastery: {} }; // Minimal live gear state consumed by the canonical mastery policy.
  const context = {
    console,
    window: null,
    document: { readyState: 'complete', addEventListener() {} },
    performance: { now: () => 1000 },
    queueMicrotask,
    Proxy,
    WeakMap,
    WeakSet,
    Set,
    Map,
  };
  context.window = context;
  context.WorldPopupText = {
    showChange() {},
    queueReward() {},
    queueLevelUp(text) { levelUps.push(text); return true; },
  };
  context.EquipmentPanel = { init(injected) { this.deps = injected; } };
  vm.createContext(context);
  vm.runInContext(source('docs/js/mastery-policy.js'), context, { filename: 'mastery-policy.js' });

  context.EquipmentPanel.init({
    getGearInventory: () => gear,
    equipmentSlots: { weapon: 'hatchet' },
    TOOL_ITEM_DEFS: { hatchet: { label: 'Hatchet', slots: ['axe', 'weapon'] } },
    saveGearInventory() {},
    showToast(text) { toasts.push(text); },
  });
  context.HobunjiMasteryPolicy._test.awardMastery('hatchet', 300, 'progression announcement regression');

  assert.deepEqual(levelUps, [
    'Hatchet Mastery Rank 1!',
    'Hatchet Mastery Rank 2!',
    'Hatchet Mastery Rank 3!',
    'Hatchet Mastery Rank 4!',
    'Hatchet Mastery Rank 5!',
  ], 'one large Mastery award should preserve and queue every crossed rank');
  assert.deepEqual(toasts, [], 'accepted overhead Mastery announcements should replace the old rank-up toast');
}

testWorldPopupBridge();
testSkillRouting();
testMasteryRouting();
console.log('progression overhead announcement tests passed');

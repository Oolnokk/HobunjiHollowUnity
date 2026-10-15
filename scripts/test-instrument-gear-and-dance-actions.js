'use strict';

const assert = require('node:assert/strict'); // Behavioral assertions across gear, music and dance ownership.
const fs = require('node:fs'); // Loads the shipped modules and authored NPC records.
const vm = require('node:vm'); // Runs browser modules with isolated gameplay dependencies.
const read = name => fs.readFileSync(name, 'utf8'); // Keeps fixtures on the current implementation.
const game = read('docs/game.js'); // Supplies the canonical item and equipment definitions.
const noop = () => {}; // Shared no-op for unrelated browser and UI callbacks.

// Run the actual gear owner: transferring consumes one pack copy, assignment requires gear ownership,
// and unequipping leaves the permanent collection intact.
{
  const gear = { tools: {} }; // Canonical mutable collection shared with EquipmentPanel.
  const equipmentSlots = { instrument: null }; // Saved instrument assignment under test.
  const inventory = { kurraya: 2 }; // One spare must survive transfer to permanent gear.
  const definition = game.match(/kurraya:\s*({ label: 'Kurraya'[^\n]+})/)[1]; // Execute the shipped tool definition rather than a duplicate.
  const window = { InventoryUI: { init: noop }, Combat: { deps: {} } }; // Prevents unrelated lazy UI loads.
  const document = { addEventListener: noop, getElementById: () => null }; // Panel rebuilding is unnecessary for collection behavior.
  let saves = 0; // Verifies assignment persistence is invoked.
  vm.runInNewContext(read('docs/js/equipment-panel.js'), { window, document });
  window.EquipmentPanel.init({
    equipmentSlots, inventory, TOOL_ITEM_DEFS: { kurraya: vm.runInNewContext(`(${definition})`) },
    getGearInventory: () => gear, saveGearInventory: noop, saveEquipmentSlots: () => saves++,
    showToast: noop, clampInventoryStack: noop, buildInventoryGrid: noop, clearInventoryDetail: noop,
    rebuildToolMeshes: noop, toolMeshMap: {}, toolHolder: {}, getActiveTool: () => 'weapon', refreshActionBar: noop,
  });
  window.EquipmentPanel.equipItem('kurraya', 'instrument');
  assert.equal(equipmentSlots.instrument, null, 'pack ownership alone cannot equip an instrument');
  window.EquipmentPanel.transferToolToGear('kurraya');
  assert.equal(inventory.kurraya, 1);
  assert.equal(gear.tools.kurraya, true);
  window.EquipmentPanel.transferToolToGear('kurraya');
  assert.equal(inventory.kurraya, 1, 'duplicate transfer must not consume another copy');
  window.EquipmentPanel.equipItem('kurraya', 'weapon');
  assert.equal(equipmentSlots.weapon, undefined, 'instrument cannot enter a weapon slot');
  window.EquipmentPanel.equipItem('kurraya', 'instrument');
  assert.equal(equipmentSlots.instrument, 'kurraya');
  assert.equal(saves, 1);
  window.EquipmentPanel.unequipItem('instrument');
  assert.equal(equipmentSlots.instrument, null);
  assert.equal(gear.tools.kurraya, true);
}

// Run the full wheel with deferred boot, then route spins through the shipped input-claim owner.
{
  let timestamp = 100; // Controlled clock for overlapping spin and completion checks.
  const player = { traverse: noop, userData: {} }; // The wheel tolerates limbs attaching later.
  const window = {
    THREE: {}, PlayerBodyTransformComposer: { getPlayerMesh: () => player, clearChannel: noop },
    CharacterActionLocks: { acquire: () => ({ release: noop }) },
  }; // Minimal live gameplay owners used when starting and stopping a dance.
  vm.runInNewContext(read('docs/js/world-action-input-claims.js'), { window });
  vm.runInNewContext(read('docs/js/social-action-wheel.js'), {
    window, document: { readyState: 'loading', addEventListener: noop }, performance: { now: () => timestamp },
  });
  const wheel = window.SocialActionWheel; // Public gameplay API under test.
  assert.equal(wheel.actions.length, 5, 'instrument plus four non-spin dances');
  assert.equal(wheel.actions[0].label, 'Play instrument');
  assert(wheel.actions.filter(action => action.kind === 'dance').every(action => action.style !== 'gentle-twirl'));
  assert.equal(wheel.spin(), false, 'cannot spin while not dancing');
  assert.equal(wheel.startDance('invalid', 'overhead-punch'), false);
  assert.equal(wheel.startDance('gentle-twirl', 'overhead-punch'), true);
  assert.equal(wheel.getDebug().dancing.style, 'side-step', 'legacy spin presets resolve to their base dance');
  assert.equal(wheel.spinRotation(7000), 0, 'ordinary dance must never turn automatically');
  assert.equal(window.WorldActionInputClaims.dispatch('action2', 'press'), true);
  assert.equal(wheel.spin(), false, 'overlapping turns do not restart the animation');
  timestamp += 60000 / 104;
  assert(Math.abs(wheel.spinRotation() - Math.PI) < 1e-8, 'halfway through the turn faces backward');
  assert.equal(wheel.getDebug().dancing.armStyle, 'overhead-punch');
  timestamp += 60000 / 104 + 1;
  assert.equal(wheel.spinRotation(), 0, 'completed spin returns to ordinary dance orientation');
  assert.equal(window.WorldActionInputClaims.dispatch('action2', 'release'), true);
  assert.equal(window.WorldActionInputClaims.dispatch('action2', 'press'), true, 'next press performs another spin');
  window.WorldActionInputClaims.dispatch('action2', 'release');
  wheel.stopDance();
  assert.equal(window.WorldActionInputClaims.hasClaim('action2'), false, 'stopping releases secondary-action ownership');
}

// Real NPC planner destinations must read each NPC's preference rather than copying stimulus metadata.
{
  let stimulus = { id: 'player-dance', type: 'dance', area: 'town', x: 0, z: 0, radius: 9, strength: 1, danceStyle: 'side-step', armStyle: 'overhead-punch' }; // Swapped to simulate a different initiator.
  const walker = { area: 'town', root: { position: { x: 1, z: 0 } } }; // An eligible NPC standing near the dance.
  const window = {
    NpcAgenda: { dailySeed: () => 0.8 },
    HobunjiDrunkGameplayBridge: { npcDrunkFraction: () => 1, isNpcBlackedOut: () => false },
    NpcSocialStimuli: { getActive: () => [stimulus] },
    NpcActivityPlanner: { init: noop, resolveNpcTarget: () => ({ activity: 'rest', obligation: 'leisure' }) },
    CalendarSystem: { getHour: () => 12 }, setInterval: noop,
  }; // Uses the same planner injection seam as the live game.
  vm.runInNewContext(read('docs/js/npc-social-inhibition-runtime.js'), { window, performance: { now: () => 100 } });
  window.NpcActivityPlanner.init({ calendar: { day: 1 }, findNpcWalker: () => walker, getCurrentArea: () => 'town' });
  const rec = { id: 'pahu', preferredDance: { style: 'loose-sway', armStyle: 'tpose-jiggle' } }; // Explicit database preference opposed to the starter.
  const first = window.NpcActivityPlanner.resolveNpcTarget(rec, { hasExistingWalker: true }); // First stimulus result.
  assert.equal(first.socialDance.style, 'loose-sway');
  assert.equal(first.socialDance.armStyle, 'tpose-jiggle');
  stimulus = { ...stimulus, id: 'npc-dance', sourceNpcId: 'another-npc', danceStyle: 'gentle-twirl' };
  const second = window.NpcActivityPlanner.resolveNpcTarget(rec, { hasExistingWalker: true }); // Second initiator must not alter the preference.
  assert.equal(second.socialDance.style, 'loose-sway');
  assert.equal(second.socialDance.armStyle, 'tpose-jiggle');
  delete rec.preferredDance;
  const fallback = window.NpcActivityPlanner.resolveNpcTarget(rec, { hasExistingWalker: true }).socialDance; // Older/local records still get a stable individual dance.
  stimulus = { ...stimulus, id: 'third-dance', armStyle: 'tpose-jiggle' };
  const later = window.NpcActivityPlanner.resolveNpcTarget(rec, { hasExistingWalker: true }).socialDance; // Different music/dance sources cannot randomize the fallback.
  assert.equal(fallback.style, later.style);
  assert.equal(fallback.armStyle, later.armStyle);
  for (const npc of JSON.parse(read('docs/config/npcs/hobunji-starter-npc-database.json')).npcs) {
    assert(['side-step', 'loose-sway'].includes(npc.preferredDance.style), npc.id);
    assert(['overhead-punch', 'tpose-jiggle'].includes(npc.preferredDance.armStyle), npc.id);
  }
}

// Start the actual music overlay from equipped gear without any pack dependency.
{
  const element = () => ({ classList: { add: noop, remove: noop, toggle: noop }, addEventListener: noop }); // Minimal overlay/frame DOM contract.
  const overlay = element(), frame = element(); // Real session toggles these two browser surfaces.
  const window = { addEventListener: noop }; // Frame messages are irrelevant to session ownership.
  let equipped = null; // Simulates the persistent gear slot being assigned by the player.
  vm.runInNewContext(read('docs/js/music-minigame.js'), {
    window, document: { getElementById: id => id === 'musicMinigameOverlay' ? overlay : id === 'musicMinigameFrame' ? frame : null, body: element() },
    setInterval: noop,
  });
  window.MusicMinigame.init({ getEquippedInstrument: () => equipped, getCurrentArea: () => 'town', listInstrumentPerformers: () => [], showToast: noop });
  assert.equal(window.MusicMinigame.beginPlayerSession(), false);
  assert.equal(window.MusicMinigame.state, null);
  equipped = 'kurraya';
  window.MusicMinigame.beginPlayerSession();
  assert.equal(window.MusicMinigame.state.instrumentKey, 'kurraya');
  assert.equal(window.MusicMinigame.state.active, true);
  window.MusicMinigame.close();
  assert.equal(window.MusicMinigame.state, null);
}

console.log('instrument gear, dance spin input and NPC preference behavior passed');

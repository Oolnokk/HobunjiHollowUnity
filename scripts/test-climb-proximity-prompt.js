const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync('docs/js/climb-proximity-prompt.js', 'utf8');
assert(!source.includes('document.createElement'), 'climb prompt bridge must not create a separate DOM/HUD popup');
assert(source.includes('WorldPopupText'), 'climb prompts must reuse the existing world interaction popup system');

class Object3D {
  constructor() {
    this.name = '';
    this.position = { x: 0, y: 0, z: 0, set: (x, y, z) => { this.position.x = x; this.position.y = y; this.position.z = z; } };
  }
}

const TILE = 64;
const grid = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ type: 'grass', elevTier: 0, incline: false })));
let target = null;
let directRoofTarget = null;
let branches = [];
let rideState = 'none';
let lastSync = null;
const player = { x: 1.5 * TILE, y: 1.5 * TILE, climbing: false, prone: false, dodging: false, lunging: false, onBranch: null };

const popup = {
  syncInteractionPrompts(options = {}) {
    lastSync = options;
    return options.buttons || [];
  },
};

const window = {
  THREE: { Object3D },
  Combat: {
    deps: {
      player,
      TILE,
      THREE: { Object3D },
      _isZoneArea: area => area === 'zone',
      isSolid: type => type === 'wall',
      worldSurfaceY: () => 0,
    },
  },
  GridTileAccessors: {
    getActiveGrid: () => grid,
    getCurrentArea: () => 'zone',
  },
  ActionPromptUI: {
    actionPromptGlyph(actionId, touchLabel) {
      assert.equal(actionId, 'dodge');
      assert.equal(touchLabel, 'Dodge');
      return 'Space';
    },
    actionPromptColor(actionId) {
      assert.equal(actionId, 'dodge');
      return '#A78BFA';
    },
  },
  ClimbSystem: {
    get debug() { return { mountRideState: rideState }; },
    getClimbTarget() { return target; },
    debugBranchesFor() { return branches.slice(); },
  },
  HobunjiRoofClimb: {
    getRoofClimbTarget() { return directRoofTarget; },
  },
  WorldPopupText: popup,
};
window.window = window;

const context = vm.createContext({ window, console, Object, Number, String, Math });
vm.runInContext(source, context, { filename: 'climb-proximity-prompt.js' });

const Prompt = window.HobunjiClimbPrompt;
assert.ok(Prompt, 'climb prompt bridge API is exported');
assert.equal(Prompt.getDebug().popupPatched, true, 'existing WorldPopupText sync path is patched');
assert.equal(Prompt.getDebug().usesWorldPopupText, true, 'debug confirms the shared popup system is authoritative');
assert.equal(Prompt.getDebug().actionId, 'dodge', 'climb rows identify the real Dodge/climb input');

// A real roof target is inserted into the normal interaction rows using the
// exact structured input metadata WorldPopupText already understands.
target = {
  type: 'roof',
  wallPoint: { x: 2.5, y: 0.8, z: 1.5 },
  wallFaceId: 'house-wall',
};
window.WorldPopupText.syncInteractionPrompts({ buttons: [], promptInputs: [], root: null, enabled: true });
assert.equal(lastSync.buttons.length, 1);
assert.equal(lastSync.buttons[0].action, 'climb_branch');
assert.equal(lastSync.buttons[0].label, 'Climb Building');
assert.equal(lastSync.buttons[0].worldInteraction, true);
assert.deepEqual(lastSync.promptInputs[0], { actionId: 'dodge', label: 'Space', color: '#A78BFA' });
assert.equal(lastSync.root.name, 'climb_world_interaction_prompt_anchor');
assert.equal(lastSync.root.position.x, 2.5);
assert.equal(lastSync.root.position.z, 1.5);
assert.equal(Prompt.getDebug().climbTargetBridgeCurrent, true, 'live ClimbSystem target path is hardened after prompt sync');

// Regression for the live probe failure: the dedicated roof resolver can find
// a valid building target even if ClimbSystem.getClimbTarget itself returns null.
// The popup must still show Climb Building, and the ordinary game action must
// receive that same roof target through ClimbSystem afterward.
target = null;
directRoofTarget = {
  type: 'roof',
  wallPoint: { x: 2.25, y: 0.7, z: 1.5 },
  wallFaceId: 'fallback-house-wall',
};
lastSync = null;
window.WorldPopupText.syncInteractionPrompts({ buttons: [], promptInputs: [], root: null, enabled: true });
assert.equal(lastSync.buttons[0].label, 'Climb Building', 'direct roof fallback still produces the normal building climb row');
assert.equal(Prompt.getDebug().targetSource, 'ClimbSystem target');
assert.equal(window.ClimbSystem.getClimbTarget(), directRoofTarget, 'game action path receives the same fallback roof target');
directRoofTarget = null;

// game.js already supplies branch climb rows when it has an exact branch
// target. The bridge must defer to that existing row instead of duplicating it.
lastSync = null;
window.WorldPopupText.syncInteractionPrompts({
  buttons: [{ action: 'climb_branch', label: 'Climb Tree', worldInteraction: true }],
  promptInputs: [{ actionId: 'dodge', label: 'Space', color: '#A78BFA' }],
  root: { name: 'existing-branch-root' },
  enabled: true,
});
assert.equal(lastSync.buttons.length, 1, 'existing climb interaction row is not duplicated');
assert.equal(lastSync.root.name, 'existing-branch-root');

// The existing interaction popup is a stacked list, so a climb row can coexist
// with Enter/Talk/etc. without inventing another popup surface.
target = {
  type: 'roof',
  wallPoint: { x: 2.5, y: 0.8, z: 1.5 },
  wallFaceId: 'house-wall',
};
lastSync = null;
window.WorldPopupText.syncInteractionPrompts({
  buttons: [{ action: 'talk', label: 'Talk', worldInteraction: true }],
  promptInputs: [{ actionId: 'interact', label: 'E', color: '#fff' }],
  root: { name: 'npc-root' },
  enabled: true,
});
assert.equal(lastSync.buttons.length, 2, 'climb is appended to the existing world interaction list');
assert.equal(lastSync.buttons[0].action, 'talk');
assert.equal(lastSync.buttons[1].action, 'climb_branch');
assert.equal(lastSync.buttons[1].label, 'Climb Building');
assert.equal(lastSync.promptInputs[1].actionId, 'dodge');
assert.equal(lastSync.root.name, 'npc-root', 'existing interaction root continues to own the shared stacked list');

// Merely standing beside a plateau still gets a popup hint even before facing
// is aligned enough for ClimbSystem.getClimbTarget().
target = null;
grid[1][2] = { type: 'grass', elevTier: 0, incline: true };
grid[1][3] = { type: 'grass', elevTier: 1, incline: false };
lastSync = null;
window.WorldPopupText.syncInteractionPrompts({ buttons: [], promptInputs: [], root: null, enabled: true });
assert.equal(lastSync.buttons[0].label, 'Face Cliff to Climb');
assert.equal(lastSync.buttons[0].action, 'climb_branch');
assert.equal(lastSync.promptInputs[0].actionId, 'dodge');
assert.equal(Prompt.getDebug().targetType, 'wall');
assert.equal(Prompt.getDebug().actionable, false);

// Branch proximity uses the same shared prompt system when no exact branch is
// being looked at yet.
grid[1][2] = { type: 'grass', elevTier: 0, incline: false };
grid[1][3] = { type: 'grass', elevTier: 0, incline: false };
branches = [{ id: 'tree', baseX: player.x + 0.5 * TILE, baseY: player.y, tipX: player.x + 0.5 * TILE, tipY: player.y, baseWorldY: 0.5, tipWorldY: 1.2 }];
lastSync = null;
window.WorldPopupText.syncInteractionPrompts({ buttons: [], promptInputs: [], root: null, enabled: true });
assert.equal(lastSync.buttons[0].label, 'Look at Tree to Climb');
assert.equal(lastSync.root.name, 'climb_world_interaction_prompt_anchor');

rideState = 'mounted';
lastSync = null;
window.WorldPopupText.syncInteractionPrompts({ buttons: [], promptInputs: [], root: { name: 'fallback' }, enabled: true });
assert.equal(lastSync.buttons.length, 0, 'mounted branch proximity does not advertise a climb the mount cannot perform');

console.log('climb world interaction prompt tests passed');

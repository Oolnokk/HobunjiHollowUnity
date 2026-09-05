const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/character-rig-pixel-probe-runtime.js', 'utf8');

function node(name, options = {}) {
  const result = {
    name,
    visible: options.visible !== false,
    isObject3D: true,
    isMesh: !!options.isMesh,
    isSkinnedMesh: !!options.isSkinnedMesh,
    isSprite: !!options.isSprite,
    isBone: !!options.isBone,
    parent: null,
    children: [],
    userData: {},
    scale: { x: options.scaleX ?? 1, y: options.scaleY ?? 1, z: options.scaleZ ?? 1 },
    position: { x: 0, y: options.y ?? 0, z: 0 },
    add(child) { child.parent = this; this.children.push(child); return this; },
    traverse(callback) {
      for (const child of this.children) {
        callback(child);
        child.traverse?.(callback);
      }
    },
  };
  return result;
}

const playerRoot = node('player_root');
const hiddenPlayerAxes = node('right_hand_grip_axes', { visible: false });
playerRoot.add(hiddenPlayerAxes);

const npcRoot = node('gorobi_root', { scaleX: 1.125, scaleY: 1.125, scaleZ: 1.125 });
const avatar = node('gorobi_avatar');
const npcMesh = node('Temporary_NPC_Portrait_Model_skinned_plane_assembly', { isMesh: true, isSkinnedMesh: true });
const headBone = node('Temporary_NPC_Portrait_Model_skinned_plane_assembly_head_scale_bone', {
  isBone: true, scaleX: 1.02 / 1.125, scaleY: 1.02 / 1.125, scaleZ: 1,
});
headBone.userData.hobunjiHeadOffsetBaseY = 0;
avatar.userData.neckRig = { headScaleJoint: headBone };
avatar.userData.hobunjiCharacterRigHeadRuntime = {
  applied: true,
  species: 'mao-ao',
  gender: 'male',
  bodyScaleX: 1.125,
  bodyScaleY: 1.125,
  headScale: 1.02,
  headOffsetY: 0,
  source: 'PNGPlaneAvatar.buildSinglePlaneAvatarModel',
};
npcRoot.userData.hobunjiCharacterRigScaleState = {
  factor: { x: 1.125, y: 1.125 },
  coordinateSpace: 'character-floor-parent',
};
npcRoot.add(avatar);
avatar.add(npcMesh);
avatar.add(headBone);

const deps = {
  playerMesh: playerRoot,
  getPlayerData: () => ({ appearance: { speciesId: 'tletingan', gender: 'male' } }),
  npcWalkers: [{
    root: npcRoot,
    rec: { name: 'Gorobi Ginju', appearance: { speciesId: 'mao-ao', gender: 'male' } },
  }],
  companionObjects: [],
};

const window = {
  PixelProbe: { init() {} },
  HobunjiTransformDump: {
    dumpSubtree(root) { return { root }; },
    formatReport(dump, options) { return `=== ${options.title} ===\n${dump.root.name}`; },
  },
};
const context = vm.createContext({
  window,
  document: { getElementById() { return null; } },
  THREE: { Raycaster: class Raycaster {} },
  MutationObserver: class MutationObserver {},
  setTimeout() { return 1; },
  console,
});
vm.runInContext(source, context, { filename: 'character-rig-pixel-probe-runtime.js' });

const api = window.HobunjiCharacterRigPixelProbe;
assert(api, 'Pixel Probe character-rig runtime helper must install');

// Reproduces the real report: invisible player hand axes are geometrically
// nearer than the visible Gorobi portrait. The visible NPC must win.
const selected = api.selectOwnedHit([
  { object: hiddenPlayerAxes, distance: 1.48 },
  { object: npcMesh, distance: 4.18 },
], deps);
assert.strictEqual(selected?.owner?.kind, 'npc');
assert.strictEqual(selected?.owner?.label, 'Gorobi Ginju');
assert.strictEqual(selected?.owner?.root, npcRoot);

const diagnostic = Array.from(api.headDiagnosticLines(selected.owner));
assert(diagnostic.some(line => line.includes('applied=YES') && line.includes('head=1.0200')), 'runtime authored head tuple must be reported');
assert(diagnostic.some(line => line.includes('expectedLocal=(0.9067,0.9067,1.0000)') && line.endsWith('MATCH')), 'live head-only bone must be compared against the independent compensation expected for Gorobi');

const oldReport = [
  'Pixel Probe report',
  '',
  '=== Local transform dump: player "player" (compare against the same dump taken in the Attack Animation Editor) ===',
  '=== player rig ===',
  'player_root',
  '',
  '=== player tool holder (parented as a sibling of playerMesh, not a child) ===',
  'tool holder',
  '',
  '=== Blend check (isolates the player + each active creature avatar independently, live, on this device) ===',
  'blend data',
].join('\n');
const corrected = api.replaceTransformSection(oldReport, selected.owner);
assert(corrected.includes('=== Local transform dump: npc "Gorobi Ginju" (selected from the nearest visible owned ray hit) ==='));
assert(corrected.includes('gorobi_root'));
assert(corrected.includes('Separate head-scale check: expectedLocal=(0.9067,0.9067,1.0000)'));
assert(!corrected.includes('player_root'), 'wrong player transform subtree must be removed, not merely followed by another dump');
assert(corrected.includes('=== Blend check'), 'later Pixel Probe sections must survive transform-section replacement');

console.log('character rig Pixel Probe runtime tests passed');

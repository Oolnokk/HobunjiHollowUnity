// Run: node scripts/test-dev-companion-appearance.js
// Exercises the actual registered game-side panel without a browser or save data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Color {
  constructor(value = '#777777') { this.value = value; }
  clone() { return new Color(this.value); }
  copy(other) { this.value = other.value; return this; }
  multiply(other) { this.value += '*' + other.value; return this; }
}
class Vector3 { constructor() { this.x = 0; this.y = 0; this.z = 0; } }
const THREE = { Color, Vector3 };
const makeMaterial = value => ({
  color: new Color(value), opacity: 1, transparent: false,
  clone() { return makeMaterial(this.color.value); },
  dispose() { this.disposed = true; },
});
function mesh(name, x, z) {
  return {
    name, position: { x, y: 0, z }, scale: { x: 1, y: 1, z: 1 },
    isObject3D: true, isMesh: true, visible: true, material: makeMaterial('#999999'),
    getWorldPosition(v) { v.x = this.position.x; v.z = this.position.z; return v; },
    traverse(fn) { fn(this); },
    updateMatrixWorld() {},
  };
}

const playerMesh = mesh('Player', 0, 0);
const npcMesh = mesh('Jubmir', 1, 0);
const animalMesh = mesh('dabinggi', 2, 0);
const propMesh = mesh('Lantern', 3, 0);
const farMesh = mesh('Far decoration', 30, 0);
const playerData = { appearance: { bodyColors: { A: { hex: '#aa1100' } } } };
const walker = { area: 'farm', root: npcMesh, profile: { bodyColors: { A: { hex: '#11aa00' } } },
  rec: { id: 'jubmir', name: 'Jubmir', appearance: { bodyColors: { A: { hex: '#11aa00' } } } } };
const creature = { areaId: 'farm', creatureKey: 'dabinggi', avatarRef: { group: animalMesh },
  genotype: { base: { color: '#ffff00' } }, visualScaleX: 1, visualScaleY: 1, visualScaleZ: 1 };
const calls = { player: 0, npc: 0, creature: 0, upload: 0 };
const playerHood = {
  cosmeticId: 'fine_hood', slot: 'hood', colorA: { hex: '#123456' }, colorB: { hex: '#aabbcc' },
  colorC: { hex: '#887766' },
  weaving: { layers: { cloth: { patterns: [{ meshScale: 1, meshRotationDeg: 0, usageOffsetX: 0 }] } },
    trim: { enabled: true, dyeSlot: 'B' } },
  weight: 500, defense: 20,
}; // Real equipped item retains gameplay stats and identity when editing appearance.
const npcOutfit = { slot: 'torso', cosmeticId: 'plain_tunic', colorA: { hex: '#44aa44' },
  weaving: { pattern: { meshScale: 1, usageOffsetY: 3 } }, weight: 12 };
const npcPreview = new Map(); // Models transient NpcWardrobe's garment render override without persisting rec data.
let panel;
const window = {
  THREE,
  DevCompanion: { registerCheatPanel(spec) { panel = spec; } },
  Combat: { deps: { playerMesh, getPlayerData: () => playerData, getCurrentArea: () => 'farm',
    npcWalkers: [walker], animalObjects: [creature], companionObjects: [], hostileObjects: [] } },
  PlayerBodyTransformComposer: { getPlayerMesh: () => playerMesh },
  GridTileAccessors: { getCurrentArea: () => 'farm',
    getActiveScene: () => ({ children: [propMesh, farMesh], updateMatrixWorld() {} }) },
  WorldPortraitLife: { getPlayerAvatar: () => ({ profile: { bodyColors: playerData.appearance.bodyColors } }) },
  __hobunjiFurnitureDebug: { getNpcWalkers: () => [walker] },
  EquipmentPanel: {
    refreshPlayerAvatar: async () => { calls.player++; playerMesh.scale.x = 1; }, // Simulates the full avatar rebuild clearing a temporary visual transform.
    devWornClothing: () => ({ hood: playerHood }),
  },
  NpcWardrobe: {
    refreshWalkerAppearance: async () => { calls.npc++; },
    wornClothingItemsForRecord: () => [{ ...JSON.parse(JSON.stringify(npcOutfit)), ...(npcPreview.get('torso') || {}) }],
    setDevClothingVisual: (_id, slot, visual) => { npcPreview.set(slot, visual); return true; },
    getDevClothingVisual: (_id, slot) => npcPreview.get(slot) || null,
    clearDevClothingVisual: (_id, slot = null) => slot ? npcPreview.delete(slot) : (npcPreview.clear(), true),
  },
  CreatureGeneticsRender: { composeFrame: async () => { calls.creature++; return {}; } },
  PNGPlaneAvatar: { refreshSinglePlaneAvatarModel: () => { calls.upload++; return true; } },
};

vm.runInNewContext(fs.readFileSync('docs/js/dev-companion-appearance.js', 'utf8'), { window, THREE, console });
assert(panel, 'inspector registers through the existing companion panel API');

(async () => {
  const options = panel.render().actions[0].options;
  assert.equal(options.length, 4, 'player, NPC, creature, and nearby world mesh are selectable, not far mesh');
  assert(panel.render().actions.some(a => a.id === 'color:A' && a.input.type === 'color'));

  assert.equal((await panel.onAction('color:A', { value: '#123456' })).ok, true);
  assert.equal(playerData.appearance.bodyColors.A.hex, '#123456');
  assert.equal(calls.player, 1, 'canonical player refresh used');
  assert.equal((await panel.onAction('scale:x', { value: 150 })).ok, true);
  assert.equal(playerMesh.scale.x, 1.5);
  assert.equal((await panel.onAction('refresh')).ok, true);
  assert.equal(playerMesh.scale.x, 1.5, 'rebuild re-applies the selected visual scale');

  const originalMaterial = playerMesh.material;
  assert.equal((await panel.onAction('tint', { value: '#ff0000' })).ok, true);
  assert.equal((await panel.onAction('opacity', { value: 75 })).ok, true);
  assert.notEqual(playerMesh.material, originalMaterial, 'material is cloned');
  assert.equal(playerMesh.material.opacity, .75);
  assert.equal(originalMaterial.color.value, '#999999', 'shared original material is unchanged');
  assert.equal((await panel.onAction('reset')).ok, true);
  assert.equal(playerMesh.material, originalMaterial);
  assert.equal(playerMesh.scale.x, 1);
  assert.equal(playerData.appearance.bodyColors.A.hex, '#aa1100');

  assert(panel.render().actions.some(a => a.id === 'cloth-color:hood:colorA' && a.input.type === 'color'));
  assert(panel.render().actions.some(a => a.id === 'cloth-pattern:hood:cloth:0:meshScale'));
  assert.equal((await panel.onAction('cloth-color:hood:colorA', { value: '#445566' })).ok, true);
  assert.equal(playerHood.colorA.hex, '#445566');
  assert.equal((await panel.onAction('cloth-pattern:hood:cloth:0:meshScale', { value: 2.5 })).ok, true);
  assert.equal(playerHood.weaving.layers.cloth.patterns[0].meshScale, 2.5);
  assert.equal((await panel.onAction('cloth-trim:hood:enabled', { value: 'no' })).ok, true);
  assert.equal(playerHood.weaving.trim.enabled, false);
  assert.equal((await panel.onAction('cloth-pattern:hood:cloth:0:meshScale', { value: -10 })).ok, false);
  assert.equal(playerHood.weight, 500, 'appearance tuning does not change garment weight');
  assert.equal(playerHood.defense, 20, 'appearance tuning does not change garment defense');
  await panel.onAction('reset');
  assert.equal(playerHood.colorA.hex, '#123456', 'original garment dye restored');
  assert.equal(playerHood.weaving.layers.cloth.patterns[0].meshScale, 1, 'original weaving restored');
  assert.equal(playerHood.weaving.trim.enabled, true, 'original trim restored');

  const npcId = options.find(o => o.label.includes('Jubmir')).value;
  assert.equal((await panel.onAction('select', { value: npcId })).ok, true);
  assert(panel.render().actions.some(a => a.id === 'cloth-color:torso:colorA'));
  assert.equal((await panel.onAction('cloth-color:torso:colorA', { value: '#bb3333' })).ok, true);
  assert.equal(npcPreview.get('torso').colorA.hex, '#bb3333');
  assert.equal(npcOutfit.colorA.hex, '#44aa44', 'NPC preview does not modify authored outfit');
  assert.equal((await panel.onAction('cloth-pattern:torso:__legacy:0:usageOffsetY', { value: 24 })).ok, true);
  assert.equal(npcPreview.get('torso').weaving.pattern.usageOffsetY, 24);
  await panel.onAction('reset');
  assert.equal(npcPreview.size, 0, 'reset clears NPC clothing preview');
  assert.equal((await panel.onAction('color:A', { value: '#abcdef' })).ok, true);
  assert.equal(walker.rec.appearance.bodyColors.A.hex, '#abcdef');
  assert(calls.npc >= 1);
  await panel.onAction('reset');
  assert.equal(walker.rec.appearance.bodyColors.A.hex, '#11aa00');
  delete walker.rec.appearance;
  walker.profile.bodyColors.A = { h: 0, s: -.6, v: -.3 }; // Legacy NPC source can use authored H/S/V without an appearance block.
  assert(panel.render().actions.some(action => action.id === 'hsv:A:h'));
  assert.equal((await panel.onAction('hsv:A:h', { value: 45 })).ok, true);
  assert.equal(walker.rec.appearance.bodyColors.A.h, 45);
  assert.equal((await panel.onAction('hsv:A:s', { value: -3 })).ok, false, 'H/S/V limits are validated');
  await panel.onAction('reset');
  assert.equal(walker.rec.appearance, undefined, 'reset removes a temporary legacy NPC appearance block');

  const creatureId = options.find(o => o.label.includes('dabinggi')).value;
  assert.equal((await panel.onAction('select', { value: creatureId })).ok, true);
  assert.equal((await panel.onAction('coat', { value: '#654321' })).ok, true);
  assert.equal(creature.genotype.base.color, '#654321');
  assert.equal(calls.creature, 1);
  assert.equal(calls.upload, 1);
  assert.equal((await panel.onAction('opacity', { value: 120 })).ok, false, 'invalid values yield a companion error');
  await panel.onAction('reset');
  assert.equal(creature.genotype.base.color, '#ffff00');

  const propId = options.find(o => o.label.includes('Lantern')).value;
  assert.equal((await panel.onAction('select', { value: propId })).ok, true);
  assert.equal((await panel.onAction('scale:y', { value: 200 })).ok, true);
  assert.equal(propMesh.scale.y, 2, 'named scene object changes live');
  assert.equal((await panel.onAction('reset')).ok, true);
  assert.equal(propMesh.scale.y, 1);

  assert.equal((await panel.onAction('select', { value: npcId })).ok, true);
  walker.area = 'town';
  assert.equal((await panel.onAction('color:A', { value: '#abcdef' })).ok, false, 'out-of-area target cannot be edited');
  assert.equal(panel.render().actions[0].value, 'player', 'despawned selection falls back to player');
  console.log('test-dev-companion-appearance: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
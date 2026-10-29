'use strict';
// Player, town NPC and hostile rigs must receive the species body scale exactly
// once, on the node that owns portrait + feet + hands, so animation, stride and
// weapon-pose math see the same body everywhere (and in the editors).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = path => fs.readFileSync(path, 'utf8');

const handAttachCalls = [];
const hands = { attach(_THREE, parent) { handAttachCalls.push(parent); return { parent }; } };
const windowObject = {
  ProceduralHandAttachments: hands,
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { characters: {} },
  HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS: {},
  location: { pathname: '/game/' },
  setInterval(fn) { fn(); return 1; },
  clearInterval() {},
};
windowObject.window = windowObject;
const context = vm.createContext(windowObject);
vm.runInContext(read('docs/config/character-rig-scale-defaults.js'), context);
vm.runInContext(read('docs/js/character-rig-scale.js'), context);
const api = context.HobunjiCharacterRigScale;

function node(name, parent = null, userData = {}) {
  const n = {
    name, isObject3D: true, parent, children: [], userData,
    scale: { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    updateMatrix() {}, updateMatrixWorld() {}, traverse(visit) { visit(this); },
  };
  parent?.children.push(n);
  return n;
}
const worldScale = n => { let x = 1, y = 1; for (let c = n; c; c = c.parent) { x *= c.scale.x; y *= c.scale.y; } return [x, y]; };
const attach = (parent, species = 'mao-ao', gender = 'male') => context.ProceduralHandAttachments.attach({}, parent, { speciesId: species, gender });
const expected = api.scaleFor('mao-ao', 'male'); // { x: 0.81675, y: 1.089 }
const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-9, `${label}: ${a} vs ${b}`);

// Player: the hand parent is the floor-anchored body root itself (unchanged).
const playerMesh = node('player_root');
attach(playerMesh);
near(playerMesh.scale.x, expected.x, 'player x'); near(playerMesh.scale.y, expected.y, 'player y');

// Town NPC: hands live under the lean pivot, feet and portrait elsewhere under
// the flagged rig root. Scale must land on the rig root, once, so feet, portrait
// and hands share it, and the lean pivot must not be scaled a second time.
const npcRoot = node('npc_walker_x');
const npcRig = node('npc_character_rig_root', npcRoot, { hobunjiCharacterRigScaleRoot: true });
const npcLean = node('npc_run_lean_visual', node('alcohol_pose', npcRig));
const npcFeet = node('npc_procedural_feet', npcRig);
attach(npcLean);
near(npcRig.scale.x, expected.x, 'npc rig x'); near(npcRig.scale.y, expected.y, 'npc rig y');
assert.deepEqual([npcLean.scale.x, npcLean.scale.y], [1, 1], 'lean pivot is not scaled separately');
for (const [label, target] of [['hands', npcLean], ['feet', npcFeet]]) {
  const [wx, wy] = worldScale(target);
  near(wx, expected.x, `npc ${label} world x`); near(wy, expected.y, `npc ${label} world y`);
}
// A second hand attach (reapplication) must not accumulate.
attach(npcLean);
near(npcRig.scale.x, expected.x, 'npc rig x after reapply');

// Hostile: the whole center-anchored group already carries the species scale,
// so the hands pivot is flagged to inherit it rather than be scaled again.
const hostileGroup = node('bandit_avatar_group');
hostileGroup.scale.set(expected.x, expected.y, expected.x);
const handsPivot = node('bandit_hands_pivot', hostileGroup, { hobunjiCharacterRigScaleInherited: true });
attach(handsPivot);
assert.deepEqual([handsPivot.scale.x, handsPivot.scale.y], [1, 1], 'hostile hands pivot must not be scaled twice');
const [hx, hy] = worldScale(handsPivot);
near(hx, expected.x, 'hostile hand world x'); near(hy, expected.y, 'hostile hand world y');

// Source wiring: the real builders set these flags.
const game = read('docs/game.js');
assert(game.includes("npcCharacterRigRoot.userData.hobunjiCharacterRigScaleRoot = true"), 'NPC walkers flag one rig-scale root');
assert(/ProceduralLegAnimation\?\.attach\(THREE, npcCharacterRigRoot,/.test(game), 'NPC feet attach under the scaled rig root, not the unscaled walker root');
assert(game.includes('attachAlcoholPose?.(THREE, npcCharacterRigRoot,'), 'NPC portrait pose group sits under the scaled rig root');
const bandit = read('docs/js/combat/combat-bandit.js');
assert(bandit.includes('handsPivot.userData.hobunjiCharacterRigScaleInherited = true'), 'hostile hands inherit the group scale instead of re-scaling');

// Editor: Maskbound presets carry the live troop proportions and apply them on the game's floor-root path.
const editor = read('docs/tools/procedural-animation-editor/index.html');
const guardian = {};
guardian.window = guardian;
vm.runInNewContext(read('docs/js/combat/combat-maskbound-guardian.js'), guardian);
const presets = vm.runInNewContext(
  editor.slice(editor.indexOf('const MOVEMENT_PRESETS = Object.freeze('), editor.indexOf('const IMPORTED_DRUNKEN_DIRECTIONAL_POSES')) + '\nMOVEMENT_PRESETS',
  { REPOSITORY_MOVEMENT_LOGIC: { speed: 2.38, acceleration: 9.8, turnAcceleration: 13.2, deceleration: 18.5 } });
for (const troop of ['sentinel', 'bulwark', 'reacher']) {
  const a = guardian.MaskboundGuardianCombat.troopTypes[troop].anatomy;
  const b = presets['maskbound_' + troop].bodyScale;
  assert.deepEqual([b.x, b.y, b.head, b.offsetY], [a.rigScaleX, a.rigScaleY, a.headScale, a.headOffsetY], `${troop} editor body matches the live troop`);
}
assert.equal(presets.regular.bodyScale, undefined, 'ordinary presets keep the NPC species scale');
assert(editor.includes('procedural.settings?.bodyScale || null, age'), 'editor bind applies the active troop body on the floor root');
assert(/syncPreviewBodyScale\(\);\s*resetProceduralMovement/.test(editor), 'preset/import changes re-apply the body scale');

// updateCreatureMesh rewrites a hostile's group scale every frame from visualScaleX/Y(/Z); the species body scale
// must be carried there or it is wiped on the first tick (it only existed for the spawn frame before).
{
  const source = read('docs/js/creature-genetics.js');
  const start = source.indexOf('function applyCreatureBillboardScale(');
  let depth = 0, end = source.indexOf('{', start);
  for (let i = end; i < source.length; i++) { if (source[i] === '{') depth++; if (source[i] === '}' && --depth === 0) { end = i + 1; break; } }
  const fn = vm.runInNewContext(`(${source.slice(start, end)})`);
  assert.equal(typeof fn, 'function', 'applyCreatureBillboardScale is reachable');
  const group = { scale: { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } } };
  fn(group, { x: 0.955, y: 1.255, z: 0.955 }, 1);
  assert.deepEqual([group.scale.x, group.scale.y, group.scale.z], [0.955, 1.255, 0.955], 'hostile body scale survives the per-frame billboard update, depth tracking width');
  fn(group, { x: 1.2, y: 0.8 }, 1);
  assert.deepEqual([group.scale.x, group.scale.y, group.scale.z], [1, 0.8, 1.2], 'animals (no depth axis) are unchanged');
}
assert.match(bandit, /visualScaleX: avatarRef\.rigScale\?\.x \?\? 1, visualScaleY: avatarRef\.rigScale\?\.y \?\? 1, visualScaleZ: avatarRef\.rigScale\?\.x \?\? 1/, 'hostile entities carry the species body scale as their visual scale');
assert.match(game, /applyCreatureBillboardScale\(grp, \{ x: c\.visualScaleX, y: c\.visualScaleY, z: c\.visualScaleZ \}/, 'the per-frame update passes the depth axis');

// The hostile weapon's height-scaled size/grip offset depends on asynchronously measured species heights; it must
// not cache the unmeasured fallback (0.55, no offset), which the player and editor never show.
assert.match(bandit, /heightReady \? weaponKey : null/, 'unmeasured weapon placement is retried, not cached');
assert.match(read('docs/js/hand-tool-grips.js'), /function characterHeightReady\(/, 'grips expose whether species heights are measured');
assert.match(read('docs/tools/enemy-loadout-editor/preview.js'), /js\/character-dimensions\.js/, 'the Workshop loads the species height measurements');

console.log('Player/NPC/hostile rig scale parity: one species scale on the owning rig node, hands never double-scaled, editor previews troop bodies');

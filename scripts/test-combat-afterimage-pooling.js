#!/usr/bin/env node
'use strict';

// Motion smears must reuse actor RGB textures and GPU-skinned geometry.
// No CPU vertex baking, canvas snapshots, additional effects per strike, or
// disposal of textures owned by the live portrait is permitted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/combat/combat-blink-dodge.js', 'utf8'); // The live effect, not a duplicate implementation.

let nowMs = 1000; // Controlled clock for per-actor samples and the warm-cache retention period.
const counts = { meshes: 0, materials: 0, textures: 0, canvases: 0, disposedGeometry: 0, disposedMaterial: 0, boneTransforms: 0 }; // Used to ensure each movement reuses live GPU resources.
class Matrix {
  constructor() { this.elements = Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)); }
  copy(other) { this.elements = other.elements.slice(); return this; }
  invert() { return this; }
  premultiply() { return this; }
}
class Group {
  constructor() {
    this.children = []; this.parent = null; this.userData = {}; this.isScene = false;
    this.visible = true; this.matrixWorld = new Matrix();
  }
  add(child) { child.parent?.remove?.(child); this.children.push(child); child.parent = this; }
  remove(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parent = null;
  }
  traverse(fn) { fn(this); for (const child of this.children) child.traverse ? child.traverse(fn) : fn(child); }
  updateWorldMatrix() {}
}
class Attribute {
  constructor(array, itemSize, normalized = false) { this.array = array; this.itemSize = itemSize; this.normalized = normalized; this.count = array.length / itemSize; }
}
class Geometry {
  constructor() { this.attributes = {}; this.groups = []; this.userData = {}; }
  setAttribute(name, attribute) { this.attributes[name] = attribute; }
  getAttribute(name) { return this.attributes[name]; }
  getIndex() { return null; }
  addGroup(start, count, materialIndex) { this.groups.push({ start, count, materialIndex }); }
  computeBoundingSphere() {}
  dispose() { counts.disposedGeometry++; }
}
class Color {
  constructor(value) { this.value = value; }
  copy(other) { if (other) this.value = other.value; return this; }
}
class Material {
  constructor(name, texture) {
    this.name = name; this.map = texture; this.alphaMap = texture; this.emissiveMap = null;
    this.opacity = 1; this.alphaTest = 0.35; this.color = new Color('red');
    this.emissive = new Color('black');
  }
  clone() {
    counts.materials++;
    const clone = Object.assign(new Material(this.name, this.map), this);
    clone.color = new Color(this.color.value); clone.emissive = new Color(this.emissive.value);
    return clone;
  }
  dispose() { counts.disposedMaterial++; }
}
class Mesh extends Group {
  constructor(geometry, material) {
    super();
    counts.meshes++;
    this.geometry = geometry; this.material = material;
    this.isMesh = true; this.matrix = new Matrix(); this.layers = { mask: 1 };
    this.renderOrder = 0; this.matrixAutoUpdate = true;
  }
}
class SkinnedMesh extends Mesh {
  constructor(geometry, material) {
    super(geometry, material); this.isSkinnedMesh = true;
    this.skeleton = { update() {} }; this.bindMatrix = new Matrix();
    this.bindMatrixInverse = new Matrix(); this.bindMode = 'attached';
  }
  bind(skeleton, matrix) { this.skeleton = skeleton; this.bindMatrix.copy(matrix); }
}
function portraitGeometry() {
  const geometry = new Geometry(); // The avatar's 4x4 two-sided grid with live skin weights.
  geometry.userData = { segmentsX: 4, segmentsY: 4 };
  const position = [], uv = [], skinIndex = [], skinWeight = [];
  for (let face = 0; face < 2; face++) {
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
      for (let vertex = 0; vertex < 6; vertex++) {
        position.push(col / 4, row / 4, 0);
        uv.push(col / 4, row / 4);
        skinIndex.push(face, 0, 0, 0);
        skinWeight.push(1, 0, 0, 0);
      }
    }
    geometry.addGroup(face * 96, 96, face);
  }
  geometry.setAttribute('position', new Attribute(new Float32Array(position), 3));
  geometry.setAttribute('uv', new Attribute(new Float32Array(uv), 2));
  geometry.setAttribute('skinIndex', new Attribute(new Uint16Array(skinIndex), 4));
  geometry.setAttribute('skinWeight', new Attribute(new Float32Array(skinWeight), 4));
  return geometry;
}
const scene = new Group(); scene.isScene = true; // Scene receives at most one live smear per portrait mesh.
function actor(name, isEnemy) {
  const root = new Group(); scene.add(root);
  const colors = [{ id: name + '-patterned-front' }, { id: name + '-patterned-back' }]; // Shared real texture identity proves no copies.
  const material = [new Material('npc_avatar_skinned_front_' + name, colors[0]), new Material('npc_avatar_skinned_back_' + name, colors[1])];
  const portrait = new SkinnedMesh(portraitGeometry(), material);
  portrait.name = name + '_portrait';
  portrait.boneTransform = () => { counts.boneTransforms++; throw new Error('CPU skinning is forbidden'); };
  root.add(portrait);
  const model = { x: 0, y: 0, lunging: false, dodging: false, stamina: 200, health: 100,
    ...(isEnemy ? { isBandit: true, state: 'chase', _banditLunging: false, avatarRef: { group: root } } : {}) };
  return { root, portrait, material, colors, model };
}
const player = actor('player', false), enemy = actor('enemy', true);
const combat = {
  abilities: { register() {} },
  deps: { player: player.model, playerMesh: player.root, TILE: 64, hostileObjects: [enemy.model], getCurrentArea: () => null },
  update() {}, setMovementSpeedMul() {},
};
const win = {
  Combat: combat, THREE: { Mesh, SkinnedMesh, BufferGeometry: Geometry, BufferAttribute: Attribute, Matrix4: Matrix },
  BanditCombat: { setCombatExpression() {} },
  WorldPortraitLife: { setPlayerCombatExpression() {}, isPlayerCombatExpressionApplied: () => true },
};
vm.runInNewContext(source, {
  window: win, performance: { now: () => nowMs }, console,
  document: { createElement() { counts.canvases++; throw new Error('Never copy a portrait canvas'); } },
}, { filename: 'combat-blink-dodge.js' });
const metrics = () => win.HobunjiDodgeFeedback.getDebug().blink.afterimages;
const smears = () => scene.children.filter(mesh => mesh.name === 'combat_portrait_motion_smear');
player.model.lunging = true;
enemy.model._banditLunging = true;
combat.update(0.016);
player.model.x += 64; enemy.model.x += 64;
nowMs += 60; combat.update(0.06);
assert.equal(smears().length, 2, 'player and enemy get one colored GPU smear each');
assert.equal(metrics().active, 2, 'mobile diagnostics track both active smears');
assert.equal(metrics().entriesCreated, 2, 'one reusable mesh was created for each actor');
assert.equal(counts.canvases, 0, 'no canvas snapshots');
assert.equal(counts.textures, 0, 'no texture clones or uploads');
assert.equal(counts.boneTransforms, 0, 'no CPU skinning');
assert.equal(smears()[0].geometry.getAttribute('position').count, 48, '4x4 skin grid decimated once to 2x2 per face');
assert.equal(smears()[0].geometry.getAttribute('skinIndex').count, 48, 'the reduced mesh retains live GPU skinning');
assert.equal(smears()[0].geometry.getAttribute('skinWeight').count, 48);
const first = smears().slice(); // Mesh identity must survive further strikes and idle fade.
const playerSmear = first.find(mesh => mesh.material[0].map === player.colors[0]);
assert(playerSmear, 'the visible player effect retains the original character texture');
assert.strictEqual(playerSmear.material[1].map, player.colors[1], 'rear colors and patterns are retained too');
assert.strictEqual(playerSmear.skeleton, player.portrait.skeleton, 'smear shares the live rig bones');
assert.equal(playerSmear.material[0].depthWrite, false, 'soft opacity does not occlude the live portrait');
assert.equal(playerSmear.material[0].transparent, true);
const shaders = { uniforms: {}, vertexShader: '#include <common>\n#include <skinning_vertex>',
  fragmentShader: '#include <common>\n#include <dithering_fragment>' }; // Exercise the real r128 onBeforeCompile modification.
playerSmear.material[0].onBeforeCompile(shaders, {});
assert.match(shaders.vertexShader, /transformed\.xz -= uSmearDirection/);
assert.match(shaders.fragmentShader, /gl_FragColor\.a \*= uSmearOpacity \* smoothstep/);
assert.doesNotMatch(shaders.fragmentShader, /gl_FragColor\.rgb\s*[\*+\-=]/, 'shader may fade only alpha, never shift RGB');
assert.equal(shaders.uniforms.uSmearOpacity.value > 0, true);
const opacityAtImpact = shaders.uniforms.uSmearOpacity.value;
player.model.lunging = false; enemy.model._banditLunging = false;
nowMs += 90; combat.update(0.09);
assert(shaders.uniforms.uSmearOpacity.value < opacityAtImpact, 'blur alpha decays after a lunge');
nowMs += 300; combat.update(0.3);
assert.equal(metrics().active, 0, 'finished smears are hidden, not kept drawing');
assert.equal(smears().length, 2, 'warm actors retain their effect meshes for the next strike');
player.model.lunging = true; enemy.model._banditLunging = true;
player.model.x += 128; enemy.model.x += 64;
nowMs += 60; combat.update(0.06);
assert.deepEqual(smears(), first, 'repeated attacks reuse exactly the same GPU smear objects');
assert.equal(metrics().entriesCreated, 2, 'no new mesh/material/texture churn in repeated fights');
assert.equal(metrics().entriesReused >= 2, true);
assert.equal(counts.boneTransforms, 0);
assert.equal(counts.canvases, 0);
const newFront = { id: 'new-face' }; // A replacement texture must cause only this actor's resources to refresh.
player.material[0].map = newFront;
player.model.x += 64; nowMs += 60; combat.update(0.06);
assert.equal(metrics().entriesCreated, 3, 'a changed source texture rebuilds one actor smear, not the enemy');
assert(smears().some(mesh => mesh.material[0].map === newFront), 'new portrait appearance is visible');
player.model.lunging = false; enemy.model._banditLunging = false;
nowMs += 32000; combat.update(0.3);
assert.equal(metrics().pooled, 0, 'stale actor effects are disposed after idle retention');
assert(counts.disposedMaterial >= 4, 'only cloned materials were disposed');
assert.equal(counts.disposedGeometry >= 2, true, 'reduced geometries are released');
assert(player.portrait.geometry.getAttribute('position'), 'the live character geometry remains intact');
assert.equal(counts.textures, 0, 'live character textures were never disposed');
console.log('OK: color-preserving GPU motion smears reuse rigs and textures, fade alpha, and keep resources bounded');

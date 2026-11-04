#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'docs/js/substance-cover-shell.js');
const indexPath = path.join(repoRoot, 'docs/index.html');
const source = fs.readFileSync(sourcePath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');

class Vector3 {
  constructor(x = 1, y = 1, z = 1) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(other) { return this.set(other.x, other.y, other.z); }
}
class Layers {
  constructor() { this.mask = 1; }
  set(layer) { this.mask = (1 << layer) >>> 0; }
}
class Node {
  constructor() {
    this.children = [];
    this.parent = null;
    this.userData = {};
    this.position = new Vector3(0, 0, 0);
    this.quaternion = { copy() { return this; } };
    this.scale = new Vector3(1, 1, 1);
    this.layers = new Layers();
    this.visible = true;
    this.renderOrder = 0;
    this.frustumCulled = true;
    this.matrixAutoUpdate = true;
  }
  add(child) {
    if (child.parent) child.parent.remove(child);
    child.parent = this;
    this.children.push(child);
  }
  remove(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parent = null;
  }
}
class Group extends Node {}
class BufferAttribute {
  constructor(values, itemSize = 3) {
    this.array = Float32Array.from(values);
    this.itemSize = itemSize;
    this.count = this.array.length / itemSize;
    this.needsUpdate = false;
  }
  getX(index) { return this.array[index * this.itemSize]; }
  getY(index) { return this.array[index * this.itemSize + 1]; }
  getZ(index) { return this.array[index * this.itemSize + 2]; }
  setXYZ(index, x, y, z) {
    const offset = index * this.itemSize;
    this.array[offset] = x;
    this.array[offset + 1] = y;
    this.array[offset + 2] = z;
  }
}
class BufferGeometry {
  constructor(positions, normals) {
    this.attributes = { position: new BufferAttribute(positions) };
    if (normals) this.attributes.normal = new BufferAttribute(normals);
    this.morphAttributes = {};
    this.disposeCount = 0;
    this.boundsUpdated = 0;
  }
  clone() {
    const result = new BufferGeometry([], []);
    result.attributes = {};
    for (const [key, attribute] of Object.entries(this.attributes)) {
      result.attributes[key] = new BufferAttribute(attribute.array, attribute.itemSize);
    }
    result.morphAttributes = Object.fromEntries(Object.entries(this.morphAttributes).map(([key, value]) => [key, value.slice()]));
    return result;
  }
  getAttribute(name) { return this.attributes[name] || null; }
  computeVertexNormals() {
    const position = this.attributes.position;
    this.attributes.normal = new BufferAttribute(Array.from({ length: position.count }, () => [0, 0, 1]).flat());
  }
  computeBoundingBox() { this.boundsUpdated++; }
  computeBoundingSphere() { this.boundsUpdated++; }
  dispose() { this.disposeCount++; }
}
class Color {
  constructor(value = 0xffffff) { this.value = value; }
  set(value) { this.value = value; return this; }
}
class Material {
  constructor(options = {}) {
    Object.assign(this, options);
    this.color = options.color instanceof Color ? options.color : new Color(options.color ?? 0xffffff);
    this.opacity = options.opacity ?? 1;
    this.transparent = !!options.transparent;
    this.depthWrite = options.depthWrite !== false;
    this.side = options.side ?? 'front';
    this.disposeCount = 0;
  }
  clone() {
    return new Material({
      color: new Color(this.color.value),
      opacity: this.opacity,
      transparent: this.transparent,
      depthWrite: this.depthWrite,
      side: this.side,
      map: this.map || null,
      roughness: this.roughness,
      metalness: this.metalness,
    });
  }
  dispose() { this.disposeCount++; }
}
class Mesh extends Node {
  constructor(geometry, material) {
    super();
    this.isMesh = true;
    this.geometry = geometry;
    this.material = material;
    this.castShadow = true;
    this.receiveShadow = true;
  }
}
const THREE = {
  Group,
  Mesh,
  MeshStandardMaterial: Material,
  BufferGeometry,
  BufferAttribute,
  FrontSide: 0,
  BackSide: 1,
};
const browser = { THREE };
vm.runInNewContext(source, { window: browser, console }, { filename: sourcePath });
const api = browser.SubstanceCoverShell;
assert.equal(api.available, true, 'the runtime utility should install when Three.js is present');
assert.equal(api.version, '1.0.0');

function triangleGeometry(z = 0, normal = [0, 0, 1]) {
  return new BufferGeometry(
    [0, 0, z, 1, 0, z, 0, 1, z],
    [...normal, ...normal, ...normal],
  );
}
function getShellPosition(mesh, vertex = 0) {
  return mesh.geometry.getAttribute('position').getZ(vertex);
}

// A multi-mesh hierarchy receives independent outward covers that inherit each
// source mesh's transforms without cloning or mutating its geometry/material.
{
  const root = new Group();
  const branch = new Group();
  const firstMaterial = new Material({ color: new Color('#777777'), roughness: 0.8 });
  const secondMaterial = new Material({ color: new Color('#aaaaaa') });
  const first = new Mesh(triangleGeometry(0), firstMaterial);
  const second = new Mesh(triangleGeometry(2), [secondMaterial, secondMaterial]);
  first.name = 'stone body';
  second.name = 'stone ornament';
  first.position.set(3, 4, 5);
  second.position.set(-2, 0, 1);
  branch.add(first);
  root.add(branch);
  root.add(second);
  const originalFirstPositions = Array.from(first.geometry.getAttribute('position').array);
  const originalSecondPositions = Array.from(second.geometry.getAttribute('position').array);
  const texture = { name: 'plasm test texture', disposeCount: 0 };
  const shell = api.create(root, { thickness: 0.2, opacity: 0.35, map: texture, color: '#55aaee' });

  assert.equal(shell.snapshot().sourceMeshCount, 2);
  assert.equal(shell.meshes.length, 2);
  assert.equal(shell.groups.length, 2);
  assert.equal(shell.meshes[0].material.side, THREE.FrontSide, 'cover uses front-facing outward surfaces, not an inverted BackSide hull');
  assert.equal(shell.meshes[0].material.map, texture, 'texture overrides are applied to the independent cover material');
  assert.equal(shell.meshes[0].material.opacity, 0.35);
  assert.equal(shell.meshes[0].material.transparent, true);
  assert.equal(shell.meshes[0].material.depthWrite, false);
  assert.equal(firstMaterial.opacity, 1, 'source opacity is unchanged');
  assert.equal(firstMaterial.side, 'front', 'source side is unchanged');
  assert.notStrictEqual(shell.meshes[0].material, firstMaterial, 'source material is never reused or mutated');
  assert.notStrictEqual(shell.meshes[0].geometry, first.geometry, 'source geometry is never reused or mutated');
  assert.ok(Math.abs(getShellPosition(shell.meshes[0]) - 0.2) < 1e-6, 'positive normals expand the surface outward');
  assert.ok(Math.abs(getShellPosition(shell.meshes[1]) - 2.2) < 1e-6, 'each mesh gets its own source-space surface offset');
  assert.deepEqual(Array.from(first.geometry.getAttribute('position').array), originalFirstPositions);
  assert.deepEqual(Array.from(second.geometry.getAttribute('position').array), originalSecondPositions);
  assert.strictEqual(shell.groups[0].parent, first, 'shell group is parented to its source mesh so all later transforms follow automatically');
  assert.equal(shell.meshes[0].raycast(), undefined, 'cover meshes do not intercept interaction rays');
  assert.equal(shell.meshes[0].layers.mask, 1, 'cover remains on the ordinary camera layer only');
  assert.equal(shell.meshes[0].castShadow, false);
  assert.equal(shell.meshes[0].receiveShadow, false);

  shell.setThickness(0.4).setOpacity(1).setColor('#ffccaa').setScale(2, 3, 4).setVisible(false);
  assert.ok(Math.abs(getShellPosition(shell.meshes[0]) - 0.4) < 1e-6, 'thickness updates are based on original positions, not cumulative offsets');
  assert.equal(shell.meshes[0].material.transparent, false, 'fully opaque shells return to the opaque render path by default');
  assert.equal(shell.meshes[0].material.depthWrite, true);
  assert.equal(shell.meshes[0].material.color.value, '#ffccaa');
  assert.equal(shell.groups[0].scale.x, 2);
  assert.equal(shell.groups[0].scale.y, 3);
  assert.equal(shell.groups[0].scale.z, 4);
  assert.equal(shell.groups[0].visible, false);
  assert.throws(() => shell.setScale(-1), /cannot be negative/);

  shell.remove();
  assert.equal(shell.attached, false);
  assert.equal(shell.groups[0].parent, null);
  shell.attach();
  assert.equal(shell.attached, true);
  assert.strictEqual(shell.groups[0].parent, first);

  const third = new Mesh(triangleGeometry(4), new Material());
  root.add(third);
  shell.refresh();
  assert.equal(shell.snapshot().sourceMeshCount, 3, 'refresh adopts new source meshes transactionally');
  assert.equal(shell.groups.length, 3);
  assert.equal(shell.snapshot().thickness, 0.4, 'refresh preserves current animation state');
  assert.equal(shell.groups[2].scale.x, 2, 'refresh preserves the shell-only scale');
  assert.equal(shell.groups[2].visible, false, 'refresh preserves shell visibility');

  // Failed refreshes retain the prior cover, and successful refreshes preserve a detached state.
  const previousGroups = shell.groups;
  shell.remove();
  const unsupported = new Mesh(triangleGeometry(5), new Material());
  unsupported.isInstancedMesh = true;
  root.add(unsupported);
  assert.throws(() => shell.refresh(), /InstancedMesh/);
  assert.deepEqual(shell.groups, previousGroups, 'failed refresh leaves the existing bundle intact');
  assert.equal(shell.attached, false, 'failed refresh leaves a detached cover detached');
  assert.ok(previousGroups.every(group => group.parent === null), 'failed refresh does not partially reattach old overlays');
  root.remove(unsupported);
  const fourth = new Mesh(triangleGeometry(6), new Material());
  root.add(fourth);
  shell.refresh();
  assert.equal(shell.attached, false, "refresh preserves the caller's detached state");
  assert.ok(shell.groups.every(group => group.parent === null), 'detached refresh does not add any overlay to the source hierarchy');
  shell.attach();
  assert.equal(shell.dispose(), true);
  assert.equal(shell.dispose(), false, 'disposal is idempotent');
  assert.equal(shell.disposed, true);
  assert.equal(shell.groups.length, 4);
  assert.equal(first.children.length, 0, 'dispose removes overlays from their original nested source meshes');
  assert.equal(second.children.length, 0, 'dispose removes overlays from all source meshes');
  assert.equal(third.children.length, 0, 'dispose also removes overlays created by refresh');
  assert.equal(fourth.children.length, 0, 'dispose removes overlays from a detached-state refresh after reattachment');
  assert.equal(texture.disposeCount, 0, 'caller-owned textures are never disposed by the shell utility');
  assert.equal(firstMaterial.disposeCount, 0, 'source materials are never disposed by the shell utility');
  assert.equal(first.geometry.disposeCount, 0, 'source geometries are never disposed by the shell utility');
  assert.throws(() => shell.setOpacity(0.5), /disposed/);
}

// Missing vertex normals are generated on the cloned geometry only.
{
  const sourceMesh = new Mesh(new BufferGeometry([0, 0, 0, 1, 0, 0, 0, 1, 0]), null);
  const sourcePositions = Array.from(sourceMesh.geometry.getAttribute('position').array);
  const shell = api.create(sourceMesh, { thickness: 0.1 });
  assert.equal(shell.snapshot().sourceMeshCount, 1, 'a Mesh may itself be the source root');
  assert.ok(Math.abs(getShellPosition(shell.meshes[0]) - 0.1) < 1e-6, 'generated +Z normals produce a positive outward expansion');
  assert.deepEqual(Array.from(sourceMesh.geometry.getAttribute('position').array), sourcePositions);
  assert.ok(shell.meshes[0].material instanceof Material, 'a source without a material receives a safe owned fallback material');
  shell.dispose();
}

// Invalid source vertex data fails before a shell is attached.
{
  const sourceMesh = new Mesh(triangleGeometry(), new Material());
  sourceMesh.geometry.getAttribute('position').array[0] = Number.NaN;
  assert.throws(() => api.create(sourceMesh), /non-finite vertex or normal/);
  assert.equal(sourceMesh.children.length, 0);
}

// Existing covers are ignored during subsequent create/refresh passes.
{
  const sourceMesh = new Mesh(triangleGeometry(), new Material());
  const first = api.create(sourceMesh);
  const second = api.create(sourceMesh);
  assert.equal(first.snapshot().sourceMeshCount, 1);
  assert.equal(second.snapshot().sourceMeshCount, 1, 'a previous shell is never mistaken for source geometry');
  assert.equal(sourceMesh.children.length, 2);
  first.dispose();
  second.dispose();
}

// Unsupported dynamic geometry fails before attaching any partial overlays.
{
  const root = new Group();
  const safeMesh = new Mesh(triangleGeometry(), new Material());
  const skinned = new Mesh(triangleGeometry(), new Material());
  skinned.isSkinnedMesh = true;
  root.add(safeMesh);
  root.add(skinned);
  assert.throws(() => api.create(root), /SkinnedMesh/);
  assert.equal(safeMesh.children.length, 0, 'unsupported geometry is detected before any shell is attached');
  assert.throws(() => api.create(new Mesh(triangleGeometry(), new Material()), { thickness: -1 }), /cannot be negative/);
  const morphed = new Mesh(triangleGeometry(), new Material());
  morphed.geometry.morphAttributes.position = [{}];
  assert.throws(() => api.create(morphed), /morph-target/);
  assert.throws(() => api.create(new Group()), /no supported Mesh/);
}

// A missing Three.js installation reports a safe unavailable state, not a partial API.
{
  const unavailableWindow = {};
  vm.runInNewContext(source, { window: unavailableWindow, console }, { filename: sourcePath + ':missing-three' });
  assert.equal(unavailableWindow.SubstanceCoverShell.available, false);
  assert.match(unavailableWindow.SubstanceCoverShell.reason, /Three\.js r128/);
}

// The global shell utility must load after Three.js but before the ruin bootstrap and game consumers.
const threeAt = index.indexOf('three.js/r128/three.min.js');
const shellAt = index.indexOf('js/substance-cover-shell.js');
const ruinBootstrapAt = index.indexOf('js/dev-random-ruin-bootstrap.js');
const gameAt = index.indexOf('game.js?v=');
assert(threeAt >= 0 && shellAt > threeAt, 'SubstanceCoverShell loads after the global Three.js runtime');
assert(ruinBootstrapAt > shellAt, 'SubstanceCoverShell loads before the Random Test Ruin bootstrap and its composers');
assert(gameAt > shellAt, 'SubstanceCoverShell loads before game.js and future gameplay consumers');


/*
 * The fast suite runs before Three.js is installed in CI, so the mock checks
 * above always run. The workflow repeats this file after installing r128;
 * when the real package exists, exercise the same API against real Three types.
 */
let realThree = null;
try {
  realThree = require('three');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}
if (realThree) {
  const realWindow = { THREE: realThree };
  vm.runInNewContext(source, { window: realWindow, console }, { filename: sourcePath + ':real-three' });
  const realApi = realWindow.SubstanceCoverShell;
  assert.equal(realApi.available, true, 'the utility installs against the actual Three.js r128 runtime');

  const sourceMaterial = new realThree.MeshStandardMaterial({ color: 0x777777, roughness: 0.8 });
  const sourceGeometry = new realThree.BoxGeometry(2, 2, 2);
  const sourceMesh = new realThree.Mesh(sourceGeometry, sourceMaterial);
  const root = new realThree.Group();
  root.position.set(3, 4, 5);
  root.add(sourceMesh);
  const sourcePositions = Array.from(sourceGeometry.getAttribute('position').array);
  const sourceNormals = Array.from(sourceGeometry.getAttribute('normal').array);
  const texture = new realThree.Texture();
  let textureDisposed = 0;
  texture.addEventListener('dispose', () => textureDisposed++);
  const cover = realApi.create(root, { thickness: 0.125, opacity: 0.4, map: texture, color: 0x55aaff });

  assert.equal(cover.snapshot().sourceMeshCount, 1);
  assert.equal(cover.meshes[0].material.side, realThree.FrontSide);
  assert.equal(cover.meshes[0].material.map, texture);
  assert.notStrictEqual(cover.meshes[0].material, sourceMaterial);
  assert.notStrictEqual(cover.meshes[0].geometry, sourceGeometry);
  assert.strictEqual(cover.groups[0].parent, sourceMesh);
  assert.equal(cover.meshes[0].layers.mask, 1);
  assert.equal(cover.meshes[0].raycast(), undefined);

  const expanded = cover.meshes[0].geometry.getAttribute('position');
  const normals = sourceGeometry.getAttribute('normal');
  for (let index = 0; index < normals.count; index++) {
    const dx = expanded.getX(index) - sourcePositions[index * 3];
    const dy = expanded.getY(index) - sourcePositions[index * 3 + 1];
    const dz = expanded.getZ(index) - sourcePositions[index * 3 + 2];
    const dot = dx * normals.getX(index) + dy * normals.getY(index) + dz * normals.getZ(index);
    assert.ok(Math.abs(dot - 0.125) < 1e-5, 'real BufferGeometry vertices offset along their actual outward normals');
  }

  root.updateMatrixWorld(true);
  const sourceWorld = sourceMesh.getWorldPosition(new realThree.Vector3());
  const coverWorld = cover.meshes[0].getWorldPosition(new realThree.Vector3());
  assert.ok(sourceWorld.distanceTo(coverWorld) < 1e-6, 'real Object3D parent transforms carry the cover with its source');

  cover.setThickness(0.25).setOpacity(1);
  assert.equal(cover.meshes[0].material.opacity, 1);
  assert.equal(cover.meshes[0].material.transparent, false);
  assert.equal(cover.meshes[0].material.depthWrite, true);

  const childMesh = new realThree.Mesh(
    new realThree.SphereGeometry(0.5, 8, 6),
    new realThree.MeshStandardMaterial({ color: 0x999999 }),
  );
  root.add(childMesh);
  cover.refresh();
  assert.equal(cover.snapshot().sourceMeshCount, 2, 'real Three hierarchy refresh adopts newly added meshes');
  assert.strictEqual(cover.groups[1].parent, childMesh);
  assert.equal(cover.dispose(), true);
  assert.equal(cover.dispose(), false);
  assert.equal(sourceMesh.children.length, 0);
  assert.equal(childMesh.children.length, 0);
  assert.equal(textureDisposed, 0, 'disposing a cover does not dispose a caller-owned texture');

  sourceGeometry.dispose();
  sourceMaterial.dispose();
  childMesh.geometry.dispose();
  childMesh.material.dispose();
  texture.dispose();
  console.log('Substance Cover Shell real Three.js r128 checks passed.');
}

console.log('Substance Cover Shell tests passed.')

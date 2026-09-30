'use strict';

// Executes FurnitureVesselRuntime.adoptAuthoredVisual against a tiny scene
// graph. A cold-loaded daylight window is built from its procedural fallback,
// and HouseWindowLinkage then re-parents that fallback's single visual root
// under a sheared wall-aperture group. When the authored JSON resolves, the
// swap must replace the fallback where it now lives instead of leaving it
// behind and dropping an unmounted authored copy on the furniture root.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'docs/js/furniture-vessel-runtime.js'), 'utf8');

class Vec {
  constructor(x = 0, y = 0, z = 0, w = 1) { Object.assign(this, { x, y, z, w }); }
  set(x, y, z, w = this.w) { Object.assign(this, { x, y, z, w }); return this; }
  copy(v) { return this.set(v.x, v.y, v.z, v.w); }
  clone() { return new Vec(this.x, this.y, this.z, this.w); }
}

class Object3D {
  constructor(name = '') {
    this.name = name;
    this.children = [];
    this.parent = null;
    this.userData = {};
    this.position = new Vec();
    this.quaternion = new Vec(0, 0, 0, 1);
    this.scale = new Vec(1, 1, 1);
  }
  add(child) {
    if (child.parent) child.parent.remove(child);
    child.parent = this;
    this.children.push(child);
    return this;
  }
  remove(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) { this.children.splice(index, 1); child.parent = null; }
    return this;
  }
  traverse(fn) { fn(this); this.children.forEach(child => child.traverse(fn)); }
  updateMatrixWorld() {}
}

function loadRuntime(authoredBuild) {
  const window = {
    THREE: { Group: Object3D },
    ProceduralFurniture: { buildPartMesh: () => new Object3D('part'), buildFurnitureGroup: () => new Object3D('fallback') },
    AuthoredFurniture: { buildGroup: authoredBuild, load: () => Promise.resolve(null), peek: () => null },
  };
  vm.runInNewContext(source, { window, console });
  assert(window.FurnitureVesselRuntime?.installed, 'vessel runtime must install against the stub furniture API');
  return window.FurnitureVesselRuntime;
}

function windowGroup(name) {
  const group = new Object3D(name);
  const visualRoot = new Object3D('DaylightWindowVisualRoot');
  ['pane', 'frame_l', 'frame_r', 'frame_t', 'frame_b'].forEach(part => visualRoot.add(new Object3D(part)));
  group.add(visualRoot);
  group.userData.daylightWindowVisualRoot = visualRoot;
  return group;
}

const countVisualRoots = root => { let n = 0; root.traverse(node => { if (node.name === 'DaylightWindowVisualRoot') n++; }); return n; };

// Mounted window: fallback visual root lives under the aperture, offset by -anchor.
{
  const runtime = loadRuntime(() => windowGroup('authored_furniture_simpleWindow'));
  const root = windowGroup('procedural_furniture_simpleWindow');
  const fallbackChildren = [...root.children];
  const fallbackVisual = fallbackChildren[0];
  const aperture = new Object3D('HouseWindowApertureRoot');
  root.add(aperture);
  aperture.add(fallbackVisual);
  fallbackVisual.position.set(0, -1.12, 0.0125);
  root.userData.houseWindowApertureRoot = aperture;

  assert.strictEqual(runtime.adoptAuthoredVisual(root, fallbackChildren, { key: 'simpleWindow' }, 0), true);
  assert.strictEqual(countVisualRoots(root), 1, 'the placeholder visual root must not survive next to the authored one');
  assert.strictEqual(fallbackVisual.parent, null, 'the re-parented placeholder must be detached');
  const authoredVisual = root.userData.daylightWindowVisualRoot;
  assert.notStrictEqual(authoredVisual, fallbackVisual, 'userData must point at the authored visual root');
  assert.strictEqual(authoredVisual.parent, aperture, 'the authored visual root must take over the wall-aperture mount');
  assert.deepStrictEqual([authoredVisual.position.x, authoredVisual.position.y, authoredVisual.position.z], [0, -1.12, 0.0125],
    'the authored visual root must inherit the anchor offset the aperture expects');
  assert.strictEqual(root.userData.houseWindowApertureRoot, aperture, 'caller-owned mount metadata must survive the upgrade');
}

// Ordinary furniture: fallback children still sit directly on the root.
{
  const runtime = loadRuntime(() => { const g = new Object3D('authored'); g.add(new Object3D('a')); g.add(new Object3D('b')); return g; });
  const root = new Object3D('procedural');
  const oldPart = new Object3D('old');
  root.add(oldPart);
  const light = new Object3D('light');
  const fallbackChildren = [...root.children];
  root.add(light);
  assert.strictEqual(runtime.adoptAuthoredVisual(root, fallbackChildren, { key: 'table' }, 0), true);
  assert.deepStrictEqual(root.children.map(child => child.name), ['light', 'a', 'b'],
    'direct fallback children are replaced on the root and caller-added helpers survive');
}

console.log('authored upgrade of re-parented fallback: PASS');

// Run with: node scripts/test-ruin-ceiling-sconces.js
// Lightweight geometry/connection regression; does not require WebGL or devtools.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..'); // Shared repo root for all source and generator assertions.
const source = file => fs.readFileSync(path.join(ROOT, file), 'utf8'); // Reads actual shipped code, not a second copied factory.

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
class Group {
  constructor() { this.name = ''; this.children = []; this.position = new Vector3(); this.userData = {}; }
  add(node) { this.children.push(node); node.parent = this; }
}
class Color {
  constructor(hex) { this.hex = hex; }
  setHex(hex) { this.hex = hex; }
}
class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry; this.material = material;
    this.position = new Vector3(); this.rotation = { y:0 };
    this.userData = {}; this.name = '';
  }
}
class Material {
  constructor(options) { Object.assign(this, options); this.color = new Color(options.color); }
}
class PlaneGeometry {
  constructor(width, height) { this.parameters = {width, height}; this.type = 'plane'; }
}
class TextureLoader {
  load(path) { return {path}; }
}
const THREE = { Vector3, Group, Mesh, MeshBasicMaterial:Material, PlaneGeometry, TextureLoader, DoubleSide:2, SRGBColorSpace:'srgb' }; // Minimal Three primitives sufficient to prove mount bounds.
const sandbox = { window:{THREE}, THREE };
const files = [
  'docs/js/dev-random-ruin-ceiling-target-visuals.js',
  'docs/js/dev-random-ruin-simple-puzzles.js',
  'docs/js/dev-random-ruin-rail-targets.js',
  'docs/js/dev-random-ruin-interior-map.js',
  'docs/js/dev-random-ruin-bootstrap.js',
];
for (const file of files) new vm.Script(source(file), {filename:file}); // Parse both composers and generator without invoking browser-only runtime.
vm.runInNewContext(source(files[0]), sandbox, { filename:files[0] });
const Visuals = sandbox.window.DevRandomRuinCeilingTargetVisuals;
assert.ok(Visuals?.create, 'Shared ceiling target factory is exported');
const kit = {
  sharedBoxGeometry(width, height, depth) { return {parameters:{width,height,depth},type:'box'}; },
  makeBasic(color) { return new Material({color}); },
  naturalizeStone(mesh) { return mesh; },
}; // Stand-in for the same geometry/material kit used by the simple and rail composers.

const root = new Group();
const first = Visuals.create(kit, {parent:root,name:'test-ceiling',x:3,y:5,z:7});
const second = Visuals.create(kit, {parent:root,name:'second-ceiling',x:6,y:5,z:8});
assert.equal(root.children.length, 2);
assert.equal(first.object.position.y, 5);
assert.ok(Math.abs(first.attachmentGap(5) + .05) < 1e-9, 'Ceiling plate embeds into the roof instead of hovering');
assert.equal(first.object.children.length, 9, 'Five joined solids plus four decaled aiming faces');
assert.ok(first.object.userData.devRuinFootprintIgnore, 'Ceiling target never blocks walking paths');
const stones = first.object.children.filter(item => item.geometry?.type === 'box');
assert.equal(stones.length, 5);
const bounds = stone => ({
  top:stone.position.y + stone.geometry.parameters.height / 2,
  bottom:stone.position.y - stone.geometry.parameters.height / 2,
});
for (let i = 1; i < stones.length; i++) {
  assert.ok(bounds(stones[i]).top >= bounds(stones[i - 1]).bottom - 1e-9,
    stones[i].name + ' is physically disconnected from the piece above');
}
const decals = first.object.children.filter(item => item.geometry?.type === 'plane');
assert.equal(decals.length, 4);
assert.ok(decals.every(item => item.geometry === decals[0].geometry), 'Decals share one reusable plane geometry');
assert.ok(decals.every(item => item.material === first.material), 'All decal faces have a consistent activation state');
assert.equal(first.material.map.path, 'assets/textures/decals/ruin_glyph_rune.png');
assert.equal(first.material.color.hex, 0xff8a2a);
first.setActive(true);
assert.equal(first.material.color.hex, 0x4dff6e);
assert.equal(second.material.color.hex, 0xff8a2a, 'Hitting one target never changes the others');
first.object.position.y = 4.95; // Rail carriage is placed .05 under a rail at world Y=5.
assert.ok(Math.abs(first.attachmentGap(5)) < 1e-9, 'Moving target plate touches its rail exactly');

const simple = source(files[1]), rail = source(files[2]), ceiling = source(files[3]), bootstrap = source(files[4]);
assert.ok(simple.includes('consider(glyph.hitMesh||glyph.mesh'), 'Fixed glyph hits use the stone block, not the overhead plate');
assert.ok(simple.includes('consider(target.hitMesh||target.object'), 'Moving glyph hits use the stone block');
assert.ok(!simple.includes("glyph.rune=window.DevRandomRuinGlyphCircuits?.attachRune"), 'No detached ceiling rune sprites');
assert.ok(rail.includes('RAIL_DROP + .06'), 'Rail hangers must penetrate both ceiling and rail');
assert.ok(rail.includes('target.visual.setActive(true)'), 'Moving targets change decal state when struck');
assert.ok(ceiling.includes('for(const room of meta?.rooms||[])'), 'Roof covers pit openings beneath ceiling-mounted targets');
assert.ok(bootstrap.indexOf('dev-random-ruin-ceiling-target-visuals.js') < bootstrap.indexOf('dev-random-ruin-simple-puzzles.js'), 'Target factory loads before consumers');
console.log('Ceiling-sconce target geometry, connections, hit selection and integration: OK');

#!/usr/bin/env node
'use strict';
// Run: node scripts/test-portrait-spline-rig.js
// Pure geometry/authoring contract regression coverage, including rear-side visibility and hot-swaps.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..'); // All source checks stay relative to the repository, not the test process's CWD.
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const env = { window: {}, console };
vm.runInNewContext(read('docs/js/portrait-spline-rig.js'), env);
const Rig = env.window.PortraitSplineRig;
assert(Rig, 'portrait spline runtime exports a reusable rig');

function makeRig() {
  // One physical joint: anchored root, free tip and three directional swing magnitudes.
  return {
    version:2,enabled:true,
    points:[{u:.5,v:.3,depth:.02},{u:.54,v:.7,depth:.035}],
    bone:{yaw:8,pitch:12,roll:18},
    regionMasks:{front:{size:200,runs:[[123,10]]}},
    hoodStretchPx:12,rearOffset:{u:.015,v:-.02},
  };
}
const normalized=Rig.normalize(makeRig());
assert(normalized&&normalized.points.length===2,'one joint has exactly two handles');
assert.equal(normalized.version,2,'old pose tables are removed from normalized data');
assert(!('segments' in normalized)&&!('tipFollow' in normalized),'there is no six-direction blend space');
assert.equal(normalized.regionMasks.front.runs[0][1],10,'head masks survive normalization');
assert.equal(normalized.hoodStretchPx,12,'the elastic hood expansion radius is persisted');
const old=Rig.normalize({...makeRig(),version:1,points:[{u:.5,v:.3,depth:.02},{u:.51,v:.48,depth:.03},{u:.54,v:.7,depth:.04}],
  segments:[{poses:{right:{roll:75}}},{poses:{left:{roll:-90}}}]});
assert.equal(old.points.length,2,'legacy three-knot rigs migrate to a single root and tip');
assert(!('segments' in old),'legacy directional poses are discarded, not blended');
assert.equal(Rig.normalize({points:[]}),null,'malformed rigs stay unrigged');
assert.equal(Rig.resolveOptionRig(null,null),null,'unconverted flat hair remains flat');
assert(Rig.resolveOptionRig({splineRig:makeRig()},{speciesId:'mao-ao',gender:'male'}),
  'opted-in cosmetics use a single bone');
const rest=Rig.posePoints(normalized),right=Rig.posePoints(normalized,{x:1}),left=Rig.posePoints(normalized,{x:-1});
assert.equal(rest.points.length,2,'one bone has root and tip');
assert.deepEqual(JSON.parse(JSON.stringify(right.points[0])),JSON.parse(JSON.stringify(rest.points[0])),
  'the root remains immobile in a gust');
assert(right.points[1].x>rest.points[1].x&&left.points[1].x<rest.points[1].x,
  'the one bone swings in both horizontal directions');
assert(rest.points.every(p=>p.z>=.003)&&right.points.every(p=>p.z>=.003),
  'no wind drives the joint behind the portrait');
const signedRig=Rig.normalize({...makeRig(),points:[{u:.5,v:.3,depth:.02},{u:.54,v:.7,depth:-.05}]});
assert.equal(signedRig.points[1].depth,-.05,'explicit negative tip depth remains behind the owner portrait');
const signedRest=Rig.posePoints(signedRig);
assert(signedRest.points[1].z<0,'an intentionally rearward tip is not incorrectly clamped forward');
assert(Rig.deformPosition(signedRig,signedRest.points,.54,.7,1,1).z<0,
  'rigged hair can physically pass behind the owner and lose the normal depth test');
const neutralDepth=rest.points[1].z;
assert(Rig.posePoints(normalized,{z:1}).points[1].z>neutralDepth,
  'a toward-view gust moves hanging hair forward');
assert(Rig.posePoints(normalized,{z:-1}).points[1].z<neutralDepth,
  'an away-view gust moves hanging hair backward');
const midpoint=Rig.curvePoint(rest.points,0,.5);
assert(Math.abs(midpoint.x-(rest.points[0].x+rest.points[1].x)/2)<1e-9,
  'single-bone interpolation is linear without hidden middle knots');
const extreme=Rig.normalize({...makeRig(),bone:{yaw:65,pitch:65,roll:65},
  points:[{u:.5,v:.3,depth:.003},{u:.5,v:.7,depth:.003}]});
assert(Rig.posePoints(extreme,{z:-1}).points[1].z>=.003,
  'maximum swing collides safely with the portrait plane');
const warped=Rig.deformPosition(normalized,right.points,.52,.58,1,1);
assert(warped.z>=.003&&Number.isFinite(warped.x),
  'the live sprite deformation uses the same single bone as the editor');

class FakeGeometry {
  constructor(width = 1, height = 1, nx = 4, ny = 4) {
    const data = new Float32Array((nx + 1) * (ny + 1) * 3); // Vertex rest coordinates for front/rear comparison.
    let j = 0;
    for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
      data[j++] = (x / nx - .5) * width; data[j++] = (.5 - y / ny) * height; data[j++] = 0;
    }
    this.attributes = { position: {
      array: data, count: data.length / 3, needsUpdate: false,
      setXYZ(i, x, y, z) { data.set([x, y, z], i * 3); },
    } };
  }
  clone() {
    const result = new FakeGeometry();
    const values = new Float32Array(this.attributes.position.array);
    result.attributes.position = {
      array: values, count: values.length / 3, needsUpdate: false,
      setXYZ(i, x, y, z) { values.set([x, y, z], i * 3); },
    };
    return result;
  }
  computeBoundingSphere() {}
  dispose() { this.disposed = true; }
}
class FakeGroup {
  constructor() { this.userData = {}; this.children = []; this.position = { set(x,y,z) { this.x=x;this.y=y;this.z=z; } }; }
  add(child) { child.parent?.remove?.(child); child.parent=this; this.children.push(child); }
  remove(child) { this.children=this.children.filter(c=>c!==child); child.parent=null; }
  traverse(fn) { fn(this); for (const child of this.children) child.traverse(fn); }
}
class FakeMesh extends FakeGroup {
  constructor(geometry, material) { super(); this.geometry=geometry; this.material=material; }
}
class FakeMaterial {
  constructor(options) { Object.assign(this, options); }
  dispose() { this.disposed = true; }
}
class FakeTexture {
  constructor(image) { this.image=image; }
  dispose() { this.disposed=true; }
}
const THREE = {
  PlaneGeometry: FakeGeometry, Group: FakeGroup, Mesh: FakeMesh,
  MeshBasicMaterial: FakeMaterial, CanvasTexture: FakeTexture, FrontSide: 1, BackSide: 2,
};
env.window.DeadzoneBillboard = null;
env.document = { createElement() { return { width: 200, height: 200, getContext() {
  return { drawImage() {}, clearRect() {}, save() {}, restore() {}, translate() {}, scale() {},
    getImageData() { return { data: new Uint8ClampedArray(200 * 200 * 4) }; }, // Mock RGBA upload contract used by real WebGL cosmetic textures.
    putImageData() {}, };
} }; } };
const avatar = new FakeGroup(); avatar.name = 'unit_test_avatar';
const portraitOwner = new FakeMesh(new FakeGeometry(),new FakeMaterial({alphaTest:.45,depthTest:true,depthWrite:false})); // Simulates an owner whose depth writes were disabled by the actor compositor.
portraitOwner.name='npc_avatar_front_plane';portraitOwner.renderOrder=2;avatar.add(portraitOwner);
const rigPart = (key, slot, points) => ({ key, slot, rig: Rig.normalize({ ...makeRig(), ...(points ? { points } : {}) }), canvas: {
  width: 200, height: 200, getContext() { return { drawImage() {}, clearRect() {} }; },
} });
const front = { hobunjiSplineParts: [rigPart('hairSide:test:0', 'hairSide')] };
const back = { hobunjiSplineParts: [rigPart('hairSide:test:0', 'hairSide')] };
Rig.attach(THREE, avatar, avatar, front, back, 1, 1);
assert.equal(avatar.userData.portraitSplineParts.length, 1);
const part = avatar.userData.portraitSplineParts[0];
assert(part.rearMesh, 'side hair uses a separately textured rear surface');
const fz = part.frontMesh.geometry.attributes.position.array[2], rz = part.rearMesh.geometry.attributes.position.array[2];
assert(fz > 0 && rz < 0, 'rear hair protrudes behind the rear plane, not through the skull');
assert(Math.abs(fz + rz) < 1e-7, 'front/rear strand depths match');
assert.equal(part.frontMesh.material.side, THREE.FrontSide);
assert.equal(part.rearMesh.material.side, THREE.BackSide);
for(const mesh of [part.frontMesh,part.rearMesh]){
  assert.equal(mesh.material.depthTest,true,'beard and braid always obey physical depth');
  assert.equal(mesh.material.depthWrite,true,'visible strands write depth, even if their owner does not');
  assert.equal(mesh.material.alphaTest,.45,'solid depth uses the same silhouette cutoff as the owner');
  assert.equal(mesh.renderOrder,portraitOwner.renderOrder-.01,'strand draws immediately before its owner');
  assert.equal(mesh.userData.portraitSplineOwnerDepth?.paired,true,'mesh identifies its depth-paired portrait');
}
portraitOwner.renderOrder=17.25; // Dynamic actor sorting must never separate an owner from their beard.
assert.equal(part.frontMesh.renderOrder,17.24,'beard follows live actor ordering before render-list sort');
assert.equal(part.rearMesh.renderOrder,17.24,'back hair follows the same owner');
portraitOwner.renderOrder=2;
const previous = part.frontMesh.geometry;
Rig.refresh(avatar, { hobunjiSplineParts: [rigPart('hairSide:test:0', 'hairSide',
  [{u:.49,v:.3,depth:.02},{u:.52,v:.5,depth:.03},{u:.54,v:.7,depth:.06}])] }, back);
assert(previous.disposed, 'authored hairstyle changes discard the old geometry');
assert.notEqual(avatar.userData.portraitSplineParts[0].frontMesh.geometry, previous);
Rig.refresh(avatar, { hobunjiSplineParts: [] }, { hobunjiSplineParts: [] });
assert.equal(avatar.userData.portraitSplineParts.length, 0, 'removing a cosmetic removes its rig');
Rig.refresh(avatar, front, back);
assert.equal(avatar.userData.portraitSplineParts.length, 1, 'new rig can be equipped after an unrigged style');
Rig.detach(avatar);
assert.equal(avatar.userData.portraitSplineParts.length, 0);

const portrait = read('docs/js/portrait-utils.js');
const html = read('docs/index.html');
const studio = read('docs/tools/character-studio/index.html');
const editor = read('docs/tools/portrait-spline-author/index.html');
assert(portrait.includes("hoodHidesFacialHair(hood)") && portrait.includes("splineRigFor(entry.group)"), 'facewrap hiding and spline opt-in share portrait layer resolution');
assert(portrait.includes("renderBehindView && slot === 'facialHair'"), 'a rigged beard does not paint a second rear portrait');
assert(portrait.includes("canvas.hobunjiSplineParts.push({ key, slot, rig, canvas: partCanvas")
  && !portrait.includes("splitByMask?.("),
  'game renders the entire rigid/flexible cosmetic on ONE continuous mesh with no separate alpha-cut boundary');
assert(!portrait.includes("warpHoodCanvas?.(") && !portrait.includes("paintSeamBridge?.("),
  'new masks do not carve hood pixels or paint artificial seam bridges');
assert(html.includes('portrait-spline-rig.js'), 'game loads the spline runtime');
assert(studio.includes('portrait-spline-rig.js'), 'Character Studio loads the same runtime');
assert(editor.includes('id="paintMode"')&&editor.includes('id="eraseMode"')&&editor.includes('id="boneRoll"')&&editor.includes('id="hoodStretchPx"'),
  'mobile editor exposes one bone and a dedicated elastic hood opening control');
console.log('Portrait hair bone: root/tip migration, single-joint wind, head collision and cosmetic hot-swaps pass.');

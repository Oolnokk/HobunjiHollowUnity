#!/usr/bin/env node
'use strict';
// Node regression coverage for authoring 3D poses and silhouette-based, manually editable seam dabs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // Use the repository checkout, not the current invocation directory.
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const globals = { window: {}, console, Uint8Array, Int16Array, Int32Array, Math, Number };
vm.runInNewContext(read('docs/js/portrait-spline-rig.js'), globals);
vm.runInNewContext(read('docs/js/portrait-spline-seam.js'), globals);
const Rig = globals.window.PortraitSplineRig;
const Seam = globals.window.PortraitSplineSeam;
assert(Rig && Seam, '3D runtime and seam tracer share the head portrait coordinate system');
const raw = {
  points: [{u:.5,v:.3,depth:.02},{u:.52,v:.6,depth:.035}],
  segments:[{deadzone:{x:4,y:4,z:6},poses:{
    right:{yaw:0,pitch:0,roll:0,translate:{x:.18,y:.06,z:.1}},
    away:{yaw:0,pitch:0,roll:0,translate:{x:0,y:0,z:-.35}},
  }}],
};
const rig = Rig.normalize(raw), rest = Rig.posePoints(rig), moved = Rig.posePoints(rig,{x:1});
assert.equal(rig.segments[0].poses.right.translate.x,.18, '3D X translation must survive cosmetic normalization');
assert.equal(rig.segments[0].poses.right.translate.y,.06, '3D Y translation must survive cosmetic normalization');
assert.equal(rig.segments[0].poses.right.translate.z,.1, '3D depth must survive cosmetic normalization');
assert(Math.abs(moved.points[1].x-rest.points[1].x-.18)<1e-9, 'authored X gizmo offset moves the selected segment endpoint');
assert(Math.abs(moved.points[1].y-rest.points[1].y-.06)<1e-9, 'authored Y gizmo offset is applied in head-local space');
assert(Math.abs(moved.points[1].z-rest.points[1].z-.1)<1e-9, 'Z gizmo offset has physical 3D depth');
assert.equal(Rig.blendSegment(rig.segments[0],{}).translate,undefined,'neutral wind leaves all knot translations unapplied');
const inward=Rig.posePoints(rig,{z:-1});
assert(inward.points[1].z>=.003,'negative local depth translation must collide with the portrait plane');
assert(inward.collisions>=1,'the portrait penetration guard reports the inward pose');
const clamped=Rig.normalize({...raw,segments:[{poses:{right:{translate:{x:9,y:-7,z:Infinity}}}}]});
assert.equal(clamped.segments[0].poses.right.translate.x,.35,'edited translations are range-validated');
assert.equal(clamped.segments[0].poses.right.translate.y,-.35,'negative translations are range-validated');
assert.equal(clamped.segments[0].poses.right.translate.z,0,'invalid depth is not written to the character');
const old=Rig.normalize({...raw,segments:[{poses:{right:{roll:30}}}]});
assert.equal(old.segments[0].poses.right.translate.z,0,'preexisting rotation-only JSON remains supported');
const center=Rig.deformPosition(rig,moved.points,.52,.59,1,1);
assert(center.z>=.003 && Number.isFinite(center.x),'the preview can reuse the same deformPosition as the game');

function alphaFixture() {
  const width=200,height=200;
  const data=new Uint8ClampedArray(width*height*4); // Only alpha is relevant; colored head pixels and transparent holes remain distinguishable.
  const solid=(x,y)=>{data[(y*width+x)*4+3]=255;};
  for(let y=55;y<145;y++)for(let x=60;x<140;x++)solid(x,y);
  for(let y=95;y<104;y++)for(let x=94;x<106;x++)data[(y*width+x)*4+3]=0; // A transparent eye hole should NOT become the external head contour.
  for(let y=5;y<9;y++)for(let x=5;x<9;x++)solid(x,y); // Distant disconnected island should never join the head's attachment mask.
  return {width,height,getContext(){return {getImageData(){return {data};}};}};
}
const canvas=alphaFixture();
const result=Seam.generate(canvas,{u:.5,v:.26},{arcPx:24,spacingPx:2.5,radiusPx:4});
assert(result.seam.length>=5 && result.seam.length<=128,'auto trace yields a bounded set of editable mask dabs');
assert(result.seam.every(x=>x.radiusPx===4),'generated seam dabs respect the authored brush radius');
assert(result.seam.every(x=>x.v>.20&&x.v<.40),'seam follows the head exterior near the root, not internal eye holes');
assert(result.seam.every(x=>x.u>.2&&x.u<.8),'seam cannot jump to disconnected alpha islands');
const empty={width:200,height:200,getContext(){return {getImageData(){return {data:new Uint8ClampedArray(200*200*4)};}};}};
assert.equal(Seam.generate(empty,{u:.5,v:.5}).seam.length,0,'a missing head silhouette never invents a seam');
assert.equal(Seam.generate(canvas,{u:0,v:1},{reachPx:4}).seam.length,0,'distant knots do not trace unrelated head boundaries');
assert.throws(()=>Seam.generate(null,{u:.5,v:.5}),/loaded species head/,'unavailable head art is diagnosed');

const editor=read('docs/tools/portrait-spline-author/index.html');
const viewer=read('docs/js/portrait-spline-viewer.js');
const catalog=read('docs/js/portrait-spline-catalog.js');
new vm.Script(editor.match(/<script>([\s\S]+?)<\/script>/)[1],{filename:'portrait-spline-author inline script'});
new vm.Script(viewer,{filename:'portrait-spline-viewer.js'});
for(const id of ['view3d','gizmoTranslate','gizmoRotate','autoSeam','seamArc','seamMoveMode','seamPointRadius','undoSeam'])
  assert(editor.includes('id="'+id+'"'),'editor must expose '+id+' for touch and mouse authoring');
assert(editor.includes("window.PortraitSplineSeam.generate(images.head"),'auto tracing uses the selected species head, not a synthetic contour');
assert(editor.includes("pose.translate[axis]=value"),'the 3D translation gizmo changes the serialized runtime pose');
assert(editor.includes("pose[rotationKey]=value"),'the rotation ring changes the actual runtime pose');
assert(editor.includes("target.u=p.u;target.v=p.v"),'generated mask dabs remain drag-editable in 2D');
assert(editor.includes("void loadHead()") && catalog.includes("speciesIndexUrl"),'head silhouettes are loaded through the species index');
assert(viewer.includes("new THREE.WebGLRenderer")&&viewer.includes("new THREE.Raycaster"),'the pose view is a true interactive 3D scene');
assert(viewer.includes("window.PortraitSplineRig.deformPosition"),'the 3D mesh is generated by the same deformation as the game');
assert(viewer.includes("cfg.threeModuleUrl") && viewer.includes("cfg.orbitControlsModuleUrl"),'viewer reuses the pinned game Three.js modules');
assert(editor.includes("init3D()") && editor.includes("initCatalog()"),'3D viewer and index-backed 2D rigger both auto-initialize');
const ref=JSON.parse(read('docs/config/species/index.json'));
assert(ref.entries.some(entry=>entry.speciesId==='mao-ao'),'species head assets are discoverable through the index');
const mao=JSON.parse(read('docs/config/species/mao-ao.json'));
assert(mao.male.headSprite && mao.female.headSprite,'head silhouette input is gender-specific');
// Verify the real species-index lookup, the explicit assets/ headSprite convention,
// and compositing into the editor's fixed 200px portrait canvas.
async function checkIndexedHead() {
  const source = read('docs/js/portrait-spline-catalog.js');
  const drawn = []; // Records head-art image placement without a headless WebGL or browser dependency.
  const scope = { window: {}, document: {
    baseURI: 'https://example.invalid/docs/tools/portrait-spline-author/',
    createElement() { return { width: 0, height: 0, getContext() { return { drawImage(...args) { drawn.push(args); } }; } }; },
  }, URL };
  vm.runInNewContext(source, scope);
  const canonical = scope.window.PortraitSplineCatalog;
  const speciesIndex = JSON.parse(read('docs/config/species/index.json'));
  const fetchSpecies = async url => {
    if (url.endsWith('/species/index.json')) return speciesIndex;
    const item = speciesIndex.entries.find(item => url.endsWith('/species/' + item.path.replace(/^\.\//, '')));
    assert(item, 'head art must be fetched from an indexed species JSON: ' + url);
    return JSON.parse(read('docs/config/species/' + item.path.replace(/^\.\//, '')));
  };
  const catalogInstance = canonical.createCatalog({entries: []}, fetchSpecies,
    'https://example.invalid/docs/config/cosmetics/index.json');
  for (const speciesId of ['mao-ao', 'tletingan', 'kenkari']) {
    for (const gender of ['male', 'female']) {
      const config = JSON.parse(read('docs/config/species/' + speciesId + '.json'));
      const expected = 'https://example.invalid/docs/assets/' + config[gender].headSprite.replace(/^\.?\/*assets\//, '');
      const result = await catalogInstance.headArtwork(speciesId, gender, 'front', async url => {
        assert.equal(url, expected, 'headSprite URLs must resolve through docs/assets/');
        return { width: 80, height: 80, naturalWidth: 80, naturalHeight: 80 };
      });
      assert.equal(result.width, 200);
      assert.equal(result.height, 200);
    }
  }
  assert.equal(drawn.length, 6, 'every selected head must be positioned for the silhouette and 3D preview');
}
checkIndexedHead().then(() => console.log('Spline 3D editor + auto head-silhouette seam: geometry, indexed sprite paths, collision, author wiring, and contour masks pass.'))
  .catch(error => { console.error(error); process.exitCode = 1; });

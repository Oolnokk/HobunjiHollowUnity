#!/usr/bin/env node
'use strict';
// Node regression coverage for 3D poses and alpha-overlap-generated rigid/flexible pixel-region masks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // Use the repository checkout, not the current invocation directory.
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const globals = { window: {}, console, Uint8Array, Int16Array, Int32Array, Math, Number };
vm.runInNewContext(read('docs/js/portrait-spline-rig.js'), globals);
const Rig = globals.window.PortraitSplineRig;
assert(Rig, 'the runtime provides both 3D deformation and pixel-accurate rigid/flexible region masks');
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

const pixels=new Uint8Array(40000); // The exact 200px portrait mask, not an approximate silhouette circle.
pixels[60*200+100]=1;
const encoded=Rig.encodePixelMask(pixels);
assert.equal(encoded.runs.length,1,'contiguous anchored pixels serialize as compact spans');
assert.equal(Rig.decodePixelMask(encoded)[60*200+100],1,'mask round-trips without changing rigid ownership');
const expanded=Rig.paintPixelMask(encoded,.5,.3,4,true);
assert(Rig.decodePixelMask(expanded).reduce((sum,x)=>sum+x,0)>1,
  'the rigid brush adds whole authored pixels near its center');
const erased=Rig.paintPixelMask(expanded,.5,.3,4,false);
assert.equal(Rig.decodePixelMask(erased)[60*200+100],0,'eraser returns anchor pixels to flexible state');
const malformed=Rig.normalizePixelMask({size:200,runs:[[90,12],[93,5],[-1,3],[40000,5]]});
assert.equal(JSON.stringify(malformed.runs),'[[90,12]]','malformed/overlapping RLE spans clamp and merge safely');
const views=Rig.normalize({...raw,regionMasks:{front:encoded,rear:expanded}});
assert.equal(views.regionMasks.front.runs.length,1,'front mask survives serialization');
assert.equal(views.regionMasks.rear.runs.length,expanded.runs.length,'rear mask is independently authorable');

const editor=read('docs/tools/portrait-spline-author/index.html');
const viewer=read('docs/js/portrait-spline-viewer.js');
const catalog=read('docs/js/portrait-spline-catalog.js');
new vm.Script(editor.match(/<script>([\s\S]+?)<\/script>/)[1],{filename:'portrait-spline-author inline script'});
new vm.Script(viewer,{filename:'portrait-spline-viewer.js'});
for(const id of ['view3d','gizmoTranslate','gizmoRotate','autoMask','undoMask','clearMask','showRegions','paintMode','eraseMode','brush'])
  assert(editor.includes('id="'+id+'"'),'editor must expose '+id+' for touch and mouse authoring');
assert(editor.includes("Rig.maskFromOverlap(sprite,head"),'auto mask uses actual cosmetic/head alpha overlap rather than seam-length heuristics');
assert(editor.includes("pose.translate[axis]=value"),'the 3D translation gizmo changes the serialized runtime pose');
assert(editor.includes("pose[rotationKey]=value"),'the rotation ring changes the actual runtime pose');
assert(editor.includes("Rig.paintPixelMask(current,p.u,p.v"),'the 2D brush and eraser modify the serialized pixel-region mask');
for(const id of ['generateBlend','blendRadius','tipFollow'])
  assert(editor.includes('id="'+id+'"'),'3D editor must expose natural default poses, attachment smoothing, and bottom-knots-first control: '+id);
assert(editor.includes("Rig.makeDefaultSegments(rig.points)"),
  'natural wind pose button recalculates all six directions from the authored 2D knot positions');
assert(editor.includes("Rig.suggestRestPoints(images.front,images.head)"),
  'new, unrigged cosmetics get art-fitted default knots instead of generic placement');
assert(editor.includes("Rig.attachmentBlendField(mask,rig.blendRadiusPx)"),
  'rigid/flexible 2D overlay shows the same automatic motion falloff used by the actual 3D geometry');
assert(viewer.includes("sampleAttachmentBlend(field,rear?1-u:u,v)"),
  '3D preview samples the same smoothed attachment motion field on front and mirrored rear planes');
assert(viewer.includes("rig.tipFollow,rig.blendRadiusPx,rig.regionMasks"),
  '3D preview geometry invalidates when knot parenting or mask-blend settings change');
assert(editor.includes("void loadHead()") && catalog.includes("speciesIndexUrl"),'head silhouettes are loaded through the species index');
assert(viewer.includes("new THREE.WebGLRenderer")&&viewer.includes("new THREE.Raycaster"),'the pose view is a true interactive 3D scene');
assert(viewer.includes("window.PortraitSplineRig.deformPosition"),'the 3D mesh is generated by the same deformation as the game');
assert(viewer.includes("cfg.threeModuleUrl") && viewer.includes("cfg.orbitControlsModuleUrl"),'viewer reuses the pinned game Three.js modules');
assert(viewer.includes("window.HobunjiSpritePngSurface") && viewer.includes("spriteSurface.makeCanvasTexture") && viewer.includes("spriteSurface.makeMaterial"),
  '3D appearance reuses the canonical PNG-plane texture and material API used by Pants Rig Author');
assert(!viewer.includes("new THREE.DataTexture(rgba"), '3D author must not use a competing custom RGBA texture uploader');
assert(viewer.indexOf('const spriteSurface =') >= 0
  && viewer.indexOf('const spriteSurface =') < viewer.indexOf('const headPlane ='),
  'canonical PNG material factory must initialize before the WebGL head and hair sheets are constructed');
assert(editor.includes("NpcAvatarPreview.renderProfileToCanvas") && editor.includes("NpcAvatarPreview.ensurePortraitCosmetics"),
  '3D author uses the same canonical full-character source as the Pants Rig Author');
assert(editor.includes("portraitView:'front',onlyHeadSprite:true"),
  'automatic rigid-region classification uses the canonical head-only portrait (same B scaling as runtime)');
assert(editor.includes('const portraitReference=images.character||images.head'),
  'the 2D canvas should show the canonical full-character portrait instead of drawing a separately scaled head');
assert(!editor.includes("void loadHead(); // A head-only alpha reference"),
  'indexed raw head artwork must no longer race the canonical head-only silhouette during normal loading');
assert(catalog.includes("window.getPortraitXformPreset?.('B') || PRESERVED_B"),
  'fallback head rendering must use the live game portrait B transform, never species headXform');
assert(viewer.includes("textureFailures") && editor.includes("canonicalPortraitError"),
  'rendering errors remain visible on mobile rather than being swallowed as empty textures');
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
      const [sprite, x, y, w, h] = drawn[drawn.length - 1];
      assert(sprite && Math.abs(x - (-6.072)) < .00001 && Math.abs(y - 8.264) < .00001,
        speciesId + ' ' + gender + ': indexed head fallback must match portrait B placement, not the smaller species headXform');
      assert(Math.abs(w - 199.2) < .00001 && Math.abs(h - 199.2) < .00001,
        'render fallback uses exactly the canonical 80px layer size and 2.49x portrait B scaling');
    }
  }
  assert.equal(drawn.length, 6, 'every selected head must be positioned for the silhouette and 3D preview');
}
checkIndexedHead().then(() => console.log('Spline 3D editor + rigid/flexible masks: indexed sprite paths, collision, and brush/eraser wiring pass.'))
  .catch(error => { console.error(error); process.exitCode = 1; });

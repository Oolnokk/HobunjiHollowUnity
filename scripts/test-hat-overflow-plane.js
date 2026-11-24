'use strict';
// Big hats: hat pixels past the 200x200 portrait square go on a separate,
// bounds-free overflow plane (docs/js/hat-overflow-plane.js), and hat PNGs may
// be padded past the standard layer canvas with an image.frame
// (portrait-utils _portraitLayerDrawRect). Neither may change the portrait
// texture or anything measured from it.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const portraitUtils = read('docs/js/portrait-utils.js');
const planeSource = read('docs/js/hat-overflow-plane.js');
const avatarSource = read('docs/js/png-plane-avatar.js');
const indexHtml = read('docs/index.html');

function extract(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert(from >= 0 && to > from, 'Cannot locate ' + start);
  return source.slice(from, to);
}

// ── Layer frame math ───────────────────────────────────────
const rectApi = new Function('PORTRAIT_L', 'PORTRAIT_CW', 'PORTRAIT_CH',
  extract(portraitUtils, 'function _portraitLayerDrawRect(', 'function drawPortraitLayer(') +
  '\nreturn {_portraitLayerDrawRect, _validLayerFrame};')(80, 200, 200);
const xform = {ax: -0.0983, ay: -0.0809, sx: 2.49, sy: 2.49};
const plain = rectApi._portraitLayerDrawRect({naturalWidth: 234, naturalHeight: 173}, xform);
const h = 80 * 2.49, w = 234 / 173 * 80 * 2.49;
assert(Math.abs(plain.w - w) < 1e-9 && Math.abs(plain.h - h) < 1e-9, 'Unframed layers keep the historical size');
assert(Math.abs(plain.x - (100 + xform.ay * 80 - w / 2)) < 1e-9, 'Unframed layers keep the historical position');

// The same art padded by 20px left / 10px top inside a 270x190 PNG.
const frame = {x: 20, y: 10, width: 234, height: 173};
const padded = rectApi._portraitLayerDrawRect({naturalWidth: 270, naturalHeight: 190}, {...xform, frame});
const k = plain.w / 234;
assert(Math.abs(padded.x + 20 * k - plain.x) < 1e-9 && Math.abs(padded.y + 10 * k - plain.y) < 1e-9,
  'The frame lands exactly where the unpadded PNG used to');
assert(Math.abs(padded.w - 270 * k) < 1e-9 && Math.abs(padded.h - 190 * (plain.h / 173)) < 1e-9, 'Padding keeps the frame scale');
const flipped = rectApi._portraitLayerDrawRect({naturalWidth: 270, naturalHeight: 190}, {...xform, sx: -2.49, frame});
assert(Math.abs(flipped.x + (270 - 20 - 234) * k - plain.x) < 1e-9, 'Pre-flipped behind layers mirror the padding');
assert.equal(rectApi._validLayerFrame({x: 50, y: 0, width: 234, height: 173}, 270, 190), null, 'A frame outside its PNG is ignored');
assert.equal(rectApi._validLayerFrame({x: 0, y: 0, width: 0, height: 173}, 270, 190), null, 'A degenerate frame is ignored');

assert(portraitUtils.includes("...(layer.image?.frame ? { frame: { ...layer.image.frame } } : {})"), 'Cosmetic parsing keeps image.frame');
assert(portraitUtils.includes("...(layer?.behindImage?.frame ? { behindFrame: { ...layer.behindImage.frame } } : {})"), 'Cosmetic parsing keeps behindImage.frame');
assert(/_behindFlippedLayer\(\{ \.\.\.layer, url, frame \}\)/.test(portraitUtils), 'Behind-view layers carry the frame of the PNG they actually draw');

// ── Hat-only padded render ─────────────────────────────────
assert(portraitUtils.includes('const hatOverflowPad = Math.max(0, Number(renderOptions?.hatOverflowPad) || 0);'));
assert(portraitUtils.includes('ctx.translate(hatOverflowPad, hatOverflowPad)'), 'Padding translates; the portrait scale is unchanged');
assert(/if \(hatOnly\) \{[\s\S]{0,1600}for \(const key of order\) drawEmoteLayers\(hatDraw\[key\]\);/.test(portraitUtils),
  'Hat-only bakes draw nothing but the hat layers');
assert(portraitUtils.includes('window.getPortraitCanvasLogicalSize'), 'Logical portrait size is exposed for overflow bakes');

// ── Overflow module: only spill-over pixels, null when the hat fits ──
function fakeCanvas() {
  const canvas = {width: 0, height: 0, pixels: null};
  const ensure = () => {
    if (!canvas.pixels || canvas.pixels.length !== canvas.width * canvas.height * 4) canvas.pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
  };
  canvas.getContext = () => ({
    clearRect(x, y, cw, ch) {
      ensure();
      for (let yy = Math.max(0, y); yy < Math.min(canvas.height, y + ch); yy++)
        for (let xx = Math.max(0, x); xx < Math.min(canvas.width, x + cw); xx++) canvas.pixels.fill(0, (yy * canvas.width + xx) * 4, (yy * canvas.width + xx) * 4 + 4);
    },
    getImageData() { ensure(); return {data: canvas.pixels}; },
  });
  canvas.paint = (x, y) => { ensure(); canvas.pixels[(y * canvas.width + x) * 4 + 3] = 255; };
  return canvas;
}
const ctx = {document: {createElement: fakeCanvas}, console, getPortraitCanvasLogicalSize: () => ({width: 200, height: 200})};
ctx.window = ctx;
vm.runInNewContext(planeSource, ctx);
const Overflow = ctx.HatOverflowPlane;
const hatProfile = {hat: {id: 'appearance::hat::old_highlands_kasa', layers: [{url: 'x.png'}]}};
assert.equal(Overflow.hasHat({hat: {id: 'none', layers: []}}), false);
assert.equal(Overflow.hasHat(hatProfile), true);

(async () => {
  let seenOptions = null;
  const pad = Overflow.PAD;
  const inside = async (canvas, profile, options) => { seenOptions = options; canvas.paint(pad + 100, pad + 100); canvas.paint(pad, pad + 50); };
  assert.equal(await Overflow.renderOverflowCanvas(hatProfile, 'front', 200, 200, inside), null,
    'A hat inside the portrait square (edge pixel included) adds no plane');
  assert.equal(seenOptions.hatOverflowPad, pad);
  assert.equal(seenOptions.portraitView, 'front');
  const spill = async canvas => { canvas.paint(pad + 100, pad + 100); canvas.paint(pad + 230, pad + 80); };
  const out = await Overflow.renderOverflowCanvas(hatProfile, 'behind', 200, 200, spill);
  assert(out, 'A brim past the square yields an overflow canvas');
  assert.equal(out.width, 200 + 2 * pad, 'Symmetric padding keeps the portrait centre');
  assert.equal(out.pixels[((pad + 100) * out.width + pad + 100) * 4 + 3], 0, 'Pixels the portrait already shows are cleared');
  assert.equal(out.pixels[((pad + 80) * out.width + pad + 230) * 4 + 3], 255, 'Spill-over pixels are kept');
  // A 400px portrait canvas (2x) scales the padding with it.
  const big = await Overflow.renderOverflowCanvas(hatProfile, 'front', 400, 400, async canvas => canvas.paint(1, 1));
  assert.equal(big.width, 400 + 4 * pad, 'Padding follows the portrait canvas scale');

  const image={src:'x.png',naturalWidth:32,naturalHeight:32};
  let paints=0; // Count actual rasterization after the resolved-layer lookup.
  ctx.renderPortraitProfile=async(canvas,profile,options)=>{
    if(options.reuseHatOverflow?.([{image,url:'x.png',xform:{ax:0,sx:1},tint:{mode:'none',hex:profile.hex}}]))return;
    paints++;if(profile.hex!=='empty')canvas.paint(1,1);
  };
  const cacheBake=hex=>Overflow.renderOverflowCanvas({...hatProfile,hex},'front',200,200,undefined,true);
  const one=await cacheBake('red');
  assert.equal(await cacheBake('red'),one,'identical resolved layers reuse the bake');
  assert.notEqual(await cacheBake('blue'),one,'changed dye cannot reuse old pixels');
  assert.equal(await cacheBake('empty'),null);
  assert.equal(await cacheBake('empty'),null,'no-overflow result is cached too');
  assert.equal(paints,3,'repeat requests skipped rasterization and readback');
  image.src='updated.png';
  await cacheBake('red');assert.equal(paints,4,'changed image source invalidates reuse');
  for(let i=0;i<40;i++)await cacheBake('color'+i);
  assert(Overflow.stats().cacheBytes<=4*1024*1024 && Overflow.stats().cacheEntries<=32,'bounded cache');

  // Real module, mocked GPU factories with ownership counters.
  const disposed={geometry:0,texture:0,material:0};
  class Group{
    constructor(){this.children=[];this.userData={};this.position={z:0,copy(){}};this.quaternion={copy(){}};this.scale={copy(){}};}
    add(x){this.children.push(x);x.parent=this;}
    remove(x){this.children=this.children.filter(y=>y!==x);x.parent=null;}
    traverse(fn){fn(this);for(const child of this.children)child.traverse(fn);}
  }
  class Mesh extends Group{constructor(geometry,material){super();this.geometry=geometry;this.material=material;this.rotation={};}}
  const THREE={Group,Mesh,PlaneGeometry:class{dispose(){disposed.geometry++;}},Box3:class{},Sphere:class{},Vector3:class{}};
  let failMaterial=false;
  ctx.PNGPlaneAvatar={makeVariantCanvas:c=>c,makePortraitTexture:()=>({dispose(){disposed.texture++;}}),
    makeSpriteMaterial:(_three,map)=>{if(failMaterial)throw Error('fixture material failure');return {map,dispose(){disposed.material++;}};}};
  const root={userData:{sourceCanvas:{width:200,height:200},portraitModelWidth:1,portraitModelHeight:1}};
  const profile={...hatProfile,hex:'red'};
  assert.equal(await Overflow.attach(THREE,root,{profile}),null,'missing assembly rejects overflow');
  assert.deepEqual(disposed,{geometry:1,texture:1,material:1},'failed attachment disposes all owned GPU objects');
  root.userData.portraitAssembly=new Group();
  assert(await Overflow.attach(THREE,root,{profile}),'valid assembly attaches');
  await Overflow.attach(THREE,root,{profile:{hat:{id:'none'}}});
  assert.deepEqual(disposed,{geometry:2,texture:2,material:2},'removing a hat releases the previous overflow');
  failMaterial=true;
  assert.equal(await Overflow.attach(THREE,root,{profile}),null);
  assert.deepEqual(disposed,{geometry:3,texture:3,material:2},'partial material construction releases prior resources');
  failMaterial=false;
  const parent=new Group(),target=new Group();parent.add(target);
  const before={...disposed};
  const cancelled=await Overflow.attachToPlanes(THREE,{profile,sourceCanvas:{width:200,height:200},modelWidth:1,modelHeight:1,planes:[{mesh:target}],isCancelled:()=>true});
  assert.equal(cancelled.length,0);assert.deepEqual(disposed,before,'cancelled split-plane bake allocates no GPU resources');

  // Mesh hygiene: never measured, picked or outlined.
  for (const needle of ['mesh.userData.noOutline = true', 'mesh.raycast = emptyRaycast', 'mesh.frustumCulled = false',
    'mesh.geometry.boundingBox = new THREE.Box3()'])
    assert(planeSource.includes(needle), 'Overflow mesh: ' + needle);
  assert(!/portraitModel(Width|Height)\s*=/.test(planeSource), 'Overflow never rewrites portrait dimensions');
  assert(planeSource.includes('skeleton.boneInverses[index].clone().multiply(plane.bindMatrix)'), 'Skinned avatars carry the overflow on the head-scale bone at its rest offset');
  assert(avatarSource.includes('window.HatOverflowPlane.attach(THREE, root,'), 'Every single-plane avatar build checks for hat overflow');
  const banditSource = read('docs/js/combat/combat-bandit.js');
  assert(planeSource.includes('async function attachToPlanes('), 'Split front/back portraits get per-plane overflow');
  assert(/HatOverflowPlane\?\.attachToPlanes\?\.\(THREE, \{[\s\S]{0,400}headBone: frontNeckSkin\?\.headScaleBone[\s\S]{0,200}headBone: backNeckSkin\?\.headScaleBone/.test(banditSource),
    'Bandit portraits carry overflow on each plane\'s head bone');
  assert(banditSource.includes('window.HatOverflowPlane?.attach?.(THREE, upper, { profile, backCanvas })'), 'Mounted/compound riders get the ordinary overflow');
  assert.equal((banditSource.match(/\{ width: portraitPlaneW, height: portraitPlaneH, sourceCanvas:/g) || []).length, 2,
    'Both bandit neck skins use the scaled portrait size, so the back view matches the front');
  for (const tool of ['attack-animation-editor/index.html', 'character-studio/index.html', 'cutscene-director/index.html', 'animation-author/index.html',
    'procedural-animation-editor/index.html', 'enemy-loadout-editor/preview.js', 'furniture-avatar-author/index.html'])
    assert(read('docs/tools/' + tool).includes('hat-overflow-plane.js'), 'Tool previews load the overflow module: ' + tool);
  assert(avatarSource.includes('root.userData.portraitDisposed = true'), 'A late overflow bake never attaches to a disposed avatar');
  assert(avatarSource.includes('texture.wrapS = THREE.ClampToEdgeWrapping;'), 'Portrait textures clamp, so a hat at one edge never bleeds onto the other');
  assert(indexHtml.indexOf('js/hat-overflow-plane.js') >= 0 && indexHtml.indexOf('js/hat-overflow-plane.js') < indexHtml.indexOf('js/png-plane-avatar.js'),
    'Overflow module loads before the avatar builder');
  console.log('PASS hat overflow plane, framed hat PNGs and hat-only padded portrait bakes');
})().catch(error => { console.error(error); process.exit(1); });

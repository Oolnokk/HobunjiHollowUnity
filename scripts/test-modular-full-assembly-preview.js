#!/usr/bin/env node
'use strict';
// Real source-backed coverage for the editor's full 2D modular rig layout and annotated renderer.
// No Three.js mirror and no browser required: exact layer positions, anchor conventions, and shaft pixels are asserted.
const assert = require('node:assert/strict'); // Makes attachment regressions fail CI before the slower browser smoke.
const fs = require('node:fs'); // Load the checked-in pure preview module rather than another copy of layout math.
const vm = require('node:vm'); // A browser-like context exercises the shipped editor module IIFE.

const calls = []; // Captures draw order and guide strokes from a small fake Canvas2D context.
function ctx() {
  const canvas = {
    drawImage(...args) { calls.push(['image',...args]); }, clearRect(...args){calls.push(['clear',...args]);},
    save(){}, restore(){}, translate(){}, rotate(){}, scale(){}, beginPath(){}, moveTo(){},
    lineTo(){}, stroke(){calls.push(['stroke']);}, fill(){}, arc(){}, setLineDash(){},
    fillText(...args){calls.push(['text',...args]);},
    getImageData(_x,_y,width,height){const data=new Uint8ClampedArray(width*height*4);data.fill(255);return {data};},
    putImageData(){},
  }; // Canvas supports opacity scans, actual art layers, and guide labels without browser graphics.
  return canvas;
}
const window = {}; // Original module attaches its pure API here.
const document = { createElement(type) { assert.equal(type,'canvas');return {width:0,height:0,getContext:()=>ctx()};} };
vm.runInNewContext(fs.readFileSync('docs/tools/modular-weapon-editor/full-assembly-preview.js','utf8'),
  {window,document,Uint8ClampedArray,WeakMap,Map,Math,Number,String,Error}, {filename:'full-assembly-preview.js'});
const api=window.ModularWeaponFullAssembly;
assert.equal(typeof api.layout,'function');
assert.equal(typeof api.render,'function');

const composed={width:450,height:1204,modularFrame:{left:0,top:0,width:450,height:1204}}; // The real modular shaft is in its unchanged source frame.
const ropeImage={width:6,height:100}; // Simplified stand-in for the original alpha-cropped ruin-rope texture.
const headImages=[{width:80,height:100},{width:120,height:60}]; // Two independently moving head PNGs, retaining authoring layer offsets.
const head={anchorSpace:'composite',anchorLayer:'front',anchor:{x:8,y:190},scale:1,
  layers:[{id:'back',sprite:'back.png',offsetPx:{x:-7,y:0}},
    {id:'front',sprite:'front.png',offsetPx:{x:7,y:-10}}]};
const recipe={flail:{haftAnchor:{x:210,y:1051},
  chain:{type:'rope',sprite:'rope.png',lengthPx:225,radiusPx:6.25,scaleX:5.25,scaleY:3.75,
    mountLengthPx:843.75,color:'#FFFFFF'},head}};
const plan=api.layout(recipe,composed,ropeImage,headImages);
assert.equal(plan.start.x,210);assert.equal(plan.start.y,1051);
assert.equal(plan.rope.reach,843.75,'authored rope mount overrides connector reach');
assert.equal(plan.rope.width,65.625,'rope mount never changes independent 2*radius*scaleX width');
assert.equal(plan.end.y,1894.75);
assert.equal(plan.headScale,1,'head is never stretched to match the rope');
assert.equal(plan.contact.x,8);assert.equal(plan.contact.y,190,'composite head contact is center-relative, NOT a modular mounting arrow');
assert.equal(plan.parts[0].x,210-8-40-7);
assert.equal(plan.parts[0].y,1894.75-190-50);
assert.equal(plan.parts[1].x,210-8-60+7);
assert.equal(plan.parts[1].y,1894.75-190-30-10);
assert(plan.bounds.top<=0 && plan.bounds.top+plan.bounds.height>=plan.end.y,
  'whole rig bounding box includes BOTH full shaft and rope end, no crop');

const canvas={width:450,height:1500,dataset:{},getContext:()=>ctx()};
const beforeRender=calls.length; // An opaque-border scan drew the source rope once offscreen; that is NOT a rig layer.
const painted=api.render(canvas,plan,true);
assert.equal(canvas.dataset.rigKind,'flail');
assert.equal(painted.layerCount,2);
assert.equal(calls.slice(beforeRender).filter(op=>op[0]==='image').length,4,
  'actual assembled haft, rope art, and two separate head layers are painted in correct order');
assert.deepEqual(calls.slice(beforeRender).filter(op=>op[0]==='image').slice(0,4).map(op=>op[1]),
  [composed,ropeImage,...headImages], 'the entire rig is made of genuine source images, never a decorative guide-only mockup');
assert(calls.some(op=>op[0]==='text' && op[1]==='SHAFT ANCHOR'),'full view labels the real attachment');
assert(calls.some(op=>op[0]==='text' && op[1]==='HEAD CONTACT'),'full view labels the head end');
const visibleCount=calls.length;api.render(canvas,plan,false);
assert.equal(calls.slice(visibleCount).filter(op=>op[0]==='text').length,0,
  'hide guide toggle never removes actual rope/head pixels');
assert.equal(canvas.dataset.rigKind,'flail');

const shifted={...recipe,flail:{...recipe.flail,haftAnchor:{x:50,y:250}}};
const shiftedPlan=api.layout(shifted,composed,ropeImage,headImages);
assert.equal(shiftedPlan.start.x,50);assert.equal(shiftedPlan.parts[0].x,plan.parts[0].x-160);
assert.equal(shiftedPlan.parts[0].y,plan.parts[0].y-801,
  'moving haft attachment carries all moving head layers with it');

// Non-composite anchors include the half-pixel convention and selected layer.offsetPx, matching runtime pixelPoint().
const anchored={...head,anchorSpace:'layer',anchorLayer:'front',anchor:{x:40,y:50}};
const local=api.authoredContact(anchored,[{layer:head.layers[0],image:headImages[0]},
  {layer:head.layers[1],image:headImages[1]}]);
assert.equal(local.x,40.5-60+7);
assert.equal(local.y,50.5-30-10);

// Ordinary heads hanging from a rope must honor ALL pair corrections, not just flailHeadAnchor/head.scale.
const correctedHead={...anchored,visualTransform:{
  scaleX:1.25,scaleY:0.4,flipX:true,flipY:true,rotation:30,x:12,y:-18
}}; // A real authored mirror + squashed blade + offset fixture from the modular pair controls.
const corrected=api.layout({...recipe,flail:{...recipe.flail,head:correctedHead}},composed,ropeImage,headImages);
assert.equal(corrected.rope.reach,plan.rope.reach,'head pair transforms cannot stretch the rope');
assert.equal(corrected.rope.width,plan.rope.width,'head pair transforms cannot thicken the rope');
assert.equal(corrected.headContact.x,corrected.end.x+12);
assert.equal(corrected.headContact.y,corrected.end.y-18);
assert.equal(corrected.visual.scaleX,-1.25);
assert.equal(corrected.visual.scaleY,-0.4);
assert(Math.abs(corrected.visual.angle-Math.PI/6)<1e-12);
assert.notEqual(corrected.parts[0].x,plan.parts[0].x,
  'the full-rig preview must actually move and rotate the hanging head pixels');
assert.notEqual(corrected.parts[0].width,plan.parts[0].width,
  'nonuniform pair scaling changes displayed sprite dimensions');
const correctedCount=calls.length;
const correctedResult=api.render(canvas,corrected,true);
assert.equal(correctedResult.visualTransform.scaleY,-0.4,
  'the full 2D renderer receives the pair-specific flipped Y scale');
assert.equal(calls.slice(correctedCount).filter(op=>op[0]==='image').length,4,
  'corrected preview still renders complete shaft, rope, and both real head layers');
assert.deepEqual(corrected.parts[0].corners.length,4,
  'scaled and rotated bounds are computed for every corner to prevent clipping');

// Pair painter order must also affect a hanging flexible head, not just rigid head/haft compositions.
const behindPlan=api.layout({...recipe,flail:{...recipe.flail,head:{...correctedHead,layerOrder:'haft-over-head'}}},
  composed,ropeImage,headImages);
const beforeBehind=calls.length;
api.render(canvas,behindPlan,false);
assert.deepEqual(calls.slice(beforeBehind).filter(op=>op[0]==='image').map(op=>op[1]),
  [...headImages,composed,ropeImage],
  'head-over/shaft-over choice controls the real drawn order of hanging art and the haft, without removing rope');

// Raster chain: the authored top/bottom (not transparent PNG bounds) remain the true connectors.
const raster={type:'chain',scaleX:2,scaleY:1,mountLengthPx:300,
  top:{x:6,y:10},bottom:{x:14,y:90}};
const rasterPlan=api.rasterChainPlan(raster,{width:24,height:100},{x:210,y:1051},{x:0,y:0,w:24,h:100});
assert(Math.abs(rasterPlan.reach-300)<1e-7);
assert.equal(rasterPlan.scaleX,2,'only chain length is stretched, preserving independent chain width');
assert(rasterPlan.corners.length===4,'the full rotated chain footprint is available for cropping safety');

// Ordinary weapons also use the new primary full-assembly view without dangling/flail-only parts.
const rigidCanvas={width:450,height:1204,dataset:{},getContext:()=>ctx()};
const result=api.renderRigid(rigidCanvas,composed,[{start:{x:100,y:100},end:{x:100,y:160}}],true);
assert.equal(result.mounts,1);assert.equal(rigidCanvas.dataset.rigKind,'rigid');
console.log('Full modular 2D assembly: genuine haft/rope/head art, source anchors, 2-layer offsets, chain reach, mount marker toggle and rigid fallback PASS');

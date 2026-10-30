'use strict';
// node scripts/test-flail-rope-picker-scale.js
// Exercises real Grapple-Flail preview layout and mobile sprite-point picking.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const config = fs.readFileSync('docs/config/weapon-sprite-assemblies.js','utf8'); // Committed artist recipes.
const render = fs.readFileSync('docs/tools/multi-sprite-weapon-editor/preview-renderer.js','utf8'); // The actual paired preview renderer.
const picker = fs.readFileSync('docs/tools/multi-sprite-weapon-editor/pick-on-sprite.js','utf8'); // The same pixel selection widget used by Tool Hub.
const app = fs.readFileSync('docs/tools/multi-sprite-weapon-editor/app.js','utf8'); // Source integration sanity checks.
const runtime = fs.readFileSync('docs/js/weapon-sprite-assemblies.js','utf8'); // Real game rope/scale adapter.
const game = fs.readFileSync('docs/game.js','utf8'); // Grapple-Flail weapon inventory and sprite registration.
const index = fs.readFileSync('docs/tools/multi-sprite-weapon-editor/index.html','utf8'); // Correct script order and picker controls.
for (const source of [config,render,picker,app,runtime]) new Function(source);
assert.match(index,/pick-on-sprite\.js\?v=/);
assert.match(index,/id="chainScaleX"/);
assert.match(index,/id="chainScaleY"/);
assert.match(index,/id="headScale"/);
assert.match(index,/id="pickCanvas"/);
assert.match(app,/function writeCoordinate/);
assert.match(app,/HobunjiSpritePointPicker\?\.create/);
assert.match(runtime,/makeRope\(THREE, f\.chain, unit, order \+ 0\.01, ropeTexture\)/);
assert.match(runtime,/plane\.getWorldScale\(q\.scale\)/,'final visible haft scale must be inherited');
assert.match(runtime,/state\.chain\.scale\.set\(/);
assert.match(runtime,/connectorAxisScale\(flail\.chain, 'scaleX'\)/);
assert.match(runtime,/connectorAxisScale\(flail\.chain, 'scaleY'\)/);
assert.match(runtime,/state\.headRoot\.scale\.setScalar\(localHandleScale \* headScale\)/);
assert.match(runtime,/headSpec\.anchorSpace === 'composite'/);
assert.match(runtime,/assets\/textures\/wavy_surface\.png/);
assert.match(game,/grappleFlail: \{ label: 'Grapple-Flail'/);
assert.match(game,/ITEM_DEFS\.grappleFlail/);

const window = {devicePixelRatio:1};
const art = {
  'grapple-flail_handle.png':{width:40,height:120,rgba:new Uint8ClampedArray(40*120*4),name:'handle'},
  'grapple-flail_grapple-back.png':{width:80,height:80,rgba:new Uint8ClampedArray(80*80*4),name:'back'},
  'grapple-flail_grapple-front.png':{width:80,height:80,rgba:new Uint8ClampedArray(80*80*4),name:'front'},
  'hachutu_torch-flail_handle.png':{width:40,height:120,rgba:new Uint8ClampedArray(40*120*4),name:'torch'},
  'hachutu_torch-flail_chain.png':{width:12,height:100,rgba:new Uint8ClampedArray(12*100*4),name:'chain'},
};
for(const [name,img] of Object.entries(art)){
  const x=Math.floor(img.width/2),ys=[4,img.height-5];
  for(const y of ys) img.rgba[(y*img.width+x)*4+3]=255;
}
const events={head:[],combined:[]};
const ctx={
  clearRect(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},save(){},restore(){},
  translate(){},scale(){},rotate(){},arc(){},fill(){},fillText(){},setTransform(){},
  drawImage(img){if(this.currentPaint)events[this.currentPaint].push(img.name);},
};
const document={createElement(tag){
  assert.equal(tag,'canvas');
  const holder={width:0,height:0};
  holder.getContext=()=>({drawImage(img){this.source=img;},getImageData(){return {data:this.source.rgba};}});
  return holder;
}};
vm.runInNewContext(config,{window});
vm.runInNewContext(render,{window,document});
const registry=window.WEAPON_SPRITE_ASSEMBLY_CONFIG.weapons;
assert.deepEqual(Object.keys(registry),['hachutuTorchFlail','grappleFlail']);
assert.deepEqual(Array.from(registry.grappleFlail.flail.head.layers,l=>l.id),['back','front']);
assert.equal(registry.grappleFlail.flail.chain.type,'rope');
assert.equal(registry.grappleFlail.flail.head.anchorSpace,'composite');
const lookup=path=>art[String(path||'').split('/').pop()]||null;
const preview=window.HobunjiMultiSpritePreviewRenderer;
const a=preview.modelFor(registry.grappleFlail,lookup,0,0);
assert(a.rope && a.headOrigin && a.headPosition);
assert.equal(a.rope.length,160);
assert.equal(a.headPosition.y-a.pivot.y,840,'approved Grapple-Flail rope length is 160 handle pixels × 5.25');
assert.equal(a.chainScaleX,5.25);
assert.equal(a.chainScaleY,5.25);
assert.equal(registry.hachutuTorchFlail.flail.chain.scaleX,1);
assert.equal(registry.hachutuTorchFlail.flail.chain.scaleY,0.35);
assert.equal(registry.hachutuTorchFlail.flail.head.scale,2.5);
assert.equal(registry.hachutuTorchFlail.flail.head.layers[2].vfx.size,0.4);
const full=preview.boundsFor(a,lookup,'combined'),detail=preview.boundsFor(a,lookup,'head');
assert(!full.empty && !detail.empty);
const fit=preview.fit(full,320,240);
assert(full.minX*fit.zoom+fit.x>=0 && full.maxX*fit.zoom+fit.x<=320);
assert(full.minY*fit.zoom+fit.y>=0 && full.maxY*fit.zoom+fit.y<=240);
const scaled=JSON.parse(JSON.stringify(registry.grappleFlail));
scaled.flail.chain.scaleX=1;scaled.flail.chain.scaleY=2;scaled.flail.head.scale=.5;
const b=preview.modelFor(scaled,lookup,0,0);
assert.equal(b.headPosition.y-b.pivot.y,320,'chain scale changes rope length without changing head scale');
assert.equal(b.headScale,.5);
const wider=JSON.parse(JSON.stringify(scaled)); // Width-only changes must not change the hanging endpoint.
wider.flail.chain.scaleX=8;
const widthOnly=preview.modelFor(wider,lookup,0,0);
assert.equal(widthOnly.headPosition.y-b.headPosition.y,0,'X scaling changes rope width without increasing its length');
assert.equal(widthOnly.chainScaleX,8);
const legacy=JSON.parse(JSON.stringify(scaled)); // Older saved recipes with only scale remain supported.
legacy.flail.chain={...legacy.flail.chain,scale:2};
delete legacy.flail.chain.scaleX;delete legacy.flail.chain.scaleY;
const older=preview.modelFor(legacy,lookup,0,0);
assert.equal(older.chainScaleX,2);
assert.equal(older.chainScaleY,2);
assert(Math.abs((b.headPosition.y-b.headOrigin.y)-95)<1e-7,'authored composite contact y=190 stays attached to the scaled head at 0.5×');
const textured=preview.modelFor({...scaled,flail:{...scaled.flail,head:{...scaled.flail.head,anchor:{x:12,y:-14}}}},lookup,0,0);
assert.equal(textured.headOrigin.x,textured.headPosition.x-6,'composite x coordinate is measured from the shared center');
assert.equal(textured.headOrigin.y,textured.headPosition.y+7,'composite y coordinate is measured from the shared center');

const drawnLayers=[]; // Captures composite picker images to confirm their authored per-layer displacements. 
const callbacks = new Map();
const canvas = {
 width:700,height:500,
 getContext(){return {...ctx,drawImage(img,x,y){drawnLayers.push({name:img.name,x,y});},setTransform(){}};},
 addEventListener(event,fn){callbacks.set(event,fn);},
 getBoundingClientRect(){return {left:10,top:20,width:350,height:250};},
};
const button = {addEventListener(event,fn){this.click=fn;}};
const panel = {hidden:true,scrollIntoView(){}};
const title={textContent:''},info={textContent:''};
vm.runInNewContext(picker,{window,document});
const control=window.HobunjiSpritePointPicker.create({canvas,panel,title,info,cancel:button});
let chosen=null;
assert(control.open({images:[art['grapple-flail_grapple-back.png'],art['grapple-flail_grapple-front.png']],composite:true,offsets:[{x:18,y:-8},{x:-18,y:8}],label:'Grapple head',onPick:p=>chosen=p}));
assert.equal(panel.hidden,false);
assert.deepEqual(drawnLayers.slice(-2).map(p=>[p.name,p.x,p.y]),[['back',-22,-48],['front',-58,-32]],'the two PNGs render with different authored offsets');
const center=control.fromEvent({clientX:185,clientY:145});
assert.deepEqual(JSON.parse(JSON.stringify(center)),{x:0,y:0},'center gap can be selected without any opaque pixel');
callbacks.get('pointerdown')({clientX:185,clientY:145});
assert.equal(panel.hidden,true);
assert.deepEqual(JSON.parse(JSON.stringify(chosen)),{x:0,y:0});
const single=control.open({images:[art['grapple-flail_handle.png']],composite:false,label:'Handle',onPick:p=>chosen=p});
assert(single);
const middle=control.fromEvent({clientX:185,clientY:145});
assert.deepEqual(JSON.parse(JSON.stringify(middle)),{x:20,y:60},'source image points use top-left pixel indexing');
button.click();
assert.equal(panel.hidden,true);
console.log('flail rope + picker + scale: PASS (two head layers, rope, viewport fit, scaled joints, center-gap selection, source pixel selection)');

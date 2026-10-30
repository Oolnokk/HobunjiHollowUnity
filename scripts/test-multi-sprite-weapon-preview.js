'use strict';
// node scripts/test-multi-sprite-weapon-preview.js
// Head and full-assembly auto-fit guard for off-screen long chains on mobile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync('docs/tools/multi-sprite-weapon-editor/preview-renderer.js','utf8'); // Actual renderer used by Tool Hub.
const author = fs.readFileSync('docs/tools/multi-sprite-weapon-editor/app.js','utf8'); // Checks that both preview modes are driven from one RAF.
const html = fs.readFileSync('docs/tools/multi-sprite-weapon-editor/index.html','utf8'); // Tests independently mounted preview panels.
const registrySource = fs.readFileSync('docs/config/weapon-sprite-assemblies.js','utf8'); // Production flail layer recipe and contact defaults.
new Function(script); new Function(author);
assert.match(html, /id="headPreview"/);
assert.match(html, /id="preview"/);
assert.match(html, /id="soloLayer"/);
assert.match(html, /preview-renderer\.js\?v=/);
assert.match(author, /drawCanvas\(\$\('headPreview'\), 'head'/);
assert.match(author, /drawCanvas\(\$\('preview'\), 'combined'/);
assert.match(author, /renderer\.debugSnapshot\(\)|Renderer\?\.debugSnapshot\(\)/); // Mobile diagnostics include measured bounds.

function image(name, width, height, opaquePoints) {
  const rgba = new Uint8ClampedArray(width*height*4);
  for (const [x,y] of opaquePoints) {
    const idx = (y*width+x)*4;
    rgba[idx]=90;rgba[idx+1]=132;rgba[idx+2]=128;rgba[idx+3]=255;
  }
  return {name,width,height,rgba};
}
const pngs = {
  'hachutu_torch-flail_handle.png': image('shaft',512,512,[[250,180],[250,320]]),
  'hachutu_torch-flail_chain.png': image('chain',32,1050,[[16,20],[16,1030]]),
  'torch-flail_brazier-back.png': image('back',260,300,[[100,80],[130,220]]),
  'torch-flail_brazier-handle.png': image('handle',270,300,[[130,40],[130,280]]),
  'torch-flail_brazier-fuel.png': image('fuel',280,300,[[160,110],[163,130]]),
  'torch-flail_brazier-front.png': image('front',260,320,[[100,60],[150,260]]),
}; // Deliberately enormous 1,050px chain and different-sized transparent head images.

const document = {
  createElement(tag) {
    assert.equal(tag,'canvas');
    return {
      width:0,height:0,
      getContext() {
        return {
          drawImage(img) { this.current = img; },
          getImageData() {return {data:this.current.rgba};},
        };
      },
    };
  },
};
const window = {devicePixelRatio:2};
vm.runInNewContext(script,{window,document,Math});
vm.runInNewContext(registrySource,{window});
const renderer=window.HobunjiMultiSpritePreviewRenderer;
assert.ok(renderer);
const recipe=window.WEAPON_SPRITE_ASSEMBLY_CONFIG.weapons.hachutuTorchFlail;
const lookup=path=>pngs[String(path).split('/').pop()]||null;

function assertFitted(bounds,viewWidth,viewHeight) {
  const f=renderer.fit(bounds,viewWidth,viewHeight);
  const eps=1e-6;
  assert.ok(f.zoom>0 && Number.isFinite(f.zoom));
  assert.ok(bounds.minX*f.zoom+f.x>=-eps, 'left of assembled opaque pixels is not clipped');
  assert.ok(bounds.maxX*f.zoom+f.x<=viewWidth+eps, 'right of assembled opaque pixels is not clipped');
  assert.ok(bounds.minY*f.zoom+f.y>=-eps, 'top of assembled opaque pixels is not clipped');
  assert.ok(bounds.maxY*f.zoom+f.y<=viewHeight+eps, 'bottom of assembled opaque pixels is not clipped');
  return f;
}
for (const t of [0,0.12,0.25,0.5,0.68,0.95]) {
  const model=renderer.modelFor(recipe,lookup,t,1500);
  assert.ok(model.headOrigin && model.headPosition);
  assert.ok(model.headPosition.y>500,'large chain head is far beyond the old haft-centered crop');
  const full=renderer.boundsFor(model,lookup,'combined');
  const detail=renderer.boundsFor(model,lookup,'head');
  assert.ok(full.maxY>model.headPosition.y-200,'combined view measures the brazier, not just the haft');
  assert.ok(detail.maxY-detail.minY>100,'head close-up measures the actual brazier art');
  assertFitted(full,340,275); // Mobile portrait full assembly canvas.
  assertFitted(detail,340,210); // Mobile portrait head canvas.
  assertFitted(full,960,430); // Desktop.
  assertFitted(detail,960,360);
}
const model=renderer.modelFor(recipe,lookup,.25,1500);
const kinds={head:[],combined:[],solo:[]};
function makeCanvas(id) {
  const events=kinds[id]; // Draw order identifies the actual source sprite (not just metadata).
  const ctx={
    setTransform(){},clearRect(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},
    save(){},restore(){},translate(){},scale(){},rotate(){},arc(){},fill(){},fillText(){},
    drawImage(img){events.push(img.name);}
  };
  return {clientWidth:330,clientHeight:240,width:1,height:1,getContext:()=>ctx};
}
const options={
  dt:.05,playing:false,weaponKey:'hachutuTorchFlail',
  stackTarget:'head',solo:false,selected:2,effects:{sourcePixels(){return[];}},
};
const head=renderer.drawCanvas(makeCanvas('head'),'head',model,lookup,part=>lookup(part.sprite),options);
const full=renderer.drawCanvas(makeCanvas('combined'),'combined',model,lookup,part=>lookup(part.sprite),options);
assert.deepEqual(kinds.head,['back','handle','fuel','front']);
assert.deepEqual(kinds.combined,['shaft','chain','back','handle','fuel','front']);
assert.equal(head.partsReady,4);assert.equal(head.partsExpected,4);
assert.equal(full.chainReady,true);assert.equal(full.haftReady,true);
renderer.drawCanvas(makeCanvas('solo'),'head',model,lookup,part=>lookup(part.sprite),{...options,solo:true});
assert.deepEqual(kinds.solo,['fuel'],'soloing fuel does not lose the separate full-assembly preview');
const detached=renderer.modelFor(recipe,path=>path.includes('handle.png')?null:lookup(path),0,1500);
assert.ok(renderer.boundsFor(detached,lookup,'head').maxY>100,'close-up can still draw loaded head sprites if haft is missing');
const diagnostics=renderer.debugSnapshot();
assert.ok(diagnostics.combined.fit.zoom>0 && diagnostics.head.partsReady===4);
renderer.resetEffects();
console.log('multi-sprite weapon preview: PASS (head, combined, solo, opacity bounds, long chain, mobile/desktop fitting, source draw order)');

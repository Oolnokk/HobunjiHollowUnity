#!/usr/bin/env node
'use strict';
// Pixel-exact regression for the new rigid-portrait/flexible-spline ownership system.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..'); // Keep fixtures relative to the project rather than the test's working directory.
class Canvas {
  constructor(width=200,height=200){this.width=width;this.height=height;this.pixels=new Uint8ClampedArray(width*height*4);}
  get width(){return this._width;}
  set width(value){this._width=value;this.pixels=new Uint8ClampedArray(value*(this._height||0)*4);}
  get height(){return this._height;}
  set height(value){this._height=value;this.pixels=new Uint8ClampedArray(this._width*value*4);}
  getContext(kind) {
    assert.equal(kind,'2d');
    const canvas=this;
    return {
      drawImage(src,dx=0,dy=0,dw=src.width,dh=src.height){
        for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){
          const destX=Math.floor(x+dx),destY=Math.floor(y+dy);
          if(destX<0||destY<0||destX>=canvas.width||destY>=canvas.height)continue;
          const srcX=Math.min(src.width-1,Math.floor(x*src.width/dw));
          const srcY=Math.min(src.height-1,Math.floor(y*src.height/dh));
          const at=(destY*canvas.width+destX)*4,from=(srcY*src.width+srcX)*4;
          for(let channel=0;channel<4;channel++)canvas.pixels[at+channel]=src.pixels[from+channel];
        }
      },
      clearRect(){canvas.pixels.fill(0);},
      getImageData(){return {data:new Uint8ClampedArray(canvas.pixels),width:canvas.width,height:canvas.height};},
      putImageData(data){canvas.pixels.set(data.data);},
    };
  }
}
const document={createElement(kind){assert.equal(kind,'canvas');return new Canvas();}};
const window={};
vm.runInNewContext(fs.readFileSync(path.join(root,'docs/js/portrait-spline-rig.js'),'utf8'),
  {window,document,Uint8Array,Uint8ClampedArray,Float32Array,Math,Number});
const Rig=window.PortraitSplineRig;
const head=new Canvas(),hair=new Canvas(); // Two independent opaque silhouettes share the canonical portrait UV grid.
const paint=(canvas,x,y,rgba)=>canvas.pixels.set(rgba,(y*canvas.width+x)*4);
for(let y=40;y<=100;y++)for(let x=70;x<=130;x++)paint(head,x,y,[210,150,110,255]);
for(let y=60;y<=160;y++)for(let x=70;x<=120;x++)paint(hair,x,y,[90,65,45,255]);
paint(hair,80,80,[0,0,0,0]); // Transparent cosmetic pixels never become rigid by default.
const mask=Rig.maskFromOverlap(hair,head),bits=Rig.decodePixelMask(mask);
const idx=(x,y)=>y*200+x;
assert.equal(bits[idx(90,70)],1,'head and hair overlap defaults to rigid');
assert.equal(bits[idx(90,120)],0,'hair outside head defaults to flexible');
assert.equal(bits[idx(125,70)],0,'head without hair is never added to a cosmetic region mask');
assert.equal(bits[idx(80,80)],0,'transparent holes inside the hair remain unassigned');
assert.equal(bits.reduce((a,b)=>a+b,0),51*41-1,'mask uses the full true alpha overlap, not a finite seam span');
const pixel=(canvas,x,y)=>Array.from(canvas.pixels.slice(idx(x,y)*4,idx(x,y)*4+4));
const prepared=Rig.prepareSplineTexture(hair);
assert.deepEqual(pixel(prepared,90,70),pixel(hair,90,70),'the single contiguous hair texture retains every opaque source pixel');
assert.deepEqual(pixel(prepared,90,120),pixel(hair,90,120),'flexible hanging hair stays in the same sprite as anchored beard pixels');
assert.deepEqual(pixel(prepared,90,59),[90,65,45,1],
  'transparent edge gets matching beard RGB with sub-alpha-test coverage instead of a black filter halo');
assert.deepEqual(pixel(prepared,90,58),[90,65,45,1],
  'two-pixel transparent guard band protects angled and minified sampling');
assert.deepEqual(pixel(hair,90,59),[0,0,0,0],
  'anti-dark-edge texture preparation never corrupts the original indexed cosmetics');
for(let i=0;i<200*200;i++){
  const original=hair.pixels[i*4+3],preparedAlpha=prepared.pixels[i*4+3];
  if(original>=8)assert.equal(preparedAlpha,original,'no original opaque pixel may be altered at '+i);
  else assert(preparedAlpha<=1,'a guard-band pixel must remain below the material alpha-test threshold at '+i);
}
assert.equal(typeof Rig.splitByMask,'undefined',
  'hair can no longer be cut into two separate artwork textures at a visible black boundary');
const extend=Rig.paintPixelMask(mask,(90.5)/200,(120.5)/200,3,true);
assert.equal(Rig.decodePixelMask(extend)[idx(90,120)],1,'brush can anchor previously flexible pixels');
const erase=Rig.paintPixelMask(extend,90.5/200,70.5/200,3,false);
assert.equal(Rig.decodePixelMask(erase)[idx(90,70)],0,'eraser can release an originally head-overlapping pixel');
assert.equal(Rig.decodePixelMask(mask)[idx(90,70)],1,'mask edits never mutate the stored prior mask (undo-safe)');
const empty=Rig.encodePixelMask(new Uint8Array(40000));
assert.equal(Rig.decodePixelMask(empty)[idx(90,70)],0,'explicit all-flexible mask remains valid');
const strokeStart={u:10.5/200,v:20.5/200}; // Widely spaced pointer samples model a fast drag on the editor.
const stroke=Rig.paintPixelMask(empty,180.5/200,strokeStart.v,1,true,strokeStart);
const strokeBits=Rig.decodePixelMask(stroke);
for(let x=10;x<=180;x++)assert.equal(strokeBits[idx(x,20)],1,'fast brush strokes have no gaps');
assert.equal(strokeBits[idx(95,22)],0,'a stroke stays inside the brush radius');
const erasedStroke=Rig.paintPixelMask(stroke,10.5/200,strokeStart.v,1,false,{u:180.5/200,v:strokeStart.v});
assert.deepEqual(erasedStroke,empty,'a fast reverse stroke erases the entire brush path');
const normalized=Rig.normalize({points:[{u:.5,v:.25},{u:.5,v:.65}],
  regionMasks:{front:mask,rear:empty}});
assert.equal(normalized.regionMasks.front.runs.length,mask.runs.length,'front region survives JSON serialization');
assert.equal(normalized.regionMasks.rear.runs.length,0,'rear mask is independent and can be explicitly all-flexible');
assert.equal(Rig.decodePixelMask(normalized.regionMasks.front)[idx(90,70)],1);
assert.equal(typeof Rig.splitByMask,'undefined','no legacy two-texture seam-splitting function survives');
const pinField=Rig.attachmentPinField(mask);
assert(pinField&&pinField.length===40000,'binary anchored vertex field covers the full portrait UV grid');
assert.equal(Rig.isPinnedPixel(pinField,90.5/200,70.5/200),true,
  'head-overlap hair vertices always stay fixed');
assert.equal(Rig.isPinnedPixel(pinField,90.5/200,101.5/200),false,'the first unpainted pixel is flexible');
assert.equal(Rig.attachmentMotion(pinField,90.5/200,100.5/200),0,'rigid pixels have no 3D motion');
assert(Rig.attachmentMotion(pinField,90.5/200,101.5/200)>0&&Rig.attachmentMotion(pinField,90.5/200,101.5/200)<1,
  'the 3D mesh softens in the first two pixels outside the hard mask');
assert.equal(Rig.attachmentMotion(pinField,90.5/200,103.5/200),1,'the thin transition gives way to full motion');
assert(Rig.attachmentMotion(pinField,80.5/200,80.5/200)>0,'an isolated flexible pixel can move');
assert.equal(Rig.isPinnedPixel(pinField,90.5/200,142.5/200),false,
  'the hanging tip is completely free once outside the grip');
assert.equal(Rig.attachmentPinField(empty),null,
  'explicitly all-flexible hair has no phantom anchored vertices');
assert.equal(Rig.isPinnedPixel(null,.5,.5),false,'legacy unmasked hair remains movable');
const reference=Rig.normalize({points:[{u:.45,v:.30,depth:.02},{u:.47,v:.55,depth:.03}],
  segments:[{deadzone:{x:0,y:0,z:0},poses:{right:{translate:{x:.1}}}}],pinWidthPx:18});
const rest=Rig.posePoints(reference).points,moved=Rig.posePoints(reference,{x:1}).points;
const pinned=Rig.deformPosition(reference,moved,.46,.45,1,1,true);
const free=Rig.deformPosition(reference,moved,.46,.45,1,1,false);
const neutral=Rig.deformPosition(reference,rest,.46,.45,1,1,false);
assert(Math.abs(pinned.x-(.46-.5))<1e-9,'pinned hair position exactly matches portrait X coordinate');
assert(Math.abs(pinned.y-(.5-.45))<1e-9,'pinned hair position exactly matches portrait Y coordinate');
assert(Math.abs(pinned.z-.0008)<1e-9,'pinned hair depth is fixed flush against the portrait plane');
assert(free.x>neutral.x,'outside the rigid region, hair gets the full authored movement');
assert(!('pinWidthPx' in reference),'legacy broad grip never overrides the exact head mask');
assert(!('blendRadiusPx' in reference),'legacy blendRadiusPx is ignored and dropped from exported rigs');
const defaultWind=Rig.makeDefaultSegments([{u:.5,v:.2},{u:.5,v:.5},{u:.5,v:.8}]);
assert(defaultWind[1].poses.left.translate.x<0&&defaultWind[1].poses.right.translate.x>0,
  'default wind directions use opposite, shape-scaled motions, not six empty poses');
const suggested=Rig.suggestRestPoints(hair,head);
assert(suggested&&suggested.length===3&&suggested[0].v<suggested[1].v&&suggested[1].v<suggested[2].v,
  'rest spline is fitted to opaque hair bounds and head-overlapping root, rather than fixed coordinates');
const portrait=fs.readFileSync(path.join(root,'docs/js/portrait-utils.js'),'utf8');
assert(portrait.includes('canvas.hobunjiSplineParts.push({ key, slot, rig, canvas: partCanvas'),
  'the game sends all rigid and flexible pixels on ONE continuous textured mesh');
assert(!portrait.includes('splitByMask?.('),
  'in-game avatar no longer cuts the single hair image at the formerly visible black seam');
assert(!portrait.includes('warpHoodCanvas?.('),'hoods remain outside the old seam authoring path');
console.log('Single-mesh spline region masks: alpha overlap, binary head grip, untouched artwork, guarded edges, brush, eraser and RLE pass.');

const hood=new Canvas(); // A solid cloth patch covers the beard and a neighboring empty part of the portrait.
for(let y=70;y<90;y++)for(let x=85;x<130;x++)paint(hood,x,y,[50,100,80,255]);
const opening=Rig.paintPixelMask(null,95.5/200,80.5/200,2,true,{u:125.5/200,v:80.5/200});
const overlap=Rig.paintPixelMask(null,96.5/200,75.5/200,1,true);
const hoodRig=Rig.normalize({...reference,hoodOpeningMask:opening,hoodOverlapMask:overlap});
const fitted=Rig.fitHood(hood,hoodRig,[hair]);
assert.equal(fitted.coverage[idx(95,80)],0,'painted beard pixels open the hood');
assert.equal(fitted.coverage[idx(125,80)],1,'the opening cannot punch a hole past the beard silhouette');
assert.equal(fitted.overlap[idx(96,75)],1,'covered beard pixels may render above the hood');
assert.equal(fitted.overlap[idx(100,75)],0,'unpainted beard is occluded by the hood');
const smallBeard=new Canvas(100,100); // A different source size still uses canonical 200px mask coordinates.
paint(smallBeard,47,40,[90,65,45,255]);
paint(hood,94,80,[50,100,80,255]);
const resized=Rig.fitHood(hood,{hoodOpeningMask:{size:200,runs:[[idx(94,80),1]]}},[smallBeard]);
assert.equal(resized.coverage[idx(94,80)],0,'hood opening rescales alternate beard sizes before alpha testing');
const rigidOver=Rig.deformPosition(hoodRig,moved,.46,.45,1,1,false,1,2);
assert.deepEqual(rigidOver,pinned,'rigid overlap preserves the portrait-local position');
const bentOver=Rig.deformPosition(hoodRig,moved,.46,.45,1,1,false,1,1);
assert.equal(bentOver.z,.003,'bend overlap clears the hood by the minimum depth');
assert(bentOver.x>rigidOver.x,'bend overlap retains flexible motion');

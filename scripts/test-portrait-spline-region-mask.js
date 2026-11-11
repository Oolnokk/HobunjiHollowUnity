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
const paint=(canvas,x,y,rgba)=>canvas.pixels.set(rgba,(y*200+x)*4);
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
const split=Rig.splitByMask(hair,mask);
const pixel=(canvas,x,y)=>Array.from(canvas.pixels.slice(idx(x,y)*4,idx(x,y)*4+4));
assert.deepEqual(pixel(split.rigid,90,70),[90,65,45,255],'overlapping beard pixels stay on the undeformed portrait');
assert.deepEqual(pixel(split.flexible,90,70),[90,65,45,0],'the moving mesh has no double-painted rigid pixels');
assert.deepEqual(pixel(split.rigid,90,120),[90,65,45,0],'static portrait contains no free-hanging beard pixels');
assert.deepEqual(pixel(split.flexible,90,120),[90,65,45,255],'free-hanging beard pixels remain on the deformable spline');
for(let i=0;i<200*200;i++){
  assert.equal(split.rigid.pixels[i*4+3]+split.flexible.pixels[i*4+3],hair.pixels[i*4+3],
    'the pixel partition must preserve original alpha at '+i);
}
const extend=Rig.paintPixelMask(mask,(90.5)/200,(120.5)/200,3,true);
assert.equal(Rig.decodePixelMask(extend)[idx(90,120)],1,'brush can anchor previously flexible pixels');
const erase=Rig.paintPixelMask(extend,90.5/200,70.5/200,3,false);
assert.equal(Rig.decodePixelMask(erase)[idx(90,70)],0,'eraser can release an originally head-overlapping pixel');
assert.equal(Rig.decodePixelMask(mask)[idx(90,70)],1,'mask edits never mutate the stored prior mask (undo-safe)');
const empty=Rig.encodePixelMask(new Uint8Array(40000));
assert.equal(Rig.decodePixelMask(empty)[idx(90,70)],0,'explicit all-flexible mask remains valid');
const normalized=Rig.normalize({points:[{u:.5,v:.25},{u:.5,v:.65}],
  regionMasks:{front:mask,rear:empty}});
assert.equal(normalized.regionMasks.front.runs.length,mask.runs.length,'front region survives JSON serialization');
assert.equal(normalized.regionMasks.rear.runs.length,0,'rear mask is independent and can be explicitly all-flexible');
assert.equal(Rig.decodePixelMask(normalized.regionMasks.front)[idx(90,70)],1);
assert.equal(Rig.splitByMask(hair,null).flexible,hair,'legacy styles without a mask continue moving as before');
assert.equal(Rig.splitByMask(hair,null).rigid,null,'legacy styles do not acquire phantom head attachments');
const portrait=fs.readFileSync(path.join(root,'docs/js/portrait-utils.js'),'utf8');
assert(portrait.includes('ctx.drawImage(layers.rigid, 0, 0'),'rigid pixels must be composited on the original game portrait');
assert(portrait.includes('canvas: layers?.flexible || partCanvas'),'only flexible pixels enter the 3D spline');
assert(!portrait.includes('warpHoodCanvas?.('),'hoods are not carved by the old seam author');
console.log('Rigid/flexible spline region masks: 200px alpha overlap, brush, eraser, undo, RLE, and disjoint 3D partition pass.');

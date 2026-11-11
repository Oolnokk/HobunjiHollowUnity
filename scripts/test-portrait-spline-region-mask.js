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
const seamWidth=Rig.stitchWidthPx({segmentsX:24,segmentsY:32});
assert(seamWidth>=10&&seamWidth<=14,'auto seam collar covers at least a whole vertex-grid cell without dense remeshing');
const joined=Rig.splitByMask(hair,mask,{stitchPx:seamWidth});
assert(joined.stitchedPixels>0,'hair/head join transfers a real strip of rigid artwork into the contiguous flex mesh');
assert.deepEqual(pixel(joined.rigid,90,95),[90,65,45,0],
  'pixels inside the original rigid region near the bend move onto the anchored part of the same mesh');
assert.deepEqual(pixel(joined.flexible,90,95),[90,65,45,255],
  'the moving hair mesh extends across the former cut into a non-deforming collar');
assert.deepEqual(pixel(joined.rigid,90,70),[90,65,45,255],
  'deeply attached artwork remains on the flat original portrait');
assert.deepEqual(pixel(joined.flexible,90,70),[90,65,45,0],
  'the mesh collar does not needlessly duplicate all head-attached artwork');
assert.deepEqual(pixel(joined.flexible,90,105),[90,65,45,255],
  'the same unbroken PNG surface continues across the old moving/static boundary');
for(let i=0;i<200*200;i++){
  assert.equal(joined.rigid.pixels[i*4+3]+joined.flexible.pixels[i*4+3],hair.pixels[i*4+3],
    'seam stitch must transfer, never duplicate/drop, the original artwork at pixel '+i);
}
const beforeSeam=Rig.splitByMask(hair,mask,{stitchPx:0});
assert.equal(beforeSeam.stitchedPixels,0,'zero-width seam request preserves exact legacy mask ownership');
assert.deepEqual(pixel(beforeSeam.rigid,90,95),[90,65,45,255],
  'existing exact-split callers continue to own the rigid border on the flat portrait');
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
const blend=Rig.attachmentBlendField(mask,18); // Cached pixel-distance weights, shared by game renderer and 3D author.
assert(blend&&blend.length===40000,'rigid/flexible transition uses a full portrait-grid influence field');
assert.equal(Rig.sampleAttachmentBlend(blend,90.5/200,70.5/200),0,'rigid pixel has zero deformation influence');
const adjacent=Rig.sampleAttachmentBlend(blend,90.5/200,101.5/200);
const midway=Rig.sampleAttachmentBlend(blend,90.5/200,109.5/200);
const distant=Rig.sampleAttachmentBlend(blend,90.5/200,142.5/200);
assert(adjacent>0&&adjacent<midway&&midway<distant,'blend rises continuously with distance away from the head');
assert.equal(distant,1,'fully flexible pixels beyond blend radius receive all authored motion');
assert.equal(Rig.attachmentBlendField(empty,18),null,'an explicitly all-flexible style requires no distance field');
assert.equal(Rig.attachmentBlendField(mask,0),null,'zero blend radius preserves old immediate deformation behavior');
const reference=Rig.normalize({points:[{u:.45,v:.30,depth:.02},{u:.47,v:.55,depth:.03}],
  segments:[{deadzone:{x:0,y:0,z:0},poses:{right:{translate:{x:.1}}}}],blendRadiusPx:18});
const rest=Rig.posePoints(reference).points,moved=Rig.posePoints(reference,{x:1}).points;
const still=Rig.deformPosition(reference,moved,.46,.45,1,1,0);
const blended=Rig.deformPosition(reference,moved,.46,.45,1,1,.5);
const free=Rig.deformPosition(reference,moved,.46,.45,1,1,1);
const neutral=Rig.deformPosition(reference,rest,.46,.45,1,1,1);
assert(Math.abs(still.x-neutral.x)<1e-9,'a rigid boundary vertex stays at its neutral location');
assert(Math.abs(still.z-.0008)<1e-9,'anchored mesh collar sits exactly on the rigid preview portrait depth, not .003 above it');
assert(free.z>blended.z&&blended.z>still.z,'attachment depth is continuously tapered to prevent a visible 3D ledge');
assert(free.x>blended.x&&blended.x>still.x,'automatic blend controls vertex motion rather than fading the original artwork');
const defaultWind=Rig.makeDefaultSegments([{u:.5,v:.2},{u:.5,v:.5},{u:.5,v:.8}]);
assert(defaultWind[1].poses.left.translate.x<0&&defaultWind[1].poses.right.translate.x>0,
  'default wind directions use opposite, shape-scaled motions, not six empty poses');
const suggested=Rig.suggestRestPoints(hair,head);
assert(suggested&&suggested.length===3&&suggested[0].v<suggested[1].v&&suggested[1].v<suggested[2].v,
  'rest spline is fitted to opaque hair bounds and head-overlapping root, rather than fixed coordinates');
const portrait=fs.readFileSync(path.join(root,'docs/js/portrait-utils.js'),'utf8');
assert(portrait.includes('ctx.drawImage(layers.rigid, 0, 0'),'rigid pixels must be composited on the original game portrait');
assert(portrait.includes('canvas: layers?.flexible || partCanvas'),'only flexible pixels and their pinned collar enter the 3D spline');
assert(portrait.includes('stitchPx: window.PortraitSplineRig.stitchWidthPx(rig)'),
  'game renderer enables the same automatically sized pinned collar as the 3D editor');
assert(!portrait.includes('warpHoodCanvas?.('),'hoods are not carved by the old seam author');
console.log('Rigid/flexible spline masks: alpha ownership, contiguous pinned seam mesh, 3D depth alignment, brush, eraser and RLE pass.');

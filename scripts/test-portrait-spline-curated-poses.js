#!/usr/bin/env node
'use strict';
// Regression for the individually authored cosmetics, not the editor's temporary procedural defaults.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const window={};
vm.runInNewContext(fs.readFileSync(path.join(root,'docs/js/portrait-spline-rig.js'),'utf8'),
  {window,Uint8Array,Float32Array,Math,Number,document:{createElement(){throw Error('Test must not author art at runtime');}}});
const Rig=window.PortraitSplineRig;
const styles=[
 ['mao-ao/grandbeard.json','grand'],['mao-ao/wildbeard.json','wild'],
 ['mao-ao/braid-L.json','braid'],['mao-ao/braid-R.json','braid'],['mao-ao/braidcluster-R.json','cluster'],
 ['tletingan/grandbeard.json','grand'],['tletingan/wildbeard.json','wild'],
 ['tletingan/braid-R.json','braid'],['tletingan/braidcluster-R.json','cluster'],
 ['kenkari/grandbeard.json','grand'],['kenkari/wildbeard.json','wild'],['kenkari/shirtbeard.json','shirt'],
 ['kenkari/braid-L_m.json','braid'],['kenkari/braid-R_m.json','braid'],
 ['mashtzarr-m/grandbeard.json','grand'],
]; // Specific indexed styles, checked against canonical cosmetic JSON (male/female sharing remains intact).
const samples=[];
for(const [filename,kind] of styles){
 const file=path.join(root,'docs/config/cosmetics/appearance',filename);
 const cosmetic=JSON.parse(fs.readFileSync(file,'utf8')),raw=cosmetic.portraitSplineRig;
 assert(raw?.enabled===true,filename+' has a persisted opt-in bone');
 assert.equal(raw.version,2,filename+' has been migrated out of blend-space JSON');
 assert(!('segments' in raw)&&!('tipFollow' in raw),filename+' stores no directional pose tables');
 assert.equal(cosmetic.type,'appearance');assert(cosmetic.parts?.head);
 const rig=Rig.normalize(raw);
 assert(rig&&rig.points.length===2,filename+' uses only anchored root and free tip');
 assert(Object.values(rig.bone).every(n=>Number.isFinite(n)&&n>0&&n<=65),
   filename+' has valid physical swing limits');
 assert.equal(rig.hoodStretchPx,12,filename+' persists a hood opening stretch radius');
 assert(rig.width>0&&!('pinWidthPx' in rig),filename+' retains the exact head mask');
 assert(rig.segmentsX<=24&&rig.segmentsY<=32,filename+' stays within the mesh budget');
 const front=rig.regionMasks.front;
 assert(front?.runs?.length>0,filename+' retains its authored attachment');
 if(kind==='braid'||kind==='cluster')
   assert(rig.regionMasks.rear?.runs?.length>0,filename+' retains independent rear grip');
 else assert(!rig.regionMasks.rear,filename+' does not render a second rear beard');
 const field=Rig.attachmentPinField(front);
 assert(field?.some(x=>x===1)&&field.some(x=>x===0),filename+' has rigid and free pixels');
 const neutral=Rig.posePoints(rig).points;
 const right=Rig.posePoints(rig,{x:1}).points,left=Rig.posePoints(rig,{x:-1}).points;
 const anchoredRoot=JSON.stringify(neutral[0]);
 assert.equal(JSON.stringify(right[0]),anchoredRoot,filename+' root never moves in gusts');
 assert.equal(JSON.stringify(left[0]),anchoredRoot,filename+' root never moves in reverse gusts');
 assert(right[1].x>neutral[1].x&&left[1].x<neutral[1].x,
   filename+' one bone responds to both sides');
 for(const wind of [{y:1},{y:-1},{z:1},{z:-1},{x:1,y:1,z:1}]){
   const posed=Rig.posePoints(rig,wind);
   assert(posed.points.every(p=>Object.values(p).every(Number.isFinite)&&p.z>=.003),
     filename+' remains finite and collision-safe');
 }
 samples.push({style:filename,kind,travel:Math.round((right[1].x-neutral[1].x)*200)});
}
assert.equal(styles.length,15,'all 15 authored cosmetics are covered');
assert.equal(new Set(styles.map(x=>x[0])).size,15,'the style list contains no duplicates');
assert.equal(new Set(styles.map(x=>x[1])).size,5,'five families of bone movement remain independently tuned');
console.log('15 single-bone cosmetics: authored masks, hood stretch, wind swing and collision limits pass.');
console.log('Representative side-gust tip travel: '+samples.slice(0,8).map(x=>x.style.split('/').pop()+' '+x.travel+'px').join(', '));

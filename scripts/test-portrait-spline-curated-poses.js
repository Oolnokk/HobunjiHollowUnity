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
const directions=[
 ['left',{x:-1},'x',-1],['right',{x:1},'x',1],
 ['up',{y:1},'y',1],['down',{y:-1},'y',-1],
 ['toward',{z:1},'z',1],['away',{z:-1},'z',-1],
];
const samples=[];
for(const [filename,kind] of styles){
 const file=path.join(root,'docs/config/cosmetics/appearance',filename);
 const cosmetic=JSON.parse(fs.readFileSync(file,'utf8'));
 const raw=cosmetic.portraitSplineRig;
 assert(raw&&raw.enabled===true,filename+' has a persisted opt-in rig, not only a new-style editor suggestion');
 assert.equal(cosmetic.type,'appearance');
 assert(cosmetic.parts?.head,filename+' retains its existing hair asset entry');
 const rig=Rig.normalize(raw);
 assert(rig&&rig.points.length===3&&rig.segments.length===2,filename+' has an editable root/mid/tip spline');
 assert.equal(rig.tipFollow,raw.tipFollow,filename+' keeps its bottom-led knot parenting');
 assert(!('blendRadiusPx' in rig),filename+' must use hard head pinning, not the removed influence blend');
 assert(rig.width>0&&!('pinWidthPx' in rig),filename+' uses the exact authored head mask');
 assert(rig.segmentsX<=24&&rig.segmentsY<=32,
   filename+' limits extra mesh cost when NPCs share this haircut');
 const front=rig.regionMasks.front;
 assert(front?.runs?.length>0,filename+' persists alpha-measured head-overlap pixels instead of attaching no part of the strand');
 const requiredRear=kind==='braid'||kind==='cluster';
 if(requiredRear)assert(rig.regionMasks.rear?.runs?.length>0,filename+' also attaches the rear side-hair artwork');
 else assert(!rig.regionMasks.rear,filename+' avoids constructing an unused rear beard mask');
 const pins=Rig.attachmentPinField(front);
 assert(pins&&pins.some(x=>x===1)&&pins.some(x=>x===0),filename+' has both fully anchored and free areas');
 let pinnedVertices=0;
 for(let y=0;y<=rig.segmentsY;y++)for(let x=0;x<=rig.segmentsX;x++)
   pinnedVertices+=Number(Rig.isPinnedPixel(pins,x/rig.segmentsX,y/rig.segmentsY));
 assert(pinnedVertices>=2,filename+' head attachment must grip actual mesh vertices, not merely empty pixel space');
 assert(pinnedVertices<(rig.segmentsX+1)*(rig.segmentsY+1)-2,filename+' must retain freely moving vertices');
 const neutral=Rig.posePoints(rig).points;
 const baseline=neutral.at(-1);
 const tipRight=rig.segments.at(-1).poses.right.translate.x;
 const upperRight=rig.segments[0].poses.right.translate.x;
 assert(tipRight>upperRight&&upperRight>0,filename+' bottom knot must drive the middle one');
 for(const [name,wind,axis,sign] of directions){
   const posed=Rig.posePoints(rig,wind);
   const tip=posed.points.at(-1),delta=tip[axis]-baseline[axis];
   assert(Number.isFinite(delta),filename+' '+name+' produces a finite posed endpoint');
   assert.equal(Math.sign(delta),sign,filename+' '+name+' should displace the tip in the actual wind direction');
   assert.deepEqual(JSON.parse(JSON.stringify(posed.points[0])),JSON.parse(JSON.stringify(neutral[0])),
     filename+' '+name+' never moves the head root');
   assert(posed.points.every(p=>p.z>=.003),filename+' '+name+' keeps the collision-limited strand in front of the portrait');
 }
 samples.push({style:filename,kind,headVertices:pinnedVertices,width:rig.width,
   right:Math.round((Rig.posePoints(rig,{x:1}).points.at(-1).x-baseline.x)*200)});
}
assert.equal(new Set(styles.map(x=>x[0])).size,15,'all curated files are distinct existing cosmetics');
assert.equal(new Set(styles.map(x=>x[1])).size,5,'authored pose library includes five distinct physical behavior types');
console.log('15 individually authored portrait spline blend spaces pass six wind axes, front/rear masks, head grip, bottom-parent hierarchy, and NPC mesh budget.');
console.log('Representative right-gust tip travel (portrait pixels): '+samples.map(x=>x.style.split('/').pop().replace('.json','')+' '+x.right).slice(0,8).join(', '));

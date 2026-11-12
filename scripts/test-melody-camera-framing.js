'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const framing=require('../docs/js/melody-camera-framing.js');
const game=fs.readFileSync(path.join(__dirname,'../docs/game.js'),'utf8');

const base={x:0,y:1,z:0}; // The ordinary over-the-shoulder aim point used by both geometry cases.
const plate={x:0,y:0,z:0,radius:.46}; // A single occupied one-tile music plate anchors each registered clue.
const tall=[{x:-1,y:2,z:-4},{x:1,y:3,z:-4},{x:-1,y:5,z:-4},{x:1,y:6,z:-4}]; // Two columns stacked above the plate.
const wide=[{x:-6,y:1.8,z:-4},{x:6,y:1.8,z:-4},{x:-5.5,y:2,z:-4},{x:5.5,y:2,z:-4}]; // Separated cave pillars need primarily horizontal coverage.

function assertFits(label,points){
  const azimuth=0,angle=Math.PI/6,baseDistance=2.6,baseFov=42,aspect=1.6;
  const fit=framing.solve(points,plate,base,baseDistance,azimuth,angle,baseFov,aspect);
  assert.ok(fit&&fit.possible,label+' should have a valid fit within the regular camera limits');
  assert.ok(fit.distanceScale>=1,label+' must not zoom in and hide a clue');
  const focus={x:base.x+fit.offsetX,y:base.y+fit.offsetY,z:base.z+fit.offsetZ};
  const distance=baseDistance*fit.distanceScale;
  const pitchS=Math.sin(angle),pitchC=Math.cos(angle);
  const tan=Math.tan((baseFov+fit.fovExtra)*Math.PI/360);
  for(const p of points){
    const dx=p.x-focus.x,dy=p.y-focus.y,dz=p.z-focus.z;
    const depth=distance-(dy*pitchS+dz*pitchC);
    const x=dx/(depth*tan*aspect),y=(dy*pitchC-dz*pitchS)/(depth*tan);
    assert.ok(x>=-.84&&x<=.84&&y>=-.73&&y<=.69,label+' has clipped a required note: '+JSON.stringify({x,y}));
  }
  return fit;
}
const tallFit=assertFits('tall',tall);
const wideFit=assertFits('wide',wide);
assert.ok(tallFit.offsetY>0,'height-stacked notes must lift the camera');
assert.ok(wideFit.distanceScale>1||wideFit.fovExtra>0,'widely separated pillars must widen the frame');

let showing=false,onPlate=true; // These values simulate note discovery and the owning plate's live session.
const glyphs=tall.map(p=>({position:p,visible:true,material:{opacity:1},parent:{visible:true}}));
const camera={projectPoint:p=>({x:showing?p.x/5:1.1,y:p.y/8,z:0})}; // A simple projected test view with an initially unseen first clue.
const release=framing.register({area:'puzzle-cave',plate,glyphs,isActive:()=>onPlate});
const args={area:'puzzle-cave',playerX:0,playerZ:0,camera,baseTarget:base,
  baseDistance:2.6,azimuth:0,angle:Math.PI/6,fovDeg:42,aspect:1.6};
framing.update({...args,now:0});
assert.equal(framing.debugSnapshot().active,false,'standing on the plate alone must not reveal notes');
showing=true;framing.update({...args,now:100});
assert.equal(framing.debugSnapshot().triggerNote,0,'the first onscreen clue must activate the group');
framing.update({...args,now:200});
assert.ok(framing.debugSnapshot().framing.offsetY>0,'the discovered camera should smoothly begin lifting');
showing=false;framing.update({...args,now:300});
assert.equal(framing.debugSnapshot().active,true,'after discovery the full score stays framed even if a clue leaves the original view');
onPlate=false;framing.update({...args,now:400});
assert.equal(framing.debugSnapshot().active,false,'leaving the plate releases the camera');
framing.update({...args,area:'other-map',now:500});
assert.equal(framing.debugSnapshot().framing.distanceScale,1,'area changes reset camera offsets immediately');
release();release();
assert.equal(framing.debugSnapshot().registered,0,'repeated disposal is safe');

assert.match(game,/MelodyCameraFraming\?\.update\?\.\(/,'gameplay camera calls the registered melody framing module');
assert.match(game,/!window\.CinematicCameraRuntime\?\.isActive\?\.\(\)/,'authored cinematic shots override puzzle framing');
assert.match(game,/melodyFrame\?\.fovExtra/,'the live camera uses the calculated FOV correction');
for(const file of ['puzzle-cave-entrances.js','ruin-layer-challenges.js','dev-random-ruin-simple-puzzles.js']){
  const source=fs.readFileSync(path.join(__dirname,'../docs/js',file),'utf8');
  assert.match(source,/MelodyCameraFraming\?\.register\?\.\(/,file+' registers real placed clues');
  assert.match(source,/releaseMelodyCamera\?\.\(\)/,file+' retires its registration');
}
console.log('Dynamic melody camera: tall/wide fit, hidden clue discovery, latching, map/plate cleanup and runtime wiring pass.');

#!/usr/bin/env node
'use strict';
// Extract the actual V50 hit-driven functions. ON and OFF are separate
// projectile sequences that hold/retract the native timed bridge, not a
// conventional all-targets-to-one mechanism puzzle.
const assert=require('node:assert/strict');
const fs=require('node:fs'); // Reads shipped gameplay source, rather than testing a duplicate bridge command implementation.
const vm=require('node:vm');
const source=fs.readFileSync('docs/js/dev-random-ruin-hit-puzzles.js','utf8');
function shippedFunction(start,end){
  const a=source.indexOf('  function '+start+'('),b=source.indexOf('  function '+end+'(',a+1);
  assert(a>=0&&b>a,'Missing original V50 command implementation '+start);
  return source.slice(a,b);
}
const target=(id,command,required)=>({id,active:false,command,required,mechanismId:'bridge',object:{id}});
const onA=target('on-a','ON',2),onB=target('on-b','ON',2),off=target('off','OFF',1);
const bridge={mechanismId:'bridge',target:0,progress:0,commandTarget:null,proxy:{userData:{solveProgress:0}},
  glyphRequired:2,glyphTargets:[onA,onB,off],ignitionTargets:[]};
const simpleA={id:'normal-a',active:false,required:2,mechanismId:'normal',object:{}};
const simpleB={id:'normal-b',active:false,required:2,mechanismId:'normal',object:{}};
const ordinary={mechanismId:'normal',target:0,progress:0,commandTarget:null,proxy:{userData:{solveProgress:0}},
  glyphRequired:2,glyphTargets:[simpleA,simpleB],ignitionTargets:[]};
let sounds=0;
const frame={
  window:{AudioSystem:{playObjectSfxKey:()=>{sounds++;}},DevRandomRuinGlyphCircuits:{refreshActivatedGlyph(){}},__farmLog(){}},
  devDeps:{showToast(){}},hitSerial:0,SIGNAL_SPEED:1.8,
  mechanismSignals:new Map([['bridge',bridge],['normal',ordinary]]),
  clamp:(x,a,b)=>Math.max(a,Math.min(b,x))
};
vm.createContext(frame);
vm.runInContext([
  shippedFunction('activateGlyph','installRangedProjectileHook'),
  shippedFunction('updateSignalState','applyActivatorVisuals')
].join('\n'),frame);
assert.equal(frame.activateGlyph(onA),true);
frame.updateSignalState(.05);
assert.equal(bridge.target,0,'the first of two required ON glyphs cannot extend the bridge');
assert.equal(frame.activateGlyph(onB),true);
frame.updateSignalState(.5);
assert.equal(bridge.commandTarget,.5,'ON targets the authored V50 bridge fully extended midpoint');
assert.equal(bridge.target,.5);
assert.equal(bridge.proxy.userData.solveProgress,.5);
assert.equal(sounds,1);
assert.equal(frame.activateGlyph(off),true);
frame.updateSignalState(.5);
assert.equal(bridge.commandTarget,0,'OFF orders the V50 bridge to retract');
assert.equal(bridge.target,0);
assert.equal(bridge.proxy.userData.solveProgress,0);
assert.equal(onA.active,false);
assert.equal(onB.active,false);
assert.equal(frame.activateGlyph(onA),true,'ON glyphs must be reusable after OFF resets them');
assert.equal(frame.activateGlyph(onB),true);
frame.updateSignalState(.5);
assert.equal(bridge.target,.5,'the same bridge can be extended a second time');
assert.equal(off.active,false);
assert.equal(frame.activateGlyph(simpleA),true);
frame.updateSignalState(.5);
assert.equal(ordinary.target,0,'standard glyphs must keep their original multi-target requirement');
assert.equal(frame.activateGlyph(simpleB),true);
frame.updateSignalState(.5);
assert.equal(ordinary.target,1,'non-command V50 glyph circuits still open their ordinary mechanism');
console.log('ok V50 bridge glyphs: separate ON/OFF hit groups, complete native midpoint, reset, repeat, ordinary glyphs unchanged');

// Exercise the shipped native projectile query, with an oversized debug box
// installed so an accidental fallback would allow a hit from the closed sides.
const niche = target('niche', null, 1);
const cover = { segmentHit: () => null };
const rays = { DynamicSurfaces: {}, NearbyVolumeCollision: cover, RangedWeapons: { update: (...args) => cover.segmentHit(...args) } };
Object.assign(frame, {
  window: rays, root: {}, MAP_ID: 'ruin', currentArea: () => 'ruin',
  GLYPH_HITBOX_PAD: .045, glyphTargets: [niche],
  finite: (value, fallback) => Number.isFinite(value) ? value : fallback,
  installedRangedHook: false,
});
vm.runInContext([
  shippedFunction('segmentBoxInterval', 'pillarMouthHit'),
  shippedFunction('pillarMouthHit', 'glyphProjectileHit'),
  shippedFunction('glyphProjectileHit', 'activateGlyph'),
  shippedFunction('installRangedProjectileHook', 'updateSignalState'),
  'installRangedProjectileHook();'
].join('\n'), frame);
niche.hitBox = { clone: () => { throw new Error('Pillar hits must use the opening'); } };
const ranged = rays.RangedWeapons;
const radius = 7 / 55; // Standard crossbow projectile in world units.
for (const outward of [{x:0,z:-1}, {x:1,z:0}, {x:0,z:1}, {x:-1,z:0}]) {
  const center = {x:10, z:20}; // Rooms can be translated away from the map origin.
  for (const y of [.45, 1, 1.45, 9.45]) {
    const point = {x:center.x+outward.x*.22,z:center.z+outward.z*.22};
    niche.pillarMouth = {point, outward, bounds: {
      min:{x:center.x-.08,z:center.z-.08,y:y-.15},
      max:{x:center.x+.08,z:center.z+.08,y:y+.15},
    }};
    const at = (distance, side = 0, elevation = y) => ({
      x:point.x+outward.x*distance+outward.z*side,
      z:point.z+outward.z*distance-outward.x*side,
      y:elevation,
    });
    niche.active = false;
    assert.equal(ranged.update(at(1), at(.5), radius), null, 'a short step before the lip has no contact');
    const hit = ranged.update(at(.5, .04), at(-.2), radius);
    assert.equal(hit?.key, niche.id, 'an angled shot entering the opening reaches the glyph');
    assert.equal(niche.active, false, 'query must wait for combat to commit the hit');
    hit.onImpact();
    assert.equal(niche.active, true, 'the winning projectile impact activates the glyph');
    assert.equal(ranged.update(at(-1), at(1), radius), null, 'a rear shot cannot hit the opening');
    assert.equal(ranged.update(at(-.1, 1), at(-.1), radius), null, 'a side shot cannot hit the opening');
    assert.equal(ranged.update(at(1, .18), at(-.2, .18), radius), null, 'aiming at the stone edge misses');
    assert.equal(ranged.update(at(1, 0, y-4), at(-.2, 0, y-4), radius), null, 'a lower-floor shot misses');
  }
}
console.log('ok native pillar mouths: four orientations, three height bands, stacked elevation, and confirmed impact');

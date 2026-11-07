#!/usr/bin/env node
'use strict';
// Native V50 block pushing must attach only after the playable dungeon has initialized.
// The compound puzzle is owned by the existing wing gate, not a second fake completion.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../docs/js/ruin-layer-challenges.js'),'utf8'); // Test the shipped challenge dispatcher, not a copied adapter.
new vm.Script(source,{filename:'ruin-layer-challenges.js'});
let inMap=false,stageActive=true,ready=false,created=0,disposed=0,solved=0,links=0;
const registered=[],released=[],controls=[],surfaces=[],blockers=[]; // Audit the scoped raised supports and elevated blocker registrations.
let puzzleOptions=null;
const bus={
  hasActiveRuinState:()=>inMap,
  registerExternalProjectileTarget(target){registered.push(target);return ()=>released.push(target);}
};
const game={getOccupancySnapshot:()=>ready?{count:1}:null};
const DS={registerSurface:record=>surfaces.push(record),registerBlocker:record=>blockers.push(record),clearScope:scope=>released.push(scope)};
const env={
  DevRandomRuinSimplePuzzles:bus,DevRandomRuin:game,DynamicSurfaces:DS,
  DevRuinFindBlocks:{
    create(options){
      created++;puzzleOptions=options;
      options.kit.registerSurface({id:'find-blocks-test-platform',topY:2});
      options.kit.registerBlocker({id:'find-blocks-test-stone',bounds:{minX:1,maxX:2,minZ:1,maxZ:2}});
      const control={kind:'findBlocksTest'}; // The real compound room registers and releases its controls as one owned unit.
      options.kit.addControl(control);
      options.kit.registerProjectileTarget({id:'findBlocksTestTarget'});
      return {variant:'projectiles',netVariant:'movingTargets',ready:true,linked:true,
        tick(){},snapshot:()=>({weighted:2}),
        dispose(){disposed++;options.kit.removeControl(control);}};
    }
  }
};
vm.runInNewContext(source,env,{filename:'ruin-layer-challenges.js'});
const challenge=env.RuinLayerChallenges.compose({
  THREE:{},parent:{},room:{id:'floor2-E-room1',x:0,z:0,w:18,d:18},id:'floor2-E-room1',
  kind:'findBlocks',y:16,isActive:()=>stageActive,
  getPlayerPosition:()=>({x:9,z:9,y:16}),getPlayerY:()=>16,
  addControl:control=>controls.push(control),
  removeControl:control=>controls.splice(controls.indexOf(control),1),
  onLink:()=>links++,
  onSolved:()=>solved++
});
assert.equal(challenge.kind,'findBlocks');
assert.equal(challenge.ready,false);
challenge.tick(.05);
assert.equal(created,0,'No native block should be registered before gameplay starts');
inMap=true;challenge.tick(.05);
assert.equal(created,0,'Wait for the native V50 occupancy registry to initialize');
ready=true;stageActive=false;challenge.tick(.05);
assert.equal(created,0,'Do not mount an inactive or vertically distant puzzle');
stageActive=true;challenge.tick(.05);
assert.equal(created,1);
assert.equal(challenge.ready,true);
assert.equal(challenge.linked,true);
assert.equal(registered.length,1,'The native projectile registry owns nested moving targets');
assert.equal(surfaces.length,1,'Raised supports are scoped to this wing');
assert.equal(blockers.length,1,'Pillars route through the layered dungeon collision service');
assert.equal(blockers[0].scope,surfaces[0].scope,'Per-floor pillar obstacles share the raised support teardown scope');
assert.equal(controls.length,1,'Native puzzle controls use the normal interaction resolver');
assert.equal(puzzleOptions.showGate,false,'The existing wing gate must not be duplicated');
assert.equal(challenge.snapshot().weighted,2,'Mobile diagnostics reflect actual block progress');
puzzleOptions.onSolved();
assert.equal(challenge.solved,true);
assert.equal(solved,1);
puzzleOptions.onSolved();
assert.equal(solved,1,'The same stage cannot unlock twice');
challenge.dispose();
challenge.dispose();
assert.equal(disposed,1,'The owned native puzzle is disposed exactly once');
assert.equal(controls.length,0,'Dungeon controls are unregistered on teardown');
assert.equal(released.length,2,'Projectile callback and raised support scope are both cleaned');
assert.equal(links>=1,true,'Mobile state changes after native initialization');
console.log('PASS Find the Blocks layered-wing deferred startup, native targets, progression, mobile diagnostics and cleanup');

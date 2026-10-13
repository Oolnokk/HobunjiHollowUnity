'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../docs/js/dev-random-ruin-interior-map.js'), 'utf8');
const start = source.indexOf('  function positionInfo(');
const end = source.indexOf('  function updateTransitDoors(', start);
assert.ok(start >= 0 && end > start);
let surfaces = [{ id:'upper', y:.06 }, { id:'lower', y:-.7 }];
let publishedHeight;
const player = { x:10, y:12, climbing:true, climbSurfaceY:-.7 };
const ruin = { supportId:'upper', supportY:.06, lastAcceptedPx:{x:8,y:8}, lastSafePx:{x:8,y:8}, falling:null };
const context = {
  deps:{ player, TILE:1 }, ruin, MAX_STEP_HEIGHT:.42, PLAYER_RADIUS:.22,
  window:{ DevRandomRuinSimplePuzzles:{ ownsPlayerMotion:()=>false } },
  DS:{
    pointInPit:()=>null,
    sampleSupport(x,z,options){ return surfaces.filter(s=>s.y>=options.minY&&s.y<=options.maxY).sort((a,b)=>b.y-a.y)[0]||null; },
  },
  syncRuinPresentationHeight:y=>{publishedHeight=y;},
};
vm.runInNewContext(source.slice(start,end)+'\nthis.reconcile = reconcilePlayer;', context);
context.reconcile(0);
assert.equal(ruin.supportY,-.7,'climb advances the accepted support height');
assert.equal(publishedHeight,-.7);
player.climbing=false;
context.reconcile(1);
assert.equal(ruin.supportId,'lower','landing chooses lower support beneath an overlapping upper floor');
assert.equal(ruin.supportY,-.7);
assert.equal(publishedHeight,-.7,'render authority retains the actual ladder landing height');
assert.equal(player.x,10);
assert.equal(player.y,12);

surfaces=[{id:'ledge',y:1}];
player.x=15; player.y=15;
context.reconcile(2);
assert.equal(player.x,10,'a high ledge without reachable support still rejects horizontal movement');
assert.equal(player.y,12);
assert.equal(publishedHeight,-.7);
console.log('Ruin ladder landing support and oversized-step rejection passed.');

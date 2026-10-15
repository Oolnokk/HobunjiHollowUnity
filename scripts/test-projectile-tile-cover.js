'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const game = fs.readFileSync('docs/game.js', 'utf8'); // Extract the actual shared occupancy functions without booting WebGL.
function functionSource(name) {
  const start = game.indexOf(`      function ${name}(`); // Beginning of the runtime function being executed.
  const end = game.indexOf('\n      }', start) + '\n      }'.length; // Matching top-level function boundary in game.js.
  assert(start >= 0 && end > start);
  return game.slice(start, end);
}
const TileType = { ROCK:'rock', SHRUB:'shrub', GRASS:'grass', RIVER:'river', STREAM:'stream', TILLED:'tilled', WEEDS:'weeds', RAISED:'raised', PADDY:'paddy', TRENCH:'trench' }; // Runtime tile IDs used by the extracted code.
const grid = Array.from({length:4}, () => Array.from({length:4}, () => ({type:'grass'}))); // Mutable scene grid used to exercise all blocker kinds.
const state = { area:'map_northern_cliffs', tree:false, furniture:false, footprint:false }; // Query fixtures switched between assertions.
const context = { TileType, TILE:32, NORMAL_TOP:0, ROCK_H:0.75, PLATEAU_UNIT:0.5, SWIM_SPEED_MUL:0.5, player:{x:48,y:48},
  window:{ GridTileAccessors:{getActiveCols:()=>4,getActiveRows:()=>4,getActiveGrid:()=>grid,isTownBuildingCollisionTile:()=>false}, AreaFootprintBlockers:{blocksBox:()=>state.footprint}},
  isSolid:type=>type === 'rock' || type === 'shrub', isChoppableTreeTile:()=>state.tree,
  _isCavernBuildingArea:()=>state.area === 'cavern', _isZoneArea:()=>false,
  furnitureBlocksMovementAt:()=>state.furniture,
}; // Minimal runtime dependencies keep tests focused on collision behavior.
Object.defineProperty(context, 'currentArea', {get:()=>state.area});
vm.createContext(context);
vm.runInContext(`${functionSource('projectileTileCoverBase')}\n${functionSource('projectileTileCoverTop')}\n${functionSource('tileSpeedAt')}\n${functionSource('canOccupyAt')}`, context);
const occupy = worldY => context.canOccupyAt(48,48,2,worldY); // Exercise the same radius/height handoff used by actual projectile sweeps.
assert(occupy(0.5), 'ordinary grass never blocks shots');
grid[1][1] = {type:'shrub'};
assert(occupy(0.2), 'decorative ground foliage does not provide cover');
assert.equal(occupy(), false, 'foliage retains walking collision');
state.tree = true;
assert.equal(occupy(5), false, 'native tree trunks retain solid cover');
state.tree = false;
grid[1][1] = {type:'rock', projectileCoverHeightTiles:0.6};
assert.equal(occupy(0.4), false, 'shots through rocks still stop');
assert(occupy(1), 'shots above ordinary rocks clear them');
assert.equal(occupy(0.65), false, 'the projectile underside cannot graze through rock tops');
assert.equal(occupy(), false, 'walkers still collide with rocks');
grid[1][1] = {type:'rock', rockKind:'undiggableBoulder', projectileCoverHeightTiles:1.2, elevTier:3};
assert.equal(occupy(2.5), false, 'raised boulders block shots below their elevated top');
assert(occupy(3), 'shots clear boulders at their actual elevated height');
state.area = 'cavern';
assert.equal(occupy(100), false, 'cave walls remain sealed');
grid[1][1] = {type:'rock',rockKind:'diggableRockOre'};
assert(occupy(2), 'loose cavern ore is finite cover');
state.area = 'map_northern_cliffs';
grid[1][1] = {type:'grass',_banditTentCollisionId:'tent'};
state.furniture = true;
assert(occupy(3), 'projectiles defer tent/furniture height to semantic cover');
assert.equal(occupy(), false, 'tent walking footprint is retained');
state.footprint = true;
assert.equal(occupy(3), false, 'dedicated height-aware footprint providers remain authoritative');
assert.equal(context.canOccupyAt(-1,48,2,10), false, 'shots cannot leave map bounds');

const scene = {children:[]}; // Minimal visible scene for semantic-cover runtime tests.
const browser = {}; // Receives the actual collision module API.
vm.runInNewContext(fs.readFileSync('docs/js/nearby-volume-collision.js','utf8'), {window:browser,performance});
browser.NearbyVolumeCollision.init({getActiveScene:()=>scene,isCombatActive:()=>true,player:{x:0,y:0},worldSurfaceY:()=>0});
function node(name, data) {
  return {name,userData:data,visible:true,parent:scene,position:{x:1,y:0,z:1},scale:{x:1,y:1,z:1}};
}
scene.children = [node('grass',{isBillboard:true,heightTiles:5}),node('rich foliage',{isRichFoliageBillboard:true,heightTiles:5})];
assert.equal(browser.NearbyVolumeCollision.segmentHit({x:0,y:0.2,z:1},{x:2,y:0.2,z:1}),null,'billboards cannot become semantic cover through incidental height metadata');
assert.equal(browser.NearbyVolumeCollision.debugSnapshot().candidates,0);
scene.children.push(node('stone table',{projectileCoverHeightTiles:0.8,projectileCoverRadiusTiles:0.4}));
browser.NearbyVolumeCollision.invalidate();
assert(browser.NearbyVolumeCollision.segmentHit({x:0,y:0.4,z:1},{x:2,y:0.4,z:1}),'solid furniture still blocks low shots');
assert.equal(browser.NearbyVolumeCollision.segmentHit({x:0,y:2,z:1},{x:2,y:2,z:1}),null,'solid furniture can be cleared');
console.log('Projectile grass, rock height, radius, elevation, wall and movement regressions passed.');

// Decorative ruin furniture uses authored geometry only as a decal/plaque host; its decorated door/target owns collision.
const visualRuinGroup = { userData:{authoredFurnitureKey:'ruinDoorSeal'}, traverse(callback){ callback(this); } };
const ruinBrowser = {
  THREE:{ Color:function Color(){} },
  AuthoredFurniture:{ load(){}, peek(){ return {key:'ruinDoorSeal'}; }, buildGroup(){ return visualRuinGroup; } },
  DynamicSurfaces:{ addBeforeRenderClient(){} },
};
vm.runInNewContext(fs.readFileSync('docs/js/dev-random-ruin-furniture-pieces.js','utf8'), {window:ruinBrowser,performance});
const builtVisualRuin = ruinBrowser.DevRandomRuinFurniturePieces.build('ruinDoorSeal');
assert.equal(builtVisualRuin.userData.authoredFurnitureKey, null, 'visual ruin overlays cannot register authored-furniture projectile cover');
assert.equal(builtVisualRuin.userData.devRuinFootprintIgnore, true, 'visual ruin overlays remain excluded from ruin footprint collision');
console.log('Visual ruin overlay projectile-cover regression passed.');

const strokes = []; // Canvas strokes prove the real overlay draws projectiles/cover only under Show Hitboxes.
const labels = []; // Captures the mobile-readable infinite-cover marker.
let showHitboxes = false; // Existing settings toggle exercised without a browser/console.
let colliderReads = 0; // Disabled hitbox drawing must not poll projectile state.
const canvas = new Proxy({ stroke(){strokes.push(this.strokeStyle);}, fillText(label){labels.push(label);}, measureText(){return {width:40};} }, {get:(target,key)=>key in target ? target[key] : ()=>{}}); // Minimal Canvas2D receiver for the production wireframe drawer.
const overlayBrowser = {
  RangedWeapons:{debugProjectileColliders:()=>{colliderReads++;return [{x:1,y:2,z:1,radius:0.25}];}},
  NearbyVolumeCollision:{debugVolumes:()=>[{x:1,z:1,bottomY:0,topY:0.7,shape:'circle',radius:0.5,key:'stone-table',source:'explicit-metadata'},{x:2,z:1,bottomY:0,topY:Infinity,shape:'aabb',halfX:0.5,halfZ:0.5,key:'tree',source:'solid-tree-tile'}]},
}; // Actual debug-hitboxes module receives the same public collision APIs as the game.
vm.runInNewContext(fs.readFileSync('docs/js/debug-hitboxes.js','utf8'),{window:overlayBrowser,performance});
overlayBrowser.DebugHitboxes.init({
  player:{x:32,y:32}, TILE:32, octx:canvas, hostileObjects:[],companionObjects:[],
  getCurrentArea:()=> 'farm', getShowHitboxes:()=>showHitboxes,
  getShowInteractionRaycast:()=>false, surfaceYAtWorld:()=>0,
  worldToOverlay:(x,y,z)=>({x:x*10,y:(y+z)*10,visible:true}),
});
overlayBrowser.DebugHitboxes.draw();
assert.equal(colliderReads,0,'disabled hitboxes do no projectile debug work');
showHitboxes = true;
overlayBrowser.DebugHitboxes.draw();
assert.equal(colliderReads,1,'enabled hitboxes use the public live-projectile colliders');
assert(strokes.includes('#ffe45c'),'projectile collision spheres draw in yellow');
assert(strokes.some(color => String(color).startsWith('hsl(')),'semantic projectile cover gets stable per-collider colors');
assert(labels.includes('stone-table'),'nearby semantic projectile cover is labeled by runtime key');
assert(labels.includes('cover ↑∞'),'infinite collision heights have an honest visible label');
showHitboxes = false;
const beforeStrokes = strokes.length; // Turning the toggle off must stop drawing immediately.
overlayBrowser.DebugHitboxes.draw();
assert.equal(strokes.length,beforeStrokes);
console.log('Projectile hitbox toggle and wireframe overlay checks passed.');

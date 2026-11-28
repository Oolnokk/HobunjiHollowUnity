'use strict';
// node scripts/test-kanthic-shaft-firelight.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const style=require('../docs/js/ruin-multifloor-v50-style.js');
class Vec{
  constructor(x=0,y=0,z=0){this.set(x,y,z);}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  sub(other){this.x-=other.x;this.y-=other.y;this.z-=other.z;return this;}
  dot(other){return this.x*other.x+this.y*other.y+this.z*other.z;}
  setFromMatrixColumn(){return this.set(1,0,0);} // Projects the test camera's horizontal screen axis in the real overlay method.
}
class Node{
  constructor(){this.name='';this.children=[];this.position=new Vec();this.rotation={y:0};this.userData={};this.visible=true;}
  add(...nodes){for(const n of nodes){n.parent?.remove(n);this.children.push(n);n.parent=this;}}
  remove(n){const i=this.children.indexOf(n);if(i>=0){this.children.splice(i,1);n.parent=null;}}
  traverse(fn){fn(this);for(const n of this.children)n.traverse(fn);}
  getObjectByName(name){let found=null;this.traverse(n=>{if(!found&&n.name===name)found=n;});return found;}
  getWorldPosition(v){let x=0,y=0,z=0;for(let n=this;n;n=n.parent){x+=n.position.x;y+=n.position.y;z+=n.position.z;}return v.set(x,y,z);}
}
class Geo{dispose(){this.disposed=true;}}
class Mat{constructor(o){Object.assign(this,o);}dispose(){this.disposed=true;}}
class Mesh extends Node{constructor(geo,mat){super();this.geometry=geo;this.material=mat;this.isMesh=true;}}
const THREE={Group:Node,Mesh,BoxGeometry:Geo,CylinderGeometry:Geo,ConeGeometry:Geo,MeshBasicMaterial:Mat,Vector3:Vec,Matrix4:class{}};
const scene=new Node(),localeRoot=new Node(),tower=new Node(); // Real parent transforms verify moving tower light tracking.
tower.name='obelisk-f0-A';tower.position.set(100,2,100);scene.add(localeRoot,tower);
const grid={cols:55,rows:55,levels:35,levelToY:n=>n,colToX:n=>n,rowToZ:n=>n,
  isSolid:(c,r)=>c>=0&&r>=0&&c<55&&r<55&&(c<5||r<5||c>=50||r>=50),
  canStand:(c,r)=>c>=5&&r>=5&&c<50&&r<50}; // Hollow three-story, 45-wide octagonal-hub approximation.
const hub={grid,options:{wall:5,shaft:45,spacing:16,floors:3},
  obelisks:{pillars:[{id:tower.name,name:'A',story:0}]}};
const wingGoal={x:65,y:1.4,z:80,floorY:0,radius:10,strength:.98,color:[255,139,61],active:false}; // Stand-in for the real wing runtime's goal light source.
const nativeGoal={x:72,y:17.4,z:95,floorY:16,radius:10.5,strength:.98,color:[255,136,61],active:false}; // Native raised floor must report its own Y.
const ruin={theme:'kanthic',localeRoot,shaftConnection:{},controls:[],
  shaftLayerRuntime:{lightSources:()=>[wingGoal]},nativeV50Runtime:{lightSources:()=>[nativeGoal]},
  shaftHubPlan:{floors:[{floor:0,y:0,wings:[{rooms:[{x:80,z:80,w:12,d:12}]}]}]}};
let playerY=0,notices=0; // The actual brazier control must check player's floor and provide feedback.
const cleanup=style.apply({rec:{scene},ruin,hub,seed:7,THREE,getPlayerY:()=>playerY,showToast:()=>{notices++;}});
const lights=style.lightSources(),sconces=lights.filter(l=>l.anchor);
const braziers=ruin.controls.filter(c=>c.kind==='kanthicShaftBrazier');
assert(sconces.length>=12,'giant sconces should occupy shaft walls, wings and towers');
assert.equal(braziers.length,0,'all stories use the shared checkpoint travel braziers, never overlapping Kanthic-only bowls');
assert.equal(ruin.shaftConnection.kanthicSconces,sconces.length,'diagnostics report real sconce count');
assert.equal(ruin.shaftConnection.kanthicOptionalBraziers,0,'Kanthic lighting creates no duplicate fire on the universal travel pedestal');
assert.equal(ruin.shaftConnection.kanthicRequiredBrazierLights,2,'real required wing and native sources feed the same light list');
assert(lights.includes(wingGoal)&&lights.includes(nativeGoal),'no completed-wing flame can be omitted from Kanthic projection');
assert(sconces.every(light=>light.radius<=1.05&&light.strength<=.32),'permanent Kanthic fire only illuminates a tiny local area');
assert.equal(wingGoal.radius,10,'authored record is retained; the Kanthic compositor limits its effective radius');
assert.equal(nativeGoal.radius,10.5,'native upper-story source retains its authored record for shared consumers');
assert(!wingGoal.active&&!nativeGoal.active,'unlit goal braziers do not reveal their chamber');
const wallSconces=sconces.filter(l=>l.anchor.name==='kanthic-wall-giant-sconce'
  &&l.anchor.position.x<55&&l.anchor.position.z<55); // Ignore outer-wing fixtures beyond the shaft.
assert(wallSconces.length>=10,'the shaft hub takes priority over smaller wing rooms');
assert(wallSconces.some(l=>l.story===2),'top-floor wall sconces must fit beneath the real two-voxel roof');
assert(wallSconces.every(l=>[5.03,49.97].some(v=>
  Math.abs(l.anchor.position.x-v)<.09||Math.abs(l.anchor.position.z-v)<.09)),
  'sconces must be fixed on the visible inner wall, not embedded in masonry');
const moving=sconces.find(l=>l.anchor.parent===tower);
assert(moving,'moving obelisk has its own attached fire fixture');
const before=moving.x;tower.position.x+=2;cleanup.tick();
assert.equal(moving.x-before,2,'light follows the raised or rotating tower owner');
assert(!lights.some(l=>!l.anchor&&l.floorY===16&&l.active),'a white checkpoint is the only free-standing upper shaft fire; it owns its lighting independently');
assert.equal(notices,0,'the decorative Kanthic wall style never claims shaft recovery interactions');
assert.equal(style.lightDebug().litBraziers,0,'the two required wing goal lights are initially unlit');
wingGoal.active=true;nativeGoal.active=true; // Required goal braziers still feed the Kanthic style compositor independently.
assert.equal(style.lightDebug().litBraziers,2,'both required wing and native goal braziers still project their own lights');
assert(fs.readFileSync('docs/js/ruin-layer-playable.js','utf8').includes('brazier.lit=true;flame.visible=true;brazierLight.active=true'),
  'required wing lighting uses the same real action that marks the puzzle brazier lit');
assert(fs.readFileSync('docs/js/ruin-v50-native-floors.js','utf8').includes('record.lit=true;flame.visible=true;brazierLight.active=true'),
  'native V50 lighting uses the same real action that marks the goal brazier lit');
cleanup();
assert.equal(style.lightSources().length,0,'leaving the ruin removes all projected lights');
assert.equal(ruin.controls.length,0,'leaving the ruin removes all optional interactions');
assert.equal(tower.children.length,0,'tower sconces detach on teardown');
const fog=fs.readFileSync('docs/js/cloud-forest-fog.js','utf8');
const connector=fs.readFileSync('docs/js/ruin-shaft-connector.js','utf8');
assert.doesNotThrow(()=>new vm.Script(fog),'darkness compositor parses');
assert(fog.includes("ruinTradition === 'kanthic') drawRuinTraditionLightMasks(window.RuinMultifloorV50Style?.lightSources?.() || [])"),
  'Kanthic only draws dedicated firelight, not all generic furniture lamps');
assert(fog.includes('light.active === false'),'unlit fixtures do not clear the darkness');
assert(fog.includes('const mistActive = active;'),'Kanthic uses actual Cloud Forest mist rather than an overlay-only imitation');
assert(fog.includes("drawRuinTraditionLightMasks(window.RuinRopeTorch?.lightSources?.()"),'rope-end lanterns feed the same shared darkness pass');
assert.equal(fog.split('drawRuinTraditionLightMasks(window.RuinCheckpointTravel?.lightSources?.() || [])').length-1,2,
  'earned shaft travel and checkpoint lights project through both enclosed and actual-fog paths');
assert(fog.includes('ruinFireMaskStats.sources+=lights.length')&&fog.includes('ruinFireMaskStats.projected+=visible.length'),
  'the mobile lighting diagnostics accumulate separate fixture groups within one draw');
assert.equal(fog.split('drawRuinPatternGlowMasks(activeScene,now)').length-1,2,
  'engraved glow ignores both enclosed darkness and underground fog');
assert(/node\.name\s*===\s*['"]engraving-glyph-glow['"]/.test(fog),'glow pass uses real emissive glyphs');
assert(fog.includes('renderer.render(kanthicProxyScene,camera)'),'Kanthic emission is a world-depth draw, not a projected canvas light mask');
assert(connector.includes('routeTiles:route.tiles,showToast,onStateChange:onMechanismStateChange'),
  'existing shaft control callbacks reach the Kanthic lighting runtime');

const instrumented=fog.replace('  function ordinaryBuildingInterior(area) {',
  '  window.__probeRuinMasks=(lights,deps)=>{lightingDeps=deps;drawRuinTraditionLightMasks(lights);return {...ruinFireMaskStats};};\n  function ordinaryBuildingInterior(area) {'); // Test seam exposes only the production lighting function in a disposable VM.
assert.notEqual(instrumented,fog,'the test can instrument the shared compositor source');
const fakeWindow={THREE:{Vector3:Vec},WeatherFX:{init(){}},RuinMultifloorV50Style:style}; // Uses exactly the production mask renderer, not a copied drawing algorithm.
vm.runInNewContext(instrumented,{window:fakeWindow,performance:{now:()=>1000},console});
const maskDraws=[]; // Tracks actual canvas composite operations at the brazier source, without needing real WebGL on a phone.
const ctx={canvas:{width:1000,height:600},globalCompositeOperation:'source-over',
  createRadialGradient:(...args)=>({args,stops:[],addColorStop(fraction,color){this.stops.push([fraction,color]);}}),
  beginPath(){},arc(){},fill(){maskDraws.push({mode:this.globalCompositeOperation,stops:this.fillStyle.stops,args:this.fillStyle.args});}};
const camera={matrixWorld:{},near:.01,far:200,
  getWorldDirection(v){return v.set(1,0,0);},
  getWorldPosition(v){return v.set(-20,2,0);}};
const drawingDeps={lctx:ctx,TILE:1,player:{x:22,y:20},_isBuildingArea:()=>false,
  getCurrentArea:()=> 'map_i_dev_random_ruin',getPlayerWorldY:()=>0,getActiveScene:()=>({}),
  getThreeRect:()=>({width:1000,height:600}),camera,
  worldToOverlay:(x,y,z)=>({x:x*4+420,y:z*4+180})};
const source={x:10,y:1.4,z:10,floorY:0,radius:12,strength:.99,color:[255,130,50],active:false}; // An actual bright Kanthic brazier in front of the simulated camera.
assert.equal(fakeWindow.__probeRuinMasks([source],drawingDeps).drawn,0,'unlit fire produces no darkness cutout');
assert.equal(maskDraws.length,0,'unlit fire produces no canvas operations');
source.active=true;
const visibleResult=fakeWindow.__probeRuinMasks([source],drawingDeps);
assert.equal(visibleResult.drawn,1,'ignition submits a real local darkness-reveal operation');
assert(maskDraws.some(draw=>draw.mode==='destination-out'&&draw.stops[0][1].includes('0.99')),
  'actual compositor punches a nearly fully transparent center into black Kanthic darkness');
assert(maskDraws.some(draw=>draw.mode==='source-over'&&draw.stops[0][1].includes('255,130,50')),
  'the same active light renders a warm firelight halo');
assert.equal(fakeWindow.CloudForestFog.getDebugState().kanthicFirelight.drawn,1,
  'mobile darkness diagnostics report the actual projected/drawn light');
fakeWindow.__probeRuinMasks([source],drawingDeps);
assert.equal(fakeWindow.CloudForestFog.getDebugState().kanthicFirelight.drawn,2,
  'two independent fixture groups accumulate two darkness-cutout draws');
const above={...source,floorY:16,y:17.4};
maskDraws.length=0;
const beforeUpperStory=visibleResult.drawn+1; // The diagnostics count all masks in this instrumented redraw, even when the next source is culled.
assert.equal(fakeWindow.__probeRuinMasks([above],drawingDeps).drawn,beforeUpperStory,'a lit upper-story goal does not shine through lower floors');

// Real tagged brazier sources emit only near the player in Kanthic, regardless of their original room-wide radius.
let theme='kanthic';fakeWindow.DevRandomRuinLichThemes={activeTheme:()=>theme};
const tagged={...source,flameAnchor:{},roomBound:true};
function sampleBrazier(px,py=0){
  drawingDeps.player.x=px;drawingDeps.player.y=10;drawingDeps.getPlayerWorldY=()=>py;
  maskDraws.length=0;fakeWindow.__probeRuinMasks([tagged],drawingDeps);
  const reveal=maskDraws.find(d=>d.mode==='destination-out');
  return reveal?{alpha:Number(reveal.stops[0][1].match(/,([0-9.eE+-]+)\)$/)[1]),radius:reveal.args[5]}:null;
}
const near=sampleBrazier(10),middle=sampleBrazier(12),far=sampleBrazier(14);
assert(near&&middle&&near.alpha>middle.alpha&&middle.alpha>0,'strength fades smoothly across the approach');
assert.equal(far,null,'distant brazier casts no local light');
assert.equal(sampleBrazier(10,16),null,'different floors cannot light the player');
assert.equal(near.radius,middle.radius,'near fade changes intensity without jumping radius');
assert(near.alpha<=.72,'near light retains a modest maximum strength');
theme='hronal';assert(sampleBrazier(14).radius>near.radius,'other traditions retain original broad light');


const Plan=require('../docs/js/ruin-layer-plan.js'); // Real seed layouts cover four entrances, varying wing portals, and 3–5 shaft stories.
const Hub=require('../docs/js/shaft-hub.js'); // Reuses exactly the production CellGrid3D support checks, not the simplified fake geometry above.
for(let seed=1;seed<=100;seed++){
  const plan=Plan.compose({seed,anchorX:320,anchorZ:320,shaftSize:45,floorHeight:16,
    groundEntranceSide:['N','E','S','W'][seed%4],nativeV50:true});
  assert(plan.ok,'physical shaft plan generated');
  const portals=plan.floors.flatMap(f=>[...f.wings.map(w=>({floor:f.floor,side:w.side})),
    ...(f.nativePort?[{floor:f.floor,side:f.nativePort.side}]:[])]);
  const realHub=Hub.compose({seed,floors:plan.floorCount,chambers:false,wall:plan.options.shaftWall,
    shaft:plan.options.shaftSize,spacing:plan.options.floorHeight,traversal:plan.options.shaftTraversal,
    entranceSide:plan.options.groundEntranceSide,portals});
  assert(realHub.ok,'the real shaft geometry must pass its walkable route proofs');
  for(let floor=0;floor<realHub.options.floors;floor++){
    const cell=style.chooseHubBrazierCell(realHub,floor);
    assert(cell,'optional brazier has a supported, unblocked gallery cell on seed '+seed+' floor '+floor);
    assert(realHub.grid.canStand(cell[0],cell[1],floor*realHub.options.spacing),
      'the player can reach the actual optional-brazier location at its correct elevation');
  }
}

console.log('Kanthic shaft sconces, tower follow, progressive braziers, glyph darkness and teardown: PASS');

'use strict';
// node scripts/test-kanthic-shaft-firelight.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const style=require('../docs/js/ruin-multifloor-v50-style.js');
class Vec{
  constructor(x=0,y=0,z=0){this.set(x,y,z);}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
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
const grid={cols:55,rows:55,levels:51,levelToY:n=>n,colToX:n=>n,rowToZ:n=>n,
  isSolid:(c,r)=>c>=0&&r>=0&&c<55&&r<55&&(c<5||r<5||c>=50||r>=50),
  canStand:(c,r)=>c>=5&&r>=5&&c<50&&r<50}; // Hollow three-story, 45-wide octagonal-hub approximation.
const hub={grid,options:{wall:5,shaft:45,spacing:16,floors:3},
  obelisks:{pillars:[{id:tower.name,name:'A',story:0}]}};
const ruin={theme:'kanthic',localeRoot,shaftConnection:{},controls:[],
  shaftHubPlan:{floors:[{floor:0,y:0,wings:[{rooms:[{x:80,z:80,w:12,d:12}]}]}]}};
let playerY=0,notices=0; // The actual brazier control must check player's floor and provide feedback.
const cleanup=style.apply({rec:{scene},ruin,hub,seed:7,THREE,getPlayerY:()=>playerY,showToast:()=>{notices++;}});
const lights=style.lightSources(),sconces=lights.filter(l=>l.anchor);
const braziers=ruin.controls.filter(c=>c.kind==='kanthicShaftBrazier');
assert(sconces.length>=12,'giant sconces should occupy shaft walls, wings and towers');
assert.equal(braziers.length,3,'each shaft story has one optional brazier');
assert.equal(ruin.shaftConnection.kanthicSconces,sconces.length,'diagnostics report real sconce count');
assert.equal(ruin.shaftConnection.kanthicOptionalBraziers,3,'diagnostics report optional fires');
const wallSconces=sconces.filter(l=>l.anchor.name==='kanthic-wall-giant-sconce'
  &&l.anchor.position.x<55&&l.anchor.position.z<55); // Ignore outer-wing fixtures beyond the shaft.
assert(wallSconces.length>=10,'the shaft hub takes priority over smaller wing rooms');
assert(wallSconces.every(l=>[5.03,49.97].some(v=>
  Math.abs(l.anchor.position.x-v)<.09||Math.abs(l.anchor.position.z-v)<.09)),
  'sconces must be fixed on the visible inner wall, not embedded in masonry');
const moving=sconces.find(l=>l.anchor.parent===tower);
assert(moving,'moving obelisk has its own attached fire fixture');
const before=moving.x;tower.position.x+=2;cleanup.tick();
assert.equal(moving.x-before,2,'light follows the raised or rotating tower owner');
braziers.find(c=>c.floorY===16).onPress();
assert(!lights.some(l=>!l.anchor&&l.floorY===16&&l.active),'cannot ignite upstairs from downstairs');
braziers.find(c=>c.floorY===0).onPress();
assert(lights.some(l=>!l.anchor&&l.floorY===0&&l.active),'igniting a brazier activates its light pool');
assert.equal(notices,1,'ignition provides mobile feedback');
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
assert.equal(fog.split('drawRuinPatternGlowMasks(activeScene,now)').length-1,2,
  'engraved glow ignores both enclosed darkness and underground fog');
assert(fog.includes("node.name === 'engraving-glyph-glow'"),'glow pass uses real emissive glyphs');
assert(connector.includes('routeTiles:route.tiles,showToast,onStateChange:onMechanismStateChange'),
  'existing shaft control callbacks reach the Kanthic lighting runtime');
console.log('Kanthic shaft sconces, tower follow, progressive braziers, glyph darkness and teardown: PASS');

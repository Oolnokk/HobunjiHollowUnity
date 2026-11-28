'use strict';
// Executes the production bridge with a deterministic scene/physics fixture, not copied jug rules.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class V{
  constructor(x=0,y=0,z=0){this.set(x,y,z);}
  set(x,y,z){Object.assign(this,{x,y,z});return this;}
  copy(p){return this.set(p.x,p.y,p.z);}
  sub(p){return this.set(this.x-p.x,this.y-p.y,this.z-p.z);}
  multiplyScalar(n){return this.set(this.x*n,this.y*n,this.z*n);}
  length(){return Math.hypot(this.x,this.y,this.z);}
  lerp(p,t){return this.set(this.x+(p.x-this.x)*t,this.y+(p.y-this.y)*t,this.z+(p.z-this.z)*t);}
}
class Obj{
  constructor(){this.children=[];this.position=new V();this.rotation={};this.userData={};this.visible=true;}
  add(o){o.parent=this;this.children.push(o);}
  remove(o){o.parent=null;this.children=this.children.filter(c=>c!==o);}
  traverse(fn){fn(this);for(const child of this.children)child.traverse(fn);}
}
class Geometry{constructor(){this.attributes={};}setAttribute(k,v){this.attributes[k]=v;}dispose(){this.disposed=true;}}
class Attr{constructor(a){this.array=a;}setXYZ(i,x,y,z){this.array.set([x,y,z],i*3);}}
class Material{dispose(){this.disposed=true;}}
class Mesh extends Obj{constructor(g,m){super();this.geometry=g;this.material=m;}}
class Raycaster{
  set(start,d){this.start=start;this.d=d;}
  intersectObject(root){const y=root.testY;if(!Number.isFinite(y)||!this.d.y)return [];const distance=(y-this.start.y)/this.d.y;return distance>=0&&distance<=this.far?[{distance}]:[];}
}
const p={health:50,dodging:false},enemy={health:50},undead={health:50,isMinion:true},upper={health:50},outside={health:50};
let area='ruin',scene=new Obj(),held=true,water=true,wall=false,mouth=new V(.5,1,.5),floor=0,save=[],wet=[],plasm=[],heal=[],hurt=[],doused=0,accepted=0;
let aim=new V(0,-1,0); // Mutable direction exercises both vertical and angled reticle targeting.
const actors=[p,enemy,undead,upper,outside];
const position=a=>({area:a===outside?'farm':area,x:.5,z:.5,y:a===upper?3:floor});
const window={
  THREE:{Vector3:V,Raycaster,BufferGeometry:Geometry,BufferAttribute:Attr,PointsMaterial:Material,Points:Mesh,PlaneGeometry:Geometry,MeshBasicMaterial:Material,Mesh},
  PersistentGroundFire:{extinguishTile:t=>wet.push(t)},
  HarlyaoLichCombat:{clearPlasmTile:t=>plasm.push(t)},
  KnockbackCollisionImpact:{extinguishInWater:()=>doused++},
  ResourceSystem:{getEffectiveMax:()=>100,applyHealthRecovery:(a,n)=>heal.push([a,n])},
  DamageAuthority:{hit:(a,n,x,y,k,o)=>hurt.push([a,n,o])},
  RangedWeapons:{traceLiquidSegment(a,b){const y=wall?.7:floor;if(a.y>=y&&b.y<y)return {kind:wall?'solid-tile':floor?'floor':'ground',t:(a.y-y)/(a.y-b.y),y};return null;}},
};
const context=vm.createContext({window,console});
for(const file of ['adventuring-jug.js','adventuring-jug-world.js'])vm.runInContext(fs.readFileSync('docs/js/'+file,'utf8'),context);
const jug=window.AdventuringJug;
jug.init({tileSize:64,getPlayer:()=>p,getArea:()=>area,getScene:()=>scene,isHolding:()=>held,getMouth:()=>mouth,getAim:()=>aim,isWaterTile:()=>water,
  saveState:s=>save.push(s),actorsInArea:()=>actors,actorTile:position,actorArea:a=>position(a).area,dodgeSupportY:()=>floor,canEscape:()=>true});
assert(jug.use('jug_pour'),'ordinary source fills jug');
assert.equal(jug.debug().units,12);
assert.equal(jug.use('jug_pour'),false,'full refill is not a pour');
assert.equal(jug.debug().units,12);
water=false;
assert(jug.use('jug_pour'));
assert.equal(jug.debug().units,11);
assert.equal(wet.length,0,'no effect before droplet impact');
jug.update(.6);
assert.equal(wet.length,1);
assert.equal(wet[0].y,0);
jug.update(.6);assert.equal(wet.length,1,'impact resolves exactly once');
wall=true;
assert(jug.use('jug_pour'));jug.update(.6);assert.equal(wet.length,1,'solid obstruction blocks liquid from the floor behind it');
wall=false;
aim=new V(.95,-Math.sqrt(1-.95*.95),0);
assert(jug.use('jug_pour'));jug.update(1.2);
assert.equal(wet.at(-1).x,3,'Gravity-compensated pour reaches the distant tile selected by the reticle');
aim=new V(0,-1,0);
jug.restore(p,{liquid:'water',units:3});
const receiver=new Obj();receiver.testY=.8;scene.add(receiver);
const unregister=jug.registerReceptacle({root:receiver,area,accept:(l,n)=>{accepted+=n;return n;}});
assert(jug.use('jug_empty'));jug.update(.6);assert.equal(accepted,3);assert.equal(jug.debug().units,0);
unregister();scene.remove(receiver);
// A receiver removed after release cannot receive an old flight's contents.
jug.restore(p,{liquid:'water',units:2});scene.add(receiver);
const retire=jug.registerReceptacle({root:receiver,area,accept:(l,n)=>{accepted+=n;return n;}});
assert(jug.use('jug_empty'));retire();jug.update(.6);assert.equal(accepted,3);scene.remove(receiver);
jug.restore(p,{liquid:'water',units:1});held=false;p.dodging=true;
assert(jug.beginDodge(p));assert.equal(jug.beginDodge(p),false);assert.equal(doused,1);assert.equal(jug.debug().units,0);
assert(jug.dodgeProtected(p,area),'last unit protects complete roll');
jug.dodgeStep(p,32,32,96,32);assert(wet.some(t=>t.x===1));
p.dodging=false;jug.update(.01);assert(!jug.dodgeProtected(p,area));
held=true;const basin=new Obj();basin.userData.lifeTotemAuthoritativeLiquidMaterial=true;basin.testY=.8;scene.add(basin);
assert(jug.use('jug_pour'));assert.equal(jug.debug().liquid,'lifeWater');assert.equal(jug.debug().units,6);scene.remove(basin);
held=false;p.dodging=true;assert.equal(jug.beginDodge(p),false,'Life Water never powers belt dodge');p.dodging=false;held=true;
assert(jug.use('jug_pour'));jug.update(.6);assert(jug.isConsecrated({area,x:0,z:0,y:0}));assert.equal(plasm.length,1);
jug.update(0);jug.update(0);assert.equal(heal.length,0);
jug.update(1.1);assert.equal(heal.length,2);assert.equal(hurt.length,1);assert.equal(hurt[0][0],undead);assert.equal(hurt[0][2].noStagger,true);
assert(jug.escapeTarget(undead));assert(!jug.escapeTarget(enemy));
assert(!jug.isConsecrated({area,x:0,z:0,y:3}));assert(!jug.isConsecrated({area:'farm',x:0,z:0,y:0}));
jug.update(20);assert(!jug.isConsecrated({area,x:0,z:0,y:0}));
floor=3;mouth=new V(.5,4,.5);assert(jug.use('jug_pour'));jug.update(.6);assert(jug.isConsecrated({area,x:0,z:0,y:3}));assert(!jug.isConsecrated({area,x:0,z:0,y:0}));
assert(jug.use('jug_pour'));const before=wet.length;area='farm';scene=new Obj();jug.update(.6);assert.equal(wet.length,before,'area change cancels in-flight effects');
assert.equal(jug.debug().flights,0);assert.equal(jug.debug().activeConsecratedTiles,0);
console.log('PASS jug world bridge: sources, first impact, receiver, roll, life-water and scene ownership');

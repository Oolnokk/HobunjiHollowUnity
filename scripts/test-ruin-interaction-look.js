'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ruin = fs.readFileSync('docs/js/dev-random-ruin-interactions.js','utf8');
const ranged = fs.readFileSync('docs/js/combat/ranged-weapons.js','utf8');
function extract(source, name, end) {
  const start = source.indexOf('  function '+name+'(');
  const stop = source.indexOf('  function '+end+'(',start+1);
  assert(start>=0 && stop>start, 'missing production function '+name);
  return source.slice(start,stop);
}
class Vector3 {
  constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}
  clone(){return new Vector3(this.x,this.y,this.z);}
  addScaledVector(v,k){for(const a of ['x','y','z'])this[a]+=v[a]*k;return this;}
  lerp(v,k){for(const a of ['x','y','z'])this[a]+=(v[a]-this[a])*k;return this;}
}
class Box3 {
  constructor(min,max){this.min=min;this.max=max;this.isBox3=true;}
  containsBox(other){return ['x','y','z'].every(a=>this.min[a]<=other.min[a]&&this.max[a]>=other.max[a]);}
}
const THREE={Vector3,Box3};
let ray=null; // Same centered interaction ray that the real slab selector consumes.
const focusCandidates=new Function('interactionAimRay','AIM_EPSILON',
  extract(ranged,'segmentHitboxInterval','actorDebugHitbox')+extract(ranged,'focusCandidates','focusedHostile')+'return focusCandidates;')(()=>ray,1e-8);
const ambientLine=ruin.match(/const AMBIENT_KINDS = new Set\([^\n]+/)[0];
const window={RangedWeapons:{focusCandidates}};
const focusRows=new Function('window','THREE','ownerBox','placePromptAnchor',
  ambientLine+'\nlet focusDebug=null;\n'+extract(ruin,'focusRows','placePromptAnchor')+'return focusRows;')(
  window,THREE,owner=>owner.box,()=>{});
const object=(name,x,z)=>({name,uuid:name,box:new Box3(new Vector3(x-.25,0,z-.25),new Vector3(x+.25,2,z+.25))});
const row=(kind,x,z)=>({kind,key:kind,owner:object(kind,x,z)});
const doors=[row('transitdoor',0,2),row('v50nativetransitdoor',2,0)];
const brazier=row('ruinshafttravel',0,-2);
const checkpoint=row('ruincheckpointtravel',-2,0);
const chest=row('dungeonchest',2,2);
const exit={kind:'exit',key:'exit',owner:null,point:new Vector3(-2,0,-2)};
const rope={kind:'ropebrake',key:'ropebrake',owner:object('rope',0,0)};
const rows=[...doors,brazier,checkpoint,chest,exit,rope];
const pointAt=(x,z)=>{const len=Math.hypot(x,z);ray={origin:new Vector3(0,1,0),direction:new Vector3(x/len,0,z/len)};};
const kinds=()=>focusRows(rows).map(row=>row.kind).join(',');
assert.equal(kinds(),'ropebrake','no camera ray, no physical object interaction');
for(const [target,x,z] of [[doors[0],0,2],[doors[1],2,0],[brazier,0,-2],[checkpoint,-2,0],[chest,2,2],[exit,-2,-2]]){
  pointAt(x,z);
  assert.equal(kinds(),target.kind+',ropebrake','only the looked-at object and attached-rope controls are eligible');
}
pointAt(1,2);
assert.equal(kinds(),'ropebrake','nearby doors/braziers cannot claim off-ray inputs');
delete window.RangedWeapons;
assert.equal(kinds(),'ropebrake','missing focus API must fail closed, not fall back to proximity');
console.log('Ruin manual interaction camera-ray selection: PASS');

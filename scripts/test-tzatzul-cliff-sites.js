'use strict';
// Real spire planner + point-perch + scene disposal checks.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let disposed=0;
class Node{
 constructor(){this.children=[];this.parent=null;this.userData={};this.rotation={x:0,y:0,z:0};this.position={set(x,y,z){Object.assign(this,{x,y,z});},copy(v){Object.assign(this,{x:v.x,y:v.y,z:v.z});}};}
 add(n){this.children.push(n);n.parent=this;}remove(n){this.children=this.children.filter(x=>x!==n);n.parent=null;}
}
class G{dispose(){disposed++;}}
class M{constructor(opts){this.opts=opts;}dispose(){disposed++;}}
class Mesh extends Node{constructor(geo,mat){super();this.geometry=geo;this.material=mat;}}
const T={Group:Node,Mesh,MeshBasicMaterial:M,CylinderGeometry:G,CircleGeometry:G,TorusGeometry:G,DoubleSide:2};
const points=new Map(),shared={name:'cliff-cache',dispose(){throw Error('shared natural cliff material disposed');}};
const w={THREE:T,__farmLog(){},PerchSupport:{
 point:(id,x,y,worldY)=>({id,dimension:0,x,y,worldY}),
 register:(area,p)=>(points.set(area+':'+p.id,p),true),
 unregister:(area,id)=>points.delete(area+':'+id)},
 NaturalSurfaceMaterials:{naturalizeMesh(m,surface,mapping){assert.equal(surface,'cliffs');assert.equal(mapping,'world-stretch');m.material=shared;}},
};
vm.runInNewContext(fs.readFileSync('docs/js/tzatzul-cliff-sites.js','utf8'),{window:w,console,Map,Set,Math});
const api=w.TzatzulCliffSites;
const cliffs={cols:90,rows:60,routes:[{nodes:[{x:18,z:20,y:6},{x:55,z:20,y:7}]}],
 balconies:[
 {id:'a',x:18,z:20,y:6,normal:{x:1,z:0},depth:2,base:{y:2,footprint:[{c:18,r:20}]}},
 {id:'b',x:55,z:20,y:7,normal:{x:0,z:1},depth:2,base:{y:3,footprint:[{c:55,r:20}]}},
 {id:'bad',x:75,z:45,y:8,normal:{x:1,z:0},base:{footprint:[]}},
 ]};
const original=JSON.stringify(cliffs),planned=api.plan('map_northern_cliffs',cliffs);
assert.equal(planned.length,2);
assert(planned.every(s=>!s.climbable&&cliffs.balconies.every(b=>Math.hypot(s.x-b.x,s.z-b.z)>2.7)));
assert.equal(JSON.stringify(cliffs),original,'no navigation graph mutations');
assert.equal(api.plan('map_southern_cloud_forest',cliffs).length,0);
const firstScene=new Node(),args={scene:firstScene,network:cliffs,TILE:64};
const a=api.ensure('map_northern_cliffs',args);
assert.equal(a.length,2);assert.equal(points.size,2);assert.equal(firstScene.children.length,2);
assert.equal(a[0].support.x,a[0].site.x*64);
assert.equal(firstScene.children[0].userData.tzatzulNest.encounterReady,false);
assert(firstScene.children.every(root=>root.children.some(child=>child.name==='tzatzul-dark-cave-mouth')));
assert.strictEqual(api.ensure('map_northern_cliffs',args),a,'unchanged graph must not duplicate meshes');
const secondScene=new Node();
api.ensure('map_northern_cliffs',{scene:secondScene,network:cliffs,TILE:64});
assert.equal(firstScene.children.length,0);assert.equal(secondScene.children.length,2);
assert.equal(points.size,2);assert(disposed>0);
assert(api.releaseArea('map_northern_cliffs'));
assert.equal(secondScene.children.length,0);assert.equal(points.size,0);
const index=fs.readFileSync('docs/index.html','utf8');
assert(index.indexOf('tzatzul-cliff-sites.js')>=0&&index.indexOf('tzatzul-cliff-sites.js')<index.indexOf('tzatzul-flight-runtime.js'),
 'spires load before flight roost consumer');
console.log('Tzatzul inaccessible cliff-site selection, cave-mouth art, 0D point perches and disposal PASS.');

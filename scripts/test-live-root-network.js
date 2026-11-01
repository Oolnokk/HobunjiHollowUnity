'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context={};vm.createContext(context);vm.runInContext(fs.readFileSync('docs/js/live-root-network.js','utf8'),context);
const {routeGrid}=context.LiveRootNetwork; // Exercise the production corridor solver independently of rendering.
function fixture(cells){
  const lookup=new Map(),key=(x,y,z)=>x+','+y+','+z; // Real fields use this same cell identity.
  const nodes=cells.map(([x,y,z=0],id)=>{lookup.set(key(x,y,z),id);return {x,y,z,clearance:.04,point:{x,y,z,distanceTo(p){return Math.hypot(x-p.x,y-p.y,z-p.z);}}};});
  return {nodes,lookup,key};
}
const cells=[];for(let y=0;y<9;y++)for(let x=0;x<9;x++)if(x<3||x>5||y<3||y>5)cells.push([x,y]); // A real opening must remain empty when routes join opposite sides.
const ring=fixture(cells),start=ring.lookup.get('1,4,0'),end=ring.lookup.get('7,4,0'),route=routeGrid(ring,start,end);
assert(route.length>0);assert.equal(route[0],start);assert.equal(route[route.length-1],end);
for(let i=1;i<route.length;i++){const a=ring.nodes[route[i-1]],b=ring.nodes[route[i]];assert.equal(Math.abs(a.x-b.x)+Math.abs(a.y-b.y)+Math.abs(a.z-b.z),1,'routes must not cut diagonally through holes');}
assert.deepEqual(routeGrid(ring,start,end),route,'the same voxel field must yield deterministic paths');
const narrow=fixture([[0,0],[0,1],[0,2],[1,2],[2,2],[2,3],[2,4]]);assert.equal(routeGrid(narrow,0,6).length,7,'one-cell-wide detail corridors must retain their complete path');
const separate=fixture([[0,0],[0,1],[4,4]]);assert.equal(routeGrid(separate,0,2).length,0,'disconnected components cannot be filled across empty space');assert.deepEqual(Array.from(routeGrid(separate,1,1)),[1]);
console.log('Live root network: connected paths, retained openings, narrow detail corridors, deterministic routes and disconnected components passed.');

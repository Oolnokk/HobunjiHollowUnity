'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const editor=fs.readFileSync('docs/tools/live-root-growth/tool.js','utf8'); // Execute the floor adapter with the actual wilderness boulder generator.
const context={window:{}};vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/zone-terrain-features.js','utf8'),context);
vm.runInContext(editor.slice(editor.indexOf('  function ruinFloorShell('),editor.indexOf('  function ruinFloorMesh(')),context);
const cells=[];for(let r=1;r<25;r++)for(let c=1;c<29;c++)cells.push([c,r]); // A vast chamber plus its one-cell perimeter, matching the generated grid convention.
const meta={gridCols:30,gridRows:26,cellSize:.5,worldWidth:15,worldDepth:13,floorSurfaceY:.06,floorCells:cells};
const saved=JSON.stringify(meta);context.meta=meta;
const shell=vm.runInContext('ruinFloorShell(meta,"vast-floor")',context);
assert.equal(JSON.stringify(meta),saved,'the shared generated footprint must remain untouched');
assert.equal(shell.topTileCount,cells.length,'every real floor cell must still be covered');
assert(shell.componentCount>20&&shell.componentCount<cells.length/8,'use giant multi-cell stones rather than brick-sized pieces');
assert.equal(shell.yScale,.25);
for(let i=0;i<shell.pos.length;i+=3){assert(Number.isFinite(shell.pos[i]));assert(shell.pos[i]>=-7&&shell.pos[i]<=7);assert(shell.pos[i+1]>=-.061&&shell.pos[i+1]<.31);assert(shell.pos[i+2]>=-6&&shell.pos[i+2]<=6);}
assert(Math.max(...shell.pos.filter((_,i)=>i%3===1))>.1,'flattened boulders retain their crown and visible thickness');
assert.deepEqual(vm.runInContext('ruinFloorShell(meta,"vast-floor").pos',context),shell.pos,'the same seed must reproduce all vertices');
assert.notDeepEqual(vm.runInContext('ruinFloorShell(meta,"other-floor").pos',context),shell.pos,'seeds must vary the large stone joints');
context.meta={...meta,floorCells:[[500,0]]};assert.throws(()=>vm.runInContext('ruinFloorShell(meta,"bad")',context),/invalid cell/);
context.meta={...meta,cellSize:NaN};assert.throws(()=>vm.runInContext('ruinFloorShell(meta,"bad")',context),/valid floor footprint/);
console.log('Root preview stone floor: real wilderness shells, giant staggered stones, quarter-height crowns, exact floor coverage, deterministic seeds and immutable metadata passed.');

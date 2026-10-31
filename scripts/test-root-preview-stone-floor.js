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
context.shell=shell;const layout=vm.runInContext('ruinFloorTileLayout(shell,meta.floorSurfaceY)',context);
assert.equal(layout.scale,.25);assert.equal(layout.offsets.length,16);
const width=(layout.maxX-layout.minX)*layout.scale,depth=(layout.maxZ-layout.minZ)*layout.scale;
for(let row=0;row<4;row++)for(let col=0;col<4;col++){
  const offset=layout.offsets[row*4+col];
  assert(Math.abs(layout.minX*layout.scale+offset[0]-(layout.minX+col*width))<1e-10,'quarter-scale tiles must meet without horizontal gaps');
  assert(Math.abs(layout.minZ*layout.scale+offset[2]-(layout.minZ+row*depth))<1e-10,'quarter-scale tiles must meet without depth gaps');
  assert(Math.abs(meta.floorSurfaceY*layout.scale+offset[1]-meta.floorSurfaceY)<1e-10,'uniform floor scaling must retain the original height datum');
}
assert(Math.abs(layout.maxX*layout.scale+layout.offsets[15][0]-layout.maxX)<1e-10);
assert(Math.abs(layout.maxZ*layout.scale+layout.offsets[15][2]-layout.maxZ)<1e-10);
const sourceRelief=Math.max(...shell.pos.filter((_,i)=>i%3===1))-Math.min(...shell.pos.filter((_,i)=>i%3===1));
assert(sourceRelief*.25<.1,'the repeated relief must be a quarter of the current floor variation');

assert.equal(shell.pieceIds.length,shell.pos.length/3);
assert.equal(new Set(shell.pieceIds).size,shell.componentCount,'every wilderness rock retains an independent texture identity');
for(let i=0;i<shell.idx.length;i+=3)assert(shell.pieceIds[shell.idx[i]]===shell.pieceIds[shell.idx[i+1]]&&shell.pieceIds[shell.idx[i]]===shell.pieceIds[shell.idx[i+2]],'each triangle belongs to exactly one floor rock');
for(let i=0;i<shell.pos.length;i+=3){assert(Number.isFinite(shell.pos[i]));assert(shell.pos[i]>=-7&&shell.pos[i]<=7);assert(shell.pos[i+1]>=-.061&&shell.pos[i+1]<.31);assert(shell.pos[i+2]>=-6&&shell.pos[i+2]<=6);}
assert(Math.max(...shell.pos.filter((_,i)=>i%3===1))>.1,'flattened boulders retain their crown and visible thickness');
assert.deepEqual(vm.runInContext('ruinFloorShell(meta,"vast-floor").pos',context),shell.pos,'the same seed must reproduce all vertices');
assert.notDeepEqual(vm.runInContext('ruinFloorShell(meta,"other-floor").pos',context),shell.pos,'seeds must vary the large stone joints');
const compactIndices=vm.runInContext('compactFloorStoneIndices(shell.idx)',context);
assert.equal(compactIndices.length,shell.idx.length/4,'quarter-scale rendering should retain one quarter of the original floor triangles');
for(let i=0;i<compactIndices.length;i+=3){const [a,b,c]=compactIndices.slice(i,i+3);assert(a<shell.pieceIds.length&&b<shell.pieceIds.length&&c<shell.pieceIds.length);assert(shell.pieceIds[a]===shell.pieceIds[b]&&shell.pieceIds[a]===shell.pieceIds[c]);}
const testPoints=[];for(let strand=0;strand<2;strand++)for(let ring=0;ring<=20;ring++)for(let spoke=0;spoke<6;spoke++){
  const angle=(spoke%5)*Math.PI*2/5,x=strand?Math.min(.2,ring*.02):ring*.02,z=strand?Math.max(0,(ring-10)*.02):Math.sin(ring*.4)*.015;
  testPoints.push(x+Math.cos(angle)*.02,Math.sin(angle)*.02,z);
}
context.positions={count:testPoints.length/3,getX:i=>testPoints[i*3],getY:i=>testPoints[i*3+1],getZ:i=>testPoints[i*3+2]};context.uvs={getY:i=>(Math.floor(i/6)%21)/20};
const simplified=vm.runInContext('floorStrandRingIndices(positions,uvs)',context);
assert.deepEqual(Array.from(simplified[0]),[0,20],'almost straight repeated strands can use a single complete tube section');
assert(simplified[1].includes(31),'centerline simplification must retain a real right-angle bend');assert.equal(simplified[1][0],21);assert.equal(simplified[1].at(-1),41);
context.meta={...meta,floorCells:[[500,0]]};assert.throws(()=>vm.runInContext('ruinFloorShell(meta,"bad")',context),/invalid cell/);
context.meta={...meta,cellSize:NaN};assert.throws(()=>vm.runInContext('ruinFloorShell(meta,"bad")',context),/valid floor footprint/);
console.log('Root preview stone floor: real wilderness shells, independent stone textures, quarter-scale 4x4 tiling, quarter-height relief, seam-free bounds, deterministic seeds and immutable metadata passed.');

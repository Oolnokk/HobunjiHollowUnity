'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const read=path=>fs.readFileSync(path,'utf8');
const shared=read('docs/js/stone-age-ruin-scenery.js');
const terrain=read('docs/js/zone-terrain-features.js');
const runtime=read('docs/js/dev-random-ruin-interior-map.js');
const bootstrap=read('docs/js/dev-random-ruin-bootstrap.js');
const preview=read('docs/tools/live-root-growth/tool.js');
const previewHtml=read('docs/tools/live-root-growth/index.html');
const temple=JSON.parse(read('docs/config/pieces/temple.json'));
new vm.Script(shared,{filename:'stone-age-ruin-scenery.js'});
new vm.Script(runtime,{filename:'dev-random-ruin-interior-map.js'});
const ctx={window:{THREE:{}},console};
vm.createContext(ctx);
vm.runInContext(terrain,ctx,{filename:'zone-terrain-features.js'});
const wilderness=ctx.window.ZoneTerrainFeatures;
wilderness.init=()=>{throw new Error('Ruin generation must never initialize wilderness dependencies.');}; // Standalone preview starts without a terrain scene or init call.
vm.runInContext(shared,ctx,{filename:'stone-age-ruin-scenery.js'});
const scenery=ctx.window.StoneAgeRuinScenery;
const layers=temple.surfaceGrowth.filter(layer=>layer.kind==='roots'||layer.kind==='vines');
const recipes=scenery.coverRecipes(layers,'#24211d');
assert(recipes.length>=layers.length+2,'wall/floor vegetation recipes must derive from actual Temple layers');
assert(recipes.some(layer=>layer.target==='floors'&&layer.kind==='roots'),'rooted floor coverage is required');
assert(recipes.some(layer=>layer.target==='floors'&&layer.kind==='vines'),'floor vines are required');
assert(recipes.filter(layer=>layer.kind==='roots').every(layer=>layer.color==='#24211d'),'saved root finish must be applied');
assert(recipes.filter(layer=>layer.kind==='roots').every(layer=>layer.radiusScaleMin===.6&&layer.radiusScaleMax===1.5),'root thickness variation must be 60–150%');
const cells=[];for(let r=1;r<13;r++)for(let c=1;c<17;c++)cells.push([c,r]);
const meta={gridCols:18,gridRows:14,cellSize:.5,worldWidth:9,worldDepth:7,floorSurfaceY:.06,floorCells:cells};
const source=JSON.stringify(meta);
const floor=scenery.ruinFloorShell(meta,'game-stoneage-seed');
assert.equal(JSON.stringify(meta),source,'do not modify the V50 floor footprint');
assert.equal(floor.topTileCount,cells.length,'every real floor cell must be represented');
assert(Math.min(...floor.pos.filter((_,i)=>i%3===1))<.1,'boulder elevations must use the private zero-level override');
assert(floor.componentCount>3);
const tiles=scenery.ruinFloorTileLayout(floor,meta.floorSurfaceY);
assert.equal(tiles.scale,.25);
assert.equal(tiles.offsets.length,16);

const walkable=new Set(); // Exercises disconnected chambers, a single-cell bridge, a hole, and registered sunken/raised levels.
for(let r=1;r<=5;r++)for(let c=1;c<=7;c++)if(!(r===3&&c===4))walkable.add(c+','+r);
for(let r=7;r<=9;r++)for(let c=10;c<=15;c++)walkable.add(c+','+r);
for(let c=7;c<=10;c++)walkable.add(c+',6');
const oddCells=[...walkable].map(key=>key.split(',').map(Number));
const heightMap=new Map(oddCells.map(([c,r])=>[c+','+r,r===4&&c<7?-1.2:r>=7?.84:0]));
const irregular={gridCols:17,gridRows:11,cellSize:.5,worldWidth:8.5,worldDepth:5.5,
  floorSurfaceY:0,floorCells:oddCells,rooms:[{col:1,row:1,w:7,h:5},{col:10,row:7,w:6,h:3}],
  hallways:[{col:7,row:6,w:4,h:1}],plateauModel:{stepHeight:.42,regions:[]}};
const irregularSnapshot=JSON.stringify(irregular),heightsSnapshot=JSON.stringify([...heightMap]);
const cellFloor=scenery.ruinMappedFloorShell(irregular,'multichamber',heightMap); // The runtime's sampled V50 top elevations override fallback metadata.
assert.equal(cellFloor.topTileCount,oddCells.length,'all and only native floor cells must receive stone');
assert.equal(cellFloor.floorCells,oddCells.length);
assert.equal(cellFloor.voidCells,irregular.gridCols*irregular.gridRows-oddCells.length);
assert.equal(cellFloor.levelCount,3,'sunken room, ordinary corridor and raised room must remain separate elevations');
assert.equal(cellFloor.featureScale,.25);assert.equal(cellFloor.reliefScale,.0625);
assert(cellFloor.componentCount<oddCells.length,'stones must form irregular joined shapes rather than one brick per cell');
const mappedPositions=cellFloor.pos,mappedIndices=cellFloor.idx;
for(let index=0;index<mappedIndices.length;index+=3){
  const ids=mappedIndices.slice(index,index+3);
  const x=ids.reduce((sum,id)=>sum+mappedPositions[id*3],0)/3;
  const z=ids.reduce((sum,id)=>sum+mappedPositions[id*3+2],0)/3;
  const col=Math.floor((x+irregular.worldWidth/2)/irregular.cellSize);
  const row=Math.floor((z+irregular.worldDepth/2)/irregular.cellSize);
  assert(walkable.has(col+','+row),'a stone triangle must not cross a hole, disconnected room, or outside the hallway');
  const expectedY=heightMap.get(col+','+row);
  const y=ids.reduce((sum,id)=>sum+mappedPositions[id*3+1],0)/3;
  assert(Math.abs(y-expectedY)<.07,'stone geometry must stay on its own native elevation, not stretch across levels');
}
const alternate=scenery.ruinMappedFloorShell(irregular,'multichamber',heightMap);
assert.deepEqual(Array.from(alternate.pos),Array.from(cellFloor.pos),'the exact same seed/levels must reproduce all stones');
assert.equal(JSON.stringify(irregular),irregularSnapshot,'geometry generation must not modify the V50 layout');
assert.equal(JSON.stringify([...heightMap]),heightsSnapshot,'geometry generation must not modify sampled collision heights');
const untouched=scenery.ruinMappedFloorShell(irregular,'multichamber');
assert.notDeepEqual(Array.from(untouched.pos),Array.from(cellFloor.pos),'runtime elevation overrides must affect the visible floor');
assert.throws(()=>scenery.ruinMappedFloorShell({...irregular,floorCells:[...oddCells,[4,3]]},'bad'),/invalid or duplicate cell/);

assert(bootstrap.indexOf('stone-age-ruin-scenery.js')<bootstrap.indexOf('dev-random-ruin-interior-map.js'),'gameplay adapter must load after shared scenery');
assert(previewHtml.includes('js/stone-age-ruin-scenery.js?v='),'preview must load the same source');
assert(preview.includes('=window.StoneAgeRuinScenery'),'preview uses the same geometry factory');
assert(runtime.includes("pieceSet:'stoneAge',floorProps:'pillarsOnly'"),'Stone Age ruins must retain native V50 placement and pieces');
assert(!runtime.includes("singleRoom:true,roomPreset:'veryLarge'"),'Stone Age mode must not force the author preview single-room layout');
assert(runtime.includes('floorHeights});'),'Stone Age runtime must pass registered multi-level floor heights to scenery');
assert(runtime.includes('await prepareStoneAgeScenery(ruin)'),'Stone Age environment must be built before entering gameplay');
assert(runtime.includes('await ensureStoneAgeSceneryDependencies()'),'Rock authoring dependencies must load in playable mode');
assert(runtime.includes('js/natural-surface-materials.js?v=') && runtime.includes('js/surface-stretch-uv-furniture.js?v='),'The playable page must lazy-load the preview stone material and UV mapper');
assert(!read('docs/index.html').includes('src="js/natural-surface-materials.js'),'Harlyao worlds should not eagerly install additional natural-surface hooks');
assert(runtime.includes('stoneAgeScenery?.cover?.dispose()')&&runtime.includes('stoneAgeScenery?.dispose()'),'clear/retry must restore V50 sources and release scenery buffers');
assert(runtime.includes('rootMechanisms:selected,stoneAge:selected'),'the existing checkbox must enable the complete ruin type');
assert(shared.includes('item.mesh.layers.disable(0)')&&shared.includes('item.mesh.layers.mask=item.layerMask'),'native wall rendering must be suppressed without disabling SolidFootprints collision');
assert(!shared.includes('item.mesh.visible=false'),'hidden meshes are non-solid in the runtime footprint scanner');
assert(runtime.includes('replaced.has(occlusion[i])'),'camera occlusion must remove the masked source walls explicitly');
assert(runtime.includes('stoneAgeStats:ruin.stoneAgeStats||null'),'mobile debug must expose stone, floor and root counts');
console.log('Stone Age playable integration: shared preview/game geometry, genuine Temple cover, isolated terrain deps, multiroom V50 type opt-in, teardown and diagnostics passed.');

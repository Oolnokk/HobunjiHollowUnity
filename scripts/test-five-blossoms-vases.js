#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Validate real authored festival layouts, temple swatches, foliage recipe and disposal.
const fs = require('node:fs'); // Always read shipped map/furniture/modules rather than a copied test fixture.
const vm = require('node:vm'); // Test the production decoration entry point without WebGL.
const readJson = path => JSON.parse(fs.readFileSync(path,'utf8')); // One source for editor and game data.
const map = readJson('docs/config/maps/hobunji_hollow_town.map.json'); // The festival map owns the physical table positions.
const editor = readJson('docs/config/town-workspace-v1.json'); // Editor copy must match the canonical festival layout.
const festival = map.layouts.find(row => row.id === 'festival_five_blossoms'); // Exactly the Feast, not Gorkunash.
const editorFestival = editor.maps.find(row => row.id === map.id)?.layouts.find(row => row.id === festival.id); // Catch runtime/editor drift.
assert.deepEqual(editorFestival,festival,'editor and runtime keep the same vase placement variants');
const dining = festival.decor.find(row => row.id === 'five_blossoms_feast'); // One movable parent owns all tables and stools.
const tables = dining.festivalLocale.parts.filter(part => part.id.startsWith('table-')); // Visual dressing must attach to functional tables.
assert.equal(tables.length,6);
assert(tables.every(part => part.key === 'tableSmall' && part.festivalDecoration === 'blossoms' && part.showActivitySign === false),
  'all six ordinary dining tables get decorative foliage without an activity input');
assert.deepEqual(tables.map(part => part.blossomVariant),[0,1,2,3,4,0],'five distinct colors repeat only after the fifth table');
assert.equal(dining.festivalLocale.parts.filter(part=>part.key==='chairSimple').length,16,'the actual dining seats stay intact');

const temple = readJson('docs/config/maps/map_i_temple.json'); // Stained-glass overpass palette is authoritative.
const templeWindows = temple.furniture.map(row => row.patternOverrides?.crossbar_window_pane?.[0]).filter(p => p?.overpassPatternId?.startsWith('blessed_blossom_')); // Includes both differently colored Balance windows.
assert.equal(templeWindows.length,5,'temple supplies five window colors, including both Balance variants');
const templeSwatches = templeWindows.map(p=>({pattern:p.overpassPatternId,color:p.palette[2].toLowerCase()})); // Third palette slot is the bright blossom motif accent.
assert.equal(new Set(templeSwatches.map(p=>p.color)).size,5,'all five accent colors differ');

const vase = readJson('docs/config/furniture-authored/festivalBlossoms.json'); // Shared authored pottery cup remains a genuine editable furniture assembly.
assert.equal(vase.parts.length,1,'retired rigid petal discs are removed, not hidden behind generated foliage');
assert.equal(vase.parts[0].id,'blossom-vase');
assert.equal(vase.parts[0].kind,'cup');
assert.equal(vase.parts[0].materialRole,'pottery');
const smallTable = readJson('docs/config/furniture-authored/tableSmall.json'); // Pottery bottom and table top must coincide.
const tabletop = Math.max(...smallTable.parts.filter(p=>p.kind==='box' && p.transform.sy < 0.2).map(p=>p.transform.y+p.transform.sy/2)); // Use actual authored slab, not a guessed tile height.
assert(Math.abs((vase.parts[0].transform.y-vase.parts[0].transform.sy/2)-tabletop)<0.03,
  'vase base rests flush on the small table surface, not hovering');
const tintableCard=fs.readFileSync('docs/assets/leaves/leaf_festival_blossom.svg','utf8'); // One neutral texture multiplies to all five exact window hues.
assert(tintableCard.includes('fill="#f5f5f5"') && tintableCard.includes('xmlns="http://www.w3.org/2000/svg"'),
  'neutral alpha-cutout leaf art is white, not the green wilderness card');
const foliageSource=fs.readFileSync('docs/js/foliage-generator.js','utf8');
assert(foliageSource.includes("leafTexture:'assets/leaves/leaf_festival_blossom.svg'"),
  'tabletop preset uses the neutral blossom card');

const requested=[]; // The specific changed vase JSON gets a fresh query, unlike unchanged furniture.
const authoredContext={window:{},THREE:{Matrix4:class {},Vector3:class {},Quaternion:class {}},fetch:url=>{requested.push(url);return Promise.resolve({ok:false});}}; // Loader allocates reusable transform scratch objects at module initialization.
vm.runInNewContext(fs.readFileSync('docs/js/authored-furniture-runtime.js','utf8'),authoredContext);
authoredContext.window.AuthoredFurniture.load('festivalBlossoms');
authoredContext.window.AuthoredFurniture.load('tableSmall');
assert.deepEqual(requested,[
  'config/furniture-authored/festivalBlossoms.json?v=20261118blossomVases1',
  'config/furniture-authored/tableSmall.json'
],'new vase data is fresh while ordinary furniture keeps its existing caching policy');

const foliageGlobal = {THREE:{}}; // The generator presets/API are lazy; geometry is only made after THREE initializes in the game.
vm.runInNewContext(fs.readFileSync('docs/js/foliage-generator.js','utf8'),{window:foliageGlobal,console});
const foliage = foliageGlobal.FoliageGenerator, recipe = foliage.pottedBlossomRecipe; // Inspect the exact recipe returned by the production API.
assert.equal(typeof foliage.buildPottedBlossomTreeMesh,'function');
assert.equal(recipe.knotTiers,1,'exactly one rung of branches');
assert.equal(recipe.knotCount,5,'five individual branch stems on that rung');
assert.equal(recipe.rootsEnabled,false,'tiny trees do not grow roots through a table');
assert.equal(recipe.barkColorHex,0x4b9a62,'branches/trunk are bright green wood');
assert(recipe.trunkLength<=0.75 && recipe.knotLength<=0.4,'canopy is miniature, not a scaled-down forest giant');
assert(recipe.variantCount<=2,'one or two reusable generated silhouettes per color is inexpensive');

let disposedAuthored=0,disposedFoliage=0; // Count ownership boundaries when a festival scene is torn down.
class Group {
  constructor(){this.children=[];this.userData={};this.position={x:0,y:0,z:0};this.name='';}
  add(child){this.children.push(child);child.parent=this;}
  traverse(visit){visit(this);for(const child of this.children)child.traverse(visit);}
}
class GeometryGroup extends Group {
  constructor(kind){
    super();this.kind=kind;this.geometry={dispose(){if(kind==='foliage')disposedFoliage++;else disposedAuthored++;}};
    this.material={dispose(){if(kind==='foliage')disposedFoliage++;else disposedAuthored++;}};
  }
}
const calls=[]; // Captures real generator calls with the source-table ID and the exact temple swatch.
const uiWindow={
  THREE:{Group},
  AuthoredFurniture:{
    peek:key=>key==='festivalBlossoms'?vase:null,
    buildGroup(data){assert.equal(data.parts.length,1);const root=new Group();root.add(new GeometryGroup('authored'));return root;}
  },
  FoliageGenerator:{buildPottedBlossomTreeMesh(seed,color){
    calls.push({seed,color});const tree=new Group();tree.add(new GeometryGroup('foliage'));return tree;
  }},
  FurnitureTableSystem:{refreshServices(){}}
}; // Minimal scene graph is enough for this real decorator: no canvas/UI or browser globals.
vm.runInNewContext(fs.readFileSync('docs/js/festival-props.js','utf8'),{window:uiWindow,console});
const props=uiWindow.FestivalProps,roots=[]; // Dispose each per-table root after inspecting its generated flower.
assert.deepEqual(Array.from(props.blossomWindowSwatches, row => ({pattern:row.pattern,color:row.color})),templeSwatches,
  'festival palette uses the exact overpass colors, not invented replacements');
for(const table of tables){
  const root=new Group();root.userData.fixture='dining-table';
  props.decorate(root,{...table,id:dining.id+':part:'+table.id});
  roots.push(root);
  assert.equal(root.userData.festivalBlossomVase.variant,table.blossomVariant);
  assert.equal(root.userData.festivalBlossomVase.source,'temple-window-overpass');
  const group=root.children.find(child=>child.name==='festival-dressing');
  const tree=group?.children.find(child=>child.name==='festival-blossom-sapling');
  assert(tree,'a generator-built tree actually appears above the authored pottery vase');
  assert.equal(tree.position.y,0.665,'green stem starts inside lowered vase, not on tabletop');
  assert(tree.children[0].userData.festivalSharedFoliage,'shared generator meshes have a nondisposal tag');
}
assert.deepEqual(calls.map(call=>call.color),['#00ffff','#ff8000','#ffffff','#ffbf00','#ffb3b3','#00ffff']);
for(const root of roots)props.dispose(root);
assert.equal(disposedFoliage,0,'a removed festival cannot destroy cached shared tree geometry/material used by other vases');
assert.equal(disposedAuthored,12,'the six vase meshes retain ordinary per-instance disposal of their geometry/material');
const seasonal=fs.readFileSync('docs/js/seasonal-vegetation-tint.js','utf8'); // The weather system must not repaint a deliberate stained-glass accent.
assert(seasonal.includes('material?.userData?.hobunjiFixedBlossomColor'),'seasonal recoloring skips fixed-color festival leaves');
const townScript=fs.readFileSync('docs/js/town-zone-buildings.js','utf8'); // Exercise the exact disposal loop used when town decor respawns.
const cleanupStart=townScript.indexOf('for (const mesh of _townDecorFurnitureGroups) {');
const cleanupEnd=townScript.indexOf('    _townDecorFurnitureGroups = [];',cleanupStart);
assert(cleanupStart!==-1 && cleanupEnd>cleanupStart,'town decor cleanup loop remains discoverable');
const extraRoot=new Group(); // A new town prop can be removed independently of FestivalProps.dispose.
extraRoot.add(new GeometryGroup('authored'));
const sharedTree=new GeometryGroup('foliage');sharedTree.userData.festivalSharedFoliage=true;extraRoot.add(sharedTree);
const beforeAuthored=disposedAuthored, beforeFoliage=disposedFoliage;
vm.runInNewContext(townScript.slice(cleanupStart,cleanupEnd),{
  _townDecorFurnitureGroups:[extraRoot],townScene:{remove(){}},
  window:{HobunjiWalkableElevation:{unregisterFurnitureRails(){}},FestivalProps:{dispose(){}}}
});
assert.equal(disposedAuthored,beforeAuthored+1,'town teardown releases table-local geometry');
assert.equal(disposedFoliage,beforeFoliage,'town teardown does not destroy reusable foliage geometry');

let resolvePending; // Deliberately resolve a decoration load only after its table has left the scene.
uiWindow.AuthoredFurniture.peek=()=>null;
uiWindow.AuthoredFurniture.load=()=>new Promise(resolve=>{resolvePending=resolve;});
const abandoned=new Group();props.decorate(abandoned,{...tables[0],id:'abandoned-table'});
props.dispose(abandoned);
resolvePending(vase);
Promise.resolve().then(()=>{
  assert.equal(abandoned.children.find(c=>c.name==='festival-dressing').children.length,0,
    'stale async vase loads cannot resurrect flowers after the festival ends');
  console.log('Five Blossoms vase geometry, five authentic temple swatches, single-rung foliage, six table placements, cached JSON and shared-material disposal passed.');
});

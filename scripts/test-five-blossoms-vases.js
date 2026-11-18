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
  'unaltered vase sits on the full-height procedural fallback tabletop');
const proportionSource=fs.readFileSync('docs/js/furniture-vessel-runtime.js','utf8'); // Original test missed this production height override.
const tableScale=Number(proportionSource.match(/const SURFACE_FURNITURE_Y_SCALE = ([0-9.]+)/)?.[1]); // Shares the engine's actual scale factor.
assert(tableScale>0&&tableScale<1 && proportionSource.includes("'tableSmall', 'tableLong'"),'tableSmall is shortened at runtime');
const runtimeTableParts=smallTable.parts.map(part=>({...part,transform:{...part.transform,y:part.transform.y*tableScale,sy:part.transform.sy*tableScale}})); // Same floor-rooted transform used to render the authored table.
const runtimeTop=tabletop*tableScale; // Actual world-space contact plane in table-local coordinates.
assert(fs.existsSync('docs/assets/leaves/leaf_1.png'),'blossoms reuse the real bush leaf PNG plane');
const mapEditorHtml=fs.readFileSync('docs/tools/map-editor/index.html','utf8'); // Editor previews must support the same natural-surface PNG fill as gameplay.
const standaloneFoliageHtml=fs.readFileSync('docs/tools/foliage-generator/index.html','utf8'); // Authoring preview must not load a stale cached generator.
const editorFoliageScript=mapEditorHtml.indexOf('../../js/foliage-generator.js?v=');
const editorNaturalConfig=mapEditorHtml.indexOf('../../config/natural-surface-materials.js?v=');
const editorNaturalMaterial=mapEditorHtml.indexOf('../../js/natural-surface-materials.js?v=');
const editorFestivalScript=mapEditorHtml.indexOf('../../js/festival-props.js?v=');
assert(editorFoliageScript>=0&&editorNaturalConfig>editorFoliageScript&&editorNaturalMaterial>editorNaturalConfig&&editorFestivalScript>editorNaturalMaterial,
  'Map Editor installs the canonical body-style PNG fill pipeline before creating feast vases');
const gameFoliageHtml=fs.readFileSync('docs/index.html','utf8'); // The shipped game owns the generator version against which editor versions are compared.
const liveGeneratorVersion=gameFoliageHtml.match(/js\/foliage-generator\.js\?v=([A-Za-z0-9_-]+)/)?.[1]; // Read the actual active token instead of pinning a test to a date-string.
const authorGeneratorVersion=standaloneFoliageHtml.match(/js\/foliage-generator\.js\?v=([A-Za-z0-9_-]+)/)?.[1];
const mapGeneratorVersion=mapEditorHtml.match(/js\/foliage-generator\.js\?v=([A-Za-z0-9_-]+)/)?.[1];
assert(liveGeneratorVersion&&authorGeneratorVersion===liveGeneratorVersion&&mapGeneratorVersion===liveGeneratorVersion,
  'game, Map Editor and foliage author load one matching flower-generator version');
const foliageSource=fs.readFileSync('docs/js/foliage-generator.js','utf8');
assert(foliageSource.includes("leafTexture:'assets/leaves/leaf_1.png'"),
  'blossom preset uses bush leaf art, not a white SVG replacement');

const requested=[]; // The specific changed vase JSON gets a fresh query, unlike unchanged furniture.
const authoredContext={window:{},THREE:{Matrix4:class {},Vector3:class {},Quaternion:class {}},fetch:url=>{requested.push(url);return Promise.resolve({ok:false});}}; // Loader allocates reusable transform scratch objects at module initialization.
vm.runInNewContext(fs.readFileSync('docs/js/authored-furniture-runtime.js','utf8'),authoredContext);
authoredContext.window.AuthoredFurniture.load('festivalBlossoms');
authoredContext.window.AuthoredFurniture.load('tableSmall');
assert.equal(requested.length,2,'one fetch per requested furniture type');
assert.match(requested[0],/^config\/furniture-authored\/festivalBlossoms\.json\?v=[A-Za-z0-9_-]+$/,
  'new vase data has an asset revision without pinning a particular version');
assert.equal(requested[1],'config/furniture-authored/tableSmall.json',
  'ordinary furniture keeps the existing unversioned caching policy');

const foliageGlobal = {THREE:{}}; // The generator presets/API are lazy; geometry is only made after THREE initializes in the game.
vm.runInNewContext(fs.readFileSync('docs/js/foliage-generator.js','utf8'),{window:foliageGlobal,console});
const foliage = foliageGlobal.FoliageGenerator, recipe = foliage.pottedBlossomRecipe; // Inspect the exact recipe returned by the production API.
assert.equal(typeof foliage.buildPottedBlossomTreeMesh,'function');
assert.equal(recipe.knotTiers,1,'exactly one rung of branches');
assert.equal(recipe.knotCount,5,'five individual branch stems on that rung');
assert.equal(recipe.rootsEnabled,false,'tiny trees do not grow roots through a table');
assert.equal(recipe.barkColorHex,0x4b9a62,'branches/trunk are bright green wood');
assert(recipe.trunkLength<=0.75 && recipe.knotLength<=0.4,'one-rung bloom geometry stays miniature');
assert.equal(recipe.scaleMul,0.25,'flowers are uniformly quarter-scale');
assert.equal(recipe.pottedBlossomFinish,true,'only festival flowers opt into the new PNG fill');
assert(recipe.variantCount<=2,'one or two reusable generated silhouettes per color is inexpensive');

const foliageMaterialStart=foliageSource.indexOf('  function _leafDebugLog('); // Isolate the real foliage card material factory, not a reimplementation of its color math.
const foliageMaterialEnd=foliageSource.indexOf('  // ─── Needle placement',foliageMaterialStart); // Keep preview-specific geometry outside this lightweight check.
assert(foliageMaterialStart>0 && foliageMaterialEnd>foliageMaterialStart,'generator leaf material helpers remain identifiable');
const leafWindow={}; // Receives the live material helpers through the VM context.
class TintColor {constructor(value){this.value=value;}setHSL(h,s,l){this.value=[h,s,l];return this;}} // Verifies exact literal tint versus the wilderness's HSL conversion.
class TestTextureLoader {load(path){return {path};}} // Preserves source asset identity without needing DOM ImageLoader.
class TestLeafMaterial {constructor(options){Object.assign(this,options);}} // Inspects exactly what Three.js receives at construction.
const leafTHREE={Color:TintColor,TextureLoader:TestTextureLoader,MeshBasicMaterial:TestLeafMaterial,SRGBColorSpace:'srgb',NearestFilter:1,DoubleSide:2};
vm.runInNewContext(foliageSource.slice(foliageMaterialStart,foliageMaterialEnd)
  +'\nwindow.leafMaterialForTest=getLeafCardMaterial;',{
  T:leafTHREE,window:leafWindow,console:{log(){},error(){}}
});
const flowerMat=leafWindow.leafMaterialForTest({...recipe,leafColorHex:'#00ffff'});
assert.equal(flowerMat.color.value,'#00ffff','a bright cyan vase actually gets cyan material, not greenish HSL');
assert.equal(flowerMat.map.path,'assets/leaves/leaf_1.png','vase leaves keep the original bush PNG source');
assert.equal(flowerMat.userData.hobunjiFixedBlossomColor,true,'seasonal code can recognize the fixed flower pigment');
leafWindow.NaturalSurfaceMaterials={naturalizeMesh(){}}; // Production owns the final texture; no need to fetch a second raw leaf card.
const finalLeaf=leafWindow.leafMaterialForTest({...recipe,leafColorHex:'#ff8000'});
assert.equal(finalLeaf.map,null,'avoid duplicate leaf PNG fetches (and nested Map Editor 404s) when the body-filled card will replace the material');
assert.equal(finalLeaf.alphaTest,0.5,'preserve the petal alpha cutout state for the final PNG material');
assert.equal(finalLeaf.side,leafTHREE.DoubleSide,'festival petals remain visible from both sides');

const finishStart=foliageSource.indexOf('  function applyPottedBlossomFinish('); // Run the production PNG material hook, not a parallel mock implementation.
const finishEnd=foliageSource.indexOf('  function buildConiferTreeGroup(',finishStart);
assert(finishStart>0&&finishEnd>finishStart,'the new finish is independent from wilderness trees');
const finishCalls=[],finishWindow={NaturalSurfaceMaterials:{
  naturalizeMesh(mesh,surface,mapping,overrides){
    finishCalls.push({surface,mapping,...overrides});
    mesh.material={userData:{},map:{path:overrides.texture},color:'#ffffff'}; // Body fill bakes exact color pixels into a PNG with a white material.
  }
}}; // Spy on the animal-body PNG tint path.
vm.runInNewContext('const naturalSurfaces=null;' + String.fromCharCode(10) + foliageSource.slice(finishStart,finishEnd)
  + String.fromCharCode(10) + 'window.applyBlossomFinish=applyPottedBlossomFinish;', {
  window:finishWindow,_leafDebugLog(){},console
});
let retiredWood=0; // Temporary per-variant wood Lambert must be disposed after the material replacement.
const stem={material:{dispose(){retiredWood++;}},userData:{}},petals={material:{},userData:{}};
finishWindow.applyBlossomFinish(stem,{...recipe,leafColorHex:'#00ffff'},'wood');
finishWindow.applyBlossomFinish(petals,{...recipe,leafColorHex:'#00ffff'},'petals');
assert.deepEqual(finishCalls.map(call=>({surface:call.surface,mapping:call.mapping,texture:call.texture,tint:call.tint,tintTreatment:call.tintTreatment})),[
  {surface:'trunks',mapping:'cylindrical-stretch',texture:'assets/textures/carved_smooth.png',tint:'#4b9a62',tintTreatment:'body-sprite-tint'},
  {surface:'vines',mapping:'strand-stretch',texture:'assets/leaves/leaf_1.png',tint:'#00ffff',tintTreatment:'body-sprite-tint'},
], 'both stem and petals use the identical per-pixel body sprite fill operation');
assert.equal(retiredWood,1,'no discarded per-variant Lambert wood is retained');
assert.equal(petals.material.userData.hobunjiFixedBlossomColor,true,'festival hue is exempt from seasonal retinting');
assert.equal(stem.userData.festivalBlossomFinish.texture,'assets/textures/carved_smooth.png','stem texture is inspectable without devtools');

const wildMat=leafWindow.leafMaterialForTest({...recipe,leafTexture:'assets/leaves/leaf_1.png',leafColorHex:null,pottedBlossomFinish:false});
assert(!wildMat.userData?.hobunjiFixedBlossomColor,'normal wilderness leaves remain seasonally tinted');


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
  const root=new Group();root.userData.fixture='dining-table';root.userData.authoredFurnitureData={parts:runtimeTableParts}; // Mimic the real halved authored table, not source JSON dimensions.
  props.decorate(root,{...table,id:dining.id+':part:'+table.id});
  roots.push(root);
  assert.equal(root.userData.festivalBlossomVase.variant,table.blossomVariant);
  assert.equal(root.userData.festivalBlossomVase.source,'temple-window-overpass');
  const group=root.children.find(child=>child.name==='festival-dressing');
  const tree=group?.children.find(child=>child.name==='festival-blossom-sapling');
  assert(tree,'a generator-built tree actually appears above the authored pottery vase');
  const pot=vase.parts[0]; // Match the live authored cup's interior bottom, not a hardcoded decorative transform.
  const insertedY=pot.transform.y+pot.transform.sy*0.32; // A 25% bloom must project past the rim, not be hidden inside the full-size cup.
  assert.equal(tree.position.y,insertedY,'quarter-size blossom emerges above its vase rim');
  const bottom=pot.transform.y-pot.transform.sy/2+group.position.y;
  assert(Math.abs(bottom-runtimeTop)<1e-9,'actual authored tabletop touches the vase bottom, with no hovering');
  assert.equal(root.userData.festivalBlossomVase.alignment,'runtime-tabletop','mobile debug data confirms an aligned vase');
  assert.equal(root.userData.festivalBlossomVase.tabletopGap,0,'live contact gap is zero');
  assert(tree.children[0].userData.festivalSharedFoliage,'shared generator meshes have a nondisposal tag');
}
assert.deepEqual(calls.map(call=>call.color),['#00ffff','#ff8000','#ffffff','#ffbf00','#ffb3b3','#00ffff']);
const coldRoot=new Group(); // Reproduce a slow-loading host table that upgrades after its vase is already present.
props.decorate(coldRoot,{...tables[0],id:'cold-table'});
const coldGroup=coldRoot.children.find(child=>child.name==='festival-dressing');
assert.equal(coldGroup.position.y,0,'keep the original full-height fallback table alignment');
coldRoot.userData.authoredFurnitureData={parts:runtimeTableParts};
props.onAuthoredFurnitureReady(coldRoot);
assert(Math.abs((vase.parts[0].transform.y-vase.parts[0].transform.sy/2+coldGroup.position.y)-runtimeTop)<1e-9,
  'the asynchronous upgrade reattaches the pot to the half-height surface');
props.dispose(coldRoot);
for(const root of roots)props.dispose(root);
assert.equal(disposedFoliage,0,'a removed festival cannot destroy cached shared tree geometry/material used by other vases');
assert.equal(disposedAuthored,14,'all seven tested vase instances (including the upgrade test) dispose their local geometry/material');
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

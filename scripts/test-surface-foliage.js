'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
class EmptyGroup {
  constructor() { this.children=[];this.userData={};this.matrixWorld={clone:()=>({invert(){return this;}})}; }
  add(child){this.children.push(child);child.parent=this;return this;}
  remove(child){this.children=this.children.filter(value=>value!==child);child.parent=null;}
  traverse(callback){callback(this);for(const child of [...this.children])child.traverse(callback);}
  updateWorldMatrix(){}
}
const windowForTest = {THREE:{Group:EmptyGroup,Vector3:class {}}}; // Dependency-free empty-surface lifecycle; real triangles are also checked headlessly.
const generatorSource = fs.readFileSync('docs/js/foliage-generator.js','utf8'); // Checks that generated volumetric strands remain enrolled in the global shell pass.
vm.runInNewContext(generatorSource,{window:windowForTest});
const growthBuilder = generatorSource.slice(generatorSource.indexOf('function buildSurfaceGrowth('), generatorSource.indexOf('function applySurfaceGrowth(')); // Restricts outline checks to actual surface-grown tubes.
assert(growthBuilder.includes('function buildSurfaceGrowth('), 'Surface growth builder must be present');
assert.match(growthBuilder, /mesh\.geometry\.computeVertexNormals\(\);\s*mesh\.layers\.enable\(1\);[\s\S]*?group\.add\(mesh\);/, 'Merged root/vine tubes must enter the global inverted-shell layer');
assert(!growthBuilder.includes('mesh.userData.noOutline = true'), 'Surface-grown tubes must not opt out like flat leaf cards');
const api = windowForTest.FoliageGenerator; // Execute the production normalizer and lifecycle rather than mirroring source expressions.
const original = {kind:'roots',count:9999,length:-3,radius:Infinity,color:'not-a-color',target:'selected',targetIds:['chair',null,12]};
const normalized = api.normalizeSurfaceGrowth(original);
assert.equal(normalized.count,80);assert.equal(normalized.length,.05);assert.equal(normalized.radius,.025);
assert.equal(normalized.color,'#4a3b33');assert.equal(normalized.texture,'assets/textures/wibbly_surface.png');assert.deepEqual(Array.from(normalized.targetIds),['chair']);assert.equal(original.count,9999);
for(const bad of [null,undefined,[],42,'broken'])assert.equal(api.normalizeSurfaceGrowth(bad).kind,'vines');
assert.equal(api.normalizeSurfaceGrowth({target:'invented',count:NaN,length:Infinity,seed:'x'.repeat(999)}).target,'all');
assert.equal(api.normalizeSurfaceGrowth({seed:'x'.repeat(999)}).seed.length,128);
assert.equal(api.normalizeSurfaceGrowth({}).texture,'assets/textures/carved_smooth.png');

assert.equal(api.normalizeSurfaceGrowth({}).style,'natural','Old JSON without style must continue to use original wandering growth');
assert.equal(api.normalizeSurfaceGrowth({style:'cornerFill'}).style,'cornerFill');
assert.equal(api.normalizeSurfaceGrowth({style:'wrap',density:999}).density,1);
assert.equal(api.normalizeSurfaceGrowth({style:'wrap',density:-99}).density,.05);
assert.equal(api.normalizeSurfaceGrowth({style:'wrap',density:NaN}).density,.45);
assert.equal(api.normalizeSurfaceGrowth({style:'unknown'}).style,'natural');
const roundTrip=JSON.parse(JSON.stringify(api.normalizeSurfaceGrowth({kind:'roots',style:'wrap',density:.75,seed:'saved-wall'})));
assert.equal(api.normalizeSurfaceGrowth(roundTrip).density,.75);
assert.equal(api.normalizeSurfaceGrowth(roundTrip).style,'wrap');
assert.match(generatorSource,/function recognizeArchitecturalSurfaceRegions\(/,
  'Houses and interiors must recognize surface regions using face connectivity, not merely wall/gable tags');
assert.match(generatorSource,/Number\(options\.splitAngleDeg\):24/,
  'Architectural recognition must use the Furniture Author default 24 degree split angle');
assert.match(generatorSource,/edge\.hiddenInternal=true/,
  'Interior gable/wall T-junction seams must not become artificial perimeter outlines');
const sourceOfStyles=generatorSource.slice(generatorSource.indexOf('function surfaceGuideEdges('),generatorSource.indexOf('function applySurfaceGrowth('));
assert.match(sourceOfStyles,/if\s*\(settings\.style==='cornerFill'\)appendCornerGrowth\(/,'Corner Fill must use true edge topology instead of normal face walks');
assert.match(sourceOfStyles,/function appendEdgeToEdgeWrap\(/,
  'Wrap must generate a surface-following path from one boundary edge to another');
assert.match(sourceOfStyles,/const reserved=\[\],ends=\[\]/,
  'Wrap must reserve beginning and ending anchor space along boundary edges');
assert.match(sourceOfStyles,/if\(!reached\|\|points\.length<3\)continue/,
  'Wrap must discard any path that does not reach a different actual boundary edge');
assert.match(sourceOfStyles,/settings\.style==='wrap'\?Math\.max\(1,Math\.round\(settings\.density\*settings\.strandLimit\)\)/,
  'Wrap density alone must determine the requested strand count under a safety limit');
assert.doesNotMatch(sourceOfStyles,/appendDenseCover\(|const occupancy=settings\.style==='wrap'/,
  'Wrap must not use an interior occupancy grid or cover the whole surface');
assert.equal(api.normalizeSurfaceGrowth({strandLimit:2,count:80,perSurface:true}).strandLimit,2);
assert.equal(api.normalizeSurfaceGrowth({strandLimit:2,count:80,perSurface:true}).perSurface,true);
assert.equal(api.normalizeSurfaceGrowth({strandLimit:999}).strandLimit,80);
assert.equal(api.normalizeSurfaceGrowth({inset:-.25,shrinkwrapFinal:true,tunnelAsOpening:true}).inset,-.25);
assert.equal(api.normalizeSurfaceGrowth({inset:-999}).inset,-.5);
assert.equal(api.normalizeSurfaceGrowth({inset:999}).inset,.5);
assert.equal(api.normalizeSurfaceGrowth({}).shrinkwrapFinal,false,'Old recipes preserve their unmodified surface geometry');
assert.equal(api.normalizeSurfaceGrowth({}).tunnelAsOpening,false,'Old architecture preserves tunnel growth until opted out');
assert(api.surfaceMaterialPalette().length>=6,'Wilderness bark and vine finishes should populate the shared material palette');
assert(api.surfaceMaterialPalette([{id:'custom',name:'Custom bark',color:'#123456',texture:'assets/textures/custom.png'}]).some(item=>item.id==='custom'),'Saved user finishes must be reusable alongside wilderness presets');
assert.equal(api.normalizeSurfaceGrowth({style:'natural'}).perSurface,false,'Legacy Natural preserves original full-mesh behavior');
assert.match(generatorSource,/function architecturalSurfaceSources\(/,'All architectural editors must use common exposed-surface source policy');
assert.match(generatorSource,/insideOtherSection\(/,'Recognition must clip triangles hidden within overlapping sections');
assert.match(sourceOfStyles,/end\.point\.distanceTo\(start\.point\)>=minSpan/,'Wrap endpoint pairs must have a minimum separation');
assert.match(sourceOfStyles,/if\(distance>settings\.length-travelled\+step\*\.5\)break/,'Wrap Length must constrain cumulative surface wandering');
assert.match(generatorSource,/function shrinkwrapSurfaceStrands\(/,'Optional shrinkwrap must deform generated rings onto populated geometry');
const cornerSource=sourceOfStyles.slice(sourceOfStyles.indexOf('function appendCornerGrowth('),sourceOfStyles.indexOf('function appendEdgeToEdgeWrap('));
assert.match(cornerSource,/const raw=sample\.point\.clone\(\)/,'Corner Fill must start each spline point on the exact architectural edge');
assert.match(cornerSource,/offset=settings\.offset\+settings\.inset\+\(part\.record\.renderLift\|\|0\)/,'Render clearance is added after edge alignment; no radius-sized gap');
assert.match(cornerSource,/if\(settings\.curl>0\)/,'Curl must be a separate cosmetic pass after tracing the edge');
assert.doesNotMatch(cornerSource,/settings\.radius\+settings\.offset|settings\.offset\+settings\.radius/,'Corner Fill centerline must not float a full radius off the seam');
const houseAuthorSource=fs.readFileSync('docs/tools/house-piece-author/index.html','utf8');
assert.match(houseAuthorSource,/architecturalSurfaceSources\(faces,\{wallLift:0,roofLift:\.16,tunnelAsOpening:mode\}\)/,
  'Unbricked House Editor wall previews must never offset edge-following roots by a masonry clearance');
assert.match(sourceOfStyles,/const correction=\(part\.otherPlane-n1\.dot\(raw\)\)\/denom/,
  'Gapped intersections must reproject the base spline onto both authoritative planes');
assert.match(sourceOfStyles,/Split at their real endpoints BEFORE classifying adjacent surfaces/,
  'T-junction wall planes must be split before corner edge classification');
const houseGenerator=fs.readFileSync('docs/js/HousePieceGen.js','utf8');
assert.match(generatorSource,/mesh\.userData\.surfaceFoliageRole==='roofs'/,'Roof planes must guide shingle Wrap instead of overlapping GLB triangles');
assert.match(houseGenerator,/applyAuthoredShingleFinish\(THREE,child,opts\.shingleMaterial\)/,
  'Both house generators must apply serialized shingle materials');
assert.match(houseAuthorSource,/id="roofFinishPalette"/,'House Editor must expose the reusable shingle material palette');
assert.match(houseAuthorSource,/id="roofFinishTexture"/,'House Editor must allow editing the shingle PNG path');
assert.match(houseAuthorSource,/id="roofFinishSave"/,'House Editor must save reusable tree/foliage and shingle finishes');
const authorSource=fs.readFileSync('docs/js/surface-foliage-authoring.js','utf8');
assert.match(authorSource,/data-count-label/,'Every editor must explain Wrap strand-budget behavior');
assert.match(authorSource,/\[data-wrap-controls\]'\)\.style\.display/,'Wrap-only controls must be hidden reliably even with flex-row editor CSS');
assert.match(authorSource,/value="cornerFill"/);
assert.match(authorSource,/value="wrap"/);
assert.match(authorSource,/data-field="density"/);
assert.match(authorSource,/updateStyleControls\(\)/);
new Function(generatorSource);
new Function(authorSource);

assert.equal(api.normalizeSurfaceGrowth({texture:'assets/textures/custom.png',color:'#123456'}).texture,'assets/textures/custom.png');
assert.equal(api.normalizeSurfaceGrowth({texture:''}).texture,'');
for(const texture of ['javascript:alert(1)','blob:temporary','file:///x.png','../private.png'])assert.equal(api.normalizeSurfaceGrowth({texture}).texture,'assets/textures/carved_smooth.png');
const embedded = 'data:image/png;base64,iVBORw0KGgo='; // Portable uploaded PNG reference must survive serialization without becoming an object URL.
assert.equal(api.normalizeSurfaceGrowth(JSON.parse(JSON.stringify({texture:embedded}))).texture,embedded);
windowForTest.NaturalSurfaceMaterials={surfaceDefaults:(surface)=>({texture:'assets/textures/configured.png',color:surface==='trunks'?'#504030':'#406040'})};
assert.equal(api.normalizeSurfaceGrowth({kind:'roots'}).color,'#504030');assert.equal(api.normalizeSurfaceGrowth({kind:'roots'}).texture,'assets/textures/configured.png');
assert.equal(api.normalizeSurfaceGrowth({kind:'vines',color:'#abcdef'}).color,'#abcdef');
delete windowForTest.NaturalSurfaceMaterials;
const parent = new EmptyGroup(), source = new EmptyGroup(), old = new EmptyGroup(), nested = new EmptyGroup(); // Only owned generated layers may be released on regeneration.
let disposedGeometry=0,disposedMaterial=0;
source.geometry={dispose:()=>{throw new Error('source geometry disposed');}};
old.userData.surfaceFoliage=true;nested.geometry={dispose:()=>disposedGeometry++};nested.material={dispose:()=>disposedMaterial++};old.add(nested);parent.add(source);parent.add(old);
const report = api.applySurfaceGrowth(parent,[{kind:'vines'}]);
assert.equal(disposedGeometry,1);assert.equal(disposedMaterial,1);assert(parent.children.includes(source));assert(!parent.children.includes(old));
assert(report.includes('No eligible surface triangles'));
assert.equal(parent.children.filter(child=>child.userData.surfaceFoliage).length,1);
api.applySurfaceGrowth(parent,Array.from({length:100},()=>({kind:'roots'})));
assert.equal(parent.children.filter(child=>child.userData.surfaceFoliage).length,32);
api.applySurfaceGrowth(parent,null);assert.deepEqual(parent.children,[source]);
console.log('Surface foliage input bounds, empty targets, deterministic recipe normalization and owned-layer disposal passed.');

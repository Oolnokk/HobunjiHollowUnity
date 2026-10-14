'use strict';
const assert = require('node:assert/strict'); // Tests tint isolation, shading, async texture loads, and owner refresh behavior.
const fs = require('node:fs'), vm = require('node:vm'); // Executes the actual material owners in a small browser context.
const values = new Map(), textureRequests = []; // Simulated persisted world and delayed texture responses.
let refreshed = 0, allowed = true; // Owner permission and live interior refresh evidence.
class Color {
  constructor(value=0xffffff) { this.value=value;this.isColor=true; }
  set(value) { this.value=value;return this; }
  clone() { return new Color(this.value); }
  copy(other) { this.value=other.value;return this; }
}
class Material {
  constructor(options={}) { this.color=new Color(options.color);this.userData={};this.map=null; }
  onBeforeCompile() {}
  customProgramCacheKey() { return ''; }
  clone() { const result=new Material();result.color=this.color.clone();result.map=this.map;result.userData={...this.userData};return result; }
}
class Group {
  constructor(){this.children=[];this.userData={};}
  add(child){this.children.push(child);child.parent=this;}
  traverse(fn){fn(this);for(const child of this.children) child.traverse ? child.traverse(fn) : fn(child);}
}
function mesh(material,role) { return {isMesh:true,userData:role?{farmMaterialRole:role}:{},material}; }
const THREE={Color,MeshLambertMaterial:Material,Group,RepeatWrapping:'repeat',TextureLoader:class {load(url,callback){textureRequests.push({url,callback});}}}; // Models Three.js's metadata-only shader clone behavior.
const context={console,THREE,RuntimeFrameScheduler:{register(){}},localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},setTimeout(){},
  ProceduralFurniture:{buildFurnitureGroup(){},CATALOG:{}},AuthoredFurniture:{load:()=>Promise.resolve({}),buildGroup(){}},
}; // Existing floor-style wrapper must forward farm colors without confusing them with floorStyle.
context.window=context;vm.createContext(context);
const load=file=>vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file}); // Loads production modules in their shipped order.
load('docs/config/farm-specializations.js');load('docs/js/surface-tint.js');load('docs/js/farm-world-settings.js');
load('docs/js/interior-scene-builder.js');load('docs/js/interior-fire-floor-runtime.js');
const settings=context.FarmWorldSettings, builder=context.InteriorSceneBuilder; // Actual authorities under test.
const palettes=context.FARM_SPECIALIZATIONS_CONFIG.palettes; // Select valid authored colors rather than inventing fixtures.
const initial={stone:palettes.stone[1][1],wood:palettes.wood[1][1]}; // World settings used by house and barn construction.
values.set('hobunjiSaveMeta',JSON.stringify({worlds:[{id:'farm',farmSettings:initial}]}));
const interior=new Group(); // Loaded scene updated immediately when owner changes colors.
settings.init({getPlayerData:()=>({worldId:'farm'}),isFarmOwner:()=>allowed,refreshInteriorColors(){refreshed++;settings.tintInterior(interior);}});
const floor=builder.buildFloorMaterial(THREE,'','assets/',null,settings.current()); // Fifth argument survives the existing authored floor-style wrapper.
assert.equal(floor.color.value,initial.wood,'wood fallback has the selected natural color before texture loads');
assert.equal(floor.userData.farmInteriorTintOwned,true);
assert.equal(floor.userData.hobunjiFloorStyleSignature,undefined,'farm colors are not parsed as an authored floorStyle');
interior.add(mesh(floor,'wood'));
const sourceBrick=new Material({color:'#333333'});sourceBrick.map={image:{width:64}}; // Shared GLB template must remain unchanged.
const wallBuilder={build(){const group=new Group();group.add(mesh(sourceBrick));group.add(mesh(sourceBrick));return group;}}; // Two wall instances share one source material.
const walls=builder.buildWallGroup(THREE,wallBuilder,[{id:'wall',width:3,height:2,position:[0,0,0]}],'',{farmNaturalColors:settings.current()});
interior.add(walls);
assert.notEqual(walls.children[0].material,sourceBrick,'farm walls isolate the shared GLB material');
assert.equal(walls.children[0].material,walls.children[1].material,'instances retain sharing inside this interior');
assert.equal(sourceBrick.color.value,'#333333');
assert.equal(sourceBrick.userData.surfaceTintTreatment,undefined);
assert.equal(walls.children[0].material.userData.surfaceTintColor.value,initial.stone);
const furniture=new Material({color:'#ff00ff'});interior.add(mesh(furniture)); // Furniture is outside the farm stone/wood policy.
const changed={stone:palettes.stone[2][1],wood:palettes.wood[2][1]}; // Owner changes colors before the board texture finishes loading.
assert.equal(settings.saveColors(changed).ok,true);assert.equal(refreshed,1);
assert.equal(walls.children[0].material.userData.surfaceTintColor.value,changed.stone);
assert.equal(furniture.color.value,'#ff00ff');
textureRequests.find(request=>request.url.endsWith('boards.png')).callback({repeat:{set(){}},image:{width:64}});
assert.equal(floor.userData.surfaceTintColor.value,changed.wood,'late boards callback uses current settings, never startup colors');
const shader={fragmentShader:'void main() {\n#include <map_fragment>\n}',uniforms:{}}; // Exercise the real shader patch instead of inspecting production source.
floor.onBeforeCompile(shader);
assert.equal(shader.uniforms.hobunjiSurfaceTint.value.value,changed.wood);
assert(shader.fragmentShader.includes('min(1.0, 0.7 + hobunjiLum * 0.8)'),'floor uses the same bounded wood brightness as exterior wood');
const brickShader={fragmentShader:'void main() {\n#include <map_fragment>\n}',uniforms:{}}; // Stone retains the farm stone luminance treatment.
walls.children[0].material.onBeforeCompile(brickShader);
assert.equal(brickShader.uniforms.hobunjiSurfaceTint.value.value,changed.stone);
const refreshedWall=walls.children[0].material; // Recoloring privately owned materials does not keep creating clones.
settings.tintInterior(interior);assert.equal(walls.children[0].material,refreshedWall);
const exterior=new Group();exterior.add(mesh(refreshedWall,'stone')); // Cloning metadata must reinstall the shader callback.
settings.tintStructure(exterior,initial);
const clonedShader={fragmentShader:'void main() {\n#include <map_fragment>\n}',uniforms:{}};
exterior.children[0].material.onBeforeCompile(clonedShader);
assert.equal(clonedShader.uniforms.hobunjiSurfaceTint.value.value,initial.stone);
assert.equal(refreshedWall.userData.surfaceTintColor.value,changed.stone,'cloned tint cannot mutate the interior uniform');
const nonFarm=builder.buildFloorMaterial(THREE,'','assets/'); // Ordinary town interiors preserve their existing defaults.
assert.equal(nonFarm.userData.farmMaterialRole,undefined);
const beforeRequests=textureRequests.length; // Cavern dirt remains untextured by the farm policy.
const cavern=builder.buildFloorMaterial(THREE,'cavern','assets/',null,initial);
assert.equal(cavern.userData.farmMaterialRole,undefined);assert.equal(textureRequests.length,beforeRequests);
allowed=false;assert.equal(settings.saveColors(initial).ok,false);assert.equal(refreshed,1);
console.log('Farm interior stone/wood color parity, shader isolation, delayed textures, cached scene refresh, and unrelated interiors passed.');

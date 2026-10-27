'use strict';
const assert=require('node:assert'),fs=require('node:fs'),vm=require('node:vm');
const temple=JSON.parse(fs.readFileSync('docs/config/maps/map_i_temple.json','utf8')),exterior=JSON.parse(fs.readFileSync('docs/config/pieces/temple.json','utf8')); // Verify the supplied authored recipe rather than a separate renderer preset.
const rootRecipe={kind:'roots',seed:'surface-1',count:68,length:6,radius:.15,offset:.008,curl:.4,color:'#4a3b33',texture:'assets/textures/wibbly_surface.png',target:'walls',targetIds:[]}; // The interior retains its earlier thick wall roots.
const shingleVines={kind:'vines',seed:'temple-highland-shingle-weave',count:56,length:3.4,radius:.04,offset:.006,curl:1.1,color:'#406040',texture:'assets/textures/carved_smooth.png',target:'shingles',targetIds:[]}; // Fine vines follow the exterior's real HighlandLongshingle surfaces, not the masonry.
const exteriorVines={kind:'vines',seed:'surface-1',count:16,length:12,radius:.1,offset:.008,curl:.4,color:'#406040',texture:'assets/textures/carved_smooth.png',target:'all',targetIds:[],wallOnly:false,hangChance:0,hangLength:0}; // Latest house-editor export replaces the exterior wall roots with long green vines.
assert.deepStrictEqual(temple.surfaceGrowth,[rootRecipe]);assert.deepStrictEqual(exterior.surfaceGrowth,[exteriorVines,shingleVines]);
const north=temple.furniture.find(record=>record.id==='fwall_mv74tcm0luv6'); // This window is intentionally outside the walkable floor, where gameplay previously sampled wall elevation.
assert(!temple.floor.some(([col,row])=>col===north.col&&row===north.row));
const sceneWindow={THREE:{},DaylightWindowRuntime:{windowSilhouette:()=>({minX:-.55,maxX:.55,minY:.5,maxY:1.74,width:1.1,height:1.24})}};
vm.runInNewContext(fs.readFileSync('docs/js/interior-scene-builder.js','utf8'),{window:sceneWindow,console,URL});
const builder=sceneWindow.InteriorSceneBuilder;
assert.equal(builder.furnitureFloorElevation(north,3.5),0);assert.equal(builder.furnitureFloorElevation({itemKey:'benchFurniture'},.8),.8);
const opening=builder.windowWallOpenings([north],{floorY:3.5})[0];
assert(Math.abs(opening.center[1]-2.472)<1e-8,'North-window opening and visual must share authored room height');
assert(Math.abs(opening.center[0]-10.146)<1e-8);assert.equal(opening.center[2],2);
class Vector3 {
 constructor(x=0,y=0,z=0){this.set(x,y,z);}
 set(x,y,z){Object.assign(this,{x,y,z});return this;}
 setFromMatrixColumn(){return this.set(0,0,1);}
 lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z;}
 normalize(){const length=Math.sqrt(this.lengthSq());this.x/=length;this.y/=length;this.z/=length;return this;}
 applyMatrix4(){this.x+=10;this.y+=2;this.z+=2;return this;}
 addScaledVector(v,n){this.x+=v.x*n;this.y+=v.y*n;this.z+=v.z*n;return this;}
}
const runtimeWindow={THREE:{Vector3},setTimeout:()=>0}; // Load only the daylight runtime; no renderer or alternate frame owner is needed.
vm.runInNewContext(fs.readFileSync('docs/js/daylight-window-runtime.js','utf8'),{window:runtimeWindow,console,URL});
assert.equal(runtimeWindow.DaylightWindowRuntime.drawProjectedLight,undefined); // The legacy floor projection was removed; the shared daylight compositor owns blended glass light.
const patternsWindow={},canvas={width:0,height:0,getContext:()=>({fillStyle:'',fillRect(){}})}; // Solid glass must remain valid without loading an unrelated motif or compositor.
vm.runInNewContext(fs.readFileSync('docs/js/furniture-pattern-surfaces.js','utf8'),{window:patternsWindow,document:{createElement:()=>canvas}});
patternsWindow.FurniturePatternSurfaces.renderTile({mode:'glass',solid:true,palette:['#8844dd','#eeaa22']},null,[16,24]).then(result=>{assert.strictEqual(result,canvas);assert.equal(result.width,16);assert.equal(result.height,24);console.log('Temple roots and shingle-vines, north window room elevation, colored light projection, scratch reuse and solid glass passed.');}).catch(error=>{console.error(error);process.exitCode=1;});

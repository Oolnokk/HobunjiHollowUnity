'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm'); // Executes the catalog and original sign generator to verify shared support geometry.
const window={}; // Procedural furniture exports are the single preset authority.
vm.runInNewContext(fs.readFileSync('docs/js/procedural-furniture.js','utf8'),{window,console,THREE:{TextureLoader:class {}}});
const recipe=window.ProceduralFurniture.CATALOG.hangingBanner,authored=JSON.parse(fs.readFileSync('docs/config/furniture-authored/hangingBanner.json','utf8')); // Runtime-authored and fallback recipes must stay identical.
assert.deepEqual(JSON.parse(JSON.stringify(recipe)),authored.parts);
const animationSource=fs.readFileSync('docs/tools/furniture-avatar-author/furniture-piece-animations.js','utf8'); // Execute the actual sign example without its unrelated DOM/animation editor setup.
const generator=animationSource.slice(animationSource.indexOf('function loadHangingSignPreset(){'),animationSource.indexOf('\nfunction installAnimationTab()'));
const state={parts:[],tileBase:{}}; // Captures actual generator parts and rope records.
const context=vm.createContext({window,state,selectedAnimationId:null,clearFurniture(){state.parts=[];},pushPart(kind,raw){const part={kind,...raw};state.parts.push(part);return part;},normalizeAnimation:record=>record,rebuildAll(){},applyEntrySurfaceDefaults(){},rebuildFurnitureMeshes(){},syncControlsFromState(){},frameFurniture(){},setEditorMode(){},renderAnimationUi(){},queueUndoHistory(){},log(){}});
vm.runInContext(generator+'\nloadHangingSignPreset();',context);
const support=state.parts[0],banner=recipe.find(part=>part.kind==='banner'); // Same support must survive while ropes/rigid board are replaced by flexible cloth.
assert.deepEqual(JSON.parse(JSON.stringify(recipe[0])),JSON.parse(JSON.stringify(support)),'support ID must also match because it seeds the editor wood irregularity');
assert.equal(recipe.length,2);assert(!recipe.some(part=>part.id==='banner-post'||part.id==='hanging_sign_board'));
assert.equal(banner.transform.sx,state.parts[1].transform.sx);assert.equal(banner.transform.sy,state.parts[1].transform.sy);assert.equal(banner.transform.x,state.parts[1].transform.x);
assert(Math.abs(banner.transform.y+banner.transform.sy/2-(support.transform.y-support.transform.sy/2))<1e-9,'cloth top must attach exactly to beam underside');
assert(banner.bannerWindStrength>0);assert(banner.patternSurfaces.length);
const copy=window.ProceduralFurniture.hangingSignSupportPart();copy.transform.y=99;assert.equal(window.ProceduralFurniture.hangingSignSupportPart().transform.y,1.72,'shared support definitions must return independent objects');
console.log('Banner preset shares the exact store/inn support and replaces its ropes/board with top-pinned patterned cloth.');

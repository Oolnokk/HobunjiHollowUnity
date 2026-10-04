'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm'); // Executes repository exports, ownership, and the shared carving helper.
const definitions={collectible:{schema:'hobunji_pattern.v1',id:'collectible',name:'Carved knot',collectible:true,motifPng:'assets/patterns/motif_collectible.png',settings:{meshRotationDeg:27,meshScale:1.6,invert:true}},decorative:{id:'decorative',motifPng:'assets/patterns/motif_decorative.png',settings:{}}}; // Only authored opt-in definitions may become ruin rewards.
const window={}; // Shared production modules communicate through their actual public APIs.
const document={currentScript:{src:'https://example.test/docs/js/repo-pattern-library.js'},createElement(){return {width:64,height:64,getContext:()=>({lineWidth:0,beginPath(){},moveTo(){},lineTo(){},stroke(){},closePath(){},fill(){}}),toDataURL:()=> 'data:catalog'};}}; // Built-in motifs remain available alongside repo rewards.
const context=vm.createContext({window,document,URL,console,fetch:async url=>({ok:true,json:async()=>url.endsWith('index.json')?{patterns:Object.keys(definitions).map(id=>({id,file:`config/patterns/${id}.json`}))}:definitions[url.split('/').pop().split('.')[0]]})}); // Repository loader resolves real docs-root URLs against this fixture.
for(const file of ['repo-pattern-library','pattern-library','portrait-utils'])vm.runInContext(fs.readFileSync(`docs/js/${file}.js`,'utf8'),context);
(async()=>{
 await window.RepoPatternLibrary.load();
 const ink='data:image/png;base64,ORIGINAL',pattern={motifDataUrl:ink,repoPatternId:'old',customMotifId:'old-store',meshRotationDeg:27,frameScale:1.2,motifThinPx:2,invert:true}; // Export must retain settings and ink independently of surface dyes/geometry.
 const payload=await window.RepoPatternLibrary.exportDefinition(pattern,'Carved Knot',true);
 assert.equal(payload.motifDataUrl,ink);assert.equal(payload.json.motifPng,'assets/patterns/motif_carved_knot.png');assert.equal(payload.json.schema,'hobunji_pattern.v1');
 assert.equal(payload.json.collectible,true);assert.equal(payload.indexEntry.file,'config/patterns/pattern_carved_knot.json');
 assert.equal(payload.json.settings.meshRotationDeg,27);assert.equal(payload.json.settings.invert,true);assert(!payload.json.settings.motifDataUrl&&!payload.json.settings.customMotifId&&!payload.json.settings.repoPatternId);assert.equal(pattern.repoPatternId,'old');
 const gear={}; let saves=0; // Ownership persists via the same inventory save path as built-in rewards.
 window.PatternLibrary.init({getGearInventory:()=>gear,saveGearInventory:()=>saves++});
 assert.equal(window.PatternLibrary.getById('collectible'),null);assert(!window.PatternLibrary.unlock('decorative'));
 assert(window.PatternLibrary.unlock('collectible'));assert(!window.PatternLibrary.unlock('collectible'));assert.equal(saves,1);
 assert(window.PatternLibrary.listAvailable().some(entry=>entry.id==='collectible'));
 assert.equal(window.PatternLibrary.getById('collectible').meshRotationDeg,27);
 const saved=JSON.parse(JSON.stringify(gear)); window.PatternLibrary.init({getGearInventory:()=>saved});
 assert(window.PatternLibrary.getById('collectible').motifUrl.endsWith('motif_collectible.png'),'reload keeps collectible ownership and repository ink reference');
 const pixels=new Uint8ClampedArray(7*7*4); // A solid stroke has an thinned dark core while its backing remains transparent.
 for(let y=1;y<6;y++)for(let x=1;x<6;x++)pixels[(y*7+x)*4+3]=255;
 const canvas={width:7,height:7,getContext:()=>({getImageData:()=>({data:pixels}),putImageData(){}})}; // Read/write fixture executes the canonical pixel helper without a browser.
 window.HobunjiSpritePngSurface.carveCanvas(canvas);
 assert.equal(pixels[3],0);assert.equal(pixels[(3*7+3)*4+3],242);assert.equal(pixels[(1*7+1)*4+3],166);
 assert.equal(pixels[(3*7+3)*4],20);assert.equal(pixels[(3*7+3)*4+1],16);assert.equal(pixels[(3*7+3)*4+2],12);
 const original=new Uint8ClampedArray(5*5*4),thinned=new Uint8ClampedArray(5*5*4); // Explicit core masks use canonical transformed motif pixels, not a second output-space edge detector.
 for(let p=0;p<25;p++)original[p*4+3]=255;thinned[(2*5+2)*4+3]=255;
 const full={width:5,height:5,getContext:()=>({getImageData:()=>({data:original}),putImageData(){}})},core={getContext:()=>({getImageData:()=>({data:thinned})})}; // Original shape remains untouched; only core opacity changes.
 window.HobunjiSpritePngSurface.carveCanvas(full,core);
 assert.equal(original[(2*5+2)*4+3],242);assert.equal(original[3],166);
 const finalPixels=new Uint8ClampedArray(5*5*4); // Final furniture opacity is baked once, rather than halved again by the WebGL material.
 for(let p=0;p<25;p++)finalPixels[p*4+3]=255;
 const finalCanvas={width:5,height:5,getContext:()=>({getImageData:()=>({data:finalPixels}),putImageData(){}})};
 window.HobunjiSpritePngSurface.carveCanvas(finalCanvas,core,{strokeOpacity:.325,coreOpacity:.85});
 assert.equal(finalPixels[3],83);assert.equal(finalPixels[(2*5+2)*4+3],217);assert.equal(finalCanvas.engravingDiagnostics.corePixels,1);assert.equal(finalCanvas.engravingDiagnostics.strokePixels,24);
 console.log('Furniture exports, collectible ownership/reload and translucent inner carving rims passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});

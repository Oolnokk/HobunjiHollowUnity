'use strict';
// Run with: node scripts/test-fur-hood-color-routing.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..'); // All tests exercise the current repository sources, not copied helper logic.
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const registry=JSON.parse(read('docs/config/patterns/fur-hoods.json')); // Actual species routing and optional motif defaults.
const window={CreatureGenetics:{PATTERN_DEFS:{grehlr:['mitts','spectacles','coloredstripe'],'gar-wolf':['colorpoint','foxtail','mitts']}}}; // Test gene order mirrors the shipped genetics registry.
vm.runInNewContext(read('docs/js/color-fill.js'),{window});
function canvas() {
  const result={width:0,height:0,data:null}; // Simple one-row image-buffer harness for the production color-fill math.
  result.getContext=()=>({
    drawImage(image){result.data=new Uint8ClampedArray(image.data);},
    getImageData(){return{data:new Uint8ClampedArray(result.data)};},
    putImageData(frame){result.data=new Uint8ClampedArray(frame.data);},
  });
  return result;
}
const document={currentScript:{src:'https://example.test/docs/js/fur-hood-leatherworking.js'},createElement(name){assert.equal(name,'canvas');return canvas();}};
vm.runInNewContext(read('docs/js/fur-hood-leatherworking.js'),{
  window,document,URL,fetch:async()=>({ok:true,json:async()=>registry}),
});
const api=window.FurHoodLeatherworking; // Same runtime API used by the loom, portrait and inventory paths.
const sample={
  kind:'grehlr',baseColor:'#4488bb',
  genotype:{base:{color:'#4488bb',copies:2},mitts:{enabled:true,copies:1,color:'#aa4422'},coloredstripe:{enabled:false,copies:0,color:'#bb33cc'}},
}; // One pattern is expressed, but the special white stripe is not.
const active=JSON.parse(JSON.stringify(sample));
active.genotype.coloredstripe={enabled:true,copies:1,color:'#bb33cc'};
const none=JSON.parse(JSON.stringify(sample));none.genotype.mitts={enabled:false,copies:0,color:'#aa4422'};
const sourcePixels=[
  255,255,255,255,  // Exact white stripe; must remain white without coloredstripe.
  120,120,120,255,  // Neutral shadow of the same white stripe.
  163,200,159,255,  // Authored Grehlr back's mint highlight.
  72,101,68,255,    // Authored Grehlr back's mint shadow.
  9,9,9,255,        // Near-black ink outline should not be recolored.
  200,200,200,0,    // Transparent pixels retain their alpha.
];
const image={width:6,height:1,data:new Uint8ClampedArray(sourcePixels)};
const pixel=(cv,index)=>Array.from(cv.data.slice(index*4,index*4+4));
async function main(){
  await api.ensureManifest();
  assert.equal(api.colorForRole(sample,'base'),'#4488bb');
  assert.equal(api.colorForRole(sample,'trim'),'#aa4422','first expressed pattern colors trim without a drawn motif');
  assert.equal(api.colorForRole(none,'trim'),'#4488bb','plain hides retain base-colored trim');
  assert.equal(api.colorForRole(active,'trim'),'#bb33cc','Grehlr prefers coloredstripe for trim when present');
  assert.equal(api.markingsFor(active,'base').length,0,'automatic trim/part tint does not require a painted motif');
  assert.equal(api.markingsFor(active,'trim').length,0,'natural trim tint does not generate a geometric motif');
  const plain=api.recolorAnimalPart(image,sample,'animalBack'),striped=api.recolorAnimalPart(image,active,'animalBack');
  assert.deepEqual(pixel(plain,0),[255,255,255,255],'white stays white without coloredstripe');
  assert.deepEqual(pixel(plain,1),[120,120,120,255],'neutral shade stays gray without coloredstripe');
  assert.notDeepEqual(pixel(striped,0).slice(0,3),[255,255,255],'coloredstripe repaints white');
  assert.notDeepEqual(pixel(striped,1).slice(0,3),[120,120,120],'coloredstripe repaints its gray shade too');
  assert(pixel(striped,0)[0]>pixel(striped,1)[0],'white and gray keep distinct HSV source values');
  assert.deepEqual(pixel(striped,2),pixel(plain,2),'mint base region is independent of stripe genotype');
  assert.notDeepEqual(pixel(plain,2).slice(0,3),[163,200,159],'mint highlight inherits base hue');
  assert.notDeepEqual(pixel(plain,3).slice(0,3),[72,101,68],'mint shadow inherits base hue');
  assert(pixel(plain,2)[2]>pixel(plain,3)[2],'mint retains highlight/shadow brightness');
  assert.deepEqual(pixel(striped,4),[9,9,9,255],'near-black outlines stay unchanged');
  assert.deepEqual(pixel(striped,5),[200,200,200,0],'transparent pixels are preserved');
  assert.deepEqual(Array.from(image.data),sourcePixels,'source sprite never mutates');
  assert.strictEqual(api.recolorAnimalPart(image,active,'animalBack'),striped,'per-sprite genotype tint cache is reused');
  const front=api.recolorAnimalPart(image,active,'animalFront');
  assert.deepEqual(pixel(front,2),[163,200,159,255],'Grehlr front does not color a mint region as back base');
  const wolf={kind:'gar-wolf',baseColor:'#886644',genotype:{base:{color:'#886644'},foxtail:{enabled:true,copies:1,color:'#ddbb33'}}};
  assert.equal(api.colorForRole(wolf,'animalFront'),'#886644','unconfigured animal parts preserve base by default');
  wolf.authoringPalette={partColors:{front:'pattern',back:'base'}};
  assert.equal(api.colorForRole(wolf,'animalFront'),'#ddbb33','dev-configured front can select pattern pigment');
  assert.equal(api.colorForRole(wolf,'animalBack'),'#886644','independent back can select base');
  wolf.genotype.foxtail.enabled=false;
  assert.equal(api.colorForRole(wolf,'animalFront'),'#886644','missing pattern falls back to base');
  const loom=read('docs/js/clothing-weaving-system.js');
  assert.match(loom,/colorForRole\?\.\(furHood, role\)/,'loom/icon uses canonical natural color resolver');
  assert.match(loom,/recolorAnimalPart\?\.\(img, furHood, role\)/,'loom/icon handles Grehlr keyed regions');
  assert.match(loom,/recolorAnimalPart\?\.\(img, descriptor\?\.furHood, descriptor\?\.role\)/,'equipped portrait uses same selective source');
  assert.match(loom,/if \(!descriptor\.furHood && !weavingPatternsForRole/,'motif-free fur layers still enter portrait tint resolver');
  const editor=read('docs/tools/pattern-editor/index.html');
  assert(editor.includes('id="furFrontColorMode"') && editor.includes('id="furBackColorMode"'),'per-species natural front/back routing is authorable');
  assert(editor.includes('id="furTrimGene"'),'trim gene preference is authorable');
  console.log('OK: motif-free fur trim, configurable parts, Grehlr dual source palette, caching and portrait/loom integration');
}
main().catch(error=>{console.error(error);process.exitCode=1;});

'use strict';
// Run with: node scripts/test-fur-hood-exclusion-editor.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..'); // The test uses committed source files and manifest rather than a duplicated color-picker implementation.
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const manifest=JSON.parse(read('docs/config/patterns/fur-hoods.json'));
const cosmetic=JSON.parse(read('docs/config/cosmetics/fur_hood.json'));
const window={}; // The authoring module attaches its API to the page without opening a modal.
const document={currentScript:{src:'https://example.test/docs/js/fur-hood-exclusion-editor.js'},baseURI:'https://example.test/docs/tools/pattern-editor/index.html'};
vm.runInNewContext(read('docs/js/fur-hood-exclusion-editor.js'),{window,document,URL});
const api=window.FurHoodExclusionEditor;
assert(api?.open&&api?.spritePaths&&api?.exportData,'raw sprite picker is exposed by the actual tool module');
assert.deepEqual(Array.from(api.unique(['#ABCDEF','#abcdef','#987654','not-a-color'])),['#abcdef','#987654'],'exact HEX lists normalize case and discard duplicates/invalid colors');
const tl=api.spritePaths(cosmetic,manifest.species.nelk,'tletingan_male','behind');
const mashtz=api.spritePaths(cosmetic,manifest.species.nelk,'mashtzarr_male','front');
assert.equal(tl.animalBack,'assets/cosmetics/clothes/hood/furhood_nelk-back_tl_m.png','Tletingan Nelk back points to the planned post-merge sprite');
assert.equal(mashtz.animalBack,'assets/cosmetics/clothes/hood/furhood_nelk-back_mashtz_m.png','renamed Mashtzarr Nelk back is wired');
assert(tl.base.endsWith('furhood-behind_tl_m.png'),'rear hood base comes from dedicated behind art');
assert(tl.trim.endsWith('furhood-trim_tl_m.png'),'rear trim remains a separate sampleable source layer');
assert.deepEqual(manifest.pendingAssets,['assets/cosmetics/clothes/hood/furhood_nelk-back_tl_m.png'],'only the user-promised post-merge asset is marked pending');
const sample=api.exportData(manifest,'nelk','animalBack'); // Lists are runtime-compatible while all sprite images remain unmodified.
assert.equal(sample.schema,'hobunji_fur_exclusions.v1');
assert.deepEqual(Array.from(sample.global),['#94858e','#567372'],'original protected source colors stay available');
assert.equal(sample.byRole.animalBack.length,0,'a missing Nelk drawing does not invent exclusions');
manifest.species.nelk.excludedColorsByRole={animalBack:['#ABCDEF','#abcdef']};
const exported=api.exportData(manifest,'nelk','animalBack');
assert.deepEqual(Array.from(exported.effective),['#94858e','#567372','#abcdef'],'global and per-role exports deduplicate exact RGB');
const editor=read('docs/tools/pattern-editor/index.html');
assert(editor.includes('id="furSampleExclusionsBtn"'),'raw sprite eyedropper is accessible in Pattern Editor');
assert(editor.includes('id="furExportExclusionsBtn"'),'portable HEX export is accessible in Pattern Editor');
assert(editor.includes('onChange:()=>{updateAssignments();preview();}'),'picked source colors rerender the full hood immediately');
const source=read('docs/js/fur-hood-exclusion-editor.js');
assert(source.includes('spriteTintCanvas(image,zero,roles.value)'),'before preview uses no exclusions');
assert(source.includes('spriteTintCanvas(image,excluded,roles.value)'),'after preview applies selected exclusions');
assert(source.includes("manifest.pendingAssets?.includes(path)"),'pending post-merge sprite provides an actionable loading explanation');
console.log('OK: raw sprite eyedropper, exported global/role HEX lists, live comparison, and pending Nelk asset reference');

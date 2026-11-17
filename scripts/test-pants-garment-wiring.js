#!/usr/bin/env node
'use strict';
// In-game pants wiring that runs without a browser: NPC default pants, rig-data lookup, and the shipped rig config.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const win = { document: {}, ScratchbonesAccount: { getDyeCatalog: () => [{ id: 'dye_a', acquisition: 'starter' }, { id: 'dye_b', acquisition: 'starter' }, { id: 'dye_c', acquisition: 'rare' }] } };
win.window = win; win.globalThis = win;
vm.createContext(win);
for (const file of ['docs/config/pants-rigs.js', 'docs/js/pants-rig-core.js', 'docs/js/pants-garment-renderer.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), win, { filename: file });
const Renderer = win.PantsGarmentRenderer;
assert(Renderer, 'renderer did not install');

// Shipped data: the starter garment exists with a valid 5-channel weight map, and unknown species fall back to __default.
const rigs = win.HOBUNJI_PANTS_RIGS;
assert(rigs.garments.pants_basic, 'config/pants-rigs.js ships the pants_basic garment');
assert.strictEqual(win.HobunjiPantsRig.decodeWeightGridRle(rigs.garments.pants_basic.weightMap).channels.length, 5);
assert(Renderer.hasRigFor('kenkari', 'male') && Renderer.hasRigFor('some-new-species', 'female'), 'every species resolves to a rig through __default');
assert(Renderer.resolveCharacter('Mao_Ao', 'MALE'), 'species/gender keys are normalized');

// Every humanoid NPC gets the free pants with a deterministic dye; animals and opt-outs do not.
const npc = { id: 'tester', equippedCosmetics: ['tankan_tunic'] };
assert.strictEqual(Renderer.ensureNpcPants(npc), true);
assert(npc.equippedCosmetics.includes('pants_basic') && npc.equippedCosmetics.includes('tankan_tunic'), 'pants are added beside existing clothing');
assert.strictEqual(npc.appliedDyes.PANTS, 'dye:CLOTH:brown', 'no overwear dye: the pants are brown');
assert.strictEqual(Renderer.ensureNpcPants(npc), false, 'idempotent');
const matched = { id: 'matcher', appliedDyes: { CLOTH: 'dye:CLOTH:teal' } };
Renderer.ensureNpcPants(matched);
assert.strictEqual(matched.appliedDyes.PANTS, 'dye:CLOTH:teal', 'pants match the overwear dye');
const dbNpc = { id: 'authored_npc', avatarEditor: {}, equippedCosmetics: ['tankan_tunic'] };
assert.strictEqual(Renderer.ensureNpcPants(dbNpc), false, 'database NPCs are authored: the renderer never adds pants to them');
assert(!dbNpc.equippedCosmetics.includes('pants_basic'));
const authored = { id: 'dyed', appliedDyes: { PANTS: 'dye_c' } };
Renderer.ensureNpcPants(authored);
assert.strictEqual(authored.appliedDyes.PANTS, 'dye_c', 'an authored pants dye is never overwritten');
assert.strictEqual(Renderer.ensureNpcPants({ id: 'banubu', kind: 'animal' }), false, 'animals do not wear pants');
assert.strictEqual(Renderer.ensureNpcPants({ id: 'nopants', noPants: true }), false, 'records can opt out');

// Dye/weave inputs.
assert.deepStrictEqual(JSON.parse(JSON.stringify(Renderer.appearanceFromItem({ colorA: { hex: '#112233' }, colorB: null, colorC: { hex: '#fff000' }, weaving: { layers: {} } }))), { primaryHex: '#112233', secondaryHex: '#112233', patternHex: '#fff000', weaving: { layers: {} } });
assert.strictEqual(Renderer.appearanceFromBodyColors({ PANTS: { hex: '#abcdef' } }).primaryHex, '#abcdef');

// The pants cosmetic is registered so dye/weaving/icons can resolve its art.
const index = JSON.parse(fs.readFileSync('docs/config/cosmetics/index.json', 'utf8'));
const entry = index.entries.find(e => e.id === 'pants_basic');
assert(entry, 'cosmetics/index.json registers pants_basic');
const cosmetic = JSON.parse(fs.readFileSync('docs/config/cosmetics/' + entry.path.replace(/^\.\//, ''), 'utf8'));
assert.strictEqual(cosmetic.slot, 'pants');
assert(cosmetic.parts.pants.layers.base.paletteColorKey === 'A', 'the garment layer takes the primary dye');

console.log('Pants garment wiring: PASS');

// Authoring data: every NPC in the starter database wears authored pants with an authored dye; poncho wearers use their secondary dye.
{
  const db = JSON.parse(fs.readFileSync('docs/config/npcs/hobunji-starter-npc-database.json', 'utf8'));
  for (const rec of db.npcs) {
    assert(Renderer.garmentForCosmetics(rec.equippedCosmetics), `${rec.id} has an authored leg garment`);
    const wantsSkirt = (rec.appearance?.speciesId === 'mao-ao' && rec.gender === 'female') || rec.id === 'teacup_unumanuk'; // Expected repository wardrobe assignments.
    assert.strictEqual(Renderer.garmentForCosmetics(rec.equippedCosmetics), wantsSkirt ? 'layered_skirt' : 'pants_basic');
    if (wantsSkirt) assert(rec.avatarEditor.rawExport.equippedCosmetics.includes('layered_skirt'), `${rec.id}: editor export agrees`);
    assert(rec.appliedDyes.PANTS, `${rec.id} has an authored pants dye`);
    if (rec.equippedCosmetics.includes('rugged_poncho')) assert.strictEqual(rec.appliedDyes.PANTS, rec.appliedDyes.CLOTH_B, `${rec.id}: poncho wearers' pants use the secondary dye`);
  }
}

// Every supported garment uses the same fit/bones while keeping independent exported weight data.
for (const id of ['draped_pants', 'layered_skirt']) {
  const garment = rigs.garments[id]; // Baked nearest-opaque transfer used by the runtime mesh.
  assert(garment && Renderer.hasRigFor('mao-ao', 'female', id));
  assert.strictEqual(Renderer.garmentForCosmetics(['fine_poncho', id]), id);
  assert.deepStrictEqual(garment.legBones, rigs.garments.pants_basic.legBones);
  assert.deepStrictEqual(garment.pantsBeltSpline, rigs.garments.pants_basic.pantsBeltSpline);
  const weights = win.HobunjiPantsRig.decodeWeightGridRle(garment.weightMap); // Checks actual decoded skin data rather than a source string.
  const original = win.HobunjiPantsRig.decodeWeightGridRle(rigs.garments.pants_basic.weightMap); // Control at opaque source-art samples.
  for (const [x, y] of [[32, 18], [18, 35], [45, 35]]) {
    const offset = (y * weights.width + x) * 5; // Corresponding cell in both normalized maps.
    assert.deepStrictEqual(Array.from(weights.data.slice(offset, offset + 5)), Array.from(original.data.slice(offset, offset + 5)));
  }
  for (let i = 0; i < weights.data.length; i += 5) {
    assert(Math.abs(Array.from(weights.data.slice(i, i + 5)).reduce((sum, value) => sum + value, 0) - 255) <= 2, 'every extended cell has normalized influences');
  }
  const path = index.entries.find(entry => entry.id === id).path; // Config path uses the production cosmetic registry.
  const config = JSON.parse(fs.readFileSync('docs/config/cosmetics/' + path.replace(/^\.\//, ''), 'utf8')); // Exercises shipped layer declarations.
  assert.strictEqual(config.slot, 'pants');
  const layers = Object.values(config.parts.pants.layers); // Both draped-pants sprites remain independently dyed.
  assert.strictEqual(layers.length, id === 'draped_pants' ? 2 : 1);
  if (id === 'draped_pants') assert.deepStrictEqual(layers.map(layer => layer.paletteColorKey), ['A', 'B']);
}
const generatedFemale = { appearance: { speciesId: 'mao-ao', gender: 'female' } }; // Procedural townsfolk share the authored species wardrobe.
assert(Renderer.ensureNpcPants(generatedFemale));
assert.strictEqual(Renderer.garmentForCosmetics(generatedFemale.equippedCosmetics), 'layered_skirt');
assert.strictEqual(Renderer.ensureNpcPants(generatedFemale), false, 'never add basic pants on top of a skirt');
console.log('Layered leg garments: PASS');

const hybrid = { appearance: { speciesId: 'omgurku', gender: 'male' } }; // Generated NPCs resolve species from the same appearance source as the avatar.
assert.strictEqual(Renderer.ensureNpcPants(hybrid),false,'hybrid lower body does not receive humanoid pants');
assert.strictEqual(hybrid.equippedCosmetics,undefined,'checking the hybrid does not mutate its wardrobe');
// Execute the production scoped-depth owner without constructing WebGL garments.
{
 const source=fs.readFileSync('docs/js/pants-garment-renderer.js','utf8'); // The same closure installed on each real garment handle.
 const start=source.indexOf('    const depthBiasLimits=new Map();'),end=source.indexOf('    const createMesh =',start);
 const model={matrixWorld:{elements:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]},updateMatrixWorld(){}};
 const handle={model,depthBiasBase:.3,maskUniforms:{uPantsDepthBias:{value:.3}}}; // Synthetic avatar and garment using the production callback.
 let revision=0,lift=.2,measures=0;
 const pushes=[],loadedFeet={left:{name:'new left GLB'},right:{name:'new right GLB'}}; // Detect if the refresh mistakenly reuses attached fallback references.
 const legHandle={anatomyRevision:()=>revision,setFootDepthPush:value=>pushes.push(value),group:{getObjectByName:name=>name==='left_foot'?loadedFeet.left:loadedFeet.right}};
 const footFrontLift=(_three,_model,feet)=>{ // The production bounds scanner must receive the CURRENT meshes after async replacement.
   assert.equal(feet[0],loadedFeet.left);assert.equal(feet[1],loadedFeet.right);
   measures++;return lift;
 }; // A scan only when the actual foot geometry changes.
 vm.runInNewContext(source.slice(start,end),{handle,legHandle,footFrontLift,THREE:{},avatarGroup:model,footObjects:null});
 assert(handle.setDepthBiasLimit('close-contact',0));assert.equal(handle.maskUniforms.uPantsDepthBias.value,0);
 assert(handle.setDepthBiasLimit('other',.1));assert.equal(handle.maskUniforms.uPantsDepthBias.value,0);
 assert.equal(handle.setDepthBiasLimit('other',NaN),false);assert.equal(handle.setDepthBiasLimit('other',-1),false);
 revision++;
 assert.equal(handle.refreshFootDepthBias(),true,'final foot GLBs trigger recalibration');
 assert.equal(handle.depthBiasBase,.2);
 assert.equal(handle.maskUniforms.uPantsDepthBias.value,0,'paired pose limit survives foot replacement');
 assert.equal(handle.refreshFootDepthBias(),false,'ordinary frames do not rescan foot geometry');
 assert.equal(measures,1);assert.equal(pushes.at(-1),0);
 handle.setDepthBiasLimit('close-contact',null);assert.equal(handle.maskUniforms.uPantsDepthBias.value,.1);
 handle.setDepthBiasLimit('other',null);assert.equal(handle.maskUniforms.uPantsDepthBias.value,.2,'release restores the recalibrated value');
 assert.equal(pushes.at(-1),.2,'leg owner receives the updated foot depth push');
 loadedFeet.left={name:'subsequent left GLB'};
 loadedFeet.right={name:'subsequent right GLB'};
 lift=.3;revision++;assert.equal(handle.refreshFootDepthBias(),true);
 assert.equal(handle.maskUniforms.uPantsDepthBias.value,.3,'subsequent GLB replacements also work');
 assert.equal(handle.getFootDepthBiasDebug().anatomyRevision,2);
 assert.equal(measures,2,'only anatomy revisions should trigger expensive 3D foot scans');
}
{
 const pixelProbe=fs.readFileSync('docs/js/pixel-probe.js','utf8'); // Guards the existing mobile copyable report, not a DevTools-only console API.
 const probeBoot=fs.readFileSync('docs/js/bootstrap/classic-groups/pre-game-diagnostics.js','utf8');
 assert.match(pixelProbe,/Pants\/feet depth:/,'render-only pants depth is shown in the mobile Pixel Probe');
 assert.match(pixelProbe,/getFootDepthBiasDebug/,'Pixel Probe reads the real garment handle rather than a stale cosmetic cache');
 assert.match(probeBoot,/pixel-probe\.js\?v=[A-Za-z0-9_-]+/,'mobile bundle loads the repaired Pixel Probe');
}
{
 const pants=fs.readFileSync('docs/js/pants-garment-renderer.js','utf8'); // Verify the recalibration is genuinely called by the live animation loop.
 const legs=fs.readFileSync('docs/js/procedural-leg-animation.js','utf8'); // The async GLB replacement is responsible for signaling a changed foot shape.
 const inUpdate=pants.slice(pants.indexOf('    handle.update = (renderOnly = false) => {'),pants.indexOf('    handle.dispose = () => {'));
 assert.match(inUpdate,/handle\.refreshFootDepthBias\(\)/,'leg animation updates perform revision-aware depth refresh');
 assert.match(legs,/state\.anatomyRevision\+\+/,'final GLB rig installation signals the revision to the pants renderer');
 const version=/pants-garment-renderer\.js\?v=[A-Za-z0-9_-]+/; // One exact renderer cache key must be used by game and preview entry points.
 for(const path of ['docs/index.html','docs/tools/enemy-loadout-editor/preview.js','docs/tools/live-root-growth/index.html','docs/tools/attack-animation-editor/index.html','docs/js/procedural-pants-rig-author.js']){
   assert.match(fs.readFileSync(path,'utf8'),version,path+' must load the versioned pants renderer');
 }
 const enemyApp=fs.readFileSync('docs/tools/enemy-loadout-editor/app.js','utf8'); // An editor module is cached independently of the script it imports.
 const enemyHtml=fs.readFileSync('docs/tools/enemy-loadout-editor/index.html','utf8'); // A returning user's HTML entry must load the revised module URL.
 assert.match(enemyApp,/\.\/preview\.js\?v=[A-Za-z0-9_-]+/,'enemy app refreshes the edited preview module');
 assert.match(enemyHtml,/tools\/enemy-loadout-editor\/app\.js\?v=[A-Za-z0-9_-]+/,'enemy editor HTML refreshes its importer');
 const parityToken=/procedural-feet-outline-parity\.js\?v=[A-Za-z0-9_-]+/; // Both consumers must load the fixed nested onAfterRender cleanup order.
 assert.match(fs.readFileSync('docs/index.html','utf8'),parityToken,'game loads the versioned foot parity');
 assert.match(fs.readFileSync('docs/tools/enemy-loadout-editor/preview.js','utf8'),parityToken,'enemy preview loads the versioned foot parity');
}

'use strict';
const assert = require('node:assert/strict'); // Verifies age-wide rig transforms, editor input contracts, and persisted defaults.
const fs = require('node:fs'); // Reads the shipped editor and family modules rather than test-only implementations.
const vm = require('node:vm'); // Runs browser-only stage logic without starting WebGL or the game.
const editorSource = fs.readFileSync('docs/js/character-scale-comparison.js', 'utf8'); // Production lineup implementation under test.
const cameraSource = fs.readFileSync('docs/js/character-scale-comparison-camera.js', 'utf8'); // Legacy camera must not restore click selection.
const inputSource = fs.readFileSync('docs/js/character-scale-comparison-body-input-guard.js', 'utf8'); // Body/head edits must preserve the active growth stage.
const presentationSource = fs.readFileSync('docs/js/character-scale-comparison-presentation.js', 'utf8'); // Raw PNG head edits must preserve the same stage.
const familySource = fs.readFileSync('docs/js/romance-family.js', 'utf8'); // Runtime family avatars consume the exported age-wide phase values.
const bootstrap = fs.readFileSync('docs/js/attachment-rig-latest-authored-snapshot.js', 'utf8'); // Confirms canonical family defaults load before the editor.

assert(!editorSource.includes('function pickAt('), 'viewport click selection must not exist in the primary comparison editor');
assert(!cameraSource.includes('function installPicking('), 'legacy camera helper cannot reinstall viewport click selection');
assert(editorSource.includes("querySelector('#maaFullScaleChoose').addEventListener('change'"), 'selection dropdown must be wired');
assert(editorSource.includes('visibility:visible!important'), 'editor panel must stay visible while the scale tab is selected');
assert(editorSource.includes('setAgeMode(event.target.value)'), 'all age stages must be selectable from the visible panel');
assert(editorSource.includes('retryLateAgeLimbs()'), 'late-loading GLBs must receive age-wide limb modifiers');
assert(inputSource.includes('comparisonApi().refreshSelectedPreview()'), 'guarded body inputs must reapply stage modifiers');
assert(presentationSource.includes('comparisonApi().refreshSelectedPreview()'), 'raw head controls must reapply stage modifiers');
assert(familySource.includes("phase === 'child' ? cfg().childLimbModifiers"), 'family child hands and feet must use shared runtime settings');
assert(bootstrap.indexOf('romance-config.js') < bootstrap.indexOf('character-scale-comparison.js'),
  'the editor must read age defaults from the same gameplay configuration used by family NPCs');

const stored = new Map(); // Simulates the browser's authoring autosave without touching real preferences.
const fields = new Map(); // Provides observable mobile-friendly age UI controls.
const getField = id => {
  if (!fields.has(id)) fields.set(id, { value: '', hidden: false, textContent: '', style: {}, offsetParent: {}, setAttribute() {} });
  return fields.get(id);
};
const applied = []; // Captures complete age-and-species transforms passed to the real shared API.
const visuals = new Map(); // Four distinct GLB visual roots for one representative preview rig.
for (const side of ['left','right']) for (const kind of ['hand_visual','foot']) {
  visuals.set(side + '_' + kind, { scale: { x: 2, y: 3, z: 4, set(x,y,z) { this.x=x; this.y=y; this.z=z; } }, updateMatrix() {} });
}
const stageRoot = {
  isObject3D: true,
  getObjectByName(name) { return visuals.get(name) || null; },
};
const entry = { key: 'mao-ao::female', species: 'mao-ao', gender: 'female', group: stageRoot,
  profile: { anatomy: { rigScaleX: 1.2, rigScaleY: 1.5, headScale: 1.1, headOffsetY: .05 } },
  npc: { id: 'example' },
};
const window = {
  HobunjiRomanceConfig: { family: { phaseScales: {
    basket: { body: .32, head: .5, hand: 1.2, foot: 1.2 },
    toddler: { body: .4, head: .66, hand: 1, foot: 1 },
  } } },
  SCRATCHBONES_CONFIG: { game: { assets: { pngPlaneAvatar: {
    childScaleMultiplier: .5, childHeadScaleMultiplier: .72,
  } } } },
  HobunjiCharacterRigScale: {
    scaleFor() { return { x: 1.2, y: 1.5, head: 1.1, offsetY: .05 }; },
    applyToParent(root, species, gender, values) { applied.push({ root, species, gender, values }); },
  },
  ProceduralHandFrameDriver: { syncNow() {} },
  HobunjiAnimationAuthorScaleHost: { npcAgeFor() { return 0; } },
};
const context = vm.createContext({
  window, URL, console, location: { pathname: '/tools/animation-author/index.html', href: 'https://test.invalid/tools/animation-author/index.html' },
  document: { getElementById: getField },
  localStorage: {
    getItem(key) { return stored.get(key) || null; },
    setItem(key, value) { stored.set(key, value); },
    removeItem(key) { stored.delete(key); },
  },
  setTimeout() { return 1; }, clearTimeout() {},
  setInterval() { return 1; }, clearInterval() {},
});
const exposed = editorSource.replace('  install();\n})();', `
  window.__ageTest = {
    init() { loadAgeModifiers(); active = true; entries = [window.__ageEntry]; syncAgeControls(); },
    setAgeMode, applyAgeModifiers, ageValues, loadAgeModifiers, get ageMode() { return ageMode; },
    configure(next,chosen) { entries=next; selected=chosen; loadAgeModifiers(); syncAgeControls(); },
    choose(entry) { selected=entry; syncAgeControls(); },
    editIndividualAge, bakeConvergence, previewOverall, bakeOverall, previewAgeValues,
    individualAgeValues, get overall() {return overallFactorFor();},
  };
})();`);
assert.notEqual(exposed, editorSource, 'the production editor exposes its private test seam');
window.__ageEntry = entry;
vm.runInContext(exposed, context);
const api = window.__ageTest;
api.init();
api.setAgeMode('baby');
assert.equal(applied.at(-1).values.x, 1.2 * .32, 'baby body width composes with species width');
assert.equal(applied.at(-1).values.y, 1.5 * .32, 'baby body height composes with species height');
assert.equal(applied.at(-1).values.head, 1.1 * .5, 'baby head multiplier composes independently from body');
assert.equal(visuals.get('left_hand_visual').scale.x, 2 * 1.2, 'baby hands match the family GLB scale');
assert.equal(visuals.get('right_foot').scale.y, 3 * 1.2, 'baby feet match the family GLB scale');

api.applyAgeModifiers('width', '36');
api.applyAgeModifiers('height', '44');
api.applyAgeModifiers('hand', '150');
assert.equal(applied.at(-1).values.x, 1.2 * .36, 'global width edit is independent of height');
assert.equal(applied.at(-1).values.y, 1.5 * .44, 'global height edit is independent of width');
assert.equal(applied.at(-1).values.legLength, 1.5 * .44, 'leg length follows stage Height instead of Width');
const expectedYoungHands = 3 * ((1.2 + 1.5) * .44) / (1.2 * .36 + 1.5 * .44); // Live children build limb meshes at stage height before adult mean scale.
assert.ok(Math.abs(visuals.get('left_hand_visual').scale.x - expectedYoungHands) < 1e-10, 'independent width cannot change gameplay-equivalent hand size');
assert.equal(JSON.parse(stored.get('hobunjiFullCharacterScale.ageModes.v1')).modifiers.baby.width, .36,
  'baby width persists separately');
assert.equal(JSON.parse(stored.get('hobunjiFullCharacterScale.ageModes.v1')).modifiers.baby.height, .44,
  'baby overrides persist in a dedicated key, not the species rig profile');
assert.equal(entry.profile.anatomy.rigScaleX, 1.2, 'age modifiers never mutate canonical species anatomy');

api.setAgeMode('toddler');
assert.equal(applied.at(-1).values.head, 1.1 * .66, 'toddler uses canonical gameplay phase defaults');
assert.equal(visuals.get('left_hand_visual').scale.x, 2, 'toddler restores the original hand scale');
api.setAgeMode('child');
assert.equal(applied.at(-1).values.x, 1.2 * .5, 'child body is the standard PNGPlaneAvatar size');
assert.equal(applied.at(-1).values.head, 1.1 * .72, 'child head is the standard PNGPlaneAvatar size');
api.setAgeMode('adult');
assert.equal(applied.at(-1).values.x, 1.2, 'returning to adult restores canonical authored width');
assert.equal(visuals.get('right_foot').scale.z, 4, 'returning to adult restores original foot geometry size');
assert(editorSource.includes('maaFullScaleAgeRange${name}'), 'rendered stage UI retains the dynamic age-control IDs');
assert(editorSource.includes("['Width','width',1,2000],['Height','height',1,2000]"), 'independent Width and Height sliders exist for every age stage');
// Old v1 body-only autosaves must hydrate both new axes, not erase established presets.
stored.set('hobunjiFullCharacterScale.ageModes.v1', JSON.stringify({ schema: 'hobunji.character-age-rig-modifiers.v1', modifiers: { baby: { body: .37, head: .55, hand: 1.6, foot: 1.1 } } }));
api.loadAgeModifiers();
assert.equal(api.ageValues().width, 1, 'adult remains unmodified after legacy migration');
api.setAgeMode('baby');
assert.equal(api.ageValues().width, .37, 'legacy baby body initializes width');
assert.equal(api.ageValues().height, .37, 'legacy baby body initializes height');
assert.equal(api.ageValues().head, .55, 'legacy head authoring survives migration');
api.setAgeMode('adult');
api.setAgeMode('nonexistent');
assert.equal(api.ageMode, 'adult', 'unexpected saved/UI stage names are rejected');
// Exercise the real shared per-profile implementation and actual private editor handlers.
stored.delete('hobunjiFullCharacterScale.ageModes.v1');
vm.runInContext(fs.readFileSync('docs/js/character-age-rig-config.js','utf8'),context);
const other = {...entry,key:'mashtzarr::female',species:'mashtzarr',group:{...stageRoot},profile:{anatomy:{}}};
const liveAdult = new Map(); // Mock only host persistence and geometry, not stage composition or bake math.
window.HobunjiCharacterRigScale.scaleFor = (species,gender)=>liveAdult.get(species+'::'+gender)||{x:1.2,y:1.5,legLength:1.5,head:1.1,offsetY:0};
window.HobunjiAnimationAuthorScaleHost.setRigScale=(species,gender,scale)=>{liveAdult.set(species+'::'+gender,scale);return scale;};
window.HobunjiCharacterRigScaleDefaults={uploadedScaleRestoreValues:{[entry.key]:{},[other.key]:{}}};
window.HobunjiCharacterDimensions={dimensionsFor(species){return {body:{width:species==='mashtzarr'?2:1},height:species==='mashtzarr'?1.6:1,factors:{modelHeight:1}};}};
api.configure([entry,other],entry);
api.setAgeMode('baby');
assert.equal(api.individualAgeValues(other).head,.5489999999999999,'latest uploaded Mashtzarr female head is visible in actual editor state');
const otherBefore=api.individualAgeValues(other).width;
api.editIndividualAge('width','123.4');
assert.equal(api.individualAgeValues(entry).width,1.234,'selected identity has its own width');
assert.equal(api.individualAgeValues(other).width,otherBefore,'another species/gender retains its own width');
api.choose(other);
api.editIndividualAge('head','52');
assert.equal(api.individualAgeValues(other).head,.52);
assert.equal(api.individualAgeValues(entry).head,.97);
api.applyAgeModifiers('widthConvergence','45');
api.applyAgeModifiers('heightConvergence','30');
const beforeBake=[entry,other].map(e=>api.previewAgeValues(e));
api.bakeConvergence();
assert.equal(api.ageValues().widthConvergence,0);assert.equal(api.ageValues().heightConvergence,0);
for(const [i,e] of [entry,other].entries()) for(const axis of ['width','height','head','hand','foot']) assert.ok(Math.abs(api.previewAgeValues(e)[axis]-beforeBake[i][axis])<1e-10,'convergence bake preserves preview '+axis);
api.applyAgeModifiers('widthConvergence','35');
const unscaled = [entry,other].map(e=>api.previewAgeValues(e)); // Convergence remains active while testing Overall Scale.
const passesBefore = applied.length; // An overall drag should only recompose its target rig.
api.previewOverall('75');
assert.equal(applied.length, passesBefore + 1);
assert.equal(applied.at(-1).species, other.species);
assert.deepEqual(api.previewAgeValues(entry), unscaled[0], 'overall preview leaves the other identity alone');
assert.ok(Math.abs(api.previewAgeValues(other).width - unscaled[1].width * .75) < 1e-10);
api.choose(entry);
assert.equal(api.overall, 1, 'selecting a different identity does not inherit its draft');
api.choose(other);
assert.equal(api.overall, .75, 'returning to the same identity restores its draft');
const scaledBefore=[entry,other].map(e=>api.previewAgeValues(e));
api.bakeOverall();
assert.equal(api.overall,1);
for(const [i,e] of [entry,other].entries()) for(const axis of ['width','height','head','hand','foot']) assert.ok(Math.abs(api.previewAgeValues(e)[axis]-scaledBefore[i][axis])<1e-10,'overall bake preserves preview '+axis);
api.bakeConvergence();
const savedBaby=api.individualAgeValues(entry).width;
api.choose(entry);
api.setAgeMode('toddler');
const toddlerWidth=window.HobunjiCharacterAgeRigConfig.repositoryProfiles().toddler[entry.key].width;
assert.equal(api.individualAgeValues(entry).width,toddlerWidth,'baby bake leaves toddler proportions alone');
assert.equal(api.individualAgeValues(entry).height,window.HobunjiCharacterAgeRigConfig.repositoryProfiles().baby[entry.key].height+.2);
const otherToddler = api.individualAgeValues(other);
api.previewOverall('125');api.bakeOverall();
assert.deepEqual(api.individualAgeValues(other), otherToddler, 'toddler bake preserves other identities');
assert.equal(api.individualAgeValues(entry).width,toddlerWidth*1.25);
api.setAgeMode('child');
assert.equal(api.individualAgeValues(entry).width,.5,'toddler bake leaves child proportions alone');
api.previewOverall('115');
assert.equal(api.overall, 1.15);
api.setAgeMode('adult');
assert.equal(api.overall, 1, 'drafts are independent by stage');
const otherAdult = applied.filter(item=>item.species===other.species).at(-1).values;
api.previewOverall('80');
assert.deepEqual(applied.filter(item=>item.species===other.species).at(-1).values, otherAdult);
const adultPreview=applied.filter(item=>item.species===entry.species).at(-1).values;
api.bakeOverall();
assert.equal(api.overall,1);
assert.deepEqual([...liveAdult.keys()], [entry.key], 'adult bake writes only the selected species and gender');
const adultBaked=applied.filter(item=>item.species===entry.species).at(-1).values;
for(const axis of ['x','y','legLength','head'])assert.ok(Math.abs(adultPreview[axis]-adultBaked[axis])<1e-10,'adult bake preserves preview '+axis);
api.setAgeMode('baby');
assert.ok(Math.abs(api.previewAgeValues(entry).width*liveAdult.get(entry.key).x-savedBaby*1.2)<1e-10,'adult overall bake does not change young world width');
api.setAgeMode('child');
assert.equal(api.overall, 1.15, 'adult bake preserves the separate child draft');
api.bakeOverall();
assert.equal(api.individualAgeValues(entry).width * liveAdult.get(entry.key).x, .5 * 1.15 * 1.2, 'child bake applies the selected draft at the current adult reference');
api.setAgeMode('baby');
api.loadAgeModifiers();
assert.equal(api.ageValues().widthConvergence,0,'pending convergence resets on reload');
assert.ok(Math.abs(api.previewAgeValues(entry).width*liveAdult.get(entry.key).x-savedBaby*1.2)<1e-10,'baked age profile reloads without drift');
console.log('Animation Author age-wide lineup, dropdown selection, runtime sharing, and autosave checks passed.');

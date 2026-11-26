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

// Real garment mesh creation: pants join the foot replay without changing global X-ray layer ranks.
{
  const garmentSource = fs.readFileSync('docs/js/pants-garment-renderer.js', 'utf8'); // Executes the production mesh creation and registration path.
  const start = garmentSource.indexOf('      if (!handle.mesh) {', garmentSource.indexOf('    handle.setAppearance = async next => {'));
  const end = garmentSource.indexOf('      } else {', start);
  assert(start >= 0 && end > start, 'garment creation block is available for the x-ray integration test');
  const createMesh = new Function('THREE', 'handle', 'material', 'avatarGroup', 'global', 'MESH_NAME',
    garmentSource.slice(start, end) + '      }\nreturn handle.mesh;');
  const attached = []; // Tracks meshes made visible before the compositor receives their registration.
  const avatarGroup = { add(mesh) { attached.push(mesh); mesh.parent = this; } };
  const MockMesh = class {
    constructor(geometry, material) {
      this.isMesh = true;
      this.geometry = geometry;
      this.material = material;
      this.userData = {};
      this.layers = { mask: 1 };
    }
  };
  const registered = []; // Production hook must be used instead of faking a color render-order change.
  const runtime = { HeldObjectRenderOrder: { markWaterOccludedMesh(mesh) {
    assert(mesh.parent === avatarGroup, 'pants must be attached before compositor registration');
    registered.push(mesh);
    mesh.userData.hobunjiWaterOccludedBySurface = true;
    return true;
  } } };
  const live = createMesh({ Mesh: MockMesh }, { mesh: null, geometry: {} }, {}, avatarGroup, runtime, 'PantsGarmentMesh');
  assert.strictEqual(registered.length, 1, 'pants register for selective foot-style replay exactly once');
  assert.strictEqual(registered[0], live, 'the real garment is the registered participant');
  assert.strictEqual(attached[0], live, 'the same mesh is attached to the avatar');
  assert.strictEqual(live.userData.hobunjiPantsGarment, true);
  assert.strictEqual(live.userData.hobunjiWaterOccludedBySurface, true);
  assert(live.userData.hobunjiXrayDeformPadding > 0, 'GPU-skinned pants have conservative replay scissor bounds');
  const late = createMesh({ Mesh: MockMesh }, { mesh: null, geometry: {} }, {}, avatarGroup, {}, 'PantsGarmentMesh');
  assert.strictEqual(late.userData.hobunjiWaterOccludedBySurface, true,
    'pants created before the compositor are tagged for the next scene scan');
}

const rendererSource = fs.readFileSync('docs/js/pants-garment-renderer.js', 'utf8'); // Production portrait/feet depth contract, not a synthetic replacement.
assert(rendererSource.includes('const PANTS_REST_PLANE_Z = 0;'),
  'rest garment lies on its owner\'s portrait rather than protruding through it');
assert(rendererSource.includes('point.set((flipped ? 0.5 - portrait.x : portrait.x - 0.5) * dimensions.width, (0.5 - portrait.y) * dimensions.height, PANTS_REST_PLANE_Z);'),
  'the actual placed garment vertices use the neutral portrait depth');
assert(rendererSource.includes('polygonOffsetFactor: 2, polygonOffsetUnits: 2'),
  'coplanar portrait pixels win the tie-break from either viewing direction');
assert(rendererSource.includes('front - PANTS_REST_PLANE_Z + 0.01'),
  'the camera-space foot push follows the same neutral pants depth');

// Shipped data: the starter garment exists with a valid 5-channel weight map, and unknown species fall back to __default.
const rigs = win.HOBUNJI_PANTS_RIGS;
assert(rigs.garments.pants_basic, 'config/pants-rigs.js ships the pants_basic garment');
assert.strictEqual(win.HobunjiPantsRig.decodeWeightGridRle(rigs.garments.pants_basic.weightMap).channels.length, 5);
assert(Renderer.hasRigFor('kenkari', 'male') && Renderer.hasRigFor('some-new-species', 'female'), 'every species resolves to a rig through __default');
assert(Renderer.resolveCharacter('Mao_Ao', 'MALE'), 'species/gender keys are normalized');

// The visible torso (not the stale belt spline) controls the in-game waistband width.
{
  const authored = Renderer.resolveCharacter('nuhongan', 'male'); // Shipped Nuhongan belt remains unchanged in the registry.
  const original = JSON.stringify(authored.portraitBeltSpline); // Guards against accidental mutation of shared authoring data.
  const canvas = { width: 200, height: 200, getContext: () => ({ getImageData: (_x, y, width) => { // Mock the real 1-row alpha scan without browser canvas.
    const pixels = new Uint8Array(width * 4); // Body is an opaque central 100-pixel torso, much wider than its old 64-pixel authored belt.
    if (y <= 183) for (let x = 50; x < 150; x++) pixels[x * 4 + 3] = 255;
    return { data: pixels };
  } }) };
  const result = Renderer.fitBeltToVisibleTorso(authored, canvas); // Production renderer path, not a separate test algorithm.
  assert(result && result.source === 'connected-torso-alpha', 'actual torso silhouette is sampled');
  const left = result.character.portraitBeltSpline[0], right = result.character.portraitBeltSpline[4]; // Five-point waist should expand to the visible alpha edges.
  assert(Math.abs(left.x - .25) <= 1e-9 && Math.abs(right.x - .75) <= 1e-9, 'waist matches the 50% torso width exactly');
  assert(result.character.portraitBeltSpline.every((p, i) => p.y === authored.portraitBeltSpline[i].y), 'fitting the torso width never moves the belt vertically');
  assert(JSON.stringify(authored.portraitBeltSpline) === original, 'runtime silhouette fit does not mutate the authored Nuhongan rig');
  const garment = rigs.garments.pants_basic; // The shipped leg bones define where upper-torso width must stop affecting trousers.
  const point = { x: .34, y: .91 }; // Left authored waist edge in portrait space before the alpha correction.
  const waist = Renderer.taperTorsoBeltPoint(point, { x: .34, y: .28 }, garment, result); // Exact connected-alpha edge at the garment waist.
  const midLeg = Renderer.taperTorsoBeltPoint(point, { x: .34, y: .39 }, garment, result); // Transitional region between belt and knees.
  const kneeY = (garment.legBones.left.knee.y + garment.legBones.right.knee.y) / 2; // Current authored knee row, never a legacy fixed image coordinate.
  const knee = Renderer.taperTorsoBeltPoint(point, { x: .34, y: kneeY + 0.005 }, garment, result); // Immediately below the real knee: zero waist influence.
  const cuff = Renderer.taperTorsoBeltPoint(point, { x: .34, y: garment.legBones.left.ankle.y }, garment, result); // Existing foot opening is independent of waist.
  assert(Math.abs(waist.x - .25) < 1e-9 && waist.y === point.y, 'only waist width changes to match visible torso, not waist height');
  assert(midLeg.x > .25 && midLeg.x < .34 && midLeg.y === point.y, 'torso width eases smoothly into thigh width');
  assert(knee.x === point.x && cuff.x === point.x && knee.y === point.y && cuff.y === point.y,
    'knees, cuffs, and all vertical positions retain their independently authored fit');
  assert(Renderer.fitBeltToVisibleTorso(authored, { width: 200, height: 200, getContext: () => ({ getImageData: () => ({ data: new Uint8Array(800) }) }) }) === null,
    'transparent or disconnected source art correctly retains authored belt width');
  assert(Renderer.fitBeltToVisibleTorso(authored, { width: 200, height: 200, getContext: () => ({ getImageData: () => { throw new Error('tainted'); } }) }) === null,
    'unreadable portrait pixels safely fall back to the authored fit');
  assert(Renderer.fitBeltToVisibleTorso(authored, { width: 200, height: 200, getContext: () => { throw new Error('context unavailable'); } }) === null,
    'unavailable portrait canvas context also falls back without breaking attachment');
}


// Child waist uses the real front portrait (often nested below a wrapper) and inherits body scale exactly once.
{
  const canvas={width:200,height:200,getContext:()=>({getImageData:(_x,y,w)=>{
    const data=new Uint8Array(w*4); // Torso alpha remains normalized even when the whole baby avatar is only 32% adult size.
    if(y<=183)for(let x=50;x<150;x++)data[x*4+3]=255;
    return {data};
  }})};
  const plane={material:{map:{image:canvas}}}; // Front material carries the real source when its parent wrapper does not.
  const baby={userData:{portraitModelWidth:.9*.32},traverse() {}};
  assert.strictEqual(Renderer.portraitSourceCanvas(baby,plane),canvas,'nested front art is found');
  assert.strictEqual(Renderer.portraitSourceCanvas(baby,plane,canvas),canvas,'explicit author canvas takes priority');
  assert.strictEqual(Renderer.portraitSourceCanvas({userData:{sourceCanvas:canvas}},{}),canvas,'existing direct avatar source still works');
  assert.strictEqual(Renderer.portraitSourceCanvas({traverse(fn){fn({userData:{sourceCanvas:canvas}})}},{}),canvas,'nested avatar metadata works');
  const fit=Renderer.fitBeltToVisibleTorso(Renderer.resolveCharacter('nuhongan','male'),Renderer.portraitSourceCanvas(baby,plane));
  assert(fit && fit.source==='connected-torso-alpha');
  assert(Math.abs(fit.width*baby.userData.portraitModelWidth-.144)<1e-9,'fitted baby waistband scales 32% exactly once');
  assert.strictEqual(Renderer.portraitSourceCanvas({},{}),null,'missing canvas falls back to authored waist');
}

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
 const source=fs.readFileSync('docs/js/pants-garment-renderer.js','utf8'); // Exercise the actual garment callback, independent of WebGL.
 const start=source.indexOf('    const depthBiasLimits=new Map();'),end=source.indexOf('    const createMesh =',start);
 assert(start>=0 && end>start,'found scoped-depth owner in production source');
 let revision=0; // Simulates replacing placeholder feet with final GLBs after attaching the pants.
 const pushes=[]; // Records the actual draw-only offsets sent to the leg animator.
 const handle={depthBiasBase:.3,maskUniforms:{uPantsDepthBias:{value:.3}}}; // The original attach-time depth bias must remain unchanged.
 const legHandle={anatomyRevision:()=>revision,setFootDepthPush:value=>pushes.push(value)};
 vm.runInNewContext(source.slice(start,end),{handle,legHandle,cuffsFitted:false,cuffUniforms:null});
 assert(handle.setDepthBiasLimit('close-contact',0));assert.equal(handle.maskUniforms.uPantsDepthBias.value,0);
 assert(handle.setDepthBiasLimit('other',.1));assert.equal(handle.maskUniforms.uPantsDepthBias.value,0);
 assert.equal(handle.setDepthBiasLimit('other',NaN),false);assert.equal(handle.setDepthBiasLimit('other',-1),false);
 revision++;
 assert.equal(handle.refreshFootDepthBias,undefined,'final GLB swap must not recalculate or move feet through the deleted refresh hook');
 assert.equal(handle.depthBiasBase,.3,'original attach-time depth bias remains the baseline after GLB replacement');
 assert.equal(handle.getFootDepthBiasDebug().anatomyRevision,1,'mobile diagnostics still report the current GLB anatomy revision');
 assert.equal(pushes.at(-1),0,'GLB replacement alone cannot change the foot-depth offset');
 handle.setDepthBiasLimit('close-contact',null);assert.equal(handle.maskUniforms.uPantsDepthBias.value,.1);
 handle.setDepthBiasLimit('other',null);assert.equal(handle.maskUniforms.uPantsDepthBias.value,.3,'last release restores the original attach-time pull');
 assert.equal(pushes.at(-1),.3,'original paired-animation scope behavior remains intact');
 assert(!source.slice(start,end).includes('footFrontLift'),'GLB bounds rescans are removed from the scoped-depth owner');
}
{
 const pixelProbe=fs.readFileSync('docs/js/pixel-probe.js','utf8'); // Guards the existing mobile copyable report, not a DevTools-only console API.
 const probeBoot=fs.readFileSync('docs/js/bootstrap/classic-groups/pre-game-diagnostics.js','utf8');
 assert.match(pixelProbe,/Pants\/feet depth:/,'render-only pants depth is shown in the mobile Pixel Probe');
 assert.match(pixelProbe,/getFootDepthBiasDebug/,'Pixel Probe reads the real garment handle rather than a stale cosmetic cache');
 assert.match(probeBoot,/pixel-probe\.js\?v=[A-Za-z0-9_-]+/,'mobile bundle loads the repaired Pixel Probe');
}
{
 const pants=fs.readFileSync('docs/js/pants-garment-renderer.js','utf8'); // Ensure foot GLB replacement no longer triggers depth recalibration.
 const inUpdate=pants.slice(pants.indexOf('    handle.update = (renderOnly = false) => {'),pants.indexOf('    handle.dispose = () => {'));
 assert.doesNotMatch(inUpdate,/refreshFootDepthBias/,'leg animation updates must not shift foot GLBs after replacement');
 assert(inUpdate.includes('!renderOnly && legHandle.getRestStance'), 'render-only pose must not rebind neutral stance');
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

{
  // Execute the production per-component pose detector directly, independently of Three/WebGL.
  // This deliberately constructs opposing thigh motion whose OLD scalar hash cancels almost exactly.
  const source = fs.readFileSync('docs/js/pants-garment-renderer.js', 'utf8'); // Keep the fixture tied to the real renderer source.
  const begin = source.indexOf('    const POSE_EPSILON = 1e-6;'); // Start of the actual live comparison implementation.
  const end = source.indexOf('    handle.restRecheckIn = REST_RECHECK_FRAMES;', begin); // Avoid duplicating the algorithm in this test.
  assert(begin >= 0 && end > begin, 'production per-component pose comparison is available');
  const frames = () => ({ thigh: Array(9).fill(0), calf: Array(9).fill(0) }); // Neutral leg orientation data used by the renderer.
  const joints = () => ({
    hip: { x: 0, y: 0, z: 0 }, knee: { x: 0, y: 0, z: 0 }, ankle: { x: 0, y: 0, z: 0 },
  }); // Neutral joint positions used to prove signed cancellation.
  const handle = { scratch: { frames: { left: frames(), right: frames() } } }; // Only dependency of the extracted live comparator.
  const pose = { left: joints(), right: joints() }; // Two independently animated leg chains.
  const reader = new Function('handle', 'LEG_SIDES', 'LEG_JOINTS', 'BONE_NAMES',
    source.slice(begin, end) + '\nreturn { changed: poseChanged, commit() { lastPoseComponents.set(poseComponents); hasLastPose = true; } };')(
      handle, ['left', 'right'], ['hip', 'knee', 'ankle'], ['thigh', 'calf']);
  assert(reader.changed(pose), 'first frame must skin even at the neutral pose');
  reader.commit();
  assert(!reader.changed(pose), 'unchanged neutral pose should not upload again');
  pose.left.hip.x = 0.0001;
  pose.right.hip.x = -0.0001 * (1.0000001 ** 21); // Weighted inverse of the left hip's contribution in the obsolete hash.
  const oldHash = (() => {
    let signature = 0; // Reproduce the obsolete one-number reduction to prove the cancellation fixture.
    for (const side of ['left', 'right']) {
      for (const joint of ['hip', 'knee', 'ankle']) {
        const p = pose[side][joint]; // Exact same order and coefficients as the removed hash.
        signature = signature * 1.0000001 + p.x * 3.1 + p.y * 5.3 + p.z * 7.7;
      }
      for (const name of ['thigh', 'calf']) for (let k = 0; k < 9; k++)
        signature = signature * 1.0000001 + handle.scratch.frames[side][name][k] * (k + 1.7);
    }
    return signature;
  })();
  assert(Math.abs(oldHash) < 1e-10, 'opposing real bone offsets cancel the prior scalar hash');
  assert(reader.changed(pose), 'the real renderer detects both opposing leg movements independently');
  reader.commit();
  pose.left.hip.x += 5e-8;
  assert(!reader.changed(pose), 'rounding-scale world transform jitter does not trigger reskinning');
  pose.left.hip.x += 0.001;
  assert(reader.changed(pose), 'genuine further leg movement remains detectable');
  console.log('Pants independent pose-change detection: PASS');
}

{ // Exact seam constraints must be installed before the shared CPU/GPU vertex buffers are built.
  const source = fs.readFileSync('docs/js/pants-garment-renderer.js', 'utf8');
  const from = source.indexOf('    // Prepare the shared CPU/GPU seam constraints');
  const to = source.indexOf('    installGpuSkin(THREE, handle, gpuSkin);', from);
  const gpuFrom = source.indexOf('  function installGpuSkin('), gpuTo = source.indexOf('  function gpuSkinUsable(', gpuFrom);
  assert(from >= 0 && to > from && gpuFrom >= 0 && gpuTo > gpuFrom, 'seam preparation precedes GPU upload');
  const prepare = new Function('handle', 'garment', 'LEG_SIDES', 'fitCuffs', 'cameraCuffs', source.slice(from, to));
  const install = new Function(source.slice(gpuFrom, gpuTo) + '; return installGpuSkin;')();
  const garment = rigs.garments.pants_basic, sides = ['left', 'right'];
  for (const segments of [16, 32, 64]) {
    const stride = segments + 1, count = stride * stride;
    const sample = point => {
      const x = Math.min(segments - 1, Math.floor(point.x * segments)), y = Math.min(segments - 1, Math.floor(point.y * segments));
      return { i: y * stride + x, fx: point.x * segments - x, fy: point.y * segments - y };
    };
    const corners = p => [p.i, p.i + 1, p.i + stride, p.i + stride + 1];
    const attrs = new Map(), weights = new Float32Array(count * 5).fill(.2);
    const handle = { segments, weights, basePositions: new Float32Array(count * 3), maskUniforms: {},
      rings: { left: { influence: new Float32Array(count).fill(.5) }, right: { influence: new Float32Array(count).fill(.5) } },
      splineSpec: { belt: { samples: garment.pantsBeltSpline.map(sample) }, leftAnkle: { samples: garment.legOpenings.left.map(sample) }, rightAnkle: { samples: garment.legOpenings.right.map(sample) } },
      geometry: { setAttribute(name, attr) { attrs.set(name, attr); } } };
    prepare(handle, garment, sides, true, false);
    const THREE = { BufferAttribute: class { constructor(array) { this.array = array; } }, Vector3: class {}, Matrix3: class {} };
    install(THREE, handle, true);
    for (const p of handle.splineSpec.belt.samples) for (const i of corners(p)) {
      assert.strictEqual(weights[i * 5], 1, 'all interpolated waist vertices are rigid');
      assert.strictEqual(handle.waistWidthInfluence[i], 1, 'all waist corners receive the entire horizontal correction');
      assert.strictEqual(handle.rings.left.influence[i] + handle.rings.right.influence[i], 0, 'cuffs cannot shift the waist');
    }
    const left = new Set(handle.splineSpec.leftAnkle.samples.flatMap(corners));
    const right = new Set(handle.splineSpec.rightAnkle.samples.flatMap(corners));
    for (const side of sides) for (const i of side === 'left' ? left : right) {
      if (left.has(i) && right.has(i)) continue; // A genuinely shared grid corner cannot belong exclusively to both cuffs.
      assert.strictEqual(weights[i * 5 + (side === 'left' ? 2 : 4)], 1, 'all unshared cuff sample vertices follow one calf');
      assert.strictEqual(handle.rings[side].influence[i], 1, 'ring correction translates all cuff corners uniformly');
    }
    for (let i = 0; i < count; i++) {
      assert.strictEqual(attrs.get('pantsSkinW0').array[i * 4], weights[i * 5], 'GPU and CPU agree on waist ownership');
      assert.strictEqual(attrs.get('pantsSkinW0').array[i * 4 + 2], weights[i * 5 + 2], 'GPU and CPU agree on left calf ownership');
      assert.strictEqual(attrs.get('pantsSkinW1').array[i], weights[i * 5 + 4], 'GPU and CPU agree on right calf ownership');
      assert.strictEqual(attrs.get('pantsRingInfluence').array[i * 2], handle.rings.left.influence[i], 'GPU ring uses the finalized left field');
      assert.strictEqual(attrs.get('pantsRingInfluence').array[i * 2 + 1], handle.rings.right.influence[i], 'GPU ring uses the finalized right field');
    }
  }
  console.log('Pants sampled seams and GPU/CPU parity: PASS');
}

{ // Verify the production torso and shoe measurement code, without a browser or Three.js version dependency.
  const source = fs.readFileSync('docs/js/procedural-leg-animation.js', 'utf8');
  const scan = new Function(source.slice(source.indexOf('  function scanWidestOpaqueRow('), source.indexOf('  function pixelToModelX(')) + '; return scanWidestOpaqueRow;')();
  const width = 100, height = 100, pixels = new Uint8Array(width * height * 4);
  const fill = (y, l, r, a = 255) => { for (let x = l; x < r; x++) pixels[(y * width + x) * 4 + 3] = a; };
  for (let y = 10; y < 80; y++) fill(y, 5, 95); // Broad upper torso must not set the lower belt width.
  for (let y = 80; y < 90; y++) fill(y, 20, 76);
  for (let y = 90; y < 98; y++) fill(y, 30, 65, 12); // Faint fringe is not opaque.
  const canvas = { width, height, getContext: () => ({ getImageData: () => ({ data: pixels }) }) };
  const fit = scan(canvas, 8);
  assert.strictEqual(fit.beltBounds.left, .2);
  assert.strictEqual(fit.beltBounds.right, .76);
  assert(fit.rightMedian > fit.leftMedian, 'existing stance scan still produces medians');
  const cache = new Function(source.slice(source.indexOf('  function cacheFootGroundSupport('), source.indexOf('  function rolledSoleOffset(')) + '; return cacheFootGroundSupport;')();
  const positions = [[1, -1, 0], [-1, 1, 0], [0, .5, 0]];
  const vertex = { count: positions.length, getX: i => positions[i][0], getY: i => positions[i][1], getZ: i => positions[i][2] };
  const box = { min: { x: -2, y: -1, z: 0 }, max: { x: 2, y: 1, z: 0 } };
  const mesh = { isMesh: true, geometry: { attributes: { position: vertex }, boundingBox: box }, matrixWorld: { elements: [.5, 0, 0, 0, .5, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } };
  const foot = { userData: {}, traverse: fn => fn(mesh) };
  class Box3 { setFromObject() { this.min = box.min; this.max = box.max; return this; } isEmpty() { return false; } }
  cache({ Box3 }, foot);
  assert.strictEqual(foot.userData.cuffWidthX, .25, 'rotated geometry uses projected vertices rather than a loose transformed bounding box');
  assert.strictEqual(foot.userData.contactRadiusY, 1, 'foot width measurement does not alter ground support');
  assert(fs.readFileSync('docs/js/pixel-probe.js', 'utf8').includes('Pants seam fit (neutral local units):'), 'measured widths are included in the mobile report');
  console.log('Pants isolated torso and foot vertex measurements: PASS');
}

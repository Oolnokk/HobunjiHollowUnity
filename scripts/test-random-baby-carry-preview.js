#!/usr/bin/env node
'use strict';
// Random Baby previews use the actual NPC portrait pipeline without changing grip or furniture data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('docs/tools/furniture-avatar-author/carryable-objects.js', 'utf8');
const html = fs.readFileSync('docs/tools/furniture-avatar-author/index.html', 'utf8');
const profileSource = fs.readFileSync('docs/config/family-baby-carry-pose.js', 'utf8'); // Shared authoritative portrait-unit conversion.
const start = source.indexOf('  function availableBabyIdentities() {');
const end = source.indexOf('  function editBaby(){', start);
assert(start >= 0 && end > start, 'random baby renderer is a separable, testable editor function');
assert.match(source, /id="carryBabyRandom">Random Baby<\/button>/, 'touch-accessible Random Baby control exists');
assert.match(source, /el\('carryBabyRandom'\)\.onclick=\(\)=>\{void randomBaby\(\);\}/, 'button actually runs the preview generator');
assert.match(html, /romance-config\.js\?v=/, 'editor loads the existing family newborn proportions');
assert(html.indexOf('scratchbones-config.js') < html.indexOf('romance-config.js'),
  'family scale configuration is loaded after the base Scratchbones config');
assert.match(source, /if\(!babyPortraitModel\)void randomBaby\(\)/,
  'entering infant authoring provides a real NPC preview, not only the blue silhouette');
assert.match(source, /returnToFurniture\(\)[\s\S]*?babyRenderTicket\+\+/,
  'switching back cancels an asynchronous random portrait render');

const controls = { carryBabyRandom: { disabled: false }, carryBabyStatus: { textContent: '' } };
const children = [], disposed = [], warnings = [], messages = [];
const reference = {
  add(model) { children.push(model); model.parent = this; },
  remove(model) { const index = children.indexOf(model); if (index >= 0) children.splice(index, 1); model.parent = null; },
};
const guide = { visible: true };
let frames = 0, syncs = 0, artLoads = 0, backFails = false, modelBuilds = 0, refreshes = 0;
let pendingRender = null; // Optional deferred render controls an exit/reroll race without timers.
const colorSource = {};
const window = {
  HOBUNJI_ASSET_BASE: '../../assets/', HOBUNJI_CONFIG_BASE: '../../config/',
  SCRATCHBONES_CONFIG: { game: { appearanceEditor: { species: {
    'mao-ao': { genders: ['male', 'female'] },
    'engh-sho': { genders: ['female'] },
  } } } },
  HobunjiRomanceConfig: { family: { phaseScales: { basket: { body: .32, head: .58 } } } },
  getPortraitFighters() { return [
    {speciesId:'mao-ao',gender:'male'}, {speciesId:'mao-ao',gender:'female'},
    {speciesId:'engh-sho',gender:'female'}, {speciesId:'unlisted',gender:'male'},
  ]; },
  NpcAvatarPreview: {
    async ensurePortraitCosmetics() { artLoads++; },
    randomProfile(seed, identity) { return {seed,identity}; },
    async renderProfileToCanvas(canvas, profile, options) {
      canvas.profile = profile;
      if(options?.portraitView === 'behind' && backFails)throw Error('rear unavailable');
      if(pendingRender && !options?.portraitView)await new Promise(resolve => { pendingRender.resolve = resolve; });
    },
  },
  PNGPlaneAvatar: {
    buildSinglePlaneAvatarModel(T, front, options) {
      const model = {
        userData: {
          portraitModelWidth: ++modelBuilds % 2 ? .288 : .216,
          portraitModelHeight: modelBuilds % 2 ? .288 : .216, // Different species sizes exercise true newborn scale.
          neckRig: { headScaleJoint: { scale: {setScalar(v) { model.headFactor = v; }} },
          },
        },
        scale: {x:1,y:1,setScalar(v) {this.x=v;this.y=v;}}, position: {y:0},
        traverse(fn) { fn({isMesh:true,userData:colorSource}); },
      };
      model.options = options; return model;
    },
  },
};
new Function('window',profileSource)(window); // Load the real shared profile API, not a duplicate test-only scaler.
const state={ carryable: window.FamilyBabyCarryPose.forSize(.3,.3) }; // Existing editor draft initially represents a .30-unit placeholder.
const three = { Mesh: class{}, PlaneGeometry: class{}, MeshBasicMaterial: class{}, CanvasTexture: class{}, DoubleSide: 2 };
const mockDocument = { createElement(tag) {assert.equal(tag,'canvas');return {width:0,height:0};} };
const environment = new Function('window','document','THREE','Math','el','babyReference','babyReferencePlane',
  'syncHoldingPreview','frameHoldingPreview','disposeObject','log','state','refreshGuides','renderControls', `
  const BABY_REFERENCE_WIDTH=.3,BABY_REFERENCE_HEIGHT=.3;
  let editingBaby=true,babyRenderTicket=0,babyPreviewRolls=0,babyPreviewStatus='',babyPortraitModel=null;
  let babyPortraitWidth=BABY_REFERENCE_WIDTH,babyPortraitHeight=BABY_REFERENCE_HEIGHT,babyFrontCanvas=null;
  ${source.slice(start,end)}
  return {randomBaby,availableBabyIdentities,get status(){return babyPreviewStatus;},
    exit(){editingBaby=false;babyRenderTicket++;},
    enter(){editingBaby=true;},get count(){return babyPreviewRolls;},
    get dimensions(){return [babyPortraitWidth,babyPortraitHeight];},
    get portrait(){return babyFrontCanvas;},
    get current(){return babyPortraitModel;}};
`)(window,mockDocument,three,Math,id=>controls[id],reference,guide,()=>syncs++,()=>frames++,
  object=>disposed.push(object),(message,type)=>{messages.push(message);if(type==='warn')warnings.push(message);},
  state,()=>refreshes++,()=>refreshes++);

(async () => {
  const originalGrips = window.FamilyBabyCarryPose.toProfile(state.carryable,.3,.3); // Portrait U/V/depth must survive every species reroll.
  const stable = value => JSON.stringify(value,(_key,item)=>typeof item==='number'?Number(item.toFixed(8)):item); // Ignore harmless IEEE-754 division/multiplication rounding.
  assert.equal(environment.availableBabyIdentities().length,3,'only gender-valid loaded portrait species can be rolled');
  assert.equal(await environment.randomBaby(),true);
  const first = environment.current;
  assert(first && children.length===1,'one real portrait model replaces the reference silhouette');
  assert.equal(first.headFactor,.58/.32,'newborn head proportions follow actual family configuration');
  assert.equal(first.options.npcRecord.childBodyScale,.32,'newborn body uses shared family phase scale');
  assert.equal(first.options.neckRig,true,'infant portrait uses the existing head scaling bone');
  assert.equal(colorSource.noOutline,true,'PNG already has author ink and must not receive generated shell');
  assert.equal(guide.visible,false,'original blue reference is hidden when generated art exists');
  assert.equal(first.scale.x,1,'a newborn already scaled by PNGPlaneAvatar must not be scaled to the arbitrary .30 reference');
  assert.equal(first.position.y,.288/2,'newborn stays at its actual portrait-height placement');
  assert.equal(environment.dimensions[0],.288,'initial portrait width comes from the existing PNGPlaneAvatar dimensions');
  assert.equal(state.carryable.handTargets.left.x,.288*.4,'the grip uses the actual baby width');
  assert.equal(stable(window.FamilyBabyCarryPose.toProfile(state.carryable,.288,.288)),stable(originalGrips),
    'baby grip U/V/depth remain unchanged while resolving a placeholder into a real baby');
  assert.equal(await environment.randomBaby(),true,'subsequent random baby replaces the current preview');
  assert(environment.current!==first,'two rolls create different preview model instances');
  assert.equal(environment.dimensions[0],.216,'smaller species keep their physically smaller portrait width');
  assert.equal(environment.current.scale.x,1,'randomizing a smaller species never expands it to .30 units');
  assert.equal(state.carryable.handTargets.left.x,.216*.4,'grip tracks the new portrait size instead of staying at an arbitrary world X');
  assert.equal(stable(window.FamilyBabyCarryPose.toProfile(state.carryable,.216,.216)),stable(originalGrips),
    'unsaved grip coordinates survive random species size changes');
  assert(disposed.includes(first),'previous preview geometry is released');
  assert.equal(children.length,1,'no accumulating portraits between random rolls');

  // Slow first render cannot reappear after the editor returns to furniture.
  pendingRender={resolve:null};
  const inFlight=environment.randomBaby();
  await Promise.resolve(); await Promise.resolve();
  environment.exit();
  pendingRender.resolve?.();
  await inFlight;
  assert.equal(children.length,1,'a discarded async child render never inserts new art');
  assert.equal(controls.carryBabyRandom.disabled,true,'outside baby mode the button stays disabled');
  environment.enter();
  pendingRender=null;
  backFails=true;
  assert.equal(await environment.randomBaby(),true,'missing rear art uses colored front fallback');
  assert.equal(environment.current.options.backCanvas,null,'failed rear art is not passed as a blank texture');
  assert(artLoads>=3 && frames>=2 && syncs>=2,'real portrait generation updates the actual editor preview');
  assert.match(controls.carryBabyStatus.textContent,/Grips unchanged/,'mobile status explains non-destructive behavior');
  console.log('PASS Random Baby appearance, family scaling, reroll cleanup, stale async guard and mobile status');
})().catch(error=>{console.error(error);process.exitCode=1;});

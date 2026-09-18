const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/outdoor-livestock-welfare.js', 'utf8');
const bridgeSource = fs.readFileSync('docs/js/livestock-nursery-install-bridge.js', 'utf8');
assert.match(bridgeSource, /globalKey: 'OutdoorLivestockWelfare'/, 'farm feature bridge loads outdoor livestock welfare');
assert(bridgeSource.indexOf('installOutdoorLivestockWelfare();') < bridgeSource.indexOf('installNursery();'), 'outdoor welfare installs before Nursery so daily wrappers compose deterministically');

let night = false;
let saveCount = 0;
let traverseCount = 0; // Confirms welfare material lookup is cached instead of traversing the avatar every frame.
let originalCompileRenderer = null; // Confirms the wrapped Three.js compile hook preserves its renderer argument.
const livestock = [{
  id: 'u1', kind: 'uumkaoii', name: 'Field Uumkao', lifeStage: 'adult', barnId: null,
  troughIndex: null, heartLevel: 2, resourceReady: false, resourceTicks: 0,
  dewReady: true, dewDaysUntil: 0, dewReadyStaleDays: 2,
}];
const buildings = [{ id: 'barn1', kind: 'barn', stage: 'built', tier: 'small' }];
const worldObjects = new Map();
const animalObjects = new Set();

function makeMaterial() {
  return {
    userData: {}, needsUpdate: false,
    onBeforeCompile(_shader, renderer) { originalCompileRenderer = renderer; },
    customProgramCacheKey() { return 'base'; },
  };
}
const material = makeMaterial();
const group = {
  visible: true,
  scale: { x: 1, y: 1, z: 1 },
  position: { x: 0, y: 1, z: 0 },
  children: [{ material }],
  traverse(fn) { traverseCount++; fn(this); for (const child of this.children) fn(child); },
};
const animal = {
  livestockId: 'u1', col: 4, row: 4, targetCol: 5, targetRow: 4,
  wanderTargetCol: 5, wanderTargetRow: 4, wanderPhase: 'walk', wanderWaitT: 1,
  groundLift: 1, avatarRef: { group }, baseTicks: 0, baseUpdates: 0,
  tick() { this.baseTicks++; },
  update() {
    this.baseUpdates++;
    this.avatarRef.group.scale.y = 1;
    this.avatarRef.group.position.y = 1;
  },
  reset() {},
};
animalObjects.add(animal);
worldObjects.set('4,4', animal);

const FarmAnimals = {
  init(injectedDeps) { this.deps = injectedDeps; },
  tickResources() {
    for (const entry of livestock) if (entry.barnId) entry.resourceTicks = (entry.resourceTicks || 0) + 1;
    this.deps.saveWorldLivestock(livestock);
  },
  tickHearts() {
    for (const entry of livestock) if (entry.barnId) entry.heartLevel -= 0.2;
    this.deps.saveWorldLivestock(livestock);
  },
  respawnWorldLivestock() {},
  assignToBarn(id, barnId) {
    const entry = livestock.find(item => item.id === id);
    entry.barnId = barnId;
    return { ok: true, message: 'Assigned.' };
  },
};

const context = {
  window: {
    FarmAnimals,
    Music: { isNightTime: () => night },
  },
  console,
  Math,
  Number,
  Object,
  Array,
  Set,
  Map,
  String,
  Date,
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'outdoor-livestock-welfare.js' });

const deps = {
  loadWorldLivestock: () => livestock,
  saveWorldLivestock: () => { saveCount++; },
  getFarmBuildings: () => buildings,
  animalObjects,
  worldObjects,
  UUMKAOII_DEW_COOLDOWN_DAYS: 3,
};
context.window.FarmAnimals.init(deps);
const traversesAfterInit = traverseCount; // Baseline used after repeated visual updates to catch accidental per-frame traversal.

const rendererToken = { id: 'renderer' }; // Stand-in passed through the wrapped onBeforeCompile hook.
const shader = {
  uniforms: {},
  fragmentShader: 'void main() {\n  vec4 diffuseColor = vec4(1.0);\n  #include <map_fragment>\n}',
}; // Minimal MeshBasic-style fragment source used to validate real GLSL declarations and injection.
material.onBeforeCompile(shader, rendererToken);
assert.strictEqual(originalCompileRenderer, rendererToken, 'welfare compile wrapper preserves Three renderer argument');
assert.match(shader.fragmentShader, /uniform float outdoorLivestockLighten;/, 'lightening uniform is declared in GLSL, not only attached to shader.uniforms');
assert.match(shader.fragmentShader, /uniform float outdoorLivestockDesaturation;/, 'desaturation uniform is declared in GLSL, not only attached to shader.uniforms');
assert.match(shader.fragmentShader, /mix\(diffuseColor\.rgb, vec3\(outdoorLivestockGray\), outdoorLivestockDesaturation\)/, 'welfare shader modifies mapped sprite RGB after map sampling');
assert(shader.fragmentShader.includes('if (any(greaterThan(diffuseColor.rgb, vec3(0.04)))) {'), 'near-black mapped sprite pixels bypass outdoor pallor through the 0.04 per-channel threshold');
assert(shader.fragmentShader.indexOf('if (any(greaterThan(diffuseColor.rgb, vec3(0.04)))) {') < shader.fragmentShader.indexOf('float outdoorLivestockGray ='), 'near-black guard wraps both welfare color operations');
assert(shader.uniforms.outdoorLivestockLighten, 'compiled shader receives live lightening uniform');
assert(shader.uniforms.outdoorLivestockDesaturation, 'compiled shader receives live desaturation uniform');

context.window.FarmAnimals.tickHearts();
assert.equal(livestock[0].outdoorNeglectNights, 1, 'first outdoor midnight records one neglect step');
assert.equal(livestock[0].outdoorProductionLocked, true, 'first outdoor midnight locks production');
assert.equal(livestock[0].dewReady, false, 'first outdoor midnight disarms an already-ready dew drop');
assert.equal(livestock[0].dewDaysUntil, 3, 'disarmed dew restarts from the authored cooldown');

context.window.FarmAnimals.tickResources();
assert.equal(livestock[0].resourceTicks, 0, 'outdoor animals cannot advance resource production');
assert.equal(livestock[0].barnId, null, 'temporary production blocking never persists a fake barn id');

night = true;
animal.tick(1 / 60);
assert.equal(animal.baseTicks, 0, 'outdoor animals stop wandering at night instead of despawning into a barn');
assert.equal(group.visible, true, 'outdoor sleeping animal remains visible in the field');
animal.update(1);
assert(group.scale.y < 0.6, 'night update visibly squashes the outdoor animal into the sleep pose');
assert(group.position.y < 1, 'sleep/neglect squashing lowers the center so the animal stays ground-anchored');

night = false;
animal.update(1);
assert(group.scale.y < 1 && group.scale.y > 0.9, 'daytime outdoor animal keeps the first-step awake height penalty');
assert(material.userData.outdoorLivestockWelfare.lighten > 0, 'outdoor neglect lightens the mapped sprite');
assert(material.userData.outdoorLivestockWelfare.desaturation > 0, 'outdoor neglect desaturates the mapped sprite');

for (let i = 0; i < 4; i++) context.window.FarmAnimals.tickHearts();
animal.update(2);
assert(Math.abs(group.scale.y - 0.8) < 0.01, 'five outdoor midnights approach exactly 80% awake Y scale');
assert(Math.abs(material.userData.outdoorLivestockWelfare.lighten - 0.25) < 0.01, 'full neglect approaches 25% lightening');
assert(Math.abs(material.userData.outdoorLivestockWelfare.desaturation - 0.5) < 0.01, 'full neglect approaches 50% desaturation');
assert(Math.abs(shader.uniforms.outdoorLivestockLighten.value - 0.25) < 0.01, 'compiled shader receives the eased lightening value');
assert(Math.abs(shader.uniforms.outdoorLivestockDesaturation.value - 0.5) < 0.01, 'compiled shader receives the eased desaturation value');
assert.equal(traverseCount, traversesAfterInit, 'repeated welfare updates reuse cached materials without per-frame hierarchy traversals');

context.window.FarmAnimals.assignToBarn('u1', 'barn1');
context.window.FarmAnimals.tickResources();
assert.equal(livestock[0].resourceTicks, 0, 'rehousing alone does not restore production before a barn night');
assert.equal(livestock[0].outdoorProductionLocked, true, 'production remains locked until nightly barn upkeep completes');
animal.update(1);
assert(Math.abs(group.scale.y - 0.8) < 0.01, 'rehousing alone does not visually heal accumulated outdoor neglect before the recovery night');
assert(Math.abs(material.userData.outdoorLivestockWelfare.lighten - 0.25) < 0.01, 'rehoused locked animal retains its outdoor lightening until the recovery night');

context.window.FarmAnimals.tickHearts();
assert.equal(livestock[0].outdoorProductionLocked, false, 'one real barn night clears the production lock');
assert.equal(livestock[0].outdoorNeglectNights, 0, 'barn recovery clears accumulated outdoor visual steps');
context.window.FarmAnimals.tickResources();
assert.equal(livestock[0].resourceTicks, 1, 'production advances again after the recovery night');

animal.update(2);
assert(group.scale.y > 0.99, 'recovered housed animal eases back to normal awake height');
assert(material.userData.outdoorLivestockWelfare.lighten < 0.01, 'recovery eases lightening back out');
assert(material.userData.outdoorLivestockWelfare.desaturation < 0.01, 'recovery eases desaturation back out');

const debug = context.window.OutdoorLivestockWelfare.debugSnapshot();
assert.match(debug.mostRecentChange, /compile-safe cached sprite uniforms/i, 'mobile debug snapshot names the audited visual fix');
assert.equal(debug.constants.fullNeglectNights, 5, 'debug snapshot exposes the five-step tuning');
assert.equal(debug.constants.blackPreserveMax, 0.04, 'debug snapshot exposes the near-black pallor exclusion threshold');
assert.equal(debug.adults[0].cachedMaterialCount, 1, 'debug snapshot exposes cached welfare material count for mobile performance checks');
assert(saveCount > 0, 'outdoor welfare state persists through the existing livestock save seam');

console.log('outdoor livestock welfare regression tests passed');

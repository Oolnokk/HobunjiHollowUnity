// Mao'ao Skeleton: NPC-only skeleton species on the shared skeleton bridge
// (js/skeleton-species-runtime.js), drawn with the authored maoskel sprites.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const species = JSON.parse(read('docs/config/species/mao-ao-skeleton.json'));
const index = JSON.parse(read('docs/config/species/index.json'));

assert(index.entries.some(entry => entry.speciesId === 'mao-ao-skeleton' && entry.path === './mao-ao-skeleton.json'), 'species is registered');
assert.equal(species.parentSpecies, 'mao-ao');
assert.equal(species.npcOnly, true);
assert.equal(species.playerSelectable, false);
assert.deepEqual(species.genders, ['male'], 'only male maoskel sprites are authored');
const sprites = [species.male.headSprite, ...species.male.portraitBodyLayers.map(layer => layer.url)];
for (const sprite of sprites) {
  assert(/maoskel/.test(sprite), `${sprite} is a maoskel sprite`);
  assert(fs.existsSync(path.join(root, 'docs/assets', sprite)), `${sprite} exists`);
}
assert.equal(species.male.baseBodyTint, false, 'authored bone colors are not recolored');
assert.equal(species.male.bodyColorRanges.fixedHex, '#BDBDB3');

const context = {
  console,
  SCRATCHBONES_CONFIG: { game: { appearanceEditor: { species: {} }, portrait: {}, assets: { pngPlaneAvatar: { proceduralFeet: { species: { 'mao-ao': { glb: 'assets/models/feet/foot_mao.glb' } } }, behindView: { headUrls: {} } } } } },
  HobunjiHandModelProfiles: { data: { speciesModels: { 'mao-ao': 'canine' } }, mutate(fn) { fn(this.data); } },
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { characters: { 'mao-ao::male': { species: 'mao-ao', gender: 'male', anatomy: { rigScaleX: 0.9, headScale: 1 } } } },
  PortraitArmCloudMask: { authoredProfiles: { 'mao-ao:male': { maskYScaleMultiplier: 0.99, seed: 660632132 } } },
  resolveOptionLayers: (_option, fighter) => fighter.speciesId,
};
context.window = context;
vm.createContext(context);
vm.runInContext(read('docs/js/skeleton-species-runtime.js'), context);
vm.runInContext(read('docs/js/mao-ao-skeleton-species-runtime.js'), context);

const appearance = context.SCRATCHBONES_CONFIG.game.appearanceEditor.species['mao-ao-skeleton'];
assert.equal(appearance.npcOnly, true);
assert.deepEqual(Array.from(appearance.genders), ['male']);
assert.equal(context.HobunjiHandModelProfiles.data.speciesModels['mao-ao-skeleton'], 'canine', "hands inherit Mao'ao's model");
assert.equal(context.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.proceduralFeet.species['mao-ao-skeleton'].glb, 'assets/models/feet/foot_mao.glb', "feet inherit Mao'ao's model");
const rig = context.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters['mao-ao-skeleton::male'];
assert(rig && rig.species === 'mao-ao-skeleton' && rig.anatomy.rigScaleX === undefined, "rig clones Mao'ao without its whole-rig scale");
assert.equal(context.SCRATCHBONES_CONFIG.game.portrait.armOnlyOpacityMask.profiles['mao-ao-skeleton:male'].seed, 660632132, "arm mask inherits Mao'ao's authored profile");
assert.equal(context.resolveOptionLayers({}, { speciesId: 'mao-ao-skeleton', gender: 'male' }), 'mao-ao', "clothing resolves through Mao'ao art");
assert.equal(context.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.behindView.headUrls['mao-ao-skeleton'], undefined, 'no rear skull authored yet');

vm.runInContext(read('docs/config/character-rig-scale-defaults.js'), context);
const scale = context.HobunjiCharacterRigScaleDefaults.scaleFor('mao-ao-skeleton', 'male');
const maoScale = context.HobunjiCharacterRigScaleDefaults.scaleFor('mao-ao', 'male');
assert.equal(scale.x, maoScale.x, "shares Mao'ao's whole-rig scale");

const bootstrap = read('docs/js/attachment-rig-latest-authored-snapshot.js');
const at = name => bootstrap.search(new RegExp(name.replace(/\./g, '\\.') + '\\?v=[A-Za-z0-9_.-]+'));
assert(at('skeleton-species-runtime.js') >= 0 && at('skeleton-species-runtime.js') < at('mao-ao-skeleton-species-runtime.js') && at('mao-ao-skeleton-species-runtime.js') < at('character-rig-scale.js'), 'shared bridge loads first, before whole-rig scale');

// Minion rosters respect a species' single authored gender.
const minionContext = { console, Math, SCRATCHBONES_CONFIG: context.SCRATCHBONES_CONFIG };
minionContext.window = minionContext;
vm.createContext(minionContext);
vm.runInContext(read('docs/js/combat/combat-minion.js'), minionContext);
for (let i = 0; i < 20; i++) assert.equal(minionContext.MinionCombat.rollRoster('mao-ao-skeleton', 'Skel').appearance.gender, 'male', 'male-only skeletons always roll male');
console.log("PASS mao-ao-skeleton species");

'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = path => fs.readFileSync(path, 'utf8'); // Reads the shipping registry modules, not duplicate species fixtures.
const window = {HobunjiHandModelProfiles: {data: {speciesModels: {mashtzarr: 'mashtzarr'}}, mutate(fn) {fn(this.data);}}}; // Models the shared hand registry used by the authored rig bootstrap.
const context = {window, console, setInterval() {return 0;}, clearInterval() {}}; // All anatomy/placement corrections below execute against the actual configured profiles.
for (const file of ['docs/config/scratchbones-config.js', 'docs/config/attachment-rig-profiles.js', 'docs/js/attachment-rig-latest-authored-snapshot-core.js', 'docs/config/character-rig-scale-defaults.js']) vm.runInNewContext(read(file), context, {filename: file});
const donors = JSON.parse(JSON.stringify(window.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters)); // Proves installing a larger relative never changes existing Mashtzarr anatomy.
vm.runInNewContext(read('docs/js/mammakhbuur-species-runtime.js'), context);
for (const gender of ['male','female']) {
  const donor = donors['mashtzarr::' + gender]; // Compares against the fully authored donor including snapshot corrections.
  const mamm = window.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters['mammakhbuur::' + gender];
  assert(mamm, gender + ' rig is installed');
  assert.equal(mamm.anatomy.portraitVerticalPlacementRatio, donor.anatomy.portraitVerticalPlacementRatio * 1.25);
  assert.equal(window.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.portraitVerticalPlacement.mammakhbuur[gender], donor.anatomy.portraitVerticalPlacementRatio * 1.25);
  for (const key of ['x','y','head']) assert.equal(window.HobunjiCharacterRigScaleDefaults.scaleFor('mammakhbuur',gender)[key],window.HobunjiCharacterRigScaleDefaults.scaleFor('mashtzarr',gender)[key] * 1.25);
  const height = donor.shoulderPerchRule.portraitModelHeight || 1; // Shoulder anchors must rise along with the portrait rather than leaving detached arms.
  assert.equal(mamm.anchors.rightHandShoulder.position.y, donor.anchors.rightHandShoulder.position.y + height * donor.anatomy.portraitVerticalPlacementRatio * .25);
  assert.equal(mamm.anchors.posterior.position.y, donor.anchors.posterior.position.y, 'floor-relative posterior remains on the floor');
  assert.deepEqual(JSON.parse(JSON.stringify(window.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters['mashtzarr::' + gender])), donor);
}
assert.equal(window.HobunjiHandModelProfiles.data.speciesModels.mammakhbuur, 'mashtzarr');
assert.equal(window.SCRATCHBONES_CONFIG.game.appearanceEditor.species.mammakhbuur.label, 'Mammakhbuur');
const species = JSON.parse(read('docs/config/species/mammakhbuur.json')); // Future heads retain separate primary identities while donor art fills in today.
assert.equal(species.parentSpecies, 'mashtzarr');
for (const gender of ['male','female']) {
  assert.match(species[gender].headSprite,/mammakhbuur/);
  for (const fallback of species[gender].headFallbackUrls) assert(fs.existsSync('docs/assets/' + fallback));
}
// Execute the actual portrait image-load branch to simulate the not-yet-authored head returning 404.
const portrait = read('docs/js/portrait-utils.js'); // Isolates only loading, before canvas composition.
const start = portrait.indexOf('  let imgMap;\n');
const end = portrait.indexOf('  // Load mouth expression', start);
const image = {}; // Donor image identity must be registered under the future primary URL for composition.
const cache = new Map();
const loader = {neededUrls: new Set(['future-head']), IMG_CACHE: cache, Image: class {}, headUrl:'future-head', resolvedFighter: {headFallbackUrls:['mashtz-head']}, fighter:{}, console, loadImg: async url => {if(url==='future-head') throw Error('404'); return image;}};
vm.runInNewContext('(async () => {' + portrait.slice(start,end) + '\nreturn imgMap;})()',loader).then(images => {
  assert.equal(images.get('future-head'), image);
  assert.equal(cache.get('future-head'), image);
  console.log('Mammakhbuur rigs, placement, player registry and future-head fallback passed.');
}).catch(error => {console.error(error);process.exitCode=1;});

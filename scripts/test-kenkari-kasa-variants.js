#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm'); // Executes the actual portrait parser.
const read = path => fs.readFileSync(path, 'utf8');
const context = vm.createContext({ window: {}, console });
vm.runInContext(read('docs/config/scratchbones-config.js'), context);
vm.runInContext(read('docs/js/portrait-utils.js'), context);
const catalog = context.window.SCRATCHBONES_CONFIG.game.account.shopCatalog;
const entries = JSON.parse(read('docs/config/cosmetics/index.json')).entries; // Keep legacy save assets available.
for (const type of ['low', 'wide']) {
  const id = 'appearance::hat::riverlandskasa_' + type; // The only newly purchasable item for this style.
  const option = context.portraitOptionFromJson({ id }, JSON.parse(read('docs/config/cosmetics/riverlandskasa_' + type + '.json')));
  assert(catalog.some(item => item.id === id), 'the canonical item is still sold');
  const ordinary = Array.from(context.resolveOptionLayers(option, { speciesId: 'mao-ao', gender: 'female' }));
  assert(ordinary.length === 2 && ordinary.every(layer => !layer.url.includes('kenk_')), 'non-Kenkari art is unchanged');
  for (const speciesId of ['kenkari', 'rakakoan']) for (const gender of ['male', 'female']) {
    const layers = Array.from(context.resolveOptionLayers(option, { speciesId, gender }));
    assert(layers.length === 2 && layers.every(layer => layer.url.includes('kenk_riverlandskasa_' + type)), speciesId + ' ' + gender + ' uses Kenkari sprites');
  }
  for (const gender of ['M', 'F']) {
    const oldId = 'appearance::Kenkari_' + gender + '::kenk_riverlandskasa_' + type;
    assert(entries.some(entry => entry.id === oldId), 'legacy cosmetic remains loadable');
    assert(!catalog.some(item => item.id === oldId), 'Kenkari hat is not a separate purchase');
    assert.equal(context.window.canonicalRiverlandKasaId(oldId), id);
  }
  assert.equal(context.window.canonicalRiverlandKasaId(id), id);
}
assert.equal(context.window.canonicalRiverlandKasaId('five_blossom_crown'), 'five_blossom_crown');
// Bowl-Kasa is one article, but every wearer can resolve an independently authored species/gender sprite.
const bowlId = 'appearance::hat::bowlkasa'; // One canonical purchasable identity; legacy IDs are compatibility-only.
const bowlJson = JSON.parse(read('docs/config/cosmetics/kenk_bowlkasa.json')); // Real authored front/back layers and gender fallback metadata.
const bowlEntry = entries.find(entry => entry.id === bowlId); // Existing cosmetic index is the portrait loader's source of truth.
assert.match(read('docs/js/portrait-utils.js'), /if \(!entry\.legacyOnly\) indexEntries\.push\(entry\)/,
  'portrait choice lists exclude legacy duplicates while optionCache still accepts old save IDs');
assert(bowlEntry?.path === './kenk_bowlkasa.json', 'one canonical Bowl-Kasa uses the existing artwork file');
assert.equal(catalog.filter(item => item.id === bowlId).length, 1, 'single canonical Bowl-Kasa in the clothing shop catalogue');
assert(!catalog.some(item => /^appearance::Kenkari_[MF]::kenk_bowlkasa$/.test(item.id)), 'legacy gendered kasas are not separate sale items');
const bowlOption = context.portraitOptionFromJson(bowlEntry, bowlJson); // Actual profile option parser drives both normal and NPC portrait rendering.
for (const gender of ['male', 'female']) {
  const fallback = bowlJson.fallbackVariantByGender[gender]; // Each gender has a distinct authoring slot, currently reusing Kenkari PNGs.
  assert(bowlJson.speciesVariants[fallback]?.parts?.head?.layers?.front, 'Kenkari ' + gender + ' art exists');
  for (const speciesId of ['kenkari', 'rakakoan', 'mao-ao', 'tletingan', 'longoran']) {
    const keys = Array.from(context.portraitVariantKeysForFighter({ speciesId, gender }, bowlOption)); // Prioritizes exact species+gender before the explicit fallback.
    assert.equal(keys.at(-1), fallback, speciesId + ' ' + gender + ' ends at its matching Kenkari fallback');
    const layers = Array.from(context.resolveOptionLayers(bowlOption, { speciesId, gender }));
    assert(layers.some(layer => layer.url.includes('bowlkasa-front.png')), speciesId + ' ' + gender + ' can wear an un-authored Bowl-Kasa');
  }
  const legacyId = 'appearance::Kenkari_' + (gender === 'male' ? 'M' : 'F') + '::kenk_bowlkasa';
  assert(entries.some(entry => entry.id === legacyId && entry.legacyOnly === true),
    'saved legacy Bowl-Kasas remain loadable but hidden from new authoring choices');
  assert.equal(context.window.canonicalRiverlandKasaId(legacyId), bowlId, 'legacy equipped Bowl-Kasa maps to one item');
}
// All authored Kenkari-family hat rules must follow the same short ID used by the newly canonical option.
for (const speciesId of ['kenkari', 'rakakoan']) {
  const species = JSON.parse(read('docs/config/species/' + speciesId + '.json')); // Live species portrait weight and occlusion rules.
  for (const gender of ['male', 'female']) {
    const set = species[gender].allowedCosmetics; // Real selectable pool must contain only the canonical hat identity.
    assert(set.includes(bowlId), speciesId + ' ' + gender + ' can generate the Bowl-Kasa');
    assert(!set.some(id => /^appearance::Kenkari_[MF]::kenk_bowlkasa$/.test(id)), 'no duplicate gendered pool item');
    assert.equal(species[gender].cosmeticWeights.hat[bowlOption.id], gender === 'male' ? 40 : 7,
      speciesId + ' ' + gender + ' retains its original Bowl-Kasa frequency');
    const occlusion = context.hatHideRuleFor(bowlOption.id, species[gender].randomizationRules); // Actual profile hair-occlusion lookup.
    assert.equal(occlusion?.hideSlots?.join(','), 'hairFront,hairBack,hairSide,hairSideL',
      speciesId + ' ' + gender + ' hides all hair beneath a Bowl-Kasa');
    assert.equal(species[gender].randomizationRules.hatHideRules.kenk_bowlkasa, undefined,
      speciesId + ' ' + gender + ' has no stale hair clipping rule');
  }
}
const future = JSON.parse(JSON.stringify(bowlJson)); // Simulates an artist providing a new species+gender image without adding a new shop item.
future.speciesVariants['mao-ao_female'] = JSON.parse(JSON.stringify(future.speciesVariants.kenkari_female));
future.speciesVariants['mao-ao_female'].parts.head.layers.front.image.url = './assets/cosmetics/clothes/hat/future-mao-f-bowl.png';
const futureOption = context.portraitOptionFromJson(bowlEntry, future);
assert(Array.from(context.resolveOptionLayers(futureOption, { speciesId: 'mao-ao', gender: 'female' })).some(layer => layer.url.includes('future-mao-f-bowl.png')),
  'future authored exact female species sprite supersedes the Kenkari fallback');
assert(Array.from(context.resolveOptionLayers(futureOption, { speciesId: 'mao-ao', gender: 'male' })).some(layer => layer.url.includes('bowlkasa-front.png')),
  'un-authored male species still falls back to Kenkari male');

// Run the real NPC/player portrait adapter after explicit Gear equip, not just random generation.
async function checkEquippedBowlKasaOcclusion() {
  const original = {
    getPortraitFighters: context.window.getPortraitFighters,
    randomPortraitProfileSeeded: context.window.randomPortraitProfileSeeded,
    loadPortraitCosmetics: context.window.loadPortraitCosmetics,
  }; // Restores shared test VM hooks after the equipped-hat profile integration check.
  const fighters = [
    { id: 'kenkari_male', speciesId: 'kenkari', gender: 'male' },
    { id: 'rakakoan_female', speciesId: 'rakakoan', gender: 'female' },
  ]; // Covers both possible wearer genders and the inherited Kenkari visual family.
  const speciesRules = {
    kenkari_male: JSON.parse(read('docs/config/species/kenkari.json')).male.randomizationRules,
    rakakoan_female: JSON.parse(read('docs/config/species/rakakoan.json')).female.randomizationRules,
  }; // Actual species rules govern the final worn-hat hair layers.
  const authoredHair = () => ({ id: 'chosen_hair', layers: [{ url: 'chosen-hair.png' }] }); // The user's saved hairstyle must stay intact when the rendering profile hides it.
  context.window.getPortraitFighters = () => fighters;
  context.window.randomPortraitProfileSeeded = (_rng, selected) => ({
    fighter: selected[0], hat: { id: 'none', layers: [] }, bodyColors: {},
    hairFront: authoredHair(), hairBack: authoredHair(), hairSide: authoredHair(), hairSideL: authoredHair(),
  });
  context.window.loadPortraitCosmetics = async () => ({
    optionCache: new Map([[bowlId, bowlOption]]),
    hatOptions: [{ id: 'none', layers: [] }],
    hoodOptions: [{ id: 'none', layers: [] }],
    randomizationRulesByFighter: speciesRules,
  });
  vm.runInContext(read('docs/js/npc-avatar-preview-utils.js'), context); // Actual equipped player/NPC profile owner.
  try {
    await context.window.NpcAvatarPreview.ensurePortraitCosmetics();
    for (const fighter of fighters) {
      const appearance = { speciesId: fighter.speciesId, gender: fighter.gender, cosmetics: {} };
      const worn = context.window.NpcAvatarPreview.buildProfileFromNpcExport({
        id: 'player', appearance, equippedCosmetics: [bowlId],
      });
      assert.equal(worn.hat?.id, bowlOption.id, 'player wears one canonical Bowl-Kasa');
      for (const slot of ['hairFront', 'hairBack', 'hairSide', 'hairSideL']) {
        assert.equal(worn[slot]?.id, 'none', fighter.speciesId + ' ' + fighter.gender + ' hair hides under the equipped hat');
      }
      const bare = context.window.NpcAvatarPreview.buildProfileFromNpcExport({
        id: 'player', appearance, equippedCosmetics: [],
      });
      assert.equal(bare.hairFront?.id, 'chosen_hair', 'unequipping the hat restores the original hairstyle');
    }
  } finally {
    for (const [name, value] of Object.entries(original)) context.window[name] = value;
  }
}

checkEquippedBowlKasaOcclusion().then(() => {
  console.log('Kenkari Riverland kasas and one canonical Bowl-Kasa variant/migration/occlusion checks passed.');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});

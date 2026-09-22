'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const localDb = fs.readFileSync('docs/js/local-db-overrides.js', 'utf8');
const namedAnimal = fs.readFileSync('docs/js/named-animal-npc.js', 'utf8');
const nativeAppearance = fs.readFileSync('docs/js/character-studio-animal-appearance.js', 'utf8');
const feyExtras = fs.readFileSync('docs/js/character-studio-animal-fey-extras.js', 'utf8');
const headwear = fs.readFileSync('docs/js/animal-npc-headwear.js', 'utf8');
const repoPicker = fs.readFileSync('docs/js/repo-picker.js', 'utf8');
const studio = fs.readFileSync('docs/tools/character-studio/index.html', 'utf8');
const chathead = fs.readFileSync('docs/js/animal-chathead-frame.js', 'utf8');
const spriteRecolor = fs.readFileSync('docs/js/sprite-recolor.js', 'utf8');
const creatureRenderer = fs.readFileSync('docs/js/creature-genetics-render.js', 'utf8');
const pngPlaneAvatar = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8'); // Guards live animal-plane refs used by named-animal frame swaps and dialogue targeting.
const overrides = JSON.parse(fs.readFileSync('docs/config/npcs/species-overrides.json', 'utf8'));
const game = fs.readFileSync('docs/game.js', 'utf8');

assert.equal(overrides.npcs.banubu.species, 'grehlr', 'Banubu must be authored as Grehlr');
assert.equal(overrides.npcs.banubu.kind, 'animal', 'Banubu must use the animal NPC route');
assert.equal(overrides.npcs.hiki_hiki.species, 'drenkirra', 'Hiki-hiki must be authored as Drenkirra');
assert.equal(overrides.npcs.hiki_hiki.kind, 'animal', 'Hiki-hiki must use the animal NPC route');
assert.equal(overrides.npcs.banubu.avatarExport.appearance.creatureColorOverrides.base, '#4F757D', 'Banubu repo default must retain the authored blue-gray custom base');
assert.equal(overrides.npcs.banubu.avatarExport.appearance.creatureColorOverrides.mitts, '#c3e3e9', 'Banubu repo default must retain the authored pale-cyan custom mitts');
assert.equal(overrides.npcs.banubu.avatarExport.appearance.creatureGenotype.sizeClass, 'large', 'Banubu must use Large Grehlr genetics scale before any Fey-only boost');
assert.equal(overrides.npcs.banubu.avatarExport.appearance.creatureScaleMultiplier, 3.0, 'Banubu must render at 3x on top of Large Grehlr scale, exactly double his previous 1.5x Fey multiplier');
assert.equal(overrides.npcs.banubu.avatarExport.appearance.creatureGenotype.coloredstripe.enabled, true, 'Banubu colored stripe must remain expressed');
assert.equal(overrides.npcs.hiki_hiki.avatarExport.appearance.creatureGenotype.base.color, '#ff7a18', 'Hiki-hiki repo default must retain the authored orange base');
assert.equal(overrides.npcs.hiki_hiki.avatarExport.appearance.creatureGenotype.bodystripes.color, '#19c7c1', 'Hiki-hiki bodystripes must retain the authored cyan color');
assert.equal(overrides.npcs.hiki_hiki.avatarExport.appearance.creatureGenotype.spectacles.enabled, true, 'Hiki-hiki spectacles must remain expressed');
assert.equal(overrides.npcs.hiki_hiki.avatarExport.appearance.animalHatId, 'kenk_riverlandskasa_wide', 'Hiki-hiki must retain the authored Riverlands kasa');

assert.match(localDb, /function applyNpcSpeciesOverrides\(/, 'NPC database loads must compose reviewed species overrides');
assert.match(localDb, /avatarExport/, 'reviewed named-animal overrides must be able to carry a Character Studio avatar export');
assert.match(localDb, /rawExport:\s*JSON\.parse\(JSON\.stringify\(avatarExport\)\)/, 'composed NPC records must replace stale raw avatar-editor exports');
assert.match(localDb, /CREATURE_BESTIARY_PATH/, 'animal species choices must come from the shared creature bestiary');
assert.match(localDb, /HobunjiNpcSpeciesRegistry/, 'runtime/editor must share one creature species registry');
assert.match(localDb, /document\.write\([\s\S]*named-animal-npc/, 'normal parser-time boot must install the generalized bridge before avatar APIs');

assert.match(studio, /id="npcSpecies"/, 'Character Studio must retain the ordinary Species field');
assert.match(namedAnimal, /npcSpeciesChoices/, 'the ordinary Species field must retain person + animal bestiary choices');
assert.match(namedAnimal, /syncSpeciesFromAppearance/, 'native animal form edits must synchronize back to authoritative npc.species');
assert.match(namedAnimal, /appearance\.creatureKind = speciesId/, 'species selection must synchronize creature identity into appearance data');
assert.match(namedAnimal, /appearance\.avatarType = 'animal'/, 'animal species must explicitly select the animal avatar route');
assert.match(namedAnimal, /creatureColorOverrides/, 'runtime bridge must apply native editor custom-hex overrides');
assert.match(namedAnimal, /animalOpacity/, 'runtime bridge must carry native editor opacity');
assert.match(namedAnimal, /animalHatId/, 'runtime bridge must carry native editor animal headwear');
assert.match(namedAnimal, /AnimalNpcHeadwear\.composeWithHat/, 'runtime render must reuse the restored animal headwear compositor');
assert.match(namedAnimal, /canvas\.toDataURL\('image\/png'\)/, 'world animal planes must use the composed authored appearance rather than a plain base sprite when possible');
assert.match(namedAnimal, /buildAnimalPlaneAvatarModel/, 'world models must retain the existing side-view animal plane builder');
assert.match(pngPlaneAvatar, /avatarRef\.frontPlane = front\.mesh/, 'animal head-rig upgrade must repoint the public frontPlane ref to the live skinned replacement');
assert.match(pngPlaneAvatar, /avatarRef\.backPlane = back\.mesh/, 'animal head-rig upgrade must repoint the public backPlane ref to the live skinned replacement');
assert.match(namedAnimal, /__hobunjiAnimalNpcSourceUrl/, 'world animal planes must prefer the native creature/genotype source instead of the 200x200 NPC portrait canvas');
assert.match(namedAnimal, /async function worldFrameUrls/, 'named animals must expose native-resolution idle/run frames for in-world locomotion');
assert.match(namedAnimal, /dialogueEyesClosed = chathead && profile\?\.npcRecord\?\._animalDialogueEyesOpen === false/, 'sleeping animal dialogue portraits must retain closed eyes until their dialogue controller explicitly wakes them');
assert.match(namedAnimal, /blinkShut: options\.blinkShut === true \|\| dialogueEyesClosed/, 'closed-eye animal dialogue portraits must use the canonical species blink overlay');
assert.match(namedAnimal, /function creatureScaleMultiplierFor/, 'named animals must read a generic appearance-authored world scale multiplier');
assert.match(game, /namedAnimalBaseSizeScale = namedAnimalDef \? window\.CreatureGenetics\.creatureSizeScale/, 'named animal scaling must resolve normal creature size class before any custom multiplier');
assert.match(game, /namedAnimalBaseSizeScale\.x \* namedAnimalScaleMultiplier/, 'named animal custom scale must multiply normal creature X scale rather than replace it');
assert.match(game, /namedAnimalBaseSizeScale\.y \* namedAnimalScaleMultiplier/, 'named animal custom scale must multiply normal creature Y scale rather than replace it');
assert.match(game, /namedAnimalBaseGroundOffset \* namedAnimalScaleMultiplier/, 'named animal custom scale must proportionally scale ground lift so feet remain on the floor');
assert.match(game, /const namedAnimalDef = namedAnimalKind \? CREATURE_DB\[namedAnimalKind\]/, 'NPC walker construction must resolve animal physics from the normal creature database');
assert.match(game, /CreatureGenetics\.creatureSizeScale\(namedAnimalKind, namedAnimalGenotype\)/, 'named animal world scale must use the same genetics size-class path as normal creatures');
assert.match(game, /const legs = namedAnimalDef \? null : window\.ProceduralLegAnimation/, 'animal NPCs must never receive humanoid procedural feet');
assert.match(game, /speciesSpeedTiles = this\.animalDef \? .*this\.animalDef\.moveSpeed.*devGlobalSpeedMul \/ TILE/, 'animal NPC schedule movement must derive from native creature movement speed');
assert.match(game, /animalRunFrameDistPx \+= moveDistTiles \* TILE/, 'animal NPC movement must cycle native run frames from actual distance traveled');
assert.match(game, /resolveCreatureGroundAnchorRatio\(namedAnimalDef\.sprites\?\.idle/, 'animal NPC artwork must use the same opaque-bottom grounding correction as ordinary creatures');
assert.match(namedAnimal, /watchGlobalAssignment\('NpcAvatarPreview'\)/, 'profile bridge must install before late avatar API assignment');
assert.match(namedAnimal, /watchGlobalAssignment\('PNGPlaneAvatar'\)/, 'world-plane bridge must install before late PNG-plane API assignment');
assert.doesNotMatch(namedAnimal, /namedAnimalAppearancePanel/, 'the generalized bridge must not inject the discarded simplified appearance panel');
assert.doesNotMatch(namedAnimal, /creatureBaseControl/, 'the generalized bridge must not rebuild animal authoring controls itself');
assert.match(namedAnimal, /__namedAnimalNpcDebug/, 'mobile/dev diagnostics must remain available');
assert.doesNotMatch(namedAnimal, /banubu\s*:/i, 'general named-animal bridge must not hardcode Banubu');
assert.doesNotMatch(namedAnimal, /hiki_hiki\s*:/i, 'general named-animal bridge must not hardcode Hiki-hiki');

// Exact native Character Studio extension recovered from feature/animal-npc-appearance.
assert.match(nativeAppearance, /id = 'animalNpcAppearanceCard'|id='animalNpcAppearanceCard'|card\.id = 'animalNpcAppearanceCard'/, 'native editor must inject the Character form card');
assert.match(nativeAppearance, />Person<\/button>/, 'native Character form must retain Person mode');
assert.match(nativeAppearance, />Animal<\/button>/, 'native Character form must retain Animal mode');
assert.match(nativeAppearance, /Animal NPCs use the same creature genotype colors and pattern layers as breeding/, 'native editor must retain the breeding/genetics workflow');
assert.match(nativeAppearance, /findHumanCards\(\)/, 'native animal mode must extend the regular Appearance pane rather than creating a separate editor');
assert.match(nativeAppearance, /humanCard\.style\.display = animal \? 'none' : ''/, 'person-only regular Appearance cards must swap cleanly in animal mode');
assert.match(nativeAppearance, /creatureGenotype/, 'native editor must persist breeding-compatible genotype data');
assert.match(nativeAppearance, /class=\"colorSwatch animalNpcColor/, 'native editor must retain its original coat/pattern swatches');
assert.match(nativeAppearance, /animalNpcPatternToggle/, 'native editor must retain per-pattern expression toggles');
assert.match(nativeAppearance, /animalNpcRepoPatternScale/, 'native animal editor must expose normalized surface-pattern scale per painted region');
assert.match(nativeAppearance, /min="7" max="14"/, 'animal pattern scale cannot drop below the 7× minimum and leaves headroom beyond 10×');
assert.match(nativeAppearance, /patternScale/, 'normalized animal pattern scale must persist in colorPoolPaint data rather than mutating the reusable repo pattern');
assert.match(nativeAppearance, /refreshSurfacePatternStatuses/, 'animal appearance editor must visibly confirm whether a selected repo pattern rendered');
assert.match(nativeAppearance, /noteCanonicalRender/, 'base animal diagnostics can be synchronized when the Fey extras wrapper owns the outer preview call');
assert.match(creatureRenderer, /getLastPatternPaintDebug/, 'runtime animal compositor must expose surface-pattern application status for the editor');
assert.match(feyExtras, /await renderer\.composeFrame\(kind, 'idle', genotype, false\)/, 'Fey/custom-color preview must source its pixels from the canonical runtime creature compositor so repo surface patterns are not skipped');
assert.match(feyExtras, /canonical\+fey:/, 'Fey preview debug explicitly reports that the canonical compositor supplied the animal frame');
assert.doesNotMatch(feyExtras.slice(feyExtras.indexOf('async function composeAnimal'), feyExtras.indexOf('function fitToCanvas')), /recoloredSource\(/, 'Fey preview compose path must not use its obsolete private recolor/pattern compositor');
assert.match(nativeAppearance, /renderStudioAnimal/, 'native editor must retain the regular Character Studio live preview integration');
assert.match(spriteRecolor, /function directShadeFillPixels\(data, targetRgb, predicate = null\)/, 'pattern system exposes the canonical direct tint used for Banubu');
assert.match(spriteRecolor, /const luminanceBins = new Uint32Array\(256\)/, 'Banubu tint preserves relative source-pixel value differences using the allocation-light luminance histogram median');
assert.match(spriteRecolor, /const neutral = Math\.max\(0\.0001, \(\(lowerBin \+ upperBin\) \* 0\.5\) \/ 255\)/, 'Banubu tint centers relative shading on the histogram-derived median luminance');
assert.doesNotMatch(spriteRecolor, /luminances\.sort/, 'Banubu tint must not regress to sorting one allocated luminance value per affected pixel');
assert.match(creatureRenderer, /window\.SpriteRecolor\?\.directShadeFillPixels/, 'Banubu and other animals must tint through the exact pattern-system direct shade-fill function');
assert.match(nativeAppearance, /waitForCanonicalCreatureRenderer/, 'animal previews must wait for the shared runtime creature compositor instead of racing into an editor-only tint path');
assert.match(nativeAppearance, /await renderer\.composeFrame\(kind, 'idle', genotype, false\)/, 'Character Studio animal tint/pattern preview must call the exact runtime composeFrame implementation');
assert.doesNotMatch(nativeAppearance.slice(nativeAppearance.indexOf('async function renderStudioAnimal'), nativeAppearance.indexOf('function installPreviewHooks')), /composeEditorAnimal/, 'authoritative Character Studio animal preview must never fall back to the approximate editor-only compositor');
assert.match(nativeAppearance, /canonical-failed/, 'renderer failure must surface as a canonical preview failure rather than silently changing tint algorithms');
assert.ok(studio.indexOf('scratchbones-config.js') < studio.indexOf('repo-picker.js'), 'Character Studio must load shared tint configuration before booting its animal runtime modules');
assert.match(studio, /repo-picker\.js\?v=20260920animal-tint-parity1/, 'Character Studio must cache-bust the canonical animal runtime loader after tint-parity changes');

assert.match(feyExtras, /class=\"animalNpcCustomHex\"/, 'native extension must retain independent #RRGGBB fields for animal layers');
assert.match(feyExtras, /id=\"animalNpcScaleMultiplier\"/, 'Fey/custom appearance controls must expose the named-animal in-game size multiplier next to the other non-genetic overrides');
assert.match(feyExtras, /creatureScaleMultiplier/, 'Fey/custom appearance must persist the generic scale multiplier on the appearance record');
assert.match(feyExtras, /Each base\/pattern layer has its own independent #RRGGBB override/, 'hex overrides must remain intentionally independent of breeding presets');
assert.match(feyExtras, /id=\"animalNpcOpacity\" type=\"range\"/, 'native extension must retain animal opacity control');
assert.match(feyExtras, /id=\"animalNpcHatSelect\"/, 'native extension must retain animal hat selection');
assert.match(feyExtras, /controlsSignature/, 'native extension must avoid rebuilding focused hex/select controls during polling');
assert.match(headwear, /window\.AnimalNpcHeadwear/, 'restored headwear module must expose its shared compositor');
assert.match(headwear, /composeWithHat/, 'restored headwear module must composite existing portrait hats onto animal sprites');

assert.match(repoPicker, /character-studio-animal-appearance\.js/, 'Character Studio must load the recovered native animal appearance extension');
assert.match(repoPicker, /character-studio-animal-fey-extras\.js/, 'Character Studio must load the recovered hex/opacity/headwear controls');
assert.match(repoPicker, /animal-npc-headwear\.js/, 'Character Studio must load animal headwear before the fey extras');
assert.match(chathead, /banubu: 'grehlr'/, 'legacy Banubu chathead mapping remains backward compatibility only');
assert.match(chathead, /hiki_hiki: 'drenkirra'/, 'legacy Hiki-hiki chathead mapping remains backward compatibility only');

const storage = new Map();
const sandbox = {
  console,
  Promise,
  URL,
  setTimeout,
  clearTimeout,
  localStorage: {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  },
  window: { fetch: undefined },
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(localDb, sandbox, { filename: 'local-db-overrides.js' });

const sample = {
  npcs: [
    {
      id: 'banubu',
      species: 'mashtzarr',
      gender: 'female',
      appearance: { speciesId: 'mashtzarr', cosmetics: { hairFront: 'legacy' } },
      equippedCosmetics: ['legacy_hat'],
      appliedDyes: { HAT: 'legacy_dye' },
      avatarEditor: { sourceFormat: 'npc_avatar_editor_export', rawExport: { name: 'Stale Banubu', equippedCosmetics: ['legacy_hat'] } },
    },
    {
      id: 'hiki_hiki',
      species: 'mashtzarr',
      appearance: { speciesId: 'mashtzarr', animalHatId: 'legacy_hat' },
      equippedCosmetics: ['legacy_cosmetic'],
      appliedDyes: { CLOTH: 'legacy_dye' },
    },
    { id: 'ordinary', species: 'mao-ao', appearance: { speciesId: 'mao-ao' } },
  ],
};
const composed = sandbox.window.LocalDBOverrides.applyNpcSpeciesOverrides(sample, overrides);
const banubu = composed.npcs.find(npc => npc.id === 'banubu');
const hikiHiki = composed.npcs.find(npc => npc.id === 'hiki_hiki');
const ordinary = composed.npcs.find(npc => npc.id === 'ordinary');

assert.equal(banubu.species, 'grehlr');
assert.equal(banubu.gender, 'male');
assert.equal(banubu.creatureKind, 'grehlr');
assert.equal(banubu.appearance.speciesId, 'grehlr');
assert.equal(banubu.appearance.creatureKind, 'grehlr');
assert.equal(banubu.appearance.avatarType, 'animal');
assert.equal(banubu.appearance.creatureColorOverrides.base, '#4F757D');
assert.equal(banubu.appearance.creatureColorOverrides.mitts, '#c3e3e9');
assert.equal(banubu.appearance.creatureColorOverrides.spectacles, '#c3e3e9');
assert.equal(banubu.appearance.creatureColorOverrides.coloredstripe, '#c3e3e9');
assert.equal(banubu.appearance.creatureGenotype.sizeClass, 'large');
assert.equal(banubu.appearance.creatureScaleMultiplier, 1.5);
assert.equal(banubu.appearance.creatureGenotype.base.color, '#4F757D');
assert.equal(banubu.appearance.creatureGenotype.mitts.color, '#c3e3e9');
assert.equal(banubu.appearance.creatureGenotype.spectacles.color, '#c3e3e9');
assert.equal(banubu.appearance.creatureGenotype.coloredstripe.color, '#c3e3e9');
assert.equal(banubu.appearance.creatureGenotype.mitts.enabled, true);
assert.equal(banubu.appearance.creatureGenotype.coloredstripe.enabled, true);
assert.equal(banubu.appearance.creatureGenotype.colorPoolPaint.layers.base.repoPatternId, 'fey_thorns');
assert.equal(banubu.appearance.creatureGenotype.colorPoolPaint.layers.base.dyeHex, '#c3e3e9');
assert.equal(banubu.appearance.creatureGenotype.colorPoolPaint.layers.base.patternScale, 8.6);
assert.equal(banubu.appearance.creatureGenotype.colorPoolPaint.layers.base.pattern.repoPatternId, 'fey_thorns');
assert.deepEqual(banubu.appearance.cosmetics, {}, 'authored Banubu export must replace stale humanoid appearance cosmetics');
assert.deepEqual(banubu.equippedCosmetics, [], 'authored Banubu export must clear stale equipped humanoid cosmetics');
assert.deepEqual(banubu.appliedDyes, {}, 'authored Banubu export must clear stale humanoid dyes');
assert.equal(banubu.avatarEditor.rawExport.name, 'Banubu', 'Character Studio raw bridge must use the authored Banubu export');
assert.equal(banubu.avatarEditor.rawExport.appearance.creatureColorOverrides.coloredstripe, '#c3e3e9');
assert.equal(banubu.avatarEditor.rawExport.appearance.creatureGenotype.colorPoolPaint.layers.base.patternScale, 8.6);

assert.equal(hikiHiki.species, 'drenkirra');
assert.equal(hikiHiki.gender, 'male');
assert.equal(hikiHiki.creatureKind, 'drenkirra');
assert.equal(hikiHiki.appearance.speciesId, 'drenkirra');
assert.equal(hikiHiki.appearance.creatureGenotype.base.color, '#ff7a18');
assert.equal(hikiHiki.appearance.creatureGenotype.bodystripes.color, '#19c7c1');
assert.equal(hikiHiki.appearance.creatureGenotype.bodystripes.enabled, true);
assert.equal(hikiHiki.appearance.creatureGenotype.spectacles.enabled, true);
assert.equal(hikiHiki.appearance.animalHatId, 'kenk_riverlandskasa_wide');
assert.deepEqual(hikiHiki.equippedCosmetics, []);
assert.deepEqual(hikiHiki.appliedDyes, {});
assert.equal(hikiHiki.avatarEditor.rawExport.name, 'Hiki-hiki');
assert.equal(hikiHiki.avatarEditor.rawExport.appearance.animalHatId, 'kenk_riverlandskasa_wide');

assert.equal(ordinary.species, 'mao-ao', 'unlisted NPCs must remain unchanged');
assert.equal(sample.npcs[0].species, 'mashtzarr', 'composition must not mutate the imported/source database object');
assert.deepEqual(sample.npcs[0].equippedCosmetics, ['legacy_hat'], 'composition must not mutate stale source avatar fields in place');

console.log('named animal NPC + restored native appearance integration: ok');
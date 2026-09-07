const assert = require('node:assert/strict');
const fs = require('node:fs');

const redesign = fs.readFileSync('docs/js/onboarding-character-creation-redesign.js', 'utf8'); // Guards the new creator workflow and runtime preview contracts.
const parity = fs.readFileSync('docs/js/onboarding-character-creation-runtime-parity.js', 'utf8'); // Guards reliable visible hierarchy/lore, gameplay lighting, loading feedback, and species color randomization.
const entry = fs.readFileSync('docs/onboarding.js', 'utf8'); // Guards the thin bootstrap that preserves the existing onboarding implementation.
const core = fs.readFileSync('docs/onboarding-core.js', 'utf8'); // Guards that save/profile creation remains in the original core rather than being duplicated.

assert.match(entry, /onboarding-core\.js\?v=20260907charcreator1/, 'onboarding entrypoint must load the preserved core first');
assert.match(entry, /onboarding-character-creation-redesign\.js\?v=20260907charcreator1/, 'onboarding entrypoint must load the redesign after the core');
assert.match(entry, /onboarding-character-creation-runtime-parity\.js\?v=20260907charcreator2/, 'onboarding entrypoint must load the runtime parity follow-up after the redesign');
assert.match(core, /makeDefaultState\('mao-ao', 'male'\)/, "fresh character creation must start with Mao'ao selected");
assert.match(core, /window\.HobunjiOnboarding = \{ init, reset, loadProfile, loadSaveMeta \}/, 'preserved onboarding core must still expose the original public API');

for (const required of [
  'Sloth-folk of the Northern Archipelago',
  'Natives of the islands of Tletinga-taru and Tletinga-iku',
  'Oliphanti of the Eastern Highplains',
  'Tall, agile Yubashi native to the hot rainforests and riverlands of Tanka',
  'Sailors of the Snow-sea that pools between the twin chains of the Sho-ngyankwani Mountains',
  'Round parrotfolk of the Southern Archipelago',
]) {
  assert.ok(redesign.includes(required), `redesign source is missing requested lore text: ${required}`);
  assert.ok(parity.includes(required), `runtime-visible parity layer is missing requested lore text: ${required}`);
}

assert.match(redesign, /data-ob-family = 'slagothim'|dataset\.obFamily = 'slagothim'/, 'original redesign must contain a Slagothim family selection');
assert.match(redesign, /data-ob-subspecies=\\?"tletingan\\?"/, 'original redesign must contain Tletingan as a second-step subspecies');
assert.match(parity, /dataset\.obRuntimeFamily = 'slagothim'/, 'runtime parity must directly assert a visible Slagothim top-level button');
assert.match(parity, /data-ob-runtime-subspecies="tletingan"/, 'runtime parity must directly assert visible Tletingan under Slagothim');
assert.match(parity, /data-ob-runtime-subspecies="nuhongan" disabled/, 'runtime parity must directly assert disabled Nuhongan under Slagothim');
assert.match(parity, /data-ob-runtime-subspecies="longoran" disabled/, 'runtime parity must directly assert disabled Longoran under Slagothim');
assert.match(parity, /tletinganButton\.hidden = true/, 'legacy top-level Tletingan button must be hidden once the Slagothim hierarchy is asserted');
assert.match(parity, /assertSpeciesWorkflow\(overlay\)/, 'every creator sync must assert the visible hierarchy and descriptions');

assert.match(redesign, /buildSinglePlaneAvatarModel/, '3D creator must use the gameplay PNG-plane avatar constructor');
assert.match(redesign, /portraitView: 'behind'/, '3D creator must build the rear character texture');
assert.match(redesign, /onlyHeadSprite: true/, '3D creator must build the head-only mask for the runtime neck rig');
assert.match(redesign, /ProceduralLegAnimation\?\.attach/, '3D creator must include runtime procedural feet');
assert.match(redesign, /proceduralHandParent = group/, '3D creator must use the normal free-hand parent contract');
assert.match(redesign, /HobunjiCharacterRigScale\.applyToParent/, '3D creator must apply authored runtime species/gender scale');
assert.match(redesign, /HOBUNJI_ONBOARDING_REDESIGN_STATUS/, '3D creator must expose mobile-friendly diagnostic state');

assert.match(parity, /new THREE\.AmbientLight\(GAME_LIGHTING\.ambientColor, GAME_LIGHTING\.ambientIntensity\)/, 'creator must install the live outdoor ambient light');
assert.match(parity, /new THREE\.DirectionalLight\(GAME_LIGHTING\.sunColor, GAME_LIGHTING\.sunIntensity\)/, 'creator must install the live outdoor directional light');
assert.match(parity, /ambientColor:\s*0xfff0e0[\s\S]*ambientIntensity:\s*0\.7/, 'creator ambient values must match live buildZoneScene lighting');
assert.match(parity, /sunColor:\s*0xffeedd[\s\S]*sunIntensity:\s*1\.1[\s\S]*\[4, 8, 2\]/, 'creator sun values and position must match live buildZoneScene lighting');
assert.match(parity, /ob-3d-loading/, 'creator must show an in-viewport loading state before the runtime avatar is ready');
assert.match(parity, /Loading \$\{speciesLabel\(speciesId\)\} preview/, 'loading state must identify the selected species');
assert.match(parity, /randomizeBodyColors/, 'creator must randomize authored body-color swatches on species changes');
assert.match(parity, /primary\[primaryIndex\]\?\.click\(\)/, 'body-color randomization must reuse the core primary swatch handler');
assert.match(parity, /secondary\[secondaryIndex\]\?\.click\(\)/, 'body-color randomization must reuse the core secondary swatch handler');

console.log('onboarding character-creation redesign source checks passed');

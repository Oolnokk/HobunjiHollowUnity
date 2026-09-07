const assert = require('node:assert/strict');
const fs = require('node:fs');

const redesign = fs.readFileSync('docs/js/onboarding-character-creation-redesign.js', 'utf8');
const entry = fs.readFileSync('docs/onboarding.js', 'utf8');
const core = fs.readFileSync('docs/onboarding-core.js', 'utf8');

assert.match(entry, /onboarding-core\.js\?v=20260907charcreator1/, 'onboarding entrypoint must load the preserved core first');
assert.match(entry, /onboarding-character-creation-redesign\.js\?v=20260907charcreator5/, 'onboarding entrypoint must load the current integrated redesign after the core');
assert.doesNotMatch(entry, /runtime-parity/, 'creator behavior must not depend on a separate follow-up script');
assert.match(core, /makeDefaultState\('mao-ao', 'male'\)/, "fresh character creation must start with Mao'ao selected");
assert.match(core, /window\.HobunjiOnboarding = \{ init, reset, loadProfile, loadSaveMeta \}/, 'preserved onboarding core must still expose the original public API');

for (const required of [
  'Sloth-folk of the Northern Archipelago',
  'Natives of the islands of Tletinga-taru and Tletinga-iku',
  'Oliphanti of the Eastern Highplains',
  'Tall, agile Yubashi native to the hot rainforests and riverlands of Tanka',
  'Sailors of the Snow-sea that pools between the twin chains of the Sho-ngyankwani Mountains',
  'Round parrotfolk of the Southern Archipelago',
]) assert.ok(redesign.includes(required), `redesign source is missing requested lore text: ${required}`);

assert.match(redesign, /querySelector\('\[data-ob-species="tletingan"\]'\)[\s\S]{0,120}closest\?\.\('\.ob-group'\)/, 'species workflow must anchor directly on the real Tletingan button');
assert.match(redesign, /dataset\.obFamily = 'slagothim'/, 'Slagothim must be inserted as the top-level family button');
assert.match(redesign, /familyButton\.addEventListener\('click',[\s\S]{0,180}familyOpen = true;[\s\S]{0,120}tletinganButton\.click\(\)/, 'selecting Slagothim must immediately select Tletingan through the core handler');
assert.match(redesign, /tletinganButton\.hidden = true/, 'legacy top-level Tletingan must remain hidden');
assert.match(redesign, /data-ob-subspecies="tletingan"/, 'Tletingan must be a visible second-step subspecies');
assert.match(redesign, /data-ob-subspecies="nuhongan" disabled/, 'Nuhongan must be visibly unavailable');
assert.match(redesign, /data-ob-subspecies="longoran" disabled/, 'Longoran must be visibly unavailable');

assert.match(redesign, /overlayObserver\.observe\(overlay, \{ childList: true \}\)/, 'creator observer must watch only direct core card replacements');
assert.doesNotMatch(redesign, /overlayObserver\.observe\(overlay, \{[^}]*subtree:\s*true/, 'creator observer must not watch its own nested lore/preview mutations');
assert.match(redesign, /bodyObserver\.observe\(document\.body, \{ childList: true \}\)/, 'body observer must only detect onboarding overlay mount/unmount');

assert.match(redesign, /randomizeCreationLook\(overlay, speciesId, gender\)/, 'initial/species/gender identity changes must run one generated-look transaction');
assert.match(redesign, /lastRandomizedIdentity = identityKey/, 'generated look must be keyed by species+gender to avoid rerender loops');
assert.match(redesign, /primary\[primaryIndex\]\?\.click\(\)/, 'body-color randomization must reuse the core primary swatch handler');
assert.match(redesign, /secondary\[secondaryIndex\]\?\.click\(\)/, 'body-color randomization must reuse the core secondary swatch handler');
assert.match(redesign, /function randomizeAppearanceCosmetics\(overlay\)/, 'identity randomization must include appearance cosmetics');
assert.match(redesign, /querySelectorAll\('\[data-ob-slot\]'\)/, 'appearance cosmetics must use the core cosmetic selectors');
assert.match(redesign, /select\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/, 'appearance/clothing randomization must pass through core change handlers');

for (const dyeId of ['dye:CLOTH:brown', 'dye:CLOTH:dusty_yellow', 'dye:CLOTH:dusty_orange']) {
  assert.ok(redesign.includes(dyeId), `Kasa generated dye pool must include ${dyeId}`);
}
assert.match(redesign, /if \(gender !== 'male'\) return false;/, 'no female character may receive a Kasa from randomization');
assert.match(redesign, /if \(kind === 'kenkari-bowl-kasa'\) return speciesId === 'kenkari';/, 'Kenkari Bowl-Kasa randomization must be Kenkari-only');
assert.match(redesign, /return speciesId === 'tletingan' \|\| speciesId === 'mao-ao';/, 'ordinary Kasa randomization must be Tletingan/Mao\'ao-only');
assert.match(redesign, /filter\(option => randomClothingOptionAllowed\(option, speciesId, gender\)\)/, 'clothing randomization must apply the Kasa eligibility filter without removing manual options');
assert.match(redesign, /clickRandomDye\('data-ob-cloth-dye-a', clothingRoll\.kasaSelected\)/, 'Kasa primary dye randomization must use the restricted palette');
assert.match(redesign, /clickRandomDye\('data-ob-cloth-dye-b', clothingRoll\.kasaSelected\)/, 'Kasa secondary dye randomization must use the restricted palette');

assert.match(redesign, /buildSinglePlaneAvatarModel/, '3D creator must use the gameplay PNG-plane avatar constructor');
assert.match(redesign, /portraitView: 'behind'/, '3D creator must build the rear character texture');
assert.match(redesign, /onlyHeadSprite: true/, '3D creator must build the head-only mask for the runtime neck rig');
assert.match(redesign, /ProceduralLegAnimation\?\.attach/, '3D creator must include runtime procedural feet');
assert.match(redesign, /proceduralHandParent = group/, '3D creator must use the normal free-hand parent contract');
assert.match(redesign, /HobunjiCharacterRigScale\.applyToParent/, '3D creator must apply authored runtime species/gender scale');

assert.match(redesign, /new THREE\.AmbientLight\(0xfff0e0, 0\.7\)/, 'creator must keep live buildZoneScene ambient lighting for genuinely lit 3D attachments');
assert.match(redesign, /new THREE\.DirectionalLight\(0xffeedd, 1\.1\)/, 'creator must keep live buildZoneScene directional lighting for genuinely lit 3D attachments');
assert.match(redesign, /renderer\.outputEncoding = THREE\.LinearEncoding/, 'creator renderer output encoding must match live r128 runtime instead of the washed-out preview setting');
assert.doesNotMatch(redesign, /renderer\.outputEncoding = THREE\.sRGBEncoding/, 'creator must not reintroduce the sRGB output override that washed out unlit PNG planes');
assert.match(redesign, /runtime HobunjiSpritePngSurface \/ MeshBasicMaterial/, 'diagnostics must identify the canonical unlit runtime PNG material path');

assert.match(redesign, /uThickness:\s*\{ value: 0\.006 \}/, 'creator shell material must use the live shell thickness before limb parity scaling');
assert.match(redesign, /side:\s*THREE\.BackSide/, 'creator shell material must use the runtime inverted-hull back-face pass');
assert.match(redesign, /depthFunc:\s*THREE\.LessDepth/, 'creator shell pass must use the runtime LESS depth rule');
assert.match(redesign, /scene\.overrideMaterial = shellOutlineMaterial/, 'creator must actually render with the runtime shell override material');
assert.match(redesign, /camera\.layers\.set\(1\)/, 'creator must render the runtime shell layer containing procedural hands and feet');
assert.match(redesign, /ob-3d-loading/, 'creator must show an in-viewport loading state before the runtime avatar is ready');

console.log('onboarding character-creation redesign source checks passed');

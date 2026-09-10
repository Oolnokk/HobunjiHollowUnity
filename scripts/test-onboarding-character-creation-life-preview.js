const assert = require('node:assert/strict');
const fs = require('node:fs');

const entry = fs.readFileSync('docs/onboarding.js', 'utf8'); // Guards that the post-redesign life module is actually parser-loaded.
const life = fs.readFileSync('docs/js/onboarding-character-creation-life-preview.js', 'utf8'); // Guards runtime-life, view, Kasa, and starter-weapon contracts.

assert.match(entry, /onboarding-character-creation-life-preview\.js\?v=20260910review1/, 'onboarding must load the creator life-preview module after the redesign');
assert.match(entry, /coreUrl[\s\S]*redesignUrl[\s\S]*lifePreviewUrl/, 'creator life additions must load after onboarding core and integrated redesign');

for (const dyeId of ['dye:CLOTH:brown', 'dye:CLOTH:dusty_yellow', 'dye:CLOTH:dusty_orange']) {
  assert.ok(life.includes(dyeId), `generated Kasa palette is missing ${dyeId}`);
}
assert.match(life, /text\.includes\('kasa'\)/, 'generated Kasa dye restriction must include Kenkari Bowl-Kasa as well as ordinary Kasas');
assert.match(life, /randomizedIdentity/, 'Kasa dye correction must be scoped to a generated look rather than policing later manual choices');

assert.match(life, /portraitBreathingComposer/, 'living preview must use the existing portrait breathing composer');
assert.match(life, /LIFE_FRAME_MS = 90/, 'living portrait refresh must be throttled instead of repainting every display frame');
assert.doesNotMatch(life, /forceEyesOpen\s*:/, 'living creator repaint must not force eyes open, so portrait-utils can render its normal blink frames');
assert.match(life, /refreshSinglePlaneAvatarModel/, 'breathing/blink repaint must refresh the existing PNGPlaneAvatar texture instead of rebuilding its mesh continuously');
assert.match(life, /portraitView: 'behind'/, 'living repaint must keep the back canvas synchronized with the front');

assert.match(life, /Change View: Face/, 'creator must expose a visible face-view control');
assert.match(life, /Change View: Full Body/, 'face view must visibly offer a way back to full-body view');
assert.match(life, /ob-face-view/, 'view toggle must switch an explicit preview state rather than mutate saved appearance data');

assert.match(life, /STARTER_WEAPON_KEY = 'hatchet_nativeCopper'/, 'preview weapon must be one of onboarding-core\'s actual starter Native Copper tools');
assert.match(life, /WeaponToolStances\?\.poses\?\.heavyWeapon/, 'starter Hatchet must use the shared Heavy Weapon idle stance');
assert.match(life, /x: 0\.03, y: 0\.37, z: -0\.01[\s\S]{0,100}pitch: -155, yaw: -79, bodyYaw: -15, roll: -82/, 'Heavy Weapon fallback must match weapon-tool-stances.js exactly');
assert.match(life, /handAttachX/, 'weapon base must use the avatar\'s scanned runtime hand-attach X');
assert.match(life, /handAttachY/, 'weapon base must use the avatar\'s scanned runtime hand-attach Y');
assert.match(life, /toolScaleForTool\?\.\(STARTER_WEAPON_SHAPE\)/, 'weapon sprite must use the shared authored hand-tool scale');
assert.match(life, /planeW = 0\.5 \* gripScale/, 'starter weapon plane must use gameplay/Attack Editor TOOL_MODEL_WIDTH');
assert.match(life, /plane\.rotation\.x = -Math\.PI \/ 2/, 'starter weapon sprite must use the gameplay flat-in-XZ basis');
assert.match(life, /proceduralHandRig/, 'starter weapon preview must reuse the existing procedural hand rig');
assert.match(life, /placeHandWorld\('right'/, 'weapon slot preview must make the right hand own the starter weapon socket');
assert.match(life, /avatarGroup\.rotation\.y = THREE\.MathUtils\.degToRad\(Number\(pose\.bodyYaw\)/, 'preview body must assume the weapon idle stance body yaw');

assert.match(life, /overlayObserver\.observe\(overlay, \{ childList: true \}\)/, 'life-preview observer must watch only direct core card replacements');
assert.doesNotMatch(life, /overlayObserver\.observe\(overlay, \{[^}]*subtree:\s*true/, 'life-preview module must not reintroduce the self-observing New Farmer freeze');
assert.match(life, /bodyObserver\.observe\(document\.body, \{ childList: true \}\)/, 'body observer must remain mount/unmount-only');

console.log('onboarding character-creation life-preview source checks passed');

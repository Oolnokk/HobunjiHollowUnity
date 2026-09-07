const assert = require('node:assert/strict');
const fs = require('node:fs');

const entry = fs.readFileSync('docs/onboarding.js', 'utf8'); // Guards parser-load order for the post-life creator fix.
const source = fs.readFileSync('docs/js/onboarding-character-creation-weapon-view-fix.js', 'utf8'); // Guards random starter weapon, hand ownership, persistence, and adaptive face view.

assert.match(entry, /onboarding-character-creation-weapon-view-fix\.js\?v=20260907charcreator7/, 'onboarding must load the weapon/view fix after the life preview');
assert.match(entry, /lifePreviewUrl[\s\S]*weaponViewFixUrl/, 'weapon/view fix must parser-load after the living preview module');

for (const itemKey of ['hoe_nativeCopper', 'hatchet_nativeCopper', 'fishingspear_nativeCopper', 'pickshovel_nativeCopper']) {
  assert.ok(source.includes(itemKey), `starter weapon pool missing ${itemKey}`);
}
assert.doesNotMatch(source, /itemKey:\s*'fishingmace_nativeCopper'/, 'friendship-gated Fishing Mace must not be randomized as a fresh-character starter weapon');
assert.match(source, /randomizedStarterWeapon/, 'chosen creator weapon must be exposed in diagnostics');
assert.match(source, /equipmentSlots = \{ \.\.\.\(playerData\.equipmentSlots \|\| \{\}\), weapon: choice\.itemKey \}/, 'chosen preview weapon must be assigned to the real player weapon slot');
assert.match(source, /character\.equipmentSlots = \{ \.\.\.\(character\.equipmentSlots \|\| \{\}\), weapon: choice\.itemKey \}/, 'chosen weapon must persist on the new character record');
assert.match(source, /playerData\.activeTool = 'weapon'/, 'new game must start with the randomized weapon slot active');
assert.match(source, /document\.addEventListener\('hobunjiPlayerReady', persistWeaponSelection, \{ capture: true \}\)/, 'weapon persistence must run before downstream player-ready consumers');

assert.match(source, /rig\.useIdlePose = function onboardingWeaponOwnedIdle/, 'creator must claim the right hand during the hand driver pre-render idle pass');
assert.match(source, /rig\.placeHandWorld\('right'/, 'weapon-owned idle must place the procedural right hand on the held-tool socket');
assert.match(source, /authoredPrimaryGripForTool/, 'random weapon visual must reuse authored primary grip metadata');
assert.match(source, /toolScaleForTool/, 'random weapon visual must reuse authored held-item scale');
assert.match(source, /heavyWeapon/, 'heavy starter tools must use the shared Heavy Weapon idle');
assert.match(source, /lightWeapon/, 'light starter tools must use the shared Light Weapon idle');

assert.match(source, /ob-3d-view-toggle-fixed/, 'visible Change View control must live outside the 3D shell');
assert.match(source, /shell\.insertAdjacentElement\('afterend', button\)/, 'Change View button must be inserted underneath the 3D viewport');
assert.match(source, /neckJoint/, 'face view must resolve the current avatar neck/head height');
assert.match(source, /faceOriginPercent/, 'face close-up must compute a species-aware on-screen anchor');
assert.match(source, /PerspectiveCamera\(38/, 'face projection must mirror the creator camera rather than using a Mao\'ao-only fixed crop');
assert.match(source, /transform-origin/, 'adaptive face zoom must anchor on the projected current face');

console.log('onboarding character-creation weapon/view fix source checks passed');

const assert = require('node:assert/strict');
const fs = require('node:fs');

const entry = fs.readFileSync('docs/onboarding.js', 'utf8');
const core = fs.readFileSync('docs/onboarding-core.js', 'utf8');
const camera = fs.readFileSync('docs/js/onboarding-character-creation-camera-composition.js', 'utf8');
const reload = fs.readFileSync('docs/js/onboarding-character-creation-reload-handoff.js', 'utf8');
const mashtzarr = fs.readFileSync('docs/js/onboarding-character-creation-mashtzarr-female.js', 'utf8');

assert.match(camera, /TARGET_PREVIEW_YAW_DEG = 10\b/, 'creator resting turn must be +10 degrees');
assert.doesNotMatch(camera, /TARGET_PREVIEW_YAW_DEG = 20\b/, 'superseded +20 degree resting turn must stay removed');
assert.match(camera, /camera\.position\.set\(1\.55, midY, 2\.75\)/, 'mid-body camera height must remain intact');
assert.match(camera, /camera\.lookAt\(0, midY, 0\)/, 'mid-body camera must remain level rather than top-down');
assert.match(entry, /onboarding-character-creation-camera-composition\.js\?v=20260910review1/, 'onboarding must load the current +10 degree camera composition');

assert.match(entry, /onboarding-character-creation-reload-handoff\.js\?v=20260907charcreator14/, 'onboarding must load the clean-page creator handoff');
assert.ok(entry.indexOf('onboarding-character-creation-weapon-view-fix.js') < entry.indexOf('onboarding-character-creation-reload-handoff.js'), 'weapon persistence must register before reload interception');
assert.match(reload, /hobunjiOnboardingPostCreatorReload\.v1/, 'reload handoff must use a session-only one-shot marker');
assert.match(reload, /#ob-overlay #ob-start-btn/, 'reload must apply only to Start Farming, not save-select Play');
assert.match(reload, /sessionStorage\.removeItem\(RESUME_KEY\)/, 'resume marker must be consumed before boot to prevent reload loops');
assert.match(reload, /event\.stopImmediatePropagation\(\)/, 'old-page gameplay listeners must not initialize before the reload');
assert.match(reload, /setTimeout\(\(\) => location\.reload\(\), 0\)/, 'creator confirmation must reload after synchronous persistence finishes');
assert.match(reload, /api\.loadProfile\?\.\(\)/, 'fresh page must resume from the already-saved player profile');
assert.match(reload, /document\.dispatchEvent\(new CustomEvent\('hobunjiPlayerReady'/, 'fresh page must deliver the saved profile to normal game listeners');

assert.match(entry, /onboarding-character-creation-mashtzarr-female\.js\?v=20260907charcreator21/, 'female Mashtzarr bridge cache key must include the female-body fix');
assert.match(core, /'mashtzarr':[\s\S]{0,1800}slot: 'hairFront'[\s\S]{0,700}slot: 'hairBack'[\s\S]{0,700}slot: 'hairSide'[\s\S]{0,700}slot: 'hairSideL'/, 'male Mashtzarr core data must contain the hairstyle selectors being borrowed');
assert.match(mashtzarr, /fallbackMode: 'female-body-male-hair-slots'/, 'female Mashtzarr fallback must borrow only hair controls');
assert.match(mashtzarr, /configuredFemaleData\(\)/, 'female fallback must use authored female Mashtzarr config as its base');
assert.match(mashtzarr, /const maleHairSlots = mashtzarr\.male\.slots\.filter/, 'female creator must borrow male hairstyle slots');
assert.match(mashtzarr, /authoredFemale\.slots\.filter\(slot => slot\?\.slot !== 'facialHair'/, 'female authored slots must exclude facial hair');
assert.match(mashtzarr, /mashtzarr\.female = femaleData/, 'core female creator data must use the female-based composite');
assert.match(mashtzarr, /bodyPalettes\?\.mashtzarr\?\.female/, 'female fallback must prefer the female Mashtzarr body palette');
assert.match(mashtzarr, /facialHairAllowed: false/, 'fallback diagnostics must state that female facial hair is forbidden');
assert.match(mashtzarr, /profile\.facialHair = null/, 'female Mashtzarr random portrait profiles must have facial hair stripped');
assert.match(mashtzarr, /realFemaleFighterAvailable/, 'fallback must diagnose whether the real female fighter is available');
assert.doesNotMatch(mashtzarr, /getPortraitFightersWithMashtzarrFemaleFallback|__hobunjiMashtzarrFemaleFallback|window\.getPortraitFighters\s*=\s*wrapped/, 'female body must never be replaced by a male portrait fighter alias');
assert.match(mashtzarr, /const originalEntries = Object\.entries/, 'bridge must capture the core private species table through its normal renderer enumeration');
assert.match(mashtzarr, /Object\.entries = originalEntries/, 'Object.entries interception must restore itself immediately after capture');
assert.doesNotMatch(mashtzarr, /Object\.prototype/, 'female fallback must not use the previous Object.prototype getter hack');
assert.doesNotMatch(mashtzarr, /nashka_khibu|hobunji-starter-npc-database/, 'temporary hairstyle fallback must not keep the superseded Nashka lookup');

console.log('onboarding creator handoff/source checks passed');

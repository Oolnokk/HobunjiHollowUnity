const assert = require('node:assert/strict');
const fs = require('node:fs');

const entry = fs.readFileSync('docs/onboarding.js', 'utf8');
const camera = fs.readFileSync('docs/js/onboarding-character-creation-camera-composition.js', 'utf8');
const reload = fs.readFileSync('docs/js/onboarding-character-creation-reload-handoff.js', 'utf8');
const mashtzarr = fs.readFileSync('docs/js/onboarding-character-creation-mashtzarr-female.js', 'utf8');

assert.match(camera, /TARGET_PREVIEW_YAW_DEG = 15\b/, 'creator resting turn must be +15 degrees');
assert.doesNotMatch(camera, /TARGET_PREVIEW_YAW_DEG = -15\b/, 'old wrong-direction -15 degree resting turn must stay removed');
assert.match(camera, /camera\.position\.set\(1\.55, midY, 2\.75\)/, 'mid-body camera height must remain intact');
assert.match(camera, /camera\.lookAt\(0, midY, 0\)/, 'mid-body camera must remain level rather than top-down');

assert.match(entry, /onboarding-character-creation-reload-handoff\.js\?v=20260907charcreator14/, 'onboarding must load the clean-page creator handoff');
assert.ok(entry.indexOf('onboarding-character-creation-weapon-view-fix.js') < entry.indexOf('onboarding-character-creation-reload-handoff.js'), 'weapon persistence must register before reload interception');
assert.match(reload, /hobunjiOnboardingPostCreatorReload\.v1/, 'reload handoff must use a session-only one-shot marker');
assert.match(reload, /#ob-overlay #ob-start-btn/, 'reload must apply only to Start Farming, not save-select Play');
assert.match(reload, /sessionStorage\.removeItem\(RESUME_KEY\)/, 'resume marker must be consumed before boot to prevent reload loops');
assert.match(reload, /event\.stopImmediatePropagation\(\)/, 'old-page gameplay listeners must not initialize before the reload');
assert.match(reload, /setTimeout\(\(\) => location\.reload\(\), 0\)/, 'creator confirmation must reload after synchronous persistence finishes');
assert.match(reload, /api\.loadProfile\?\.\(\)/, 'fresh page must resume from the already-saved player profile');
assert.match(reload, /document\.dispatchEvent\(new CustomEvent\('hobunjiPlayerReady'/, 'fresh page must deliver the saved profile to normal game listeners');

assert.match(entry, /onboarding-character-creation-mashtzarr-female\.js\?v=20260907charcreator15/, 'female Mashtzarr bridge cache key must include Nashka hairstyle update');
assert.match(mashtzarr, /NASHKA_ID = 'nashka_khibu'/, 'female Mashtzarr hairstyle source must be Nashka Khibu');
assert.match(mashtzarr, /hobunji-starter-npc-database\.json/, 'Nashka hairstyle group must come from the canonical starter NPC database');
assert.match(mashtzarr, /buildProfileFromNpcExport\?\.\(nashka\)/, 'Nashka hairstyle group must consider the hairstyle she actually renders with');
assert.match(mashtzarr, /groupPrefixesFromNashka\(nashka, renderedProfile\)/, 'Nashka hairstyle cosmetic namespace must be resolved from authored/rendered appearance');
assert.match(mashtzarr, /NpcAvatarPreview\?\.ensurePortraitCosmetics/, 'Nashka group options must come from the canonical runtime portrait cosmetic catalog');
assert.match(mashtzarr, /mergeHairOptionsIntoFemaleData\(cosmetics, prefixes\)/, 'resolved Nashka hairstyle group must be merged into the playable female Mashtzarr slots');

console.log('onboarding creator handoff/source checks passed');

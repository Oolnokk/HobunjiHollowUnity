const assert = require('node:assert/strict');
const fs = require('node:fs');

const entry = fs.readFileSync('docs/onboarding.js', 'utf8');
const camera = fs.readFileSync('docs/js/onboarding-character-creation-camera-composition.js', 'utf8');
const reload = fs.readFileSync('docs/js/onboarding-character-creation-reload-handoff.js', 'utf8');
const mashtzarr = fs.readFileSync('docs/js/onboarding-character-creation-mashtzarr-female.js', 'utf8');

assert.match(camera, /TARGET_PREVIEW_YAW_DEG = 10\b/, 'creator resting turn must be +10 degrees');
assert.doesNotMatch(camera, /TARGET_PREVIEW_YAW_DEG = 20\b/, 'superseded +20 degree resting turn must stay removed');
assert.match(camera, /camera\.position\.set\(1\.55, midY, 2\.75\)/, 'mid-body camera height must remain intact');
assert.match(camera, /camera\.lookAt\(0, midY, 0\)/, 'mid-body camera must remain level rather than top-down');
assert.match(entry, /onboarding-character-creation-camera-composition\.js\?v=20260907charcreator18/, 'onboarding must load the current +10 degree camera composition');

assert.match(entry, /onboarding-character-creation-reload-handoff\.js\?v=20260907charcreator14/, 'onboarding must load the clean-page creator handoff');
assert.ok(entry.indexOf('onboarding-character-creation-weapon-view-fix.js') < entry.indexOf('onboarding-character-creation-reload-handoff.js'), 'weapon persistence must register before reload interception');
assert.match(reload, /hobunjiOnboardingPostCreatorReload\.v1/, 'reload handoff must use a session-only one-shot marker');
assert.match(reload, /#ob-overlay #ob-start-btn/, 'reload must apply only to Start Farming, not save-select Play');
assert.match(reload, /sessionStorage\.removeItem\(RESUME_KEY\)/, 'resume marker must be consumed before boot to prevent reload loops');
assert.match(reload, /event\.stopImmediatePropagation\(\)/, 'old-page gameplay listeners must not initialize before the reload');
assert.match(reload, /setTimeout\(\(\) => location\.reload\(\), 0\)/, 'creator confirmation must reload after synchronous persistence finishes');
assert.match(reload, /api\.loadProfile\?\.\(\)/, 'fresh page must resume from the already-saved player profile');
assert.match(reload, /document\.dispatchEvent\(new CustomEvent\('hobunjiPlayerReady'/, 'fresh page must deliver the saved profile to normal game listeners');

assert.match(entry, /onboarding-character-creation-mashtzarr-female\.js\?v=20260907charcreator17/, 'female Mashtzarr bridge cache key must include the temporary male fallback');
assert.match(mashtzarr, /fallbackMode: 'male-mashtzarr'/, 'female Mashtzarr bridge must declare the male fallback mode');
assert.match(mashtzarr, /value: this\.male/, 'core female Mashtzarr creator data must reuse the working male Mashtzarr data');
assert.match(mashtzarr, /gender: 'female', __hobunjiMashtzarrFemaleFallback: true/, 'male portrait fighter must be aliased as a female Mashtzarr candidate');
assert.match(mashtzarr, /window\.getPortraitFighters = wrapped/, 'temporary fallback must affect normal portrait/profile selection, not only the visible button');
assert.doesNotMatch(mashtzarr, /nashka_khibu|hobunji-starter-npc-database/, 'temporary male fallback must not keep the superseded Nashka hairstyle lookup');
assert.match(mashtzarr, /overlayObserver\.observe\(overlay, \{ childList: true \}\)/, 'female fallback observer must remain direct-child-only');
assert.doesNotMatch(mashtzarr, /subtree:\s*true/, 'female fallback must not reintroduce recursive creator observers');

console.log('onboarding creator handoff/source checks passed');

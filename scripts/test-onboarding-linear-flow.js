const assert = require('node:assert/strict'); // Verifies the linear onboarding integration without duplicating browser implementation logic.
const fs = require('node:fs'); // Reads the shipped onboarding owners directly from the repository.

const entry = fs.readFileSync('docs/onboarding.js', 'utf8'); // Parser-load order determines player-ready capture-listener order.
const flow = fs.readFileSync('docs/js/onboarding-linear-flow.js', 'utf8'); // Linear flow controller under test.
const core = fs.readFileSync('docs/onboarding-core.js', 'utf8'); // Preserved save/world authority whose old atomic completion is deliberately intercepted.
const randomName = fs.readFileSync('docs/js/onboarding-random-name.js', 'utf8'); // Existing culture-aware random-name authority reused by the flow.

assert.match(entry, /onboarding-linear-flow\.js\?v=[A-Za-z0-9_.-]+/, 'onboarding entrypoint must load the linear flow controller');
assert.match(entry, /weaponPolishUrl[\s\S]*linearFlowUrl[\s\S]*reloadHandoffUrl/, 'linear flow must load after starter-weapon persistence but before the clean gameplay reload handoff');
assert.match(flow, /let creatorStep = 'appearance'/, 'new character creation must start on Appearance');
assert.match(flow, /setCreatorStep\('collections'\)/, 'Appearance must advance linearly to Clothing');
assert.match(flow, /setCreatorStep\('name'\)/, 'Clothing must advance linearly to Name');
assert.match(flow, /setLinearHidden\(overlay\.querySelector\('\.ob-tabs'\), true\)/, 'legacy creator tabs must be hidden so required steps cannot be jumped around');
assert.match(flow, /Step 2 of 3 — choose your starting clothing and dyes/, 'Clothing must be presented as an explicit required pass-through step');

assert.match(randomName, /generateFor\(speciesId, gender\)/, 'existing onboarding random-name module must expose species/gender cultural generation');
assert.match(flow, /hobunjiOnboardingRandomName\?\.generateFor\?\.\(identity\.speciesId, identity\.gender\)/, 'blank character names must reuse the existing cultural random-name generator');
assert.doesNotMatch(flow, /nickname[^\n]*\|\|\s*['"]Farmer['"]/, 'linear flow must never restore the generic Farmer fallback for a blank new-character name');
assert.match(flow, /Traveler-\$\{Math\.floor\(1000 \+ Math\.random\(\) \* 9000\)\}/, 'even the last-resort name fallback must remain random instead of Farmer');

assert.match(core, /const newWorld = makeDefaultWorld\(charId\)/, 'regression premise: preserved core still contains the legacy atomic character+world completion that must be intercepted');
assert.match(flow, /event\.stopImmediatePropagation\(\);[^\n]*Prevents gameplay\/reload consumers/, 'creator completion must stop the temporary legacy world from reaching gameplay consumers');
assert.match(flow, /meta\.worlds = \(meta\.worlds \|\| \[\]\)\.filter\(world => world\?\.id !== worldId\)/, 'temporary world created by legacy completion must be removed while the new character remains');
assert.match(flow, /localStorage\.removeItem\(PROFILE_KEY\)/, 'no active player/world profile may survive between character creation and required farm setup');
assert.match(flow, /persistSetupMarker\(characterId\)/, 'new character must carry a reload-safe marker into farm setup');
assert.match(flow, /resumePendingFarmSetup\(resumeMarker\)/, 'clean reload must resume the unfinished character at farm setup rather than ordinary gameplay');

assert.match(flow, /worldStep = 'name'/, 'new-world creation must begin at the dedicated Farm Name step');
assert.match(flow, /nameInput\.value = ''[\s\S]{0,120}dispatchEvent\(new Event\('input'/, 'core automatic farm name must be cleared through its own input state when Farm Name begins');
assert.match(flow, /const valid = !!String\(input\.value \|\| ''\)\.trim\(\)[\s\S]{0,100}play\.disabled = !valid/, 'Farm Name forward action must be disabled for blank or whitespace-only names');
assert.match(flow, /Name the farm or use Randomize farm name before continuing/, 'blank farm names must produce a visible actionable error instead of silently generating a world');
assert.match(flow, /setWorldStep\('setup'\)/, 'valid Farm Name must advance to Farm Setup before any world is created');
assert.match(flow, /event\.key !== 'Enter' \|\| worldStep !== 'name'[\s\S]{0,180}stopImmediatePropagation/, 'Enter in Farm Name must not trigger the core old direct Play shortcut');
assert.match(flow, /Create Farm & Play/, 'only the final Farm Setup step may expose world creation/play');
assert.match(flow, /dataset\.obLinearFinalPlay = '1'/, 'final Play must mark the existing clean reload handoff without changing ordinary save-select Play');

assert.match(flow, /window\[FLOW_ID\] = Object\.freeze\(\{[\s\S]*status,/, 'linear flow must expose mobile-readable status diagnostics');
assert.match(flow, /ob-linear-flow-error/, 'linear flow errors must be visible in-page for mobile testing without DevTools');

console.log('linear onboarding source checks passed');

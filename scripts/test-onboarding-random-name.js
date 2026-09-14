const assert = require('node:assert/strict');
const fs = require('node:fs');

const entry = fs.readFileSync('docs/onboarding.js', 'utf8');
const randomName = fs.readFileSync('docs/js/onboarding-random-name.js', 'utf8');

assert.match(entry, /onboarding-random-name\.js\?v=20260913randomname1/, 'onboarding must load the random-name enhancement');
assert.match(entry, /redesignUrl[\s\S]{0,500}randomNameUrl[\s\S]{0,500}lifePreviewUrl/, 'random-name enhancement must load with the other character-creation presentation modules');

assert.match(randomName, /BanditNameForge/, 'random names must reuse the bandit name forge');
assert.match(randomName, /generateCulturalIdentity\(\{ speciesId, gender \}\)/, 'name generation must use the selected species and gender');
assert.match(randomName, /identity\?\.givenName/, 'character creation must use first names only');
assert.doesNotMatch(randomName, /\.surname\b|\.loreName\b|generateCaptainIdentity/, 'character creation must not copy bandit surnames or captain nicknames');
assert.match(randomName, /input\.dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)/, 'generated names must flow through onboarding-core nickname state');
assert.match(randomName, /data-ob-random-name="1"/, 'creator must expose a Random Name button');
assert.match(randomName, /Random Name/, 'random-name control must be visibly labelled');

assert.match(randomName, /lastAutoIdentityKey === null \? 'initial-species-gender' : 'species-gender-change'/, 'initial species+gender and later identity changes must auto-roll');
assert.match(randomName, /if \(lastAutoIdentityKey === identityKey\) return;/, 'unrelated creator rerenders must not change the name');
assert.match(randomName, /if \(!input\) return; \/\/ Collections tab:/, 'Collections tab must preserve the current generated/manual name');
assert.match(randomName, /if \(!inCreator\)[\s\S]{0,120}lastAutoIdentityKey = null/, 'leaving character creation must reset the initial-roll guard for the next new character');

assert.match(randomName, /overlayObserver\.observe\(overlay, \{ childList: true \}\)/, 'identity-change observation must stay scoped to direct onboarding card replacement');
assert.doesNotMatch(randomName, /overlayObserver\.observe\(overlay, \{[^}]*subtree:\s*true/, 'random-name observer must not watch its own nested control mutations');
assert.match(randomName, /bodyObserver\.observe\(document\.body, \{ childList: true \}\)/, 'body observer must only detect overlay mount/unmount');
assert.match(randomName, /Random-name generator unavailable:/, 'generator failures must be visible in the creator for mobile debugging');

console.log('onboarding random-name source checks passed');

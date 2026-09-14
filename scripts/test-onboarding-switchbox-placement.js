const assert = require('node:assert/strict');
const fs = require('node:fs');

const entry = fs.readFileSync('docs/onboarding.js', 'utf8');
const placement = fs.readFileSync('docs/js/onboarding-switchbox-placement.js', 'utf8');
const switchbox = fs.readFileSync('docs/js/dev-testing-switchbox.js', 'utf8');

assert.match(entry, /onboarding-switchbox-placement\.js\?v=20260913switchboxworld1/, 'onboarding must load the switchbox placement guard');
assert.match(switchbox, /devSwitchboxSaveSelectSection/, 'placement guard must target the existing switchbox onboarding section rather than duplicate its controls');

assert.match(placement, /querySelector\('#slPlay'\)/, 'world-step detection must use the existing Play control');
assert.match(placement, /querySelector\('#slBackToCharacter'\)/, 'world-step detection must require the existing Back-to-Character control');
assert.match(placement, /:not\(\[data-world-select-placed="1"\]\)\{display:none!important\}/, 'unapproved switchbox injections must be hidden before they can affect creator layout');
assert.match(placement, /section\.style\.display = 'none'/, 'non-world onboarding steps must keep the switchbox hidden');
assert.match(placement, /document\.createElement\('details'\)/, 'world-select switchbox must use a collapsible details element');
assert.doesNotMatch(placement, /details\.open\s*=\s*true|setAttribute\(['"]open/, 'world-select switchbox must remain collapsed by default');
assert.match(placement, /footer\.before\(section\)/, 'switchbox must live inside the World step immediately before its footer');
assert.match(placement, /className = 'sl-dev-details ob-world-switchbox-details'/, 'switchbox must reuse the existing collapsed dev-details styling');
assert.match(placement, /HOBUNJI_ONBOARDING_SWITCHBOX_PLACEMENT_STATUS/, 'placement guard must expose mobile-visible diagnostic state');

console.log('onboarding switchbox placement source checks passed');

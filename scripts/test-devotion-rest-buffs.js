'use strict';

const assert = require('node:assert/strict'); // Deterministic source-level regression assertions for the prayer/rest feature.
const fs = require('node:fs'); // Reads the shipped core, integration shim, and bootstrap source.
const path = require('node:path'); // Resolves repository-relative paths.
const vm = require('node:vm'); // Syntax-checks browser modules without requiring a renderer.

const root = path.resolve(__dirname, '..'); // Used as the common repository root for every source read below.
const core = fs.readFileSync(path.join(root, 'docs/js/temple-prayer-rest-blessings.js'), 'utf8'); // Single authority for saves, prayer effects, menu, sleep timing, and buff-bar entries.
const integration = fs.readFileSync(path.join(root, 'docs/js/devotion-rest-buffs.js'), 'utf8'); // Compatibility layer for seat detection, floating prompt, movement, and rounded potion tiers.
const sleepBridge = fs.readFileSync(path.join(root, 'docs/js/sleep-passage-action-bridge.js'), 'utf8'); // Existing guaranteed bootstrap used to load the feature.
const social = fs.readFileSync(path.join(root, 'docs/config/npcs/social-relations.js'), 'utf8'); // Authored morning-service schedule consumed by the prayer core.

assert.doesNotThrow(() => new vm.Script(core), 'temple prayer/rest core parses');
assert.doesNotThrow(() => new vm.Script(integration), 'prayer/rest integration parses');
assert.doesNotThrow(() => new vm.Script(sleepBridge), 'sleep bridge still parses');

assert.match(sleepBridge, /devotion-rest-buffs\.js\?v=[A-Za-z0-9_.-]+/, 'existing Sleep bootstrap loads the prayer/rest integration');
assert.match(integration, /temple-prayer-rest-blessings\.js\?v=[A-Za-z0-9_.-]+/, 'integration loads exactly one prayer/rest core authority');
assert.match(core, /PRAYER_DURATION_HOURS\s*=\s*7\s*\*\s*24/, 'prayers last one in-game week');
assert.match(core, /WELL_RESTED_DURATION_HOURS\s*=\s*16/, 'Well Rested lasts sixteen in-game hours');
assert.match(social, /id:\s*'shared_temple_service'[\s\S]{0,500}from:\s*'09:00'[\s\S]{0,200}to:\s*'11:00'/, 'prayer eligibility reuses the authored Anan morning service');
const activeServiceBody = core.match(/function activeTempleService\(\) \{([\s\S]*?)\n  \}\n\n  function seatedInTemplePew/)?.[1] || ''; // Isolates service gating so night communion cannot silently become prayer-eligible again.
assert.match(activeServiceBody, /schedule\.id\s*!==\s*'shared_temple_service'/, 'Pray is gated specifically to the morning Temple Service event');
assert.doesNotMatch(activeServiceBody, /return\s*\{\s*id:\s*'spirit_communion'/, 'night Spirit Communion never opens the prayer chooser');

for (const prayer of ["Nao'ine Prayer", 'Krurenic Prayer', 'Narshangetic Prayer']) {
  assert(core.includes(prayer), `${prayer} is authored in the prayer chooser`);
}
assert.match(core, /healingMultiplier:\s*1\.20[\s\S]{0,100}foraging:\s*3,\s*farming:\s*3/, "Nao'ine buffs healing, Foraging, and Farming");
assert.match(core, /damageTakenMultiplier:\s*0\.85[\s\S]{0,100}mining:\s*3/, 'Krurenic buffs damage resistance and Mining');
assert.match(core, /afflictionRecoveryMultiplier:\s*1\.35[\s\S]{0,100}dotApplicationMultiplier:\s*0\.70[\s\S]{0,100}fishing:\s*3/, 'Narshangetic buffs affliction recovery, DoT resistance, and Fishing');
assert.match(core, /applyHealthRecovery\s*=\s*function templeBlessingHealthRecovery/, "Nao'ine wraps the shared Health-recovery authority rather than selected healing sources");
assert.match(core, /applyDamage\s*=\s*function templeBlessingApplyDamage/, 'Krurenic wraps shared direct player damage');
assert.match(core, /addAffliction\s*=\s*function templeBlessingAddAffliction/, 'Narshangetic wraps shared DoT-affliction application');

assert.match(core, /panel\.dataset\.ctrlPanel\s*=\s*'templePrayerMenu'/, 'prayer chooser uses the existing controller-panel navigation contract');
assert.match(core, /role',\s*'dialog'[\s\S]{0,100}aria-modal/, 'prayer chooser is a semantic modal for controller/keyboard navigation');
assert.match(integration, /syncInteractionPrompts\s*=\s*wrapped/, 'Pray is added to the same floating world-interaction prompt pipeline as targeted objects');
assert.match(integration, /action:\s*'temple_pray'[\s\S]{0,100}label:\s*'Pray'[\s\S]{0,100}worldInteraction:\s*true/, 'floating prompt contains a real Pray world action');
assert.match(integration, /prayerSlot\s*=\s*buttons\.findIndex[\s\S]{0,500}promptInputs\[prayerSlot\]/, 'Pray keeps its input hint aligned with the actual action-bar slot');
assert.match(integration, /function prayerPromptRoot\(\)[\s\S]{0,900}forwardDistance\s*=\s*1\.05[\s\S]{0,900}root:\s*prayerPromptRoot\(\)\s*\|\|\s*options\.root/, 'Pray prompt uses a reusable world anchor positioned in front of the seated player');
assert.match(integration, /sitState[\s\S]{0,150}sitInteraction/, 'integration aliases the prayer core to the game’s actual seated-interaction state');

assert.match(sleepBridge, /OWNED_BED_SLEEP_PENDING_KEY\s*=\s*'__hobunjiOwnedBedSleepPending'/, 'the real player-bed Sleep action owns a one-shot Well Rested token');
assert.match(sleepBridge, /function armOwnedBedSleep\(\)[\s\S]{0,300}source:\s*'player-bed'/, 'visible bed Sleep arms the owned-bed token');
assert.match(sleepBridge, /if \(code === 'KeyE'\) \{ armOwnedBedSleep\(\); return; \}/, 'legacy E-key bed Sleep arms the same token before CalendarSystem handles it');
assert.match(core, /function consumeOwnedBedSleepToken\(\)[\s\S]{0,500}token\.source !== 'player-bed'/, 'blessing core consumes only the player-bed token');
assert.match(core, /detail\?\.kind\s*!==\s*'sleep'[\s\S]{0,180}!consumeOwnedBedSleepToken\(\)/, 'generic/debug Sleep passages cannot grant Well Rested');
assert.match(core, /movementSpeedMultiplier\(\) \{ return isWellRested\(\) \? 1\.08 : 1; \}/, 'Well Rested defines a small movement-speed bonus');
assert.match(integration, /getMovementSpeedMul[\s\S]{0,450}movementSpeedMultiplier/, 'Well Rested movement speed is connected to the actual Combat movement multiplier');
assert.match(core, /staminaRegenPerSec[\s\S]{0,120}\* 1\.30/, 'Well Rested gives a substantial Stamina-recovery bonus');
assert.match(core, /Math\.floor\(base \/ 3\)/, 'food buffs gain one third of their stack count, rounded down');
const potionStackScaleBody = integration.match(/function potionStackScale\(effect\) \{([\s\S]*?)\n  \}/)?.[1] || ''; // Isolates the exact potion stack-equivalent calculation instead of depending on comment length between its statements.
assert.match(potionStackScaleBody, /potencyTier/, 'potion stack-equivalent derives from the stored potency tier');
assert.match(potionStackScaleBody, /Math\.floor\(baseStacks \/ 3\)/, 'potion potency tiers gain exactly one third of their stack-equivalent, rounded down');
assert.match(core, /registerProvider\('temple-prayer-rest'/, 'prayers and Well Rested render through the existing EffectBuffBar');

assert.match(core, /prayerRestSnapshot\s*=\s*debugSnapshot/, 'core state is available in the existing mobile debug surface');
assert.match(integration, /prayerRestIntegrationSnapshot\s*=\s*debugSnapshot/, 'integration-hook status is separately visible without devtools');
assert.match(sleepBridge, /ownedBedSleepPending[\s\S]{0,100}ownedBedSleepArmCount/, 'sleep debug snapshot exposes whether a real bed sleep was armed');

console.log('temple prayer and Well Rested regression passed');
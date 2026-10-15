'use strict';

const assert = require('node:assert/strict'); // Deterministic source-level regression assertions for the prayer/rest feature.
const fs = require('node:fs'); // Reads the shipped core, integration shim, bootstrap sources, and temple map.
const path = require('node:path'); // Resolves repository-relative paths.
const vm = require('node:vm'); // Syntax-checks browser modules without requiring a renderer.

const root = path.resolve(__dirname, '..'); // Used as the common repository root for every source read below.
const core = fs.readFileSync(path.join(root, 'docs/js/temple-prayer-rest-blessings.js'), 'utf8'); // Single authority for saves, prayer effects, menu, sleep timing, and buff-bar entries.
const integration = fs.readFileSync(path.join(root, 'docs/js/devotion-rest-buffs.js'), 'utf8'); // Compatibility layer for seat detection, floating prompt, movement, and rounded potion tiers.
const sleepBridge = fs.readFileSync(path.join(root, 'docs/js/sleep-passage-action-bridge.js'), 'utf8'); // Existing guaranteed bootstrap used to load the feature.
const combatBootstrap = fs.readFileSync(path.join(root, 'docs/js/combat/combat-config-loader.js'), 'utf8'); // Parser-time module loader that must request the current Sleep bridge URL/version.
const social = fs.readFileSync(path.join(root, 'docs/config/npcs/social-relations.js'), 'utf8'); // Authored Anan morning-service schedule kept separate from all-day prayer eligibility.
const temple = JSON.parse(fs.readFileSync(path.join(root, 'docs/config/maps/map_i_temple.json'), 'utf8')); // Alternate Spirit Communion layout used to verify its moved benches remain prayer-capable.

assert.doesNotThrow(() => new vm.Script(core), 'temple prayer/rest core parses');
assert.doesNotThrow(() => new vm.Script(integration), 'prayer/rest integration parses');
assert.doesNotThrow(() => new vm.Script(sleepBridge), 'sleep bridge still parses');
assert.doesNotThrow(() => new vm.Script(combatBootstrap), 'parser-time compatibility bootstrap still parses');

assert.match(combatBootstrap, /sleep-passage-action-bridge\.js\?v=[A-Za-z0-9_.-]+[\s\S]{0,120}HobunjiSleepPassageActionBridge\?\.version\)\s*>=\s*3/, 'parser-time loader requests a cache-busted Sleep bridge and requires the current bridge version');
assert.match(sleepBridge, /devotion-rest-buffs\.js\?v=[A-Za-z0-9_.-]+/, 'Sleep bridge cache-busts the prayer/rest integration');
assert.match(integration, /temple-prayer-rest-blessings\.js\?v=[A-Za-z0-9_.-]+/, 'integration cache-busts the prayer/rest core authority');
assert.match(core, /PRAYER_DURATION_HOURS\s*=\s*7\s*\*\s*24/, 'prayers last one in-game week');
assert.match(core, /WELL_RESTED_DURATION_HOURS\s*=\s*16/, 'Well Rested lasts sixteen in-game hours');
assert.match(social, /id:\s*'shared_temple_service'[\s\S]{0,300}day:\s*'Anan'[\s\S]{0,300}from:\s*'09:00'[\s\S]{0,200}to:\s*'11:00'/, 'formal Temple Service remains an Anan morning event rather than expanding to all day');
const prayerDayBody = core.match(/function activeTemplePrayerDay\(\) \{([\s\S]*?)\n  \}\n\n  function seatedInTemplePew/)?.[1] || ''; // Isolates day gating so service-hour checks cannot silently return.
assert.match(prayerDayBody, /currentWeekdayName\?\.\(\)/, 'prayer eligibility reads the public civil weekday');
assert.match(prayerDayBody, /weekday\s*===\s*'Anan'/, 'Pray is available throughout Anan');
assert.doesNotMatch(prayerDayBody, /shared_temple_service|parseMinutes|withinWindow|getHour/, 'all-day Anan prayer no longer depends on the morning service window');
const seatedBody = core.match(/function seatedInTemplePew\(\) \{([\s\S]*?)\n  \}\n\n  function promptEligible/)?.[1] || ''; // Isolates seat qualification for both ordinary and alternate temple layouts.
assert.match(seatedBody, /sit\.furnitureKey\s*===\s*'benchFurniture'/, 'any temple bench can serve as a prayer pew');
assert.match(seatedBody, /getCurrentArea\?\.\(\)\s*===\s*'map_i_temple'/, 'bench prayer remains temple-only');
const communion = (temple.layouts || []).find(layout => layout.id === 'spirit_communion');
assert(communion, 'temple retains the Spirit Communion alternate layout');
assert((communion.conditions || []).some(condition => condition.from === '00:00' && condition.to === '03:00' && (condition.days || []).includes('Anan')), 'Spirit Communion is authored on Anan from midnight to 03:00');
const communionPrayerBench = (communion.furniture || []).find(piece => piece.id === 'sc_bench_w1');
assert.equal(communionPrayerBench?.itemKey, 'benchFurniture', 'a known moved Spirit Communion pew uses the generic bench key consumed by prayer eligibility');

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
const promptHookBody = integration.match(/const wrapped = function syncPrayerPrompt\(options = \{\}\) \{([\s\S]*?)\n    \};/)?.[1] || ''; // Isolates prompt-slot bookkeeping so assertion length does not depend on nearby comments/branches.
assert.match(promptHookBody, /prayerSlot\s*=\s*buttons\.findIndex/, 'Pray resolves its actual action-bar slot');
assert.match(promptHookBody, /promptInputs\[prayerSlot\]\s*=\s*\{\s*actionId:\s*'temple_pray'/, 'Pray keeps its input hint aligned with the resolved action-bar slot');
const promptRootBody = integration.match(/function prayerPromptRoot\(\) \{([\s\S]*?)\n  \}\n\n  function action3Hint/)?.[1] || ''; // Isolates the synthetic world anchor so source growth elsewhere cannot invalidate this regression.
assert.match(promptRootBody, /forwardDistance\s*=\s*1\.05/, 'Pray prompt anchor stays in front of the seated player');
assert.match(promptRootBody, /return\s+prayerPromptAnchor/, 'Pray prompt reuses the synthetic world anchor');
assert.match(promptHookBody, /root:\s*prayerPromptRoot\(\)\s*\|\|\s*options\.root/, 'floating Pray prompt passes that world anchor into the existing prompt renderer');
assert.match(integration, /prayerSlot:\s*state\.lastPrayerSlot/, 'mobile diagnostics expose the live Pray action slot');
assert.match(integration, /sitState[\s\S]{0,150}sitInteraction/, 'integration aliases the prayer core to the game’s actual seated-interaction state');

assert.match(sleepBridge, /OWNED_BED_SLEEP_PENDING_KEY\s*=\s*'__hobunjiOwnedBedSleepPending'/, 'the real player-bed Sleep action owns a one-shot Well Rested token');
assert.match(sleepBridge, /function armOwnedBedSleep\(\)[\s\S]{0,300}source:\s*'player-bed'/, 'visible bed Sleep arms the owned-bed token');
assert.match(sleepBridge, /function openSharedSleepPassage\(\)[\s\S]{0,300}armOwnedBedSleep\(\)[\s\S]{0,300}open\.call\(window\.CalendarSystem, 'sleep'\)/, 'all bed Sleep input paths arm the same token before opening the shared Sleep passage');
assert.match(sleepBridge, /function onKeyDown\(event\)[\s\S]{0,1200}consumeEvent\(event\)[\s\S]{0,400}armedKeyCode = code/, 'parser-time Sleep bridge captures the displayed Sleep key before legacy game input');
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
assert.match(core, /prayerWeekday:\s*lastPrayerWeekday/, 'prayer diagnostics expose the weekday used for eligibility');
assert.match(integration, /prayerRestIntegrationSnapshot\s*=\s*debugSnapshot/, 'integration-hook status is separately visible without devtools');
assert.match(sleepBridge, /ownedBedSleepPending[\s\S]{0,100}ownedBedSleepArmCount/, 'sleep debug snapshot exposes whether a real bed sleep was armed');

// Exercise the parser-time boot with a real saved blessing and a calendar whose
// public reads throw until init. Boot must neither throw nor discard the save.
let calendarReady = false;
let calendarDay = 10;
let calendarTime = .25;
let calendarReads = 0;
let prayerWeekday = 'Anan';
const savedMeta = { characters: [{ id: 'clock-test', templePrayerRestBlessings: {
  prayer: { id: 'naoine', startedAtGameHour: 240, expiresAtGameHour: 250 },
  wellRested: { startedAtGameHour: 240, expiresAtGameHour: 250 },
} }] };
const storage = new Map([['hobunjiSaveMeta', JSON.stringify(savedMeta)]]);
const clockWindow = {
  __hobunjiPlayerProfile: { characterId: 'clock-test' },
  CalendarSystem: {
    isInitialized: () => calendarReady,
    timeDebugSnapshot: () => {
      calendarReads++;
      if (!calendarReady) throw new Error('calendar read before init');
      return { rawDay: calendarDay, time01: calendarTime };
    },
    getHour: () => { throw new Error('must use monotonic calendar snapshot'); },
    currentWeekdayName: () => prayerWeekday,
  },
  addEventListener() {}, setInterval() {},
};
const clockContext = {
  window: clockWindow,
  document: { addEventListener() {}, getElementById: () => null },
  localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
};
assert.doesNotThrow(() => vm.runInNewContext(core, clockContext));
assert.equal(calendarReads, 0, 'parser-time boot defers calendar reads');
assert.equal(clockWindow.TemplePrayerRestBlessings.activePrayer()?.id, 'naoine');
assert.equal(clockWindow.TemplePrayerRestBlessings.isWellRested(), true);
calendarReady = true;
clockWindow.__hobunjiFurnitureDebug = {
  getCurrentArea: () => 'map_i_temple',
  sitState: { phase: 'in', furnitureKey: 'benchFurniture', furnitureId: 'sc_bench_w1' },
};
assert.equal(clockWindow.TemplePrayerRestBlessings._test.promptEligible(), true, 'generic Spirit Communion bench is prayer-eligible on Anan');
prayerWeekday = 'Uung';
assert.equal(clockWindow.TemplePrayerRestBlessings._test.promptEligible(), false, 'same temple bench is not prayer-eligible off Anan');
prayerWeekday = 'Anan';
assert.equal(clockWindow.TemplePrayerRestBlessings.debugSnapshot().gameHour, 246);
assert.equal(clockWindow.TemplePrayerRestBlessings.isWellRested(), true);
calendarTime = .5;
assert.equal(clockWindow.TemplePrayerRestBlessings._test.expireState(), true);
assert.equal(clockWindow.TemplePrayerRestBlessings.activePrayer(), null);
assert.equal(clockWindow.TemplePrayerRestBlessings.isWellRested(), false);
assert.equal(JSON.parse(storage.get('hobunjiSaveMeta')).characters[0].templePrayerRestBlessings.prayer, null);

console.log('temple prayer and Well Rested regression passed');

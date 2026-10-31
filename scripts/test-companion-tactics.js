'use strict';
// Execute progression, saved loadouts, the real companion action seam, and outgoing hit scaling together.
const assert = require('node:assert/strict'); // Assertions cover behavior, including malformed saves and cooldown-only loadouts.
const fs = require('node:fs'); // Loads the production modules used by this VM fixture.
const vm = require('node:vm'); // Isolates browser globals without replacing any training logic.
class Element {
  constructor(tag) { this.tagName = tag; this.style = {}; this.children = []; this.listeners = {}; }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  querySelector() { return null; }
}
const stable = [ // Existing level-10 saves must keep their perks and resume earning XP.
  { id: 'hound', kind: 'dabinggi-hound', role: 'companion', lifeStage: 'adult', level: 10, stableXp: 0, animalPerks: { rapportBond: 2 } },
  { id: 'mount', kind: 'gar-wolf', role: 'mount', level: 9, stableXp: 0 },
  { id: 'pet', kind: 'puktuk', role: 'shoulderPet', level: 9, stableXp: 0 },
  { id: 'kick', kind: 'voorg-ass', role: 'companion', lifeStage: 'adult', level: 5, animalPerks: {} },
  { id: 'grehlr', kind: 'grehlr', role: 'companion', lifeStage: 'adult', level: 5, animalPerks: {} },
  { id: 'baby', kind: 'dabinggi-hound', role: 'companion', lifeStage: 'baby', level: 0 },
];
const definitions = { // These are existing species actions, supplied by the same FarmAnimals deps as the game.
  'dabinggi-hound': { attacks: ['pounce'], attackDamage: 10, attackCooldownS: 2, attackRangePx: 100, attackStaminaCost: 10 },
  'voorg-ass': { attacks: ['rearKick'] },
  grehlr: { attacks: ['grehlrBurrow'] },
};
const player = { x: 0, y: 0 }; // Ownership guard uses exact player identity.
const actor = { isCompanion: true, stableRole: 'companion', stableId: 'hound', creatureKey: 'dabinggi-hound', health: 100, master: player, def: definitions['dabinggi-hound'] }; // Live companion for selection and effect tests.
let saves = 0; // Counts persistence writes; combat itself must never save.
let kickReady = true; // Drives the real special readiness gate deterministically.
const deps = { getStable: () => stable, saveStable() { saves++; }, getActiveCompanionId: () => actor.stableId, CREATURE_DB: definitions }; // Ordinary farm persistence contract.
const context = { window: null, console, document: { createElement: tag => new Element(tag), getElementById: () => null },
  FarmAnimals: { init() {} }, FarmPanel: { init() {}, renderStablePanel() {} },
  CreatureGenetics: { stableEntryRole: entry => entry.role },
  Combat: { deps: { player, companionObjects: [actor] } },
  VoorgAssRearKick: { canUse: () => kickReady, isVoorgAss: c => c.creatureKey === 'voorg-ass' },
}; // Only external engine surfaces are stubbed; all progression and tactics execute unchanged.
context.window = context;
vm.createContext(context);
for (const file of ['stable-animal-progression.js', 'stable-animal-training-refinements.js', 'combat/companion-offense.js']) {
  vm.runInContext(fs.readFileSync('docs/js/' + file, 'utf8'), context, { filename: file });
}
const progression = context.StableAnimalProgression; // Production progression authority.
const tactics = context.StableAnimalTrainingRefinements; // Production loadout API.
progression.install();
tactics.install();
context.FarmAnimals.init(deps);
assert.equal(progression.awardXp('hound', 240).levels, 1);
assert.equal(stable[0].level, 11, 'a previously capped companion immediately resumes leveling');
assert.equal(stable[0].animalPerks.rapportBond, 2, 'existing perks survive migration');
assert.equal(progression.awardXp('hound', 1e6).levels, 19, 'large XP awards stop at 30');
assert.equal(stable[0].stableXp, 0);
assert.equal(progression.availablePoints(stable[0]), 28, 'extra levels grant ordinary perk points');
for (const id of ['mount', 'pet']) {
  progression.awardXp(id, 1e6);
  assert.equal(progression.findStableEntry(id).level, 10);
  assert.equal(progression.findStableEntry(id).stableXp, 0);
  assert.equal(progression.xpToNext(10, progression.findStableEntry(id)), 0);
}
assert.equal(progression.xpToNext(10, stable[0]), 240);
stable[0].level = 12;
assert.equal(progression.awardXp('hound', Infinity).amount, 0, 'nonfinite awards cannot max an animal');
assert.equal(progression.awardXp('hound', -10).amount, 0);
const beforeCombatSaves = saves; // Selection is entirely in memory until an explicit configuration change.
const counts = {}; // Smooth weighted rotation yields the exact configured action share without random streaks.
for (let i = 0; i < 40; i++) { const id = tactics.chooseAttack(actor).id; counts[id] = (counts[id] || 0) + 1; }
assert.deepEqual(counts, { guardCharge: 30, pounce: 10 });
assert.equal(saves, beforeCombatSaves);
assert.equal(tactics.setTactics('baby', {}).ok, false);
assert.equal(tactics.setTactics('mount', {}).ok, false);
assert.equal(tactics.setTactics('missing', {}).ok, false);
assert(tactics.setTactics('hound', { tempo: 'relentless', abilities: { guardCharge: { frequency: 0 }, pounce: { frequency: 4, effect: 'power' }, rearKick: { frequency: 4 } } }).ok);
assert(!('rearKick' in stable[0].companionTactics.abilities), 'edited saves cannot grant another species move');
assert.equal(tactics.tacticsForEntry(stable[0]).abilities.guardCharge.frequency, 1, 'Guard Charge cannot be turned Off');
assert.equal(tactics.chooseAttack(actor).id, 'pounce');
assert.equal(tactics.combatTempo(actor).stamina, 1.3);
const hit = context.CompanionOffense.scaleHit(actor, {}, 10, { footingDamageMultiplier: 2, afflictionBonuses: { poison: 10 } }); // Shared hit path must keep Footing independent of Health scaling.
assert.equal(hit.amount, 13.5);
assert(Math.abs(hit.amount * hit.opts.afflictionBonuses.poison - 75) < 1e-9, 'damage and affliction focus scale independent channels');
assert(Math.abs(hit.amount * hit.opts.footingDamageMultiplier - 15) < 1e-9);
assert.equal(definitions['dabinggi-hound'].attackDamage, 10, 'shared species definition remains untouched');
// Test final buildup through ResourceSystem, whose affliction coefficients multiply the actual hit damage.
context.performance = performance;
context.dispatchEvent = () => {};
context.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
vm.runInContext(fs.readFileSync('docs/js/combat/resource-system.js', 'utf8'), context);
const resources = context.ResourceSystem; // Real terminal damage transaction, instead of inspecting only an intermediate coefficient.
const victim = { health: 1000, maxHealth: 1000, stamina: 100, maxStamina: 100, footing: 100, maxFooting: 100 }; // Plenty of capacity prevents caps obscuring the channel calculation.
resources.initEntity(victim);
context.CompanionOffense.damageCreature((target, amount, x, y, kb, opts) => resources.applyDamage(target, amount, opts), actor, victim, 10, 0, 0, 0, { afflictionBonuses: { bleedingHealth: 1 } });
assert.equal(resources.getAffliction(victim, 'bleedingHealth'), 7.5, 'Power reduces final buildup by precisely 25%, independently of its damage boost');
const removeStackedProvider = context.CompanionOffense.registerProvider('stacked-test', () => ({ damage: 1.3, affliction: 1.4 })); // Simulates existing Whistle/training bonuses alongside a tactical focus.
resources.removeAffliction(victim, 'bleedingHealth', 1000);
context.CompanionOffense.damageCreature((target, amount, x, y, kb, opts) => resources.applyDamage(target, amount, opts), actor, victim, 10, 0, 0, 0, { afflictionBonuses: { bleedingHealth: 1 } });
assert.equal(resources.getAffliction(victim, 'bleedingHealth'), 10.5, 'stacked providers scale buildup once, rather than also applying their Health multiplier');
removeStackedProvider();

const enemy = { ...actor, banditCompanion: true }; // Enemy pets must retain baseline species behavior and hit strength.
assert.equal(tactics.chooseAttack(enemy), null);
assert.equal(context.CompanionOffense.scaleHit(enemy, {}, 10).amount, 10);
assert.equal(tactics.combatTempo({ ...actor, master: {} }).stamina, 1);
const serialized = JSON.stringify(stable[0]); // Save/reload uses the existing Stable object rather than a parallel store.
stable[0] = JSON.parse(serialized);
assert.equal(tactics.tacticsForEntry(stable[0]).tempo, 'relentless');
assert.equal(tactics.chooseAttack(actor).id, 'pounce');
const kick = { ...actor, stableId: 'kick', creatureKey: 'voorg-ass', def: definitions['voorg-ass'] }; // Guard Charge covers the kick's hard cooldown.
tactics.setTactics('kick', { abilities: { guardCharge: { frequency: 0 }, rearKick: { frequency: 4, effect: 'drive' } } });
kickReady = false;
assert.equal(tactics.chooseAttack(kick).id, 'guardCharge', 'a cooling-down kick falls back to Guard Charge instead of idling');
kickReady = true;
assert.equal(tactics.chooseAttack(kick).id, 'rearKick');
let actualKnockback = 0; // Captures the payload that reaches the ordinary damage function.
context.CompanionOffense.damageCreature((target, amount, x, y, kb) => { actualKnockback = kb; }, kick, {}, 2, 0, 0, 100, {});
assert.equal(actualKnockback, 160);
tactics.setTactics('grehlr', { abilities: { guardCharge: { frequency: 0 }, grehlrBurrow: { frequency: 0 }, grehlrStink: { frequency: 4, effect: 'affliction' } } });
const grehlr = { ...actor, _companionTacticSchedule: null, stableId: 'grehlr', creatureKey: 'grehlr', def: definitions.grehlr }; // Spray can be deliberately chosen without allowing random substitution.
assert.equal(tactics.chooseAttack(grehlr).id, 'grehlrStink');
assert.equal(context.CompanionOffense.getModifiers(grehlr, {}).affliction, 1.5);
// Each move's allow-list must reject options that its real hit payload cannot apply.
for (const [id, kind, effect] of [['guardCharge', 'dabinggi-hound', 'affliction'], ['swarm', 'honeyfuzzle', 'stagger'], ['swarm', 'honeyfuzzle', 'drive'], ['causticPellet', 'drenkirra', 'stagger']]) {
  const entry = { role: 'companion', kind, companionTactics: { abilities: { [id]: { frequency: 1, effect } } } }; // Old loadouts normalize unsupported focus choices back to Balanced.
  const normalized = tactics.tacticsForEntry(entry, { def: { attacks: [id] } }); // Uses the same species-move normalization as the live AI.
  assert.equal(normalized.abilities[id].effect, 'balanced', id + ' rejects ineffective ' + effect + ' focus');
}
const swarmEntry = { id: 'swarm', role: 'companion', kind: 'honeyfuzzle', lifeStage: 'adult', animalPerks: {} }; // Drives every advertised Swarm effect through actual controller/touch button listeners.
stable.push(swarmEntry);
definitions.honeyfuzzle = { attacks: ['swarm'], realAttackEvery: 1 };
const swarmPanel = new Element('div'); // Same production builder used by the native Stable detail.
tactics.appendTacticalLoadout(swarmPanel, swarmEntry);
const swarmEffectButton = swarmPanel.children[0].children.find(element => element.textContent?.startsWith('Swarm effect:')); // Swarm has damage and poison, but no Footing or knockback channels.
for (const label of ['Power', 'Afflict', 'Balanced']) {
  swarmEffectButton.listeners.click({ stopPropagation() {} });
  assert(swarmEffectButton.textContent.includes(label));
  assert(!/Footing|knockback/.test(swarmEffectButton.textContent), 'Swarm copy never advertises inactive hit channels');
}
tactics.setTactics('hound', { tempo: 'bogus', abilities: { guardCharge: { frequency: -1 }, pounce: { frequency: 0, effect: 'bogus' } } });
assert.equal(tactics.tacticsForEntry(stable[0]).abilities.guardCharge.frequency, 1, 'all-off saves retain one safe move');
assert.equal(tactics.tacticsForEntry(stable[0]).tempo, 'steady');
const panel = new Element('div'); // Exercise actual button listeners and immediate save without rerendering the tree.
tactics.appendTacticalLoadout(panel, stable[0]);
const buttons = panel.children[0].children.filter(element => element.tagName === 'button'); // Controller navigation discovers the same ordinary buttons as touch.
const tempoButton = buttons.find(button => button.textContent.startsWith('Combat tempo:')); // First user change should survive both save and UI normalization.
const savedBeforeTap = saves;
tempoButton.listeners.click({ stopPropagation() {} });
assert.equal(saves, savedBeforeTap + 1);
assert.equal(stable[0].companionTactics.tempo, 'relentless');
assert.match(tempoButton.textContent, /Relentless/);
const lastMoveButton = buttons.find(button => button.textContent.startsWith('Guard Charge frequency:')); // Turning off the sole move cannot leave a companion permanently unable to fight.
tactics.setTactics('hound', { tempo: 'relentless', abilities: { guardCharge: { frequency: 0 }, pounce: { frequency: 4, effect: 'balanced' } } });
// Execute the real production action block, not a mirrored implementation.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Extracts the existing companion AI seam to execute its payment and dispatch rules.
const start = game.indexOf('              const st = c._stage ||', game.indexOf('function updateCompanions(dt)')); // One behavior decision with movement/telegraph dependencies supplied below.
const end = game.indexOf('\n            }\n          } else if (rescueActive)', start); // Rescue is now a separate post-combat branch; extract only the actual attack decision. // The complete active/backing-up state block.
assert(start >= 0 && end > start);
let dispatch = null; // Records the actual selected action reaching the modular creature attack dispatcher.
context.Combat.animalAttacks = { start(c, id) { dispatch = id; return true; } };
context.ResourceSystem = { spendStamina(c, amount) { c.stamina -= amount; } };
Object.assign(context, { c: actor, def: actor.def, dt: 0.1, target: { x: 0, y: 0 }, dist: 0, aimAngle: 0, moving: false,
  TILE: 32, STAGE_BACKUP_S: 2, rnd: () => 0, isCreatureSwimming: () => false, moveCreatureToward: () => false,
  companionTempo: tactics.combatTempo(actor), BITE_TELEGRAPH_WINDUP_S: 0.1, BITE_TELEGRAPH_STRIKE_S: 0.1 });
actor._stage = null; actor.stamina = 100; actor.attackCooldownT = 0;
vm.runInContext('{ ' + game.slice(start, end) + ' }', context);
assert.equal(dispatch, 'pounce');
assert.equal(actor.stamina, 87, 'relentless cost is paid through the real Stamina route');
assert.equal(actor.attackCooldownT, 1.5, 'relentless shortens the actual cooldown');
assert.equal(actor._stage.mode, 'backingUp');
context.dt = 1.31;
vm.runInContext('{ ' + game.slice(start, end) + ' }', context);
assert.equal(actor._stage.mode, 'active', 'tempo also shortens the otherwise dominant retreat phase');
assert(lastMoveButton, 'frequency controls are present in the real loadout builder');
console.log('Companion tactics and level-30 progression regressions passed.');

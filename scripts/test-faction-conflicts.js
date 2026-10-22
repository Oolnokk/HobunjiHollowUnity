const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Executes docs/js/faction-conflicts.js against the shipped
// docs/config/faction-conflicts.json and against purpose-built configs, to prove
// the rules really are data: a brand-new faction, its enemies, flee triggers and
// pursuit rules are all added without touching code.
const TILE = 55;
let nowMs = 1000;
const warnings = [];
const win = { __farmLog() {} };
win.window = win;
const sandbox = vm.createContext({
  window: win, Math, Set, Map, Object, Array, Number, String, Date,
  console: { warn: (...args) => warnings.push(args.join(' ')), log() {}, error: console.error },
  performance: { now: () => nowMs },
});
vm.runInContext(fs.readFileSync('docs/js/faction-conflicts.js', 'utf8'), sandbox, { filename: 'faction-conflicts.js' });
const FC = win.FactionConflicts;
const shipped = JSON.parse(fs.readFileSync('docs/config/faction-conflicts.json', 'utf8'));

const zoneDef = { packSpecies: ['gar-wolf'], herbivoreSpecies: ['hopper'], roamingHerdSpecies: ['grazer'] };
const homePoints = new Map();
let mapBounds = null; // {cols, rows} the actor must stay inside when fleeing "away".
FC.init({ now: () => nowMs, tileSize: () => TILE, zoneDef: () => zoneDef, homePointFor: entity => homePoints.get(entity) || null, areaBounds: () => mapBounds });

let nextId = 1;
const actor = (col, extra = {}) => ({ id: `e${nextId++}`, health: 20, maxHealth: 20, areaId: 'zone', def: {}, state: 'idle', x: col * TILE, y: 0, ...extra });
const hunter = (col, extra) => actor(col, { isBandit: true, isPorakanekiHunter: true, ...extra });
const bandit = (col, extra) => actor(col, { isBandit: true, ...extra });
const wolf = (col, extra) => actor(col, { creatureKey: 'gar-wolf', ...extra });
const hopper = (col, extra) => actor(col, { creatureKey: 'hopper', ...extra });

// Same contract the camps runtime uses: adapters record what the pass decided.
function pass(entities) {
  const assigned = new Map(), released = new Set();
  const summary = FC.runPass({
    active: entities, all: entities,
    assign: (entity, target, rel) => assigned.set(entity, { target, rel }),
    release: entity => released.add(entity),
  });
  return { assigned, released, summary };
}
const targetOf = (assigned, entity) => assigned.get(entity)?.target || null;

// ---- shipped config ---------------------------------------------------------
const shippedProblems = FC.configure(shipped, 'shipped');
assert.equal(shippedProblems.length, 0, `shipped config has no dangling faction ids or unknown flee condition types: ${shippedProblems.join('; ')}`);
assert.equal(JSON.stringify(FC.debugSnapshot().factions.map(f => f.id)), JSON.stringify(['porakaneki', 'bandit', 'predator', 'prey']));

// Classification
assert.equal(FC.factionOf(hunter(0)), 'porakaneki');
assert.equal(FC.factionOf(bandit(0)), 'bandit');
assert.equal(FC.factionOf(actor(0, { banditCompanion: true, creatureKey: 'dabinggi-hound' })), 'bandit');
assert.equal(FC.factionOf(wolf(0)), 'predator', 'zone packSpecies classify as predators');
assert.equal(FC.factionOf(hopper(0)), 'prey', 'zone herbivoreSpecies classify as prey');
assert.equal(FC.factionOf(actor(0, { creatureKey: 'mystery', def: { diet: 'Carnivore' } })), 'predator', 'diet fallback matches case-insensitively');
assert.equal(FC.factionOf(actor(0, { creatureKey: 'mystery', wildlifeRole: 'prey' })), 'prey', 'a wildlifeRole that names a faction is an explicit assignment');
assert.equal(FC.factionOf(actor(0, { creatureKey: 'gar-wolf', wildlifeRole: 'prey' })), 'prey', 'explicit assignment beats the zone species lists');
assert.equal(FC.factionOf(actor(0, { creatureKey: 'gar-wolf-alpha' })), 'predator', 'alpha/den-mother suffixes normalise to the base species');
assert.equal(FC.factionOf(actor(0, { creatureKey: 'mystery' })), null, 'unclassified wildlife takes no part');
assert.equal(FC.factionOf(bandit(0, { isCompanion: true })), null, 'the player\'s companions never join faction fights');
assert.equal(FC.factionOf(bandit(0, { health: 0 })), null);

// Priority tiers: bandit+predator tier (100) beats prey (10); nearest wins inside a tier.
{
  const h = hunter(0), b = bandit(3), w = wolf(5), p = hopper(1);
  let r = pass([h, b, w, p]);
  assert.equal(targetOf(r.assigned, h), b, 'the high-priority tier wins even though prey is nearer; nearest within the tier');
  assert.equal(targetOf(r.assigned, b), w, 'bandits pick the nearest of Porakaneki/predators');
  assert.equal(targetOf(r.assigned, w), b, 'predators pick the nearest of Porakaneki/bandits');
  assert.equal(r.assigned.has(p), false, 'prey has no attacks');
  assert.equal(r.summary.targets, 3);
  r = pass([h, w, p]);
  assert.equal(targetOf(r.assigned, h), w);
  r = pass([h, p]);
  assert.equal(targetOf(r.assigned, h), p, 'with no higher tier present the hunter takes prey');
}

// pursueFleeing: Porakaneki chase fleeing prey and bandits, but let a fleeing predator go.
{
  const h = hunter(0), p = hopper(2, { state: 'fleeing-low-health' });
  assert.equal(targetOf(pass([h, p]).assigned, h), p, 'porakaneki -> prey has pursueFleeing');
  const w = wolf(2, { state: 'fleeing-low-health' }), p2 = hopper(6);
  assert.equal(targetOf(pass([h, w, p2]).assigned, h), p2, 'porakaneki -> predator has no pursueFleeing, so the fleeing wolf is skipped for the next tier');
  const b = bandit(2);
  b._factionFlee = { until: nowMs + 5000 };
  b.state = 'fleeing-low-health';
  assert.equal(targetOf(pass([h, b]).assigned, h), b, 'porakaneki -> bandit has pursueFleeing');
}

// ---- flee: shipped conditions -----------------------------------------------
{
  nowMs = 10000;
  const h = hunter(0, { health: 4 }); // 20% <= 25%
  const b = bandit(6);
  homePoints.set(h, { x: -500, y: 0 });
  let r = pass([h, b]);
  assert.equal(h.state, 'fleeing-low-health', 'wounded hunter with an enemy in range flees');
  assert.equal(h._fleeToX, -500, 'destination "home" uses the runtime\'s home point (the camp)');
  assert.equal(r.assigned.has(h), false);
  assert.equal(r.summary.fleesBegun, 1);
  assert.equal(h._chunkCombatTarget, null);
  assert.equal(FC.isFleeing(h), true);
  assert.equal(targetOf(r.assigned, b), h, 'the bandit pursues the fleeing hunter (bandit -> porakaneki pursueFleeing)');

  nowMs += 400;
  r = pass([h, b]);
  assert.equal(r.assigned.has(h), false, 'a fleeing actor is never retargeted mid-flee');
  assert.equal(h.state, 'fleeing-low-health');

  FC.noteFleeSettled(h); // game.js calls this on arrival
  h.state = 'idle';
  assert.equal(h._factionFlee, undefined);
  assert.equal(h._fleeToX, undefined);
  h.health = 20;
  r = pass([h, b]);
  assert.equal(r.assigned.has(h), false, 'cooldown after a flee: no immediate re-engagement');
  nowMs += 10500;
  r = pass([h, b]);
  assert.equal(targetOf(r.assigned, h), b, 'after the cooldown it fights again');

  // Healthy enough / enemy too far / nobody around: no flee.
  const h2 = hunter(0, { health: 4 }), far = bandit(12);
  pass([h2, far]);
  assert.notEqual(h2.state, 'fleeing-low-health', 'enemy outside radiusTiles (8): not a flee trigger');
  const lone = hunter(0, { health: 2 });
  pass([lone]);
  assert.notEqual(lone.state, 'fleeing-low-health', 'low health alone, with no enemy near, does not flee');
  const wolfLow = wolf(0, { health: 2 }), pRelative = hopper(1);
  pass([wolfLow, pRelative]);
  assert.notEqual(wolfLow.state, 'fleeing-low-health', '`against` limits the trigger to the listed factions (prey is not one)');

  // destination "away": runs directly away from the threat.
  const hurtBandit = bandit(10, { health: 3 }), foe = hunter(7);
  pass([hurtBandit, foe]);
  assert.equal(hurtBandit.state, 'fleeing-low-health');
  assert(hurtBandit._fleeToX > hurtBandit.x + TILE * 10, 'flees away from the threat (east, since the threat is west)');

  // The away point stays on the map.
  mapBounds = { cols: 20, rows: 20 };
  const cornered = bandit(18, { health: 3 });
  pass([cornered, hunter(14)]);
  assert.equal(cornered.state, 'fleeing-low-health');
  assert(cornered._fleeToX <= TILE * 18.5 && cornered._fleeToX > cornered.x, 'away point clamped to the map edge instead of 14 tiles past it');
  mapBounds = null;

  // Flee ends by time or when something else changes the state.
  const timed = bandit(10, { health: 3 });
  pass([timed, hunter(7)]);
  assert.equal(timed.state, 'fleeing-low-health');
  nowMs += 21000;
  pass([timed]);
  assert.equal(timed.state, 'idle', 'flee expires after maxSeconds even if the destination was never reached');
  assert.equal(timed._factionFlee, undefined);
  const interrupted = bandit(10, { health: 3 });
  pass([interrupted, hunter(7)]);
  interrupted.state = 'chase';
  pass([interrupted]);
  assert.equal(interrupted._factionFlee, undefined, 'an externally changed state ends the flee record');
}

// outnumbered
{
  nowMs += 60000;
  const h = hunter(0), enemies = [bandit(2), bandit(3), bandit(4)];
  pass([h, ...enemies]);
  assert.equal(h.state, 'fleeing-low-health', '3 bandits vs 1 hunter meets ratio 3');
  nowMs += 60000;
  const h2 = hunter(0), mates = [hunter(1), hunter(2)];
  pass([h2, ...mates, ...[bandit(3), bandit(4), bandit(5)]]);
  assert.notEqual(h2.state, 'fleeing-low-health', 'with two allies in range the ratio is 1, so no flee');
}

// fleeOnHit / queries
assert.equal(FC.fleesWhenHit(hunter(0)), false, 'neutral Porakaneki do not take the implicit passive flee-on-hit');
assert.equal(FC.fleesWhenHit(hopper(0)), true);
assert.equal(FC.fleesWhenHit(actor(0, { creatureKey: 'mystery' })), true, 'unclassified creatures keep the legacy flee-on-hit');
assert.equal(FC.forgivesCrossfire(hunter(0), bandit(1)), true);
assert.equal(FC.forgivesCrossfire(hunter(0), wolf(1)), true);
assert.equal(FC.forgivesCrossfire(hunter(0), hopper(1)), false, 'hunting prey is not crossfire');
assert.equal(FC.forgivesCrossfire(bandit(0), hunter(1)), false);
assert.equal(FC.lethalOverride(wolf(0), hunter(1)), null, 'no override in shipped config: legacy rule stays');
{
  const w = wolf(0), h = hunter(1), p = hopper(2);
  assert.equal(FC.pursuesFleeing(w, h), false, 'only targets this system assigned count');
  const h2 = hunter(0), p2 = hopper(1);
  h2._chunkFactionEcologyTarget = p2;
  assert.equal(FC.pursuesFleeing(h2, p2), true);
  w._chunkFactionEcologyTarget = h;
  assert.equal(FC.pursuesFleeing(w, h), false, 'predator -> porakaneki has no pursueFleeing');
  assert.equal(FC.hasActiveTarget(h2), true);
  assert.equal(FC.hasActiveTarget(p), false);
  p2.health = 0;
  assert.equal(FC.hasActiveTarget(h2), false, 'a dead target no longer owns the actor');
}

// ---- a brand-new faction, purely from config ---------------------------------
{
  FC.registerConditionType('lowMoon', (entity, cond) => entity.moon === true);
  const problems = FC.configure({
    defaults: { flee: { maxSeconds: 5, cooldownSeconds: 2, awayTiles: 6 } },
    factions: [
      { id: 'ravager', match: [{ flag: 'isRavager' }],
        attacks: [
          { faction: 'warden', priority: 80, pursueFleeing: true, lethal: false },
          { faction: 'merchant', priority: 20 },
        ],
        flee: { destination: 'away', conditions: [{ type: 'enemyNearby', factions: ['giant'], radiusTiles: 4 }, { type: 'lowMoon' }] } },
      { id: 'warden', match: [{ field: 'role', equals: 'warden' }], attacks: [{ faction: 'ravager', maxRangeTiles: 6 }] },
      { id: 'merchant', match: [{ creatureKey: ['pack-mule'] }], attacks: [], flee: { conditions: [{ type: 'enemyNearby', radiusTiles: 5 }] } },
      { id: 'giant', match: [{ speciesId: ['giant'] }] },
    ],
  }, 'custom');
  assert.equal(problems.length, 0, problems.join('; '));
  const ravager = (col, extra) => actor(col, { isRavager: true, ...extra });
  const warden = (col, extra) => actor(col, { role: 'warden', ...extra });
  const mule = (col, extra) => actor(col, { creatureKey: 'pack-mule', ...extra });
  const giant = (col, extra) => actor(col, { rosterRecord: { appearance: { speciesId: 'giant' } }, ...extra });

  assert.equal(FC.factionOf(ravager(0)), 'ravager');
  assert.equal(FC.factionOf(warden(0)), 'warden');
  assert.equal(FC.factionOf(mule(0)), 'merchant');
  assert.equal(FC.factionOf(giant(0)), 'giant');
  assert.equal(FC.factionOf(actor(0, { factionId: 'warden' })), 'warden', 'entity.factionId is the explicit per-spawn override');
  assert.equal(FC.factionOf(hunter(0)), null, 'factions that are not in the config do not exist');

  const r1 = ravager(0), w1 = warden(5), m1 = mule(1);
  let r = pass([r1, w1, m1]);
  assert.equal(targetOf(r.assigned, r1), w1, 'priority 80 warden beats the nearer priority 20 merchant');
  assert.equal(targetOf(r.assigned, w1), r1);
  assert.equal(FC.lethalOverride(r1, w1), false, 'relation-level lethal flag is exposed');
  assert.equal(FC.lethalOverride(w1, r1), null);

  const farRavager = ravager(0), farWarden = warden(8);
  r = pass([farRavager, farWarden]);
  assert.equal(r.assigned.has(farWarden), false, 'maxRangeTiles 6: a warden does not notice a ravager 8 tiles away');
  assert.equal(targetOf(r.assigned, farRavager), farWarden, 'ravager has no range limit');

  // pursue: ravager chases a fleeing warden; warden lets a fleeing ravager go
  const rv = ravager(0), wd = warden(3, { state: 'fleeing-low-health' });
  assert.equal(targetOf(pass([rv, wd]).assigned, rv), wd);
  const rv2 = ravager(2, { state: 'fleeing-low-health' }), wd2 = warden(3);
  assert.equal(targetOf(pass([rv2, wd2]).assigned, wd2), null, 'warden -> ravager has no pursueFleeing');

  // flee triggers: enemyNearby (giant), custom condition, and merchants running from whoever attacks them
  nowMs += 100000;
  const rg = ravager(0), gi = giant(3);
  pass([rg, gi]);
  assert.equal(rg.state, 'fleeing-low-health', 'enemyNearby a giant within 4 tiles');
  assert(rg._fleeToX < rg.x, 'ran away from the giant (which stands to the east)');
  nowMs += 100000;
  const moonRavager = ravager(0, { moon: true });
  pass([moonRavager]);
  assert.equal(moonRavager.state, 'fleeing-low-health', 'custom registered condition type, no enemy required');
  nowMs += 100000;
  const mu = mule(0), rav = ravager(3);
  pass([mu, rav]);
  assert.equal(mu.state, 'fleeing-low-health', 'a faction with no `against` flees from every faction that attacks it');
  nowMs += 100000;
  const calmMule = mule(0), stranger = giant(2);
  pass([calmMule, stranger]);
  assert.notEqual(calmMule.state, 'fleeing-low-health', 'giants are not threats to merchants unless a relation says so');

  // bad configs are reported, not fatal
  const bad = FC.configure({ factions: [
    { id: 'a', attacks: [{ faction: 'ghost' }], flee: { conditions: [{ type: 'nope' }] } },
    { id: 'a' },
    {},
  ] }, 'bad');
  assert.equal(bad.length, 4, bad.join('; '));
  assert(bad.some(p => /ghost/.test(p)) && bad.some(p => /nope/.test(p)) && bad.some(p => /duplicate/.test(p)) && bad.some(p => /no string "id"/.test(p)));
  assert(warnings.length >= 4, 'problems surface as console warnings');
}

// Loader order: the module must exist before the camps runtime that drives it.
{
  const loader = fs.readFileSync('docs/js/house-pieces.js', 'utf8');
  const fc = loader.search(/faction-conflicts\.js\?v=[A-Za-z0-9_.-]+/), camps = loader.search(/porakaneki-camps-runtime\.js\?v=[A-Za-z0-9_.-]+/);
  assert(fc > 0 && camps > fc, 'faction-conflicts.js loads before porakaneki-camps-runtime.js');
}

console.log('Faction conflict rules regression checks passed.');

#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Verifies knockback deficit math, collision profiles, Burning Health, and integration wiring.
const fs = require('node:fs'); // Reads the exact browser/runtime sources and authored furniture data.
const vm = require('node:vm'); // Executes the two small combat modules in an isolated browser-like fixture.

const impactSource = fs.readFileSync('docs/js/combat/knockback-collision-impact.js', 'utf8'); // Pure collision-strength/profile resolver under test.
const resourceSource = fs.readFileSync('docs/js/combat/resource-system.js', 'utf8'); // Real affliction implementation, including Burning Health.
const footingBridgeSource = fs.readFileSync('docs/js/footing-damage-recovery-bridge.js', 'utf8'); // Runtime Footing multiplier used by both direct hits and collision impacts.
const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Runtime forced-movement/collision authority.
const indexSource = fs.readFileSync('docs/index.html', 'utf8'); // Confirms the Burning Health presentation module is shipped before game.js.
const burningVfxSource = fs.readFileSync('docs/js/combat/burning-affliction-vfx.js', 'utf8'); // Authored furniture fire-emitter presentation for Burning Health.
const editorSource = fs.readFileSync('docs/tools/furniture-avatar-author/index.html', 'utf8'); // Furniture hazard authoring persistence.
const playerVitalsSource = fs.readFileSync('docs/js/player-vitals.js', 'utf8'); // Player water-extinguish hook.
const enemyDodgeSource = fs.readFileSync('docs/js/combat/combat-enemy-dodge.js', 'utf8'); // Non-player roll-dodge burn cooling.
const scratchConfigSource = fs.readFileSync('docs/config/scratchbones-config.js', 'utf8'); // Production tuning is checked structurally below.
const candleTable = JSON.parse(fs.readFileSync('docs/config/furniture-authored/candleTable.json', 'utf8')); // Existing flame furniture must persist its hazard flag.
const campfire = JSON.parse(fs.readFileSync('docs/config/furniture-authored/campfire.json', 'utf8')); // Existing authored fire emitter furniture must persist its hazard flag.
const hearth = JSON.parse(fs.readFileSync('docs/config/furniture-authored/hearth.json', 'utf8')); // Existing built-in flame fixture must persist its hazard flag.

// Integration guards: keep the feature attached to the real movement/death/editor paths.
assert.match(gameSource, /KnockbackCollisionImpact\?\.begin\?\.\(target, speedPxS, KNOCKBACK_DUR_S\)/,
  'ordinary knockback records its authored intended travel once when the shove starts');
assert.match(gameSource, /function sweptMove\([^)]*stopOnBlock = false\)[\s\S]{0,1800}blockedAt/,
  'shared swept collision can stop forced movement at the first rejected position and expose that impact point');
assert.match(gameSource, /function sweepKnockbackMotion[\s\S]{0,1800}tryStartKnockbackLedgeTransit/,
  'forced knockback owns a shared ledge-aware sweep before ordinary collision resolution');
assert.match(gameSource, /function knockbackAirborneCanOccupyAt[\s\S]{0,1800}obstacleSurfaceY >= originSurfaceY/,
  'airborne ledge knockback ignores lower terrain but still collides with same/higher obstructions');
assert.match(gameSource, /function findClosestKnockbackLedgeLanding[\s\S]{0,2200}canOccupyAt\(x, y, radiusPx\)/,
  'ledge falls require a strict safe lower landing tile on the far side of the cliff');
assert.match(gameSource, /knockbackDescriptorOverride = \{ kind: 'fallback', label: 'Unsafe cliff edge' \}/,
  'a cliff with no safe far-side landing uses the ordinary fallback collision profile');
assert.match(gameSource, /resolveKnockbackCollision\(c, ckSwept,[\s\S]{0,420}beginKnockbackLedgeFall\(c\)/,
  'creature knockback resolves a later same-height collision then falls when it had already crossed a ledge');
assert.match(gameSource, /resolveKnockbackCollision\(player, kbSwept,[\s\S]{0,420}beginKnockbackLedgeFall\(player\)/,
  'player knockback shares the same ledge-to-fall handoff');
assert.match(gameSource, /resolveStrength\([\s\S]{0,400}mode: 'ledge-fall'/,
  'cliff landing impact strength is explicit vertical-drop strength rather than horizontal deficit');
assert.match(gameSource, /advanceCreatureProneThrow[\s\S]{0,1800}resolveKnockbackCollision/,
  'Footing-break prone throws use the same wall-impact system');
assert.match(gameSource, /environmentalImpact = dmgOpts\?\.environmentalImpact === true/,
  'secondary collision Health damage has an explicit environmental-impact path through existing death authority');
assert.match(gameSource, /function transitionCreatureToDeath[\s\S]{0,2200}_deathTransitionStarted[\s\S]{0,2200}CreatureDeath\.begin/,
  'direct hits and lethal resource DoTs share one duplicate-guarded creature-to-corpse handoff');
assert.match(gameSource, /return \{ applied: appliedImpactHealth, lethal: true \}/,
  'lethal player collision damage reports death before respawn restoration can hide it');
assert.match(gameSource, /transitionCreatureToDeath\(c, fromX, fromY\)[\s\S]{0,220}lethal:/,
  'lethal creature collision damage reports the shared corpse transition back to the resolver');
assert.doesNotMatch(gameSource, /emitter\?\.type === 'fire' && emitter\.enabled !== false/,
  'visual fire particle emitters must not silently classify furniture as gameplay Fire Hazards');
assert.match(gameSource, /candleTable:\s*\{\s*fireHazard:\s*true/,
  'Candle Table is explicitly marked as a Fire Hazard in the runtime furniture definition');
assert.match(gameSource, /campfireFurniture:\s*\{\s*fireHazard:\s*true[\s\S]{0,700}bonfireFurniture:\s*\{\s*fireHazard:\s*true/,
  'Campfire and Bonfire fixtures are explicitly marked as Fire Hazards');
assert.doesNotMatch(gameSource, /hearth:\s*\{\s*fireHazard:\s*true/,
  'Hearth is not a Fire Hazard merely because it has flame visuals');
assert.match(gameSource, /tile\?\.incline[\s\S]{0,180}kind: 'stone'/,
  'cliff-side collision is assigned the stone profile');
assert.match(gameSource, /tile\?\.type === TileType\.SHRUB[\s\S]{0,500}kind: 'wood'/,
  'tree\/stump\/log\/bush collision is assigned the wood profile');
assert.match(gameSource, /_banditTentCollisionId[\s\S]{0,100}kind: 'wood'/,
  'tent collision is assigned the wood profile');
assert.match(gameSource, /performDodge[\s\S]{0,2400}coolBurningOnDodge/,
  'player roll dodge cools Burning Health exactly once when the dodge starts');

assert.match(gameSource, /BurningAfflictionVfx\?\.syncEntity\?\.\(player, playerMesh\)/,
  'player visual update keeps Burning Health VFX attached to the live avatar root');
assert.match(gameSource, /BurningAfflictionVfx\?\.syncEntity\?\.\(c, grp\)/,
  'creature visual update keeps Burning Health VFX attached to enemy/companion avatar roots');
assert.match(burningVfxSource, /AuthoredFurniture\.createEmitterVisual|AuthoredFurniture\?\.createEmitterVisual/,
  'Burning Health reuses the authored-furniture emitter renderer instead of creating a second particle implementation');
assert.match(burningVfxSource, /load\('campfire'\)[\s\S]{0,900}type[^\n]*fire|type[^\n]*fire[\s\S]{0,900}load\('campfire'\)/,
  'Burning Health sources a real fire emitter from the authored campfire furniture data');
assert.match(burningVfxSource, /ResourceSystem\?\.getAffliction\?\.\(entity, 'burningHealth'\)/,
  'Burning Health VFX is presentation-only and follows the existing affliction amount');
assert(indexSource.indexOf('js/combat/burning-affliction-vfx.js') > indexSource.indexOf('js/combat/resource-system.js')
  && indexSource.indexOf('js/combat/burning-affliction-vfx.js') < indexSource.indexOf('game.js?v='),
  'Burning Health VFX loads after its resource dependency and before game.js calls it');

assert.match(resourceSource, /burningHealth:\s*\{[\s\S]{0,300}resource:\s*"health"[\s\S]{0,300}tags:\s*\["fire", "physical"\]/,
  'Burning Health is a first-class Health affliction tagged as fire damage');
assert.match(resourceSource, /function resolveBurningTick[\s\S]{0,450}removeAffliction\(entity, "burningHealth", amount\)[\s\S]{0,220}entity\.health =/,
  'Burning consumes its own buildup as Health DoT');
assert.match(playerVitalsSource, /isPlayerInWater\?\.\(\)[\s\S]{0,120}extinguishInWater/,
  'player vitals clears Burning immediately when the player enters water');
assert.match(gameSource, /function isWaterSurfaceAt[\s\S]{0,650}WATERWAY_TYPES\.has\(tile\.type\)[\s\S]{0,220}Number\(tile\.water\)[\s\S]{0,120}>= 0\.003/,
  'Burning water detection follows permanent waterways plus WaterSystem-visible dynamic water');
assert.match(gameSource, /function isSwimmingAt[\s\S]{0,450}type === TileType\.RIVER \|\| type === TileType\.STREAM/,
  'expanded extinguishing does not broaden the separate swimming movement rule');
assert.match(gameSource, /function tickCreatureResources[\s\S]{0,500}isWaterSurfaceAt[\s\S]{0,1800}transitionCreatureToDeath/,
  'creatures extinguish on water and lethal resource ticks hand off to shared death authority');
assert.match(gameSource, /if \(!tickCreatureResources\(c, entityDt, visuallyLodSleeping\)\) continue;/,
  'hostile AI stops immediately after a lethal resource-tick transition');
assert.match(gameSource, /if \(!tickCreatureResources\(c, dt\)\) continue;/,
  'companion AI stops immediately after a lethal resource-tick transition');
assert.match(enemyDodgeSource, /spendStamina[\s\S]{0,180}coolBurningOnDodge/,
  'enemy roll dodges use the same Burning recovery helper');

assert.match(editorSource, /id="bladedHazard" type="checkbox"/,
  'furniture author exposes the requested Bladed Hazard checkbox');
assert.match(editorSource, /id="fireHazard" type="checkbox"/,
  'furniture author exposes the requested Fire Hazard checkbox');
assert.match(editorSource, /bladedHazard:!!state\.bladedHazard,fireHazard:!!state\.fireHazard/,
  'hazard flags persist in exported authored-furniture JSON');
assert.match(editorSource, /state\.fireHazard=!!data\.fireHazard/,
  'furniture author imports the explicit Fire Hazard flag');
assert.doesNotMatch(editorSource, /state\.fireHazard=!!\(data\.fireHazard\|\|/,
  'furniture author no longer promotes visual fire emitters into gameplay hazards');
assert.equal(candleTable.fireHazard, true, 'Candle Table is explicitly authored as a Fire Hazard');
assert.equal(campfire.fireHazard, true, 'Campfire is explicitly authored as a Fire Hazard');
assert.notEqual(hearth.fireHazard, true, 'Hearth authored data remains non-hazardous unless explicitly changed');
assert.match(scratchConfigSource, /"knockbackCollision"\s*:\s*\{[\s\S]{0,1000}"burningDodgeRecovery"\s*:\s*12/,
  'collision effect strengths and dodge recovery remain centrally tunable');

// Focused browser fixture uses the production ResourceSystem rather than a fake affliction implementation.
let nowMs = 1000; // Used by ResourceSystem's rest/quiet-time calculations.
class TestCustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } } // Minimal browser CustomEvent used by ResourceSystem.tick.
const windowStub = {
  SCRATCHBONES_CONFIG: {
    game: {
      combat: {
        resourceSystem: {
          quietSeconds: 3,
          staminaRegenPerSec: 14,
          healthRegenPerSec: 1.2,
          afflictionRecoveryPerSec: 3.6,
          bleedTickPerSec: 5,
          burnTickPerSec: 18,
          poisonTickPerSec: 1.8,
          exhaustionRegenPerSec: 24,
          footingMax: 100,
          footingRegenPerSec: 6,
          pukeChancePerSec: 0,
        },
        knockbackCollision: {
          fallback: { footing: 6 },
          stone: { health: 4, footing: 10, shatteredStamina: 5, bruisedHealth: 4 },
          wood: { footing: 7, bleedingHealth: 4, woundedStamina: 4 },
          bladed: { health: 10, bleedingHealth: 11, woundedStamina: 7 },
          fire: { burningHealth: 9 },
          burningDodgeRecovery: 12,
        },
      },
    },
  },
  dispatchEvent() {},
};
const context = {
  console,
  Math,
  Date,
  Number,
  Object,
  Set,
  Map,
  performance: { now: () => nowMs },
  CustomEvent: TestCustomEvent,
  window: windowStub,
};
vm.runInNewContext(resourceSource, context, { filename: 'resource-system.js' });
vm.runInNewContext(footingBridgeSource, context, { filename: 'footing-damage-recovery-bridge.js' });
vm.runInNewContext(impactSource, context, { filename: 'knockback-collision-impact.js' });
const ResourceSystem = windowStub.ResourceSystem; // Real production API used by the numeric fixtures.
const Impact = windowStub.KnockbackCollisionImpact; // Real production collision resolver used by the numeric fixtures.
const FootingBridge = windowStub.HobunjiFootingDamageRecovery; // Confirms collision tests include the same global Footing multiplier as gameplay.
assert(ResourceSystem && Impact && FootingBridge, 'combat modules register their browser APIs');
assert.equal(FootingBridge.damageMultiplier, 2, 'collision numeric fixtures must include the live x2 Footing bridge');

function entity(overrides = {}) {
  const e = {
    x: 0, y: 0,
    health: 1000, maxHealth: 1000,
    stamina: 1000, maxStamina: 1000,
    footing: 100, maxFooting: 100,
    lastAttackAttemptAt: nowMs,
    lastAttackReceivedAt: nowMs,
    ...overrides,
  }; // Shared fixture entity with enough resource capacity to expose >100% collision scaling.
  ResourceSystem.initEntity(e);
  return e;
}
function approx(actual, expected, message, epsilon = 1e-9) {
  assert(Math.abs(actual - expected) <= epsilon, `${message}: expected ${expected}, got ${actual}`);
}

const TILE = 100; // Simple tile size makes the user's percentage examples directly legible.
const KNOCKBACK_DUR_S = 0.18; // Production fixed knockback duration.

// User example 1: 1.2 tiles intended, exactly 1.0 tile traveled => 0.2 tile deficit = 20% profile strength.
{
  const e = entity();
  Impact.begin(e, (1.2 * TILE) / KNOCKBACK_DUR_S, KNOCKBACK_DUR_S);
  e.x = TILE;
  const result = Impact.resolve(e, { kind: 'fallback', label: 'unspecified collision' }, TILE);
  approx(result.deficitTiles, 0.2, '1.2→1.0 shove has a 0.2-tile deficit');
  approx(result.strengthPercent, 20, '0.2-tile deficit is 20% collision strength');
  approx(result.effects.footing, 1.2, 'halved fallback profile scales to 20% before the shared Footing bridge');
  approx(e.footing, 97.6, 'shared x2 Footing bridge restores 2.4 actual Footing loss at 20% strength');
}

// User example 2: 7.6 tiles intended, immediately blocked => 7.6 deficit = 760% profile strength.
{
  const e = entity();
  let healthDamage = 0; // Captures the environmental Health-damage handoff used by game.js.
  Impact.begin(e, (7.6 * TILE) / KNOCKBACK_DUR_S, KNOCKBACK_DUR_S);
  const result = Impact.resolve(e, { kind: 'stone', label: 'Rock' }, TILE, {
    dealHealthDamage(_target, amount) { healthDamage += amount; return { applied: amount, lethal: false }; },
  });
  approx(result.deficitTiles, 7.6, 'immediately blocked 7.6-tile shove keeps the full deficit');
  approx(result.strengthPercent, 760, '7.6-tile deficit is 760% collision strength');
  approx(result.effects.health, 30.4, 'halved stone Health damage scales to 760%');
  approx(result.effects.footing, 76, 'halved stone Footing profile scales to 760% before the shared Footing bridge');
  approx(result.effects.shatteredStamina, 38, 'halved Shattered Stamina scales to 760%');
  approx(result.effects.bruisedHealth, 30.4, 'halved Bruised Health scales to 760%');
  approx(healthDamage, 30.4, 'scaled stone Health damage is handed to the existing damage/death path');
  assert.equal(e.footing, 0, 'oversized collision Footing damage clamps through ResourceSystem');
  approx(ResourceSystem.getAffliction(e, 'shatteredStamina'), 38, 'stone collision applies scaled Shattered Stamina');
  approx(ResourceSystem.getAffliction(e, 'bruisedHealth'), 30.4, 'stone collision applies scaled Bruised Health');
}

// Ledge landing damage uses vertical drop tiers directly and does not require a horizontal collision deficit.
{
  const e = entity();
  let healthDamage = 0; // Captures explicit cliff-fall Health damage through the same environmental impact hook.
  const result = Impact.resolveStrength(e, { kind: 'stone', label: 'Cliff fall' }, 2, TILE, {
    dealHealthDamage(_target, amount) { healthDamage += amount; return { applied: amount, lethal: false }; },
  }, { mode: 'ledge-fall', dropWorld: 5, dropTiers: 2 });
  approx(result.deficitTiles, 2, 'two elevation tiers produce 200% cliff-impact strength');
  approx(result.strengthPercent, 200, 'explicit fall strength uses the same profile percentage scale');
  approx(result.effects.health, 8, 'two-tier cliff fall scales stone Health damage to 200%');
  approx(result.effects.footing, 20, 'two-tier cliff fall scales stone Footing payload to 200% before the shared bridge');
  approx(healthDamage, 8, 'cliff fall Health damage reaches the existing environmental-damage authority');
  approx(e.footing, 60, 'shared x2 Footing bridge applies 40 actual Footing loss for a two-tier fall');
  assert.equal(result.mode, 'ledge-fall', 'debug output distinguishes fall impact from horizontal collision');
  approx(result.dropWorld, 5, 'debug output retains actual world-Y drop');
  approx(result.dropTiers, 2, 'debug output retains elevation-tier drop');
}

// Material and authored-hazard profiles remain distinct.
{
  const wood = Impact.effectsFor({ kind: 'wood' }, 1.5);
  assert.deepEqual(JSON.parse(JSON.stringify(wood)), { footing: 10.5, bleedingHealth: 6, woundedStamina: 6 },
    'wood/furniture profile scales the halved Footing + Bleeding + Wounded payload');

  const blade = Impact.effectsFor({ kind: 'wood', bladedHazard: true }, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(blade)), { health: 20, bleedingHealth: 22, woundedStamina: 14 },
    'Bladed Hazard replaces ordinary furniture effects with the halved blade profile');

  const fire = Impact.effectsFor({ kind: 'wood', fireHazard: true }, 1.5);
  assert.deepEqual(JSON.parse(JSON.stringify(fire)), { burningHealth: 13.5 },
    'Fire Hazard replaces ordinary furniture effects with the halved Burning Health profile');

  const both = Impact.effectsFor({ kind: 'wood', bladedHazard: true, fireHazard: true }, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(both)), { health: 10, bleedingHealth: 11, woundedStamina: 7, burningHealth: 9 },
    'an intentionally dual-tagged hazard applies both halved special profiles without also adding generic furniture Footing');
}

// Lethal Health impact stops the remaining collision profile. This models the
// player path where dealHealthDamage synchronously respawns before resolve()
// returns: the fresh body must not then receive Footing loss or afflictions.
{
  const e = entity({ health: 3, maxHealth: 100, footing: 100, maxFooting: 100 });
  Impact.begin(e, TILE / KNOCKBACK_DUR_S, KNOCKBACK_DUR_S);
  const result = Impact.resolve(e, { kind: 'stone', label: 'lethal wall' }, TILE, {
    dealHealthDamage(target, amount) {
      const applied = Math.min(target.health, amount);
      target.health = 100; // Simulates the synchronous respawn/reset performed by game.js.
      return { applied, lethal: true };
    },
  });
  assert.equal(result.lethal, true, 'resolver records a lethal collision');
  assert.equal(result.appliedEffects.health, 3, 'debug output reports only Health actually lost before respawn');
  assert.equal(e.footing, 100, 'lethal collision does not damage the respawned player\'s Footing');
  assert.equal(ResourceSystem.getAffliction(e, 'shatteredStamina'), 0, 'lethal collision does not apply Shattered Stamina after respawn');
  assert.equal(ResourceSystem.getAffliction(e, 'bruisedHealth'), 0, 'lethal collision does not apply Bruised Health after respawn');
}

// Burning is a rapid self-consuming DoT, roll dodge removes a fixed amount, and water removes all remaining buildup.
{
  const e = entity({ health: 100, maxHealth: 100 });
  ResourceSystem.addAffliction(e, 'burningHealth', 36);
  ResourceSystem.tick(e, 1, { healthRegenPerSec: 0, staminaRegenPerSec: 0, footingRegenPerSec: 0 });
  assert.equal(e.health, 82, 'Burning deals 18 Health in one second at production tuning');
  assert.equal(ResourceSystem.getAffliction(e, 'burningHealth'), 18, 'the same 18 points are consumed from Burning buildup');

  ResourceSystem.addAffliction(e, 'burningHealth', 18); // Restore to 36 so dodge/water behavior is easy to inspect.
  assert.equal(Impact.coolBurningOnDodge(e), 12, 'one roll dodge removes the configured 12 Burning');
  assert.equal(ResourceSystem.getAffliction(e, 'burningHealth'), 24, 'roll dodge leaves the rest of Burning intact');
  assert.equal(Impact.extinguishInWater(e), 24, 'entering water removes every remaining Burning point');
  assert.equal(ResourceSystem.getAffliction(e, 'burningHealth'), 0, 'water fully extinguishes Burning');
}

console.log('Knockback collision + ledge fall + Burning Health regression passed');

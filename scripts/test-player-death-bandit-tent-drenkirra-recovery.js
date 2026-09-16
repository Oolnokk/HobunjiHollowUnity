#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const read = path => fs.readFileSync(path, 'utf8');
const vitalsSource = read('docs/js/player-vitals.js');
const game = read('docs/game.js');
const bandits = read('docs/js/bandit-camps.js');
const pellet = read('docs/js/combat/combat-drenkirra-pellet.js');

const hud = {
  healthFill: { style: {} },
  staminaFill: { style: {} },
  hungerFill: { style: {} },
  thirstFill: { style: {} },
};
const player = { health: 5, maxHealth: 100, stamina: 50, maxStamina: 100, dodgeCooldownT: 0 };
let deathCalls = 0;
const context = {
  window: {
    CookingSystem: { getStaminaRegenMultiplier: () => 1 },
    ResourceSystem: {
      tick: () => {
        player.health = 0;
        return {};
      },
    },
  },
  document: { getElementById: id => hud[id] || null },
};
vm.createContext(context);
vm.runInContext(vitalsSource, context);
context.window.PlayerVitals.init({
  player,
  PLAYER_STAMINA_REGEN: 1,
  PLAYER_HEALTH_REGEN: 0,
  showToast: () => {},
  handlePlayerDeath: () => { deathCalls++; },
});

context.window.PlayerVitals.updatePlayerVitals(1 / 60);
assert.strictEqual(deathCalls, 1, 'a lethal resource tick invokes the shared death handler');
assert.strictEqual(context.window.PlayerVitals.getDebug().deathHandled, true, 'death handling latches while health remains zero');
context.window.PlayerVitals.updatePlayerVitals(1 / 60);
assert.strictEqual(deathCalls, 1, 'zero health cannot request death every frame');
player.health = 100;
context.window.ResourceSystem.tick = () => ({});
context.window.PlayerVitals.updatePlayerVitals(1 / 60);
assert.strictEqual(context.window.PlayerVitals.getDebug().deathHandled, false, 'respawned health resets the death latch');
context.window.ResourceSystem.tick = () => { player.health = 0; return {}; };
context.window.PlayerVitals.updatePlayerVitals(1 / 60);
assert.strictEqual(deathCalls, 2, 'a later lethal resource tick is handled normally');

assert(game.includes('handlePlayerDeath: () => respawnPlayer()'), 'player vitals routes lethal afflictions through the canonical respawn');
assert(game.indexOf('window.PlayerVitals.updatePlayerVitals(dt)') < game.indexOf('updateHostiles(dt)', game.indexOf('window.PlayerVitals.updatePlayerVitals(dt)')), 'lethal resource damage is resolved before hostile AI runs');
assert(game.includes('getPlayerAimRay: currentPlayerAimRay'), 'bandit tents receive the current aim ray');
assert(game.includes('getPlayerInteractionRay: currentPlayerInteractionRay'), 'bandit tents receive the interaction ray');
assert(bandits.includes('deps.getPlayerInteractionRay?.() || deps.getPlayerAimRay?.()'), 'tent focus consumes the injected ray');
assert(!bandits.includes('tile.type = deps.TileType.ROCK'), 'tent footprint collision does not generate terrain rocks');
assert(game.includes('if (tile._banditTentCollisionId) return null;'), 'tent footprint metadata remains movement-blocking');
assert(pellet.includes('target.health <= 0'), 'Drenkirra pellets reject dead targets, making pre-AI respawn required');

console.log('player death, bandit tent interaction, and post-respawn hostile attack contracts passed');

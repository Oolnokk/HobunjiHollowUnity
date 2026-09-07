#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const campSource = fs.readFileSync('docs/js/bandit-camps.js', 'utf8'); // Used to verify Beastmaster selection, spawn ownership, and combat-set registration.
const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Used to verify faction-aware reuse of the companion AI.
const config = JSON.parse(fs.readFileSync('docs/config/bandits/bandit-gang-config.json', 'utf8')); // Used to validate the tunable rarity and weak-pet stats.
const variant = config.gruntVariants?.slagothimBeastmaster; // Used by every assertion about the authored Beastmaster definition.

assert(variant, 'Slagothim Beastmaster grunt variant must be configured');
assert(variant.chancePerGrunt > 0 && variant.chancePerGrunt <= 0.1, 'Beastmaster must remain a rare grunt roll');
assert.equal(variant.maxPerCamp, 1, 'a camp must be capped at one Beastmaster');
assert.equal(variant.speciesId, 'tletingan', 'Beastmaster must use the Tletingan/Slagothim avatar and naming data');
assert.equal(variant.companionCreatureKey, 'dabinggi-hound', 'Beastmaster must bring a Dabinggi-hound');
assert(variant.companionHealthMultiplier < 1, 'enemy hound must be less durable than a full companion');
assert(variant.companionDamageMultiplier <= 0.5, 'enemy hound damage must stay modest');
assert(variant.companionAttackCooldownMultiplier > 1, 'enemy hound must attack more slowly than a full companion');

assert.match(campSource, /rank !== 'grunt'/, 'only a normal grunt slot can become a Beastmaster');
assert.match(campSource, /speciesWeights: \{ \[speciesId\]: 1 \}/, 'Beastmaster species must be forced without changing ordinary bandit weights');
assert.match(campSource, /banditVariant: variant \? 'slagothimBeastmaster' : null/, 'spawned Beastmaster must carry a debug-visible variant marker');
assert.match(campSource, /deps\.hostileObjects\.add\(hound\)[\s\S]{0,180}deps\.companionObjects\.add\(hound\)/, 'hound must be targetable as hostile while companion AI drives it');
assert.match(campSource, /banditCampInstanceId: rec\.instance\.id/, 'hound must count toward clearing its source camp');
assert.match(campSource, /hound\.def = tunedDef[\s\S]{0,180}hound\.stamina = hound\.maxStamina = tunedDef\.maxStamina/, 'per-instance tuning must update both definition and live resources');

assert.match(gameSource, /if \(c\.banditCompanion\) continue;/, 'hostile AI must not double-tick a hound owned by companion AI');
assert.match(gameSource, /isBanditCompanion && player\.health > 0 && playerNearBanditMaster \? player : null/, "enemy companion must select the player within its master's normal alert radius");
assert.match(gameSource, /if \(target === player\) damagePlayer/, 'fallback companion bites must use the player damage path');
assert.match(gameSource, /window\.BanditCamps\?\.init\(\{[\s\S]{0,900}makeCreatureEntity,/, 'BanditCamps must receive the shared creature factory');

console.log('Slagothim Beastmaster regression checks passed.');

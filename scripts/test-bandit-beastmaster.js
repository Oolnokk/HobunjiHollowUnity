#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm'); // Executes the real companion spawn function against lightweight fake game dependencies.

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

const renderSource = fs.readFileSync('docs/js/creature-genetics-render.js', 'utf8'); // Checks the existing species compositor already has the eye art that the spawn genotype enables.
assert.match(renderSource, /'dabinggi-hound':\s*\{[\s\S]*?eyes: \{ open: 'assets\/creaturesprites\/dabinggi-hound_eye\.png'/, 'Dabinggi renderer must paint eye overlays for genotyped hounds');

const spawnStart = campSource.indexOf('  async function spawnBeastmasterCompanion('); // Extracts the actual production spawn function for a functional regression check.
const spawnEnd = campSource.indexOf('  async function spawnConfiguredBandit(', spawnStart); // Stops before the unrelated bandit spawn helper.
assert(spawnStart !== -1 && spawnEnd > spawnStart, 'Beastmaster companion spawn function remains testable');

async function verifyHoundGenotypeOnCreation() {
  const rolledGenotype = { base: { color: '#65524a' }, stripes: { enabled: true, color: '#a78b6a' } }; // Sentinel coat verifies the factory receives the original genetic roll.
  let rolledKind = null; // Records which species the live spawning code asks genetics to generate.
  let factoryInput = null; // Captures the options the real hound factory receives before any visual construction.
  const hostileObjects = new Set(); // Mirrors the enemy-target registration collection.
  const companionObjects = new Set(); // Mirrors the companion AI registration collection.
  const deps = {
    rnd: () => 0.25,
    TILE: 32,
    hostileObjects,
    companionObjects,
    makeCreatureEntity(kind, x, y, options) {
      factoryInput = { kind, x, y, options };
      return {
        id: 'test-beastmaster-hound',
        genotype: options.genotype,
        def: { label: 'Dabinggi-hound', maxHealth: 100, maxStamina: 60, attackDamage: 10, attackCooldownS: 1 },
      };
    },
  };
  const window = {
    CreatureGenetics: {
      SPECIES_ALIAS: {},
      makeDefaultGenotype(kind) { rolledKind = kind; return rolledGenotype; },
    },
    __farmLog: () => {},
  };
  const spawn = vm.runInNewContext(campSource.slice(spawnStart, spawnEnd) + String.fromCharCode(10) + 'spawnBeastmasterCompanion', { deps, window });
  const owner = { id: 'test-beastmaster', name: 'Beastmaster', x: 32, y: 64, scene: {}, areaGrid: {}, areaCols: 30, areaRows: 30 };
  const camp = { instance: { id: 'camp-1' }, homeX: 16, homeY: 32, gangIds: new Set() };
  const hound = await spawn(camp, owner, variant);
  assert.equal(rolledKind, 'dabinggi-hound', 'the hound rolls the standard Dabinggi genotype');
  assert.equal(factoryInput?.kind, 'dabinggi-hound', 'the correct creature type uses the standard factory');
  assert.strictEqual(factoryInput?.options?.genotype, rolledGenotype, 'genotype must be passed BEFORE sprite construction, not assigned afterward');
  assert.strictEqual(hound?.genotype, rolledGenotype, 'live hound keeps the factory-provided genetic coat');
  assert.equal(hound.maxHealth, 60, 'existing weak companion health tuning survives the appearance fix');
  assert(hostileObjects.has(hound) && companionObjects.has(hound), 'existing combat and companion AI registration survives the appearance fix');
  assert(camp.gangIds.has(hound.id), 'existing camp cleanup registration survives the appearance fix');
}
verifyHoundGenotypeOnCreation()
  .then(() => console.log('Slagothim Beastmaster genotype, eyes, and combat regression checks passed.'))
  .catch(error => { console.error(error); process.exitCode = 1; });

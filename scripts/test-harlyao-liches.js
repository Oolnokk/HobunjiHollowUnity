(async () => {
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const lichSource = fs.readFileSync(path.join(root, 'docs/js/combat/combat-lich.js'), 'utf8');
const resourceSource = fs.readFileSync(path.join(root, 'docs/js/combat/resource-system.js'), 'utf8');
const devSpawnerSource = fs.readFileSync(path.join(root, 'docs/js/dev-spawner.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8');
const pixelProbeSource = fs.readFileSync(path.join(root, 'docs/js/pixel-probe.js'), 'utf8');
const portraitSource = fs.readFileSync(path.join(root, 'docs/js/portrait-utils.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(root, 'docs/style.css'), 'utf8');
const combatBanditSource = fs.readFileSync(path.join(root, 'docs/js/combat/combat-bandit.js'), 'utf8');
const gameSource = fs.readFileSync(path.join(root, 'docs/game.js'), 'utf8');
const handFrameSource = fs.readFileSync(path.join(root, 'docs/js/procedural-hand-frame-driver.js'), 'utf8');
const proceduralLegSource = fs.readFileSync(path.join(root, 'docs/js/procedural-leg-animation.js'), 'utf8');
const drunkProneSource = fs.readFileSync(path.join(root, 'docs/js/drunk-prone-composition-bridge.js'), 'utf8');
const skeletonSpecies = JSON.parse(fs.readFileSync(path.join(root, 'docs/config/species/harlyao-skeleton.json'), 'utf8'));
const cosmeticsIndex = JSON.parse(fs.readFileSync(path.join(root, 'docs/config/cosmetics/index.json'), 'utf8'));
const itemIndex = JSON.parse(fs.readFileSync(path.join(root, 'docs/config/items/item-index.json'), 'utf8'));
const raggedHood = JSON.parse(fs.readFileSync(path.join(root, 'docs/config/cosmetics/ragged_hood.json'), 'utf8'));

assert.equal(raggedHood.slot, 'hood');
assert.equal(raggedHood.meta.name, 'Ragged Hood');
for (const [variantId, variant] of Object.entries(raggedHood.speciesVariants)) {
  const layers = variant.parts?.head?.layers;
  assert(layers?.front?.image?.url, `${variantId} needs front ragged-hood art`);
  assert(layers?.back?.image?.url, `${variantId} needs rear ragged-hood art`);
  for (const layerName of ['front', 'back']) {
    const repoPath = layers[layerName].image.url.replace(/^\.\//, '');
    assert(fs.existsSync(path.join(root, 'docs', repoPath)), `${variantId} missing ${layerName} asset ${repoPath}`);
    assert.deepEqual(layers[layerName].image.colors, ['A'], `${variantId} ${layerName} must share dye A`);
  }
}
assert(raggedHood.speciesVariants['engh-sho_male']);
assert(raggedHood.speciesVariants['engh-sho_female']);
assert(cosmeticsIndex.entries.some(entry => entry.id === 'ragged_hood' && entry.path === './ragged_hood.json'));
assert(itemIndex['cosmetic:ragged_hood']);
for (const gender of ['male', 'female']) assert(skeletonSpecies[gender].allowedCosmetics.includes('ragged_hood'));

let randomValue = 0;
let nowMs = 1000;
let currentArea = 'map_dev_arena';
let damageApplied = 0;
const player = { id: 'player', areaId: 'map_dev_arena', x: 64, y: 0, health: 100, maxHealth: 100, def: {} };
const hostileObjects = new Set();
const ResourceSystem = {
  getAffliction(entity, id) { return Number(entity.afflictions?.[id]) || 0; },
  addAffliction(entity, id, amount) {
    entity.afflictions ||= {};
    const before = Number(entity.afflictions[id]) || 0;
    entity.afflictions[id] = before + amount;
    return amount;
  },
  removeAffliction(entity, id, amount) {
    entity.afflictions ||= {};
    const before = Number(entity.afflictions[id]) || 0;
    const removed = Math.min(before, Math.max(0, amount));
    entity.afflictions[id] = before - removed;
    return removed;
  },
  applyHealthAfflictionDamage(entity, amount) {
    entity.health -= amount;
    damageApplied += amount;
    return amount;
  },
};
let capturedMakeArgs = null;
const windowObject = {
  GameRandom: { random: () => randomValue },
  ResourceSystem,
  BanditCombat: {
    init() {},
    updateCombatAI() { return { handled: false }; },
    async loadGangConfig() { return { speciesWeights: {} }; },
    async makeEntity(...args) {
      capturedMakeArgs = args;
      return {
        id: 'made-lich', name: args[5]?.nameOverride || 'Lich',
        x: args[3], y: args[4], areaId: 'map_dev_arena', health: 100,
        enemyClass: args[5]?.enemyClass || null,
        isHarlyaoLich: !!args[5]?.extra?.isHarlyaoLich,
        lichType: args[5]?.extra?.lichType || null,
        def: { moveSpeed: 100, chaseSpeed: 140 },
        rosterRecord: args[5]?.rosterOverride,
        halfHeight: 0.45,
        groundLift: 0.45,
        avatarRef: {
          modelHeight: 0.9,
          legs: {
            hover: false,
            setHoverMode(enabled) { this.hover = !!enabled; },
            isHoverMode() { return this.hover; },
          },
        },
        scene: { add() {} },
      };
    },
  },
  RangedWeapons: {
    update() {},
    actorHitbox() { return null; },
  },
  Combat: { getMovementSpeedMul: () => 1 },
  NearbyVolumeCollision: { segmentHit: () => null },
  MinionCombat: { makeEntity: async () => null },
};
const context = vm.createContext({
  window: windowObject,
  console,
  performance: { now: () => nowMs },
  Math, Number, String, Boolean, Object, Array, Set, Map, WeakMap, JSON, Promise,
});
vm.runInContext(lichSource, context, { filename: 'combat-lich.js' });
const api = windowObject.HarlyaoLichCombat;
assert(api, 'HarlyaoLichCombat global must install');
assert.equal(api.CLASS_ID, 'harlyao-lich');
assert.deepEqual(Array.from(api.TYPE_ORDER), ['tothal', 'hronal', 'kanthic']);

windowObject.BanditCombat.init({
  getCurrentArea: () => currentArea,
  player,
  hostileObjects,
  TILE: 64,
  moveCreatureToward() { return false; },
  damagePlayer() {},
  damageCreature() {},
  tileSurfaceYInArea: () => 0,
});

const allowedTothal = /dye:CLOTH:(pure|muted|dusty|dark_muted)_(green_blue|blue|blue_indigo)$/;
const allowedHronal = /dye:CLOTH:(pure|muted|dusty|dark_muted)_(red|red_orange|orange|yellow_orange|yellow)$/;
const allowedKanthic = /dye:CLOTH:(?:(?:pure|muted|dusty|dark_muted)_(?:indigo|indigo_violet|violet)|white|gray|charcoal)$/;
for (let i = 0; i <= 100; i++) {
  randomValue = Math.min(0.999999, i / 100);
  assert(allowedTothal.test(api.rollDye('tothal')), 'Tothal dye escaped green-blue through blue-indigo');
  assert(allowedHronal.test(api.rollDye('hronal')), 'Hronal dye escaped red through yellow');
  const kanthic = api.rollDye('kanthic');
  assert(allowedKanthic.test(kanthic), 'Kanthic dye escaped indigo/violet + allowed neutrals');
  assert(!/(brown|cream|silver)/.test(kanthic), 'Kanthic must exclude brown, cream, and silver');
}
for (const type of api.TYPE_ORDER) {
  randomValue = 0.37;
  const roster = api.rosterFor(type, 'female');
  assert.equal(roster.appearance.speciesId, 'harlyao-skeleton');
  assert.deepEqual(Array.from(roster.equippedCosmetics), ['ragged_hood', 'tankan_bodywrap']);
  assert.equal(roster.appliedDyes.HOOD, roster.appliedDyes.CLOTH, `${type} hood and wrap must share one dye`);
}

assert(api.TYPE_DEFS.tothal.projectile.knockbackPxS >= 900);
assert(api.TYPE_DEFS.tothal.projectile.footingDamageMultiplier >= 5);
assert(api.TYPE_DEFS.tothal.projectile.frostbittenFooting > 0);
assert(api.TYPE_DEFS.hronal.projectile.burningHealth > 0);
assert(api.TYPE_DEFS.hronal.projectile.shatteredStamina > 0);
assert(api.TYPE_DEFS.kanthic.projectile.gravityWorldS2 > api.TYPE_DEFS.hronal.projectile.gravityWorldS2 * 4, 'Kanthic blob needs unusually heavy dropoff');
assert(api.TYPE_DEFS.kanthic.projectile.speedPxS > api.TYPE_DEFS.hronal.projectile.speedPxS, 'Kanthic blob needs the quick initial flight');
assert(api.TYPE_DEFS.kanthic.projectile.entrancedHealth > 0);

randomValue = 0.2;
const slowBefore = windowObject.Combat.getMovementSpeedMul();
api.addGooSlow(player);
const slowAfter = windowObject.Combat.getMovementSpeedMul();
assert.equal(slowBefore, 1);
assert(slowAfter < 1 && slowAfter > 0.8, 'one Kanthic stack should slow but not root the player');
api.addGooSlow(player);
assert(windowObject.Combat.getMovementSpeedMul() < slowAfter, 'goo slow stacks must compound');

const lichA = { id: 'lich-a', name: 'Kanthic Lich A', areaId: 'map_dev_arena', x: 0, y: 0, health: 100, _lichCommand: 'approach' };
const lichB = { id: 'lich-b', name: 'Kanthic Lich B', areaId: 'map_dev_arena', x: 128, y: 0, health: 100, _lichCommand: 'flee' };
hostileObjects.add(lichA);
hostileObjects.add(lichB);
player.afflictions = { entrancedHealth: 0 };
player.x = 64; player.y = 0; player.health = 100;
const healthBeforeApplicationOnly = 1;
player.health = healthBeforeApplicationOnly;
const damageBeforeApplicationOnly = damageApplied;
api.applyEntranced(player, lichA, 20);
assert.equal(player.health, healthBeforeApplicationOnly, 'applying Entranced Health alone must never reduce real Health');
assert.equal(damageApplied, damageBeforeApplicationOnly, 'applying Entranced Health alone must never call the lethal Health-affliction damage path');
assert.equal(player._entrancedCommandState.source, lichA);
api.applyEntranced(player, lichB, 4);
assert.equal(player._entrancedCommandState.source, lichB, 'latest Entranced applicant must become referential target');

player.afflictions.entrancedHealth = 20;
api.applyEntranced(player, lichA, 0.1);
player.afflictions.entrancedHealth = 20;
player.health = 100;
player.x = 80; // Away from lichA while commanded to approach: punished. 16 px at TILE=64 is exactly 0.25 tile.
const healthBeforeWrongMove = player.health;
const afflictionBeforeWrongMove = player.afflictions.entrancedHealth;
const damageBeforeWrongMove = damageApplied;
windowObject.RangedWeapons.update(0.1);
const wrongMoveHealthLost = healthBeforeWrongMove - player.health;
const wrongMoveBuildupConsumed = afflictionBeforeWrongMove - player.afflictions.entrancedHealth;
assert(Math.abs(wrongMoveHealthLost - 0.9) < 1e-9, '0.25 tile of wrong-way movement must deal exactly 0.9 Health at the reduced 3.6-per-tile ratio');
assert(Math.abs(wrongMoveBuildupConsumed - 0.9) < 1e-9, 'wrong-way movement must consume Entranced buildup at the same reduced 3.6-per-tile ratio');
assert(Math.abs((damageApplied - damageBeforeWrongMove) - 0.9) < 1e-9, 'movement-to-damage conversion must be one fifth of the former 18-per-tile value');

const healthBeforeObey = player.health;
const entrancedBeforeObey = player.afflictions.entrancedHealth;
player.x = 70; // Toward lichA while commanded to approach: fast recovery, no punishment.
windowObject.RangedWeapons.update(0.1);
assert.equal(player.health, healthBeforeObey, 'obeying Entranced command must not deal Health damage');
assert(player.afflictions.entrancedHealth < entrancedBeforeObey, 'obeying Entranced command must recover buildup');

currentArea = 'farm';
player.afflictions.entrancedHealth = 8;
assert(windowObject.Combat.getMovementSpeedMul() < 1, 'goo slow should still be active immediately before leaving the arena runtime tick');
windowObject.RangedWeapons.update(0.1);
assert.equal(player.afflictions.entrancedHealth, 0, 'Entranced Health must clear immediately after leaving the Testing Arena');
assert.equal(windowObject.Combat.getMovementSpeedMul(), 1, 'Kanthic goo slow must clear immediately after leaving the Testing Arena');
const offArena = await api.makeEntity({ type: 'tothal', x: 10, y: 10 });
assert.equal(offArena, null, 'lich constructor must refuse non-Testing-Arena areas');
currentArea = 'map_dev_arena';
const made = await api.makeEntity({ type: 'hronal', tier: 2, x: 10, y: 20, gender: 'male' });
assert(made && capturedMakeArgs, 'arena lich should delegate to shared humanoid constructor');
assert.equal(capturedMakeArgs[5].enemyClass, 'harlyao-lich');
assert.equal(capturedMakeArgs[5].rosterOverride.appliedDyes.HOOD, capturedMakeArgs[5].rosterOverride.appliedDyes.CLOTH);
assert.equal(capturedMakeArgs[5].defOverride.weaponKey, 'pickshovel_nativeCopper', 'lich constructor must use the existing Light Weapon reference definition for cast poses');
assert.equal(made.avatarRef.legs.isHoverMode(), true, 'new lich must enter procedural hover mode immediately');
hostileObjects.add(made);
const groundedLift = made._lichBaseGroundLift;
windowObject.RangedWeapons.update(0.1);
assert(made.groundLift > groundedLift + 0.35, 'active lich renderer baseline must be raised well above the ground-following humanoid baseline');
assert(made._lichHoverOffsetWorld > 0.35, 'active lich must expose a positive presentation-only hover offset');
made.prone = true;
windowObject.RangedWeapons.update(0.1);
assert.equal(made.avatarRef.legs.isHoverMode(), false, 'prone lich must disable dangling hover pose');
assert.equal(made.groundLift, groundedLift, 'prone lich must return to its ordinary grounded baseline');
made.prone = false;
windowObject.RangedWeapons.update(0.1);
assert.equal(made.avatarRef.legs.isHoverMode(), true, 'recovered lich must resume procedural hover mode');

const resourceContext = vm.createContext({ window: {}, console, performance: { now: () => 1000 }, Math, Number, String, Boolean, Object, Array, Set, Map, WeakMap, JSON });
vm.runInContext(resourceSource, resourceContext, { filename: 'resource-system.js' });
const realRS = resourceContext.window.ResourceSystem;
assert.equal(realRS.AFFLICTIONS.frostbittenFooting.resource, 'footing');
assert.equal(realRS.AFFLICTIONS.frostbittenFooting.family, 'control');
assert.equal(realRS.AFFLICTIONS.frostbittenFooting.recovers, true);
assert.equal(realRS.AFFLICTIONS.entrancedHealth.resource, 'health');
assert.equal(realRS.AFFLICTIONS.entrancedHealth.family, 'control');
assert.equal(realRS.AFFLICTIONS.entrancedHealth.recovers, false, 'Entranced directional recovery is owned by lich runtime');
const lowHealthApplicationTarget = { health: 1, maxHealth: 100, stamina: 100, maxStamina: 100, maxFooting: 100, footing: 100 };
realRS.initEntity(lowHealthApplicationTarget);
realRS.addAffliction(lowHealthApplicationTarget, 'entrancedHealth', 100);
assert.equal(lowHealthApplicationTarget.health, 1, 'canonical ResourceSystem Entranced application must preserve a living actor at 1 Health');
assert.equal(realRS.getAffliction(lowHealthApplicationTarget, 'entrancedHealth'), 100, 'Entranced buildup may fill independently without directly spending real Health');
assert.match(lichSource, /ENTRANCED_WRONG_MOVE_DAMAGE_PER_TILE = 3\.6/, 'wrong-direction movement punishment must remain one fifth of the original 18 Health per tile');
assert.match(resourceSource, /frostbittenRegenMul = 1 - frostbittenFraction \* 0\.8/);

for (const key of ['tothal', 'hronal', 'kanthic']) {
  assert(devSpawnerSource.includes(`harlyao-lich:${key}`), `Testing Arena must expose ${key} lich button`);
}
assert.match(devSpawnerSource, /startsWith\('harlyao-lich:'\)/);
assert(indexSource.includes('js/combat/combat-lich.js?v=20260927lichvisual1'));
assert(indexSource.includes('js/combat/combat-bandit.js?v=20260927hostilevisual1'));
assert(indexSource.includes('js/dev-spawner.js?v=20260927hostilevisual1'));
assert(indexSource.includes('game.js?v=20260927arenarespawn1'));
assert(indexSource.includes('js/combat/resource-system.js?v=20260926lich1'));
assert(indexSource.includes('js/pixel-probe.js?v=20260926lich1'));
assert(indexSource.includes('js/portrait-utils.js?v=20260926hoodback2'));
assert(indexSource.includes('js/procedural-leg-animation.js?v=20260926hover1'));
assert(indexSource.includes('js/combat/combat-config-loader.js?v=20260927hoverairassist1'));
assert(pixelProbeSource.includes('window.HarlyaoLichCombat?.formatDebug?.()'), 'Pixel Probe must expose live lich diagnostics on mobile');
assert(portraitSource.includes('const hoodBackLayers = []'), 'ragged hood rear layer must use the generic behind-head hood bucket');
assert.match(portraitSource, /\(layer\.pos === 'back' \? hoodBackLayers : hoodLayers\)\.push/, 'hood compositor must route authored back layers separately from front layers');
assert(portraitSource.includes('if (hoodBackLayers.length) hoodLayers.length = 0'), 'ragged hood rear view must use authored rear cloth without overlaying the front opening');
assert(indexSource.includes('style.css?v=20260926entranced2'));
assert(styleSource.includes('#entrancedCommandBanner.visible'), 'Entranced command must use the shared stylesheet instead of module-local system-font debug styling');
assert(styleSource.includes("font-family: 'KhymeryyanRomanLetters+Numbers'"), 'Entranced command must use the game HUD font');
assert(styleSource.includes('font-size: 24px'), 'Entranced APPROACH/FLEE action text must be twice the prior 12px size');
assert(styleSource.includes('font-size: 14px'), 'Entranced condition label must be twice the prior 7px size');
assert.match(styleSource, /#entrancedCommandBanner \{[\s\S]*background: transparent;/, 'Entranced command must have no visible background container');
assert.match(styleSource, /#entrancedCommandBanner \{[\s\S]*border: 0;/, 'Entranced command must have no visible border container');
assert.match(lichSource, /LUNGE_RING_REFERENCE_OUTER_RADIUS = 0\.46/, 'controller marker reference radius must stay aligned with the canonical game.js lunge stamp');
assert.match(lichSource, /LUNGE_RING_REFERENCE_THICKNESS = 0\.14/, 'controller marker reference thickness must stay aligned with the canonical game.js lunge stamp');
assert.match(lichSource, /ENTRANCER_RING_OUTER_RADIUS = LUNGE_RING_REFERENCE_OUTER_RADIUS \* 2/, 'controller marker must be twice the lunge-ring diameter scale');
assert.match(lichSource, /ENTRANCER_RING_THICKNESS = LUNGE_RING_REFERENCE_THICKNESS \* 2/, 'controller marker must be twice the lunge-ring line thickness');
assert.match(lichSource, /ENTRANCER_RING_PULSE_MS = 1000/, 'controller marker must pulse once per second');
assert.match(lichSource, /new THREE\.RingGeometry\(inner, outer, 24\)/, 'controller marker must use the same 24-segment ring geometry as lunge stamps');
assert.match(lichSource, /blending: THREE\.AdditiveBlending, fog: false/, 'controller marker must use the same additive fog-free material language as lunge stamps');
assert.match(lichSource, /player\?_entrancedCommandState|_entrancedCommandState\?\.source/, 'controller marker must resolve from the latest referential Entranced source');
assert.match(lichSource, /source\.lichType !== 'kanthic'/, 'only the controlling Kanthic lich receives the Entranced owner marker');
assert.match(lichSource, /AuthoredFurniture[\s\S]{0,700}createEmitterVisual/, 'controlling Kanthic must use the existing authored particle-emitter renderer for its body-height aura');
assert.match(lichSource, /id: 'entranced_controller_fire'[\s\S]{0,500}rate: 92[\s\S]{0,300}colorA: colorCssHex\(bright\)[\s\S]{0,100}colorB: colorCssHex\(color\)/, 'Entranced aura must be a large color-coded fire emitter');
assert.match(lichSource, /LICH_CAST_WEAPON_KEY = 'pickshovel_nativeCopper'/, 'lich casting must reference an existing Light Weapon definition');
assert.match(lichSource, /LICH_CAST_COMBO_ID = 'pokeCombo'/, 'lich casting must reuse the existing light-weapon thrust combo');
assert.match(lichSource, /socket\.name = 'lich_empty_light_weapon'/, 'visible reference weapon geometry must be replaced with an empty held weapon object');
assert.match(lichSource, /window\.Combat\?\.comboData\?\.\[LICH_CAST_COMBO_ID\]/, 'lich casts must read the existing player attack animation steps rather than a bespoke pose');
assert.match(lichSource, /window\.Combat\?\.beginStagedAction/, 'lich abilities must use the existing staged Neutral→Windup→Strike attack timing');
assert.match(lichSource, /rig\.placeHandWorld\('right', handPosition, handQuaternion\)/, 'lich procedural right hand must attach to the animated empty weapon object');
assert.match(combatBanditSource, /portrait\.userData\.proceduralHandParent = handsPivot[\s\S]*group\.add\(portrait\)/, 'shared hostile builder must keep the PNGPlaneAvatar hand-driver root parented in the visible entity hierarchy');
assert.match(combatBanditSource, /handRigAvatarRoot: portrait/, 'lich avatarRef must expose the registered procedural hand root');
assert.match(lichSource, /const registeredRoot = entity\?\.avatarRef\?\.handRigAvatarRoot/, 'lich cast-hand lookup must prefer the retained registered hand root');
assert.match(combatBanditSource, /proceduralHandToolHolder = useRanged \? c\._banditRangedToolHolder : c\._banditToolHolder/, 'hostile hand owner must publish its live melee/ranged holder every animation update');
assert.match(handFrameSource, /proceduralHandToolHolder[\s\S]*ownedHolder\?\.parent/, 'final-render procedural hand driver must accept a hostile-owned held object');
assert.match(handFrameSource, /const playerOwnedHolder = !ownedHolder[\s\S]*toolHolder === gameDeps\.toolHolder/, 'lich hand record must never read the player\'s baked weapon-holder matrix');
assert.match(handFrameSource, /holderAuthority: record\?\.avatarRoot\?\.userData\?\.proceduralHandToolHolder \? 'actor-owned-world-transform'/, 'hand diagnostics must identify actor-owned hostile transform authority');
assert.match(handFrameSource, /proceduralHandToolKey[\s\S]*currentToolKey\(record\)/, 'hostile hand sync must use that hostile\'s weapon key rather than the player singleton stance');
assert.match(combatBanditSource, /const resolvedRosterDyes = applyRosterDyesToProfile\(profile, roster\)/, 'lich visible portrait must explicitly reconcile its hood/bodywrap dye before rasterization');
assert.match(lichSource, /if \(ability === 'summon'\) summonMinion\(lich\);[\s\S]*else firePrimary\(lich, target\);/, 'both summon and primary spell abilities must fire from the reused attack strike phase');
assert.match(proceduralLegSource, /function applyHoverPose\(side, dt\)/, 'procedural leg system must own a real two-bone hover pose rather than post-rotating feet');
assert.match(proceduralLegSource, /bendDegX = -31[\s\S]*solveTwoBoneLeg/, 'hover pose must keep visibly flexed dangling knees through the shared leg solver');
assert.match(proceduralLegSource, /function setHoverMode\(enabled\)[\s\S]*function isHoverMode\(\)/, 'procedural leg handles must expose explicit hover ownership');
const suppressedIndex = proceduralLegSource.indexOf('if (suppressed) {', proceduralLegSource.indexOf('function update(dt, speedWorldUnitsPerSecond'));
const hoverIndex = proceduralLegSource.indexOf('if (state.hoverEnabled) {', suppressedIndex);
assert(suppressedIndex >= 0 && hoverIndex > suppressedIndex, 'explicit prone/death suppression must outrank active hover pose');
assert.match(drunkProneSource, /const hoverMode = !!handle\.isHoverMode\?\.\(\)[\s\S]*effectiveSuppressed \|\| hoverMode/, 'bandit run gait must not overwrite dangling hover legs');
assert.match(lichSource, /HOVER_HEIGHT_MODEL_FRACTION = 0\.58/, 'lich hover height must scale from rendered model height');
assert.match(lichSource, /lich\.groundLift = baseGroundLift \+ lich\._lichHoverOffsetWorld/, 'hover must use existing render baseline without changing ground-plane AI coordinates');
assert.match(lichSource, /!lich\.prone/, 'active hover must drop while a lich is prone');
const arenaRespawnStart = gameSource.indexOf("if (currentArea === 'map_dev_arena')", gameSource.indexOf('function respawnPlayer()'));
const arenaRespawnEnd = gameSource.indexOf('const totem = _isZoneArea', arenaRespawnStart);
assert(arenaRespawnStart >= 0 && arenaRespawnEnd > arenaRespawnStart, 'Testing Arena needs a dedicated respawn branch before ordinary Root Totem/farm fallback');
const arenaRespawnBlock = gameSource.slice(arenaRespawnStart, arenaRespawnEnd);
assert.match(arenaRespawnBlock, /EXTERIOR_ZONES\.map_dev_arena[\s\S]*entryCol[\s\S]*entryRow/, 'arena death must respawn at the authored Testing Arena entry');
assert.doesNotMatch(arenaRespawnBlock, /_returnToFarmMeshes\(/, 'arena death must never invoke the farm scene fallback');
assert.match(arenaRespawnBlock, /player\.health = player\.maxHealth[\s\S]*player\.stamina = player\.maxStamina/, 'arena respawn must restore combat resources');
assert.match(arenaRespawnBlock, /Object\.keys\(window\.ResourceSystem\?\.AFFLICTIONS \|\| \{\}\)/, 'arena respawn must clear stale affliction buildup that could instantly re-kill the test player');

console.log('Harlyao Lich regression checks passed.');

})().catch(error => { console.error(error); process.exitCode = 1; });

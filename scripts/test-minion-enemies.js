const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const minionSource = fs.readFileSync('docs/js/combat/combat-minion.js', 'utf8');
const resourceSource = fs.readFileSync('docs/js/combat/resource-system.js', 'utf8');
const coreSource = fs.readFileSync('docs/js/combat/combat-core.js', 'utf8');
const trustSource = fs.readFileSync('docs/js/weapon-trust-bandit-loadouts.js', 'utf8');
const colorsSource = fs.readFileSync('docs/config/colors/config.js', 'utf8');
const gameConfigSource = fs.readFileSync('docs/config/config.js', 'utf8');
const devSource = fs.readFileSync('docs/js/dev-spawner.js', 'utf8');
const indexSource = fs.readFileSync('docs/index.html', 'utf8');

assert.match(resourceSource, /shamblingFooting:\s*\{[\s\S]*name: "Shambling Footing"[\s\S]*resource: "footing"[\s\S]*immutable: true/);
assert.match(resourceSource, /function setImmutableAffliction\([\s\S]*_immutableAfflictions/);
assert.match(resourceSource, /fullFootingMax - getAffliction\(entity, "shamblingFooting"\)/);
assert.match(resourceSource, /def\.extend === "maxBack"/);
assert.match(coreSource, /baseFootingMax = Math\.max\(0, Number\(original\.getEffectiveMax\(entity, key\)\)/);
assert.match(trustSource, /entity\?\.enemyClass === 'minion'/);
assert.match(gameConfigSource, /shamblingFooting:\s*'#[0-9a-fA-F]{6}'/);
assert.match(devSource, /window\.MinionCombat\.makeEntity\(/);
assert(indexSource.indexOf('combat-bandit.js?v=20260926minion1') < indexSource.indexOf('combat-minion.js?v=20260926minion1'));
assert(indexSource.indexOf('combat-minion.js?v=20260926minion1') < indexSource.indexOf('dev-spawner.js?v=20260926minion1'));

const authoredDyes = [
  'dye:CLOTH:muted_red_orange', 'dye:CLOTH:dusty_red_orange', 'dye:CLOTH:dark_muted_red_orange',
  'dye:CLOTH:muted_orange', 'dye:CLOTH:dusty_orange', 'dye:CLOTH:dark_muted_orange',
  'dye:CLOTH:muted_yellow_orange', 'dye:CLOTH:dusty_yellow_orange', 'dye:CLOTH:dark_muted_yellow_orange',
  'dye:CLOTH:muted_yellow', 'dye:CLOTH:dusty_yellow', 'dye:CLOTH:dark_muted_yellow',
  'dye:CLOTH:brown', 'dye:CLOTH:charcoal', 'dye:CLOTH:silver',
];
for (const dye of authoredDyes) assert(colorsSource.includes(`"id": "${dye}"`), `Missing authored Minion dye: ${dye}`);

let seed = 0x1234abcd;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
};
let captured = null;
const ResourceSystem = {
  setImmutableAffliction(entity, id, amount) {
    entity.afflictions ||= {};
    entity._immutableAfflictions ||= {};
    entity.afflictions[id] = amount;
    entity._immutableAfflictions[id] = amount;
    return amount;
  },
  getEffectiveMax(entity, key) {
    return key === 'footing' ? entity.maxFooting - (entity.afflictions?.shamblingFooting || 0) : 0;
  },
  enforceCaps(entity) {
    entity.footing = Math.min(entity.footing, this.getEffectiveMax(entity, 'footing'));
  },
};
const BanditCombat = {
  async loadGangConfig() { return { clothingPool: { slots: ['torso', 'overwear', 'hat', 'hood'] } }; },
  async makeEntity(cfg, rank, tier, x, y, opts) {
    captured = { cfg, rank, tier, x, y, opts };
    return {
      id: 'minion-test',
      maxFooting: 100,
      footing: 100,
      afflictions: {},
      def: { weaponKey: 'daggerSword_nativeCopper', rangedWeaponKey: opts.defOverride.rangedWeaponKey },
      rosterRecord: opts.rosterOverride,
      enemyClass: opts.enemyClass,
      ...opts.extra,
    };
  },
};
const windowObject = { GameRandom: { random }, ResourceSystem, BanditCombat };
windowObject.window = windowObject;
vm.runInContext(minionSource, vm.createContext(windowObject), { filename: 'combat-minion.js' });
const api = windowObject.MinionCombat;
assert(api);

const allowedClothes = new Set(['tankan_bodywrap', 'rugged_poncho', 'bandolier1']);
const allowedDyes = new Set(authoredDyes);
let sawNoOverwear = false, sawBodywrap = false, sawPoncho = false, sawNoClothes = false;
for (let i = 0; i < 300; i++) {
  const roster = api.rollRoster('harlyao-skeleton', 'Skeleton');
  assert(['male', 'female'].includes(roster.appearance.gender));
  assert(roster.equippedCosmetics.every(id => allowedClothes.has(id)));
  assert(!roster.equippedCosmetics.some(id => /hood|facewrap|headband/i.test(id)));
  for (const dye of Object.values(roster.appliedDyes)) assert(allowedDyes.has(dye));
  const overwear = roster.equippedCosmetics.find(id => id === 'tankan_bodywrap' || id === 'rugged_poncho');
  if (!overwear) sawNoOverwear = true;
  if (overwear === 'tankan_bodywrap') sawBodywrap = true;
  if (overwear === 'rugged_poncho') sawPoncho = true;
  if (!roster.equippedCosmetics.length) sawNoClothes = true;
}
assert(sawNoOverwear && sawBodywrap && sawPoncho && sawNoClothes);

(async () => {
  const entity = await api.makeEntity({ speciesId: 'harlyao-skeleton', name: 'Harlyao Skeleton', tier: 2, x: 10, y: 20, zoneId: 'map_dev_arena' });
  assert.equal(entity.enemyClass, 'minion');
  assert.equal(entity.isMinion, true);
  assert.equal(entity.afflictions.shamblingFooting, 30);
  assert.equal(entity._immutableAfflictions.shamblingFooting, 30);
  assert.equal(entity.footing, 70);
  assert.deepEqual(Array.from(captured.cfg.weaponShapePool), ['daggerSword', 'fishingspear', 'hatchet']);
  assert.equal(captured.cfg.rangedWeaponChanceByRank.grunt, 0);
  assert.equal(captured.cfg.rangedWeaponChanceByRank.lieutenant, 0);
  assert.equal(captured.cfg.rangedWeaponChanceByRank.captain, 0);
  assert.equal(captured.opts.defOverride.rangedWeaponKey, null);
  assert.equal(captured.opts.enemyClass, 'minion');
  assert(!captured.opts.rosterOverride.equippedCosmetics.some(id => /hood|facewrap|headband/i.test(id)));
  console.log('Minion enemy class regression checks passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

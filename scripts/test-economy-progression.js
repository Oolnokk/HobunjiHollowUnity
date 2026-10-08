'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const economySource = fs.readFileSync('docs/config/economy-progression.js', 'utf8');
const fishSource = fs.readFileSync('docs/js/fish-catalog.js', 'utf8');
const shopStock = JSON.parse(fs.readFileSync('docs/config/shops/shop-stock.json', 'utf8'));

const configWindow = {};
vm.runInNewContext(economySource, { window: configWindow }, { filename: 'economy-progression.js' });
const config = configWindow.ECONOMY_PROGRESSION_CONFIG;
assert(config, 'economy progression config must load');

function extractRows(source) {
  const marker = 'const ROWS = [';
  const start = source.indexOf(marker);
  assert(start >= 0, 'fish catalog must expose the authored ROWS table');
  const arrayStart = source.indexOf('[', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = arrayStart; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return vm.runInNewContext(`(${source.slice(arrayStart, i + 1)})`);
    }
  }
  throw new Error('Could not parse fish ROWS table');
}

const rows = extractRows(fishSource);
const reference = config.referenceFishing;
const seasonMap = { spring: 'Stormtide', summer: 'Deadgrass', fall: 'Longpour', winter: 'Coldmuck' };
const amphibiousSpecies = new Set(['gurumahi']);
const amphibiousSellMultiplier = 3;

function normalizedSeasons(raw) {
  if (raw === 'any') return 'any';
  return String(raw).split(',').map(name => seasonMap[name] || name);
}

function fishEntry(row) {
  const amphibious = amphibiousSpecies.has(row[2]);
  return {
    key: row[0],
    species: row[2],
    zones: row[8],
    seasons: normalizedSeasons(row[9]),
    timesOfDay: row[10],
    rarity: row[11],
    sellPrice: row[12] * (amphibious ? amphibiousSellMultiplier : 1),
    amphibious,
  };
}

const fullZonePool = rows.map(fishEntry).filter(fish =>
  fish.zones.includes(reference.zone) && (reference.allowAmphibious || !fish.amphibious));
assert(fullZonePool.length > 0, 'reference fishing zone must contain eligible fish');

function eligiblePool(seasonName, segment) {
  const filtered = fullZonePool.filter(fish =>
    (fish.seasons === 'any' || fish.seasons.includes(seasonName)) &&
    (fish.timesOfDay === 'any' || fish.timesOfDay.includes(segment)));
  return filtered.length ? filtered : fullZonePool; // Mirrors fishing-minigame.js fallback behavior.
}

function weightedMeanSell(pool) {
  let weightedValue = 0;
  let totalWeight = 0;
  for (const fish of pool) {
    const weight = Number(reference.rarityWeights[fish.rarity] || 1); // Mirrors no-perk rarity weighting.
    weightedValue += fish.sellPrice * weight;
    totalWeight += weight;
  }
  return weightedValue / totalWeight;
}

const segmentHours = reference.daylightSegmentsHours;
const totalDaylightHours = Object.values(segmentHours).reduce((sum, value) => sum + Number(value || 0), 0);
assert(totalDaylightHours > 0, 'reference daylight segments must have positive duration');

const seasonResults = reference.seasons.map(seasonKey => {
  const seasonName = seasonMap[seasonKey] || seasonKey;
  let valueHours = 0;
  for (const [segment, hours] of Object.entries(segmentHours)) {
    valueHours += weightedMeanSell(eligiblePool(seasonName, segment)) * hours;
  }
  return { seasonKey, meanSellPerCatch: valueHours / totalDaylightHours };
});

const meanSellPerCatch = seasonResults.reduce((sum, entry) => sum + entry.meanSellPerCatch, 0) / seasonResults.length;
const expectedGoldPerDay = meanSellPerCatch * reference.successfulCatchesPerDaylightDay;

const growthTonic = shopStock.shops?.kunjiPotionWares?.goods?.find(entry => entry.key === 'growthTonic');
const incubator = shopStock.shops?.carpenterBarnPlans?.additions?.incubator;
assert(growthTonic, 'Growth Tonic must exist in Kunji shop stock');
assert(incubator, 'Incubator must exist in carpenter barn-addition stock');

const tonicsPerDay = expectedGoldPerDay / growthTonic.price;
const incubatorFishingDays = incubator.price / expectedGoldPerDay;
const tonicTarget = config.targets.growthTonicsPerFishingDay;
const incubatorTarget = config.targets.incubatorFishingDays;

assert(
  tonicsPerDay >= tonicTarget.min && tonicsPerDay <= tonicTarget.max,
  `beginner fishing should buy ${tonicTarget.min}-${tonicTarget.max} Growth Tonics/day, got ${tonicsPerDay.toFixed(3)}`
);
assert(
  incubatorFishingDays >= incubatorTarget.min && incubatorFishingDays <= incubatorTarget.max,
  `Incubator should cost ${incubatorTarget.min}-${incubatorTarget.max} beginner fishing days, got ${incubatorFishingDays.toFixed(3)}`
);
assert.equal(growthTonic.price, 200, 'Growth Tonic reference buy price is 200g');
assert.equal(incubator.price, 5000, 'Incubator reference buy price remains 5000g');

// ── Farming, processing, cooking, rewards and skill pacing ──────────────
// Every value below is read from the shipped source (game.js object
// literals, shop-stock.json, or the real runtime modules run in a vm) so
// these guardrails track the actual game numbers.
const targets = config.targets;
const gameSource = fs.readFileSync('docs/game.js', 'utf8');

function extractLiteral(source, marker, open = '{', scope = {}) {
  const start = source.indexOf(marker);
  assert(start >= 0, `missing ${marker}`);
  const literalStart = source.indexOf(open, start);
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = literalStart; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return vm.runInNewContext(`(${source.slice(literalStart, i + 1)})`, { ...scope });
  }
  throw new Error(`Could not parse ${marker}`);
}

function inRange(value, range, label) {
  if (range.min !== undefined) assert(value >= range.min, `${label}: ${value.toFixed(3)} < min ${range.min}`);
  if (range.max !== undefined) assert(value <= range.max, `${label}: ${value.toFixed(3)} > max ${range.max}`);
}

function loadModule(file) {
  const moduleWindow = {};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window: moduleWindow, document: {}, console, queueMicrotask }, { filename: file });
  return moduleWindow;
}

const cropData = extractLiteral(gameSource, 'const cropData = {');
const basePrices = extractLiteral(gameSource, 'const BASE_PRICES = {', '{', { CROP_SELL_PRICES: {} });
const startingInventory = extractLiteral(gameSource, 'const STARTING_INVENTORY = {');

const cropSellPrices = loadModule('docs/config/crop-economy.js').HOBUNJI_CROP_ECONOMY.sellPrices;
Object.assign(basePrices, cropSellPrices); // Mirrors game.js's `...CROP_SELL_PRICES` spread into BASE_PRICES.
function itemDefSellPrice(key) {
  assert(new RegExp(`\\n\\s+${key}: \\{[^\\n]*?sellPrice: CROP_SELL_PRICES\\.${key},`).test(gameSource), `ITEM_DEFS.${key} must read its sellPrice from CROP_SELL_PRICES`);
  return cropSellPrices[key];
}

const seedPacks = {};
for (const match of gameSource.matchAll(/\{ key: '(\w+)',[^\n]*?price: (\d+), gives: \{ (\w+): (\d+) \} \}/g)) {
  if (match[1] === match[3]) seedPacks[match[1]] = { price: Number(match[2]), count: Number(match[4]) };
}

let earlyFieldDaily = 0;
let boughtSeedNets = [];
for (const [cropKey, crop] of Object.entries(cropData)) {
  const sell = itemDefSellPrice(crop.cropKey);
  const pack = seedPacks[crop.seedKey];
  const seedCost = pack ? pack.price / pack.count : 0;
  const netPerPlotDay = (sell - seedCost) / crop.growDays;
  if (pack) {
    inRange(seedCost / sell, targets.seedCostShareOfCrop, `${cropKey} seed cost share`);
    inRange(netPerPlotDay, targets.boughtSeedCropNetPerPlotDay, `${cropKey} net/plot-day`);
    boughtSeedNets.push(netPerPlotDay);
    earlyFieldDaily += netPerPlotDay;
  } else {
    inRange(netPerPlotDay, targets.wildSeedCropNetPerPlotDay, `${cropKey} (wild seed) net/plot-day`);
  }
}
assert(boughtSeedNets.length >= 4, 'seed-shop crops must be found in SUPPLY_CATALOG');
inRange(Math.max(...boughtSeedNets) / Math.min(...boughtSeedNets), targets.boughtSeedCropSpread, 'bought-seed crop spread');
earlyFieldDaily = earlyFieldDaily / boughtSeedNets.length * config.referenceFarming.plots;
inRange(earlyFieldDaily / expectedGoldPerDay, targets.earlyFieldShareOfFishingDay, 'early field share of a fishing day');

if (targets.startingGoldCoversOneOfEachSeedPack) {
  const allPacks = Object.values(seedPacks).reduce((sum, pack) => sum + pack.price, 0);
  assert(startingInventory.gold >= allPacks, `starting gold ${startingInventory.gold} must cover one of each seed pack (${allPacks})`);
}

for (const good of shopStock.shops.generalStoreWares.goods) {
  const [itemKey] = Object.keys(good.gives || {});
  if (!good.qualityStars || basePrices[itemKey] === undefined) continue;
  inRange(good.price / basePrices[itemKey], targets.stapleRetailOverSell, `${good.key} retail/sell`);
}

const processing = loadModule('docs/js/item-processing.js').ItemProcessing;
for (const [kind, rule] of Object.entries(processing.PROCESSING_VALUE)) {
  if (kind === 'dewMilk' || kind === 'dewCurds') continue; // Checked jointly below.
  inRange(processing.processedValue(kind, 10) / 10, targets.processingGainAtCheapInput, `${kind} at 10g`);
  inRange(processing.processedValue(kind, 60) / 60, targets.processingGainAtExpensiveInput, `${kind} at 60g`);
  assert(rule.mult > 1, `${kind} must multiply value`);
}
for (const input of [10, 60]) {
  const squeezed = processing.processedValue('dewMilk', input) + processing.processedValue('dewCurds', input);
  inRange(squeezed / input, targets.processingGainAtCheapInput, `dew squeeze (milk+curds) at ${input}g`);
}
const flourOverStaple = processing.processedValue('flour', basePrices.needlegrain);
const flourStaple = shopStock.shops.generalStoreWares.goods.find(good => good.key === 'needlegrainFlourStaple');
inRange(flourStaple.price / flourOverStaple, targets.stapleRetailOverSell, 'needlegrain flour staple retail/sell');

const cooking = loadModule('docs/js/cooking-system.js').CookingSystem;
const dishDefs = { a: { sellPrice: basePrices.heftroot }, b: { sellPrice: basePrices.garlink }, c: { sellPrice: 30 } };
const dishSelections = ['a', 'b', 'c'].map(key => ({ selected: { key } }));
const dishValue = cooking.cookedSellPrice({ slots: [{}, {}, {}] }, dishSelections, 3, dishDefs);
inRange(dishValue / (basePrices.heftroot + basePrices.garlink + 30), targets.cookedDishPremium, 'cooked dish premium');
assert(cooking.cookedSellPrice({ slots: [{}, {}] }, [], 2, {}) >= 4, 'dish value keeps a floor for unknown ingredients');

const fishingDays = price => price / expectedGoldPerDay;
const carpenter = shopStock.shops.carpenterBarnPlans.tiers;
const deeds = shopStock.shops.carpenterHouseDeeds.pieces;
const ladder = {
  houseSmallRoom: deeds.smallRoom.price,
  barnMedium: carpenter.medium.price,
  houseLargeWing: deeds.largeWing.price,
  barnLarge: carpenter.large.price,
};
for (const [key, price] of Object.entries(ladder)) inRange(fishingDays(price), targets.purchaseFishingDays[key], `${key} fishing days`);
const fallbackBarns = extractLiteral(gameSource, 'medium: { label', '{');
assert.equal(fallbackBarns.price, carpenter.medium.price, 'game.js fallback barn tier must match shop-stock.json');

const bountyTiers = extractLiteral(fs.readFileSync('docs/js/bounty-board.js', 'utf8'), 'const BOUNTY_REWARD_GOLD_BY_TIER = ', '[');
inRange(fishingDays(bountyTiers[0]), targets.bountyTierFishingDays, 'lowest bounty tier');
inRange(fishingDays(bountyTiers[bountyTiers.length - 1]), targets.bountyTierFishingDays, 'highest bounty tier');

const skills = loadModule('docs/js/skill-system.js').SkillSystem;
const pacing = config.skillPacing;
const avgGrowDays = Object.values(cropData).reduce((sum, crop) => sum + crop.growDays, 0) / Object.keys(cropData).length;
const pacingReport = [];
for (const [skillKey, actions] of Object.entries(pacing.actionsPerFocusedDay)) {
  let xpPerDay = 0;
  for (const [gainKey, count] of Object.entries(actions)) {
    const actionCount = count === 'midGameHarvests' ? config.referenceFarming.midGamePlots / avgGrowDays : count;
    assert(skills.XP_GAINS[gainKey] !== undefined, `SkillSystem.XP_GAINS.${gainKey} must exist`);
    xpPerDay += actionCount * skills.XP_GAINS[gainKey] * skills.xpGainMultiplier(skillKey);
  }
  const days10 = skills.xpForLevel(10) / xpPerDay;
  const days20 = skills.xpForLevel(skills.MAX_LEVEL) / xpPerDay;
  inRange(days10, pacing.daysToLevel10, `${skillKey} days to level 10`);
  inRange(days20, pacing.daysToLevel20, `${skillKey} days to level ${skills.MAX_LEVEL}`);
  pacingReport.push(`${skillKey} ${days20.toFixed(1)}d`);
}

console.log(
  `economy progression passed: ${meanSellPerCatch.toFixed(2)}g/catch, ` +
  `${expectedGoldPerDay.toFixed(2)}g/day, ${tonicsPerDay.toFixed(2)} tonics/day, ` +
  `${incubatorFishingDays.toFixed(2)} incubator fishing days; ` +
  `${config.referenceFarming.plots}-plot field ${earlyFieldDaily.toFixed(0)}g/day; ` +
  `days to max skill: ${pacingReport.join(', ')}`
);

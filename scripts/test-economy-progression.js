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
assert.equal(growthTonic.price, 500, 'Growth Tonic reference buy price remains 500g');
assert.equal(incubator.price, 5000, 'Incubator reference buy price remains 5000g');

console.log(
  `economy progression passed: ${meanSellPerCatch.toFixed(2)}g/catch, ` +
  `${expectedGoldPerDay.toFixed(2)}g/day, ${tonicsPerDay.toFixed(2)} tonics/day, ` +
  `${incubatorFishingDays.toFixed(2)} incubator fishing days`
);

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/livestock-nursery-grid.js', 'utf8');
const bridgeSource = fs.readFileSync('docs/js/livestock-nursery-install-bridge.js', 'utf8');

let livestock = [
  { id: 'baby_small', kind: 'grehlr', name: 'Pebble', lifeStage: 'baby', genotype: { sizeClass: 'small', rare: false } },
  { id: 'baby_rare', kind: 'grehlr', name: 'Stripe', lifeStage: 'baby', genotype: { sizeClass: 'medium', rare: true } },
  { id: 'adult', kind: 'grehlr', name: 'Adult', lifeStage: 'adult', genotype: { sizeClass: 'medium', rare: false } },
];
let pairs = [{ parentA: { source: 'world', id: 'baby_small' }, parentB: { source: 'world', id: 'adult' } }];
const inventory = { gold: 25 };
let livestockSaveCount = 0;
let memberSaveCount = 0;
let swarmRerolls = 0;

const CreatureGenetics = {
  sellValueFor(genotype) {
    return { amount: genotype?.rare ? 400 : 100, tier: genotype?.rare ? 'Rare' : 'Common', comparison: 'test genetics' };
  },
  genotypeTraits(kind, genotype) {
    return {
      size: {
        sizeClass: genotype?.sizeClass || 'medium',
        defaultSizeClass: 'medium',
        label: genotype?.sizeClass === 'small' ? 'Small' : 'Medium',
      },
      colors: [{ id: 'base', label: 'Base coat', color: '#445566', colorName: 'Slate' }],
      patterns: genotype?.rare
        ? [{ id: 'mitts', label: 'Mitts', enabled: true, carrier: false, color: '#ffffff', colorName: 'White', copies: 1, inheritance: 'dominant' }]
        : [],
    };
  },
};

const documentStub = {
  head: { appendChild() {} },
  getElementById() { return null; },
  addEventListener() {},
  createElement() { return { id: '', textContent: '', style: {}, appendChild() {} }; },
}; // Used by the no-browser regression harness so queued decoration can safely no-op after exercising economy/debug code.

const context = {
  console,
  queueMicrotask,
  document: documentStub,
  window: {
    CreatureGenetics,
    CreatureGeneticsRender: null,
    LivestockNursery: {
      isBaby: entry => entry?.lifeStage === 'baby',
      adultCount: () => livestock.filter(entry => entry.lifeStage !== 'baby').length,
      adultCapacity: () => 4,
      growBaby: () => ({ ok: true, message: 'grew' }),
      rerollSwarm: () => { swarmRerolls++; },
      debugSnapshot: () => ({ babyCount: livestock.filter(entry => entry.lifeStage === 'baby').length }),
    },
    AnimalGrowth: { growthTonicCount: () => 2 },
    FarmAnimals: { init() {} },
    FarmPanel: { init() {}, render() {} },
  },
};
context.window.window = context.window;
vm.runInNewContext(source, context, { filename: 'livestock-nursery-grid.js' });

const animalDeps = {
  inventory,
  CREATURE_DB: { grehlr: { label: 'Grehlr', defaultSizeClass: 'medium' } },
  loadWorldLivestock: () => livestock,
  saveWorldLivestock(next) { livestock = next; livestockSaveCount++; },
  _loadWorldBreedingPairs: () => pairs,
  _saveWorldBreedingPairs(next) { pairs = next; },
  hasFarmPermission: permission => permission === 'livestock',
  saveMemberWorldData() { memberSaveCount++; },
  showToast() {},
};
const panelDeps = { ...animalDeps };
context.window.FarmAnimals.init(animalDeps);
context.window.FarmPanel.init(panelDeps);

const commonAdult = CreatureGenetics.sellValueFor({ rare: false }, 'grehlr');
const rareAdult = CreatureGenetics.sellValueFor({ rare: true }, 'grehlr');
assert.equal(commonAdult.amount, 500, 'plain grown livestock receives the +400g maturity premium');
assert.equal(commonAdult.geneticAmount, 100, 'genetics-only amount is retained for diagnostics');
assert.equal(rareAdult.amount, 800, 'rarity/pattern value remains additive underneath the maturity premium');

const grid = context.window.LivestockNurseryGrid;
assert.equal(grid.babyValueFor(livestock[0]).amount, 75, 'plain 500g adult produces a 75g baby value at 15%');
assert.equal(grid.babyValueFor(livestock[1]).amount, 120, '800g adult produces a 120g baby value at 15%');
assert.equal(grid.babyValueFor(livestock[1]).adultAmount, 800, 'baby valuation exposes its adult reference value');

const snapshot = grid.debugSnapshot();
const small = snapshot.babies.find(entry => entry.id === 'baby_small');
const rare = snapshot.babies.find(entry => entry.id === 'baby_rare');
assert.ok(small.badges.includes('🔽'), 'one-size-smaller baby gets the blue down badge');
assert.ok(rare.badges.includes('🧤'), 'visible Mitts trait gets its compact trait emoji');
assert.equal(rare.colors[0].name, 'Slate', 'debug/detail source retains exact authored color names');
assert.equal(rare.patterns[0].label, 'Mitts', 'debug/detail source retains exact authored pattern names');

const sale = grid.sellBaby('baby_small');
assert.equal(sale.ok, true, 'Nursery baby can be sold');
assert.equal(sale.amount, 75, 'sale pays the derived baby value');
assert.equal(inventory.gold, 100, 'baby sale credits the player wallet');
assert.equal(livestock.some(entry => entry.id === 'baby_small'), false, 'sold baby is removed from farm livestock');
assert.equal(pairs.length, 0, 'defensive breeding references to the sold baby are removed');
assert.equal(livestockSaveCount, 1, 'baby sale persists farm livestock once');
assert.equal(memberSaveCount, 1, 'baby sale persists wallet/member data once');
assert.equal(swarmRerolls, 1, 'baby sale refreshes the Nursery interior swarm');

// Re-installation must not stack another +400g wrapper.
grid.install();
assert.equal(CreatureGenetics.sellValueFor({ rare: false }, 'grehlr').amount, 500, 'economy wrapper is idempotent');

assert.match(bridgeSource, /globalKey:\s*'LivestockNurseryGrid'/, 'farm feature bridge parser-loads the Nursery grid module');
assert.match(bridgeSource, /installLivestockNurseryGrid\(\)/, 'farm feature bridge installs the Nursery grid after FarmPanel becomes available');

console.log('livestock nursery grid regression checks passed');

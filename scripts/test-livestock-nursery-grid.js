'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/livestock-nursery-grid.js', 'utf8');
const pagingSource = fs.readFileSync('docs/js/livestock-nursery-inventory-paging.js', 'utf8');
const outdoorGrowthSource = fs.readFileSync('docs/js/livestock-nursery-outdoor-growth.js', 'utf8');
const uiFixSource = fs.readFileSync('docs/js/livestock-nursery-grid-ui-fix.js', 'utf8');
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

assert.match(source, /firstChild\.nodeValue\s*=\s*'Nursery Grow'/, 'enhanced Grow Up control changes only its backing text node so the legacy private-button tonic gate cannot double-consume');
assert.match(source, /IntersectionObserver/, 'Nursery card portraits remain visibility-driven instead of all composed up front');
assert.match(source, /scheduleCardPortrait\(section, card, entry\)/, 'every card routes portrait work through the lazy visibility scheduler');
assert.doesNotMatch(source, /cards\.forEach[\s\S]{0,900}portraitUrlFor\(entry\)\.then/, 'card decoration does not directly compose every baby portrait during initial render');
assert.match(pagingSource, /grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/, 'Nursery uses Inventory-style fixed seven-column geometry');
assert.match(pagingSource, /rowsPerPage:\s*4[\s\S]*pageSize:\s*28/, 'Nursery has a deterministic four-row, 28-baby page instead of scroll-dependent capacity');
assert.match(pagingSource, /max-height:none\s*!important/, 'Nursery removes the old short nested max-height');
assert.match(pagingSource, /overflow:visible\s*!important/, 'Nursery grid itself no longer owns a nested scrollbar');
assert.doesNotMatch(pagingSource, /new\s+ResizeObserver|typeof\s+ResizeObserver|resizeObserver\s*=/, 'paging does not observe layout size continuously');
assert.doesNotMatch(pagingSource, /measurePageGeometry/, 'paging does not perform repeated geometry measurement');
assert.doesNotMatch(pagingSource, /getBoundingClientRect/, 'paging does not force layout reads to decide page capacity');
assert.match(pagingSource, /stack\.classList\.remove\(LEGACY_SCROLL_CLASS\)/, 'enhanced grid opts out of FarmMenuLayout compact-scroll bookkeeping when a Farm render is paginated');
assert.doesNotMatch(pagingSource, /attributeFilter:\s*\['class'\]/, 'paging does not maintain a second class MutationObserver');
assert.match(pagingSource, /shadow\.querySelector\('slot\[name="debug"\]'\)/, 'page turning reuses the existing light-DOM debug host through a shadow slot instead of adding Nursery children');
assert.doesNotMatch(pagingSource, /document\.createElement\('button'\)/, 'paging never creates a new light-DOM button that could wake the legacy Nursery body observer');
assert.match(pagingSource, /font-size:0\s*!important/, 'paging hides the redundant legacy header contents while that host acts as debug/page-turn control');
assert.match(pagingSource, /pager\.classList\.remove\('nursery-page-turn'\)/, 'page arrow mode disappears when the Nursery fits on one page');
assert.doesNotMatch(pagingSource, /LivestockNurseryGrid\?\.decorate\?\./, 'page turns do not rerun the entire Nursery genetics/portrait decorator');
assert.doesNotMatch(pagingSource, /LivestockNurseryGrid\?\.debugSnapshot/, 'paging does not scan the full genetics debug snapshot just to find the selected card');
assert.doesNotMatch(pagingSource, /first\.click\?\./, 'page focus does not click the first card and render its detail rail a second time');

assert.match(outdoorGrowthSource, /isBarnCapacityFailure/, 'full-barn maturation fallback is limited to the Nursery no-stall failure paths');
assert.match(outdoorGrowthSource, /entry\.lifeStage\s*=\s*'adult'/, 'full-barn maturation persists the baby as an adult');
assert.match(outdoorGrowthSource, /entry\.barnId\s*=\s*null/, 'full-barn maturation uses the existing outdoor-adult housing state');
assert.match(uiFixSource, /grow\.disabled\s*=\s*!canManage\s*\|\|\s*tonicCount\s*<\s*1/, 'Grow Up remains controller-focusable when barns are full and only blocks for permission/tonic');
assert.match(uiFixSource, /helpHost\.slot\s*=\s*'help'/, 'legacy Nursery info note gets its own grid-column help slot');
assert.match(uiFixSource, /headerHost\.slot\s*=\s*'debug'/, 'redundant legacy header becomes the debug/page-turn host instead of hijacking the help note');
assert.match(uiFixSource, /white-space:normal\s*!important/, 'Nursery info note is explicitly allowed to wrap inside the left grid column');
assert.match(uiFixSource, /document\.addEventListener\('focusin',[\s\S]*true\)/, 'controller focus refreshes Grow Up state after the private grid detail updater runs');

assert.match(bridgeSource, /globalKey:\s*'LivestockNurseryOutdoorGrowth'[\s\S]*outdoor1/, 'farm feature bridge loads full-barn outdoor maturation support');
assert.match(bridgeSource, /globalKey:\s*'LivestockNurseryGrid'[\s\S]*nurserygrid3/, 'farm feature bridge cache-busts the Nursery grid revision used by this compatibility pass');
assert.match(bridgeSource, /globalKey:\s*'LivestockNurseryInventoryPaging'[\s\S]*nurserypage6/, 'farm feature bridge loads the observer-safe fixed-page revision');
assert.match(bridgeSource, /globalKey:\s*'LivestockNurseryGridUiFix'[\s\S]*uifix1/, 'farm feature bridge loads the help/controller compatibility layer after paging');
assert.match(bridgeSource, /installLivestockNurseryGrid\(\)/, 'farm feature bridge installs the Nursery grid after FarmPanel becomes available');
assert.match(bridgeSource, /installLivestockNurseryInventoryPaging\(\)/, 'farm feature bridge installs paging after the grid feature');
assert.match(bridgeSource, /installLivestockNurseryGridUiFix\(\)/, 'farm feature bridge installs the grow/help UI compatibility last');

console.log('livestock nursery grid regression checks passed');

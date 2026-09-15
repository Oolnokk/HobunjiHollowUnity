'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this._innerHTML = '';
    this._synthetic = Object.create(null);
  }

  set innerHTML(value) {
    this._innerHTML = String(value ?? '');
    this.children = [];
    this._synthetic = Object.create(null);
    if (this._innerHTML.includes('farm-companion-btn')) {
      const button = new FakeElement('button');
      button.className = 'settings-small-btn farm-companion-btn';
      this._synthetic['.farm-companion-btn'] = button;
    }
    if (this._innerHTML.includes('farm-row-name')) {
      const input = new FakeElement('input');
      input.className = 'farm-row-name';
      const match = this._innerHTML.match(/class="farm-row-name" value="([^"]*)"/);
      input.value = match ? match[1] : '';
      this._synthetic['.farm-row-name'] = input;
    }
  }

  get innerHTML() { return this._innerHTML; }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) { this.listeners[type] = listener; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }

  querySelector(selector) {
    if (this._synthetic[selector]) return this._synthetic[selector];
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      const queue = [...this.children];
      while (queue.length) {
        const child = queue.shift();
        if (String(child.className || '').split(/\s+/).includes(className)) return child;
        queue.push(...(child.children || []));
      }
    }
    return null;
  }

  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }

  get classList() {
    return { contains: value => String(this.className || '').split(/\s+/).includes(value) };
  }
}

function descendantsByClass(root, className) {
  const out = [];
  const queue = [...(root?.children || [])];
  while (queue.length) {
    const current = queue.shift();
    if (String(current.className || '').split(/\s+/).includes(className)) out.push(current);
    queue.push(...(current.children || []));
  }
  return out;
}

function stableRowById(root, stableId) {
  const rows = descendantsByClass(root, 'stable-training-row'); // Used to find the native row after any Stable rerender.
  return rows.find(row => row.dataset.stableTrainingId === stableId) || null;
}

function allText(root) {
  const parts = [];
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    if (current?.textContent) parts.push(current.textContent);
    if (current?._innerHTML) parts.push(current._innerHTML);
    queue.push(...(current?.children || []));
  }
  return parts.join('\n');
}

const stable = [
  { id: 'hound1', kind: 'dabinggi-hound', name: 'Moro', role: 'companion', lifeStage: 'baby', level: 0, stableXp: 0, animalPerks: {} },
  { id: 'hound2', kind: 'dabinggi-hound', name: 'Tavi', role: 'companion', lifeStage: 'adult', level: 1, stableXp: 5, animalPerks: {} },
  { id: 'mount1', kind: 'gar-wolf', name: 'Grubble', role: 'mount', lifeStage: 'adult', level: 2, stableXp: 9, animalPerks: {} },
];
let activeCompanionId = null;
let activeMountId = null;
let saveCount = 0;
let growthCount = 0; // Counts native Stable growth requests delegated through AnimalGrowth.
let writtenCoreScript = '';
const stableList = new FakeElement('div');

const document = {
  // This is the important part of the regression: in a real parser-inserted
  // external script, document.write() queues the inserted script token; it does
  // NOT execute farm-panel-core.js before farm-panel.js itself returns.
  readyState: 'loading',
  head: new FakeElement('head'),
  createElement: tagName => new FakeElement(tagName),
  getElementById: id => id === 'stableList' ? stableList : null,
  write(html) { writtenCoreScript += String(html || ''); },
};

const companionGeneral = { id: 'rapportBond', name: 'Trusted Company', maxRank: 5, desc: '+6% positive NPC rapport per rank.' };
const companionSpecies = { id: 'species_dabinggi_toxicPounce', name: 'Toxic Pounce', maxRank: 3, desc: '+10% attack damage per rank.' };
const mountSpeed = { id: 'mountSpeed', name: 'Fleet Stride', maxRank: 5, desc: '+4% base riding speed per rank.' };

const progression = {
  maxLevel: 10,
  install() {},
  roleForEntry: entry => entry.role,
  normalizeEntry(entry) {
    entry.level = Math.max(0, Math.min(10, Math.floor(Number(entry.level) || 0)));
    entry.stableXp = Math.max(0, Math.floor(Number(entry.stableXp) || 0));
    entry.animalPerks ||= {};
    return entry;
  },
  perkDefsForEntry(entry) {
    return entry.role === 'companion' ? [companionGeneral, companionSpecies] : [mountSpeed];
  },
  perkRank(entry, id) { return Math.max(0, Math.floor(Number(entry.animalPerks?.[id]) || 0)); },
  availablePoints(entry) {
    const spent = Object.values(entry.animalPerks || {}).reduce((sum, rank) => sum + Math.max(0, Math.floor(Number(rank) || 0)), 0);
    return Math.max(0, entry.level - spent);
  },
  xpToNext(level) { return 40 + level * 20; },
  spendPoint(entryId, perkId) {
    const entry = stable.find(candidate => candidate.id === entryId);
    const def = this.perkDefsForEntry(entry).find(candidate => candidate.id === perkId);
    if (!entry || !def || this.availablePoints(entry) <= 0) return { ok: false, message: 'No point available.' };
    entry.animalPerks[perkId] = this.perkRank(entry, perkId) + 1;
    return { ok: true, message: 'Trained.' };
  },
};

const refinements = {
  maxLevel: 10,
  install() {},
  ensureStableCaps() {
    stable.forEach(entry => { entry.level = Math.max(0, Math.min(10, entry.level)); if (entry.level >= 10) entry.stableXp = 0; });
  },
  syncCompanionCombatPerks() {},
  companionCombatModifiers() { return { damage: 1, cooldown: 1, range: 1, staminaCost: 1 }; },
};

const animalGrowth = {
  CONFIG: {
    item: { label: 'Growth Tonic', icon: '🧪' },
    stable: { growAndEquipOnRoleClick: true },
  },
  isBaby: entry => entry?.lifeStage === 'baby',
  normalizeStableLifeStages() {},
  growthTonicCount: () => 2,
  growStableBaby(stableId, options = {}) {
    const entry = stable.find(candidate => candidate.id === stableId); // Used to reproduce AnimalGrowth's Stable lookup.
    if (!entry || entry.lifeStage !== 'baby') return { ok: false, message: 'That Stable baby was not found.' };
    entry.lifeStage = 'adult';
    growthCount++;
    if (options.equip) {
      if (entry.role === 'mount') activeMountId = entry.id;
      else activeCompanionId = entry.id;
    }
    context.FarmPanel.renderStablePanel();
    return { ok: true, entry, equipped: !!options.equip, message: `${entry.name} grew up.` };
  },
};

const legacyFarmPanel = { init() {}, renderStablePanel() { throw new Error('legacy Stable renderer should have been replaced'); } };
const context = {
  window: null,
  document,
  console,
  StableAnimalProgression: progression,
  StableAnimalTrainingRefinements: refinements,
  AnimalGrowth: animalGrowth,
  CreatureGenetics: {
    stableEntryRole: entry => entry.role,
    defaultLivestockName: kind => kind,
    genotypeTraits(kind) {
      return {
        size: { sizeClass: kind === 'gar-wolf' ? 'large' : 'medium', label: kind === 'gar-wolf' ? 'Large' : 'Medium', roleLabel: kind === 'gar-wolf' ? 'Mount' : 'Companion', isNonDefault: false },
        colors: [],
        patterns: [],
      };
    },
  },
  CREATURE_DB: { 'dabinggi-hound': { label: 'Dabinggi Hound' }, 'gar-wolf': { label: 'Gar-wolf' } },
};
context.window = context;

// Simulate the existing livestock-nursery bridge already owning FarmPanel's
// parser-time setter. farm-panel.js must chain through this instead of replacing
// it, because the real game needs both installers at the same publication.
let bridgePending = null;
let bridgeInstallCount = 0;
Object.defineProperty(context, 'FarmPanel', {
  configurable: true,
  enumerable: true,
  get() { return bridgePending; },
  set(value) {
    bridgePending = value;
    Object.defineProperty(context, 'FarmPanel', {
      configurable: true,
      enumerable: true,
      writable: true,
      value,
    });
    bridgeInstallCount++;
  },
});

vm.createContext(context);
const source = fs.readFileSync('docs/js/farm-panel.js', 'utf8');
vm.runInContext(source, context, { filename: 'farm-panel.js' });

assert.match(writtenCoreScript, /farm-panel-core\.js/, 'farm-panel.js queues the core script while the HTML parser is paused');
assert.equal(context.FarmPanel, null, 'queued parser script has not executed yet when farm-panel.js returns');

// Now reproduce what the browser does next: the parser reaches the written
// external script and farm-panel-core.js publishes window.FarmPanel. The armed
// setter must delegate to the nursery bridge and install the native renderer in
// the same synchronous handoff.
context.FarmPanel = legacyFarmPanel;
assert.equal(bridgeInstallCount, 1, 'existing FarmPanel publication bridge still receives the core API');
assert.equal(context.FarmPanel.__nativeStableTrainingRenderer, true, 'native Stable renderer installs when the delayed core actually publishes');
assert.equal(context.FarmPanel.__stableAnimalProgressionWrapped, true, 'legacy progression decorator is blocked from wrapping the native renderer');
assert.equal(context.FarmPanel.__stableTrainingRefinementsWrapped, true, 'legacy refinement decorator is blocked from wrapping the native renderer');

context.FarmPanel.init({
  getStable: () => stable,
  getActiveCompanionId: () => activeCompanionId,
  setActiveCompanionId: id => { activeCompanionId = id; },
  getActiveMountId: () => activeMountId,
  setActiveMountId: id => { activeMountId = id; },
  getActiveShoulderPetId: () => null,
  setActiveShoulderPetId() {},
  saveStable: () => { saveCount++; },
  showToast() {},
  esc: value => String(value),
});
context.FarmPanel.renderStablePanel();

const ageSections = descendantsByClass(stableList, 'stable-age-section'); // Used to verify the native renderer owns both age groups.
assert.equal(ageSections.length, 2, 'native Stable renderer creates Baby and Adult sections');
assert.match(allText(ageSections[0]), /Baby Animals/, 'first Stable age group is the baby section');
assert.match(allText(ageSections[1]), /Adult Animals/, 'second Stable age group is the adult section');
assert.equal(descendantsByClass(ageSections[0], 'stable-training-row').length, 1, 'baby section contains only Stable babies');
assert.equal(descendantsByClass(ageSections[1], 'stable-training-row').length, 2, 'adult section contains only Stable adults');

let babyRow = stableRowById(stableList, 'hound1'); // Re-read after each native rerender because rows are rebuilt.
let companionRow = stableRowById(stableList, 'hound2'); // Used for companion training expansion assertions.
let mountRow = stableRowById(stableList, 'mount1'); // Used for mount training expansion assertions.
assert.ok(babyRow && companionRow && mountRow, 'all saved Stable animals render inside an age section');
assert.match(babyRow.innerHTML, /Baby · Companion · Lv\. 0\/10/, 'baby row is visibly labeled and keeps the level cap');
assert.equal(descendantsByClass(babyRow, 'stable-grow-btn').length, 1, 'baby row exposes the Growth Tonic maturation control');
assert.match(companionRow.innerHTML, /Companion · Lv\. 1\/10/, 'adult companion directly shows the level-10 cap');
assert.doesNotMatch(companionRow.innerHTML, /leveling coming soon/i, 'authoritative Stable row no longer contains the placeholder');
assert.equal(descendantsByClass(companionRow, 'stable-entry-perk-tree').length, 0, 'tree starts collapsed');

companionRow.listeners.click({ target: { closest: () => null } });
companionRow = stableRowById(stableList, 'hound2');
mountRow = stableRowById(stableList, 'mount1');
assert.equal(descendantsByClass(companionRow, 'stable-entry-perk-tree').length, 1, 'tapping an adult companion expands its tree');
assert.equal(descendantsByClass(mountRow, 'stable-entry-perk-tree').length, 0, 'other adult animal remains collapsed');
assert.match(allText(companionRow), /General Companion Training/, 'expanded companion shows general training');
assert.match(allText(companionRow), /Dabinggi Hound Combat/, 'expanded companion shows its species combat branch');
assert.match(allText(companionRow), /Toxic Pounce/, 'species combat perk is rendered inside the actual card');

mountRow.listeners.click({ target: { closest: () => null } });
companionRow = stableRowById(stableList, 'hound2');
mountRow = stableRowById(stableList, 'mount1');
assert.equal(descendantsByClass(companionRow, 'stable-entry-perk-tree').length, 0, 'opening another animal collapses the first tree');
assert.equal(descendantsByClass(mountRow, 'stable-entry-perk-tree').length, 1, 'second adult animal tree opens');
assert.match(allText(mountRow), /Mount Training/, 'mount card renders its riding tree');

mountRow.listeners.click({ target: { closest: () => null } });
mountRow = stableRowById(stableList, 'mount1');
assert.equal(descendantsByClass(mountRow, 'stable-entry-perk-tree').length, 0, 'tapping the open animal collapses it');
assert.equal(context.FarmPanel.stableTrainingDebug().expandedStableId, null, 'debug state agrees that every tree is collapsed');
assert.equal(context.FarmPanel.stableTrainingDebug().babyCount, 1, 'Stable diagnostics report the saved baby count');
assert.equal(context.FarmPanel.stableTrainingDebug().adultCount, 2, 'Stable diagnostics report the saved adult count');
assert.equal(saveCount, 0, 'expanding/collapsing UI does not mutate the save');

babyRow = stableRowById(stableList, 'hound1');
const growButton = descendantsByClass(babyRow, 'stable-grow-btn')[0]; // Used to prove the native baby control delegates to AnimalGrowth.
growButton.listeners.click({ stopPropagation() {} });
assert.equal(growthCount, 1, 'native Stable Grow Up delegates exactly once to AnimalGrowth');
assert.equal(stable.find(entry => entry.id === 'hound1').lifeStage, 'adult', 'delegated Stable growth moves the baby into the adult life stage');
assert.equal(context.FarmPanel.stableTrainingDebug().babyCount, 0, 'native age groups refresh after a baby grows up');
assert.equal(context.FarmPanel.stableTrainingDebug().adultCount, 3, 'grown Stable baby immediately appears in the adult count');

assert.doesNotMatch(source, /leveling coming soon/i, 'farm-panel.js itself contains no obsolete leveling placeholder');
assert.match(source, /function renderStablePanelNative\(/, 'Stable UI is rendered directly by farm-panel.js, not by a post-render decorator');
assert.match(source, /stableAgeSection\('🐣 Baby Animals'/, 'native Stable renderer owns the baby grouping instead of relying on a retired decorator');
assert.match(source, /growth\(\)\?\.growStableBaby/, 'native Stable growth delegates to the shared AnimalGrowth lifecycle');
assert.match(source, /armNativeInstallOnFarmPanelPublication/, 'browser parser timing is handled at the FarmPanel publication boundary');

console.log('Native Stable panel training + age-section regression tests passed.');

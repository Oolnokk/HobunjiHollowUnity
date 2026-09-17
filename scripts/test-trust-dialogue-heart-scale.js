'use strict';

const assert = require('node:assert/strict'); // Used for the regression assertions below.
const fs = require('node:fs'); // Used to load the exact checked-in browser modules under test.
const path = require('node:path'); // Used to resolve runtime files from this script regardless of the launch directory.
const vm = require('node:vm'); // Used to execute browser IIFEs in isolated window-like contexts.

const repoRoot = path.resolve(__dirname, '..'); // Used to load the exact runtime files this regression protects.

function loadConditionRegistry() {
  const sourcePath = path.join(repoRoot, 'docs/js/condition-registry.js'); // Used as the shared authored-condition implementation under test.
  const source = fs.readFileSync(sourcePath, 'utf8'); // Used to execute the browser module without duplicating its logic in the test.
  const browserWindow = {
    NpcFavorBalance: {
      storageUnit: 'favor-points',
      favorPointsToHearts: points => Number(points || 0) / 40,
    },
  }; // Used to reproduce the point-backed relationship runtime installed by favor-heart-balance.js.
  const context = vm.createContext({ window: browserWindow, console }); // Used to keep the browser global isolated from Node's process global.
  vm.runInContext(source, context, { filename: sourcePath });
  return browserWindow.ConditionRegistry;
}

function loadTrustRuntime(state, recordedMemory) {
  const sourcePath = path.join(repoRoot, 'docs/js/weapon-trust-visits.js'); // Used as the trust-event runtime under test.
  const source = fs.readFileSync(sourcePath, 'utf8'); // Used to exercise the real eligibility/completion code rather than a copied helper.
  const gift = {
    id: 'test_trust_gift',
    npcId: 'test_npc',
    shapeKey: 'testShape',
    giftMetalKey: 'nativeCopper',
    dialogueTreeId: 'test_trust_tree',
    dialogueLines: ['Test.'],
  }; // Used as the smallest complete trust-gift definition accepted by the runtime.
  const browserWindow = {
    WEAPON_TRUST_VISIT_CONFIG: {
      relationship: { requiredHearts: 5 },
      visitor: { completionMemoryPrefix: 'weapon_trust_gift:' },
      gifts: [gift],
      bandits: { weaponShapePool: [] },
      onboarding: {},
    },
    location: { pathname: '/tools/dialogue-editor' },
    DialogueContent: {
      getNpcDlgState: () => state,
      recordNpcMemory: (_npcId, event) => recordedMemory.push(event),
    },
    NpcFavorBalance: {
      relationshipHeartsForNpc: () => Number(state.favor || 0) / 40,
    },
  }; // Used to reproduce the live trust dependencies while keeping the test out of the gameplay frame loop.
  const documentStub = {
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; },
  }; // Used to select editor-safe initialization without needing a DOM implementation.
  const context = vm.createContext({
    window: browserWindow,
    document: documentStub,
    console,
    setTimeout,
    CustomEvent: class CustomEvent {},
  }); // Used to execute the browser IIFE in an isolated Node VM.
  vm.runInContext(source, context, { filename: sourcePath });
  return { api: browserWindow.WeaponTrustVisits, gift };
}

const conditions = loadConditionRegistry(); // Used for the shared dialogue/ambient relationship threshold assertions.
const fiveHeartEntry = {
  conditions: { relationship: { min: 5, max: null } },
  excludeConditions: {},
}; // Used to represent an authored Dialogue Editor minimum condition expressed in hearts.
const fiveHeartMaxEntry = {
  conditions: { relationship: { min: null, max: 5 } },
  excludeConditions: {},
}; // Used to verify point-backed relationships honor authored maximum-heart boundaries too.
const excludeFiveHeartEntry = {
  conditions: {},
  excludeConditions: { relationship: { min: 5, max: null } },
}; // Used to verify relationship no-fly bands receive the same point-to-heart conversion as required bands.

assert.equal(conditions.entryEligible(fiveHeartEntry, { relationship: 199 }), false, '199 Favor must remain below a 5-heart minimum');
assert.equal(conditions.entryEligible(fiveHeartEntry, { relationship: 200 }), true, '200 Favor must satisfy a 5-heart minimum');
assert.equal(conditions.entryEligible(fiveHeartMaxEntry, { relationship: 200 }), true, '200 Favor must remain inside a 5-heart maximum');
assert.equal(conditions.entryEligible(fiveHeartMaxEntry, { relationship: 201 }), false, '201 Favor must exceed a 5-heart maximum');
assert.equal(conditions.entryEligible(excludeFiveHeartEntry, { relationship: 199 }), true, '199 Favor must remain outside a 5-heart exclusion band');
assert.equal(conditions.entryEligible(excludeFiveHeartEntry, { relationship: 200 }), false, '200 Favor must enter a 5-heart exclusion band');
assert.equal(conditions.entryEligible(fiveHeartEntry, { relationship: 5, relationshipUnit: 'hearts' }), true, 'explicit heart-valued callers must not be converted twice');

const indexHtml = fs.readFileSync(path.join(repoRoot, 'docs/index.html'), 'utf8'); // Used to ensure production bootstrap requests the fixed condition-registry version instead of a stale cached copy.
assert.match(indexHtml, /js\/condition-registry\.js\?v=20260917trust1/, 'production index must cache-bust the fixed condition registry');

const state = { favor: 199, memory: [] }; // Used as the live raw relationship state for trust-visit eligibility.
const recordedMemory = []; // Used to prove failed grants do not persist trust completion.
const trust = loadTrustRuntime(state, recordedMemory); // Used for the trust-specific threshold and transaction assertions.

assert.equal(trust.api.requiredHearts(trust.gift), 5, 'trust configuration remains authored in hearts');
assert.equal(trust.api.giftEligible(trust.gift), false, 'trust visit must not unlock at 199 Favor');
state.favor = 200;
assert.equal(trust.api.giftEligible(trust.gift), true, 'trust visit unlocks exactly at 200 Favor / 5 hearts');
assert.equal(trust.api.completeGift(trust.gift), false, 'completion must fail when no gift inventory dependency can grant the weapon');
assert.deepEqual(recordedMemory, [], 'failed gift grants must not record permanent trust completion');

console.log('trust dialogue Favor/heart regressions: ok');

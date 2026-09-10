#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const game = read('docs/game.js');
const index = read('docs/index.html');
const calendar = read('docs/js/calendar-system.js');
const authoredFurniture = read('docs/js/authored-furniture-runtime.js');
const bridgeSource = read('docs/js/alcohol-gameplay-bridge.js');
const seatedSource = read('docs/js/seated-npc-interactions.js');

// ── index.html load order ───────────────────────────────────────────────
assert(index.indexOf('js/combat/resource-system.js') < index.indexOf('js/alcohol-gameplay-bridge.js'),
  'alcohol-gameplay-bridge.js checks window.ResourceSystem at load time and must load after it');
assert(index.indexOf('js/alcohol-gameplay-bridge.js') < index.indexOf('game.js?v='),
  'game.js calls into window.HobunjiDrunkGameplayBridge during its own setup');
assert(index.indexOf('js/seated-npc-interactions.js') < index.indexOf('game.js?v='),
  'game.js calls window.SeatedSocialInteractions.init(...) during its own setup');

// ── calendar-system.js no longer sniffs the DOM for seated state ───────
assert.doesNotMatch(calendar, /getElementById\('btnAction1'\)/,
  'isSeatedReady must not infer seating from which action currently renders on btnAction1');
assert.match(calendar, /isSeatedActive\?\.\(\)/,
  'isSeatedReady delegates to the real sitInteraction-backed bridge instead');

// ── game.js control-scheme wiring ───────────────────────────────────────
assert.match(game, /isSeatedActive: \(\) => !!sitInteraction && sitInteraction\.phase === 'active'/,
  'game.js exposes real seated state on the existing furniture debug bridge');
assert.match(game, /if \(window\.SeatedSocialInteractions\?\.isOpen\?\.\(\)\) \{ window\.SeatedSocialInteractions\.cancel\(\); return; \}[\s\S]{0,800}if \(sitInteraction\) \{ if \(sitInteraction\.phase === 'active' && !dialogueOpen\) endSitInteraction\(\); return; \}/,
  'Dodge (performContextAction) cancels the seated wheel first, then stands the player up — but not mid cross-table conversation, since updateSitInteraction never runs while dialogueOpen');
assert.match(game, /if \(sitInteraction\) return window\.SeatedSocialInteractions\?\.computeActionButtons\?\.\(\) \|\| \[\];/,
  'the seated action bar is computed by the seated social interactions module, not a lone Stand button');
assert.doesNotMatch(game, /return \[\{ icon: '🧍', label: 'Stand', action: 'obj_stand'/,
  'the old seated-only Stand button is fully replaced');
assert.match(game, /window\.SeatedSocialInteractions\?\.dispatchAction\?\.\(activeAction\);/,
  'useActiveAction routes seated Action 1/2/3 taps through the seated social interactions module');
assert.match(game, /function recomputeSeatedFocusWalker\(\)/,
  'a camera/reticle-based seated focus resolver exists, independent of the standing nearbyNpcWalker proximity check');
assert.match(game, /function isNpcAtPlayersTable\(walker\)/,
  'same-table detection exists for the Offer Drink flow');
assert.match(game, /if \(!sitInteraction \|\| sitInteraction\.phase !== 'active'\) \{\s*\n\s*activeCameraMode\s*=\s*npcDialogueCameraMode\(\);\s*\n\s*activeCameraTarget = walker\.root;\s*\n\s*beginNpcDialogueStaging\(walker\);\s*\n\s*\}/,
  'a seated conversation must not switch camera mode or walk the player into standing dialogue staging');

// ── authored-furniture-runtime.js exposes itemPlacements ────────────────
assert.match(authoredFurniture, /function itemPlacements\(data\)/,
  'the authored furniture runtime should expose itemPlacements instead of silently dropping them');

{
  const sandbox = {
    window: {},
    // Only Matrix4/Vector3/Quaternion need to exist — this module's
    // top-level scope constructs a handful of reusable instances, but
    // itemPlacements/seatAnchorFor (exercised below) never touch them.
    THREE: {
      Matrix4: function Matrix4() {},
      Vector3: function Vector3() {},
      Quaternion: function Quaternion() {},
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(authoredFurniture, sandbox, { filename: 'authored-furniture-runtime.js' });
  const AuthoredFurniture = sandbox.window.AuthoredFurniture;
  assert(AuthoredFurniture, 'authored furniture runtime should install itself');
  // Round-tripped through JSON below: values crossing back from the vm
  // sandbox's separate realm are not reference-equal to host-realm arrays/
  // objects even when structurally identical, which trips assert/strict's
  // deepStrictEqual — the same pattern test-alcohol-swigs-and-npc-offers.js
  // already uses for this exact reason.
  assert.deepEqual(JSON.parse(JSON.stringify(AuthoredFurniture.itemPlacements(null))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(AuthoredFurniture.itemPlacements({}))), []);
  const records = [{ id: 'p1', itemKey: 'wine', surfaceId: 's1', position: { u: 0, v: 0, normal: .015 } }];
  const out = AuthoredFurniture.itemPlacements({ itemPlacements: records });
  assert.deepEqual(JSON.parse(JSON.stringify(out)), records);
  assert.notEqual(out, records, 'itemPlacements should return a defensive copy, not the live authored array');
}

// ── alcohol-gameplay-bridge.js: inventory-wide drink search/offer ───────
{
  const documentStub = { readyState: 'loading', addEventListener() {}, getElementById() { return null; } };
  const windowStub = {
    ResourceSystem: {
      addDrunkenness() { return { blackout: false }; },
      removeAffliction() {},
      getEffectiveMax() { return 100; },
      enforceCaps() {},
    },
    FarmCrates: { init() { return this; } },
    Mounts: { init() { return this; } },
    AmbientDialogue: {
      resolveAlcoholOffer() { return { accepted: true, text: 'Gladly.' }; },
      showAlcoholOfferResponse() {},
    },
    HobunjiAlcohol: { profileForItem() { return { footing: 32, health: 14 }; } },
    addEventListener() {},
    dispatchEvent() {},
  };
  let now = 0;
  const context = {
    window: windowStub,
    document: documentStub,
    performance: { now: () => (now += 1000) },
    requestAnimationFrame() {},
    setTimeout() {},
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init?.detail; },
    console,
  };
  vm.runInNewContext(bridgeSource, context);

  const inventory = { wine: 1, mead: 2, apple: 5 };
  const itemDefs = {
    wine: { key: 'wine', label: 'Redberry Wine', icon: '🍷', tags: ['wine'], swigsPerBottle: 4 },
    mead: { key: 'mead', label: 'Kininji Mead', icon: '🍯', tags: ['mead'], swigsPerBottle: 2 },
    apple: { key: 'apple', label: 'Apple', icon: '🍎', tags: ['fruit'] },
  };
  windowStub.FarmCrates.init({
    inventory,
    calendar: { day: 1, time01: 0 },
    getHeldMode: () => 'none', // Nothing equipped/held — the seated Offer Drink flow must not require an equipped bottle.
    getActiveInventoryItem: () => null,
    getItemDef: key => itemDefs[key],
    clampInventoryStack: key => { if (inventory[key] <= 0) delete inventory[key]; },
    beginHeldDrinkAnimation: () => false,
    continueHeldDrinkAnimation() {},
    cancelHeldDrinkAnimation() {},
    abortHeldDrinkAnimation() {},
    canPlayNpcDrinkInteraction: () => true,
    playNpcDrinkInteraction: (walker, key, onDrink) => { onDrink(); return 180; },
    showToast() {}, refreshItemScroll() {}, buildInventoryGrid() {}, refreshActionBar() {}, saveMemberWorldData() {},
  });

  const bridge = windowStub.HobunjiDrunkGameplayBridge;
  assert.equal(bridge.getHeldItemAction(), null, 'nothing is equipped in this scenario');

  const bottles = bridge.findAvailableDrinkBottles();
  assert.equal(bottles.length, 2, 'only alcoholic bottles are found, and food is excluded');
  assert.deepEqual(JSON.parse(JSON.stringify(bottles.map(b => b.key).sort())), ['mead', 'wine']);

  const walker = { rec: { id: 'kzubug', name: 'Kzubug' } };
  assert.equal(bridge.offerNpcDrinkFromInventory(walker, 'mead'), true,
    'an inventory bottle can be offered without ever being equipped/held');
  assert.equal(inventory.mead, 2, 'a partial bottle stays in inventory after one swig');
  const meadStatus = bridge.getBottleSwigStatus('mead', itemDefs.mead, inventory);
  assert.equal(meadStatus.remaining, 1, 'the swig was actually consumed from the offered bottle');

  assert.equal(bridge.offerNpcDrinkFromInventory(walker, 'apple'), false,
    'a non-alcoholic item cannot be offered as a drink');
  assert.equal(bridge.offerNpcDrinkFromInventory(walker, 'nonexistent'), false,
    'an item key not present in inventory cannot be offered');
}

// ── seated-npc-interactions.js: action bar + dispatch + wheel lifecycle ──
{
  function makeDeps(overrides = {}) {
    const toasts = [];
    const dialogueOpens = [];
    const memories = [];
    let refreshCount = 0;
    const locks = [];
    return Object.assign({
      actionLocks: {
        acquire(options) {
          const handle = { released: false, options, release() { handle.released = true; } };
          locks.push(handle);
          return handle;
        },
      },
      playerParticipantId: 'player',
      isSeatedActive: () => true,
      getFocusedWalker: () => null,
      isNpcAtPlayersTable: () => false,
      hasEmptySeatAtPlayersTable: () => false,
      isNpcBlackedOut: () => false,
      openNpcDialogue: walker => dialogueOpens.push(walker),
      findAvailableDrinkBottles: () => [],
      offerDrinkToNpc: () => true,
      recordNpcMemory: (id, kind) => memories.push([id, kind]),
      refreshActionBar: () => { refreshCount++; },
      showToast: (msg, ok) => toasts.push([msg, ok]),
      log() {},
    }, overrides, { _debug: { toasts, dialogueOpens, memories, locks, refreshCount: () => refreshCount } });
  }

  function freshModule(deps) {
    // Minimal fake DOM: just enough that ensureUi/showOverlay/hideOverlay
    // can create, append, and re-find their own elements by id — the wheel
    // lifecycle assertions below need getElementById('seatedNpcWheelPanel')
    // to actually return the panel ensureUi() created.
    const byId = new Map();
    function makeElement() {
      const children = [];
      const element = {
        id: '',
        style: {},
        classList: { add() {}, remove() {}, toggle() {} },
        setAttribute() {},
        removeAttribute() {},
        addEventListener() {},
        appendChild(child) { children.push(child); if (child?.id) byId.set(child.id, child); },
        querySelector() { return null; },
      };
      Object.defineProperty(element, 'innerHTML', { get() { return ''; }, set() { children.length = 0; } });
      return element;
    }
    const documentStub = {
      createElement: makeElement,
      getElementById: id => byId.get(id) || null,
      head: makeElement(),
      body: makeElement(),
    };
    const sandbox = { window: {}, document: documentStub, console };
    vm.createContext(sandbox);
    vm.runInContext(seatedSource, sandbox, { filename: 'seated-npc-interactions.js' });
    sandbox.window.SeatedSocialInteractions.init(deps);
    return sandbox.window.SeatedSocialInteractions;
  }

  // No focus: Talk-only, generic label, no contextual button.
  {
    const deps = makeDeps();
    const mod = freshModule(deps);
    const btns = mod.computeActionButtons();
    assert.equal(btns.length, 2, 'with nothing in view: Talk + Wait, no contextual shortcut');
    assert.equal(btns[0].action, 'seated_talk');
    assert.equal(btns[0].label, 'Talk');
    assert.equal(btns[1].action, 'calendar_wait');
  }

  // Focused NPC, not at the table, no empty seat: Talk, Call Over, Wait.
  {
    const walker = { rec: { id: 'sloomi', name: 'Sloomi' } };
    const deps = makeDeps({ getFocusedWalker: () => walker });
    const mod = freshModule(deps);
    const btns = mod.computeActionButtons();
    assert.equal(btns.length, 3);
    assert.equal(btns[0].label, 'Talk: Sloomi');
    assert.equal(btns[1].action, 'seated_call_over');
    assert.equal(btns[2].action, 'calendar_wait');
  }

  // Focused NPC, not at the table, empty seat available: Ask to Sit With Me instead of Call Over.
  {
    const walker = { rec: { id: 'sloomi', name: 'Sloomi' } };
    const deps = makeDeps({ getFocusedWalker: () => walker, hasEmptySeatAtPlayersTable: () => true });
    const mod = freshModule(deps);
    const btns = mod.computeActionButtons();
    assert.equal(btns[1].action, 'seated_ask_to_sit');
  }

  // Focused NPC already at the table: no contextual Action 2 button at all.
  {
    const walker = { rec: { id: 'sloomi', name: 'Sloomi' } };
    const deps = makeDeps({ getFocusedWalker: () => walker, isNpcAtPlayersTable: () => true, hasEmptySeatAtPlayersTable: () => true });
    const mod = freshModule(deps);
    const btns = mod.computeActionButtons();
    assert.equal(btns.length, 2, 'same-table NPCs get Offer Drink on the wheel, not a redundant Action 2 shortcut');
  }

  // dispatchAction routing.
  {
    const walker = { rec: { id: 'sloomi', name: 'Sloomi' } };
    const deps = makeDeps({ getFocusedWalker: () => walker });
    const mod = freshModule(deps);
    mod.dispatchAction('seated_talk');
    assert.deepEqual(deps._debug.dialogueOpens, [walker], 'a tap talks to the focused NPC');
  }
  {
    const deps = makeDeps({ getFocusedWalker: () => null });
    const mod = freshModule(deps);
    mod.dispatchAction('seated_talk');
    assert.equal(deps._debug.toasts.length, 1, 'a tap with no one in view shows a toast instead of throwing');
    assert.equal(deps._debug.toasts[0][1], false);
  }
  {
    const walker = { rec: { id: 'sloomi', name: 'Sloomi' } };
    const deps = makeDeps({ getFocusedWalker: () => walker });
    const mod = freshModule(deps);
    mod.dispatchAction('seated_call_over');
    assert.equal(deps._debug.memories.length, 1);
    assert.equal(deps._debug.memories[0][0], 'sloomi');
  }

  // Wheel lifecycle: open acquires a lock and includes Offer Drink only when
  // the focus is genuinely at the player's table with drinks on hand.
  {
    const walker = { rec: { id: 'sloomi', name: 'Sloomi' } };
    const drinks = [{ key: 'wine', def: { label: 'Redberry Wine', icon: '🍷' }, status: { remaining: 3, total: 4 } }];
    const deps = makeDeps({ getFocusedWalker: () => walker, isNpcAtPlayersTable: () => true, findAvailableDrinkBottles: () => drinks });
    const mod = freshModule(deps);
    assert.equal(mod.isOpen(), false);
    assert.equal(mod.openWheel(), true);
    assert.equal(mod.isOpen(), true);
    assert.equal(deps._debug.locks.length, 1, 'opening the wheel acquires a movement/tools/actions lock');
    assert.equal(deps._debug.locks[0].released, false);
    assert(deps._debug.locks[0].options.participants[0].channels.includes('movement'));
    assert.equal(mod.cancel(), true, 'Dodge cancels the open wheel');
    assert.equal(mod.isOpen(), false);
    assert.equal(deps._debug.locks[0].released, true, 'cancelling releases the lock');
  }

  // Opening with no focus at all fails gracefully instead of throwing.
  {
    const deps = makeDeps({ getFocusedWalker: () => null });
    const mod = freshModule(deps);
    assert.equal(mod.openWheel(), false);
    assert.equal(mod.isOpen(), false);
  }
}

console.log('Seated social interaction control-scheme checks passed.');

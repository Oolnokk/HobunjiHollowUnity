// Friendship-gated farmhouse visitors that gift/unlock weapon shapes.
// All content/tuning lives in config/weapon-trust-visits.js; this file owns
// only the gift queue, grant, persistence, and smithing/bandit integration.
// The visitor itself (door placement, NPC clone, dialogue-end detection) is a
// DoorstepVisits provider — see js/doorstep-visits.js.
(function (global) {
  'use strict';

  const cfg = global.WEAPON_TRUST_VISIT_CONFIG;
  if (!cfg) {
    console.warn('[weapon-trust-visits] config missing; system disabled');
    return;
  }

  const IS_DIALOGUE_EDITOR = String(global.location?.pathname || '').includes('/tools/dialogue-editor');

  let craftDeps = null; // MetalCraftShop adapters; authoritative gear/smithing/save functions.
  let allSmithShapeKeys = null; // Original bronzeworks shape order before friendship gating removes entries.
  let editorObserver = null;
  const doorstep = () => global.DoorstepVisits || null; // Shared visitor runtime (js/doorstep-visits.js); absent in bare test/editor contexts.
  const patchedApis = new WeakSet();
  const banditPoolProxies = new WeakSet();

  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const giftByShape = new Map((cfg.gifts || []).map(gift => [gift.shapeKey, gift]));
  const gatedShapeKeys = new Set((cfg.gifts || []).map(gift => gift.shapeKey));
  const banditShapeKeys = new Set(cfg.bandits?.weaponShapePool || []);

  function requiredHearts(gift) {
    return Math.max(0, Number(gift?.requiredHearts ?? cfg.relationship?.requiredHearts) || 0);
  }

  function completionMemoryEvent(gift) {
    return `${cfg.visitor?.completionMemoryPrefix || 'weapon_trust_gift:'}${gift.id}`;
  }

  function originalNpcState(gift) {
    return global.DialogueContent?.getNpcDlgState?.(gift?.npcId) || null;
  }

  function relationshipHearts(gift) {
    const converter = global.NpcFavorBalance?.relationshipHeartsForNpc; // Used to keep trust thresholds expressed in authored hearts while Favor remains stored as points.
    if (typeof converter === 'function') return Number(converter(gift?.npcId)) || 0;
    return Number(originalNpcState(gift)?.favor) || 0;
  }

  function giftCompleted(gift) {
    // Check the durable owned-tool flag first (see giveGiftItem) — it's an
    // idempotent boolean in gearInventory.tools that never gets evicted.
    // The NPC memory event below is a FIFO-capped log (50 entries/NPC,
    // see DialogueContent.recordNpcMemory) that ordinary continued talking/
    // gifting with this same NPC can push the completion entry out of, so
    // it can't be the sole source of truth without an already-earned
    // weapon shape silently re-locking itself.
    const itemKey = gift && craftDeps?.craftedToolItemKey?.(gift.shapeKey, gift.giftMetalKey);
    const gear = itemKey ? craftDeps?.getGearInventory?.() : null;
    if (gear?.tools?.[itemKey]) return true;
    const state = originalNpcState(gift);
    const event = completionMemoryEvent(gift);
    return !!state?.memory?.some?.(entry => entry?.event === event);
  }

  function giftEligible(gift) {
    if (!gift || giftCompleted(gift)) return false;
    const hearts = relationshipHearts(gift); // Used to compare the live point-backed relationship against this gift's authored heart threshold.
    return hearts >= requiredHearts(gift);
  }

  function pendingGifts() {
    // Config order is intentional queue order. The first eligible incomplete
    // entry remains first until its natural dialogue end records completion.
    return (cfg.gifts || []).filter(giftEligible);
  }

  function emptyTrustConditions(gift, requireRelationship = true) {
    return {
      weekdays: [], seasons: [], weather: [], timesOfDay: [], encounter: [], maps: [], stations: [], playerSpecies: [],
      relationship: { min: requireRelationship ? requiredHearts(gift) : null, max: null },
    };
  }

  function dialogueTreeFromGift(gift) {
    // Simple visits can remain a line list. Visits that need choices, sequences,
    // or custom node topology may instead provide an ordinary Dialogue Editor
    // tree under gift.dialogueTree; the runtime adds only trust-event metadata.
    if (gift?.dialogueTree && Array.isArray(gift.dialogueTree.nodes)) {
      const tree = clone(gift.dialogueTree);
      const required = emptyTrustConditions(gift, true);
      const excluded = emptyTrustConditions(gift, false);
      tree.id = gift.dialogueTreeId;
      tree.label = gift.dialogueLabel || tree.label || `Trust Gift — ${gift.shapeKey}`;
      tree.trigger = 'weaponTrustVisit';
      tree.priority = Number.isFinite(Number(tree.priority)) ? Number(tree.priority) : 99;
      tree.visibility = tree.visibility || 'any';
      tree.conditions = {
        ...required,
        ...(tree.conditions || {}),
        relationship: { ...required.relationship, ...(tree.conditions?.relationship || {}) },
      };
      tree.excludeConditions = {
        ...excluded,
        ...(tree.excludeConditions || {}),
        relationship: { ...excluded.relationship, ...(tree.excludeConditions?.relationship || {}) },
      };
      tree.entryNode = tree.entryNode || tree.nodes[0]?.id || null;
      tree.weaponTrustGiftId = gift.id;
      tree.generatedFromWeaponTrustVisitConfig = true;
      return tree;
    }

    const lines = Array.isArray(gift.dialogueLines) && gift.dialogueLines.length
      ? gift.dialogueLines
      : ['I trust you enough that I wanted you to have this.'];
    const nodes = lines.map((text, index) => ({
      id: `${gift.dialogueTreeId}_line_${index + 1}`,
      type: 'text',
      text,
      expression: index === 0 ? 'neutral' : 'smile',
      expressionHold: 2,
      revealSpeed: 'normal',
      next: index + 1 < lines.length ? `${gift.dialogueTreeId}_line_${index + 2}` : null,
      tags: [{ type: 'weapon_trust_gift' }],
    }));
    return {
      id: gift.dialogueTreeId,
      label: gift.dialogueLabel || `Trust Gift — ${gift.shapeKey}`,
      // Runtime visitor proxies convert this to interact. Keeping a distinct
      // authored trigger makes these trees easy to find/audit in Dialogue Editor.
      trigger: 'weaponTrustVisit',
      priority: 99,
      visibility: 'any',
      conditions: emptyTrustConditions(gift, true),
      excludeConditions: emptyTrustConditions(gift, false),
      entryNode: nodes[0]?.id || null,
      nodes,
      weaponTrustGiftId: gift.id,
      generatedFromWeaponTrustVisitConfig: true,
    };
  }

  function mergeDialogueTreesIntoDatabase(database) {
    if (!database?.npcs) return database;
    for (const gift of (cfg.gifts || [])) {
      const npc = database.npcs.find(record => record?.id === gift.npcId);
      if (!npc) continue;
      if (!Array.isArray(npc.dialogueTrees)) npc.dialogueTrees = [];
      if (!npc.dialogueTrees.some(tree => tree?.id === gift.dialogueTreeId)) {
        npc.dialogueTrees.push(dialogueTreeFromGift(gift));
      }
    }
    return database;
  }

  function ensureDialogueTreesOnWalkers() {
    const walkers = doorstep()?.getScheduleDeps?.()?.npcWalkers || [];
    for (const gift of (cfg.gifts || [])) {
      const source = walkers.find(walker => !walker?._doorstepVisitor && walker?.rec?.id === gift.npcId);
      const rec = source?.rec;
      if (!rec) continue;
      if (!Array.isArray(rec.dialogueTrees)) rec.dialogueTrees = [];
      // A tree authored/exported from the Dialogue Editor wins over the
      // config-generated fallback by ID; never overwrite authored content.
      if (!rec.dialogueTrees.some(tree => tree?.id === gift.dialogueTreeId)) rec.dialogueTrees.push(dialogueTreeFromGift(gift));
    }
  }

  function removeStarterGiftItems(playerData) {
    const remove = cfg.onboarding?.removeStarterItemKeys || [];
    const gear = playerData?.gearInventory || playerData?.gear || null;
    if (!gear || !remove.length) return false;
    let changed = false;
    if (gear.tools) {
      for (const itemKey of remove) {
        if (!Object.prototype.hasOwnProperty.call(gear.tools, itemKey)) continue;
        delete gear.tools[itemKey];
        changed = true;
      }
    }
    const slots = gear.equipmentSlots || playerData?.equipmentSlots || null;
    if (slots) {
      for (const [slot, itemKey] of Object.entries(slots)) {
        if (!remove.includes(itemKey)) continue;
        slots[slot] = null;
        changed = true;
      }
    }
    return changed;
  }

  function readSaveMeta() {
    try { return JSON.parse(global.localStorage?.getItem('hobunjiSaveMeta') || 'null'); }
    catch (_) { return null; }
  }

  function isFreshlyCreatedCharacter(playerData) {
    // isNewWorld alone is insufficient: an old character can create a new
    // world and must keep gear that travels with that character. The new-
    // character path creates its character and first world together, so
    // their persisted creation timestamps are effectively identical.
    if (!playerData?.characterId || !playerData?.worldId || playerData?.isNewWorld !== true) return false;
    const meta = readSaveMeta();
    const character = meta?.characters?.find?.(entry => entry?.id === playerData.characterId);
    const world = meta?.worlds?.find?.(entry => entry?.id === playerData.worldId);
    const characterCreatedAt = Number(character?.createdAt);
    const worldCreatedAt = Number(world?.createdAt);
    const toleranceMs = Math.max(0, Number(cfg.onboarding?.newCharacterCreationToleranceMs) || 5000);
    return Number.isFinite(characterCreatedAt)
      && Number.isFinite(worldCreatedAt)
      && Math.abs(characterCreatedAt - worldCreatedAt) <= toleranceMs;
  }

  function removeStarterGiftItemsFromNewCharacter(playerData) {
    if (!isFreshlyCreatedCharacter(playerData)) return false;
    const changedLive = removeStarterGiftItems(playerData);
    const meta = readSaveMeta();
    const character = meta?.characters?.find?.(entry => entry?.id === playerData.characterId);
    const changedPersisted = removeStarterGiftItems(character ? { gearInventory: character.gearInventory } : null);
    if (changedPersisted && meta) {
      try { global.localStorage?.setItem('hobunjiSaveMeta', JSON.stringify(meta)); }
      catch (_) {}
    }
    return changedLive || changedPersisted;
  }

  function syncSmithingShapeUnlocks() {
    if (!craftDeps?.UNLOCKED_TOOL_SHAPES) return;
    if (!allSmithShapeKeys) allSmithShapeKeys = [...craftDeps.UNLOCKED_TOOL_SHAPES];
    const available = allSmithShapeKeys.filter(shapeKey => {
      if (!gatedShapeKeys.has(shapeKey)) return true;
      const gift = giftByShape.get(shapeKey);
      return gift ? giftCompleted(gift) : false;
    });
    const target = craftDeps.UNLOCKED_TOOL_SHAPES;
    if (target.length === available.length && target.every((key, index) => key === available[index])) return;
    target.splice(0, target.length, ...available);
  }

  function giveGiftItem(gift) {
    if (!gift || !craftDeps) return null;
    const itemKey = craftDeps.craftedToolItemKey?.(gift.shapeKey, gift.giftMetalKey)
      || `${gift.shapeKey}_${gift.giftMetalKey}`;
    const gear = craftDeps.getGearInventory?.();
    if (!gear) return null;
    if (!gear.tools) gear.tools = {};
    gear.tools[itemKey] = true;
    craftDeps.saveGearInventory?.();
    craftDeps.refreshMetalToolWorldTexture?.(itemKey);
    craftDeps.buildInventoryGrid?.();
    craftDeps.buildEquipmentSlots?.();
    return itemKey;
  }

  function completeGift(gift) {
    if (!gift || giftCompleted(gift)) return false;
    const itemKey = giveGiftItem(gift); // Used as the commit gate: trust completion is not persisted unless the actual weapon was granted.
    if (!itemKey) {
      global.__farmLog?.(`[weapon-trust-visits] could not complete ${gift.id}: gift item grant failed`, 'error', 'npc');
      return false;
    }
    global.DialogueContent?.recordNpcMemory?.(gift.npcId, completionMemoryEvent(gift));
    syncSmithingShapeUnlocks();
    craftDeps?.saveMemberWorldData?.();
    const itemLabel = craftDeps?.TOOL_ITEM_DEFS?.[itemKey]?.label || gift.shapeKey;
    craftDeps?.showToast?.(`🎁 ${itemLabel} received — its shape is now available at the bronzeworks.`, true);
    document.dispatchEvent(new CustomEvent('hobunji-weapon-trust-gift', {
      detail: { giftId: gift.id, npcId: gift.npcId, shapeKey: gift.shapeKey, itemKey },
    }));
    doorstep()?.dismissVisit?.(visitKey(gift), 'completed');
    return true;
  }

  // Visitor spawning, door placement, and natural-dialogue-end detection are
  // shared with every other doorstep visit and now live in js/doorstep-visits.js;
  // this module only says which gift is next and what completing it grants.
  function visitKey(gift) {
    return `weapon_trust:${gift.id}`;
  }

  function nextDoorstepVisit() {
    // If the front visitor was never completed, they remain the front of the
    // config-order queue and simply reappear on the next farmhouse exit.
    const gift = pendingGifts()[0];
    if (!gift) return null;
    return {
      key: visitKey(gift),
      npcId: gift.npcId,
      treeId: gift.dialogueTreeId,
      tree: dialogueTreeFromGift(gift),
      visitorIdPrefix: cfg.visitor?.visitorIdPrefix,
      gift,
    };
  }

  function spawnVisitor(gift) {
    if (!gift || !doorstep()) return false;
    return doorstep().spawnVisit({
      key: visitKey(gift), npcId: gift.npcId, treeId: gift.dialogueTreeId, tree: dialogueTreeFromGift(gift),
      visitorIdPrefix: cfg.visitor?.visitorIdPrefix, gift, providerId: 'weapon_trust',
    });
  }

  function removeActiveVisitor(reason) {
    if (String(doorstep()?.activeVisitKey?.() || '').startsWith('weapon_trust:')) doorstep().removeActiveVisitor(reason);
  }

  function patchMetalCraftShop(api) {
    if (!api || patchedApis.has(api)) return;
    patchedApis.add(api);
    const originalInit = api.init?.bind(api);
    if (originalInit) api.init = function weaponTrustSmithingInit(injectedDeps) {
      craftDeps = injectedDeps;
      // Preserve the original full catalog across character/world re-init.
      // After the first filter pass injectedDeps.UNLOCKED_TOOL_SHAPES is the
      // same mutable array but shorter, so resnapshotting it would permanently
      // forget every gated shape and make later friendship unlocks impossible.
      if (!allSmithShapeKeys || injectedDeps?.UNLOCKED_TOOL_SHAPES?.length > allSmithShapeKeys.length) {
        allSmithShapeKeys = [...(injectedDeps?.UNLOCKED_TOOL_SHAPES || [])];
      }
      syncSmithingShapeUnlocks();
      return originalInit(injectedDeps);
    };
  }

  function patchBanditCombat(api) {
    if (!api || patchedApis.has(api)) return;
    patchedApis.add(api);
    const originalInit = api.init?.bind(api);
    if (originalInit) api.init = function weaponTrustBanditInit(injectedDeps) {
      const held = injectedDeps?.HELD_SHAPE_DEFS;
      if (held && banditShapeKeys.size && !banditPoolProxies.has(held)) {
        const proxy = new Proxy(held, {
          ownKeys(target) {
            return Reflect.ownKeys(target).filter(key => typeof key !== 'string' || !target[key]?.slots?.includes?.('weapon') || banditShapeKeys.has(key));
          },
        });
        banditPoolProxies.add(proxy);
        injectedDeps.HELD_SHAPE_DEFS = proxy;
      }
      return originalInit(injectedDeps);
    };
  }

  function ensureDialogueEditorTriggerOption() {
    const select = document.getElementById('editTreeTrigger');
    if (!select) return;
    let option = [...select.options].find(entry => entry.value === 'weaponTrustVisit');
    if (!option) {
      option = document.createElement('option');
      option.value = 'weaponTrustVisit';
      option.textContent = 'weaponTrustVisit';
      select.appendChild(option);
    }
    const tree = typeof global.currentTree === 'function' ? global.currentTree() : null;
    if (tree?.trigger === 'weaponTrustVisit') select.value = 'weaponTrustVisit';
  }

  function installDialogueEditorSupport() {
    const start = () => {
      ensureDialogueEditorTriggerOption();
      editorObserver?.disconnect?.();
      editorObserver = new MutationObserver(ensureDialogueEditorTriggerOption);
      editorObserver.observe(document.body, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }

  global.WeaponTrustVisits = Object.freeze({
    config: cfg,
    requiredHearts,
    relationshipHearts,
    dialogueTreeFromGift,
    mergeDialogueTreesIntoDatabase,
    pendingGifts,
    giftEligible,
    giftCompleted,
    isFreshlyCreatedCharacter,
    removeStarterGiftItems,
    removeStarterGiftItemsFromNewCharacter,
    syncSmithingShapeUnlocks,
    spawnVisitor,
    removeActiveVisitor,
    completeGift,
    debugSnapshot() {
      const shared = doorstep()?.debugSnapshot?.() || {};
      const activeKey = String(shared.activeVisitKey || '');
      const activeGiftId = activeKey.startsWith('weapon_trust:') ? activeKey.slice('weapon_trust:'.length) : null;
      return {
        mode: IS_DIALOGUE_EDITOR ? 'dialogue-editor' : 'game',
        currentArea: shared.currentArea || null,
        pendingGiftIds: pendingGifts().map(gift => gift.id),
        activeGiftId,
        activeNpcId: activeGiftId ? shared.activeNpcId : null,
        activeDialogueStarted: activeGiftId ? !!shared.activeDialogueStarted : false,
        activeNaturalEndArmed: activeGiftId ? !!shared.activeNaturalEndArmed : false,
        activeSpawn: activeGiftId ? shared.activeSpawn : null,
        smithShapes: craftDeps?.UNLOCKED_TOOL_SHAPES ? [...craftDeps.UNLOCKED_TOOL_SHAPES] : null,
        configuredBanditShapes: [...banditShapeKeys],
      };
    },
  });

  if (IS_DIALOGUE_EDITOR) {
    // Editor only needs the generated-tree overlay and trigger UI. Do not run
    // the live game's frame loop or install setters for gameplay singleton APIs.
    installDialogueEditorSupport();
  } else {
    // New-character correction runs in capture phase so game/profile consumers
    // see the Fishing Mace already removed. Existing characters — including
    // those starting/joining another world — are deliberately untouched.
    document.addEventListener('hobunjiPlayerReady', event => {
      removeStarterGiftItemsFromNewCharacter(event.detail);
      setTimeout(() => { ensureDialogueTreesOnWalkers(); syncSmithingShapeUnlocks(); }, 0);
    }, { capture: true });

    const shared = doorstep();
    if (!shared) {
      console.warn('[weapon-trust-visits] DoorstepVisits missing; trust visitors disabled');
    } else {
      shared.whenApiAssigned('MetalCraftShop', patchMetalCraftShop);
      shared.whenApiAssigned('BanditCombat', patchBanditCombat);
      shared.registerProvider({
        id: 'weapon_trust',
        priority: 100,
        sync() { ensureDialogueTreesOnWalkers(); syncSmithingShapeUnlocks(); },
        next: nextDoorstepVisit,
        onComplete: visit => completeGift(visit?.gift),
      });
    }
  }
})(window);

// The Knotworked Armament: per-character Fey weapon discovery and Garanki/Jubmir dialogue.
// Progress is stored in the existing member questProgress record, not world metadata.
(() => {
  'use strict';

  const QUEST_ID = 'fey_knotworked_armament'; // Stable Quest Log/save key shared by all three handoffs.
  const TITLE = 'The Knotworked Armament'; // Displayed by TasksPanel and the acquisition toast.
  const OBJECTIVES = Object.freeze([ // Saved stage descriptions; only the current handoff appears in the Quest Log.
    'Bring the knotworked weapon to Garanki Gabu in the Northern Cliffs.',
    'Bring the knotworked weapon to Jubmir.',
    'Bring the knotworked weapon back to Garanki Gabu in the Northern Cliffs.',
  ]);
  const TREE_IDS = Object.freeze({ garankiFirst: 'fey_knot_garanki_first', jubmir: 'fey_knot_jubmir', garankiReturn: 'fey_knot_garanki_return' }); // Exact IDs used to validate completed dialogue nodes.
  const END_IDS = Object.freeze({ garankiFirst: 'fey_knot_garanki_first_end', jubmir: 'fey_knot_jubmir_end', garankiReturn: 'fey_knot_garanki_return_end' }); // Only these reached endpoints advance the saved quest.
  let inventoryDeps = null; // HarlyaoRelics' live inventory, gear, toast, and member save adapters.
  let questDeps = null; // TasksPanel's live questProgress accessor; avoids a second quest store.
  let dialogueInstalled = false; // Prevents replacing Jubmir's dialogue handler repeatedly on reinitialization.

  function profile() { return window.__hobunjiPlayerProfile || null; }
  function questStore() {
    const live = questDeps?.getQuestProgress?.();
    if (live && typeof live === 'object') return live;
    const member = profile();
    if (!member) return null;
    if (!member.questProgress || typeof member.questProgress !== 'object') member.questProgress = {};
    return member.questProgress;
  }
  function state() {
    const record = questStore()?.[QUEST_ID];
    return record && typeof record === 'object' ? record : null;
  }
  function completed() { return state()?.status === 'complete'; }

  function ownedFeyWeaponKeys() {
    const keys = new Set(); // Deduplicates bound inventory and gear references during load/migration.
    for (const [key, quantity] of Object.entries(inventoryDeps?.inventory || {})) {
      if (!(Number(quantity) > 0)) continue;
      if ((key.startsWith('feyBound_') && window.HarlyaoRelics?.decodeBoundKey?.(key)?.origin === 'Fey') ||
          (key.startsWith('captainBound_') && window.BanditCaptainArmaments?.decodeBoundKey?.(key)?.origin === 'Fey')) keys.add(key);
    }
    const gear = inventoryDeps?.getGearInventory?.();
    if (!gear) return [...keys];
    for (const [key, record] of Object.entries(gear.harlyaoRelics || {})) {
      if (record?.origin === 'Fey' && gear.tools?.[key]) keys.add(key);
    }
    const definitions = window.EnchantmentSystem?.DEFINITIONS || {}; // Also recognizes normal weapons newly bearing an independently acquired Fey enchantment.
    for (const [key, enchantments] of Object.entries(gear.weaponEnchantments || {})) {
      const weaponDef = inventoryDeps?.TOOL_ITEM_DEFS?.[key]; // Only actual owned weapon slots qualify; enchanting a hoe or other tool is not acquiring a Fey weapon.
      if (!gear.tools?.[key] || !weaponDef?.slots?.includes('weapon') || !enchantments) continue;
      const normalized = window.EnchantmentSystem?.cleanWeaponState?.(enchantments) || enchantments; // Legacy Fey IDs are migrated before the quest checks the authoritative definition list.
      const ids = [...(Array.isArray(normalized.base) ? normalized.base : []), ...Object.values(normalized.flourishes || {})];
      if (ids.some(id => definitions[id]?.alignment === 'Fey')) keys.add(key);
    }
    return [...keys];
  }
  function hasWeapon() { return ownedFeyWeaponKeys().length > 0; }
  function menuStatus() {
    const current = state(); // The Quest Log checks actual ownership rather than a readiness snapshot from the last save.
    const active = current?.status === 'active';
    const ready = active && hasWeapon(); // Selling, losing, or reacquiring the weapon changes readiness immediately.
    return {
      active, ready,
      objective: active && !ready
        ? 'Obtain another Fey-knotworked weapon, then continue your investigation.'
        : current?.progress?.objective || null,
      statusText: active && !ready
        ? 'Weapon missing — find another Fey-knotworked weapon before returning.'
        : null,
    };
  }

  function descriptor(stage) {
    return {
      kind: 'story', provider: 'feyArmament', icon: '🪢', title: TITLE,
      npcName: stage === 1 ? 'Jubmir' : 'Garanki Gabu',
      objective: OBJECTIVES[stage],
      detail: 'Keep a Fey-knotworked weapon in your possession when speaking to them.',
      ready: hasWeapon(),
    };
  }
  function persist() {
    const store = questStore(); // Keeps the profile's in-memory copy aligned with the member-scoped Quest Log.
    if (profile() && store) profile().questProgress = store;
    try {
      return inventoryDeps?.saveMemberWorldData?.() !== false; // The canonical member serializer explicitly returns false on quota/save failure.
    } catch (error) {
      console.warn('[fey-armament-quest] Could not save quest state:', error);
      return false;
    }
  }
  function notifyStarted() {
    inventoryDeps?.showToast?.('Quest started: ' + TITLE, true); // Acquisition announces the quest only after its weapon and progress are saved.
  }
  function rollbackDeferredStart() {
    const store = questStore(); // Undo only a just-created stage-zero quest if its containing relic grant failed.
    if (!store || store[QUEST_ID]?.status !== 'active' || store[QUEST_ID]?.stage !== 0) return false;
    delete store[QUEST_ID];
    if (profile()) profile().questProgress = store;
    return true;
  }
  function maybeStart(options = {}) {
    const store = questStore();
    if (!store || store[QUEST_ID] || !hasWeapon()) return false;
    store[QUEST_ID] = { status: 'active', stage: 0, progress: descriptor(0) };
    if (options.deferSave === true) {
      if (profile()) profile().questProgress = store; // The acquisition path saves the weapon and quest in one member write.
    } else if (!persist()) {
      delete store[QUEST_ID]; // A rejected save must not create an in-memory-only quest unlock.
      if (profile()) profile().questProgress = store;
      inventoryDeps?.showToast?.('Could not save The Knotworked Armament. Your weapon was kept; try again after saving.', false);
      return false;
    }
    if (options.silent !== true) notifyStarted();
    return true;
  }
  function syncFromInventory() {
    if (!inventoryDeps || !profile()) return false;
    return maybeStart(); // Legacy Fey items start the quest once, after the player and gear have finished restoring.
  }
  function advance(expectedStage) {
    const current = state();
    if (current?.status !== 'active' || current.stage !== expectedStage || !hasWeapon()) return false;
    const next = expectedStage + 1;
    const store = questStore();
    store[QUEST_ID] = next >= OBJECTIVES.length
      ? { status: 'complete', stage: next, progress: { ...current.progress, objective: 'Garanki will now handle Fey enchantments, reluctantly and for twice his usual fee.', ready: false } }
      : { status: 'active', stage: next, progress: descriptor(next) };
    if (!persist()) {
      store[QUEST_ID] = current; // Preserve the last saved stage; never unlock Fey services without a durable quest completion.
      if (profile()) profile().questProgress = store;
      inventoryDeps?.showToast?.('Quest progress could not be saved. Speak to them again to retry.', false);
      return false;
    }
    inventoryDeps?.showToast?.(next >= OBJECTIVES.length ? 'Quest completed: ' + TITLE + ' — Fey services unlocked!' : 'Quest updated: ' + OBJECTIVES[next], true);
    window.TasksPanel?.render?.();
    window.HarlyaoRelics?.render?.();
    return true;
  }

  function garankiFirstTree() {
    return {
      id: TREE_IDS.garankiFirst, trigger: 'interact', priority: 130, entryNode: 'knot_g1',
      nodes: [
        { id: 'knot_g1', type: 'text', text: "I'm afraid this one isn't actually enchanted. It's lovely, but all decoration. Even I can't help but feel like it's enchanted too, but I know better.", next: 'knot_g2' },
        { id: 'knot_g2', type: 'text', text: "The glow is clearly some sort of bioluminescent substance, but it's unfamiliar to me. I don't think it was produced by any local specimen.", next: 'knot_g3' },
        { id: 'knot_g3', type: 'text', text: "And the knotwork engravings are quite intricate. I think I've seen these kinds of patterns in books on the Slagothim.", next: 'knot_g4' },
        { id: 'knot_g4', type: 'text', text: "Perhaps you should show it to that trader who often visits the village. Jubmir, I think his name was.", next: 'knot_g5' },
        { id: 'knot_g5', type: 'text', text: "If there's any cultural significance to it, he might know, but a foreign artifact is not of much interest to me in my current line of research.", next: END_IDS.garankiFirst },
        { id: END_IDS.garankiFirst, type: 'end' },
      ],
    };
  }
  function jubmirTree() {
    return {
      id: TREE_IDS.jubmir, trigger: 'interact', priority: 130, entryNode: 'knot_j1',
      nodes: [
        { id: 'knot_j1', type: 'text', text: "Oh wow, this is quite a weapon. I'd bet my hat that this is Fey-blessed.", next: 'knot_j_question' },
        { id: 'knot_j_question', type: 'choice', text: 'What do you ask Jubmir?', choices: [
          { label: 'Fey-blessed?', next: 'knot_j2' },
        ] },
        { id: 'knot_j2', type: 'text', text: "Fey-blessed, as in it's instilled with Fey magic. See the knot-like patterns carved into the handle? That's Fey-knot, the language of the Fey.", next: 'knot_j3' },
        { id: 'knot_j3', type: 'text', text: "On something like this, it's like the glyphs carved into the metal parts of an enchanted weapon. It's like a contract, except instead of being with some scary thing from another world, it's with one of the many Fey who live alongside us, hidden from our eyes.", next: 'knot_j4' },
        { id: 'knot_j4', type: 'text', text: "Part of some Fey's power flows through those etches, giving the whole weapon some form of magical ability, though I wouldn't begin to know what.", next: 'knot_j5' },
        { id: 'knot_j5', type: 'text', text: "Unfortunately, like most magical weapons, this one is bound to its previous owner. You'll need to break that bond. Ask Professor Gabu, up in the Northern Cliffs.", next: 'knot_j_reply' },
        { id: 'knot_j_reply', type: 'choice', text: 'What do you tell Jubmir?', choices: [
          { label: "I showed him, and he told me it wasn't magical.", next: 'knot_j6' },
        ] },
        { id: 'knot_j6', type: 'text', text: "Ah, right, I keep forgetting. Despite their vast knowledge and generally open minds, most mainland scholars have somehow managed to convince themselves that the Fey do not exist.", next: 'knot_j7' },
        { id: 'knot_j7', type: 'text', text: "Their reasoning is incomprehensible to me. Something about mushrooms and swamp gas that doesn't even begin to explain away any of my experiences.", next: 'knot_j8' },
        { id: 'knot_j8', type: 'text', text: "If you want this unbound, you just need him to play along. Tell him to pretend that it's enchanted, and do what he would normally do with the weapon if it was.", next: END_IDS.jubmir },
        { id: END_IDS.jubmir, type: 'end' },
      ],
    };
  }
  function garankiReturnTree() {
    return {
      id: TREE_IDS.garankiReturn, trigger: 'interact', priority: 130, entryNode: 'knot_r1',
      nodes: [
        { id: 'knot_r1', type: 'text', text: 'So what did the Slagothim say?', next: 'knot_r_reply' },
        { id: 'knot_r_reply', type: 'choice', text: 'What do you tell Garanki?', choices: [
          { label: 'He says it is enchanted with Fey magic, but you would need to unbind it.', next: 'knot_r2' },
        ] },
        { id: 'knot_r2', type: 'text', text: "Ugh. As I told you last time, this weapon is not enchanted, and as I told you when we first met, Fey are not real.", next: 'knot_r3' },
        { id: 'knot_r3', type: 'text', text: "They are, at their most tangible, vivid hallucinations. I'm sorry, but I can't waste my time on such a thing. There's nothing to learn from tampering with it, and it won't make it any more effective.", next: 'knot_r4' },
        { id: 'knot_r4', type: 'text', text: "But I'll tell you what. If you're still convinced that the weapon is anything more than simply ornate, I'll go through the unbinding process with it, as if it were an actual magic item.", next: 'knot_r5' },
        { id: 'knot_r5', type: 'text', text: "But it would cost you double, as I'd be wasting valuable time I could be using for study and research into real, actual things.", next: END_IDS.garankiReturn },
        { id: END_IDS.garankiReturn, type: 'end' },
      ],
    };
  }

  function dialogueTreeFor(npcId) {
    const current = state();
    if (current?.status !== 'active' || !hasWeapon()) return null;
    if (npcId === 'garanki_gabu' && current.stage === 0) return garankiFirstTree();
    if (npcId === 'jubmir' && current.stage === 1) return jubmirTree();
    if (npcId === 'garanki_gabu' && current.stage === 2) return garankiReturnTree();
    return null;
  }
  function onDialogueNode(node, context) {
    if (node?.type !== 'end' || !context?.tree) return false;
    const id = context.tree.id;
    if (context.npc?.id === 'garanki_gabu' && id === TREE_IDS.garankiFirst && node.id === END_IDS.garankiFirst) return advance(0);
    if (context.npc?.id === 'jubmir' && id === TREE_IDS.jubmir && node.id === END_IDS.jubmir) return advance(1);
    if (context.npc?.id === 'garanki_gabu' && id === TREE_IDS.garankiReturn && node.id === END_IDS.garankiReturn) return advance(2);
    return false;
  }
  function installDialogueHooks() {
    if (dialogueInstalled || !window.DialogueContent?.registerContextProvider || !window.DialogueContent?.registerNodeEnterHandler) return false;
    dialogueInstalled = true;
    window.NpcDialogueEntryRouter?.registerPriorityProvider?.(QUEST_ID, rec => !!dialogueTreeFor(rec?.id)); // Urgent Fey handoffs precede Jubmir's Wares/Chat shortcut and ordinary procedural offers.
    window.DialogueContent.registerContextProvider(QUEST_ID, {
      treeFor(rec) { return rec?.id === 'jubmir' ? dialogueTreeFor('jubmir') : null; },
    }); // Context routing preserves Jubmir's normal trading/dialogue without replacing an existing tree provider.
    window.DialogueContent.registerNodeEnterHandler('jubmir', onDialogueNode);
    return true;
  }
  function bindInventoryDeps(deps) {
    inventoryDeps = deps; // Called from the same init that configures the real Fey bound-relic source.
    installDialogueHooks();
  }
  function bindQuestDeps(deps) {
    questDeps = deps; // Ensures the quest writes the exact store the Tasks panel renders.
    installDialogueHooks();
  }
  function debugSnapshot() {
    const current = state();
    return { questId: QUEST_ID, status: current?.status || 'not-started', stage: current?.stage ?? null,
      objective: current?.progress?.objective || null, ownedWeapons: ownedFeyWeaponKeys(), unlocked: completed(),
      dialogueInstalled, inventoryBound: !!inventoryDeps, questStoreBound: !!questDeps };
  }

  window.FeyArmamentQuest = Object.freeze({
    QUEST_ID, TITLE, OBJECTIVES, bindInventoryDeps, bindQuestDeps, maybeStart, syncFromInventory,
    completed, hasWeapon, menuStatus, ownedFeyWeaponKeys, dialogueTreeFor, onDialogueNode, debugSnapshot,
    notifyStarted, rollbackDeferredStart, // Used only to commit/rollback a newly granted bound relic's shared member save.
  });
  document.addEventListener('hobunjiPlayerReady', () => {
    window.setTimeout(() => { syncFromInventory(); }, 0); // Wait for member inventory + equipment restoration before legacy detection.
  });
  window.DevCompanion?.registerStateProvider?.('feyArmamentQuest', debugSnapshot);
})();

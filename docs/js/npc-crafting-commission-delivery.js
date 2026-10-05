(() => {
  'use strict';

  if (Number(window.NpcCraftingCommissionDelivery?.version) >= 2) return;

  const VERSION = 2; // Loader/debug version for acceptance, validation, and completion of crafting commissions.
  let taskDeps = null; // Procedural task/inventory/save dependencies supplied by the runtime adapter.
  let giftingDeps = null; // NPC-record and pack-clothing dependencies supplied by the runtime adapter.
  let lastError = null; // Latest delivery failure for mobile diagnostics.
  let lastTurnIn = null; // Latest successful commission completion for mobile diagnostics.

  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  function setDeps(next = {}) {
    if (next.taskDeps) taskDeps = next.taskDeps;
    if (next.giftingDeps) giftingDeps = next.giftingDeps;
  }

  function npcRecord(npcId) {
    return giftingDeps?.getNpcRecordById?.(npcId)
      || taskDeps?.getNpcRecordById?.(npcId)
      || (taskDeps?.npcWalkers || []).find(walker => walker?.rec?.id === npcId)?.rec
      || null;
  }

  function acceptedPatch(task) {
    const commission = clone(task?.commission) || null; // Commission state augmented at the exact offered→available transition.
    if (!commission) return {};
    commission.startedAt = Date.now();
    if (commission.type === 'furniture') commission.startingOwned = Math.max(0, finite(taskDeps?.inventory?.[commission.furnitureKey], 0)); // Prevents old furniture from satisfying a newly accepted job.
    return { commission };
  }

  function revealRecipientPreferences(task) {
    const commission = task?.commission;
    if (commission?.type !== 'clothing' || !commission.recipientId || !commission.disclosedTraits?.length || !window.NpcGifting) return;
    const recipient = npcRecord(commission.recipientId); // Canonical recipient used to reject stale no-longer-liked quest traits.
    const canonicalLiked = new Set(window.NpcCraftingCommissionGenerator?.likedColors?.(recipient) || []);
    const disclosed = commission.disclosedTraits.filter(trait => canonicalLiked.has(trait));
    if (!disclosed.length) return;
    const snapshot = window.NpcGifting.serializeDiscoveredPrefs?.() || {}; // Existing learned gift-preference persistence shape.
    const bucket = snapshot[commission.recipientId] || { loved: [], liked: [], disliked: [], hated: [] }; // Recipient knowledge created by the commission introduction.
    bucket.liked = [...new Set([...(bucket.liked || []), ...disclosed])];
    snapshot[commission.recipientId] = bucket;
    window.NpcGifting.restoreDiscoveredPrefs?.(snapshot);
    window.DialogueContent?.getNpcDlgState?.(commission.recipientId); // Ensures relationship state exists.
    window.DialogueContent?.recordNpcMemory?.(commission.recipientId, 'commission_color_preferences_shared'); // Makes recipient + disclosed liked colors immediately visible in Relationships.
    taskDeps?.saveMemberWorldData?.();
    window.RelationshipsPanel?.render?.();
  }

  function grantFurnitureBlueprint(task) {
    const commission = task?.commission;
    if (commission?.type !== 'furniture' || !commission.blueprintKey || !taskDeps?.inventory) return;
    const before = Math.max(0, finite(taskDeps.inventory[commission.blueprintKey], 0)); // Existing permanent blueprint ownership remains intact.
    taskDeps.inventory[commission.blueprintKey] = Math.max(1, before);
    taskDeps.buildInventoryGrid?.();
    window.CraftingPanel?.render?.();
    taskDeps.saveMemberWorldData?.();
    if (before < 1) taskDeps.showToast?.(`📐 ${commission.furnitureLabel} blueprint added for the commission.`, true);
  }

  function onAccepted(taskId) {
    const task = taskDeps?.getQuestProgress?.()?.[taskId]?.progress; // Persisted accepted task after timestamp/baseline was saved.
    if (task?.commission?.type === 'furniture') grantFurnitureBlueprint(task);
    if (task?.commission?.type === 'clothing') revealRecipientPreferences(task);
  }

  function dyeTraits(colorLike) {
    const hsv = window.ItemTraits?.resolveHsv?.(colorLike); // Exact displayed dye-color resolver shared with NPC gifting.
    return hsv ? (window.ItemTraits?.colorTraitsForHsv?.(hsv) || []) : [];
  }

  function colorMatches(colorLike, requiredTraits) {
    if (!colorLike) return false;
    const actual = new Set(dyeTraits(colorLike)); // Literal hue/hot-muted/bright-dark traits of one garment dye channel.
    return (requiredTraits || []).every(trait => actual.has(trait));
  }

  function hasPattern(item) {
    return !!window.ClothingWeavingSystem?.__test?.weavingHasAnyPattern?.(item?.weaving); // Canonical woven-pattern check, excluding trim-only decoration.
  }

  function matchingClothing(task) {
    const commission = task?.commission;
    if (commission?.type !== 'clothing') return null;
    const startedAt = finite(commission.startedAt, 0); // Acceptance timestamp excluding stockpiled garments.
    const pack = giftingDeps?.getPackClothing?.() || taskDeps?.getPackClothing?.() || [];
    return pack.find(item => {
      const baseId = item?.baseCosmeticId || String(item?.cosmeticId || '').split('::crafted::')[0]; // Authored article identity despite unique crafted ids.
      if (baseId !== commission.articleId || String(item?.weaveMaterial || '') !== commission.material) return false;
      if (startedAt && finite(item?.craftedAt, 0) < startedAt) return false;
      if (!!commission.patterned !== hasPattern(item)) return false;
      for (const slot of commission.dyeSlots || []) {
        const color = slot.key === 'B' ? item.colorB : slot.key === 'C' ? item.colorC : item.colorA; // Exact primary/secondary/pattern channel requested.
        if (!colorMatches(color, slot.traits)) return false;
      }
      return true;
    }) || null;
  }

  function furnitureReady(task) {
    const commission = task?.commission;
    if (commission?.type !== 'furniture') return false;
    const current = Math.max(0, finite(taskDeps?.inventory?.[commission.furnitureKey], 0)); // Current crafted-piece stack.
    const baseline = Math.max(0, finite(commission.startingOwned, 0)); // Stack recorded before the free blueprint was granted.
    return current > baseline;
  }

  function isReady(task) {
    return task?.commission?.type === 'clothing' ? !!matchingClothing(task) : furnitureReady(task);
  }

  function consumeDeliverable(task) {
    const commission = task?.commission;
    if (commission?.type === 'furniture') {
      if (!furnitureReady(task)) return false;
      taskDeps.inventory[commission.furnitureKey] = Math.max(0, finite(taskDeps.inventory[commission.furnitureKey], 0) - 1);
      taskDeps.clampInventoryStack?.(commission.furnitureKey);
      return true;
    }
    if (commission?.type !== 'clothing') return false;
    const item = matchingClothing(task); // Exact newly-crafted garment satisfying all article/material/pattern/dye requirements.
    if (!item) return false;
    const offerClothing = window.NpcWardrobe?.offerClothing; // Canonical wardrobe mutation required before the player's literal garment can be removed.
    if (typeof offerClothing !== 'function') {
      lastError = 'NpcWardrobe.offerClothing unavailable during commission turn-in';
      return false;
    }
    const verdict = offerClothing(commission.recipientId, item); // Delivers the commission as a real gift into the recipient's wardrobe.
    if (verdict?.accepted === false) {
      lastError = `recipient rejected matched garment: ${commission.recipientId}`;
      return false;
    }
    const pack = giftingDeps?.getPackClothing?.() || taskDeps?.getPackClothing?.() || [];
    const nextPack = pack.filter(entry => entry?.uid !== item.uid); // Removes only the literal delivered garment.
    if (giftingDeps?.setPackClothing) giftingDeps.setPackClothing(nextPack);
    else if (taskDeps?.setPackClothing) taskDeps.setPackClothing(nextPack);
    else {
      const index = pack.findIndex(entry => entry?.uid === item.uid);
      if (index >= 0) pack.splice(index, 1);
    }
    giftingDeps?.buildPackClothingSection?.();
    taskDeps?.buildPackClothingSection?.();
    return true;
  }

  function requirementText(task) {
    const commission = task?.commission;
    if (!commission) return '';
    if (commission.type === 'furniture') return `Craft 1 ${commission.furnitureLabel} from the supplied blueprint${furnitureReady(task) ? ' — ready' : ''}.`;
    const material = commission.material === 'heavy' ? 'Heavy' : 'Light'; // Player-facing weight description.
    const patterned = commission.patterned ? 'patterned ' : ''; // Player-facing woven-pattern qualifier.
    const dyes = window.NpcCraftingCommissionGenerator?.formatDyeSlots?.(commission) || ''; // Same requirements shown in the original ask line.
    return `${material} ${patterned}${commission.articleLabel} for ${commission.recipientName}. ${dyes}${isReady(task) ? ' — ready' : ''}`;
  }

  function complete(taskId) {
    const state = taskDeps?.getQuestProgress?.()?.[taskId]; // Live accepted commission state before any rewards/consumption.
    const task = state?.progress;
    if (!task?.commission || state.status !== 'available' || !isReady(task)) return { ok: false, message: `The commission is not ready: ${requirementText(task)}` };

    const mastery = window.CraftingMasterySystem; // World-scoped Mote authority every successful crafting commission must use.
    const moteReward = Math.max(1, Math.floor(finite(task.rewardMotes || task.commission.rewardMotes, 1)));
    const masteryDebug = mastery?.debugSnapshot?.(); // Preflight world availability before touching the literal deliverable.
    if (!mastery?.awardMotes || !mastery?.saveState || !mastery?.getState || !masteryDebug?.worldId) {
      lastError = 'Crafting mastery world state unavailable during commission turn-in';
      return { ok: false, message: 'This world’s Motes of Craft could not be accessed, so the commission was not consumed.' };
    }

    const masteryBefore = mastery.getState(); // Transaction rollback snapshot if real delivery fails after the Mote save.
    const motes = mastery.awardMotes(moteReward, `commission:${taskId}`, { silent: true });
    if (motes !== moteReward) {
      lastError = `Mote award failed: expected ${moteReward}, got ${motes}`;
      return { ok: false, message: 'Motes of Craft could not be saved, so the commission was not consumed.' };
    }
    if (!consumeDeliverable(task)) {
      mastery.saveState(masteryBefore); // Roll back the world currency if furniture/wardrobe mutation cannot complete.
      mastery.renderPanel?.();
      return { ok: false, message: 'That crafted piece could not be turned in.' };
    }

    const paidGold = Math.max(0, Math.round(finite(task.rewardGold, 0))); // Ordinary payment remains alongside crafting progression.
    taskDeps.inventory.gold = finite(taskDeps.inventory.gold, 0) + paidGold;
    window.DialogueContent?.adjustNpcFavor?.(task.npcId, finite(task.rewardFriendship, 0), 'task_crafting_commission');
    taskDeps.setQuestStatus(taskId, 'completed', {});
    taskDeps.buildInventoryGrid?.();
    taskDeps.saveMemberWorldData?.();
    window.WorldPopupText?.queueReward?.('craft', `+${motes} Mote${motes === 1 ? '' : 's'} of Craft`); // Only announce after the literal delivery has committed.
    taskDeps.showToast?.(`✅ Commission complete! +${paidGold}g, +${motes} Mote${motes === 1 ? '' : 's'} of Craft.`, true);
    lastTurnIn = { taskId, motes, at: Date.now(), commission: clone(task.commission) };
    return { ok: true, message: 'Commission turned in.' };
  }

  function debugSnapshot() {
    const active = Object.entries(taskDeps?.getQuestProgress?.() || {})
      .filter(([, state]) => !!state?.progress?.commission && ['offered', 'available'].includes(state.status))
      .map(([id, state]) => ({ id, status: state.status, npcId: state.progress.npcId, ready: state.status === 'available' ? isReady(state.progress) : false, requirement: requirementText(state.progress), rewardMotes: state.progress.rewardMotes })); // Mobile-readable readiness diagnostics.
    return { version: VERSION, active, lastTurnIn: clone(lastTurnIn), lastError };
  }

  window.NpcCraftingCommissionDelivery = Object.freeze({
    version: VERSION, setDeps, acceptedPatch, onAccepted, isReady, matchingClothing,
    colorMatches, furnitureReady, requirementText, complete, debugSnapshot,
  });
})();

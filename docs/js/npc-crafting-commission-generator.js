(() => {
  'use strict';

  if (Number(window.NpcCraftingCommissionGenerator?.version) >= 2) return;

  const VERSION = 2; // Loader/debug version for crafting-commission generation.
  const HUES = Object.freeze(['hueRed', 'hueOrange', 'hueYellow', 'hueGreen', 'hueBlue', 'hueIndigo', 'hueViolet']); // Existing gifting hue traits eligible for dye requests.
  const SATURATION = Object.freeze(['hot', 'muted']); // Existing gifting saturation traits eligible for dye requests.
  const VALUE = Object.freeze(['bright', 'dark']); // Existing gifting value traits eligible for dye requests.
  const COLORS = new Set([...HUES, ...SATURATION, ...VALUE]); // Fast filter for canonical NPC liked-color traits.

  // NPC role/work vocabulary -> furniture that makes sense for that job. A
  // furniture commission is not generated at all when the live blueprint
  // catalog has no relevant piece for this NPC, rather than falling back to a
  // random unrelated furnishing.
  const ROLE_RULES = Object.freeze([
    [/inn|tavern|waitress|shopkeep|merchant|festival|bard/i, ['chair', 'table', 'bench', 'stool', 'shelf', 'storage', 'barrel', 'cabinet', 'sign', 'lantern', 'smokehouse', 'dryer']],
    [/farm|ranch|grower|gardener|crop|husband/i, ['storage', 'crate', 'barrel', 'processing', 'churn', 'mill', 'silo', 'bin', 'table', 'bench', 'compost', 'incubator', 'smokehouse', 'dryer']],
    [/carpenter|woodcutter|builder/i, ['bench', 'table', 'shelf', 'storage', 'cabinet', 'crate', 'chair', 'stool', 'rack']],
    [/smith|bonehewer|mining|miner/i, ['bench', 'storage', 'crate', 'rack', 'table', 'cabinet', 'brazier', 'furnace']],
    [/priest|eldress|hag|temple|spirit/i, ['bench', 'brazier', 'lantern', 'altar', 'pedestal', 'table', 'chair', 'decor']],
    [/watch|guard|hunter|war|chief|leader|bowyer|soldier/i, ['rack', 'storage', 'crate', 'bench', 'table', 'chair', 'lantern']],
    [/potion|alchemy|researcher|snow-watcher|scholar/i, ['shelf', 'cabinet', 'table', 'storage', 'brazier', 'churn', 'processing']],
    [/fish|fisher/i, ['barrel', 'crate', 'storage', 'bench', 'table', 'rack', 'smokehouse', 'dryer']],
    [/cook|kitchen|food|butcher|smoker/i, ['table', 'storage', 'shelf', 'barrel', 'churn', 'processing', 'smokehouse', 'dryer']],
  ]);

  let taskDeps = null; // Procedural task/inventory dependencies supplied by the runtime adapter.
  let craftingDeps = null; // Crafting catalog dependencies supplied by the runtime adapter.
  let giftingDeps = null; // NPC-record dependencies supplied by the runtime adapter.
  let clothingProfiles = []; // Learned loom articles plus actual secondary-dye support.
  let profileRefresh = null; // In-flight profile refresh preventing duplicate cosmetic metadata scans.
  let lastGenerated = null; // Latest generated commission snapshot for mobile diagnostics.
  let lastError = null; // Latest generation/profile failure for mobile diagnostics.

  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const pick = list => Array.isArray(list) && list.length ? list[Math.min(list.length - 1, Math.floor(Math.random() * list.length))] : null;

  function setDeps(next = {}) {
    if (next.taskDeps) taskDeps = next.taskDeps;
    if (next.craftingDeps) craftingDeps = next.craftingDeps;
    if (next.giftingDeps) giftingDeps = next.giftingDeps;
    if (next.taskDeps || next.giftingDeps) void refreshClothingProfiles();
  }

  function npcRecord(npcId) {
    return giftingDeps?.getNpcRecordById?.(npcId)
      || taskDeps?.getNpcRecordById?.(npcId)
      || (taskDeps?.npcWalkers || []).find(walker => walker?.rec?.id === npcId)?.rec
      || null;
  }

  function relatedRecipientIds(giverId) {
    const relationships = window.SCRATCHBONES_CONFIG?.game?.socialRelationships?.relationships || []; // Authored family/friend/partner graph shared by social systems.
    const ids = new Set(); // Dedupes people who share multiple direct relationship tags with the giver.
    for (const relation of relationships) {
      if (!['partner', 'family', 'friend'].includes(relation?.type) || !relation.members?.includes?.(giverId)) continue;
      relation.members.forEach(id => { if (id && id !== giverId) ids.add(id); });
    }
    return [...ids].filter(id => !!npcRecord(id));
  }

  function likedColors(recipient) {
    return [...new Set((recipient?.gifts?.liked || []).filter(trait => COLORS.has(trait)))]; // Canonical positive clothing-color traits the NPC gifting system already uses.
  }

  function usableDyesFor(likedTraits) {
    const liked = new Set(likedTraits || []); // NPC's authored preferences; used to prevent impossible commission colors.
    window.DyeSystem?.ensureCollection?.(); // The loom initializes starter dyes this way before displaying a palette.
    return (window.DyeSystem?.getCatalog?.() || [])
      .filter(dye => window.DyeSystem?.owns?.(dye.id))
      .map(dye => ({ dye, traits: window.ItemTraits?.colorTraitsForHsv?.(window.ItemTraits?.resolveHsv?.(dye)) || [] }))
      .filter(entry => entry.traits.some(trait => HUES.includes(trait) && liked.has(trait))); // A craftable dye must satisfy at least one preferred hue.
  }

  function colorRequirement(likedTraits) {
    const liked = new Set(likedTraits || []); // Only the recipient's genuinely liked traits may become requirements.
    const dye = pick(usableDyesFor(likedTraits)); // Choose a real unlocked swatch before specifying AND-ed hue/saturation/value requirements.
    if (!dye) return null;
    const hue = dye.traits.find(trait => HUES.includes(trait) && liked.has(trait));
    if (!hue) return null;
    const saturation = dye.traits.find(trait => SATURATION.includes(trait) && liked.has(trait));
    const value = dye.traits.find(trait => VALUE.includes(trait) && liked.has(trait));
    return [hue, ...(saturation ? [saturation] : []), ...(value ? [value] : [])]; // The selected dye itself witnesses that all requested traits are satisfiable.
  }

  async function refreshClothingProfiles() {
    if (profileRefresh) return profileRefresh;
    profileRefresh = (async () => {
      const blueprints = window.ClothingWeavingSystem?.debugSnapshot?.().blueprints || []; // Loom templates this character has actually learned.
      const next = [];
      for (const blueprint of blueprints) {
        const probe = { baseCosmeticId: blueprint.id, cosmeticId: blueprint.id, slot: blueprint.slot }; // Minimal descriptor for palette-aware dye-slot detection.
        let hasSecondary = false;
        try { hasSecondary = !!await window.ClothingWeavingSystem?.hasSecondaryDyeForItem?.(probe); }
        catch (error) { lastError = `profile:${blueprint.id}: ${String(error?.message || error)}`; }
        next.push({ id: blueprint.id, slot: blueprint.slot, label: blueprint.label || blueprint.id, hasSecondary });
      }
      clothingProfiles = next;
      return next;
    })().finally(() => { profileRefresh = null; });
    return profileRefresh;
  }

  function generateClothing(giver, tier) {
    const recipients = relatedRecipientIds(giver.id)
      .map(npcRecord)
      .filter(recipient => usableDyesFor(likedColors(recipient)).length > 0); // Never offer a recipient whose liked colors cannot be woven from already unlocked dyes.
    const recipient = pick(recipients); // Random member of the giver's authored family/friend group.
    const article = pick(clothingProfiles); // Random learned loom article the player can actually make.
    if (!recipient || !article) return null;

    const liked = likedColors(recipient); // Recipient's real authored positive wearable-color traits.
    const primary = colorRequirement(liked);
    if (!primary) return null;
    const patterned = (window.PatternLibrary?.listAvailable?.() || []).length > 0 && Math.random() < Math.min(0.55, 0.25 + tier * 0.06); // Sometimes asks for a woven pattern when the player knows one.
    const material = Math.random() < Math.min(0.65, 0.30 + tier * 0.07) ? 'heavy' : 'light'; // Both light/heavy cloth commissions occur.
    const dyeSlots = [{ key: 'A', label: 'Primary', traits: primary }]; // Literal item channels used by delivery validation.
    if (article.hasSecondary) dyeSlots.push({ key: 'B', label: 'Secondary', traits: colorRequirement(liked) || primary });
    if (patterned) dyeSlots.push({ key: 'C', label: 'Pattern', traits: colorRequirement(liked) || primary });

    return {
      type: 'clothing', articleId: article.id, articleLabel: article.label, slot: article.slot, material, patterned, dyeSlots,
      recipientId: recipient.id, recipientName: recipient.name || recipient.id,
      disclosedTraits: [...new Set(dyeSlots.flatMap(slot => slot.traits).filter(trait => liked.includes(trait)))],
      rewardMotes: patterned ? 3 : 2,
      rewardGold: 80 + (material === 'heavy' ? 24 : 0) + (patterned ? 36 : 0) + (article.hasSecondary ? 16 : 0), // Scaled with the crop/fishing economy so a dyed, woven commission out-earns selling its inputs.
    };
  }

  function giverRoleText(giver) {
    return [giver?.role, giver?.homeId, giver?.workBuildingId, giver?.scheduleHooks?.workBuildingId, ...(giver?.tags || [])].filter(Boolean).join(' '); // Work location/tags fill gaps in terse authored role labels.
  }

  function furnitureScore(giver, blueprint) {
    const roleText = giverRoleText(giver);
    const matchedRules = ROLE_RULES.filter(([rolePattern]) => rolePattern.test(roleText)); // Only role rules that actually describe this NPC can make a piece eligible.
    if (!matchedRules.length) return 0;
    const haystack = `${blueprint?.name || ''} ${blueprint?.category || ''} ${blueprint?.desc || ''}`.toLowerCase(); // Searchable live blueprint metadata.
    let score = 0;
    for (const [, terms] of matchedRules) for (const term of terms) if (haystack.includes(term)) score += 4;
    if (blueprint?.category === 'decorative' && /artist|bard|festival|priest|temple|spirit/i.test(roleText)) score += 3;
    if (blueprint?.category === 'processing' && /farm|inn|cook|food|potion|alchemy|fish|smok/i.test(roleText)) score += 3;
    return score;
  }

  function furnitureMaterialValue(craftCost) {
    return Object.entries(craftCost || {}).reduce((sum, [key, amount]) => {
      const definition = craftingDeps?.ITEM_DEFS?.[key]; // Reads the current economy price for each actual consumed resource.
      const unitValue = key === 'wood' ? Math.max(3, finite(craftingDeps?.ITEM_DEFS?.pineLog?.sellPrice), finite(craftingDeps?.ITEM_DEFS?.shadewoodLog?.sellPrice))
        : Math.max(3, finite(definition?.sellPrice)); // Missing catalog entries never make labor or metal effectively free.
      return sum + Math.max(0, finite(amount)) * unitValue;
    }, 0);
  }

  function rewardQuote(task) {
    const commission = task?.commission; // Same saved commission record used by offers, quest log, and turn-in.
    if (!commission) return null;
    const tier = Math.max(0, Math.min(5, Math.floor(finite(task.tier, 0)))); // Difficulty/reputation bonus is bounded by the existing tier scale.
    let goldFloor = 0; // Minimum payment covering materials, crafting labor, and special requests.
    let favorFloor = 6; // Favor is measured in points: 40 points equal one complete heart.
    let moteFloor = 2; // Crafting progression reward grows with the amount of work.
    if (commission.type === 'furniture') {
      const blueprint = (craftingDeps?.FURNITURE_BLUEPRINT_CATALOG || []).find(bp => bp.key === commission.blueprintKey); // Uses the actual recipe cost, not a guessed generic furniture tier.
      const cost = blueprint?.craftCost || {};
      const value = furnitureMaterialValue(cost); // Reuses the same wood/wool/bar pricing as new furniture commissions.
      const ingredients = Object.entries(cost).filter(([, count]) => finite(count) > 0).length; // Handling several resource families takes additional work.
      goldFloor = Math.round(105 + value * 1.65 + ingredients * 12 + tier * 9);
      favorFloor += Math.min(4, Math.floor(value / 140)) + (ingredients >= 3 ? 1 : 0);
      moteFloor += Math.min(3, Math.floor(value / 170)) + (ingredients >= 3 ? 1 : 0);
    } else if (commission.type === 'clothing') {
      const woolKey = commission.material === 'heavy' ? 'puktukWool' : 'lightWool'; // Same source material keys as the ordinary loom.
      const units = window.ClothingWeavingSystem?.woolCostForSlot?.(commission.slot) || 1; // Actual authored garment coverage, including large overwear.
      const woolPrice = Math.max(6, finite(craftingDeps?.ITEM_DEFS?.[woolKey]?.sellPrice)); // Defensive estimate if the inventory definitions are not initialized yet.
      const dyeChannels = Math.max(1, commission.dyeSlots?.length || 1); // Each precisely matched dye channel adds selection and pattern labor.
      const heavy = commission.material === 'heavy' ? 1 : 0; // Heavy yarn is harder to gather and process.
      const patterned = commission.patterned ? 1 : 0; // Woven patterns take another authoring step.
      goldFloor = Math.round(75 + 2 * units * woolPrice + 25 * dyeChannels + 12 * (units - 1) + 25 * heavy + 45 * patterned + tier * 10);
      favorFloor += heavy + patterned * 2 + (dyeChannels > 1 ? 1 : 0);
      moteFloor += heavy + patterned + (dyeChannels > 2 ? 1 : 0);
    } else return null;
    return {
      gold: Math.max(Math.round(finite(task.rewardGold)), Math.round(finite(commission.rewardGold)), goldFloor),
      favor: Math.max(finite(task.rewardFriendship), 6 + Math.floor(tier / 2), favorFloor + Math.floor(tier / 2)),
      motes: Math.max(1, Math.floor(finite(task.rewardMotes)), Math.floor(finite(commission.rewardMotes)), moteFloor),
    }; // Never reduces the promised rewards of old world saves.
  }

  function generateFurniture(giver) {
    const catalog = (craftingDeps?.FURNITURE_BLUEPRINT_CATALOG || []).filter(entry => entry?.key && entry?.furnitureKey && entry?.name && entry?.craftCost && !entry?.moteOnly && !entry?.masteryUnlockId); // Only ordinary reusable blueprints can be granted free; Crafting Mastery/Mote unlocks such as Advanced Loom must keep their progression gate.
    if (!catalog.length) return null;
    const ranked = catalog.map(entry => ({ entry, score: furnitureScore(giver, entry) })).filter(record => record.score > 0).sort((a, b) => b.score - a.score);
    if (!ranked.length) return null; // Never ask this NPC for a role-irrelevant random object.
    const best = ranked[0].score;
    const blueprint = pick(ranked.filter(record => record.score >= best - 2))?.entry;
    if (!blueprint) return null;
    const materialValue = furnitureMaterialValue(blueprint.craftCost); // Canonical valuation shared with the payout quote.
    return { type: 'furniture', blueprintKey: blueprint.key, furnitureKey: blueprint.furnitureKey, furnitureLabel: blueprint.name, category: blueprint.category || 'furniture', rewardMotes: 2, rewardGold: 70 + Math.round(materialValue * 1.5) }; // Pays more than selling the authored materials it consumes.
  }

  function generateTask(giver, tier) {
    if (!giver?.id || !taskDeps?.setQuestStatus) return null;
    const canClothing = clothingProfiles.length > 0 && relatedRecipientIds(giver.id).length > 0; // Personalized clothing needs a social recipient and learned loom article.
    const clothingFirst = canClothing && Math.random() < 0.58;
    const commission = (clothingFirst ? generateClothing(giver, tier) : generateFurniture(giver))
      || (clothingFirst ? generateFurniture(giver) : (canClothing ? generateClothing(giver, tier) : null));
    if (!commission) return null;
    const id = window.ProceduralTasks?.makeTaskId?.() || `craft_task_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`; // Existing task-id format where available.
    const task = {
      kind: 'favor', npcId: giver.id, npcName: giver.name || 'A neighbor', domain: 'crafting', items: [],
      rewardGold: commission.rewardGold, rewardFriendship: 1 + Math.min(3, tier) * 0.5,
      rewardMotes: commission.rewardMotes, tier, postedDay: taskDeps.calendar?.day, deadlineDay: null, bonusMultiplier: 1, commission,
    };
    const reward = rewardQuote(task); // One authoritative quote for newly generated and preexisting saved commissions.
    if (reward) {
      task.rewardGold = reward.gold;
      task.rewardFriendship = reward.favor;
      task.rewardMotes = reward.motes;
    }
    taskDeps.setQuestStatus(id, 'offered', task);
    lastGenerated = { id, ...clone(task) };
    return { id, ...task };
  }

  function traitLabel(traitId) {
    return window.ItemTraits?.getTraitLabel?.(traitId) || String(traitId || '').replace(/^hue/, '');
  }

  function formatDyeSlots(commission) {
    return (commission?.dyeSlots || []).map(slot => `${slot.label}: ${(slot.traits || []).map(traitLabel).join(' · ')}`).join('; ');
  }

  function askLine(task) {
    const commission = task?.commission;
    if (commission?.type === 'furniture') return `Actually — I could use a hand with something for my work. Could you build me a ${commission.furnitureLabel}? I'll give you the blueprint, so you won't be out the plan itself.`;
    if (commission?.type !== 'clothing') return null;
    const material = commission.material === 'heavy' ? 'heavy' : 'light';
    const patterned = commission.patterned ? ' patterned' : '';
    const preferences = (commission.disclosedTraits || []).map(traitLabel).join(', '); // Explicit recipient tastes that enter Relationships at acceptance.
    return `Actually — I want to give ${commission.recipientName} something. Could you weave a ${material}${patterned} ${commission.articleLabel} for them? They like ${preferences || 'those colors'}. For the dyes, I need ${formatDyeSlots(commission)}.`;
  }

  function debugSnapshot() {
    return { version: VERSION, clothingProfiles: clone(clothingProfiles), lastGenerated: clone(lastGenerated), lastError };
  }

  window.NpcCraftingCommissionGenerator = Object.freeze({
    version: VERSION, setDeps, refreshClothingProfiles, relatedRecipientIds, likedColors,
    generateTask, askLine, formatDyeSlots, furnitureScore, rewardQuote, debugSnapshot,
    __test: Object.freeze({ colorRequirement, usableDyesFor }), // Regression hooks for proving every color constraint has a real unlocked swatch.
  });
})();

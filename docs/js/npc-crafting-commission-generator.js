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

  function colorRequirement(likedTraits) {
    const liked = new Set(likedTraits || []); // Recipient color tastes available for one dye slot.
    const hue = pick(HUES.filter(trait => liked.has(trait))); // Required hue category for this slot.
    if (!hue) return null;
    const traits = [hue];
    const saturation = pick(SATURATION.filter(trait => liked.has(trait))); // Hot/muted requirement when the recipient has one authored as liked.
    const value = pick(VALUE.filter(trait => liked.has(trait))); // Bright/dark requirement when the recipient has one authored as liked.
    if (saturation) traits.push(saturation);
    if (value) traits.push(value);
    return traits;
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
      .filter(recipient => likedColors(recipient).some(trait => HUES.includes(trait))); // Every candidate has a real positive hue preference to commission around.
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
      rewardGold: 40 + (material === 'heavy' ? 12 : 0) + (patterned ? 18 : 0) + (article.hasSecondary ? 8 : 0),
    };
  }

  function giverRoleText(giver) {
    return [giver?.role, giver?.scheduleHooks?.workBuildingId, ...(giver?.tags || [])].filter(Boolean).join(' '); // Work location/tags fill gaps in terse authored role labels.
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

  function generateFurniture(giver) {
    const catalog = (craftingDeps?.FURNITURE_BLUEPRINT_CATALOG || []).filter(entry => entry?.key && entry?.furnitureKey && entry?.name && entry?.craftCost); // Only real reusable-blueprint furniture can be requested.
    if (!catalog.length) return null;
    const ranked = catalog.map(entry => ({ entry, score: furnitureScore(giver, entry) })).filter(record => record.score > 0).sort((a, b) => b.score - a.score);
    if (!ranked.length) return null; // Never ask this NPC for a role-irrelevant random object.
    const best = ranked[0].score;
    const blueprint = pick(ranked.filter(record => record.score >= best - 2))?.entry;
    if (!blueprint) return null;
    const materialValue = finite(blueprint.craftCost?.wood) * 3 + finite(blueprint.craftCost?.stone) * 3; // Generic gold scaling for larger pieces.
    return { type: 'furniture', blueprintKey: blueprint.key, furnitureKey: blueprint.furnitureKey, furnitureLabel: blueprint.name, category: blueprint.category || 'furniture', rewardMotes: 2, rewardGold: 35 + Math.round(materialValue * 0.6) };
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
    generateTask, askLine, formatDyeSlots, furnitureScore, debugSnapshot,
  });
})();

// Boney Shinjimi's repeatable moonlit encounter rewards.
// Uses museum artifacts, Fey-origin bound weapons through the existing relic/unbinding owner, and gear trinkets.
(() => {
  'use strict';
  const HAT_COSMETIC = 'appearance::hat::old_highlands_kasa'; // Newly authored front/back kasa sprites, registered in cosmetics index.
  const HAT_ITEM_KEY = 'cosmetic:' + HAT_COSMETIC; // Editor catalog key only; wearable articles live in Pack clothing.
  const SLOT_IDS = ['tap1', 'tap2', 'hold1', 'hold2']; // Fallback until the live Combat loadout is initialized.
  const random = () => window.GameRandom?.random?.() ?? Math.random();

  function pick(array, rng = random) {
    if (!array.length) return null;
    return array[Math.min(array.length - 1, Math.floor(Math.max(0, rng()) * array.length))];
  }

  function artifactChoice(donated = [], rng = random) {
    const catalog = window.ArtifactCollection?.ARTIFACTS || {};
    const entries = Object.entries(catalog).map(([key, def]) => ({ key, ...def }));
    const missing = entries.filter(entry => !donated.includes(entry.key));
    if (missing.length) return pick(missing, rng); // Prioritize completing Garanki's collection over vendor value.
    if (!entries.length) return null;
    const sortedPrices = entries.map(entry => Number(entry.sellPrice) || 0).sort((a, b) => b - a);
    const minimum = sortedPrices[Math.max(0, Math.floor((sortedPrices.length - 1) / 4))]; // Highest-priced quartile when fully donated.
    return pick(entries.filter(entry => entry.sellPrice >= minimum), rng);
  }

  function lockedEnchantments() {
    const es = window.EnchantmentSystem;
    const defs = Object.values(es?.DEFINITIONS || {}).filter(def => def.alignment === 'Fey'); // Boney teaches only Fey illusions, never Harlyao ruin enchantments.
    const slots = window.Combat?.loadout?.SLOT_IDS || SLOT_IDS;
    const missing = [];
    for (const def of defs) {
      if (def.type === 'Base' && (!es.isBaseUnlocked?.(def.id)||(es.formulaLevel&&es.formulaLevel(def.id)<5))) missing.push({ kind: 'base', id: def.id });
      if (def.type === 'Flourish') {
        for (const slotId of slots) {
          if (!es.isFlourishUnlocked?.(def.id, slotId)||(es.formulaLevel&&es.formulaLevel(def.id)<5)) missing.push({ kind: 'flourish', id: def.id, slotId });
        }
      }
    }
    return missing;
  }

  function relicWithUnlearnedEnchantment(rng = random) {
    const candidates = lockedEnchantments();
    if (!candidates.length || !window.HarlyaoRelics?.makeFeyRelic) return null;
    const relic = window.HarlyaoRelics.makeFeyRelic(); // Dagger, dagger-sword, fishing spear or hatchet; all random Fey-origin enchantments.
    if (!relic?.enchantments) return null;
    const missing = pick(candidates, rng);
    if (missing.kind === 'base') {
      const limit = Math.max(1, Number(window.EnchantmentSystem?.BASE_LIMIT) || 2);
      relic.enchantments.base = [missing.id, ...(relic.enchantments.base || []).filter(id => id !== missing.id)].slice(0, limit);
    } else {
      relic.enchantments.flourishes ||= {};
      relic.enchantments.flourishes[missing.slotId] = missing.id;
    }
    const es=window.EnchantmentSystem; // Boney continues supplying missing research after all eligible slots are learned.
    const known=es?.formulaIds?.(missing.id)||[];
    const available=[1,2,3,4,5].filter(n=>!known.includes(n));
    if(available.length)(relic.enchantments.formulas||={})[missing.id]=pick(available,rng);
    return relic;
  }

  function chooseTrinket(rng = random) {
    const trinkets = window.TrinketSystem;
    const catalog = trinkets?.DEFINITIONS || {};
    const all = Object.keys(catalog);
    const owned = new Set((trinkets?.ownedEntries?.() || []).map(entry => entry.id));
    return pick(all.filter(id => !owned.has(id)).length ? all.filter(id => !owned.has(id)) : all, rng);
  }

  function giveInventory(deps, key, label) {
    if (!key || !deps?.inventory) return null;
    deps.inventory[key] = (Math.max(0, Number(deps.inventory[key]) || 0) | 0) + 1;
    deps.saveMemberWorldData?.();
    deps.buildInventoryGrid?.();
    deps.showToast?.('Boney Shinjimi gave you ' + label + '.', true);
    return { kind: 'item', key, label };
  }

  function grant(kind, deps, rng = random) {
    if (!deps?.inventory || !['valuable', 'useful', 'apologize', 'hat', 'milk'].includes(kind)) return null;
    if (kind === 'hat') {
      const grant = window.EquipmentPanel?.grantPackClothing; // Actual Pack/Gear clothing owner, not numeric inventory.
      if (typeof grant !== 'function') return null;
      const item = grant({
        uid: 'citem_boney_' + Date.now().toString(36) + '_' + Math.floor(random() * 0x10000000).toString(36),
        cosmeticId: HAT_COSMETIC, slot: 'hat',
        label: 'Old Highlands Kasa', baseLabel: 'Old Highlands Kasa',
        description: "Boney Shinjimi's well-traveled Highland kasa.",
        sprite: window.EquipmentPanel.clothingSpriteForCosmetic?.(HAT_COSMETIC)
          || 'assets/cosmetics/clothes/hat/oldhighlandskasa-front.png',
        sellPrice: 25,
      });
      if (!item) return null;
      deps.showToast?.('Boney Shinjimi gave you his Old Highlands Kasa! Find it in Pack clothing.', true);
      return { kind: 'clothing', uid: item.uid, cosmeticId: HAT_COSMETIC, label: item.label };
    }
    if (kind === 'valuable') {
      const worldId = deps.tothalWorldId?.();
      const donated = window.WorldMetaStore?.loadArtifactCollection?.(worldId)?.donated || [];
      const choice = artifactChoice(donated, rng);
      return choice ? giveInventory(deps, choice.key, choice.label) : null;
    }
    const relic = relicWithUnlearnedEnchantment(rng) || (kind === 'milk' ? window.HarlyaoRelics?.makeFeyRelic?.() : null); // Milk always pays a Fey weapon; ordinary Useful retains its trinket fallback.
    if (relic) {
      const key = window.HarlyaoRelics?.grantBoundRelic?.(relic); // Bound and unusable until Garanki unbinds it; unlocks remain untouched.
      if (key) {
        deps.showToast?.('Boney Shinjimi gave you a Fey-touched bound weapon, full of illusions.', true);
        return { kind: 'boundRelic', origin: 'Fey', shape: relic.shape, key, label: 'Fey-touched bound weapon', enchantments: relic.enchantments };
      }
      return null; // Never swap an ungrantable weapon for some accidental second prize.
    }
    if (kind === 'milk') return null; // Never silently replace the promised milk-for-weapon exchange with a trinket.
    const id = chooseTrinket(rng); // All Fey enchantments learned: unowned trinket, or any trinket when all are owned.
    const uid = id && window.TrinketSystem?.grant?.(id, 'boney-shinjimi');
    if (!uid) return null;
    const label = window.TrinketSystem?.DEFINITIONS?.[id]?.displayName || id;
    deps.showToast?.('Boney Shinjimi gave you ' + label + '.', true);
    return { kind: 'trinket', id, uid, label };
  }

  window.BoneyShinjimiRewards = Object.freeze({
    grant, artifactChoice, lockedEnchantments, relicWithUnlearnedEnchantment, chooseTrinket,
    HAT_ITEM_KEY, HAT_COSMETIC,
  });
})();

(() => {
  'use strict';

  if (Number(window.ClothingWeavingNpcCompat?.version) >= 1) return;

  const PLAYER_COSMETIC_ID_KEY = '__loomPlayerCosmeticId'; // Preserves a crafted garment's unique player-side id while an NPC uses its authored base cosmetic id.

  function baseCosmeticId(instance) {
    return instance?.baseCosmeticId || instance?.cosmeticId || null;
  }

  function patchItemTraits(api) {
    if (!api?.computeItemTraits || api.computeItemTraits.__clothingWeavingBaseCosmetic) return;
    const original = api.computeItemTraits.bind(api); // Existing trait composition remains authoritative; only the lookup key changes for crafted copies.
    const wrapped = function clothingWeavingItemTraits(key, instance, ...rest) {
      const resolvedKey = instance?.baseCosmeticId || key;
      return original(resolvedKey, instance, ...rest);
    };
    wrapped.__clothingWeavingBaseCosmetic = true;
    api.computeItemTraits = wrapped;
  }

  function npcSafeInstance(instance) {
    if (!instance?.baseCosmeticId || instance.cosmeticId === instance.baseCosmeticId) return instance;
    return {
      ...instance,
      [PLAYER_COSMETIC_ID_KEY]: instance.cosmeticId,
      cosmeticId: instance.baseCosmeticId,
    };
  }

  function restorePlayerCosmeticId(item) {
    if (!item?.[PLAYER_COSMETIC_ID_KEY]) return false;
    item.cosmeticId = item[PLAYER_COSMETIC_ID_KEY];
    delete item[PLAYER_COSMETIC_ID_KEY];
    return true;
  }

  function patchNpcWardrobe(api) {
    if (!api?.offerClothing || api.__clothingWeavingNpcCompat) return;

    const originalOffer = api.offerClothing.bind(api); // NPC wardrobe should judge/render the authored garment, not the unique player inventory id.
    api.offerClothing = function clothingWeavingOfferClothing(npcId, instance) {
      return originalOffer(npcId, npcSafeInstance(instance));
    };

    if (typeof api.takeFromWardrobe === 'function') {
      const originalTake = api.takeFromWardrobe.bind(api); // Existing wardrobe transfer remains authoritative; the unique player id is restored afterward.
      api.takeFromWardrobe = function clothingWeavingTakeFromWardrobe(npcId, uid) {
        const beforeGear = window.Combat?.deps?.gearInventory?.()
          || window.Combat?.deps?.getGearInventory?.()
          || null;
        const beforeUids = new Set((beforeGear?.clothingItems || []).map(item => item?.uid).filter(Boolean));
        const storedItem = api.getWardrobeContents?.(npcId)?.stored?.find(item => item?.uid === uid) || null;
        const playerCosmeticId = storedItem?.[PLAYER_COSMETIC_ID_KEY] || null;
        const result = originalTake(npcId, uid);
        if (!result || !playerCosmeticId) return result;

        const gear = window.Combat?.deps?.gearInventory?.()
          || window.Combat?.deps?.getGearInventory?.()
          || beforeGear;
        const restored = (gear?.clothingItems || []).find(item => !beforeUids.has(item?.uid)
          && item?.[PLAYER_COSMETIC_ID_KEY] === playerCosmeticId);
        if (restored && restorePlayerCosmeticId(restored)) {
          window.Combat?.deps?.saveGearInventory?.();
        }
        return result;
      };
    }

    api.__clothingWeavingNpcCompat = true;
  }

  function futureGlobal(name, patch) {
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    const current = descriptor?.get ? descriptor.get.call(window) : descriptor?.value;
    if (current) patch(current);
    if (descriptor && descriptor.configurable === false) return;
    if (descriptor?.get || descriptor?.set) {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get() { return descriptor.get ? descriptor.get.call(window) : current; },
        set(value) {
          descriptor.set?.call(window, value);
          patch(descriptor.get ? descriptor.get.call(window) : value);
        },
      });
      return;
    }
    let value = current;
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: descriptor?.enumerable !== false,
      get() { return value; },
      set(next) { value = next; patch(next); },
    });
  }

  window.ClothingWeavingNpcCompat = Object.freeze({
    version: 1,
    npcSafeInstance,
    restorePlayerCosmeticId,
    baseCosmeticId,
  });

  futureGlobal('ItemTraits', patchItemTraits);
  futureGlobal('NpcWardrobe', patchNpcWardrobe);
})();

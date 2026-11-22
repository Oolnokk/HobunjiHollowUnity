(() => {
  'use strict';
  if (window.HeldGiftPolicy) return;
  const STALE_HOLD = Symbol('stale-held-gift'); // Signals game.js to clear a no-longer-owned manual Hold without changing game state here.

  // Shared read-only eligibility for both contextual Gift prompts and actual transfers.
  function resolve({ heldMode, burdenHeld, festivalHeld, instrumentHeld, manualHeldItem,
    clothingVisual, visibleItem, packClothing, inventory, itemDefs, isClothingGiftable } = {}) {
    if (heldMode !== 'item' || burdenHeld || festivalHeld || instrumentHeld) return null;
    if (manualHeldItem?.kind === 'clothing') {
      const article = packClothing?.find(item => item?.uid === manualHeldItem.uid); // Pack ownership, not permanent Gear ownership.
      if (!article || !isClothingGiftable?.({ kind: 'clothing', instance: article })) return STALE_HOLD;
      if (clothingVisual?.key !== 'pack-clothing:' + article.uid || visibleItem !== clothingVisual) return null;
      return { kind: 'clothing', instance: article };
    }
    if (manualHeldItem?.kind === 'bagItem') {
      const key = manualHeldItem.key; // InventoryHeldOverride must already have moved this item into the visible hand slot.
      if (!key || (Number(inventory?.[key]) || 0) <= 0) return STALE_HOLD;
      if (visibleItem?.key !== key) return null;
      return { kind: 'bagItem', key, def: itemDefs?.[key] };
    }
    const key = visibleItem?.key; // A wheel item qualifies only when it is the visible selection and still owned.
    if (!key || (Number(inventory?.[key]) || 0) <= 0) return null;
    return { kind: 'bagItem', key, def: itemDefs?.[key] };
  }

  // Prepare the held PNG once on Hold, using the existing clothing compositor and normal hand plane.
  // Async composition cannot repaint a different garment or a stowed hand.
  function createClothingVisual(article, { getSprite, compose, isCurrent, onError } = {}) {
    if (!article?.uid) return null;
    const sprite = article.sprite || getSprite?.(article.cosmeticId) || null; // Authored fallback until the woven/dyed artwork finishes.
    const visual = {
      kind: 'packClothingVisual', key: 'pack-clothing:' + article.uid, icon: '👘',
      heldSpritePath: sprite, heldSpriteVersion: 0, // A changed version rebuilds the normal held plane once.
    };
    try {
      const pending = compose?.(article, sprite); // Existing compositor handles all variants; no parallel asset pipeline.
      if (pending && typeof pending.then === 'function') {
        pending.then(path => {
          if (!path || !isCurrent?.(visual) || path === visual.heldSpritePath) return;
          visual.heldSpritePath = path;
          visual.heldSpriteVersion++;
        }).catch(error => onError?.(error));
      }
    } catch (error) { onError?.(error); }
    return visual;
  }

  window.HeldGiftPolicy = Object.freeze({
    STALE_HOLD, resolve, createClothingVisual,
    inspect: state => { // On-demand mobile diagnostics; never polled in the game or render frame.
      const result = resolve(state);
      return {
        heldMode: state?.heldMode || 'none',
        manualKind: state?.manualHeldItem?.kind || null,
        visibleKey: state?.visibleItem?.key || null,
        burdenHeld: !!state?.burdenHeld, festivalHeld: !!state?.festivalHeld,
        instrumentHeld: !!state?.instrumentHeld,
        giftKey: result && result !== STALE_HOLD ? result.key || result.instance?.uid || null : null,
        staleManualHold: result === STALE_HOLD,
      };
    },
  });
})();

(() => {
  'use strict';

  // Creature sprite ground anchoring, extracted out of game.js (same
  // window.<Namespace> pattern as the other extractions; no closure state).
  // spriteUrl -> resolved bottom-opacity ratio (0..1, see planeOffset), or a
  // Set of pending callbacks while the very first scan of that species' idle
  // sprite is still loading.
  const cache = new Map();
  window.HobunjiCacheAudit?.register('game.creatureGroundAnchorCache', () => cache.size);
  const FULL_OPAQUE_ALPHA_THRESHOLD = 254; // scanOpaqueVerticalBounds uses >, so 254 selects only alpha 255 pixels.

  // Scans a species' idle sprite (cached per URL, so only the first
  // creature of each species actually pays for it) for how far down its
  // fully opaque pixels extend. All these sprites are nominally
  // 1375×600, but if the art itself doesn't reach the canvas's bottom
  // edge (transparent padding), anchoring on the raw rectangle leaves
  // the visible creature hovering above the ground/its own shadow.
  // Using alpha 255 deliberately ignores antialiased fringe pixels that
  // would otherwise make the apparent foot line vary with faint padding.
  function resolveRatio(spriteUrl, onReady) {
    const cached = cache.get(spriteUrl);
    if (typeof cached === 'number') { onReady(cached); return; }
    if (cached instanceof Set) { cached.add(onReady); return; }
    const waiters = new Set([onReady]);
    cache.set(spriteUrl, waiters);
    const finish = (ratio) => {
      cache.set(spriteUrl, ratio);
      waiters.forEach(fn => fn(ratio));
    };
    const img = new Image();
    img.onload = () => {
      const bounds = window.PNGPlaneAvatar?.scanOpaqueVerticalBoundsOfImage?.(img, FULL_OPAQUE_ALPHA_THRESHOLD);
      finish(bounds ? (bounds.bottom + 1) / img.naturalHeight : 1);
    };
    img.onerror = () => finish(1);
    img.src = spriteUrl;
  }

  // The prism (avatarRef.group — see updateCreatureMesh's "Prism (group)
  // tracks the raw aim angle..." comment) keeps its true, unpadded size:
  // its floor is local Y = -halfH exactly as CREATURE_DB's modelWidth/
  // modelHeight define it, which is what places it correctly at surfY
  // and is what any future hitbox/collision use of that size would
  // expect. The correction belongs on the PLANE meshes themselves
  // (children of the prism), not on the prism's own placement: shifting
  // them down by the padding's share of modelHeight moves the art's
  // real opaque bottom onto the prism's actual floor without changing
  // the prism's own footprint at all. bottomRatio=1 (no padding) gives
  // an offset of 0 — the plane stays exactly where it started.
  function planeOffset(modelHeight, bottomRatio) {
    return -modelHeight * (1 - bottomRatio);
  }

  window.CreatureGroundAnchor = { resolveRatio, planeOffset };
})();

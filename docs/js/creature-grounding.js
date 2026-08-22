(() => {
  'use strict';

  // Creature sprite grounding refinement.
  //
  // PNGPlaneAvatar's generic scanOpaqueVerticalBoundsOfImage() deliberately
  // reports the single lowest qualifying pixel anywhere in an image. That is
  // useful as a raw image bound, but it is too literal for creature feet: a
  // tail tip, hanging fur, or isolated opaque speck below the actual paw line
  // can become the "ground" pixel and leave every real foot visibly hovering.
  //
  // This module installs before png-plane-avatar.js and wraps that public image
  // scan the moment PNGPlaneAvatar is assigned. The wrapper keeps the original
  // top bound and alpha threshold, but replaces a sparse bottom fringe with the
  // lowest coherent contact row. Size scaling remains downstream exactly where
  // it belongs: game.js/farm-animals.js convert this normalized row into local
  // plane space, and the final group Y scale then scales that correction along
  // with the animal.

  const WRAP_MARK = '__hobunjiCoherentCreatureGroundingV1';
  const SIDE_INSET_FRACTION = 0.075; // Ignores extreme silhouette edges where tails/decorative fringe usually live.
  const MIN_CONTACT_ROW_FRACTION = 0.012; // Reuses the coherent-row density already proven by the avatar neck scan.
  const MAX_UPWARD_SEARCH_FRACTION = 0.08; // Safety cap: never reinterpret more than the lowest 8% of the sprite as fringe.

  function install(api) {
    if (!api || typeof api.scanOpaqueVerticalBoundsOfImage !== 'function') return false;
    if (api.scanOpaqueVerticalBoundsOfImage[WRAP_MARK]) return true;

    const rawScan = api.scanOpaqueVerticalBoundsOfImage.bind(api);

    function scanCoherentGroundContact(image, alphaThreshold) {
      const rawBounds = rawScan(image, alphaThreshold);
      if (!rawBounds) return rawBounds;

      const width = image?.naturalWidth || image?.width || 0;
      const height = image?.naturalHeight || image?.height || 0;
      if (!width || !height) return rawBounds;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      let data;
      try {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0, width, height);
        data = ctx.getImageData(0, 0, width, height).data;
      } catch (_) {
        return rawBounds;
      }

      const threshold = alphaThreshold ?? 8;
      let left = width, right = -1;
      for (let y = rawBounds.top; y <= rawBounds.bottom; y++) {
        const rowOffset = y * width * 4;
        for (let x = 0; x < width; x++) {
          if (data[rowOffset + x * 4 + 3] <= threshold) continue;
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
      if (right < left) return rawBounds;

      const opaqueSpan = Math.max(1, right - left + 1);
      const sideInset = Math.floor(opaqueSpan * SIDE_INSET_FRACTION); // Used below to reject edge-only tail/fringe contact.
      const scanLeft = Math.min(right, left + sideInset);
      const scanRight = Math.max(scanLeft, right - sideInset);
      const coherentSpan = Math.max(1, scanRight - scanLeft + 1);
      const minimumRowPixels = Math.max(2, Math.round(coherentSpan * MIN_CONTACT_ROW_FRACTION)); // Used to distinguish a real paw/contact row from isolated low pixels.
      const maxRise = Math.max(2, Math.round(height * MAX_UPWARD_SEARCH_FRACTION));
      const searchTop = Math.max(rawBounds.top, rawBounds.bottom - maxRise);

      let coherentBottom = rawBounds.bottom;
      let found = false;
      for (let y = rawBounds.bottom; y >= searchTop; y--) {
        const rowOffset = y * width * 4;
        let count = 0;
        for (let x = scanLeft; x <= scanRight; x++) {
          if (data[rowOffset + x * 4 + 3] > threshold) count++;
        }
        if (count < minimumRowPixels) continue;
        coherentBottom = y;
        found = true;
        break;
      }

      // If the lowest 8% contains no coherent contact at all, the art may
      // genuinely have a very narrow foot. Preserve the original bound rather
      // than risking a large automatic correction that could bury the sprite.
      if (!found || coherentBottom === rawBounds.bottom) return rawBounds;

      window.__farmLog?.(
        `[creature-ground] ignored sparse low fringe: row ${rawBounds.bottom} -> coherent contact ${coherentBottom} of ${height}`,
        'wildlife',
        'world',
      );
      return {
        ...rawBounds,
        bottom: coherentBottom,
        rawBottom: rawBounds.bottom,
        coherentBottom,
        groundingRule: 'coherent-contact-row-v1',
      };
    }

    scanCoherentGroundContact[WRAP_MARK] = true;
    scanCoherentGroundContact.rawScan = rawScan;
    api.scanOpaqueVerticalBoundsOfImage = scanCoherentGroundContact;
    return true;
  }

  let pngPlaneAvatar = window.PNGPlaneAvatar;
  if (install(pngPlaneAvatar)) return;

  // debug.js loads before png-plane-avatar.js. Intercept that one later global
  // assignment so the grounding rule is already installed before game.js does
  // its first creature/livestock opacity scan; afterwards this behaves like an
  // ordinary writable global and also wraps any deliberate hot replacement.
  Object.defineProperty(window, 'PNGPlaneAvatar', {
    configurable: true,
    enumerable: true,
    get() { return pngPlaneAvatar; },
    set(value) {
      pngPlaneAvatar = value;
      install(value);
    },
  });
})();

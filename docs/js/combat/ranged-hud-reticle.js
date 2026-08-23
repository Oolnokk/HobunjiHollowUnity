(() => {
  'use strict';

  const RETICLE_URL = 'assets/hud/hud_reticle.png'; // Used by the centered crossbow HUD sight.
  const CROSSBOW_KEYS = new Set(['crossbow', 'scatterbow']); // Used to keep the sight limited to the two current crossbow-family ranged weapons.
  const RETICLE_WIDTH_PX = 75; // Used to preserve the authored hud_reticle.png pixel dimensions exactly.
  const RETICLE_HEIGHT_PX = 71; // Used to preserve the authored hud_reticle.png pixel dimensions exactly.

  let reticleEl = null; // Used to reuse one HUD element instead of recreating it as equipment changes.
  let frameRequest = 0; // Used to keep the visibility check synchronized with rendered equipment state.
  let lastEquippedKey = null; // Used by the mobile-friendly debug snapshot and to avoid redundant DOM writes.
  let lastVisible = false; // Used to avoid rewriting display state every animation frame.

  function equippedRangedKey() {
    return window.RangedWeapons?.equippedRangedKey?.() || null;
  }

  function isCrossbowKey(itemKey) {
    return CROSSBOW_KEYS.has(String(itemKey || '').toLowerCase());
  }

  function ensureReticle() {
    if (reticleEl?.isConnected) return reticleEl;
    const host = document.getElementById('canvasWrap');
    if (!host) return null;

    const image = document.createElement('img'); // Used as a HUD-only overlay anchored to the exact rendered game viewport.
    image.id = 'rangedHudReticle';
    image.src = RETICLE_URL;
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    Object.assign(image.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: `${RETICLE_WIDTH_PX}px`,
      height: `${RETICLE_HEIGHT_PX}px`,
      transform: 'translate(-50%, -50%)',
      objectFit: 'contain',
      pointerEvents: 'none',
      userSelect: 'none',
      WebkitUserDrag: 'none',
      zIndex: '4',
      display: 'none',
      filter: 'brightness(0) invert(1)',
    });
    image.addEventListener('error', () => console.error(`Ranged HUD reticle failed to load: ${RETICLE_URL}`));
    host.appendChild(image);
    reticleEl = image;
    return reticleEl;
  }

  function refresh() {
    const image = ensureReticle();
    if (!image) return false;

    const itemKey = equippedRangedKey(); // Uses the ranged subsystem's canonical equipped-slot lookup rather than inferring from inventory/UI state.
    const visible = isCrossbowKey(itemKey);
    if (itemKey !== lastEquippedKey) {
      image.dataset.equippedRanged = itemKey || '';
      lastEquippedKey = itemKey;
    }
    if (visible !== lastVisible || image.style.display === '') {
      image.style.display = visible ? 'block' : 'none';
      lastVisible = visible;
    }
    return visible;
  }

  function tick() {
    refresh();
    frameRequest = requestAnimationFrame(tick);
  }

  function init() {
    ensureReticle();
    refresh();
    if (!frameRequest) frameRequest = requestAnimationFrame(tick);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  window.RangedHudReticle = {
    refresh,
    snapshot: () => ({
      asset: RETICLE_URL,
      equippedRanged: equippedRangedKey(),
      visible: !!reticleEl && reticleEl.style.display !== 'none',
      sizePx: [RETICLE_WIDTH_PX, RETICLE_HEIGHT_PX],
      centeredOn: '#canvasWrap',
    }),
  };
})();

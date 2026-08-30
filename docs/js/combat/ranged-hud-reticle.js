(() => {
  'use strict';

  window.RangedHudReticle?.dispose?.();

  const RETICLE_URL = 'assets/hud/hud_reticle.png';
  const RETICLE_SCALE = 0.5;
  const RETICLE_OPACITY = 0.5;
  const RETICLE_WIDTH_PX = 75 * RETICLE_SCALE;
  const RETICLE_HEIGHT_PX = 71 * RETICLE_SCALE;
  // brightness(0) first flattens the source art to solid black regardless of
  // its original colors, then each recipe recolors that black silhouette —
  // the white recipe is the reticle's original look, the red recipe is a
  // standard black-to-red CSS filter chain used only while a shot would hit.
  const FILTER_WHITE = 'brightness(0) invert(1)';
  const FILTER_RED = 'brightness(0) saturate(100%) invert(21%) sepia(89%) saturate(6510%) hue-rotate(357deg) brightness(94%) contrast(119%)';

  let reticleEl = null;
  let frameRequest = 0;
  let lastVisible = false;
  let lastWouldHit = false;

  function equippedRangedKey() {
    return window.RangedWeapons?.equippedRangedKey?.() || null;
  }

  function rangedWeaponDrawn() {
    const itemKey = equippedRangedKey();
    if (!itemKey) return false;

    const switchButton = document.getElementById('btnWeaponSwitch');
    const combatWeaponOut = !!switchButton?.classList.contains('active');
    const rangedIsCurrentCombatTool = switchButton?.getAttribute('aria-label') === 'Switch to melee weapon';
    return combatWeaponOut && rangedIsCurrentCombatTool;
  }

  function ensureReticle() {
    if (reticleEl?.isConnected) return reticleEl;

    const host = document.getElementById('canvasWrap');
    if (!host) return null;

    document.getElementById('rangedHudReticle')?.remove();

    const image = document.createElement('img');
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
      zIndex: '10',
      display: 'none',
      opacity: String(RETICLE_OPACITY),
      filter: FILTER_WHITE,
    });
    image.addEventListener('error', () => console.error(`Ranged HUD reticle failed to load: ${RETICLE_URL}`));

    host.appendChild(image);
    reticleEl = image;
    return image;
  }

  function refresh() {
    const image = ensureReticle();
    if (!image) return false;

    const visible = rangedWeaponDrawn();
    image.style.display = visible ? 'block' : 'none';
    const wouldHit = visible && !!window.RangedWeapons?.wouldHitHostile?.();
    if (wouldHit !== lastWouldHit) image.style.filter = wouldHit ? FILTER_RED : FILTER_WHITE;
    lastWouldHit = wouldHit;
    lastVisible = visible;
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

  function dispose() {
    if (frameRequest) cancelAnimationFrame(frameRequest);
    frameRequest = 0;
    reticleEl?.remove?.();
    reticleEl = null;
    lastVisible = false;
    lastWouldHit = false;
  }

  window.RangedHudReticle = {
    refresh,
    dispose,
    snapshot: () => ({
      asset: RETICLE_URL,
      equippedRanged: equippedRangedKey(),
      drawn: rangedWeaponDrawn(),
      visible: lastVisible,
      wouldHit: lastWouldHit,
      screenSpace: true,
      scaleFactor: RETICLE_SCALE,
      opacity: RETICLE_OPACITY,
      sizePx: [RETICLE_WIDTH_PX, RETICLE_HEIGHT_PX],
      centeredOn: '#canvasWrap',
      latestChange: 'Centered screen-space reticle at 50% scale and 50% opacity; visible only while a ranged weapon is drawn.',
    }),
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

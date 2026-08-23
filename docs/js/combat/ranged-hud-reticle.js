(() => {
  'use strict';

  window.RangedHudReticle?.dispose?.();

  const RETICLE_URL = 'assets/hud/hud_reticle.png';
  const RETICLE_SCALE = 0.75;
  const RETICLE_OPACITY = 0.75;
  const RETICLE_WIDTH_PX = 75 * RETICLE_SCALE;
  const RETICLE_HEIGHT_PX = 71 * RETICLE_SCALE;

  let reticleEl = null;
  let frameRequest = 0;
  let lastVisible = false;

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
      filter: 'brightness(0) invert(1)',
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
  }

  window.RangedHudReticle = {
    refresh,
    dispose,
    snapshot: () => ({
      asset: RETICLE_URL,
      equippedRanged: equippedRangedKey(),
      drawn: rangedWeaponDrawn(),
      visible: lastVisible,
      screenSpace: true,
      scaleFactor: RETICLE_SCALE,
      opacity: RETICLE_OPACITY,
      sizePx: [RETICLE_WIDTH_PX, RETICLE_HEIGHT_PX],
      centeredOn: '#canvasWrap',
      latestChange: 'Centered screen-space reticle at 75% scale and 75% opacity; visible only while a ranged weapon is drawn.',
    }),
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

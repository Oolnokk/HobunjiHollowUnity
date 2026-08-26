(() => {
  'use strict';

  // Four corner pieces mirror the four weapon-tool loadout slots.
  const SLOT_IDS = ['tap1', 'tap2', 'hold1', 'hold2'];
  const SLOT_LABELS = ['Combo', 'Quick Attack', 'Held 1', 'Held 2'];
  // Reuse the action-arch combat colors so the HUD sight and input buttons agree.
  const SLOT_COLORS = ['#00D9FF', '#FFD23F', '#FF4FD8', '#7CFF4F'];
  const RETICLE_URL = 'assets/hud/hud_reticle.png';
  const RETICLE_SCALE = 0.5;
  const RETICLE_OPACITY = 0.62;
  const RETICLE_WIDTH_PX = 75 * RETICLE_SCALE;
  const RETICLE_HEIGHT_PX = 71 * RETICLE_SCALE;
  const FILTER_WHITE = 'brightness(0) invert(1)';
  const READY_GLOW = ' drop-shadow(0 0 2px #ff3030) drop-shadow(0 0 5px rgba(255,48,48,.95))';
  // Slot colors are applied only after the corresponding attack is reachable.
  const SLOT_READY_FILTERS = [
    'brightness(0) saturate(100%) invert(79%) sepia(99%) saturate(3955%) hue-rotate(144deg) brightness(103%) contrast(106%)' + READY_GLOW,
    'brightness(0) saturate(100%) invert(86%) sepia(93%) saturate(1157%) hue-rotate(343deg) brightness(105%) contrast(101%)' + READY_GLOW,
    'brightness(0) saturate(100%) invert(49%) sepia(97%) saturate(3582%) hue-rotate(287deg) brightness(105%) contrast(104%)' + READY_GLOW,
    'brightness(0) saturate(100%) invert(89%) sepia(87%) saturate(1548%) hue-rotate(52deg) brightness(104%) contrast(103%)' + READY_GLOW,
  ];
  const CLIPS = [
    'polygon(0 0, 54% 0, 54% 54%, 0 54%)',
    'polygon(46% 0, 100% 0, 100% 54%, 46% 54%)',
    'polygon(0 46%, 54% 46%, 54% 100%, 0 100%)',
    'polygon(46% 46%, 100% 46%, 100% 100%, 46% 100%)',
  ];

  let host = null;
  let container = null;
  let pieces = [];
  let frameRequest = 0;
  let lastSnapshot = { visible: false, target: null, slots: [] };

  function meleeWeaponDrawn() {
    // The action-arch observer can rewrite the switch button label while it
    // rebuilds the HUD. Prefer the authoritative gameplay mode when exposed,
    // then keep the DOM check as a backwards-compatible fallback.
    const activeTool = window.Combat?.deps?.getActiveTool?.();
    const switchButton = document.getElementById('btnWeaponSwitch');
    if (activeTool) return activeTool === 'weapon' && !!switchButton?.classList.contains('active');
    return !!switchButton?.classList.contains('active')
      && switchButton?.getAttribute('aria-label') !== 'Switch to melee weapon';
  }

  function ensureReticle() {
    if (container?.isConnected) return container;
    host = document.getElementById('canvasWrap');
    if (!host) return null;

    document.getElementById('meleeHudReticle')?.remove();
    container = document.createElement('div');
    container.id = 'meleeHudReticle';
    Object.assign(container.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: RETICLE_WIDTH_PX + 'px',
      height: RETICLE_HEIGHT_PX + 'px',
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '10',
      display: 'none',
      opacity: String(RETICLE_OPACITY),
    });

    pieces = SLOT_IDS.map((slotId, index) => {
      const image = document.createElement('img');
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      image.dataset.slot = slotId;
      Object.assign(image.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        pointerEvents: 'none',
        userSelect: 'none',
        WebkitUserDrag: 'none',
        clipPath: CLIPS[index],
        filter: FILTER_WHITE,
      });
      image.src = RETICLE_URL;
      image.addEventListener('error', () => console.error('Melee HUD reticle failed to load: ' + RETICLE_URL));
      container.appendChild(image);
      return image;
    });
    host.appendChild(container);
    return container;
  }

  function baseAttackProfile(slotId, attackId, deps) {
    const base = deps.weaponAbility?.('cut') || { rangePx: deps.TILE * 1.05 };
    const effects = window.CombatProgression?.getEffects?.(deps.currentWeaponKey?.(), attackId)
      || { stats: {} };
    const stats = effects.stats || {};
    const comboData = window.Combat.comboData || {};
    const quickData = window.Combat.quickAttackData || {};
    const chargedData = window.Combat.chargedBreakerData || {};
    const counterData = window.Combat.counterShieldData || {};
    const flurryData = window.Combat.flurryData || {};
    let rangePx = 0;
    let lungePx = 0;
    let halfConeRad = Math.PI / 8;
    let kind = attackId || 'empty';

    if (slotId === 'tap1') {
      const steps = comboData[attackId];
      const step = Array.isArray(steps) ? steps[0] : null;
      if (step) {
        rangePx = base.rangePx * (step.rangeMul ?? 1) * (comboData.RANGE_SCALE ?? 0.6) * (1 + (stats.rangeMul || 0));
        lungePx = deps.TILE * (step.lungeMul ?? 0) * (comboData.LUNGE_SCALE ?? 1.5) * (1 + (stats.lungeMul || 0));
        halfConeRad = THREE.MathUtils.degToRad(step.halfConeDeg ?? 26);
      }
    } else if (slotId === 'tap2') {
      const tech = quickData.TECHNIQUES?.[attackId];
      if (tech) {
        rangePx = base.rangePx * (tech.rangeMul ?? 1) * (quickData.RANGE_SCALE ?? 0.6) * (1 + (stats.rangeMul || 0));
        lungePx = deps.TILE * (quickData.LUNGE_TILE_MUL ?? 0) * (1 + (stats.lungeMul || 0));
        halfConeRad = THREE.MathUtils.degToRad(tech.halfConeDeg ?? 18);
      }
    } else if (attackId === 'chargedBreaker') {
      rangePx = base.rangePx * (chargedData.RANGE_MUL_MAX ?? 1.9) * (1 + (stats.rangeMul || 0));
      lungePx = deps.TILE * (chargedData.LUNGE_TILE_MUL ?? 0) * (1 + (stats.lungeMul || 0));
      halfConeRad = THREE.MathUtils.degToRad(chargedData.HALF_CONE_DEG ?? 22);
    } else if (attackId === 'counterShield') {
      rangePx = base.rangePx * (counterData.COUNTER_RANGE_MUL ?? 1.7);
      lungePx = rangePx;
      halfConeRad = THREE.MathUtils.degToRad(counterData.COUNTER_HALF_CONE_DEG ?? 35);
    } else if (attackId === 'acceleratingFlurry') {
      rangePx = base.rangePx * (1 + (stats.rangeMul || 0));
      lungePx = rangePx;
      halfConeRad = THREE.MathUtils.degToRad(flurryData.HALF_CONE_DEG ?? 25);
    }

    const attackRangePx = Math.max(0, rangePx);
    const reachPx = Math.max(attackRangePx, lungePx);
    return {
      slotId,
      slotLabel: SLOT_LABELS[SLOT_IDS.indexOf(slotId)],
      attackId,
      kind,
      attackRangePx,
      lungePx: Math.max(0, lungePx),
      reachPx,
      halfConeRad,
      label: window.Combat.abilities?.get?.(attackId)?.label || attackId || 'Empty',
    };
  }

  function profiles() {
    const deps = window.Combat?.deps;
    if (!deps?.player || !deps.TILE || !window.Combat?.loadout) return [];
    const loadout = window.Combat.loadout.get?.() || {};
    return SLOT_IDS.map(slotId => baseAttackProfile(slotId, loadout[slotId], deps));
  }

  function targetState(deps, direction, slotProfiles) {
    let focused = null;
    try { focused = window.RangedWeapons?.focusedHostile?.(24) || null; } catch (err) {
      console.warn('[melee-reticle] focused target failed', err);
    }
    const target = focused?.candidate?.data || null;
    if (!target || target.health <= 0) return { target: null, ready: slotProfiles.map(() => false), distanceWorld: null };

    const origin = new THREE.Vector3(
      deps.player.x / deps.TILE,
      deps.player.avatarRef?.group?.position?.y || 0.55,
      deps.player.y / deps.TILE,
    );
    const hitbox = window.RangedWeapons?.actorHitbox?.(target);
    const closest = hitbox?.box?.clampPoint?.(origin, new THREE.Vector3())
      || new THREE.Vector3(target.x / deps.TILE, origin.y, target.y / deps.TILE);
    const distanceWorld = closest.distanceTo(origin);
    const vertical = window.RangedWeapons?.meleeReachCheck?.(deps.player, target, 0.4);
    // focusedHostile() already proves the camera ray is on this actor. Use
    // the attack's actual reach plus the shared vertical gate for readiness;
    // re-running the old 2D meleeHit cone here made every slot stay white
    // when shoulder-camera aim pitch differed by a few degrees.
    const ready = slotProfiles.map(profile => {
      if (!profile.attackId || profile.reachPx <= 0) return false;
      const inReach = distanceWorld <= profile.reachPx / deps.TILE + 1e-4;
      const sameHeight = !vertical || vertical.reachable !== false;
      return inReach && sameHeight;
    });
    return { target: target.id || target.name || 'hostile', ready, distanceWorld };
  }

  function refresh() {
    const root = ensureReticle();
    const deps = window.Combat?.deps;
    const visible = !!root && meleeWeaponDrawn();
    if (!root || !deps?.player || !visible) {
      if (root) root.style.display = 'none';
      lastSnapshot = { visible: false, target: null, slots: [] };
      return false;
    }

    const slotProfiles = profiles();
    const direction = deps.getPlayerMeleeAimDirection?.() || { x: 1, y: 0, z: 0 };
    const state = targetState(deps, direction, slotProfiles);
    root.style.display = 'block';
    pieces.forEach((image, index) => {
      const profile = slotProfiles[index] || {};
      image.title = profile.slotLabel ? profile.slotLabel + ': ' + profile.label : '';
      image.style.filter = state.ready[index] ? SLOT_READY_FILTERS[index] : FILTER_WHITE;
    });
    lastSnapshot = {
      visible: true,
      target: state.target,
      distanceWorld: state.distanceWorld,
      slots: slotProfiles.map((profile, index) => ({
        slot: profile.slotId,
        attack: profile.label,
        attackId: profile.attackId,
        lungeDistancePx: profile.lungePx,
        reachDistancePx: profile.reachPx,
        ready: !!state.ready[index],
        color: SLOT_COLORS[index],
      })),
    };
    return true;
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
    container?.remove?.();
    container = null;
    pieces = [];
    lastSnapshot = { visible: false, target: null, slots: [] };
  }

  window.MeleeHudReticle = {
    refresh,
    dispose,
    snapshot: () => ({ ...lastSnapshot, asset: RETICLE_URL, sizePx: [RETICLE_WIDTH_PX, RETICLE_HEIGHT_PX], opacity: RETICLE_OPACITY }),
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

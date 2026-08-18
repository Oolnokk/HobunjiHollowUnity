// Quick-attack bonus-ready indicator — renders three aggressively animated
// Khymeryyan-Roman exclamation marks inside the current auto-target's ground
// resource ring whenever the equipped Quick Attack would receive its bonus.
//
// The existing Quick Attack implementation evaluates its condition against
// Combat.deps.findAutoTarget(), so this indicator deliberately follows that
// same target-selection rule rather than lighting every hostile independently.
(() => {
  'use strict';

  if (typeof THREE === 'undefined' || !window.ResourceRings || !window.Combat) {
    console.error('quick-attack-bonus-indicator.js requires THREE, ResourceRings, and Combat');
    return;
  }

  const INDICATOR_NAME = 'quickAttackBonusReadyIndicator'; // Used to find/remove the alert inside a resource-ring group after ring rebuilds.
  const DEFAULT_RING_RADIUS = 0.6; // Used to keep the three marks safely inside the standard resource-ring footprint.
  const GLYPH_FONT = 'KhymeryyanRomanLetters+Numbers'; // Used by the canvas texture so the alert matches the requested game alphabet.
  const DEBUG_QUERY_KEY = 'debugQuickBonus'; // Used by the mobile-friendly URL debug readout (?debugQuickBonus=1).

  let lastTarget = null; // Used to remove an alert immediately when auto-targeting moves to another enemy.
  let lastReady = false; // Used by the resource-ring wrapper without re-running target search for every fighter.
  let debugBadge = null; // Used only when the optional mobile URL debug readout is enabled.
  let glyphTexture = null; // Shared by all three exclamation-mark materials; resource-ring rebuilds do not dispose texture maps.
  let glyphCanvas = null; // Retained so the custom font can redraw once document.fonts reports it loaded.

  function currentQuickAttack() {
    const attackId = window.Combat.loadout?.getSlot?.('tap2') || null; // Used to resolve the currently equipped Quick Attack definition.
    const definition = attackId ? window.Combat.quickAttackData?.TECHNIQUES?.[attackId] : null; // Used to identify which bonus condition is active.
    return definition ? { attackId, definition } : null;
  }

  // Mirrors combat-quickattacks.js:getConditions exactly so the visual cue
  // and the actual bonus branch agree on the same target-state thresholds.
  function getConditions(deps, target) {
    if (!deps?.player || !target) return { enemyStriking: false, exhausted: false, behind: false, lowHealth: false };
    const toPlayerX = deps.player.x - target.x;
    const toPlayerY = deps.player.y - target.y;
    const dist = Math.max(0.001, Math.hypot(toPlayerX, toPlayerY));
    const forwardX = Math.cos(target.facing || 0);
    const forwardY = Math.sin(target.facing || 0);
    const behindDot = forwardX * (toPlayerX / dist) + forwardY * (toPlayerY / dist);
    return {
      enemyStriking: target.telegraphState === 'strike',
      exhausted: !!target.exhaustion?.active || target.stamina <= target.maxStamina * 0.20,
      behind: behindDot < -0.35,
      lowHealth: target.health > 0 && target.health <= target.maxHealth * 0.30,
    };
  }

  function getReadyState() {
    const deps = window.Combat.deps;
    const equipped = currentQuickAttack();
    const target = deps?.findAutoTarget?.() || null; // Used to stay aligned with the actual Quick Attack bonus target selection.
    if (!deps || !equipped || !target || target.health <= 0) {
      return { deps, target, equipped, ready: false, conditions: null };
    }
    const conditions = getConditions(deps, target); // Used to test the equipped technique's configured condKey.
    const ready = !!conditions[equipped.definition.condKey]; // Used to show the alert only when the attack's bonus branch would be selected.
    return { deps, target, equipped, ready, conditions };
  }

  function redrawGlyphTexture() {
    if (!glyphCanvas) return;
    const ctx = glyphCanvas.getContext('2d');
    ctx.clearRect(0, 0, glyphCanvas.width, glyphCanvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `210px "${GLYPH_FONT}"`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 15;
    ctx.strokeStyle = '#111111';
    ctx.strokeText('!', glyphCanvas.width / 2, glyphCanvas.height * 0.48);
    ctx.fillStyle = '#fff3a8';
    ctx.fillText('!', glyphCanvas.width / 2, glyphCanvas.height * 0.48);
    if (glyphTexture) glyphTexture.needsUpdate = true;
  }

  function ensureGlyphTexture() {
    if (glyphTexture) return glyphTexture;
    glyphCanvas = document.createElement('canvas');
    glyphCanvas.width = 128;
    glyphCanvas.height = 256;
    redrawGlyphTexture();
    glyphTexture = new THREE.CanvasTexture(glyphCanvas);
    glyphTexture.minFilter = THREE.LinearFilter;
    glyphTexture.magFilter = THREE.LinearFilter;
    glyphTexture.generateMipmaps = false;
    if ('colorSpace' in glyphTexture && THREE.SRGBColorSpace) glyphTexture.colorSpace = THREE.SRGBColorSpace;
    const fontLoad = document.fonts?.load?.(`210px "${GLYPH_FONT}"`); // Used to refresh the canvas after the custom game font finishes loading.
    fontLoad?.then(redrawGlyphTexture).catch(() => {});
    return glyphTexture;
  }

  function makeMark(radius, baseX, phase) {
    const holder = new THREE.Group();
    holder.position.set(baseX, 0.055, 0);
    holder.userData.quickBonusBaseX = baseX;
    holder.userData.quickBonusPhase = phase;

    const geometry = new THREE.PlaneGeometry(radius * 0.34, radius * 0.72); // Used to keep each punctuation mark legible without touching the ring arcs.
    const material = new THREE.MeshBasicMaterial({
      map: ensureGlyphTexture(),
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 1.9;
    holder.add(mesh);
    return holder;
  }

  function buildIndicator(radius = DEFAULT_RING_RADIUS) {
    const group = new THREE.Group();
    group.name = INDICATOR_NAME;
    group.userData.quickAttackBonusIndicator = true;
    group.userData.quickBonusRadius = radius;
    group.add(makeMark(radius, radius * -0.42, 0.0));
    group.add(makeMark(radius, 0, 2.15));
    group.add(makeMark(radius, radius * 0.42, 4.3));
    return group;
  }

  function findIndicator(ringHud) {
    return ringHud?.children?.find?.(child => child?.userData?.quickAttackBonusIndicator) || null;
  }

  function disposeIndicator(indicator) {
    if (!indicator) return;
    indicator.traverse?.(object => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach(material => material?.dispose?.());
      else object.material?.dispose?.();
    });
    indicator.parent?.remove?.(indicator);
  }

  function removeIndicator(entity) {
    const indicator = findIndicator(entity?._ringHud);
    if (indicator) disposeIndicator(indicator);
  }

  function animateIndicator(indicator, radius, nowMs) {
    const fast = nowMs * 0.001; // Used as a seconds-scale base for deliberately frantic layered shake frequencies.
    for (const holder of indicator.children) {
      const phase = holder.userData.quickBonusPhase || 0;
      const baseX = holder.userData.quickBonusBaseX || 0;
      const pulse = 1 + 0.20 * Math.sin(fast * 15.5 + phase) + 0.08 * Math.sin(fast * 31.0 - phase * 0.7);
      const shakeX = (Math.sin(fast * 43 + phase * 2.1) + 0.55 * Math.sin(fast * 71 - phase)) * radius * 0.032;
      const shakeZ = (Math.cos(fast * 49 - phase * 1.7) + 0.45 * Math.sin(fast * 83 + phase)) * radius * 0.026;
      holder.position.x = baseX + shakeX;
      holder.position.z = shakeZ;
      holder.rotation.y = 0.20 * Math.sin(fast * 37 + phase) + 0.08 * Math.sin(fast * 67 - phase);
      holder.scale.setScalar(Math.max(0.74, pulse));
      const mark = holder.children[0];
      if (mark?.material) mark.material.opacity = 0.76 + 0.24 * (0.5 + 0.5 * Math.sin(fast * 19 + phase));
    }
  }

  function ensureVisibleIndicator(entity, nowMs) {
    const ringHud = entity?._ringHud;
    if (!ringHud) return;
    let indicator = findIndicator(ringHud);
    if (!indicator) {
      indicator = buildIndicator(DEFAULT_RING_RADIUS);
      ringHud.add(indicator);
    }
    ringHud.visible = true;
    animateIndicator(indicator, indicator.userData.quickBonusRadius || DEFAULT_RING_RADIUS, nowMs);
  }

  function syncReadyTarget(nowMs = performance.now()) {
    const state = getReadyState(); // Evaluated once per animation frame, not once per resource ring/enemy.
    if (lastTarget && lastTarget !== state.target) removeIndicator(lastTarget);
    lastTarget = state.target;
    lastReady = state.ready;

    if (state.target) {
      if (state.ready) ensureVisibleIndicator(state.target, nowMs);
      else removeIndicator(state.target);
    }

    updateDebugBadge(state);
    return state;
  }

  function frame(nowMs) {
    syncReadyTarget(nowMs);
    requestAnimationFrame(frame);
  }

  // Resource rings can rebuild their children when a rounded resource value
  // changes. Reassert only the already-computed target state after that rebuild;
  // do NOT call findAutoTarget here because updateRingHud may run once per enemy.
  const baseUpdateRingHud = window.ResourceRings.updateRingHud; // Used to preserve the existing resource-ring renderer unchanged beneath the alert layer.
  if (typeof baseUpdateRingHud === 'function' && !baseUpdateRingHud.__quickBonusWrapped) {
    const wrappedUpdateRingHud = function (...args) { // Used to restore the alert if this target's ring rebuilt since the once-per-frame condition check.
      const result = baseUpdateRingHud.apply(this, args);
      const entity = args[0]; // Used to avoid touching unrelated fighter rings in this lightweight post-pass.
      if (lastReady && entity === lastTarget) ensureVisibleIndicator(entity, performance.now());
      return result;
    };
    wrappedUpdateRingHud.__quickBonusWrapped = true;
    window.ResourceRings.updateRingHud = wrappedUpdateRingHud;
  }

  function debugEnabledFromUrl() {
    try { return new URLSearchParams(location.search).get(DEBUG_QUERY_KEY) === '1'; }
    catch (_) { return false; }
  }

  function ensureDebugBadge() {
    if (debugBadge || !document.body) return debugBadge;
    debugBadge = document.createElement('div');
    debugBadge.id = 'quickAttackBonusDebug';
    Object.assign(debugBadge.style, {
      position: 'fixed', left: '8px', top: 'calc(env(safe-area-inset-top, 0px) + 8px)', zIndex: '22000',
      maxWidth: 'min(92vw, 420px)', padding: '7px 9px', borderRadius: '8px', background: 'rgba(0,0,0,.78)',
      color: '#fff', font: '12px/1.25 monospace', pointerEvents: 'none', whiteSpace: 'pre-wrap',
    });
    document.body.appendChild(debugBadge);
    return debugBadge;
  }

  let debugEnabled = debugEnabledFromUrl(); // Used to make the diagnostic readout accessible on mobile without requiring devtools.
  function updateDebugBadge(state) {
    if (!debugEnabled) {
      if (debugBadge) debugBadge.style.display = 'none';
      return;
    }
    const badge = ensureDebugBadge();
    if (!badge) return;
    badge.style.display = 'block';
    badge.textContent = [
      `Quick: ${state.equipped?.definition?.label || 'none'} (${state.equipped?.attackId || '-'})`,
      `Target: ${state.target?.def?.label || state.target?.name || (state.target ? 'hostile' : 'none')}`,
      `Bonus ready: ${state.ready ? 'YES' : 'no'}`,
      `Condition: ${state.equipped?.definition?.condKey || '-'}`,
    ].join('\n');
  }

  window.QuickAttackBonusIndicator = {
    getConditions,
    getReadyState,
    refresh: () => syncReadyTarget(performance.now()),
    setDebugEnabled(enabled) { debugEnabled = !!enabled; updateDebugBadge(getReadyState()); },
  };

  requestAnimationFrame(frame);
})();

// Quick-attack bonus-ready cues — renders both a popup-style tracking
// reticle over the current auto-target's body and a persistent vertical
// Tankan "Hahai!" callout whenever the equipped Quick Attack would receive
// its conditional bonus.
//
// Both cues deliberately use WorldPopupText's live portrait/body anchoring,
// and readiness comes from Combat.getQuickAttackConditions() — the exact
// evaluator used by the attack itself — so presentation cannot drift from
// gameplay condition logic.
(() => {
  'use strict';

  if (typeof THREE === 'undefined' || !window.Combat || !window.WorldPopupText?.avatarCentroidWorld) {
    console.error('quick-attack-bonus-indicator.js requires THREE, Combat, and WorldPopupText');
    return;
  }

  const RETICLE_CANVAS_PX = 256; // Used for a crisp reusable billboard texture without allocating per frame.
  const RETICLE_RENDER_ORDER = 1210; // Used to keep the sight above avatars, matching the popup text layer.
  const DEBUG_QUERY_KEY = 'debugQuickBonus'; // Used by the mobile-friendly URL debug readout (?debugQuickBonus=1).
  const visualRootCache = new WeakMap(); // Used to avoid re-traversing a target avatar every frame when sizing the reticle.

  let reticle = null; // Used to reuse one sprite/material/texture as the active target changes.
  let lastTarget = null; // Used by debugging and to detach immediately when auto-target selection changes.
  let debugBadge = null; // Used only when the optional mobile URL debug readout is enabled.
  let debugEnabled = debugEnabledFromUrl(); // Used to make diagnostics accessible on mobile without devtools.

  function currentQuickAttack() {
    const attackId = window.Combat.loadout?.getSlot?.('tap2') || null; // Used to resolve the currently equipped Quick Attack.
    const definition = attackId ? window.Combat.quickAttackData?.TECHNIQUES?.[attackId] : null; // Used to identify its configured bonus condition.
    return definition ? { attackId, definition } : null;
  }

  function getConditions(deps, target) {
    const evaluator = window.Combat.getQuickAttackConditions || window.Combat.quickAttackData?.getConditions; // Shared source used by the attack itself.
    return evaluator?.(deps, target) || { enemyStriking: false, exhausted: false, behind: false, lowHealth: false };
  }

  function targetRoot(target) {
    return target?.avatarRef?.group || target?.root || target?.group || target?.mesh || null;
  }

  function targetScene(target, root) {
    if (target?.scene?.isScene) return target.scene;
    let node = root; // Used to walk from the popup anchor root to its owning THREE.Scene.
    while (node && !node.isScene) node = node.parent;
    return node?.isScene ? node : null;
  }

  function getReadyState() {
    const deps = window.Combat.deps;
    const equipped = currentQuickAttack();
    const target = deps?.findAutoTarget?.() || null; // Used to follow the same auto-target evaluated by the actual Quick Attack.
    const root = targetRoot(target); // Used to anchor both readiness cues to the target's live avatar.
    if (!deps || !equipped || !target || target.health <= 0 || !root) {
      return { deps, target, root, equipped, ready: false, conditions: null };
    }
    const conditions = getConditions(deps, target); // Exact combat evaluator, including modular animal strike stages such as Pounce's leap.
    const ready = !!conditions[equipped.definition.condKey]; // Used to keep both cues visible for the complete time this condition remains true.
    return { deps, target, root, equipped, ready, conditions };
  }

  function makeReticle() {
    const canvas = document.createElement('canvas');
    canvas.width = RETICLE_CANVAS_PX;
    canvas.height = RETICLE_CANVAS_PX;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.name = 'quick_attack_bonus_reticle';
    sprite.renderOrder = RETICLE_RENDER_ORDER;
    sprite.frustumCulled = false;
    sprite.visible = false;
    sprite.userData.isBillboard = true;

    return { canvas, ctx, texture, material, sprite };
  }

  function ensureReticle() {
    if (!reticle) reticle = makeReticle();
    return reticle;
  }

  function resolveVisualMetrics(root) {
    let visualRoot = visualRootCache.get(root) || null; // Used to reuse the avatar child that owns authored portrait dimensions.
    if (visualRoot && !visualRoot.parent) visualRoot = null;
    if (!visualRoot) {
      root.traverse?.(child => {
        if (!visualRoot && Number.isFinite(child.userData?.portraitModelHeight)) visualRoot = child;
      });
      if (visualRoot) visualRootCache.set(root, visualRoot);
      else visualRootCache.delete(root);
    }
    const height = Math.max(0.2, Number(visualRoot?.userData?.portraitModelHeight) || 1); // Used to scale the sight with the target's visible body.
    const width = Math.max(0.2, Number(visualRoot?.userData?.portraitModelWidth) || height); // Used to keep large/wide species covered by the sight's travel area.
    return { height, width };
  }

  function strokeCornerSet(ctx, centerX, centerY, gap, arm, rotation, lineWidth, strokeStyle) {
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(rotation);
    ctx.beginPath();
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const x = sx * gap; // Used as one inward-facing L corner's horizontal origin.
        const y = sy * gap; // Used as one inward-facing L corner's vertical origin.
        ctx.moveTo(x, y);
        ctx.lineTo(x + sx * arm, y);
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + sy * arm);
      }
    }
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
    ctx.restore();
  }

  function drawReticle(nowMs) {
    const sight = ensureReticle();
    const t = nowMs * 0.001; // Used as the common timebase for layered non-repeating acquisition wobble.
    const center = RETICLE_CANVAS_PX * 0.5;
    // Several incommensurate passes make the reticle repeatedly cross the
    // body center, overshoot it, and correct again instead of tracing one
    // obvious circular/sinusoidal loop.
    const roamX =
      Math.sin(t * 2.85) * 31 +
      Math.sin(t * 7.70 + 1.10) * 15 +
      Math.sin(t * 17.30 - 0.35) * 6;
    const roamY =
      Math.sin(t * 3.65 + 0.70) * 34 +
      Math.sin(t * 8.90 - 0.20) * 14 +
      Math.sin(t * 15.60 + 1.80) * 7;
    const rotation =
      Math.sin(t * 4.80) * 0.055 +
      Math.sin(t * 13.10 + 0.80) * 0.025;
    const gap = 17 + Math.sin(t * 6.40 + 0.20) * 2.2;
    const arm = 31 + Math.sin(t * 9.20 - 0.60) * 2.0;

    sight.ctx.clearRect(0, 0, RETICLE_CANVAS_PX, RETICLE_CANVAS_PX);
    // Heavy under-stroke follows the established popup-text readability
    // treatment: the sight stays legible across light fur, dark fur, foliage,
    // and bright terrain without needing a filled center.
    strokeCornerSet(sight.ctx, center + roamX, center + roamY, gap, arm, rotation, 10, 'rgba(12,9,8,.92)');
    strokeCornerSet(sight.ctx, center + roamX, center + roamY, gap, arm, rotation, 4.2, 'rgba(255,244,226,.98)');
    sight.texture.needsUpdate = true;
    sight.material.opacity = 0.88 + 0.12 * (0.5 + 0.5 * Math.sin(t * 11.5));
  }

  function attachReticle(state, nowMs) {
    const sight = ensureReticle();
    const scene = targetScene(state.target, state.root); // Used to keep the popup sprite in the same scene as its target.
    const anchor = window.WorldPopupText.avatarCentroidWorld(state.root); // Used to match the target body centroid used by ordinary world popup text.
    if (!scene || !anchor) {
      detachReticle();
      return;
    }

    if (sight.sprite.parent !== scene) {
      sight.sprite.parent?.remove?.(sight.sprite);
      scene.add(sight.sprite);
    }

    const metrics = resolveVisualMetrics(state.root); // Used to make the sight's roaming canvas cover the current species' body.
    const bodySpan = Math.max(metrics.width, metrics.height);
    const baseSize = Math.max(0.58, Math.min(2.3, bodySpan * 1.12));
    const t = nowMs * 0.001; // Used for a small size wobble separate from the internal reticle roam.
    const scalePulse = 1 + Math.sin(t * 8.2 + 0.4) * 0.035 + Math.sin(t * 19.3) * 0.015;

    sight.sprite.position.copy(anchor);
    sight.sprite.scale.set(baseSize * scalePulse, baseSize * scalePulse, 1);
    sight.sprite.visible = true;
    drawReticle(nowMs);
  }

  function detachReticle() {
    if (!reticle) return;
    reticle.sprite.visible = false;
    reticle.sprite.parent?.remove?.(reticle.sprite);
  }

  function syncConditionCallout(state) {
    const scene = state.ready && state.root ? targetScene(state.target, state.root) : null; // Used to share the target's active scene with the popup system.
    window.WorldPopupText.setConditionCallout?.(state.root, state.ready, {
      text: 'Hahai!',
      scene,
    });
  }

  function syncReadyTarget(nowMs = performance.now()) {
    const state = getReadyState(); // Evaluated once per animation frame and shared by both cues.
    if (lastTarget !== state.target && reticle) detachReticle();
    lastTarget = state.target;

    if (state.ready) attachReticle(state, nowMs);
    else detachReticle();
    syncConditionCallout(state);

    updateDebugBadge(state);
    return state;
  }

  function frame(nowMs) {
    syncReadyTarget(nowMs);
    requestAnimationFrame(frame);
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
      `Generic telegraph: ${state.target?.telegraphState || '-'}`,
      `Animal attack: ${state.target?._animalAttack?.id || '-'} / ${state.target?._animalAttack?.state?.stage || '-'}`,
      `Popup root: ${state.root ? 'yes' : 'no'}`,
      'Cues: wobbling reticle + persistent vertical Tankan Hahai!',
    ].join('\n');
  }

  window.QuickAttackBonusIndicator = {
    getConditions,
    getReadyState,
    refresh: () => syncReadyTarget(performance.now()),
    setDebugEnabled(enabled) {
      debugEnabled = !!enabled;
      updateDebugBadge(getReadyState());
    },
  };

  requestAnimationFrame(frame);
})();

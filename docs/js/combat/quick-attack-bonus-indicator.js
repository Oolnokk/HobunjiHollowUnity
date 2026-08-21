// Quick-attack bonus-ready cue — renders an affliction-colored opportunity
// reticle over the current auto-target whenever the equipped Quick Attack
// would receive its conditional bonus.
//
// Readiness comes from Combat.getQuickAttackConditions() — the exact evaluator
// used by the attack itself — while affliction glow colors come from the same
// CombatProgression and ResourceRings data used by actual combat effects.
(() => {
  'use strict';

  if (typeof THREE === 'undefined' || !window.Combat || !window.WorldPopupText?.avatarCentroidWorld) {
    console.error('quick-attack-bonus-indicator.js requires THREE, Combat, and WorldPopupText');
    return;
  }

  const RETICLE_CANVAS_PX = 256; // Used for the procedural fallback texture when the authored sprite asset is not present yet.
  const RETICLE_RENDER_ORDER = 1210; // Used to keep the main sight above avatars, matching the popup text layer.
  const RETICLE_SCALE_RATIO = 1.38; // Used to make the opportunity sight clearly larger than the previous body-sized cue.
  const OPPORTUNITY_TEXTURE_URL = 'assets/hud/opportunity_reticle.png'; // Used automatically once the authored HUD sprite is added at this path.
  const DEBUG_QUERY_KEY = 'debugQuickBonus'; // Used by the mobile-friendly URL debug readout (?debugQuickBonus=1).
  const GLOW_LAYER_CONFIG = [
    { scale: 1.08, opacity: 0.17, followRate: 34 },
    { scale: 1.15, opacity: 0.14, followRate: 27 },
    { scale: 1.23, opacity: 0.11, followRate: 20 },
    { scale: 1.32, opacity: 0.08, followRate: 15 },
  ]; // Used for additive affliction glow; lower layers are larger, dimmer, and fractionally slower.
  const visualRootCache = new WeakMap(); // Used to avoid re-traversing a target avatar every frame when sizing the reticle.

  let reticle = null; // Used to reuse one main sprite plus its additive glow layers as the active target changes.
  let lastTarget = null; // Used by debugging and to detach immediately when auto-target selection changes.
  let lastFrameMs = performance.now(); // Used to make glow-layer lag frame-rate independent.
  let debugBadge = null; // Used only when the optional mobile URL debug readout is enabled.
  let debugEnabled = debugEnabledFromUrl(); // Used to make diagnostics accessible on mobile without devtools.

  const tempRight = new THREE.Vector3(); // Used to move the reticle in camera-screen horizontal space.
  const tempUp = new THREE.Vector3(); // Used to move the reticle in camera-screen vertical space.
  const tempPosition = new THREE.Vector3(); // Used as the main reticle's current world position before glow lag is solved.

  function currentQuickAttack() {
    const attackId = window.Combat.loadout?.getSlot?.('tap2') || null; // Used to resolve the currently equipped Quick Attack.
    const definition = attackId ? window.Combat.quickAttackData?.TECHNIQUES?.[attackId] : null; // Used to identify its configured bonus condition and fallback afflictions.
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
    const root = targetRoot(target); // Used to anchor readiness to the target's live avatar.
    if (!deps || !equipped || !target || target.health <= 0 || !root) {
      return { deps, target, root, equipped, ready: false, conditions: null };
    }
    const conditions = getConditions(deps, target); // Exact combat evaluator, including modular animal strike stages such as Pounce's leap.
    const ready = !!conditions[equipped.definition.condKey]; // Used to keep the reticle visible for the complete time this condition remains true.
    return { deps, target, root, equipped, ready, conditions };
  }

  function resolvedAfflictions(state) {
    const weaponKey = state?.deps?.currentWeaponKey?.(); // Used to resolve the same weapon-specific Quick Attack progression applied during execution.
    const progression = weaponKey && state?.equipped?.attackId
      ? window.CombatProgression?.getEffects?.(weaponKey, state.equipped.attackId)
      : null;
    const afflictions = progression?.afflictions || state?.equipped?.definition?.afflictions || [];
    return [...new Set(afflictions.filter(Boolean).map(String))];
  }

  function makeProceduralTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = RETICLE_CANVAS_PX;
    canvas.height = RETICLE_CANVAS_PX;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    return { canvas, ctx, texture };
  }

  function makeSpriteMaterial(map, options = {}) {
    return new THREE.SpriteMaterial({
      map,
      color: options.color || 0xffffff,
      transparent: true,
      opacity: options.opacity ?? 1,
      blending: options.blending ?? THREE.NormalBlending,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
  }

  function makeReticle() {
    const procedural = makeProceduralTexture();
    const material = makeSpriteMaterial(procedural.texture);
    const sprite = new THREE.Sprite(material);
    sprite.name = 'quick_attack_bonus_reticle';
    sprite.renderOrder = RETICLE_RENDER_ORDER;
    sprite.frustumCulled = false;
    sprite.visible = false;
    sprite.userData.isBillboard = true;

    const glows = GLOW_LAYER_CONFIG.map((cfg, index) => {
      const glowMaterial = makeSpriteMaterial(procedural.texture, {
        opacity: cfg.opacity,
        blending: THREE.AdditiveBlending,
      });
      const glowSprite = new THREE.Sprite(glowMaterial);
      glowSprite.name = `quick_attack_bonus_reticle_glow_${index + 1}`;
      glowSprite.renderOrder = RETICLE_RENDER_ORDER - GLOW_LAYER_CONFIG.length + index;
      glowSprite.frustumCulled = false;
      glowSprite.visible = false;
      glowSprite.userData.isBillboard = true;
      return { ...cfg, material: glowMaterial, sprite: glowSprite };
    });

    const sight = {
      ...procedural,
      material,
      sprite,
      glows,
      activeTarget: null,
      afflictionSignature: '',
      usingAuthoredTexture: false,
    };
    drawProceduralReticle(sight, performance.now());
    tryAuthoredTexture(sight);
    return sight;
  }

  function setReticleTexture(sight, texture, authored = false) {
    if (!sight || !texture) return;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    sight.material.map = texture;
    sight.material.needsUpdate = true;
    for (const glow of sight.glows) {
      glow.material.map = texture;
      glow.material.needsUpdate = true;
    }
    sight.usingAuthoredTexture = authored;
  }

  function tryAuthoredTexture(sight) {
    // The authored file is intentionally optional right now. Once
    // docs/assets/hud/opportunity_reticle.png exists, TextureLoader swaps every
    // layer to it automatically; an ordinary load failure leaves the proven
    // procedural reticle in place without affecting readiness logic.
    new THREE.TextureLoader().load(
      OPPORTUNITY_TEXTURE_URL,
      texture => setReticleTexture(sight, texture, true),
      undefined,
      () => { sight.usingAuthoredTexture = false; },
    );
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
    const width = Math.max(0.2, Number(visualRoot?.userData?.portraitModelWidth) || height); // Used to keep large/wide species covered by the sight.
    return { height, width };
  }

  function strokeCornerSet(ctx, centerX, centerY, gap, arm, lineWidth, strokeStyle) {
    ctx.beginPath();
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const x = centerX + sx * gap; // Used as one inward-facing L corner's horizontal origin.
        const y = centerY + sy * gap; // Used as one inward-facing L corner's vertical origin.
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
  }

  function drawProceduralReticle(sight, nowMs) {
    if (!sight || sight.usingAuthoredTexture) return;
    const t = nowMs * 0.001;
    const center = RETICLE_CANVAS_PX * 0.5;
    const gap = 22 + Math.sin(t * 6.4 + 0.2) * 2.5;
    const arm = 38 + Math.sin(t * 9.2 - 0.6) * 2.3;

    sight.ctx.clearRect(0, 0, RETICLE_CANVAS_PX, RETICLE_CANVAS_PX);
    strokeCornerSet(sight.ctx, center, center, gap, arm, 12, 'rgba(12,9,8,.94)');
    strokeCornerSet(sight.ctx, center, center, gap, arm, 5, 'rgba(255,244,226,.99)');
    sight.texture.needsUpdate = true;
  }

  function reticleMotion(nowMs) {
    const t = nowMs * 0.001;
    return {
      x: Math.sin(t * 2.85) * 31 + Math.sin(t * 7.70 + 1.10) * 15 + Math.sin(t * 17.30 - 0.35) * 6,
      y: Math.sin(t * 3.65 + 0.70) * 34 + Math.sin(t * 8.90 - 0.20) * 14 + Math.sin(t * 15.60 + 1.80) * 7,
      rotation: Math.sin(t * 4.80) * 0.055 + Math.sin(t * 13.10 + 0.80) * 0.025,
    }; // Same irregular reacquisition character as the former canvas-local movement, now in sprite space so glow layers can trail it.
  }

  function applyAfflictionGlow(sight, state) {
    const afflictions = resolvedAfflictions(state);
    const signature = afflictions.join('|');
    if (signature === sight.afflictionSignature) return afflictions;
    sight.afflictionSignature = signature;

    const palette = window.ResourceRings?.AFFLICTION_COLORS || {};
    const fallback = [1.0, 0.78, 0.35];
    for (let index = 0; index < sight.glows.length; index++) {
      const affliction = afflictions.length ? afflictions[index % afflictions.length] : null;
      const rgb = (affliction && Array.isArray(palette[affliction])) ? palette[affliction] : fallback;
      sight.glows[index].material.color.setRGB(
        Number(rgb[0]) || 0,
        Number(rgb[1]) || 0,
        Number(rgb[2]) || 0,
      ); // Canonical ResourceRings palette keeps the cue aligned with the affliction HUD.
    }
    return afflictions;
  }

  function attachLayerToScene(layerSprite, scene) {
    if (layerSprite.parent === scene) return;
    layerSprite.parent?.remove?.(layerSprite);
    scene.add(layerSprite);
  }

  function attachReticle(state, nowMs) {
    const sight = ensureReticle();
    const scene = targetScene(state.target, state.root); // Used to keep every sprite layer in the same scene as its target.
    const anchor = window.WorldPopupText.avatarCentroidWorld(state.root); // Used to match the target body centroid used by ordinary world popup text.
    if (!scene || !anchor) {
      detachReticle();
      return;
    }

    attachLayerToScene(sight.sprite, scene);
    for (const glow of sight.glows) attachLayerToScene(glow.sprite, scene);

    const metrics = resolveVisualMetrics(state.root); // Used to make the enlarged sight cover the current species' body.
    const bodySpan = Math.max(metrics.width, metrics.height);
    const baseSize = Math.max(0.72, Math.min(2.85, bodySpan * RETICLE_SCALE_RATIO));
    const t = nowMs * 0.001;
    const scalePulse = 1 + Math.sin(t * 8.2 + 0.4) * 0.035 + Math.sin(t * 19.3) * 0.015;
    const motion = reticleMotion(nowMs);

    // Convert the irregular sight motion into camera-plane world offsets. The
    // main sprite now actually moves instead of only redrawing corners inside
    // a fixed billboard; that gives the lower additive layers something real
    // to follow a fraction of a beat behind.
    const camera = state.deps?.camera;
    tempPosition.copy(anchor);
    if (camera?.quaternion) {
      tempRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
      tempUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
      const roamScale = baseSize / RETICLE_CANVAS_PX * 0.78;
      tempPosition.addScaledVector(tempRight, motion.x * roamScale);
      tempPosition.addScaledVector(tempUp, -motion.y * roamScale);
    }

    const newlyVisible = sight.activeTarget !== state.target || !sight.sprite.visible;
    sight.activeTarget = state.target;
    sight.sprite.position.copy(tempPosition);
    sight.sprite.scale.set(baseSize * scalePulse, baseSize * scalePulse, 1);
    sight.material.rotation = motion.rotation;
    sight.material.opacity = 0.9 + 0.1 * (0.5 + 0.5 * Math.sin(t * 11.5));
    sight.sprite.visible = true;

    const dt = Math.min(0.08, Math.max(0, (nowMs - lastFrameMs) / 1000));
    for (const glow of sight.glows) {
      if (newlyVisible) glow.sprite.position.copy(tempPosition);
      else {
        const follow = 1 - Math.exp(-glow.followRate * dt);
        glow.sprite.position.lerp(tempPosition, follow); // Lower layers use slower rates, creating the deliberately barely-noticeable trail.
      }
      const glowSize = baseSize * scalePulse * glow.scale;
      glow.sprite.scale.set(glowSize, glowSize, 1);
      glow.material.rotation = motion.rotation;
      glow.material.opacity = glow.opacity * (0.86 + 0.14 * (0.5 + 0.5 * Math.sin(t * (8.8 - glow.scale))));
      glow.sprite.visible = true;
    }

    applyAfflictionGlow(sight, state);
    drawProceduralReticle(sight, nowMs);
  }

  function detachReticle() {
    if (!reticle) return;
    reticle.activeTarget = null;
    reticle.sprite.visible = false;
    reticle.sprite.parent?.remove?.(reticle.sprite);
    for (const glow of reticle.glows) {
      glow.sprite.visible = false;
      glow.sprite.parent?.remove?.(glow.sprite);
    }
  }

  function syncReadyTarget(nowMs = performance.now()) {
    const state = getReadyState(); // Evaluated once per animation frame and shared by the reticle and debug readout.
    if (lastTarget !== state.target && reticle) detachReticle();
    lastTarget = state.target;

    if (state.ready) attachReticle(state, nowMs);
    else detachReticle();

    updateDebugBadge(state);
    return state;
  }

  function frame(nowMs) {
    syncReadyTarget(nowMs);
    lastFrameMs = nowMs;
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
    const afflictions = resolvedAfflictions(state);
    badge.style.display = 'block';
    badge.textContent = [
      `Quick: ${state.equipped?.definition?.label || 'none'} (${state.equipped?.attackId || '-'})`,
      `Target: ${state.target?.def?.label || state.target?.name || (state.target ? 'hostile' : 'none')}`,
      `Bonus ready: ${state.ready ? 'YES' : 'no'}`,
      `Condition: ${state.equipped?.definition?.condKey || '-'}`,
      `Condition state: ${state.conditions ? JSON.stringify(state.conditions) : '-'}`,
      `Afflictions: ${afflictions.length ? afflictions.join(', ') : '-'}`,
      `Generic telegraph: ${state.target?.telegraphState || '-'}`,
      `Animal attack: ${state.target?._animalAttack?.id || '-'} / ${state.target?._animalAttack?.state?.stage || '-'}`,
      `Popup root: ${state.root ? 'yes' : 'no'}`,
      `Reticle texture: ${reticle?.usingAuthoredTexture ? OPPORTUNITY_TEXTURE_URL : 'procedural fallback'}`,
      'Cue: layered affliction opportunity reticle',
    ].join('\n');
  }

  window.QuickAttackBonusIndicator = {
    getConditions,
    getReadyState,
    getAfflictions: () => resolvedAfflictions(getReadyState()),
    refresh: () => syncReadyTarget(performance.now()),
    setDebugEnabled(enabled) {
      debugEnabled = !!enabled;
      updateDebugBadge(getReadyState());
    },
  };

  requestAnimationFrame(frame);
})();

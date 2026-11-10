// Quick-attack bonus-ready cue — renders an affliction-colored opportunity
// reticle over nearby hostiles whose equipped Quick Attack's bonus condition
// is met (and whose per-target bonus cooldown has expired).
// A cue appears within the attack's maximum lunge + hit-cone length, including
// mastery, perk, weapon-shape, and enchantment modifiers, in the forward-facing
// half-disc of the player's current aim. It marks nearby openings, not an exact
// collision or line-of-sight prediction.
//
// Readiness comes from Combat.getQuickAttackConditions() — the exact evaluator
// used by the attack itself — while affliction glow colors come from the same
// CombatProgression and ResourceRings data used by actual combat effects.
(() => {
  'use strict';

  // Keep one owner for scene sprites, hit listeners, and the scheduler callback.
  // Replacing only the callback strands the previous instance's visible cues.
  if (window.QuickAttackBonusIndicator) return;

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
    { scale: 1.08, opacity: 0.64, followRate: 34 },
    { scale: 1.18, opacity: 0.48, followRate: 27 },
    { scale: 1.32, opacity: 0.34, followRate: 20 },
    { scale: 1.50, opacity: 0.22, followRate: 15 },
  ]; // Used for additive affliction glow; lower layers are larger, dimmer, and fractionally slower.
  const MAX_RETICLES = 12; // Nearest cued hostiles only, bounding per-frame sprite work in large fights.
  const POP_DURATION_MS = 480; // Keeps confirmed bonus impacts visible through cooldown and killing blows.
  const PROCEDURAL_REDRAW_INTERVAL_MS = 50; // Caps fallback canvas texture uploads at 20 Hz; sprite motion and condition checks still run each render frame.
  const REACH_REFRESH_INTERVAL_MS = 50; // Rebuilds expensive weapon mastery/shape/enchantment reach every 50ms or immediately after equipment changes.
  const visualRootCache = new WeakMap(); // Used to avoid re-traversing a target avatar every frame when sizing the reticle.

  const sights = new Map(); // target -> its reticle (main sprite + glow layers), alive while that target stays cued.
  const spareSights = []; // Released reticles reused for the next cued target instead of rebuilding materials.
  let face = null; // One procedural (or authored) reticle texture shared by every sight.
  let frameSerial = 0; // Marks sights touched this frame; untouched ones are released.
  let lastTarget = null; // Nearest cued (else nearest in-reach) hostile, for diagnostics.
  let lastReachPx = 0; // Maximum current Quick Attack range shown in mobile debug and snapshot.
  let lastCheckedConditions = 0; // Number of condition evaluations on the most recent frame.
  let lastVisualProbes = 0; // Number of avatar-centroid/frustum probes after readiness is confirmed.
  let lastHalfMoonCandidates = 0; // Cheap spatial-filter survivors from the most recent frame.
  let reachCache = null; // Short-lived read-only reach snapshot; only the geometry is cached, never active bonus conditions.
  let lastFrameMs = performance.now(); // Used to make glow-layer lag frame-rate independent.
  let debugBadge = null; // Used only when the optional mobile URL debug readout is enabled.
  let debugEnabled = debugEnabledFromUrl(); // Used to make diagnostics accessible on mobile without devtools.

  const tempRight = new THREE.Vector3(); // Used to move the reticle in camera-screen horizontal space.
  const tempUp = new THREE.Vector3(); // Used to move the reticle in camera-screen vertical space.
  const tempPosition = new THREE.Vector3(); // Used as the main reticle's current world position before glow lag is solved.
  const viewMatrix = new THREE.Matrix4(); // Camera projection × view, rebuilt once per frame for the in-view test.
  const viewFrustum = new THREE.Frustum(); // Camera field of view the cue is limited to.
  const viewSphere = new THREE.Sphere(); // Target body bounds tested against the frustum.
  const SAME_ELEVATION_MAX_DELTA = 1.25; // World units of terrain-height difference tolerated; half of game.js's 2.5 plateau tier, so ramps/slopes still count but a different tier does not.

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

  function cueSuppressed(deps) {
    return (deps?.getHeldMode && deps.getHeldMode() !== 'tool')
      || (deps?.getActiveTool && deps.getActiveTool() !== 'weapon')
      || !!deps?.isDialogueOpen?.()
      || !!window.AuthoredCutsceneRuntime?.isActive?.()
      || !!window.HOBUNJI_CHARACTER_VIEW_STATUS?.enabled;
  }

  // Live scene a target's avatar is shown in; null while it or any ancestor is hidden.
  function shownScene(target, root) {
    for (let node = root; node; node = node.parent) {
      if (node.visible === false) return null;
    }
    return targetScene(target, root);
  }

  function cameraFrustum(camera) {
    if (!camera?.projectionMatrix || !camera?.matrixWorldInverse) return null; // No camera yet: every shown target counts as in view.
    viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    return viewFrustum.setFromProjectionMatrix(viewMatrix);
  }

  // Only sample the player's terrain height once for a readiness pass; the
  // confirmed bonus burst may still call this standalone without a cached Y.
  function sameElevationAsPlayer(deps, target, playerSurfaceY = null) {
    if (typeof deps?.worldSurfaceY !== 'function' || !deps.player) return true;
    const playerY = playerSurfaceY === null
      ? Number(deps.worldSurfaceY(Number(deps.player.x) || 0, Number(deps.player.y) || 0))
      : playerSurfaceY; // Shared player elevation from the one-frame readiness pass.
    const targetY = Number(deps.worldSurfaceY(Number(target.x) || 0, Number(target.y) || 0));
    if (!Number.isFinite(playerY) || !Number.isFinite(targetY)) return true;
    return Math.abs(targetY - playerY) <= SAME_ELEVATION_MAX_DELTA;
  }

  // Spatial broadphase only: scanning the area's hostile list is unavoidable
  // without a shared spatial index, but remote/rear enemies never need their
  // hierarchy, terrain, condition, cooldown graphics, or matrix evaluated.
  function nearbyCandidates(deps, reachPx) {
    if (!(reachPx > 0) || !Number.isFinite(reachPx)) return [];
    const area = deps.getCurrentArea?.(); // Current loaded area limits the scan.
    const px = Number(deps.player?.x) || 0, py = Number(deps.player?.y) || 0; // Actor position in gameplay pixels.
    const aim = deps.getPlayerMeleeAimDirection?.(); // The camera-authored lunge's direction takes precedence over avatar facing.
    const ax = Number(aim?.x) || 0, ay = Number(aim?.z) || 0; // Three.js X/Z projects onto the gameplay X/Y plane.
    const aimLength = Math.hypot(ax, ay); // Nearly-vertical aim falls back to actor facing.
    const fallbackAngle = Number(deps.player?.angle) || 0; // Used before camera targeting is initialized.
    const facingX = aimLength > 0.0001 ? ax / aimLength : Math.cos(fallbackAngle);
    const facingY = aimLength > 0.0001 ? ay / aimLength : Math.sin(fallbackAngle); // Unit half-moon forward normal.
    const reachSq = reachPx * reachPx; // Squared range avoids a sqrt for each distant actor.
    const out = []; // Nearby forward-only candidates, ordered nearest first below.
    for (const target of deps.hostileObjects || []) {
      if (!target || !(target.health > 0) || (area && target.areaId !== area)) continue;
      if (target.isCompanion || target._denHidden || target._grehlrBurrowProtected) continue;
      const dx = (Number(target.x) || 0) - px, dy = (Number(target.y) || 0) - py; // Horizontal separation in gameplay pixels.
      const distanceSq = dx * dx + dy * dy; // Shared radius/order metric, never a square root.
      if (distanceSq > reachSq || dx * facingX + dy * facingY < 0) continue;
      out.push({ target, distanceSq }); // Do not resolve a single avatar or terrain sample in this stage.
    }
    out.sort((a, b) => a.distanceSq - b.distanceSq); // Prioritize the nearest eligible cues when crowded.
    return out;
  }

  function currentReachProfile(deps, attackId, nowMs) {
    const weaponKey = deps.currentWeaponKey?.(); // Equipment identity invalidates the cache immediately.
    const tile = Number(deps.TILE) || 0; // Tile-scale changes also invalidate the cached reach.
    const cached = reachCache; // Last range calculation, reused only for 50ms between equipment changes.
    if (cached && cached.attackId === attackId && cached.weaponKey === weaponKey
      && cached.tile === tile && nowMs >= cached.atMs && nowMs - cached.atMs < REACH_REFRESH_INTERVAL_MS) return cached.profile;
    const profile = window.Combat.quickAttackData?.getReachProfile?.(deps, attackId) || null; // Actual attack geometry, not a second formula.
    reachCache = { attackId, weaponKey, tile, atMs: nowMs, profile }; // Keeps per-frame condition and facing checks independent of this cache.
    return profile;
  }

  function getReadyState(nowMs = performance.now()) {
    const deps = window.Combat.deps;
    const equipped = currentQuickAttack();
    const state = { deps, equipped, reachPx: 0, checkedConditions: 0, visualProbes: 0, halfMoonCandidates: 0, target: null, root: null, ready: false, conditionReady: false, conditions: null, cooldownRemainingS: 0, targets: [], readyTargets: [] };
    if (!deps || !equipped || cueSuppressed(deps)) return state;
    const profile = currentReachProfile(deps, equipped.attackId, nowMs); // Cache only reach briefly; prepare() would spend Footing.
    state.reachPx = Math.max(0, Number(profile?.reachPx) || 0);
    if (!(state.reachPx > 0)) return state;
    state.profile = profile; // Reused below by affliction glow, instead of rebuilding mastery effects for each sight.
    const cooldownRemaining = window.Combat.quickAttackData?.bonusEffectCooldownRemaining; // Shared per-enemy cooldown, cheap to read.
    const condKey = equipped.definition.condKey;
    const candidates = nearbyCandidates(deps, state.reachPx);
    state.halfMoonCandidates = candidates.length;
    state.targets = candidates; // Debug count includes all spatial candidates, not only ones with active bonus effects.
    let firstInspected = null; // Nearest inspected hostile provides fallback debug information when no bonus is ready.
    let firstConditionMatch = null; // Nearest matching condition, even during cooldown, is the next debug fallback.
    let nearestConditionCheck = null; // Retains Combat's nearest-target condition diagnostics after later evaluations.
    let frustum; // Created lazily only for bonus-ready avatars, not for every nearby enemy.
    let playerSurfaceY = null; // Sampled lazily once if at least one candidate actually needs terrain filtering.
    for (const entry of candidates) {
      const target = entry.target;
      const root = targetRoot(target); // Hierarchy lookup remains cheap; no world-matrix update yet.
      const scene = root && shownScene(target, root);
      if (!scene) continue; // Hidden/detached targets must not consume readiness work.
      const cooldownRemainingS = cooldownRemaining?.(target) || 0; // Skip conditional status math during active cooldown when safe.
      // The nearest candidate remains fully inspectable for mobile diagnostics,
      // and optional debugging can inspect every cooling target as before.
      if (cooldownRemainingS > 0 && firstInspected && !debugEnabled) continue;
      const conditions = getConditions(deps, target); // Exact gameplay bonus predicate, checked every frame for non-cooling candidates.
      state.checkedConditions++;
      const conditionCheck = window.Combat.quickAttackData?.lastConditionCheck; // Same diagnostics the real attack updates.
      if (!nearestConditionCheck) nearestConditionCheck = conditionCheck;
      const conditionReady = !!conditions[condKey];
      const evaluated = { ...entry, root, scene, conditions, conditionReady, cooldownRemainingS, ready: false }; // Per-target state shared by visual cues and debug.
      if (!firstInspected) firstInspected = evaluated;
      if (conditionReady && !firstConditionMatch) firstConditionMatch = evaluated;
      if (!conditionReady || cooldownRemainingS > 0) continue;
      if (playerSurfaceY === null && typeof deps.worldSurfaceY === 'function' && deps.player) {
        playerSurfaceY = Number(deps.worldSurfaceY(Number(deps.player.x) || 0, Number(deps.player.y) || 0)); // One player height per frame, however many targets need checking.
      }
      if (!sameElevationAsPlayer(deps, target, playerSurfaceY)) continue;
      const anchor = window.WorldPopupText.avatarCentroidWorld(root); // Matrix updates only for candidates with bonuses ready.
      state.visualProbes++;
      if (!anchor) continue;
      if (frustum === undefined) frustum = cameraFrustum(deps.camera); // One projection pass, only when a cue might exist.
      if (frustum) {
        const metrics = resolveVisualMetrics(root);
        viewSphere.center.copy(anchor);
        viewSphere.radius = Math.max(metrics.width, metrics.height) * 0.5;
        if (!frustum.intersectsSphere(viewSphere)) continue;
      }
      evaluated.anchor = anchor;
      evaluated.ready = true;
      state.readyTargets.push(evaluated);
      if (state.readyTargets.length >= MAX_RETICLES) break; // Bound both sprite work and further status checks.
    }
    if (nearestConditionCheck) window.Combat.quickAttackData.lastConditionCheck = nearestConditionCheck;
    const focus = state.readyTargets[0] || firstConditionMatch || firstInspected;
    if (focus) Object.assign(state, { target: focus.target, root: focus.root, conditions: focus.conditions, conditionReady: focus.conditionReady, cooldownRemainingS: focus.cooldownRemainingS });
    state.ready = state.readyTargets.length > 0;
    return state;
  }

  function resolvedAfflictions(state) {
    const weaponKey = state?.deps?.currentWeaponKey?.(); // Used to resolve the same weapon-specific Quick Attack progression applied during execution.
    const progression = state?.profile?.effects || (weaponKey && state?.equipped?.attackId
      ? window.CombatProgression?.getEffects?.(weaponKey, state.equipped.attackId)
      : null); // Share the exact progression snapshot already queried for the attack reach.
    const rawAfflictions = progression?.quickBonusAfflictions || progression?.afflictions || state?.equipped?.definition?.afflictions || []; // Quick Attack mastery afflictions now live in the cooldown-gated bonus payload.
    const afflictions = Array.isArray(rawAfflictions)
      ? rawAfflictions
      : Object.entries(rawAfflictions || {}).filter(([, value]) => value === true || Number(value) > 0).map(([key]) => key);
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

  function ensureFace() {
    if (face) return face;
    const procedural = makeProceduralTexture();
    face = { canvas: procedural.canvas, ctx: procedural.ctx, texture: procedural.texture, authored: false, drawnAtMs: -1 };
    drawProceduralReticle(performance.now());
    tryAuthoredTexture();
    return face;
  }

  function makeSight() {
    const map = ensureFace().texture;
    const material = makeSpriteMaterial(map);
    const sprite = new THREE.Sprite(material);
    sprite.name = 'quick_attack_bonus_reticle';
    sprite.renderOrder = RETICLE_RENDER_ORDER;
    sprite.frustumCulled = false;
    sprite.visible = false;
    sprite.userData.isBillboard = true;

    const glows = GLOW_LAYER_CONFIG.map((cfg, index) => {
      const glowMaterial = makeSpriteMaterial(map, {
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

    return {
      material, sprite, glows,
      target: null,
      afflictionSignature: null,
      phaseMs: Math.random() * 60000, // Each sight roams on its own phase so several cues never wobble in lockstep.
      frame: 0,
      fresh: true,
      popStartedMs: null, // Set only by a confirmed Quick Attack bonus hit; cleared when pooled.
      baseSize: 1, // Last body-scaled size used by the stationary impact burst.
      baseRotation: 0, // Last cue rotation retained when the burst starts.
    };
  }

  function setSightTexture(sight, texture) {
    sight.material.map = texture;
    sight.material.needsUpdate = true;
    for (const glow of sight.glows) {
      glow.material.map = texture;
      glow.material.needsUpdate = true;
    }
  }

  function setFaceTexture(texture, authored = false) {
    if (!face || !texture) return;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    face.texture = texture;
    face.authored = authored;
    for (const sight of sights.values()) setSightTexture(sight, texture);
    for (const sight of spareSights) setSightTexture(sight, texture);
  }

  function tryAuthoredTexture() {
    // The authored file is intentionally optional right now. Once
    // docs/assets/hud/opportunity_reticle.png exists, TextureLoader swaps every
    // sight to it automatically; an ordinary load failure leaves the proven
    // procedural reticle in place without affecting readiness logic.
    new THREE.TextureLoader().load(
      OPPORTUNITY_TEXTURE_URL,
      texture => setFaceTexture(texture, true),
      undefined,
      () => { if (face) face.authored = false; },
    );
  }

  function acquireSight(target) {
    let sight = sights.get(target);
    if (sight) return sight;
    sight = spareSights.pop() || makeSight();
    sight.target = target;
    sight.fresh = true; // Glow layers snap to the first position instead of trailing in from a previous target.
    sight.popStartedMs = null;
    sights.set(target, sight);
    return sight;
  }

  function hideSight(sight) {
    sight.sprite.visible = false;
    sight.sprite.parent?.remove?.(sight.sprite);
    for (const glow of sight.glows) {
      glow.sprite.visible = false;
      glow.sprite.parent?.remove?.(glow.sprite);
    }
  }

  function releaseSight(target, sight) {
    hideSight(sight);
    sight.target = null;
    sights.delete(target);
    spareSights.push(sight);
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

  // Redraws the shared procedural face at most once per frame, however many
  // sights display it.
  function drawProceduralReticle(nowMs) {
    if (!face || face.authored || (face.drawnAtMs >= 0 && nowMs - face.drawnAtMs < PROCEDURAL_REDRAW_INTERVAL_MS)) return; // Throttle texture uploads only; sprite drift, conditions and pops stay full frame rate.
    face.drawnAtMs = nowMs;
    const sight = face; // Canvas/context/texture of the shared face.
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

  function applyAfflictionGlow(sight, state, appliedAfflictions) {
    const afflictions = appliedAfflictions || resolvedAfflictions(state); // Confirmed hits supply their actual payload, including enchantments.
    const signature = afflictions.join('|');
    if (signature === sight.afflictionSignature) return afflictions;
    sight.afflictionSignature = signature;

    const palette = window.ResourceRings?.AFFLICTION_COLORS || {};
    const fallback = 0xffc759; // Warm light for bonuses without a colored affliction payload.
    for (let index = 0; index < sight.glows.length; index++) {
      const affliction = afflictions.length ? afflictions[index % afflictions.length] : null;
      const color = palette[affliction] ?? fallback; // ResourceRings exports packed hex colors, including valid black.
      if (Array.isArray(color)) sight.glows[index].material.color.setRGB(...color);
      else sight.glows[index].material.color.setHex(color);
    }
    return afflictions;
  }

  function attachLayerToScene(layerSprite, scene) {
    if (layerSprite.parent === scene) return;
    layerSprite.parent?.remove?.(layerSprite);
    scene.add(layerSprite);
  }

  function attachSight(entry, state, nowMs, dt, sharedAfflictions = null) {
    const sight = acquireSight(entry.target);
    if (sight.popStartedMs !== null) return; // A confirmed impact owns this sight until its burst finishes.
    sight.frame = frameSerial;
    attachLayerToScene(sight.sprite, entry.scene);
    for (const glow of sight.glows) attachLayerToScene(glow.sprite, entry.scene);

    const metrics = resolveVisualMetrics(entry.root); // Used to make the enlarged sight cover the current species' body.
    const bodySpan = Math.max(metrics.width, metrics.height);
    const baseSize = Math.max(0.72, Math.min(2.85, bodySpan * RETICLE_SCALE_RATIO));
    sight.baseSize = baseSize;
    const localMs = nowMs + sight.phaseMs; // Per-sight phase: same motion character, desynchronised between targets.
    const t = localMs * 0.001;
    const scalePulse = 1 + Math.sin(t * 8.2 + 0.4) * 0.035 + Math.sin(t * 19.3) * 0.015;
    const motion = reticleMotion(localMs);

    // Convert the irregular sight motion into camera-plane world offsets. The
    // main sprite actually moves instead of only redrawing corners inside a
    // fixed billboard; that gives the lower additive layers something real to
    // follow a fraction of a beat behind.
    const camera = state.deps?.camera;
    tempPosition.copy(entry.anchor);
    if (camera?.quaternion) {
      tempRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
      tempUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
      const roamScale = baseSize / RETICLE_CANVAS_PX * 0.78;
      tempPosition.addScaledVector(tempRight, motion.x * roamScale);
      tempPosition.addScaledVector(tempUp, -motion.y * roamScale);
    }

    const newlyVisible = sight.fresh || !sight.sprite.visible;
    sight.fresh = false;
    sight.sprite.position.copy(tempPosition);
    sight.sprite.scale.set(baseSize * scalePulse, baseSize * scalePulse, 1);
    sight.material.rotation = motion.rotation;
    sight.baseRotation = motion.rotation;
    sight.material.opacity = 0.9 + 0.1 * (0.5 + 0.5 * Math.sin(t * 11.5));
    sight.sprite.visible = true;

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

    applyAfflictionGlow(sight, state, sharedAfflictions); // Resolve afflictions once per frame for all cued targets.
  }

  function popConfirmedBonus(event) {
    if (!event?.quickBonusEffectProc || event.attackCategory !== 'quickAttack') return;
    const deps = window.Combat.deps; // Current area and HUD suppression remain authoritative at impact.
    const target = event.target; // The hit event identifies each cleaved enemy independently.
    if (!deps || !target || cueSuppressed(deps) || (deps.getCurrentArea?.() && target.areaId !== deps.getCurrentArea()) || !sameElevationAsPlayer(deps, target)) return;
    let sight = sights.get(target); // Reuse the visible cue so the burst starts exactly where it was floating.
    if (!sight) {
      const root = targetRoot(target); // A hit between readiness frames can still create its impact cue.
      const scene = root && shownScene(target, root); // Dead targets may already have been detached by damage resolution.
      const anchor = root && window.WorldPopupText.avatarCentroidWorld(root); // Same anchor as readiness cues.
      if (!scene || !anchor || sights.size >= MAX_RETICLES) return;
      const frustum = cameraFrustum(deps.camera); // Offscreen cleave hits should not create a floating HUD cue.
      viewSphere.center.copy(anchor);
      viewSphere.radius = 0;
      if (frustum && !frustum.intersectsSphere(viewSphere)) return;
      attachSight({ target, root, scene, anchor }, { deps }, performance.now(), 0);
      sight = sights.get(target);
    }
    const afflictions = Object.entries(event.afflictionBonuses || {}).filter(([, amount]) => Number(amount) > 0).map(([id]) => id); // Use only afflictions carried by this confirmed hit.
    applyAfflictionGlow(sight, null, afflictions);
    sight.popStartedMs = performance.now();
    animatePop(sight, sight.popStartedMs); // Flash immediately in the hit's render frame.
  }

  function animatePop(sight, nowMs) {
    const progress = Math.min(1, Math.max(0, (nowMs - sight.popStartedMs) / POP_DURATION_MS)); // Absolute timing stays consistent across low-FPS frames.
    const expansion = 1 - Math.pow(1 - progress, 3); // Fast initial punch, then a softer outward fade.
    const size = sight.baseSize * (0.72 + expansion * 1.85); // A brief inward snap opens into a large impact.
    sight.sprite.scale.set(size, size, 1);
    sight.material.opacity = Math.pow(1 - progress, 1.4);
    sight.material.rotation = sight.baseRotation + expansion * 0.32;
    for (const glow of sight.glows) {
      const glowSize = size * (glow.scale + expansion * (glow.scale - 1)); // Each colored layer separates as the burst expands.
      glow.sprite.position.copy(sight.sprite.position);
      glow.sprite.scale.set(glowSize, glowSize, 1);
      glow.material.opacity = Math.min(1, glow.opacity * 3.5) * (1 - progress);
      glow.material.rotation = sight.material.rotation;
    }
    return progress < 1;
  }

  function detachAllSights() {
    for (const [target, sight] of sights) releaseSight(target, sight);
  }

  function syncReadyTargets(nowMs = performance.now()) {
    const state = getReadyState(nowMs); // Evaluate conditions every frame; only read-only range and fallback texture uploads use short caches.
    lastTarget = state.target;
    lastReachPx = state.reachPx;
    lastCheckedConditions = state.checkedConditions;
    lastVisualProbes = state.visualProbes;
    lastHalfMoonCandidates = state.halfMoonCandidates;
    frameSerial++;
    const dt = Math.min(0.08, Math.max(0, (nowMs - lastFrameMs) / 1000));
    if (state.readyTargets.length || sights.size) drawProceduralReticle(nowMs);
    const sharedAfflictions = state.readyTargets.length ? resolvedAfflictions(state) : null; // One weapon-mastery lookup for all active sights, even in crowded fights.
    for (const entry of state.readyTargets) attachSight(entry, state, nowMs, dt, sharedAfflictions);
    for (const [target, sight] of sights) {
      if (sight.popStartedMs !== null) {
        if (cueSuppressed(state.deps) || target.areaId !== state.deps?.getCurrentArea?.() || !animatePop(sight, nowMs)) releaseSight(target, sight);
      } else if (sight.frame !== frameSerial) releaseSight(target, sight);
    }
    updateDebugBadge(state);
    return state;
  }

  let lastFrameError = null; // Exposed in the mobile debug snapshot if an unexpected renderer error occurs.
  const SCHEDULER_ID = 'quick-attack-bonus-indicator'; // Stable scheduler identity for RuntimeFrameScheduler ownership, disposal, and diagnostics.

  function scheduledFrame({ timestamp: nowMs }) {
    // The scheduler already isolates a throwing subscriber from the rest of
    // the frame, but this module additionally needs its own specific
    // recovery (detach the visible sprite rather than leaving it frozen
    // mid-update) and its own error snapshot for the mobile debug readout,
    // so this catch stays even though the scheduler has an outer one too.
    if (window.AuthoredCutsceneRuntime?.isActive?.()) { detachAllSights(); return; } // The director suppresses combat HUD throughout dialogue and action cards.
    try {
      syncReadyTargets(nowMs);
      lastFrameError = null;
    } catch (error) {
      lastFrameError = String(error?.message || error);
      detachAllSights();
    }
    lastFrameMs = nowMs;
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
    const afflictions = resolvedAfflictions(state); // Existing affliction payload remains visible beside the new timed-debuff diagnostics.
    const timedDebuffs = window.ResourceSystem?.getTimedDebuffs?.(state.target) || []; // Shows live stack counts on the currently inspected target for mobile testing.
    const timedDebuffText = timedDebuffs.length ? timedDebuffs.map(entry => `${entry.name || entry.id}×${entry.stacks || 1} ${Number(entry.remainingS || 0).toFixed(1)}s`).join(', ') : '-'; // Compact target status line avoids requiring devtools.
    const lastResolution = window.Combat.quickAttackData?.lastResolution || null; // Last proc exposes exact Bleedout consumption and applied stack counts even after the target changes.
    const instantText = lastResolution?.appliedInstantEffects?.length ? lastResolution.appliedInstantEffects.map(entry => `${entry.id}:${entry.consumed ?? entry.damage ?? 0}`).join(', ') : '-'; // One-shot effects have no persistent target entry, so surface them from the resolution snapshot.
    badge.style.display = 'block';
    badge.textContent = [
      `Quick: ${state.equipped?.definition?.label || 'none'} (${state.equipped?.attackId || '-'})`,
      `Half-moon candidates: ${state.halfMoonCandidates}, cued: ${state.readyTargets.length}`,
      `Condition checks: ${state.checkedConditions}, avatar probes: ${state.visualProbes}`, 
      `Max reach: ${(state.reachPx / (Number(state.deps?.TILE) || 1)).toFixed(2)} tiles (${state.reachPx.toFixed(1)} px)`,
      `Nearest: ${state.target?.def?.label || state.target?.name || (state.target ? 'hostile' : 'none')}`,
      `Bonus ready: ${state.ready ? 'YES' : 'no'}`,
      `Condition matched: ${state.conditionReady ? 'YES' : 'no'}`,
      `Cooldown: ${Number(state.cooldownRemainingS || 0).toFixed(2)}s`,
      `Condition: ${state.equipped?.definition?.condKey || '-'}`,
      `Condition state: ${state.conditions ? JSON.stringify(state.conditions) : '-'}`,
      `Afflictions: ${afflictions.length ? afflictions.join(', ') : '-'}`,
      `Timed debuffs: ${timedDebuffText}`,
      `Last instant: ${instantText}`,
      `Impact bursts: ${[...sights.values()].filter(sight => sight.popStartedMs !== null).length}`,
      `Generic telegraph: ${state.target?.telegraphState || '-'}`,
      `Animal attack: ${state.target?._animalAttack?.id || '-'} / ${state.target?._animalAttack?.state?.stage || '-'}`,
      `Popup root: ${state.root ? 'yes' : 'no'}`,
      `Frame error: ${lastFrameError || '-'}`,
      `Reticle texture: ${face?.authored ? OPPORTUNITY_TEXTURE_URL : 'procedural fallback'}`,
      'Cue: forward half-moon within lunge + cone range',
    ].join('\n');
  }

  window.QuickAttackBonusIndicator = {
    getConditions,
    getReadyState,
    getAfflictions: () => resolvedAfflictions(getReadyState()),
    refresh: () => { reachCache = null; return syncReadyTargets(performance.now()); }, // Explicit UI refresh bypasses the short geometry cache.
    setDebugEnabled(enabled) {
      debugEnabled = !!enabled;
      updateDebugBadge(getReadyState());
    },
    snapshot: () => ({
      latestChange: 'Quick bonus uses forward half-moon broadphase; expensive visual probes only for ready targets; shared mastery effects and short reach/texture caches while checking bonuses every frame.',
      targetId: lastTarget?.id || null,
      reachPx: lastReachPx,
      checkedConditions: lastCheckedConditions,
      halfMoonCandidates: lastHalfMoonCandidates,
      visualProbes: lastVisualProbes,
      visible: sights.size > 0,
      visibleCount: sights.size,
      visibleTargetIds: [...sights.keys()].map(target => target?.id || target?.name || null),
      poppingTargetIds: [...sights.values()].filter(sight => sight.popStartedMs !== null).map(sight => sight.target?.id || null),
      lastFrameError,
    }),
  };

  window.CombatAttackEvents?.on('hit', popConfirmedBonus);

  window.RuntimeFrameScheduler.register(SCHEDULER_ID, scheduledFrame, {
    phase: 'pre-game', // Historically ran before gameLoop via independent RAF registration order; pre-game preserves that same ordering explicitly.
    owner: 'QuickAttackBonusIndicator',
    description: 'Shows bonus-ready reticles only for hostiles within the equipped Quick Attack lunge + cone reach.',
  });
})();

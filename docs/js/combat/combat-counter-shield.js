// Combat counter shield — the weapon tool's hold-slot defensive stance.
// While held it drains stamina; incoming hits are absorbed and can trigger a
// short automatic riposte. Presentation helpers below are cosmetic only.
(() => {
  "use strict";
  if (!window.Combat?.abilities) {
    console.error('combat-counter-shield.js requires combat-core.js + combat-loadout.js to load first');
    return;
  }

  let DRAIN_PER_S = 20;
  let MIN_STAMINA_TO_RAISE = 6;
  let COUNTER_COOLDOWN_S = 0.62;
  let COUNTER_DAMAGE_MUL = 4.4;
  let COUNTER_RANGE_MUL = 1.7;
  let COUNTER_HALF_CONE_DEG = 8;
  let COUNTER_KNOCKBACK_MUL = 2.25;

  const BLOCK_POSE = {
    neutral: { x: 0, y: 0,    z: 0.16, pitch: 0,  yaw: 0, bodyYaw: 0 },
    windup:  { x: 0, y: 0.05, z: 0.30, pitch: 14, yaw: 0, bodyYaw: -20 },
    strike:  { x: 0, y: 0.05, z: 0.30, pitch: 14, yaw: 0, bodyYaw: -20 },
  };
  let BLOCK_WINDUP_S = 0.12, BLOCK_STRIKE_S = 0.12;
  let COUNTER_WINDUP_S = 0.035, COUNTER_STRIKE_S = 0.16, COUNTER_HOLD_S = 1;

  // Counter Shield keeps four under-weapon layers. Offensive holds reuse
  // those plus six initially-transparent over-layers (two per Charged
  // Breaker milestone); the over-layers can also rise continuously for Flurry.
  const FIELD_COLOR = 0x75d9ff;
  const GLOW_LAYERS = [
    { kind: 'under', scale: 1.025, opacity: 0.72, pulse: 0.05 },
    { kind: 'under', scale: 1.065, opacity: 0.44, pulse: 0.08 },
    { kind: 'under', scale: 1.125, opacity: 0.25, pulse: 0.11 },
    { kind: 'under', scale: 1.205, opacity: 0.12, pulse: 0.15 },
    { kind: 'over', tier: 1, scale: 1.008, opacity: 0.28 },
    { kind: 'over', tier: 1, scale: 1.018, opacity: 0.20 },
    { kind: 'over', tier: 2, scale: 1.028, opacity: 0.17 },
    { kind: 'over', tier: 2, scale: 1.040, opacity: 0.14 },
    { kind: 'over', tier: 3, scale: 1.052, opacity: 0.12 },
    { kind: 'over', tier: 3, scale: 1.066, opacity: 0.10 },
  ];
  const TRAIL_LIFETIME_S = 0.16; // Short weapon-shaped afterimages live only during an active offensive swing.
  const TRAIL_MIN_ANGULAR_SPEED = 3.4; // rad/s; rejects Charged Breaker's slow windup but catches actual swings.
  const TRAIL_MIN_LINEAR_SPEED = 1.1; // world units/s; catches fast translational weapon movement as a fallback.

  function now() { return performance.now() / 1000; }

  function findPlayerToolHolder(deps) {
    const scene = deps?.getActiveScene?.();
    if (!scene?.children) return null;
    for (const child of scene.children) {
      if (!child || child.name === 'banditToolHolder') continue;
      if (child.children?.some(mesh => !!mesh?.userData?.toolPlane)) return child;
    }
    return null;
  }

  const previousCombatInit = window.Combat.init;
  if (typeof previousCombatInit === 'function') {
    window.Combat.init = function initWithPlayerToolHolder(injectedDeps) {
      if (injectedDeps && typeof injectedDeps.toolHolder !== 'function') {
        injectedDeps.toolHolder = () => findPlayerToolHolder(injectedDeps);
        injectedDeps.toolHolderDebugSource = 'active-scene-toolPlane-scan';
      }
      return previousCombatInit(injectedDeps);
    };
  }

  if (!window.Combat._heavyTelegraphIterableCompatInstalled) {
    const previousCombatUpdate = window.Combat.update;
    window.Combat.update = function heavyTelegraphIterableCompatUpdate(dt) {
      const result = previousCombatUpdate(dt);
      const deps = window.Combat.deps;
      const visualApi = window.Combat.heavyTelegraphVisuals;
      const hostiles = deps?.hostileObjects;
      if (
        visualApi?.update &&
        deps?.player &&
        hostiles &&
        !Array.isArray(hostiles) &&
        typeof hostiles[Symbol.iterator] === 'function'
      ) {
        deps.hostileObjects = Array.from(hostiles);
        try {
          visualApi.update(dt);
        } finally {
          deps.hostileObjects = hostiles;
        }
      }
      return result;
    };
    window.Combat._heavyTelegraphIterableCompatInstalled = true;
    window.__farmLog?.('[heavy-telegraph] iterable hostile collection compatibility tick installed.', 'info', 'combat');
  }

  const silhouetteByHolder = new Map();
  const offensiveGlowByOwner = new Map(); // Used by held offensive techniques to reuse Counter Shield's weapon-silhouette language without particle emitters.
  const trailGhosts = []; // Active weapon-shape afterimages; never updated while no offensive glow request is active.
  const trailSampleBySource = new WeakMap(); // Last sampled world transform per real weapon mesh while an offensive attack is active.
  let externalWeaponGlowActive = false; // Set by enemy heavy presentation only while a bandit heavy/Counter Shield is actually active.
  let cleanupVisualsNextTick = false; // Runs one final disposal pass immediately after an effect ends, then returns to the idle O(1) gate.
  const OFFENSIVE_CHARGE_COLOR = 0xffc85a; // Used by bandit Charged Breaker so its shared silhouette glow matches the player's authored charge color.

  function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }

  function setOffensiveWeaponGlow(owner, intensity, options = {}) {
    if (!owner) return;
    const strength = clamp01(intensity);
    if (strength <= 0) { offensiveGlowByOwner.delete(owner); return; }
    offensiveGlowByOwner.set(owner, {
      owner,
      intensity: strength,
      expansion: clamp01(options.expansion ?? strength),
      color: Number.isFinite(Number(options.color)) ? Number(options.color) : 0xffc85a,
      label: options.label || owner,
      flowStrength: clamp01(options.flowStrength ?? 0),
      flowSpeed: Math.max(0, Number(options.flowSpeed) || 0),
      overlayMode: options.overlayMode || 'none',
      overlayProgress: clamp01(options.overlayProgress ?? 0),
      overlayLevel: Math.max(0, Math.floor(Number(options.overlayLevel) || 0)),
      flare: clamp01(options.flare ?? 0),
      motionTrail: !!options.motionTrail,
    });
  }

  function clearOffensiveWeaponGlow(owner) {
    if (owner) offensiveGlowByOwner.delete(owner);
    cleanupVisualsNextTick = true;
  }

  function strongestOffensiveGlow() {
    let strongest = null;
    for (const glow of offensiveGlowByOwner.values()) {
      if (!strongest || glow.intensity > strongest.intensity) strongest = glow;
    }
    return strongest;
  }

  function setExternalWeaponGlowActive(active) {
    const next = !!active;
    if (externalWeaponGlowActive && !next) cleanupVisualsNextTick = true;
    externalWeaponGlowActive = next;
  }

  function toolPlaneSources(holder) {
    const roots = (holder?.children || []).filter(child =>
      !!child?.userData?.toolPlane &&
      child.name !== 'counter-shield-weapon-glow' &&
      !child?.userData?.counterShieldSilhouetteGlow
    );
    const sources = [];
    for (const root of roots) {
      root.traverse?.(obj => {
        if (
          obj?.isMesh &&
          obj.geometry &&
          obj.material &&
          !obj.userData?.counterShieldSilhouetteGlow
        ) sources.push(obj);
      });
    }
    return sources;
  }

  function sourceTexture(source) {
    const mats = Array.isArray(source?.material) ? source.material : [source?.material];
    for (const material of mats) {
      if (material?.map) return material.map;
      if (material?.alphaMap) return material.alphaMap;
    }
    return null;
  }

  function makeSilhouetteMaterial(texture, opacity) {
    if (texture) {
      return new THREE.ShaderMaterial({
        uniforms: {
          map: { value: texture },
          glowColor: { value: new THREE.Color(FIELD_COLOR) },
          glowOpacity: { value: opacity },
          flowTime: { value: 0 },
          flowStrength: { value: 0 },
          flowSpeed: { value: 0 },
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D map;
          uniform vec3 glowColor;
          uniform float glowOpacity;
          uniform float flowTime;
          uniform float flowStrength;
          uniform float flowSpeed;
          varying vec2 vUv;
          void main() {
            float a = texture2D(map, vUv).a;
            if (a < 0.01) discard;
            // Weapon art is authored base→tip on local V. The negative time
            // phase makes bright tongues travel from V=0 toward V=1 instead
            // of breathing outward around the silhouette.
            float tongue = pow(0.5 + 0.5 * sin(vUv.y * 15.0 - flowTime * flowSpeed), 3.0);
            float tipLift = mix(0.78, 1.16, vUv.y);
            float flow = mix(1.0, (0.62 + tongue * 0.72) * tipLift, flowStrength);
            gl_FragColor = vec4(glowColor * flow, a * glowOpacity * flow);
          }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
    }
    return new THREE.MeshBasicMaterial({
      color: FIELD_COLOR,
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
  }

  function disposeSilhouetteEntry(entry) {
    for (const layer of entry?.layers || []) {
      layer.mesh.parent?.remove(layer.mesh);
      layer.mesh.material?.dispose?.();
    }
  }

  function rebuildWeaponSilhouette(holder, sources) {
    const old = silhouetteByHolder.get(holder);
    if (old) disposeSilhouetteEntry(old);
    const layers = [];
    sources.forEach((source, sourceIndex) => {
      const texture = sourceTexture(source);
      GLOW_LAYERS.forEach((spec, layerIndex) => {
        const material = makeSilhouetteMaterial(texture, spec.opacity);
        const mesh = new THREE.Mesh(source.geometry, material);
        mesh.name = 'counter-shield-weapon-silhouette-glow';
        mesh.userData.counterShieldSilhouetteGlow = true;
        mesh.userData.baseOpacity = spec.opacity;
        mesh.userData.baseScaleFactor = spec.scale;
        mesh.userData.pulseAmount = spec.pulse || 0;
        mesh.userData.layerIndex = layerIndex;
        mesh.userData.layerKind = spec.kind;
        mesh.userData.layerTier = spec.tier || 0;
        mesh.userData.overlayIndex = spec.kind === 'over' ? Math.max(0, layerIndex - 4) : -1;
        mesh.userData.phase = sourceIndex * 0.47 + layerIndex * 0.91;
        // Parent directly to the REAL rendered weapon mesh. Identity local
        // transform means the glow inherits the weapon's final render
        // position/rotation automatically, even if the weapon moves later in
        // the frame after Combat.update.
        mesh.position.set(0, 0, 0);
        mesh.quaternion.identity();
        mesh.scale.setScalar(1);
        mesh.renderOrder = spec.kind === 'over'
          ? Number(source.renderOrder || 0) + 4 + layerIndex
          : Number(source.renderOrder || 0) - 8 - layerIndex;
        source.add(mesh);
        layers.push({ source, mesh });
      });
    });
    const entry = { holder, sources, layers };
    silhouetteByHolder.set(holder, entry);
    return entry;
  }

  function sameSources(a, b) {
    if (!a || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function rootSceneForSource(source) {
    let node = source;
    while (node?.parent) node = node.parent;
    return node?.isScene ? node : window.Combat.deps?.getActiveScene?.();
  }

  function removeTrailGhost(ghost) {
    ghost?.mesh?.parent?.remove(ghost.mesh);
    ghost?.mesh?.material?.dispose?.();
  }

  function clearTrailGhosts() {
    while (trailGhosts.length) removeTrailGhost(trailGhosts.pop());
  }

  function updateTrailGhosts(timeS) {
    for (let i = trailGhosts.length - 1; i >= 0; i--) {
      const ghost = trailGhosts[i];
      const age = Math.max(0, timeS - ghost.bornAt);
      if (age >= TRAIL_LIFETIME_S) {
        removeTrailGhost(ghost);
        trailGhosts.splice(i, 1);
        continue;
      }
      const fade = 1 - age / TRAIL_LIFETIME_S;
      const opacity = ghost.baseOpacity * fade * fade;
      if (ghost.mesh.material.uniforms?.glowOpacity) ghost.mesh.material.uniforms.glowOpacity.value = opacity;
      else ghost.mesh.material.opacity = opacity;
    }
  }

  function maybeSpawnMotionTrail(source, style, timeS, color) {
    if (!style.motionTrail || !source?.parent) return;
    source.updateWorldMatrix?.(true, false);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    source.matrixWorld.decompose(position, quaternion, scale);

    const previous = trailSampleBySource.get(source);
    trailSampleBySource.set(source, {
      position: position.clone(),
      quaternion: quaternion.clone(),
      sampledAt: timeS,
    });
    if (!previous) return;
    const dt = Math.max(1 / 240, timeS - previous.sampledAt);
    const angularSpeed = previous.quaternion.angleTo(quaternion) / dt;
    const linearSpeed = previous.position.distanceTo(position) / dt;
    if (angularSpeed < TRAIL_MIN_ANGULAR_SPEED && linearSpeed < TRAIL_MIN_LINEAR_SPEED) return;

    const scene = rootSceneForSource(source);
    if (!scene?.add) return;
    const material = makeSilhouetteMaterial(sourceTexture(source), 0.20);
    if (material.uniforms?.glowColor) material.uniforms.glowColor.value.setHex(color);
    if (material.uniforms?.flowStrength) material.uniforms.flowStrength.value = clamp01(style.flowStrength ?? 0);
    if (material.uniforms?.flowSpeed) material.uniforms.flowSpeed.value = Math.max(0, Number(style.flowSpeed) || 0);
    if (material.uniforms?.flowTime) material.uniforms.flowTime.value = timeS;
    if (material.color) material.color.setHex?.(color);
    const mesh = new THREE.Mesh(source.geometry, material);
    mesh.name = 'weapon-charge-motion-trail';
    mesh.userData.weaponChargeMotionTrail = true;
    mesh.position.copy(position);
    mesh.quaternion.copy(quaternion);
    mesh.scale.copy(scale).multiplyScalar(1.02 + clamp01(style.intensity) * 0.025);
    mesh.renderOrder = Number(source.renderOrder || 0) + 1;
    scene.add(mesh);
    trailGhosts.push({ mesh, bornAt: timeS, baseOpacity: 0.20 + clamp01(style.intensity) * 0.16 });
  }

  function overlayOpacityScale(mesh, style) {
    if (mesh.userData.layerKind !== 'over') return 1;
    if (style.overlayMode === 'stepped') {
      return Number(style.overlayLevel || 0) >= Number(mesh.userData.layerTier || 0) ? 1 : 0;
    }
    if (style.overlayMode === 'linear') {
      const index = Math.max(0, Number(mesh.userData.overlayIndex) || 0);
      const start = index * 0.08;
      return clamp01((clamp01(style.overlayProgress) - start) / 0.58);
    }
    return 0;
  }

  function syncWeaponSilhouette(holder, timeS, style = {}) {
    const sources = toolPlaneSources(holder);
    let entry = silhouetteByHolder.get(holder);
    if (!entry || !sameSources(entry.sources, sources)) entry = rebuildWeaponSilhouette(holder, sources);
    const intensity = clamp01(style.intensity ?? 1);
    const expansion = clamp01(style.expansion ?? intensity);
    const color = Number.isFinite(Number(style.color)) ? Number(style.color) : FIELD_COLOR;
    const isOffensive = style.label !== 'Counter Shield';
    const opacityScale = isOffensive ? Math.max(0.025, intensity) : 1;
    const expansionScale = isOffensive ? expansion : 1;
    const flare = clamp01(style.flare ?? 0);

    for (const source of entry.sources) maybeSpawnMotionTrail(source, style, timeS, color);

    for (const layer of entry.layers) {
      const { source, mesh } = layer;
      if (!source.parent) {
        mesh.visible = false;
        continue;
      }
      // Exact alignment is structural, not sampled: the glow is a child of
      // the real weapon mesh with an identity local transform.
      if (mesh.parent !== source) source.add(mesh);
      mesh.position.set(0, 0, 0);
      mesh.quaternion.identity();

      const pulseAmount = isOffensive ? 0 : mesh.userData.pulseAmount;
      const pulse = 1 + Math.sin(timeS * 5.2 + mesh.userData.phase) * pulseAmount;
      const authoredExpansion = 1 + (mesh.userData.baseScaleFactor - 1) * expansionScale;
      const flareScale = 1 + flare * 0.075;
      mesh.scale.setScalar(authoredExpansion * pulse * flareScale);

      const layerIndex = Number(mesh.userData.layerIndex || 0);
      mesh.renderOrder = mesh.userData.layerKind === 'over'
        ? Number(source.renderOrder || 0) + 4 + layerIndex
        : Number(source.renderOrder || 0) - 8 - layerIndex;
      mesh.visible = source.visible !== false;

      const opacityPulse = isOffensive ? 1 : 0.90 + Math.sin(timeS * 4.8 + mesh.userData.phase) * 0.10;
      const overlayScale = overlayOpacityScale(mesh, style);
      const opacity = mesh.userData.baseOpacity * opacityScale * opacityPulse * overlayScale * (1 + flare * 1.9);
      if (mesh.material.uniforms?.glowOpacity) {
        mesh.material.uniforms.glowOpacity.value = opacity;
        mesh.material.uniforms.glowColor?.value?.setHex?.(color);
        if (mesh.material.uniforms.flowTime) mesh.material.uniforms.flowTime.value = timeS;
        if (mesh.material.uniforms.flowStrength) mesh.material.uniforms.flowStrength.value = clamp01(style.flowStrength ?? 0);
        if (mesh.material.uniforms.flowSpeed) mesh.material.uniforms.flowSpeed.value = Math.max(0, Number(style.flowSpeed) || 0);
      } else {
        mesh.material.opacity = opacity;
        mesh.material.color?.setHex?.(color);
      }
    }
    entry.style = {
      intensity, expansion, color, label: style.label || 'Counter Shield',
      overlayMode: style.overlayMode || 'none',
      overlayProgress: clamp01(style.overlayProgress ?? 0),
      overlayLevel: Math.max(0, Math.floor(Number(style.overlayLevel) || 0)),
      flare,
      motionTrail: !!style.motionTrail,
    };
    return entry;
  }

  function collectNamedVisible(scene, name) {
    const found = [];
    scene?.traverse?.(obj => {
      if (obj?.name === name && obj.visible !== false) found.push(obj);
    });
    return found;
  }

  function hideCounterShieldFields(scene) {
    scene?.traverse?.(obj => {
      if (obj?.name === 'counter-shield-field') obj.visible = false;
    });
  }

  function syncAuthoredCounterShieldVisuals() {
    // This is the only per-frame gate while idle. No holder/source discovery,
    // scene traversal, shader updates, or trail sampling happens until one of
    // the relevant heavy effects is actually active.
    if (!offensiveGlowByOwner.size && !externalWeaponGlowActive && !cleanupVisualsNextTick) return;

    const timeS = performance.now() / 1000;
    const liveHolders = new Set();

    if (externalWeaponGlowActive) {
      const activeVisuals = window.Combat.heavyTelegraphVisuals?.activeVisuals?.();
      if (activeVisuals) {
        for (const visual of activeVisuals) {
          if (visual.fieldGroup) visual.fieldGroup.visible = false;
          if (!visual?.holder || (!visual.defensive && !visual.offensive)) continue;
          liveHolders.add(visual.holder);
          if (visual.defensive) {
            syncWeaponSilhouette(visual.holder, timeS, {
              intensity: 1,
              expansion: 1,
              color: FIELD_COLOR,
              label: 'Counter Shield',
            });
          } else {
            const targetCharge = clamp01(visual.actor?._banditSwingPoseScale ?? 1);
            const action = visual.actor?._banditAction;
            const windupProgress = action?.windupS > 0
              ? clamp01((Number(action.t) || 0) / action.windupS)
              : 1;
            const liveCharge = visual.actor?.telegraphState === 'windup'
              ? targetCharge * windupProgress
              : targetCharge;
            const readyPose = Number(window.Combat.chargedBreakerData?.MIN_READY_POSE) || 0.48;
            const overlayLevel = liveCharge >= 0.999 ? 3 : liveCharge >= 0.5 ? 2 : liveCharge >= readyPose ? 1 : 0;
            syncWeaponSilhouette(visual.holder, timeS, {
              intensity: Math.max(0.025, liveCharge),
              expansion: liveCharge,
              color: OFFENSIVE_CHARGE_COLOR,
              label: 'Charged Breaker',
              flowStrength: 1,
              flowSpeed: 8.5,
              overlayMode: 'stepped',
              overlayLevel,
              overlayProgress: liveCharge,
              motionTrail: true,
            });
          }
          if (visual.weaponGlowGroup) visual.weaponGlowGroup.visible = false;
        }
      }
    }

    const offensiveGlow = strongestOffensiveGlow();
    const playerHolder = offensiveGlow ? window.Combat.deps?.toolHolder?.() || null : null;
    if (offensiveGlow && playerHolder && !liveHolders.has(playerHolder)) {
      liveHolders.add(playerHolder);
      syncWeaponSilhouette(playerHolder, timeS, offensiveGlow);
    }

    updateTrailGhosts(timeS);

    for (const [holder, entry] of silhouetteByHolder) {
      if (liveHolders.has(holder)) continue;
      disposeSilhouetteEntry(entry);
      silhouetteByHolder.delete(holder);
    }

    if (!offensiveGlowByOwner.size && !externalWeaponGlowActive) clearTrailGhosts();
    cleanupVisualsNextTick = false;
  }

  function authoredVisualSnapshot() {
    const scene = window.Combat.deps?.getActiveScene?.();
    let fieldObjects = 0;
    let visibleFieldObjects = 0;
    scene?.traverse?.(obj => {
      if (obj?.name !== 'counter-shield-field') return;
      fieldObjects++;
      if (obj.visible !== false) visibleFieldObjects++;
    });
    let glowMeshCount = 0;
    for (const entry of silhouetteByHolder.values()) glowMeshCount += entry.layers.length;
    return {
      presentation: 'weapon-glow-only',
      fieldObjects,
      visibleFieldObjects,
      silhouetteHolders: silhouetteByHolder.size,
      silhouetteGlowMeshes: glowMeshCount,
      glowLayersPerWeaponMesh: GLOW_LAYERS.length,
      glowLayering: 'weapon-child under+over layers',
      activeMotionTrailGhosts: trailGhosts.length,
      runtimeActive: !!offensiveGlowByOwner.size || externalWeaponGlowActive,
      offensiveGlowRequests: [...offensiveGlowByOwner.values()].map(glow => ({ ...glow })),
    };
  }

  if (!window.Combat._counterShieldAuthoredVisualsInstalled) {
    const previousCombatUpdate = window.Combat.update;
    window.Combat.update = function counterShieldAuthoredPresentationUpdate(dt) {
      const result = previousCombatUpdate(dt);
      if (offensiveGlowByOwner.size || externalWeaponGlowActive || cleanupVisualsNextTick) {
        syncAuthoredCounterShieldVisuals();
      }
      return result;
    };
    window.Combat._counterShieldAuthoredVisualsInstalled = true;
  }
  window.Combat.counterShieldAuthoredVisuals = {
    update: syncAuthoredCounterShieldVisuals,
    snapshot: authoredVisualSnapshot,
  };
  window.Combat.weaponChargeGlow = {
    set: setOffensiveWeaponGlow,
    clear: clearOffensiveWeaponGlow,
    setExternalActive: setExternalWeaponGlowActive,
    snapshot: () => ({
      requests: [...offensiveGlowByOwner.values()].map(glow => ({ ...glow })),
      silhouette: authoredVisualSnapshot(),
    }),
  };

  function register() {
    let active = false;
    let lastCounterAt = -99;
    let presentationSceneBackup = null;
    let presentationSceneHadOwn = false;
    let presentationSceneBridged = false;
    let presentationSceneReady = false;
    let lastPresentationLogSignature = '';
    let reassertBlockAt = -1;

    function resolvePlayerPresentationScene(deps) {
      const activeScene = deps.getActiveScene?.();
      if (activeScene?.isScene) return activeScene;
      let node = deps.toolHolder?.() || null;
      while (node?.parent) node = node.parent;
      return node?.isScene ? node : null;
    }

    function bridgePlayerPresentationScene(deps) {
      const scene = resolvePlayerPresentationScene(deps);
      presentationSceneReady = !!scene;
      if (!scene || !deps.player) return false;
      if (!presentationSceneBridged) {
        presentationSceneHadOwn = Object.prototype.hasOwnProperty.call(deps.player, 'scene');
        presentationSceneBackup = deps.player.scene;
        presentationSceneBridged = true;
      }
      deps.player.scene = scene;
      return true;
    }

    function restorePlayerPresentationScene(deps) {
      if (!presentationSceneBridged || !deps?.player) {
        presentationSceneReady = false;
        return;
      }
      if (presentationSceneHadOwn) deps.player.scene = presentationSceneBackup;
      else delete deps.player.scene;
      presentationSceneBackup = null;
      presentationSceneHadOwn = false;
      presentationSceneBridged = false;
      presentationSceneReady = false;
    }

    function getPresentationSnapshot() {
      const heavyEntries = window.Combat.heavyTelegraphVisuals?.snapshot?.() || [];
      const heavyRenderer = heavyEntries.find(entry => entry.actor === 'player') || null;
      const holder = window.Combat.deps?.toolHolder?.() || null;
      const hostileCollection = window.Combat.deps?.hostileObjects;
      return {
        active,
        sceneBridged: presentationSceneBridged,
        sceneReady: presentationSceneReady,
        holderReady: !!holder,
        holderSource: window.Combat.deps?.toolHolderDebugSource || 'combat-init',
        holderName: holder?.name || null,
        holderChildren: holder?.children?.length ?? 0,
        hostileCollectionType: hostileCollection?.constructor?.name || typeof hostileCollection,
        rendererCompatInstalled: !!window.Combat._heavyTelegraphIterableCompatInstalled,
        heavyRenderer,
        authoredVisuals: authoredVisualSnapshot(),
      };
    }

    function logPresentationSnapshot(reason, force = false) {
      const snapshot = getPresentationSnapshot();
      const signature = JSON.stringify(snapshot);
      if (!force && signature === lastPresentationLogSignature) return snapshot;
      lastPresentationLogSignature = signature;
      window.__farmLog?.(`[counter-shield-vfx] ${reason} ${signature}`, 'info', 'combat');
      return snapshot;
    }

    function raiseBlockPose(deps) {
      deps.triggerWeaponHoldVisual(BLOCK_WINDUP_S + BLOCK_STRIKE_S, {
        anim: 'sweep',
        pose: BLOCK_POSE,
        windupFrac: BLOCK_WINDUP_S / (BLOCK_WINDUP_S + BLOCK_STRIKE_S),
        strikeFrac: 1,
      });
    }

    function tryAbsorb(amount) {
      if (!active) return false;
      const deps = window.Combat.deps;
      const effects = window.CombatProgression?.getEffects(deps.currentWeaponKey(), 'counterShield')
        || { afflictions: {}, stats: {} };
      const staminaCost = Math.max(MIN_STAMINA_TO_RAISE, amount * 0.5)
        * (1 + (effects.stats.absorbMul || 0));
      window.ResourceSystem?.spendStamina(deps.player, staminaCost, 'Counter Shield block');
      deps.playCounterShieldBlockSfx?.(deps.player.x, deps.player.y, deps.getCurrentArea());
      deps.showToast(`Blocked! (-${Math.round(staminaCost)} stamina)`, true);
      deps.spawnBurstEffect({ color: '#40ccff', rangePx: deps.TILE * 1.8 });
      triggerCounter(effects);
      return true;
    }

    function triggerCounter(effects) {
      const t = now();
      const cooldownS = COUNTER_COOLDOWN_S * (1 + (effects.stats.cooldownMul || 0));
      if (t - lastCounterAt < cooldownS) return;
      const deps = window.Combat.deps;
      if (window.Combat.isStaggered(deps.player)) return;
      lastCounterAt = t;
      const baseAbil = deps.weaponAbility('cut')
        || { damage: 14, rangePx: deps.TILE * 1.05, knockbackPxS: 360 };
      const damage = Math.round(baseAbil.damage * COUNTER_DAMAGE_MUL * (1 + (effects.stats.damageMul || 0)));
      const rangePx = baseAbil.rangePx * COUNTER_RANGE_MUL;
      const halfConeRad = COUNTER_HALF_CONE_DEG * Math.PI / 180;
      const knockbackPxS = baseAbil.knockbackPxS * COUNTER_KNOCKBACK_MUL;
      const counterDurationS = COUNTER_WINDUP_S + COUNTER_STRIKE_S;

      deps.triggerWeaponSwingVisual(counterDurationS, {
        anim: 'thrust',
        windupFrac: COUNTER_WINDUP_S / counterDurationS,
        strikeFrac: 1,
        holdS: COUNTER_HOLD_S,
        afflictionIds: Object.keys(effects.afflictions),
        coneRangePx: rangePx,
        coneHalfConeRad: halfConeRad,
        coneAngle: deps.player.angle,
      });
      const counterReturnTailS = Math.max(0.12, counterDurationS * 0.35);
      reassertBlockAt = now() + counterDurationS + counterReturnTailS + COUNTER_HOLD_S;

      window.Combat.beginStagedAction({
        windupS: COUNTER_WINDUP_S,
        strikeS: COUNTER_STRIKE_S,
        recoverS: 0,
        onStrike: () => {
          deps.clearVegetationInAttackCone?.(
            deps.player.x, deps.player.y, deps.player.angle, rangePx, halfConeRad
          );
          let hits = 0, lastName = '';
          for (const c of deps.hostileObjects) {
            if (c.health <= 0 || c.areaId !== deps.getCurrentArea()) continue;
            if (!deps.inCone(
              deps.player.x, deps.player.y, deps.player.angle,
              c.x, c.y, rangePx, halfConeRad
            )) continue;
            deps.damageCreature(
              c, damage, deps.player.x, deps.player.y, knockbackPxS,
              {
                tag: deps.currentWeaponDamageType(),
                category: 'defensiveHold',
                afflictionBonuses: effects.afflictions,
              }
            );
            deps.playWeaponHitSfx?.(
              deps.currentWeaponDamageType(), c.x, c.y, c.areaId, undefined, 'large'
            );
            hits++;
            lastName = c.def.label;
          }
          if (hits > 0) {
            deps.showToast(
              `Shield Counter Riposte: hit ${hits > 1 ? hits + ' creatures' : 'the ' + lastName}!`,
              true
            );
            deps.awardWeaponMasteryXp();
          }
        },
        data: {
          meleeThreat: window.Combat.playerMeleeThreat(rangePx, halfConeRad, {
            yaw: deps.player.angle,
            source: 'Counter Shield',
          }),
        },
      });
    }

    function onHoldStart() {
      const deps = window.Combat.deps;
      if (deps.player.stamina <= MIN_STAMINA_TO_RAISE) {
        restorePlayerPresentationScene(deps);
        logPresentationSnapshot('raise-failed', true);
        deps.showToast('Counter Shield failed: no stamina.', false);
        return;
      }
      bridgePlayerPresentationScene(deps);
      active = true;
      reassertBlockAt = -1;
      window.Combat.setPlayerDamageInterceptor(tryAbsorb);
      deps.showToast('Counter Shield raised: blocks and counters on contact.', true);
      raiseBlockPose(deps);
      logPresentationSnapshot('raised', true);
    }

    function onHoldUpdate(_slot, dt) {
      if (!active) return;
      const deps = window.Combat.deps;
      bridgePlayerPresentationScene(deps);
      logPresentationSnapshot('state-change');
      const drainMul = 1 + (
        window.CombatProgression?.getEffects(deps.currentWeaponKey(), 'counterShield')?.stats.drainMul || 0
      );
      window.ResourceSystem?.spendStamina(
        deps.player,
        Math.min(deps.player.stamina, DRAIN_PER_S * drainMul * dt),
        'Counter Shield (holding)'
      );
      if (deps.player.stamina <= 0) {
        active = false;
        window.Combat.setPlayerDamageInterceptor(null);
        restorePlayerPresentationScene(deps);
        logPresentationSnapshot('dropped-empty', true);
        deps.showToast('Counter Shield dropped: stamina empty.', false);
        return;
      }
      if (reassertBlockAt > 0 && now() >= reassertBlockAt) {
        reassertBlockAt = -1;
        raiseBlockPose(deps);
      }
    }

    function onHoldEnd() {
      if (!active) return;
      active = false;
      reassertBlockAt = -1;
      const deps = window.Combat.deps;
      deps.cancelWeaponSwingHold();
      window.Combat.setPlayerDamageInterceptor(null);
      restorePlayerPresentationScene(deps);
      logPresentationSnapshot('lowered', true);
      deps.showToast('Counter Shield lowered.', false);
    }

    window.Combat.abilities.register('counterShield', {
      label: 'Counter Shield',
      slotFamily: 'hold',
      category: 'defensiveHold',
      onHoldStart,
      onHoldUpdate,
      onHoldEnd,
      isActive: () => active,
    });

    window.Combat.counterShieldPlayerPresentation = {
      snapshot: getPresentationSnapshot,
      logSnapshot: (reason = 'manual') => logPresentationSnapshot(reason, true),
      resolveToolHolder: () => window.Combat.deps?.toolHolder?.() || null,
    };
  }

  register();

  window.Combat.counterShieldData = {
    COUNTER_DAMAGE_MUL,
    COUNTER_RANGE_MUL,
    COUNTER_HALF_CONE_DEG,
    COUNTER_KNOCKBACK_MUL,
  };

  window.Combat.applyCounterShieldConfig = function (cfg) {
    if (!cfg) return;
    if (cfg.DRAIN_PER_S != null) DRAIN_PER_S = cfg.DRAIN_PER_S;
    if (cfg.MIN_STAMINA_TO_RAISE != null) MIN_STAMINA_TO_RAISE = cfg.MIN_STAMINA_TO_RAISE;
    if (cfg.COUNTER_COOLDOWN_S != null) COUNTER_COOLDOWN_S = cfg.COUNTER_COOLDOWN_S;
    if (cfg.COUNTER_DAMAGE_MUL != null) COUNTER_DAMAGE_MUL = cfg.COUNTER_DAMAGE_MUL;
    if (cfg.COUNTER_RANGE_MUL != null) COUNTER_RANGE_MUL = cfg.COUNTER_RANGE_MUL;
    if (cfg.COUNTER_HALF_CONE_DEG != null) COUNTER_HALF_CONE_DEG = cfg.COUNTER_HALF_CONE_DEG;
    if (cfg.COUNTER_KNOCKBACK_MUL != null) COUNTER_KNOCKBACK_MUL = cfg.COUNTER_KNOCKBACK_MUL;
    if (cfg.BLOCK_WINDUP_S != null) BLOCK_WINDUP_S = cfg.BLOCK_WINDUP_S;
    if (cfg.BLOCK_STRIKE_S != null) BLOCK_STRIKE_S = cfg.BLOCK_STRIKE_S;
    if (cfg.COUNTER_WINDUP_S != null) COUNTER_WINDUP_S = cfg.COUNTER_WINDUP_S;
    if (cfg.COUNTER_STRIKE_S != null) COUNTER_STRIKE_S = cfg.COUNTER_STRIKE_S;
    if (cfg.COUNTER_HOLD_S != null) COUNTER_HOLD_S = cfg.COUNTER_HOLD_S;
    Object.assign(window.Combat.counterShieldData, {
      COUNTER_DAMAGE_MUL,
      COUNTER_RANGE_MUL,
      COUNTER_HALF_CONE_DEG,
      COUNTER_KNOCKBACK_MUL,
    });
  };
})();

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

  // Counter Shield is intentionally weapon-only: four additive alpha-shaped
  // layers sit behind the real weapon PNG. The legacy field/icon objects are
  // left owned by the shared renderer for state compatibility, but forced
  // invisible every frame so no bubble/emblem leaks into gameplay.
  const FIELD_COLOR = 0x75d9ff;
  const GLOW_LAYERS = [
    { scale: 1.025, opacity: 0.72, pulse: 0.05 },
    { scale: 1.065, opacity: 0.44, pulse: 0.08 },
    { scale: 1.125, opacity: 0.25, pulse: 0.11 },
    { scale: 1.205, opacity: 0.12, pulse: 0.15 },
  ];

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
          varying vec2 vUv;
          void main() {
            float a = texture2D(map, vUv).a;
            if (a < 0.01) discard;
            gl_FragColor = vec4(glowColor, a * glowOpacity);
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
        mesh.userData.pulseAmount = spec.pulse;
        mesh.userData.layerIndex = layerIndex;
        mesh.userData.phase = sourceIndex * 0.47 + layerIndex * 0.91;
        mesh.renderOrder = Number(source.renderOrder || 0) - 8 - layerIndex;
        source.parent?.add(mesh);
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

  function syncWeaponSilhouette(holder, timeS) {
    const sources = toolPlaneSources(holder);
    let entry = silhouetteByHolder.get(holder);
    if (!entry || !sameSources(entry.sources, sources)) entry = rebuildWeaponSilhouette(holder, sources);
    for (const layer of entry.layers) {
      const { source, mesh } = layer;
      if (!source.parent) {
        mesh.visible = false;
        continue;
      }
      if (mesh.parent !== source.parent) source.parent.add(mesh);
      mesh.position.copy(source.position);
      mesh.quaternion.copy(source.quaternion);
      const pulse = 1 + Math.sin(timeS * 5.2 + mesh.userData.phase) * mesh.userData.pulseAmount;
      mesh.scale.copy(source.scale).multiplyScalar(mesh.userData.baseScaleFactor * pulse);
      mesh.renderOrder = Number(source.renderOrder || 0) - 8 - Number(mesh.userData.layerIndex || 0);
      mesh.visible = source.visible !== false;
      const opacityPulse = 0.90 + Math.sin(timeS * 4.8 + mesh.userData.phase) * 0.10;
      if (mesh.material.uniforms?.glowOpacity) {
        mesh.material.uniforms.glowOpacity.value = mesh.userData.baseOpacity * opacityPulse;
      } else {
        mesh.material.opacity = mesh.userData.baseOpacity * opacityPulse;
      }
    }
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
    let hidden = 0;
    scene?.traverse?.(obj => {
      if (obj?.name !== 'counter-shield-field') return;
      if (obj.visible !== false) hidden++;
      obj.visible = false;
    });
    return hidden;
  }

  function syncAuthoredCounterShieldVisuals() {
    const scene = window.Combat.deps?.getActiveScene?.();
    if (!scene?.isScene) return;

    hideCounterShieldFields(scene);

    const visibleGlowGroups = collectNamedVisible(scene, 'counter-shield-weapon-glow');
    const liveHolders = new Set();
    const timeS = performance.now() / 1000;
    for (const genericGlow of visibleGlowGroups) {
      const holder = genericGlow.parent;
      if (!holder) continue;
      liveHolders.add(holder);
      syncWeaponSilhouette(holder, timeS);
      genericGlow.visible = false;
    }

    for (const [holder, entry] of silhouetteByHolder) {
      if (liveHolders.has(holder)) continue;
      disposeSilhouetteEntry(entry);
      silhouetteByHolder.delete(holder);
    }
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
      glowLayering: 'beneath-weapon',
    };
  }

  if (!window.Combat._counterShieldAuthoredVisualsInstalled) {
    const previousCombatUpdate = window.Combat.update;
    window.Combat.update = function counterShieldAuthoredPresentationUpdate(dt) {
      const result = previousCombatUpdate(dt);
      syncAuthoredCounterShieldVisuals();
      return result;
    };
    window.Combat._counterShieldAuthoredVisualsInstalled = true;
  }
  window.Combat.counterShieldAuthoredVisuals = {
    update: syncAuthoredCounterShieldVisuals,
    snapshot: authoredVisualSnapshot,
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

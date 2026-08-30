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

  const FIELD_COLOR = 0x75d9ff;
  const FIELD_RADIUS = 0.724;

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

  let cachedArchIconKey = '';
  let cachedArchIconTexture = null;
  let pendingArchIconKey = '';
  const silhouetteByHolder = new Map();

  function liveCounterShieldButton() {
    const labeled = Array.from(document.querySelectorAll('.abt-label'))
      .find(label => /counter\s*shield/i.test(label.textContent || ''))
      ?.closest('button');
    return labeled || document.getElementById('btnAction2') || null;
  }

  function cssBackgroundUrl(el) {
    if (!el || typeof getComputedStyle !== 'function') return '';
    const value = getComputedStyle(el).backgroundImage || '';
    const match = value.match(/url\((?:"|')?(.*?)(?:"|')?\)/i);
    return match?.[1] || '';
  }

  function resolveArchIconDescriptor() {
    const button = liveCounterShieldButton();
    if (button) {
      const iconEl = button.querySelector('.abt-icon') || button;
      const img = (iconEl.matches?.('img') ? iconEl : iconEl.querySelector?.('img'))
        || button.querySelector('img');
      const src = img?.currentSrc || img?.src || img?.getAttribute?.('src') || '';
      if (src) return { key: `image:${src}`, kind: 'image', value: src };

      const styledCandidates = [iconEl, ...Array.from(button.querySelectorAll('*'))];
      for (const candidate of styledCandidates) {
        const bg = cssBackgroundUrl(candidate);
        if (bg) return { key: `image:${bg}`, kind: 'image', value: bg };
      }

      const svg = (iconEl.matches?.('svg') ? iconEl : iconEl.querySelector?.('svg'))
        || button.querySelector('svg');
      if (svg) {
        const markup = new XMLSerializer().serializeToString(svg);
        return { key: `svg:${markup}`, kind: 'svg', value: markup };
      }

      if (iconEl !== button) {
        const clone = iconEl.cloneNode(true);
        clone.querySelectorAll?.('.alcohol-swig-badge,.abt-key,.abt-label').forEach(node => node.remove());
        const text = (clone.textContent || '').trim();
        if (text) return { key: `glyph:${text}`, kind: 'glyph', value: text };
      }
    }

    const authored = window.Combat.abilities?.get?.('counterShield')?.icon;
    if (authored) {
      const text = String(authored);
      if (/^(?:https?:|data:|\.?\/)/i.test(text)) return { key: `image:${text}`, kind: 'image', value: text };
      return { key: `glyph:${text}`, kind: 'glyph', value: text };
    }
    return { key: 'glyph:🛡️', kind: 'glyph', value: '🛡️' };
  }

  function prepareTexture(texture) {
    if (!texture) return texture;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    if ('encoding' in texture && THREE.sRGBEncoding != null) texture.encoding = THREE.sRGBEncoding;
    texture.needsUpdate = true;
    return texture;
  }

  function makeGlyphTexture(glyph) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 152px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    ctx.shadowColor = 'rgba(117,217,255,.95)';
    ctx.shadowBlur = 18;
    ctx.globalAlpha = 0.94;
    ctx.fillText(glyph || '🛡️', 128, 132);
    return prepareTexture(new THREE.CanvasTexture(canvas));
  }

  function installArchTexture(key, texture) {
    if (!texture || key !== pendingArchIconKey) {
      texture?.dispose?.();
      return;
    }
    const old = cachedArchIconTexture;
    cachedArchIconKey = key;
    cachedArchIconTexture = prepareTexture(texture);
    pendingArchIconKey = '';
    if (old && old !== cachedArchIconTexture) old.dispose?.();
  }

  function ensureArchIconTexture() {
    const descriptor = resolveArchIconDescriptor();
    if (descriptor.key === cachedArchIconKey && cachedArchIconTexture) return cachedArchIconTexture;
    if (descriptor.key === pendingArchIconKey) return cachedArchIconTexture;

    if (descriptor.kind === 'glyph') {
      pendingArchIconKey = descriptor.key;
      installArchTexture(descriptor.key, makeGlyphTexture(descriptor.value));
      return cachedArchIconTexture;
    }

    let src = descriptor.value;
    if (descriptor.kind === 'svg') {
      src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(descriptor.value)}`;
    }
    pendingArchIconKey = descriptor.key;
    new THREE.TextureLoader().load(
      src,
      texture => installArchTexture(descriptor.key, texture),
      undefined,
      () => {
        if (pendingArchIconKey !== descriptor.key) return;
        pendingArchIconKey = 'glyph:🛡️';
        installArchTexture('glyph:🛡️', makeGlyphTexture('🛡️'));
      },
    );
    return cachedArchIconTexture;
  }

  function makeProjectionHemisphereGeometry(radius, rows = 14, columns = 24) {
    const vertices = [];
    const uvs = [];
    const indices = [];
    for (let row = 0; row <= rows; row++) {
      const v = row / rows;
      const elevation = -Math.PI / 2 + Math.PI * v;
      const cosElevation = Math.cos(elevation);
      for (let column = 0; column <= columns; column++) {
        const u = column / columns;
        const azimuth = -Math.PI / 2 + Math.PI * u;
        vertices.push(
          radius * cosElevation * Math.cos(azimuth),
          radius * Math.sin(elevation),
          radius * cosElevation * Math.sin(azimuth),
        );
        uvs.push(u, v);
      }
    }
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const a = row * (columns + 1) + column;
        const b = a + columns + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    return geometry;
  }

  const archProjectionGeometry = makeProjectionHemisphereGeometry(FIELD_RADIUS);

  function ensureFieldArchProjection(fieldGroup) {
    if (fieldGroup.userData?.icon) fieldGroup.userData.icon.visible = false;
    let projection = fieldGroup.children.find(child => child?.userData?.counterShieldArchProjection);
    if (!projection) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.56,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
        blending: THREE.NormalBlending,
        map: ensureArchIconTexture(),
      });
      projection = new THREE.Mesh(archProjectionGeometry, material);
      projection.name = 'counter-shield-arch-icon-projection';
      projection.userData.counterShieldArchProjection = true;
      projection.scale.setScalar(1.018);
      projection.renderOrder = 20;
      fieldGroup.add(projection);
    }
    const texture = ensureArchIconTexture();
    if (texture && projection.material.map !== texture) {
      projection.material.map = texture;
      projection.material.needsUpdate = true;
    }
    projection.visible = fieldGroup.visible;
    projection.material.opacity = 0.52 + Math.sin(performance.now() / 1000 * 4.2) * 0.055;
    return projection;
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
      [
        { scale: 1.035, opacity: 0.52 },
        { scale: 1.085, opacity: 0.20 },
      ].forEach((spec, layerIndex) => {
        const material = makeSilhouetteMaterial(texture, spec.opacity);
        const mesh = new THREE.Mesh(source.geometry, material);
        mesh.name = 'counter-shield-weapon-silhouette-glow';
        mesh.userData.counterShieldSilhouetteGlow = true;
        mesh.userData.baseOpacity = spec.opacity;
        mesh.userData.baseScaleFactor = spec.scale;
        mesh.userData.phase = sourceIndex * 0.53 + layerIndex * 1.17;
        mesh.renderOrder = Math.max(20, Number(source.renderOrder) + 12 + layerIndex);
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
      mesh.scale.copy(source.scale).multiplyScalar(
        mesh.userData.baseScaleFactor * (1 + Math.sin(timeS * 5.0 + mesh.userData.phase) * 0.025)
      );
      mesh.visible = source.visible !== false;
      if (mesh.material.uniforms?.glowOpacity) {
        mesh.material.uniforms.glowOpacity.value =
          mesh.userData.baseOpacity * (0.90 + Math.sin(timeS * 4.6 + mesh.userData.phase) * 0.10);
      } else {
        mesh.material.opacity =
          mesh.userData.baseOpacity * (0.90 + Math.sin(timeS * 4.6 + mesh.userData.phase) * 0.10);
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

  function syncAuthoredCounterShieldVisuals() {
    const scene = window.Combat.deps?.getActiveScene?.();
    if (!scene?.isScene) return;

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

    const visibleFields = collectNamedVisible(scene, 'counter-shield-field');
    for (const field of visibleFields) ensureFieldArchProjection(field);
  }

  function authoredVisualSnapshot() {
    const scene = window.Combat.deps?.getActiveScene?.();
    const fields = collectNamedVisible(scene, 'counter-shield-field');
    let projectionCount = 0;
    for (const field of fields) {
      projectionCount += field.children.filter(child => child?.userData?.counterShieldArchProjection).length;
    }
    let glowMeshCount = 0;
    for (const entry of silhouetteByHolder.values()) glowMeshCount += entry.layers.length;
    return {
      archIconKey: cachedArchIconKey || pendingArchIconKey || null,
      archTextureReady: !!cachedArchIconTexture,
      curvedProjectionCount: projectionCount,
      silhouetteHolders: silhouetteByHolder.size,
      silhouetteGlowMeshes: glowMeshCount,
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

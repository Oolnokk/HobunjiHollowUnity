// Combat Blink Dodge — the weapon tool's other hold-slot defensive option.
// The first movement input produces one invulnerable hop, then uninterrupted
// movement builds into a speed boost instead of auto-repeating hops. A sudden
// >90° input reversal while the hold remains active earns another hop without
// resetting that speed buildup. Registers under the 'hold' slot family beside
// combat-counter-shield.js so either can occupy hold1 or hold2.
(() => {
  "use strict";
  if (!window.Combat?.abilities) { console.error('combat-blink-dodge.js requires combat-core.js + combat-loadout.js to load first'); return; }

  const PASSIVE_DRAIN_BASE_PER_S = 2.2; // Used by passiveDrainPerS() as Blink's stamina drain at normal 1.0x movement speed.
  const STAMINA_REGEN_BLOCK_SOURCE = 'blink-dodge-hold'; // Used to own only Blink Dodge's entry in ResourceSystem's composable Stamina-regeneration blocker registry.
  const PASSIVE_DRAIN_QUANTUM = 0.1; // Used by spendPassiveDrain() to survive ResourceSystem's tenth-point stamina rounding without frame-rate-dependent loss.
  const ZIP_COST = 20;
  const ZIP_DISTANCE_PX = 82;
  const ZIP_INVULN_S = 0.16;
  const ZIP_COOLDOWN_S = 0.18;
  const MOVE_SPEED_MAX_MUL = 1.7; // Used by speedMul() as the fully-built Blink movement ceiling before mastery bonuses.
  const MOVE_SPEED_BUILD_S = 1.5; // Used by onHoldUpdate() to reach the movement-speed ceiling during one uninterrupted input.
  const REVERSAL_DOT_THRESHOLD = 0; // Used by onHoldUpdate() so crossing into the opposite (>90°) input hemisphere counts as a reversal.
  const MOVE_INPUT_EPSILON = 0.001; // Used by movementInput() to reject stick noise and zero-length directions.
  // One GPU-skinned, color-preserving smear per portrait surface replaces repeated CPU-baked ghosts.
  const SMEAR_LIFETIME_S = 0.19; // Used by updateMotionSmears to fade a completed motion without leaving persistent echoes.
  const SMEAR_SAMPLE_INTERVAL_S = 0.055; // Used by player and enemy movement sampling to avoid redundant velocity updates.
  const SMEAR_BASE_OPACITY = 0.34; // Used by setMotionSmear to tint alpha only; original RGB comes directly from the live portrait texture.
  const SMEAR_REGULAR_INTENSITY_PER_TILE = 0.5; // Used by roll/lunge motion, while Blink hops keep full strength.
  const SMEAR_MAX_STRETCH_WORLD = 1.35; // Used to cap world-space deformation when a character teleports or frame time spikes.
  const SMEAR_MIN_TRAVEL_WORLD = 0.008; // Used to reject stationary poses and noisy coordinates.
  const SMEAR_CACHE_MAX_ACTORS = 24; // Used to bound persistent material/mesh resources in large fights.
  const SMEAR_CACHE_IDLE_S = 30; // Used to retain warm meshes during combat but dispose stale/removed actors.
  const afterimageTravelByActor = new WeakMap(); // Used to compute observed, collision-clamped movement rather than requested velocity.
  const blinkRuntimeDebug = { // Updated by the hold state machine and exposed through HobunjiDodgeFeedback for mobile-readable diagnostics.
    active: false,
    movementHeld: false,
    speedBuildS: 0,
    speedBuildProgress: 0,
    speedMul: 1,
    passiveDrainPerS: PASSIVE_DRAIN_BASE_PER_S,
    passiveDrainCarry: 0,
    hopCount: 0,
    lastHopReason: null,
    lastHopAtMs: null,
    inputDot: null,
    pendingReversal: false,
  };

  // Base dodge polish. game.js already charges 18 stamina and grants a real
  // 380 ms invulnerability window; this module only adds the requested
  // somersault presentation and raises the effective cost to 30 without
  // duplicating or replacing the existing i-frame path.
  const BASE_DODGE_EXTRA_STAMINA_COST = 12; // Used on each ordinary dodge start; 18 + 12 = 30 total stamina.
  const BASE_DODGE_SOMERSAULT_DUR_S = 0.22; // Used by the prone-recovery roll playback so it ends with dodge movement.
  let baseDodgeWasActive = false; // Used by updateBaseDodgeEnhancements to detect only the rising edge of player.dodging.
  let defensiveHoldActive = false; // Used by the shared iframe-miss seam so only near-hits dodged while Blink Dodge is actually held can trigger its Flourish.
  let iframeMissCount = 0; // Used by HobunjiDodgeFeedback.getDebug() to confirm iframe-hit attempts reached this shared combat seam.
  let lastIframeMissAtMs = null; // Used by HobunjiDodgeFeedback.getDebug() to timestamp the most recent visible miss popup.
  const motionSmears = new Map(); // Actor root -> reusable live-GPU-skinned colored silhouette and its fade state.
  const cachedAfterimagePortraits = new WeakMap(); // Portrait roots cached so repeated combat frames never traverse their rigs.
  const enemyAfterimageMotion = new WeakMap(); // Enemy -> independent movement sampling cadence.
  let lastMoveAfterimageAtS = -Infinity; // Used to throttle held Blink locomotion effects.
  let lastDodgeAfterimageAtS = -Infinity; // Used for mobile-friendly player dodge sampling diagnostics.
  let lastLungeAfterimageAtS = -Infinity; // Used for mobile-friendly player lunge sampling diagnostics.
  let dodgeAfterimageWasActive = false; // Used to mark the active dodge phase in mobile diagnostics.
  let lungeAfterimageWasActive = false; // Used to mark the active lunge phase in mobile diagnostics.
  let lastSmearPruneAtS = -Infinity; // Used to avoid a resource-pruning pass on each animation frame.
  let lastBlinkSmearSampleAtS = -Infinity; // Used to measure held Blink movement independently of its input-update cadence.
  let sceneInverseScratch = null; // Reused for nonidentity scene-parent transforms; never allocated per frame.
  const afterimageRuntimeDebug = { // Exposed through the existing blink.afterimages diagnostic key for Pixel Probe compatibility.
    effect: 'rgba-directional-motion-smear',
    active: 0, spawned: 0, disposed: 0, entriesCreated: 0, entriesReused: 0,
    pooled: 0, textureRefreshes: 0, poolEvictions: 0, enemySnapshots: 0,
    lastReason: null, lastSourceName: null, lastSpawnAtMs: null,
    portraitFound: false, enemyCombatants: 0, playerCombatFrown: false,
    lastDistanceTiles: 0, lastIntensityScale: 0, lastStretchWorld: 0,
  };

  function now() { return performance.now() / 1000; }
  function now() { return performance.now() / 1000; }

  function distanceAfterimageIntensity(distanceTiles, blink = false) {
    const distance = Math.max(0, Number(distanceTiles) || 0); // Actual tile distance used by alpha scaling.
    const intensity = distance * (blink ? 1 : SMEAR_REGULAR_INTENSITY_PER_TILE); // Kept in debug data for player-side A/B comparisons.
    afterimageRuntimeDebug.lastDistanceTiles = distance;
    afterimageRuntimeDebug.lastIntensityScale = intensity;
    return intensity;
  }

  function updateAfterimageTravel(actor, dodging, lunging) {
    let travel = afterimageTravelByActor.get(actor); // Reused actor state avoids per-frame object creation.
    if (!travel) {
      travel = { x: actor.x, y: actor.y, pendingDxWorld: 0, pendingDzWorld: 0, stepTiles: 0, dodgeTiles: 0, lungeTiles: 0 };
      afterimageTravelByActor.set(actor, travel);
    }
    const dx = (Number(actor.x) || 0) - (Number(travel.x) || 0);
    const dz = (Number(actor.y) || 0) - (Number(travel.y) || 0);
    travel.x = actor.x;
    travel.y = actor.y;
    const tile = Math.max(1, Number(window.Combat?.deps?.TILE) || 64); // Existing pixel-to-world conversion.
    const active = dodging || lunging || defensiveHoldActive; // Only accumulate actual travel during an enabled combat movement.
    travel.pendingDxWorld = active ? travel.pendingDxWorld + dx / tile : 0;
    travel.pendingDzWorld = active ? travel.pendingDzWorld + dz / tile : 0;
    travel.stepTiles = active ? Math.hypot(dx, dz) / tile : 0;
    travel.dodgeTiles = dodging ? travel.dodgeTiles + travel.stepTiles : 0;
    travel.lungeTiles = lunging ? travel.lungeTiles + travel.stepTiles : 0;
    return travel;
  }

  function afterimageMaterialsOf(mesh) {
    return (Array.isArray(mesh?.material) ? mesh.material : [mesh?.material]).filter(Boolean);
  }

  function afterimagePlayerRoot() {
    return window.PlayerBodyTransformComposer?.getPlayerMesh?.()
      || window.Combat?.deps?.playerMesh
      || window.ProceduralHandAttachments?.gameDeps?.playerMesh
      || null;
  }

  function belongsToAfterimageRoot(object, root) {
    for (let node = object; node; node = node.parent) if (node === root) return true;
    return false;
  }

  function portraitMeshScore(object) {
    if ((!object?.isMesh && !object?.isSkinnedMesh) || object.userData?.blinkAfterimage) return -1;
    const materials = afterimageMaterialsOf(object);
    if (!materials.length) return -1;
    let score = 0;
    for (const material of materials) {
      const name = String(material?.name || '');
      if (name.includes('npc_avatar_skinned_')) score += 8;
      else if (name.includes('npc_avatar_')) score += 4;
      if (material?.map) score += 1;
    }
    return score;
  }

  function findPortraitMeshes(root) {
    if (!root?.traverse) return [];
    const cached = cachedAfterimagePortraits.get(root);
    if (cached?.length && cached.every(object => belongsToAfterimageRoot(object, root))) return cached;
    const matches = [];
    root.traverse(object => {
      const score = portraitMeshScore(object);
      if (score >= 4) matches.push({ object, score }); // No hands, tool geometry, scene-wide outlines, or old effect meshes.
    });
    const best = matches.reduce((score, item) => Math.max(score, item.score), -1);
    const portraits = matches.filter(item => item.score >= best - 1).map(item => item.object);
    cachedAfterimagePortraits.set(root, portraits);
    return portraits;
  }

  function afterimageSceneFor(source) {
    for (let node = source; node; node = node.parent) if (node.isScene) return node;
    return window.GridTileAccessors?.getActiveScene?.() || null;
  }

  // Non-indexed avatar geometry is a front/back grid. Copy only 2x2-block
  // corners and their original skin weights ONCE per actor, not per snapshot.
  // Geometry without that exact topology uses the source geometry by reference.
  function makeSmearGeometry(source) {
    const THREE = window.THREE;
    const geometry = source.geometry;
    const segX = Number(geometry?.userData?.segmentsX);
    const segY = Number(geometry?.userData?.segmentsY);
    const sourcePositions = geometry?.getAttribute?.('position');
    const faces = (geometry?.groups || []).length;
    if (!source.isSkinnedMesh || !THREE?.BufferGeometry || !THREE.BufferAttribute
      || !Number.isInteger(segX) || !Number.isInteger(segY) || segX < 2 || segY < 2
      || !sourcePositions || geometry.getIndex?.() || (faces !== 1 && faces !== 2)
      || sourcePositions.count !== segX * segY * 6 * faces) return { geometry, owned: false };

    const vertices = []; // Original source vertex indices used to retain exact skinning and UV/color channels.
    const perFace = Math.ceil(segX / 2) * Math.ceil(segY / 2) * 6;
    for (let face = 0; face < faces; face++) {
      const offset = face * segX * segY * 6;
      const at = (x, y, index) => offset + (y * segX + x) * 6 + (face ? 5 - index : index);
      for (let y = 0; y < segY; y += 2) for (let x = 0; x < segX; x += 2) {
        const right = Math.min(x + 1, segX - 1);
        const bottom = Math.min(y + 1, segY - 1);
        const a = at(x, bottom, 0), b = at(right, bottom, 1);
        const c = at(x, y, 2), d = at(right, y, 4);
        vertices.push(...(face ? [c, d, b, c, b, a] : [a, b, c, b, d, c]));
      }
    }
    const reduced = new THREE.BufferGeometry(); // Reused for this actor's entire rig lifetime.
    for (const [name, attribute] of Object.entries(geometry.attributes || {})) {
      if (!attribute?.array || !Number.isInteger(attribute.itemSize) || attribute.itemSize < 1) {
        reduced.dispose?.();
        return { geometry, owned: false };
      }
      const output = new attribute.array.constructor(vertices.length * attribute.itemSize);
      for (let i = 0; i < vertices.length; i++) {
        const from = vertices[i] * attribute.itemSize;
        output.set(attribute.array.subarray(from, from + attribute.itemSize), i * attribute.itemSize);
      }
      reduced.setAttribute(name, new THREE.BufferAttribute(output, attribute.itemSize, attribute.normalized));
    }
    for (let face = 0; face < faces; face++) reduced.addGroup(face * perFace, perFace, geometry.groups[face]?.materialIndex ?? face);
    reduced.computeBoundingSphere?.();
    return { geometry: reduced, owned: true };
  }

  // Clone materials, not textures. Their live PNGs already carry the actor's
  // genotype, patterns, current clothing, face and color-fill presentation.
  // Only vertex geometry and fragment ALPHA change: RGB never gets whitened.
  function makeSmearMaterial(sourceMaterial) {
    if (!sourceMaterial?.clone) return null;
    const material = sourceMaterial.clone();
    const priorCompile = sourceMaterial.onBeforeCompile; // Preserves other authored material shader extensions.
    const oldKey = material.customProgramCacheKey?.bind(material);
    const uniforms = {
      direction: { value: { x: 1, y: 0, z: 0 } },
      length: { value: 0 },
      side: { value: 1 },
      opacity: { value: 0 },
    }; // Updated in place by paintSmearEntry and updateMotionSmears, without recompilation.
    material.name = (sourceMaterial.name || 'portrait') + '_motion_smear';
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = true;
    material.opacity = 1;
    material.alphaTest = Math.min(Number(sourceMaterial.alphaTest) || 0.001, 0.001);
    material.onBeforeCompile = (shader, renderer) => {
      priorCompile?.call(material, shader, renderer);
      Object.assign(shader.uniforms, {
        uSmearDirection: uniforms.direction, uSmearLength: uniforms.length,
        uSmearSide: uniforms.side, uSmearOpacity: uniforms.opacity,
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vSmearTail;\nuniform vec3 uSmearDirection;\nuniform float uSmearLength;\nuniform float uSmearSide;')
        .replace('#include <skinning_vertex>', [
          '#include <skinning_vertex>',
          'float smearFront = 0.5;',
          '#ifdef USE_UV',
          '  smearFront = uSmearSide > 0.0 ? uv.x : (1.0 - uv.x);',
          '#endif',
          'vSmearTail = smearFront;',
          'transformed.xz -= uSmearDirection.xz * uSmearLength * (1.0 - 0.88 * smearFront);',
        ].join('\n'));
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vSmearTail;\nuniform float uSmearOpacity;')
        .replace('#include <premultiplied_alpha_fragment>', 'gl_FragColor.a *= uSmearOpacity * smoothstep(0.0, 0.76, vSmearTail);\n#include <premultiplied_alpha_fragment>');
    };
    material.customProgramCacheKey = () => (oldKey?.() || '') + '|hobunji-colored-smear-v1';
    material.needsUpdate = true;
    return { material, uniforms };
  }

  function disposeSmear(record) {
    if (!record) return;
    for (const entry of record.entries) {
      entry.mesh.parent?.remove?.(entry.mesh);
      if (entry.ownsGeometry) entry.mesh.geometry.dispose?.(); // Never dispose the live character's source geometry.
      for (const item of entry.materials) item.material.dispose?.(); // The actor still owns the shared texture maps.
    }
    motionSmears.delete(record.root);
    afterimageRuntimeDebug.disposed++;
  }

  function makeSmearEntry(source, scene) {
    const THREE = window.THREE;
    const sourceMaterials = afterimageMaterialsOf(source);
    const materials = sourceMaterials.map(makeSmearMaterial);
    if (!materials.length || materials.some(item => !item)) {
      for (const item of materials) item?.material?.dispose?.();
      return null;
    }
    const built = makeSmearGeometry(source);
    const assigned = Array.isArray(source.material) ? materials.map(item => item.material) : materials[0].material;
    const mesh = source.isSkinnedMesh && THREE.SkinnedMesh
      ? new THREE.SkinnedMesh(built.geometry, assigned)
      : new THREE.Mesh(built.geometry, assigned);
    if (source.isSkinnedMesh && mesh.isSkinnedMesh) {
      mesh.bind(source.skeleton, source.bindMatrix); // Shares GPU bone matrices, not CPU-baked vertex snapshots.
      mesh.bindMode = source.bindMode;
      mesh.bindMatrixInverse.copy?.(source.bindMatrixInverse);
    }
    mesh.name = 'combat_portrait_motion_smear';
    mesh.userData.blinkAfterimage = true; // Existing compositor excludes transient portrait effects by this flag.
    mesh.userData.noOutline = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    scene.add(mesh);
    afterimageRuntimeDebug.entriesCreated++;
    return {
      mesh, source, sourceGeometry: source.geometry, materials, ownsGeometry: built.owned,
      sourceMaterials, sourceTextures: sourceMaterials.map(mat => [mat.map, mat.alphaMap, mat.emissiveMap]),
    };
  }

  function smearEntryMatches(entry, source) {
    if (entry.source !== source || !entry.mesh || entry.sourceGeometry !== source.geometry) return false;
    const materials = afterimageMaterialsOf(source);
    return materials.length === entry.sourceMaterials.length && materials.every((material, index) =>
      material === entry.sourceMaterials[index]
      && [material.map, material.alphaMap, material.emissiveMap].every((texture, slot) =>
        texture === entry.sourceTextures[index][slot]));
  }

  function paintSmearEntry(entry, scene, dx, dz, length, opacity) {
    const source = entry.source;
    source.updateWorldMatrix?.(true, !!source.isSkinnedMesh);
    const matrix = source.matrixWorld?.elements;
    // Convert actual horizontal travel into source-local coordinates without
    // allocating vectors or matrices in the hot path.
    let x = dx, z = dz;
    if (matrix) {
      const localX = dx * matrix[0] + dz * matrix[2];
      const localZ = dx * matrix[8] + dz * matrix[10];
      const normal = Math.hypot(localX, localZ);
      if (normal > 1e-6) { x = localX / normal; z = localZ / normal; }
    }
    const mesh = entry.mesh;
    if (source.matrixWorld && mesh.matrix?.copy) {
      mesh.matrix.copy(source.matrixWorld);
      // Scene transforms are identity in normal gameplay, but support transformed
      // scene roots with one persistent scratch matrix rather than per-hit clones.
      if (scene.matrixWorld && mesh.matrix.premultiply && window.THREE?.Matrix4) {
        sceneInverseScratch ||= new window.THREE.Matrix4();
        sceneInverseScratch.copy(scene.matrixWorld).invert();
        mesh.matrix.premultiply(sceneInverseScratch);
      }
      mesh.matrixWorldNeedsUpdate = true;
    }
    if (source.layers && mesh.layers) mesh.layers.mask = source.layers.mask;
    mesh.renderOrder = Math.max(Number(source.renderOrder) || 0, 3);
    mesh.visible = true;
    for (let i = 0; i < entry.materials.length; i++) {
      const item = entry.materials[i];
      const original = entry.sourceMaterials[i];
      item.uniforms.direction.value.x = x;
      item.uniforms.direction.value.z = z;
      item.uniforms.length.value = length;
      item.uniforms.side.value = x >= 0 ? 1 : -1;
      item.uniforms.opacity.value = opacity * (Number.isFinite(Number(original.opacity)) ? Number(original.opacity) : 1);
      item.material.color?.copy?.(original.color);
      item.material.emissive?.copy?.(original.emissive);
    }
  }

  function spawnAfterimageForRoot(root, reason, dxWorld = 0, dzWorld = 0, opacityScale = 1) {
    const THREE = window.THREE;
    if (!root || !THREE?.Mesh || !(opacityScale > 0) || !Number.isFinite(dxWorld) || !Number.isFinite(dzWorld)) return false;
    const distance = Math.hypot(dxWorld, dzWorld);
    if (distance < SMEAR_MIN_TRAVEL_WORLD) return false;
    const sources = findPortraitMeshes(root);
    const scene = sources.length ? afterimageSceneFor(sources[0]) : null;
    if (!sources.length || !scene) return false;

    let record = motionSmears.get(root);
    if (record && (record.scene !== scene || record.entries.length !== sources.length
      || record.entries.some((entry, index) => !smearEntryMatches(entry, sources[index])))) {
      disposeSmear(record);
      record = null;
    }
    if (!record) {
      if (motionSmears.size >= SMEAR_CACHE_MAX_ACTORS) {
        const idle = [...motionSmears.values()].find(item => !item.active);
        if (!idle) return false; // Busy crowd cannot allocate an unbounded new GPU surface.
        disposeSmear(idle);
      }
      const entries = sources.map(source => makeSmearEntry(source, scene)).filter(Boolean);
      if (!entries.length) return false;
      record = { root, scene, entries, active: false, remainingS: 0, strength: 0, lastUsedS: now() };
      motionSmears.set(root, record);
    } else afterimageRuntimeDebug.entriesReused++;

    const strength = Math.min(0.48, SMEAR_BASE_OPACITY * opacityScale);
    const stretch = Math.min(SMEAR_MAX_STRETCH_WORLD, distance * 1.6);
    for (const entry of record.entries) paintSmearEntry(entry, scene, dxWorld / distance, dzWorld / distance, stretch, strength);
    record.active = true;
    record.remainingS = SMEAR_LIFETIME_S;
    record.strength = strength;
    record.lastUsedS = now();
    afterimageRuntimeDebug.spawned++;
    if (String(reason).startsWith('enemy-')) afterimageRuntimeDebug.enemySnapshots++;
    afterimageRuntimeDebug.lastReason = reason;
    afterimageRuntimeDebug.lastSourceName = record.entries.map(entry => entry.source.name || '').join(', ');
    afterimageRuntimeDebug.lastSpawnAtMs = performance.now();
    afterimageRuntimeDebug.lastStretchWorld = stretch;
    return true;
  }

  function spawnAfterimage(reason, dxWorld = 0, dzWorld = 0, opacityScale = 1) {
    const root = afterimagePlayerRoot();
    const portraits = findPortraitMeshes(root);
    afterimageRuntimeDebug.portraitFound = portraits.length > 0;
    if (afterimageRuntimeDebug.playerCombatFrown && window.WorldPortraitLife?.isPlayerCombatExpressionApplied?.() === false) return false;
    return spawnAfterimageForRoot(root, reason, dxWorld, dzWorld, opacityScale);
  }

  function spawnHopAfterimages(dxWorld, dzWorld) {
    // A single stretched streak follows the hop displacement, not three texture snapshots along it.
    spawnAfterimage('blink-hop', dxWorld, dzWorld, distanceAfterimageIntensity(Math.hypot(dxWorld, dzWorld), true));
  }

  function maybeSpawnMovementAfterimage(input) {
    // onHoldUpdate precedes the shared combat presentation phase; use the
    // already-resolved player travel there, once, rather than guessing velocity from input.
    if (!defensiveHoldActive || !input?.active) return;
    lastMoveAfterimageAtS = now();
  }

  function consumeTravelSample(travel) {
    const x = travel.pendingDxWorld, z = travel.pendingDzWorld; // Aggregates real movement since the previous 55ms sample.
    travel.pendingDxWorld = 0;
    travel.pendingDzWorld = 0;
    return { x, z, distance: Math.hypot(x, z) };
  }

  function smearVelocityIntensity(distance, elapsedS, blink = false) {
    // Normalize to about 100ms of motion. A fast dash stays visible even at
    // 120 FPS, without opacity becoming dependent on the number of game ticks.
    const seconds = Math.max(0.016, Math.min(0.15, Number(elapsedS) || SMEAR_SAMPLE_INTERVAL_S));
    return distanceAfterimageIntensity(distance * (0.10 / seconds), blink);
  }

  function updateForcedMovementAfterimages() {
    const player = window.Combat?.deps?.player;
    if (!player) return;
    const t = now();
    const dodging = !!player.dodging, lunging = !!player.lunging;
    const travel = updateAfterimageTravel(player, dodging, lunging);
    const movingBlink = defensiveHoldActive && t - lastMoveAfterimageAtS <= 0.1;
    if (dodging || lunging || movingBlink) {
      const blinkOnly = movingBlink && !dodging && !lunging; // Blink locomotion shares the same mesh, not a second effect.
      const reason = lunging ? 'lunge' : dodging ? 'dodge' : 'blink-move';
      const recent = lunging ? lastLungeAfterimageAtS : dodging ? lastDodgeAfterimageAtS : lastBlinkSmearSampleAtS;
      if (t - recent >= SMEAR_SAMPLE_INTERVAL_S) {
        if (dodging) lastDodgeAfterimageAtS = t;
        if (lunging) lastLungeAfterimageAtS = t;
        if (blinkOnly) lastBlinkSmearSampleAtS = t;
        const sample = consumeTravelSample(travel); // Never smear a stationary attack.
        spawnAfterimage(reason, sample.x, sample.z,
          smearVelocityIntensity(sample.distance, t - recent, blinkOnly));
      }
    }
    if (!dodging) lastDodgeAfterimageAtS = -Infinity;
    if (!lunging) lastLungeAfterimageAtS = -Infinity;
    if (!movingBlink) lastBlinkSmearSampleAtS = -Infinity;
    if (!dodging && !lunging && !movingBlink) { travel.pendingDxWorld = 0; travel.pendingDzWorld = 0; }
    dodgeAfterimageWasActive = dodging;
    lungeAfterimageWasActive = lunging;
  }

  function hostileIsInPlayerCombat(entity) {
    if (!entity || entity.health <= 0 || entity._denHidden || entity.denDisplacedPrey) return false;
    const state = String(entity.state || '').toLowerCase();
    return state === 'chase' || state === 'searching';
  }

  function updateEnemyCombatPresentation() {
    const deps = window.Combat?.deps;
    const player = deps?.player, hostiles = deps?.hostileObjects;
    if (!player || !hostiles) return;
    const t = now();
    let playerInCombat = false, enemyCombatants = 0;
    for (const entity of hostiles) {
      if (!entity) continue;
      if (entity.areaId && deps.getCurrentArea?.() && entity.areaId !== deps.getCurrentArea()) continue;
      const inCombat = hostileIsInPlayerCombat(entity);
      if (inCombat) { playerInCombat = true; enemyCombatants++; }
      if (entity.isBandit) window.BanditCombat?.setCombatExpression?.(entity, inCombat);
      if (!entity.isBandit || entity.health <= 0 || !entity.avatarRef?.group) continue;
      let motion = enemyAfterimageMotion.get(entity);
      if (!motion) {
        motion = { dodgeActive: false, lungeActive: false, lastDodgeAtS: -Infinity, lastLungeAtS: -Infinity };
        enemyAfterimageMotion.set(entity, motion);
      }
      const dodging = !!(entity.dodging || entity._enemyDodge);
      const lunging = !!entity._banditLunging;
      const travel = updateAfterimageTravel(entity, dodging, lunging);
      if (dodging || lunging) {
        const recent = lunging ? motion.lastLungeAtS : motion.lastDodgeAtS;
        if (t - recent >= SMEAR_SAMPLE_INTERVAL_S || !(lunging ? motion.lungeActive : motion.dodgeActive)) {
          if (dodging) motion.lastDodgeAtS = t;
          if (lunging) motion.lastLungeAtS = t;
          const sample = consumeTravelSample(travel); // One GPU smear update for the observed travel interval.
          spawnAfterimageForRoot(entity.avatarRef.group, lunging ? 'enemy-lunge' : 'enemy-dodge',
            sample.x, sample.z, smearVelocityIntensity(sample.distance, t - recent));
        }
      }
      if (!dodging) motion.lastDodgeAtS = -Infinity;
      if (!lunging) motion.lastLungeAtS = -Infinity;
      if (!dodging && !lunging) { travel.pendingDxWorld = 0; travel.pendingDzWorld = 0; }
      motion.dodgeActive = dodging;
      motion.lungeActive = lunging;
    }
    window.WorldPortraitLife?.setPlayerCombatExpression?.(playerInCombat);
    afterimageRuntimeDebug.enemyCombatants = enemyCombatants;
    afterimageRuntimeDebug.playerCombatFrown = playerInCombat;
  }

  function updateMotionSmears(dt) {
    const safeDt = Math.max(0, Number(dt) || 0);
    let activeCount = 0; // Counted while updating each persistent effect, without allocating an array each frame.
    for (const record of motionSmears.values()) {
      record.remainingS -= safeDt;
      const opacityFactor = Math.max(0, Math.min(1, record.remainingS / SMEAR_LIFETIME_S));
      record.active = opacityFactor > 0;
      if (record.active) activeCount++;
      for (const entry of record.entries) {
        entry.mesh.visible = record.active && !!entry.source.parent && entry.source.visible !== false;
        for (let i = 0; i < entry.materials.length; i++) {
          const item = entry.materials[i];
          const original = entry.sourceMaterials[i];
          item.uniforms.opacity.value = record.strength * opacityFactor
            * (Number.isFinite(Number(original.opacity)) ? Number(original.opacity) : 1);
        }
      }
    }
    afterimageRuntimeDebug.active = activeCount;
    afterimageRuntimeDebug.pooled = motionSmears.size - afterimageRuntimeDebug.active;
    const t = now();
    if (t - lastSmearPruneAtS < 2) return;
    lastSmearPruneAtS = t;
    for (const record of motionSmears.values()) {
      if (!record.root.parent || !record.scene || (!record.active && t - record.lastUsedS >= SMEAR_CACHE_IDLE_S))
        disposeSmear(record);
    }
    afterimageRuntimeDebug.pooled = motionSmears.size - activeCount; // Diagnostics reflect pruning immediately, not on the following frame.
  }

  function showIframeMissPopup() {
    iframeMissCount += 1;
    lastIframeMissAtMs = performance.now();
    // WorldPopupText's damage kind is the exact Float+ animation used for
    // ordinary damage numbers. A non-zero placeholder amount is required by
    // showChange's API, while `text` replaces the rendered number entirely.
    window.WorldPopupText?.showChange('damage', 1, { text: 'miss' });
  }

  function installIframeMissFeedback() {
    // Enemy combat modules all receive game.js's closure-private damagePlayer
    // through Combat.init(deps). Decorate that one injected seam before Combat
    // stores it, so a hit that intersects during invulnUntil gets the same
    // damage Float+ presentation without duplicating checks in every attack.
    const originalInit = window.Combat.init;
    if (originalInit?.__hobunjiIframeMissFeedback) return;
    const enhancedInit = function iframeMissAwareCombatInit(injectedDeps) {
      const originalDamagePlayer = injectedDeps?.damagePlayer;
      if (typeof originalDamagePlayer === 'function' && !originalDamagePlayer.__hobunjiIframeMissFeedback) {
        const iframeAwareDamagePlayer = function iframeAwareDamagePlayer(...args) {
          const player = injectedDeps.player;
          if (player && performance.now() < (Number(player.invulnUntil) || 0)) {
            showIframeMissPopup();
            if (defensiveHoldActive) {
              window.CombatAttackEvents?.defensive?.({
                attacker: player,
                weaponKey: injectedDeps.currentWeaponKey?.() || 'none',
                abilityId: 'blinkDodge',
                target: window.CombatAttackEvents?.resolveIncomingSource?.(args[1], args[2], injectedDeps) || null,
                defensiveResult: 'nearHitDodge',
                metadata: { incomingAmount: args[0], fromX: args[1], fromY: args[2] },
              }); // damagePlayer reaching this existing iframe branch is the authoritative near-hit; no second proximity test is created.
            }
            return;
          }
          return originalDamagePlayer.apply(this, args);
        };
        iframeAwareDamagePlayer.__hobunjiIframeMissFeedback = true;
        injectedDeps.damagePlayer = iframeAwareDamagePlayer;
      }
      return originalInit(injectedDeps);
    };
    enhancedInit.__hobunjiIframeMissFeedback = true;
    window.Combat.init = enhancedInit;
  }

  function updateBaseDodgeEnhancements() {
    const deps = window.Combat.deps;
    const player = deps?.player;
    if (!player) return;

    const dodging = !!player.dodging;
    if (dodging && !baseDodgeWasActive) {
      // Reuse the same non-blocking spend path as game.js's base dodge so the
      // larger cost can still overdraw into Exhausted instead of refusing the
      // action at low stamina.
      if (window.ResourceSystem) {
        window.ResourceSystem.spendStamina(player, BASE_DODGE_EXTRA_STAMINA_COST, 'dodge somersault');
      } else {
        player.stamina = Math.max(0, player.stamina - BASE_DODGE_EXTRA_STAMINA_COST);
      }

      // This is the exact procedural 360° recovery arc used when the player
      // exits prone, just time-compressed to the ordinary dodge duration so
      // the visual roll does not lengthen the dodge or increase its travel.
      window.ImpactRagdollPlayback?.beginRecoveryArc(BASE_DODGE_SOMERSAULT_DUR_S);
    }
    baseDodgeWasActive = dodging;
  }

  function installBaseDodgeEnhancements() {
    // Combat.update is already the per-frame combat seam game.js calls. Wrap
    // it once here instead of adding a second requestAnimationFrame loop or
    // reaching into game.js's closure-private performDodge implementation.
    const originalUpdate = window.Combat.update;
    if (originalUpdate?.__hobunjiBaseDodgeEnhancements) return;
    const enhancedUpdate = function enhancedCombatUpdate(dt) {
      originalUpdate(dt);
      updateBaseDodgeEnhancements();
      updateEnemyCombatPresentation();
      updateForcedMovementAfterimages();
      updateMotionSmears(dt);
    };
    enhancedUpdate.__hobunjiBaseDodgeEnhancements = true;
    window.Combat.update = enhancedUpdate;
  }

  function register() {
    let active = false; // Used by every hold callback to distinguish an equipped hold from an inactive ability.
    let movementHeld = false; // Used to grant exactly one hop when a fresh movement input begins.
    let speedBuildS = 0; // Used by speedMul() to build speed only across one uninterrupted movement input.
    let previousInputX = 0; // Used with previousInputY to detect sudden hemisphere-crossing direction changes.
    let previousInputY = 0; // Used with previousInputX to detect sudden hemisphere-crossing direction changes.
    let pendingHop = null; // Used to preserve a reversal detected during the short anti-jitter hop cooldown.
    let nextZipAt = -99; // Used by reversal hops to retain the existing progression-controlled zip cooldown.
    let passiveDrainCarry = 0; // Used by spendPassiveDrain() to retain sub-0.1 stamina costs that ResourceSystem would otherwise round away each frame.

    // Blink Dodge deals no damage of its own, so its whole upgrade tree
    // (see combat-progression.js) is movement/stamina stat bonuses rather
    // than afflictions — read once per relevant call instead of cached,
    // same as every other ability, so a level chosen mid-hold takes effect
    // on the very next hop.
    function effects() {
      const toolKey = window.Combat.deps?.currentWeaponKey?.() || 'none';
      return window.CombatProgression?.getEffects(toolKey, 'blinkDodge') || { afflictions: {}, stats: {} };
    }

    function movementInput(deps) {
      const strength = Math.max(0, Math.min(1, Number(deps.player.inputStrength) || 0)); // Used to distinguish real movement from idle/stick noise.
      const rawX = Number(deps.player.inputX) || 0; // Used below as the game-resolved world-space movement X component.
      const rawY = Number(deps.player.inputY) || 0; // Used below as the game-resolved world-space movement Y component.
      const length = Math.hypot(rawX, rawY); // Used to normalize defensive input even if another movement system supplied a non-unit vector.
      if (strength <= MOVE_INPUT_EPSILON || length <= MOVE_INPUT_EPSILON) {
        return { active: false, x: 0, y: 0, strength: 0 };
      }
      return { active: true, x: rawX / length, y: rawY / length, strength };
    }

    function speedMul() {
      if (!active || !movementHeld) {
        blinkRuntimeDebug.speedMul = 1;
        return 1;
      }
      const stats = effects().stats; // Used to preserve the existing Brisk Footwork mastery bonus on the new speed ceiling.
      const progress = Math.min(1, speedBuildS / MOVE_SPEED_BUILD_S); // Used to map uninterrupted input time onto the authored buildup duration.
      const eased = progress * progress * (3 - 2 * progress); // Used to make the boost grow smoothly rather than snapping linearly.
      const maxMul = MOVE_SPEED_MAX_MUL * (1 + (stats.walkSpeedMul || 0)); // Used as this tool's mastery-adjusted maximum movement multiplier.
      const multiplier = 1 + (maxMul - 1) * eased; // Used by Combat.getMovementSpeedMul() in game.js's normal locomotion path.
      blinkRuntimeDebug.speedBuildProgress = progress;
      blinkRuntimeDebug.speedMul = multiplier;
      return multiplier;
    }

    function passiveDrainPerS() {
      const idleDrainMul = 1 + (effects().stats.idleDrainMul || 0); // Used to preserve the existing Blink stamina-efficiency progression choice.
      const movementMul = movementHeld ? speedMul() : 1; // Used to scale passive cost with the live built movement boost while stationary hold stays at baseline.
      const drainPerS = PASSIVE_DRAIN_BASE_PER_S * idleDrainMul * movementMul; // Used by spendPassiveDrain() as the exact continuous drain rate for this frame.
      blinkRuntimeDebug.passiveDrainPerS = drainPerS;
      return drainPerS;
    }

    function spendPassiveDrain(deps, dt) {
      const safeDt = Math.max(0, Number(dt) || 0); // Used to keep a malformed frame delta from adding negative or NaN stamina debt.
      passiveDrainCarry += passiveDrainPerS() * safeDt;
      const quanta = Math.floor((passiveDrainCarry + 1e-9) / PASSIVE_DRAIN_QUANTUM); // Used to convert accumulated fractional cost into stable tenth-point ResourceSystem spends.
      if (quanta > 0) {
        const spendAmount = quanta * PASSIVE_DRAIN_QUANTUM; // Used as the authored amount passed through normal stamina perks/alchemy/affliction handling.
        passiveDrainCarry = Math.max(0, passiveDrainCarry - spendAmount);
        if (window.ResourceSystem) {
          window.ResourceSystem.spendStamina(deps.player, Math.min(deps.player.stamina, spendAmount), 'Blink Dodge (passive)');
        } else {
          deps.player.stamina = Math.max(0, deps.player.stamina - Math.min(deps.player.stamina, spendAmount));
        }
      }
      blinkRuntimeDebug.passiveDrainCarry = passiveDrainCarry;
    }

    function resetMovementInputState() {
      movementHeld = false;
      speedBuildS = 0;
      previousInputX = 0;
      previousInputY = 0;
      pendingHop = null;
      blinkRuntimeDebug.movementHeld = false;
      blinkRuntimeDebug.speedBuildS = 0;
      blinkRuntimeDebug.speedBuildProgress = 0;
      blinkRuntimeDebug.speedMul = 1;
      blinkRuntimeDebug.passiveDrainPerS = PASSIVE_DRAIN_BASE_PER_S * (1 + (effects().stats.idleDrainMul || 0));
      blinkRuntimeDebug.inputDot = null;
      blinkRuntimeDebug.pendingReversal = false;
    }

    function performHop(deps, input, reason, ignoreCooldown = false) {
      const t = now(); // Used to enforce the old mastery-controlled zip cooldown only between continuous-input reversal hops.
      if (!ignoreCooldown && t < nextZipAt) return false;

      const stats = effects().stats; // Used for the existing Blink Dodge distance/cost/iframe/cooldown progression choices.
      const zipDistancePx = ZIP_DISTANCE_PX * (1 + (stats.zipDistanceMul || 0)); // Used as the one-hop displacement magnitude.
      const startX = deps.player.x; // Used with startY to derive the actual collision-clamped hop displacement for the frozen afterimage burst.
      const startY = deps.player.y; // Used with startX to derive the actual collision-clamped hop displacement for the frozen afterimage burst.
      const desiredX = deps.player.x + input.x * zipDistancePx; // Used by the existing axis-separated occupancy test.
      const desiredY = deps.player.y + input.y * zipDistancePx; // Used by the existing axis-separated occupancy test.
      if (deps.canPlayerOccupy(desiredX, deps.player.y)) deps.player.x = desiredX;
      if (deps.canPlayerOccupy(deps.player.x, desiredY)) deps.player.y = desiredY;
      const tilePx = Math.max(1, Number(deps.TILE) || 64); // Converts the player's pixel-space hop displacement into the Three.js world-space X/Z used by the portrait mesh.
      spawnHopAfterimages((deps.player.x - startX) / tilePx, (deps.player.y - startY) / tilePx);
      const travel = afterimageTravelByActor.get(deps.player); // Exclude the instantaneous hop from a concurrent ordinary roll/lunge's distance.
      if (travel) { travel.x = deps.player.x; travel.y = deps.player.y; }
      lastMoveAfterimageAtS = t; // The hop burst already owns this instant; delay the normal locomotion sampler so it cannot stack a redundant fourth portrait at the origin.

      // Never refuses for lack of stamina — overspending pushes into
      // Exhausted instead (see resource-system.js's spendStamina), same as
      // this game's base dodge (game.js's performDodge).
      window.ResourceSystem?.spendStamina(deps.player, ZIP_COST * (1 + (stats.zipCostMul || 0)), 'Blink Dodge hop');
      const invulnMs = ZIP_INVULN_S * (1 + (stats.invulnMul || 0)) * 1000; // Used to extend the player's shared iframe deadline for this hop.
      deps.player.invulnUntil = Math.max(deps.player.invulnUntil || 0, performance.now() + invulnMs);
      nextZipAt = t + ZIP_COOLDOWN_S * (1 + (stats.zipCooldownMul || 0));

      window.CombatVocalizations?.playDodge?.(deps.player);
      blinkRuntimeDebug.hopCount += 1;
      window.CombatTutorial?.observe?.('blink', { abilityId: 'blinkDodge' });
      blinkRuntimeDebug.lastHopReason = reason;
      blinkRuntimeDebug.lastHopAtMs = performance.now();
      return true;
    }

    function flushPendingHop(deps) {
      if (!pendingHop || now() < nextZipAt) return;
      const hop = pendingHop; // Used once here so clearing the queue cannot discard the stored reversal vector before the hop consumes it.
      pendingHop = null;
      blinkRuntimeDebug.pendingReversal = false;
      performHop(deps, hop, hop.reason);
    }

    function stopHold(message) {
      const wasActive = active; // Used to avoid duplicate end toasts if stamina already dropped the hold on a previous frame.
      active = false;
      defensiveHoldActive = false;
      resetMovementInputState();
      passiveDrainCarry = 0;
      blinkRuntimeDebug.passiveDrainCarry = 0;
      blinkRuntimeDebug.active = false;
      lastMoveAfterimageAtS = -Infinity;
      lastBlinkSmearSampleAtS = -Infinity;
      window.ResourceSystem?.setStaminaRegenBlocked?.(window.Combat.deps?.player, STAMINA_REGEN_BLOCK_SOURCE, false);
      window.Combat.setMovementSpeedMul(null);
      if (wasActive && message) window.Combat.deps.showToast(message, false);
    }

    function onHoldStart() {
      active = true;
      defensiveHoldActive = true;
      resetMovementInputState();
      passiveDrainCarry = 0;
      nextZipAt = -99;
      blinkRuntimeDebug.passiveDrainCarry = 0;
      blinkRuntimeDebug.active = true;
      lastMoveAfterimageAtS = -Infinity;
      window.ResourceSystem?.setStaminaRegenBlocked?.(window.Combat.deps?.player, STAMINA_REGEN_BLOCK_SOURCE, true);
      window.Combat.setMovementSpeedMul(speedMul);
      window.Combat.deps.showToast('Blink Dodge active: hop, build speed, reverse sharply to hop again.', true);
    }

    function onHoldUpdate(_slot, dt) {
      if (!active) return;
      const deps = window.Combat.deps; // Used for the live player, collision checks, and toast path throughout this hold tick.
      const input = movementInput(deps); // Used by the one-hop input edge, speed buildup, and reversal detector below.
      if (!input.active) {
        resetMovementInputState();
        spendPassiveDrain(deps, dt);
        if (deps.player.stamina <= 0) stopHold('Blink Dodge dropped: stamina empty.');
        return;
      }

      if (!movementHeld) {
        movementHeld = true;
        previousInputX = input.x;
        previousInputY = input.y;
        blinkRuntimeDebug.movementHeld = true;
        blinkRuntimeDebug.inputDot = null;
        // A fresh movement press always earns its one hop. Releasing movement
        // deliberately resets the speed buildup, so rapid tapping cannot keep
        // the fast locomotion state even though each press can still blink.
        performHop(deps, input, 'input-start', true);
      } else {
        flushPendingHop(deps);
        const inputDot = previousInputX * input.x + previousInputY * input.y; // Used to detect a single-frame crossing into the opposite input hemisphere.
        blinkRuntimeDebug.inputDot = inputDot;
        if (inputDot < REVERSAL_DOT_THRESHOLD) {
          if (!performHop(deps, input, 'hemisphere-reversal')) {
            pendingHop = { x: input.x, y: input.y, reason: 'hemisphere-reversal' };
            blinkRuntimeDebug.pendingReversal = true;
          }
        }
        previousInputX = input.x;
        previousInputY = input.y;
      }

      speedBuildS = Math.min(MOVE_SPEED_BUILD_S, speedBuildS + Math.max(0, Number(dt) || 0));
      blinkRuntimeDebug.speedBuildS = speedBuildS;
      speedMul(); // Keeps the mobile debug snapshot current even before game.js asks Combat for this frame's movement multiplier.
      maybeSpawnMovementAfterimage(input);
      spendPassiveDrain(deps, dt);
      if (deps.player.stamina <= 0) stopHold('Blink Dodge dropped: stamina empty.');
    }

    function onHoldEnd() {
      stopHold('Blink Dodge ended.');
    }

    window.Combat.abilities.register('blinkDodge', { label: 'Blink Dodge', slotFamily: 'hold', category: 'defensiveHold', onHoldStart, onHoldUpdate, onHoldEnd });
  }

  window.HobunjiDodgeFeedback = Object.freeze({
    getDebug() {
      const player = window.Combat?.deps?.player;
      const remainingIframeMs = player
        ? Math.max(0, (Number(player.invulnUntil) || 0) - performance.now())
        : 0;
      return {
        iframeMissCount,
        lastIframeMissAtMs,
        remainingIframeMs,
        dodging: !!player?.dodging,
        blink: {
          ...blinkRuntimeDebug,
          afterimages: {
            ...afterimageRuntimeDebug,
            supported: !!window.THREE,
            motion: {
              dodging: dodgeAfterimageWasActive,
              lunging: lungeAfterimageWasActive,
              lastDodgeSampleAtMs: Number.isFinite(lastDodgeAfterimageAtS) ? lastDodgeAfterimageAtS * 1000 : null,
              lastLungeSampleAtMs: Number.isFinite(lastLungeAfterimageAtS) ? lastLungeAfterimageAtS * 1000 : null,
            },
          },
          tuning: {
            speedBuildS: MOVE_SPEED_BUILD_S,
            maxSpeedMul: MOVE_SPEED_MAX_MUL,
            passiveDrainBasePerS: PASSIVE_DRAIN_BASE_PER_S,
            passiveDrainQuantum: PASSIVE_DRAIN_QUANTUM,
            reversalDotThreshold: REVERSAL_DOT_THRESHOLD,
            hopCooldownS: ZIP_COOLDOWN_S,
            smearLifetimeS: SMEAR_LIFETIME_S,
            smearBaseOpacity: SMEAR_BASE_OPACITY,
            smearSampleIntervalS: SMEAR_SAMPLE_INTERVAL_S,
            smearMaxStretchWorld: SMEAR_MAX_STRETCH_WORLD,
            smearMaxActors: SMEAR_CACHE_MAX_ACTORS,
          },
        },
      };
    },
  });

  installIframeMissFeedback();
  installBaseDodgeEnhancements();
  register();
})();

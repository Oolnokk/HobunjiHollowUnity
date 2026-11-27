// Transient fluid presentation for actual resource/affliction events.
(() => {
  'use strict';

  const hooks = window.RenderHooks; // Composed avatar and garment poses exist only inside the world render frame.
  const THREE = window.THREE; // The game and both optional batches use the same Three.js instance.
  if (window.AfflictionFluidVfx || !hooks?.register || !THREE) return;

  const ID = 'affliction-fluid-vfx'; // Stable render-hook identifier for Pixel Probe and runtime gating.
  const MAX_PARTICLES = 256, MAX_PUDDLES = 16, MAX_QUEUED = 48; // Fixed budgets across all visible combatants.
  const PUDDLE_SIDES = 8, PUDDLE_MS = 2800, SIGHT_MS = 110; // Project once; periodically recheck cover while active.
  const PALETTES = {
    blood: [new THREE.Color(0xb7252c), new THREE.Color(0x6f161c)],
    poison: [new THREE.Color(0x8fa431), new THREE.Color(0x4e611d)],
    vomit: [new THREE.Color(0xa88e42), new THREE.Color(0x756527)],
  }; // Shared liquid geometry with separate venom and infection palettes.
  const TYPES = {
    'blood-drip': { palette: 'blood', lane: 'drip' },
    'poison-drip': { palette: 'poison', lane: 'drip' },
    'wound-spurt': { palette: 'blood', lane: 'spray' },
    'blood-spew': { palette: 'blood', lane: 'spray', mouth: true },
    'poison-spew': { palette: 'poison', lane: 'spray', mouth: true },
    vomit: { palette: 'vomit', lane: 'spray', mouth: true },
  }; // Separate drip and spray timing per actor while sharing existing particle geometry.
  const TYPE_GAP_MS = 90; // Leave this much time between different colors/origins in the same lane.
  const played = new WeakMap(); // Per-actor last rendered emission in each lane.
  const RANDOM = Math.random; // Cosmetic randomness must never advance the gameplay RNG.
  const cadence = new WeakMap(); // Separate visual timers for each actor and emission kind.
  const opaqueSamples = new WeakMap(); // Small alpha samples cached by the portrait/garment's current image.
  const pending = []; // Resource events collected before the current frame's final avatar pose.
  const roots = new Map(); // Only populated for pending actors with no direct avatar reference.
  const particles = [], puddles = []; // Compact active prefixes of the two pooled batches.
  const spareParticles = [], sparePuddles = []; // Reuse record storage after each effect expires.
  const stats = { emitted: {}, portraitSpurts: 0, pantsSpurts: 0, authoredMouthSprays: 0, landed: 0, hidden: 0, expired: 0, dropped: 0 }; // On-demand Pixel Probe counters.
  const origin = new THREE.Vector3(), normal = new THREE.Vector3(), aim = new THREE.Vector3();
  const eye = new THREE.Vector3(), ndc = new THREE.Vector3(), towardCamera = new THREE.Vector3(); // Scratch positions shared by the world hook.
  const uv = { x: 0, y: 0 }, pixel = { x: 0, y: 0 }; // Reused source coordinates for opaque-pixel attachment queries.
  const sightOpts = { radius: 0, deps: null, groundAt: null }; // Shared tile/door/cover query options for the player's line of sight.
  let alphaCanvas, particleBatch, puddleBatch, currentScene, currentArea, lastFrame;
  let sightEndpointFloor = null; // Shared for the synchronous sight query's endpoint only.
  sightOpts.groundAt = (x, z) => sightEndpointFloor && Math.hypot(x - sightEndpointFloor.x, z - sightEndpointFloor.z) < 0.16
    ? sightEndpointFloor.y - 0.016 : undefined;

  function emit(actor, type, intervalMs = 0) {
    if (!Object.hasOwn(TYPES, type) || !actor || actor.state === 'corpse' || actor.state === 'dying') return;
    const now = performance.now(); // Presentation cadence and lifetime use real milliseconds.
    let times = cadence.get(actor);
    if (intervalMs && now - (times?.[type] ?? -Infinity) < intervalMs) return;
    if (!times) { times = {}; cadence.set(actor, times); }
    times[type] = now; // An immediate Shattered spew also starts the interval before the first recurring one.
    const deps = window.Combat?.deps; // Drop events from gameplay running outside the locally presented scene.
    if (!deps || window.Combat.shouldPresentCombatVfx?.(actor) === false) return;
    const scene = deps.getActiveScene?.(), area = deps.getCurrentArea?.(); // Stamp events so a transition cannot replay an old burst.
    if (!scene) return;
    if (pending.length >= MAX_QUEUED) { stats.dropped++; return; }
    pending.push({ actor, type, scene, area });
    hooks.setEnabled(ID, true);
  }

  function makeBatch(count, points) {
    const geometry = new THREE.BufferGeometry(); // One draw each for every falling droplet and every projected puddle.
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    const options = { vertexColors: true, transparent: true, depthWrite: false }; // World depth hides fluid behind terrain and props.
    const material = points ? new THREE.PointsMaterial({ ...options, size: 0.065 })
      : new THREE.MeshBasicMaterial({ ...options, side: THREE.DoubleSide });
    if (points) material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>',
        'diffuseColor.a *= 1.0 - smoothstep(0.28, 0.5, length(gl_PointCoord - 0.5));');
    };
    const batch = points ? new THREE.Points(geometry, material) : new THREE.Mesh(geometry, material);
    batch.name = points ? 'affliction_fluid_droplets' : 'affliction_fluid_puddles';
    batch.userData.noOutline = true;
    batch.frustumCulled = false; // Individual puddles are checked below; the dynamic batch can span several unrelated positions.
    batch.renderOrder = points ? 31 : 3;
    batch.visible = false;
    return batch;
  }

  function sampleOpaque(image, vertexGrid = 0) {
    const width = image?.naturalWidth || image?.width, height = image?.naturalHeight || image?.height; // Source can be a composited canvas or a loaded animal PNG.
    if (!width || !height) return null;
    let sample = opaqueSamples.get(image);
    if (!sample) {
      alphaCanvas ||= document.createElement('canvas');
      alphaCanvas.width = alphaCanvas.height = 32;
      const context = alphaCanvas.getContext('2d', { willReadFrequently: true }); // A tiny readback per distinct artwork; never read a full portrait on each punishment.
      let alpha;
      try {
        context.drawImage(image, 0, 0, 32, 32);
        alpha = context.getImageData(0, 0, 32, 32).data;
      } catch (_) { return null; }
      sample = { alpha, pixels: [], vertices: new Map() };
      for (let i = 0; i < 1024; i++) if (alpha[i * 4 + 3] >= 200) sample.pixels.push(i);
      opaqueSamples.set(image, sample);
    }
    if (vertexGrid) {
      let vertices = sample.vertices.get(vertexGrid);
      if (!vertices) {
        vertices = [];
        for (let y = 0; y <= vertexGrid; y++) {
          for (let x = 0; x <= vertexGrid; x++) {
            const i = Math.min(31, Math.floor(y / vertexGrid * 32)) * 32 + Math.min(31, Math.floor(x / vertexGrid * 32));
            if (sample.alpha[i * 4 + 3] >= 200) vertices.push(y * (vertexGrid + 1) + x);
          }
        }
        sample.vertices.set(vertexGrid, vertices);
      }
      return vertices.length ? vertices[Math.floor(RANDOM() * vertices.length)] : null;
    }
    if (!sample.pixels.length) return null;
    const i = sample.pixels[Math.floor(RANDOM() * sample.pixels.length)]; // Center of a random opaque cell, away from transparent padding.
    uv.x = ((i % 32) + 0.5) / 32;
    uv.y = (Math.floor(i / 32) + 0.5) / 32;
    return uv;
  }

  function groundAt(x, z, maxY, deps) {
    const area = deps.getCurrentArea?.(); // Keep samples within the currently rendered floor stack.
    const terrain = window.AreaFootprintBlockers?.surfaceYAt?.(area, x, z) ?? deps.activeSurfaceYAtWorld?.(x, z);
    const support = window.DynamicSurfaces?.sampleSupport?.(x, z, { area, maxY, minY: Number.isFinite(terrain) ? Math.min(terrain - 0.02, maxY) : maxY - 24 })?.y;
    const walkable = window.HobunjiWalkableElevation?.supportAt?.(x, z, area, maxY)?.bounds.topY;
    const footprint = window.AreaFootprintBlockers?.supportAt?.(area, x, z, maxY)?.y; // Includes authored floor tops exposed by footprint providers.
    return Math.max(Number.isFinite(terrain) && terrain <= maxY + 0.025 ? terrain : -Infinity,
      Number.isFinite(support) ? support : -Infinity, Number.isFinite(walkable) ? walkable : -Infinity,
      Number.isFinite(footprint) ? footprint : -Infinity);
  }

  function spawnParticle(now, palette, colorIndex, vx, vy, vz, ground) {
    if (particles.length >= MAX_PARTICLES) { stats.dropped++; return; }
    const p = spareParticles.pop() || {}; // Coordinates and velocity remain world-space as the afflicted actor moves away.
    p.x = origin.x; p.y = origin.y; p.z = origin.z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.ground = ground; p.start = now; p.color = palette[colorIndex];
    p.life = Number.isFinite(ground) ? Math.max(700, Math.sqrt(Math.max(0, origin.y - ground) / 4.9) * 1000 + 120) : 290 + RANDOM() * 190;
    particles.push(p);
  }

  function cone(now, palette, count, axis, speed) {
    for (let i = 0; i < count; i++) {
      const strength = speed * (0.40 + RANDOM() * 0.60); // A rough cone with a thick core and uneven rim.
      spawnParticle(now, palette, i % 3 ? 0 : 1,
        (axis.x + (RANDOM() - 0.5) * 0.65) * strength,
        (axis.y + (RANDOM() - 0.5) * 0.48) * strength,
        (axis.z + (RANDOM() - 0.5) * 0.65) * strength, null);
    }
  }

  function portraitPoint(avatar, plane, image) {
    const sample = sampleOpaque(image); // Find an occupied pixel on this actor's own art.
    if (!sample) return false;
    if (avatar) {
      pixel.x = sample.x * (image.naturalWidth || image.width); pixel.y = sample.y * (image.naturalHeight || image.height);
      return !!window.PNGPlaneAvatar.resolveSkinnedPixelWorldPosition(avatar, pixel, origin);
    }
    const size = plane.geometry?.parameters; // Plain animal/NPC planes without a humanoid neck rig.
    if (!size) return false;
    if (plane.isSkinnedMesh && plane.boneTransform) {
      // Animal neck folds can move the visible silhouette. Sample a nearby vertex through the painted head skin.
      const attribute = plane.geometry.getAttribute('position');
      const row = Math.round(sample.y * size.heightSegments), col = Math.round(sample.x * size.widthSegments);
      const vertex = row * (size.widthSegments + 1) + col; // PlaneGeometry's row-major UV lattice.
      if (vertex < attribute.count) {
        plane.updateWorldMatrix(true, false);
        plane.updateMatrixWorld(true);
        plane.boneTransform(vertex, origin.fromBufferAttribute(attribute, vertex));
        plane.localToWorld(origin);
        return true;
      }
    }
    plane.localToWorld(origin.set((sample.x - 0.5) * size.width, (0.5 - sample.y) * size.height, 0));
    return true;
  }

  function faceCamera(camera, plane) {
    towardCamera.copy(camera.position).sub(origin).normalize(); // Small offset prevents the emitting point clipping into its own card.
    plane.updateWorldMatrix(true, false);
    normal.set(0, 0, 1).transformDirection(plane.matrixWorld);
    if (normal.dot(towardCamera) < 0) normal.negate();
    origin.addScaledVector(towardCamera, 0.032);
  }

  function present(event, root, now, camera, deps) {
    const { actor, type } = event; // Resolve the actual target's pose once per burst.
    const portraitApi = window.PNGPlaneAvatar;
    const avatar = portraitApi?.resolveSkinnedPortraitRoot?.(root);
    const plane = avatar?.userData.neckRig.skinnedPlane || actor.avatarRef?.frontPlane || window.CharacterVisuals?.portraitMeshOf?.(root);
    if (!plane) return;
    const image = avatar?.userData.sourceCanvas || plane.material?.map?.image; // Garment and portrait art may have different source dimensions.
    const style = TYPES[type], color = PALETTES[style.palette]; // Both poison presentations use the same green palette.
    let emitted = false;
    if (style.mouth) {
      const mouth = window.SharedAttackPose?.mouthPixel?.(avatar); // Same authored mouth coordinate as head-anchored held tools.
      if (mouth && portraitApi.resolveSkinnedPixelWorldPosition(avatar, mouth, origin)) {
        stats.authoredMouthSprays++;
      } else {
        const body = window.RangedWeapons?.actorHitbox?.(actor); // Creatures without an authored mouth use their own forward body bounds.
        if (!body?.center) return;
        const facing = actor.facing ?? actor.angle ?? 0;
        const reach = Math.min(body.halfX ?? 0.28, 0.37);
        origin.copy(body.center);
        origin.x += Math.cos(facing) * reach; origin.z += Math.sin(facing) * reach;
        origin.y += Math.min(0.25, (body.box?.max.y - body.center.y || 0.24) * 0.65);
      }
      faceCamera(camera, plane);
      const facing = actor.facing ?? actor.angle ?? 0; // Gameplay bearing keeps spit traveling out in front of the actor.
      aim.set(Math.cos(facing), 0.14, Math.sin(facing)).addScaledVector(normal, 0.35).normalize();
      cone(now, color, 15, aim, 2.65);
      emitted = true;
    } else if (type === 'wound-spurt') {
      for (let i = 0; i < 2; i++) {
        if (!portraitPoint(avatar, plane, image)) continue;
        faceCamera(camera, plane);
        aim.copy(normal); aim.y += RANDOM() * 0.35 - 0.1;
        cone(now, color, 7, aim.normalize(), 2.0);
        stats.portraitSpurts++;
        emitted = true;
      }
      const pants = root.getObjectByName?.('PantsGarmentMesh'); // Posed vertex lookup is only needed on a sharp punishment.
      const pantsPosition = pants?.geometry?.getAttribute('position'); // The held-object pass can temporarily hide an equipped garment.
      if (pantsPosition && pants.userData.pantsVertexToWorld) {
        const grid = Math.round(Math.sqrt(pantsPosition.count)) - 1; // Index the same regular UV grid used by the garment skin.
        for (let i = 0; i < 2; i++) {
          const index = sampleOpaque(pants.material.map?.image, grid);
          if (index == null) continue;
          pants.userData.pantsVertexToWorld(index, origin);
          faceCamera(camera, plane);
          aim.copy(normal); aim.y -= 0.22;
          cone(now, color, 7, aim.normalize(), 1.75);
          stats.pantsSpurts++;
          emitted = true;
        }
      }
    } else if (portraitPoint(avatar, plane, image)) {
      faceCamera(camera, plane);
      const floor = groundAt(origin.x, origin.z, origin.y, deps); // A drip projects onto the first floor beneath it, including raised bridges and platforms.
      if (Number.isFinite(floor)) {
        spawnParticle(now, color, 0, 0, -0.55, 0, floor);
        emitted = true;
      }
    }
    if (emitted) {
      stats.emitted[type] = (stats.emitted[type] || 0) + 1;
      stats.last = type;
    }
    return emitted;
  }

  function land(p, now, deps) {
    // Limit the trail in dense fights by retiring the oldest stain first.
    if (puddles.length >= MAX_PUDDLES) sparePuddles.push(puddles.shift());
    const stain = sparePuddles.pop() || { positions: new Float32Array(PUDDLE_SIDES * 9) }; // Each triangle follows the local terrain contour.
    stain.x = p.x; stain.y = p.ground + 0.016; stain.z = p.z;
    stain.start = now; stain.nextSight = 0; stain.color = p.color;
    const pos = stain.positions;
    const radius = 0.086 + RANDOM() * 0.045; // Tile-relative scale keeps each trail mark much smaller than a footprint.
    for (let i = 0; i < PUDDLE_SIDES; i++) {
      const angle = i * Math.PI * 2 / PUDDLE_SIDES, r = radius * (0.75 + RANDOM() * 0.5);
      let x = p.x + Math.cos(angle) * r, z = p.z + Math.sin(angle) * r * 0.72;
      let surface = groundAt(x, z, p.ground + 0.14, deps);
      if (Math.abs(surface - p.ground) > 0.14) { x = p.x; z = p.z; surface = p.ground; } // Stop the mark at a floor edge.
      const at = i * 9;
      pos[at] = stain.x; pos[at + 1] = stain.y; pos[at + 2] = stain.z;
      pos[at + 3] = x; pos[at + 4] = surface + 0.016; pos[at + 5] = z;
    }
    for (let i = 0; i < PUDDLE_SIDES; i++) {
      const at = i * 9 + 6, next = ((i + 1) % PUDDLE_SIDES) * 9 + 3; // Join the perimeter ring into individual ground triangles.
      pos[at] = pos[next]; pos[at + 1] = pos[next + 1]; pos[at + 2] = pos[next + 2];
    }
    puddles.push(stain);
    stats.landed++;
  }

  function seePuddle(stain, camera, now, deps, observer) {
    ndc.set(stain.x, stain.y, stain.z).project(camera); // Leaving the visible viewport permanently retires the stain this frame.
    if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1 || Math.abs(ndc.z) > 1) return false;
    if (now < stain.nextSight) return true;
    stain.nextSight = now + SIGHT_MS;
    if (!observer) return true;
    const x = observer.x / deps.TILE, z = observer.y / deps.TILE;
    if (Math.hypot(x - stain.x, z - stain.z) > 12) return false; // Ground flecks are too small to read beyond this range.
    const floor = observer.physicalFeetY ?? deps.activeSurfaceYAtWorld?.(x, z);
    eye.set(x, (Number.isFinite(floor) ? floor : 0) + 0.65, z);
    ndc.set(stain.x, stain.y + 0.04, stain.z); // Keep endpoint above its supporting ground for the shared cover sampler.
    sightOpts.deps = deps;
    sightEndpointFloor = stain;
    const hit = window.ThrowCoverTrajectory?.sweep?.(eye, ndc, sightOpts);
    sightEndpointFloor = null;
    return (!hit || hit.t >= 0.985) && window.RangedWeapons?.worldGeometryBlocksSight?.(eye, ndc) !== true;
  }

  function setColor(colors, index, color, opacity) {
    colors.setXYZW(index, color.r, color.g, color.b, opacity);
  }

  function publish(batch, count) {
    batch.visible = count > 0;
    batch.geometry.setDrawRange(0, count);
    if (count) {
      batch.geometry.attributes.position.needsUpdate = true;
      batch.geometry.attributes.color.needsUpdate = true;
    }
  }

  function presentPending(scene, area, now, camera, deps) {
    for (const event of pending) {
      if (event.scene === scene && event.area === area && !event.actor.avatarRef?.group) roots.set(event.actor, null);
    }
    let unresolved = roots.size; // Stop scanning as soon as the queued actors' roots are found.
    if (unresolved) window.CharacterVisuals?.forEachCharacter?.(area, (_kind, root, actor) => {
      if (roots.get(actor) !== null) return false;
      roots.set(actor, root);
      return --unresolved === 0;
    });
    let kept = 0; // Compact the queue in place, retaining effects waiting for another frame.
    for (const event of pending) {
      if (event.scene !== scene || event.area !== area || window.Combat.shouldPresentCombatVfx?.(event.actor) === false) continue;
      // An accepted event can wait across a slow frame. Scene changes and the global queue cap bound pending work.
      let lanes = played.get(event.actor); // Keep one lane for drips and one for sprays.
      if (!lanes) { lanes = {}; played.set(event.actor, lanes); }
      const key = TYPES[event.type].lane; // All portrait and pants cones from one wound-spurt stay in a single event.
      const lane = lanes[key] ||= { at: -Infinity };
      if (lane.blockedFrame === lastFrame || (lane.type !== event.type && now - lane.at < TYPE_GAP_MS)) {
        lane.blockedFrame = lastFrame; // A later event in this lane cannot overtake a deferred event.
        pending[kept++] = event;
        continue;
      }
      const root = event.actor.avatarRef?.group || roots.get(event.actor) || window.RemotePlayerAvatar?.getWalker?.(event.actor)?.root;
      if (root?.parent && root.visible && present(event, root, now, camera, deps)) {
        lane.at = now; // Use the actual draw time so even slow render frames keep the bursts distinct.
        lane.type = event.type;
      }
    }
    pending.length = kept;
    roots.clear();
  }

  function drawFrame({ frame, scene, camera }) {
    if (lastFrame === frame.id) return; // Still once per frame with RenderHooks' per-pass A/B mode.
    lastFrame = frame.id;
    const deps = window.Combat.deps, area = deps.getCurrentArea?.(), now = performance.now();
    if (scene !== currentScene || area !== currentArea) {
      for (const p of particles) spareParticles.push(p);
      for (const p of puddles) sparePuddles.push(p);
      particles.length = puddles.length = 0;
      currentScene = scene; currentArea = area;
    }
    particleBatch ||= makeBatch(MAX_PARTICLES, true);
    puddleBatch ||= makeBatch(MAX_PUDDLES * PUDDLE_SIDES * 3, false);
    if (particleBatch.parent !== scene) scene.add(particleBatch, puddleBatch);
    camera.updateWorldMatrix(true, false); // The projection below needs this frame's inverse before the native renderer.
    if (pending.length) presentPending(scene, area, now, camera, deps);

    const pp = particleBatch.geometry.attributes.position, pc = particleBatch.geometry.attributes.color;
    let count = 0;
    for (const p of particles) {
      const elapsed = (now - p.start) / 1000;
      const y = p.y + p.vy * elapsed - 4.9 * elapsed * elapsed;
      if (p.ground != null && y <= p.ground) land(p, now, deps);
      else if (elapsed * 1000 < p.life) {
        pp.setXYZ(count, p.x + p.vx * elapsed, y, p.z + p.vz * elapsed);
        setColor(pc, count, p.color, 0.94 * Math.min(1, (1 - elapsed * 1000 / p.life) * 2.5));
        particles[count++] = p; // Compact in place; positions and active records share the same count.
        continue;
      }
      spareParticles.push(p);
    }
    particles.length = count;
    publish(particleBatch, count);

    const positions = puddleBatch.geometry.attributes.position, colors = puddleBatch.geometry.attributes.color;
    const observer = window.ActorRegistry?.getLocalPlayer?.(); // Only this client's player and camera decide which local puddles can remain visible.
    count = 0;
    for (const p of puddles) {
      const age = now - p.start;
      if (age >= PUDDLE_MS) stats.expired++;
      else if (!seePuddle(p, camera, now, deps, observer)) stats.hidden++;
      else {
        const start = count * PUDDLE_SIDES * 3;
        positions.array.set(p.positions, start * 3);
        const opacity = 0.82 * Math.min(1, (PUDDLE_MS - age) / 800);
        for (let i = 0; i < PUDDLE_SIDES * 3; i++) setColor(colors, start + i, p.color, opacity);
        puddles[count++] = p;
        continue;
      }
      sparePuddles.push(p);
    }
    puddles.length = count;
    publish(puddleBatch, count * PUDDLE_SIDES * 3);
    if (!particles.length && !puddles.length && !pending.length) {
      scene.remove(particleBatch, puddleBatch); // Keep GPU buffers pooled but remove both objects from idle/streamed scene traversal.
      currentScene = currentArea = null; // Do not pin an evicted wilderness scene while this hook sleeps.
      hooks.setEnabled(ID, false);
    }
  }

  hooks.register({
    id: ID, owner: 'combat/affliction-fluid-vfx.js', scope: 'frame', enabled: false,
    order: hooks.ORDER.NPC_SOCIAL_INHIBITION + 1, // Read the final actor, leg and head poses after the existing composer hooks.
    appliesTo: ctx => ctx.worldScene && ctx.camera === ctx.frame.camera,
    before: drawFrame,
  });

  window.AfflictionFluidVfx = Object.freeze({
    emit,
    debugSnapshot: () => ({ ...stats, emitted: { ...stats.emitted }, particles: particles.length, puddles: puddles.length, queued: pending.length, staggerMs: TYPE_GAP_MS,
      latestChange: 'Internal poison uses the green mouth spray. Different drip or spray types on the same actor are staggered.' }),
  });
})();

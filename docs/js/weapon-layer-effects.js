// Material and interleaved particle effects for the shared multi-sprite weapon assembly.
// All masks are authored-PNG pixel data, never the already recolored texture.
// No timers/RAF: weapon-sprite-assemblies.js calls tick() in its existing pre-render update.
(function (global) {
  'use strict';
  if (global.HobunjiLayeredWeaponEffects) return;

  const METAL_HEX = '#5A8480'; // Same source key as ToolMetalRecolor and WeaponEnchantmentVFX.
  const OPAQUE = 128; // Alpha cutoff for visible pixels that occlude particles and underlying metal.
  const MAX_FIRE_PARTICLES = 32; // Upper bound per assembled head to protect mobile frame times.
  const FIRE_DEPTH_OFFSET = 0.001; // Fire's depth stays near the rag while later layers overdraw it.
  const RAG_HEX = '#E7DDC9'; // Default off-white cloth/wick tint for fuel markers.
  const pixelsByImage = new WeakMap(); // Read-only source RGBA scans cached once per PNG.
  const ragCanvases = new WeakMap(); // Source image -> palette-keyed recoloring canvases.
  const sourceMaskCache = new WeakMap(); // Marker/metal pixel matches are read once per PNG+hex, including the editor's animated preview.
  let fireTexture = null; // Shared transparent emitter texture, created only for a head that emits fire.

  function hexRgb(hex) {
    const s = String(hex || '').replace(/^#/, '');
    const n = parseInt(s, 16);
    return Number.isFinite(n) && /^[0-9a-f]{6}$/i.test(s) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [231, 221, 201];
  }

  function rgbHsv(r, g, b) {
    if (global.ColorFill?.rgbToHsv) return global.ColorFill.rgbToHsv(r, g, b);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    let h = 0;
    if (delta) {
      if (max === r) h = ((g - b) / delta) % 6;
      else if (max === g) h = (b - r) / delta + 2;
      else h = (r - g) / delta + 4;
      h = (h * 60 + 360) % 360;
    }
    return { h, s: max ? delta / max : 0, v: max / 255 };
  }

  function hueDistance(a, b) {
    return global.ColorFill?.hueDistance?.(a, b) ?? Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  }

  function pixelMaskMatches(r, g, b, marker, kind) {
    const a = rgbHsv(r, g, b);
    const ref = rgbHsv(...hexRgb(marker));
    if (kind === 'metal') return hueDistance(a.h, ref.h) <= 22 && Math.abs(a.s - ref.s) <= 0.22;
    return hueDistance(a.h, ref.h) <= 15 && a.s >= 0.42; // Hachutu binding-mask eye hue family, including its darker shaded pixels.
  }

  function rgba(image) {
    if (!image) return null;
    const cached = pixelsByImage.get(image);
    if (cached) return cached;
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!(width > 0 && height > 0)) return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0, width, height);
      const result = { width, height, data: context.getImageData(0, 0, width, height).data };
      pixelsByImage.set(image, result);
      return result;
    } catch (error) {
      global.__farmLog?.('[weapon layer] Image alpha/color scan failed: ' + (error?.message || error), 'error');
      return null;
    }
  }

  function sourcePixels(image, hex, kind) {
    const source = rgba(image);
    if (!source) return [];
    let cache = sourceMaskCache.get(image);
    if (!cache) { cache = new Map(); sourceMaskCache.set(image, cache); }
    const key = kind + ':' + hex;
    if (cache.has(key)) return cache.get(key);
    const hits = [];
    for (let i = 0; i < source.data.length; i += 4) {
      if (source.data[i + 3] < OPAQUE) continue;
      if (pixelMaskMatches(source.data[i], source.data[i + 1], source.data[i + 2], hex, kind)) hits.push(i >> 2);
    }
    cache.set(key, hits); // Tool Hub preview can now sample every frame without rescanning thousands of RGBA pixels.
    return hits;
  }

  function offsetOf(layer) {
    return { x: Number(layer?.offsetPx?.x) || 0, y: Number(layer?.offsetPx?.y) || 0 };
  }

  function coveredByUpperLayers(x, y, sourceLayer, layers, sourceIndex) {
    const initial = layers[sourceIndex];
    const from = rgba(initial.image);
    if (!from) return false;
    const o = offsetOf(initial.config);
    const lx = x + 0.5 - from.width * 0.5 + o.x;
    const ly = y + 0.5 - from.height * 0.5 + o.y;
    for (let i = sourceIndex + 1; i < layers.length; i++) {
      const upper = layers[i];
      const data = rgba(upper.image);
      if (!data) continue;
      const upperOffset = offsetOf(upper.config);
      const px = Math.floor(lx + data.width * 0.5 - upperOffset.x);
      const py = Math.floor(ly + data.height * 0.5 - upperOffset.y);
      if (px < 0 || py < 0 || px >= data.width || py >= data.height) continue;
      if (data.data[(py * data.width + px) * 4 + 3] >= OPAQUE) return true;
    }
    return false;
  }

  // Metal enchantment sources are generated after all four head layers exist.
  // Never include the chain or haft. Later opaque head layers occlude earlier
  // metal so the mask matches the pixels actually visible post assembly.
  function visibleMetalTargets(layers) {
    const targets = [];
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      const layer = layers[layerIndex];
      if (layer.config.material !== 'metal') continue;
      const imageData = rgba(layer.image);
      if (!imageData) continue;
      const indices = sourcePixels(layer.image, METAL_HEX, 'metal').filter(index => {
        const x = index % imageData.width, y = Math.floor(index / imageData.width);
        return !coveredByUpperLayers(x, y, layer, layers, layerIndex);
      });
      if (!indices.length) continue;
      targets.push({
        plane: layer.mesh,
        mask: {
          width: imageData.width, height: imageData.height,
          indices: Uint32Array.from(indices), matchedMetalPixels: indices.length,
        },
      });
    }
    return targets;
  }

  function recolorMarker(image, sourceHex, targetHex) {
    const source = rgba(image);
    if (!source) return null;
    const key = String(sourceHex || '#7F00FF') + '|' + String(targetHex || RAG_HEX);
    let cache = ragCanvases.get(image);
    if (cache?.has(key)) return cache.get(key);
    if (!cache) { cache = new Map(); ragCanvases.set(image, cache); }
    const canvas = document.createElement('canvas');
    canvas.width = source.width; canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    const output = ctx.createImageData(source.width, source.height);
    output.data.set(source.data);
    const rgb = hexRgb(targetHex || RAG_HEX);
    for (let p = 0; p < output.data.length; p += 4) {
      if (source.data[p + 3] < 4) continue;
      const [r, g, b] = [source.data[p], source.data[p + 1], source.data[p + 2]];
      if (!pixelMaskMatches(r, g, b, sourceHex || '#7F00FF', 'marker')) continue;
      const shade = Math.max(0.24, Math.min(1.08, Math.max(r, g, b) / 255));
      output.data[p] = Math.round(rgb[0] * shade);
      output.data[p + 1] = Math.round(rgb[1] * shade);
      output.data[p + 2] = Math.round(rgb[2] * shade);
    }
    ctx.putImageData(output, 0, 0);
    cache.set(key, canvas);
    return canvas;
  }

  function registerLayer(state, mesh, layer, image) {
    if (!state.materialLayers) state.materialLayers = []; // Layer metadata drives per-weapon color refresh and montage masks.
    state.materialLayers.push({ mesh, config: layer, image });
    if (layer.material === 'marker') {
      const canvas = recolorMarker(image, layer.sourceHex, layer.targetHex);
      if (canvas && mesh.material?.map) {
        mesh.material.map.image = canvas;
        mesh.material.map.needsUpdate = true;
      }
    }
  }

  function refreshMetal(state, now) {
    if (state.dead || !state.materialLayers?.length || now - (state.lastMetalCheck || 0) < 1200) return;
    state.lastMetalCheck = now; // Polls only for material-policy changes such as newly earned verdigris or plating.
    const fallback = { targetHex: '#CD7F32', verdigrisHex: '#57B38B', oxidationAmount: 0 };
    const opts = state.metalOptions?.() || fallback; // Game supplies its existing plating/mastery metal resolver.
    const token = JSON.stringify([opts.targetHex, opts.verdigrisHex, Math.round((Number(opts.oxidationAmount) || 0) * 10), opts.authoredPattern || null]);
    if (token === state.lastMetalToken) return;
    state.lastMetalToken = token;
    const request = (state.metalRevision || 0) + 1; // Invalidates async recolors when equipment or plating changes.
    state.metalRevision = request;
    const recolor = global.ToolMetalRecolor?.getRecoloredCanvas;
    if (!recolor) return; // Editor without the optional color-preview module keeps its source PNGs.
    const paths = state.materialLayers.filter(layer => layer.config.material === 'metal');
    for (const entry of paths) {
      const src = state.resolveAsset(entry.config.sprite);
      Promise.resolve(recolor(src, { ...opts, oxidationAmount: Math.round((Number(opts.oxidationAmount) || 0) * 10) / 10 })).then(canvas => {
        if (state.dead || state.metalRevision !== request || !entry.mesh.material?.map || !canvas) return;
        entry.mesh.material.map.image = canvas;
        entry.mesh.material.map.needsUpdate = true;
      }).catch(error => global.__farmLog?.('[weapon layer] Metal recolor: ' + error.message, 'error'));
    }
  }

  function createFireTexture(THREE) {
    if (fireTexture) return fireTexture;
    const canvas = document.createElement('canvas'); // Compact original fire mote, not a downloaded sprite/texture.
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(16, 19, 1, 16, 17, 16);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 32, 32);
    fireTexture = new THREE.CanvasTexture(canvas);
    fireTexture.needsUpdate = true;
    return fireTexture;
  }

  function fireClusters(pixels, width, count) {
    // Source-PNG pixels determine stable, per-end ignition sites; never cluster recolored images.
    if (count !== 2 || pixels.length < 2) return null;
    const coords = pixels.map(index => ({ index, x: index % width, y: Math.floor(index / width) }));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity; // Single pass avoids massive spread-argument lists on large source PNGs.
    for (const point of coords) {
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
    }
    const vertical = maxY - minY >= maxX - minX;
    const axis = point => vertical ? point.y : point.x;
    const middle = vertical ? (minY + maxY) / 2 : (minX + maxX) / 2;
    let halves = [coords.filter(point => axis(point) <= middle), coords.filter(point => axis(point) > middle)];
    if (!halves[0].length || !halves[1].length) {
      const sorted = coords.slice().sort((a, b) => axis(a) - axis(b));
      const split = Math.floor(sorted.length / 2);
      halves = [sorted.slice(0, split), sorted.slice(split)];
    }
    return halves.map(points => ({
      pixels: points.map(point => point.index),
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    }));
  }

  function fireRank(state, spec) {
    if (!spec.masteryClusters) return 5; // Classic torch-flail fire is not mastery-dependent.
    const level = Number(state.masteryLevel?.());
    return Number.isFinite(level) ? Math.max(0, Math.min(5, level)) : 0;
  }

  function activateStack(state, layers, owner, unit) {
    // One ordered stack drives both regular layered tools and multi-piece flail heads.
    state.metalTargets = [...(state.metalTargets || []), ...visibleMetalTargets(layers)]; // Each authored stack contributes its visible metal masks; flail heads must not erase haft masks.
    const emitters = [];
    layers.forEach((layer, index) => {
      const spec = layer.config.vfx;
      if (!spec || spec.type !== 'fire') return;
      const pix = rgba(layer.image);
      if (!pix) return;
      const sources = sourcePixels(layer.image, spec.sourceHex || layer.config.sourceHex || '#7F00FF', 'marker');
      if (!sources.length) return;
      const THREE = state.THREE;
      const group = new THREE.Group(); // Local to rotating head or rigid weapon; maintains ordered depth with source artwork.
      group.name = 'weapon_interleaved_fire_' + layer.config.id;
      group.userData.weaponInterleavedVfx = true;
      owner.add(group); // Fire inherits the weapon pose without scaling the visible staff PNG.
      const clusters = fireClusters(sources, pix.width, spec.masteryClusters); // Original marker pixels define independent staff-tip ignition areas.
      const requestedScale = Number(spec.visualScale); // Artist-controlled geometric scale; omitted on existing flails to preserve their look.
      const visualScale = Number.isFinite(requestedScale) && requestedScale > 0 ? Math.max(0.1, Math.min(8, requestedScale)) : 1;
      const off = offsetOf(layer.config);
      const anchors = visualScale === 1 ? null : (clusters || [{
        x: sources.reduce((sum, pixel) => sum + pixel % pix.width, 0) / sources.length,
        y: sources.reduce((sum, pixel) => sum + Math.floor(pixel / pix.width), 0) / sources.length,
      }]).map(center => {
        const x = (center.x + 0.5 - pix.width / 2 + off.x) * unit;
        const y = (pix.height / 2 - center.y - 0.5 - off.y) * unit;
        const pivot = new THREE.Group(); // Same parent-group scaling as the brazier, but centered on THIS end of the staff.
        pivot.position.set(x, y, 0);
        pivot.scale.setScalar(visualScale); // Enlarges plume geometry, rise and lateral motion together, not brightness/particle count.
        group.add(pivot);
        return { group: pivot, x, y };
      });
      const above = layers[index + 1]?.mesh;
      const renderOrder = layer.mesh.renderOrder + ((above?.renderOrder || layer.mesh.renderOrder + 0.001) - layer.mesh.renderOrder) / 2;
      emitters.push({
        config: spec, sourceLayer: layer.config, image: pix, sources,
        clusters, anchors, visualScale, // Geometric per-tip parent scaling matches the flail-head transform.
        group, renderOrder, unit, particles: [], pool: [], accumulation: 0,
        worldRise: spec.worldRise === true, // Opt in: torch-staff and brazier particles travel along world-up even as their weapons rotate.
        worldTarget: spec.worldRise === true ? new THREE.Vector3() : null, // Shared scratch vector avoids per-frame GC for world-space positions.
        worldScale: spec.worldRise === true ? new THREE.Vector3() : null, // Capture parent/visual scale at emission, without changing world-up direction.
        texture: createFireTexture(THREE),
      });
    });
    state.fireEmitters = [...(state.fireEmitters || []), ...emitters]; // Keep emitters belonging to earlier rigid-weapon or flail-head stacks alive until shared teardown.
  }

  function activateHead(state, head, images, unit) {
    const layers = head.layers.map((config, index) => ({
      config, mesh: state.headParts[index], image: images[index].image,
    })); // Ordered flail head stack.
    activateStack(state, layers, state.headRoot, unit);
  }

  function activateStatic(state, base, layers, meshes, sourceImage, unit) {
    if (Array.isArray(base)) {
      // Preserve old five-argument callers (including existing flail regression fixtures).
      unit = sourceImage; sourceImage = meshes; meshes = layers; layers = base; base = null;
    }
    const all = [
      { config: { id: 'base', ...(base || { material: 'metal' }) }, mesh: state.plane, image: sourceImage },
      ...layers.map((config, index) => ({
        config, mesh: meshes[index],
        image: state.materialLayers.find(entry => entry.mesh === meshes[index])?.image,
      })),
    ]; // The ordinary weapon's original PNG is layer zero, followed by authored overlays.
    activateStack(state, all, state.plane, unit);
  }

  function stepFire(state, dt) {
    if (!state.fireEmitters?.length) return;
    const THREE = state.THREE;
    for (const fx of state.fireEmitters) {
      for (let p = fx.particles.length - 1; p >= 0; p--) {
        const particle = fx.particles[p];
        particle.age += dt;
        const t = particle.age / particle.life;
        if (t >= 1) {
          particle.sprite.visible = false;
          particle.sprite.parent?.remove(particle.sprite); // With per-tip pivots, the emitter root is no longer the direct sprite parent.
          fx.pool.push(particle.sprite);
          fx.particles.splice(p, 1);
          continue;
        }
        if (fx.worldRise) {
          // Existing motes keep the world-space origin captured at ignition; a moving or spinning
          // weapon changes where NEW flames spawn, never the direction or position of old ones.
          fx.worldTarget.copy(particle.spawnWorld);
          fx.worldTarget.x += Math.sin(particle.age * 13 + particle.phase) * particle.worldDrift * t;
          fx.worldTarget.y += particle.worldSpeed * particle.age; // World +Y is up, regardless of the head/staff pitch.
          particle.sprite.position.copy(particle.sprite.parent.worldToLocal(fx.worldTarget));
        } else {
          particle.sprite.position.x = particle.x + Math.sin(particle.age * 13 + particle.phase) * fx.unit * 6 * t;
          particle.sprite.position.y = particle.y + particle.speed * particle.age;
        }
        const opacity = Number(fx.config.opacity); // Optional per-mote alpha controls overlap without shrinking flame geometry.
        particle.sprite.material.opacity = Math.sin(Math.PI * t) * (Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 0.92);
        particle.sprite.scale.setScalar(particle.size * (0.5 + t * 1.5));
      }
      fx.accumulation = Math.min(2, fx.accumulation + dt * Math.min(60, Math.max(0, Number(fx.config.rate) || 0)));
      while (fx.accumulation >= 1 && fx.particles.length < MAX_FIRE_PARTICLES) {
        fx.accumulation -= 1;
        const growth = fireRank(state, fx.config) / 5;
        const focus = Number(fx.config.masteryFocus); // Maximum tip-centering, leaving a configurable fuel footprint so large plumes retain shape.
        const merge = growth * growth * (3 - 2 * growth) * (Number.isFinite(focus) ? Math.max(0, Math.min(1, focus)) : 1);
        const clusterIndex = fx.clusters ? Math.floor(Math.random() * fx.clusters.length) : 0;
        const cluster = fx.clusters?.[clusterIndex];
        const anchor = fx.anchors?.[clusterIndex]; // Pivots stay fixed at their original pixel-cluster centers.
        const candidates = cluster?.pixels || fx.sources;
        const pixel = candidates[Math.floor(Math.random() * candidates.length)];
        const sourceX = pixel % fx.image.width, sourceY = Math.floor(pixel / fx.image.width);
        const x = cluster ? sourceX + (cluster.x - sourceX) * merge : sourceX;
        const y = cluster ? sourceY + (cluster.y - sourceY) * merge : sourceY;
        const off = offsetOf(fx.sourceLayer);
        const px = (x + 0.5 - fx.image.width / 2 + off.x) * fx.unit;
        const py = (fx.image.height / 2 - y - 0.5 - off.y) * fx.unit;
        const colors = fx.config.colors?.length ? fx.config.colors : ['#FFA940'];
        const color = colors[Math.floor(Math.random() * colors.length)];
        let sprite = fx.pool.pop();
        if (!sprite) sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: fx.texture, transparent: true, opacity: 0,
          depthWrite: false, depthTest: true,
          blending: fx.config.blendMode === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending, // Non-additive flames keep distinct colors instead of white-hot overdraw.
        }));
        sprite.material.color.set(color);
        sprite.renderOrder = fx.renderOrder; // Interleaved between fuel and later metal silhouettes (front).
        const overlayLayer = global.HeldObjectRenderOrder?.HELD_OVERLAY_LAYER; // Shared x-ray held-object replay draws fire with the assembled metal, never through world geometry.
        if (Number.isInteger(overlayLayer) && ((fx.group.parent?.children?.[0]?.layers?.mask >>> overlayLayer) & 1)) sprite.layers.set(overlayLayer);
        else sprite.layers.set(0);
        const localX = anchor ? px - anchor.x : px;
        const localY = anchor ? py - anchor.y : py;
        sprite.position.set(localX, localY, FIRE_DEPTH_OFFSET / fx.visualScale);
        sprite.visible = true;
        (anchor?.group || fx.group).add(sprite); // Keep the render-order stack and per-tip scale, even for world-moving particles.
        const speed = (Number.isFinite(fx.config.speed) ? Math.max(0, fx.config.speed) : 0.12) * (0.5 + Math.random()); // Local rise rate reused for world-up emission.
        let spawnWorld = null, worldSpeed = 0, worldDrift = 0; // Per-particle ignition origin and parent-scale-adjusted world velocity.
        if (fx.worldRise) {
          spawnWorld = sprite.getWorldPosition(new THREE.Vector3()); // Capture actual tip position, after holder and flail motion.
          sprite.parent.getWorldScale(fx.worldScale); // Head scale 2.5 or tip scale 4 changes distance, never world-up direction.
          worldSpeed = speed * Math.abs(fx.worldScale.y);
          worldDrift = fx.unit * 6 * Math.abs(fx.worldScale.x);
        }
        fx.particles.push({
          sprite, age: 0, life: Math.max(0.1, Number(fx.config.life) || 0.65),
          x: localX, y: localY, speed, spawnWorld, worldSpeed, worldDrift,
          phase: Math.random() * 6.283,
          size: Math.max(0.001, (Number(fx.config.size) || 0.035) * (fx.config.masteryClusters ? 0.22 + 0.78 * growth : 1)), // Local mote size stays at brazier baseline; the pivot scales the entire fire.
        });
      }
    }
  }

  function dispose(state) {
    if (!state.fireEmitters) return;
    for (const fx of state.fireEmitters) {
      for (const particle of fx.particles) particle.sprite.material?.dispose?.(); // Per-tip child groups must not hide materials from teardown.
      for (const sprite of fx.pool) sprite.material?.dispose?.();
      fx.group.parent?.remove?.(fx.group);
      fx.particles.length = 0;
      fx.pool.length = 0;
    }
    state.fireEmitters = [];
  }

  global.HobunjiLayeredWeaponEffects = Object.freeze({
    registerLayer, activateHead, activateStatic, refreshMetal, stepFire, dispose,
    visibleMetalTargets, sourcePixels, recolorMarker, coveredByUpperLayers, fireClusters,
  });
})(window);

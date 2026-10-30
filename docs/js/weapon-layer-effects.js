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
    const hits = [];
    for (let i = 0; i < source.data.length; i += 4) {
      if (source.data[i + 3] < OPAQUE) continue;
      if (pixelMaskMatches(source.data[i], source.data[i + 1], source.data[i + 2], hex, kind)) hits.push(i >> 2);
    }
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

  function activateHead(state, head, images, unit) {
    const layers = head.layers.map((config, index) => ({
      config, mesh: state.headParts[index], image: images[index].image,
    })); // Ordered physical layers; VFX may occupy any inter-layer gap.
    state.metalTargets = visibleMetalTargets(layers);
    const emitters = [];
    layers.forEach((layer, index) => {
      const spec = layer.config.vfx;
      if (!spec || spec.type !== 'fire') return;
      const pix = rgba(layer.image);
      if (!pix) return;
      const sources = sourcePixels(layer.image, spec.sourceHex || layer.config.sourceHex || '#7F00FF', 'marker');
      if (!sources.length) return;
      const THREE = state.THREE;
      const group = new THREE.Group(); // Local to rotating head, not shaft; particles originate in the fuel's image frame.
      group.name = 'weapon_interleaved_fire_' + layer.config.id;
      group.userData.weaponInterleavedVfx = true;
      state.headRoot.add(group);
      const above = layers[index + 1]?.mesh;
      const renderOrder = layer.mesh.renderOrder + ((above?.renderOrder || layer.mesh.renderOrder + 0.001) - layer.mesh.renderOrder) / 2;
      emitters.push({
        config: spec, sourceLayer: layer.config, image: pix, sources,
        group, renderOrder, unit, particles: [], pool: [], accumulation: 0,
        texture: createFireTexture(THREE),
      });
    });
    state.fireEmitters = emitters; // Updated by the assembly's existing pre-render clock.
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
          fx.group.remove(particle.sprite);
          fx.pool.push(particle.sprite);
          fx.particles.splice(p, 1);
          continue;
        }
        particle.sprite.position.x = particle.x + Math.sin(particle.age * 13 + particle.phase) * fx.unit * 6 * t;
        particle.sprite.position.y = particle.y + particle.speed * particle.age;
        particle.sprite.material.opacity = Math.sin(Math.PI * t) * 0.92;
        particle.sprite.scale.setScalar(particle.size * (0.5 + t * 1.5));
      }
      fx.accumulation = Math.min(2, fx.accumulation + dt * Math.min(40, Math.max(0, Number(fx.config.rate) || 0)));
      while (fx.accumulation >= 1 && fx.particles.length < MAX_FIRE_PARTICLES) {
        fx.accumulation -= 1;
        const pixel = fx.sources[Math.floor(Math.random() * fx.sources.length)];
        const x = pixel % fx.image.width, y = Math.floor(pixel / fx.image.width);
        const off = offsetOf(fx.sourceLayer);
        const px = (x + 0.5 - fx.image.width / 2 + off.x) * fx.unit;
        const py = (fx.image.height / 2 - y - 0.5 - off.y) * fx.unit;
        const colors = fx.config.colors?.length ? fx.config.colors : ['#FFA940'];
        const color = colors[Math.floor(Math.random() * colors.length)];
        let sprite = fx.pool.pop();
        if (!sprite) sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: fx.texture, transparent: true, opacity: 0,
          depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
        }));
        sprite.material.color.set(color);
        sprite.renderOrder = fx.renderOrder; // Interleaved between fuel and later metal silhouettes (front).
        const overlayLayer = global.HeldObjectRenderOrder?.HELD_OVERLAY_LAYER; // Shared x-ray held-object replay draws fire with the assembled metal, never through world geometry.
        if (Number.isInteger(overlayLayer) && ((fx.group.parent?.children?.[0]?.layers?.mask >>> overlayLayer) & 1)) sprite.layers.set(overlayLayer);
        else sprite.layers.set(0);
        sprite.position.set(px, py, FIRE_DEPTH_OFFSET);
        sprite.visible = true;
        fx.group.add(sprite);
        fx.particles.push({
          sprite, age: 0, life: Math.max(0.1, Number(fx.config.life) || 0.65),
          x: px, y: py, speed: (Number(fx.config.speed) || 0.12) * (0.5 + Math.random()),
          phase: Math.random() * 6.283, size: Math.max(0.004, Number(fx.config.size) || 0.035),
        });
      }
    }
  }

  function dispose(state) {
    if (!state.fireEmitters) return;
    for (const fx of state.fireEmitters) {
      for (const child of [...fx.group.children, ...fx.pool]) child.material?.dispose?.();
      fx.group.parent?.remove?.(fx.group);
      fx.particles.length = 0;
      fx.pool.length = 0;
    }
    state.fireEmitters = [];
  }

  global.HobunjiLayeredWeaponEffects = Object.freeze({
    registerLayer, activateHead, refreshMetal, stepFire, dispose,
    visibleMetalTargets, sourcePixels, recolorMarker, coveredByUpperLayers,
  });
})(window);

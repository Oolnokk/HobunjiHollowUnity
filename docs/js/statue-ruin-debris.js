// Statue footprints filled with ruin debris (window.StatueRuinDebris).
//
// The wilderness generator places "statue" landmarks (1x1 or 1x2 blocking
// tiles, rockKind 'statue') that no renderer ever drew: they fell through to
// the generic outlined rock mound. Each footprint now holds a heap of
// super-ruined debris from the Debris-ifier V50 (tools/debris-ifier), the same
// generator the ruin interiors use:
//
//   1. its outdoor locale mode builds a tiny ruin (roadside remnant / small
//      ritual site / broken marker) from repo furniture, with toppling,
//      burial and density at maximum;
//   2. every piece of it then goes through the single-model damage pass
//      (low cut, max jagged/crumble, upper part fallen, rubble) — "super
//      ruined";
//   3. the result is merged into one unlit carved-stone mesh (one draw).
//
// A few such variants are generated per zone (seeded by zone, so a zone
// always shows the same debris) in a hidden iframe running the tool in its
// local-transport runtime mode; footprints pick a variant by tile hash and
// get a quarter-turn and fit-to-footprint scale. Tiles keep blocking exactly
// as before. If the generator cannot run, footprints get the caller's
// fallback (a farm-style stone) instead of an invisible wall.
//
// Wiring: game.js's zone floor builder hands each chunk's statue tiles to
// fill(); debris meshes share pool geometry and are never chunk-owned.
// StatueRuinDebris.setEnabled(false) / localStorage hobunjiStatueDebris=off
// restores the old mounds for newly built areas.
(() => {
  'use strict';

  if (window.StatueRuinDebris) return;

  const STORAGE_KEY = 'hobunjiStatueDebris';
  const SOURCE_SHA = '038a5d54c66b0ae2a9ceeb66967b9e5c32b616040f40b503eec59d5331885f40';
  const FRAME_TIMEOUT_MS = 30000;
  const VARIANTS_PER_ZONE = 5;
  const FIT = 1.35; // Debris may spill this far past the blocked footprint (fraction of its size).
  // Outdoor locale ruin controls (V50 reads these from its own inputs).
  const LOCALE_CONTROLS = { rubbleRotate: 100, rubbleSubmerge: 100 };
  // Damage pass, pushed to "super ruined" but kept compact enough for a 1-2 tile footprint.
  const SUPER_RUINED = { axis: 'y', cut: 30, jagged: 40, crumble: 100, detail: 1, upperMode: 'fall', fallAngle: 115, fallOffset: 35, rubble: 24, spread: 45, rubbleSize: 95, rubbleRotate: 100, rubbleSubmerge: 45, groundRubble: true };

  let enabled = (() => { try { return localStorage.getItem(STORAGE_KEY) !== 'off'; } catch (_) { return true; } })();
  let frame = null, apiPromise = null, queue = Promise.resolve();
  let material = null;
  const pools = new Map(); // mapId -> Promise<[{ geometry, sizeX, sizeZ }]>
  const stats = { variants: 0, filled: 0, fallbacks: 0, failures: 0, lastError: null, generationMs: 0 };

  function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function generatorApi() {
    if (apiPromise) return apiPromise;
    apiPromise = (async () => {
      frame = document.createElement('iframe');
      frame.id = 'statueRuinDebrisFrame'; frame.tabIndex = -1; frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:16px;height:16px;opacity:0;pointer-events:none;border:0;z-index:-1';
      frame.src = `tools/debris-ifier/index.html?devRuntime=1&t=${Date.now()}`; // Local repo transport, no preview renderer.
      document.body.appendChild(frame);
      const started = performance.now();
      while (performance.now() - started < FRAME_TIMEOUT_MS) {
        const api = frame.contentWindow?.DebrisifierV50;
        if (api?.sourceSha256 === SOURCE_SHA && api.generateOutdoorLocale && api.takePreviewRoots) return api;
        if (/FAILED/i.test(frame.contentDocument?.getElementById('debug')?.textContent || '')) break;
        await wait(40);
      }
      throw new Error('Debris-ifier V50 did not start: ' + (frame.contentDocument?.getElementById('debug')?.textContent || 'timeout').slice(-200));
    })();
    apiPromise.catch(() => { apiPromise = null; frame?.remove(); frame = null; });
    return apiPromise;
  }

  function setControls(doc, values) {
    for (const [id, value] of Object.entries(values)) {
      const el = doc.getElementById(id);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!value; else el.value = String(value);
    }
  }

  function stoneMaterial() {
    if (material) return material;
    const THREE = window.THREE;
    material = window.ProceduralFurniture?.makePartMaterial?.({ materialTexture: 'carved_smooth.png', materialLighting: 'unlit', materialFillMode: 'never', color: '#7a746b' })
      || new THREE.MeshBasicMaterial({ color: 0x7a746b });
    material.userData = { ...(material.userData || {}), sharedStatueDebrisMaterial: true };
    return material;
  }

  // Merge every mesh under root (world space) into one non-indexed geometry.
  function mergeMeshes(root) {
    const THREE = window.THREE;
    const positions = [], normals = [], uvs = [];
    root.updateMatrixWorld(true);
    root.traverse(object => {
      if (!object.isMesh || !object.geometry?.attributes?.position || object.visible === false) return;
      const g = (object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone());
      g.applyMatrix4(object.matrixWorld);
      if (!g.attributes.normal) g.computeVertexNormals();
      const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        positions.push(p.getX(i), p.getY(i), p.getZ(i));
        normals.push(n.getX(i), n.getY(i), n.getZ(i));
        uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      }
      g.dispose();
    });
    if (!positions.length) return null;
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    return merged;
  }

  // One debris variant: tiny outdoor ruin -> every piece through the damage
  // pass -> one geometry centred on the origin, ground at y = 0.
  async function generateVariant(api, seed) {
    const THREE = window.THREE;
    const win = frame.contentWindow, doc = frame.contentDocument;
    setControls(doc, LOCALE_CONTROLS);
    await api.generateOutdoorLocale({ seed, size: 'tiny', density: 100, sunkenChance: 0 });
    const roots = api.takePreviewRoots({ snapshot: true });
    const pieces = roots.localeRoot.children.filter(child => !/substrate/i.test(child.name || ''));
    const heap = new THREE.Group();
    for (const piece of pieces) {
      const holder = new THREE.Group();
      holder.add(piece);
      setControls(doc, { seed: `${seed}|${piece.name}`, ...SUPER_RUINED });
      win.ingestScene(holder, piece.name || 'piece'); // Runs the damage pass with the controls above.
      const damaged = win.eval('damageRoot'); // The tool's live output group (same three.js realm as the game).
      const geometry = mergeMeshes(damaged);
      if (geometry) heap.add(new THREE.Mesh(geometry));
    }
    roots.localeRoot.traverse(object => object.geometry?.dispose?.());
    const geometry = mergeMeshes(heap);
    heap.traverse(object => object.geometry?.dispose?.());
    if (!geometry) return null;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    geometry.translate(-(box.min.x + box.max.x) / 2, 0, -(box.min.z + box.max.z) / 2);
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const size = geometry.boundingBox.getSize(new THREE.Vector3());
    return { geometry, sizeX: Math.max(0.01, size.x), sizeZ: Math.max(0.01, size.z) };
  }

  function poolFor(mapId) {
    if (pools.has(mapId)) return pools.get(mapId);
    const promise = (queue = queue.then(async () => {
      const started = performance.now();
      const api = await generatorApi();
      const variants = [];
      for (let k = 0; k < VARIANTS_PER_ZONE; k++) {
        try {
          const variant = await generateVariant(api, `${mapId}|statue-debris-${k}`);
          if (variant) { variants.push(variant); stats.variants++; }
        } catch (error) { stats.lastError = String(error?.message || error); }
      }
      stats.generationMs += Math.round(performance.now() - started);
      if (!variants.length) throw new Error(stats.lastError || 'no debris variants generated');
      return variants;
    }));
    queue = promise.catch(() => {});
    pools.set(mapId, promise);
    promise.catch(error => { stats.failures++; stats.lastError = String(error?.message || error); pools.delete(mapId); });
    return promise;
  }

  function hash(...parts) {
    let h = 2166136261;
    for (const ch of parts.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
  }

  // Adjacent statue tiles in one call are one footprint (statues are 1x1 or 1x2).
  function footprintsOf(tiles) {
    const byKey = new Map(tiles.map(tile => [tile.c + ',' + tile.r, tile]));
    const seen = new Set(), out = [];
    for (const tile of tiles) {
      const key = tile.c + ',' + tile.r;
      if (seen.has(key)) continue;
      const group = [], stack = [tile];
      seen.add(key);
      while (stack.length) {
        const t = stack.pop();
        group.push(t);
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = (t.c + dc) + ',' + (t.r + dr), n = byKey.get(k);
          if (n && !seen.has(k)) { seen.add(k); stack.push(n); }
        }
      }
      const cs = group.map(t => t.c), rs = group.map(t => t.r);
      const minC = Math.min(...cs), maxC = Math.max(...cs), minR = Math.min(...rs), maxR = Math.max(...rs);
      out.push({ tiles: group, c: minC, r: minR, w: maxC - minC + 1, h: maxR - minR + 1,
        x: group.reduce((s, t) => s + t.x, 0) / group.length, z: group.reduce((s, t) => s + t.z, 0) / group.length,
        y: Math.max(...group.map(t => t.y)) });
    }
    return out;
  }

  // Placement of one variant on one footprint: quarter-turn (long axis along
  // the footprint), uniform scale so it spills at most FIT past the footprint.
  function placement(variant, footprint, seedKey) {
    const turn = hash(seedKey, 'turn') % 4;
    const swap = turn % 2 === 1;
    const sx = swap ? variant.sizeZ : variant.sizeX, sz = swap ? variant.sizeX : variant.sizeZ;
    const scale = Math.min(1, (footprint.w * FIT) / sx, (footprint.h * FIT) / sz);
    return { rotationY: turn * Math.PI / 2, scale };
  }

  // tiles: [{ c, r, x, z, y }] statue tiles of one chunk; group: the chunk's scene group.
  // groundLift(x, z): ground displacement at a world point; fallback(group, tile): non-debris filler.
  function fill({ group, mapId, tiles, groundLift = null, fallback = null }) {
    if (!enabled || !tiles?.length || !group) return Promise.resolve(0);
    const footprints = footprintsOf(tiles);
    return poolFor(mapId).then(variants => {
      if (!group.parent) return 0; // Chunk unloaded while generating.
      const THREE = window.THREE;
      for (const footprint of footprints) {
        const seedKey = `${mapId}|${footprint.c},${footprint.r}`;
        const variant = variants[hash(seedKey) % variants.length];
        const { rotationY, scale } = placement(variant, footprint, seedKey);
        const mesh = new THREE.Mesh(variant.geometry, stoneMaterial());
        mesh.name = `statue_ruin_debris_${footprint.c}_${footprint.r}`;
        mesh.rotation.y = rotationY;
        mesh.scale.setScalar(scale);
        mesh.position.set(footprint.x, footprint.y + (groundLift ? groundLift(footprint.x, footprint.z) : 0), footprint.z);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.layers.disable(globalThis.HobunjiRenderLayers?.SHELL_OUTLINE ?? 1);
        Object.assign(mesh.userData, { statueRuinDebris: true, noOutline: true, terrainJigsawIgnore: true, footprint: { c: footprint.c, r: footprint.r, w: footprint.w, h: footprint.h } });
        group.add(mesh);
        stats.filled++;
      }
      return footprints.length;
    }, error => {
      stats.lastError = String(error?.message || error);
      if (typeof fallback === 'function' && group.parent !== undefined) {
        for (const tile of tiles) { fallback(group, tile); stats.fallbacks++; }
      }
      return 0;
    });
  }

  window.StatueRuinDebris = Object.freeze({
    STORAGE_KEY,
    SUPER_RUINED,
    enabled: () => enabled,
    setEnabled(value) {
      enabled = value !== false;
      try { localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off'); } catch (_) {}
      return enabled;
    },
    fill,
    footprintsOf,
    placement,
    snapshot: () => ({ enabled, pools: [...pools.keys()], ...stats }),
  });
})();

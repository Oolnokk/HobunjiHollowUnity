// Shared wood-surface + cut-end repair for procedural foliage, authored wilderness
// stumps/logs, and generated log-wall prototypes. Tree bark remains owned by
// NaturalSurfaceMaterials when available; this module supplies the same authored
// PNG fallback plus robust cut-face geometry for open wood tubes.
(() => {
  'use strict';

  if (window.WoodCutSurfaces?.installed) return;

  const scriptUrl = document.currentScript?.src || new URL('js/wood-cut-surfaces.js', location.href).href; // Absolute texture base used by game and nested authoring tools.
  const BARK_TEXTURE_URL = new URL('../assets/textures/wavy_surface.png', scriptUrl).href; // Exact authored PNG used by NaturalSurfaceMaterials for in-game tree trunks.
  const CUT_TEXTURE_URL = new URL('../assets/textures/log.png', scriptUrl).href; // Authored wood PNG used for exposed end grain/cut faces.
  const WRAP_FLAG = '__woodCutSurfacesWrapped'; // API wrapper marker preventing duplicate foliage/renderer interception.
  const CAP_MARKER = '__woodCutCapsAdded'; // Mesh marker preventing repeated boundary-cap generation across wrapper layers.
  const TOP_CAP_MARKER = '__woodCutTopCapAdded'; // Stump-only overlay marker ensuring a visible authored cut face even when source geometry already contains a bad cap.
  const textureReady = new WeakMap(); // Texture -> Promise used by GLB export to wait for real PNG pixels instead of serializing a loading placeholder.
  const textureCache = new Map(); // URL/tint texture cache reused by repeated logs/stumps without per-instance GPU uploads.
  const materialCache = new Map(); // Cut-face material cache keyed by tint; bark materials remain NaturalSurfaceMaterials-owned in game.

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function sourceColorHex(material, fallback = '#6d472d') {
    const source = Array.isArray(material) ? material[0] : material; // First source wood material carries the procedural per-tree bark tint.
    if (!source?.color?.isColor) return fallback;
    return `#${source.color.getHexString()}`;
  }

  function cutColorHex(THREE, barkHex) {
    const bark = new THREE.Color(barkHex || '#6d472d'); // Bark hue retained so fresh cuts stay species/color coherent.
    const hsl = { h: 0, s: 0, l: 0 }; // Scratch HSL populated by Three.Color.getHSL().
    bark.getHSL(hsl);
    const cut = new THREE.Color(); // Lighter/desaturated wood interior tint used with the authored log PNG.
    cut.setHSL(hsl.h, clamp(hsl.s * 0.48 + 0.08, 0.16, 0.48), clamp(hsl.l * 1.75 + 0.14, 0.46, 0.72));
    return `#${cut.getHexString()}`;
  }

  function localTintCanvas(image, targetHex) {
    const width = image.naturalWidth || image.width; // Source PNG width used by the local body-tint fallback.
    const height = image.naturalHeight || image.height; // Source PNG height used by the local body-tint fallback.
    const canvas = Object.assign(document.createElement('canvas'), { width, height }); // Tinted texture canvas matching the source PNG dimensions.
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, width, height);
    const raw = String(targetHex || '#808080').replace(/^#/, ''); // Requested wood tint converted to RGB below.
    if (!/^[0-9a-f]{6}$/i.test(raw)) return canvas;
    const tr = parseInt(raw.slice(0, 2), 16); // Target red channel used by luminance-preserving tint.
    const tg = parseInt(raw.slice(2, 4), 16); // Target green channel used by luminance-preserving tint.
    const tb = parseInt(raw.slice(4, 6), 16); // Target blue channel used by luminance-preserving tint.
    const imageData = ctx.getImageData(0, 0, width, height); // Mutable PNG pixels retaining authored light/dark patterning.
    const data = imageData.data; // RGBA byte array recolored in place.
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const luminance = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255; // Authored shade preserved as a multiplier around the requested tint.
      const shade = clamp(luminance / 0.55, 0.72, 1.18); // Same bounded natural-surface fallback range used by tree PNG tinting.
      data[i] = clamp(Math.round(tr * shade), 0, 255);
      data[i + 1] = clamp(Math.round(tg * shade), 0, 255);
      data[i + 2] = clamp(Math.round(tb * shade), 0, 255);
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  function tintCanvas(image, targetHex, cacheKey) {
    const spritePng = window.HobunjiSpritePngSurface; // Canonical character/natural-surface PNG tint path when game dependencies are present.
    const tintSurfaceCanvas = spritePng?.tintSurfaceCanvas || spritePng?.tintBodyCanvas || window.getBodyTintedCanvas; // Same preference order NaturalSurfaceMaterials uses.
    if (typeof tintSurfaceCanvas === 'function') {
      try {
        const canvas = tintSurfaceCanvas(image, cacheKey, { hex: targetHex }, '', 'A'); // Exact body-sprite tint contract used by tree trunks in game.
        if (canvas) return canvas;
      } catch (_) {}
    }
    return localTintCanvas(image, targetHex);
  }

  function configureTexture(THREE, texture, name) {
    texture.name = name; // Debug/export name distinguishing bark and cut atlas inputs.
    if ('colorSpace' in texture && THREE.SRGBColorSpace != null) texture.colorSpace = THREE.SRGBColorSpace;
    else if ('encoding' in texture && THREE.sRGBEncoding != null) texture.encoding = THREE.sRGBEncoding;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  function tintedTexture(THREE, url, tintHex, label) {
    const key = `${url}|${String(tintHex).toLowerCase()}`; // Reusable texture key preventing repeated PNG/tint work for identical wood colors.
    const cached = textureCache.get(key);
    if (cached) return cached;
    const canvas = Object.assign(document.createElement('canvas'), { width: 4, height: 4 }); // Immediate placeholder canvas updated after authored PNG decode.
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = tintHex || '#808080';
    ctx.fillRect(0, 0, 4, 4);
    const texture = configureTexture(THREE, new THREE.CanvasTexture(canvas), label); // Stable texture object retained while its image swaps to the tinted authored PNG.
    const ready = new Promise((resolve) => {
      const image = new Image(); // Authored PNG decoder shared by game and tool pages.
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        texture.image = tintCanvas(image, tintHex, key);
        texture.needsUpdate = true;
        resolve(texture);
      };
      image.onerror = () => resolve(texture); // Flat tinted placeholder remains a safe fallback if the authored PNG cannot load.
      image.src = url;
    });
    textureReady.set(texture, ready);
    textureCache.set(key, texture);
    return texture;
  }

  function naturalizeTreeBark(mesh, THREE = window.THREE) {
    if (!mesh?.isMesh || !THREE) return mesh;
    const barkHex = sourceColorHex(mesh.material); // Procedural source tint captured before NaturalSurfaceMaterials replaces the source material.
    const natural = window.NaturalSurfaceMaterials; // Canonical in-game tree PNG owner; preferred whenever the normal game stack is present.
    if (natural?.naturalizeMesh) {
      natural.naturalizeMesh(mesh, 'trunks');
      mesh.userData = { ...(mesh.userData || {}), woodBarkPng: 'wavy_surface.png', woodBarkSource: 'NaturalSurfaceMaterials' };
      return mesh;
    }
    const map = tintedTexture(THREE, BARK_TEXTURE_URL, barkHex, `tree_bark_${barkHex}`); // Nested tools use the same authored tree PNG even without NaturalSurfaceMaterials bootstrapped.
    const material = new THREE.MeshBasicMaterial({ map, color: 0xffffff, side: mesh.material?.side ?? THREE.FrontSide }); // Tree natural surfaces are intentionally unlit PNG materials.
    material.name = 'Tree Bark PNG';
    material.userData = { naturalSurface: 'trunks', naturalSurfaceUnlit: true, woodBarkPng: 'wavy_surface.png' };
    mesh.material = material;
    mesh.userData = { ...(mesh.userData || {}), naturalSurface: 'trunks', woodBarkPng: 'wavy_surface.png', woodBarkSource: 'WoodCutSurfaces fallback' };
    return mesh;
  }

  function cutMaterial(THREE, barkHex) {
    const cutHex = cutColorHex(THREE, barkHex); // Fresh-cut tint derived from the source bark color.
    const key = cutHex.toLowerCase(); // Shared material key reused by matching cut faces.
    if (materialCache.has(key)) return materialCache.get(key);
    const map = tintedTexture(THREE, CUT_TEXTURE_URL, cutHex, `cut_wood_${cutHex}`); // Authored log PNG used as end-grain/cut wood pattern.
    const material = new THREE.MeshBasicMaterial({ map, color: 0xffffff, side: THREE.DoubleSide }); // Double-sided cut faces prevent any visible hollow/backface-culling seam at open ends.
    material.name = 'Cut Wood PNG';
    material.userData = { woodCutSurface: true, woodCutPng: 'log.png', barkSourceHex: barkHex, cutHex };
    materialCache.set(key, material);
    return material;
  }

  function canonicalVertexData(geometry, epsilon = 1e-5) {
    const position = geometry?.getAttribute?.('position'); // Geometry positions used to weld seam duplicates before boundary-edge detection.
    if (!position) return null;
    const keyFor = (i) => `${Math.round(position.getX(i) / epsilon)},${Math.round(position.getY(i) / epsilon)},${Math.round(position.getZ(i) / epsilon)}`; // Quantized coordinate key treating duplicated UV/seam vertices as one topological vertex.
    const points = new Map(); // Canonical position key -> representative Vector3.
    const keys = new Array(position.count); // Original vertex index -> canonical welded key.
    const THREE = window.THREE || geometry?.__THREE; // Game-global Three namespace; callers pass geometry created by the same runtime.
    for (let i = 0; i < position.count; i++) {
      const key = keyFor(i);
      keys[i] = key;
      if (!points.has(key)) points.set(key, THREE ? new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i)) : { x: position.getX(i), y: position.getY(i), z: position.getZ(i) });
    }
    return { position, points, keys };
  }

  function boundaryLoops(THREE, geometry, epsilon = 1e-5) {
    const position = geometry?.getAttribute?.('position'); // Position buffer required for quantized boundary detection.
    if (!position) return [];
    const keys = new Array(position.count); // Vertex index -> canonical coordinate key welding duplicated seam vertices.
    const points = new Map(); // Canonical key -> representative local-space point.
    for (let i = 0; i < position.count; i++) {
      const key = `${Math.round(position.getX(i) / epsilon)},${Math.round(position.getY(i) / epsilon)},${Math.round(position.getZ(i) / epsilon)}`;
      keys[i] = key;
      if (!points.has(key)) points.set(key, new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i)));
    }
    const edgeCounts = new Map(); // Undirected canonical edge -> triangle-use count; count=1 is an open boundary edge.
    const edgeEnds = new Map(); // Undirected edge -> canonical endpoint pair used to build boundary adjacency.
    const index = geometry.index?.array || null; // Indexed triangles when present; non-indexed geometry falls back to sequential triples.
    const triangleCount = index ? Math.floor(index.length / 3) : Math.floor(position.count / 3); // Number of source triangles scanned for open edges.
    const vertexAt = (triangle, corner) => index ? index[triangle * 3 + corner] : triangle * 3 + corner; // Source vertex index accessor shared by indexed/non-indexed geometry.
    for (let triangle = 0; triangle < triangleCount; triangle++) {
      const tri = [vertexAt(triangle, 0), vertexAt(triangle, 1), vertexAt(triangle, 2)];
      for (const [aIndex, bIndex] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]]) {
        const a = keys[aIndex], b = keys[bIndex];
        if (!a || !b || a === b) continue;
        const edgeKey = a < b ? `${a}|${b}` : `${b}|${a}`;
        edgeCounts.set(edgeKey, (edgeCounts.get(edgeKey) || 0) + 1);
        if (!edgeEnds.has(edgeKey)) edgeEnds.set(edgeKey, [a, b]);
      }
    }
    const adjacency = new Map(); // Boundary vertex -> neighboring boundary vertices.
    const boundaryEdges = []; // Clean one-triangle edges walked into closed cap loops below.
    for (const [edgeKey, count] of edgeCounts) {
      if (count !== 1) continue;
      const ends = edgeEnds.get(edgeKey);
      if (!ends) continue;
      boundaryEdges.push(ends);
      for (const [a, b] of [ends, [ends[1], ends[0]]]) {
        if (!adjacency.has(a)) adjacency.set(a, []);
        adjacency.get(a).push(b);
      }
    }
    const visited = new Set(); // Undirected boundary edges already consumed by a loop walk.
    const loops = []; // Closed boundary point arrays ready for fan triangulation.
    const edgeKeyFor = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
    for (const [startA, startB] of boundaryEdges) {
      const firstEdge = edgeKeyFor(startA, startB);
      if (visited.has(firstEdge)) continue;
      const keysInLoop = [startA];
      let previous = startA; // Previous canonical vertex used to avoid immediately walking back along the same boundary edge.
      let current = startB; // Current boundary vertex advanced until it closes back to startA.
      visited.add(firstEdge);
      for (let guard = 0; guard < boundaryEdges.length + 4; guard++) {
        keysInLoop.push(current);
        if (current === startA) break;
        const neighbors = adjacency.get(current) || [];
        const next = neighbors.find(candidate => candidate !== previous && !visited.has(edgeKeyFor(current, candidate)))
          || neighbors.find(candidate => candidate === startA && candidate !== previous);
        if (!next) break;
        visited.add(edgeKeyFor(current, next));
        previous = current;
        current = next;
      }
      if (keysInLoop.length >= 4 && keysInLoop[keysInLoop.length - 1] === startA) {
        keysInLoop.pop();
        const loop = keysInLoop.map(key => points.get(key)).filter(Boolean);
        if (loop.length >= 3) loops.push(loop);
      }
    }
    return loops;
  }

  function capGeometryFromLoops(THREE, sourceGeometry, loops) {
    if (!loops?.length) return null;
    sourceGeometry.computeBoundingBox();
    const sourceCenter = sourceGeometry.boundingBox.getCenter(new THREE.Vector3()); // Interior reference used to orient each cut face outward.
    const positions = []; // Cap triangle-fan positions; each loop owns duplicated flat-face vertices.
    const uvs = []; // Planar 0..1 UVs for the cut-wood PNG on each cap.
    const indices = []; // Triangle fans for every repaired open boundary loop.
    for (const sourceLoop of loops) {
      let loop = sourceLoop.map(point => point.clone());
      const center = loop.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / loop.length); // Local cap center used by fan triangles and outward test.
      let normal = new THREE.Vector3(); // Newell-style polygon normal robust to slightly non-planar wonky tube end rings.
      for (let i = 0; i < loop.length; i++) {
        const current = loop[i], next = loop[(i + 1) % loop.length];
        normal.x += (current.y - next.y) * (current.z + next.z);
        normal.y += (current.z - next.z) * (current.x + next.x);
        normal.z += (current.x - next.x) * (current.y + next.y);
      }
      if (normal.lengthSq() < 1e-12) continue;
      normal.normalize();
      if (normal.dot(center.clone().sub(sourceCenter)) < 0) {
        loop = loop.reverse();
        normal.negate();
      }
      const tangent = loop[0].clone().sub(center).normalize(); // First radial direction used as planar U axis.
      const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize(); // Planar V axis perpendicular to the cut face normal.
      let radius = 1e-6; // UV normalization radius expanded to the farthest boundary vertex.
      for (const point of loop) radius = Math.max(radius, point.distanceTo(center));
      const base = positions.length / 3; // First perimeter vertex index for this cap.
      for (const point of loop) {
        positions.push(point.x, point.y, point.z);
        const offset = point.clone().sub(center);
        uvs.push(0.5 + offset.dot(tangent) / (radius * 2), 0.5 + offset.dot(bitangent) / (radius * 2));
      }
      const centerIndex = positions.length / 3; // Fan center vertex index following this cap's perimeter vertices.
      positions.push(center.x, center.y, center.z);
      uvs.push(0.5, 0.5);
      for (let i = 0; i < loop.length; i++) indices.push(centerIndex, base + i, base + (i + 1) % loop.length);
    }
    if (!indices.length) return null;
    const geometry = new THREE.BufferGeometry(); // Standalone cut-face mesh geometry kept separate from bark so NaturalSurfaceMaterials cannot overwrite its material.
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData = { ...(geometry.userData || {}), woodCutCaps: true, capLoopCount: loops.length };
    return geometry;
  }

  function addOpenBoundaryCaps(mesh, THREE = window.THREE) {
    if (!mesh?.isMesh || !THREE || mesh.userData?.[CAP_MARKER]) return 0;
    const barkHex = sourceColorHex(mesh.material); // Source tint captured before a later bark-naturalization pass can turn the material white.
    const loops = boundaryLoops(THREE, mesh.geometry); // All true open tube boundaries, including both ends of fallen logs and exposed root/branch tips.
    const capGeometry = capGeometryFromLoops(THREE, mesh.geometry, loops);
    if (!capGeometry) {
      mesh.userData = { ...(mesh.userData || {}), [CAP_MARKER]: true, woodCutCapCount: 0 };
      return 0;
    }
    const cap = new THREE.Mesh(capGeometry, cutMaterial(THREE, barkHex)); // Separate double-sided PNG cut-face mesh avoids material-group loss in existing render/import paths.
    cap.name = `${mesh.name || 'wood'}_cut_caps`;
    cap.castShadow = mesh.castShadow;
    cap.receiveShadow = mesh.receiveShadow;
    cap.userData = { ...(cap.userData || {}), woodCutSurface: true, sourceMesh: mesh.name || '' };
    mesh.add(cap);
    mesh.userData = { ...(mesh.userData || {}), [CAP_MARKER]: true, woodCutCapCount: loops.length, woodCutPng: 'log.png' };
    return loops.length;
  }

  function topHullPoints(THREE, geometry) {
    const position = geometry?.getAttribute?.('position'); // Stump source positions used to derive a visible top cut-face overlay.
    if (!position) return [];
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const height = Math.max(1e-5, box.max.y - box.min.y); // Stump height used to choose only vertices near the authored top cut plane.
    const threshold = box.max.y - Math.max(0.025, height * 0.08); // Small top band excluding roots and side-wall vertices below the cut.
    const points = [];
    for (let i = 0; i < position.count; i++) {
      if (position.getY(i) < threshold) continue;
      points.push(new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i)));
    }
    if (points.length < 3) return [];
    const unique = new Map(); // XZ-welded top points used by the 2D convex hull.
    for (const point of points) unique.set(`${Math.round(point.x * 10000)},${Math.round(point.z * 10000)}`, point);
    const sorted = [...unique.values()].sort((a, b) => a.x === b.x ? a.z - b.z : a.x - b.x);
    if (sorted.length < 3) return [];
    const cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x); // 2D XZ hull orientation.
    const lower = [];
    for (const point of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
      lower.push(point);
    }
    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
      const point = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
      upper.push(point);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  function addStumpTopCap(mesh, THREE = window.THREE) {
    if (!mesh?.isMesh || !THREE || mesh.userData?.[TOP_CAP_MARKER]) return false;
    const hull = topHullPoints(THREE, mesh.geometry); // Convex top perimeter remains valid even when the source V27/current stump already contains an invisible/badly-wound cap.
    if (hull.length < 3) return false;
    const barkHex = sourceColorHex(mesh.material); // Stump bark tint used to derive the fresh-cut end-grain tint.
    const center = hull.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / hull.length); // Cut-face center averaging the wonky top perimeter.
    const yLift = Math.max(0.0005, (mesh.geometry.boundingBox.max.y - mesh.geometry.boundingBox.min.y) * 0.001); // Tiny lift prevents z-fighting with any legacy cap already merged into the source stump.
    const positions = [];
    const uvs = [];
    let radius = 1e-6;
    for (const point of hull) radius = Math.max(radius, Math.hypot(point.x - center.x, point.z - center.z));
    for (const point of hull) {
      positions.push(point.x, point.y + yLift, point.z);
      uvs.push(0.5 + (point.x - center.x) / (radius * 2), 0.5 + (point.z - center.z) / (radius * 2));
    }
    const centerIndex = positions.length / 3; // Upward-facing fan center placed just above the legacy stump top.
    positions.push(center.x, center.y + yLift, center.z);
    uvs.push(0.5, 0.5);
    const indices = [];
    for (let i = 0; i < hull.length; i++) indices.push(centerIndex, i, (i + 1) % hull.length);
    const geometry = new THREE.BufferGeometry(); // Dedicated top cut overlay so bark UV/material processing cannot hide the stump face.
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const cap = new THREE.Mesh(geometry, cutMaterial(THREE, barkHex)); // Double-sided authored cut-wood PNG guarantees visibility from either winding direction.
    cap.name = `${mesh.name || 'stump'}_top_cut`;
    cap.castShadow = mesh.castShadow;
    cap.receiveShadow = mesh.receiveShadow;
    cap.userData = { woodCutSurface: true, stumpTopCut: true };
    mesh.add(cap);
    mesh.userData = { ...(mesh.userData || {}), [TOP_CAP_MARKER]: true, woodCutTopPng: 'log.png' };
    return true;
  }

  function largestWoodMesh(root) {
    let best = null; // Largest visible non-proxy mesh is the authored V27 trunk/log body for benchlog/chairstump records.
    let bestCount = -1;
    root?.traverse?.((child) => {
      if (!child?.isMesh || child.visible === false || child.userData?.runtimeCollisionProxy) return;
      const count = child.geometry?.getAttribute?.('position')?.count || 0;
      if (count > bestCount) { best = child; bestCount = count; }
    });
    return best;
  }

  function repairStumpGroup(group, THREE = window.THREE) {
    const mesh = largestWoodMesh(group); // Primary procedural stump wood mesh repaired without touching leaves/proxies.
    if (!mesh) return group;
    const barkHex = sourceColorHex(mesh.material); // Preserve procedural stump tint before naturalization.
    addOpenBoundaryCaps(mesh, THREE); // Close any root/trunk boundary loops still open in the generated mesh.
    addStumpTopCap(mesh, THREE); // Always overlay a visible cut top because legacy stump caps can exist but face/cull incorrectly.
    naturalizeTreeBark(mesh, THREE); // Exact in-game tree `wavy_surface.png` treatment applied to stump bark.
    mesh.userData = { ...(mesh.userData || {}), woodRepair: 'stump', sourceBarkHex: barkHex, latestChange: 'Tree PNG bark + visible cut-wood caps.' };
    return group;
  }

  function repairFurnitureInstance(instance, record, data, THREE = window.THREE) {
    const key = String(record?.furnitureKey || data?.key || ''); // Authored furniture key distinguishes horizontal logs from stump seats.
    if (key !== 'benchlog' && key !== 'chairstump') return instance;
    const foliage = instance?.children?.find?.(child => child?.name?.endsWith('_foliage')) || instance; // V27 source subtree excludes invisible furniture collision proxies when possible.
    const mesh = largestWoodMesh(foliage);
    if (!mesh) return instance;
    addOpenBoundaryCaps(mesh, THREE); // Fallen logs receive both end caps; stump/root openings are closed as well.
    if (key === 'chairstump') addStumpTopCap(mesh, THREE); // Stump top gets an explicit cut-face overlay even if V27 emitted a defective legacy cap.
    naturalizeTreeBark(mesh, THREE); // Wilderness authored logs/stumps now use the exact tree trunk PNG surface path too.
    instance.userData = { ...(instance.userData || {}), woodCutRepair: true, barkPng: 'wavy_surface.png', cutPng: 'log.png', latestChange: 'Authored foliage wood now has tree PNG bark and closed cut ends.' };
    return instance;
  }

  function wrapFoliageGenerator(api) {
    if (!api || api[WRAP_FLAG]) return api;
    const originalStump = api.buildStumpMesh; // Current procedural stump builder intercepted so dev/wilderness direct stumps get the same cap/material repair.
    if (typeof originalStump === 'function') {
      api.buildStumpMesh = function (...args) {
        return repairStumpGroup(originalStump.apply(this, args), window.THREE);
      };
    }
    Object.defineProperty(api, WRAP_FLAG, { value: true, configurable: true });
    return api;
  }

  function wrapFurnitureRenderer(api) {
    if (!api || api[WRAP_FLAG]) return api;
    const originalBuildInstance = api.buildInstance; // V27-authored wilderness stump/log renderer intercepted after it returns its exact cloned source.
    if (typeof originalBuildInstance === 'function') {
      api.buildInstance = async function (...args) {
        const result = await originalBuildInstance.apply(this, args);
        repairFurnitureInstance(result?.instance, args[0], result?.data, window.THREE);
        return result;
      };
    }
    Object.defineProperty(api, WRAP_FLAG, { value: true, configurable: true });
    return api;
  }

  function installGlobal(name, wrapper) {
    let current = window[name]; // Existing API wrapped immediately or captured by setter when its script loads later.
    if (current) {
      window[name] = wrapper(current);
      return;
    }
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get() { return current; },
        set(value) { current = wrapper(value); },
      });
    } catch (_) {}
  }

  function makeLogAtlasMaterial(THREE, barkHex) {
    const cutHex = cutColorHex(THREE, barkHex); // End-grain tint paired with bark in one material so GLTF/WallBuilder never drops a second primitive.
    const canvas = Object.assign(document.createElement('canvas'), { width: 512, height: 256 }); // Single-material atlas: left half tree bark PNG, right half cut-wood PNG.
    const context = canvas.getContext('2d');
    context.fillStyle = barkHex || '#6d472d';
    context.fillRect(0, 0, 256, 256);
    context.fillStyle = cutHex;
    context.fillRect(256, 0, 256, 256);
    const texture = configureTexture(THREE, new THREE.CanvasTexture(canvas), 'log_wall_bark_cut_atlas'); // One texture/material guarantees a one-primitive GLB import path.
    const material = new THREE.MeshBasicMaterial({ map: texture, color: 0xffffff, side: THREE.DoubleSide }); // Unlit matches tree natural surfaces; DoubleSide prevents cap backface holes.
    material.name = 'Tree Bark + Cut Wood PNG Atlas';
    material.userData = { logWallAtlas: true, barkPng: 'wavy_surface.png', cutPng: 'log.png' };
    const ready = Promise.all([
      new Promise(resolve => {
        const image = new Image(); // Tree bark PNG loaded into atlas left half.
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(tintCanvas(image, barkHex, `log-atlas-bark|${barkHex}`));
        image.onerror = () => resolve(null);
        image.src = BARK_TEXTURE_URL;
      }),
      new Promise(resolve => {
        const image = new Image(); // Cut-wood PNG loaded into atlas right half.
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(tintCanvas(image, cutHex, `log-atlas-cut|${cutHex}`));
        image.onerror = () => resolve(null);
        image.src = CUT_TEXTURE_URL;
      }),
    ]).then(([barkCanvas, cutCanvas]) => {
      if (barkCanvas) context.drawImage(barkCanvas, 0, 0, 256, 256);
      if (cutCanvas) context.drawImage(cutCanvas, 256, 0, 256, 256);
      texture.needsUpdate = true;
      return texture;
    });
    textureReady.set(texture, ready);
    return material;
  }

  function remapLogAtlasUv(geometry, meta) {
    const uv = geometry?.getAttribute?.('uv'); // Existing deterministic side/disk UVs remapped into bark/cut halves of the single PNG atlas.
    if (!uv) return geometry;
    const sideVertexCount = Math.max(0, meta.ringSegments * meta.radialSegments); // Base tube vertices precede duplicated cap perimeter/center vertices in LogWallExtension geometry.
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      uv.setX(i, i < sideVertexCount ? u * 0.5 : 0.5 + u * 0.5);
    }
    uv.needsUpdate = true;
    geometry.clearGroups(); // One material/primitive intentionally avoids WallBuilder's historical first-mesh GLB truncation.
    geometry.addGroup(0, geometry.index?.count || 0, 0);
    geometry.userData = { ...(geometry.userData || {}), logWallAtlasUv: true, barkAtlasRange: [0, 0.5], cutAtlasRange: [0.5, 1] };
    return geometry;
  }

  async function waitForObjectTextures(object, timeoutMs = 12000) {
    const waits = [];
    object?.traverse?.((child) => {
      if (!child?.isMesh) return;
      for (const material of (Array.isArray(child.material) ? child.material : [child.material]).filter(Boolean)) {
        const texture = material.map;
        const ready = texture && textureReady.get(texture);
        if (ready) waits.push(ready);
      }
    });
    if (!waits.length) return;
    await Promise.race([
      Promise.all(waits),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for authored wood PNG textures.')), timeoutMs)),
    ]);
  }

  function installPublishedApis() {
    if (window.FoliageGenerator) wrapFoliageGenerator(window.FoliageGenerator);
    if (window.FoliageFurnitureRenderer) wrapFurnitureRenderer(window.FoliageFurnitureRenderer);
    return !!(window.FoliageGenerator && window.FoliageFurnitureRenderer);
  }

  // NaturalSurfaceMaterials owns its own late-publication setter for FoliageGenerator.
  // Poll the published APIs instead of competing for that global property; whichever
  // loads last simply wraps the same functions in place, preserving both behaviors.
  installPublishedApis();
  const installPoll = setInterval(() => {
    if (installPublishedApis()) clearInterval(installPoll);
  }, 100);
  setTimeout(() => clearInterval(installPoll), 15000);

  window.WoodCutSurfaces = {
    installed: true,
    BARK_TEXTURE_URL,
    CUT_TEXTURE_URL,
    naturalizeTreeBark,
    cutMaterial,
    addOpenBoundaryCaps,
    addStumpTopCap,
    repairStumpGroup,
    repairFurnitureInstance,
    makeLogAtlasMaterial,
    remapLogAtlasUv,
    waitForObjectTextures,
    latestChange: 'Tree/stump/log wood uses wavy_surface.png bark; open ends receive visible log.png cut faces.',
  };
})();

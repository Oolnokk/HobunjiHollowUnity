(() => {
  'use strict';

  const THREE = window.THREE;
  const TerrainPreview = window.TerrainPreview;
  const GAME_FOG_COLOR = 0x33404a; // Mirrors the map-editor/live-zone fog used by the game terrain preview.
  const TERRAIN_DEFAULT_COLORS = {
    grass: 0x2f711e,
    weeds: 0x247c3c, tilled: 0x8a5b34, trench: 0x3a2510, raised: 0xc39a55,
    paddy: 0x6aa263, rock: 0x79807c, shrub: 0x356e36, path: 0xb8956a,
    river: 0x3a4a3f, stream: 0x6b5a3a, waterfall: 0x3a4a3f, cliff: 0x6a6460,
  };

  let canvas3d = null; // Assigned by init(); owns the WebGL renderer output.
  let canvas2d = null; // Assigned by init(); owns the fast map-layout preview.
  let stage = null; // Assigned by init(); used for responsive renderer sizing.
  let debugLog = () => {}; // Assigned by init(); routes diagnostics into the tool's mobile-visible debug panel.
  let scene = null; // Three.js scene for the active generated wilderness preview.
  let camera = null; // Orbit camera shared by every generated preview.
  let renderer = null; // WebGL renderer; created once and reused across generations.
  let controls = null; // OrbitControls or the built-in fallback controller returned by createControls().
  let worldGroup = null; // Parent group for base terrain and the optional winter shell.
  let currentTerrainRoot = null; // Current generated terrain mesh group.
  let currentWinterRoot = null; // Current visual-only snow/slush mesh group.
  let currentWorkspace = null; // Last workspace rendered; used by 2D entry markers.
  let currentMerged = null; // TerrainPreview merged grid for stats/2D rendering.
  let terrainMaterialConfig = { byMap: {} }; // Loaded from the same config used by the game/map editor.
  let terrainMaterials = new Map(); // Material cache owned by the active preview.
  let currentWinterSettings = null; // Last snow/slush settings applied to the current terrain.
  let resizeObserver = null; // Kept so repeated init() calls never stack observers.

  function createFallbackControls(cam, domElement) {
    const target = new THREE.Vector3(); // Public target mirrors OrbitControls so fit() can use either implementation.
    let yaw = 0.7; // Horizontal orbit angle around target.
    let pitch = 0.72; // Vertical orbit angle, clamped away from poles.
    let distance = 80; // Camera-target distance changed by wheel zoom.
    let dragging = false; // Pointer drag state for mouse and one-finger touch.
    let lastX = 0; // Previous pointer X used to derive orbit delta.
    let lastY = 0; // Previous pointer Y used to derive orbit delta.

    function syncFromCamera() {
      const offset = cam.position.clone().sub(target); // Current camera offset converted back into spherical fallback-control state.
      distance = Math.max(0.25, offset.length());
      pitch = Math.acos(Math.max(-0.9999, Math.min(0.9999, offset.y / distance)));
      yaw = Math.atan2(offset.x, offset.z);
    }

    function update() {
      const sinPitch = Math.sin(pitch); // Reused by X/Z spherical components below.
      cam.position.set(
        target.x + distance * sinPitch * Math.sin(yaw),
        target.y + distance * Math.cos(pitch),
        target.z + distance * sinPitch * Math.cos(yaw),
      );
      cam.lookAt(target);
    }

    domElement.style.touchAction = 'none';
    domElement.addEventListener('pointerdown', event => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      domElement.setPointerCapture?.(event.pointerId);
    });
    domElement.addEventListener('pointermove', event => {
      if (!dragging) return;
      const dx = event.clientX - lastX; // Horizontal drag rotates around world Y.
      const dy = event.clientY - lastY; // Vertical drag changes pitch.
      lastX = event.clientX;
      lastY = event.clientY;
      yaw -= dx * 0.008;
      pitch = Math.max(0.08, Math.min(Math.PI - 0.08, pitch + dy * 0.008));
      update();
    });
    const endDrag = event => {
      dragging = false;
      domElement.releasePointerCapture?.(event.pointerId);
    };
    domElement.addEventListener('pointerup', endDrag);
    domElement.addEventListener('pointercancel', endDrag);
    domElement.addEventListener('wheel', event => {
      event.preventDefault();
      distance = Math.max(0.5, distance * Math.exp(event.deltaY * 0.0015));
      update();
    }, { passive: false });

    syncFromCamera();
    update();
    return { target, update, syncFromCamera, enableDamping: false, fallback: true };
  }

  function createControls(cam, domElement) {
    if (typeof THREE.OrbitControls === 'function') {
      const orbit = new THREE.OrbitControls(cam, domElement); // Preferred path when the optional helper happened to load successfully.
      orbit.enableDamping = true;
      orbit.dampingFactor = 0.08;
      debugLog('3D controls: THREE.OrbitControls available.');
      return orbit;
    }
    debugLog('3D controls: OrbitControls unavailable; using built-in pointer/wheel fallback.');
    return createFallbackControls(cam, domElement);
  }

  function clearGroup(group) {
    if (!group) return;
    const disposedGeometry = new Set(); // Prevents shared overlay geometries from being disposed twice.
    const disposedMaterial = new Set(); // Prevents shared terrain materials from being disposed twice.
    group.traverse(node => {
      if (!node.isMesh) return;
      if (node.geometry && !disposedGeometry.has(node.geometry)) {
        node.geometry.dispose?.();
        disposedGeometry.add(node.geometry);
      }
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const mat of mats) {
        if (!mat || disposedMaterial.has(mat)) continue;
        mat.map?.dispose?.();
        mat.dispose?.();
        disposedMaterial.add(mat);
      }
    });
    while (group.children.length) group.remove(group.children[0]);
  }

  function clearPreview() {
    if (currentWinterRoot) {
      worldGroup.remove(currentWinterRoot);
      clearGroup(currentWinterRoot);
      currentWinterRoot = null;
    }
    if (currentTerrainRoot) {
      worldGroup.remove(currentTerrainRoot);
      clearGroup(currentTerrainRoot);
      currentTerrainRoot = null;
    }
    terrainMaterials.clear();
    currentMerged = null;
  }

  async function loadMaterialConfig() {
    try {
      const response = await fetch('../../config/maps/terrain-materials.json', { cache: 'no-cache' }); // Same repo-relative config path used by other dev tools.
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      terrainMaterialConfig = await response.json();
      debugLog('3D terrain materials: loaded terrain-materials.json.');
    } catch (error) {
      terrainMaterialConfig = { byMap: {} };
      debugLog(`3D terrain materials: fallback colors only (${error.message}).`);
    }
  }

  function mapMaterialOverride(mapId, key) {
    return terrainMaterialConfig.byMap?.[mapId]?.[key] || terrainMaterialConfig.byMap?.['*']?.[key] || null;
  }

  function resolveTerrainMaterial(mapId, key) {
    const cacheKey = `${mapId}|${key}`; // Per-map cache preserves map-specific stretch/fill overrides.
    const existing = terrainMaterials.get(cacheKey);
    if (existing) return existing;
    const color = TERRAIN_DEFAULT_COLORS[key] ?? 0x888888; // Game/map-editor fallback when no texture override exists.
    const material = key === 'cliff'
      ? new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
      : new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
    material.name = `wilderness_lab_${key}`;
    material.userData = { ...material.userData, terrainKey: key, __labBaseTerrain: true };
    terrainMaterials.set(cacheKey, material);

    const override = mapMaterialOverride(mapId, key); // Texture/fill settings mirror terrain-materials.json.
    if (override?.texture) {
      new THREE.TextureLoader().load(`../../assets/textures/${override.texture}`, loaded => {
        try {
          let finalTexture = loaded; // Replaced by a shade-filled CanvasTexture when the repo tint helper is available.
          const rgb = override.fillColor && window.parseHexColor?.(override.fillColor);
          if (rgb && typeof window.getShadeFillCanvas === 'function') {
            const tinted = window.getShadeFillCanvas(loaded.image, `${override.texture}|${override.fillColor}`, {
              mode: 'shadeFill', rgb: [rgb.r, rgb.g, rgb.b], options: window.getPortraitTintingConfig?.(),
            });
            finalTexture = new THREE.CanvasTexture(tinted);
            loaded.dispose?.();
          }
          finalTexture.wrapS = finalTexture.wrapT = THREE.RepeatWrapping;
          if (Array.isArray(override.stretch) && override.stretch.length === 2) {
            finalTexture.repeat.set(1 / Math.max(0.05, override.stretch[0]), 1 / Math.max(0.05, override.stretch[1]));
          } else {
            const tileSize = Math.max(0.05, override.tileSize || 1); // Shared map material tiling unit.
            finalTexture.repeat.set(1 / tileSize, 1 / tileSize);
          }
          finalTexture.needsUpdate = true;
          material.map = finalTexture;
          material.color.set(0xffffff);
          material.needsUpdate = true;
        } catch (error) {
          debugLog(`3D texture treatment failed for ${key}: ${error.message}`);
        }
      }, undefined, error => debugLog(`3D texture load failed for ${key}: ${error?.message || error}`));
    }
    return material;
  }

  function geometryFromArrays(pos, idx) {
    const geometry = new THREE.BufferGeometry(); // Shared array-to-Three conversion used by every TerrainPreview geometry builder.
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    const uv = new Float32Array((pos.length / 3) * 2); // World-space X/Z UV convention matches the game and map editor.
    for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) {
      uv[j] = pos[i];
      uv[j + 1] = pos[i + 2];
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(idx);
    geometry.computeVertexNormals();
    return geometry;
  }

  function addTerrainMesh(group, pos, idx, material, name) {
    if (!pos?.length || !idx?.length) return null;
    const mesh = new THREE.Mesh(geometryFromArrays(pos, idx), material); // One merged mesh per terrain bucket keeps draw calls bounded.
    mesh.name = name;
    mesh.userData.terrainKey = material.userData?.terrainKey || null;
    group.add(mesh);
    return mesh;
  }

  function buildTerrainRoot(workspace, rootId) {
    const merged = TerrainPreview.buildMergedZoneGrid(workspace, rootId); // Exact shared merge/plateau math used by the Map Editor 3D preview.
    if (!merged.rootMap) throw new Error(`Generated root map not found: ${rootId}`);
    currentMerged = merged;
    const zGrid = TerrainPreview.buildZGrid(merged.cols, merged.rows, merged.tiles); // Dense grid consumed by ramp/carved/rock geometry builders.
    TerrainPreview.applyRampCurtainFlags(zGrid, merged.cols, merged.rows);
    const group = new THREE.Group();
    group.name = `generated_${rootId}`;
    const mapId = merged.rootMap.id || rootId; // Used to resolve map-specific materials.
    const carved = new Set(['river', 'stream', 'waterfall', 'trench', 'raised']); // Tile types with their own non-flat geometry.
    const buckets = new Map(); // Ordinary floor quads are merged by resolved terrain type.

    for (let r = 0; r < merged.rows; r++) {
      for (let c = 0; c < merged.cols; c++) {
        const z = zGrid[r]?.[c];
        if (!z || z.skipFloor) continue;
        const tile = merged.tiles.get(`${c},${r}`);
        if (!tile || tile.type === 'ramp' || carved.has(tile.type)) continue;
        const y = TerrainPreview.NORMAL_TOP + (z.elevTier || 0) * TerrainPreview.PLATEAU_UNIT; // Discrete tier base before subtle visual-height displacement.
        let bucket = buckets.get(tile.type);
        if (!bucket) {
          bucket = { pos: [], idx: [] };
          buckets.set(tile.type, bucket);
        }
        const base = bucket.pos.length / 3; // Vertex base for this tile's two triangles.
        bucket.pos.push(c, y, r, c + 1, y, r, c + 1, y, r + 1, c, y, r + 1);
        bucket.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    for (const [type, bucket] of buckets) {
      TerrainPreview.displaceGeometryPositions(bucket.pos, merged.visualHeights, merged.cols, merged.rows);
      addTerrainMesh(group, bucket.pos, bucket.idx, resolveTerrainMaterial(mapId, type), `floor_${type}`);
    }

    for (const type of carved) {
      const pos = []; // Shared carved position array for this terrain type.
      const dirtIdx = []; // Bed/center faces use the tile type's material.
      const grassIdx = []; // Rim faces use grass, matching the game/map-editor split.
      for (let r = 0; r < merged.rows; r++) {
        for (let c = 0; c < merged.cols; c++) {
          if (zGrid[r]?.[c]?.type !== type) continue;
          let geo;
          try { geo = TerrainPreview.buildTerrainTileGeo(c, r, type, zGrid); } catch (_) { continue; }
          const base = pos.length / 3; // Index offset into the combined carved mesh arrays.
          const tierY = (zGrid[r][c].elevTier || 0) * TerrainPreview.PLATEAU_UNIT; // Carved tile geometry is authored relative to its tier.
          const tilePos = geo.pos.slice();
          if (tierY) for (let k = 1; k < tilePos.length; k += 3) tilePos[k] += tierY;
          pos.push(...tilePos);
          for (const value of geo.dirtIdx) dirtIdx.push(value + base);
          for (const value of geo.grassIdx) grassIdx.push(value + base);
        }
      }
      TerrainPreview.displaceGeometryPositions(pos, merged.visualHeights, merged.cols, merged.rows);
      addTerrainMesh(group, pos, dirtIdx, resolveTerrainMaterial(mapId, type), `carved_${type}_bed`);
      addTerrainMesh(group, pos, grassIdx, resolveTerrainMaterial(mapId, 'grass'), `carved_${type}_rim`);
    }

    for (const mesa of merged.mesas) {
      const elevOffset = (mesa.toTier - mesa.fromTier) * TerrainPreview.PLATEAU_UNIT; // Same absolute tier delta the game uses for plateau mesa geometry.
      if (elevOffset <= 0) continue;
      let geo;
      try { geo = TerrainPreview.buildPlateauMesaGeometry(mesa, elevOffset, mesa.fromTier * TerrainPreview.PLATEAU_UNIT, zGrid); } catch (_) { continue; }
      const pos = geo.pos.slice();
      TerrainPreview.displaceGeometryPositions(pos, merged.visualHeights, merged.cols, merged.rows);
      addTerrainMesh(group, pos, geo.idx.slice(0, geo.grassCount), resolveTerrainMaterial(mapId, 'grass'), `mesa_${mesa.groupId}_grass`);
      addTerrainMesh(group, pos, geo.idx.slice(geo.grassCount), resolveTerrainMaterial(mapId, 'cliff'), `mesa_${mesa.groupId}_cliff`);
    }

    try {
      const ramp = TerrainPreview.buildRampMeshGeometry(zGrid, merged.cols, merged.rows); // Broad hybrid escarpment slopes use this same gameplay ramp surface builder.
      TerrainPreview.displaceGeometryPositions(ramp.pos, merged.visualHeights, merged.cols, merged.rows);
      addTerrainMesh(group, ramp.pos, ramp.idx, resolveTerrainMaterial(mapId, 'path'), 'ramps');
      const curtain = TerrainPreview.buildRampCurtainGeometry(zGrid, merged.cols, merged.rows); // Side taper around ramp fields.
      TerrainPreview.displaceGeometryPositions(curtain.pos, merged.visualHeights, merged.cols, merged.rows);
      addTerrainMesh(group, curtain.pos, curtain.idx, resolveTerrainMaterial(mapId, 'grass'), 'ramp_curtains');
    } catch (error) {
      debugLog(`3D ramp build warning: ${error.message}`);
    }

    try {
      const rock = TerrainPreview.buildRockFormationGeometry(merged, zGrid, merged.cols, merged.rows); // Sheer high edge of the hybrid incline is emitted here as a rock span.
      TerrainPreview.displaceGeometryPositions(rock.pos, merged.visualHeights, merged.cols, merged.rows);
      addTerrainMesh(group, rock.pos, rock.idx, resolveTerrainMaterial(mapId, 'cliff'), 'rock_formations');
    } catch (error) {
      debugLog(`3D rock build warning: ${error.message}`);
    }

    try {
      const waterfall = TerrainPreview.buildWaterfallWallGeometry(zGrid, merged.cols, merged.rows); // Decorative waterfall wall stand-in matches Map Editor preview behavior.
      TerrainPreview.displaceGeometryPositions(waterfall.pos, merged.visualHeights, merged.cols, merged.rows);
      const material = new THREE.MeshBasicMaterial({ color: 0x2f8fc2, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
      material.userData = { terrainKey: 'waterfall' };
      addTerrainMesh(group, waterfall.pos, waterfall.idx, material, 'waterfall_walls');
    } catch (_) {}

    group.userData.merged = merged;
    debugLog(`3D terrain root built: ${group.children.length} merged mesh buckets, ${merged.cols}×${merged.rows}.`);
    return group;
  }

  const winterUniforms = {
    snowHeight: { value: 0.35 }, snowLayers: { value: 5 }, snowLayerBulge: { value: 0.65 },
    snowLayerSharpness: { value: 2.5 }, snowNoiseScale: { value: 1.1 }, snowSlopeStart: { value: 0.20 }, snowSlopeEnd: { value: 0.70 },
  };

  const WINTER_GLSL = `
    uniform float snowHeight; uniform float snowLayers; uniform float snowLayerBulge; uniform float snowLayerSharpness;
    uniform float snowNoiseScale; uniform float snowSlopeStart; uniform float snowSlopeEnd; attribute vec3 aSnowNormalWorld;
    float hhH(float n){return fract(sin(n)*43758.5453123);} float hhH3(vec3 p){return hhH(dot(p,vec3(127.1,311.7,74.7)));}
    float hhN(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.0-2.0*f);float a=hhH3(i),b=hhH3(i+vec3(1,0,0)),c=hhH3(i+vec3(0,1,0)),d=hhH3(i+vec3(1,1,0)),e=hhH3(i+vec3(0,0,1)),g=hhH3(i+vec3(1,0,1)),h=hhH3(i+vec3(0,1,1)),j=hhH3(i+vec3(1,1,1));return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),mix(mix(e,g,f.x),mix(h,j,f.x),f.y),f.z);}
    vec3 hhW2O(vec3 d){vec3 c0=modelMatrix[0].xyz,c1=modelMatrix[1].xyz,c2=modelMatrix[2].xyz;return vec3(dot(c0,d)/max(1e-8,dot(c0,c0)),dot(c1,d)/max(1e-8,dot(c1,c1)),dot(c2,d)/max(1e-8,dot(c2,c2)));}
    vec3 hhWinter(vec3 p,vec3 nw){const vec3 up=vec3(0,1,0);vec3 n=normalize(nw);if(dot(n,up)<0.0)n=-n;float slope=smoothstep(snowSlopeStart,snowSlopeEnd,dot(n,up));vec3 w=(modelMatrix*vec4(p,1)).xyz;float n0=hhN(vec3(w.xz*snowNoiseScale,0)),n1=hhN(vec3((w.xz+vec2(13.7,-9.2))*(snowNoiseScale*.55),0));float H=max(0.0,snowHeight)*slope*(.65+.35*mix(n0,n1,.55));float layers=max(1.0,snowLayers),lh=max(1e-4,snowHeight/layers),t=H/lh,base=floor(t),fr=fract(t),bulge=pow(max(0.0,sin(fr*3.1415926)),max(.5,snowLayerSharpness));float disp=(base+bulge*clamp(snowLayerBulge,0.0,1.0))*lh;disp+=((hhN(vec3(w.xz*(snowNoiseScale*3.2),1.7))-.5)*2.0)*lh*.25*clamp(snowLayerBulge,0.0,1.0);disp=clamp(disp,0.0,snowHeight*1.35);vec3 dir=normalize(mix(n,up,.8));return p+hhW2O(dir)*disp;}`;

  function patchWinterMaterial(material) {
    if (material.userData.__winterPatched) return material;
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, winterUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${WINTER_GLSL}`)
        .replace('#include <begin_vertex>', 'vec3 transformed = hhWinter(position, aSnowNormalWorld);');
    };
    material.customProgramCacheKey = () => 'wilderness-lab-winter-v2';
    material.userData.__winterPatched = true;
    material.needsUpdate = true;
    return material;
  }

  function winterMaterial(preset, opacity) {
    const slush = preset === 'slush'; // Slush is gray and transparent; snow stays opaque and pale.
    const material = new THREE.MeshPhongMaterial({
      color: slush ? 0xa8adb1 : 0xf6f8fb,
      specular: new THREE.Color(slush ? 0xb8c4cf : 0x2a2e33),
      shininess: slush ? 95 : 18,
      side: THREE.DoubleSide,
      transparent: slush || opacity < 0.999,
      opacity,
      depthTest: true,
      depthWrite: !(slush || opacity < 0.999),
    });
    material.userData = { ...material.userData, __winter: true, winterPreset: preset };
    return patchWinterMaterial(material);
  }

  function assignWeldedNormals(root) {
    root.updateMatrixWorld(true);
    const sums = new Map(); // World-position key -> accumulated source normals shared by coincident overlay vertices.
    const records = []; // Per-mesh key arrays populated before the averaged attribute is written back.
    const worldPos = new THREE.Vector3();
    const worldNormal = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3();
    const quant = 100000; // 1e-5 world-unit weld tolerance keeps adjacent tile overlays watertight.
    const keyFor = value => `${Math.round(value.x * quant)},${Math.round(value.y * quant)},${Math.round(value.z * quant)}`;
    root.traverse(mesh => {
      if (!mesh.isMesh || !mesh.geometry) return;
      const pos = mesh.geometry.getAttribute('position');
      if (!pos) return;
      if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
      const nor = mesh.geometry.getAttribute('normal');
      normalMatrix.getNormalMatrix(mesh.matrixWorld);
      const keys = new Array(pos.count); // World weld key for each vertex in this overlay mesh.
      for (let i = 0; i < pos.count; i++) {
        worldPos.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        worldNormal.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
        if (worldNormal.y < 0) worldNormal.multiplyScalar(-1);
        const key = keyFor(worldPos);
        keys[i] = key;
        if (!sums.has(key)) sums.set(key, new THREE.Vector3());
        sums.get(key).add(worldNormal);
      }
      records.push({ mesh, keys });
    });
    for (const record of records) {
      const data = new Float32Array(record.keys.length * 3); // Custom world-normal attribute consumed by the snow/slush deformation shader.
      for (let i = 0; i < record.keys.length; i++) {
        const normal = (sums.get(record.keys[i]) || new THREE.Vector3(0, 1, 0)).clone().normalize();
        data[i * 3] = normal.x; data[i * 3 + 1] = normal.y; data[i * 3 + 2] = normal.z;
      }
      record.mesh.geometry.setAttribute('aSnowNormalWorld', new THREE.BufferAttribute(data, 3));
    }
  }

  function pointKey(value) {
    const quant = 100000; // Same weld tolerance used by assignWeldedNormals().
    return `${Math.round(value.x * quant)},${Math.round(value.y * quant)},${Math.round(value.z * quant)}`;
  }

  function canonicalEdgeKey(a, b) {
    const ka = pointKey(a); // Endpoint key A in world space.
    const kb = pointKey(b); // Endpoint key B in world space.
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  }

  function trueBoundaryEdges(meshes) {
    const edges = new Map(); // Spatial edge key -> count/geometry; count 1 means a true covered-to-uncovered boundary.
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (const mesh of meshes) {
      mesh.updateMatrixWorld(true);
      const pos = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.index ? Array.from(mesh.geometry.index.array) : [...Array(pos.count).keys()]; // Triangle index stream normalized for indexed/non-indexed geometry.
      for (let i = 0; i < index.length; i += 3) {
        const ids = [index[i], index[i + 1], index[i + 2]]; // Triangle vertex ids used to emit three spatial edges.
        for (let edge = 0; edge < 3; edge++) {
          a.fromBufferAttribute(pos, ids[edge]).applyMatrix4(mesh.matrixWorld);
          b.fromBufferAttribute(pos, ids[(edge + 1) % 3]).applyMatrix4(mesh.matrixWorld);
          c.fromBufferAttribute(pos, ids[(edge + 2) % 3]).applyMatrix4(mesh.matrixWorld);
          const key = canonicalEdgeKey(a, b);
          let record = edges.get(key);
          if (!record) {
            const edgeVector = b.clone().sub(a); // First edge direction used to derive an outward strip normal.
            const triangleVector = c.clone().sub(a); // Second triangle vector used for the source face normal.
            const normal = edgeVector.clone().cross(triangleVector).normalize(); // Source face normal for the skirt orientation.
            record = { count: 0, a: a.clone(), b: b.clone(), normal, centroid: a.clone().add(b).add(c).multiplyScalar(1 / 3) };
            edges.set(key, record);
          }
          record.count++;
        }
      }
    }
    return [...edges.values()].filter(record => record.count === 1);
  }

  function buildBoundarySkirt(edges, settings) {
    const segments = 4; // Four cross-strip subdivisions are enough for a visibly rounded bell profile.
    const pos = [];
    const idx = [];
    let baseVertex = 0; // Running vertex offset for each independent boundary strip.
    const edge = new THREE.Vector3();
    const outward = new THREE.Vector3();
    const midpoint = new THREE.Vector3();
    const towardBoundary = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const record of edges) {
      edge.subVectors(record.b, record.a);
      outward.crossVectors(edge, record.normal);
      if (outward.lengthSq() < 1e-10) continue;
      outward.normalize();
      midpoint.copy(record.a).add(record.b).multiplyScalar(0.5);
      towardBoundary.subVectors(midpoint, record.centroid);
      if (outward.dot(towardBoundary) < 0) outward.multiplyScalar(-1);
      const flatLength = Math.hypot(outward.x, outward.z); // Horizontal-only outward direction keeps the skirt from drifting vertically.
      if (flatLength > 1e-6) outward.set(outward.x / flatLength, 0, outward.z / flatLength);
      for (let segment = 0; segment <= segments; segment++) {
        const t = segment / segments; // Zero at field edge, one at outer drooped edge.
        const bell = Math.sin(t * Math.PI * 0.5); // Rounded outward displacement profile.
        const outwardDistance = settings.edgeWidth * bell; // User-facing wrap width.
        const dropDistance = settings.edgeDrop * Math.pow(t, settings.edgeRound); // User-facing downward sag profile.
        const A = record.a.clone().addScaledVector(outward, outwardDistance).addScaledVector(up, -dropDistance);
        const B = record.b.clone().addScaledVector(outward, outwardDistance).addScaledVector(up, -dropDistance);
        pos.push(A.x, A.y, A.z, B.x, B.y, B.z);
        if (segment < segments) {
          const i0 = baseVertex + segment * 2; // First vertex of this strip row.
          idx.push(i0, i0 + 1, i0 + 3, i0, i0 + 3, i0 + 2);
        }
      }
      baseVertex += (segments + 1) * 2;
    }
    return idx.length ? geometryFromArrays(pos, idx) : null;
  }

  function restoreBaseVisibility() {
    currentTerrainRoot?.traverse(node => { if (node.isMesh) node.visible = true; });
  }

  function rebuildWinter(settings = currentWinterSettings) {
    currentWinterSettings = settings || null;
    restoreBaseVisibility();
    if (currentWinterRoot) {
      worldGroup.remove(currentWinterRoot);
      clearGroup(currentWinterRoot);
      currentWinterRoot = null;
    }
    if (!currentTerrainRoot || !settings?.enabled) return;

    winterUniforms.snowHeight.value = Number(settings.height) || 0;
    winterUniforms.snowNoiseScale.value = Number(settings.noise) || 1.1;
    winterUniforms.snowLayerBulge.value = Number(settings.bulge) || 0;
    winterUniforms.snowLayers.value = Math.max(1, Number(settings.layers) || 1);
    const group = new THREE.Group(); // One parent keeps winter cleanup/rebuild isolated from the generated base terrain.
    const overlays = []; // Covered terrain meshes used both for rendering and true-boundary detection.
    currentTerrainRoot.traverse(node => {
      if (!node.isMesh) return;
      const terrainKey = node.material?.userData?.terrainKey || node.userData?.terrainKey; // Resolved terrain material key selected by the user.
      if (terrainKey !== settings.target) return;
      const geometry = node.geometry.clone(); // Overlay owns its own custom snow-normal attribute/deformation state.
      const overlay = new THREE.Mesh(geometry, winterMaterial(settings.preset, Number(settings.opacity) || 1));
      overlay.name = `${node.name}_${settings.preset}`;
      overlay.position.copy(node.position);
      overlay.quaternion.copy(node.quaternion);
      overlay.scale.copy(node.scale);
      overlay.renderOrder = settings.preset === 'slush' ? 4 : 2;
      group.add(overlay);
      overlays.push(overlay);
      if (settings.preset === 'slush') node.visible = false; // Slush itself is the gray solid-looking mass; no separate substrate beneath it.
    });
    if (!overlays.length) {
      debugLog(`Winter target ${settings.target}: no matching generated terrain mesh.`);
      return;
    }
    assignWeldedNormals(group);
    if (settings.edge) {
      const edges = trueBoundaryEdges(overlays); // Spatially shared covered-to-covered edges are removed here, preventing per-tile ice-cube droop.
      const skirtGeometry = buildBoundarySkirt(edges, settings);
      if (skirtGeometry) {
        const skirt = new THREE.Mesh(skirtGeometry, winterMaterial(settings.preset, Number(settings.opacity) || 1));
        skirt.renderOrder = settings.preset === 'slush' ? 4.1 : 2.1;
        group.add(skirt);
        assignWeldedNormals(skirt);
      }
      debugLog(`Winter true boundary edges: ${edges.length}.`);
    }
    currentWinterRoot = group;
    worldGroup.add(group);
  }

  function fit() {
    if (!currentTerrainRoot) return;
    const box = new THREE.Box3().setFromObject(currentTerrainRoot); // Bounds include ramps/cliffs and therefore frame new experimental landforms correctly.
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.72 || 1; // Single scale drives near/far plane and viewing distance.
    controls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(radius * 1.05, radius * 0.90, radius * 1.25));
    camera.near = Math.max(0.01, radius / 300);
    camera.far = Math.max(500, radius * 40);
    camera.updateProjectionMatrix();
    controls.syncFromCamera?.();
    controls.update();
  }

  function resize() {
    if (!renderer || !stage) return;
    const width = Math.max(1, stage.clientWidth); // CSS stage width used for WebGL and 2D canvases.
    const height = Math.max(1, stage.clientHeight); // CSS stage height used for WebGL and 2D canvases.
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (canvas2d) {
      const dpr = Math.min(2, window.devicePixelRatio || 1); // 2D map stays crisp on mobile without unbounded backing resolution.
      canvas2d.width = Math.max(1, Math.floor(width * dpr));
      canvas2d.height = Math.max(1, Math.floor(height * dpr));
      canvas2d.style.width = `${width}px`;
      canvas2d.style.height = `${height}px`;
      if (currentMerged) draw2d();
    }
  }

  function draw2d() {
    if (!canvas2d || !currentMerged) return;
    const context = canvas2d.getContext('2d'); // Fast map renderer intentionally stays independent from WebGL.
    const width = canvas2d.width;
    const height = canvas2d.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#081018';
    context.fillRect(0, 0, width, height);
    const sx = width / currentMerged.cols; // Pixels per generated column.
    const sy = height / currentMerged.rows; // Pixels per generated row.
    for (const tile of currentMerged.tiles.values()) {
      const baseColor = TERRAIN_DEFAULT_COLORS[tile.type] ?? 0x888888; // Terrain-type base before elevation brightening.
      const color = new THREE.Color(baseColor);
      color.offsetHSL(0, 0, Math.min(0.22, Math.max(0, tile.elevTier || 0) * 0.018));
      if (tile.type === 'ramp') color.offsetHSL(0.06, -0.08, Math.min(0.30, (tile.rampElevation || 0) * 0.025));
      context.fillStyle = `#${color.getHexString()}`;
      context.fillRect(Math.floor(tile.c * sx), Math.floor(tile.r * sy), Math.ceil(sx) + 0.4, Math.ceil(sy) + 0.4);
      if (tile.floraKind) {
        context.fillStyle = 'rgba(12,35,15,.78)';
        context.fillRect((tile.c + 0.34) * sx, (tile.r + 0.34) * sy, Math.max(1, 0.32 * sx), Math.max(1, 0.32 * sy));
      }
      if (tile.rockKind) {
        context.fillStyle = 'rgba(235,238,245,.55)';
        context.fillRect((tile.c + 0.38) * sx, (tile.r + 0.38) * sy, Math.max(1, 0.24 * sx), Math.max(1, 0.24 * sy));
      }
    }
    const entry = currentWorkspace?.entry; // Generated entry is drawn last as a visible orange tile outline.
    if (entry) {
      context.strokeStyle = '#ff6f54';
      context.lineWidth = Math.max(2, Math.min(sx, sy) * 0.7);
      context.strokeRect(entry.col * sx, entry.row * sy, Math.max(2, sx), Math.max(2, sy));
    }
  }

  function renderWorkspace(workspace, rootId, winterSettings = null) {
    clearPreview();
    currentWorkspace = workspace;
    currentTerrainRoot = buildTerrainRoot(workspace, rootId);
    worldGroup.add(currentTerrainRoot);
    draw2d();
    rebuildWinter(winterSettings);
    fit();
    debugLog(`3D render complete: ${currentTerrainRoot.children.length} base mesh bucket(s).`);
    return currentMerged;
  }

  async function init(options) {
    if (!THREE) throw new Error('Three.js r128 failed to load.');
    if (!TerrainPreview) throw new Error('terrain-preview.js failed to load.');
    canvas3d = options.canvas3d;
    canvas2d = options.canvas2d;
    stage = options.stage;
    debugLog = options.debugLog || (() => {});
    scene = new THREE.Scene();
    scene.background = new THREE.Color(GAME_FOG_COLOR);
    scene.fog = new THREE.FogExp2(GAME_FOG_COLOR, 0.018);
    camera = new THREE.PerspectiveCamera(55, 1, 0.05, 3000);
    camera.position.set(60, 52, 72);
    renderer = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    if (THREE.sRGBEncoding != null) renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setClearColor(GAME_FOG_COLOR, 1);
    scene.add(new THREE.AmbientLight(0xfff0e0, 0.7));
    const sun = new THREE.DirectionalLight(0xffeedd, 1.1); // Map-editor/live-zone directional light.
    sun.position.set(4, 8, 2);
    scene.add(sun);
    controls = createControls(camera, canvas3d);
    controls.target.set(50, 0, 50);
    controls.syncFromCamera?.();
    worldGroup = new THREE.Group();
    scene.add(worldGroup);
    await loadMaterialConfig();
    resizeObserver?.disconnect?.();
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(stage);
    window.addEventListener('resize', resize, { passive: true });
    resize();
    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();
    debugLog(`3D renderer ready: WebGL ${renderer.capabilities.isWebGL2 ? '2' : '1'}, Three r${THREE.REVISION}.`);
  }

  window.WildernessLabPreview = {
    init,
    renderWorkspace,
    rebuildWinter,
    fit,
    resize,
    draw2d,
    getMerged: () => currentMerged,
    getRenderer: () => renderer,
  };
})();
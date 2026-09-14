'use strict';

// This tool owns its own terrain comparison. The generic Tool Hub parity layer
// must not remap these meshes after the two variants are captured.
window.__hobunjiToolTerrainParityBootstrap = true;
const parityPanelMute = document.createElement('style');
parityPanelMute.textContent = '#hobunjiTerrainParityPanel{display:none!important}';
(document.head || document.documentElement).appendChild(parityPanelMute);

(() => {
  const THREE = window.THREE;
  const Core = window.BackgroundScenery;
  const BorderTerrain = window.BorderTerrain;
  if (!THREE || !Core || !BorderTerrain) {
    console.error('[boundary-preview] missing Three, BackgroundScenery, or BorderTerrain');
    return;
  }

  const $ = id => document.getElementById(id);
  const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
  const canvas = $('preview3dCanvas');
  const host = $('preview3d');
  if (!canvas || !host) return;

  let activeMap = null;
  let activeConfig = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let controls = null;
  let terrainRecords = [];
  let buildToken = 0;
  let rebuildTimer = 0;
  let viewMode = 'compare';
  let needsFit = true;
  let lastAuthorRevision = 0;
  const textureCache = new Map();
  const textureErrors = new Map();

  const originalResolveConfig = Core.resolveConfig.bind(Core);
  Core.resolveConfig = function auditedBoundaryResolveConfig(map) {
    const cfg = originalResolveConfig(map);
    activeMap = map;
    activeConfig = cfg;
    needsFit = true;
    queueMicrotask(() => scheduleRebuild(10));
    return cfg;
  };

  function canonicalTextureUrl(path) {
    const raw = String(path || '').trim();
    if (!raw) return '';
    if (/^(?:https?:|data:|blob:)/i.test(raw)) return raw;
    const clean = raw.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^docs\//, '');
    const marker = 'assets/textures/';
    const markerIndex = clean.toLowerCase().indexOf(marker);
    if (markerIndex >= 0) return '../../' + clean.slice(markerIndex);
    const file = clean.split('/').filter(Boolean).pop() || clean;
    return '../../assets/textures/' + file;
  }

  function loadTexture(path) {
    const url = canonicalTextureUrl(path);
    if (!url) return Promise.resolve(null);
    if (textureCache.has(url)) return textureCache.get(url);
    const promise = new Promise(resolve => {
      new THREE.TextureLoader().load(url, texture => {
        if ('encoding' in texture && THREE.sRGBEncoding != null) texture.encoding = THREE.sRGBEncoding;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;
        textureErrors.delete(url);
        resolve(texture);
      }, undefined, error => {
        textureErrors.set(url, error?.message || 'load failed');
        console.warn('[boundary-preview] PNG load failed:', url, error || 'unknown error');
        resolve(null);
      });
    });
    textureCache.set(url, promise);
    return promise;
  }

  function initialMaterial(texture, kind) {
    const color = kind === 'grass' ? 0x2f7021 : 0x6a6460;
    const material = new THREE.MeshStandardMaterial({
      map: texture || null,
      color,
      roughness: 0.96,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    material.name = `boundary_seed_${kind}`;
    material.userData = Object.assign({}, material.userData, {
      terrainKey: kind,
      boundaryPreviewSeedMaterial: true,
    });
    return material;
  }

  function uvDiagnosticMaterial() {
    const material = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'varying vec2 vUv; void main(){vec2 q=fract(vUv); vec2 g=abs(fract(vUv*8.0)-0.5); float line=1.0-smoothstep(0.44,0.49,max(g.x,g.y)); vec3 base=vec3(q.x,q.y,0.32+0.38*(1.0-q.x)); gl_FragColor=vec4(mix(base,vec3(1.0),line*0.34),1.0);}',
    });
    material.userData.previewOwned = true;
    return material;
  }

  function seeded(seed) {
    let state = seed >>> 0;
    return () => {
      state += 0x6D2B79F5;
      let t = Math.imul(state ^ state >>> 15, state | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function initRenderer() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:false, powerPreference:'high-performance' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    if ('outputEncoding' in renderer && THREE.sRGBEncoding != null) renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setClearColor(0x08111a, 1);
    camera = new THREE.PerspectiveCamera(46, 1, 0.05, 700);
    camera.position.set(52, 40, 68);
    if (THREE.OrbitControls) {
      controls = new THREE.OrbitControls(camera, canvas);
      controls.enableDamping = true;
      controls.dampingFactor = 0.075;
      controls.screenSpacePanning = false;
      controls.minDistance = 2;
      controls.maxDistance = 320;
      controls.maxPolarAngle = Math.PI * 0.495;
      controls.target.set(30, 1.2, 25);
    }
    resizeRenderer();
  }

  function addContextFloor(map) {
    const geometry = new THREE.PlaneGeometry(map.cols, map.rows, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(map.cols/2, -0.018, map.rows/2);
    const material = new THREE.MeshStandardMaterial({ color:0x183b24, roughness:1, metalness:0 });
    material.userData.previewOwned = true;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'PreviewPlayableContext';
    mesh.userData.terrainJigsawIgnore = true;
    scene.add(mesh);

    const borderMaterial = new THREE.LineBasicMaterial({ color:0x8aa2b7, transparent:true, opacity:0.35 });
    borderMaterial.userData.previewOwned = true;
    const border = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(map.cols, 0.02, map.rows)), borderMaterial);
    border.position.set(map.cols/2, 0, map.rows/2);
    scene.add(border);
  }

  function disposeOwnedMaterial(material) {
    const materials = Array.isArray(material) ? material : [material];
    for (const item of materials) {
      if (!item) continue;
      if (!item.userData?.previewOwned && !item.userData?.terrainJigsawMaterial) continue;
      try { item.map?.dispose?.(); } catch (_) {}
      try { item.dispose?.(); } catch (_) {}
    }
  }

  function disposeScene() {
    if (!scene) return;
    const seenGeometry = new Set();
    for (const record of terrainRecords) {
      for (const geometry of [record.currentGeometry, record.jigsawGeometry]) {
        if (geometry && !seenGeometry.has(geometry)) {
          seenGeometry.add(geometry);
          try { geometry.dispose?.(); } catch (_) {}
        }
      }
      disposeOwnedMaterial(record.jigsawMaterial);
      disposeOwnedMaterial(record.debugMaterial);
    }
    scene.traverse(object => {
      if (object.geometry && !seenGeometry.has(object.geometry)) {
        seenGeometry.add(object.geometry);
        try { object.geometry.dispose?.(); } catch (_) {}
      }
      disposeOwnedMaterial(object.material);
    });
    terrainRecords = [];
    scene = null;
  }

  function jigsawEnabled() { return activeConfig?.materialStretch?.enabled !== false; }

  function slotSettings(slotName) {
    const slot = activeConfig?.materialStretch?.slots?.[slotName];
    return {
      edgePx: clamp(Number(slot?.protectedEdgePx ?? 16), 0, 256),
      edgeWorldWidth: clamp(Number(slot?.edgeWorldWidth ?? 0.5), 0.05, 8),
    };
  }

  function materialArray(mesh) { return Array.isArray(mesh?.material) ? mesh.material : [mesh?.material]; }

  function semanticSurface(mesh) {
    if (mesh?.userData?.naturalSurface) return String(mesh.userData.naturalSurface);
    for (const material of materialArray(mesh)) {
      if (material?.userData?.naturalSurface) return String(material.userData.naturalSurface);
    }
    return '';
  }

  function semanticTerrainKey(mesh) {
    if (mesh?.userData?.terrainKey) return String(mesh.userData.terrainKey).toLowerCase();
    for (const material of materialArray(mesh)) {
      if (material?.userData?.terrainKey) return String(material.userData.terrainKey).toLowerCase();
    }
    return '';
  }

  function currentOwner(mesh) {
    const report = mesh?.geometry?.userData?.hobunjiSurfaceStretch;
    return String(
      mesh?.userData?.naturalSurfaceUvOwner
      || report?.mapping
      || mesh?.geometry?.userData?.naturalSurfaceUvMapping
      || 'authored/world UV'
    );
  }

  function isCurrentCliff(mesh) {
    const surface = semanticSurface(mesh);
    if (surface === 'rocks' || surface === 'cliffs') return true;
    const key = semanticTerrainKey(mesh);
    return key === 'rock' || key === 'cliff';
  }

  function isCurrentGrass(mesh, seedGrassMaterial) {
    return mesh?.material === seedGrassMaterial || semanticTerrainKey(mesh) === 'grass';
  }

  function authoredTextureReady(material) {
    const map = Array.isArray(material) ? material[0]?.map : material?.map;
    const image = map?.image || map?.source?.data;
    const width = Number(image?.naturalWidth || image?.videoWidth || image?.width || 0);
    const height = Number(image?.naturalHeight || image?.videoHeight || image?.height || 0);
    const state = String(map?.userData?.hobunjiAuthoredSurfaceState || '');
    return !!map && width > 4 && height > 4 && !state.startsWith('flat-');
  }

  async function waitForCurrentTextures(meshes, token, timeoutMs = 3500) {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      if (token !== buildToken) return false;
      if (meshes.every(mesh => authoredTextureReady(mesh.material))) return true;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    return meshes.every(mesh => authoredTextureReady(mesh.material));
  }

  function ensureBakeUv(geometry) {
    const position = geometry?.getAttribute?.('position');
    if (!position) return false;
    const existingUv = geometry.getAttribute('uv');
    if (existingUv?.count === position.count) return true;
    const uv = new Float32Array(position.count * 2);
    for (let i = 0; i < position.count; i++) {
      uv[i * 2] = position.getX(i);
      uv[i * 2 + 1] = position.getZ(i);
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return true;
  }

  function installRecord(slotName, mesh, failures) {
    if (!jigsawEnabled()) return null;
    const api = window.TerrainJigsawUV;
    if (!api?.bakeMesh) {
      failures.push(`${slotName}: TerrainJigsawUV.bakeMesh missing`);
      return null;
    }
    if (Array.isArray(mesh?.material)) {
      failures.push(`${slotName}: comparison candidate has multiple material slots`);
      return null;
    }
    if (!mesh?.material?.map) {
      failures.push(`${slotName}: current game material.map missing`);
      return null;
    }

    const currentGeometry = mesh.geometry;
    const currentMaterial = mesh.material;
    const bakeGeometry = currentGeometry.clone();
    if (!ensureBakeUv(bakeGeometry)) {
      failures.push(`${slotName}: position attribute missing`);
      bakeGeometry.dispose?.();
      return null;
    }
    bakeGeometry.clearGroups();

    const bakeMaterial = currentMaterial.clone();
    bakeMaterial.map = currentMaterial.map;
    bakeMaterial.transparent = false;
    bakeMaterial.opacity = 1;
    bakeMaterial.depthWrite = true;
    bakeMaterial.userData = Object.assign({}, bakeMaterial.userData || {}, { previewOwned:true });
    bakeMaterial.needsUpdate = true;

    const temp = new THREE.Mesh(bakeGeometry, bakeMaterial);
    const settings = slotSettings(slotName);
    const stats = api.bakeMesh(temp, { ...settings, force:true, disposeSource:true });
    if (!stats) {
      failures.push(`${slotName}: direct Jigsaw baker returned null`);
      try { temp.geometry?.dispose?.(); } catch (_) {}
      try { bakeMaterial.dispose?.(); } catch (_) {}
      return null;
    }

    if (temp.material) {
      const materials = Array.isArray(temp.material) ? temp.material : [temp.material];
      for (const item of materials) item.userData = Object.assign({}, item.userData || {}, { previewOwned:true });
    }

    const record = {
      mesh,
      slotName,
      currentGeometry,
      currentMaterial,
      currentOwner: currentOwner(mesh),
      jigsawGeometry: temp.geometry,
      jigsawMaterial: temp.material,
      debugMaterial: uvDiagnosticMaterial(),
      stats,
      settings:{ ...settings },
    };
    terrainRecords.push(record);
    return record;
  }

  function settingsSummary() {
    const grass = slotSettings('grass');
    const cliff = slotSettings('cliff');
    return `grass ${grass.edgePx}px/${grass.edgeWorldWidth.toFixed(2)}u · cliff ${cliff.edgePx}px/${cliff.edgeWorldWidth.toFixed(2)}u`;
  }

  async function rebuild() {
    clearTimeout(rebuildTimer);
    initRenderer();
    if (!activeMap || !activeConfig) {
      setStatus('Load a map to build the 3D scenery preview.');
      return;
    }
    const token = ++buildToken;
    setStatus(`Building actual current-game terrain path before Direct Jigsaw · ${settingsSummary()}…`);

    const stretch = activeConfig.materialStretch || {};
    const grassPath = stretch.slots?.grass?.texture || 'assets/textures/wavy_surface.png';
    const cliffPath = stretch.slots?.cliff?.texture || 'assets/textures/carved_smooth.png';
    const [grassTexture, cliffTexture] = await Promise.all([loadTexture(grassPath), loadTexture(cliffPath)]);
    if (token !== buildToken) return;

    disposeScene();
    scene = new THREE.Scene();
    scene.userData.terrainJigsawDisableAuto = true;
    scene.userData.toolTerrainParityDisable = true;
    scene.background = new THREE.Color(0x08111a);
    scene.add(new THREE.HemisphereLight(0xbdd6ff, 0x203019, 1.25));
    const sun = new THREE.DirectionalLight(0xfff2d1, 1.55);
    sun.position.set(activeMap.cols * .18, 42, activeMap.rows * .25);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x8fb7dc, .40);
    fill.position.set(activeMap.cols + 18, 16, activeMap.rows + 18);
    scene.add(fill);
    addContextFloor(activeMap);

    const grassSeed = initialMaterial(grassTexture, 'grass');
    grassSeed.userData.previewOwned = true;
    const cliffSeed = initialMaterial(cliffTexture, 'cliff');
    cliffSeed.userData.previewOwned = true;
    const pathMat = new THREE.MeshStandardMaterial({ color:0x9f8357, roughness:1, metalness:0, side:THREE.DoubleSide });
    pathMat.userData.previewOwned = true;

    const deps = {
      NORMAL_TOP:0,
      PLATEAU_UNIT:1,
      TileType:{ GRASS:'grass', PATH:'path' },
      clamp,
      getTownScene:() => scene,
      getTownZone:() => activeMap,
      resolveTileMat:(_mapId, type) => type === 'grass' ? grassSeed : pathMat,
      resolveCliffMat:() => cliffSeed,
      getGrassBillboardMat:() => null,
      getGrassEnabled:() => false,
      grassBladeGeo:null,
      mbRng:seeded,
      markOutline:() => {},
    };

    try {
      BorderTerrain.init(deps);
      BorderTerrain.buildTownBorderTerrain();
      // This is the real farm cliff post-process, not a tool-side imitation.
      // It changes semantic cliffs to the same rock material/tint and then calls
      // the shared natural-surface mapper through the normal game wrappers.
      window.FarmCliffRockOutline?.applyRockMaterialAndTextureOutline?.(scene.children.slice());
    } catch (error) {
      setStatus(`3D build failed: ${error.message}`);
      console.error(error);
      return;
    }

    const meshes = [];
    scene.traverse(object => { if (object?.isMesh) meshes.push(object); });
    const cliffMeshes = meshes.filter(isCurrentCliff);
    await waitForCurrentTextures(cliffMeshes, token);
    if (token !== buildToken) return;

    const failures = [];
    let candidates = 0;
    for (const object of meshes) {
      if (isCurrentCliff(object)) {
        candidates++;
        installRecord('cliff', object, failures);
      } else if (isCurrentGrass(object, grassSeed)) {
        candidates++;
        installRecord('grass', object, failures);
      }
    }

    applyVariant(viewMode === 'protected' ? 'jigsaw' : viewMode === 'heatmap' ? 'heatmap' : 'current');
    if (needsFit) fitCamera();
    needsFit = false;

    const islands = terrainRecords.reduce((sum, record) => sum + (record.stats?.islands || 0), 0);
    const triangles = terrainRecords.reduce((sum, record) => sum + (record.stats?.triangles || 0), 0);
    const owners = [...new Set(terrainRecords.filter(r => r.slotName === 'cliff').map(r => r.currentOwner))];
    const current = owners.length ? owners.join(', ') : 'none';
    const baker = window.TerrainJigsawUV?.bakeMesh ? 'baker OK' : 'BAKER MISSING';
    const currentStack = `CURRENT owner ${current} · FarmCliffRockOutline ${window.FarmCliffRockOutline?.installed ? 'OK' : 'missing'}`;
    if (!jigsawEnabled()) {
      setStatus(`DIRECT JIGSAW DISABLED · ${candidates} candidate${candidates === 1 ? '' : 's'} · ${currentStack} · ${baker}`);
    } else if (!terrainRecords.length) {
      const why = failures.length ? ` · ${[...new Set(failures)].slice(0, 4).join(' | ')}` : '';
      setStatus(`0/${candidates} comparison meshes baked · ${currentStack} · ${baker}${why}`);
    } else {
      setStatus(`${terrainRecords.length}/${candidates} comparison meshes · CURRENT GAME AUTO vs DIRECT JIGSAW · ${currentStack} · direct ${islands} island(s), ${triangles.toLocaleString()} triangles · ${settingsSummary()} · ${baker}`);
    }
  }

  function setWire(material, enabled) {
    const materials = Array.isArray(material) ? material : [material];
    for (const item of materials) {
      if (item && 'wireframe' in item) {
        item.wireframe = enabled;
        item.needsUpdate = true;
      }
    }
  }

  function applyVariant(name) {
    const wire = !!$('preview3dWire')?.checked;
    const canJigsaw = jigsawEnabled();
    for (const record of terrainRecords) {
      if (canJigsaw && name === 'jigsaw') {
        record.mesh.geometry = record.jigsawGeometry;
        record.mesh.material = record.jigsawMaterial;
      } else if (canJigsaw && name === 'heatmap') {
        record.mesh.geometry = record.jigsawGeometry;
        record.mesh.material = record.debugMaterial;
      } else {
        record.mesh.geometry = record.currentGeometry;
        record.mesh.material = record.currentMaterial;
      }
      setWire(record.mesh.material, wire);
    }
  }

  function fitCamera() {
    if (!activeMap || !camera) return;
    const depth = Math.max(6, Math.round(Number(activeConfig?.borderDepthTiles) || 18));
    const center = new THREE.Vector3(activeMap.cols/2, 1.35, activeMap.rows/2);
    const radius = Math.max(activeMap.cols + depth*2, activeMap.rows + depth*2) * .62;
    camera.position.set(center.x + radius*.72, center.y + radius*.55, center.z + radius*.88);
    camera.near = Math.max(.05, radius/800);
    camera.far = Math.max(300, radius*8);
    camera.updateProjectionMatrix();
    controls?.target.copy(center);
    controls?.update();
  }

  function setStatus(text) {
    if ($('preview3dStatus')) $('preview3dStatus').textContent = text;
  }

  function scheduleRebuild(delay = 140) {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuild, delay);
  }

  function resizeRenderer() {
    if (!renderer) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width*dpr) || canvas.height !== Math.round(height*dpr)) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
    }
  }

  function renderViewport(x, y, width, height, variant) {
    if (!scene || !camera || width < 2 || height < 2) return;
    applyVariant(variant);
    renderer.setViewport(x, y, width, height);
    renderer.setScissor(x, y, width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }

  function render() {
    requestAnimationFrame(render);
    if (!renderer || !scene || host.style.display === 'none') return;
    controls?.update();
    resizeRenderer();
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    renderer.setScissorTest(true);
    if (viewMode === 'compare') {
      const left = Math.floor(width / 2);
      renderViewport(0, 0, left, height, 'current');
      renderViewport(left, 0, width - left, height, 'jigsaw');
    } else {
      renderViewport(0, 0, width, height, viewMode === 'protected' ? 'jigsaw' : viewMode === 'heatmap' ? 'heatmap' : 'current');
    }
    renderer.setScissorTest(false);
    updateCompareLabels();
  }

  function updateCompareLabels() {
    const left = $('preview3dLeftLabel');
    const right = $('preview3dRightLabel');
    if (!left || !right) return;
    const compare = viewMode === 'compare';
    left.style.display = compare ? '' : 'none';
    right.style.display = compare ? '' : 'none';
    left.textContent = 'CURRENT GAME AUTO';
    right.textContent = 'DIRECT JIGSAW';
  }

  function relabelModeUi() {
    const mode = $('preview3dMode');
    if (!mode) return;
    for (const option of mode.options) {
      if (option.value === 'compare') option.textContent = 'Current game vs direct Jigsaw';
      else if (option.value === 'protected') option.textContent = 'Direct Jigsaw only';
      else if (option.value === 'ordinary') option.textContent = 'Current game only';
      else if (option.value === 'heatmap') option.textContent = 'Direct Jigsaw UV diagnostic';
    }
  }

  function setView(which) {
    const is3d = which === '3d';
    host.style.display = is3d ? 'block' : 'none';
    $('canvas').style.display = is3d ? 'none' : 'block';
    $('hud').style.display = is3d ? 'none' : 'flex';
    $('legend').style.display = is3d ? 'none' : '';
    $('view2DBtn')?.classList.toggle('act', !is3d);
    $('view3DBtn')?.classList.toggle('act', is3d);
    if (is3d) {
      initRenderer();
      resizeRenderer();
      scheduleRebuild(0);
    }
  }

  $('view2DBtn')?.addEventListener('click', () => setView('2d'));
  $('view3DBtn')?.addEventListener('click', () => setView('3d'));
  $('preview3dMode')?.addEventListener('change', event => { viewMode = event.target.value; updateCompareLabels(); });
  $('preview3dWire')?.addEventListener('change', () => applyVariant(viewMode === 'protected' ? 'jigsaw' : viewMode === 'heatmap' ? 'heatmap' : 'current'));
  $('preview3dFit')?.addEventListener('click', fitCamera);
  $('preview3dRebuild')?.addEventListener('click', () => scheduleRebuild(0));
  window.addEventListener('resize', resizeRenderer);
  window.addEventListener('hobunji-jigsaw-author-change', event => {
    lastAuthorRevision = Number(event?.detail?.revision) || lastAuthorRevision;
    scheduleRebuild(40);
  });

  relabelModeUi();
  updateCompareLabels();
  requestAnimationFrame(render);
})();

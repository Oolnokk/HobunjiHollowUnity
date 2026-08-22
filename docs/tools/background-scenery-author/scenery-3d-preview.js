'use strict';
(() => {
  const THREE = window.THREE;
  const Core = window.BackgroundScenery;
  const BorderTerrain = window.BorderTerrain;
  if (!THREE || !Core || !BorderTerrain) return;

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
  let terrainMeshes = [];
  let wireMeshes = [];
  let variants = null;
  let buildToken = 0;
  let rebuildTimer = 0;
  let viewMode = 'compare';
  let needsFit = true;
  let textureConfig = null;
  const textureCache = new Map();

  const originalResolveConfig = Core.resolveConfig.bind(Core);
  Core.resolveConfig = function scenery3dResolveConfig(map) {
    const cfg = originalResolveConfig(map);
    activeMap = map;
    activeConfig = cfg;
    needsFit = true;
    queueMicrotask(() => scheduleRebuild(10));
    return cfg;
  };

  function assetUrl(path) {
    const p = String(path || '').trim();
    if (!p) return '';
    if (/^(?:https?:|data:|blob:)/i.test(p)) return p;
    return '../../' + p.replace(/^docs\//, '').replace(/^\/+/, '');
  }

  async function loadTerrainConfig() {
    if (textureConfig) return textureConfig;
    try {
      const r = await fetch('../../config/maps/terrain-materials.json');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      textureConfig = await r.json();
    } catch (_) {
      textureConfig = { byMap:{} };
    }
    return textureConfig;
  }

  function terrainEntry(kind) {
    const byMap = textureConfig?.byMap || {};
    const id = activeMap?.id || activeMap?.mapId || 'map_hobunji_town';
    return byMap[id]?.[kind] || byMap['*']?.[kind] || null;
  }

  function colorFor(kind) {
    const authored = terrainEntry(kind)?.fillColor;
    const fallback = kind === 'grass' ? '#2f7021' : '#6a6460';
    try { return new THREE.Color(authored || fallback); } catch (_) { return new THREE.Color(fallback); }
  }

  function initRenderer() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:false, powerPreference:'high-performance' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputEncoding = THREE.sRGBEncoding;
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

  function disposeMaterial(m) {
    if (!m) return;
    if (Array.isArray(m)) { m.forEach(disposeMaterial); return; }
    try { m.dispose?.(); } catch (_) {}
  }

  function disposeScene() {
    if (!scene) return;
    scene.traverse(o => {
      if (o.geometry) { try { o.geometry.dispose?.(); } catch (_) {} }
      if (o.material) disposeMaterial(o.material);
    });
    if (variants) {
      for (const slot of Object.values(variants)) {
        for (const mat of Object.values(slot || {})) disposeMaterial(mat);
      }
    }
    scene = null;
    variants = null;
    terrainMeshes = [];
    wireMeshes = [];
  }

  function loadTexture(path) {
    const url = assetUrl(path);
    if (!url) return Promise.resolve(null);
    if (textureCache.has(url)) return textureCache.get(url);
    const promise = new Promise(resolve => {
      const loader = new THREE.TextureLoader();
      loader.load(url, tex => {
        tex.encoding = THREE.sRGBEncoding;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        resolve(tex);
      }, undefined, () => resolve(null));
    });
    textureCache.set(url, promise);
    return promise;
  }

  function cloneTextureForCanvas(canvasEl) {
    const tex = new THREE.CanvasTexture(canvasEl);
    tex.encoding = THREE.sRGBEncoding;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  }

  function protectedCanvas(image, slot, worldW, worldH) {
    const srcW = Math.max(1, image?.naturalWidth || image?.width || 1);
    const srcH = Math.max(1, image?.naturalHeight || image?.height || 1);
    const outW = clamp(Math.max(512, srcW), 512, 1024);
    const outH = clamp(Math.max(512, srcH), 512, 1024);
    const cv = document.createElement('canvas');
    cv.width = outW; cv.height = outH;
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = true;

    let ex = clamp(Number(slot?.protectedEdgePx) || 0, 0, Math.max(0, srcW / 2 - 1));
    let ey = clamp(Number(slot?.protectedEdgePx) || 0, 0, Math.max(0, srcH / 2 - 1));
    let tx = clamp((Number(slot?.edgeWorldWidth) || 0) / Math.max(0.001, worldW), 0, 0.49) * outW;
    let ty = clamp((Number(slot?.edgeWorldWidth) || 0) / Math.max(0.001, worldH), 0, 0.49) * outH;
    if (ex < 0.5 || tx < 0.5) { ex = 0; tx = 0; }
    if (ey < 0.5 || ty < 0.5) { ey = 0; ty = 0; }

    const sx = [0, ex, srcW - ex, srcW];
    const sy = [0, ey, srcH - ey, srcH];
    const dx = [0, tx, outW - tx, outW];
    const dy = [0, ty, outH - ty, outH];
    for (let yi = 0; yi < 3; yi++) for (let xi = 0; xi < 3; xi++) {
      const sw = sx[xi+1] - sx[xi], sh = sy[yi+1] - sy[yi];
      const dw = dx[xi+1] - dx[xi], dh = dy[yi+1] - dy[yi];
      if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) continue;
      c.drawImage(image, sx[xi], sy[yi], sw, sh, dx[xi], dy[yi], dw, dh);
    }
    return cv;
  }

  function heatmapCanvas(slot, worldW, worldH) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 512;
    const c = cv.getContext('2d');
    c.fillStyle = '#d69c26'; c.fillRect(0,0,512,512);
    const fx = clamp((Number(slot?.edgeWorldWidth) || 0) / Math.max(0.001, worldW), 0, 0.49) * 512;
    const fy = clamp((Number(slot?.edgeWorldWidth) || 0) / Math.max(0.001, worldH), 0, 0.49) * 512;
    c.fillStyle = '#2aae79';
    if (fx > 0) { c.fillRect(0,0,fx,512); c.fillRect(512-fx,0,fx,512); }
    if (fy > 0) { c.fillRect(0,0,512,fy); c.fillRect(0,512-fy,512,fy); }
    c.strokeStyle = 'rgba(255,255,255,.8)'; c.lineWidth = 2;
    c.strokeRect(fx,fy,Math.max(0,512-2*fx),Math.max(0,512-2*fy));
    return cv;
  }

  function makeMaterial(map, color, slotName, variantName) {
    const m = new THREE.MeshStandardMaterial({
      map: map || null,
      color,
      roughness: 0.96,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    m.userData.previewSlot = slotName;
    m.userData.previewVariant = variantName;
    m.userData.previewOwned = true;
    return m;
  }

  async function buildVariants(worldW, worldH) {
    const stretch = activeConfig?.materialStretch || {};
    const grassSlot = stretch.slots?.grass || { texture:'assets/textures/wavy_surface.png', protectedEdgePx:16, edgeWorldWidth:0.5 };
    const cliffSlot = stretch.slots?.cliff || { texture:'assets/textures/carved_smooth.png', protectedEdgePx:16, edgeWorldWidth:0.5 };
    const [grassTex, cliffTex] = await Promise.all([loadTexture(grassSlot.texture), loadTexture(cliffSlot.texture)]);
    const makeSlot = (name, slot, tex, kind) => {
      const color = colorFor(kind);
      const protectedTex = tex?.image ? cloneTextureForCanvas(protectedCanvas(tex.image, slot, worldW, worldH)) : null;
      const heatTex = cloneTextureForCanvas(heatmapCanvas(slot, worldW, worldH));
      return {
        ordinary: makeMaterial(tex, color, name, 'ordinary'),
        protected: makeMaterial(protectedTex || tex, color, name, 'protected'),
        heatmap: makeMaterial(heatTex, new THREE.Color('#ffffff'), name, 'heatmap'),
      };
    };
    return {
      grass: makeSlot('grass', grassSlot, grassTex, 'grass'),
      cliff: makeSlot('cliff', cliffSlot, cliffTex, 'cliff'),
    };
  }

  function normalizeTerrainUvs(mesh, worldW, worldH, depth) {
    const uv = mesh.geometry?.getAttribute?.('uv');
    if (!uv) return;
    for (let i = 0; i < uv.count; i++) {
      const wx = uv.getX(i), wz = uv.getY(i);
      uv.setXY(i, (wx + depth) / worldW, (wz + depth) / worldH);
    }
    uv.needsUpdate = true;
  }

  function seeded(seed) {
    let s = seed >>> 0;
    return () => {
      s += 0x6D2B79F5;
      let t = Math.imul(s ^ s >>> 15, s | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function addContextFloor(map) {
    const geo = new THREE.PlaneGeometry(map.cols, map.rows, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(map.cols/2, -0.018, map.rows/2);
    const mat = new THREE.MeshStandardMaterial({ color:0x183b24, roughness:1, metalness:0 });
    const m = new THREE.Mesh(geo, mat);
    m.name = 'PreviewPlayableContext';
    m.userData.previewOwnedMaterial = true;
    scene.add(m);

    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(map.cols, 0.02, map.rows)),
      new THREE.LineBasicMaterial({ color:0x8aa2b7, transparent:true, opacity:0.35 })
    );
    border.position.set(map.cols/2, 0, map.rows/2);
    border.userData.previewOwnedMaterial = true;
    scene.add(border);
  }

  function addWireframe(mesh) {
    const g = new THREE.WireframeGeometry(mesh.geometry);
    const m = new THREE.LineBasicMaterial({ color:0xd9e8f6, transparent:true, opacity:0.20, depthWrite:false });
    const lines = new THREE.LineSegments(g, m);
    lines.renderOrder = 9;
    lines.visible = !!$('preview3dWire')?.checked;
    lines.userData.previewWire = true;
    lines.userData.previewOwnedMaterial = true;
    mesh.add(lines);
    wireMeshes.push(lines);
  }

  function installTerrainVariant(slotName, mesh, depth, worldW, worldH) {
    mesh.userData.previewTerrainSlot = slotName;
    normalizeTerrainUvs(mesh, worldW, worldH, depth);
    terrainMeshes.push(mesh);
    addWireframe(mesh);
  }

  async function rebuild() {
    clearTimeout(rebuildTimer);
    initRenderer();
    if (!activeMap || !activeConfig) {
      setStatus('Load a map to build the 3D scenery preview.');
      return;
    }
    const token = ++buildToken;
    setStatus('Building game boundary geometry…');
    await loadTerrainConfig();
    const depth = Math.max(6, Math.round(Number(activeConfig.borderDepthTiles) || 18));
    const worldW = activeMap.cols + depth * 2;
    const worldH = activeMap.rows + depth * 2;
    const nextVariants = await buildVariants(worldW, worldH);
    if (token !== buildToken) {
      for (const s of Object.values(nextVariants)) for (const m of Object.values(s)) disposeMaterial(m);
      return;
    }

    disposeScene();
    variants = nextVariants;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x08111a);
    scene.add(new THREE.HemisphereLight(0xbdd6ff, 0x203019, 1.25));
    const sun = new THREE.DirectionalLight(0xfff2d1, 1.55);
    sun.position.set(activeMap.cols * 0.18, 42, activeMap.rows * 0.25);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x8fb7dc, 0.40);
    fill.position.set(activeMap.cols + depth, 16, activeMap.rows + depth);
    scene.add(fill);
    addContextFloor(activeMap);

    const grassOrd = variants.grass.ordinary;
    const cliffOrd = variants.cliff.ordinary;
    const pathMat = new THREE.MeshStandardMaterial({ color:0x9f8357, roughness:1, metalness:0, side:THREE.DoubleSide });
    pathMat.userData.previewOwned = true;

    const deps = {
      NORMAL_TOP:0,
      PLATEAU_UNIT:1,
      TileType:{ GRASS:'grass', PATH:'path' },
      clamp,
      getTownScene:() => scene,
      getTownZone:() => activeMap,
      resolveTileMat:(_mapId, type) => type === 'grass' ? grassOrd : pathMat,
      resolveCliffMat:() => cliffOrd,
      getGrassBillboardMat:() => null,
      getGrassEnabled:() => false,
      grassBladeGeo:null,
      mbRng:seeded,
      markOutline:() => {},
    };

    try {
      BorderTerrain.init(deps);
      BorderTerrain.buildTownBorderTerrain();
    } catch (e) {
      setStatus(`3D build failed: ${e.message}`);
      console.error(e);
      return;
    }

    scene.traverse(o => {
      if (!o.isMesh) return;
      if (o.material === grassOrd) installTerrainVariant('grass', o, depth, worldW, worldH);
      else if (o.material === cliffOrd) installTerrainVariant('cliff', o, depth, worldW, worldH);
    });
    applyVariant(viewMode === 'protected' ? 'protected' : viewMode === 'heatmap' ? 'heatmap' : 'ordinary');
    if (needsFit) fitCamera();
    needsFit = false;
    setStatus(`${terrainMeshes.length} terrain surface${terrainMeshes.length===1?'':'s'} · game BorderTerrain geometry · ${activeMap.cols}×${activeMap.rows} + ${depth}t background`);
  }

  function applyVariant(name) {
    if (!variants) return;
    for (const mesh of terrainMeshes) {
      const slot = mesh.userData.previewTerrainSlot;
      if (variants[slot]?.[name]) mesh.material = variants[slot][name];
    }
  }

  function fitCamera() {
    if (!activeMap || !camera) return;
    const depth = Math.max(6, Math.round(Number(activeConfig?.borderDepthTiles) || 18));
    const center = new THREE.Vector3(activeMap.cols/2, 1.35, activeMap.rows/2);
    const radius = Math.max(activeMap.cols + depth*2, activeMap.rows + depth*2) * 0.62;
    camera.position.set(center.x + radius*0.72, center.y + radius*0.55, center.z + radius*0.88);
    camera.near = Math.max(0.05, radius / 800);
    camera.far = Math.max(300, radius * 8);
    camera.updateProjectionMatrix();
    controls?.target.copy(center);
    controls?.update();
  }

  function setStatus(text) { if ($('preview3dStatus')) $('preview3dStatus').textContent = text; }

  function scheduleRebuild(delay=140) {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuild, delay);
  }

  function resizeRenderer() {
    if (!renderer) return;
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w*dpr) || canvas.height !== Math.round(h*dpr)) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
    }
  }

  function renderViewport(x,y,w,h,variant) {
    if (!scene || !camera || w < 2 || h < 2) return;
    applyVariant(variant);
    renderer.setViewport(x,y,w,h);
    renderer.setScissor(x,y,w,h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }

  function render() {
    requestAnimationFrame(render);
    if (!renderer || !scene || host.style.display === 'none') return;
    controls?.update();
    resizeRenderer();
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setScissorTest(true);
    if (viewMode === 'compare') {
      const left = Math.floor(w/2);
      renderViewport(0,0,left,h,'ordinary');
      renderViewport(left,0,w-left,h,'protected');
    } else {
      renderViewport(0,0,w,h,viewMode === 'heatmap' ? 'heatmap' : viewMode);
    }
    renderer.setScissorTest(false);
    updateCompareLabels();
  }

  function updateCompareLabels() {
    const l = $('preview3dLeftLabel'), r = $('preview3dRightLabel');
    if (!l || !r) return;
    const compare = viewMode === 'compare';
    l.style.display = compare ? '' : 'none';
    r.style.display = compare ? '' : 'none';
  }

  function setView(which) {
    const is3d = which === '3d';
    host.style.display = is3d ? 'block' : 'none';
    $('canvas').style.display = is3d ? 'none' : 'block';
    $('hud').style.display = is3d ? 'none' : 'flex';
    $('legend').style.display = is3d ? 'none' : 'block';
    $('view2DBtn')?.classList.toggle('act', !is3d);
    $('view3DBtn')?.classList.toggle('act', is3d);
    if (is3d) {
      initRenderer();
      resizeRenderer();
      if (!scene) scheduleRebuild(0);
    }
  }

  $('view2DBtn')?.addEventListener('click', () => setView('2d'));
  $('view3DBtn')?.addEventListener('click', () => setView('3d'));
  $('preview3dMode')?.addEventListener('change', e => {
    viewMode = e.target.value;
    applyVariant(viewMode === 'compare' ? 'ordinary' : viewMode);
    updateCompareLabels();
  });
  $('preview3dWire')?.addEventListener('change', e => {
    for (const m of wireMeshes) m.visible = e.target.checked;
  });
  $('preview3dFit')?.addEventListener('click', fitCamera);
  $('preview3dRebuild')?.addEventListener('click', () => scheduleRebuild(0));

  $('sideScroll')?.addEventListener('input', e => {
    if (e.target?.id === 'stretchMode' || e.target?.id === 'stretchSlot') return;
    scheduleRebuild(170);
  }, true);
  $('sideScroll')?.addEventListener('change', () => scheduleRebuild(40), true);
  $('canvas')?.addEventListener('pointerup', () => scheduleRebuild(30));
  $('canvas')?.addEventListener('pointercancel', () => scheduleRebuild(30));
  for (const id of ['addPoint','deletePoint','resetPoints','removeOrphan']) $(''+id)?.addEventListener('click', () => scheduleRebuild(20));
  window.addEventListener('resize', resizeRenderer);

  setView('2d');
  initRenderer();
  render();
})();

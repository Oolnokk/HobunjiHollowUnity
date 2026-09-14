'use strict';
// This tool has its own before/after jigsaw comparison. Do not let the generic
// Tool Hub parity wrapper replace these materials/UVs after the preview builds.
window.__hobunjiToolTerrainParityBootstrap = true;

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

  let activeMap = null; // Map whose actual BorderTerrain geometry is being previewed.
  let activeConfig = null; // Resolved BackgroundScenery config, including authored jigsaw slots.
  let renderer = null;
  let scene = null;
  let camera = null;
  let controls = null;
  let terrainRecords = [];
  let buildToken = 0;
  let rebuildTimer = 0;
  let viewMode = 'compare';
  let needsFit = true;
  let terrainConfig = null;
  let lastAuthorRevision = 0; // Visible proof that the latest control revision reached the rebuild.
  const textureCache = new Map(); // Canonical URL -> Promise<THREE.Texture|null>.
  const textureErrors = new Map(); // Canonical URL -> human-readable load failure.

  const originalResolveConfig = Core.resolveConfig.bind(Core);
  Core.resolveConfig = function scenery3dResolveConfig(map) {
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

  async function loadTerrainConfig() {
    if (terrainConfig) return terrainConfig;
    try {
      const response = await fetch('../../config/maps/terrain-materials.json', { cache:'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      terrainConfig = await response.json();
    } catch (error) {
      terrainConfig = { byMap:{} };
      console.warn('[boundary-preview] terrain-materials.json failed:', error);
    }
    return terrainConfig;
  }

  function terrainEntry(kind) {
    const byMap = terrainConfig?.byMap || {};
    const id = activeMap?.id || activeMap?.mapId || 'map_hobunji_town';
    return byMap[id]?.[kind] || byMap['*']?.[kind] || null;
  }

  function colorFor(kind) {
    const authored = terrainEntry(kind)?.fillColor;
    const fallback = kind === 'grass' ? '#2f7021' : '#6a6460';
    try { return new THREE.Color(authored || fallback); }
    catch (_) { return new THREE.Color(fallback); }
  }

  function loadTexture(path) {
    const url = canonicalTextureUrl(path);
    if (!url) return Promise.resolve(null);
    if (textureCache.has(url)) return textureCache.get(url);
    const promise = new Promise(resolve => {
      new THREE.TextureLoader().load(url, texture => {
        texture.encoding = THREE.sRGBEncoding;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
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

  function worldUvTexture(source, entry) {
    if (!source) return null;
    const texture = source.clone();
    texture.encoding = THREE.sRGBEncoding;
    texture.offset.set(0,0);
    texture.rotation = 0;
    texture.center?.set?.(0,0);
    if (Array.isArray(entry?.stretch) && entry.stretch.length >= 2) {
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.repeat.set(1 / Math.max(0.001, Number(entry.stretch[0]) || 1), 1 / Math.max(0.001, Number(entry.stretch[1]) || 1));
    } else {
      const tile = Math.max(0.001, Number(entry?.tileSize) || 1);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(1 / tile, 1 / tile);
    }
    texture.needsUpdate = true;
    return texture;
  }

  function makeWorldMaterial(texture, kind) {
    const material = new THREE.MeshStandardMaterial({
      map: worldUvTexture(texture, terrainEntry(kind)),
      color: colorFor(kind),
      roughness:0.96,
      metalness:0,
      side:THREE.DoubleSide,
    });
    material.name = `boundary_preview_${kind}`;
    material.userData = Object.assign({}, material.userData, { terrainKey:kind, previewOwned:true });
    return material;
  }

  function uvDiagnosticMaterial() {
    const material = new THREE.ShaderMaterial({
      side:THREE.DoubleSide,
      vertexShader:'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:'varying vec2 vUv; void main(){vec2 q=fract(vUv); vec2 g=abs(fract(vUv*8.0)-0.5); float line=1.0-smoothstep(0.44,0.49,max(g.x,g.y)); vec3 base=vec3(q.x,q.y,0.32+0.38*(1.0-q.x)); gl_FragColor=vec4(mix(base,vec3(1.0),line*0.34),1.0);}',
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

  function addContextFloor(map) {
    const geometry = new THREE.PlaneGeometry(map.cols, map.rows, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(map.cols/2, -0.018, map.rows/2);
    const material = new THREE.MeshStandardMaterial({ color:0x183b24, roughness:1, metalness:0 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'PreviewPlayableContext';
    mesh.userData.terrainJigsawIgnore = true;
    scene.add(mesh);

    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(map.cols, 0.02, map.rows)),
      new THREE.LineBasicMaterial({ color:0x8aa2b7, transparent:true, opacity:0.35 })
    );
    border.position.set(map.cols/2, 0, map.rows/2);
    scene.add(border);
  }

  function disposeMaterial(material) {
    if (!material) return;
    if (Array.isArray(material)) { material.forEach(disposeMaterial); return; }
    try { if (material.userData?.previewOwned || material.userData?.terrainJigsawMaterial) material.map?.dispose?.(); } catch (_) {}
    try { material.dispose?.(); } catch (_) {}
  }

  function disposeScene() {
    if (!scene) return;
    const seenGeometry = new Set();
    const seenMaterial = new Set();
    for (const record of terrainRecords) {
      for (const geometry of [record.ordinaryGeometry, record.jigsawGeometry]) {
        if (geometry && !seenGeometry.has(geometry)) { seenGeometry.add(geometry); try { geometry.dispose?.(); } catch (_) {} }
      }
      for (const material of [record.ordinaryMaterial, record.jigsawMaterial, record.debugMaterial]) {
        if (material && !seenMaterial.has(material)) { seenMaterial.add(material); disposeMaterial(material); }
      }
    }
    scene.traverse(object => {
      if (object.geometry && !seenGeometry.has(object.geometry)) { seenGeometry.add(object.geometry); try { object.geometry.dispose?.(); } catch (_) {} }
      if (object.material && !seenMaterial.has(object.material)) { seenMaterial.add(object.material); disposeMaterial(object.material); }
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

  function installRecord(slotName, mesh) {
    if (!jigsawEnabled()) return null;
    const api = window.TerrainJigsawUV;
    if (!api?.bakeMesh || !mesh?.material?.map) return null;
    const ordinaryGeometry = mesh.geometry;
    const ordinaryMaterial = mesh.material;
    const temp = new THREE.Mesh(ordinaryGeometry.clone(), ordinaryMaterial);
    const settings = slotSettings(slotName);
    const stats=api.bakeMesh(temp,{...settings,force:true,disposeSource:true});
    if (!stats) return null;
    const record = {
      mesh, slotName, ordinaryGeometry, ordinaryMaterial,
      jigsawGeometry:temp.geometry, jigsawMaterial:temp.material,
      debugMaterial:uvDiagnosticMaterial(), stats, settings:{...settings},
    };
    terrainRecords.push(record);
    return record;
  }

  function settingsSummary() {
    const grass = slotSettings('grass');
    const cliff = slotSettings('cliff');
    return `grass ${grass.edgePx}px/${grass.edgeWorldWidth.toFixed(2)}u · cliff ${cliff.edgePx}px/${cliff.edgeWorldWidth.toFixed(2)}u`;
  }

  function textureSummary(grassTexture, cliffTexture, grassPath, cliffPath) {
    const parts = [];
    parts.push(`grass PNG ${grassTexture ? 'OK' : 'FAILED'} (${canonicalTextureUrl(grassPath) || 'none'})`);
    parts.push(`cliff PNG ${cliffTexture ? 'OK' : 'FAILED'} (${canonicalTextureUrl(cliffPath) || 'none'})`);
    return parts.join(' · ');
  }

  async function rebuild() {
    clearTimeout(rebuildTimer);
    initRenderer();
    if (!activeMap || !activeConfig) { setStatus('Load a map to build the 3D scenery preview.'); return; }
    const token = ++buildToken;
    setStatus(`Loading terrain PNGs before geometry bake · ${settingsSummary()}…`);
    await loadTerrainConfig();

    const stretch = activeConfig.materialStretch || {};
    const grassSlot = stretch.slots?.grass || { texture:'assets/textures/wavy_surface.png' };
    const cliffSlot = stretch.slots?.cliff || { texture:'assets/textures/carved_smooth.png' };
    const grassPath = grassSlot.texture || 'assets/textures/wavy_surface.png';
    const cliffPath = cliffSlot.texture || 'assets/textures/carved_smooth.png';
    const [grassTexture, cliffTexture] = await Promise.all([loadTexture(grassPath), loadTexture(cliffPath)]);
    if (token !== buildToken) return;

    disposeScene();
    scene = new THREE.Scene();
    scene.userData.terrainJigsawDisableAuto = true;
    scene.userData.toolTerrainParityDisable = true;
    scene.background = new THREE.Color(0x08111a);
    scene.add(new THREE.HemisphereLight(0xbdd6ff,0x203019,1.25));
    const sun = new THREE.DirectionalLight(0xfff2d1,1.55); sun.position.set(activeMap.cols*.18,42,activeMap.rows*.25); scene.add(sun);
    const fill = new THREE.DirectionalLight(0x8fb7dc,.40); fill.position.set(activeMap.cols+18,16,activeMap.rows+18); scene.add(fill);
    addContextFloor(activeMap);

    const grassOrd = makeWorldMaterial(grassTexture, 'grass');
    const cliffOrd = makeWorldMaterial(cliffTexture, 'cliff');
    const pathMat = new THREE.MeshStandardMaterial({ color:0x9f8357, roughness:1, metalness:0, side:THREE.DoubleSide });
    pathMat.userData.previewOwned = true;

    const deps = {
      NORMAL_TOP:0,
      PLATEAU_UNIT:1,
      TileType:{ GRASS:'grass', PATH:'path' },
      clamp,
      getTownScene:()=>scene,
      getTownZone:()=>activeMap,
      resolveTileMat:(_mapId,type)=>type==='grass' ? grassOrd : pathMat,
      resolveCliffMat:()=>cliffOrd,
      getGrassBillboardMat:()=>null,
      getGrassEnabled:()=>false,
      grassBladeGeo:null,
      mbRng:seeded,
      markOutline:()=>{},
    };

    try {
      BorderTerrain.init(deps);
      BorderTerrain.buildTownBorderTerrain();
    } catch (error) {
      setStatus(`3D build failed: ${error.message}`);
      console.error(error);
      return;
    }

    let candidates = 0;
    scene.traverse(object => {
      if (!object.isMesh) return;
      if (object.material === grassOrd) { candidates++; installRecord('grass', object); }
      else if (object.material === cliffOrd) { candidates++; installRecord('cliff', object); }
    });

    applyVariant(viewMode==='protected' ? 'jigsaw' : viewMode==='heatmap' ? 'heatmap' : 'ordinary');
    if (needsFit) fitCamera();
    needsFit = false;

    const islands = terrainRecords.reduce((sum,record)=>sum+(record.stats?.islands||0),0);
    const triangles = terrainRecords.reduce((sum,record)=>sum+(record.stats?.triangles||0),0);
    const textures = textureSummary(grassTexture, cliffTexture, grassPath, cliffPath);
    if (!jigsawEnabled()) {
      setStatus(`JIGSAW DISABLED · ${candidates} terrain candidate${candidates===1?'':'s'} · ${textures} · ${settingsSummary()} · author rev ${lastAuthorRevision}`);
    } else if (!terrainRecords.length) {
      setStatus(`JIGSAW ENABLED but 0 eligible textured meshes baked (${candidates} candidates) · ${textures} · ${settingsSummary()} · author rev ${lastAuthorRevision}`);
    } else {
      setStatus(`${terrainRecords.length}/${candidates} terrain meshes baked · ${islands} connected islands · ${triangles.toLocaleString()} triangles · ${textures} · ${settingsSummary()} · author rev ${lastAuthorRevision}`);
    }
  }

  function setWire(material, enabled) {
    const materials = Array.isArray(material) ? material : [material];
    for (const item of materials) if (item && 'wireframe' in item) { item.wireframe = enabled; item.needsUpdate = true; }
  }

  function applyVariant(name) {
    const wire = !!$('preview3dWire')?.checked;
    const canJigsaw = jigsawEnabled();
    for (const record of terrainRecords) {
      if (canJigsaw && name === 'jigsaw') { record.mesh.geometry = record.jigsawGeometry; record.mesh.material = record.jigsawMaterial; }
      else if (canJigsaw && name === 'heatmap') { record.mesh.geometry = record.jigsawGeometry; record.mesh.material = record.debugMaterial; }
      else { record.mesh.geometry = record.ordinaryGeometry; record.mesh.material = record.ordinaryMaterial; }
      setWire(record.mesh.material, wire);
    }
  }

  function fitCamera() {
    if (!activeMap || !camera) return;
    const depth = Math.max(6, Math.round(Number(activeConfig?.borderDepthTiles) || 18));
    const center = new THREE.Vector3(activeMap.cols/2,1.35,activeMap.rows/2);
    const radius = Math.max(activeMap.cols+depth*2,activeMap.rows+depth*2)*.62;
    camera.position.set(center.x+radius*.72,center.y+radius*.55,center.z+radius*.88);
    camera.near = Math.max(.05,radius/800);
    camera.far = Math.max(300,radius*8);
    camera.updateProjectionMatrix();
    controls?.target.copy(center);
    controls?.update();
  }

  function setStatus(text) { if ($('preview3dStatus')) $('preview3dStatus').textContent = text; }
  function scheduleRebuild(delay=140) { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuild, delay); }

  function resizeRenderer() {
    if (!renderer) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1,Math.round(rect.width));
    const height = Math.max(1,Math.round(rect.height));
    const dpr = Math.min(2,window.devicePixelRatio||1);
    if (canvas.width !== Math.round(width*dpr) || canvas.height !== Math.round(height*dpr)) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(width,height,false);
    }
  }

  function renderViewport(x,y,width,height,variant) {
    if (!scene || !camera || width < 2 || height < 2) return;
    applyVariant(variant);
    renderer.setViewport(x,y,width,height);
    renderer.setScissor(x,y,width,height);
    camera.aspect = width/height;
    camera.updateProjectionMatrix();
    renderer.render(scene,camera);
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
      const left = Math.floor(width/2);
      renderViewport(0,0,left,height,'ordinary');
      renderViewport(left,0,width-left,height,'jigsaw');
    } else {
      renderViewport(0,0,width,height,viewMode==='protected'?'jigsaw':viewMode==='heatmap'?'heatmap':'ordinary');
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
    left.textContent = 'CURRENT WORLD UV';
    right.textContent = 'JIGSAW SURFACE UV';
  }

  function relabelModeUi() {
    const mode = $('preview3dMode');
    if (!mode) return;
    for (const option of mode.options) {
      if (option.value === 'compare') option.textContent = 'Current vs jigsaw';
      else if (option.value === 'protected') option.textContent = 'Jigsaw only';
      else if (option.value === 'ordinary') option.textContent = 'Current only';
      else if (option.value === 'heatmap') option.textContent = 'Jigsaw UV diagnostic';
    }
  }

  function setView(which) {
    const is3d = which === '3d';
    host.style.display = is3d ? 'block' : 'none';
    $('canvas').style.display = is3d ? 'none' : 'block';
    $('hud').style.display = is3d ? 'none' : 'flex';
    $('legend').style.display = is3d ? 'none' : 'block';
    $('view2DBtn')?.classList.toggle('act',!is3d);
    $('view3DBtn')?.classList.toggle('act',is3d);
    if (is3d) { initRenderer(); resizeRenderer(); if (!scene) scheduleRebuild(0); }
  }

  $('view2DBtn')?.addEventListener('click',()=>setView('2d'));
  $('view3DBtn')?.addEventListener('click',()=>setView('3d'));
  $('preview3dMode')?.addEventListener('change',event=>{ viewMode=event.target.value; updateCompareLabels(); });
  $('preview3dWire')?.addEventListener('change',()=>applyVariant(viewMode==='protected'?'jigsaw':viewMode==='heatmap'?'heatmap':'ordinary'));
  $('preview3dFit')?.addEventListener('click',fitCamera);
  $('preview3dRebuild')?.addEventListener('click',()=>scheduleRebuild(0));
  window.addEventListener('hobunji-jigsaw-author-change',event=>{
    lastAuthorRevision = Number(event?.detail?.revision) || lastAuthorRevision;
    if (event?.detail?.reason === 'texture' || event?.detail?.reason === 'reset') {
      textureCache.clear(); // Only path/reset edits need to invalidate decoded PNG promises; edge sliders reuse the loaded images.
    }
    scheduleRebuild(45);
  });
  $('sideScroll')?.addEventListener('input',event=>{
    if (event.target?.id === 'stretchMode' || event.target?.id === 'stretchSlot') return;
    scheduleRebuild(150);
  },true);
  $('sideScroll')?.addEventListener('change',()=>scheduleRebuild(35),true);
  $('canvas')?.addEventListener('pointerup',()=>scheduleRebuild(30));
  $('canvas')?.addEventListener('pointercancel',()=>scheduleRebuild(30));
  for (const id of ['addPoint','deletePoint','resetPoints','removeOrphan']) $(id)?.addEventListener('click',()=>scheduleRebuild(20));
  window.addEventListener('resize',resizeRenderer);

  relabelModeUi();
  setView('2d');
  initRenderer();
  render();
})();

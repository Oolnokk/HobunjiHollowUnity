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
  let terrainRecords = [];
  let buildToken = 0;
  let rebuildTimer = 0;
  let viewMode = 'compare';
  let needsFit = true;
  let terrainConfig = null;
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
    if (terrainConfig) return terrainConfig;
    try {
      const r = await fetch('../../config/maps/terrain-materials.json');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      terrainConfig = await r.json();
    } catch (_) {
      terrainConfig = { byMap:{} };
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

  function loadTexture(path) {
    const url = assetUrl(path);
    if (!url) return Promise.resolve(null);
    if (textureCache.has(url)) return textureCache.get(url);
    const promise = new Promise(resolve => {
      new THREE.TextureLoader().load(url, tex => {
        tex.encoding = THREE.sRGBEncoding;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        resolve(tex);
      }, undefined, () => resolve(null));
    });
    textureCache.set(url, promise);
    return promise;
  }

  function worldUvTexture(source, entry) {
    if (!source) return null;
    const tex = source.clone();
    tex.encoding = THREE.sRGBEncoding;
    tex.offset.set(0,0);
    tex.rotation = 0;
    if (tex.center) tex.center.set(0,0);
    if (Array.isArray(entry?.stretch) && entry.stretch.length >= 2) {
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.repeat.set(1 / Math.max(0.001, Number(entry.stretch[0]) || 1), 1 / Math.max(0.001, Number(entry.stretch[1]) || 1));
    } else {
      const tile = Math.max(0.001, Number(entry?.tileSize) || 1);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(1/tile, 1/tile);
    }
    tex.needsUpdate = true;
    return tex;
  }

  function makeWorldMaterial(tex, kind) {
    return new THREE.MeshStandardMaterial({
      map: worldUvTexture(tex, terrainEntry(kind)),
      color: colorFor(kind), roughness:0.96, metalness:0, side:THREE.DoubleSide,
    });
  }

  function uvDiagnosticMaterial() {
    const mat = new THREE.ShaderMaterial({
      side:THREE.DoubleSide,
      vertexShader:'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:'varying vec2 vUv; void main(){vec2 q=fract(vUv); vec2 g=abs(fract(vUv*8.0)-0.5); float line=1.0-smoothstep(0.44,0.49,max(g.x,g.y)); vec3 base=vec3(q.x,q.y,0.32+0.38*(1.0-q.x)); gl_FragColor=vec4(mix(base,vec3(1.0),line*0.34),1.0);}',
    });
    mat.userData.previewOwned = true;
    return mat;
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
    m.userData.terrainJigsawIgnore = true;
    scene.add(m);

    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(map.cols, 0.02, map.rows)),
      new THREE.LineBasicMaterial({ color:0x8aa2b7, transparent:true, opacity:0.35 })
    );
    border.position.set(map.cols/2, 0, map.rows/2);
    scene.add(border);
  }

  function disposeMaterial(m) {
    if (!m) return;
    if (Array.isArray(m)) { m.forEach(disposeMaterial); return; }
    try { if (m.userData?.previewOwned || m.userData?.terrainJigsawMaterial) m.map?.dispose?.(); } catch (_) {}
    try { m.dispose?.(); } catch (_) {}
  }

  function disposeScene() {
    if (!scene) return;
    const seenGeo=new Set(),seenMat=new Set();
    for (const r of terrainRecords) {
      for (const g of [r.ordinaryGeometry,r.jigsawGeometry]) if(g&&!seenGeo.has(g)){seenGeo.add(g);try{g.dispose?.();}catch(_){}}
      for (const m of [r.ordinaryMaterial,r.jigsawMaterial,r.debugMaterial]) if(m&&!seenMat.has(m)){seenMat.add(m);disposeMaterial(m);}
    }
    scene.traverse(o=>{
      if(o.geometry&&!seenGeo.has(o.geometry)){seenGeo.add(o.geometry);try{o.geometry.dispose?.();}catch(_){}}
      if(o.material&&!seenMat.has(o.material)){seenMat.add(o.material);disposeMaterial(o.material);}
    });
    terrainRecords=[];scene=null;
  }

  function slotSettings(slotName) {
    const stretch=activeConfig?.materialStretch;
    const s=stretch?.slots?.[slotName];
    return {
      edgePx: clamp(Number(s?.protectedEdgePx ?? 16),0,256),
      edgeWorldWidth: clamp(Number(s?.edgeWorldWidth ?? 0.5),0.05,8),
    };
  }

  function installRecord(slotName, mesh) {
    const api=window.TerrainJigsawUV;
    if(!api?.bakeMesh) return null;
    const ordinaryGeometry=mesh.geometry;
    const ordinaryMaterial=mesh.material;
    const temp=new THREE.Mesh(ordinaryGeometry.clone(), ordinaryMaterial);
    const settings=slotSettings(slotName);
    const stats=api.bakeMesh(temp,{...settings,force:true,disposeSource:true});
    if(!stats)return null;
    const record={
      mesh,slotName,ordinaryGeometry,ordinaryMaterial,
      jigsawGeometry:temp.geometry,jigsawMaterial:temp.material,
      debugMaterial:uvDiagnosticMaterial(),stats,
    };
    terrainRecords.push(record);
    return record;
  }

  async function rebuild() {
    clearTimeout(rebuildTimer);
    initRenderer();
    if (!activeMap || !activeConfig) { setStatus('Load a map to build the 3D scenery preview.'); return; }
    const token=++buildToken;
    setStatus('Building game boundary geometry + connected surface islands…');
    await loadTerrainConfig();
    const stretch=activeConfig.materialStretch || {};
    const grassSlot=stretch.slots?.grass || {texture:'assets/textures/wavy_surface.png'};
    const cliffSlot=stretch.slots?.cliff || {texture:'assets/textures/carved_smooth.png'};
    const [grassTex,cliffTex]=await Promise.all([loadTexture(grassSlot.texture),loadTexture(cliffSlot.texture)]);
    if(token!==buildToken)return;

    disposeScene();
    scene=new THREE.Scene();
    // The shared runtime wrapper must not auto-bake this scene: this preview
    // deliberately keeps both before/after variants of the same geometry.
    scene.userData.terrainJigsawDisableAuto=true;
    scene.background=new THREE.Color(0x08111a);
    scene.add(new THREE.HemisphereLight(0xbdd6ff,0x203019,1.25));
    const sun=new THREE.DirectionalLight(0xfff2d1,1.55);sun.position.set(activeMap.cols*.18,42,activeMap.rows*.25);scene.add(sun);
    const fill=new THREE.DirectionalLight(0x8fb7dc,.40);fill.position.set(activeMap.cols+18,16,activeMap.rows+18);scene.add(fill);
    addContextFloor(activeMap);

    const grassOrd=makeWorldMaterial(grassTex,'grass');grassOrd.userData.previewOwned=true;
    const cliffOrd=makeWorldMaterial(cliffTex,'cliff');cliffOrd.userData.previewOwned=true;
    const pathMat=new THREE.MeshStandardMaterial({color:0x9f8357,roughness:1,metalness:0,side:THREE.DoubleSide});pathMat.userData.previewOwned=true;

    const deps={
      NORMAL_TOP:0, PLATEAU_UNIT:1,
      TileType:{GRASS:'grass',PATH:'path'}, clamp,
      getTownScene:()=>scene, getTownZone:()=>activeMap,
      resolveTileMat:(_mapId,type)=>type==='grass'?grassOrd:pathMat,
      resolveCliffMat:()=>cliffOrd,
      getGrassBillboardMat:()=>null, getGrassEnabled:()=>false, grassBladeGeo:null,
      mbRng:seeded, markOutline:()=>{},
    };
    try { BorderTerrain.init(deps); BorderTerrain.buildTownBorderTerrain(); }
    catch(e){setStatus(`3D build failed: ${e.message}`);console.error(e);return;}

    scene.traverse(o=>{
      if(!o.isMesh)return;
      if(o.material===grassOrd)installRecord('grass',o);
      else if(o.material===cliffOrd)installRecord('cliff',o);
    });
    applyVariant(viewMode==='protected'?'jigsaw':viewMode==='heatmap'?'heatmap':'ordinary');
    if(needsFit)fitCamera();needsFit=false;
    const islands=terrainRecords.reduce((n,r)=>n+(r.stats?.islands||0),0);
    const tris=terrainRecords.reduce((n,r)=>n+(r.stats?.triangles||0),0);
    setStatus(`${terrainRecords.length} terrain mesh${terrainRecords.length===1?'':'es'} · ${islands} connected surface island${islands===1?'':'s'} · ${tris.toLocaleString()} triangles · shared runtime jigsaw baker`);
  }

  function setWire(material,on){
    const mats=Array.isArray(material)?material:[material];
    for(const m of mats)if(m&&'wireframe'in m){m.wireframe=on;m.needsUpdate=true;}
  }

  function applyVariant(name) {
    const wire=!!$('preview3dWire')?.checked;
    for(const r of terrainRecords){
      if(name==='jigsaw'){r.mesh.geometry=r.jigsawGeometry;r.mesh.material=r.jigsawMaterial;}
      else if(name==='heatmap'){r.mesh.geometry=r.jigsawGeometry;r.mesh.material=r.debugMaterial;}
      else{r.mesh.geometry=r.ordinaryGeometry;r.mesh.material=r.ordinaryMaterial;}
      setWire(r.mesh.material,wire);
    }
  }

  function fitCamera() {
    if(!activeMap||!camera)return;
    const depth=Math.max(6,Math.round(Number(activeConfig?.borderDepthTiles)||18));
    const center=new THREE.Vector3(activeMap.cols/2,1.35,activeMap.rows/2);
    const radius=Math.max(activeMap.cols+depth*2,activeMap.rows+depth*2)*.62;
    camera.position.set(center.x+radius*.72,center.y+radius*.55,center.z+radius*.88);
    camera.near=Math.max(.05,radius/800);camera.far=Math.max(300,radius*8);camera.updateProjectionMatrix();
    controls?.target.copy(center);controls?.update();
  }

  function setStatus(text){if($('preview3dStatus'))$('preview3dStatus').textContent=text;}
  function scheduleRebuild(delay=140){clearTimeout(rebuildTimer);rebuildTimer=setTimeout(rebuild,delay);}
  function resizeRenderer(){if(!renderer)return;const r=canvas.getBoundingClientRect(),w=Math.max(1,Math.round(r.width)),h=Math.max(1,Math.round(r.height)),dpr=Math.min(2,window.devicePixelRatio||1);if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){renderer.setPixelRatio(dpr);renderer.setSize(w,h,false);}}

  function renderViewport(x,y,w,h,variant){
    if(!scene||!camera||w<2||h<2)return;applyVariant(variant);renderer.setViewport(x,y,w,h);renderer.setScissor(x,y,w,h);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.render(scene,camera);
  }

  function render(){
    requestAnimationFrame(render);if(!renderer||!scene||host.style.display==='none')return;controls?.update();resizeRenderer();
    const w=canvas.clientWidth||1,h=canvas.clientHeight||1;renderer.setScissorTest(true);
    if(viewMode==='compare'){const left=Math.floor(w/2);renderViewport(0,0,left,h,'ordinary');renderViewport(left,0,w-left,h,'jigsaw');}
    else renderViewport(0,0,w,h,viewMode==='protected'?'jigsaw':viewMode==='heatmap'?'heatmap':'ordinary');
    renderer.setScissorTest(false);updateCompareLabels();
  }

  function updateCompareLabels(){
    const l=$('preview3dLeftLabel'),r=$('preview3dRightLabel');if(!l||!r)return;
    const compare=viewMode==='compare';l.style.display=compare?'':'none';r.style.display=compare?'':'none';
    l.textContent='CURRENT WORLD UV';r.textContent='JIGSAW SURFACE UV';
  }

  function relabelModeUi(){
    const mode=$('preview3dMode');if(!mode)return;
    for(const o of mode.options){if(o.value==='compare')o.textContent='Current vs jigsaw';else if(o.value==='protected')o.textContent='Jigsaw only';else if(o.value==='ordinary')o.textContent='Current only';else if(o.value==='heatmap')o.textContent='Jigsaw UV diagnostic';}
  }

  function setView(which){
    const is3d=which==='3d';host.style.display=is3d?'block':'none';$('canvas').style.display=is3d?'none':'block';$('hud').style.display=is3d?'none':'flex';$('legend').style.display=is3d?'none':'block';
    $('view2DBtn')?.classList.toggle('act',!is3d);$('view3DBtn')?.classList.toggle('act',is3d);
    if(is3d){initRenderer();resizeRenderer();if(!scene)scheduleRebuild(0);}
  }

  $('view2DBtn')?.addEventListener('click',()=>setView('2d'));
  $('view3DBtn')?.addEventListener('click',()=>setView('3d'));
  $('preview3dMode')?.addEventListener('change',e=>{viewMode=e.target.value;updateCompareLabels();});
  $('preview3dWire')?.addEventListener('change',()=>applyVariant(viewMode==='protected'?'jigsaw':viewMode==='heatmap'?'heatmap':'ordinary'));
  $('preview3dFit')?.addEventListener('click',fitCamera);
  $('preview3dRebuild')?.addEventListener('click',()=>scheduleRebuild(0));
  window.addEventListener('hobunji-jigsaw-author-change',()=>scheduleRebuild(80));
  $('sideScroll')?.addEventListener('input',e=>{if(e.target?.id==='stretchMode'||e.target?.id==='stretchSlot')return;scheduleRebuild(170);},true);
  $('sideScroll')?.addEventListener('change',()=>scheduleRebuild(40),true);
  $('canvas')?.addEventListener('pointerup',()=>scheduleRebuild(30));
  $('canvas')?.addEventListener('pointercancel',()=>scheduleRebuild(30));
  for(const id of ['addPoint','deletePoint','resetPoints','removeOrphan'])$(id)?.addEventListener('click',()=>scheduleRebuild(20));
  window.addEventListener('resize',resizeRenderer);

  relabelModeUi();setView('2d');initRenderer();render();
})();
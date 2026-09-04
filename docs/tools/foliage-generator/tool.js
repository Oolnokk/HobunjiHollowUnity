(() => {
  'use strict';

  const T = window.THREE;
  const ROOT_CFG = window.HOBUNJI_ROOT_TOTEM_CONFIG;
  const viewport = document.getElementById('viewport');
  const status = document.getElementById('status');
  const diagnostics = document.getElementById('diagnostics');
  const errorBox = document.getElementById('errorBox');
  const rootControls = document.getElementById('rootTotemControls');

  if (!T || !ROOT_CFG || !window.FoliageGenerator || !window.StructuralWrap || !window.RootTotemPlants || !window.SpriteRecolor || !window.PerpRotation || !window.DeadzoneBillboard) {
    const missing = [
      !T && 'THREE', !ROOT_CFG && 'HOBUNJI_ROOT_TOTEM_CONFIG',
      !window.FoliageGenerator && 'FoliageGenerator', !window.StructuralWrap && 'StructuralWrap',
      !window.RootTotemPlants && 'RootTotemPlants', !window.SpriteRecolor && 'SpriteRecolor',
      !window.PerpRotation && 'PerpRotation', !window.DeadzoneBillboard && 'DeadzoneBillboard',
    ].filter(Boolean).join(', ');
    errorBox.style.display = 'block'; errorBox.textContent = `Tool dependencies failed to load: ${missing}`;
    status.textContent = `Cannot initialize — missing ${missing}`; return;
  }

  const canonical = ROOT_CFG.canonicalRecipe;
  const defaults = ROOT_CFG.defaults;
  const limits = ROOT_CFG.limits;
  const $ = id => document.getElementById(id);
  const setRange = (id, range, step, value) => {
    const input = $(id); input.min = String(range.min); input.max = String(range.max); input.step = String(step); input.value = String(value);
  };
  $('seed').value = String(canonical.seedU32);
  $('sourceTree').value = canonical.sourceTree;
  setRange('treeCount', limits.treeCount, 1, canonical.treeCount);
  setRange('height', limits.height, 0.05, canonical.height);
  setRange('turns', limits.turns, 0.05, canonical.turns);
  setRange('radiusStart', limits.radius, 0.01, canonical.radiusStart);
  setRange('radiusEnd', limits.radius, 0.01, canonical.radiusEnd);
  setRange('crossStart', limits.crossSectionScale, 0.01, canonical.crossSectionScaleStart);
  setRange('crossEnd', limits.crossSectionScale, 0.01, canonical.crossSectionScaleEnd);
  setRange('hostSway', limits.hostSway, 0.01, canonical.hostSway);
  const note = $('rootTotemConfigNote');
  if (note) note.textContent = `Canonical values loaded from config/root-totem-config.js (seed ${canonical.seedU32}, ${canonical.sourceTree}, ${canonical.treeCount} trees). World Root Totems use that config directly; these controls are an experimentation lab.`;

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(42, 1, 0.01, 200);
  camera.position.set(5, 4, 6);
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  viewport.appendChild(renderer.domElement);
  const controls = new T.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.target.set(0, 1.5, 0);
  scene.add(new T.HemisphereLight(0xe7f4ff, 0x314124, 1.15));
  const keyLight = new T.DirectionalLight(0xffffff, 1.05); keyLight.position.set(4, 8, 5); scene.add(keyLight);
  const grid = new T.GridHelper(12, 24, 0x3e5566, 0x203140); grid.material.transparent = true; grid.material.opacity = 0.45; scene.add(grid);

  let currentModel = null, rebuildTimer = null, lastRecipe = null, lastStats = null, hasAutoFramed = false;
  const sliderIds = [
    ['height','heightOut',2], ['turns','turnsOut',2], ['radiusStart','radiusStartOut',2],
    ['radiusEnd','radiusEndOut',2], ['crossStart','crossStartOut',2], ['crossEnd','crossEndOut',2], ['hostSway','hostSwayOut',2],
  ];
  const numericValue = id => Number($(id).value);
  const intValue = id => Math.floor(numericValue(id));
  function updateSliderOutputs() { for (const [i,o,d] of sliderIds) $(o).textContent = numericValue(i).toFixed(d); }

  function readRecipe() {
    const type = $('plantType').value, seed = numericValue('seed') >>> 0;
    if (type !== 'rootTotem') return { version: 1, type, seed };
    const rootTotemPlant = window.RootTotemPlants.normalizeConfig({
      ...defaults,
      sourceTree: $('sourceTree').value,
      treeCount: intValue('treeCount'), height: numericValue('height'), turns: numericValue('turns'),
      radiusStart: numericValue('radiusStart'), radiusEnd: numericValue('radiusEnd'),
      crossSectionScaleStart: numericValue('crossStart'), crossSectionScaleEnd: numericValue('crossEnd'), hostSway: numericValue('hostSway'),
    });
    return { version: 1, type, seed, rootTotemPlant };
  }

  function buildOrdinaryPlant(type, seed) {
    const col = seed % 100003, row = ((seed ^ 0x9e3779b9) >>> 0) % 100019;
    if (type === 'crownedPine') return window.FoliageGenerator.buildCrownedPineMesh(col, row);
    if (type === 'shadewood') return window.FoliageGenerator.buildShadewoodMesh(col, row);
    if (type === 'bush') return window.FoliageGenerator.buildWildernessBushMesh(col, row);
    if (type === 'stump') return window.FoliageGenerator.buildStumpMesh(col, row);
    throw new Error(`Unknown foliage type: ${type}`);
  }
  function buildFromRecipe(recipe) {
    return recipe.type === 'rootTotem'
      ? window.RootTotemPlants.buildRootTotemPlant({ ...recipe.rootTotemPlant, seedU32: recipe.seed })
      : buildOrdinaryPlant(recipe.type, recipe.seed);
  }

  function clearCurrentModel() {
    if (!currentModel) return;
    scene.remove(currentModel);
    if (currentModel.userData?.rootTotemPlant) {
      // Dispose only the bottle/rope suspension subtrees. The procedural tree
      // generator may return meshes/materials backed by shared runtime caches;
      // disposing the entire Root Totem here can invalidate later previews.
      const suspensions = [];
      currentModel.traverse((object) => {
        if (object.userData?.deadzoneSuspension) suspensions.push(object);
      });
      for (const suspension of suspensions) window.DeadzoneBillboard?.dispose?.(suspension);
    }
    currentModel = null;
  }
  function fitCameraToObject(object) {
    const box = new T.Box3().setFromObject(object); if (box.isEmpty()) return;
    const size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.5);
    const distance = (maxDim * 0.5) / Math.tan(T.MathUtils.degToRad(camera.fov) * 0.5) * 1.55;
    controls.target.copy(center); camera.position.copy(center).addScaledVector(new T.Vector3(1,.72,1).normalize(), distance);
    camera.near = Math.max(.01, distance / 200); camera.far = Math.max(100, distance * 20); camera.updateProjectionMatrix(); controls.update(); hasAutoFramed = true;
  }
  function renderDiagnostics(recipe, object) {
    lastStats = window.StructuralWrap.describeObject(object);
    diagnostics.textContent = JSON.stringify({ recipe, configSource: 'config/root-totem-config.js', structuralWrapVersion: window.StructuralWrap.version, measured: lastStats, rootTotemMeasuredAtBuild: object.userData?.rootTotemDiagnostics || null }, null, 2);
  }
  function rebuild(options = {}) {
    updateSliderOutputs(); rootControls.style.display = $('plantType').value === 'rootTotem' ? '' : 'none'; errorBox.style.display = 'none';
    try {
      const recipe = readRecipe(), started = performance.now(), object = buildFromRecipe(recipe);
      clearCurrentModel(); currentModel = object; lastRecipe = recipe; scene.add(currentModel);
      if (!hasAutoFramed || options.frameCamera === true) fitCameraToObject(currentModel);
      renderDiagnostics(recipe, currentModel);
      const elapsed = performance.now() - started;
      const treeNote = recipe.type === 'rootTotem' ? ` · 1 regular + ${Math.max(0, recipe.rootTotemPlant.treeCount - 1)} sequential wraps` : '';
      status.textContent = `${recipe.type} · seed ${recipe.seed}${treeNote}\n${lastStats.meshes} meshes · ${lastStats.vertices.toLocaleString()} vertices · ${lastStats.triangles.toLocaleString()} triangles · build ${elapsed.toFixed(1)} ms`;
    } catch (error) {
      console.error('[foliage generator tool] rebuild failed', error); errorBox.style.display = 'block'; errorBox.textContent = error?.stack || error?.message || String(error); status.textContent = `Build failed: ${error?.message || error}`; diagnostics.textContent = error?.stack || String(error);
    }
  }
  function scheduleRebuild() { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuild, 90); }
  const recipeText = () => JSON.stringify(lastRecipe || readRecipe(), null, 2);
  async function copyRecipe() {
    const text = recipeText();
    try { await navigator.clipboard.writeText(text); status.textContent = `${status.textContent.split('\n')[0]}\nRecipe copied to clipboard.`; }
    catch (_) { const ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.focus();ta.select();const ok=document.execCommand('copy');ta.remove();status.textContent=`${status.textContent.split('\n')[0]}\n${ok?'Recipe copied to clipboard.':'Clipboard unavailable; use Download JSON.'}`; }
  }
  function downloadRecipe() {
    const recipe = lastRecipe || readRecipe(), blob = new Blob([JSON.stringify(recipe,null,2)],{type:'application/json'}), url=URL.createObjectURL(blob), link=document.createElement('a');
    link.href=url;link.download=`${recipe.type||'foliage'}-${recipe.seed||0}.json`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),0);
  }
  function resize() { const r=viewport.getBoundingClientRect(),w=Math.max(1,Math.floor(r.width)),h=Math.max(1,Math.floor(r.height));renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix(); }

  $('plantType').addEventListener('change', rebuild); $('sourceTree').addEventListener('change', rebuild); $('seed').addEventListener('change', rebuild); $('treeCount').addEventListener('change', rebuild);
  for (const [inputId] of sliderIds) $(inputId).addEventListener('input', scheduleRebuild);
  $('rebuild').addEventListener('click', rebuild); $('randomizeSeed').addEventListener('click',()=>{$('seed').value=String((window.crypto?.getRandomValues?.(new Uint32Array(1))?.[0]??Math.floor(Math.random()*0xffffffff))>>>0);rebuild();});
  $('copyJson').addEventListener('click',copyRecipe);$('downloadJson').addEventListener('click',downloadRecipe);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(viewport); else window.addEventListener('resize',resize);
  window._foliageGeneratorBridge = { getRecipe:()=>JSON.parse(recipeText()), rebuild, frameCamera:()=>currentModel&&fitCameraToObject(currentModel), getDiagnostics:()=>({recipe:lastRecipe,stats:lastStats}), buildRootTotem:config=>window.RootTotemPlants.buildRootTotemPlant(config) };
  function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera);} updateSliderOutputs();resize();rebuild({frameCamera:true});animate();
})();

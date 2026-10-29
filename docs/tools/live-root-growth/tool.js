// Standalone, touch-friendly preview for the reusable LiveRootGrowth runtime.
// This editor owns its RAF; the game runtime updates instances through its existing scheduler.
(() => {
  'use strict';
  const T = window.THREE, growth = window.LiveRootGrowth, foliage = window.FoliageGenerator;
  const $ = id => document.getElementById(id); // Local authoring form lookup, never used by the game.
  const status = $('hud'), diagnostics = $('debug'), errorBox = $('errors');
  const trackedFields = ['seed','floorWidth','floorDepth','branchCount','strandLimit','radius',
    'branchRadius','floorDensity','targetDensity','floorLength','targetLength','bend','duration','showGuide'];
  const source = { kind:'demo', name:'Raised platform (demo)', data:null, file:null, model:null }; // Imported shape and serializable source metadata.
  let active = null, lastStatus = '', lastDebug = '', lastTimestamp = 0, pendingRecipe = null; // Instance/diagnostic state for this isolated preview.
  function reportError(error) {
    errorBox.style.display = 'block'; errorBox.textContent = error?.stack || error?.message || String(error);
    status.textContent = 'Growth preview error. Details are shown in the sidebar.';
  }
  if (!T || !growth || !foliage || !T.OrbitControls) {
    reportError(new Error('Missing THREE, OrbitControls, FoliageGenerator or LiveRootGrowth.'));
    return;
  }
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(48, 1, .08, 150);
  camera.position.set(9, 8, 11);
  const renderer = new T.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  $('render').appendChild(renderer.domElement);
  const orbit = new T.OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true; orbit.dampingFactor = .1; orbit.target.set(0, 1, 0);
  scene.add(new T.HemisphereLight(0xdcecff,0x33462d,1.5));
  const sun = new T.DirectionalLight(0xffefd6, 1.1);
  sun.position.set(6, 11, 7); scene.add(sun);
  const grid = new T.GridHelper(16, 32, 0x446076, 0x29424f);
  grid.material.transparent = true; grid.material.opacity = .25; scene.add(grid);
  const nodeMarkers = new T.Group(); // Optional bright source-node markers for inspecting a generated branch path on mobile.
  scene.add(nodeMarkers);

  function demoModel() {
    const group = new T.Group(), mesh = new T.Mesh(new T.BoxGeometry(2.8, .35, 2.8),
      new T.MeshStandardMaterial({color:0x907757}));
    mesh.name = 'Demo platform guide'; group.add(mesh); return group;
  }
  source.model = demoModel();

  function readRecipe() {
    const raw = {}; // Numeric form values are normalized by the shared runtime.
    for (const key of trackedFields) raw[key] = key === 'showGuide' ? $(key).checked : $(key).value;
    return growth.normalizeRecipe(raw);
  }
  function fillRecipe(raw) {
    const recipe = growth.normalizeRecipe(raw);
    for (const key of trackedFields) {
      if (key === 'showGuide') $(key).checked = recipe[key];
      else $(key).value = String(recipe[key]);
    }
  }
  function readPosition() {
    return new T.Vector3(...['targetX','targetY','targetZ'].map(id => {
      const number = Number($(id).value); return Number.isFinite(number) ? Math.max(-40, Math.min(40, number)) : 0;
    }));
  }
  function clearMarkers() {
    for (const child of [...nodeMarkers.children]) { child.geometry?.dispose(); child.material?.dispose(); nodeMarkers.remove(child); }
  }
  function rebuildMarkers() {
    clearMarkers();
    if (!active || !$('showGuide').checked) return;
    const material = new T.MeshBasicMaterial({color:0xffd58a,depthTest:false}); // Shared preview material for the low-count origin markers.
    for (const branch of active.branches) {
      const node = branch.geometry?.parameters?.path?.points?.[0];
      if (!node) continue;
      const dot = new T.Mesh(new T.SphereGeometry(.07,8,6),material);
      dot.position.copy(node); nodeMarkers.add(dot);
    }
  }
  function rebuild(keepProgress = true) {
    try {
      errorBox.style.display = 'none';
      const progress = keepProgress ? active?.getProgress() ?? 0 : 0;
      if (active) { active.dispose(); active = null; }
      const placed = source.model.clone(true); // Never mutate the reusable imported source's local geometry.
      placed.position.copy(readPosition()); // Purpose-agnostic target transform for platform, bridge or future door shapes.
      active = growth.create({THREE:T,foliage,recipe:readRecipe(),target:placed,progress});
      scene.add(active.group); rebuildMarkers();
      $('sourceName').textContent = source.name + ' · hidden geometry; growth-only preview';
      updateStatus(true);
      if (active.getDiagnostics().shapeStrands === 0) {
        errorBox.style.display = 'block';
        errorBox.textContent = 'The imported shape produced no final Wrap strands. Branches will grow, but the shape will remain sparse. Try a simple watertight furniture mesh, increase Shape path length or check its recognized surfaces.';
      }
    } catch (error) { reportError(error); }
  }
  function updateStatus(force = false) {
    if (!active) return;
    const info = active.getDiagnostics(), percent = Math.round(info.progress * 100);
    $('scrub').value = String(percent); $('progressLabel').textContent = percent+'%';
    const message = source.name + ' · ' + percent + '% grown\n' +
      info.branchCount + ' branches · ' + info.floorStrands + ' floor wraps · ' +
      info.shapeStrands + ' shape wraps';
    if (force || message !== lastStatus) { status.textContent = message; lastStatus = message; }
    const details = JSON.stringify({
      source:{kind:source.kind,name:source.name}, recipe:active.recipe,
      targetPosition:readPosition().toArray(), ...info
    }, null, 2);
    if (force || details !== lastDebug) { diagnostics.textContent = details; lastDebug = details; }
  }
  async function importModel(file) {
    if (!file || file.size > 20 * 1024 * 1024) throw new Error('Maximum import size is 20 MB.');
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext === 'glb') {
      if (!T.GLTFLoader) throw new Error('GLTFLoader did not load.');
      const buffer = await file.arrayBuffer();
      const gltf = await new Promise((resolve, reject) =>
        new T.GLTFLoader().parse(buffer, '', resolve, reject));
      if (!gltf.scene?.isObject3D) throw new Error('The GLB has no scene.');
      source.kind = 'glb'; source.name = file.name; source.data = null; source.file = file.name; source.model = gltf.scene;
    } else if (ext === 'json') {
      const json = JSON.parse(await file.text());
      if (!Array.isArray(json.parts)) throw new Error('Furniture JSON must contain the authored "parts" array.');
      if (!window.AuthoredFurniture?.buildGroup || !window.ProceduralFurniture?.buildPartMesh) {
        throw new Error('The existing furniture builder did not load.');
      }
      const model = window.AuthoredFurniture.buildGroup(json, 0x8b6540);
      if (!model.children.some(child => child.isMesh)) throw new Error('No geometric furniture parts were generated.');
      source.kind = 'authored-furniture'; source.name = file.name; source.data = json; source.file = file.name; source.model = model;
    } else throw new Error('Choose a GLB or Furniture + Avatar Author JSON.');
    $('targetY').value = source.kind === 'glb' ? '1.5' : '0.6';
    rebuild(false);
  }
  function exportedRecipe() {
    return {schema:'hobunji_live_root_growth.v1',
      recipe:readRecipe(), position:readPosition().toArray(),
      target:{kind:source.kind,file:source.file, ...(source.kind === 'authored-furniture' ? {furniture:source.data} : {})}
    }; // Authored JSON is self-contained; external GLB must be shipped separately.
  }
  function saveJson() {
    const json = JSON.stringify(exportedRecipe(),null,2);
    const url = URL.createObjectURL(new Blob([json],{type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'live-root-growth-recipe.json';
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  async function copyJson() {
    const json = JSON.stringify(exportedRecipe(),null,2);
    try { await navigator.clipboard.writeText(json); status.textContent += '\nRecipe copied.'; }
    catch {
      const area = document.createElement('textarea'); area.value = json;
      area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);
      area.focus();area.select();const ok=document.execCommand('copy');area.remove();
      status.textContent += ok?'\nRecipe copied.':'\nCopy unavailable. Use Export JSON.';
    }
  }
  async function importRecipe(file) {
    const json = JSON.parse(await file.text());
    if (json.schema !== 'hobunji_live_root_growth.v1') throw new Error('Not a live-root-growth recipe.');
    fillRecipe(json.recipe);
    if (Array.isArray(json.position) && json.position.length >= 3) ['targetX','targetY','targetZ'].forEach((id,i) => {
      const n = Number(json.position[i]); if (Number.isFinite(n)) $(id).value = String(n);
    });
    if (json.target?.kind === 'authored-furniture' && Array.isArray(json.target.furniture?.parts)) {
      const model = window.AuthoredFurniture.buildGroup(json.target.furniture,0x8b6540);
      source.model=model;source.data=json.target.furniture;source.kind='authored-furniture';
      source.name=json.target.file||'Embedded authored furniture';source.file=json.target.file||null;
    } else if (json.target?.kind === 'glb') {
      if (source.kind !== 'glb' || source.file !== json.target.file) {
        pendingRecipe = json;
        status.textContent = 'Recipe settings imported. Now import its separate GLB: '+(json.target.file||'unnamed GLB');
        return;
      }
    }
    pendingRecipe=null;rebuild(false);
  }
  function resize() {
    const rect=$('render').getBoundingClientRect(), w=Math.max(1,Math.floor(rect.width)),h=Math.max(1,Math.floor(rect.height));
    renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
  }
  $('rebuild').onclick=()=>rebuild();
  $('randomSeed').onclick=()=>{$('seed').value='ruin-'+String(window.crypto?.getRandomValues?.(new Uint32Array(1))?.[0] || Math.floor(Math.random()*0xffffffff));rebuild(false);};
  $('showGuide').onchange=()=>rebuild();
  $('extend').onclick=()=>active?.extend();
  $('retract').onclick=()=>active?.retract();
  $('pause').onclick=()=>active?.pause();
  $('scrub').oninput=()=>{active?.pause();active?.setProgress(Number($('scrub').value)/100);updateStatus(true);};
  $('reset').onclick=()=>{active?.pause();active?.setProgress(0);updateStatus(true);};
  $('full').onclick=()=>{active?.pause();active?.setProgress(1);updateStatus(true);};
  $('modelFile').onchange=async event=>{try{await importModel(event.target.files?.[0]);}
    catch(error){reportError(error);}finally{event.target.value='';}};
  $('recipeFile').onchange=async event=>{try{const file=event.target.files?.[0];if(file)await importRecipe(file);}
    catch(error){reportError(error);}finally{event.target.value='';}};
  $('download').onclick=saveJson;$('copy').onclick=()=>copyJson().catch(reportError);
  window._liveRootGrowthAuthorBridge = {getRecipe:exportedRecipe, rebuild, diagnostics:()=>active?.getDiagnostics()}; // Built-in mobile diagnostic hook for the Tools Hub.
  if (window.ResizeObserver) new ResizeObserver(resize).observe($('render'));else window.addEventListener('resize',resize);
  function frame(timestamp) {
    requestAnimationFrame(frame); // Isolated authoring preview, never part of the game's permanent frame scheduler.
    const delta=lastTimestamp?Math.max(0,Math.min(.05,(timestamp-lastTimestamp)/1000)):0;
    lastTimestamp=timestamp;active?.update(delta);orbit.update();renderer.render(scene,camera);
    if (active && (timestamp % 220 < 18)) updateStatus();
  }
  resize();rebuild(false);requestAnimationFrame(frame);
})();
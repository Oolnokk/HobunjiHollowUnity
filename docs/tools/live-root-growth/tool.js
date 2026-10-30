// Standalone, touch-friendly preview for the reusable LiveRootGrowth runtime.
// This editor owns its RAF; the game runtime updates instances through its existing scheduler.
(() => {
  'use strict';
  const T = window.THREE, growth = window.LiveRootGrowth, foliage = window.FoliageGenerator;
  const $ = id => document.getElementById(id); // Local authoring form lookup, never used by the game.
  const status = $('hud'), diagnostics = $('debug'), errorBox = $('errors');
  const trackedFields = ['seed','floorWidth','floorDepth','branchCount','strandLimit','radius',
    'branchRadius','floorDensity','targetDensity','floorLength','targetLength','bend','arcConcavity','shapeInset','volumeFillDepth','duration','showGuide'];
  const source = { kind:'demo', name:'Raised platform (demo)', data:null, file:null, model:null }; // Imported shape and serializable source metadata.
  const repoCatalog = new Map(); // Repository index/branch discovery and procedural catalog share one selectable list.
  let templeRootFinish = growth?.TEMPLE_ROOT_FINISH; // Current Temple roots finish used by every preview build.
  let repoRequestId = 0; // Ignores stale results from overlapping catalog refresh requests.
  let buildRequestId = 0, ruinFrame = null, ruinLoader = null, ruinQueue = Promise.resolve(), ruinRoom = null; // Serialize generator ownership and discard obsolete preview requests.
  let preparedRuin=null; // Completed vegetation remains separate from the interactive Grow/Reset instance.
  let framedEnvironment = 'flat'; // Reframe once per room/seed so rebuilds preserve the user's orbit and zoom.
  let buildController=null,roomCancel=null; // Cancel obsolete Wrap work and release a stalled generator instead of blocking future rebuilds.
  const buildState={running:false,stage:'idle',message:'Ready'}; // Mobile-visible construction progress is distinct from animation progress.
  function buildMessage(stage,message){
    buildState.stage=stage;buildState.message=message;
    $('buildStatus').textContent=message;$('cancelBuild').disabled=!buildState.running;
    for(const id of ['extend','retract','pause','reset','full','scrub'])if($(id).disabled!==buildState.running)$(id).disabled=buildState.running; // Do not silently send a Grow press to the previous instance while its replacement is being built.
    if(buildState.running)status.textContent=message;
  }
  function cancelBuild(){
    ++buildRequestId;buildController?.abort();roomCancel?.();
    if(buildState.stage==='loading'){ruinFrame?.remove();ruinFrame=null;ruinLoader=null;}
    buildState.running=false;buildMessage('cancelled','Build cancelled. You can rebuild or choose a different preview.');
    updateStatus(true);
  }
  let active = null, lastStatus = '', lastDebug = '', lastTimestamp = 0, pendingRecipe = null; // Instance/diagnostic state for this isolated preview.
  function reportError(error) {
    errorBox.style.display = 'block'; errorBox.textContent = error?.stack || error?.message || String(error);
    status.textContent = 'Growth preview error. Details are shown in the sidebar.';
  }
  if (!T || !growth || !foliage || !T.OrbitControls) {
    reportError(new Error('Missing THREE, OrbitControls, FoliageGenerator or LiveRootGrowth.'));
    return;
  }
  function makeShellOutlineMaterial() {
    // Same camera-space inverted hull, fog mix, and thickness as the game's onboarding preview.
    return new T.ShaderMaterial({
      side:T.BackSide, fog:true, depthWrite:false, depthFunc:T.LessDepth,
      uniforms:T.UniformsUtils.merge([T.UniformsLib.fog, {uThickness:{value:0.006}}]),
      vertexShader:`
        uniform float uThickness;
        varying float vFogDepth;
        void main() {
          #ifdef USE_INSTANCING
            mat4 mvMatrix = modelViewMatrix * instanceMatrix;
            vec3 viewNormal = normalize(mat3(mvMatrix) * normal);
          #else
            mat4 mvMatrix = modelViewMatrix;
            vec3 viewNormal = normalize(normalMatrix * normal);
          #endif
          vec4 viewPos = mvMatrix * vec4(position, 1.0);
          vec4 clip = projectionMatrix * viewPos;
          vec4 clipN = projectionMatrix * (viewPos + vec4(viewNormal, 0.0));
          vec2 dir = clipN.xy / clipN.w - clip.xy / clip.w;
          float len = length(dir);
          dir = len > 1e-5 ? dir / len : vec2(0.0, 0.0);
          clip.xy += dir * uThickness * clip.w;
          gl_Position = clip;
          vFogDepth = -viewPos.z;
        }`,
      fragmentShader:`
        uniform vec3 fogColor;
        #ifdef FOG_EXP2
          uniform float fogDensity;
        #else
          uniform float fogNear;
          uniform float fogFar;
        #endif
        varying float vFogDepth;
        void main() {
          vec3 outlineColor = vec3(0.0);
          #ifdef USE_FOG
            #ifdef FOG_EXP2
              float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
            #else
              float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
            #endif
            outlineColor = mix(outlineColor, fogColor, fogFactor);
          #endif
          gl_FragColor = vec4(outlineColor, 1.0);
        }`
    });
  }
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(48, 1, .08, 150);
  camera.position.set(9, 8, 11);
  const renderer = new T.WebGLRenderer({antialias:true,alpha:true});
  const shellOutlineMaterial = makeShellOutlineMaterial(); // Root meshes are layer 1; all furniture guides remain layer 0.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  $('render').appendChild(renderer.domElement);
  const orbit = new T.OrbitControls(camera, renderer.domElement);
  let previewDirty=true;orbit.addEventListener('change',()=>{previewDirty=true;}); // Keep orbit responsive during construction without redrawing a static dense scene between every layer.
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
  async function ruinGenerator() {
    if(ruinLoader)return ruinLoader;
    let loadingFrame=null; // A cancelled loader must never remove a newer retry's frame.
    ruinLoader=(async()=>{
      const frame=document.createElement('iframe');ruinFrame=frame;loadingFrame=frame; // Keep this request's frame separate from any subsequent retry.
      ruinFrame.title='Ruin geometry generator';ruinFrame.tabIndex=-1;ruinFrame.setAttribute('aria-hidden','true');
      ruinFrame.style.cssText='position:fixed;left:-10000px;top:-10000px;width:16px;height:16px;visibility:hidden;border:0';
      ruinFrame.src=new URL('tools/debris-ifier/index.html?devRuntime=1&assetAttempt='+Date.now().toString(36)+'-'+buildRequestId,document.baseURI).href; // Parent THREE shares pending FileLoader requests across frames; a retry needs fresh asset URLs after a download stalls.
      document.body.appendChild(ruinFrame);
      const started=Date.now(); // A visible error replaces an indefinite mobile loading state.
      while(Date.now()-started<45000){
        if(!frame.isConnected)throw Object.assign(new Error('Ruin loading cancelled.'),{name:'AbortError'});
        const api=frame.contentWindow?.DebrisifierV50; // Reuse the exact same parent-THREE generator bridge as the playable ruins.
        if(api?.generateInteriorLocale)return api;
        const debug=ruinFrame.contentDocument?.getElementById('debug')?.textContent||'';
        if(/FAILED/i.test(debug))throw new Error(debug);
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      throw new Error('Ruin generator did not load within 45 seconds. Rebuild to retry.');
    })().catch(error=>{loadingFrame?.remove();if(ruinFrame===loadingFrame){ruinFrame=null;ruinLoader=null;}throw error;});
    return ruinLoader;
  }
  function roomForSeed(seed,size,request) {
    ruinQueue=ruinQueue.catch(()=>{}).then(async()=>{
      if(request!==buildRequestId)throw Object.assign(new Error('Obsolete room request.'),{name:'AbortError'});
      const key=seed+'|'+size; // A saved seed regenerates the same room without rebuilding on every growth-setting adjustment.
      if(ruinRoom?.key===key)return ruinRoom;
      $('ruinStatus').textContent='Building one room with the existing ruin generator…';
      buildMessage('loading','Loading the existing ruin generator…');
      const api=await ruinGenerator(); // The hidden frame owns no render loop or extra WebGL context.
      if(request!==buildRequestId)throw Object.assign(new Error('Obsolete room request.'),{name:'AbortError'});
      buildMessage('room','Generating the room walls and brick floor…');
      let timer; // Missing textures, models or furniture downloads must not leave the entire rebuild queue pending forever.
      const deadline=new Promise((resolve,reject)=>{
        roomCancel=()=>reject(Object.assign(new Error('Ruin generation cancelled.'),{name:'AbortError'}));
        timer=setTimeout(()=>reject(new Error('Ruin generation timed out after 45 seconds. A model or texture may not have loaded. Rebuild to retry.')),45000);
      });
      let result; // Discard the stalled iframe on timeout/cancel; the next rebuild starts a clean generator.
      try{result=await Promise.race([api.generateInteriorLocale({seed,size,singleRoom:true,
        puzzles:{pressurePlate:false,brazier:false,glyphObelisk:false,stackedObelisk:false,linkedCubePillars:false,nestedRoom:false}}),deadline]);}
      catch(error){ruinFrame?.remove();ruinFrame=null;ruinLoader=null;throw error;}
      finally{clearTimeout(timer);roomCancel=null;}
      api.pausePreviewLoop();
      const meta=result.locale?.meta?.interiorShell; // Authoritative room count and floor elevation, not a separately invented rectangle.
      if(meta?.rooms?.length!==1)throw new Error('The ruin preview must generate exactly one room.');
      const roots=api.takePreviewRoots(),model=new T.Group(); // Keep the generated architecture and furniture; the selected growth target is added later.
      roots.localeRoot.updateWorldMatrix(true,true);
      let walls=0,floors=0,pieces=0; // On-device evidence that both real architectural surface types were imported.
      roots.localeRoot.traverse(mesh=>{
        if(!mesh.isMesh)return;
        const isFloor=mesh.userData?.wallBuilderRecipe==='wallrecipe2.json';
        let node=mesh;while(node&&node!==roots.localeRoot){if(node.visible===false||node.userData?.surfaceFoliage||node.userData?.surfaceFoliageGuide)return;node=node.parent;}
        if(!mesh.geometry?.getAttribute('position')||mesh.userData?.furnitureGlbPart)return;
        const copy=mesh.clone(false); // Clone owned buffers: the generator disposes its originals on the next seed.
        copy.geometry=window.ProceduralFurniture.createRockGeometry(mesh.geometry,{enabled:true,seed:seed+':ruin-rock-'+pieces,roughness:.85,contactArea:.35}); // Reuse the furniture rock solver; instanced brick batches retain their placement matrices.
        pieces+=mesh.isInstancedMesh?mesh.count:1;
        copy.userData.rockShape={enabled:true,roughness:.85};
        copy.material=Array.isArray(mesh.material)?mesh.material.map(material=>material.clone()):mesh.material.clone();
        mesh.matrixWorld.decompose(copy.position,copy.quaternion,copy.scale);
        copy.visible=true;copy.userData.liveRootFloor=isFloor;
        copy.userData.surfaceFoliageRole=isFloor?'floors':'walls';
        model.add(copy);if(isFloor)floors++;else if(mesh.userData?.ruinInteriorWall)walls++;
      });
      if(!floors||!walls)throw new Error('The generated room is missing its physical floor or walls.');
      model.updateWorldMatrix(true,true);
      const floorY=Number(meta.floorSurfaceY)||0; // Keep furniture placement and floor-node sampling in the generated room's own coordinate system.
      if(ruinRoom)ruinRoom.model.traverse(mesh=>{mesh.geometry?.dispose();
        if(Array.isArray(mesh.material))mesh.material.forEach(material=>material.dispose());else mesh.material?.dispose();});
      ruinRoom={key,model,floorY,walls,floors,rooms:1,seed,size,pieces,rockRoughness:.85};
      $('ruinStatus').textContent='1 room · '+walls+' generated wall panels · '+floors+' generated brick floor · '+pieces+' pieces converted to rock (85% roughness). Preparing vegetation…';
      return ruinRoom;
    });
    return ruinQueue;
  }
  async function prepareRuin(room,request,signal){
    const recipe={...readRecipe(),seed:room.seed+':ruin-cover',floorY:room.floorY,showGuide:false}; // Pre-grown cover uses the same dense Wrap and inward volume passes as new furniture.
    const key=JSON.stringify([room.key,recipe.floorDensity,recipe.targetDensity,recipe.strandLimit,recipe.radius,recipe.floorLength,recipe.targetLength,recipe.shapeInset,recipe.volumeFillDepth,templeRootFinish]);
    if(preparedRuin?.key===key)return preparedRuin;
    const cover=await growth.createAsync({THREE:T,foliage,recipe,target:new T.Group(),substrate:room.model,kind:'vines',progress:1,
      rootFinish:templeRootFinish,signal,onProgress:step=>{if(request===buildRequestId)buildMessage('cover','Covering rough ruin: '+step.part+' · layer '+step.layer+'/'+step.layers);}});
    return {key,cover,room};
  }
  function frameEnvironment(room) {
    const key=room?.key||'flat'; // Each room's actual wall bounds determine a comfortable camera distance on desktop and mobile.
    if(key===framedEnvironment)return;
    framedEnvironment=key;
    if(!room){orbit.target.set(0,1,0);camera.position.set(9,8,11);return;}
    const bounds=new T.Box3().setFromObject(room.model),center=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3());
    const distance=Math.max(size.x,size.y,size.z)/
      (2*Math.tan(camera.fov*Math.PI/360))*1.65/Math.min(1,camera.aspect);
    orbit.target.copy(center);camera.position.copy(center).add(new T.Vector3(1,.9,1.2).normalize().multiplyScalar(distance));
    orbit.update();
  }
  async function rebuild(keepProgress = true) {
    const request=++buildRequestId; // An older asynchronous room build must never overwrite a newer furniture or recipe choice.
    buildController?.abort();
    roomCancel?.();
    const controller=new AbortController();buildController=controller; // Every rebuild owns its cancellation signal.
    buildState.running=true;buildMessage('starting','Preparing the root preview…');
    let pendingCover=null,next=null; // Uncommitted generated assets are released on cancellation or failure.
    try {
      errorBox.style.display = 'none';
      const room=$('previewEnvironment').value==='ruin'?await roomForSeed(readRecipe().seed,$('ruinSize').value,request):null;
      if(request!==buildRequestId)return;
      pendingCover=room?await prepareRuin(room,request,controller.signal):null;
      if(request!==buildRequestId)return;
      const progress = keepProgress ? active?.getProgress() ?? 0 : 0;
      const placed = source.model.clone(true); // Never mutate the reusable imported source's local geometry.
      placed.position.copy(readPosition()); // Purpose-agnostic target transform for platform, bridge or future door shapes.
      next=await growth.createAsync({THREE:T,foliage,recipe:{...readRecipe(),...(room?{floorY:room.floorY}:{})},target:placed,
        ...(pendingCover?{growthSource:pendingCover.cover.targetGrowth}:{}),progress,rootFinish:templeRootFinish,signal:controller.signal,
        onProgress:step=>{if(request===buildRequestId)buildMessage('roots','Building roots: '+step.part+' · layer '+step.layer+'/'+step.layers);}});
      if(request!==buildRequestId)return;
      active?.dispose();active=next;next=null;
      if(preparedRuin!==pendingCover){preparedRuin?.cover.dispose();preparedRuin=pendingCover;if(preparedRuin)scene.add(preparedRuin.cover.group);}
      if(preparedRuin)for(const part of preparedRuin.cover.partPlan)part.mesh.visible=readRecipe().showGuide; // Guide toggles do not regenerate or retract the permanent cover.
      if(room)$('ruinStatus').textContent=`1 room · ${room.walls} walls · ${room.floors} floor · ${room.pieces} rock pieces (85% roughness). Vine cover is fully grown; Grow/Reset affects only the new shape.`;
      buildState.running=false;buildMessage('ready','Preview ready. Press Grow to animate.');
      scene.add(active.group); rebuildMarkers();
      grid.visible=!room; // The generated room replaces the original flat preview substrate and its rectangular grid.
      frameEnvironment(room);
      $('sourceName').textContent = source.name + ' · hidden geometry; growth-only preview';
      updateStatus(true);
      const metrics = active.getDiagnostics();
      if (metrics.shapeStrands === 0) {
        errorBox.style.display = 'block';
        errorBox.textContent = 'The imported shape produced no final Wrap strands. Branches will grow, but the shape will remain sparse. Try a simple watertight furniture mesh, increase Shape path length or check its recognized surfaces.';
      } else if (metrics.shrinkwrapRays > 0 && metrics.shrinkwrapHits < metrics.shrinkwrapRays * .25) {
        errorBox.style.display = 'block';
        errorBox.textContent = 'Inward shrinkwrap found only '+metrics.shrinkwrapHits+'/'+metrics.shrinkwrapRays+' hits on the hidden furniture. Some roots may not lie inside its volume. Check that the imported furniture has real surfaces and closed geometry.';
      }
    } catch (error) { if(request===buildRequestId){buildState.running=false;buildMessage(error.name==='AbortError'?'cancelled':'error',error.message);if(error.name!=='AbortError')reportError(error);} }
    finally{next?.dispose();if(pendingCover&&pendingCover!==preparedRuin)pendingCover.cover.dispose();}
  }
  function updateStatus(force = false) {
    if(buildState.running&&!force)return;
    if (!active) return;
    const info = active.getDiagnostics(), percent = Math.round(info.progress * 100);
    $('scrub').value = String(percent); $('progressLabel').textContent = percent+'%';
    const message = (info.substrate==='ruin'?'Pre-grown vine ruin + ':'') + source.name + ' · ' + percent + '% grown\n' +
      info.branchCount + ' branches · ' + info.floorStrands + (info.preparedVegetation?' existing vine wraps · ':' floor wraps · ') +
      info.shapeStrands + ' shape wraps · ' + info.shrinkwrapHits + '/' + info.shrinkwrapRays +
      ' inward hits\n' + info.groundedParts.length + ' grounded parts → ' +
      (info.partCount-info.groundedParts.length) + ' raised parts (' +
      info.rootTransferCount + ' connecting shoots, depth ' + info.maxPartDepth + ')';
    if (force || message !== lastStatus) { status.textContent = message; lastStatus = message; }
    const details = JSON.stringify({
      source:{kind:source.kind,name:source.name,file:source.file}, recipe:active.recipe,
      environment:$('previewEnvironment').value,ruin:$('previewEnvironment').value==='ruin'?
        {rooms:ruinRoom?.rooms,walls:ruinRoom?.walls,floors:ruinRoom?.floors,seed:ruinRoom?.seed,rockPieces:ruinRoom?.pieces,rockRoughness:ruinRoom?.rockRoughness,cover:preparedRuin?.cover.getDiagnostics()}:null,
      targetPosition:readPosition().toArray(), ...info
    }, null, 2);
    if (force || details !== lastDebug) { diagnostics.textContent = details; lastDebug = details; }
  }
  function humanizeKey(key) { return String(key).replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/\b\w/g, c => c.toUpperCase()); }

  function renderRepoCatalog() {
    const query = $('repoFurnitureSearch').value.trim().toLowerCase(); // Filter client-side without additional GitHub requests.
    const select = $('repoFurnitureList'), selected = select.value;
    const entries = [...repoCatalog.values()].filter(entry =>
      (entry.name + ' ' + entry.key + ' ' + (entry.path || '')).toLowerCase().includes(query));
    entries.sort((a,b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind));
    select.replaceChildren();
    for (const entry of entries.slice(0,500)) {
      const option = document.createElement('option'); option.value = entry.id;
      option.textContent = entry.name + (entry.kind === 'procedural' ? ' · procedural' : ' · authored');
      select.add(option);
    }
    if (selected && entries.some(entry => entry.id === selected)) select.value = selected;
    else select.selectedIndex = entries.length ? 0 : -1;
    $('importRepoFurniture').disabled = !entries.length;
    return entries.length;
  }

  function addRepoAuthored(path,key) {
    if (!/^config\/furniture-authored\/[A-Za-z0-9_-]+\.json$/.test(path) || /\/index\.json$/.test(path)) return;
    const stem = path.split('/').pop().replace(/\.json$/i,'');
    const id = 'authored:' + path;
    repoCatalog.set(id,{id,kind:'authored',key:key||stem,name:humanizeKey(stem),path});
  }

  async function refreshRepoFurniture() {
    const request = ++repoRequestId; // Prevent a slower prior GitHub request from replacing a later refresh.
    repoCatalog.clear();
    for (const [key,parts] of Object.entries(window.ProceduralFurniture?.CATALOG || {})) {
      if (!Array.isArray(parts) || !parts.length) continue;
      const id = 'procedural:' + key;
      repoCatalog.set(id,{id,kind:'procedural',key,name:humanizeKey(key)});
    }
    renderRepoCatalog();
    $('repoFurnitureStatus').textContent = 'Loading repository authored furniture index…';
    const warnings = []; // Visible catalog diagnostics on mobile, even if GitHub is rate-limited.
    try {
      const response = await fetch(new URL('config/furniture-authored/index.json',document.baseURI));
      if (!response.ok) throw new Error('index HTTP ' + response.status);
      const manifest = await response.json();
      if (!Array.isArray(manifest.furniture)) throw new Error('The furniture index has no furniture list.');
      if (request !== repoRequestId) return;
      for (const record of manifest.furniture) addRepoAuthored(record?.file,record?.key);
    } catch (error) { warnings.push('index: ' + error.message); }
    if (request !== repoRequestId) return;
    const builtInCount = repoCatalog.size;
    renderRepoCatalog();
    $('repoFurnitureStatus').textContent = builtInCount + ' catalog entries; checking branch for additional authored furniture…';
    try {
      // Same ref-detection policy as Furniture + Avatar Author: a pinned GitHack preview must discover the pinned tree.
      const pinned = location.hostname.toLowerCase() === 'raw.githack.com'
        ? location.pathname.match(/^\/Oolnokk\/HobunjiHollowUnity\/([^/]+)\/docs\//)?.[1] : null;
      const gitRef = pinned || 'main';
      const treeUrl = 'https://api.github.com/repos/Oolnokk/HobunjiHollowUnity/git/trees/' +
        encodeURIComponent(gitRef) + '?recursive=1';
      const response = await fetch(treeUrl,{headers:{Accept:'application/vnd.github+json'}});
      if (!response.ok) throw new Error('GitHub tree HTTP ' + response.status);
      const listing = await response.json();
      if (!Array.isArray(listing.tree)) throw new Error('GitHub tree contained no files.');
      if (request !== repoRequestId) return;
      for (const node of listing.tree) {
        if (node?.type !== 'blob') continue;
        if (/^docs\/config\/furniture-authored\/[A-Za-z0-9_-]+\.json$/.test(node.path)) {
          addRepoAuthored(node.path.slice('docs/'.length));
        }
      }
      if (listing.truncated) warnings.push('GitHub tree was truncated');
    } catch(error) { warnings.push('branch discovery: ' + error.message); }
    if (request !== repoRequestId) return;
    const visible = renderRepoCatalog();
    $('repoFurnitureStatus').textContent =
      repoCatalog.size + ' available (showing ' + visible + ')' +
      (warnings.length ? ' · ' + warnings.join('; ') : ' · repository loaded');
  }

  function buildAuthoredFurniture(json) {
    if (!Array.isArray(json?.parts) || !json.parts.length) throw new Error('Furniture JSON must contain authored parts.');
    if (!window.AuthoredFurniture?.buildGroup || !window.ProceduralFurniture?.buildPartMesh) {
      throw new Error('The existing furniture renderer did not load.');
    }
    const model = window.AuthoredFurniture.buildGroup(json,0x8b6540);
    if (!model.children.some(child => child.isMesh)) throw new Error('No geometry was generated from these parts.');
    return model;
  }

  async function waitForFurnitureGlbs(model) {
    const drivers = []; // Only GLB-backed furniture parts need asynchronous readiness checks.
    model.traverse(node => { if (node.isMesh && node.userData?.furnitureGlbPart) drivers.push(node); });
    if (!drivers.length) return;
    const started = Date.now(); // Bounding waits avoid an infinite import spinner on mobile.
    await new Promise((resolve,reject) => {
      const check = () => {
        const failed = drivers.find(node=>node.userData.glbError);
        if (failed) { reject(new Error('Furniture model failed: ' + failed.userData.glbError)); return; }
        if (drivers.every(node=>node.userData.glbReady)) { resolve(); return; }
        if (Date.now() - started > 30000) {
          reject(new Error('Furniture GLB did not finish loading within 30 seconds. Try importing it again.'));
          return;
        }
        setTimeout(check, 80); // Import-only polling, never a per-frame scene walk.
      };
      check();
    });
  }

  async function importRepoFurniture() {
    const entry = repoCatalog.get($('repoFurnitureList').value);
    if (!entry) throw new Error('Choose a repository furniture piece.');
    const button = $('importRepoFurniture');
    button.disabled = true; $('repoFurnitureStatus').textContent = 'Importing ' + entry.name + '…';
    try {
      let json,model;
      if (entry.kind === 'procedural') {
        const parts = window.ProceduralFurniture?.CATALOG?.[entry.key];
        if (!Array.isArray(parts) || !parts.length) throw new Error('Procedural furniture recipe is unavailable.');
        json = {schema:'hobunji_furniture_authored_runtime.v1',key:entry.key,
          parts:JSON.parse(JSON.stringify(parts))};
        model = window.ProceduralFurniture.buildFurnitureGroup(entry.key,0x8b6540);
        if (!model.children.some(child=>child.isMesh)) throw new Error('Procedural furniture has no mesh geometry.');
      } else {
        const response = await fetch(new URL(entry.path,document.baseURI));
        if (!response.ok) throw new Error('Furniture fetch HTTP ' + response.status + ' (' + entry.path + ')');
        json = await response.json();
        model = buildAuthoredFurniture(json);
      }
      await waitForFurnitureGlbs(model); // Growth must use real imported geometry, never a 1-mm GLB placeholder.
      // Only swap the model after its actual geometry was successfully generated.
      source.kind = entry.kind === 'procedural' ? 'repo-procedural' : 'repo-authored';
      source.name = entry.name; source.data = json; source.file = entry.path || entry.key; source.model = model;
      $('targetY').value = '0'; // Repo furniture's authored part coordinates normally already start at floor level.
      rebuild(false); $('repoFurnitureStatus').textContent = 'Imported ' + entry.name + ' from repository.';
    } finally { button.disabled = false; }
  }

  async function loadTempleRootFinish() {
    try {
      const response = await fetch(new URL('config/pieces/temple.json', document.baseURI));
      if (!response.ok) throw new Error('Temple finish HTTP ' + response.status);
      const temple = await response.json();
      const layer = temple.surfaceGrowth?.find(item=>item.kind==='roots' && item.style==='wrap') ||
        temple.surfaceGrowth?.find(item=>item.kind==='roots');
      if (!layer || !/^#[a-f0-9]{6}$/i.test(layer.color) || !/^assets\/textures\/[A-Za-z0-9_.-]+\.png$/.test(layer.texture)) {
        throw new Error('Temple root surface recipe is missing or invalid.');
      }
      templeRootFinish = {color:layer.color,texture:layer.texture};
      if (active) rebuild(true); // Regenerate the preview using the actual authored Temple finish.
    } catch(error) {
      // Fallback stays identical to the current Temple root recipe; expose the issue rather than hiding it.
      const message = 'Temple root finish fallback: ' + error.message;
      $('repoFurnitureStatus').title = message; console.warn('[LiveRootGrowth]',message);
    }
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
      const model = buildAuthoredFurniture(json);
      await waitForFurnitureGlbs(model);
      source.kind = 'authored-furniture'; source.name = file.name; source.data = json; source.file = file.name; source.model = model;
    } else throw new Error('Choose a GLB or Furniture + Avatar Author JSON.');
    $('targetY').value = source.kind === 'glb' ? '1.5' : '0.6';
    rebuild(false);
  }
  function exportedRecipe() {
    return {schema:'hobunji_live_root_growth.v1',
      environment:$('previewEnvironment').value,ruinSize:$('ruinSize').value,
      recipe:readRecipe(), position:readPosition().toArray(),
      target:{kind:source.kind,file:source.file,
        ...((source.kind === 'authored-furniture' || source.kind === 'repo-authored' || source.kind === 'repo-procedural')
          ? {furniture:source.data} : {})}
    }; // Repo snapshots and authored JSON are self-contained; external GLB remains separate.
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
    $('previewEnvironment').value=json.environment==='ruin'?'ruin':'flat';
    $('ruinSize').value=['small','medium','large'].includes(json.ruinSize)?json.ruinSize:'small';
    if (Array.isArray(json.position) && json.position.length >= 3) ['targetX','targetY','targetZ'].forEach((id,i) => {
      const n = Number(json.position[i]); if (Number.isFinite(n)) $(id).value = String(n);
    });
    if (['authored-furniture','repo-authored','repo-procedural'].includes(json.target?.kind) &&
        Array.isArray(json.target.furniture?.parts)) {
      const model = buildAuthoredFurniture(json.target.furniture);
      await waitForFurnitureGlbs(model);
      source.model=model;source.data=json.target.furniture;source.kind=json.target.kind;
      source.name=json.target.file ? humanizeKey(json.target.file.split('/').pop().replace(/\.json$/,'')) : 'Embedded furniture';
      source.file=json.target.file||null;
    } else if (json.target?.kind === 'glb') {
      if (source.kind !== 'glb' || source.file !== json.target.file) {
        pendingRecipe = json;
        status.textContent = 'Recipe settings imported. Now import its separate GLB: '+(json.target.file||'unnamed GLB');
        return;
      }
    }
    pendingRecipe=null;await rebuild(false);
  }
  function resize() {
    const rect=$('render').getBoundingClientRect(), w=Math.max(1,Math.floor(rect.width)),h=Math.max(1,Math.floor(rect.height));
    renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
  }
  $('rebuild').onclick=()=>rebuild();
  $('cancelBuild').onclick=cancelBuild;
  $('previewEnvironment').onchange=()=>rebuild(false);
  $('ruinSize').onchange=()=>{if($('previewEnvironment').value==='ruin')rebuild(false);};
  $('previewRuin').onclick=()=>{$('previewEnvironment').value='ruin';rebuild(false);};
  $('repoFurnitureSearch').addEventListener('input',renderRepoCatalog);
  $('refreshRepoFurniture').onclick=()=>refreshRepoFurniture().catch(reportError);
  $('importRepoFurniture').onclick=()=>importRepoFurniture().catch(reportError);
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
  window._liveRootGrowthAuthorBridge = {getRecipe:exportedRecipe, rebuild,
    getBuildState:()=>({...buildState}),cancelBuild, // Report loading versus geometry work even before an animated instance exists.
    getPreparedRuin:()=>preparedRuin,getInstance:()=>active, // Allows exact hidden geometry, growth stages and disposal checks without renderer interception.
    diagnostics:()=>active?.getDiagnostics(), refreshRepoFurniture, getRepoCount:()=>repoCatalog.size}; // Built-in mobile diagnostic hook for the Tools Hub.
  if (window.ResizeObserver) new ResizeObserver(resize).observe($('render'));else window.addEventListener('resize',resize);
  function renderSceneWithShellOutlines() {
    // Root meshes use the game's layer-1 inverted-hull pass, without tracing imported furniture.
    renderer.render(scene,camera);
    const savedMask = camera.layers.mask, savedMaterial = scene.overrideMaterial;
    const savedColor = renderer.autoClearColor, savedDepth = renderer.autoClearDepth;
    try {
      renderer.autoClearColor = false; renderer.autoClearDepth = false;
      scene.overrideMaterial = shellOutlineMaterial;
      camera.layers.set(1);
      renderer.render(scene,camera);
    } finally {
      camera.layers.mask = savedMask; scene.overrideMaterial = savedMaterial;
      renderer.autoClearColor = savedColor; renderer.autoClearDepth = savedDepth;
    }
  }
  function frame(timestamp) {
    requestAnimationFrame(frame); // Isolated authoring preview, never part of the game's permanent frame scheduler.
    const delta=lastTimestamp?Math.max(0,Math.min(.05,(timestamp-lastTimestamp)/1000)):0;
    lastTimestamp=timestamp;if(!buildState.running)active?.update(delta);orbit.update();
    if(!buildState.running||previewDirty){renderSceneWithShellOutlines();previewDirty=false;}
    if (active && (timestamp % 220 < 18)) updateStatus();
  }
  resize();rebuild(false);requestAnimationFrame(frame);
  refreshRepoFurniture().catch(reportError);
  loadTempleRootFinish().catch(reportError);
})();

// Standalone, touch-friendly preview for the reusable LiveRootGrowth runtime.
// This editor owns its RAF; the game runtime updates instances through its existing scheduler.
(() => {
  'use strict';
  const T = window.THREE, growth = window.LiveRootGrowth, foliage = window.FoliageGenerator;
  const $ = id => document.getElementById(id); // Local authoring form lookup, never used by the game.
  const status = $('hud'), diagnostics = $('debug'), errorBox = $('errors');
  const trackedFields = ['seed','floorWidth','floorDepth','branchCount','strandLimit','radius',
    'branchRadius','floorDensity','targetDensity','floorLength','targetLength','bend','arcConcavity','shapeInset','volumeFillDepth','detailPreservation','knotDensity','minRootRadius','duration','showGuide'];
  const source = { kind:'demo', name:'Raised platform (demo)', data:null, file:null, model:null,mechanism:null }; // Imported shape and serializable source metadata.
  const PREVIEW_COLORS={stoneColor:'#363733',rootColor:'#24211d'}; // Picker defaults and legacy-recipe fallback: user-selected stone and root palette.
  const repoCatalog = new Map(); // Repository index/branch discovery and procedural catalog share one selectable list.
  let templeRootFinish = growth?.TEMPLE_ROOT_FINISH; // Current Temple roots finish used by every preview build.
  let templeCoverRecipes=null,templeSettingsLoad=null; // Initial ruin cover follows authored Temple layers, independent of new-growth controls.
  let colorRebuildTimer=null; // Debounce root texture/cover rebuilds while HSL sliders are being dragged.
  let repoRequestId = 0; // Ignores stale results from overlapping catalog refresh requests.
  let buildRequestId = 0, ruinFrame = null, ruinLoader = null, ruinQueue = Promise.resolve(), ruinRoom = null; // Serialize generator ownership and discard obsolete preview requests.
  let activeMechanismSource=null,mechanismLoadId=0; // Keep authored pose guides alive until their rendered controller is replaced.
  let preparedRuin=null; // Completed vegetation remains separate from the interactive Grow/Reset instance.
  let framedEnvironment = 'flat'; // Reframe once per room/seed so rebuilds preserve the user's orbit and zoom.
  let buildController=null,roomCancel=null; // Cancel obsolete Wrap work and release a stalled generator instead of blocking future rebuilds.
  const buildState={running:false,stage:'idle',message:'Ready'}; // Mobile-visible construction progress is distinct from animation progress.
  function buildMessage(stage,message){
    buildState.stage=stage;buildState.message=message;
    $('buildStatus').textContent=message;$('cancelBuild').disabled=!buildState.running;syncMechanismControls();
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
  const watchedTextures=new Map();let renderedActive=null,renderedProgress=-1,renderedVersion=-1; // Redraw a static preview only for changed geometry, camera or asynchronously loaded texture pixels.
  let previewDirty=true;orbit.addEventListener('change',()=>{previewDirty=true;});
  let rootHands=null,roamingNpc=null,lastHandStatus=0; // Current author preview owns these, never the game. // Keep orbit responsive during construction without redrawing a static dense scene between every layer.
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
  function normalizePreviewColor(value,fallback){return typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value.trim())?value.trim().toLowerCase():fallback;}
  function readPreviewColors(){return Object.fromEntries(Object.entries(PREVIEW_COLORS).map(([id,fallback])=>[id,normalizePreviewColor($(id).value,fallback)]));}
  function rootFinishForPreview(){return {...templeRootFinish,color:readPreviewColors().rootColor};}
  function readColorHsl(id){
    return {h:Math.max(0,Math.min(360,Number($(id+'H').value)||0)),s:Math.max(0,Math.min(100,Number($(id+'S').value)||0)),l:Math.max(0,Math.min(100,Number($(id+'L').value)||0))};
  }
  function colorHslLabel(id){const hsl=readColorHsl(id);return `${hsl.h}°, ${hsl.s}%, ${hsl.l}%`;}
  function syncPreviewColors(colors=readPreviewColors(),preserveHslId=null,changedId=null){
    for(const [id,fallback] of Object.entries(PREVIEW_COLORS)){
      $(id).value=normalizePreviewColor(colors[id],fallback);$(id+'Hex').value=$(id).value;
      if(id!==preserveHslId&&(!changedId||id===changedId)){const hsl=new T.Color($(id).value).getHSL({}); /* THREE is the shared authority for both colour conversions. */$(id+'H').value=Math.round(hsl.h*360);$(id+'S').value=Math.round(hsl.s*100);$(id+'L').value=Math.round(hsl.l*100);}
      const selected=readColorHsl(id); // Keep hue editable even while saturation is zero or lightness is at an extreme.
      for(const [axis,key,suffix] of [['H','h','°'],['S','s','%'],['L','l','%']])$(id+axis+'Value').textContent=selected[key]+suffix;
    }
    const selected=readPreviewColors();$('colorStatus').textContent=`Stone ${selected.stoneColor} (${colorHslLabel('stoneColor')}) · Roots ${selected.rootColor} (${colorHslLabel('rootColor')})`;
  }
  function updateColorHsl(id){
    const hsl=readColorHsl(id); // Slider values retain their exact HSL coordinates while the hex swatch is updated.
    $(id).value='#'+new T.Color().setHSL(hsl.h/360,hsl.s/100,hsl.l/100).getHexString();
    return updatePreviewColor(id,false,id);
  }
  function scheduleColorPreview(id,commit=false){
    if(id!=='rootColor'){if(commit)updateStatus(true);return;}
    clearTimeout(colorRebuildTimer);colorRebuildTimer=null;
    if(commit)rebuild();else colorRebuildTimer=setTimeout(()=>rebuild(),300); // Swatches and numbers respond immediately; geometry/texture work waits for a pause or release.
  }
  function updatePreviewColor(id,fromHex=false,preserveHslId=null){
    const value=normalizePreviewColor($(id+(fromHex?'Hex':'')).value,null); // Invalid typed colours stay visible for correction instead of changing the scene.
    if(!value){$('colorStatus').textContent='Use a six-digit hex colour, such as #363733.';return false;}
    $(id).value=value;syncPreviewColors(readPreviewColors(),preserveHslId,id);
    if(id==='stoneColor'){
      for(const room of new Set([ruinRoom,preparedRuin?.room]))if(room){
        const previous=room.stoneMaterial;room.stoneMaterial=makeRuinStoneMaterial(value);if(room.stoneMaterial.map)watchedTextures.set(room.stoneMaterial.map,room.stoneMaterial.map.version); // Re-bake the farm stone tint through the shared PNG pipeline; geometry and vegetation stay intact.
        room.model.traverse(mesh=>{if(mesh.material===previous)mesh.material=room.stoneMaterial;});
        if(room.floorPattern)room.floorPattern.material=room.stoneMaterial;
        if(preparedRuin?.room===room)for(const part of preparedRuin.cover.partPlan)part.mesh.material=room.stoneMaterial;
        previous.dispose();
      }
      previewDirty=true;
    }
    return true;
  }
  function readRuinRoughness(value=$('ruinRoughness').value){
    const number=Number(value??.3); // Saved recipes and the editable control share one finite, bounded roughness value.
    return Number.isFinite(number)?Math.max(0,Math.min(1,number)):.3;
  }
  const {ruinRockGeometry,makeRuinStoneMaterial,mapRuinStoneSurfaces,ruinFloorShell,ruinFloorTileLayout,compactFloorStoneIndices,floorStrandRingIndices,compactFloorCover,ruinFloorMesh}=window.StoneAgeRuinScenery; // Use the shared exact stone/wilderness adapter in the editor and playable ruins.
  function disposeRoomModel(room){
    if(!room||room.disposed)return;room.disposed=true;
    const materials=new Set(); // Instanced and ordinary room pieces share one stone finish.
    room.model.traverse(mesh=>{if(mesh.isInstancedMesh)mesh.dispose?.();mesh.geometry?.dispose();for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])if(material)materials.add(material);});
    for(const material of materials)material.dispose();
  }
  function roomForSeed(seed,size,roughness,request) {
    ruinQueue=ruinQueue.catch(()=>{}).then(async()=>{
      if(request!==buildRequestId)throw Object.assign(new Error('Obsolete room request.'),{name:'AbortError'});
      const key=seed+'|'+size+'|'+roughness; // A saved seed regenerates the same room without rebuilding on every growth-setting adjustment.
      if(ruinRoom?.key===key)return ruinRoom;
      $('ruinStatus').textContent='Building one room with the existing ruin generator…';
      buildMessage('loading','Loading the existing ruin generator…');
      const api=await ruinGenerator(); // The hidden frame owns no render loop or extra WebGL context.
      if(request!==buildRequestId)throw Object.assign(new Error('Obsolete room request.'),{name:'AbortError'});
      buildMessage('room','Generating the room walls and giant stone floor…');
      let timer; // Missing textures, models or furniture downloads must not leave the entire rebuild queue pending forever.
      const deadline=new Promise((resolve,reject)=>{
        roomCancel=()=>reject(Object.assign(new Error('Ruin generation cancelled.'),{name:'AbortError'}));
        timer=setTimeout(()=>reject(new Error('Ruin generation timed out after 45 seconds. A model or texture may not have loaded. Rebuild to retry.')),45000);
      });
      let result; // Discard the stalled iframe on timeout/cancel; the next rebuild starts a clean generator.
      try{result=await Promise.race([api.generateInteriorLocale({seed,size:size==='vast'?'large':size,roomPreset:size==='vast'?'veryLarge':null,singleRoom:true,pieceSet:'stoneAge',floorProps:'pillarsOnly',
        puzzles:{pressurePlate:false,brazier:false,glyphObelisk:false,stackedObelisk:false,linkedCubePillars:false,nestedRoom:false}}),deadline]);}
      catch(error){ruinFrame?.remove();ruinFrame=null;ruinLoader=null;throw error;}
      finally{clearTimeout(timer);roomCancel=null;}
      api.pausePreviewLoop();
      const meta=result.locale?.meta?.interiorShell; // Authoritative room count and floor elevation, not a separately invented rectangle.
      if(meta?.rooms?.length!==1)throw new Error('The ruin preview must generate exactly one room.');
      const roots=api.takePreviewRoots(),model=new T.Group(); // Keep the generated architecture and furniture; the selected growth target is added later.
      roots.localeRoot.updateWorldMatrix(true,true);
      const stoneMaterial=makeRuinStoneMaterial(readPreviewColors().stoneColor); // Same authored stone texture/tint as farm cliffs, shared by every ruin piece.
      stoneMaterial.side=T.DoubleSide; // Keep both sides of the solid scenery visible from inside and outside the ruin.
      let walls=0,floors=0,pieces=0,pillars=0; // On-device evidence that both real architectural surface types were imported.
      roots.localeRoot.traverse(mesh=>{
        if(!mesh.isMesh)return;
        const isFloor=mesh.userData?.wallBuilderRecipe==='wallrecipe2.json';
        let owner=mesh,role='',isPillar=false;while(owner&&owner!==roots.localeRoot){role ||= owner.userData?.interiorRuinRole||'';isPillar ||= !!owner.userData?.squarePillar&&!owner.userData?.repoPillarBeam&&!owner.userData?.squarePillarBeam;owner=owner.parent;}
        isPillar ||= /pillar/i.test(role);
        if(isFloor||(!mesh.userData?.ruinInteriorWall&&!isPillar))return; // Replace brick batches below; retain only walls and standing pillars from the generated shell.
        let node=mesh;while(node&&node!==roots.localeRoot){if(node.visible===false||node.userData?.surfaceFoliage||node.userData?.surfaceFoliageGuide)return;node=node.parent;}
        if(!mesh.geometry?.getAttribute('position')||mesh.userData?.furnitureGlbPart)return;
        const copy=mesh.clone(false); // Clone owned buffers: the generator disposes its originals on the next seed.
        copy.geometry=ruinRockGeometry(mesh,{enabled:true,seed:seed+':ruin-rock-'+pieces,roughness,contactArea:.35}); // Reuse the furniture rock solver for the retained wall and pillar shapes.
        pieces+=mesh.isInstancedMesh?mesh.count:1;
        copy.userData.rockShape={enabled:true,roughness};
        copy.material=stoneMaterial;mapRuinStoneSurfaces(copy); // Furniture-style surface detection runs on roughened geometry, never the original prism.
        mesh.matrixWorld.decompose(copy.position,copy.quaternion,copy.scale);
        copy.visible=true;copy.userData.liveRootFloor=false;copy.userData.ruinPreviewRole=isPillar?'pillar':'wall';
        if(isPillar)pillars++;
        copy.userData.surfaceFoliageRole='walls';
        model.add(copy);if(mesh.userData?.ruinInteriorWall)walls++;
      });
      const floor=ruinFloorMesh(meta,seed,stoneMaterial),stoneFloor=floor.mesh;model.add(stoneFloor);floors=1;pieces+=stoneFloor.userData.stoneCount; // Build the new floor before any vegetation is applied.
      if(!floors||!walls)throw new Error('The generated room is missing its physical floor or walls.');
      model.updateWorldMatrix(true,true);
      const floorY=Number(meta.floorSurfaceY)||0; // Keep furniture placement and floor-node sampling in the generated room's own coordinate system.
      if(ruinRoom!==preparedRuin?.room)disposeRoomModel(ruinRoom); // Keep the previous visible stone alive until its replacement has finished building.
      ruinRoom={key,model,stoneMaterial,floorY,walls,floors,rooms:1,seed,size,pieces,pillars,rockRoughness:roughness,pieceSet:'stoneAge',floorProps:'pillars-only',wallPrismDepth:.45,floorStyle:stoneFloor.userData.floorStyle,floorStones:stoneFloor.userData.stoneCount,floorYScale:stoneFloor.userData.yScale,floorPattern:floor.pattern,floorLayout:floor.layout,floorTileScale:floor.layout.scale,floorTileCopies:floor.layout.offsets.length,roomWidth:meta.rooms[0].w*meta.cellSize,roomDepth:meta.rooms[0].h*meta.cellSize};
      $('ruinStatus').textContent=`1 room · ${walls} solid walls · ${floors} floor · ${pieces} Stone Age pieces (${Math.round(roughness*100)}% roughness). Preparing vegetation…`;
      return ruinRoom;
    });
    return ruinQueue;
  }
  function ruinCoverRecipes(){return window.StoneAgeRuinScenery.coverRecipes(templeCoverRecipes,readPreviewColors().rootColor);}
  async function prepareRuin(room,request,signal){
    if(!templeCoverRecipes)await (templeSettingsLoad ||= loadTempleRootFinish());
    if(!templeCoverRecipes)throw new Error('Life Temple vegetation settings could not be loaded. Rebuild to retry.');
    const recipes=ruinCoverRecipes(),key=JSON.stringify([room.key,recipes]); // Editing a new structure must not regenerate the initial vegetation.
    if(preparedRuin?.key===key)return preparedRuin;
    const wallRecipes=recipes.filter(recipe=>recipe.target!=='floors').map(recipe=>recipe.target==='all'?{...recipe,target:'walls'}:recipe); // Do not expand all sixteen floor instances into CPU sampling triangles.
    const floorRecipes=recipes.filter(recipe=>recipe.target==='floors'||recipe.target==='all').map(recipe=>({...recipe,target:'floors'})); // The completed floor vegetation is repeated with the stone at the same uniform scale.
    let walls=null,floor=null,complete=false;const patches=[]; // Partial builds release only the generated cover buffers, never the shared stone pattern.
    const build=(target,layers,label)=>growth.createCoverAsync({THREE:T,foliage,target,recipes:layers,seed:room.seed+':ruin-cover',floorY:room.floorY,
      signal,onProgress:step=>{if(request===buildRequestId)buildMessage('cover',label+': '+step.part+' · layer '+step.layer+'/'+step.layers);}});
    try{
      walls=await build(room.model,wallRecipes,'Wall cover');
      const floorTarget=new T.Group();floorTarget.add(room.floorPattern.clone(false)); // Original-size, already textured stone is the only shrinkwrap target for the floor patch.
      floor=await build(floorTarget,floorRecipes,'Floor pattern cover');
      compactFloorCover(floor.targetGrowth); // Simplify once before sharing the completed patch across all sixteen tiles.
      const wallInfo=walls.getDiagnostics(),floorInfo=floor.getDiagnostics(); // Record actual generation work once, while reporting every visible repeated strand.
      for(const offset of room.floorLayout.offsets){const patch=floor.targetGrowth.clone(true);patch.name='Quarter-scale floor vegetation';patch.scale.setScalar(room.floorLayout.scale);patch.position.set(...offset);walls.targetGrowth.add(patch);patches.push(patch);}
      const strands=wallInfo.shapeStrands+floorInfo.shapeStrands*patches.length;walls.targetGrowth.userData.generatedStrands=strands;
      let disposed=false; // Clones share floor geometry/materials; dispose the original generated floor resources exactly once.
      const rootLayers=walls.targetGrowth.children.filter((layer,index)=>wallRecipes[index]?.kind==='roots'); // Exact fixed root tubes that host the hidden branch nodes.
      const cover={...walls,wallRootLayers:rootLayers,getDiagnostics:()=>({...wallInfo,recipeCount:recipes.length,vegetationRecipes:recipes,shapeStrands:strands,
        shrinkwrapRays:wallInfo.shrinkwrapRays+floorInfo.shrinkwrapRays,shrinkwrapHits:wallInfo.shrinkwrapHits+floorInfo.shrinkwrapHits,
        floorTileScale:room.floorLayout.scale,floorTileCopies:patches.length,floorPatternStrands:floorInfo.shapeStrands}),
        dispose(){if(disposed)return;disposed=true;for(const patch of patches)patch.parent?.remove(patch);walls.dispose();floor.dispose();}};
      complete=true;return {key,cover,room};
    }finally{if(!complete){for(const patch of patches)patch.parent?.remove(patch);walls?.dispose();floor?.dispose();}}
  }
  function releaseRootSnare(){
    rootHands?.dispose();roamingNpc?.dispose();rootHands=null;roamingNpc=null;previewDirty=true;
  }
  function snareSettings(){
    const numeric=(id,min,max,fallback)=>{const n=Number($(id).value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;}; // All author values are bounded before instancing.
    return {count:Math.round(numeric('snareCount',1,14,7)),triggerRadius:numeric('snareRadius',.5,7,2.5),
      reach:numeric('snareReach',.3,4,1.45),extendSpeed:numeric('snareExtend',.15,12,2.4),
      retractSpeed:numeric('snareRetract',.15,12,1.1),runnerSpeed:numeric('snareRunnerSpeed',.3,5,2.5)};
  }
  function buildRootSnare(){
    releaseRootSnare();
    if(!$('snareEnabled').checked){$('snareStatus').textContent='Preview disabled; all branches remain normal.';return;}
    if(!preparedRuin?.room||!preparedRuin.cover?.wallRootLayers?.length){
      $('snareStatus').textContent='Build the ruin and its wall roots to locate hidden hand nodes.';return;
    }
    if(!window.RootSnareHands||!window.RootSnareRunner){
      $('snareStatus').textContent='Root snare preview scripts are missing.';return;
    }
    const settings=snareSettings(),room=preparedRuin.room;
    try{
      const hands=window.RootSnareHands.create({THREE:T,room,
        wallRootLayers:preparedRuin.cover.wallRootLayers,seed:room.seed+':snare-nodes',
        count:settings.count,triggerRadius:settings.triggerRadius,reach:settings.reach,
        extendSpeed:settings.extendSpeed,retractSpeed:settings.retractSpeed,
        showNodes:$('snareReveal').checked});
      const runner=window.RootSnareRunner.create({THREE:T,room,seed:room.seed+':walker',speed:settings.runnerSpeed});
      rootHands=hands;roamingNpc=runner;scene.add(hands.group,runner.group);
      $('snareStatus').textContent=hands.anchors.length+' fixed hidden root nodes placed. The runner is seeking them…';
      previewDirty=true;
    }catch(error){releaseRootSnare();$('snareStatus').textContent='Root-hand build error: '+error.message;reportError(error);}
  }

  function frameEnvironment(room) {
    const key=room?room.seed+'|'+room.size:'flat'; // Roughness edits preserve the user's current view; each room's actual wall bounds determine a comfortable camera distance on desktop and mobile.
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
    clearTimeout(colorRebuildTimer);colorRebuildTimer=null;
    const request=++buildRequestId; // An older asynchronous room build must never overwrite a newer furniture or recipe choice.
    buildController?.abort();
    roomCancel?.();
    const controller=new AbortController();buildController=controller; // Every rebuild owns its cancellation signal.
    buildState.running=true;buildMessage('starting','Preparing the root preview…');
    let pendingCover=null,next=null; // Uncommitted generated assets are released on cancellation or failure.
    try {
      errorBox.style.display = 'none';
      const room=$('previewEnvironment').value==='ruin'?await roomForSeed(readRecipe().seed,$('ruinSize').value,readRuinRoughness(),request):null;
      if(request!==buildRequestId)return;
      pendingCover=room?await prepareRuin(room,request,controller.signal):null;
      if(request!==buildRequestId)return;
      const progress = keepProgress ? active?.getProgress() ?? 0 : 0;
      const place=model=>{const placed=model.clone(true);placed.position.copy(readPosition());return placed;}; // Static guide poses retain the user's placement without mutating their templates.
      const options={THREE:T,foliage,recipe:{...readRecipe(),...(room?{floorY:room.floorY}:{})},
        ...(pendingCover?{growthSource:pendingCover.cover.targetGrowth}:{}),progress,rootFinish:rootFinishForPreview(),signal:controller.signal,
        onProgress:step=>{if(request===buildRequestId)buildMessage('roots','Building roots: '+step.part+' · layer '+step.layer+'/'+step.layers);}};
      next=source.mechanism?await window.LiveRootMechanisms.createAsync({...options,type:source.mechanism.type,name:source.name,
        states:source.mechanism.states.map(state=>({...state,target:place(state.target)})),keyframes:source.mechanism.keyframes,poseProgress:Number($('mechanismPose').value)/100,transitionDuration:readMechanismDuration()}):
        await growth.createAsync({...options,target:place(source.model)});
      if(request!==buildRequestId)return;
      active?.dispose();active=next;next=null;const previousMechanism=activeMechanismSource;activeMechanismSource=source.mechanism;if(previousMechanism&&previousMechanism!==activeMechanismSource)previousMechanism.dispose();
      if(preparedRuin!==pendingCover){releaseRootSnare();const previous=preparedRuin; /* Release the old cover and any superseded stone only when the new scene is ready. */previous?.cover.dispose();if(previous?.room!==ruinRoom)disposeRoomModel(previous?.room);preparedRuin=pendingCover;if(preparedRuin)scene.add(preparedRuin.cover.group);}
      if(preparedRuin)for(const part of preparedRuin.cover.partPlan){part.mesh.visible=true;part.mesh.material=preparedRuin.room.stoneMaterial;} // Prepared scenery keeps one permanent stone finish; imported guides remain independent.
      if(room)$('ruinStatus').textContent=`1 room · ${room.walls} solid walls · ${room.roomWidth} × ${room.roomDepth} room · ${room.floorStones} quarter-scale floor stones (4 × 4 tiles) · ${room.pillars} plain pillars · ${room.pieces} Stone Age pieces (${Math.round(room.rockRoughness*100)}% roughness). Stone is always visible. Farm cliff texture fitted after rockification. Denser Temple roots (60–150%) + woven vines (100–150%) cover walls and floor; Grow/Reset affects only the new shape.`;
      buildState.running=false;buildMessage('ready','Preview ready. Press Grow to animate.');
      scene.add(active.group); rebuildMarkers();buildRootSnare();watchSceneTextures();previewDirty=true;
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
    const message = (info.substrate==='ruin'?'Temple-covered ruin + ':'') + source.name + ' · ' + percent + '% grown\n' +
      info.branchCount + ' branches · ' + info.floorStrands + (info.preparedVegetation?' existing vegetation strands · ':' floor wraps · ') +
      info.shapeStrands + (info.continuousStrandReveal?' smooth, tapered shape strands · ':' shape wraps · ') + info.shrinkwrapHits + '/' + info.shrinkwrapRays +
      ' inward hits\n' + (info.rootNetwork?info.rootNetwork.contactCount+' contacts · '+info.rootNetwork.junctions+' junctions · '+info.rootNetwork.knots+' knots\n':'') + info.groundedParts.length + ' grounded parts → ' +
      (info.partCount-info.groundedParts.length) + ' raised parts (' +
      info.rootTransferCount + ' connecting shoots, depth ' + info.maxPartDepth + ')';
    if (force || message !== lastStatus) { status.textContent = message; lastStatus = message; }
    if(info.mechanism){const pose=Math.round(info.mechanism.poseProgress*100),label=pose+'%',message=info.mechanism.keyframeCount+' keyframes · '+info.mechanism.uniqueStates+' rooted states · growth/retraction only';if($('mechanismPose').value!==String(pose))$('mechanismPose').value=String(pose);if($('mechanismPoseValue').textContent!==label)$('mechanismPoseValue').textContent=label;if($('mechanismStatus').textContent!==message)$('mechanismStatus').textContent=message;}
    const details = JSON.stringify({
      source:{kind:source.kind,name:source.name,file:source.file}, recipe:active.recipe,appearance:readPreviewColors(),
      environment:$('previewEnvironment').value,ruin:$('previewEnvironment').value==='ruin'?
        {rooms:ruinRoom?.rooms,walls:ruinRoom?.walls,floors:ruinRoom?.floors,seed:ruinRoom?.seed,rockPieces:ruinRoom?.pieces,rockRoughness:ruinRoom?.rockRoughness,pieceSet:ruinRoom?.pieceSet,floorProps:ruinRoom?.floorProps,pillars:ruinRoom?.pillars,stoneTexture:ruinRoom?.stoneMaterial.map?.userData,stoneSurfaceMappings:ruinRoom?.model.children.map(mesh=>({role:mesh.userData.ruinPreviewRole,...mesh.userData.stoneSurfaceMapping})),wallPrismDepth:ruinRoom?.wallPrismDepth,floorStyle:ruinRoom?.floorStyle,floorStones:ruinRoom?.floorStones,floorYScale:ruinRoom?.floorYScale,floorTileScale:ruinRoom?.floorTileScale,floorTileCopies:ruinRoom?.floorTileCopies,roomWidth:ruinRoom?.roomWidth,roomDepth:ruinRoom?.roomDepth,cover:preparedRuin?.cover.getDiagnostics()}:null,
      targetPosition:readPosition().toArray(),rootSnare:rootHands?.diagnostics()||null,roamingNpc:roamingNpc?.diagnostics()||null, ...info
    }, null, 2);
    if (force || details !== lastDebug) { diagnostics.textContent = details; lastDebug = details; }
  }
  function syncMechanismControls(){
    const disabled=buildState.running||!active?.setPoseProgress||source.kind!=='ruin-mechanism'; // Existing furniture imports retain their normal Grow/Reset behaviour.
    for(const id of ['mechanismPose','mechanismActivate','mechanismReset'])if($(id)&&$(id).disabled!==disabled)$(id).disabled=disabled;
  }
  function readMechanismDuration(){const value=Number($('mechanismDuration').value);return Number.isFinite(value)?Math.max(.15,Math.min(30,value)):.65;}
  function clearMechanismSource(invalidate=true){if(invalidate){mechanismLoadId++;$('loadMechanism').disabled=false;}const previous=source.mechanism;source.mechanism=null;if(previous&&previous!==activeMechanismSource)previous.dispose();syncMechanismControls();} // Rendered poses retain their guide resources until the next successful rebuild.
  async function loadMechanism(type,seed=null,rebuildNow=true){
    const request=++mechanismLoadId,button=$('loadMechanism');button.disabled=true;$('mechanismStatus').textContent='Loading existing ruin keyframes…'; // Ignore obsolete preset requests while the hidden generator loads.
    let specification=null;
    try{
      const api=await ruinGenerator();api.pausePreviewLoop();specification=api.createRootMechanismKeyframes(type,seed||readRecipe().seed+':'+type);
      if(request!==mechanismLoadId){specification.dispose();return;}
      clearMechanismSource(false);source.mechanism=specification;source.kind='ruin-mechanism';source.name='Root '+specification.name;source.file=type;source.data=null;source.model=specification.states[0].target;$('mechanismType').value=type;
      if(rebuildNow){$('mechanismPose').value='0';$('targetX').value='0';$('targetY').value=String(ruinRoom?.floorY??.06);$('targetZ').value='0';$('previewEnvironment').value='ruin';await rebuild(false);if(active?.setPoseProgress){active.setProgress(1);previewDirty=true;updateStatus(true);}}
    }catch(error){if(specification&&source.mechanism!==specification)specification.dispose();throw error;}
    finally{if(request===mechanismLoadId)button.disabled=false;syncMechanismControls();}
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
      clearMechanismSource();source.kind = entry.kind === 'procedural' ? 'repo-procedural' : 'repo-authored';
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
      const coverRecipes=temple.surfaceGrowth?.filter(item=>item.kind==='roots'||item.kind==='vines'); // Read all authored layers instead of approximating Temple vegetation with the structure controls.
      if(!coverRecipes?.length)throw new Error('Temple surface-growth layers are missing.');
      templeCoverRecipes=JSON.parse(JSON.stringify(coverRecipes));
      templeRootFinish = {color:layer.color,texture:layer.texture};
      if (active&&!buildState.running) rebuild(true); // Regenerate the preview using the actual authored Temple finish.
    } catch(error) {
      // The flat preview retains its root finish fallback; ruin preparation requires the actual Temple layers.
      templeSettingsLoad=null; // A failed fetch can be retried when preparing the ruin.
      const message = 'Temple vegetation settings unavailable: ' + error.message;
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
      clearMechanismSource();source.kind = 'glb'; source.name = file.name; source.data = null; source.file = file.name; source.model = gltf.scene;
    } else if (ext === 'json') {
      const json = JSON.parse(await file.text());
      const model = buildAuthoredFurniture(json);
      await waitForFurnitureGlbs(model);
      clearMechanismSource();source.kind = 'authored-furniture'; source.name = file.name; source.data = json; source.file = file.name; source.model = model;
    } else throw new Error('Choose a GLB or Furniture + Avatar Author JSON.');
    $('targetY').value = source.kind === 'glb' ? '1.5' : '0.6';
    rebuild(false);
  }
  function exportedRecipe() {
    return {schema:'hobunji_live_root_growth.v1',
      environment:$('previewEnvironment').value,ruinSize:$('ruinSize').value,ruinRoughness:readRuinRoughness(),appearance:readPreviewColors(),
      recipe:readRecipe(), position:readPosition().toArray(),
      target:{kind:source.kind,file:source.file,...(source.mechanism?{mechanism:{type:source.mechanism.type,seed:source.mechanism.seed,pose:active?.getPoseProgress?.()??Number($('mechanismPose').value)/100,duration:readMechanismDuration()}}:{}),
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
  async function copyText(text){
    try{await navigator.clipboard.writeText(text);return true;}
    catch{const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.focus();area.select();const copied=document.execCommand('copy');area.remove();return copied;}
  }
  async function copyJson(){status.textContent+=await copyText(JSON.stringify(exportedRecipe(),null,2))?'\nRecipe copied.':'\nCopy unavailable. Use Export JSON.';}
  async function copyColors(){const colors=readPreviewColors();$('colorStatus').textContent=await copyText(`Stone: ${colors.stoneColor} · HSL(${colorHslLabel('stoneColor')})\nRoots: ${colors.rootColor} · HSL(${colorHslLabel('rootColor')})`)?`Copied: stone ${colors.stoneColor} · roots ${colors.rootColor}`:'Copy unavailable. Hex values are shown beside each picker.';}
  async function importRecipe(file) {
    const json = JSON.parse(await file.text());
    if (json.schema !== 'hobunji_live_root_growth.v1') throw new Error('Not a live-root-growth recipe.');
    fillRecipe(json.recipe);
    syncPreviewColors(json.appearance||PREVIEW_COLORS);
    updatePreviewColor('stoneColor');
    $('previewEnvironment').value=json.environment==='ruin'?'ruin':'flat';
    $('ruinSize').value=['small','medium','large','vast'].includes(json.ruinSize)?json.ruinSize:'vast';
    $('ruinRoughness').value=String(readRuinRoughness(json.ruinRoughness??.3));
    if (Array.isArray(json.position) && json.position.length >= 3) ['targetX','targetY','targetZ'].forEach((id,i) => {
      const n = Number(json.position[i]); if (Number.isFinite(n)) $(id).value = String(n);
    });
    if(json.target?.kind==='demo'){clearMechanismSource();source.model=demoModel();source.kind='demo';source.name='Raised platform (demo)';source.data=null;source.file=null;}
    else if(json.target?.kind==='ruin-mechanism'&&json.target.mechanism){
      $('mechanismDuration').value=String(Number(json.target.mechanism.duration)||.65);$('mechanismPose').value=String(Math.max(0,Math.min(1,Number(json.target.mechanism.pose)||0))*100);
      await loadMechanism(json.target.mechanism.type,json.target.mechanism.seed,false);
    }else if (['authored-furniture','repo-authored','repo-procedural'].includes(json.target?.kind) &&
        Array.isArray(json.target.furniture?.parts)) {
      const model = buildAuthoredFurniture(json.target.furniture);
      await waitForFurnitureGlbs(model);
      clearMechanismSource();source.model=model;source.data=json.target.furniture;source.kind=json.target.kind;
      source.name=json.target.file ? humanizeKey(json.target.file.split('/').pop().replace(/\.json$/,'')) : 'Embedded furniture';
      source.file=json.target.file||null;
    } else if (json.target?.kind === 'glb') {
      if (source.kind !== 'glb' || source.file !== json.target.file) {
        pendingRecipe = json;
        status.textContent = 'Recipe settings imported. Now import its separate GLB: '+(json.target.file||'unnamed GLB');
        return;
      }
    }
    pendingRecipe=null;await rebuild(false);if(source.mechanism){active?.setProgress(1);previewDirty=true;updateStatus(true);}
  }
  function resize() {
    const rect=$('render').getBoundingClientRect(), w=Math.max(1,Math.floor(rect.width)),h=Math.max(1,Math.floor(rect.height));
    renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();previewDirty=true;
  }
  for(const id of Object.keys(PREVIEW_COLORS)){
    $(id).oninput=()=>{if(updatePreviewColor(id))scheduleColorPreview(id);};
    $(id).onchange=()=>{if(updatePreviewColor(id))scheduleColorPreview(id,true);};
    $(id+'Hex').onchange=()=>{if(updatePreviewColor(id,true))scheduleColorPreview(id,true);};
    for(const axis of ['H','S','L']){
      $(id+axis).oninput=()=>{if(updateColorHsl(id))scheduleColorPreview(id);};
      $(id+axis).onchange=()=>{if(updateColorHsl(id))scheduleColorPreview(id,true);};
    }
  }
  $('loadMechanism').onclick=()=>loadMechanism($('mechanismType').value).catch(reportError);
  $('mechanismActivate').onclick=()=>{active?.setPoseTarget?.(1);};
  $('mechanismReset').onclick=()=>{active?.setPoseTarget?.(0);};
  $('mechanismPose').oninput=()=>{active?.setPoseProgress?.(Number($('mechanismPose').value)/100);previewDirty=true;updateStatus(true);};
  $('mechanismDuration').onchange=()=>{$('mechanismDuration').value=String(readMechanismDuration());if(source.mechanism)rebuild();};
  $('copyColors').onclick=()=>copyColors().catch(reportError);
  $('snareEnabled').onchange=()=>{if($('snareEnabled').checked&&$('previewEnvironment').value!=='ruin'){$('previewEnvironment').value='ruin';rebuild(false);}else buildRootSnare();};
  $('snareBuild').onclick=buildRootSnare;
  $('snareReroute').onclick=()=>roamingNpc?.chooseTarget();
  $('snareReveal').onchange=()=>{rootHands?.setNodeVisibility($('snareReveal').checked);previewDirty=true;};
  for(const id of ['snareCount','snareRadius','snareReach','snareExtend','snareRetract','snareRunnerSpeed'])$(id).onchange=buildRootSnare;
  $('rebuild').onclick=()=>rebuild();
  $('cancelBuild').onclick=cancelBuild;
  $('previewEnvironment').onchange=()=>rebuild(false);
  $('ruinRoughness').onchange=()=>{$('ruinRoughness').value=String(readRuinRoughness());if($('previewEnvironment').value==='ruin')rebuild();};
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
    getPreparedRuin:()=>preparedRuin,getInstance:()=>active,loadMechanism,setMechanismProgress:value=>{active?.setPoseProgress?.(value);previewDirty=true;}, // Allows exact hidden geometry, growth stages and disposal checks without renderer interception.
    diagnostics:()=>active?.getDiagnostics(),getRootSnareDiagnostics:()=>rootHands?.diagnostics(),getRoamingNpcDiagnostics:()=>roamingNpc?.diagnostics(),
    moveRoamingNpcTo:(x,z)=>{if(!roamingNpc)return false;roamingNpc.group.position.x=Number(x);roamingNpc.group.position.z=Number(z);previewDirty=true;return true;},
    refreshRepoFurniture, getRepoCount:()=>repoCatalog.size}; // Built-in mobile diagnostic hook for the Tools Hub.
  if (window.ResizeObserver) new ResizeObserver(resize).observe($('render'));else window.addEventListener('resize',resize);
  function watchSceneTextures(){
    watchedTextures.clear();scene.traverse(mesh=>{for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])if(material?.map)watchedTextures.set(material.map,material.map.version);}); // Collect once after a rebuild, never traverse the scene in the animation loop.
  }
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
    lastTimestamp=timestamp;if(!buildState.running){active?.update(delta);if(roamingNpc?.update(delta))previewDirty=true;
      if(rootHands?.update(delta,roamingNpc.group))previewDirty=true;
      if(rootHands&&timestamp-lastHandStatus>300){const info=rootHands.diagnostics();$('snareStatus').textContent=info.anchors.length+' fixed nodes · '+info.active+' reaching · '+info.lungeCount+' triggered · runner: '+(roamingNpc?.diagnostics().authenticFeet?'procedural feet':'torso only');lastHandStatus=timestamp;}}
    orbit.update();
    const progress=active?.getProgress()??0; // Growth and particle playback still render while static repeated floor meshes can rest.
    const version=active?.getRenderVersion?.()??0;if(active!==renderedActive||progress!==renderedProgress||version!==renderedVersion)previewDirty=true;
    for(const [texture,version] of watchedTextures)if(texture.version!==version){watchedTextures.set(texture,texture.version);previewDirty=true;}
    if(previewDirty||(!buildState.running&&progress>=1&&active?.emitterVisuals?.length)){renderSceneWithShellOutlines();previewDirty=false;renderedActive=active;renderedProgress=progress;renderedVersion=version;}
    if (active && (timestamp % 220 < 18)) updateStatus();
  }
  syncPreviewColors();
  templeSettingsLoad=loadTempleRootFinish();
  resize();rebuild(false);requestAnimationFrame(frame);
  refreshRepoFurniture().catch(reportError);
})();

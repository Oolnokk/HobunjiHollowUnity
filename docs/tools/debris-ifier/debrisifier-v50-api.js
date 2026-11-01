// Small bridge around the exact Debris-ifier V50 source for dev/runtime playtests.
// This file intentionally lives in the same classic-script realm as V50 so it can
// expose the generator without copying or reimplementing any of its constructors.
(() => {
  'use strict';

  let previewLoopPaused = false;

  let activePieceSet=null,pieceSetPromise=null,activePillarsOnly=false; // Opt-in visual equivalents; normal Harlyao generation keeps its original asset paths and data.
  const resolveOriginalRuinAsset=resolveRuinAsset; // The immutable V50 resolver remains the placement and footprint authority.
  resolveRuinAsset=async function(path){
    const asset=await resolveOriginalRuinAsset(path),key=String(path||'').split('/').pop().replace(/\.json$/i,'');
    const replacement=activePieceSet?.mapping?.[key];
    if(!asset||!replacement)return asset;
    const data=await fetchRepoFurnitureData('docs/'+replacement); // Reuse the generator's existing repository cache/branch-aware URL loader.
    return {...asset,data,pieceSet:activePieceSet.id,equivalentKey:key}; // Keep asset.name, path and footprint exactly as Harlyao's mapping expects.
  };
  async function selectPieceSet(name){
    if(name!=='stoneAge'){activePieceSet=null;return;}
    if(!pieceSetPromise)pieceSetPromise=fetch(new URL('../../config/ruin-piece-sets/stone-age.json',location.href)).then(response=>{
      if(!response.ok)throw new Error('Stone Age piece set HTTP '+response.status);return response.json();
    }).then(data=>{
      if(data.schema!=='hobunji_ruin_piece_set.v1'||data.id!=='stoneAge'||!data.mapping)throw new Error('Invalid Stone Age ruin piece set.');
      for(const path of Object.values(data.mapping))if(!/^config\/ruin-piece-sets\/stone-age\/[a-z_]+\.json$/.test(path))throw new Error('Invalid Stone Age piece path.');
      return data;
    }).catch(error=>{pieceSetPromise=null;throw error;});
    activePieceSet=await pieceSetPromise;
  }

  const originalSupportPillarSlots=interiorSupportPillarSlots; // Reuse V50's support lattice when the preview removes the display props that would otherwise reserve those slots.
  interiorSupportPillarSlots=function(room,network,plateau,bridgeCorridors,pillarDenseRoom){
    return originalSupportPillarSlots(room,network,activePillarsOnly?{...plateau,focuses:[]}:plateau,bridgeCorridors,pillarDenseRoom);
  };

  // The recovered V50 source is immutable (verified by its SHA in regression
  // tests). Its existing bridge owns these material overrides for all ruins.
  createSharedRuinStoneMaterial = async function () {
    const texture = (await processedRepoTexture(DEFAULT_TEXTURE_PATH, false)).clone(); // Same unfilled PNG used by the sanctum door and standing braziers.
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    return new THREE.MeshBasicMaterial({ color:0xffffff, map:texture, side:THREE.DoubleSide });
  };

  applyFurniturePartTextureAsync = function (material, part) {
    if (!part.materialTexture) return null;
    const fill = part.materialFillMode !== 'never' && !!part.materialFillEnabled; // Honors the bronze furniture's authored adaptive shade-fill settings.
    return processedRepoTexture(furnitureTexturePath(part.materialTexture), fill, part.materialFillColor || '#ffffff').then(base => {
      const texture = base.clone(); // Independent rotation/sampling while retaining the processed image.
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.center.set(.5, .5);
      texture.rotation = (+part.materialRotationDeg || 0) * DEG;
      texture.needsUpdate = true;
      material.map = texture;
      material.color.setHex(0xffffff);
      material.needsUpdate = true;
    });
  };


  function normalizeRuntimePuzzleOptions(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {}; // Used to safely normalize the parent game's persisted puzzle-generation payload.
    return {
      pressurePlate: source.pressurePlate !== false,
      brazier: source.brazier !== false,
      glyphObelisk: source.glyphObelisk !== false,
      stackedObelisk: source.stackedObelisk !== false,
      linkedCubePillars: source.linkedCubePillars !== false,
      nestedRoom: source.nestedRoom !== false,
      maxPerRoom: Math.max(0, Math.min(12, Math.floor(Number(source.maxPerRoom) || 0))),
    };
  }

  function cloneJson(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function detachObject(root) {
    if (root?.parent?.remove) root.parent.remove(root);
  }

  function restorePreviewRoots() {
    if (localePreviewRoot.parent !== scene) {
      detachObject(localePreviewRoot);
      localePreviewRoot.position.set(0, 0, 0);
      localePreviewRoot.rotation.set(0, 0, 0);
      localePreviewRoot.scale.set(1, 1, 1);
      scene.add(localePreviewRoot);
    }
    if (mechanismParticleRoot.parent !== scene) {
      detachObject(mechanismParticleRoot);
      mechanismParticleRoot.position.set(0, 0, 0);
      mechanismParticleRoot.rotation.set(0, 0, 0);
      mechanismParticleRoot.scale.set(1, 1, 1);
      scene.add(mechanismParticleRoot);
    }
  }

  // V50 keeps the authoritative per-cell elevation map on its generated
  // Roughbrick floor mesh because the standalone preview can query the scene
  // directly. The game bridge needs that same map after the roots leave this
  // iframe, so mirror it into exported metadata without changing V50 source.
  function hydrateInteriorPlateauLevels() {
    const shell = lastGeneratedLocale?.meta?.interiorShell;
    if (!shell?.plateauModel || !localePreviewRoot?.traverse) return null;
    let floor = null;
    localePreviewRoot.traverse(object => {
      if (floor) return;
      const model = object.userData?.plateauModel;
      if (object.userData?.wallBuilderRecipe === 'wallrecipe2.json' && model?.levelByCell) floor = object;
    });
    const floorModel = floor?.userData?.plateauModel;
    if (!floorModel?.levelByCell) return shell.plateauModel;
    shell.plateauModel.levelByCell = { ...floorModel.levelByCell };
    if (Number.isFinite(Number(floorModel.stepHeight))) shell.plateauModel.stepHeight = Number(floorModel.stepHeight);
    shell.plateauModel.runtimeLevelSource = floor.name || 'V50 Roughbrick floor mesh';
    return shell.plateauModel;
  }

  // Preserve and render V50's actual carved-smooth PlaneGeometry walls in the
  // game scene. We do not rebuild them as boxes: the prototype mesh, geometry,
  // transforms and texture map are retained. Only a per-wall material clone is
  // made so the game can see both faces regardless of camera/scene orientation.
  function prepareRuntimeWallPlanes() {
    let count = 0;
    localePreviewRoot?.traverse?.(object => {
      if (!object.userData?.ruinInteriorWall || !object.isMesh) return;
      count++;
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
      const runtimeMaterials = sourceMaterials.map(material => {
        if (!material) return material;
        const runtime = material.clone?.() || material;
        runtime.side = THREE.DoubleSide;
        runtime.transparent = false;
        runtime.opacity = 1;
        runtime.depthTest = true;
        runtime.depthWrite = true;
        runtime.needsUpdate = true;
        return runtime;
      });
      object.material = Array.isArray(object.material) ? runtimeMaterials : runtimeMaterials[0];
      object.visible = true;
      object.frustumCulled = false;
      object.castShadow = true;
      object.receiveShadow = true;
      object.userData.runtimeWallPlaneRendered = true;
      object.userData.runtimeWallPlaneSource = 'DebrisifierV50 ruinInteriorWall';
    });
    return count;
  }

  function runtimeWallPlaneState() {
    let count = 0, visible = 0, doubleSided = 0;
    localePreviewRoot?.traverse?.(object => {
      if (!object.userData?.ruinInteriorWall || !object.isMesh) return;
      count++;
      if (object.visible !== false) visible++;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.length && materials.every(material => material?.side === THREE.DoubleSide)) doubleSided++;
    });
    return { count, visible, doubleSided };
  }

  function runtimeHallwayState() {
    const shell = lastGeneratedLocale?.meta?.interiorShell;
    const cellSize = Number(shell?.cellSize) || .5;
    const rows = (shell?.hallways || []).map(hall => {
      const crossCells = hall.axis === 'x' ? Number(hall.h) : Number(hall.w);
      return { id:hall.id, axis:hall.axis, crossCells, prototypeWidth:crossCells * cellSize };
    });
    return {
      count:rows.length,
      minCrossCells:rows.length ? Math.min(...rows.map(row => row.crossCells)) : 0,
      maxCrossCells:rows.length ? Math.max(...rows.map(row => row.crossCells)) : 0,
      rows,
    };
  }

  // Treat V50 puzzle primitives as furniture instances. The geometry remains
  // V50-owned, while the shared furniture metadata makes it editable/reusable.
  function tagPuzzleFurniture(root) {
    const puzzleApi = window.FurniturePuzzleProperties;
    if (!root?.traverse || !puzzleApi) return [];
    const tagged = [];
    root.traverse(object => {
      const data = object.userData || {};
      const activator = data.activatorType;
      const motion = data.previewMotion?.type;
      if (!activator && !motion) return;
      const role = activator ? 'activator' : 'mechanism';
      const behavior = activator || motion;
      const furnitureKey = `ruin_${behavior}`;
      const puzzle = puzzleApi.applyToObject3D(object, {
        role, behavior, channel: String(data.puzzleChannel || data.linkedMechanismId || 'A'),
        blocksMovement: role === 'mechanism' && ['stoneDoor', 'bridge', 'collapsingStairs', 'pushPuzzleBlock', 'elevatorPushBlock'].includes(behavior),
        interactionRange: 1.65,
      }, furnitureKey);
      if (puzzle) tagged.push({ id: String(data.puzzleId || object.uuid), furnitureKey, puzzle });
    });
    return tagged;
  }

  async function generateInteriorLocale(options = {}) {
    activePillarsOnly=options.floorProps==='pillarsOnly';
    await selectPieceSet(options.pieceSet);
    restorePreviewRoots();
    await loadRepoFurnitureLibrary();
    window.__devRuinSingleRoomLarge = options.singleRoom === true && options.roomPreset === 'veryLarge'; // Root preview opts into the generator's existing vast chamber preset.
    window.__devRuinSingleRoom = options.singleRoom === true; // Explicit root-author preview option; every ordinary generation restores the normal minimum.

    const puzzleOptions = normalizeRuntimePuzzleOptions(options.puzzles); // Used by the embedded V50 patch while this one interior is generated.
    window.__devRuinPuzzleOptions = puzzleOptions;
    window.__devRuinPuzzleCounts = new Map(); // Used by the embedded patch to enforce the per-room top-level puzzle cap for this generation only.
    window.__devRuinPuzzleClaimedMechanisms = new Set(); // Used to keep recursive/fallback activator creation from consuming a room slot twice.

    $('localeSeed').value = String(options.seed ?? 'dev-ruin');
    $('localeSize').value = options.size || 'medium';
    $('localeEnvironment').value = 'interior';
    $('localeDensity').value = String(options.density ?? 62);
    $('interiorRoomMin').value = String(options.roomMin ?? 3);
    $('interiorRoomMax').value = String(options.roomMax ?? 8);
    syncLocaleEnvironmentControls();
    updateOutputs();

    await generateRuinsLocalePreview({ keepCurrentSeed: true });
    if (!lastGeneratedLocale || lastGeneratedLocale.meta?.environment !== 'interior') {
      throw new Error($('localeStatus')?.textContent || 'V50 did not produce an interior ruin.');
    }
    hydrateInteriorPlateauLevels();
    const puzzleFurniture = tagPuzzleFurniture(localePreviewRoot);
    const wallPlaneCount = prepareRuntimeWallPlanes();
    const hallwayState = runtimeHallwayState();
    if (hallwayState.count && hallwayState.minCrossCells < 5) {
      throw new Error(`Embedded V50 hallway clearance regressed below 5 cells (${hallwayState.minCrossCells}).`);
    }
    if (!wallPlaneCount) throw new Error('V50 interior generated no renderable wall planes.');

    return {
      seed: $('localeSeed').value,
      pieceSet:activePieceSet?.id||'harlyao',
      locale: cloneJson(lastGeneratedLocale),
      status: $('localeStatus')?.textContent || '',
      runtimeWallPlanes: runtimeWallPlaneState(),
      runtimeHallways: hallwayState,
      puzzleOptions: cloneJson(puzzleOptions),
      puzzleGeneration:{
        countsByRoom:Object.fromEntries(window.__devRuinPuzzleCounts || []),
        claimedMechanisms:[...(window.__devRuinPuzzleClaimedMechanisms || [])],
      },
      puzzleFurniture,
    };
  }

  // Exposes V50's already-tested purposeful outdoor ruin path without
  // duplicating or modifying the SHA-protected generator source.
  async function generateOutdoorLocale(options = {}) {
    activePillarsOnly=false;
    await selectPieceSet(options.pieceSet);
    restorePreviewRoots();
    await loadRepoFurnitureLibrary();
    $('localeSeed').value = String(options.seed ?? 'outdoor-ruin');
    $('localeSize').value = options.size || 'medium';
    $('localeEnvironment').value = 'outdoor';
    $('localeDensity').value = String(options.density ?? 62);
    $('localeSunkenChance').value = String(options.sunkenChance ?? 18);
    syncLocaleEnvironmentControls();
    updateOutputs();
    await generateRuinsLocalePreview({ keepCurrentSeed: true });
    if (!lastGeneratedLocale || lastGeneratedLocale.meta?.environment !== 'outdoor') {
      throw new Error($('localeStatus')?.textContent || 'V50 did not produce an outdoor ruin.');
    }
    const puzzleFurniture = tagPuzzleFurniture(localePreviewRoot);
    return {
      seed: $('localeSeed').value,
      locale: cloneJson(lastGeneratedLocale),
      status: $('localeStatus')?.textContent || '',
      puzzleFurniture,
    };
  }

  function takePreviewRoots() {
    detachObject(localePreviewRoot);
    detachObject(mechanismParticleRoot);
    return { localeRoot: localePreviewRoot, particleRoot: mechanismParticleRoot };
  }

  function pausePreviewLoop() {
    if (previewLoopPaused) return;
    previewLoopPaused = true;
    window.requestAnimationFrame = () => 0;
  }

  function setMechanismTarget(active) {
    mechanismTargetState = active ? 1 : 0;
    updateMechanismButton();
    return mechanismTargetState;
  }

  function snapMechanismState(progress) {
    mechanismProgress = clamp(Number(progress) || 0, 0, 1);
    mechanismTargetState = mechanismProgress;
    snapMechanisms(localePreviewRoot, mechanismProgress);
    updateMechanismButton();
    return mechanismProgress;
  }

  function applyProgress(root, progress) {
    const normalizedProgress = clamp(Number(progress) || 0, 0, 1); // Used by both the general V50 mechanism animation and direct leaf-activator visual synchronization.
    if(root?.rootGrowthBinding){applyMechanismProgress(root,normalizedProgress);root.rootGrowthBinding.setProgress(normalizedProgress);return;} // Hidden logical anchors still position glyphs/effects; only rooted keyframes render or provide support.
    applyMechanismProgress(root, normalizedProgress);
    if (root?.userData?.activatorType === 'glyphObelisk' && root.userData?.decalMaterials) {
      setDecalMaterialsProgress(root.userData.decalMaterials, normalizedProgress);
      if (root.userData.glowLight) root.userData.glowLight.intensity = 3.2 * normalizedProgress;
    }
  }

  function captureRootMechanismKeyframes(object,options={}){
    const saved=[],signals=[],meshes=[],anchor=object.getWorldPosition(new THREE.Vector3()),states=[],keyframes=[],geometries=new Map(),material=new THREE.MeshBasicMaterial({color:0x808080});
    object.traverse(node=>{saved.push({node,position:node.position.clone(),quaternion:node.quaternion.clone(),scale:node.scale.clone(),visible:node.visible});if(node.isMesh&&node.geometry?.getAttribute('position'))meshes.push(node);});
    for(const signal of [object.userData?.linkedCubePuzzleRoot,object.userData?.linkedPressurePlateRoot])if(signal&&!signals.some(entry=>entry.signal===signal))signals.push({signal,solve:signal.userData.solveProgress,weight:signal.userData.weightProgress});
    let frames=object.userData?.previewMotion?.type==='bridgeSequence'?[0,.22,.76,1]:[0,1];const signatures=new Map();let complete=false;
    const pose=progress=>{for(const {signal} of signals){signal.userData.solveProgress=progress;signal.userData.weightProgress=progress;}if(options.applyPose)options.applyPose(progress);else applyMechanismProgress(object,progress);object.updateWorldMatrix(true,true);};
    try{
      if(['movingDais','collapsingStairs'].includes(object.userData?.previewMotion?.type)){
        pose(0);const initial=meshes.map(mesh=>new THREE.Box3().setFromObject(mesh));pose(1);let distance=0;
        meshes.forEach((mesh,index)=>{const box=new THREE.Box3().setFromObject(mesh);distance=Math.max(distance,Math.abs(box.min.y-initial[index].min.y),Math.abs(box.max.y-initial[index].max.y));});
        const steps=Math.max(1,Math.ceil(distance/.25));if(steps>15)throw new Error('Root mechanism elevation exceeds the safe keyframe budget.');
        frames=Array.from({length:steps+1},(_,index)=>index/steps); // Stationary growth steps keep elevation changes below ordinary walking clearance without moving invisible riders.
      }
      for(const progress of frames){
        pose(progress);
        const signature=meshes.map(mesh=>mesh.matrixWorld.elements.map(value=>value.toFixed(7)).join(',')).join('|');let state=signatures.get(signature);
        if(state==null){state=states.length;const target=new THREE.Group();
          for(let index=0;index<meshes.length;index++){const mesh=meshes[index];if((Array.isArray(mesh.material)?mesh.material:[mesh.material]).every(m=>m?.transparent||m?.depthWrite===false))continue;
            let geometry=geometries.get(mesh.geometry);if(!geometry){geometry=mesh.geometry.clone();geometries.set(mesh.geometry,geometry);}
            const copy=new THREE.Mesh(geometry,material);mesh.matrixWorld.decompose(copy.position,copy.quaternion,copy.scale);copy.position.sub(anchor);copy.name=mesh.name;copy.userData.authoredPartId='runtime-piece-'+index;
            const type=object.userData?.previewMotion?.type;let eligible=true;
            if(type==='movingDais'){eligible=false;for(let node=mesh;node&&node!==object;node=node.parent){if(node.userData?.groundedToMovingPlatform)break;if(node===object.userData.movingDaisPlatform){eligible=true;break;}}}
            if(type==='collapsingStairs'){eligible=false;for(let node=mesh;node&&node!==object;node=node.parent)if(object.userData.stairTreads?.includes(node)){eligible=true;break;}}
            copy.userData.rootSupportEligible=eligible;target.add(copy);
          }if(!target.children.length)throw new Error('Root mechanism has no physical pieces.');states.push({target});signatures.set(signature,state);
        }keyframes.push({progress,state});
      }
      let disposed=false;complete=true;return {anchor,states,keyframes,dispose(){if(disposed)return;disposed=true;for(const geometry of geometries.values())geometry.dispose();material.dispose();}};
    }finally{
      for(const entry of saved){entry.node.position.copy(entry.position);entry.node.quaternion.copy(entry.quaternion);entry.node.scale.copy(entry.scale);entry.node.visible=entry.visible;}object.updateWorldMatrix(true,true);
      for(const entry of signals){if(entry.solve===undefined)delete entry.signal.userData.solveProgress;else entry.signal.userData.solveProgress=entry.solve;if(entry.weight===undefined)delete entry.signal.userData.weightProgress;else entry.signal.userData.weightProgress=entry.weight;}
      if(!complete){for(const geometry of geometries.values())geometry.dispose();material.dispose();}
    }
  }

  function createRootMechanismKeyframes(type,seed='root-mechanism'){
    const material=new THREE.MeshBasicMaterial({color:0x808080}),rng=seededRng(seed),labels={bridge:'Retracting bridge',bridgeSequence:'Timed bridge',stoneDoor:'Stone door',movingDais:'Rising platform',collapsingStairs:'Collapsing stairs',rotatingObelisk:'Rotating obelisk',linkedCubePair:'Linked cube solution',pushPuzzleBlock:'Push-block route',elevatorPushBlock:'Lifted push block',pressurePlate:'Pressure plate'}; // Reuse the existing V50 constructors and motion evaluator, never a parallel mechanism shape implementation.
    if(!labels[type]){material.dispose();throw new Error('Unknown ruin mechanism: '+type);}
    let prototype,samples=[{progress:0,label:'Initial'},{progress:1,label:'Activated'}]; // Authored progress knots are sampled only during construction; rendered rooted poses never move.
    if(type==='bridge'||type==='bridgeSequence'){prototype=createRetractingStoneBridge(material,3.6,1.1,.22);prototype.position.y=.14;if(type==='bridgeSequence'){prototype.userData.previewMotion.type=type;samples=[{progress:0,label:'Retracted'},{progress:.22,label:'Extended'},{progress:.76,label:'Hold'},{progress:1,label:'Retracted'}];}}
    else if(type==='stoneDoor'){prototype=new THREE.Group();const frame=createStoneArchFrame(material,2,2.5,.38),door=createVerticalStoneDoor(material,1.35,2.2,.2);door.position.y=2.2;prototype.add(frame,door);}
    else if(type==='movingDais')prototype=createRisingCollapsingDais(material,1.5,1.5,1.1,false);
    else if(type==='collapsingStairs')prototype=createCollapsingStoneStairway(material,1.2,1.2,2,5,true);
    else if(type==='rotatingObelisk')prototype=createStackedRotatingObeliskActivator(material,rng);
    else if(type==='linkedCubePair'){
      prototype=createLinkedDoorCubePair(material,rng);const moves=findLinkedCubeSolution(prototype.userData.states)||[],states=[prototype.userData.states.slice()]; // Keep the prototype's actual 2x2 linkage and solve path.
      for(const move of moves)states.push(linkedCubeApplyMoveState(states.at(-1),move.control,move.direction));
      samples=states.map((states,index)=>({progress:index/Math.max(1,moves.length),states,label:index?'Turn '+LINKED_CUBE_LABELS[moves[index-1].control]+(moves[index-1].direction>0?' clockwise':' counter-clockwise'):'Scrambled'}));
      if(samples.length===1)samples.push({progress:1,states:states[0],label:'Solved'});
    }else if(type==='pushPuzzleBlock'||type==='elevatorPushBlock'){
      prototype=createPushPuzzleBlock(material);const path=[{x:-1,y:0,z:-.5},{x:0,y:0,z:-.5},{x:0,y:0,z:.5},{x:1,y:0,z:.5}]; // Illustrative route uses the generator's existing per-push and lift timing.
      prototype.userData.pushPath=path;prototype.userData.pushStart=path[0];prototype.userData.pushTarget=path.at(-1);
      if(type==='elevatorPushBlock'){prototype.userData.previewMotion.type=type;prototype.userData.elevatorHighY=.9;prototype.userData.pushPath=path.map(point=>({...point,y:.9}));samples=[{progress:0,label:'Low'},{progress:.45,label:'Lifted'},...path.slice(1).map((_,index)=>({progress:.45+.55*(index+1)/3,label:'Route '+(index+1)}))];}
      else samples=path.map((_,index)=>({progress:index/3,label:'Push '+index}));
    }else{
      prototype=createPressurePlateActivator(material);prototype.userData.linkedWeightBlock={position:new THREE.Vector3(1.2,0,0),userData:{pushBlockSize:.62}};
    }
    const states=[],keyframes=[],signatures=new Map(),geometries=new Map(),guideMaterial=new THREE.MeshBasicMaterial({color:0x808080}); // Shared immutable guide buffers remain separate from the native prototype's lifetime.
    let complete=false;
    try{
      for(const sample of samples){
        if(sample.states)setLinkedCubePuzzleState(prototype,sample.states,false);
        else{if(type==='pressurePlate')prototype.userData.linkedWeightBlock.position.x=1.2*(1-sample.progress);applyMechanismProgress(prototype,sample.progress);}
        prototype.updateWorldMatrix(true,true);const meshes=[]; // Flatten poses into plain guides; native userData contains live references unsuitable for cloning/serialization.
        prototype.traverse(mesh=>{if(!mesh.isMesh||!mesh.geometry?.getAttribute('position'))return;let node=mesh;while(node){if(node.visible===false)return;node=node.parent;}const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];if(materials.every(material=>material?.transparent||material?.depthWrite===false))return;meshes.push(mesh);});
        const signature=meshes.map(mesh=>mesh.geometry.uuid+':'+mesh.matrixWorld.elements.map(value=>value.toFixed(7)).join(',')).join('|'); // Exact holds and return-to-start frames reuse the same rooted state.
        let state=signatures.get(signature);
        if(state==null){
          state=states.length;const target=new THREE.Group();target.name=labels[type]+' / '+sample.label;
          meshes.forEach((mesh,index)=>{let geometry=geometries.get(mesh.geometry);if(!geometry){geometry=mesh.geometry.clone();geometries.set(mesh.geometry,geometry);}const copy=new THREE.Mesh(geometry,guideMaterial);mesh.matrixWorld.decompose(copy.position,copy.quaternion,copy.scale);copy.name=mesh.name||labels[type]+' piece '+(index+1);copy.userData.authoredPartId='mechanism-piece-'+index;target.add(copy);});
          if(!target.children.length)throw new Error('The mechanism has no physical guide meshes.');states.push({target,label:sample.label});signatures.set(signature,state);
        }
        keyframes.push({progress:sample.progress,state,label:sample.label});
      }
      let disposed=false;complete=true;return {type,name:labels[type],seed:String(seed),states,keyframes,dispose(){if(disposed)return;disposed=true;for(const geometry of geometries.values())geometry.dispose();guideMaterial.dispose();}};
    }finally{
      linkedCubePuzzleRoots.delete(prototype);prototype.traverse(mesh=>{if(linkedCubeHitTargets.get(mesh)?.root===prototype)linkedCubeHitTargets.delete(mesh);});
      disposeObject(prototype);material.dispose();if(!complete){for(const geometry of geometries.values())geometry.dispose();guideMaterial.dispose();}
    }
  }

  function syncPressurePlates(root) {
    if (!root?.traverse) return;
    root.traverse(plateRoot => {
      if (plateRoot.userData?.previewMotion?.type !== 'pressurePlate') return;
      let weight = 0;
      const block = plateRoot.userData.linkedWeightBlock;
      if (block) {
        const dx = block.position.x - plateRoot.position.x;
        const dz = block.position.z - plateRoot.position.z;
        const dy = Math.abs(block.position.y - plateRoot.position.y);
        const dist = Math.hypot(dx, dz);
        const threshold = (block.userData.pushBlockSize || .62) * .58 + .34;
        const verticalThreshold = (block.userData.pushBlockSize || .62) * .72 + .18;
        if (dy < verticalThreshold) weight = clamp((threshold - dist) / Math.max(.08, threshold * .28), 0, 1);
      }
      plateRoot.userData.weightProgress = weight;
      plateRoot.userData.weightActive = weight > .82;
      if (plateRoot.userData.pressPlate) {
        plateRoot.userData.pressPlate.position.y = (plateRoot.userData.plateOpenY ?? .105)
          - (plateRoot.userData.plateDepress ?? .05) * weight;
      }
    });
  }

  function rotateLinkedCube(root, controlIndex, direction = 1) {
    return rotateLinkedCubeControl(root, Number(controlIndex) || 0, direction < 0 ? -1 : 1);
  }

  function tickRuntime(dt) {
    const safeDt = clamp(Number(dt) || 0, 0, .05);
    updateLinkedCubePuzzles(safeDt);
    updateMechanismParticleEffects(safeDt);
  }

  // Runtime-generated recovery access deliberately calls V50's real ladder
  // constructor instead of drawing a game-side stand-in.
  function createRuntimeStoneLadder(height, width = .72, depth = .12) {
    const material = new THREE.MeshStandardMaterial({
      color: hexToNum(RUIN_STONE_FILL), roughness: .92, metalness: .02,
    });
    const ladder = createStoneLadder(material, Math.max(.5, Number(height) || .5), width, depth);
    ladder.userData.runtimeRecoveryEgress = true;
    return ladder;
  }

  const KNOWN_MOTIONS = new Set([
    'bridge','bridgeSequence','stoneDoor','movingDais','collapsingStairs',
    'pushPuzzleBlock','elevatorPushBlock','pressurePlate','torch','brazier',
    'signalObelisk','rotatingObelisk','linkedCubePair',
  ]);
  const KNOWN_ACTIVATORS = new Set([
    'pressurePlate','torch','brazier','glyphObelisk','stackedObelisk','linkedCubePillars',
  ]);
  const KNOWN_ACCESS = new Set(['stoneStair','stoneLadder']);

  function inspectRuntimeTags(root) {
    const motions = new Set(), activators = new Set(), access = new Set(), unknown = [];
    let transitDoors = 0, staticDaises = 0, elevatorSockets = 0, ladders = 0;
    root?.traverse?.(object => {
      const d = object.userData || {};
      const motion = d.previewMotion?.type;
      if (motion) {
        motions.add(motion);
        if (!KNOWN_MOTIONS.has(motion)) unknown.push({ kind:'motion', value:motion, name:object.name || String(object.id) });
      }
      if (d.activatorType) {
        activators.add(d.activatorType);
        if (!KNOWN_ACTIVATORS.has(d.activatorType)) unknown.push({ kind:'activator', value:d.activatorType, name:object.name || String(object.id) });
      }
      if (d.generatedAccessType) {
        access.add(d.generatedAccessType);
        if (d.generatedAccessType === 'stoneLadder') ladders++;
        if (!KNOWN_ACCESS.has(d.generatedAccessType)) unknown.push({ kind:'access', value:d.generatedAccessType, name:object.name || String(object.id) });
      }
      if (d.transitDoor) transitDoors++;
      if (d.staticPuzzleDais) staticDaises++;
      if (d.elevatorWellSocket) elevatorSockets++;
    });
    return {
      motions:[...motions].sort(), activators:[...activators].sort(), access:[...access].sort(),
      transitDoors, staticDaises, elevatorSockets, ladders, unknown,
    };
  }

  async function auditInteriorSeeds(options = {}) {
    const count = Math.max(1, Math.min(50, Math.floor(Number(options.count) || 12)));
    const seedPrefix = String(options.seedPrefix || 'runtime-audit');
    const results = [];
    const aggregate = { motions:new Set(), activators:new Set(), access:new Set(), unknown:[] };
    for (let i = 0; i < count; i++) {
      const generated = await generateInteriorLocale({
        seed:`${seedPrefix}-${i}`,
        size:options.size || 'medium',
        density:options.density ?? 62,
        roomMin:options.roomMin ?? 3,
        roomMax:options.roomMax ?? 8,
      });
      const tags = inspectRuntimeTags(localePreviewRoot);
      for (const value of tags.motions) aggregate.motions.add(value);
      for (const value of tags.activators) aggregate.activators.add(value);
      for (const value of tags.access) aggregate.access.add(value);
      for (const entry of tags.unknown) aggregate.unknown.push({ seed:generated.seed, ...entry });
      const levels = Object.values(generated.locale?.meta?.interiorShell?.plateauModel?.levelByCell || {}).map(Number);
      results.push({
        seed:generated.seed,
        rooms:generated.locale?.meta?.interiorShell?.rooms?.length || 0,
        negativeLevelCells:levels.filter(level => level < 0).length,
        runtimeWallPlanes:generated.runtimeWallPlanes,
        runtimeHallways:generated.runtimeHallways,
        ...tags,
      });
    }
    return {
      count,
      results,
      aggregate:{
        motions:[...aggregate.motions].sort(),
        activators:[...aggregate.activators].sort(),
        access:[...aggregate.access].sort(),
        unknown:aggregate.unknown,
      },
    };
  }

  function getState() {
    hydrateInteriorPlateauLevels();
    return {
      seed: $('localeSeed')?.value || null,
      locale: cloneJson(lastGeneratedLocale),
      mechanismProgress,
      mechanismTargetState,
      previewLoopPaused,
      previewRootAttachedToTool: localePreviewRoot.parent === scene,
      runtimeWallPlanes: runtimeWallPlaneState(),
      runtimeHallways: runtimeHallwayState(),
      puzzleOptions: cloneJson(window.__devRuinPuzzleOptions || null),
      puzzleGeneration:{
        countsByRoom:Object.fromEntries(window.__devRuinPuzzleCounts || []),
        claimedMechanisms:[...(window.__devRuinPuzzleClaimedMechanisms || [])],
      },
    };
  }

  window.DebrisifierV50 = Object.freeze({
    sourceSha256: '038a5d54c66b0ae2a9ceeb66967b9e5c32b616040f40b503eec59d5331885f40',
    generateInteriorLocale,
    generateOutdoorLocale,
    takePreviewRoots,
    restorePreviewRoots,
    pausePreviewLoop,
    setMechanismTarget,
    snapMechanismState,
    applyProgress,
    createRootMechanismKeyframes,captureRootMechanismKeyframes,
    syncPressurePlates,
    rotateLinkedCube,
    tickRuntime,
    createRuntimeStoneLadder,
    inspectRuntimeTags,
    tagPuzzleFurniture,
    auditInteriorSeeds,
    hydrateInteriorPlateauLevels,
    prepareRuntimeWallPlanes,
    runtimeWallPlaneState,
    runtimeHallwayState,
    getState,
  });
})();

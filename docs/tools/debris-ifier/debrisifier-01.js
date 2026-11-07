// Boots the exact readable Debris-ifier V50 source and then exposes its dev API.
// Direct tool usage executes the source byte-for-byte. The hidden in-game ruin
// generator keeps the same source file and generator logic, but applies a small
// verified runtime patch set: local repo transport, player-safe corridor sizing,
// and parent-supplied puzzle-generation limits without modifying the recovered source.
(() => {
  'use strict';

  const SOURCE_SHA256 = '038a5d54c66b0ae2a9ceeb66967b9e5c32b616040f40b503eec59d5331885f40';
  const EMBEDDED_TREE = 'debrisifier-v50-embedded-tree.json';
  const EMBEDDED_FURNITURE_COUNT = 11;
  const params = new URLSearchParams(location.search);
  const embeddedRuntime = params.get('devRuntime') === '1' || params.get('embedded') === 'devRandomRuin';
  const debug = document.getElementById('debug');

  const fail = message => {
    if (debug) debug.textContent = `Debris-ifier bootstrap: FAILED — ${message}`;
    console.error('[Debris-ifier bootstrap]', message);
  };

  function loadApi() {
    if (embeddedRuntime) {
      try {
        const request = new XMLHttpRequest(); // Used only by the hidden dev generator so the API bytes cannot be starved behind the live game's startup asset queue.
        request.open('GET', 'debrisifier-v50-api.js?v=20261105soloPush2', false);
        request.send(null);
        const ok = (request.status >= 200 && request.status < 300) || (request.status === 0 && !!request.responseText);
        if (!ok) throw new Error(`V50 dev API HTTP ${request.status}`);
        const api = document.createElement('script'); // Used to execute the locally read API synchronously in the same iframe realm as the patched V50 source.
        api.textContent = `${request.responseText}\n//# sourceURL=debrisifier-v50-api.embedded.js`;
        document.head.appendChild(api);
        if (!window.DebrisifierV50) throw new Error('V50 dev API executed without exporting DebrisifierV50.');
        if (debug && window.DebrisifierV50.sourceSha256 === SOURCE_SHA256) debug.textContent = 'Debris-ifier embedded runtime ready.';
      } catch (error) {
        fail(error?.message || String(error));
      }
      return;
    }
    const api = document.createElement('script'); // Standalone editor usage keeps the ordinary external-script loader.
    api.src = 'debrisifier-v50-api.js?v=20261105soloNative1';
    api.onerror = () => fail('V50 dev API did not load.');
    document.head.appendChild(api);
  }

  function injectSource(sourceText) {
    const script = document.createElement('script');
    script.textContent = `${sourceText}\n//# sourceURL=debrisifier-v50-source.embedded.js`;
    document.head.appendChild(script);
    loadApi();
  }

  function patchEmbeddedRuntime(sourceText) {
    const treeNeedle = "const REPO_TREE_URL='https://api.github.com/repos/Oolnokk/HobunjiHollowUnity/git/trees/main?recursive=1';";
    const treeReplacement = `const REPO_TREE_URL='${EMBEDDED_TREE}';`;
    const rawNeedle = "function rawTextureUrl(path){return REPO_RAW_ROOT+String(path||'').replace(/^\\/+/, '');}";
    const rawReplacement = "function rawTextureUrl(path){const clean=String(path||'').replace(/^\\/+/, '');const fromDocsRoot=clean.startsWith('docs/')?clean.slice(5):clean;const resolved=new URL('../../'+fromDocsRoot,location.href);const attempt=new URLSearchParams(location.search).get('assetAttempt');if(attempt)resolved.searchParams.set('assetAttempt',attempt);return resolved.href;}";
    const brickNeedle = 'new THREE.GLTFLoader().load(REPO_RAW_ROOT+WALL_BRICK_GLB_PATH,gltf=>';
    const brickReplacement = 'new THREE.GLTFLoader().load(rawTextureUrl(WALL_BRICK_GLB_PATH),gltf=>';
    const decalNeedle = 'const texture=loader.load(REPO_RAW_ROOT+path,loaded=>';
    const decalReplacement = 'const texture=loader.load(rawTextureUrl(path),loaded=>';
    const selfTestNeedle = 'updateOutputs();syncInteriorMaterialUI();updateSelectedTextureUI();renderTextureLibrary();renderFurnitureLibrary();syncLocaleEnvironmentControls();selfTest();loadRepoTextureLibrary();loadRepoFurnitureLibrary();';
    const selfTestReplacement = 'syncLocaleEnvironmentControls();'; // Hidden gameplay generation skips standalone editor rendering/indexing/self-tests; generateInteriorLocale loads only the furniture data it actually needs.
    const rendererNeedle = 'const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});';
    const rendererReplacement = "const renderer=window.__debrisEmbeddedRuntime?{setPixelRatio(){},getPixelRatio(){return 1;},setSize(){},render(){},outputEncoding:THREE.sRGBEncoding,shadowMap:{enabled:false,type:null}}:new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});"; // Hidden generation needs scene constructors, not a second GPU context competing with the live game renderer.
    const previewLoopNeedle = 'renderPreview();';
    const previewLoopReplacement = 'if(!window.__debrisEmbeddedRuntime)renderPreview();'; // Direct tool preview remains unchanged; the hidden generator never starts an iframe RAF/render loop.

    // The preview's narrow hallways cannot fit the player. Keep runtime widths at
    // 5–6 cells; only the first 2–3 halls need 5+ cells of length for safe paths,
    // rope crossings and swappable hallway puzzles. Others connect rooms closely.
    const hallSignatureNeedle = 'function pickInteriorHallRect(rng,axis,cols,rows){';
    const hallSignatureReplacement = 'function pickInteriorHallRect(rng,axis,cols,rows,hallIndex){';
    const hallCallNeedle = 'pickInteriorHallRect(rng,axis,128,128)';
    const hallCallReplacement = 'pickInteriorHallRect(rng,axis,128,128,hallIndex)';
    const hallNeedle = 'const width=randomIntInclusive(rng,3,4),length=randomIntInclusive(rng,5,8);';
    const hallReplacement = 'const width=randomIntInclusive(rng,5,6),puzzleSlots=window.__devRuinPuzzleOptions?.safePath===false?2:3,length=hallIndex<=puzzleSlots?randomIntInclusive(rng,5,6):randomIntInclusive(rng,2,4);'; // puzzleSlots counts long hallways available to the safe-path composer and two other hallway modules.
    const escapeHallNeedle = 'hallWidth=randomIntInclusive(rng,3,4),hallLen=10+rooms.length*3;';
    const escapeHallReplacement = 'hallWidth=randomIntInclusive(rng,5,6),hallLen=6;'; // Escape corridors start short, then the existing collision retry extends only as necessary.
    const focusDoorNeedle = 'footprintWidth:cs*3,footprintDepth:cs,doorwayId:`${chosen.door.from}->${chosen.door.to}`,side:chosen.side';
    const focusDoorReplacement = 'footprintWidth:cs*Math.max(3,Number(chosen.door.widthCells)||3),footprintDepth:cs,doorwayId:`${chosen.door.from}->${chosen.door.to}`,side:chosen.side';
    const hallDoorNeedle = 'footprintWidth:network.cellSize*3,footprintDepth:network.cellSize,doorwayId:`${door.from}->${door.to}`';
    const hallDoorReplacement = 'footprintWidth:network.cellSize*Math.max(3,Number(door.widthCells)||3),footprintDepth:network.cellSize,doorwayId:`${door.from}->${door.to}`';

    // The parent game supplies these options before each hidden-frame generation.
    // The recovered V50 source stays immutable; exact-string patches add only the
    // selection/cap seams needed by the in-game Random Test Ruin controls.
    const puzzleChoiceNeedle = "function chooseMechanismActivatorType(rng){const roll=rng();if(roll<.25)return'pressurePlate';if(roll<.5)return'brazier';if(roll<.75)return'glyphObelisk';return'stackedObelisk';}";
    const puzzleChoiceReplacement = `function chooseMechanismActivatorType(rng){const roll=rng();if(roll<.25)return'pressurePlate';if(roll<.5)return'brazier';if(roll<.75)return'glyphObelisk';return'stackedObelisk';}
function runtimePuzzleGenerationOptions(){return window.__devRuinPuzzleOptions||{};}
function runtimePuzzleFamilyEnabled(type){const options=runtimePuzzleGenerationOptions();if(type==='pressurePlate')return options.pressurePlate!==false;if(type==='brazier'||type==='torch')return options.brazier!==false;if(type==='glyphObelisk')return options.glyphObelisk!==false;if(type==='stackedObelisk')return options.stackedObelisk!==false;if(type==='linkedCubePillars')return options.linkedCubePillars!==false;if(type==='nestedRoom')return options.nestedRoom!==false;return true;}
function runtimePuzzleRoomAvailable(mechanismId,room){const max=Math.max(0,Math.floor(Number(runtimePuzzleGenerationOptions().maxPerRoom)||0));if(!room||!max)return true;const claimed=window.__devRuinPuzzleClaimedMechanisms;if(claimed?.has(mechanismId))return true;const counts=window.__devRuinPuzzleCounts;return(counts?.get(String(room.id))||0)<max;}
function runtimePuzzleClaim(mechanismId,room){const claimed=window.__devRuinPuzzleClaimedMechanisms||(window.__devRuinPuzzleClaimedMechanisms=new Set());if(claimed.has(mechanismId))return;claimed.add(mechanismId);if(!room)return;const counts=window.__devRuinPuzzleCounts||(window.__devRuinPuzzleCounts=new Map()),key=String(room.id);counts.set(key,(counts.get(key)||0)+1);}
function runtimePuzzleBypass(mechanismRoot){if(mechanismRoot){mechanismRoot.userData.runtimePuzzleBypass=true;mechanismRoot.userData.runtimePuzzleBypassReason='generation-options';}return'disabled';}
function runtimeChoosePressureFallbackType(rng,linkedCubeDoor=false){const candidates=['brazier','glyphObelisk'].filter(runtimePuzzleFamilyEnabled);if(linkedCubeDoor&&runtimePuzzleFamilyEnabled('linkedCubePillars'))candidates.push('linkedCubePillars');else if(runtimePuzzleFamilyEnabled('stackedObelisk'))candidates.push('stackedObelisk');return candidates.length?candidates[Math.floor(rng()*candidates.length)]:null;}
function runtimeChooseMechanismActivatorType(rng,forcedType=null,linkedCubeDoor=false){let forced=forcedType==='torch'?'brazier':forcedType;if(linkedCubeDoor&&forced==='stackedObelisk'){if(runtimePuzzleFamilyEnabled('linkedCubePillars'))return'linkedCubePillars';if(runtimePuzzleFamilyEnabled('stackedObelisk'))return'stackedObelisk';forced=null;}if(forced&&runtimePuzzleFamilyEnabled(forced))return forced;const candidates=['pressurePlate','brazier','glyphObelisk'].filter(runtimePuzzleFamilyEnabled);if(linkedCubeDoor){if(runtimePuzzleFamilyEnabled('linkedCubePillars'))candidates.push('linkedCubePillars');else if(runtimePuzzleFamilyEnabled('stackedObelisk'))candidates.push('stackedObelisk');}else if(runtimePuzzleFamilyEnabled('stackedObelisk'))candidates.push('stackedObelisk');return candidates.length?candidates[Math.floor(rng()*candidates.length)]:null;}`;
    const activatorHeadNeedle = "function addMechanismActivatorFor(mechanismId,anchorX,anchorZ,rotY,floorY,placementHint='side',forcedPosition=null,puzzleRoom=null,forcedType=null){\n    let type=forcedType||chooseMechanismActivatorType(rng);const forward=mechanismDirFromYaw(rotY),right=mechanismRightFromYaw(rotY),sideSign=rng()<.5?-1:1,offset=(type==='pressurePlate'?1.1:((type==='brazier'||type==='torch')?1.45:1.7));\n    let x=forcedPosition?.x??(anchorX+right.dx*offset*sideSign),z=forcedPosition?.z??(anchorZ+right.dz*offset*sideSign),y=floorY,pushPuzzle=null;\n    const mechRoot=mechanismRootById.get(mechanismId)||null;";
    const activatorHeadReplacement = "function addMechanismActivatorFor(mechanismId,anchorX,anchorZ,rotY,floorY,placementHint='side',forcedPosition=null,puzzleRoom=null,forcedType=null){\n    const mechRoot=mechanismRootById.get(mechanismId)||null,linkedCubeDoor=!!(puzzleRoom&&mechRoot?.userData?.motionName==='verticalStoneDoor');\n    let type=runtimeChooseMechanismActivatorType(rng,forcedType,linkedCubeDoor);if(!type||!runtimePuzzleRoomAvailable(mechanismId,puzzleRoom))return runtimePuzzleBypass(mechRoot);runtimePuzzleClaim(mechanismId,puzzleRoom);const forward=mechanismDirFromYaw(rotY),right=mechanismRightFromYaw(rotY),sideSign=rng()<.5?-1:1,offset=(type==='pressurePlate'?1.1:((type==='brazier'||type==='torch')?1.45:1.7));\n    let x=forcedPosition?.x??(anchorX+right.dx*offset*sideSign),z=forcedPosition?.z??(anchorZ+right.dz*offset*sideSign),y=floorY,pushPuzzle=null;";
    const linkedCubeNeedle = "if(type==='stackedObelisk'&&puzzleRoom&&mechRoot?.userData?.motionName==='verticalStoneDoor'){";
    const linkedCubeReplacement = "if(type==='linkedCubePillars'&&puzzleRoom&&mechRoot?.userData?.motionName==='verticalStoneDoor'){";
    const nestedNeedle = "function addNestedRoomPuzzleFor(mechanismId,room,doorPlacement){\n    if(nestedPuzzleByRoom.has(room.id))return nestedPuzzleByRoom.get(room.id);";
    const nestedReplacement = "function addNestedRoomPuzzleFor(mechanismId,room,doorPlacement){\n    if(nestedPuzzleByRoom.has(room.id))return nestedPuzzleByRoom.get(room.id);if(!runtimePuzzleFamilyEnabled('nestedRoom')||!runtimePuzzleRoomAvailable(mechanismId,room))return null;runtimePuzzleClaim(mechanismId,room);";
    const activationNeedle = "const linkedPlate=object.userData.linkedPressurePlateRoot,linkedCube=object.userData.linkedCubePuzzleRoot,baseActivation=linkedCube?(linkedCube.userData.solveProgress||0):(linkedPlate?(linkedPlate.userData.weightProgress||0):localProgress(object)),minScale=motion.minScale??.08,maxScale=motion.maxScale??1,activation=clamp(baseActivation,0,1);";
    const activationReplacement = "const linkedPlate=object.userData.linkedPressurePlateRoot,linkedCube=object.userData.linkedCubePuzzleRoot,baseActivation=linkedCube?(linkedCube.userData.solveProgress||0):(linkedPlate?(linkedPlate.userData.weightProgress||0):localProgress(object)),minScale=motion.minScale??.08,maxScale=motion.maxScale??1,activation=clamp(baseActivation,0,1);";
    const bridgeSequenceNeedle = "else if(motion.type==='bridgeSequence'){const p=localProgress(object);";
    const bridgeSequenceReplacement = "else if(motion.type==='bridgeSequence'){const p=activation;";
    const glyphNicheNeedle = "const core=createShortObeliskCore(material,{bodyWidth:.21*.66,bodyDepth:.21*.66,bodyHeight:.47*.5,capWidth:.26*.66,capDepth:.26*.66,capHeight:.016,profile:'pillarHoused',hideDecals:true})";
    const glyphNicheReplacement = "const core=createShortObeliskCore(material,{bodyWidth:.21*.66,bodyDepth:.21*.66,bodyHeight:.47*.5,capWidth:.26*.66,capDepth:.26*.66,capHeight:.016,profile:'pillarHoused',hideDecals:false})";
    const glyphGlowNeedle = "function setDecalMaterialsProgress(materials,progress){for(const mat of materials||[]){mat.color.set(progress>.001?mat.userData.activeColor||'#66aaff':mat.userData.baseColor||'#d7c4a4');}}";
    const glyphGlowReplacement = "function setDecalMaterialsProgress(materials,progress){const active=progress>.001;for(const mat of materials||[]){mat.color.set(active?(mat.userData.activeColor||'#66aaff'):(mat.userData.baseColor||'#ffffff'));mat.opacity=active?1:.82;mat.transparent=true;mat.depthWrite=false;mat.blending=active?THREE.AdditiveBlending:THREE.NormalBlending;mat.userData.devRuinGlyphGlow=active;mat.needsUpdate=true;}}";
    const pressureFallbackNeedle = "if(type==='pressurePlate'&&puzzleRoom){const puzzlePillarSlots=interiorSupportPillarSlots(puzzleRoom,network,plateauData,bridgeCorridors,true);pushPuzzle=pressurePuzzleLayout(puzzleRoom,anchorX,anchorZ,rotY,network,rng,plateauData,{pillarSlots:puzzlePillarSlots,bridgeCorridors});if(pushPuzzle){x=pushPuzzle.plate.x;z=pushPuzzle.plate.z;y=interiorFloorHeightAtWorld(x,z,network,plateauData);for(const point of pushPuzzle.reservedPoints||[])pushPuzzleReservedPoints.push({roomId:puzzleRoom.id,x:point.x,z:point.z,clearance:Math.max(pushPuzzle.pillarClearance||.7,pushPuzzle.pushUnit*.95)});for(let pathIndex=1;pathIndex<(pushPuzzle.path||[]).length;pathIndex++){const a=pushPuzzle.path[pathIndex-1],b=pushPuzzle.path[pathIndex];pushPuzzleReservedSegments.push({roomId:puzzleRoom.id,ax:a.x,az:a.z,bx:b.x,bz:b.z,clearance:Math.max(pushPuzzle.pillarClearance||.7,pushPuzzle.pushUnit*.95)});}}}";
    const pressureFallbackReplacement = "if(type==='pressurePlate'&&puzzleRoom){const puzzlePillarSlots=window.__devRuinSingleRoomLab?[]:interiorSupportPillarSlots(puzzleRoom,network,plateauData,bridgeCorridors,true);pushPuzzle=pressurePuzzleLayout(puzzleRoom,anchorX,anchorZ,rotY,network,rng,plateauData,{pillarSlots:puzzlePillarSlots,bridgeCorridors});if(pushPuzzle){x=pushPuzzle.plate.x;z=pushPuzzle.plate.z;y=interiorFloorHeightAtWorld(x,z,network,plateauData);for(const point of pushPuzzle.reservedPoints||[])pushPuzzleReservedPoints.push({roomId:puzzleRoom.id,x:point.x,z:point.z,clearance:Math.max(pushPuzzle.pillarClearance||.7,pushPuzzle.pushUnit*.95)});for(let pathIndex=1;pathIndex<(pushPuzzle.path||[]).length;pathIndex++){const a=pushPuzzle.path[pathIndex-1],b=pushPuzzle.path[pathIndex];pushPuzzleReservedSegments.push({roomId:puzzleRoom.id,ax:a.x,az:a.z,bx:b.x,bz:b.z,clearance:Math.max(pushPuzzle.pillarClearance||.7,pushPuzzle.pushUnit*.95)});}}if(!pushPuzzle){const fallbackType=runtimeChoosePressureFallbackType(rng,linkedCubeDoor);return fallbackType?addMechanismActivatorFor(mechanismId,anchorX,anchorZ,rotY,floorY,placementHint,forcedPosition,puzzleRoom,fallbackType):runtimePuzzleBypass(mechRoot);}}";
    const pressureReservedSpaceNeedle = "pressurePuzzleLayout(puzzleRoom,anchorX,anchorZ,rotY,network,rng,plateauData,{pillarSlots:puzzlePillarSlots,bridgeCorridors})";
    const pressureReservedSpaceReplacement = "pressurePuzzleLayout(puzzleRoom,anchorX,anchorZ,rotY,network,rng,plateauData,{pillarSlots:puzzlePillarSlots,bridgeCorridors,extraObstacles:pushPuzzleReservedPoints.filter(point=>point.roomId===puzzleRoom.id).map(point=>({x:point.x,z:point.z,kind:'reservedPuzzleSpace',clearance:point.clearance}))})";
    const doorwayFlankReservedNeedle = "for(const [x,z] of pairs){const yaw=d.axis==='x'?Math.PI/2:0,floorY=interiorFloorHeightAtWorld(x,z,network,plateauData),pillar=await createInteriorFurnitureVisual(shortAsset,material,x,z,{targetHeight:wallHeight*.42,role:'doorway flank pillar',floorSink:INTERIOR_DECOR_FLOOR_SINK,yaw,floorY});";
    const doorwayFlankReservedReplacement = "for(const [x,z] of pairs){if(pushPuzzleReservedPoints.some(point=>Math.hypot(x-point.x,z-point.z)<Math.max(.78,point.clearance*.8))||pushPuzzleReservedSegments.some(segment=>distancePointToSegment2D(x,z,segment.ax,segment.az,segment.bx,segment.bz)<Math.max(.78,segment.clearance*.8)))continue;const yaw=d.axis==='x'?Math.PI/2:0,floorY=interiorFloorHeightAtWorld(x,z,network,plateauData),pillar=await createInteriorFurnitureVisual(shortAsset,material,x,z,{targetHeight:wallHeight*.42,role:'doorway flank pillar',floorSink:INTERIOR_DECOR_FLOOR_SINK,yaw,floorY});";
    const wallDisplayReservedNeedle = "if(interiorPointNearDoorway(x,z,network,.72)||pushPuzzleReservedPoints.some(point=>Math.hypot(x-point.x,z-point.z)<Math.max(.72,point.clearance*.72)))continue;";
    const wallDisplayReservedReplacement = "if(interiorPointNearDoorway(x,z,network,.72)||pushPuzzleReservedPoints.some(point=>Math.hypot(x-point.x,z-point.z)<Math.max(.72,point.clearance*.72))||pushPuzzleReservedSegments.some(segment=>distancePointToSegment2D(x,z,segment.ax,segment.az,segment.bx,segment.bz)<Math.max(.72,segment.clearance*.72)))continue;";
    const pressureObstacleClearanceNeedle = "  const nearObstacle=(p,clearance=pillarClearance)=>obstaclePoints.some(obstacle=>Math.hypot(p.x-obstacle.x,p.z-obstacle.z)<clearance);\n  const segmentNearObstacle=(a,b,clearance=pillarClearance)=>obstaclePoints.some(obstacle=>distancePointToSegment2D(obstacle.x,obstacle.z,a.x,a.z,b.x,b.z)<clearance); // Used to reject a travel segment that clips a pillar even when both push-step endpoints individually clear it.";
    const pressureObstacleClearanceReplacement = "  const nearObstacle=(p,clearance=pillarClearance)=>obstaclePoints.some(obstacle=>Math.hypot(p.x-obstacle.x,p.z-obstacle.z)<Math.max(clearance,Number(obstacle.clearance)||0));\n  const segmentNearObstacle=(a,b,clearance=pillarClearance)=>obstaclePoints.some(obstacle=>distancePointToSegment2D(obstacle.x,obstacle.z,a.x,a.z,b.x,b.z)<Math.max(clearance,Number(obstacle.clearance)||0)); // Prior puzzle reservations retain their authored footprint clearance instead of being flattened to pillar clearance.";
    const pushReservationClearanceNeedle = "clearance:Math.max(pushPuzzle.pillarClearance||.7,pushPuzzle.pushUnit*.95)";
    const pushReservationClearanceReplacement = "clearance:Math.max(.9,pushPuzzle.pillarClearance||.7,pushPuzzle.pushUnit*1.35)";
    const elevatorSocketExitNeedle = "function createElevatorWellSocket(material,width=1.35,depth=1.35,drop=.85){const root=new THREE.Group(),rim=Math.max(.08,Math.min(width,depth)*.085),lipH=.10,shaftDepth=Math.max(.35,drop+.16),outerW=width+rim*.8,outerD=depth+rim*.8;const add=(w,h,d,x,y,z)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);return mesh;};add(outerW,lipH,rim,0,lipH*.5,-outerD*.5+rim*.5);add(outerW,lipH,rim,0,lipH*.5,outerD*.5-rim*.5);add(rim,lipH,Math.max(.01,outerD-rim*2),-outerW*.5+rim*.5,lipH*.5,0);add(rim,lipH,Math.max(.01,outerD-rim*2),outerW*.5-rim*.5,lipH*.5,0);const wallT=Math.max(.055,rim*.62),wallY=-shaftDepth*.5;add(outerW,shaftDepth,wallT,0,wallY,-outerD*.5+wallT*.5);add(outerW,shaftDepth,wallT,0,wallY,outerD*.5-wallT*.5);add(wallT,shaftDepth,Math.max(.01,outerD-wallT*2),-outerW*.5+wallT*.5,wallY,0);add(wallT,shaftDepth,Math.max(.01,outerD-wallT*2),outerW*.5-wallT*.5,wallY,0);root.userData.elevatorWellSocket=true;root.userData.supportsBuriedMovingDais=true;root.userData.shaftDepth=shaftDepth;return root;}";
    const elevatorSocketExitReplacement = "function createElevatorWellSocket(material,width=1.35,depth=1.35,drop=.85,exitDir=null){const root=new THREE.Group(),rim=Math.max(.08,Math.min(width,depth)*.085),lipH=.10,shaftDepth=Math.max(.35,drop+.16),outerW=width+rim*.8,outerD=depth+rim*.8,openNorth=(exitDir?.dz||0)<0,openSouth=(exitDir?.dz||0)>0,openWest=(exitDir?.dx||0)<0,openEast=(exitDir?.dx||0)>0;const add=(w,h,d,x,y,z)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);return mesh;};if(!openNorth)add(outerW,lipH,rim,0,lipH*.5,-outerD*.5+rim*.5);if(!openSouth)add(outerW,lipH,rim,0,lipH*.5,outerD*.5-rim*.5);if(!openWest)add(rim,lipH,Math.max(.01,outerD-rim*2),-outerW*.5+rim*.5,lipH*.5,0);if(!openEast)add(rim,lipH,Math.max(.01,outerD-rim*2),outerW*.5-rim*.5,lipH*.5,0);const wallT=Math.max(.055,rim*.62),wallY=-shaftDepth*.5;if(!openNorth)add(outerW,shaftDepth,wallT,0,wallY,-outerD*.5+wallT*.5);if(!openSouth)add(outerW,shaftDepth,wallT,0,wallY,outerD*.5-wallT*.5);if(!openWest)add(wallT,shaftDepth,Math.max(.01,outerD-wallT*2),-outerW*.5+wallT*.5,wallY,0);if(!openEast)add(wallT,shaftDepth,Math.max(.01,outerD-wallT*2),outerW*.5-wallT*.5,wallY,0);root.userData.elevatorWellSocket=true;root.userData.interiorRuinRole='elevator well socket';root.userData.supportsBuriedMovingDais=true;root.userData.shaftDepth=shaftDepth;root.userData.socketExitDir=exitDir?{dx:Math.sign(exitDir.dx||0),dz:Math.sign(exitDir.dz||0)}:null;return root;}";
    const elevatorSocketCallNeedle = "const elevatorSocket=createElevatorWellSocket(material,daisWidth,daisDepth,rise+.07);";
    const elevatorSocketCallReplacement = "const socketExit=path?.[1]?{dx:Math.sign(path[1].x-source.x),dz:Math.sign(path[1].z-source.z)}:null,elevatorSocket=createElevatorWellSocket(material,daisWidth,daisDepth,rise+.07,socketExit);";

    // Test the union before committing either a room or its hallway. V50
    // normalizes its unbounded coordinates afterward, retaining two margin
    // cells on every edge; the planner's allocation therefore bounds that union.
    const allocationHelper = `function runtimeInteriorAllocationFits(rooms,hallways,room,hall){
  const allocation=window.__devRuinLayoutReservation;
  if(!allocation)return true;
  const rects=[...rooms,...hallways,room,...(hall?[hall]:[])];
  const cols=Math.max(...rects.map(r=>r.col+r.w))-Math.min(...rects.map(r=>r.col))+4;
  const rows=Math.max(...rects.map(r=>r.row+r.h))-Math.min(...rects.map(r=>r.row))+4;
  const scale=INTERIOR_CELL_SIZE*allocation.tileScale;
  return cols*scale<=allocation.w&&rows*scale<=allocation.d;
}
`;
    const nativeLabNeedle = "  if(tallAsset){\n    for(const room of network.rooms){";
    const nativeLabReplacement = "  if(window.__devRuinSingleRoomLab&&window.__devRuinSingleRoomNativePuzzle){\n    const kind=window.__devRuinSingleRoomNativePuzzle; // DEV-only lab calls the original V50 mechanism factories, never a procedural stand-in.\n    if(!['brazier','glyphObelisk','stackedObelisk','linkedCubePillars','pressurePlate'].includes(kind)||network.rooms.length!==1)\n      throw new Error('Unknown single-room native V50 fixture '+kind);\n    const room=network.rooms[0],b=rectWorldBounds(room,network),side=network.entrance?.side||'west';\n    const eastWest=side==='west'||side==='east',cx=(b.minX+b.maxX)*.5,cz=(b.minZ+b.maxZ)*.5;\n    const x=eastWest?(side==='west'?b.maxX-1.9:b.minX+1.9):cx;\n    const z=eastWest?cz:(side==='north'?b.maxZ-1.9:b.minZ+1.9);\n    const yaw=eastWest?Math.PI/2:0,floorY=interiorFloorHeightAtWorld(x,z,network,plateauData);\n    const arch=createStoneArchFrame(material,2.2,2.35,.24);\n    arch.position.set(x,floorY,z);arch.rotation.y=yaw;arch.userData.interiorRuinRole='one-room native goal frame';shell.add(arch);\n    const door=createVerticalStoneDoor(material,1.76,1.9,.22),id='single_room_native_v50_goal';\n    door.position.set(x,floorY+2.35,z);door.rotation.y=yaw;door.userData.mechanismId=id;\n    door.userData.doorwayId='single-room-native-goal';shell.add(door);mechanismRootById.set(id,door);\n    movingParts.push({id,type:'verticalStoneDoor',anchor:{x,y:floorY+2.35,z},rotationY:yaw,\n      height:1.9,minScale:.06,maxScale:1,doorwayId:'single-room-native-goal',labOnly:true});\n    const actual=addMechanismActivatorFor(id,x,z,yaw,floorY,'side',null,room,kind);\n    if(actual!==kind)throw new Error('V50 one-room '+kind+' fixture was not authored: '+actual); // Push-block mode accepts only a real routed V50 pressure-block with a physical movable cube.\n    objects.push({id,kind:'movingDoor',key:'stone_door',label:'Native V50 Puzzle Goal',col:0,row:0,w:2,h:1,rot:Math.round(yaw/DEG),\n      previewRuin:{movingPart:true,labOnly:true,noLoot:true,activatorType:kind,linkedMechanismId:id}});\n    window.__devRuinSingleRoomNativeCreated={kind,mechanismId:id,roomId:room.id,requiresPushBlock:kind==='pressurePlate'}; // Mobile diagnostics confirm the concrete V50 family.\n  }\n  if(tallAsset){\n    for(const room of network.rooms){"; // DEV-only native puzzle fixture uses original V50 meshes and activators.
    const nativeMetaNeedle = 'movingParts,movingPartAnimation:';
    const nativeMetaReplacement = 'movingParts,singleRoomNative:window.__devRuinSingleRoomNativeCreated||null,movingPartAnimation:';
    const patches = [
      ['native allocation helper', 'function generateInteriorRoomNetwork(', allocationHelper+'function generateInteriorRoomNetwork('],
      ['native first-room allocation', '  rooms.push(first);degrees.set(first.id,0);', "  if(!runtimeInteriorAllocationFits([],[],first,null))throw new Error('First V50 room exceeds its floor allocation');\n  rooms.push(first);degrees.set(first.id,0);"],
      ['native attachment allocation', '          if(!interiorRectClear(floorSet,hall)||!interiorRectClear(floorSet,room))continue;', '          if(!runtimeInteriorAllocationFits(rooms,hallways,room,hall)||!interiorRectClear(floorSet,hall)||!interiorRectClear(floorSet,room))continue;'],
      ['native escape allocation', '      if(!interiorRectClear(floorSet,hall)||!interiorRectClear(floorSet,room))throw new Error(', '      if(!runtimeInteriorAllocationFits(rooms,hallways,room,hall)||!interiorRectClear(floorSet,hall)||!interiorRectClear(floorSet,room))throw new Error('],
      // The immutable generator is shared with gameplay; only the root author's explicit option allows one room.
      ['vast single-room preview', 'function interiorRoomPreset(profileKind,rng,forcedLabel=null){', "function interiorRoomPreset(profileKind,rng,forcedLabel=null){if(window.__devRuinSingleRoom===true&&window.__devRuinSingleRoomPreset)forcedLabel=window.__devRuinSingleRoomPreset;"],
      ['single-room preview range', 'function interiorRoomRange(){', 'function interiorRoomRange(){if(window.__devRuinSingleRoom===true)return{min:1,max:1};'],
      ['single-room preview network', 'Math.round(Number(roomRange.min)||3),2,12)', 'Math.round(Number(roomRange.min)||3),window.__devRuinSingleRoom===true?1:2,12)'],
      ['flat puzzle lab floor', 'plateauData=generateInteriorPlateauPlan(network,rng,density)', 'plateauData=window.__devRuinSingleRoomLab?{levelByCell:Object.fromEntries([...network.floorSet].map(key=>[key,0])),regions:[],focuses:[],stepHeight:INTERIOR_PLATEAU_STEP_HEIGHT,coreTreasureFocusId:null,singleCoreTreasure:false}:generateInteriorPlateauPlan(network,rng,density)'],
      ['one-room native V50 puzzle fixture', nativeLabNeedle, nativeLabReplacement],
      ['single-room native V50 diagnostics metadata', nativeMetaNeedle, nativeMetaReplacement],
      ['one-room spatial model without phantom pillars',
        'pillarSlots=interiorSupportPillarSlots(room,network,plateauData,bridgeCorridors,true),pillarClear=',
        'pillarSlots=window.__devRuinSingleRoomLab?[]:interiorSupportPillarSlots(room,network,plateauData,bridgeCorridors,true),pillarClear='],
      ['isolated torch route without prerequisite obelisk',
        'const gate=addTorchRoutePrerequisiteGate(room,route,nestedId);',
        'const gate=window.__devRuinSingleRoomLab?null:addTorchRoutePrerequisiteGate(room,route,nestedId);'],
      ['clear solo chamber support pillars', 'if(tallAsset){\n    for(const room of network.rooms){', 'if(tallAsset&&!window.__devRuinSingleRoomLab){\n    for(const room of network.rooms){'], // The chosen standalone puzzle owns the chamber's usable floor; ordinary V50 rooms retain their full support network. // Only explicit dev labs skip V50 core-treasure scenery; ordinary ruins are byte-for-byte unchanged.
      ['repository-tree binding', treeNeedle, treeReplacement],
      ['raw-asset URL helper', rawNeedle, rawReplacement],
      ['Roughbrick loader', brickNeedle, brickReplacement],
      ['mechanism decal loader', decalNeedle, decalReplacement],
      ['headless embedded renderer', rendererNeedle, rendererReplacement],
      ['disable embedded preview RAF', previewLoopNeedle, previewLoopReplacement],
      ['skip standalone editor startup in embedded gameplay runtime', selfTestNeedle, selfTestReplacement],
      ['hallway length helper argument', hallSignatureNeedle, hallSignatureReplacement],
      ['hallway length attachment index', hallCallNeedle, hallCallReplacement],
      ['hallway width and compact length', hallNeedle, hallReplacement],
      ['escape hallway width', escapeHallNeedle, escapeHallReplacement],
      ['focus doorway width', focusDoorNeedle, focusDoorReplacement],
      ['hallway doorway width', hallDoorNeedle, hallDoorReplacement],
      ['puzzle option helpers', puzzleChoiceNeedle, puzzleChoiceReplacement],
      ['puzzle activator selection/cap', activatorHeadNeedle, activatorHeadReplacement],
      ['linked-cube family selection', linkedCubeNeedle, linkedCubeReplacement],
      ['nested puzzle family/cap', nestedNeedle, nestedReplacement],
      ['puzzle bypass manual-state semantics', activationNeedle, activationReplacement],
      ['bridge-sequence linked activation', bridgeSequenceNeedle, bridgeSequenceReplacement],
      ['simple projectile glyphs keep decals in pillar niches', glyphNicheNeedle, glyphNicheReplacement],
      ['simple projectile glyph decals glow in unlit materials', glyphGlowNeedle, glyphGlowReplacement],
      ['invalid pressure-plate fallback', pressureFallbackNeedle, pressureFallbackReplacement],
      ['pressure-puzzle prior reserved space', pressureReservedSpaceNeedle, pressureReservedSpaceReplacement],
      ['doorway flank push-route avoidance', doorwayFlankReservedNeedle, doorwayFlankReservedReplacement],
      ['wall display push-route avoidance', wallDisplayReservedNeedle, wallDisplayReservedReplacement],
      ['pressure prior-obstacle clearance', pressureObstacleClearanceNeedle, pressureObstacleClearanceReplacement],
      ['push reserved point footprint clearance', pushReservationClearanceNeedle, pushReservationClearanceReplacement],
      ['push reserved segment footprint clearance', pushReservationClearanceNeedle, pushReservationClearanceReplacement],
      ['elevator socket authored exit', elevatorSocketExitNeedle, elevatorSocketExitReplacement],
      ['elevator socket first-push direction', elevatorSocketCallNeedle, elevatorSocketCallReplacement],
    ];

    let patched = sourceText;
    for (const [label, needle, replacement] of patches) {
      if (!patched.includes(needle)) throw new Error(`V50 ${label} changed; refusing an unverified embedded patch.`);
      patched = patched.replace(needle, replacement);
    }

    window.__debrisifierEmbeddedTransport = Object.freeze({
      active: true,
      sameOrigin: true,
      sourceSha256: SOURCE_SHA256,
      tree: EMBEDDED_TREE,
      expectedFurniturePaths: EMBEDDED_FURNITURE_COUNT,
      patchedBindings: patches.length,
      runtimeHallwayWidthCells: [5, 6],
      runtimeCompactHallwayLengthCells: [2, 4], // Mobile diagnostics: ordinary V50 links are shorter; the first puzzle slots retain [5, 6].
      runtimePuzzleHallwayLengthCells: [5, 6],
      runtimeDoorwayUsesAuthoredWidth: true,
      runtimePuzzleGenerationOptions: true,
      headlessEmbeddedPreview: true,
    });
    return patched;
  }

  if (embeddedRuntime) {
    try {
      const request = new XMLHttpRequest(); // Used only by the hidden dev generator so the protected V50 source is parser-blocking/high-priority instead of an async fetch starved behind the live game's startup asset queue.
      request.open('GET', 'debrisifier-v50-source.js', false);
      request.send(null);
      const ok = (request.status >= 200 && request.status < 300) || (request.status === 0 && !!request.responseText);
      if (!ok) throw new Error(`readable V50 source HTTP ${request.status}`);
      if (debug) debug.textContent = 'Debris-ifier embedded runtime: source loaded; applying verified patches…';
      injectSource(patchEmbeddedRuntime(request.responseText));
    } catch (error) {
      fail(error?.message || String(error));
    }
    return;
  }

  const source = document.createElement('script');
  source.src = 'debrisifier-v50-source.js';
  source.onerror = () => fail('readable V50 source did not load.');
  source.onload = loadApi;
  document.head.appendChild(source);
})();

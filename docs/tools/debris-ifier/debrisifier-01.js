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
    const api = document.createElement('script');
    api.src = 'debrisifier-v50-api.js';
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
    const rawReplacement = "function rawTextureUrl(path){const clean=String(path||'').replace(/^\\/+/, '');const fromDocsRoot=clean.startsWith('docs/')?clean.slice(5):clean;return new URL('../../'+fromDocsRoot,location.href).href;}";
    const brickNeedle = 'new THREE.GLTFLoader().load(REPO_RAW_ROOT+WALL_BRICK_GLB_PATH,gltf=>';
    const brickReplacement = 'new THREE.GLTFLoader().load(rawTextureUrl(WALL_BRICK_GLB_PATH),gltf=>';
    const decalNeedle = 'const texture=loader.load(REPO_RAW_ROOT+path,loaded=>';
    const decalReplacement = 'const texture=loader.load(rawTextureUrl(path),loaded=>';

    // The original preview's 3–4 half-cell hallways were authored for orbit-view
    // inspection, not the game's collision radius. Runtime-only V50 generation
    // uses 5–6 cells, which become 5–6 world units after the game's 2× X/Z scale.
    const hallNeedle = 'const width=randomIntInclusive(rng,3,4),length=randomIntInclusive(rng,5,8);';
    const hallReplacement = 'const width=randomIntInclusive(rng,5,6),length=randomIntInclusive(rng,5,8);';
    const escapeHallNeedle = 'hallWidth=randomIntInclusive(rng,3,4),hallLen=10+rooms.length*3;';
    const escapeHallReplacement = 'hallWidth=randomIntInclusive(rng,5,6),hallLen=10+rooms.length*3;';
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
    const activationReplacement = "const linkedPlate=object.userData.linkedPressurePlateRoot,linkedCube=object.userData.linkedCubePuzzleRoot,baseActivation=object.userData.runtimePuzzleBypass?1:(linkedCube?(linkedCube.userData.solveProgress||0):(linkedPlate?(linkedPlate.userData.weightProgress||0):localProgress(object))),minScale=motion.minScale??.08,maxScale=motion.maxScale??1,activation=clamp(baseActivation,0,1);";
    const bridgeSequenceNeedle = "else if(motion.type==='bridgeSequence'){const p=localProgress(object);";
    const bridgeSequenceReplacement = "else if(motion.type==='bridgeSequence'){const p=activation;";
    const pressureFallbackNeedle = "if(type==='pressurePlate'&&puzzleRoom){const puzzlePillarSlots=interiorSupportPillarSlots(puzzleRoom,network,plateauData,bridgeCorridors,true);pushPuzzle=pressurePuzzleLayout(puzzleRoom,anchorX,anchorZ,rotY,network,rng,plateauData,{pillarSlots:puzzlePillarSlots,bridgeCorridors});if(pushPuzzle){x=pushPuzzle.plate.x;z=pushPuzzle.plate.z;y=interiorFloorHeightAtWorld(x,z,network,plateauData);for(const point of pushPuzzle.reservedPoints||[])pushPuzzleReservedPoints.push({roomId:puzzleRoom.id,x:point.x,z:point.z,clearance:Math.max(pushPuzzle.pillarClearance||.7,pushPuzzle.pushUnit*.95)});for(let pathIndex=1;pathIndex<(pushPuzzle.path||[]).length;pathIndex++){const a=pushPuzzle.path[pathIndex-1],b=pushPuzzle.path[pathIndex];pushPuzzleReservedSegments.push({roomId:puzzleRoom.id,ax:a.x,az:a.z,bx:b.x,bz:b.z,clearance:Math.max(pushPuzzle.pillarClearance||.7,pushPuzzle.pushUnit*.95)});}}}";
    const pressureFallbackReplacement = "if(type==='pressurePlate'&&puzzleRoom){const puzzlePillarSlots=interiorSupportPillarSlots(puzzleRoom,network,plateauData,bridgeCorridors,true);pushPuzzle=pressurePuzzleLayout(puzzleRoom,anchorX,anchorZ,rotY,network,rng,plateauData,{pillarSlots:puzzlePillarSlots,bridgeCorridors});if(pushPuzzle){x=pushPuzzle.plate.x;z=pushPuzzle.plate.z;y=interiorFloorHeightAtWorld(x,z,network,plateauData);for(const point of pushPuzzle.reservedPoints||[])pushPuzzleReservedPoints.push({roomId:puzzleRoom.id,x:point.x,z:point.z,clearance:Math.max(pushPuzzle.pillarClearance||.7,pushPuzzle.pushUnit*.95)});for(let pathIndex=1;pathIndex<(pushPuzzle.path||[]).length;pathIndex++){const a=pushPuzzle.path[pathIndex-1],b=pushPuzzle.path[pathIndex];pushPuzzleReservedSegments.push({roomId:puzzleRoom.id,ax:a.x,az:a.z,bx:b.x,bz:b.z,clearance:Math.max(pushPuzzle.pillarClearance||.7,pushPuzzle.pushUnit*.95)});}}if(!pushPuzzle){const fallbackType=runtimeChoosePressureFallbackType(rng,linkedCubeDoor);return fallbackType?addMechanismActivatorFor(mechanismId,anchorX,anchorZ,rotY,floorY,placementHint,forcedPosition,puzzleRoom,fallbackType):runtimePuzzleBypass(mechRoot);}}";
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

    const patches = [
      ['repository-tree binding', treeNeedle, treeReplacement],
      ['raw-asset URL helper', rawNeedle, rawReplacement],
      ['Roughbrick loader', brickNeedle, brickReplacement],
      ['mechanism decal loader', decalNeedle, decalReplacement],
      ['hallway width', hallNeedle, hallReplacement],
      ['escape hallway width', escapeHallNeedle, escapeHallReplacement],
      ['focus doorway width', focusDoorNeedle, focusDoorReplacement],
      ['hallway doorway width', hallDoorNeedle, hallDoorReplacement],
      ['puzzle option helpers', puzzleChoiceNeedle, puzzleChoiceReplacement],
      ['puzzle activator selection/cap', activatorHeadNeedle, activatorHeadReplacement],
      ['linked-cube family selection', linkedCubeNeedle, linkedCubeReplacement],
      ['nested puzzle family/cap', nestedNeedle, nestedReplacement],
      ['puzzle bypass solved state', activationNeedle, activationReplacement],
      ['bridge-sequence linked activation', bridgeSequenceNeedle, bridgeSequenceReplacement],
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
      runtimeDoorwayUsesAuthoredWidth: true,
      runtimePuzzleGenerationOptions: true,
    });
    return patched;
  }

  if (embeddedRuntime) {
    fetch('debrisifier-v50-source.js', { cache:'no-cache' })
      .then(response => {
        if (!response.ok) throw new Error(`readable V50 source HTTP ${response.status}`);
        return response.text();
      })
      .then(sourceText => injectSource(patchEmbeddedRuntime(sourceText)))
      .catch(error => fail(error?.message || String(error)));
    return;
  }

  const source = document.createElement('script');
  source.src = 'debrisifier-v50-source.js';
  source.onerror = () => fail('readable V50 source did not load.');
  source.onload = loadApi;
  document.head.appendChild(source);
})();

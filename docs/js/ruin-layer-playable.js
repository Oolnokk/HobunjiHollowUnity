// RuinLayerPlayable — physical 2D wings at independent shaft-gallery heights.
// Each wing owns a narrow CellGrid3D collision slice; the ordinary map retains
// one shared XY floor occupancy for mobile controls, actors and pathfinding.
// Challenge rooms currently use actual stand-to-activate stone plates. Replacing
// these with authored puzzle families is the next integration step.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinLayerPlayable=api;
})(typeof self!=='undefined'?self:globalThis,function(root){
  'use strict';
  const key=(x,z)=>x+','+z;
  const SIDES={N:{dx:0,dz:-1},E:{dx:1,dz:0},S:{dx:0,dz:1},W:{dx:-1,dz:0}};
  const MAX_MAP_CELLS=300000; // Guard against malformed seeds making a giant 2D occupancy allocation.
  const RoomSystem=root.RuinRoomSystem||(typeof require==='function'?require('./ruin-room-system.js'):null); // Reuse room ownership in the browser and headless fixtures.
  function rectangleTiles(r,add){
    for(let z=r.z;z<r.z+r.d;z++)for(let x=r.x;x<r.x+r.w;x++)add(x,z);
  }
  function collect(wing){
    const tiles=new Set(); // Full physical footprint of this one wing, used by collision, floors and wall edges.
    const add=(x,z)=>tiles.add(key(x,z));
    if(wing.anteroom)rectangleTiles(wing.anteroom,add); // Shaft-side rooms have real floors, walls and identities.
    wing.rooms.forEach(room=>rectangleTiles(room,add));
    wing.corridors.forEach(hall=>hall.rects.forEach(rect=>rectangleTiles(rect,add)));
    return tiles;
  }
  function selectGrid(registered,x,z,referenceY=0){
    let best=null,bestDistance=Infinity; // At shared X/Z, choose the wing whose standing level matches the actor.
    const y=Number(referenceY);
    for(const [scope,{grid,contains}] of registered||[]){
      if(!grid?.inBounds(grid.xToCol(x),grid.zToRow(z),0)
        ||typeof contains==='function'&&!contains(x,z))continue;
      if(scope==='shaft-hub')return grid; // Hub spans all floors; portal overlap belongs to its complete 3D grid.
      const distance=Number.isFinite(y)?Math.abs(y-grid.baseY):0;
      if(distance<bestDistance){bestDistance=distance;best=grid;}
    }
    return best;
  }
  function projectedExtent(plan){
    let maxX=0,maxZ=0,minX=Infinity,minZ=Infinity;
    for(const floor of plan.floors)for(const wing of floor.wings){
      for(const room of wing.rooms){minX=Math.min(minX,room.x);minZ=Math.min(minZ,room.z);
        maxX=Math.max(maxX,room.x+room.w);maxZ=Math.max(maxZ,room.z+room.d);}
      for(const hall of wing.corridors)for(const rect of hall.rects){
        minX=Math.min(minX,rect.x);minZ=Math.min(minZ,rect.z);
        maxX=Math.max(maxX,rect.x+rect.w);maxZ=Math.max(maxZ,rect.z+rect.d);}
    }
    return {minX,minZ,maxX,maxZ};
  }
  const lichRgbWashed=hex=>[1,3,5].map(n=>parseInt(String(hex).slice(n,n+2),16)).map(v=>Number.isFinite(v)?Math.round(v+(255-v)*.45):220);
  let liveOwner=null; // The mounted wing network, for the lighting compositor's per-room lights.
  function mount(options={}){
    const {rec,ruin,plan,hub,makeTile,getPlayerPosition,getPlayerY}=options;
    const THREE=options.THREE||root.THREE,DS=options.DynamicSurfaces||root.DynamicSurfaces;
    const CG=options.CellGrid3D||root.CellGrid3D,DevRandomRuin=options.DevRandomRuin||root.DevRandomRuin;
    const Corridors=options.RuinShaftCorridor||root.RuinShaftCorridor;
    const Challenges=options.RuinLayerChallenges||root.RuinLayerChallenges; // Owns actual stage inputs and canonical projectile hit registrations.
    const Defense=options.RuinLayerDefense||root.RuinLayerDefense; // Composed authored plinth, statue dispenser and enemy waves.
    if(!rec?.scene||!ruin||!plan?.ok||!hub?.ok||!THREE?.InstancedMesh
      ||!DS?.registerSurface||!CG?.create||!Corridors?.rectangles||!Challenges?.compose||!Defense?.create
      ||typeof makeTile!=='function'||typeof getPlayerPosition!=='function')
      throw new Error('Ruin layer physical runtime dependencies are missing.');
    if(!RoomSystem?.planRooms)throw new Error('Seamless ruin room system must load before playable wings.');
    const roomLayout=RoomSystem.planRooms(plan,Challenges.ropePitForRoom); // Deterministic room/door IDs and a structural blueprint shared by lighting, collision and AI.
    if(!roomLayout.ok)throw new Error('Ruin room enclosure invalid: '+roomLayout.errors.join('; '));
    const descriptors=new Map(roomLayout.rooms.map(room=>[room.id,room])); // Used by each wing's shell and automatic entrance door.
    const plannedDoors=new Map(roomLayout.doors.map(door=>[door.roomId,door])); // Stable doorway links also replace the old single-use puzzle gate.
    const roomDoors=new Map(); // Owns each live auto-door state without creating another game-world scene.
    const roomAudits=[]; // Published in the mobile ruin debug snapshot for missing floors/ceilings/partitions.
    let roomSession=null; // Disposed with this ruin, never installed as an unrelated global frame loop.
    const extent=projectedExtent(plan); // Verifies 2D slices have nonnegative world positions before any mutation.
    const cols=Math.max(rec.cols,Math.ceil(extent.maxX)+2),rows=Math.max(rec.rows,Math.ceil(extent.maxZ)+2);
    if(extent.minX<1||extent.minZ<1||cols*rows>MAX_MAP_CELLS)
      throw new Error('Layered ruin extends outside the supported occupancy map ('+
        JSON.stringify({extent,cols,rows})+').');
    const portalAt=(floor,side)=>hub.wingPortals.find(p=>p.floor===floor&&p.side===side);
    for(const floor of plan.floors)for(const wing of floor.wings){
      const portal=portalAt(floor.floor,wing.side);
      if(!portal||Math.floor(portal.world.x)!==wing.entry.x||Math.floor(portal.world.z)!==wing.entry.z
        ||Math.abs(portal.world.y-floor.y)>.001)
        throw new Error('Playable wing does not meet shaft portal: '+wing.id);
    }
    const scope='ruin-layer-playable'; // Private scope for all stacked floor supports, owned by this one ruin session.
    const group=new THREE.Group(); // All room/corridor meshes and mechanism markers for this ruin.
    group.name='ruin-layer-network';rec.scene.add(group);
    const material=root.ProceduralFurniture?.makePartMaterial?.({
      materialTexture:'carved_smooth.png',materialLighting:'unlit',materialFillMode:'never',color:'#777267'
    })||new THREE.MeshBasicMaterial({color:0x777267});
    const tintedStone=(hex,fallback)=>root.ProceduralFurniture?.makePartMaterial?.({
      materialTexture:'carved_smooth.png',materialLighting:'unlit',
      materialFillEnabled:true,materialFillColor:hex,materialFillMode:'always',color:hex,
    })||new THREE.MeshBasicMaterial({color:fallback}); // Recolor the author's stone PNG rather than substituting flat-colored dungeon furniture.
    const wallMaterial=root.RuinWallFaces?.visibleWallMaterial?.(THREE,material)||material; // Wall backfaces remain visible without changing downward-only ceilings or solid floor depth.
    const plateMat=tintedStone('#8c735b',0x8c735b);
    const gateMat=tintedStone('#4f3b32',0x4f3b32);
    const brazierMat=tintedStone('#665346',0x665346);
    const cameraWalls=[]; // Detached geometry is only visible to the camera boom's raycasts.
    const cameraWallMaterial=new THREE.MeshBasicMaterial();
    const materials=[material,wallMaterial,plateMat,gateMat,brazierMat,cameraWallMaterial]; // Disposed together with the geometry and owned interactive controls.
    const wingFlameVisuals=[]; // Owns the player's campfire particle emitters for every ignited wing brazier.
    const roomLights=[]; // One light per puzzle room (and, outside Kanthic, each goal room): a room fills with light when its puzzle is solved.
    const brazierLights=[]; // Kanthic-only completed-wing flames feed the shared darkness overlay without adding real Three.js lights.
    const states=[],gridScopes=[],added=new Set(),surfaces=[]; // Runtime gate/puzzle records, registered voxel scopes, map floor keys and terrain rectangles.
    const ownedControls=new Set(); // Every wing brazier, fire-source and authored puzzle control is released on reroll or failed setup.
    const secrets=[]; // Optional per-room caches and Skeeri shelves; never count toward mandatory wing progression.
    function addControl(control){ruin.controls.push(control);ownedControls.add(control);}
    function removeControl(control){
      const i=ruin.controls.indexOf(control);if(i>=0)ruin.controls.splice(i,1);
      ownedControls.delete(control);
    }
    const floorRoots=new Map(); // Each story owns a presentation group so overhead floors do not conceal the player below.
    let activeRoot=group; // Mesh batching writes into the currently composed story's subscene.
    const owner={group,states,disposed:false,complete:false,lit:0,total:plan.totalBraziers,
      nativeTotal:plan.nativeFloorCount||0,nativeLit:0,geometryCount:0,wallMeshCount:0}; // wallMeshCount is reported by mobile ruin diagnostics; no scene traversal on each status request. // The Great Door requires BOTH composed wings and real V50 floor braziers. // Exposed to mobile diagnostics.
    owner.roomLights=()=>owner.disposed?[]:roomLights;
    liveOwner=owner;
    owner.lightSources=()=>owner.disposed?[]:brazierLights; // Exposes already-created light records without scene traversals during the compositor's 60 Hz pass.
    owner.updateCompletion=()=>{
      owner.complete=owner.lit+owner.nativeLit===owner.total+owner.nativeTotal;
      ruin.shaftNetworkComplete=owner.complete;
    };
    owner.setNativeGoalState=(total,lit)=>{
      if(total!==owner.nativeTotal||!Number.isInteger(lit)||lit<0||lit>total)
        throw new Error('Native V50 braziers disagree with the reserved floor plan');
      owner.nativeLit=lit;
      owner.updateCompletion();
    };
    owner.dispose=()=>{
      if(liveOwner===owner)liveOwner=null;
      roomSession?.dispose?.(); // Wake sleepers before an exit/reroll tears down the shared scene.
      if(owner.disposed)return;owner.disposed=true;
      for(const state of states)for(const challenge of state.challenges)challenge.dispose?.();
      for(const secret of secrets)secret.dispose?.(); // Unregister floor-gated fire, music and ranged contacts before removing stone.
      for(const flame of wingFlameVisuals)flame.dispose?.(); // No stale authored GPU particles after a dungeon reroll.
      for(const control of [...ownedControls])removeControl(control);
      for(const scopeId of gridScopes)DevRandomRuin?.unregisterShaftGrid?.(scopeId);
      DS.clearScope(scope);group.parent?.remove(group);
      const geometries=new Set();
      group.traverse(node=>{if(node.geometry)geometries.add(node.geometry);});
      for(const wall of cameraWalls){
        const index=rec.occlusionMeshes.indexOf(wall);
        if(index>=0)rec.occlusionMeshes.splice(index,1);
        geometries.add(wall.geometry);
      }
      for(const geometry of geometries)geometry.dispose?.();
      for(const mat of materials)mat.dispose?.();
    };
    function mesh(name,geometry,mat,x,y,z){
      const node=new THREE.Mesh(geometry,mat);node.name=name;node.position.set(x,y,z);activeRoot.add(node);return node;
    }
    function instance(name,geometry,cells,mat,where){
      if(!cells.length)return;
      const object=new THREE.InstancedMesh(geometry,mat,cells.length);
      object.name=name;
      const matrix=new THREE.Matrix4(); // Reused for this batch instead of allocating a Matrix4 per floor tile.
      cells.forEach((cell,i)=>{const p=where(cell);object.setMatrixAt(i,matrix.makeTranslation(p.x,p.y,p.z));});
      object.instanceMatrix.needsUpdate=true;activeRoot.add(object);owner.geometryCount++;
      return object;
    }
    // A wing's stone as real faces (js/ruin-wall-faces.js) instead of one-unit instanced boxes: the floor merges into
    // big rectangles and each wall line into runs, all cut into stretch-to-fit patches of at most 6 units. The few
    // longest runs of each wing are feature walls, one mesh each in a flagged group the style pass engraves (one
    // engraving atlas per mesh, so each must be a connected wall, and the count is capped to bound GPU memory). Atlases
    // are capped at 512 px, so a long corridor wall is cut into pieces of at most WING_FEATURE_MAX units first: one
    // engraving over 86 units would get a few pixels per unit and read as mush.
    const WING_FEATURE_RUN=4,WING_FEATURE_MAX=10,WING_FEATURES_PER_WING=4,WALL_HEIGHT=RoomSystem.WALL_HEIGHT,WALL_THICKNESS=.14,PATCH={h:6,v:6};
    function masonry(wingName,y,floorCells,wallsX,wallsZ){
      const Faces=root.RuinWallFaces;
      const add=(name,data,parent=activeRoot,surfaceMaterial=material)=>{
        if(!data.positions.length)return null;
        const node=new THREE.Mesh(Faces.toGeometry(THREE,data),surfaceMaterial);node.name=name;parent.add(node);owner.geometryCount++;
        if(name==='wing-feature-wall'||name.endsWith('-walls'))owner.wallMeshCount++; // Count actual rendered masonry meshes once during generation.
        return node;
      };
      if(floorCells.length){
        let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;
        for(const [x,z] of floorCells){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
        const w=maxX-minX+1,h=maxZ-minZ+1,mask=new Uint8Array(w*h);
        for(const [x,z] of floorCells)mask[(z-minZ)*w+(x-minX)]=1;
        const rects=Faces.mergeMask(mask,w,h).map(r=>({axis:'y',side:1,plane:0,a0:r.i0,a1:r.i1,b0:r.j0,b1:r.j1}));
        const surface=Faces.buildQuads(rects,{origin:{x:minX,y,z:minZ},size:{x:1,y:1,z:1},patch:PATCH});
        const covered=RoomSystem.projectedFloorArea(surface); // Validate actual rendered triangles against the walkable support mask.
        if(Math.abs(covered-floorCells.length)>1e-3)throw new Error(
          'Ruin '+wingName+' floor geometry mismatch: '+covered+' of '+floorCells.length+' cells');
        const floor=add(wingName+'-floor',surface);
        if(!floor)throw new Error('Ruin '+wingName+' has no rendered floor despite '+floorCells.length+' supported tiles');
        floor.userData.hobunjiGroundTopFacesOnly=true;
        floor.userData.ruinVerifiedFloorArea=covered;
      }
      const runs=Faces.mergeEdges([
        ...wallsX.map(([cx,z,faces])=>({along:'x',line:z,from:cx-.5,to:cx+.5,side:faces})),
        ...wallsZ.map(([x,cz,faces])=>({along:'z',line:x,from:cz-.5,to:cz+.5,side:faces})),
      ]);
      const pieces=runs.flatMap(run=>{
        const count=Math.max(1,Math.ceil((run.to-run.from)/WING_FEATURE_MAX-1e-9)),out=[];
        for(let i=0;i<count;i++)out.push({along:run.along,line:run.line,side:run.side,from:run.from+(run.to-run.from)*i/count,to:run.from+(run.to-run.from)*(i+1)/count}); // side travels with each piece: a wall is only ever engraved on the face you can see
        return out;
      });
      const features=pieces.filter(piece=>piece.to-piece.from>=WING_FEATURE_RUN)
        .sort((a,b)=>(b.to-b.from)-(a.to-a.from)).slice(0,WING_FEATURES_PER_WING);
      const featured=new Set(features);
      const wallOptions={y0:y,y1:y+WALL_HEIGHT,thickness:WALL_THICKNESS,patch:PATCH};
      if(features.length){
        const group=new THREE.Group();group.name='ruin-wing-feature-walls';group.userData.ruinFeatureWalls=true;activeRoot.add(group);
        for(const run of features)add('wing-feature-wall',Faces.buildEdgeWallQuads([run],wallOptions),group,wallMaterial);
      }
      add(wingName+'-walls',Faces.buildEdgeWallQuads(pieces.filter(piece=>!featured.has(piece)),wallOptions),activeRoot,wallMaterial);
      if(Faces.buildEdgeCapQuads)add(wingName+'-wall-ends',Faces.buildEdgeCapQuads(runs,wallOptions),activeRoot,wallMaterial); // Closes the void slit at every doorway jamb.
      if(rec.occlusionMeshes&&runs.length){
        const boundary=Faces.buildEdgeWallQuads(runs,{...wallOptions,y0:y+WALL_HEIGHT,y1:y+plan.options.floorHeight});
        const wall=new THREE.Mesh(Faces.toGeometry(THREE,boundary),cameraWallMaterial);
        wall.userData.ruinCameraStoryRoot=activeRoot; // Upper stories hidden by the wing renderer must also stop affecting the camera.
        rec.occlusionMeshes.push(wall);cameraWalls.push(wall);
      }
    }
    function setGate(record,blocked,silent=false){
      if(!record?.gate)return;
      if(record.gate.autoDoor){
        const door=record.gate.autoDoor;
        const changed=door.locked!==blocked;
        door.locked=blocked; // A solved progression gate becomes a normal self-closing door; it never consumes the puzzle's saved completion.
        if(changed&&!silent)root.RuinInteractionAudio?.mechanism?.(door.object,{size:4});
        return;
      }
      for(const [x,z] of record.gate.tiles){
        const c=record.grid.xToCol(x+.5),r=record.grid.zToRow(z+.5);
        record.grid.set(c,r,0,blocked?CG.KIND.SOLID:CG.KIND.AIR);
        record.grid.set(c,r,1,blocked?CG.KIND.SOLID:CG.KIND.AIR);
        // Never stamp a gate into the shared 2D rec.grid: another story
        // can have a perfectly open room at the same X/Z. Only this wing's
        // height-specific voxel grid owns the door's collision.
      }
      const gateObject=record.gate.object,wasVisible=gateObject.visible;
      if(wasVisible!==blocked&&!silent)root.RuinInteractionAudio?.mechanism?.(gateObject,{size:4}); // The story-wing gate changes collision and sound exactly once, not every tick.
      if(blocked){root.GameFeel?.cancelSink?.(gateObject);gateObject.visible=true;}
      else if(silent||!wasVisible||!root.GameFeel?.sinkAway?.(gateObject))gateObject.visible=false; // Collision is already open; the stone visibly sinks into the floor instead of vanishing.

    }
    try{
      for(const floor of plan.floors)for(const wing of floor.wings){
        if(!floorRoots.has(floor.floor)){
          const rootGroup=new THREE.Group(); // Per-story scene root used to occlude floors above current player elevation.
          rootGroup.name='ruin-layer-floor-'+floor.floor;
          floorRoots.set(floor.floor,rootGroup);group.add(rootGroup);
        }
        activeRoot=floorRoots.get(floor.floor);
        const tiles=collect(wing),walkCells=[...tiles].map(k=>k.split(',').map(Number)); // Room/wall footprint keeps the original shape around floorless interiors.
        const ropePits=wing.rooms.filter(room=>room.challenge==='ropeChain').map(room=>Challenges.ropePitForRoom(room,wing.side));
        if(ropePits.some(pit=>!pit))throw new Error('Invalid authored rope-pit footprint in '+wing.id);
        const supportedCells=walkCells.filter(([x,z])=>!ropePits.some(pit=>pit.contains(x+.5,z+.5))); // Draw floor and register support only on the actual safe banks.
        const voidCells=walkCells.length-supportedCells.length; // Exposed in mobile diagnostics to prove the bottomless gap is not merely painted black.
        const localBounds=walkCells.reduce((a,[x,z])=>({
          minX:Math.min(a.minX,x),maxX:Math.max(a.maxX,x),minZ:Math.min(a.minZ,z),maxZ:Math.max(a.maxZ,z)
        }),{minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity});
        const grid=CG.create({originX:localBounds.minX-1,originZ:localBounds.minZ-1,baseY:floor.y,
          cols:localBounds.maxX-localBounds.minX+3,rows:localBounds.maxZ-localBounds.minZ+3,levels:5}); // All four wall voxel layers match the enclosed 3.6-unit room walls.
        const side=SIDES[wing.side],portal=portalAt(floor.floor,wing.side); // Source of truth for the physical mouth shared with the shaft.
        const portalMouth=new Set((portal.mouth||[]).map(([x,z])=>key(x,z))); // Used by both wing voxel borders and rendered face walls.
        if(portalMouth.size!==plan.options.corridorWidth||[...portalMouth].some(cell=>!tiles.has(cell)))
          throw new Error('Wing passage mouth does not match its corridor: '+wing.id);
        // A thin voxel boundary matches the actually drawn stone walls.
        // Filling the entire room's rectangular allocation with SOLID created
        // enormous INVISIBLE walls/roofs that swallowed projectiles passing
        // through perfectly open gaps beside winding corridors.
        const border=new Set(); // Outside neighbors of real walkable cells, never whole empty rectangle.
        for(const [x,z] of walkCells){
          added.add(key(x,z));
          for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
            if(tiles.has(key(x+dx,z+dz)))continue;
            if(portalMouth.has(key(x,z))&&dx===-side.dx&&dz===-side.dz)continue; // Leave every shaft-to-wing passage lane unobstructed.
            border.add(key(x+dx,z+dz));
          }
        }
        for(const next of border){
          const [x,z]=next.split(',').map(Number),c=grid.xToCol(x+.5),r=grid.zToRow(z+.5);
          grid.fillBox(c,r,0,c,r,3,CG.KIND.SOLID); // Solid stone rises to the room ceiling; no whole-room invisible collision fill.
        }
        // The wing portal shares the shaft's outward threshold on the proper story; avoid closing its inward face.
        const wallsX=[],wallsZ=[];
        for(const [x,z] of walkCells){
          // The third entry is the way the wall faces: toward the walkable cell that owns it.
          if(!tiles.has(key(x-1,z))&&!(portalMouth.has(key(x,z))&&side.dx===1))wallsZ.push([x,z+.5,1]);
          if(!tiles.has(key(x+1,z))&&!(portalMouth.has(key(x,z))&&side.dx===-1))wallsZ.push([x+1,z+.5,-1]);
          if(!tiles.has(key(x,z-1))&&!(portalMouth.has(key(x,z))&&side.dz===1))wallsX.push([x+.5,z,1]);
          if(!tiles.has(key(x,z+1))&&!(portalMouth.has(key(x,z))&&side.dz===-1))wallsX.push([x+.5,z+1,-1]);
        }
        const wingName='floor'+floor.floor+'-'+wing.side;
        if(root.RuinWallFaces)masonry(wingName,floor.y,supportedCells,wallsX,wallsZ);
        else{ // Loaded without the face mesher: the original one-unit boxes.
          const slab=instance(wingName+'-floor',new THREE.BoxGeometry(1,.12,1),supportedCells,material,([x,z])=>({x:x+.5,y:floor.y-.06,z:z+.5}));
          if(slab)slab.userData.hobunjiGroundTopFacesOnly=true;
          instance(wingName+'-wall-ns',new THREE.BoxGeometry(1,2.3,.14),wallsX,material,([x,z])=>({x,y:floor.y+1.15,z}));
          instance(wingName+'-wall-ew',new THREE.BoxGeometry(.14,2.3,1),wallsZ,material,([x,z])=>({x,y:floor.y+1.15,z}));
        }
        const supportedSet=new Set(supportedCells.map(([x,z])=>key(x,z))); // One floor-support authority for per-room audits, including intentional rope pits.
        const roomSources=wing.anteroom?[wing.anteroom,...wing.rooms]:wing.rooms; // Shared enclosure and ceiling footprint.
        for(const source of roomSources){
          const room=descriptors.get(source.id);
          if(!room)throw new Error('Missing generated room descriptor: '+source.id);
          const shell=RoomSystem.makeShell({room,THREE,Faces:root.RuinWallFaces,parent:activeRoot,
            material,supportedCells:supportedSet,grid,CG}); // Draws each room's downward-facing ceiling and sealed entrance flanks.
          if(shell.meshes.length!==2&&root.RuinWallFaces)throw new Error('Ruin room '+room.id+' has no complete ceiling/partition meshes');
          if(shell.meshes[1]){shell.meshes[1].material=wallMaterial;for(const ends of shell.meshes[1].children||[])if(ends.isMesh)ends.material=wallMaterial;owner.wallMeshCount++;} // The entrance flanks are vertical walls; the separate room roof retains its inward-only material.
          owner.geometryCount+=shell.meshes.length;
          const walls=RoomSystem.wallAudit(room,tiles,wallsX,wallsZ,room.kind==='shaft-antechamber'?portalMouth:null); // Verify actual exposed wall faces before accepting the generated room.
          if(!walls.ok)throw new Error('Ruin room '+room.id+' has '+walls.missingWallEdges+' missing wall faces');
          roomAudits.push({...shell.audit,...walls});
          const doorPlan=plannedDoors.get(room.id);
          if(!doorPlan)throw new Error('Missing room door: '+room.id);
          const doorTiles=Array.from({length:doorPlan.span},(_,j)=>[
            doorPlan.axis==='x'?Math.floor(doorPlan.x):Math.floor(doorPlan.x)+j-1,
            doorPlan.axis==='z'?Math.floor(doorPlan.z):Math.floor(doorPlan.z)+j-1,
          ]);
          if(!doorTiles.every(([x,z])=>tiles.has(key(x,z))))
            throw new Error('Room doorway spills outside its real wing floor: '+room.id);
          const authored=root.DevRandomRuinFurniturePieces?.buildPassageGate?.({
            span:3,height:2.4,normalAxis:doorPlan.axis,parent:activeRoot,name:'ruin-room-door-'+room.id,
            position:{x:doorPlan.x,y:room.y,z:doorPlan.z},
          });
          const object=authored?.object||mesh('ruin-room-door-'+room.id,
            new THREE.BoxGeometry(doorPlan.axis==='x'?1.1:3,2.4,doorPlan.axis==='z'?1.1:3),
            gateMat,doorPlan.x,room.y+1.2,doorPlan.z);
          const door={...doorPlan,tiles:doorTiles,object,grid,locked:doorPlan.initiallyLocked,
            raised:0,blocked:null,opening:false,baseY:object.position.y};
          roomDoors.set(room.id,door);
          function stampDoor(blocked){
            if(door.blocked===blocked)return;
            door.blocked=blocked;
            for(const [x,z] of door.tiles){
              const c=grid.xToCol(x+.5),r=grid.zToRow(z+.5);
              for(let level=0;level<4;level++)grid.set(c,r,level,blocked?CG.KIND.SOLID:CG.KIND.AIR);
            }
          }
          door.update=(dt,player,py)=>{
            const near=RoomSystem.doorNear(player,door,door.opening,py);
            const opening=!door.locked&&near;
            if(opening!==door.opening){
              door.opening=opening;
              root.RuinInteractionAudio?.mechanism?.(door.object,{size:3}); // Only one sound for a genuine transition.
            }
            const step=Math.min(1,Math.max(0,Number(dt)||0)*3.5);
            door.raised+=((opening?1:0)-door.raised)*step;
            if(Math.abs(door.raised-(opening?1:0))<.004)door.raised=opening?1:0;
            stampDoor(door.locked||door.raised<.92);
            door.object.position.y=door.baseY-2.7*door.raised;
            door.object.visible=door.raised<.998;
          };
          stampDoor(true);
        }
        const corridorRoofCells=[...tiles].map(k=>k.split(',').map(Number)).filter(([x,z])=>
          !roomSources.some(room=>x>=room.x&&x<room.x+room.w&&z>=room.z&&z<room.z+room.d)); // Passage ceilings join room caps without double faces at their shared boundary.
        if(corridorRoofCells.length&&root.RuinWallFaces){
          const Faces=root.RuinWallFaces,bounds=corridorRoofCells.reduce((out,[x,z])=>({
            x0:Math.min(out.x0,x),z0:Math.min(out.z0,z),x1:Math.max(out.x1,x+1),z1:Math.max(out.z1,z+1),
          }),{x0:Infinity,z0:Infinity,x1:-Infinity,z1:-Infinity});
          const w=bounds.x1-bounds.x0,d=bounds.z1-bounds.z0,mask=new Uint8Array(w*d);
          for(const [x,z] of corridorRoofCells)mask[(z-bounds.z0)*w+x-bounds.x0]=1;
          const caps=Faces.mergeMask(mask,w,d).map(rect=>({
            axis:'y',side:-1,plane:0,a0:rect.i0,a1:rect.i1,b0:rect.j0,b1:rect.j1,
          }));
          const roof=new THREE.Mesh(Faces.toGeometry(THREE,Faces.buildQuads(caps,{
            origin:{x:bounds.x0,y:floor.y+WALL_HEIGHT,z:bounds.z0},size:{x:1,y:1,z:1},patch:PATCH,
          })),material);
          roof.name='ruin-wing-corridor-ceiling-'+wing.id;
          roof.userData.devRuinFootprintIgnore=true;activeRoot.add(roof);owner.geometryCount++;
        }
        const rectangles=Corridors.rectangles(supportedCells); // The abyss has NO physical floor and NO DynamicSurfaces standing rectangle.
        rectangles.forEach((r,i)=>{
          const spec={id:scope+'-'+wing.id+'-'+i,scope,priority:1,
            bounds:{minX:r.minC,maxX:r.maxC+1,minZ:r.minR,maxZ:r.maxR+1},topY:floor.y};
          DS.registerSurface(spec);surfaces.push(spec);
        });
        const gridScope=scope+'-'+wing.id;gridScopes.push(gridScope);
        const occupied=(x,z)=>tiles.has(key(Math.floor(x),Math.floor(z))); // Avoid selecting the wing's empty rectangular allocation when other floors overlap X/Z.
        DevRandomRuin?.registerShaftGrid?.(gridScope,grid,()=>owner.dispose(),occupied);
        const record={wingId:wing.id,floor:floor.floor,side:wing.side,grid,solved:0,
          challenges:[],braziers:[],walkable:supportedCells.length,voidCells}; // Physical room stage and missing support cells are tracked separately.
        states.push(record);
        for(let i=0;i<wing.rooms.length-1;i++){
          const room=wing.rooms[i],cx=room.x+room.w/2,cz=room.z+room.d/2;
          const roomHex=ruin.lichColor||({tothal:'#8fd6ff',hronal:'#ff8a3a',kanthic:'#b47bff'})[ruin.theme]||'#ff8b3d';
          const roomRgb=[1,3,5].map(n=>parseInt(String(roomHex).slice(n,n+2),16)).map(v=>Number.isFinite(v)?Math.round(v+(255-v)*.45):220); // The lich's colour, washed toward white: a lit room, not a coloured spotlight.
          const roomLight={x:cx,y:floor.y+1.4,z:cz,floorY:floor.y,floorTolerance:3,radius:Math.max(room.w,room.d)*.7+2,strength:.92,color:roomRgb,roomBound:true,active:false};
          roomLights.push(roomLight);
          let gateLight=null; // Lights the doorway the solve is about to open (assigned below once the gate is known).
          let challenge=null; // Created by the shared mechanism runtime; its onSolved opens this chamber's real next gate.
          challenge=Challenges.compose({
            THREE,parent:activeRoot,room,y:floor.y,id:room.id,kind:room.challenge,side:wing.side,
            ruinTier:ruin.tier??plan.options?.tier??null, // The original cave/hole/lich rarity is shared by every wing's song.
            theme:ruin.theme||null,
            RuinLayerDefense:Defense,mapId:String(rec.mapData?.id||'map_i_dev_random_ruin'),
            isActive:()=>record.solved===i&&!owner.disposed
              &&(room.challenge!=='findBlocks'||Math.abs(Number(getPlayerY?.())-floor.y)<4.5), // Stacked block barriers must not project onto a lower floor.
            getPlayerPosition,getPlayerY,
            addControl,removeControl,
            showToast:options.showToast, // One shared resolver owns these controls, and this network owns their cleanup.
            onMusicStart:()=>{}, // Zelda-style discovery: pressing the bronze plate plays the tune with no tutorial popup.
            onMusicUnavailable:()=>options.showToast?.('The bronze plate remains silent.',false),
            onLink:()=>options.onStateChange?.(), // Report native projectile/fire/defence registration without a dev console.
            onError:challenge=>{options.showToast?.(challenge.kind==='findBlocks'?'Find the Blocks unavailable: '+challenge.error:'Statue defence unavailable: '+challenge.error,false);options.onStateChange?.();},
            onSolved:()=>{
              if(owner.disposed||record.solved!==i)return;
              record.solved++;
              options.onProgressChange?.(); // Persist this gate's completed stage before the reveal animation.
              roomLight.active=true;if(gateLight)gateLight.active=true; // The solved room AND the doorway about to open light up first...
              options.onStateChange?.();
              root.RuinInteractionAudio?.puzzleComplete?.(); // Chime + reveal window before the gate starts moving.
              const openGate=()=>{ // ...then the stone gate moves and the reveal camera pans to it, so the door is actually visible when the shot arrives.
                if(owner.disposed)return;
                setGate(challenge,false);
                options.showToast?.(challenge.kind==='pressurePlate'?'A stone gate opens.'
                  :challenge.kind==='timedMelody'?'The stone answers your melody — a gate opens.'
                  :challenge.kind==='dungeonFire'?'The ice recedes — a stone gate opens.'
                  :challenge.kind==='statueDefense'?'The defended statue sinks into the plinth — a stone gate opens.'
                  :challenge.kind==='ropeChain'?'The far bank releases the stone gate.'
                  :challenge.kind==='findBlocks'?'Four stone blocks settle — the gate opens.'
                  :'The last target falls — the stone gate opens.',true);
                options.onStateChange?.();
              };
              const delay=Number.isFinite(Number(options.gateOpenDelayMs))?Number(options.gateOpenDelayMs):(typeof document!=='undefined'?450:0); // Headless node tests open the gate immediately.
              if(delay>0&&typeof setTimeout==='function')setTimeout(openGate,delay);else openGate();
            }
          });
          challenge.x=cx;challenge.z=cz;challenge.floorY=floor.y;challenge.gate=null;
          challenge.restoreSolved=()=>{roomLight.active=true;if(gateLight)gateLight.active=true;setGate(challenge,false,true);}; // A reload opens the same real voxel gate without repeating puzzle audio.
          const next=wing.corridors[i+1];
          if(next){
            const nextRoom=wing.rooms[i+1],door=roomDoors.get(nextRoom?.id);
            if(!door)throw new Error('Challenge has no self-closing destination door: '+room.id);
            challenge.gate={tiles:door.tiles,object:door.object,autoDoor:door};
            gateLight={x:door.x,y:floor.y+1.4,z:door.z,floorY:floor.y,floorTolerance:3,
              radius:5.5,strength:.95,color:roomRgb,active:false};
            roomLights.push(gateLight);
            challenge.grid=grid;
            setGate(challenge,true,true); // Locked until this stage solves; afterward proximity controls it.
          }
          record.challenges.push(challenge);
          if(secrets.length<6){ // Optional rewards have a bounded per-ruin footprint; even dense five-floor layouts stay mobile-safe.
            const secret=root.RuinHiddenSecrets?.create?.({room,seed:ruin.seed??plan.options?.seed??0,
              theme:ruin.theme,ruinTier:ruin.tier??plan.options?.tier,THREE,parent:activeRoot,DynamicSurfaces:DS,
              mapId:String(rec.mapData?.id||'map_i_dev_random_ruin'),getPlayerPosition,getPlayerY,
              allowBrood:secrets.filter(entry=>entry.babies>0).length<2, // At most two independent hatchling shelves in the entire layered ruin.
              addControl,removeControl,showToast:options.showToast,onStateChange:options.onStateChange});
            if(secret)secrets.push(secret); // No existing challenge or objective ownership is changed.
          }
        }
        const goal=wing.rooms[wing.rooms.length-1],bx=goal.x+goal.w/2,bz=goal.z+goal.d/2;
        // The sanctum's stone-bowl brazier, bigger, burning in the lich's colour (the same
        // colour as the named-lich wall glow). Falls back to the plain cylinder if the
        // sanctum module is unavailable.
        const lichColor=ruin.lichColor||({tothal:'#8fd6ff',hronal:'#ff8a3a',kanthic:'#b47bff'})[ruin.theme]||'#ff8b3d';
        const lichBrazier=root.DevRandomRuinSanctum?.buildLichBrazier?.({parent:activeRoot,x:bx,y:floor.y,z:bz,scale:2.6,color:lichColor,name:'ruin-brazier-'+wing.id});
        let pedestal,flame;
        if(lichBrazier){
          pedestal=lichBrazier.holder;flame=lichBrazier.fire.anchor;
          wingFlameVisuals.push({roomId:goal.id,update:dt=>lichBrazier.update(dt),dispose:()=>lichBrazier.fire.emitter?.dispose?.()}); // Flicker + particles each tick; emitter freed on reroll.
        }else{
          pedestal=mesh('ruin-brazier-'+wing.id,new THREE.CylinderGeometry(.7,.85,.65,8),brazierMat,bx,floor.y+.38,bz);
          flame=new THREE.Group(); // Particle anchor replaces the opaque cone; visible only after this brazier is lit.
          flame.name='ruin-brazier-flame-'+wing.id;
          flame.position.set(bx,floor.y+1.27,bz);flame.visible=false;activeRoot.add(flame);
          const flameVisual=root.PersistentGroundFire?.attachCampfireFlame?.(flame,{scale:1.1,rateScale:.95});
          if(flameVisual)wingFlameVisuals.push({...flameVisual,roomId:goal.id}); // Uses the exact player-placeable campfire emitter recipe.
        }
        const lichRgb=[1,3,5].map(i=>parseInt(String(lichColor).slice(i,i+2),16));
        const goalLight=ruin.theme==='kanthic'?null:{x:bx,y:floor.y+1.4,z:bz,floorY:floor.y,floorTolerance:3,radius:Math.max(goal.w,goal.d)*.7+2,strength:.92,color:lichRgbWashed(lichColor),roomBound:true,active:false}; // Kanthic's goal room is already lit by its brazier record below.
        if(goalLight)roomLights.push(goalLight);
        const brazierLight={x:bx,y:floor.y+1.4,z:bz,floorY:floor.y,radius:10,strength:.98,roomBound:true,flameAnchor:flame,flameHalo:lichBrazier?.fire.halo,
          color:lichRgb.every(Number.isFinite)?lichRgb:[255,139,61],active:false}; // The compositor limits this Kanthic brazier to nearby light while replaying its original flame.
        if(ruin.theme==='kanthic')brazierLights.push(brazierLight);
        const brazier={id:wing.goalBrazierId,wingId:wing.id,lit:false,flame,pedestal};
        brazier.restoreLit=()=>{
          if(brazier.lit)return false;
          brazier.lit=true;flame.visible=true;brazierLight.active=true;lichBrazier?.ignite?.();
          if(goalLight)goalLight.active=true;
          owner.lit++;owner.updateCompletion();
          return true;
        }; // One ignition authority for manual lighting and world-save restoration.
        record.braziers.push(brazier);
        addControl({
          kind:'layerBrazier',object:pedestal,promptRoot:pedestal,floorY:floor.y,range:1.7,
          priority:20,touchIcon:'🔥',lit:()=>brazier.lit,available:()=>!brazier.lit,
          label:()=>brazier.lit?'Brazier Burning':'Ignite Wing Brazier',
          onPress:()=>{
            if(brazier.lit||Math.abs(Number(getPlayerY?.())-floor.y)>.8)return; // A brazier on floor 4 cannot be lit through the deck from a lower floor.
            if(record.solved<record.challenges.length){options.showToast?.('Complete the wing challenges first.',false);return;}
            brazier.restoreLit(); // ignite() also wakes the existing particle emitter.
            options.onProgressChange?.(); // Save the exact lit-wing count, not just its visual flame.
            if(ruin.theme==='kanthic')root.CloudForestFog?.refreshLightingOverlay?.(); // The lit wing becomes visible on the first rendered frame, including mobile.
            root.RuinInteractionAudio?.igniteTorch?.();
            if(owner.complete)root.RuinInteractionAudio?.puzzleComplete?.();else root.RuinInteractionAudio?.progress?.(owner.lit+owner.nativeLit,owner.total+owner.nativeTotal);
            options.showToast?.(owner.complete?'All wing braziers are lit — the Great Door\'s binding breaks.':`Wing brazier ignited (${owner.lit+owner.nativeLit}/${owner.total+owner.nativeTotal}).`,true);
            options.onStateChange?.();
          }
        });
      }
      // Extend one normal building-map footprint to include all physical story
      // slices. Elevation-specific collision is resolved by the registered
      // CellGrid3D wing grid, NOT by teleporting to a new scene.
      for(let z=0;z<rows;z++){
        const row=rec.grid[z]||(rec.grid[z]=[]);
        while(row.length<cols)row.push(makeTile(false));
      }
      for(const k of added){
        const [x,z]=k.split(',').map(Number);
        if(rec.floorSet.has(k))continue;
        rec.grid[z][x]=makeTile(true);rec.floorSet.add(k);rec.mapData.floor.push([x,z]);
      }
      rec.cols=cols;rec.rows=rows;rec.mapData.cols=cols;rec.mapData.rows=rows;
      ruin.cols=cols;ruin.rows=rows;
      // The flat projection intentionally stays open even where a floor
      // above or below has a closed stone gate. CellGrid3D is the authority
      // for every individual story's passage blockers.
    }catch(error){
      owner.dispose?.();
      // Rollback for a failed startup is handled by clearRuntime(), which
      // discards this session-only map; no partially playable network is kept.
      throw error;
    }
    const allRooms={...roomLayout,shaft:plan.shaft,rooms:[...roomLayout.rooms,...(options.initialRooms||[])]}; // Original V50 vestibule participates in light/hostile isolation without rebuilding its authored walls.
    roomSession=RoomSystem.mount({layout:allRooms,getPlayerPosition,getPlayerY,
      mapId:String(rec.mapData?.id||'map_i_dev_random_ruin'),
      tile:Number(root.Combat?.deps?.TILE)||64,
      getHostiles:()=>root.Combat?.deps?.hostileObjects,
      getWalkers:()=>root.Combat?.deps?.npcWalkers||root._npcWalkers}); // Both hostiles and ordinary NPC walkers sleep outside the current room.
    owner.registerRooms=additional=>roomSession?.addRooms?.(additional); // Native V50 rooms arrive after their reserved story geometry mounts.
    owner.tick=(dt)=>{
      if(owner.disposed)return;
      const player=getPlayerPosition(),y=Number(getPlayerY?.()); // Actor feet elevation disambiguates vertically overlapping room coordinates.
      if(!player||!Number.isFinite(y))return;
      roomSession.tick(dt);
      for(const door of roomDoors.values())door.update(dt,player,y); // One ownership tick, no independent rAF or duplicated 2D collision overlay.
      // When on the ground floor, an upper floor's stone deck would otherwise
      // be drawn over the player by the overhead third-person camera. Keep
      // physical collision/supports active; hide ONLY the upper story meshes.
      for(const [floor,rootGroup] of floorRoots)rootGroup.visible=floor*plan.options.floorHeight<=y+.8;
      for(const flame of wingFlameVisuals)
        if(roomSession.isRoomActive(flame.roomId))flame.update?.(Math.max(0,Math.min(.05,dt))); // Particle work sleeps in every closed room.
      for(const secret of secrets)if(roomSession.isRoomActive(secret.roomId))secret.tick?.(dt);
      for(const record of states){
        const current=record.challenges[record.solved];
        if(current&&roomSession.isRoomActive(current.id))current.tick?.(dt); // Inactive rooms do not advance puzzles or their input clocks.
        for(let i=0;i<record.solved;i++){
          const solved=record.challenges[i];
          if(roomSession.isRoomActive(solved.id))solved.animate?.(dt); // Cosmetic completion remains visible once that room is revisited.
        }
      }
    };
    owner.serializeProgress=()=>Object.fromEntries(states.map(record=>[
      record.wingId,{solved:record.solved,lit:record.braziers[0]?.lit===true}
    ])); // Tiny, stable IDs for the shared world save; no scene/Three.js objects.
    owner.restoreProgress=(saved={})=>{
      if(owner.disposed||!saved||typeof saved!=='object')return false;
      let restored=false;
      for(const record of states){
        const data=saved[record.wingId];
        if(!data||!Number.isInteger(data.solved)||data.solved<0||data.solved>record.challenges.length)continue;
        for(let i=0;i<data.solved;i++)record.challenges[i]?.restoreSolved?.();
        record.solved=data.solved;
        if(data.lit===true&&record.solved===record.challenges.length)record.braziers[0]?.restoreLit?.();
        restored=true;
      }
      owner.updateCompletion();
      return restored;
    };
    owner.getState=()=>({floors:plan.floorCount,wings:states.length+owner.nativeTotal,
      braziers:owner.total+owner.nativeTotal,lit:owner.lit+owner.nativeLit,
      nativeFloors:owner.nativeTotal,nativeBraziers:owner.nativeLit,
      complete:owner.complete,rooms:states.reduce((n,r)=>n+r.challenges.length+1,0),
      challengesSolved:states.reduce((n,r)=>n+r.solved,0),
      challengesTotal:states.reduce((n,r)=>n+r.challenges.length,0),
      challengeKinds:states.flatMap(r=>r.challenges.map(c=>c.kind)),
      hiddenDiscoveries:secrets.map(secret=>secret.snapshot()), // Mobile debug includes each secret's activation and chest state.
      projectileTargetsLinked:states.reduce((n,r)=>n+r.challenges.filter(c=>c.linked).length,0),
      floorlessCells:states.reduce((n,r)=>n+r.voidCells,0),
      ropeChainsLinked:states.reduce((n,r)=>n+r.challenges.filter(c=>c.ropeLinked).length,0),
      ropeRooms:states.flatMap(r=>r.challenges.filter(c=>c.kind==='ropeChain')
        .map(c=>({id:c.id,linked:!!c.ropeLinked,count:c.ropesRequested||0,
          geometry:c.ropeGeometry||null,error:c.error||null}))), // Mobile getState shows baseline range, rope offsets and puzzle linkage without devtools.
      defenseRoomsReady:states.reduce((n,r)=>n+r.challenges.filter(c=>c.kind==='statueDefense'&&c.ready).length,0),
      wallRender:{doubleSided:wallMaterial?.side===THREE.DoubleSide,meshes:owner.wallMeshCount}, // Mobile diagnostics identify the actual one-sided-wall failure without a scene traverse.
      roomEnclosures:{...roomSession?.snapshot(),audits:roomAudits,
        closedDoors:[...roomDoors.values()].filter(d=>d.blocked).length,
        doorCount:roomDoors.size}, // Mobile debug includes room ID, structural audit and suspended NPC totals.
      defenseErrors:states.flatMap(r=>r.challenges.filter(c=>c.kind==='statueDefense'&&c.error)
        .map(c=>({id:c.id,error:c.error,attempts:c.attempts}))),
      findBlocks:states.flatMap(r=>r.challenges.filter(c=>c.kind==='findBlocks')
        .map(c=>({id:c.id,ready:c.ready,linked:c.linked,error:c.error,variant:c.variant,netVariant:c.netVariant,progress:c.snapshot?.()?.weighted??0}))), // In-game mobile diagnostics show each compound chamber's progress and installed variants.
      pendingRuntimeLinks:states.flatMap(record=>{
        const stage=record.challenges[record.solved];
        if(!stage)return [];
        const ranged=['glyphObelisk','ceilingRailTargets'].includes(stage.kind);
        return ranged&&!stage.linked||stage.kind==='dungeonFire'&&!stage.fireLinked
          ||stage.kind==='ropeChain'&&!stage.ropeLinked
          ||stage.kind==='statueDefense'&&!stage.ready
          ||stage.kind==='findBlocks'&&(!stage.ready||!stage.linked)
          ?[{wingId:record.wingId,stage:stage.id,kind:stage.kind}]:[];
      }),
      perFloor:plan.floors.map(f=>({floor:f.floor,y:f.y,nativeV50:!!f.nativePort,
        wings:states.filter(r=>r.floor===f.floor).map(r=>({
        side:r.side,solved:r.solved,total:r.challenges.length,lit:r.braziers[0]?.lit===true
      }))}))});

    return owner;
  }
  return Object.freeze({mount,projectedExtent,collect,selectGrid,roomLights:()=>liveOwner&&!liveOwner.disposed?liveOwner.roomLights():[]});
});

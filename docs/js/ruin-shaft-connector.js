// RuinShaftConnector — a real walkable passage to the multi-floor shaft.
// This replaces the former Enter/Return Shaft Hub teleport prompts; the upper
// independent 2D layers are now rendered and kept on elevation-aware walkable grids.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinShaftConnector=api;
})(typeof self!=='undefined'?self:globalThis,function(root){
  'use strict';
  const SIDES={north:{dx:0,dz:-1},east:{dx:1,dz:0},south:{dx:0,dz:1},west:{dx:-1,dz:0}};
  const key=(c,r)=>c+','+r;
  const inOctagon=(c,r,lo,hi,cut)=>c>=lo&&r>=lo&&c<=hi&&r<=hi&&c+r>=2*lo+cut&&c+r<=2*hi-cut&&c-r<=hi-lo-cut&&r-c<=hi-lo-cut;
  function entranceOutside(meta,pad=2,tileScale=2){
    const e=meta?.entrance,side=SIDES[e?.side];
    if(!e||!side)return null;
    const cs=(Number(meta.cellSize)||.5)*tileScale; // Matches V50's 2x horizontal floor projection.
    const padX=typeof pad==='object'?Number(pad.x):Number(pad);
    const padZ=typeof pad==='object'?Number(pad.z):Number(pad);
    const x=padX+(e.axis==='x'?Number(e.boundary):Number(e.center))*cs;
    const z=padZ+(e.axis==='x'?Number(e.center):Number(e.boundary))*cs;
    if(!Number.isFinite(x)||!Number.isFinite(z))return null;
    // Half a tile outside the existing V50 doorway: players can walk straight
    // back inside, rather than being dropped at the spawn by an interaction.
    return {x:Math.floor(x+side.dx*.5),z:Math.floor(z+side.dz*.5),side:e.side};
  }
  function sanctumDoorSite(hub,width=4.5){ // Use the maximum supported Great Door width, including its frame clearance.
    // The Great Door is a teleporting endgame seal on the REAL shaft's inner
    // wall, not a spare fifth passage through a wall already used by four exits.
    const grid=hub?.grid,o=hub?.options;
    if(!hub?.ok||!grid||!o?.octagon)return null;
    const lo=o.wall,hi=lo+o.shaft-1,mid=lo+(o.shaft-1)/2;
    const half=Math.max(2,Math.ceil((Number(width)||3.2)/2+.4)); // Door plus stone frame must sit entirely on one solid wall.
    const directions=[
      {side:'N',dx:0,dz:1},{side:'S',dx:0,dz:-1},
      {side:'W',dx:1,dz:0},{side:'E',dx:-1,dz:0},
    ]; // Prefer a floor-zero wall; never take another shaft exit or upper-story balcony.
    for(const facing of directions)for(const shift of [-11,-12,-10,-13,-9,-14,-8,-15]){
      const across=mid+shift;
      const cell=step=>{
        if(facing.side==='N')return{c:across,r:lo+step};
        if(facing.side==='S')return{c:across,r:hi-step};
        if(facing.side==='W')return{c:lo+step,r:across};
        return{c:hi-step,r:across};
      };
      let clear=true;
      for(let lateral=-half;lateral<=half&&clear;lateral++)for(let depth=0;depth<=3;depth++){
        const at=cell(depth),c=at.c+(facing.dx?0:lateral),r=at.r+(facing.dz?0:lateral);
        if(!grid.canStand(c,r,0))clear=false;
        if(depth===0){
          const behind=cell(-1),bc=behind.c+(facing.dx?0:lateral),br=behind.r+(facing.dz?0:lateral);
          if(!grid.isSolid(bc,br,0))clear=false; // Back the prop with actual shaft masonry, not a portal hole or missing wall.
        }
      }
      if(!clear)continue;
      const occupied=[...(hub.wingPortals||[]).filter(port=>port.floor===0),
        ...(hub.entrance?[{side:hub.entrance.side,col:hub.entrance.col,row:hub.entrance.row}]:[])];
      if(occupied.some(port=>port.side===facing.side&&Math.abs(
        (facing.dz?port.col:port.row)-across)<half+4))continue;
      const edge=cell(0);
      const x=facing.dx?grid.colToX(facing.dx>0?lo:hi+1):grid.colToX(edge.c+.5);
      const z=facing.dz?grid.rowToZ(facing.dz>0?lo:hi+1):grid.rowToZ(edge.r+.5);
      return {x,z,floorY:grid.levelToY(0),height:3.1,side:facing.side,
        normal:{x:facing.dx,z:facing.dz},
        tangent:{x:-facing.dz,z:facing.dx},
        shaft:true}; // World-space wall face; the existing Great Door controls handle the fade teleport.
    }
    return null; // Never silently mount the Great Door back inside the old V50 room.
  }

  function stoneMaterial(THREE){
    return root.ProceduralFurniture?.makePartMaterial?.({materialTexture:'carved_smooth.png',materialLighting:'unlit',materialFillMode:'never',color:'#7a746b'})
      ||new THREE.MeshBasicMaterial({color:0x7a746b}); // Shared V50 ruin stone, not untextured shaft gray.
  }
  function visual(tiles,THREE,parent,baseY,allWalkable){
    const group=new THREE.Group(); // Owns all corridor meshes for one ruin session.
    group.name='ruin-physical-shaft-connector';
    const floorMat=stoneMaterial(THREE),wallMat=floorMat.clone();
    const floors=new THREE.InstancedMesh(new THREE.BoxGeometry(1,.12,1),floorMat,tiles.length);
    const mat=new THREE.Matrix4();
    const keys=allWalkable||new Set(tiles.map(([c,r])=>key(c,r))); // Do not put walls across the existing ruin entrance or the shaft's open mouth.
    const wallsX=[],wallsZ=[];
    for(let i=0;i<tiles.length;i++){
      const [c,r]=tiles[i];
      floors.setMatrixAt(i,mat.makeTranslation(c+.5,baseY-.06,r+.5));
      if(!keys.has(key(c-1,r)))wallsZ.push([c,r+.5]);
      if(!keys.has(key(c+1,r)))wallsZ.push([c+1,r+.5]);
      if(!keys.has(key(c,r-1)))wallsX.push([c+.5,r]);
      if(!keys.has(key(c,r+1)))wallsX.push([c+.5,r+1]);
    }
    floors.name='ruin-corridor-carved-floor';group.add(floors);
    const buildWalls=(positions,geometry,name)=>{
      const mesh=new THREE.InstancedMesh(geometry,wallMat,positions.length);
      positions.forEach(([x,z],i)=>mesh.setMatrixAt(i,mat.makeTranslation(x,baseY+1.15,z)));
      mesh.name=name;group.add(mesh);
    };
    buildWalls(wallsX,new THREE.BoxGeometry(1,2.3,.12),'ruin-corridor-north-south-walls');
    buildWalls(wallsZ,new THREE.BoxGeometry(.12,2.3,1),'ruin-corridor-east-west-walls');
    parent.add(group);
    return ()=>{group.parent?.remove(group);group.traverse(node=>node.geometry?.dispose?.());
      const textures=new Set([floorMat.map,wallMat.map].filter(Boolean)); // Shared clones must be released once after their owning corridor materials.
      floorMat.dispose();wallMat.dispose();textures.forEach(texture=>texture.dispose?.());};
  }
  function connect({rec,ruin,seed,meta,pad=2,tileScale=2,THREE,makeTile,DynamicSurfaces:DS,ShaftHub,ClimbSurfaces,DevRandomRuin,TileOccupancy,RuinLayerPlan,RuinShaftCorridor,RuinLayerPlayable,RuinLayerChallenges,RuinLayerDefense,RuinV50NativeFloors,RuinReachingObelisks=root.RuinReachingObelisks,preplanned=null,nativeFloors=[],prepareMaterials=null,CellGrid3D,getPlayerPosition,getPlayerY,showToast,onStateChange}={}){
    if(!rec||!ruin||!meta||!THREE||!DS||!ShaftHub||!RuinLayerPlan||!RuinShaftCorridor||!RuinLayerPlayable||!RuinLayerChallenges||!RuinLayerDefense||!CellGrid3D||preplanned?.nativeFloorCount&&!RuinV50NativeFloors||!makeTile)
      throw new Error('Shaft connector dependencies are incomplete.');
    const spacing=64; // Snap multi-story anchors far apart; floor room networks fill the open cells.
    // Reserve enough clearance for up to five freely placed puzzle rooms in
    // every cardinal direction. The independent stories keep positive 2D map
    // coordinates while the original V50 room stays at its authored position.
    const anchorX=Math.ceil(Math.max(rec.cols+spacing,spacing*3)/spacing)*spacing;
    const anchorZ=Math.ceil(Math.max(rec.rows+spacing,spacing*3)/spacing)*spacing;
    const plan=preplanned||RuinLayerPlan.compose({seed,spacing,anchorX,anchorZ,shaftSize:45,floorHeight:16,
      shaftTraversal:ruin.storyVault||ruin.hachutu?'buttress':null});
    if(preplanned&&!preplanned.options.groundEntranceSide&&(preplanned.shaft.anchor.x<rec.cols+spacing||preplanned.shaft.anchor.z<rec.rows+spacing))
      throw new Error('Reserved native V50 shaft overlaps the original entry-floor V50 footprint');
    if(!plan.ok)throw new Error('Layer plan invalid: '+plan.checks.filter(c=>!c.ok).map(c=>c.name).join(', '));
    const portals=plan.floors.flatMap(f=>[
      ...f.wings.map(w=>({floor:f.floor,side:w.side})),
      ...(f.nativePort?[{floor:f.floor,side:f.nativePort.side}]:[]),
    ]); // All E-side native V50 entrances are reserved before V50 emits any floor scene. // Every generated room chain now receives a separate physical doorway.
    const shaftOptions={seed,floors:plan.floorCount,chambers:false,wall:plan.options.shaftWall,
      shaft:plan.options.shaftSize,spacing:plan.options.floorHeight,traversal:plan.options.shaftTraversal,
      entranceSide:plan.options.groundEntranceSide||'W',portals};
    const hub=ShaftHub.compose(shaftOptions); // The real shared room; origin is set below after determining its full masonry shell.
    const originX=plan.shaft.anchor.x-Math.floor(hub.cols/2),originZ=plan.shaft.anchor.z-Math.floor(hub.rows/2); // The pre-generation anchor owns every portal and wing, including the rendered shaft.
    const placed=ShaftHub.compose({...shaftOptions,originX,originZ});
    if(!placed.ok)throw new Error('Octagonal shaft failed: '+placed.checks.filter(c=>!c.ok).map(c=>c.name).join(', '));
    const greatDoorSite=sanctumDoorSite(placed); // Ground-story inner shaft wall is reserved for the final teleporting door.
    if(!greatDoorSite&&!ruin.hachutu&&!ruin.storyVault)throw new Error('Shared shaft has no unobstructed Great Door wall face');
    const oldCols=rec.cols,oldRows=rec.rows,oldFloor=new Set(rec.floorSet); // Original geometry stays fixed and remains the gameplay entry.
    const authoredExit=ruin.storyVault?rec.exits?.[0]?.tiles?.[0]:null; // The fixed Harlyao vault has an authored south-facing open doorway, but no V50 entrance metadata.
    const entrance=authoredExit?{x:authoredExit[0],z:authoredExit[1]+1,side:'south'}:entranceOutside(meta,pad,tileScale);
    if(!entrance)throw new Error('Generated ruin has no physical doorway to connect.');
    const mouth={x:Math.floor(placed.grid.colToX(placed.entrance.col+.5)),z:Math.floor(placed.grid.rowToZ(placed.entrance.row+.5))};
    const cols=Math.max(oldCols,Math.ceil(placed.grid.colToX(placed.cols))+3),rows=Math.max(oldRows,Math.ceil(placed.grid.rowToZ(placed.rows))+3);
    const mainBounds=authoredExit
      ?{minX:0,minZ:0,maxX:oldCols,maxZ:authoredExit[1]+1} // The fixed vault's authored walls end at its single south opening.
      :null; // V50 entrance is at a ROOM edge, not necessarily the full layout edge. Existing occupied cells, not the overall rectangle, are the obstacles.
    const shaftBounds={minX:originX,minZ:originZ,maxX:originX+placed.cols,maxZ:originZ+placed.rows};
    if(plan.options.groundEntranceSide&&[...oldFloor].some(cell=>{
      const [x,z]=cell.split(',').map(Number);
      return x>=shaftBounds.minX&&x<shaftBounds.maxX&&z>=shaftBounds.minZ&&z<shaftBounds.maxZ;
    }))throw new Error('V50 vestibule or sanctum intrudes into the shaft masonry');
    // The entrance hallway must not be routed through the *ground-level*
    // challenge rooms that are about to be materialized. Upper floors can
    // legitimately cross its 2D projection because their collision is height
    // specific; floor-zero walls cannot.
    const reservedGround=new Set(oldFloor);
    for(const wing of plan.floors[0].wings)
      for(const tile of RuinLayerPlayable.collect(wing))reservedGround.add(tile);
    const route=RuinShaftCorridor.route({start:entrance,end:mouth,width:3,existing:reservedGround,mainBounds,shaftBounds,maxX:cols,maxZ:rows,entryClearance:plan.options.groundEntranceSide?3:0});
    if(route.ok&&plan.options.groundEntranceSide&&(route.corners!==0||route.length>12))
      throw new Error('V50 vestibule requires one short straight approach to the shaft, not a winding hallway');
    if(!route.ok)throw new Error('Shaft must connect physically: '+route.reason+
      ' (entry '+entrance.x+','+entrance.z+' → '+mouth.x+','+mouth.z+
      '; main cells '+oldCols+'×'+oldRows+'; blocked floors '+oldFloor.size+')');
    // V50's exterior door is metadata-centred; its actual walkable threshold
    // can begin 1–3 cells farther inside. Join these cells explicitly, or the
    // new corridor wall would seal an otherwise valid-looking doorway.
    if(plan.options.groundEntranceSide){
      const facing=SIDES[entrance.side]; // Inward direction starts opposite this V50 exterior normal.
      const contact=[0,1,2,3].find(step=>
        oldFloor.has(key(entrance.x-facing.dx*step,entrance.z-facing.dz*step)));
      if(contact===undefined)throw new Error('V50 vestibule corridor has no physical entry-floor contact');
      const routeKeys=new Set(route.tiles.map(([x,z])=>key(x,z)));
      for(let step=1;step<contact;step++){
        const x=entrance.x-facing.dx*step,z=entrance.z-facing.dz*step;
        const tile=key(x,z);
        if(!routeKeys.has(tile)){route.tiles.push([x,z]);routeKeys.add(tile);}
      }
      const connected=new Set([...oldFloor,...routeKeys]); // Union of actual V50 floor, door threshold, and shaft corridor.
      const spawnKey=key(Math.floor(ruin.spawn.x),Math.floor(ruin.spawn.z));
      const mouthKey=key(mouth.x,mouth.z);
      const solidType=makeTile(false).type;
      const physical=k=>{
        if(!oldFloor.has(k))return false;
        const [x,z]=k.split(',').map(Number);
        return rec.grid[z]?.[x]?.type===solidType
          ||!!ruin.occupancy?.blocksBox?.(x+.5,z+.5,.08,placed.grid.baseY);
      };
      const seen=new Set([spawnKey]),queue=[spawnKey];
      for(let head=0;head<queue.length&&!seen.has(mouthKey);head++){
        const [x,z]=queue[head].split(',').map(Number);
        for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
          const next=key(x+dx,z+dz);
          if(!connected.has(next)||seen.has(next)||physical(next))continue;
          seen.add(next);queue.push(next);
        }
      }
      if(!seen.has(mouthKey))
        throw new Error('V50 entrance room cannot physically reach the shaft across its doorway');
    }
    // Avoid mutating the real map until the entire shaft/route has passed its proofs.
    const added=new Set(); // Used by the visual, support registration and mobile debug.
    const mark=(c,r)=>{const id=key(c,r);if(oldFloor.has(id)||added.has(id))return;added.add(id);};
    for(const [c,r] of route.tiles)mark(c,r);
    const cut=Math.floor(placed.options.shaft*.19)+placed.options.wall;
    for(let r=0;r<placed.rows;r++)for(let c=0;c<placed.cols;c++)
      if(inOctagon(c,r,0,placed.cols-1,cut)&&placed.grid.canStand(c,r,0))
        mark(Math.floor(placed.grid.colToX(c+.5)),Math.floor(placed.grid.rowToZ(r+.5)));
    for(let r=0;r<rows;r++){
      const row=rec.grid[r]||(rec.grid[r]=[]);
      while(row.length<cols)row.push(makeTile(false)); // New 2D cells remain solid unless explicitly part of the shaft or hallway.
    }
    const allFloor=Array.from(added,keyStr=>keyStr.split(',').map(Number));
    for(const [c,r] of allFloor){
      rec.grid[r][c]=makeTile(true);rec.floorSet.add(key(c,r));rec.mapData.floor.push([c,r]);
    }
    // The octagon's exterior shell remains blocked in the flat grid; true 3D
    // per-level collision is still owned by the one shared ShaftHub grid.
    rec.cols=cols;rec.rows=rows;
    rec.mapData.cols=cols;rec.mapData.rows=rows;
    ruin.cols=cols;ruin.rows=rows;
    ruin.sanctumMapSize={cols:oldCols,rows:oldRows}; // Boss wings retain their original reserved coordinates.
    ruin.shaftSanctumDoorSite=greatDoorSite; // Public runtime exposes the same validated wall face to the sanctum composer.
    ruin.shaftHub=true;ruin.shaftWing=true;ruin.shaftHubPlan=plan;
    ruin.shaftConnection={length:route.length,corners:route.corners,physical:true,entrance,mouth,
      floorCount:plan.floorCount,totalWingsPlanned:plan.totalWings,braziersPlanned:plan.totalBraziers,
      hallwayTiles:route.tiles.length,addedFloorTiles:allFloor.length,
      straightVestibule:!!plan.options.groundEntranceSide,
      traversal:plan.options.shaftTraversal, // Mobile diagnostics and ruin movement inspect the same chosen method.
      thresholdConnected:!!plan.options.groundEntranceSide};
    const scope='dev-ruin-shaft-corridor'; // Distinct disposal scope from normal V50 floor supports.
    const corridorSupportRects=RuinShaftCorridor.rectangles(route.tiles); // Group adjacent stone into broad collision supports.
    corridorSupportRects.forEach((bounds,i)=>DS.registerSurface({id:scope+'-support-'+i,scope,
      bounds:{minX:bounds.minC,maxX:bounds.maxC+1,minZ:bounds.minR,maxZ:bounds.maxR+1},
      topY:placed.grid.baseY,priority:1}));
    ruin.shaftConnection.supportRects=corridorSupportRects.length;
    const unmountVisual=visual(route.tiles.filter(([c,r])=>!oldFloor.has(key(c,r))),THREE,rec.scene,placed.grid.baseY,rec.floorSet);
    let layerRuntime=null,nativeRuntime=null,obeliskRuntime=null,styleCleanup=null,skeeriRuntime=null; // Gameplay mechanisms and aerial enemies share the shaft session lifecycle.
    ruin.shaftConnectorCleanup=()=>{skeeriRuntime?.dispose?.();styleCleanup?.();nativeRuntime?.dispose();layerRuntime?.dispose();obeliskRuntime?.dispose();ruin.shaftObeliskRuntime=null;unmountVisual();DS.clearScope(scope);};
    const registered=ShaftHub.mount(placed,{THREE,parent:rec.scene,ClimbSurfaces,DynamicSurfaces:DS,DevRandomRuin});
    const onMechanismStateChange=()=>{root.SkeeriRuins?.signalMechanism?.();onStateChange?.();}; // Existing puzzle/obelisk completions can open nearby hidden wall hatches.
    if(placed.obelisks){
      if(!RuinReachingObelisks?.mount)throw new Error('Selected Reaching Obelisks module is not loaded.');
      obeliskRuntime=RuinReachingObelisks.mount(placed.obelisks,{
        scope:'shaft-obelisks',THREE,parent:rec.scene,DynamicSurfaces:DS,ClimbSurfaces,
        tradition:ruin.theme,getPlayerPosition,getPlayerY,projectileBus:root.DevRandomRuinSimplePuzzles,onStateChange:onMechanismStateChange,
      });
    }
    ruin.shaftObeliskRuntime=obeliskRuntime; // Height-aware fall, switch updates and mobile badge all reuse this one runtime.
    layerRuntime=RuinLayerPlayable.mount({
      rec,ruin,plan,hub:placed,makeTile,THREE,DynamicSurfaces:DS,CellGrid3D,
      RuinShaftCorridor,RuinLayerChallenges,RuinLayerDefense,DevRandomRuin,getPlayerPosition,getPlayerY,showToast,onStateChange:onMechanismStateChange
    }); // Mounts 1–4 stone puzzle wings and one interactive brazier per story-side.
    ruin.shaftLayerRuntime=layerRuntime;
    nativeRuntime=plan.nativeFloorCount?RuinV50NativeFloors.mount({
      rec,ruin,plan,hub:placed,records:nativeFloors,makeTile,THREE,
      DynamicSurfaces:DS,CellGrid3D,RuinShaftCorridor,RuinLayerChallenges,
      RuinLayerPlayable,DevRandomRuin,getPlayerPosition,getPlayerY,showToast,onStateChange:onMechanismStateChange,
      prepareMaterials,tileScale,
    }):null; // Each real upper V50 graph gets its own collision, stage gates, brazier and render root.
    ruin.nativeV50Runtime=nativeRuntime;
    try { skeeriRuntime=root.SkeeriRuins?.mount?.({rec,plan,seed,getPlayerY,difficulty:ruin.difficulty??plan.floorCount})||null; }
    catch(error) {root.__farmLog?.('[skeeri] Ruin encounter initialization failed: '+error,'warn');} // A missing optional creature asset must never invalidate an otherwise playable ruin.
    if(plan.options.groundEntranceSide)
      styleCleanup=root.RuinMultifloorV50Style?.apply?.({rec,ruin,hub:placed,seed,THREE,getPlayerY,routeTiles:route.tiles})||null;
    ruin.shaftStyleTick=styleCleanup?.tick||null; // The existing frame client keeps higher-story engravings hidden with the puzzle-wing visuals.
    const active=layerRuntime.getState();
    ruin.shaftConnection.wingsPlayable=active.wings;
    ruin.shaftConnection.braziersPlayable=active.braziers;
    ruin.shaftConnection.nativeV50Floors=nativeRuntime?.getState?.().floors||0;
    ruin.shaftConnection.nativeV50Rooms=nativeRuntime?.getState?.().rooms||0;
    // Tile occupancy was created before the old post-generation shaft phase.
    // Rebuild it against the enlarged record so the ordinary game can walk all
    // corridor tiles; this is not a separate, invisible movement harness.
    if(TileOccupancy&&ruin.occupancy){
      const walls=[];ruin.localeRoot?.traverse?.(node=>{if(node.userData?.ruinInteriorWall)walls.push(node);});
      ruin.occupancy=TileOccupancy.create({mapId:rec.mapData.id,scope:'dev-random-ruin-interior',cols:rec.cols,rows:rec.rows,
        floorSet:rec.floorSet,grid:rec.grid,solidType:makeTile(false).type,
        walls,solidRoots:[ruin.localeRoot],mechanisms:ruin.mechanisms,transitDoors:ruin.transitDoors,
        activators:ruin.activators,pushBlocks:ruin.pushBlocks,
        getPlayerPosition:typeof getPlayerPosition==='function'?getPlayerPosition:()=>({x:-1,z:-1})});
      // Reuse the existing player's position callback for occupancy and mobile input.
      // The original occupancy builder gives grounded furniture on a moving dais
      // its own precise footprint. Reconstruct it after replacing the model.
      for(const mechanism of ruin.mechanisms?.values?.()||[]){
        if(mechanism.type!=='movingDais')continue;
        const platform=mechanism.root?.userData?.movingDaisPlatform||mechanism.root;
        for(const child of platform?.children||[])
          if(child.userData?.groundedToMovingPlatform)ruin.occupancy.scanSolids?.(child,'dais-feature');
      }
    }
    return {plan,hub:placed,route,registered,layerRuntime,nativeRuntime};
  }
  return Object.freeze({entranceOutside,sanctumDoorSite,connect});
});

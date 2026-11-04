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
    const x=pad+(e.axis==='x'?Number(e.boundary):Number(e.center))*cs;
    const z=pad+(e.axis==='x'?Number(e.center):Number(e.boundary))*cs;
    if(!Number.isFinite(x)||!Number.isFinite(z))return null;
    // Half a tile outside the existing V50 doorway: players can walk straight
    // back inside, rather than being dropped at the spawn by an interaction.
    return {x:Math.floor(x+side.dx*.5),z:Math.floor(z+side.dz*.5),side:e.side};
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
    return ()=>{group.parent?.remove(group);group.traverse(node=>node.geometry?.dispose?.());floorMat.dispose();wallMat.dispose();};
  }
  function connect({rec,ruin,seed,meta,pad=2,tileScale=2,THREE,makeTile,DynamicSurfaces:DS,ShaftHub,ClimbSurfaces,DevRandomRuin,TileOccupancy,RuinLayerPlan,RuinShaftCorridor,RuinLayerPlayable,CellGrid3D,getPlayerPosition,getPlayerY}={}){
    if(!rec||!ruin||!meta||!THREE||!DS||!ShaftHub||!RuinLayerPlan||!RuinShaftCorridor||!RuinLayerPlayable||!CellGrid3D||!makeTile)
      throw new Error('Shaft connector dependencies are incomplete.');
    const spacing=64; // Snap multi-story anchors far apart; floor room networks fill the open cells.
    // Reserve enough clearance for up to five freely placed puzzle rooms in
    // every cardinal direction. The independent stories keep positive 2D map
    // coordinates while the original V50 room stays at its authored position.
    const anchorX=Math.ceil(Math.max(rec.cols+spacing,spacing*3)/spacing)*spacing;
    const anchorZ=Math.ceil(Math.max(rec.rows+spacing,spacing*3)/spacing)*spacing;
    const plan=RuinLayerPlan.compose({seed,spacing,anchorX,anchorZ,shaftSize:33,floorHeight:4});
    if(!plan.ok)throw new Error('Layer plan invalid: '+plan.checks.filter(c=>!c.ok).map(c=>c.name).join(', '));
    const portals=plan.floors.flatMap(f=>f.wings.map(w=>({floor:f.floor,side:w.side}))); // Every generated room chain now receives a separate physical doorway.
    const shaftOptions={seed,floors:plan.floorCount,chambers:false,wall:plan.options.shaftWall,
      shaft:plan.options.shaftSize,spacing:plan.options.floorHeight,entranceSide:'W',portals};
    const hub=ShaftHub.compose(shaftOptions); // The real shared room; origin is set below after determining its full masonry shell.
    const originX=anchorX-Math.floor(hub.cols/2),originZ=anchorZ-Math.floor(hub.rows/2);
    const placed=ShaftHub.compose({...shaftOptions,originX,originZ});
    if(!placed.ok)throw new Error('Octagonal shaft failed: '+placed.checks.filter(c=>!c.ok).map(c=>c.name).join(', '));
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
    const route=RuinShaftCorridor.route({start:entrance,end:mouth,width:3,existing:oldFloor,mainBounds,shaftBounds,maxX:cols,maxZ:rows});
    if(!route.ok)throw new Error('Shaft must connect physically: '+route.reason+
      ' (entry '+entrance.x+','+entrance.z+' → '+mouth.x+','+mouth.z+
      '; main cells '+oldCols+'×'+oldRows+'; blocked floors '+oldFloor.size+')');
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
    ruin.shaftHub=true;ruin.shaftWing=true;ruin.shaftHubPlan=plan;
    ruin.shaftConnection={length:route.length,corners:route.corners,physical:true,entrance,mouth,
      floorCount:plan.floorCount,totalWingsPlanned:plan.totalWings,braziersPlanned:plan.totalBraziers,
      hallwayTiles:route.tiles.length,addedFloorTiles:allFloor.length};
    const scope='dev-ruin-shaft-corridor'; // Distinct disposal scope from normal V50 floor supports.
    const corridorSupportRects=RuinShaftCorridor.rectangles(route.tiles); // Group adjacent stone into broad collision supports.
    corridorSupportRects.forEach((bounds,i)=>DS.registerSurface({id:scope+'-support-'+i,scope,
      bounds:{minX:bounds.minC,maxX:bounds.maxC+1,minZ:bounds.minR,maxZ:bounds.maxR+1},
      topY:placed.grid.baseY,priority:1}));
    ruin.shaftConnection.supportRects=corridorSupportRects.length;
    const unmountVisual=visual(route.tiles.filter(([c,r])=>!oldFloor.has(key(c,r))),THREE,rec.scene,placed.grid.baseY,rec.floorSet);
    const registered=ShaftHub.mount(placed,{THREE,parent:rec.scene,ClimbSurfaces,DynamicSurfaces:DS,DevRandomRuin});
    const layerRuntime=RuinLayerPlayable.mount({
      rec,ruin,plan,hub:placed,makeTile,THREE,DynamicSurfaces:DS,CellGrid3D,
      RuinShaftCorridor,DevRandomRuin,getPlayerPosition,getPlayerY
    }); // Mounts 1–4 stone puzzle wings and one interactive brazier per story-side.
    ruin.shaftLayerRuntime=layerRuntime;
    const active=layerRuntime.getState();
    ruin.shaftConnection.wingsPlayable=active.wings;
    ruin.shaftConnection.braziersPlayable=active.braziers;
    // Tile occupancy was created before the old post-generation shaft phase.
    // Rebuild it against the enlarged record so the ordinary game can walk all
    // corridor tiles; this is not a separate, invisible movement harness.
    if(TileOccupancy&&ruin.occupancy){
      const walls=[];ruin.localeRoot?.traverse?.(node=>{if(node.userData?.ruinInteriorWall)walls.push(node);});
      ruin.occupancy=TileOccupancy.create({mapId:rec.mapData.id,scope:'dev-random-ruin-interior',cols,rows,
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
    ruin.shaftConnectorCleanup=()=>{layerRuntime.dispose();unmountVisual();DS.clearScope(scope);};
    return {plan,hub:placed,route,registered,layerRuntime};
  }
  return Object.freeze({entranceOutside,connect});
});

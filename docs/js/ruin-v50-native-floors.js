// RuinV50NativeFloors — the exact V50 room/hallway geometry mounted on
// reserved upper stories of the shared octagonal dungeon. The generator is
// called once per upper floor BEFORE this module runs; do not duplicate its
// procedural room placement or replace it with decorative placeholder boxes.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinV50NativeFloors=api;
})(typeof self!=='undefined'?self:globalThis,function(root){
  'use strict';
  const key=(x,z)=>x+','+z,MAX_CELLS=300000;
  const nativeGridOwnership=new WeakSet(); // Frozen CellGrid3D objects cannot be tagged; owner checks are identity-based.
  const SIDES={north:[0,-1],east:[1,0],south:[0,1],west:[-1,0]};
  const RANGED=['glyphObelisk','ceilingRailTargets'];
  const STAGES=['pressurePlate','glyphObelisk','melodyEcho','dungeonFire'];

  function doorwayCells(door,scale=1,originX=0,originZ=0){
    const across=door.center*scale+(door.axis==='x'?originZ:originX); // Cell centers covered by the actual authored opening.
    const boundary=Math.floor(door.boundary*scale+(door.axis==='x'?originX:originZ));
    const half=door.widthCells*scale/2,cells=[]; // Shared by topology validation and runtime voxel gates.
    for(let n=Math.ceil(across-half-.5);n<Math.ceil(across+half-.5);n++)
      cells.push(door.axis==='x'?[boundary,n]:[n,boundary]);
    return cells;
  }
  function floorRouteExists(floorSet,from,to,blocked){
    const start=key(Math.floor(from.col+from.w/2),Math.floor(from.row+from.h/2)); // Flood the real tiles, including unrecorded contacts between rooms.
    const goal=key(Math.floor(to.col+to.w/2),Math.floor(to.row+to.h/2));
    const seen=new Set([start]),queue=[start];
    for(let i=0;i<queue.length;i++){
      if(queue[i]===goal)return true;
      const [x,z]=queue[i].split(',').map(Number);
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const next=key(x+dx,z+dz);
        if(!seen.has(next)&&floorSet.has(next)&&!blocked.has(next)){seen.add(next);queue.push(next);}
      }
    }
    return false;
  }

  function analyze(meta){
    if(!meta||!Array.isArray(meta.rooms)||!Array.isArray(meta.hallways)
      ||!Array.isArray(meta.doorways)||!Array.isArray(meta.floorCells)
      ||!meta.entrance||meta.floorCells.length===0)
      return {ok:false,reason:'Missing native V50 room, corridor, entrance or floor records'};
    const rooms=new Map(meta.rooms.map(room=>[room.id,room]));
    const start=String(meta.dungeonProgression?.entranceRoomId||'room_1');
    const goal=String(meta.dungeonProgression?.coreTreasureRoomId||'');
    if(!rooms.has(start)||!rooms.has(goal))
      return {ok:false,reason:'Native V50 dungeon progression has no entrance or treasure room'};
    const chain=[],seen=new Set();
    for(let id=goal;id&&!seen.has(id);id=rooms.get(id)?.parentRoomId){
      seen.add(id);chain.push(rooms.get(id));
      if(id===start)break;
    }
    chain.reverse();
    if(chain[0]?.id!==start||chain.length<3)
      return {ok:false,reason:'Native V50 goal path needs two challenge rooms and one final brazier room'};
    const roomGraph=new Map(meta.rooms.map(room=>[room.id,new Set()]));
    const edges=[];
    for(const hall of meta.hallways){
      const doors=meta.doorways.filter(d=>d.from===hall.id||d.to===hall.id);
      const roomDoors=doors.map(d=>({door:d,roomId:d.from===hall.id?d.to:d.from}))
        .filter(d=>rooms.has(d.roomId));
      if(roomDoors.length!==2)continue;
      roomGraph.get(roomDoors[0].roomId).add(roomDoors[1].roomId);
      roomGraph.get(roomDoors[1].roomId).add(roomDoors[0].roomId);
      edges.push({from:roomDoors[0].roomId,to:roomDoors[1].roomId,
        hall,doors:roomDoors});
    }
    const stages=chain.slice(0,Math.min(4,chain.length-1));
    const goalRoom=chain[chain.length-1]; // The brazier belongs at the actual V50 goal, even when the path exceeds the four-stage cap.
    const gates=[];
    const floorSet=new Set(meta.floorCells.map(([x,z])=>key(x,z))); // Physical connectivity can differ from V50's room graph when rectangles touch.
    for(let i=0;i<stages.length;i++){
      const current=stages[i],next=chain[i+1];
      const edge=edges.find(e=>(e.from===current.id&&e.to===next.id)
        ||(e.from===next.id&&e.to===current.id));
      const entry=edge?.doors?.find(d=>d.roomId===next.id)?.door;
      if(!entry)return {ok:false,reason:'Native V50 goal path lacks a physical hallway gate at '+current.id};
      // The door must be a genuine cut-set in the V50 room graph, not a
      // cosmetic obstacle the player can bypass down an alternate hallway.
      const visited=new Set([current.id]),queue=[current.id];
      for(let index=0;index<queue.length;index++){
        const node=queue[index];
        for(const adjacent of roomGraph.get(node)||[]){
          if(node===current.id&&adjacent===next.id||node===next.id&&adjacent===current.id)continue;
          if(!visited.has(adjacent)){visited.add(adjacent);queue.push(adjacent);}
        }
      }
      if(visited.has(next.id))return {ok:false,reason:'Native V50 hallway gate can be bypassed: '+current.id+' -> '+next.id};
      const blocked=new Set(doorwayCells(entry).map(([x,z])=>key(x,z))); // A sealed door must cut the actual walkable cells too.
      if(!blocked.size||[...blocked].some(cell=>!floorSet.has(cell))
        ||!floorRouteExists(floorSet,current,next,new Set())||floorRouteExists(floorSet,current,next,blocked))
        return {ok:false,reason:'Native V50 physical gate is disconnected or bypassable: '+current.id};
      gates.push({from:current.id,to:next.id,door:entry,hallId:edge.hall.id});
    }
    return {ok:true,start,goal,rooms:meta.rooms.length,hallways:meta.hallways.length,
      stages,goalRoom,gates,depth:chain.length-1,entrance:meta.entrance,
      gridCols:Number(meta.gridCols),gridRows:Number(meta.gridRows),
      cellSize:Number(meta.cellSize)||.5};
  }

  function nativeSeed(seed,floor,attempt=0){
    return 'dev-'+(Number(seed)>>>0).toString(36)+'-v50-floor'+floor+'-try'+attempt;
  }
  async function generateFloors({api,plan,seed,density=62,pieceSet,floorProps,records=[]}){
    if(!plan?.ok||!api?.generateInteriorLocale||!api?.takePreviewRoots)
      throw new Error('Native V50 generation requires a valid plan and generator');
    for(const floor of plan.floors.filter(item=>item.nativePort)){
      let failure=null; // Keep retries local to the failed floor; accepted snapshots belong to the caller's cleanup lifecycle.
      for(let retry=0;retry<6;retry++){
        try{
          const generated=await api.generateInteriorLocale({
            seed:nativeSeed(seed,floor.floor,retry),size:'small',density,roomMin:6,roomMax:8,
            layoutReservation:{...floor.nativePort.reservation,floor:floor.floor,y:floor.y,tileScale:2},
            puzzles:{pressurePlate:false,brazier:false,glyphObelisk:false,
              stackedObelisk:false,linkedCubePillars:false,nestedRoom:false,maxPerRoom:0},
            ...(pieceSet?{pieceSet,floorProps}:{}),
          }); // Native geometry keeps the shared stage runtime's single progression authority.
          const meta=generated.locale?.meta?.interiorShell,analysis=analyze(meta); // Validate before transferring a scene out of the iframe.
          if(!analysis.ok)throw new Error(analysis.reason);
          if(!meta.layoutReservation)throw new Error('V50 did not acknowledge its floor reservation');
          layoutPlacement(meta,floor.nativePort,2);
          api.snapMechanismState(1); // Shared stage gates own progression; V50 preview machinery stays open.
          records.push({floor:floor.floor,generated,roots:api.takePreviewRoots({snapshot:true,floor:floor.floor})});
          failure=null;break;
        }catch(error){failure=String(error?.message||error);}
      }
      if(failure)throw new Error('V50 could not generate traversable floor '+floor.floor+': '+failure);
    }
    return records;
  }
  function layoutPlacement(meta,port,tileScale=2){
    const cs=(Number(meta.cellSize)||.5)*tileScale;
    const width=Math.ceil((Number(meta.gridCols)||0)*cs),depth=Math.ceil((Number(meta.gridRows)||0)*cs);
    if(!(width>=8&&depth>=8&&width<=180&&depth<=180)||!port||port.side!=='E')
      throw new Error('Invalid native V50 layer dimensions or reserved east doorway');
    // Reserve a full clear grid slot beyond the shaft's eastern masonry, far
    // enough that north/south/west challenge wings never share this space.
    const reservation=port.reservation; // Planner-owned space: no late placement is allowed to claim another wing's footprint.
    if(!reservation||reservation.w<width||reservation.d<depth)
      throw new Error('Native V50 floor has no sufficient pre-generation reservation');
    const generatedReservation=meta.layoutReservation; // The generator and mount must agree on the exact floor allocation.
    if(generatedReservation&&(['x','z','w','d'].some(field=>generatedReservation[field]!==reservation[field])
      ||generatedReservation.floor!==port.floor||generatedReservation.y!==port.y||generatedReservation.tileScale!==tileScale))
      throw new Error('Native V50 generation and mounting reservations differ');
    const originX=reservation.x;
    const originZ=Math.max(reservation.z,Math.min(reservation.z+reservation.d-depth,
      Math.max(8,Math.floor(port.z-depth/2))));
    if(originX+width>reservation.x+reservation.w||originZ+depth>reservation.z+reservation.d)
      throw new Error('Native V50 scene escaped its reserved upper-story footprint');
    const e=meta.entrance,d=SIDES[e.side];
    if(!d)throw new Error('Native V50 has no usable exterior entrance side');
    const cx=originX+(e.axis==='x'?e.boundary:e.center)*cs;
    const cz=originZ+(e.axis==='x'?e.center:e.boundary)*cs;
    return {originX,originZ,width,depth,cs,
      outside:{x:Math.floor(cx+d[0]*.6),z:Math.floor(cz+d[1]*.6)},
      portal:{x:port.x,z:port.z}};
  }
  function nativeRoom(room,place){
    return {id:room.id,x:place.originX+room.col*place.cs,
      z:place.originZ+room.row*place.cs,w:room.w*place.cs,d:room.h*place.cs};
  }
  function cellProjection(meta,place){
    const heights=new Map(),step=Number(meta.plateauModel?.stepHeight)||.42;
    const levels=meta.plateauModel?.levelByCell||{};
    for(const [c,r] of meta.floorCells){
      const x0=place.originX+c*place.cs,z0=place.originZ+r*place.cs;
      const x1=x0+place.cs-1e-6,z1=z0+place.cs-1e-6;
      const h=(Number(meta.floorSurfaceY)||0)+(Number(levels[c+','+r])||0)*step;
      for(let x=Math.floor(x0);x<=Math.floor(x1);x++)
        for(let z=Math.floor(z0);z<=Math.floor(z1);z++)heights.set(key(x,z),h);
    }
    return heights;
  }

  function mount(options={}){
    const {ruin,rec,plan,hub,records,makeTile,getPlayerPosition,getPlayerY}=options;
    const THREE=options.THREE||root.THREE,DS=options.DynamicSurfaces||root.DynamicSurfaces;
    const CG=options.CellGrid3D||root.CellGrid3D,Corridors=options.RuinShaftCorridor||root.RuinShaftCorridor;
    const Challenges=options.RuinLayerChallenges||root.RuinLayerChallenges;
    const Dev=options.DevRandomRuin||root.DevRandomRuin;
    if(!ruin||!rec?.scene||!plan?.ok||!hub?.ok||!Array.isArray(records)
      ||!THREE?.InstancedMesh||!DS?.registerSurface||!CG?.create
      ||!Corridors?.route||!Challenges?.compose||!Dev?.registerShaftGrid)
      throw new Error('Native V50 multistory runtime dependencies are missing');
    if(records.length!==plan.nativeFloorCount)
      throw new Error('Reserved V50 floor count differs from actual generated native floors');
    const base=new THREE.Group();base.name='native-v50-multifloor';rec.scene.add(base);
    const material=root.ProceduralFurniture?.makePartMaterial?.({
      materialTexture:'carved_smooth.png',materialLighting:'unlit',
      materialFillMode:'never',color:'#777267',
    })||new THREE.MeshBasicMaterial({color:0x777267});
    const flameMaterial=new THREE.MeshBasicMaterial({color:0xffc544});
    const gateMaterial=new THREE.MeshBasicMaterial({color:0x4d3831});
    const bronzeMaterial=new THREE.MeshBasicMaterial({color:0x715e48});
    const owner={records:[],lit:0,total:records.length,disposed:false,group:base};
    const disposeMeshes=new Set(),controls=[],scopes=[]; // These are owned by native V50 floors, not the existing one-floor V50 entry.
    const views=[];
    function addControl(control){ruin.controls.push(control);controls.push(control);}
    function removeControl(control){
      const i=ruin.controls.indexOf(control);if(i>=0)ruin.controls.splice(i,1);
      const n=controls.indexOf(control);if(n>=0)controls.splice(n,1);
    }
    function primitive(parent,name,geometry,mat,x,y,z){
      const mesh=new THREE.Mesh(geometry,mat);mesh.name=name;mesh.position.set(x,y,z);
      mesh.userData.devRuinFootprintIgnore=true;parent.add(mesh);return mesh;
    }
    function setGate(stage,blocked){
      const {grid,tiles,object,surfaceY,height}=stage.gate;
      const lower=grid.yToLevel(surfaceY+.01),upper=grid.yToLevel(surfaceY+height-.01); // Cover the actual plateau doorway, not the story's nominal Y=0 slice.
      if(lower<0||upper>=grid.levels)throw new Error('Native V50 gate exceeds its height-aware voxel grid');
      for(const [x,z] of tiles){
        const col=grid.xToCol(x+.5),row=grid.zToRow(z+.5);
        grid.fillBox(col,row,lower,col,row,upper,blocked?CG.KIND.SOLID:CG.KIND.AIR);
      }
      object.visible=blocked;
    }
    function updateGoals(){
      ruin.shaftLayerRuntime?.setNativeGoalState?.(owner.total,owner.lit);
      options.onStateChange?.();
    }
    owner.dispose=()=>{
      if(owner.disposed)return;owner.disposed=true;
      const music=options.MusicMinigame||root.MusicMinigame; // Only release a flute session owned by this native ruin, never another room's performance.
      const activeId=music?.state?.echoChallenge?.id;
      if(activeId&&owner.records.some(state=>state.challenges.some(challenge=>challenge.kind==='melodyEcho'&&challenge.id===activeId)))
        music.close?.();
      for(const state of owner.records){
        for(const challenge of state.challenges)challenge.dispose?.();
        for(const object of [state.nativeRoot,state.particles]){
          const geometries=new Set(),materials=new Set();
          object?.traverse?.(child=>{
            if(child.geometry)geometries.add(child.geometry);
            for(const mat of Array.isArray(child.material)?child.material:[child.material])
              if(mat)materials.add(mat);
          });
          for(const geo of geometries)geo.dispose?.();
          for(const mat of materials)mat.dispose?.();
          object?.parent?.remove?.(object); // Do not traverse and dispose native mesh resources again with the corridor root.
        }
      }
      for(const control of [...controls])removeControl(control);
      for(const scope of scopes){DS.clearScope(scope);Dev.unregisterShaftGrid?.(scope);}
      base.parent?.remove(base);
      base.traverse?.(obj=>{if(obj.geometry)disposeMeshes.add(obj.geometry);});
      for(const geo of disposeMeshes)geo.dispose?.();
      for(const mat of [material,flameMaterial,gateMaterial,bronzeMaterial])mat.dispose?.();
    };
    try{
      for(const item of records){
        const floor=plan.floors[item.floor],port=floor?.nativePort,meta=item.generated?.locale?.meta?.interiorShell;
        const analysis=analyze(meta);
        if(!port||!analysis.ok||!item.roots?.localeRoot)
          throw new Error('Native V50 floor '+item.floor+' is not traversable: '+analysis.reason);
        const place=layoutPlacement(meta,port,options.tileScale||2);
        const heights=cellProjection(meta,place),walkable=new Set(heights.keys());
        if(!walkable.size)throw new Error('V50 floor has no traversable room/hall cells');
        const reserved=new Set(walkable);
        const customCollect=options.RuinLayerPlayable?.collect;
        for(const wing of floor.wings)for(const cell of customCollect?.(wing)||[])reserved.add(cell);
        const shaftRadius=Math.floor(hub.cols/2);
        const shaftBounds={minX:plan.shaft.anchor.x-shaftRadius,
          minZ:plan.shaft.anchor.z-shaftRadius,
          maxX:plan.shaft.anchor.x+shaftRadius+1,maxZ:plan.shaft.anchor.z+shaftRadius+1};
        const route=Corridors.route({start:port,end:place.outside,width:3,existing:reserved,shaftBounds,
          maxX:Math.max(rec.cols,place.originX+place.width+10),
          maxZ:Math.max(rec.rows,place.originZ+place.depth+10)});
        if(!route.ok)throw new Error('Cannot reach native V50 floor '+item.floor+': '+route.reason);
        const all=new Set(walkable);
        for(const [x,z] of route.tiles)all.add(key(x,z));
        const tiles=[...all].map(k=>k.split(',').map(Number));
        const xmin=Math.min(...tiles.map(v=>v[0])),xmax=Math.max(...tiles.map(v=>v[0]));
        const zmin=Math.min(...tiles.map(v=>v[1])),zmax=Math.max(...tiles.map(v=>v[1]));
        const cols=Math.max(rec.cols,xmax+3),rows=Math.max(rec.rows,zmax+3);
        if(xmin<1||zmin<1||cols*rows>MAX_CELLS)
          throw new Error('Native V50 floor exceeds the shared map allocation budget');
        for(let z=0;z<rows;z++){
          const row=rec.grid[z]||(rec.grid[z]=[]);
          while(row.length<cols)row.push(makeTile(false));
        }
        for(const k of all){
          if(rec.floorSet.has(k))continue;
          const [x,z]=k.split(',').map(Number);
          rec.grid[z][x]=makeTile(true);rec.floorSet.add(k);rec.mapData.floor.push([x,z]);
        }
        rec.cols=cols;rec.rows=rows;rec.mapData.cols=cols;rec.mapData.rows=rows;
        ruin.cols=cols;ruin.rows=rows;
        const group=new THREE.Group();group.name='native-v50-story-'+item.floor;
        base.add(group);
        const nativeRoot=item.roots.localeRoot,particles=item.roots.particleRoot;
        nativeRoot.scale.x*=options.tileScale||2;
        nativeRoot.scale.z*=options.tileScale||2;
        nativeRoot.position.set(place.originX+place.width/2,floor.y,
          place.originZ+place.depth/2);
        group.add(nativeRoot);
        if(particles)group.add(particles);
        options.prepareMaterials?.(nativeRoot); // V50's *existing* unlit stone conversion is shared with floor zero.
        let minLocalY=0,maxLocalY=0;
        for(const localY of heights.values()){
          if(!Number.isFinite(localY))throw new Error('V50 emitted an invalid native plateau height');
          minLocalY=Math.min(minLocalY,localY);maxLocalY=Math.max(maxLocalY,localY);
        }
        const gridBaseY=floor.y+Math.floor(minLocalY); // V50 plateaus may lie above OR below the story datum.
        const gridLevels=Math.max(3,Math.ceil(floor.y+maxLocalY+2.5-gridBaseY));
        if(gridLevels>12)throw new Error('Native V50 plateau exceeds the supported story collision envelope');
        const grid=CG.create({originX:xmin-1,originZ:zmin-1,
          baseY:gridBaseY,cols:xmax-xmin+3,rows:zmax-zmin+3,levels:gridLevels});
        nativeGridOwnership.add(grid); // Floor support is V50's original fractional plateau metadata.
        const border=new Set();
        for(const [x,z] of tiles){
          for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
            if(all.has(key(x+dx,z+dz)))continue;
            if(x===port.x&&z===port.z&&dx===-1&&dz===0)continue;
            border.add(key(x+dx,z+dz));
          }
        }
        for(const k of border){
          const [x,z]=k.split(',').map(Number),col=grid.xToCol(x+.5),row=grid.zToRow(z+.5);
          const adjacent=[];
          for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
            const neighbor=key(x+dx,z+dz);
            if(all.has(neighbor))adjacent.push(heights.get(neighbor)??0);
          }
          const wallBottom=floor.y+Math.min(0,...adjacent);
          const wallTop=floor.y+Math.max(0,...adjacent)+2.24;
          grid.fillBox(col,row,grid.yToLevel(wallBottom+.01),
            col,row,grid.yToLevel(wallTop-.01),CG.KIND.SOLID);
        }
        const scope='ruin-native-v50-story-'+item.floor;
        const contains=(x,z)=>x>=xmin-1&&x<=xmax+2&&z>=zmin-1&&z<=zmax+2
          &&(x>=place.originX-1&&x<=place.originX+place.width+1
            &&z>=place.originZ-1&&z<=place.originZ+place.depth+1
            ||all.has(key(Math.floor(x),Math.floor(z)))
            ||border.has(key(Math.floor(x),Math.floor(z))));
        Dev.registerShaftGrid(scope,grid,()=>{},contains); // Legacy clearRuntime calls every shaft-grid dispose() before scene teardown.
        scopes.push(scope);
        const heightGroups=new Map();
        for(const [k,localY] of heights){
          const adjusted=floor.y+localY;
          const code=adjusted.toFixed(4);
          if(!heightGroups.has(code))heightGroups.set(code,[]);
          heightGroups.get(code).push(k.split(',').map(Number));
        }
        for(const [height,cells] of heightGroups){
          for(const [i,rect] of Corridors.rectangles(cells).entries())
            DS.registerSurface({id:scope+'-v50-'+height+'-'+i,scope,priority:3,
              bounds:{minX:rect.minC,maxX:rect.maxC+1,minZ:rect.minR,maxZ:rect.maxR+1},
              topY:Number(height)});
        }
        for(const [i,rect] of Corridors.rectangles(route.tiles).entries())
          DS.registerSurface({id:scope+'-corridor-'+i,scope,priority:3,
            bounds:{minX:rect.minC,maxX:rect.maxC+1,minZ:rect.minR,maxZ:rect.maxR+1},topY:floor.y});
        const hall=new THREE.InstancedMesh(new THREE.BoxGeometry(1,.12,1),material,route.tiles.length);
        hall.name='native-v50-walkway-'+item.floor;
        const matrix=new THREE.Matrix4();
        route.tiles.forEach(([x,z],i)=>hall.setMatrixAt(i,matrix.makeTranslation(x+.5,floor.y-.06,z+.5)));
        hall.instanceMatrix.needsUpdate=true;group.add(hall);
        // The visible passage must agree with the same walkable-footprint
        // boundary used by CellGrid3D. No invisible walls, no open-sided
        // floating walkway, and no wall closing the shaft/native doorway.
        const routeX=[],routeZ=[];
        for(const [x,z] of route.tiles){
          if(!all.has(key(x-1,z))&&!(x===port.x&&z===port.z))routeZ.push([x,z+.5]);
          if(!all.has(key(x+1,z)))routeZ.push([x+1,z+.5]);
          if(!all.has(key(x,z-1)))routeX.push([x+.5,z]);
          if(!all.has(key(x,z+1)))routeX.push([x+.5,z+1]);
        }
        const wallBatch=(name,positions,geometry)=>{
          if(!positions.length)return;
          const wall=new THREE.InstancedMesh(geometry,material,positions.length);
          wall.name=name;
          positions.forEach(([x,z],i)=>wall.setMatrixAt(i,matrix.makeTranslation(x,floor.y+1.12,z)));
          wall.instanceMatrix.needsUpdate=true;
          group.add(wall);
        };
        wallBatch('native-v50-corridor-north-south-'+item.floor,
          routeX,new THREE.BoxGeometry(1,2.24,.12));
        wallBatch('native-v50-corridor-east-west-'+item.floor,
          routeZ,new THREE.BoxGeometry(.12,2.24,1));
        const record={floor:item.floor,group,nativeRoot,particles,analysis,place,grid,
          route,routeWallSegments:routeX.length+routeZ.length,
          solved:0,challenges:[],lit:false,goalBrazier:null};
        owner.records.push(record);
        const kinds=STAGES; // Native V50 generated the real room graph; current shared puzzle runtime supplies stage goals.
        for(let i=0;i<analysis.stages.length;i++){
          const native=analysis.stages[i],world=nativeRoom(native,place);
          const kind=i===0?'pressurePlate':i===1?RANGED[item.floor%RANGED.length]
            :kinds[(i+item.floor)%kinds.length];
          const challengeY=floor.y+(heights.get(key(Math.floor(world.x+world.w/2),Math.floor(world.z+world.d/2)))||0); // Match the actual V50 surface under the puzzle.
          let challenge=null;
          challenge=Challenges.compose({
            THREE,parent:group,room:world,id:'v50-f'+item.floor+'-'+native.id,kind,y:challengeY,
            isActive:()=>!owner.disposed&&record.solved===i,
            getPlayerPosition,getPlayerY,
            addControl,removeControl,
            onLink:options.onStateChange,onError:options.onError,
            onSolved:()=>{
              if(owner.disposed||record.solved!==i)return;
              record.solved++;setGate(challenge,false);
              options.showToast?.('The native chamber gate opens.',true);options.onStateChange?.();
            },
          });
          challenge.x=world.x+world.w/2;challenge.z=world.z+world.d/2;
          challenge.floorY=challengeY; // Shared stage diagnostics and native pressure-plate tests use exact V50 room centers.
          const door=analysis.gates[i].door,span=Math.max(2,(Number(door.widthCells)||3)*place.cs);
          const x=place.originX+(door.axis==='x'?door.boundary:door.center)*place.cs;
          const z=place.originZ+(door.axis==='x'?door.center:door.boundary)*place.cs;
          const tiles=doorwayCells(door,place.cs,place.originX,place.originZ); // Exactly the cells validated against the real V50 floor network.
          const doorHeights=tiles.map(([gx,gz])=>heights.get(key(gx,gz)));
          if(!tiles.length||doorHeights.some(value=>!Number.isFinite(value)))
            throw new Error('Native V50 gate does not span actual supported hallway cells: '+native.id);
          const lowerY=Math.min(...doorHeights),upperY=Math.max(...doorHeights);
          const surfaceY=floor.y+lowerY,gateHeight=2.35+upperY-lowerY; // The bottom and top of the mesh cover uneven plateau thresholds without a gap.
          const object=primitive(group,'v50-native-gate-'+item.floor+'-'+i,
            new THREE.BoxGeometry(door.axis==='x'?.8:span,gateHeight,door.axis==='x'?span:.8),
            gateMaterial,x,surfaceY+gateHeight/2,z);
          challenge.gate={tiles,object,grid,surfaceY,height:gateHeight};
          setGate(challenge,true);
          record.challenges.push(challenge);
        }
        const goal=nativeRoom(analysis.goalRoom,place);
        const cx=goal.x+goal.w/2,cz=goal.z+goal.d/2;
        const goalY=floor.y+(heights.get(key(Math.floor(cx),Math.floor(cz)))||0); // Brazier interactions follow the same support surface as their geometry.
        const pedestal=primitive(group,'v50-native-brazier-'+item.floor,
          new THREE.CylinderGeometry(.65,.82,.7,8),bronzeMaterial,cx,goalY+.38,cz);
        const flame=primitive(group,'v50-native-brazier-flame-'+item.floor,
          new THREE.ConeGeometry(.42,1.25,7),flameMaterial,cx,goalY+1.22,cz);
        flame.visible=false;record.goalBrazier={pedestal,flame};
        addControl({kind:'v50NativeBrazier',object:pedestal,promptRoot:pedestal,
          floorY:goalY,range:1.7,priority:20,touchIcon:'🔥',
          label:()=>record.lit?'Brazier Burning':'Ignite Native Wing Brazier',
          onPress:()=>{
            if(owner.disposed||record.lit||!Number.isFinite(Number(getPlayerY?.()))||Math.abs(Number(getPlayerY())-goalY)>.8)return;
            if(record.solved!==record.challenges.length){
              options.showToast?.('Complete the V50 chambers first.',false);return;
            }
            record.lit=true;flame.visible=true;owner.lit++;
            updateGoals();
            options.showToast?.('Native V50 floor brazier ignited.',true);
          }
        });
        views.push({floor:item.floor,root:group});
      }
      updateGoals();
    }catch(error){owner.dispose();throw error;}
    owner.tick=dt=>{
      if(owner.disposed)return;
      const y=Number(getPlayerY?.());
      if(!Number.isFinite(y))return;
      for(const {floor,root:group} of views)
        group.visible=plan.floors[floor].y<=y+.8;
      for(const record of owner.records){
        record.challenges[record.solved]?.tick?.(dt);
        for(let i=0;i<record.solved;i++)record.challenges[i]?.animate?.(dt);
      }
    };
    owner.getState=()=>({
      floors:owner.records.length,rooms:owner.records.reduce((n,r)=>n+r.analysis.rooms,0),
      hallways:owner.records.reduce((n,r)=>n+r.analysis.hallways,0),
      totalBraziers:owner.total,lit:owner.lit,
      stagesSolved:owner.records.reduce((n,r)=>n+r.solved,0),
      stagesTotal:owner.records.reduce((n,r)=>n+r.challenges.length,0),
      perFloor:owner.records.map(r=>({
        floor:r.floor,rooms:r.analysis.rooms,hallways:r.analysis.hallways,
        stages:r.challenges.length,solved:r.solved,lit:r.lit,routeLength:r.route.length,
        routeWallSegments:r.routeWallSegments,
        allocation:r.place.width+'×'+r.place.depth+' / 180×180',
        reservationVerified:!!records.find(item=>item.floor===r.floor)?.generated?.locale?.meta?.interiorShell?.layoutReservation,
      })),
    });
    return owner;
  }
  return Object.freeze({analyze,doorwayCells,nativeSeed,generateFloors,layoutPlacement,nativeRoom,cellProjection,mount,isNativeGrid:grid=>nativeGridOwnership.has(grid)});
});

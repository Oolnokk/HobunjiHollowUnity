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
  function rectangleTiles(r,add){
    for(let z=r.z;z<r.z+r.d;z++)for(let x=r.x;x<r.x+r.w;x++)add(x,z);
  }
  function collect(wing){
    const tiles=new Set(); // Full physical footprint of this one wing, used by collision, floors and wall edges.
    const add=(x,z)=>tiles.add(key(x,z));
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
  function mount(options={}){
    const {rec,ruin,plan,hub,makeTile,getPlayerPosition,getPlayerY}=options;
    const THREE=options.THREE||root.THREE,DS=options.DynamicSurfaces||root.DynamicSurfaces;
    const CG=options.CellGrid3D||root.CellGrid3D,DevRandomRuin=options.DevRandomRuin||root.DevRandomRuin;
    const Corridors=options.RuinShaftCorridor||root.RuinShaftCorridor;
    if(!rec?.scene||!ruin||!plan?.ok||!hub?.ok||!THREE?.InstancedMesh
      ||!DS?.registerSurface||!CG?.create||!Corridors?.rectangles
      ||typeof makeTile!=='function'||typeof getPlayerPosition!=='function')
      throw new Error('Ruin layer physical runtime dependencies are missing.');
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
    const plateMat=new THREE.MeshBasicMaterial({color:0x8c735b});
    const gateMat=new THREE.MeshBasicMaterial({color:0x4f3b32});
    const brazierMat=new THREE.MeshBasicMaterial({color:0x665346});
    const flameMat=new THREE.MeshBasicMaterial({color:0xffb92a});
    const materials=[material,plateMat,gateMat,brazierMat,flameMat]; // Disposed together with the geometry and owned interactive controls.
    const states=[],gridScopes=[],added=new Set(),surfaces=[]; // Runtime gate/puzzle records, registered voxel scopes, map floor keys and terrain rectangles.
    const floorRoots=new Map(); // Each story owns a presentation group so overhead floors do not conceal the player below.
    let activeRoot=group; // Mesh batching writes into the currently composed story's subscene.
    const owner={group,states,disposed:false,complete:false,lit:0,total:plan.totalBraziers,geometryCount:0}; // Exposed to mobile diagnostics.
    owner.dispose=()=>{
      if(owner.disposed)return;owner.disposed=true;
      for(const scopeId of gridScopes)DevRandomRuin?.unregisterShaftGrid?.(scopeId);
      DS.clearScope(scope);group.parent?.remove(group);
      const geometries=new Set();
      group.traverse(node=>{if(node.geometry)geometries.add(node.geometry);});
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
    }
    function setGate(record,blocked){
      if(!record?.gate)return;
      for(const [x,z] of record.gate.tiles){
        const c=record.grid.xToCol(x+.5),r=record.grid.zToRow(z+.5);
        record.grid.set(c,r,0,blocked?CG.KIND.SOLID:CG.KIND.AIR);
        record.grid.set(c,r,1,blocked?CG.KIND.SOLID:CG.KIND.AIR);
        // Never stamp a gate into the shared 2D rec.grid: another story
        // can have a perfectly open room at the same X/Z. Only this wing's
        // height-specific voxel grid owns the door's collision.
      }
      record.gate.object.visible=blocked;

    }
    try{
      for(const floor of plan.floors)for(const wing of floor.wings){
        if(!floorRoots.has(floor.floor)){
          const rootGroup=new THREE.Group(); // Per-story scene root used to occlude floors above current player elevation.
          rootGroup.name='ruin-layer-floor-'+floor.floor;
          floorRoots.set(floor.floor,rootGroup);group.add(rootGroup);
        }
        activeRoot=floorRoots.get(floor.floor);
        const tiles=collect(wing),walkCells=[...tiles].map(k=>k.split(',').map(Number)); // Each stage is reachable on its own 2D level.
        const localBounds=walkCells.reduce((a,[x,z])=>({
          minX:Math.min(a.minX,x),maxX:Math.max(a.maxX,x),minZ:Math.min(a.minZ,z),maxZ:Math.max(a.maxZ,z)
        }),{minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity});
        const grid=CG.create({originX:localBounds.minX-1,originZ:localBounds.minZ-1,baseY:floor.y,
          cols:localBounds.maxX-localBounds.minX+3,rows:localBounds.maxZ-localBounds.minZ+3,levels:3});
        const side=SIDES[wing.side],entryKey=key(wing.entry.x,wing.entry.z);
        // A thin voxel boundary matches the actually drawn stone walls.
        // Filling the entire room's rectangular allocation with SOLID created
        // enormous INVISIBLE walls/roofs that swallowed projectiles passing
        // through perfectly open gaps beside winding corridors.
        const border=new Set(); // Outside neighbors of real walkable cells, never whole empty rectangle.
        for(const [x,z] of walkCells){
          added.add(key(x,z));
          for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
            if(tiles.has(key(x+dx,z+dz)))continue;
            if(key(x,z)===entryKey&&dx===-side.dx&&dz===-side.dz)continue; // Open the direct shaft-to-wing portal.
            border.add(key(x+dx,z+dz));
          }
        }
        for(const next of border){
          const [x,z]=next.split(',').map(Number),c=grid.xToCol(x+.5),r=grid.zToRow(z+.5);
          grid.fillBox(c,r,0,c,r,1,CG.KIND.SOLID); // Exactly two wall cells tall; no invisible ceiling.
        }
        // The wing portal shares the shaft's outward threshold on the proper story; avoid closing its inward face.
        const wallsX=[],wallsZ=[];
        for(const [x,z] of walkCells){
          if(!tiles.has(key(x-1,z))&&!(key(x,z)===entryKey&&side.dx===1))wallsZ.push([x,z+.5]);
          if(!tiles.has(key(x+1,z))&&!(key(x,z)===entryKey&&side.dx===-1))wallsZ.push([x+1,z+.5]);
          if(!tiles.has(key(x,z-1))&&!(key(x,z)===entryKey&&side.dz===1))wallsX.push([x+.5,z]);
          if(!tiles.has(key(x,z+1))&&!(key(x,z)===entryKey&&side.dz===-1))wallsX.push([x+.5,z+1]);
        }
        const wingName='floor'+floor.floor+'-'+wing.side;
        instance(wingName+'-floor',new THREE.BoxGeometry(1,.12,1),walkCells,material,([x,z])=>({x:x+.5,y:floor.y-.06,z:z+.5}));
        instance(wingName+'-wall-ns',new THREE.BoxGeometry(1,2.3,.14),wallsX,material,([x,z])=>({x,y:floor.y+1.15,z}));
        instance(wingName+'-wall-ew',new THREE.BoxGeometry(.14,2.3,1),wallsZ,material,([x,z])=>({x,y:floor.y+1.15,z}));
        const rectangles=Corridors.rectangles(walkCells);
        rectangles.forEach((r,i)=>{
          const spec={id:scope+'-'+wing.id+'-'+i,scope,priority:1,
            bounds:{minX:r.minC,maxX:r.maxC+1,minZ:r.minR,maxZ:r.maxR+1},topY:floor.y};
          DS.registerSurface(spec);surfaces.push(spec);
        });
        const gridScope=scope+'-'+wing.id;gridScopes.push(gridScope);
        const occupied=(x,z)=>tiles.has(key(Math.floor(x),Math.floor(z))); // Avoid selecting the wing's empty rectangular allocation when other floors overlap X/Z.
        DevRandomRuin?.registerShaftGrid?.(gridScope,grid,()=>owner.dispose(),occupied);
        const record={wingId:wing.id,floor:floor.floor,side:wing.side,grid,solved:0,
          challenges:[],braziers:[],walkable:walkCells.length}; // One physical wing with ordered challenge→goal activation.
        states.push(record);
        for(let i=0;i<wing.rooms.length-1;i++){
          const room=wing.rooms[i];
          const cx=room.x+room.w/2,cz=room.z+room.d/2;
          const plate=mesh('ruin-challenge-plate-'+room.id,
            new THREE.BoxGeometry(2.2,.18,2.2),plateMat,cx,floor.y+.04,cz);
          const challenge={id:room.id,x:cx,z:cz,floorY:floor.y,plate,elapsed:0,solved:false,gate:null};
          const next=wing.corridors[i+1];
          if(next){
            const {dx,dz}=side,cx=next.end.x,cz=next.end.z;
            const gateTiles=Array.from({length:3},(_,j)=>[cx+(dz*(j-1)),cz+(dx*(j-1))]);
            if(!gateTiles.every(([x,z])=>tiles.has(key(x,z))))
              throw new Error('Challenge gate cannot span its entire hallway: '+room.id);
            const gate=mesh('ruin-challenge-gate-'+room.id,
              new THREE.BoxGeometry(dx?1.1:3,2.4,dz?1.1:3),gateMat,cx+.5,floor.y+1.2,cz+.5);
            challenge.gate={tiles:gateTiles,object:gate};
            challenge.grid=grid;setGate(challenge,true);
          }
          record.challenges.push(challenge);
        }
        const goal=wing.rooms[wing.rooms.length-1],bx=goal.x+goal.w/2,bz=goal.z+goal.d/2;
        const pedestal=mesh('ruin-brazier-'+wing.id,new THREE.CylinderGeometry(.7,.85,.65,8),
          brazierMat,bx,floor.y+.38,bz);
        const flame=mesh('ruin-brazier-flame-'+wing.id,new THREE.ConeGeometry(.43,1.3,7),
          flameMat,bx,floor.y+1.27,bz);flame.visible=false;
        const brazier={id:wing.goalBrazierId,wingId:wing.id,lit:false,flame,pedestal};
        record.braziers.push(brazier);
        ruin.controls.push({
          kind:'layerBrazier',object:pedestal,promptRoot:pedestal,floorY:floor.y,range:1.7,
          priority:20,touchIcon:'🔥',label:()=>brazier.lit?'Brazier Burning':'Ignite Wing Brazier',
          onPress:()=>{
            if(brazier.lit||Math.abs(Number(getPlayerY?.())-floor.y)>.8)return; // A brazier on floor 4 cannot be lit through the deck from a lower floor.
            if(record.solved<record.challenges.length){options.showToast?.('Complete the wing challenges first.',false);return;}
            brazier.lit=true;flame.visible=true;owner.lit++;
            owner.complete=owner.lit===owner.total;
            ruin.shaftNetworkComplete=owner.complete;
            options.showToast?.(owner.complete?'All shaft braziers are lit.':'Wing brazier ignited.',true);
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
    owner.tick=(dt)=>{
      if(owner.disposed)return;
      const player=getPlayerPosition(),y=Number(getPlayerY?.()); // Actor feet elevation disambiguates vertically overlapping room coordinates.
      if(!player||!Number.isFinite(y))return;
      // When on the ground floor, an upper floor's stone deck would otherwise
      // be drawn over the player by the overhead third-person camera. Keep
      // physical collision/supports active; hide ONLY the upper story meshes.
      for(const [floor,rootGroup] of floorRoots)rootGroup.visible=floor*plan.options.floorHeight<=y+.8;
      for(const record of states){
        const challenge=record.challenges[record.solved];
        if(!challenge)continue;
        if(Math.abs(y-challenge.floorY)>.75||Math.hypot(player.x-challenge.x,player.z-challenge.z)>1.15){
          challenge.elapsed=0;continue;
        }
        challenge.elapsed+=Math.min(.05,Math.max(0,dt));
        if(challenge.elapsed<.8)continue;
        challenge.solved=true;record.solved++;
        challenge.plate.material=flameMat;
        setGate(challenge,false);
        options.showToast?.('A stone gate opens.',true);
        options.onStateChange?.();
      }
    };
    owner.getState=()=>({floors:plan.floorCount,wings:states.length,braziers:owner.total,lit:owner.lit,
      complete:owner.complete,rooms:states.reduce((n,r)=>n+r.challenges.length+1,0),
      challengesSolved:states.reduce((n,r)=>n+r.solved,0),
      challengesTotal:states.reduce((n,r)=>n+r.challenges.length,0),
      perFloor:plan.floors.map(f=>({floor:f.floor,y:f.y,wings:states.filter(r=>r.floor===f.floor).map(r=>({
        side:r.side,solved:r.solved,total:r.challenges.length,lit:r.braziers[0]?.lit===true
      }))}))});

    return owner;
  }
  return Object.freeze({mount,projectedExtent,collect,selectGrid});
});

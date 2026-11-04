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
      const node=new THREE.Mesh(geometry,mat);node.name=name;node.position.set(x,y,z);group.add(node);return node;
    }
    function instance(name,geometry,cells,mat,where){
      if(!cells.length)return;
      const object=new THREE.InstancedMesh(geometry,mat,cells.length);
      object.name=name;
      const matrix=new THREE.Matrix4(); // Reused for this batch instead of allocating a Matrix4 per floor tile.
      cells.forEach((cell,i)=>{const p=where(cell);object.setMatrixAt(i,matrix.makeTranslation(p.x,p.y,p.z));});
      object.instanceMatrix.needsUpdate=true;group.add(object);owner.geometryCount++;
    }
    function setGate(record,blocked){
      if(!record?.gate)return;
      for(const [x,z] of record.gate.tiles){
        const c=record.grid.xToCol(x+.5),r=record.grid.zToRow(z+.5);
        record.grid.set(c,r,0,blocked?CG.KIND.SOLID:CG.KIND.AIR);
        record.grid.set(c,r,1,blocked?CG.KIND.SOLID:CG.KIND.AIR);
        if(rec.grid[z]?.[x])rec.grid[z][x]=makeTile(!blocked);
      }
      record.gate.object.visible=blocked;
      ruin.occupancy?.refresh?.();
    }
    try{
      for(const floor of plan.floors)for(const wing of floor.wings){
        const tiles=collect(wing),walkCells=[...tiles].map(k=>k.split(',').map(Number)); // Each stage is reachable on its own 2D level.
        const localBounds=walkCells.reduce((a,[x,z])=>({
          minX:Math.min(a.minX,x),maxX:Math.max(a.maxX,x),minZ:Math.min(a.minZ,z),maxZ:Math.max(a.maxZ,z)
        }),{minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity});
        const grid=CG.create({originX:localBounds.minX-1,originZ:localBounds.minZ-1,baseY:floor.y,
          cols:localBounds.maxX-localBounds.minX+3,rows:localBounds.maxZ-localBounds.minZ+3,levels:3});
        grid.fillBox(0,0,0,grid.cols-1,grid.rows-1,2,CG.KIND.SOLID); // Side walls and top stop 2D actors walking through the void.
        for(const [x,z] of walkCells){
          grid.fillBox(grid.xToCol(x+.5),grid.zToRow(z+.5),0,
            grid.xToCol(x+.5),grid.zToRow(z+.5),1,CG.KIND.AIR);
          added.add(key(x,z));
        }
        // The portal tile overlaps the real shaft grid. Its inward face is
        // intentionally open; all other unoccupied room edges form actual walls.
        const side=SIDES[wing.side],entryKey=key(wing.entry.x,wing.entry.z);
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
        DevRandomRuin?.registerShaftGrid?.(gridScope,grid,()=>owner.dispose());
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
      // Opening the flat occupancy grid is a separate operation from filling
      // the elevation-aware voxel slices. Reapply authored puzzle gates after
      // all room tiles have been mapped into rec.grid.
      for(const record of states)for(const challenge of record.challenges)
        if(challenge.gate)setGate(challenge,true);
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
  return Object.freeze({mount,projectedExtent,collect});
});

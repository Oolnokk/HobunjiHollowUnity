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
    const plateMat=tintedStone('#8c735b',0x8c735b);
    const gateMat=tintedStone('#4f3b32',0x4f3b32);
    const brazierMat=tintedStone('#665346',0x665346);
    const materials=[material,plateMat,gateMat,brazierMat]; // Disposed together with the geometry and owned interactive controls.
    const wingFlameVisuals=[]; // Owns the player's campfire particle emitters for every ignited wing brazier.
    const roomLights=[]; // One light per puzzle room (and, outside Kanthic, each goal room): a room fills with light when its puzzle is solved.
    const brazierLights=[]; // Kanthic-only completed-wing flames feed the shared darkness overlay without adding real Three.js lights.
    const states=[],gridScopes=[],added=new Set(),surfaces=[]; // Runtime gate/puzzle records, registered voxel scopes, map floor keys and terrain rectangles.
    const ownedControls=new Set(); // Every wing brazier, fire-source and authored puzzle control is released on reroll or failed setup.
    function addControl(control){ruin.controls.push(control);ownedControls.add(control);}
    function removeControl(control){
      const i=ruin.controls.indexOf(control);if(i>=0)ruin.controls.splice(i,1);
      ownedControls.delete(control);
    }
    const floorRoots=new Map(); // Each story owns a presentation group so overhead floors do not conceal the player below.
    let activeRoot=group; // Mesh batching writes into the currently composed story's subscene.
    const owner={group,states,disposed:false,complete:false,lit:0,total:plan.totalBraziers,
      nativeTotal:plan.nativeFloorCount||0,nativeLit:0,geometryCount:0}; // The Great Door requires BOTH composed wings and real V50 floor braziers. // Exposed to mobile diagnostics.
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
      if(owner.disposed)return;owner.disposed=true;
      for(const state of states)for(const challenge of state.challenges)challenge.dispose?.();
      for(const flame of wingFlameVisuals)flame.dispose?.(); // No stale authored GPU particles after a dungeon reroll.
      for(const control of [...ownedControls])removeControl(control);
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
    // A wing's stone as real faces (js/ruin-wall-faces.js) instead of one-unit instanced boxes: the floor merges into
    // big rectangles and each wall line into runs, all cut into stretch-to-fit patches of at most 6 units. The few
    // longest runs of each wing are feature walls, one mesh each in a flagged group the style pass engraves (one
    // engraving atlas per mesh, so each must be a connected wall, and the count is capped to bound GPU memory). Atlases
    // are capped at 512 px, so a long corridor wall is cut into pieces of at most WING_FEATURE_MAX units first: one
    // engraving over 86 units would get a few pixels per unit and read as mush.
    const WING_FEATURE_RUN=4,WING_FEATURE_MAX=10,WING_FEATURES_PER_WING=4,WALL_HEIGHT=2.3,WALL_THICKNESS=.14,PATCH={h:6,v:6};
    function masonry(wingName,y,floorCells,wallsX,wallsZ){
      const Faces=root.RuinWallFaces;
      const add=(name,data,parent=activeRoot)=>{
        if(!data.positions.length)return null;
        const node=new THREE.Mesh(Faces.toGeometry(THREE,data),material);node.name=name;parent.add(node);owner.geometryCount++;return node;
      };
      if(floorCells.length){
        let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;
        for(const [x,z] of floorCells){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
        const w=maxX-minX+1,h=maxZ-minZ+1,mask=new Uint8Array(w*h);
        for(const [x,z] of floorCells)mask[(z-minZ)*w+(x-minX)]=1;
        const rects=Faces.mergeMask(mask,w,h).map(r=>({axis:'y',side:1,plane:0,a0:r.i0,a1:r.i1,b0:r.j0,b1:r.j1}));
        add(wingName+'-floor',Faces.buildQuads(rects,{origin:{x:minX,y,z:minZ},size:{x:1,y:1,z:1},patch:PATCH}));
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
        for(const run of features)add('wing-feature-wall',Faces.buildEdgeWallQuads([run],wallOptions),group);
      }
      add(wingName+'-walls',Faces.buildEdgeWallQuads(pieces.filter(piece=>!featured.has(piece)),wallOptions));
    }
    function setGate(record,blocked,silent=false){
      if(!record?.gate)return;
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
          // The third entry is the way the wall faces: toward the walkable cell that owns it.
          if(!tiles.has(key(x-1,z))&&!(key(x,z)===entryKey&&side.dx===1))wallsZ.push([x,z+.5,1]);
          if(!tiles.has(key(x+1,z))&&!(key(x,z)===entryKey&&side.dx===-1))wallsZ.push([x+1,z+.5,-1]);
          if(!tiles.has(key(x,z-1))&&!(key(x,z)===entryKey&&side.dz===1))wallsX.push([x+.5,z,1]);
          if(!tiles.has(key(x,z+1))&&!(key(x,z)===entryKey&&side.dz===-1))wallsX.push([x+.5,z+1,-1]);
        }
        const wingName='floor'+floor.floor+'-'+wing.side;
        if(root.RuinWallFaces)masonry(wingName,floor.y,supportedCells,wallsX,wallsZ);
        else{ // Loaded without the face mesher: the original one-unit boxes.
          instance(wingName+'-floor',new THREE.BoxGeometry(1,.12,1),supportedCells,material,([x,z])=>({x:x+.5,y:floor.y-.06,z:z+.5}));
          instance(wingName+'-wall-ns',new THREE.BoxGeometry(1,2.3,.14),wallsX,material,([x,z])=>({x,y:floor.y+1.15,z}));
          instance(wingName+'-wall-ew',new THREE.BoxGeometry(.14,2.3,1),wallsZ,material,([x,z])=>({x,y:floor.y+1.15,z}));
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
          const roomLight={x:cx,y:floor.y+1.4,z:cz,floorY:floor.y,floorTolerance:3,radius:Math.max(room.w,room.d)*.7+2,strength:.92,color:roomRgb,active:false};
          roomLights.push(roomLight);
          let gateLight=null; // Lights the doorway the solve is about to open (assigned below once the gate is known).
          let challenge=null; // Created by the shared mechanism runtime; its onSolved opens this chamber's real next gate.
          challenge=Challenges.compose({
            THREE,parent:activeRoot,room,y:floor.y,id:room.id,kind:room.challenge,side:wing.side,
            theme:ruin.theme||null,
            RuinLayerDefense:Defense,mapId:String(rec.mapData?.id||'map_i_dev_random_ruin'),
            isActive:()=>record.solved===i&&!owner.disposed
              &&(room.challenge!=='findBlocks'||Math.abs(Number(getPlayerY?.())-floor.y)<4.5), // Stacked block barriers must not project onto a lower floor.
            getPlayerPosition,getPlayerY,
            addControl,removeControl,
            showToast:options.showToast, // One shared resolver owns these controls, and this network owns their cleanup.
            onFireArmed:()=>options.showToast?.('The next projectile ignites.',true),
            onFireUnavailable:()=>options.showToast?.('Equip a ranged weapon to ignite the next shot.',false),
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
            const {dx,dz}=side,cx=next.end.x,cz=next.end.z;
            const gateTiles=Array.from({length:3},(_,j)=>[cx+(dz*(j-1)),cz+(dx*(j-1))]);
            if(!gateTiles.every(([x,z])=>tiles.has(key(x,z))))
              throw new Error('Challenge gate cannot span its entire hallway: '+room.id);
            const authoredGate=root.DevRandomRuinFurniturePieces?.buildPassageGate?.({ // Carved door with one seal; the plain box below is only the fallback until its JSON has loaded.
              span:3,height:2.4,normalAxis:dx?'x':'z',parent:activeRoot,name:'ruin-challenge-gate-'+room.id,
              position:{x:cx+.5,y:floor.y,z:cz+.5}});
            const gate=authoredGate?authoredGate.object:mesh('ruin-challenge-gate-'+room.id,
              new THREE.BoxGeometry(dx?1.1:3,2.4,dz?1.1:3),gateMat,cx+.5,floor.y+1.2,cz+.5);
            challenge.gate={tiles:gateTiles,object:gate};
            gateLight={x:cx+.5,y:floor.y+1.4,z:cz+.5,floorY:floor.y,floorTolerance:3,radius:5.5,strength:.95,color:roomRgb,active:false};
            roomLights.push(gateLight);
            challenge.grid=grid;setGate(challenge,true);
          }
          record.challenges.push(challenge);
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
          wingFlameVisuals.push({update:dt=>lichBrazier.update(dt),dispose:()=>lichBrazier.fire.emitter?.dispose?.()}); // Flicker + particles each tick; emitter freed on reroll.
        }else{
          pedestal=mesh('ruin-brazier-'+wing.id,new THREE.CylinderGeometry(.7,.85,.65,8),brazierMat,bx,floor.y+.38,bz);
          flame=new THREE.Group(); // Particle anchor replaces the opaque cone; visible only after this brazier is lit.
          flame.name='ruin-brazier-flame-'+wing.id;
          flame.position.set(bx,floor.y+1.27,bz);flame.visible=false;activeRoot.add(flame);
          const flameVisual=root.PersistentGroundFire?.attachCampfireFlame?.(flame,{scale:1.1,rateScale:.95});
          if(flameVisual)wingFlameVisuals.push(flameVisual); // Uses the exact player-placeable campfire emitter recipe.
        }
        const lichRgb=[1,3,5].map(i=>parseInt(String(lichColor).slice(i,i+2),16));
        const goalLight=ruin.theme==='kanthic'?null:{x:bx,y:floor.y+1.4,z:bz,floorY:floor.y,floorTolerance:3,radius:Math.max(goal.w,goal.d)*.7+2,strength:.92,color:lichRgbWashed(lichColor),active:false}; // Kanthic's goal room is already lit by its brazier record below.
        if(goalLight)roomLights.push(goalLight);
        const brazierLight={x:bx,y:floor.y+1.4,z:bz,floorY:floor.y,radius:10,strength:.98,
          color:lichRgb.every(Number.isFinite)?lichRgb:[255,139,61],active:false}; // A solved Kanthic wing brightens its chamber in its lich's colour; other lich themes keep their original atmosphere.
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
    owner.tick=(dt)=>{
      if(owner.disposed)return;
      const player=getPlayerPosition(),y=Number(getPlayerY?.()); // Actor feet elevation disambiguates vertically overlapping room coordinates.
      if(!player||!Number.isFinite(y))return;
      // When on the ground floor, an upper floor's stone deck would otherwise
      // be drawn over the player by the overhead third-person camera. Keep
      // physical collision/supports active; hide ONLY the upper story meshes.
      for(const [floor,rootGroup] of floorRoots)rootGroup.visible=floor*plan.options.floorHeight<=y+.8;
      for(const flame of wingFlameVisuals)flame.update?.(Math.max(0,Math.min(.05,dt))); // Particle lifecycle is owned by the ruin's existing tick.
      for(const record of states){
        record.challenges[record.solved]?.tick?.(dt); // Only the current room consumes inputs, notes and target hooks.
        for(let i=0;i<record.solved;i++)
          record.challenges[i]?.animate?.(dt); // Already-cleared ice may still shrink; no inactive puzzle logic runs.
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
      projectileTargetsLinked:states.reduce((n,r)=>n+r.challenges.filter(c=>c.linked).length,0),
      floorlessCells:states.reduce((n,r)=>n+r.voidCells,0),
      ropeChainsLinked:states.reduce((n,r)=>n+r.challenges.filter(c=>c.ropeLinked).length,0),
      defenseRoomsReady:states.reduce((n,r)=>n+r.challenges.filter(c=>c.kind==='statueDefense'&&c.ready).length,0),
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

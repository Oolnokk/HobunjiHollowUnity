// Cavern ore rocks — extracted from game.js's loadBuildingScene cavern branch.
// Marks each mapData.oreRocks tile as diggable, with original metal-bodied
// patina coloration identical to the town mine, registered in the same mesh table
// the outdoor ore rocks use (mineableRocksByTile/isMineableRockTile/
// removeZoneMineableRockVisual), so mining a cavern rock needs no new code.
// Den caverns and every cave-site history (js/cave-site-system.js — ore
// mines, the mineable chamber separator) go through this one builder.
(() => {
  'use strict';

  const CAVERN_ORE_TINTS = { stone: 0x8a8680, copper: 0xb87333, tinCopper: 0xb66a2e, mushistonite: 0xcd7f32, tin: 0xc8ccd0, lead: 0x6d7375, arsenic: 0xaaa58f, silver: 0xc4c8ce, gold: 0xd8b23a }; // Legacy/debug swatches show metal-bodied rock base hues; materialFor adds separate verdigris markings.


  const rockMaps = new Map(); // Per-cave tile -> logical mineable rock group; removing a tile keeps the existing pickaxe/blast contract.
  const rockScenes = new Map(); // Per-cave scene owner for Sense Mode, so stale caves cannot leak highlights.
  const separatorWalls = new Map(); // Per-cave fused mesh, still-live diggable tiles and permanent carved puzzle-door openings.
  const pendingRebuilds = new Set(); // Batched Shattercask/restore tile removals re-mesh the wall only once per explosion or scene load.
  let batchDepth = 0; // A nested blast or state restore can safely reuse the same batching API.
  const ROCK_SAMPLE_STEP = 0.25; // World units per sculpting sample; fine enough for a visibly carved single-tile opening.
  const ROCK_EDGES = [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
  const ROCK_TETRAHEDRA = [[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
  const ROCK_CORNERS = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];

  function roundedRectangle(a, b, halfA, halfB, radius) {
    const x=Math.abs(a)-halfA,y=Math.abs(b)-halfB;
    return Math.hypot(Math.max(x,0),Math.max(y,0))+Math.min(Math.max(x,y),0)-radius;
  }

  function roundedBox(a,b,c,halfA,halfB,halfC,radius) {
    const x=Math.abs(a)-halfA,y=Math.abs(b)-halfB,z=Math.abs(c)-halfC;
    return Math.hypot(Math.max(x,0),Math.max(y,0),Math.max(z,0))
      +Math.min(Math.max(x,y,z),0)-radius;
  }

  function smoothUnion(a,b,radius) {
    if(!Number.isFinite(a))return b;
    const h=Math.max(radius-Math.abs(a-b),0)/radius;
    return Math.min(a,b)-h*h*radius*.25;
  }

  function doorOpeningFor(wall, plan) {
    const door=plan?.puzzleDoor;
    if(!door||!Number.isFinite(door.col)||!Number.isFinite(door.row))return null;
    let nearest=null,best=Infinity; // Nearest barrier cell defines the visible stone doorway's normal.
    for(const tile of wall.tiles.values()){
      const ds=(door.col-tile.col)**2+(door.row-tile.row)**2;
      if(ds<best){best=ds;nearest=tile;}
    }
    if(!nearest)return null;
    const nx=door.col-nearest.col,nz=door.row-nearest.row,length=Math.hypot(nx,nz)||1;
    return {x:door.col+.5,z:door.row+.5,nx:nx/length,nz:nz/length};
  }

  function rockField(wall,x,y,z) {
    // One signed solid for the entire barrier: neighboring stones are unioned
    // BEFORE triangulation. No overlapping icosahedra or exposed intersection seams.
    let body=Infinity;
    const col=Math.floor(x),row=Math.floor(z); // Only the immediately surrounding logical tiles can reach this probe.
    for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
      if(!wall.tiles.has((col+dc)+','+(row+dr)))continue;
      const dx=x-(col+dc+.5),dz=z-(row+dr+.5);
      const side=roundedRectangle(dx,dz,.46,.46,.12); // Slight overlap, with corner rounding and a natural chiseled boundary.
      const column=Math.max(side,-y-.3,y-wall.height);
      body=smoothUnion(body,column,.16);
    }
    if(wall.door){
      const door=wall.door,dx=x-door.x,dz=z-door.z;
      const across=-door.nz*dx+door.nx*dz,depth=door.nx*dx+door.nz*dz;
      const base=door.baseY||0,outerHeight=door.outerHeight||3.0;
      const doorwayRock=roundedBox(across,y-(base+outerHeight/2-.12),depth,
        door.outerHalfWidth||.66,outerHeight/2,door.outerDepth||.29,.14);
      body=smoothUnion(body,doorwayRock,.12); // Door piers and lintel fuse to adjacent rocks with no overlapping meshes.
    }
    // Stable surface variation belongs to the whole final union, including
    // jambs and freshly exposed mining faces, so carved cuts never look synthetic.
    if(Number.isFinite(body))body+=.055*Math.sin(x*3.7+y*1.8+Math.sin(z*2.4))
      *Math.cos(z*3.3-y*1.45)+.03*Math.sin(x*6.1+z*4.5+y*2.8);
    if(wall.door){
      const door=wall.door,dx=x-door.x,dz=z-door.z;
      const across=-door.nz*dx+door.nx*dz,depth=door.nx*dx+door.nz*dz;
      const base=door.baseY||0,openingHeight=door.openingHeight||2.0;
      const irregularCut=.032*Math.sin(y*4.2+across*3.5)+.027*Math.sin(y*6.3-across*4.9);
      const opening=roundedBox(across,y-(base+openingHeight/2-.10),depth,
        door.openingHalfWidth||.37,openingHeight/2,door.openingDepth||.65,.07)+irregularCut;
      body=Math.max(body,-opening); // Carve through rock: the subtraction creates complete inside surfaces around the hole.
    }
    return body;
  }

  function fusedRockGeometry(THREE,wall) {
    if(typeof THREE.BufferGeometry!=='function'||typeof THREE.Float32BufferAttribute!=='function')return null;
    const positions=[],uvs=[]; // Non-indexed triangles deliberately retain the low-poly, fractured stone shading.
    const step=ROCK_SAMPLE_STEP,bounds=wall.bounds;
    const nx=Math.ceil((bounds.maxX-bounds.minX)/step)+1;
    const nz=Math.ceil((bounds.maxZ-bounds.minZ)/step)+1;
    const ny=Math.ceil((wall.height+1.15)/step)+1;
    const xs=Array.from({length:nx},(_,i)=>bounds.minX+i*step);
    const ys=Array.from({length:ny},(_,i)=>-.6+i*step);
    const zs=Array.from({length:nz},(_,i)=>bounds.minZ+i*step);
    const samples=new Float32Array(nx*ny*nz); // Cached scalar samples: no duplicate SDF evaluations between adjacent tetrahedra.
    const at=(i,j,k)=>(k*ny+j)*nx+i;
    for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++)
      samples[at(i,j,k)]=rockField(wall,xs[i],ys[j],zs[k]);
    function addTriangle(a,b,c,inside,outside){
      const ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
      const normal=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
      const outward=[outside[0]-inside[0],outside[1]-inside[1],outside[2]-inside[2]];
      if(normal[0]*outward[0]+normal[1]*outward[1]+normal[2]*outward[2]<0){const temp=b;b=c;c=temp;}
      const ax=Math.abs(normal[0]),ay=Math.abs(normal[1]),az=Math.abs(normal[2]);
      for(const p of [a,b,c]){
        positions.push(p[0],p[1],p[2]);
        if(ay>=ax&&ay>=az)uvs.push(p[0]*.45,p[2]*.45);
        else if(ax>az)uvs.push(p[2]*.45,p[1]*.45);
        else uvs.push(p[0]*.45,p[1]*.45);
      }
    }
    const p=Array.from({length:8},()=>[0,0,0]),v=new Array(8);
    for(let k=0;k<nz-1;k++)for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){
      let hasSolid=false,hasAir=false;
      for(let c=0;c<8;c++){
        const offset=ROCK_CORNERS[c],ix=i+offset[0],jy=j+offset[1],kz=k+offset[2];
        p[c][0]=xs[ix];p[c][1]=ys[jy];p[c][2]=zs[kz];
        v[c]=samples[at(ix,jy,kz)];
        if(v[c]<0)hasSolid=true;else hasAir=true;
      }
      if(!hasSolid||!hasAir)continue; // Only boundary cubes emit geometry; solid joins have no hidden internal faces.
      for(const tet of ROCK_TETRAHEDRA){
        const solid=tet.filter(c=>v[c]<0),air=tet.filter(c=>v[c]>=0);
        if(!solid.length||!air.length)continue;
        const inside=[0,0,0],outside=[0,0,0];
        for(const c of solid)for(let d=0;d<3;d++)inside[d]+=p[c][d]/solid.length;
        for(const c of air)for(let d=0;d<3;d++)outside[d]+=p[c][d]/air.length;
        const crosses=[];
        for(const [ia,ib] of ROCK_EDGES){
          const a=tet[ia],b=tet[ib];
          if((v[a]<0)===(v[b]<0))continue;
          const t=v[a]/(v[a]-v[b]);
          crosses.push([p[a][0]+(p[b][0]-p[a][0])*t,
            p[a][1]+(p[b][1]-p[a][1])*t,
            p[a][2]+(p[b][2]-p[a][2])*t]);
        }
        if(crosses.length===3)addTriangle(crosses[0],crosses[1],crosses[2],inside,outside);
        else if(crosses.length===4){
          // Sort the coplanar cuts around the centroid before closing the quad.
          const centroid=crosses.reduce((a,c)=>[a[0]+c[0]/4,a[1]+c[1]/4,a[2]+c[2]/4],[0,0,0]);
          const outward=[outside[0]-inside[0],outside[1]-inside[1],outside[2]-inside[2]];
          const axis=outward.map(Math.abs).indexOf(Math.max(...outward.map(Math.abs)));
          const u=(axis+1)%3,w=(axis+2)%3;
          crosses.sort((a,b)=>Math.atan2(a[w]-centroid[w],a[u]-centroid[u])
            -Math.atan2(b[w]-centroid[w],b[u]-centroid[u]));
          addTriangle(crosses[0],crosses[1],crosses[2],inside,outside);
          addTriangle(crosses[0],crosses[2],crosses[3],inside,outside);
        }
      }
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    geometry.computeVertexNormals?.();
    geometry.computeBoundingSphere?.();
    geometry.userData={caveFusedRockTriangles:positions.length/9};
    return geometry;
  }

  function rebuildSeparatorWall(mapId) {
    const wall=separatorWalls.get(mapId);
    if(!wall)return;
    if(!wall.tiles.size&&!wall.door){
      wall.mesh?.parent?.remove(wall.mesh);
      wall.mesh?.geometry?.dispose?.();
      wall.mesh=null; // Completely mined walls leave no empty render root in Sense Mode or the scene.
      return;
    }
    const THREE=window.THREE;
    const geometry=fusedRockGeometry(THREE,wall); // Re-mesh every exposed side after each pickaxe strike or Shattercask tile removal.
    if(!geometry)return;
    const next=new THREE.Mesh(geometry,wall.material);
    next.name='cave_separator_fused_sculpted_wall';
    next.userData.caveSeparatorMass=true;
    next.userData.caveSeparatorFused=true;
    next.userData.caveSeparatorHeight=wall.height;
    next.userData.caveSeparatorLiveTiles=wall.tiles.size; // Mobile scene-inspector reports actual mined openings without devtools.
    next.userData.caveSeparatorDoorOpening=!!wall.door;
    next.castShadow=next.receiveShadow=true;
    window.OreRockTextures.fitRockMesh(next); // Shares existing stone/ore look and its continuous texture ownership.
    wall.mesh?.parent?.remove(wall.mesh);
    wall.mesh?.geometry?.dispose?.(); // Retire old triangulation, but keep the shared authored ore material and its texture.
    wall.mesh=next;
    wall.scene.add(next);
    deps.markOutline(next);
  }

  function carveStoneGate(parent,options={}) {
    const THREE=window.THREE;
    if(!parent?.add||!Number.isFinite(options.x)||!Number.isFinite(options.z))return null;
    const baseY=Number(options.y)||0;
    const width=Math.max(.7,Number(options.openingWidth)||4.8); // Puzzle doorway's clear width, not the cosmetic frame width.
    const height=Math.max(1.5,Number(options.openingHeight)||3.5); // Stone opening has a physical lintel above the rising slab.
    const frameWidth=width+Math.max(.45,Number(options.sideThickness)||.95);
    const frameHeight=Math.max(height+.75,Number(options.roofHeight)||9);
    const depth=Math.max(.16,Number(options.wallDepth)||.31);
    const wall={
      tiles:new Map(),height:baseY+frameHeight,
      bounds:{minX:options.x-frameWidth/2-.9,maxX:options.x+frameWidth/2+.9,
        minZ:options.z-depth-.9,maxZ:options.z+depth+.9},
      door:{x:options.x,z:options.z,nx:0,nz:1,baseY,outerHalfWidth:frameWidth/2,
        outerHeight:frameHeight,outerDepth:depth,openingHalfWidth:width/2,
        openingHeight:height,openingDepth:depth+.4},
    }; // The same sculpting field works for a locked puzzle gate and for a mined wall.
    const geometry=fusedRockGeometry(THREE,wall);
    if(!geometry)return null; // Headless puzzle labs keep their existing authored gate fallback.
    const material=window.OreRockTextures?.materialFor?.(THREE,'stone',{}) || new THREE.MeshStandardMaterial({color:0x777267,roughness:.94});
    const mesh=new THREE.Mesh(geometry,material);
    mesh.name='puzzle-cave-carved-roof-height-stone-gate';
    mesh.castShadow=mesh.receiveShadow=true;
    mesh.userData.caveSeparatorFused=true;
    mesh.userData.caveCarvedDoorOpening=true;
    mesh.userData.caveSeparatorHeight=wall.height;
    mesh.userData.devRuinFootprintIgnore=true; // Existing gate blocker remains the sole authority for movement and pathfinding.
    window.OreRockTextures?.fitRockMesh?.(mesh);
    parent.add(mesh);
    return mesh;
  }

  function senseTargets(scene) {
    const roots=[]; // Ordinary ore remains per-tile; a fused separator must be highlighted only once.
    for(const [mapId,rocks] of rockMaps){
      if(rockScenes.get(mapId)!==scene)continue;
      for(const group of rocks.values())if(group.parent===scene&&!group.userData?.caveSeparatorTile)roots.push(group);
      const wall=separatorWalls.get(mapId);
      if(wall?.mesh?.parent===scene)roots.push(wall.mesh);
    }
    return roots;
  }

  function removeVisual(mapId,col,row) {
    const rocks=rockMaps.get(mapId)||deps?.zoneMineableRockMeshes?.get?.(mapId);
    const id=col+','+row,group=rocks?.get(id);
    if(!group)return false;
    rocks.delete(id);
    const wall=separatorWalls.get(mapId);
    if(group.userData?.caveSeparatorTile&&wall?.tiles.delete(id)){
      if(batchDepth)pendingRebuilds.add(mapId);
      else rebuildSeparatorWall(mapId);
    }
    group.parent?.remove(group);
    group.traverse(node=>{
      node.geometry?.dispose?.();
      if(Array.isArray(node.material)){
        for(const material of node.material)if(!material?.userData?.sharedOreRockMaterial)material?.dispose?.();
      }else if(!node.material?.userData?.sharedOreRockMaterial)node.material?.dispose?.();
    });
    return true;
  }

  let deps = null; // { TileType, markOutline, zoneMineableRockMeshes, oreDefs } from game.js.

  function init(injectedDeps) { deps = injectedDeps; }

  function build(mapId, mapData, scene, grid) {
    const THREE = window.THREE;
    // Fresh map each build (rather than reusing any Map left over from a
    // stale pre-Tothal-Shift cavern of the same mapId — see
    // forgetZoneDenState) so removeZoneMineableRockVisual never targets an
    // orphaned rock group from a layout that no longer exists.
    const oreRockMeshes = new Map();
    pendingRebuilds.delete(mapId); // Rebuilding an evicted cave must not later apply a queued cut to its replacement scene.
    const stale=separatorWalls.get(mapId);
    if(stale){stale.mesh?.parent?.remove(stale.mesh);stale.mesh?.geometry?.dispose?.();separatorWalls.delete(mapId);}
    rockMaps.set(mapId,oreRockMeshes); // Rebuilt caves replace stale tile indices completely.
    rockScenes.set(mapId,scene);
    const barriers=(mapData.oreRocks||[]).filter(rock=>rock.caveSeparator);
    if(barriers.length){
      const tiles=new Map(barriers.map(rock=>[rock.col+','+rock.row,rock]));
      const minCol=Math.min(...barriers.map(rock=>rock.col)),maxCol=Math.max(...barriers.map(rock=>rock.col));
      const minRow=Math.min(...barriers.map(rock=>rock.row)),maxRow=Math.max(...barriers.map(rock=>rock.row));
      const door=doorOpeningFor({tiles},mapData.caveSitePlan);
      const bounds={minX:Math.min(minCol,door ? door.x-.9 : Infinity)-.8,
        maxX:Math.max(maxCol+1,door ? door.x+.9 : -Infinity)+.8,
        minZ:Math.min(minRow,door ? door.z-.9 : Infinity)-.8,
        maxZ:Math.max(maxRow+1,door ? door.z+.9 : -Infinity)+.8};
      const height=Math.max(8,3*(Number(mapData.cavernCarvedHeightScale)||1.5)+3); // Deliberately pierces even the tall carved vault; no gap beneath the ceiling.
      const material=window.OreRockTextures.materialFor(THREE,barriers[0].oreKey||barriers[0].oreKind,deps.oreDefs);
      separatorWalls.set(mapId,{scene,tiles,bounds,height,material,door,mesh:null});
    }
    if(mapData.oreRocks?.length)deps.zoneMineableRockMeshes.set(mapId,oreRockMeshes);
    for(const rock of mapData.oreRocks||[]){
      if(grid[rock.row]?.[rock.col]){
        const tile=grid[rock.row][rock.col];
        tile.type=deps.TileType.ROCK;tile.rockKind='diggableRockOre';tile.oreKind=rock.oreKind;
        tile.oreKey=deps.oreDefs?.[rock.oreKey||rock.oreKind]?(rock.oreKey||rock.oreKind):null;
        tile.caveSeparator=rock.caveSeparator===true;
      }
      const rockGroup=new THREE.Group();
      rockGroup.name='cave_ore_'+rock.col+'_'+rock.row;
      rockGroup.userData.caveSeparatorTile=rock.caveSeparator===true;
      if(!rock.caveSeparator){
        const {stoneGeo}=window.TerrainGeometry.buildRockTileGeo(rock.col,rock.row);
        if(!stoneGeo)continue;
        const material=window.OreRockTextures.materialFor(THREE,rock.oreKey||rock.oreKind,deps.oreDefs);
        const rockMesh=new THREE.Mesh(stoneGeo,material);
        window.OreRockTextures.fitRockMesh(rockMesh,`${mapId}:${rock.col},${rock.row}`);
        rockMesh.castShadow=rockMesh.receiveShadow=true;
        rockGroup.add(rockMesh);
      }
      rockGroup.position.set(rock.col+.5,0,rock.row+.5);
      scene.add(rockGroup);
      if(!rock.caveSeparator)deps.markOutline(rockGroup); // Fused wall gets one outline after its tessellation is ready.
      oreRockMeshes.set(rock.col+','+rock.row,rockGroup);
    }
    if(separatorWalls.has(mapId))rebuildSeparatorWall(mapId);
    return oreRockMeshes;
  }

  function withBatchedCuts(callback) {
    batchDepth++; // Both blast terrain clearing and saved terrain restoration may remove several adjacent stones.
    try{return callback();}
    finally{
      batchDepth--;
      if(!batchDepth){
        for(const mapId of pendingRebuilds)rebuildSeparatorWall(mapId);
        pendingRebuilds.clear();
      }
    }
  }

  function debugSnapshot(mapId) {
    const ids=mapId==null?[...separatorWalls.keys()]:[String(mapId)]; // Optional cave filter keeps mobile diagnostics small.
    return ids.map(id=>{
      const wall=separatorWalls.get(id);
      if(!wall)return {mapId:id,found:false};
      return {mapId:id,found:true,liveTiles:wall.tiles.size,height:wall.height,
        triangles:wall.mesh?.geometry?.userData?.caveFusedRockTriangles||0,
        doorOpening:!!wall.door,meshReady:!!wall.mesh};
    });
  }
  function probeRock(mapId,x,y,z) {
    const wall=separatorWalls.get(String(mapId)); // Scalar probe allows mobile debugging of mined holes without browser developer tools.
    return wall ? rockField(wall,Number(x),Number(y),Number(z)) : null;
  }
  window.CavernOreRocks = { init, build, senseTargets, removeVisual, withBatchedCuts, carveStoneGate, debugSnapshot, probeRock, CAVERN_ORE_TINTS };
})();

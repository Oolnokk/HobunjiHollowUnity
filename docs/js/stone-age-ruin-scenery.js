// Shared Stone Age ruin scenery: identical wilderness stone floor and authored cover in the preview and playable ruin.
// Never mutates ZoneTerrainFeatures' live dependencies, the V50 collision guides or the protected generator source.
((root) => {
  'use strict';
  const T=root.THREE; // Three.js instance shared by the game and the hidden V50 generator.
  function ruinRockGeometry(mesh,settings){
    let sourceGeometry=mesh.geometry; // Keep caller-owned stone sources intact; only wall prisms are temporary build inputs.
    if(mesh.userData?.ruinInteriorWall){
      sourceGeometry.computeBoundingBox();
      const size=sourceGeometry.boundingBox.getSize(new T.Vector3()),center=sourceGeometry.boundingBox.getCenter(new T.Vector3()); // Generated wall panels use their local XY footprint and original center.
      sourceGeometry=new T.BoxGeometry(Math.max(.01,size.x),Math.max(.01,size.y),Math.max(.45,size.z));
      sourceGeometry.translate(center.x,center.y,center.z); // Extrude equally on both sides without shifting walls or bridging doorway gaps.
    }
    try{return window.ProceduralFurniture.createRockGeometry(sourceGeometry,settings);}
    finally{if(sourceGeometry!==mesh.geometry)sourceGeometry.dispose();}
  }
  function makeRuinStoneMaterial(color){
    const source=new T.MeshBasicMaterial({color,side:T.DoubleSide}),geometry=new T.PlaneGeometry(1,1),proxy=new T.Mesh(geometry,source); // Temporary material-factory input avoids reprocessing any real scenery during colour edits.
    window.NaturalSurfaceMaterials.naturalizeMesh(proxy,'rocks',null,{tint:color}); // Farm cliffs use this exact PNG, body-tint and unlit material authority.
    const material=proxy.material.clone(); // The room owns its material; the natural-surface authority retains ownership of its cached texture.
    geometry.dispose();if(proxy.geometry!==geometry)proxy.geometry.dispose();source.dispose();
    return material;
  }
  function mapRuinStoneSurfaces(mesh){
    const before=mesh.geometry; // Walls use the furniture threshold; each shallow floor crown stays continuous within its explicit rock identity.
    const report=window.HobunjiSurfaceStretchUV.mapMesh(mesh,{label:mesh.name||'Ruin stone',...(mesh.userData.ruinPreviewRole==='floor'?{angleToleranceDeg:89}:{})});
    if(mesh.geometry!==before)before.dispose(); // Scenery buffers are owned by this preview; no generator buffers are passed here.
    mesh.userData.stoneSurfaceMapping={...report,postRockification:true};
    return report;
  }
  function ruinFloorShell(meta,seed){
    const cols=Number(meta.gridCols),rows=Number(meta.gridRows),cellSize=Number(meta.cellSize); // Generator dimensions keep the replacement exactly inside its real floor footprint.
    if(!Number.isInteger(cols)||!Number.isInteger(rows)||cols<1||rows<1||cols>512||rows>512||!Number.isFinite(cellSize)||cellSize<=0||!Number.isFinite(Number(meta.worldWidth))||!Number.isFinite(Number(meta.worldDepth))||!Array.isArray(meta.floorCells)||!meta.floorCells.length)throw new Error('The generated room has no valid floor footprint.');
    const grid=Array.from({length:rows},()=>Array(cols).fill(null)); // Preview-owned grid: the wilderness builder may cache cover heights without touching generator metadata.
    let salt=0;for(const letter of String(seed))salt=(Math.imul(salt,31)+letter.charCodeAt(0))>>>0; // Seed varies the joints reproducibly without changing the generated room footprint.
    const noise=()=>{salt=(Math.imul(salt,1664525)+1013904223)>>>0;return salt/4294967296;}; // Jitters the stone centres used by the floor partition only.
    const centres=[]; // Nearest-centre footprints give the real wilderness builder irregular stones rather than rectangular tiles.
    for(let r=-2;r<rows+4;r+=4)for(let c=-2;c<cols+5;c+=5)centres.push({x:c+(Math.floor((r+2)/4)%2)*2+(noise()-.5)*2,z:r+(noise()-.5)*1.5});
    for(const [c,r] of meta.floorCells){
      if(!Number.isInteger(c)||!Number.isInteger(r)||c<0||r<0||c>=cols||r>=rows)throw new Error('The generated floor contains an invalid cell.');
      let nearest=0,distance=Infinity; // Every actual floor cell belongs to one large, irregular stone with no uncovered gaps.
      for(let i=0;i<centres.length;i++){const d=(c+.5-centres[i].x)**2+(r+.5-centres[i].z)**2;if(d<distance){distance=d;nearest=i;}}
      grid[r][c]={type:'rock',rockKind:'undiggableBoulder',boulderId:'stone:'+nearest,elevTier:0};
    }
    const wilderness=window.ZoneTerrainFeatures; // Reuse the actual wilderness boulder shell owner in this standalone preview realm.
    const shell=wilderness.buildUndiggableBoulderShellData(grid,cols,rows,null,{NORMAL_TOP:0,PLATEAU_UNIT:1,TileType:{ROCK:'rock'}}); // Build with explicit floor datum; never overwrite the live wilderness scene's dependencies. // One welded batch contains separate natural boulder crowns with no tiny bricks.
    const pieceIds=new Float32Array(shell.pos.length/3); // One identity per original wilderness boulder keeps its texture separate even where floor stones touch.
    for(let i=0;i<shell.idx.length;i+=3){
      const indices=shell.idx.slice(i,i+3),c=Math.floor(indices.reduce((sum,index)=>sum+shell.pos[index*3],0)/3),r=Math.floor(indices.reduce((sum,index)=>sum+shell.pos[index*3+2],0)/3); // Each source triangle stays inside its generated floor cell.
      const id=Number(grid[r][c].boulderId.slice(6)); // The same piece identity is assigned to every corner, including duplicated seam positions.
      for(const index of indices)pieceIds[index]=id;
    }
    const floorY=Number(meta.floorSurfaceY)||0,yScale=.25; // Compress wilderness height to a skipping-stone profile while leaving horizontal size intact.
    for(let i=0;i<shell.pos.length;i+=3){shell.pos[i]=shell.pos[i]*cellSize-Number(meta.worldWidth)/2;shell.pos[i+1]=floorY-.12+shell.pos[i+1]*yScale;shell.pos[i+2]=shell.pos[i+2]*cellSize-Number(meta.worldDepth)/2;}
    return {...shell,yScale,pieceIds};
  }
  function ruinFloorTileLayout(shell,floorY){
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity; // Tile the actual floor bounds rather than the generator grid's unused perimeter.
    for(let i=0;i<shell.pos.length;i+=3){minX=Math.min(minX,shell.pos[i]);maxX=Math.max(maxX,shell.pos[i]);minZ=Math.min(minZ,shell.pos[i+2]);maxZ=Math.max(maxZ,shell.pos[i+2]);}
    const scale=.25,offsets=[]; // Uniform scaling reduces both horizontal variation and relief around the existing floor datum.
    for(let z=0;z<4;z++)for(let x=0;x<4;x++)offsets.push([minX*(1-scale)+(maxX-minX)*scale*x,floorY*(1-scale),minZ*(1-scale)+(maxZ-minZ)*scale*z]);
    return {scale,offsets,minX,maxX,minZ,maxZ};
  }
  function compactFloorStoneIndices(indices){
    const result=[]; // Each wilderness source cell is a 4x4 quad lattice; quarter-size rendering only needs its 2x2 corner samples.
    for(let cell=0;cell<indices.length;cell+=96)for(let row=0;row<4;row+=2)for(let col=0;col<4;col+=2){
      const top=cell+(row*4+col)*6,bottom=cell+((row+1)*4+col)*6; // Original top-left, top-right, bottom-left and bottom-right corners remain exact.
      const a=indices[top],b=indices[top+6+5],d=indices[bottom+1],e=indices[bottom+6+2];result.push(a,d,e,a,e,b);
    }
    return result;
  }
  function floorStrandRingIndices(position,uv){
    const ringCount=Math.floor(position.count/6),starts=[0],kept=[]; // Foliage keeps six vertices per ring and restarts the length UV for each separate strand.
    for(let ring=1;ring<ringCount;ring++)if(uv.getY(ring*6)<uv.getY((ring-1)*6)-.5)starts.push(ring);starts.push(ringCount);
    for(let strand=0;strand<starts.length-1;strand++){
      const first=starts[strand],end=starts[strand+1]-1,centers=[]; // Preserve the finished shrinkwrap shape with bounded-error centerline simplification.
      for(let ring=first;ring<=end;ring++){let x=0,y=0,z=0;for(let spoke=0;spoke<5;spoke++){x+=position.getX(ring*6+spoke)/5;y+=position.getY(ring*6+spoke)/5;z+=position.getZ(ring*6+spoke)/5;}centers.push([x,y,z]);}
      const center=centers[0],radius=Math.hypot(position.getX(first*6)-center[0],position.getY(first*6)-center[1],position.getZ(first*6)-center[2]),tolerance=Math.max(.03,radius*.35),selected=new Set([0,end-first]),pending=[[0,end-first]]; // At quarter scale the tolerance is millimetres to about two centimetres, depending on strand thickness.
      while(pending.length){const [a,b]=pending.pop(),start=centers[a],finish=centers[b],dx=finish[0]-start[0],dy=finish[1]-start[1],dz=finish[2]-start[2],lengthSq=dx*dx+dy*dy+dz*dz;let farthest=-1,error=tolerance*tolerance;
        for(let i=a+1;i<b;i++){const point=centers[i],t=lengthSq?Math.max(0,Math.min(1,((point[0]-start[0])*dx+(point[1]-start[1])*dy+(point[2]-start[2])*dz)/lengthSq)):0,d=(point[0]-start[0]-dx*t)**2+(point[1]-start[1]-dy*t)**2+(point[2]-start[2]-dz*t)**2;if(d>error){error=d;farthest=i;}}
        if(farthest>=0){selected.add(farthest);pending.push([a,farthest],[farthest,b]);}
      }
      kept.push([...selected].sort((a,b)=>a-b).map(index=>first+index));
    }
    return kept;
  }
  function compactFloorCover(group){
    group.traverse(mesh=>{
      if(!mesh.isMesh)return;const source=mesh.geometry,position=source?.getAttribute('position'),uv=source?.getAttribute('uv'); // Only the generated floor cover is owned here; walls and live furniture retain their full detail.
      if(!position||!uv||position.count%6)return;
      const positions=[],uvs=[],indices=[]; // All repeated copies share this smaller finished geometry.
      for(const rings of floorStrandRingIndices(position,uv)){const base=positions.length/3;for(const ring of rings)for(let spoke=0;spoke<6;spoke++){const index=ring*6+spoke;positions.push(position.getX(index),position.getY(index),position.getZ(index));uvs.push(uv.getX(index),uv.getY(index));}for(let ring=0;ring<rings.length-1;ring++)for(let spoke=0;spoke<5;spoke++){const a=base+ring*6+spoke,b=a+6;indices.push(a,a+1,b,b,a+1,b+1);}}
      const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();mesh.geometry=geometry;source.dispose();
    });
  }
  function ruinFloorMesh(meta,seed,material){
    const shell=ruinFloorShell(meta,seed),geometry=new T.BufferGeometry(); // One owned buffer keeps vegetation sampling and draw calls bounded in the larger room.
    geometry.setAttribute('position',new T.Float32BufferAttribute(shell.pos,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(shell.uv,2));
    geometry.setIndex(compactFloorStoneIndices(shell.idx));geometry.setAttribute('surfacePieceId',new T.Float32BufferAttribute(shell.pieceIds,1));geometry.computeVertexNormals();
    const pattern=new T.Mesh(geometry,material); // Keep one original-size floor patch for UV fitting and a single vegetation shrinkwrap pass.
    pattern.name='Skipping-stone floor pattern';pattern.userData={liveRootFloor:true,ruinPreviewRole:'floor',surfaceFoliageRole:'floors'};
    mapRuinStoneSurfaces(pattern);
    const layout=ruinFloorTileLayout(shell,Number(meta.floorSurfaceY)||0),mesh=new T.InstancedMesh(pattern.geometry,material,layout.offsets.length),matrix=new T.Matrix4(); // Sixteen GPU instances share the original stone buffers and fitted UVs.
    for(const [index,offset] of layout.offsets.entries()){matrix.makeScale(layout.scale,layout.scale,layout.scale);matrix.setPosition(...offset);mesh.setMatrixAt(index,matrix);}
    mesh.instanceMatrix.needsUpdate=true;
    mesh.name='Quarter-scale tiled stone floor';mesh.userData={...pattern.userData,stoneSurfaceMapping:pattern.userData.stoneSurfaceMapping,floorStyle:'tiled-wilderness-skipping-stones',stoneCount:shell.componentCount*layout.offsets.length,patternStoneCount:shell.componentCount,yScale:shell.yScale*layout.scale,tileScale:layout.scale,tileCopies:layout.offsets.length};
    return {mesh,pattern,layout};
  }


  // A quarter-scale boulder field directly follows V50's real floor cells, instead
  // of repeating a rectangular texture over voids and rooms at different levels.
  function ruinMappedFloorShell(meta,seed,floorHeights=null){
    const cols=Number(meta?.gridCols),rows=Number(meta?.gridRows),cellSize=Number(meta?.cellSize); // V50 grid bounds are the sole floor topology authority.
    if(!Number.isInteger(cols)||!Number.isInteger(rows)||cols<1||rows<1||cols>512||rows>512||
      !Number.isFinite(cellSize)||cellSize<=0||!Number.isFinite(Number(meta.worldWidth))||
      !Number.isFinite(Number(meta.worldDepth))||!Array.isArray(meta.floorCells)||!meta.floorCells.length)
      throw new Error('The Stone Age floor needs a valid V50 footprint.');
    const baseY=Number(meta.floorSurfaceY)||0,step=Number(meta.plateauModel?.stepHeight)||.42; // Used only when the runtime's authoritative sampled plateau map is unavailable.
    const regions=Array.isArray(meta.plateauModel?.regions)?meta.plateauModel.regions:[]; // Replays V50's floor elevation overlays in their authored order.
    const floorYAt=(c,r)=>{
      const registered=floorHeights?.get?.(c+','+r); // Runtime supplies the actual floor mesh's levelByCell, including overlapping plateaus.
      if(Number.isFinite(registered))return registered;
      let elevation=baseY;
      for(const region of regions){
        if(c>=Number(region.col)&&r>=Number(region.row)&&c<Number(region.col)+Number(region.w)&&r<Number(region.row)+Number(region.h)&&
          Number.isFinite(Number(region.level)))elevation=baseY+Number(region.level)*step;
      }
      return elevation;
    };
    let salt=0;for(const letter of String(seed))salt=(Math.imul(salt,31)+letter.charCodeAt(0))>>>0; // Stable world-space boulder joints regardless of room order.
    const noise=(c,r,axis)=>{
      let x=(salt^Math.imul(c,374761393)^Math.imul(r,668265263)^Math.imul(axis,1274126177))>>>0;
      x=Math.imul(x^(x>>>15),2246822519)>>>0;x=Math.imul(x^(x>>>13),3266489917)>>>0;
      return ((x^(x>>>16))>>>0)/4294967296;
    };
    const grid=Array.from({length:rows},()=>Array(cols).fill(null)); // Absent cells remain absent geometry: pits and gaps cannot become decorative bridges.
    const pieceByKey=new Map(),pieceHeights=[],heights=new Set(); // Same-height boulders never merge the sides of a dais or sunken tier.
    const floorSeen=new Set(); // Reject malformed/duplicate cells instead of drawing duplicate colliding surfaces.
    for(const point of meta.floorCells){
      const c=Number(point?.[0]),r=Number(point?.[1]);
      if(!Number.isInteger(c)||!Number.isInteger(r)||c<0||r<0||c>=cols||r>=rows||floorSeen.has(c+','+r))
        throw new Error('The Stone Age floor contains an invalid or duplicate cell.');
      floorSeen.add(c+','+r);
      const height=floorYAt(c,r);if(!Number.isFinite(height))throw new Error('The generated floor elevation is invalid.');
      heights.add(Math.round(height*1000));
      const spacing=1.5,gx=Math.floor(c/spacing),gz=Math.floor(r/spacing); // Roughly quarter-size original stone spacing; cells still join into irregular multi-cell rocks.
      let chosen=null,distance=Infinity; // A fixed nine-candidate local Voronoi search bounds work even for a large multi-room dungeon.
      for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
        const cx=gx+dx,cz=gz+dz,jx=(cx+.5)*spacing+(noise(cx,cz,0)-.5)*1.05,
          jz=(cz+.5)*spacing+(noise(cx,cz,1)-.5)*1.05;
        const d=(jx-c-.5)**2+(jz-r-.5)**2;
        if(d<distance){distance=d;chosen=cx+','+cz;}
      }
      const idKey=chosen+'@'+Math.round(height*1000); // Separates neighboring rocks at different elevations while preserving deterministic seams.
      if(!pieceByKey.has(idKey)){pieceByKey.set(idKey,pieceHeights.length);pieceHeights.push(height);}
      grid[r][c]={type:'rock',rockKind:'undiggableBoulder',boulderId:'stone:'+pieceByKey.get(idKey),elevTier:height};
    }
    const terrain=root.ZoneTerrainFeatures;
    const shell=terrain.buildUndiggableBoulderShellData(grid,cols,rows,null,{NORMAL_TOP:0,PLATEAU_UNIT:1,TileType:{ROCK:'rock'}});
    const pieceIds=new Float32Array(shell.pos.length/3); // Texture charts remain isolated per irregular source boulder.
    for(let i=0;i<shell.idx.length;i+=3){
      const indices=[shell.idx[i],shell.idx[i+1],shell.idx[i+2]];
      const c=Math.floor(indices.reduce((sum,index)=>sum+shell.pos[index*3],0)/3);
      const r=Math.floor(indices.reduce((sum,index)=>sum+shell.pos[index*3+2],0)/3);
      const cell=grid[r]?.[c];
      if(!cell)throw new Error('Stone geometry escaped the V50 floor footprint.');
      const id=Number(cell.boulderId.slice(6));
      for(const index of indices)pieceIds[index]=id;
    }
    const reliefScale=.0625; // Quarter-size feature spacing and quarter-size source height, both applied once in the final geometry.
    const minHeight=pieceHeights.reduce((min,y)=>Math.min(min,y),Infinity),maxHeight=pieceHeights.reduce((max,y)=>Math.max(max,y),-Infinity); // Bounded even when ruins exceed JavaScript's argument-spread limits.
    for(let i=0;i<shell.pos.length;i+=3){
      const y=pieceHeights[pieceIds[i/3]]; // The component's native floor level is never scaled towards another room's datum.
      shell.pos[i]=shell.pos[i]*cellSize-Number(meta.worldWidth)/2;
      shell.pos[i+1]=y-.03+(shell.pos[i+1]-y)*reliefScale;
      shell.pos[i+2]=shell.pos[i+2]*cellSize-Number(meta.worldDepth)/2;
    }
    return {...shell,pieceIds,featureScale:.25,reliefScale,levelCount:heights.size,minHeight,maxHeight,
      floorCells:floorSeen.size,voidCells:cols*rows-floorSeen.size,pieceCount:pieceHeights.length};
  }

  function ruinMappedFloorMesh(meta,seed,material,floorHeights){
    const shell=ruinMappedFloorShell(meta,seed,floorHeights),geometry=new T.BufferGeometry(); // Single compact mesh spans only truly walkable cells at their exact V50 elevations.
    geometry.setAttribute('position',new T.Float32BufferAttribute(shell.pos,3));
    geometry.setAttribute('uv',new T.Float32BufferAttribute(shell.uv,2));
    geometry.setAttribute('surfacePieceId',new T.Float32BufferAttribute(shell.pieceIds,1));
    geometry.setIndex(compactFloorStoneIndices(shell.idx));geometry.computeVertexNormals();
    const mesh=new T.Mesh(geometry,material);mesh.name='Cell-masked quarter-scale ruin stone';
    mesh.userData={liveRootFloor:true,ruinPreviewRole:'floor',surfaceFoliageRole:'floors',
      floorStyle:'cell-masked-wilderness-skipping-stones',stoneCount:shell.componentCount,
      tileScale:.25,tileCopies:1,levels:shell.levelCount,voidCells:shell.voidCells};
    mapRuinStoneSurfaces(mesh);
    const stats={featureScale:shell.featureScale,reliefScale:shell.reliefScale,levelCount:shell.levelCount,
      voidCells:shell.voidCells,floorCells:shell.floorCells,minHeight:shell.minHeight,maxHeight:shell.maxHeight,
      pieceCount:shell.pieceCount,componentCount:shell.componentCount}; // Drop temporary source arrays; the compact BufferGeometry is the sole resident floor mesh.
    return {mesh,pattern:mesh,layout:null,stats};
  }

  function coverRecipes(templeRecipes,rootColor='#24211d'){
    if(!Array.isArray(templeRecipes)||!templeRecipes.length)throw new Error('Temple vegetation layers are required.');
    const recipes=templeRecipes.map(recipe=>({...recipe,...(recipe.kind==='roots'?{color:rootColor}:{}),
      count:Math.min(80,recipe.count*3),strandLimit:Math.min(80,recipe.strandLimit*3),density:Math.max(.75,recipe.density*2),shrinkwrapFinal:true,
      radiusScaleMin:recipe.kind==='roots'?.6:1,radiusScaleMax:1.5}));
    const wallVines=recipes.find(recipe=>recipe.kind==='vines'&&recipe.target==='walls');
    const wallRoots=recipes.find(recipe=>recipe.kind==='roots'&&recipe.style==='wrap');
    if(wallVines)recipes.push({...wallVines,seed:wallVines.seed+':root-weave',density:1});
    for(const recipe of [wallRoots,wallVines])if(recipe)recipes.push({...recipe,seed:recipe.seed+':floor-cover',
      target:'floors',style:recipe.kind==='roots'?'natural':'wrap',count:80,density:1,strandLimit:80,length:18,inset:0});
    return recipes;
  }

  // The playable generator owns collision and puzzle footprints; this layer owns only scenery.
  function buildRoom({root,meta,seed,roughness=.3,color='#363733',floorHeights=null}){
    if(!root?.isObject3D||!meta)throw new TypeError('Stone Age scenery needs the generated V50 root and shell metadata.');
    if(!window.ProceduralFurniture?.createRockGeometry||!window.NaturalSurfaceMaterials?.naturalizeMesh||
        !window.HobunjiSurfaceStretchUV?.mapMesh||!window.ZoneTerrainFeatures?.buildUndiggableBoulderShellData)
      throw new Error('Stone Age scenery dependencies are not loaded.');
    const model=new T.Group(); // Holds the authored replacement wall, pillars, floor and static vegetation under the native V50 transform.
    model.name='Rooted Stone Age scenery';
    const stoneMaterial=makeRuinStoneMaterial(color); // Shared textured material; released with the authored scenery.
    const nativeMeshes=[]; // Original native meshes remain intact as collision and puzzle authorities.
    let walls=0,pillars=0,pieces=0,closed=false,active=false;
    try{
      root.updateWorldMatrix(true,true);
      const toLocal=root.matrixWorld.clone().invert(); // Existing scene transform is removed before adding clones as children of root.
      const candidates=[]; // Snapshot avoids traversing generated clones as additional V50 furniture.
      root.traverse(mesh=>{if(mesh.isMesh)candidates.push(mesh);});
      for(const mesh of candidates){
        const isFloor=mesh.userData?.wallBuilderRecipe==='wallrecipe2.json';
        let owner=mesh,role='',isPillar=false,hidden=false,semantic=false;
        while(owner&&owner!==root){
          const info=owner.userData||{};
          role ||= info.interiorRuinRole||'';
          isPillar ||= !!info.squarePillar&&!info.repoPillarBeam&&!info.squarePillarBeam;
          hidden ||= owner.visible===false||!!info.surfaceFoliage||!!info.surfaceFoliageGuide;
          semantic ||= !!(info.activatorType||info.previewMotion||info.mechanismId||info.linkedMechanismId||
            info.transitDoor||info.squarePillarHousing||info.interactive3D||info.puzzleId||info.pushable);
          owner=owner.parent;
        }
        isPillar ||= /pillar/i.test(role);
        // Never reskin or hide a semantic activator/moving mechanism merely because a parent happens to be a pillar.
        if(hidden||semantic||!mesh.geometry?.getAttribute?.('position')||mesh.userData?.furnitureGlbPart)continue;
        if(isFloor){nativeMeshes.push({mesh,layerMask:mesh.layers.mask});continue;}
        if(!mesh.userData?.ruinInteriorWall&&!isPillar)continue;
        const copy=mesh.clone(false);
        copy.geometry=ruinRockGeometry(mesh,{enabled:true,seed:String(seed)+':stone-'+pieces,roughness,contactArea:.35});
        copy.material=stoneMaterial;
        copy.userData={ruinPreviewRole:isPillar?'pillar':'wall',surfaceFoliageRole:'walls',stoneAgeScenery:true};
        copy.layers.enable(0);copy.castShadow=false;copy.receiveShadow=false; // Replacement stone must draw on the gameplay camera's default layer.
        mapRuinStoneSurfaces(copy);
        toLocal.clone().multiply(mesh.matrixWorld).decompose(copy.position,copy.quaternion,copy.scale);
        model.add(copy);
        nativeMeshes.push({mesh,layerMask:mesh.layers.mask}); // Keep exact V50 layer masks for collision-safe teardown.
        pieces+=mesh.isInstancedMesh?mesh.count:1;
        if(isPillar)pillars++;else walls++;
      }
      if(!walls)throw new Error('Stone Age ruin has no generated walls to replace.');
      const floor=floorHeights?ruinMappedFloorMesh(meta,seed,stoneMaterial,floorHeights):ruinFloorMesh(meta,seed,stoneMaterial); // Multiroom gameplay uses exact V50 cells; the standalone preview retains its original 4×4 room tiles.
      model.add(floor.mesh);
      model.updateWorldMatrix(true,true);
      const room={model,seed,stoneMaterial,floorPattern:floor.pattern,floorLayout:floor.layout,
        floorY:Number(meta.floorSurfaceY)||0,walls,pillars,pieces,floorStones:floor.mesh.userData.stoneCount,
        floorStats:floor.stats||null}; // Multi-elevation diagnostics stay attached to the same authored room object.
      const activate=()=>{
        if(active||closed)return;
        for(const item of nativeMeshes)item.mesh.layers.disable(0); // Keep source visible/material alive for stillOwnedByScanRoot() collision; only suppress main-camera drawing.
        root.add(model);active=true;
      };
      const dispose=()=>{
        if(closed)return;closed=true;
        for(const item of nativeMeshes)item.mesh.layers.mask=item.layerMask; // Original mask is restored before V50 reclaims the source tree.
        model.parent?.remove(model);
        const geometries=new Set();
        model.traverse(mesh=>{if(!mesh.isMesh)return;if(mesh.geometry)geometries.add(mesh.geometry);if(mesh.isInstancedMesh)mesh.dispose?.();});
        for(const geometry of geometries)geometry.dispose();
        stoneMaterial.dispose();
      };
      return {room,activate,dispose,nativeMeshes,get active(){return active;}};
    }catch(error){
      const geometries=new Set();
      model.traverse(mesh=>{if(mesh.isMesh&&mesh.geometry)geometries.add(mesh.geometry);});
      for(const geometry of geometries)geometry.dispose();
      stoneMaterial.dispose();
      throw error;
    }
  }

  async function prepareCover({room,templeRecipes,rootColor='#24211d',signal,onProgress}){
    if(!window.LiveRootGrowth?.createCoverAsync||!window.FoliageGenerator)throw new Error('Root vegetation runtime is missing.');
    const recipes=coverRecipes(templeRecipes,rootColor); // One source for wall/floor vegetation both in authoring and gameplay.
    const wallRecipes=recipes.filter(r=>r.target!=='floors').map(r=>r.target==='all'?{...r,target:'walls'}:r);
    const floorRecipes=recipes.filter(r=>r.target==='floors'||r.target==='all').map(r=>({...r,target:'floors'}));
    const build=(target,layers)=>window.LiveRootGrowth.createCoverAsync({
      THREE:T,foliage:window.FoliageGenerator,target,recipes:layers,seed:String(room.seed)+':ruin-cover',
      floorY:room.floorY,signal,onProgress,
    });
    let walls=null,floor=null,complete=false;const patches=[];
    try{
      walls=await build(room.model,wallRecipes);
      const floorTarget=new T.Group();floorTarget.add(room.floorPattern.clone(false));
      floor=await build(floorTarget,floorRecipes);
      compactFloorCover(floor.targetGrowth);
      if(room.floorLayout){
        for(const offset of room.floorLayout.offsets){
          const patch=floor.targetGrowth.clone(true);patch.name='Quarter-scale floor vegetation';
          patch.scale.setScalar(room.floorLayout.scale);patch.position.set(...offset);
          walls.targetGrowth.add(patch);patches.push(patch);
        }
      }else{ // Multi-room geometry is already quarter-scale and cell-masked: never repeat it over missing cells.
        const patch=floor.targetGrowth;
        patch.name='Cell-masked floor vegetation';walls.targetGrowth.add(patch);patches.push(patch);
      }
      const stats={wallStrands:walls.getDiagnostics().shapeStrands,floorPatternStrands:floor.getDiagnostics().shapeStrands,
        copies:patches.length,visibleStrands:walls.getDiagnostics().shapeStrands+floor.getDiagnostics().shapeStrands*patches.length};
      let disposed=false;
      const cover={stats,attach(){room.model.add(walls.targetGrowth);},dispose(){
        if(disposed)return;disposed=true;
        for(const patch of patches)patch.parent?.remove(patch);
        walls.targetGrowth.parent?.remove(walls.targetGrowth);
        walls.dispose();floor.dispose();
      }};
      complete=true;return cover;
    }finally{
      if(!complete){
        for(const patch of patches)patch.parent?.remove(patch);
        walls?.dispose();floor?.dispose();
      }
    }
  }
  window.StoneAgeRuinScenery=Object.freeze({
    ruinRockGeometry,makeRuinStoneMaterial,mapRuinStoneSurfaces,ruinFloorShell,ruinFloorTileLayout,
    ruinMappedFloorShell,ruinMappedFloorMesh,
    compactFloorStoneIndices,floorStrandRingIndices,compactFloorCover,ruinFloorMesh,coverRecipes,buildRoom,prepareCover,
  });
})(typeof window !== 'undefined' ? window : globalThis);

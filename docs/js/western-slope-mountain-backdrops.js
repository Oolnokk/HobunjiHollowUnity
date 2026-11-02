(() => {
  'use strict';

  const WESTERN_SLOPE_ID = 'map_western_slope'; // Used to scope the rock ridges and author overrides to Western Slope.
  const BACKGROUND_MAX_DEPTH_NDC = 1 - 5 * (2 / 65535); // One 16-bit depth slot ahead of sky-dome.js's nearest cloud mask.
  const SNOW_TEXTURE_URL = (() => { try { return new URL('../assets/textures/canvas.png', document.currentScript?.src || window.location?.href).href; } catch (_) { return 'assets/textures/canvas.png'; } })(); // Same authored canvas PNG as Western Slope ground snow, resolved for game and nested author-tool pages.
  const RIDGE_LENGTH_MAP_MULTIPLIER = 2; // Each complete eight-rock ridge spans exactly twice the map's north-south edge.
  const SNOW_CAP_HEIGHT_FRACTION = 2 / 3; // Snow covers the upper two-thirds of every rock's own vertical bounds.
  const SNOW_BOUNDARY_LIFT = 0.002; // Tiny local lift keeps the cap outline visible without changing either surface's geometry.
  const GROUP_NAME = 'WesternSlopeMountainBackdrops'; // Kept stable for scene duplicate detection and editor lookup.
  const AUTHOR_STORAGE_KEY = 'hobunjiWesternSlopeMountainBackdrops.v1'; // Shared by the background author and live runtime.
  const ASSET_URLS = Object.freeze(['assets/backdrops/bd_mountains_1.png','assets/backdrops/bd_mountains_2.png','assets/backdrops/bd_mountains_3.png']); // Original layer dimensions preserve the authored scenery footprint.
  const SOURCE_SIZES = Object.freeze([{width:1200,height:500},{width:900,height:650},{width:1400,height:700}]); // Original PNG dimensions keep each replacement ridge's overall span.
  const ROCKS_PER_LAYER = 8; // Each former mountain PNG becomes one row of eight decorative mine-style rocks.
  const ROCK_SEED_BASE = 1731; // Used to create deterministic but visibly different rock silhouettes.
  const ROCK_HEIGHT_FRACTION = 0.72; // Typical peak height in the generated one-tile mine-rock geometry.
  const ignoreRaycast = () => {}; // Decorative rocks must never intercept tool targeting or pointer queries.
  const MIN_WIDTH_MULTIPLIER = 2.75; // Used to keep every scenery layer wider than the wilderness.
  const MIN_HEIGHT_MULTIPLIER = 1.6; // Used to preserve the former mountain PNGs' tall vertical coverage.
  const WEST_EDGE_OFFSET_MULTIPLIER = 0.12; // Used for the nearest ridge's offset beyond the west edge.
  const WEST_STACK_SHIFT_MULTIPLIER = 0.25; // Used to move the complete default ridge stack west by a quarter map span.
  const WEST_LAYER_GAP_MULTIPLIER = 0.85; // Used for equal deep spacing between ridges.
  const MIN_WEST_EDGE_OFFSET = 24; // Used so small/test maps still clear border terrain.
  const patchedBorderApis = new WeakSet(); // Used to wrap each BorderTerrain API once.
  const patchedChunkApis = new WeakSet(); // Used to wrap each WildernessChunks API once.
  const activeByMap = new Map(); // Owns one scenery record per map lifecycle.
  const stats = { borderHookInstalls:0, chunkHookInstalls:0, buildRequests:0, completedBuilds:0, disposedBuilds:0, failedTextures:0, failedBuilds:0, snowCapsBuilt:0, snowBoundaryLinesBuilt:0, snowTextureState:'not-requested', lastError:null, lastLayout:null }; // Mobile/debug counters include per-rock snow coverage and texture state.

  function log(message, level='info') {
    const text='[western-slope-backdrops] '+message;
    if(typeof window.__farmLog==='function') window.__farmLog(text,level,'world');
    else if(level==='warn'||level==='error') console.warn(text);
    else console.debug?.(text);
  }
  function finiteOr(value,fallback=null){ if(value==null||value==='')return fallback;const n=Number(value);return Number.isFinite(n)?n:fallback; }
  function vector(raw,fallback,{positive=false,allowNull=false}={}) {
    const src=Array.isArray(raw)?raw:[];
    return fallback.map((fb,i)=>{if(allowNull&&(src[i]==null||src[i]===''))return fb;const v=finiteOr(src[i],fb);return positive&&!(v>0)?fb:v;});
  }
  function defaultAuthorConfig(){
    return {schema:'hobunji_western_slope_mountain_backdrops.v1',enabled:true,layers:ASSET_URLS.map((asset,i)=>({layer:i+1,asset,visible:true,transform:{position:[null,null,null],rotationDeg:[0,0,0],scale:[1,1,1]}}))};
  }
  function normalizeAuthorConfig(raw){
    const src=raw&&typeof raw==='object'?raw:{}, layers=Array.isArray(src.layers)?src.layers:[];
    return {schema:'hobunji_western_slope_mountain_backdrops.v1',enabled:src.enabled!==false,layers:ASSET_URLS.map((asset,i)=>{
      const layer=layers[i]&&typeof layers[i]==='object'?layers[i]:{}, t=layer.transform&&typeof layer.transform==='object'?layer.transform:{};
      const rotationDeg=vector(t.rotationDeg,[0,0,0]); // New rock rows already stand upright; no PNG-facing rotation is needed.
      if(rotationDeg[0]===0&&rotationDeg[1]===90&&rotationDeg[2]===0)rotationDeg[1]=0; // Migrate the old untouched PNG default so saved author settings do not turn rocks sideways.
      return {layer:i+1,asset,visible:layer.visible!==false,transform:{position:vector(t.position,[null,null,null],{allowNull:true}),rotationDeg,scale:vector(t.scale,[1,1,1],{positive:true})}};
    })};
  }
  function readAuthorConfig(){try{const raw=window.localStorage?.getItem?.(AUTHOR_STORAGE_KEY);return normalizeAuthorConfig(raw?JSON.parse(raw):null);}catch(error){log('author override read failed: '+(error?.message||error),'warn');return defaultAuthorConfig();}}
  function saveAuthorConfig(config){const normalized=normalizeAuthorConfig(config);try{window.localStorage?.setItem?.(AUTHOR_STORAGE_KEY,JSON.stringify(normalized));}catch(error){log('author override save failed: '+(error?.message||error),'warn');}return normalized;}
  function clearAuthorConfig(){try{window.localStorage?.removeItem?.(AUTHOR_STORAGE_KEY);}catch(_){}return defaultAuthorConfig();}
  function sourceSize(size){return{width:Math.max(1,Number(size?.width)||1),height:Math.max(1,Number(size?.height)||1)};}
  function sharedScale(sizes,span){
    const minW=span*MIN_WIDTH_MULTIPLIER,minH=span*MIN_HEIGHT_MULTIPLIER;let scale=0;
    for(const raw of sizes){const s=sourceSize(raw);scale=Math.max(scale,minW/s.width,minH/s.height);}
    return Math.max(scale,.001);
  }
  function resolveLayoutFromSizes(rawSizes,cols,rows,config=null){
    const sizes=ASSET_URLS.map((_,i)=>sourceSize(rawSizes?.[i]||SOURCE_SIZES[i])),span=Math.max(1,Number(cols)||0,Number(rows)||0),pixelScale=sharedScale(sizes,span);
    const edge=Math.max(MIN_WEST_EDGE_OFFSET,span*WEST_EDGE_OFFSET_MULTIPLIER),gap=span*WEST_LAYER_GAP_MULTIPLIER,mapLength=Math.max(1,Number(rows)||span),targetLength=mapLength*RIDGE_LENGTH_MAP_MULTIPLIER,zCenter=mapLength*.5;
    const authored=normalizeAuthorConfig(config||readAuthorConfig());
    return sizes.map((s,i)=>{
      const width=s.width*pixelScale,height=s.height*pixelScale,layer=authored.layers[i],lengthScale=targetLength/Math.max(1e-5,width);
      const staggerOffset=i===1?targetLength*.5:0; // The second ridge shifts by one original map-edge length, half its new doubled length.
      const defaultPos=[-edge-span*WEST_STACK_SHIFT_MULTIPLIER-gap*i,height*.5,zCenter+staggerOffset],defaultRot=[0,0,0],defaultScale=[1,1,1];
      const position=defaultPos.map((v,a)=>finiteOr(layer?.transform?.position?.[a],v));
      const rotationDeg=defaultRot.map((v,a)=>finiteOr(layer?.transform?.rotationDeg?.[a],v));
      const scale=defaultScale.map((v,a)=>{const n=finiteOr(layer?.transform?.scale?.[a],v);return n>0?n:v;});
      return {index:i,layer:i+1,asset:ASSET_URLS[i],visible:authored.enabled!==false&&layer?.visible!==false,sourceWidth:s.width,sourceHeight:s.height,unitsPerPixel:pixelScale,width,height,targetLength,lengthScale,position,rotationDeg,scale,x:position[0],y:position[1],z:position[2]};
    });
  }
  function applyLayer(group,layer){
    if(!group||!layer)return;
    const T=window.THREE;
    group.visible=layer.visible!==false;
    group.position.set(...layer.position);
    group.rotation.set(T.MathUtils.degToRad(layer.rotationDeg[0]),T.MathUtils.degToRad(layer.rotationDeg[1]),T.MathUtils.degToRad(layer.rotationDeg[2]));
    const ridgeLocalDepth=Math.max(1e-5,Number(group.userData?.ridgeLocalDepth)||layer.width),lengthScale=layer.targetLength/ridgeLocalDepth;
    group.scale.set(layer.scale[0],layer.scale[1],lengthScale*layer.scale[2]);
    Object.assign(group.userData,{sourcePixelScale:layer.unitsPerPixel,sourceWidth:layer.sourceWidth,sourceHeight:layer.sourceHeight,baseWorldWidth:layer.width,baseWorldHeight:layer.height,targetWorldLength:layer.targetLength,ridgeLocalDepth,ridgeLengthScale:lengthScale,worldWidth:layer.targetLength*layer.scale[2],worldNorthSouthLength:layer.targetLength*layer.scale[2],worldHeight:layer.height*layer.scale[1],authoredPosition:[...layer.position],authoredRotationDeg:[...layer.rotationDeg],authoredScale:[...layer.scale],decorativeRockCount:ROCKS_PER_LAYER,snowCapped:true,visualOnly:true});
  }
  function applyAuthorConfigToGroup(group,cols,rows,config=null){
    if(!group)return[];
    const normalized=normalizeAuthorConfig(config||readAuthorConfig());
    const sizes=ASSET_URLS.map((_,i)=>{const layerGroup=group.children?.find?.(c=>Number(c?.userData?.layer)===i+1);return{width:layerGroup?.userData?.sourceWidth||SOURCE_SIZES[i].width,height:layerGroup?.userData?.sourceHeight||SOURCE_SIZES[i].height};});
    const layout=resolveLayoutFromSizes(sizes,cols,rows,normalized);group.visible=normalized.enabled!==false;Object.assign(group.userData,{authorConfig:normalized,decorativeRockRidges:true,rocksPerLayer:ROCKS_PER_LAYER});
    for(const layer of layout)applyLayer(group.children?.find?.(c=>Number(c?.userData?.layer)===layer.layer),layer);
    stats.lastLayout=layout.map(l=>{const layerGroup=group.children?.find?.(c=>Number(c?.userData?.layer)===l.layer),actualLengthScale=layerGroup?.userData?.ridgeLengthScale??l.lengthScale;return{layer:l.layer,asset:l.asset,visible:l.visible,sourceWidth:l.sourceWidth,sourceHeight:l.sourceHeight,position:[...l.position],rotationDeg:[...l.rotationDeg],scale:[...l.scale],width:l.width,height:l.height,worldWidth:l.targetLength*l.scale[2],worldNorthSouthLength:l.targetLength*l.scale[2],worldHeight:l.height*l.scale[1],targetLength:l.targetLength,ridgeLocalDepth:layerGroup?.userData?.ridgeLocalDepth??null,lengthScale:actualLengthScale,unitsPerPixel:l.unitsPerPixel,rocks:ROCKS_PER_LAYER,snowCapped:true};});
    return layout;
  }

  function disposeRecord(record){
    if(!record||record.disposed)return false;
    record.disposed=true;record.cancelled=true;
    if(record.root?.parent)record.root.parent.remove(record.root);
    if(Array.isArray(record.scene?.items)){const i=record.scene.items.indexOf(record.root);if(i>=0)record.scene.items.splice(i,1);}
    for(const mesh of record.meshes||[])mesh.geometry?.dispose?.();
    for(const material of record.materials||[])material?.dispose?.(); // Cloned ridge materials are owned here; their mine texture maps remain shared.
    for(const texture of record.textures||[])texture?.dispose?.();
    if(activeByMap.get(record.mapId)===record)activeByMap.delete(record.mapId);
    stats.disposedBuilds++;
    return true;
  }
  function detach(mapId=WESTERN_SLOPE_ID){return disposeRecord(activeByMap.get(mapId));}
  function keepInFrontOfSky(material){
    // Preserve normal depth testing against terrain while keeping distant scenery ahead of sky masks.
    material.userData ||= {};
    material.userData.backgroundMaxDepthNdc=BACKGROUND_MAX_DEPTH_NDC;
    material.onBeforeCompile=shader=>{
      shader.uniforms.uBackgroundMaxDepth={value:BACKGROUND_MAX_DEPTH_NDC};
      shader.vertexShader='uniform float uBackgroundMaxDepth;\n'+shader.vertexShader.replace(/}\s*$/,'gl_Position.z = min(gl_Position.z, gl_Position.w * uBackgroundMaxDepth);\n}');
    };
    material.customProgramCacheKey=()=>'hobunji-background-layer-depth-v1';
  }
  function createBackdropMaterial(record){
    const T=window.THREE;
    const mineMaterial=window.OreRockTextures?.materialFor?.(T,'stone',{});
    const material=mineMaterial?.clone?.()||new T.MeshStandardMaterial({map:mineMaterial?.map||null,color:mineMaterial?.color||0x635544,roughness:mineMaterial?.roughness??0.94});
    material.userData=Object.assign({},material.userData,{westernSlopeMineRockBackdrop:true,visualOnly:true});
    delete material.userData.sharedOreRockMaterial;
    material.depthTest=true;
    material.depthWrite=false;
    material.fog=false;
    keepInFrontOfSky(material);
    record.materials.push(material);
    return material;
  }
  function appendUniqueVertex(output,vertex){
    const last=output[output.length-1];
    if(!last||Math.abs(last.x-vertex.x)>1e-6||Math.abs(last.y-vertex.y)>1e-6||Math.abs(last.z-vertex.z)>1e-6)output.push(vertex);
  }
  function interpolateAtHeight(a,b,height){
    const t=Math.max(0,Math.min(1,(height-a.y)/(b.y-a.y)));
    return{x:a.x+(b.x-a.x)*t,y:height,z:a.z+(b.z-a.z)*t,u:a.u+(b.u-a.u)*t,v:a.v+(b.v-a.v)*t};
  }
  function clipPolygonAtHeight(vertices,height,keepAbove){
    const clipped=[];
    for(let i=0;i<vertices.length;i++){
      const a=vertices[i],b=vertices[(i+1)%vertices.length];
      const insideA=keepAbove?a.y>=height:a.y<=height,insideB=keepAbove?b.y>=height:b.y<=height;
      if(insideA)appendUniqueVertex(clipped,a);
      if(insideA!==insideB)appendUniqueVertex(clipped,interpolateAtHeight(a,b,height));
    }
    if(clipped.length>1){
      const first=clipped[0],last=clipped[clipped.length-1];
      if(Math.abs(first.x-last.x)<1e-6&&Math.abs(first.y-last.y)<1e-6&&Math.abs(first.z-last.z)<1e-6)clipped.pop();
    }
    return clipped;
  }
  function appendPolygonTriangles(polygon,positions,uvs){
    for(let i=1;i<polygon.length-1;i++)for(const vertex of [polygon[0],polygon[i],polygon[i+1]]){
      positions.push(vertex.x,vertex.y,vertex.z);uvs.push(vertex.u,vertex.v);
    }
  }
  function makeSplitGeometry(positions,uvs,label){
    if(positions.length<9)return null;
    const T=window.THREE,geometry=new T.BufferGeometry();
    geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    geometry.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
    geometry.computeVertexNormals?.();
    geometry.userData=Object.assign({},geometry.userData,{westernSlopeSnowCapSplit:label});
    return geometry;
  }
  function stretchSnowCapUv(geometry){
    const T=window.THREE,pos=geometry?.getAttribute?.('position');if(!pos)return false;
    let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
    for(let i=0;i<pos.count;i++){
      const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
      minX=Math.min(minX,x);minY=Math.min(minY,y);minZ=Math.min(minZ,z);
      maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);maxZ=Math.max(maxZ,z);
    }
    const useX=(maxX-minX)>=(maxZ-minZ),span=Math.max(1e-5,useX?maxX-minX:maxZ-minZ),height=Math.max(1e-5,maxY-minY),uvs=new Float32Array(pos.count*2);
    for(let i=0;i<pos.count;i++){
      uvs[i*2]=(useX?pos.getX(i)-minX:pos.getZ(i)-minZ)/span;
      uvs[i*2+1]=(pos.getY(i)-minY)/height;
    }
    geometry.setAttribute('uv',new T.BufferAttribute(uvs,2));
    geometry.userData=Object.assign({},geometry.userData,{naturalSurfaceUvMapping:'planar-stretch',westernSlopeSnowCapStretch:'farm-cliff-planar-stretch'});
    return true;
  }
  function splitRockGeometryAtSnowLine(sourceGeometry){
    const pos=sourceGeometry?.getAttribute?.('position');if(!pos)throw new Error('mine-rock position attribute missing');
    const uv=sourceGeometry.getAttribute?.('uv'),index=sourceGeometry.index,triangleCount=index?index.count:pos.count;
    const getIndex=i=>index?(index.getX?index.getX(i):index.array[i]):i;
    let minY=Infinity,maxY=-Infinity;
    for(let i=0;i<triangleCount;i++){const y=pos.getY(getIndex(i));minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
    const height=maxY-minY;if(!(height>1e-5))throw new Error('mine-rock height is too small for a snow cap');
    const cutY=minY+height*(1-SNOW_CAP_HEIGHT_FRACTION);
    const stonePositions=[],stoneUvs=[],snowPositions=[],snowUvs=[],outlinePositions=[],seenSegments=new Set();
    const vertexAt=i=>({x:pos.getX(i),y:pos.getY(i),z:pos.getZ(i),u:uv?.getX?.(i)||0,v:uv?.getY?.(i)||0});
    const pointKey=p=>`${Math.round(p.x*100000)},${Math.round(p.y*100000)},${Math.round(p.z*100000)}`;
    for(let offset=0;offset+2<triangleCount;offset+=3){
      const triangle=[vertexAt(getIndex(offset)),vertexAt(getIndex(offset+1)),vertexAt(getIndex(offset+2))];
      appendPolygonTriangles(clipPolygonAtHeight(triangle,cutY,false),stonePositions,stoneUvs);
      appendPolygonTriangles(clipPolygonAtHeight(triangle,cutY,true),snowPositions,snowUvs);
      const crossings=[];
      for(let edge=0;edge<3;edge++){
        const a=triangle[edge],b=triangle[(edge+1)%3];
        if((a.y<cutY&&b.y>=cutY)||(b.y<cutY&&a.y>=cutY))appendUniqueVertex(crossings,interpolateAtHeight(a,b,cutY));
        else if(Math.abs(a.y-cutY)<1e-6&&Math.abs(b.y-cutY)<1e-6){
          appendUniqueVertex(crossings,a);appendUniqueVertex(crossings,b);
        }
      }
      if(crossings.length===2){
        const key=[pointKey(crossings[0]),pointKey(crossings[1])].sort().join('|');
        if(!seenSegments.has(key)){
          seenSegments.add(key);
          for(const point of crossings)outlinePositions.push(point.x,point.y+SNOW_BOUNDARY_LIFT,point.z);
        }
      }
    }
    const stoneGeo=makeSplitGeometry(stonePositions,stoneUvs,'stone-base'),snowGeo=makeSplitGeometry(snowPositions,snowUvs,'snow-cap');
    if(!stoneGeo||!snowGeo){
      stoneGeo?.dispose?.();snowGeo?.dispose?.();
      throw new Error('mine-rock split did not produce both stone base and snow cap');
    }
    stretchSnowCapUv(snowGeo);
    return{stoneGeo,snowGeo,outlinePositions,cutY,minY,maxY};
  }
  function createSnowCapMaterial(record){
    const T=window.THREE,shared=window.EnvironmentSurfaceMicroPlateau?.getSnowMaterial?.();
    if(shared){
      shared.userData=Object.assign({},shared.userData,{westernSlopeSnowCapMaterial:true});
      keepInFrontOfSky(shared);
      shared.needsUpdate=true;
      stats.snowTextureState=window.EnvironmentSurfaceMicroPlateau?.debugSnapshot?.().textureState||'shared-environment-snow';
      return shared;
    }
    const material=new T.MeshBasicMaterial({color:0xffffff,map:null,side:T.DoubleSide,transparent:false,opacity:1,depthTest:true,depthWrite:true,fog:true});
    material.userData=Object.assign({},material.userData,{westernSlopeSnowCapMaterial:true,visualOnly:true});
    keepInFrontOfSky(material);record.materials.push(material);
    if(typeof T.TextureLoader==='function'){
      try{
        const texture=new T.TextureLoader().load(SNOW_TEXTURE_URL,loaded=>{
          let finalTexture=loaded;
          try{
            const tinted=window.getShadeFillCanvas?.(loaded?.image,'western-slope-snow-cap|canvas.png|white',{
              mode:'shadeFill',rgb:[255,255,255],options:window.getPortraitTintingConfig?.()||{}
            });
            if(tinted)finalTexture=new T.CanvasTexture(tinted);
          }catch(_){}
          finalTexture.wrapS=finalTexture.wrapT=T.RepeatWrapping;
          finalTexture.minFilter=T.LinearFilter;finalTexture.magFilter=T.LinearFilter;
          finalTexture.generateMipmaps=false;finalTexture.needsUpdate=true;
          material.map=finalTexture;material.needsUpdate=true;
          if(finalTexture!==loaded)record.textures.push(finalTexture);
          stats.snowTextureState='loaded';
        },undefined,error=>{
          stats.snowTextureState='load-failed:'+String(error?.message||'unknown');
          stats.failedTextures++;log('snow-cap texture failed: '+stats.snowTextureState,'warn');
        });
        record.textures.push(texture);stats.snowTextureState='loading';
      }catch(error){
        stats.snowTextureState='load-failed:'+String(error?.message||error);
        stats.failedTextures++;log('snow-cap texture failed: '+stats.snowTextureState,'warn');
      }
    }
    return material;
  }
  function createSnowBoundaryMaterial(record){
    const T=window.THREE,material=new T.LineBasicMaterial({color:0x514b42,transparent:false,opacity:1,depthTest:true,depthWrite:false,fog:false});
    material.userData=Object.assign({},material.userData,{westernSlopeSnowBoundary:true,visualOnly:true});
    keepInFrontOfSky(material);record.materials.push(material);return material;
  }
  function addRockRidge(layer,layerGroup,record,snowMaterial,boundaryMaterial){
    const T=window.THREE,geometryApi=window.TerrainGeometry;
    if(typeof geometryApi?.buildRockTileGeo!=='function')throw new Error('TerrainGeometry.buildRockTileGeo unavailable');
    const stoneMaterial=createBackdropMaterial(record),cellWidth=layer.width/ROCKS_PER_LAYER,heightScale=layer.height/ROCK_HEIGHT_FRACTION;
    for(let i=0;i<ROCKS_PER_LAYER;i++){
      const seedCol=ROCK_SEED_BASE+layer.index*101+i*17,seedRow=ROCK_SEED_BASE*3+layer.index*67+i*29;
      const built=geometryApi.buildRockTileGeo(seedCol,seedRow),sourceGeometry=built?.stoneGeo;
      if(!sourceGeometry)throw new Error('mine-rock geometry missing for ridge '+layer.layer+', rock '+(i+1));
      const split=splitRockGeometryAtSnowLine(sourceGeometry);sourceGeometry.dispose?.();
      const rock=new T.Group(),stoneMesh=new T.Mesh(split.stoneGeo,stoneMaterial),snowMesh=new T.Mesh(split.snowGeo,snowMaterial);
      const variation=(Math.sin((i+1)*(layer.layer+2)*1.73)+1)*.5;
      const stagger=((i*7+layer.layer*3)%5-2)*cellWidth*.035;
      const heightJitter=((i*5+layer.layer)%3-1)*layer.height*.008;
      const rockName=GROUP_NAME+'_Layer'+layer.layer+'_Rock'+(i+1);
      rock.name=rockName;rock.position.set(stagger,-layer.height*.5+heightJitter,-layer.width*.5+cellWidth*(i+.5));
      const rotationY=((i*11+layer.layer*7)%7-3)*.055;
      rock.rotation.y=rotationY;
      rock.scale.set(cellWidth*(.74+variation*.12),heightScale*(.84+variation*.24),cellWidth*(1.08+variation*.04));
      const sourcePosition=sourceGeometry.getAttribute('position'),sourceIndex=sourceGeometry.index,vertexCount=sourceIndex?sourceIndex.count:sourcePosition.count;
      for(let vertex=0;vertex<vertexCount;vertex++){
        const vertexIndex=sourceIndex?(sourceIndex.getX?sourceIndex.getX(vertex):sourceIndex.array[vertex]):vertex;
        const localX=sourcePosition.getX(vertexIndex)*rock.scale.x,localZ=sourcePosition.getZ(vertexIndex)*rock.scale.z;
        const rotatedZ=rock.position.z-Math.sin(rotationY)*localX+Math.cos(rotationY)*localZ;
        layerGroup.userData.ridgeMinZ=Math.min(Number(layerGroup.userData.ridgeMinZ??Infinity),rotatedZ);
        layerGroup.userData.ridgeMaxZ=Math.max(Number(layerGroup.userData.ridgeMaxZ??-Infinity),rotatedZ);
      }
      layerGroup.userData.ridgeLocalDepth=layerGroup.userData.ridgeMaxZ-layerGroup.userData.ridgeMinZ;
      rock.userData={backgroundScenery:true,skipOcclusionFade:true,westernSlopeMineRockBackdrop:true,westernSlopeSnowCapped:true,visualOnly:true,layer:layer.layer,rockIndex:i+1,snowLineLocalY:split.cutY,snowCoverageHeightFraction:SNOW_CAP_HEIGHT_FRACTION};
      for(const [mesh,suffix] of [[stoneMesh,'_Stone'],[snowMesh,'_Snow']]){
        mesh.name=rockName+suffix;mesh.castShadow=false;mesh.receiveShadow=false;mesh.raycast=ignoreRaycast;
        mesh.frustumCulled=false;mesh.renderOrder=-101-layer.index+(suffix==='_Snow' ? 0.01 : 0);
        mesh.userData={backgroundScenery:true,skipOcclusionFade:true,westernSlopeMineRockBackdrop:true,visualOnly:true,layer:layer.layer,rockIndex:i+1,surfacePart:suffix.slice(1).toLowerCase()};
        rock.add(mesh);record.meshes.push(mesh);
      }
      window.OreRockTextures?.fitRockMesh?.(stoneMesh);
      if(T.LineSegments&&split.outlinePositions.length){
        const lineGeometry=new T.BufferGeometry();
        lineGeometry.setAttribute('position',new T.Float32BufferAttribute(split.outlinePositions,3));
        lineGeometry.computeBoundingSphere?.();
        const line=new T.LineSegments(lineGeometry,boundaryMaterial);
        line.name=rockName+'_SnowBoundary';line.raycast=ignoreRaycast;line.frustumCulled=false;
        line.renderOrder=-100.8-layer.index;
        line.userData={backgroundScenery:true,skipOcclusionFade:true,westernSlopeSnowBoundary:true,visualOnly:true,layer:layer.layer,rockIndex:i+1};
        rock.add(line);record.meshes.push(line);stats.snowBoundaryLinesBuilt++;
      }
      layerGroup.add(rock);stats.snowCapsBuilt++;
    }
  }
  function attach(scene,cols,rows,mapId=WESTERN_SLOPE_ID,options=null){
    if(mapId!==WESTERN_SLOPE_ID||!scene)return Promise.resolve(null);
    const config=normalizeAuthorConfig(options?.config||readAuthorConfig()),existing=scene.getObjectByName?.(GROUP_NAME)||(scene.children||[]).find(c=>c?.name===GROUP_NAME);
    if(existing){applyAuthorConfigToGroup(existing,cols,rows,config);return Promise.resolve(existing);}
    const previous=activeByMap.get(mapId);
    if(previous?.scene===scene&&!previous.cancelled)return previous.promise||Promise.resolve(previous.root||null);
    if(previous)disposeRecord(previous);
    const record={mapId,scene,root:null,meshes:[],materials:[],textures:[],cancelled:false,disposed:false,promise:null}; // Owns geometry and cloned materials for one map's decorative ridges.
    activeByMap.set(mapId,record);stats.buildRequests++;
    try{
      const T=window.THREE,layout=resolveLayoutFromSizes(SOURCE_SIZES,cols,rows,config),root=new T.Group(),snowMaterial=createSnowCapMaterial(record),snowBoundaryMaterial=createSnowBoundaryMaterial(record);
      root.name=GROUP_NAME;
      root.visible=config.enabled!==false;
      Object.assign(root.userData,{backgroundScenery:true,skipOcclusionFade:true,westernSlopeMountainBackdrops:true,decorativeRockRidges:true,snowCappedRockRidges:true,visualOnly:true,mapId,rocksPerLayer:ROCKS_PER_LAYER,authorConfig:config});
      for(const layer of layout){
        const layerGroup=new T.Group();
        layerGroup.name=GROUP_NAME+'_Layer'+layer.layer;
        Object.assign(layerGroup.userData,{layer:layer.layer,sourceWidth:layer.sourceWidth,sourceHeight:layer.sourceHeight,decorativeRockRidge:true,visualOnly:true});
        applyLayer(layerGroup,layer);
        addRockRidge(layer,layerGroup,record,snowMaterial,snowBoundaryMaterial);
        root.add(layerGroup);
      }
      record.root=root;
      scene.add(root);
      if(Array.isArray(scene.items)&&!scene.items.includes(root))scene.items.push(root);
      stats.completedBuilds++;
      applyAuthorConfigToGroup(root,cols,rows,config);
      log('attached '+layout.length+' Western Slope snow-capped rock ridges ('+(layout.length*ROCKS_PER_LAYER)+' decorative rocks, '+(Math.max(1,Number(rows)||1)*RIDGE_LENGTH_MAP_MULTIPLIER).toFixed(1)+'u north-south length each); west X='+layout.map(l=>l.position[0].toFixed(1)).join(', '));
      record.promise=Promise.resolve(root);
    }catch(error){
      stats.lastError=error?.message||String(error);
      stats.failedBuilds++;
      log('build failed: '+stats.lastError,'warn');
      disposeRecord(record);
    }
    return record.promise||Promise.resolve(null);
  }

  function patchBorder(api){
    if(!api||patchedBorderApis.has(api)||typeof api.buildZoneBorderTerrain!=='function')return api;
    const original=api.buildZoneBorderTerrain;
    api.buildZoneBorderTerrain=function(scene,cols,rows,mapId,...rest){const result=original.call(this,scene,cols,rows,mapId,...rest);if(mapId===WESTERN_SLOPE_ID)attach(scene,cols,rows,mapId);return result;};
    patchedBorderApis.add(api);stats.borderHookInstalls++;return api;
  }
  function patchChunks(api){
    if(!api||patchedChunkApis.has(api)||typeof api.destroyZone!=='function')return api;
    const original=api.destroyZone;
    api.destroyZone=function(mapId,...rest){if(mapId===WESTERN_SLOPE_ID)detach(mapId);return original.call(this,mapId,...rest);};
    patchedChunkApis.add(api);stats.chunkHookInstalls++;return api;
  }
  function deferred(name,patcher){
    const d=Object.getOwnPropertyDescriptor(window,name);
    if(d?.get&&d?.set){const get=d.get,set=d.set;Object.defineProperty(window,name,{configurable:true,enumerable:d.enumerable!==false,get(){return get.call(window);},set(value){set.call(window,value);patcher(get.call(window));}});patcher(get.call(window));return;}
    const existing=window[name];if(existing){patcher(existing);return;}
    let pending=null;
    Object.defineProperty(window,name,{configurable:true,enumerable:true,get(){return pending;},set(value){pending=patcher(value);}});
  }
  function debug(){
    const active=activeByMap.get(WESTERN_SLOPE_ID);
    return {installed:true,distantBackgroundsInFrontOfSky:true,backgroundMaxDepthNdc:BACKGROUND_MAX_DEPTH_NDC,mapId:WESTERN_SLOPE_ID,groupName:GROUP_NAME,authorStorageKey:AUTHOR_STORAGE_KEY,assetUrls:[...ASSET_URLS],rocksPerLayer:ROCKS_PER_LAYER,totalDecorativeRocks:ROCKS_PER_LAYER*ASSET_URLS.length,ridgeLengthMapMultiplier:RIDGE_LENGTH_MAP_MULTIPLIER,snowCapHeightFraction:SNOW_CAP_HEIGHT_FRACTION,visualOnly:true,active:!!active&&!active.cancelled,attached:!!active?.root?.parent,loading:!!active&&!active.root&&!active.cancelled,sceneChildren:active?.scene?.children?.length??null,...stats,lastLayout:stats.lastLayout?stats.lastLayout.map(l=>({...l,position:[...l.position],rotationDeg:[...l.rotationDeg],scale:[...l.scale]})):null};
  }

  window.WesternSlopeMountainBackdrops=Object.freeze({installed:true,attach,detach,getDebugState:debug,defaultAuthorConfig,normalizeAuthorConfig,readAuthorConfig,saveAuthorConfig,clearAuthorConfig,resolveLayoutFromSizes,applyAuthorConfigToGroup,constants:Object.freeze({WESTERN_SLOPE_ID,GROUP_NAME,AUTHOR_STORAGE_KEY,ASSET_URLS,ROCKS_PER_LAYER,MIN_WIDTH_MULTIPLIER,MIN_HEIGHT_MULTIPLIER,WEST_EDGE_OFFSET_MULTIPLIER,WEST_LAYER_GAP_MULTIPLIER,WEST_STACK_SHIFT_MULTIPLIER,RIDGE_LENGTH_MAP_MULTIPLIER,SNOW_CAP_HEIGHT_FRACTION})});
  window.__westernSlopeMountainBackdropsDebug=debug;
  deferred('BorderTerrain',patchBorder);
  deferred('WildernessChunks',patchChunks);
})();
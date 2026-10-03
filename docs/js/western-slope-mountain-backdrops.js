(() => {
  'use strict';

  const WESTERN_SLOPE_ID = 'map_western_slope'; // Used to scope the stack and author overrides to Western Slope.
  const GROUP_NAME = 'WesternSlopeMountainBackdrops'; // Used for scene duplicate detection and editor lookup.
  const AUTHOR_STORAGE_KEY = 'hobunjiWesternSlopeMountainBackdrops.v1'; // Used by the background author and live runtime on the same browser.
  const ASSET_URLS = Object.freeze(['assets/backdrops/bd_mountains_1.png','assets/backdrops/bd_mountains_2.png','assets/backdrops/bd_mountains_3.png']); // Near-to-far authored PNGs.
  const MIN_WIDTH_MULTIPLIER = 2.75; // Used to keep every layer wider than the wilderness.
  const MIN_HEIGHT_MULTIPLIER = 1.6; // Used to keep every layer taller than the wilderness.
  const WEST_EDGE_OFFSET_MULTIPLIER = 0.12; // Used for the near layer's offset beyond the west edge.
  const WEST_LAYER_GAP_MULTIPLIER = 0.85; // Used for equal deep spacing between layers.
  const MIN_WEST_EDGE_OFFSET = 24; // Used so small/test maps still clear border terrain.
  const patchedBorderApis = new WeakSet(); // Used to wrap each BorderTerrain API once.
  const patchedChunkApis = new WeakSet(); // Used to wrap each WildernessChunks API once.
  const activeByMap = new Map(); // Used to own one async backdrop record per map lifecycle.
  const stats = { borderHookInstalls:0, chunkHookInstalls:0, buildRequests:0, completedBuilds:0, disposedBuilds:0, failedTextures:0, failedBuilds:0, lastError:null, lastLayout:null }; // Mobile/debug counters.

  function log(message, level='info') {
    const text=`[western-slope-backdrops] ${message}`;
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
    return {schema:'hobunji_western_slope_mountain_backdrops.v1',enabled:true,layers:ASSET_URLS.map((asset,i)=>({layer:i+1,asset,visible:true,transform:{position:[null,null,null],rotationDeg:[0,90,0],scale:[1,1,1]}}))};
  }
  function normalizeAuthorConfig(raw){
    const src=raw&&typeof raw==='object'?raw:{}, layers=Array.isArray(src.layers)?src.layers:[];
    return {schema:'hobunji_western_slope_mountain_backdrops.v1',enabled:src.enabled!==false,layers:ASSET_URLS.map((asset,i)=>{
      const layer=layers[i]&&typeof layers[i]==='object'?layers[i]:{}, t=layer.transform&&typeof layer.transform==='object'?layer.transform:{};
      return {layer:i+1,asset,visible:layer.visible!==false,transform:{position:vector(t.position,[null,null,null],{allowNull:true}),rotationDeg:vector(t.rotationDeg,[0,90,0]),scale:vector(t.scale,[1,1,1],{positive:true})}};
    })};
  }
  function readAuthorConfig(){try{const raw=window.localStorage?.getItem?.(AUTHOR_STORAGE_KEY);return normalizeAuthorConfig(raw?JSON.parse(raw):null);}catch(error){log(`author override read failed: ${error?.message||error}`,'warn');return defaultAuthorConfig();}}
  function saveAuthorConfig(config){const normalized=normalizeAuthorConfig(config);try{window.localStorage?.setItem?.(AUTHOR_STORAGE_KEY,JSON.stringify(normalized));}catch(error){log(`author override save failed: ${error?.message||error}`,'warn');}return normalized;}
  function clearAuthorConfig(){try{window.localStorage?.removeItem?.(AUTHOR_STORAGE_KEY);}catch(_){}return defaultAuthorConfig();}
  function imageSize(texture){const image=texture?.image||{};return{width:Math.max(1,Number(image.naturalWidth||image.videoWidth||image.width)||1),height:Math.max(1,Number(image.naturalHeight||image.videoHeight||image.height)||1)};}
  function sourceSize(size){return{width:Math.max(1,Number(size?.width)||1),height:Math.max(1,Number(size?.height)||1)};}
  function sharedScale(sizes,span){
    const minW=span*MIN_WIDTH_MULTIPLIER,minH=span*MIN_HEIGHT_MULTIPLIER;let scale=0;
    for(const raw of sizes){const s=sourceSize(raw);scale=Math.max(scale,minW/s.width,minH/s.height);}
    return Math.max(scale,.001);
  }
  function resolveLayoutFromSizes(rawSizes,cols,rows,config=null){
    const sizes=ASSET_URLS.map((_,i)=>sourceSize(rawSizes?.[i])), span=Math.max(1,Number(cols)||0,Number(rows)||0), pixelScale=sharedScale(sizes,span);
    const edge=Math.max(MIN_WEST_EDGE_OFFSET,span*WEST_EDGE_OFFSET_MULTIPLIER),gap=span*WEST_LAYER_GAP_MULTIPLIER,zCenter=Math.max(0,Number(rows)||0)*.5;
    const authored=normalizeAuthorConfig(config||readAuthorConfig());
    return sizes.map((s,i)=>{
      const width=s.width*pixelScale,height=s.height*pixelScale, layer=authored.layers[i];
      const defaultPos=[-edge-gap*i,height*.5,zCenter], defaultRot=[0,90,0], defaultScale=[1,1,1];
      const position=defaultPos.map((v,a)=>finiteOr(layer?.transform?.position?.[a],v));
      const rotationDeg=defaultRot.map((v,a)=>finiteOr(layer?.transform?.rotationDeg?.[a],v));
      const scale=defaultScale.map((v,a)=>{const n=finiteOr(layer?.transform?.scale?.[a],v);return n>0?n:v;});
      return {index:i,layer:i+1,asset:ASSET_URLS[i],visible:authored.enabled!==false&&layer?.visible!==false,sourceWidth:s.width,sourceHeight:s.height,unitsPerPixel:pixelScale,width,height,position,rotationDeg,scale,x:position[0],y:position[1],z:position[2]};
    });
  }
  function layoutFromTextures(textures,cols,rows,config){return resolveLayoutFromSizes(textures.map(imageSize),cols,rows,config);}
  function applyLayer(mesh,layer){
    if(!mesh||!layer)return;const T=window.THREE;
    mesh.visible=layer.visible!==false;mesh.position.set(...layer.position);
    mesh.rotation.set(T.MathUtils.degToRad(layer.rotationDeg[0]),T.MathUtils.degToRad(layer.rotationDeg[1]),T.MathUtils.degToRad(layer.rotationDeg[2]));
    mesh.scale.set(...layer.scale);
    Object.assign(mesh.userData,{sourcePixelScale:layer.unitsPerPixel,sourceWidth:layer.sourceWidth,sourceHeight:layer.sourceHeight,baseWorldWidth:layer.width,baseWorldHeight:layer.height,worldWidth:layer.width*layer.scale[0],worldHeight:layer.height*layer.scale[1],authoredPosition:[...layer.position],authoredRotationDeg:[...layer.rotationDeg],authoredScale:[...layer.scale]});
  }
  function applyAuthorConfigToGroup(group,cols,rows,config=null){
    if(!group)return[];const normalized=normalizeAuthorConfig(config||readAuthorConfig());
    const sizes=ASSET_URLS.map((_,i)=>{const mesh=group.children?.find?.(c=>Number(c?.userData?.layer)===i+1);return{width:mesh?.userData?.sourceWidth||1,height:mesh?.userData?.sourceHeight||1};});
    const layout=resolveLayoutFromSizes(sizes,cols,rows,normalized);group.visible=normalized.enabled!==false;Object.assign(group.userData,{authorConfig:normalized});
    for(const layer of layout)applyLayer(group.children?.find?.(c=>Number(c?.userData?.layer)===layer.layer),layer);
    stats.lastLayout=layout.map(l=>({layer:l.layer,asset:l.asset,visible:l.visible,sourceWidth:l.sourceWidth,sourceHeight:l.sourceHeight,position:[...l.position],rotationDeg:[...l.rotationDeg],scale:[...l.scale],width:l.width,height:l.height,worldWidth:l.width*l.scale[0],worldHeight:l.height*l.scale[1],unitsPerPixel:l.unitsPerPixel}));
    return layout;
  }

  function disposeRecord(record){
    if(!record||record.disposed)return false;record.disposed=true;record.cancelled=true;if(record.root?.parent)record.root.parent.remove(record.root);
    if(Array.isArray(record.scene?.items)){const i=record.scene.items.indexOf(record.root);if(i>=0)record.scene.items.splice(i,1);}
    for(const mesh of record.meshes||[]){mesh.geometry?.dispose?.();const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material];for(const m of mats)m?.dispose?.();}
    for(const texture of record.textures||[])texture?.dispose?.();if(activeByMap.get(record.mapId)===record)activeByMap.delete(record.mapId);stats.disposedBuilds++;return true;
  }
  function detach(mapId=WESTERN_SLOPE_ID){return disposeRecord(activeByMap.get(mapId));}
  function assetUrl(asset,base=''){if(!base||/^(?:https?:|data:|blob:|\/)/i.test(asset))return asset;return String(base).replace(/\/?$/,'/')+String(asset).replace(/^\/+/,'');}
  function loadTexture(url,record){
    return new Promise((resolve,reject)=>{const T=window.THREE;if(!T?.TextureLoader){reject(new Error('THREE.TextureLoader unavailable'));return;}
      new T.TextureLoader().load(url,texture=>{texture.userData=Object.assign({},texture.userData,{westernSlopeMountainBackdropAsset:url});texture.needsUpdate=true;if(record?.cancelled){texture.dispose?.();resolve(texture);return;}record.textures.push(texture);resolve(texture);},undefined,error=>{stats.failedTextures++;reject(error||new Error(`failed to load ${url}`));});
    });
  }
  function materialFor(texture){const T=window.THREE,m=new T.MeshBasicMaterial({map:texture,transparent:true,alphaTest:.01,depthTest:true,depthWrite:false,side:T.FrontSide,fog:false});if('toneMapped'in m)m.toneMapped=false;m.userData=Object.assign({},m.userData,{westernSlopeMountainBackdrop:true});return m;}
  function attach(scene,cols,rows,mapId=WESTERN_SLOPE_ID,options=null){
    if(mapId!==WESTERN_SLOPE_ID||!scene)return Promise.resolve(null);
    const config=normalizeAuthorConfig(options?.config||readAuthorConfig()),existing=scene.getObjectByName?.(GROUP_NAME)||(scene.children||[]).find(c=>c?.name===GROUP_NAME);
    if(existing){applyAuthorConfigToGroup(existing,cols,rows,config);return Promise.resolve(existing);}
    const previous=activeByMap.get(mapId);if(previous?.scene===scene&&!previous.cancelled)return previous.promise||Promise.resolve(previous.root||null);if(previous)disposeRecord(previous);
    const record={mapId,scene,root:null,meshes:[],textures:[],cancelled:false,disposed:false,promise:null}; // Async owner used to prevent stale loads from attaching after scene teardown.
    activeByMap.set(mapId,record);stats.buildRequests++;
    const urls=ASSET_URLS.map(a=>assetUrl(a,options?.assetBase||''));
    record.promise=Promise.all(urls.map(url=>loadTexture(url,record))).then(textures=>{
      if(record.cancelled||activeByMap.get(mapId)!==record){for(const t of textures)t?.dispose?.();return null;}
      const T=window.THREE,layout=layoutFromTextures(textures,cols,rows,config),root=new T.Group();root.name=GROUP_NAME;root.visible=config.enabled!==false;
      Object.assign(root.userData,{backgroundScenery:true,skipOcclusionFade:true,westernSlopeMountainBackdrops:true,mapId,sharedWorldUnitsPerPixel:layout[0]?.unitsPerPixel||0,authorConfig:config});
      for(const layer of layout){const mesh=new T.Mesh(new T.PlaneGeometry(layer.width,layer.height),materialFor(textures[layer.index]));mesh.name=`${GROUP_NAME}_Layer${layer.layer}`;mesh.renderOrder=-101-layer.index;mesh.castShadow=false;mesh.receiveShadow=false;mesh.frustumCulled=true;Object.assign(mesh.userData,{backgroundScenery:true,skipOcclusionFade:true,westernSlopeMountainBackdrop:true,layer:layer.layer,sourceAsset:layer.asset,sourceWidth:layer.sourceWidth,sourceHeight:layer.sourceHeight});applyLayer(mesh,layer);root.add(mesh);record.meshes.push(mesh);}
      record.root=root;scene.add(root);if(Array.isArray(scene.items)&&!scene.items.includes(root))scene.items.push(root);stats.completedBuilds++;applyAuthorConfigToGroup(root,cols,rows,config);
      log(`attached 3 mountain layers to ${mapId}; west X=${layout.map(l=>l.position[0].toFixed(1)).join(', ')}; shared scale=${(layout[0]?.unitsPerPixel||0).toFixed(4)} world units/pixel`);return root;
    }).catch(error=>{stats.lastError=error?.message||String(error);stats.failedBuilds++;log(`build failed: ${stats.lastError}`,'warn');disposeRecord(record);return null;});
    return record.promise;
  }

  function patchBorder(api){
    if(!api||patchedBorderApis.has(api)||typeof api.buildZoneBorderTerrain!=='function')return api;const original=api.buildZoneBorderTerrain;
    api.buildZoneBorderTerrain=function(scene,cols,rows,mapId,...rest){const result=original.call(this,scene,cols,rows,mapId,...rest);if(mapId===WESTERN_SLOPE_ID)attach(scene,cols,rows,mapId);return result;};
    patchedBorderApis.add(api);stats.borderHookInstalls++;return api;
  }
  function patchChunks(api){
    if(!api||patchedChunkApis.has(api)||typeof api.destroyZone!=='function')return api;const original=api.destroyZone;
    api.destroyZone=function(mapId,...rest){if(mapId===WESTERN_SLOPE_ID)detach(mapId);return original.call(this,mapId,...rest);};
    patchedChunkApis.add(api);stats.chunkHookInstalls++;return api;
  }
  function deferred(name,patcher){
    const d=Object.getOwnPropertyDescriptor(window,name);
    if(d?.get&&d?.set){const get=d.get,set=d.set;Object.defineProperty(window,name,{configurable:true,enumerable:d.enumerable!==false,get(){return get.call(window);},set(value){set.call(window,value);patcher(get.call(window));}});patcher(get.call(window));return;}
    const existing=window[name];if(existing){patcher(existing);return;}let pending=null;Object.defineProperty(window,name,{configurable:true,enumerable:true,get(){return pending;},set(value){pending=patcher(value);}});
  }
  function debug(){
    const active=activeByMap.get(WESTERN_SLOPE_ID);
    return {installed:true,mapId:WESTERN_SLOPE_ID,groupName:GROUP_NAME,authorStorageKey:AUTHOR_STORAGE_KEY,assetUrls:[...ASSET_URLS],active:!!active&&!active.cancelled,attached:!!active?.root?.parent,loading:!!active&&!active.root&&!active.cancelled,sceneChildren:active?.scene?.children?.length??null,...stats,lastLayout:stats.lastLayout?stats.lastLayout.map(l=>({...l,position:[...l.position],rotationDeg:[...l.rotationDeg],scale:[...l.scale]})):null};
  }

  window.WesternSlopeMountainBackdrops=Object.freeze({installed:true,attach,detach,getDebugState:debug,defaultAuthorConfig,normalizeAuthorConfig,readAuthorConfig,saveAuthorConfig,clearAuthorConfig,resolveLayoutFromSizes,applyAuthorConfigToGroup,constants:Object.freeze({WESTERN_SLOPE_ID,GROUP_NAME,AUTHOR_STORAGE_KEY,ASSET_URLS,MIN_WIDTH_MULTIPLIER,MIN_HEIGHT_MULTIPLIER,WEST_EDGE_OFFSET_MULTIPLIER,WEST_LAYER_GAP_MULTIPLIER})});
  window.__westernSlopeMountainBackdropsDebug=debug;
  deferred('BorderTerrain',patchBorder);
  deferred('WildernessChunks',patchChunks);
})();

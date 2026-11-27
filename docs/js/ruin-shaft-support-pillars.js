// Square structural pillars under generated ruin shaft platforms.
// The original Furniture Author pillar_square is the source of the five stone parts;
// its shaft alone gains the IKMC ladder's vertical TileSpan roles per instance.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinShaftSupportPillars=api;
})(typeof self!=='undefined'?self:globalThis,function(root){
  'use strict';
  const SOURCE='assets/models/furniture/data/pillar_square.json'; // Canonical editable square pillar, loaded only when a jump shaft mounts.
  const PART={foot:'pillar_square_base0',rise:'pillar_square_base1',shaft:'pillar_square_shaft',
    neck:'pillar_square_collar',cap:'pillar_square_cap'}; // Existing authored parts assigned fixed/stretch roles in the runtime overlay.
  const WIDTH_SCALE=.75; // Slab supports use a slimmer version of the authored silhouette.
  let sourcePromise=null; // Reused across ruins so a large dungeon never fetches one template per platform.

  function footprintTiles(platform){
    const width=Number(platform?.w); // The platform's X width determines its even/odd tile footprint.
    const rounded=Math.max(1,Math.round(Number.isFinite(width)?width:1));
    return rounded%2===0?2:3;
  }
  function layout(platform,pitY,slabThickness){
    const footprint=footprintTiles(platform); // Used for both horizontal axes so the foot stays square.
    const height=Number(platform?.y)-Number(slabThickness)-Number(pitY); // Capital meets the underside, not the walkable top.
    if(!Number.isFinite(height)||height<=0||![platform?.x,platform?.z,pitY].every(Number.isFinite))return null;
    return {id:platform.id,x:platform.x,z:platform.z,bottomY:pitY,topY:platform.y-slabThickness,height,
      slabWidth:platform.w,slabDepth:platform.d,footprintTiles:footprint};
  }
  function recipeFromSquarePillar(source){
    const sourceParts=source?.parts;
    if(!Array.isArray(sourceParts))throw new Error('Square pillar furniture has no authored parts');
    const byId=new Map(sourceParts.map(part=>[part.id,part])); // Resolves the exact inherited base and capital anchor dimensions.
    if(Object.values(PART).some(id=>!byId.has(id)))throw new Error('Square pillar furniture is missing its base, shaft or capital');
    const foot=byId.get(PART.foot).transform,cap=byId.get(PART.cap).transform;
    const raised=byId.get(PART.rise).transform,neck=byId.get(PART.neck).transform;
    const shaftStart=Number(raised.y)+Number(raised.sy)/2,shaftEnd=Number(neck.y)-Number(neck.sy)/2; // True attachment faces, not the source shaft's slight decorative overlaps.
    const bottom=Number(foot.y)-Number(foot.sy)/2,top=Number(cap.y)+Number(cap.sy)/2;
    const baseHeight=top-bottom; // Native part span; do not assume edits to the Furniture Author preserve a hardcoded 1.75.
    if(!Number.isFinite(baseHeight)||baseHeight<=0||!(shaftEnd>shaftStart)||!(Number(foot.sx)>0&&Number(foot.sz)>0))
      throw new Error('Square pillar authored bounds are invalid');
    const parts=sourceParts.map(part=>{
      let role=part.id===PART.shaft?'stretch':
        [PART.foot,PART.rise].includes(part.id)?'start':'end';
      const overlay={...part,tileSpanRole:role}; // Never mutate the template used by ordinary architectural pillars.
      if(role==='stretch'){
        overlay.transform={...part.transform,y:(shaftStart+shaftEnd)/2,sy:shaftEnd-shaftStart}; // Exact end-to-end middle section: tall spans must not magnify source overlap into the slab.
        overlay.tileSpanRoots={
        start:{partId:PART.rise,face:'max'},end:{partId:PART.neck,face:'min'},
        }; // The shaft grows between the raised foot and the fixed neck/capital.
      }
      return overlay;
    });
    const data={schema:'hobunji_furniture_authored_runtime.v1',key:'pillar_square',id:'pillar_square',
      name:'Square Pillar — Shaft Platform Support',parts,
      tileSpan:{version:1,enabled:true,axis:'y',baseHeight,targetHeight:baseHeight,
        startTiles:1,middleTiles:1,endTiles:1,totalTiles:3,tileSize:1}};
    return {data,bottom,footWidth:Number(foot.sx),footDepth:Number(foot.sz)};
  }
  function widthsForPlatform(placement){
    const tiles=placement.footprintTiles; // Preserve even/odd sizing before narrowing the horizontal dimensions.
    const slabSpan=Math.max(.1,Math.min(placement.slabWidth,placement.slabDepth)); // Capital stays under even the narrowest slab.
    const capital=Math.min(tiles*.96,slabSpan*.92);
    return {
      [PART.foot]:tiles*WIDTH_SCALE,[PART.rise]:tiles*.82*WIDTH_SCALE,
      [PART.shaft]:Math.min(tiles*.64,capital*.76)*WIDTH_SCALE,
      [PART.neck]:Math.min(tiles*.76,capital*.86)*WIDTH_SCALE,
      [PART.cap]:capital*WIDTH_SCALE,
    };
  }
  function recipeForPlatform(profile,placement){
    const widths=widthsForPlatform(placement); // Shared by the authored pillar and its loading geometry.
    return {...profile.data,parts:profile.data.parts.map(part=>{
      const width=widths[part.id];
      return width?{...part,transform:{...part.transform,sx:width,sz:width}}:part;
    })}; // Only this placed instance is widened; the reusable Furniture Author recipe stays unchanged.
  }
  function loadSource(){
    if(!sourcePromise){
      if(!root.document||typeof root.fetch!=='function')return Promise.resolve(null); // Node logic tests must not fetch a relative URL.
      sourcePromise=Promise.resolve().then(()=>root.fetch(SOURCE+'?v=20261118shaftPillars1'))
        .then(response=>{if(!response.ok)throw new Error('HTTP '+response.status);return response.json();})
        .catch(error=>{sourcePromise=null;root.__farmLog?.('[ruin shaft] Square pillar source unavailable: '+error.message,'warn');return null;}); // A transient offline/404 response must not poison every subsequently generated ruin.
    }
    return sourcePromise;
  }
  function markVisualOnly(group){
    group.traverse?.(node=>{node.userData ||= {};node.userData.devRuinFootprintIgnore=true;});
    group.userData ||= {};group.userData.devRuinFootprintIgnore=true; // Structural visuals must not turn the pit into a standable floor or block jumps.
  }
  function stretchStoneFaces(mesh,retainSource=false){
    const source=mesh.geometry; // Authored parts retain their source geometry until TileSpan releases it.
    root.HobunjiSurfaceStretchUV?.mapMesh?.(mesh);
    if(!retainSource&&mesh.geometry!==source)source.dispose?.();
    mesh.layers?.disable(1); // The carved stone PNG already inks each face edge.
  }
  function disposeVisual(visual,authored,stone){
    if(!visual)return;
    const seen=new Set(); // Avoid double-freeing a material shared among one pillar's parts.
    visual.traverse?.(node=>{
      if(!node.geometry)return;
      if(authored)root.FurnitureTileSpan?.release?.(node); // The stretched mesh also owns a hidden unstretched source geometry.
      node.geometry.dispose?.();
      if(!authored)return; // Placeholders share one material disposed when the entire shaft is released.
      const materials=Array.isArray(node.material)?node.material:[node.material];
      for(const material of materials)if(material&&material!==stone&&!seen.has(material)){seen.add(material);material.dispose?.();}
    });
  }
  function placeholder(THREE,placement,material){
    const {height}=placement;
    const widths=widthsForPlatform(placement); // Keep the same width at each corresponding piece when the asset loads.
    const group=new THREE.Group();group.name='shaft-support-loading-placeholder';
    const make=(name,w,h,y)=>{
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,w),material);
      mesh.name=name;mesh.position.set(0,y,0);stretchStoneFaces(mesh);group.add(mesh);
    };
    make('foot',widths[PART.foot],.16,.08);
    make('stone-shaft',widths[PART.shaft],Math.max(.1,height-.30),.16+Math.max(.1,height-.30)/2);
    make('capital',widths[PART.cap],.14,height-.07);
    markVisualOnly(group);
    return group;
  }
  function mount(plan,{THREE,parent,slabThickness=.45,material,loadTemplate}={}){
    if(!THREE?.Group||!THREE?.BoxGeometry||!parent?.add)throw new Error('Shaft pillar mounting requires THREE and a parent');
    const pitY=Number(plan?.pit?.bottomY); // All supports share the real hazard basin elevation, including upper-story platforms.
    const placements=[];
    const stone=material||new THREE.MeshBasicMaterial({color:0x726d63}); // The jump shaft owns the supplied pillar material, including teardown.
    let disposed=false,upgraded=0,failures=0,reason=null; // Exposed in the shaft's mobile diagnostics.
    for(const platform of plan?.platforms||[]){
      const geometry=layout(platform,pitY,slabThickness);
      if(!geometry){failures++;continue;}
      const holder=new THREE.Group();holder.name='shaft-structural-pillar-'+platform.id;
      holder.position.set(geometry.x,geometry.bottomY,geometry.z);
      holder.userData.devRuinFootprintIgnore=true;
      const visual=placeholder(THREE,geometry,stone);
      holder.add(visual);parent.add(holder);
      placements.push({holder,visual,geometry,authored:false}); // Each pillar can be replaced independently when its authored data arrives.
    }
    const ready=Promise.resolve().then(()=>typeof loadTemplate==='function'?loadTemplate():loadSource())
      .then(source=>{
        if(disposed)return;
        const furniture=root.AuthoredFurniture;
        if(!source||!furniture?.buildGroup||!furniture?.setTileSpan){
          reason='Square pillar asset or authored-furniture runtime unavailable';failures+=placements.length;return;
        }
        let recipe;
        try{recipe=recipeFromSquarePillar(source);}
        catch(error){reason=error.message;failures+=placements.length;return;}
        for(const placement of placements){
          if(disposed)break;
          let visual=null;
          try{
            visual=furniture.buildGroup(recipeForPlatform(recipe,placement.geometry),0x7b7466);
            const span=furniture.setTileSpan(visual,placement.geometry.height); // IKMC ladder solver: fixed foot, stretched shaft, rigid capital.
            if(!span?.enabled||span.errors?.length||visual.userData?.tileSpanDiagnostics?.errors?.length)
              throw new Error('Vertical tile-span could not resolve the shaft attachments');
            for(const mesh of visual.userData.meshById.values()){
              stretchStoneFaces(mesh,true); // Fit the texture to the finished height, including the stretched shaft.
              mesh.material.dispose?.();
              mesh.material=stone;
            }
            visual.position.y=-recipe.bottom;
            markVisualOnly(visual);
            visual.name='authored-pillar-square-'+placement.geometry.id;
            placement.holder.add(visual);
            placement.holder.remove(placement.visual);
            disposeVisual(placement.visual,false);
            placement.visual=visual;placement.authored=true;upgraded++;
          }catch(error){
            if(visual){visual.parent?.remove?.(visual);disposeVisual(visual,true,stone);}
            failures++;reason=error.message;
          }
        }
        if(reason)root.__farmLog?.('[ruin shaft] Pillar support: '+reason,'warn');
      }).catch(error=>{
        if(disposed)return;
        failures+=placements.length;reason=error.message;
        root.__farmLog?.('[ruin shaft] Pillar support failed: '+reason,'warn');
      });
    return {
      ready,
      getState:()=>({total:placements.length,authored:upgraded,fallback:placements.length-upgraded,
        narrowBases:placements.filter(p=>p.geometry.footprintTiles===2).length,
        wideBases:placements.filter(p=>p.geometry.footprintTiles===3).length,failures,reason}),
      dispose(){
        if(disposed)return;disposed=true;
        for(const placement of placements){
          placement.holder.parent?.remove?.(placement.holder);
          disposeVisual(placement.visual,placement.authored,stone);
        }
        if(!material)stone.dispose?.();
        placements.length=0; // A late fetch cannot resurrect supports in a disposed ruin.
      },
    };
  }
  return Object.freeze({SOURCE,loadSquarePillar:loadSource,footprintTiles,layout,recipeFromSquarePillar,recipeForPlatform,stretchStoneFaces,mount});
});

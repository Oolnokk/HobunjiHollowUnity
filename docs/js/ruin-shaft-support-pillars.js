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
      footprintTiles:footprint};
  }
  function recipeFromSquarePillar(source){
    const sourceParts=source?.parts;
    if(!Array.isArray(sourceParts))throw new Error('Square pillar furniture has no authored parts');
    const byId=new Map(sourceParts.map(part=>[part.id,part])); // Resolves the exact inherited base and capital anchor dimensions.
    if(Object.values(PART).some(id=>!byId.has(id)))throw new Error('Square pillar furniture is missing its base, shaft or capital');
    const foot=byId.get(PART.foot).transform,cap=byId.get(PART.cap).transform;
    const bottom=Number(foot.y)-Number(foot.sy)/2,top=Number(cap.y)+Number(cap.sy)/2;
    const baseHeight=top-bottom; // Native part span; do not assume edits to the Furniture Author preserve a hardcoded 1.75.
    if(!Number.isFinite(baseHeight)||baseHeight<=0||!(Number(foot.sx)>0&&Number(foot.sz)>0))
      throw new Error('Square pillar authored bounds are invalid');
    const parts=sourceParts.map(part=>{
      let role=part.id===PART.shaft?'stretch':
        [PART.foot,PART.rise].includes(part.id)?'start':'end';
      const overlay={...part,tileSpanRole:role}; // Never mutate the template used by ordinary architectural pillars.
      if(role==='stretch')overlay.tileSpanRoots={
        start:{partId:PART.rise,face:'max'},end:{partId:PART.neck,face:'min'},
      }; // The shaft grows between the raised foot and the fixed neck/capital.
      return overlay;
    });
    const data={schema:'hobunji_furniture_authored_runtime.v1',key:'pillar_square',id:'pillar_square',
      name:'Square Pillar — Shaft Platform Support',parts,
      tileSpan:{version:1,enabled:true,axis:'y',baseHeight,targetHeight:baseHeight,
        startTiles:1,middleTiles:1,endTiles:1,totalTiles:3,tileSize:1}};
    return {data,bottom,footWidth:Number(foot.sx),footDepth:Number(foot.sz)};
  }
  function loadSource(){
    if(!sourcePromise){
      if(!root.document||typeof root.fetch!=='function')return Promise.resolve(null); // Node logic tests must not fetch a relative URL.
      sourcePromise=Promise.resolve().then(()=>root.fetch(SOURCE+'?v=20261118shaftPillars1'))
        .then(response=>{if(!response.ok)throw new Error('HTTP '+response.status);return response.json();})
        .catch(error=>{root.__farmLog?.('[ruin shaft] Square pillar source unavailable: '+error.message,'warn');return null;});
    }
    return sourcePromise;
  }
  function markVisualOnly(group){
    group.traverse?.(node=>{node.userData ||= {};node.userData.devRuinFootprintIgnore=true;});
    group.userData ||= {};group.userData.devRuinFootprintIgnore=true; // Structural visuals must not turn the pit into a standable floor or block jumps.
  }
  function disposeVisual(visual,authored){
    if(!visual)return;
    const seen=new Set(); // Avoid double-freeing a material shared among one pillar's parts.
    visual.traverse?.(node=>{
      if(!node.geometry)return;
      if(authored)root.FurnitureTileSpan?.release?.(node); // The stretched mesh also owns a hidden unstretched source geometry.
      node.geometry.dispose?.();
      if(!authored)return; // Placeholders share one material disposed when the entire shaft is released.
      const materials=Array.isArray(node.material)?node.material:[node.material];
      for(const material of materials)if(material&&!seen.has(material)){seen.add(material);material.dispose?.();}
    });
  }
  function placeholder(THREE,footprint,height,material){
    const group=new THREE.Group();group.name='shaft-support-loading-placeholder';
    const make=(name,w,h,d,y)=>{
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);
      mesh.name=name;mesh.position.set(0,y,0);group.add(mesh);
    };
    make('foot',footprint,.16,footprint,.08);
    make('stone-shaft',footprint*.60,Math.max(.1,height-.16),footprint*.60,.16+Math.max(.1,height-.16)/2);
    make('capital',footprint*.96,.14,footprint*.96,height-.07);
    markVisualOnly(group);
    return group;
  }
  function mount(plan,{THREE,parent,slabThickness=.45,loadTemplate}={}){
    if(!THREE?.Group||!THREE?.BoxGeometry||!parent?.add)throw new Error('Shaft pillar mounting requires THREE and a parent');
    const pitY=Number(plan?.pit?.bottomY); // All supports share the real hazard basin elevation, including upper-story platforms.
    const placements=[],material=new THREE.MeshBasicMaterial({color:0x726d63});
    let disposed=false,upgraded=0,failures=0,reason=null; // Exposed in the shaft's mobile diagnostics.
    for(const platform of plan?.platforms||[]){
      const geometry=layout(platform,pitY,slabThickness);
      if(!geometry){failures++;continue;}
      const holder=new THREE.Group();holder.name='shaft-structural-pillar-'+platform.id;
      holder.position.set(geometry.x,geometry.bottomY,geometry.z);
      holder.userData.devRuinFootprintIgnore=true;
      const visual=placeholder(THREE,geometry.footprintTiles,geometry.height,material);
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
            visual=furniture.buildGroup(recipe.data,0x7b7466);
            const span=furniture.setTileSpan(visual,placement.geometry.height); // IKMC ladder solver: fixed foot, stretched shaft, rigid capital.
            if(!span?.enabled||span.errors?.length||visual.userData?.tileSpanDiagnostics?.errors?.length)
              throw new Error('Vertical tile-span could not resolve the shaft attachments');
            visual.scale.set(placement.geometry.footprintTiles/recipe.footWidth,1,
              placement.geometry.footprintTiles/recipe.footDepth); // Per-instance 2×2 or 3×3 tile-sized square foundation.
            visual.position.y=-recipe.bottom;
            markVisualOnly(visual);
            visual.name='authored-pillar-square-'+placement.geometry.id;
            placement.holder.add(visual);
            placement.holder.remove(placement.visual);
            disposeVisual(placement.visual,false);
            placement.visual=visual;placement.authored=true;upgraded++;
          }catch(error){
            if(visual){visual.parent?.remove?.(visual);disposeVisual(visual,true);}
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
        bases2x2:placements.filter(p=>p.geometry.footprintTiles===2).length,
        bases3x3:placements.filter(p=>p.geometry.footprintTiles===3).length,failures,reason}),
      dispose(){
        if(disposed)return;disposed=true;
        for(const placement of placements){
          placement.holder.parent?.remove?.(placement.holder);
          disposeVisual(placement.visual,placement.authored);
        }
        material.dispose?.();
        placements.length=0; // A late fetch cannot resurrect supports in a disposed ruin.
      },
    };
  }
  return Object.freeze({SOURCE,footprintTiles,layout,recipeFromSquarePillar,mount});
});

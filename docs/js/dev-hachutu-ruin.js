// Developer-only Hachutu ruin. Independent encounter composer; V50 still owns
// the interior lifecycle, dynamic surfaces, rooted architecture and input.
(() => {
  'use strict';
  const SP=window.DevRandomRuinSimplePuzzles, DS=window.DynamicSurfaces, THREE=window.THREE;
  if(!SP?.registerComposer||!DS||!THREE)return;
  const MAP='map_i_dev_random_ruin', DEPTH=32, CELL=1;
  const TYPES=['sentinel','bulwark','reacher']; // Titan rolls only these three combat-capable Maskbound variants.
  const COLORS=[0x8A2BFF,0x5B5BFF,0x1FB7FF,0x19E6C3,0x3DFF6B,0xC8FF2B,0xFFC531,0xFF5FA8]; // Binding mask II: the exact eight-color defaultHexPool, not an approximate glow palette.
  const TITAN={scale:3,power:3,range:3,health:3,stamina:3,footing:3,speed:1/3}; // Shared stat contract for all three Titan variants.
  let reserved=null, session=null, deps=null; // Reserved geometry and current session are isolated from ordinary Harlyao ruins.
  const rndSeed=seed=>{let n=(Number(seed)||1)>>>0;return()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);};
  const rect=(x,z,w,d)=>({minX:x,maxX:x+w,minZ:z,maxZ:z+d});
  const centre=b=>({x:(b.minX+b.maxX)/2,z:(b.minZ+b.maxZ)/2});
  const inside=(p,b,pad=0)=>!!p&&p.x>=b.minX+pad&&p.x<=b.maxX-pad&&p.z>=b.minZ+pad&&p.z<=b.maxZ-pad;
  function makePlan(cols,rows){
    const baseRows=Math.max(rows,DEPTH),z=Math.floor((baseRows-24)/2);
    let x=cols+2;
    const parts=[];
    for(const [name,w,d] of [['swing',24,24],['labyrinth',23,23],['trial',18,20],['heart',24,24],['vault',12,12]]){
      const bounds=rect(x,z+Math.floor((24-d)/2),w,d);
      parts.push({name,bounds,center:centre(bounds)});x+=w+4;
    }
    const passages=[];
    for(let i=0;i<parts.length-1;i++) passages.push(rect(parts[i].bounds.maxX,parts[i].center.z-1.5,4,3));
    return {cols:x+3,rows:baseRows,parts,passages};
  }
  // The regular sanctum reservation is replaced, not added: normal ruins
  // never allocate these unusually large custom challenge rooms.
  function reserve(cols,rows){
    reserved=makePlan(cols,rows);
    const tiles=new Set();
    function fill(b){for(let x=Math.floor(b.minX);x<Math.ceil(b.maxX);x++)for(let z=Math.floor(b.minZ);z<Math.ceil(b.maxZ);z++)tiles.add(x+','+z);}
    for(const part of reserved.parts)fill(part.bounds);
    for(const passage of reserved.passages)fill(passage);
    // The central abyss has NO hidden floor, only moving DynamicSurfaces decks.
    const abyss=reserved.parts[0].bounds;
    for(let x=abyss.minX+3;x<abyss.maxX-3;x++)for(let z=abyss.minZ+3;z<abyss.maxZ-3;z++)tiles.delete(x+','+z);
    return {...reserved,tiles};
  }
  // Opaque flat-colour materials are shared per colour: the temple used to allocate >1,400 identical
  // MeshBasicMaterials (one per mesh), each its own draw state. Transparent/effect materials stay unique
  // because callers mutate them (fade, recolour).
  const sharedMaterials=new Map();
  const material=(color,opts={})=>{
    if(Object.keys(opts).length)return new THREE.MeshBasicMaterial({color,...opts});
    let shared=sharedMaterials.get(color);
    if(!shared){shared=new THREE.MeshBasicMaterial({color});sharedMaterials.set(color,shared);}
    return shared;
  };
  const mesh=(parent,name,geo,mat,x,y,z)=>{
    const item=new THREE.Mesh(geo,mat);item.name=name;item.position.set(x,y,z);parent.add(item);return item;
  };
  // ---- Stone-age rock pieces ------------------------------------------------------------------------------
  // Stone-type pieces (walls, menhirs, posts, standing stones, pillars) use the same authored rock pipeline as the
  // Stone Age ruin scenery: ProceduralFurniture rock geometry + the natural-surface quarry material + stretch UVs,
  // instead of flat-colour primitives. Rock geometry is cached per shape with three variants, so a hall of identical
  // menhirs costs three geometry builds, not twenty. Falls back to the flat primitive if the pipeline isn't loaded.
  const STONE_PIECE=/wall|menhir|standing stone|totem|post|door frame|megalith|stepping stone|stone pillar|rooted pillar/i;
  function stonePipeline(){
    const SA=window.StoneAgeRuinScenery;
    return SA?.ruinRockGeometry&&SA.makeRuinStoneMaterial&&SA.mapRuinStoneSurfaces&&window.ProceduralFurniture?.createRockGeometry
      &&window.NaturalSurfaceMaterials?.naturalizeMesh&&window.HobunjiSurfaceStretchUV?.mapMesh?SA:null;
  }
  function stoneMaterial(){
    return session.floorRockMaterial||(session.floorRockMaterial=window.StoneAgeRuinScenery?.makeRuinStoneMaterial?.('#363733')||material(0x363733));
  }
  function stonePiece(parent,name,build,key,x,y,z,color){
    const SA=session&&STONE_PIECE.test(name)?stonePipeline():null;
    if(!SA)return mesh(parent,name,build(),material(color),x,y,z);
    try{
      const cache=session.rockCache||(session.rockCache=new Map()),counter=session.rockCounter=(session.rockCounter||0)+1,variant=counter%3,id=key+'|'+variant;
      let geometry=cache.get(id);
      if(!geometry){
        const source=new THREE.Mesh(build());
        geometry=SA.ruinRockGeometry(source,{enabled:true,seed:'hachutu:'+session.context.seed+':'+id,roughness:.3,contactArea:.35});
        source.geometry.dispose();
        const proxy=new THREE.Mesh(geometry,stoneMaterial());proxy.userData={ruinPreviewRole:'wall'};
        SA.mapRuinStoneSurfaces(proxy);geometry=proxy.geometry;
        geometry.userData.devRuinSharedPrimitive=true; // Shared between pieces; disposed once with the session cache.
        cache.set(id,geometry);
      }
      return mesh(parent,name,geometry,stoneMaterial(),x,y,z);
    }catch(error){
      session.errors.push('Rock piece '+name+': '+String(error?.message||error));
      return mesh(parent,name,build(),material(color),x,y,z);
    }
  }
  const round=n=>Math.round(n*100)/100;
  function box(parent,name,w,h,d,x,y,z,color){
    return stonePiece(parent,name,()=>new THREE.BoxGeometry(w,h,d),'b'+round(w)+'x'+round(h)+'x'+round(d),x,y,z,color);
  }
  function cylinder(parent,name,top,bottom,height,x,y,z,color){
    return stonePiece(parent,name,()=>new THREE.CylinderGeometry(top,bottom,height,9),'c'+round(top)+'/'+round(bottom)+'x'+round(height),x,y,z,color);
  }
  function roots(parent,x,y,z,height=3,thick=.13,keep=false){
    // Staggered crooked branch silhouette, with tapered offshoots instead of Harlyao straight columns.
    // Static roots placed directly in the temple group are collected into session.rootBatch and baked into
    // two merged meshes by flushRootBatch(); only animated/owned roots (keep, or a non-temple parent such as a
    // coffin, door layer or pillar) stay individual meshes.
    const batched=!keep&&session&&parent===session.group&&session.rootBatch;
    const target=batched?session.rootBatch:parent;
    const trunk=cylinder(target,'Hachutu grown root',thick*.55,thick,height,x,y+height*.5,z,0x302c24);
    trunk.rotation.z=.17;trunk.userData.devRuinFootprintIgnore=true;
    for(let k=0;k<3;k++){const twig=cylinder(target,'branching root',.015,thick*.6,height*(.22+k*.12),x+Math.sin(k*2.4)*thick*3,y+height*(.38+k*.14),z+Math.cos(k*1.6)*thick*3,0x3b3428);twig.rotation.z=.6+k*.38;twig.userData.devRuinFootprintIgnore=true;}
    return batched?null:trunk;
  }
  // Bakes every batched root into one indexed BufferGeometry per colour (a single draw call each).
  function flushRootBatch(){
    const batch=session?.rootBatch;if(!batch)return;
    batch.updateMatrixWorld(true);
    const byColor=new Map();
    for(const child of batch.children){
      if(!child.isMesh)continue;
      const key=child.material.color.getHex();
      if(!byColor.has(key))byColor.set(key,[]);
      byColor.get(key).push(child);
    }
    let merged=0;
    for(const [color,list] of byColor){
      let vertexCount=0,indexCount=0;
      for(const m of list){vertexCount+=m.geometry.attributes.position.count;indexCount+=m.geometry.index.count;}
      const positions=new Float32Array(vertexCount*3),normals=new Float32Array(vertexCount*3),indices=new Uint32Array(indexCount);
      let v=0,i=0;const vec=new THREE.Vector3(),normalMatrix=new THREE.Matrix3();
      for(const m of list){
        const g=m.geometry,pos=g.attributes.position,nor=g.attributes.normal;
        normalMatrix.getNormalMatrix(m.matrixWorld);
        for(let k=0;k<pos.count;k++){
          vec.fromBufferAttribute(pos,k).applyMatrix4(m.matrixWorld);positions.set([vec.x,vec.y,vec.z],(v+k)*3);
          vec.fromBufferAttribute(nor,k).applyMatrix3(normalMatrix).normalize();normals.set([vec.x,vec.y,vec.z],(v+k)*3);
        }
        for(let k=0;k<g.index.count;k++)indices[i+k]=g.index.array[k]+v;
        v+=pos.count;i+=g.index.count;merged++;
        g.dispose();
      }
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.BufferAttribute(positions,3));geo.setAttribute('normal',new THREE.BufferAttribute(normals,3));
      geo.setIndex(new THREE.BufferAttribute(indices,1));
      const mesh=new THREE.Mesh(geo,material(color));mesh.name='Hachutu merged grown roots';mesh.userData.devRuinFootprintIgnore=true;
      session.group.add(mesh);
    }
    session.mergedRootMeshes=merged;
    session.rootBatch=null;
  }
  function emberRing(parent,x,y,z,r,color){
    const torus=mesh(parent,'colored fire ring',new THREE.TorusGeometry(r,.075,5,56),material(color,{transparent:true,opacity:.9,depthWrite:false}),x,y,z);
    torus.rotation.x=-Math.PI/2;
    const embers=Array.from({length:12},(_,i)=>{const angle=2*Math.PI*i/12;return box(parent,'ring ember',.08,.2,.08,x+Math.cos(angle)*r,y+.12,z+Math.sin(angle)*r,color);});
    torus.userData.devRuinFootprintIgnore=true;embers.forEach(e=>e.userData.devRuinFootprintIgnore=true);
    return {torus,embers,setActive(active){torus.visible=active;embers.forEach(e=>e.visible=active);}};
  }
  function createWeed(part,rng){
    const {x,z}=part.center,group=new THREE.Group();session.group.add(group);group.position.set(x,session.floor,z);
    const stem=cylinder(group,'binding weed stem',.12,.3,2.8,0,1.4,0,0x28261c);
    for(let i=0;i<8;i++){
      const a=i*Math.PI/4;
      const finger=cylinder(group,'binding weed hook',.015,.15,1.35,Math.cos(a)*.32,2.2,Math.sin(a)*.32,0x494039);
      finger.rotation.z=Math.cos(a)*.55;finger.rotation.x=Math.sin(a)*.55;
    }
    const crown=mesh(group,'binding weed heart',new THREE.IcosahedronGeometry(.44,1),material(COLORS[Math.floor(rng()*COLORS.length)]),0,2.75,0);
    const palette=COLORS.slice().sort(()=>rng()-.5); // Three distinct authored Maskbound-eye hues for each new weed.
    const rings=Array.from({length:3},(_,i)=>emberRing(session.group,x,session.floor+.15+i*.18,z,1.15+i*.43,palette[i]));
    const weed={name:part.name,part,group,crown,rings,done:false,damage:0,controls:[],plates:[]};
    // Melee and projectile collision can both damage the crown; the
    // interaction fallback is controller-accessible and visible on phones.
    session.kit.registerProjectileTarget({id:'hachutu-weed-'+part.name,object:crown,hitMesh:crown,active:false,
      hittable:()=>weedExposed(weed),onHit:()=>strikeWeed(weed)});
    return weed;
  }
  // A weed can be hurt once its fire rings are out AND its hall's own puzzle (weed.requires) is solved.
  function weedExposed(weed){return !!weed&&!weed.done&&weed.rings.every(r=>!r.torus.visible)&&(!weed.requires||weed.requires());}
  function strikeWeed(weed){
    if(!weedExposed(weed))return false;
    weed.damage++;
    weed.crown.scale.setScalar(Math.max(.25,1-weed.damage*.3));
    if(weed.damage<3)return true;
    weed.done=true;weed.group.visible=false;weed.rings.forEach(r=>r.setActive(false));
    session.weedsKilled++;
    session.deps?.showToast?.('Binding weed severed — a burning root retreats from the Temple Heart.',true);
    window.AudioSystem?.playObjectSfxKey?.('puzzleComplete');
    return true;
  }
  function takeRing(weed,index){
    if(!weed||weed.done||!weed.rings[index]?.torus.visible)return false;
    weed.rings[index].setActive(false);
    session.deps?.showToast?.('A ring of binding fire gutters out.',true);
    return true;
  }
  function floorSlab(name,b,height=.3){
    const w=b.maxX-b.minX,d=b.maxZ-b.minZ,c=centre(b);
    const rock=session.floorRockMaterial||(session.floorRockMaterial=window.StoneAgeRuinScenery?.makeRuinStoneMaterial?.('#363733')||material(0x363733)); // Share one authored quarry material across the large wing.
    const slab=mesh(session.group,name,new THREE.BoxGeometry(w,height,d),rock,c.x,session.floor-height*.5,c.z);
    slab.userData.devRuinFootprintIgnore=true; // Visual-only: registered DynamicSurfaces owns floor and pit heights.
    return slab;
  }
  function sculptRoom(part,kit){
    const y=session.floor,b=part.bounds,group=session.group;
    if(part.name==='swing'){
      const inset=3;
      floorSlab('stone chasm west ledge',rect(b.minX,b.minZ,inset,b.maxZ-b.minZ));
      floorSlab('stone chasm east ledge',rect(b.maxX-inset,b.minZ,inset,b.maxZ-b.minZ));
      floorSlab('stone chasm north ledge',rect(b.minX+inset,b.minZ,b.maxX-b.minX-inset*2,inset));
      floorSlab('stone chasm south ledge',rect(b.minX+inset,b.maxZ-inset,b.maxX-b.minX-inset*2,inset));
    }else floorSlab('rough quarry floor '+part.name,b);
    const ceiling=mesh(group,'root rib ceiling '+part.name,
      new THREE.BoxGeometry(b.maxX-b.minX,.3,b.maxZ-b.minZ),
      material(0x262923),part.center.x,y+(part.name==='swing'?9:5),part.center.z);
    ceiling.userData.devRuinFootprintIgnore=true; // Does not add a second roof collision authority.
    const SA=stonePipeline();
    if(SA){try{ceiling.material=stoneMaterial();ceiling.userData.ruinPreviewRole='wall';SA.mapRuinStoneSurfaces(ceiling);ceiling.geometry.userData.devRuinSharedPrimitive=false;}catch(error){session.errors.push('Ceiling stone: '+String(error?.message||error));}} // Quarried slab, same material as the walls.
    const gap=3.1,mid=part.center.z,t=.8;
    // Low walls, rough posts and giant root ribs; no Harlyao ornamental furniture.
    for(const side of ['north','south']){
      box(group,'rough Hachutu wall',b.maxX-b.minX,4,t,part.center.x,y+2,side==='north'?b.minZ:b.maxZ,0x373932);
    }
    for(const side of ['west','east']){
      const x=side==='west'?b.minX:b.maxX;
      const len=(b.maxZ-b.minZ-gap)/2;
      for(const sign of [-1,1])box(group,'split megalith wall',t,4,len,x,y+2,mid+sign*(gap+len)/2,0x34352e);
    }
    for(const x of [b.minX+1,b.maxX-1])for(const z of [b.minZ+1,b.maxZ-1]){
      cylinder(group,'stone-age menhir',.45,.7,3.5,x,y+1.75,z,0x464941);
      roots(group,x,y,z,4,.17);
    }
    for(let i=0;i<5;i++){
      const x=b.minX+2+(i+.5)*(b.maxX-b.minX-4)/5;
      roots(group,x,y+3.25,b.minZ+.9,2.2,.07);
    }
  }
  function buildPassages(){
    const y=session.floor,kit=session.kit;
    for(const b of session.layout.passages){
      floorSlab('root passage flagstones',b);
      for(const z of [b.minZ-.45,b.maxZ+.45]){
        box(session.group,'Hachutu passage wall',b.maxX-b.minX,3.8,.9,(b.minX+b.maxX)/2,y+1.9,z,0x393b34);
        for(let x=b.minX+.55;x<b.maxX;x+=.9)roots(session.group,x,y,z,3.1,.06);
      }
      // Easy stepping course over a fully supported corridor; variety lies in
      // the changing offset/height of the rooted capstones, not another
      // mandatory mechanism that could strand the player.
      for(let i=0;i<3;i++){
        const x=b.minX+.8+i*1.15,z=(b.minZ+b.maxZ)/2+(i%2?-.5:.5)+(.5-session.rng())*.22; // Seeded variation without changing corridor clearance.
        const stone=cylinder(session.group,'Hachutu passage stepping stone',.55,.62,.28,x,y+.14,z,0x44473e);
        stone.userData.devRuinFootprintIgnore=true;
        roots(session.group,x,y,z,1.6,.07);
      }
      // Walkable floor remains reserved in the V50 interior; root ribs arch overhead.
      for(let x=b.minX+.5;x<b.maxX;x+=1.6){
        roots(session.group,x,y,b.minZ+.12,4,.08);roots(session.group,x,y,b.maxZ-.12,4,.08);
      }
    }
  }
  function buildSwing(weed,rng){
    const b=weed.part.bounds,y=session.floor,centre=weed.part.center,kit=session.kit;
    const fog=mesh(session.group,'bottomless fog',new THREE.PlaneGeometry(b.maxX-b.minX-5,b.maxZ-b.minZ-5),
      material(0x5a5b56,{transparent:true,opacity:.62,depthWrite:false,side:THREE.DoubleSide}),centre.x,y-32,centre.z);
    fog.rotation.x=-Math.PI/2;fog.userData.devRuinFootprintIgnore=true;
    session.abyss={minX:b.minX+3,maxX:b.maxX-3,minZ:b.minZ+3,maxZ:b.maxZ-3};
    const platforms=[];
    for(let ring=0;ring<3;ring++){
      const count=3+ring*2,radius=3.7+ring*2.75;
      for(let index=0;index<count;index++){
        const phase=2*Math.PI*index/count+rng()*1.4,period=5+ring*2.4+rng()*2.4;
        const plate=ring===0&&index===0 || ring===1&&index===0 || ring===2&&index===0;
        const entry={ring,index,radius,phase,period:period*5,rotation:0,position:{x:0,z:0},prev:{x:0,z:0},y:y+.55,
          plate,moving:!plate,triggered:false,stone:null,cap:null,rootSkin:null};
        // Only the three mechanism islands retain stone; other islands are root-grown with no rendered base.
        if(plate){
          entry.stone=cylinder(session.group,'stationary stone mechanism platform',1.15,1.45,1.65,0,y-.30,0,0x464841);
          entry.stone.userData.devRuinFootprintIgnore=true;
          entry.cap=cylinder(session.group,'stationary stone mechanism top',1.13,1.15,.13,0,y+.61,0,0x5b5c53);
          entry.cap.userData.devRuinFootprintIgnore=true;
          entry.plateMesh=cylinder(session.group,'Hachutu pressure plate',.44,.48,.08,0,y+.73,0,0x9d625c);
          entry.plateMesh.material=new THREE.MeshBasicMaterial({color:0x9d625c});
          entry.plateMesh.userData.devRuinFootprintIgnore=true;
        } // Own material: the shared per-colour one must not recolour all three plates.
        kit.registerSurface({id:'hachutu-moving-'+ring+'-'+index,
          bounds:()=>({minX:entry.position.x-1.12,maxX:entry.position.x+1.12,minZ:entry.position.z-1.12,maxZ:entry.position.z+1.12}),
          topY:()=>y+.70,priority:30});
        platforms.push(entry);
      }
    }
    session.platforms=platforms;
    // Use the actual Root Growth Author geometry solver once on a representative
    // column and instance its completed rooted skin across the moving rings.
    // Navigation remains with the explicit moving platform surfaces.
    if(window.LiveRootGrowth?.create&&window.FoliageGenerator?.buildSurfaceGrowth){
      try{
        const guide=new THREE.Group();guide.name='Hachutu stone-pillar growth guide';
        const shape=new THREE.Mesh(new THREE.CylinderGeometry(1.14,1.38,1.65,9),material(0x383a34));
        guide.add(shape);
        const grown=window.LiveRootGrowth.create({THREE,foliage:window.FoliageGenerator,target:guide,
          recipe:{seed:'hachutu-pillars-'+session.context.seed,branchCount:6,strandLimit:20,
            floorWidth:2.8,floorDepth:2.8,floorY:-.6,floorDensity:.48,
            targetDensity:.8,radius:.065,branchRadius:.085,showGuide:false,duration:1},
          progress:1,rootFinish:{color:'#24211d',texture:'assets/textures/wibbly_surface.png'}});
        grown.setProgress(1);session.pillarRootTemplate=grown;
        try{window.StoneAgeRuinScenery?.compactFloorCover?.(grown.group,COVER_SIMPLIFY);}catch(_){} // Fifteen clones render this skin: simplify the strands once, before cloning.
        for(const entry of platforms.filter(item=>item.moving)){
          const clone=grown.group.clone(true);clone.name='root-grown moving platform (no base)';
          clone.userData.devRuinFootprintIgnore=true;
          session.group.add(clone);entry.rootSkin=clone;
        }
      }catch(error){session.errors.push('Pillar root author: '+String(error?.message||error));}
    }
    // Original pendulum interaction/collision and landing physics are reused;
    // ceiling mounts grow into staggered vines rather than wood ropes.
    const room={id:'hachutu-swing'};
    const ropes=[];
    for(let i=0;i<15;i++){
      const a=2*Math.PI*i/15,rad=3.5+(i%3)*2.7;
      const x=i===0?b.minX+3.6:centre.x+Math.cos(a)*rad,z=i===0?centre.z:centre.z+Math.sin(a)*rad;
      const anchor={x,y:y+7.1+rng()*1.4,z},rope=kit.createRopeObject({
        room,idSuffix:'vine-'+i,anchor,yaw:a+Math.PI/2,length:5.6,maxLength:6.2,
        minBobY:y+.6,angle:.1,startPlatform:null,endPlatform:null,
        grabPoint:i===0?{x:b.minX+2.5,y:y+1.35,z:centre.z}:null,
      });
      rope.mesh.material.dispose();
      rope.mesh.material=material(0x315b35);
      rope.mesh.scale.x=1.3;rope.mesh.scale.z=1.3;
      rope.mount.material.dispose();rope.mount.material=material(0x29482d);
      roots(session.group,x,y+5.9,z,2.7,.10);
      kit.state.ropes.push(rope);kit.updateRopeVisual(rope);ropes.push(rope);
    }
    session.vineRopes=ropes;
    return platforms;
  }
  function updateSwing(dt,now){
    const p=session.kit.playerWorld();
    for(const entry of session.platforms){
      const old={...entry.position};
      if(entry.moving){
        const a=entry.phase+now*.001*(2*Math.PI/entry.period)*(entry.ring%2===0?1:-1)
          +.14*Math.sin(now*.001*.062+entry.index*2.1);
        const r=entry.radius+.22*Math.sin(now*.001*.054);
        entry.position.x=session.layout.parts[0].center.x+Math.cos(a)*r;
        entry.position.z=session.layout.parts[0].center.z+Math.sin(a)*r;
        if(entry.rootSkin){entry.rootSkin.position.x=entry.position.x;entry.rootSkin.position.z=entry.position.z;}
      }else{
        entry.position.x=session.layout.parts[0].center.x+Math.cos(entry.phase)*entry.radius;
        entry.position.z=session.layout.parts[0].center.z+Math.sin(entry.phase)*entry.radius;
        if(entry.stone){entry.stone.position.x=entry.cap.position.x=entry.position.x;entry.stone.position.z=entry.cap.position.z=entry.position.z;}
        if(entry.plateMesh){entry.plateMesh.position.x=entry.position.x;entry.plateMesh.position.z=entry.position.z;}
      }
      // Preserve a planted rider through the moving DynamicSurfaces support.
      if(p&&!session.kit.ownsPlayerMotion()&&Math.hypot(p.x-old.x,p.z-old.z)<.83&&Math.abs((p.y||0)-(session.floor+.7))<1.1){
        const dx=entry.position.x-old.x,dz=entry.position.z-old.z;
        session.kit.setPlayerWorld({x:p.x+dx,z:p.z+dz,y:session.floor+.7},false);
      }
      if(p&&Math.hypot(p.x-entry.position.x,p.z-entry.position.z)<.8
        &&Math.abs((p.y||0)-(session.floor+.7))<1.1&&now-(session.lastSwingSpawnAt||0)>6000){
        session.lastSwingSpawnAt=now; // A standing rider awakens roots/coffins, never a timed ambush from the empty ledge.
        const b=session.layout.parts[0].bounds;
        spawnCoffin(b.minX+1.7,b.minZ+3+session.rng()*(b.maxZ-b.minZ-6),TYPES[Math.floor(session.rng()*3)]);
      }
      if(entry.plate&&!entry.triggered&&p&&Math.hypot(p.x-entry.position.x,entry.position.z-p.z)<.45){
        entry.triggered=true;entry.plateMesh.material.color.setHex(0x63946a);
        takeRing(session.weeds[0],entry.ring);
      }
    }
  }
  function generateMaze(rng,n=9){
    // Iterative DFS guarantees one traversable path from the entrance to
    // the center despite varying roots and stone orientations.
    const visited=new Set(['0,0']),edges=[],stack=[[0,0]],dirs=[[1,0],[-1,0],[0,1],[0,-1]];
    while(stack.length){
      const [x,z]=stack[stack.length-1],possible=dirs.map(([dx,dz])=>[x+dx,z+dz]).filter(([a,b])=>a>=0&&b>=0&&a<n&&b<n&&!visited.has(a+','+b));
      if(!possible.length){stack.pop();continue;}
      const [nx,nz]=possible[Math.floor(rng()*possible.length)];
      visited.add(nx+','+nz);edges.push([[x,z],[nx,nz]]);stack.push([nx,nz]);
    }
    return {n,edges,visited};
  }
  function buildLabyrinth(weed,rng){
    const b=weed.part.bounds,y=session.floor,wall=0x3b3c36,maze=generateMaze(rng,9);
    const scale=2.05,x0=weed.part.center.x-4*scale,z0=weed.part.center.z-4*scale,connected=new Set(); // DFS cell 4,4 shares the exact geometric center of the room and binding weed.
    maze.edges.forEach(([a,c])=>connected.add([a.join(','),c.join(',')].sort().join('|')));
    for(let z=0;z<9;z++)for(let x=0;x<9;x++){
      const cx=x0+x*scale,cz=z0+z*scale;
      // Low irregular stone barricades are punctuated by archways along the DFS tree.
      for(const [dx,dz] of [[1,0],[0,1]]){
        if(x+dx>=9||z+dz>=9)continue;
        const key=[[x,z].join(','),[x+dx,z+dz].join(',')].sort().join('|');
        if(connected.has(key))continue;
        const block=box(session.group,'labyrinth rockified wall',dx? .50:scale,2.7,dx?scale:.50,cx+dx*scale/2,y+1.35,cz+dz*scale/2,wall);
        block.rotation.y=(rng()-.5)*.08;
        roots(session.group,block.position.x,y,block.position.z,2.6,.06);
      }
    }
    // Maze center always hosts the binding weed; entrance and exit positions
    // depend on the room bounds but never move the centerpiece.
    const center=weed.part.center;weed.group.position.set(center.x,y,center.z);
    session.maze=maze;
    buildSeeds(weed,x0,z0,scale);
    // Grabby hands are separate mobile-visible hazards; a failed grasp
    // releases after a dodge, while a second completed grasp is lethal.
    const hands=[];
    for(let i=0;i<10;i++){
      const a=i*Math.PI*2/10,r=4+(i%3)*2;
      const x=center.x+Math.cos(a)*r,z=center.z+Math.sin(a)*r;
      const hand=roots(session.group,x,y,z,2.3,.12,true);
      hand.name='snaring root hand';hands.push({x,z,mesh:hand,last:0,grasp:0});
    }
    session.hands=hands;
    if(window.RootSnareHands?.create&&window.FoliageGenerator?.buildLogMesh){
      const anchors=hands.map((hand,i)=>{
        const direction=new THREE.Vector3(weed.part.center.x-hand.x,.25,weed.part.center.z-hand.z).normalize();
        return {id:'hachutu-grasp-'+i,sourceKey:'hachutu-root-'+i,role:'wall',
          point:new THREE.Vector3(hand.x,y+1.15,hand.z),direction};
      });
      session.snare=window.RootSnareHands.create({
        THREE,room:{model:session.group,floorY:y},foliage:window.FoliageGenerator,
        explicitAnchors:anchors,seed:'hachutu-'+session.context.seed,count:anchors.length,
        triggerRadius:3.7,reach:5,extendSpeed:2.4,retractSpeed:2.1,
      });
      session.group.add(session.snare.group);
      const actorGroup=new THREE.Group(); // The target root drives hand AI without reparenting the live player mesh.
      let lastMeasuredAt=-Infinity; // Bounds are sampled at most 5 Hz, not once per root hand and render frame.
      let neckY=1.4,feetY=.08; // Used below for the real neck/sole approach before the full snapshot is taken.
      function refreshAnatomy(){
        const time=performance.now();
        if(time-lastMeasuredAt<200)return;
        lastMeasuredAt=time;
        const playerRoot=window.PlayerBodyTransformComposer?.getPlayerMesh?.()
          ||window.WorldPortraitLife?.getPlayerAvatar?.()?.group;
        if(!playerRoot?.isObject3D)return;
        const size=new THREE.Box3().setFromObject(playerRoot);
        if(Number.isFinite(size.min.y)&&Number.isFinite(size.max.y)&&size.max.y-size.min.y>.3){
          feetY=size.min.y;neckY=size.max.y-.1*(size.max.y-size.min.y);
        }
        const rig=window.PlayerBodyTransformComposer;
        const legGroup=rig?.getPlayerLegHandle?.()?.group;
        if(legGroup?.parent){
          const legBounds=new THREE.Box3().setFromObject(legGroup);
          if(Number.isFinite(legBounds.min.y))feetY=legBounds.min.y; // The real procedural soles, not the portrait's painted ankle crop.
        }
        playerRoot.traverse?.(node=>{
          if(node.userData?.neckRig?.available&&node.userData.neckRig.neckJoint?.isBone){
            const neck=node.userData.neckRig.neckJoint.getWorldPosition(new THREE.Vector3());
            if(Number.isFinite(neck.y))neckY=neck.y; // Same live neck joint used by the Headtaker.
          }
        });
      }
      const target={
        group:actorGroup,dualSince:0,grips:0,captureFailed:false,
        getGripPoint(role,out){
          refreshAnatomy();
          out.copy(actorGroup.position);
          out.y=role==='neck'?neckY:feetY;
          return out;
        },
        getGripTarget(role,out){
          if(window.RootSnarePlayerTear?.active?.())return window.RootSnarePlayerTear.gripTarget(role,out);
          return this.getGripPoint(role,out);
        },
        diagnostics(){
          const tear=window.RootSnarePlayerTear?.debug?.();
          return {dual:this.grips===2,tossed:!!tear?.tossed,separated:tear?.stage==='toss',
            stretchSeconds:tear?.seconds||0};
        },
        setNeckGrip(){this.grips=1;},
        startDualCapture(neckAnchor,feetAnchor){
          this.dualSince=performance.now();
          const started=window.RootSnarePlayerTear?.begin?.({
            player:deps.player,areaId:MAP,scene:session.context.scene,floorY:session.floor,
            neckAnchor,feetAnchor,
          })===true;
          this.captureFailed=!started;
          this.grips=started?2:0;
          if(started)deps.showToast?.('The roots grip your neck and feet — dodge before the final pull!',false);
          if(!started){
            session.errors.push('Player root-tear snapshot unavailable: '+JSON.stringify(window.RootSnarePlayerTear?.debug?.()||{}));
            deps.showToast?.('Root capture failed; the grab is released.',false);
          }
        },
        clearNeckGrip(){if(this.grips!==2)this.grips=0;},
        resetAfterSnare(){
          window.RootSnarePlayerTear?.stop?.('dodge-or-release');
          this.grips=0;this.dualSince=0;this.captureFailed=false;
        },
      }; // Real live portrait/legs are bone-baked by the player tear module; no disconnected placeholder halves.
      session.snareTarget=target;
    }
  }
  function updateHands(now,dt){
    const p=session.kit.playerWorld(),target=session.snareTarget,tear=window.RootSnarePlayerTear;
    if(!p||(!inside(p,session.layout.parts[1].bounds,1)&&!tear?.active?.())){
      tear?.stop?.('outside-labyrinth');
      session.snare?.releaseCaptured?.();
      return;
    } // A captured player cannot end a lethal grab by rolling across the labyrinth boundary without paying Stamina.
    if(session.snare&&target){
      target.group.position.set(p.x,session.floor,p.z);
      if((window.Combat?.attach?.hostDodgeEscapes?.(deps.player) === true || (deps.player?.dodging && deps.player?._grappleEscapeDodgePaid === true))&&!tear?.split?.()){
        session.snare.releaseCaptured();
        tear?.stop?.('dodge'); // The dodge remains a counter until the finishing pull actually separates the halves.
        return;
      }
      // Render-only split drives the cinematic camera/hand targets, then the
      // authored hands follow the resulting exact neck and foot endpoints.
      const owner=session; // Root teardown/respawn can run synchronously when the fatal finishing pull completes.
      if(tear?.active?.())tear.update(dt);
      if(session!==owner||owner.ended)return;
      owner.snare.update(dt,target);
      if(!tear?.active?.()&&target.grips===2){owner.snare.releaseCaptured();target.resetAfterSnare();}
      if(target.captureFailed){
        session.snare.releaseCaptured(); // A failed snapshot cannot result in an invisible, uninterruptible kill.
      }
      return;
    }
    // Missing authored hand geometry is a reported encounter failure, never
    // replaced with unanimated instant death; diagnostics stay mobile-visible.
    if(!session.fallbackWarned){
      session.fallbackWarned=true;
      session.errors.push('RootSnareHands unavailable; labyrinth grab hazard disabled.');
    }
  }
  function spawnCoffin(x,z,troop='sentinel',owner=session){
    if(!owner||owner.ended||owner.minions.size>=14)return null;
    const root=new THREE.Group();root.position.set(x,owner.floor-1.7,z);owner.group.add(root);
    const body=cylinder(root,'coffin grown out of roots',.58,.7,1.65,0,.825,0,0x322e25);
    const lid=box(root,'coffin split lid',1.22,.16,.75,0,1.68,0,0x515046);
    for(let i=0;i<4;i++)roots(root,(i%2-.5)*.6,0,(Math.floor(i/2)-.5)*.5,1.8,.06);
    const record={root,body,lid,x,z,troop,time:0,opened:false,spawnPending:false,spawned:null,finished:false};
    owner.coffins.push(record);return record;
  }
  function retireEntity(entity,owner){
    if(!entity)return;
    owner.deps?.hostileObjects?.delete?.(entity);
    owner.deps?.corpseObjects?.delete?.(entity);
    owner.deps?.despawnCreature?.(entity);
    entity.avatarRef?.group?.parent?.remove?.(entity.avatarRef.group);
    entity.groundShadow?.parent?.remove?.(entity.groundShadow);
    entity._banditToolHolder?.parent?.remove?.(entity._banditToolHolder);
    entity.avatarRef?.dispose?.();
  }
  async function spawnMaskbound(record,owner=session,titan=false){
    const combat=window.MaskboundGuardianCombat;
    if(!combat?.makeEntity||!owner||owner.ended||owner.minions.size>=14)return null; // Cap concurrent scripted masks, including unsignaled headtakers.
    const tile=Number(owner.deps?.TILE)||64;
    try{
      const enemy=await combat.makeEntity({troopType:record.troop,tier:titan?4:2,x:record.x*tile,y:record.z*tile,
        zoneId:MAP,scene:owner.context.scene,grid:owner.context.grid,cols:owner.context.cols,rows:owner.context.rows,
        extra:{state:'chase',homeX:record.x*tile,homeY:record.z*tile,hachutuRuin:true}});
      if(!enemy)return null;
      if(owner.ended||session!==owner||owner.deps?.getCurrentArea?.()!==MAP){retireEntity(enemy,owner);return null;}
      if(titan)applyTitanStats(enemy);
      enemy.surfaceYOverride=()=>{
        const s=DS.sampleSupport?.(enemy.x/tile,enemy.y/tile,{minY:-50,maxY:10,pad:.02});
        return Number.isFinite(s?.y)?s.y:owner.floor;
      };
      owner.deps.hostileObjects?.add?.(enemy);owner.minions.add(enemy);owner.ownedEntities.add(enemy); // Retain corpses for deterministic reroll disposal.
      record.spawned=enemy;return enemy;
    }catch(error){owner.errors.push(String(error?.message||error));return null;}
  }
  function applyTitanStats(enemy){
    const d=enemy.def||{};enemy.isMaskboundTitan=true;
    enemy.name='Maskbound Titan — '+(enemy.maskboundTroop||'sentinel');
    enemy.maxHealth=Math.max(1,Number(enemy.maxHealth)||100)*TITAN.health;enemy.health=enemy.maxHealth;
    enemy.maxStamina=Math.max(1,Number(enemy.maxStamina)||100)*TITAN.stamina;enemy.stamina=enemy.maxStamina;
    enemy.maxFooting=Math.max(1,Number(enemy.maxFooting)||100)*TITAN.footing;enemy.footing=enemy.maxFooting;
    d.maxHealth=enemy.maxHealth;d.maxStamina=enemy.maxStamina;d.maxFooting=enemy.maxFooting;
    d.attackDamage=(Number(d.attackDamage)||17)*TITAN.power;
    d.attackRangePx=(Number(d.attackRangePx)||60)*TITAN.range;
    d.moveSpeed=(Number(d.moveSpeed)||115)*TITAN.speed;
    d.chaseSpeed=(Number(d.chaseSpeed)||115)*TITAN.speed;
    d.attackCooldownS=(Number(d.attackCooldownS)||1.2)/TITAN.speed;
    d.weaponShapeStats={...d.weaponShapeStats,speed:(Number(d.weaponShapeStats?.speed)||1)*TITAN.speed};
    // Three times slower swing timeline, not merely longer cooldown.
    // The shared bandit AI consumes weaponShapeStats.speed for combo windup/strike.
    enemy.visualScaleX=(Number(enemy.visualScaleX)||1)*TITAN.scale;
    enemy.visualScaleY=(Number(enemy.visualScaleY)||1)*TITAN.scale;
    enemy.visualScaleZ=(Number(enemy.visualScaleZ)||1)*TITAN.scale;
    enemy.halfHeight=(Number(enemy.halfHeight)||.8)*TITAN.scale;
    enemy.groundShadow?.scale?.multiplyScalar?.(TITAN.scale); // Character mesh scale is regenerated from visualScaleX/Y/Z every frame.
    enemy.hachutuTitanTuning={...TITAN};
    // Attacks with fixed bespoke quick/charged timings are not eligible
    // for a Titan: its normal staged combo honors the 1/3 speed multiplier.
    d.banditAbilityLoadout={...d.banditAbilityLoadout,tap2:null,hold1:null,hold2:null};
    return enemy;
  }
  function updateCoffins(dt){
    for(const c of session.coffins){
      c.time+=dt;
      c.root.position.y=session.floor-1.7+Math.min(1,c.time/1.1)*1.7;
      if(c.time>=1.1&&!c.opened){
        c.opened=true;c.lid.rotation.x=-.95;
        c.spawnPending=true;
        spawnMaskbound(c,session,c.titan).finally(()=>{c.spawnPending=false;});
      }
      if(c.time>3.4)c.root.position.y=session.floor-Math.min(1.7,(c.time-3.4)*.9);
      if(c.time>5.6&&!c.finished){c.finished=true;c.root.parent?.remove(c.root);c.root.traverse(item=>{item.geometry?.dispose?.();item.material?.dispose?.();});}
    }
    session.coffins=session.coffins.filter(c=>!c.finished);
    for(const minion of [...session.minions])if(!(Number(minion.health)>0)||minion.dead===true||!deps?.hostileObjects?.has?.(minion))session.minions.delete(minion);
  }
  // ---- Hall puzzles --------------------------------------------------------------------------------------
  // Labyrinth: each binding-fire ring is fed by an ember seed hidden at a far dead end of the DFS maze.
  // Trial: three sap bulbs must all be lit at once (each stays lit eight seconds) while coffins attack.
  const BULB_LIT_MS=8000;
  function pickSeedCells(maze,count=3){
    const adj=new Map(),key=(x,z)=>x+','+z;
    for(const [a,b] of maze.edges){
      const ka=key(...a),kb=key(...b);
      if(!adj.has(ka))adj.set(ka,[]);if(!adj.has(kb))adj.set(kb,[]);adj.get(ka).push(kb);adj.get(kb).push(ka);
    }
    const dist=new Map([['0,0',0]]),queue=['0,0'];
    for(let i=0;i<queue.length;i++)for(const next of adj.get(queue[i])||[])if(!dist.has(next)){dist.set(next,dist.get(queue[i])+1);queue.push(next);}
    const centre=Math.floor(maze.n/2)+','+Math.floor(maze.n/2);
    const ends=[...dist.keys()].filter(k=>k!=='0,0'&&k!==centre&&(adj.get(k)||[]).length===1).sort((a,b)=>dist.get(b)-dist.get(a)||(a<b?-1:1));
    const picked=[],far=(a,b)=>{const [ax,az]=a.split(',').map(Number),[bx,bz]=b.split(',').map(Number);return Math.abs(ax-bx)+Math.abs(az-bz)>=4;};
    for(const cell of ends)if(picked.length<count&&picked.every(o=>far(o,cell)))picked.push(cell);
    for(const cell of ends)if(picked.length<count&&!picked.includes(cell))picked.push(cell); // Small mazes: relax the spread rule.
    return picked.map(k=>k.split(',').map(Number));
  }
  function buildSeeds(weed,x0,z0,scale){
    session.seeds=[];
    pickSeedCells(session.maze,3).forEach(([cx,cz],i)=>{
      const color=weed.rings[i]?.torus.material.color.getHex()??COLORS[i];
      const x=x0+cx*scale,z=z0+cz*scale,group=new THREE.Group();group.position.set(x,session.floor,z);session.group.add(group);
      const gem=mesh(group,'ember seed',new THREE.IcosahedronGeometry(.28,0),material(color),0,.9,0);
      const beam=cylinder(group,'ember seed beam',.04,.04,2.2,0,1.1,0,color);
      gem.userData.devRuinFootprintIgnore=true;beam.userData.devRuinFootprintIgnore=true;gem.userData.interactive3D=true;
      session.seeds.push({index:i,group,gem,x,z,taken:false});
    });
  }
  function takeSeed(seed){
    if(!seed||seed.taken)return false;
    seed.taken=true;seed.group.visible=false;
    const left=session.seeds.filter(s=>!s.taken).length;
    session.deps?.showToast?.(left?'An ember seed quenches a ring of binding fire — '+left+' to find.':'The last ember seed is spent. The labyrinth weed lies bare.',true);
    takeRing(session.weeds[1],seed.index);
    return true;
  }
  function updateSeeds(now){
    for(const seed of session.seeds||[])if(!seed.taken){seed.gem.rotation.y=now*.002;seed.gem.position.y=.9+.08*Math.sin(now*.003+seed.index);}
  }
  function buildBulbs(){
    const b=session.layout.parts[2].bounds,y=session.floor;
    session.bulbs=[];
    for(let i=0;i<3;i++){
      const x=b.minX+(i+1)*(b.maxX-b.minX)/4,z=b.minZ+1.6;
      const stalk=cylinder(session.group,'sap bulb stalk',.07,.12,2.0,x,y+1.0,z,0x2d2a22);stalk.userData.devRuinFootprintIgnore=true;
      const bulb={index:i,x,z,litUntil:0,lit:false,
        mesh:mesh(session.group,'sap bulb',new THREE.IcosahedronGeometry(.4,1),new THREE.MeshBasicMaterial({color:0x4a3f1f}),x,y+2.3,z)};
      bulb.mesh.userData.devRuinFootprintIgnore=true;bulb.mesh.userData.interactive3D=true;
      bulb.target=session.kit.registerProjectileTarget({id:'hachutu-sap-bulb-'+i,object:bulb.mesh,hitMesh:bulb.mesh,active:false,
        hittable:()=>!session.trial?.resonance,onHit:()=>strikeBulb(bulb)});
      session.bulbs.push(bulb);
    }
  }
  function strikeBulb(bulb,now=performance.now()){
    const trial=session.trial;
    if(!bulb||!trial||trial.resonance)return false;
    bulb.litUntil=now+BULB_LIT_MS;
    if(session.bulbs.every(item=>item.litUntil>now)){
      trial.resonance=true;session.bulbs.forEach(item=>{item.target.active=true;});
      session.deps?.showToast?.('The sap bulbs sing in unison — the Binding Weed stirs.',true);
      window.AudioSystem?.playObjectSfxKey?.('puzzleComplete');
    }else session.deps?.showToast?.(session.bulbs.filter(item=>item.litUntil>now).length+' of 3 sap bulbs lit — strike them all within '+BULB_LIT_MS/1000+' seconds.',false);
    return true;
  }
  function updateBulbs(){
    const trial=session.trial,now=performance.now();if(!trial)return; // Same clock as strikeBulb, independent of the scheduler's timestamp.
    for(const bulb of session.bulbs||[]){
      const lit=trial.resonance||bulb.litUntil>now;
      if(lit!==bulb.lit){bulb.lit=lit;bulb.mesh.material.color.setHex(lit?0xffd24a:0x4a3f1f);}
      if(lit)bulb.mesh.scale.setScalar(1+.08*Math.sin(now*.008+bulb.index));
    }
    if(!trial.hinted&&!trial.resonance&&session.weeds[2].rings.every(r=>!r.torus.visible)){
      trial.hinted=true;session.deps?.showToast?.('The weed\'s roots hum. Light all three sap bulbs on the north wall at once.',true);
    }
  }
  function buildTrial(weed,rng){
    const b=weed.part.bounds,y=session.floor;
    for(let i=0;i<12;i++){
      const x=b.minX+2+rng()*(b.maxX-b.minX-4),z=b.minZ+2+rng()*(b.maxZ-b.minZ-4);
      if(Math.hypot(x-weed.part.center.x,z-weed.part.center.z)<3)continue;
      cylinder(session.group,'combat cover standing stone',.45,.67,1.8,x,y+.9,z,0x45463c);
      roots(session.group,x,y,z,2,.08);
    }
    session.trial={wave:0,remaining:0,pending:0,started:false,nextAt:0,cleared:false,resonance:false,hinted:false};
    weed.requires=()=>session.trial.resonance;
    buildBulbs();
  }
  function startWave(){
    const trial=session.trial;if(!trial||trial.wave>=3)return;
    trial.wave++;trial.remaining=0;trial.pending=3+trial.wave;
    const b=session.layout.parts[2].bounds;
    for(let i=0;i<trial.pending;i++){
      const x=b.minX+2.5+(i%2)*(b.maxX-b.minX-5),z=b.minZ+3+Math.floor(i/2)*3;
      const coffin=spawnCoffin(x,z,TYPES[(i+trial.wave)%TYPES.length]);if(coffin){coffin.wave=trial.wave;trial.remaining++;}else trial.pending--;
    }
    session.deps?.showToast?.('Maskbound wave '+trial.wave+' of 3!',true);
  }
  function updateTrial(now){
    const t=session.trial,p=session.kit.playerWorld();if(!t)return;
    if(!t.started&&inside(p,session.layout.parts[2].bounds,1)){t.started=true;startWave();}
    if(!t.started||t.cleared)return;
    // The coffin retains the spawned enemy even after it has been removed from the active-minion Set.
    const alive=session.coffins.some(c=>c.wave===t.wave&&(c.spawnPending||!c.opened||c.spawned&&c.spawned.health>0));
    if(!alive&&now>t.nextAt){
      takeRing(session.weeds[2],t.wave-1);
      if(t.wave<3){if(!t.nextAt)t.nextAt=now+2600;else if(now>=t.nextAt){t.nextAt=0;startWave();}}else t.cleared=true;
    }
  }
  // ---- Root-grown gates between halls ---------------------------------------------------------------------
  // Each hall seals its exit with a plug of roots grown by the Root Growth Author's own solver around an invisible
  // door-panel guide (the author's showGuide:false look). Severing the hall's binding weed makes the author's own
  // retract() animation pull the roots back; the collision seal releases once they have mostly withdrawn.
  function buildGate(id,passage,isOpen){
    const y=session.floor,x=(passage.minX+passage.maxX)/2,z=(passage.minZ+passage.maxZ)/2;
    const gate={id,x,z,isOpen,open:false,blocking:true,growth:null,lastHintAt:0};
    for(const side of [-1,1]){
      const post=cylinder(session.group,'root gate stone post',.42,.55,4.2,x,y+2.1,z+side*1.85,0x2d2f29);
      post.userData.devRuinFootprintIgnore=true; // The solid seal below is the one collision authority.
    }
    gate.passage=passage; // Roots are grown by growGateRoots() once this passage's floor root mat exists.
    window.DevRandomRuinTileOccupancy?.addSolidBox?.('hachutu-gate-'+id,{cx:x,cz:z,halfX:.6,halfZ:1.7},()=>!!session&&gate.blocking,'hachutu-door');
    session.gates.push(gate);
    return gate;
  }
  // Grows a gate's root plug FROM the passage's floor root mat (LiveRootGrowth growthSource): its branches start at
  // real floor strands, so when the gate retracts the roots withdraw back into the substrate. The guide is placed at
  // its world position and the growth group stays at the origin, which is what keeps the substrate's world-space
  // nodes aligned with the branches. Falls back to the author's own flat floor patch if no substrate is available.
  function growGateRoots(gate,substrate){
    const LRG=window.LiveRootGrowth;
    if(gate.growth||!LRG?.create||!window.FoliageGenerator?.buildSurfaceGrowth)return;
    const y=session.floor;
    const build=source=>{
      const guide=new THREE.Group(),panel=new THREE.Mesh(new THREE.BoxGeometry(.5,3.6,3.3),material(0x383a34));
      panel.position.set(gate.x,y+1.8,gate.z);guide.add(panel);
      const growth=LRG.create({THREE,foliage:window.FoliageGenerator,target:guide,...(source?{growthSource:source}:{}),
        recipe:{seed:'hachutu-gate-'+gate.id+'-'+session.context.seed,branchCount:10,strandLimit:34,
          floorWidth:3.4,floorDepth:3.4,floorY:y,floorDensity:.6,targetDensity:1.5,
          radius:.07,branchRadius:.09,showGuide:false,duration:2.8},
        progress:1,rootFinish:{color:'#24211d',texture:'assets/textures/wibbly_surface.png'}});
      growth.setProgress(1);growth.group.userData.devRuinFootprintIgnore=true;
      return growth;
    };
    try{gate.growth=build(substrate);gate.onSubstrate=!!substrate;}
    catch(error){
      session.errors.push('Gate '+gate.id+' substrate roots: '+String(error?.message||error));
      try{gate.growth=build(null);}catch(inner){session.errors.push('Gate '+gate.id+' roots: '+String(inner?.message||inner));}
    }
    if(gate.growth){
      session.group.add(gate.growth.group);
      if(gate.open)gate.growth.setProgress(0);
    }
  }
  function updateGates(dt,now,p){
    for(const gate of session.gates){
      const open=gate.isOpen();
      if(open&&!gate.open){
        gate.open=true;gate.growth?.retract();
        session.deps?.showToast?.('The roots withdraw from the passage.',true);
      }
      const growth=gate.growth;
      if(growth&&growth.getProgress()>0)growth.update(dt); // Idle (fully retracted) gates cost nothing per frame.
      gate.blocking=!gate.open||(growth?growth.getProgress()>.35:false);
      if(!gate.open&&p&&now-gate.lastHintAt>7000&&Math.hypot(p.x-gate.x,p.z-gate.z)<3){
        gate.lastHintAt=now;session.deps?.showToast?.('Roots bar the way. Sever this hall\'s binding weed.',false);
      }
    }
  }
  function buildDoor(kit){
    const a=session.layout.parts[3],b=a.bounds,y=session.floor;
    const x=b.minX+.25,z=a.center.z,root=session.group;
    const frame=box(root,'temple heart door frame',.95,7,5,x,y+3.5,z,0x262922);frame.userData.devRuinFootprintIgnore=true; // Roots gate progress; don't leave a permanent invisible collider after they retract.
    const layers=[];
    for(let i=0;i<3;i++){
      const g=new THREE.Group();g.position.set(x+.17+i*.15,y,z);root.add(g);
      for(let j=0;j<9;j++){
        const rz=z-1.9+j*.47;
        const r=roots(g,0,0,rz,5.9,.18);r.rotation.z=.2*(j-4);
      }
      const color=COLORS[(i+2)%COLORS.length];
      const ember=emberRing(g,0,3,0,2.0-i*.3,color);
      const fx=window.AuthoredFurniture?.createEmitterVisual?.(g,{
        id:'hachutu-root-embers-'+i,name:'Binding Root Embers',type:'fire',enabled:true,
        position:{x:0,y:2,z:0},rotation:{x:0,y:0,z:0},
        radius:.13,size:.12,rate:24,lifetime:.55,speed:.16,spread:.6,gravity:.01,
        colorA:'#'+color.toString(16).padStart(6,'0'),colorB:'#'+color.toString(16).padStart(6,'0'),
      },48)||null; // The same authored fire emitter as the torch/ruin fires, kept distinct for each root seal.
      layers.push({group:g,ember,fx,color});
    }
    session.door={layers,open:false};
    window.DevRandomRuinTileOccupancy?.addSolidBox?.('hachutu-temple-heart-lock',{cx:x,cz:z,halfX:.52,halfZ:2.45},()=>!!session&&!session.door?.open,'hachutu-door'); // One semantic collision seal; retracting visual roots are non-solid.
  }
  function updateDoor(dt){
    const count=session.weedsKilled;
    for(let i=0;i<3;i++){
      const item=session.door.layers[i],retracted=i<count;
      item.group.position.y+=Math.max(-dt*2.4,Math.min(dt*2.4,(session.floor+(retracted?-7:0))-item.group.position.y));
      item.ember.setActive(!retracted);
      if(!retracted)item.fx?.update?.(dt,true,{colorA:'#'+item.color.toString(16).padStart(6,'0'),colorB:'#'+item.color.toString(16).padStart(6,'0')});
    }
    session.door.open=count>=3;
  }
  function buildHeart(){
    const b=session.layout.parts[3].bounds,y=session.floor;
    for(let i=0;i<10;i++){
      const a=2*Math.PI*i/10;
      const x=session.layout.parts[3].center.x+Math.cos(a)*8,z=session.layout.parts[3].center.z+Math.sin(a)*8;
      cylinder(session.group,'Titan arena ancestor totem',.5,.76,3.5,x,y+1.75,z,0x34372f);
      roots(session.group,x,y,z,4,.12);
    }
    session.heart={spawned:false,pending:false,boss:null,lastAddAt:0,defeated:false};
  }
  function updateHeart(now){
    const h=session.heart,p=session.kit.playerWorld();
    if(!h||!session.door.open)return;
    if(!h.spawned&&!h.pending&&inside(p,session.layout.parts[3].bounds,2)){
      h.pending=true;h.spawned=true;
      const part=session.layout.parts[3],record={troop:TYPES[Math.floor(session.rng()*3)],x:part.center.x+1,z:part.center.z};
      spawnMaskbound(record,session,true).then(boss=>{h.boss=boss;h.pending=false;
        session.deps?.showToast?.(boss?'The Maskbound Titan awakens!':'Titan summoning failed — see ruin diagnostics.',!!boss);
      });
      h.lastAddAt=now;
    }
    if(h.boss&&(!(Number(h.boss.health)>0)||h.boss.dead===true||!deps.hostileObjects?.has?.(h.boss))&&!h.defeated){
      h.defeated=true;session.deps?.showToast?.('The Temple Heart falls silent. Its ancestor vault opens.',true);
      for(const enemy of session.minions){if(enemy!==h.boss&&enemy.health>0)deps?.damageCreature?.(enemy,enemy.health+999,undefined,undefined,0,{});} // Ads fall with their Titan; corpse cleanup remains session-owned.
    }
    if(h.boss&&!h.defeated&&now-h.lastAddAt>12000){
      h.lastAddAt=now;const b=session.layout.parts[3].bounds;
      for(let i=0;i<2;i++)spawnCoffin(b.minX+3+i*(b.maxX-b.minX-6),b.minZ+3+(i%2)*5,i?'headtaker':'sentinel');
    }
  }
  function buildVault(){
    const b=session.layout.parts[4].bounds,y=session.floor,kit=session.kit;
    session.chests=[];
    for(let i=0;i<3;i++){
      const x=b.minX+3+i*2.6,z=b.minZ+3;
      const chest=window.DevRandomRuinDungeonChests?.create?.({
        id:'hachutu-heart-'+i,x,y,z,tier:4,boss:i===0,culture:'hachutu',parent:session.group,
      });
      if(chest)session.chests.push(chest);
      roots(session.group,x,y,z+1.4,2.4,.06);
    }
  }
  function controls(){
    if(!session||session.ended)return [];
    const controls=[];
    const p=session.kit.playerWorld();
    if(!session.entered){
      controls.push({kind:'hachutuEnter',object:session.entryMarker,promptRoot:session.entryMarker,range:2.4,priority:26,claimAction1:true,
        label:'Enter the Hachutu Root Temple',touchIcon:'🌿',
        onPress:()=>{session.entered=true;session.kit.setPlayerWorld({x:session.layout.parts[0].bounds.minX+1.5,z:session.layout.parts[0].center.z,y:session.floor},true,true);}});
    }else{
      controls.push({kind:'hachutuReturn',object:session.returnMarker,promptRoot:session.returnMarker,range:2.1,priority:21,claimAction1:true,
        label:'Return to the Ruin',touchIcon:'🚪',onPress:()=>{session.entered=false;session.kit.setPlayerWorld(session.entry,true,true);}}); // entered=false re-arms the entrance gate and the abyss/encounter updates.
    }
    for(const weed of session.weeds)if(weedExposed(weed))controls.push({
      kind:'bindingWeed',object:weed.crown,promptRoot:weed.group,range:2.8,priority:28,claimAction1:true,
      label:()=>weed.damage?'Sever Binding Weed ('+weed.damage+'/3)':'Attack Binding Weed',touchIcon:'🌱',onPress:()=>strikeWeed(weed),
    });
    for(const seed of session.seeds||[])if(!seed.taken)controls.push({
      kind:'hachutuSeed',object:seed.gem,promptRoot:seed.group,range:2.2,priority:27,claimAction1:true,
      label:'Take Ember Seed',touchIcon:'🔥',onPress:()=>takeSeed(seed),
    });
    if(session.trial&&!session.trial.resonance)for(const bulb of session.bulbs||[])controls.push({
      kind:'hachutuSapBulb',object:bulb.mesh,promptRoot:bulb.mesh,range:2.6,priority:27,claimAction1:true,
      label:()=>bulb.litUntil>performance.now()?'Sap Bulb (lit)':'Strike Sap Bulb',touchIcon:'🟡',onPress:()=>strikeBulb(bulb),
    });
    if(session.heart?.defeated)controls.push(...(window.DevRandomRuinDungeonChests?.controlsFor?.(session.chests)||[]));
    return controls;
  }
  // ---- Author-style floor roots -------------------------------------------------------------------------
  // The Root Growth Author's own solver (LiveRootGrowth.createCoverAsync + the Life Temple root recipe, the same
  // path Stone Age ruins use for their floors) grows roots across each temple floor. Tagged proxy slabs stand in
  // for the real floor meshes so the generator has a clean 'floors' surface to sample; the proxies are discarded,
  // only the generated strands are kept (and disposed with the session).
  let templeRootRecipes=null;
  function loadTempleRootRecipes(){
    if(templeRootRecipes)return templeRootRecipes;
    templeRootRecipes=fetch(new URL('config/pieces/temple.json',document.baseURI)).then(response=>{
      if(!response.ok)throw new Error('temple.json HTTP '+response.status);return response.json();
    }).then(data=>(data.surfaceGrowth||[]).filter(item=>item.kind==='roots'||item.kind==='vines')).catch(error=>{templeRootRecipes=null;throw error;});
    return templeRootRecipes;
  }
  function floorProxy(target,rects){
    for(const b of rects){
      const proxy=new THREE.Mesh(new THREE.BoxGeometry(b.maxX-b.minX,.3,b.maxZ-b.minZ),new THREE.MeshBasicMaterial({color:0x363733}));
      proxy.position.set((b.minX+b.maxX)/2,session.floor-.15,(b.minZ+b.maxZ)/2);
      proxy.userData={surfaceFoliageRole:'floors'};target.add(proxy);
    }
  }
  function wallProxy(target,b){
    const y=session.floor,t=.8,h=4;
    for(const [w,d,x,z] of [[b.maxX-b.minX,t,(b.minX+b.maxX)/2,b.minZ],[b.maxX-b.minX,t,(b.minX+b.maxX)/2,b.maxZ],[t,b.maxZ-b.minZ,b.minX,(b.minZ+b.maxZ)/2],[t,b.maxZ-b.minZ,b.maxX,(b.minZ+b.maxZ)/2]]){
      const proxy=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshBasicMaterial({color:0x34352e}));
      proxy.position.set(x,y+h/2,z);proxy.userData={surfaceFoliageRole:'walls'};target.add(proxy);
    }
  }
  const COVER_SIMPLIFY=1.0; // Preserve finer centerline detail in the denser Hachutu substrate.
  const scaleRecipe=(recipe,factor)=>({...recipe,count:Math.max(8,Math.round(recipe.count*factor)),strandLimit:Math.max(8,Math.round(recipe.strandLimit*factor))});
  function triStats(group){
    let tris=0,meshes=0;
    group.traverse(node=>{if(node.isMesh){meshes++;const g=node.geometry;tris+=(g.index?g.index.count:g.attributes.position.count)/3;}});
    return {tris:Math.round(tris),meshes};
  }
  async function growWingCover(owner){
    try{
      const LRG=window.LiveRootGrowth,FG=window.FoliageGenerator,SA=window.StoneAgeRuinScenery;
      if(!LRG?.createCoverAsync||!FG?.normalizeSurfaceGrowth)throw new Error('Root Growth Author cover is unavailable.');
      const authored=await loadTempleRootRecipes();
      if(!authored.some(item=>item.kind==='roots'))throw new Error('Life Temple root recipe is missing.');
      // The ruin preview's own vegetation recipes: wall roots/vines plus the floor-cover variants (natural roots and
      // wrap vines across the floor, 80 strands each). That is the substrate the author's preview shows.
      const all=SA?.coverRecipes?SA.coverRecipes(authored,'#24211d'):authored.map(item=>({...item,color:item.kind==='roots'?'#24211d':item.color}));
      const floorRecipes=all.filter(item=>item.target==='floors'||item.target==='all').map(item=>({...item,target:'floors'}));
      const wallRecipes=all.filter(item=>item.target!=='floors').map(item=>item.target==='all'?{...item,target:'walls'}:item);
      if(!floorRecipes.length)throw new Error('Preview floor recipes are missing.');
      owner.cover=[];
      const swing=owner.layout.parts[0].bounds,inset=3;
      const jobs=[ // One independent strand budget per room so no single hall hoards the roots.
        ['swing',[rect(swing.minX,swing.minZ,inset,swing.maxZ-swing.minZ),rect(swing.maxX-inset,swing.minZ,inset,swing.maxZ-swing.minZ),
          rect(swing.minX+inset,swing.minZ,swing.maxX-swing.minX-inset*2,inset),rect(swing.minX+inset,swing.maxZ-inset,swing.maxX-swing.minX-inset*2,inset)],swing],
        ...owner.layout.parts.slice(1).map(part=>[part.name,[part.bounds],part.bounds]),
        ...owner.layout.passages.map((b,i)=>['passage-'+i,[b],null]),
      ];
      const attach=(name,kind,cover)=>{
        owner.group.add(cover.targetGrowth); // targetGrowth lives in world space; the cloned proxy slabs are left behind.
        cover.targetGrowth.traverse(node=>{node.userData.devRuinFootprintIgnore=true;});
        cover.target.traverse(node=>{if(node.geometry&&!node.userData.surfaceFoliage&&node.parent!==cover.targetGrowth)node.visible=false;});
        owner.cover.push({name,kind,cover,...triStats(cover.targetGrowth)});
      };
      for(const [name,rects,hall] of jobs){
        if(owner.ended||session!==owner)return;
        const area=rects.reduce((sum,b)=>sum+(b.maxX-b.minX)*(b.maxZ-b.minZ),0);
        const factor=Math.max(.6,Math.min(1.5,area/300))*1.5; // Give every room and corridor a denser root budget.
        const target=new THREE.Group();floorProxy(target,rects);
        const floor=await LRG.createCoverAsync({THREE,foliage:FG,target,recipes:floorRecipes.map(item=>scaleRecipe(item,factor*1.5)),seed:'hachutu:'+owner.context.seed+':'+name,floorY:owner.floor});
        if(owner.ended||session!==owner){floor.dispose();return;}
        // Halve substrate thickness without shrinking its XZ footprint. Sink the bottom
        // root layer so its vertical center sits just below ground, clipping its lower half.
        const rootBox=new THREE.Box3().setFromObject(floor.targetGrowth);
        const rootHeight=Math.max(.001,rootBox.max.y-rootBox.min.y);
        floor.targetGrowth.scale.y*=.5;
        floor.targetGrowth.updateMatrixWorld(true);
        const compressedBox=new THREE.Box3().setFromObject(floor.targetGrowth);
        floor.targetGrowth.position.y+=owner.floor+.05-(compressedBox.min.y+Math.min(.1,rootHeight*.025));
        floor.targetGrowth.updateMatrixWorld(true);
        floor.targetGrowth.traverse(node=>{if(node.isMesh)node.userData.hachutuGroundRoot=true;});
        try{SA?.compactFloorCover?.(floor.targetGrowth,COVER_SIMPLIFY);}catch(_){} // Keep finer strands after raising density.
        attach(name,'floor',floor);
        if(hall&&wallRecipes.length){ // Halls also get the preview's wall root/vine weave.
          const wallTarget=new THREE.Group();wallProxy(wallTarget,hall);
          const walls=await LRG.createCoverAsync({THREE,foliage:FG,target:wallTarget,recipes:wallRecipes.map(item=>scaleRecipe(item,factor*.9)),seed:'hachutu:'+owner.context.seed+':walls:'+name,floorY:owner.floor});
          if(owner.ended||session!==owner){walls.dispose();return;}
          try{SA?.compactFloorCover?.(walls.targetGrowth,COVER_SIMPLIFY);}catch(_){} // Walls get the same ring simplification.
          attach(name,'walls',walls);
        }
        const gate=owner.gates.find(item=>name==='passage-'+owner.layout.passages.indexOf(item.passage));
        if(gate)growGateRoots(gate,floor.targetGrowth); // This passage's gate grows out of the mat just laid.
      }
      for(const gate of owner.gates)growGateRoots(gate,null); // Any gate whose passage had no mat still gets its plug.
      owner.coverReady=true;
    }catch(error){
      if(owner){owner.errors.push('Temple floor roots: '+String(error?.message||error));for(const gate of owner.gates)growGateRoots(gate,null);}
    }
  }
  function buildRooms(kit,context,rng,usedRooms,options){
    if(context.hachutu!==true)return;
    deps=kit.deps;const layout=reserved;
    if(!layout)throw new Error('Hachutu reserved rooms were not projected.');
    session={kit,context,deps,layout,gates:[],seeds:[],bulbs:[],group:new THREE.Group(),floor:Number(context.meta?.floorSurfaceY)||0,
      rng:rndSeed(context.seed^0xfada),weeds:[],weedsKilled:0,coffins:[],minions:new Set(),ownedEntities:new Set(),platforms:[],hands:[],chests:[],errors:[],ended:false,entered:false,
      entry:{x:context.spawn.x,z:context.spawn.z,y:Number(context.meta?.floorSurfaceY)||0}};
    kit.group().add(session.group);session.group.name='hachutu-root-temple';
    session.rootBatch=new THREE.Group(); // Detached collector for static roots; baked into merged meshes before the build ends.
    // The V50 floor registry only creates surfaces for interiorShell.floorCells.
    // The exclusive Hachutu wing is a projection-only extension, so it owns
    // all its support rectangles and the dangerous central void explicitly.
    const addFloor=(id,b)=>kit.registerSurface({id:'hachutu-floor-'+id,
      bounds:{minX:b.minX,maxX:b.maxX,minZ:b.minZ,maxZ:b.maxZ},topY:session.floor,priority:2});
    layout.parts.slice(1).forEach(p=>addFloor(p.name,p.bounds));
    layout.passages.forEach((b,i)=>addFloor('passage-'+i,b));
    const b=layout.parts[0].bounds,inset=3;
    addFloor('swing-west',rect(b.minX,b.minZ,inset,b.maxZ-b.minZ));
    addFloor('swing-east',rect(b.maxX-inset,b.minZ,inset,b.maxZ-b.minZ));
    addFloor('swing-north',rect(b.minX+inset,b.minZ,b.maxX-b.minX-inset*2,inset));
    addFloor('swing-south',rect(b.minX+inset,b.maxZ-inset,b.maxX-b.minX-inset*2,inset));
    DS.registerPit({id:'hachutu-abyss',scope:kit.SCOPE,
      bounds:{minX:b.minX+inset,maxX:b.maxX-inset,minZ:b.minZ+inset,maxZ:b.maxZ-inset}});
    session.lastLabyrinthSpawnAt=0;session.lastCorridorSpawnAt=0;session.lastSwingSpawnAt=0;
    for(const part of layout.parts)sculptRoom(part,kit);
    buildPassages();
    for(const index of [0,1,2])session.weeds.push(createWeed(layout.parts[index],session.rng));
    buildSwing(session.weeds[0],session.rng);
    buildLabyrinth(session.weeds[1],session.rng);
    buildTrial(session.weeds[2],session.rng);
    buildGate('swing',layout.passages[0],()=>session.weeds[0].done);
    buildGate('labyrinth',layout.passages[1],()=>session.weeds[1].done);
    buildDoor(kit);buildHeart();buildVault();
    flushRootBatch();
    session.entryMarker=box(session.group,'Hachutu entrance root gate',.6,2,.6,session.entry.x,session.floor+1,session.entry.z,0x43875d);
    session.returnMarker=box(session.group,'Hachutu exit root gate',.6,2,.6,layout.parts[0].bounds.minX+1.5,session.floor+1,layout.parts[0].center.z,0x43875d);
    session.entryMarker.userData.interactive3D=true;session.returnMarker.userData.interactive3D=true;
    session.returnMarker.userData.devRuinFootprintIgnore=true;session.entryMarker.userData.devRuinFootprintIgnore=true;
    const occlusion=window.DevRandomRuin?.getOcclusionMeshes?.(); // Reuse the Harlyao interior camera boom's authoritative wall/roof collision list.
    session.occluders=[];
    if(occlusion)session.group.traverse(node=>{
      if(node.isMesh&&/(wall|ceiling)/i.test(node.name)){occlusion.push(node);session.occluders.push(node);}
    });
    kit.recordModulePlacement('hachutuRootTemple','dev',String(context.seed),{parts:layout.parts.map(p=>p.name),rooted:true,devOnly:true});
    growWingCover(session); // Async: author-style floor roots appear a moment after the rooms, without blocking the build.
    // The temple is the point of the Hachutu generator: arrive inside it. (The stripped, puzzle-less V50 vestibule
    // used to be the spawn, so a tester saw only empty rooms and Harlyao doors.) The exit gate still returns there.
    session.entered=true;
    kit.setPlayerWorld({x:layout.parts[0].bounds.minX+1.5,z:layout.parts[0].center.z,y:session.floor},true,true);
  }
  function update(kit,now,dt){
    if(!session||session.ended)return;
    updateCoffins(dt);
    if(session.entered){
      updateSwing(dt,now);updateHands(now,dt);updateSeeds(now);updateBulbs();updateTrial(now);updateDoor(dt);updateHeart(now);
      const p=kit.playerWorld();
      updateGates(dt,now,p);
      if(p&&inside(p,session.layout.parts[1].bounds,1)&&now-session.lastLabyrinthSpawnAt>9500){
        session.lastLabyrinthSpawnAt=now;
        const b=session.layout.parts[1].bounds;
        spawnCoffin(b.minX+2+session.rng()*(b.maxX-b.minX-4),b.maxZ-2,'sentinel');
        // Headtakers enter from the farthest corner rather than announcing
        // themselves with a grown coffin (the player must keep looking around).
        const far=[{x:b.minX+2,z:b.minZ+2},{x:b.maxX-2,z:b.minZ+2},{x:b.minX+2,z:b.maxZ-2},{x:b.maxX-2,z:b.maxZ-2}]
          .sort((a,c)=>Math.hypot(c.x-p.x,c.z-p.z)-Math.hypot(a.x-p.x,a.z-p.z))[0];
        spawnMaskbound({x:far.x,z:far.z,troop:'headtaker'},session);
      }
      if(p&&session.layout.passages.some(b=>inside(p,b))&&now-session.lastCorridorSpawnAt>15000){
        session.lastCorridorSpawnAt=now;
        spawnCoffin(p.x+1.2,p.z+.4,TYPES[Math.floor(session.rng()*3)]);
      }
    }
  }
  function clear(){
    if(!session)return;
    session.ended=true;
    window.RootSnarePlayerTear?.stop?.('ruin-cleanup'); // Restore original model, camera and owned fragments on reroll/exit.
    window.DevRandomRuinTileOccupancy?.clearSolids?.('hachutu-door'); // Release the mutable Temple Heart gate before the next ruin build.
    session.snare?.releaseCaptured?.();session.snare?.dispose?.();session.pillarRootTemplate?.dispose?.();
    for(const entry of session.cover||[])entry.cover.dispose?.();
    for(const gate of session.gates||[])gate.growth?.dispose?.();
    for(const layer of session.door?.layers||[])layer.fx?.dispose?.();
    for(const c of session.coffins)c.root.parent?.remove(c.root);
    for(const enemy of session.ownedEntities)retireEntity(enemy,session);
    session.minions.clear();session.ownedEntities.clear();
    const occlusion=window.DevRandomRuin?.getOcclusionMeshes?.();
    if(occlusion)for(const mesh of session.occluders||[]){const index=occlusion.indexOf(mesh);if(index>=0)occlusion.splice(index,1);}
    session.group.parent?.remove(session.group);
    session.group.traverse(obj=>{if(obj.geometry&&!obj.geometry.userData?.devRuinSharedPrimitive)obj.geometry.dispose?.();
      if(obj.material){for(const m of Array.isArray(obj.material)?obj.material:[obj.material])m.dispose?.();}});
    for(const geometry of session.rockCache?.values?.()||[])geometry.dispose?.();
    sharedMaterials.clear();session=null;reserved=null;
  }
  function snapshot(){
    if(!session)return {active:false};
    return {active:true,devOnly:true,entered:session.entered,rooms:session.layout.parts.map(p=>p.name),
      plants:session.weeds.map(w=>({name:w.name,dead:w.done,hits:w.damage,rings:w.rings.filter(r=>r.torus.visible).length})),
      pit:session.abyss,platforms:session.platforms.length,ropes:session.vineRopes?.length||0,mazeCells:session.maze?.visited.size||0,
      rootHands:session.hands.length,gates:(session.gates||[]).map(g=>({id:g.id,open:g.open,blocking:g.blocking,grown:g.growth?+g.growth.getProgress().toFixed(2):null,onSubstrate:!!g.onSubstrate})),floorRoots:(session.cover||[]).map(c=>({room:c.name,kind:c.kind,tris:c.tris,meshes:c.meshes})),floorRootsReady:!!session.coverReady,mergedRootMeshes:session.mergedRootMeshes||0,rockGeometries:session.rockCache?.size||0,tear:window.RootSnarePlayerTear?.debug?.()||null,livePillarRoots:!!session.pillarRootTemplate,snare:session.snare?.diagnostics?.()||null,coffins:session.coffins.length,aliveMinions:[...session.minions].filter(e=>e.health>0).length,
      trial:session.trial?{wave:session.trial.wave,cleared:session.trial.cleared,resonance:session.trial.resonance}:null,
      seeds:(session.seeds||[]).map(seed=>({index:seed.index,taken:seed.taken})),bulbs:(session.bulbs||[]).map(bulb=>({index:bulb.index,lit:bulb.lit})),
      heart:{open:session.door?.open,boss:session.heart?.boss?.maskboundTroop||null,bossHp:session.heart?.boss?.health||0,defeated:session.heart?.defeated},
      errors:session.errors.slice(-6)};
  }
  function debugPreviewSnare(){
    if(!session?.snare?.previewDoubleGrip||!session?.snareTarget||session.ended)return false;
    const b=session.layout.parts[1].bounds,p={x:b.minX+2,z:b.minZ+2,y:session.floor}; // Dev-only reproducible full-player capture position near the maze entrance.
    session.entered=true;
    session.kit.setPlayerWorld(p,true,true);
    session.snareTarget.group.position.set(p.x,session.floor,p.z);
    return session.snare.previewDoubleGrip(session.snareTarget); // Invoke the authoring tool's exact two-hand-grip path against the real player.
  }
  SP.registerComposer({id:'hachutuTemple',buildRooms,update,controls,snapshot,clear});
  window.DevHachutuRuin=Object.freeze({reserve,makePlan,generateMaze,applyTitanStats,titanStats:TITAN,
    isDeadlyPit:(x,z)=>!!session&&session.entered&&inside({x,z},session.abyss),
    debug:()=>snapshot(),brief:()=>session?{weeds:session.weedsKilled,wave:session.trial?.wave||0,boss:session.heart?.boss?.maskboundTroop||'-',tear:window.RootSnarePlayerTear?.active?.()?(window.RootSnarePlayerTear.split?.()?'split':'pull'):'-',issue:session.errors.at(-1)||null}:null, // No animated-hand diagnostics allocation per rendered frame.
    debugPreviewSnare,
    debugSever:index=>strikeWeed(session?.weeds?.[index]),
    debugTakeSeed:index=>takeSeed(session?.seeds?.[index]),
    debugStrikeBulb:index=>strikeBulb(session?.bulbs?.[index]),
    pickSeedCells,
    debugClearRing:(weed,ring)=>takeRing(session?.weeds?.[weed],ring)});
})();
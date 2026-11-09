// RuinWallCoffins — a few of the stone panels on the shaft walls are really upright coffins.
// They look like ordinary wall panels. Walk up to one and the panel (its lid) slams down onto the floor,
// a black opening shows in the wall, and a Harlyao skeleton climbs out. Only ONE coffin skeleton
// is ever alive at a time: the next coffin stays shut until the last occupant has been defeated.
// Pure placement/selection lives in pick(); mount() builds the meshes and drives the lids/spawns.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinWallCoffins=api;
})(typeof self!=='undefined'?self:globalThis,function(root){
  'use strict';
  const MAP_ID='map_i_dev_random_ruin';
  const COUNT=Object.freeze({cave:2,hole:4,lich:6}); // More coffins in rarer, larger ruins.
  const WAKE_RADIUS=2.7,WAKE_HEIGHT=2.4,LID_SECONDS=.8;
  const hash=text=>{let h=2166136261;for(const ch of String(text))h=Math.imul(h^ch.charCodeAt(0),16777619)>>>0;return h;};
  // Chooses which candidate wall sites become coffins: deterministic per seed, spread over stories.
  function pick(sites,{seed=1,tier='hole'}={}){
    const want=Math.min(sites.length,COUNT[tier]??COUNT.hole);
    const ordered=sites.map(s=>({s,k:hash(seed+':coffin:'+s.key)})).sort((a,b)=>a.k-b.k);
    const chosen=[],perStory=new Map(),cap=Math.max(1,Math.ceil(want/2));
    for(const {s} of ordered){
      if(chosen.length>=want)break;
      if((perStory.get(s.story)||0)>=cap)continue; // Never put the whole set on one floor.
      if(chosen.some(o=>o.story===s.story&&Math.hypot(o.x-s.x,o.z-s.z)<6))continue; // Spaced out so the fights come one at a time.
      chosen.push(s);perStory.set(s.story,(perStory.get(s.story)||0)+1);
    }
    return chosen;
  }
  let session=null;
  const ease=t=>t*t*t; // Slams: slow start, hard finish.
  function mount({THREE,sites,seed,tier,getPlayerY,getPlayerPosition,isActive,mapId=MAP_ID}={}){
    if(session)session.dispose();
    if(!THREE||!Array.isArray(sites)||!sites.length)return null;
    const chosen=pick(sites.filter(s=>s.panel?.isMesh),{seed,tier});
    if(!chosen.length)return null;
    const wallGeo=new THREE.PlaneGeometry(.89,1.64),floorGeo=new THREE.PlaneGeometry(1,1);
    const makeBlack=(opacity=1)=>{const m=new THREE.MeshBasicMaterial({color:0x000000,transparent:opacity<1,opacity,depthWrite:false});m.polygonOffset=true;m.polygonOffsetFactor=-2;m.polygonOffsetUnits=-2;return m;};
    const up=new THREE.Vector3(0,1,0),axis=new THREE.Vector3(),q0=new THREE.Quaternion(),qa=new THREE.Quaternion();
    const coffins=chosen.map((site,index)=>{
      const lid=site.panel; // The REAL wall panel (engraving included) is the lid: until woken it is indistinguishable from its neighbours.
      const rest={x:lid.position.x,y:lid.position.y,z:lid.position.z,q:lid.quaternion.clone()};
      const parent=lid.parent;
      const wallMat=makeBlack(),wall=new THREE.Mesh(wallGeo,wallMat);
      wall.position.set(rest.x-site.dx*.02,rest.y,rest.z-site.dz*.02);wall.rotation.y=Math.atan2(site.dx,site.dz);wall.visible=false;wall.name='ruin-wall-coffin-darkness';
      const floorMat=makeBlack(0),floor=new THREE.Mesh(floorGeo,floorMat);
      floor.rotation.x=-Math.PI/2;floor.position.set(site.x+site.dx*.45,site.floorY+.07,site.z+site.dz*.45);floor.visible=false;floor.name='ruin-wall-coffin-spawn-tile';
      parent.add(wall,floor);
      return {index,site,lid,rest,parent,wall,wallMat,floor,floorMat,state:'closed',t:0,skeleton:null,fade:0,hingeY:rest.y-.82,
        nx:site.dx,nz:site.dz};
    });
    const live=entity=>!!entity&&Number(entity.health)>0&&(!entity.dead)&&entity.state!=='corpse';
    function poseLid(c,theta){ // Falls forward about its bottom edge, which also drops to the floor.
      const k=Math.min(1,theta/(Math.PI/2)),hy=c.hingeY-.25*k;
      axis.set(-c.nz,0,c.nx);qa.setFromAxisAngle(axis,-theta);q0.copy(c.rest.q);
      c.lid.quaternion.copy(qa).multiply(q0);
      c.lid.position.set(c.rest.x+c.nx*.82*Math.sin(theta),hy+.82*Math.cos(theta),c.rest.z+c.nz*.82*Math.sin(theta));
    }
    async function release(c){
      const tile=Number(root.Combat?.deps?.TILE)||64,hostile=root.Combat?.deps?.hostileObjects;
      const px=(c.site.x+c.nx*.5)*tile,pz=(c.site.z+c.nz*.5)*tile;
      try{
        const minion=await root.MinionCombat?.makeEntity?.({speciesId:'harlyao-skeleton',name:'Harlyao Skeleton',tier:1,x:px,y:pz,zoneId:mapId,weaponMetalKey:'nativeCopper',
          extra:{homeX:px,homeY:pz,state:'chase',wallCoffin:c.index}});
        if(!minion)return;
        if(session!==api||(isActive&&!isActive())){hostile?.delete?.(minion);minion.avatarRef?.group?.parent?.remove?.(minion.avatarRef.group);minion.avatarRef?.dispose?.();return;}
        const DS=root.DynamicSurfaces,born=performance.now();
        minion.surfaceYOverride=()=>{ // Climbs up out of the dark opening over a second.
          const support=DS?.sampleSupport?.(minion.x/tile,minion.y/tile,{minY:c.site.floorY-2.5,maxY:c.site.floorY+1.2,pad:.02});
          const base=Number.isFinite(Number(support?.y))?Number(support.y):c.site.floorY;
          return base-.7*Math.max(0,1-(performance.now()-born)/1100);
        };
        hostile?.add?.(minion);c.skeleton=minion;c.spawnedAt=born;
      }catch(error){console.warn?.('[ruin wall coffin] skeleton spawn failed',error);}
    }
    function update(dt){
      if(!session||session!==api||(isActive&&!isActive()))return;
      const p=getPlayerPosition?.(),py=Number(getPlayerY?.());
      const busy=coffins.some(c=>c.releasing||c.skeleton&&live(c.skeleton));
      for(const c of coffins){
        if(c.state==='closed'){
          if(busy||!p||!Number.isFinite(py))continue; // One at a time: stay shut while another occupant lives.
          if(Math.abs(py-c.site.floorY)>WAKE_HEIGHT||Math.hypot(p.x-c.site.x,p.z-c.site.z)>WAKE_RADIUS)continue;
          c.state='falling';c.wall.visible=true;c.floor.visible=true;
        }
        if(c.state==='falling'){
          c.t=Math.min(1,c.t+dt/LID_SECONDS);
          poseLid(c,ease(c.t)*Math.PI/2);
          c.floorMat.opacity=Math.min(1,c.t*2);c.floorMat.transparent=true;
          if(c.t>=1){c.state='open';c.releasing=true;c.openedAt=performance.now();release(c).finally(()=>{c.releasing=false;});}
        }
        if(c.state==='open'&&c.spawnedAt&&performance.now()-c.spawnedAt>1200){ // The dark patch under the climbing skeleton fades away.
          c.fade=Math.min(1,c.fade+dt/1.2);c.floorMat.opacity=1-c.fade;
          if(c.fade>=1){c.floor.visible=false;c.state='spent';}
        }
      }
    }
    const api={coffins,update,dispose(){
      if(session===api)session=null;
      for(const c of coffins){
        const e=c.skeleton;
        if(e){root.Combat?.deps?.hostileObjects?.delete?.(e);e.avatarRef?.group?.parent?.remove?.(e.avatarRef.group);e.groundShadow?.parent?.remove?.(e.groundShadow);e.avatarRef?.dispose?.();}
        c.lid.position.set(c.rest.x,c.rest.y,c.rest.z);c.lid.quaternion.copy(c.rest.q);
        c.wall.parent?.remove(c.wall);c.floor.parent?.remove(c.floor);c.wallMat.dispose();c.floorMat.dispose();
      }
      wallGeo.dispose();floorGeo.dispose();
    },snapshot:()=>({total:coffins.length,states:coffins.map(c=>c.state),aliveSkeletons:coffins.filter(c=>live(c.skeleton)).length})};
    floorGeo.scale?.(.95,1,1);
    session=api;return api;
  }
  const api={pick,mount,update:dt=>session?.update(dt),dispose:()=>session?.dispose(),snapshot:()=>session?.snapshot()||null,COUNT};
  return Object.freeze(api);
});

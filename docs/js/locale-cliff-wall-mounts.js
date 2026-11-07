// Runtime bridge for Locale Editor unknown-wall placeholders. Authored wall
// furniture binds to an actual generated cliff-face node after terrain is built;
// the editor's cyan placeholder itself is never exported as physical geometry.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.LocaleCliffWallMounts=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const mounted=new Map(); // Area-owned visual groups; destroyed/replaced when the procedural cliff changes.
  const MAX_FACE_DISTANCE=7; // Ignore invalid wall markers instead of leaving decorative furniture floating midair.
  function wallPlaceholders(instance){
    return (instance?.objects||[]).filter(o=>o.key==='unknownCliffFace'||o.visual?.renderer==='unknown_wall_plane');
  }
  function resolveFace(network,placeholder,object={}){
    const x=Number(placeholder?.x)+Math.max(.1,Number(placeholder?.w)||1)/2;
    const z=Number(placeholder?.y)+Math.max(.1,Number(placeholder?.h)||1)/2;
    if(!Number.isFinite(x)||!Number.isFinite(z))return null;
    let best=null;
    for(const route of network?.routes||[]){
      if(!route?.normal||!Array.isArray(route.nodes)||!route.nodes.length)continue;
      const baseY=Number(route.y0)||0,topY=Number(route.y1)||baseY;
      const fraction=Number.isFinite(Number(object?.visual?.mountHeightFraction)) ? Number(object.visual.mountHeightFraction) : .5; // An omitted wall height means the middle of the available face, never NaN.
      const targetY=baseY+(topY-baseY)*Math.max(0,Math.min(1,fraction));
      for(const node of route.nodes){
        if(![node.x,node.y,node.z].every(Number.isFinite))continue;
        const dx=node.x-x,dz=node.z-z,dy=node.y-targetY;
        const score=dx*dx+dz*dz+dy*dy*.07; // Prefer the matching face, then choose its actual Y at the authored fraction.
        if(score<(best?.score??Infinity))best={score,node,route};
      }
    }
    if(!best||Math.hypot(best.node.x-x,best.node.z-z)>MAX_FACE_DISTANCE)return null;
    const n=best.route.normal;
    return {x:best.node.x-n.x*.21,z:best.node.z-n.z*.21,
      y:best.node.y+(Number(object?.visual?.mountOffsetY)||0),
      rotation:Math.atan2(n.x,n.z),routeId:best.route.id,
      distance:Math.hypot(best.node.x-x,best.node.z-z)};
  }
  function disposedGeometry(group){
    group?.traverse?.(child=>{
      if(!child.isMesh)return;
      child.geometry?.dispose?.();
      for(const mat of Array.isArray(child.material)?child.material:[child.material])mat?.dispose?.();
    });
  }
  function clear(area){
    const key=String(area),state=mounted.get(key);
    if(!state)return;
    mounted.delete(key);
    state.disposed=true;
    for(const group of state.groups){
      group.parent?.remove?.(group);
      disposedGeometry(group);
    }
  }
  function mount(area,network,scene,instances=[]){
    const key=String(area||'');
    if(!key||!scene||!network)return {count:0,failed:0};
    const current=mounted.get(key);
    if(current?.scene===scene&&current?.network===network)return {count:current.count,failed:current.failed};
    clear(key);
    const state={scene,network,groups:[],disposed:false,count:0,failed:0,placements:[]}; // Exact face bindings exposed to mobile/editor diagnostics.
    mounted.set(key,state);
    const furniture=root.AuthoredFurniture;
    for(const instance of instances||[]){
      const walls=wallPlaceholders(instance);
      if(!walls.length)continue;
      for(const object of instance.objects||[]){
        if(!['furniture','decor','processor','prop'].includes(object?.kind)||!object.wallMountId)continue;
        const wall=walls.find(o=>String(o.id)===String(object.wallMountId));
        if(!wall){state.failed++;continue;}
        const face=resolveFace(network,wall,object);
        if(!face){state.failed++;continue;}
        state.placements.push({objectId:object.id,key:object.key,wallId:wall.id,routeId:face.routeId,
          x:face.x,y:face.y,z:face.z,distance:face.distance});
        if(!furniture?.load||!furniture?.buildGroup){state.failed++;continue;}
        Promise.resolve(furniture.load(object.key)).then(data=>{
          if(state.disposed||mounted.get(key)!==state||!data)return;
          const model=furniture.buildGroup({...data,puzzle:null}); // Only known/explicit furniture roles are interactive; passive wall mount cannot accidentally trigger the standard furniture puzzle action.
          model.name='locale-wall-mounted-'+object.key;
          model.position.set(face.x,face.y,face.z);
          model.rotation.y=face.rotation+(Number(object.rot)||0)*Math.PI/180;
          model.userData.localeWallMount={sourceId:object.id,wallId:wall.id,routeId:face.routeId};
          scene.add(model);state.groups.push(model);state.count++;
        }).catch(error=>{state.failed++;root.__farmLog?.('[locale-wall] could not build '+object.key+': '+error.message,'warn');});
      }
    }
    return {count:state.placements.length,failed:state.failed};
  }
  function debugSnapshot(){return {areas:[...mounted.entries()].map(([area,s])=>({
    area,mounted:s.count,planned:s.placements.length,failed:s.failed,placements:s.placements.slice(0,20)}))};}
  return Object.freeze({resolveFace,mount,clear,debugSnapshot});
});

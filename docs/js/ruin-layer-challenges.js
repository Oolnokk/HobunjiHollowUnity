// RuinLayerChallenges — self-contained gameplay mechanisms for stacked dungeon
// wings. All targets use SimplePuzzles' canonical ranged-projectile hook.
// A chamber only completes after a real player plate hold or real projectile hits.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinLayerChallenges=api;
})(typeof self!=='undefined'?self:globalThis,function(root){
  'use strict';
  const TYPES=Object.freeze(['pressurePlate','glyphObelisk','ceilingRailTargets']);
  const TARGET_COLORS=Object.freeze({idle:0xff9e42,hit:0x55e886,stone:0x777267});
  function compose(options={}){
    const {THREE,parent,room,id,kind,y,isActive,onSolved,getPlayerPosition,getPlayerY}=options;
    if(!THREE?.Mesh||!THREE?.MeshBasicMaterial||!parent?.add||!room||!TYPES.includes(kind)
      ||typeof isActive!=='function'||typeof onSolved!=='function')
      throw new Error('Invalid layered ruin challenge '+id+' ('+kind+').');
    const cx=room.x+room.w/2,cz=room.z+room.d/2;
    const owned=[],materials=[],targets=[]; // Each challenge disposes ONLY its own geometry and non-shared materials.
    const rec={id,kind,solved:false,elapsed:0,targetCount:0,hits:0,targets,plate:null,linked:false,disposed:false};
    const group=new THREE.Group(); // Visible mechanism geometry follows the wing floor's presentation culling.
    group.name='ruin-layer-challenge-'+id;parent.add(group);
    const basic=color=>{const mat=new THREE.MeshBasicMaterial({color});materials.push(mat);return mat;};
    const stone=basic(TARGET_COLORS.stone),idle=basic(TARGET_COLORS.idle),hit=basic(TARGET_COLORS.hit);
    const plateMat=basic(0x776452);
    const bus=options.projectileBus||root.DevRandomRuinSimplePuzzles;
    let linkDisposers=[]; // Disposers are returned by the existing modular target hit registry.
    const body=(name,geometry,mat,x,py,z)=>{
      const mesh=new THREE.Mesh(geometry,mat);
      mesh.name=name;mesh.position.set(x,py,z);
      mesh.userData ||= {};
      mesh.userData.devRuinFootprintIgnore=true; // Mechanism geometry must not block floor navigation; only the physical stone gate does.
      group.add(mesh);owned.push(mesh);return mesh;
    };
    const complete=()=>{
      if(rec.solved||rec.disposed||!isActive())return false;
      rec.solved=true;onSolved(rec);
      return true;
    };
    const target=(name,x,py,z)=>{
      const base=body(name+'-stone',new THREE.BoxGeometry(.94,.68,.68),stone,x,py,z);
      const rune=body(name+'-rune',new THREE.BoxGeometry(.6,.48,.76),idle,x,py,z);
      rune.userData.devRuinProjectileTarget=true;
      const state={
        id:name,object:rune,hitMesh:rune,active:false,
        hittable:()=>!rec.disposed&&!state.active&&isActive()&&rune.visible,
        onHit:()=>{
          if(state.active||rec.disposed||!isActive())return;
          state.active=true;rec.hits++;
          rune.material=hit;
          options.onHit?.(rec,state);
          if(rec.hits===rec.targetCount)complete();
        },
        base,rune,origin:{x,z,y:py},
      };
      targets.push(state);return state;
    };
    if(kind==='pressurePlate'){
      const surface=body('stone-pressure-plate-'+id,
        new THREE.BoxGeometry(2.2,.18,2.2),plateMat,cx,y+.05,cz);
      rec.plate=surface;
      rec.requiredSeconds=.8;
    }else if(kind==='glyphObelisk'){
      // Three separate real projectile targets spaced around the room.
      // Each uses the existing ranged weapon's world-space hit sweep.
      const dx=Math.min(2.8,room.w*.22),dz=Math.min(2.8,room.d*.22);
      target(id+'-glyph0',cx-dx,y+1.6,cz-dz*.45);
      target(id+'-glyph1',cx,y+2.1,cz+dz*.52);
      target(id+'-glyph2',cx+dx,y+1.6,cz-dz*.45);
    }else if(kind==='ceilingRailTargets'){
      // Both targets physically traverse a rail beneath the room ceiling.
      // They must be aimed at while moving, like the existing V50 target rail.
      const alongX=room.w>=room.d;
      const distance=Math.max(3,(alongX?room.w:room.d)*.34);
      const track=body('ruin-moving-target-track-'+id,
        new THREE.BoxGeometry(alongX?distance*2+.9:.18,.12,alongX?.18:distance*2+.9),
        stone,cx,y+2.72,cz);
      track.userData.devRuinCeilingRail=true;
      for(let i=0;i<2;i++){
        const t=target(id+'-moving'+i,cx,y+2.15,cz);
        t.alongX=alongX;t.distance=distance;
        t.phase=i*Math.PI;t.speed=1.2+i*.35;
      }
    }
    rec.targetCount=targets.length;
    rec.tick=(dt)=>{
      if(rec.disposed)return;
      const player=getPlayerPosition?.(),currentY=getPlayerY?.();
      if(kind==='pressurePlate'&&isActive()&&!rec.solved){
        const standing=player&&Number.isFinite(currentY)&&Math.abs(currentY-y)<.75
          &&Math.hypot(player.x-cx,player.z-cz)<1.15;
        rec.elapsed=standing?rec.elapsed+Math.min(.05,Math.max(0,dt)):0;
        if(rec.elapsed>=rec.requiredSeconds){rec.plate.material=hit;complete();}
      }
      if(kind==='ceilingRailTargets'&&!rec.solved){
        rec.elapsed+=Math.min(.05,Math.max(0,dt));
        for(const t of targets){
          if(t.active)continue;
          const offset=Math.sin(rec.elapsed*t.speed+t.phase)*t.distance;
          t.base.position.set(t.origin.x+(t.alongX?offset:0),t.origin.y,t.origin.z+(t.alongX?0:offset));
          t.rune.position.set(t.base.position.x,t.base.position.y,t.base.position.z);
        }
      }
      // External target registration may precede this module (the V50
      // puzzle runtime initializes on its first *in-map* frame). Retry until
      // the canonical projectile registry becomes available.
      if(targets.length&&!rec.linked){
        const registered=[];
        for(const t of targets){
          const disposer=bus?.registerExternalProjectileTarget?.(t);
          if(typeof disposer!=='function')break;
          registered.push(disposer);
        }
        if(registered.length===targets.length){linkDisposers=registered;rec.linked=true;}
        else for(const remove of registered)remove();
      }
    };
    rec.dispose=()=>{
      if(rec.disposed)return;
      rec.disposed=true;
      for(const remove of linkDisposers)remove();
      group.parent?.remove(group);
      for(const m of owned)m.geometry?.dispose?.();
      for(const mat of materials)mat.dispose?.();
    };
    rec.simulateHit=(index)=>{
      // In-process tests may dispatch the SAME target callback that the
      // canonical projectile wrapper calls; never bypass isActive or gate logic.
      targets[index]?.onHit?.();
    };
    return rec;
  }
  return Object.freeze({TYPES,compose});
});

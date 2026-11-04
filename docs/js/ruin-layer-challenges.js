// RuinLayerChallenges — self-contained gameplay mechanisms for stacked dungeon
// wings. All targets use SimplePuzzles' canonical ranged-projectile hook.
// A chamber only completes after a real player plate hold or real projectile hits.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinLayerChallenges=api;
})(typeof self!=='undefined'?self:globalThis,function(root){
  'use strict';
  const TYPES=Object.freeze(['pressurePlate','glyphObelisk','ceilingRailTargets','melodyEcho','dungeonFire']);
  const boneTextures=new Map(); // Shared Scratchbone numeral textures for every generated melody decal.
  function melodyFor(id){
    let seed=2166136261; // Deterministic FNV hash; the same generated chamber always has the same note sequence.
    for(const ch of String(id))seed=Math.imul(seed^ch.charCodeAt(0),16777619)>>>0;
    const size=4+(seed&1),notes=[];
    for(let i=0;i<size;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;notes.push(seed%8);}
    return notes;
  }
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
    const music=options.music||root.MusicMinigame; // Existing eight-note flute performance/puzzle bridge is authoritative.
    const fire=options.dungeonFire||root.DungeonFire; // Reuse real ranged-weapon ignition + projectile contact/heat checks.
    const events=options.events||root; // Reuses the standard hobunji-ruin-melody-result event, not a new music input bridge.
    let linkDisposers=[]; // Disposers are returned by the existing modular target hit registry.
    let melodyListener=null; // Removed on the same lifecycle as this authored chamber's other resources.
    let fireTargetId=null; // Registered only when the correct ruin's projectile runtime is live; removed on teardown.
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
      base.raycast=()=>{}; // Decorative stone does not shadow the smaller authoritative glyph hit volume.
      const rune=body(name+'-rune',new THREE.BoxGeometry(.6,.48,.76),idle,x,py,z);
      rune.userData.devRuinProjectileTarget=true;
      const state={
        id:name,object:rune,hitMesh:rune,active:false,
        hittable:()=>!rec.disposed&&!state.active&&isActive()&&rune.visible
          &&Number.isFinite(Number(getPlayerY?.()))&&Math.abs(Number(getPlayerY())-y)<.9,
        onHit:()=>{
          if(state.active||rec.disposed||!isActive()
            ||!Number.isFinite(Number(getPlayerY?.()))||Math.abs(Number(getPlayerY())-y)>=.9)return; // Cannot shoot an upstairs target through an unseen deck.
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
    }else if(kind==='dungeonFire'){
      // The standard DungeonFire runtime owns shot ignition and plume-to-ice
      // collision. The room merely authors a source brazier, a heat target,
      // and a progression gate; it never guesses from a normal arrow hit.
      const source=body('ruin-fire-source-'+id,
        new THREE.CylinderGeometry(.65,.8,.65,8),stone,cx-2.3,y+.37,cz);
      body('ruin-fire-source-flame-'+id,new THREE.ConeGeometry(.38,.95,7),
        idle,cx-2.3,y+1.18,cz);
      const frozen=basic(0x9fdaed);
      const ice=body('ruin-fire-ice-seal-'+id,
        new THREE.BoxGeometry(2.3,2.1,.75),frozen,cx+2.1,y+1.18,cz);
      rec.fireSource=source;rec.fireSeal=ice;
      rec.fireRecord={
        id:'layer-fire-target-'+id,object:ice,active:true,contactPadding:.16,
        isActive:()=>!rec.disposed&&!rec.solved&&isActive()
          &&Number.isFinite(Number(getPlayerY?.()))&&Math.abs(Number(getPlayerY())-y)<.9,
        onBurn:()=>{
          if(!rec.fireRecord.isActive())return false;
          rec.fireRecord.active=false;
          rec.fireSeal.material=hit;
          return complete();
        },
      };
      options.addControl?.({
        kind:'dungeonFireSource',object:source,promptRoot:source,
        floorY:y,range:1.75,priority:26,touchIcon:'🔥',label:'Ignite Next Shot',
        onPress:()=>{
          if(rec.disposed||rec.solved||!isActive()
            ||Math.abs(Number(getPlayerY?.())-y)>.9)return;
          if(fire?.armNextProjectile?.()===true)options.onFireArmed?.(rec);
          else options.onFireUnavailable?.(rec);
        }
      });
    }else if(kind==='melodyEcho'){
      // This is the existing melody-echo mini-game: stepping onto the bronze
      // plate plays the generated phrase; step off/on to hear it again, then
      // play the note sequence using the equipped flute. No WRONG overlay.
      const plate=body('ruin-melody-trigger-'+id,
        new THREE.BoxGeometry(1.35,.14,1.35),plateMat,cx,y+.07,cz);
      rec.plate=plate;
      rec.notes=melodyFor(id);
      rec.lastDown=false;rec.attempts=0;
      if(THREE.TextureLoader&&THREE.PlaneGeometry){
        for(let i=0;i<rec.notes.length;i++){
          const number=rec.notes[i]+1; // Actual Scratchbone 1–8 sprites match the generated instrument notes.
          let texture=boneTextures.get(number);
          if(!texture){
            texture=new THREE.TextureLoader().load('assets/hud/scratchbone'+number+'.png');
            if(THREE.SRGBColorSpace)texture.colorSpace=THREE.SRGBColorSpace;
            boneTextures.set(number,texture);
          }
          const material=new THREE.MeshBasicMaterial({
            map:texture,color:0xf5ead9,transparent:true,depthWrite:false,side:THREE.DoubleSide,
          });
          materials.push(material); // Textures are immutable and shared; only the decal material is owned by this room.
          const decal=body('scratchbone-note-'+id+'-'+i,
            new THREE.PlaneGeometry(.65,.75),material,
            cx+(i-(rec.notes.length-1)/2)*.8,y+1.8,room.z+.55);
          decal.userData.devRuinScratchboneMelodyNote=number;
        }
      }
      rec.onMelodyResult=detail=>{
        if(rec.disposed||rec.solved||detail?.id!==id)return;
        if(detail.solved===true){rec.plate.material=hit;complete();}
      };
      melodyListener=event=>rec.onMelodyResult(event?.detail); // One authoritative callback shared by browser event and tests.
      events?.addEventListener?.('hobunji-ruin-melody-result',melodyListener);
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
      if(kind==='melodyEcho'&&!rec.solved){
        const down=isActive()&&player&&Number.isFinite(currentY)&&Math.abs(currentY-y)<.75
          &&Math.abs(player.x-cx)<.58&&Math.abs(player.z-cz)<.58;
        if(down&&!rec.lastDown){
          const started=music?.beginPlayerSession?.({echoChallenge:{id,notes:rec.notes}});
          if(started){
            rec.attempts++;
            options.onMusicStart?.(rec);
          }else options.onMusicUnavailable?.(rec);
        }
        rec.lastDown=!!down; // Step off and on to replay the phrase, including after an incomplete attempt.
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
      if(kind==='dungeonFire'&&!rec.solved&&!fireTargetId
        &&bus?.hasActiveRuinState?.()===true){
        fireTargetId=fire?.registerTarget?.(rec.fireRecord)||null;
        rec.fireLinked=!!fireTargetId;
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
      if(fireTargetId)fire?.unregisterTarget?.(fireTargetId);
      if(melodyListener)events?.removeEventListener?.('hobunji-ruin-melody-result',melodyListener);
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
  return Object.freeze({TYPES,compose,melodyFor});
});

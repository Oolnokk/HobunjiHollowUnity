// Stronghold garrisons throw actual Shattercask Burdens using the existing
// BanditCombat staged throw, Shattercasks ballistic flight and all-target blast.
(() => {
  'use strict';
  if(window.BanditStrongholdCombat)return;
  const MIN_RANGE_TILES=5.8; // Must exceed the real Shattercask's 5-tile blast radius; close enemies use melee.
  const MAX_RANGE_TILES=10; // Upper throw distance limited by actual cover/LOS.
  const MIN_COOLDOWN=5.1; // Per-enemy deterministic stagger avoids simultaneous projectile bursts.
  const MAX_COOLDOWN=8.7; // Upper throw gap; does not affect ordinary bandits.
  const GRAVITY_WORLD_S2=13; // Exact existing Shattercasks.updateBurdenFalls gravity.
  let sequence=0; // Unique ids for actual thrown Burdens.
  let lastThrow=null; // Last launch, exposed in the mobile diagnostics.
  const stats={prepared:0,launched:0,failed:0,discarded:0}; // Counters sampled by gameplay AI.

  function cooldownFor(actor) {
    const id=String(actor?.id||'unknown');
    let n=0;
    for(const c of id)n=(Math.imul(n,31)+c.charCodeAt(0))>>>0;
    return MIN_COOLDOWN+(n%1024)/1024*(MAX_COOLDOWN-MIN_COOLDOWN);
  }

  function arc(start,target) {
    if(![start?.x,start?.y,start?.z,target?.x,target?.y,target?.z].every(Number.isFinite))return null;
    const horizontal=Math.hypot(target.x-start.x,target.z-start.z);
    const flightSeconds=Math.max(.6,Math.min(1.45,horizontal/5.8));
    return {x:(target.x-start.x)/flightSeconds,
      y:(target.y-start.y+.5*GRAVITY_WORLD_S2*flightSeconds**2)/flightSeconds,
      z:(target.z-start.z)/flightSeconds,flightSeconds,horizontal};
  }

  function selfBlastSafe(actor,target,tile=Number(actor?._strongholdTileSize)||64) {
    if(!actor||!target||!Number.isFinite(Number(tile))||tile<=0)return false;
    const blastRadius=Math.max(0,Number(window.Shattercasks?.RADIUS)||5); // Source-of-truth shared explosion radius, not a guessed smaller grenade splash.
    const distance=Math.hypot(Number(target.x)-Number(actor.x),Number(target.y)-Number(actor.y))/tile;
    return Number.isFinite(distance)&&distance>=Math.max(MIN_RANGE_TILES,blastRadius+.8);
  }

  async function launch(actor,target,kind,owningArea) {
    const api=window.Shattercasks,scene=actor?.scene;
    const tile=Number(actor?._strongholdTileSize)||64;
    if(!api?.createHangingBurden||!api?.releaseBurdenWithVelocity||!scene||!target||actor.health<=0)return false;
    if(actor.areaId!==owningArea||(target.areaId&&target.areaId!==owningArea)||!selfBlastSafe(actor,target,tile))return false; // Own blast is forbidden even when allied bandits are within the splash.
    const sourceY=Number(actor.avatarRef?.group?.position?.y);
    const start={x:actor.x/tile,y:Number.isFinite(sourceY)?sourceY+.22:.95,z:actor.y/tile};
    const hitbox=window.RangedWeapons?.actorHitbox?.(target);
    const ground=Number(hitbox?.box?.min?.y);
    const endpoint={x:target.x/tile,y:(Number.isFinite(ground)?ground:0)+.3,z:target.y/tile};
    const motion=arc(start,endpoint);
    if(!motion)return false;
    const id='stronghold-enemy-cask:'+String(actor.id)+':'+(++sequence);
    const burden=await api.createHangingBurden({
      id,mapId:owningArea,scene,kind,furnitureKey:'shattercaskBlasting',
      x:start.x,y:start.y,z:start.z,
      displayName:kind==='flameShattercask'?'Thrown Flame Shattercask':'Thrown Blasting Shattercask',
      hanging:true, // Converted straight into the original Shattercask flight on release.
    });
    if(!burden)return false;
    const current=window.GridTileAccessors?.getCurrentArea?.();
    if(actor.health<=0||actor.areaId!==owningArea||(current&&current!==owningArea)){
      api.discardBurden?.(burden);stats.discarded++;return false;
    }
    if(!api.releaseBurdenWithVelocity(burden,motion,'bandit-thrown-shattercask')){
      api.discardBurden?.(burden);stats.discarded++;return false;
    }
    stats.launched++;
    lastThrow={area:owningArea,actorId:actor.id,kind,flightSeconds:motion.flightSeconds,
      start,end:endpoint,velocity:{x:motion.x,y:motion.y,z:motion.z},id};
    return true;
  }

  function chooseKind(actor) {
    if(actor.banditStrongholdThrowKind==='flameShattercask')return 'flameShattercask';
    if(actor.banditStrongholdThrowKind==='shattercask')return 'shattercask';
    const index=actor._strongholdThrowCount||0; // Alternating two existing Burden variants.
    actor._strongholdThrowCount=index+1;
    return index%2?'flameShattercask':'shattercask';
  }

  function updateThrow(actor,dt,target) {
    if(!actor?.banditStrongholdThrower||!target||target.health<=0)return null; // Zero work for all other hostile types.
    const elapsed=Math.max(0,Math.min(.25,Number(dt)||0));
    actor._strongholdThrowCooldown=Math.max(0,(actor._strongholdThrowCooldown??cooldownFor(actor))-elapsed);
    if(actor._strongholdThrowPending||actor._banditAction||actor.retreatT>0||actor._strongholdThrowCooldown>0)return null;
    const tile=Number(actor._strongholdTileSize)||64;
    const distance=Math.hypot(target.x-actor.x,target.y-actor.y);
    if(distance>MAX_RANGE_TILES*tile||!selfBlastSafe(actor,target,tile))return null; // Friendlies are intentionally *not* in this check.
    if(window.RangedWeapons?.hasLineOfSight?.(actor,target)===false)return null;
    const anim=window.HeldActionAnimations?.throwFlask;
    if(!anim?.poses||!window.Combat?.beginStagedAction)return null;
    const duration=Math.max(.5,Number(anim.durationS)||1.04);
    const windup=Math.max(.2,duration*.5),strike=Math.max(.1,duration-windup);
    const kind=chooseKind(actor),area=actor.areaId;
    actor._strongholdThrowPending=true;
    actor._banditSwingAnim=anim.style||'chop';actor._banditSwingPose=anim.poses;
    actor._banditSwingDirSign=1;actor._banditSwingPower=1;actor._banditSwingPoseScale=1;
    actor.telegraphState='windup';
    const cleanup=()=>{
      actor._strongholdThrowPending=false;
      actor._strongholdThrowCooldown=cooldownFor(actor);
      window.BanditCombat?.finishAction?.(actor);
    };
    actor._banditAction=window.Combat.beginStagedAction({
      windupS:windup,strikeS:strike,recoverS:0,
      data:{isBandit:true,attacker:actor,strongholdCask:true,kind},
      onStrike:()=>{
        if(actor.health<=0||actor.areaId!==area)return;
        Promise.resolve(launch(actor,target,kind,area)).then(ok=>{if(!ok)stats.failed++;})
          .catch(error=>{stats.failed++;window.__farmLog?.('[bandit-stronghold] throw failed: '+error.message,'warn');});
        actor.telegraphState='strike';
      },
      onComplete:cleanup,onCancel:cleanup,
    });
    if(!actor._banditAction){cleanup();stats.failed++;return null;}
    stats.prepared++;
    return {handled:true,aimAngle:Math.atan2(target.y-actor.y,target.x-actor.x),moving:false};
  }

  const debugSnapshot=()=>({...stats,lastThrow,gravity:GRAVITY_WORLD_S2,cooldown:[MIN_COOLDOWN,MAX_COOLDOWN]});
  window.BanditStrongholdCombat=Object.freeze({updateThrow,launch,arc,debugSnapshot,
    __test:Object.freeze({chooseKind,cooldownFor,selfBlastSafe})});
})();
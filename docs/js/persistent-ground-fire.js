// Short-lived world-ground flame patches shared by fire flasks and flame Shattercasks.
// Fire remains in the world after impact and can ignite paired cave sconces.
(() => {
  'use strict';
  if (window.PersistentGroundFire) return;
  const MAX_ZONES=14; // Strict scene cap keeps simultaneous fire cheap on mobile.
  const DEFAULT_DURATION=11; // Seconds a thrown flask leaves a live patch after shattering.
  const DAMAGE_INTERVAL=.35; // Periodic player/enemy Burn application, not a per-frame entity sweep.
  let deps=null; // AlchemyFlasks.init supplies the established combat/terrain entity adapters.
  const zones=[]; // One scene-owned patch per recent impact; removed on expiry or area transition.
  let lastIgnition=null; // Mobile-accessible impact diagnostic, no console required.

  function dispose(zone) {
    zone.mesh?.parent?.remove?.(zone.mesh);
    for(const child of zone.mesh?.children||[]){
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }
  }
  function buildVisual(zone) {
    const THREE=window.THREE,scene=deps?.getActiveScene?.();
    if(!THREE?.Group||!scene)return;
    const group=new THREE.Group();
    group.name='persistent_ground_fire';
    group.position.set(zone.x,zone.y+.03,zone.z);
    const disc=new THREE.Mesh(new THREE.CylinderGeometry(zone.radius,zone.radius,.012,18),
      new THREE.MeshBasicMaterial({color:0xff5b20,transparent:true,opacity:.36,depthWrite:false}));
    disc.position.y=.012;group.add(disc);
    for(let i=0;i<5;i++){
      const a=i*Math.PI*2/5,dist=zone.radius*(i===0?0:.47);
      const flame=new THREE.Mesh(new THREE.ConeGeometry(.10+i*.01,.42+(i%3)*.13,5),
        new THREE.MeshBasicMaterial({color:i%2?0xff7622:0xffce43,transparent:true,opacity:.83,depthWrite:false}));
      flame.position.set(Math.sin(a)*dist,.2+(i%3)*.06,Math.cos(a)*dist);
      flame.userData.fireIndex=i;
      group.add(flame);
    }
    scene.add(group);zone.mesh=group;zone.scene=scene;
  }
  function ignite({area,x,z,y=0,radius=1.5,seconds=DEFAULT_DURATION,source='unknown'}={}) {
    const px=Number(x),pz=Number(z),floorY=Number(y);
    if(!String(area||'')||!Number.isFinite(px)||!Number.isFinite(pz)||!Number.isFinite(floorY)||
       String(area)!==String(deps?.getCurrentArea?.()||''))return false;
    const patch={area:String(area),x:px,z:pz,y:floorY,radius:Math.max(.3,Math.min(4,Number(radius)||1.5)),
      seconds:Math.max(.5,Math.min(25,Number(seconds)||DEFAULT_DURATION)),age:0,damageTimer:0,
      source:String(source)};
    // Neighboring splashes extend the fire but never grow unbounded or multiply damage on one tile.
    const old=zones.find(z=>z.area===patch.area&&Math.hypot(z.x-px,z.z-pz)<.5);
    if(old){old.seconds=Math.max(old.seconds,old.age+patch.seconds);return true;}
    if(zones.length>=MAX_ZONES)dispose(zones.shift());
    zones.push(patch);buildVisual(patch);
    lastIgnition={area:patch.area,x:px,z:pz,radius:patch.radius,source:patch.source};
    return true;
  }
  function intersects(area,x,z,distance=0) {
    const px=Number(x),pz=Number(z);
    if(!Number.isFinite(px)||!Number.isFinite(pz))return false;
    return zones.some(patch=>patch.area===String(area)&&patch.age<patch.seconds
      &&Math.hypot(px-patch.x,pz-patch.z)<=patch.radius+Math.max(0,Number(distance)||0));
  }
  function update(dt) {
    const elapsed=Number.isFinite(Number(dt)) ? Math.max(0,Number(dt)) : 0; // A slow/mobile frame still advances the real fire lifetime, not a 250ms-capped clock.
    if(!zones.length||!elapsed)return; // Idle worlds skip even the area/scene getters and entity scans.
    const area=String(deps?.getCurrentArea?.()||''),scene=deps?.getActiveScene?.();
    const tile=Number(deps?.TILE)||64;
    for(let index=zones.length-1;index>=0;index--){
      const patch=zones[index];
      if(patch.area!==area||(patch.scene&&patch.scene!==scene)||patch.age>=patch.seconds){
        dispose(patch);zones.splice(index,1);continue;
      }
      patch.age+=elapsed;
      if(patch.age>=patch.seconds){dispose(patch);zones.splice(index,1);continue;} // Expire before applying fresh damage on a frame after the fire is gone.
      patch.damageTimer+=elapsed;
      if(patch.mesh){
        const pulse=Math.sin(patch.age*11)*.12+1;
        for(const child of patch.mesh.children){
          if(child.userData?.fireIndex!=null)child.scale.y=pulse*(.95+.08*child.userData.fireIndex);
        }
      }
      if(patch.damageTimer>=DAMAGE_INTERVAL) {
        patch.damageTimer=0;
        const nearby=deps?.getSplashEntities?.(area,patch.x*tile,patch.z*tile,patch.radius*tile)||[];
        for(const actor of nearby){
          if(!actor||Number(actor.health)<=0)continue;
          if(Math.hypot(Number(actor.x)/tile-patch.x,Number(actor.y)/tile-patch.z)>patch.radius)continue;
          window.ResourceSystem?.addAffliction?.(actor,'burningHealth',5); // Uses ordinary water/roll extinguish behavior.
        }
      }
    }
  }
  function clear(area=null){
    for(let i=zones.length-1;i>=0;i--)if(area==null||zones[i].area===String(area)){
      dispose(zones[i]);zones.splice(i,1);
    }
  }
  window.PersistentGroundFire=Object.freeze({
    init(injected){deps=injected||null;},ignite,intersects,update,clear,
    debugSnapshot:()=>({count:zones.length,lastIgnition,zones:zones.map(z=>({
      area:z.area,x:z.x,z:z.z,remaining:+(z.seconds-z.age).toFixed(1),source:z.source
    }))}),
  });
})();

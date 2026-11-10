// Two gar-wolves guard selected fortified camps, tethered to authored wooden
// stakes with a stretched copy of the EXISTING torch-flail chain sprite.
// No chain physics, extra animation loop or animal-combat implementation.
// CaveSiteSystem saves release/death flags; the normal animal AI fights in-cave.
(() => {
  'use strict';
  if (window.BanditStrongholdWolves) return;

  const WOLF_KIND = 'gar-wolf'; // Existing Creature DB and genetics species used for both hostile and liberated wolves.
  const TETHER_TILES = 2.15; // Existing animal leash and this cheap position clamp share the same stake origin.
  const ESCAPE_SPEED_TILES = 2.8; // Released animals visibly run into the entrance before cave combat on actual entry.
  const CHAIN_SPRITE = 'assets/toolsprites/hachutu_torch-flail_chain.png'; // Original weapon chain, not a new flat procedural texture.
  const exteriorByZone = new Map(); // Zone -> records for only its loaded strongholds (maximum two wolves per stronghold).
  const interiorByMap = new Map(); // Cave map -> slot/actor map; no duplicate allies on revisits.
  const interiorDepsByMap = new Map(); // Native creature owner used to despawn allies after the cave scene is retired.
  let chainMaterial = null; // One shared transparent texture/material for every tether.
  let chainGeometry = null; // Stretched plane; no chain nodes or per-link physics.
  const debug = {last:'not spawned', exteriorSpawned:0, released:0, interiorSpawned:0, deaths:0, escaped:0}; // On-device telemetry.

  function zoneRecords(zoneId) {
    const id = String(zoneId);
    if (!exteriorByZone.has(id)) exteriorByZone.set(id, new Set());
    return exteriorByZone.get(id);
  }

  function makeChain(scene) {
    const THREE = window.THREE;
    if (!THREE?.TextureLoader || !THREE?.PlaneGeometry || !THREE?.Mesh || !scene) return null;
    if (!chainMaterial) {
      const texture = new THREE.TextureLoader().load(CHAIN_SPRITE);
      if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
      chainMaterial = new THREE.MeshLambertMaterial({
        map:texture,transparent:true,alphaTest:.08,side:THREE.DoubleSide,depthWrite:false,
      }); // The original chain PNG takes actual scene light rather than an artificial glow.
    }
    chainGeometry ||= new THREE.PlaneGeometry(1,1);
    const chain = new THREE.Mesh(chainGeometry,chainMaterial);
    chain.name='bandit-gar-wolf-stake-chain';
    chain.userData.banditStrongholdChain = true;
    scene.add(chain);
    return chain;
  }

  function pointForStake(stake, deps, zoneId) {
    const col = Number(stake.x), row = Number(stake.y);
    const tile = deps?.zoneScenes?.get?.(zoneId)?.grid?.[row]?.[col];
    const y = Number(deps?.tileSurfaceYInArea?.(tile,zoneId));
    return { x:(col+.5)*(Number(deps?.TILE)||64), z:(row+.5)*(Number(deps?.TILE)||64),
      worldY:Number.isFinite(y)?y:0 };
  }

  function updateChain(record) {
    const wolf = record.wolf, chain = record.chain;
    if (!chain || !wolf || record.released || wolf.health <= 0) {
      if (chain) chain.visible=false;
      return;
    }
    const t=record.tile;
    const dx=wolf.x/t-t.x, dz=wolf.y/t-t.z;
    const length=Math.max(.1,Math.hypot(dx,dz));
    chain.position.set(t.x+dx*.5,record.anchorY+.45,t.z+dz*.5);
    chain.rotation.y=-Math.atan2(dz,dx);
    chain.scale.set(length,.12,1);
    chain.visible=true;
  }

  function removeWolf(record,deps) {
    if (record.chain) { record.chain.parent?.remove(record.chain); record.chain = null; } // Shared texture/geometry never disposed per animal.
    const wolf=record.wolf;
    if (!wolf) return;
    deps?.hostileObjects?.delete?.(wolf);
    record.camp?.gangIds?.delete?.(wolf.id);
    deps?.despawnCreature?.(wolf); // Native creature owner disposes the rig, foot shadow and colliders.
    record.wolf=null;
  }

  function ensureExterior(camp,deps) {
    if (!camp?.stronghold || !deps?.makeCreatureEntity || !deps?.hostileObjects || !camp.props) return 0;
    const area=camp.zoneId, mapId=camp.stronghold.mapId;
    if (deps.getCurrentArea?.() !== area) return 0;
    const scene=deps.zoneScenes?.get?.(area)?.scene;
    const grid=deps.zoneScenes?.get?.(area)?.grid;
    const tile=Number(deps.TILE)||64;
    if (!scene || !grid) return 0;
    const existing=zoneRecords(area), owner = [...existing].filter(rec=>rec.camp===camp);
    let created=0;
    for (const stake of camp.props.filter(prop=>prop.strongholdStake)) {
      if (owner.some(rec=>rec.slot===stake.wolfSlot)) continue;
      const status=window.CaveSiteSystem?.strongholdWolfStatus?.(mapId,stake.wolfSlot)||{};
      stake.freed=!!status.freed;
      if (status.freed || status.dead) continue;
      const origin=pointForStake(stake,deps,area);
      const worldX=origin.x/tile, worldZ=origin.z/tile;
      const x=(worldX+(stake.wolfSlot?-.45:.45))*tile;
      const y=(worldZ-.5)*tile;
      const genotype=window.CreatureGenetics?.makeDefaultGenotype?.(WOLF_KIND)||null;
      const wolf=deps.makeCreatureEntity(WOLF_KIND,x,y,{
        genotype,scene,grid,cols:deps.zoneLayouts?.get?.(area)?.cols,rows:deps.zoneLayouts?.get?.(area)?.rows,
        homeX:origin.x,homeY:origin.z,state:'idle',
      });
      if (!wolf) { window.__farmLog?.('[bandit-wolves] Could not build gar-wolf at '+mapId,'warn'); continue; }
      wolf.def={...wolf.def,hostile:true,leashRangePx:TETHER_TILES*tile,aggroRangePx:Math.min(Number(wolf.def?.aggroRangePx)||3*tile,3*tile)};
      wolf.homeX=origin.x;wolf.homeY=origin.z;
      wolf.banditStrongholdWolf=true;wolf.banditStrongholdSlot=stake.wolfSlot;wolf.banditStrongholdStakeId=stake.id;
      wolf.areaId=area; wolf.targetCreature=null;
      deps.hostileObjects.add(wolf);
      camp.gangIds?.add(wolf.id);
      const record={
        camp,stake,slot:stake.wolfSlot,wolf,mapId,zoneId:area,anchorX:origin.x,anchorZ:origin.z,
        anchorY:origin.worldY,tile,chain:makeChain(scene),released:false,escaped:false,
      }; // The chain follows this live creature and remains bounded by this one fixed stake.
      existing.add(record);
      updateChain(record);
      created++;
    }
    if(created){debug.exteriorSpawned+=created;debug.last='spawned '+created+' chained wolf/wolves in '+area;}
    return created;
  }

  function freeStake(camp,stake,deps) {
    if (!camp?.stronghold || !stake?.strongholdStake || stake.freed) return false;
    const record=[...(exteriorByZone.get(String(camp.zoneId))||[])].find(r=>r.camp===camp&&r.slot===stake.wolfSlot);
    if (!record?.wolf || record.wolf.health<=0) {
      deps?.showToast?.('The chain is empty.',false);
      return false;
    }
    if (!window.CaveSiteSystem?.markStrongholdWolfFreed?.(camp.stronghold.mapId,stake.wolfSlot)) return false;
    stake.freed=true;
    record.released=true;
    const wolf=record.wolf;
    wolf.def={...wolf.def,hostile:false};
    wolf.state='idle';wolf.targetPlayer=null;wolf.targetCreature=null;wolf.vx=wolf.vy=0;
    wolf.homeX=camp.homeX;wolf.homeY=camp.homeY;
    if (record.chain) record.chain.visible=false;
    debug.released++;debug.last='wolf '+record.slot+' freed from '+camp.zoneId;
    deps?.showToast?.('The freed gar-wolf bolts for the cave entrance.',true);
    return true;
  }

  function tickExterior(zoneId, dt = 0, deps) {
    const bucket=exteriorByZone.get(String(zoneId));
    if (!bucket?.size || deps?.getCurrentArea?.()!==zoneId) return 0;
    const tile=Number(deps.TILE)||64,elapsed=Math.max(0,Math.min(.2,Number(dt)||0));
    let changed=0;
    for(const record of [...bucket]) {
      const wolf=record.wolf;
      if (!wolf) { bucket.delete(record);continue; }
      if(wolf.health<=0){
        window.CaveSiteSystem?.markStrongholdWolfDead?.(record.mapId,record.slot);
        if(record.chain)record.chain.visible=false;
        record.wolf=null;bucket.delete(record);
        debug.deaths++;changed++;continue;
      }
      if (!record.released) {
        const dx=wolf.x-record.anchorX, dy=wolf.y-record.anchorZ;
        const distance=Math.hypot(dx,dy);
        if(distance>tile*TETHER_TILES) {
          const scale=tile*TETHER_TILES/distance;
          wolf.x=record.anchorX+dx*scale;wolf.y=record.anchorZ+dy*scale;
          wolf.vx=wolf.vy=0; // Physical leash limit; a monster cannot pull its chain beyond the stake.
        }
        updateChain(record);
        continue;
      }
      const targetX=record.camp.homeX,targetY=record.camp.homeY;
      const dx=targetX-wolf.x,dy=targetY-wolf.y,distance=Math.hypot(dx,dy);
      if(distance<=tile*.6) {
        removeWolf(record,deps);bucket.delete(record);
        debug.escaped++;changed++;continue;
      }
      if(elapsed && distance>0) {
        const distanceStep=Math.min(distance,tile*ESCAPE_SPEED_TILES*elapsed);
        wolf.x+=dx/distance*distanceStep;wolf.y+=dy/distance*distanceStep;
        wolf.homeX=targetX;wolf.homeY=targetY;
        wolf.state='return';wolf.vx=wolf.vy=0;
      }
    }
    if(!bucket.size)exteriorByZone.delete(String(zoneId));
    return changed;
  }

  function forgetExterior(camp,deps) {
    const bucket=exteriorByZone.get(String(camp?.zoneId||''));
    if(!bucket) return 0;
    let n=0;
    for(const record of [...bucket])if(record.camp===camp){
      removeWolf(record,deps);bucket.delete(record);n++;
    }
    if(!bucket.size)exteriorByZone.delete(String(camp.zoneId));
    return n;
  }

  function nearestBandit(wolf,actors,mapId) {
    let best=null,bestD=Infinity;
    for (const actor of actors||[]) {
      if (!actor?.isBandit || actor.caveSiteMapId!==mapId || actor.health<=0) continue;
      const d=(actor.x-wolf.x)**2+(actor.y-wolf.y)**2;
      if (d<bestD){best=actor;bestD=d;}
    }
    return best;
  }

  function ensureInterior(profile,plan,state,deps) {
    if(!profile?.fortifiedStronghold || state?.occupantsCleared || !deps?.makeCreatureEntity || !deps?.hostileObjects) return 0;
    const mapId=profile.mapId,tile=Number(deps.TILE)||64;
    interiorDepsByMap.set(mapId,deps); // Cleanup uses the actual scene/creature dependency owner, not a parallel model.
    if(deps.getCurrentArea?.()!==mapId)return 0;
    const enemies=[...deps.hostileObjects].filter(c=>c?.isBandit&&c.caveSiteMapId===mapId&&c.health>0);
    if(!enemies.length)return 0; // The wolf-on-bandit fight only starts after entering and populating the actual cave.
    let bucket=interiorByMap.get(mapId);
    if(!bucket)interiorByMap.set(mapId,bucket=new Map());
    let made=0;
    for(const slot of state.strongholdWolfFreed||[]){
      if(state.strongholdWolfDead?.includes(slot)||bucket.has(slot))continue;
      const enemy=enemies[slot%enemies.length];
      const x=enemy.x+tile*.35*(slot?1:-1),y=enemy.y+tile*.35;
      const wolf=deps.makeCreatureEntity(WOLF_KIND,x,y,{
        scene:deps.getActiveScene?.(),grid:deps.getActiveGrid?.(),
        cols:deps.getActiveCols?.(),rows:deps.getActiveRows?.(),
        genotype:window.CreatureGenetics?.makeDefaultGenotype?.(WOLF_KIND)||null,
        homeX:x,homeY:y,state:'idle',
      });
      if(!wolf)continue;
      wolf.areaId=mapId;
      wolf.isCompanion=false;wolf.banditCompanion=false;wolf.banditStrongholdLiberated=true;wolf.banditStrongholdSlot=slot;
      wolf.def={...wolf.def,hostile:false,aggroRangePx:tile*12,leashRangePx:tile*20};
      wolf.targetPlayer=null;wolf.targetCreature=enemy;wolf.state='patrol-chase'; // Native animal-vs-creature attack path, never direct scripted damage.
      deps.hostileObjects.add(wolf);
      bucket.set(slot,wolf);
      made++;
    }
    if(made){debug.interiorSpawned+=made;debug.last='liberated wolves joined '+mapId;}
    return made;
  }

  function tickInterior(mapId,deps) {
    const bucket=interiorByMap.get(String(mapId));
    if(!bucket?.size || deps?.getCurrentArea?.()!==mapId) return 0;
    let retargeted=0;
    for(const [slot,wolf] of [...bucket]){
      if(!wolf || wolf.health<=0){
        window.CaveSiteSystem?.markStrongholdWolfDead?.(mapId,slot);
        bucket.delete(slot);debug.deaths++;continue;
      }
      const enemy=nearestBandit(wolf,deps.hostileObjects,mapId);
      if(enemy && (wolf.targetCreature!==enemy || wolf.state!=='patrol-chase')){
        wolf.targetCreature=enemy;wolf.targetPlayer=null;wolf.state='patrol-chase';
        retargeted++;
      }else if(!enemy && wolf.targetCreature){
        wolf.targetCreature=null;wolf.targetPlayer=null;wolf.state='idle';
      }
    }
    return retargeted;
  }

  function forgetInterior(mapId,deps) {
    deps ||= interiorDepsByMap.get(String(mapId)); // Called by CaveSiteSystem reset with no explicit dependency bag.
    interiorDepsByMap.delete(String(mapId));
    const bucket=interiorByMap.get(String(mapId));
    if(!bucket)return 0;
    for(const wolf of bucket.values()) {
      deps?.hostileObjects?.delete?.(wolf);
      deps?.despawnCreature?.(wolf);
    }
    interiorByMap.delete(String(mapId));
    return bucket.size;
  }

  function debugSnapshot() {
    return {...debug,chainSprite:CHAIN_SPRITE,exterior:[...exteriorByZone].map(([area,records])=>({
      area,wolves:[...records].map(r=>({slot:r.slot,alive:r.wolf?.health>0,released:r.released,chainVisible:!!r.chain?.visible})),
    })),interior:[...interiorByMap].map(([mapId,bucket])=>({mapId,slots:[...bucket.keys()]}))};
  }
  window.BanditStrongholdWolves=Object.freeze({
    ensureExterior,freeStake,tickExterior,forgetExterior,ensureInterior,tickInterior,forgetInterior,debugSnapshot,
    __test:Object.freeze({nearestBandit,pointForStake}),
  });
})();
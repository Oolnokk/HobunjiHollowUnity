// Fortified Bandit Lord: native circular cavern annex, captain combat, wolf/volley
// variants and keyed treasury. Reuses CavernGenerator, BanditCombat, CombatProgression,
// AlchemyFlasks, Shattercasks, World Events and authored chest/barrel furniture.
(() => {
  'use strict';
  if (window.BanditStrongholdBoss) return;

  const GARRISON_KEY='strongholdGarrisonSeal'; // Untradeable gate pass granted when the native cave garrison is defeated.
  const TREASURY_KEY='strongholdTreasuryKey'; // Boss-corpse reward, required by the existing interior key-gated door.
  const BOSS_HEALTH_MULTIPLIER=2.35; // Applies to the actual mastery-5 captain's rolled Health once.
  const BOSS_DAMAGE_MULTIPLIER=1.32; // Boss attacks are stronger than a captain's before adding its genuine mastery afflictions.
  const WOLF_HEALTH_MULTIPLIER=1.65; // Beastkeeper's three actual gar-wolves are sturdier than wild animals.
  const BOSS_RADIUS=7; // Circle of walkable tiles passed to the existing cavern shell carver.
  const TREASURY_RADIUS=6; // Separate compact circular room using the same cave material and lighting.
  const CHEST_KEYS=['ruinDungeonChestT2','ruinDungeonChestT3','ruinDungeonChestT4']; // Existing authored chests, not new models.
  const liveWolves=new Map(); // Boss map -> real companion entities for cleanup and on-device diagnostics.
  const liveLords=new Map(); // Boss map -> currently live BanditCombat captain.
  let inventoryDeps=null; // ItemProcessing's existing inventory/definitions for key registration and recovery.
  const status={last:'not encountered',chestsClaimed:0,keysClaimed:0,volleys:0,wolves:0,masteryHits:0}; // Mobile inspector snapshot.

  function hash(value) {
    let h=2166136261>>>0;
    for(const c of String(value||'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
    return h>>>0;
  }
  function rngFor(value) {
    let state=hash(value)||1; // Only arena shapes and fixed encounter choices use this stream.
    return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  }
  function kindFor(profile) {
    return hash(profile?.signature+':lord-variant')%2===0?'beastkeeper':'demolitionist';
  }
  function itemRegistration(deps) {
    if(!deps?.ITEM_DEFS)return false;
    inventoryDeps=deps;
    const entries=[
      [GARRISON_KEY,'Fortress Garrison Seal','🗝️','A permanent proof that the outer stronghold is cleared. Opens the Bandit Lord gate.'],
      [TREASURY_KEY,'Bandit Lord Treasury Key','🗝️','Taken from a defeated Bandit Lord. Opens the private treasury.'],
    ]; // Quest items are ordinary inventory keys so the native key-gated door checks work on controller and touch.
    for(const [key,label,icon,desc] of entries){
      deps.ITEM_DEFS[key]||={icon,label,cat:'material',sellPrice:0,tags:['Quest','Key','Untradeable'],desc};
      if(Array.isArray(deps.inventoryItems)&&!deps.inventoryItems.some(item=>item.key===key))
        deps.inventoryItems.push({key,label:label.toUpperCase(),icon,max:1});
    }
    return true;
  }
  function installItemRegistration() {
    const api=window.ItemProcessing;
    if(!api?.init||api.__strongholdBossKeysPatched)return false;
    const original=api.init; // Preserve the base processor and already-installed Komanine registration.
    api.init=function strongholdKeysInit(deps,...args){const result=original.call(this,deps,...args);itemRegistration(deps);return result;};
    api.__strongholdBossKeysPatched=true;
    return true;
  }

  function gate(mapData,{id,col,row,targetMap,requiresKeyItem,label,side='north'}) {
    const exit={id,label,tiles:[[col,row]],targetMap,targetSpotId:'den_exit',
      spawnCol:0,spawnRow:0,requiresKeyItem,hiddenUntilKeyItem:false,
      doorFurnitureKey:'cliffDoor',side};
    mapData.exits||=[];
    if(!mapData.exits.some(old=>old.id===id))mapData.exits.push(exit);
    mapData.keyGatedDoors||=[];
    if(!mapData.keyGatedDoors.some(old=>old.id===id))mapData.keyGatedDoors.push({
      id,col,row,rotY:side==='north'?180:0,side,requiresKeyItem,
      hiddenUntilKeyItem:false,furnitureKey:'cliffDoor',
    }); // Same physical key-gated interior door format as authored locale caverns.
    mapData.entrySpots={...(mapData.entrySpots||{}),[id]:{col,row,side}};
  }

  function decorateParent(profile,mapData,plan,blockedKeys,allTiles) {
    if(!profile?.fortifiedStronghold)return false;
    const entrance={col:Number(mapData.exitCol)||0,row:Number(mapData.exitRow)||0};
    const candidates=(allTiles||[]).filter(tile=>{
      const col=Number(tile.col),row=Number(tile.row);
      return Number.isFinite(col)&&Number.isFinite(row)&&!blockedKeys.has(col+','+row)
        && Math.hypot(col-entrance.col,row-entrance.row)>5
        && (plan.banditSpawns||[]).every(b=>Math.hypot(col-b.col,row-b.row)>1.5);
    }).sort((a,b)=>Math.hypot(b.col-entrance.col,b.row-entrance.row)
      -Math.hypot(a.col-entrance.col,a.row-entrance.row));
    if(!candidates.length)return false; // Never place a boss exit in solid/caved floor.
    const selected=candidates[0],tile={col:Number(selected.col),row:Number(selected.row)};
    const bossMap=profile.mapId+'_boss';
    gate(mapData,{id:'stronghold_boss_gate',...tile,targetMap:bossMap,
      requiresKeyItem:GARRISON_KEY,label:'Bandit Lord Gate'});
    plan.bossGate={...tile,mapId:bossMap,requiresKeyItem:GARRISON_KEY};
    blockedKeys.add(tile.col+','+tile.row);
    window.CaveSiteSystem?.rememberStrongholdGate?.(profile.mapId,'boss',tile);
    return true;
  }

  function circularTiles(cx,cy,radius) {
    const tiles=[]; // Exact round floor; the existing SDF cave carver shapes the surrounding stone.
    for(let x=cx-radius-1;x<=cx+radius+1;x++)for(let y=cy-radius-1;y<=cy+radius+1;y++)
      if(x>=1&&y>=1&&(x-cx)**2+(y-cy)**2<=radius**2)tiles.push([x,y]);
    return tiles;
  }

  function decorateChild(profile,mapData) {
    if(!profile?.fortifiedStrongholdChild||!mapData)return mapData;
    const isBoss=profile.fortifiedStrongholdChild==='boss',r=isBoss?BOSS_RADIUS:TREASURY_RADIUS;
    const cx=Math.max(10,Math.floor(Number(mapData.exitCol)||10));
    const cy=Math.max(10,Math.floor(Number(mapData.exitRow)||10));
    const south={col:cx,row:cy+r-1};
    mapData.floor=circularTiles(cx,cy,r);
    mapData.exitCol=south.col;mapData.exitRow=south.row;
    mapData.exits=[{id:'den_exit',label:isBoss?'Back to the Garrison':'Back to the Bandit Lord Hall',
      tiles:[[south.col,south.row]],targetMap:isBoss?profile.parentMapId:profile.parentMapId+'_boss',
      targetSpotId:isBoss?'stronghold_boss_gate':'stronghold_treasury_gate',
      spawnCol:0,spawnRow:0,generateDoor:false}];
    mapData.entrySpots={den_exit:{...south,side:'south'}};
    mapData.keyGatedDoors=[];mapData.caveProps=[];mapData.furniture=[];
    mapData.oreRocks=[];mapData.creatureSpawns=[];mapData.nestCol=null;mapData.nestRow=null;
    mapData.denResidentSpecies=null;mapData.denMotherKind=null;mapData.denMotherDefeated=true; // A captain cave is never a wildlife Den-Mother room.
    const rng=rngFor(profile.signature+':round-room');
    window.CavernGenerator?.expandCavernMapData?.(mapData,[],rng); // Native shell/colliders, same material lighting and cave x-ray.
    mapData.colliders=mapData.outerRimTiles||[]; // Never retain colliders from the original generic den maze inside the new circular room.
    const floor=new Set((mapData.floor||[]).map(([x,y])=>x+','+y));
    const centerCandidates=(mapData.floor||[]).map(([x,y])=>({col:x,row:y}))
      .sort((a,b)=>Math.hypot(a.col-cx,a.row-cy)-Math.hypot(b.col-cx,b.row-cy));
    const center=centerCandidates[0]||{col:cx,row:cy};
    if(isBoss){
      mapData.name='Bandit Lord Hall';
      mapData.caveBanditSpawns=[{id:'bandit-lord',col:center.col,row:center.row,
        rank:'captain',tier:3,strongholdLord:true,bossVariant:kindFor(profile)}];
      const northCandidates=[...centerCandidates].filter(tile=>tile.row<=cy-r+3&&Math.hypot(tile.col-center.col,tile.row-center.row)>4);
      const north=northCandidates.sort((a,b)=>a.row-b.row)[0] || centerCandidates.find(tile=>Math.hypot(tile.col-center.col,tile.row-center.row)>3);
      if(north){
        gate(mapData,{id:'stronghold_treasury_gate',col:north.col,row:north.row,
          targetMap:profile.parentMapId+'_treasury',requiresKeyItem:TREASURY_KEY,
          label:'Locked Treasury',side:'north'});
        window.CaveSiteSystem?.rememberStrongholdGate?.(profile.mapId,'treasury',north);
      }
    }else{
      mapData.name='Bandit Lord Treasury';
      const chests=[];
      for(let i=0;i<CHEST_KEYS.length;i++){
        const preferred={col:cx+(i-1)*2,row:cy-1};
        const spot=floor.has(preferred.col+','+preferred.row)?preferred:centerCandidates.find(tile=>
          !chests.some(c=>Math.hypot(c.col-tile.col,c.row-tile.row)<2) &&
          Math.hypot(tile.col-south.col,tile.row-south.row)>2);
        if(!spot)continue;
        const chest={id:'treasury-chest-'+i,key:CHEST_KEYS[i],tier:i+2,col:spot.col,row:spot.row};
        chests.push(chest);
        mapData.caveProps.push({...chest,rotY:180});
      }
      mapData.strongholdTreasuryChests=chests;
      const slots=5+hash(profile.signature+':treasury-barrels')%4; // Five through eight physical Aging Barrel Burdens.
      const taken=new Set(chests.map(c=>c.col+','+c.row));
      const barrelSites=centerCandidates.filter(p=>Math.hypot(p.col-south.col,p.row-south.row)>2.5)
        .filter(p=>!taken.has(p.col+','+p.row));
      const barrels=[];
      for(const p of barrelSites) {
        if(barrels.length>=slots)break;
        if(barrels.some(old=>Math.hypot(old.col-p.col,old.row-p.row)<1.6))continue;
        barrels.push({id:'treasury-barrel-'+barrels.length,kind:'contrabandBarrel',
          col:p.col,row:p.row});
      }
      mapData.caveSitePlan={strongholdBarrels:barrels};
      mapData.strongholdBarrels=barrels;
    }
    const parentReturn=window.CaveSiteSystem?.strongholdGateReturn?.(
      isBoss?profile.parentMapId:profile.parentMapId+'_boss',
      isBoss?'boss':'treasury');
    if(parentReturn){mapData.exits[0].spawnCol=parentReturn.col;mapData.exits[0].spawnRow=parentReturn.row;}
    return mapData;
  }

  function entityOptions(profile,spawn,cfg) {
    if(profile?.fortifiedStronghold && spawn?.strongholdRole) {
      const role=spawn.strongholdRole; // The existing cave bandit roster uses regular BanditCombat actors.
      if(role==='crossbowman')return {
        defOverride:{rangedWeaponKey:'crossbow'}, // Native weapon holder and RangedWeapons AI, not a fake visual crossbow.
        extra:{banditStrongholdRole:role,state:'chase'},
      };
      return {extra:{banditStrongholdRole:'charger',state:'chase'}}; // Melee troops run down the unobstructed center lane.
    }
    if(profile?.fortifiedStrongholdChild!=='boss'||!spawn?.strongholdLord)return null;
    return { nameOverride:'Bandit Lord',avatarRigScale:{x:1.1,y:1.14,head:1.1},
      extra:{banditStrongholdBoss:true,banditStrongholdVariant:spawn.bossVariant||kindFor(profile),
        banditStrongholdParentMapId:profile.parentMapId}};
  }

  function onEntitySpawned(profile,spawn,entity,deps) {
    if(!entity||profile?.fortifiedStrongholdChild!=='boss'||!spawn?.strongholdLord)return;
    entity.banditStrongholdBoss=true;
    entity.banditStrongholdVariant=spawn.bossVariant||kindFor(profile);
    entity.name='Bandit Lord';
    entity.banditMastery=5; // Original captain at tier 3 is masteryBase 2 + tier 3 = 5.
    const hp=Math.max(1,Math.round((Number(entity.maxHealth)||Number(entity.def?.maxHealth)||80)*BOSS_HEALTH_MULTIPLIER));
    const damage=Math.max(1,Math.round((Number(entity.def?.attackDamage)||12)*BOSS_DAMAGE_MULTIPLIER)); // Same canonical attack formula, increased once on the boss definition.
    entity.health=entity.maxHealth=hp;entity.def={...entity.def,maxHealth:hp,attackDamage:damage,leashRangePx:(Number(deps?.TILE)||64)*18};
    liveLords.set(profile.mapId,entity);
    if(entity.banditStrongholdVariant==='beastkeeper')spawnBeastkeeperWolves(profile,entity,deps);
    status.last='Spawned '+entity.banditStrongholdVariant+' Lord '+profile.mapId;
  }

  function spawnBeastkeeperWolves(profile,boss,deps) {
    if(!deps?.makeCreatureEntity||!deps?.hostileObjects||!deps?.companionObjects)return 0;
    if(liveWolves.get(profile.mapId)?.length)return 0;
    const t=Number(deps.TILE)||64, wolves=[];
    for(let slot=0;slot<3;slot++){
      const ang=(slot/3)*Math.PI*2;
      const x=boss.x+Math.cos(ang)*t*1.5,y=boss.y+Math.sin(ang)*t*1.5;
      const creature=deps.makeCreatureEntity('gar-wolf',x,y,{
        scene:deps.getActiveScene?.(),grid:deps.getActiveGrid?.(),
        cols:deps.getActiveCols?.(),rows:deps.getActiveRows?.(),
        genotype:window.CreatureGenetics?.makeDefaultGenotype?.('gar-wolf')||null,
        master:boss,banditCompanion:true,homeX:boss.x,homeY:boss.y,state:'idle',
      });
      if(!creature)continue;
      const hp=Math.max(1,Math.round((Number(creature.maxHealth)||Number(creature.def?.maxHealth)||40)*WOLF_HEALTH_MULTIPLIER));
      creature.health=creature.maxHealth=hp;
      creature.def={...creature.def,maxHealth:hp,hostile:true};
      creature.banditStrongholdBossWolf=true;creature.banditCompanion=true;
      creature.banditStrongholdBossId=boss.id;creature.areaId=profile.mapId;
      creature.visualScaleX=(Number(creature.visualScaleX)||1)*1.28;
      creature.visualScaleY=(Number(creature.visualScaleY)||1)*1.28;
      creature.visualScaleZ=(Number(creature.visualScaleZ)||1)*1.28;
      deps.hostileObjects.add(creature);deps.companionObjects.add(creature);
      wolves.push(creature);
    }
    liveWolves.set(profile.mapId,wolves);status.wolves+=wolves.length;
    return wolves.length;
  }

  function onWolfPounce(wolf,victim,deps) {
    if(!wolf?.banditStrongholdBossWolf||!victim)return false;
    window.ResourceSystem?.spendFooting?.(victim,18,'Bandit Lord wolf pounce'); // Additional Footing over the original pounce damage.
    const lord=liveLords.get(wolf.areaId);
    const tile=Number(deps?.TILE)||64;
    if(lord?.health>0&&lord!==victim&&Math.hypot(lord.x-victim.x,lord.y-victim.y)<tile*.95)
      deps?.damageCreature?.(lord,Math.max(1,Math.round((Number(wolf.def?.attackDamage)||8)*.35)),
        wolf.x,wolf.y,0,{tag:'blunt',friendlyFire:true,factionCombat:true,attacker:wolf});
    return true; // Wolves can accidentally strike the Lord; his own attacks never target them.
  }

  function masteryEffectsForHit(actor) {
    const progress=window.CombatProgression;
    const damageType=String(actor?.def?.attackTag)==='blunt'?'blunt':'sharp';
    const abilityId=actor?.def?.banditAbilityLoadout?.tap1||'swingCombo';
    const tree=progress?.getTree?.(abilityId,damageType);
    const options=[...new Map((tree||[]).flat().filter(o=>o?.afflictions||o?.quickBonusAfflictions)
      .map(o=>[o.effectId||o.label,o])).values()]; // Actual mastery's 5-level effect catalog, never synthetic debuffs.
    const selected=[];
    while(selected.length<3&&options.length)selected.push(options.splice(Math.floor(Math.random()*options.length),1)[0]);
    actor._banditLordLastMasteryEffects=selected.map(o=>({id:o.effectId,label:o.label,
      damageType,afflictions:{...(o.afflictions||o.quickBonusAfflictions)}}));
    return actor._banditLordLastMasteryEffects;
  }

  function enrichHit(actor,options) {
    if(!actor?.banditStrongholdBoss)return options;
    const effects=masteryEffectsForHit(actor),combined={...(options?.afflictionBonuses||{})};
    for(const effect of effects)for(const [tag,amount] of Object.entries(effect.afflictions))
      combined[tag]=(Number(combined[tag])||0)+(Number(amount)||0);
    status.masteryHits++;
    status.last='Lord hit with '+effects.map(effect=>effect.label).join(', ');
    return {...options,afflictionBonuses:combined};
  }

  function updateAI(actor,dt,target) {
    if(!actor?.banditStrongholdBoss||actor.banditStrongholdVariant!=='demolitionist'||!target||target.health<=0)return null;
    actor._strongholdVolleyCooldown=Math.max(0,(actor._strongholdVolleyCooldown||0)-Math.max(0,Number(dt)||0));
    if(actor._strongholdVolleyActive)return {handled:true,aimAngle:actor.facing||0,moving:false};
    if(actor._banditAction)return null;
    if(actor._strongholdVolleyCooldown>0) return actor._strongholdVolleyCount>0
      ?{handled:true,aimAngle:Math.atan2(target.y-actor.y,target.x-actor.x),moving:false}:null; // The 3-volley sequence finishes before melee resumes.
    if(!window.Combat?.beginStagedAction||!window.AlchemyFlasks?.throwFromEntity
      ||!window.BanditStrongholdCombat?.launch)return null;
    const t=Number(actor._strongholdTileSize)||64;
    const distance=Math.hypot(actor.x-target.x,actor.y-target.y)/t;
    if(distance<3.5||distance>9)return null; // Lord fights with his usual mastery-5 melee inside this window.
    if(window.RangedWeapons?.hasLineOfSight?.(actor,target)===false)return null;
    const recipes=[...(window.BanditCombat?.availableFlaskRecipeIds?.()||[])];
    if(recipes.length<2)return null;
    const animation=window.HeldActionAnimations?.throwFlask;
    if(!animation?.poses)return null;
    actor._strongholdVolleyActive=true;
    actor._strongholdVolleyCount=actor._strongholdVolleyCount||0; // Three distinct volleys, then a fixed melee recovery.
    actor._banditSwingAnim=animation.style||'chop';
    actor._banditSwingPose=animation.poses;actor.telegraphState='windup';
    let released=false; // A staggered windup is not one of the three promised physical volleys.
    const cleanup=()=>{
      actor._strongholdVolleyActive=false;
      if(released)actor._strongholdVolleyCount++;
      if(actor._strongholdVolleyCount>=3){
        actor._strongholdVolleyCount=0;
        actor._strongholdVolleyCooldown=6; // A clear melee interval after exactly three projectile volleys.
      }else actor._strongholdVolleyCooldown=released?1.5:1;
      window.BanditCombat?.finishAction?.(actor);
    };
    actor._banditAction=window.Combat.beginStagedAction({
      windupS:.64,strikeS:.32,recoverS:0,
      data:{isBandit:true,attacker:actor,strongholdDemolitionist:true},
      onStrike:()=>{
        if(actor.health<=0)return;
        released=true; // Interrupted telegraphs never advance the three-volley sequence.
        const area=actor.areaId;
        Promise.resolve(window.BanditStrongholdCombat.launch(actor,target,'shattercask',area))
          .catch(error=>window.__farmLog?.('[bandit-lord] barrel volley failed: '+error.message,'warn'));
        const bearing=Math.atan2(target.y-actor.y,target.x-actor.x);
        for(const sign of [-1,1]){
          const recipe=recipes[Math.floor(Math.random()*recipes.length)];
          const offset=bearing+sign*.11; // Two native Flask projectiles form a 12.6° narrow cone beside the Shattercask.
          window.AlchemyFlasks.throwFromEntity(actor,recipe,3,
            target.x+Math.cos(offset)*t*.85,target.y+Math.sin(offset)*t*.85);
        }
        status.volleys++;
        actor.telegraphState='strike';
      },
      onComplete:cleanup,onCancel:cleanup,
    });
    if(!actor._banditAction){cleanup();return null;}
    return {handled:true,aimAngle:Math.atan2(target.y-actor.y,target.x-actor.x),moving:false};
  }

  function grantItems(loot) {
    if(!window.Shattercasks?.grantBurdenLoot)return null;
    return window.Shattercasks.grantBurdenLoot(loot); // Existing inventory grant handles gold, keys and mastery scrolls.
  }

  function scrollLoot(actor) {
    const progress=window.CombatProgression;
    const examples=actor._banditLordLastMasteryEffects?.length
      ?actor._banditLordLastMasteryEffects:masteryEffectsForHit(actor);
    const loot={};
    for(const effect of examples){
      const catalog=progress?.getEffectCatalog?.().find(row=>row.id===effect.id);
      const ranks=catalog?.unlockRanks?.[effect.damageType]||[];
      if(!ranks.length)continue;
      const key=progress?.itemKey?.(effect.damageType,ranks[ranks.length-1],effect.id,'scroll');
      if(key)loot[key]=1; // Readable actual Weapon Mastery unlock scrolls, not flavor-only copies.
    }
    if(!Object.keys(loot).length)loot.techniqueScrollTier3=1; // Existing tier-three technique fallback if specialized catalog is late.
    return loot;
  }

  function grantCorpseDrops(actor) {
    if(!actor?.banditStrongholdBoss)return [];
    if(!window.CaveSiteSystem?.claimStrongholdLordKey?.(actor.areaId))return [];
    const loot={[TREASURY_KEY]:1,...scrollLoot(actor)};
    const gained=grantItems(loot);
    status.keysClaimed++;status.last='Lord key recovered: '+actor.areaId;
    return Array.isArray(gained)?gained:[];
  }

  function installCorpseHook() {
    const api=window.BanditCamps;
    if(!api?.makeCorpseWorldObject||api.__strongholdBossCorpseHook)return false;
    const original=api.makeCorpseWorldObject; // Original corpse loot, equipment and Technique Scroll wrappers remain intact.
    api.makeCorpseWorldObject=function lordCorpse(c,...args) {
      const corpse=original.call(this,c,...args);
      if(!c?.banditStrongholdBoss||!corpse?.onAction)return corpse;
      const previous=corpse.onAction;
      corpse.onAction=function lordCorpseAction(action,...rest){
        const result=previous.call(this,action,...rest);
        if(result?.ok) {
          const extras=grantCorpseDrops(c);
          if(extras.length)result.message=(result.message||'')+' 🗝️ '+extras.join(', ');
        }
        return result;
      };
      return corpse;
    };
    api.__strongholdBossCorpseHook=true;
    return true;
  }

  function tick(profile,plan,state,deps) {
    if(!profile||!state)return false;
    if(profile.fortifiedStronghold){
      if(!state.occupantsCleared)return false;
      const available=!!inventoryDeps?.inventory;
      const keyCount=Number(inventoryDeps?.inventory?.[GARRISON_KEY])||0;
      if(!state.strongholdGarrisonSealGranted||(available&&!keyCount)){
        if(!grantItems({[GARRISON_KEY]:1}))return false;
        window.CaveSiteSystem?.markStrongholdGarrisonSeal?.(profile.mapId);
        status.last='Garrison seal granted for '+profile.mapId;
        return true;
      }
      return false;
    }
    if(profile.fortifiedStrongholdChild==='boss') {
      const lord=liveLords.get(profile.mapId);
      if(lord && lord.health<=0)liveLords.delete(profile.mapId);
      const wolves=liveWolves.get(profile.mapId);
      if(wolves?.length)for(const wolf of [...wolves])if(wolf.health<=0){
        wolves.splice(wolves.indexOf(wolf),1);
        deps?.companionObjects?.delete?.(wolf);
      }
    }
    if(profile.fortifiedStrongholdChild==='treasury')
      window.BanditStrongholds?.ensureBarrels?.(profile.mapId,plan,
        deps?.getActiveScene?.()||deps?.zoneScenes?.get?.(profile.mapId)?.scene);
    return false;
  }

  function objectAt(profile,plan,col,row,state,ctx) {
    if(profile?.fortifiedStrongholdChild!=='treasury'||ctx?.currentArea!==profile.mapId
      ||ctx.distanceTiles>1.55)return null;
    const chest=(plan.strongholdTreasuryChests||[]).find(c=>c.col===col&&c.row===row);
    if(!chest||state?.strongholdChestClaims?.includes(chest.id))return null;
    const valid=()=>window.CaveSiteSystem?.profileForMapId?.(profile.mapId)?.fortifiedStrongholdChild==='treasury'
      && !window.CaveSiteSystem?.strongholdStage?.(profile.mapId)?.treasuryClaimed?.includes(chest.id);
    return {id:chest.id,type:'treasure_chest',col,row,label:'🎁 Bandit Treasury Chest',
      getButtons:()=>[{icon:'🎁',label:'Loot Treasury Chest',action:'obj_loot_stronghold_chest',style:'primary',allowed:valid()}],
      onAction(action){
        if(action!=='obj_loot_stronghold_chest'||!valid())return {ok:false,message:'The chest is no longer available.'};
        if(!window.LootRolling?.rollLootPool||!window.Shattercasks?.grantBurdenLoot)
          return {ok:false,message:'Treasure is not yet ready.',deferMemberSave:true};
        // A *Puzzle Cave* chest earns one of its authentic exclusive benefit/drawback
        // trinkets. The ordinary dungeon chest pool adds coins/materials using the
        // established rarity generator without replacing that reward.
        const puzzle=window.LootRolling.rollLootPool('puzzleCave',{
          rewardTier:chest.tier,masterySource:'banditStronghold',zoneId:profile.zoneId,
        })||{};
        if(!Object.keys(puzzle).length || typeof window.TrinketSystem?.claimLoot!=='function')
          return {ok:false,message:'The Puzzle Cave treasure is not ready.',deferMemberSave:true};
        const ordinary=window.LootRolling.rollLootPool('dungeonChest_tier'+chest.tier,
          {masterySource:'banditStronghold',zoneId:profile.zoneId})||{};
        const items={...ordinary};
        for(const [key,count] of Object.entries(puzzle))items[key]=(Number(items[key])||0)+Number(count);
        if(!window.CaveSiteSystem.claimStrongholdChest(profile.mapId,chest.id))
          return {ok:false,message:'This chest has already been looted.',deferMemberSave:true};
        const trinkets=window.TrinketSystem.claimLoot(items,'banditStronghold')||[]; // Mutates items, consuming trinket_ keys so inventory never receives duplicate/unknown trinkets.
        const granted=window.Shattercasks.grantBurdenLoot(items)||[];
        status.chestsClaimed++;status.last='Treasury '+chest.id+' looted';
        return {ok:true,message:[...granted,...trinkets].length
          ?'Treasury: '+[...granted,...trinkets].join(', '):'You open the treasury chest.',deferMemberSave:true};
      },
    };
  }

  function bossStillAlive(mapId,hostiles) {
    const lord=liveLords.get(String(mapId));
    return !!(lord&&lord.health>0&&[...(hostiles||[])].includes(lord));
  }

  function forgetMap(mapId,deps) {
    liveLords.delete(String(mapId));
    const wolves=liveWolves.get(String(mapId));
    if(wolves)for(const creature of wolves) {
      deps?.hostileObjects?.delete?.(creature);deps?.companionObjects?.delete?.(creature);
      deps?.despawnCreature?.(creature);
    }
    liveWolves.delete(String(mapId));
  }

  function debugSnapshot() {
    return {...status,variantMaps:[...liveLords].map(([mapId,boss])=>({mapId,variant:boss.banditStrongholdVariant,
      health:boss.health,mastery:boss.banditMastery,effects:boss._banditLordLastMasteryEffects?.map(e=>e.label)||[]})),
      summonedWolves:[...liveWolves].map(([mapId,wolves])=>({mapId,alive:wolves.filter(w=>w.health>0).length}))};
  }

  window.BanditStrongholdBoss=Object.freeze({
    decorateParent,decorateChild,entityOptions,onEntitySpawned,onWolfPounce,enrichHit,updateAI,
    grantCorpseDrops,installCorpseHook,installItemRegistration,itemRegistration,
    tick,objectAt,bossStillAlive,forgetMap,debugSnapshot,
    __test:Object.freeze({circularTiles,kindFor,masteryEffectsForHit,scrollLoot}),
  });
  installCorpseHook();installItemRegistration();
})();
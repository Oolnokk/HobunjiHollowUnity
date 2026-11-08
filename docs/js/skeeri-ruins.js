// Ruin-only Skeeri. Uses WildlifeSpawn's creature roster/tick, the shared
// flying rig and Tzatzul body sweep, and real Hronal Witch-bomb burdens.
(() => {
  'use strict';
  if (window.SkeeriRuins) return;

  const MAP_ID = 'map_i_dev_random_ruin'; // The currently supported generated-ruin map; never spawn these in wilderness ecology.
  const RIG_URL = 'config/creatures/skeeri-flying-rig.json'; // Authored wings, folded pose and burden-grip socket.
  const SPRITES = Object.freeze({
    flying:'assets/creaturesprites/skeeri_planebent_flying.png',
    perched:'assets/creaturesprites/skeeri_planebent_perched.png',
    wings:'assets/creaturesprites/skeeri_wings.png',
  }); // The existing authoring sprites serve every size; actor scale supplies the differences.
  const SPECIES = Object.freeze({
    small: {key:'skeeri-small',label:'Small Skeeri',size:'small',width:.65,health:18,damage:5,speed:7.5},
    medium:{key:'skeeri-medium',label:'Skeeri',size:'medium',width:1.15,health:54,damage:13,speed:6.8},
    large: {key:'skeeri-large',label:'Large Skeeri',size:'large',width:2.2,health:125,damage:17,speed:12},
  }); // A single flight engine applies size-specific combat tuning.
  const LICH_HUES = Object.freeze({ // Mirrors HarlyaoLichCombat.TYPE_DEFS, the owner of each tradition's robe dye hue family.
    hronal:Object.freeze(['red','red_orange','orange','yellow_orange','yellow']),
    tothal:Object.freeze(['green_blue','blue','blue_indigo']),
    kanthic:Object.freeze(['indigo','indigo_violet','violet']),
  });
  const BODY_VARIANTS = Object.freeze(['dusty','muted','dark_muted']); // Natural-looking entries from the same existing dye families liches use.
  const EYE_VARIANTS = Object.freeze(['pure','bright']); // Deliberately uncanny vivid dyes within those same families, never a complementary hue from another tradition.
  const BODY_GROUPS = Object.freeze({ // Fallback natural swatches if the normal dye catalog has not loaded yet.
    hronal:Object.freeze(['#854e48','#875a42','#967d55','#605052']), // Muted reds, rust orange and ochre, not an unrelated brown dye.
    tothal:Object.freeze(['#497a75','#5f788d','#555c83','#7d9497']), // Sea-glass green-blue, foggy blue and muted indigo.
    kanthic:Object.freeze(['#56506b','#6b536d','#514765','#808080']), // Ash-indigo, violet and canonical Kanthic neutral gray.
  });
  const EYE_GROUPS = Object.freeze({ // Fallback vivid entries in the actual tradition, rather than the lich's inverse-color glyph.
    hronal:Object.freeze(['#ff3737','#ff8027','#ffcc19']),
    tothal:Object.freeze(['#04ffdb','#2b98ff','#5676ff']),
    kanthic:Object.freeze(['#8b35ff','#d72aff','#ff4ef0']),
  });
  const EYE_MARKER = '#7F00FF'; // The exact purple source family already used for maskbound mask/lich eye dye.
  const HATCH_OPEN_SECONDS = .65; // Stone hatch slides upward before the concealed enemies emerge.
  const ACTIVATION_RADIUS = 3.3; // Within a few tiles, the proximity compartment opens.
  const SHAFT_RADIUS = 19; // Bomber only makes attack runs while the player is in the shaft.
  const clamp = (v,a,b) => Math.max(a,Math.min(b,Number(v)||0));
  const hash = str => {let h=2166136261;for(const ch of String(str))h=Math.imul(h^ch.charCodeAt(0),16777619)>>>0;return h;}; // Separate deterministic rolls do not perturb the generator RNG.
  const distance = (a,b) => Math.hypot(a.x-b.x,a.z-b.z); // Flight/trigger distances are measured in world tiles.
  const snapshot = {mounts:0,hatchesOpened:0,spawned:0,dives:0,hits:0,bombRuns:0,bombsDropped:0,failedSpawns:0,eyeMarkerPixels:0,lastError:null}; // Readable on mobile without developer console.
  let deps = null; // Injected once by WildlifeSpawn.init: authoritative player, factory and hostile collection.
  let owner = null; // Exactly one disposable generated-ruin encounter session.
  let rigPromise = null; // Shared immutable sprite/JSON download across all three Skeeri sizes.

  function traditionOf(value) {return Object.hasOwn(LICH_HUES,String(value))?String(value):'hronal';} // Reject nonexistent lich theme IDs.
  function catalogPalette(theme,variants,addNeutrals=false) {
    const catalog=window.SCRATCHBONES_CONFIG?.game?.dyes?.catalog || window.ScratchbonesAccount?.getDyeCatalog?.() || []; // Same authored dye swatches as lich wardrobe.
    const available=new Map(catalog.filter(entry=>/^#[0-9a-f]{6}$/i.test(entry?.hex||'')).map(entry=>[entry.id,entry.hex]));
    const tradition=window.HarlyaoLichCombat?.TYPE_DEFS?.[theme]; // Prefer the owner of lich color groups, not a second independent range.
    const hues=tradition?.hues || LICH_HUES[theme];
    const ids=variants.flatMap(variant=>hues.map(hue=>'dye:CLOTH:'+variant+'_'+hue));
    if(addNeutrals)ids.push(...(tradition?.neutralDyes || ['dye:CLOTH:white','dye:CLOTH:gray','dye:CLOTH:charcoal']));
    return ids.filter(id=>available.has(id)).map(id=>({id,hex:available.get(id)}));
  }
  function paletteFor(theme,identity) {
    const family=traditionOf(theme),slot=hash(String(identity)); // Stable appearance independent of AI RNG and encounter order.
    const bodies=catalogPalette(family,BODY_VARIANTS,family==='kanthic');
    const eyes=catalogPalette(family,EYE_VARIANTS);
    const body=bodies.length?bodies[slot%bodies.length]:null;
    const eye=eyes.length?eyes[hash(String(identity)+':eye')%eyes.length]:null;
    return {theme:family,body:body?.hex||BODY_GROUPS[family][slot%BODY_GROUPS[family].length],
      eyes:eye?.hex||EYE_GROUPS[family][hash(String(identity)+':eye')%EYE_GROUPS[family].length],
      bodyDyeId:body?.id||null,eyeDyeId:eye?.id||null}; // Mobile diagnostics show exactly which lich-family swatches were chosen.
  }

  function separateEyeMarker(image) {
    if(typeof document==='undefined')return {body:image,glow:null,marked:0};
    const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height; // Source-space pixels preserve both authored poses.
    const canvas=()=>Object.assign(document.createElement('canvas'),{width,height});
    const body=canvas(),bodyCtx=body.getContext('2d',{willReadFrequently:true});
    const core=canvas(),coreCtx=core.getContext('2d');
    bodyCtx.drawImage(image,0,0,width,height);
    const pixels=bodyCtx.getImageData(0,0,width,height),eyes=coreCtx.getImageData(0,0,width,height);
    let marked=0;
    for(let i=0;i<pixels.data.length;i+=4) {
      const r=pixels.data[i],g=pixels.data[i+1],b=pixels.data[i+2],a=pixels.data[i+3];
      // Purple marker, including its shaded/antialiased variations; ordinary shadows and non-marker anatomy remain intact.
      if(!a||b<50||r<b*.28||r>b*.75||g>b*.24)continue;
      eyes.data[i]=eyes.data[i+1]=eyes.data[i+2]=255;
      eyes.data[i+3]=a;
      pixels.data[i+3]=0; // Remove the magenta eye from the naturally tinted body before adding its independent emissive layer.
      marked++;
    }
    if(!marked)return {body:image,glow:null,marked:0};
    bodyCtx.putImageData(pixels,0,0);coreCtx.putImageData(eyes,0,0);
    const glow=canvas(),ctx=glow.getContext('2d'); // Blurred halo and bright core are one shared source-space sprite.
    ctx.filter='blur(12px)';ctx.globalAlpha=.8;ctx.drawImage(core,0,0);
    ctx.filter='none';ctx.globalAlpha=1;ctx.drawImage(core,0,0);
    return {body,glow,marked};
  }

  function register(injected = {}) {
    const db=injected.CREATURE_DB; // Species definitions consumed by the existing creature factory.
    if (!db) return false;
    const baseline=db['gar-wolf'] || db.grehlr || {};
    const render=window.CreatureGeneticsRender?.SPECIES; // Canonical fallback sprite presentation before the authored rig loads.
    for(const [size,entry] of Object.entries(SPECIES)){
      const previous=db[entry.key] || {};
      db[entry.key]={...baseline,...previous,label:entry.label,hostile:true,diet:'carnivore',
        defaultSizeClass:entry.size,modelWidth:entry.width,maxHealth:entry.health,
        spriteAspect:1000/1617,isFlyingSpecies:true,attacks:[],
        attackDamage:entry.damage,attackTag:'sharp',attackCooldownS:2.5,
        sprites:{idle:SPRITES.perched,run:[SPRITES.flying,SPRITES.flying]}};
      if(render)render[entry.key] ||= {prefix:'skeeri',base:{
        idle:SPRITES.perched,run1:SPRITES.flying,run2:SPRITES.flying},patterns:[]};
    }
    return true;
  }
  function init(injected = {}) {
    if(owner)owner.dispose();
    deps=injected; // Same factory and frame clock already used by Tzatzul; never attach a second RAF.
    return !!deps.makeCreatureEntity;
  }
  function loadImage(url) {
    return new Promise((resolve,reject)=>{
      const image=new Image(); // Browser-decoded asset shared by every Skeeri flying rig.
      image.crossOrigin='anonymous';
      image.onload=()=>resolve(image);
      image.onerror=()=>reject(new Error('Skeeri sprite missing: '+url));
      image.src=url;
    });
  }
  function loadRig() {
    if(!rigPromise)rigPromise=Promise.all([
      fetch(RIG_URL).then(r=>{if(!r.ok)throw new Error('Skeeri rig HTTP '+r.status);return r.json();}),
      ...Object.values(SPRITES).map(loadImage),
    ]).then(([raw,flying,perched,wings])=>{
      const flight=separateEyeMarker(flying),rest=separateEyeMarker(perched); // Built once, never inside the render loop.
      snapshot.eyeMarkerPixels=flight.marked+rest.marked;
      if(!flight.marked||!rest.marked)window.__farmLog?.('[skeeri] planebent eye marker absent from a pose ('+EYE_MARKER+')','warn');
      return {rig:window.FlyingAnimalRig.normalize({...raw,
        flying:'creaturesprites/skeeri_planebent_flying.png',perched:'creaturesprites/skeeri_planebent_perched.png'}),
        images:{flying:flight.body,perched:rest.body,wings,glowFlying:flight.glow,glowPerched:rest.glow}};
    }).catch(error=>{rigPromise=null;snapshot.lastError=String(error);throw error;});
    return rigPromise;
  }
  async function createRig(actor=null) {
    const {rig,images}=await loadRig();
    const instance=window.FlyingAnimalRig.create(rig,images); // Native actor group owns orientation, hit flashes and disposal.
    const palette=actor?.skeeriPalette||paletteFor('hronal','preview');
    instance.restoreTint=()=>instance.setPalette?.(palette.body,palette.eyes)||false; // Restore after native hit flashes, excluding the separately colored eyes.
    instance.restoreTint();
    return instance;
  }
  function currentPlayer() {
    const p=deps?.player,unit=Number(deps?.TILE)||64; // Game actor coordinates use pixels; shaft geometry uses world tiles.
    return p?{x:p.x/unit,z:p.y/unit}:null;
  }
  function isActive(session) {
    return owner===session && !session.disposed && deps?.getCurrentArea?.()===session.mapId;
  }
  function actorLocation(actor,session) {
    const unit=Number(deps?.TILE)||64;
    return {x:actor.x/unit,z:actor.y/unit,y:Number(actor.branchSurfaceY) || session.nest.y};
  }
  function point(session,location) {
    const unit=Number(deps?.TILE)||64;
    return {x:location.x*unit,y:location.z*unit,worldY:location.y};
  }
  function flightTo(session,state,to,phase,speed) {
    const actor=state.actor,start=actorLocation(actor,session);
    const spatial=Math.hypot(to.x-start.x,to.z-start.z,to.y-start.y); // 3D distance determines consistent travel speed for multi-story drops.
    const line=window.PerchSupport?.line?.(state.id+':flight:'+state.serial++,point(session,start),point(session,to));
    if(!line || !window.PerchSupport.attach(actor,line,0))return false;
    state.segment={from:start,to,elapsed:0,duration:Math.max(.36,spatial/Math.max(1,speed))};
    state.phase=phase;state.struck=false;
    actor.skeeriFlightPose='flap';
    actor.skeeriDivePitchRad=Math.atan2(to.y-start.y,Math.hypot(to.x-start.x,to.z-start.z))*.7;
    return true;
  }
  function targetBox(session) {
    const player=deps?.player,p=currentPlayer(),hit=window.RangedWeapons?.actorHitbox?.(player);
    if(!p)return null;
    if(hit?.box?.min&&hit?.box?.max) {
      const dx=p.x-(Number(hit.center?.x)||p.x),dz=p.z-(Number(hit.center?.z)||p.z);
      return {min:{x:hit.box.min.x+dx,y:hit.box.min.y,z:hit.box.min.z+dz},
        max:{x:hit.box.max.x+dx,y:hit.box.max.y,z:hit.box.max.z+dz}};
    }
    const floor=Number(session.getPlayerY?.())||0; // The player's actual current floor prevents attacks through stacked balconies.
    return {min:{x:p.x-.38,y:floor,z:p.z-.38},max:{x:p.x+.38,y:floor+1.3,z:p.z+.38}};
  }
  function touchPlayer(session,state,start,end) {
    if(state.struck||!deps?.player || !(deps.player.health>0))return;
    const halfWidth=Math.max(.18,Number(state.actor.def?.modelWidth||.7)*.29);
    const target=targetBox(session),sweep=window.TzatzulFlightRuntime?.sweptBodyHit;
    if(!target||!sweep)return;
    const half={x:halfWidth,y:Math.max(.25,halfWidth*.8),z:halfWidth};
    if(sweep(start,end,half,target)===null)return;
    state.struck=true;
    const damage=Math.max(1,Math.round(state.spec.damage*(1+.12*state.tier)));
    const combat=window.Combat?.deps;
    if(typeof combat?.damagePlayer==='function'){
      combat.damagePlayer(damage,state.actor.x,state.actor.y,75,{attacker:state.actor,tag:'sharp',aerialSwoop:true,impactCollider:'body'});
      snapshot.hits++;
    }
  }
  function advance(session,state,dt) {
    const leg=state.segment;
    if(!leg)return false;
    const actor=state.actor,old=actorLocation(actor,session);
    leg.elapsed=Math.min(leg.duration,leg.elapsed+dt);
    actor.branchT=leg.elapsed/leg.duration; // Native branch/perch renderer uses this interpolation for both horizontal movement and height.
    if(!window.PerchSupport?.constrain?.(actor)){state.segment=null;return false;}
    actor.skeeriFlightPose=actor.branchT<.2||actor.branchT>.85?'flap':'glide';
    if(state.phase==='dive'){
      const from={x:old.x,y:old.y+.35,z:old.z},next=actorLocation(actor,session);
      touchPlayer(session,state,from,{x:next.x,y:next.y+.35,z:next.z}); // The same Tzatzul swept-body collider, never a scripted impact timer.
    }
    if(leg.elapsed<leg.duration)return false;
    state.segment=null;return true;
  }
  function alive(session,state) {
    if(state.dead)return false;
    if(!(state.actor.health>0) || !deps?.hostileObjects?.has?.(state.actor)){
      state.dead=true;window.PerchSupport?.release?.(state.actor,'skeeri defeated');
      return false;
    }
    return isActive(session);
  }
  function newActor(session,size,x,z,y,tier,index) {
    const spec=SPECIES[size],unit=Number(deps?.TILE)||64; // Shared creature factory creates the native targetable combat avatar.
    const actor=deps?.makeCreatureEntity?.(spec.key,x*unit,z*unit,{
      homeX:x*unit,homeY:z*unit,state:'idle',streamVisuals:true,
      ruinSkeeri:true,wildlifeRole:'predator',
    });
    if(!actor){snapshot.failedSpawns++;return null;}
    actor.areaId=session.mapId;
    actor.isRuinSkeeri=true; // Ground-AI arbitration can distinguish this intentional aerial movement.
    actor.skeeriPalette=paletteFor(session.theme,session.seed+':'+index); // Per-instance palette from the actual lich hue family; never mutate the species or shared assets.
    actor.skeeriFlightPose='perched';
    const perch=window.PerchSupport?.point?.('skeeri:'+session.seed+':'+index,x*unit,z*unit,y);
    if(!perch || !window.PerchSupport.attach(actor,perch)){
      actor.avatarRef?.group?.parent?.remove?.(actor.avatarRef.group);
      actor.avatarRef?.dispose?.();snapshot.failedSpawns++;return null;
    }
    const scaledHealth=Math.max(1,Math.round(spec.health*(1+.16*tier))); // Difficulty scales durability without changing authored species defaults.
    actor.maxHealth=scaledHealth;actor.health=scaledHealth;
    deps.hostileObjects.add(actor);
    const state={id:'skeeri:'+session.seed+':'+index,actor,spec,size,tier,
      phase:'rest',home:{x,z,y},serial:0,segment:null,cooldown:1+index*.4,
      dead:false,struck:false}; // One actor owns one flight phase; no extra navigation/physics loop.
    session.actors.add(state);snapshot.spawned++;
    return state;
  }
  function openHatch(session,hatch) {
    if(hatch.opened||!isActive(session))return false;
    hatch.opened=true;hatch.age=0;snapshot.hatchesOpened++;
    window.__farmLog?.('[skeeri] '+hatch.size+' compartment opens ('+hatch.reason+')','combat');
    return true;
  }
  function activateCompartment(id) {
    if(!owner)return false;
    const hatch=owner.hatches.find(c=>c.id===id);
    if(!hatch)return false;
    hatch.reason='mechanism';
    return openHatch(owner,hatch);
  }
  function signalMechanism() {
    const session=owner,p=currentPlayer();
    if(!session||!p||!isActive(session))return 0;
    const floor=Number(session.getPlayerY?.())||0;
    let opened=0;
    for(const hatch of session.hatches){
      if(hatch.trigger!=='mechanism'||Math.abs(hatch.y-floor)>3.5||distance(p,hatch)>6)continue;
      hatch.reason='mechanism';
      if(openHatch(session,hatch))opened++;
    }
    return opened; // Called by the existing layer/challenge onStateChange, not by a new global event poll.
  }
  function spawnHatch(session,hatch) {
    if(hatch.spawned||!isActive(session))return;
    hatch.spawned=true;
    const count=hatch.size==='small'?3:1; // Small Skeeri always emerge in threes; medium Skeeri emerge alone.
    for(let i=0;i<count;i++)newActor(session,hatch.size,
      hatch.x+.75+(i-1)*.32,hatch.z+.8,
      hatch.y+1.6+(i%2)*.3,hatch.floor,'h'+hatch.id+':'+i);
  }
  function nestVisual(session) {
    const THREE=window.THREE,root=new THREE.Group(); // Non-walkable high nest: intentionally registers no DynamicSurfaces support.
    root.name='skeeri-inaccessible-witch-bomb-nest';
    root.position.set(session.nest.x,session.nest.y,session.nest.z);
    const stone=window.ProceduralFurniture?.makePartMaterial?.({
      materialTexture:'carved_smooth.png',materialLighting:'unlit',materialFillMode:'never',color:'#504943',
    }) || new THREE.MeshBasicMaterial({color:0x504943}); // Keep the balcony visually consistent with shaft stone.
    const glow=new THREE.MeshBasicMaterial({color:0xe97528}); // Inert nest stores; playable bombs are spawned by HronalWitchBombs only on release.
    const platform=new THREE.Mesh(new THREE.BoxGeometry(6,.45,2.4),stone);
    platform.name='skeeri-high-balcony';root.add(platform);
    const rim=new THREE.Mesh(new THREE.BoxGeometry(6,.8,.25),stone);
    rim.position.set(0,.45,-1.1);rim.name='skeeri-nest-rim';root.add(rim);
    for(let i=0;i<4;i++){
      const prop=new THREE.Mesh(new THREE.SphereGeometry(.3,10,8),glow);
      prop.position.set((i-1.5)*.75,.45,.28);prop.name='skeeri-nest-bomb-stock';root.add(prop);
    }
    session.scene.add(root);session.roots.push(root);
    session.materials.add(stone);session.materials.add(glow);
  }
  function hatchVisual(session,room,size,trigger,index) {
    const THREE=window.THREE; // Door cut-stone hatch stays on the inside wall and slides instead of spawning black backdrops.
    const x=room.x+1.15,z=room.z+.17,y=room.y+1.35;
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(1.25,.94,.18),session.hatchMaterial);
    mesh.position.set(x,y,z);mesh.name='skeeri-concealed-wall-hatch';session.scene.add(mesh);
    const hatch={id:'skeeri-hatch-'+room.id+'-'+index,x,z,y:room.y,floor:index,
      size,trigger,reason:'proximity',opened:false,spawned:false,age:0,mesh,closedY:y}; // Floor index, not floor elevation, controls combat difficulty.
    session.hatches.push(hatch);session.roots.push(mesh);return hatch;
  }
  function mount(options={}) {
    if(owner)owner.dispose();
    const {rec,plan,seed,getPlayerY}=options; // Connector owns scene and the solved multi-story room plan.
    if(!deps?.makeCreatureEntity||!rec?.scene||!plan?.floors?.length||!window.PerchSupport)return null;
    const THREE=window.THREE;
    if(!THREE)return null;
    const top=plan.floors[plan.floors.length-1],anchor=plan.shaft.anchor;
    const session={mapId:rec.mapData?.id||MAP_ID,scene:rec.scene,seed:Number(seed)>>>0,
      getPlayerY,theme:traditionOf(options.theme),hatches:[],actors:new Set(),roots:[],materials:new Set(),disposed:false,
      nest:{x:anchor.x,z:anchor.z-20,y:top.y+11},bombers:[],lastSignal:0}; // All actor, hatch, nest and payload lifetime stays inside one generated map.
    session.hatchMaterial=window.ProceduralFurniture?.makePartMaterial?.({
      materialTexture:'carved_smooth.png',materialLighting:'unlit',materialFillMode:'never',color:'#6d6259',
    }) || new THREE.MeshBasicMaterial({color:0x6d6259});
    session.materials.add(session.hatchMaterial);
    session.dispose=()=>{
      if(session.disposed)return;session.disposed=true;
      for(const state of session.actors){
        window.TzatzulLiveVisuals?.release?.(state.actor,'ruin removed');
        window.PerchSupport?.forget?.(state.actor);
        state.actor.onBranch=null;state.actor.branchSurfaceY=0;
        deps?.hostileObjects?.delete?.(state.actor);
        state.actor.avatarRef?.group?.parent?.remove?.(state.actor.avatarRef.group);
        state.actor.groundShadow?.parent?.remove?.(state.actor.groundShadow);
        state.actor.avatarRef?.dispose?.();
      }
      for(const mesh of session.roots){mesh.parent?.remove(mesh);mesh.traverse?.(node=>{node.geometry?.dispose?.();});}
      for(const mat of session.materials)mat.dispose?.();
      if(owner===session)owner=null; // No enemy, async bomb callback or stone hatch survives a reroll.
    };
    owner=session; // WildlifeSpawn.updateHostileSpawning drives the only Skeeri flight step.
    for(const floor of plan.floors){
      const rooms=floor.rooms.filter(r=>r.kind==='challenge-room');
      if(!rooms.length)continue;
      const selected=rooms[hash(seed+':skeeri:'+floor.floor)%rooms.length];
      const medium=(hash(seed+':skeeri-size:'+floor.floor)%4)===0;
      const mechanism=(hash(seed+':skeeri-trigger:'+floor.floor)%3)===0;
      hatchVisual(session,selected,medium?'medium':'small',mechanism?'mechanism':'proximity',floor.floor);
    }
    nestVisual(session);
    const difficulty=clamp(options.difficulty??plan.floorCount,1,9); // One to three bombers as ruin difficulty increases.
    const bomberCount=difficulty<=3?1:difficulty===4?2:3; // Three-, four- and five-story shafts have one, two and three bombers respectively.
    for(let i=0;i<bomberCount;i++){
      const x=session.nest.x+(i-(bomberCount-1)/2)*1.8,z=session.nest.z+.1;
      const state=newActor(session,'large',x,z,session.nest.y+1.5,Math.floor(difficulty/2),'b'+i);
      if(state){state.phase='nest';state.cooldown=4+i*3;state.home={x,z,y:session.nest.y+1.5};session.bombers.push(state);}
    }
    snapshot.mounts++;
    return session;
  }
  async function dropBomb(session,state) {
    if(!isActive(session)||state.dead||state.pendingBomb)return;
    const player=currentPlayer(),bird=actorLocation(state.actor,session);
    if(!player||distance(player,bird)>5)return;
    const bombs=window.HronalWitchBombs;
    if(!bombs?.spawn||!window.Shattercasks?.releaseBurdenDownward)return;
    state.pendingBomb=true;
    try{
      const bomb=await bombs.spawn({mapId:session.mapId,scene:session.scene,
        x:bird.x,y:bird.y-.6,z:bird.z,fuseSeconds:14,hanging:false}); // The dropped sphere is an ordinary pickable/throwable Hronal burden.
      if(!bomb)return;
      if(!isActive(session)){window.Shattercasks.discardBurden?.(bomb);return;}
      if(window.Shattercasks.releaseBurdenDownward(bomb,'skeeri-bomber')){
        snapshot.bombsDropped++;
        window.__farmLog?.('[skeeri] bomber dropped pickable witch-bomb','combat');
      }else window.Shattercasks.discardBurden?.(bomb);
    }catch(error){snapshot.lastError=String(error);}
    finally{state.pendingBomb=false;}
  }
  function updateHatch(session,hatch,dt,player,playerY){
    if(!hatch.opened && hatch.trigger==='proximity' && player
      && Math.abs(hatch.y-playerY)<3.5 && distance(player,hatch)<ACTIVATION_RADIUS){
      hatch.reason='proximity';openHatch(session,hatch);
    }
    if(!hatch.opened)return;
    hatch.age+=dt;
    hatch.mesh.position.y=hatch.closedY+.98*clamp(hatch.age/HATCH_OPEN_SECONDS,0,1);
    if(hatch.age>=HATCH_OPEN_SECONDS)spawnHatch(session,hatch);
  }
  function updateDiver(session,state,dt,player,playerY) {
    const room=state.home;
    if(state.segment){
      const finished=advance(session,state,dt);
      if(finished && state.phase==='dive'){
        flightTo(session,state,room,'retreat',state.spec.speed*1.3);
      }else if(finished && state.phase==='retreat'){
        state.phase='rest';state.cooldown=2.6+(hash(state.id+snapshot.dives)%5)*.35;
        state.actor.skeeriFlightPose='perched';state.actor.skeeriDivePitchRad=0;
      }
      return;
    }
    if(state.phase!=='rest'||!player)return;
    state.cooldown-=dt;
    if(state.cooldown>0||Math.abs(playerY-room.y)>3.5||distance(player,room)>9)return;
    const to={x:player.x,z:player.z,y:playerY+.48};
    if(flightTo(session,state,to,'dive',state.spec.speed)){snapshot.dives++;}
  }
  function updateBomber(session,state,dt,player,playerY) {
    if(state.segment){
      const finished=advance(session,state,dt);
      if(finished && state.phase==='approach'){
        dropBomb(session,state);
        snapshot.bombRuns++;
        flightTo(session,state,state.home,'return',state.spec.speed*1.25);
      }else if(finished && state.phase==='return'){
        state.phase='nest';state.cooldown=7+hash(state.id+snapshot.bombRuns)%6;
        state.actor.skeeriFlightPose='perched';state.actor.skeeriDivePitchRad=0;
      }
      return;
    }
    if(state.phase!=='nest'||!player)return;
    state.cooldown-=dt;
    if(state.cooldown>0||distance(player,{x:session.nest.x,z:session.nest.z+20})>SHAFT_RADIUS)return;
    const to={x:player.x+(state.home.x-session.nest.x)*.15,
      z:player.z,y:playerY+5}; // A fast attack pass descends to player height, then immediately retreats to the inaccessible balcony.
    flightTo(session,state,to,'approach',state.spec.speed);
  }
  function update(dt=0) {
    const session=owner;
    if(!session||!isActive(session))return;
    const step=clamp(dt,0,.1),player=currentPlayer(),playerY=Number(session.getPlayerY?.())||0;
    for(const hatch of session.hatches)updateHatch(session,hatch,step,player,playerY);
    for(const state of session.actors){
      if(!alive(session,state))continue;
      if(state.size==='large')updateBomber(session,state,step,player,playerY);
      else updateDiver(session,state,step,player,playerY);
    }
  }
  function debugSnapshot() {
    return {...snapshot,active:!!owner,theme:owner?.theme||null,hatches:owner?.hatches.map(h=>({
      id:h.id,size:h.size,trigger:h.trigger,opened:h.opened,spawned:h.spawned}))||[],
    actors:[...(owner?.actors||[])].map(s=>({id:s.id,size:s.size,phase:s.phase,
      health:s.actor.health,y:Number(s.actor.branchSurfaceY)||0,palette:s.actor.skeeriPalette}))};
  }
  window.SkeeriRuins=Object.freeze({SPECIES,SPRITES,BODY_GROUPS,paletteFor,separateEyeMarker,register,init,createRig,mount,update,
    activateCompartment,signalMechanism,debugSnapshot,get active(){return owner;}});
})();

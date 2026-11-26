// Annual Five Blossoms crowning: an authored Director scene and a temporary live-villager audience.
// Independent of the quest counter and festival UI, like the existing RomanceWedding ceremony.
(() => {
  'use strict';
  const HOST_ID = 'father_hunundi_hodu'; // Actual NPC record that announces and awards the prize.
  const OWNER = 'five-blossoms-crowning'; // One schedule override keeps the real audience in the crowd.
  const NPC_DB_URL = 'config/npcs/hobunji-starter-npc-database.json'; // Same authored NPC source as the wedding.
  let deps = null; // FestivalSystem supplies town layout and currently loaded walker accessors.
  let holding = new Map(); // NPC id -> temporary look-at/station target; empty outside the cutscene.
  let running = false; // Rejects duplicate turn-in presses while the crowd is gathered.
  let lastError = ''; // Mobile debugging shows runtime/asset errors without requiring developer tools.
  let lastCast = []; // Keeps the exact villager ids recorded for the most recent ceremony.
  function stageRoot() {
    const decor = deps?.getLayout?.()?.decor || [];
    return decor.find(item => item.festivalLocale?.kind === 'bandstand' && item.key === 'festivalStage')
      || decor.find(item => item.festivalLocale?.kind === 'bandstand') || null; // Editor-movable bandstand is authoritative.
  }
  function stageSpot(stage) {
    if (!stage) return null;
    return { c:Number(stage.col) + 1.5 + (Number(stage.postX) || 0),
      r:Number(stage.row) + 1.05 + (Number(stage.postZ) || 0) }; // Two presenters fit inside the authored band's stage footprint.
  }
  function livingVillagers(walkers = deps?.getWalkers?.() || []) {
    const found = new Set(); // No duplicates when an NPC has both a primary walker and temporary role.
    return walkers.filter(walker => {
      const rec = walker?.rec, id = rec?.id;
      if (!id || id === HOST_ID || rec.dead || rec.deceased || walker.animalDef || walker._doorstepVisitor || found.has(id)) return false;
      found.add(id);
      return !!walker.root;
    }).sort((a,b)=>String(a.rec.id).localeCompare(String(b.rec.id)));
  }
  function arrangeCrowd(stage, walkers = deps?.getWalkers?.() || []) {
    holding.clear();
    const center = stageSpot(stage);
    if (!center) return 0;
    const villagers = livingVillagers(walkers);
    lastCast = villagers.map(walker => walker.rec.id);
    const crowdStart = Number(stage.row) + 4.5 + (Number(stage.postZ) || 0); // South of the stage, facing up/north at the two presenters.
    const members = window.SharedCutscene?.crowdMembers?.() || []; // Other players watch from the crowd too (js/shared-cutscene.js); none in single-player.
    const total = villagers.length + members.length;
    const columns = Math.max(10, Math.ceil(total / 4)); // Four ranks maximum; a fixed 16-column cap could place large crowds outside town's southern boundary.
    const slotFor = index => {
      const row = Math.floor(index / columns),column = index % columns;
      const inRank = Math.min(columns, total - row * columns); // A partly filled row still centers in front of the stage rather than all lining up to one side.
      return {c:Number(stage.col) + 1.5 + (column - (inRank - 1) / 2) * 0.8 + (row % 2 ? 0.25 : 0), r:crowdStart + row * 0.95};
    };
    villagers.forEach((walker,index) => {
      const {c,r} = slotFor(index);
      const target = {area:'town',c,r,rotY:180,pose:'stand',activity:'watching the Five Blossoms crowning',
        lookAt:{col:center.c+.5,row:center.r},socialLookAt:{x:center.c,z:center.r,y:1.6},socialWatching:true}; // Upward gaze shares the NPC's existing social look-at presentation.
      holding.set(walker.rec.id,target);
      try {
        if (walker.area !== 'town') walker.transferToArea?.('town',{c,r});
        walker.state = 'idle';
        if (walker.root?.position) {walker.root.position.x=c+.5;walker.root.position.z=r+.5;}
      } catch (error) { lastError = 'Could not position '+walker.rec.id+': '+String(error?.message || error); }
    });
    if (members.length) window.SharedCutscene.joinCrowd({area:'town',slots:members.map((_,k)=>({...slotFor(villagers.length+k),rotY:180,pose:'stand'}))}); // Players take the ranks after the villagers.
    window.NpcScheduling?.invalidateTargetDecisions?.(); // Invalidate walker-local schedule leases before the fade reveals the newly gathered audience.
    return holding.size;
  }
  function scheduleOverride(rec) { return holding.get(rec?.id) || null; }
  async function records() {
    const db = window.LocalDBOverrides
      ? await window.LocalDBOverrides.loadDatabase('npcDatabase')
      : await fetch(NPC_DB_URL).then(res => {if(!res.ok)throw Error('NPC database HTTP '+res.status);return res.json();});
    return new Map((db?.npcs || []).map(npc=>[npc.id,npc]));
  }
  function buildScene(npcRecords, profile, stage, civilYear) {
    const pos = stageSpot(stage);
    if (!pos) throw new Error('Five Blossoms festival stage is missing from the active town layout.');
    const name = String(profile?.nickname || 'Farmer'); // Names the active human-controlled player/farmhand, not the world owner by default.
    const front = {id:'five_blossoms_stage_front',position:{x:pos.c + .55,y:3.6,z:pos.r+7},
      target:{x:pos.c+.5,y:1.4,z:pos.r},fovDeg:54,blendSeconds:1.1,trackSpeaker:false,stagePlayer:false};
    const crowd = {id:'five_blossoms_crowd',position:{x:pos.c+.5,y:4.8,z:pos.r-3.8},
      target:{x:pos.c+.5,y:.4,z:pos.r+4},fovDeg:57,blendSeconds:1.1,trackSpeaker:false,stagePlayer:false};
    return {version:6,title:'The Finder of the Five Blossoms',mapId:'map_hobunji_town',year:Number(civilYear),
      actors:[
        {id:'player',name,isPlayer:true,worldC:pos.c,worldR:pos.r,rotation:0,pose:'standing'},
        {id:'hunundi',name:'Father Hunundi Hodu',npcId:HOST_ID,npcRecord:npcRecords?.get?.(HOST_ID),
          worldC:pos.c+1,worldR:pos.r,rotation:0,pose:'standing'}
      ],
      stages:[
        {id:'blossom_crown_fade',type:'fade',direction:'in',duration:1,next:'__next__'},
        {id:'blossom_crown_gather',type:'caption',speakerName:'',text:'The villagers gather below the festival stage, every face lifted toward Father Hunundi and the Finder.',cameraMode:'authored',camera:crowd,next:'__next__'},
        {id:'blossom_crown_welcome',type:'talk',speakerId:'hunundi',addressedActorId:'player',
          text:'People of Hobunji Hollow! Five blossoms were scattered across the wilderness, and '+name+' has returned with every one!',cameraMode:'authored',camera:front,next:'__next__'},
        {id:'blossom_crown_proclaim',type:'talk',speakerId:'hunundi',addressedActorId:'player',
          text:'As the first to complete our challenge this year, I name you the Finder of the Five Blossoms!',cameraMode:'authored',camera:front,next:'__next__'},
        {id:'blossom_crown_reveal',type:'caption',speakerName:'',text:'Father Hunundi places the Five Blossom Crown upon '+name+'\'s head. The crowd cheers!',cameraMode:'authored',camera:front,next:'__next__'},
        {id:'blossom_crown_cheer',type:'animation',actorId:'player',animKind:'emote',emoteName:'love',resultPose:'unchanged',duration:1,next:'__next__'},
        {id:'blossom_crown_end',type:'fade',direction:'out',duration:0.9,next:'__end__'}
      ]}; // Supported Director stage types and camera fields mirror RomanceWedding.
  }
  async function refreshCrownedStandIn(entities, profile) {
    const actor = entities?.get?.('player'); // The cutscene player is a synthetic NPC, separate from live gameplay gear.
    if (!actor?.walker || !window.NpcWardrobe?.refreshWalkerAppearance) throw new Error('The crowned actor cannot refresh its portrait.');
    const gear = window.EquipmentPanel?.applyGearClothingToPlayerData?.(window.__hobunjiPlayerProfile || profile);
    if (!gear?.appearance) throw new Error('The crowned outfit cannot be resolved.');
    actor.rec.appearance = gear.appearance;
    actor.rec.equippedCosmetics = gear.equippedCosmetics || [];
    actor.rec.appliedDyes = gear.appliedDyes || {};
    const refreshed = await window.NpcWardrobe.refreshWalkerAppearance(actor.walker, { strict: true });
    if (!refreshed) throw new Error('The crowned portrait could not be uploaded.');
    actor.profile = actor.walker.profile; // Keep the stand-in's visible texture and metadata in sync.
  }
  function cheer() {
    for(const walker of livingVillagers().slice(0,16)) window.AmbientDialogue?.cheer?.(walker.root);
  }
  async function play({profile=window.__hobunjiPlayerProfile,civilYear,onProclaim}={}) {
    if(running) return {ok:false,reason:'The crowning is already underway'};
    const stage = stageRoot(), runtime = window.AuthoredCutsceneRuntime;
    if(!stage || !runtime?.run || deps?.getArea?.()!=='town') return {ok:false,reason:'The festival stage or cutscene runtime is unavailable in town'};
    if(typeof onProclaim!=='function') return {ok:false,reason:'No reward callback provided'};
    running = true; lastError = '';
    window.SharedCutscene?.begin({id:OWNER,title:'Five Blossoms crowning',area:'town'}); // Pauses every player; the others join the audience in arrangeCrowd().
    const lock = window.CharacterActionLocks?.acquire?.({owner:OWNER,reason:'Five Blossoms crowning',
      participants:[{id:'player',channels:['movement','tools','actions']}]}); // Prevent moving offstage while the ceremony is staging.
    let awarded = false; // Exactly-once handoff at Father Hunundi's proclamation.
    try {
      const recordsMap = await records();
      if(!recordsMap.has(HOST_ID)) throw new Error('Father Hunundi is missing from the NPC database');
      const scene = buildScene(recordsMap,profile,stage,civilYear);
      const gather = async () => {
        arrangeCrowd(stage); // Authoritative live villagers take the audience spots, not duplicate portrait stand-ins.
        const fade = window.CutscenePreviewHelpers?.cutscenePreviewFadeEl?.();
        if (fade) {fade.style.transitionDuration='0s';fade.style.opacity='1';}
      };
      if (window.CalendarSystem?.runScreenTransition) await window.CalendarSystem.runScreenTransition(gather);
      else await gather(); // Fallback for author previews that lack the world-transition iris.
      const outcome = await runtime.run(scene,{placePlayerAtFinalPosition:true,async onDialogueContinue(step, entities) {
        if(step.id!=='blossom_crown_proclaim' || awarded)return;
        if(!onProclaim())throw new Error('Could not award Five Blossom Crown');
        awarded=true;
        await refreshCrownedStandIn(entities,profile); // Redraw both portrait planes before the reveal caption.
        cheer(); // Crowd cheer accompanies the crown reveal rather than the opening caption.
      }});
      if (outcome?.ok === false) throw new Error(outcome.reason || 'The Five Blossoms cutscene could not complete.');
      if(!awarded) awarded=!!onProclaim(); // Skip/fast-forward still grants the same crown, never twice.
      return {ok:awarded,first:true,crowd:lastCast.length};
    }catch(error){lastError=String(error?.message||error);window.__farmLog?.('[five-blossom-crowning] '+lastError,'error');return {ok:false,reason:lastError,awarded};}
    finally {holding.clear();window.NpcScheduling?.invalidateTargetDecisions?.();running=false;lock?.release?.();window.SharedCutscene?.end();} // Villagers promptly resume their previous routines on scene exit.
  }
  function init(injected) {
    deps = injected || null;holding.clear();window.NpcScheduling?.invalidateTargetDecisions?.();running=false;
    window.NpcScheduling?.registerTargetOverride?.(OWNER,scheduleOverride,100); // A live audience temporarily outranks dates, farmwork and shared meals.
  }
  function snapshot(){return {running,stageId:stageRoot()?.id||null,crowdCount:holding.size,lastCast,lastError};}
  window.FestivalBlossomCeremony = Object.freeze({init,play,buildScene,arrangeCrowd,snapshot,__test:{livingVillagers,scheduleOverride,stageSpot}});
})();

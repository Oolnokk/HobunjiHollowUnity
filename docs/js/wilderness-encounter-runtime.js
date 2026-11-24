// Shared, opt-in wilderness encounter primitives. No global tick, rendering,
 // NPC AI, or save owner: consumers keep their own schedules and authored rules.
(() => {
  'use strict';
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  function sceneMatches(record, zone, scene) {
    return !!record && !!scene && record.zone===zone && record.scene===scene;
  }
  function createBuildSlot() {
    let owner=null; // Only the current async request can release this slot.
    return Object.freeze({
      get busy(){return owner!==null;},
      begin(){if(owner)return null;return owner={};},
      owns(token){return !!token&&owner===token;},
      finish(token){if(token&&owner===token)owner=null;},
      cancel(){owner=null;},
    });
  }
  function createInterval(seconds) {
    if(!Number.isFinite(seconds)||!(seconds>0))throw new RangeError('Encounter interval must be positive');
    let elapsed=0; // Accumulated only while the consumer is eligible.
    return Object.freeze({
      advance(dt){const delta=Number(dt);if(Number.isFinite(delta)&&delta>0)elapsed+=delta;if(elapsed<seconds)return 0;const result=elapsed;elapsed=0;return result;},
      reset(){elapsed=0;},
    });
  }
  function isAnimalWalker(w) {
    return !!(w?.isAnimal===true||w?.rec?.isAnimal===true||w?.animalKind!=null||w?.rec?.kind==='animal'||
      w?.rec?.appearance?.avatarType==='animal'||w?.avatarGroup?.userData?.namedAnimalNpc||
      w?.root?.userData?.namedAnimalNpc||window.HobunjiNpcSpeciesRegistry?.isCreatureSpecies?.(w?.rec?.appearance?.speciesId));
  }
  function isHumanoidActor(c) {
    return !!(c&&!c.creatureKey&&!isAnimalWalker(c)&&(c.isBandit||c.isMinion||c.isLich||c.isNpc||c.isPorakanekiHunter||c.isTribeHunter||c.isBarbarian||c._familyBabyFollower||
      (!c.creatureKey&&c.rosterRecord?.appearance?.speciesId&&c.avatarRef?.group)));
  }
  // Lazy query: no global snapshot to go stale while a builder awaits.
  function* peopleInArea({zone,walkers=[],actors=[],tileSize=64,exclude=()=>false}) {
    for(const w of walkers||[]){
      const p=w?.root?.position;
      if(w?.area!==zone||!p||isAnimalWalker(w)||exclude(w)||!Number.isFinite(p.x)||!Number.isFinite(p.z))continue;
      yield {actor:w,x:p.x,z:p.z};
    }
    for(const collection of actors||[])for(const c of collection||[]){
      if(c?.areaId!==zone||!(c.health>0)||!isHumanoidActor(c)||exclude(c)||!Number.isFinite(c.x)||!Number.isFinite(c.y))continue;
      yield {actor:c,x:c.x/tileSize,z:c.y/tileSize};
    }
  }
  function hash(text){let h=2166136261;for(const c of String(text))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;}
  function chunkOf(c,r,size){return {c:Math.floor(c/size),r:Math.floor(r/size)};}
  function sameChunk(c,r,chunk,size){const p=chunkOf(c,r,size);return p.c===chunk.c&&p.r===chunk.r;}
  function flatFootprint(c,r,{tileAt,eligible,radius=1}) {
    const t=tileAt(c,r);if(!t)return false;
    const elev=Number(t.elevTier)||0;
    for(let dr=-radius;dr<=radius;dr++)for(let dc=-radius;dc<=radius;dc++){
      const v=tileAt(c+dc,r+dr);if(!v||!eligible(c+dc,r+dr)||(Number(v.elevTier)||0)!==elev)return false;
    }
    return true;
  }
  function siteInChunk({chunk,size,cols,rows,seed,radius=1,jitter=2,eligible}) {
    const minC=chunk.c*size+radius,minR=chunk.r*size+radius;
    const maxC=Math.min((chunk.c+1)*size-1-radius,cols-1-radius),maxR=Math.min((chunk.r+1)*size-1-radius,rows-1-radius);
    if(maxC<minC||maxR<minR)return null;
    const h=hash(seed),span=jitter*2+1;
    const cc=clamp(Math.floor((minC+maxC)/2)+(h%span)-jitter,minC,maxC);
    const rr=clamp(Math.floor((minR+maxR)/2)+((h>>>8)%span)-jitter,minR,maxR);
    for(let d=0;d<size;d++)for(let dr=-d;dr<=d;dr++)for(let dc=-d;dc<=d;dc++){
      if(Math.max(Math.abs(dc),Math.abs(dr))!==d)continue;
      const c=cc+dc,r=rr+dr;if(c>=minC&&c<=maxC&&r>=minR&&r<=maxR&&eligible(c,r))return {c,r};
    }
    return null;
  }
  const cardinal=[[1,0],[-1,0],[0,1],[0,-1]]; // Shared immutable traversal directions.
  function connectedSpawnTiles({origin,reference,contains,eligible,minDistance=2,preferredRadius=5}) {
    const near=[],far=[];
    if(!origin||!contains(origin.c,origin.r)||!eligible(origin.c,origin.r))return {near,far};
    const queue=[origin],seen=new Set([origin.c+','+origin.r]);
    for(let i=0;i<queue.length;i++){
      const point=queue[i],distance=Math.hypot(point.c-reference.c,point.r-reference.r);
      if(distance>=minDistance)(Math.hypot(point.c-origin.c,point.r-origin.r)<=preferredRadius?near:far).push(point);
      for(const [dc,dr] of cardinal){
        const c=point.c+dc,r=point.r+dr,key=c+','+r;
        if(seen.has(key)||!contains(c,r))continue;seen.add(key);
        if(eligible(c,r))queue.push({c,r});
      }
    }
    return {near,far};
  }
  function takeSpawn(pool,rng=Math.random){
    const candidates=pool?.near?.length?pool.near:pool?.far;
    if(!candidates?.length)return null;
    return candidates.splice(clamp(Math.floor(rng()*candidates.length),0,candidates.length-1),1)[0];
  }
  // A wave owns construction only while its record belongs to the current
  // scene. The caller supplies the existing NPC factory, adoption and disposal.
  async function runWave(record,{owns,prepare,canBegin=()=>true,create,validate=()=>true,adopt,dispose,onAdopted,random=Math.random,onSuppressed,onFailure,onComplete}) {
    if(!owns()||record.building)return false;
    record.building=true;
    let count=0; // Counts actors adopted into live gameplay, not just built.
    const first=record.wave===0;
    const suppressed=()=>{onSuppressed?.();return false;};
    try{
      const prepared=await prepare();
      if(!owns())return false;
      if(!prepared)return false;
      const {pool,members}=prepared;
      if(!Array.isArray(members)||!members.length)throw Error('empty encounter wave');
      if(pool.near.length+pool.far.length<members.length){if(first)return suppressed();throw Error('insufficient connected spawn tiles');}
      for(const member of members){
        if(!owns())return false;
        if(first&&!count&&!canBegin())return suppressed();
        const point=takeSpawn(pool,random);
        if(!point)throw Error('no connected spawn for '+member);
        const actor=await create(member,point,prepared);
        if(!actor)throw Error('actor construction failed for '+member);
        let adopted=false;
        try{
          if(!owns())return false;
          if(first&&!count&&!canBegin())return suppressed();
          if(!validate(actor,member,point))throw Error('invalid constructed actor: '+member);
          adopt(actor,member,point);
          adopted=true;count++;
          onAdopted?.(actor,member,point);
        }finally{if(!adopted)dispose(actor);}
      }
      if(!owns())return false;
      if(!count)throw Error('no valid wave spawn');
      record.wave++;onComplete?.(count);return true;
    }catch(error){if(owns())onFailure?.(error);return false;}
    finally{record.building=false;}
  }
  function createDefeatTracker(isOwned) {
    let attributed=false,deficit=0; // Shared downed-hit attribution, independent of the chosen consequence.
    const amount=n=>Number.isFinite(Number(n))?Math.max(0,Number(n)):0;
    return Object.freeze({
      noteDown(attacker,extra){attributed=!!isOwned(attacker);deficit=attributed?amount(extra):0;},
      noteHit(attacker,damage){if(attributed&&isOwned(attacker))deficit+=amount(damage);},
      reset(){attributed=false;deficit=0;},
      snapshot(){return {attributed,deficit};},
    });
  }
  function recoverNonlethal({player,maxHealth,deficit,blackout,healthFraction=.25,invulnerableMs=1000,now=()=>performance.now()}) {
    if(!player||typeof blackout!=='function')return false;
    const max=Number.isFinite(Number(maxHealth))&&Number(maxHealth)>0?Number(maxHealth):100; // Normalize damage excess to the same percentage contract as alcohol.
    player.health=Math.max(1,Math.round(max*healthFraction));player.vx=player.vy=0;player.invulnUntil=now()+invulnerableMs;
    blackout((Number.isFinite(Number(deficit))?Math.max(0,Number(deficit)):0)/max*100);return true;
  }
  function createRouteBudget(maxSearches=4) {
    const seen=new Set();let searches=0; // Per rare relocation attempt, not a global gameplay budget.
    return Object.freeze({
      visit(c,r){const key=c+','+r;if(seen.has(key))return false;seen.add(key);return true;},
      reachable(direct,search){if(direct())return true;if(searches>=maxSearches)return false;searches++;return !!search();},
      get searches(){return searches;},
    });
  }
  function createJournal({getStamp,validReward=()=>true,now=()=>performance.now(),retryMs=10000}) {
    const ledger=new Map(),pendingRewards=new Map(),retryAt=new Map(); // Per-consumer logical records, never actors or meshes.
    let stamp=null;
    return Object.freeze({
      ledger,pendingRewards,
      get stamp(){return stamp;},
      sync(onChange){const next=getStamp();if(next===stamp)return false;onChange?.();ledger.clear();pendingRewards.clear();retryAt.clear();stamp=next;return true;},
      blocked(key,day){const old=ledger.get(key);return pendingRewards.has(key)||!!old?.cleared||(old?.day===day&&!old.ready);},
      mark(key,day,{ready=false,cleared=false}={}){ledger.set(key,{day,cleared,ready});},
      canRetry(key){return (retryAt.get(key)||0)<=now();},
      delayRetry(key){retryAt.set(key,now()+retryMs);},
      clearRetry(key){retryAt.delete(key);},
      capture(key){return {entry:ledger.get(key),reward:pendingRewards.get(key)};},
      rollback(key,snapshot){if(snapshot.entry)ledger.set(key,snapshot.entry);else ledger.delete(key);if(snapshot.reward)pendingRewards.set(key,snapshot.reward);else pendingRewards.delete(key);},
      serialize(){return {stamp:stamp??getStamp(),ledger:[...ledger],pendingRewards:[...pendingRewards]};},
      restore(raw){
        stamp=typeof raw?.stamp==='string'?raw.stamp:getStamp();
        ledger.clear();pendingRewards.clear();retryAt.clear();
        for(const entry of Array.isArray(raw?.ledger)?raw.ledger:[])if(Array.isArray(entry)&&typeof entry[0]==='string'&&Number.isFinite(entry[1]?.day))ledger.set(entry[0],entry[1]);
        for(const entry of Array.isArray(raw?.pendingRewards)?raw.pendingRewards:[]){
          if(!Array.isArray(entry)||typeof entry[0]!=='string'||ledger.get(entry[0])?.cleared||!validReward(entry[1],entry[0]))continue;
          pendingRewards.set(entry[0],entry[1]);
        }
      },
    });
  }
  // Reward helpers can persist internally: consume the conditional buff first,
  // then restore the exact prior amount on rejection/exception.
  function withConditionalReward({consume,restore,grant,accept=Boolean}) {
    const previous=consume();let accepted=false;
    try{const reward=grant();accepted=accept(reward);return accepted?reward:null;}
    finally{if(!accepted&&previous>0)restore(previous);}
  }
  function createSpriteSource(url) {
    let pending=null; // Only one alpha scan per source; failed loads remain retryable.
    return () => {
      if(pending)return pending;
      pending=new Promise((resolve,reject)=>{
        const image=new Image();
        image.onload=()=>{
          try{
            const raw=document.createElement('canvas');raw.width=image.naturalWidth||image.width;raw.height=image.naturalHeight||image.height;
            const ctx=raw.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
            const pixels=ctx.getImageData(0,0,raw.width,raw.height).data;
            let l=raw.width,t=raw.height,r=-1,b=-1;
            for(let y=0;y<raw.height;y++)for(let x=0;x<raw.width;x++)if(pixels[(y*raw.width+x)*4+3]>0){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}
            if(r<l||b<t)throw Error('Transparent sprite: '+url);
            const crop=document.createElement('canvas');crop.width=r-l+1;crop.height=b-t+1;
            crop.getContext('2d').drawImage(raw,l,t,crop.width,crop.height,0,0,crop.width,crop.height);
            resolve({raw,crop});
          }catch(error){reject(error);}
        };image.onerror=()=>reject(Error('Sprite could not load: '+url));image.src=url;
      }).catch(error=>{pending=null;throw error;});
      return pending;
    };
  }
  function paintPortrait(canvas,crop,{mirror=false}={}) {
    const ctx=canvas.getContext('2d'),scale=Math.min(canvas.width/crop.width,canvas.height/crop.height);
    const w=crop.width*scale,h=crop.height*scale;
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.save();ctx.imageSmoothingEnabled=false;
    if(mirror){ctx.translate(canvas.width,0);ctx.scale(-1,1);}
    try{ctx.drawImage(crop,(canvas.width-w)/2,canvas.height-h,w,h);}finally{ctx.restore();}
    return h/canvas.height;
  }
  window.WildernessEncounterRuntime=Object.freeze({sceneMatches,createBuildSlot,createInterval,isAnimalWalker,isHumanoidActor,peopleInArea,chunkOf,sameChunk,flatFootprint,siteInChunk,connectedSpawnTiles,takeSpawn,runWave,createDefeatTracker,recoverNonlethal,createRouteBudget,createJournal,withConditionalReward,createSpriteSource,paintPortrait});
})();

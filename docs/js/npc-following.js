// Shared follow/wait destinations for friendly company and romance dates.
(() => {
  'use strict';
  let deps=null; // Existing romance/world adapters also supply ordinary companion movement.
  const companions=new Map(); // Session-only invitations; dismissal returns the NPC to its normal schedule.
  function target(rec, session, distance=1.7) {
    if(!deps || !session || !rec?.id)return null;
    if(session.mode==='wait'&&session.waitSpot)return {...session.waitSpot,activity:'waiting for you'};
    const walker=deps.findWalker?.(rec.id), player=deps.getPlayerTilePosition?.(), area=deps.normalizeNpcArea?.(deps.getCurrentArea?.())||deps.getCurrentArea?.();
    if(!player||!area||!deps.canHostNpc?.(area))return walker?{area:walker.area,c:walker.root.position.x-.5,r:walker.root.position.z-.5,activity:'waiting for you'}:null;
    const seat=window.FurnitureTableSystem?.companionSeat?.(area,rec.id);
    if(seat)return {...seat,activity:'sitting together'};
    const pc=Math.floor(player.x),pr=Math.floor(player.z);
    if(!walker||walker.area!==area)return {area,c:pc,r:pr,activity:'following you'};
    const pos=walker.root.position,dx=pos.x-player.x,dz=pos.z-player.z,dist=Math.hypot(dx,dz);
    if(dist<=distance+.45 && window.NpcPathfinding?.isNpcTileWalkable?.(area,Math.floor(pos.x),Math.floor(pos.z))!==false)return {area,c:pos.x-.5,r:pos.z-.5,activity:'following you'};
    const tx=player.x+(dist>1e-6?dx/dist:1)*distance,tz=player.z+(dist>1e-6?dz/dist:0)*distance;
    for(let radius=0;radius<=3;radius++)for(let z=-radius;z<=radius;z++)for(let x=-radius;x<=radius;x++){
      if(Math.max(Math.abs(x),Math.abs(z))!==radius)continue;
      const c=Math.floor(tx)+x,r=Math.floor(tz)+z;
      if(window.NpcPathfinding?.isNpcTileWalkable?.(area,c,r)!==false)return {area,c,r,activity:'following you'};
    }
    return {area:walker.area,c:pos.x-.5,r:pos.z-.5,activity:'waiting for you'};
  }
  function setMode(walker,mode) {
    const id=walker?.rec?.id; // Date invitations keep their existing acceptance, timing, wait and dismissal rules.
    if(window.RomanceSystem?.isOnDateWith?.(id))return mode==='dismiss'?window.RomanceSystem.dismissDate():window.RomanceSystem.setDateMode(mode);
    if(!id||walker.rec.dead||walker.rec.deceased)return false;
    if(!['follow','wait','dismiss'].includes(mode))return false;
    const accepted=mode!=='follow' || (window.NpcRapport?.get?.(id) ?? 0)>=0; // Existing negative Rapport is an unfriendly response, without adding a new relationship scale.
    const text=!accepted?'No, I would rather stay here.':mode==='follow'?"Of course. Lead the way!":mode==='wait'?"I'll wait here for you.":'All right. See you later.'; // Explicit commands replace incidental greetings through the shared chathead owner.
    const response=window.AmbientDialogue?.showSocialResponse || window.AmbientDialogue?.showAlcoholOfferResponse; // Compatibility with older tools that inject the drink-response adapter.
    response?.(walker,{text,accepted,reason:'company'});
    if(!accepted)return false;
    if(mode==='dismiss'){companions.delete(id);window.FurnitureTableSystem?.setSeatTarget?.(id,null);return true;}
    const p=walker.root.position;
    companions.set(id,{mode,waitSpot:mode==='wait'?{area:walker.area,c:p.x-.5,r:p.z-.5}:null});
    window.FurnitureTableSystem?.setSeatTarget?.(id,null);
    return true;
  }
  function commandOptionsFor(walker) {
    if(!walker?.rec?.id||walker.rec.dead||walker.rec.deceased||walker._doorstepVisitor||walker._slagothimTrader||walker.isPorakanekiHunter||window.RomanceSystem?.isOnDateWith?.(walker.rec.id))return [];
    const session=companions.get(walker.rec.id);
    if(!session)return [{id:'follow',icon:'👣',label:'Follow me',run:()=>setMode(walker,'follow')}];
    return [{id:session.mode==='wait'?'follow':'wait',icon:'👣',label:session.mode==='wait'?'Follow me':'Wait here',run:()=>setMode(walker,session.mode==='wait'?'follow':'wait')},
      {id:'dismiss',icon:'👋',label:'Go on without me',run:()=>setMode(walker,'dismiss')}];
  }
  function clear() {
    for (const id of companions.keys()) window.FurnitureTableSystem?.setSeatTarget?.(id,null);
    companions.clear();
  }
  function init(value) {
    deps=value;
    window.NpcScheduling?.registerTargetOverride?.('companions',rec=>{
      const session=companions.get(rec.id);
      if(!session||rec.dead||rec.deceased||window.RomanceSystem?.isOnDateWith?.(rec.id))return null;
      return target(rec,session);
    });
  }
  window.NpcFollowing={init,clear,target,setMode,commandOptionsFor,snapshot:()=>({latestChange:'Shared follow/wait and exclusive seats at the player’s table for companions and dates.',companions:[...companions].map(([id,s])=>({id,mode:s.mode}))})};
})();

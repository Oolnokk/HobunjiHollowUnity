(() => {
  'use strict';

  const owners = new Map(); // ownerId -> normalized claim records currently advertised by that world-interaction system.
  const pressed = new Map(); // actionId -> claim snapshot that consumed its press; keeps release paired even if proximity/UI changes before button-up.
  let revision = 0;

  function normalize(ownerId, raw, index) {
    const actionId=String(raw?.actionId||'').trim();
    if(!actionId)return null;
    return {
      ownerId,
      actionId,
      label:String(raw?.label||actionId),
      priority:Number(raw?.priority)||0,
      order:index,
      onPress:typeof raw?.onPress==='function'?raw.onPress:null,
      onRelease:typeof raw?.onRelease==='function'?raw.onRelease:null,
    };
  }

  function setClaims(ownerId, claims = []) {
    ownerId=String(ownerId||'').trim();
    if(!ownerId)return false;
    const normalized=(Array.isArray(claims)?claims:[]).map((claim,index)=>normalize(ownerId,claim,index)).filter(Boolean);
    if(normalized.length)owners.set(ownerId,normalized);
    else owners.delete(ownerId);
    revision++;
    return true;
  }

  function clearClaims(ownerId) {
    ownerId=String(ownerId||'').trim();
    if(!ownerId)return false;
    const changed=owners.delete(ownerId);
    if(changed)revision++;
    return changed;
  }

  function claimFor(actionId) {
    actionId=String(actionId||'');
    let best=null;
    for(const claims of owners.values()){
      for(const claim of claims){
        if(claim.actionId!==actionId)continue;
        if(!best||claim.priority>best.priority||(claim.priority===best.priority&&claim.order<best.order))best=claim;
      }
    }
    return best;
  }

  function isClaimed(actionId) {
    return !!claimFor(actionId);
  }

  function dispatch(actionId, phase = 'press', detail = null) {
    actionId=String(actionId||'');
    if(!actionId)return false;
    if(phase==='release'){
      const active=pressed.get(actionId);
      if(!active)return false; // Do not swallow a weapon release if that weapon owned the original press before a nearby interaction appeared.
      pressed.delete(actionId);
      try{active.onRelease?.(detail);}catch(error){console.warn('[WorldActionInputClaims] release failed',active.ownerId,actionId,error);}
      return true;
    }
    if(phase==='cancel'){
      const active=pressed.get(actionId);
      if(!active)return false;
      pressed.delete(actionId);
      try{active.onRelease?.({...detail,canceled:true});}catch(error){console.warn('[WorldActionInputClaims] cancel failed',active.ownerId,actionId,error);}
      return true;
    }
    const claim=claimFor(actionId);
    if(!claim)return false;
    if(pressed.has(actionId))return true; // Key-repeat/controller-repeat stays consumed without firing the interaction twice.
    pressed.set(actionId,claim);
    try{claim.onPress?.(detail);}catch(error){console.warn('[WorldActionInputClaims] press failed',claim.ownerId,actionId,error);}
    return true;
  }

  function snapshot() {
    const claims=[];
    for(const [ownerId,list] of owners)for(const claim of list)claims.push({ownerId,actionId:claim.actionId,label:claim.label,priority:claim.priority});
    return {
      revision,
      claims,
      pressed:[...pressed.entries()].map(([actionId,claim])=>({actionId,ownerId:claim.ownerId,label:claim.label})),
    };
  }

  window.WorldActionInputClaims=Object.freeze({
    setClaims,
    clearClaims,
    isClaimed,
    claimFor,
    dispatch,
    snapshot,
  });
})();

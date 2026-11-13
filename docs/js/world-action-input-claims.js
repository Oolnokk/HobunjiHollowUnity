(() => {
  'use strict';

  const owners = new Map(); // ownerId -> normalized claim records currently advertised by that world-interaction system.
  const pressed = new Map(); // actionId -> claim snapshot that consumed its press; keeps release paired even if proximity/UI changes before button-up.
  let revision = 0;
  let combatResolver = () => false; // Injected player combat state; used to prevent beginning or resuming world hold interactions in combat.
  let contextResolver = () => false; // Injected visible action-arch override check; used to arbitrate combat even before a button is pressed.
  const interruptedHolds = new Set(); // World hold action kinds invalidated by combat until their original physical input is released.
  const contextPresses = new Map(); // Physical press ID -> captured Action 1/2 context; keeps attack suppression through prompt changes until button-up.
  let lastRoute = null; // Mobile-readable diagnostics for the latest resolved input and its owner.

  function configure(options = {}) {
    if (typeof options.isInCombat === 'function') combatResolver = options.isInCombat;
    if (typeof options.isContextOverride === 'function') contextResolver = options.isContextOverride;
  }

  function safeContextOverride(actionId) {
    try { return !!contextResolver(actionId); }
    catch (error) { console.warn('[GameplayInputRouter] context resolver failed', error); return false; }
  }

  function beginContextPress(pressId, actionId, label = actionId) {
    pressId = String(pressId || '').trim();
    actionId = String(actionId || '').trim();
    if (!pressId || (actionId !== 'action1' && actionId !== 'action2')) return false;
    if (contextPresses.has(pressId)) return true; // Repeats never replace the owner of an already-held button.
    contextPresses.set(pressId, { actionId, label: String(label || actionId) });
    revision++;
    return true;
  }

  function endContextPress(pressId) {
    const changed = contextPresses.delete(String(pressId || ''));
    if (changed) revision++;
    return changed;
  }

  function isAttackBlocked() {
    // The first two contextual action slots suppress *all* attacks, including when
    // their original press outlives the visible prompt. Action 3/other claims do not.
    if (contextPresses.size || pressed.has('action1') || pressed.has('action2')) return true;
    return isClaimed('action1') || isClaimed('action2')
      || safeContextOverride('action1') || safeContextOverride('action2');
  }

  function isInCombat() {
    try { return !!combatResolver(); }
    catch (error) { console.warn('[GameplayInputRouter] combat resolver failed', error); return false; }
  }

  function canContinueHold(kind, held) {
    kind = String(kind || '').trim();
    if (!kind) return false;
    if (!held) { interruptedHolds.delete(kind); return false; }
    if (isInCombat()) interruptedHolds.add(kind);
    return !interruptedHolds.has(kind); // Combat ending mid-press must not let a previously interrupted loot hold resume.
  }

  function resolve(actionId) {
    actionId = String(actionId || '');
    const active = pressed.get(actionId);
    if (active) return { actionId, ownerId: active.ownerId, kind: 'owned', label: active.label };
    const claim = claimFor(actionId);
    if (claim) return { actionId, ownerId: claim.ownerId, kind: 'claim', label: claim.label };
    for (const [pressId, press] of contextPresses) {
      if (press.actionId === actionId) return { actionId, ownerId: pressId, kind: 'context-press', label: press.label };
    }
    if (safeContextOverride(actionId)) return { actionId, ownerId: 'visible-context', kind: 'context', label: actionId };
    return { actionId, ownerId: 'gameplay', kind: 'default', label: actionId };
  }

  function route(actionId, phase = 'press', detail = null, fallback = null) {
    const resolution = resolve(actionId);
    const claimed = dispatch(actionId, phase, detail);
    lastRoute = { ...resolution, phase, claimed, source: detail?.source || 'gameplay' };
    if (claimed) return true;
    return typeof fallback === 'function' ? fallback() === true : false;
  }

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
    if(pressed.has(actionId))return true; // Press ownership survives prompt disappearance and keyboard/controller repeat.
    const claim=claimFor(actionId);
    if(!claim)return false;
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
      interruptedHolds:[...interruptedHolds],
      contextPresses:[...contextPresses.entries()].map(([pressId,press]) => ({ pressId, ...press })),
      attackBlocked:isAttackBlocked(),
      lastRoute,
    };
  }

  const router=Object.freeze({
    configure,
    route,
    resolve,
    beginContextPress,
    endContextPress,
    isAttackBlocked,
    isInCombat,
    canContinueHold,
    setClaims,
    clearClaims,
    isClaimed,
    hasClaim:isClaimed, // Backward-compatible semantic used by early selector arbitration in game.js; keeps potion/ammo/item selectors from pre-empting a visible world interaction.
    claimFor,
    dispatch,
    snapshot,
  });
  window.GameplayInputRouter=router; // Canonical shared gameplay input arbitration (device-neutral).
  window.WorldActionInputClaims=router; // Existing world-interaction providers keep their established claim API.
  window.addEventListener?.('blur', () => {
    for (const id of [...pressed.keys()]) dispatch(id, 'cancel', { source: 'window-blur' });
    interruptedHolds.clear();
    contextPresses.clear();
  });
  if (typeof document !== 'undefined') document.addEventListener?.('visibilitychange', () => {
    if (!document.hidden) return;
    for (const id of [...pressed.keys()]) dispatch(id, 'cancel', { source: 'hidden' });
    interruptedHolds.clear();
    contextPresses.clear();
  });
})();

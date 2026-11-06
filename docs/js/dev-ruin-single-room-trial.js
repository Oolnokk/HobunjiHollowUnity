// Isolated ruin puzzle selection. Random mode samples actual challenge-room
// allocations made by the live multi-floor RuinLayerPlan, excluding lab-disabled puzzle families.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.DevRuinSingleRoomTrial=api;
})(typeof self!=='undefined'?self:globalThis,function(root){
  'use strict';
  const TYPES=Object.freeze([
    ['glyphObelisk','Projectile glyph targets'],
    ['ceilingRailTargets','Moving ceiling targets'],
    ['melodyEcho','Melody echo'],
    ['dungeonFire','Dungeon fire / ice'],
    ['ropeChain','Bottomless rope chain'],
    ['statueDefense','Key Statue defense'],
    ['nativeBrazier','V50 torch-to-brazier route'],
    ['nativeGlyphObelisk','V50 hidden glyph obelisks'],
    ['nativeStackedObelisk','V50 stacked obelisk'],
    ['nativeLinkedCubePillars','V50 linked cube pillars'],
    ['nativePushBlock','V50 stone push-block course'],
  ]); // Used by both the mobile selector and the generation validator.
  const MECHANISMS=Object.freeze([
    ['stoneDoor','Rising stone door'],
    ['ceilingGlyph','Ceiling projectile glyph'],
    ['melodyPlate','Melody demonstration plate'],
    ['safePathGrid','Safe-path tile grid'],
    ['stoneCanopy','Stone projectile canopy'],
    ['cyclingLift','Cycling stone lift'],
    ['sarcophagus','Skeleton sarcophagi'],
    ['ropeSwing','Single rope swing'],
    ['ropePump','Pump-to-height rope'],
    ['ropeTransfer','Rope-to-rope transfer'],
    ['ignitionBrazier','Projectile ignition brazier'],
    ['burnableNet','Burnable ceiling net'],
    ['burdenIcicle','Burden-bearing icicle'],
    ['pillarBridge','Rising pillar bridge'],
    ['witchBombTube','Witch-bomb ceiling dispenser'],
  ]); // Individually selectable fixtures, excluded from weighted puzzle draws.
  const AUTHORED_MECHANISMS=Object.freeze({pillarBridge:'ruinPillarBridge',witchBombTube:'witchBombCeilingTube'}); // Authored pieces loaded before the fixture mounts.
  const NATIVE_VARIANTS=Object.freeze({nativeBrazier:'brazier',nativeGlyphObelisk:'glyphObelisk',
    nativeStackedObelisk:'stackedObelisk',nativeLinkedCubePillars:'linkedCubePillars',
    nativePushBlock:'pressurePlate'}); // Maps test-only choices to actual V50 activator families.
  const VALID=new Set(TYPES.map(([key])=>key)); // Used to exclude retired or unsupported puzzles from forced and weighted lab selection.
  const MECHANISM_IDS=new Set(MECHANISMS.map(([key])=>key)); // Identifies direct fixture choices before the weighted planner runs.
  function pick(seed,requested='weighted',planner=root.RuinLayerPlan){
    const selection=String(requested||'weighted');
    if(MECHANISM_IDS.has(selection))return {kind:selection,mode:'mechanism',population:1};
    if(selection!=='weighted'){
      if(!VALID.has(selection))throw new Error('Unknown single-room puzzle type: '+selection);
      return {kind:selection,mode:'forced',population:1};
    }
    if(typeof planner?.compose!=='function')throw new Error('RuinLayerPlan is unavailable for weighted puzzle selection.');
    const plan=planner.compose({seed:Number(seed)>>>0,nativeV50:false}); // Real generation stage rules, including the late-stage rare defense roll.
    if(!plan?.ok)throw new Error('Could not sample the normal ruin puzzle generation plan.');
    const rooms=(plan.floors||[]).flatMap(floor=>(floor.rooms||[])
      .filter(room=>room.kind==='challenge-room'&&VALID.has(room.challenge)));
    if(!rooms.length)throw new Error('The ruin planner produced no eligible puzzle rooms.');
    // An independent seeded draw picks a random challenge-room slot, preserving
    // its generated per-stage probabilities without favoring a list order.
    const value=((Math.imul((Number(seed)>>>0)^0x4a9df217,1664525)+1013904223)>>>0)/4294967296;
    const kind=rooms[Math.floor(value*rooms.length)].challenge;
    return {kind,mode:'weighted',population:rooms.length};
  }
  return Object.freeze({TYPES,MECHANISMS,AUTHORED_MECHANISMS,NATIVE_VARIANTS,pick});
});

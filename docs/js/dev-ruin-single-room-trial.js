// Isolated ruin puzzle selection. Random mode samples actual challenge-room
// allocations made by the live multi-floor RuinLayerPlan, excluding lab-disabled puzzle families.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.DevRuinSingleRoomTrial=api;
})(typeof self!=='undefined'?self:globalThis,function(root){
  'use strict';
  const TYPES=Object.freeze([
    ['glyphObelisk','Projectile glyph targets','Hit every glyph with a ranged shot.'],
    ['ceilingRailTargets','Moving ceiling targets','Look up and lead your shots as the targets move.'],
    ['melodyEcho','Melody echo','Read the carved notes and play the phrase back on your instrument.'],
    ['dungeonFire','Dungeon fire / ice','Equip a ranged weapon, use the lit brazier, then shoot the ice.'],
    ['ropeChain','Bottomless rope chain','Grab the first rope, build momentum, then jump toward the next rope.'],
    ['statueDefense','Key Statue defense','Place the Key Statue on the plinth and protect it until the plinth finishes sinking.'],
    ['nativeBrazier','V50 torch-to-brazier route','Light a torch at the fuel station and carry it to the unlit brazier before it burns out.'],
    ['nativeGlyphObelisk','V50 hidden glyph obelisks','Look for recessed glyphs in the stonework and hit them with ranged shots.'],
    ['nativeStackedObelisk','V50 stacked obelisk','Turn the marked pieces to line up the glyphs.'],
    ['nativeLinkedCubePillars','V50 linked cube pillars','Turn the marked cubes and watch which other cubes move with them.'],
    ['nativePushBlock','V50 stone push-block course','Hold movement into a flat face to slide the block. Follow the grooves to the plate.'],
    ['findBlocks','Find the Blocks','Recover four stone blocks from fire, ice, a climbing path and a tall pillar; slide each onto one of four plates.'],
  ]); // Used by both the mobile selector and the generation validator.
  const MECHANISMS=Object.freeze([
    ['stoneDoor','Rising stone door','Interact beside the slab to raise or lower it.'],
    ['ceilingGlyph','Ceiling projectile glyph','Aim a ranged shot at the glyph overhead.'],
    ['melodyPlate','Melody demonstration plate','Step on the bronze plate to hear the phrase, then play it back.'],
    ['safePathGrid','Safe-path tile grid','Use the reveal pedestal and cross on the green tiles.'],
    ['stoneCanopy','Stone projectile canopy','Shoot along a line that crosses the canopy to test its cover.'],
    ['cyclingLift','Cycling stone lift','Board at the bottom of the cycle and ride it up.'],
    ['sarcophagus','Skeleton sarcophagi','Approach the coffins to wake their occupants.'],
    ['ropeSwing','Single rope swing','Grab the rope from the launch platform and jump toward the far platform.'],
    ['ropePump','Pump-to-height rope','Move with the swing on each pass to build height before jumping.'],
    ['ropeTransfer','Rope-to-rope transfer','Jump from the launch rope and catch the hanging rope in midair.'],
    ['ignitionBrazier','Projectile ignition brazier','Equip a ranged weapon and use the brazier to ignite your next shot.'],
    ['burnableNet','Burnable ceiling net','Ignite a shot at the brazier, then hit the net to drop its burden.'],
    ['burdenIcicle','Burden-bearing icicle','Ignite a shot at the brazier, then hit the ice around the burden.'],
    ['pillarBridge','Rising pillar bridge','Interact beside the bridge to toggle its authored motion.'],
    ['witchBombTube','Witch-bomb ceiling dispenser','Shoot the separate glowing projectile target beside the tube, then step clear of the falling bomb.'],
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

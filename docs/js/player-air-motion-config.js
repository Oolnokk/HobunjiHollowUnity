// Shared unbuffed player air-motion parameters and optional future buff multipliers.
// Geometry generators must read BASE only; gameplay reads effective values.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PlayerAirMotionConfig=api;
})(typeof self!=='undefined'?self:globalThis,function(){
  'use strict';
  const BASE=Object.freeze({
    jumpLaunchSpeed:6.25/Math.SQRT2,
    jumpGravity:11.8,
    moveSpeedPixelsPerSecond:238, // Actual unbuffed game.js MOVE_SPEED; gameplay's getBaseMoveSpeedTiles reads this speed in world tiles.
    tilePixels:55, // game.js tile size; keep the conversion unmodified by potions, terrain or species.
    get airTilesPerSecond(){return this.moveSpeedPixelsPerSecond/this.tilePixels;}, // Single base source: editing either global movement constant also resizes generated rope rooms.
    groundTilesPerSecond:2.6, // Existing slower supported-surface walk fallback, not rope-flight steering.
    ropeSteerFactor:0.6,
  }); // Authoritative base player jump and rope-flight steering values.
  const multipliers={jumpHeight:1,slowFall:1}; // Future food/potions may change these; procedural rooms must never read them.
  const bounded=(value,fallback)=>Number.isFinite(Number(value))?Math.max(.05,Number(value)):fallback;
  const jumpLaunchSpeed=()=>BASE.jumpLaunchSpeed*Math.sqrt(bounded(multipliers.jumpHeight,1));
  const gravityMultiplier=()=>bounded(multipliers.slowFall,1);
  return Object.freeze({BASE,multipliers,jumpLaunchSpeed,gravityMultiplier});
});

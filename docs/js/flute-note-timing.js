// Shared musical release grid: flute attack stays immediate; its end falls on a subdivision.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.FluteNoteTiming=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  function durationSeconds(bpm,quarterPosition,minimumQuarterBeats=.5,subdivisionQuarterBeats=.5){
    const rate=Number.isFinite(Number(bpm))&&Number(bpm)>0?Number(bpm):76; // Tempo of the active score, accompaniment, or free play.
    const phase=Number.isFinite(Number(quarterPosition))?Math.max(0,Number(quarterPosition)):0; // Quarter-note position of the *unsnapped* attack.
    const minimum=Number.isFinite(Number(minimumQuarterBeats))?Math.max(.125,Number(minimumQuarterBeats)):.5; // Shortest audible note is an eighth by default.
    const step=Number.isFinite(Number(subdivisionQuarterBeats))?Math.max(.125,Number(subdivisionQuarterBeats)):.5; // The eighth-note end grid.
    const releaseBeat=Math.ceil((phase+minimum-1e-9)/step)*step;
    return Math.max(.02,(releaseBeat-phase)*60/rate);
  }
  return Object.freeze({durationSeconds});
});

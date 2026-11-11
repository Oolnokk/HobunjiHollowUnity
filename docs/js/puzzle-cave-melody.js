// Puzzle Cave melody composer and real-time judge.
// Uses the same eight note indices as KurrayaPuzzle and the ruin melody glyphs.
// No demonstration audio: a player must read the glowing glyphs and play on the plate.
(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.PuzzleCaveMelody=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const TICKS_PER_MEASURE=16; // Sixteenth-note time base shared by composition, timing and the UI.
  const NOTE_COUNT=8; // The existing Kurraya puzzle instrument has eight playable note controls.
  const MIN_BPM=60,MAX_BPM=88; // Slightly slower than the original 66–100 BPM range to leave room for live button input.
  const DURATIONS=[2,4,8,16]; // Eighth note is the shortest value; quarter, half and whole notes remain possible.
  const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
  function hash(value){
    let seed=2166136261;
    for(const char of String(value)){seed=Math.imul(seed^char.charCodeAt(0),16777619)>>>0;}
    return seed>>>0;
  }
  function seeded(value){
    let n=hash(value);
    return ()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};
  }
  const RHYTHM_MOTIFS=Object.freeze({
    easy:Object.freeze([[4,4,4,4],[4,4,8]]),
    medium:Object.freeze([[4,2,2,4,4],[4,4,2,2,4],[2,2,4,4,4],[8,2,2,4]]),
    hard:Object.freeze([[4,2,2,2,2,4],[2,2,4,2,2,4],[2,2,2,2,4,4]]),
  }); // Each authored-feeling 4/4 bar has a clear downbeat, beat-three anchor and no shorter-than-eighth attacks.
  const MELODIC_CONTOURS=Object.freeze([
    [2,3,4,3,2,1,2],
    [1,2,3,4,3,2,2],
    [3,4,3,2,3,1,2],
    [2,4,3,2,3,1,2],
  ]); // Reused with the rhythm motif so repeating bars sound like a phrase rather than fresh random notes.
  function cadenceRhythm(motif){
    const ending=motif.slice(); // Only the last half of the final bar changes; the listener can anticipate the opening rhythm.
    const last=ending.length-1;
    if(last>=1&&ending[last-1]===4&&ending[last]===4)ending.splice(last-1,2,8);
    else if(last>=2&&ending[last-2]===2&&ending[last-1]===2&&ending[last]===4)ending.splice(last-2,3,8);
    return ending; // A held half-note resolves the phrase instead of another random short attack.
  }
  function generate(id,options={}){
    const rng=seeded(String(id)+':puzzle-cave-song-rhythm-v2');
    const difficulty=clamp(Math.floor(Number(options.difficulty)||1),1,5);
    const measures=[1,2,4].includes(options.measures)?options.measures:(difficulty>=5?4:difficulty>=3?2:1); // Only full 1-, 2- or 4-bar phrases.
    const bpm=clamp(Math.round(Number(options.bpm)||Math.round(MIN_BPM+rng()*(MAX_BPM-MIN_BPM))),MIN_BPM,MAX_BPM);
    const motifs=difficulty<=2?RHYTHM_MOTIFS.easy:difficulty===3?RHYTHM_MOTIFS.medium:RHYTHM_MOTIFS.hard; // Increased difficulty adds eighth-note pairs, not arbitrary changes to meter.
    const motif=motifs[Math.floor(rng()*motifs.length)];
    const contour=MELODIC_CONTOURS[Math.floor(rng()*MELODIC_CONTOURS.length)];
    const totalTicks=measures*TICKS_PER_MEASURE;
    const notes=[];
    for(let bar=0;bar<measures;bar++){
      const finalBar=bar===measures-1;
      const durations=finalBar?cadenceRhythm(motif):motif; // A-A (or A-A-A) repetition with a final cadential response.
      let barTick=0; // Shared phrase-local tick; startTick must be absolute for the existing judge and glyphs.
      for(let i=0;i<durations.length;i++){
        const length=durations[i];
        const contourStep=Math.round(i*(contour.length-1)/(durations.length-1));
        let index=contour[contourStep];
        if(finalBar&&i===durations.length-1)index=0; // Every song resolves to the tonic.
        else if(finalBar&&i===durations.length-2)index=1; // A nearby approach tone makes the cadence singable.
        notes.push({index,startTick:bar*TICKS_PER_MEASURE+barTick,lengthTicks:length});
        barTick+=length;
      }
    }
    const shortest=Math.min(...notes.map(note=>note.lengthTicks));
    const complexity=notes.length+Math.max(0,4-shortest)*1.1+measures*2;
    const rewardTier=clamp(Math.ceil(complexity/5),1,5);
    return Object.freeze({
      id:String(id),difficulty,measures,bpm,notes:notes.map(note=>Object.freeze(note)),
      totalTicks,silenceTicks:TICKS_PER_MEASURE,
      cycleTicks:totalTicks+TICKS_PER_MEASURE,
      secondsPerTick:60/bpm/4,
      rewardTier,
      // Stable cave IDs repeat the same motif and cadence on reload; the judge and instrument timings are unchanged.
    });
  }
  const GLYPH_COLORS=Object.freeze({idle:0xeaf5ff,current:0xffec64,accepted:0x80ffbb,rejected:0xff6666}); // Consistent white/yellow/green/red response for both indoor and outdoor carved notes.
  const GLOW_EASE_RATE=17; // Seconds-based fade speed: a frame-rate-independent ~180 ms transition, with no carved-glyph scaling.
  function blendHex(from,to,amount){
    const t=clamp(Number(amount)||0,0,1);
    const channel=shift=>Math.round(((from>>shift)&255)*(1-t)+((to>>shift)&255)*t);
    return (channel(16)<<16)|(channel(8)<<8)|channel(0);
  }
  function advanceGlyphGlow(glyph,{current=false,accepted=false,rejected=false,dt=0,halo=null,outer=null}={}){
    if(!glyph?.material)return null;
    const state=glyph.userData||(glyph.userData={}); // Per-glyph smooth color/brightness state; the inscription never changes geometry or scale.
    const target=rejected?GLYPH_COLORS.rejected:accepted?GLYPH_COLORS.accepted:current?GLYPH_COLORS.current:GLYPH_COLORS.idle;
    const tone=rejected?'rejected':accepted?'accepted':current?'current':'idle';
    const targetInner=rejected?.86:accepted?.52:current?.80:.11;
    const targetOuter=rejected?.43:accepted?.22:current?.56:.045; // A faded-in wide halo makes the *light radius* grow, not the carved number.
    const transition=state.melodyGlowTransition||(state.melodyGlowTransition={
      color:GLYPH_COLORS.idle,inner:.11,outer:.045,tone:'idle',
    });
    const fade=(rejected||accepted&&transition.tone!=='accepted')?1:1-Math.exp(-Math.max(0,Number(dt)||0)*GLOW_EASE_RATE); // Correct/wrong feedback remains immediate; only musical focus and halo breathing ease.
    transition.color=blendHex(transition.color,target,fade);
    transition.inner+=(targetInner-transition.inner)*fade;
    transition.outer+=(targetOuter-transition.outer)*fade;
    transition.tone=tone;
    glyph.material.color?.setHex?.(transition.color);
    const innerMat=halo||state.melodyGlowMaterial;
    const outerMat=outer||state.melodyOuterGlowMaterial;
    if(innerMat){innerMat.color?.setHex?.(transition.color);innerMat.opacity=transition.inner;}
    if(outerMat){outerMat.color?.setHex?.(transition.color);outerMat.opacity=transition.outer;}
    return {...transition}; // Also available to the existing in-game debug/inspection path.
  }
  function createSession(song,{onSolved=()=>{},onChanged=()=>{},onBeat=()=>{},onStop=()=>{},clockMs=null,lookaheadMs=0}={}){
    if(!song||!Array.isArray(song.notes)||!song.notes.length)throw new Error('Puzzle Cave song is missing its note sequence.');
    let standing=false,solved=false,elapsed=0,progress=0,mistakes=0,cycle=0,lastSignature='';
    let startedAtMs=null,nextScheduledBeat=1; // The plate's monotonic start and next unqueued beat keep both score judgment and audio on one clock.
    let expiredProgress=null; // Keeps the last expired attempt available to timestamped inputs delivered after a stalled render frame.
    let currentClockMs=clockMs; // The optional author/test clock can be swapped without changing the live game's absolute-time source.
    const quarterSeconds=song.secondsPerTick*4; // Four sixteenth ticks per numbered stonebeat recording; independent of MP3 duration.
    const lookaheadSeconds=clamp((Number(lookaheadMs)||0)/1000,0,.15); // Performance-mode-style audio lead; tests without a clock retain exact delta-time behavior.
    const tickAt=()=>elapsed/song.secondsPerTick;
    function activeIndex(){
      if(!standing||solved)return -1;
      const t=tickAt()%song.cycleTicks;
      return song.notes.findIndex(note=>t>=note.startTick&&t<note.startTick+note.lengthTicks);
    }
    function snapshot(){
      return {standing,solved,elapsed,progress,mistakes,cycle,activeIndex:activeIndex(),rewardTier:song.rewardTier};
    }
    function notify(){
      const snap=snapshot();
      const signature=[snap.standing,snap.solved,snap.progress,snap.mistakes,snap.cycle,snap.activeIndex].join(':');
      if(signature!==lastSignature){lastSignature=signature;onChanged(snap);}
      return snap;
    }
    function step(dt,isStanding){
      const down=!!isStanding;
      const sampledMs=typeof currentClockMs==='function'?Number(currentClockMs()):NaN; // Browser performance.now; deterministic unit tests use dt when no clock is injected.
      if(!down){
        if(standing){
          standing=false;elapsed=0;progress=0;cycle=0;startedAtMs=null;nextScheduledBeat=1;expiredProgress=null;
          onStop(); // Cancel only future scheduled picks when a plate is vacated; sounded tails may finish.
        }
        return notify();
      }
      if(!standing){
        standing=true;elapsed=0;progress=0;cycle=0;expiredProgress=null;
        startedAtMs=Number.isFinite(sampledMs)?sampledMs:null;
        nextScheduledBeat=1;
        if(!solved)onBeat({beatIndex:0,absoluteBeat:0,downbeat:true,elapsed:0,whenMs:startedAtMs}); // First beat starts at the same clock origin as the score and all future picks.
      }else if(!solved){
        const delta=Number.isFinite(Number(dt))?Math.max(0,Number(dt)):0;
        const previousCycle=Math.floor(tickAt()/song.cycleTicks);
        elapsed=startedAtMs!==null&&Number.isFinite(sampledMs)
          ?Math.max(0,(sampledMs-startedAtMs)/1000):elapsed+delta; // Real-time clock resists capped frames, pauses in rendering and expensive world updates.
        const currentBeat=Math.floor(elapsed/quarterSeconds+1e-8);
        const lookaheadBeat=Math.floor((elapsed+lookaheadSeconds)/quarterSeconds+1e-8);
        if(lookaheadBeat>=nextScheduledBeat){
          const dueBeat=Math.max(currentBeat,nextScheduledBeat); // After a long stall, skip obsolete sounds instead of bursting through missed beats.
          if(dueBeat<=lookaheadBeat)onBeat({
            beatIndex:dueBeat%4,absoluteBeat:dueBeat,downbeat:dueBeat%4===0,elapsed,
            whenMs:startedAtMs===null?null:startedAtMs+dueBeat*quarterSeconds*1000,
          });
          nextScheduledBeat=lookaheadBeat+1;
        }
        const nextCycle=Math.floor(tickAt()/song.cycleTicks);
        if(nextCycle!==previousCycle){
          if(progress>0&&startedAtMs!==null)expiredProgress={progress,cycle:previousCycle}; // A queued press may predate a skipped song-cycle boundary.
          cycle=nextCycle;progress=0;
        }else if(progress<song.notes.length){
          const expected=song.notes[progress];
          const localTick=tickAt()%song.cycleTicks;
          if(localTick>=expected.startTick+expected.lengthTicks){
            if(progress>0&&startedAtMs!==null)expiredProgress={progress,cycle:nextCycle}; // Don't discard an earlier physical note just because rendering reached its deadline first.
            progress=0; // The live display resets immediately; timestamped notes can recover the just-expired attempt.
          }
        }
      }
      return notify();
    }
    function note(index,pressedAtMs=null){
      if(!standing||solved||!Number.isInteger(index)||index<0||index>=NOTE_COUNT)return false;
      const eventMs=Number(pressedAtMs); // The physical key/pointer event's timestamp survives asynchronous iframe messaging and slow render frames.
      const hasPhysicalTime=pressedAtMs!==null&&Number.isFinite(eventMs);
      const sampleMs=hasPhysicalTime?eventMs:
        typeof currentClockMs==='function'?Number(currentClockMs()):NaN;
      const playedElapsed=startedAtMs!==null&&Number.isFinite(sampleMs)
        ?(sampleMs-startedAtMs)/1000:elapsed;
      const absoluteTick=Math.max(0,playedElapsed/song.secondsPerTick);
      const localTick=absoluteTick%song.cycleTicks; // Judge the actual press, not the last animation-frame snapshot.
      const pressCycle=Math.floor(absoluteTick/song.cycleTicks);
      const graceTicks=.075/song.secondsPerTick; // A 75 ms late edge compensates for input/frame delivery without allowing early notes.
      const queued=hasPhysicalTime&&expiredProgress?.cycle===pressCycle? song.notes[expiredProgress.progress]:null;
      if(queued&&localTick>=queued.startTick-1e-7&&localTick<queued.startTick+queued.lengthTicks+graceTicks)
        progress=expiredProgress.progress; // Recover a successful press queued before step() reset progress.
      expiredProgress=null; // One physical input consumes the stale attempt; it cannot be replayed to advance twice.
      const expected=song.notes[progress];
      const onTime=!(startedAtMs!==null&&Number.isFinite(sampleMs)&&sampleMs<startedAtMs)
        &&!!expected&&localTick>=expected.startTick-1e-7
        &&localTick<expected.startTick+expected.lengthTicks+graceTicks;
      if(!onTime||index!==expected.index){
        mistakes++;
        progress=0; // The lights keep cycling; the next successful run starts on the next first glyph.
        notify();
        return false;
      }
      progress++;
      if(progress===song.notes.length){
        solved=true;
        onStop(); // Retire future metronome events as soon as the score completes.
        onSolved(snapshot());
      }
      notify();
      return true;
    }
    function setClockSource(source){
      if(source!==null && typeof source!=='function')throw new TypeError('Melody clock source must be a function or null.');
      currentClockMs=source; // Native V50 autoplay and music author tools can supply deterministic time without overriding global performance.now.
      const sampledMs=typeof currentClockMs==='function'?Number(currentClockMs()):NaN;
      startedAtMs=standing&&Number.isFinite(sampledMs)?sampledMs-elapsed*1000:null; // Maintain the current score phase if a test changes its clock after plate entry.
      return true;
    }
    return Object.freeze({step,note,snapshot,activeIndex,setClockSource,get solved(){return solved;}});
  }
  return Object.freeze({TICKS_PER_MEASURE,NOTE_COUNT,MIN_BPM,MAX_BPM,DURATIONS,generate,createSession,advanceGlyphGlow,GLYPH_COLORS});
});

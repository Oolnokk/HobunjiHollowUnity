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
  const MIN_BPM=66,MAX_BPM=100; // Slow but not languid; all generated songs stay at or below 100 BPM.
  const DURATIONS=[1,2,4,8,16]; // Sixteenth, eighth, quarter, half, whole; each event lasts its full written duration.
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
  function generate(id,options={}){
    const rng=seeded(String(id)+':puzzle-cave-song-v1');
    const difficulty=clamp(Math.floor(Number(options.difficulty)||1),1,5);
    const measures=options.measures===1||options.measures===2?options.measures:(difficulty>=3?2:1);
    const bpm=clamp(Math.round(Number(options.bpm)||Math.round(68+rng()*32)),MIN_BPM,MAX_BPM);
    const totalTicks=measures*TICKS_PER_MEASURE;
    const notes=[];
    let tick=0,previous=2;
    while(tick<totalTicks){
      const left=totalTicks-tick;
      const available=DURATIONS.filter(length=>length<=left && (difficulty>=4||length>=2) && (difficulty>=2||length>=4));
      const pool=available.length?available:[1];
      const length=pool[Math.floor(rng()*pool.length)];
      // Mostly stepwise motion with occasional melodic leaps; end on the tonic.
      const step=rng()<.76?(rng()<.5?-1:1)*(rng()<.75?1:2):(rng()<.5?-3:3);
      const index=tick+length>=totalTicks?0:clamp(previous+step,0,NOTE_COUNT-1);
      const isRest=difficulty>=3 && tick>0 && tick+length<totalTicks && rng()<.12;
      if(!isRest)notes.push({index,startTick:tick,lengthTicks:length});
      previous=index;
      tick+=length;
    }
    if(notes.length<2){
      notes.splice(0,notes.length,{index:2,startTick:0,lengthTicks:totalTicks/2},
        {index:0,startTick:totalTicks/2,lengthTicks:totalTicks/2});
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
      // All timing and ranking comes from the stable id: reloading never rerolls a solved cave.
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
  function createSession(song,{onSolved=()=>{},onChanged=()=>{},onBeat=()=>{}}={}){
    if(!song||!Array.isArray(song.notes)||!song.notes.length)throw new Error('Puzzle Cave song is missing its note sequence.');
    let standing=false,solved=false,elapsed=0,progress=0,mistakes=0,cycle=0,lastSignature='';
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
      if(!down){
        if(standing){standing=false;elapsed=0;progress=0;cycle=0;}
        return notify();
      }
      if(!standing){
        standing=true;elapsed=0;progress=0;cycle=0;
        if(!solved)onBeat({beatIndex:0,absoluteBeat:0,downbeat:true,elapsed:0}); // A pick strike on the first beat establishes the BPM as soon as the plate is occupied.
      }else if(!solved){
        const delta=Number.isFinite(Number(dt))?Math.max(0,Number(dt)):0; // Keep real BPM on slow frames rather than stretching every note by silently truncating elapsed time.
        const previousCycle=Math.floor(tickAt()/song.cycleTicks);
        const previousBeat=Math.floor(tickAt()/4+1e-8); // Four sixteenth ticks form a quarter-note metronome beat.
        elapsed+=delta;
        const absoluteBeat=Math.floor(tickAt()/4+1e-8);
        if(absoluteBeat>previousBeat)onBeat({beatIndex:absoluteBeat%4,absoluteBeat,downbeat:absoluteBeat%4===0,elapsed});
        // A dropped mobile frame plays only the most recent beat, never a burst of late pick recordings.
        const nextCycle=Math.floor(tickAt()/song.cycleTicks);
        if(nextCycle!==previousCycle){cycle=nextCycle;progress=0;}
        else if(progress<song.notes.length){
          const expected=song.notes[progress];
          const localTick=tickAt()%song.cycleTicks;
          if(localTick>=expected.startTick+expected.lengthTicks)progress=0; // A missed window invalidates the attempt, not the looping score.
        }
      }
      return notify();
    }
    function note(index){
      if(!standing||solved||!Number.isInteger(index)||index<0||index>=NOTE_COUNT)return false;
      const at=activeIndex();
      const expected=song.notes[progress];
      if(at!==progress||!expected||index!==expected.index){
        mistakes++;
        progress=0; // The lights keep cycling; the next successful run starts on the next first glyph.
        notify();
        return false;
      }
      progress++;
      if(progress===song.notes.length){
        solved=true;
        onSolved(snapshot());
      }
      notify();
      return true;
    }
    return Object.freeze({step,note,snapshot,activeIndex,get solved(){return solved;}});
  }
  return Object.freeze({TICKS_PER_MEASURE,NOTE_COUNT,MIN_BPM,MAX_BPM,DURATIONS,generate,createSession,advanceGlyphGlow,GLYPH_COLORS});
});

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
  function createSession(song,{onSolved=()=>{},onChanged=()=>{}}={}){
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
      }else if(!solved){
        const delta=clamp(Number(dt)||0,0,.25);
        const previousCycle=Math.floor(tickAt()/song.cycleTicks);
        elapsed+=delta;
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
  return Object.freeze({TICKS_PER_MEASURE,NOTE_COUNT,MIN_BPM,MAX_BPM,DURATIONS,generate,createSession});
});

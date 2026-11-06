'use strict';
const assert=require('node:assert/strict');
const Song=require('../docs/js/puzzle-cave-melody.js'); // Exercises the exact browser module via its CommonJS export.

const first=Song.generate('wilderness:puzzle:1',{difficulty:1});
assert.deepEqual(first,Song.generate('wilderness:puzzle:1',{difficulty:1}),'one cave retains its score on reload');
assert.equal(first.measures,1);
assert.ok(first.bpm<=100&&first.bpm>=66,'all tempos are slow and bounded');
assert.equal(first.cycleTicks-first.totalTicks,16,'one full measure of silence separates repeats');
assert.ok(first.notes.length>=2);
assert.ok(first.notes.every(note=>Number.isInteger(note.index)&&note.index>=0&&note.index<8));
assert.ok(first.notes.every(note=>[1,2,4,8,16].includes(note.lengthTicks)));

const harder=Song.generate('wilderness:puzzle:2',{difficulty:5});
assert.equal(harder.measures,2);
assert.equal(harder.totalTicks,32);
assert.ok(harder.rewardTier>=first.rewardTier,'a longer, complex melody should not award lower-tier treasure');
for(let index=0;index<80;index++){
  const song=Song.generate('cave-'+index,{difficulty:1+index%5});
  assert.ok(song.notes.every(note=>note.startTick+note.lengthTicks<=song.totalTicks));
  assert.ok(song.notes.some(note=>note.startTick===0),'all scores start with a playable note');
  assert.ok(song.bpm<=100);
}

let solved=0;
const session=Song.createSession(harder,{onSolved:()=>solved++});
assert.equal(session.note(harder.notes[0].index),false,'off-plate music cannot solve the cave');
session.step(0,true);
assert.equal(session.activeIndex(),0);
assert.equal(session.note((harder.notes[0].index+1)%8),false,'wrong note resets the current attempt');
assert.equal(session.snapshot().progress,0);
session.step(0,false);
assert.equal(session.snapshot().standing,false,'leaving the plate disarms input');
assert.equal(session.snapshot().elapsed,0,'leaving the plate resets the looping score');

session.step(0,true);
let elapsed=0; // Monotonic clock advanced by runtime step, used to position each note within its glyph window.
function advance(targetSeconds){
  while(elapsed+0.000001<targetSeconds){
    const delta=Math.min(.025,targetSeconds-elapsed);
    session.step(delta,true);
    elapsed+=delta;
  }
}
for(let i=0;i<harder.notes.length;i++){
  const note=harder.notes[i];
  advance((note.startTick+.10)*harder.secondsPerTick);
  assert.equal(session.activeIndex(),i,'the correct glyph glows for the entire written note duration');
  assert.equal(session.note(note.index),true,'sounding the written note in time advances the score');
}
assert.equal(session.solved,true);
assert.equal(solved,1,'reward callback fires exactly once');
assert.equal(session.note(harder.notes[0].index),false,'a solved song cannot be submitted twice');

const replay=Song.createSession(first);
replay.step(0,true);
for(let t=0;t<first.totalTicks+1;t++)replay.step(first.secondsPerTick,true);
assert.equal(replay.activeIndex(),-1,'glyphs go dark in the silent measure');
for(let t=0;t<16;t++)replay.step(first.secondsPerTick,true);
assert.equal(replay.activeIndex(),0,'the song repeats while the player stays on the plate');

const slowFrame=Song.createSession(first);
slowFrame.step(0,true);
slowFrame.step(.72,true); // Simulates a memory-stressed mobile frame well beyond the former 0.25-second clamp.
assert(Math.abs(slowFrame.snapshot().elapsed-.72)<1e-8,
  'a lag spike must advance the real song clock instead of silently slowing its BPM');
slowFrame.step(0,false);
assert.equal(slowFrame.snapshot().elapsed,0,'stepping off still resets time after a stalled frame');

console.log('Puzzle Cave melody: deterministic generation, bounded tempo, timed notes, lag spikes, loop, reset, and exactly-once solve OK');

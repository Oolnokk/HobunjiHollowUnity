#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const Song = require('../docs/js/puzzle-cave-melody.js'); // Exercises the shipped score judge, not a reimplemented metronome.
const song = Song.generate('stonebeat-transport-regression', {bpm:80,difficulty:3});
const quarterMs = 60000 / song.bpm; // Expected deadlines derive from the score's BPM.
let now = 10000; // Simulates performance.now through missed render frames.
let stops = 0; // Counts requests to cancel future audio when leaving the plate.
const beats = []; // Events forwarded to the Web Audio scheduler.
const session = Song.createSession(song,{clockMs:()=>now,lookaheadMs:90,onBeat:beat=>beats.push(beat),onStop:()=>stops++});
session.step(0,true);
assert.deepEqual(beats.map(beat=>beat.beatIndex),[0]);
assert.equal(beats[0].whenMs,10000);
now=10000+quarterMs-80;session.step(.01,true); // Schedule the upcoming quarter beat inside 90 ms of audio lookahead.
assert.equal(beats.length,2);
assert.equal(beats[1].whenMs,10000+quarterMs,'future beat uses the audio boundary, not the render timestamp');
now=10000+quarterMs;session.step(.09,true);
assert.equal(beats.length,2,'no double-fire on a pre-scheduled beat');
now=10000+quarterMs*2-80;session.step(.5,true);
assert.equal(beats[2]?.whenMs,10000+quarterMs*2);
assert.deepEqual(beats.map(beat=>beat.beatIndex),[0,1,2]);
now=10000+quarterMs*4+200;session.step(.01,true);
assert.equal(beats.at(-1).absoluteBeat,4,'late frames skip obsolete beat 3');
assert.equal(beats.at(-1).whenMs,10000+quarterMs*4);
assert.equal(session.snapshot().elapsed,4*quarterMs/1000+.2,'judgment and glyphs use the same monotonic clock as the audio');
session.step(0,false);
assert.equal(stops,1,'plate exit cancels future scheduled sounds once');
now=13000;session.step(0,true);
assert.equal(beats.at(-1).absoluteBeat,0,'returning to the plate resets the numbered cycle');
assert.equal(beats.at(-1).whenMs,13000);
const fallback=[]; // Existing deterministic callers still advance using delta time.
const compatibility=Song.createSession(song,{onBeat:beat=>fallback.push(beat)});
compatibility.step(0,true);compatibility.step(quarterMs/1000,true);
assert.deepEqual(fallback.map(beat=>beat.beatIndex),[0,1]);
assert.equal(fallback[1].whenMs,null);
console.log('stonebeat transport clock: PASS (90 ms lookahead, glyph sync, frame skip, reset, dt fallback)');

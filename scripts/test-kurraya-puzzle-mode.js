'use strict';
const assert = require('node:assert/strict'); // Validates the production instrument model and integration contracts.
const fs = require('node:fs'); // Loads actual game/Tool Hub files without reimplementing their content.
const vm = require('node:vm'); // Executes the pure shared song model with a small browser storage seam.

const source = fs.readFileSync('docs/js/kurraya-puzzle.js','utf8');
const localValues = new Map(); // Mocks persisted songbook and scale settings across reloads.
const localStorage = {getItem:key=>localValues.get(key)||null,setItem:(key,value)=>localValues.set(key,value)};
const window = {localStorage,dispatchEvent() {}}; // Optional UI notifications are irrelevant to recognition logic.
const moduleRef = {exports:{}}; // Captures the CommonJS export of the same UMD file that browsers load.
vm.runInNewContext(source,{window,module:moduleRef,Event:function Event(){}});
const model=moduleRef.exports;
assert.equal(Object.keys(model.SCALES).length>=5,true,'several tunable five-note scales are supported');
assert.ok(Object.values(model.SCALES).every(intervals=>intervals.length===5),'no banks, extra pitches, or chord notes');
assert.notEqual(model.pitchFor(4,{scale:'Dorian',tonicMidi:60}),model.pitchFor(4,{scale:'Natural Minor',tonicMidi:60}),
  'distinct scale names produce meaningfully distinct note layouts');
assert.equal(model.pitchFor(4,{scale:'Pentatonic Minor',tonicMidi:60}),70);
assert.equal(model.matchSuffix([4,4,0,1,2,4,2,1,0])?.id,'puzzle-practice',
  'recognition is purely ordered: arbitrary preceding notes do not affect the match');
assert.equal(model.matchSuffix([0,1,3,4]),null);
model.setSettings({scale:'Phrygian',tonicMidi:65});
assert.equal(model.settings().scale,'Phrygian');
assert.equal(model.settings().tonicMidi,65);
const draft=model.saveSong({title:'Test melody',notes:[4,3,2,1,0],scale:'Major',tonicMidi:60});
assert.equal(model.matchSuffix([4,3,2,1,0])?.id,draft.id);
model.saveSong({...draft,notes:[0,0,1]});
assert.equal(model.listSongs().filter(song=>song.id===draft.id).length,1,'editing updates rather than duplicating');
assert.equal(model.matchSuffix([0,0,1])?.id,draft.id);
assert.throws(() => model.saveSong({title:'Unfinishable',notes:[4,0,0,1,4],scale:'Major',tonicMidi:60}),/conflicts with/,
  'short song inside a longer melody would trigger too early');
assert.throws(() => model.saveSong({title:'Duplicate',notes:[0,0,1],scale:'Major',tonicMidi:60}),/conflicts with/,
  'duplicate note sequences cannot be distinguished by timing');
assert.equal(model.normalizeSong({id:'bad',title:'bad',notes:[[0,1],[1,2],[2,3]]}),null,'chords are invalid');
assert.equal(model.normalizeSong({id:'bad',title:'bad',notes:[0,1]}),null,'songs require at least three notes');
assert.equal(model.deleteSong(draft.id),true);
assert.ok(!model.listSongs().some(song=>song.id===draft.id));
model.importSongs({songs:[{id:'imported',title:'Imported',notes:[1,2,3],scale:'Major',tonicMidi:62}]});
assert.ok(model.listSongs().some(song=>song.id==='imported'));
assert.throws(()=>model.importSongs({songs:[{id:'invalid',title:'Invalid',notes:[0,8,1]}]}),/Invalid song/);

const host=fs.readFileSync('docs/js/music-minigame.js','utf8'); // Actual gameplay overlay owner.
const puzzle=fs.readFileSync('docs/assets/minigames/kurraya-puzzle.html','utf8'); // Actual interactive iframe.
const lab=fs.readFileSync('docs/tools/kurraya-music-lab/index.html','utf8'); // Existing music tool hub workspace.
const instrument=fs.readFileSync('docs/js/kurraya-instrument.js','utf8'); // Minimal legacy presentation owner.
const index=fs.readFileSync('docs/index.html','utf8'); // Game script load order.
assert.match(host,/switchInstrumentMode\('puzzle'\)/,'the default instrument mode is puzzle');
assert.match(host,/PUZZLE_MINIGAME_SRC/);
assert.match(host,/startPuzzleInputs\(\)/,'puzzle uses shared controller input');
assert.match(host,/if \(event\.code === 'Escape'\)/,'Escape exits the puzzle');
assert.match(host,/const exitCode = Object\.prototype\.hasOwnProperty\.call\(bindings,'musicPause'\)/,
  'controller Start exits the puzzle');
assert.match(host,/puzzle-song-recognized/,'a recognized song is forwarded to gameplay');
assert.match(host,/function silenceAmbientForPuzzle\(\)/,'puzzle explicitly silences nearby NPC backing tracks');
assert.match(host,/playerSession\?\.instrumentMode === 'puzzle' && playerSession\.area === performer\.area/,
  'NPC scheduled audio never restarts inside the puzzle');
assert.match(host,/suspendedNpcSong\?\.npcId === performer\.npcId/,
  'switching to legacy Performance resumes the captured NPC melody');
assert.match(instrument,/overlay\.dataset\.instrumentMode === 'performance'/,'puzzle iframe is not hidden by the old performance minimizer');
assert.match(puzzle,/music\.matchSuffix\(history\)/,'notes are recognized by ordered suffix, never timestamp or rhythm');
assert.doesNotMatch(puzzle,/rootPad|metronome|chordDown|noteDown\(/i,'puzzle UI has no root pad, metronome, or chords');
assert.match(lab,/id="puzzlePane"/);
assert.match(lab,/model\.saveSong\(/);
assert.match(lab,/model\.importSongs\(/);
assert.match(index,/js\/kurraya-puzzle\.js\?v=/);
assert.ok(index.indexOf('js/kurraya-puzzle.js?v=')<index.indexOf('js/music-minigame.js?v='),
  'shared song model loads before the gameplay host');
console.log('Kurraya puzzle mode: song model + host/tool integration checks passed.');

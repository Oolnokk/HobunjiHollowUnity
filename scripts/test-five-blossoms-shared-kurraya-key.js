#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Fast source/runtime guards for one player/NPC performance key and shared Kurraya note action.
const fs = require('node:fs'); // Read the shipped files (not a forked mock implementation).
const lyre = fs.readFileSync('docs/assets/minigames/lyre-performance.html','utf8'); // Shared hosted Music Lab is the only audio engine for both performers.
const host = fs.readFileSync('docs/js/music-minigame.js','utf8'); // The game must mark both player/NPC frames as overworld performances.
const held = fs.readFileSync('docs/js/npc-held-equipment-v4.js','utf8'); // NPC animations must feed the shared authored holder and hands.
const handDriver = fs.readFileSync('docs/js/procedural-hand-frame-driver.js','utf8'); // Render-time plucking must use the NPC's own authoring state.
const instrument = fs.readFileSync('docs/js/kurraya-instrument.js','utf8'); // Both note clocks must read the same kurrayaPlayNote action.
assert.match(host,/MUSIC_MINIGAME_SRC\s*=\s*'[^']+&overworld=1'/,'both game iframes load in shared-key mode');
assert.match(host,/Shared root note \(player \+ NPCs\)/,'the existing root note setting is labeled as shared');
assert.match(host,/Shared scale \(player \+ NPCs\)/,'the existing scale setting is labeled as shared');
assert.match(lyre,/overworldSharedTuning \? null : npcScale \|\| melody\?\.scaleName/,'hosted songs cannot override the saved scale with NPC Minor or authored Major');
assert.match(lyre,/randomizeKurrayaSongMelody\(state\.scaleName\)/,'NPC melody generation uses the current shared note set');
assert.match(lyre,/tonicMidi:state\.tonicMidi,scaleName:state\.scaleName,generated:/,'mobile NPC diagnostic shows its actual sounding tonic and scale');
assert.match(instrument,/function npcNotePose[\s\S]*?HeldActionAnimations\?\.kurrayaPlayNote/,'NPCs sample the same authored note action');
assert.match(held,/function updateKurrayaStation[\s\S]*?instrument\.npcNotePose\(walker\.stationKurrayaTwitch\)/,'NPC holder uses sounded notes instead of a generic strum timer');
assert.match(held,/proceduralHandFreeRightPose = grips\(\)\?\.sampleFreeRightHand/,'NPC plucking hand interpolates the same authored free hand as the player');
assert.match(handDriver,/function freeRightHandFor[\s\S]*?npcAuthored[\s\S]*?return npcAuthored/,'NPC-specific hand target takes effect at the real render-time hand driver');
assert.match(held,/releaseKurrayaStation\(state\)/,'station cleanup relinquishes animation ownership');
console.log('Shared festival key, NPC authored Kurraya hand/holder/body, cleanup and mobile diagnostics contract passed.');

#!/usr/bin/env node
'use strict';
// Run: node scripts/test-humanoid-voice-age-yawn.js
// Execute the production async yawn voice path with authentic renderer options.
const assert = require('node:assert/strict'); // Validates pitch/tempo, family stages, and fallback flags.
const fs = require('node:fs'); // Reads the live NPC yawn runtime from this checkout.
const vm = require('node:vm'); // Tests without a browser audio device or player scene.
async function main(){
  const source=fs.readFileSync('docs/js/npc-yawn-rest.js','utf8'); // Runtime, not a rewritten yawn algorithm.
  const from=source.indexOf('  async function startVoice(entry)'); // Production playback entry.
  const until=source.indexOf('  function restorePose(',from); // End of isolated async voice path.
  assert(from>=0&&until>from,'yawn playback function must be found');
  const active=new Set(); // Mirrors live yawn lifetime guard.
  const voices=[]; // Captured actual renderer requests, including tempo and native fallback preferences.
  let currentStage='baby'; // Saved age phase changes without recreating the NPC.
  let plan={url:'dedicated.ogg',source:'gender yawn',pitch:0,tempo:1,gain:1,fallbackBreath:false}; // Already-matched adult recording.
  const offsets={baby:9,toddler:6,child:3}; // Authored global age defaults.
  const window={
    Combat:{deps:{TILE:64,getCurrentArea:()=> 'farm'}},
    AudioSystem:{
      gameAudioConfig:()=>({enabled:true,sfxVolume:1}),
      combatAudioSpatial:()=>({gain:1,panX:0,position3d:null}),
    },
    CombatVocalizations:{
      getVoiceAgeStage:()=>currentStage,
      getAgePitchOffset:()=>offsets[currentStage]||0,
      getVoicePriority:()=>3,
    },
    AnimalVoiceIndependentPlayback:{playIndependent(url,opts){
      voices.push({url,opts});return {stop(){}};
    }},
    CharacterVoiceOwner:{request:()=>({}),bindStop(){},release(){}},
  }; // Fixed upstream game API; only active playback is exercised.
  const sandbox={
    window,active,trailingBreaths:new Set(),
    sourceIdentity:()=>({species:'mao-ao',gender:'female'}),
    voiceFor:async()=>plan,
    lastVoice:null,lastPlayerVoice:null,lastError:null,
  }; // Resolver and asset probe are stubs; actual pitch composition is the production startVoice.
  vm.runInNewContext(source.slice(from,until)+'\nwindow.startAgeYawn=startVoice;',sandbox);
  const walker={area:'farm',rec:{id:'saved-child',appearance:{speciesId:'mao-ao',gender:'female'}},
    root:{position:{x:1,z:2}}}; // Same live walker at all stages.
  async function play(){
    const entry={walker,isPlayer:false,finished:false}; // Each yawn owns a fresh audio claim.
    active.add(entry);
    await window.startAgeYawn(entry);
    active.delete(entry);
    return voices.at(-1);
  }
  let v=await play();
  assert.equal(v.url,'dedicated.ogg','dedicated yawn clip unchanged');
  assert.equal(v.opts.pitchSemitones,9,'baby raises dedicated voice +9');
  assert.equal(v.opts.tempo,1,'age leaves dedicated yawn tempo alone');
  assert.equal(v.opts.trimSilence,true,'dedicated yawn still trims silence');
  currentStage='toddler';
  plan={url:'fallback-breath.m4a',source:'fallback',pitch:7,tempo:.35,gain:1,fallbackBreath:true};
  v=await play();
  assert.equal(v.opts.pitchSemitones,13,'toddler adds +6 to gender/species fallback pitch');
  assert.equal(v.opts.tempo,.35,'fallback yawn keeps 0.350x tempo');
  assert.equal(v.opts.trimSilence,false,'fallback breath preserves its full original tail');
  assert.equal(v.opts.preferPitchShiftOnFallback,true,'native fallback prioritizes audible pitch');
  currentStage='child';v=await play();
  assert.equal(v.opts.pitchSemitones,10,'child transitions to +3 with unchanged identity');
  currentStage='adult';v=await play();
  assert.equal(v.opts.pitchSemitones,7,'adult has no additive age offset');
  plan={url:'male-borrowed.ogg',source:'male yawn, relative female modulation',pitch:6,tempo:.8,gain:1.25,fallbackBreath:false};
  currentStage='baby';v=await play();
  assert.equal(v.opts.pitchSemitones,15,'borrowed male voice keeps gender relative + child age pitch');
  assert.equal(v.opts.tempo,.8,'borrowed male voice retains authored female tempo');
  assert.equal(v.opts.volume,.72*1.25,'voice gain remains independent of age');
  plan={url:'very-high.ogg',source:'fallback',pitch:19,tempo:.35,gain:1,fallbackBreath:true};
  v=await play();
  assert.equal(v.opts.pitchSemitones,24,'resulting pitch is clamped to 24 semitones');
  console.log('Age-based dedicated, borrowed and fallback yawns: production playback passed');
}
main().catch(error=>{console.error(error);process.exitCode=1});

'use strict';
const assert = require('node:assert/strict'); // Behavioral coverage of cooperative charge processing and bounded reuse.
const fs = require('node:fs'); // Loads the shipped DSP owner.
const windowStub = { addEventListener() {} }; // No browser audio device is needed to render decoded buffers.
const documentStub = { addEventListener() {} }; // Prevents gesture/editor setup from accessing a real DOM.
new Function('window', 'document', fs.readFileSync('docs/js/animal-voice-independent-playback.js','utf8'))(windowStub, documentStub);
const api = windowStub.AnimalVoiceIndependentPlayback; // Public production rendering API.
let allocations = 0; // Identical requests must reuse their AudioBuffer.
const context = { createBuffer(count, length, sampleRate) {
  allocations++;
  const channels = Array.from({length:count},()=>new Float32Array(length)); // Mimics AudioBuffer channel storage.
  return {length,sampleRate,numberOfChannels:count,duration:length/sampleRate,copyToChannel(data,i){channels[i].set(data);},getChannelData(i){return channels[i];}};
} };
const samples = Float32Array.from({length:48000},(_,i)=>Math.sin(i*.07)*.3); // One second at 48 kHz exercises real WSOLA search work.
const decoded = {length:samples.length,numberOfChannels:1,sampleRate:48000,duration:1,getChannelData:()=>samples}; // Stable source identity for the render cache.
(async()=>{
  let eventLoopRan = false; // A browser task must be able to run before an uncached waveform finishes.
  setTimeout(()=>{eventLoopRan=true;},0);
  const first = api.renderDecodedIndependentBuffer(decoded,context,{tempo:.25,pitchSemitones:0,tailPadS:0}); // Four-second held charge.
  assert.equal(api.renderDecodedIndependentBuffer(decoded,context,{tempo:.25,pitchSemitones:0,tailPadS:0}),first,'in-flight renders are deduplicated');
  const result = await first; // Completed output is shared, including exact playback duration.
  assert(eventLoopRan,'uncached processing yields to timer/input/render tasks');
  assert.equal(result.durationS,4);
  assert.equal(allocations,1);
  assert.equal(await api.renderDecodedIndependentBuffer(decoded,context,{tempo:.25,pitchSemitones:0,tailPadS:0}),result);
  assert.equal(allocations,1,'cache hit does not regenerate samples');
  const padded = await api.renderDecodedIndependentBuffer(decoded,context,{tempo:.25,pitchSemitones:0,tailPadS:.01}); // Output-envelope options must remain part of the key.
  assert.equal(padded.durationS,4.01);
  const tiny = {length:32,numberOfChannels:1,sampleRate:48000,duration:32/48000,getChannelData:()=>samples.subarray(0,32)}; // Fast variants exercise eviction without a timing-heavy test.
  for(let i=0;i<35;i++) await api.renderDecodedIndependentBuffer(tiny,context,{tempo:1,pitchSemitones:i/10});
  assert(api.debugSnapshot().chargeRendering.cachedVariants<=32,'cache remains bounded');
  assert(api.debugSnapshot().chargeRendering.yields>0);
  console.log('charge rendering: yield, exact duration, concurrent reuse, option isolation, bounded cache passed');
})().catch(error=>{console.error(error);process.exitCode=1;});

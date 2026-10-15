'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { Worker: NodeWorker } = require('node:worker_threads');

const source = fs.readFileSync('docs/js/animal-voice-independent-playback.js', 'utf8')
  .replace('window.AnimalVoiceIndependentPlayback = {', 'window.testDsp = { processConstantAxes, processConstantAxesOffThread, renderBufferFor }; window.AnimalVoiceIndependentPlayback = {'); // Expose DSP only in the harness.
const workers = []; // Terminated even when an assertion fails.
const blobs = new Map(); // Browser Blob URLs resolved by the Node worker adapter.
let timerYields = 0; // Worker rendering must not wait on main-thread timer slices.
class TestBlob {
  constructor(parts) { this.code = parts.join(''); }
}
class TestURL extends URL {
  static createObjectURL(blob) { const key = `blob:test-${blobs.size}`; blobs.set(key, blob.code); return key; }
  static revokeObjectURL(key) { blobs.delete(key); }
}
class TestWorker {
  constructor(url) {
    this.worker = new NodeWorker(`const { parentPort } = require('node:worker_threads');
      global.self = { postMessage: (data, transfer) => parentPort.postMessage(data, transfer) };
      ${blobs.get(url)}
      parentPort.on('message', data => self.onmessage({ data }));`, { eval: true });
    workers.push(this.worker);
    this.worker.on('message', data => this.onmessage?.({ data }));
    this.worker.on('error', error => this.onerror?.({ message: error.message, preventDefault() {} }));
  }
  postMessage(data, transfer) { this.worker.postMessage(data, transfer); }
  terminate() { return this.worker.terminate(); }
}
function buffer(channels, length, sampleRate) {
  const data = Array.from({ length: channels }, () => new Float32Array(length)); // AudioBuffer storage must remain intact after transfer.
  return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
    getChannelData: index => data[index], copyToChannel: (samples, index) => data[index].set(samples) };
}
function sandbox(Worker = TestWorker) {
  const scope = { console, URL: TestURL, Blob: TestBlob, Worker, performance,
    location: { href: 'https://example.test/', pathname: '/' },
    setTimeout(fn, ms) { timerYields++; return setTimeout(fn, ms); }, clearTimeout,
    addEventListener() {}, document: { addEventListener() {} } }; // Minimal browser host for the shipped module.
  scope.window = scope;
  vm.runInNewContext(source, scope);
  return scope;
}
(async () => {
  const scope = sandbox(); // Runs production worker generation, message handling, transfers, and DSP.
  const input = buffer(2, 12000, 44100); // Stereo signal exercises correlations and independent channel envelopes.
  for (let channel = 0; channel < 2; channel++) {
    for (let index = 0; index < input.length; index++) input.getChannelData(channel)[index] = Math.sin(index * (0.027 + channel * 0.009)) * 0.6;
  }
  const cases = [[0.7, -5], [1.6, 7], [1, 0]]; // Stretch, compress, and unity transforms share precisely the fallback math.
  await Promise.all(cases.map(async ([tempo, pitch]) => {
    const expected = scope.testDsp.processConstantAxes(input, tempo, pitch, 4, 24, { tailPadS: 0 }); // Synchronous reference.
    const actual = await scope.testDsp.processConstantAxesOffThread(input, tempo, pitch, { tailPadS: 0 });
    for (let channel = 0; channel < 2; channel++) assert.deepEqual(Array.from(actual[channel]), Array.from(expected[channel]));
  }));
  assert.equal(timerYields, 0, 'worker jobs must not incur nested timer startup delays');
  assert.equal(input.getChannelData(0).length, 12000, 'transfer must preserve the cached decoded source');
  assert.equal(scope.AnimalVoiceIndependentPlayback.debugSnapshot().chargeRendering.worker.completed, 3);
  const context = { createBuffer: buffer }; // Exercise production cache around the worker.
  const cached = await scope.testDsp.renderBufferFor('cached.wav', input, context, 1, 2);
  assert.equal(await scope.testDsp.renderBufferFor('cached.wav', input, context, 1, 2), cached);
  assert.equal(scope.AnimalVoiceIndependentPlayback.debugSnapshot().chargeRendering.worker.completed, 4);

  const blocked = sandbox(class { constructor() { throw new Error('CSP blocked worker'); } }); // Restricted browsers must retain correct audio.
  const fallback = await blocked.testDsp.processConstantAxesOffThread(input, 1, 0, {});
  assert.deepEqual(Array.from(fallback[0]), Array.from(blocked.testDsp.processConstantAxes(input, 1, 0)[0]));
  assert.equal(blocked.AnimalVoiceIndependentPlayback.debugSnapshot().chargeRendering.worker.failed, true);

  const crashed = sandbox(class { // Asynchronous worker failures must settle pending jobs and use the fallback.
    postMessage() { queueMicrotask(() => this.onerror({ message: 'crashed', preventDefault() {} })); }
    terminate() {}
  });
  const recovered = await crashed.testDsp.processConstantAxesOffThread(input, 1, 0, {});
  assert.deepEqual(Array.from(recovered[0]), Array.from(fallback[0]));
  console.log('Voice worker preserves exact stereo DSP, avoids timer delays, retains decoded sources/cache, and recovers from blocked/crashed workers.');
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => Promise.all(workers.map(worker => worker.terminate())));

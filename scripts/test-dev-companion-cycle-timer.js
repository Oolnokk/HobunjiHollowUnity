'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const docs = path.join(__dirname, '..', 'docs'); // Checks the shipped pages and audio processor, not a second implementation.
const read = file => fs.readFileSync(path.join(docs, file), 'utf8');

(async () => {
  const game = read('index.html');
  const pane = game.indexOf('<div class="settings-pane">');
  const launcher = game.indexOf('id="devCompanionOpenBtn"');
  const firstSection = game.indexOf('id="settingsSection0"');
  assert.ok(pane !== -1 && pane < launcher && launcher < firstSection, 'Dev Companion opens above every Settings section');
  assert.match(game.slice(pane, launcher), /<div data-dev-only class="settings-row">/, 'launcher remains gated by Dev Mode');
  assert.equal(game.match(/id="devCompanionOpenBtn"/g).length, 1, 'launcher is not duplicated');

  const companion = read('tools/dev-companion/index.html');
  assert.match(companion, /id="cycleTimerEnabled"/);
  assert.match(companion, /id="cycleTimerValue"/);
  assert.match(companion, /cycle-timer\.js\?v=[\w-]+/);
  const source = read('tools/dev-companion/cycle-timer.js');
  const stored = new Map(); // Browser persistence fake shared with the simulated popup.
  const elements = new Map();
  for (const id of ['cycleTimerEnabled', 'cycleTimerValue', 'cycleTimerUnit', 'cycleTimerStatus', 'cycleTimerPreview']) {
    const listeners = new Map();
    elements.set(id, {
      checked: false, value: id === 'cycleTimerValue' ? '5' : 'min', textContent: '',
      addEventListener(event, fn) { listeners.set(event, fn); },
      trigger(event) { listeners.get(event)?.(); },
      setCustomValidity(message) { this.validation = message; },
    });
  }
  const messages = [];
  const audioContexts = [];
  let lastNode = null;
  class FakeAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = {};
      this.closed = false;
      this.audioWorklet = { addModule: async url => { assert.match(url, /cycle-timer-processor\.js\?v=/); } };
      audioContexts.push(this);
    }
    resume() { return Promise.resolve(); }
    close() { this.closed = true; return Promise.resolve(); }
  }
  class FakeNode {
    constructor(ctx, name) {
      assert.equal(name, 'hobunji-cycle-chime');
      this.ctx = ctx;
      this.port = { postMessage: message => messages.push(message) };
      lastNode = this;
    }
    connect() { this.connected = true; }
    disconnect() { this.connected = false; }
  }
  const localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, val) => stored.set(key, val) };
  const events = new Map();
  const ctx = vm.createContext({
    document: { getElementById: id => elements.get(id), visibilityState: 'visible' },
    localStorage, AudioContext: FakeAudioContext, AudioWorkletNode: FakeNode,
    setInterval() {}, setTimeout() {}, console,
    addEventListener(event, fn) { events.set(event, fn); },
  });
  ctx.window = ctx;
  vm.runInContext(source, ctx, { filename: 'cycle-timer.js' });
  const checkbox = elements.get('cycleTimerEnabled');
  const duration = elements.get('cycleTimerValue');
  const units = elements.get('cycleTimerUnit');
  const status = elements.get('cycleTimerStatus');
  assert.equal(ctx.DevCompanionCycleTimer.getState().enabled, false, 'timers do not auto-play without a gesture');
  duration.value = '2';
  duration.trigger('change');
  assert.deepEqual(JSON.parse(stored.values().next().value), { value: 2, unit: 'min' }, 'interval preference persists');
  checkbox.checked = true;
  checkbox.trigger('change');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ctx.DevCompanionCycleTimer.getState().seconds, 120);
  assert.equal(lastNode.connected, true);
  assert.equal(messages.at(-1).type, 'configure');
  assert.equal(messages.at(-1).seconds, 120);
  ctx.document.visibilityState = 'hidden';
  events.get('blur')?.();
  assert.equal(ctx.DevCompanionCycleTimer.getState().enabled, true, 'blurring the popup does not stop audio');
  units.value = 'sec';
  units.trigger('change');
  assert.equal(messages.at(-1).seconds, 2, 'editing interval reconfigures the running audio clock');
  assert.match(status.textContent, /Next chime/);
  checkbox.checked = false;
  checkbox.trigger('change');
  assert.equal(messages.at(-1).type, 'stop');
  assert.equal(audioContexts[0].closed, true, 'stopping releases the audio context');
  assert.equal(ctx.DevCompanionCycleTimer.getState().enabled, false);

  let Processor = null;
  class WorkletBase { constructor() { this.port = { onmessage: null }; } }
  vm.runInNewContext(read('tools/dev-companion/cycle-timer-processor.js'), {
    AudioWorkletProcessor: WorkletBase, sampleRate: 8000,
    registerProcessor(name, constructor) { assert.equal(name, 'hobunji-cycle-chime'); Processor = constructor; },
  });
  assert.ok(Processor, 'audio processor registered');
  const processor = new Processor();
  processor.port.onmessage({ data: { type: 'configure', seconds: 1 } });
  const all = [];
  for (let index = 0; index < 130; index++) {
    const output = [new Float32Array(128)];
    assert.equal(processor.process([], [output]), true, 'audio stays active for background playback');
    all.push(...output[0]);
  }
  assert.ok(all.slice(0, 7999).every(sample => sample === 0), 'first chime happens after one full interval');
  assert.ok(all.slice(8000, 9000).some(sample => Math.abs(sample) > 0.01), 'chime has audible samples');
  assert.ok(all.slice(16000, 16640).some(sample => Math.abs(sample) > 0.01), 'chime repeats on the audio clock');
  processor.port.onmessage({ data: { type: 'stop' } });
  for (let index = 0; index < 4; index++) {
    const output = [new Float32Array(128)];
    processor.process([], [output]);
    assert.ok(output[0].every(sample => sample === 0), 'stopped processor remains silent');
  }

  console.log('Dev Companion cycling timer: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });

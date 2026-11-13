// Companion-local repeating sound timer. AudioWorklet does the timing: neither
// the game loop nor a background-throttled setInterval is responsible for chimes.
(() => {
  'use strict';
  if (window.DevCompanionCycleTimer) return;

  const $ = id => document.getElementById(id);
  const enabled = $('cycleTimerEnabled');
  const valueInput = $('cycleTimerValue');
  const unitInput = $('cycleTimerUnit');
  const status = $('cycleTimerStatus');
  const preview = $('cycleTimerPreview');
  if (!enabled || !valueInput || !unitInput || !status || !preview) return;

  const PREFS_KEY = 'hobunjiDevCompanionCycleTimer.v1'; // Remembers interval, not auto-play (which requires a user gesture).
  const PROCESSOR_URL = 'cycle-timer-processor.js?v=20261113cycle1'; // Sample-clock scheduler, loaded only when activated.
  let context = null; // Independent from the game's audio mixer and its Mute in Background setting.
  let node = null; // Active AudioWorkletNode keeps sounding while the companion window is unfocused.
  let seconds = 300; // Current configured interval, also used for the countdown readout.
  let phaseStart = 0; // AudioContext clock time of the latest start or interval change.
  let generation = 0; // Invalidates an in-progress asynchronous worklet setup after Stop.
  let starting = false; // Shows initialization state before the worklet is ready.
  let lastError = ''; // Visible diagnostic when audio is unavailable or suspended.
  let validationError = ''; // Keeps invalid interval feedback visible until corrected.

  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (saved && (saved.unit === 'min' || saved.unit === 'sec') &&
        Number.isFinite(Number(saved.value)) && Number(saved.value) > 0) {
      const duration = Number(saved.value) * (saved.unit === 'min' ? 60 : 1);
      if (duration >= 1 && duration <= 3600) {
        valueInput.value = String(saved.value);
        unitInput.value = saved.unit;
      }
    }
  } catch (_) {}

  function durationSeconds() {
    const value = Number(valueInput.value);
    const result = value * (unitInput.value === 'min' ? 60 : 1);
    return valueInput.value.trim() && Number.isFinite(result) && result >= 1 && result <= 3600 ? result : null;
  }

  function showStatus() {
    if (lastError || validationError) { status.textContent = lastError || validationError; return; }
    if (!enabled.checked) { status.textContent = 'Off'; return; }
    if (starting || !node) { status.textContent = 'Starting audio…'; return; }
    if (context?.state !== 'running') {
      status.textContent = 'Audio suspended by browser — switch off and on to retry';
      return;
    }
    const elapsed = Math.max(0, context.currentTime - phaseStart);
    const remaining = Math.max(0, Math.ceil(seconds - (elapsed % seconds)));
    const minutes = Math.floor(remaining / 60);
    const secs = String(remaining % 60).padStart(2, '0');
    status.textContent = `Next chime in ${minutes}:${secs}`;
  }

  function stop() {
    generation++;
    starting = false;
    node?.port.postMessage({ type: 'stop' });
    node?.disconnect();
    node = null;
    const oldContext = context;
    context = null;
    if (oldContext) Promise.resolve(oldContext.close()).catch(() => {});
    showStatus();
  }

  async function start() {
    stop();
    lastError = '';
    seconds = durationSeconds();
    if (seconds == null) {
      enabled.checked = false;
      lastError = 'Enter an interval from 1 second to 60 minutes.';
      showStatus();
      return;
    }
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor || !window.AudioWorkletNode) {
      enabled.checked = false;
      lastError = 'Background audio requires Web AudioWorklet support.';
      showStatus();
      return;
    }
    const token = generation;
    starting = true;
    showStatus();
    let audio = null;
    try {
      audio = new AudioCtor();
      context = audio;
      if (!audio.audioWorklet?.addModule) throw new Error('AudioWorklet is unavailable in this browser.');
      // Resume immediately during the user's click/change gesture, before any await.
      const resumed = audio.resume();
      await Promise.all([resumed, audio.audioWorklet.addModule(PROCESSOR_URL)]);
      if (token !== generation || !enabled.checked) return;
      node = new window.AudioWorkletNode(audio, 'hobunji-cycle-chime', { outputChannelCount: [1] });
      node.connect(audio.destination);
      seconds = durationSeconds() || seconds;
      node.port.postMessage({ type: 'configure', seconds });
      phaseStart = audio.currentTime;
      starting = false;
      showStatus();
    } catch (error) {
      if (token === generation) {
        enabled.checked = false;
        lastError = `Chime unavailable: ${String(error?.message || error)}`;
        stop();
      }
    } finally {
      if (token !== generation && audio && audio !== context) {
        try { await audio.close(); } catch (_) {}
      }
      showStatus();
    }
  }

  function updateInterval() {
    const next = durationSeconds();
    valueInput.setCustomValidity(next == null ? 'Use 1 second to 60 minutes.' : '');
    validationError = next == null ? 'Enter an interval from 1 second to 60 minutes.' : '';
    if (next == null) { showStatus(); return; }
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ value: Number(valueInput.value), unit: unitInput.value }));
    } catch (_) {}
    seconds = next;
    if (node && context) {
      node.port.postMessage({ type: 'configure', seconds });
      phaseStart = context.currentTime; // Editing the interval starts a fresh cycle.
    }
    lastError = '';
    showStatus();
  }

  function playPreview() {
    if (node) { node.port.postMessage({ type: 'preview' }); return; }
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) {
      lastError = 'Web Audio is unavailable in this browser.';
      showStatus();
      return;
    }
    // This one-off audition needs no worklet and is activated by the Test button.
    let audio;
    try {
      audio = new AudioCtor();
      const resume = audio.resume();
      Promise.resolve(resume).catch(() => {});
      for (const [offset, frequency] of [[0, 880], [0.18, 1108.73]]) {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const at = audio.currentTime + offset;
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.2, at + 0.02);
        gain.gain.linearRampToValueAtTime(0, at + 0.14);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.15);
      }
      setTimeout(() => { audio.close().catch(() => {}); }, 700);
    } catch (error) {
      if (audio) audio.close().catch(() => {});
      lastError = `Test sound unavailable: ${String(error?.message || error)}`;
      showStatus();
    }
  }

  enabled.addEventListener('change', () => {
    if (enabled.checked) start();
    else { lastError = ''; stop(); }
  });
  valueInput.addEventListener('change', updateInterval);
  unitInput.addEventListener('change', updateInterval);
  preview.addEventListener('click', playPreview);
  window.addEventListener('pagehide', stop);
  // UI only. The audio processor, not this throttled timer, produces chimes.
  setInterval(showStatus, 500);
  window.DevCompanionCycleTimer = {
    getState: () => ({ enabled: enabled.checked, seconds, starting, audioState: context?.state || 'closed', error: lastError }),
  }; // Inspectable from the companion and paired with visible status for mobile debugging.
  showStatus();
})();

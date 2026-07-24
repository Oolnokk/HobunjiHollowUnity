// Generates the placeholder .wav files docs/game.js's playObjectSfx falls
// back to when a real recording (docs/assets/audio/sfx/{ui,processing}/
// sfx_*.mp3 — see docs/assets/audio/sfx/README.md) hasn't been sourced yet.
// Pure Node, no dependencies — run with `node scripts/generate-placeholder-sfx.js`
// any time this list changes to regenerate every file under
// docs/assets/audio/sfx/placeholders/. Output is deterministic (seeded
// PRNG), so re-running with no list changes produces byte-identical files.
'use strict';
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 22050;
const OUT_DIR = path.join(__dirname, '..', 'docs', 'assets', 'audio', 'sfx', 'placeholders');

function seconds(s) { return Math.round(s * SAMPLE_RATE); }

function writeWavFile(filePath, floatSamples) {
  const numSamples = floatSamples.length;
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate (mono, 16-bit)
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, floatSamples[i]));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
}

// Deterministic PRNG (xorshift32) so regenerating without list changes
// produces byte-identical output — easier to review in a diff than
// Math.random() would be.
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function silence(durS) { return new Float32Array(seconds(durS)); }

function concat(...arrs) {
  const total = arrs.reduce((sum, a) => sum + a.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const a of arrs) { out.set(a, offset); offset += a.length; }
  return out;
}

function mix(...arrs) {
  const len = Math.max(...arrs.map(a => a.length));
  const out = new Float32Array(len);
  for (const a of arrs) for (let i = 0; i < a.length; i++) out[i] += a[i];
  return out;
}

function normalize(samples, peak = 0.85) {
  let max = 0;
  for (const s of samples) max = Math.max(max, Math.abs(s));
  if (max <= 0.0001) return samples;
  const mul = peak / max;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * mul;
  return out;
}

// A tone sweeping from freqStart to freqEnd over durS, with an amplitude
// envelope from ampStart to ampEnd (curve>1 = decays slower at first, then
// falls off faster — a natural-feeling percussive tail).
function tone(freqStart, freqEnd, durS, { wave = 'sine', ampStart = 1, ampEnd = 0, curve = 2 } = {}) {
  const n = seconds(durS);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    const freq = freqStart + (freqEnd - freqStart) * t;
    phase += freq / SAMPLE_RATE;
    let s;
    if (wave === 'triangle') s = 2 * Math.abs(2 * (phase % 1) - 1) - 1;
    else if (wave === 'square') s = (phase % 1) < 0.5 ? 1 : -1;
    else s = Math.sin(2 * Math.PI * phase);
    out[i] = s * (ampStart + (ampEnd - ampStart) * Math.pow(t, curve));
  }
  return out;
}

// White noise shaped by a one-pole lowpass and/or highpass (rough but
// plenty distinct for a placeholder), with the same envelope shape as tone().
function noiseBurst(durS, { ampStart = 1, ampEnd = 0, curve = 1.5, seed = 1, lowpassHz = null, highpassHz = null } = {}) {
  const n = seconds(durS);
  const rng = makeRng(seed);
  const out = new Float32Array(n);
  const lpA = lowpassHz ? clamp01((2 * Math.PI * lowpassHz / SAMPLE_RATE)) : null;
  const hpA = highpassHz ? (1 / (1 + 2 * Math.PI * highpassHz / SAMPLE_RATE)) : null;
  let lp = 0, hpPrevOut = 0, hpPrevIn = 0;
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    let w = rng() * 2 - 1;
    if (lpA != null) { lp += lpA * (w - lp); w = lp; }
    if (hpA != null) { const hpOut = hpA * (hpPrevOut + w - hpPrevIn); hpPrevIn = w; hpPrevOut = hpOut; w = hpOut; }
    out[i] = w * (ampStart + (ampEnd - ampStart) * Math.pow(t, curve));
  }
  return out;
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

// ── The 11 placeholder cues (see audio.objectSfx in scratchbones-config.js) ──
const sounds = {};

// UI: a short, high, quiet tick — deliberately unobtrusive since it fires
// on every button press.
sounds.placeholder_ui_click = normalize(
  tone(1500, 900, 0.045, { wave: 'sine', ampStart: 0.9, ampEnd: 0, curve: 1.4 })
);

// UI: a short two-note descending buzz — generic "blocked/failed".
sounds.placeholder_ui_error = normalize(concat(
  tone(300, 280, 0.09, { wave: 'square', ampStart: 0.5, ampEnd: 0.3, curve: 1 }),
  silence(0.01),
  tone(190, 170, 0.13, { wave: 'square', ampStart: 0.5, ampEnd: 0, curve: 1.4 })
));

// Processing: two quick low clicks — a machine engaging/starting a batch.
sounds.placeholder_process_start = normalize(concat(
  tone(220, 140, 0.04, { wave: 'triangle', ampStart: 0.8, ampEnd: 0, curve: 1 }),
  silence(0.05),
  tone(260, 160, 0.05, { wave: 'triangle', ampStart: 0.9, ampEnd: 0, curve: 1 })
));

// Pestle, Squeezer, Hand Mill, Aging Barrel, and the farming "dig" cue all
// reuse the real grasstep/gravelstep/waterstep footstep recordings instead
// of a generated tone — see their placeholderUrls in scratchbones-config.js
// — a real recording pitched/volumed for the moment reads better than a
// from-scratch synth attempt at "mashing"/"grinding"/"digging".

// Drying rack: a gentle airy noise swell — soft, no percussive attack.
sounds.placeholder_process_dryingrack = normalize(
  noiseBurst(0.34, { ampStart: 0.15, ampEnd: 0, curve: 0.6, seed: 21, lowpassHz: 2600, highpassHz: 300 })
);

// Smoker: a soft hiss — high-passed noise, gentle rise then fall.
sounds.placeholder_process_smoker = normalize(concat(
  noiseBurst(0.12, { ampStart: 0.05, ampEnd: 0.5, curve: 0.7, seed: 31, highpassHz: 2200 }),
  noiseBurst(0.22, { ampStart: 0.5, ampEnd: 0, curve: 1.1, seed: 32, highpassHz: 2200 })
));

// Aging vase: a bright glassy clink — a tone plus a quiet harmonic overtone.
sounds.placeholder_process_agingvase = normalize(
  mix(
    tone(1600, 1500, 0.22, { ampStart: 0.7, ampEnd: 0, curve: 1.6 }),
    tone(2400, 2250, 0.16, { ampStart: 0.3, ampEnd: 0, curve: 1.6 })
  )
);

for (const [name, samples] of Object.entries(sounds)) {
  writeWavFile(path.join(OUT_DIR, name + '.wav'), samples);
}
console.log(`Wrote ${Object.keys(sounds).length} placeholder sfx to ${path.relative(process.cwd(), OUT_DIR)}/`);

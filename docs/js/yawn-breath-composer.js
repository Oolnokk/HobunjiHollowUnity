// Pitch-preserving yawn fallback: build a longer breath from natural, overlapping fragments.
// Only used by npc-yawn-rest's missing-recording fallback, never by animal/combat voices.
(() => {
  'use strict';

  function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
  function finite(value, fallback) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
  function smoother(t) { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); }

  function compose(channels, sampleRate, durationS, pitchRatio = 1, cadence = 1) {
    if (!Array.isArray(channels) || !channels.length || !channels[0]?.length) throw new Error('Yawn needs source PCM channels');
    const rate = finite(sampleRate, 0); // Sample rate sizes all authored breath regions.
    if (rate < 1000 || rate > 192000) throw new RangeError('Invalid yawn sample rate');
    const sourceLength = Math.min(...channels.map(channel => channel?.length || 0)); // Shared channel length prevents stereo drift.
    if (sourceLength < 32) throw new RangeError('Yawn breath is too short');
    const pitch = clamp(finite(pitchRatio, 1), 0.5, 2); // Target buffer compensates for native playback pitch transposition.
    const pace = clamp(finite(cadence, 1), 0.5, 2); // Species cadence changes fragment pacing, not the five-second visual duration.
    const outputLength = Math.max(128, Math.round(rate * clamp(finite(durationS, 5), 0.5, 8) * pitch));
    const outputs = channels.map(() => new Float32Array(outputLength)); // One synthesized channel per original channel.
    const weights = new Float32Array(outputLength); // Crossfade normalization prevents pumping at grain boundaries.
    const headLength = Math.max(32, Math.min(Math.round(sourceLength * 0.34), Math.round(rate * 0.38 * pitch), Math.floor(outputLength * 0.22)));
    const tailLength = Math.max(32, Math.min(Math.round(sourceLength * 0.34), Math.round(rate * 0.54 * pitch), Math.floor(outputLength * 0.22)));
    const transition = Math.max(8, Math.min(Math.round(rate * 0.10 * pitch), Math.floor(headLength / 2), Math.floor(tailLength / 2))); // Gentle swaps preserve the original inhale and exhale.
    const middleStart = headLength - transition; // The grain bed overlaps the natural start.
    const middleEnd = outputLength - tailLength + transition; // The grain bed overlaps the natural finish.
    const sourceStart = Math.floor(sourceLength * 0.23); // The steady-state middle of the original breath supplies texture.
    const sourceEnd = Math.max(sourceStart + 32, Math.floor(sourceLength * 0.77));
    const available = sourceEnd - sourceStart;
    const grainLength = Math.max(32, Math.min(available, Math.round(rate * 0.24 * pitch / pace))); // Short, non-periodic excerpts avoid a repeated long WSOLA cycle.
    const grainHop = Math.max(12, Math.round(grainLength * 0.38)); // Overlapping Hann-like grains keep the sustained part continuous.

    function add(sourceOffset, targetOffset, count, weightAt) {
      for (let index = 0; index < count; index++) {
        const destination = targetOffset + index;
        if (destination < 0 || destination >= outputLength) continue;
        const weight = weightAt(index, count);
        if (weight <= 0) continue;
        weights[destination] += weight;
        for (let channelIndex = 0; channelIndex < outputs.length; channelIndex++) {
          outputs[channelIndex][destination] += (Number(channels[channelIndex][sourceOffset + index]) || 0) * weight;
        }
      }
    }

    add(0, 0, headLength, (index) => {
      if (index < headLength - transition) return 1;
      return 1 - smoother((index - (headLength - transition)) / transition);
    });
    let grainIndex = 0; // Deterministic quasi-random source selections make cached yawns sound identical across reloads.
    for (let target = middleStart - Math.floor(grainLength / 2); target < middleEnd; target += grainHop) {
      const fraction = (grainIndex * 0.7548776662466927 + 0.41421356237) % 1;
      const offset = sourceStart + Math.floor(Math.max(0, available - grainLength) * fraction);
      add(offset, target, grainLength, (index, count) => {
        const x = (index + 0.5) / count;
        return Math.sin(Math.PI * x) ** 2;
      });
      grainIndex++;
    }
    add(sourceLength - tailLength, outputLength - tailLength, tailLength, (index) => {
      if (index >= transition) return 1;
      return smoother(index / transition);
    });

    for (let index = 0; index < outputLength; index++) {
      const phase = index / Math.max(1, outputLength - 1);
      const fadeIn = smoother(index / Math.max(1, Math.round(rate * 0.025 * pitch)));
      const fadeOut = smoother((outputLength - index - 1) / Math.max(1, Math.round(rate * 0.11 * pitch)));
      const swell = 0.64 + 0.36 * Math.sin(Math.PI * phase); // Long, gentle volume arc replaces repetitive tempo modulation.
      const multiplier = Math.min(fadeIn, fadeOut) * swell / Math.max(0.00001, weights[index]);
      for (const channel of outputs) channel[index] *= multiplier;
    }
    return outputs;
  }

  window.YawnBreathComposer = { version: 1, compose }; // The shared renderer opts in only for a missing yawn recording.
})();
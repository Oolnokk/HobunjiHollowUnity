// Web Audio's render thread owns the repeating chime schedule. Unlike window
// timers, its sample clock continues while the companion window is unfocused.
class HobunjiCycleChimeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.framesPerCycle = Math.round(sampleRate * 300); // Duration between chimes, supplied by the companion controls.
    this.framesRemaining = this.framesPerCycle; // Counts audio frames, not throttled browser timeouts.
    this.chimeFrame = -1; // Nonnegative while one two-note chime is sounding.
    this.enabled = false; // Set by the companion's Start/Stop control.
    this.port.onmessage = event => {
      const message = event.data || {};
      if (message.type === 'configure') {
        const seconds = Number(message.seconds);
        if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600) return;
        this.framesPerCycle = Math.round(sampleRate * seconds);
        this.framesRemaining = this.framesPerCycle;
        this.chimeFrame = -1;
        this.enabled = true;
      } else if (message.type === 'stop') {
        this.enabled = false;
        this.chimeFrame = -1;
      } else if (message.type === 'preview') {
        this.chimeFrame = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const channels = outputs[0];
    if (!channels?.length) return true;
    const samples = channels[0];
    for (let i = 0; i < samples.length; i++) {
      if (this.enabled && --this.framesRemaining <= 0) {
        this.framesRemaining = this.framesPerCycle;
        this.chimeFrame = 0;
      }
      let value = 0;
      if (this.chimeFrame >= 0) {
        const time = this.chimeFrame++ / sampleRate;
        const first = time < 0.14;
        const secondTime = time - 0.18;
        if (first || (secondTime >= 0 && secondTime < 0.14)) {
          const noteTime = first ? time : secondTime;
          const envelope = Math.sin(Math.PI * noteTime / 0.14);
          value = 0.2 * envelope * Math.sin(2 * Math.PI * (first ? 880 : 1108.73) * noteTime);
        }
        if (time >= 0.34) this.chimeFrame = -1;
      }
      samples[i] = value;
    }
    for (let i = 1; i < channels.length; i++) channels[i].set(samples);
    return true; // Keep processing audio even when the window loses focus.
  }
}

registerProcessor('hobunji-cycle-chime', HobunjiCycleChimeProcessor);

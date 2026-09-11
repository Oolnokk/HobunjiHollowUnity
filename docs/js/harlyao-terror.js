(() => {
  'use strict';

  const CONFIG_URL = 'config/harlyao-night-march.json'; // Shared tuning keeps Terror locked to the same soundtrack distance stages.
  const SOURCE_ID = 'harlyao-terror'; // Stable EffectBuffBar provider id.
  const FALLBACK_MAX_STACKS = 6; // Mirrors the six authored music distance bands until config is ready.

  let config = null; // Parsed march config used for stack effect strengths and HUD copy.
  let stacks = 0; // Cached Terror stack count; changed only on the slow proximity/HUD cadence.
  let stageIndex = -1; // Cached soundtrack stage that produced the current stack count.
  let maxStacks = FALLBACK_MAX_STACKS; // Number of music stages, used for inverse stage→stack mapping and lantern scaling.
  let lastSampleAt = 0; // performance.now timestamp of the latest cached-music sample.
  let samples = 0; // Mobile diagnostics count slow samples rather than frames.
  let buffRegistered = false; // Prevents duplicate EffectBuffBar providers.
  let combatPatched = false; // Tracks composition into on-foot movement's existing Combat speed multiplier.
  let mountsPatched = false; // Tracks composition into mounted movement's injected alchemy-speed hook.

  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

  async function loadConfig() {
    if (config) return config;
    try {
      const response = await fetch(CONFIG_URL); // Browser cache shares this JSON with the march/music/atmosphere modules.
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      config = await response.json();
      maxStacks = Math.max(1, config?.music?.stages?.length || FALLBACK_MAX_STACKS);
      return config;
    } catch (error) {
      window.__farmLog?.(`[harlyao-terror] config load failed: ${error.message}`, 'warn', 'wildlife');
      return null;
    }
  }

  function movementMultiplierFor(stackCount = stacks) {
    const slowPerStack = Math.max(0, Number(config?.terror?.movementSlowPerStack) || 0.03); // Each nearby stage trims ordinary movement by a small multiplicative amount.
    return clamp(1 - Math.max(0, stackCount) * slowPerStack, 0.35, 1);
  }

  function darknessAlphaFor(stackCount = stacks) {
    const perStack = Math.max(0, Number(config?.terror?.darknessAlphaPerStack) || 0.045); // Added only to unlit regions by the atmosphere adapter.
    const maxAlpha = clamp(Number(config?.terror?.maxDarknessAlpha) || 0.27, 0, 0.8);
    return clamp(Math.max(0, stackCount) * perStack, 0, maxAlpha);
  }

  function lanternRadiusMultiplierFor(stackCount = stacks) {
    if (stackCount <= 0) return 1;
    const minimum = clamp(Number(config?.terror?.lanternRadiusMinMultiplier) || 0.5, 0.1, 1); // Maximum Terror reaches exactly half the configured lantern radius by default.
    const fraction = clamp(stackCount / Math.max(1, maxStacks), 0, 1);
    return 1 - (1 - minimum) * fraction;
  }

  function stacksForStage(index, count = maxStacks) {
    if (!Number.isFinite(Number(index)) || index < 0) return 0;
    return clamp(Math.max(1, count - Math.floor(index)), 1, count); // Loudest/nearest stage 0→max stacks; faintest/farthest stage→1.
  }

  function effectEntry() {
    if (stacks <= 0) return [];
    return [{
      key: 'terror',
      label: config?.terror?.label || 'Terror',
      icon: config?.terror?.icon || '◉',
      kind: 'bane',
      sourceLabel: 'Harlyao Presence',
      stacks,
      durationS: 1,
      remainingS: 1,
    }]; // Persistent environmental debuff uses a full bar while the cached stage remains active.
  }

  function registerBuffProvider() {
    if (buffRegistered) return true;
    if (!window.EffectBuffBar?.registerProvider) return false;
    buffRegistered = !!window.EffectBuffBar.registerProvider(SOURCE_ID, effectEntry);
    return buffRegistered;
  }

  function patchCombat() {
    const api = window.Combat;
    if (combatPatched || api?.getMovementSpeedMul?.__harlyaoTerrorWrapped) { combatPatched = true; return true; }
    if (!api?.getMovementSpeedMul) return false;
    const original = api.getMovementSpeedMul.bind(api); // Preserves Blink Dodge/Flurry and any other movement ability multiplier.
    const wrapped = function harlyaoTerrorMovementSpeedMul() {
      return original() * movementMultiplierFor();
    };
    wrapped.__harlyaoTerrorWrapped = true;
    api.getMovementSpeedMul = wrapped;
    combatPatched = true;
    return true;
  }

  function patchMounts() {
    const api = window.Mounts;
    if (mountsPatched || api?.init?.__harlyaoTerrorWrapped) { mountsPatched = true; return true; }
    if (!api?.init) return false;
    const original = api.init; // game.js calls this after parser-time modules are loaded, so the composed dependency is installed before riding starts.
    const wrapped = function harlyaoTerrorMountInit(injected) {
      const proxy = Object.create(injected || null); // Leaves every mount dependency untouched except its existing speed multiplier source.
      const baseAlchemySpeed = typeof injected?.getAlchemySpeedMul === 'function'
        ? injected.getAlchemySpeedMul.bind(injected)
        : () => 1;
      proxy.getAlchemySpeedMul = () => baseAlchemySpeed() * movementMultiplierFor();
      return original.call(this, proxy);
    };
    wrapped.__harlyaoTerrorWrapped = true;
    api.init = wrapped;
    mountsPatched = true;
    return true;
  }

  function applyStage(index, active) {
    const nextStage = active && Number.isFinite(Number(index)) ? Math.floor(Number(index)) : -1;
    const nextStacks = active ? stacksForStage(nextStage) : 0;
    const changed = nextStage !== stageIndex || nextStacks !== stacks;
    stageIndex = nextStage;
    stacks = nextStacks;
    if (changed) window.EffectBuffBar?.refresh?.(true);
  }

  function sampleCachedProximity() {
    const music = window.HarlyaoNightMarchMusic?.debugSnapshot?.(); // Reads the music module's throttled cached distance; never performs a second distance calculation here.
    const active = !!music?.active && Number.isFinite(Number(music?.stageIndex)) && Number(music.stageIndex) >= 0;
    applyStage(active ? Number(music.stageIndex) : -1, active);
    lastSampleAt = performance.now();
    samples++;
  }

  function install() {
    const ready = [registerBuffProvider(), patchCombat(), patchMounts()];
    return ready.every(Boolean);
  }

  function debugSnapshot() {
    return {
      configReady: !!config,
      stacks,
      maxStacks,
      stageIndex,
      movementMultiplier: movementMultiplierFor(),
      darknessAlpha: darknessAlphaFor(),
      lanternRadiusMultiplier: lanternRadiusMultiplierFor(),
      buffRegistered,
      combatPatched,
      mountsPatched,
      samples,
      lastSampleAt,
    };
  }

  window.HarlyaoTerror = Object.freeze({
    loadConfig,
    sampleCachedProximity,
    getStacks: () => stacks,
    getMovementMultiplier: movementMultiplierFor,
    getDarknessAlpha: darknessAlphaFor,
    getLanternRadiusMultiplier: lanternRadiusMultiplierFor,
    debugSnapshot,
    formatDebug: () => {
      const data = debugSnapshot();
      return `Terror: stacks=${data.stacks}/${data.maxStacks} stage=${data.stageIndex} move=${data.movementMultiplier.toFixed(3)} dark=${data.darknessAlpha.toFixed(3)} lantern=${data.lanternRadiusMultiplier.toFixed(3)} samples=${data.samples}`;
    },
    __test: Object.freeze({ stacksForStage, movementMultiplierFor, darknessAlphaFor, lanternRadiusMultiplierFor }),
  });

  loadConfig();
  install();
  sampleCachedProximity();
  if (typeof window.setInterval === 'function') {
    const cadence = () => Math.max(250, Number(config?.terror?.hudRefreshMs) || 500); // Slow environmental/HUD cadence; no frame-based proximity work.
    let lastTick = performance.now(); // Used to support live config cadence without creating/replacing timers.
    window.setInterval(() => {
      const now = performance.now();
      install();
      if (now - lastTick < cadence()) return;
      lastTick = now;
      sampleCachedProximity();
    }, 250);
  }
})();

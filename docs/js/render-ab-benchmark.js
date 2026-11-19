// On-device render A/B benchmark (window.RenderABBenchmark).
//
// Headless measurements cannot say how fast a real phone/GPU is. This runs the
// live game in interleaved windows per variant and reports real frame
// intervals and render JS time for each, on the device that matters:
//   default        everything as shipped
//   frameScopeOff  RenderHooks 'frame' hooks run on every render call again
//   outlinesOff    no outline passes (shell, PNG depth, composite)
// Stand still in the view you care about while it runs (~18 s).
//
//   RenderABBenchmark.run({ rounds, framesPerWindow }) -> Promise<report>
//   RenderABBenchmark.lastReport() / .lastText()
// Also: Settings → Dev Tools → "Render A/B benchmark" (copies the text report),
// and the Dev Companion command 'render-ab-benchmark'.
(() => {
  'use strict';

  if (window.RenderABBenchmark) return;

  let running = false;
  let lastReport = null;
  let lastText = '';

  const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

  function percentile(values, p) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  }

  async function measureWindow(frames, renderTimes) {
    const intervals = [];
    renderTimes.length = 0;
    let previous = await nextFrame();
    for (let i = 0; i < frames; i++) {
      const now = await nextFrame();
      intervals.push(now - previous);
      previous = now;
    }
    const renderMs = renderTimes.length ? renderTimes.reduce((a, b) => a + b, 0) / renderTimes.length : 0;
    return { intervals, renderMs };
  }

  async function run(options = {}) {
    if (running) throw new Error('Render A/B benchmark already running.');
    const hooks = window.RenderHooks;
    const pipeline = window.WorldRenderPipeline;
    if (!hooks?.setFrameScopeEnabled || !pipeline?.renderFrame) throw new Error('RenderHooks / WorldRenderPipeline not loaded.');
    const rounds = Math.max(1, Math.min(10, Number(options.rounds) || 3));
    const framesPerWindow = Math.max(20, Math.min(600, Number(options.framesPerWindow) || 90));
    const warmupFrames = 15;
    running = true;
    const originalRenderFrame = pipeline.renderFrame;
    const renderTimes = [];
    pipeline.renderFrame = function timedRenderFrame(now) {
      const start = performance.now();
      try { return originalRenderFrame.call(this, now); }
      finally { renderTimes.push(performance.now() - start); }
    };
    const debug = window.__hobunjiFurnitureDebug;
    const outlinesBefore = debug && 'outlinesSetting' in debug ? debug.outlinesSetting : null;
    const variants = [
      { id: 'default', apply() {}, undo() {} },
      { id: 'frameScopeOff', apply: () => hooks.setFrameScopeEnabled(false), undo: () => hooks.setFrameScopeEnabled(true) },
    ];
    if (typeof debug?.setOutlines === 'function' && outlinesBefore === true) {
      variants.push({ id: 'outlinesOff', apply: () => debug.setOutlines(false), undo: () => debug.setOutlines(true) });
    }
    const results = {};
    for (const variant of variants) results[variant.id] = { intervals: [], render: [] };
    try {
      for (let round = 0; round < rounds; round++) {
        // Rotate the order each round so thermal/background drift hits every variant equally.
        const order = variants.map((_, i) => variants[(i + round) % variants.length]);
        for (const variant of order) {
          variant.apply();
          try {
            for (let i = 0; i < warmupFrames; i++) await nextFrame();
            const sample = await measureWindow(framesPerWindow, renderTimes);
            results[variant.id].intervals.push(...sample.intervals);
            results[variant.id].render.push(sample.renderMs);
          } finally {
            variant.undo();
          }
        }
      }
    } finally {
      hooks.setFrameScopeEnabled(true);
      if (outlinesBefore !== null && typeof debug?.setOutlines === 'function') debug.setOutlines(outlinesBefore);
      pipeline.renderFrame = originalRenderFrame;
      running = false;
    }
    const summarize = data => {
      const mean = data.intervals.reduce((a, b) => a + b, 0) / Math.max(1, data.intervals.length);
      return {
        frames: data.intervals.length,
        avgFrameMs: Number(mean.toFixed(2)),
        p90FrameMs: Number(percentile(data.intervals, 0.9).toFixed(2)),
        fps: Number((1000 / Math.max(0.001, mean)).toFixed(1)),
        renderJsMs: Number((data.render.reduce((a, b) => a + b, 0) / Math.max(1, data.render.length)).toFixed(2)),
      };
    };
    const area = window.__hobunjiFurnitureDebug?.currentArea?.() || window.GridTileAccessors?.getCurrentArea?.() || null;
    const renderer = window.__hobunjiGameRenderer;
    const gl = renderer?.getContext?.();
    lastReport = {
      at: new Date().toISOString(),
      area,
      variants: Object.fromEntries(Object.entries(results).map(([id, data]) => [id, summarize(data)])),
      rounds,
      framesPerWindow,
      device: {
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio,
        drawingBuffer: gl ? [gl.drawingBufferWidth, gl.drawingBufferHeight] : null,
      },
      lastFrame: pipeline.snapshot?.().lastFrame || null,
      characters: area && window.CharacterVisuals ? window.CharacterVisuals.audit(area).characters : null,
    };
    lastText = [
      `Render A/B benchmark — ${lastReport.at} — area ${area}`,
      ...Object.entries(lastReport.variants).map(([id, v]) => `${id.padEnd(14)}: ${v.fps} fps (avg ${v.avgFrameMs} ms, p90 ${v.p90FrameMs} ms), render JS ${v.renderJsMs} ms/frame`),
      `native renders/frame ${lastReport.lastFrame?.nativeRenders ?? '?'}, buffer ${lastReport.device.drawingBuffer?.join('x') ?? '?'} @ dpr ${lastReport.device.devicePixelRatio}`,
      `characters ${JSON.stringify(Object.fromEntries(Object.entries(lastReport.characters || {}).filter(([, n]) => n)))}`,
      `${rounds} rounds x ${framesPerWindow} frames per mode; ${navigator.userAgent}`,
    ].join('\n');
    return lastReport;
  }

  function installSettingsRow() {
    if (document.getElementById('renderAbBenchmarkBtn')) return true;
    const anchor = document.getElementById('devTeleportArenaBtn')?.closest('.settings-row');
    if (!anchor) return false;
    const row = document.createElement('div');
    row.className = 'settings-row';
    row.setAttribute('data-dev-only', '');
    const label = document.createElement('div');
    label.className = 'settings-label';
    const name = document.createElement('div');
    name.className = 'settings-name';
    name.textContent = 'Render A/B benchmark';
    const desc = document.createElement('div');
    desc.className = 'settings-desc';
    desc.textContent = 'Stand still and close the menu: measures this device for ~18 s (as shipped, render hooks per pass, outlines off), then copies fps and render time per variant.';
    label.append(name, desc);
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'renderAbBenchmarkBtn';
    button.className = 'settings-small-btn';
    button.textContent = 'Run';
    button.addEventListener('click', async () => {
      if (running) return;
      button.textContent = 'Running…';
      try {
        await new Promise(resolve => setTimeout(resolve, 1500)); // Time to close the menu.
        await run();
        try { await navigator.clipboard?.writeText?.(lastText); button.textContent = 'Copied'; }
        catch (_) { button.textContent = 'Done'; }
        window.__farmLog?.(lastText, 'info');
      } catch (error) {
        button.textContent = 'Failed';
        window.__farmLog?.(`[RenderABBenchmark] ${error?.message || error}`, 'warn');
      }
      setTimeout(() => { button.textContent = 'Run'; }, 4000);
    });
    row.append(label, button);
    anchor.insertAdjacentElement('afterend', row);
    return true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installSettingsRow, { once: true });
  else installSettingsRow();

  window.DevCompanion?.registerCommand?.('render-ab-benchmark', options => run(options).then(() => ({ report: lastReport, text: lastText })));

  window.RenderABBenchmark = Object.freeze({
    run,
    isRunning: () => running,
    lastReport: () => lastReport,
    lastText: () => lastText,
  });
})();

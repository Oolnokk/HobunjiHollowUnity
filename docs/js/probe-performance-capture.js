// Bounded gameplay timing window for Pixel Probe. Uses existing PerfProfiler
// brackets, not browser stack sampling, forced GPU sync, or another frame loop.
(() => {
  'use strict';
  if (window.ProbePerformanceCapture) return;
  const MAX_MS = 20000, MAX_FRAMES = 1200, MAX_KEYS = 192; // Hard session bounds.
  let session = null, lastReport = null; // At most one short capture and its finished report.
  const clock = () => performance.now();
  const round = n => Math.round(n * 1000) / 1000;
  function add(map, key, elapsed, draws = 0, triangles = 0, matrixMs = 0, matrixCalls = 0) {
    let item = map.get(key);
    if (!item) {
      if (map.size >= MAX_KEYS) key = '(other labels)';
      item = map.get(key);
      if (!item) map.set(key, item = { calls: 0, totalMs: 0, maxMs: 0, draws: 0, triangles: 0, matrixMs: 0, matrixCalls: 0 });
    }
    item.calls++; item.totalMs += elapsed; item.maxMs = Math.max(item.maxMs, elapsed);
    item.draws += draws; item.triangles += triangles;
    item.matrixMs += matrixMs; item.matrixCalls += matrixCalls;
  }
  function merge(target, source) {
    for (const [key, item] of source) {
      let k = key;
      if (!target.has(k) && target.size >= MAX_KEYS) k = '(other labels)';
      let dest = target.get(k);
      if (!dest) target.set(k, dest = { calls: 0, totalMs: 0, maxMs: 0, draws: 0, triangles: 0, matrixMs: 0, matrixCalls: 0 });
      dest.calls += item.calls; dest.totalMs += item.totalMs; dest.maxMs = Math.max(dest.maxMs, item.maxMs);
      dest.draws += item.draws; dest.triangles += item.triangles; dest.matrixMs += item.matrixMs; dest.matrixCalls += item.matrixCalls;
    }
  }
  function distribution(values) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a,b) => a-b); // Only at finish, never during recording.
    return { count: sorted.length, meanMs: round(values.reduce((s,n) => s+n,0)/values.length),
      p50Ms: round(sorted[Math.ceil(sorted.length*.5)-1]), p90Ms: round(sorted[Math.ceil(sorted.length*.9)-1]),
      p99Ms: round(sorted[Math.ceil(sorted.length*.99)-1]), maxMs: round(sorted[sorted.length-1]) };
  }
  function rows(map, frames, native = false) {
    return [...map].sort((a,b) => b[1].totalMs-a[1].totalMs).map(([name,x]) => ({
      name, calls: x.calls, callsPerFrame: round(x.calls/frames), msPerFrame: round(x.totalMs/frames),
      msPerCall: round(x.totalMs/x.calls), maxCallMs: round(x.maxMs),
      ...(native ? { drawsPerFrame: round(x.draws/frames), trianglesPerFrame: round(x.triangles/frames),
        sceneMatrixMsPerFrame: round(x.matrixMs/frames), sceneMatrixCalls: x.matrixCalls } : {}),
    }));
  }
  function finish(reason = 'tap') {
    const s = session;
    if (!s) return lastReport;
    session = null;
    s.off?.(); // Only called from a scheduler boundary or UI event, never from a render hook.
    s.schedulerOff?.();
    const frames = s.loops.length, denominator = Math.max(1, frames);
    const gaps = distribution(s.gaps);
    lastReport = {
      version: 1, reason, areaAtArm: s.area, areas: [...s.areas], elapsedMs: round(clock()-s.started),
      completeFrames: frames, discardedWarmupFrames: s.warmed ? 1 : 0, interruptedFrames: s.interrupted + (s.frame ? 1 : 0), skippedNonWorldFrames: s.nonWorld,
      schedulerBoundaryAvailable: !!s.schedulerOff, sampledIntervalMs: round(s.gaps.reduce((a,b)=>a+b,0)),
      fps: gaps?.meanMs > 0 ? round(1000/gaps.meanMs) : null, frameIntervals: gaps,
      gameLoop: distribution(s.loops), schedulerFrame: distribution(s.schedulerFrames), nativeHookAvailable: s.hookAvailable,
      subsystems: rows(s.buckets, denominator), nativePasses: rows(s.passes, denominator, true),
      nativeMatrixWrapFailures: s.matrixFailures,
      notes: 'Wall-clock CPU submission timings, not GPU execution or stack samples. Inclusive subsystem buckets overlap; scheduler pre-render is inside the driver. Frame intervals include browser scheduling/wait. First completed frame excluded (one-shot census/warmup). Frames without world rendering or failed drivers excluded. Native counts are renderer.info at submission end; nested submissions are not separately timed. Mixed areas are not a controlled comparison.',
    };
    return lastReport;
  }
  function cancel() {
    const s = session; session = null; lastReport = null;
    s?.off?.();
    s?.schedulerOff?.();
  }
  function start(area) {
    cancel();
    const s = session = { area, started: clock(), frame: null, warmed: false, interrupted: 0,
      areas: new Set(), loops: [], gaps: [], schedulerFrames: [], previousStart: null, buckets: new Map(), passes: new Map(),
      off: null, schedulerOff: null, hookAvailable: false, matrixFailures: 0, nonWorld: 0 };
    s.schedulerOff = window.RuntimeFrameScheduler?.registerTimingObserver?.({
      beginFrame(timestamp) { if (session === s) openFrame(s,timestamp); },
      subscriber(id,phase,ms) {
        if (session === s && s.frame) add(s.frame.buckets,'scheduler: '+phase+'/'+id,ms);
      },
      driver(ms,completed) {
        if (session === s && s.frame) { s.frame.driverMs=ms; s.frame.driverCompleted=completed; }
      },
      endFrame() {
        if (session === s && s.frame) closeFrame(s,s.frame.driverMs,s.frame.driverCompleted);
      },
    }) || null;
    const hooks = window.RenderHooks;
    if (typeof hooks?.register === 'function') {
      s.off = hooks.register({
        id: 'pixel-probe-performance-window', owner: 'probe-performance-capture.js', order: 1000000010,
        appliesTo: ctx => session === s && !!s.frame && !!ctx.frame && ctx.depth === 0,
        before(ctx) {
          const scene = ctx.scene, frame = s.frame;
          const mask = Number(ctx.camera?.layers?.mask) >>> 0;
          const layer = window.HobunjiRenderLayers?.describe?.(mask) || String(mask);
          const pass = window.WorldRenderPipeline?.currentPass?.() || 'unknown';
          const state = { frame, key: pass + '/' + (ctx.worldScene ? 'world' : 'aux') + '/' + layer,
            start: 0, matrixMs: 0, matrixCalls: 0, restore: null };
          // Instrument only this scene instance during this submission, AFTER
          // the existing static-wall walk hook. Preserve its exact method and
          // property descriptor; no global Three/renderer override.
          if (ctx.worldScene && scene?.autoUpdate === true && typeof scene.updateMatrixWorld === 'function') {
            const own = Object.getOwnPropertyDescriptor(scene,'updateMatrixWorld');
            const previous = scene.updateMatrixWorld;
            const timed = function (...args) {
              const t = clock();
              try { return previous.apply(this,args); }
              finally { state.matrixMs += clock()-t; state.matrixCalls++; }
            };
            try {
              scene.updateMatrixWorld = timed;
              if (scene.updateMatrixWorld === timed) state.restore = () => {
                if (scene.updateMatrixWorld !== timed) return; // A later authoritative writer wins.
                if (own) Object.defineProperty(scene,'updateMatrixWorld',own);
                else delete scene.updateMatrixWorld;
              };
              else s.matrixFailures++;
            } catch (_) { s.matrixFailures++; }
          }
          state.start = clock();
          return state;
        },
        afterRender(ctx,state) {
          if (!state || session !== s || s.frame !== state.frame) return;
          const info = ctx.renderer?.info?.render;
          add(state.frame.passes,state.key,Math.max(0,clock()-state.start),Number(info?.calls)||0,
            Number(info?.triangles)||0,state.matrixMs,state.matrixCalls);
        },
        after(_ctx,state) { state?.restore?.(); },
      });
      s.hookAvailable = true;
    }
    return true;
  }
  function openFrame(s,timestamp) {
    if (clock()-s.started >= MAX_MS || s.loops.length >= MAX_FRAMES) { finish('limit'); return; }
    if (s.frame) { s.interrupted++; s.previousStart = null; }
    s.frame = { start: Number.isFinite(timestamp) ? timestamp : clock(), cpuStart: clock(),
      buckets: new Map(), passes: new Map(), area: null, driverMs: 0, driverCompleted: false };
  }
  function closeFrame(s,driverMs,completed) {
    const frame = s.frame;
    if (!frame) return;
    s.frame = null;
    if (!completed || !Number.isFinite(driverMs)) { s.interrupted++; s.previousStart=null; return; }
    if (frame.area == null) { s.nonWorld++; s.previousStart=null; return; }
    if (!s.warmed) { s.warmed=true; s.previousStart=frame.start; return; }
    if (s.previousStart !== null && frame.start > s.previousStart) s.gaps.push(frame.start-s.previousStart);
    s.previousStart=frame.start;
    s.loops.push(driverMs);
    s.schedulerFrames.push(Math.max(0,clock()-frame.cpuStart));
    s.areas.add(frame.area);
    merge(s.buckets,frame.buckets); merge(s.passes,frame.passes);
    if (clock()-s.started >= MAX_MS || s.loops.length >= MAX_FRAMES) finish('limit');
  }
  function beginTiming(name) {
    const s = session;
    if (!s) return null;
    // Older isolated hosts can still use the existing gameLoop bracket.
    if (!s.schedulerOff && name === 'gameLoop total') openFrame(s,clock());
    return session === s ? s.frame : null;
  }
  function recordTiming(frame,name,elapsed) {
    const s = session;
    if (!s || !frame || s.frame !== frame || !Number.isFinite(elapsed) || elapsed < 0) return;
    add(frame.buckets,name,elapsed);
    if (!s.schedulerOff && name === 'gameLoop total') closeFrame(s,elapsed,true);
  }
  window.ProbePerformanceCapture = Object.freeze({
    start, finish, cancel, beginTiming, recordTiming,
    markArea(area) { if (session?.frame) session.frame.area = area; },
    recordDirect(name,ms) { if (session?.frame && name !== 'gameLoop total') recordTiming(session.frame,name,ms); },
    get active() { return !!session; },
  });
})();

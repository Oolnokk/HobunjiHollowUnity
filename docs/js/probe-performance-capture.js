// Bounded gameplay timing window for Pixel Probe. Uses existing PerfProfiler
// brackets, not browser stack sampling, forced GPU sync, or another frame loop.
(() => {
  'use strict';
  if (window.ProbePerformanceCapture) return;
  const MAX_MS = 20000, MAX_FRAMES = 1200, MAX_KEYS = 192; // Hard session bounds.
  const MAX_SLOW = 12, MAX_EVENTS = 24; // Bound slow-frame, browser and visibility details.
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
  function keepLargest(list, item, key) {
    if (list.length >= MAX_SLOW && item[key] <= list[list.length-1][key]) return;
    list.push(item);
    list.sort((a,b)=>b[key]-a[key]);
    if (list.length > MAX_SLOW) list.pop();
  }
  function biggestBuckets(map) {
    return [...map].sort((a,b)=>b[1].totalMs-a[1].totalMs).slice(0,6)
      .map(([name,x])=>({name,ms:round(x.totalMs),maxCallMs:round(x.maxMs)}));
  }
  function pageState() {
    return { visibility: typeof document !== 'undefined' ? document.visibilityState || 'unknown' : 'unknown',
      focused: typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? document.hasFocus() : null };
  }
  function shortSource(url) {
    const clean = String(url || '').split(/[?#]/)[0]; // Do not retain URLs' query strings or fragments.
    return (clean.includes('/docs/') ? clean.slice(clean.lastIndexOf('/docs/')+6) : clean.split('/').pop() || 'unattributed').slice(0,160);
  }
  function observeBrowser(s) {
    const browser = s.browser;
    for (const type of ['longtask','long-animation-frame']) {
      const summary = browser[type]; // One bounded observer summary per supported entry type.
      function ingest(entries) {
        for (const entry of entries || []) {
          const start = Number(entry.startTime), duration = Number(entry.duration);
          if (!Number.isFinite(start) || !Number.isFinite(duration) || duration < 0 ||
              start < s.started || start+duration > (s.stoppedAt ?? clock())) continue;
          summary.count++; summary.totalMs += duration;
          const detail = { atMs:round(start-s.started), durationMs:round(duration) };
          if (type === 'long-animation-frame') {
            const style = Number(entry.styleAndLayoutStart);
            detail.blockingMs = round(Number(entry.blockingDuration)||0);
            detail.styleToEndMs = style > 0 && style >= start && style <= start+duration ? round(start+duration-style) : null;
            detail.scripts = Array.from(entry.scripts || []).sort((a,b)=>(Number(b.duration)||0)-(Number(a.duration)||0)).slice(0,5)
              .map(script=>({source:shortSource(script.sourceURL),functionName:String(script.sourceFunctionName||'').slice(0,100),
                invokerType:String(script.invokerType||'').slice(0,80),durationMs:round(Number(script.duration)||0),
                forcedLayoutMs:round(Number(script.forcedStyleAndLayoutDuration)||0)}));
          } else {
            detail.name=String(entry.name||'').slice(0,80);
            detail.attribution=Array.from(entry.attribution||[]).slice(0,3).map(a=>({name:String(a.name||'').slice(0,80),containerType:String(a.containerType||'').slice(0,80)}));
          }
          keepLargest(summary.worst,detail,'durationMs');
        }
      }
      let observer;
      try {
        const Observer = window.PerformanceObserver;
        if (typeof Observer !== 'function' || (Array.isArray(Observer.supportedEntryTypes) && !Observer.supportedEntryTypes.includes(type))) continue;
        observer = new Observer(list=>{ if(session===s) ingest(list.getEntries()); });
        observer.observe({type,buffered:false});
        summary.supported=true;
        s.browserStops.push(()=>{try{ingest(observer.takeRecords?.());}finally{observer.disconnect();}});
      } catch (_) { observer?.disconnect?.(); }
    }
    const note = event => {
      if (session!==s || browser.pageEvents.length>=MAX_EVENTS) return;
      browser.pageEvents.push({atMs:round(clock()-s.started),event:event.type,...pageState()});
    };
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange',note);
      s.browserStops.push(()=>document.removeEventListener?.('visibilitychange',note));
    }
    if (window.addEventListener) {
      window.addEventListener('blur',note);window.addEventListener('focus',note);
      s.browserStops.push(()=>{window.removeEventListener?.('blur',note);window.removeEventListener?.('focus',note);});
    }
  }
  function stopBrowser(s) {
    for (const stop of s.browserStops) { try { stop(); } catch (_) {} }
    s.browserStops.length=0;
  }
  function counters() {
    // Explicit start/end only. Never flush classification or perform a scene scan.
    const result = {};
    for (const [name, read] of [
      ['sceneLoad', () => window.SceneLoadSummary?.summary?.()], // Hostiles by state/distance at window start and end, so recordings are comparable.
      ['npcPathing', () => window.NpcPathfinding?.debugSnapshot?.()], // Searches and expanded nodes inside the window attribute NPC-walker spikes.
      ['pixelJobs', () => window.PixelWorkYield?.getDebug?.()],
      ['fishProfiles', () => window.FishCatalog?.getPixelDebug?.()],
      ['heldReplay', () => window.HeldObjectRenderOrder?.performanceCounters?.()],
      ['staticWall', () => window.DenseForestWallBatches?.staticMatrixSnapshot?.()],
      ['staticTree', () => window.FoliageGenerator?.identityTreeMatrixStats?.()],
      ['propBatches', () => window.ZonePropRenderBatches?.snapshot?.()],
      ['instanceRegistry', () => window.InstancedMeshBounds?.snapshot?.()],
    ]) {
      try {
        const data = read();
        if (data) result[name] = Object.fromEntries(Object.entries(data).filter(([,v])=>typeof v==='boolean'||Number.isFinite(v)));
      } catch (_) {} // A missing diagnostic owner must not prevent a capture.
    }
    return result;
  }
  function counterChanges(before,after) {
    const result = {};
    for (const [group, values] of Object.entries(after)) {
      const changes = {};
      for (const [name, value] of Object.entries(values)) {
        const prior = before[group]?.[name];
        if (typeof value==='number' && typeof prior==='number') changes[name] = value-prior;
      }
      result[group] = changes;
    }
    return result;
  }
  function finish(reason = 'tap') {
    const s = session;
    if (!s) return lastReport;
    s.stoppedAt=clock(); // Drain browser observations before any pixel-probe work.
    session = null;
    stopBrowser(s);
    s.off?.(); // Only called from a scheduler boundary or UI event, never from a render hook.
    s.schedulerOff?.();
    const frames = s.loops.length, denominator = Math.max(1, frames);
    const gaps = distribution(s.gaps);
    const endCounters = counters(); // Includes warmup and any interrupted frame; separate from exact timed-frame buckets.
    lastReport = {
      version: 3, reason, areaAtArm: s.area, areas: [...s.areas], elapsedMs: round(s.stoppedAt-s.started), finishedAtMs:round(s.stoppedAt),
      slowSchedulerFrames:s.slowFrames, slowFrameIntervals:s.slowIntervals,
      terminalFrameGap:s.terminalGap, browser:{...s.browser,endPage:pageState()},
      browserNotes:'Long tasks and long animation frames may overlap each other and game timings. Only completed entries wholly inside the window are included; browser delivery can lag. Style-to-end is not pure layout time. Between-callback gaps include idle, browser, GPU waits and unrelated work; they are not CPU attribution.',
      completeFrames: frames, discardedWarmupFrames: s.warmed ? 1 : 0, interruptedFrames: s.interrupted + (s.frame ? 1 : 0), skippedNonWorldFrames: s.nonWorld,
      schedulerBoundaryAvailable: !!s.schedulerOff, sampledIntervalMs: round(s.gaps.reduce((a,b)=>a+b,0)),
      fps: gaps?.meanMs > 0 ? round(1000/gaps.meanMs) : null, frameIntervals: gaps, rafTimestampIntervals:distribution(s.rafGaps),
      gameLoop: distribution(s.loops), schedulerFrame: distribution(s.schedulerFrames), nativeHookAvailable: s.hookAvailable,
      subsystems: rows(s.buckets, denominator), nativePasses: rows(s.passes, denominator, true),
      outsideFrameSubsystems: [...s.outside.buckets].sort((a,b)=>b[1].totalMs-a[1].totalMs).map(([name,x])=>({name,calls:x.calls,totalMs:round(x.totalMs),maxCallMs:round(x.maxMs)})),
      nativeMatrixWrapFailures: s.matrixFailures,
      countersAtStart:s.startCounters, countersAtEnd:endCounters, counterDeltas:counterChanges(s.startCounters,endCounters),
      notes: 'Wall-clock CPU submission timings, not GPU execution or stack samples. Inclusive subsystem buckets overlap; scheduler pre-render is inside the driver. Frame intervals use actual scheduler callback entry time and include browser scheduling/wait. RAF timestamp intervals are separate. First completed frame excluded (one-shot census/warmup). Frames without world rendering or failed drivers excluded. Native counts are renderer.info at submission end; nested submissions are not separately timed. Outside-frame brackets are reported separately for the whole recording, including warmup; they do not attribute uninstrumented browser work. Mixed areas are not a controlled comparison.',
    };
    return lastReport;
  }
  function cancel() {
    const s = session; session = null; lastReport = null;
    if (s) { s.stoppedAt=clock(); stopBrowser(s); }
    s?.off?.();
    s?.schedulerOff?.();
  }
  function start(area) {
    cancel();
    const s = session = { area, started: clock(), frame: null, warmed: false, interrupted: 0,
      areas: new Set(), loops: [], gaps: [], rafGaps:[], schedulerFrames: [], previousStart: null, buckets: new Map(), passes: new Map(),
      outside: { buckets: new Map() }, // Explicit timing brackets in microtasks and other callbacks between scheduler frames.
      previousFrame:null, slowFrames:[], slowIntervals:[], terminalGap:null, browserStops:[],
      browser:{startPage:pageState(),pageEvents:[],longtask:{supported:false,count:0,totalMs:0,worst:[]},
        'long-animation-frame':{supported:false,count:0,totalMs:0,worst:[]}},
      off: null, schedulerOff: null, hookAvailable: false, matrixFailures: 0, nonWorld: 0, startCounters:counters() };
    observeBrowser(s);
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
          const replay = ctx.worldScene && window.HeldObjectRenderOrder?.replayingDepth === true; // Separate the base WORLD draw from colorless WORLD depth replays.
          const stage = ctx.worldScene ? (replay ? 'held-replay' : 'world') : 'aux';
          const matrixMode = ctx.worldScene ? (scene?.autoUpdate === true ? '/matrix-walk' : '/matrix-reuse') : '';
          const state = { frame, key: pass + '/' + stage + '/' + layer + matrixMode,
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
    if (clock()-s.started >= MAX_MS || s.loops.length >= MAX_FRAMES) {
      if (s.previousFrame) s.terminalGap={sinceLastSchedulerEndMs:round(Math.max(0,clock()-s.previousFrame.end)),
        rafIntervalMs:Number.isFinite(timestamp)?round(timestamp-s.previousFrame.start):null};
      finish('limit'); return;
    }
    if (s.frame) { s.interrupted++; s.previousStart = null; s.previousFrame=null; }
    s.frame = { start: Number.isFinite(timestamp) ? timestamp : clock(), cpuStart: clock(),
      buckets: new Map(), passes: new Map(), area: null, driverMs: 0, driverCompleted: false };
  }
  function closeFrame(s,driverMs,completed) {
    const frame = s.frame;
    if (!frame) return;
    s.frame = null;
    if (!completed || !Number.isFinite(driverMs)) { s.interrupted++; s.previousStart=null; s.previousFrame=null; return; }
    if (frame.area == null) { s.nonWorld++; s.previousStart=null; s.previousFrame=null; return; }
    const end = clock(), schedulerMs=Math.max(0,end-frame.cpuStart); // Actual wall time, not RAF timestamps.
    if (!s.warmed) { s.warmed=true; s.previousStart=frame.cpuStart; s.previousFrame={start:frame.start,end,schedulerMs,warmup:true}; return; }
    if (s.previousStart !== null && frame.cpuStart > s.previousStart) {
      // RAF timestamps may be delayed or refer to a different animation-frame epoch.
      // FPS uses actual callback entry times; retain the browser timestamps separately.
      const interval = frame.cpuStart-s.previousStart;
      const rafInterval = s.previousFrame ? frame.start-s.previousFrame.start : null;
      if (rafInterval > 0) s.rafGaps.push(rafInterval);
      s.gaps.push(interval);
      if (interval >= 50 && s.previousFrame) keepLargest(s.slowIntervals,{
        atMs:round(frame.cpuStart-s.started),intervalMs:round(interval),rafIntervalMs:rafInterval==null?null:round(rafInterval),
        previousSchedulerMs:round(s.previousFrame.schedulerMs),previousWasWarmup:!!s.previousFrame.warmup,
        betweenCallbacksMs:round(Math.max(0,frame.cpuStart-s.previousFrame.end))
      },'intervalMs');
    }
    s.previousStart=frame.cpuStart;
    s.previousFrame={start:frame.start,end,schedulerMs};
    s.loops.push(driverMs);
    s.schedulerFrames.push(schedulerMs);
    if (schedulerMs >= 50 && (s.slowFrames.length < MAX_SLOW || schedulerMs > s.slowFrames.at(-1).schedulerMs)) {
      keepLargest(s.slowFrames,{atMs:round(frame.cpuStart-s.started),schedulerMs:round(schedulerMs),driverMs:round(driverMs),
        topSubsystems:biggestBuckets(frame.buckets),topNativePasses:biggestBuckets(frame.passes)},'schedulerMs');
    }
    s.areas.add(frame.area);
    merge(s.buckets,frame.buckets); merge(s.passes,frame.passes);
    if (clock()-s.started >= MAX_MS || s.loops.length >= MAX_FRAMES) finish('limit');
  }
  function beginTiming(name) {
    const s = session;
    if (!s) return null;
    // Older isolated hosts can still use the existing gameLoop bracket.
    if (!s.schedulerOff && name === 'gameLoop total') openFrame(s,clock());
    // A frame admitted before the deadline must keep all of its timing brackets.
    return session === s ? (s.frame || (clock()-s.started < MAX_MS ? s.outside : null)) : null;
  }
  function recordTiming(frame,name,elapsed) {
    const s = session;
    if (!s || !frame || !Number.isFinite(elapsed) || elapsed < 0) return;
    if (frame === s.outside) { add(frame.buckets,name,elapsed); return; }
    if (s.frame !== frame) return;
    add(frame.buckets,name,elapsed);
    if (!s.schedulerOff && name === 'gameLoop total') closeFrame(s,elapsed,true);
  }
  window.ProbePerformanceCapture = Object.freeze({
    start, finish, cancel, beginTiming, recordTiming,
    markArea(area) { if (session?.frame) session.frame.area = area; },
    recordDirect(name,ms) { if (session && name !== 'gameLoop total') recordTiming(session.frame || session.outside,name,ms); },
    get active() { return !!session; },
  });
})();

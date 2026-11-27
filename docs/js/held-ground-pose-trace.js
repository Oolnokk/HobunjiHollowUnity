// Diagnostic: does the weapon that is DRAWN match the pose HeldGroundPose solved?
//
// Off unless the page is opened with ?groundPoseTrace=1 (or localStorage.hobunjiGroundPoseTrace = '1').
// When off this file does nothing and HeldGroundPose pays only a boolean test.
//
// After every native renderer.render() (RenderHooks `afterRender`, so it sees the exact matrices that draw
// used) it asks HeldGroundPose.traceDrawn() for the sprite's live matrixWorld and checks three things:
//   C  clearance  - the drawn lowest contact point is below the solver's target (weapon pokes into the floor)
//   M  matrix     - the drawn matrixWorld differs from the matrix the last solve validated (a later writer,
//                   such as an unhooked updateWorldMatrix, replaced the corrected pose with the raw stance)
//   H  hull cache - the cached convex hull's lowest point disagrees with the lowest of every baked point
//                   (the contact-hull cache is stale for the current fit)
// Each frame is summarised as one character per render call ('.' ok, or C/M/H), e.g. ".....MMMM.MM", so a
// pose that is right on the first pass and wrong on later passes is visible. Failed solves and solve counts
// between renders are recorded too, so "the solver stopped running" is distinguishable from "something
// overwrote its result".
//
// Read it: the corner panel (tap/click copies the full JSON report), or window.HeldGroundPoseTrace.report().
(() => {
  'use strict';

  let enabled = false;
  try {
    enabled = /[?&]groundPoseTrace=1\b/.test(location.search) || localStorage.getItem('hobunjiGroundPoseTrace') === '1';
  } catch (_) { /* storage blocked: URL flag only */ }
  if (!enabled || window.HeldGroundPoseTrace) return;

  const CLEARANCE_TOLERANCE = 0.004; // World units below the solver's own target before a draw counts as poking through.
  const MATRIX_TOLERANCE = 1e-4;
  const HULL_TOLERANCE = 1e-4;
  const MAX_EVENTS = 80;
  const MAX_PATTERNS = 60;

  const counts = { renders: 0, bad: 0, C: 0, M: 0, H: 0, frames: 0, badFrames: 0, flickerFrames: 0, noSolveBetweenBad: 0 };
  const byPass = Object.create(null); // pass name -> { renders, bad }
  const events = []; // Most recent bad draws, newest last.
  const patterns = []; // Most recent frames that contained a bad draw.
  const transitions = []; // Solver reason changes, newest last.
  let startedAt = performance.now();
  let firstBadAt = null;
  let lastReason = null;
  let lastSolveCalls = 0;
  let frameKey = null;
  let framePattern = '';
  let frameSawOk = false;
  let frameSawBad = false;

  function flushFrame() {
    if (!framePattern) return;
    counts.frames++;
    if (frameSawBad) {
      counts.badFrames++;
      if (frameSawOk) counts.flickerFrames++; // Right on some passes of one frame, wrong on others.
      patterns.push(framePattern);
      if (patterns.length > MAX_PATTERNS) patterns.shift();
    }
    framePattern = '';
    frameSawOk = false;
    frameSawBad = false;
  }

  function passOf() {
    try { return window.WorldRenderPipeline?.currentPass?.() || 'unknown'; } catch (_) { return 'unknown'; }
  }

  function onRender(ctx) {
    const gp = window.HeldGroundPose;
    const d = gp?.traceDrawn?.(ctx.scene);
    if (!d || !d.inScene) return;
    if (ctx.frame !== frameKey) { flushFrame(); frameKey = ctx.frame; }

    counts.renders++;
    const pass = passOf();
    const passStats = byPass[pass] ||= { renders: 0, bad: 0 };
    passStats.renders++;

    if (d.reason !== lastReason) {
      transitions.push({ t: Math.round(performance.now() - startedAt), from: lastReason, to: d.reason, frame: d.lastSolveFrame });
      if (transitions.length > 40) transitions.shift();
      lastReason = d.reason;
    }

    const clearanceBad = Number.isFinite(d.target) && d.drawnHullY < d.target - CLEARANCE_TOLERANCE;
    const matrixBad = d.matrixDelta > MATRIX_TOLERANCE;
    const hullBad = Math.abs(d.drawnHullY - d.drawnPointsY) > HULL_TOLERANCE;
    const solvesSince = d.solveCalls - lastSolveCalls;
    lastSolveCalls = d.solveCalls;

    let mark = '.';
    if (hullBad) mark = 'H'; else if (matrixBad) mark = 'M'; else if (clearanceBad) mark = 'C';
    framePattern += mark;
    if (mark === '.') { frameSawOk = true; return; }

    frameSawBad = true;
    counts.bad++;
    passStats.bad++;
    if (clearanceBad) counts.C++;
    if (matrixBad) counts.M++;
    if (hullBad) counts.H++;
    if (solvesSince === 0) counts.noSolveBetweenBad++;
    if (firstBadAt === null) firstBadAt = Math.round(performance.now() - startedAt);
    events.push({
      t: Math.round(performance.now() - startedAt),
      frame: window.RuntimeFrameScheduler?.frameId?.() ?? null,
      callInFrame: ctx.frame?.renders ?? null,
      pass,
      kinds: (clearanceBad ? 'C' : '') + (matrixBad ? 'M' : '') + (hullBad ? 'H' : ''),
      drawnHullY: +d.drawnHullY.toFixed(4),
      drawnPointsY: +d.drawnPointsY.toFixed(4),
      target: Number.isFinite(d.target) ? +d.target.toFixed(4) : null,
      floor: Number.isFinite(d.floor) ? +d.floor.toFixed(4) : null,
      matrixDelta: +d.matrixDelta.toFixed(5),
      solvesSincePrevRender: solvesSince,
      lastSolveFrame: d.lastSolveFrame,
      reason: d.reason,
      lastFailReason: d.lastFailReason,
      lastFailFrame: d.lastFailFrame,
      itemKey: d.itemKey,
      speciesId: d.speciesId,
      hullBuilds: d.hullBuilds,
      hullVertices: d.hullVertices,
    });
    if (events.length > MAX_EVENTS) events.shift();
  }

  function report() { // Never flushes: the frame in progress is reported as currentFramePattern.
    return {
      what: 'HeldGroundPose render trace',
      page: location.href.replace(/[#].*$/, ''),
      uptimeMs: Math.round(performance.now() - startedAt),
      firstBadAtMs: firstBadAt,
      counts: { ...counts },
      legend: 'C=drawn weapon below solver target, M=drawn matrix != solved matrix, H=cached hull != all-points minimum',
      byPass: JSON.parse(JSON.stringify(byPass)),
      solverReasonChanges: transitions.slice(),
      recentBadFramePatterns: patterns.slice(-20),
      currentFramePattern: framePattern,
      recentBadDraws: events.slice(-20),
      heldGroundPose: window.HeldGroundPose?.snapshot?.() || null,
    };
  }

  function summaryText() {
    const c = counts;
    const pct = c.renders ? (100 * c.bad / c.renders).toFixed(1) : '0.0';
    const last = events[events.length - 1];
    const lines = [
      `ground-pose trace  renders ${c.renders}  bad ${c.bad} (${pct}%)`,
      `C ${c.C}  M ${c.M}  H ${c.H}  frames ${c.frames}  bad frames ${c.badFrames}  mixed ${c.flickerFrames}`,
      `solver: ${lastReason ?? '-'}  no-solve-before-bad ${c.noSolveBetweenBad}`,
    ];
    const passes = Object.entries(byPass).filter(([, v]) => v.bad).map(([k, v]) => `${k} ${v.bad}/${v.renders}`).join('  ');
    if (passes) lines.push('bad by pass: ' + passes);
    if (patterns.length) lines.push('last frame: ' + patterns[patterns.length - 1]);
    if (last) lines.push(`last bad: ${last.kinds} pass=${last.pass} y=${last.drawnHullY} tgt=${last.target} dM=${last.matrixDelta}`);
    lines.push('tap to copy full report');
    return lines.join('\n');
  }

  let panel = null;
  let shownText = '';
  function mountPanel() {
    if (panel || !document.body) return;
    panel = document.createElement('pre');
    panel.id = 'groundPoseTracePanel';
    panel.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:2147483000;margin:0;padding:6px 8px;'
      + 'font:10px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#d8ffd8;background:rgba(0,0,0,.72);'
      + 'border:1px solid #4a7;border-radius:6px;max-width:92vw;white-space:pre-wrap;cursor:copy;user-select:none';
    panel.addEventListener('click', async () => {
      const text = JSON.stringify(report(), null, 1);
      try { await navigator.clipboard.writeText(text); shownText = ''; panel.dataset.copied = '1'; }
      catch (_) { window.prompt('Copy the ground-pose trace report:', text); }
    });
    document.body.appendChild(panel);
    setInterval(() => {
      const text = summaryText() + (panel.dataset.copied ? '\ncopied!' : '');
      if (text !== shownText) { shownText = text; panel.textContent = text; } // Compare first: no unconditional DOM writes.
    }, 400);
  }

  window.HeldGroundPoseTrace = Object.freeze({
    report,
    reset() {
      for (const k of Object.keys(counts)) counts[k] = 0;
      for (const k of Object.keys(byPass)) delete byPass[k];
      events.length = 0; patterns.length = 0; transitions.length = 0;
      startedAt = performance.now(); firstBadAt = null; framePattern = ''; frameKey = null;
    },
    _onRender: onRender, // Exposed for the unit test; the live path is the RenderHooks registration below.
  });

  function install() {
    if (!window.RenderHooks?.register || !window.HeldGroundPose?.setTrace) return false;
    window.HeldGroundPose.setTrace(true);
    window.RenderHooks.register({
      id: 'held-ground-pose-trace',
      owner: 'held-ground-pose-trace.js',
      order: 899999000, // Innermost, just outside the opt-in static-matrix owner: sees the matrices the draw used.
      scope: 'render',
      afterRender: onRender,
    });
    return true;
  }

  if (!install()) window.addEventListener('DOMContentLoaded', install, { once: true });
  if (document.body) mountPanel(); else window.addEventListener('DOMContentLoaded', mountPanel, { once: true });
})();

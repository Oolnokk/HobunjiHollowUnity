// Render-time presentation hooks (window.RenderHooks).
//
// WHAT THIS IS
// Many features adjust objects only for the drawn image — the player's
// composed body lean, crop billboards facing the camera, NPC dance sway,
// bandit drunk sway — and must put everything back before gameplay reads
// the scene again. Each of those used to monkey-patch
// THREE.WebGLRenderer.prototype.render with its own wrapper, giving a
// ~20-deep chain whose order depended on script load order, could not be
// listed or timed, and re-ran every wrapper for every one of the ~17
// renderer.render() calls a world frame makes (main pass, PNG depth, shell
// outline, held-object replays, mist, composite...).
//
// This module is now the single place those hooks live. It installs ONE
// function as the prototype's base render (the bottom of any remaining
// wrapper chain) and runs registered hooks around the native three.js draw,
// in a fixed `order`.
//
// HOOK SCOPES
//   scope: 'render' (default) — before() runs before every renderer.render()
//     call and after() right after it. Use for state that must never leak
//     outside a single draw.
//   scope: 'frame' — inside a world frame (WorldRenderPipeline brackets every
//     pass of one gameplay frame with beginWorldFrame/endWorldFrame), before()
//     runs once, on the first render call it applies to, and after() runs
//     once at endWorldFrame(), in reverse order. Every pass of that frame —
//     main, PNG depth, shell, held-object replays — therefore sees the same
//     presentation, and the work is done once instead of ~10 times. Outside a
//     world frame (previews, editors, Pixel Probe captures) a 'frame' hook
//     falls back to 'render' semantics, so standalone renderers are unchanged.
//
//   appliesTo(ctx) — optional filter; return false to skip this render call
//     (e.g. a quad/composite scene the hook has nothing to do with). For
//     'frame' hooks the default is "only the world frame's own scene".
//   afterRender(ctx, state) — optional, runs right after the native draw
//     while the presentation is still applied (diagnostic captures).
//
// RULES FOR NEW HOOKS
//   * Do not wrap renderer.render / WebGLRenderer.prototype.render yourself;
//     register here. A wrapper above this base still works but is invisible to
//     getDebug() and runs once per pass.
//   * after() must restore exactly what before() changed (positions,
//     rotations, materials, deleted properties). Return whatever you need to
//     restore from before().
//   * Hooks must not allocate per call in steady state.
//   * Pick `order` from ORDER below so the relative order is explicit;
//     lower runs first (outermost), its after() runs last.
//
// DEBUGGING
//   RenderHooks.getDebug()     -> hooks in order with calls/applies/errors/ms
//   RenderHooks.setEnabled(id, false) -> A/B a single hook live
//   RenderHooks.setTiming(true) -> per-hook ms (off by default; cheap counters only)
//   RenderHooks.setFrameScopeEnabled(false) -> 'frame' hooks run per render (A/B)
//
// Loaded from index.html straight after three.js and render-layers.js, before
// the r128 render bridges and every hook owner.
(() => {
  'use strict';

  const THREE = window.THREE;
  if (!THREE?.WebGLRenderer || window.RenderHooks) return;

  // Documented relative order of the hooks this module was built to replace
  // (outermost first). Matches the wrapper chain order they had before the
  // migration so their observable nesting is unchanged.
  const ORDER = Object.freeze({
    ANIMAL_ELEVATION: 50, // Outermost: animals/mounts/companions lifted before anything poses against them.
    DEATH_MARK: 100,
    TOWN_BODY_ELEVATION: 150, // Before the composer reads its channels.
    DRUNK_PRONE: 200,
    HELD_SEED_RETICLE: 300,
    CROP_READY: 400,
    CROP_BILLBOARD: 500,
    HEFTROOT_BILLBOARD: 600,
    CROP_SPRITE_ART: 700,
    ACTOR_RENDER_PLACEMENT: 790, // Wildlife carry placement comes before actor-specific draw hooks.
    PLAYER_BODY_COMPOSER: 800,
    NPC_PERFORMANCE_LOCK: 900,
    FAMILY_BABY_LIMBS: 950, // Carried infant's kicking hands/feet (family-baby-limbs.js).
    NPC_SOCIAL_INHIBITION: 1000,
  });

  const hooks = []; // Sorted by order, then registration sequence.
  let registrationSeq = 0;
  let timing = false;
  let frameScopeEnabled = true; // Debug A/B: false runs every 'frame' hook per render, the pre-registry behaviour.
  let frame = null; // Current world frame, or null.
  let frameSeq = 0;
  let renderDepth = 0;
  const stats = { renders: 0, worldFrames: 0, nestedRenders: 0, unbalancedFrames: 0 };

  function sortHooks() {
    hooks.sort((a, b) => (a.order - b.order) || (a.seq - b.seq));
  }

  function register(spec) {
    if (!spec || typeof spec.id !== 'string' || !spec.id) throw new Error('RenderHooks.register needs an id');
    if (hooks.some(hook => hook.id === spec.id)) return () => unregister(spec.id); // Idempotent: modules may load twice in editors.
    const hook = {
      id: spec.id,
      owner: spec.owner || '',
      order: Number.isFinite(spec.order) ? spec.order : 5000,
      seq: registrationSeq++,
      scope: spec.scope === 'frame' ? 'frame' : 'render',
      appliesTo: typeof spec.appliesTo === 'function' ? spec.appliesTo : null,
      before: typeof spec.before === 'function' ? spec.before : null,
      after: typeof spec.after === 'function' ? spec.after : null,
      afterRender: typeof spec.afterRender === 'function' ? spec.afterRender : null,
      enabled: spec.enabled !== false,
      calls: 0, // Render calls this hook was offered.
      applies: 0, // Times before() actually ran.
      skips: 0, // Calls rejected by appliesTo or already applied this frame.
      errors: 0,
      lastError: null,
      ms: 0,
    };
    hooks.push(hook);
    sortHooks();
    return () => unregister(hook.id);
  }

  function unregister(id) {
    const index = hooks.findIndex(hook => hook.id === id);
    if (index >= 0) hooks.splice(index, 1);
  }

  function recordError(hook, phase, error) {
    hook.errors++;
    hook.lastError = `${phase}: ${String(error?.message || error)}`;
    if (hook.errors <= 3) console.warn(`[RenderHooks] ${hook.id} ${phase} failed`, error);
  }

  function runPhase(hook, phase, fn, ctx, state) {
    const probe = window.ProbePerformanceCapture; // Opt-in session, independent of the live RenderHooks timing toggle.
    const probeFrame = probe?.active ? probe.beginTiming('render hook') : null;
    const timed = timing || !!probeFrame;
    const start = timed ? performance.now() : 0;
    try {
      return fn(ctx, state);
    } catch (error) {
      recordError(hook, phase, error);
      return undefined;
    } finally {
      if (timed) {
        const elapsed = performance.now() - start;
        if (timing) hook.ms += elapsed;
        if (probeFrame) probe.recordTiming(probeFrame,'render hook: '+hook.id+'/'+phase,elapsed);
      }
    }
  }

  function defaultFrameApplies(ctx) {
    return !!ctx.frame && ctx.scene === ctx.frame.scene;
  }

  // Native three.js render for this renderer instance. Prefer the r128
  // bridge's untouched native (social-action-r128-render-bridge.js) over the
  // combat-config-loader handle, which can itself be a dispatcher back into
  // the prototype when both bridges are installed.
  function nativeRenderOf(renderer) {
    if (typeof renderer?.__hobunjiR128NativeRender === 'function') return renderer.__hobunjiR128NativeRender;
    if (typeof renderer?.__hobunjiBaseRendererRender === 'function') return renderer.__hobunjiBaseRendererRender;
    return null;
  }

  // Reused per depth level so steady-state renders do not allocate.
  const ctxPool = [];
  const statePool = [];
  function ctxAt(depth) {
    if (!ctxPool[depth]) ctxPool[depth] = { renderer: null, scene: null, camera: null, frame: null, worldScene: false, depth };
    return ctxPool[depth];
  }
  function statesAt(depth) {
    if (!statePool[depth]) statePool[depth] = { hooks: [], states: [], count: 0 };
    return statePool[depth];
  }

  function renderHooksBaseRender(scene, camera, ...rest) {
    const native = nativeRenderOf(this);
    if (!native) throw new Error('RenderHooks: this renderer has no native render(); was it constructed before the r128 bridge?');
    return dispatch(this, native, scene, camera, rest);
  }
  renderHooksBaseRender.__hobunjiRenderHooksBase = true;

  function dispatch(renderer, native, scene, camera, rest) {
    stats.renders++;
    if (frame) frame.renders++;
    if (renderDepth > 0) stats.nestedRenders++;
    const depth = renderDepth++;
    const ctx = ctxAt(depth);
    ctx.renderer = renderer; ctx.scene = scene; ctx.camera = camera;
    ctx.frame = frame; ctx.worldScene = !!frame && scene === frame.scene;
    const pending = statesAt(depth);
    pending.count = 0;
    try {
      for (let i = 0; i < hooks.length; i++) {
        const hook = hooks[i];
        if (!hook.enabled) continue;
        hook.calls++;
        if (hook.scope === 'frame' && frame && frameScopeEnabled) {
          if (frame.applied.has(hook) || !(hook.appliesTo ? hook.appliesTo(ctx) : defaultFrameApplies(ctx))) { hook.skips++; continue; }
          frame.applied.add(hook);
          hook.applies++;
          const state = hook.before ? runPhase(hook, 'before', hook.before, ctx) : undefined;
          frame.restores.push({ hook, state, rendered: false, ctx: { renderer, scene, camera, frame, worldScene: ctx.worldScene, depth } });
          continue;
        }
        if (hook.appliesTo && !hook.appliesTo(ctx)) { hook.skips++; continue; }
        hook.applies++;
        const state = hook.before ? runPhase(hook, 'before', hook.before, ctx) : undefined;
        pending.hooks[pending.count] = hook;
        pending.states[pending.count] = state;
        pending.count++;
      }
      const result = rest.length ? native.call(renderer, scene, camera, ...rest) : native.call(renderer, scene, camera);
      if (frame) {
        for (const entry of frame.restores) {
          if (entry.hook.afterRender && !entry.rendered) { entry.rendered = true; runPhase(entry.hook, 'afterRender', entry.hook.afterRender, entry.ctx, entry.state); }
        }
      }
      for (let i = 0; i < pending.count; i++) {
        const hook = pending.hooks[i];
        if (hook.afterRender) runPhase(hook, 'afterRender', hook.afterRender, ctx, pending.states[i]);
      }
      return result;
    } finally {
      for (let i = pending.count - 1; i >= 0; i--) {
        const hook = pending.hooks[i];
        if (hook.after) runPhase(hook, 'after', hook.after, ctx, pending.states[i]);
        pending.hooks[i] = null;
        pending.states[i] = null;
      }
      pending.count = 0;
      ctx.renderer = ctx.scene = ctx.camera = ctx.frame = null;
      renderDepth--;
    }
  }

  // World frame bracket. WorldRenderPipeline calls these around every pass of
  // one gameplay frame; 'frame' hooks apply once inside and restore in end().
  function beginWorldFrame(options = {}) {
    if (frame) { stats.unbalancedFrames++; endWorldFrame(); } // Never let a missed end leak presentation into gameplay.
    frame = {
      id: ++frameSeq,
      renderer: options.renderer || null,
      scene: options.scene || null,
      camera: options.camera || null,
      applied: new Set(),
      restores: [],
      renders: 0, // Native renders inside this frame (all passes, replays included).
    };
    stats.worldFrames++;
    return frame;
  }

  function endWorldFrame() {
    const closing = frame;
    if (!closing) return;
    frame = null;
    for (let i = closing.restores.length - 1; i >= 0; i--) {
      const entry = closing.restores[i];
      if (entry.hook.after) runPhase(entry.hook, 'after', entry.hook.after, entry.ctx, entry.state);
    }
    closing.restores.length = 0;
    closing.applied.clear();
  }

  // Install the base. Two older bridges (combat-config-loader.js and
  // social-action-r128-render-bridge.js) each install their own prototype base
  // only when none exists, then wrap the constructor so instances delegate
  // render() to the prototype. Loading first, this module's base is the one
  // they find; both bridges keep doing their constructor work unchanged.
  const proto = THREE.WebGLRenderer.prototype;
  if (typeof proto.render !== 'function') {
    proto.render = renderHooksBaseRender;
  } else {
    // Something already provides a prototype render (another three build, or
    // a bridge that loaded first). Sit directly above it instead.
    const previous = proto.render;
    proto.render = function renderHooksOverExistingBase(scene, camera, ...rest) {
      return dispatch(this, previous, scene, camera, rest);
    };
    proto.render.__hobunjiRenderHooksBase = true;
  }

  function getDebug() {
    return {
      timing,
      frameScopeEnabled,
      worldFrameOpen: !!frame,
      worldFrameId: frame?.id ?? frameSeq,
      ...stats,
      order: ORDER,
      hooks: hooks.map(hook => ({
        id: hook.id,
        owner: hook.owner,
        order: hook.order,
        scope: hook.scope,
        enabled: hook.enabled,
        calls: hook.calls,
        applies: hook.applies,
        skips: hook.skips,
        errors: hook.errors,
        lastError: hook.lastError,
        ms: timing ? Number(hook.ms.toFixed(3)) : null,
      })),
    };
  }

  window.RenderHooks = Object.freeze({
    ORDER,
    register,
    unregister,
    beginWorldFrame,
    endWorldFrame,
    currentWorldFrame: () => frame,
    isWorldFrameOpen: () => !!frame,
    setEnabled(id, enabled) {
      const hook = hooks.find(entry => entry.id === id);
      if (hook) hook.enabled = enabled !== false;
      return !!hook;
    },
    setTiming(enabled) { timing = !!enabled; if (timing) hooks.forEach(hook => { hook.ms = 0; }); },
    // A/B switch for visual regressions: false makes every 'frame' hook apply
    // and restore around each render call again (as the old wrappers did).
    setFrameScopeEnabled(enabled) { frameScopeEnabled = enabled !== false; },
    list: () => hooks.map(hook => hook.id),
    getDebug,
    resetStats() {
      Object.keys(stats).forEach(key => { stats[key] = 0; });
      hooks.forEach(hook => { hook.calls = hook.applies = hook.skips = hook.errors = 0; hook.ms = 0; hook.lastError = null; });
    },
  });
})();

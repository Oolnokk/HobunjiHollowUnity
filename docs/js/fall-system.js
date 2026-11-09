(() => {
  'use strict';

  // Unified falling for climbing, ledges and cliffs.
  //
  // One place decides (a) what a landing costs, (b) when a ledge counts as a
  // deliberate step off versus a mistake, and (c) how long a climber can hang
  // on before their grip gives out. ClimbSystem owns the animation of each
  // climb/fall (the same scripted hop-lerp it already uses); this module owns
  // the rules, so every climb/ledge/knockback source applies the same ones.
  //
  // The design goal is forgiveness: nothing here punishes ordinary walking.
  //   * Walking toward a ledge edge stops at the lip (edge "toe"). Stepping off
  //     needs a short deliberate hold outward, or a dodge/knockback.
  //   * Grip drains only while hanging from a handhold (not on a ledge, not at
  //     the base), at a pace that leaves far more time than any route needs.
  //     Warning comes first (grip fraction <= WARN), and a fall only happens
  //     at zero. Being hit knocks a chunk off, never instantly drops you.
  //   * Drops up to SAFE_TIERS cost nothing; deliberate jumps (the hold-to-
  //     commit step-off, a jump-down) are cheaper and a roll input on landing
  //     absorbs most of the rest. Costs are Footing (stagger), not Health,
  //     matching the ruin's existing fall and knockback ledge falls.
  let deps = null;
  function init(injected) { deps = injected || null; }

  const CONFIG = Object.freeze({
    safeTiers: 0.75,          // Plateau tiers a body can drop with no penalty.
    footingPerTier: 22,       // Footing lost per tier past safeTiers (uncontrolled fall).
    footingCap: 100,          // Never more than a full Footing bar.
    deliberateScale: 0.4,     // Deliberate jumps/step-offs land much softer.
    rollScale: 0.5,           // Landing during a dodge roll halves what is left.
    edgeCommitS: 0.35,        // Hold outward this long at a ledge lip to step off.
    edgeCommitDecayPerS: 3,   // Release input and the commit timer drains 3x as fast as it fills.
    gripSeconds: 60,          // Continuous hanging on handholds before grip hits zero.
    gripRecoverPerS: 0.5,     // Fraction/second regained when resting on a ledge or the ground.
    gripWarn: 0.25,           // Grip fraction at/below which the player is warned.
    gripHitLoss: 0.2,         // Grip fraction knocked off by taking damage while hanging.
    slipFallMinTiers: 0.0,    // Slipping always falls from where you are.
  });

  function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function dropTiers(dropWorld) {
    const unit = Math.max(0.001, num(deps?.PLATEAU_UNIT, 2.5));
    return Math.max(0, num(dropWorld)) / unit;
  }

  // Footing lost for a landing. Pure so tests and callers can preview it.
  function landingCost(tiers, { deliberate = false, rolled = false } = {}) {
    const excess = Math.max(0, num(tiers) - CONFIG.safeTiers);
    let footing = excess * CONFIG.footingPerTier;
    if (deliberate) footing *= CONFIG.deliberateScale;
    if (rolled) footing *= CONFIG.rollScale;
    footing = Math.min(CONFIG.footingCap, Math.round(footing * 10) / 10);
    return { footing, tiers: num(tiers), severity: footing <= 0 ? 'soft' : footing < 40 ? 'stumble' : 'hard' };
  }

  // Apply a landing to an entity. Returns the cost record (with `prone` set when
  // Footing ran out and the shared prone/knockdown path was entered).
  function land(entity, { dropWorld = 0, dirX = 0, dirY = 0, deliberate = false, source = 'fall' } = {}) {
    if (!entity) return null;
    const rolled = !!(entity.dodging || num(entity.dodgeT) > 0);
    const cost = landingCost(dropTiers(dropWorld), { deliberate, rolled });
    cost.source = source;
    cost.prone = false;
    if (cost.footing > 0) {
      window.ResourceSystem?.spendFooting?.(entity, cost.footing, source);
      if (num(entity.footing, 1) <= 0 && !entity.prone) {
        cost.prone = deps?.enterProneIfDepleted?.(entity, dirX, dirY) === true;
      }
    }
    lastLanding = { ...cost, at: Date.now() };
    return cost;
  }
  let lastLanding = null;

  // --- Ledge lip: walking never steps off by accident --------------------------
  // Call each frame the entity pushes toward an unsupported edge (pushing=true),
  // or with pushing=false otherwise. Returns {state, progress}; state 'commit'
  // means the caller should now step off (once).
  function edgeIntent(entity, dt, pushing) {
    if (!entity) return { state: 'none', progress: 0 };
    const step = Math.max(0, num(dt));
    let t = num(entity._edgeCommitS);
    t = pushing ? t + step : Math.max(0, t - step * CONFIG.edgeCommitDecayPerS);
    entity._edgeCommitS = t;
    if (pushing && t >= CONFIG.edgeCommitS) { entity._edgeCommitS = 0; return { state: 'commit', progress: 1 }; }
    return { state: pushing ? 'toe' : 'none', progress: clamp(t / CONFIG.edgeCommitS, 0, 1) };
  }
  function clearEdgeIntent(entity) { if (entity) entity._edgeCommitS = 0; }

  // --- Grip -------------------------------------------------------------------
  function gripFraction(entity) {
    const g = entity?._grip;
    return Number.isFinite(g) ? clamp(g, 0, 1) : 1;
  }
  // hanging: true while hanging from a handhold that is not a rest point.
  // Returns 'ok' | 'warn' | 'slip'. 'slip' is returned once; the caller starts
  // the fall. Taking damage while hanging costs a chunk of grip, never a fall
  // by itself, so being hit is recoverable if there is a ledge or rest nearby.
  function tickGrip(entity, dt, hanging) {
    if (!entity) return 'ok';
    const step = Math.max(0, num(dt));
    let g = gripFraction(entity);
    const hp = num(entity.health, NaN);
    if (hanging && Number.isFinite(hp) && Number.isFinite(entity._gripLastHealth) && hp < entity._gripLastHealth - 0.01) {
      g -= CONFIG.gripHitLoss;
    }
    entity._gripLastHealth = hp;
    if (hanging) g -= step / CONFIG.gripSeconds;
    else g += step * CONFIG.gripRecoverPerS;
    g = clamp(g, 0, 1);
    entity._grip = g;
    if (hanging && g <= 0) { entity._grip = 1; return 'slip'; }
    return hanging && g <= CONFIG.gripWarn ? 'warn' : 'ok';
  }
  function resetGrip(entity) { if (entity) { entity._grip = 1; entity._gripLastHealth = num(entity.health, NaN); } }

  window.FallSystem = Object.freeze({
    init, CONFIG, dropTiers, landingCost, land,
    edgeIntent, clearEdgeIntent, gripFraction, tickGrip, resetGrip,
    get lastLanding() { return lastLanding; },
  });
})();

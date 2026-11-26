(() => {
  'use strict';

  // Mounted riding (V key / D-pad down calls a mount in or dismisses it —
  // see game.js's 'toggleMount' input action). Extracted out of game.js
  // following the same window.<Namespace> + init(deps) pattern already used
  // by js/combat/*.js: this module owns the ride-state machine and its
  // private state; anything it needs that lives in game.js (player, scene,
  // helper functions, and a handful of shared mutable camera-look fields)
  // is handed over once via init(). See window.Combat's init(deps) call in
  // game.js for the sibling precedent.
  let deps = null;
  const DEFAULT_ANIMAL_GAIT_CYCLES_PER_SECOND = 6; // Baseline for every runtime animal species with a run sprite unless that species authors an override.

  function init(injectedDeps) {
    deps = injectedDeps;
    installSharedCreatureGait();
    ensureMountWheatHud();
    installMountedActionInput();
  }

  // 'none': no mount out. 'rushingIn': a just-summoned mount is dashing in
  // off-screen toward the player. 'mountingUp': the mount has arrived and
  // the player is lerping up onto it. 'mounted': steady-state riding —
  // movement input steers the mount (see updateMountedMovement) instead of
  // the player. 'climbLeap': a scripted crouch-and-leap crossing a cliff
  // face the dismounted climb system would otherwise lerp the player across
  // (see startClimbLeap/updateClimbLeap) — steering is suppressed the same
  // way mountingUp/dismountingDown suppress it, but the mount (and pinned
  // rider) keep rendering exactly as they do in 'mounted'. 'dismountingDown':
  // the player is lerping back off the mount. 'rushingOut': the (now
  // riderless) mount is dashing away off-screen before despawning.
  let mountRideState = 'none';
  let _lastMountActiveClass = null; // Caches the last DOM class write so updateMountRide's every-frame call only touches the DOM when the active state actually flips.
  let mountRideEntity = null;
  let mountAngle = 0;              // the mount's own heading; momentum-turned in updateMountedMovement
  let mountCurrentSpeedPxS = 0;    // the mount's current forward speed (momentum — see MOUNT_TURN_RATE_MIN/MAX)
  let mountTransitionT = 0;        // 0..1 progress through the current mountingUp/dismountingDown lerp
  let mountTransitionFromX = 0, mountTransitionFromY = 0;
  let mountDismountTargetX = 0, mountDismountTargetY = 0;
  let mountRushOutAngle = 0;
  let mountRushOutT = 0;
  let mountRushInT = 0;
  // Leap state lives on the mount entity itself as `_climbLeap` (mirroring
  // the existing `onBranch`/`branchSurfaceY` per-entity override pattern) so
  // game.js's updateCreatureMesh can read `_climbLeap.surfaceY` directly,
  // the same way it already reads `onBranch`'s branchSurfaceY — see its
  // `surfY` ternary.
  const WHEAT_MAX = 6; // Six OoT-style boost charges displayed by the riding HUD.
  const WHEAT_RECOVER_S = 3.3; // Seconds without an active surge before one spent charge regrows.
  const BOOST_DURATION_S = 1.35; // One dodge/whistle accelerates the mount for this duration.
  const CRUISE_SPEED_RATIO = 1; // Unboosted travel uses the complete player-derived mount speed, not a reduced hands-free fraction.
  const MOUNT_PLAYER_RUN_RATIO = 1.1; // Baseline is the current full-input player run speed +10%, before stable perks and temporary boosts.
  const BOOST_SPEED_RATIO = 1.42; // Temporary peak-speed multiplier relative to the inherited player-running mount baseline.
  const MOUNT_COAST_DECEL_RATIO = 0.25; // Passive slowdown after wheat/combat acceleration, without weakening deliberate braking or collision stops.
  const MOUNT_COAST_SOFT_BAND_RATIO = 0.3; // Fade passive drag as excess speed approaches ordinary cruise, avoiding a hard-feeling final slowdown.
  const MOUNT_TOWN_MAX_STEP_UP = 0.25; // Same reachable step limit as the on-foot walking support solver.
  const MOUNT_TOWN_STAIR_SAMPLE_TILES = 0.125; // Substep past bridge's 0.25-tile treads, including at boosted speeds or low FPS.
  const MOUNT_TOWN_STAIR_MAX_SAMPLES = 24; // Caps town bridge work after unusually long frame stalls.
  const MOUNT_TOWN_TRACKING_DISTANCE_TILES = 2; // Long relocation does not count as walking over intervening stairs.
  const MOUNT_HOP_MAX_ROCK_RISE = 1.05; // Normal wilderness rocks can be ~0.75 world units tall; only modest finite covers are jumped.
  let wheatRemaining = WHEAT_MAX; // Spent by mounted dodge presses, restored over time in updateMountedMovement.
  let wheatRecoveryS = 0; // Single-chunk regeneration clock, not an additional stamina resource.
  let mountBoostS = 0; // Remaining wheat surge; read by movement and exertion scheduling.
  let mountedCombatBoostS = 0; // Remaining charge/quick-attack speed burst, independent of wheat spending.
  let mountedCombatBoostMultiplier = 1; // Legacy timed bursts still support their existing callers.
  let mountedWindupOwner = null; // Only the currently active mounted windup can adjust/clear its own acceleration.
  let mountedWindupMultiplier = 0; // Windup-only desired-speed factor; zero means no combat acceleration.
  let mountedWindupSpentFraction = 0; // Mobile diagnostics track actual funded charge progress, not just elapsed time.
  let mountedOrbitTarget = null; // Cached ranged auto-target used to steer the carrier in a circle.
  let mountedOrbitRadiusPx = 0; // Initial target distance retained as the desired orbit radius.
  let mountedOrbitScanS = 0; // Limits ranged target-acquisition work to about five checks per second.
  let mountedOrbitClockwise = true; // Keeps a consistent circling side until the selected target changes.
  let mountBreathClockS = 0; // Cadence timer for one animal exertion clip at a time.
  let mountRockScanS = 0; // Throttles short-rock lookahead to avoid repeated tile and collision probes every frame.
  const MOUNT_ROCK_SCAN_INTERVAL_S = 0.07; // Fast enough to catch rocks at boosted speed without a per-frame radius scan.
  let mountWheatHud = null; // Retained DOM view; only updated when charge/state changes.
  let lastHudSignature = ''; // Avoids per-frame DOM mutation and MutationObserver loops.
  let mountActionsClaimed = false; // Mirrors the action router's mounted dodge/jump overrides.
  let mountInputInstalled = false; // Prevents duplicate key/pointer/controller listeners across repeated game initialization.
  const lastMountedActionMs = { dodge: -10000, jump: -10000 }; // Deduplicates a physical press dispatched by both the shared action router and device adapters.
  let lastPointerAction = null; // Suppresses the synthetic click following a handled mobile pointerdown.
  const ridingDebug = { boosts: 0, autoRockJumps: 0, manualJumps: 0, lastWhistle: null, lastBreath: null }; // Mobile-readable mount behavior diagnostics.

  const mountRenderSync = { active: false, beforeXzDriftTiles: 0, afterXzDriftTiles: 0, verticalCorrectionTiles: 0 }; // Used by Pixel Probe to expose rider/carrier render drift on mobile.
  const mountFootstepDebug = { emitted: 0, surfaceKey: null, lastDistancePx: 0, lastVolumeScale: 0, lastAtMs: 0, lastTransition: null, nativeLayers: 0, gaitHz: DEFAULT_ANIMAL_GAIT_CYCLES_PER_SECOND }; // Exposed through window.Mounts.footstepDebug for console-free gait/audio checks.

  // A rush-in/out transition well beyond the camera's visible range, so
  // "calling" a mount reads as it charging in from off-screen rather than
  // just popping in nearby.
  const MOUNT_RUSH_SPEED_PX = 900;
  const MOUNT_ARRIVE_PX_TILES = 0.55;
  const MOUNT_DESPAWN_DIST_TILES = 9;
  const MOUNT_SPAWN_DIST_TILES = 9;
  const MOUNT_TRANSITION_S = 0.35; // how long the rider's lerp on/off the mount takes

  // A mounted cliff crossing: basically Pounce's own windup/uncrouch/leap
  // shape (see combat-animal-attacks.js) applied to the mount instead of a
  // hostile — crouch in place, spring up, then fly the same start->landing
  // path a dismounted wall climb would cross on foot. The vertical arc rides
  // on top of the authored elevation change (see updateClimbLeap) rather
  // than a fixed height, so a tall plateau reads as a bigger leap than a
  // single ledge.
  const MOUNT_CLIMB_LEAP_WINDUP_S = 0.32;
  const MOUNT_CLIMB_LEAP_UNCROUCH_S = 0.12;
  const MOUNT_CLIMB_LEAP_CROUCH_SCALE_Y = 0.72;
  const MOUNT_CLIMB_LEAP_BASE_S = 0.45;   // flight duration for a single-tile wall; extended a bit per extra wall tile below
  const MOUNT_CLIMB_LEAP_MAX_S = 0.85;
  const MOUNT_CLIMB_LEAP_PER_WALL_TILE_S = 0.1;
  const MOUNT_CLIMB_LEAP_MIN_ARC_UNITS = 0.35;
  const MOUNT_CLIMB_LEAP_ARC_FRACTION = 0.45; // extra rise above the straight elevation change, as a fraction of that change

  // Two native layers are intentional. A single recorded footstep tops out
  // at HTMLAudioElement volume=1, so merely raising the old 3x multiplier to
  // 6x can be silently clamped. Two simultaneous 3x layers preserve the
  // requested second doubling while staying on the reliable native-audio path.
  const MOUNT_FOOTSTEP_VOLUME_SCALE = 6.0;
  const MOUNT_FOOTSTEP_NATIVE_LAYERS = 2;

  // Momentum: a stationary mount can pivot quickly, but the faster it's
  // already moving the more sluggishly it can turn — trading maneuverability
  // for the speed a mount gives you (see updateMountedMovement).
  const MOUNT_TURN_RATE_MAX = Math.PI * 3.2; // rad/s at a standstill
  const MOUNT_TURN_RATE_MIN = Math.PI * 0.9; // rad/s at full player-derived mount speed

  // This is the existing Farm tab's actual PNG (and mask technique), not a new carrot asset.
  function ensureMountWheatHud() {
    if (mountWheatHud || typeof document === 'undefined' || !document.body?.appendChild) return;
    if (!document.getElementById('mountWheatHudStyle')) {
      const style = document.createElement('style');
      style.id = 'mountWheatHudStyle';
      style.textContent = '#mountWheatHud{position:absolute;left:50%;bottom:calc(100% + 8px);transform:translateX(-50%);display:none;gap:5px;align-items:center;justify-content:center;z-index:110;pointer-events:none;padding:8px 10px;border-radius:12px;background:rgba(12,17,12,.62);white-space:nowrap}#mountWheatHud .wheat-charge{display:block;width:23px;height:23px;background:#6bc36f;-webkit-mask:url("assets/hud/generic_icons/icon_wheat.png") center/contain no-repeat;mask:url("assets/hud/generic_icons/icon_wheat.png") center/contain no-repeat;transition:background .14s,opacity .14s}#mountWheatHud .wheat-charge.empty{background:#737675;opacity:.6}#mountWheatHud .wheat-charge.boosting:not(.empty){background:#f1cc63}@media(max-width:640px){#mountWheatHud{gap:3px;padding:5px 8px}#mountWheatHud .wheat-charge{width:20px;height:20px}}#vitalsBar.with-mounted-wheat{visibility:visible;opacity:1;transform:translate(-50%,0)}';
      document.head?.appendChild(style);
    }
    mountWheatHud = document.createElement('div');
    mountWheatHud.id = 'mountWheatHud';
    mountWheatHud.setAttribute('role', 'status');
    mountWheatHud.setAttribute('aria-label', 'Mount acceleration: six wheat charges');
    for (let i = 0; i < WHEAT_MAX; i++) {
      const charge = document.createElement('span');
      charge.className = 'wheat-charge';
      mountWheatHud.appendChild(charge);
    }
    const vitals = document.getElementById('vitalsBar'); // Anchors wheat to the real bottom-center player bars, even when their number/height changes.
    (vitals || document.body).appendChild(mountWheatHud);
    if (!vitals) { // Fallback for headless test harnesses or pages without the player HUD.
      mountWheatHud.style.position = 'fixed';
      mountWheatHud.style.left = 'var(--play-center, 50%)';
      mountWheatHud.style.bottom = 'max(15dvh, 80px)';
    }
    lastHudSignature = '';
    refreshMountWheatHud();
  }

  function refreshMountWheatHud() {
    if (!mountWheatHud) return;
    const visible = mountRideState === 'mounted' || mountRideState === 'climbLeap';
    const signature = [visible, wheatRemaining, mountBoostS > 0].join(':');
    if (lastHudSignature === signature) return;
    lastHudSignature = signature;
    document.getElementById('vitalsBar')?.classList.toggle('with-mounted-wheat', visible); // Wheat stays visible at full health even if all resource rows are hidden; never activates those rows.
    mountWheatHud.style.display = visible ? 'flex' : 'none';
    mountWheatHud.setAttribute('aria-label', 'Mount acceleration: ' + wheatRemaining + ' of ' + WHEAT_MAX + ' wheat charges');
    for (let i = 0; i < mountWheatHud.children.length; i++) {
      const child = mountWheatHud.children[i];
      child.classList.toggle('empty', i >= wheatRemaining);
      child.classList.toggle('boosting', mountBoostS > 0);
    }
  }

  function pressMountedAction(actionId) {
    if (mountRideState !== 'mounted' || gameInputBlocked()) return false;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - (lastMountedActionMs[actionId] ?? -10000) < 140) return true;
    lastMountedActionMs[actionId] = now;
    return actionId === 'dodge' ? accelerateMount() : actionId === 'jump' ? (window.ClimbSystem?.jumpAction?.() ?? jumpMount()) : false; // Preserve existing mounted cliff crossings; jumpMount handles open ground.
  }

  function gameInputBlocked(event = null) {
    if (typeof document === 'undefined') return false;
    if (event?.target?.closest?.('input,textarea,select,[contenteditable="true"]')) return true;
    if (document.getElementById('menuPanel')?.classList?.contains?.('open')) return true;
    if (window.ControllerUI?.isActive?.() || window.FarmworkUI?.isPlanning?.()) return true; // Existing menu and farm-planning owners outrank riding buttons.
    if (window.HobunjiOnboarding?.creatorSessionInfo?.()?.cosmeticsOnly || window.__mapEditorGizmoActive) return true;
    if (window.Fishing?.state?.active || window.MusicMinigame?.state?.active) return true; // Fishing and music own their own primary inputs.
    return false;
  }

  // The action router owns gameplay claims; these device-edge listeners cover
  // legacy Dodge/Jump input paths that execute before generic world claims.
  // Controller support reads ControllerInput's existing shared frame, never
  // polls a gamepad or starts another frame loop.
  function installMountedActionInput() {
    if (mountInputInstalled || typeof window?.addEventListener !== 'function') return;
    mountInputInstalled = true;
    window.addEventListener('keydown', event => {
      if (mountRideState !== 'mounted' || event.repeat || event.defaultPrevented || gameInputBlocked(event)) return;
      const bindings = window.InputBindings?.getCurrentBindings?.()?.desktop || {};
      const action = event.code === (bindings.dodge || 'KeyX') ? 'dodge' : event.code === (bindings.jump || 'Space') ? 'jump' : null; // Match game's legacy X/Space controls when Jump is absent from user-remappable bindings.
      if (!action) return;
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      pressMountedAction(action);
    }, true);
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('pointerdown', event => {
        if (mountRideState !== 'mounted' || gameInputBlocked(event)) return;
        const target = event.target?.closest?.('#dodgeBtn,#jumpBtn');
        if (!target) return;
        const action = target.id === 'dodgeBtn' ? 'dodge' : 'jump';
        lastPointerAction = { action, at: typeof performance !== 'undefined' ? performance.now() : Date.now() };
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
        pressMountedAction(action);
      }, true);
      document.addEventListener('click', event => {
        if (mountRideState !== 'mounted' || gameInputBlocked(event)) return;
        const target = event.target?.closest?.('#dodgeBtn,#jumpBtn');
        if (!target) return;
        const action = target.id === 'dodgeBtn' ? 'dodge' : 'jump';
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
        if (lastPointerAction?.action === action && now - lastPointerAction.at < 800) return;
        pressMountedAction(action);
      }, true);
    }
    window.ControllerInput?.subscribe?.('mount-riding-actions', frame => {
      if (mountRideState !== 'mounted' || frame.owner !== 'gameplay' || frame.focused === false || gameInputBlocked()) return;
      const bindings = window.InputBindings?.getCurrentBindings?.()?.controller || {};
      if (bindings.dodge && frame.pressed?.has?.(bindings.dodge)) pressMountedAction('dodge');
      // The game's existing A/Interact handler prioritizes nearby interactions and invokes ClimbSystem.jumpAction when the world has nothing to interact with. A second controller Jump press here would trigger BOTH actions.
    }, 5);
  }

  // Claims use the same device-neutral gameplay action router as nearby interactions.
  function syncMountedActionClaims() {
    const active = mountRideState === 'mounted';
    if (active === mountActionsClaimed) return;
    const claims = window.WorldActionInputClaims;
    if (!claims?.setClaims || !claims?.clearClaims) return;
    mountActionsClaimed = active;
    if (active) claims.setClaims('mount-riding', [
      { actionId: 'dodge', label: 'Accelerate mount', priority: 990, onPress: () => pressMountedAction('dodge') },
      { actionId: 'jump', label: 'Jump mount', priority: 990, onPress: () => pressMountedAction('jump') },
    ]);
    else claims.clearClaims('mount-riding');
  }

  function whistleMount(filename) {
    const url = 'assets/audio/sfx/' + filename; // Exact authored files already in the game's SFX directory.
    window.AudioSystem?.playObjectSfx?.({ url, volume: 0.85, preload: true });
    ridingDebug.lastWhistle = filename;
  }

  function resetMountRidingResource() {
    wheatRemaining = WHEAT_MAX;
    wheatRecoveryS = 0;
    mountBoostS = 0;
    mountedCombatBoostS = 0;
    mountedCombatBoostMultiplier = 1;
    mountedWindupOwner = null;
    mountedWindupMultiplier = 0;
    mountedWindupSpentFraction = 0;
    ridingDebug.coasting = false; // A newly summoned mount must never inherit the previous rider's momentum diagnostic.
    mountedOrbitTarget = null;
    mountedOrbitRadiusPx = 0;
    mountedOrbitScanS = 0;
    mountBreathClockS = 0;
    mountRockScanS = 0;
    refreshMountWheatHud();
  }

  function accelerateMount() {
    if (mountRideState !== 'mounted' || !mountRideEntity || wheatRemaining <= 0) return false;
    wheatRemaining--;
    wheatRecoveryS = 0;
    mountBoostS = Math.max(mountBoostS, BOOST_DURATION_S);
    ridingDebug.boosts++;
    whistleMount('sfx_whistle1.mp3');
    refreshMountWheatHud();
    return true;
  }

  function mountedTrainingModifiers() {
    return window.StableAnimalProgression?.mountRidingModifiers?.() || {}; // Existing stable perk API; combat uses the same rider's training as movement.
  }

  function currentPlayerRunningSpeedPxS() {
    const computed = Number(window.CompanionMovementSpeed?.playerRunningSpeed?.(deps?.player)); // Uses the same live terrain/buff/footing target-speed formula as on-foot locomotion, even while riding.
    return Number.isFinite(computed) && computed >= 0 ? computed : Math.max(0, Number(deps?.MOVE_SPEED) || 0) * (window.ResourceSystem?.movementMultiplier?.(deps?.player, 'walk') ?? 1); // Isolated preview fixtures can still ride before the companion service initializes.
  }

  function mountedTopSpeedPxS() {
    const training = Number(mountedTrainingModifiers().baseSpeed); // Fleet Stride applies once outside the animal's shared species definition.
    const carrierMobility = window.ResourceSystem?.movementMultiplier?.(mountRideEntity, 'walk') ?? 1; // Rider mobility already lives in playerRunningSpeed; the animal has its own independent resources.
    return currentPlayerRunningSpeedPxS() * MOUNT_PLAYER_RUN_RATIO * carrierMobility * (Number.isFinite(training) && training > 0 ? training : 1);
  }

  function mountedMeleeStaminaMultiplier() {
    return Math.max(0.55, Number(mountedTrainingModifiers().meleeStamina) || 1); // Training discounts only mounted melee actions.
  }

  function mountedMeleeDamageMultiplier() {
    if (mountRideState !== 'mounted' || !mountRideEntity) return 1;
    const currentSpeed = Math.hypot(Number(mountRideEntity.vx) || 0, Number(mountRideEntity.vy) || 0); // Actual carrier displacement, not an intended or visually boosted speed.
    const baseSpeed = mountedTopSpeedPxS(); // Damage uses the same unboosted mount cap as actual riding.
    const ratio = currentSpeed / Math.max(1, baseSpeed); // Preserves extra damage from genuinely high boosted velocity, and zero bonus against collisions.
    return (1 + Math.min(1.8, Math.max(0, ratio) * 0.65)) * (Number(mountedTrainingModifiers().meleeDamage) || 1);
  }

  function setMountedCombatWindupBoost(owner, peakMultiplier, spentFraction) {
    if (mountRideState !== 'mounted' || !mountRideEntity || !owner) return false;
    const peak = Number(peakMultiplier); // The ability's mastery-adjusted maximum speed multiplier.
    const funded = Number(spentFraction); // Charge uses cumulative committed stamina; quick attacks use completed windup fraction after their upfront payment.
    if (!Number.isFinite(peak) || !Number.isFinite(funded)) return false;
    mountedWindupOwner = owner;
    mountedWindupSpentFraction = Math.max(0, Math.min(1, funded));
    const training = Math.max(1, Number(mountedTrainingModifiers().combatBurstDuration) || 1); // Sustained Gallop now builds speed sooner, rather than prolonging the boost after impact.
    const progress = Math.min(1, mountedWindupSpentFraction * training);
    mountedWindupMultiplier = progress > 0 ? 1 + (Math.min(3.5, Math.max(1, peak)) - 1) * progress * progress : 0; // Quadratic buildup avoids a sudden speed jump on the first stamina payment.
    ridingDebug.lastCombatWindup = { owner, spentFraction: mountedWindupSpentFraction, multiplier: mountedWindupMultiplier }; // Phone-readable proof of the windup's actual speed grant.
    return true;
  }

  function clearMountedCombatWindupBoost(owner) {
    if (mountedWindupOwner !== owner) return false; // An older interrupted attack must not cancel a newer technique.
    mountedWindupOwner = null;
    mountedWindupMultiplier = 0; // Actual mount velocity decelerates naturally; no fresh acceleration is supplied during Strike.
    mountedWindupSpentFraction = 0;
    return true;
  }

  function beginMountedCombatBurst(multiplier, seconds) {
    if (mountRideState !== 'mounted' || !mountRideEntity) return false;
    const mul = Number(multiplier); // Requested quick/heavy technique boost, independently clamped from wheat.
    const duration = Number(seconds); // Authored duration before the mount training extension.
    if (!Number.isFinite(mul) || mul <= 1 || !Number.isFinite(duration) || duration <= 0) return false;
    mountedCombatBoostMultiplier = Math.max(mountedCombatBoostMultiplier, Math.min(3.5, mul));
    mountedCombatBoostS = Math.max(mountedCombatBoostS, Math.min(6, duration * (Number(mountedTrainingModifiers().combatBurstDuration) || 1)));
    ridingDebug.lastCombatBurst = { multiplier: mountedCombatBoostMultiplier, durationS: mountedCombatBoostS, at: Date.now() }; // Mobile-visible proof of which burst fired.
    return true;
  }

  function updateWheatAndBreathing(m, dt, traveledPx) {
    mountBoostS = Math.max(0, mountBoostS - dt);
    mountedCombatBoostS = Math.max(0, mountedCombatBoostS - dt);
    if (mountedCombatBoostS <= 0) mountedCombatBoostMultiplier = 1;
    if (mountBoostS <= 0 && wheatRemaining < WHEAT_MAX) {
      wheatRecoveryS += dt;
      if (wheatRecoveryS >= WHEAT_RECOVER_S) {
        wheatRecoveryS -= WHEAT_RECOVER_S;
        wheatRemaining++;
      }
    }
    const spent = WHEAT_MAX - wheatRemaining;
    if (spent > 0 && traveledPx > 0.2) {
      mountBreathClockS += dt;
      const interval = Math.max(1.4, 5.2 - spent * 0.9); // More spent wheats = more frequent single exertion utterances.
      if (mountBreathClockS >= interval) {
        mountBreathClockS = 0;
        if (window.AnimalVocalizations?.mountExertion?.(m)) {
          ridingDebug.lastBreath = spent;
        }
      }
    } else mountBreathClockS = 0;
    refreshMountWheatHud();
  }

  function mountAllowedInArea(area) {
    // Used by summon and both update paths: every authored/farmhouse/cavern
    // interior rejects mounts, while all exterior exploration areas allow them.
    return area === 'farm' || area === 'town' || deps._isZoneArea(area);
  }

  // ── Shared creature gait ──────────────────────────────────────────
  // game.js already routes ordinary creature movement through
  // AudioSystem.footstepAdvance(c, distPx) before updateCreatureAnimFrame().
  // This turns that EXISTING hook into the single gait authority:
  //   actual movement -> species gait phase -> run1->run2 contact -> footstep.
  // It directly advances c.runFrame and then pins _animLastX/Y to the position
  // just consumed. game.js's existing renderer/compositor therefore displays
  // the shared gait phase without advancing a second distance-based animation.
  //
  // Mounts use the exact same hook. Their only specialization is volume:
  // when a mount contact occurs, this hook emits the loud mount playback and
  // returns false to game.js's generic tickCreatureFootsteps caller so that
  // caller does NOT add a second quiet companion footstep.
  function isCreatureGaitState(state) {
    return !!(state?.def && Array.isArray(state.def.sprites?.run) && state.def.sprites.run.length);
  }

  // Read-only: this runs per creature per animation frame, so it must not write
  // back into the shared CREATURE_DB definition. Species registered after
  // Mounts.init simply fall through to the baseline here instead of being
  // lazily patched, which also keeps an authored override actually overridable.
  function creatureGaitRate(state) {
    const authored = Number(state?.def?.gaitCyclesPerSecond); // Authored per-species override when the definition carries one.
    return authored > 0 ? authored : DEFAULT_ANIMAL_GAIT_CYCLES_PER_SECOND;
  }

  function creatureMotionSpeedPxS(state, distPx) {
    const vx = Number(state?.vx) || 0; // Current actual creature velocity where the movement path exposes it.
    const vy = Number(state?.vy) || 0; // Paired with vx above so diagonal movement keeps the same gait frequency.
    const velocitySpeed = Math.hypot(vx, vy);
    if (velocitySpeed > 0.001) return velocitySpeed;
    const def = state?.def || {};
    const authoredSpeed = state?.stableRole === 'mount'
      ? Number(def.mountSpeed)
      : Number(def.moveSpeed || def.chaseSpeed || def.mountSpeed);
    return Number.isFinite(authoredSpeed) && authoredSpeed > 0.001
      ? authoredSpeed
      : Math.max(0.001, Number(distPx) || 0.001);
  }

  function resetCreatureGait(state) {
    if (!state) return;
    state._creatureGaitFrameProgress = 0; // Absolute fractional frame progress; one full run-array traversal equals one gait cycle.
    state._creatureGaitLastHz = creatureGaitRate(state);
    state._creatureGaitLastContactCount = 0;
    state.runFrame = 0;
    state.runFrameDistPx = 0;
    state.footstepAccum = 0; // Clears the superseded independent creature footstep-distance accumulator.
    state._animLastX = state.x; // Prevents the legacy run-frame distance path from consuming the same movement again.
    state._animLastY = state.y;
  }

  function advanceCreatureGait(state, distPx) {
    if (!isCreatureGaitState(state) || !(distPx > 0)) return 0;
    const runFrames = state.def.sprites.run; // Actual species run sprites; their count defines visual phases in one gait cycle.
    const frameCount = Math.max(1, runFrames.length);
    const gaitHz = creatureGaitRate(state);
    const motionSpeedPxS = creatureMotionSpeedPxS(state, distPx);

    // dist/speed is locomotion time represented by ACTUAL ground covered.
    // Unblocked movement therefore remains exactly gaitHz regardless of
    // walk/chase/mount speed, while collision-shortened motion slows/stops
    // the gait instead of making the feet skate against an obstacle.
    const locomotionSeconds = Math.max(0, distPx / motionSpeedPxS);
    const frameAdvance = locomotionSeconds * gaitHz * frameCount;
    const startProgress = Number.isFinite(state._creatureGaitFrameProgress)
      ? state._creatureGaitFrameProgress
      : Math.max(0, Number(state.runFrame) || 0);
    const rawEndProgress = startProgress + frameAdvance;
    const nearestBoundary = Math.round(rawEndProgress); // Snap harmless FP residue at an authored frame boundary.
    const endProgress = Math.abs(rawEndProgress - nearestBoundary) < 1e-9 ? nearestBoundary : rawEndProgress;
    const firstBoundary = Math.floor(startProgress) + 1;
    const lastBoundary = Math.floor(endProgress);
    let contactCount = 0;

    for (let boundary = firstBoundary; boundary <= lastBoundary; boundary++) {
      if (frameCount === 1) {
        // A one-frame species has no literal run2 image; its cycle wrap is
        // the only possible gait contact until the species gets another frame.
        contactCount++;
        continue;
      }
      const fromFrame = ((boundary - 1) % frameCount + frameCount) % frameCount;
      const toFrame = (boundary % frameCount + frameCount) % frameCount;
      if (fromFrame === 0 && toFrame === 1) contactCount++; // Authored step frame: run1 -> run2.
    }

    state._creatureGaitFrameProgress = endProgress; // Unwrapped so exact boundary crossings cannot double-fire after a cycle wrap.
    state._creatureGaitLastHz = gaitHz;
    state._creatureGaitLastContactCount = contactCount;
    state._creatureGaitLastSpeedPxS = motionSpeedPxS;
    state.runFrame = ((Math.floor(endProgress) % frameCount) + frameCount) % frameCount;
    state.runFrameDistPx = 0;
    state.footstepAccum = 0;
    state._animLastX = state.x;
    state._animLastY = state.y;
    if (contactCount & 1) state.footstepFoot = !state.footstepFoot;
    return contactCount;
  }

  function creatureGaitDebugSnapshot(state) {
    if (!state) return null;
    const runFrames = state.def?.sprites?.run || [];
    return {
      species: state.creatureKey || state.def?.label || 'creature',
      gaitHz: creatureGaitRate(state),
      runFrame: Number(state.runFrame) || 0,
      runFrameCount: runFrames.length,
      frameProgress: Number(state._creatureGaitFrameProgress) || 0,
      lastContacts: Number(state._creatureGaitLastContactCount) || 0,
      lastSpeedPxS: Number(state._creatureGaitLastSpeedPxS) || 0,
    };
  }

  function installSharedCreatureGait() {
    const audio = window.AudioSystem;
    if (!audio) {
      window.__farmLog?.('[creature-gait] AudioSystem unavailable; shared gait hook not installed', 'audio');
      return;
    }

    let configuredSpecies = 0; // Mobile-readable count proving that the real runtime species table received the baseline.
    for (const [speciesKey, def] of Object.entries(deps?.CREATURE_DB || {})) {
      if (!Array.isArray(def?.sprites?.run) || !def.sprites.run.length) continue;
      if (!(Number(def.gaitCyclesPerSecond) > 0)) def.gaitCyclesPerSecond = DEFAULT_ANIMAL_GAIT_CYCLES_PER_SECOND; // One-time seeding at init; creatureGaitRate never writes here.
      configuredSpecies++;
    }

    if (!audio.__sharedCreatureGaitInstalled) {
      const originalFootstepAdvance = audio.footstepAdvance.bind(audio); // Preserves the existing player/NPC/trail distance helper for non-creature callers.
      audio.footstepAdvance = (state, distPx, stridePx) => {
        if (stridePx == null && isCreatureGaitState(state)) {
          const contactCount = advanceCreatureGait(state, distPx);
          if (!contactCount) return false;
          if (state.stableRole === 'mount') {
            // The shared gait owns the contact. Mounts merely substitute their
            // loud playback here; returning false suppresses game.js's generic
            // quiet-companion playback for this same contact.
            for (let i = 0; i < contactCount; i++) emitMountFootstep(state, distPx, state.def.sprites.run.length >= 2 ? 'run1->run2' : 'single-run-frame-cycle');
            return false;
          }
          return true;
        }
        return originalFootstepAdvance(state, distPx, stridePx);
      };
      audio.advanceCreatureGait = advanceCreatureGait;
      audio.resetCreatureGait = resetCreatureGait;
      audio.creatureGaitDebugSnapshot = creatureGaitDebugSnapshot;
      audio.__sharedCreatureGaitInstalled = true;
    }

    window.CreatureGait = {
      DEFAULT_CYCLES_PER_SECOND: DEFAULT_ANIMAL_GAIT_CYCLES_PER_SECOND,
      advance: advanceCreatureGait,
      reset: resetCreatureGait,
      debugSnapshot: creatureGaitDebugSnapshot,
    };
    window.__farmLog?.(`[creature-gait] shared gait installed baseline=${DEFAULT_ANIMAL_GAIT_CYCLES_PER_SECOND.toFixed(2)}Hz species=${configuredSpecies} grehlr=${Number(deps?.CREATURE_DB?.grehlr?.gaitCyclesPerSecond || 0).toFixed(2)}Hz`, 'audio');
  }

  function emitMountFootstep(m, distPx, transition = 'run1->run2') {
    const audio = window.AudioSystem; // Existing surface/water routing and recorded-footstep pool.
    if (!audio) return;
    const distanceToPlayer = Math.hypot(m.x - deps.player.x, m.y - deps.player.y);
    const earshotPx = Math.max(deps.TILE, Number(audio.FOOTSTEP_EARSHOT_PX) || deps.TILE * 9);
    if (distanceToPlayer > earshotPx) return;
    const falloff = mountRideState === 'mounted' ? 1 : Math.max(0, 1 - distanceToPlayer / earshotPx);
    const totalVolumeScale = MOUNT_FOOTSTEP_VOLUME_SCALE * falloff;
    if (totalVolumeScale <= 0.002) return;
    const perLayerVolumeScale = totalVolumeScale / MOUNT_FOOTSTEP_NATIVE_LAYERS;
    const panRangePx = Math.max(deps.TILE, Number(audio.FOOTSTEP_PAN_RANGE_PX) || deps.TILE * 5);
    const pan = mountRideState === 'mounted' ? 0 : deps.clamp((m.x - deps.player.x) / panRangePx, -1, 1);
    const tile = audio.footstepTileAt(m.areaId, m.x, m.y, m.areaGrid);
    const surfaceKey = audio.footstepSurfaceKey(m.areaId, tile?.type ?? null);
    const gaitDebug = audio.creatureGaitDebugSnapshot?.(m);

    for (let layer = 0; layer < MOUNT_FOOTSTEP_NATIVE_LAYERS; layer++) {
      audio.playFootstepSfx(m.areaId, tile, perLayerVolumeScale, pan);
    }
    mountFootstepDebug.emitted++;
    mountFootstepDebug.lastDistancePx = distPx;
    mountFootstepDebug.lastVolumeScale = totalVolumeScale;
    mountFootstepDebug.lastAtMs = Math.round(performance.now());
    mountFootstepDebug.lastTransition = transition;
    mountFootstepDebug.nativeLayers = MOUNT_FOOTSTEP_NATIVE_LAYERS;
    mountFootstepDebug.gaitHz = gaitDebug?.gaitHz ?? creatureGaitRate(m);
    if (surfaceKey !== mountFootstepDebug.surfaceKey) {
      mountFootstepDebug.surfaceKey = surfaceKey;
      window.__farmLog?.(`[mount-footstep] surface=${surfaceKey} transition=${transition} volumeScale=${totalVolumeScale.toFixed(2)} layers=${MOUNT_FOOTSTEP_NATIVE_LAYERS} gait=${mountFootstepDebug.gaitHz.toFixed(2)}Hz`, 'audio');
    }
  }

  // Mounts have no private gait. The caller tells us whether its movement
  // function already passed through game.js's generic tickCreatureFootsteps
  // hook; if not (steady ridden movement), we feed this one movement slice
  // through the SAME AudioSystem.footstepAdvance creature-gait hook exactly once.
  function updateMountLocomotion(m, dt, moving, movedPx, gaitAlreadyAdvanced = false) {
    if (moving && movedPx > 0 && !gaitAlreadyAdvanced) {
      window.AudioSystem?.footstepAdvance?.(m, movedPx);
    }
    deps.updateCreatureAnimFrame(m, dt, moving);
  }

  function toggleMount() {
    if (mountRideState === 'none') beginSummonMount();
    else if (mountRideState === 'mounted' || mountRideState === 'rushingIn') beginDismissMount();
    // 'mountingUp'/'dismountingDown'/'rushingOut': mid-transition, ignore
    // extra presses until it settles into a steady state.
  }

  // Off-screen, in a random-ish direction behind the player rather than always
  // dead behind (so the rush-in doesn't look identical every time), but only
  // on a tile that is walkable AND has a real path to the player. A fixed
  // distance point can land inside a fence/building/cliff, where the mount
  // pins itself, jitters against the collision reposition, and the rush-in
  // timeout then drags the player to it. Candidates are tried far-to-near;
  // the player's own spot is the last resort.
  function pickMountSpawnPoint() {
    const T = deps.TILE;
    const marginPx = T * 1.5;
    const maxX = deps.getActiveCols() * T - marginPx, maxY = deps.getActiveRows() * T - marginPx;
    const playerCol = Math.floor(deps.player.x / T), playerRow = Math.floor(deps.player.y / T);
    const walkable = deps.creatureTileWalkable;
    const finder = window.TilePathfinding;
    const playerTileOpen = !walkable || walkable(playerCol, playerRow);
    const baseAngle = deps.player.angle + Math.PI + (deps.rnd() - 0.5) * (Math.PI * 0.6);
    const angleSteps = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.6, -1.6, Math.PI];
    for (const distTiles of [MOUNT_SPAWN_DIST_TILES, 7, 5, 3.5]) {
      for (const da of angleSteps) {
        const a = baseAngle + da;
        const x = deps.clamp(deps.player.x + Math.cos(a) * T * distTiles, marginPx, maxX);
        const y = deps.clamp(deps.player.y + Math.sin(a) * T * distTiles, marginPx, maxY);
        const col = Math.floor(x / T), row = Math.floor(y / T);
        if (walkable && !walkable(col, row)) continue;
        if (walkable && finder && playerTileOpen) {
          const path = finder.findPath(col, row, playerCol, playerRow, walkable, {
            bounds: finder.boxAround(col, row, playerCol, playerRow, 8), maxNodes: 2500,
          });
          if (!path) continue;
        }
        return { x: (col + 0.5) * T, y: (row + 0.5) * T };
      }
    }
    return { x: deps.player.x, y: deps.player.y };
  }

  function beginSummonMount() {
    if (deps.player.climbing) {
      deps.showToast('Finish climbing before calling your mount.', false);
      window.__farmLog?.('[mount] summon blocked during cliff climb', 'wildlife');
      return;
    }
    if (!mountAllowedInArea(deps.getCurrentArea())) {
      deps.showToast('Mounts cannot be called indoors.', false);
      return;
    }
    const activeMountId = deps.getActiveMountId();
    const activeStabled = activeMountId ? deps.getStable().find(s => s.id === activeMountId) : null;
    if (!activeStabled || !deps.CREATURE_DB[activeStabled.kind]) {
      deps.showToast('No mount set in your stable.', false);
      return;
    }
    const { x: spawnX, y: spawnY } = pickMountSpawnPoint();
    const mount = deps.makeCreatureEntity(activeStabled.kind, spawnX, spawnY, {
      isCompanion: true, name: activeStabled.name, homeX: spawnX, homeY: spawnY, state: 'idle',
      master: deps.player, genotype: activeStabled.genotype, stableRole: 'mount',
    });
    if (!mount) return;
    deps.companionObjects.add(mount);
    mountRideEntity = mount;
    const priorSurfaceOverride = mount.surfaceYOverride; // Preserves any authored dynamic height override outside town.
    mount.surfaceYOverride = () => {
      const townY = mountedTownSurfaceY(mount); // The creature mesh samples this on each pose update, before rider pinning.
      return Number.isFinite(townY) ? townY : priorSurfaceOverride?.call?.(mount);
    };
    resetMountRidingResource();
    whistleMount('sfx_whistle2.m4a');
    window.GroundObstacleAvoidance?.reset('mounted'); // A summoned animal starts with no steering history from a prior ride.
    mountRideState = 'rushingIn';
    mountAngle = deps.player.angle;
    mountCurrentSpeedPxS = 0;
    mountRushInT = 0;
    window.AudioSystem?.resetCreatureGait?.(mount);
    mountFootstepDebug.emitted = 0;
    mountFootstepDebug.surfaceKey = null;
    mountFootstepDebug.lastDistancePx = 0;
    mountFootstepDebug.lastVolumeScale = 0;
    mountFootstepDebug.lastAtMs = 0;
    mountFootstepDebug.lastTransition = null;
    mountFootstepDebug.nativeLayers = 0;
    mountFootstepDebug.gaitHz = creatureGaitRate(mount);
  }

  function beginDismissMount() {
    window.GroundObstacleAvoidance?.reset('mounted');
    window.WorldActionInputClaims?.clearClaims?.('mount-riding');
    mountActionsClaimed = false;
    window.Combat?.input?.abortAllPresses?.(); // Dismount cancels any mounted hold/queued swing before the carrier begins leaving.
    if (!mountRideEntity) { mountRideState = 'none'; refreshMountWheatHud(); return; }
    // Dismounting while a low-rock jump is still active must not leave the mount
    // permanently in an airborne hop or carry its visual lift into rush-out.
    mountRideEntity._mountHop = null;
    mountRideEntity._banditLungeHopCurrent = 0;
    mountRideState = 'dismountingDown';
    refreshMountWheatHud(); // Hide the mounted-only wheat override immediately, not one frame after the dismount starts.
    mountTransitionT = 0;
    mountTransitionFromX = deps.player.x; mountTransitionFromY = deps.player.y;
    // Dismount to the mount's side (perpendicular to its heading) rather
    // than right in front of/behind it.
    const sideAngle = mountAngle + Math.PI / 2;
    mountDismountTargetX = mountRideEntity.x + Math.cos(sideAngle) * deps.TILE * 0.6;
    mountDismountTargetY = mountRideEntity.y + Math.sin(sideAngle) * deps.TILE * 0.6;
  }

  // Called from ClimbSystem.startClimb when a 'wall' (cliff) climb target is
  // found while steadily mounted. Reuses the exact same start tile ->
  // climb.landCol/landRow landing tile a dismounted climb would cross, so
  // the mount lands exactly where the player's own feet would have.
  function startClimbLeap(climb) {
    const m = mountRideEntity;
    if (mountRideState !== 'mounted' || !m || m._mountHop || climb?.type !== 'wall') return false; // Never overlap a normal rock hop with a scripted cliff crossing.
    const currentArea = deps.getCurrentArea();
    const grid = deps.getActiveGrid();
    const startCol = deps.clamp(Math.floor(m.x / deps.TILE), 0, deps.getActiveCols() - 1);
    const startRow = deps.clamp(Math.floor(m.y / deps.TILE), 0, deps.getActiveRows() - 1);
    const startTile = grid[startRow]?.[startCol];
    const landTile = grid[climb.landRow]?.[climb.landCol];
    if (!startTile || !landTile) return false;
    const angle = Math.atan2(climb.dir.y, climb.dir.x);
    const surfaceStartY = deps.tileSurfaceYInArea(startTile, currentArea);
    const surfaceEndY = deps.tileSurfaceYInArea(landTile, currentArea);
    const lock = window.CharacterActionLocks?.acquire?.({
      owner: 'mount-climb-leap',
      reason: 'leaping the cliff face on mount-back',
      participants: ['player'],
      channels: ['movement', 'tools', 'actions'],
    }) || null;
    m._climbLeap = {
      stage: 'windup', t: 0,
      startX: m.x, startY: m.y,
      endX: (climb.landCol + 0.5) * deps.TILE, endY: (climb.landRow + 0.5) * deps.TILE,
      surfaceStartY, surfaceEndY, surfaceY: surfaceStartY,
      leapDurationS: deps.clamp(MOUNT_CLIMB_LEAP_BASE_S + (climb.wallTiles || 0) * MOUNT_CLIMB_LEAP_PER_WALL_TILE_S, MOUNT_CLIMB_LEAP_BASE_S, MOUNT_CLIMB_LEAP_MAX_S),
      lock,
    };
    mountRideState = 'climbLeap';
    mountAngle = angle;
    m.facing = angle;
    m.vx = 0; m.vy = 0;
    mountCurrentSpeedPxS = 0;
    deps.setFacingAngle(angle);
    deps.player.angle = angle;
    window.__farmLog?.(`[mount] climb-leap started wallTiles=${climb.wallTiles}`, 'wildlife');
    return true;
  }

  function updateClimbLeap(dt) {
    const m = mountRideEntity;
    const leap = m?._climbLeap;
    if (!m || !leap) { if (m) { m._climbLeap = null; mountRideState = 'mounted'; } else mountRideState = 'none'; return; }
    leap.t += dt;

    if (leap.stage === 'windup') {
      const t = deps.clamp(leap.t / MOUNT_CLIMB_LEAP_WINDUP_S, 0, 1);
      m.scaleY = 1 - (1 - MOUNT_CLIMB_LEAP_CROUCH_SCALE_Y) * (1 - Math.pow(1 - t, 3));
      if (t >= 1) { leap.stage = 'uncrouch'; leap.t = 0; }
    } else if (leap.stage === 'uncrouch') {
      const t = deps.clamp(leap.t / MOUNT_CLIMB_LEAP_UNCROUCH_S, 0, 1);
      m.scaleY = MOUNT_CLIMB_LEAP_CROUCH_SCALE_Y + (1 - MOUNT_CLIMB_LEAP_CROUCH_SCALE_Y) * (1 - Math.pow(1 - t, 3));
      if (t >= 1) { m.scaleY = 1; leap.stage = 'leap'; leap.t = 0; }
    } else {
      const t = deps.clamp(leap.t / leap.leapDurationS, 0, 1);
      const eased = 1 - Math.pow(1 - t, 2); // quick launch, settles into the landing
      m.x = leap.startX + (leap.endX - leap.startX) * eased;
      m.y = leap.startY + (leap.endY - leap.startY) * eased;
      leap.surfaceY = leap.surfaceStartY + (leap.surfaceEndY - leap.surfaceStartY) * eased;
      const archUnits = Math.max(MOUNT_CLIMB_LEAP_MIN_ARC_UNITS, Math.abs(leap.surfaceEndY - leap.surfaceStartY) * MOUNT_CLIMB_LEAP_ARC_FRACTION);
      m._banditLungeHopCurrent = archUnits * Math.sin(Math.min(1, t) * Math.PI); // shared creature-renderer arc slot, see combat-animal-attacks.js's own use for Pounce
      if (t >= 1) {
        m.x = leap.endX; m.y = leap.endY;
        leap.surfaceY = leap.surfaceEndY;
        m._banditLungeHopCurrent = 0;
        leap.lock?.release?.();
        m._climbLeap = null;
        mountRideState = 'mounted';
        window.AudioSystem?.playObjectSfx?.(window.AudioSystem?.objectSfxConfig?.().climbStep);
      }
    }

    m.vx = 0; m.vy = 0;
    deps.player.x = m.x; deps.player.y = m.y;
    deps.player.vx = 0; deps.player.vy = 0;
    updateMountedCreatureMesh(m, dt, m.facing);
  }

  // A broken-Footing rider or mount cannot remain attached to a moving
  // carrier. Release in place instead of lerping a ragdoll through a wall.
  function releaseProneMountedPair(m) {
    if (!m || !['mounted', 'mountingUp', 'climbLeap'].includes(mountRideState) || !(m.prone || deps.player.prone)) return false;
    m._climbLeap?.lock?.release?.();
    m._mountHop = null; m._banditLungeHopCurrent = 0;
    window.GroundObstacleAvoidance?.reset('mounted');
    window.WorldActionInputClaims?.clearClaims?.('mount-riding');
    mountActionsClaimed = false;
    window.Combat?.input?.abortAllPresses?.();
    mountCurrentSpeedPxS = 0;
    mountRideState = 'none'; mountRideEntity = null;
    deps.despawnCreature(m); deps.companionObjects.delete(m);
    refreshMountWheatHud();
    return true;
  }

  function updateMountRide(dt) {
    ensureMountWheatHud();
    syncMountedActionClaims();
    refreshMountWheatHud();
    const mountActive = mountRideState !== 'none';
    if (mountActive !== _lastMountActiveClass) {
      _lastMountActiveClass = mountActive;
      deps.btnCallMount?.classList.toggle('active', mountActive);
    }
    if (mountRideState === 'none') return;
    const m = mountRideEntity;
    if (!m || m.health <= 0) {
      if (m) { m._climbLeap?.lock?.release?.(); deps.despawnCreature(m); deps.companionObjects.delete(m); }
      mountRideState = 'none'; mountRideEntity = null;
      return;
    }
    if (releaseProneMountedPair(m)) return;
    if (mountRideState === 'rushingIn' || mountRideState === 'rushingOut') window.ResourceSystem?.beginMovementFrame?.(m); // Summoned ground travel has the same once-per-frame wind guard as other creatures.
    // While the summoned mount is rushing in (or running out after dismount),
    // the player is still on foot. Only boarding/riding owns and cancels an active roll.
    if (mountRideState !== 'rushingIn' && mountRideState !== 'rushingOut') {
      deps.player.dodging = false;
      deps.player.dodgeT = 0;
    }
    const currentArea = deps.getCurrentArea();
    if (!mountAllowedInArea(currentArea)) {
      // Covers rushing, mounting, mounted, and dismissing states alike; no
      // mount mesh is ever relocated into an interior scene.
      m._climbLeap?.lock?.release?.();
      deps.despawnCreature(m);
      deps.companionObjects.delete(m);
      mountRideState = 'none'; mountRideEntity = null;
      deps.btnCallMount?.classList.remove('active');
      window.__farmLog?.(`[mount] dismissed at indoor boundary (${currentArea})`, 'wildlife');
      return;
    }

    // An area transition can land mid-ride-transition, not just mid-mounted.
    if (m.areaId !== currentArea) {
      relocateMountForAreaChange(m);
      if (mountRideState === 'mountingUp' || mountRideState === 'dismountingDown') {
        mountTransitionFromX = deps.player.x; mountTransitionFromY = deps.player.y;
      }
      if (mountRideState === 'dismountingDown') {
        const sideAngle = mountAngle + Math.PI / 2;
        mountDismountTargetX = m.x + Math.cos(sideAngle) * deps.TILE * 0.6;
        mountDismountTargetY = m.y + Math.sin(sideAngle) * deps.TILE * 0.6;
      }
    }

    if (mountRideState === 'rushingIn') {
      mountRushInT += dt;
      const stepStartX = m.x, stepStartY = m.y;
      const travel = deps.travelCreatureToward || deps.moveCreatureToward; // Pathfinds around fences/buildings if the straight run stalls.
      const moving = travel(m, deps.player.x, deps.player.y, MOUNT_RUSH_SPEED_PX, dt);
      const movedPx = Math.hypot(m.x - stepStartX, m.y - stepStartY);
      const aim = Math.atan2(deps.player.y - m.y, deps.player.x - m.x);
      m.facing = aim;
      updateMountedCreatureMesh(m, dt, aim);
      // moveCreatureToward already invoked the generic creature footstep hook,
      // which is now also the shared gait authority. Render only; do not
      // advance the same displacement a second time here.
      updateMountLocomotion(m, dt, moving, movedPx, true);
      const arrived = Math.hypot(deps.player.x - m.x, deps.player.y - m.y) <= deps.TILE * MOUNT_ARRIVE_PX_TILES;
      if (arrived || mountRushInT >= 6) {
        // Timed out while still stuck: bring the mount to the rider instead of
        // letting mountingUp drag the player across the map to the mount.
        if (!arrived) { m.x = deps.player.x; m.y = deps.player.y; m._travelPath = null; }
        mountRideState = 'mountingUp';
        mountTransitionT = 0;
        mountTransitionFromX = deps.player.x; mountTransitionFromY = deps.player.y;
        mountAngle = m.facing;
      }
      return;
    }

    if (mountRideState === 'mountingUp') {
      mountTransitionT = Math.min(1, mountTransitionT + dt / MOUNT_TRANSITION_S);
      deps.player.x = mountTransitionFromX + (m.x - mountTransitionFromX) * mountTransitionT;
      deps.player.y = mountTransitionFromY + (m.y - mountTransitionFromY) * mountTransitionT;
      deps.player.vx = 0; deps.player.vy = 0;
      updateMountedCreatureMesh(m, dt, m.facing);
      updateMountLocomotion(m, dt, false, 0);
      if (mountTransitionT >= 1) mountRideState = 'mounted';
      return;
    }

    if (mountRideState === 'mounted') {
      // Position/heading itself is driven by updateMountedMovement; this just
      // keeps the mount mesh synchronized with its logical transform.
      updateMountedCreatureMesh(m, dt, m.facing);
      return;
    }

    if (mountRideState === 'climbLeap') {
      updateClimbLeap(dt);
      return;
    }

    if (mountRideState === 'dismountingDown') {
      mountTransitionT = Math.min(1, mountTransitionT + dt / MOUNT_TRANSITION_S);
      deps.player.x = mountTransitionFromX + (mountDismountTargetX - mountTransitionFromX) * mountTransitionT;
      deps.player.y = mountTransitionFromY + (mountDismountTargetY - mountTransitionFromY) * mountTransitionT;
      deps.player.vx = 0; deps.player.vy = 0;
      updateMountedCreatureMesh(m, dt, m.facing);
      updateMountLocomotion(m, dt, false, 0);
      if (mountTransitionT >= 1) {
        mountRideState = 'rushingOut';
        mountRushOutAngle = m.facing + Math.PI;
        mountRushOutT = 0;
      }
      return;
    }

    if (mountRideState === 'rushingOut') {
      mountRushOutT += dt;
      const targetX = m.x + Math.cos(mountRushOutAngle) * deps.TILE * 2;
      const targetY = m.y + Math.sin(mountRushOutAngle) * deps.TILE * 2;
      const stepStartX = m.x, stepStartY = m.y;
      const moving = deps.moveCreatureToward(m, targetX, targetY, MOUNT_RUSH_SPEED_PX, dt);
      const movedPx = Math.hypot(m.x - stepStartX, m.y - stepStartY);
      updateMountedCreatureMesh(m, dt, mountRushOutAngle);
      // Same as rush-in: moveCreatureToward already consumed this movement
      // through the one shared gait/contact hook.
      updateMountLocomotion(m, dt, moving, movedPx, true);
      if (Math.hypot(deps.player.x - m.x, deps.player.y - m.y) >= deps.TILE * MOUNT_DESPAWN_DIST_TILES || mountRushOutT >= 3) {
        deps.despawnCreature(m);
        deps.companionObjects.delete(m);
        mountRideState = 'none';
        mountRideEntity = null;
      }
      return;
    }
  }

  // Town's bridge and porch tops are *physical* floor heights for the mount,
  // just as they already are for an on-foot player. Ordinary animals receive a
  // temporary terrain/support lift only after the rider is pinned, which used
  // to raise the mount without its rider (and could double the town offset).
  // The creature renderer already accepts surfaceYOverride, so keep this
  // calculation in the mount module instead of adding a second render offset.
  function mountedTownGroundAt(mount, x, z) {
    const tile = (mount.areaGrid || deps.getActiveGrid?.())?.[Math.floor(z)]?.[Math.floor(x)]; // Same underlying grid used by creature footsteps.
    if (!tile) return NaN;
    const tileY = Number(deps.tileSurfaceYInArea?.(tile, 'town')); // Town bridge tops use this absolute tile-ground datum.
    const subtleY = Number(window.HobunjiTownSubtleElevation?.sampleHeightAt?.(x, z)); // Underlying continuous town slope.
    return Number.isFinite(tileY) ? tileY + (Number.isFinite(subtleY) ? subtleY : 0) : NaN;
  }

  function sampleMountedTownPath(mount, x, z, previous = null, seedY = NaN) {
    const elevation = window.HobunjiWalkableElevation; // Shared on-foot walkable floor authority.
    const destinationGround = mountedTownGroundAt(mount, x, z);
    if (!elevation?.worldSurfaceTopAt || !Number.isFinite(destinationGround)) return null;
    const distance = previous ? Math.hypot(x - previous.x, z - previous.z) : Infinity; // Only consecutive motion can be treated as a stair approach.
    const continuous = distance <= MOUNT_TOWN_TRACKING_DISTANCE_TILES; // Do not follow a bridge path across a teleport.
    const count = continuous ? Math.min(MOUNT_TOWN_STAIR_MAX_SAMPLES, Math.max(1, Math.ceil(distance / MOUNT_TOWN_STAIR_SAMPLE_TILES))) : 1;
    let feetY = continuous ? previous.y : (Number.isFinite(seedY) ? seedY : destinationGround); // Each physical/visual path owns its separate last foot height.
    for (let i = 1; i <= count; i++) {
      const t = i / count;
      const sx = continuous ? previous.x + (x - previous.x) * t : x; // Intermediate actual stair point.
      const sz = continuous ? previous.z + (z - previous.z) * t : z;
      const groundY = i === count ? destinationGround : mountedTownGroundAt(mount, sx, sz);
      if (!Number.isFinite(groundY)) continue;
      const ceiling = Math.max(groundY, feetY) + MOUNT_TOWN_MAX_STEP_UP; // Overhead decks remain unreachable from below.
      const top = Number(elevation.worldSurfaceTopAt(sx, sz, groundY, 'town', ceiling)); // Exact absolute support top, never an additive lift.
      feetY = Number.isFinite(top) ? top : groundY;
    }
    return { y: feetY, groundY: destinationGround, onSupport: feetY > destinationGround + 0.01 }; // Exact visual contact only for an actual raised platform.
  }

  function mountedTownSurfaceY(mount) {
    const area = mount?.areaId || deps?.getCurrentArea?.();
    mount._mountedTownSurfaceActive = false;
    if (area !== 'town' || !window.HobunjiWalkableElevation?.worldSurfaceTopAt
        || !window.HobunjiTownSubtleElevation?.sampleHeightAt
        || !Number.isFinite(mount.x) || !Number.isFinite(mount.y)) {
      mount._mountedTownSurfaceArea = null;
      mount._mountedTownSurfacePrevious = null; // Prevent previous-area support history leaking into town after a transition.
      mount._mountedTownRenderPrevious = null;
      mount._mountedTownRenderOnSupport = false;
      mount._mountedTownOnSupport = false;
      return NaN;
    }
    const x = mount.x / deps.TILE, z = mount.y / deps.TILE; // Logical carrier feet, before its renderer's XZ smoothing.
    const previous = mount._mountedTownSurfaceArea === area ? mount._mountedTownSurfacePrevious : null;
    const riderY = Math.hypot(mount.x - deps.player.x, mount.y - deps.player.y) <= deps.TILE
      && Number.isFinite(deps.player.physicalFeetY) ? deps.player.physicalFeetY : NaN; // Summoning beside an already elevated rider starts at their deck height.
    const result = sampleMountedTownPath(mount, x, z, previous, riderY);
    if (!result) return NaN;
    mount._mountedTownSurfaceY = result.y;
    mount._mountedTownSurfacePrevious = { x, z, y: result.y }; // Physical jump/dismount footing follows the logical carrier.
    mount._mountedTownSurfaceArea = area;
    mount._mountedTownOnSupport = result.onSupport;
    mount._mountedTownSurfaceActive = true; // Suppress the later, duplicate animal render-only lift in town.
    return result.y;
  }

  function updateMountedCreatureMesh(mount, dt, angle) {
    deps.updateCreatureMesh(mount, dt, angle); // Existing creature renderer still owns pose, XZ smoothing and jump animation.
    if (!mount._mountedTownSurfaceActive || !mount.avatarRef?.group?.position) return;
    const position = mount.avatarRef.group.position; // Actual smoothed carrier XZ that the rider pin follows.
    const result = sampleMountedTownPath(mount, position.x, position.z,
      mount._mountedTownRenderPrevious, mount._mountedTownSurfaceY);
    if (!result) return;
    if (result.onSupport || mount._mountedTownRenderOnSupport) {
      const rootHeight = (mount.groundLift ?? mount.halfHeight ?? 0) * (mount.scaleY ?? 1); // Mirrors creature renderer root height above physical feet.
      position.y = result.y + rootHeight + (mount._banditLungeHopCurrent || 0); // Avoid Y smoothing through an actual stair top; keep hop lift.
      if (mount.groundShadow?.position) {
        mount.groundShadow.position.y = result.y + deps.characterGroundShadowSurfaceOffset(); // Ground shadow belongs to the visual bridge tread, not an ahead-of-render logical tile.
      }
    }
    mount._mountedTownRenderOnSupport = result.onSupport;
    mount._mountedTownRenderPrevious = { x: position.x, z: position.z, y: result.y }; // Separate from the potentially ahead-of-render physics position.
  }

  // Steady mounted movement gives the mount ownership of the rendered world
  // transform. Both entities keep their existing logical coordinates, but the
  // rider uses the carrier's FINAL smoothed mesh position.
  function pinMountedRiderMesh(riderMesh, seatLift = 0) {
    const m = mountRideEntity;
    const carrierPosition = m?.avatarRef?.group?.position;
    // 'climbLeap' keeps rendering exactly like 'mounted' — the rider stays
    // pinned to the mount's carrier mesh (crouch squash and leap arc
    // included) throughout the crossing, same as steady riding.
    if ((mountRideState !== 'mounted' && mountRideState !== 'climbLeap') || !carrierPosition || !riderMesh?.position) {
      mountRenderSync.active = false;
      return false;
    }

    const riderSeatOffsetY = (Number(seatLift) || 0) - (Number(m.groundLift ?? m.halfHeight) || 0);
    // Non-town animals still receive their terrain lift in the render hook,
    // *after* this pin. Mirror that single visual delta on the rider there;
    // in town the carrier already stands on the absolute deck top instead.
    const laterAnimalLift = m._mountedTownSurfaceActive ? 0
      : Number(window.HobunjiAnimalSubtleElevation?.totalLiftAt?.(carrierPosition.x, carrierPosition.z, m.areaId));
    const visualLiftY = Number.isFinite(laterAnimalLift) ? laterAnimalLift : 0; // Preserve alignment when crossing farm hills without double-lifting the town bridge.
    const targetY = carrierPosition.y + riderSeatOffsetY + visualLiftY;
    if (m._mountedTownSurfaceActive && Number.isFinite(m._mountedTownSurfaceY)) {
      deps.player.physicalFeetY = m._mountedTownSurfaceY; // Dismount, jumping, and reachable stair probes inherit the mount's actual floor.
    }
    mountRenderSync.visualLiftY = visualLiftY; // Pixel Probe can distinguish renderer-time animal lift from physical bridge footing.
    mountRenderSync.surfaceGroundY = m._mountedTownSurfaceActive ? m._mountedTownSurfaceY : null; // Mobile ground diagnostic, no console required.
    mountRenderSync.active = true;
    mountRenderSync.beforeXzDriftTiles = Math.hypot(riderMesh.position.x - carrierPosition.x, riderMesh.position.z - carrierPosition.z);
    mountRenderSync.verticalCorrectionTiles = targetY - riderMesh.position.y;
    riderMesh.position.set(carrierPosition.x, targetY, carrierPosition.z);
    mountRenderSync.afterXzDriftTiles = Math.hypot(riderMesh.position.x - carrierPosition.x, riderMesh.position.z - carrierPosition.z);
    return true;
  }

  // Catch the mount up after farm/town/wilderness area transitions instead
  // of teaching every player-transition call site about mounts.
  function relocateMountForAreaChange(m) {
    const oldScene = m.scene || deps.scene;
    oldScene.remove(m.avatarRef.group);
    if (m.groundShadow) oldScene.remove(m.groundShadow);
    const newScene = deps.getActiveScene();
    m.scene = newScene;
    m.areaGrid = deps.getActiveGrid();
    m.areaCols = deps.getActiveCols();
    m.areaRows = deps.getActiveRows();
    m.areaId = deps.getCurrentArea();
    m.x = deps.player.x; m.y = deps.player.y;
    m._mountHop = null; m._banditLungeHopCurrent = 0; // Area transitions cancel any in-flight wilderness hop before reseating the rider.
    mountRockScanS = 0;
    m.vx = 0; m.vy = 0;
    window.AudioSystem?.resetCreatureGait?.(m);
    mountFootstepDebug.surfaceKey = null;
    const col = deps.clamp(Math.floor(m.x / deps.TILE), 0, m.areaCols - 1);
    const row = deps.clamp(Math.floor(m.y / deps.TILE), 0, m.areaRows - 1);
    const surfY = m.areaGrid[row]?.[col] ? deps.tileSurfaceYInArea(m.areaGrid[row][col], m.areaId) : 0;
    m.avatarRef.group.position.set(m.x / deps.TILE, surfY + (m.groundLift ?? m.halfHeight) * (m.scaleY ?? 1), m.y / deps.TILE);
    newScene.add(m.avatarRef.group);
    if (m.groundShadow) {
      m.groundShadow.position.set(m.x / deps.TILE, surfY + deps.characterGroundShadowSurfaceOffset(), m.y / deps.TILE);
      newScene.add(m.groundShadow);
    }
    window.ResourceRings?.disposeRingHud(m);
  }

  // The jump path is permitted through only finite, genuinely low wilderness rock
  // cover. Other blocked cells (trees, fences, tall boulders, cliffs) are never
  // exempt from occupancy and continue through the existing tile detour planner.
  function smallRockAt(grid, col, row, startY) {
    const tile = grid[row]?.[col];
    if (!tile || String(tile.type || '').toLowerCase() !== 'rock' || tile.rockKind === 'undiggableBoulder' || tile.boulderId || tile.mapBoundary || tile.incline) return false;
    const top = window.ProjectileTileCover?.coverTop?.(tile, col, row);
    return Number.isFinite(top) && top > startY && top - startY <= MOUNT_HOP_MAX_ROCK_RISE;
  }

  function planMountHop(m, area, allowOpenGround = false) {
    if (!deps._isZoneArea?.(area)) return null; // Auto-rock hopping is wilderness only, never through indoor rock walls.
    const grid = deps.getActiveGrid();
    if (!Array.isArray(grid) || !grid.length) return null;
    const T = deps.TILE, dx = Math.cos(mountAngle), dy = Math.sin(mountAngle);
    const baseTile = grid[Math.floor(m.y / T)]?.[Math.floor(m.x / T)];
    const startY = deps.tileSurfaceYInArea?.(baseTile, area);
    if (!Number.isFinite(startY) || !grid) return null;
    let firstRock = -1, lastRock = -1;
    let lastCell = ''; // Skip redundant same-tile probes along a diagonal and avoid additional pathfinding.
    for (let d = 0.45; d <= 4.65; d += 0.24) {
      const x = m.x + dx * d * T, y = m.y + dy * d * T;
      const col = Math.floor(x / T), row = Math.floor(y / T);
      const cell = col + ',' + row;
      if (cell === lastCell) continue;
      lastCell = cell;
      const rock = smallRockAt(grid, col, row, startY);
      if (rock) {
        if (firstRock < 0) firstRock = d;
        lastRock = d;
        if (lastRock - firstRock > 3.15) return null; // Patch-sized, but not unbounded, rock fields can be hopped.
      } else {
        if (!deps.canPlayerOccupy(x, y)) return null; // Non-rock blockers are never jump-through surfaces.
        if (lastRock > 0 && d >= lastRock + 0.48) {
          if (firstRock > 1.05) return null; // Begin only as the small rocks approach the mount's feet.
          const destinationDistance = d + 0.18;
          const endX = m.x + dx * destinationDistance * T;
          const endY = m.y + dy * destinationDistance * T;
          if (!deps.canPlayerOccupy(endX, endY)) return null;
          return { endX, endY, distanceTiles: destinationDistance, overRock: true };
        }
      }
    }
    if (!allowOpenGround || firstRock >= 0) return null;
    const endX = m.x + dx * T * 0.8, endY = m.y + dy * T * 0.8;
    return deps.canPlayerOccupy(endX, endY) ? { endX, endY, distanceTiles: 0.8, overRock: false } : null;
  }

  function beginMountHop(m, plan, automatic) {
    if (m._mountHop) return false;
    m._mountHop = {
      x: m.x, y: m.y, endX: plan.endX, endY: plan.endY,
      elapsed: 0, duration: Math.max(0.47, Math.min(1.05, plan.distanceTiles / 4.4)),
      height: plan.overRock ? Math.max(0.86, Math.min(1.07, plan.distanceTiles * 0.27)) : 0.61,
      overRock: !!plan.overRock, // Only a rock crossing owns horizontal travel; normal jumps own the height arc.
    }; // One flight record owns the entire horizontal crossing and visual hop arc.
    mountBreathClockS = 0;
    if (automatic) ridingDebug.autoRockJumps++; else ridingDebug.manualJumps++;
    window.GroundObstacleAvoidance?.reset('mounted');
    return true;
  }

  function jumpMount() {
    if (mountRideState !== 'mounted' || !mountRideEntity || mountRideEntity._mountHop) return false;
    const plan = planMountHop(mountRideEntity, deps.getCurrentArea(), true);
    return beginMountHop(mountRideEntity, plan || {
      endX: mountRideEntity.x, endY: mountRideEntity.y, distanceTiles: 0.8, overRock: false,
    }, false); // On blocked ground a deliberate jump is vertical; it never phases through trees.
  }

  function updateMountHop(m, dt) {
    const hop = m._mountHop;
    if (!hop) return false;
    hop.elapsed = Math.min(hop.duration, hop.elapsed + dt);
    const t = hop.elapsed / hop.duration;
    const eased = t * t * (3 - 2 * t);
    if (hop.overRock) {
      m.x = hop.x + (hop.endX - hop.x) * eased;
      m.y = hop.y + (hop.endY - hop.y) * eased;
    } // Ordinary jumps leave horizontal travel to the normal riding movement and collision path.
    m._banditLungeHopCurrent = hop.height * Math.sin(Math.PI * t); // Shared creature-renderer elevation used by Pounce and cliff leaps.
    if (t >= 1) { m._banditLungeHopCurrent = 0; m._mountHop = null; }
    return true;
  }

  // Ranged auto-aim steers the mount around the currently aimed enemy, retaining the
  // acquired distance or closing just enough to get within projectile range.
  // No steering input is stolen when the rider is actively using reins.
  function mountedRangedOrbit(m, dt) {
    const key = window.RangedWeapons?.equippedRangedKey?.();
    const activeTool = window.Combat?.deps?.getActiveTool?.(); // A slotted bow does not count as drawn when melee, tools, or an item is held.
    const heldMode = window.Combat?.deps?.getHeldMode?.(); // Ranged encircling is a fired-weapon stance, not a passive mount autopilot.
    if (!key || activeTool !== 'ranged' || heldMode !== 'tool' || !window.Combat?.input?.isAutoTargetEnabled?.()) {
      mountedOrbitTarget = null;
      mountedOrbitScanS = 0;
      return null;
    }
    mountedOrbitScanS -= dt;
    if (mountedOrbitScanS <= 0 || !mountedOrbitTarget || mountedOrbitTarget.health <= 0) {
      mountedOrbitScanS = 0.2;
      let target = null; // A failed target query must never interrupt mounted movement or make a cached target a teleport beacon.
      try {
        target = window.RangedWeapons?.playerAimSolution?.(key)?.reticleTarget
          || window.RangedWeapons?.focusedHostile?.()?.candidate?.data
          || null; // Camera-reticle target has priority; fallback stays inside ranged's existing focus selector.
        ridingDebug.lastOrbitError = null;
      } catch (error) {
        ridingDebug.lastOrbitError = String(error?.message || error); // Copyable mobile diagnostic instead of an unhandled game-loop exception.
      }
      if (target !== mountedOrbitTarget) {
        mountedOrbitTarget = target;
        const distance = target ? Math.hypot(target.x - m.x, target.y - m.y) : 0;
        const range = window.RangedWeapons?.playerLockRangePx?.(key) || deps.TILE * 7;
        mountedOrbitRadiusPx = Math.max(0, Math.min(distance, range * 0.85)); // Do not enlarge close-range orbit beyond the distance at lock-on.
        const toTarget = Math.atan2((target?.y || 0) - m.y, (target?.x || 0) - m.x);
        mountedOrbitClockwise = Math.sin(mountAngle - toTarget) <= 0; // Follow whichever tangent requires the smaller heading change.
      }
    }
    const target = mountedOrbitTarget;
    if (!target || target.health <= 0 || target.areaId !== deps.getCurrentArea() || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;
    const dx = m.x - target.x, dy = m.y - target.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.001) return null;
    const outwardX = dx / distance, outwardY = dy / distance;
    const sign = mountedOrbitClockwise ? 1 : -1;
    const tangentX = -outwardY * sign, tangentY = outwardX * sign;
    const excess = Math.max(0, distance - mountedOrbitRadiusPx); // Never intentionally increase the original orbit radius.
    const inward = Math.min(1.25, excess / Math.max(deps.TILE, mountedOrbitRadiusPx * 0.3));
    const length = Math.hypot(tangentX - outwardX * inward, tangentY - outwardY * inward) || 1;
    ridingDebug.orbitTarget = target.id || target.name || target.def?.label || 'hostile';
    ridingDebug.orbitDistancePx = distance;
    ridingDebug.orbitRadiusPx = mountedOrbitRadiusPx;
    return { x: (tangentX - outwardX * inward) / length, y: (tangentY - outwardY * inward) / length };
  }

  // Replaces game.js's normal on-foot updateMovement while mounted.
  function updateMountedMovement(dt) {
    const m = mountRideEntity;
    if (!m) { mountRideState = 'none'; return; }
    const currentArea = deps.getCurrentArea();
    if (!mountAllowedInArea(currentArea)) {
      deps.despawnCreature(m);
      deps.companionObjects.delete(m);
      mountRideState = 'none'; mountRideEntity = null;
      return;
    }
    if (m.areaId !== currentArea) relocateMountForAreaChange(m);
    if (releaseProneMountedPair(m)) return;

    const rs = window.ResourceSystem; // The carrier collision owner consumes a single composed rider+mount vector.
    const keyboardVector = deps.getKeyboardVector();
    const usingKeyboard = keyboardVector.active;
    let ix = usingKeyboard ? keyboardVector.x : deps.input.x;
    let iy = usingKeyboard ? keyboardVector.y : deps.input.y;
    const reverse = window.RangedWeapons?.movementDirectionMultiplier?.(deps.player) ?? 1;
    ix *= reverse; iy *= reverse;
    const inputLen = Math.hypot(ix, iy);
    let inputStrength = 0;
    if (inputLen > 0.001) {
      inputStrength = usingKeyboard ? 1 : deps.clamp(inputLen, 0, 1);
      ix /= inputLen; iy /= inputLen;
    }

    if (deps.isShoulderSurfMode() && (ix !== 0 || iy !== 0)) {
      const aim = deps.cameraFacingAngleRad();
      const s = Math.sin(aim), c = Math.cos(aim);
      const rIx = -ix * s - iy * c;
      const rIy =  ix * c - iy * s;
      ix = rIx; iy = rIy;
    }
    if (inputStrength > .001) {
      const riderIntent = rs?.movementIntent?.(deps.player, ix, iy, deps.isShoulderSurfMode()) || { x: ix, y: iy }; // Shoulder input has inherited rider yaw already.
      const carrierIntent = rs?.movementIntent?.(m, riderIntent.x, riderIntent.y) || riderIntent;
      ix = carrierIntent.x; iy = carrierIntent.y;
    }
    deps.player.inputX = ix; deps.player.inputY = iy; deps.player.inputStrength = inputStrength;

    const topSpeed = mountedTopSpeedPxS(); // Player run ×1.1, then training; wheat and combat multipliers are applied below.
    const stepStartX = m.x, stepStartY = m.y;
    ridingDebug.orbitActive = false; // Reset the frame's steering diagnostic even when manual braking bypasses target pursuit.
    const boosting = mountBoostS > 0;
    const desiredSpeed = topSpeed * Math.max(boosting ? BOOST_SPEED_RATIO : CRUISE_SPEED_RATIO,
      mountedCombatBoostS > 0 ? mountedCombatBoostMultiplier : 0,
      mountedWindupMultiplier); // Windup accelerates the real collision-tested carrier; Strike inherits only momentum already earned.
    // Backward reins brake only when substantially opposed to the current heading.
    // Releasing controls does not stop the mount: it continues along its heading.
    const braking = inputStrength > 0.01 && Math.cos(mountAngle) * ix + Math.sin(mountAngle) * iy < -0.72;
    if (braking && !m._mountHop?.overRock) {
      mountCurrentSpeedPxS = Math.max(0, mountCurrentSpeedPxS - deps.DECEL * dt * 1.3);
      window.GroundObstacleAvoidance?.reset('mounted');
      if (mountCurrentSpeedPxS < 1) {
        // Once fully stopped, allow an explicit opposite stick/key direction to turn around.
        const desiredAngle = Math.atan2(iy, ix);
        const diff = deps.angleDiff(desiredAngle, mountAngle);
        mountAngle += deps.clamp(diff, -MOUNT_TURN_RATE_MAX * dt, MOUNT_TURN_RATE_MAX * dt);
      }
    } else {
      if (mountCurrentSpeedPxS < desiredSpeed) mountCurrentSpeedPxS = Math.min(desiredSpeed, mountCurrentSpeedPxS + deps.ACCEL * dt);
      else if (mountCurrentSpeedPxS > desiredSpeed) {
        const excessSpeed = mountCurrentSpeedPxS - desiredSpeed; // Existing physical momentum above the current wheat/combat/cruise target.
        const softBandPxS = Math.max(1, topSpeed * MOUNT_COAST_SOFT_BAND_RATIO); // Species-relative range over which coasting settles gently into cruise.
        const coastEase = 0.3 + 0.7 * deps.clamp(excessSpeed / softBandPxS, 0, 1); // Gradually reduce drag near target without asymptotic stalling.
        mountCurrentSpeedPxS = Math.max(desiredSpeed, mountCurrentSpeedPxS - deps.DECEL * dt * MOUNT_COAST_DECEL_RATIO * coastEase);
      }
      mountRockScanS -= dt;
      const scanRocks = !m._mountHop && mountRockScanS <= 0;
      if (scanRocks) mountRockScanS = MOUNT_ROCK_SCAN_INTERVAL_S;
      const rockPlan = scanRocks ? planMountHop(m, currentArea) : null;
      const autoHopped = !!rockPlan && beginMountHop(m, rockPlan, true);
      const orbit = inputStrength <= 0.01 ? mountedRangedOrbit(m, dt) : null; // User steering always wins; auto orbit only uses free-cruise heading.
      ridingDebug.orbitActive = !!orbit; // Cached target existence alone does not mean the mount is currently auto-steering.
      const steerX = inputStrength > 0.01 ? ix : (orbit?.x ?? Math.cos(mountAngle));
      const steerY = inputStrength > 0.01 ? iy : (orbit?.y ?? Math.sin(mountAngle));
      if (!m._mountHop?.overRock) {
        const assisted = autoHopped ? null : window.GroundObstacleAvoidance?.steer('mounted', currentArea, m.x, m.y, steerX, steerY, deps.TILE, deps.canPlayerOccupy, dt);
        const desiredAngle = Math.atan2(assisted?.y ?? steerY, assisted?.x ?? steerX);
        const speedRatio = topSpeed > 0 ? deps.clamp(mountCurrentSpeedPxS / topSpeed, 0, 1) : 0;
        const turnRate = MOUNT_TURN_RATE_MAX - (MOUNT_TURN_RATE_MAX - MOUNT_TURN_RATE_MIN) * speedRatio;
        const diff = deps.angleDiff(desiredAngle, mountAngle);
        mountAngle += deps.clamp(diff, -turnRate * dt, turnRate * dt);
      }
    }

    const crossingRocks = !!m._mountHop?.overRock; // Capture before the hop is cleared at landing; don't move twice on that frame.
    updateMountHop(m, dt);
    const windy = !!rs?.hasWindblown?.(deps.player) || !!rs?.hasWindblown?.(m);
    let motion = null; // Retained until rider and mount have both been synchronized to the accepted position.
    if (!crossingRocks && (mountCurrentSpeedPxS > 0.01 || windy)) {
      const dx = Math.cos(mountAngle) * mountCurrentSpeedPxS * dt, dy = Math.sin(mountAngle) * mountCurrentSpeedPxS * dt;
      motion = windy ? rs.composeMountedMovement?.(deps.player, m, dx, dy, { reference: Math.max(topSpeed, mountCurrentSpeedPxS) * dt, dt, voluntary: inputStrength > .01 && !braking }) : null;
      const desiredX = m.x + (motion?.x ?? dx);
      const desiredY = m.y + (motion?.y ?? dy);
      const minX = deps.PLAYER_RADIUS, maxX = deps.getActiveCols() * deps.TILE - deps.PLAYER_RADIUS;
      const minY = deps.PLAYER_RADIUS, maxY = deps.getActiveRows() * deps.TILE - deps.PLAYER_RADIUS;
      const nextX = deps.clamp(desiredX, minX, maxX), nextY = deps.clamp(desiredY, minY, maxY);
      const collisionBleedRate = Math.exp(-55 * dt); // Fixed per-second collision drag instead of framerate-sensitive *=0.4.
      if (deps.canPlayerOccupy(nextX, m.y)) m.x = nextX; else mountCurrentSpeedPxS *= collisionBleedRate;
      if (deps.canPlayerOccupy(m.x, nextY)) m.y = nextY; else mountCurrentSpeedPxS *= collisionBleedRate;
    }

    ridingDebug.coasting = !braking && mountCurrentSpeedPxS > desiredSpeed + 0.5; // Report actual speed after braking/collisions, not the previous frame's prediction.
    const movedDx = m.x - stepStartX;
    const movedDy = m.y - stepStartY;
    const movedPx = Math.hypot(movedDx, movedDy);
    if (dt > 0 && movedPx > 0) {
      m.vx = movedDx / dt;
      m.vy = movedDy / dt;
    } else {
      m.vx = 0; m.vy = 0;
    }
    m.facing = mountAngle;
    deps.player.x = m.x; deps.player.y = m.y;
    deps.player.vx = 0; deps.player.vy = 0;
    if (motion) rs.commitMountedMovement?.(deps.player, m, motion, Math.min(1, movedPx / Math.max(1e-8, Math.hypot(motion.x, motion.y))));
    if (releaseProneMountedPair(m)) return;
    const airborne = !!m._mountHop || (m._banditLungeHopCurrent || 0) > 0; // Ground gait/footstep contacts must pause while the mount is visibly airborne.
    updateMountLocomotion(m, dt, !airborne && (windy ? movedPx / Math.max(.001, dt) : mountCurrentSpeedPxS) > 5 && movedPx > 0, airborne ? 0 : movedPx);
    updateWheatAndBreathing(m, dt, movedPx);

    // Rider facing remains independent of mount heading while look input is active.
    let facingAngle = deps.getFacingAngle();
    if (deps.getControllerLookActive()) {
      const diff = deps.angleDiff(deps.getControllerLookAngle(), facingAngle);
      facingAngle += diff * Math.min(1, deps.FACING_LERP * 2.5 * dt);
    } else if (deps.isDesktop && deps.getMouseLookActive()) {
      if (performance.now() - deps.getLastMouseMoveTime() > deps.MOUSE_IDLE_MS) {
        deps.setMouseLookActive(false);
      } else {
        const diff = deps.angleDiff(deps.getMouseLookAngle(), facingAngle);
        facingAngle += diff * Math.min(1, deps.FACING_LERP * 2.5 * dt);
      }
    } else {
      const diff = deps.angleDiff(mountAngle, facingAngle);
      facingAngle += diff * Math.min(1, deps.FACING_LERP * dt);
    }
    deps.setFacingAngle(facingAngle);
    deps.player.angle = facingAngle;
  }

  window.Mounts = {
    init,
    toggleMount,
    updateMountRide,
    updateMountedMovement,
    pinMountedRiderMesh,
    startClimbLeap,
    get rideState() { return mountRideState; },
    get rideEntity() { return mountRideEntity; },
    get heading() { return mountAngle; },
    get renderSync() { return { ...mountRenderSync }; },
    get footstepDebug() { return { ...mountFootstepDebug }; },
    mountedTopSpeedPxS,
    get ridingDebug() { return { ...ridingDebug, movement: window.ResourceSystem?.movementDebug?.(deps?.player) || null, carrierMovement: mountRideEntity ? window.ResourceSystem?.movementDebug?.(mountRideEntity) || null : null, playerRunSpeedPxS: currentPlayerRunningSpeedPxS(), topSpeedPxS: mountedTopSpeedPxS(), wheatRemaining, boostSeconds: mountBoostS, combatBoostSeconds: mountedCombatBoostS, combatBoostMultiplier: mountedCombatBoostMultiplier, windupOwner: mountedWindupOwner, windupSpentFraction: mountedWindupSpentFraction, windupMultiplier: mountedWindupMultiplier, meleeDamageMultiplier: mountedMeleeDamageMultiplier(), rechargeSeconds: wheatRecoveryS, cruise: mountRideState === 'mounted', jumping: !!mountRideEntity?._mountHop, speedPxS: mountCurrentSpeedPxS, coasting: mountRideState === 'mounted' && !!ridingDebug.coasting, orbitActive: !!ridingDebug.orbitActive, claimed: mountActionsClaimed }; },
    accelerateMount, jumpMount,
    beginMountedCombatBurst, setMountedCombatWindupBoost, clearMountedCombatWindupBoost, mountedMeleeDamageMultiplier, mountedMeleeStaminaMultiplier,
  };
})();

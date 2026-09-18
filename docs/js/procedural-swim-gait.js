// Shared procedural swim locomotion for runtime + Procedural Animation Editor.
//
// Runtime owns only two swim-specific visual behaviors:
//   1) the existing procedural legs switch from ground gait to an alternating
//      non-grounded kick while the player is moving through swim water;
//   2) game.js uses this module's shared facing helper to point the whole player
//      rig along movement while swimming. No swim code translates the player on Y.
//
// The Procedural Animation Editor loads this same file and previews the exact
// same kick sampler/IK solve, so editor tuning cannot drift into a fake copy of
// the in-game motion.
(() => {
  'use strict';

  if (window.HobunjiProceduralSwimGait) return;

  const VERSION = 1; // Used by both loader seams to verify this module finished installing.
  const MOVE_EPSILON_SQ = 1e-8; // Used to reject zero/jitter movement deltas before changing swim facing.
  const SWIM_SPEED_EPSILON = 0.02; // Used to distinguish active swimming from merely standing in a water tile.
  const DEFAULT_TUNING = Object.freeze({ // Shared starting values used by runtime and the editor's Swim panel.
    cadenceHz: 2.0,
    kickReachRatio: 0.30,
    kickLiftRatio: 0.08,
    kneeBendDeg: 30,
    minMovingStrength: 0.45,
  });
  const tuning = { ...DEFAULT_TUNING }; // Mutable live tuning read by every newly-updated runtime/editor swim pose.
  const runtimeState = { // Mobile-readable runtime state populated by the wrapped player leg update.
    installed: false,
    swimming: false,
    moving: false,
    hasDirection: false,
    desiredYaw: 0,
    moveDx: 0,
    moveDy: 0,
    speed: 0,
    strength: 0,
    phase: 0,
    blend: 0,
    lastX: null,
    lastY: null,
    lastReason: 'not-installed',
  };
  const editorState = { // Mobile/editor-readable state populated by the Swim authoring preview loop.
    installed: false,
    enabled: false,
    directionDeg: 0,
    speedStrength: 1,
    phase: 0,
    blend: 0,
    rigReady: false,
    modelName: null,
    rigName: null,
    lastReason: 'not-installed',
  };

  function finite(value, fallback = 0) {
    const number = Number(value); // Used as the normalized numeric value returned below.
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, finite(value))); // Used for animation blend/strength inputs throughout the module.
  }

  function damp(current, target, lambda, dt) {
    const seconds = Math.max(0, finite(dt)); // Used to make mode transitions frame-rate independent.
    return current + (target - current) * (1 - Math.exp(-Math.max(0, finite(lambda)) * seconds));
  }

  function wrapSignedAngle(angle) {
    return Math.atan2(Math.sin(angle), Math.cos(angle)); // Used to choose the shortest yaw delta at the -PI/PI seam.
  }

  function facingYawFromMovement(dx, dy) {
    const x = finite(dx); // Used as the resolved world-X movement component.
    const y = finite(dy); // Used as the resolved map-Y/world-Z movement component.
    if (x * x + y * y <= MOVE_EPSILON_SQ) return null;
    const rawMovementAngle = Math.atan2(y, x); // Used to mirror game.js's player.angle convention.
    return wrapSignedAngle(-rawMovementAngle + Math.PI * 0.5);
  }

  function sampleKick(phase, strength = 1, sourceTuning = tuning) {
    const cycle = ((finite(phase) % 1) + 1) % 1; // Used to keep arbitrary phase input in one animation cycle.
    const power = clamp01(strength); // Used to scale authored kick amplitude without changing phase.
    const wave = Math.sin(cycle * Math.PI * 2); // Used for forward/back alternating leg travel.
    const liftWave = Math.cos(cycle * Math.PI * 2); // Used for the smaller up/down flutter component.
    const reach = Math.max(0, finite(sourceTuning?.kickReachRatio, DEFAULT_TUNING.kickReachRatio)); // Used to scale travel by anatomical leg length.
    const lift = Math.max(0, finite(sourceTuning?.kickLiftRatio, DEFAULT_TUNING.kickLiftRatio)); // Used to scale vertical flutter by anatomical leg length.
    const bend = Math.max(0, finite(sourceTuning?.kneeBendDeg, DEFAULT_TUNING.kneeBendDeg)); // Used to keep the kick visibly articulated instead of rigid-legged.
    const flexWave = 0.28 + 0.72 * (0.5 + 0.5 * -wave); // Used to flex most while that leg sweeps backward.
    return {
      travelRatio: wave * reach * power,
      liftRatio: liftWave * lift * power,
      bendDegX: -bend * flexWave * power,
      wave,
    };
  }

  function syncBoneGuideLength(parent, length) {
    for (const child of Array.from(parent?.children || [])) { // Used to keep optional runtime leg-bone diagnostics aligned with the solved chain.
      if (!child?.isMesh || child.geometry?.type !== 'CylinderGeometry') continue;
      child.scale.y = length;
      child.position.y = -length * 0.5;
    }
  }

  function legPart(root, side, part) {
    return root?.getObjectByName?.(`${side}_${part}`) || null; // Used by the same controller for runtime bones and editor shim proxies.
  }

  function makeThreeFacade(root) {
    const Vector3 = root?.position?.constructor; // Used by the shared LegBones solver for local foot targets.
    const Quaternion = root?.quaternion?.constructor; // Used by the shared LegBones solver for solved thigh/calf orientation.
    const Euler = root?.rotation?.constructor; // Used by the shared LegBones solver for authored knee bend.
    if (!Vector3 || !Quaternion || !Euler) return null;
    return {
      Vector3,
      Quaternion,
      Euler,
      MathUtils: { degToRad: degrees => finite(degrees) * Math.PI / 180 }, // Used by LegBones without depending on window.THREE in the editor.
    };
  }

  function createLegController(root, options = {}) {
    const THREE = options.THREE || makeThreeFacade(root); // Used by all vector/quaternion work in this controller.
    const solveTwoBoneLeg = window.LegBones?.solveTwoBoneLeg; // Used to drive the exact same two-bone chain as ordinary walking.
    if (!root?.worldToLocal || !THREE?.Vector3 || typeof solveTwoBoneLeg !== 'function') return null;

    const state = { // Used by update(), debug output, and smooth walk<->swim transitions.
      phase: 0,
      blend: 0,
      strength: 0,
      active: false,
      leftNeutral: new THREE.Vector3(),
      rightNeutral: new THREE.Vector3(),
      currentFoot: new THREE.Vector3(),
      effectiveHip: new THREE.Vector3(),
      target: new THREE.Vector3(),
      blendedTarget: new THREE.Vector3(),
      neutralReady: false,
    };

    function captureNeutralSide(side) {
      const foot = legPart(root, side, 'foot'); // Used as the current neutral endpoint after the underlying gait layer updates.
      const target = side === 'left' ? state.leftNeutral : state.rightNeutral; // Stores this side's baseline endpoint for kick offsets.
      if (!foot?.getWorldPosition) return false;
      root.updateMatrixWorld?.(true);
      foot.getWorldPosition(target);
      root.worldToLocal(target);
      return true;
    }

    function captureNeutral() {
      const leftReady = captureNeutralSide('left'); // Used to verify the left leg exposes the expected procedural hierarchy.
      const rightReady = captureNeutralSide('right'); // Used to verify the right leg exposes the expected procedural hierarchy.
      state.neutralReady = leftReady && rightReady;
      return state.neutralReady;
    }

    function applySide(side, sidePhase, sourceTuning) {
      const hip = legPart(root, side, 'hip'); // Used as the fixed anatomical start of this leg solve.
      const thigh = legPart(root, side, 'thigh'); // Receives the solved upper-leg quaternion.
      const calf = legPart(root, side, 'calf'); // Receives the solved lower-leg offset/quaternion.
      const foot = legPart(root, side, 'foot'); // Receives the solved lower-leg length while preserving its authored foot rotation.
      const neutral = side === 'left' ? state.leftNeutral : state.rightNeutral; // Used as the non-grounded kick's center point.
      if (!hip?.position || !thigh?.quaternion || !calf?.position?.set || !calf?.quaternion || !foot?.position?.set || !foot?.getWorldPosition) return false;

      root.updateMatrixWorld?.(true);
      foot.getWorldPosition(state.currentFoot);
      root.worldToLocal(state.currentFoot);
      state.effectiveHip.copy(hip.position);
      if (thigh.position?.isVector3) state.effectiveHip.add(thigh.position); // Preserves any upstream low-Footing/drunk hip offset already composed this frame.
      const legLength = Math.max(0.001, state.effectiveHip.distanceTo(neutral)); // Used to normalize kick size across species proportions.
      const pose = sampleKick(sidePhase, state.strength, sourceTuning); // Used to derive this leg's authored flutter offset and knee flex.
      state.target.copy(neutral);
      state.target.z += pose.travelRatio * legLength;
      state.target.y += pose.liftRatio * legLength;
      state.blendedTarget.copy(state.currentFoot).lerp(state.target, state.blend);
      const solved = solveTwoBoneLeg(THREE, { // Used to convert the swim endpoint into the shared hip/thigh/calf hierarchy.
        hip: state.effectiveHip,
        foot: state.blendedTarget,
        bendDegX: pose.bendDegX,
        bendDegZ: 0,
      });
      thigh.quaternion.copy(solved.thighQuaternion);
      calf.position.set(0, -solved.thighLength, 0);
      calf.quaternion.copy(solved.calfLocalQuaternion);
      foot.position.set(0, -solved.calfLength, 0);
      syncBoneGuideLength(thigh, solved.thighLength);
      syncBoneGuideLength(calf, solved.calfLength);
      return true;
    }

    function update(dt, requestedStrength, sourceTuning = tuning, refreshNeutral = true) {
      const strength = clamp01(requestedStrength); // Used to scale both kick amplitude and cadence.
      state.strength = strength;
      if (!(strength > 0)) {
        state.blend = 0; // The base locomotion layer has already restored walk/idle this frame; do not overwrite it during a swim blend-out.
        state.active = false;
        return false;
      }
      state.blend = damp(state.blend, 1, 12, dt); // Used only to ease INTO swim; exit immediately yields ownership back to the base gait.
      state.active = state.blend > 0.01;
      if (refreshNeutral || !state.neutralReady) captureNeutral();
      if (!state.active || !state.neutralReady) return false;
      const cadence = Math.max(0.1, finite(sourceTuning?.cadenceHz, DEFAULT_TUNING.cadenceHz)); // Used to advance the alternating flutter cycle.
      if (strength > 0 && dt > 0) state.phase = (state.phase + Math.max(0, finite(dt)) * cadence * (0.65 + 0.35 * strength)) % 1;
      applySide('left', state.phase, sourceTuning);
      applySide('right', state.phase + 0.5, sourceTuning);
      return true;
    }

    return { update, captureNeutral, state }; // Exposes only the shared controller seam needed by runtime/editor adapters.
  }

  function runtimeWaterCheck(player) {
    const authoritativeCheck = window.Combat?.deps?.isPlayerSwimming; // Same gameplay predicate that owns water slowdown and the combat lockout.
    if (typeof authoritativeCheck === 'function') return !!authoritativeCheck();
    const sharedCheck = window.HobunjiAnimalSubtleElevation?.isInSwimWater; // Fallback retained for unusual bootstrap/tool contexts.
    if (typeof sharedCheck === 'function') return !!sharedCheck(player);
    const tileSize = Math.max(0, finite(window.Combat?.deps?.TILE)); // Fallback converts logical player pixels into active-grid coordinates.
    if (!(tileSize > 0) || !Number.isFinite(player?.x) || !Number.isFinite(player?.y)) return false;
    const col = Math.floor(player.x / tileSize); // Used by the fallback active-grid lookup.
    const row = Math.floor(player.y / tileSize); // Used by the fallback active-grid lookup.
    const tile = window.GridTileAccessors?.getActiveTileAt?.(col, row) || window.GridTileAccessors?.getActiveGrid?.()?.[row]?.[col] || null; // Used only when the shared water bridge is unavailable.
    return tile?.type === 'river' || tile?.type === 'stream';
  }

  function playerStrength(speed) {
    const referenceSpeed = Math.max(0.1, finite(window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet?.referenceSpeedWorldUnitsPerSecond, 4.3)); // Used to normalize moving swim kick intensity across game speed tuning.
    const ratio = clamp01(Math.max(0, finite(speed)) / referenceSpeed); // Used to strengthen the kick smoothly from analog movement to full swim speed.
    if (!(speed > SWIM_SPEED_EPSILON)) return 0;
    return Math.max(clamp01(tuning.minMovingStrength), Math.sqrt(ratio));
  }

  function updateResolvedMovement(player, speed, dt) {
    const x = finite(player?.x, NaN); // Used with lastX to measure actual post-collision movement rather than input intent.
    const y = finite(player?.y, NaN); // Used with lastY to measure actual post-collision movement rather than input intent.
    const hadPrevious = Number.isFinite(runtimeState.lastX) && Number.isFinite(runtimeState.lastY); // Prevents spawn/first-frame coordinates from becoming a fake swim direction.
    const dx = hadPrevious && Number.isFinite(x) ? x - runtimeState.lastX : 0; // Used as resolved horizontal movement this frame.
    const dy = hadPrevious && Number.isFinite(y) ? y - runtimeState.lastY : 0; // Used as resolved map-depth movement this frame.
    runtimeState.lastX = Number.isFinite(x) ? x : runtimeState.lastX;
    runtimeState.lastY = Number.isFinite(y) ? y : runtimeState.lastY;
    runtimeState.moveDx = dx;
    runtimeState.moveDy = dy;
    const tileSize = Math.max(1, finite(window.Combat?.deps?.TILE, 48)); // Converts logical player-pixel displacement into the same world-units/sec scale used by ProceduralLegAnimation.
    const actualSpeed = hadPrevious && finite(dt) > 1e-6 ? Math.hypot(dx, dy) / (tileSize * finite(dt)) : 0; // Preserves kick effort when collision code zeroes vx/vy but performs a tangent sidestep.
    runtimeState.speed = Math.max(0, finite(speed), actualSpeed);
    runtimeState.moving = runtimeState.swimming && runtimeState.speed > SWIM_SPEED_EPSILON && dx * dx + dy * dy > MOVE_EPSILON_SQ;
    if (!runtimeState.moving) return;
    const yaw = facingYawFromMovement(dx, dy); // Used as the final visual body direction while swimming.
    if (yaw == null) return;
    runtimeState.desiredYaw = yaw;
    runtimeState.hasDirection = true;
  }

  function installRuntime() {
    const legApi = window.ProceduralLegAnimation; // Used as the shared attachment seam for the player's existing procedural legs.
    const THREE = window.THREE; // Used by the runtime leg controller.
    if (!legApi?.attach || !THREE || legApi.__proceduralSwimGaitInstalled) return false;
    const previousAttach = legApi.attach.bind(legApi); // Used to preserve ordinary walk/run/drunk/prone leg decorators.
    legApi.attach = function proceduralSwimAwareAttach(THREEArg, parent, options = {}) {
      const handle = previousAttach(THREEArg, parent, options); // Receives the fully decorated ordinary locomotion handle.
      if (!handle || String(options.name || '').toLowerCase() !== 'player' || typeof handle.update !== 'function') return handle;
      const controller = createLegController(handle.group, { THREE: THREEArg }); // Used to layer the non-grounded kick after the normal locomotion stack.
      if (!controller) return handle;
      const playerAtAttach = window.Combat?.deps?.player; // Resets movement diagnostics whenever refreshPlayerAvatar replaces the player rig.
      runtimeState.lastX = Number.isFinite(playerAtAttach?.x) ? playerAtAttach.x : null;
      runtimeState.lastY = Number.isFinite(playerAtAttach?.y) ? playerAtAttach.y : null;
      runtimeState.hasDirection = false;
      runtimeState.moving = false;
      runtimeState.strength = 0;
      runtimeState.blend = 0;
      const previousUpdate = handle.update.bind(handle); // Used to run ordinary locomotion first each frame so its neutral pose remains authoritative.
      handle.update = function proceduralSwimPlayerLegUpdate(dt, speedWorldUnitsPerSecond, suppressed, seatedPose) {
        const player = window.Combat?.deps?.player; // Used as the authoritative logical position/prone state for swim detection and direction.
        const swimming = !!player && !player.prone && !seatedPose && !suppressed && runtimeWaterCheck(player); // Used to switch ground gait off only during real, unsuppressed swim-water locomotion.
        runtimeState.swimming = swimming;
        if (!swimming) runtimeState.hasDirection = false; // Prevents a stale prior swim heading from snapping the body when water is re-entered before movement.
        updateResolvedMovement(player, speedWorldUnitsPerSecond, dt);
        const effectiveSuppressed = !!suppressed || swimming; // Prevents ground-contact walk/run solving underneath the non-grounded swim kick.
        const result = previousUpdate(dt, speedWorldUnitsPerSecond, effectiveSuppressed, seatedPose);
        runtimeState.strength = swimming ? playerStrength(runtimeState.speed) : 0;
        if (swimming && handle.group?.rotation) handle.group.rotation.y = 0; // game.js normally counter-rotates feet against billboard dead-zone yaw; swim owns the whole body as one facing.
        controller.update(dt, runtimeState.strength, tuning, true);
        runtimeState.phase = controller.state.phase;
        runtimeState.blend = controller.state.blend;
        runtimeState.lastReason = swimming
          ? (runtimeState.strength > 0 ? 'swimming-kick' : 'swimming-idle')
          : 'not-swimming';
        return result;
      };
      return handle;
    };
    legApi.__proceduralSwimGaitInstalled = true;
    runtimeState.installed = true;
    runtimeState.lastReason = 'installed-waiting-for-player';
    return true;
  }

  function editorLog(message, level = 'info', extra = null) {
    const backdropLog = window.HobunjiGameplayBackdrop?.log; // Used to keep diagnostics visible inside the editor on mobile.
    if (backdropLog) { backdropLog(message, level, extra); return; }
    const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info; // Used only if the editor's visible log API is unavailable.
    logger(message, extra ?? '');
  }

  function updateEditorStatus(message, good = true) {
    const status = document.getElementById('statusPill'); // Used as the editor's existing mobile-visible status surface.
    if (!status) return;
    status.textContent = message;
    status.className = good ? 'pill good' : 'pill warn';
  }

  function editorShimRoot(model) {
    return Array.from(model?.children || []).find(child => child?.userData?.editorGeneratedFeetDanceBridge || /_procedural_feet$/i.test(String(child?.name || ''))) || null; // Reuses Dance's adapter over the editor's canonical generated feet/bone lines.
  }

  function editorThree(root) {
    return makeThreeFacade(root); // Uses constructors already owned by the editor scene because window.THREE is not guaranteed there.
  }

  function copyEditorConfig() {
    const payload = JSON.stringify({ proceduralSwim: { ...tuning } }, null, 2); // Used as the portable authored tuning block copied from the editor.
    navigator.clipboard?.writeText(payload).then(
      () => updateEditorStatus('Copied procedural swim tuning.', true),
      () => window.prompt?.('Copy procedural swim tuning:', payload),
    );
  }

  function installEditorStyles() {
    if (document.getElementById('proceduralSwimGaitStyles')) return;
    const style = document.createElement('style'); // Used for the editor-only Swim authoring card and responsive mobile layout.
    style.id = 'proceduralSwimGaitStyles';
    style.textContent = `
#proceduralSwimPanel{position:fixed;z-index:10030;right:max(10px,env(safe-area-inset-right));bottom:max(10px,env(safe-area-inset-bottom));width:min(360px,calc(100vw - 20px));max-height:min(620px,calc(100dvh - 90px));overflow:auto;padding:12px;border:1px solid rgba(255,255,255,.18);border-radius:14px;background:rgba(7,16,26,.97);box-shadow:0 18px 60px rgba(0,0,0,.55);color:#e5eef9;font:12px/1.35 system-ui,sans-serif}
#proceduralSwimPanel[hidden]{display:none!important}#proceduralSwimButton.active{outline:2px solid rgba(107,169,255,.65);outline-offset:-2px}#proceduralSwimPanel h3{margin:0 0 4px;font-size:15px}#proceduralSwimPanel .swimMuted{opacity:.72;margin-bottom:9px}#proceduralSwimPanel .swimField{display:grid;grid-template-columns:1fr 96px;align-items:center;gap:10px;margin:7px 0}#proceduralSwimPanel input[type=range]{width:100%}#proceduralSwimPanel output{text-align:right;font:11px monospace}#proceduralSwimPanel .swimActions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}#proceduralSwimPanel .swimDebug{white-space:pre-wrap;overflow-wrap:anywhere;margin:9px 0 0;padding:8px;border-radius:9px;background:rgba(0,0,0,.28);font:10px/1.35 monospace;max-height:126px;overflow:auto}@media(max-width:700px){#proceduralSwimPanel{right:4px;bottom:4px;width:calc(100vw - 8px);max-height:44dvh;padding:9px;border-radius:11px}#proceduralSwimPanel .swimField{margin:5px 0}}
`;
    document.head.appendChild(style);
  }

  function editorPanelMarkup() {
    return `<h3>Swim procedural movement</h3><div class="swimMuted">Use the editor's normal WASD / stick / touch movement. Swim faces the actual preview travel direction and replaces ground stepping with the shared alternating kick. Runtime never changes body Y.</div>
      <div id="swimEditorMotion" class="swimMuted">Movement: idle</div>
      <label class="swimField"><span>Kick cadence</span><span><input id="swimEditorCadence" type="range" min="0.5" max="4" step="0.05" value="${tuning.cadenceHz}"><output id="swimEditorCadenceOut">${tuning.cadenceHz.toFixed(2)} Hz</output></span></label>
      <label class="swimField"><span>Kick reach</span><span><input id="swimEditorReach" type="range" min="0" max="0.7" step="0.01" value="${tuning.kickReachRatio}"><output id="swimEditorReachOut">${Math.round(tuning.kickReachRatio * 100)}%</output></span></label>
      <label class="swimField"><span>Kick lift</span><span><input id="swimEditorLift" type="range" min="0" max="0.3" step="0.01" value="${tuning.kickLiftRatio}"><output id="swimEditorLiftOut">${Math.round(tuning.kickLiftRatio * 100)}%</output></span></label>
      <label class="swimField"><span>Knee bend</span><span><input id="swimEditorBend" type="range" min="0" max="70" step="1" value="${tuning.kneeBendDeg}"><output id="swimEditorBendOut">${Math.round(tuning.kneeBendDeg)}°</output></span></label>
      <div class="swimActions"><button id="swimEditorReset" class="secondary" type="button">Reset defaults</button><button id="swimEditorCopy" class="secondary" type="button">Copy config</button></div>
      <pre id="swimEditorDebug" class="swimDebug">Waiting for avatar rig…</pre>`;
  }

  function bindEditorControls(panel) {
    const bindings = [ // Keeps shared runtime/editor tuning and compact labels synchronized.
      ['swimEditorCadence', 'swimEditorCadenceOut', value => { tuning.cadenceHz = value; return `${value.toFixed(2)} Hz`; }],
      ['swimEditorReach', 'swimEditorReachOut', value => { tuning.kickReachRatio = value; return `${Math.round(value * 100)}%`; }],
      ['swimEditorLift', 'swimEditorLiftOut', value => { tuning.kickLiftRatio = value; return `${Math.round(value * 100)}%`; }],
      ['swimEditorBend', 'swimEditorBendOut', value => { tuning.kneeBendDeg = value; return `${Math.round(value)}°`; }],
    ];
    for (const [inputId, outputId, apply] of bindings) {
      const input = panel.querySelector(`#${inputId}`);
      const output = panel.querySelector(`#${outputId}`);
      input?.addEventListener('input', () => { if (output) output.textContent = apply(finite(input.value)); });
    }
    panel.querySelector('#swimEditorReset')?.addEventListener('click', () => {
      Object.assign(tuning, DEFAULT_TUNING);
      const resetValues = { swimEditorCadence: tuning.cadenceHz, swimEditorReach: tuning.kickReachRatio, swimEditorLift: tuning.kickLiftRatio, swimEditorBend: tuning.kneeBendDeg };
      for (const [id, value] of Object.entries(resetValues)) {
        const input = panel.querySelector(`#${id}`);
        if (input) { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }
      }
      updateEditorStatus('Swim gait reset to runtime defaults.', true);
    });
    panel.querySelector('#swimEditorCopy')?.addEventListener('click', copyEditorConfig);
  }

  function installEditor() {
    if (typeof document === 'undefined' || editorState.installed) return false;
    const actionRow = document.querySelector('#animationHud .animationHudActions'); // Native procedural-movement HUD extension point; Dance uses this same row.
    if (!actionRow) return false;
    installEditorStyles();

    const swimButton = document.createElement('button'); // Toggles the Swim movement layer inside the actual Procedural movement HUD.
    swimButton.id = 'proceduralSwimButton';
    swimButton.type = 'button';
    swimButton.className = 'secondary';
    swimButton.textContent = 'Swim';
    actionRow.appendChild(swimButton);

    const panel = document.createElement('section'); // Mobile-safe authoring surface for shared runtime/editor kick tuning.
    panel.id = 'proceduralSwimPanel';
    panel.hidden = true;
    panel.innerHTML = editorPanelMarkup();
    document.body.appendChild(panel);
    bindEditorControls(panel);

    let controller = null; // Persists authored kick phase while the same generated-feet shim remains active.
    let controllerRoot = null; // Detects avatar/rig rebuilds and recreates the shared controller safely.
    let activeModel = null; // Detects a newly-selected preview avatar.
    let lastRenderTime = performance.now(); // Converts renderer calls into frame-independent swim dt.
    let lastEditorX = null; // Previous native locomotion-root X used to measure actual editor travel.
    let lastEditorZ = null; // Previous native locomotion-root Z used to measure actual editor travel.
    let lastEditorYaw = null; // Holds swim facing while the preview is momentarily stationary, matching runtime behavior.
    let editorReferenceSpeed = 2.38; // Normalizes kick effort to the current procedural editor movement-speed setting.
    let editorFeetAnalysis = null; // Cached native idle foot anchors used to center the swim kick instead of a captured walking stride.
    let rendererHookInstalled = false; // Prevents wrapping the editor renderer more than once.
    const rendererWaitStartedAt = performance.now(); // Bounds the installation-only retry so a broken editor does not poll forever.

    function leaveSwimMode(reason = 'editor-mode-inactive') {
      editorState.enabled = false;
      panel.hidden = true;
      swimButton.classList.remove('active');
      activeModel = null;
      controller = null;
      controllerRoot = null;
      lastEditorX = null;
      lastEditorZ = null;
      lastEditorYaw = null;
      editorState.rigReady = false;
      editorState.speedStrength = 0;
      editorState.lastReason = reason;
    }

    function findEditorNativeFeet(canonicalRoot) {
      const experimentalRoot = canonicalRoot?.parent?.children?.find?.(node =>
        /_ExperimentalFeet$/i.test(String(node?.name || '')) || node?.userData?.experimentalFeet
      ) || null;
      return Array.from(experimentalRoot?.children || []).filter(node =>
        /_(?:Left|Right)Foot$/i.test(String(node?.name || '')) || node?.userData?.footSide
      );
    }

    function snapshotNode(node) {
      if (!node?.position || !node?.quaternion || !node?.scale) return null;
      return { node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() };
    }

    function captureEditorRenderState(model) {
      const scene = window.HobunjiGameplayBackdrop?.getScene?.() || null;
      const canonicalRoot = scene?.getObjectByName?.('LegBonesDebug') || null;
      const locomotionRoot = canonicalRoot?.parent || model?.parent?.parent?.parent || null; // Native floor root owns actual preview X/Z travel and heading.
      const poseRoot = model?.parent || null; // Native directional walk/drunk pose root; neutralized only for the Swim draw.
      const avatarLiftRoot = poseRoot?.parent || null; // Native half-height + walk-bob root; bob is removed only for the Swim draw.
      const lines = Array.from(canonicalRoot?.children || []).filter(node => node?.isLine).map(line => {
        const position = line.geometry?.attributes?.position;
        return position ? { line, values: Array.from(position.array) } : null;
      }).filter(Boolean);
      const feet = findEditorNativeFeet(canonicalRoot).map(foot => ({ foot, position: foot.position.clone() }));
      return {
        model,
        canonicalRoot,
        locomotionRoot,
        poseRoot,
        avatarLiftRoot,
        nodeTransforms: [locomotionRoot, avatarLiftRoot, poseRoot].map(snapshotNode).filter(Boolean),
        lines,
        feet,
      };
    }

    function restoreEditorRenderState(snapshot) {
      if (!snapshot) return;
      for (const saved of snapshot.nodeTransforms) {
        saved.node.position.copy(saved.position);
        saved.node.quaternion.copy(saved.quaternion);
        saved.node.scale.copy(saved.scale);
      }
      for (const saved of snapshot.feet) {
        saved.foot?.position?.copy?.(saved.position);
        saved.foot?.updateMatrixWorld?.(true);
      }
      for (const saved of snapshot.lines) {
        const position = saved.line?.geometry?.attributes?.position;
        if (!position?.array || position.array.length !== saved.values.length) continue;
        position.array.set(saved.values);
        position.needsUpdate = true;
        saved.line.geometry.computeBoundingSphere?.();
      }
      snapshot.locomotionRoot?.updateMatrixWorld?.(true);
    }

    function refreshEditorMovementReference() {
      const movement = window.HobunjiGameplayBackdrop?.getProceduralMovement?.() || null; // Read only on mode/rig changes, not every frame; this export clones the full authoring record.
      editorReferenceSpeed = Math.max(0.1, finite(movement?.settings?.speed, 2.38));
      editorFeetAnalysis = movement?.experimentalFeet?.available ? movement.experimentalFeet : null;
    }

    function captureControllerIdleNeutral(snapshot) {
      if (!controller || !editorFeetAnalysis) return controller?.captureNeutral?.() || false;
      const restore = [];
      for (const saved of snapshot.feet) {
        const side = /left/i.test(String(saved.foot?.name || '')) || saved.foot?.userData?.footSide === 'left' ? 'left'
          : /right/i.test(String(saved.foot?.name || '')) || saved.foot?.userData?.footSide === 'right' ? 'right' : null;
        const idle = side === 'left' ? editorFeetAnalysis.leftIdle : side === 'right' ? editorFeetAnalysis.rightIdle : null;
        if (!idle || !saved.foot?.position?.set) continue;
        restore.push({ foot: saved.foot, position: saved.foot.position.clone() });
        saved.foot.position.set(finite(idle.x), finite(idle.y), finite(idle.z));
        saved.foot.updateMatrixWorld?.(true);
      }
      const ready = controller.captureNeutral();
      for (const saved of restore) {
        saved.foot.position.copy(saved.position);
        saved.foot.updateMatrixWorld?.(true);
      }
      return ready;
    }

    function neutralizeGroundWalkForSwim(snapshot) {
      const poseRoot = snapshot.poseRoot;
      if (poseRoot) {
        poseRoot.position.set(0, 0, 0);
        poseRoot.quaternion.identity();
        poseRoot.scale.set(1, 1, 1);
      }
      const liftRoot = snapshot.avatarLiftRoot;
      const halfHeight = finite(snapshot.model?.userData?.gameGrounding?.avatarHeightHalfLift, NaN);
      if (liftRoot && Number.isFinite(halfHeight)) liftRoot.position.y = halfHeight; // Removes native step bob without changing authored species grounding.
    }

    function renderEditorSwimFrame(now, model, snapshot) {
      const dt = Math.min(0.05, Math.max(0, (finite(now, lastRenderTime) - lastRenderTime) / 1000));
      lastRenderTime = finite(now, performance.now());
      const locomotionRoot = snapshot?.locomotionRoot;
      const root = editorShimRoot(model); // Dance-created adapter over this editor's native generated feet and canonical leg lines.

      if (model !== activeModel) {
        activeModel = model;
        controller = null;
        controllerRoot = null;
        lastEditorX = finite(locomotionRoot?.position?.x, null);
        lastEditorZ = finite(locomotionRoot?.position?.z, null);
        lastEditorYaw = finite(locomotionRoot?.rotation?.y, 0);
        refreshEditorMovementReference();
      }

      const currentX = finite(locomotionRoot?.position?.x, lastEditorX);
      const currentZ = finite(locomotionRoot?.position?.z, lastEditorZ);
      const hadPrevious = Number.isFinite(lastEditorX) && Number.isFinite(lastEditorZ);
      const dx = hadPrevious ? currentX - lastEditorX : 0;
      const dz = hadPrevious ? currentZ - lastEditorZ : 0;
      lastEditorX = currentX;
      lastEditorZ = currentZ;
      const distance = Math.hypot(dx, dz);
      const measuredSpeed = dt > 1e-6 ? distance / dt : 0;
      const teleportLike = measuredSpeed > editorReferenceSpeed * 4; // Arena wrap/reset is not a swim direction and must not flip the body for one frame.
      const moving = !teleportLike && distance > 1e-5 && measuredSpeed > 0.02;
      if (moving) {
        const desiredYaw = facingYawFromMovement(dx, dz);
        if (desiredYaw != null) lastEditorYaw = desiredYaw;
        editorState.directionDeg = Math.atan2(dz, dx) * 180 / Math.PI;
      }
      editorState.speedStrength = moving
        ? Math.max(clamp01(tuning.minMovingStrength), Math.sqrt(clamp01(measuredSpeed / editorReferenceSpeed)))
        : 0;

      neutralizeGroundWalkForSwim(snapshot);
      if (locomotionRoot?.rotation && Number.isFinite(lastEditorYaw)) locomotionRoot.rotation.y = lastEditorYaw;

      if (root && root !== controllerRoot) {
        controllerRoot = root;
        controller = createLegController(root, { THREE: editorThree(root) });
        refreshEditorMovementReference();
        captureControllerIdleNeutral(snapshot);
      }
      if (controller) controller.update(dt, editorState.speedStrength, tuning, false);

      editorState.phase = controller?.state?.phase || 0;
      editorState.blend = controller?.state?.blend || 0;
      editorState.rigReady = !!controller;
      editorState.modelName = model?.name || null;
      editorState.rigName = root?.name || null;
      editorState.lastReason = controller
        ? (moving ? 'previewing-shared-swim-gait' : 'swim-idle-waiting-for-movement')
        : 'waiting-for-generated-leg-rig';

      const motion = panel.querySelector('#swimEditorMotion');
      if (motion) motion.textContent = moving
        ? `Movement: ${measuredSpeed.toFixed(2)} u/s · ${editorState.directionDeg.toFixed(0)}° · kick ${Math.round(editorState.speedStrength * 100)}%`
        : (teleportLike ? 'Movement: preview wrap/reset ignored' : 'Movement: idle — use WASD / stick / touch');

      const debug = panel.querySelector('#swimEditorDebug');
      if (debug) debug.textContent = JSON.stringify({
        reason: editorState.lastReason,
        renderOwnership: 'temporary-pre-render',
        model: editorState.modelName,
        rig: editorState.rigName,
        movementSpeed: Number(measuredSpeed.toFixed(3)),
        kickStrength: Number(editorState.speedStrength.toFixed(3)),
        movementDirectionDeg: Number(editorState.directionDeg.toFixed(1)),
        bodyYawDeg: Number.isFinite(lastEditorYaw) ? Number((lastEditorYaw * 180 / Math.PI).toFixed(1)) : null,
        phase: Number(editorState.phase.toFixed(3)),
        blend: Number(editorState.blend.toFixed(3)),
        tuning: { ...tuning },
      }, null, 2);
    }

    function installEditorRendererHook() {
      if (rendererHookInstalled) return true;
      const renderer = window.HobunjiGameplayBackdrop?.getRenderer?.();
      if (!renderer?.render) return false;
      const previousRender = renderer.render.bind(renderer); // Keeps Dance/Impact/native renderer wrappers in the existing chain.
      renderer.render = function proceduralSwimEditorRender(scene, camera) {
        if (!editorState.enabled) return previousRender(scene, camera);
        if (window.ProceduralDanceMode?.getDebug?.().enabled) window.ProceduralDanceMode.setEnabled(false);
        const model = window.HobunjiGameplayBackdrop?.getAvatarModel?.() || null;
        const npcPreview = window.HobunjiGameplayBackdrop?.getPreviewMode?.() !== 'creature';
        if (!model || !npcPreview) {
          editorState.lastReason = model ? 'swim-requires-npc-preview' : 'waiting-for-preview-avatar';
          return previousRender(scene, camera);
        }
        const snapshot = captureEditorRenderState(model); // Captures native movement pose after the editor updated it, then restores it after this exact draw.
        renderEditorSwimFrame(performance.now(), model, snapshot);
        try {
          return previousRender(scene, camera);
        } finally {
          restoreEditorRenderState(snapshot);
        }
      };
      rendererHookInstalled = true;
      editorLog('[Swim gait] Renderer hook attached; Swim now layers over the native procedural movement frame and restores it after each draw.');
      return true;
    }

    function waitForEditorRenderer() {
      if (installEditorRendererHook()) return;
      if (performance.now() - rendererWaitStartedAt > 120000) {
        editorState.lastReason = 'editor-renderer-hook-timeout';
        updateEditorStatus('Swim could not attach to the procedural preview renderer.', false);
        editorLog('[Swim gait] Timed out waiting for the procedural editor renderer.', 'error');
        return;
      }
      setTimeout(waitForEditorRenderer, 120);
    }

    swimButton.addEventListener('click', () => {
      if (editorState.enabled) {
        leaveSwimMode('disabled-from-procedural-hud');
        updateEditorStatus('Swim preview off.', true);
        return;
      }
      editorState.enabled = true;
      panel.hidden = false;
      swimButton.classList.add('active');
      lastRenderTime = performance.now();
      activeModel = null;
      window.ProceduralDanceMode?.setEnabled?.(false);
      refreshEditorMovementReference();
      updateEditorStatus('Swim preview active — move with the normal procedural controls.', true);
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && editorState.enabled) leaveSwimMode('disabled-by-escape');
    });

    waitForEditorRenderer();
    editorState.installed = true;
    editorState.lastReason = 'installed-editor-mode';
    editorLog('[Swim gait] Shared procedural Swim movement installed in the native animation HUD.');
    return true;
  }

  function installMobileRuntimeDebug() {
    if (typeof document === 'undefined' || !/[?&]swimDebug=1(?:&|$)/.test(location.search) || document.getElementById('proceduralSwimDebugButton')) return;
    const button = document.createElement('button'); // Used to expose runtime swim state on phones without a browser console.
    button.id = 'proceduralSwimDebugButton';
    button.type = 'button';
    button.textContent = 'Swim Debug';
    button.style.cssText = 'position:fixed;right:8px;top:166px;z-index:100000;padding:8px 10px;font:12px monospace';
    button.addEventListener('click', () => {
      const text = JSON.stringify(window.HobunjiProceduralSwimGait?.getDebug?.(), null, 2); // Used for clipboard + alert diagnostics from the live runtime.
      navigator.clipboard?.writeText(text).catch(() => {});
      alert(text);
    });
    document.body.appendChild(button);
  }

  const api = { // Shared public API used by tests, editor tooling, and mobile diagnostics.
    version: VERSION,
    defaults: DEFAULT_TUNING,
    facingYawFromMovement,
    sampleKick,
    createLegController,
    isInSwimWater: runtimeWaterCheck,
    getTuning: () => ({ ...tuning }),
    setTuning(next = {}) { Object.assign(tuning, next); return { ...tuning }; },
    resetTuning() { Object.assign(tuning, DEFAULT_TUNING); return { ...tuning }; },
    getDebug() { return { runtime: { ...runtimeState }, editor: { ...editorState }, tuning: { ...tuning } }; },
  };
  window.HobunjiProceduralSwimGait = Object.freeze(api);

  const isEditor = typeof location !== 'undefined' && /\/tools\/procedural-animation-editor\/(?:index\.html)?$/.test(location.pathname); // Used to select editor authoring integration instead of runtime patching.
  if (isEditor) {
    const tryEditorInstall = () => { if (!installEditor()) setTimeout(tryEditorInstall, 120); }; // Used to wait for the giant editor's asynchronously-created mode tabs without modifying its monolith.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryEditorInstall, { once: true });
    else tryEditorInstall();
  } else {
    installRuntime();
    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installMobileRuntimeDebug, { once: true });
      else installMobileRuntimeDebug();
    }
  }
})();

// Game-owned Tzatzul flying rig presentation. The existing WildlifeSpawn
// update tick supplies lifecycle; there is no new RAF or scene-wide traversal.
(() => {
  'use strict';
  if (window.TzatzulLiveVisuals) return;
  const SCAN_PERIOD_S = 1.4; // Finds dev-spawned birds without checking every creature on every rendered frame.
  const RETRY_DELAY_MS = 10000; // An absent sprite or GLB cannot initiate a failing fetch every frame.
  const tracked = new Map(); // Live adults only; stale area and removed Set members are disposed on the next reconciliation.
  let deps = null; // WildlifeSpawn's live hostile collection and optional camera dependency.
  let scanT = 0; // Timer for bounded active-area scans rather than per-frame global searches.
  let area = null; // Last map id, used to immediately clear attachments across scene transitions.
  let seconds = 0; // Shared wing flap clock; prevents one Date.now call per bird.
  const debug = { scans: 0, mounts: 0, unmounts: 0, loadFailures: 0, lastError: null,
    lastBird: null, lastPose: null }; // Plain serializable diagnostics for mobile.
  const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
  const kind = actor => actor?.creatureKey || actor?.def?.id || actor?.def?.key;
  function stableIndex(actor) {
    const seed = String(actor.tzatzulNestId || actor.nestTreeKey || actor.id
      || [actor.homeX ?? actor.x, actor.homeY ?? actor.y].map(n => Math.round(Number(n) || 0)).join(':'));
    let hash = 2166136261; // Deterministic individual color fallback for dev/test spawns.
    for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619) >>> 0;
    return hash % 16384;
  }
  function clearOriginal(state) {
    for (const record of state.originals) {
      if (record.node?.parent === state.group) record.node.visible = record.visible;
    } // Never restore visibility on disposed or reparented creature planes.
    state.originals.length = 0;
  }
  function release(actor, reason = 'removed') {
    const state = tracked.get(actor);
    if (!state) return false;
    tracked.delete(actor);
    state.removed = true; // In-flight async rig loads discard their result rather than attaching to a corpse.
    clearOriginal(state);
    if (state.rig) {
      try { state.rig.dispose(); } catch (error) { debug.lastError = String(error); }
      state.rig = null;
      debug.unmounts++;
    }
    if (state.group?.userData) delete state.group.userData.tzatzulFlyingRig;
    debug.lastBird = String(actor?.id || kind(actor) || 'tzatzul') + ':' + reason;
    return true;
  }
  function portraitPlanes(actor, group) {
    const ref = actor.avatarRef || {};
    const candidates = [ref.frontPlane, ref.backPlane, ...(group.children || [])];
    return [...new Set(candidates)].filter(node => node?.parent === group && node?.isMesh
      && (node.userData?.hobunjiPlaneFace === 'front' || node.userData?.hobunjiPlaneFace === 'back'
        || /_(front|back)_plane$/.test(node.name || '') || node === ref.frontPlane || node === ref.backPlane));
  }
  function present(actor, state, camera) {
    if (!state.rig) return;
    const pose = actor.tzatzulFlightPose === 'perched' || actor.tzatzulFlightPose === 'glide'
      || actor.tzatzulFlightPose === 'flap' ? actor.tzatzulFlightPose
      : actor.onBranch ? 'perched'
        : actor._animalAttack || ['chase','patrol-chase','fleeing-low-health'].includes(actor.state) ? 'flap' : 'perched';
    // Ordinary avatar code can re-enable its canonical sprite after a genotype
    // animation or visual promotion. Keep it hidden only while our rig exists.
    for (const { node } of state.originals) if (node?.parent === state.group) node.visible = false;
    if (camera?.getWorldPosition && state.rig.root?.parent === state.group) {
      try { state.rig.update(camera, pose, seconds, !!actor.tzatzulCarrying); }
      catch (error) { debug.lastError = String(error); }
    }
    state.lastPose = pose;
    debug.lastPose = pose;
  }
  function mount(actor, state) {
    if (state.loading || state.rig || now() < state.retryAt) return;
    const group = actor.avatarRef?.group;
    if (!group?.add || !group.parent || actor._wildlifeVisualsReleased) return;
    state.loading = true;
    const create = window.TzatzulRegistration?.createRig;
    if (!create) { state.loading = false; return; }
    Promise.resolve().then(() => create(actor.tzatzulIdentity)).then(rig => {
      if (!rig?.root || !rig?.dispose) throw new Error('Flying rig renderer did not return a disposable root');
      if (state.removed || tracked.get(actor) !== state || actor.health <= 0
        || actor.avatarRef?.group !== group || !group.parent || actor._wildlifeVisualsReleased) {
        rig.dispose(); // Prevent leaked geometry and detached late-loading meshes.
        return;
      }
      state.group = group; // Pose and visual cleanup use the exact native avatar owner.
      state.rig = rig;
      state.originals = portraitPlanes(actor, group).map(node => ({ node, visible: node.visible }));
      for (const record of state.originals) record.node.visible = false;
      const height = Number(actor.avatarRef?.frontPlane?.geometry?.parameters?.height)
        || Number(state.originals[0]?.node?.geometry?.parameters?.height)
        || Number(actor.def?.modelWidth) || 1; // Match the authoritative native portrait height, including large birds.
      if (rig.root.scale?.setScalar) rig.root.scale.setScalar(height);
      rig.root.rotation.y = Math.PI / 2; // Flying side sprite inherits the same orientation as the native animal front plane.
      group.add(rig.root);
      group.userData ||= {};
      group.userData.tzatzulFlyingRig = true;
      debug.mounts++;
      debug.lastBird = String(actor.id || 'tzatzul') + ':mounted';
    }).catch(error => {
      state.retryAt = now() + RETRY_DELAY_MS;
      debug.loadFailures++;
      debug.lastError = String(error?.message || error);
      window.__farmLog?.('[tzatzul] flying rig unavailable: ' + debug.lastError, 'warn', 'wildlife');
    }).finally(() => { state.loading = false; });
  }
  function init(injected = {}) {
    deps = injected; // Uses the same lifetime as WildlifeSpawn, not a private global creature roster.
    for (const actor of [...tracked.keys()]) release(actor, 'reinitialized');
    area = null;
    scanT = 0;
  }
  function tick(dt, activeArea = deps?.getCurrentArea?.()) {
    if (!deps?.hostileObjects || !activeArea) return 0;
    const step = Math.max(0, Math.min(.25, Number(dt) || 0));
    seconds += step;
    if (area !== activeArea) {
      for (const actor of [...tracked.keys()]) release(actor, 'area transition');
      area = activeArea; scanT = 0;
    }
    scanT -= step;
    if (scanT <= 0) {
      scanT = SCAN_PERIOD_S;
      debug.scans++;
      for (const actor of deps.hostileObjects) {
        if (kind(actor) !== window.TzatzulRegistration?.KIND || actor.areaId !== area || !(actor.health > 0)) continue;
        if (tracked.has(actor)) continue;
        actor.tzatzulIdentity ||= window.TzatzulRegistration.identityFor(area, stableIndex(actor)); // Distinct, stable fallback until each nest assigns its persistent family ID.
        tracked.set(actor, { rig: null, loading: false, removed: false, originals: [],
          group: null, retryAt: 0, lastPose: null });
      }
    }
    const camera = deps.getActiveCamera?.() || window.Combat?.deps?.getActiveCamera?.()
      || deps.camera || null; // Real combat camera; no new renderer or global camera mutation.
    for (const [actor, state] of tracked) {
      if (actor.health <= 0 || actor.areaId !== area || !deps.hostileObjects.has(actor)) {
        release(actor, 'died, despawned or left area');
        continue;
      }
      if (state.group && (actor.avatarRef?.group !== state.group || actor._wildlifeVisualsReleased || !state.group.parent)) {
        if (state.rig) {
          clearOriginal(state);
          state.rig.dispose(); state.rig = null; debug.unmounts++;
        }
        state.group = null;
      }
      if (!state.rig) mount(actor, state);
      else present(actor, state, camera);
    }
    return tracked.size;
  }
  function snapshot() {
    return { ...debug, activeArea: area, tracked: tracked.size,
      liveRigs: [...tracked.values()].filter(state => !!state.rig).length,
      loading: [...tracked.values()].filter(state => state.loading).length };
  }
  window.TzatzulLiveVisuals = Object.freeze({ init, tick, snapshot, release });
})();

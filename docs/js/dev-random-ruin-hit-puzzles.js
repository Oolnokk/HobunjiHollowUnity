// Dev Random Test Ruin — V50 hit-driven puzzle runtime, batch 2.
//
// Owns hit-driven projectile glyphs, stationary fire-hazard sources, and
// permanent Adventuring Tools torch contacts for real V50 puzzle mechanisms.
// It loads before the base ruin adapter so its pre-render pass can publish
// mechanism signal proxies before the adapter resolves moving geometry. A
// second, delayed post-render-prep pass suppresses old Interact shortcuts.
(() => {
  'use strict';

  const DS = window.DynamicSurfaces;
  if (!DS) return;

  const MAP_ID = 'map_i_dev_random_ruin';
  const CONTROL_RANGE = 1.65;
  const PLAYER_REACH_HEIGHT = 1.65; // Used by physical brazier reach and hit-driven input suppression at the player's supported feet.
  const PLAYER_REACH_BELOW = .18; // Reject upper/lower floor braziers even when they overlap in X/Z.
  const SIGNAL_SPEED = 1.8;
  const GLYPH_HITBOX_PAD = 0.045;

  let devDeps = null;
  let combatDeps = null;
  let root = null;
  const extraNativeRoots = new Set(); // The upper V50 floor owner registers/deregisters its real authored puzzle roots here.
  let nativeRootsChanged = false; // Rebuilds the shared glyph/torch scan only when a native floor is mounted or removed.
  let generatorApi = null;
  let glyphTargets = [];
  let ignitionTargets = [];
  let torchSources = [];
  let ladders = [];
  let mechanismRoots = new Map();
  let mechanismSignals = new Map();
  let suppressedBaseInteract = false;
  let lastFrameMs = performance.now();
  let hitSerial = 0;
  let installedInputBindingGuard = false;
  let installedRangedHook = false;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  // Capture the same private game dependencies the existing modules already
  // receive. These wrappers are installed parser-time, before game.js calls
  // any init(), and always delegate to whatever wrapper was present before us.
  function wrapInit(api, capture) {
    if (!api || typeof api.init !== 'function') return;
    const previous = api.init;
    if (previous.__devRandomRuinHitPuzzleWrapped) return;
    const wrapped = function (...args) {
      if (args[0]) capture(args[0]);
      return previous.apply(this, args);
    };
    wrapped.__devRandomRuinHitPuzzleWrapped = true;
    api.init = wrapped;
  }
  wrapInit(window.DevSpawner, deps => { devDeps = deps; });
  wrapInit(window.Combat, deps => { combatDeps = deps; });

  function currentArea() {
    return devDeps?.getCurrentArea?.() || combatDeps?.getCurrentArea?.() || null;
  }
  function currentScene() {
    return devDeps?.getActiveScene?.() || null;
  }
  function currentPlayerWorld() {
    const deps = devDeps || combatDeps;
    if (!deps?.player || !deps?.TILE) return null;
    return { x: deps.player.x / deps.TILE, z: deps.player.y / deps.TILE };
  }
  function currentSupportY() {
    const physical=window.DevRandomRuin?.getPlayerGroundSupportY?.(); // The authoritative height is ruin.supportY, not a sinking/jumping visual mesh or the highest overlapping DynamicSurfaces floor.
    if(typeof physical==='number'&&Number.isFinite(physical))return physical;
    const presented=window.DevRandomRuin?.getPlayerSupportY?.();
    if(typeof presented==='number'&&Number.isFinite(presented))return presented;
    const meshY=devDeps?.playerMesh?.position?.y;
    if(typeof meshY==='number'&&Number.isFinite(meshY))return meshY;
    const p=currentPlayerWorld();
    return p?DS.sampleSupport(p.x,p.z,{minY:-8,maxY:24,pad:.02})?.y??0:0;
  }
  function boxFor(object) {
    if (!object) return null;
    object.updateWorldMatrix?.(true, true);
    object.updateMatrixWorld?.(true);
    const box = new THREE.Box3().setFromObject(object);
    return box.isEmpty() ? null : box;
  }
  function centerFor(object) {
    return boxFor(object)?.getCenter(new THREE.Vector3()) || new THREE.Vector3();
  }
  function worldDistanceTo(object) {
    const p=currentPlayerWorld(),y=currentSupportY();
    if(!p||!object||!Number.isFinite(y))return Infinity;
    const box=boxFor(object);
    if(!box)return Infinity;
    const gap=(value,min,max)=>Math.max(min-value,0,value-max); // Clamps the player to an actual physical target, not its potentially distant center point.
    const dx=gap(p.x,box.min.x,box.max.x),dz=gap(p.z,box.min.z,box.max.z);
    const dy=Math.max(box.min.y-(y+PLAYER_REACH_HEIGHT),0,(y-PLAYER_REACH_BELOW)-box.max.y);
    return Math.hypot(dx,dy,dz); // An upper-floor torch cannot be reached through its floor even at identical X/Z.
  }
  function rootContainsActivatorDescendant(object, type) {
    let found = false;
    for (const child of object.children || []) {
      child.traverse?.(node => {
        if (node !== object && node.userData?.activatorType === type) found = true;
      });
      if (found) break;
    }
    return found;
  }
  function inheritedData(object, key) {
    let current = object;
    while (current && current !== root?.parent) {
      const value = current.userData?.[key];
      if (value != null) return value;
      if (current === root) break;
      current = current.parent;
    }
    return null;
  }
  function apiNow() {
    if (generatorApi?.applyProgress) return generatorApi;
    const frame = document.getElementById('devRandomRuinGeneratorFrame');
    const api = frame?.contentWindow?.DebrisifierV50;
    if (api?.applyProgress) generatorApi = api;
    return generatorApi;
  }

  function activeGeneratedRoot() {
    if (currentArea() !== MAP_ID) return null;
    const scene = currentScene();
    return scene?.children?.find?.(object => /^dev_v50_ruin_/.test(object?.name || '')) || null;
  }

  function scanGeneratedRoots(visitor) {
    root?.traverse?.(visitor);
    for(const native of extraNativeRoots)if(native!==root)native?.traverse?.(visitor);
  }
  function registerExternalRoot(native) {
    if(!native?.traverse)return null;
    extraNativeRoots.add(native);nativeRootsChanged=true;
    return () => {if(extraNativeRoots.delete(native))nativeRootsChanged=true;}; // Cleanup is owned by its native floor, not by the base root.
  }

  function makeSignalProxy(mechanismId, mechanismRoot) {
    const proxy = { userData:{ solveProgress:0, __devRuinHitSignal:true, mechanismId } };
    const originalLinkedCube = mechanismRoot.userData?.linkedCubePuzzleRoot || null;
    mechanismRoot.userData.__devRuinHitOriginalLinkedCube = originalLinkedCube;
    mechanismRoot.userData.linkedCubePuzzleRoot = proxy;
    return {
      mechanismId,
      root:mechanismRoot,
      proxy,
      originalLinkedCube,
      progress:0,
      target:0,
      glyphRequired:0,
      commandTarget:null, // V50 bridge-drop rooms use distinct ON and OFF projectile glyph commands, rather than an all-glyphs-complete gate.
      glyphTargets:[],
      ignitionTargets:[],
    };
  }

  function signalFor(mechanismId) {
    if (!mechanismId) return null;
    let state = mechanismSignals.get(mechanismId);
    if (state) return state;
    const mechanismRoot = mechanismRoots.get(mechanismId);
    if (!mechanismRoot) return null;
    // Pressure-plate and linked-cube mechanisms already have a legitimate
    // continuous signal source. Batch 2 never steals those mechanisms.
    if (mechanismRoot.userData?.linkedPressurePlateRoot || mechanismRoot.userData?.linkedCubePuzzleRoot) return null;
    state = makeSignalProxy(mechanismId, mechanismRoot);
    mechanismSignals.set(mechanismId, state);
    return state;
  }

  function deepestGlyphNodes() {
    const candidates = [];
    scanGeneratedRoots(object => {
      if (object.userData?.activatorType !== 'glyphObelisk') return;
      if (rootContainsActivatorDescendant(object, 'glyphObelisk')) return;
      const mechanismId = inheritedData(object, 'linkedMechanismId');
      if (!mechanismId) return;
      candidates.push({ object, mechanismId });
    });
    return candidates;
  }

  function pillarMouthFor(object) {
    const localZ = object.userData?.pillarNicheMouthZ; // The embedded generator derives this from the tapered shaft face.
    const housing = object.parent; // The housing's local -Z points through the opening.
    if (!Number.isFinite(localZ) || !housing) return null;
    const bounds = boxFor(object); // Core dimensions define the aimable region at the mouth.
    if (!bounds) return null;
    const point = housing.localToWorld(new THREE.Vector3(0, 0, localZ));
    const outward = new THREE.Vector3(0, 0, -1).transformDirection(housing.matrixWorld);
    return { point, outward, bounds };
  }

  function buildForRoot(nextRoot) {
    clearRuntimeObjects();
    root = nextRoot;
    generatorApi = null;
    mechanismRoots = new Map();
    mechanismSignals = new Map();
    glyphTargets = [];
    ignitionTargets = [];
    torchSources = [];
    ladders = [];

    scanGeneratedRoots(object => {
      const data = object.userData || {};
      if (data.mechanismId && data.previewMotion?.type) mechanismRoots.set(data.mechanismId, object);
      if (data.generatedAccessType === 'stoneLadder') ladders.push(object);
      if (data.alwaysLit || data.activatorType === 'alwaysLitTorch') torchSources.push(object);
    });

    for (const entry of deepestGlyphNodes()) {
      const required = Math.max(1, finite(inheritedData(entry.object, 'requiredTriggers'), 1));
      const state = signalFor(entry.mechanismId);
      if (!state) continue;
      const command=String(inheritedData(entry.object,'bridgeCommand')||'').toUpperCase(); // The authored ON/OFF glyph groups carry this flag on their parent V50 set root.
      const target = {
        id:`glyph-${entry.object.id}`,
        kind:'glyph',
        object:entry.object,
        pillarMouth:pillarMouthFor(entry.object),
        mechanismId:entry.mechanismId,
        active:false,
        required,
        command:command==='ON'||command==='OFF'?command:null,
      };
      glyphTargets.push(target);
      state.glyphTargets.push(target);
      state.glyphRequired = Math.max(state.glyphRequired, required);
    }

    scanGeneratedRoots(object => {
      const type = object.userData?.activatorType;
      if (type !== 'brazier' && type !== 'torch') return;
      const mechanismId = inheritedData(object, 'linkedMechanismId');
      if (!mechanismId) return;
      // Nested helper nodes may copy the same activator type. Keep the outer
      // physical prop, not a child with the same semantic target.
      if (object.parent?.userData?.activatorType === type && inheritedData(object.parent, 'linkedMechanismId') === mechanismId) return;
      const state = signalFor(mechanismId);
      if (!state) return;
      const target = {
        id:`ignite-${object.id}`,
        kind:type,
        object,
        mechanismId,
        lit:false,
      };
      ignitionTargets.push(target);
      state.ignitionTargets.push(target);
    });

    // Source stations contain an always-lit torch child. Collapse duplicates
    // when an outer station and its torch both carry source metadata.
    const uniqueSources = [];
    const seenSourceCenters = [];
    for (const object of torchSources) {
      const c = centerFor(object);
      if (seenSourceCenters.some(other => other.distanceToSquared(c) < .03*.03)) continue;
      seenSourceCenters.push(c);
      uniqueSources.push(object);
    }
    torchSources = uniqueSources;
    for (const source of torchSources) {
      source.userData = source.userData || {};
      source.userData.fireHazard = true; // Persistent, lit V50 sources ignite the player's own torch; they are never inventory pickups.
    }
    lastFrameMs = performance.now();
    window.__farmLog?.(`[random-ruin-hit] glyphs=${glyphTargets.length} ignition=${ignitionTargets.length} torchSources=${torchSources.length}`, 'world');
  }

  function restoreSignalLinks() {
    for (const state of mechanismSignals.values()) {
      if (state.root?.userData?.linkedCubePuzzleRoot === state.proxy) {
        if (state.originalLinkedCube) state.root.userData.linkedCubePuzzleRoot = state.originalLinkedCube;
        else delete state.root.userData.linkedCubePuzzleRoot;
      }
      if (state.root?.userData) delete state.root.userData.__devRuinHitOriginalLinkedCube;
    }
  }

  function clearRuntimeObjects() {
    restoreSignalLinks();
    glyphTargets = [];
    ignitionTargets = [];
    torchSources = [];
    ladders = [];
    mechanismRoots = new Map();
    mechanismSignals = new Map();
    generatorApi = null;
    root = null;
    suppressedBaseInteract = false;
  }

  function segmentBoxInterval(start, end, rawBox, radius = 0) {
    if (!rawBox) return null;
    const box = rawBox.clone();
    box.expandByScalar(Math.max(0, radius));
    let enter = 0, exit = 1;
    for (const axis of ['x','y','z']) {
      const delta = end[axis] - start[axis];
      const min = box.min[axis], max = box.max[axis];
      if (Math.abs(delta) < 1e-9) {
        if (start[axis] < min || start[axis] > max) return null;
        continue;
      }
      let a = (min - start[axis]) / delta;
      let b = (max - start[axis]) / delta;
      if (a > b) [a,b] = [b,a];
      enter = Math.max(enter, a);
      exit = Math.min(exit, b);
      if (enter > exit) return null;
    }
    return exit >= 0 && enter <= 1 ? { enter:clamp(enter,0,1), exit:clamp(exit,0,1) } : null;
  }

  function pillarMouthHit(start, end, mouth, radius) {
    const { point, outward, bounds } = mouth;
    const from = (start.x - point.x) * outward.x + (start.z - point.z) * outward.z - radius;
    const travel = (end.x - start.x) * outward.x + (end.z - start.z) * outward.z;
    if (from < 0 || travel >= -1e-9 || from + travel > 0) return null;
    const t = -from / travel; // First contact with the mouth, only while traveling toward the recess.
    const y = start.y + (end.y - start.y) * t;
    const acrossX = Math.abs(outward.z) > Math.abs(outward.x); // Native housings face the four cardinal directions.
    const across = acrossX ? 'x' : 'z';
    const side = start[across] + (end[across] - start[across]) * t;
    const pad = GLYPH_HITBOX_PAD; // Keep the opening fixed even if a projectile has a wide flight collider.
    if (side < bounds.min[across] - pad || side > bounds.max[across] + pad
      || y < bounds.min.y - pad || y > bounds.max.y + pad) return null;
    return t;
  }

  function glyphProjectileHit(start, end, radius) {
    if (!root || currentArea() !== MAP_ID) return null;
    let nearest = null;
    for (const target of glyphTargets) {
      const t = target.pillarMouth
        ? pillarMouthHit(start, end, target.pillarMouth, radius)
        : segmentBoxInterval(start, end, target.hitBox || boxFor(target.object), Math.max(GLYPH_HITBOX_PAD, radius))?.enter;
      if (t == null || (nearest && t >= nearest.t)) continue;
      nearest = { target, t };
    }
    return nearest;
  }

  function activateGlyph(target) {
    if (!target || target.active) return false;
    target.active = true;
    window.DevRandomRuinGlyphCircuits?.refreshActivatedGlyph?.(target); // Immediate source tint; render-loop pulses and hit flash still follow.
    hitSerial++;
    const state = mechanismSignals.get(target.mechanismId);
    let relevant=state?.glyphTargets||[],required=state?.glyphRequired||target.required||1;
    if(target.command&&state){
      relevant=relevant.filter(entry=>entry.command===target.command); // ON and OFF are separate multi-hit groups; shooting one must never count toward the other.
      required=Math.max(1,...relevant.map(entry=>entry.required||1));
    }
    const active=relevant.filter(entry=>entry.active).length;
    const complete=active>=required;
    if(state&&complete){
      if(target.command){
        state.commandTarget=target.command==='ON'?.5:0; // Hold the V50 bridge in the extended midpoint; OFF returns to the retracted zero pose.
        for(const other of state.glyphTargets)if(other.command&&other.command!==target.command)other.active=false;
        (window.RuinInteractionAudio?.puzzleComplete?.()||window.AudioSystem?.playObjectSfxKey?.('puzzleComplete'));
      }else if(state.target<1){
        state.target=1;(window.RuinInteractionAudio?.puzzleComplete?.()||window.AudioSystem?.playObjectSfxKey?.('puzzleComplete'));
      }
    }
    if(!complete)window.RuinInteractionAudio?.progress?.(active,required); // Rising bell per glyph; the last one plays the full solve motif above.
    window.GameFeel?.addTrauma?.(complete?.1:.06);
    const circuit=target.circuitName?`${target.circuitName} `:'';
    const result=target.command?`${target.command} glyph`:'glyph circuit';
    devDeps?.showToast?.(complete
      ?`${circuit}${result} complete (${active}/${required}) — its mechanism is moving.`
      :`${circuit}glyph struck (${active}/${required}).`,true);
    window.__farmLog?.(`[random-ruin-hit] projectile glyph ${target.id} ${active}/${required}`, 'world');
    return true;
  }

  function installRangedProjectileHook() {
    if (installedRangedHook || !window.RangedWeapons?.update || !window.NearbyVolumeCollision?.segmentHit) return false;
    const ranged = window.RangedWeapons;
    const cover = window.NearbyVolumeCollision;
    const nativeUpdate = ranged.update;
    const nativeSegmentHit = cover.segmentHit;
    let projectileUpdateDepth = 0;
    ranged.update = function (...args) {
      projectileUpdateDepth++;
      try { return nativeUpdate.apply(this, args); }
      finally { projectileUpdateDepth--; }
    };
    cover.segmentHit = function (start, end, radiusWorld = 0) {
      const ordinary = nativeSegmentHit.call(this, start, end, radiusWorld);
      if (projectileUpdateDepth <= 0 || currentArea() !== MAP_ID || !root) return ordinary;
      const glyph = glyphProjectileHit(start, end, radiusWorld);
      if (!glyph || (ordinary && finite(ordinary.t, Infinity) <= glyph.t)) return ordinary;
      return {
        t:glyph.t,
        distanceWorld:start.distanceTo?.(end) * glyph.t || 0,
        object:glyph.target.object,
        kind:'ruinGlyph',
        key:glyph.target.id,
        onImpact:() => activateGlyph(glyph.target), // The live projectile sweep resolves any earlier cover or actor first.
        point:start.clone?.().lerp ? start.clone().lerp(end, glyph.t) : null,
      };
    };
    installedRangedHook = true;
    return true;
  }

  function updateSignalState(dt) {
    for (const state of mechanismSignals.values()) {
      if(state.commandTarget!=null){
        state.target=state.commandTarget; // A native ON/OFF bridge must stay usable until the player shoots the opposite command.
      }else if (state.glyphTargets.length) {
        const active = state.glyphTargets.filter(target => target.active).length;
        state.target = active >= Math.max(1, state.glyphRequired) ? 1 : 0;
      }
      if (state.ignitionTargets.length && state.ignitionTargets.some(target => target.lit)) state.target = 1;
      const step = SIGNAL_SPEED * dt;
      state.progress += clamp(state.target - state.progress, -step, step);
      if (Math.abs(state.target-state.progress) < .001) state.progress = state.target;
      state.proxy.userData.solveProgress = state.progress;
    }
  }

  function applyActivatorVisuals() {
    const api = apiNow();
    if (!api?.applyProgress) return;
    for (const target of glyphTargets) api.applyProgress(target.object, target.active ? 1 : 0);
    for (const target of ignitionTargets) api.applyProgress(target.object, target.lit ? 1 : 0);
  }

  function nearestPickupControl() {
    return null; // V50 source braziers no longer dispense temporary torches, even to legacy interaction bindings.
  }

  function nearestLadderDistance() {
    let best = Infinity;
    for (const ladder of ladders) best = Math.min(best, worldDistanceTo(ladder));
    return best;
  }
  function nearestHitDrivenDistance() {
    let best = Infinity;
    for (const target of glyphTargets) best = Math.min(best, worldDistanceTo(target.object));
    for (const target of ignitionTargets) best = Math.min(best, worldDistanceTo(target.object));
    return best;
  }

  function updateInteractionSuppression() {
    suppressedBaseInteract = currentArea() === MAP_ID && nearestHitDrivenDistance() <= CONTROL_RANGE;
  }

  function installInputBindingGuard() {
    if (installedInputBindingGuard || !window.InputBindings?.getCurrentBindings) return false;
    const api = window.InputBindings;
    const nativeGet = api.getCurrentBindings.bind(api);
    api.__devRuinHitPuzzleNativeGetBindings = nativeGet;
    api.getCurrentBindings = function (...args) {
      const current = nativeGet(...args);
      if (!suppressedBaseInteract || !current) return current;
      return {
        ...current,
        desktop:{ ...(current.desktop||{}), interact:'__DevRuinHitDriven__' },
        controller:{ ...(current.controller||{}), interact:'Button999' },
      };
    };
    installedInputBindingGuard = true;
    return true;
  }

  function rawBindings() {
    return window.InputBindings?.__devRuinHitPuzzleNativeGetBindings?.() || window.InputBindings?.getCurrentBindings?.() || null;
  }

  function interactionCode(binding) {
    return String(binding || '').split('+').pop().trim();
  }

  // This listener is registered before prototype-hooks/base-adapter listeners
  // because this script is parser-loaded before them. It blocks only hit-driven
  // props; ordinary doors/cubes/push blocks remain interactive.
  document.addEventListener('keydown', event => {
    if (currentArea() !== MAP_ID || !root) return;
    const raw = rawBindings()?.desktop?.interact;
    if (!raw || interactionCode(raw) !== event.code) return;
    if (nearestHitDrivenDistance() <= CONTROL_RANGE) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);

  function igniteIgnitionTarget(target) {
    if (!target || target.lit) return false;
    target.lit = true;
    if (target.object?.userData) target.object.userData.fireHazard = true; // The newly lit brazier becomes a reusable torch-ignition source.
    window.RuinInteractionAudio?.igniteTorch?.();
    const state = mechanismSignals.get(target.mechanismId);
    if (state && state.target < 1) {
      state.target = 1;
      (window.RuinInteractionAudio?.puzzleComplete?.() || window.AudioSystem?.playObjectSfxKey?.('puzzleComplete'));
    }
    devDeps?.showToast?.(target.kind === 'brazier' ? 'Brazier lit.' : 'Ruin torch lit.', true);
    window.__farmLog?.(`[random-ruin-hit] lit ${target.kind} ${target.id}`, 'world');
    return true;
  }

  function touchesIgnitionSource(matches) {
    if (!root || currentArea() !== MAP_ID) return false;
    const litSources = [
      ...torchSources,
      ...ignitionTargets.filter(target => target.lit).map(target => target.object),
      ...(window.DevRandomRuinDungeonFire?.litSourceObjects?.() || []),
      ...(window.RuinCheckpointTravel?.litSourceObjects?.() || []),
      ...(window.DevRandomRuinSanctum?.litOrdinaryFireObjects?.() || []),
    ];
    return litSources.some(object => worldDistanceTo(object) <= CONTROL_RANGE && matches(object));
  }

  function isIgnitionSourceAlongSegment(start, end, maxT = 1, radius = .18) {
    if (!start || !end) return false;
    const finish = start.clone().lerp(end, clamp(finite(maxT, 1), 0, 1));
    return touchesIgnitionSource(object => segmentBoxInterval(start, finish, boxFor(object), radius));
  }

  function contactTorchMelee(matches) {
    if (!root || currentArea() !== MAP_ID) return false;
    const target = ignitionTargets.find(target => !target.lit && worldDistanceTo(target.object) <= CONTROL_RANGE && matches(target.object));
    return target ? igniteIgnitionTarget(target) : false;
  }

  function contactAdventuringTorchSegment(start, end, maxT = 1, radius = .12, requireReach = false) {
    if (!root || currentArea() !== MAP_ID || !start || !end) return false;
    const finish = start.clone().lerp(end, clamp(finite(maxT, 1), 0, 1));
    let nearest = null;
    for (const target of ignitionTargets) {
      if (target.lit || (requireReach && worldDistanceTo(target.object) > CONTROL_RANGE)) continue;
      const interval = segmentBoxInterval(start, finish, boxFor(target.object), radius);
      if (interval && (!nearest || interval.enter < nearest.t)) nearest = { target, t:interval.enter };
    }
    return nearest ? igniteIgnitionTarget(nearest.target) : false;
  }

  function updatePromptAfterBase() {
    if (!root || currentArea() !== MAP_ID) return;
    const status = document.getElementById('apStatus')?.textContent || '';
    if (status === 'DEV RUIN · glyphObelisk' || status === 'DEV RUIN · brazier' || status === 'DEV RUIN · torch') {
      window.ActionPromptUI?.hideActionPrompt?.(); // No legacy pickup, ladder prohibition, or controller Interact claim survives.
    }
  }

  function preBaseFrame() {
    const inRuin = currentArea() === MAP_ID;
    if (!inRuin) {
      if (root) clearRuntimeObjects();
      return;
    }
    const activeRoot = activeGeneratedRoot();
    if (activeRoot && (activeRoot !== root || nativeRootsChanged)) {
      buildForRoot(activeRoot);
      nativeRootsChanged = false;
      window.DevRandomRuinGlyphCircuits?.rebuild?.(); // Native glyphs get the same visible plaques/hitboxes as base-level glyphs.
    }
    if (!root) return;
    const now = performance.now();
    const dt = clamp((now-lastFrameMs)/1000, 0, .05);
    lastFrameMs = now;
    updateSignalState(dt);
    updateInteractionSuppression();
  }

  function postBaseFrame() {
    if (!root || currentArea() !== MAP_ID) return;
    applyActivatorVisuals();
    updatePromptAfterBase();
  }

  // Pre-base registration is intentional: the base adapter's own frame client
  // is added later in the next parser-time script. Its collision/reconcile pass
  // therefore sees the signal proxy value and the correct physical door/bridge
  // state on the same frame.
  DS.addBeforeRenderClient(preBaseFrame);

  // Install global seams that are harmless outside the dev ruin. Input binding
  // guard must exist before prototype-hooks starts polling controller Interact.
  installInputBindingGuard();
  installRangedProjectileHook();

  // Some APIs finish loading after this parser-time module in unusual debug
  // pages. Retry briefly without ever blocking game boot.
  let installAttempts = 0;
  const retryInstall = () => {
    installAttempts++;
    installInputBindingGuard();
    installRangedProjectileHook();
    if ((!installedInputBindingGuard || !installedRangedHook) && installAttempts < 120) setTimeout(retryInstall, 25);
  };
  setTimeout(retryInstall, 0);

  // Register the prompt/visual correction after prototype-hooks' own delayed
  // client. Two timers are deliberate: our script loads before it so one timer
  // would otherwise still register first and let its structural prompt win.
  setTimeout(() => setTimeout(() => DS.addBeforeRenderClient(postBaseFrame), 0), 0);

  window.DevRandomRuinHitPuzzles = Object.freeze({
    registerExternalRoot,
    getNativeRoots:()=>[...extraNativeRoots], // The ordinary stone-ladder and semantic interaction provider reuses the active native story roots.
    debugEnsureRuntimeReady:()=>{
      if(window.localStorage?.getItem('hobunjiDevMode')!=='1')return false;
      preBaseFrame(); // Reuse the exact before-render lifecycle callback when software WebGL first-frame compilation is delayed in Chromium. Never invent a puzzle state.
      return !!root&&currentArea()===MAP_ID;
    },
    debugAdvanceSignals:frames=>{
      if(window.localStorage?.getItem('hobunjiDevMode')!=='1'||!root||currentArea()!==MAP_ID)return false;
      const ticks=Math.min(240,Math.max(0,Math.floor(Number(frames)||0)));
      for(let i=0;i<ticks;i++)updateSignalState(.05); // Runs the unchanged gameplay target/proxy interpolation in deterministic 50 ms fixed steps, not a fabricated solve event.
      return ticks;
    },
    debugTorchSources:()=>window.localStorage?.getItem('hobunjiDevMode')==='1'?[...torchSources]:[], // CI locates the actual lit torch fixtures; the result is never a replacement pickup object.
    debugPickupTorch:()=>false, // Removed: puzzle sources no longer supply replacement torches.
    debugLightAdventuringTorchAtSource:object=>{
      if(window.localStorage?.getItem('hobunjiDevMode')!=='1')return false;
      return torchSources.includes(object) && worldDistanceTo(object)<=CONTROL_RANGE
        && window.AdventuringTools?.isHoldingTorch?.()===true && window.AdventuringTools.light()===true;
    },
    debugIgniteTarget:object=>{
      if(window.localStorage?.getItem('hobunjiDevMode')!=='1')return false;
      const target=ignitionTargets.find(candidate=>candidate.object===object);
      return !!target&&worldDistanceTo(object)<=CONTROL_RANGE
        && window.AdventuringTools?.isHoldingTorch?.()===true && window.AdventuringTools?.isLit?.()===true
        && igniteIgnitionTarget(target); // CI uses the same target transition as physical swing/throw collision.
    },
    touchesIgnitionSource, contactTorchMelee, isIgnitionSourceAlongSegment, contactAdventuringTorchSegment, // Ruin-owned source detection and actual V50 puzzle fire transfer.
    distanceToWorldObject:worldDistanceTo, // One authoritative physical reach calculation for torches, glyphs and native ladder prompts.
    isCarryingTorch:() => false, // Compatibility for older mobile diagnostics and tests; the permanent torch is AdventuringTools.
    dropTorch:() => false,
    debugActivateGlyph(object = null) {
      const target = glyphTargets.find(entry => object ? entry.object === object : !entry.active) || null; // Used by browser/mobile diagnostics to exercise the authoritative projectile-hit state transition without synthesizing a weapon shot.
      return target ? activateGlyph(target) : false;
    },
    getGlyphCircuits:() => [...mechanismSignals.values()].filter(state => state.glyphTargets.length).map(state => ({
      mechanismId:state.mechanismId,
      mechanismRoot:state.root,
      required:Math.max(1, state.glyphRequired),
      targets:state.glyphTargets, // Live target records: the circuit visuals read .active and may set .hitBox/.circuitName.
    })),
    getRoot:() => root,
    snapshot:() => ({
      active:!!root,
      rootName:root?.name || null,
      glyphs:{ total:glyphTargets.length, active:glyphTargets.filter(target => target.active).length },
      ignitionTargets:ignitionTargets.map(target => ({ id:target.id, kind:target.kind, mechanismId:target.mechanismId, lit:target.lit })),
      torchSources:torchSources.length,
      torchSourceFireHazards:torchSources.filter(source=>source.userData?.fireHazard===true).length,
      temporaryTorchPickupsDisabled:true, // Exposed to mobile Pixel Probe and V50 browser tests.
      temporaryTorches:[], // Retained as read-only legacy diagnostics; the old pickup/12-second burn implementation is gone.
      carryingTorch:null,
      activeSwing:false,
      signalStates:[...mechanismSignals.values()].map(state => ({ mechanismId:state.mechanismId, progress:state.progress, target:state.target, commandTarget:state.commandTarget, glyphRequired:state.glyphRequired, glyphActive:state.glyphTargets.filter(target=>target.active).length, ignitionLit:state.ignitionTargets.some(target=>target.lit) })), // Includes ON/OFF bridge midpoint state for mobile puzzle diagnostics.
      suppressedBaseInteract,
      proximity:{playerGroundY:currentSupportY(),nearestPickup:nearestPickupControl()?.kind||null,
        nearestLadder:nearestLadderDistance(),nearestHitDriven:nearestHitDrivenDistance(),
        registeredNativeRoots:extraNativeRoots.size}, // In-game/mobile diagnostics for stacked-floor reach and cross-floor input suppression.
      hitSerial,
      hooks:{ inputBindingGuard:installedInputBindingGuard, rangedProjectile:installedRangedHook, combatAbility:false },
    }),
    clear:clearRuntimeObjects,
  });
})();

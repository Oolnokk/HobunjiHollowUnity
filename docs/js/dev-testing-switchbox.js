// Dev Testing Switchbox — dev-only performance/visual kill switches for
// whatever expensive system doesn't matter for the thing currently being
// tested. Lives entirely in this one file: reads/writes its own
// localStorage-backed flags, patches a handful of shared engine primitives
// so it doesn't have to chase every call site of the systems it turns off,
// and renders a checkbox panel in two places — the existing Dev Tools panel
// (#devSpawnPanel, opened via the 🐾 button, itself already gated behind
// Settings' Dev Mode switch) for use mid-session, and the character/world
// select screen (onboarding-core.js's #ob-overlay, or save-startup-gate.js's
// empty-save gate on a brand-new browser) so switches can be set before ever
// loading into a farm. Both surfaces are gated behind the same
// `hobunjiDevMode` localStorage flag Settings' Dev Mode checkbox writes.
//
// UI model: every checkbox is free to flip with no immediate effect — one
// shared Confirm button per panel instance applies every checked box as
// "on" and every unchecked box as "off" in a single batch, persists that
// combination, and reloads once so each gated system only has to check its
// flag a single time, at its own boot/first-use point, rather than on every
// call or frame.
//
// Must load after js/audio-system.js, js/water-system.js,
// js/foliage-generator.js, js/WallBuilder.js, js/HousePieceGen.js, and
// js/tool-metal-recolor.js (whose exported functions/prototypes it wraps),
// and after js/rain-planes.js (which document.writes in js/sky-dome.js) —
// and before game.js (whose own boot calls into all of them and reads
// window.DevTestingSwitchbox.flags directly). See index.html's script
// order, right before the game.js tag.
(() => {
  'use strict';

  const STORAGE_KEY = 'hobunji_dev_switchbox_v1';

  // Order here is also the on-screen checkbox order.
  const SWITCHES = Object.freeze({
    noAudio: {
      label: '🔇 Audio',
      hint: 'Mutes every game sound — SFX, footsteps, ambience, animal voices, music.',
    },
    noNpcBehavior: {
      label: '🚶 NPC & Creature AI',
      hint: 'Freezes villager schedules/pathing and all wildlife/bandit AI, spawning, and corpse cleanup.',
    },
    noWaterSim: {
      label: '💧 Water Simulation',
      hint: 'Skips the periodic water-level recompute (rain fill/drainage).',
    },
    lowPolyFoliage: {
      label: '🧊 Low-Poly Foliage',
      hint: 'Replaces newly generated trees/bushes/boulders/stumps with plain box placeholders.',
    },
    noSkySphere: {
      label: '🌌 Sky Sphere',
      hint: 'Hides the sky dome (sun/moon/clouds/stars) every frame. Ambient lighting math is unaffected — only the visible dome disappears.',
    },
    noBrickWalls: {
      label: '🧱 Brick Wall Generation',
      hint: "Skips WallBuilder's instanced brick/stone geometry used on house walls and road curbs — the plain building/road base underneath still renders.",
    },
    noShingleGlbs: {
      label: '🏚️ Eave/Shingle GLBs',
      hint: 'Never loads the authored shingle GLB; roofs fall back to the existing simpler procedural tube shingles.',
    },
    noGrass: {
      label: '🌱 Grass',
      hint: "Turns off the farm/town/wilderness grass billboard layer — same effect as Settings' own Grass toggle.",
    },
    noWind: {
      label: '🍃 Wind',
      hint: "Stops the wind-sway shader on grass/foliage billboards — same effect as Settings' own Wind toggle.",
    },
    noShellOutlines: {
      label: '✏️ Shell Outlines',
      hint: "Disables the black shell-outline render pass (and the other outline passes gated by the same Settings switch).",
    },
    noVerdigris: {
      label: '🟢 Verdigris',
      hint: 'Skips tool oxidation/aging recoloring; base metal tinting still applies.',
    },
    noCharacterGroundShadows: {
      label: '◉ Character Ground Shadows',
      hint: 'Do not draw individual avatar ground-shadow disks. Keeps their objects/transforms alive for gameplay.',
    },
    noPngAvatarOcclusion: {
      label: '▧ PNG Portrait Depth Pass',
      hint: 'Skips the PNG-avatar-only depth replay pass; weapon/3D shell outlines may appear through portraits.',
    },
    noCorpseVisuals: {
      label: '☠ Corpse Rig Rendering',
      hint: 'Hides settled corpse avatar groups after death animation. Corpses remain in simulation and lootable, but become invisible.',
    },
    noLayeredWeaponDecorations: {
      label: '⚔ Layered Weapon Decorations',
      hint: 'Skips creating multi-sprite weapon assemblies. Weapon action logic and original tool plane remain, but layered weapon art may be absent.',
    },
    noPortraitDepthMatrixParity: {
      label: '▤ Portrait Depth Matrix Sync',
      hint: 'Skips per-mesh portrait matrix capture/restore around depth replays. May introduce temporary outline/depth jitter.',
    },
    noHandOutlineMatrixParity: {
      label: '✋ Hand Outline Matrix Sync',
      hint: 'Skips hand mesh outline matrix callback hooks, while retaining normal hand attachment and held overlay tagging.',
    },
    noFootOutlineMatrixParity: {
      label: '🦶 Foot Outline Matrix Sync',
      hint: 'Skips foot mesh outline callback hooks, preserving leg animation and water-occluded mesh registration.',
    },
    noUnusedAnimalTextureCache: {
      label: '🧠 Idle Animal Texture Cache',
      hint: 'Keep currently used animal frames, but immediately dispose unreferenced cached frames (may cause stutter when animals blink or change animation).',
    },
    reducedPortraitPixelCache: {
      label: '🧠 Full Portrait Image Cache (48 MiB)',
      hint: 'Uncheck to shrink the source-image cache budget from 48 MiB to 8 MiB. Live avatar textures are unaffected; assets may reload more often.',
    },
    noSkinnedPants: {
      label: '👖 Deformable Pants Rig',
      hint: 'Skips allocating deformable pants overlays for newly built characters; keeps procedural legs, inventory, physics, and attacks intact.',
    },
  });

  function readFlags() {
    const flags = Object.fromEntries(Object.keys(SWITCHES).map(key => [key, false]));
    try {
      const raw = window.localStorage?.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed) for (const key of Object.keys(SWITCHES)) if (typeof parsed[key] === 'boolean') flags[key] = parsed[key];
    } catch (_) {}
    return flags;
  }

  const flags = readFlags();
  function saveFlags() {
    try { window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(flags)); } catch (_) {}
  }

  // Applies a full { switchName: boolean } batch (as produced by a panel's
  // Confirm click) in one shot. Returns false and does nothing if the batch
  // matches what's already active, so Confirm never reloads for no reason.
  function applyFlags(nextFlags) {
    let changed = false;
    for (const key of Object.keys(SWITCHES)) {
      if (!!flags[key] !== !!nextFlags[key]) { changed = true; break; }
    }
    if (!changed) return false;
    for (const key of Object.keys(SWITCHES)) flags[key] = !!nextFlags[key];
    saveFlags();
    location.reload();
    return true;
  }

  window.DevTestingSwitchbox = Object.freeze({
    flags, // Read directly (e.g. window.DevTestingSwitchbox.flags.noNpcBehavior) by the couple of per-frame checks in game.js that can't be patched from outside.
    SWITCHES,
    applyFlags,
  });

  // Dev Companion's performance A/B panel reuses these boot-time guards.
  // Delaying the reload lets the BroadcastChannel acknowledge the switch first.
  const COMPANION_SAFE_SWITCHES = Object.freeze([
    'noShellOutlines', 'noGrass', 'noWind', 'lowPolyFoliage',
    'noBrickWalls', 'noShingleGlbs', 'noSkySphere', 'noAudio', 'noVerdigris',
    'noCharacterGroundShadows', 'noPngAvatarOcclusion', 'noCorpseVisuals', 'noLayeredWeaponDecorations',
    'noPortraitDepthMatrixParity', 'noHandOutlineMatrixParity', 'noFootOutlineMatrixParity', 'noUnusedAnimalTextureCache', 'reducedPortraitPixelCache', 'noSkinnedPants'
  ]); // Deliberately excludes AI and water simulation: disabling them alters active gameplay state.

  const PAINTERLY_BACKUP_KEY = 'hobunji-dev-companion-painterly-previous-v1'; // Restores the user's selected quality after a temporary A/B disable.

  function companionToggleSwitch(name, enabled) {
    if (name === 'trim-animal-textures') {
      const before = window.CreatureTextureCache?.snapshot?.() || [];
      const after = window.CreatureTextureCache?.trimUnused?.() || [];
      const sum = rows => rows.reduce((total, row) => total + (row.estimatedBytes || 0), 0);
      return { ok: true, beforeBytes: sum(before), afterBytes: sum(after), removedBytes: Math.max(0, sum(before) - sum(after)) };
    }
    if (name === 'painterly' && typeof enabled === 'boolean') {
      const painterly = window.PainterlyPostprocess;
      if (!painterly?.setMode || !painterly?.getMode) return { ok: false, error: 'Painterly filter is not ready.' };
      const mode = painterly.getMode();
      if (!enabled && mode !== 'off') {
        try { sessionStorage.setItem(PAINTERLY_BACKUP_KEY, mode); } catch (_) {}
        painterly.setMode('off');
      } else if (enabled && mode === 'off') {
        let restore = 'medium';
        try { restore = sessionStorage.getItem(PAINTERLY_BACKUP_KEY) || restore; } catch (_) {}
        painterly.setMode(['low', 'medium', 'high'].includes(restore) ? restore : 'medium');
      }
      return { ok: true, changed: true, reloading: false };
    }
    if (!COMPANION_SAFE_SWITCHES.includes(name) || typeof enabled !== 'boolean')
      return { ok: false, error: 'Unsupported switch or value.' };
    const off = !enabled; // UI is positive: checked means the feature runs.
    if (flags[name] === off) return { ok: true, changed: false };
    flags[name] = off;
    saveFlags();
    setTimeout(() => location.reload(), 350);
    return { ok: true, changed: true, reloading: true };
  }

  window.DevCompanion?.registerCheatPanel?.({
    id: 'performance-ab-switchbox',
    title: 'Performance A/B switchbox',
    order: -200,
    render: () => ({
      summary: 'Rendering cost isolation',
      rows: [
        ['FPS', Number(window.MobileRenderBudget?.snapshot?.()?.fps || 0).toFixed(1)],
        ['Wildlife guard candidates (cumulative)', String(window.WildlifeFoodWeb?.getScanDebug?.()?.guardCandidates ?? '—')],
        ['Wildlife prey candidates (cumulative)', String(window.WildlifeFoodWeb?.getScanDebug?.()?.preyCandidates ?? '—')],
        ['Portrait search candidates (cumulative)', String(window.PerpRotation?.getScanDebug?.()?.candidatesVisited ?? '—')],
        ['Portrait lookup cache hits', String(window.PerpRotation?.getScanDebug?.()?.cacheHits ?? '—')],
        ['Render-lift hostile visits (cumulative)', String(window.HobunjiAnimalSubtleElevation?.getScanDebug?.()?.hostiles ?? '—')],
        ['Render-lift corpse visits (cumulative)', String(window.HobunjiAnimalSubtleElevation?.getScanDebug?.()?.corpses ?? '—')],
        ['JS heap (Chrome)', Number.isFinite(performance.memory?.usedJSHeapSize) ? (performance.memory.usedJSHeapSize / 1048576).toFixed(1) + ' MiB' : 'Unavailable'],
        ['Heap limit', Number.isFinite(performance.memory?.jsHeapSizeLimit) ? (performance.memory.jsHeapSizeLimit / 1048576).toFixed(0) + ' MiB' : 'Unavailable'],
        ['Animal textures (estimated)', ((window.CreatureTextureCache?.snapshot?.() || []).reduce((n, x) => n + (x.estimatedBytes || 0), 0) / 1048576).toFixed(1) + ' MiB'],
        ['Unused animal textures', ((window.CreatureTextureCache?.snapshot?.() || []).reduce((n, x) => n + (x.unusedEstimatedBytes || 0), 0) / 1048576).toFixed(1) + ' MiB'],
        ['Creature image-cache entries', String(window.CreatureGeneticsRender?.memorySnapshot?.()?.imageEntries ?? '—')],
        ['GPU textures', String(window.PerfProfiler?.getLiveGpuInfo?.()?.textures ?? '—')],
        ['GPU geometries', String(window.PerfProfiler?.getLiveGpuInfo?.()?.geometries ?? '—')],
      ],
      actions: [
        {
          id: 'trim-animal-textures',
          group: 'Memory (live action)',
          label: 'Trim unused animal textures',
          title: 'Dispose only unreferenced cached animal frames now; never clears textures still attached to living or dead rigs.',
        },
        {
          id: 'painterly',
          group: 'Live (no reload)',
          label: '🎨 Painterly postprocess',
          title: 'Disables additional painterly compositing without changing the underlying outline setting.',
          toggle: true,
          checked: window.PainterlyPostprocess?.getMode?.() !== 'off',
          disabled: !window.PainterlyPostprocess?.setMode,
        },
        ...COMPANION_SAFE_SWITCHES.map(name => ({
        id: name,
        group: 'Enabled = feature active',
        label: SWITCHES[name].label,
        title: SWITCHES[name].hint + ' Changing this restarts the game tab.',
        toggle: true,
        checked: !flags[name],
      }))],
      note: 'Memory numbers are live when supported; texture memory is estimated. Painterly changes instantly; each other change reloads the game tab and reconnects this companion. Save first. AI and water simulation are deliberately excluded because they change world state. Outlines also gates the painterly filter.',
    }),
    onAction: (name, args) => companionToggleSwitch(name, args.enabled),
  });

  // ── Character-rig rendering isolation ───────────────────────────────
  // All four experiments preserve entity state, collision, damage, and corpse
  // ownership. They affect ONLY optional draw/assembly layers; reload restores.
  if (flags.noCharacterGroundShadows && window.CharacterGroundShadow?.make) {
    const nativeMakeShadow = window.CharacterGroundShadow.make; // Original factory used by all living NPC/animal/player callers.
    window.CharacterGroundShadow.make = function (...args) {
      const shadow = nativeMakeShadow.apply(this, args);
      if (shadow) shadow.visible = false; // No draw calls but maintain a valid Mesh for callers that position/scale it.
      return shadow;
    };
  }

  if (flags.noPngAvatarOcclusion && window.PngPlaneOutlineOccluder?.renderDepth) {
    window.PngPlaneOutlineOccluder.renderDepth = function () {};
    // Registered meshes and regular avatar draws remain untouched.
  }

  if (flags.noLayeredWeaponDecorations && window.HobunjiWeaponSpriteAssemblies?.decorate) {
    const nativeDecorateWeapon = window.HobunjiWeaponSpriteAssemblies.decorate; // Preserved for debugging/reload; no gameplay attack hooks are modified.
    window.HobunjiWeaponSpriteAssemblies.decorate = function (root, ...args) {
      if (root?.userData?.toolPlane) return root; // Retains the existing base tool; only skips assembling extra decorative meshes.
      return nativeDecorateWeapon.call(this, root, ...args);
    };
  }

  // ── 🔇 Audio ─────────────────────────────────────────────────────────
  // Rather than gate every play*() call across the several separate sound
  // modules (AudioSystem, HobunjiAmbientBgs, AnimalVocalizations, ambient
  // dialogue, music-system...), patch the two browser primitives every one
  // of them ultimately plays through: HTMLMediaElement.play() covers every
  // pooled/one-shot <audio> element (footsteps, object/combat SFX, voices,
  // music), and BaseAudioContext.createGain() covers the Web Audio synth
  // fallbacks (oscillator-based footsteps/attacks) — every gain node this
  // codebase creates sits between its signal and ctx.destination, so forcing
  // each one's value to (and pinned at) 0 silences that whole chain.
  //
  // play() rejects (rather than silently resolving) with the same
  // NotAllowedError name a real browser autoplay block uses — every play()
  // call site in this codebase already has a .catch() for exactly that
  // case (it's a normal, expected outcome here, not an error), so this
  // reuses that existing handling instead of adding a new one. It also
  // keeps the in-game debug log honest: with a silent Promise.resolve()
  // every caller logs something like "unlock replay started" even though
  // nothing audible happened, which reads as this switch having failed —
  // rejecting routes those same call sites into their existing "blocked"
  // log line instead.
  if (flags.noAudio) {
    try {
      if (window.HTMLMediaElement) {
        window.HTMLMediaElement.prototype.play = function () {
          return Promise.reject(new DOMException('Playback blocked: Testing Switchbox Audio is off.', 'NotAllowedError'));
        };
      }
      const gainProto = window.BaseAudioContext?.prototype || window.AudioContext?.prototype;
      if (gainProto && typeof gainProto.createGain === 'function') {
        const nativeCreateGain = gainProto.createGain;
        gainProto.createGain = function (...args) {
          const node = nativeCreateGain.apply(this, args);
          // Automation methods (setValueAtTime/linearRampToValueAtTime/...)
          // schedule the audio-thread parameter timeline directly and don't
          // go through the .value accessor below, so each one needs its own
          // override too — pinning .value alone would miss any gain fade
          // driven by these instead of a plain assignment.
          const nativeSetValueAtTime = node.gain.setValueAtTime?.bind(node.gain);
          if (nativeSetValueAtTime) node.gain.setValueAtTime = (_v, t) => nativeSetValueAtTime(0, t);
          const nativeLinearRamp = node.gain.linearRampToValueAtTime?.bind(node.gain);
          if (nativeLinearRamp) node.gain.linearRampToValueAtTime = (_v, t) => nativeLinearRamp(0, t);
          const nativeExpRamp = node.gain.exponentialRampToValueAtTime?.bind(node.gain);
          if (nativeExpRamp) node.gain.exponentialRampToValueAtTime = (_v, t) => nativeExpRamp(0.0001, t);
          // Plain `gainNode.gain.value = x` assignment (seen in this
          // codebase's own oscillator-based footstep/combat synth fallback)
          // is a direct property set, not a method call — locking it via
          // its own accessor is the only way to keep it pinned at 0.
          try {
            Object.defineProperty(node.gain, 'value', { get: () => 0, set: () => {}, configurable: true });
          } catch (_) { node.gain.value = 0; }
          return node;
        };
      }
    } catch (err) {
      console.warn('[Testing Switchbox] audio mute patch failed', err);
    }
  }

  // ── 💧 Water Simulation ─────────────────────────────────────────────
  // recomputeWater is the periodic flood-fill/drainage pass (see game.js's
  // gameLoop, ticked every 1/8 game-hour) — every caller fires it and
  // ignores the return value, so a plain no-op is a safe stand-in. The
  // lighter per-frame mesh sync (updateTownWaterMeshes/updateZoneWaterMeshes)
  // is left alone so existing water tiles keep rendering normally.
  if (flags.noWaterSim && window.WaterSystem && typeof window.WaterSystem.recomputeWater === 'function') {
    window.WaterSystem.recomputeWater = function () {};
  }

  // ── 🧊 Low-Poly Foliage ──────────────────────────────────────────────
  // FoliageGenerator's public API is a set of buildXMesh(col, row, ...)
  // factories that each return a fresh THREE.Group at local-origin, which
  // the caller then positions/scales — swapping the return value for a
  // simple box costs nothing at every call site. Real trees can carry
  // gameplay metadata (userData.canopyLocal for camera-occlusion, a named
  // climbBranch mesh for ClimbSystem) but every reader of those already
  // treats them as optional, so a plain placeholder with none of it is safe.
  if (flags.lowPolyFoliage && window.FoliageGenerator) {
    const material = new THREE.MeshLambertMaterial({ color: 0x6fae52 });
    // Rough per-preset footprint so e.g. a boulder placeholder doesn't read as
    // a sapling — exact size doesn't matter, this is a spatial stand-in.
    const SIZE_BY_METHOD = {
      buildBoulderMesh: [0.8, 0.6, 0.8],
      buildStumpMesh: [0.5, 0.35, 0.5],
      buildWeedsMesh: [0.35, 0.3, 0.35],
      buildShrubMesh: [0.5, 0.5, 0.5],
      buildWildernessBushMesh: [0.5, 0.5, 0.5],
      buildNeedlegrainMesh: [0.3, 0.6, 0.3],
      buildHeftrootMesh: [0.3, 0.5, 0.3],
    };
    const DEFAULT_SIZE = [0.55, 1.6, 0.55]; // Trees (crowned pine / shadewood / jungle tree) and anything unlisted.

    function placeholderGroup(size) {
      const [w, h, d] = size;
      const group = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      box.position.y = h / 2; // Base-anchored at local origin, matching the real meshes it replaces.
      box.castShadow = true;
      group.add(box);
      return group;
    }

    for (const methodName of Object.keys(window.FoliageGenerator)) {
      if (!/^build.*Mesh$/.test(methodName) || typeof window.FoliageGenerator[methodName] !== 'function') continue;
      const size = SIZE_BY_METHOD[methodName] || DEFAULT_SIZE;
      window.FoliageGenerator[methodName] = () => placeholderGroup(size);
    }
  }

  // ── 🌌 Sky Sphere ─────────────────────────────────────────────────────
  // The sky dome (js/sky-dome.js) is a single THREE.Group named
  // 'hobunji_dynamic_skydome' that at least two other modules (rain-planes.js,
  // cloud-forest-fog.js) independently flip .visible on every frame for
  // their own area-transition reasons, so a one-time root.visible = false
  // would just get overwritten a moment later by whichever of them runs
  // next. sky-dome.js also doubles as this game's ambient-lighting-state
  // source (getLightingState/fullDayLightingState — other systems read sun/
  // moon position for lighting, not just for drawing the dome) so disabling
  // its update() outright is not safe. Instead, wrap the renderer itself:
  // forcing the dome invisible immediately before each render() call is
  // guaranteed to be the last word for that frame, regardless of what any
  // other module did to it earlier in the same tick, while leaving every
  // other part of the sky-dome module (lighting math included) untouched.
  // Note for this exact three.js r128 build: WebGLRenderer.prototype.render
  // is undefined — render() is an own instance property set inside the
  // constructor closure — so the constructor itself has to be wrapped
  // rather than its prototype.
  if (flags.noSkySphere) {
    try {
      const OriginalRenderer = window.THREE?.WebGLRenderer;
      if (OriginalRenderer && !OriginalRenderer.__devSwitchboxSkyWrapped) {
        const WrappedRenderer = function (...args) {
          const instance = new OriginalRenderer(...args);
          const originalRender = instance.render.bind(instance);
          instance.render = function (scene, camera) {
            const sky = scene?.getObjectByName?.('hobunji_dynamic_skydome');
            if (sky) sky.visible = false;
            return originalRender(scene, camera);
          };
          return instance;
        };
        WrappedRenderer.prototype = OriginalRenderer.prototype;
        WrappedRenderer.__devSwitchboxSkyWrapped = true;
        window.THREE.WebGLRenderer = WrappedRenderer;
      }
    } catch (err) {
      console.warn('[Testing Switchbox] sky sphere patch failed', err);
    }
  }

  // ── 🧱 Brick Wall Generation ──────────────────────────────────────────
  // Every wall-brick instance in the game (house bodies/gables, road curbs,
  // barns...) goes through a `new WallBuilder(...)` instance calling its own
  // .build(panels, opts) — every instance shares WallBuilder.prototype, so
  // patching it once here covers all of them. The underlying building/road
  // base geometry is built separately (HousePieceGen's own face meshes,
  // the road's own path mesh) and is unaffected — this only removes the
  // decorative instanced brick layer added on top.
  if (flags.noBrickWalls && window.WallBuilder?.prototype && typeof window.WallBuilder.prototype.build === 'function') {
    window.WallBuilder.prototype.build = function () {
      const group = new THREE.Group();
      group.name = 'WallBuilder_Instances_disabled';
      return group;
    };
  }

  // ── 🏚️ Eave/Shingle GLBs ──────────────────────────────────────────────
  // HousePieceGen's roof shingles already have a graceful fallback: each
  // shingle tries _makeShingle() (needs the authored GLB template) first and
  // falls back to _makeTube() (a plain procedural tube) whenever that
  // template isn't loaded (see HousePieceGen.js's _addShingles). Simply
  // never letting the GLB template load — instead of trying to intercept
  // every shingle placement — routes every roof through that existing
  // cheaper fallback for free.
  if (flags.noShingleGlbs && window.HousePieceGen && typeof window.HousePieceGen.loadShingleGlb === 'function') {
    window.HousePieceGen.loadShingleGlb = function () { return Promise.resolve(null); };
  }

  // ── 🟢 Verdigris ──────────────────────────────────────────────────────
  // ToolMetalRecolor.getRecoloredCanvas takes an oxidationAmount alongside
  // the base metal-tint color; recolorAndOxidize already early-returns
  // before building any oxidation mask/outline when oxidationAmount is 0
  // and there's no authored removal pattern, so forcing both here disables
  // just the verdigris aging effect (and its per-pixel mask/outline cost)
  // while leaving ordinary tool metal tinting intact.
  if (flags.noVerdigris && window.ToolMetalRecolor && typeof window.ToolMetalRecolor.getRecoloredCanvas === 'function') {
    const nativeGetRecoloredCanvas = window.ToolMetalRecolor.getRecoloredCanvas;
    window.ToolMetalRecolor.getRecoloredCanvas = function (spritePath, opts = {}) {
      return nativeGetRecoloredCanvas.call(this, spritePath, { ...opts, oxidationAmount: 0, authoredPattern: null, authoredPatterns: [] }); // Disables both legacy slot 1 and the optional dual-pattern stack.
    };
  }

  // ── 🌱 Grass / 🍃 Wind / ✏️ Shell Outlines ────────────────────────────
  // These three already have live, no-reload player-facing Settings
  // checkboxes (settingGrass/settingBillWind/settingOutlines) wired entirely
  // inside game.js's own closure — there's no exported setter to call
  // directly. Forcing the checkbox unchecked and dispatching a real 'change'
  // event routes through game.js's own existing listener exactly as if the
  // player had clicked it, reusing its already-correct per-area/per-mesh
  // application logic instead of reimplementing it. This has to wait for
  // game.js to actually attach those listeners first — DOMContentLoaded
  // fires only after every synchronous <script> in the document (game.js
  // included, since it carries neither defer nor async) has finished
  // running, so by then the listeners are guaranteed to already exist.
  function forceSettingCheckboxOff(id) {
    const el = document.getElementById(id);
    if (!el || !el.checked) return;
    el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function applyDeferredLiveSettings() {
    if (flags.noGrass) forceSettingCheckboxOff('settingGrass');
    if (flags.noWind) forceSettingCheckboxOff('settingBillWind');
    if (flags.noShellOutlines) forceSettingCheckboxOff('settingOutlines');
  }

  if (flags.noGrass || flags.noWind || flags.noShellOutlines) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyDeferredLiveSettings, { once: true });
    else applyDeferredLiveSettings();
  }

  // ── Shared checkbox-panel builder ─────────────────────────────────────
  // Used by both render locations below. Every checkbox starts matched to
  // the currently-active flags and can be freely flipped with no effect;
  // Confirm reads the whole set at once and hands it to applyFlags, which
  // reloads only if something in the batch actually changed.
  function buildSwitchboxPanel() {
    const root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:10px;opacity:.75;margin-bottom:2px;';
    hint.textContent = 'Check a box to turn that system OFF, then hit Confirm to reload with your changes.';
    root.appendChild(hint);

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
    root.appendChild(list);

    const pending = { ...flags };
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.style.cssText = 'margin-top:6px;align-self:flex-start;padding:6px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:inherit;font:inherit;font-size:11px;cursor:pointer;';

    function refreshConfirmState() {
      const changed = Object.keys(SWITCHES).some(name => !!pending[name] !== !!flags[name]);
      confirmBtn.disabled = !changed;
      confirmBtn.style.opacity = changed ? '1' : '.45';
      confirmBtn.style.cursor = changed ? 'pointer' : 'default';
      confirmBtn.textContent = changed ? '✔ Confirm (reloads)' : '✔ Confirm';
    }

    for (const name of Object.keys(SWITCHES)) {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;';
      row.title = SWITCHES[name].hint;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!pending[name];
      cb.dataset.devSwitch = name;
      cb.addEventListener('change', () => { pending[name] = cb.checked; refreshConfirmState(); });

      const span = document.createElement('span');
      span.textContent = SWITCHES[name].label;

      row.appendChild(cb);
      row.appendChild(span);
      list.appendChild(row);
    }

    confirmBtn.addEventListener('click', () => applyFlags(pending));
    refreshConfirmState();
    root.appendChild(confirmBtn);
    return root;
  }

  // ── Dev Tools panel wiring ───────────────────────────────────────────
  // The panel markup (#devSwitchboxGrid) lives in index.html next to the
  // rest of #devSpawnPanel's dev-only controls.
  function installSwitchboxUI() {
    const mount = document.getElementById('devSwitchboxGrid');
    if (!mount || mount.dataset.switchboxBound) return;
    mount.dataset.switchboxBound = '1';
    mount.appendChild(buildSwitchboxPanel());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installSwitchboxUI, { once: true });
  else installSwitchboxUI();

  // ── Save/character-select entry point ───────────────────────────────
  // The actual "character select" screen (onboarding-core.js's #ob-overlay
  // .ob-card — "Choose Your Farmer"/"Choose Your World", or the empty-save
  // gate save-startup-gate.js shows a new browser first) renders well
  // before this script runs and gets fully torn down and rebuilt (a fresh
  // .ob-card element) on every character/world click. Mirrors save-startup-
  // gate.js's own approach for the same reason: a MutationObserver on
  // document.body, coalesced onto one rAF-scheduled refresh, so the section
  // keeps reappearing after every rebuild without doing real DOM work on
  // ticks where nothing actually changed.
  const SAVE_SELECT_SECTION_ID = 'devSwitchboxSaveSelectSection';

  function devModeEnabled() {
    try { return window.localStorage?.getItem('hobunjiDevMode') === '1'; } catch { return false; }
  }

  function buildSaveSelectSection() {
    const section = document.createElement('div');
    section.id = SAVE_SELECT_SECTION_ID;
    section.className = 'sl-section';
    const title = document.createElement('div');
    title.className = 'sl-section-label';
    title.textContent = '🧪 Testing Switchbox — dev-only';
    section.appendChild(title);
    section.appendChild(buildSwitchboxPanel());
    return section;
  }

  function findVisibleSaveSelectCard() {
    // #ob-overlay can hold more than one .ob-card at once — save-startup-
    // gate.js hides the real "Create Your Farmer" card (display:none) behind
    // its own empty-save gate card until the player restores or explicitly
    // chooses to create a farmer — so this has to pick whichever one is
    // actually shown, not just the first match in DOM order.
    for (const card of document.querySelectorAll('#ob-overlay .ob-card')) {
      const style = getComputedStyle(card);
      if (style.display !== 'none' && style.visibility !== 'hidden') return card;
    }
    return null;
  }

  function refreshSaveSelectEntryPoint() {
    const card = findVisibleSaveSelectCard();
    const existing = document.getElementById(SAVE_SELECT_SECTION_ID);
    if (!card || !devModeEnabled()) {
      existing?.remove();
      return;
    }
    if (existing && existing.parentElement === card) return; // Still attached to the current (not yet re-rendered) card.
    existing?.remove(); // Left over from a card onboarding-core.js already replaced.
    card.appendChild(buildSaveSelectSection());
  }

  let saveSelectRefreshScheduled = false;
  function scheduleSaveSelectRefresh() {
    if (saveSelectRefreshScheduled) return;
    saveSelectRefreshScheduled = true;
    requestAnimationFrame(() => { saveSelectRefreshScheduled = false; refreshSaveSelectEntryPoint(); });
  }

  function installSaveSelectEntryPoint() {
    refreshSaveSelectEntryPoint();
    new MutationObserver(scheduleSaveSelectRefresh).observe(document.body, { childList: true, subtree: true });
  }

  if (document.body) installSaveSelectEntryPoint();
  else document.addEventListener('DOMContentLoaded', installSaveSelectEntryPoint, { once: true });
})();

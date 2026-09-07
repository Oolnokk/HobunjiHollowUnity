// Species-relative Shoulder Cam framing.
//
// The authored Shoulder Cam values are treated as the Tletingan reference:
// target Y remains 0.62 tiles for a Tletingan and distance remains 2.6 tiles.
// Other humanoid species aim vertically at their live neck joint and scale the
// native camera distance by their authored full-character height. The ordinary
// user zoom multiplier/FOV remain untouched, so existing Settings still compose.
(() => {
  'use strict';

  const VERSION = 1; // Exposed in mobile diagnostics to identify this framing contract.
  const SHOULDER_MODE = 'shoulderSurf'; // Used to resolve the existing native over-the-shoulder camera config.
  const REFERENCE_SPECIES = 'tletingan'; // Defines which species keeps the current Shoulder Cam defaults exactly unchanged.
  const FALLBACK_DISTANCE_TILES = 2.6; // Used only if the authored Shoulder Cam distance is unavailable when this module installs.
  const FALLBACK_TARGET_Y_TILES = 0.62; // Used only if the authored Shoulder Cam vertical target is unavailable when this module installs.
  const MIN_HEIGHT_RATIO = 0.5; // Guards corrupted scale data from placing the camera implausibly close.
  const MAX_HEIGHT_RATIO = 1.75; // Guards corrupted scale data from placing the camera implausibly far away.
  const MIN_NECK_HEIGHT_TILES = 0.1; // Rejects a malformed/below-floor neck pivot before it can drive camera Y.
  const MAX_NECK_HEIGHT_TILES = 3; // Rejects a malformed neck pivot far outside the humanoid portrait scale.
  const PLAYER_NAME = 'player'; // Matches the existing procedural leg/hand runtime name used for the local player root.
  let playerRoot = null; // Captured from the existing procedural player rig so camera metrics are read from the same floor-relative root.
  let playerIdentity = null; // Stores the latest player species/gender resolved at rig attachment time.
  let baselineDistanceTiles = null; // Captures the repository's Tletingan Shoulder Cam distance before any species adjustment is applied.
  let baselineTargetYTiles = null; // Captures the repository's Tletingan Shoulder Cam Y target before any species adjustment is applied.
  let lastSnapshot = null; // Mobile-readable record of the latest measured and applied framing values.
  let legHookInstalled = false; // Prevents wrapping ProceduralLegAnimation.attach more than once.
  let handHookInstalled = false; // Prevents wrapping ProceduralHandAttachments.attach more than once.

  function normalizeSpeciesKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function normalizeGender(value) {
    const gender = String(value || '').trim().toLowerCase(); // Used to choose the gender-matched Tletingan height reference.
    return gender === 'female' || gender === 'f' ? 'female' : 'male';
  }

  function shoulderModeConfig() {
    return window.SCRATCHBONES_CONFIG?.game?.camera?.modes?.[SHOULDER_MODE] || null;
  }

  function captureBaselines() {
    if (baselineDistanceTiles != null && baselineTargetYTiles != null) return true;
    const mode = shoulderModeConfig(); // Read once before player-specific framing mutates either authored field.
    if (!mode) return false;
    const distance = Number(mode.distanceTiles); // Becomes the exact Tletingan distance reference used for all height ratios.
    const targetY = Number(mode.targetYOffsetTiles); // Becomes the exact Tletingan neck/framing reference retained for Tletingan.
    baselineDistanceTiles = Number.isFinite(distance) && distance > 0 ? distance : FALLBACK_DISTANCE_TILES;
    baselineTargetYTiles = Number.isFinite(targetY) ? targetY : FALLBACK_TARGET_Y_TILES;
    return true;
  }

  function findRuntimeIdentity(root) {
    let found = null; // Filled by the first descendant carrying character-rig-scale runtime identity metadata.
    root?.traverse?.(node => {
      if (found) return;
      const metadata = node?.userData?.hobunjiCharacterRigHeadRuntime;
      if (metadata?.species) found = { speciesId: metadata.species, gender: metadata.gender };
    });
    return found;
  }

  function identityFor(root, options = {}) {
    const scaleState = root?.userData?.hobunjiCharacterRigScaleState || null; // Preferred source after the canonical full-character scale wrapper has run.
    const runtime = findRuntimeIdentity(root); // Supplies gender/species when the hand caller did not include them directly.
    const appearance = options.appearance || options.profile?.appearance || options.profile?.fighter || options.npcRecord?.appearance || {}; // Covers the existing avatar caller shapes without adding a new appearance schema.
    const speciesId = normalizeSpeciesKey(
      options.speciesId
      || appearance.speciesId
      || appearance.species
      || options.profile?.speciesId
      || options.profile?.species
      || scaleState?.species
      || runtime?.speciesId,
    ); // Used by scaleFor() and the debug snapshot.
    const gender = normalizeGender(
      options.gender
      || appearance.gender
      || options.profile?.gender
      || runtime?.gender,
    ); // Used to compare against the corresponding Tletingan authored body height.
    return speciesId ? { speciesId, gender } : null;
  }

  function findNeckRig(root) {
    let found = null; // Stores the avatar node that owns both the live neck rig and its portrait model-height metadata.
    root?.traverse?.(node => {
      if (found) return;
      const rig = node?.userData?.neckRig;
      if (!rig?.neckJoint?.getWorldPosition) return;
      const modelHeight = Number(node?.userData?.portraitModelHeight); // Used below to report the live, scaled full-character height in tiles.
      found = { node, rig, modelHeight: Number.isFinite(modelHeight) && modelHeight > 0 ? modelHeight : null };
    });
    return found;
  }

  function finitePositive(value, fallback = null) {
    const number = Number(value); // Shared validation for authored scale and measured height values.
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function clampedHeightRatio(value) {
    const ratio = finitePositive(value, 1); // Used to make camera distance proportional to character height while retaining a safe fallback.
    return Math.max(MIN_HEIGHT_RATIO, Math.min(MAX_HEIGHT_RATIO, ratio));
  }

  function measureCharacter(root, identity) {
    const THREE = window.THREE; // Existing game Three.js instance used only for temporary world-position/scale vectors during rig rebuilds.
    const found = findNeckRig(root); // Supplies the exact neck bone requested for vertical camera framing.
    if (!THREE?.Vector3 || !root?.getWorldPosition || !found) return null;

    root.updateMatrixWorld?.(true);
    const rootWorld = root.getWorldPosition(new THREE.Vector3()); // Defines floor-relative world Y for the assembled character.
    const neckWorld = found.rig.neckJoint.getWorldPosition(new THREE.Vector3()); // Defines the actual current neck-joint world Y after authored body scaling/head offset.
    const avatarScale = found.node.getWorldScale?.(new THREE.Vector3()) || null; // Converts portraitModelHeight into the actual world/tile character height.
    const characterHeight = found.modelHeight && avatarScale
      ? found.modelHeight * Math.abs(Number(avatarScale.y) || 0)
      : null; // Reported in debug and used to derive a same-base-model Tletingan reference height.
    const neckHeight = Number(neckWorld.y) - Number(rootWorld.y); // Camera target Y is expressed in tiles above the same player root used by Shoulder Cam.

    const scaleApi = window.HobunjiCharacterRigScale; // Canonical authored per-species body-height source; no duplicate height table is introduced here.
    const scaleState = root?.userData?.hobunjiCharacterRigScaleState || null; // Contains the actual full-character factor already applied to this player root.
    const currentScaleY = finitePositive(scaleState?.factor?.y, finitePositive(scaleApi?.scaleFor?.(identity.speciesId, identity.gender)?.y, 1)); // Used to retain any runtime-authored player scale if present.
    const referenceScaleY = finitePositive(scaleApi?.scaleFor?.(REFERENCE_SPECIES, identity.gender)?.y, currentScaleY); // Gender-matched Tletingan height keeps both Tletingan body defaults at a 1.0 camera ratio.
    const heightRatio = clampedHeightRatio(currentScaleY / referenceScaleY); // Drives only native Shoulder Cam distance; general user zoom remains separate.
    const referenceCharacterHeight = finitePositive(characterHeight, null)
      ? characterHeight / heightRatio
      : null; // Mobile diagnostic showing the implied same-model Tletingan full height for this avatar.

    return {
      neckHeight: Number.isFinite(neckHeight) ? neckHeight : null,
      characterHeight: finitePositive(characterHeight, null),
      referenceCharacterHeight: finitePositive(referenceCharacterHeight, null),
      currentScaleY,
      referenceScaleY,
      heightRatio,
      modelHeight: found.modelHeight,
    };
  }

  function resolveFraming(identity, metrics) {
    captureBaselines();
    const heightRatio = clampedHeightRatio(metrics?.heightRatio); // Determines species-relative zoom/distance from full-character height.
    const measuredNeck = Number(metrics?.neckHeight); // Used directly for non-reference species when it is a plausible live neck pivot.
    const validNeck = Number.isFinite(measuredNeck) && measuredNeck >= MIN_NECK_HEIGHT_TILES && measuredNeck <= MAX_NECK_HEIGHT_TILES;
    const reference = normalizeSpeciesKey(identity?.speciesId) === REFERENCE_SPECIES; // Keeps the currently-authored Tletingan framing bit-for-bit unchanged.
    return {
      distanceTiles: (baselineDistanceTiles ?? FALLBACK_DISTANCE_TILES) * heightRatio,
      targetYOffsetTiles: reference
        ? (baselineTargetYTiles ?? FALLBACK_TARGET_Y_TILES)
        : validNeck
          ? measuredNeck
          : (baselineTargetYTiles ?? FALLBACK_TARGET_Y_TILES) * heightRatio,
      heightRatio,
      usedMeasuredNeck: !reference && validNeck,
      referenceSpecies: reference,
    };
  }

  function rangedFocusState() {
    try {
      return window.HobunjiRangedCameraFocus?.snapshot?.() || null;
    } catch (_) {
      return null;
    }
  }

  function refreshPlayerFraming(root = playerRoot, options = {}, source = 'manual') {
    if (!root || !captureBaselines()) return false;
    const identity = identityFor(root, options) || playerIdentity; // Reuses the last known identity when a later procedural reattach omits species/gender options.
    if (!identity?.speciesId) return false;
    playerRoot = root;
    playerIdentity = identity;

    const metrics = measureCharacter(root, identity); // Reads neck/height only when the assembled rig changes, never in the frame loop.
    if (!metrics) return false;
    const resolved = resolveFraming(identity, metrics); // Pure species-relative framing result applied to the existing camera config below.
    const mode = shoulderModeConfig(); // Existing native camera config remains the single source consumed by game.js.
    if (!mode) return false;

    const focus = rangedFocusState(); // Prevents a rare appearance rebuild from stomping an actively interpolated ranged-focus distance.
    const focusActive = !!(focus?.active || Number(focus?.blend) > 0.002);
    if (!focusActive) mode.distanceTiles = resolved.distanceTiles;
    mode.targetYOffsetTiles = resolved.targetYOffsetTiles;

    lastSnapshot = {
      version: VERSION,
      source,
      speciesId: identity.speciesId,
      gender: identity.gender,
      neckHeightTiles: metrics.neckHeight,
      characterHeightTiles: metrics.characterHeight,
      referenceCharacterHeightTiles: metrics.referenceCharacterHeight,
      bodyScaleY: metrics.currentScaleY,
      referenceBodyScaleY: metrics.referenceScaleY,
      heightRatio: resolved.heightRatio,
      baselineDistanceTiles,
      baselineTargetYOffsetTiles: baselineTargetYTiles,
      resolvedDistanceTiles: resolved.distanceTiles,
      resolvedTargetYOffsetTiles: resolved.targetYOffsetTiles,
      usedMeasuredNeck: resolved.usedMeasuredNeck,
      referenceSpecies: resolved.referenceSpecies,
      distanceDeferredForRangedFocus: focusActive,
      rangedFocusBaseDistanceTiles: focus?.baseDistanceTiles ?? null,
    }; // Copyable mobile report for validating neck/height framing without devtools.
    return true;
  }

  function isPlayerAttachment(parent, options = {}) {
    if (parent && parent === playerRoot) return true;
    return String(options.name || '').trim().toLowerCase() === PLAYER_NAME;
  }

  function installLegHook() {
    const api = window.ProceduralLegAnimation; // Existing runtime reliably identifies the local player with options.name === 'player'.
    if (!api?.attach) return false;
    if (api.attach.__hobunjiShoulderCameraCharacterFramingWrapped) {
      legHookInstalled = true;
      return true;
    }
    const baseAttach = api.attach.bind(api); // Preserves every existing leg/foot attachment wrapper and its return value.
    const wrapped = function shoulderCameraLegAttach(THREE, parent, options = {}) {
      const result = baseAttach.apply(this, arguments);
      if (String(options.name || '').trim().toLowerCase() === PLAYER_NAME) {
        playerRoot = parent;
        const identity = identityFor(parent, options); // Captured now so the subsequent hand/full-scale attach can reuse it if needed.
        if (identity) playerIdentity = identity;
        setTimeout(() => refreshPlayerFraming(parent, options, 'player-leg-attach'), 0);
      }
      return result;
    };
    Object.assign(wrapped, api.attach);
    wrapped.__hobunjiShoulderCameraCharacterFramingWrapped = true;
    api.attach = wrapped;
    legHookInstalled = true;
    return true;
  }

  function installHandHook() {
    const api = window.ProceduralHandAttachments; // Existing hand attach is already wrapped by CharacterRigScale and therefore runs after the canonical body scale is applied.
    if (!api?.attach) return false;
    if (api.attach.__hobunjiShoulderCameraCharacterFramingWrapped) {
      handHookInstalled = true;
      return true;
    }
    const baseAttach = api.attach.bind(api); // Preserves CharacterRigScale plus every earlier hand attachment wrapper.
    const wrapped = function shoulderCameraHandAttach(THREE, parent, options = {}) {
      const result = baseAttach.apply(this, arguments);
      if (isPlayerAttachment(parent, options)) {
        playerRoot = parent;
        const identity = identityFor(parent, options); // Resolves against the newly-applied character scale/head runtime metadata.
        if (identity) playerIdentity = identity;
        refreshPlayerFraming(parent, options, 'player-hand-attach');
      }
      return result;
    };
    Object.assign(wrapped, api.attach);
    wrapped.__hobunjiShoulderCameraCharacterFramingWrapped = true;
    api.attach = wrapped;
    handHookInstalled = true;
    return true;
  }

  function install() {
    captureBaselines();
    installLegHook();
    installHandHook();
    return legHookInstalled && handHookInstalled;
  }

  function snapshot() {
    return lastSnapshot
      ? { ...lastSnapshot, hooksInstalled: { leg: legHookInstalled, hand: handHookInstalled } }
      : {
          version: VERSION,
          hooksInstalled: { leg: legHookInstalled, hand: handHookInstalled },
          baselineDistanceTiles,
          baselineTargetYOffsetTiles: baselineTargetYTiles,
          speciesId: playerIdentity?.speciesId || null,
          gender: playerIdentity?.gender || null,
        };
  }

  window.HobunjiShoulderCameraCharacterFraming = Object.freeze({
    version: VERSION,
    install,
    refreshPlayerFraming,
    resolveFraming,
    snapshot,
  });
  window.__shoulderCameraCharacterFramingDebug = window.HobunjiShoulderCameraCharacterFraming;

  let attempts = 0; // Bounds late-load retries in repository tools while avoiding any permanent polling in gameplay.
  let timer = null; // Holds the temporary installation retry interval until both existing rig APIs are ready.
  timer = setInterval(() => {
    if (install() || ++attempts >= 200) clearInterval(timer);
  }, 50);
  install();
})();

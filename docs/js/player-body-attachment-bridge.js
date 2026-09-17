// Adapts game-owned body-bound attachments into PlayerBodyTransformComposer.
//
// The composer intentionally does not know about companions, tools, or any
// game-specific dependency bag. This thin adapter supplies those roots lazily,
// so ragdoll/drunk/future body channels all inherit to the same attachments
// without any one effect module owning the relationship.
(() => {
  'use strict';

  const composer = window.PlayerBodyTransformComposer;
  if (!composer || window.__playerBodyAttachmentBridgeInstalled) return;
  window.__playerBodyAttachmentBridgeInstalled = true;

  const RAD = Math.PI / 180; // Converts shoulder-pet head yaw degrees into the shared rotation module's radians.
  let gameDeps = null;

  function chainFutureSetter(name, beforeSet) {
    const desc = Object.getOwnPropertyDescriptor(window, name);
    const previousSet = desc?.set;
    if (typeof previousSet !== 'function') return false;
    Object.defineProperty(window, name, {
      configurable: true,
      get: desc.get,
      set(value) {
        beforeSet?.(value);
        previousSet.call(window, value);
      },
    });
    return true;
  }

  function patchDevSpawner(api) {
    if (!api?.init || api.__playerBodyAttachmentInitHooked) return;
    const originalInit = api.init.bind(api);
    api.init = function playerBodyAttachmentAwareInit(injectedDeps) {
      gameDeps = injectedDeps;
      window.ProceduralHandAttachments?.installGameRuntime?.(injectedDeps);
      return originalInit(injectedDeps);
    };
    api.__playerBodyAttachmentInitHooked = true;
  }

  function ensureShoulderPetIdleFrame(companion, combatDeps) {
    const frameUrl = companion?.def?.sprites?.idle; // Uses the creature's own authored idle pose while it is perched on the player.
    if (!frameUrl || typeof combatDeps?.setCreatureFrame !== 'function' || !companion.avatarRef) return false;
    companion.__hobunjiShoulderIdleFrame = frameUrl; // Mobile/debug-readable proof of the shouldered presentation frame.
    if (companion.currentFrameUrl === frameUrl) return true;
    const genotypeKind = combatDeps.genotypeKindFor?.(companion) || companion.creatureKey || companion.kind || null; // Preserves patterned/recolored livestock through the shared frame compositor.
    combatDeps.setCreatureFrame(companion.avatarRef, frameUrl, genotypeKind, 'idle', companion.genotype);
    companion.currentFrameUrl = frameUrl;
    return true;
  }

  function wrappedAngleDelta(target, current) {
    let delta = target - current;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  }

  function ensureShoulderPetHeadDeadzone(companion) {
    const avatarRef = companion?.avatarRef;
    if (!avatarRef || typeof avatarRef.updateHeadYaw !== 'function') return false;
    if (avatarRef.__hobunjiShoulderHeadDeadzoneWrapped) return true;

    const originalUpdateHeadYaw = avatarRef.updateHeadYaw.bind(avatarRef); // Preserves the shared authored head-turn smoothing after the visual deadzone clamp.
    let visualState = null; // Persists the chosen deadzone edge for this perched animal so camera-center jitter cannot flip its head every frame.

    avatarRef.updateHeadYaw = function shoulderPetDeadzoneHeadYaw(degrees, deltaSeconds) {
      const requestedYawDeg = Number.isFinite(Number(degrees)) ? Number(degrees) : 0;
      if (companion?.stableRole !== 'shoulderPet') {
        visualState = null;
        companion._shoulderHeadDeadzoneDebug = {
          active: false,
          requestedYawDeg,
          reason: 'not-shoulder-pet',
        }; // A former shoulder pet keeps its shared head rig behavior once reassigned to another stable role.
        return originalUpdateHeadYaw(requestedYawDeg, deltaSeconds);
      }

      const rotationApi = window.PerpRotation;
      const bodyRot = Number(companion.pngRot);
      const bodyState = companion.perpState;
      const fallbackCameraPerps = bodyState?.pixelProbeDebug?.cameraPerpsRad
        || bodyState?.screenViewPerspectiveDebug?.cameraPerpsRad; // Previous body-clamp centers remain a safe fallback if the live camera resolver is temporarily unavailable.
      const cameraPerps = rotationApi?.perspectivePerpsForState && bodyState
        ? rotationApi.perspectivePerpsForState(bodyState, fallbackCameraPerps || [])
        : fallbackCameraPerps; // Reuses today's subject-specific screen-view resolver so a perched pet does not depend on stale body-plane probe state.
      if (!rotationApi?.perpClamp
        || !Number.isFinite(bodyRot)
        || !Array.isArray(cameraPerps)
        || !cameraPerps.length) {
        visualState = null;
        companion._shoulderHeadDeadzoneDebug = {
          active: false,
          requestedYawDeg,
          reason: 'missing-body-deadzone-state',
        }; // Exposed through PlayerBodyAttachmentBridge.getDebug for mobile diagnosis.
        return originalUpdateHeadYaw(requestedYawDeg, deltaSeconds);
      }

      if (!visualState || visualState.perpSides?.length !== cameraPerps.length) {
        const currentYawDeg = Number(avatarRef.headRig?.currentYawDeg) || 0;
        const currentVisualRot = bodyRot + currentYawDeg * RAD;
        visualState = {
          perpSides: cameraPerps.map(center => wrappedAngleDelta(currentVisualRot, center) >= 0 ? 1 : -1),
          locked: cameraPerps.map(() => false),
        };
      }

      const rawVisualRot = bodyRot + requestedYawDeg * RAD;
      const clamped = rotationApi.perpClamp(
        visualState,
        rawVisualRot,
        cameraPerps,
        rotationApi.CREATURE_PERP_DEAD_RAD,
      );
      const renderedYawDeg = wrappedAngleDelta(clamped.effectiveTarget, bodyRot) / RAD;
      companion._shoulderHeadDeadzoneDebug = {
        active: true,
        requestedYawDeg,
        renderedYawDeg,
        bodyRot,
        rawVisualRot,
        effectiveVisualRot: clamped.effectiveTarget,
        deadzoneRad: rotationApi.CREATURE_PERP_DEAD_RAD,
      }; // Keeps requested/rendered head yaw inspectable without changing gameplay look targets.
      return originalUpdateHeadYaw(renderedYawDeg, deltaSeconds);
    };
    avatarRef.__hobunjiShoulderHeadDeadzoneWrapped = true; // Prevents the external-root provider from stacking wrappers every render pass.
    return true;
  }

  if (window.DevSpawner) patchDevSpawner(window.DevSpawner);
  else chainFutureSetter('DevSpawner', patchDevSpawner);

  composer.registerExternalRootProvider('equippedTool', () => gameDeps?.toolHolder || null);

  composer.registerExternalRootProvider('shoulderPets', () => {
    const combatDeps = window.Combat?.deps;
    const player = combatDeps?.player;
    if (!player) return [];
    const roots = [];
    for (const companion of combatDeps.companionObjects || []) {
      if (!companion || companion.health <= 0 || companion.stableRole !== 'shoulderPet') continue;
      if ((companion.master || player) !== player) continue;
      if (companion.avatarRef?.group) {
        ensureShoulderPetIdleFrame(companion, combatDeps);
        ensureShoulderPetHeadDeadzone(companion);
        roots.push(companion.avatarRef.group);
      }
    }
    return roots;
  });

  window.PlayerBodyAttachmentBridge = {
    getDebug() {
      const handDebug = window.ProceduralHandAttachments?.getActiveDebug?.().find(entry => entry?.speciesId) || null;
      const activeShoulderPets = window.Combat?.deps?.companionObjects
        ? Array.from(window.Combat.deps.companionObjects).filter(companion =>
            companion?.health > 0
            && companion.stableRole === 'shoulderPet'
            && (companion.master || window.Combat.deps.player) === window.Combat.deps.player)
        : []; // Shared by the count and idle-frame diagnostics below.
      const primaryShoulderPet = activeShoulderPets[0] || null; // Supplies compact head-deadzone diagnostics to the existing mobile debug report.
      return {
        hasGameDeps: !!gameDeps,
        hasToolHolder: !!gameDeps?.toolHolder,
        proceduralHands: handDebug,
        activeShoulderPets: activeShoulderPets.length,
        shoulderPetsOnIdle: activeShoulderPets.filter(companion => !!companion.__hobunjiShoulderIdleFrame && companion.currentFrameUrl === companion.__hobunjiShoulderIdleFrame).length,
        shoulderHeadDeadzone: primaryShoulderPet?._shoulderHeadDeadzoneDebug || null,
      };
    },
  };
})();

// Persistent age-driven torso pitch composed with the existing procedural animation stack.
// Player contributions use PlayerBodyTransformComposer; NPC contributions mirror drunk-locomotion's
// non-accumulating body-root delta so age posture and drunken sway can coexist without fighting.
(() => {
  'use strict';

  const legApi = window.ProceduralLegAnimation; // Wrapped below because every humanoid PNG character already creates its procedural leg/body runtime through this API.
  const ageConfig = window.HobunjiNpcAgeEffectConfig; // Resolves exact NPC assignments and the tool-authored torsoPitchDeg value.
  const THREE = window.THREE;
  if (!legApi?.attach || !ageConfig || !THREE || legApi.__npcAgeBodyPostureInstalled) return;

  const BODY_CHANNEL = 'age-posture'; // Named player composer channel reserved for persistent age posture.
  const BODY_PRIORITY = 90; // Runs before transient drunken/combat body channels so those effects layer on top of the baseline age posture.
  const DEG = Math.PI / 180; // Converts the tool-authored torso pitch degrees to the quaternion runtime.
  const activeHandles = new Set(); // Used by diagnostics to report currently decorated age rigs without keeping disposed handles alive.

  function finite(value, fallback = 0) {
    const number = Number(value); // Normalizes optional tool/runtime override values before composition.
    return Number.isFinite(number) ? number : fallback;
  }

  function resolveEffect(options) {
    if (typeof options?.ageEffectProvider === 'function') {
      try {
        const provided = options.ageEffectProvider(); // Allows future dynamic/player aging without changing ProceduralLegAnimation's API again.
        if (provided) return provided;
      } catch (_) {}
    }
    const npcRecord = options?.npcRecord || options?.ageNpcRecord || null; // Preferred exact record when a caller already has it.
    return ageConfig.resolveNpcEffect({
      id: options?.npcId || npcRecord?.id || null,
      name: options?.npcName || npcRecord?.name || options?.name || null,
    }); // Name fallback covers the existing NPC leg-attach calls that identify walkers by their authored display name.
  }

  function bodyRootFor(options) {
    return options?.ageBodyRoot || options?.drunkBodyRoot || options?.avatarRoot || null; // Reuses the isolated NPC sway/visual root when available so feet remain floor-planted.
  }

  function hasQuaternionDelta(quaternion) {
    return !!quaternion?.isQuaternion && (
      Math.abs(quaternion.x) + Math.abs(quaternion.y) + Math.abs(quaternion.z) > 1e-10
      || Math.abs(quaternion.w - 1) > 1e-10
    );
  }

  function decorateHandle(options, handle, effect, isPlayer) {
    if (!handle || !effect) return handle;
    const originalUpdate = typeof handle.update === 'function' ? handle.update.bind(handle) : null; // Existing gait/drunk/ragdoll update called between clearing and reapplying the persistent age delta.
    const originalDispose = typeof handle.dispose === 'function' ? handle.dispose.bind(handle) : null; // Existing disposal kept intact after age cleanup.
    const state = {
      pitchDeg: finite(effect.torsoPitchDeg),
      pitchRad: finite(effect.torsoPitchDeg) * DEG,
      bodyTilt: new THREE.Quaternion(), // Tracks only the NPC age quaternion so removing it never disturbs other animation layers.
      disposed: false,
    };

    function clearNpcDelta() {
      if (isPlayer) return;
      const bodyRoot = bodyRootFor(options); // Isolated torso/visual root shared with drunk locomotion when the walker provides one.
      if (!bodyRoot?.quaternion || !hasQuaternionDelta(state.bodyTilt)) return;
      bodyRoot.quaternion.multiply(state.bodyTilt.clone().invert());
      state.bodyTilt.identity();
    }

    function applyDelta() {
      const pitchRad = finite(state.pitchDeg) * DEG; // Re-read author/debug mutations so a tool/runtime inspector can tune a live handle without rebuilding it.
      state.pitchRad = pitchRad;
      if (isPlayer) {
        window.PlayerBodyTransformComposer?.setChannel(BODY_CHANNEL, {
          priority: BODY_PRIORITY,
          mode: 'additive',
          rotation: { pitch: pitchRad },
        }); // Player-facing composition remains render-only and never overwrites movement/facing state.
        return;
      }
      const bodyRoot = bodyRootFor(options); // NPCs have no general body composer, so mirror drunk-locomotion's tracked non-accumulating root quaternion.
      if (!bodyRoot?.quaternion) return;
      state.bodyTilt.setFromEuler(new THREE.Euler(pitchRad, 0, 0, 'YXZ'));
      bodyRoot.quaternion.multiply(state.bodyTilt);
    }

    handle.update = function agePostureUpdate(...args) {
      clearNpcDelta(); // Removes exactly last frame's age offset while preserving whatever other animation state currently exists.
      const result = originalUpdate?.(...args); // Lets the normal gait and outer/inner animation decorators resolve a clean current-frame base.
      applyDelta(); // Reapplies age as the persistent baseline after transient pose writers have finished.
      return result;
    };

    handle.dispose = function agePostureDispose() {
      if (state.disposed) return;
      state.disposed = true;
      clearNpcDelta();
      if (isPlayer) window.PlayerBodyTransformComposer?.clearChannel(BODY_CHANNEL);
      activeHandles.delete(handle);
      return originalDispose?.();
    };

    handle.agePosture = {
      effect,
      get torsoPitchDeg() { return state.pitchDeg; },
      set torsoPitchDeg(value) { state.pitchDeg = Math.max(-45, Math.min(45, finite(value))); },
      get bodyRoot() { return bodyRootFor(options); },
      get isPlayer() { return isPlayer; },
    }; // Mobile/debug-friendly live handle used by the Age Effect tool and diagnostics.
    activeHandles.add(handle);
    applyDelta();
    return handle;
  }

  const previousAttach = legApi.attach.bind(legApi); // Includes earlier gait/drunk decorators because this module is loaded after drunk-locomotion.
  legApi.attach = function ageAwareLegAttach(THREEArg, parent, options = {}) {
    const handle = previousAttach(THREEArg, parent, options);
    const effect = resolveEffect(options); // Exact age assignment or an explicit future provider determines whether this character gets a torso offset.
    const isPlayer = String(options?.name || '').trim().toLowerCase() === 'player';
    return effect ? decorateHandle(options, handle, effect, isPlayer) : handle;
  };
  legApi.__npcAgeBodyPostureInstalled = true;

  window.HobunjiNpcAgeBodyPosture = Object.freeze({
    channel: BODY_CHANNEL,
    priority: BODY_PRIORITY,
    resolveEffect,
    applyPreview(root, effect) {
      if (!root?.rotation) return false;
      root.rotation.x = finite(effect?.torsoPitchDeg) * DEG; // Tool preview uses the identical degree-to-pitch convention as gameplay.
      return true;
    },
    getDebug() {
      return {
        activeHandleCount: activeHandles.size,
        handles: Array.from(activeHandles).map(handle => ({
          name: handle?.group?.name || null,
          torsoPitchDeg: handle?.agePosture?.torsoPitchDeg ?? null,
          isPlayer: handle?.agePosture?.isPlayer ?? false,
          hasBodyRoot: !!handle?.agePosture?.bodyRoot,
        })),
      };
    },
  });
})();

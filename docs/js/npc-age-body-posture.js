// Persistent age-driven torso pitch composed with the existing procedural animation stack.
// Player contributions use PlayerBodyTransformComposer; NPC contributions mirror drunk-locomotion's
// non-accumulating body-root delta so age posture and drunken sway can coexist without fighting.
(() => {
  'use strict';

  const legApi = window.ProceduralLegAnimation; // Wrapped below because every humanoid PNG character already creates its procedural leg/body runtime through this API.
  const ageConfig = window.HobunjiNpcAgeEffectConfig; // Resolves exact NPC assignments and the tool-authored torsoPitchDeg value.
  const THREE = window.THREE;
  if (!ageConfig) return;

  // portrait-utils already preserves source near-black pixels while applying ordinary body/clothing tinting.
  // The age layer has one additional failure mode: it can brighten an authored body-color SLOT whose
  // resolved target itself is exactly black before that tinting step. Restore those exact-black targets
  // after age profile construction so #000000 line/outline roles remain #000000 at every age amount.
  function preservePureBlackAgeSlots(profile) {
    const age = profile?.__hobunjiNpcAgeEffect;
    if (!profile?.bodyColors || !age?.agedSlots) return profile;
    let nextBodyColors = null;
    for (const slot of ['A', 'B', 'C']) {
      const record = age.agedSlots?.[slot];
      if (String(record?.originalHex || '').toLowerCase() !== '#000000') continue;
      if (!nextBodyColors) nextBodyColors = { ...profile.bodyColors };
      nextBodyColors[slot] = { hex: '#000000' };
      record.agedHex = '#000000'; // Keeps the tool/debug swatch truthful to the actual rendered target.
    }
    if (nextBodyColors) profile.bodyColors = nextBodyColors;
    return profile;
  }

  function installPureBlackAgeGuard() {
    const preview = window.NpcAvatarPreview;
    if (preview?.buildProfileFromNpcExport && !preview.__agePureBlackGuardInstalled) {
      const previousBuild = preview.buildProfileFromNpcExport.bind(preview);
      preview.buildProfileFromNpcExport = function blackSafeAgeProfileBuild(...args) {
        return preservePureBlackAgeSlots(previousBuild(...args));
      };
      if (typeof preview.buildAgePreviewProfile === 'function') {
        const previousPreviewBuild = preview.buildAgePreviewProfile.bind(preview);
        preview.buildAgePreviewProfile = function blackSafeAgePreviewBuild(...args) {
          return preservePureBlackAgeSlots(previousPreviewBuild(...args));
        };
      }
      preview.__agePureBlackGuardInstalled = true;
    }

    const runtime = window.HobunjiNpcAgeEffects;
    if (runtime?.buildAgePreviewProfile && !runtime.__pureBlackGuardInstalled) {
      const previousPreviewBuild = runtime.buildAgePreviewProfile.bind(runtime);
      const replacement = Object.freeze({
        ...runtime,
        buildAgePreviewProfile(...args) {
          return preservePureBlackAgeSlots(previousPreviewBuild(...args));
        },
        preservePureBlackAgeSlots,
        __pureBlackGuardInstalled: true,
      });
      window.HobunjiNpcAgeEffects = replacement;
      window.HobunjiNpcOldAgeEffects = replacement;
    }
  }

  // Aged torso pitch requires an actual neck joint to counter the hunch. Most generic PNG-plane callers
  // deliberately skip the heavier neck rig; aged humanoids are a narrow exception. Force the existing
  // PNGPlaneAvatar neck rig only when the already-resolved profile carries an age effect. If the caller
  // supplies a dedicated headCanvas (the Age Tool / Attack Editor do), it is used; otherwise the PNG
  // runtime falls back to its normal full-avatar neck-pivot detector.
  function installAgedNeckRigBuilder() {
    const avatarApi = window.PNGPlaneAvatar;
    if (!avatarApi?.buildSinglePlaneAvatarModel || avatarApi.buildSinglePlaneAvatarModel.__hobunjiAgedNeckRigWrapped) return;
    const previousBuild = avatarApi.buildSinglePlaneAvatarModel;
    const wrappedBuild = function ageNeckAwareAvatarBuild(THREEArg, sourceCanvas, options = {}) {
      const aged = !!options?.profile?.__hobunjiNpcAgeEffect;
      return previousBuild.call(this, THREEArg, sourceCanvas, aged ? { ...options, neckRig: true } : options);
    };
    wrappedBuild.__hobunjiAgedNeckRigWrapped = true;
    avatarApi.buildSinglePlaneAvatarModel = wrappedBuild;
  }

  installPureBlackAgeGuard();
  installAgedNeckRigBuilder();

  if (!legApi?.attach || !THREE || legApi.__npcAgeBodyPostureInstalled) return;

  const BODY_CHANNEL = 'age-posture'; // Named player composer channel reserved for persistent age posture.
  const BODY_PRIORITY = 90; // Runs before transient drunken/combat body channels so those effects layer on top of the baseline age posture.
  const DEG = Math.PI / 180; // Converts the tool-authored torso pitch degrees to the quaternion runtime.
  const activeHandles = new Set(); // Used by diagnostics to report currently decorated age rigs without keeping disposed handles alive.

  function finite(value, fallback = 0) {
    const number = Number(value); // Normalizes optional tool/runtime override values before composition.
    return Number.isFinite(number) ? number : fallback;
  }

  function resolveEffect(options) {
    if (options?.suppressAgeBodyPosture === true) return null; // Authoring previews can build real gameplay feet first, then apply one explicit posterior-pivot age transform without double-composition.
    const profileEffect = options?.profile?.__hobunjiNpcAgeEffect || null; // Preferred source so portrait aging and torso posture always share the exact same already-resolved preset/tuning.
    if (profileEffect) return profileEffect;
    if (typeof options?.ageEffectProvider === 'function') {
      try {
        const provided = options.ageEffectProvider(); // Allows future dynamic/player aging without changing ProceduralLegAnimation's API again.
        if (provided) return provided;
      } catch (_) {}
    }
    const npcRecord = options?.npcRecord || options?.ageNpcRecord || options?.profile?.npcRecord || null; // Preferred exact record when a caller already has it.
    return ageConfig.resolveNpcEffect({
      id: options?.npcId || npcRecord?.id || null,
      name: options?.npcName || npcRecord?.name || options?.name || null,
    }); // Name fallback covers the existing NPC leg-attach calls that identify walkers by their authored display name.
  }

  function bodyRootFor(options) {
    return options?.ageBodyRoot || options?.drunkBodyRoot || options?.avatarRoot || null; // Reuses the isolated NPC sway/visual root when available so feet remain floor-planted.
  }

  function neckJointFromRoot(root) {
    if (root?.userData?.neckRig?.neckJoint) return root.userData.neckRig.neckJoint;
    let found = null;
    root?.traverse?.(node => {
      if (!found && node?.userData?.neckRig?.neckJoint) found = node.userData.neckRig.neckJoint;
    });
    return found;
  }

  function neckJointFor(options) {
    return options?.ageNeckJoint
      || options?.avatarRoot?.userData?.neckRig?.neckJoint
      || neckJointFromRoot(bodyRootFor(options));
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
      neckCounter: new THREE.Quaternion(), // Equal-and-opposite local neck pitch; tracked separately so dialogue/look-at neck motion remains additive.
      disposed: false,
    };

    function clearNpcDelta() {
      if (isPlayer) return;
      const bodyRoot = bodyRootFor(options); // Isolated torso/visual root shared with drunk locomotion when the walker provides one.
      if (!bodyRoot?.quaternion || !hasQuaternionDelta(state.bodyTilt)) return;
      bodyRoot.quaternion.multiply(state.bodyTilt.clone().invert());
      state.bodyTilt.identity();
    }

    function clearNeckDelta() {
      const neck = neckJointFor(options);
      if (!neck?.quaternion || !hasQuaternionDelta(state.neckCounter)) return;
      neck.quaternion.multiply(state.neckCounter.clone().invert());
      state.neckCounter.identity();
    }

    function applyNeckCounter(pitchRad) {
      const neck = neckJointFor(options);
      if (!neck?.quaternion) return;
      state.neckCounter.setFromEuler(new THREE.Euler(-pitchRad, 0, 0, 'YXZ'));
      neck.quaternion.multiply(state.neckCounter); // Torso +θ, neck −θ keeps the authored head facing level while preserving independent yaw/look-at rotation.
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
        applyNeckCounter(pitchRad);
        return;
      }
      const bodyRoot = bodyRootFor(options); // NPCs have no general body composer, so mirror drunk-locomotion's tracked non-accumulating root quaternion.
      if (bodyRoot?.quaternion) {
        state.bodyTilt.setFromEuler(new THREE.Euler(pitchRad, 0, 0, 'YXZ'));
        bodyRoot.quaternion.multiply(state.bodyTilt);
      }
      applyNeckCounter(pitchRad);
    }

    handle.update = function agePostureUpdate(...args) {
      clearNpcDelta(); // Removes exactly last frame's age torso offset while preserving whatever other animation state currently exists.
      clearNeckDelta(); // Removes only the previous age counter before dialogue/look-at systems establish this frame's clean neck base.
      const result = originalUpdate?.(...args); // Lets the normal gait and outer/inner animation decorators resolve a clean current-frame base.
      applyDelta(); // Reapplies age torso + opposite neck counter as the persistent baseline after transient pose writers have finished.
      return result;
    };

    handle.dispose = function agePostureDispose() {
      if (state.disposed) return;
      state.disposed = true;
      clearNpcDelta();
      clearNeckDelta();
      if (isPlayer) window.PlayerBodyTransformComposer?.clearChannel(BODY_CHANNEL);
      activeHandles.delete(handle);
      return originalDispose?.();
    };

    handle.agePosture = {
      effect,
      get torsoPitchDeg() { return state.pitchDeg; },
      set torsoPitchDeg(value) { state.pitchDeg = Math.max(-45, Math.min(45, finite(value))); },
      get neckCounterPitchDeg() { return -state.pitchDeg; },
      get bodyRoot() { return bodyRootFor(options); },
      get neckJoint() { return neckJointFor(options); },
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
    preservePureBlackAgeSlots,
    applyPreview(root, effect) {
      if (!root?.rotation) return false;
      const pitchRad = finite(effect?.torsoPitchDeg) * DEG;
      root.rotation.x = pitchRad; // Dedicated tool torso pivot carries the body/hands while procedural feet remain outside it.
      const neck = neckJointFromRoot(root);
      if (neck?.quaternion) {
        const previewState = root.userData.__hobunjiAgePreviewPosture || (root.userData.__hobunjiAgePreviewPosture = { neckCounter: new THREE.Quaternion() });
        if (hasQuaternionDelta(previewState.neckCounter)) neck.quaternion.multiply(previewState.neckCounter.clone().invert());
        previewState.neckCounter.setFromEuler(new THREE.Euler(-pitchRad, 0, 0, 'YXZ'));
        neck.quaternion.multiply(previewState.neckCounter); // Exact opposite pitch makes the visual authoring preview match the runtime age composition.
      }
      return true;
    },
    getDebug() {
      return {
        activeHandleCount: activeHandles.size,
        handles: Array.from(activeHandles).map(handle => ({
          name: handle?.group?.name || null,
          torsoPitchDeg: handle?.agePosture?.torsoPitchDeg ?? null,
          neckCounterPitchDeg: handle?.agePosture?.neckCounterPitchDeg ?? null,
          isPlayer: handle?.agePosture?.isPlayer ?? false,
          hasBodyRoot: !!handle?.agePosture?.bodyRoot,
          hasNeckJoint: !!handle?.agePosture?.neckJoint,
        })),
      };
    },
  });
})();

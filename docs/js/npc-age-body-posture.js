// Event-driven NPC age posture integration.
//
// Age posture is resolved once when an avatar/body assembly is created. It does
// not wrap ProceduralLegAnimation.update(), request animation frames, or create
// timers. Persistent body transforms are a static NpcCharacterState composer
// channel; the opposite neck pitch is a static parent bone under the existing
// neck rig, so ordinary dialogue can keep animating the child neck joint.
(() => {
  'use strict';

  const config = window.HobunjiNpcAgeEffectConfig;
  const THREE = window.THREE;
  if (!config || !THREE) return;

  const composition = config.composition || {};
  const rendering = config.rendering || {};
  const DEG = Math.PI / 180;

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function effectForAvatarOptions(options = {}) {
    const profileEffect = options?.profile?.__hobunjiNpcAgeEffect || null;
    if (profileEffect) return profileEffect;
    const record = options?.npcRecord || options?.profile?.npcRecord || null;
    return record ? config.resolveNpcEffect(record) : null;
  }

  function preserveConfiguredExactColors(profile) {
    const age = profile?.__hobunjiNpcAgeEffect;
    if (!profile?.bodyColors || !age?.agedSlots) return profile;
    const slots = rendering.biologicalColorSlots || [];
    const preserved = new Set((rendering.preserveExactColors || []).map(value => String(value).toLowerCase()));
    let nextBodyColors = null;
    for (const slot of slots) {
      const record = age.agedSlots?.[slot];
      const originalHex = String(record?.originalHex || '').toLowerCase();
      if (!preserved.has(originalHex)) continue;
      if (!nextBodyColors) nextBodyColors = { ...profile.bodyColors };
      nextBodyColors[slot] = { hex: originalHex };
      record.agedHex = originalHex;
    }
    if (nextBodyColors) profile.bodyColors = nextBodyColors;
    return profile;
  }

  // This runs only when a portrait profile is constructed. It is part of the
  // tint/profile composition path, not an animation update path.
  function installTintCompositionGuard() {
    const preview = window.NpcAvatarPreview;
    if (preview?.buildProfileFromNpcExport && !preview.__ageExactColorGuardInstalled) {
      const previousBuild = preview.buildProfileFromNpcExport.bind(preview);
      preview.buildProfileFromNpcExport = function ageExactColorProfileBuild(...args) {
        return preserveConfiguredExactColors(previousBuild(...args));
      };
      if (typeof preview.buildAgePreviewProfile === 'function') {
        const previousPreviewBuild = preview.buildAgePreviewProfile.bind(preview);
        preview.buildAgePreviewProfile = function ageExactColorPreviewBuild(...args) {
          return preserveConfiguredExactColors(previousPreviewBuild(...args));
        };
      }
      preview.__ageExactColorGuardInstalled = true;
    }

    const runtime = window.HobunjiNpcAgeEffects;
    if (runtime?.buildAgePreviewProfile && !runtime.__exactColorGuardInstalled) {
      const previousPreviewBuild = runtime.buildAgePreviewProfile.bind(runtime);
      const replacement = Object.freeze({
        ...runtime,
        buildAgePreviewProfile(...args) {
          return preserveConfiguredExactColors(previousPreviewBuild(...args));
        },
        preserveConfiguredExactColors,
        __exactColorGuardInstalled: true,
      });
      window.HobunjiNpcAgeEffects = replacement;
      window.HobunjiNpcOldAgeEffects = replacement;
    }
  }

  function installStaticNeckCounter(avatarRoot, effect) {
    const rig = avatarRoot?.userData?.neckRig;
    const neckJoint = rig?.neckJoint;
    const originalParent = neckJoint?.parent;
    if (!rig?.available || !neckJoint?.isBone || !originalParent?.isObject3D) return null;
    if (rig.ageCounterBone?.isBone) return rig.ageCounterBone;

    const counterBone = new THREE.Bone();
    counterBone.name = `${neckJoint.name || 'neck'}_age_base`;
    counterBone.position.copy(neckJoint.position);
    counterBone.quaternion.copy(neckJoint.quaternion);
    counterBone.scale.copy(neckJoint.scale);

    originalParent.remove(neckJoint);
    neckJoint.position.set(0, 0, 0);
    neckJoint.quaternion.identity();
    neckJoint.scale.set(1, 1, 1);
    originalParent.add(counterBone);
    counterBone.add(neckJoint);

    const pitchRad = finite(effect?.torsoPitchDeg) * DEG * finite(composition.neckCounterPitchMultiplier, -1);
    counterBone.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitchRad, 0, 0, 'YXZ'))).normalize();
    counterBone.updateMatrixWorld(true);
    rig.ageCounterBone = counterBone;
    rig.ageCounterPitchRad = pitchRad;
    return counterBone;
  }

  function avatarIdentity(options = {}, avatarRoot = null) {
    const source = options?.profile?.fighter || options?.profile?.appearance || options?.npcRecord?.appearance || {};
    return {
      speciesId: String(options.speciesId || source.speciesId || source.species || avatarRoot?.userData?.speciesId || '').trim().toLowerCase().replace(/_/g, '-'),
      gender: String(options.gender || source.gender || avatarRoot?.userData?.gender || 'male').trim().toLowerCase() === 'female' ? 'female' : 'male',
    };
  }

  function posteriorYForAvatar(avatarRoot) {
    const meta = avatarRoot?.userData?.hobunjiAgeAvatarMeta || {};
    const identity = meta.identity || {};
    const modelHeight = finite(avatarRoot?.userData?.portraitModelHeight);
    const handAttachY = finite(avatarRoot?.userData?.handAttachY, modelHeight * finite(composition.standingLiftFraction, 0.5));
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {};
    const record = characters[`${identity.speciesId}::${identity.gender}`] || null;
    const resolved = Number(record?.resolvedPosteriorPosition?.y);
    if (Number.isFinite(resolved)) return resolved;
    const shared = window.HOBUNJI_ATTACHMENT_RIG_MATH?.characterPosteriorY?.(record?.posteriorRule, modelHeight, handAttachY);
    if (Number.isFinite(shared)) return shared;
    return handAttachY + modelHeight * finite(composition.posteriorFallbackHeightPercent) / finite(composition.percentScale, 100);
  }

  function verticalLowerY(effect, avatarRoot) {
    const modelHeight = finite(avatarRoot?.userData?.portraitModelHeight);
    const reduction = config.clampControl('verticalOffsetReductionPct', effect?.verticalOffsetReductionPct, 0)
      / finite(composition.percentScale, 100);
    return -(modelHeight * finite(composition.standingLiftFraction, 0.5)) * reduction;
  }

  function applyStaticBodyPosture(avatarRoot, effect) {
    if (!avatarRoot?.isObject3D || !effect) return null;
    const stateApi = window.NpcCharacterState;
    const bodyRoot = stateApi?.bodyTransformRootFor?.(avatarRoot);
    if (!bodyRoot) return null;
    const posteriorY = posteriorYForAvatar(avatarRoot);
    const pitchRad = config.clampControl('torsoPitchDeg', effect.torsoPitchDeg, 0) * DEG;
    const lowerY = verticalLowerY(effect, avatarRoot);
    stateApi.setBodyTransformChannel?.(bodyRoot, composition.bodyChannel, {
      priority: composition.bodyPriority,
      rotation: { pitch: pitchRad },
      pivot: { x: 0, y: posteriorY, z: 0 },
      translation: { x: 0, y: lowerY, z: 0 },
    });
    const debug = Object.freeze({
      mode: 'static-composer-channel',
      channel: composition.bodyChannel,
      priority: composition.bodyPriority,
      torsoPitchDeg: effect.torsoPitchDeg,
      torsoPitchRad: pitchRad,
      verticalOffsetReductionPct: effect.verticalOffsetReductionPct,
      verticalLowerY: lowerY,
      posteriorY,
      bodyRootName: bodyRoot.name || null,
      perFrameAgeWork: false,
    });
    bodyRoot.userData.hobunjiAgePostureDebug = debug;
    avatarRoot.userData.hobunjiAgePostureDebug = debug;
    return debug;
  }

  function installAgedAvatarBuilder() {
    const avatarApi = window.PNGPlaneAvatar;
    if (!avatarApi?.buildSinglePlaneAvatarModel || avatarApi.buildSinglePlaneAvatarModel.__hobunjiStaticAgePostureWrapped) return;
    const previousBuild = avatarApi.buildSinglePlaneAvatarModel;
    const wrappedBuild = function ageAwareAvatarBuild(THREEArg, sourceCanvas, options = {}) {
      const effect = effectForAvatarOptions(options);
      const avatarRoot = previousBuild.call(this, THREEArg, sourceCanvas, effect ? { ...options, neckRig: true } : options);
      if (!avatarRoot || !effect) return avatarRoot;
      avatarRoot.userData = avatarRoot.userData || {};
      avatarRoot.userData.hobunjiAgeEffect = effect;
      avatarRoot.userData.hobunjiAgeAvatarMeta = { identity: avatarIdentity(options, avatarRoot) };
      installStaticNeckCounter(avatarRoot, effect);
      return avatarRoot;
    };
    wrappedBuild.__hobunjiStaticAgePostureWrapped = true;
    avatarApi.buildSinglePlaneAvatarModel = wrappedBuild;
  }

  function installNpcBodyComposerBridge() {
    const stateApi = window.NpcCharacterState;
    if (!stateApi?.attachAlcoholPose || stateApi.__staticAgePostureBridgeInstalled) return;
    const previousAttach = stateApi.attachAlcoholPose.bind(stateApi);
    const replacement = Object.freeze({
      ...stateApi,
      attachAlcoholPose(THREEArg, root, avatarGroup, npcId) {
        const poseGroup = previousAttach(THREEArg, root, avatarGroup, npcId);
        const effect = avatarGroup?.userData?.hobunjiAgeEffect || null;
        if (poseGroup && effect) applyStaticBodyPosture(avatarGroup, effect);
        return poseGroup;
      },
      __staticAgePostureBridgeInstalled: true,
    });
    window.NpcCharacterState = replacement;
  }

  installTintCompositionGuard();
  installAgedAvatarBuilder();
  installNpcBodyComposerBridge();

  window.HobunjiNpcAgeBodyPosture = Object.freeze({
    channel: composition.bodyChannel,
    priority: composition.bodyPriority,
    verticalLowerY,
    posteriorYForAvatar,
    applyStaticBodyPosture,
    preserveConfiguredExactColors,
    getDebug(avatarRoot) {
      return avatarRoot?.userData?.hobunjiAgePostureDebug
        || window.NpcCharacterState?.bodyTransformRootFor?.(avatarRoot)?.userData?.hobunjiAgePostureDebug
        || null;
    },
    performanceModel: Object.freeze({
      perFrameAgeWork: false,
      legUpdateWrapped: false,
      requestAnimationFrame: false,
      timers: false,
      application: 'avatar-build + static-body-channel',
    }),
  });
})();

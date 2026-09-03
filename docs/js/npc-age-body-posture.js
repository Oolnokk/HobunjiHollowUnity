// Event-driven NPC age posture integration.
//
// The canonical PNGPlaneAvatar renderer remains the owner of portrait geometry,
// skinning, attachment coordinates, and the neck rig. Age adds only two static
// transforms at avatar assembly time: a body/hand visual parent beneath the
// existing alcohol-pose group, plus an equal-and-opposite parent bone above the
// existing neck joint. Procedural feet remain on the walker floor root.
//
// There is deliberately no NPC transform composer, ProceduralLegAnimation
// update wrapper, requestAnimationFrame loop, or timer in this module.
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

  // Runs only when a portrait profile is constructed. This keeps the exact-color
  // exception on the same shared profile/tint path used by gameplay and the tool.
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

  // The child neck joint remains the normal runtime control surface for dialogue,
  // aim, hats, etc. The new parent contributes only the static age counter-pitch,
  // so later writes to neckJoint do not erase the age baseline.
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

    const pitchRad = config.clampControl('torsoPitchDeg', effect?.torsoPitchDeg, 0)
      * DEG
      * finite(composition.neckCounterPitchMultiplier, -1);
    counterBone.quaternion
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitchRad, 0, 0, 'YXZ')))
      .normalize();
    counterBone.updateMatrixWorld(true);
    rig.ageCounterBone = counterBone;
    rig.ageCounterPitchRad = pitchRad;
    return counterBone;
  }

  function avatarIdentity(options = {}, avatarRoot = null) {
    const source = options?.profile?.fighter || options?.profile?.appearance || options?.npcRecord?.appearance || {};
    return {
      speciesId: String(options.speciesId || source.speciesId || source.species || avatarRoot?.userData?.speciesId || '')
        .trim().toLowerCase().replace(/_/g, '-'),
      gender: String(options.gender || source.gender || avatarRoot?.userData?.gender || 'male')
        .trim().toLowerCase() === 'female' ? 'female' : 'male',
    };
  }

  // Attachment-rig coordinates are authored in the same floor-relative parent
  // space used by live hands/feet. Keeping the age body root's local coordinate
  // system in that space lets automatic hands inherit the body posture without
  // translating any authored shoulder/posterior values.
  function posteriorYForAvatar(avatarRoot) {
    const meta = avatarRoot?.userData?.hobunjiAgeAvatarMeta || {};
    const identity = meta.identity || {};
    const modelHeight = finite(avatarRoot?.userData?.portraitModelHeight);
    const handAttachY = finite(
      avatarRoot?.userData?.handAttachY,
      modelHeight * finite(composition.standingLiftFraction, 0.5),
    );
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {};
    const record = characters[`${identity.speciesId}::${identity.gender}`] || null;
    const resolved = Number(record?.resolvedPosteriorPosition?.y);
    if (Number.isFinite(resolved)) return resolved;
    const shared = window.HOBUNJI_ATTACHMENT_RIG_MATH?.characterPosteriorY?.(
      record?.posteriorRule,
      modelHeight,
      handAttachY,
    );
    if (Number.isFinite(shared)) return shared;
    return handAttachY
      + modelHeight * finite(composition.posteriorFallbackHeightPercent)
        / finite(composition.percentScale, 100);
  }

  function verticalLowerY(effect, avatarRoot) {
    const modelHeight = finite(avatarRoot?.userData?.portraitModelHeight);
    const reduction = config.clampControl('verticalOffsetReductionPct', effect?.verticalOffsetReductionPct, 0)
      / finite(composition.percentScale, 100);
    return -(modelHeight * finite(composition.standingLiftFraction, 0.5)) * reduction;
  }

  function bodyRootFor(avatarRoot) {
    return avatarRoot?.userData?.hobunjiAgeBodyRoot
      || avatarRoot?.userData?.bodyTransformRoot
      || null;
  }

  function applyStaticBodyPosture(avatarRoot, effect, bodyRoot = bodyRootFor(avatarRoot)) {
    if (!avatarRoot?.isObject3D || !bodyRoot?.isObject3D || !effect) return null;
    const posteriorY = posteriorYForAvatar(avatarRoot);
    const pitchRad = config.clampControl('torsoPitchDeg', effect.torsoPitchDeg, 0) * DEG;
    const lowerY = verticalLowerY(effect, avatarRoot);
    const pivot = new THREE.Vector3(0, posteriorY, 0);
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitchRad, 0, 0, 'YXZ'));

    // q * point + (pivot - q * pivot) rotates children around the authored
    // posterior while preserving their floor-relative local coordinates. The Y
    // translation then applies the small authored standing-height reduction.
    bodyRoot.position.copy(pivot).sub(pivot.clone().applyQuaternion(rotation));
    bodyRoot.position.y += lowerY;
    bodyRoot.quaternion.copy(rotation).normalize();
    bodyRoot.updateMatrix?.();
    bodyRoot.updateMatrixWorld?.(true);

    const debug = Object.freeze({
      mode: 'static-age-body-root',
      semanticChannel: composition.bodyChannel || 'age-posture',
      torsoPitchDeg: effect.torsoPitchDeg,
      torsoPitchRad: pitchRad,
      neckCounterPitchRad: avatarRoot?.userData?.neckRig?.ageCounterPitchRad ?? null,
      verticalOffsetReductionPct: effect.verticalOffsetReductionPct,
      verticalLowerY: lowerY,
      posteriorY,
      bodyRootName: bodyRoot.name || null,
      perFrameAgeWork: false,
    });
    bodyRoot.userData = bodyRoot.userData || {};
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

  // Reuse the stock NPC assembly seam instead of turning NpcCharacterState into
  // another transform system. The outer alcohol pose continues to own blackout;
  // this inner static root owns only age body posture. Because it is installed
  // synchronously before ProceduralHandFrameDriver settles its pending avatar,
  // the automatic hand rig naturally chooses this same root as avatarRoot.parent.
  function installNpcBodyHierarchyBridge() {
    const stateApi = window.NpcCharacterState;
    if (!stateApi?.attachAlcoholPose || stateApi.__staticAgePostureBridgeInstalled) return;
    const previousAttach = stateApi.attachAlcoholPose.bind(stateApi);
    const replacement = Object.freeze({
      ...stateApi,
      attachAlcoholPose(THREEArg, root, avatarGroup, npcId) {
        const poseGroup = previousAttach(THREEArg, root, avatarGroup, npcId);
        const effect = avatarGroup?.userData?.hobunjiAgeEffect || null;
        if (!poseGroup || !effect) return poseGroup;

        const bodyRoot = new THREEArg.Group();
        bodyRoot.name = `${npcId || avatarGroup.name || 'npc'}_age_posture`;
        bodyRoot.userData = bodyRoot.userData || {};
        bodyRoot.userData.hobunjiAgeBodyRoot = true;
        poseGroup.add(bodyRoot);
        bodyRoot.add(avatarGroup);
        avatarGroup.userData.hobunjiAgeBodyRoot = bodyRoot;
        avatarGroup.userData.bodyTransformRoot = bodyRoot; // Generic visual-root metadata for existing debug/tool consumers.
        applyStaticBodyPosture(avatarGroup, effect, bodyRoot);
        return poseGroup;
      },
      bodyTransformRootFor(subject) {
        return bodyRootFor(subject);
      },
      __staticAgePostureBridgeInstalled: true,
    });
    window.NpcCharacterState = replacement;
  }

  installTintCompositionGuard();
  installAgedAvatarBuilder();
  installNpcBodyHierarchyBridge();

  window.HobunjiNpcAgeBodyPosture = Object.freeze({
    channel: composition.bodyChannel || 'age-posture',
    verticalLowerY,
    posteriorYForAvatar,
    bodyRootFor,
    applyStaticBodyPosture,
    preserveConfiguredExactColors,
    getDebug(avatarRoot) {
      return avatarRoot?.userData?.hobunjiAgePostureDebug
        || bodyRootFor(avatarRoot)?.userData?.hobunjiAgePostureDebug
        || null;
    },
    performanceModel: Object.freeze({
      perFrameAgeWork: false,
      legUpdateWrapped: false,
      requestAnimationFrame: false,
      timers: false,
      npcTransformComposer: false,
      application: 'shared-avatar-build + static-body-hierarchy',
    }),
  });
})();

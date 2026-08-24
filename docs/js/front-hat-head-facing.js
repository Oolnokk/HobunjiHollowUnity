// Keeps front-authored hat pixels on the front side of the rigged head only.
//
// Portrait hats are composited into the same skinned PNG plane as the head. The
// GPU therefore culls by the mesh/body plane, while the neck bone can rotate the
// head-weighted pixels independently. A front hat can otherwise linger visibly
// through the skull after the head itself has crossed to its rear-facing side.
//
// Two independent binary gates are used:
//   camera/head yaw: hard handoff at exactly 90 degrees (no orbit fade/pop)
//   attack/body pitch+roll: hard safety cutoff at 35 degrees from upright
// The rear portrait/material remains responsible for whatever should be visible
// from behind. Hats authored with a real `pos: "back"` layer keep that rear art;
// front-only hats (e.g. the basic/leather headbands) are omitted from the rear
// portrait so their front sprite is never mirrored onto the back of the skull.
(function (global) {
  'use strict';

  const THREE = global.THREE;
  const preview = global.NpcAvatarPreview;
  const avatarApi = global.PNGPlaneAvatar;
  if (!THREE || !preview?.renderProfileToCanvas || !avatarApi?.buildSinglePlaneAvatarModel) return;

  const TILT_CUTOFF_DEG = 35;
  const TILT_CUTOFF_DOT = Math.cos(TILT_CUTOFF_DEG * Math.PI / 180);

  let pairedRenders = 0;
  let correctedBuilds = 0;
  let correctedMeshes = 0;
  let rearFrontOnlyHatsHidden = 0;
  let lastFacingDot = null;
  let lastYawDot = null;
  let lastUprightDot = null;

  const NONE_HAT = Object.freeze({ id: 'none', label: 'No Hat', tintSlot: null, layers: [] });

  function resolvedFighter(profile) {
    return typeof global.resolvePortraitFighter === 'function'
      ? (global.resolvePortraitFighter(profile?.fighter) || profile?.fighter)
      : profile?.fighter;
  }

  function resolvedLayers(option, profile) {
    if (!option) return [];
    try {
      return typeof global.resolveOptionLayers === 'function'
        ? global.resolveOptionLayers(option, resolvedFighter(profile))
        : (Array.isArray(option.layers) ? option.layers : []);
    } catch (_) {
      return Array.isArray(option.layers) ? option.layers : [];
    }
  }

  function hasHat(profile) {
    const hat = profile?.hat;
    return !!(hat && hat.id && hat.id !== 'none' && resolvedLayers(hat, profile).length);
  }

  function hatHasRearLayer(profile) {
    return resolvedLayers(profile?.hat, profile).some(layer => layer?.pos === 'back');
  }

  function isFineHoodTrimLayer(layer) {
    const url = String(layer?.url || '').toLowerCase().replace(/_/g, '-');
    return url.includes('finehood') && url.includes('trim') && url.endsWith('.png');
  }

  function stripFineHoodTrim(profile) {
    const hood = profile?.hood;
    if (!hood) return hood;
    const hoodLayers = resolvedLayers(hood, profile);
    if (!hoodLayers.some(isFineHoodTrimLayer)) return hood;
    return {
      ...hood,
      // resolveOptionLayers prefers variantLayers, so null it after resolving
      // the species-specific layer set and make the trimless list authoritative.
      variantLayers: null,
      layers: hoodLayers.filter(layer => !isFineHoodTrimLayer(layer)),
    };
  }

  function frozenBreathingComposer(renderOptions, nowMs) {
    const source = renderOptions?.breathingComposer ?? global.portraitBreathingComposer ?? null;
    if (!source) return null;
    return {
      getExpression(seatId) {
        return typeof source.getExpression === 'function' ? source.getExpression(seatId, nowMs) : 'neutral';
      },
      getOverlayOnlyPoints(_ignoredNowMs, seatId) {
        return typeof source.getOverlayOnlyPoints === 'function' ? source.getOverlayOnlyPoints(nowMs, seatId) : null;
      },
      getInterpolatedPoints(speciesId, gender, _ignoredNowMs, phaseOffsetMs, seatId) {
        return typeof source.getInterpolatedPoints === 'function'
          ? source.getInterpolatedPoints(speciesId, gender, nowMs, phaseOffsetMs, seatId)
          : null;
      },
      getAnimData(speciesId, gender) {
        return typeof source.getAnimData === 'function' ? source.getAnimData(speciesId, gender) : null;
      },
    };
  }

  function clearCanvasState(canvas) {
    if (!canvas) return;
    canvas.__hobunjiFrontHatlessCanvas = null;
    canvas.__hobunjiFrontHatFacingDebug = null;
  }

  function installBuildHook() {
    if (avatarApi.__hobunjiFrontHatFacingInstalled) return false;
    const currentBuild = avatarApi.buildSinglePlaneAvatarModel;
    if (typeof currentBuild !== 'function') return false;

    const currentDispose = typeof avatarApi.disposeAvatarModel === 'function'
      ? avatarApi.disposeAvatarModel.bind(avatarApi)
      : null;

    const attachHatShader = (root, object, material, hatlessCanvas, neckJoint) => {
      if (!object || !material || !hatlessCanvas || !neckJoint?.isBone) return false;
      if (material.userData?.hobunjiFrontHatlessTexture) return false;

      const hatlessTexture = new THREE.CanvasTexture(hatlessCanvas);
      if ('colorSpace' in hatlessTexture && THREE.SRGBColorSpace) hatlessTexture.colorSpace = THREE.SRGBColorSpace;
      hatlessTexture.needsUpdate = true;
      const facingUniform = { value: 1 };
      const previousOnBeforeCompile = material.onBeforeCompile;
      const previousProgramKey = typeof material.customProgramCacheKey === 'function'
        ? material.customProgramCacheKey.bind(material)
        : null;

      material.userData = material.userData || {};
      material.userData.hobunjiFrontHatlessTexture = hatlessTexture;
      material.userData.hobunjiFrontHatFacingUniform = facingUniform;
      material.userData.hobunjiFrontHatFacing = {
        enabled: true,
        yawCutoffDot: 0,
        yawCutoffDegrees: 90,
        tiltCutoffDot: TILT_CUTOFF_DOT,
        tiltCutoffDegrees: TILT_CUTOFF_DEG,
        transition: 'hard-step',
        facingSource: 'neck-bone',
      };

      material.onBeforeCompile = function onBeforeCompileFrontHatFacing(shader, renderer) {
        if (typeof previousOnBeforeCompile === 'function') previousOnBeforeCompile.call(this, shader, renderer);
        shader.uniforms.hobunjiFrontHatlessMap = { value: hatlessTexture };
        shader.uniforms.hobunjiFrontHatFacing = facingUniform;
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            '#include <common>\nuniform sampler2D hobunjiFrontHatlessMap;\nuniform float hobunjiFrontHatFacing;'
          )
          .replace(
            '#include <alphatest_fragment>',
            `vec4 hobunjiFrontHatlessTexel = mapTexelToLinear(texture2D(hobunjiFrontHatlessMap, vUv));\nvec4 hobunjiFrontHatlessDiffuse = vec4(diffuse, opacity) * hobunjiFrontHatlessTexel;\nfloat hobunjiFrontHatVisibility = hobunjiFrontHatFacing > 0.0 ? 1.0 : 0.0;\ndiffuseColor = mix(hobunjiFrontHatlessDiffuse, diffuseColor, hobunjiFrontHatVisibility);\n#include <alphatest_fragment>`
          );
      };
      material.customProgramCacheKey = () => `${previousProgramKey ? previousProgramKey() : ''}|hobunji-front-hat-hard90-yaw-tiltguard-v2`;
      material.needsUpdate = true;

      const previousOnBeforeRender = typeof object.onBeforeRender === 'function' ? object.onBeforeRender : null;
      const localFront = new THREE.Vector3(0, 0, 1);
      const localUp = new THREE.Vector3(0, 1, 0);
      const worldFront = new THREE.Vector3();
      const worldUp = new THREE.Vector3();
      const headWorld = new THREE.Vector3();
      const cameraWorld = new THREE.Vector3();
      const toCamera = new THREE.Vector3();
      const horizontalFront = new THREE.Vector3();
      const horizontalToCamera = new THREE.Vector3();
      const worldVertical = new THREE.Vector3(0, 1, 0);

      object.onBeforeRender = function frontHatFacingBeforeRender(renderer, scene, camera, geometry, currentMaterial, group) {
        previousOnBeforeRender?.call(this, renderer, scene, camera, geometry, currentMaterial, group);
        const uniform = currentMaterial?.userData?.hobunjiFrontHatFacingUniform;
        if (!uniform || !camera) return;

        neckJoint.updateWorldMatrix?.(true, false);
        worldFront.copy(localFront).transformDirection(neckJoint.matrixWorld).normalize();
        worldUp.copy(localUp).transformDirection(neckJoint.matrixWorld).normalize();
        neckJoint.getWorldPosition(headWorld);
        camera.getWorldPosition(cameraWorld);
        toCamera.copy(cameraWorld).sub(headWorld).normalize();

        horizontalFront.set(worldFront.x, 0, worldFront.z);
        horizontalToCamera.set(toCamera.x, 0, toCamera.z);
        const horizontalFrontLenSq = horizontalFront.lengthSq();
        const horizontalCameraLenSq = horizontalToCamera.lengthSq();
        let yawDot = worldFront.dot(toCamera);
        if (horizontalFrontLenSq > 1e-8 && horizontalCameraLenSq > 1e-8) {
          horizontalFront.multiplyScalar(1 / Math.sqrt(horizontalFrontLenSq));
          horizontalToCamera.multiplyScalar(1 / Math.sqrt(horizontalCameraLenSq));
          yawDot = horizontalFront.dot(horizontalToCamera);
        }

        const uprightDot = worldUp.dot(worldVertical);
        const visible = yawDot > 0 && uprightDot >= TILT_CUTOFF_DOT;
        uniform.value = visible ? 1 : 0;

        lastFacingDot = worldFront.dot(toCamera);
        lastYawDot = yawDot;
        lastUprightDot = uprightDot;
        currentMaterial.userData.hobunjiFrontHatLastFacingDot = lastFacingDot;
        currentMaterial.userData.hobunjiFrontHatLastYawDot = yawDot;
        currentMaterial.userData.hobunjiFrontHatLastUprightDot = uprightDot;
      };
      return true;
    };

    avatarApi.buildSinglePlaneAvatarModel = function buildSinglePlaneAvatarModelWithFrontHatFacing(threeArg, sourceCanvas, options = {}) {
      const root = currentBuild.apply(this, arguments);
      const hatlessCanvas = sourceCanvas?.__hobunjiFrontHatlessCanvas;
      if (!root || !hatlessCanvas) return root;

      const neckJoint = root.userData?.neckRig?.neckJoint;
      if (!neckJoint?.isBone) return root;

      let attached = 0;
      root.traverse?.(object => {
        const materials = object?.material
          ? (Array.isArray(object.material) ? object.material : [object.material])
          : [];
        for (const material of materials) {
          if (!/front_material$/i.test(String(material?.name || ''))) continue;
          if (attachHatShader(root, object, material, hatlessCanvas, neckJoint)) attached += 1;
        }
      });

      if (attached > 0) {
        root.userData = root.userData || {};
        root.userData.frontHatFacing = {
          enabled: true,
          attachedMaterials: attached,
          yawCutoffDot: 0,
          yawCutoffDegrees: 90,
          tiltCutoffDot: TILT_CUTOFF_DOT,
          tiltCutoffDegrees: TILT_CUTOFF_DEG,
          transition: 'hard-step',
          facingSource: 'neck-bone',
          render: sourceCanvas.__hobunjiFrontHatFacingDebug || null,
        };
        correctedBuilds += 1;
        correctedMeshes += attached;
      }
      return root;
    };

    if (currentDispose) {
      avatarApi.disposeAvatarModel = function disposeAvatarModelWithFrontHatFacing(root) {
        root?.traverse?.(object => {
          const materials = object?.material
            ? (Array.isArray(object.material) ? object.material : [object.material])
            : [];
          for (const material of materials) {
            material?.userData?.hobunjiFrontHatlessTexture?.dispose?.();
            if (material?.userData) {
              delete material.userData.hobunjiFrontHatlessTexture;
              delete material.userData.hobunjiFrontHatFacingUniform;
            }
          }
        });
        return currentDispose(root);
      };
    }

    avatarApi.__hobunjiFrontHatFacingInstalled = true;
    return true;
  }

  const previousRenderProfileToCanvas = preview.renderProfileToCanvas;
  preview.renderProfileToCanvas = async function renderProfileToCanvasWithFrontHatFacing(canvas, profile, renderOptions = {}) {
    if (!canvas || !profile) return previousRenderProfileToCanvas.apply(this, arguments);

    const renderBehind = renderOptions?.portraitView === 'behind' || renderOptions?.view === 'behind';
    const renderFrontComposite = !renderBehind
      && renderOptions?.onlyHeadSprite !== true
      && renderOptions?.omitHeadSpriteAndCosmetics !== true;
    const equippedHat = hasHat(profile);

    clearCanvasState(canvas);

    // A hat with no authored back layer has no legitimate rear-view sprite.
    // Do not let renderPortraitProfile fall back to drawing its front layer on
    // the back of the head (the exact bug exposed by the headbands).
    let effectiveProfile = profile;
    if (renderBehind && equippedHat && !hatHasRearLayer(profile)) {
      effectiveProfile = { ...profile, hat: NONE_HAT };
      rearFrontOnlyHatsHidden += 1;
    }

    const nowMs = Date.now();
    const composer = frozenBreathingComposer(renderOptions, nowMs);
    const pairedOptions = composer ? { ...renderOptions, breathingComposer: composer } : renderOptions;
    const result = await previousRenderProfileToCanvas.call(this, canvas, effectiveProfile, pairedOptions);

    if (!renderFrontComposite || !equippedHat || typeof global.renderPortraitProfile !== 'function') return result;

    const hatlessCanvas = document.createElement('canvas');
    hatlessCanvas.width = canvas.width;
    hatlessCanvas.height = canvas.height;
    const frontOnlyRemovedProfile = {
      ...profile,
      hat: NONE_HAT,
      // If Fine Hood is also equipped, its face-opening trim is front-only too.
      // Removing it here prevents the hatless fallback texture from ever
      // reintroducing that trim when the hat gate switches off.
      hood: stripFineHoodTrim(profile),
    };
    await global.renderPortraitProfile(hatlessCanvas, frontOnlyRemovedProfile, pairedOptions);

    canvas.__hobunjiFrontHatlessCanvas = hatlessCanvas;
    canvas.__hobunjiFrontHatFacingDebug = {
      enabled: true,
      hatId: profile.hat?.id || null,
      yawCutoffDot: 0,
      yawCutoffDegrees: 90,
      tiltCutoffDot: TILT_CUTOFF_DOT,
      tiltCutoffDegrees: TILT_CUTOFF_DEG,
      transition: 'hard-step',
      facingSource: 'neck-bone',
      rearMode: hatHasRearLayer(profile) ? 'authored-back-layer' : 'front-only-hidden-behind',
    };
    pairedRenders += 1;
    installBuildHook();
    return result;
  };

  global.HobunjiFrontHatHeadFacing = Object.freeze({
    getDebug() {
      return {
        pairedRenders,
        correctedBuilds,
        correctedMeshes,
        rearFrontOnlyHatsHidden,
        lastFacingDot,
        lastYawDot,
        lastUprightDot,
        yawCutoffDot: 0,
        yawCutoffDegrees: 90,
        tiltCutoffDot: TILT_CUTOFF_DOT,
        tiltCutoffDegrees: TILT_CUTOFF_DEG,
        transition: 'hard-step',
        facingSource: 'neck-bone',
      };
    },
  });
})(window);

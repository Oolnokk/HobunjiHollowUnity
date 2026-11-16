// Rig Coordinates' non-destructive shoulder-pet preview.
// Use the live animal head/shoulder mesh pipeline and the same idle/run1
// split-frame artwork selection as PlayerBodyAttachmentBridge. Never write
// preview poses into the exported shoulderGrip coordinates.
(() => {
  'use strict';

  function authoredRestFor(kind) {
    const rig = window.HobunjiShoulderSplineProfiles?.supportRigFor?.(kind); // The painter preview and shipped authored poses both resolve here.
    return rig?.shoulderRest?.enabled && rig.shoulderRest.useSpline ? rig.shoulderRest : null;
  }

  function clipShoulderSide(image, width, height, rest, keepRight) {
    const polygon = window.AnimalShoulderSpline?.separatorPolygon?.(width, height, rest, keepRight); // Gameplay owns separator geometry; this module only draws the correct art into it.
    if (!polygon?.length) throw new Error('The authored shoulder split separator is unavailable.');
    const canvas = document.createElement('canvas'); // Temporary authored front/back overlay in gameplay's source-pixel space.
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create shoulder-pose preview canvas.');
    ctx.beginPath();
    ctx.moveTo(polygon[0].x, polygon[0].y);
    for (let i = 1; i < polygon.length; i++) ctx.lineTo(polygon[i].x, polygon[i].y);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(image, 0, 0, width, height);
    return canvas;
  }

  function create({ kind, genotype, THREE, sourceAvatar, modelWidth, modelHeight, actorName,
    isCurrent = () => true, onChange = () => {}, viewportCreaturePlanes = null } = {}) {
    const rest = authoredRestFor(kind); // The selected species' independently authored AFTER shoulder pose.
    if (!rest || !sourceAvatar?.group || !THREE) return null;
    let requestedPose = 'source'; // Changes only editor presentation; never the underlying attachment transform.
    let posedAvatar = null; // Lazily built runtime-equivalent perched art, kept separate from the source mesh.
    let buildTask = null; // Coalesces repeated sync calls while an authored sprite is compositing.
    let buildError = null; // Displayed in the existing editor inspector for mobile debugging.
    let disposed = false; // Prevents asynchronous builders from attaching to a removed actor.

    const status = () => ({
      requestedPose,
      hasPose: !!posedAvatar,
      loading: !!buildTask,
      error: buildError?.message || null,
      sourceFrame: 'currently selected creature frame',
      shoulderFrame: rest.splitFrame
        ? (rest.splitRightUsesIdle ? 'idle + idle split' : 'idle + run1 split')
        : rest.useRun1 ? 'run1' : 'idle',
      splitFrame: !!rest.splitFrame,
    }); // Used by the Rig Coordinates status label without needing console access.

    function syncVisibility() {
      const showPose = !disposed && requestedPose === 'perched' && !!posedAvatar; // No unposed/perched double drawing.
      if (sourceAvatar.frontPlane) sourceAvatar.frontPlane.visible = !showPose;
      if (sourceAvatar.backPlane) sourceAvatar.backPlane.visible = !showPose;
      if (posedAvatar?.group) posedAvatar.group.visible = showPose;
    }

    async function buildPerchedAvatar() {
      const renderer = window.CreatureGeneticsRender;
      const builder = window.PNGPlaneAvatar?.buildAnimalPlaneAvatarModel;
      if (typeof renderer?.composeFrame !== 'function' || typeof builder !== 'function') {
        throw new Error('Animal sprite compositor or runtime shoulder rig is not loaded.');
      }
      const compose = frame => renderer.composeFrame(kind, frame, genotype); // Gameplay's own genotype-aware idle/run1 sprite renderer.
      let posedCanvas;
      let foreground = null;
      if (rest.splitFrame) {
        const idle = await compose('idle');
        const right = rest.splitRightUsesIdle ? idle : await compose('run1');
        const width = idle?.width || right?.width, height = idle?.height || right?.height;
        if (!width || !height) throw new Error('Shoulder-pose source frames have no dimensions.');
        posedCanvas = clipShoulderSide(right, width, height, rest, true); // The right half is the deformed background, as in gameplay.
        foreground = clipShoulderSide(idle, width, height, rest, false); // The left half stays its separate foreground art.
      } else {
        posedCanvas = await compose(rest.useRun1 ? 'run1' : 'idle'); // Preserve the actual authored run1 stance where requested.
      }
      if (!posedCanvas?.toDataURL) throw new Error('Could not compose the authored shoulder pose.');
      if (disposed || !isCurrent()) return null;

      const avatar = builder(THREE, posedCanvas.toDataURL('image/png'), {
        modelWidth, modelHeight, creatureId: kind,
        name: actorName + '_perched_shoulder_pose',
      }); // Exact runtime head rig, both skinned planes and shoulder spline, never a 2D imitation.
      if (!avatar.setShoulderRestEnabled?.(true)) {
        avatar.dispose?.();
        throw new Error('The animal did not build a deformable authored shoulder mesh.');
      }
      if (foreground && !avatar.setShoulderSplitOverlayCanvas?.(foreground, true)) {
        avatar.dispose?.();
        throw new Error('The authored split-frame foreground mesh is unavailable.');
      }
      if (disposed || !isCurrent()) {
        avatar.dispose?.();
        return null;
      }
      avatar.group.visible = false; // Remains hidden until the user selects Perched.
      sourceAvatar.group.add(avatar.group); // Inherit all existing actor/size transforms without changing the grip's local origin.
      for (const plane of [avatar.frontPlane, avatar.backPlane]) {
        if (plane && Array.isArray(viewportCreaturePlanes)) {
          viewportCreaturePlanes.push({ object: plane, baseRotationY: plane.rotation.y });
        }
      } // Keep existing viewport-facing correction usable for the second pair of rendered planes.
      posedAvatar = avatar;
      syncVisibility();
      onChange(status());
      return avatar;
    }

    function setPose(pose) {
      requestedPose = pose === 'perched' ? 'perched' : 'source'; // Invalid inputs fail back to the safe unmodified source view.
      if (!disposed && requestedPose === 'perched' && !posedAvatar && !buildTask && !buildError) {
        buildTask = buildPerchedAvatar().catch(error => {
          buildError = error instanceof Error ? error : new Error(String(error)); // Expose frame/spline failures visibly.
          return null;
        }).finally(() => {
          buildTask = null;
          syncVisibility();
          onChange(status());
        });
      }
      syncVisibility();
      onChange(status());
      return buildTask || Promise.resolve(posedAvatar);
    }

    function dispose() {
      disposed = true;
      sourceAvatar.frontPlane && (sourceAvatar.frontPlane.visible = true);
      sourceAvatar.backPlane && (sourceAvatar.backPlane.visible = true);
      if (posedAvatar) {
        posedAvatar.group?.parent?.remove?.(posedAvatar.group);
        posedAvatar.dispose?.();
        posedAvatar = null;
      }
    }

    return { setPose, status, dispose, rest };
  }

  window.AnimationAuthorShoulderPosePreview = {
    authoredRestFor, create,
  };
})();

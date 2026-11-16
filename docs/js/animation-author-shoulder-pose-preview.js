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
    const addedViewportPlanes = []; // Tracks posed front/back and split-overlay cards so cleanup removes references from the existing camera-yaw list.
    const posedPlaneScaleLinks = []; // Links posed meshes to the existing source meshes, whose direct scales are the editor's true size-class authority.

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

    function syncPlaneScale() {
      if (!posedAvatar || disposed) return;
      for (const { plane, source } of posedPlaneScaleLinks) {
        if (!plane?.scale || !source?.scale) continue;
        if (plane.scale.x === source.scale.x && plane.scale.y === source.scale.y
            && plane.scale.z === source.scale.z) continue; // No per-frame matrix churn when the size class is unchanged.
        plane.scale.copy(source.scale); // Rig Coordinates scales each actual creature card directly (V15.14), not its group.
        plane.updateMatrix?.(); // Match the editor's existing direct-plane update method after the user edits a size class.
      }
    }

    function syncVisibility() {
      syncPlaneScale(); // Keep the authored pose aligned with the CURRENT grip size, even after a live Small/Medium/Large edit.
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
      const sourceRoot = sourceAvatar.group; // The authored grip is a sibling of this root under CreaturePngPlaneScale in Rig Coordinates.
      const renderParent = sourceRoot.parent || sourceRoot; // Detached preview mocks still have a safe local fallback.
      if (renderParent !== sourceRoot) {
        avatar.group.position.copy(sourceRoot.position);
        avatar.group.quaternion.copy(sourceRoot.quaternion);
        avatar.group.scale.copy(sourceRoot.scale);
      } // Match the exact existing source-root transform while keeping posed art OUT of actor.model's bounds.
      renderParent.add(avatar.group); // Inherit the same creature scale and carrier motion without changing the anchor's parent or exported coordinates.
      const posedPlanes = [avatar.frontPlane, avatar.backPlane]; // Both rendered PNG faces must share the editor's viewport-facing behavior.
      posedPlaneScaleLinks.push({ plane: avatar.frontPlane, source: sourceAvatar.frontPlane },
        { plane: avatar.backPlane, source: sourceAvatar.backPlane }); // Reuse the original front/back size transforms, not an approximation.
      avatar.group.traverse?.(object => {
        if (!object?.userData?.hobunjiShoulderSplitOverlay) return;
        posedPlanes.push(object); // Grehlr's left foreground must rotate exactly with the deformed right background.
        posedPlaneScaleLinks.push({
          plane: object,
          source: object.userData.hobunjiPlaneFace === 'back' ? sourceAvatar.backPlane : sourceAvatar.frontPlane,
        }); // The split foreground follows the same size-class scaling as its corresponding background card.
      });
      if (Array.isArray(viewportCreaturePlanes)) {
        for (const plane of posedPlanes) {
          if (!plane || viewportCreaturePlanes.some(entry => entry.object === plane)) continue;
          const entry = { object: plane, baseRotationY: plane.rotation.y }; // Existing viewport deadzone rotates all visible animal cards together.
          viewportCreaturePlanes.push(entry);
          addedViewportPlanes.push(entry);
        }
      }
      posedAvatar = avatar;
      syncPlaneScale(); // The posed model is now owned, so synchronize its skinned planes with live direct-mesh scale.
      syncVisibility();
      onChange(status());
      return avatar;
    }

    function setPose(pose) {
      const nextPose = pose === 'perched' ? 'perched' : 'source'; // Invalid inputs fail back to the safe unmodified source view.
      if (nextPose === requestedPose && (posedAvatar || buildTask || buildError || nextPose === 'source')) {
        return buildTask || posedAvatar; // The animation loop must not allocate promises or rewrite the inspector DOM every frame.
      }
      if (nextPose === 'perched' && requestedPose === 'source') buildError = null; // Revisiting Perched retries a transient artwork error after Source remained usable.
      requestedPose = nextPose;
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
      return buildTask || posedAvatar;
    }

    function dispose() {
      disposed = true;
      if (Array.isArray(viewportCreaturePlanes)) {
        for (const entry of addedViewportPlanes) {
          const index = viewportCreaturePlanes.indexOf(entry); // Remove only the additional posed card references; retain preexisting original planes.
          if (index >= 0) viewportCreaturePlanes.splice(index, 1);
        }
      }
      addedViewportPlanes.length = 0;
      posedPlaneScaleLinks.length = 0;
      sourceAvatar.frontPlane && (sourceAvatar.frontPlane.visible = true);
      sourceAvatar.backPlane && (sourceAvatar.backPlane.visible = true);
      if (posedAvatar) {
        posedAvatar.group?.parent?.remove?.(posedAvatar.group);
        posedAvatar.dispose?.();
        posedAvatar = null;
      }
    }

    return { setPose, status, dispose, rest, syncPlaneScale }; // Rig Coordinates uses syncPlaneScale after live size-class edits without rebuilding art.
  }

  window.AnimationAuthorShoulderPosePreview = {
    authoredRestFor, create,
  };
})();

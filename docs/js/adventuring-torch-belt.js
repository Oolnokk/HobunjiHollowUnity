// One posterior-stowed torch sharing the held torch's marker tint, ignition cloth and fire motes.
// AdventuringTools alone owns the lit/burn clock; this module owns only its stowed visual.
(function (global) {
  'use strict';
  if (global.AdventuringTorchBelt) return;

  const SAMPLE_INTERVAL_MS = 100; // Resample the posterior rig at 10 Hz; avoid repeated profile lookup on each frame.
  let root = null; // One stowed attachment root, kept alive across drawing/stowing transitions.
  let jugArt = null; // Reuses the held jug texture and shared posterior attachment; never allocates per frame.
  let art = null; // The reusable authored PNG owned by HobunjiBeltStowTorchDisplay.
  let fire = null; // Independent HobunjiStowedTorchFire adapter for PNG loading, tinting, motes and their lifetime.
  let lastSampleAt = -Infinity; // Throttles posterior profile lookup while preserving the live character height.
  let placement = 'not ready'; // Mobile Pixel Probe reports actual positioning provenance.
  let display = null; // Shared stow display consumes the same authored idle-scale multiplier used by the held torch.
  let ownerBody = null; // Current character owner; portrait children can change without rebuilding this body.
  let portraitMount = null; // Active portrait parent; stowed gear follows the same independent portrait facing as back Burdens.
  let lastPoseKey = null; // Skip costly world-space reparenting when the authored/anatomical attachment has not changed.
  let posteriorPosition = null; // Body-local anatomical coordinate retained for mobile diagnosis after portrait reparenting.
  let desiredStowAngleDeg = -45; // Authoritative body-space tilt, independent of the portrait-relative affine transform.
  let reparentMatrix = null; // Reused 4x4 scratch transform for exact posterior-to-portrait attachment; no per-frame allocations.

  function playerBody() {
    return global.PlayerBodyTransformComposer?.getPlayerMesh?.()
      || global.ProceduralHandAttachments?.gameDeps?.playerMesh
      || global.Combat?.deps?.playerMesh || null;
  }
  function equippedPlane() {
    const deps = global.ProceduralHandAttachments?.gameDeps || global.Combat?.deps;
    const equipped=deps?.toolMeshMap?.adventuring;
    return equipped?.userData?.itemKey==='torch'||!equipped?.userData?.itemKey?equipped?.userData?.toolPlane||null:null; // A drawn jug must never resize the stowed torch.
  }
  function materialMap(material) {
    const parts = Array.isArray(material) ? material : [material];
    return parts.find(part => part?.map)?.map || null;
  }
  function ensureRoot(THREE) {
    if (root) return root;
    const factory = global.HobunjiBeltStowRig?.createTorchDisplay; // Single authored PNG/particle geometry used by gameplay and Rig Coordinates.
    const preview = factory?.(THREE, { previewFlame:false }); // Gameplay always uses the real carried-torch fire profile, never the editor's decorative flame.
    if (!preview) { placement = 'shared belt art unavailable'; return null; }
    display = preview;
    root = preview.root;
    art = preview.art;
    fire = global.HobunjiStowedTorchFire?.create?.(THREE, art, display) || null; // Fire effects are decoupled from attachment and preview ownership.
    if (!fire) { placement = 'stowed fire adapter unavailable'; display.dispose?.(); root = art = display = null; return null; }
    return root;
  }
  function belongsToBody(node, body) {
    for (let cursor = node; cursor; cursor = cursor.parent) if (cursor === body) return true;
    return false; // Never attach a torch to an avatar retained from a previous area/player rebuild.
  }
  function currentPortrait(body) {
    const avatar = global.WorldPortraitLife?.getPlayerAvatar?.()?.group;
    if (!avatar || !belongsToBody(avatar, body)) return body;
    const rigged = avatar.userData?.neckRig?.skinnedPlane; // Back-carried Burdens follow this active skinned portrait rather than a stale legacy mesh.
    if (rigged?.parent && belongsToBody(rigged, avatar)) return rigged;
    return avatar; // Rigid portraits already follow their group: no per-frame mesh traversal or stale plane cache.
  }
  function positionAtPosterior(body, timestamp, target) {
    if (timestamp - lastSampleAt < SAMPLE_INTERVAL_MS && root.parent === target) return;
    lastSampleAt = timestamp;
    const height = Number(body.userData?.portraitModelHeight) || .9; // Small rear clearance scales with the current character.
    const species = String(body.userData?.speciesId || body.userData?.species || 'mao-ao').toLowerCase();
    const gender = String(body.userData?.gender || 'male').toLowerCase();
    const rig = global.HobunjiBeltStowRig;
    const profile = rig?.characterProfile?.(global.HOBUNJI_ATTACHMENT_RIG_PROFILES, species, gender);
    const origin = profile?.anchors?.posterior?.position || {}; // Same anatomical posterior source used by carried Burdens.
    const liveY = Number(global.PlayerBodyTransformComposer?.getPosteriorY?.());
    const point = {
      x: Number(origin.x) || 0,
      y: Number.isFinite(liveY) && liveY !== 0 ? liveY : Number(origin.y) || .5 * height,
      z: (Number(origin.z) || 0) - .04 * height,
    }; // Body-local base coordinate, before portrait yaw and authoring overrides.
    const configured = rig?.configuredSnapshot?.(global.HOBUNJI_ATTACHMENT_RIG_PROFILES, species, gender);
    const pose = configured || {
      position:point, rotationDeg:{x:0,y:0,z:-45}, scale:{x:1,y:1,z:1},
    }; // A profile's explicit stow coordinates retain precedence over the natural posterior.
    const key = ['position','rotationDeg','scale'].flatMap(group =>
      ['x','y','z'].map(axis => Number(pose[group]?.[axis]) || 0)).join('|');
    posteriorPosition = point;
    desiredStowAngleDeg = pose.rotationDeg.z;
    if (root.parent === target && key === lastPoseKey) return; // No matrix bake or allocation for ordinary animation frames.
    if (root.parent !== body) body.add(root); // First express the stowed torch in the anatomical player's body space.
    root.matrixAutoUpdate = true; // A previous portrait mount may have used an exact affine matrix rather than local TRS.
    rig?.placeRoot?.(root, pose);
    placement = configured ? 'authored beltStow override' : 'anatomical posterior, behind portrait';
    portraitMount = null;
    if (target && target !== body && typeof target.matrixWorld?.copy === 'function' && global.THREE?.Matrix4
      && typeof root.updateMatrix === 'function' && typeof target.add === 'function') {
      body.updateWorldMatrix?.(true, false);
      target.updateWorldMatrix?.(true, false);
      root.updateMatrix();
      reparentMatrix ||= new global.THREE.Matrix4();
      reparentMatrix.copy(target.matrixWorld).invert().multiply(body.matrixWorld).multiply(root.matrix); // Exact affine inverse preserves nonuniform rig scale and portrait yaw without an approximate quaternion decomposition.
      target.add(root);
      root.matrix.copy(reparentMatrix);
      root.matrixAutoUpdate = false; // Keep the full relative matrix, including shear caused by scaled/rotated ancestors.
      root.matrixWorldNeedsUpdate = true;
      portraitMount = target;
    } else if (target && target !== body && typeof target.attach === 'function') {
      target.attach(root); // Standalone author/legacy adapters without matrices retain the normal parent-preserving route.
      portraitMount = target;
    }
    lastPoseKey = key;
  }
  function sync(frame = {}) {
    const torch = global.AdventuringTools;
    torch?.updateBurn?.(); // Expiry runs even while held; a belt is not required for the burn clock.
    const body = playerBody();
    if (!torch || !body || !global.THREE) {
      if (root) root.visible = false;
      fire?.retire(); // A temporarily missing avatar cannot retain old lit motes in the previous scene.
      ownerBody = null; portraitMount = null; lastPoseKey = null; lastSampleAt = -Infinity;
      return;
    }
    const THREE = global.THREE;
    if (!ensureRoot(THREE)) return;
    if (ownerBody !== body) {
      fire?.retire(); body.add(root); ownerBody = body;
      portraitMount = null; lastPoseKey = null; lastSampleAt = -Infinity;
    } // Rebuilds retire the old character's motes and force a new posterior/portrait attachment.
    const burning = torch.isLit(); // Always query the authoritative 30-second flame clock before showing a belt copy.
    const stowed = burning && !torch.isHoldingTorch();
    const jugStowed=global.AdventuringJug?.onBelt?.()===true;
    root.visible=stowed||jugStowed;
    art.visible=stowed;
    if(jugStowed&&!jugArt){
      const texture=global.CharacterHeldTools?.toolTextures?.jug;
      const image=texture?.image;
      if(image?.width&&image?.height&&global.HobunjiSpritePngSurface?.makeMaterial){
        const width=.32,height=width*image.height/image.width;
        const material=global.HobunjiSpritePngSurface.makeMaterial(THREE,texture,'stowed-jug',{side:THREE.DoubleSide,depthWrite:false});
        jugArt=new THREE.Mesh(new THREE.PlaneGeometry(width,height),material);
        jugArt.name='stowed_jug_png';jugArt.userData.noOutline=true;jugArt.raycast=()=>{};jugArt.renderOrder=2.16;
        jugArt.position.set(.22,.12,.025);jugArt.rotation.z=Math.PI/4; // Offset on the opposite belt side and cancel the default torch tilt.
        root.add(jugArt);
      }
    }
    if(jugArt)jugArt.visible=jugStowed;
    if (!root.visible) { fire?.retire(); return; }
    const timestamp = Number.isFinite(Number(frame.timestamp)) ? Number(frame.timestamp) : performance.now();
    positionAtPosterior(body, timestamp, currentPortrait(body));
    if (!stowed) { fire?.retire(); return; } // Drawing, burnout and throws remove the stowed emitters; the one burn clock continues in AdventuringTools.
    fire?.ensure();
    if (!display?.gripSourcePoint && global.HobunjiHandToolGrips?.authoredPrimaryGripForTool) {
      const handGrip = global.HobunjiHandToolGrips.authoredPrimaryGripForTool('torch', 'melee')?.position; // Same authorable primary grip used by the actual carried torch.
      display?.setGripItemPoint?.(handGrip); // Project item-local XYZ onto the source PNG once; do not derive a new grip from image bounds.
    }
    const plane = equippedPlane(); // Preserve live held-tool dimensions without borrowing its already-colored texture.
    const authoredPlaneSize = plane?.geometry?.parameters; // Real game.js PlaneGeometry dimensions already incorporate PNG aspect.
    const textureImage = materialMap(plane?.material)?.image || art?.material?.map?.image; // Fallback for unloaded/rebuilt held mesh.
    const fallbackWidth = global.HobunjiBeltStowRig?.TORCH_WIDTH || .5; // Canonical game/tool editor base width when the live plane is unavailable.
    const sourceWidth = Number(authoredPlaneSize?.width) > 0 ? Number(authoredPlaneSize.width) : fallbackWidth; // Sprite base width before Neutral size.
    const sourceHeight = Number(authoredPlaneSize?.height) > 0 ? Number(authoredPlaneSize.height)
      : Number(textureImage?.height || textureImage?.naturalHeight) > 0 && Number(textureImage?.width || textureImage?.naturalWidth) > 0
        ? sourceWidth * Number(textureImage.height || textureImage.naturalHeight) / Number(textureImage.width || textureImage.naturalWidth)
        : global.HobunjiBeltStowRig?.TORCH_HEIGHT || .5; // Preserve real PNG proportions through portrait/tool rebuilds.
    display?.setSourceDimensions?.(sourceWidth, sourceHeight); // Cached child transform; no per-frame mesh allocations.
    const idleScale = Number(global.WeaponToolStances?.poses?.torchHold?.scale ?? global.HeldActionAnimations?.torchIdle?.poses?.neutral?.scale) || 1; // Same live Neutral multiplier as the held torch, including editor overrides.
    display?.setIdleScale?.(idleScale); // Both ends remain equidistant from the actual stowed rotation midpoint.
    if (!fire?.active) return; // Original PNG or shared engine is not ready; never substitute a different flame style.
    root.updateWorldMatrix?.(true, true); // One final posterior/world-space matrix pass for the ordinary rising torch motes.
    fire?.step(timestamp, torch); // Source recolor, elapsed wick darkening and particle timing remain in the dedicated adapter.
  }

  global.AdventuringTorchBelt = Object.freeze({
    sync,
    get debug() {
      const fireDebug = fire?.debug || {}; // Read independent VFX diagnostics only when the mobile probe opens.
      return {
        visible: !!root?.visible && !!art?.visible && !!root.parent,
        jugVisible:!!root?.visible&&!!jugArt?.visible&&!!root.parent,
        attachedToPlayer: !!root && ownerBody === playerBody() && belongsToBody(root, ownerBody),
        attachedToPortrait: !!portraitMount && root?.parent === portraitMount,
        fireVisible: !!root?.visible && !!fireDebug.fireVisible,
        fireEmitters: fireDebug.fireEmitters || 0,
        fireParticles: fireDebug.fireParticles || 0,
        sharedFire: fireDebug.sharedFire || false,
        fireError: fireDebug.fireError || null,
        pivot: 'grip-emitter midpoint',
        emitterSourcePoint: display?.emitterSourcePoint || null, // Original-PNG normalized emission marker, useful for phone-only pivot diagnosis.
        gripSourcePoint: display?.gripSourcePoint || null, // Existing authored 3D torch grip projected onto original PNG coordinates.
        posteriorPosition, // Anatomical body-local anchor before the preserved-world portrait transform.
        mountedLocalPosition: root?.matrix?.elements && !root.matrixAutoUpdate ? { x:root.matrix.elements[12], y:root.matrix.elements[13], z:root.matrix.elements[14] } : root?.position ? { x:root.position.x, y:root.position.y, z:root.position.z } : null, // Exact portrait-local position even under nonuniform actor scaling.
        stowAngleDeg: desiredStowAngleDeg, // Body-space authored tilt survives the portrait-relative quaternion conversion.
        textureReady: fireDebug.textureReady || false,
        placement,
        idleScale: display?.idleScale || 1, // Mobile Pixel Probe compares belt sizing with the authored Neutral stance.
        sourceDimensions: display?.sourceDimensions || null, // Same base PNG plane dimensions as the held torch.
        visibleDimensions: art ? { width: Math.abs(art.scale.x) * (global.HobunjiBeltStowRig?.TORCH_WIDTH || .5), height: Math.abs(art.scale.y) * (global.HobunjiBeltStowRig?.TORCH_HEIGHT || 1.338) } : null, // Confirm full-sized belt art on a phone.
      };
    },
  });
  global.RuntimeFrameScheduler?.register?.('adventuring-torch-belt', sync, {
    phase: 'pre-render', owner: 'AdventuringTorchBelt',
    description: 'Posterior-stowed torch with the held torch\'s recolor, cloth darkening and shared fire motes.',
  });
})(window);

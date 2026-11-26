// Canonical shoulder-pet grip/perch world transform and rendered-root pin.
// Gameplay owns its update cadence and passes live dependencies through getters.
// This module never animates sprites or writes game state outside the pet root.
//
// Owner-generic: create() one instance per owner character with
// getOwnerMesh/getOwnerNeckJoint (the player today; any NPC or enemy that
// carries a pet can get its own instance). The older getPlayerMesh/
// getPlayerNeckJoint names are accepted as aliases, and "player" in the
// internal names and diagnostic labels below means "the owner".
// See js/character-visuals.js (shoulder-pet-perch).
(() => {
  'use strict';

  const renderPins = new WeakMap(); // Only live, authoritatively pinned pet groups can participate in the render correction.

  // Compile the authored pixel into a few weighted bind-space control points.
  // The GPU interpolates already-skinned triangle vertices; grouping their
  // barycentric contributions by bone is algebraically identical. Unlike
  // skeleton.boneMatrices, current bone.matrixWorld can be refreshed before
  // the first draw, even if a renderer/culling path skipped skeleton.update().
  function createPerchSampler(THREE) {
    const point = new THREE.Vector3(); // Scratch for one weighted bone contribution.
    let cached = null; // One fixed pixel per owner; rebuild on a mirror, rig or density change.
    function compile(mesh,u,v,pos,uv,indices,weights) {
      const geo=mesh.geometry,grid=geo.userData,rows=grid?.portraitGridRows;
      const sx=grid?.segmentsX,sy=grid?.segmentsY;
      if(!rows || rows.length!==sy+1 || !sx || !sy || geo.index || u<0 || u>1 || v<0 || v>1
        || !pos || !uv || !indices || !weights || pos.count<sx*sy*6)return null;
      let lo=0,hi=sy;
      while(hi-lo>1){const mid=(lo+hi)>>1;if(v>=rows[mid])lo=mid;else hi=mid;}
      const first=(lo*sx+Math.min(sx-1,Math.floor(u*sx)))*6;
      for(let i=first;i<first+6;i+=3) {
        const ax=uv.getX(i),ay=1-uv.getY(i),bx=uv.getX(i+1),by=1-uv.getY(i+1),cx=uv.getX(i+2),cy=1-uv.getY(i+2);
        const den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
        if(Math.abs(den)<1e-14)continue;
        const a=((by-cy)*(u-cx)+(cx-bx)*(v-cy))/den,b=((cy-ay)*(u-cx)+(ax-cx)*(v-cy))/den,c=1-a-b;
        if(Math.min(a,b,c)<-1e-5)continue;
        const byBone=new Map(); // Cold path only: aggregate each bone's weighted local coordinates.
        for(let k=0;k<3;k++){
          const j=i+k,share=k===0?a:k===1?b:c;
          for(let slot=0;slot<4;slot++){
            const weight=weights.array[j*4+slot]*share;if(!weight)continue;
            const index=indices.array[j*4+slot];
            let t=byBone.get(index);
            if(!t){t={index,x:0,y:0,z:0,w:0};byBone.set(index,t);}
            t.x+=pos.getX(j)*weight;t.y+=pos.getY(j)*weight;t.z+=pos.getZ(j)*weight;t.w+=weight;
          }
        }
        return Array.from(byBone.values()).filter(t=>Math.abs(t.w)>1e-12).map(t=>({index:t.index,x:t.x/t.w,y:t.y/t.w,z:t.z/t.w,w:t.w}));
      }
      return null;
    }
    function sample(owner,pixel,out) {
      if(!pixel || !Number.isFinite(Number(pixel.x)) || !Number.isFinite(Number(pixel.y)))return null;
      const api=window.PNGPlaneAvatar;
      let root=api?.resolveSkinnedPortraitRoot?.(owner);
      // A cached descendant can still have a parent after its entire avatar
      // hierarchy was detached. Never sample an old character after a rebuild.
      if(root && root!==owner){
        let node=root;while(node && node!==owner)node=node.parent;
        if(!node){root=null;owner.traverse?.(n=>{if(!root && n.userData?.neckRig?.available && n.userData.neckRig.skinnedPlane?.skeleton && n.userData.sourceCanvas)root=n;});}
      }
      const mesh=root?.userData?.neckRig?.skinnedPlane,geo=mesh?.geometry,skeleton=mesh?.skeleton;
      const canvas=root?.userData?.sourceCanvas,w=Number(canvas?.naturalWidth||canvas?.width),h=Number(canvas?.naturalHeight||canvas?.height);
      if(mesh && skeleton?.bones?.length && mesh.bindMatrix && w>0 && h>0 && point.applyMatrix4){
        const u=(api.getPortraitsFlipped?.()?w-Number(pixel.x):Number(pixel.x))/w,v=Number(pixel.y)/h;
        const pos=geo?.getAttribute?.('position'),uv=geo?.getAttribute?.('uv'),indices=geo?.getAttribute?.('skinIndex'),weights=geo?.getAttribute?.('skinWeight');
        if(!cached || cached.mesh!==mesh || cached.geo!==geo || cached.u!==u || cached.v!==v
          || cached.pos!==pos || cached.uv!==uv || cached.indices!==indices || cached.weights!==weights
          || cached.pv!==pos?.version || cached.uvv!==uv?.version || cached.iv!==indices?.version || cached.wv!==weights?.version){
          cached={mesh,geo,u,v,pos,uv,indices,weights,pv:pos?.version,uvv:uv?.version,iv:indices?.version,wv:weights?.version,
            terms:compile(mesh,u,v,pos,uv,indices,weights)};
        }
        if(cached.terms?.length){
          out.set(0,0,0);
          for(const t of cached.terms){
            const bone=skeleton.bones[t.index],inverse=skeleton.boneInverses?.[t.index];
            if(!bone || !inverse){out.set(0,0,0);return null;}
            bone.updateWorldMatrix(true,false); // Only contributing bones and their ancestors, never the portrait subtree.
            point.set(t.x,t.y,t.z).applyMatrix4(mesh.bindMatrix).applyMatrix4(inverse).applyMatrix4(bone.matrixWorld);
            out.x+=point.x*t.w;out.y+=point.y*t.w;out.z+=point.z*t.w;
          }
          // In attached mode the final mesh world matrix cancels bindMatrixInverse.
          // Detached skins instead retain their explicit inverse bind and mesh frame.
          if(mesh.bindMode==='detached'){mesh.updateWorldMatrix(true,false);out.applyMatrix4(mesh.bindMatrixInverse).applyMatrix4(mesh.matrixWorld);}
          return out;
        }
      }
      // Legacy/irregular portrait builders retain the shared authoritative resolver.
      // The frame API is a compatibility fallback for old standalone editor fixtures.
      if(typeof api?.resolveSkinnedPixelWorldPosition==='function')return api.resolveSkinnedPixelWorldPosition(owner,pixel,out);
      const frame=api?.resolveSkinnedPixelWorldFrame?.(owner,pixel);
      return frame?.position?out.copy(frame.position):null;
    }
    return sample;
  }

  function repinForRender(group,undo,renderDebug) {
    return renderPins.get(group)?.(undo,renderDebug) || false;
  }

  function create({ THREE, getOwnerMesh, getOwnerNeckJoint, getPlayerMesh = getOwnerMesh, getPlayerNeckJoint = getOwnerNeckJoint,
    getRotationSource, getInvertRotationSource, getCancelRotationalOffset, getOwnerPortraitMeshes } = {}) {
    if (!THREE?.Quaternion || !THREE?.Vector3 || typeof getPlayerMesh !== 'function'
      || typeof getPlayerNeckJoint !== 'function' || typeof getRotationSource !== 'function'
      || typeof getInvertRotationSource !== 'function' || typeof getCancelRotationalOffset !== 'function') {
      throw new TypeError('ShoulderPetAttachmentRuntime requires THREE and live owner (getOwnerMesh/getOwnerNeckJoint) and configuration getters.');
    }

    const samplePerch = createPerchSampler(THREE); // Same point sampler for simulation and the final composed draw.
    const sampledPerch = new THREE.Vector3(), renderPerch = new THREE.Vector3(), localTarget = new THREE.Vector3(), gripOffset = new THREE.Vector3();
    const renderGrip = new THREE.Vector3(); // Actual world-space grip readback for the mobile diagnostic.
    const rotationLimits = window.ShoulderPetRotationLimits?.create?.(THREE); // One prepared deformation-envelope solver per owner.
    const SHOULDER_PET_MAX_BODY_PITCH_DEG = 30; // Corrective whole-body tilt around the card normal; not curiosity animation.
    const SHOULDER_PET_BODY_NECK_BLEND = 0.5; // Equal quaternion midpoint between the player body and neck follow frames.
    const worldUp = new THREE.Vector3(0, 1, 0); // Axis for the upright pet's heading and observation turn.
    const constraintOwnerFrame=new THREE.Quaternion(); // Reused owner-heading scratch for legacy owner-relative limits.
    function worldQuaternionWithoutReflection(node, out = new THREE.Quaternion()) {
      if (node?.isObject3D && node.quaternion) {
        const rigResolver = window.ProceduralLegAnimation?.worldQuaternionWithoutScale; // Reuse the leg solver's canonical scale-free world orientation when present.
        if (typeof rigResolver === 'function') return rigResolver(node, out);
        out.identity();
        const chain = []; // Editor/standalone fallback when the procedural-leg module is not loaded.
        for (let parent = node; parent?.isObject3D; parent = parent.parent) chain.push(parent);
        for (let i = chain.length - 1; i >= 0; i--) out.multiply(chain[i].quaternion);
        return out.normalize();
      }
      return node?.getWorldQuaternion?.(out) || out; // Test doubles and older preview rigs have no local quaternion hierarchy.
    }
    const SHOULDER_PET_HALF_TURN_QUATERNION = new THREE.Quaternion().setFromAxisAngle(worldUp, Math.PI); // Swaps the two facing poses without mirroring the sprite.
    const neutralGripYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(61)); // Stock shoulder yaw gives neutral grip rigs a readable side silhouette.
    const petHeading = new THREE.Vector3(); // The animal's nose points along local +Z; the two cards face along ±X.
    const ownerLateral = new THREE.Vector3(); // World-space lateral ray including the owner's actual reflection.
    const perchInOwnerSpace = new THREE.Vector3(); // Reads the live perch side after the source pixel follows the portrait flip.
    const ownerOrigin = new THREE.Vector3(); // Subtracted from the lateral point to obtain a direction.
    function keepHeadingUpright(rotation) {
      petHeading.set(0, 0, 1).applyQuaternion(rotation);
      if (Math.hypot(petHeading.x, petHeading.z) > 1e-6) {
        return rotation.setFromAxisAngle(worldUp, Math.atan2(petHeading.x, petHeading.z));
      }
      // When forward points straight up or down, use the horizontal right axis.
      petHeading.set(1, 0, 0).applyQuaternion(rotation);
      return rotation.setFromAxisAngle(worldUp, Math.atan2(-petHeading.z, petHeading.x));
    }

    function shoulderLateralHeading(owner, rotation) {
      owner.localToWorld(ownerLateral.set(1, 0, 0));
      owner.localToWorld(ownerOrigin.set(0, 0, 0));
      ownerLateral.sub(ownerOrigin);
      petHeading.set(0, 0, 1).applyQuaternion(rotation);
      return (petHeading.x * ownerLateral.x + petHeading.z * ownerLateral.z)
        / (Math.hypot(ownerLateral.x, ownerLateral.z) || 1);
    }

    function _shoulderPetSurfaceTransform(perch, grip, pet) {
      const playerMesh = getPlayerMesh(); // Live owner mesh, never a stale captured avatar.
      const playerNeckJoint = getPlayerNeckJoint(); // Live skinned neck after portrait rebuilds.
      const s_shoulderPetRotationSource = getRotationSource(); // Current configured owner rotation frame.
      const s_invertShoulderPetRotationSource = getInvertRotationSource(); // Runtime-only legacy compatibility switch.
      const s_cancelShoulderPetRotationalOffset = getCancelRotationalOffset(); // Runtime-only authored-offset override.
      if (!playerMesh) throw new Error('Shoulder pet cannot resolve a missing player mesh.');
      const rotationQuaternion = rotationDeg => { // Converts authored YXZ pitch/yaw/roll for the perch and grip composition below.
        const degrees = rotationDeg || {};
        return new THREE.Quaternion().setFromEuler(new THREE.Euler(
          THREE.MathUtils.degToRad(Number(degrees.x) || 0),
          THREE.MathUtils.degToRad(Number(degrees.y) || 0),
          THREE.MathUtils.degToRad(Number(degrees.z) || 0),
          'YXZ',
        ));
      };
      playerMesh.updateWorldMatrix?.(true, false);
      // The fixed gameplay head-follow mode needs only the center pixel, not
      // five samples and a tangent frame. A degenerate tangent must not discard a valid center.
      const needsSurfaceFrame = s_shoulderPetRotationSource!=='head' && s_shoulderPetRotationSource!=='body' && s_shoulderPetRotationSource!=='bodyNeckMidpoint' && s_shoulderPetRotationSource!=='world';
      const perchFrame = needsSurfaceFrame ? window.PNGPlaneAvatar?.resolveSkinnedPixelWorldFrame?.(playerMesh, perch.sourcePixel) : null;
      const livePerch = perchFrame?.position || samplePerch(playerMesh,perch.sourcePixel,sampledPerch);
      const perchWorldPosition = livePerch
        || playerMesh.localToWorld(new THREE.Vector3(perch.x || 0, perch.y || 0, perch.z || 0));
      const renderedPerchX = livePerch ? playerMesh.worldToLocal(perchInOwnerSpace.copy(perchWorldPosition)).x : perch.x; // Use the side the pet is actually perched on after portrait UV mirroring.
      const facingTowardPlayerCenter = pet?.__hobunjiShoulderFacingInward === true; // Desired heading for this held observation pose.
      let selectedRotationQuaternion = null; // Receives the world-space frame chosen by the Settings dropdown below.
      let resolvedRotationSource = s_shoulderPetRotationSource;
      switch (s_shoulderPetRotationSource) {
        case 'body':
          selectedRotationQuaternion = worldQuaternionWithoutReflection(playerMesh);
          resolvedRotationSource = 'player-body';
          break;
        case 'bodyNeckMidpoint': {
          const bodyRotationQuaternion = worldQuaternionWithoutReflection(playerMesh).normalize(); // Body endpoint ignores mirrored model scale.
          const neckRotationSource = playerNeckJoint?.isObject3D ? playerNeckJoint : null; // Neck endpoint; rigid avatars safely fall back to the body frame.
          if (!neckRotationSource) {
            selectedRotationQuaternion = bodyRotationQuaternion;
            resolvedRotationSource = 'player-body-fallback-no-neck';
            break;
          }
          neckRotationSource.updateWorldMatrix?.(true, false);
          const neckRotationQuaternion = worldQuaternionWithoutReflection(neckRotationSource).normalize(); // Physical neck orientation is not a matrix reflection.
          selectedRotationQuaternion = bodyRotationQuaternion.clone().slerp(neckRotationQuaternion, SHOULDER_PET_BODY_NECK_BLEND).normalize();
          resolvedRotationSource = 'player-body-neck-midpoint';
          break;
        }
        case 'head': {
          const headRotationSource = playerNeckJoint?.isObject3D ? playerNeckJoint : playerMesh; // Head/neck selection falls back safely for rigid avatars.
          headRotationSource.updateWorldMatrix?.(true, false);
          selectedRotationQuaternion = worldQuaternionWithoutReflection(headRotationSource);
          resolvedRotationSource = headRotationSource === playerNeckJoint ? 'player-head-neck' : 'player-body-fallback-no-neck';
          break;
        }
        case 'world':
          selectedRotationQuaternion = new THREE.Quaternion();
          resolvedRotationSource = 'world-aligned';
          break;
        case 'pixel':
        default:
          selectedRotationQuaternion = perchFrame?.quaternion?.clone()
            || worldQuaternionWithoutReflection(playerMesh);
          resolvedRotationSource = perchFrame ? 'player-authored-skinned-surface' : 'player-body-fallback-no-skinned-frame';
          break;
      }
      if (s_invertShoulderPetRotationSource) selectedRotationQuaternion.invert();
      const perchQuaternion = rotationQuaternion(perch.rotationDeg); // Authored shoulderPerch rotational correction.
      const inverseGripQuaternion = rotationQuaternion(grip.rotationDeg).invert(); // Authored inverse shoulderGrip rotational correction.
      const authoredRotationOffset = keepHeadingUpright(perchQuaternion.multiply(inverseGripQuaternion)); // Keep the authored facing correction on the horizontal plane.
      const worldQuaternion = keepHeadingUpright(selectedRotationQuaternion.clone()); // Carrier pitch and roll still move the perch, but never tilt the pet's body.
      let authoredFacesInward = false; // Identifies which of the two authored half-turns points toward the carrier's midline.
      if (!s_cancelShoulderPetRotationalOffset) {
        worldQuaternion.multiply(authoredRotationOffset);
        if (renderedPerchX) {
          const authoredLateralHeading = petHeading.set(0, 0, 1).applyQuaternion(authoredRotationOffset).x; // Only neutral rigs need an added yaw; head animation alone cannot enable it.
          if (Math.abs(authoredLateralHeading) < 0.05) worldQuaternion.multiply(neutralGripYaw);
          authoredFacesInward = shoulderLateralHeading(playerMesh, worldQuaternion) * renderedPerchX < 0;
        }
      }
      const shoulderFacingTurnDeg = facingTowardPlayerCenter !== authoredFacesInward ? 180 : 0;
      if (shoulderFacingTurnDeg) worldQuaternion.multiply(SHOULDER_PET_HALF_TURN_QUATERNION);
      // Curiosity pitch/yaw is animated by the animal's head bones, not this shared root.
      // Keep the entire body and its off-center grip still between the two authored 180° observation poses.
      const shoulderLeanDeg = 0; // Curiosity remains head-only; geometry-driven pitch is recorded separately.
      const perchScaleX = Number(perch.scale?.x) > 0 ? Number(perch.scale.x) : 1; // Explicit authored grip multiplier; the runtime never recalculates it from body dimensions.
      const perchScaleY = Number(perch.scale?.y) > 0 ? Number(perch.scale.y) : 1; // Matches the pet's rendered Y scale when solving its foot grip.
      const perchScaleZ = Number(perch.scale?.z) > 0 ? Number(perch.scale.z) : 1; // Matches the pet's rendered depth scale.
      const rawGrip = grip.localPosition; // Native unscaled socket coordinates; the grip resolver retains them alongside its legacy scaled fields.
      const renderedScale = pet?.avatarRef?.group?.scale; // Actual THREE root scale, including the swapped width/depth axes and the current breath/squash multiplier.
      const useRenderedGrip = !!(rawGrip && renderedScale
        && Number.isFinite(renderedScale.x) && Number.isFinite(renderedScale.y) && Number.isFinite(renderedScale.z)); // Only fall back for old callers without a real avatar root.
      let geometryConstraint = null; // Live bone envelopes constrain the requested angles before composing the grip.
      if (rotationLimits && useRenderedGrip && typeof getOwnerPortraitMeshes === 'function') {
        const ownerFrame=keepHeadingUpright(worldQuaternionWithoutReflection(playerMesh,constraintOwnerFrame));
        geometryConstraint = rotationLimits?.constrain({
          ownerMeshes: getOwnerPortraitMeshes(), pet, perch: perchWorldPosition, grip: rawGrip,
          scale: renderedScale, quaternion: worldQuaternion,
          ownerFrameYaw: 2*Math.atan2(ownerFrame.y,ownerFrame.w), perchSide: renderedPerchX,
          maxBodyPitchDeg: SHOULDER_PET_MAX_BODY_PITCH_DEG,
        });
      }
      const gripWorldOffset = new THREE.Vector3(
        useRenderedGrip ? rawGrip.x * renderedScale.x : (grip.x || 0) * perchScaleX,
        useRenderedGrip ? rawGrip.y * renderedScale.y : (grip.y || 0) * perchScaleY,
        useRenderedGrip ? rawGrip.z * renderedScale.z : (grip.z || 0) * perchScaleZ,
      ).applyQuaternion(worldQuaternion); // Rotate the real scaled grip, not an approximate socket with axis-swapped or stale breathing scale.
      return {
        worldPosition: perchWorldPosition.clone().sub(gripWorldOffset),
        worldQuaternion,
        perchWorldPosition: perchWorldPosition.clone(),
        gripWorldOffset: gripWorldOffset.clone(),
        gripLocalPosition: useRenderedGrip ? rawGrip : null, // Final transform uses this to measure the real world grip from the pet's updated THREE matrix.
        gripSource: grip.source || 'authored-shoulder-grip', // Reports whether the foot socket is authored or derived from a flying sprite.
        rotationFrameWorldQuaternion: selectedRotationQuaternion,
        perchPositionSource: livePerch ? 'player-authored-skinned-pixel' : 'player-body-local-fallback',
        perchSourcePixel: perch.sourcePixel || null, // Used for one render-boundary correction against the final composed pose.
        perchLocalPosition: perch, // Rigid avatar fallback uses the same authored local socket.
        rotationSource: resolvedRotationSource,
        requestedRotationSource: s_shoulderPetRotationSource,
        rotationSourceInverted: s_invertShoulderPetRotationSource,
        rotationalOffsetCancelled: s_cancelShoulderPetRotationalOffset,
        facingTowardPlayerCenter,
        shoulderFacingTurnDeg,
        shoulderLeanDeg, // Curiosity never tilts the root; corrective pitch uses the resolved quaternion above.
        geometryConstraint, // Requested/applied angles and bounded candidate checks for Pixel Probe.
      };
    }

    function _applyShoulderPetFinalTransform(c, finalTransform) {
      const group = c.avatarRef?.group;
      if (!group || !finalTransform?.worldPosition || !finalTransform?.worldQuaternion) return;
      const fallbackPlayerMesh = finalTransform.faceRotationSource === 'player-body-fallback-no-authored-anchors'
        ? getPlayerMesh() : null; // The legacy no-perch/no-grip path still arrives with a possibly reflected getWorldQuaternion from game.js.
      const worldQuaternion = fallbackPlayerMesh
        ? keepHeadingUpright(fallbackPlayerMesh.isObject3D
          ? worldQuaternionWithoutReflection(fallbackPlayerMesh) : finalTransform.worldQuaternion.clone())
        : finalTransform.worldQuaternion; // The legacy path also follows the owner's horizontal heading.
      const parent = group.parent; // Used to convert the resolved world attachment transform back into the pet root's actual local space.
      parent?.updateWorldMatrix?.(true, false);
      const parentWorldQuaternion = parent ? worldQuaternionWithoutReflection(parent)
        : new THREE.Quaternion(); // Parent rotations ignore mirrored matrix decomposition when solving the pet's local attachment.
      const localQuaternion = parentWorldQuaternion.invert().multiply(worldQuaternion.clone()); // Local root rotation that renders as the selected world-space attachment frame.
      const localPosition = parent?.worldToLocal
        ? parent.worldToLocal(finalTransform.worldPosition.clone())
        : finalTransform.worldPosition.clone(); // Local root position whose conceptual shoulderGrip coincides with shoulderPerch.
      group.position.copy(localPosition);
      group.quaternion.copy(localQuaternion);
      // Solve in the actual parent space, including nonuniform/reflected parent
      // scale. World-space quaternion subtraction alone does not account for it.
      if(group.isObject3D && group.scale && finalTransform.gripLocalPosition && finalTransform.perchWorldPosition){
        localTarget.copy(finalTransform.perchWorldPosition);
        if(parent?.worldToLocal)parent.worldToLocal(localTarget);
        gripOffset.copy(finalTransform.gripLocalPosition).multiply(group.scale).applyQuaternion(group.quaternion);
        group.position.copy(localTarget.sub(gripOffset));
      }
      // The selected root transform is now authoritative for both placement
      // and rendering. Restore normal matrix inheritance and only retain the
      // canonical mirrored face rotations; png-plane-avatar's render hook
      // recognizes the marker below and no longer replaces this orientation.
      const setCanonicalPlaneRotation = (plane, y) => {
        if (!plane) return;
        plane.matrixAutoUpdate = true;
        plane.rotation.set(0, y, 0);
        plane.updateMatrix();
        plane.matrixWorldNeedsUpdate = true;
      };
      setCanonicalPlaneRotation(c.avatarRef.frontPlane, Math.PI / 2);
      setCanonicalPlaneRotation(c.avatarRef.backPlane, -Math.PI / 2);
      group.updateWorldMatrix?.(false, false); // The grip readback needs this pose even before the first render updates matrices.
      const alignedGripWorldPosition = finalTransform.gripLocalPosition
        ? group.localToWorld(new THREE.Vector3( // Read the actual rendered root matrix, not merely undoing the same offset calculation.
            finalTransform.gripLocalPosition.x, finalTransform.gripLocalPosition.y, finalTransform.gripLocalPosition.z))
        : finalTransform.worldPosition.clone().add(finalTransform.gripWorldOffset || new THREE.Vector3()); // Legacy no-anchor or mock callers have only the expected offset.
      const gripPerchError = finalTransform.perchWorldPosition
        ? alignedGripWorldPosition.distanceTo(finalTransform.perchWorldPosition)
        : null; // Pixel Probe now measures real world transform drift, including genotype scaling and breathing.
      group.userData.hobunjiShoulderPetAttachment = { // Mobile-visible Pixel Probe diagnostics for this final authoritative pin.
        recentChange: fallbackPlayerMesh ? 'Legacy shoulder pet uses the upright owner heading.' : 'Live bone envelopes constrain body yaw, in-plane body pitch and head yaw before pinning the authored grip.',
        rotationSource: finalTransform.rotationSource || finalTransform.faceRotationSource,
        positionSource: finalTransform.perchPositionSource,
        expectedWorldPosition: finalTransform.worldPosition.toArray(),
        authoredPerchWorldPosition: finalTransform.perchWorldPosition?.toArray?.() || null,
        alignedGripWorldPosition: alignedGripWorldPosition.toArray(),
        gripPerchError,
        gripPositionSource: finalTransform.gripLocalPosition ? 'rendered-group-matrix' : 'estimated-offset-fallback', // Mobile debug distinguishes measured vs algebraic grip placement.
        gripSource: finalTransform.gripSource || 'unavailable', // Mobile Pixel Probe shows which grip solved the final world attachment.
        authoritativeRootTransform: true,
        requestedRotationSource: finalTransform.requestedRotationSource,
        rotationSourceInverted: finalTransform.rotationSourceInverted,
        rotationalOffsetCancelled: finalTransform.rotationalOffsetCancelled,
        rotationFrameWorldQuaternion: finalTransform.rotationFrameWorldQuaternion?.toArray?.() || null,
        finalWorldQuaternion: worldQuaternion.toArray(), // Report the *actual applied* world orientation, including the legacy fallback repair.
        facingTowardPlayerCenter: finalTransform.facingTowardPlayerCenter === true,
        shoulderFacingTurnDeg: Number(finalTransform.shoulderFacingTurnDeg) || 0,
        shoulderLeanDeg: Number(finalTransform.shoulderLeanDeg) || 0, // Legacy curiosity lean remains zero.
        spriteMirrored: false,
        correctiveBodyPitchDeg: Number(finalTransform.geometryConstraint?.bodyPitchDeg) || 0, // Physical local-X body tilt around the grip.
        geometryConstraint: finalTransform.geometryConstraint || null, // Reports unavailable/no-safe-pose explicitly.
      };
      let canonicalPlaneRestored = group.userData.hobunjiShoulderSpriteCanonicalized === true;
      if (!canonicalPlaneRestored && finalTransform.perchWorldPosition) {
        canonicalPlaneRestored = window.ShoulderPetObservationFlip?.applyAtPinnedPerch?.(c, finalTransform.perchWorldPosition) === true;
        if (canonicalPlaneRestored) group.userData.hobunjiShoulderSpriteCanonicalized = true; // One-time hot-reload cleanup; no per-frame avatar traversal now that shoulder sprites never mirror.
      }
      group.userData.hobunjiShoulderPetAttachment.canonicalPlaneRestored = canonicalPlaneRestored;
      // The composer applies additional body and neck motion after simulation.
      // Correct translation ONLY after those changes; never rerun rotation
      // constraints or the animal's animation in a rendering hook.
      if(group.isObject3D && finalTransform.gripLocalPosition && finalTransform.perchLocalPosition){
        let pin=renderPins.get(group);
        if(!pin || pin.owner!==getPlayerMesh()){
          const owner=getPlayerMesh();
          const record={owner,grip:new THREE.Vector3(),pixel:null,local:new THREE.Vector3()};
          pin=(undo,renderDebug)=>{
            if(group.visible===false || !group.parent || record.owner!==getPlayerMesh())return false;
            const target=samplePerch(record.owner,record.pixel,renderPerch);
            if(!target){
              if(!record.owner?.localToWorld)return false;
              record.owner.updateWorldMatrix?.(true,false);
              record.owner.localToWorld(renderPerch.copy(record.local));
            }
            // The rendered group already includes the composer's pose. Keep
            // its exact yaw/scale and solve the grip in its current parent space.
            group.localToWorld(renderGrip.copy(record.grip));
            const before=renderGrip.distanceTo(renderPerch);
            localTarget.copy(renderPerch);group.parent.worldToLocal(localTarget);
            gripOffset.copy(record.grip).multiply(group.scale).applyQuaternion(group.quaternion);
            localTarget.sub(gripOffset);
            const changed=group.position.distanceTo(localTarget)>1e-9;
            if(changed){
              const {x,y,z}=group.position; // Each transaction owns its own rollback, including nested diagnostic renders.
              undo.push(()=>{group.position.set(x,y,z);group.updateMatrix?.();});
              group.position.copy(localTarget);group.updateMatrix?.();
              group.localToWorld(renderGrip.copy(record.grip));
            }
            const debug=group.userData.hobunjiShoulderPetAttachment;
            if(debug){
              debug.renderPin={source:target?'live-skinned-pixel':'local-fallback',beforeError:before,afterError:renderGrip.distanceTo(renderPerch),
                perch:renderPerch.toArray(),grip:renderGrip.toArray(),corrected:changed};
              if(renderDebug)renderDebug.shoulderPerchPin=debug.renderPin;
            }
            return true;
          };
          pin.owner=owner;pin.record=record;renderPins.set(group,pin);
        }
        pin.record.grip.copy(finalTransform.gripLocalPosition);
        pin.record.pixel=finalTransform.perchSourcePixel;
        const p=finalTransform.perchLocalPosition;
        pin.record.local.set(p.x||0,p.y||0,p.z||0);
      }else renderPins.delete(group);
    }

    return Object.freeze({
      solveSurfaceTransform: _shoulderPetSurfaceTransform,
      applyFinalTransform: _applyShoulderPetFinalTransform,
    }); // game.js calls these once per final shoulder-pet pin, not from a second render loop.
  }

  window.ShoulderPetAttachmentRuntime = Object.freeze({ create, repinForRender, createPerchSampler }); // Existing classic-script loader registers this before game.js.
})();

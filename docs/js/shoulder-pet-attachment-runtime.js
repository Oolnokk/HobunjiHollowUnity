// Canonical shoulder-pet grip/perch world transform and rendered-root pin.
// Gameplay owns its update cadence and passes live dependencies through getters.
// This module owns the pet root and the final direction of passive head yaw.
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
    const sampleHeadCenter = createPerchSampler(THREE); // Independent cached source landmark for the owner's actual painted head.
    const sampledPerch = new THREE.Vector3(), renderPerch = new THREE.Vector3(), localTarget = new THREE.Vector3(), gripOffset = new THREE.Vector3();
    const renderGrip = new THREE.Vector3(); // Actual world-space grip readback for the mobile diagnostic.
    const rotationLimits = window.ShoulderPetRotationLimits?.create?.(THREE); // One prepared deformation-envelope solver per owner.
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
    const headRotation = new THREE.Quaternion(), leanRotation = new THREE.Quaternion(); // Head pose and corrective rotation, reused in both pins.
    const renderedHeading = new THREE.Quaternion(), renderedLocalRotation = new THREE.Quaternion(); // Final render-only orientation and local conversion.
    const inversePriorLean = new THREE.Quaternion(); // Removes simulation lean before resolving the final render pose.
    const headUp = new THREE.Vector3(), headForward = new THREE.Vector3(), headOrigin = new THREE.Vector3(); // Live head basis and pivot.
    const cardNormal = new THREE.Vector3(), petCenter = new THREE.Vector3(), broadSideAxis = new THREE.Vector3(0,0,1); // Animal YZ card tilts about its long Z axis.
    let lastHeadPitch = 0, lastPetSide = 0; // Numeric diagnostics for the side gate and actual head motion.
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

    // The animal's flat side is its YZ plane. Local X is its normal:
    // rotating about local Z (not X) tips the broad side forward/backward.
    // Follow the head only on the side toward which its top actually moves.
    // Use the current head frame, not camera facing, observation direction,
    // or the neck's raw Euler sign (which changes under reflected parents).
    function resolveHeadSideLean(heading, perch, grip, scale) {
      lastHeadPitch=lastPetSide=0;
      const neck=getPlayerNeckJoint();
      if(!neck?.isObject3D || typeof neck.getWorldPosition!=='function' || !grip || !scale)return 0;
      neck.updateWorldMatrix?.(true,false);
      const rotation=worldQuaternionWithoutReflection(neck,headRotation);
      headUp.set(0,1,0).applyQuaternion(rotation);
      headForward.set(0,0,1).applyQuaternion(rotation);
      const length=Math.hypot(headForward.x,headForward.z);
      if(length<1e-6 || headUp.y<=1e-6)return 0; // No ambiguous upside-down or vertical head frame.
      headForward.set(headForward.x/length,0,headForward.z/length);
      const forwardLean=headUp.x*headForward.x+headUp.z*headForward.z;
      const pitch=Math.atan2(forwardLean,headUp.y);
      lastHeadPitch=pitch;
      neck.getWorldPosition(headOrigin);
      // The perch itself lies on the owner portrait, so its depth does not
      // identify the occupied side. Use the actual off-center animal root
      // implied by the grip, its live scale and the solved body heading.
      petCenter.set(-grip.x*scale.x,-grip.y*scale.y,-grip.z*scale.z).applyQuaternion(heading).add(perch).sub(headOrigin);
      const side=petCenter.x*headForward.x+petCenter.z*headForward.z;
      lastPetSide=side;
      if(side*forwardLean<=0 || Math.abs(side)<1e-5 || Math.abs(pitch)<1e-6)return 0;
      // Project the head pitch onto the animal card's broad-side normal.
      // Rz rotates its up vector toward -local X. Reversing the animal's
      // observation yaw reverses the local sign, not the world lean.
      cardNormal.set(1,0,0).applyQuaternion(heading);
      const normalProjection=cardNormal.x*headForward.x+cardNormal.z*headForward.z;
      return -Math.atan2(forwardLean*normalProjection,headUp.y);
    }

    function applyHeadSideLean(heading,perch,grip,scale) {
      const lean=resolveHeadSideLean(heading,perch,grip,scale);
      if(Math.abs(lean)>1e-6)heading.multiply(leanRotation.setFromAxisAngle(broadSideAxis,lean));
      return lean;
    }

    const awayCenter=new THREE.Vector3(),awayDelta=new THREE.Vector3(); // World head center and hypothetical pet origin relative to it.
    const awayBasis=new THREE.Quaternion(),awayRight=new THREE.Vector3(),awayForward=new THREE.Vector3(); // Local yaw axes at each resolved body heading.
    let awayPerch=null,awayGrip=null,awayScale=null,awayReady=false; // Per-solve inputs; cleared after choosing a pose.
    function prepareAway(owner,perch,grip,scale) {
      awayReady=false;
      if(!owner || !perch || !grip || !scale)return;
      const root=window.PNGPlaneAvatar?.resolveSkinnedPortraitRoot?.(owner);
      const pixel=root?.userData?.neckRig?.headCentroidPx;
      if(!pixel || !sampleHeadCenter(owner,pixel,awayCenter)){
        const neck=getPlayerNeckJoint();
        if(typeof neck?.getWorldPosition!=='function')return;
        neck.updateWorldMatrix?.(true,false);neck.getWorldPosition(awayCenter);
      }
      awayPerch=perch;awayGrip=grip;awayScale=scale;awayReady=true;
    }

    function awayLimit(heading) {
      if(!awayReady)return 0;
      // Positive animal head yaw turns +Z toward +X. Use the actual world
      // pet center (including its off-center grip) and the live head center.
      // No fixed sign, portrait-flip flag, or inward/outward pose assumption.
      awayDelta.set(-awayGrip.x*awayScale.x,-awayGrip.y*awayScale.y,-awayGrip.z*awayScale.z)
        .applyQuaternion(heading).add(awayPerch).sub(awayCenter);
      awayRight.set(1,0,0).applyQuaternion(heading);
      awayForward.set(0,0,1).applyQuaternion(heading);
      const rightLength=Math.hypot(awayRight.x,awayRight.z),forwardLength=Math.hypot(awayForward.x,awayForward.z);
      if(rightLength<1e-6 || forwardLength<1e-6)return 0;
      const side=(awayDelta.x*awayRight.x+awayDelta.z*awayRight.z)/rightLength;
      const forward=(awayDelta.x*awayForward.x+awayDelta.z*awayForward.z)/forwardLength;
      if(Math.abs(side)<1e-5)return 0; // No unique outward side; neutral is safe.
      return Math.atan2(side,forward)*180/Math.PI;
    }
    function awayLimitAtYaw(yaw) {return awayLimit(awayBasis.setFromAxisAngle(worldUp,yaw));}
    function signedAwayYaw(magnitude,limit) {return Math.sign(limit)*Math.min(Math.abs(magnitude),Math.abs(limit));}
    function clampAwayYaw(yaw,limit) {return yaw*limit>0?signedAwayYaw(yaw,limit):0;}
    function setPassiveYaw(avatar,yaw) {
      if(typeof avatar?.updateHeadYaw!=='function')return;
      const rig=avatar.headRig;
      if(!rig || Math.abs((Number(rig.currentYawDeg)||0)-yaw)>1e-6)avatar.updateHeadYaw(yaw,1000);
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
      const worldQuaternion = keepHeadingUpright(selectedRotationQuaternion.clone()); // Start with neutral heading; head-side lean is added after yaw constraints.
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
      const shoulderLeanDeg = 0; // Curiosity remains head-only; owner-head lean is separate.
      const perchScaleX = Number(perch.scale?.x) > 0 ? Number(perch.scale.x) : 1; // Explicit authored grip multiplier; the runtime never recalculates it from body dimensions.
      const perchScaleY = Number(perch.scale?.y) > 0 ? Number(perch.scale.y) : 1; // Matches the pet's rendered Y scale when solving its foot grip.
      const perchScaleZ = Number(perch.scale?.z) > 0 ? Number(perch.scale.z) : 1; // Matches the pet's rendered depth scale.
      const rawGrip = grip.localPosition; // Native unscaled socket coordinates; the grip resolver retains them alongside its legacy scaled fields.
      const renderedScale = pet?.avatarRef?.group?.scale; // Actual THREE root scale, including the swapped width/depth axes and the current breath/squash multiplier.
      const useRenderedGrip = !!(rawGrip && renderedScale
        && Number.isFinite(renderedScale.x) && Number.isFinite(renderedScale.y) && Number.isFinite(renderedScale.z)); // Only fall back for old callers without a real avatar root.
      const passive=pet?.shoulderCuriosity; // The game advances unsigned curiosity magnitude; this pin alone chooses its sign.
      let passiveLimit=0,passiveRequested=0;
      if(passive && useRenderedGrip){
        prepareAway(playerMesh,perchWorldPosition,rawGrip,renderedScale);
        passiveLimit=awayLimit(worldQuaternion);
        passiveRequested=signedAwayYaw(Number(passive.currentYawDeg)||0,passiveLimit);
        setPassiveYaw(pet.avatarRef,passiveRequested);
      }
      let geometryConstraint = null; // Live bone envelopes constrain the requested angles before composing the grip.
      if (rotationLimits && useRenderedGrip && typeof getOwnerPortraitMeshes === 'function') {
        const ownerFrame=keepHeadingUpright(worldQuaternionWithoutReflection(playerMesh,constraintOwnerFrame));
        geometryConstraint = rotationLimits?.constrain({
          ownerMeshes: getOwnerPortraitMeshes(), pet, perch: perchWorldPosition, grip: rawGrip,
          scale: renderedScale, quaternion: worldQuaternion,
          ownerFrameYaw: 2*Math.atan2(ownerFrame.y,ownerFrame.w), perchSide: renderedPerchX,
          passiveAwayLimit: passive && useRenderedGrip ? awayLimitAtYaw : null, // Candidate headings may reverse the allowed side.
        });
      }
      lastHeadPitch=lastPetSide=0;
      const headSideLean = useRenderedGrip ? applyHeadSideLean(worldQuaternion,perchWorldPosition,rawGrip,renderedScale) : 0; // One-sided broad-face lean, independent of the yaw collision solver.
      if(passive && useRenderedGrip){
        passiveLimit=awayLimit(worldQuaternion); // Includes the final collision-corrected heading and broad-face tilt.
        const applied=Number(pet.avatarRef?.headRig?.currentYawDeg)||0;
        setPassiveYaw(pet.avatarRef,clampAwayYaw(applied,passiveLimit));
      }
      awayReady=false;awayPerch=awayGrip=awayScale=null;
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
        shoulderLeanDeg, // Curiosity never tilts the root.
        passiveYaw: passive ? {requested:passiveRequested,limit:passiveLimit,applied:Number(pet.avatarRef?.headRig?.currentYawDeg)||0} : null,
        headSideLean, headPitch: lastHeadPitch, petHeadSide: lastPetSide, // Render hook refreshes these from the final composed head.
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
      if(c.shoulderCuriosity && !finalTransform.gripLocalPosition)setPassiveYaw(c.avatarRef,0); // Unanchored legacy pets cannot prove an outward direction.
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
        recentChange: fallbackPlayerMesh ? 'Legacy shoulder pet uses the upright owner heading.' : 'Head-side broad-face tilt follows the owner head, with the authored grip pinned.',
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
        passiveYaw: finalTransform.passiveYaw || null, // Reports requested, permitted and applied local head yaw.
        headSideLeanDeg: (Number(finalTransform.headSideLean)||0)*180/Math.PI, // Signed local-Z tilt of the broad face.
        ownerHeadPitchDeg: (Number(finalTransform.headPitch)||0)*180/Math.PI,
        petHeadSide: Number(finalTransform.petHeadSide)||0,
        geometryConstraint: finalTransform.geometryConstraint || null, // Reports unavailable/no-safe-pose explicitly.
      };
      let canonicalPlaneRestored = group.userData.hobunjiShoulderSpriteCanonicalized === true;
      if (!canonicalPlaneRestored && finalTransform.perchWorldPosition) {
        canonicalPlaneRestored = window.ShoulderPetObservationFlip?.applyAtPinnedPerch?.(c, finalTransform.perchWorldPosition) === true;
        if (canonicalPlaneRestored) group.userData.hobunjiShoulderSpriteCanonicalized = true; // One-time hot-reload cleanup; no per-frame avatar traversal now that shoulder sprites never mirror.
      }
      group.userData.hobunjiShoulderPetAttachment.canonicalPlaneRestored = canonicalPlaneRestored;
      // The composer applies additional body and neck motion after simulation.
      // Refresh the cheap directional head lean and translation after those
      // changes; never rerun the geometry solver or animal animation here.
      if(group.isObject3D && finalTransform.gripLocalPosition && finalTransform.perchLocalPosition){
        let pin=renderPins.get(group);
        if(!pin || pin.owner!==getPlayerMesh() || pin.sampler!==samplePerch){
          const owner=getPlayerMesh();
          const record={owner,grip:new THREE.Vector3(),pixel:null,local:new THREE.Vector3(),lean:0,headPitch:0,side:0};
          pin=(undo,renderDebug)=>{
            if(group.visible===false || !group.parent || record.owner!==getPlayerMesh())return false;
            const target=samplePerch(record.owner,record.pixel,renderPerch);
            if(!target){
              if(!record.owner?.localToWorld)return false;
              record.owner.updateWorldMatrix?.(true,false);
              record.owner.localToWorld(renderPerch.copy(record.local));
            }
            // The rendered group already includes the composer's pose. Strip
            // the simulation-only lean, preserve its final heading, and apply
            // the head's actual rendered pitch. One quaternion composition;
            // no second silhouette solve or skeleton-wide update.
            group.localToWorld(renderGrip.copy(record.grip));
            const before=renderGrip.distanceTo(renderPerch);
            let finalLean=record.lean,rotationChanged=false;
            lastHeadPitch=record.headPitch;lastPetSide=record.side;
            const neck=getPlayerNeckJoint();
            if(neck?.isObject3D && typeof neck.getWorldPosition==='function'){
              const heading=worldQuaternionWithoutReflection(group,renderedHeading);
              if(Math.abs(record.lean)>1e-6)heading.multiply(inversePriorLean.setFromAxisAngle(broadSideAxis,-record.lean));
              keepHeadingUpright(heading);
              finalLean=applyHeadSideLean(heading,renderPerch,record.grip,group.scale);
              renderedLocalRotation.copy(worldQuaternionWithoutReflection(group.parent,renderedLocalRotation)).invert().multiply(heading);
              const current=group.quaternion;
              const dot=Math.abs(current.x*renderedLocalRotation.x+current.y*renderedLocalRotation.y+current.z*renderedLocalRotation.z+current.w*renderedLocalRotation.w);
              rotationChanged=dot<1-1e-12;
              if(rotationChanged){
                const old=current.clone(); // Transaction-specific rollback, even for nested renders.
                undo.push(()=>{group.quaternion.copy(old);group.updateMatrix?.();});
                current.copy(renderedLocalRotation);
              }
            }
            let renderAwayLimit=null,renderHeadYaw=null;
            if(c.shoulderCuriosity && c.avatarRef?.headRig && typeof c.avatarRef.updateHeadYaw==='function'){
              // A late neck/deadzone change can switch the occupied side.
              // Clamp to neutral rather than introducing an untested opposite
              // turn during rendering; the next simulation pin solves it.
              prepareAway(record.owner,renderPerch,record.grip,group.scale);
              renderAwayLimit=awayLimit(worldQuaternionWithoutReflection(group,renderedHeading));
              awayReady=false;awayPerch=awayGrip=awayScale=null;
              const avatar=c.avatarRef,rig=avatar.headRig,oldYaw=Number(rig.currentYawDeg)||0,oldTarget=rig.targetYawDeg;
              renderHeadYaw=clampAwayYaw(oldYaw,renderAwayLimit);
              if(Math.abs(renderHeadYaw-oldYaw)>1e-6){
                undo.push(()=>{setPassiveYaw(avatar,oldYaw);rig.targetYawDeg=oldTarget;});
                setPassiveYaw(avatar,renderHeadYaw);
              }
            }
            localTarget.copy(renderPerch);group.parent.worldToLocal(localTarget);
            gripOffset.copy(record.grip).multiply(group.scale).applyQuaternion(group.quaternion);
            localTarget.sub(gripOffset);
            const changed=group.position.distanceTo(localTarget)>1e-9;
            if(changed){
              const {x,y,z}=group.position; // Each transaction owns its own rollback, including nested diagnostic renders.
              undo.push(()=>{group.position.set(x,y,z);group.updateMatrix?.();});
              group.position.copy(localTarget);group.updateMatrix?.();
            }
            if(changed || rotationChanged){group.updateMatrix?.();group.localToWorld(renderGrip.copy(record.grip));}
            const debug=group.userData.hobunjiShoulderPetAttachment;
            if(debug){
              debug.renderPin={source:target?'live-skinned-pixel':'local-fallback',beforeError:before,afterError:renderGrip.distanceTo(renderPerch),
                perch:renderPerch.toArray(),grip:renderGrip.toArray(),corrected:changed || rotationChanged,
                headSideLeanDeg:finalLean*180/Math.PI,ownerHeadPitchDeg:lastHeadPitch*180/Math.PI,petHeadSide:lastPetSide,
                passiveAwayLimitDeg:renderAwayLimit,passiveHeadYawDeg:renderHeadYaw};
              if(renderDebug)renderDebug.shoulderPerchPin=debug.renderPin;
            }
            return true;
          };
          pin.owner=owner;pin.sampler=samplePerch;pin.record=record;renderPins.set(group,pin);
        }
        pin.record.grip.copy(finalTransform.gripLocalPosition);
        pin.record.pixel=finalTransform.perchSourcePixel;
        pin.record.lean=Number(finalTransform.headSideLean)||0;
        pin.record.headPitch=Number(finalTransform.headPitch)||0;pin.record.side=Number(finalTransform.petHeadSide)||0;
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

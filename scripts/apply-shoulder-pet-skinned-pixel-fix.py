from pathlib import Path

avatar_path = Path("docs/js/png-plane-avatar.js")
avatar = avatar_path.read_text()
avatar_anchor = "  function buildSinglePlaneAvatarModel(THREE, sourceCanvas, options = {}) {"
avatar_helper = """  // Resolves an authored source-pixel coordinate through the same live torso/head
  // skinning used by the portrait SkinnedMesh. This remains avatar-instance
  // data so species-level cached anchors cannot be reused for a different pose.
  function resolveSkinnedPixelWorldPosition(avatarRoot, sourcePixel) {
    const rig = avatarRoot?.userData?.neckRig;
    const skinnedPlane = rig?.skinnedPlane;
    const skeleton = skinnedPlane?.skeleton;
    if (!rig?.available || !skinnedPlane?.isSkinnedMesh || !skeleton?.bones?.length) return null;
    const sourceCanvas = avatarRoot.userData?.sourceCanvas;
    const pixelWidth = Number(sourceCanvas?.naturalWidth || sourceCanvas?.width);
    const pixelHeight = Number(sourceCanvas?.naturalHeight || sourceCanvas?.height);
    const modelWidth = Number(avatarRoot.userData?.portraitModelWidth);
    const modelHeight = Number(avatarRoot.userData?.portraitModelHeight);
    const pixelX = Number(sourcePixel?.x);
    const pixelY = Number(sourcePixel?.y);
    if (![pixelWidth, pixelHeight, modelWidth, modelHeight, pixelX, pixelY].every(Number.isFinite)
      || pixelWidth <= 0 || pixelHeight <= 0 || modelWidth <= 0 || modelHeight <= 0) return null;

    const localPoint = new THREE.Vector3(
      -modelWidth / 2 + (pixelX / pixelWidth) * modelWidth,
      modelHeight / 2 - (pixelY / pixelHeight) * modelHeight,
      0,
    );
    const blendHeight = Math.max(
      modelHeight * .012,
      Number(skinnedPlane.geometry?.userData?.blendHeight) || modelHeight * .30,
    );
    const neckY = Number(rig.neckLocal?.y) || 0;
    const t = Math.max(0, Math.min(1, (localPoint.y - (neckY - blendHeight * .55)) / blendHeight));
    const headWeight = t * t * (3 - 2 * t); // Same smoothstep as buildSkinnedPlaneGeometry.

    avatarRoot.updateWorldMatrix?.(true, false);
    skinnedPlane.updateWorldMatrix?.(true, false);
    const deformed = new THREE.Vector3();
    const bonePoint = new THREE.Vector3();
    const boneMatrix = new THREE.Matrix4();
    const weights = [1 - headWeight, headWeight];
    for (let i = 0; i < Math.min(2, skeleton.bones.length); i++) {
      const bone = skeleton.bones[i];
      const weight = weights[i] || 0;
      if (!weight || !bone) continue;
      bone.updateWorldMatrix?.(true, false);
      boneMatrix.multiplyMatrices(bone.matrixWorld, skeleton.boneInverses[i]);
      bonePoint.copy(localPoint).applyMatrix4(boneMatrix);
      deformed.addScaledVector(bonePoint, weight);
    }
    return skinnedPlane.localToWorld(deformed);
  }

"""
if avatar.count(avatar_anchor) != 1:
    raise SystemExit("avatar insertion anchor count mismatch")
avatar = avatar.replace(avatar_anchor, avatar_helper + avatar_anchor, 1)
export_anchor = "    upgradePlaneToAutoNeckSkin,\n"
if avatar.count(export_anchor) != 1:
    raise SystemExit("avatar export anchor count mismatch")
avatar = avatar.replace(export_anchor, export_anchor + "    resolveSkinnedPixelWorldPosition,\n", 1)
avatar_path.write_text(avatar)

game_path = Path("docs/game.js")
game = game_path.read_text()
old_anchor_return = "        return Number.isFinite(anchor?.position?.y) ? { ...anchor.position, rotationDeg: anchor.rotationDeg } : null;"
new_anchor_return = "        return Number.isFinite(anchor?.position?.y) ? { ...anchor.position, rotationDeg: anchor.rotationDeg, sourcePixel: anchor.sourcePixel ? { ...anchor.sourcePixel } : null } : null;"
if game.count(old_anchor_return) != 1:
    raise SystemExit("player anchor return count mismatch")
game = game.replace(old_anchor_return, new_anchor_return, 1)

old_position = "        const perchWorldPosition = playerMesh.localToWorld(new THREE.Vector3(perch.x || 0, perch.y || 0, perch.z || 0)); // Keeps the perch point fixed to the body-local shoulder coordinate.\n        const gripWorldOffset = new THREE.Vector3(grip.x || 0, grip.y || 0, grip.z || 0).applyQuaternion(worldQuaternion); // Moves the pet origin so its rotated grip still lands exactly on the fixed perch point."
new_position = "        const skinnedPerchWorldPosition = window.PNGPlaneAvatar?.resolveSkinnedPixelWorldPosition?.(playerMesh, perch.sourcePixel); // Deforms the authored shoulder pixel through this avatar's live portrait skinning.\n        const perchWorldPosition = skinnedPerchWorldPosition || playerMesh.localToWorld(new THREE.Vector3(perch.x || 0, perch.y || 0, perch.z || 0)); // Falls back to the authored body-local coordinate for rigid/legacy avatars.\n        const gripWorldOffset = new THREE.Vector3(grip.x || 0, grip.y || 0, grip.z || 0).applyQuaternion(worldQuaternion); // Aligns the pet grip to the resolved perch point."
if game.count(old_position) != 1:
    raise SystemExit("shoulder position anchor count mismatch")
game = game.replace(old_position, new_position, 1)
old_return = "          faceWorldQuaternion,\n          faceRotationSource: faceRotationSource === playerNeckJoint ? 'player-neck-bone' : 'player-body-fallback',"
new_return = "          faceWorldQuaternion,\n          perchPositionSource: skinnedPerchWorldPosition ? 'player-authored-skinned-pixel' : 'player-body-local-fallback',\n          faceRotationSource: faceRotationSource === playerNeckJoint ? 'player-neck-bone' : 'player-body-fallback',"
if game.count(old_return) != 1:
    raise SystemExit("shoulder return anchor count mismatch")
game = game.replace(old_return, new_return, 1)
old_diag = "          rotationSource: finalTransform.faceRotationSource,\n          expectedWorldPosition: finalTransform.worldPosition.toArray(),"
new_diag = "          rotationSource: finalTransform.faceRotationSource,\n          positionSource: finalTransform.perchPositionSource,\n          expectedWorldPosition: finalTransform.worldPosition.toArray(),"
if game.count(old_diag) != 1:
    raise SystemExit("diagnostic anchor count mismatch")
game = game.replace(old_diag, new_diag, 1)
game_path.write_text(game)

test_path = Path("scripts/test-shoulder-pet-attack-rotation.js")
test = test_path.read_text()
old_test = """assert.match(gameSource,
  /const perchWorldPosition = playerMesh\\.localToWorld[\\s\\S]{0,420}worldPosition: perchWorldPosition\\.sub\\(gripWorldOffset\\)/,
  'the body-local perch position stays fixed while the pet pivots around its aligned grip');"""
new_test = """assert.match(gameSource,
  /resolveSkinnedPixelWorldPosition\\?\\.\\(playerMesh, perch\\.sourcePixel\\)[\\s\\S]{0,520}worldPosition: perchWorldPosition\\.sub\\(gripWorldOffset\\)/,
  'the authored perch pixel follows the live player skin before grip alignment');"""
if test.count(old_test) != 1:
    raise SystemExit("regression test anchor count mismatch")
test_path.write_text(test.replace(old_test, new_test, 1))
print("guarded shoulder-pet patch applied")

# Guarded source-patch script; exercised by the branch workflow.

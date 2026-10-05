'use strict';

const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, text) { fs.writeFileSync(path, text); }
function replaceExact(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Missing ${label}`);
  return text.replace(from, to);
}

// 1) Dual-wield visual hierarchy: roots reproduce the source weapon transform;
// only visible child weapons receive the local sandwich offsets. Hand sockets
// are remapped through the actual visible child weapon matrices.
{
  const path = 'docs/js/dual-wield-weapon-visuals.js';
  let s = read(path);

  s = replaceExact(s,
`// The authored/original weapon plane remains the transform authority but becomes
// material-hidden while dual wield is active. Two visible duplicate meshes live
// beneath that hidden plane, so sprite scale is inherited exactly once. During
// attacks the copies straddle the sprite plane like two slices of bread around a
// sandwich and the main-hand copy replays the weapon transform with a small lag.
// During idle, the offhand copy may instead use an explicitly authored idle pose.`,
`// The authored/original weapon plane remains the transform authority but becomes
// material-hidden while dual wield is active. Two transform-following roots live
// beneath it. Those ROOTS reproduce the source weapon transform (the main root may
// replay it with the authored short lag); only their visible weapon children carry
// the local +/-Z sandwich offsets. Hands resolve sockets from those visible child
// weapon matrices, never from the hidden source or a root-only approximation.
// During idle, the offhand root may additionally take the explicitly authored
// opposite-hand stance while preserving the shared body yaw.`,
  'dual header');

  s = replaceExact(s,
`    duplicate.name = \`dual_wield_\${side}_weapon\`;
    duplicate.position.set?.(0, 0, 0);
    duplicate.quaternion.identity?.();
    duplicate.scale.set?.(1, 1, 1); // The hidden original plane is the only scale authority.`,
`    duplicate.name = \`dual_wield_\${side}_weapon\`;
    duplicate.position.set?.(0, 0, side === 'main' ? -HALF_Z_SEPARATION : HALF_Z_SEPARATION); // Only the child weapon gets the bread-slice separation; roots stay transform followers.
    duplicate.quaternion.identity?.();
    duplicate.scale.set?.(side === 'off' ? -1 : 1, 1, 1); // The offhand is the opposite-hand mirror, matching Mirror Animation's sprite-X flip without touching the root transform.`,
  'child local offsets');

  s = replaceExact(s,
`      return { visual, plane, holder: context?.toolHolder || null, source: 'attack-editor' };`,
`      return { visual, plane, holder: context?.toolHolder || null, bodyRoot: context?.bodyRoot || null, source: 'attack-editor' };`,
  'editor dual context body root');
  s = replaceExact(s,
`    return { visual, plane, holder: deps?.toolHolder || null, source: 'runtime' };`,
`    return { visual, plane, holder: deps?.toolHolder || null, bodyRoot: global.PlayerBodyTransformComposer?.getPlayerMesh?.() || deps?.playerMesh || null, source: 'runtime' };`,
  'runtime dual context body root');

  const oldIdleTransform = `  function idleOffhandLocalTransform(current) {
    const poses = idleStancePoses();
    if (!poses || !current.holder?.matrixWorld || !current.plane?.matrixWorld) return null;
    const Matrix4 = current.plane.matrixWorld.constructor;
    const Vector3 = current.plane.position.constructor;
    const Quaternion = current.plane.quaternion.constructor;
    const unitScale = new Vector3(1, 1, 1);
    const mainQ = poseQuaternion(Quaternion, Vector3, poses.main);
    const offQ = poseQuaternion(Quaternion, Vector3, poses.offhand);
    const invMainQ = mainQ.clone().invert();
    const holderDeltaPosition = new Vector3(
      (Number(poses.offhand.x) || 0) - (Number(poses.main.x) || 0),
      (Number(poses.offhand.y) || 0) - (Number(poses.main.y) || 0),
      (Number(poses.offhand.z) || 0) - (Number(poses.main.z) || 0),
    ).applyQuaternion(invMainQ);
    const holderDeltaQuaternion = invMainQ.multiply(offQ).normalize();
    const holderDelta = new Matrix4().compose(holderDeltaPosition, holderDeltaQuaternion, unitScale);

    const bakedHolderWorld = !inAttackEditor() ? global.WeaponToolStances?.lastHolderMatrixWorld?.() : null;
    const holderWorld = bakedHolderWorld || current.holder.matrixWorld.clone();
    const holderToPlane = holderWorld.clone().invert().multiply(current.plane.matrixWorld.clone());
    const planeRelative = holderToPlane.clone().invert().multiply(holderDelta).multiply(holderToPlane);
    const normalOffset = new Matrix4().makeTranslation(0, 0, HALF_Z_SEPARATION); // Actual sprite-plane normal: bread slices around the sandwich.
    planeRelative.multiply(normalOffset);

    const position = new Vector3();
    const quaternion = new Quaternion();
    const ignoredScale = new Vector3();
    planeRelative.decompose(position, quaternion, ignoredScale);
    return { position, quaternion: quaternion.normalize() }; // Scale is intentionally discarded; parent plane owns sprite scale once.
  }`;

  const newIdleTransform = `  function idleOffhandLocalTransform(current) {
    const poses = idleStancePoses();
    if (!poses || !current.holder?.matrixWorld || !current.plane?.matrixWorld || !current.bodyRoot) return null;
    const Matrix4 = current.plane.matrixWorld.constructor;
    const Vector3 = current.plane.position.constructor;
    const Quaternion = current.plane.quaternion.constructor;
    const unitScale = new Vector3(1, 1, 1);
    const mainQ = poseQuaternion(Quaternion, Vector3, poses.main);
    const offQ = poseQuaternion(Quaternion, Vector3, poses.offhand);

    // Reconstruct the hand-side anchor underneath the authored main pose. This is
    // the part Mirror Animation also mirrors by negating toolBase.x. Runtime's
    // holder is scene-level, so deriving the anchor from the baked holder pose is
    // more reliable than assuming a particular parent hierarchy.
    const bakedHolderWorld = !inAttackEditor() ? global.WeaponToolStances?.lastHolderMatrixWorld?.() : null;
    const holderWorld = bakedHolderWorld || current.holder.matrixWorld.clone();
    const holderPosition = new Vector3();
    const holderQuaternion = new Quaternion();
    const ignoredHolderScale = new Vector3();
    holderWorld.decompose(holderPosition, holderQuaternion, ignoredHolderScale);
    const baseQuaternion = holderQuaternion.clone().multiply(mainQ.clone().invert()).normalize();
    const mainPoseOffset = new Vector3(
      Number(poses.main.x) || 0,
      Number(poses.main.y) || 0,
      Number(poses.main.z) || 0,
    ).applyQuaternion(baseQuaternion);
    const basePosition = holderPosition.clone().sub(mainPoseOffset);

    // Mirror that anchor across the character's left/right midline. Because the
    // body root itself owns the normal body yaw, reflecting in its current local X
    // frame is exactly "Mirror Animation" AFTER body yaw without negating bodyYaw.
    current.bodyRoot.updateWorldMatrix?.(true, false);
    const bodyPosition = current.bodyRoot.getWorldPosition?.(new Vector3()) || new Vector3().setFromMatrixPosition(current.bodyRoot.matrixWorld);
    const bodyQuaternion = hierarchyWorldQuaternion(current.bodyRoot, new Quaternion());
    const bodyRight = new Vector3(1, 0, 0).applyQuaternion(bodyQuaternion).normalize();
    const sideDistance = basePosition.clone().sub(bodyPosition).dot(bodyRight);
    const mirroredBasePosition = basePosition.clone().addScaledVector(bodyRight, -2 * sideDistance);

    // The offhand pose itself is explicitly authored. Its DEFAULT is generated
    // with the same channel mirror as the editor button (X/Yaw/Roll negate;
    // Y/Z/Pitch stay; Body Yaw stays shared), but artists can change it afterward.
    const offPoseOffset = new Vector3(
      Number(poses.offhand.x) || 0,
      Number(poses.offhand.y) || 0,
      Number(poses.offhand.z) || 0,
    ).applyQuaternion(baseQuaternion);
    const targetHolderPosition = mirroredBasePosition.add(offPoseOffset);
    const targetHolderQuaternion = baseQuaternion.clone().multiply(offQ).normalize();
    const targetHolderWorld = new Matrix4().compose(targetHolderPosition, targetHolderQuaternion, unitScale);

    // Move the duplicated offhand ROOT from the hidden source plane to the exact
    // authored opposite-hand holder transform. The +/-Z bread separation is NOT
    // in this matrix; it belongs only to offMesh.position.z.
    const holderDelta = targetHolderWorld.multiply(holderWorld.clone().invert());
    const planeRelative = current.plane.matrixWorld.clone().invert()
      .multiply(holderDelta)
      .multiply(current.plane.matrixWorld.clone());
    const position = new Vector3();
    const quaternion = new Quaternion();
    const ignoredScale = new Vector3();
    planeRelative.decompose(position, quaternion, ignoredScale);
    return { position, quaternion: quaternion.normalize() };
  }`;
  s = replaceExact(s, oldIdleTransform, newIdleTransform, 'idle offhand transform');

  s = replaceExact(s,
`    const offsetWorld = new Vector3();
    const basePosition = new Vector3();`,
`    const basePosition = new Vector3();`,
  'remove main root sandwich offset scratch');
  s = replaceExact(s,
`      offsetWorld.set(0, 0, -HALF_Z_SEPARATION).applyQuaternion(baseQuaternion);
      desiredWorldPosition.copy(basePosition).add(offsetWorld);`,
`      desiredWorldPosition.copy(basePosition); // Root follows only the delayed source transform; the child mesh owns the local -Z sandwich offset.`,
  'remove main root sandwich offset');

  const oldSyncBlock = `    const Vector3 = current.plane.position.constructor;
    const Quaternion = current.plane.quaternion.constructor;
    const attackPosition = new Vector3(0, 0, HALF_Z_SEPARATION);
    const attackQuaternion = new Quaternion();
    const idleTransform = current.idleBlend > ACTIVE_EPSILON ? idleOffhandLocalTransform(current) : null;
    const targetPosition = idleTransform
      ? attackPosition.clone().lerp(idleTransform.position, clamp01(current.idleBlend))
      : attackPosition;
    const targetQuaternion = idleTransform
      ? attackQuaternion.clone().slerp(idleTransform.quaternion, clamp01(current.idleBlend))
      : attackQuaternion;
    setRootToward(current.offRoot, targetPosition, targetQuaternion, current.influence);`;
  const newSyncBlock = `    const Vector3 = current.plane.position.constructor;
    const Quaternion = current.plane.quaternion.constructor;
    const idleTransform = current.idleBlend > ACTIVE_EPSILON ? idleOffhandLocalTransform(current) : null;
    const idleAmount = clamp01(current.idleBlend);
    const targetPosition = idleTransform ? idleTransform.position.clone().multiplyScalar(idleAmount) : new Vector3();
    const targetQuaternion = idleTransform
      ? new Quaternion().identity().slerp(idleTransform.quaternion, idleAmount)
      : new Quaternion();
    setRootToward(current.offRoot, targetPosition, targetQuaternion, current.influence); // Attack root stays identity; only idle authoring moves it.`;
  s = replaceExact(s, oldSyncBlock, newSyncBlock, 'off root sync ownership');

  const oldSocket = `  function transformSocketForHand(record, side, socketFrame) {
    const current = syncNow();
    if (!current || current.influence <= ACTIVE_EPSILON || !socketFrame?.position || !socketFrame?.quaternion) return socketFrame;
    const root = side === 'right' ? current.mainRoot : current.offRoot;
    if (!root?.matrixWorld || !current.plane?.matrixWorld) return socketFrame;
    const delta = root.matrixWorld.clone().multiply(current.plane.matrixWorld.clone().invert());
    const position = socketFrame.position.clone().applyMatrix4(delta);
    const Quaternion = root.quaternion.constructor;
    const planeWorldQ = hierarchyWorldQuaternion(current.plane, new Quaternion());
    const rootWorldQ = hierarchyWorldQuaternion(root, new Quaternion());
    const deltaQ = rootWorldQ.multiply(planeWorldQ.invert()).normalize();
    const quaternion = deltaQ.multiply(socketFrame.quaternion.clone()).normalize();`;
  const newSocket = `  function transformSocketForHand(record, side, socketFrame) {
    const current = syncNow();
    if (!current || current.influence <= ACTIVE_EPSILON || !socketFrame?.position || !socketFrame?.quaternion) return socketFrame;
    const weapon = side === 'right' ? current.mainMesh : current.offMesh;
    if (!weapon?.matrixWorld || !current.plane?.matrixWorld) return socketFrame;
    weapon.updateMatrixWorld?.(true);
    // Map the hidden original weapon's real grip frame onto the VISIBLE child
    // weapon. This includes the child-local +/-Z offset and offhand sprite mirror;
    // using the root here leaves both hands gripping the hidden parent instead.
    const delta = weapon.matrixWorld.clone().multiply(current.plane.matrixWorld.clone().invert());
    const position = socketFrame.position.clone().applyMatrix4(delta);
    const Quaternion = weapon.quaternion.constructor;
    const planeWorldQ = hierarchyWorldQuaternion(current.plane, new Quaternion());
    const weaponWorldQ = hierarchyWorldQuaternion(weapon, new Quaternion());
    const deltaQ = weaponWorldQ.multiply(planeWorldQ.invert()).normalize();
    const quaternion = deltaQ.multiply(socketFrame.quaternion.clone()).normalize();`;
  s = replaceExact(s, oldSocket, newSocket, 'child weapon grip sockets');

  s = replaceExact(s,
`      mainRootScale: state?.mainRoot?.scale?.toArray?.() || null,
      offRootScale: state?.offRoot?.scale?.toArray?.() || null,`,
`      mainRootScale: state?.mainRoot?.scale?.toArray?.() || null,
      offRootScale: state?.offRoot?.scale?.toArray?.() || null,
      mainChildLocalPosition: state?.mainMesh?.position?.toArray?.() || null,
      offChildLocalPosition: state?.offMesh?.position?.toArray?.() || null,
      offChildMirroredX: Number(state?.offMesh?.scale?.x) < 0,`,
  'debug child transforms');

  write(path, s);
}

// 2) Give the idle editor a literal "Mirror Main -> Offhand" authoring action.
{
  const path = 'docs/js/attack-idle-stance-editor.js';
  let s = read(path);

  s = replaceExact(s,
`      <div class="row" style="margin-top:6px">
        <button id="idlePreviewDualPairBtn" class="secondary">Preview Dual Wield Pair</button>
        <button id="idleStopDualPairBtn" class="secondary">Stop Pair Preview</button>
      </div>`,
`      <div class="row" style="margin-top:6px">
        <button id="idleMirrorDualOffhandBtn" class="secondary">Mirror Main → Offhand</button>
        <button id="idlePreviewDualPairBtn" class="secondary">Preview Dual Wield Pair</button>
      </div>
      <div class="row" style="margin-top:6px">
        <button id="idleStopDualPairBtn" class="secondary">Stop Pair Preview</button>
      </div>`,
  'idle mirror button');

  s = replaceExact(s,
`      <div class="help" style="margin-top:7px">Use <b>Edit Selected in Neutral</b> to route the existing Neutral sliders and 3D gizmo into any idle preset, including <b>Dual Wield — Offhand</b>. The offhand begins as a body-relative mirror of Light Weapon, but that mirror is only the default: its x/y/z and pitch/yaw/roll are saved explicitly and runtime uses exactly what you author. Body yaw stays shared with Dual Wield — Main hand. <b>Preview Dual Wield Pair</b> shows both saved poses together.</div>`,
`      <div class="help" style="margin-top:7px">Use <b>Edit Selected in Neutral</b> to route the existing Neutral sliders and 3D gizmo into any idle preset, including <b>Dual Wield — Offhand</b>. <b>Mirror Main → Offhand</b> performs the same stance mirror as the editor's <b>Mirror Animation</b> operation—X/Yaw/Roll mirror, Y/Z/Pitch stay—but intentionally leaves Body Yaw unchanged and assigns the result to the other hand. The runtime also mirrors the hand-side anchor and sprite facing. Afterward the offhand x/y/z and pitch/yaw/roll remain fully custom and saved explicitly. <b>Preview Dual Wield Pair</b> shows both saved poses together.</div>`,
  'idle help mirror semantics');

  s = replaceExact(s,
`    function previewDualWieldMain() {
      const main = workingConfig.stances.dualWieldMain;`,
`    function mirrorDualWieldMainToOffhand() {
      const main = workingConfig.stances.dualWieldMain;
      if (!main) return false;
      workingConfig.stances.dualWieldOffhand = normalizePose({
        ...main,
        x: -(Number(main.x) || 0),
        yaw: -(Number(main.yaw) || 0),
        roll: -(Number(main.roll) || 0),
        bodyYaw: Number(main.bodyYaw) || 0, // Deliberately NOT mirrored: both weapons share the normal body yaw.
      }, FALLBACK_CONFIG.stances.dualWieldOffhand);
      selectedKey = 'dualWieldOffhand';
      select.value = selectedKey;
      syncFieldsFromPose();
      updateEditButton();
      if (editingNeutral) writeNeutralPose(currentPose());
      setDualPairPreview(true);
      setStatus('Mirrored Dual Wield Main into Offhand using Mirror Animation rules, with Body Yaw preserved. Offhand transforms are now independently editable.');
      return true;
    }

    function previewDualWieldMain() {
      const main = workingConfig.stances.dualWieldMain;`,
  'idle mirror helper');

  s = replaceExact(s,
`    $('idlePreviewBtn').addEventListener('click', () => {`,
`    $('idleMirrorDualOffhandBtn').addEventListener('click', mirrorDualWieldMainToOffhand);

    $('idlePreviewBtn').addEventListener('click', () => {`,
  'idle mirror button handler');

  s = replaceExact(s,
`      previewDualWieldMain,
      setDualPairPreview,`,
`      previewDualWieldMain,
      mirrorDualWieldMainToOffhand,
      setDualPairPreview,`,
  'idle mirror export');

  write(path, s);
}

// 3) Expose the editor's body-yaw rig to the dual visual layer so the other-hand
// anchor can be mirrored in the exact body-relative frame.
{
  const path = 'docs/tools/attack-animation-editor/index.html';
  let s = read(path);
  s = replaceExact(s,
`  get toolHolder() { return toolHolder; },
  get toolPlaneMesh() { return toolPlaneMesh; },`,
`  get toolHolder() { return toolHolder; },
  get bodyRoot() { return rig; }, // Dual Wield mirrors the offhand anchor in this already-body-yawed frame without changing bodyYaw itself.
  get toolPlaneMesh() { return toolPlaneMesh; },`,
  'editor body root context');
  write(path, s);
}

// 4) Regressions: roots own only transform-following/lag; child meshes own local
// sandwich offsets and hand sockets; idle mirror is the Mirror Animation rule set
// with bodyYaw preserved.
{
  const path = 'scripts/test-dual-wield-weapon-visuals.js';
  let s = read(path);
  s = s.replace(
`assert.match(dual, /offsetWorld\\.set\\(0, 0, -HALF_Z_SEPARATION\\)/, 'main duplicate sits on one side of the actual sprite-plane normal');
assert.match(dual, /new Vector3\\(0, 0, HALF_Z_SEPARATION\\)/, 'offhand attack duplicate sits on the equal opposite side of the sprite-plane normal');`,
`assert.match(dual, /duplicate\\.position\\.set\\?\\.\\(0, 0, side === 'main' \\? -HALF_Z_SEPARATION : HALF_Z_SEPARATION\\)/, 'only visible child weapons receive the equal/opposite local sprite-plane-normal offsets');
assert.doesNotMatch(dual, /offsetWorld\\.set\\(0, 0, -HALF_Z_SEPARATION\\)/, 'main root no longer carries the sandwich offset');
assert.match(dual, /desiredWorldPosition\\.copy\\(basePosition\\)/, 'main root replays only the delayed source transform');`);
  s = s.replace(
`assert.match(dual, /transformSocketForHand/, 'dual visual layer exposes per-hand socket transforms');`,
`assert.match(dual, /transformSocketForHand/, 'dual visual layer exposes per-hand socket transforms');
assert.match(dual, /const weapon = side === 'right' \\? current\\.mainMesh : current\\.offMesh/, 'each hand resolves its socket from its visible child weapon');
assert.match(dual, /weapon\\.matrixWorld\\.clone\\(\\)\\.multiply\\(current\\.plane\\.matrixWorld\\.clone\\(\\)\\.invert\\(\\)\\)/, 'child local offset/mirroring is included in the grip socket transform');
assert.match(dual, /duplicate\\.scale\\.set\\?\\.\\(side === 'off' \\? -1 : 1, 1, 1\\)/, 'offhand child carries Mirror Animation sprite-X handedness without altering the root');`);
  s = s.replace(
`console.log('dual wield: hidden parent, opposite duplicate offsets, main-hand lag, shared frame ownership, live per-hand sockets, default 2H, and mutually exclusive editor mode PASS');`,
`console.log('dual wield: transform-following roots, child-only sandwich offsets, child-mesh grip sockets, main-hand lag, default 2H, and mutually exclusive editor mode PASS');`);
  write(path, s);
}

{
  const path = 'scripts/test-dual-wield-idle-stance.js';
  let s = read(path);
  s = replaceExact(s,
`assert.match(editor, /Preview Dual Wield Pair/, 'idle editor can preview both explicitly authored poses together');`,
`assert.match(editor, /Mirror Main → Offhand/, 'idle editor exposes an explicit Mirror Animation-style main-to-offhand authoring action');
assert.match(editor, /mirrorDualWieldMainToOffhand/, 'idle editor saves the mirrored result as a normal editable offhand pose');
assert.match(editor, /bodyYaw: Number\\(main\\.bodyYaw\\) \\|\\| 0/, 'main-to-offhand mirror deliberately preserves body yaw');
assert.match(editor, /Preview Dual Wield Pair/, 'idle editor can preview both explicitly authored poses together');`,
  'idle test mirror tool');
  s = replaceExact(s,
`assert.match(dual, /idleOffhandLocalTransform/, 'dual visuals convert the explicit body-relative offhand stance into the hidden-plane hierarchy');`,
`assert.match(dual, /idleOffhandLocalTransform/, 'dual visuals convert the explicit body-relative offhand stance into the hidden-plane hierarchy');
assert.match(dual, /sideDistance = basePosition\\.clone\\(\\)\\.sub\\(bodyPosition\\)\\.dot\\(bodyRight\\)/, 'idle offhand mirrors the actual hand-side anchor across the character midline');
assert.match(dual, /targetHolderPosition = mirroredBasePosition\\.add\\(offPoseOffset\\)/, 'authored offhand pose is applied after the anchor has moved to the other hand');`,
  'idle test other-hand anchor');
  s = replaceExact(s,
`console.log('dual wield idle stance: light-main default, authored mirrored offhand, pair preview, runtime persistence, and editable Neutral metadata PASS');`,
`console.log('dual wield idle stance: Mirror Animation-style other-hand default without bodyYaw flip, editable offhand pose, pair preview, and runtime persistence PASS');`,
  'idle test message');
  write(path, s);
}

console.log('Applied dual-wield root ownership / mirror / child-grip patch.');

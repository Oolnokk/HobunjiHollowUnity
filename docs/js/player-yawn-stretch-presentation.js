// Player-only five-second yawn-and-stretch presentation.
// NPC fatigue/rest timing stays in npc-yawn-rest.js; this module takes temporary
// ownership of the player's held visuals and applies its arms AFTER the normal hand driver.
(() => {
  'use strict';

  if (window.PlayerYawnStretchPresentation?.version >= 1) return;

  const OWNER = 'player-yawn-stretch'; // Named action-lock owner; never confuse the yawn with an unrelated interaction.
  const WEAPON_IDLE_CHANNEL = 'weapon-idle-stance-body-yaw'; // Idle weapon yaw must not compete with the unarmed stretch.
  const hidden = new Map(); // Original held-visual visibility, restored after completion or interruption.
  const handBase = new Map(); // Per-hand pre-stretch transforms avoid accumulating poses across multiple render passes.
  const shoulderAnchors = { left: null, right: null }; // Rig-local shoulder samples from the gameplay phase, never resolved during a temporary render pose.
  let entry = null; // The active player yawn from NpcYawnRest, or null outside its five-second window.
  let yawnLock = null; // Blocks weapon/tool actions without stopping walking or changing the equipped selection.
  let sentinel = null; // Invisible pre-render mesh that runs after the ordinary procedural hand driver.
  let sentinelParent = null; // Tracks avatar replacement so the sentinel never persists on an old player mesh.
  let handRig = null; // The existing player procedural hand rig, reused rather than creating new hands.
  let ownedHandRig = null; // A temporary idle-pose provider makes the ordinary hand driver release weapon grips before the stretch.
  let progress = 0; // Five-second normalized yawn clock, read by the final-render hand pose.
  let handApplications = 0; // Mobile-readable count of successful final-render stretch samples.
  let constrainedHandSamples = 0; // Mobile diagnostic count of reach-limited wrist poses.
  let greatestWristReachFraction = 0; // Highest actual shoulder-to-wrist fraction seen in the current yawn.
  let authoredShoulderSamples = 0; // Counts use of the existing species/rig shoulder anchors instead of a guessed shoulder.
  let lastError = null; // Mobile diagnostics when a late-created dependency is unavailable.

  const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
  const smooth = value => { const t = clamp01(value); return t * t * (3 - 2 * t); };

  function deps() {
    return window.ProceduralHandAttachments?.gameDeps || window.Combat?.deps || {};
  }

  function playerMesh() {
    return window.PlayerBodyTransformComposer?.getPlayerMesh?.()
      || window.Combat?.deps?.playerMesh || entry?.walker?.root || null;
  }

  function heldRoots() {
    const mesh = playerMesh();
    const d = deps();
    const combat = window.Combat?.deps || {};
    const rawTool = d.toolHolder || combat.toolHolder; // The hand adapter may initialize before combat's equipment holder is injected.
    const tool = typeof rawTool === 'function' ? rawTool() : rawTool;
    const bag = mesh?.children?.find(node =>
      node?.type === 'Group' && node.userData?.isPngPlane === true && !String(node.name || '').trim()
    ); // game.js's unnamed heldItemHolder, separate from weapon/toolHolder.
    const burden = window.Shattercasks?.heldHandTarget?.()?.holder;
    const directItem = (d.getHeldItemHandTarget?.() || combat.getHeldItemHandTarget?.())?.holder;
    return [...new Set([tool, bag, burden, directItem].filter(node => node?.isObject3D))];
  }

  function suppressHeldVisuals() {
    window.PlayerBodyTransformComposer?.clearChannel?.(WEAPON_IDLE_CHANNEL);
    for (const node of heldRoots()) {
      if (!hidden.has(node)) hidden.set(node, node.visible !== false);
      node.visible = false; // Keep inventory equipment selected; only its presentation is temporarily hidden.
    }
  }

  function restoreHeldVisuals() {
    for (const [node, wasVisible] of hidden) {
      if (node.visible === false) node.visible = wasVisible;
    }
    hidden.clear();
  }

  function actionBlocked(ongoingEntry = null) {
    const locks = window.CharacterActionLocks;
    if (!locks) return false;
    const records = locks.getDebug?.();
    if (!Array.isArray(records)) return !!locks.isLocked?.('player', 'actions') && !ongoingEntry;
    return records.some(record => {
      if (ongoingEntry && (record.owner === OWNER
          || (ongoingEntry.komaStarted && record.owner === 'npc-autonomous-drink'))) return false;
      return record.participants?.some(actor => actor.id === 'player'
        && actor.channels?.some(channel => ['tools', 'actions', 'pose', 'movement', 'facing'].includes(channel))); // Movement/facing locks also signal authored traversal and choreography.
    });
  }

  function discoverHandRig() {
    const avatar = entry?.walker?.avatarGroup;
    const mesh = playerMesh();
    let found = avatar?.userData?.proceduralHandRig || null;
    if (!found) mesh?.traverse?.(node => {
      if (!found && node?.userData?.proceduralHandRig) found = node.userData.proceduralHandRig;
    });
    if (handRig !== found) {
      restoreHandPose(); releaseHandOwnership(); handRig = found; handBase.clear();
      shoulderAnchors.left = null; shoulderAnchors.right = null; // Old avatar's shoulder coordinates must not cross rig replacements.
    }
    return handRig;
  }

  function releaseHandOwnership() {
    ownedHandRig?.setPoseProvider?.(OWNER, null); // The rig API releases only our own provider; another action may have superseded it.
    ownedHandRig = null;
  }

  function syncHandOwnership() {
    const rig = discoverHandRig();
    if (entry?.komaStarted || !rig?.setPoseProvider) { releaseHandOwnership(); return; }
    if (ownedHandRig === rig) return;
    const poseOwner = rig.getDebug?.()?.poseOwner;
    if (poseOwner && poseOwner !== OWNER) return; // Never steal a cinematic or paired interaction's hand ownership.
    releaseHandOwnership();
    rig.setPoseProvider(OWNER, owned => owned.useIdlePose?.()); // The native frame driver now chooses neutral hands instead of an invisible weapon's grip.
    ownedHandRig = rig;
  }

  function captureShoulderAnchors() {
    const rig = discoverHandRig(); // Only called from gameplay start/update, before the renderer applies temporary body/neck transforms.
    for (const side of ['left', 'right']) {
      const socket = rig?.group?.getObjectByName?.(side + '_hand_socket');
      if (!socket?.position || !rig?.shoulderPositionLocal) { shoulderAnchors[side] = null; continue; }
      const target = shoulderAnchors[side] || socket.position.clone(); // Allocate at most one 3D shoulder vector per side and avatar.
      const shoulder = rig.shoulderPositionLocal(side, target); // This resolver may update avatar world matrices: never call it during onBeforeRender.
      if (!Number.isFinite(shoulder?.x) || !Number.isFinite(shoulder?.y) || !Number.isFinite(shoulder?.z)) {
        shoulderAnchors[side] = null; continue;
      }
      if (shoulder !== target) target.copy(shoulder);
      shoulderAnchors[side] = target;
    }
  }

  function samePose(actual, expected) {
    return Math.abs(actual.position.x - expected.position.x) < 0.00001
      && Math.abs(actual.position.y - expected.position.y) < 0.00001
      && Math.abs(actual.position.z - expected.position.z) < 0.00001
      && Math.abs(actual.quaternion.x - expected.quaternion.x) < 0.00001
      && Math.abs(actual.quaternion.y - expected.quaternion.y) < 0.00001
      && Math.abs(actual.quaternion.z - expected.quaternion.z) < 0.00001
      && Math.abs(actual.quaternion.w - expected.quaternion.w) < 0.00001
      && actual.visible === expected.visible;
  }

  function restoreHandPose() {
    for (const record of handBase.values()) {
      if (!samePose(record.socket, record.applied)) continue;
      record.socket.position.copy(record.base.position);
      record.socket.quaternion.copy(record.base.quaternion);
      record.socket.visible = record.base.visible;
      record.socket.updateMatrixWorld?.(true);
    }
    handBase.clear();
  }

  function applyStretch() {
    if (!entry || !discoverHandRig()?.group) return false;
    const owner = handRig.getDebug?.()?.poseOwner;
    if (owner && owner !== OWNER) return false; // An authored paired/grapple pose owns the hands.
    const mesh = playerMesh();
    const height = Math.max(0.2, Number(entry.walker.avatarGroup?.userData?.portraitModelHeight)
      || Number(mesh?.userData?.portraitModelHeight) || 0.9);
    const reachIn = smooth(progress / 0.22);
    const reachOut = 1 - smooth((progress - 0.76) / 0.24);
    const stretch = reachIn * reachOut; // Raise both arms, hold above the head through the yawn, then lower smoothly.
    if (entry.komaStarted) handRig.setSideIdle?.('left'); // The chewing hand keeps its leaf grip; release only the free left hand from any hidden weapon.
    let applied = false;
    for (const side of ['left', 'right']) {
      if (entry.komaStarted && side === 'right') continue; // Keep the real Koma-chewing hand on its authored leaf grip; stretch the free arm.
      const socket = handRig.group.getObjectByName?.(side + '_hand_socket');
      if (!socket?.position || !socket?.quaternion) continue;
      let record = handBase.get(side);
      if (!record || record.socket !== socket) {
        record = { socket,
          base: { position: socket.position.clone(), quaternion: socket.quaternion.clone(), visible: socket.visible },
          applied: { position: socket.position.clone(), quaternion: socket.quaternion.clone(), visible: socket.visible } };
        handBase.set(side, record);
      } else if (!samePose(socket, record.applied)) {
        record.base.position.copy(socket.position);
        record.base.quaternion.copy(socket.quaternion); // The native gait/hand driver supplied a new neutral pose this pass.
        record.base.visible = socket.visible;
      }
      socket.position.copy(record.base.position);
      socket.quaternion.copy(record.base.quaternion);
      const sign = side === 'left' ? -1 : 1;
      const authoredReach = Number(handRig.armLengthForSide?.(side)); // The species/age-scaled arm length, including very small characters.
      const reach = Number.isFinite(authoredReach) && authoredReach > 0 ? authoredReach : height * 0.29; // Never substitute an oversized minimum.
      const shoulder = shoulderAnchors[side]; // Immutable for all draw passes in this frame; uses hand-IK's authored anchor sampled before rendering.
      const hasAuthoredShoulder = Number.isFinite(shoulder?.x) && Number.isFinite(shoulder?.y) && Number.isFinite(shoulder?.z);
      if (hasAuthoredShoulder) authoredShoulderSamples++;
      const shoulderX = hasAuthoredShoulder ? shoulder.x : record.base.position.x; // Legacy rig fallback stays in its own socket frame.
      const shoulderY = hasAuthoredShoulder ? shoulder.y : record.base.position.y + reach * 0.82;
      const shoulderZ = hasAuthoredShoulder ? shoulder.z : record.base.position.z;
      const targetX = record.base.position.x + sign * reach * 0.14 * stretch; // Animated wrist target, always relative to native idle.
      const targetY = record.base.position.y + reach * (1.70 + 0.04 * Math.sin(progress * Math.PI * 4)) * stretch;
      const targetZ = record.base.position.z + height * 0.045 * stretch;
      const dx = targetX - shoulderX, dy = targetY - shoulderY, dz = targetZ - shoulderZ;
      const distance = Math.hypot(dx, dy, dz);
      const maxReach = reach * (1 - 0.06 * stretch); // Exact rest reach at onset; a slight elbow bend only during extension.
      const ratio = stretch > 0.000001 && distance > maxReach ? maxReach / distance : 1; // Clamp about the real shoulder, never an imagined wrist-relative origin.
      if (ratio < 1) constrainedHandSamples++;
      greatestWristReachFraction = Math.max(greatestWristReachFraction, distance * ratio / reach); // Mobile-readable bound for this species.
      socket.position.x = shoulderX + dx * ratio;
      socket.position.y = shoulderY + dy * ratio;
      socket.position.z = shoulderZ + dz * ratio;
      socket.rotateX?.(-0.28 * stretch);
      socket.rotateZ?.(sign * 0.13 * stretch);
      socket.visible = true;
      socket.updateMatrixWorld?.(true);
      record.applied.position.copy(socket.position);
      record.applied.quaternion.copy(socket.quaternion);
      record.applied.visible = socket.visible;
      applied = true;
    }
    if (applied) handApplications++;
    return applied;
  }

  function ensureSentinel() {
    const mesh = playerMesh(), THREE = window.THREE;
    if (!mesh?.add || !THREE?.Mesh || !THREE?.BufferGeometry) return;
    if (sentinelParent === mesh && sentinel?.parent === mesh) return;
    sentinel?.parent?.remove?.(sentinel);
    sentinel?.geometry?.dispose?.();
    sentinel?.material?.dispose?.();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.0001, 0, 0, 0, 0.0001, 0], 3));
    const material = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false });
    material.colorWrite = false;
    sentinel = new THREE.Mesh(geometry, material);
    sentinel.name = 'player_yawn_stretch_final_hand_pose';
    sentinel.frustumCulled = false;
    sentinel.renderOrder = -99985; // Just after the -100000 normal hand driver and -99990 dance presentation.
    sentinel.onBeforeRender = () => { if (entry) { suppressHeldVisuals(); syncHandOwnership(); applyStretch(); } };
    mesh.add(sentinel);
    sentinelParent = mesh;
  }

  function isPortraitPlane(node) {
    if (!node?.isMesh) return false;
    const name = String(node.name || '').toLowerCase();
    return !!node.userData?.hobunjiPlaneFace || name.includes('front_plane') || name.includes('back_plane')
      || (name.includes('avatar') && name.includes('plane'));
  }

  const planes = new WeakSet(); // One wrapper per portrait plane keeps the body compositor visible with autoUpdate disabled.
  function hookPortraitPlanes() {
    playerMesh()?.traverse?.(node => {
      if (!isPortraitPlane(node) || planes.has(node)) return;
      planes.add(node);
      const before = typeof node.onBeforeRender === 'function' ? node.onBeforeRender : null;
      node.onBeforeRender = function playerYawnBodyMatrixSync(...args) {
        if (entry) this.updateWorldMatrix?.(true, false);
        return before?.apply(this, args);
      };
    });
  }

  function patchComposer() {
    const composer = window.PlayerBodyTransformComposer;
    if (!composer?.setChannel || composer.setChannel.__playerYawnStretchWrapped) return;
    const original = composer.setChannel.bind(composer);
    composer.setChannel = function playerYawnExcludeWeaponIdle(name, contribution) {
      if (entry && name === WEAPON_IDLE_CHANNEL) { composer.clearChannel?.(name); return false; }
      return original(name, contribution);
    };
    composer.setChannel.__playerYawnStretchWrapped = true;
  }

  function start(activeYawn) {
    if (!activeYawn?.isPlayer) return false;
    if (entry === activeYawn) return true; // A duplicate wake event must not acquire a second lock or resnapshot hidden items.
    if (entry) end(entry);
    entry = activeYawn;
    progress = 0;
    constrainedHandSamples = 0; greatestWristReachFraction = 0; authoredShoulderSamples = 0; // Reset per-yawn reach/anchor diagnostics.
    yawnLock = window.CharacterActionLocks?.acquire?.({
      owner: OWNER, reason: 'five-second player yawn and stretch',
      participants: [{ id: 'player', channels: ['tools', 'actions'] }],
    }) || null; // The player may still walk at 25% speed; selection never changes.
    try { patchComposer(); suppressHeldVisuals(); syncHandOwnership(); captureShoulderAnchors(); ensureSentinel(); hookPortraitPlanes(); }
    catch (error) { lastError = String(error?.stack || error); }
    return true;
  }

  function update(activeYawn, t) {
    if (!entry || entry !== activeYawn) return false;
    progress = clamp01(t);
    try { patchComposer(); suppressHeldVisuals(); syncHandOwnership(); captureShoulderAnchors(); ensureSentinel(); }
    catch (error) { lastError = String(error?.stack || error); }
    return true;
  }

  function end(activeYawn) {
    if (entry !== activeYawn) return;
    restoreHandPose();
    releaseHandOwnership();
    shoulderAnchors.left = null; shoulderAnchors.right = null; // No prior yawn's shoulder samples survive cleanup.
    entry = null;
    progress = 0;
    yawnLock?.release?.();
    yawnLock = null;
    restoreHeldVisuals();
  }

  window.PlayerYawnStretchPresentation = Object.freeze({
    version: 1, start, update, end, actionBlocked,
    debugSnapshot: () => ({
      active: !!entry, progress, hasHandRig: !!handRig, sentinelAttached: !!sentinel?.parent,
      handApplications, constrainedHandSamples, greatestWristReachFraction, authoredShoulderSamples, neutralHandPoseOwned: !!ownedHandRig, hiddenHeldRoots: hidden.size, actionLocked: !!yawnLock, lastError,
    }),
    _test: Object.freeze({ applyStretch, suppressHeldVisuals, restoreHandPose, heldRoots }),
  });
})();

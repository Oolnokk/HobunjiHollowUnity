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
  let entry = null; // The active player yawn from NpcYawnRest, or null outside its five-second window.
  let yawnLock = null; // Blocks weapon/tool actions without stopping walking or changing the equipped selection.
  let sentinel = null; // Invisible pre-render mesh that runs after the ordinary procedural hand driver.
  let sentinelParent = null; // Tracks avatar replacement so the sentinel never persists on an old player mesh.
  let handRig = null; // The existing player procedural hand rig, reused rather than creating new hands.
  let progress = 0; // Five-second normalized yawn clock, read by the final-render hand pose.
  let handApplications = 0; // Mobile-readable count of successful final-render stretch samples.
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
        && actor.channels?.some(channel => channel === 'tools' || channel === 'actions' || channel === 'pose'));
    });
  }

  function discoverHandRig() {
    const avatar = entry?.walker?.avatarGroup;
    const mesh = playerMesh();
    let found = avatar?.userData?.proceduralHandRig || null;
    if (!found) mesh?.traverse?.(node => {
      if (!found && node?.userData?.proceduralHandRig) found = node.userData.proceduralHandRig;
    });
    if (handRig !== found) { restoreHandPose(); handRig = found; handBase.clear(); }
    return handRig;
  }

  function samePose(actual, expected) {
    return Math.abs(actual.position.x - expected.position.x) < 0.00001
      && Math.abs(actual.position.y - expected.position.y) < 0.00001
      && Math.abs(actual.position.z - expected.position.z) < 0.00001
      && Math.abs(actual.quaternion.x - expected.quaternion.x) < 0.00001
      && Math.abs(actual.quaternion.y - expected.quaternion.y) < 0.00001
      && Math.abs(actual.quaternion.z - expected.quaternion.z) < 0.00001
      && Math.abs(actual.quaternion.w - expected.quaternion.w) < 0.00001;
  }

  function restoreHandPose() {
    for (const record of handBase.values()) {
      if (!samePose(record.socket, record.applied)) continue;
      record.socket.position.copy(record.base.position);
      record.socket.quaternion.copy(record.base.quaternion);
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
    let applied = false;
    for (const side of ['left', 'right']) {
      if (entry.komaStarted && side === 'right') continue; // Keep the real Koma-chewing hand on its authored leaf grip; stretch the free arm.
      const socket = handRig.group.getObjectByName?.(side + '_hand_socket');
      if (!socket?.position || !socket?.quaternion) continue;
      let record = handBase.get(side);
      if (!record || record.socket !== socket) {
        record = { socket,
          base: { position: socket.position.clone(), quaternion: socket.quaternion.clone() },
          applied: { position: socket.position.clone(), quaternion: socket.quaternion.clone() } };
        handBase.set(side, record);
      } else if (!samePose(socket, record.applied)) {
        record.base.position.copy(socket.position);
        record.base.quaternion.copy(socket.quaternion); // The native gait/hand driver supplied a new neutral pose this pass.
      }
      socket.position.copy(record.base.position);
      socket.quaternion.copy(record.base.quaternion);
      const sign = side === 'left' ? -1 : 1;
      const reach = Math.max(0.1, Number(handRig.armLengthForSide?.(side)) || height * 0.29);
      socket.position.x += sign * reach * 0.15 * stretch;
      socket.position.y += reach * (1.76 + 0.10 * Math.sin(progress * Math.PI * 4)) * stretch;
      socket.position.z += height * 0.045 * stretch;
      socket.rotateX?.(-0.28 * stretch);
      socket.rotateZ?.(sign * 0.13 * stretch);
      socket.visible = true;
      socket.updateMatrixWorld?.(true);
      record.applied.position.copy(socket.position);
      record.applied.quaternion.copy(socket.quaternion);
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
    sentinel.onBeforeRender = () => { if (entry) { suppressHeldVisuals(); applyStretch(); } };
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
    yawnLock = window.CharacterActionLocks?.acquire?.({
      owner: OWNER, reason: 'five-second player yawn and stretch',
      participants: [{ id: 'player', channels: ['tools', 'actions'] }],
    }) || null; // The player may still walk at 25% speed; selection never changes.
    try { patchComposer(); suppressHeldVisuals(); discoverHandRig(); ensureSentinel(); hookPortraitPlanes(); }
    catch (error) { lastError = String(error?.stack || error); }
    return true;
  }

  function update(activeYawn, t) {
    if (!entry || entry !== activeYawn) return false;
    progress = clamp01(t);
    try { patchComposer(); suppressHeldVisuals(); ensureSentinel(); if (!handRig) discoverHandRig(); }
    catch (error) { lastError = String(error?.stack || error); }
    return true;
  }

  function end(activeYawn) {
    if (entry !== activeYawn) return;
    restoreHandPose();
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
      handApplications, hiddenHeldRoots: hidden.size, actionLocked: !!yawnLock, lastError,
    }),
    _test: Object.freeze({ applyStretch, suppressHeldVisuals, restoreHandPose, heldRoots }),
  });
})();

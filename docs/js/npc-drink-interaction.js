// Synchronized held-bottle handoff and NPC drink playback.
//
// This module owns interaction timing, transfer objects, action locks, effect
// timing, and cleanup. game.js supplies narrow adapters for its private player
// held-item/tool state and advances update(dt) from the normal game loop.
(() => {
  'use strict';

  const HANDOFF_DURATION_S = 0.34;
  const activeInteractions = new Set(); // Advanced by update() and exposed through getDebug().
  const ambientCarries = new Map(); // Reuses the drink-neutral bottle pose for persistent NPC-held bottles such as Tooth's nighttime carry.
  let deps = null; // Populated once by init() with game-owned rendering/state adapters.

  function log(message, level = 'items') {
    deps?.log?.(`[held-item] ${message}`, level);
  }

  function npcParticipantId(walker) {
    return deps?.npcParticipantId?.(walker?.rec?.id) || `npc:${walker?.rec?.id || 'unknown'}`;
  }

  function npcHandAnchor(walker) {
    const avatar = walker?.avatarGroup;
    const width = Number(avatar?.userData?.portraitModelWidth) || 1;
    const height = Number(avatar?.userData?.portraitModelHeight) || 1;
    return {
      x: Number.isFinite(Number(avatar?.userData?.handAttachX)) ? Number(avatar.userData.handAttachX) : -width / 2,
      y: Number.isFinite(Number(avatar?.userData?.handAttachY)) ? Number(avatar.userData.handAttachY) : height / 2,
    };
  }

  function applyHolderPose(interaction, pose) {
    const { THREE } = deps;
    const { holder, bottlePlane, hand, poseQuaternion } = interaction;
    holder.position.set(hand.x + pose.x, hand.y + pose.y, pose.z);
    holder.scale.setScalar(0.5);
    poseQuaternion.yaw.setFromAxisAngle(poseQuaternion.up, THREE.MathUtils.degToRad(pose.yaw));
    poseQuaternion.pitch.setFromAxisAngle(poseQuaternion.right, THREE.MathUtils.degToRad(pose.pitch));
    poseQuaternion.roll.setFromAxisAngle(poseQuaternion.forward, THREE.MathUtils.degToRad(pose.roll));
    holder.quaternion.copy(poseQuaternion.yaw).multiply(poseQuaternion.pitch).multiply(poseQuaternion.roll);
    if (bottlePlane) bottlePlane.rotation.x = Math.PI / 2;
  }

  function makePoseQuaternion(THREE) {
    return {
      up: new THREE.Vector3(0, 1, 0), right: new THREE.Vector3(1, 0, 0), forward: new THREE.Vector3(0, 0, 1),
      yaw: new THREE.Quaternion(), pitch: new THREE.Quaternion(), roll: new THREE.Quaternion(),
    };
  }

  function disposeAmbientCarry(carry) {
    if (!carry) return;
    carry.holder?.parent?.remove?.(carry.holder);
    deps?.disposeBottlePlane?.(carry.bottlePlane, carry.holder);
  }

  function clearAmbientCarry(ownerId) {
    const key = String(ownerId || '');
    const carry = ambientCarries.get(key);
    if (!carry) return false;
    disposeAmbientCarry(carry);
    ambientCarries.delete(key);
    return true;
  }

  function clearAmbientCarryForRoot(root) {
    if (!root) return;
    for (const [key, carry] of ambientCarries) {
      if (carry.root !== root) continue;
      disposeAmbientCarry(carry);
      ambientCarries.delete(key);
    }
  }

  function hasActiveInteractionForRoot(root) {
    if (!root) return false;
    for (const interaction of activeInteractions) {
      if (!interaction.finished && interaction.walker?.root === root) return true;
    }
    return false;
  }

  function setAmbientCarry({ ownerId, root, avatarGroup, itemKey, enabled = true } = {}) {
    const key = String(ownerId || '');
    if (!key) return false;
    if (!enabled || !deps || !root?.isObject3D || !avatarGroup?.isObject3D || !itemKey) {
      clearAmbientCarry(key);
      return false;
    }
    // An actual offered-drink interaction owns the same hand while it runs.
    // Suppress the ambient prop rather than rendering two bottles at once.
    if (hasActiveInteractionForRoot(root)) {
      clearAmbientCarry(key);
      return false;
    }

    let carry = ambientCarries.get(key);
    if (carry && (carry.root !== root || carry.avatarGroup !== avatarGroup || carry.itemKey !== itemKey)) {
      disposeAmbientCarry(carry);
      ambientCarries.delete(key);
      carry = null;
    }

    // Already attached to this exact root/avatarGroup/item — the hand anchor
    // (static portrait userData) and neutral pose (frame 0 of the drink
    // animation) can't have changed since creation, so there's nothing left
    // to recompute here. Callers may invoke this every frame; only the first
    // call after a real change (or the initial attach, below) does any work.
    if (carry) return true;

    const animation = deps.getDrinkAnimation?.();
    const itemDef = deps.getItemDef?.(itemKey);
    const neutralPose = animation ? deps.poseAt?.(animation, 0) : null;
    if (!animation || !itemDef || !neutralPose) {
      clearAmbientCarry(key);
      return false;
    }

    const { THREE } = deps;
    const holder = new THREE.Group(); // Persistent local-space bottle holder; posed once below against the hand anchor, which doesn't move while attached.
    holder.name = `npc_ambient_drink_holder_${key}`;
    const bottlePlane = deps.makeBottlePlane?.({ key: itemKey, icon: itemDef.icon, label: itemDef.label });
    if (!bottlePlane) return false;
    holder.add(bottlePlane);
    root.add(holder);
    carry = {
      ownerId: key,
      root,
      avatarGroup,
      itemKey,
      holder,
      bottlePlane,
      hand: npcHandAnchor({ avatarGroup }),
      poseQuaternion: makePoseQuaternion(THREE),
    };
    ambientCarries.set(key, carry);
    applyHolderPose(carry, neutralPose);
    log(`NPC ambient bottle start: owner=${key} item=${itemKey}`);
    return true;
  }

  function applyDrinkEffect(interaction) {
    if (interaction.effectApplied) return;
    interaction.effectApplied = true;
    try {
      interaction.onDrink?.();
    } catch (error) {
      log(`NPC drink effect failed: ${error?.message || error}`, 'warn');
    }
  }

  function finish(interaction, reason = 'complete') {
    if (!interaction || interaction.finished) return;
    interaction.finished = true;
    if (reason === 'complete') applyDrinkEffect(interaction);
    interaction.walker.root.rotation.y = interaction.baseNpcFacing;
    interaction.holder.parent?.remove(interaction.holder);
    deps?.disposeBottlePlane?.(interaction.bottlePlane, interaction.holder);
    interaction.lockHandle?.release?.();
    activeInteractions.delete(interaction);
    deps?.setPlayerHeldItemVisible?.(true);
    deps?.refreshActionBar?.();
    log(`NPC drink ${reason}: npc=${interaction.walker.rec?.id || 'unknown'} item=${interaction.itemKey}`);
  }

  function canPlay(walker, itemKey) {
    if (!deps || !walker?.root || !itemKey || walker.area !== deps.getCurrentArea?.()) return false;
    const locks = deps.actionLocks;
    return !locks?.isLocked?.(deps.playerParticipantId, 'actions')
      && !locks?.isLocked?.(npcParticipantId(walker), 'actions');
  }

  function play(walker, itemKey, onDrink) {
    const animation = deps?.getDrinkAnimation?.();
    const itemDef = deps?.getItemDef?.(itemKey);
    const activeScene = deps?.getActiveScene?.();
    if (!animation || !itemDef || !activeScene || !canPlay(walker, itemKey)) return 0;

    clearAmbientCarryForRoot(walker.root);
    const durationS = Math.max(0.1, Number(animation.durationS) || 0.95);
    const totalDurationMs = Math.round((HANDOFF_DURATION_S + durationS) * 1000);
    const lockHandle = deps.actionLocks?.acquire?.({
      owner: 'npc-drink-interaction',
      reason: `offer ${itemKey} to ${walker.rec?.id || 'npc'}`,
      participants: [deps.playerParticipantId, npcParticipantId(walker)],
      channels: ['movement', 'tools', 'actions'],
    });
    if (!lockHandle) return 0;

    deps.cancelPlayerToolAnimation?.();
    const { THREE } = deps;
    const holder = new THREE.Group(); // Lives in scene space during handoff, then under the NPC during playback.
    holder.name = `npc_drink_holder_${walker.rec?.id || 'npc'}`;
    const bottlePlane = deps.makeBottlePlane?.({ key: itemKey, icon: itemDef.icon, label: itemDef.label });
    if (!bottlePlane) { lockHandle.release(); return 0; }
    holder.add(bottlePlane);

    const interaction = {
      walker, itemKey, holder, bottlePlane, lockHandle, onDrink,
      phase: 'handoff', elapsed: 0, durationS, effectApplied: false, finished: false,
      hand: npcHandAnchor(walker),
      baseNpcFacing: walker.root.rotation.y,
      startPosition: new THREE.Vector3(), targetPosition: new THREE.Vector3(),
      startQuaternion: new THREE.Quaternion(), targetQuaternion: new THREE.Quaternion(),
      startScale: new THREE.Vector3(), targetScale: new THREE.Vector3(),
      poseQuaternion: makePoseQuaternion(THREE),
    };

    const neutralPose = deps.poseAt(animation, 0);
    const sourceTransform = deps.getPlayerDrinkSourceTransform?.(itemKey, neutralPose);
    if (!sourceTransform) {
      deps.disposeBottlePlane?.(bottlePlane, holder);
      lockHandle.release();
      return 0;
    }
    interaction.startPosition.copy(sourceTransform.position);
    interaction.startQuaternion.copy(sourceTransform.quaternion);
    interaction.startScale.copy(sourceTransform.scale);

    const targetProbe = new THREE.Group(); // Resolves the NPC-local neutral hand pose into active-scene coordinates.
    walker.root.add(targetProbe);
    interaction.holder = targetProbe;
    interaction.bottlePlane = null;
    applyHolderPose(interaction, neutralPose);
    targetProbe.updateWorldMatrix(true, false);
    targetProbe.getWorldPosition(interaction.targetPosition);
    targetProbe.getWorldQuaternion(interaction.targetQuaternion);
    targetProbe.getWorldScale(interaction.targetScale);
    walker.root.remove(targetProbe);
    interaction.holder = holder;
    interaction.bottlePlane = bottlePlane;

    holder.position.copy(interaction.startPosition);
    holder.quaternion.copy(interaction.startQuaternion);
    holder.scale.copy(interaction.startScale);
    activeScene.add(holder);
    deps.setPlayerHeldItemVisible?.(false);
    activeInteractions.add(interaction);
    log(`NPC drink start: npc=${walker.rec?.id || 'unknown'} item=${itemKey} handoff=${HANDOFF_DURATION_S.toFixed(2)}s drink=${durationS.toFixed(2)}s`);
    return totalDurationMs;
  }

  function update(dt) {
    if (!deps) return;
    const step = Math.max(0, Number(dt) || 0);
    for (const interaction of [...activeInteractions]) {
      if (interaction.walker.area !== deps.getCurrentArea?.() || !interaction.walker.root.parent) {
        finish(interaction, 'cancelled');
        continue;
      }
      interaction.elapsed += step;
      if (interaction.phase === 'handoff') {
        const t = deps.clamp(interaction.elapsed / HANDOFF_DURATION_S, 0, 1);
        const eased = t * t * (3 - 2 * t);
        interaction.holder.position.lerpVectors(interaction.startPosition, interaction.targetPosition, eased);
        interaction.holder.quaternion.slerpQuaternions(interaction.startQuaternion, interaction.targetQuaternion, eased);
        interaction.holder.scale.lerpVectors(interaction.startScale, interaction.targetScale, eased);
        if (t >= 1) {
          interaction.holder.parent?.remove(interaction.holder);
          interaction.walker.root.add(interaction.holder);
          interaction.phase = 'drink';
          interaction.elapsed = 0;
          applyHolderPose(interaction, deps.poseAt(deps.getDrinkAnimation(), 0));
        }
        continue;
      }

      const animation = deps.getDrinkAnimation();
      const progress = deps.clamp(interaction.elapsed / interaction.durationS, 0, 1);
      const pose = deps.poseAt(animation, progress);
      applyHolderPose(interaction, pose);
      interaction.walker.root.rotation.y = interaction.baseNpcFacing + deps.THREE.MathUtils.degToRad(pose.bodyYaw);
      if (progress >= (Number(animation.strikeFrac) || 0.62)) applyDrinkEffect(interaction);
      if (progress >= 1) finish(interaction);
    }
  }

  function getDebug() {
    if (!deps) return [];
    return [...activeInteractions].map(interaction => ({
      npcId: interaction.walker.rec?.id || null,
      itemKey: interaction.itemKey,
      phase: interaction.phase,
      progress: interaction.phase === 'handoff'
        ? deps.clamp(interaction.elapsed / HANDOFF_DURATION_S, 0, 1)
        : deps.clamp(interaction.elapsed / interaction.durationS, 0, 1),
    }));
  }

  function getAmbientDebug() {
    return [...ambientCarries.values()].map(carry => ({
      ownerId: carry.ownerId,
      itemKey: carry.itemKey,
      holderName: carry.holder?.name || null,
      attached: !!carry.holder?.parent,
    }));
  }

  function init(injectedDeps) {
    for (const carry of ambientCarries.values()) disposeAmbientCarry(carry);
    ambientCarries.clear();
    deps = injectedDeps || null;
    return api;
  }

  const api = Object.freeze({ init, canPlay, play, update, getDebug, setAmbientCarry, clearAmbientCarry, getAmbientDebug });
  window.NpcDrinkInteraction = api;
})();

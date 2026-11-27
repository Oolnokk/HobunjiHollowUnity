// Direct held-item-to-hand frame driver.
//
// No arm solver participates. The right hand follows the held item's authored
// primary grip frame directly. If the active item has an enabled secondary grip
// in hand-tool-grips.js, the left hand follows that frame; otherwise it receives
// the procedural locomotion fallback. Free hands breathe subtly at idle and swing
// while walking. Attachment ownership always wins per side, so fallback motion
// never modifies a gripped hand. Hands never translate or rotate the tool.
(function (global) {
  'use strict';

  const hands = global.ProceduralHandAttachments;
  const profiles = global.HobunjiHandModelProfiles;
  const toolGrips = global.HobunjiHandToolGrips;
  const avatarApi = global.PNGPlaneAvatar;
  if (!hands?.attach || !profiles || !toolGrips || !avatarApi?.buildSinglePlaneAvatarModel) return;
  if (avatarApi.buildSinglePlaneAvatarModel.__hobunjiDirectHandDriverWrapped) return;

  const pending = new Set();
  const managed = new Set();
  const FALLBACK_REFERENCE_SPEED = 3.2; // Scene units/second that produce a full ordinary walking arm swing below.
  const FALLBACK_TELEPORT_SPEED = 24; // Scene units/second above which movement is treated as a snap, not a gait sample.
  let gameDeps = hands.gameDeps || null;
  let syncing = false;
  const handSyncPerf = { nonSweepSearchesAvoided: 0, visualPlaneSearches: 0, sharedSocketUses: 0 }; // Read by on-demand mobile hand diagnostics; updated only during real hand synchronization.

  function normalizeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function normalizeGender(value) {
    const gender = String(value || '').trim().toLowerCase();
    return gender === 'female' || gender === 'f' ? 'female' : 'male';
  }

  function identityFor(options = {}) {
    const source = options.appearance || options.profile?.appearance || options.profile?.fighter || {};
    return {
      speciesId: normalizeKey(options.speciesId || source.speciesId || source.species),
      gender: normalizeGender(options.gender || source.gender),
    };
  }

  function attachPending(record) {
    const avatarRoot = record.avatarRoot;
    if (!avatarRoot?.parent || avatarRoot.userData?.proceduralHandRig) return !!avatarRoot?.userData?.proceduralHandRig;
    const handParent = avatarRoot.userData?.proceduralHandParent || avatarRoot.parent; // Lets authoring previews attach hands to their floor-relative visual root instead of the lifted portrait group.
    const rig = hands.attach(record.THREE, handParent, {
      speciesId: record.speciesId,
      gender: record.gender,
      bodyColors: record.bodyColors,
      profile: record.profile,
      sourceCanvas: record.sourceCanvas,
      modelHeight: avatarRoot.userData?.portraitModelHeight,
      handAttachX: avatarRoot.userData?.handAttachX,
      handAttachY: avatarRoot.userData?.handAttachY,
      avatarRoot,
      name: record.name || avatarRoot.name || 'avatar',
      onHandVisualReplaced(side, visual) {
        const factor = Number(avatarRoot.userData?.hobunjiChildLimbVisualModifiers?.hand) || 1;
        if (factor > 0 && factor !== 1 && visual?.scale?.multiplyScalar) {
          visual.scale.multiplyScalar(factor); // Independent child NPCs get the same global hand modifier as the age lineup.
          visual.updateMatrix?.();
        }
        record.onHandVisualReplaced?.(side, visual); // Author-only callback rebinds final imported GLBs after their fallback has gone away.
      },
    });
    if (!rig) return false;
    avatarRoot.userData.proceduralHandRig = rig;
    record.rig = rig;
    managed.add(record);
    return true;
  }

  const originalBuild = avatarApi.buildSinglePlaneAvatarModel;
  const wrappedBuild = function directHandAvatarBuild(THREE, sourceCanvas, options = {}) {
    const avatarRoot = originalBuild.call(this, THREE, sourceCanvas, options);
    const identity = identityFor(options);
    if (!avatarRoot || !identity.speciesId || !profiles.modelKeyForSpecies(identity.speciesId)) return avatarRoot;
    pending.add({
      THREE,
      avatarRoot,
      sourceCanvas,
      profile: options.profile || null,
      speciesId: identity.speciesId,
      gender: identity.gender,
      bodyColors: options.profile?.bodyColors || options.appearance?.bodyColors || options.bodyColors,
      name: options.name,
      onHandVisualReplaced: options.onHandVisualReplaced, // Avatar construction may provide a low-frequency visual replacement callback.
      rig: null,
      syncSentinel: null,
      lastToolKey: null,
      lastVisualGripBasis: null,
      secondaryActive: false,
      fallback: null,
    });
    return avatarRoot;
  };
  wrappedBuild.__hobunjiDirectHandDriverWrapped = true;
  avatarApi.buildSinglePlaneAvatarModel = wrappedBuild;

  if (avatarApi.disposeAvatarModel && !avatarApi.disposeAvatarModel.__hobunjiDirectHandsWrapped) {
    const originalDispose = avatarApi.disposeAvatarModel.bind(avatarApi);
    avatarApi.disposeAvatarModel = function directHandAvatarDispose(avatarRoot) {
      for (const record of [...pending]) if (record.avatarRoot === avatarRoot) pending.delete(record);
      for (const record of [...managed]) {
        if (record.avatarRoot !== avatarRoot) continue;
        disposeSyncSentinel(record);
        record.rig?.dispose?.();
        managed.delete(record);
      }
      if (avatarRoot?.userData) avatarRoot.userData.proceduralHandRig = null;
      return originalDispose(avatarRoot);
    };
    avatarApi.disposeAvatarModel.__hobunjiDirectHandsWrapped = true;
  }

  function findEditorToolHolder(record) {
    const bodyRoot = record?.avatarRoot?.parent;
    if (!bodyRoot) return null;
    const searchRoots = [bodyRoot];
    if (bodyRoot.parent?.isObject3D) searchRoots.push(bodyRoot.parent); // Attack Editor keeps the CharacterRigScale-owned body one level below the unscaled weapon/body-yaw rig, matching gameplay ownership.
    for (const searchRoot of searchRoots) {
      for (const child of searchRoot.children || []) {
        if (child === record.avatarRoot || child === bodyRoot || child === record.rig?.group || child === record.syncSentinel) continue;
        const hasAnchorSphere = (child.children || []).some(candidate => candidate?.isMesh && candidate.geometry?.type === 'SphereGeometry');
        if (!hasAnchorSphere) continue;
        const holder = (child.children || []).find(candidate => !candidate?.isMesh && candidate?.isObject3D);
        if (holder) return holder;
      }
    }
    return null;
  }

  function inAttackEditor() {
    return /\/tools\/attack-animation-editor\//.test(location.pathname);
  }

  function inHandCalibrationMode() {
    return inAttackEditor() && global.HobunjiAttackEditorHandCalibrationMode?.active === true; // Dedicated editor tab bypasses every animation/tool/shoulder-derived hand transform.
  }

  function playerFluteTarget(record) {
    if (inAttackEditor() || !gameDeps?.playerMesh || record?.rig?.parent !== gameDeps.playerMesh) return null;
    return global.KurrayaInstrument?.fluteHandTarget?.() || null; // Match the actual mouth-mounted flute rather than a stale weapon-slot holder.
  }

  function playerKurrayaActive(record) {
    return !inAttackEditor() && !!gameDeps?.playerMesh
      && record?.rig?.parent === gameDeps.playerMesh
      && global.KurrayaInstrument?.activePlayerInstrument?.() === 'kurraya'; // Only the player can release their right hand to pluck; no diagnostic allocations per frame.
  }
  function playerKurrayaTarget(record) {
    if (inAttackEditor() || !gameDeps?.playerMesh || record?.rig?.parent !== gameDeps.playerMesh) return null;
    return global.KurrayaInstrument?.playerKurrayaHandTarget?.() || null; // Authored Neutral can grip a visible bag Kurraya before music starts.
  }
  function freeRightHandFor(record, toolKey) {
    if (inAttackEditor()) return global.HobunjiAttackEditorRightHand?.currentPose?.() || null;
    const npcAuthored = record?.avatarRoot?.userData?.proceduralHandFreeRightPose; // Musician carries the real authored right-hand pluck pose, not the player's singleton session.
    if (toolKey === 'kurraya' && record?.avatarRoot?.userData?.proceduralHandToolHolder?.parent && npcAuthored) return npcAuthored;
    return toolKey === 'kurraya' && (playerKurrayaActive(record) || !!playerKurrayaTarget(record))
      ? global.KurrayaInstrument?.playerRightHandPose?.() || null : null; // Keep the independent free hand in authored Neutral while carrying Kurraya, between and after notes.
  }
  function currentToolKey(record = null) {
    const ownedKey = record?.avatarRoot?.userData?.proceduralHandToolKey; // Hostile/NPC avatar roots can name their own held item without leaking through the player-singleton stance state.
    if (ownedKey) return toolGrips.toolKeyFor(ownedKey);
    if (inAttackEditor()) {
      return toolGrips.toolKeyFor(document.getElementById('toolSpriteSelect')?.value || '');
    }
    const flute = playerFluteTarget(record); // Live instrument playback owns the player's hand grip while a note is sounding.
    if (flute) return toolGrips.toolKeyFor(flute.toolKey);
    if (playerKurrayaActive(record) || playerKurrayaTarget(record)) return 'kurraya'; // Playing OR simply carrying Kurraya uses its own editor-authored grips, not the previous weapon.
    const snapshot = global.WeaponToolStances?.getRuntimeState?.() || global.WeaponToolStances?.debugSnapshot?.() || null;
    return toolGrips.toolKeyFor(snapshot?.itemKey || snapshot?.shape || '');
  }

  function currentGripContext(record = null) {
    const ownedContext = record?.avatarRoot?.userData?.proceduralHandGripContext; // Hostile tool owners explicitly select melee/ranged instead of inheriting the player's active slot.
    if (ownedContext === 'ranged' || ownedContext === 'melee') return ownedContext;
    const flute = playerFluteTarget(record); // The supplied flute hand calibration is the Ranged grip, not Melee.
    if (flute) return flute.gripContext;
    if (playerKurrayaActive(record) || playerKurrayaTarget(record)) return 'melee'; // Same nut-to-bridge grip frame while carried or performed.
    if (typeof toolGrips.currentGripContext === 'function') return toolGrips.currentGripContext();
    if (inAttackEditor()) return document.getElementById('handGripContextSelect')?.value === 'ranged' ? 'ranged' : 'melee';
    const snapshot = global.WeaponToolStances?.getRuntimeState?.() || global.WeaponToolStances?.debugSnapshot?.() || null;
    return snapshot?.activeSlot === 'ranged' ? 'ranged' : 'melee';
  }

  function currentToolHolder(record) {
    if (inAttackEditor()) return findEditorToolHolder(record);
    const ownedHolder = record?.avatarRoot?.userData?.proceduralHandToolHolder; // Shared humanoid hostiles publish the exact animated holder their final-render hands must follow.
    if (ownedHolder?.parent) return ownedHolder;
    const flute = playerFluteTarget(record); // Actual holder comes from the mouth mount and follows head-relative pose changes.
    if (flute) return flute.holder;
    const kurrayaTarget = playerKurrayaTarget(record); // The actual held assembly is the tool-space grip authority, including authored Neutral.
    if (playerKurrayaActive(record) || kurrayaTarget) {
      return kurrayaTarget?.holder || null; // While the music prop loads, do not borrow a hidden last-weapon holder.
    }
    if (gameDeps?.playerMesh && record.rig?.parent === gameDeps.playerMesh) {
      if (global.KurrayaInstrument?.fluteDiagnostics?.().active) return null; // The flute is loading: keep hands idle rather than grabbing the last weapon.
      return gameDeps.toolHolder || null;
    }
    return null;
  }

  // Bag items (potions, flasks, large carried objects) live on game.js's heldItemHolder, not
  // toolHolder, so the player's hands used to fall back to free-hand idle while holding them.
  function heldItemTarget(record) {
    if (inAttackEditor()) return null;
    if (gameDeps?.playerMesh && record?.rig?.parent === gameDeps.playerMesh
        && (playerKurrayaActive(record) || playerKurrayaTarget(record) || global.KurrayaInstrument?.fluteDiagnostics?.().active)) return null; // A visible carried Kurraya owns Neutral hands even between music sessions; generic bags cannot replace its grip.
    const authoredHostileItem = record?.avatarRoot?.userData?.proceduralHeldItemTarget; // Enemy-carried physical Burdens use the same authored two-hand grip as player carryables.
    if (authoredHostileItem?.holder?.parent) return authoredHostileItem;
    if (record?.avatarRoot?.userData?.proceduralHandToolHolder) return null;
    const npcTarget = global.NpcDrinkInteraction?.heldItemTarget?.(record.rig?.parent); // Meals and ambient bottles share the existing world-space held-item grip solve.
    if (npcTarget) return npcTarget;
    if (!gameDeps?.playerMesh || record.rig?.parent !== gameDeps.playerMesh) return null;
    const carried = window.Shattercasks?.heldHandTarget?.();
    if (carried?.holder?.parent) return carried;
    if (gameDeps.toolHolder?.visible) return null;
    const target = gameDeps.getHeldItemHandTarget?.();
    return target?.holder?.visible ? target : null;
  }

  function modelKeyForRecord(record) {
    if (inAttackEditor()) {
      const editorModelKey = global.HobunjiAttackEditorHandContext?.currentModelKey?.();
      if (editorModelKey && profiles.data?.models?.[editorModelKey]) return editorModelKey;
    }
    return profiles.modelKeyForSpecies?.(record.speciesId) || null;
  }

  function modelCalibrationForRecord(record) {
    if (!inAttackEditor() && hands.modelCalibrationForSpecies) {
      return hands.modelCalibrationForSpecies(record.speciesId, record.gender,
        Number(record.avatarRoot?.userData?.portraitModelHeight) || .9);
    }
    const modelKey = modelKeyForRecord(record); // Single authoritative editor/runtime model identity used for both rendered GLB and calibration.
    const raw = profiles.normalizeHandTransform?.(profiles.data?.models?.[modelKey]?.handFromTool)
      || profiles.data?.models?.[modelKey]?.handFromTool
      || {};
    const p = raw.position || {};
    const r = raw.rotationDeg || {};
    const q = raw.rotationQuaternion || null;
    const modelHeight = Number(record.avatarRoot?.userData?.portraitModelHeight) || 0.9;
    const modelScale = Number(profiles.data?.models?.[modelKey]?.scale) || 1;
    const speciesScale = Number(profiles.speciesScaleFor?.(record.speciesId, record.gender)) || 1;
    const unit = modelHeight * (Number(profiles.data?.handHeightFraction) || 0.12) * modelScale * speciesScale;
    return {
      modelKey,
      position: {
        x: (Number(p.x) || 0) * unit,
        y: (Number(p.y) || 0) * unit,
        z: (Number(p.z) || 0) * unit,
      },
      rotationDeg: {
        pitch: Number(r.pitch) || 0,
        yaw: Number(r.yaw) || 0,
        roll: Number(r.roll) || 0,
      },
      rotationQuaternion: q && [q.x, q.y, q.z, q.w].every(value => Number.isFinite(Number(value)))
        ? { x: Number(q.x), y: Number(q.y), z: Number(q.z), w: Number(q.w) }
        : null,
    };
  }

  function gripModeTransformForRecord(record) {
    const mode = global.HobunjiHandGripModes?.currentMode?.() || {}; // Grip Mode belongs to the socket; GLB-specific handFromTool calibration now lives on the visual child owned by ProceduralHandAttachments.
    const p = mode.position || {};
    const r = mode.rotationDeg || {};
    const modelKey = modelKeyForRecord(record);
    const modelHeight = Number(record.avatarRoot?.userData?.portraitModelHeight) || 0.9;
    const modelScale = Number(profiles.data?.models?.[modelKey]?.scale) || 1;
    const speciesScale = Number(profiles.speciesScaleFor?.(record.speciesId, record.gender)) || 1;
    const unit = modelHeight * (Number(profiles.data?.handHeightFraction) || 0.12) * modelScale * speciesScale;
    return {
      position: {
        x: (Number(p.x) || 0) * unit,
        y: (Number(p.y) || 0) * unit,
        z: (Number(p.z) || 0) * unit,
      },
      rotationDeg: {
        pitch: Number(r.pitch) || 0,
        yaw: Number(r.yaw) || 0,
        roll: Number(r.roll) || 0,
      },
    };
  }

  function quaternionFromDeg(record, rotation = {}) {
    return new record.THREE.Quaternion().setFromEuler(new record.THREE.Euler(
      record.THREE.MathUtils.degToRad(Number(rotation.pitch) || 0),
      record.THREE.MathUtils.degToRad(Number(rotation.yaw) || 0),
      record.THREE.MathUtils.degToRad(Number(rotation.roll) || 0),
      'YXZ',
    ));
  }

  function quaternionFromAuthored(record, authored = {}) {
    const q = authored.rotationQuaternion;
    if (q && [q.x, q.y, q.z, q.w].every(value => Number.isFinite(Number(value)))) {
      return new record.THREE.Quaternion(Number(q.x), Number(q.y), Number(q.z), Number(q.w)).normalize();
    }
    return quaternionFromDeg(record, authored.rotationDeg || {});
  }

  function hierarchyWorldQuaternion(record, node, target = new record.THREE.Quaternion()) {
    const chain = record._handHierarchyChain || (record._handHierarchyChain = []); // Reused for each hand's ancestor walk, avoiding one array allocation per weapon/hand sync.
    chain.length = 0;
    for (let cursor = node; cursor?.isObject3D; cursor = cursor.parent) chain.push(cursor);
    target.identity();
    for (let i = chain.length - 1; i >= 0; i -= 1) target.multiply(chain[i].quaternion);
    chain.length = 0; // Release references to scene nodes between frames.
    return target.normalize();
  }

  function findToolVisualPlane(toolHolder) {
    let plane = null;
    toolHolder?.traverse?.(node => {
      if (!plane && node?.userData?.toolPlane?.isObject3D) plane = node.userData.toolPlane;
    });
    return plane;
  }

  // The visible weapon plane has a sweep-only child rotation that fades from the
  // neutral sprite basis into the -90° attack basis. Hands used to follow only
  // toolHolder, so that child-only visual correction made the apparent grip rotate
  // between Neutral/Windup/Strike even with shoulder aiming disabled. Preserve the
  // existing Neutral calibration and apply only the plane's delta-from-Neutral to
  // the hand socket frame.
  function visualGripBasisDelta(record, toolHolder) {
    const Quaternion = toolHolder.quaternion.constructor;
    const identity = new Quaternion();
    if (toolHolder.name === 'player_flute_mouth_mount') return { quaternion: identity, source: 'flute-mouth-mount', angleDeg: 0 }; // Never apply the previous weapon's sweep correction to the flute.
    const actorHolder = record?.avatarRoot?.userData?.proceduralHandToolHolder === toolHolder; // Bandits own a separate weapon pose; the player's stance snapshot cannot describe their grip.
    if (actorHolder) {
      const visibleMesh = toolHolder.children?.[0]; // Bandit's actual weapon child is mirrored across the owner's midline for a Backhand swing.
      const plane = visibleMesh?.userData?.toolPlane || findToolVisualPlane(toolHolder); // Read after the enemy pose/visual adapter has updated this weapon.
      const angle = Number(plane?.rotation?.z) || 0; // Enemy Neutral is z=0; a Sweep twists the blade as far as -90 degrees.
      const mirrorX = Number(visibleMesh?.scale?.x) < 0; // This reflection is not representable by a quaternion; mirror the socket offset separately.
      if (Math.abs(angle) < 1e-7) return { quaternion: identity, source: mirrorX ? 'actor-mirrored-neutral' : 'actor-neutral', angleDeg: 0, mirrorX };
      const delta = new Quaternion().setFromAxisAngle(new record.THREE.Vector3(0, 0, 1), angle);
      return { quaternion: delta, source: mirrorX ? 'actor-mirrored-sweep-plane' : 'actor-visible-sweep-plane', angleDeg: angle * 180 / Math.PI, mirrorX };
    }
    if (!inAttackEditor() && typeof playerKurrayaTarget === 'function' && playerKurrayaTarget(record)?.holder === toolHolder)
      return { quaternion: identity, source: 'kurraya-authored-basis', angleDeg: 0 }; // A previous weapon sweep must not rotate this thrust-style instrument's grip.

    // The sweep is the ONLY stance that rotates the visual plane's grip basis.
    // Decide that before traversing the weapon hierarchy: ordinary held tools,
    // ranged weapons and non-sweep attacks are the common case in large fights.
    const editor = inAttackEditor(); // Switches between the editor's authored rotation and the gameplay baked correction.
    const snapshot = editor ? null : (global.WeaponToolStances?.getRuntimeState?.() || global.WeaponToolStances?.debugSnapshot?.() || null); // Read once for this socket computation.
    const isSweep = editor
      ? String(document.getElementById('animStyle')?.value || '').toLowerCase() === 'sweep'
      : snapshot?.activeSlot === 'weapon'
        && (snapshot?.combatAnim === 'sweep' || (!snapshot?.combatAnim && snapshot?.sourceAnimStyle === 'sweep'));
    if (!isSweep) {
      handSyncPerf.nonSweepSearchesAvoided++;
      return { quaternion: identity, source: 'none', angleDeg: 0 };
    }

    handSyncPerf.visualPlaneSearches++;
    const plane = findToolVisualPlane(toolHolder);
    if (!plane?.rotation) return { quaternion: identity, source: 'none', angleDeg: 0 };

    const currentEuler = plane.rotation.clone();
    const neutralEuler = plane.rotation.clone();
    let source;
    if (editor) {
      // In the editor Neutral is z=0; the animated sweep basis is z=-90°..0°.
      neutralEuler.z = 0;
      source = 'editor-sweep-plane';
    } else {
      // WeaponToolStances adds this rotation only while drawing the weapon;
      // rebuild that rendered basis without changing the tool's local pose.
      const currentCompDeg = Number(snapshot?.sweepPlaneNeutralCompensationDeg);
      currentEuler.z += record.THREE.MathUtils.degToRad(Number.isFinite(currentCompDeg) ? currentCompDeg : 0);
      neutralEuler.z += Math.PI / 2;
      source = 'runtime-sweep-plane';
    }

    const currentQ = new Quaternion().setFromEuler(currentEuler);
    const neutralQ = new Quaternion().setFromEuler(neutralEuler);
    const delta = currentQ.multiply(neutralQ.invert()).normalize();
    const angleDeg = record.THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, Math.abs(delta.w))));
    return { quaternion: delta, source, angleDeg };
  }

  // In-game, WeaponToolStances applies the active idle/attack stance to
  // toolHolder only for the duration of its own updateMatrixWorld() call —
  // it bakes the stance into toolHolder.matrixWorld, then reverts toolHolder's
  // own LOCAL position/quaternion back to the plain aiming pose in a
  // `finally` (needed so a second updateMatrixWorld() call later the same
  // frame doesn't compound the stance delta onto itself). That means any of
  // Three.js's own world-space accessors (updateWorldMatrix/getWorldPosition/
  // localToWorld) called on toolHolder afterward recompute matrixWorld from
  // the already-reverted local values, silently discarding the stance: the
  // tool mesh itself still renders with the stance (its own matrixWorld was
  // baked earlier, during the same traversal, and nothing recomputes it
  // afterward), but hands following toolHolder through one of those
  // accessors would land on the neutral, un-stanced pose instead.
  // WeaponToolStances.lastHolderMatrixWorld() hands back the matrixWorld
  // actually baked this frame so hands read the same transform the tool
  // rendered with, without calling a recomputing accessor on toolHolder.
  function toolSocketWorld(record, toolHolder, gripFrame = null, sharedVisualBasis = null) {
    const Vector3 = toolHolder.position.constructor;
    const Quaternion = toolHolder.quaternion.constructor;
    const ownedHolder = record?.avatarRoot?.userData?.proceduralHandToolHolder; // Hostile/NPC records publish their own scene-root holder; only the player's holder is owned by WeaponToolStances' singleton baked-matrix cache.
    const playerOwnedHolder = !ownedHolder
      && !!gameDeps?.playerMesh
      && record.rig?.parent === gameDeps.playerMesh
      && toolHolder === gameDeps.toolHolder; // Prevents a hostile hand record from ever reading the player's last baked holder matrix.
    const bakedWorldMatrix = !inAttackEditor() && playerOwnedHolder
      ? global.WeaponToolStances?.lastHolderMatrixWorld?.()
      : null;

    const visualBasis = sharedVisualBasis || visualGripBasisDelta(record, toolHolder);
    if (sharedVisualBasis) handSyncPerf.sharedSocketUses++; // Counts sockets using the per-sync basis instead of repeating the hierarchy search.
    let position;
    // Used as the scale-free world orientation of the tool socket. The special
    // baked WeaponToolStances matrix is PLAYER-ONLY: hostile/NPC holders are
    // independently positioned in the scene and must resolve from their own
    // hierarchy, or their hands literally inherit the player's world position.
    let quaternion;
    if (bakedWorldMatrix) {
      quaternion = new Quaternion();
      position = new Vector3();
      bakedWorldMatrix.decompose(position, quaternion, new Vector3());
    } else {
      toolHolder.updateWorldMatrix?.(true, true);
      quaternion = hierarchyWorldQuaternion(record, toolHolder, new Quaternion());
    }
    const groundPose=global.HeldGroundPose; // Exact final sprite basis published by the clearance solver for this holder only.
    quaternion.multiply(groundPose?.gripBasisFor?.(toolHolder)||visualBasis.quaternion);
    if (gripFrame) {
      const rawPoint = gripFrame.position || {};
      const localOffset = new Vector3();
      if(!groundPose?.resolveGripLocal?.(toolHolder,rawPoint,localOffset)){
        const p = groundPose?.adjustGrip?.(toolHolder, rawPoint) || rawPoint; // Legacy unsupported geometry retains the longitudinal fit.
        localOffset.set(Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0).applyQuaternion(visualBasis.quaternion);
        if (visualBasis.mirrorX) localOffset.x = -localOffset.x; // Backhand reflects the entire weapon child after its sweep-plane twist.
      }
      if (bakedWorldMatrix) localOffset.applyMatrix4(bakedWorldMatrix);
      else toolHolder.localToWorld(localOffset);
      position = localOffset;
      quaternion.multiply(quaternionFromDeg(record, gripFrame.rotationDeg || {}));
    } else if (!bakedWorldMatrix) {
      position = toolHolder.getWorldPosition(new Vector3());
    }
    return { position, quaternion, visualBasis };
  }

  function handSocketAfterGripMode(record, socketFrame) {
    const Vector3 = socketFrame.position.constructor;
    const mode = gripModeTransformForRecord(record); // Only generic palm/shaft relationship is composed into the socket.
    const offset = new Vector3(mode.position.x, mode.position.y, mode.position.z)
      .applyQuaternion(socketFrame.quaternion);
    return {
      position: socketFrame.position.clone().add(offset),
      quaternion: socketFrame.quaternion.clone().multiply(quaternionFromDeg(record, mode.rotationDeg || {})),
      mode,
      visualBasis: socketFrame.visualBasis || null,
    };
  }

  function ensureFallbackState(record) {
    if (record.fallback) return record.fallback;
    const modelHeight = Math.max(0.1, Number(record.avatarRoot?.userData?.portraitModelHeight) || 0.9); // Scales fallback travel consistently across avatar sizes.
    record.fallback = {
      worldPosition: new record.THREE.Vector3(), // Previous parent-world sample used to infer locomotion without game-specific velocity hooks.
      samplePosition: new record.THREE.Vector3(), // Reused current parent-world sample to keep the per-frame fallback path allocation-free.
      hasWorldPosition: false,
      lastSampleMs: null,
      speed: 0,
      phase: 0,
      gaitStrength: 0,
      modelHeight,
      mode: 'idle',
      poses: { left: null, right: null },
      fallbackDefaults: { left: { position: {}, rotationDeg: {} }, right: { position: {}, rotationDeg: {} } }, // Reused as free-hand poses each frame; override providers retain their own separate objects.
      overridden: { left: false, right: false }, // Updated in place so the gameplay pose ownership check allocates nothing each frame.
      owners: { left: 'fallback-idle', right: 'fallback-idle' },
    };
    return record.fallback;
  }

  function damp(current, target, rate, dt) {
    return current + (target - current) * (1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt)));
  }

  const ARM_SWING_DEG = 38; // Peak forward/back arm swing about the shoulder.
  const ARM_LENGTH_FRACTION = 0.26; // Shoulder-to-wrist distance as a fraction of model height (the arc's radius).

  function fallbackPose(state, side, nowMs, target) {
    // The attachment rig reads these fields immediately and copies them into
    // sockets; reusing the per-actor buffers avoids six short-lived objects
    // for every pair of free hands on every browser frame.
    const pose = target || { position: {}, rotationDeg: {} }; // The caller supplies state-owned storage; the fallback keeps isolated preview invocations safe.
    const sidePhase = state.phase + (side === 'right' ? Math.PI : 0); // Opposes left/right swings for a natural alternating gait.
    const swing = Math.sin(sidePhase);
    const liftWave = Math.max(0, Math.cos(sidePhase));
    const idlePhase = nowMs * 0.0017 + (side === 'right' ? 0.28 : 0); // Slight phase split keeps idle hands from moving as a rigid pair.
    const idleBreath = Math.sin(idlePhase);
    const h = state.modelHeight;
    const gait = state.gaitStrength;
    const swingAngle = ARM_SWING_DEG * Math.PI / 180 * swing; // Arm swing about the shoulder: the hand's position and its pitch share this angle, so the arm turns as one piece.
    pose.position.x = 0;
    pose.position.y = h * 0.0045 * idleBreath * (1 - gait) + ARM_LENGTH_FRACTION * h * (1 - Math.cos(swingAngle)) * gait;
    pose.position.z = ARM_LENGTH_FRACTION * h * Math.sin(swingAngle) * gait + h * 0.003 * Math.cos(idlePhase) * (1 - gait);
    pose.rotationDeg.pitch = ARM_SWING_DEG * swing * gait + 2.5 * idleBreath * (1 - gait);
    pose.rotationDeg.yaw = (side === 'right' ? -1 : 1) * 3 * gait * Math.abs(swing);
    pose.rotationDeg.roll = (side === 'right' ? -1 : 1) * (5 * liftWave * gait + 1.5 * idleBreath * (1 - gait));
    return pose;
  }

  // Gameplay states (e.g. the downed crawl) can take over one free hand by
  // registering `HobunjiFreeHandPose.providers`: each provider(parent, side,
  // modelHeight, record) returns a fallback-shaped { position:{x,y,z}, rotationDeg } or
  // null. A claimed hand ignores held-item secondary/dual-wield grips so the
  // pose is never fought over; the other hand is untouched.
  function freeHandOverride(record, side, modelHeight) {
    const providers = global.HobunjiFreeHandPose?.providers;
    if (!providers?.size) return null;
    const parent = record.rig?.parent;
    for (const provider of providers.values()) {
      const pose = provider(parent, side, modelHeight, record);
      if (pose) return pose;
    }
    return null;
  }

  function updateFallbackMotion(record, nowMs = performance.now()) {
    const state = ensureFallbackState(record);
    const sample = record.rig?.parent?.getWorldPosition?.(state.samplePosition) || null; // Includes NPC ancestor movement even when the hand parent itself stays local.
    const elapsed = state.lastSampleMs == null ? 0 : Math.max(0, Math.min(0.1, (nowMs - state.lastSampleMs) / 1000));
    if (sample && state.hasWorldPosition && elapsed > 0.0001) {
      const rawSpeed = Math.hypot(sample.x - state.worldPosition.x, sample.z - state.worldPosition.z) / elapsed;
      const sampledSpeed = rawSpeed <= FALLBACK_TELEPORT_SPEED ? rawSpeed : 0; // Area transfers and spawn snaps must not create one-frame flailing.
      state.speed = damp(state.speed, sampledSpeed, sampledSpeed > state.speed ? 11 : 15, elapsed);
    } else if (elapsed > 0.0001) {
      state.speed = damp(state.speed, 0, 15, elapsed);
    }
    if (sample) {
      state.worldPosition.copy(sample);
      state.hasWorldPosition = true;
    }
    state.lastSampleMs = nowMs;

    const speedRatio = Math.max(0, Math.min(1.25, state.speed / FALLBACK_REFERENCE_SPEED));
    const targetStrength = state.speed > 0.035 ? Math.sqrt(speedRatio) : 0;
    state.gaitStrength = damp(state.gaitStrength, targetStrength, targetStrength > state.gaitStrength ? 9 : 13, elapsed);
    const fullStride = Math.max(state.modelHeight * (0.32 + 0.44 * Math.sqrt(speedRatio)), 0.12); // The legs' stride (procedural-leg-animation.js), so each arm swings once per leg cycle.
    const cadenceHz = state.speed > 0.035 ? Math.max(0.55, Math.min(3.2, state.speed * 0.62 / fullStride)) : 0;
    if (cadenceHz > 0 && elapsed > 0) state.phase = (state.phase + elapsed * cadenceHz * Math.PI * 2) % (Math.PI * 2);
    state.mode = state.gaitStrength > 0.04 ? 'walk' : 'idle';
    const defaults = state.fallbackDefaults ||= { left: { position: {}, rotationDeg: {} }, right: { position: {}, rotationDeg: {} } }; // Backwards-compatible lazy setup for externally supplied fallback state.
    state.poses.left = freeHandOverride(record, 'left', state.modelHeight) || fallbackPose(state, 'left', nowMs, defaults.left);
    state.poses.right = freeHandOverride(record, 'right', state.modelHeight) || fallbackPose(state, 'right', nowMs, defaults.right);
    const overridden = state.overridden ||= { left: false, right: false }; // Reused ownership flags for the next sync step.
    overridden.left = state.poses.left?.overridden === true;
    overridden.right = state.poses.right?.overridden === true;
    return state;
  }

  function applyFallbackSide(record, side) {
    const state = ensureFallbackState(record);
    record.rig?.setSideIdle?.(side, state.poses[side]);
    state.owners[side] = `fallback-${state.mode}`;
  }

  function applyFallbackBoth(record) {
    const state = ensureFallbackState(record);
    record.rig?.useIdlePose?.(state.poses);
    record.rig?.hidePaperHandGuideTarget?.(); // No raw weapon grip target exists while both hands are in fallback.
    state.owners.left = `fallback-${state.mode}`;
    state.owners.right = `fallback-${state.mode}`;
  }

  function syncCalibrationWorkspace(record, diagnostic = false) {
    if (!record?.rig?.placeCalibrationPreviewWorld) return null;
    const state = record._handCalibrationWorkspace ||= {
      worldPosition: new record.THREE.Vector3(), // Reused fixed preview origin so the calibration tab allocates nothing per frame.
      worldQuaternion: new record.THREE.Quaternion(), // Always identity: the paper reference is neutrally oriented in world space.
    };
    const modelHeight = Number(record.avatarRoot?.userData?.portraitModelHeight) || 0.9;
    record.rig.parent?.getWorldPosition?.(state.worldPosition);
    state.worldPosition.y += modelHeight * 0.52; // Stable chest-height workspace independent of tool/attack pose.
    state.worldQuaternion.identity();
    const modelCalibration = modelCalibrationForRecord(record);
    const placed = record.rig.placeCalibrationPreviewWorld(state.worldPosition, state.worldQuaternion, modelCalibration);
    if (!placed) return null;
    record.secondaryActive = false;
    record.lastToolKey = null;
    record.lastVisualGripBasis = null;
    ensureFallbackState(record).owners.right = 'glb-calibration';
    ensureFallbackState(record).owners.left = 'hidden-calibration';
    if (!diagnostic) return null;
    return {
      direct: true,
      calibrationWorkspace: true,
      neutralWorldQuaternion: true,
      bypassesAnimation: true,
      bypassesGripMode: true,
      bypassesShoulderAim: true,
      bypassesToolTarget: true,
      modelCalibration,
      paperHandReferenceFrame: 'fixed-neutral-world-frame',
    };
  }

  const HELD_LARGE_EDGE_MARGIN = 0.02; // Large items are gripped just outside their left/right edges.

  // Hands follow the held-item holder directly. Bottle: right hand on the neck (+Z of the
  // holder because the plane is laid flat end-for-end). Large: right/left hands on either side.
  // Runs for each hand every frame, so the vectors/quaternions it builds are reused (the sockets it hands
  // on are clones, so nothing retains them) and the fixed hand rotations are composed once per record.
  const HELD_ITEM_HAND_ROTATIONS = Object.freeze({
    bottle: { pitch: 90, yaw: -90, roll: 0 },
    right: { pitch: 0, yaw: -90, roll: 0 },
    left: { pitch: 0, yaw: 90, roll: 0 },
  });
  function heldItemScratch(record) {
    if (!record.heldItemScratch) {
      const THREE = record.THREE;
      record.heldItemScratch = {
        holderQuat: new THREE.Quaternion(),
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        rotations: Object.fromEntries(Object.entries(HELD_ITEM_HAND_ROTATIONS).map(([name, rotation]) => [name, quaternionFromDeg(record, rotation)])),
      };
    }
    return record.heldItemScratch;
  }

  // Move the HELD OBJECT and its grips together when a resting wrist would
  // fall below that character's measured shoulder-to-wrist reach. No arm IK,
  // hand-only clamp, or authored animation/GLB calibration is introduced.
  // Reuse the actual shoulder targets and rigger reach from the attached rig.
  function restoreHeldItemReach(record) {
    const scratch = record.heldItemScratch;
    const corrected=scratch?.clearanceHolder; // Undo the render-only floor correction before releasing the earlier reach lift.
    if(corrected){
      if(corrected.parent&&corrected.position.distanceToSquared(scratch.clearancePlaced)<1e-10&&Math.abs(corrected.quaternion.dot(scratch.clearancePlacedQ))>1-1e-10){
        corrected.position.copy(scratch.clearanceBase);
        corrected.quaternion.copy(scratch.clearanceBaseQ);
        corrected.updateWorldMatrix(true,true);
      }
      scratch.clearanceHolder=null; // Gameplay may already have replaced the pose (e.g. drink, throw, or note).
    }
    const holder = scratch?.reachHolder;
    if (!holder) return;
    // Gameplay may have authored a new holder pose since our last render.
    // Only undo the offset if the holder still has the position we set.
    if (holder.parent && holder.position.distanceToSquared(scratch.reachPlaced) < 1e-10) {
      holder.position.sub(scratch.reachApplied);
      holder.updateWorldMatrix(true, false);
    }
    scratch.reachHolder = null;
    scratch.reachApplied.set(0, 0, 0);
  }

  function liftHeldItemIntoReach(record, target, scratch) {
    restoreHeldItemReach(record); // Repeated pre-render and outline renders must never accumulate offsets.
    const holder = target?.holder;
    const rig = record.rig;
    const parent = rig?.parent;
    if (!holder?.parent || !parent || !rig.shoulderPositionLocal || !rig.armLengthForSide || inAttackEditor()) return;
    const THREE = record.THREE;
    scratch.reachShoulder ||= new THREE.Vector3(); // Current anatomical anchor used for held-item reach checks.
    scratch.reachGrip ||= new THREE.Vector3(); // Current held-item wrist in the hand parent's coordinate frame.
    scratch.reachGripOffset ||= new THREE.Vector3(); // Grip-mode palm offset applied before measuring reach.
    scratch.reachQuaternion ||= new THREE.Quaternion(); // Shared held-item rotation including canonical hand orientation.
    scratch.reachOrigin ||= new THREE.Vector3(); // Hand-parent origin in world space for transforming the lift.
    scratch.reachRaised ||= new THREE.Vector3(); // Raised hand-parent origin in world space.
    scratch.reachHolderOrigin ||= new THREE.Vector3(); // Unraised origin in the item's parent frame.
    scratch.reachHolderRaised ||= new THREE.Vector3(); // Raised origin in the item's parent frame.
    scratch.reachApplied ||= new THREE.Vector3(); // Last local displacement, reversible without changing gameplay's authored pose.
    scratch.reachPlaced ||= new THREE.Vector3(); // Last shifted holder position, used to detect external pose writes.
    holder.updateWorldMatrix(true, false);
    parent.updateWorldMatrix?.(true, false);
    hierarchyWorldQuaternion(record, holder, scratch.holderQuat);
    const mode = gripModeTransformForRecord(record)?.position || {};
    let lift = 0;
    let allowableLift = Infinity;
    let validHands = 0;
    for (const side of ['right', 'left']) {
      if (side === 'left' && target.mode !== 'large' && target.mode !== 'authored-world') continue;
      const reach = Number(rig.armLengthForSide(side));
      const shoulder = rig.shoulderPositionLocal(side, scratch.reachShoulder);
      if (!shoulder || !Number.isFinite(reach) || reach <= 0) continue;
      const hand = target.mode === 'authored-world' ? target.handTargets?.[side] || {} : null;
      const edge = (Number(target.width) || 0) / 2 + HELD_LARGE_EDGE_MARGIN;
      const x = hand ? Number(hand.x) || 0 : target.mode === 'large' ? (side === 'right' ? edge : -edge) : 0;
      const y = hand ? Number(hand.y) || 0 : 0;
      const z = hand ? Number(hand.z) || 0 : target.mode === 'large' ? 0 : (Number(target.height) || 0) * (Number(target.neckFraction) || 0.2);
      const rotationName = target.mode === 'large' || target.mode === 'authored-world' ? side : 'bottle';
      scratch.reachQuaternion.copy(scratch.holderQuat).multiply(scratch.rotations[rotationName]);
      if (hand) {
        const r = hand.rotation || {};
        scratch.authoredEuler ||= new THREE.Euler(0, 0, 0, 'XYZ');
        scratch.authoredQuaternion ||= new THREE.Quaternion();
        scratch.authoredEuler.set((Number(r.x) || 0) * Math.PI / 180,
          (Number(r.y) || 0) * Math.PI / 180, (Number(r.z) || 0) * Math.PI / 180, 'XYZ');
        scratch.reachQuaternion.multiply(scratch.authoredQuaternion.setFromEuler(scratch.authoredEuler));
      }
      holder.localToWorld(scratch.reachGrip.set(x, y, z));
      scratch.reachGripOffset.set(Number(mode.x) || 0, Number(mode.y) || 0, Number(mode.z) || 0)
        .applyQuaternion(scratch.reachQuaternion);
      scratch.reachGrip.add(scratch.reachGripOffset);
      parent.worldToLocal(scratch.reachGrip);
      const dx = scratch.reachGrip.x - shoulder.x;
      const dz = scratch.reachGrip.z - shoulder.z;
      const lateralSquared = dx * dx + dz * dz;
      if (lateralSquared >= reach * reach) continue; // An impossible sideways grip cannot be fixed by raising it.
      const verticalReach = Math.sqrt(reach * reach - lateralSquared);
      lift = Math.max(lift, shoulder.y - verticalReach - scratch.reachGrip.y);
      allowableLift = Math.min(allowableLift, shoulder.y + verticalReach - scratch.reachGrip.y);
      validHands++;
    }
    lift = validHands ? Math.max(0, Math.min(lift, allowableLift)) : 0;
    if (!(lift > 1e-6)) return;
    // Convert a +Y translation in the *hand parent* into the holder parent's
    // local axes. Works through player lean, NPC facing and non-uniform scaling.
    parent.localToWorld(scratch.reachOrigin.set(0, 0, 0));
    parent.localToWorld(scratch.reachRaised.set(0, lift, 0));
    scratch.reachHolderOrigin.copy(scratch.reachOrigin);
    scratch.reachHolderRaised.copy(scratch.reachRaised);
    holder.parent.worldToLocal(scratch.reachHolderOrigin);
    holder.parent.worldToLocal(scratch.reachHolderRaised);
    scratch.reachApplied.copy(scratch.reachHolderRaised).sub(scratch.reachHolderOrigin);
    holder.position.add(scratch.reachApplied);
    scratch.reachPlaced.copy(holder.position);
    scratch.reachHolder = holder;
    holder.updateWorldMatrix(true, false);
  }

  function applyCarryClearance(record,holder,root,context){
    const solver=global.HeldGroundPose;
    if(inAttackEditor()||!gameDeps?.playerMesh||record.rig?.parent!==gameDeps.playerMesh||!solver?.enabled?.()||!root)return false;
    const scratch=heldItemScratch(record);
    const T=record.THREE;
    scratch.clearanceBase||=new T.Vector3(); // Local authored position to restore before a subsequent action or render.
    scratch.clearanceBaseQ||=new T.Quaternion();
    scratch.clearancePlaced||=new T.Vector3();
    scratch.clearancePlacedQ||=new T.Quaternion();
    scratch.clearanceBase.copy(holder.position);scratch.clearanceBaseQ.copy(holder.quaternion);
    if(!solver.constrainCarry?.(holder,root,{...context,rig:record.rig}))return false;
    scratch.clearancePlaced.copy(holder.position);scratch.clearancePlacedQ.copy(holder.quaternion);
    scratch.clearanceHolder=holder;
    return true;
  }

  function constrainIdleHeldItem(record,target){
    if(target.groundPoseIdle!==true)return; // A drink, aimed throw or living carry must keep its explicit pose owner.
    const scratch=heldItemScratch(record);
    scratch.clearanceGrip||=new record.THREE.Vector3(); // Same exact socket coordinates as the placement below.
    scratch.clearanceOther||=new record.THREE.Vector3();
    scratch.clearanceGrips||=[scratch.clearanceGrip,scratch.clearanceOther];
    const grip=scratch.clearanceGrip,other=scratch.clearanceOther;
    let otherGrips=null;
    if(target.mode==='authored-world'){
      const right=target.handTargets?.right||{},left=target.handTargets?.left||{};
      grip.set(Number(right.x)||0,Number(right.y)||0,Number(right.z)||0);
      other.set(Number(left.x)||0,Number(left.y)||0,Number(left.z)||0);
      otherGrips=scratch.clearanceGrips;
    }else if(target.mode==='large'){
      const edge=target.width/2+HELD_LARGE_EDGE_MARGIN;
      grip.set(edge,0,0);other.set(-edge,0,0);
      otherGrips=scratch.clearanceGrips;
    }else grip.set(0,0,target.height*(Number(target.neckFraction)||0.2));
    applyCarryClearance(record,target.holder,target.plane||target.holder,{itemKey:target.itemKey,grip,otherGrips,preserveOrientation:target.mode!=='bottle'});
  }

  function syncRigToHeldItem(record, target) {
    const holder = target.holder;
    const scratch = heldItemScratch(record);
    liftHeldItemIntoReach(record, target, scratch);
    constrainIdleHeldItem(record,target); // Resolve the visible prop before either hand reads its socket.
    holder.updateWorldMatrix(true, false);
    const holderQuat = hierarchyWorldQuaternion(record, holder, scratch.holderQuat);
    const modelCalibration = modelCalibrationForRecord(record);
    const place = (side, x, y, z, rotationName) => {
      const position = holder.localToWorld(scratch.position.set(x, y, z));
      const quaternion = scratch.quaternion.copy(holderQuat).multiply(scratch.rotations[rotationName]);
      if (target.mode === 'authored-world') {
        // Local XYZ grip rotation comes AFTER the shared canonical left/right
        // hand orientation, matching the Furniture Editor's actual GLB preview.
        // This runs per hand per frame: reuse scratch instead of allocating
        // extra Euler/Quaternion objects during ordinary movement.
        const r = target.handTargets?.[side]?.rotation || {};
        scratch.authoredEuler ||= new record.THREE.Euler(0,0,0,'XYZ');
        scratch.authoredQuaternion ||= new record.THREE.Quaternion();
        scratch.authoredEuler.set(
          (Number(r.x)||0)*Math.PI/180,
          (Number(r.y)||0)*Math.PI/180,
          (Number(r.z)||0)*Math.PI/180, 'XYZ');
        quaternion.multiply(scratch.authoredQuaternion.setFromEuler(scratch.authoredEuler));
      }
      const socket = handSocketAfterGripMode(record, { position, quaternion, visualBasis: null });
      record.rig.placeHandWorld?.(side, socket.position, socket.quaternion, modelCalibration);
    };
    const owners = ensureFallbackState(record).owners;
    if (target.mode === 'authored-world') {
      for (const side of ['right', 'left']) {
        const p = target.handTargets?.[side] || {};
        place(side, Number(p.x)||0, Number(p.y)||0, Number(p.z)||0, side);
        owners[side]='authored-world-'+side;
      }
      record.secondaryActive=true;
    } else if (target.mode === 'large') {
      const edge = target.width / 2 + HELD_LARGE_EDGE_MARGIN;
      place('right', edge, 0, 0, 'right');
      place('left', -edge, 0, 0, 'left');
      owners.right = 'held-item-two-hand-right';
      owners.left = 'held-item-two-hand-left';
      record.secondaryActive = true;
    } else {
      place('right', 0, 0, target.height * (Number(target.neckFraction) || 0.2), 'bottle');
      applyFallbackSide(record, 'left');
      owners.right = 'held-item-bottle-neck';
      record.secondaryActive = false;
    }
    record.lastToolKey = null;
    record.lastVisualGripBasis = null;
  }

  // Only the player's eligible equipment needs an early clearance bake.
  // Other actors and editors retain their existing hand-sync workload.
  function prepareGroundPoseForSockets(record,toolHolder,toolKey,gripContext,scaleIdentity,dualWield,dualSolve) {
    const groundPose=global.HeldGroundPose;
    if(inAttackEditor()||!gameDeps?.playerMesh||record.avatarRoot?.userData?.proceduralHandToolHolder
      ||record.rig?.parent!==gameDeps.playerMesh||toolHolder!==gameDeps.toolHolder
      ||!groundPose?.enabled?.())return undefined;
    const stances=global.WeaponToolStances;
    const state=stances?.getRuntimeState?.();
    const slot=state?.activeSlot;
    if(!(stances?.groundPoseEligible?.(slot,state?.itemKey||toolKey,toolHolder)??(slot==='weapon'&&gripContext==='melee')))return undefined;
    const weaponDual=slot==='weapon'&&gripContext==='melee'; // Tool and ranged slots must never spawn weapon-only copies.
    const offhandIdle=!weaponDual||dualWield?null:(toolGrips.offhandIdleStateForTool?.(toolKey,gripContext,scaleIdentity)||null);
    // Dual sync can rebake the holder and move both visible copies. Do it
    // before either canonical socket, then reuse this one prepared result.
    if(weaponDual&&(dualWield||offhandIdle)){
      const visuals=global.HobunjiDualWieldWeaponVisuals;
      if(visuals?.syncNow){
        toolHolder.parent.updateWorldMatrix?.(true,false);
        dualSolve.dualWieldState=visuals.syncNow(record);
        dualSolve.dualWieldRecord=record;dualSolve.dualWieldSynced=true;dualSolve.clearancePrepared=true;
      }
    }
    // A single weapon without a dual helper may not have baked yet this
    // frame. Avoid another traversal when an earlier owner already did.
    if(!groundPose.hasCurrentGripPose?.(toolHolder)){
      toolHolder.parent.updateWorldMatrix?.(true,false);
      toolHolder.updateMatrixWorld?.(true);
    }
    return offhandIdle;
  }

  function syncRigToTool(record, toolHolder, diagnostic = false) {
    if (!record?.rig || !toolHolder?.parent || syncing) return null;
    if (!toolHolder.visible) {
      applyFallbackBoth(record);
      record.secondaryActive = false;
      record.lastToolKey = null;
      record.lastVisualGripBasis = null;
      return diagnostic ? { direct: true, toolVisible: false, secondaryActive: false } : null;
    }

    syncing = true;
    const dualSolve = {}; // One synchronous multi-hand solve: the dual-wield weapon pose is synced once for both hands.
    try {
      const toolKey = currentToolKey(record);
      const gripContext = currentGripContext(record);
      const scaleIdentity = { speciesId: record.speciesId, gender: record.gender, rigScaleY: Number(record.avatarRoot?.userData?.proceduralHandRigScaleY) || null }; // Authored per-enemy body height (Maskbound troops), so grip targets match the resized weapon. Used by grip targets so they expand with the same calculated-height weapon scale as the visible item.
      if (playerKurrayaActive(record)) {
        scaleIdentity.animationGripState = global.KurrayaInstrument?.playerGripAnimationState?.() || null; // Kurraya notes, not the last weapon swing, own 2H span interpolation.
      }
      if (record.avatarRoot?.userData?.proceduralHandToolHolder) {
        scaleIdentity.animationGripState = record.avatarRoot.userData.proceduralHandAnimationGrip ?? null; // Each NPC’s own animation gates both ranges; idle NPCs stay 1H.
      }
      const dualWield = toolGrips.dualWieldStateForTool?.(toolKey, gripContext, scaleIdentity) || null;
      const preparedOffhandIdle=prepareGroundPoseForSockets(record,toolHolder,toolKey,gripContext,scaleIdentity,dualWield,dualSolve);
      const primaryGrip = toolGrips.primaryGripForTool(toolKey, gripContext, scaleIdentity);
      const instrument=toolKey==='kurraya'?playerKurrayaTarget(record):null; // Only the silent, visible player instrument may use the carry correction.
      if(instrument?.groundPoseIdle&&instrument.holder===toolHolder){
        const secondary=toolGrips.secondaryGripForTool(toolKey,gripContext,scaleIdentity);
        applyCarryClearance(record,toolHolder,instrument.root,{itemKey:toolKey,grip:secondary?.position||primaryGrip?.position,preserveOrientation:true});
      }
      const visualBasis = visualGripBasisDelta(record, toolHolder); // The holder and its visual basis are stable throughout this synchronous multi-hand solve.
      const primarySocket = toolSocketWorld(record, toolHolder, primaryGrip, visualBasis); // Raw fixed 1H target remains the canonical weapon-grip reference before optional Dual Wield remapping.
      record.rig.placePaperHandGuideWorld?.(primarySocket.position, primarySocket.quaternion);
      let primary = handSocketAfterGripMode(record, primarySocket); // Preserve the ordinary raw-socket contract for 1H/2H and diagnostics.
      const freeHand = freeRightHandFor(record, toolKey); // A free note keyframe is avatar-local instead of attached to the instrument mesh.
      if (freeHand && freeHand.influence > 0.0001 && record.avatarRoot?.localToWorld) {
        const avatar = record.avatarRoot; // Editor 3D gizmos and capture use avatarModel-local XYZ, NOT the rig's parent. Avatar roots have a vertical portrait offset: using rig.parent here displaced every authored live hand.
        const handPosition = new record.THREE.Vector3(Number(freeHand.x)||0, Number(freeHand.y)||0, Number(freeHand.z)||0);
        avatar.localToWorld(handPosition);
        const handRotation = hierarchyWorldQuaternion(record, avatar, new record.THREE.Quaternion())
          .multiply(quaternionFromDeg(record, { pitch: freeHand.pitch, yaw: freeHand.yaw, roll: freeHand.roll }));
        const weight = Math.max(0, Math.min(1, freeHand.influence));
        primary.position.lerp(handPosition, weight); // Smoothly releases/grabs the normal grip at animation boundaries.
        primary.quaternion.slerp(handRotation, weight);
      }
      if (dualWield) {
        const dualPrimarySocket = global.HobunjiDualWieldWeaponVisuals?.transformSocketForHand?.(record, 'right', primarySocket, dualSolve) || primarySocket;
        primary = handSocketAfterGripMode(record, dualPrimarySocket); // Dual Wield alone remaps the same canonical grip onto the lagged main-hand weapon copy.
      }
      const modelCalibration = modelCalibrationForRecord(record);
      record.rig.placeHandWorld?.('right', primary.position, primary.quaternion, modelCalibration);
      const owners = ensureFallbackState(record).owners;
      owners.right = freeHand?.influence > 0.0001 ? 'avatar-local-free-right-hand' : 'primary-grip'; // Mobile-visible ownership exposes independent pluck mode.
      if (dualWield) owners.right = 'dual-wield-main-grip'; // Dual Wield refines that ownership to the lagged duplicate weapon.

      let secondaryGrip = null;
      const leftOverridden = ensureFallbackState(record).overridden?.left === true; // A gameplay pose owns the off hand: it neither mirrors a dual-wield weapon nor takes a two-hand grip.
      if (leftOverridden) {
        applyFallbackSide(record, 'left');
        record.secondaryActive = false;
        ensureFallbackState(record).owners.left = 'gameplay-pose';
      } else if (dualWield) {
        const offhandGrip = toolGrips.offhandPrimaryGripForTool?.(toolKey, gripContext, scaleIdentity) || primaryGrip; // Same authored 1H grip point, minus the main hand's palm-side offset: the offhand holds its copy from the other side.
        const offhandBaseSocket = toolSocketWorld(record, toolHolder, offhandGrip, visualBasis);
        const offhandSocket = global.HobunjiDualWieldWeaponVisuals?.transformSocketForHand?.(record, 'left', offhandBaseSocket, dualSolve) || offhandBaseSocket;
        const secondary = handSocketAfterGripMode(record, offhandSocket);
        // Reflected pairs use the anatomical mirror of the raw main grip, before either wrist is constrained.
        // Preserve the existing offhand position and the non-reflected authoring/legacy socket path.
        global.HobunjiDualWieldWeaponVisuals?.mirrorPairedWristOrientation?.(record, dualSolve, primary.quaternion, secondary.quaternion);
        record.rig.placeHandWorld?.('left', secondary.position, secondary.quaternion, modelCalibration, dualWield.influence);
        record.secondaryActive = true;
        ensureFallbackState(record).owners.left = 'dual-wield-offhand-grip';
      } else {
        secondaryGrip = toolGrips.secondaryGripForTool(toolKey, gripContext, scaleIdentity);
        if (secondaryGrip) {
          const secondary = handSocketAfterGripMode(record, toolSocketWorld(record, toolHolder, secondaryGrip, visualBasis));
          record.rig.placeHandWorld?.('left', secondary.position, secondary.quaternion, modelCalibration, secondaryGrip.influence);
          record.secondaryActive = true;
          ensureFallbackState(record).owners.left = 'secondary-grip';
        } else {
          // Not 2H and not Dual Wield: the free hand holds an INVISIBLE copy of the weapon at an authored offhand pose (default: the dual-wield
          // offhand stance) instead of falling back to the locomotion idle, which reads wrong once the legs bend. Enemies read it from their own animation grip.
          const offhandIdle=preparedOffhandIdle===undefined?toolGrips.offhandIdleStateForTool?.(toolKey,gripContext,scaleIdentity):preparedOffhandIdle;
          const offhandBaseSocket = offhandIdle ? toolSocketWorld(record, toolHolder, toolGrips.offhandPrimaryGripForTool?.(toolKey, gripContext, scaleIdentity) || primaryGrip, visualBasis) : null;
          const offhandSocket = offhandBaseSocket ? global.HobunjiDualWieldWeaponVisuals?.transformSocketForHand?.(record, 'left', offhandBaseSocket, dualSolve) : null;
          if (offhandSocket && offhandSocket !== offhandBaseSocket && offhandSocket.dualWield) {
            applyFallbackSide(record, 'left'); // The fallback is the other end of the blend: the invisible tool takes over as its weight rises.
            const idleHand = handSocketAfterGripMode(record, offhandSocket);
            record.rig.placeHandWorld?.('left', idleHand.position, idleHand.quaternion, modelCalibration, offhandIdle.blend);
            record.secondaryActive = true;
            ensureFallbackState(record).owners.left = 'offhand-idle-pose';
          } else {
            applyFallbackSide(record, 'left');
            record.secondaryActive = false;
          }
        }
      }
      record.lastToolKey = toolKey || null;
      record.lastVisualGripBasis = primary.visualBasis || null;

      // Frame/render callers discard the return value; only explicit syncNow
      // probes need the rich snapshot and deep copies of authored grips.
      if (!diagnostic) return null;
      return {
        direct: true,
        clamped: false,
        noArmIK: true,
        modelCalibrationOwnedByVisualChild: true,
        scaleFreeWorldQuaternion: true,
        toolKey: toolKey || null,
        gripContext,
        holderAuthority: record?.avatarRoot?.userData?.proceduralHandToolHolder ? 'actor-owned-world-transform' : 'player-weapon-stance-baked-matrix',
        gripMode: global.HobunjiHandGripModes?.currentModeKey?.() || null,
        primaryGrip: JSON.parse(JSON.stringify(primaryGrip)),
        secondaryActive: record.secondaryActive,
        dualWield: dualWield ? JSON.parse(JSON.stringify(dualWield)) : null,
        secondaryGrip: dualWield
          ? { mode: 'dual-wield', grip: JSON.parse(JSON.stringify(primaryGrip)), influence: dualWield.influence }
          : (secondaryGrip ? JSON.parse(JSON.stringify(secondaryGrip)) : null),
        authoredHandTransform: profiles.data?.models?.[modelCalibration.modelKey]?.handFromTool || null,
        modelCalibration,
        gripModeTransform: primary.mode,
        paperHandReferenceFrame: 'raw-primary-grip-before-grip-mode-and-hand-model-calibration',
        visualGripBasis: primary.visualBasis,
      };
    } finally {
      syncing = false;
    }
  }

  const originalInstallGameRuntime = hands.installGameRuntime?.bind(hands);
  if (originalInstallGameRuntime) {
    hands.installGameRuntime = function directHandGameRuntime(deps) {
      gameDeps = deps || null;
      return originalInstallGameRuntime(deps);
    };
  }

  function disposeSyncSentinel(record) {
    restoreHeldItemReach(record); // Release any visual lift when an avatar is discarded.
    const sentinel = record?.syncSentinel;
    if (!sentinel) return;
    sentinel.parent?.remove?.(sentinel);
    sentinel.geometry?.dispose?.();
    sentinel.material?.dispose?.();
    record.syncSentinel = null;
  }

  function ensureSyncSentinel(record) {
    if (!record?.rig?.parent || record.syncSentinel) return;
    const THREE = record.THREE;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      0.0001, 0, 0,
      0, 0.0001, 0,
    ], 3));
    geometry.setDrawRange(0, 0); // Three.js runs the pose callback before checking the draw range.
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false });
    material.colorWrite = false;
    const sentinel = new THREE.Mesh(geometry, material);
    sentinel.name = `${record.name || 'avatar'}_direct_hand_sync`;
    sentinel.frustumCulled = false;
    sentinel.renderOrder = -100000;
    sentinel.onBeforeRender = () => {
      // THREE.WebGLRenderer.prototype.render() is shared across every
      // renderer instance in the game (see combat-config-loader.js's
      // makeRendererPrototypeHookable), and fires more than once per real
      // browser frame — pixel-probe.js's diagnostic isolation renders and
      // farm-panel-core.js's house-layout preview renderer both render this
      // same live scene through it. player-body-attachment-bridge.js hit
      // the identical hazard for shoulder pets (see its frameId-memoized
      // fix) and it applies here too: poseAndSyncUpdate (pre-render phase)
      // already ran this exact sync once, authoritatively, before Three.js
      // traversal even starts, so only the first render() call this real
      // frame needs to repeat it — a later same-frame call would otherwise
      // redo the work, or read whatever transient toolHolder/stance state
      // that OTHER renderer's own pass left behind and stomp the correct
      // pose with it (visible as a one-frame hand pop).
      const frameId = global.RuntimeFrameScheduler?.frameId?.();
      if (frameId != null) record._lastRenderedFrameId = frameId; // Lets updateManagedRigs skip rigs nobody is drawing.
      // A draw-only placement moves the already-solved hand with its rig. Sampling
      // it here would teach the persistent hand solver the talon pose next frame.
      if (global.ActorRigCompositor?.renderPoseOwner?.(sentinel)) return;
      if (frameId != null && record._lastHandSyncFrameId === frameId) return;
      record._lastHandSyncFrameId = frameId;
      restoreHeldItemReach(record); // A previous carried object's visual lift never leaks into an action or another holder.
      if (record.rig.applyOwnedPose?.()) return; // A paired action owns hand contacts through the final render sync.
      if (inHandCalibrationMode()) {
        syncCalibrationWorkspace(record); // Render-time authority stays on the neutral calibration frame while this tab is active.
      } else {
        const heldItem = heldItemTarget(record);
        const holder = heldItem ? null : currentToolHolder(record);
        if (heldItem) syncRigToHeldItem(record, heldItem);
        else if (holder) syncRigToTool(record, holder);
        else applyFallbackBoth(record);
      }
      publishHandSolvedBases(record); // Exactly one authoritative hand solve for the renderer's first pass this frame.
    };
    record.rig.parent.add(sentinel);
    record.syncSentinel = sentinel;
    record._lastRenderedFrameId = global.RuntimeFrameScheduler?.frameId?.() ?? null; // A rig that never draws stops costing pre-render work after the grace window.
  }

  // The sentinel only fires when its rig is actually drawn, so a rig whose
  // sentinel hasn't fired for a couple of frames is in another area's scene,
  // hidden, or detached. Its pose isn't visible, so skip the pre-render pose
  // work for it; the sentinel still syncs it on the first frame it draws
  // again, and pre-render takes over from the next frame.
  const UNRENDERED_GRACE_FRAMES = 2;
  function rigRecentlyRendered(record) {
    const frameId = global.RuntimeFrameScheduler?.frameId?.();
    if (frameId == null || record._lastRenderedFrameId == null) return true; // No frame scheduler (tool pages): keep the old every-frame behavior.
    return frameId - record._lastRenderedFrameId <= UNRENDERED_GRACE_FRAMES;
  }

  function publishHandSolvedBases(record) {
    const compositor = global.ActorRigCompositor; // One registry for authored hand-placement baselines and named dance/yawn/grip overlays.
    if (!compositor?.setSolvedBase) return;
    for (const side of ['left', 'right']) {
      const group = record.rig?.group; // The owning rig builds left/right sockets as direct children.
      const name = side + '_hand_socket';
      const socket = group?.children?.find(child => child.name === name) || group?.getObjectByName?.(name); // Legacy/nested authoring hosts retain recursive discovery.
      if (!socket?.parent) continue;
      compositor.setSolvedBase(socket, 'position', socket.position);
      compositor.setSolvedBase(socket, 'quaternion', socket.quaternion); // The complete scale-free shoulder/grip solve is the neutral orientation.
    }
  }

  function updateManagedRigs() {
    for (const record of [...managed]) {
      if (!record.avatarRoot?.userData || record.avatarRoot.userData.proceduralHandRig !== record.rig) {
        disposeSyncSentinel(record);
        managed.delete(record);
        continue;
      }
      ensureSyncSentinel(record);
      restoreHeldItemReach(record); // Revert the previous visual pose even when the rig is no longer being rendered.
      if (!rigRecentlyRendered(record)) {
        record._poseSyncSkipped = true;
        continue;
      }
      if (record._poseSyncSkipped && record.fallback) {
        // Resume gait sampling from here instead of reading the whole off-screen
        // gap as one stride's worth of movement.
        record.fallback.hasWorldPosition = false;
        record.fallback.lastSampleMs = null;
      }
      record._poseSyncSkipped = false;
      updateFallbackMotion(record);
      if (record.rig.applyOwnedPose?.()) continue; // Explicit pose ownership precedes held-tool and idle fallback writers.
      if (inHandCalibrationMode()) {
        syncCalibrationWorkspace(record);
      } else {
        const heldItem = heldItemTarget(record);
        const holder = heldItem ? null : currentToolHolder(record);
        if (heldItem) syncRigToHeldItem(record, heldItem);
        else if (holder) syncRigToTool(record, holder);
        else applyFallbackBoth(record);
      }
      publishHandSolvedBases(record); // Compose on the active rig only, after its actual grip/idle solver has finished.
    }
  }

  // Discovery/attachment (does a newly-built avatar's rig need attaching yet?)
  // has no ordering dependency on gameplay simulation or rendering, so it is
  // split out from the render-sensitive pose/sync work below instead of
  // sharing one per-frame callback (see
  // docs/architecture/runtime-frame-scheduler.md's Stage 7 notes). The final
  // exact tool/hand matrix stays entirely in ensureSyncSentinel's
  // onBeforeRender hook below, untouched by either piece of this split.
  function attachmentSweep() {
    if (!pending.size) return; // No per-frame array copy when nothing is waiting.
    for (const record of [...pending]) {
      if (!record.avatarRoot?.userData) {
        pending.delete(record);
        continue;
      }
      if (record.avatarRoot.userData.proceduralHandRig || attachPending(record)) pending.delete(record);
    }
  }

  // Needs this frame's fresh simulation state (elapsed time, current parent
  // world position for the fallback gait) but must run before Three.js
  // traverses the scene, so this is pre-render phase work.
  function poseAndSyncUpdate() {
    updateManagedRigs();
  }

  global.ProceduralHandFrameDriver = {
    groundPoseContext(holder, itemKey) {
      const preview=inAttackEditor();
      if(preview?holder!==global.HobunjiAttackEditorToolContext?.toolHolder:(!gameDeps?.playerMesh||holder!==gameDeps.toolHolder))return null;
      for(const record of managed) {
        if((!preview&&record.rig?.parent!==gameDeps.playerMesh)||record.avatarRoot?.userData?.proceduralHandToolHolder||currentToolHolder(record)!==holder)continue;
        const key=preview?toolGrips.toolKeyFor(itemKey):currentToolKey(record);
        const gripContext=currentGripContext(record);
        if(!key||(preview&&gripContext!=='melee'))return null;
        const identity={speciesId:record.speciesId,gender:record.gender,rigScaleY:Number(record.avatarRoot?.userData?.proceduralHandRigScaleY)||null};
        const slot=preview?'weapon':global.WeaponToolStances?.getRuntimeState?.()?.activeSlot;
        const dual=(preview||slot==='weapon')&&gripContext==='melee'&&!!toolGrips.dualWieldStateForTool?.(key,'melee',identity);
        return {rig:record.rig,itemKey:itemKey||key,preview,scaleIdentity:identity,dual,gripContext,
          offhand:dual?toolGrips.offhandPrimaryGripForTool?.(key,'melee',identity):null,
          fitIdentity:[identity.speciesId,identity.gender,identity.rigScaleY||'',toolGrips.actualCharacterHeight?.(identity.speciesId,identity.gender,identity.rigScaleY)||''].join(':'),
          authoredGripZ:toolGrips.authoredPrimaryGripForTool(key,gripContext)?.position?.z,
          primary:toolGrips.primaryGripForTool(key,gripContext,identity),
          secondary:toolGrips.secondaryGripForTool(key,gripContext,identity),
          profile:toolGrips.groundProfileForTool?.(itemKey||key)};
      }
      return null;
    },
    syncNow() {
      const results = [];
      for (const record of managed) {
        updateFallbackMotion(record);
        restoreHeldItemReach(record); // Explicit diagnostics obey the same release-before-owner order as rendering.
        if(record.rig.applyOwnedPose?.()){results.push({poseOwned:true});continue;} // Async shoulder/profile refreshes obey the same action owner as normal frames.
        if (inHandCalibrationMode()) {
          results.push(syncCalibrationWorkspace(record, true));
        } else {
          const heldItem = heldItemTarget(record);
          const holder = heldItem ? null : currentToolHolder(record);
          if (heldItem) {
            syncRigToHeldItem(record, heldItem);
            results.push({ direct: true, heldItem: true, reachLift: record.heldItemScratch?.reachApplied?.length?.() || 0 });
          } else if (holder) results.push(syncRigToTool(record, holder, true));
          else {
            applyFallbackBoth(record);
            results.push({ direct: true, toolVisible: false, secondaryActive: false });
          }
        }
        publishHandSolvedBases(record); // Explicit mobile/editor sync follows the same authoritative pose handoff.
      }
      return results;
    },
    getPerfStats() { return { ...handSyncPerf }; }, // Read only by diagnostic panels; zero snapshot allocations during normal frames.
    getDebug() {
      return [...managed].map(record => ({
        speciesId: record.speciesId,
        gender: record.gender,
        mode: inHandCalibrationMode() ? 'glb-calibration-neutral-reference' : 'direct-tool-attachments',
        noArmIK: true,
        toolKey: record.lastToolKey,
        secondaryActive: record.secondaryActive,
        scaleFreeWorldQuaternion: true,
        visualGripBasis: record.lastVisualGripBasis,
        fallback: record.fallback ? {
          mode: record.fallback.mode,
          speed: Number(record.fallback.speed.toFixed(3)),
          gaitStrength: Number(record.fallback.gaitStrength.toFixed(3)),
          phase: Number(record.fallback.phase.toFixed(3)),
          owners: { ...record.fallback.owners },
        } : null,
        modelKey: modelKeyForRecord(record),
        handFromTool: global.HobunjiHandGripModes?.effectiveFrameForModel?.(modelKeyForRecord(record))
          || profiles.data?.models?.[modelKeyForRecord(record)]?.handFromTool
          || null,
        primaryGrip: toolGrips.primaryGripForTool(record.lastToolKey, toolGrips.currentGripContext?.(), { speciesId: record.speciesId, gender: record.gender }),
        secondaryGrip: toolGrips.secondaryGripForTool(record.lastToolKey, toolGrips.currentGripContext?.(), { speciesId: record.speciesId, gender: record.gender }) || null,
        hand: record.rig?.getDebug?.() || null,
        heldItemReachLift: Number(record.heldItemScratch?.reachApplied?.length?.() || 0), // Mobile diagnostics report any active anatomical holder lift.
        hasPreRenderSentinel: !!record.syncSentinel,
        poseSyncSkipped: !!record._poseSyncSkipped,
      }));
    },
  };

  toolGrips.subscribe?.(() => global.ProceduralHandFrameDriver?.syncNow?.());
  profiles.subscribe?.((_data, change) => {
    if (change?.kind === 'hand-transform' || change?.kind === 'model-mapping' || change?.kind === 'species-scale') {
      global.ProceduralHandFrameDriver?.syncNow?.();
    }
  });

  if (global.RuntimeFrameScheduler?.register) {
    global.RuntimeFrameScheduler.register('procedural-hand-attachment', attachmentSweep, {
      owner: 'ProceduralHandFrameDriver',
      description: 'Attaches a pending procedural hand rig once its avatar has been added to the scene.',
    });
    global.RuntimeFrameScheduler.register('procedural-hand-pose-sync', poseAndSyncUpdate, {
      phase: 'pre-render',
      owner: 'ProceduralHandFrameDriver',
      description: 'Ensures each managed rig\'s render sentinel exists and refreshes its fallback gait pose from this frame\'s state.',
    });
    global.HobunjiWeaponSpriteAssemblies?.scheduleTickAfterPose?.(); // Final hand/socket sync can move dual hafts again; project rope contacts after it, once per frame.
  } else {
    // The standalone Attack Animation Editor and Animation Author tool pages
    // (docs/tools/*) also load this module but never load
    // RuntimeFrameScheduler — they own their own isolated animation context,
    // so this keeps the original combined per-frame loop for them unchanged.
    (function frame() {
      attachmentSweep();
      poseAndSyncUpdate();
      global.requestAnimationFrame(frame);
    })();
  }
})(window);

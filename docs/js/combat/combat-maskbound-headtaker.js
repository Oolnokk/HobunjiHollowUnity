// Maskbound Headtaker: an unarmed, high-leaping humanoid that uses the shared
// Combat.attach lifecycle, but takes its combat decision from the humanoid AI.
// Its sprite-only head throw never changes the target's saved appearance.
(() => {
  'use strict';
  const ID = 'maskbound-headtaker'; // Shared attachment ID and mobile combat diagnosis.
  const LEAP_S = 1.15; // Total takeoff, unseen apex, and landing telegraph.
  const ASCEND_S = 0.4; // Launch interval before the actor is hidden above camera.
  const DESCEND_S = 0.56; // Visible sky-to-victim descent (the landing circle stays locked to the original tile).
  const SKY_HEIGHT = 11; // High above the view before a live 3D descent into the exact shared attachment pose.
  const REAR_ARM_FRACTION = 0.75; // Depth behind the target portrait plane is 75% of this Headtaker's actual rendered arm length.
  const TARGET_HEIGHT_FRACTION = 0.85; // Headtaker's portrait centre meets 85% of the victim's height (10 percentage points above the former 75%).
  const PULL_IMPULSE_FRAC = 0.13; // Each heartbeat-like yank reaches full extension in 195ms, then recoils for the rest of 1.5s.
  const PULL_S = 1.5; // Each of the first two reversible head pulls.
  const FINAL_PULL_S = 3; // Three-second terminal pull: more stretch and a backward pitch toward the Headtaker.
  const THROW_S = 1.3; // Two-part windup and release after the head comes loose.
  const COOLDOWN_S = 5; // A missed leap or completed grab has a meaningful recovery.
  const HEAD_STRETCH = 0.25; // First two quick heartbeat pulls keep the existing reversible stretch.
  const FINAL_HEAD_STRETCH = 0.58; // Terminal stretch reaches 58% additional skull length before the head separates.
  const FINAL_HEAD_PITCH_RAD = 40 * Math.PI / 180; // Maximum backward neck pitch toward the Headtaker during the third pull.
  const ATTACKER_LEAN_RAD = -15 * Math.PI / 180; // Group-local Z pitches the attacker forward (+portrait normal) by 15 degrees.
  const ATTACH_DURATION_S = PULL_S * 2 + FINAL_PULL_S + THROW_S + 0.3;
  const active = new WeakMap(); // Enemy -> active per-attack resources; never retains removed enemies.
  const telemetry = { begins: 0, landings: 0, grabs: 0, dodges: 0, finishes: 0, errors: 0, last: 'ready' }; // Mobile-visible state without DevTools.

  const clamp01 = v => Math.max(0, Math.min(1, v));
  const smoothstep = t => { const p = clamp01(t); return p * p * (3 - 2 * p); }; // Continuous endpoint velocity avoids an artificial snap at grip contact.
  function heartbeatPull(localSeconds) {
    const phase = clamp01(localSeconds / PULL_S); // One sharp pull, then one long recovery, per 1.5s repetition.
    if (phase < PULL_IMPULSE_FRAC) {
      const p = phase / PULL_IMPULSE_FRAC;
      return 1 - (1 - p) ** 4; // Sudden upwards attack: reaches almost full extension in a few frames.
    }
    const recovery = (phase - PULL_IMPULSE_FRAC) / (1 - PULL_IMPULSE_FRAC);
    return (1 - recovery) ** 1.15 * (1 + 0.08 * Math.sin(Math.PI * recovery)); // Lengthy elastic recoil, slightly resistant at mid-return.
  }
  const alive = actor => !!actor && actor.health > 0 && !actor._deathTransitionStarted;
  const deps = () => window.Combat?.deps || {};
  const player = actor => !!actor && actor === deps().player;
  const humanoid = actor => player(actor) || (!!actor?.isBandit && !!actor?.avatarRef?.profile) || (!!actor?.avatarRef?.profile && actor?.isNpcWalker);
  const scratch = () => new window.THREE.Vector3(); // Transient transforms are reused per active attack, not per free-moving hostile.

  function canvasCopy(source) {
    if (!source || !globalThis.document?.createElement) return null;
    const canvas = document.createElement('canvas'); // Portrait snapshot used for exact restoration after dodge or player death.
    canvas.width = source.width || source.naturalWidth || 200;
    canvas.height = source.height || source.naturalHeight || 200;
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function portrait(host) {
    const playerAvatar = player(host) ? window.WorldPortraitLife?.getPlayerAvatar?.() : null; // Use the live portrait/profile, including the full current headwear, not the physics player alone.
    const root = host.avatarRef?.group || playerAvatar?.group || (player(host) ? (deps().playerMesh || window.PlayerBodyTransformComposer?.getPlayerMesh?.() || window.ProceduralHandAttachments?.gameDeps?.playerMesh) : null);
    if (!root) return null;
    let rigRoot = root.userData?.neckRig?.available ? root : null;
    if (!rigRoot) root.traverse?.(node => {
      if (!rigRoot && node.userData?.neckRig?.available) rigRoot = node;
    });
    const rig = rigRoot?.userData?.neckRig;
    const front = host.avatarRef?.frontCanvas || playerAvatar?.frontCanvas || rigRoot?.userData?.sourceCanvas;
    const profile = host.avatarRef?.profile || playerAvatar?.profile || rigRoot?.userData?.portraitProfile || root.userData?.portraitProfile || null;
    const head = rig?.headCentroidPx || (front ? { x: front.width * 0.5, y: front.height * 0.23 } : { x: 100, y: 45 });
    const width = Number(host.avatarRef?.modelWidth || rigRoot?.userData?.portraitModelWidth || root.userData?.portraitModelWidth) || 0.9;
    const height = Number(host.avatarRef?.modelHeight || rigRoot?.userData?.portraitModelHeight || root.userData?.portraitModelHeight) || 1.1;
    return { root, rigRoot, rig, front, back: host.avatarRef?.backCanvas || playerAvatar?.backCanvas || null, profile, head, width, height, textureRoot: host.avatarRef?.textureRoot || playerAvatar?.group || rigRoot };
  }

  function headWorld(host, state, out) {
    const data = state.portrait || portrait(host);
    if (!data) return null;
    const resolved = window.PNGPlaneAvatar?.resolveSkinnedPixelWorldPosition?.(data.root, data.head, out);
    if (resolved) return resolved;
    data.root.updateWorldMatrix?.(true, false);
    data.root.getWorldPosition(out);
    out.y += data.height * 0.28;
    return out;
  }

  function portraitPixelWorld(data, pixel, out) {
    if (!data?.root || !pixel || !Number.isFinite(pixel.x) || !Number.isFinite(pixel.y)) return null;
    return window.PNGPlaneAvatar?.resolveSkinnedPixelWorldPosition?.(data.root, pixel, out) || null; // Honor spine, head-scale bones, sprite flips, and runtime species proportions.
  }

  function spineRootPixel(data) {
    const rig = data?.rig;
    const w = Number(data?.front?.width), h = Number(data?.front?.height);
    if (!rig || !w || !h || !data.width || !data.height) return null;
    // Rig.spineBase is the *NECK* end of the spline (node 6), not its posterior
    // base (node 0)! Using it put the right foot alongside the hands.
    const neckBase = rig.spineBase || rig.neckLocal;
    if (!neckBase || !Number.isFinite(neckBase.x) || !Number.isFinite(neckBase.y)) return null;
    const posterior = Number.isFinite(rig.spinePosteriorY) ? rig.spinePosteriorY : null;
    const layout = window.HobunjiCharacterSpine?.layoutFor?.(neckBase.x, neckBase.y, data.height, posterior, Number(rig.neckLocal?.x) || 0, Number(rig.neckLocal?.y) || 0);
    const root = layout?.nodes?.[0] || { x: 0, y: posterior != null && posterior < neckBase.y - data.height * 0.1 ? posterior : neckBase.y - data.height * 0.42 };
    return { x: (root.x / data.width + 0.5) * w, y: (0.5 - root.y / data.height) * h };
  }

  function leftShoulderWorld(state, out) {
    const avatar = state.host?.avatarRef || (player(state.host) ? window.WorldPortraitLife?.getPlayerAvatar?.() : null); // Player portrait is a separate runtime avatar, not a Bandit avatarRef.
    const root = avatar?.handRigAvatarRoot || state.portrait?.rigRoot || avatar?.group;
    const rig = root?.userData?.proceduralHandRig;
    const parent = root?.userData?.proceduralHandParent || avatar?.handsPivot;
    if (!rig?.shoulderPositionLocal || !parent?.localToWorld) return null;
    if (!rig.shoulderPositionLocal('left', out)) return null; // Already resolves rig-profile, manual and scanned shoulder authoring.
    parent.updateWorldMatrix?.(true, false);
    parent.localToWorld(out);
    return out;
  }

  function alignFootToPortraitSurface(state, point) {
    const data = state.portrait;
    if (!data) return point;
    const avatar = state.host?.avatarRef || (player(state.host) ? window.WorldPortraitLife?.getPlayerAvatar?.() : null);
    const surface = avatar?.frontPlane || data.rig?.skinnedPlane; // Same visible skinned surface used by the Headtaker's hand grips.
    if (!surface?.getWorldDirection) return point;
    state.footNormal ||= scratch(); // Scratch normal reused per grapple tick for shoulder projection.
    state.footSurface ||= scratch(); // A skin-resolved head pixel defines the actual portrait plane, never the target's physics collider.
    surface.updateWorldMatrix?.(true, false);
    surface.getWorldDirection(state.footNormal);
    const reference = portraitPixelWorld(data, data.head, state.footSurface);
    if (!reference) return point;
    const n = state.footNormal;
    const lengthSq = n.x * n.x + n.y * n.y + n.z * n.z;
    if (lengthSq > 1e-8) {
      const distance = ((reference.x - point.x) * n.x + (reference.y - point.y) * n.y + (reference.z - point.z) * n.z) / lengthSq;
      point.x += distance * n.x;
      point.y += distance * n.y;
      point.z += distance * n.z; // Keep original anatomical X/Y along the portrait surface while correcting ONLY depth along its normal.
    }
    return point;
  }

  function headBoundPixel(data, side) {
    const bounds = data?.rig?.headBoundsPx;
    const x = Number(side === 'left' ? bounds?.left : bounds?.right);
    const validX = Number.isFinite(x) && bounds?.left < bounds?.right;
    const centerX = Number(data?.head?.x) || (data?.front?.width || 200) * 0.5;
    const span = (data?.front?.width || 200) * 0.13; // Only for missing head-mask bounds; never override detected skull edges.
    const boundsCenterY = (Number(bounds?.top) + Number(bounds?.bottom)) / 2;
    return {
      x: validX ? x : centerX + (side === 'left' ? -span : span),
      y: Number.isFinite(boundsCenterY) ? boundsCenterY : Number(data?.head?.y) || (data?.front?.height || 200) * 0.23,
    };
  }

  function headJoints(data) {
    const named = data?.rigRoot?.userData?.neckRig;
    const avatar = data?.hostAvatar;
    return [avatar?.headScaleJoint?.front, avatar?.headScaleJoint?.back, named?.headScaleJoint].filter(Boolean);
  }

  function backupBones(state) {
    state.bones = headJoints({ ...state.portrait, hostAvatar: state.host?.avatarRef }).map(joint => ({
      joint, scale: joint.scale.clone(), position: joint.position.clone(),
    })); // Exact existing skull pose is restored even after an interrupted stretch.
  }

  function stretch(state, amount) {
    if (!state.bones) return;
    for (const bone of state.bones) {
      bone.joint.scale.copy(bone.scale);
      bone.joint.scale.y *= 1 + amount;
      bone.joint.position.copy(bone.position);
      bone.joint.position.y += state.portrait.height * amount * 0.18;
    }
  }

  // Headtaker owns only the victim's NECK rotation; body motion, movement
  // input, gait and the skinned head-scale stretch are independent.
  function applyVictimNeckPose(state) {
    const lock = state?.neckLock;
    if (!lock || state.disposed) return;
    for (const entry of lock.joints) {
      const rot = entry.joint?.rotation;
      if (!rot) continue;
      rot.x = entry.sign * lock.pitch; // Front bends backward toward the attacker; rear uses the opposite local pitch axis.
      rot.y = 0; rot.z = 0; // Suppress autonomous tracking, nods, and roll for this grapple only.
    }
  }

  function lockVictimNeck(state) {
    const host = state.host, avatar = host?.avatarRef;
    const neck = avatar?.neckJoint;
    const rig = state.portrait?.rig;
    const candidates = [
      { joint: neck?.front || rig?.neckJoint, sign: -1 },
      { joint: neck?.back, sign: 1 },
    ];
    const joints = [], seen = new Set(); // Both hostile face meshes have distinct neck bones; the player uses one shared skinned bone.
    for (const { joint, sign } of candidates) {
      if (!joint?.rotation || seen.has(joint)) continue;
      seen.add(joint);
      joints.push({
        joint, sign,
        x: joint.rotation.x || 0, y: joint.rotation.y || 0, z: joint.rotation.z || 0,
        oldOwner: joint.userData?.maskboundHeadtakerNeckControlled,
      }); // Original look angles and scoped ownership are restored after dodge/death/throw without resetting the moving host.
      joint.userData ||= {}; // Joint-local guard makes the player head composer ignore normal look tracking during this one grapple.
      joint.userData.maskboundHeadtakerNeckControlled = true;
    }
    const lock = state.neckLock = { joints, pitch: 0, renderHooks: [] }; // Active scripted pitch shared by combat ticks and render-time skinning.
    if (player(host)) {
      state.headActionLock = window.CharacterActionLocks?.acquire?.({
        owner: 'maskbound-headtaker', reason: 'Skyfall Head Grip: scripted neck only',
        participants: [{ id: 'player', channels: ['head'] }],
      }) || null; // Existing head-only input authority stops player camera/reticle aim from rewriting the neck, without locking movement, attacks or dodge.
    }
    state.originalHostNeckOwner = host?._maskboundHeadtakerNeckControlled;
    if (host) host._maskboundHeadtakerNeckControlled = state; // Bandit AI and player neck composer skip their own gaze writes.
    const meshes = new Set(); // Same visible skinned planes sampled by hands and feet, not the phantom hand-driver model.
    const collect = node => {
      if (!node) return;
      if (node.isSkinnedMesh) meshes.add(node);
      node.traverse?.(obj => { if (obj?.isSkinnedMesh) meshes.add(obj); });
    };
    collect(avatar?.frontPlane); collect(avatar?.backPlane); collect(rig?.skinnedPlane);
    for (const mesh of meshes) {
      const previous = mesh.onBeforeRender;
      const forced = function headtakerNeckSkinningBeforeRender(...args) {
        if (typeof previous === 'function') previous.apply(this, args);
        applyVictimNeckPose(state); // Other game look animations may have written since combat tick; lock at skinning boundary.
      };
      mesh.onBeforeRender = forced;
      lock.renderHooks.push({ mesh, previous, forced }); // Restore renderer hooks exactly when attachment releases.
    }
    applyVictimNeckPose(state);
  }

  function unlockVictimNeck(state) {
    state?.headActionLock?.release?.(); // Exact scoped token; never release another system's head/movement locks.
    if (state) state.headActionLock = null;
    const lock = state?.neckLock;
    if (!lock) return;
    for (const { mesh, previous, forced } of lock.renderHooks) {
      if (mesh.onBeforeRender === forced) mesh.onBeforeRender = previous; // Preserve later hooks owned by other systems.
    }
    for (const entry of lock.joints) {
      const r = entry.joint?.rotation;
      if (r) { r.x = entry.x; r.y = entry.y; r.z = entry.z; }
      if (entry.joint?.userData) {
        if (entry.oldOwner === undefined) delete entry.joint.userData.maskboundHeadtakerNeckControlled;
        else entry.joint.userData.maskboundHeadtakerNeckControlled = entry.oldOwner;
      }
    }
    const host = state.host;
    if (host?._maskboundHeadtakerNeckControlled === state) {
      if (state.originalHostNeckOwner === undefined) delete host._maskboundHeadtakerNeckControlled;
      else host._maskboundHeadtakerNeckControlled = state.originalHostNeckOwner;
    }
    state.neckLock = null;
  }

  function refreshPortrait(state) {
    const data = state.portrait;
    if (!data?.front || !data.textureRoot || !window.PNGPlaneAvatar?.refreshSinglePlaneAvatarModel) return false;
    return !!window.PNGPlaneAvatar.refreshSinglePlaneAvatarModel(data.textureRoot, data.front, { backCanvas: data.back || undefined });
  }

  // The normal portrait renderer is reused: unlike erasing a rectangle of
  // pixels, this redraw lets the collar/body behind the skull show through.
  async function prepareHeadArt(state) {
    const data = state.portrait;
    if (!data?.front) return;
    const full = canvasCopy(data.front);
    const headArt = canvasCopy(data.front);
    const headless = data.profile ? canvasCopy(data.front) : null;
    const headlessBack = data.profile && data.back ? canvasCopy(data.back) : null;
    if (data.profile && window.NpcAvatarPreview?.renderProfileToCanvas) {
      const canvas = async (target, options) => {
        target.getContext('2d').clearRect(0, 0, target.width, target.height);
        await window.NpcAvatarPreview.renderProfileToCanvas(target, data.profile, { forceEyesOpen: true, ...options });
      };
      await Promise.all([
        canvas(headArt, { headCosmeticsOnly: true }),
        canvas(headless, { omitHeadSpriteAndCosmetics: true }),
        ...(headlessBack ? [canvas(headlessBack, { portraitView: 'behind', omitHeadSpriteAndCosmetics: true })] : []),
      ]);
    } else if (headArt) {
      // Player canvases may not expose their original profile. Preserve the
      // detected skull/headwear area for the temporary thrown head; the live
      // portrait uses the real head bone as its fallback visibility gate.
      const bounds = data.rig?.headBoundsPx;
      const w = headArt.width, h = headArt.height;
      const x0 = Math.max(0, Math.floor((bounds?.minX ?? w * 0.24) - w * 0.09));
      const y0 = Math.max(0, Math.floor((bounds?.minY ?? h * 0.04) - h * 0.06));
      const x1 = Math.min(w, Math.ceil((bounds?.maxX ?? w * 0.76) + w * 0.09));
      const y1 = Math.min(h, Math.ceil((bounds?.maxY ?? h * 0.42) + h * 0.05));
      const ctx = headArt.getContext('2d');
      ctx.clearRect(0, 0, w, y0);
      ctx.clearRect(0, y0, x0, y1 - y0);
      ctx.clearRect(x1, y0, w - x1, y1 - y0);
      ctx.clearRect(0, y1, w, h - y1);
    }
    if (active.get(state.attacker) !== state || state.disposed) return;
    state.art = { full, headArt, headless, headlessBack };
  }

  function showHeadless(state) {
    if (state.headRemoved) return;
    if (!state.art) return; // Do not transition until asynchronous head-only textures exist.
    const data = state.portrait, art = state.art; // Resolve the live canvas before changing the player portrait's refresh lock.
    state.headRemoved = true;
    if (player(state.host) && data?.root?.userData) data.root.userData.maskboundHeadHidden = true; // Suppress periodic face/breathing redraw until the head is restored.
    stretch(state, 0);
    if (art?.headless && data.front) {
      data.front.getContext('2d').clearRect(0, 0, data.front.width, data.front.height);
      data.front.getContext('2d').drawImage(art.headless, 0, 0);
      if (art.headlessBack && data.back) {
        data.back.getContext('2d').clearRect(0, 0, data.back.width, data.back.height);
        data.back.getContext('2d').drawImage(art.headlessBack, 0, 0);
      }
      refreshPortrait(state);
    } else if (state.bones?.length) {
      // Only an unprofiled avatar uses this fallback. A genuine profile
      // always takes the Imlao-style headless redraw above instead.
      for (const bone of state.bones) bone.joint.scale.setScalar(0.001);
    }
    createThrownHead(state);
  }

  function createThrownHead(state) {
    const THREE = window.THREE, data = state.portrait, art = state.art;
    if (!THREE || !art?.headArt || !state.attacker?.scene) return;
    const texture = new THREE.CanvasTexture(art.headArt); // Independent transient head-only portrait.
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.02, side: THREE.DoubleSide, depthWrite: false });
    const geometry = new THREE.PlaneGeometry(data.width, data.height);
    const mesh = new THREE.Mesh(geometry, material);
    const origin = new THREE.Group();
    origin.name = 'maskbound_severed_head_origin';
    const px = data.head.x / (data.front?.width || 200);
    const py = data.head.y / (data.front?.height || 200);
    mesh.position.set((0.5 - px) * data.width, (py - 0.5) * data.height, 0);
    origin.add(mesh);
    const point = headWorld(state.host, state, scratch());
    if (point) origin.position.copy(point);
    state.attacker.scene.add(origin);
    state.headClone = { origin, texture, geometry, material, start: origin.position.clone() };
    const count = 24; // Fixed-size pooled blood spew; no material/geometry allocations per frame.
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      velocities[k] = (Math.random() - 0.5) * 1.3;
      velocities[k + 1] = 2.4 + Math.random() * 3.1;
      velocities[k + 2] = (Math.random() - 0.5) * 1.3;
    }
    const bloodGeo = new THREE.BufferGeometry();
    bloodGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const bloodMat = new THREE.PointsMaterial({ color: 0x9c131c, size: 0.085, transparent: true, opacity: 0.85, depthWrite: false });
    const blood = new THREE.Points(bloodGeo, bloodMat);
    blood.name = 'maskbound_head_blood_spew';
    blood.position.copy(state.headClone.start);
    state.attacker.scene.add(blood);
    state.blood = { blood, bloodGeo, bloodMat, positions, velocities };
  }

  function animateHeadThrow(state, phase) {
    const clone = state.headClone;
    if (!clone) return;
    const t = clamp01(phase / THROW_S);
    const windup = clamp01(t / 0.48); // First throw pose: head drawn back against the shoulder.
    const released = clamp01((t - 0.48) / 0.52); // Second throw pose: fling past the viewport.
    clone.origin.position.copy(clone.start);
    clone.origin.position.x += t <= 0.48 ? -0.18 * windup : -0.18 + released * 4.5;
    clone.origin.position.y += t <= 0.48 ? 0.18 * windup : 0.18 + released * 4 - 2.0 * released * released;
    clone.origin.rotation.z = released * 9;
    if (state.blood) {
      const b = state.blood, age = Math.min(1.1, phase);
      for (let i = 0; i < b.velocities.length; i += 3) {
        b.positions[i] = b.velocities[i] * age;
        b.positions[i + 1] = b.velocities[i + 1] * age - 3.5 * age * age;
        b.positions[i + 2] = b.velocities[i + 2] * age;
      }
      b.bloodGeo.attributes.position.needsUpdate = true;
      b.bloodMat.opacity = Math.max(0, 0.85 * (1 - age / 1.1));
    }
  }

  function gripPose(state, rig) {
    const THREE = window.THREE;
    if (!THREE || !alive(state.host) || !state.portrait) return;
    applyVictimNeckPose(state); // Pixel-to-skin targets must see the same scripted pitch that the renderer will draw.
    const p = headWorld(state.host, state, state.headPoint);
    if (!p) return;
    const progress = state.elapsed;
    const headBounds = state.portrait.rig?.headBoundsPx;
    const offset = state.portrait.width * Math.max(0.04, ((Number(headBounds?.right) - Number(headBounds?.left)) || (state.portrait.front?.width || 200) * 0.26) / (2 * (state.portrait.front?.width || 200)));
    for (const side of ['left', 'right']) {
      const isOffhand = side === 'left';
      const throwElapsed = progress - PULL_S * 2 - FINAL_PULL_S; // Hands follow the two-stage throw clock, not the flying head after release.
      if (state.headRemoved && isOffhand) {
        rig.setSideIdle?.(side); // The offhand lets go as soon as the detached head exists.
        continue;
      }
      const target = state.handTargets[side];
      if (state.headRemoved && throwElapsed >= THROW_S * 0.48) {
        const followThrough = clamp01((throwElapsed - THROW_S * 0.48) / (THROW_S * 0.52));
        target.copy(p);
        target.x += offset + state.portrait.width * followThrough * 0.65;
        target.y += state.portrait.height * (0.15 + 0.2 * Math.sin(Math.PI * followThrough));
        rig.placeHandWorld?.(side, target, state.palmQuaternion); // Throwing palm completes its follow-through while the released head travels independently.
        continue;
      }
      const bound = headBoundPixel(state.portrait, side);
      const skinned = portraitPixelWorld(state.portrait, bound, target);
      if (!skinned) {
        target.copy(p); target.x += isOffhand ? -offset : offset; // Only non-skinned sprites fall back to the old centre-relative grip.
      }
      if (state.headClone) {
        target.sub(p).add(state.headClone.origin.position); // Maintain the left/right skull-edge grips while the detached clone is held.
      }
      rig.placeHandWorld?.(side, target, state.palmQuaternion); // Hand targets come from moving head bounds, including the heartbeat neck stretch.
    }
  }

  function poseFeet(state) {
    const legs = state.attacker.avatarRef?.legs;
    if (!legs?.setExternalFootTargets || !state.feet) return;
    const data = state.portrait, feet = state.feet;
    const spine = state.spineRootPixel ||= spineRootPixel(data); // Right foot lands at spline node 0, the posterior/hip base, NOT the neck/shoulder endpoint.
    if (!spine || !portraitPixelWorld(data, spine, feet.right)) {
      state.footFallback ||= scratch(); // Shared fallback scratch avoids per-tick allocations for portraits missing a skinned spine.
      feet.right.copy(headWorld(state.host, state, state.footFallback) || feet.right);
      feet.right.y -= data.height * 0.58; // Legacy rig fallback reaches the lower torso, never the head/neck.
      alignFootToPortraitSurface(state, feet.right);
    } // The skinned spine pixel ALREADY lies on the exact same surface as the head-bound hands; do not offset it onto a back-plane collider.
    if (leftShoulderWorld(state, feet.left)) {
      alignFootToPortraitSurface(state, feet.left); // Project the authored/scanned shoulder along the visible skin normal, not an arbitrary world Z.
    } else {
      const shoulder = spine ? { x: spine.x - (Number(data.front?.width) || 200) * 0.2, y: spine.y } : null;
      if (!shoulder || !portraitPixelWorld(data, shoulder, feet.left)) {
        feet.left.copy(feet.right);
        feet.left.x -= data.width * 0.2;
        alignFootToPortraitSurface(state, feet.left);
      }
    }
    legs.setExternalFootTargets(feet, { allowExtendedReach: true }); // Contact takes precedence over natural walking reach; other leg poses remain capped.
    telemetry.rightFootWorldX = feet.right.x; telemetry.rightFootWorldY = feet.right.y; telemetry.rightFootWorldZ = feet.right.z; // Mobile diagnostics expose the posterior node-0 contact.
    telemetry.leftFootWorldX = feet.left.x; telemetry.leftFootWorldY = feet.left.y; telemetry.leftFootWorldZ = feet.left.z; // Same for the independent left-shoulder contact.
  }

  function restoreHead(state, forced = false) {
    const data = state.portrait;
    if (!data) return;
    if (data.root?.userData) data.root.userData.maskboundHeadHidden = false; // Always unlock before any respawn, interruption or costume rebuild.
    if (state.headRemoved && (!state.completed || player(state.host) || forced)) {
      if (state.art?.full && data.front) {
        data.front.getContext('2d').clearRect(0, 0, data.front.width, data.front.height);
        data.front.getContext('2d').drawImage(state.art.full, 0, 0);
      }
      if (state.originalBack && data.back) {
        data.back.getContext('2d').clearRect(0, 0, data.back.width, data.back.height);
        data.back.getContext('2d').drawImage(state.originalBack, 0, 0);
      }
      refreshPortrait(state);
    }
    for (const bone of state.bones || []) {
      bone.joint.scale.copy(bone.scale);
      bone.joint.position.copy(bone.position);
    }
  }

  function createLandingMarker(state) {
    const THREE = window.THREE, tile = Number(deps().TILE) || 64; // Same radius used by the circular contact test.
    if (!THREE?.RingGeometry || !state.attacker?.scene) return;
    const geometry = new THREE.RingGeometry(0.94, 1.02, 32); // Narrow translucent ring is readable beneath an enemy's tall jump.
    const material = new THREE.MeshBasicMaterial({ color: 0xac2121, side: THREE.DoubleSide, transparent: true, opacity: 0.58, depthWrite: false });
    const marker = new THREE.Mesh(geometry, material);
    marker.name = 'maskbound_skyfall_one_tile_aoe';
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(state.landX / tile, (Number(deps().activeSurfaceYAtWorld?.(state.landX, state.landY) ?? deps().worldSurfaceY?.(state.landX, state.landY)) || 0) + 0.035, state.landY / tile);
    marker.renderOrder = 16;
    state.attacker.scene.add(marker);
    state.marker = { marker, geometry, material }; // Lifetime is strictly the offscreen jump, not the attached struggle.
  }

  // Three r128 predates Object3D.removeFromParent; use the parent-owned remove API.
  function removeSceneObject(object) {
    if (object?.parent) object.parent.remove(object);
  }

  function removeLandingMarker(state) {
    const entry = state.marker;
    if (!entry) return;
    state.marker = null; // Avoid repeated cleanup on subsequent frames if resource disposal fails.
    removeSceneObject(entry.marker);
    entry.geometry.dispose();
    entry.material.dispose();
  }

  function dispose(state, reason) {
    if (!state || state.disposed) return;
    unlockVictimNeck(state); // Release scripted neck ownership, keeping victim position/velocity and movement inputs untouched.
    state.disposed = true;
    removeLandingMarker(state);
    state.attacker._banditLungeHopCurrent = 0; // A cancelled airborne leap must never leave a floating corpse or frozen draw offset.
    state.attacker.avatarRef?.legs?.setExternalFootTargets?.(null);
    state.attacker.avatarRef?.handRigAvatarRoot?.userData?.proceduralHandRig?.setPoseProvider?.(state, null);
    restoreHead(state);
    const clone = state.headClone;
    if (clone) {
      removeSceneObject(clone.origin);
      clone.geometry.dispose(); clone.material.dispose(); clone.texture.dispose();
    }
    const b = state.blood;
    if (b) { removeSceneObject(b.blood); b.bloodGeo.dispose(); b.bloodMat.dispose(); }
    state.attacker.avatarRef?.group && (state.attacker.avatarRef.group.visible = true);
    const old = state.originalFacing, avatar = state.attacker.avatarRef; // A terminated grapple must release its portrait yaw lock.
    if (old && avatar) {
      state.attacker.groupRot = old.groupRot;
      state.attacker.pngRot = old.pngRot;
      if (avatar.group?.rotation && Number.isFinite(old.groupY)) avatar.group.rotation.y = old.groupY;
      if (avatar.group?.rotation && Number.isFinite(old.groupZ)) avatar.group.rotation.z = old.groupZ;
      if (avatar.frontPlane?.rotation && Number.isFinite(old.frontY)) avatar.frontPlane.rotation.y = old.frontY;
      if (avatar.backPlane?.rotation && Number.isFinite(old.backY)) avatar.backPlane.rotation.y = old.backY;
      if (avatar.legsPivot?.rotation && Number.isFinite(old.legY)) avatar.legsPivot.rotation.y = old.legY;
      avatar.syncHandFrame?.();
    }
    if (active.get(state.attacker) === state) active.delete(state.attacker);
    telemetry.last = reason || 'ended';
  }

  function killTarget(state) {
    if (!alive(state.host) || state.completed) return;
    state.completed = true;
    const d = deps();
    const host = state.host;
    if (player(host)) restoreHead(state, true); // The existing downed/respawn pipeline must never inherit a missing player head.
    const amount = Math.max(1000, Number(host.health) + 1000);
    const opts = { attacker: state.attacker, tag: 'sharp', noStagger: true, maskboundHeadtaker: true };
    if (player(host)) d.damagePlayer?.(amount, state.attacker.x, state.attacker.y, 0, opts);
    else d.damageCreature?.(host, amount, state.attacker.x, state.attacker.y, 0, opts);
    telemetry.finishes++;
  }

  // The shared renderer's native bandit frame faces +X at a group yaw of zero,
  // while a player portrait can face +Z. Resolve the target plane, not just
  // its actor heading, so the two actual painted cards remain parallel.
  function parallelTargetYaw(host, state) {
    const avatar = host?.avatarRef;
    const portraitRoot = state?.portrait?.rigRoot || state?.portrait?.root;
    const plane = avatar?.frontPlane || state?.portrait?.rig?.skinnedPlane || portraitRoot?.userData?.neckRig?.skinnedPlane;
    if (plane?.getWorldDirection) {
      state.portraitNormal ||= scratch(); // Reused world-space plane normal, no animation-frame allocation.
      plane.updateWorldMatrix?.(true, false);
      plane.getWorldDirection(state.portraitNormal);
      const { x, z } = state.portraitNormal;
      if (Number.isFinite(x) && Number.isFinite(z) && x * x + z * z > 0.0001)
        return Math.atan2(x, z);
    }
    const rootYaw = Number(avatar?.group?.rotation?.y ?? portraitRoot?.rotation?.y) || 0;
    return rootYaw + (Number(plane?.rotation?.y) || 0); // Workshop fixture fallback when Object3D worldDirection is unavailable.
  }

  function alignBehindPortrait(state, host) {
    const attacker = state.attacker, avatar = attacker.avatarRef;
    const group = avatar?.group;
    if (!group || !host) return;
    if (!state.originalFacing) {
      state.originalFacing = {
        groupRot: attacker.groupRot, pngRot: attacker.pngRot,
        groupY: group.rotation?.y,
        groupZ: group.rotation?.z, // Restore ordinary upright sprite tilt after the grapple, miss or dodge.
        frontY: avatar.frontPlane?.rotation?.y,
        backY: avatar.backPlane?.rotation?.y,
        legY: avatar.legsPivot?.rotation?.y,
      }; // Restore the non-grappling pose when the attack ends or its target dodges.
    }
    const yaw = parallelTargetYaw(host, state) - Math.PI / 2; // Attacker's front-plane default orientation is +PI/2.
    attacker.groupRot = yaw; attacker.pngRot = yaw; // Keep the game renderer's next frame in the same facing frame.
    if (group.rotation) { group.rotation.y = yaw; group.rotation.z = ATTACKER_LEAN_RAD; } // Tilt the whole portrait/legs/hands, not only the painted plane; its world-space lean points toward the victim.
    if (avatar.frontPlane?.rotation) avatar.frontPlane.rotation.y = Math.PI / 2;
    if (avatar.backPlane?.rotation) avatar.backPlane.rotation.y = -Math.PI / 2;
    if (avatar.legsPivot?.rotation) avatar.legsPivot.rotation.y = 0;
    avatar.syncHandFrame?.(); // Hands/feet inherit the actual aligned portrait frame.
  }

  function resolveHeadtakerPose(attacker, host, d) {
    const attackerAvatar = attacker?.avatarRef, group = attackerAvatar?.group;
    if (!group || !host) return null;
    const state = active.get(attacker);
    const hostData = state?.portrait || state?.targetPortrait || portrait(host); // One victim/rig lookup per leap, not one per animation frame.
    if (state && hostData && !state.targetPortrait) state.targetPortrait = hostData;
    const hostAvatar = host?.avatarRef || (player(host) ? window.WorldPortraitLife?.getPlayerAvatar?.() : null);
    const hostPlane = hostAvatar?.frontPlane || hostData?.rig?.skinnedPlane;
    const attackerPlane = attackerAvatar.frontPlane;
    const hostRoot = hostData?.root;
    if (!hostRoot) return null;

    // Actual geometric portrait centres (50% of portrait height), including the
    // sprite's vertical assembly offset. Object origins can be at its feet!
    const makeVectors = () => ({
      targetCenter: scratch(), attackerCenter: scratch(), attackerOrigin: scratch(), normal: scratch(), worldScale: scratch(), // Cache transformed geometry and the 85%-height anchor.
    }); // Reusable per-attack world-space vectors instead of per-frame allocations on mobile.
    const refs = state ? (state.poseVectors ||= makeVectors()) : makeVectors();
    const { targetCenter, attackerCenter, attackerOrigin, normal } = refs;
    hostRoot.updateWorldMatrix?.(true, false);
    group.updateWorldMatrix?.(true, false);
    if (hostPlane?.getWorldPosition) {
      hostPlane.getWorldPosition(targetCenter);
    } else if (hostRoot.getWorldPosition) {
      hostRoot.getWorldPosition(targetCenter);
      const centroidY = Number(hostRoot.userData?.visualCentroidLocalY) || 0;
      const floorCentred = hostRoot.userData?.poseCentroidY;
      targetCenter.y += Number.isFinite(floorCentred) ? floorCentred * (hostRoot.scale?.y || 1) : centroidY * (hostRoot.scale?.y || 1);
    } else return null;
    group.getWorldPosition?.(attackerOrigin);
    if (attackerPlane?.getWorldPosition) attackerPlane.getWorldPosition(attackerCenter);
    else {
      attackerCenter.copy(attackerOrigin);
      attackerCenter.y += (Number(attackerAvatar.visualCentroidLocalY ?? group.userData?.visualCentroidLocalY) || 0) * (group.scale?.y || 1);
    }
    const localX = attackerCenter.x - attackerOrigin.x, localY = attackerCenter.y - attackerOrigin.y, localZ = attackerCenter.z - attackerOrigin.z;

    if (hostPlane?.getWorldDirection) hostPlane.getWorldDirection(normal);
    else {
      const yaw = parallelTargetYaw(host, { portrait: hostData });
      normal.set(Math.sin(yaw), 0, Math.cos(yaw));
    }
    const normLength = Math.hypot(normal.x, normal.z) || 1;
    normal.x /= normLength; normal.z /= normLength; // Use portrait-relative rear, NOT an arbitrary world -Z direction.
    const rawArm = Number(attackerAvatar.armLength ?? attackerAvatar.handRigAvatarRoot?.userData?.armLength ?? group.userData?.armLength);
    const length = Number.isFinite(rawArm) && rawArm > 0 ? rawArm : (Number(attackerAvatar.modelHeight) || 0.9) * 0.5;
    const depth = REAR_ARM_FRACTION * length * (Math.abs(Number(group.scale?.y)) || 1); // Local arm reach converted to world units.
    const destX = targetCenter.x - normal.x * depth - localX;
    const destZ = targetCenter.z - normal.z * depth - localZ;
    const hostScaleY = hostPlane?.getWorldScale ? hostPlane.getWorldScale(refs.worldScale).y : (hostRoot.scale?.y ?? 1); // Respect actual sprite scale without allocating per update.
    const heightRise = hostData.height * (TARGET_HEIGHT_FRACTION - 0.5) * (Math.abs(Number(hostScaleY)) || 1);
    const worldY = targetCenter.y + heightRise - localY; // Headtaker's whole portrait centre meets the victim at 85% of portrait height.
    const tile = Number(d.TILE) || 64;
    const x = destX * tile, y = destZ * tile;
    const surface = Number(d.worldSurfaceY?.(x, y));
    const authoredLift = Number(attacker.groundLift ?? attacker.halfHeight);
    const ownLift = (Number.isFinite(authoredLift) ? authoredLift : 0.3) * (Number(attacker.scaleY) || 1); // Honor a legitimate zero-height ground lift.
    const hop = Number.isFinite(surface) ? worldY - surface - ownLift : worldY - ownLift;
    telemetry.lastArmLength = length; telemetry.lastRearDepth = depth; // Mobile workshop diagnostics show the actual resolved anatomical distance.
    telemetry.lastCentroidOffsetY = localY; telemetry.lastTargetCentroidY = targetCenter.y + heightRise; // Mobile-visible Y target is the 85%-height point.
    return { x, y, hop, worldY };
  }

  function onAttach(attacker, host) {
    const state = active.get(attacker);
    if (!state || state.disposed) return;
    state.host = host;
    state.stage = 'grip';
    state.elapsed = 0;
    state.stretch = 0;
    state.portrait = portrait(host);
    state.originalBack = canvasCopy(state.portrait?.back);
    backupBones(state);
    state.headPoint = scratch();
    state.palmQuaternion = new window.THREE.Quaternion();
    state.handTargets = { left: scratch(), right: scratch() };
    state.feet = { left: scratch(), right: scratch() };
    state.spineRootPixel = spineRootPixel(state.portrait); // Authored rig's fixed source-pixel posterior endpoint; the skin/world transform still updates every tick.
    lockVictimNeck(state); // Freeze autonomous head-look only; the victim's movement/gait remain active.
    const rig = attacker.avatarRef?.handRigAvatarRoot?.userData?.proceduralHandRig;
    rig?.setPoseProvider?.(state, sourceRig => gripPose(state, sourceRig)); // Hands are authored-world grips, not invisible weapons.
    alignBehindPortrait(state, host);
    poseFeet(state);
    state.artReady = prepareHeadArt(state).then(() => !!state.art).catch(error => {
      telemetry.errors++;
      telemetry.last = 'portrait: ' + (error?.message || error);
      return false;
    }); // The workshop can seek the real timeline only after this async portrait composite is ready.
    telemetry.grabs++;
    telemetry.last = 'attached';
  }

  function onTick(attacker, host, shared) {
    const state = active.get(attacker);
    if (!state || state.disposed) return;
    state.elapsed = shared.t; // Attachment's single clock prevents animation drift on low-FPS mobile.
    const t = state.elapsed;
    if (t < PULL_S * 2) {
      const part = t % PULL_S;
      state.stretch = HEAD_STRETCH * heartbeatPull(part); // First two reversible pulls retain their fast yank and slow recoil.
      if (state.neckLock) state.neckLock.pitch = 0;
    } else if (t < PULL_S * 2 + FINAL_PULL_S) {
      const progress = smoothstep((t - PULL_S * 2) / FINAL_PULL_S);
      state.stretch = FINAL_HEAD_STRETCH * progress; // Third pull grows farther than both heartbeat pulls, over exactly three seconds.
      if (state.neckLock) state.neckLock.pitch = FINAL_HEAD_PITCH_RAD * progress; // Rotates victim's neck backward toward the Headtaker, not the entire body.
    } else {
      if (state.neckLock) state.neckLock.pitch = 0;
      state.stretch = 0;
      showHeadless(state);
      if (state.headRemoved) animateHeadThrow(state, t - PULL_S * 2 - FINAL_PULL_S);
    }
    if (!state.headRemoved) stretch(state, state.stretch);
    applyVictimNeckPose(state); // Restore owned neck pitch after any competing head-look writer, preserving body locomotion.
    poseFeet(state);
    if (t >= PULL_S * 2 + FINAL_PULL_S + THROW_S && state.headRemoved) {
      killTarget(state);
      state.endRequested = true; // Manual attachment ends after onTick unwinds, avoiding double callbacks.
    }
  }

  function onDetach(attacker, _host, reason) {
    const state = active.get(attacker);
    if (!state) return;
    if (reason === 'host-dodged') telemetry.dodges++;
    dispose(state, reason);
    attacker.attackCooldownT = Math.max(attacker.attackCooldownT || 0, COOLDOWN_S);
  }

  function update(attacker, dt, target) {
    if (!attacker?.isMaskboundGuardian || attacker.maskboundTroop !== 'headtaker') return null;
    const state = active.get(attacker);
    if (state && !alive(attacker)) {
      window.Combat.attach?.endManual?.(attacker, state.shared, 'attacker-died');
      dispose(state, 'attacker-died');
      return { handled: true, moving: false, aimAngle: attacker.facing || 0 };
    }
    if (state?.stage === 'grip') {
      const live = window.Combat.attach?.updateManual?.(attacker, state.shared, dt);
      if (live && !state.disposed) alignBehindPortrait(state, state.host);
      if (state.endRequested && live) window.Combat.attach?.endManual?.(attacker, state.shared, 'completed');
      if (!live && !state.disposed) dispose(state, 'attachment-lost');
      return { handled: true, moving: false, aimAngle: attacker.facing || 0 };
    }
    if (state?.stage === 'leap') {
      if (!alive(state.target) || (attacker.areaId && state.target.areaId && attacker.areaId !== state.target.areaId)) {
        dispose(state, 'target-lost');
        return { handled: true, moving: false, aimAngle: attacker.facing || 0 };
      }
      state.elapsed += Math.min(0.1, Math.max(0, dt));
      const descentStart = LEAP_S - DESCEND_S; // Until this instant the Headtaker climbs and vanishes above the camera.
      const descending = state.elapsed >= descentStart;
      state.descending = descending; // Preview must preserve the world-space skyfall height while descending, not overwrite it with a generic hop.
      const descent = clamp01((state.elapsed - descentStart) / DESCEND_S);
      const approach = smoothstep(descent); // Live sky-to-host motion with zero end velocity, no frame-one snap.
      const tile = Number(deps().TILE) || 64;
      const inCircle = Math.hypot(state.target.x - state.landX, state.target.y - state.landY) <= tile;
      if (descending) alignBehindPortrait(state, state.target); // Align the portrait frame BEFORE measuring its actual centroid offset.
      const pose = inCircle && humanoid(state.target)
        ? window.Combat.attach?.poseFor?.(attacker, ID, state.target) : null; // Exact same anchor the attach system will use on contact.
      if (!descending) {
        attacker._banditLungeHopCurrent = SKY_HEIGHT * smoothstep(state.elapsed / ASCEND_S);
        if (attacker.avatarRef?.group) attacker.avatarRef.group.visible = state.elapsed < ASCEND_S * 0.75; // Disappear once genuinely above view.
      } else {
        const destX = pose?.x ?? state.landX, destY = pose?.y ?? state.landY;
        attacker.x = state.landX + (destX - state.landX) * approach; // Target can move within the committed circle; airborne X/Z follow in real time.
        attacker.y = state.landY + (destY - state.landY) * approach;
        const landingHop = pose?.hop ?? 0;
        attacker._banditLungeHopCurrent = SKY_HEIGHT * (1 - approach) + landingHop * approach; // Continuous sky-to-grip height; never jump by the host's anchor offset when descent starts.
        if (attacker.avatarRef?.group) {
          attacker.avatarRef.group.visible = true; // Above-frame descent becomes visible naturally as it enters the camera.
          if (pose?.worldY != null) {
            const apexY = (Number(state.launchWorldY) || 0) + SKY_HEIGHT; // Captured initial render height gives the same sky origin on every replay.
            attacker.avatarRef.group.position.y = apexY * (1 - approach) + pose.worldY * approach; // Lerp the *visible* portrait root, not only the renderer's hop accumulator.
          }
        }
      }
      if (state.marker) state.marker.material.opacity = 0.40 + 0.25 * Math.sin(state.elapsed * 13) ** 2; // AoE remains grounded at the locked landing tile.
      if (state.elapsed >= LEAP_S) {
        removeLandingMarker(state);
        const dx = state.target.x - state.landX, dy = state.target.y - state.landY;
        telemetry.landings++;
        if (Math.hypot(dx, dy) <= tile && humanoid(state.target)
          && !state.target.dodging && !(Number(state.target.dodgeT) > 0) && !state.target._enemyDodge) { // Dodge at the landing frame evades the grip immediately, rather than briefly attaching before the next tick.
          // Landing is still dodgeable by leaving the original 1-tile circle; the visible descent ends exactly at the shared grip anchor.
          state.shared = window.Combat.attach?.beginManual?.(attacker, ID, state.target, { immediate: true });
          if (!state.shared) dispose(state, 'grip-blocked');
          else alignBehindPortrait(state, state.target);
        } else {
          attacker.x = state.landX; attacker.y = state.landY;
          const evaded = state.target.dodging || Number(state.target.dodgeT) > 0 || !!state.target._enemyDodge;
          if (evaded) telemetry.dodges++;
          dispose(state, evaded ? 'host-dodged' : 'miss');
        }
        if (state.disposed) attacker.attackCooldownT = Math.max(attacker.attackCooldownT || 0, COOLDOWN_S);
      }
      return { handled: true, moving: false, aimAngle: attacker.facing || 0 };
    }
    if (!humanoid(target) || !alive(target)) return { handled: true, moving: false, aimAngle: attacker.facing || 0 }; // Never target animals or use fallback melee.
    if (attacker.attackCooldownT > 0 || attacker._banditAction || attacker._enemyDodge || attacker.prone) return { handled: true, moving: false, aimAngle: attacker.facing || 0 };
    const tile = Number(deps().TILE) || 64;
    if (Math.hypot(target.x - attacker.x, target.y - attacker.y) > tile * 4.5) {
      const speed = attacker.def?.chaseSpeed || tile * 3;
      const moving = deps().moveCreatureToward?.(attacker, target.x, target.y, speed, dt) || false;
      return { handled: true, moving, aimAngle: Math.atan2(target.y - attacker.y, target.x - attacker.x) };
    }
    const next = {
      attacker, target, host: null, stage: 'leap', elapsed: 0,
      landX: target.x, landY: target.y, disposed: false,
      launchWorldY: Number(attacker.avatarRef?.group?.position?.y) || 0, // Start of the visual sky-to-attachment world-space interpolation.
      completed: false, headRemoved: false,
    }; // Fixed launch-time destination makes the circular AoE dodgeable.
    active.set(attacker, next);
    createLandingMarker(next);
    attacker.facing = Math.atan2(target.y - attacker.y, target.x - attacker.x);
    telemetry.begins++;
    telemetry.last = 'leaping';
    return { handled: true, moving: false, aimAngle: attacker.facing };
  }

  function install() {
    const attach = window.Combat?.attach;
    if (!attach?.register || !attach?.beginManual || !window.BanditCombat?.updateCombatAI) return false;
    attach.register(ID, {
      label: 'Skyfall Head Grip',
      durationS: ATTACH_DURATION_S,
      cooldownS: COOLDOWN_S,
      maxPerHost: 1,
      verticalAnchor: 'upper-quarter',
      heightAboveHost: -0.3,
      resolvePose: resolveHeadtakerPose, // Match true X/Y portrait centroids and project arm-length depth along the host's actual rear normal.
      tickIntervalS: 0.05,
      detachOnHostDodge: true,
      immuneToHost: false,
      staggerImmune: true, // Third-party hits do not interrupt a grapple; the target's own roll does.
      onAttach, onTick, onDetach,
    });
    const previousToolUpdate = window.BanditCombat.updateToolMesh; // The ordinary tool renderer re-shows hidden weapons every frame; block it for this unarmed troop.
    if (!previousToolUpdate.__maskboundHeadtaker) {
      const toollessUpdate = function maskboundHeadtakerUnarmedToolPose(entity, ...rest) {
        if (entity?.maskboundTroop !== 'headtaker') return previousToolUpdate.call(this, entity, ...rest);
        if (entity._banditToolHolder) entity._banditToolHolder.visible = false;
        if (entity._banditRangedToolHolder) entity._banditRangedToolHolder.visible = false;
        const data = entity.avatarRef?.handRigAvatarRoot?.userData;
        if (data) { data.proceduralHandToolHolder = null; data.proceduralHandToolKey = null; }
      };
      toollessUpdate.__maskboundHeadtaker = true;
      window.BanditCombat.updateToolMesh = toollessUpdate;
    }
    const original = window.BanditCombat.updateCombatAI;
    if (original.__maskboundHeadtaker) return true;
    const wrapped = function maskboundHeadtakerCombatAI(entity, dt, target, ...args) {
      if (entity?.maskboundTroop === 'headtaker') return update(entity, dt, target);
      return original.call(this, entity, dt, target, ...args);
    };
    wrapped.__maskboundHeadtaker = true;
    window.BanditCombat.updateCombatAI = wrapped;
    return true;
  }

  function cancel(attacker, reason = 'cancelled') {
    const state = active.get(attacker);
    if (!state) return false;
    if (state.shared) window.Combat.attach?.endManual?.(attacker, state.shared, reason);
    if (!state.disposed) dispose(state, reason);
    return true;
  }

  window.MaskboundHeadtaker = Object.freeze({
    id: ID, install, update, cancel, isDescending: attacker => { const state = active.get(attacker); return state?.stage === 'leap' && !!state.descending; }, // The world-space sky-to-portrait lerp currently owns this avatar's visible Y.
    headArtReady: attacker => active.get(attacker)?.artReady || Promise.resolve(false), // Awaitable portrait composite for deterministic, frame-independent workshop scrubbing.
    getDebug: () => ({ ...telemetry }),
    tuning: Object.freeze({ leapS: LEAP_S, descentS: DESCEND_S, skyHeight: SKY_HEIGHT, rearArmFraction: REAR_ARM_FRACTION, targetHeightFraction: TARGET_HEIGHT_FRACTION, attackerLeanDegrees: 15, finalHeadPitchDegrees: 40, finalHeadStretch: FINAL_HEAD_STRETCH, pullImpulseFraction: PULL_IMPULSE_FRAC, neckStretch: HEAD_STRETCH, radiusTiles: 1, reversiblePullS: PULL_S, repetitions: 2, finalPullS: FINAL_PULL_S, throwS: THROW_S }),
  });
  install();
})();

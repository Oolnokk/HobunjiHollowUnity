// Held-item-local hand grip sockets shared by gameplay and the Attack Animation Editor.
// The primary frame is authored ON the held item: changing it repositions/rotates the
// item around the unchanged right-hand socket. The optional secondary frame follows
// that corrected item and places the left hand. No arm reach or IK participates.
(function (global) {
  'use strict';

  const SCHEMA = 'hobunji_hand_tool_grips.v1';
  const LOCAL_KEY = 'hobunji.handToolGrips.v1';
  const SECONDARY_GRIP_PRESET = 'all-disabled-v1'; // One-time migration marker that clears every currently authored second-hand toggle.
  const CRAFTED_METAL_SUFFIX = /-(?:nativecopper|lowtinbronze|tinbronze|hightinbronze|arsenicalbronze|leadedbronze|tumbaga)$/; // Used by toolKeyFor so one shape grip serves every crafted metal variant.
  const visualBases = new WeakMap(); // Remembers each weapon preview/runtime mesh's uncorrected local transform so grip edits never accumulate.

  function identityTransform() {
    return {
      position: { x: 0, y: 0, z: 0 },
      rotationDeg: { pitch: 0, yaw: 0, roll: 0 },
    };
  }

  const DEFAULT_DATA = {
    schema: SCHEMA,
    secondaryGripPreset: SECONDARY_GRIP_PRESET,
    tools: {
      // Retain the old draft coordinates for later reauthoring, but no existing
      // tool/animation starts with its secondary hand attached.
      hatchet: {
        secondaryGrip: {
          enabled: false,
          position: { x: 0, y: -0.28, z: 0 },
          rotationDeg: { pitch: 0, yaw: 0, roll: 0 },
        },
      },
      hoe: {
        secondaryGrip: {
          enabled: false,
          position: { x: 0, y: -0.32, z: 0 },
          rotationDeg: { pitch: 0, yaw: 0, roll: 0 },
        },
      },
    },
  };

  const clone = value => JSON.parse(JSON.stringify(value));
  const listeners = new Set();

  function normalizeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function toolKeyFor(value) {
    const key = normalizeKey(value).replace(CRAFTED_METAL_SUFFIX, '');
    if (key.includes('hatchet')) return 'hatchet';
    if (key.includes('hoe')) return 'hoe';
    if (key.includes('pickshovel') || key.includes('pick-shovel')) return 'pickshovel';
    if (key.includes('fishingspear') || key.includes('fishing-spear')) return 'fishingspear';
    if (key.includes('fishingmace') || key.includes('fishing-mace')) return 'fishingmace';
    return key;
  }

  function numberOrZero(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function normalizeTransform(raw) {
    return {
      position: {
        x: numberOrZero(raw?.position?.x),
        y: numberOrZero(raw?.position?.y),
        z: numberOrZero(raw?.position?.z),
      },
      rotationDeg: {
        pitch: numberOrZero(raw?.rotationDeg?.pitch),
        yaw: numberOrZero(raw?.rotationDeg?.yaw),
        roll: numberOrZero(raw?.rotationDeg?.roll),
      },
    };
  }

  function normalizeGripMode(raw) {
    const key = String(raw || '').trim();
    return key || null;
  }

  function normalizeData(raw) {
    const next = clone(raw || DEFAULT_DATA);
    const disableExistingSecondaryGrips = next.secondaryGripPreset !== SECONDARY_GRIP_PRESET; // True only for pre-change saved/editor data.
    next.schema = SCHEMA;
    next.secondaryGripPreset = SECONDARY_GRIP_PRESET;
    if (!next.tools || typeof next.tools !== 'object') next.tools = {};
    for (const entry of Object.values(next.tools)) {
      if (!entry || typeof entry !== 'object') continue;
      entry.primaryGrip = normalizeTransform(entry.primaryGrip);
      const secondary = entry.secondaryGrip || {};
      entry.secondaryGrip = {
        enabled: disableExistingSecondaryGrips ? false : secondary.enabled === true,
        ...normalizeTransform(secondary),
      };
      entry.gripMode = normalizeGripMode(entry.gripMode);
    }
    return next;
  }

  let data = normalizeData(DEFAULT_DATA);

  // Small quaternion helpers keep this data module independent of whichever THREE
  // instance the game/editor owns. They use the same YXZ order as the hand driver.
  function multiplyQuaternion(a, b) {
    return {
      x: a.x * b.w + a.w * b.x + a.y * b.z - a.z * b.y,
      y: a.y * b.w + a.w * b.y + a.z * b.x - a.x * b.z,
      z: a.z * b.w + a.w * b.z + a.x * b.y - a.y * b.x,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  }

  function quaternionFromDeg(rotation = {}) {
    const halfPitch = numberOrZero(rotation.pitch) * Math.PI / 360; // Used below to build the authored grip's X rotation.
    const halfYaw = numberOrZero(rotation.yaw) * Math.PI / 360; // Used below to build the authored grip's Y rotation.
    const halfRoll = numberOrZero(rotation.roll) * Math.PI / 360; // Used below to build the authored grip's Z rotation.
    const qYaw = { x: 0, y: Math.sin(halfYaw), z: 0, w: Math.cos(halfYaw) }; // First term in the hand driver's YXZ composition.
    const qPitch = { x: Math.sin(halfPitch), y: 0, z: 0, w: Math.cos(halfPitch) }; // Second term in the hand driver's YXZ composition.
    const qRoll = { x: 0, y: 0, z: Math.sin(halfRoll), w: Math.cos(halfRoll) }; // Final term in the hand driver's YXZ composition.
    return multiplyQuaternion(multiplyQuaternion(qYaw, qPitch), qRoll);
  }

  function inverseQuaternion(q) {
    const lengthSq = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w || 1; // Normalizes inversion for authored values that have accumulated float drift.
    return { x: -q.x / lengthSq, y: -q.y / lengthSq, z: -q.z / lengthSq, w: q.w / lengthSq };
  }

  function rotateVector(q, value) {
    const vectorQ = { x: numberOrZero(value?.x), y: numberOrZero(value?.y), z: numberOrZero(value?.z), w: 0 }; // Temporary quaternion used to rotate a local grip offset.
    const rotated = multiplyQuaternion(multiplyQuaternion(q, vectorQ), inverseQuaternion(q)); // q * v * q^-1 matches THREE.Vector3.applyQuaternion.
    return { x: rotated.x, y: rotated.y, z: rotated.z };
  }

  function quaternionToDegYXZ(q) {
    const normalized = (() => {
      const length = Math.hypot(q.x, q.y, q.z, q.w) || 1; // Keeps matrix terms stable before Euler extraction.
      return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
    })();
    const { x, y, z, w } = normalized;
    const m11 = 1 - 2 * (y * y + z * z); // Rotation-matrix terms used by THREE.Euler's YXZ extraction.
    const m13 = 2 * (x * z + y * w);
    const m21 = 2 * (x * y + z * w);
    const m22 = 1 - 2 * (x * x + z * z);
    const m23 = 2 * (y * z - x * w);
    const m31 = 2 * (x * z - y * w);
    const m33 = 1 - 2 * (x * x + y * y);
    const clamp = value => Math.max(-1, Math.min(1, value));
    const pitch = Math.asin(-clamp(m23)); // X in YXZ order.
    const yaw = Math.abs(m23) < 0.9999999 ? Math.atan2(m13, m33) : Math.atan2(-m31, m11); // Y in YXZ order.
    const roll = Math.abs(m23) < 0.9999999 ? Math.atan2(m21, m22) : 0; // Z in YXZ order.
    return { pitch: pitch * 180 / Math.PI, yaw: yaw * 180 / Math.PI, roll: roll * 180 / Math.PI };
  }

  function inverseTransform(raw) {
    const transform = normalizeTransform(raw); // Canonical authored frame inverted below for moving the weapon, not the hand.
    const inverseRotation = inverseQuaternion(quaternionFromDeg(transform.rotationDeg)); // Rotation that returns the authored grip axes to the fixed hand socket axes.
    const inversePosition = rotateVector(inverseRotation, {
      x: -transform.position.x,
      y: -transform.position.y,
      z: -transform.position.z,
    }); // Translation that brings the authored grip point to the fixed socket origin after rotation.
    return { position: inversePosition, quaternion: inverseRotation };
  }

  function composePrimaryInverseWithSecondary(primaryRaw, secondaryRaw) {
    const primary = normalizeTransform(primaryRaw); // Primary item frame becomes the origin after visual correction.
    const secondary = normalizeTransform(secondaryRaw); // Secondary item frame must follow the same corrected item.
    const inversePrimaryRotation = inverseQuaternion(quaternionFromDeg(primary.rotationDeg)); // Converts item-local secondary rotation into fixed-socket space.
    const relativePosition = rotateVector(inversePrimaryRotation, {
      x: secondary.position.x - primary.position.x,
      y: secondary.position.y - primary.position.y,
      z: secondary.position.z - primary.position.z,
    }); // P^-1 * S translation used by the left-hand socket.
    const relativeRotation = multiplyQuaternion(inversePrimaryRotation, quaternionFromDeg(secondary.rotationDeg)); // P^-1 * S orientation used by the left-hand socket.
    return {
      position: relativePosition,
      rotationDeg: quaternionToDegYXZ(relativeRotation),
    };
  }

  function authoredPrimaryGripForTool(value) {
    const key = toolKeyFor(value);
    return normalizeTransform(data.tools?.[key]?.primaryGrip);
  }

  // The existing frame driver asks this function where to put the RIGHT HAND.
  // The right hand must stay on its authored holder socket, so this intentionally
  // returns identity; authoredPrimaryGripForTool() is the actual point on the item.
  function primaryGripForTool() {
    return identityTransform();
  }

  function secondaryGripForTool(value) {
    const key = toolKeyFor(value);
    const raw = data.tools?.[key]?.secondaryGrip;
    if (!raw?.enabled) return null;
    return {
      enabled: true,
      ...composePrimaryInverseWithSecondary(data.tools?.[key]?.primaryGrip, raw),
    };
  }

  function visualBaseFor(node) {
    if (!node?.position || !node?.quaternion) return null;
    let base = visualBases.get(node); // Cached uncorrected mesh transform reused on every grip edit/frame.
    if (!base) {
      base = {
        position: node.position.clone(),
        quaternion: node.quaternion.clone(),
      };
      visualBases.set(node, base);
    }
    return base;
  }

  function restoreVisualBase(node) {
    const base = visualBaseFor(node); // Restores the sprite before viewport picking so clicked coordinates remain in the authored item frame.
    if (!base) return;
    node.position.copy(base.position);
    node.quaternion.copy(base.quaternion);
    node.updateMatrix?.();
  }

  function applyPrimaryCorrection(node, primaryRaw) {
    const base = visualBaseFor(node); // Original mesh transform is composed after the inverse grip correction instead of overwritten/accumulated.
    if (!base) return;
    const correction = inverseTransform(primaryRaw); // P^-1 moves the weapon until its authored grip frame coincides with the unchanged right-hand socket.
    const correctedBasePosition = rotateVector(correction.quaternion, base.position); // Applies correction rotation to any pre-existing mesh-local offset.
    node.position.set(
      correction.position.x + correctedBasePosition.x,
      correction.position.y + correctedBasePosition.y,
      correction.position.z + correctedBasePosition.z,
    );
    const QuaternionCtor = node.quaternion.constructor; // Uses the scene's own THREE instance rather than assuming window.THREE exists in the editor.
    const correctionQ = new QuaternionCtor(correction.quaternion.x, correction.quaternion.y, correction.quaternion.z, correction.quaternion.w); // THREE quaternion used to compose the actual mesh transform.
    node.quaternion.copy(correctionQ.multiply(base.quaternion));
    node.updateMatrix?.();
  }

  function visibleToolVisualUnder(holder) {
    let fallback = null; // First tool-plane root is used only when visibility metadata cannot identify the active one.
    let visible = null; // Preferred currently visible tool-plane root used by runtime grip correction.
    holder?.traverse?.(node => {
      if (!node?.userData?.toolPlane?.isObject3D) return;
      fallback ||= node;
      if (!visible && node.visible !== false && node.userData.toolPlane.visible !== false) visible = node;
    });
    return visible || fallback;
  }

  function editorGripPickActive() {
    return document.getElementById('handPrimaryGripPick')?.classList.contains('active') === true;
  }

  function applyEditorPrimaryCorrection() {
    const context = global.HobunjiAttackEditorToolContext; // Stable bridge exported by the Attack Animation Editor for grip preview ownership.
    const visual = context?.toolPlaneMesh || null; // Current editor weapon/tool group corrected around the fixed hand socket.
    if (!visual) return;
    if (editorGripPickActive()) {
      restoreVisualBase(visual);
      return;
    }
    const key = toolKeyFor(context.toolKey || document.getElementById('toolSpriteSelect')?.value || ''); // Current editor selection chooses the shared per-shape grip.
    applyPrimaryCorrection(visual, data.tools?.[key]?.primaryGrip);
    const marker = context.toolHolder?.getObjectByName?.('primary_right_hand_grip_marker') || null; // Existing marker now represents the fixed socket after the weapon has moved around it.
    if (marker) {
      marker.position.set(0, 0, 0);
      marker.quaternion.identity();
      marker.updateMatrix?.();
    }
  }

  function applyRuntimePrimaryCorrection() {
    const handRuntime = global.ProceduralHandAttachments; // Provides the player tool holder and tool mesh map once gameplay finishes initializing.
    const deps = handRuntime?.gameDeps || null; // Same injected runtime dependencies already consumed by the procedural hand frame driver.
    const holder = deps?.toolHolder || null; // Fixed authored hand-socket parent; this object itself is never grip-corrected.
    if (!holder) return;
    const snapshot = global.WeaponToolStances?.debugSnapshot?.() || null; // Current active held item/slot used to pick the correct visual and authored grip.
    const activeSlot = snapshot?.activeSlot || deps?.getActiveTool?.() || null; // Slot key used to prefer the exact active tool mesh when available.
    const visual = (activeSlot && (deps?.toolMeshMap?.get?.(activeSlot) || deps?.toolMeshMap?.[activeSlot])) || visibleToolVisualUnder(holder); // Only the weapon/tool visual moves; holder and hand stay authored.
    const itemKey = snapshot?.itemKey || snapshot?.shape || deps?.equipmentSlots?.[activeSlot] || ''; // Crafted metal variants collapse to the shared shape key below.
    if (!visual || !itemKey) return;
    applyPrimaryCorrection(visual, authoredPrimaryGripForTool(itemKey));
  }

  function applyPrimaryGripVisuals() {
    if (/\/tools\/attack-animation-editor\//.test(location.pathname)) applyEditorPrimaryCorrection();
    else applyRuntimePrimaryCorrection();
  }

  function notify() {
    applyPrimaryGripVisuals();
    for (const listener of listeners) {
      try { listener(data); } catch (_) {}
    }
    global.ProceduralHandFrameDriver?.syncNow?.();
  }

  function replace(next) {
    if (!next || next.schema !== SCHEMA) throw new Error(`Expected ${SCHEMA}`);
    data = normalizeData(next);
    notify();
    return data;
  }

  function mutate(mutator) {
    mutator(data);
    data = normalizeData(data);
    notify();
    return data;
  }

  function ensureTool(value) {
    const key = toolKeyFor(value);
    if (!key) return null;
    if (!data.tools[key]) data.tools[key] = { primaryGrip: identityTransform(), secondaryGrip: { enabled: false, ...identityTransform() } };
    if (!data.tools[key].primaryGrip) data.tools[key].primaryGrip = identityTransform();
    if (!data.tools[key].secondaryGrip) data.tools[key].secondaryGrip = { enabled: false, ...identityTransform() };
    return data.tools[key];
  }

  // Explicit per-tool grip-mode override authored in the Attack Animation Editor.
  // Absent/null means callers should fall back to their own tool-name heuristic;
  // this keeps every tool's default unchanged until an artist deliberately commits
  // a choice here, and shares that choice between the editor and the live game.
  function gripModeForTool(value) {
    const key = toolKeyFor(value);
    return data.tools?.[key]?.gripMode || null;
  }

  function setGripMode(value, modeKey) {
    const key = toolKeyFor(value);
    if (!key) return null;
    if (!data.tools[key]) data.tools[key] = { primaryGrip: identityTransform(), secondaryGrip: { enabled: false, ...identityTransform() } };
    data.tools[key].gripMode = normalizeGripMode(modeKey);
    notify();
    return data.tools[key].gripMode;
  }

  function saveLocal() { localStorage.setItem(LOCAL_KEY, JSON.stringify(data)); }
  function loadLocal() {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return false;
    replace(JSON.parse(raw));
    return true;
  }
  function clearLocal() {
    localStorage.removeItem(LOCAL_KEY);
    data = normalizeData(DEFAULT_DATA);
    notify();
  }

  global.HobunjiHandToolGrips = {
    schema: SCHEMA,
    get data() { return data; },
    get defaultData() { return normalizeData(DEFAULT_DATA); },
    clone: () => clone(data),
    toolKeyFor,
    ensureTool,
    authoredPrimaryGripForTool,
    primaryGripForTool,
    secondaryGripForTool,
    gripModeForTool,
    setGripMode,
    replace,
    mutate,
    saveLocal,
    loadLocal,
    clearLocal,
    applyPrimaryGripVisuals,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };

  function frame() {
    applyPrimaryGripVisuals();
    global.requestAnimationFrame(frame);
  }
  global.requestAnimationFrame(frame);
})(window);

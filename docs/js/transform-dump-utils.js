// Shared local-transform dump utility for the Attack Animation Editor's preview
// and the in-game Pixel Probe, so both can report the exact same fields in the
// exact same format for every node under a given root (avatar body, tool
// holder, hand sockets, head/neck bone, ...) — letting an editor-authored
// preview be diffed node-for-node against what a character actually renders
// with in the live game.
//
// Deliberately has no THREE.js dependency (reads only plain instance
// properties/methods every Object3D already has: position/quaternion/scale/
// children/getWorldPosition) so the exact same code runs unmodified in the
// editor's ESM/import-map Three instance and the game's classic global THREE.
(function (global) {
  'use strict';

  function toDeg(rad) { return rad * 180 / Math.PI; }
  function clamp(value) { return Math.max(-1, Math.min(1, value)); }

  // Same YXZ (pitch=X, yaw=Y, roll=Z) decomposition used throughout the hand/
  // tool authoring code (hand-model-profiles.js's eulerYXZFromQuat, hand-grip-
  // modes.js's copy) — kept independent of any THREE reference for the reason
  // above.
  function eulerYXZFromQuat(q) {
    const x = Number(q?.x) || 0;
    const y = Number(q?.y) || 0;
    const z = Number(q?.z) || 0;
    const w = Number.isFinite(Number(q?.w)) ? Number(q.w) : 1;
    const length = Math.hypot(x, y, z, w) || 1;
    const nx = x / length, ny = y / length, nz = z / length, nw = w / length;
    const m13 = 2 * (nx * nz + ny * nw);
    const m21 = 2 * (nx * ny + nz * nw);
    const m22 = 1 - 2 * (nx * nx + nz * nz);
    const m23 = 2 * (ny * nz - nx * nw);
    const m31 = 2 * (nx * nz - ny * nw);
    const m33 = 1 - 2 * (nx * nx + ny * ny);
    const m11 = 1 - 2 * (ny * ny + nz * nz);
    const pitch = Math.asin(-clamp(m23));
    let yaw, roll;
    if (Math.abs(m23) < 0.9999999) {
      yaw = Math.atan2(m13, m33);
      roll = Math.atan2(m21, m22);
    } else {
      yaw = Math.atan2(-m31, m11);
      roll = 0;
    }
    return { pitch: toDeg(pitch), yaw: toDeg(yaw), roll: toDeg(roll) };
  }

  // Walks the subtree in document order, recording each node's LOCAL position/
  // rotation/scale (i.e. relative to its own immediate parent, exactly what
  // authored offsets in this codebase are always expressed in) plus its world
  // position for cross-referencing between two different scene roots (the
  // editor's preview rig vs. a live game character).
  function dumpSubtree(root, options = {}) {
    if (!root?.isObject3D) return [];
    const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : Infinity;
    const entries = [];
    let index = 0;
    (function walk(node, depth) {
      const i = index++;
      const p = node.position, q = node.quaternion, s = node.scale;
      let worldPosition = null;
      try {
        if (typeof node.getWorldPosition === 'function') {
          const target = new p.constructor();
          node.getWorldPosition(target);
          worldPosition = { x: target.x, y: target.y, z: target.z };
        }
      } catch (_) { /* best-effort — local fields below still stand */ }
      entries.push({
        depth,
        name: node.name || `(unnamed ${node.type || 'Object3D'} #${i})`,
        type: node.type || (node.isMesh ? 'Mesh' : node.isBone ? 'Bone' : node.isGroup ? 'Group' : 'Object3D'),
        visible: node.visible !== false,
        localPosition: { x: p.x, y: p.y, z: p.z },
        localRotationDeg: eulerYXZFromQuat(q),
        localQuaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
        localScale: { x: s.x, y: s.y, z: s.z },
        worldPosition,
      });
      if (depth >= maxDepth) return;
      for (const child of node.children || []) walk(child, depth + 1);
    })(root, 0);
    return entries;
  }

  // Captures one Object3D without walking its children. This is used by the
  // rig-parity reports, where a small, fixed set of semantic transforms is
  // more useful than a complete scene graph. World rotation/scale are
  // included because an innocent-looking unit local scale can still render
  // differently after inheriting a scaled parent.
  function snapshotObject(label, object, options = {}) {
    if (!object?.isObject3D) return null;
    object.updateWorldMatrix?.(true, false);
    const localRotationDeg = eulerYXZFromQuat(object.quaternion);
    let worldPosition = null, worldRotationDeg = null, worldScale = null;
    try {
      worldPosition = object.getWorldPosition(new object.position.constructor());
      const worldQuaternion = object.getWorldQuaternion(new object.quaternion.constructor());
      worldRotationDeg = eulerYXZFromQuat(worldQuaternion);
      worldScale = object.getWorldScale(new object.scale.constructor());
    } catch (_) { /* local values still make the report useful */ }
    return {
      label,
      source: options.source || object.name || object.type || 'Object3D',
      localPosition: { x: object.position.x, y: object.position.y, z: object.position.z },
      localRotationDeg,
      localScale: { x: object.scale.x, y: object.scale.y, z: object.scale.z },
      worldPosition: worldPosition ? { x: worldPosition.x, y: worldPosition.y, z: worldPosition.z } : null,
      worldRotationDeg,
      worldScale: worldScale ? { x: worldScale.x, y: worldScale.y, z: worldScale.z } : null,
    };
  }

  function num(value, digits) { return Number(value).toFixed(digits); }

  function formatReport(entries, options = {}) {
    const title = options.title || 'Transform dump';
    const lines = [
      `=== ${title} (${entries.length} node(s)) ===`,
      'local pos/rot are each node relative to its own parent; rotation is pitch/yaw/roll YXZ Euler degrees, matching the rest of this codebase\'s authoring convention.',
    ];
    for (const e of entries) {
      const indent = '  '.repeat(e.depth);
      const pos = `(${num(e.localPosition.x, 4)}, ${num(e.localPosition.y, 4)}, ${num(e.localPosition.z, 4)})`;
      const rot = `P${num(e.localRotationDeg.pitch, 2)}° Y${num(e.localRotationDeg.yaw, 2)}° R${num(e.localRotationDeg.roll, 2)}°`;
      const notUnitScale = Math.abs(e.localScale.x - 1) > 1e-6 || Math.abs(e.localScale.y - 1) > 1e-6 || Math.abs(e.localScale.z - 1) > 1e-6;
      const scale = notUnitScale ? ` scale(${num(e.localScale.x, 3)}, ${num(e.localScale.y, 3)}, ${num(e.localScale.z, 3)})` : '';
      const world = e.worldPosition ? ` world(${num(e.worldPosition.x, 4)}, ${num(e.worldPosition.y, 4)}, ${num(e.worldPosition.z, 4)})` : '';
      const visFlag = e.visible ? '' : ' [hidden]';
      lines.push(`${indent}${e.name} [${e.type}]${visFlag} local=${pos} ${rot}${scale}${world}`);
    }
    return lines.join('\n');
  }

  function tuple(value, digits = 4) {
    if (!value) return '-';
    return `(${num(value.x, digits)}, ${num(value.y, digits)}, ${num(value.z, digits)})`;
  }

  function angles(value) {
    if (!value) return '-';
    return `(X${num(value.pitch ?? value.x, 2)}°, Y${num(value.yaw ?? value.y, 2)}°, Z${num(value.roll ?? value.z, 2)}°)`;
  }

  // Formats editor and runtime rig snapshots field-for-field. Callers may
  // mix snapshotObject() results with virtual runtime anchors, as long as
  // they provide the same local*/world* fields.
  function formatNamedTransformReport(entries, options = {}) {
    const title = options.title || 'Rig transform parity dump';
    const lines = [
      `=== ${title} ===`,
      `actor=${options.actor || '-'} species=${options.species || '-'} gender=${options.gender || '-'} coordinateSpace=${options.coordinateSpace || 'unspecified'}`,
      'local = transform relative to the reported object\'s gameplay/editor parent; world = composed transform after every parent translation/rotation/scale.',
    ];
    for (const entry of entries.filter(Boolean)) {
      lines.push('');
      lines.push(`[${entry.label}] source=${entry.source || '-'}`);
      lines.push(`  local position=${tuple(entry.localPosition)} rotation=${angles(entry.localRotationDeg)} scale=${tuple(entry.localScale, 4)}`);
      lines.push(`  world position=${tuple(entry.worldPosition)} rotation=${angles(entry.worldRotationDeg)} scale=${tuple(entry.worldScale, 4)}`);
    }
    return lines.join('\n');
  }

  global.HobunjiTransformDump = Object.freeze({
    dumpSubtree,
    formatReport,
    eulerYXZFromQuat,
    snapshotObject,
    formatNamedTransformReport,
  });
})(window);

// Animation Author already loads this shared parity utility before its large
// inline application. Boot the two isolated preview-parity guards here so the
// real editor—not only their standalone test wrappers—actually executes them.
(function bootAnimationAuthorPreviewParityFixes() {
  'use strict';
  if (!/\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname || '')) return;
  const parityScripts = [
    '../../js/animation-author-preview-grounding-fix.js?v=20260903a',
    '../../js/animation-author-preview-rig-space-fix.js?v=20260903a',
  ]; // Used only to install the already-isolated grounding and rig-space guards in the production Animation Author.
  for (const src of parityScripts) {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    document.head.appendChild(script);
  }
})();

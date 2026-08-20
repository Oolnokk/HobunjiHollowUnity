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

  global.HobunjiTransformDump = Object.freeze({ dumpSubtree, formatReport, eulerYXZFromQuat });
})(window);

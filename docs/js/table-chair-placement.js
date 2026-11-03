(() => {
  'use strict';

  // Shared, tile-independent chair geometry for gameplay and furniture editors.
  const finite = (value, fallback) => {
    if (value == null || (typeof value === 'string' && !value.trim())) return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  function normalize(descriptor) {
    if (!descriptor || typeof descriptor !== 'object') return null;
    const distance = Math.max(0, Math.min(4, finite(descriptor.distance, 0.65)));
    if (descriptor.mode === 'orbit') {
      return { mode: 'orbit', angleDeg: ((finite(descriptor.angleDeg, 0) % 360) + 360) % 360, distance };
    }
    if (descriptor.mode === 'edge' && ['front', 'back', 'left', 'right'].includes(descriptor.side)) {
      return { mode: 'edge', side: descriptor.side, along: Math.max(0, Math.min(1, finite(descriptor.along, 0.5))), distance };
    }
    return null;
  }
  function modeForTable(key) {
    return /round/i.test(String(key || '')) ? 'orbit' : 'edge';
  }
  function localPosition(descriptor, width, depth) {
    const placement = normalize(descriptor);
    if (!placement) return null;
    const w = Math.max(0.1, finite(width, 1));
    const d = Math.max(0.1, finite(depth, 1));
    if (placement.mode === 'orbit') {
      const angle = placement.angleDeg * Math.PI / 180;
      const radius = Math.max(w, d) / 2 + placement.distance;
      return { x: Math.sin(angle) * radius, z: Math.cos(angle) * radius };
    }
    const x = (placement.along - 0.5) * w;
    const z = (placement.along - 0.5) * d;
    switch (placement.side) {
      case 'front': return { x, z: d / 2 + placement.distance };
      case 'back': return { x, z: -d / 2 - placement.distance };
      case 'right': return { x: w / 2 + placement.distance, z };
      default: return { x: -w / 2 - placement.distance, z };
    }
  }
  function apply(chair, table, descriptor, footprint = {}) {
    if (!chair || !table || !window.THREE?.Vector3 || !chair.position?.set || !table.localToWorld) return false;
    table.updateWorldMatrix?.(true, false);
    const scale = table.getWorldScale?.(new window.THREE.Vector3(1, 1, 1)) || table.scale || { x: 1, z: 1 };
    const sx = Math.max(1e-4, Math.abs(scale.x || 1));
    const sz = Math.max(1e-4, Math.abs(scale.z || 1));
    // Compute edge clearance in world tiles, then undo table scale before localToWorld applies it.
    const placement = localPosition(descriptor,
      Math.max(0.1, finite(footprint.width, 1)) * sx,
      Math.max(0.1, finite(footprint.depth, 1)) * sz);
    if (!placement) return false;
    const target = table.localToWorld(new window.THREE.Vector3(placement.x / sx, 0, placement.z / sz));
    const center = table.getWorldPosition(new window.THREE.Vector3());
    const currentWorld = chair.getWorldPosition ? chair.getWorldPosition(new window.THREE.Vector3()) : chair.position;
    target.y = currentWorld.y; // Seating height comes from the existing furniture grounding, never the tabletop.
    let localTarget = target, localCenter = center;
    if (chair.parent?.worldToLocal) {
      chair.parent.updateWorldMatrix?.(true, false);
      localTarget = chair.parent.worldToLocal(target.clone());
      localCenter = chair.parent.worldToLocal(center.clone());
    }
    chair.position.set(localTarget.x, localTarget.y, localTarget.z);
    chair.rotation.y = Math.atan2(localCenter.x - localTarget.x, localCenter.z - localTarget.z);
    chair.updateWorldMatrix?.(true, false);
    return true;
  }

  // Separating-axis test for two oriented physical footprints; attached chairs still collide despite not owning a tile.
  function overlapsFootprints(a, b) {
    if (![a, b].every(p => p && [p.x, p.z, p.width, p.depth, p.yaw].every(Number.isFinite))) return false;
    const basis = p => {
      const cos = Math.cos(p.yaw), sin = Math.sin(p.yaw);
      return [{ x: cos, z: -sin }, { x: sin, z: cos }];
    };
    const axesA = basis(a), axesB = basis(b);
    const separation = { x: b.x - a.x, z: b.z - a.z };
    const dot = (u, v) => u.x * v.x + u.z * v.z;
    for (const axis of [...axesA, ...axesB]) {
      const radiusA = Math.abs(dot(axis, axesA[0])) * a.width / 2 + Math.abs(dot(axis, axesA[1])) * a.depth / 2;
      const radiusB = Math.abs(dot(axis, axesB[0])) * b.width / 2 + Math.abs(dot(axis, axesB[1])) * b.depth / 2;
      if (Math.abs(dot(separation, axis)) >= radiusA + radiusB - 1e-6) return false;
    }
    return true;
  }

  // Registration passes the changed id, avoiding redundant NPC station writes during full-map restores.
  function refreshArea(area, entries, changedId = null) {
    const byId = new Map(Array.from(entries || [], entry => [String(entry.id), entry]));
    const selectedId = changedId == null ? null : String(changedId);
    let moved = 0;
    for (const entry of byId.values()) {
      const record = entry.record;
      if (selectedId !== null && String(entry.id) !== selectedId && String(record?.tableId) !== selectedId) continue;
      const descriptor = normalize(record?.tableAttachment);
      const parent = byId.get(String(record?.tableId));
      if (!descriptor || !parent?.root?.parent || !entry.root?.parent || entry === parent) continue;
      const before = entry.root.position.clone();
      const priorYaw = entry.root.rotation.y;
      if (!apply(entry.root, parent.root, descriptor, { width: parent.def?.fw || 1, depth: parent.def?.fd || 1 })) continue;
      const changed = before.distanceToSquared
        ? before.distanceToSquared(entry.root.position) > 1e-10
        : Math.abs(before.x - entry.root.position.x) + Math.abs(before.y - entry.root.position.y)
          + Math.abs(before.z - entry.root.position.z) > 1e-5;
      if (changed || Math.abs(priorYaw - entry.root.rotation.y) > 1e-5) {
        if (!String(area).startsWith('preview:')) window.HobunjiFurnitureTableAttachmentMoved?.(record); // Editor previews never modify game NPC stations.
        moved++;
      }
    }
    return moved;
  }
  window.TableChairPlacement = Object.freeze({ normalize, modeForTable, localPosition, overlapsFootprints, apply, refreshArea });
})();

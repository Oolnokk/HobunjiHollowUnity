// RopeFurniture — ropes as authored furniture.
//
// A furniture piece carries a `rope` block; placing the piece places a rope hanging from it:
//
//   rope: { version: 1, enabled: true,
//           anchor: { x, y, z },     // where the rope hangs from, in the piece's local space
//           length, maxLength,       // world units; maxLength is how far a rider can let it out
//           yawDeg,                  // swing direction, degrees from the piece's local +x (about +y)
//           restAngleDeg }           // initial displacement along that direction (0 = hanging straight)
//
// The piece is the ceiling mount (a plain box part is enough). The swinging rope, grip and behavior come
// from the shared rope model (js/rope-core.js):
//   * inside the Random Test Ruin the rope is built by the ruin runtime itself (addFurnitureRope), so a
//     player rides it exactly like a generated rope: the same 'Grab Rope' prompt, pumping, brake, collision
//     and release flight; HangingRopes adopts it so a burden can hang from it too;
//   * anywhere else it is an owned HangingRopes rope: burdens swing from it with the same behavior.
//
// Wiring: FurnitureTableSystem.registerPlacement/unregisterPlacement call register/unregister for any
// piece whose data has a `rope` block; composers call register directly.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RopeFurniture = api;
})(typeof self !== 'undefined' ? self : globalThis, function (root) {
  'use strict';

  const VERSION = 1;
  const RUIN_MAP = 'map_i_dev_random_ruin';
  const DEG = Math.PI / 180;
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

  // Defaults mirror the generated ropes: grip at a reachable height under a ceiling mount; a rider can let it out ~0.55 more.
  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || raw.enabled === false) return null;
    const length = Math.max(0.4, num(raw.length, 2.1));
    return {
      version: VERSION, enabled: true,
      anchor: { x: num(raw.anchor?.x, 0), y: num(raw.anchor?.y, 2.965), z: num(raw.anchor?.z, 0) },
      length, maxLength: Math.max(length, num(raw.maxLength, +(length + 0.55).toFixed(3))),
      yawDeg: num(raw.yawDeg, 0), restAngleDeg: Math.max(-70, Math.min(70, num(raw.restAngleDeg, 0))),
    };
  }

  // World-space rope description from a placed piece. `object` needs matrixWorld.elements (a THREE.Object3D, or
  // anything shaped like one) and may have updateWorldMatrix.
  function specFor(object, data, id) {
    const rope = normalize(data?.rope);
    if (!rope || !object) return null;
    object.updateWorldMatrix?.(true, false);
    const e = object.matrixWorld?.elements;
    if (!e || e.length < 16) return null;
    const { x, y, z } = rope.anchor, a = rope.yawDeg * DEG;
    // local +x and +z columns of the world matrix, projected onto the ground plane
    const dirX = Math.cos(a) * e[0] + Math.sin(a) * e[8], dirZ = Math.cos(a) * e[2] + Math.sin(a) * e[10];
    return {
      id: String(id), anchor: { x: e[0] * x + e[4] * y + e[8] * z + e[12], y: e[1] * x + e[5] * y + e[9] * z + e[13], z: e[2] * x + e[6] * y + e[10] * z + e[14] },
      yaw: Math.atan2(dirZ, dirX), length: rope.length, maxLength: rope.maxLength, angle: rope.restAngleDeg * DEG,
    };
  }

  // ------------------------------------------------------------ runtime registry
  const entries = new Map(); // `${area}|${id}` -> { area, id, object, rope, kind: 'ruin' | 'owned' }
  const keyOf = (area, id) => `${area}|${id}`;
  const sceneOf = object => { for (let n = object; n; n = n.parent) if (n.isScene) return n; return root.GridTileAccessors?.getActiveScene?.() || null; };

  // Places the rope for a placed piece. Returns the rope, or null if the piece has no rope block.
  function register(area, id, object, data) {
    const spec = specFor(object, data, id);
    if (!spec) return null;
    area = String(area); unregister(area, id);
    const HR = root.HangingRopes, ruin = root.DevRandomRuinSimplePuzzles;
    let rope = null, kind = 'owned';
    if (area === RUIN_MAP && ruin?.addFurnitureRope) {
      rope = ruin.addFurnitureRope(spec, object); // the ruin runtime owns, steps, draws and lets players ride it
      if (rope) { kind = 'ruin'; HR?.adoptRope?.(rope, { id: 'furniture_' + id, mapId: area, scene: sceneOf(object) }); }
    }
    if (!rope && HR) rope = HR.registerRope({ id: 'furniture_' + id, mapId: area, scene: sceneOf(object), mount: object, x: spec.anchor.x, y: spec.anchor.y, z: spec.anchor.z, yaw: spec.yaw, length: spec.length, maxLength: spec.maxLength, angle: spec.angle });
    if (!rope) return null;
    entries.set(keyOf(area, id), { area, id: String(id), object, rope, kind });
    return rope;
  }
  function unregister(area, id) {
    const key = keyOf(String(area), id), entry = entries.get(key);
    if (!entry) return false;
    root.HangingRopes?.removeRope?.(entry.rope); // lets go of any burden first
    if (entry.kind === 'ruin') root.DevRandomRuinSimplePuzzles?.removeFurnitureRope?.(entry.rope);
    entries.delete(key);
    return true;
  }
  const clearArea = area => { let n = 0; for (const entry of [...entries.values()]) if (entry.area === String(area) && unregister(entry.area, entry.id)) n++; return n; };
  const debugSnapshot = () => ({ ropes: [...entries.values()].map(e => ({ area: e.area, id: e.id, kind: e.kind })) });

  return Object.freeze({ VERSION, RUIN_MAP, normalize, specFor, register, unregister, clearArea, debugSnapshot });
});

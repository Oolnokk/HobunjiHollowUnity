// ClimbSurfaces — wall surfaces you attach to and move along.
//
// Unlike the scripted ladder / ledge / cliff climbs (one hop sequence to the
// top), attaching here only *holds* the player on a vertical plane. From then
// on movement input moves them in normal space across that plane:
//   - input along the wall   -> slides sideways (u)
//   - input into the wall    -> climbs up (v)
//   - input away from the wall -> climbs down; reaching the bottom lets go
//   - reaching the top while pushing up -> mantles onto the top if it is standable
//   - dodge -> lets go
// It is the 2D-plane sibling of ClimbSystem's branch movement (player.onBranch,
// which projects input onto a 1D axis).
//
// Surfaces come from CellGrid3D.collectClimbSurfaces() (registerGrid) or are
// registered directly, and are generic: nothing here knows about ruins. Visual
// representation is a style registry (registerStyle), so new looks can be added
// without touching movement. Coordinates: x/z in tile units, y in world units.
//
// Pure math (findGrabTarget / attach / step / topExitPoint) takes and returns
// plain objects so it runs under node; the player-loop glue is updatePlayer().
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ClimbSurfaces = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const DEFAULTS = Object.freeze({
    reach: 0.9,            // How far from the wall plane (tiles) a grab can start.
    facingToleranceDeg: 60,
    standOff: 0.34,        // Distance the player's centre hangs off the wall.
    edgeMargin: 0.3,       // Keep the player's centre this far inside the wall's side edges.
    inputDeadzone: 0.25,
    topPushThreshold: 0.5, // Push this hard up at the top to mantle; this hard down at the bottom to let go.
    bottomGrabSlack: 0.25, // Feet may be this far below the wall's bottom edge and still grab.
    topGrabClearance: 0.5, // Must be at least this far below the top edge to grab (else just walk onto it).
    mantleDepth: 0.5,      // How far past the wall plane (into the solid) the mantle lands.
  });

  // ---------------------------------------------------------------- styles

  // speedU / speedV are tiles (world units) per second along / up the wall.
  const styles = new Map();
  function registerStyle(id, def = {}) {
    const key = String(id);
    styles.set(key, Object.freeze({
      id: key, label: def.label || key, speedU: Number.isFinite(def.speedU) ? def.speedU : 1.2,
      speedV: Number.isFinite(def.speedV) ? def.speedV : 1.2, color: def.color || '#6a8f5a', build: typeof def.build === 'function' ? def.build : null,
    }));
    return styles.get(key);
  }
  const getStyle = id => styles.get(String(id)) || styles.get('default');
  const listStyles = () => [...styles.values()].map(({ id, label }) => ({ id, label })); // For editors that offer a style picker.
  registerStyle('default', { label: 'Climbable wall', speedU: 1.2, speedV: 1.2, color: '#7a7a6a' });
  registerStyle('ivy', { label: 'Ivy', speedU: 1.6, speedV: 1.4, color: '#3f6b34' });
  registerStyle('rungs', { label: 'Rungs', speedU: 0.8, speedV: 2.2, color: '#6a5a48', build: buildRungs });
  registerStyle('holds', { label: 'Handholds', speedU: 1.0, speedV: 0.9, color: '#8a8478', build: buildHolds });

  // ---------------------------------------------------------------- registry

  const surfaces = new Map();
  function normalize(raw) {
    const axisX = raw.axis === 'x'; // axis = the world axis `u` runs along
    const n = raw.normal || { x: 0, z: 1 };
    return {
      id: raw.id, scope: raw.scope ?? 'global', style: String(raw.style || 'default'), axis: raw.axis,
      normal: { x: n.x, z: n.z }, tangent: axisX ? { x: 1, z: 0 } : { x: 0, z: 1 },
      plane: Number(raw.plane), u0: Number(raw.u0), u1: Number(raw.u1), y0: Number(raw.y0), y1: Number(raw.y1),
      enabled: raw.enabled ?? true,
    };
  }
  function register(raw) {
    if (!raw || raw.id == null) throw new Error('ClimbSurfaces.register requires an id');
    const s = normalize(raw);
    if (!(s.u1 > s.u0) || !(s.y1 > s.y0) || !Number.isFinite(s.plane)) throw new Error(`ClimbSurfaces: invalid surface ${raw.id}`);
    surfaces.set(s.id, s);
    return s;
  }
  // Registers every merged climbable rectangle of a CellGrid3D. Returns the count.
  function registerGrid(grid, options = {}) {
    const scope = options.scope ?? 'cell-grid-3d', prefix = options.idPrefix ?? 'cs';
    let n = 0;
    for (const raw of grid.collectClimbSurfaces()) {
      register({ ...raw, id: `${prefix}-${raw.facing}-${raw.plane}-${raw.u0}-${raw.y0}`, scope });
      n++;
    }
    return n;
  }
  function remove(id) { return surfaces.delete(id); }
  function clearScope(scope) { let n = 0; for (const [id, s] of surfaces) if (s.scope === scope) { surfaces.delete(id); n++; } return n; }
  const list = () => [...surfaces.values()];

  // ---------------------------------------------------------------- pure math

  const wallX = (s, u) => (s.axis === 'x' ? u : s.plane);
  const wallZ = (s, u) => (s.axis === 'x' ? s.plane : u);
  function distanceOut(s, x, z) { return s.axis === 'x' ? (z - s.plane) * s.normal.z : (x - s.plane) * s.normal.x; }

  // pos = { x, z, y (feet) } in tiles/world units; angle = facing in radians, atan2(dz, dx).
  // Returns the best surface the player could grab right now, or null.
  function findGrabTarget(pos, angle, options = {}) {
    const o = { ...DEFAULTS, ...options }, cosTol = Math.cos((o.facingToleranceDeg * Math.PI) / 180);
    const fx = Math.cos(angle), fz = Math.sin(angle);
    let best = null;
    for (const s of surfaces.values()) {
      if (!s.enabled || (options.scope != null && s.scope !== options.scope)) continue;
      const d = distanceOut(s, pos.x, pos.z);
      if (d < -0.1 || d > o.reach) continue;                          // Must be on the open side, within reach.
      const u = s.axis === 'x' ? pos.x : pos.z;
      if (u < s.u0 - 0.15 || u > s.u1 + 0.15) continue;
      if (pos.y < s.y0 - o.bottomGrabSlack || pos.y > s.y1 - o.topGrabClearance) continue;
      if (-(fx * s.normal.x + fz * s.normal.z) < cosTol) continue;    // Must be facing into the wall.
      if (!best || d < best.d) best = { surface: s, d, u };
    }
    return best;
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function attach(surface, pos, options = {}) {
    const o = { ...DEFAULTS, ...options };
    const u = clamp(surface.axis === 'x' ? pos.x : pos.z, surface.u0 + o.edgeMargin, surface.u1 - o.edgeMargin);
    return { surface, u, v: clamp(pos.y, surface.y0, surface.y1), standOff: o.standOff };
  }

  // Where a mantle over the top lands: past the wall plane, on top of it.
  function topExitPoint(surface, u, depth = DEFAULTS.mantleDepth) {
    return { x: wallX(surface, u) - surface.normal.x * depth, z: wallZ(surface, u) - surface.normal.z * depth, y: surface.y1 };
  }

  const stepOut = { x: 0, z: 0, y: 0, u: 0, v: 0, facing: 0, event: null }; // Reused every frame; copy fields you keep.
  // Advances an attached session by dt using a ground-plane input vector (x, z). Mutates session.u/v.
  function step(session, input, dt, options = {}) {
    const o = { ...DEFAULTS, ...options }, s = session.surface, style = getStyle(s.style);
    const len = Math.hypot(input.x, input.z), mag = Math.min(1, len);
    const ix = len > 1e-4 ? input.x / len : 0, iz = len > 1e-4 ? input.z / len : 0;
    const along = (ix * s.tangent.x + iz * s.tangent.z) * mag;
    const into = -(ix * s.normal.x + iz * s.normal.z) * mag;      // + = pushing into the wall.
    if (Math.abs(along) > o.inputDeadzone) session.u = clamp(session.u + along * style.speedU * dt, s.u0 + o.edgeMargin, s.u1 - o.edgeMargin);
    if (Math.abs(into) > o.inputDeadzone) session.v = clamp(session.v + into * style.speedV * dt, s.y0, s.y1);
    let event = null;
    if (session.v >= s.y1 - 1e-6 && into > o.topPushThreshold) event = 'top';
    else if (session.v <= s.y0 + 1e-6 && into < -o.topPushThreshold) event = 'bottom';
    stepOut.x = wallX(s, session.u) + s.normal.x * session.standOff;
    stepOut.z = wallZ(s, session.u) + s.normal.z * session.standOff;
    stepOut.y = session.v; stepOut.u = session.u; stepOut.v = session.v;
    stepOut.facing = Math.atan2(-s.normal.z, -s.normal.x); // Faces into the wall.
    stepOut.event = event;
    return stepOut;
  }

  // ---------------------------------------------------------------- visuals

  function buildPlane(THREE, s, color, opacity) {
    const g = new THREE.PlaneGeometry(s.u1 - s.u0, s.y1 - s.y0);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, side: THREE.DoubleSide, depthWrite: opacity >= 1 }));
    return m;
  }
  function buildRungs(THREE, s, style) {
    const group = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: style.color });
    const w = s.u1 - s.u0, h = s.y1 - s.y0;
    for (let y = 0.25; y < h; y += 0.5) { const bar = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.06, 0.08), mat); bar.position.set(w / 2, y, 0.05); group.add(bar); }
    return group;
  }
  function buildHolds(THREE, s, style) {
    const group = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: style.color });
    const w = s.u1 - s.u0, h = s.y1 - s.y0;
    let seed = 7919; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647); // Deterministic per surface size.
    for (let y = 0.3; y < h; y += 0.45) for (let x = 0.25; x < w; x += 0.5) { const hold = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.1), mat); hold.position.set(x + (rnd() - 0.5) * 0.2, y + (rnd() - 0.5) * 0.15, 0.05); group.add(hold); }
    return group;
  }
  // Returns an Object3D placed in world space (tile units / world y), oriented to the wall's normal.
  // The caller owns adding it to a scene and disposing it.
  function buildVisual(THREE, raw) {
    const surface = normalize(raw); // The shaft composer passes raw CellGrid3D faces; visual orientation needs the same tangent as registered climb surfaces.
    const style = getStyle(surface.style), holder = new THREE.Group();
    const inner = style.build ? style.build(THREE, surface, style) : null;
    const body = buildPlane(THREE, surface, style.color, inner ? 0.35 : 0.85);
    // Local frame: +x runs along u, +y up, +z along the wall normal.
    const local = new THREE.Group();
    body.position.set((surface.u1 - surface.u0) / 2, (surface.y1 - surface.y0) / 2, 0.02);
    local.add(body); if (inner) local.add(inner);
    holder.add(local);
    // Right-handed local frame: +x = up x normal, +y = up, +z = normal (so the overlay sits on the open side).
    // For some facings +x runs against `u`, so the frame starts from the far end of the wall.
    const nx = surface.normal.x, nz = surface.normal.z;
    const xAxis = new THREE.Vector3(0, 1, 0).cross(new THREE.Vector3(nx, 0, nz));
    const flipped = xAxis.x * surface.tangent.x + xAxis.z * surface.tangent.z < 0;
    const startU = flipped ? surface.u1 : surface.u0;
    holder.position.set(wallX(surface, startU), surface.y0, wallZ(surface, startU));
    holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, nz)));
    holder.userData.climbSurfaceId = surface.id;
    return holder;
  }

  // ---------------------------------------------------------------- player glue

  let deps = null;
  function init(injected) { deps = injected; }

  function playerPos() { return { x: deps.player.x / deps.TILE, z: deps.player.y / deps.TILE, y: Number(deps.getFeetY?.()) || 0 }; } // player.y is the ground-plane z in px.

  // For ClimbSystem.registerWorldClimbProvider: grab when a forward dodge is pressed facing a surface.
  function worldClimbProvider() {
    if (!deps || deps.player.onClimbSurface || deps.player.climbing || deps.player.onBranch) return null;
    const hit = findGrabTarget(playerPos(), deps.player.angle);
    return hit ? { kind: 'climbSurface', surface: hit.surface, start: () => grab(hit) } : null;
  }

  function grab(hit) {
    const p = deps.player, session = attach(hit.surface, playerPos());
    p.onClimbSurface = session; p.wallClimbY = session.v;
    p.vx = 0; p.vy = 0;
    applyPose(session);
    return true;
  }
  function applyPose(session) {
    const p = deps.player;
    const out = step(session, { x: 0, z: 0 }, 0);
    p.x = out.x * deps.TILE; p.y = out.z * deps.TILE; p.wallClimbY = out.y;
    p.angle = out.facing; deps.setFacingAngle?.(out.facing); deps.setTargetAimAngle?.(out.facing); deps.setLastMoveAngle?.(out.facing);
  }

  function release() {
    const p = deps?.player;
    if (!p?.onClimbSurface) return false;
    p.onClimbSurface = null; p.wallClimbY = 0;
    return true;
  }

  // Per-frame, called from the movement loop while player.onClimbSurface is set.
  function updatePlayer(dt) {
    const p = deps.player, session = p.onClimbSurface;
    if (!session) return;
    const raw = deps.getMovementInput?.() || { x: 0, y: 0 };
    const out = step(session, { x: raw.x, z: raw.y }, dt);
    p.x = out.x * deps.TILE; p.y = out.z * deps.TILE; p.wallClimbY = out.y;
    p.vx = 0; p.vy = 0; p.inputX = 0; p.inputY = 0; p.inputStrength = 0;
    if (out.event === 'top') {
      const exit = topExitPoint(session.surface, session.u);
      if (deps.canStandAt?.(exit.x, exit.z, exit.y)) { // No standability check wired = no mantle: never land inside a solid.
        release();
        if (window.DevRandomRuin?.setPlayerWorldPoint) window.DevRandomRuin.setPlayerWorldPoint({ x: exit.x, y: exit.y, z: exit.z }, { grounded: true });
        else { p.x = exit.x * deps.TILE; p.y = exit.z * deps.TILE; }
      }
    } else if (out.event === 'bottom') release();
  }

  return Object.freeze({
    DEFAULTS, init, registerStyle, getStyle, listStyles, register, registerGrid, remove, clearScope, list,
    findGrabTarget, attach, step, topExitPoint, buildVisual,
    worldClimbProvider, grab, release, updatePlayer,
    isAttached: () => !!deps?.player?.onClimbSurface,
    debugSnapshot: () => ({
      initialized: !!deps, surfaces: surfaces.size, attached: !!deps?.player?.onClimbSurface,
      player: deps ? { tileX: deps.player.x / deps.TILE, tileZ: deps.player.y / deps.TILE, angle: deps.player.angle, wallClimbY: deps.player.wallClimbY ?? null, u: deps.player.onClimbSurface?.u ?? null } : null,
    }),
  });
});

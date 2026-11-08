// ClimbSurfaces — wall surfaces you attach to and move along.
//
// Unlike the scripted ladder / ledge / cliff climbs (one hop sequence to the
// top), attaching here only *holds* the player on a vertical plane. From then
// on movement input moves them in normal space across that plane:
//   - input along the wall   -> slides sideways (u)
//   - input into the wall    -> climbs up (v)
//   - input away from the wall -> climbs down; reaching the bottom lets go
//   - reaching the top while pushing up -> mantles onto the top if it is standable
//   - walking along the wall past either end -> steps off sideways onto a platform at the same height, if there is one
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
    sidePushThreshold: 0.5, // Push this hard along the wall while at its end to step off sideways.
    sideReach: [0.3, 0.55, 0.8], // How far past the wall's end (tiles) a side exit may land.
    sideStandOffs: [0.34, 0.7, 1.1], // How far out from the wall plane (tiles) a side exit may land.
    bottomGrabSlack: 0.25, // Feet may be this far below the wall's bottom edge and still grab.
    topGrabClearance: 0.5, // Must be at least this far below the top edge to grab (else just walk onto it).
    fallCatchReach: 0.55, // Passive shaft-ladder grabs catch a falling body's near-wall reach, without extending ordinary grabs.
    fallTopClearance: 0.08, // A descending character can catch close to a short ladder band's upper rim.
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
  let fallCatchCount = 0; // Mobile climb debug reports how many passive ladder catches succeeded this session.
  function normalize(raw) {
    const axisX = raw.axis === 'x'; // axis = the world axis `u` runs along
    const n = raw.normal || { x: 0, z: 1 };
    return {
      id: raw.id, scope: raw.scope ?? 'global', style: String(raw.style || 'default'), axis: raw.axis,
      normal: { x: n.x, z: n.z }, tangent: axisX ? { x: 1, z: 0 } : { x: 0, z: 1 },
      plane: Number(raw.plane), u0: Number(raw.u0), u1: Number(raw.u1), y0: Number(raw.y0), y1: Number(raw.y1),
      enabled: raw.enabled ?? true,
      autoCatch: raw.autoCatch === true, // Only explicitly designated shaft ladders can be grabbed by passive falls.
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
      register({ ...raw, id: `${prefix}-${raw.facing}-${raw.plane}-${raw.u0}-${raw.y0}`, scope,
        autoCatch: options.autoCatch === true || raw.autoCatch === true });
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

  // Finds actual descending contact with an authored ladder. The vertical sweep
  // prevents a fast fall from skipping a one-cell-high obelisk band. Unlike a
  // prompted/forward-air grab, facing direction is irrelevant: the character
  // reaches for a ladder already within arm's reach.
  function findFallGrabTarget(pos, previousY = pos?.y) {
    if (!pos || ![pos.x, pos.z, pos.y, previousY].every(Number.isFinite) || pos.y >= previousY - 1e-6) return null;
    let best = null; // The closest reachable ladder band wins when several vertical strips overlap the swept fall.
    for (const s of surfaces.values()) {
      if (!s.enabled || !s.autoCatch) continue; // Natural cliffs, ordinary walls and non-ladder props preserve their old controls.
      const d = distanceOut(s, pos.x, pos.z); // Player center must remain on the open side of the visible ladder.
      if (d < -0.05 || d > DEFAULTS.fallCatchReach) continue;
      const u = s.axis === 'x' ? pos.x : pos.z; // Parallel position prevents grabbing an unrelated nearby pillar face.
      if (u < s.u0 - 0.12 || u > s.u1 + 0.12) continue;
      const catchTop = s.y1 - Math.min(DEFAULTS.fallTopClearance, (s.y1 - s.y0) * 0.35);
      if (previousY < s.y0 - 0.02 || pos.y > catchTop + 0.02) continue;
      const hit = { surface: s, d, u, y: clamp(pos.y, s.y0, catchTop) }; // Snap only within the vertically swept handhold band.
      const lift = Math.max(0, hit.y - pos.y); // Prefer the nearest vertically reachable rung if a fast fall crosses multiple bands.
      if (!best || lift < best.lift - 1e-6 || (Math.abs(lift - best.lift) <= 1e-6 && d < best.d))
        best = { ...hit, lift };
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

  // Where stepping off the end of a wall lands: just past the end, level with the player's feet, on whatever
  // standable surface is there. canStand(x, z, y) is the same check a mantle uses. Null when there is none.
  function sideExitPoint(surface, edge, y, canStand, options = {}) {
    const o = { ...DEFAULTS, ...options };
    if (!edge || typeof canStand !== 'function') return null;
    const end = edge > 0 ? surface.u1 : surface.u0;
    for (const beyond of o.sideReach) for (const out of o.sideStandOffs) {
      const u = end + Math.sign(edge) * beyond;
      const x = wallX(surface, u) + surface.normal.x * out, z = wallZ(surface, u) + surface.normal.z * out;
      if (canStand(x, z, y)) return { x, z, y };
    }
    return null;
  }

  const stepOut = { x: 0, z: 0, y: 0, u: 0, v: 0, facing: 0, event: null, edge: 0 }; // Reused every frame; copy fields you keep.
  // Advances an attached session by dt using a ground-plane input vector (x, z). Mutates session.u/v.
  function step(session, input, dt, options = {}) {
    const o = { ...DEFAULTS, ...options }, s = session.surface, style = getStyle(s.style);
    const len = Math.hypot(input.x, input.z), mag = Math.min(1, len);
    const ix = len > 1e-4 ? input.x / len : 0, iz = len > 1e-4 ? input.z / len : 0;
    const along = (ix * s.tangent.x + iz * s.tangent.z) * mag;
    const into = -(ix * s.normal.x + iz * s.normal.z) * mag;      // + = pushing into the wall.
    const lo = s.u0 + o.edgeMargin, hi = s.u1 - o.edgeMargin;
    if (Math.abs(along) > o.inputDeadzone) session.u = clamp(session.u + along * style.speedU * dt, lo, hi);
    let edge = 0; // Still pushing along the wall after reaching its end.
    if (Math.abs(along) > o.sidePushThreshold) {
      if (along > 0 && session.u >= hi - 1e-6) edge = 1;
      else if (along < 0 && session.u <= lo + 1e-6) edge = -1;
    }
    if (Math.abs(into) > o.inputDeadzone) session.v = clamp(session.v + into * style.speedV * dt, s.y0, s.y1);
    let event = null;
    if (session.v >= s.y1 - 1e-6 && into > o.topPushThreshold) event = 'top';
    else if (session.v <= s.y0 + 1e-6 && into < -o.topPushThreshold) event = 'bottom';
    else if (edge) event = 'edge';
    stepOut.x = wallX(s, session.u) + s.normal.x * session.standOff;
    stepOut.z = wallZ(s, session.u) + s.normal.z * session.standOff;
    stepOut.y = session.v; stepOut.u = session.u; stepOut.v = session.v;
    stepOut.facing = Math.atan2(-s.normal.z, -s.normal.x); // Faces into the wall.
    stepOut.event = event;
    stepOut.edge = event === 'edge' ? edge : 0;
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
  let ruinLadderRuneTexture = null; // Shared V50 rune PNG used by ladder edge markings; individual marker geometries are disposable.
  function buildRuinLadderMarks(THREE, surface) {
    if (!THREE.TextureLoader || !THREE.PlaneGeometry) return null;
    if (!ruinLadderRuneTexture) {
      ruinLadderRuneTexture = new THREE.TextureLoader().load('assets/textures/decals/ruin_glyph_rune.png');
      ruinLadderRuneTexture.wrapS = ruinLadderRuneTexture.wrapT = THREE.RepeatWrapping;
      if (THREE.SRGBColorSpace) ruinLadderRuneTexture.colorSpace = THREE.SRGBColorSpace;
    }
    const width = surface.u1 - surface.u0, height = surface.y1 - surface.y0; // Marker placement follows the same registered climbing rectangle.
    const runeMaterial = new THREE.MeshBasicMaterial({
      map:ruinLadderRuneTexture,color:'#80e9ca',transparent:true,opacity:.85,
      depthWrite:false,depthTest:true,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
      polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,
    }); // Subtle emissive etchings identify the two ladder borders without recoloring the carved stone.
    runeMaterial.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          diffuseColor.a *= texture2D(map, vUv).a;
        #endif
      `);
    };
    const marks = new THREE.Group(), halfGap = Math.min(1.2,width)*.43+.11;
    for (const side of [-1,1]) {
      const geometry = new THREE.PlaneGeometry(.20,Math.max(.15,height-.12));
      const uvs = geometry.getAttribute('uv');
      for(let i=0;i<uvs.count;i++) uvs.setY(i,uvs.getY(i)*Math.max(1,height/.42));
      const strip = new THREE.Mesh(geometry,runeMaterial);
      strip.name = 'ruin-ladder-rune-glow';
      strip.position.set(width/2+side*halfGap,height/2,.018); // Flat against the pillar face; the stone/ladder retain normal depth testing.
      strip.userData.devRuinFootprintIgnore = true;
      strip.userData.ruinLadderRuneGlow = true; // The ruin's darkness compositor leaves a small halo around the etched motifs.
      strip.raycast = () => {};
      marks.add(strip);
    }
    return marks;
  }
  function buildRuinV50Ladder(THREE, surface) {
    // The verified V50 constructor is the visual authority. This decoration is not a second gameplay ladder.
    const author=globalThis.document?.getElementById?.('devRandomRuinGeneratorFrame')?.contentWindow?.DebrisifierV50;
    if(typeof author?.createRuntimeStoneLadder!=='function')return null;
    const width=surface.u1-surface.u0,height=surface.y1-surface.y0;
    let ladder=null;
    try { ladder=author.createRuntimeStoneLadder(Math.max(.5,height),Math.max(.5,Math.min(1.2,width)),.12); }
    catch(error) {globalThis.__farmLog?.('[ruin climb] V50 ladder visual unavailable: '+(error?.message||error),'warn');return null;} // A failed optional decoration cannot block entry.
    if(!ladder?.traverse)return null;
    ladder.name='ruin-v50-climb-ladder-visual';
    ladder.rotation.y=-Math.PI/2; // V50 builds width along local Z and depth along +X; the climb frame expects width along +X and outward along +Z.
    ladder.position.set(width/2,height,.006); // The rear of the rotated V50 rails now hugs the actual registered stone face.
    ladder.traverse(node=>{
      node.userData=node.userData||{};
      delete node.userData.generatedAccessType; // No duplicate climb prompt, occupancy solid, or ladder-mount animation.
      delete node.userData.devRuinInteractionType;
      delete node.userData.interactive3D;
      delete node.userData.runtimeRecoveryEgress;
      node.userData.devRuinFootprintIgnore=true;
    });
    return ladder;
  }
  // Returns an Object3D placed in world space (tile units / world y), oriented to the wall's normal.
  // The caller owns adding it to a scene and disposing it.
  function buildVisual(THREE, raw) {
    const surface = normalize(raw); // The shaft composer passes raw CellGrid3D faces; visual orientation needs the same tangent as registered climb surfaces.
    const style = getStyle(surface.style), holder = new THREE.Group();
    const v50Ladder = raw?.ruin === true ? buildRuinV50Ladder(THREE, surface) : null; // Ruin-specific, leaving natural cliff/vine climbing visuals unchanged.
    const inner = v50Ladder || (style.build ? style.build(THREE, surface, style) : null);
    // Local frame: +x runs along u, +y up, +z along the wall normal.
    const local = new THREE.Group();
    if(!v50Ladder){
      const body = buildPlane(THREE, surface, style.color, inner ? 0.35 : 0.85); // Fallback for headless tests before the V50 author frame loads.
      body.position.set((surface.u1 - surface.u0) / 2, (surface.y1 - surface.y0) / 2, 0.02);
      local.add(body);
    }
    if(inner)local.add(inner);
    if(v50Ladder){const marks=buildRuinLadderMarks(THREE,surface);if(marks)local.add(marks);}
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
    if(v50Ladder)holder.userData.ruinLadderSenseTarget = true; // Moving obelisk runtime exposes these actual visual roots to sense mode.
    return holder;
  }

  // ---------------------------------------------------------------- player glue

  let deps = null;
  function init(injected) { deps = injected; }

  function playerPos() { return { x: deps.player.x / deps.TILE, z: deps.player.y / deps.TILE, y: Number(deps.getFeetY?.()) || 0 }; } // player.y is the ground-plane z in px.

  // Short, standable ruin faces are normal jump targets, even when painted with climb holds.
  // Keep long walls, unsafe landings, and climbing outside the generated ruin unchanged.
  function isEasyRuinJump(hit, pos) {
    if (deps?.getCurrentArea?.() !== 'map_i_dev_random_ruin' || !hit?.surface || typeof deps.canStandAt !== 'function') return false;
    const easyRise = Number(globalThis.PlayerJump?.easyJumpRise); // Reuses the physical jump's comfortable rise for both ground grabs and airborne catches.
    const flight = deps.player?._freeJump; // A tall wall never becomes an easy jump just because the player is already near the apex.
    if (flight?.phase === 'air' && flight.source !== 'free jump') return false; // Rope falls retain their own handhold catches.
    const takeoffY = flight?.phase === 'air' ? Number(flight.takeoffY) : pos.y;
    const rise = hit.surface.y1 - takeoffY; // Compare the landing height with the physical takeoff, not current midair height.
    if (!Number.isFinite(easyRise) || !Number.isFinite(rise) || rise <= 0 || rise > easyRise) return false;
    const exit = topExitPoint(hit.surface, hit.u);
    return !!deps.canStandAt(exit.x, exit.z, exit.y); // Never disable a climb without a safe surface to stand on.
  }

  // For ClimbSystem.registerWorldClimbProvider: grab when a forward dodge is pressed facing a surface.
  function worldClimbProvider() {
    if (!deps || deps.player.onClimbSurface || deps.player.climbing || deps.player.onBranch) return null;
    const pos = playerPos(); // Same feet-height probe must decide both proximity and whether jumping is enough.
    const hit = findGrabTarget(pos, deps.player.angle);
    return hit && !isEasyRuinJump(hit, pos) ? { kind: 'climbSurface', surface: hit.surface, start: () => grab(hit) } : null;
  }

  function attachAirborne(surface, pos) {
    const session = attach(surface, pos); // Transfer the physical fall height into the same authored wall-climb session.
    window.PlayerJump?.reset?.();
    deps.player.onClimbSurface = session;
    deps.player.vx = 0; deps.player.vy = 0;
    applyPose(session);
    return true;
  }

  function tryAirGrab(pos, direction) {
    if (!deps || deps.player.onClimbSurface || deps.player.climbing || deps.player.onBranch) return false;
    const hit = findGrabTarget(pos, Math.atan2(direction.z, direction.x), { reach: 0.32 }); // Catch only a nearby wall being approached.
    if (!hit || isEasyRuinJump(hit, pos)) return false; // Jumpable ruin props must not steal an ordinary jump midair.
    return attachAirborne(hit.surface, pos);
  }

  function tryFallGrab(pos, previousY = pos?.y) {
    if (!deps || deps.player.onClimbSurface || deps.player.climbing || deps.player.onBranch || deps.player._freeJump?.noGrab) return false;
    const hit = findFallGrabTarget(pos, previousY);
    if (!hit) return false; // These are explicit ladder grips, even when the top happens to be jump-height from the falling body.
    fallCatchCount++;
    return attachAirborne(hit.surface, { ...pos, y: hit.y });
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

  function release({ fall = false } = {}) {
    const p = deps?.player;
    if (!p?.onClimbSurface) return false;
    const feetY = p.wallClimbY; // Preserves the wall-climb height when a Dodge release starts a physical fall.
    const tileX = p.x / deps.TILE, tileZ = p.y / deps.TILE; // Carries the current wall position into PlayerJump's airborne state.
    p.onClimbSurface = null; p.wallClimbY = 0;
    if (fall && Number.isFinite(feetY)) {
      window.PlayerJump?.beginFlight?.({
        x: tileX, z: tileZ, y: feetY, vx: 0, vy: 0, vz: 0,
        safeX: tileX, safeZ: tileZ, noGrab: true,
      }, { source: 'wall climb release', deliberate: true });
    }
    return true;
  }

  // The reaching-obelisk bands are two tiles wide and change face once
  // every three vertical cells. Their adjacent 1-cell-height rectangles are
  // physically continuous, but the ordinary wall-climb session would stop
  // at each rectangle top. Transfer only between this authored style's
  // touching rectangles; don't change behavior for cliffs, furniture or vines.
  function continueObeliskClimb(session, output, direction) {
    if(session.surface?.style!=='obelisk-stone')return false;
    let best=null,bestScore=Infinity;
    for(const candidate of surfaces.values()){
      if(candidate===session.surface||candidate.style!=='obelisk-stone'||candidate.scope!==session.surface.scope||!candidate.enabled)continue;
      if(direction>0&&(candidate.y0>output.y+.12||candidate.y1<=output.y+.03))continue;
      if(direction<0&&(candidate.y1<output.y-.12||candidate.y0>=output.y-.03))continue;
      if(direction===0&&(candidate.y0>output.y+.1||candidate.y1<output.y-.1))continue;
      const u=clamp(candidate.axis==='x'?output.x:output.z,
        candidate.u0+DEFAULTS.edgeMargin,candidate.u1-DEFAULTS.edgeMargin);
      const wx=wallX(candidate,u)+candidate.normal.x*session.standOff;
      const wz=wallZ(candidate,u)+candidate.normal.z*session.standOff;
      const d=Math.hypot(wx-output.x,wz-output.z);
      if(d>1.48||d>=bestScore)continue; // Adjacent tile/corner only; never leap across an entire pillar.
      bestScore=d;best={surface:candidate,u};
    }
    if(!best)return false;
    const next=attach(best.surface,{x:wallX(best.surface,best.u),z:wallZ(best.surface,best.u),
      y:output.y+(direction>0?.02:direction<0?-.02:0)},
      {standOff:session.standOff});
    const p=deps.player;
    p.onClimbSurface=next;p.wallClimbY=next.v;
    applyPose(next);
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
      } else continueObeliskClimb(session,out,1);
    } else if (out.event === 'bottom') {
      if(!continueObeliskClimb(session,out,-1))release();
    }
    else if (out.event === 'edge') {
      const exit = sideExitPoint(session.surface, out.edge, session.v, (x, z, y) => deps.canStandAt?.(x, z, y));
      if (exit) { // A platform level with the climber just past the wall's end: step off onto it. Nothing there: stay on the wall.
        release();
        if (window.DevRandomRuin?.setPlayerWorldPoint) window.DevRandomRuin.setPlayerWorldPoint({ x: exit.x, y: exit.y, z: exit.z }, { grounded: true });
        else { p.x = exit.x * deps.TILE; p.y = exit.z * deps.TILE; }
      } else continueObeliskClimb(session,out,0);
    }
  }

  return Object.freeze({
    DEFAULTS, init, registerStyle, getStyle, listStyles, register, registerGrid, remove, clearScope, list,
    findGrabTarget, findFallGrabTarget, attach, step, topExitPoint, sideExitPoint, buildVisual,
    worldClimbProvider, tryAirGrab, tryFallGrab, grab, release, updatePlayer,
    isAttached: () => !!deps?.player?.onClimbSurface,
    getAttachedSession: () => deps?.player?.onClimbSurface || null, // Surface pose uses the active wall plane without duplicating movement state.
    debugSnapshot: () => ({
      initialized: !!deps, surfaces: surfaces.size, attached: !!deps?.player?.onClimbSurface,
      autoCatchSurfaces: [...surfaces.values()].filter(s => s.enabled && s.autoCatch).length, fallCatchCount, // In-game diagnostics for ladder contact on mobile.
      player: deps ? { tileX: deps.player.x / deps.TILE, tileZ: deps.player.y / deps.TILE, angle: deps.player.angle, wallClimbY: deps.player.wallClimbY ?? null, u: deps.player.onClimbSurface?.u ?? null } : null,
    }),
  });
});

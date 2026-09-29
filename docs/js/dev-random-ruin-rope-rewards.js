// Rope payoffs and lava-basin rope rooms for the Random Test Ruin.
//
// Registered as a composer on js/dev-random-ruin-simple-puzzles.js and built
// only from that runtime's kit of primitives (platforms, ropes, lava shader,
// doors), so everything it places is owned and disposed by that runtime.
//
//  * Standalone rope rooms: the far platform now pays off with one of
//      - a pressure plate that unseals the room's onward stone door,
//      - a Dungeon Chest,
//      - a lift that rises to a wall balcony holding a better chest.
//  * Lava basins: a room's sunken floor region becomes a lava basin with a
//    chain of stone pillars linked by ceiling ropes. Pillars carry pressure
//    plates and Dungeon Chests; pressing every plate opens a vault side door
//    on a balcony reached by its own rope. Lava burns and throws the player
//    back to the last safe footing.
(() => {
  'use strict';

  const SimplePuzzles = window.DevRandomRuinSimplePuzzles;
  const Chests = window.DevRandomRuinDungeonChests;
  if (!window.THREE || !SimplePuzzles?.registerComposer || !Chests) return;

  const PLATE_COLOR = 0xb08a3c;
  const PLATE_PRESSED_COLOR = 0xffd66a;
  const BASIN_RUNE_COLOR = 0xff9a3c;
  const DOOR_RUNE_COLOR = 0xffc04a;
  const PILLAR_SIZE = 2.2; // Landing target for a rope dismount; a rope's peak swing reaches ~0.92u past the deck centre line toward its near edge, so 2.2u leaves margin.
  const PILLAR_RISE = .62; // Pillar tops sit this far above the rim so they cannot be stepped onto from it (step limit 0.42).
  const ROPE_SPACING = [5.4, 5.0, 4.7]; // Candidate centre-to-centre spans; ropes need >= 4.4 along their axis.
  const LAVA_ESCAPE_S = .45; // Time standing in lava before being thrown back to safe footing.
  const LAVA_BURN = 16;
  const SAFE_EDGE_MARGIN = .6; // A lava escape returns the player at least this far back from the pit edge.
  const LIFT_RISE_MAX = .95;
  const LIFT_SECONDS = 2.2;
  const BALCONY_HEADROOM = 1.7;
  const cfg = (path, fallback) => window.DevRandomRuinConfig?.get?.(path, fallback) ?? fallback; // docs/config/random-ruin/ruin-config.json; the constants above are the fallbacks.

  let basins = [];
  let payoffs = [];
  let rejects = [];
  let forcedPayoff = null; // Diagnostics only: forces the next standalone rope payoff kind ('plateDoor'|'lift'|'chest'). // Why candidate basin rooms were skipped; surfaced in snapshot() for diagnostics.

  const rngPick = (rng, list) => list[Math.floor(rng() * list.length) % list.length];

  function clear() {
    basins = [];
    payoffs = [];
    rejects = [];
  }

  // ─── Shared pieces ──────────────────────────────────────────────────────

  function makePlate(kit, id, x, y, z, onPress) {
    const authored = window.DevRandomRuinFurniturePieces?.solid?.('ruinRewardPlate'); // docs/config/furniture-authored/ruinRewardPlate.json
    const plateMesh = authored?.userData?.meshById?.get?.('plate');
    const material = plateMesh?.material || kit.makeBasic(PLATE_COLOR);
    const mesh = authored || new THREE.Mesh(kit.sharedBoxGeometry(.74, .07, .74), material);
    mesh.name = 'dev_ruin_reward_pressure_plate_' + id;
    mesh.position.set(x, authored ? y : y + .035, z); // The authored plate's own part already sits .035 up.
    mesh.userData.devRandomRuinPressurePlate = true;
    kit.group().add(mesh);
    const plate = { id, x, y, z, mesh, material, pressed:false, onPress };
    plate.rune = window.DevRandomRuinGlyphCircuits?.attachRune?.(kit.group(), new THREE.Vector3(x, y + 1.05, z), {
      hex:BASIN_RUNE_COLOR, size:.42, name:'dev_ruin_glyph_marker_plate_' + id, isActive:() => plate.pressed,
    }) || null;
    return plate;
  }

  function updatePlate(kit, plate, player) {
    if (plate.pressed || !player) return false;
    if (Math.abs(player.x - plate.x) > .4 || Math.abs(player.z - plate.z) > .4 || Math.abs(player.y - plate.y) > .35) return false;
    plate.pressed = true;
    plate.mesh.position.y = plate.mesh.isGroup ? plate.y - .03 : plate.y + .005;
    plate.material.color.setHex(PLATE_PRESSED_COLOR);
    kit.playStoneUnlockKchunk?.();
    try { plate.onPress?.(plate); } catch (error) { console.warn('[Random Test Ruin] plate handler failed', error); }
    return true;
  }

  function makeChest(kit, id, x, y, z, tier, faceX, faceZ) {
    return Chests.create({ id, parent:kit.group(), x, y, z, tier, yaw:Math.atan2(faceX, faceZ) });
  }

  // A stone pillar rising from `baseY` to `topY`, registered as a surface.
  // The base follows the lowest floor under the footprint: a basin region can
  // contain a deeper nested pit, and a pillar starting at the region's own
  // level floated over it, leaving a lava-filled gap underneath.
  function makePillar(kit, id, x, z, baseY, topY, size = cfg('lavaBasin.pillarSize', PILLAR_SIZE)) {
    let floorY = baseY;
    const h = size * .5 - .05;
    for (const dx of [-h, 0, h]) for (const dz of [-h, 0, h]) {
      const support = window.DynamicSurfaces?.sampleSupport?.(x + dx, z + dz, { minY:baseY - 6, maxY:baseY + .05, pad:.02 });
      if (support && Number.isFinite(Number(support.y))) floorY = Math.min(floorY, Number(support.y));
    }
    return kit.createPlatform(id, x, z, floorY, size, size, Math.max(.18, topY - floorY));
  }

  // Wall balcony: a platform against a room wall. wallNormal points from the
  // wall into the room; `depth` is measured away from the wall.
  function makeBalcony(kit, id, x, z, floorY, topY, wallNormal, depth = 2.6) {
    const runsAlongX = Math.abs(wallNormal.z) > Math.abs(wallNormal.x);
    const width = runsAlongX ? 2.6 : depth, platformDepth = runsAlongX ? depth : 2.6;
    const platform = kit.createPlatform(id, x, z, floorY, width, platformDepth, Math.max(.18, topY - floorY));
    const wallSide = { x:x - wallNormal.x * depth * .5, z:z - wallNormal.z * depth * .5 };
    return { id, x, z, topY, width, depth:platformDepth, span:2.6, runsAlongX, platform, wallNormal, wallSide, door:null, chest:null };
  }

  function placeBalconyChest(kit, balcony, tier) {
    const n = balcony.wallNormal;
    balcony.chest = makeChest(kit, balcony.id + '_chest', balcony.wallSide.x + n.x * .45, balcony.topY, balcony.wallSide.z + n.z * .45, tier, n.x, n.z);
    return balcony.chest;
  }

  // Vault side door across the full balcony width, 1u out from the wall, so
  // the chest behind it is unreachable until the door sinks open.
  function addVaultDoor(kit, balcony) {
    const n = balcony.wallNormal, topY = balcony.topY, alongX = balcony.runsAlongX;
    const doorX = balcony.wallSide.x + n.x * 1.0, doorZ = balcony.wallSide.z + n.z * 1.0;
    const span = balcony.span - .06;
    const spanX = alongX ? span : .16, spanZ = alongX ? .16 : span;
    const frame = new THREE.Group();
    frame.name = 'dev_ruin_vault_door_' + balcony.id;
    const postGeo = kit.sharedBoxGeometry(alongX ? .2 : .28, 1.55, alongX ? .28 : .2);
    for (const side of [-1, 1]) {
      const post = kit.naturalizeStone(new THREE.Mesh(postGeo, kit.makeBasic(0x808080)));
      post.position.set(doorX + (alongX ? side * (span * .5 + .08) : 0), topY + .775, doorZ + (alongX ? 0 : side * (span * .5 + .08)));
      frame.add(post);
    }
    const lintel = kit.naturalizeStone(new THREE.Mesh(kit.sharedBoxGeometry(alongX ? span + .4 : .3, .2, alongX ? .3 : span + .4), kit.makeBasic(0x808080)));
    lintel.position.set(doorX, topY + 1.65, doorZ);
    frame.add(lintel);
    const panel = new THREE.Mesh(kit.sharedBoxGeometry(spanX, 1.45, spanZ), kit.makeBasic(0x5b4a3a));
    panel.name = 'dev_ruin_vault_door_panel_' + balcony.id;
    panel.position.set(doorX, topY + .725, doorZ);
    panel.userData.devRuinFootprintManaged = true; // Sinks when opened; explicit enabled() footprint below.
    frame.add(panel);
    kit.group().add(frame);
    const door = { frame, panel, closedY:topY + .725, openY:topY - .72, progress:0, open:false };
    balcony.door = door;
    window.DevRandomRuinFurniturePieces?.attachSeal?.(panel, () => (door.open ? 1 : 0)); // ruinDoorSeal: red until the pillar plates unlock the vault.
    window.DevRandomRuinTileOccupancy?.addSolidBox?.('devruin-vault-door-' + balcony.id,
      { cx:doorX, cz:doorZ, halfX:spanX * .5, halfZ:spanZ * .5 }, () => door.progress < .7, kit.SCOPE);
    door.rune = window.DevRandomRuinGlyphCircuits?.attachRune?.(kit.group(), new THREE.Vector3(doorX + n.x * .2, topY + 1.1, doorZ + n.z * .2), {
      hex:DOOR_RUNE_COLOR, size:.46, name:'dev_ruin_glyph_marker_vault_' + balcony.id, isActive:() => door.open,
    }) || null;
    return door;
  }

  function updateVaultDoor(door, dt) {
    if (!door) return;
    const target = door.open ? 1 : 0;
    door.progress += Math.max(-dt * .9, Math.min(dt * .9, target - door.progress));
    const t = door.progress * door.progress * (3 - 2 * door.progress);
    door.panel.position.y = door.closedY + (door.openY - door.closedY) * t;
  }

  function chestControls(kit, chest, sealed, reason) {
    if (!chest || chest.opened) return [];
    if (!sealed()) return [chest.control];
    return [{ ...chest.control, label:'Sealed Vault Chest', onPress:() => kit.deps?.showToast?.(reason, false) }];
  }

  function ceilingLimit(context) {
    return (Number(context.meta?.floorSurfaceY) || 0) + (Number(context.meta?.wallHeight) || 3);
  }

  // Direction from the nearest room wall into the room, plus that wall's
  // inner coordinate, for a point inside `bounds`.
  function nearestWall(bounds, x, z) {
    return wallsFrom(bounds, x, z)[0];
  }

  // Perpendicular foot on each room wall from (x, z), nearest first.
  function wallsFrom(bounds, x, z) {
    const options = [
      { d:x - bounds.minX, normal:{ x:1, z:0 }, at:{ x:bounds.minX, z } },
      { d:bounds.maxX - x, normal:{ x:-1, z:0 }, at:{ x:bounds.maxX, z } },
      { d:z - bounds.minZ, normal:{ x:0, z:1 }, at:{ x, z:bounds.minZ } },
      { d:bounds.maxZ - z, normal:{ x:0, z:-1 }, at:{ x, z:bounds.maxZ } },
    ];
    return options.sort((a, b) => a.d - b.d);
  }

  // clearY: when set, only solids reaching that height count (a raised
  // balcony may sit over knee-high wall trim).
  function areaClear(kit, x, z, halfX, halfZ, expectY = null, tolerance = .3, clearY = null) {
    for (let i = 0; i <= 3; i++) for (let j = 0; j <= 3; j++) {
      const px = x + (i / 3 - .5) * 2 * halfX, pz = z + (j / 3 - .5) * 2 * halfZ;
      const support = kit.sampleSupport(px, pz);
      if (!support || !/^devruin-floor-/.test(String(support.id || ''))) return false;
      if (expectY != null && Math.abs(Number(support.y) - expectY) > tolerance) return false;
      if (window.DevRandomRuinTileOccupancy?.solidAt?.(px, pz, 0, clearY)) return false;
    }
    return true;
  }

  // Walkable part of a balcony deck (everything except the 0.75u strip at its
  // back edge, where the chest stands over any wall trim) must be free of
  // footprints, since walking collision is 2D.
  function balconyDeckClear(kit, x, z, wallNormal, depth) {
    const back = { x:x - wallNormal.x * depth * .5, z:z - wallNormal.z * depth * .5 };
    const usable = depth - .75;
    const cx = back.x + wallNormal.x * (.75 + usable * .5), cz = back.z + wallNormal.z * (.75 + usable * .5);
    const along = Math.abs(wallNormal.z) > Math.abs(wallNormal.x);
    const halfX = along ? 1.25 : usable * .5, halfZ = along ? usable * .5 : 1.25;
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
      if (window.DevRandomRuinTileOccupancy?.solidAt?.(cx + (i / 4 - .5) * 2 * halfX, cz + (j / 4 - .5) * 2 * halfZ, .2)) return false;
    }
    return !!kit.sampleSupport(x, z);
  }

  // ─── Standalone rope payoffs ───────────────────────────────────────────

  function plateDoorPayoff(kit, context, rope, room) {
    const doorId = kit.onwardGeneratedStoneDoorMechanism(context, room, { x:rope.startPlatform.x, z:rope.startPlatform.z });
    const info = doorId ? window.DevRandomRuin?.mechanismInfo?.(doorId) : null;
    if (!info || info.locked) { rejects.push(`payoff plateDoor ${room.id}: ${!doorId ? 'no onward door' : !info ? 'door unknown' : 'door already locked'}`); return null; }
    const pb = rope.endPlatform;
    // A manual door is sealed until the plate is pressed. A door a glyph
    // circuit already owns stays solvable by its glyphs; the plate becomes a
    // second key (setMechanismTarget drives the circuit's signal).
    const sealed = !info.signalLinked;
    if (sealed && !window.DevRandomRuin?.lockMechanism?.(doorId, 'Sealed — a pressure plate across the rope swing opens this door.')) { rejects.push(`payoff plateDoor ${room.id}: lock failed`); return null; }
    const plate = makePlate(kit, 'rope_' + room.id, pb.x, pb.topY, pb.z, () => {
      if (sealed) window.DevRandomRuin?.unlockMechanism?.(doorId, true);
      else window.DevRandomRuin?.setMechanismTarget?.(doorId, 1);
      kit.deps?.showToast?.('The plate sinks — a stone door grinds open.', true);
    });
    const box = new THREE.Box3().setFromObject(info.root);
    const center = box.getCenter(new THREE.Vector3());
    window.DevRandomRuinGlyphCircuits?.attachRune?.(kit.group(), new THREE.Vector3(center.x, Math.min(box.max.y + .35, ceilingLimit(context) - .3), center.z), {
      hex:BASIN_RUNE_COLOR, size:.5, name:'dev_ruin_glyph_marker_sealed_door_' + doorId, isActive:() => plate.pressed,
    });
    return { kind:'plateDoor', roomId:String(room.id), plate, doorId, sealed };
  }

  function chestPayoff(kit, rope, room, tier = 1) {
    const pb = rope.endPlatform, pa = rope.startPlatform;
    const chest = makeChest(kit, 'rope_' + room.id, pb.x, pb.topY, pb.z, tier, pa.x - pb.x, pa.z - pb.z);
    return { kind:'chest', roomId:String(room.id), chest };
  }

  // Replaces the far platform with a lift that rises to a balcony: against
  // the nearest wall when it is close enough, otherwise a free-standing stone
  // ledge beside the lift (across the rope's axis).
  function liftPayoff(kit, context, rope, room) {
    const pb = rope.endPlatform, pa = rope.startPlatform;
    const bounds = kit.roomBounds(context.meta, room);
    const skip = reason => { rejects.push(`payoff lift ${room.id}: ${reason}`); return null; };
    const rise = Math.min(cfg('lavaBasin.liftRiseMax', LIFT_RISE_MAX), ceilingLimit(context) - pb.topY - cfg('lavaBasin.balconyHeadroom', BALCONY_HEADROOM));
    if (rise < .6) return skip(`rise ${rise.toFixed(2)} too small`);
    const floorY = Number(pb.baseY) || 0;
    const topHigh = pb.topY + rise;
    const ropeAxisX = Math.abs(pb.x - pa.x) >= Math.abs(pb.z - pa.z);
    const sites = [];
    const wall = nearestWall(bounds, pb.x, pb.z);
    const liftHalf = (Math.abs(wall.normal.x) > 0 ? pb.width : pb.depth) * .5;
    const gap = wall.d - liftHalf;
    if (gap >= 1.7 && gap <= 3.2) sites.push({ bx:wall.at.x + wall.normal.x * (gap * .5 + .02), bz:wall.at.z + wall.normal.z * (gap * .5 + .02), normal:wall.normal, depth:gap - .04 });
    const ropeDir = ropeAxisX ? Math.sign(pb.x - pa.x) || 1 : Math.sign(pb.z - pa.z) || 1;
    for (const depth of [2.6, 2.1]) for (const shift of [0, .8 * ropeDir, -.6 * ropeDir]) for (const side of [1, -1]) { // Beside the lift, across the rope axis; its chest sits on the far edge, facing the lift.
      const half = (ropeAxisX ? pb.depth : pb.width) * .5;
      const offset = half + depth * .5 + .02; // Deck edge touches the lift so the player can walk straight across when it is up.
      const bx = pb.x + (ropeAxisX ? shift : side * offset), bz = pb.z + (ropeAxisX ? side * offset : shift);
      sites.push({ bx, bz, normal:ropeAxisX ? { x:0, z:-side } : { x:-side, z:0 }, depth });
    }
    let site = null;
    const why = { bounds:0, floor:0, deck:0 };
    for (const candidate of sites) {
      const alongX = Math.abs(candidate.normal.z) > Math.abs(candidate.normal.x);
      const halfX = alongX ? 1.3 : candidate.depth * .5, halfZ = alongX ? candidate.depth * .5 : 1.3;
      if (candidate.bx - halfX < bounds.minX + .2 || candidate.bx + halfX > bounds.maxX - .2 || candidate.bz - halfZ < bounds.minZ + .2 || candidate.bz + halfZ > bounds.maxZ - .2) { why.bounds++; continue; }
      if (!areaClear(kit, candidate.bx, candidate.bz, halfX - .2, halfZ - .2, floorY, .5, topHigh)) { why.floor++; continue; } // Inset so edge samples do not land on the adjoining lift's own surface.
      if (!balconyDeckClear(kit, candidate.bx, candidate.bz, candidate.normal, candidate.depth)) { why.deck++; continue; }
      site = candidate;
      break;
    }
    if (!site) return skip(`no clear balcony site beside the lift ${JSON.stringify(why)} of ${sites.length}`);
    const balcony = makeBalcony(kit, 'dev_ruin_rope_balcony_platform_' + room.id, site.bx, site.bz, floorY, topHigh, site.normal, site.depth);
    placeBalconyChest(kit, balcony, 2);
    // Swap the static far platform for a lift with a moving surface.
    kit.removePlatform(pb);
    const height = .26;
    const mesh = kit.naturalizeStone(new THREE.Mesh(kit.sharedBoxGeometry(pb.width, height, pb.depth), kit.makeBasic(0x808080)));
    mesh.name = 'dev_ruin_rope_lift_elevator_' + room.id;
    mesh.userData.devRandomRuinRopePlatform = true;
    kit.group().add(mesh);
    const shaft = kit.naturalizeStone(new THREE.Mesh(kit.sharedBoxGeometry(pb.width * .7, 1, pb.depth * .7), kit.makeBasic(0x6a6a6a)));
    shaft.name = 'dev_ruin_rope_lift_elevator_shaft_' + room.id;
    shaft.userData.devRandomRuinRopePlatform = true;
    kit.group().add(shaft);
    const lift = { x:pb.x, z:pb.z, width:pb.width, depth:pb.depth, baseY:floorY, topY:pb.topY, lowY:pb.topY, highY:topHigh, mesh, shaft, height, progress:0, target:0, idle:0 };
    const place = () => {
      const top = lift.lowY + (lift.highY - lift.lowY) * lift.progress;
      lift.topY = top;
      mesh.position.set(lift.x, top - height * .5, lift.z);
      const shaftH = Math.max(.02, top - height - floorY);
      shaft.scale.y = shaftH;
      shaft.position.set(lift.x, floorY + shaftH * .5, lift.z);
    };
    place();
    kit.registerSurface({ id:mesh.name + '-surface', bounds:{ minX:lift.x - lift.width * .5, maxX:lift.x + lift.width * .5, minZ:lift.z - lift.depth * .5, maxZ:lift.z + lift.depth * .5 }, topY:() => lift.topY, enabled:() => mesh.visible !== false, priority:26 });
    rope.endPlatform = lift; // Rope hazard / landing checks follow the lift.
    return { kind:'lift', roomId:String(room.id), lift, balcony, place };
  }

  function updateLift(kit, payoff, dt, player) {
    const lift = payoff.lift;
    const previous = lift.topY;
    const riding = !!(player && !kit.ownsPlayerMotion() && Math.abs(player.x - lift.x) <= lift.width * .5 - .06 && Math.abs(player.z - lift.z) <= lift.depth * .5 - .06 && Math.abs(player.y - previous) <= .26);
    if (riding) { lift.idle = 0; if (lift.target === 0) { lift.target = 1; if (!payoff.announced) { payoff.announced = true; kit.deps?.showToast?.('The platform shudders and rises toward a balcony.', true); } } }
    else { lift.idle += dt; if (lift.idle > 2.5) lift.target = 0; }
    lift.progress += Math.max(-dt / cfg('lavaBasin.liftSeconds', LIFT_SECONDS), Math.min(dt / cfg('lavaBasin.liftSeconds', LIFT_SECONDS), lift.target - lift.progress));
    payoff.place();
    if (riding && Math.abs(lift.topY - previous) > 1e-4) window.DevRandomRuin?.syncPlayerPresentationHeight?.(lift.topY);
  }

  function onStandaloneRope(kit, context, rope, room, rng) {
    if (!rope?.endPlatform?.mesh || !rope.startPlatform) return;
    const order = forcedPayoff ? [forcedPayoff, 'chest'] : rng() < cfg('ropePayoffs.plateDoorLiftOrChestChance', .34) ? ['plateDoor', 'lift', 'chest'] : rng() < cfg('ropePayoffs.liftOrChestChance', .5) ? ['lift', 'chest'] : ['chest'];
    let payoff = null;
    rejects.push(`payoff order ${room.id}: ${order.join('>')}`);
    for (const kind of order) {
      if (kind === 'plateDoor') payoff = plateDoorPayoff(kit, context, rope, room);
      else if (kind === 'lift') payoff = liftPayoff(kit, context, rope, room);
      else payoff = chestPayoff(kit, rope, room, 1);
      if (payoff) break;
    }
    if (!payoff) return;
    payoffs.push(payoff);
    kit.recordModulePlacement('ropePayoff', 'room', room.id, { payoff:payoff.kind, doorId:payoff.doorId || null });
  }

  // ─── Lava basins ───────────────────────────────────────────────────────

  function regionBounds(kit, context, region) {
    const cs = kit.worldCellSize(context.meta);
    return {
      minX:kit.PAD + Number(region.col) * cs, maxX:kit.PAD + (Number(region.col) + Number(region.w)) * cs,
      minZ:kit.PAD + Number(region.row) * cs, maxZ:kit.PAD + (Number(region.row) + Number(region.h)) * cs,
    };
  }

  function regionHasMechanism(context, bounds) {
    let found = false;
    context.root?.traverse?.(object => {
      if (found) return;
      const type = object.userData?.previewMotion?.type;
      if (!type || type === 'stoneDoor') return;
      const box = new THREE.Box3().setFromObject(object);
      if (box.isEmpty()) return;
      const c = box.getCenter(new THREE.Vector3());
      if (c.x > bounds.minX - .5 && c.x < bounds.maxX + .5 && c.z > bounds.minZ - .5 && c.z < bounds.maxZ + .5) found = true;
    });
    return found;
  }

  function lavaPlane(kit, bounds, y) {
    const width = bounds.maxX - bounds.minX, depth = bounds.maxZ - bounds.minZ;
    const material = kit.lavaMaterial();
    // Same world-tiled molten liquid as the rope-room lava strips.
    const geometry = kit.lavaSurfaceGeometry(width, depth, (bounds.minX + bounds.maxX) * .5, (bounds.minZ + bounds.maxZ) * .5, .12, .06);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'dev_ruin_basin_lava';
    mesh.rotation.x = -Math.PI * .5;
    mesh.position.set((bounds.minX + bounds.maxX) * .5, y, (bounds.minZ + bounds.maxZ) * .5);
    mesh.renderOrder = 1;
    mesh.userData.devRandomRuinLava = true;
    kit.group().add(mesh);
    // The lava shader is translucent (it is the water shader recoloured), so
    // an opaque molten bed just below it hides the pit floor tiles and makes
    // the basin read as a deep pool instead of a tinted floor.
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(width, depth, 1, 1), kit.makeBasic(0x5c1606));
    bed.name = 'dev_ruin_basin_lava_bed';
    bed.rotation.x = -Math.PI * .5;
    bed.position.set(mesh.position.x, y - .02, mesh.position.z);
    kit.group().add(bed);
    return mesh;
  }

  function rimLaunchPoint(kit, bounds, axis, side, cross, rimY) {
    for (const out of [1.3, 1.7, 2.1]) {
      const along = side < 0 ? (axis === 'x' ? bounds.minX : bounds.minZ) - out : (axis === 'x' ? bounds.maxX : bounds.maxZ) + out;
      const x = axis === 'x' ? along : cross, z = axis === 'x' ? cross : along;
      if (areaClear(kit, x, z, 1.05, 1.05, rimY, .2)) return { x, z };
    }
    return null;
  }

  // Tries one layout: rim pad -> pillar chain (zig-zag) -> optional far rim
  // pad, plus one side rope from a mid pillar to a vault balcony.
  function tryBasinLayout(kit, context, room, bounds, basinY, rimY, axis, entrySide, spacing, rng) {
    const created = []; // Platforms/ropes to roll back on failure.
    const fail = () => {
      for (const item of created) {
        if (item.kind === 'platform') kit.removePlatform(item.value);
        if (item.kind === 'rope') {
          const list = kit.state.ropes, index = list.indexOf(item.value);
          if (index >= 0) list.splice(index, 1);
          for (const mesh of [item.value.mesh, item.value.marker, item.value.mount]) kit.disposeObject(mesh);
        }
      }
      return null;
    };
    const crossMin = axis === 'x' ? bounds.minZ : bounds.minX, crossMax = axis === 'x' ? bounds.maxZ : bounds.maxX;
    const crossMid = (crossMin + crossMax) * .5, crossSwing = Math.min(1.1, (crossMax - crossMin) * .18);
    const alongMin = axis === 'x' ? bounds.minX : bounds.minZ, alongMax = axis === 'x' ? bounds.maxX : bounds.maxZ;
    const note = reason => rejects.push(`  layout ${axis}${entrySide > 0 ? '+' : '-'} s${spacing}: ${reason}`);
    const launch = rimLaunchPoint(kit, bounds, axis, entrySide, crossMid, rimY);
    if (!launch) { note('no clear rim launch spot'); return null; }
    const pad = kit.createPlatform('dev_ruin_basin_launch_platform_' + room.id, launch.x, launch.z, rimY, 2.1, 2.1, .28);
    created.push({ kind:'platform', value:pad });
    const pillarTop = rimY + cfg('lavaBasin.pillarRise', PILLAR_RISE);
    const nodes = [pad];
    let along = axis === 'x' ? launch.x : launch.z;
    const dir = entrySide < 0 ? 1 : -1;
    const ropes = [];
    for (let i = 0; i < 4; i++) {
      let nextAlong = along + dir * spacing;
      if (nextAlong < alongMin + 1.5 || nextAlong > alongMax - 1.5) { note(`pillar ${i} past basin end`); break; } // Pillars keep a lava moat to every rim edge.
      // Zig-zag by default; step around pit props (e.g. V50's sunken
      // centerpiece obelisk) by trying wider offsets on either side.
      const zig = i % 2 ? -1 : 1;
      const crossLimit = Math.max(0, (crossMax - crossMin) * .5 - 1.6);
      const crossOptions = [zig * crossSwing, -zig * crossSwing, zig * crossSwing * 2.4, -zig * crossSwing * 2.4, 0]
        .map(offset => crossMid + Math.max(-crossLimit, Math.min(crossLimit, offset)));
      let x = null, z = null, blocker = null;
      search: for (const shift of [0, .7, 1.3]) { // Longer spans stay >= 4.4u; a shifted pillar can clear a pit prop the cross offsets cannot.
        const alongTry = nextAlong + dir * shift;
        if (alongTry < alongMin + 1.5 || alongTry > alongMax - 1.5) continue;
        for (const cross of crossOptions) {
          const cx = axis === 'x' ? alongTry : cross, cz = axis === 'x' ? cross : alongTry;
          blocker = window.DevRandomRuinTileOccupancy?.solidAt?.(cx, cz, cfg('lavaBasin.pillarSize', PILLAR_SIZE) * .5 + .1); // 2D on purpose: walking collision is 2D, so any prop under a pillar deck would block walking on it.
          if (!blocker) { x = cx; z = cz; nextAlong = alongTry; break search; }
        }
      }
      if (x == null) { note(`pillar ${i} blocked by ${blocker?.source}`); break; }
      const pillar = makePillar(kit, `dev_ruin_basin_platform_${room.id}_${i}`, x, z, basinY, pillarTop);
      created.push({ kind:'platform', value:pillar });
      const rope = kit.createRopeTraversalBetween(context, room, nodes[nodes.length - 1], pillar, `basin${i}`, { externalHazard:true, minBobY:basinY + .1 });
      if (!rope) { note(`rope ${i} rejected`); kit.removePlatform(pillar); created.pop(); break; }
      created.push({ kind:'rope', value:rope });
      ropes.push(rope);
      nodes.push(pillar);
      along = nextAlong;
    }
    const pillars = nodes.slice(1);
    if (pillars.length < 2) { note(`only ${pillars.length} pillars`); return fail(); }
    // Far rim landing, if the chain reaches it.
    const farLaunch = rimLaunchPoint(kit, bounds, axis, -entrySide, (axis === 'x' ? pillars.at(-1).z : pillars.at(-1).x), rimY);
    if (farLaunch) {
      const farPad = kit.createPlatform('dev_ruin_basin_far_platform_' + room.id, farLaunch.x, farLaunch.z, rimY, 2.1, 2.1, .28);
      const rope = kit.createRopeTraversalBetween(context, room, pillars.at(-1), farPad, 'basinFar', { externalHazard:true, minBobY:basinY + .1 });
      if (rope) { created.push({ kind:'platform', value:farPad }, { kind:'rope', value:rope }); ropes.push(rope); nodes.push(farPad); }
      else kit.removePlatform(farPad);
    }
    // Vault balcony against the room wall nearest a middle pillar.
    const roomBounds = kit.roomBounds(context.meta, room);
    let balcony = null;
    const walls = [];
    for (const pillar of [pillars[Math.floor(pillars.length / 2)], ...pillars]) {
      for (const wall of wallsFrom(roomBounds, pillar.x, pillar.z)) if (wall.d >= 5.9 && wall.d <= 10.5) walls.push({ pillar, wall, bx:wall.at.x + wall.normal.x * 1.3, bz:wall.at.z + wall.normal.z * 1.3 }); // Balcony centre sits 1.3u off the wall; the rope needs >= 4.4u along its axis.
    }
    walls.sort((a, b) => a.wall.d - b.wall.d);
    // Free-standing vault balconies beside a pillar (across the chain) for
    // rooms whose walls are out of rope reach; the vault faces the pillar.
    for (const pillar of pillars) {
      for (const side of [1, -1]) for (const distance of [5.0, 5.6, 6.2]) {
        const bx = pillar.x + (axis === 'x' ? 0 : side * distance), bz = pillar.z + (axis === 'x' ? side * distance : 0);
        if (bx < roomBounds.minX + 1.5 || bx > roomBounds.maxX - 1.5 || bz < roomBounds.minZ + 1.5 || bz > roomBounds.maxZ - 1.5) continue;
        walls.push({ pillar, wall:{ normal:axis === 'x' ? { x:0, z:-side } : { x:-side, z:0 } }, bx, bz });
      }
    }
    for (const { pillar, wall, bx, bz } of walls) {
      const top = Math.min(pillarTop + .35, ceilingLimit(context) - cfg('lavaBasin.balconyHeadroom', BALCONY_HEADROOM));
      if (top < rimY + .6) continue;
      const floorSupport = kit.sampleSupport(bx, bz);
      if (!floorSupport || !balconyDeckClear(kit, bx, bz, wall.normal, 2.6)) continue;
      const candidate = makeBalcony(kit, `dev_ruin_basin_balcony_platform_${room.id}`, bx, bz, Number(floorSupport.y), top, wall.normal, 2.6);
      const rope = kit.createRopeTraversalBetween(context, room, pillar, candidate.platform, 'basinBalcony', { externalHazard:true, minBobY:basinY + .1 });
      if (!rope) { kit.removePlatform(candidate.platform); continue; }
      addVaultDoor(kit, candidate);
      balcony = candidate;
      ropes.push(rope);
      break;
    }
    return { pad, pillars, nodes, ropes, balcony, created };
  }

  function buildBasin(kit, context, room, region, rng, depthTier) {
    const bounds = regionBounds(kit, context, region);
    const width = bounds.maxX - bounds.minX, depth = bounds.maxZ - bounds.minZ;
    const reject = reason => { rejects.push(`${room.id}@${region.level}: ${reason}`); return null; };
    if (Math.max(width, depth) < 9 || Math.min(width, depth) < 5.5) return reject(`too small ${width}x${depth}`);
    if (regionHasMechanism(context, bounds)) return reject('mechanism in pit'); // Daises/bridges/lifts in the pit would be drowned or hidden.
    const step = Math.abs(Number(context.meta?.plateauModel?.stepHeight) || .38);
    const rimY = Number(context.meta?.floorSurfaceY) || 0;
    const basinY = rimY + Number(region.level) * step;
    if (rimY - basinY < .7) return reject('too shallow');
    const axis = width >= depth ? 'x' : 'z';
    const doorways = kit.roomDoorways(context, room).map(entry => kit.doorwayWorld(context.meta, entry.door, entry.index));
    const center = { x:(bounds.minX + bounds.maxX) * .5, z:(bounds.minZ + bounds.maxZ) * .5 };
    const entry = doorways[0] || center;
    const entrySide = (axis === 'x' ? entry.x - center.x : entry.z - center.z) < 0 ? -1 : 1;
    let layout = null;
    for (const side of [entrySide, -entrySide]) {
      for (const spacing of cfg('lavaBasin.ropeSpacing', ROPE_SPACING)) {
        layout = tryBasinLayout(kit, context, room, bounds, basinY, rimY, axis, side, spacing, rng);
        if (layout) break;
      }
      if (layout) break;
    }
    if (!layout) return reject('no rope layout');
    const lavaY = basinY + .06;
    const lava = lavaPlane(kit, bounds, lavaY);
    const basin = {
      id:'lava-basin-' + room.id, roomId:String(room.id), bounds, basinY, rimY, lavaY, lava, depth:+(rimY - basinY).toFixed(2),
      ...layout, plates:[], chests:[], lastSafe:null, inLavaFor:0, lastBurnAt:-Infinity, hinted:false, completed:false, escapes:0,
    };
    // Plates on alternating pillars, chests on the rest; the last pillar
    // always holds the best open chest.
    const chestTier = depthTier;
    basin.pillars.forEach((pillar, index) => {
      const last = index === basin.pillars.length - 1;
      if (!last && index % 2 === 0) {
        basin.plates.push(makePlate(kit, `${basin.id}_${index}`, pillar.x, pillar.topY, pillar.z, () => onBasinPlate(kit, basin)));
      } else {
        const toward = basin.nodes[Math.max(0, basin.nodes.indexOf(pillar) - 1)];
        basin.chests.push(makeChest(kit, `${basin.id}_${index}`, pillar.x, pillar.topY, pillar.z, last ? Math.min(4, chestTier + 1) : chestTier, toward.x - pillar.x, toward.z - pillar.z));
      }
    });
    if (!basin.plates.length && basin.pillars.length) { // Guarantee at least one plate so the vault has a key.
      const p = basin.pillars[0];
      basin.plates.push(makePlate(kit, `${basin.id}_0`, p.x, p.topY, p.z, () => onBasinPlate(kit, basin)));
    }
    if (basin.balcony) placeBalconyChest(kit, basin.balcony, Math.min(4, chestTier + 2)); // Vault chest is the basin's best prize.
    return basin;
  }

  function onBasinPlate(kit, basin) {
    const pressed = basin.plates.filter(plate => plate.pressed).length;
    if (pressed < basin.plates.length) {
      kit.deps?.showToast?.(`Basin plate pressed (${pressed}/${basin.plates.length}).`, true);
      return;
    }
    basin.completed = true;
    if (basin.balcony?.door) {
      basin.balcony.door.open = true;
      kit.deps?.showToast?.('Every basin plate is down — the balcony vault door sinks open.', true);
    } else {
      kit.deps?.showToast?.('Every basin plate is down.', true);
    }
  }

  function inside(bounds, point, pad = 0) {
    return point.x > bounds.minX + pad && point.x < bounds.maxX - pad && point.z > bounds.minZ + pad && point.z < bounds.maxZ - pad;
  }

  function updateBasin(kit, basin, now, dt, player) {
    updateVaultDoor(basin.balcony?.door, dt);
    for (const plate of basin.plates) updatePlate(kit, plate, player);
    if (!player || kit.ownsPlayerMotion()) { basin.inLavaFor = 0; return; }
    // Height matters: under an overhang is still in the lava, and must never
    // be remembered as the safe return point.
    const onTop = node => kit.pointInsidePlatform(player, node, .05) && player.y >= Number(node.topY) - .2;
    const onPlatform = basin.nodes.some(onTop) || (basin.balcony && onTop(basin.balcony.platform));
    const inBasin = inside(basin.bounds, player, .05);
    if (!basin.hinted && Math.hypot(player.x - basin.pad.x, player.z - basin.pad.z) < 3.2) {
      basin.hinted = true;
      kit.deps?.showToast?.(`Lava basin (${basin.depth}u deep): swing between the pillars on the ropes. Pressure plates open the balcony vault.`, true);
    }
    const inLava = inBasin && !onPlatform && player.y < basin.lavaY + .3;
    if (!inLava) {
      basin.inLavaFor = 0;
      // Only remember footing that is clearly up on the ledge (back from the
      // pit edge, at rim height) or on a pillar/pad/balcony. Recording the
      // last frame outside the basin put the return point right on the rim
      // edge at the already-dropping height, so the escape landed the player
      // at the foot of the pit wall.
      const onLedge = !inside(basin.bounds, player, -cfg('lavaBasin.safeEdgeMargin', SAFE_EDGE_MARGIN)) && player.y >= basin.rimY - .12;
      if (onPlatform || onLedge) basin.lastSafe = { x:player.x, z:player.z };
      return;
    }
    basin.inLavaFor += dt;
    if (now - basin.lastBurnAt > 900) {
      basin.lastBurnAt = now;
      window.ResourceSystem?.addAffliction?.(kit.deps?.player, 'burningHealth', cfg('lavaBasin.lavaBurn', LAVA_BURN));
      kit.playLavaSizzle?.();
    }
    if (basin.inLavaFor >= cfg('lavaBasin.lavaEscapeSeconds', LAVA_ESCAPE_S)) {
      basin.inLavaFor = 0;
      basin.escapes++;
      const spot = basin.lastSafe || { x:basin.pad.x, z:basin.pad.z };
      const support = kit.sampleSupport(spot.x, spot.z); // Highest surface there (ledge / pillar top), never the pit floor.
      kit.setPlayerWorld({ x:spot.x, z:spot.z, y:Number(support?.y ?? basin.pad.topY) }, true, true);
      kit.deps?.showToast?.('You scramble out of the lava!', false);
    }
  }

  function buildRooms(kit, context, rng, usedRooms, options) {
    if (options?.lavaBasin === false) return;
    const rooms = (context.meta?.rooms || []).filter(room => !usedRooms.has(room.id));
    const candidates = [];
    for (const room of rooms) {
      for (const region of kit.sunkenRegionsForRoom(context, room)) {
        candidates.push({ room, region, area:Number(region.w) * Number(region.h) });
      }
    }
    candidates.sort((a, b) => b.area - a.area);
    for (const { room, region } of candidates) {
      if (usedRooms.has(room.id)) continue;
      const step = Math.abs(Number(context.meta?.plateauModel?.stepHeight) || .38);
      const deepest = Math.min(...kit.sunkenRegionsForRoom(context, room).map(r => Number(r.level))) * step;
      const depthTier = -deepest >= 2 ? 3 : 2; // Rooms whose pit goes "super deep" roll better chests.
      const basin = buildBasin(kit, context, room, region, rng, depthTier);
      if (!basin) continue;
      usedRooms.add(room.id);
      basins.push(basin);
      kit.recordModulePlacement('lavaBasin', 'sunkenFloor', room.id, { depth:basin.depth, pillars:basin.pillars.length, ropes:basin.ropes.length, plates:basin.plates.length, chests:basin.chests.length + (basin.balcony?.chest ? 1 : 0), balcony:!!basin.balcony });
      break; // One basin per ruin keeps it a set piece.
    }
  }

  function update(kit, now, dt) {
    if (!kit?.state) return;
    const player = kit.playerWorld();
    for (const basin of basins) updateBasin(kit, basin, now, dt, player);
    for (const payoff of payoffs) {
      if (payoff.kind === 'plateDoor') updatePlate(kit, payoff.plate, player);
      if (payoff.kind === 'lift') updateLift(kit, payoff, dt, player);
    }
  }

  function controls(kit) {
    const list = [];
    for (const basin of basins) {
      for (const chest of basin.chests) list.push(...Chests.controlsFor([chest]));
      if (basin.balcony?.chest) list.push(...chestControls(kit, basin.balcony.chest, () => !basin.balcony.door?.open || basin.balcony.door.progress < .7, 'The vault door is sealed — press every pressure plate in the lava basin.'));
    }
    for (const payoff of payoffs) {
      if (payoff.chest) list.push(...Chests.controlsFor([payoff.chest]));
      if (payoff.balcony?.chest) list.push(...Chests.controlsFor([payoff.balcony.chest]));
    }
    return list;
  }

  function snapshot() {
    const point = p => p ? { x:+Number(p.x).toFixed(3), z:+Number(p.z).toFixed(3), topY:+Number(p.topY).toFixed(3) } : null;
    return {
      rejects:rejects.slice(),
      basins:basins.map(basin => ({
        id:basin.id, roomId:basin.roomId, depth:basin.depth, lavaY:+basin.lavaY.toFixed(3), rimY:basin.rimY,
        bounds:basin.bounds, pad:point(basin.pad), pillars:basin.pillars.map(point), nodes:basin.nodes.map(point),
        ropes:basin.ropes.map(rope => rope.id), plates:basin.plates.map(plate => ({ id:plate.id, pressed:plate.pressed, x:plate.x, z:plate.z, y:plate.y })),
        chests:basin.chests.map(chest => ({ id:chest.id, tier:chest.tier, opened:chest.opened })),
        balcony:basin.balcony ? { ...point(basin.balcony), wallNormal:basin.balcony.wallNormal, doorOpen:!!basin.balcony.door?.open, doorProgress:+(basin.balcony.door?.progress || 0).toFixed(3), chestTier:basin.balcony.chest?.tier || null } : null,
        completed:basin.completed, escapes:basin.escapes,
      })),
      payoffs:payoffs.map(payoff => ({ plate:payoff.plate ? { x:payoff.plate.x, y:payoff.plate.y, z:payoff.plate.z } : null, sealed:payoff.sealed ?? null, kind:payoff.kind, roomId:payoff.roomId, doorId:payoff.doorId || null, platePressed:payoff.plate?.pressed ?? null, chestTier:(payoff.chest || payoff.balcony?.chest)?.tier || null, liftProgress:payoff.lift ? +payoff.lift.progress.toFixed(3) : null, balcony:payoff.balcony ? point(payoff.balcony) : null, lift:payoff.lift ? point(payoff.lift) : null })),
    };
  }

  SimplePuzzles.registerComposer({ id:'ropeRewards', buildRooms, onStandaloneRope, update, controls, snapshot, clear });
  window.DevRandomRuinRopeRewards = Object.freeze({
    snapshot,
    setForcedPayoff:kind => { forcedPayoff = ['plateDoor', 'lift', 'chest'].includes(kind) ? kind : null; return forcedPayoff; }, // Applies on the next generate().
  });
})();

// Ceiling-rail projectile targets for the Random Test Ruin.
//
// A late composer on js/dev-random-ruin-simple-puzzles.js: it takes one room
// the other modules left free and hangs a rail along its long axis just under
// the ceiling, with a dark slot in each end wall. While the player is inside
// the room, glowing targets slide out of those slots and zip along the rail,
// pausing briefly at random stops; when the player leaves they race back into
// the walls. Shooting every target opens a Dungeon Chest cache in the room.
// Hits go through the runtime's one modular projectile seam
// (kit.registerProjectileTarget), and everything is owned/disposed by it.
(() => {
  'use strict';

  const SimplePuzzles = window.DevRandomRuinSimplePuzzles;
  if (!window.THREE || !SimplePuzzles?.registerComposer) return;

  const TARGET_COLOR = 0xff8a2a; // Same orange-until-struck / green-after language as the ceiling glyphs.
  const STRUCK_COLOR = 0x4dff6e;
  const RAIL_DROP = .18; // Rail hangs this far under the ceiling.
  const DISC_DROP = .5; // Target disc centre below the rail.
  const EMERGE_SPEED = 1.4;
  const ZIP_SPEED = 5.2;
  const RETRACT_SPEED = 6.5;
  const WALL_HIDE = .45; // How far into the wall a hidden target sits.
  const END_STOP = .7; // Closest a zipping target comes to an end wall.
  const cfg = (path, fallback) => window.DevRandomRuinConfig?.get?.(path, fallback) ?? fallback; // docs/config/random-ruin/ruin-config.json

  let rooms = [];
  let rejects = [];

  function clear() { rooms = []; rejects = []; }

  function frameFor(kit, context, room) {
    const bounds = kit.roomBounds(context.meta, room);
    const width = bounds.maxX - bounds.minX, depth = bounds.maxZ - bounds.minZ;
    const axis = width >= depth ? 'x' : 'z';
    const start = axis === 'x' ? bounds.minX : bounds.minZ, end = axis === 'x' ? bounds.maxX : bounds.maxZ;
    const crossMin = axis === 'x' ? bounds.minZ : bounds.minX, crossMax = axis === 'x' ? bounds.maxZ : bounds.maxX;
    return { bounds, axis, start, end, span:end - start, crossMin, crossMax };
  }

  // Cross position for the rail that keeps its wall slots off every doorway
  // in the two end walls.
  function railCross(kit, context, room, frame, rng) {
    const doors = kit.roomDoorways(context, room).map(entry => kit.doorwayWorld(context.meta, entry.door, entry.index));
    const endDoors = doors.filter(door => {
      const along = frame.axis === 'x' ? door.x : door.z;
      return Math.abs(along - frame.start) < .6 || Math.abs(along - frame.end) < .6;
    });
    const mid = (frame.crossMin + frame.crossMax) * .5, half = (frame.crossMax - frame.crossMin) * .5;
    const offsets = [0, .2, -.2, .35, -.35].map(f => f * half * (rng() < .5 ? 1 : -1));
    for (const offset of offsets) {
      const cross = mid + offset;
      if (endDoors.every(door => Math.abs(cross - (frame.axis === 'x' ? door.z : door.x)) > door.width * .5 + .55)) return cross;
    }
    return null;
  }

  function buildRoom(kit, context, room, rng) {
    const frame = frameFor(kit, context, room);
    if (frame.span < 6) { rejects.push(`${room.id}: span ${frame.span.toFixed(1)} too short`); return null; }
    const cross = railCross(kit, context, room, frame, rng);
    if (cross == null) { rejects.push(`${room.id}: doorways in both end walls`); return null; }
    const ceilY = (Number(context.meta?.floorSurfaceY) || 0) + (Number(context.meta?.wallHeight) || 3);
    const railY = ceilY - RAIL_DROP;
    const at = (s, y, out = new THREE.Vector3()) => frame.axis === 'x' ? out.set(frame.start + s, y, cross) : out.set(cross, y, frame.start + s); // Callers in the per-frame path pass their own output vector.
    const group = new THREE.Group();
    group.name = 'dev_ruin_ceiling_rail_' + room.id;
    kit.group().add(group);
    const metal = kit.makeBasic(0x4b4238), slotMat = kit.makeBasic(0x0c0a08);
    const along = (len, thick, tall) => frame.axis === 'x' ? kit.sharedBoxGeometry(len, tall, thick) : kit.sharedBoxGeometry(thick, tall, len);
    const rail = new THREE.Mesh(along(frame.span - .04, .1, .07), metal);
    rail.position.copy(at(frame.span * .5, railY));
    rail.name = 'dev_ruin_ceiling_rail_bar_' + room.id;
    group.add(rail);
    for (let s = .8; s < frame.span - .4; s += 1.6) {
      const hanger = new THREE.Mesh(kit.sharedBoxGeometry(.05, RAIL_DROP, .05), metal);
      hanger.position.copy(at(s, railY + RAIL_DROP * .5));
      hanger.name = 'dev_ruin_ceiling_rail_hanger_' + room.id;
      group.add(hanger);
    }
    for (const s of [0, frame.span]) { // Dark slots the targets slide out of.
      const slot = new THREE.Mesh(frame.axis === 'x' ? kit.sharedBoxGeometry(.06, .78, .66) : kit.sharedBoxGeometry(.66, .78, .06), slotMat);
      slot.position.copy(at(s + (s ? -.02 : .02), railY - DISC_DROP + .05));
      slot.name = 'dev_ruin_ceiling_rail_slot_' + room.id;
      group.add(slot);
    }
    const count = Math.max(1, Math.round(cfg('ceilingRailTargets.count', rng() < .5 ? 3 : 2)));
    const record = { id:'rail-' + room.id, roomId:String(room.id), frame, cross, railY, at, group, targets:[], inside:false, solved:false, chest:null, hinted:false };
    for (let i = 0; i < count; i++) {
      const home = i % 2 ? frame.span + WALL_HIDE : -WALL_HIDE; // Alternate ends so targets emerge from both walls.
      const object = new THREE.Group();
      object.name = 'dev_ruin_ceiling_rail_projectile_target_' + room.id + '_' + i;
      const trolley = new THREE.Mesh(kit.sharedBoxGeometry(.24, .1, .24), metal);
      const stem = new THREE.Mesh(kit.sharedCylinderGeometry(.025, .025, DISC_DROP - .2, 6), metal);
      stem.position.y = -(DISC_DROP - .2) * .5 - .05;
      const material = kit.makeBasic(TARGET_COLOR);
      const disc = new THREE.Mesh(kit.sharedCylinderGeometry(.27, .27, .08, 10), material);
      disc.position.y = -DISC_DROP;
      if (frame.axis === 'x') disc.rotation.x = Math.PI * .5; else disc.rotation.z = Math.PI * .5; // Face across the room, toward its long walls.
      object.add(trolley, stem, disc);
      object.visible = false;
      group.add(object);
      const target = {
        id:`${record.id}-target-${i}`, object, disc, material, home, s:home, from:home, to:home, t:1, mode:'hidden', pauseLeft:0, active:false,
        hittable:() => object.visible && target.mode !== 'hidden',
        onHit:() => strike(kit, record, target),
      };
      placeTarget(record, target);
      kit.registerProjectileTarget(target);
      record.targets.push(target);
    }
    kit.recordModulePlacement('ceilingRailTargets', 'room', room.id, { targets:count, axis:frame.axis });
    return record;
  }

  function placeTarget(record, target) {
    record.at(target.s, record.railY - .05, target.object.position); // Writes in place: called every frame for each moving target.
  }

  function moveTo(target, s, speed, mode) {
    target.from = target.s; target.to = s; target.t = 0; target.mode = mode;
    target.duration = Math.max(.12, Math.abs(s - target.s) / speed);
  }

  function nextStop(record, target) {
    const span = record.frame.span;
    let s = target.s;
    for (let tries = 0; tries < 6 && Math.abs(s - target.s) < 1.6; tries++) s = END_STOP + Math.random() * (span - END_STOP * 2);
    return s;
  }

  function strike(kit, record, target) {
    if (target.active) return;
    target.active = true;
    target.material.color.setHex(STRUCK_COLOR);
    kit.playStoneUnlockKchunk?.();
    const hit = record.targets.filter(entry => entry.active).length;
    // Struck targets coast home and stay in their wall slot.
    moveTo(target, target.home, RETRACT_SPEED * .6, 'retracting');
    if (hit < record.targets.length) { kit.deps?.showToast?.(`Rail target struck (${hit}/${record.targets.length}).`, true); return; }
    record.solved = true;
    openCache(kit, record);
  }

  function openCache(kit, record) {
    const Chests = window.DevRandomRuinDungeonChests;
    const b = record.frame.bounds;
    const x = (b.minX + b.maxX) * .5, z = (b.minZ + b.maxZ) * .5;
    const support = kit.sampleSupport(x, z);
    if (Chests?.create && support) {
      record.chest = Chests.create({ id:record.id + '_cache', parent:kit.group(), x, y:Number(support.y), z, tier:2, yaw:0 });
      kit.deps?.showToast?.('Every rail target is down — a cache rises from the floor.', true);
    } else {
      kit.deps?.showToast?.('Every rail target is down.', true);
    }
  }

  function playerInside(record, player) {
    const b = record.frame.bounds;
    return !!player && player.x > b.minX + .15 && player.x < b.maxX - .15 && player.z > b.minZ + .15 && player.z < b.maxZ - .15 && player.y < record.railY;
  }

  function updateRoom(kit, record, dt, player) {
    const inside = playerInside(record, player);
    if (inside && !record.hinted && !record.solved) {
      record.hinted = true;
      kit.deps?.showToast?.('Something whirs in the walls — targets on the ceiling rail. Shoot them all.', true);
    }
    record.inside = inside;
    for (const target of record.targets) {
      if (target.t < 1) {
        target.t = Math.min(1, target.t + dt / target.duration);
        const e = target.mode === 'zipping' ? target.t * target.t * (3 - 2 * target.t) : target.t; // Zips ease in and out; emerging/retracting slide steadily.
        target.s = target.from + (target.to - target.from) * e;
        placeTarget(record, target);
        if (target.t < 1) continue;
        if (target.mode === 'retracting') { target.mode = 'hidden'; target.object.visible = false; continue; }
        target.mode = 'pausing'; target.pauseLeft = .25 + Math.random() * .7;
      }
      if (target.active) continue;
      if (!inside) {
        if (target.mode !== 'hidden') moveTo(target, target.s < record.frame.span * .5 ? -WALL_HIDE : record.frame.span + WALL_HIDE, RETRACT_SPEED, 'retracting');
        continue;
      }
      if (target.mode === 'hidden') {
        target.object.visible = true;
        moveTo(target, target.home < 0 ? END_STOP : record.frame.span - END_STOP, EMERGE_SPEED, 'emerging');
      } else if (target.mode === 'pausing' && (target.pauseLeft -= dt) <= 0) {
        moveTo(target, nextStop(record, target), ZIP_SPEED, 'zipping');
      }
    }
  }

  function buildLate(kit, context, rng, usedRooms) {
    if (!(rng() < cfg('moduleChances.ceilingRailTargets', .55)) && window.__devRuinForceRailTargets !== true) return; // rng() is drawn first so seeds reproduce; the flag is a headless-test hook.
    const free = (context.meta?.rooms || []).filter(room => !usedRooms.has(room.id)).sort((a, b) => Number(b.w) * Number(b.h) - Number(a.w) * Number(a.h));
    for (const room of free) {
      const record = buildRoom(kit, context, room, rng);
      if (!record) continue;
      usedRooms.add(room.id);
      rooms.push(record);
      return;
    }
  }

  function update(kit, now, dt) {
    if (!rooms.length) return;
    const player = kit.playerWorld();
    for (const record of rooms) updateRoom(kit, record, dt, player);
  }

  function controls() {
    const Chests = window.DevRandomRuinDungeonChests;
    return rooms.filter(record => record.chest).flatMap(record => Chests?.controlsFor?.([record.chest]) || []);
  }

  function snapshot() {
    return {
      rejects:rejects.slice(),
      rooms:rooms.map(record => ({
        id:record.id, roomId:record.roomId, axis:record.frame.axis, span:+record.frame.span.toFixed(2), railY:+record.railY.toFixed(3), inside:record.inside, solved:record.solved, chest:!!record.chest,
        targets:record.targets.map(target => ({ id:target.id, mode:target.mode, active:target.active, visible:target.object.visible, s:+target.s.toFixed(2) })),
      })),
    };
  }

  SimplePuzzles.registerComposer({ id:'ceilingRailTargets', buildLate, update, controls, snapshot, clear });
  window.DevRandomRuinRailTargets = Object.freeze({
    snapshot,
    targetObjects:() => rooms.flatMap(record => record.targets.map(target => target.object)), // Diagnostics: live target groups (world position, visibility).
  });
})();

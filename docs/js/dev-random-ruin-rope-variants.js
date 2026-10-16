// Harder standalone rope rooms for the Random Test Ruin.
//
// js/dev-random-ruin-simple-puzzles.js asks buildStandalone() for its one
// standalone rope room before falling back to the classic two-platform swing.
// Built only from that runtime's kit, so everything placed here is owned and
// disposed by it, and the returned rope gets the usual payoffs (plate door,
// chest, lift) on its far platform.
//
//  * pump  — the landing is higher and/or farther than one held push reaches.
//            The player has to swing back and forth (pumping only adds swing
//            in the direction of travel) before letting go.
//  * chain — rope-to-rope: the launch rope throws the player onto a second,
//            air-only rope hanging over the lava with no platform between;
//            that rope carries them on to the landing.
//
// Every layout is checked with the runtime's own pendulum/flight simulation
// (kit.ropeReachAmplitude): reachable with a pumped swing, and for 'pump'
// rooms not reachable with a single push.
(() => {
  'use strict';

  const SimplePuzzles = window.DevRandomRuinSimplePuzzles;
  if (!window.THREE || !SimplePuzzles?.registerComposer) return;

  const ONE_PUSH_AMP = .98; // Swing amplitude a single held push from the launch deck reaches (ROPE_PUMP in simple-puzzles).
  const PUMPED_AMP = 1.2; // Reached after a few pumped swings; stays under the 1.28 rad swing clamp.
  const HEADROOM = 1.6; // Landing tops stay this far below the ceiling so the player fits on them.
  const WALL_MARGIN = 1.6; // Platform centres keep this far from the room's end walls.
  const PLATFORM_ALONG = 2.1, PLATFORM_CROSS = 2.5;
  const cfg = (path, fallback) => window.DevRandomRuinConfig?.get?.(path, fallback) ?? fallback; // docs/config/random-ruin/ruin-config.json

  let built = [];
  let rejects = [];

  function clear() { built = []; rejects = []; }

  function shuffled(list, rng) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }

  // Long axis of the room plus the floor tier along its centre line; null
  // when the floor is not one level (stairs/plateaus get their own pieces).
  function roomFrame(kit, context, room) {
    const bounds = kit.roomBounds(context.meta, room);
    const width = bounds.maxX - bounds.minX, depth = bounds.maxZ - bounds.minZ;
    const axis = width >= depth ? 'x' : 'z';
    const dir = axis === 'x' ? { x:1, z:0 } : { x:0, z:1 };
    const start = axis === 'x' ? bounds.minX : bounds.minZ, end = axis === 'x' ? bounds.maxX : bounds.maxZ;
    const cross = axis === 'x' ? (bounds.minZ + bounds.maxZ) * .5 : (bounds.minX + bounds.maxX) * .5;
    const crossSpan = axis === 'x' ? depth : width;
    const at = along => axis === 'x' ? { x:along, z:cross } : { x:cross, z:along };
    let floorY = null;
    for (let t = 0; t <= 8; t++) {
      const p = at(start + WALL_MARGIN + (end - start - WALL_MARGIN * 2) * t / 8);
      const support = kit.sampleSupport(p.x, p.z);
      if (!support) return null;
      if (floorY == null) floorY = Number(support.y);
      else if (Math.abs(Number(support.y) - floorY) > .32) return null;
    }
    const ceilY = (Number(context.meta?.floorSurfaceY) || 0) + (Number(context.meta?.wallHeight) || 3);
    return { bounds, axis, dir, start, end, span:end - start, crossSpan, at, floorY, ceilY, anchorY:ceilY - .035 };
  }

  function platform(kit, name, frame, along, top) {
    const p = frame.at(along);
    const support = kit.sampleSupport(p.x, p.z);
    if (!support) return null;
    const baseY = Number(support.y);
    return kit.createPlatform(name, p.x, p.z, baseY, frame.axis === 'x' ? PLATFORM_ALONG : PLATFORM_CROSS, frame.axis === 'x' ? PLATFORM_CROSS : PLATFORM_ALONG, Math.max(.28, top - baseY));
  }

  // Plain pendulum description for the reach simulation (no meshes yet).
  function pendulum(frame, anchorAlong, length, angle = 0) {
    const p = frame.at(anchorAlong);
    const rope = { anchor:{ x:p.x, y:frame.anchorY, z:p.z }, yaw:Math.atan2(frame.dir.z, frame.dir.x), length, angle };
    const horizontal = Math.sin(angle) * length;
    rope.bob = { x:p.x + frame.dir.x * horizontal, y:frame.anchorY - Math.cos(angle) * length, z:p.z + frame.dir.z * horizontal };
    return rope;
  }

  // Launch rope over deck A: idles back over the deck's front edge at the
  // usual reachable grip height, `reach` along the axis from its anchor.
  function launchPendulum(kit, frame, a, reach) {
    const aAlong = frame.axis === 'x' ? a.x : a.z;
    const bobRestY = a.topY + kit.ropeConstants.ROPE_GRAB_ABOVE_LAUNCH;
    const drop = frame.anchorY - bobRestY;
    if (drop <= .6) return null;
    const grabAlong = aAlong + PLATFORM_ALONG * .43;
    const length = Math.hypot(reach, drop), startAngle = Math.atan2(reach, drop);
    if (frame.anchorY - length < frame.floorY + .14) return null; // Pendulum bottom must stay above the floor.
    const rope = pendulum(frame, grabAlong + reach, length, -startAngle);
    const grab = frame.at(grabAlong);
    rope.grabPoint = { x:grab.x, z:grab.z, y:bobRestY };
    rope.startAngle = startAngle;
    return rope;
  }

  function finishRope(kit, context, room, frame, plain, options) {
    const rope = kit.createRopeObject({
      room, idSuffix:options.idSuffix, anchor:plain.anchor, yaw:plain.yaw, length:plain.length,
      maxLength:Math.max(plain.length, Math.min(plain.length + .55, frame.anchorY - frame.floorY - .14)), minBobY:frame.floorY + .12,
      angle:plain.angle, startPlatform:options.startPlatform || null, endPlatform:options.endPlatform || null, grabPoint:plain.grabPoint || null,
    });
    rope.variant = options.variant;
    rope.lastSafeBob = kit.clonePoint(kit.updateRopeVisual(rope));
    kit.state.ropes.push(rope);
    return rope;
  }

  function lavaBetween(kit, frame, a, b) {
    const aAlong = frame.axis === 'x' ? a.x : a.z, bAlong = frame.axis === 'x' ? b.x : b.z;
    const length = Math.abs(bAlong - aAlong) - PLATFORM_ALONG;
    if (length < 1.5) return null;
    const mid = frame.at((aAlong + bAlong) * .5);
    return kit.ropeLavaStrip(mid.x, mid.z, frame.floorY, length, Math.min(2.2, frame.crossSpan - 2), frame.axis);
  }

  // Higher and/or farther landing that only a pumped swing reaches.
  function buildPump(kit, context, room, frame, rng) {
    const maxTop = frame.ceilY - HEADROOM - frame.floorY;
    const plans = [];
    for (const sep of [6.4, 6.0, 5.6]) for (let top = maxTop; top >= 1.3; top -= .15) plans.push({ kind:'high', sep, top, reach:sep * .5 - PLATFORM_ALONG * .43 });
    for (const sep of [8.6, 8.0, 7.4, 6.8]) for (const reach of [1.7, 2.0, 2.3]) plans.push({ kind:'far', sep, top:Math.min(maxTop, .28 + kit.ropeConstants.ROPE_DESTINATION_RISE + rng() * .3), reach });
    const order = rng() < .5 ? plans : [...plans.filter(plan => plan.kind === 'far'), ...plans.filter(plan => plan.kind === 'high')];
    for (const plan of order) {
      if (plan.sep > frame.span - WALL_MARGIN * 2 || plan.top < .28 + kit.ropeConstants.ROPE_DESTINATION_RISE) continue;
      const startAlong = (frame.start + frame.end) * .5 - plan.sep * .5;
      const a = platform(kit, 'dev_ruin_rope_platform_a_' + room.id, frame, startAlong, frame.floorY + .28);
      const b = a && platform(kit, 'dev_ruin_rope_platform_b_' + room.id, frame, startAlong + plan.sep, frame.floorY + plan.top);
      const cleanup = () => { if (a) kit.removePlatform(a); if (b) kit.removePlatform(b); };
      const rope = b && launchPendulum(kit, frame, a, plan.reach);
      if (!rope) { cleanup(); continue; }
      const reach = kit.ropeReachAmplitude(rope, { platform:b }, { maxAmp:PUMPED_AMP, minAmp:Math.max(.6, rope.startAngle), floorY:frame.floorY });
      if (reach == null || reach <= ONE_PUSH_AMP || !kit.ropeArcClear(rope, Math.min(1.28, reach + .05))) { cleanup(); continue; }
      const live = finishRope(kit, context, room, frame, rope, { idSuffix:'pump', startPlatform:a, endPlatform:b, variant:'pump-' + plan.kind });
      live.hazard = lavaBetween(kit, frame, a, b);
      return { rope:live, kind:'pump', detail:{ layout:plan.kind, separation:plan.sep, landingTop:+(b.topY - frame.floorY).toFixed(2), reachAmp:reach } };
    }
    rejects.push(`pump ${room.id}: no layout needs and allows pumping`);
    return null;
  }

  // Launch rope -> mid-air catch of a hanging rope -> landing.
  function buildChain(kit, context, room, frame, rng) {
    const maxTop = frame.ceilY - HEADROOM - frame.floorY;
    const baseTop = .28 + kit.ropeConstants.ROPE_DESTINATION_RISE;
    const plans = [];
    for (const sep of [10.2, 9.6, 9.0, 8.4, 7.8, 7.2]) for (const reach of [1.8, 2.1]) for (const gap of [2.4, 2.8, 3.2, 3.6]) for (const top of [Math.min(maxTop, baseTop + .35), baseTop]) plans.push({ sep, reach, gap, top });
    for (const plan of shuffled(plans, rng).sort((p, q) => q.sep - p.sep)) {
      if (plan.sep > frame.span - WALL_MARGIN * 2) continue;
      const startAlong = (frame.start + frame.end) * .5 - plan.sep * .5;
      const a = platform(kit, 'dev_ruin_rope_platform_a_' + room.id, frame, startAlong, frame.floorY + .28);
      const b = a && platform(kit, 'dev_ruin_rope_platform_b_' + room.id, frame, startAlong + plan.sep, frame.floorY + plan.top);
      const cleanup = () => { if (a) kit.removePlatform(a); if (b) kit.removePlatform(b); };
      const first = b && launchPendulum(kit, frame, a, plan.reach);
      if (!first) { cleanup(); continue; }
      const firstAlong = (frame.axis === 'x' ? first.anchor.x : first.anchor.z);
      const secondAlong = firstAlong + plan.gap;
      const bNear = startAlong + plan.sep - PLATFORM_ALONG * .5;
      if (secondAlong > bNear - 1.0) { cleanup(); continue; } // The hanging rope must sit over the gap, not over the landing.
      const second = pendulum(frame, secondAlong, frame.anchorY - (frame.floorY + 1.2));
      const catchAmp = kit.ropeReachAmplitude(first, { rope:second }, { maxAmp:PUMPED_AMP, minAmp:Math.max(.6, first.startAngle), floorY:frame.floorY });
      if (catchAmp == null || !kit.ropeArcClear(first, Math.min(1.28, catchAmp + .05))) { cleanup(); continue; }
      const direct = kit.ropeReachAmplitude(first, { platform:b }, { maxAmp:1.28, minAmp:Math.max(.6, first.startAngle), floorY:frame.floorY });
      if (direct != null) { cleanup(); continue; } // The first rope alone must not reach the landing.
      const landAmp = kit.ropeReachAmplitude(second, { platform:b }, { maxAmp:PUMPED_AMP, minAmp:.3, floorY:frame.floorY });
      if (landAmp == null || !kit.ropeArcClear(second, Math.min(1.28, landAmp + .05))) { cleanup(); continue; }
      const live = finishRope(kit, context, room, frame, first, { idSuffix:'chain1', startPlatform:a, endPlatform:b, variant:'chain' });
      const hanging = finishRope(kit, context, room, frame, second, { idSuffix:'chain2', variant:'chain' });
      live.hazard = lavaBetween(kit, frame, a, b);
      live.chainNext = hanging.id;
      return { rope:live, kind:'chain', ropes:[live, hanging], detail:{ separation:plan.sep, gap:plan.gap, landingTop:+(b.topY - frame.floorY).toFixed(2), catchAmp, landAmp } };
    }
    rejects.push(`chain ${room.id}: no rope-to-rope layout fits`);
    return null;
  }

  // Returns the launch rope (startPlatform/endPlatform set) or null.
  function buildStandalone(kit, context, rng, usedRooms) {
    const chainChance = cfg('ropeVariants.chainChance', .35), pumpChance = cfg('ropeVariants.pumpChance', .4);
    const roll = rng();
    const kinds = roll < chainChance ? ['chain', 'pump'] : roll < chainChance + pumpChance ? ['pump', 'chain'] : null;
    if (!kinds) return null;
    for (const room of shuffled(kit.usableRoomCandidates(context).filter(room => !usedRooms.has(room.id)), rng)) {
      const frame = roomFrame(kit, context, room);
      if (!frame) continue;
      for (const kind of kinds) {
        const result = kind === 'chain' ? buildChain(kit, context, room, frame, rng) : buildPump(kit, context, room, frame, rng);
        if (!result) continue;
        usedRooms.add(room.id);
        built.push({ roomId:String(room.id), kind:result.kind, ropeIds:(result.ropes || [result.rope]).map(rope => rope.id), start:result.rope.startPlatform, detail:result.detail, hinted:false });
        kit.recordModulePlacement('ropeVariant', 'room', room.id, { kind:result.kind, ...result.detail });
        return result.rope;
      }
    }
    return null;
  }

  function update(kit) {
    if (!built.length) return;
    const player = kit.playerWorld();
    if (!player) return;
    for (const entry of built) {
      if (entry.hinted || Math.hypot(player.x - entry.start.x, player.z - entry.start.z) > 2.6) continue;
      entry.hinted = true;
      kit.deps?.showToast?.(entry.kind === 'chain'
        ? 'The landing is out of reach of one rope: let go mid-swing and catch the hanging rope beyond.'
        : 'That ledge is too high and far for one push: swing back and forth to build height before letting go.', true);
    }
  }

  function snapshot() {
    return { rejects:rejects.slice(), built:built.map(entry => ({ roomId:entry.roomId, kind:entry.kind, ropeIds:entry.ropeIds, detail:entry.detail, hinted:entry.hinted })) };
  }

  SimplePuzzles.registerComposer({ id:'ropeVariants', update, snapshot, clear });
  window.DevRandomRuinRopeVariants = Object.freeze({ buildStandalone, snapshot });
})();

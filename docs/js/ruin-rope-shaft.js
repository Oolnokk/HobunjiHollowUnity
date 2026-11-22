// RuinRopeShaft — the "rope swings" central-shaft traversal: an alternate to the jump-platform staircase
// (js/ruin-jump-shaft.js), rolled per ruin from RuinLayerPlan.SHAFT_PUZZLES.
//
// The jump staircase loops the whole ring once per story, so every story's slabs sit over the story
// below and the upper slabs' support pillars run straight through the lower slabs. Here each story owns
// its own stretch of the ring instead, so no slab ever overlaps another in plan view and no pillar can
// pass through a platform. The height a story loses by having only part of the ring is made up by one
// swing rope:
//
//   gallery -> a few jump steps -> launch pad -> ROPE -> landing -> jump steps -> next gallery
//
// The rope hangs from a stone bracket under the balcony above, over the launch pad's forward edge. It is
// the ruin's ordinary rider rope (DevRandomRuinSimplePuzzles.addFurnitureRope): grab, pump the swing back
// and forth, and let go on the forward upswing to fly up onto the landing. No climbing is needed (the
// brake still lets a rider shorten it). The swing runs along the climb direction, so everything behind
// the rider is lower: the backswing passes over the steps just climbed.
//
//   compose()  pure layout + proof: jump hops against PlayerJump's reach (as the staircase), every rope
//              against RopeCore's own swing and release flight (the rope rooms' reachAmplitude check), the
//              full swing arc — backswing included, up to the swing limit — clear of every slab, and no
//              two slabs overlapping in plan.
//   mount()    RuinJumpShaft.mount (slabs, pillars, death pit, tradition hazards) + brackets + ropes.
(function (root, factory) {
  const isCjs = typeof module === 'object' && module.exports;
  const api = factory(isCjs ? require('./ruin-jump-shaft.js') : root.RuinJumpShaft,
    () => root.RopeCore || (isCjs ? require('./rope-core.js') : null));
  if (isCjs) module.exports = api;
  else root.RuinRopeShaft = api;
})(typeof self !== 'undefined' ? self : globalThis, function (Jump, ropeCore) {
  'use strict';
  const root = typeof self !== 'undefined' ? self : globalThis;
  const TRAVERSAL = 'ropeSwings';
  const { RISE, THICKNESS, EDGE, FIXTURE_MARGIN, SAFE_GAP_FRACTION, DEATH_DEPTH, PILLAR_RADIUS, perimeterPoint, edgeGap, reach } = Jump;
  // Rider rope numbers from js/dev-random-ruin-simple-puzzles.js (its proof must match the ride).
  const GRIP_ABOVE_LAUNCH = .86; // ROPE_GRAB_ABOVE_LAUNCH: resting grip over the launch platform.
  const BODY = [.15, .75, 1.3], BODY_RADIUS = .24; // ROPE_BODY_SAMPLE_OFFSETS, ROPE_COLLISION_RADIUS.
  const SIDE_CLEARANCE = .2; // PLATFORM_SIDE_CLEARANCE: a landing below the top by more than this hits the side.
  const PROOF_AMP = 1.1; // Swing amplitude (rad) a rider must need at most to make the landing.
  const BALCONY_UNDERSIDE = 1; // Shaft cells are one unit tall: a balcony's underside is 1 below its floor.
  const ANCHOR_BELOW_BALCONY = BALCONY_UNDERSIDE + .05; // The bracket sits flush under the balcony face.
  const GRIP_INSET = .45; // The resting rope hangs this far inside the launch pad's forward edge.
  const MIN_ROPE = 3; // Shorter ropes add too little height to be worth a story's ring space.
  const LANDING = 3; // Landing slabs are at least this wide: forgiving after a flight.
  const GAP = 1, MAX_GAP = 1.6;
  const SIZES = [2.6, 2.4, 2.2, 2.0, 1.8, 1.6]; // Step slabs: the widest that lets every story fit its stretch of the ring.

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const pillarHalf = p => (Math.max(1, Math.round(p.w)) % 2 === 0 ? 2 : 3) * .75 / 2; // RuinShaftSupportPillars foot.

  // ---------------------------------------------------------------- rope physics (RopeCore + the ride's flight)
  // Swing-plane coordinates: s = horizontal distance from the anchor along the climb direction, y = height.
  // `blocks(s, y)` reports a rider body at (s, y) (datum = feet) intersecting stone.
  function swingClear(L, anchorY, amp, blocks) {
    const steps = 72;
    for (let i = 0; i <= steps; i++) {
      const theta = -amp + 2 * amp * i / steps;
      if (blocks(Math.sin(theta) * L, anchorY - Math.cos(theta) * L)) return false;
    }
    return true;
  }
  // The rider's release flight (updateFlight): RopeCore gravity, release kick, no air control (conservative).
  // The ride steps it once per frame with dt up to 0.05 s, which flies shorter than a 60 fps step: proofs run both.
  const FLIGHT_STEPS = [1 / 60, .05];
  function flightLands(start, landing, blocks, dt = 1 / 60) {
    const RC = ropeCore(), f = { ...start };
    for (let step = 0; step < 4 / dt; step++) {
      f.vy -= RC.GRAVITY * dt;
      const ns = f.s + f.vs * dt, ny = f.y + f.vy * dt;
      const onTop = f.vy <= 0 && ny <= landing.top + .08 && ny >= landing.top - SIDE_CLEARANCE
        && Math.abs(ns - landing.s) <= landing.half - .15;
      if (onTop) return true;
      if (blocks(ns, ny)) return false; // Hitting a slab's side (or anything else) is not a landing.
      f.s = ns; f.y = ny;
      if (f.y < landing.top - 2) return false;
    }
    return false;
  }
  // Smallest amplitude whose forward swing lands from a whole run of release moments (RopeCore.reachAmplitude's
  // sweep, made stricter): letting go anywhere within RELEASE_WINDOW radians of swing must work, so the jump-off
  // is a timing a player can hit rather than one exact frame.
  const RELEASE_WINDOW = .15;
  function ropeProof(L, anchorY, landing, blocks, maxAmp = PROOF_AMP) {
    const RC = ropeCore(), samples = 30;
    for (let amp = .6; amp <= maxAmp + 1e-6; amp += .05) {
      const step = amp * .85 / samples;
      let run = 0;
      for (let i = 0; i <= samples; i++) {
        const theta = amp * .15 + step * i;
        const omega = Math.sqrt(Math.max(0, 2 * (RC.GRAVITY / L) * (Math.cos(theta) - Math.cos(amp))));
        const start = { s: Math.sin(theta) * L, y: anchorY - Math.cos(theta) * L, vs: Math.cos(theta) * L * omega, vy: Math.sin(theta) * L * omega + RC.RELEASE_KICK };
        run = FLIGHT_STEPS.every(dt => flightLands(start, landing, blocks, dt)) ? run + 1 : 0; // Lands at 60 fps and at the ride's coarsest 20 fps step.
        if ((run - 1) * step >= RELEASE_WINDOW) return +amp.toFixed(2);
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- layout
  function compose(options = {}) {
    const o = { shaft: 27, wall: 8, spacing: 10, floors: 3, seed: 1, originX: 0, originZ: 0, baseY: 0, theme: null, entranceSide: 'S', ...options };
    if (!Number.isInteger(o.spacing) || o.spacing < 4 || o.shaft < 17 || !Number.isInteger(o.floors) || o.floors < 2 || o.floors > 5)
      throw new Error('Rope shaft needs a 17+ cell shaft and 2-5 floors.');
    if (!ropeCore()?.GRAVITY) throw new Error('Rope shaft needs RopeCore.');
    const centre = { x: o.originX + o.wall + o.shaft / 2, z: o.originZ + o.wall + o.shaft / 2 };
    const C = o.shaft - 2 * Jump.GALLERY, lim = C / 2 - EDGE, theme = String(o.theme || '').toLowerCase();
    const entry = { N: 0, E: 1, S: 2, W: 3 }[String(o.entranceSide || 'S').toUpperCase()] ?? 2;
    let failure = 'no size fits';
    for (const size of SIZES) {
      const attempt = layoutAll(o, centre, C, lim, size, theme, entry);
      if (attempt.plan) return attempt.plan;
      failure = attempt.reason;
    }
    const plan = { method: TRAVERSAL, options: o, platforms: [], routes: [], ropes: [], centre, central: C, physics: { gravity: 11.8, reach: reach(RISE), rise: RISE },
      pit: { bottomY: o.baseY - DEATH_DEPTH, style: 'tradition', depth: DEATH_DEPTH } };
    plan.checks = [{ name: 'layout', ok: false, detail: failure }];
    plan.ok = false;
    return plan;
  }

  function layoutAll(o, centre, C, lim, size, theme, entry) {
    const pathHalf = lim - size / 2, side = pathHalf * 2, ring = side * 4, R = o.floors - 1, arc = ring / R;
    const start = entry * side + pathHalf; // First story starts beside the entrance wall's midpoint, as the staircase does.
    const platforms = [], routes = [], ropes = [];
    const place = (w, u, kind) => { // Slab of width w centred on the ring at path position u, outer edge EDGE inside the drop.
      const ref = perimeterPoint(u, pathHalf);
      let px = clamp(ref.x, -(lim - w / 2), lim - w / 2), pz = clamp(ref.z, -(lim - w / 2), lim - w / 2);
      if (ref.side === 'N') pz = -(lim - w / 2); else if (ref.side === 'S') pz = lim - w / 2;
      else if (ref.side === 'E') px = lim - w / 2; else px = -(lim - w / 2);
      return { kind, x: centre.x + px, z: centre.z + pz, w, d: w, side: ref.side, axis: ref.axis, u };
    };
    const next = (prev, w, u, kind, gap) => { // Advance along the ring until the edge gap to `prev` is at least `gap`.
      let rec = place(w, u, kind);
      for (let guard = 0; prev && guard < 4000 && edgeGap(prev, rec) < gap; guard++) rec = place(w, u += .05, kind);
      return rec;
    };
    const RC = ropeCore(), gap = size <= 1.8 ? .9 : GAP, kindFor = () => theme === 'tothal' ? 'ice' : 'plain';
    for (let story = 0; story < R; story++) {
      const y0 = o.baseY + story * o.spacing, y1 = y0 + o.spacing, anchorY = y1 - ANCHOR_BELOW_BALCONY;
      const u0 = start + story * arc, u1 = u0 + arc;
      const segments = []; // The straight pieces of this story's arc: a rope's whole swing stays on one of them.
      for (let j = Math.floor(u0 / side); j * side < u1; j++) segments.push({ a: Math.max(u0, j * side), b: Math.min(u1, (j + 1) * side) });
      const segmentOf = rec => segments.find(g => rec.u - rec.w / 2 >= g.a - 1e-6 && rec.u + rec.w / 2 <= g.b + 1e-6) || null;
      const attempts = new Map(); // A rope from a given pad either works or not: try each pad once.
      // A rope hung over `pad`'s forward edge, with a landing the swing clears and the release flight reaches.
      const ropeFrom = (pad, below) => {
        const key = pad.u.toFixed(2) + ':' + pad.y.toFixed(2);
        if (attempts.has(key)) return attempts.get(key);
        let result = null;
        const L = anchorY - (pad.y + GRIP_ABOVE_LAUNCH), seg = segmentOf(pad);
        const aU = pad.u + pad.w / 2 - GRIP_INSET, back = L * Math.sin(RC.MAX_ANGLE) + BODY_RADIUS + .3; // Backswing reach behind the anchor.
        if (L >= MIN_ROPE && seg && aU - back >= seg.a && aU + .8 * L + Math.min(LANDING, side / 4) <= Math.min(seg.b, u1 - gap / 2)) {
          const ref = perimeterPoint(aU, pathHalf), ahead = perimeterPoint(aU + .01, pathHalf);
          const dir = { x: Math.sign(Math.round((ahead.x - ref.x) * 1000)), z: Math.sign(Math.round((ahead.z - ref.z) * 1000)) };
          const anchor = { x: pad.x + dir.x * (pad.w / 2 - GRIP_INSET), y: anchorY, z: pad.z + dir.z * (pad.w / 2 - GRIP_INSET) };
          const blocksWith = extra => (sAlong, y) => {
            const x = anchor.x + dir.x * sAlong, z = anchor.z + dir.z * sAlong;
            for (const p of extra ? [...below, extra] : below) {
              if (Math.abs(x - p.x) > p.w / 2 + BODY_RADIUS || Math.abs(z - p.z) > p.d / 2 + BODY_RADIUS) continue;
              if (y + BODY[0] < p.y && y + BODY[2] > p.y - THICKNESS) return true; // Feet below its top, head above its underside.
            }
            return false;
          };
          // Highest landing top first, then the nearest edge the swing (even at the swing limit) passes above.
          for (let top = anchorY - L * Math.cos(PROOF_AMP); top >= pad.y + 2 * RISE && !result; top -= .1) {
            const rise = anchorY - (top - BODY[0] + .02), reachS = L * Math.sin(RC.MAX_ANGLE);
            const sNear = rise >= L ? reachS : Math.min(reachS, Math.sqrt(L * L - rise * rise));
            for (let near = sNear + BODY_RADIUS + .05; near <= sNear + 1.6 && !result; near += .15) {
              const w = Math.max(Math.min(LANDING, side / 4), size), centreU = aU + near + w / 2; // Small cave chambers get a smaller landing.
              if (centreU + w / 2 > Math.min(seg.b, u1 - gap / 2)) break;
              const slab = place(w, centreU, kindFor());
              slab.y = top;
              if (!swingClear(L, anchorY, RC.MAX_ANGLE, blocksWith(slab))) continue;
              const along = (slab.x - anchor.x) * dir.x + (slab.z - anchor.z) * dir.z;
              const amp = ropeProof(L, anchorY, { s: along, top, half: w / 2 }, blocksWith(null));
              if (amp != null) result = { slab, amp, anchor, dir, L };
            }
          }
        }
        attempts.set(key, result);
        return result;
      };
      // Depth-first: from each slab, prefer a rope (fewest slabs, widest spacing), else one jump step; back up on a dead end.
      let budget = 4000, pillars = theme === 'hronal';
      const solve = (chain, ropesUsed, sinceRope) => {
        if (--budget < 0) return null;
        const last = chain[chain.length - 1];
        if (last && y1 - last.y <= RISE + 1e-9) return chain; // One hop onto the next gallery.
        if (!last) { // The gallery runs all the way round: the first slab may be a launch pad anywhere on the arc.
          const y = y0 + RISE, L = anchorY - (y + GRIP_ABOVE_LAUNCH), back = L * Math.sin(RC.MAX_ANGLE) + BODY_RADIUS + .3;
          for (const g of segments) {
            const u = g.a + back - (size / 2 - GRIP_INSET);
            if (u - size / 2 < u0 + gap / 2 - 1e-6) continue; // Already covered by the ordinary first step.
            const pad = place(size, u, kindFor());
            pad.y = y; pad.role = 'step';
            if (!segmentOf(pad) || !ropeFrom(pad, platforms)) continue;
            const done = solve([pad], ropesUsed, sinceRope);
            if (done) return done;
          }
        }
        if (last && ropesUsed < 2 && last.kind !== 'pillar') {
          const rope = ropeFrom(last, [...platforms, ...chain]);
          if (rope) {
            rope.slab.role = 'landing'; last.role = 'launch';
            const done = solve([...chain, Object.assign(rope.slab, { rope: { ...rope, from: last } })], ropesUsed + 1, 0);
            if (done) return done;
            last.role = 'step';
          }
        }
        let kind = kindFor(), w = size;
        if (pillars && sinceRope === 2 && y1 - (last ? last.y : y0) > 4 * RISE) { kind = 'pillar'; w = PILLAR_RADIUS; }
        const extra = kind === 'pillar' || last?.kind === 'pillar' ? .35 : 0; // A pillar's blast must not reach the slab before it.
        const rec = last ? next(last, w, last.u + (last.w + w) / 2 + gap + extra, kind, gap + extra) : place(w, u0 + gap / 2 + w / 2, kind);
        if (rec.u + w / 2 > u1 - gap / 2) return null;
        rec.y = (last ? last.y : y0) + RISE; rec.role = 'step';
        return solve([...chain, rec], ropesUsed, sinceRope + 1);
      };
      let chain = solve([], 0, 1);
      if (!chain && pillars) { pillars = false; budget = 4000; attempts.clear(); chain = solve([], 0, 1); } // Hronal: drop the exploding-pillar slabs if they cost too much ring.
      if (!chain || !chain.some(rec => rec.rope)) return { reason: `story ${story}: no rope layout fits a ${size.toFixed(1)} slab ring` };
      const ids = [], storyRopes = [];
      chain.forEach((rec, index) => {
        const id = `rf${story}-p${index}`;
        const fixtureSize = Math.min(1.05, rec.w - FIXTURE_MARGIN * 2, rec.d - FIXTURE_MARGIN * 2);
        platforms.push({ id, floor: story, index, kind: rec.kind, x: rec.x, z: rec.z, w: rec.w, d: rec.d, y: rec.y, side: rec.side, axis: rec.axis, role: rec.role,
          fixtureSlot: { x: rec.x, y: rec.y, z: rec.z, w: fixtureSize, d: fixtureSize, occupiedBy: rec.kind === 'pillar' ? 'explodingPillar' : null } });
        ids.push(id);
        if (rec.rope) {
          const r = rec.rope, id2 = `rope${story}-${storyRopes.length}`;
          storyRopes.push(id2);
          ropes.push({ id: id2, story, from: ids[index - 1], to: id, anchor: r.anchor, yaw: Math.atan2(r.dir.z, r.dir.x), length: +r.L.toFixed(3), amp: r.amp,
            gain: +(rec.y - r.from.y).toFixed(3), backswing: +(r.L * Math.sin(RC.MAX_ANGLE)).toFixed(3),
            bracket: { outX: r.dir.z !== 0 ? Math.sign(r.anchor.x - centre.x) : 0, outZ: r.dir.x !== 0 ? Math.sign(r.anchor.z - centre.z) : 0 } }); // Towards the balcony it hangs from.
        }
      });
      routes.push({ story, entryY: y0, exitY: y1, platformIds: ids, rise: RISE, ropes: storyRopes });
    }
    const plan = { method: TRAVERSAL, options: o, platforms, routes, ropes, centre, central: C, slabSize: size,
      physics: { gravity: 11.8, reach: reach(RISE), rise: RISE }, pit: { bottomY: o.baseY - DEATH_DEPTH, style: 'tradition', depth: DEATH_DEPTH } };
    plan.checks = verify(plan);
    plan.ok = plan.checks.every(c => c.ok);
    return plan.ok ? { plan } : { reason: plan.checks.filter(c => !c.ok).map(c => c.name + (c.detail ? ':' + c.detail : '')).join(', ') };
  }

  function verify(plan) {
    const checks = [], add = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || '' });
    const byId = new Map(plan.platforms.map(p => [p.id, p]));
    for (const route of plan.routes) {
      const list = route.platformIds.map(id => byId.get(id)), ropes = plan.ropes.filter(r => (route.ropes || []).includes(r.id));
      add(`story${route.story}-hasRope`, ropes.length > 0 && ropes.every(r => list.some(p => p.id === r.from) && list.some(p => p.id === r.to)));
      add(`story${route.story}-firstStep`, Math.abs(list[0].y - route.entryY - RISE) < 1e-6, 'first slab is one step above the gallery');
      add(`story${route.story}-lastStep`, route.exitY - list[list.length - 1].y <= RISE + 1e-6 && route.exitY > list[list.length - 1].y);
      let worst = 0, worstRise = 0;
      for (let i = 1; i < list.length; i++) {
        if (ropes.some(r => r.from === list[i - 1].id && r.to === list[i].id)) continue; // A rope link has its own proof.
        const rise = list[i].y - list[i - 1].y;
        worstRise = Math.max(worstRise, rise);
        worst = Math.max(worst, edgeGap(list[i - 1], list[i]) - reach(Math.max(0, rise)) * SAFE_GAP_FRACTION);
      }
      add(`story${route.story}-hopRises`, worstRise <= RISE + 1e-6, `worst rise ${worstRise.toFixed(3)}`);
      add(`story${route.story}-hopGaps`, worst <= 1e-6, `worst overshoot ${worst.toFixed(2)}`);
      for (const rope of ropes) {
        add(`${rope.id}-proof`, rope.amp != null && rope.amp <= PROOF_AMP + 1e-6, `swing ${rope.amp} rad`);
        add(`${rope.id}-length`, rope.length >= MIN_ROPE, `length ${rope.length}`);
        add(`${rope.id}-gain`, rope.gain >= RISE * 2 - 1e-6, `gain ${rope.gain}`);
      }
      add(`story${route.story}-inside`, list.every(p => Math.abs(p.x - plan.centre.x) + p.w / 2 <= plan.central / 2 + 1e-6 && Math.abs(p.z - plan.centre.z) + p.d / 2 <= plan.central / 2 + 1e-6));
    }
    // No two slabs overlap in plan view, so no support pillar (which runs from the pit floor to its own slab)
    // passes through another slab, and no slab hangs over another.
    let overlap = null;
    for (let i = 0; i < plan.platforms.length && !overlap; i++) for (let j = i + 1; j < plan.platforms.length; j++) {
      const a = plan.platforms[i], b = plan.platforms[j];
      if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 + .1 && Math.abs(a.z - b.z) < (a.d + b.d) / 2 + .1) { overlap = a.id + '/' + b.id; break; }
    }
    add('noOverlap', !overlap, overlap || '');
    // Every rope's full arc, up to the swing limit, is clear of every slab.
    const RC = ropeCore();
    for (const rope of plan.ropes) {
      const dir = { x: Math.cos(rope.yaw), z: Math.sin(rope.yaw) }, pad = byId.get(rope.from);
      const blocks = (s, y) => {
        const x = rope.anchor.x + dir.x * s, z = rope.anchor.z + dir.z * s;
        return plan.platforms.some(p => Math.abs(x - p.x) <= p.w / 2 + BODY_RADIUS && Math.abs(z - p.z) <= p.d / 2 + BODY_RADIUS
          && y + BODY[0] < p.y && y + BODY[2] > p.y - THICKNESS);
      };
      add(`${rope.id}-arcClear`, swingClear(rope.length, rope.anchor.y, RC.MAX_ANGLE, blocks), 'backswing and forward swing miss every slab');
      add(`${rope.id}-grip`, Math.abs(rope.anchor.y - rope.length - (pad.y + GRIP_ABOVE_LAUNCH)) < 1e-3
        && Math.abs(rope.anchor.x - pad.x) <= pad.w / 2 && Math.abs(rope.anchor.z - pad.z) <= pad.d / 2, 'resting grip over the launch pad');
    }
    add('fixtureSlots', plan.platforms.every(p => p.fixtureSlot && p.fixtureSlot.w >= .8 && p.fixtureSlot.w <= p.w - FIXTURE_MARGIN * 2 + 1e-6));
    add('uniqueIds', new Set(plan.platforms.map(p => p.id)).size === plan.platforms.length);
    return checks;
  }

  // Props on a plain/ice slab (the Tothal ignition braziers on each story's first step).
  function assignFixture(plan, platformId, fixtureKind) {
    const kind = String(fixtureKind || '').trim();
    if (!/^[a-z][a-z0-9-]{0,40}$/i.test(kind)) return null;
    const slot = plan?.platforms?.find?.(p => p.id === platformId)?.fixtureSlot;
    if (!slot || (slot.occupiedBy && slot.occupiedBy !== kind)) return null;
    slot.occupiedBy = kind;
    return slot;
  }

  // ---------------------------------------------------------------- runtime
  function mount(plan, deps = {}) {
    if (!plan?.ok || plan.method !== TRAVERSAL) throw new Error('Cannot mount an unverified rope shaft.');
    const runtime = Jump.mount(plan, deps); // Slabs, support pillars, death pit and tradition hazards are the staircase's own.
    const { THREE, parent } = deps;
    const group = new THREE.Group(); group.name = 'rope-shaft-brackets'; parent.add(group);
    const stone = root.ProceduralFurniture?.makePartMaterial?.({ materialTexture: 'carved_smooth.png', materialLighting: 'unlit', materialFillMode: 'never', color: '#726d63' })
      || new THREE.MeshBasicMaterial({ color: 0x726d63 });
    const brackets = new Map();
    const half = plan.central / 2;
    for (const rope of plan.ropes) {
      // A stone beam from the balcony face out to the rope's anchor, flush under the balcony.
      const out = { x: rope.bracket.outX, z: rope.bracket.outZ };
      const faceDist = out.x ? half - Math.abs(rope.anchor.x - plan.centre.x) : half - Math.abs(rope.anchor.z - plan.centre.z);
      const length = faceDist + .45, depth = .42, width = .44;
      const geometry = new THREE.BoxGeometry(out.x ? length : width, depth, out.z ? length : width);
      const beam = new THREE.Mesh(geometry, stone);
      beam.name = 'rope-shaft-bracket-' + rope.id;
      beam.position.set(rope.anchor.x + out.x * (length / 2 - .12), rope.anchor.y + depth / 2, rope.anchor.z + out.z * (length / 2 - .12));
      root.RuinShaftSupportPillars?.stretchStoneFaces?.(beam); // One inked carved-stone PNG per face; no generated outline.
      beam.layers?.disable?.(1);
      beam.userData.devRuinFootprintIgnore = true;
      group.add(beam);
      brackets.set(rope.id, beam);
    }
    const riders = new Map();
    let disposed = false, ropesAttached = false;
    const bus = () => root.DevRandomRuinSimplePuzzles;
    const attachRopes = () => { // The rider-rope runtime builds its state when the ruin is entered; retry until then.
      const b = bus();
      if (ropesAttached || !b?.addFurnitureRope || b.hasActiveRuinState?.() !== true) return;
      for (const rope of plan.ropes) {
        if (riders.has(rope.id)) continue;
        const rider = b.addFurnitureRope({ id: 'shaft-' + rope.id, anchor: rope.anchor, yaw: rope.yaw, length: rope.length, maxLength: rope.length, angle: 0 }, brackets.get(rope.id));
        if (!rider) return;
        rider.shaftRopeId = rope.id;
        riders.set(rope.id, rider);
      }
      ropesAttached = true;
    };
    const baseTick = runtime.tick, baseDispose = runtime.dispose, baseState = runtime.getState;
    runtime.method = TRAVERSAL;
    runtime.tick = dt => { if (disposed) return; baseTick(dt); attachRopes(); };
    runtime.dispose = () => {
      if (disposed) return; disposed = true;
      for (const rider of riders.values()) bus()?.removeFurnitureRope?.(rider);
      riders.clear();
      group.parent?.remove(group);
      group.traverse(node => node.geometry?.dispose?.());
      stone.dispose?.();
      baseDispose();
    };
    runtime.getState = () => ({ ...baseState(), method: TRAVERSAL, ropes: plan.ropes.length, ropesAttached,
      ropeLayout: plan.ropes.map(r => [r.id, r.length, r.gain, r.amp]), slabSize: plan.slabSize });
    runtime.ropes = riders;
    attachRopes();
    return runtime;
  }

  return Object.freeze({ TRAVERSAL, PROOF_AMP, RELEASE_WINDOW, GRIP_ABOVE_LAUNCH, compose, verify, assignFixture, mount, ropeProof, swingClear });
});

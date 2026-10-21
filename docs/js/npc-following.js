// Shared follow/wait destinations for friendly company and romance dates.
// Combat safety lives here, not in RomanceSystem, so every follower uses the same cover rules.
(() => {
  'use strict';

  let deps = null; // World adapters supplied by RomanceSystem.init and used by movement/retreat.
  const companions = new Map(); // Session-only friendly followers; dismissal returns normal schedules.
  const retreats = new Map(); // Per-NPC cover commitments, preventing per-frame A* and cover oscillation.
  const RETREAT_REPLAN_MS = 1100; // Unreachable destinations are retried at most once per interval.
  const RETREAT_RADIUS_TILES = 16; // Only threats near this follower cause them to flee.
  const RETREAT_OFFSETS = Object.freeze(Array.from({ length: 3 }, (_, ring) =>
    Array.from({ length: 12 }, (_, angle) => {
      const radius = 3 + ring * 2; // Candidate cover search spans 3, 5 and 7 tiles from the NPC.
      const radians = angle * Math.PI / 6; // Twelve compass directions per ring.
      return [Math.round(Math.cos(radians) * radius), Math.round(Math.sin(radians) * radius)];
    })).flat());
  let lastDecision = null; // Exposed in snapshot() for mobile troubleshooting.

  function clearRetreat(npcId) {
    if (npcId) retreats.delete(npcId);
    else retreats.clear();
  }

  function blockedSight(area, x, z, threat) {
    if (!deps?.isCoverOccluder) return false;
    const dx = threat.x - x, dz = threat.z - z; // Ray toward an active enemy, sampled at sub-tile intervals.
    const steps = Math.ceil(Math.hypot(dx, dz) * 2.5); // Intermediate structural cells, not occupied end tiles.
    for (let step = 2; step < steps - 1; step++) {
      const c = Math.floor(x + dx * step / steps), r = Math.floor(z + dz * step / steps);
      if (deps.isCoverOccluder(area, c, r)) return true;
    }
    return false;
  }

  function retreatTarget(rec, walker, player, area) {
    if (!deps?.isCombatActive?.() || !walker || walker.area !== area) {
      clearRetreat(rec.id);
      return null;
    }
    const pathfinding = window.NpcPathfinding; // Shared swept NPC walkability and path authority.
    if (!pathfinding) return null;
    const wx = walker.root.position.x, wz = walker.root.position.z; // Current NPC feet location.
    const threats = (deps.getCombatThreats?.(area) || []).filter(t =>
      Number.isFinite(t.x) && Number.isFinite(t.z) && Math.hypot(t.x - wx, t.z - wz) <= RETREAT_RADIUS_TILES);
    if (!threats.length) { clearRetreat(rec.id); return null; }

    const now = typeof performance === 'object' ? performance.now() : Date.now(); // Retreat retry clock; no simulation time distortion.
    const previous = retreats.get(rec.id); // Existing destination is preferred while still safe and reachable.
    if (previous?.area === area) {
      const nearestThreat = Math.min(...threats.map(t => Math.hypot(previous.x - t.x, previous.z - t.z)));
      const stillHidden = previous.hidden > 0 && threats.some(t => blockedSight(area, previous.x, previous.z, t));
      const isWalkable = pathfinding.isNpcTileWalkable(area, previous.c, previous.r);
      if (isWalkable && nearestThreat > 3.2 && (!previous.noCover && (now < previous.recheckAt || stillHidden))) {
        if (now >= previous.recheckAt) previous.recheckAt = now + RETREAT_REPLAN_MS;
        return { area, c: previous.c, r: previous.r, activity: 'taking cover', run: true };
      }
      if (previous.noCover && now < previous.recheckAt) {
        return { area, c: previous.c, r: previous.r, activity: 'taking cover', run: false };
      }
    }

    const seen = new Set(); // Rounding compass directions can produce duplicate candidate tiles.
    const scored = []; // Walkable destinations ranked by cover, enemy distance and short route.
    for (const [dc, dr] of RETREAT_OFFSETS) {
      const c = Math.floor(wx) + dc, r = Math.floor(wz) + dr;
      const key = c + ',' + r;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!pathfinding.isNpcTileWalkable(area, c, r)) continue;
      const x = c + 0.5, z = r + 0.5;
      const enemyDistance = Math.min(...threats.map(t => Math.hypot(x - t.x, z - t.z)));
      if (enemyDistance < 3.2) continue;
      const hidden = threats.filter(t => blockedSight(area, x, z, t)).length;
      const playerDistance = Math.hypot(x - player.x, z - player.z);
      const travel = Math.hypot(x - wx, z - wz);
      const score = hidden * 30 + Math.min(11, enemyDistance) * 2 - travel * 1.1 - Math.max(0, playerDistance - 11) * 2;
      scored.push({ c, r, x, z, hidden, enemyDistance, score });
    }
    scored.sort((a, b) => b.score - a.score);
    let selected = null; // First best destination that NPC navigation can actually reach.
    for (const candidate of scored.slice(0, 8)) {
      if (pathfinding.canNpcBeeline(area, wx, wz, candidate.c, candidate.r)
        || pathfinding.findNpcPath(area, wx, wz, candidate.c, candidate.r, { padding: 6, maxNodes: 450 })?.length) {
        selected = candidate;
        break;
      }
    }
    if (!selected && previous?.area === area && !previous.noCover && pathfinding.isNpcTileWalkable(area, previous.c, previous.r)) {
      selected = previous; // Prefer the last valid hiding spot to aimless running.
    }
    const goal = selected
      ? { ...selected, npcId: rec.id, area, recheckAt: now + RETREAT_REPLAN_MS }
      : { c: Math.floor(wx), r: Math.floor(wz), x: wx, z: wz, npcId: rec.id, area, hidden: 0, noCover: true, recheckAt: now + RETREAT_REPLAN_MS };
    retreats.set(rec.id, goal);
    lastDecision = { npcId: rec.id, area, threats: threats.length, selected: selected ? { c: goal.c, r: goal.r, hiddenFrom: goal.hidden } : null, at: Date.now() };
    if (!previous || previous.c !== goal.c || previous.r !== goal.r || !!previous.noCover !== !!goal.noCover) {
      window.__farmLog?.('[npc cover] ' + rec.id + ': ' + (selected
        ? 'retreat to ' + goal.c + ',' + goal.r + ' (hidden from ' + goal.hidden + '/' + threats.length + ')'
        : 'no reachable cover; holding position'), 'npc');
    }
    return { area, c: goal.c, r: goal.r, activity: 'taking cover', run: !goal.noCover };
  }

  function target(rec, session, distance = 1.7) {
    if (!deps || !session || !rec?.id) return null;
    if (session.mode === 'wait' && session.waitSpot) {
      clearRetreat(rec.id);
      return { ...session.waitSpot, activity: 'waiting for you' };
    }
    const walker = deps.findWalker?.(rec.id); // Active physical NPC, if its portrait has spawned.
    const player = deps.getPlayerTilePosition?.(); // Player feet in 1x1 tile coordinates.
    const area = deps.normalizeNpcArea?.(deps.getCurrentArea?.()) || deps.getCurrentArea?.();
    if (!player || !area || !deps.canHostNpc?.(area)) {
      clearRetreat(rec.id);
      return walker ? { area: walker.area, c: walker.root.position.x - .5, r: walker.root.position.z - .5, activity: 'waiting for you' } : null;
    }
    const pc = Math.floor(player.x), pr = Math.floor(player.z);
    // Ordinary friendly followers must cross maps as dates already do. Validating
    // against the zone's grid prevents them spawning inside the entry escarpment.
    if (walker && walker.area !== area && typeof walker.transferToArea === 'function') {
      const spot = window.NpcPathfinding?.nearestWalkableTile?.(area, pc, pr, 6) || { c: pc, r: pr };
      walker.transferToArea(area, spot);
      clearRetreat(rec.id);
    }
    const safety = session.mode === 'follow' ? retreatTarget(rec, walker, player, area) : null;
    if (safety) return safety;

    const seat = window.FurnitureTableSystem?.companionSeat?.(area, rec.id);
    if (seat) return { ...seat, activity: 'sitting together', run: false };
    if (!walker || walker.area !== area) return { area, c: pc, r: pr, activity: 'following you', run: true };
    const pos = walker.root.position, dx = pos.x - player.x, dz = pos.z - player.z;
    const dist = Math.hypot(dx, dz);
    if (!window.RomanceSystem?.isOnDateWith?.(rec.id)) {
      walker.catchup = dist > 4 ? Math.min(3, 1.6 + (dist - 4) * 0.23) : 1.6; // Ordinary company catches up at the player's running pace.
    }
    if (dist <= distance + .45 && window.NpcPathfinding?.isNpcTileWalkable?.(area, Math.floor(pos.x), Math.floor(pos.z)) !== false) {
      return { area, c: pos.x - .5, r: pos.z - .5, activity: 'following you', run: false };
    }
    const tx = player.x + (dist > 1e-6 ? dx / dist : 1) * distance;
    const tz = player.z + (dist > 1e-6 ? dz / dist : 0) * distance;
    for (let radius = 0; radius <= 3; radius++) {
      for (let z = -radius; z <= radius; z++) {
        for (let x = -radius; x <= radius; x++) {
          if (Math.max(Math.abs(x), Math.abs(z)) !== radius) continue;
          const c = Math.floor(tx) + x, r = Math.floor(tz) + z;
          if (window.NpcPathfinding?.isNpcTileWalkable?.(area, c, r) !== false) {
            return { area, c, r, activity: 'following you', run: true };
          }
        }
      }
    }
    return { area: walker.area, c: pos.x - .5, r: pos.z - .5, activity: 'waiting for you', run: false };
  }

  function setMode(walker, mode) {
    const id = walker?.rec?.id;
    if (window.RomanceSystem?.isOnDateWith?.(id)) {
      clearRetreat(id);
      return mode === 'dismiss' ? window.RomanceSystem.dismissDate() : window.RomanceSystem.setDateMode(mode);
    }
    if (!id || walker.rec.dead || walker.rec.deceased || !['follow', 'wait', 'dismiss'].includes(mode)) return false;
    const accepted = mode !== 'follow' || (window.NpcRapport?.get?.(id) ?? 0) >= 0;
    const text = !accepted ? 'No, I would rather stay here.'
      : mode === 'follow' ? 'Of course. Lead the way!'
      : mode === 'wait' ? "I'll wait here for you." : 'All right. See you later.';
    const response = window.AmbientDialogue?.showSocialResponse || window.AmbientDialogue?.showAlcoholOfferResponse;
    response?.(walker, { text, accepted, reason: 'company' });
    if (!accepted) return false;
    clearRetreat(id);
    if (mode === 'dismiss') {
      companions.delete(id);
      walker.catchup = 1;
      window.FurnitureTableSystem?.setSeatTarget?.(id, null);
      return true;
    }
    const p = walker.root.position;
    companions.set(id, { mode, waitSpot: mode === 'wait' ? { area: walker.area, c: p.x - .5, r: p.z - .5 } : null });
    if (mode === 'wait') walker.catchup = 1;
    window.FurnitureTableSystem?.setSeatTarget?.(id, null);
    return true;
  }

  function commandOptionsFor(walker) {
    if (!walker?.rec?.id || walker.rec.dead || walker.rec.deceased || walker._doorstepVisitor
      || walker._slagothimTrader || walker.isPorakanekiHunter || window.RomanceSystem?.isOnDateWith?.(walker.rec.id)) return [];
    const session = companions.get(walker.rec.id);
    if (!session) return [{ id: 'follow', icon: '👣', label: 'Follow me', run: () => setMode(walker, 'follow') }];
    return [
      { id: session.mode === 'wait' ? 'follow' : 'wait', icon: '👣', label: session.mode === 'wait' ? 'Follow me' : 'Wait here', run: () => setMode(walker, session.mode === 'wait' ? 'follow' : 'wait') },
      { id: 'dismiss', icon: '👋', label: 'Go on without me', run: () => setMode(walker, 'dismiss') },
    ];
  }

  function clear() {
    for (const id of companions.keys()) window.FurnitureTableSystem?.setSeatTarget?.(id, null);
    companions.clear();
    clearRetreat();
  }

  function init(value) {
    deps = value;
    window.NpcScheduling?.registerTargetOverride?.('companions', rec => {
      const session = companions.get(rec.id);
      if (!session || rec.dead || rec.deceased || window.RomanceSystem?.isOnDateWith?.(rec.id)) return null;
      return target(rec, session);
    });
  }

  window.NpcFollowing = {
    init, clear, clearRetreat, target, setMode, commandOptionsFor,
    snapshot: () => ({
      latestChange: 'Shared combat cover, map transitions, running and exclusive seating for dates and friendly followers.',
      companions: [...companions].map(([id, session]) => ({ id, mode: session.mode })),
      retreats: [...retreats].map(([id, goal]) => ({ id, area: goal.area, c: goal.c, r: goal.r, hiddenFrom: goal.hidden, noCover: !!goal.noCover })),
      lastDecision,
    }),
  };
})();

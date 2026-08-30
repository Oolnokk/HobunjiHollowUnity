(() => {
  'use strict';

  // Death ragdoll → lootable corpse. A lethally-hit creature no longer
  // just vanishes: it tumbles from where it died to a nearby tile
  // roughly away from the killing blow, settles lying flat on that
  // tile, and stays there as a lootable corpse (see game.js's
  // getCorpseObjectAt) until the player butchers it — that's the only
  // thing that actually despawns the sprite.
  //
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern already used by js/farm-buildings.js and
  // js/farm-animals.js. currentArea/grid are reassigned wholesale on
  // zone transitions, so they're threaded through as getters rather than
  // captured references.
  const DEATH_LERP_DURATION_S = 2.2;
  const DEATH_TUMBLE_TILES_MIN = 1.1;
  const DEATH_TUMBLE_TILES_MAX = 2.6;
  const DEATH_AIM_CONE_RAD = 50 * Math.PI / 180;
  const DEATH_FLIP_SEGMENTS = 5;
  const DEATH_FLIP_AXES = ['x', 'y', 'z'];

  // DEATH_HOP_HEIGHT_PX depends on deps.TILE, so it's computed once in
  // init() below rather than at module-load time.
  let deps = null, deathHopHeightPx;
  const deathDebug = { lastBegin: null, lastRecovery: null }; // Used by mobile diagnostics to expose interrupted lethal transitions without a console.
  function init(injectedDeps) {
    deps = injectedDeps;
    deathHopHeightPx = deps.TILE * 1.1 / 3;
  }

  // Ease-in-out (slow at each end, fast through the middle) applied
  // within a single flip segment — gives every flip a "slo-mo" hang at
  // its start/end instead of spinning at a constant rate.
  function _segEase(x) { return x * x * (3 - 2 * x); }

  // Walks outward from the creature's own tile within a cone around
  // awayAngle (the direction the killing blow traveled), looking for a
  // tile the corpse can actually rest on — falls back to its own tile
  // if nothing nearby is valid (map edge, water, cliff face, ...).
  function _findRestTile(c, awayAngle) {
    const TILE = deps.TILE;
    const startCol = Math.floor(c.x / TILE), startRow = Math.floor(c.y / TILE);
    for (let attempt = 0; attempt < 12; attempt++) {
      const ang = awayAngle + (Math.random() * 2 - 1) * DEATH_AIM_CONE_RAD;
      const distTiles = DEATH_TUMBLE_TILES_MIN + Math.random() * (DEATH_TUMBLE_TILES_MAX - DEATH_TUMBLE_TILES_MIN);
      const col = deps.clamp(Math.round(startCol + Math.cos(ang) * distTiles), 0, (c.areaCols || deps.COLS) - 1);
      const row = deps.clamp(Math.round(startRow + Math.sin(ang) * distTiles), 0, (c.areaRows || deps.ROWS) - 1);
      const cx = (col + 0.5) * TILE, cy = (row + 0.5) * TILE;
      if (deps.canOccupyAt(cx, cy, TILE * 0.3)) return { x: cx, y: cy, col, row };
    }
    return { x: (startCol + 0.5) * TILE, y: (startRow + 0.5) * TILE, col: startCol, row: startRow };
  }

  function beginInternal(c, fromX, fromY) {
    // A corpse doesn't get further updateCreatureMesh() calls to keep
    // its resource ring synced/rebuilt, so drop it now rather than
    // leaving a stale 0-health ring hovering over the corpse forever.
    window.ResourceRings?.disposeRingHud(c);
    // A bandit's weapon lives in its own world-space toolHolder (see
    // updateBanditToolMesh), not parented under the avatar the tumble
    // below animates -- hide it now rather than leaving it floating in
    // place, disconnected from the corpse, once the fall starts.
    if (c._banditToolHolder) c._banditToolHolder.visible = false;
    if (c._banditRangedToolHolder) c._banditRangedToolHolder.visible = false;
    if (c._banditTrailMesh) c._banditTrailMesh.visible = false;
    const awayAngle = fromX !== undefined ? Math.atan2(c.y - fromY, c.x - fromX) : (c.facing || 0);
    const rest = _findRestTile(c, awayAngle);
    c.state = 'dying';
    c.deathT = 0;
    c.deathDurationS = DEATH_LERP_DURATION_S;
    c.deathStartX = c.x; c.deathStartY = c.y;
    c.deathTargetX = rest.x; c.deathTargetY = rest.y;
    c.corpseCol = rest.col; c.corpseRow = rest.row;
    c.deathHopHeightPx = deathHopHeightPx * (0.7 + Math.random() * 0.6);
    // The avatar's flat cutout plane has its face-normal along the
    // group's own local X axis at rest (see buildAnimalPlaneAvatarModel:
    // frontPlane.rotation.y = +PI/2, backPlane.rotation.y = -PI/2 — a
    // standing side-view cutout, not a volumetric cross). Rotating the
    // GROUP about its local Z axis by exactly +PI/2 is what tips that
    // face-normal from horizontal up to vertical (+Y) — i.e. actually
    // lying flat, face-up, not just spinning in place. Y (yaw/compass
    // heading) and X (a small final roll) can be anything — neither
    // affects flatness.
    c.deathRestRotZ = Math.PI / 2;
    c.deathRestRotX = (Math.random() * 2 - 1) * 0.22;
    c.deathRestRotY = Math.random() * Math.PI * 2;
    // A dramatic mid-air ragdoll: DEATH_FLIP_SEGMENTS separate flips,
    // each one full turn (so it can never leave a residual tilt behind)
    // about a randomly picked axis in a randomly picked direction — a
    // forward somersault, then maybe a cartwheel, then a twist, etc.
    // Because every segment is exactly ±1 full turn, the axis that
    // governs flatness (z) always ends up an integer number of full
    // turns past its target regardless of how the 5 picks landed, so it
    // still always settles into the same clean flat pose.
    c.deathFlipSegAxis = Array.from({ length: DEATH_FLIP_SEGMENTS }, () => DEATH_FLIP_AXES[Math.floor(Math.random() * DEATH_FLIP_AXES.length)]);
    c.deathFlipSegDir  = Array.from({ length: DEATH_FLIP_SEGMENTS }, () => (Math.random() < 0.5 ? -1 : 1));
    c.deathFlipPrefix = { x: [0], y: [0], z: [0] };
    for (let i = 0; i < DEATH_FLIP_SEGMENTS; i++) {
      for (const axis of DEATH_FLIP_AXES) {
        const add = c.deathFlipSegAxis[i] === axis ? c.deathFlipSegDir[i] : 0;
        c.deathFlipPrefix[axis].push(c.deathFlipPrefix[axis][i] + add);
      }
    }
    c.scaleY = 1;
    c.avatarRef.group.scale.y = 1;
    // Snap the cutout's two planes back to the exact pose they were
    // built with, undoing any camera-relative deadzone drift
    // (updateCreatureMesh's pngRot/perpState smoothing) frozen in at the
    // moment of death — otherwise the corpse lands a few degrees off
    // "flat" instead of showing its clean flat face.
    if (c.avatarRef.frontPlane) c.avatarRef.frontPlane.rotation.y = Math.PI / 2;
    if (c.avatarRef.backPlane)  c.avatarRef.backPlane.rotation.y  = -Math.PI / 2;
    // legsPivot carries no extra ±PI/2 twist (see updateCreatureMesh), so
    // its own matching "rest" value is plain 0, not PI/2 -- planeDelta 0
    // means pngRot === groupRot, the same nominal-facing convention the
    // planes' own PI/2 rest implicitly encodes once combined with their
    // baked mesh orientation.
    if (c.avatarRef.legsPivot) c.avatarRef.legsPivot.rotation.y = 0;
    deps.corpseObjects.add(c);
  }

  // A lethal hit must never strand an entity after game.js removes it from
  // hostileObjects. If a secondary visual/path calculation throws during
  // beginInternal(), settle it on its current tile as a lootable corpse and
  // record the original error for the in-game diagnostics.
  function recover(c, fromX, fromY, error) {
    if (!c || !deps) return false;
    const TILE = deps.TILE;
    const col = deps.clamp(Math.floor((Number(c.x) || 0) / TILE), 0, (c.areaCols || deps.COLS) - 1); // Used as the guaranteed fallback corpse column.
    const row = deps.clamp(Math.floor((Number(c.y) || 0) / TILE), 0, (c.areaRows || deps.ROWS) - 1); // Used as the guaranteed fallback corpse row.
    try { window.ResourceRings?.disposeRingHud(c); } catch (_) {}
    if (c._banditToolHolder) c._banditToolHolder.visible = false;
    if (c._banditRangedToolHolder) c._banditRangedToolHolder.visible = false;
    if (c._banditTrailMesh) c._banditTrailMesh.visible = false;
    c.health = 0;
    c.state = 'corpse';
    c.corpseCol = col; c.corpseRow = row;
    c.x = (col + 0.5) * TILE; c.y = (row + 0.5) * TILE;
    c.vx = 0; c.vy = 0;
    c.knockbackT = 0;
    c.hitFlashT = 0;
    c.telegraphState = null;
    deps.corpseObjects.add(c);
    const grp = c.avatarRef?.group; // Used to force the fallback corpse into a visible lying pose.
    let visualError = null; // Used to retain a secondary fallback-pose failure without preventing corpse registration.
    try {
      if (grp) {
        const g = c.areaGrid || deps.getGrid();
        const surfY = g[row]?.[col] ? deps.tileSurfaceYInArea(g[row][col], c.areaId) : 0;
        const restHeight = (Number(c.halfHeight) || 0) * 0.12;
        grp.position.set(c.x / TILE, surfY + restHeight, c.y / TILE);
        grp.rotation.set(0, Number(c.groupRot) || 0, Math.PI / 2);
        if (c.avatarRef.frontPlane) c.avatarRef.frontPlane.rotation.y = Math.PI / 2;
        if (c.avatarRef.backPlane) c.avatarRef.backPlane.rotation.y = -Math.PI / 2;
        if (c.avatarRef.legsPivot) c.avatarRef.legsPivot.rotation.y = 0;
        if (c.avatarRef.legs) c.avatarRef.legs.update(0, 0, true);
      }
    } catch (caught) { visualError = caught; }
    const reason = [error, visualError].filter(Boolean).map(value => value?.stack || value?.message || String(value)).join(' | ') || 'unknown death-transition interruption'; // Used in the copyable mobile debug record.
    deathDebug.lastRecovery = { at: Date.now(), creature: c.id || c.def?.label || 'creature', areaId: c.areaId || '', col, row, reason };
    window.__farmLog?.(`[creature-death] recovered ${deathDebug.lastRecovery.creature} as a corpse after: ${reason}`, 'combat');
    return true;
  }

  function begin(c, fromX, fromY) {
    deathDebug.lastBegin = { at: Date.now(), creature: c?.id || c?.def?.label || 'creature', areaId: c?.areaId || '' };
    try {
      beginInternal(c, fromX, fromY);
      return true;
    } catch (error) {
      return recover(c, fromX, fromY, error);
    }
  }

  // Turns accumulated for one axis by time-progress t: whole turns from
  // every completed segment assigned to that axis, plus the current
  // segment's own partial turn (eased) if it happens to be the one
  // actively spinning that axis right now.
  function _spinTurnsForAxis(c, seg, segEase, axis) {
    let turns = c.deathFlipPrefix[axis][seg];
    if (c.deathFlipSegAxis[seg] === axis) turns += c.deathFlipSegDir[seg] * segEase;
    return turns;
  }

  // Drives every 'dying' corpse's flight from where it died to its
  // resting tile: position eases (fast launch, soft landing) along a
  // shallow hop arc, while rotation.x/y/z ease toward their final pose
  // (Z fixed at lying-flat, X/Y free) with DEATH_FLIP_SEGMENTS full
  // mid-air flips — each on its own randomly-picked axis — layered on
  // top so the tumble shifts axes as it goes but still always lands
  // exactly on the flat pose.
  function updateCorpses(dt) {
    const TILE = deps.TILE;
    const currentArea = deps.getCurrentArea();
    for (const c of deps.corpseObjects) {
      if (c.state !== 'dying' || c.areaId !== currentArea) continue;
      c.deathT = Math.min(c.deathDurationS, c.deathT + dt);
      const t = c.deathT / c.deathDurationS;
      const ease = 1 - Math.pow(1 - t, 3);
      c.x = c.deathStartX + (c.deathTargetX - c.deathStartX) * ease;
      c.y = c.deathStartY + (c.deathTargetY - c.deathStartY) * ease;
      const hop = Math.sin(Math.PI * t) * c.deathHopHeightPx;

      const grp = c.avatarRef.group;
      const g = c.areaGrid || deps.getGrid();
      const col = deps.clamp(Math.floor(c.x / TILE), 0, (c.areaCols || deps.COLS) - 1);
      const row = deps.clamp(Math.floor(c.y / TILE), 0, (c.areaRows || deps.ROWS) - 1);
      const surfY = g[row]?.[col] ? deps.tileSurfaceYInArea(g[row][col], c.areaId) : 0;
      const restHeight = c.halfHeight * 0.12;

      grp.position.x = c.x / TILE;
      grp.position.z = c.y / TILE;
      grp.position.y = surfY + restHeight + (c.halfHeight - restHeight) * (1 - ease) + hop;
      // Stays flat on the ground under the tumble instead of following
      // the body's hop arc — same as a real jump shadow.
      if (c.groundShadow) c.groundShadow.position.set(grp.position.x, surfY + deps.characterGroundShadowSurfaceOffset(), grp.position.z);

      let seg = Math.floor(t * DEATH_FLIP_SEGMENTS);
      let segT = t * DEATH_FLIP_SEGMENTS - seg;
      if (seg >= DEATH_FLIP_SEGMENTS) { seg = DEATH_FLIP_SEGMENTS - 1; segT = 1; }
      const segEase = _segEase(segT);
      const turnsX = _spinTurnsForAxis(c, seg, segEase, 'x');
      const turnsY = _spinTurnsForAxis(c, seg, segEase, 'y');
      const turnsZ = _spinTurnsForAxis(c, seg, segEase, 'z');

      // Z is the axis that actually tips the cutout's flat face from
      // vertical to lying-flat-face-up (see begin()) — X/Y are free
      // cosmetic spin that never affects whether it lands flat.
      grp.rotation.z = c.deathRestRotZ * ease + turnsZ * Math.PI * 2;
      grp.rotation.x = c.deathRestRotX * ease + turnsX * Math.PI * 2;
      grp.rotation.y = c.groupRot + (c.deathRestRotY - c.groupRot) * ease + turnsY * Math.PI * 2;
      // updateCreatureMesh stops running the instant death begins (see
      // its own comment above), so a bandit's legs would otherwise freeze
      // mid-stride through the whole ragdoll tumble -- ease them to a
      // neutral planted pose instead, same suppressed path mounting uses.
      if (c.avatarRef.legs) c.avatarRef.legs.update(dt, 0, true);

      if (t >= 1) {
        c.state = 'corpse';
        grp.position.set(c.deathTargetX / TILE, surfY + restHeight, c.deathTargetY / TILE);
        grp.rotation.set(c.deathRestRotX, c.deathRestRotY, c.deathRestRotZ);
      }
    }
  }

  window.CreatureDeath = {
    init,
    begin,
    recover,
    updateCorpses,
    getDebug: () => ({ lastBegin: deathDebug.lastBegin && { ...deathDebug.lastBegin }, lastRecovery: deathDebug.lastRecovery && { ...deathDebug.lastRecovery } }),
    formatDebug: () => deathDebug.lastRecovery
      ? `Creature death recovery: ${deathDebug.lastRecovery.creature} at ${deathDebug.lastRecovery.areaId}:${deathDebug.lastRecovery.col},${deathDebug.lastRecovery.row} | ${deathDebug.lastRecovery.reason}`
      : `Creature death: last begin ${deathDebug.lastBegin?.creature || 'none'}; no recovery needed`,
  };
})();

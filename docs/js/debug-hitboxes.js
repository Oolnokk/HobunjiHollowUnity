(() => {
  'use strict';

  // Settings → Dev Tools overlay for authored actor hitboxes, the real melee
  // collider volumes, and the separately toggled centered interaction ray.
  let deps = null;
  let lastInteractionFocusDebug = null; // Most recent accepted branch/nest focus, used by the interaction-ray toggle.
  function init(injectedDeps) { deps = injectedDeps; }

  const DEBUG_HITBOX_COLOR_PLAYER = '#5cf2ff';
  const DEBUG_HITBOX_COLOR_HOSTILE = '#ff6a6a';
  const DEBUG_HITBOX_COLOR_COMPANION = '#7fe89a';
  const DEBUG_MELEE_COLOR_PLAYER = '#ffffff';
  const DEBUG_MELEE_COLOR_HOSTILE = '#ff9b54';
  const DEBUG_INTERACTION_RAY_COLOR = '#35ffdc';
  const DEBUG_INTERACTION_HIT_COLOR = '#fff566';
  const DEBUG_INTERACTION_HOSTILE_COLOR = '#ff5c5c';

  function playerModelWidthTiles() {
    return window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.worldModelWidth ?? 0.9;
  }

  function _debugGroundY(wx, wy) {
    if (deps.surfaceYAtWorld) return deps.surfaceYAtWorld(wx / deps.TILE, wy / deps.TILE) + 0.05;
    const tile = deps.getActiveTileAt(Math.floor(wx / deps.TILE), Math.floor(wy / deps.TILE));
    return (tile ? deps.tileSurfaceY(tile.type) : 0) + 0.05;
  }

  function _actorHitbox(actor) {
    return window.RangedWeapons?.actorHitbox?.(actor) || null;
  }

  function _plainPoint(point) {
    return point ? { x: Number(point.x) || 0, y: Number(point.y) || 0, z: Number(point.z) || 0 } : null;
  }

  // Called only after the shared camera ray wins nearest-target arbitration.
  function noteInteractionFocus(focus) {
    if (!focus?.point || !focus?.candidate) return;
    lastInteractionFocusDebug = {
      type: focus.candidate.type || 'interaction',
      id: focus.candidate.id || null,
      point: _plainPoint(focus.point),
      distanceWorld: Number(focus.distanceWorld) || 0,
      recordedAt: Date.now(),
    };
  }

  function _drawDebugSegment3D(a, b, color, dashed = false, lineWidth = 1.5, alpha = 0.9) {
    const p1 = deps.worldToOverlay(a.x, a.y, a.z);
    const p2 = deps.worldToOverlay(b.x, b.y, b.z);
    if (!p1.visible && !p2.visible) return;
    const octx = deps.octx;
    octx.save();
    octx.globalAlpha = alpha;
    octx.strokeStyle = color;
    octx.lineWidth = lineWidth;
    if (dashed) octx.setLineDash([4, 3]);
    octx.beginPath();
    octx.moveTo(p1.x, p1.y);
    octx.lineTo(p2.x, p2.y);
    octx.stroke();
    octx.restore();
  }

  // Projects all twelve Box3 edges through the live camera. This is the
  // actual portrait-derived combat volume, not a flat proxy at tile height.
  function _drawDebugBox3(hitbox, color) {
    const box = hitbox?.box;
    if (!box) return;
    const points = [];
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) points.push({ x, y, z });
      }
    }
    const edges = [[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];
    for (const [a, b] of edges) _drawDebugSegment3D(points[a], points[b], color);
  }

  function _drawDebugSquare(wx, wy, halfSizePx, color, dashed, worldY = null) {
    const y = worldY ?? _debugGroundY(wx, wy);
    const halfTiles = halfSizePx / deps.TILE;
    const baseX = wx / deps.TILE, baseZ = wy / deps.TILE;
    const corners = [
      { x: baseX - halfTiles, y, z: baseZ - halfTiles },
      { x: baseX + halfTiles, y, z: baseZ - halfTiles },
      { x: baseX + halfTiles, y, z: baseZ + halfTiles },
      { x: baseX - halfTiles, y, z: baseZ + halfTiles },
    ];
    for (let i = 0; i < corners.length; i++) {
      _drawDebugSegment3D(corners[i], corners[(i + 1) % corners.length], color, dashed);
    }
  }

  function _drawCreatureDebug(c, hitboxColor) {
    const hitbox = _actorHitbox(c);
    const footY = hitbox?.box?.min?.y ?? _debugGroundY(c.x, c.y);
    const halfSize = deps.creatureHitboxHalfSizePx(c.def);
    _drawDebugSquare(c.x, c.y, halfSize, hitboxColor, true, footY + 0.01);
    _drawDebugBox3(hitbox, hitboxColor);
  }

  function _drawMeleeColliders() {
    for (const collider of window.Combat?.debugMeleeColliders?.() || []) {
      const actor = collider.actor;
      if (actor !== deps.player && actor?.areaId && actor.areaId !== deps.getCurrentArea()) continue;
      const color = actor === deps.player ? DEBUG_MELEE_COLOR_PLAYER : DEBUG_MELEE_COLOR_HOSTILE;
      for (const [a, b] of window.Combat.meleeColliderWireframe(collider, 18)) {
        _drawDebugSegment3D(a, b, color, false, 2, 0.95);
      }
    }
  }

  function _interactionRaySnapshot() {
    deps.refreshInteractionFocusDebug?.();
    const raw = deps.getPlayerInteractionRay?.() || deps.getPlayerAimRay?.();
    if (!raw?.origin || !raw?.direction) return null;
    const origin = new THREE.Vector3(Number(raw.origin.x) || 0, Number(raw.origin.y) || 0, Number(raw.origin.z) || 0);
    const direction = new THREE.Vector3(Number(raw.direction.x) || 0, Number(raw.direction.y) || 0, Number(raw.direction.z) || 0);
    if (direction.lengthSq() < 1e-8) return null;
    direction.normalize();

    const candidates = [];
    if (lastInteractionFocusDebug && Date.now() - lastInteractionFocusDebug.recordedAt <= 750) {
      candidates.push({ ...lastInteractionFocusDebug, hostile: false });
    }
    // Hostiles participate in the same shared-input arbitration: showing a
    // nearer red hit explains why Action 1 attacks instead of interacting.
    const hostile = window.RangedWeapons?.focusedHostile?.(24);
    if (hostile?.point) {
      candidates.push({
        type: 'hostile',
        id: hostile.candidate?.id || null,
        point: _plainPoint(hostile.point),
        distanceWorld: Number(hostile.distanceWorld) || 0,
        hostile: true,
      });
    }
    candidates.sort((a, b) => a.distanceWorld - b.distanceWorld);
    const focus = candidates[0] || null;
    const maxDistanceWorld = 12; // Matches ordinary branch interaction focus distance.
    const endpoint = focus?.point
      ? new THREE.Vector3(focus.point.x, focus.point.y, focus.point.z)
      : origin.clone().addScaledVector(direction, maxDistanceWorld);
    return {
      origin: _plainPoint(origin),
      direction: _plainPoint(direction),
      endpoint: _plainPoint(endpoint),
      hit: !!focus,
      targetType: focus?.type || null,
      targetId: focus?.id || null,
      distanceWorld: focus?.distanceWorld ?? maxDistanceWorld,
      hostile: !!focus?.hostile,
    };
  }

  function _drawInteractionRaycast() {
    if (!deps.getShowInteractionRaycast?.()) return;
    const state = _interactionRaySnapshot();
    if (!state) return;
    const playerCenter = _actorHitbox(deps.player)?.center || new THREE.Vector3(
      deps.player.x / deps.TILE,
      _debugGroundY(deps.player.x, deps.player.y) + 0.45,
      deps.player.y / deps.TILE,
    );
    const color = state.hostile ? DEBUG_INTERACTION_HOSTILE_COLOR
      : state.hit ? DEBUG_INTERACTION_HIT_COLOR
      : DEBUG_INTERACTION_RAY_COLOR;

    // The exact camera ray projects to the screen center and therefore reads
    // as a point; the player-to-endpoint guide makes its world-space result legible.
    _drawDebugSegment3D(state.origin, state.endpoint, color, true, 1.5, 0.75);
    _drawDebugSegment3D(playerCenter, state.endpoint, color, false, 2.5, 0.95);

    const projected = deps.worldToOverlay(state.endpoint.x, state.endpoint.y, state.endpoint.z);
    if (!projected.visible) return;
    const octx = deps.octx;
    const label = state.hit
      ? `${state.targetType}${state.targetId ? ':' + state.targetId : ''} ${state.distanceWorld.toFixed(2)}u`
      : `no 3D interaction hit (${state.distanceWorld.toFixed(0)}u)`;
    octx.save();
    octx.strokeStyle = color;
    octx.fillStyle = color;
    octx.lineWidth = 2;
    octx.beginPath();
    octx.arc(projected.x, projected.y, 7, 0, Math.PI * 2);
    octx.moveTo(projected.x - 11, projected.y);
    octx.lineTo(projected.x + 11, projected.y);
    octx.moveTo(projected.x, projected.y - 11);
    octx.lineTo(projected.x, projected.y + 11);
    octx.stroke();
    octx.font = '12px monospace';
    octx.textBaseline = 'bottom';
    const width = octx.measureText(label).width;
    octx.globalAlpha = 0.8;
    octx.fillStyle = '#07120f';
    octx.fillRect(projected.x + 12, projected.y - 20, width + 8, 18);
    octx.globalAlpha = 1;
    octx.fillStyle = color;
    octx.fillText(label, projected.x + 16, projected.y - 5);
    octx.restore();
  }

  function drawDebugOverlays() {
    if (deps.getShowHitboxes?.()) {
      const player = deps.player;
      const playerHitbox = _actorHitbox(player);
      const playerFootY = playerHitbox?.box?.min?.y ?? _debugGroundY(player.x, player.y);
      _drawDebugSquare(player.x, player.y, playerModelWidthTiles() * deps.TILE / 2, DEBUG_HITBOX_COLOR_PLAYER, true, playerFootY + 0.01);
      _drawDebugBox3(playerHitbox, DEBUG_HITBOX_COLOR_PLAYER);
      for (const c of deps.hostileObjects) {
        if (c.health > 0 && c.areaId === deps.getCurrentArea()) _drawCreatureDebug(c, DEBUG_HITBOX_COLOR_HOSTILE);
      }
      for (const c of deps.companionObjects) {
        if (c.health > 0 && c.areaId === deps.getCurrentArea()) _drawCreatureDebug(c, DEBUG_HITBOX_COLOR_COMPANION);
      }
      _drawMeleeColliders();
    }
    _drawInteractionRaycast();
  }

  function debugSnapshot() {
    const actors = [{ label: 'player', actor: deps?.player }];
    for (const c of deps?.hostileObjects || []) if (c.health > 0 && c.areaId === deps.getCurrentArea()) actors.push({ label: c.id || c.name || c.def?.id || 'hostile', actor: c });
    for (const c of deps?.companionObjects || []) if (c.health > 0 && c.areaId === deps.getCurrentArea()) actors.push({ label: c.id || c.name || c.def?.id || 'companion', actor: c });
    return actors.map(({ label, actor }) => {
      const hitbox = _actorHitbox(actor);
      return hitbox ? {
        label,
        min: _plainPoint(hitbox.box.min),
        max: _plainPoint(hitbox.box.max),
        onBranch: !!actor?.onBranch,
        climbing: !!actor?.climbing,
      } : { label, missing: true };
    });
  }

  window.DebugHitboxes = {
    init,
    draw: drawDebugOverlays,
    noteInteractionFocus,
  };
  window.__hitboxDebug = {
    get actors() { return debugSnapshot(); },
    get interactionRay() { return _interactionRaySnapshot(); },
    snapshot: () => ({
      latestChange: 'Show Hitboxes now draws only real elevated Box3 and melee pie-prism volumes; interaction-ray visualization has its own toggle.',
      actors: debugSnapshot(),
      meleeColliders: (window.Combat?.debugMeleeColliders?.() || []).map(collider => ({
        actor: collider.actor?.id || collider.actor?.name || (collider.actor === deps?.player ? 'player' : 'actor'),
        pitchDeg: THREE.MathUtils.radToDeg(collider.pitch),
        rangeWorld: collider.rangeWorld,
        heightWorld: collider.halfHeightWorld * 2,
      })),
      interactionRay: _interactionRaySnapshot(),
    }),
  };
})();

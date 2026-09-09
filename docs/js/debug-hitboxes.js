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
  const DEBUG_HEAD_LOOK_COLOR = '#c98bff';
  const DEBUG_MOVEMENT_RAY_COLOR = '#55ff7a'; // Camera-authored movement direction drawn by the interaction-ray toggle.
  const DEBUG_GROUND_AIM_COLOR = '#ff9f43'; // Height-sensitive ground focus retained only for tile selection.
  const DEBUG_LOGICAL_BODY_COLOR = '#54a7ff'; // Character-facing state before billboard/render transforms.
  const DEBUG_RENDERED_BODY_COLOR = '#2d6bff'; // Visible body direction after perp/pose yaw.
  const DEBUG_VELOCITY_COLOR = '#ffffff'; // Actual post-acceleration ground velocity.
  const DEBUG_MELEE_AIM_COLOR = '#ff5cf4'; // Current melee aim, including legitimate focused-target convergence.
  const DEBUG_LUNGE_COLOR = '#ffe45c'; // Last camera-authored lunge direction.
  const DEBUG_RANGED_ATTACK_COLOR = '#ff6b35'; // Latest muzzle-to-camera-ray ranged attack direction.

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

  // AI-state fields for a hostile/companion actor, folded into the Pixel
  // Probe's "3D hitboxes" line — added because diagnosing "this creature
  // isn't reacting" from the hitbox/rendering report alone kept dead-ending
  // in a round trip asking for a separate console dump of exactly this.
  // Every field is per-system and optional (each wildlife schedule module
  // stamps its own marker on the creature, see wildlife-territorial.js's
  // _territorialBehavior, wildlife-cloud-forest-behavior.js's _cfDrenkirra/
  // _cfGarWolf, wildlife-grehlr-foraging.js's _grehlrForage), so only the
  // ones actually present on this actor are included.
  function _actorAiDebug(actor) {
    if (!actor || actor === deps?.player) return {};
    const out = {};
    if (actor.state) out.state = actor.state;
    if (actor.def && actor.def.hostile === false) out.passive = true;
    const terr = actor._territorialBehavior;
    if (terr) out.territorial = { phase: terr.phase, elapsedS: Number((terr.elapsedS || 0).toFixed(1)) };
    if (actor._cfDrenkirra) out.cfMode = actor._cfDrenkirra.mode;
    if (actor._cfGarWolf) out.garWolfOffShift = !!actor._cfGarWolf.overlayed;
    if (actor._grehlrForage) out.grehlrMode = actor._grehlrForage.mode;
    if (actor.nestTreeKey) out.nestTreeKey = actor.nestTreeKey;
    if (actor.denKey) out.denKey = actor.denKey;
    if (actor._denHidden) out.denHidden = true;
    return out;
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

  function _drawLabeledDirection(origin, direction, length, color, label, dashed = false) {
    if (!origin || !direction) return;
    const dx = Number(direction.x), dy = Number(direction.y), dz = Number(direction.z); // Converted below into the labeled normalized endpoint.
    const magnitude = Math.hypot(dx, dy, dz); // Rejects invalid/zero rays and normalizes valid ones.
    if (![dx, dy, dz, magnitude].every(Number.isFinite) || magnitude < 1e-8) return;
    const endpoint = { // Used by both the projected segment and its screen-space label.
      x: origin.x + dx / magnitude * length,
      y: origin.y + dy / magnitude * length,
      z: origin.z + dz / magnitude * length,
    };
    _drawDebugSegment3D(origin, endpoint, color, dashed, 2, 0.95);
    const projected = deps.worldToOverlay(endpoint.x, endpoint.y, endpoint.z); // Anchors the label at the ray tip on the overlay canvas.
    if (!projected.visible) return;
    const octx = deps.octx; // Existing overlay canvas receives the ray label.
    octx.save();
    octx.font = '11px monospace';
    octx.textBaseline = 'middle';
    const width = octx.measureText(label).width; // Sizes the dark backing behind the mobile-readable label.
    octx.globalAlpha = 0.82;
    octx.fillStyle = '#070b12';
    octx.fillRect(projected.x + 5, projected.y - 8, width + 6, 16);
    octx.globalAlpha = 1;
    octx.fillStyle = color;
    octx.fillText(label, projected.x + 8, projected.y);
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

  function _movementAlignmentSnapshot() {
    if (!deps.getShowInteractionRaycast?.()) return null;
    try { return deps.getPlayerMovementAlignmentDebug?.() || null; }
    catch (error) {
      return { error: String(error?.message || error) };
    }
  }

  function _drawPlayerMovementAlignmentRays() {
    const state = _movementAlignmentSnapshot(); // Supplies every independently-authored player/camera ray for this frame.
    if (!state || state.error) return;
    const playerCenter = _actorHitbox(deps.player)?.center || new THREE.Vector3( // Shared origin keeps angular disagreements visually obvious.
      deps.player.x / deps.TILE,
      _debugGroundY(deps.player.x, deps.player.y) + 0.45,
      deps.player.y / deps.TILE,
    );
    const origin = _plainPoint(playerCenter); // Plain point reused by each labeled overlay ray.

    // Different lengths keep coincident correct rays readable instead of one
    // color completely covering the others. The orange ray is the old,
    // height-sensitive player-to-ground bearing retained only for tile focus.
    _drawLabeledDirection(origin, state.movementDirection, 3.4, DEBUG_MOVEMENT_RAY_COLOR, 'movement/camera ray');
    _drawLabeledDirection(origin, state.groundAimDirection, 3.0, DEBUG_GROUND_AIM_COLOR, `ground aim ${Number(state.groundAimSkewDeg || 0).toFixed(1)}°`, true);
    _drawLabeledDirection(origin, state.meleeAimDirection, 2.85, DEBUG_MELEE_AIM_COLOR, 'melee aim', true);
    _drawLabeledDirection(origin, state.lastLungeDirection, 2.72, DEBUG_LUNGE_COLOR, 'last lunge', true);
    _drawLabeledDirection(origin, state.rangedAttackDirection, 2.58, DEBUG_RANGED_ATTACK_COLOR, 'ranged attack', true);
    _drawLabeledDirection(origin, state.logicalBodyDirection, 2.6, DEBUG_LOGICAL_BODY_COLOR, 'logical body');
    _drawLabeledDirection(origin, state.renderedBodyDirection, 2.25, DEBUG_RENDERED_BODY_COLOR, 'rendered body');
    _drawLabeledDirection(origin, state.headDirection, 1.9, DEBUG_HEAD_LOOK_COLOR, 'rendered head', true);
    if (state.velocityDirection) {
      _drawLabeledDirection(origin, state.velocityDirection, 1.5, DEBUG_VELOCITY_COLOR, `velocity ${Number(state.velocitySpeedPxS || 0).toFixed(1)}px/s`, true);
    }
    if (state.groundReticle) {
      _drawDebugSegment3D(origin, state.groundReticle, DEBUG_GROUND_AIM_COLOR, true, 1.25, 0.7);
    }
  }

  // Draws one head→target segment for any entity carrying a
  // `_lookAtDebug` cache (see game.js's _setLookAtDebug/_aimNeckAtEyeContact
  // and combat-bandit.js's _updateBanditLookAtTarget) — every head-look
  // system records the exact world points it just aimed at there, rather
  // than this drawer trying to reverse-engineer a direction out of a
  // rotated (and, for animals, mirrored front/back) bone transform.
  function _drawEntityLookAtDebug(entity) {
    const look = entity?._lookAtDebug;
    if (!look?.head || !look?.target) return;
    _drawDebugSegment3D(look.head, look.target, DEBUG_HEAD_LOOK_COLOR, true, 1.5, 0.85);
  }

  function _drawHeadLookRaycasts() {
    if (!deps.getShowInteractionRaycast?.()) return;
    const area = deps.getCurrentArea();
    _drawEntityLookAtDebug(deps.player);
    for (const c of deps.hostileObjects) {
      if (c.health > 0 && c.areaId === area) _drawEntityLookAtDebug(c);
    }
    for (const c of deps.companionObjects) {
      if (c.health > 0 && c.areaId === area) _drawEntityLookAtDebug(c);
    }
    for (const w of deps.npcWalkers || []) {
      if (w.area === area) _drawEntityLookAtDebug(w);
    }
    // Farm livestock -- no health/areaId fields (they simply don't exist in
    // the world while unhoused/in stasis), so presence in the live Set is
    // the only membership check needed.
    for (const animal of deps.animalObjects || []) _drawEntityLookAtDebug(animal);
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
    _drawPlayerMovementAlignmentRays();
    _drawHeadLookRaycasts();
  }

  function debugSnapshot() {
    const actors = [{ label: 'player', actor: deps?.player }];
    for (const c of deps?.hostileObjects || []) if (c.health > 0 && c.areaId === deps.getCurrentArea()) actors.push({ label: c.id || c.name || c.def?.id || 'hostile', actor: c });
    for (const c of deps?.companionObjects || []) if (c.health > 0 && c.areaId === deps.getCurrentArea()) actors.push({ label: c.id || c.name || c.def?.id || 'companion', actor: c });
    return actors.map(({ label, actor }) => {
      const hitbox = _actorHitbox(actor);
      const ai = _actorAiDebug(actor);
      return hitbox ? {
        label,
        min: _plainPoint(hitbox.box.min),
        max: _plainPoint(hitbox.box.max),
        onBranch: !!actor?.onBranch,
        climbing: !!actor?.climbing,
        ...ai,
      } : { label, missing: true, ...ai };
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
      latestChange: 'Show Interaction Raycast now separates camera/movement, ground focus, logical body, rendered body, rendered head, and velocity rays.',
      actors: debugSnapshot(),
      meleeColliders: (window.Combat?.debugMeleeColliders?.() || []).map(collider => ({
        actor: collider.actor?.id || collider.actor?.name || (collider.actor === deps?.player ? 'player' : 'actor'),
        pitchDeg: THREE.MathUtils.radToDeg(collider.pitch),
        rangeWorld: collider.rangeWorld,
        heightWorld: collider.halfHeightWorld * 2,
      })),
      interactionRay: _interactionRaySnapshot(),
      movementAlignment: _movementAlignmentSnapshot(),
    }),
  };
})();

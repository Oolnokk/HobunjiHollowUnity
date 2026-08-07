(() => {
  'use strict';

  // Debug hitbox/collider overlay — draws player/creature collision squares,
  // attack telegraph shapes, and PNG-plane deadzone fans on the 2D overlay
  // canvas, gated behind Settings → Dev Tools → "Show hitboxes". Extracted
  // out of game.js following the same window.<Namespace> + init(deps)
  // pattern as its sibling systems. creatureHitboxHalfSizePx/
  // creatureAimColliderReachPx/cameraRelativeCreaturePerps/
  // CREATURE_PERP_DEAD_RAD stay behind in game.js on purpose — they're also
  // used by the live creature movement/animation code, not owned by the
  // debug overlay alone — and come in through deps.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  const DEBUG_HITBOX_COLOR_PLAYER    = '#5cf2ff';
  const DEBUG_HITBOX_COLOR_HOSTILE   = '#ff6a6a';
  const DEBUG_HITBOX_COLOR_COMPANION = '#7fe89a';
  const DEBUG_ATTACK_COLOR_WINDUP    = '#ffc23d';
  const DEBUG_ATTACK_COLOR_STRIKE    = '#ffffff';
  const DEBUG_ATTACK_COLOR_LEAP      = '#ff3df0';
  const DEBUG_AIM_COLLIDER_COLOR     = '#c792ff';
  // Deadzone arcs drawn per-creature when hitboxes are visible: the two
  // camera-relative dead zones the PNG plane never freely tracks through
  // (see CREATURE_PLANE_ROT_MODE in game.js for which of sway/halt/snap
  // governs what it does instead). The pngRot line shows where the PNG
  // plane is actually pointed right now (may differ from group rotation).
  const DEBUG_DEADZONE_FILL_COLOR    = '#cc2020';
  const DEBUG_DEADZONE_EDGE_COLOR    = '#ff5050';
  const DEBUG_PNG_ROT_COLOR          = '#ff80ff';

  // Player avatar's crossed-plane "prism" base width (tile units) — mirrors
  // the worldModelWidth lookup refreshPlayerAvatar() (game.js) uses to build
  // the avatar mesh, since the player object stores no width of its own.
  function playerModelWidthTiles() {
    return window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.worldModelWidth ?? 0.9;
  }

  function _debugGroundY(wx, wy) {
    const tile = deps.getActiveTileAt(Math.floor(wx / deps.TILE), Math.floor(wy / deps.TILE));
    return (tile ? deps.tileSurfaceY(tile.type) : 0) + 0.05;
  }

  function _drawDebugCircle(wx, wy, radiusPx, color, dashed) {
    const octx = deps.octx;
    const y = _debugGroundY(wx, wy);
    const center = deps.worldToOverlay(wx / deps.TILE, y, wy / deps.TILE);
    if (!center.visible) return;
    const edge = deps.worldToOverlay((wx + radiusPx) / deps.TILE, y, wy / deps.TILE);
    const r = Math.hypot(edge.x - center.x, edge.y - center.y);
    octx.save();
    octx.globalAlpha = 0.8;
    octx.strokeStyle = color;
    octx.lineWidth = 1.5;
    if (dashed) octx.setLineDash([5, 4]);
    octx.beginPath();
    octx.ellipse(center.x, center.y, r, r * 0.5, 0, 0, Math.PI * 2);
    octx.stroke();
    octx.restore();
  }

  function _drawDebugSquare(wx, wy, halfSizePx, color, dashed) {
    const octx = deps.octx;
    const y = _debugGroundY(wx, wy);
    const halfTiles = halfSizePx / deps.TILE;
    const baseX = wx / deps.TILE, baseZ = wy / deps.TILE;
    const corners = [
      deps.worldToOverlay(baseX - halfTiles, y, baseZ - halfTiles),
      deps.worldToOverlay(baseX + halfTiles, y, baseZ - halfTiles),
      deps.worldToOverlay(baseX + halfTiles, y, baseZ + halfTiles),
      deps.worldToOverlay(baseX - halfTiles, y, baseZ + halfTiles),
    ];
    if (!corners[0].visible) return;
    octx.save();
    octx.globalAlpha = 0.8;
    octx.strokeStyle = color;
    octx.lineWidth = 1.5;
    if (dashed) octx.setLineDash([5, 4]);
    octx.beginPath();
    octx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) octx.lineTo(corners[i].x, corners[i].y);
    octx.closePath();
    octx.stroke();
    octx.restore();
  }

  function _drawDebugLine(wx1, wy1, wx2, wy2, color, dashed) {
    const octx = deps.octx;
    const p1 = deps.worldToOverlay(wx1 / deps.TILE, _debugGroundY(wx1, wy1), wy1 / deps.TILE);
    const p2 = deps.worldToOverlay(wx2 / deps.TILE, _debugGroundY(wx2, wy2), wy2 / deps.TILE);
    if (!p1.visible && !p2.visible) return;
    octx.save();
    octx.globalAlpha = 0.85;
    octx.strokeStyle = color;
    octx.lineWidth = 2;
    if (dashed) octx.setLineDash([4, 4]);
    octx.beginPath();
    octx.moveTo(p1.x, p1.y);
    octx.lineTo(p2.x, p2.y);
    octx.stroke();
    octx.restore();
  }

  function _drawDebugCone(wx, wy, angle, rangePx, halfConeRad, color) {
    const octx = deps.octx;
    const y = _debugGroundY(wx, wy);
    const rangeTiles = rangePx / deps.TILE;
    const baseX = wx / deps.TILE, baseZ = wy / deps.TILE;
    const left = angle - halfConeRad, right = angle + halfConeRad;
    const origin = deps.worldToOverlay(baseX, y, baseZ);
    if (!origin.visible) return;
    const leftEnd = deps.worldToOverlay(baseX + Math.cos(left) * rangeTiles, y, baseZ + Math.sin(left) * rangeTiles);
    const rightEnd = deps.worldToOverlay(baseX + Math.cos(right) * rangeTiles, y, baseZ + Math.sin(right) * rangeTiles);
    octx.save();
    octx.globalAlpha = 0.85;
    octx.strokeStyle = color;
    octx.lineWidth = 2;
    octx.beginPath();
    octx.moveTo(origin.x, origin.y);
    octx.lineTo(leftEnd.x, leftEnd.y);
    octx.lineTo(rightEnd.x, rightEnd.y);
    octx.closePath();
    octx.stroke();
    octx.restore();
  }

  // Ground-plane arc sector (for deadzone fans). fromAngle/toAngle are
  // world-space angles (same convention as c.facing / atan2 game coords).
  // radiusPx is the visual reach of the fan in game pixels.
  function _drawDebugArcSector(wx, wy, fromAngle, toAngle, radiusPx, edgeColor, fillColor) {
    const octx = deps.octx;
    const N = 20;
    const y = _debugGroundY(wx, wy);
    const bx = wx / deps.TILE, bz = wy / deps.TILE, rT = radiusPx / deps.TILE;
    const origin = deps.worldToOverlay(bx, y, bz);
    if (!origin.visible) return;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const a = fromAngle + (toAngle - fromAngle) * (i / N);
      pts.push(deps.worldToOverlay(bx + Math.cos(a) * rT, y, bz + Math.sin(a) * rT));
    }
    octx.save();
    octx.beginPath();
    octx.moveTo(origin.x, origin.y);
    octx.lineTo(pts[0].x, pts[0].y);
    for (let i = 1; i <= N; i++) octx.lineTo(pts[i].x, pts[i].y);
    octx.closePath();
    octx.globalAlpha = 0.18;
    octx.fillStyle = fillColor;
    octx.fill();
    octx.globalAlpha = 0.75;
    octx.strokeStyle = edgeColor;
    octx.lineWidth = 1.5;
    octx.setLineDash([3, 3]);
    octx.stroke();
    octx.restore();
  }

  function _drawCreatureDebug(c, hitboxColor) {
    const def = c.def;
    const halfSize = deps.creatureHitboxHalfSizePx(def);
    _drawDebugSquare(c.x, c.y, halfSize, hitboxColor, false);

    if (def.attacks?.includes('pounce')) {
      const ang = c.facing || 0;
      const reach = deps.creatureAimColliderReachPx(def);
      const sx = c.x + Math.cos(ang) * halfSize, sy = c.y + Math.sin(ang) * halfSize;
      const ex = c.x + Math.cos(ang) * reach, ey = c.y + Math.sin(ang) * reach;
      _drawDebugLine(sx, sy, ex, ey, DEBUG_AIM_COLLIDER_COLOR, true);
    }

    const aa = c._animalAttack;
    if (aa && aa.state.stage === 'leap' && aa.state.rangePx != null) {
      const st = aa.state;
      const headX = c.x + Math.cos(st.angle) * st.headOffsetPx;
      const headY = c.y + Math.sin(st.angle) * st.headOffsetPx;
      _drawDebugCone(headX, headY, st.angle, st.rangePx, st.halfConeRad, DEBUG_ATTACK_COLOR_LEAP);
    } else if (c.telegraphState) {
      _drawDebugCircle(c.x, c.y, def.attackRangePx,
        c.telegraphState === 'strike' ? DEBUG_ATTACK_COLOR_STRIKE : DEBUG_ATTACK_COLOR_WINDUP, true);
    }

    // Deadzone fans — the two camera-relative angle bands where the PNG
    // plane lerps through rather than tracking freely. Each perp is stored
    // in Three.js rotation.y space; convert to world-space angle via
    //   worldAngle = π/2 − rotY
    // so the sector maps back into the same atan2 space as c.facing.
    const dzR = deps.TILE * 0.65;
    for (const P_rotY of deps.cameraRelativeCreaturePerps()) {
      const wc = Math.PI / 2 - P_rotY;
      _drawDebugArcSector(c.x, c.y, wc - deps.CREATURE_PERP_DEAD_RAD, wc + deps.CREATURE_PERP_DEAD_RAD,
        dzR, DEBUG_DEADZONE_EDGE_COLOR, DEBUG_DEADZONE_FILL_COLOR);
    }
    // Current PNG plane direction — where the sprite is visually facing
    // right now (may lag or differ from the prism/group rotation).
    if (c.pngRot !== undefined) {
      const pngWorldAngle = Math.PI / 2 - c.pngRot;
      _drawDebugLine(c.x, c.y,
        c.x + Math.cos(pngWorldAngle) * dzR,
        c.y + Math.sin(pngWorldAngle) * dzR,
        DEBUG_PNG_ROT_COLOR, false);
    }
  }

  function drawDebugHitboxes() {
    if (!deps.getShowHitboxes()) return;
    const player = deps.player;
    _drawDebugSquare(player.x, player.y, playerModelWidthTiles() * deps.TILE / 2, DEBUG_HITBOX_COLOR_PLAYER, false);
    for (const c of deps.hostileObjects) {
      if (c.health <= 0 || c.areaId !== deps.getCurrentArea()) continue;
      _drawCreatureDebug(c, DEBUG_HITBOX_COLOR_HOSTILE);
    }
    for (const c of deps.companionObjects) {
      if (c.health <= 0 || c.areaId !== deps.getCurrentArea()) continue;
      _drawCreatureDebug(c, DEBUG_HITBOX_COLOR_COMPANION);
    }
  }

  window.DebugHitboxes = {
    init,
    draw: drawDebugHitboxes,
  };
})();

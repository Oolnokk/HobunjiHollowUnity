(() => {
  'use strict';

  // "Behind-the-scenes" wildlife behavior grid — 🧬 Wildlife dev tab. A
  // top-down canvas snapshot of the player's current wilderness zone:
  // dens, nest trees, fruit, berry bushes, water, every live creature
  // (colored by species, ringed by a coarse behavior bucket read straight
  // off the same state fields wildlife-cloud-forest-behavior.js/
  // wildlife-grehlr-foraging.js already maintain on each creature), the
  // player, and the LOD near/far boundary combat resolution actually uses.
  // Extracted as its own window.<Namespace> + init(deps) module — plain
  // render-on-demand like js/wildlife-debug-panel.js, not a WildlifeSpawn
  // patch, since this only ever reads existing state for display.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  const DEFAULT_LOD_NEAR_RANGE_TILES = 14; // mirrors wildlife-cloud-forest-behavior.js's own constant, used only if that module hasn't loaded yet
  let visibilityTimer = null;

  function lodNearRangeTiles() {
    const exported = window.HobunjiCloudForestWildlife?.LOD_NEAR_RANGE_TILES;
    return Number.isFinite(exported) ? exported : DEFAULT_LOD_NEAR_RANGE_TILES;
  }

  function speciesColor(creatureKey) {
    const key = String(creatureKey || '');
    if (key.startsWith('gar-wolf')) return '#c7c7c7';
    if (key.startsWith('drenkirra')) return '#6fcf7a';
    if (key.startsWith('grehlr')) return '#c9a24b';
    if (key.startsWith('uumkaoii')) return '#e6b673';
    return '#e5e7eb';
  }

  // Coarse behavior bucket -> ring color, read straight off whichever
  // schedule-AI module's own per-creature state field is present (both
  // are namespaced so they never collide on the same creature). Anything
  // not in a recognizable "interesting" state (idle/patrol/wander) gets no
  // ring at all, so the map stays legible instead of every dot being
  // circled.
  function behaviorRingColor(c) {
    if (c.state === 'chase' || c.state === 'patrol-chase' || c.state === 'fleeing-low-health') return '#ff5c5c';
    const cf = c._cfDrenkirra?.mode, gf = c._grehlrForage?.mode;
    if (cf === 'sleeping') return '#7a7aff';
    if (cf === 'eating' || gf === 'eatingBerry' || gf === 'fishing') return '#ffd166';
    if ((cf && cf.startsWith('seeking')) || (gf && gf.startsWith('seeking'))) return '#66d9ef';
    return null;
  }

  function drawMarker(ctx, px, py, r, fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Toggled on every render() call regardless of what changed on the grid —
  // creatures spend long stretches genuinely motionless (denning, sleeping,
  // grazing/eating in place, guarding a fishing spot), so a picture with
  // nothing visibly moving doesn't mean the refresh loop stalled. This is
  // the tell.
  let pulseOn = false;
  function tickPulse() {
    const dot = document.getElementById('wildlifeBehaviorMapPulse');
    if (!dot) return;
    pulseOn = !pulseOn;
    dot.style.opacity = pulseOn ? '1' : '0.25';
  }

  function render() {
    const canvas = document.getElementById('wildlifeBehaviorMap');
    if (!canvas || !deps) return;
    tickPulse();
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, w, h);

    const zoneEl = document.getElementById('wildlifeBehaviorMapZone');
    const countsEl = document.getElementById('wildlifeBehaviorMapCounts');
    const zoneId = deps.getCurrentArea?.();
    const zoneData = zoneId ? deps.zoneLayouts.get(zoneId) : null;

    if (!zoneId || !deps._isZoneArea?.(zoneId) || !zoneData) {
      if (zoneEl) zoneEl.textContent = zoneId || '—';
      if (countsEl) countsEl.textContent = 'not in a wilderness zone';
      ctx.fillStyle = '#6b7280';
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillText('Not in a wilderness zone.', 10, h / 2);
      return;
    }
    if (zoneEl) zoneEl.textContent = zoneId;

    const cols = zoneData.cols || 1, rows = zoneData.rows || 1;
    const scale = Math.min(w / cols, h / rows);
    const offX = (w - cols * scale) / 2, offY = (h - rows * scale) / 2;
    const toPx = (tileX, tileY) => [offX + tileX * scale, offY + tileY * scale];

    // Water — a plain per-tile fill rather than a merged shape; cheap
    // enough at this refresh rate (a few Hz at most, only while this tab
    // is actually open) and avoids needing to know the zone's merged
    // water-mesh geometry at all.
    ctx.fillStyle = 'rgba(90,160,230,0.55)';
    for (const t of zoneData.tiles || []) {
      if (t.type !== deps.TileType.RIVER && t.type !== deps.TileType.STREAM) continue;
      const [px, py] = toPx(t.c, t.r);
      ctx.fillRect(px, py, Math.max(1, scale), Math.max(1, scale));
    }

    // Dens
    ctx.fillStyle = '#8a5a3a';
    for (const den of zoneData.dens || []) {
      const [px, py] = toPx(den.x, den.y);
      ctx.fillRect(px, py, Math.max(2, (den.w || 1) * scale), Math.max(2, (den.h || 1) * scale));
    }

    // Nest trees + fruit branches (cloud-forest-only data; a harmless
    // empty scan in any other zone since ClimbSystem just returns []).
    const branches = window.ClimbSystem?.debugBranchesFor?.(zoneId) || [];
    for (const b of branches) {
      if (b.felled) continue;
      if (b.nest) {
        const [px, py] = toPx(b.col, b.row);
        drawMarker(ctx, px, py, Math.max(2, scale * 0.5), '#3ea34c');
      } else if (b.fruit?.available) {
        const [px, py] = toPx(b.col, b.row);
        drawMarker(ctx, px, py, Math.max(1.5, scale * 0.35), '#d9542b');
      }
    }

    // Berry bushes
    for (const berry of window.WildBerries?.listBerries?.(zoneId) || []) {
      const [px, py] = toPx(berry.col, berry.row);
      drawMarker(ctx, px, py, Math.max(1.5, scale * 0.35), '#e0475a');
    }

    const player = deps.player;
    const lodRangeTiles = lodNearRangeTiles();
    if (player) {
      const [ppx, ppy] = toPx(player.x / deps.TILE, player.y / deps.TILE);
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(ppx, ppy, lodRangeTiles * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Creatures
    let nearCount = 0, farCount = 0;
    for (const c of deps.hostileObjects) {
      if (c.health <= 0 || c.areaId !== zoneId) continue;
      const [px, py] = toPx(c.x / deps.TILE, c.y / deps.TILE);
      if (player) {
        const distTiles = Math.hypot(c.x - player.x, c.y - player.y) / deps.TILE;
        if (distTiles <= lodRangeTiles) nearCount++; else farCount++;
      }
      const ring = behaviorRingColor(c);
      if (ring) {
        ctx.strokeStyle = ring;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(2.6, scale * 0.55), 0, Math.PI * 2);
        ctx.stroke();
      }
      drawMarker(ctx, px, py, Math.max(1.6, scale * 0.4), speciesColor(c.creatureKey));
    }

    // Player marker — a small white diamond, drawn last so it's never
    // occluded by an overlapping creature dot.
    if (player) {
      const [ppx, ppy] = toPx(player.x / deps.TILE, player.y / deps.TILE);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(ppx, ppy - 4); ctx.lineTo(ppx + 4, ppy); ctx.lineTo(ppx, ppy + 4); ctx.lineTo(ppx - 4, ppy);
      ctx.closePath();
      ctx.fill();
    }

    if (countsEl) countsEl.textContent = `${nearCount} near · ${farCount} far (dice-roll)`;
  }

  // Live-updates while the Wildlife tab is actually the visible pane —
  // checked cheaply via the same .mp-tab/.mp-pane .active class toggling
  // switchMenuPanel already drives, plus an actual layout check so this
  // doesn't keep redrawing a few times a second with the whole menu closed
  // (an .active pane class can persist under a fully hidden menu overlay).
  function isVisible() {
    const pane = document.getElementById('mpWildlife');
    if (!pane || !pane.classList.contains('active')) return false;
    return pane.getBoundingClientRect().width > 0;
  }
  function startVisibilityLoop() {
    if (visibilityTimer) return;
    visibilityTimer = setInterval(() => { if (isVisible()) render(); }, 1000);
  }

  window.WildlifeBehaviorMap = { init, render };
  startVisibilityLoop();
})();

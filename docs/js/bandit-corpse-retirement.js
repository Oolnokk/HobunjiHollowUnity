// Bandit corpse rig retirement.
//
// Wildlife corpses drop their rig and become plain data once the player is far
// away (js/wildlife-visual-lod.js, isStreamableCorpse). Bandits cannot: they
// have their own async portrait rig builder, so isStreamableCorpse and
// canHoldAsData in game.js both exclude them, and a settled, un-looted bandit
// corpse keeps its whole humanoid rig for the rest of the session. That is
// roughly 90 scene objects and 50 draw calls per body, paid in every render
// pass. Fights between camps leave bodies nobody loots, so they pile up and the
// frame cost never comes back down.
//
// This keeps the few newest (and any nearby) bodies fully rigged and swaps the
// rig of older ones for one flat marker. Only the presentation changes: the
// entity keeps its tile, its data and its loot (looting reads the entity, not
// the rig), and the marker leaves through the same despawn path as a rig when
// the body is looted. Bodies that must stay intact keep their rigs: revivable
// ones (keepCorpseAfterLoot, e.g. a lich's skeletons) and timed-search bodies.
//
// Tune or disable with SCRATCHBONES_CONFIG.game.banditCorpseRetire.
(() => {
  'use strict';

  const DEFAULTS = Object.freeze({
    enabled: true,
    keepFull: 6,       // Newest settled bodies per area that always keep their rig.
    nearTiles: 5,      // A body this close to the player keeps its rig, so nothing changes under their feet.
    minSettledS: 12,   // A body must have lain still this long before its rig can be swapped.
    perTick: 3,        // At most this many swaps per run, so a big pile never costs a single hitchy frame.
    intervalMs: 1000,  // Wall clock between runs, so a slow frame rate does not stretch it.
  });

  let deps = null;
  let lastRunAt = -Infinity;
  let markerGeometry = null;
  let markerMaterial = null;
  const stats = { retired: 0, runs: 0 };

  function config() {
    const override = window.SCRATCHBONES_CONFIG?.game?.banditCorpseRetire;
    return override && typeof override === 'object' ? { ...DEFAULTS, ...override } : DEFAULTS;
  }

  function init(injected) {
    deps = injected;
  }

  // Everything that must keep its rig is rejected here, in one place.
  function isRetirable(c, currentArea) {
    return !!c && c.isBandit === true && c.state === 'corpse' && !(c.health > 0)
      && !c._banditCorpseRetired && !c.corpseLooted
      && !c.keepCorpseAfterLoot && !(Number(c.lootHoldSeconds) > 0)
      && c.areaId === currentArea && !!c.avatarRef?.group;
  }

  function markerParts() {
    if (!markerGeometry) {
      markerGeometry = new window.THREE.CircleGeometry(0.5, 16);
      markerGeometry.rotateX(-Math.PI / 2); // Lies flat on the ground.
      markerMaterial = new window.THREE.MeshBasicMaterial({ color: 0x2b1814, transparent: true, opacity: 0.8, depthWrite: false });
    }
    return { geometry: markerGeometry, material: markerMaterial };
  }

  // Swaps one corpse's rig for the shared flat marker. Returns true when swapped.
  function retire(c) {
    const rig = c?.avatarRef;
    if (!deps || !rig?.group || c._banditCorpseRetired) return false;
    const tile = deps.getTile();
    const grid = c.areaGrid;
    const col = Math.floor(c.x / tile), row = Math.floor(c.y / tile);
    const surfaceY = grid?.[row]?.[col] ? deps.tileSurfaceYInArea(grid[row][col], c.areaId) : rig.group.position.y;
    const width = Math.max(0.55, Number(c.visualModelWidth) || Number(c.def?.modelWidth) || 0.8);

    const { geometry, material } = markerParts();
    const marker = new window.THREE.Mesh(geometry, material);
    marker.scale.set(width, 1, width * 0.55); // A body lying down is longer than it is wide.
    marker.rotation.y = Number(c.deathRestRotY) || 0;
    const group = new window.THREE.Group();
    group.name = 'bandit_corpse_marker';
    group.add(marker);
    group.position.set(c.x / tile, surfaceY + 0.03, c.y / tile);

    deps.disposeCreaturePresentation(c); // Shared owner: removes the rig, shadow, weapon holders and ring HUD.
    c.groundShadow = null;
    c._impactRagdollPlayback = null; c._deathRecordedThrow = null; c._deathScorch = null; c._carriedBabyVisuals = null; // Belonged to the rig.
    (c.scene || deps.getDefaultScene()).add(group);
    // Same shape consumers already read (prompt anchor = avatarRef.group; despawn calls dispose()). The geometry and
    // material are shared by every marker, so dispose() only removes this body's group.
    c.avatarRef = { group, frontPlane: null, backPlane: null, isCorpseMarker: true, dispose() { group.parent?.remove?.(group); } };
    c._banditCorpseRetired = true;
    stats.retired++;
    return true;
  }

  // Throttled; called every frame from game.js's tickCorpses.
  function tick(now) {
    if (!deps) return 0;
    const cfg = config();
    if (!cfg.enabled || now - lastRunAt < cfg.intervalMs) return 0;
    lastRunAt = now;
    stats.runs++;
    const currentArea = deps.getCurrentArea();
    const candidates = [];
    for (const c of deps.corpseObjects) {
      if (!isRetirable(c, currentArea)) continue;
      if (c._corpseSettledAt == null) c._corpseSettledAt = now; // First run that sees it settled.
      candidates.push(c);
    }
    if (candidates.length <= cfg.keepFull) return 0;
    candidates.sort((a, b) => b._corpseSettledAt - a._corpseSettledAt); // Newest first: those keep their rigs.
    const player = deps.getPlayer();
    const nearPx = cfg.nearTiles * deps.getTile();
    let retired = 0;
    for (let i = candidates.length - 1; i >= cfg.keepFull && retired < cfg.perTick; i--) { // Oldest first, stopping at the bodies that keep their rigs.
      const c = candidates[i];
      if (now - c._corpseSettledAt < cfg.minSettledS * 1000) continue;
      if (Math.hypot(player.x - c.x, player.y - c.y) < nearPx) continue;
      if (retire(c)) retired++;
    }
    return retired;
  }

  window.BanditCorpseRetirement = {
    init, tick, retire, isRetirable, config,
    defaults: DEFAULTS,
    get stats() { return { ...stats }; },
  };
})();

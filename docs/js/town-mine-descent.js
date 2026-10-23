(() => {
  'use strict';

  // Town-mine descent holes: the one-shot per-floor discovery roll (rock,
  // enemy kill, or collected Shattercask rubble), the walkable tile it opens
  // on, and the hole mesh + floor transition it adds. Extracted out of
  // game.js following the same window.<Namespace> + init(deps) pattern as
  // its sibling systems; game.js still owns the per-visit maps it reads.
  const THREE = window.THREE;
  let deps = null;

  function init(injectedDeps) { deps = injectedDeps; }

  function revealMineDescentVisual(mapId, col, row) {
    const info = deps.buildingScenes.get(mapId);
    const floor = window.TownMine?.floorFromMapId?.(mapId);
    if (!info?.scene || !floor || floor >= 100) return false;
    const key = `${col},${row}`;
    let hole = deps.holeMeshes.get(mapId)?.get(key);
    if (!hole) {
      hole = new THREE.Group();
      const voidDisk = new THREE.Mesh(new THREE.CircleGeometry(0.37, 24), new THREE.MeshBasicMaterial({ color: 0x000000, depthWrite: false }));
      voidDisk.rotation.x = -Math.PI / 2;
      voidDisk.position.y = 0.135;
      hole.add(voidDisk);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.065, 8, 24), new THREE.MeshLambertMaterial({ color: 0x73777b }));
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.15;
      hole.add(rim);
      const innerRim = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.025, 6, 20), new THREE.MeshBasicMaterial({ color: 0x25282b }));
      innerRim.rotation.x = Math.PI / 2;
      innerRim.position.y = 0.145;
      hole.add(innerRim);
      hole.position.set(col + 0.5, 0, row + 0.5);
      info.scene.add(hole);
      if (!deps.holeMeshes.has(mapId)) deps.holeMeshes.set(mapId, new Map());
      deps.holeMeshes.get(mapId).set(key, hole);
    }
    if (!info.transitions.some(transition => transition.mineDynamicDescent)) {
      info.transitions.push({
        col, row, area: mapId, target: 'building',
        targetMapId: window.TownMine.mapIdForFloor(floor + 1),
        mineDynamicDescent: true,
      });
    }
    return true;
  }

  function nearestWalkableMineHoleTile(mapId, preferredCol, preferredRow) {
    const info = deps.buildingScenes.get(mapId);
    if (!info?.grid) return null;
    const occupiedTransitions = new Set(info.transitions.map(transition => `${transition.col},${transition.row}`));
    for (let radius = 0; radius <= 6; radius++) {
      for (let row = preferredRow - radius; row <= preferredRow + radius; row++) {
        for (let col = preferredCol - radius; col <= preferredCol + radius; col++) {
          if (Math.max(Math.abs(col - preferredCol), Math.abs(row - preferredRow)) !== radius) continue;
          const tile = info.grid[row]?.[col];
          if (!tile || tile.type === deps.TileType.ROCK || occupiedTransitions.has(`${col},${row}`)) continue;
          return { col, row };
        }
      }
    }
    return null;
  }

  function tryRevealMineDescent(mapId, preferredCol, preferredRow, source) {
    const state = deps.runStates.get(mapId);
    if (!state || state.descentRevealed) return false;
    if (source === 'rock' || source === 'rubble') state.remainingRocks = Math.max(0, state.remainingRocks - 1); // Each blasted rock leaves exactly one rubble pile.
    if (source === 'enemy') state.remainingEnemies = Math.max(0, state.remainingEnemies - 1);
    if (!state.canDescend) return false;
    const chance = window.TownMine?.descentChance?.(source) || (source === 'enemy' ? 0.16 : 0.08); // Doubled base odds; TownMine adds the source-specific perk rank.
    const guaranteedFallback = state.remainingRocks + state.remainingEnemies === 0;
    if (!guaranteedFallback && Math.random() >= chance) return false;
    const tile = nearestWalkableMineHoleTile(mapId, preferredCol, preferredRow);
    if (!tile || !revealMineDescentVisual(mapId, tile.col, tile.row)) return false;
    state.descentRevealed = true;
    state.descentCol = tile.col;
    state.descentRow = tile.row;
    return true;
  }

  window.TownMineDescent = Object.freeze({
    init,
    tryReveal: tryRevealMineDescent,
    revealVisual: revealMineDescentVisual,
    nearestWalkableHoleTile: nearestWalkableMineHoleTile,
  });
})();

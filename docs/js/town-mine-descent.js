(() => {
  'use strict';

  // Town-mine descent holes: the one-shot per-floor discovery roll (rock,
  // enemy kill, or collected Shattercask rubble), the walkable tile it opens
  // on, and the hole mesh + floor transition it adds. Extracted out of
  // game.js following the same window.<Namespace> + init(deps) pattern as
  // its sibling systems; game.js still owns the per-visit maps it reads.
  const THREE = window.THREE;
  let deps = null;
  const ROCK_CHANCE_GAIN_PER_BREAK = 0.02; // Used to raise rock-based descent odds by two percentage points for each previous break on this floor.

  function init(injectedDeps) { deps = injectedDeps; }

  function rockBreakCount(state) {
    return Math.max(0, Math.floor(Number(state?.rocksBrokenOnFloor) || 0));
  }

  function descentRollChance(source, state) {
    const baseChance = window.TownMine?.descentChance?.(source) ?? (source === 'enemy' ? 0.16 : source === 'rubble' ? 0.35 : 0.08); // Used to preserve base odds and Mining perks independently of the cumulative bonus.
    const rockBonus = (source === 'rock' || source === 'rubble') ? rockBreakCount(state) * ROCK_CHANCE_GAIN_PER_BREAK : 0; // Used only for rock-based discoveries, never enemy kills.
    return Math.min(1, Math.max(0, baseChance + rockBonus));
  }

  function debugStatus(mapId) {
    const state = deps?.runStates?.get(mapId); // Used to expose the active floor's next-roll odds through the existing in-game mine diagnostics.
    if (!state) return null;
    return {
      rocksBrokenOnFloor: rockBreakCount(state),
      nextRockChance: descentRollChance('rock', state),
      nextRubbleChance: descentRollChance('rubble', state),
      descentRevealed: !!state.descentRevealed,
    };
  }

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
    const chance = descentRollChance(source, state); // Roll using prior breaks only: ten broken rocks add 20% to the eleventh roll.
    if (source === 'rock' || source === 'rubble') {
      state.remainingRocks = Math.max(0, state.remainingRocks - 1); // Each collected Shattercask rock pile counts as one broken rock.
      state.rocksBrokenOnFloor = rockBreakCount(state) + 1; // Used by future rock/rubble rolls; a newly generated floor starts again at zero.
    }
    if (source === 'enemy') state.remainingEnemies = Math.max(0, state.remainingEnemies - 1);
    if (!state.canDescend) return false;
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
    debugStatus,
  });
})();

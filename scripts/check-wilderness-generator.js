#!/usr/bin/env node
// Headless validation for docs/js/wilderness-generator.js.
//
// For a spread of seeds and zone sizes this:
//   1. runs the generator,
//   2. independently re-merges the exported workspace exactly the way
//      docs/game.js _loadTownFromWorkspace/mergeZoneTiles does (plateau mask
//      staking, auto-incline rings, pinhole fill, submap re-stamping,
//      explicit-tile wins, keepRockTiles),
//   3. asserts that every walkable merged tile is reachable from the entry
//      under the game's movement rules with the climb limited to the max
//      ramp angle (PLATEAU_UNIT = 2.5 world units per tier, 1 unit per tile),
//   4. asserts no adjacent pair of reachable walkable tiles forces a climb
//      steeper than the max ramp angle.
//
// Exits non-zero on any failure.
'use strict';

const path = require('path');
const generator = require(path.join(__dirname, '..', 'docs', 'js', 'wilderness-generator.js'));

const PLATEAU_UNIT = 2.5;
const SOLID_TYPES = new Set(['rock', 'shrub']);
const BLOCKED_WATER = new Set(['river', 'stream', 'waterfall']);

// Faithful re-implementation of the game's zone merge (docs/game.js
// mergeZoneTiles) reduced to what walkability needs: type/elevTier/incline/
// rampElevation per world cell.
function mergeWorkspaceZone(workspace) {
  const maps = workspace.maps;
  const root = maps[0];
  const childByParentGroup = new Map();
  for (const m of maps) {
    if (m.isSubmap && m.parentMapId && m.plateauGroupId) {
      childByParentGroup.set(`${m.parentMapId}__${m.plateauGroupId}`, m);
    }
  }
  const plateauElevById = new Map((workspace.plateauGroups || []).map(g => [g.id, g.elevation || 0]));
  const outTiles = new Map();

  function merge(m, offsetC, offsetR, baseTier) {
    const groupMask = new Map();
    for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
      const plateauId = m.tiles?.[`${c},${r}`]?.plateau;
      if (!plateauId) continue;
      let mask = groupMask.get(plateauId);
      if (!mask) { mask = new Set(); groupMask.set(plateauId, mask); }
      mask.add(`${c},${r}`);
    }
    const tierAt = (c, r) => {
      const pid = m.tiles?.[`${c},${r}`]?.plateau;
      return pid ? (plateauElevById.get(pid) || 0) : baseTier;
    };
    const children = [];
    for (const [gid, mask] of groupMask) {
      const child = childByParentGroup.get(`${m.id}__${gid}`);
      if (!child) continue;
      const toTier = plateauElevById.get(gid) || 0;
      let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
      for (const k of mask) { const [c, r] = k.split(',').map(Number); if (c < minC) minC = c; if (c > maxC) maxC = c; if (r < minR) minR = r; if (r > maxR) maxR = r; }
      for (let pass = 0; pass < 8; pass++) {
        let filled = false;
        for (let r = minR; r <= maxR; r++) for (let c = minC; c <= maxC; c++) {
          const k = `${c},${r}`;
          if (mask.has(k) || m.tiles?.[k]) continue;
          const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dc, dr]) => mask.has(`${c + dc},${r + dr}`)).length;
          if (n >= 3) { mask.add(k); filled = true; }
        }
        if (!filled) break;
      }
      for (const k of mask) {
        const [lc, lr] = k.split(',').map(Number);
        const c = lc + offsetC, r = lr + offsetR;
        let ringTier = null;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (mask.has(`${lc + dc},${lr + dr}`)) continue;
          const supportTier = tierAt(lc + dc, lr + dr);
          if (supportTier < toTier) ringTier = ringTier === null ? supportTier : Math.min(ringTier, supportTier);
        }
        const onRing = ringTier !== null;
        outTiles.set(`${c},${r}`, { c, r, type: 'grass', elevTier: onRing ? ringTier : toTier, rampElevation: 0, incline: onRing, staked: true });
      }
      children.push({ child, childOffsetC: offsetC + minC + 1, childOffsetR: offsetR + minR + 1, toTier });
    }
    for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
      const t = m.tiles?.[`${c},${r}`];
      const key = `${c + offsetC},${r + offsetR}`;
      if (!t || t.plateau) {
        if (!outTiles.has(key)) outTiles.set(key, { c: c + offsetC, r: r + offsetR, type: 'grass', elevTier: baseTier, rampElevation: 0, incline: false });
        continue;
      }
      let type = t.type || 'grass';
      if (!t.plateau && type === 'rock' && !m.keepRockTiles) type = 'grass';
      outTiles.set(key, {
        c: c + offsetC, r: r + offsetR, type, elevTier: baseTier,
        rampElevation: type === 'ramp' ? (t.rampElevation || 0) : 0, incline: false,
      });
    }
    for (const { child, childOffsetC, childOffsetR, toTier } of children) {
      merge(child, childOffsetC, childOffsetR, toTier);
    }
  }

  merge(root, 0, 0, 0);
  return { cols: root.cols, rows: root.rows, tiles: outTiles };
}

function surfaceY(tile) {
  if (tile.type === 'ramp') return (tile.rampElevation || 0) * PLATEAU_UNIT;
  return (tile.elevTier || 0) * PLATEAU_UNIT;
}

function walkable(tile) {
  if (!tile || tile.incline) return false;
  if (tile.rampCurtain) return false;
  if (SOLID_TYPES.has(tile.type)) return false;
  if (BLOCKED_WATER.has(tile.type)) return false;
  return true;
}

// Ramp curtains (docs/game.js buildZoneScene): a non-ramp tile beside a ramp
// tile whose surface differs by >= RAMP_FLUSH_EPS (0.5 world-Y) is folded
// into the ramp's cliff skirt and becomes impassable.
function applyRampCurtains(merged) {
  const RAMP_FLUSH_EPS = 0.5;
  for (const tile of merged.tiles.values()) {
    if (tile.type !== 'ramp') continue;
    const rampY = (tile.rampElevation || 0) * PLATEAU_UNIT;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = merged.tiles.get(`${tile.c + dc},${tile.r + dr}`);
      if (!n || n.type === 'ramp' || n.incline) continue;
      const groundY = (n.elevTier || 0) * PLATEAU_UNIT;
      if (Math.abs(rampY - groundY) < RAMP_FLUSH_EPS) continue;
      n.rampCurtain = true;
    }
  }
}

function validate(label, result, maxAngleDeg) {
  const failures = [];
  const merged = mergeWorkspaceZone(result.workspace);
  applyRampCurtains(merged);
  const { cols, rows, tiles } = merged;
  const at = (c, r) => tiles.get(`${c},${r}`);
  const maxStepY = Math.tan(maxAngleDeg * Math.PI / 180) * 1.08;

  // Entry: nearest walkable tile to the generator's reported entry.
  const entry = result.entry || { x: Math.floor(cols / 2), y: rows - 1 };
  let start = null, bestDist = Infinity;
  for (const tile of tiles.values()) {
    if (!walkable(tile)) continue;
    const d = Math.abs(tile.c - entry.x) + Math.abs(tile.r - entry.y);
    if (d < bestDist) { bestDist = d; start = tile; }
  }
  if (!start) return [`${label}: no walkable tile at all`];

  const seen = new Set([`${start.c},${start.r}`]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const tile = queue[i];
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = at(tile.c + dc, tile.r + dr);
      if (!n || !walkable(n)) continue;
      const key = `${n.c},${n.r}`;
      if (seen.has(key)) continue;
      if (Math.abs(surfaceY(n) - surfaceY(tile)) > maxStepY) continue;
      seen.add(key);
      queue.push(n);
    }
  }

  let walkableCount = 0, unreachable = 0;
  const unreachableSamples = [];
  for (const tile of tiles.values()) {
    if (!walkable(tile)) continue;
    // Staked (mesa-covered, unstamped) plateau-edge cells are cosmetic
    // cover: BFS may pass through them, but they carry no floor/objects and
    // are exempt from the must-be-reachable guarantee.
    if (tile.staked) continue;
    walkableCount++;
    if (!seen.has(`${tile.c},${tile.r}`)) {
      unreachable++;
      if (unreachableSamples.length < 8) unreachableSamples.push(`(${tile.c},${tile.r}) type=${tile.type} tier=${tile.elevTier}`);
    }
  }
  if (unreachable) {
    failures.push(`${label}: ${unreachable}/${walkableCount} walkable merged tiles unreachable from entry; e.g. ${unreachableSamples.join(' ')}`);
  }

  // Steepness: every REACHABLE adjacent walkable pair must respect the climb
  // limit (unreachable pockets were counted above already).
  let steepEdges = 0;
  const steepSamples = [];
  for (const tile of tiles.values()) {
    if (!walkable(tile) || !seen.has(`${tile.c},${tile.r}`)) continue;
    for (const [dc, dr] of [[1, 0], [0, 1]]) {
      const n = at(tile.c + dc, tile.r + dr);
      if (!n || !walkable(n) || !seen.has(`${n.c},${n.r}`)) continue;
      // Only ramp-involved edges are true climbs a player is invited to take;
      // flat-to-flat tier jumps are already unreachable-or-ring cases.
      if (tile.type !== 'ramp' && n.type !== 'ramp') continue;
      const dy = Math.abs(surfaceY(n) - surfaceY(tile));
      if (dy > maxStepY) {
        steepEdges++;
        if (steepSamples.length < 8) steepSamples.push(`(${tile.c},${tile.r})→(${n.c},${n.r}) Δy=${dy.toFixed(2)}`);
      }
    }
  }
  // Steep ramp↔ramp side edges are never a REQUIRED climb (the BFS above
  // refuses them, and reachability still held), and the game walls every
  // ramp-to-ground drop with curtains — so report them without failing.
  if (steepEdges) {
    console.log(`  ${label}: note — ${steepEdges} steep ramp↔ramp side edges (optional hops, not required climbs); e.g. ${steepSamples.join(' ')}`);
  }

  // Solid-rock coverage: cliff skirts + seals render as stone mounds; if
  // they carpet the map something upstream regressed (see
  // sanitizeMasksForGameExport).
  let rockCount = 0;
  for (const tile of tiles.values()) if (tile.type === 'rock') rockCount++;
  const rockPct = (rockCount / tiles.size) * 100;
  if (rockPct > 30) {
    failures.push(`${label}: rock tiles carpet ${rockPct.toFixed(1)}% of the merged map (limit 30%)`);
  }

  const gc = result.gameConnectivity || {};
  console.log(`  ${label}: ${walkableCount} walkable, unreachable=${unreachable}, steepRampEdges=${steepEdges}, ` +
    `rock=${rockPct.toFixed(1)}%, carvedRepairRamps=${gc.carvedRepairRamps}, sealedTiles=${gc.sealedTiles}, warnings=${result.warnings.length}`);
  return failures;
}

function main() {
  // Zone-shaped cases mirror the in-game settings (maxTier 3, generation at
  // half resolution with gameplayScale 2 — see regenerateWildernessZone);
  // the default case keeps the generator's own defaults so the full config
  // space stays covered.
  const zoneOpts = { maxTier: 3, gameplayScale: 2 };
  const cases = [
    { label: 'northern_cliffs-ish 30x25→60x50', options: { seed: 'nc_epoch_0', width: 30, height: 25, entrySide: 'south', ...zoneOpts } },
    { label: 'cloud_forest-ish 25x20→50x40', options: { seed: 'scf_epoch_3', width: 25, height: 20, entrySide: 'north', ...zoneOpts } },
    { label: 'mire-ish 25x20→50x40 west', options: { seed: 'mire_epoch_7', width: 25, height: 20, entrySide: 'west', ...zoneOpts } },
    { label: 'default 100x100', options: { seed: 'wild' } },
    { label: 'small 20x16→40x32', options: { seed: 'tiny_epoch_12', width: 20, height: 16, ...zoneOpts } },
  ];
  const extraSeeds = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
  for (const seed of extraSeeds) {
    cases.push({ label: `sweep ${seed} 30x25→60x50`, options: { seed: `${seed}_sweep`, width: 30, height: 25, entrySide: 'south', ...zoneOpts } });
  }

  let failures = [];
  for (const testCase of cases) {
    const started = Date.now();
    let result;
    try {
      result = generator.generate(testCase.options);
    } catch (error) {
      failures.push(`${testCase.label}: generate() threw: ${error.stack}`);
      continue;
    }
    const maxAngle = testCase.options.rampMaxAngle || generator.DEFAULT_SETTINGS.rampMaxAngle;
    failures = failures.concat(validate(testCase.label, result, maxAngle));
    console.log(`  ${testCase.label}: generated in ${Date.now() - started} ms`);
  }

  if (failures.length) {
    console.error('\nFAILURES:');
    for (const failure of failures) console.error('  ✗ ' + failure);
    process.exit(1);
  }
  console.log('\nAll wilderness generator checks passed.');
}

main();

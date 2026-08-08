(() => {
  'use strict';

  // Generic tile-grid A* pathfinder — no game.js dependencies at all.
  // Callers supply their own isWalkable(col,row) predicate (which knows
  // about tile solidity/worldObjects/building footprints/interior colliders
  // for whatever area it's checking); this module only knows grid-search
  // mechanics, never game-specific collision rules. That's what lets one
  // utility serve every mobile entity in the game (village NPCs, wildlife/
  // bandits/companions, farm livestock) even though each has a different
  // definition of "blocked" (e.g. wildlife treats water/cliffs as a speed
  // penalty, not a hard block, while village NPCs treat them as impassable).
  //
  // Diagonal moves are disallowed when they'd cut through a blocked
  // orthogonal corner (both adjacent orthogonal tiles blocked), so a
  // returned path never visually clips through a wall corner.

  function _key(c, r) { return c + ',' + r; }

  // Small binary min-heap keyed by priority (f-score) — plain array-based
  // open sets go quadratic on anything but tiny searches, and this runs
  // per-creature whenever something is stuck, not just once at load.
  class MinHeap {
    constructor() { this.items = []; }
    get size() { return this.items.length; }
    push(item, priority) {
      this.items.push({ item, priority });
      let i = this.items.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (this.items[parent].priority <= this.items[i].priority) break;
        [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
        i = parent;
      }
    }
    pop() {
      const top = this.items[0];
      const last = this.items.pop();
      if (this.items.length) {
        this.items[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = i * 2 + 2;
          let smallest = i;
          if (l < this.items.length && this.items[l].priority < this.items[smallest].priority) smallest = l;
          if (r < this.items.length && this.items[r].priority < this.items[smallest].priority) smallest = r;
          if (smallest === i) break;
          [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
          i = smallest;
        }
      }
      return top?.item;
    }
  }

  const CARDINAL_DIRS = [
    { dc: 1, dr: 0, cost: 1 }, { dc: -1, dr: 0, cost: 1 },
    { dc: 0, dr: 1, cost: 1 }, { dc: 0, dr: -1, cost: 1 },
  ];
  const DIAGONAL_DIRS = [
    { dc: 1, dr: 1, cost: Math.SQRT2 }, { dc: 1, dr: -1, cost: Math.SQRT2 },
    { dc: -1, dr: 1, cost: Math.SQRT2 }, { dc: -1, dr: -1, cost: Math.SQRT2 },
  ];
  const ALL_DIRS = CARDINAL_DIRS.concat(DIAGONAL_DIRS);

  function _reconstructPath(cameFrom, startKey, endKey) {
    const path = [];
    let k = endKey;
    while (k !== startKey) {
      const prev = cameFrom.get(k);
      const [c, r] = k.split(',').map(Number);
      path.unshift({ col: c, row: r });
      k = prev;
    }
    return path;
  }

  // Returns an array of {col,row} waypoints from (startCol,startRow) to
  // (targetCol,targetRow), EXCLUDING the start tile and INCLUDING the
  // target tile — [] if already at the target, or null if no path was
  // found (target itself unwalkable, truly unreachable, or the search
  // budget ran out first).
  //
  // opts:
  //   allowDiagonal (default true)
  //   maxNodes (default 4000) — search budget; bounds worst-case cost for
  //     an unreachable/far target instead of scanning the whole map.
  //   bounds ({minCol,maxCol,minRow,maxRow}, optional) — restricts the
  //     search to a sub-rectangle (e.g. a padded box around start/target)
  //     so a bounded local detour search can't wander off across the
  //     whole map hunting for a way around.
  function findPath(startCol, startRow, targetCol, targetRow, isWalkable, opts = {}) {
    const allowDiagonal = opts.allowDiagonal !== false;
    const maxNodes = opts.maxNodes || 4000;
    const bounds = opts.bounds || null;
    const dirs = allowDiagonal ? ALL_DIRS : CARDINAL_DIRS;
    const inBounds = (c, r) => !bounds || (c >= bounds.minCol && c <= bounds.maxCol && r >= bounds.minRow && r <= bounds.maxRow);

    if (startCol === targetCol && startRow === targetRow) return [];
    if (!isWalkable(targetCol, targetRow)) return null;

    const startKey = _key(startCol, startRow);
    const targetKey = _key(targetCol, targetRow);
    const gScore = new Map([[startKey, 0]]);
    const cameFrom = new Map();
    const closed = new Set();
    const open = new MinHeap();
    const heuristic = (c, r) => Math.hypot(targetCol - c, targetRow - r);
    open.push({ c: startCol, r: startRow, key: startKey }, heuristic(startCol, startRow));

    let expanded = 0;
    while (open.size && expanded < maxNodes) {
      const cur = open.pop();
      if (closed.has(cur.key)) continue;
      closed.add(cur.key);
      expanded++;
      if (cur.key === targetKey) return _reconstructPath(cameFrom, startKey, targetKey);

      for (const d of dirs) {
        const nc = cur.c + d.dc, nr = cur.r + d.dr;
        if (!inBounds(nc, nr)) continue;
        const nk = _key(nc, nr);
        if (closed.has(nk)) continue;
        if (!isWalkable(nc, nr)) continue;
        // Prevent cutting a diagonal through a blocked orthogonal corner.
        if (d.dc !== 0 && d.dr !== 0) {
          if (!isWalkable(cur.c + d.dc, cur.r) || !isWalkable(cur.c, cur.r + d.dr)) continue;
        }
        const tentativeG = (gScore.get(cur.key) ?? Infinity) + d.cost;
        if (tentativeG < (gScore.get(nk) ?? Infinity)) {
          gScore.set(nk, tentativeG);
          cameFrom.set(nk, cur.key);
          open.push({ c: nc, r: nr, key: nk }, tentativeG + heuristic(nc, nr));
        }
      }
    }
    return null; // unreachable within budget
  }

  // Convenience for callers that want to cap the search to a local box
  // around start/target instead of the whole map — padding is in tiles.
  function boxAround(startCol, startRow, targetCol, targetRow, padding) {
    return {
      minCol: Math.min(startCol, targetCol) - padding, maxCol: Math.max(startCol, targetCol) + padding,
      minRow: Math.min(startRow, targetRow) - padding, maxRow: Math.max(startRow, targetRow) + padding,
    };
  }

  window.TilePathfinding = { findPath, boxAround };
})();

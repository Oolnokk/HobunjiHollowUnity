// PlayerTileEvents — one authoritative, allocation-free-on-stationary-frames
// player tile transition signal, sampled by WildernessChunks' existing game-loop owner.
// Only subscribe static-world discovery/candidate caches. Moving actors, combat,
// animation and continuous proximity/attenuation must keep their live update paths.
(() => {
  'use strict';

  const listeners = new Set(); // Holds consumers that invalidate static spatial caches on tile/area changes.
  let current = null; // Last valid player tile; reset after missing/invalid position data.
  let lastEvent = null; // Exposed for mobile debug snapshots without needing browser DevTools.
  let transitions = 0; // Counts transitions emitted since page load.
  let subscriberErrors = 0; // Counts isolated listener failures without breaking movement.

  function update(area, playerX, playerY, tileSize) {
    if (!Number.isFinite(playerX) || !Number.isFinite(playerY) ||
        !Number.isFinite(tileSize) || tileSize <= 0) {
      current = null; // Re-seed on the next valid sample, including after scene teardown.
      return false;
    }
    const col = Math.floor(playerX / tileSize); // Tracks the game's pixel-space X coordinate as an integer tile.
    const row = Math.floor(playerY / tileSize); // Tracks the game's pixel-space Y (world Z) coordinate as an integer tile.
    const mapId = String(area ?? ''); // Area identity prevents same-coordinate transitions being skipped across maps.
    if (current && current.area === mapId && current.col === col && current.row === row) return false;
    const previous = current; // Retained as the from-tile in this event only.
    const next = Object.freeze({ area: mapId, col, row }); // Immutable tile snapshot shared with all listeners.
    const reason = !previous ? 'initial' : previous.area !== mapId ? 'area' : 'tile'; // Differentiates spawn/teleport/area changes for subscribers.
    const event = Object.freeze({ from: previous, to: next, reason }); // Emitted exactly once per observed tile change.
    current = next;
    lastEvent = event;
    transitions++;
    for (const listener of [...listeners]) {
      try { listener(event); }
      catch (error) {
        subscriberErrors++;
        console.error('[player-tile-events] subscriber failed', error);
      }
    }
    return true;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('PlayerTileEvents.subscribe expects a function');
    listeners.add(listener);
    return () => listeners.delete(listener); // Releases subscriptions without requiring a global reset.
  }

  function reset() { current = null; } // Called on invalid player state; initial detection resumes on re-entry.

  function snapshot() {
    return { current, lastEvent, transitions, subscribers: listeners.size, subscriberErrors };
  }

  window.PlayerTileEvents = Object.freeze({ update, subscribe, reset, current: () => current, snapshot });
})();

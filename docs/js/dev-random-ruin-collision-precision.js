// Pixel Probe diagnostics for the Random Test Ruin's shared tile occupancy.
// The former object-AABB precision filter is intentionally gone: collision and
// Map now read the same versioned red/green/blue tile snapshot.
(() => {
  'use strict';

  const MAP_ID = 'map_i_dev_random_ruin';
  const SECTION = '=== Random Test Ruin tile occupancy diagnostics ===';
  const GridTileAccessors = window.GridTileAccessors;
  const DS = window.DynamicSurfaces;
  if (!GridTileAccessors || !DS) return;

  function inRuin() {
    return GridTileAccessors.getCurrentArea?.() === MAP_ID;
  }

  function playerWorldPosition() {
    const scene = GridTileAccessors.getActiveScene?.();
    if (!scene) return null;
    let player = scene.getObjectByName?.('player_root') || scene.getObjectByName?.('player');
    if (!player) scene.traverse?.(object => {
      if (!player && (object.userData?.isPlayer || object.userData?.playerCharacter)) player = object;
    });
    player?.updateWorldMatrix?.(true, false);
    const elements = player?.matrixWorld?.elements;
    if (!elements?.length) return null;
    return { x:Number(elements[12]) || 0, z:Number(elements[14]) || 0 };
  }

  function nearbyTiles(sourceSnapshot, center, distance = 2) {
    if (!center) return [];
    const centerCol = Math.floor(center.x), centerRow = Math.floor(center.z);
    return sourceSnapshot.blocked
      .map(tileKey => {
        const [col, row] = tileKey.split(',').map(Number);
        return { tile:tileKey, distance:Math.max(Math.abs(col - centerCol), Math.abs(row - centerRow)), sources:sourceSnapshot.sources[tileKey] || [] };
      })
      .filter(entry => entry.distance <= distance)
      .sort((a, b) => a.distance - b.distance || a.tile.localeCompare(b.tile));
  }

  function snapshot() {
    if (!inRuin()) return { active:false };
    const occupancy = window.DevRandomRuin?.getOccupancySnapshot?.()
      || window.DevRandomRuinTileOccupancy?.getSnapshot?.();
    if (!occupancy) return { active:true, occupancy:null };
    const player = playerWorldPosition();
    const playerTile = player ? `${Math.floor(player.x)},${Math.floor(player.z)}` : null;
    return {
      active:true,
      revision:occupancy.revision,
      player,
      playerTile,
      blockedAtPlayer:playerTile ? occupancy.sources[playerTile] || [] : [],
      nearby:nearbyTiles(occupancy, player),
      counts:{ blocked:occupancy.blocked.length, causes:occupancy.causes.length, effects:occupancy.effects.length },
      aggregateBlockers:(DS.debugSnapshot?.().blockers || []).filter(record => record.id === 'devruin-tile-occupancy').length,
    };
  }

  function appendPixelProbeDiagnostics() {
    const report = document.getElementById('debugProbeResult');
    const text = report?.textContent || '';
    if (!report || !text.startsWith('Pixel Probe report') || text.includes(SECTION) || !inRuin()) return;
    const data = snapshot();
    const lines = ['', SECTION];
    if (!data.occupancy && data.revision == null) {
      lines.push('Shared occupancy snapshot: unavailable');
    } else {
      lines.push(`Snapshot revision: ${data.revision} aggregateGameplayBlockers=${data.aggregateBlockers}`);
      lines.push(`Tiles: redBlocked=${data.counts.blocked} greenActivators=${data.counts.causes} blueMechanisms=${data.counts.effects}`);
      lines.push(`Player: ${data.player ? `${data.player.x.toFixed(3)},${data.player.z.toFixed(3)}` : 'unavailable'} tile=${data.playerTile || 'unknown'} sources=${data.blockedAtPlayer.join(',') || 'none'}`);
      lines.push(`Nearby red tiles: ${data.nearby.length ? data.nearby.map(entry => `${entry.tile}[${entry.sources.join(',')}]`).join(' | ') : 'none within 2 tiles'}`);
    }
    report.textContent = text + lines.join('\n');
  }

  let observer = null; // Watches the existing Pixel Probe report without adding another debug UI.
  function installProbeObserver() {
    const report = document.getElementById('debugProbeResult');
    if (!report || observer) return false;
    observer = new MutationObserver(appendPixelProbeDiagnostics);
    observer.observe(report, { childList:true, subtree:true, characterData:true });
    appendPixelProbeDiagnostics();
    return true;
  }

  if (!installProbeObserver()) {
    const timer = setInterval(() => { if (installProbeObserver()) clearInterval(timer); }, 250);
    setTimeout(() => clearInterval(timer), 15000);
  }

  window.DevRandomRuinCollisionPrecision = Object.freeze({
    snapshot,
    appendPixelProbeDiagnostics,
  });
})();

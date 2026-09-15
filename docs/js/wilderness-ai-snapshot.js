(() => {
  'use strict';

  // One button dumps a world-wide text snapshot of Porakaneki camp residents
  // plus the den- and nest-spawned wildlife instantiated in the live runtime.
  // Porakaneki camps retain abstract off-radius agents world-wide; wildlife
  // packs do not — WildlifeSpawn materializes them only for the active zone.
  // Keeping those scopes explicit prevents an empty section from being
  // misread as "every den and nest in the world is empty."
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  const SNAPSHOT_GUIDE = `HOBUNJI WILDERNESS AI SNAPSHOT -- interpretation guide for AI review
One frozen instant of all Porakaneki camp residents world-wide plus currently instantiated den- and nest-spawned wildlife. Porakaneki camps keep abstract off-radius agents, so their section spans all generated wilderness zones. WILDLIFE is different: it reads live hostileObjects entries carrying a denKey or nestTreeKey, and those packs are normally instantiated only for the active wilderness zone. Therefore an empty WILDLIFE section does NOT mean every den or nest world-wide is empty.
PORAKANEKI lines: "camp=<zoneId>/<campId> kind=<small|chief> ... sleeping=<n>/<residents>" is one camp; each indented "res#<index>" line is one generated resident. act=<activity> is sleep|hunt|wander|socialize|camp|investigate. pos=(col,row) is the planner position. dist is tile distance to the player when in the active zone. lod<=N is the current materialization threshold: normally the enter radius, or the wider release radius while already live. full=1 means that distance gate currently requests full simulation. mat=1 means a real humanoid entity exists; vis=1 means its mesh is visible; reg=1 means that exact entity is still registered in hostileObjects. state is the shared hostile-loop state. planner=1 means neutral Porakaneki target planning owns its destination while the shared hostile loop owns locomotion/rendering. sim=(x,y) is the live entity position, render=(x,y) is the avatar root position, and rd is their tile-space render delta; a large/stuck rd identifies a simulation/render handoff failure directly.
WILDLIFE header: activeArea=<area> is the player's current area, instantiatedWildlife=<n> counts live runtime creatures carrying a denKey or nestTreeKey, denCreatures/nestCreatures split those sources, and scope=active-runtime is a reminder that off-zone populations are not represented here. Creature lines report source/species/state/mode/tile/home; mode is whichever per-species schedule-AI field is currently set (_cfDrenkirra.mode for cloud-forest drenkirra, _grehlrForage.mode for grehlr, otherwise falls back to state).`;

  function activeArea() {
    return window.GridTileAccessors?.getCurrentArea?.() || '-';
  }

  function pointText(point) {
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? `(${point.x},${point.y})` : '-';
  }

  function porakanekiSection() {
    const debug = window.PorakanekiCamps?.debugSnapshot?.();
    if (!debug) return 'PORAKANEKI: PorakanekiCamps not ready.';
    const player = debug.playerTile ? `(${debug.playerTile.col},${debug.playerTile.row})` : '-';
    const lines = [`PORAKANEKI season=${debug.season} chiefZone=${debug.chiefZoneId || '-'} favor=${debug.favor ?? '-'} player=${player} lod=${debug.fullSimulationRadiusTiles ?? '-'}/${debug.fullSimulationReleaseRadiusTiles ?? '-'}`];
    for (const [zoneId, zone] of Object.entries(debug.zones || {})) {
      for (const camp of zone.camps || []) {
        const sleeping = camp.hunters.filter(h => h.activity === 'sleep').length;
        lines.push(`camp=${zoneId}/${camp.id} kind=${camp.kind} center=(${camp.center.col},${camp.center.row}) sleeping=${sleeping}/${camp.hunters.length}`);
        for (const h of camp.hunters) {
          const dist = h.distanceToPlayer == null ? '-' : h.distanceToPlayer;
          const state = h.entityState || '-';
          const rd = h.renderDelta == null ? '-' : h.renderDelta;
          lines.push(`  res#${h.index} act=${h.activity} pos=(${h.x},${h.y}) chunk=(${h.chunk.x},${h.chunk.y}) dist=${dist} lod<=${h.lodRadius ?? '-'} full=${h.fullSimulation ? 1 : 0} mat=${h.materialized ? 1 : 0} vis=${h.visible ? 1 : 0} reg=${h.registered ? 1 : 0} state=${state} planner=${h.plannerControlled ? 1 : 0} sim=${pointText(h.simPosition)} render=${pointText(h.renderPosition)} rd=${rd}`);
        }
      }
    }
    const chiefWalker = deps.npcWalkers.find(w => w.rec?.id === 'porakaneki_chief');
    if (chiefWalker) {
      const sleepingHour = window.PorakanekiCamps?.__test?.isSleepingHour?.();
      lines.push(`CHIEF area=${chiefWalker.area || '-'} pos=(${Math.round(chiefWalker.root.position.x / deps.TILE)},${Math.round(chiefWalker.root.position.z / deps.TILE)}) sleepHourNow=${sleepingHour ? 1 : 0}`);
    }
    return lines.join('\n');
  }

  function wildlifeSection() {
    const wildlife = [];
    let denCreatureCount = 0; // Used to keep ordinary underground-den population visible separately from Drenkirra nest families.
    let nestCreatureCount = 0; // Used to expose Drenkirra that the former denKey-only snapshot silently omitted.
    for (const c of deps.hostileObjects) {
      if (!c.denKey && !c.nestTreeKey) continue;
      wildlife.push(c);
      if (c.denKey) denCreatureCount++;
      if (c.nestTreeKey) nestCreatureCount++;
    }
    const lines = [`WILDLIFE activeArea=${activeArea()} instantiatedWildlife=${wildlife.length} denCreatures=${denCreatureCount} nestCreatures=${nestCreatureCount} scope=active-runtime`];
    for (const c of wildlife) {
      const mode = c._cfDrenkirra?.mode || c._grehlrForage?.mode || c.state;
      const source = c.nestTreeKey ? `nest:${c.nestTreeKey}` : `den:${c.denKey}`; // Used to make unexpectedly dense families traceable to their exact nest or den on mobile.
      lines.push(`id=${c.id} source=${source} species=${c.creatureKey} area=${c.areaId} state=${c.state} mode=${mode} tile=(${Math.round(c.x / deps.TILE)},${Math.round(c.y / deps.TILE)}) home=(${Math.round(c.homeX / deps.TILE)},${Math.round(c.homeY / deps.TILE)})`);
    }
    if (!wildlife.length) lines.push('(no den- or nest-spawned creatures currently instantiated; off-zone populations are not represented in hostileObjects)');
    return lines.join('\n');
  }

  function captureSnapshotText() {
    const hour = Number(window.CalendarSystem?.getHour?.());
    const header = `--- WILDERNESS AI SNAPSHOT t=${new Date().toISOString()} gameHour=${Number.isFinite(hour) ? hour.toFixed(2) : '-'} activeArea=${activeArea()} ---`;
    return [header, '', porakanekiSection(), '', wildlifeSection()].join('\n');
  }

  async function copySnapshot() {
    const text = [SNAPSHOT_GUIDE, '', captureSnapshotText()].join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      deps.showToast('Wilderness AI snapshot copied.', true);
    } catch (e) {
      console.log(text);
      deps.showToast('Clipboard blocked — snapshot printed to console instead (check devtools).', false);
    }
  }

  function initWithBinding(injectedDeps) {
    init(injectedDeps);
    document.getElementById('devWildernessAiSnapshotBtn')?.addEventListener('click', copySnapshot);
  }

  window.WildernessAiSnapshot = {
    init: initWithBinding,
    captureSnapshotText,
  };
})();

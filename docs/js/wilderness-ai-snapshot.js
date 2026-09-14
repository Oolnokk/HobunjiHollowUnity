(() => {
  'use strict';

  // One button dumps a world-wide text snapshot of Porakaneki camp residents
  // plus the den wildlife that is actually instantiated in the live runtime.
  // Porakaneki camps retain abstract off-chunk agents world-wide; den packs do
  // not — WildlifeSpawn deliberately materializes them only for the currently
  // active wilderness zone. Keeping those scopes explicit prevents an empty
  // wildlife section from being misread as "every den in the world is empty."
  // Unlike bandit-combat-log.js's ring buffer (built for combat state changing
  // over seconds), these schedules change over in-game hours, so this takes one
  // fresh snapshot per click; take another later and diff the two.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  const SNAPSHOT_GUIDE = `HOBUNJI WILDERNESS AI SNAPSHOT -- interpretation guide for AI review
One frozen instant of all Porakaneki camp residents world-wide plus currently instantiated den wildlife. Porakaneki camps keep abstract off-chunk agents, so their section spans all generated wilderness zones. WILDLIFE is different: it reads live hostileObjects entries carrying a denKey, and den packs are normally instantiated only for the active wilderness zone. Therefore an empty WILDLIFE section does NOT mean every den world-wide is empty. Take another snapshot later (same session, hour advanced) and diff the two to confirm residents actually wake up, leave sleep=1, and start hunt/wander/socialize instead of staying camped all day.
PORAKANEKI lines: "camp=<zoneId>/<campId> kind=<small|chief> ... sleeping=<n>/<residents>" is one camp; each indented "res#<index>" line under it is one generated resident: act=<activity> is sleep|hunt|wander|socialize|camp|investigate (see config/porakaneki-camp.json's schedule.sleepStartHour/wakeHour for the shared night window), pos=(col,row), chunk=(x,y), full=1 if sharing the player's chunk and fully simulated (else an abstract off-chunk agent updated every few seconds), mat=1 if materialized as a real entity, vis=1 if its mesh is currently visible. The CHIEF line is the one named NPC (porakaneki_chief), a real scheduled walker rather than a generated resident -- it reports its own position/area and whether the current hour falls in that same night-sleep window.
WILDLIFE header: activeArea=<area> is the player's current area, instantiatedDenCreatures=<n> is the number of live runtime creatures found with a denKey, and scope=active-runtime is a reminder that off-zone dens are not represented here. Creature lines report species/state/mode/tile/home; mode is whichever per-species schedule-AI field is currently set (_cfDrenkirra.mode for cloud-forest drenkirra, _grehlrForage.mode for grehlr, otherwise falls back to state). sleeping/eating/fishing/seeking* are the interesting ones to watch flip during the day.`;

  function activeArea() {
    return window.GridTileAccessors?.getCurrentArea?.() || '-';
  }

  function porakanekiSection() {
    const debug = window.PorakanekiCamps?.debugSnapshot?.();
    if (!debug) return 'PORAKANEKI: PorakanekiCamps not ready.';
    const lines = [`PORAKANEKI season=${debug.season} chiefZone=${debug.chiefZoneId || '-'} favor=${debug.favor ?? '-'}`];
    for (const [zoneId, zone] of Object.entries(debug.zones || {})) {
      for (const camp of zone.camps || []) {
        const sleeping = camp.hunters.filter(h => h.activity === 'sleep').length;
        lines.push(`camp=${zoneId}/${camp.id} kind=${camp.kind} center=(${camp.center.col},${camp.center.row}) sleeping=${sleeping}/${camp.hunters.length}`);
        for (const h of camp.hunters) {
          lines.push(`  res#${h.index} act=${h.activity} pos=(${h.x},${h.y}) chunk=(${h.chunk.x},${h.chunk.y}) full=${h.fullSimulation ? 1 : 0} mat=${h.materialized ? 1 : 0} vis=${h.visible ? 1 : 0}`);
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
    const denCreatures = [];
    for (const c of deps.hostileObjects) {
      if (c.denKey) denCreatures.push(c); // Ordinary farm/spawn creatures aren't den-scheduled; omit them here.
    }
    const lines = [`WILDLIFE activeArea=${activeArea()} instantiatedDenCreatures=${denCreatures.length} scope=active-runtime`];
    for (const c of denCreatures) {
      const mode = c._cfDrenkirra?.mode || c._grehlrForage?.mode || c.state;
      lines.push(`id=${c.id} species=${c.creatureKey} area=${c.areaId} state=${c.state} mode=${mode} tile=(${Math.round(c.x / deps.TILE)},${Math.round(c.y / deps.TILE)}) home=(${Math.round(c.homeX / deps.TILE)},${Math.round(c.homeY / deps.TILE)})`);
    }
    if (!denCreatures.length) lines.push('(no den-spawned creatures currently instantiated; off-zone dens are not represented in hostileObjects)');
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

// Feast of the Five Blossoms: an annual, seven-day five-locale riddle hunt.
// Riddle creation is intentionally delegated to the reusable LocaleRiddleGenerator.
(() => {
  'use strict';
  const PREFIX = 'five_blossoms_wilderness_hunt:'; // Each civil year gets a separate saved quest record.
  const TITLE = 'The Five Wandering Blossoms'; // TasksPanel and completion toasts use this player-facing quest name.
  const BLOSSOMS = Object.freeze([
    { id: 'cyan', name: 'Cyan Blossom', color: '#00ffff', zoneId: 'map_northern_cliffs', paletteIndex: 0 },
    { id: 'white', name: 'White Blossom', color: '#ffffff', zoneId: 'map_western_slope', paletteIndex: 2 },
    { id: 'gold', name: 'Golden Blossom', color: '#ffbf00', zoneId: 'map_eastern_mire', paletteIndex: 3 },
    { id: 'amber', name: 'Amber Blossom', color: '#ff8000', zoneId: 'map_southern_cloud_forest', paletteIndex: 1 },
    { id: 'rose', name: 'Rose Blossom', color: '#ffb3b3', zoneId: 'map_southern_cloud_forest', paletteIndex: 4 }
  ].map(item => Object.freeze({ ...item, localeId: 'locale_five_blossoms_' + item.id }))); // Five authored locale files; two share the southern forest.
  let mapDeps = null; // WildernessMap supplies canonical member/world's generated zone layouts and player tile scale.
  let questDeps = null; // TasksPanel supplies the same member save authority used by other story quests.
  let unsubTile = null; // Released on world/character reinit so duplicate listeners cannot award a find twice.
  let visibleScene = null; // Scene owner of the five-tree renderer; replaced cleanly on zone transitions.
  let visibleZone = ''; // Active map ID used to avoid scanning inactive wilderness zones per frame.
  let visibleTrees = new Map(); // Per-locale Three.js roots attached to the currently active scene.
  let calendarKey = ''; // Day/year/Shift change gate; ordinary animation frames do not touch quest saves.
  let retrySaveAfter = 0; // A failed member write retries on a later calendar tick, rather than disabling the quest for the whole festival.
  let lastStatus = ''; // Visible on mobile to explain absent locales, failed saves, or withheld clues.
  let lastGenerated = null; // Debug snapshot describes which final terrain evidence made it into the clue.

  function year() { return Number(window.CalendarSystem?.aotYearNumber?.()); }
  function active() { return window.FestivalCalendar?.current?.()?.id === 'five_blossoms'; }
  function key(y = year()) { return PREFIX + y; }
  function records() { return questDeps?.getQuestProgress?.() || window.QuestProgressStore?.snapshot?.() || {}; }
  function state() { return records()[key()]; }
  function targetFor(found = []) { return BLOSSOMS.find(blossom => !found.includes(blossom.id)) || null; } // The primary riddle is ordered, but opportunistic discoveries are credited in any order.
  function zoneLayout(id) { return mapDeps?._zoneLayouts?.get?.(id) || null; }
  function localeFor(blossom) {
    return zoneLayout(blossom?.zoneId)?.localeInstances?.find?.(entry => entry.localeId === blossom.localeId) || null;
  }
  function blossomColor(blossom) {
    return window.FestivalProps?.blossomWindowSwatches?.[blossom.paletteIndex]?.color || blossom.color; // Temple overpass swatches remain the colour authority even if festival furniture is retinted later.
  }
  function statusFor(blossom) {
    const layout = zoneLayout(blossom?.zoneId); // The same generated layout is consulted for both visual placement and factual clue selection.
    const locale = localeFor(blossom);
    return { layout, locale, generated: !!layout, stamped: !!locale };
  }
  function clueFor(blossom) {
    const { layout, locale } = statusFor(blossom);
    if (!locale || !layout) return { ok: false, reason: 'The blossom locale is not available in this generated wilderness yet; check the mobile placement diagnostics.' };
    return window.LocaleRiddleGenerator?.generate?.({
      zoneId: blossom.zoneId, layout, instance: locale, targetObjectKey: 'blossom-tree', targetName: blossom.name, targetKind: 'blossom',
      landmarks: [
        ...(window.WildernessLandmarkScenery?.landmarksFor?.(blossom.zoneId, layout) || []),
        ...(window.CaveSiteSystem?.outdoorPuzzleSitesForZone?.(blossom.zoneId) || []).map(site => ({
          name:'a cliff door', point:{col:Number(site.mouthAnchor?.x),row:Number(site.mouthAnchor?.y)},source:'registered-cliff-door'
        }))
      ],
      seed: [mapDeps?.tothalWorldId?.() || 'world', mapDeps?.currentTothalYear?.() || 'shift', blossom.id, locale.x, locale.y].join(':')
    }) || { ok: false, reason: 'LocaleRiddleGenerator is not loaded' };
  }
  function descriptor(founds = [], shift = null) {
    const remaining = targetFor(founds); // The first undiscovered blossom supplies the active clue without invalidating other discoveries.
    if (!remaining) return { kind: 'story', provider: 'blossomHunt', icon: '🌸', title: TITLE,
      objective: 'All five blossoms were found before the feast ended!', detail: 'The wilderness remembers your footsteps.',
      found: founds.slice(0, 5), year: year(), shiftYear: shift };
    const clue = clueFor(remaining);
    lastGenerated = clue;
    lastStatus = clue.ok ? `Generated clue for ${remaining.id} from ${clue.facts.length} verified descriptors` : clue.reason;
    return {
      kind: 'story', provider: 'blossomHunt', icon: '🌸', title: TITLE,
      npcName: 'The Feast of the Five Blossoms',
      objective: `Find the ${remaining.name} Tree (${founds.length}/5). The search ends when the festival week ends.`,
      detail: clue.ok ? clue.text : `Seek the ${remaining.name} in ${window.LocaleRiddleGenerator?.ZONES?.[remaining.zoneId] || remaining.zoneId}. ${clue.reason}`,
      found: founds.slice(0, 5), year: year(), shiftYear: shift, target: remaining.id
    };
  }
  function write(status, progress) {
    const result = window.QuestProgressStore?.setStatus?.(key(), status, progress);
    if (result === false || result == null) {
      calendarKey = ''; // A transient save failure must not suppress the next year's start/expiry.
      retrySaveAfter = Date.now() + 5000; // Prevent expensive repeated disk writes on every 200ms festival tick.
      lastStatus = 'Member save rejected the blossom quest update';
      window.__farmLog?.('[blossom-hunt] ' + lastStatus, 'warn');
      return false;
    }
    return true;
  }
  function start() {
    if (!questDeps || !mapDeps || !active() || !Number.isInteger(year()) || year() < 0) return;
    if (state()) return; // Completion and expiry records are annual; never restart the same festival year.
    const shift = mapDeps.currentTothalYear?.() ?? null;
    if (write('active', descriptor([], shift))) {
      lastStatus = 'Quest begun during the seven-day feast';
      mapDeps.showToast?.('New quest: The Five Wandering Blossoms. Read the first riddle in your Quest Log.', true);
    }
  }
  function expireOutdated() {
    const all = records(); // A small saved quest dictionary, inspected only on calendar/Shift changes.
    for (const [questId, record] of Object.entries(all)) {
      if (!questId.startsWith(PREFIX) || record?.status !== 'active') continue;
      if (active() && questId === key()) continue;
      const saved = window.QuestProgressStore?.setStatus?.(questId, 'expired', {
        objective: 'The Feast of the Five Blossoms has ended.', detail: 'Return next year for a new set of riddles.', hidden: true
      });
      if (saved) lastStatus = 'Unfinished annual hunt expired at the festival boundary';
      else { calendarKey = ''; retrySaveAfter = Date.now() + 5000; } // Failed expiry is retried rather than resurrecting the old active quest forever.
    }
  }
  function syncCalendar() {
    if (!questDeps || !mapDeps) return;
    const civilYear = year(); // Used as a readiness gate so an unloaded calendar cannot accidentally expire a saved annual quest.
    if (!Number.isSafeInteger(civilYear) || window.CalendarSystem?.isInitialized?.() === false) return;
    const shift = mapDeps.currentTothalYear?.() ?? 'unknown';
    const newKey = [civilYear, active() ? 'festival' : 'ordinary', shift].join(':');
    if (newKey === calendarKey || Date.now() < retrySaveAfter) return;
    retrySaveAfter = 0;
    calendarKey = newKey;
    expireOutdated();
    if (active()) start();
    const live = state();
    if (active() && live?.status === 'active' && String(live.progress?.shiftYear ?? '') !== String(shift ?? '')) {
      write('active', descriptor(Array.isArray(live.progress.found) ? live.progress.found : [], shift)); // Re-roll a clue after a Shift: old terrain facts cannot survive reshuffling.
    }
  }
  function clearTrees() {
    for (const node of visibleTrees.values()) node.parent?.remove?.(node);
    visibleTrees.clear();
    visibleScene = null;
    visibleZone = '';
  }
  function buildVisibleTrees() {
    const area = mapDeps?.getCurrentArea?.();
    if (!BLOSSOMS.some(item => item.zoneId === area)) { if (visibleTrees.size) clearTrees(); return; } // Blossom locales exist all year; only collecting them is festival-limited.
    const scene = window.GridTileAccessors?.getActiveScene?.();
    if (!scene) return;
    if (visibleScene !== scene || visibleZone !== area) clearTrees();
    visibleScene = scene; visibleZone = area;
    for (const blossom of BLOSSOMS) {
      if (blossom.zoneId !== area || visibleTrees.has(blossom.localeId)) continue;
      const instance = localeFor(blossom);
      const foliage = window.FoliageGenerator?.buildPottedBlossomTreeMesh;
      if (!instance || !foliage) { lastStatus = 'Blossom scene missing ' + blossom.localeId; continue; }
      const p = window.LocaleRiddleGenerator?.positionOf?.(instance, 'blossom-tree');
      if (!Number.isFinite(p?.col) || !Number.isFinite(p?.row)) continue;
      const color = blossomColor(blossom); // Never duplicate the temple's live colour-fill palette in an event renderer.
      const tree = foliage(blossom.localeId + ':' + p.col + ':' + p.row, color); // Public builder reuses cached Three.js geometry/materials; one cheap instance per active scene.
      if (!tree) continue;
      tree.scale.multiplyScalar(36); // A ~6-unit flowering landmark after the tabletop preset's quarter scale.
      tree.traverse?.(child => { if (child.geometry) child.userData.festivalSharedFoliage = true; }); // Zone teardown must not dispose the foliage generator's globally shared GPU buffers.
      tree.name = blossom.localeId;
      tree.userData.festivalBlossomHunt = { id: blossom.id, zoneId: area, color, localeId: blossom.localeId };
      const tilePixels = Number(mapDeps?.TILE) || 64; // ClimbSystem's worldSurfaceY sampler takes movement/pixel units, not map tiles.
      const rawHeight = window.ClimbSystem?.groundYAt?.((p.col + .5) * tilePixels, (p.row + .5) * tilePixels); // Sample the actual highland/mire floor beneath the blossom.
      const height = Number(rawHeight); // Surface height includes the generated plateau when available.
      tree.position.set(p.col + .5, rawHeight != null && Number.isFinite(height) ? height : 0, p.row + .5);
      scene.add(tree);
      visibleTrees.set(blossom.localeId, tree);
    }
  }
  function collect(event) {
    if (!active()) return;
    const live = state();
    if (live?.status !== 'active' || !event?.to) return;
    const found = Array.isArray(live.progress?.found) ? live.progress.found : [];
    const target = BLOSSOMS.find(blossom => {
      if (blossom.zoneId !== event.to.area || found.includes(blossom.id)) return false;
      const locale = localeFor(blossom); // Every physical tree can be discovered once even if its riddle is not currently selected.
      const p = locale && window.LocaleRiddleGenerator?.positionOf?.(locale, 'blossom-tree');
      return Number.isFinite(p?.col) && Number.isFinite(p?.row)
        && Math.hypot(event.to.col - p.col, event.to.row - p.row) <= 3;
    });
    if (!target) return;
    const next = [...found, target.id];
    const isDone = next.length === BLOSSOMS.length;
    if (!write(isDone ? 'completed' : 'active', descriptor(next, mapDeps.currentTothalYear?.() ?? null))) return;
    mapDeps.showToast?.(isDone ? 'All five blossoms found! You completed the festival riddle hunt.' : `${target.name} found! Your next riddle awaits in the Quest Log (${next.length}/5).`, true);
    lastStatus = isDone ? 'Completed all five trees during the feast' : `Found ${target.id}: ${next.length}/5`;
  }
  function onTile(event) {
    syncCalendar();
    buildVisibleTrees();
    collect(event); // Run only on a changed player tile/area; no per-frame distance scans.
  }
  function init(deps) {
    mapDeps = deps; calendarKey = ''; retrySaveAfter = 0;
    unsubTile?.();
    unsubTile = window.PlayerTileEvents?.subscribe?.(onTile) || null;
    clearTrees();
    window.DevCompanion?.registerStateProvider?.('fiveBlossomsHunt', debugSnapshot);
  }
  function bindQuestDeps(deps) { questDeps = deps; calendarKey = ''; retrySaveAfter = 0; } // TasksPanel's save/getQuestProgress callbacks provide the canonical persistence.
  function update() {
    syncCalendar();
    buildVisibleTrees(); // Persistent authored tree landmarks remain visible when their annual hunt is inactive.
  }
  function menuStatus() {
    const live = state();
    const inProgress = live?.status === 'active' && active();
    const upcoming = targetFor(Array.isArray(live?.progress?.found) ? live.progress.found : []); // Already-found out-of-order trees never reappear as pending riddles.
    const liveClue = inProgress && upcoming ? clueFor(upcoming) : null;
    return { active: inProgress, ready: false, objective: live?.progress?.objective || '',
      statusText: inProgress ? `${live.progress?.found?.length || 0} of 5 discovered — festival time is limited.` : null,
      detail: inProgress && upcoming ? (liveClue?.ok ? liveClue.text : `Seek ${upcoming.name} in ${window.LocaleRiddleGenerator?.ZONES?.[upcoming.zoneId] || upcoming.zoneId}. ${liveClue?.reason || 'Clue unavailable.'}`) : live?.progress?.detail || '' }; // Never show last Shift's obsolete terrain clue after regeneration.
  }
  function debugSnapshot() {
    const live = state();
    return {
      activeFestival: active(), questId: key(), status: live?.status || 'not_started', found: live?.progress?.found || [],
      target: live?.progress?.target || null, currentZone: mapDeps?.getCurrentArea?.(),
      present: BLOSSOMS.map(item => ({ id: item.id, zoneId: item.zoneId, stamped: !!localeFor(item) })),
      displayedTrees: [...visibleTrees.keys()], lastStatus, retrySaveAfter,
      clueEvidence: lastGenerated?.evidence || null, clueValid: lastGenerated?.ok || false
    };
  }
  window.FestivalBlossomHunt = Object.freeze({ init, bindQuestDeps, update, menuStatus, debugSnapshot, BLOSSOMS, __test: { descriptor, clueFor, collect, syncCalendar } });
})();

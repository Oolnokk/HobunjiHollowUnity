// Feast of the Five Blossoms: an annual, seven-day five-locale riddle hunt.
// Riddle creation is intentionally delegated to the reusable LocaleRiddleGenerator.
(() => {
  'use strict';
  const PREFIX = 'five_blossoms_wilderness_hunt:'; // Each civil year gets a separate saved quest record.
  const TITLE = 'The Five Wandering Blossoms'; // TasksPanel and completion toasts use this player-facing quest name.
  const BLOSSOMS = Object.freeze([
    { id: 'cyan', name: 'Cyan Blossom', color: '#00ffff', zoneId: 'map_northern_cliffs' },
    { id: 'white', name: 'White Blossom', color: '#ffffff', zoneId: 'map_western_slope' },
    { id: 'gold', name: 'Golden Blossom', color: '#ffbf00', zoneId: 'map_eastern_mire' },
    { id: 'amber', name: 'Amber Blossom', color: '#ff8000', zoneId: 'map_southern_cloud_forest' },
    { id: 'rose', name: 'Rose Blossom', color: '#ffb3b3', zoneId: 'map_southern_cloud_forest' }
  ].map(item => Object.freeze({ ...item, localeId: 'locale_five_blossoms_' + item.id }))); // Five authored locale files; two share the southern forest.
  let mapDeps = null; // WildernessMap supplies canonical member/world's generated zone layouts and player tile scale.
  let questDeps = null; // TasksPanel supplies the same member save authority used by other story quests.
  let unsubTile = null; // Released on world/character reinit so duplicate listeners cannot award a find twice.
  let visibleScene = null; // Scene owner of the five-tree renderer; replaced cleanly on zone transitions.
  let visibleZone = ''; // Active map ID used to avoid scanning inactive wilderness zones per frame.
  let visibleTrees = new Map(); // Per-locale Three.js roots attached to the currently active scene.
  let cachedTreeMeshes = new Map(); // Keep one cached mesh per flower across zone revisits, avoiding repeated GPU geometry/material allocation.
  let calendarKey = ''; // Day/year/Shift change gate; ordinary animation frames do not touch quest saves.
  let retrySaveAfter = 0; // A failed member write retries on a later calendar tick, rather than disabling the quest for the whole festival.
  let lastStatus = ''; // Visible on mobile to explain absent locales, failed saves, or withheld clues.
  let lastGenerated = null; // Debug snapshot describes which final terrain evidence made it into the clue.

  function year() { return Number(window.CalendarSystem?.aotYearNumber?.()); }
  function active() { return window.FestivalCalendar?.current?.()?.id === 'five_blossoms'; }
  function key(y = year()) { return PREFIX + y; }
  function records() { return questDeps?.getQuestProgress?.() || window.QuestProgressStore?.snapshot?.() || {}; }
  function state() { return records()[key()]; }
  function targetFor(index) { return BLOSSOMS[index] || null; }
  function zoneLayout(id) { return mapDeps?._zoneLayouts?.get?.(id) || null; }
  function localeFor(blossom) {
    return zoneLayout(blossom?.zoneId)?.localeInstances?.find?.(entry => entry.localeId === blossom.localeId) || null;
  }
  function statusFor(blossom) {
    const layout = zoneLayout(blossom?.zoneId); // The same generated layout is consulted for both visual placement and factual clue selection.
    const locale = localeFor(blossom);
    return { layout, locale, generated: !!layout, stamped: !!locale };
  }
  function clueFor(blossom) {
    const { layout, locale } = statusFor(blossom);
    if (!locale || !layout) return { ok: false, reason: 'The blossom locale is not in the current generated wilderness. A Tothal Shift may be needed for older worlds.' };
    return window.LocaleRiddleGenerator?.generate?.({
      zoneId: blossom.zoneId, layout, instance: locale, targetObjectKey: 'blossom-tree', blossomName: blossom.name,
      seed: [mapDeps?.tothalWorldId?.() || 'world', mapDeps?.currentTothalYear?.() || 'shift', blossom.id, locale.x, locale.y].join(':')
    }) || { ok: false, reason: 'LocaleRiddleGenerator is not loaded' };
  }
  function descriptor(founds = [], shift = null) {
    const remaining = targetFor(founds.length); // The next uncollected blossom alone supplies the active riddle.
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
      if (!instance || (!foliage && !cachedTreeMeshes.has(blossom.localeId))) { lastStatus = 'Blossom scene missing ' + blossom.localeId; continue; }
      const p = window.LocaleRiddleGenerator?.positionOf?.(instance, 'blossom-tree');
      if (!Number.isFinite(p?.col) || !Number.isFinite(p?.row)) continue;
      let tree = cachedTreeMeshes.get(blossom.localeId); // A Shift may move the same tree; its materials and geometry do not need rebuilding.
      if (!tree) {
        tree = foliage(blossom.localeId + ':' + p.col + ':' + p.row, blossom.color); // Temple-swatches, carved_smooth green trunk and leaf-card color-fill renderer.
        if (!tree) continue;
        tree.scale.multiplyScalar(18); // A ~3-unit landmark after the preset's quarter scale; apply once, not on every zone transition.
        cachedTreeMeshes.set(blossom.localeId, tree);
      }
      tree.name = blossom.localeId;
      tree.userData.festivalBlossomHunt = { id: blossom.id, zoneId: area, color: blossom.color, localeId: blossom.localeId };
      const rawHeight = window.ClimbSystem?.groundYAt?.(p.col + .5, p.row + .5); // Undefined floor must not turn into an implicit valid zero elevation.
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
    const target = targetFor(found.length);
    if (!target || target.zoneId !== event.to.area) return;
    const locale = localeFor(target);
    const p = locale && window.LocaleRiddleGenerator?.positionOf?.(locale, 'blossom-tree');
    if (!Number.isFinite(p?.col) || !Number.isFinite(p?.row)) return;
    if (Math.hypot(event.to.col - p.col, event.to.row - p.row) > 3) return;
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
    const upcoming = targetFor(Array.isArray(live?.progress?.found) ? live.progress.found.length : 0); // On opening the Quest Log, refresh clues from any newly generated zone; no extra autosave.
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
      displayedTrees: [...visibleTrees.keys()], cachedTreeMeshes: cachedTreeMeshes.size, lastStatus, retrySaveAfter,
      clueEvidence: lastGenerated?.evidence || null, clueValid: lastGenerated?.ok || false
    };
  }
  window.FestivalBlossomHunt = Object.freeze({ init, bindQuestDeps, update, menuStatus, debugSnapshot, BLOSSOMS, __test: { descriptor, clueFor, collect, syncCalendar } });
})();

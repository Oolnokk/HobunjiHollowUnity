(() => {
  'use strict';

  // Resolves which named "layout" (see hobunji_building_interior.v1 and
  // hobunji_map.v1's optional `layouts`/`entryPoints` fields) is active for a
  // map right now, and merges that layout's overrides on top of the map's
  // base placement data. Pure/stateless (besides the small session-only flag
  // registry below) so both the live game and the map editors can call the
  // exact same resolution logic — game.js owns deciding when to actually
  // rebuild a scene and play the transition (see performLiveLayoutSwap).
  //
  // Condition shape mirrors js/npc-scheduling.js's existing schedule rules
  // (`from`/`to` "HH:MM" strings, `day`/`days` weekday names) so a map
  // author already familiar with NPC schedules reads this the same way.
  // A layout with no conditions at all never auto-activates — it's reachable
  // only by explicit id (editor preview, or a future scripted/flag trigger).

  const _flags = new Map(); // session-only world-state flags a quest/event script can set to gate a layout — see setFlag/getFlag.

  function parseTimeMinutes(t) {
    const m = String(t ?? '').match(/^(\d{1,2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  function isWithinMinuteWindow(now, start, end) {
    if (start == null || end == null) return false;
    return start <= end ? (now >= start && now < end) : (now >= start || now < end);
  }

  // Civil months are a fixed 28 days (see calendar-system.js), so a simple
  // (month-1)*28 + day ordinal is enough to express a date range without
  // pulling in the full calendar epoch machinery.
  function monthDayOrdinal(month, day) {
    return (Math.max(1, Number(month) || 1) - 1) * 28 + Math.max(1, Number(day) || 1);
  }

  function isWithinDateWindow(nowOrdinal, fromDate, toDate) {
    if (!fromDate || !toDate) return false;
    const start = monthDayOrdinal(fromDate.month, fromDate.day);
    const end = monthDayOrdinal(toDate.month, toDate.day);
    return start <= end ? (nowOrdinal >= start && nowOrdinal <= end) : (nowOrdinal >= start || nowOrdinal <= end);
  }

  function currentSnapshot() {
    const CS = window.CalendarSystem;
    if (!CS) return { minutes: 0, weekday: null, dateOrdinal: 1 };
    return {
      minutes: Math.round(CS.getHour() * 60),
      weekday: CS.currentWeekdayName(),
      dateOrdinal: monthDayOrdinal(CS.monthNumber(), CS.dayOfMonth()),
    };
  }

  function conditionMatches(cond, now) {
    if (!cond || typeof cond !== 'object') return false;
    if (cond.from != null || cond.to != null || cond.start != null || cond.end != null) {
      const start = parseTimeMinutes(cond.from ?? cond.start);
      const end = parseTimeMinutes(cond.to ?? cond.end);
      if (!isWithinMinuteWindow(now.minutes, start, end)) return false;
    }
    if (cond.day || cond.days) {
      const days = cond.days || [cond.day];
      if (!days.includes(now.weekday)) return false;
    }
    if (cond.dateFrom || cond.dateTo) {
      if (!isWithinDateWindow(now.dateOrdinal, cond.dateFrom, cond.dateTo)) return false;
    }
    if (cond.flag) {
      const want = cond.flagValue !== false;
      if (getFlag(cond.flag) !== want) return false;
    }
    return true;
  }

  function layoutConditions(layout) {
    if (Array.isArray(layout.conditions)) return layout.conditions;
    return layout.condition ? [layout.condition] : [];
  }

  // Highest-`priority` layout whose conditions currently match (ties go to
  // whichever appears first in the array). Returns null for "use the map's
  // own base furniture/npcStations/etc." — the implicit default layout.
  function resolveActiveLayout(mapData, now) {
    const layouts = mapData?.layouts;
    if (!Array.isArray(layouts) || !layouts.length) return null;
    const snapshot = now || currentSnapshot();
    let best = null, bestPriority = -Infinity;
    for (const layout of layouts) {
      if (!layout?.id) continue;
      const conds = layoutConditions(layout);
      if (!conds.length || !conds.some(c => conditionMatches(c, snapshot))) continue;
      const priority = Number(layout.priority) || 0;
      if (priority > bestPriority) { best = layout; bestPriority = priority; }
    }
    return best;
  }

  // Fields a layout may override wholesale. Deliberately full-array
  // replacement rather than a diff/patch format: authoring a special event
  // (move every bench, remove the rug, add a campfire) reads far more
  // naturally as "here's what the room looks like during this layout" than
  // as an add/remove list, and it's what the interior/map editors already
  // let an author build (clone the base layout, then rearrange it).
  const OVERRIDABLE_KEYS = ['floor', 'colliders', 'vendorZones', 'furniture', 'npcStations', 'decor', 'objects', 'buildings', 'routes'];

  // Merges the active layout's overrides onto `mapData`, returning a new
  // object — `mapData` itself (and its `layouts` array) is left untouched so
  // this can be called again later once the calendar/flags have moved on.
  function getEffectiveMapData(mapData, now) {
    if (!mapData) return mapData;
    const layout = resolveActiveLayout(mapData, now);
    if (!layout) return mapData.activeLayoutId === 'default' ? mapData : { ...mapData, activeLayoutId: 'default' };
    const merged = { ...mapData, activeLayoutId: layout.id };
    for (const key of OVERRIDABLE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(layout, key)) merged[key] = layout[key];
    }
    return merged;
  }

  // Where to place the player after a layout switch (or a fresh entry into a
  // map whose current layout isn't the one last rendered). Prefers the
  // layout's own declared `entryPointId`, then whichever authored entry
  // point is nearest the player's last position, then just the first one —
  // falling back to null (caller keeps whatever spawn logic it already had)
  // for older maps authored before `entryPoints` existed.
  function pickEntryPoint(mapData, { layout, fromCol, fromRow } = {}) {
    const entryPoints = Array.isArray(mapData?.entryPoints) ? mapData.entryPoints : [];
    if (!entryPoints.length) return null;
    if (layout?.entryPointId) {
      const found = entryPoints.find(e => e.id === layout.entryPointId);
      if (found) return found;
    }
    if (Number.isFinite(fromCol) && Number.isFinite(fromRow)) {
      let best = null, bestDist = Infinity;
      for (const ep of entryPoints) {
        const dist = Math.hypot(ep.col - fromCol, ep.row - fromRow);
        if (dist < bestDist) { bestDist = dist; best = ep; }
      }
      if (best) return best;
    }
    return entryPoints[0];
  }

  function setFlag(name, value) { if (name) _flags.set(name, !!value); }
  function getFlag(name) { return !!_flags.get(name); }

  window.MapLayoutSystem = {
    resolveActiveLayout,
    getEffectiveMapData,
    pickEntryPoint,
    currentSnapshot,
    setFlag,
    getFlag,
  };
})();

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
  const CIVIL_DAY_ROLLOVER_HOUR = 0; // Player-facing date/weekday rollover; the raw simulation day still performs its morning maintenance at 06:00.
  const RAW_DAY_ROLLOVER_HOUR = 6; // Existing morning-to-morning simulation boundary used only to interpret the raw calendar.day counter before 06:00.

  // The full-day clock intentionally keeps calendar.day as a 06:00→06:00 raw
  // simulation counter so crops/weather/livestock can retain their established
  // morning maintenance tick. Civil dates are different: midnight belongs to
  // the next named weekday/date. CalendarSystem historically exposed the raw
  // counter directly, so 00:00–05:59 still displayed yesterday and every
  // weekday-authored midnight schedule fired one named day late. Install a
  // narrow public-calendar bridge here (this module loads immediately after
  // calendar-system.js) so all public date/weekday queries use the civil day
  // while explicit raw-day arguments keep their old deterministic meaning.
  function installCivilMidnightCalendarBridge() {
    const CS = window.CalendarSystem;
    if (!CS || CS.__civilMidnightBridgeInstalled) return false;

    const originalInit = CS.init;
    const originals = {
      dayOfYear: CS.dayOfYear,
      yearNumber: CS.yearNumber,
      aotYearNumber: CS.aotYearNumber,
      weekOfYear: CS.weekOfYear,
      monthIndex: CS.monthIndex,
      monthNumber: CS.monthNumber,
      monthName: CS.monthName,
      dayOfMonth: CS.dayOfMonth,
      weekOfSeason: CS.weekOfSeason,
      weekdayIndexForCalendarDay: CS.weekdayIndexForCalendarDay,
      weekdayNameForDay: CS.weekdayNameForDay,
      currentWeekdayIndex: CS.currentWeekdayIndex,
      currentWeekdayName: CS.currentWeekdayName,
      formatCalendarDate: CS.formatCalendarDate,
      formatCalendarDateFull: CS.formatCalendarDateFull,
      formatCalendarDateTimeFull: CS.formatCalendarDateTimeFull,
      isCivilYearStart: CS.isCivilYearStart,
      renderCalendarPanel: CS.renderCalendarPanel,
      timeDebugSnapshot: CS.timeDebugSnapshot,
    };
    let calendar = null; // Captured from CalendarSystem.init; raw morning-to-morning counter used to derive the civil date.
    let calendarUi = null; // Captured Calendar tab elements used to correct its internally-rendered raw-day highlight before 06:00.

    function representedHour(time01 = calendar?.time01) {
      const hour = Number(CS.getHour?.(time01));
      if (!Number.isFinite(hour)) return RAW_DAY_ROLLOVER_HOUR;
      return ((hour % 24) + 24) % 24;
    }

    function civilDayFor(rawDay = calendar?.day, time01 = calendar?.time01) {
      const day = Number(rawDay);
      if (!Number.isFinite(day)) return rawDay;
      const hour = representedHour(time01);
      return day + (hour >= CIVIL_DAY_ROLLOVER_HOUR && hour < RAW_DAY_ROLLOVER_HOUR ? 1 : 0);
    }

    function wrapDefaultDay(name) {
      const original = originals[name];
      if (typeof original !== 'function') return;
      CS[name] = function (day) {
        if (arguments.length) return original.call(this, day);
        return original.call(this, civilDayFor());
      };
    }

    for (const name of [
      'dayOfYear', 'yearNumber', 'aotYearNumber', 'weekOfYear',
      'monthIndex', 'monthNumber', 'monthName', 'dayOfMonth',
      'weekOfSeason', 'isCivilYearStart',
    ]) wrapDefaultDay(name);

    CS.currentWeekdayIndex = function () {
      return originals.weekdayIndexForCalendarDay.call(this, civilDayFor());
    };
    CS.currentWeekdayName = function () {
      return originals.weekdayNameForDay.call(this, civilDayFor());
    };
    CS.formatCalendarDate = function (day) {
      if (arguments.length) return originals.formatCalendarDate.call(this, day);
      return originals.formatCalendarDate.call(this, civilDayFor());
    };
    CS.formatCalendarDateFull = function (day) {
      if (arguments.length) return originals.formatCalendarDateFull.call(this, day);
      return originals.formatCalendarDateFull.call(this, civilDayFor());
    };
    CS.formatCalendarDateTimeFull = function (day, time01) {
      if (!calendar) return originals.formatCalendarDateTimeFull.apply(this, arguments);
      if (arguments.length === 0) {
        return originals.formatCalendarDateTimeFull.call(this, civilDayFor(), calendar.time01);
      }
      if (arguments.length >= 2) {
        return originals.formatCalendarDateTimeFull.call(this, civilDayFor(day, time01), time01);
      }
      return originals.formatCalendarDateTimeFull.call(this, day);
    };

    function repairCalendarPanelCivilToday() {
      if (!calendar || !calendarUi) return;
      const civilDay = civilDayFor();
      if (!Number.isFinite(civilDay) || civilDay === calendar.day) return;

      // renderCalendarPanel's private view state starts on raw calendar.day.
      // Midnight can only move the civil date forward one day, so the only
      // possible month mismatch is the final raw day of a month/year.
      const rawMonth = originals.monthIndex.call(CS, calendar.day);
      const civilMonth = originals.monthIndex.call(CS, civilDay);
      const rawYear = originals.aotYearNumber.call(CS, calendar.day);
      const civilYear = originals.aotYearNumber.call(CS, civilDay);
      if ((civilMonth !== rawMonth || civilYear !== rawYear) && calendarUi.calNextMonth?.click) {
        calendarUi.calNextMonth.click();
      }

      if (calendarUi.calToday) calendarUi.calToday.textContent = CS.formatCalendarDateTimeFull();
      const dayNumber = String(originals.dayOfMonth.call(CS, civilDay));
      const weekday = originals.weekdayNameForDay.call(CS, civilDay);
      const buttons = calendarUi.calWeeks?.querySelectorAll?.('.cal-day-btn') || [];
      for (const button of buttons) {
        button.classList.remove('today');
        const spans = button.querySelectorAll?.('span') || [];
        const weekdayText = spans[0]?.textContent || '';
        const dayText = button.querySelector?.('.cal-day-num')?.textContent || '';
        if (weekdayText === weekday && dayText === dayNumber) button.classList.add('today');
      }
    }

    CS.renderCalendarPanel = function (...args) {
      const result = originals.renderCalendarPanel.apply(this, args);
      repairCalendarPanelCivilToday();
      return result;
    };

    CS.timeDebugSnapshot = function (...args) {
      const snapshot = originals.timeDebugSnapshot.apply(this, args) || {};
      return {
        ...snapshot,
        civilMidnightRollover: true,
        civilDay: civilDayFor(),
        rawDayRolloverHour: RAW_DAY_ROLLOVER_HOUR,
        civilDayRolloverHour: CIVIL_DAY_ROLLOVER_HOUR,
        representedWeekday: CS.currentWeekdayName(),
        representedDate: CS.formatCalendarDate(),
      };
    };

    CS.init = function (injectedDeps) {
      calendar = injectedDeps?.calendar || null;
      calendarUi = {
        calToday: injectedDeps?.calToday || null,
        calNextMonth: injectedDeps?.calNextMonth || null,
        calWeeks: injectedDeps?.calWeeks || null,
      };
      return originalInit.call(this, injectedDeps);
    };

    CS.__civilMidnightBridgeInstalled = true;
    CS.civilDayForRawDay = civilDayFor;
    return true;
  }

  installCivilMidnightCalendarBridge();

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

  // A station may bind itself to one authored furniture instance instead of
  // duplicating that furniture's coordinates. Resolution happens only after
  // the active alternate layout has been applied, so moving/repositioning the
  // furniture inside a layout automatically moves the NPC destination too.
  // postX/postZ are folded into the station origin because those editor fields
  // translate the rendered furniture away from its raw tile coordinate.
  function resolveFurnitureBoundStations(mapData) {
    const stations = Array.isArray(mapData?.npcStations) ? mapData.npcStations : null;
    if (!stations?.some(station => station?.sourceFurnitureId)) return mapData;
    const furniture = Array.isArray(mapData?.furniture) ? mapData.furniture : [];
    const byId = new Map();
    for (const piece of furniture) {
      const id = String(piece?.id || '');
      if (id) byId.set(id, piece);
    }
    let changed = false;
    const resolvedStations = stations.map(station => {
      const sourceId = String(station?.sourceFurnitureId || '');
      if (!sourceId) return station;
      const piece = byId.get(sourceId);
      if (!piece || !Number.isFinite(piece.col) || !Number.isFinite(piece.row)) return station;
      changed = true;
      const sourceKey = String(station.sourceFurnitureKey || piece.itemKey || piece.key || '');
      return {
        ...station,
        col: piece.col + (Number(piece.postX) || 0),
        row: piece.row + (Number(piece.postZ) || 0),
        rotY: Number.isFinite(piece.rotY) ? piece.rotY : (Number(station.rotY) || 0),
        sourceFurnitureKey: sourceKey,
        furnitureKey: station.furnitureKey || sourceKey,
      };
    });
    return changed ? { ...mapData, npcStations: resolvedStations } : mapData;
  }

  // Merges the active layout's overrides onto `mapData`, returning a new
  // object — `mapData` itself (and its `layouts` array) is left untouched so
  // this can be called again later once the calendar/flags have moved on.
  function getEffectiveMapData(mapData, now) {
    if (!mapData) return mapData;
    const layout = resolveActiveLayout(mapData, now);
    if (!layout) {
      const effective = mapData.activeLayoutId === 'default' ? mapData : { ...mapData, activeLayoutId: 'default' };
      return resolveFurnitureBoundStations(effective);
    }
    const merged = { ...mapData, activeLayoutId: layout.id };
    for (const key of OVERRIDABLE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(layout, key)) merged[key] = layout[key];
    }
    return resolveFurnitureBoundStations(merged);
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
    resolveFurnitureBoundStations,
    getEffectiveMapData,
    pickEntryPoint,
    currentSnapshot,
    setFlag,
    getFlag,
  };
})();

(() => {
  'use strict';

  // Khymeryyan civil calendar (day/week/month/year derivations + regional
  // seasons) and the Calendar tab UI. Extracted out of game.js following the
  // same window.<Namespace> + init(deps) pattern as its sibling systems.
  // calendar.day is an ever-incrementing absolute day count from world start
  // (day 1); everything else here is derived from it via modulo. MORNING_HOUR/
  // NIGHT_HOUR stay behind in game.js on purpose — they're shared with the
  // day/weather tick and lighting code, not owned by the calendar alone — and
  // come in through deps. Every other calendar constant (month/weekday names,
  // week/year lengths, the regional seasons table) is calendar-only and moved
  // here wholesale.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  const WEEKDAY_NAMES = ['Anan', 'Hronu', 'Kruru', 'Muunu', 'Naru', 'Tothu', 'Uung']; // calendar.day 1 falls on Anan
  const DAYS_PER_WEEK  = WEEKDAY_NAMES.length; // 7
  const WEEKS_PER_YEAR = 48;
  const YEAR_LENGTH_DAYS = DAYS_PER_WEEK * WEEKS_PER_YEAR; // 336
  const DAYS_PER_MONTH = 28; // exactly 4 weeks
  const MONTH_NAMES = [
    'Waxingheat', 'Highheat', 'Waningheat',       // Summer
    'Firstfall', 'Secondfall', 'Thirdfall',       // Fall
    'Shallowfrost', 'Deepfrost', 'Pouringfrost',  // Winter
    'Firstrise', 'Secondrise', 'Thirdrise',       // Spring
  ]; // universal civil months — decoupled from Tanka's regional tropical seasons

  // Regional seasons: Northwestern Tanka. The civil calendar above is
  // universal, but lived seasons are regional — this location reads its
  // weather off week-of-year bands (Stormtide/Deadgrass/Longpour, plus a
  // short Coldmuck slush-cover/wind-hinge season with occasional pituraq
  // micro-winter squalls at the Longpour→Stormtide turn) rather than the
  // calendar month. Deliberately unbalanced 4/2/4/2 months (not the "pure"
  // 5/1/5/1 the doc's week math would give) — Secondfall was pulled into
  // Deadgrass and Secondrise into Coldmuck for pacing, so neither short
  // season is a single awkward month. Every transition falls mid-month
  // (week 2 of a 4-week month) rather than on a month boundary, so a player
  // looking at the Calendar tab sees the season already starting to turn
  // partway through the currently-open month page instead of the change
  // only showing up once they flip to the next one. Stormtide's band
  // therefore wraps the year boundary (weeks 47-48, then 1-14) —
  // seasonForDay()/weekOfSeason() below handle startWeek > endWeek as a
  // wraparound, same convention isNowWithinNpcRuleWindow() (game.js) uses
  // for overnight schedule rules. grassColor/grassDensity drive the ground
  // tile material and the grass billboard tufts (see
  // applySeasonalGrassAppearance() in game.js) — vibrant/full for the wet
  // seasons, sparse and off-hue for Deadgrass (dead, dry) and Coldmuck
  // (slush-covered, dormant).
  const seasons = [
    { name: 'Stormtide', emoji: '⛈️',  rainChance: 0.35, stormChance: 0.30, startWeek: 47, endWeek: 14, grassColor: new THREE.Color().setHSL(108/360, 0.58, 0.28), grassDensity: 1.00 },
    { name: 'Deadgrass', emoji: '☀️',  rainChance: 0.06, stormChance: 0.01, startWeek: 15, endWeek: 22, grassColor: new THREE.Color().setHSL(45/360,  0.40, 0.34), grassDensity: 0.40 },
    { name: 'Longpour',  emoji: '🌧️', rainChance: 0.70, stormChance: 0.05, startWeek: 23, endWeek: 38, grassColor: new THREE.Color().setHSL(122/360, 0.55, 0.22), grassDensity: 1.00 },
    { name: 'Coldmuck',  emoji: '🌬️', rainChance: 0.12, stormChance: 0.10, startWeek: 39, endWeek: 46, grassColor: new THREE.Color().setHSL(165/360, 0.15, 0.46), grassDensity: 0.45 },
  ];

  function getHour() {
    return deps.MORNING_HOUR + deps.calendar.time01 * (deps.NIGHT_HOUR - deps.MORNING_HOUR);
  }

  // ── Calendar derivations ──
  // Every helper below takes an optional absolute day (defaulting to
  // calendar.day) so the Calendar tab can compute dates other than today.
  function dayOfYear(day = deps.calendar.day) {
    return ((day - 1) % YEAR_LENGTH_DAYS) + 1; // 1..336
  }
  function yearNumber(day = deps.calendar.day) {
    return Math.floor((day - 1) / YEAR_LENGTH_DAYS) + 1;
  }
  function weekOfYear(day = deps.calendar.day) {
    return Math.floor((dayOfYear(day) - 1) / DAYS_PER_WEEK) + 1; // 1..48
  }
  function monthIndex(day = deps.calendar.day) {
    return Math.floor((dayOfYear(day) - 1) / DAYS_PER_MONTH); // 0..11
  }
  function monthNumber(day = deps.calendar.day) {
    return monthIndex(day) + 1; // 1..12
  }
  function monthName(day = deps.calendar.day) {
    return MONTH_NAMES[monthIndex(day)];
  }
  function dayOfMonth(day = deps.calendar.day) {
    return ((dayOfYear(day) - 1) % DAYS_PER_MONTH) + 1; // 1..28
  }
  // startWeek > endWeek means the season wraps the year boundary (see
  // Stormtide, weeks 47-48 then 1-14) — same "overnight window" convention
  // as game.js's isNowWithinNpcRuleWindow().
  function seasonForDay(day = deps.calendar.day) {
    const wk = weekOfYear(day);
    return seasons.find(s => s.startWeek <= s.endWeek
      ? (wk >= s.startWeek && wk <= s.endWeek)
      : (wk >= s.startWeek || wk <= s.endWeek)
    ) || seasons[seasons.length - 1];
  }
  function currentSeason() {
    return seasonForDay(deps.calendar.day);
  }
  function weekOfSeason(day = deps.calendar.day) {
    const wk = weekOfYear(day);
    const season = seasonForDay(day);
    if (season.startWeek <= season.endWeek) return wk - season.startWeek + 1;
    return wk >= season.startWeek ? wk - season.startWeek + 1 : wk + (WEEKS_PER_YEAR - season.startWeek + 1);
  }

  function weekdayIndexForCalendarDay(day) {
    return ((day - 1) % DAYS_PER_WEEK + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  }
  function weekdayNameForDay(day = deps.calendar.day) {
    return WEEKDAY_NAMES[weekdayIndexForCalendarDay(day)];
  }
  function currentWeekdayIndex() {
    return weekdayIndexForCalendarDay(deps.calendar.day);
  }
  function currentWeekdayName() {
    return weekdayNameForDay(deps.calendar.day);
  }
  function ordinalSuffix(n) {
    const v = n % 100;
    if (v >= 11 && v <= 13) return 'th';
    switch (n % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  }
  // HUD-friendly short date, e.g. "Anan, 1/1, 1st week of Storm"
  function formatCalendarDate(day = deps.calendar.day) {
    const dom = dayOfMonth(day), wk = weekOfSeason(day);
    return `${weekdayNameForDay(day)}, ${dom}/${monthNumber(day)}, ${wk}${ordinalSuffix(wk)} week of ${seasonForDay(day).name}`;
  }
  // Full date for the Calendar tab header, e.g. "Anan, Waxingheat 1st, 1st week of Storm"
  function formatCalendarDateFull(day = deps.calendar.day) {
    const dom = dayOfMonth(day), wk = weekOfSeason(day);
    return `${weekdayNameForDay(day)}, ${monthName(day)} ${dom}${ordinalSuffix(dom)}, ${wk}${ordinalSuffix(wk)} week of ${seasonForDay(day).name}`;
  }

  // Absolute day of a month's first day. Months are exactly 4 weeks (28
  // days), so every month starts on Anan — no partial first/last week to
  // special-case, unlike a real Gregorian month grid.
  function absDayForMonthStart(year, monthIdx0) {
    return (year - 1) * YEAR_LENGTH_DAYS + monthIdx0 * DAYS_PER_MONTH + 1;
  }

  let calViewYear = 1, calViewMonthIndex = 0;

  function renderCalendarPanel() {
    if (!deps.calToday) return;
    calViewYear = yearNumber(deps.calendar.day);
    calViewMonthIndex = monthIndex(deps.calendar.day);
    deps.calToday.textContent = formatCalendarDateFull(deps.calendar.day);
    renderCalendarMonthView();
  }

  // Redraws the currently-navigated month (calViewYear/calViewMonthIndex) as
  // 4 week rows — the core gameplay unit — each its own tight container: a
  // season+week label on the left, its 7 days packed together on the right,
  // with only today's cell picked out in a different color.
  function renderCalendarMonthView() {
    const monthStartDay = absDayForMonthStart(calViewYear, calViewMonthIndex);
    deps.calMonthTitle.textContent = `${MONTH_NAMES[calViewMonthIndex]} — Year ${calViewYear}`;
    deps.calPrevMonth.disabled = (calViewYear === 1 && calViewMonthIndex === 0);

    deps.calWeeks.innerHTML = '';
    for (let w = 0; w < DAYS_PER_MONTH / DAYS_PER_WEEK; w++) {
      const weekStartDay = monthStartDay + w * DAYS_PER_WEEK;
      const season = seasonForDay(weekStartDay);
      const row = document.createElement('div');
      row.className = 'cal-week-row';
      const label = document.createElement('div');
      label.className = 'cal-week-label';
      label.innerHTML = `${season.emoji} ${season.name}<br>Week ${weekOfSeason(weekStartDay)}`;
      row.appendChild(label);
      const daysWrap = document.createElement('div');
      daysWrap.className = 'cal-week-days';
      for (let i = 0; i < DAYS_PER_WEEK; i++) {
        const d = weekStartDay + i;
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'cal-day-btn' + (d === deps.calendar.day ? ' today' : '');
        cell.innerHTML = `<span>${WEEKDAY_NAMES[i]}</span><span class="cal-day-num">${dayOfMonth(d)}</span>`;
        daysWrap.appendChild(cell);
      }
      row.appendChild(daysWrap);
      deps.calWeeks.appendChild(row);
    }
  }

  function _bindMonthNav() {
    deps.calPrevMonth.addEventListener('click', () => {
      if (calViewYear === 1 && calViewMonthIndex === 0) return;
      if (calViewMonthIndex === 0) { calViewYear--; calViewMonthIndex = 11; }
      else calViewMonthIndex--;
      renderCalendarMonthView();
    });
    deps.calNextMonth.addEventListener('click', () => {
      if (calViewMonthIndex === 11) { calViewYear++; calViewMonthIndex = 0; }
      else calViewMonthIndex++;
      renderCalendarMonthView();
    });
  }

  function initWithBinding(injectedDeps) {
    init(injectedDeps);
    _bindMonthNav();
  }

  window.CalendarSystem = {
    init: initWithBinding,
    getHour,
    dayOfYear,
    yearNumber,
    weekOfYear,
    monthIndex,
    monthNumber,
    monthName,
    dayOfMonth,
    seasonForDay,
    currentSeason,
    weekOfSeason,
    weekdayIndexForCalendarDay,
    weekdayNameForDay,
    currentWeekdayIndex,
    currentWeekdayName,
    ordinalSuffix,
    formatCalendarDate,
    formatCalendarDateFull,
    absDayForMonthStart,
    renderCalendarPanel,
  };
})();

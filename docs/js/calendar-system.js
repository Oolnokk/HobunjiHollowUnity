(() => {
  'use strict';

  // Khymeryyan civil calendar (day/week/month/year derivations + regional
  // seasons), Calendar tab UI, and player-facing time passage. game.js owns
  // private world/day rollover hooks; this module owns the civil epoch,
  // date/time formatting, sleep/wait menu, and natural clock-rate shim.
  //
  // calendar.day remains the world's monotonic gameplay day counter. Game
  // day 1 intentionally stays Waxingheat 1 at the existing time01, but the
  // civil year now starts on Firstrise 1. The first 84 civil days of 1154
  // AoT therefore predate the playable opening. Regional weather seasons
  // retain their old absolute-world-day phase so moving New Year does not
  // silently rotate Stormtide/Deadgrass/Longpour/Coldmuck.
  let deps = null;

  const WEEKDAY_NAMES = ['Anan', 'Hronu', 'Kruru', 'Muunu', 'Naru', 'Tothu', 'Uung']; // Used by every weekday/date formatter; raw game day 1 remains Anan.
  const DAYS_PER_WEEK = WEEKDAY_NAMES.length; // Used by civil and regional week derivations.
  const WEEKS_PER_YEAR = 48; // Used by the 336-day civil year and wrapped regional-season week math.
  const YEAR_LENGTH_DAYS = DAYS_PER_WEEK * WEEKS_PER_YEAR; // Used by civil-year and Tothal-cycle rollover math.
  const DAYS_PER_MONTH = 28; // Used by all 12 equal-length civil months and the Calendar tab grid.
  const FIRST_AOT_YEAR = 1154; // Used only for the player-facing AoT era number; Tothal's deterministic seed cycle stays 1-based internally.
  const MONTH_NAMES = [
    'Firstrise', 'Secondrise', 'Thirdrise',         // Spring — civil year begins here.
    'Waxingheat', 'Highheat', 'Waningheat',         // Summer.
    'Firstfall', 'Secondfall', 'Thirdfall',         // Fall.
    'Shallowfrost', 'Deepfrost', 'Pouringfrost',   // Winter.
  ]; // Used by named-date formatting and the Calendar tab.
  const GAME_START_MONTH_INDEX = 3; // Used by civilDayOffset() so raw game day 1 remains Waxingheat 1.
  const GAME_START_CIVIL_DAY_OFFSET = GAME_START_MONTH_INDEX * DAYS_PER_MONTH; // Used by every civil year/month derivation.

  // game.js still writes time01 against its private legacy 288-second scalar,
  // while this module slows those writes to the established 672-second pace.
  // FULL_DAY_HOURS is deliberately independent from NIGHT_HOUR: 22:00 remains
  // a lighting/night threshold, not the end of the playable day. The spooky
  // runtime adds the final 16/24 pace correction so 24 hours preserve the
  // same seconds-per-game-hour as the former represented 06:00→22:00 span.
  const BASE_DAY_LENGTH_SECONDS = 288; // Used only to derive the compatibility scale from game.js's existing private clock constant.
  const TARGET_DAY_LENGTH_SECONDS = 672; // Used by natural-time scaling and the mobile-visible time debug report before the spooky runtime's 24h correction.
  const NATURAL_TIME_WRITE_SCALE = BASE_DAY_LENGTH_SECONDS / TARGET_DAY_LENGTH_SECONDS; // Applied only to tiny positive frame-to-frame time01 writes.
  const FULL_DAY_HOURS = 24; // Used by clock conversion and time passage so 22:00 is never treated as a rollover boundary.
  const MAX_NATURAL_TIME_WRITE = 0.02; // Used by the time01 setter to distinguish normal frame ticks from explicit jumps.
  const PLAYER_ACTION_LOCK_ID = 'player'; // Used while the sleep/wait modal or iris transition owns input.
  const MAX_PASSAGE_HOURS = FULL_DAY_HOURS; // Used by Sleep/Wait so seated chair waiting can cross midnight and span a complete day.
  const TIME_PASSAGE_FIRST_TICK_MS = 1000; // Used so the first fully-black countdown hour remains visible for one complete real second.
  const TIME_PASSAGE_TICK_DECAY = 0.8; // Used to shorten each subsequent countdown interval by exactly 20 percent.

  // Regional seasons: Northwestern Tanka. These are deliberately anchored to
  // raw world-day weeks, not civil day-of-year, preserving the opening
  // Stormtide phase even though Firstrise is now New Year.
  const seasons = [
    { name: 'Stormtide', emoji: '⛈️', rainChance: 0.35, stormChance: 0.30, startWeek: 47, endWeek: 14, grassColor: new THREE.Color().setHSL(108 / 360, 0.58, 0.28), grassDensity: 1.00 },
    { name: 'Deadgrass', emoji: '☀️', rainChance: 0.06, stormChance: 0.01, startWeek: 15, endWeek: 22, grassColor: new THREE.Color().setHSL(45 / 360, 0.40, 0.34), grassDensity: 0.40 },
    { name: 'Longpour', emoji: '🌧️', rainChance: 0.70, stormChance: 0.05, startWeek: 23, endWeek: 38, grassColor: new THREE.Color().setHSL(122 / 360, 0.55, 0.22), grassDensity: 1.00 },
    { name: 'Coldmuck', emoji: '🌬️', rainChance: 0.12, stormChance: 0.10, startWeek: 39, endWeek: 46, grassColor: new THREE.Color().setHSL(165 / 360, 0.15, 0.46), grassDensity: 0.45 },
  ]; // Used by weather/season display and existing regional simulation callers.

  let _rawTimeWrite = false; // Used by setTime01Raw() so explicit time jumps are not slowed by the natural-time accessor.
  let _timeScaleInstalled = false; // Used by installNaturalTimeScale() to avoid redefining calendar.time01 on repeated init calls.
  let _timePassageUi = null; // Populated by buildTimePassageUi(); reused by both Sleep and seated Wait.
  let _timePassageKind = null; // 'sleep'|'wait'; used by shared modal copy/confirm text and sleep-only resource restoration.
  let _selectedPassageHours = 1; // Used by duration controls and the live target-date preview.
  let _timePassageLock = null; // CharacterActionLocks handle held while the open modal/transition owns player input.
  let _passagePreviewTimer = 0; // Interval id used to keep the modal's current-time line live while open.
  let _syncingSeatedWait = false; // MutationObserver recursion guard while injecting Action 2's seated Wait button.
  const _interceptedDesktopHolds = { // Used to preserve E/Q tap-vs-hold selection behavior while Sleep/Wait intercept those keys.
    e: { down: false, held: false, timer: 0, kind: 'sleep', arc: 'tool' },
    q: { down: false, held: false, timer: 0, kind: 'wait', arc: 'item' },
  };

  function debugLog(message, level = 'info') {
    const log = window.__farmLog || ((text) => console.log(text)); // Used to route time diagnostics into the existing mobile-visible debug log.
    try { log(`[time] ${message}`, level); }
    catch { console.log(`[time] ${message}`); }
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    installNaturalTimeScale();
    bindMonthNav();
    installTimePassageRuntime();
    debugLog(`calendar epoch ready: game day 1 = Waxingheat 1, ${FIRST_AOT_YEAR} AoT; Firstrise 1 begins each civil year`);
    debugLog(`Tothal cycle ${yearNumber()} = ${aotYearNumber()} AoT; deterministic y${yearNumber()} seed preserved`);
    debugLog(`natural clock target: ${TARGET_DAY_LENGTH_SECONDS}s base represented day (${NATURAL_TIME_WRITE_SCALE.toFixed(3)}x legacy write rate); ${FULL_DAY_HOURS}h clock enabled`);
  }

  function positiveModulo(value, modulus) {
    return ((value % modulus) + modulus) % modulus;
  }

  function civilDayOffset(day = deps?.calendar?.day ?? 1) {
    return (day - 1) + GAME_START_CIVIL_DAY_OFFSET;
  }

  function getHour(time01 = deps.calendar.time01) {
    return positiveModulo(deps.MORNING_HOUR + time01 * FULL_DAY_HOURS, FULL_DAY_HOURS);
  }

  // ── Calendar derivations ───────────────────────────────────────────
  function dayOfYear(day = deps.calendar.day) {
    return positiveModulo(civilDayOffset(day), YEAR_LENGTH_DAYS) + 1;
  }

  // IMPORTANT compatibility boundary: game.js's currentTothalYear() already
  // calls CalendarSystem.yearNumber(), and performTothalShift() includes that
  // result in `${worldId}_tothal_y${year}_${zoneId}`. Keep yearNumber() as a
  // 1-based Tothal generation cycle so an existing cycle-1 world still
  // rebuilds from seed y1 after this update. Because it uses the *new civil
  // offset*, it now increments on Firstrise 1 exactly as requested.
  function yearNumber(day = deps.calendar.day) {
    return Math.floor(civilDayOffset(day) / YEAR_LENGTH_DAYS) + 1;
  }

  // Player-facing era number. This is intentionally separate from the stable
  // internal Tothal seed cycle above: cycle 1 displays as 1154 AoT, cycle 2
  // as 1155 AoT, and so on.
  function aotYearNumber(day = deps.calendar.day) {
    return FIRST_AOT_YEAR + yearNumber(day) - 1;
  }

  function weekOfYear(day = deps.calendar.day) {
    return Math.floor((dayOfYear(day) - 1) / DAYS_PER_WEEK) + 1;
  }

  function seasonCycleWeek(day = deps.calendar.day) {
    return Math.floor(positiveModulo(day - 1, YEAR_LENGTH_DAYS) / DAYS_PER_WEEK) + 1;
  }

  function monthIndex(day = deps.calendar.day) {
    return Math.floor((dayOfYear(day) - 1) / DAYS_PER_MONTH);
  }

  function monthNumber(day = deps.calendar.day) {
    return monthIndex(day) + 1;
  }

  function monthName(day = deps.calendar.day) {
    return MONTH_NAMES[monthIndex(day)];
  }

  function dayOfMonth(day = deps.calendar.day) {
    return positiveModulo(dayOfYear(day) - 1, DAYS_PER_MONTH) + 1;
  }

  function seasonForDay(day = deps.calendar.day) {
    const wk = seasonCycleWeek(day); // Used to keep regional seasons on their pre-epoch-change phase.
    return seasons.find(season => season.startWeek <= season.endWeek
      ? (wk >= season.startWeek && wk <= season.endWeek)
      : (wk >= season.startWeek || wk <= season.endWeek)
    ) || seasons[seasons.length - 1];
  }

  function currentSeason() {
    return seasonForDay(deps.calendar.day);
  }

  function weekOfSeason(day = deps.calendar.day) {
    const wk = seasonCycleWeek(day); // Used with the selected regional season's wrapped week band below.
    const season = seasonForDay(day); // Used to translate absolute regional week into week-within-season.
    if (season.startWeek <= season.endWeek) return wk - season.startWeek + 1;
    return wk >= season.startWeek ? wk - season.startWeek + 1 : wk + (WEEKS_PER_YEAR - season.startWeek + 1);
  }

  function weekdayIndexForCalendarDay(day) {
    return positiveModulo(day - 1, DAYS_PER_WEEK);
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
    const v = n % 100; // Used to protect 11th/12th/13th from the single-digit suffix rule.
    if (v >= 11 && v <= 13) return 'th';
    switch (n % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  }

  // HUD-friendly short date. Numeric dates are month/day by design.
  function formatCalendarDate(day = deps.calendar.day) {
    const dom = dayOfMonth(day); // Used in the month/day numeric date below.
    const wk = weekOfSeason(day); // Used in the regional-season week suffix below.
    return `${weekdayNameForDay(day)}, ${monthNumber(day)}/${dom}, ${aotYearNumber(day)} AoT, ${wk}${ordinalSuffix(wk)} week of ${seasonForDay(day).name}`;
  }

  function formatCalendarDateFull(day = deps.calendar.day) {
    const dom = dayOfMonth(day); // Used in the named civil date below.
    const wk = weekOfSeason(day); // Used in the regional-season week suffix below.
    return `${weekdayNameForDay(day)}, ${monthName(day)} ${dom}${ordinalSuffix(dom)}, ${aotYearNumber(day)} AoT — ${wk}${ordinalSuffix(wk)} week of ${seasonForDay(day).name}`;
  }

  function formatClockTime(hour = getHour()) {
    const totalMinutes = Math.round(hour * 60); // Used to avoid floating-point minute artifacts in the displayed clock.
    const hours24 = positiveModulo(Math.floor(totalMinutes / 60), 24); // Used for AM/PM and 12-hour conversion below.
    const minutes = positiveModulo(totalMinutes, 60); // Used for the zero-padded minute field below.
    const suffix = hours24 >= 12 ? 'PM' : 'AM'; // Used in the human-readable time string below.
    const hours12 = ((hours24 + 11) % 12) + 1; // Used to render midnight/noon in 12-hour form.
    return `${hours12}:${String(minutes).padStart(2, '0')} ${suffix}`;
  }

  function formatCalendarDateTimeFull(day = deps.calendar.day, time01 = deps.calendar.time01) {
    return `${formatCalendarDateFull(day)} · ${formatClockTime(getHour(time01))}`;
  }

  // Inverse of dayOfYear/aotYearNumber. Firstrise 1, 1154 is raw day -83;
  // Waxingheat 1, 1154 is raw day 1; Firstrise 1, 1155 is raw day 253.
  function absDayForMonthStart(aotYear, monthIdx0) {
    return (aotYear - FIRST_AOT_YEAR) * YEAR_LENGTH_DAYS
      + monthIdx0 * DAYS_PER_MONTH
      + 1
      - GAME_START_CIVIL_DAY_OFFSET;
  }

  function isCivilYearStart(day = deps.calendar.day) {
    return monthIndex(day) === 0 && dayOfMonth(day) === 1;
  }

  function nextCivilYearStartDay(day = deps.calendar.day) {
    const displayYear = aotYearNumber(day); // Used to resolve this civil year's Firstrise boundary in raw game-day space.
    const currentYearStart = absDayForMonthStart(displayYear, 0); // Used to decide whether this year's boundary is still ahead or already passed.
    return currentYearStart > day ? currentYearStart : absDayForMonthStart(displayYear + 1, 0);
  }

  // ── Natural clock rate ─────────────────────────────────────────────
  // game.js owns `calendar.time01 += dt / DAY_LENGTH_SECONDS`; because that
  // state object is injected here, a narrow accessor can scale only those
  // tiny frame-to-frame positive writes. Loads happen before
  // __hobunjiGameStarted, while explicit skips use setTime01Raw().
  function installNaturalTimeScale() {
    if (_timeScaleInstalled || !deps?.calendar) return;
    const calendar = deps.calendar; // Used as the accessor target shared with game.js.
    let value = Number(calendar.time01) || 0; // Backing value read/written by the accessor below.
    Object.defineProperty(calendar, 'time01', {
      configurable: true,
      enumerable: true,
      get() { return value; },
      set(nextValue) {
        const numeric = Number(nextValue); // Used as the normalized candidate time written by game.js or a loader.
        if (!Number.isFinite(numeric)) return;
        const delta = numeric - value; // Used to distinguish natural frame increments from explicit jumps/wrap subtraction.
        const isNaturalFrameWrite = !_rawTimeWrite
          && window.__hobunjiGameStarted === true
          && delta > 0
          && delta <= MAX_NATURAL_TIME_WRITE;
        const passageOwnsClock = !!_timePassageKind && !!_timePassageUi
          && (_timePassageUi.backdrop.classList.contains('open') || _timePassageUi.iris.style.display === 'block'); // Used to freeze drift while choosing/transitioning without blocking explicit rollover writes.
        value = isNaturalFrameWrite
          ? (passageOwnsClock ? value : value + delta * NATURAL_TIME_WRITE_SCALE)
          : numeric;
      },
    });
    _timeScaleInstalled = true;
  }

  function setTime01Raw(value) {
    if (!deps?.calendar || !Number.isFinite(Number(value))) return;
    _rawTimeWrite = true;
    try { deps.calendar.time01 = Number(value); }
    finally { _rawTimeWrite = false; }
  }

  function activeClockHours() {
    return FULL_DAY_HOURS;
  }

  function previewAfterHours(hours, day = deps.calendar.day, time01 = deps.calendar.time01) {
    const safeHours = Math.max(0, Number(hours) || 0); // Used to reject negative/invalid passage durations.
    const total = time01 + safeHours / activeClockHours(); // Used to split the requested passage into day rollover(s) plus within-day remainder.
    const dayOffset = Math.floor(total); // Used to advance the raw world day when the represented clock crosses its end.
    return {
      day: day + dayOffset,
      time01: positiveModulo(total, 1),
      hours: safeHours,
    };
  }

  // ── Calendar tab ───────────────────────────────────────────────────
  let calViewYear = FIRST_AOT_YEAR; // Current Calendar-tab AoT year; reset to today whenever the tab opens.
  let calViewMonthIndex = 0; // Current Calendar-tab month index; reset to today whenever the tab opens.

  function renderCalendarPanel() {
    if (!deps.calToday) return;
    calViewYear = aotYearNumber(deps.calendar.day);
    calViewMonthIndex = monthIndex(deps.calendar.day);
    deps.calToday.textContent = formatCalendarDateTimeFull(deps.calendar.day, deps.calendar.time01);
    renderCalendarMonthView();
  }

  function renderCalendarMonthView() {
    if (!deps.calWeeks || !deps.calMonthTitle) return;
    const monthStartDay = absDayForMonthStart(calViewYear, calViewMonthIndex); // Used as the raw day anchor for all 28 cells below.
    deps.calMonthTitle.textContent = `${MONTH_NAMES[calViewMonthIndex]} — ${calViewYear} AoT`;
    if (deps.calPrevMonth) deps.calPrevMonth.disabled = (calViewYear === FIRST_AOT_YEAR && calViewMonthIndex === 0);

    deps.calWeeks.innerHTML = '';
    for (let w = 0; w < DAYS_PER_MONTH / DAYS_PER_WEEK; w++) {
      const weekStartDay = monthStartDay + w * DAYS_PER_WEEK; // Used as the row's first raw day and regional-season lookup anchor.
      const season = seasonForDay(weekStartDay); // Used in the row's season/week label.
      const row = document.createElement('div'); // Calendar week row container appended below.
      row.className = 'cal-week-row';
      const label = document.createElement('div'); // Season/week label paired with this seven-day row.
      label.className = 'cal-week-label';
      label.innerHTML = `${season.emoji} ${season.name}<br>Week ${weekOfSeason(weekStartDay)}`;
      row.appendChild(label);
      const daysWrap = document.createElement('div'); // Seven-day button container for this row.
      daysWrap.className = 'cal-week-days';
      for (let i = 0; i < DAYS_PER_WEEK; i++) {
        const d = weekStartDay + i; // Raw day represented by this individual calendar cell.
        const cell = document.createElement('button'); // Non-mutating calendar day display button.
        cell.type = 'button';
        cell.className = 'cal-day-btn' + (d === deps.calendar.day ? ' today' : '');
        cell.innerHTML = `<span>${WEEKDAY_NAMES[i]}</span><span class="cal-day-num">${dayOfMonth(d)}</span>`;
        daysWrap.appendChild(cell);
      }
      row.appendChild(daysWrap);
      deps.calWeeks.appendChild(row);
    }
  }

  function bindMonthNav() {
    if (!deps.calPrevMonth || !deps.calNextMonth || deps.calPrevMonth.dataset.calendarBound === '1') return;
    deps.calPrevMonth.dataset.calendarBound = '1';
    deps.calPrevMonth.addEventListener('click', () => {
      if (calViewYear === FIRST_AOT_YEAR && calViewMonthIndex === 0) return;
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

  // ── Shared Sleep / seated Wait menu ───────────────────────────────
  function installTimePassageRuntime() {
    buildTimePassageUi();
    installActionInterceptors();
    installSeatedWaitAction();
  }

  function buildTimePassageUi() {
    if (_timePassageUi || !document.body) return;
    if (!document.getElementById('hobunji-time-passage-style')) {
      const style = document.createElement('style'); // Injected once so the time-passage UI stays owned by its existing calendar module.
      style.id = 'hobunji-time-passage-style';
      style.textContent = `
        .time-passage-backdrop{position:fixed;inset:0;z-index:2147483646;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(7,8,10,.42);font-family:"KhymeryyanRomanLetters+Numbers","DM Mono",ui-monospace,monospace;color:#f4efe4;text-shadow:0 2px 4px rgba(0,0,0,.9)}
        .time-passage-backdrop.open{display:flex}
        .time-passage-backdrop.transitioning{pointer-events:none;background:transparent}
        .time-passage-panel{width:min(620px,94vw);max-height:88vh;overflow:visible;border:0;border-radius:0;background:transparent;box-shadow:none;padding:0;transform:scale(.75);transform-origin:center center}
        .time-passage-title{font-size:clamp(24px,5vw,38px);line-height:1;margin:0 0 14px;text-align:center;font-weight:400}
        .time-passage-dates{display:grid;grid-template-columns:1fr auto 1fr;align-items:stretch;gap:10px;min-height:72px}
        .time-passage-date-card{padding:12px;border:0;border-radius:0;background:transparent;min-width:0}
        .time-passage-date-label{display:block;opacity:.68;font-size:13px;margin-bottom:5px;text-transform:uppercase;letter-spacing:.07em}
        .time-passage-date-value{font-family:inherit;font-size:clamp(12px,2.7vw,15px);line-height:1.45;overflow-wrap:anywhere}
        .time-passage-arrow{align-self:center;font-size:26px;opacity:.72}
        .time-passage-live{display:none;min-height:72px;width:100%;align-items:center;justify-content:center;text-align:center;padding:8px 12px;font-family:inherit;font-size:clamp(18px,4.6vw,29px);line-height:1.3;overflow-wrap:anywhere}
        .time-passage-duration{margin:18px 0 8px;text-align:center}
        .time-passage-hours{font-size:clamp(25px,6vw,42px);line-height:1;margin-bottom:12px}
        .time-passage-slider-row{display:grid;grid-template-columns:48px 1fr 48px;align-items:center;gap:10px}
        .time-passage-slider{width:100%;accent-color:#d8b36e}
        .time-passage-step,.time-passage-btn{border:1px solid rgba(235,210,158,.52);border-radius:9px;background:rgba(18,16,14,.62);color:#fff;font:400 18px "KhymeryyanRomanLetters+Numbers","DM Mono",ui-monospace,monospace;min-height:44px;cursor:pointer;text-shadow:0 2px 3px rgba(0,0,0,.9)}
        .time-passage-step:active,.time-passage-btn:active{transform:translateY(1px)}
        .time-passage-actions{display:grid;grid-template-columns:1fr 1.35fr;gap:10px;margin-top:16px}
        .time-passage-btn.primary{background:rgba(112,85,46,.82);border-color:#d9b873}
        .time-passage-debug{display:block;margin:12px auto 0;border:0;background:transparent;color:rgba(255,255,255,.7);font:400 12px "KhymeryyanRomanLetters+Numbers","DM Mono",ui-monospace,monospace;text-decoration:underline;cursor:pointer;text-shadow:0 2px 3px rgba(0,0,0,.9)}
        .time-passage-backdrop.transitioning .time-passage-dates{display:none}
        .time-passage-backdrop.transitioning .time-passage-live{display:flex}
        .time-passage-backdrop.transitioning .time-passage-slider-row,.time-passage-backdrop.transitioning .time-passage-actions,.time-passage-backdrop.transitioning .time-passage-debug{opacity:.5}
        .time-iris-overlay{position:fixed;inset:0;z-index:2147483645;display:none;pointer-events:auto}
        .time-iris-overlay svg{display:block;width:100%;height:100%}
        @media(max-width:520px){.time-passage-dates{grid-template-columns:1fr}.time-passage-arrow{transform:rotate(90deg);justify-self:center}.time-passage-actions{grid-template-columns:1fr}}
      `;
      document.head.appendChild(style);
    }

    const backdrop = document.createElement('div'); // Shared modal root used by both bed sleep and seated waiting.
    backdrop.className = 'time-passage-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.innerHTML = `
      <div class="time-passage-panel">
        <h2 class="time-passage-title" id="timePassageTitle">Pass Time</h2>
        <div class="time-passage-dates">
          <div class="time-passage-date-card"><span class="time-passage-date-label">Current</span><div class="time-passage-date-value" id="timePassageCurrent"></div></div>
          <div class="time-passage-arrow">➜</div>
          <div class="time-passage-date-card"><span class="time-passage-date-label">After</span><div class="time-passage-date-value" id="timePassagePreview"></div></div>
        </div>
        <div class="time-passage-live" id="timePassageLive" aria-live="polite"></div>
        <div class="time-passage-duration">
          <div class="time-passage-hours" id="timePassageHours">1 hour</div>
          <div class="time-passage-slider-row">
            <button type="button" class="time-passage-step" id="timePassageMinus" aria-label="One hour less">−</button>
            <input class="time-passage-slider" id="timePassageSlider" type="range" min="1" max="${MAX_PASSAGE_HOURS}" step="1" value="1" aria-label="Hours to pass">
            <button type="button" class="time-passage-step" id="timePassagePlus" aria-label="One hour more">+</button>
          </div>
        </div>
        <div class="time-passage-actions">
          <button type="button" class="time-passage-btn" id="timePassageCancel">Cancel</button>
          <button type="button" class="time-passage-btn primary" id="timePassageConfirm">Pass Time</button>
        </div>
        <button type="button" class="time-passage-debug" id="timePassageDebug">Copy time debug</button>
      </div>`;
    document.body.appendChild(backdrop);

    const iris = document.createElement('div'); // Full-viewport SVG mask used by the close-to-black/reopen movie transition.
    iris.className = 'time-iris-overlay';
    iris.setAttribute('aria-hidden', 'true');
    iris.innerHTML = `
      <svg id="timeIrisSvg" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
        <defs><mask id="hobunjiTimeIrisMask" maskUnits="userSpaceOnUse"><rect id="timeIrisMaskBase" fill="white"/><circle id="timeIrisHole" fill="black"/></mask></defs>
        <rect id="timeIrisBlack" fill="black" mask="url(#hobunjiTimeIrisMask)"/>
      </svg>`;
    document.body.appendChild(iris);

    _timePassageUi = {
      backdrop,
      title: backdrop.querySelector('#timePassageTitle'),
      current: backdrop.querySelector('#timePassageCurrent'),
      preview: backdrop.querySelector('#timePassagePreview'),
      live: backdrop.querySelector('#timePassageLive'),
      hours: backdrop.querySelector('#timePassageHours'),
      slider: backdrop.querySelector('#timePassageSlider'),
      minus: backdrop.querySelector('#timePassageMinus'),
      plus: backdrop.querySelector('#timePassagePlus'),
      cancel: backdrop.querySelector('#timePassageCancel'),
      confirm: backdrop.querySelector('#timePassageConfirm'),
      debug: backdrop.querySelector('#timePassageDebug'),
      iris,
      irisSvg: iris.querySelector('#timeIrisSvg'),
      irisBase: iris.querySelector('#timeIrisMaskBase'),
      irisHole: iris.querySelector('#timeIrisHole'),
      irisBlack: iris.querySelector('#timeIrisBlack'),
    }; // Reused by all subsequent open/close/preview/transition operations.

    _timePassageUi.slider.addEventListener('input', event => setSelectedPassageHours(event.target.value));
    _timePassageUi.minus.addEventListener('click', () => setSelectedPassageHours(_selectedPassageHours - 1));
    _timePassageUi.plus.addEventListener('click', () => setSelectedPassageHours(_selectedPassageHours + 1));
    _timePassageUi.cancel.addEventListener('click', closeTimePassageMenu);
    _timePassageUi.confirm.addEventListener('click', confirmTimePassage);
    _timePassageUi.debug.addEventListener('click', copyTimeDebug);
    _timePassageUi.backdrop.addEventListener('pointerdown', event => {
      if (event.target === _timePassageUi.backdrop && !_timePassageUi.backdrop.classList.contains('transitioning')) closeTimePassageMenu();
    });
    _timePassageUi.backdrop.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape' && !_timePassageUi.backdrop.classList.contains('transitioning')) { event.preventDefault(); closeTimePassageMenu(); }
    });
  }

  function acquireTimePassageLock() {
    if (_timePassageLock) return;
    _timePassageLock = window.CharacterActionLocks?.acquire?.({
      owner: 'calendar-time-passage',
      reason: 'sleep/wait menu',
      participants: [PLAYER_ACTION_LOCK_ID],
      channels: ['movement', 'tools', 'actions'],
    }) || null;
  }

  function releaseTimePassageLock() {
    _timePassageLock?.release?.();
    _timePassageLock = null;
  }

  function openTimePassage(kind = 'wait') {
    buildTimePassageUi();
    if (!_timePassageUi?.backdrop) return false;
    _timePassageKind = kind === 'sleep' ? 'sleep' : 'wait';
    _selectedPassageHours = _timePassageKind === 'sleep' ? 8 : 1;
    _timePassageUi.backdrop.classList.remove('transitioning');
    setSelectedPassageHours(_selectedPassageHours);
    _timePassageUi.title.textContent = _timePassageKind === 'sleep' ? 'Sleep' : 'Wait';
    _timePassageUi.backdrop.classList.add('open');
    acquireTimePassageLock();
    refreshTimePassagePreview();
    clearInterval(_passagePreviewTimer);
    _passagePreviewTimer = setInterval(refreshTimePassagePreview, 250);
    requestAnimationFrame(() => _timePassageUi.slider.focus({ preventScroll: true }));
    debugLog(`opened ${_timePassageKind} menu at ${formatCalendarDateTimeFull()}`);
    return true;
  }

  function closeTimePassageMenu(options = {}) {
    if (!_timePassageUi) return;
    _timePassageUi.backdrop.classList.remove('open', 'transitioning');
    clearInterval(_passagePreviewTimer);
    _passagePreviewTimer = 0;
    if (!options.keepLock) releaseTimePassageLock();
    if (!options.keepKind) _timePassageKind = null;
  }

  function setSelectedPassageHours(value) {
    _selectedPassageHours = Math.max(1, Math.min(MAX_PASSAGE_HOURS, Math.round(Number(value) || 1)));
    if (_timePassageUi) {
      _timePassageUi.slider.value = String(_selectedPassageHours);
      _timePassageUi.hours.textContent = `${_selectedPassageHours} ${_selectedPassageHours === 1 ? 'hour' : 'hours'}`;
      const verb = _timePassageKind === 'sleep' ? 'Sleep' : 'Wait'; // Used in the confirm button's contextual label.
      _timePassageUi.confirm.textContent = `${verb} ${_selectedPassageHours} ${_selectedPassageHours === 1 ? 'hour' : 'hours'}`;
    }
    refreshTimePassagePreview();
  }

  function refreshTimePassagePreview() {
    if (!_timePassageUi || !_timePassageUi.backdrop.classList.contains('open') || _timePassageUi.backdrop.classList.contains('transitioning')) return;
    const target = previewAfterHours(_selectedPassageHours); // Used to render the live target date/time card.
    _timePassageUi.current.textContent = formatCalendarDateTimeFull(deps.calendar.day, deps.calendar.time01);
    _timePassageUi.preview.textContent = formatCalendarDateTimeFull(target.day, target.time01);
  }

  function renderTimePassageTick(remainingHours) {
    if (!_timePassageUi) return;
    const verb = _timePassageKind === 'sleep' ? 'Sleeping' : 'Waiting'; // Used as the Skyrim-style progress title while the world is fully black.
    _timePassageUi.title.textContent = `${verb}…`;
    _timePassageUi.live.textContent = formatCalendarDateTimeFull(deps.calendar.day, deps.calendar.time01);
    _timePassageUi.hours.textContent = `${remainingHours} ${remainingHours === 1 ? 'hour' : 'hours'}`;
  }

  async function confirmTimePassage() {
    if (!_timePassageKind || !_timePassageUi) return;
    const kind = _timePassageKind; // Captured because the shared modal state is cleared after transition completion.
    const hours = _selectedPassageHours; // Captured so the selected duration cannot change during the iris transition.
    _timePassageUi.confirm.disabled = true;
    _timePassageUi.backdrop.classList.add('transitioning');
    clearInterval(_passagePreviewTimer);
    _passagePreviewTimer = 0;
    try {
      await runIrisTransition(async () => {
        await advanceBySelectedHours(hours, remaining => renderTimePassageTick(remaining));
        if (kind === 'sleep') restorePlayerAfterSleep();
        persistCalendarSnapshot();
        window.WeatherFX?.updateRainState?.();
        window.dispatchEvent(new CustomEvent('hobunji-time-passage', {
          detail: { kind, hours, day: deps.calendar.day, time01: deps.calendar.time01 },
        }));
      });
      debugLog(`${kind} advanced ${hours}h -> ${formatCalendarDateTimeFull()}`);
    } catch (error) {
      debugLog(`${kind} failed: ${error?.message || error}`, 'error');
    } finally {
      _timePassageUi.confirm.disabled = false;
      closeTimePassageMenu({ keepLock: true, keepKind: true });
      _timePassageKind = null;
      releaseTimePassageLock();
      syncSeatedWaitButton();
    }
  }

  async function advanceBySelectedHours(hours, onHourTick) {
    const totalHours = Math.max(1, Math.min(MAX_PASSAGE_HOURS, Math.round(Number(hours) || 1))); // Used to keep the fully-black progress loop bounded to the selector's legal duration.
    let tickDurationMs = TIME_PASSAGE_FIRST_TICK_MS; // Current visual hold duration; multiplied by 0.8 after every displayed hour.
    onHourTick?.(totalHours); // Shows the starting time and complete remaining count for the full first one-second tick.
    for (let elapsed = 1; elapsed <= totalHours; elapsed++) {
      await delayMs(tickDurationMs);
      await advanceOnePassageHour();
      const remainingHours = totalHours - elapsed; // Used as the direct countdown value instead of an elapsed/total fraction.
      onHourTick?.(remainingHours);
      tickDurationMs *= TIME_PASSAGE_TICK_DECAY;
    }
  }

  async function advanceOnePassageHour() {
    const target = previewAfterHours(1); // Exact next-hour state used after any private game.js day rollover completes.
    if (target.day === deps.calendar.day) {
      setTime01Raw(target.time01);
      return;
    }

    // Let game.js perform its private advanceDay() work only at the true
    // 06:00→next-day-06:00 boundary. 22:00 is just the ordinary night-lighting
    // threshold and must not advance the day. This keeps crop, weather,
    // Tothal, livestock, respawn, and procedural daily systems aligned with
    // the visible hourly count.
    setTime01Raw(deps.calendar.time01 + 1 / activeClockHours());
    const timeoutAt = performance.now() + 1800; // Used to fail visibly instead of holding complete black forever if the private rollover loop stops.
    while ((deps.calendar.day < target.day || deps.calendar.time01 >= 1) && performance.now() < timeoutAt) {
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    if (deps.calendar.day < target.day) {
      throw new Error(`day rollover stalled at raw day ${deps.calendar.day}; expected ${target.day}`);
    }
    setTime01Raw(target.time01); // Removes tiny frame dt accumulated while the masked rollover completed.
  }

  function delayMs(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  function restorePlayerAfterSleep() {
    const player = window.PlayerSocialPoses?.getPlayerEntity?.(); // Uses the existing player-runtime boundary rather than duplicating private game.js player state.
    if (!player) {
      debugLog('sleep completed but player runtime was unavailable for health/stamina restoration', 'warn');
      return;
    }
    if (Number.isFinite(player.maxHealth)) player.health = player.maxHealth;
    if (Number.isFinite(player.maxStamina)) player.stamina = player.maxStamina;
  }

  function persistCalendarSnapshot() {
    const worldId = window.__hobunjiPlayerProfile?.worldId; // Used to update only the active world's calendar record after a same-day skip.
    if (!worldId) return;
    try {
      const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null'); // Used to preserve every non-calendar save field while updating this world.
      const world = (meta?.worlds || []).find(entry => entry.id === worldId); // Active world record receiving the time snapshot below.
      if (!world) return;
      world.calendar = {
        day: deps.calendar.day,
        time01: deps.calendar.time01,
        weather: deps.calendar.weather,
        isRaining: deps.calendar.isRaining,
        rainStrength: deps.calendar.rainStrength,
        nextRainWindows: deps.calendar.nextRainWindows,
        lastRainDay: deps.calendar.lastRainDay,
      };
      localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
    } catch (error) {
      debugLog(`calendar save failed: ${error?.message || error}`, 'warn');
    }
  }

  function runIrisTransition(onClosed) {
    if (!_timePassageUi?.iris) return Promise.resolve().then(onClosed);
    const ui = _timePassageUi; // Used throughout this transition to avoid repeatedly dereferencing shared mutable UI state.
    const width = Math.max(1, window.innerWidth); // Used to size the SVG mask to the current viewport.
    const height = Math.max(1, window.innerHeight); // Used to size the SVG mask to the current viewport.
    const maxRadius = Math.hypot(width, height) * 0.55 + 4; // Used as a hole large enough to reveal every viewport corner before/after the iris.
    const minRadius = 0; // Used for a completely black midpoint while the visible hour count advances.
    ui.irisSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    for (const rect of [ui.irisBase, ui.irisBlack]) {
      rect.setAttribute('x', '0'); rect.setAttribute('y', '0');
      rect.setAttribute('width', String(width)); rect.setAttribute('height', String(height));
    }
    ui.irisHole.setAttribute('cx', String(width / 2));
    ui.irisHole.setAttribute('cy', String(height / 2));
    ui.irisHole.setAttribute('r', String(maxRadius));
    ui.iris.style.display = 'block';

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; // Used to shorten rather than remove the iris animation for reduced-motion users.
    const closeMs = reduced ? 120 : 480; // Used for the black iris-in duration.
    const openMs = reduced ? 140 : 560; // Used for the black iris-out duration after all hourly ticks finish.
    return animateIrisRadius(maxRadius, minRadius, closeMs)
      .then(() => delayMs(reduced ? 20 : 90))
      .then(() => Promise.resolve().then(onClosed))
      .then(() => delayMs(reduced ? 20 : 120))
      .then(() => animateIrisRadius(minRadius, maxRadius, openMs))
      .finally(() => { ui.iris.style.display = 'none'; });
  }

  function animateIrisRadius(from, to, durationMs) {
    return new Promise(resolve => {
      const start = performance.now(); // Used to normalize each animation frame to 0..1 progress.
      const step = now => {
        const t = Math.max(0, Math.min(1, (now - start) / Math.max(1, durationMs))); // Linear progress used to derive the eased radius below.
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // Smooth in/out curve for the classic movie-iris feel.
        _timePassageUi.irisHole.setAttribute('r', String(from + (to - from) * eased));
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  function actionButtonFromTarget(target) {
    const button = target?.closest?.('button'); // Used to normalize taps on nested icon/label spans back to their action button.
    return button && /^btn(?:Item)?Action\d+$/.test(button.id) ? button : null;
  }

  function buttonShowsSleep(button) {
    return !!button
      && !button.classList.contains('abt-hidden')
      && button.dataset.action === 'obj_interact'
      && /\bSleep\b/i.test(button.textContent || '');
  }

  function findSleepActionButton() {
    return ['btnAction1', 'btnAction2', 'btnAction3', 'btnItemAction1', 'btnItemAction2']
      .map(id => document.getElementById(id))
      .find(buttonShowsSleep) || null;
  }

  function isSeatedReady() {
    const stand = document.getElementById('btnAction1'); // Used as the authoritative DOM signal that game.js's private sitInteraction is active.
    return !!stand
      && !stand.classList.contains('abt-hidden')
      && stand.dataset.action === 'obj_stand'
      && !stand.classList.contains('blocked');
  }

  function desktopTapWindowMs() {
    return Number(window.SCRATCHBONES_CONFIG?.game?.desktopControls?.tapWindowMs) || 350;
  }

  function interceptedDesktopContext(key) {
    if (key === 'e') return findSleepActionButton() ? 'sleep' : null;
    if (key === 'q') return isSeatedReady() ? 'wait' : null;
    return null;
  }

  function startInterceptedDesktopHold(key, kind) {
    const state = _interceptedDesktopHolds[key]; // Used to mirror game.js's existing tap-vs-hold state for this contextual interception.
    if (!state || state.down) return;
    state.down = true;
    state.held = false;
    state.kind = kind;
    state.timer = setTimeout(() => {
      if (!state.down) return;
      state.held = true;
      if (state.arc === 'item') window._desktopSelectionArc?.openItem?.();
      else window._desktopSelectionArc?.openTool?.();
    }, desktopTapWindowMs());
  }

  function finishInterceptedDesktopHold(key) {
    const state = _interceptedDesktopHolds[key]; // Used to decide whether release means contextual tap or close held selector.
    if (!state?.down) return false;
    state.down = false;
    if (state.timer) { clearTimeout(state.timer); state.timer = 0; }
    const wasHeld = state.held; // Used to preserve selection-arc close behavior instead of opening Sleep/Wait after a hold.
    state.held = false;
    if (wasHeld) window._desktopSelectionArc?.close?.();
    else openTimePassage(state.kind);
    return true;
  }

  function cancelInterceptedDesktopHolds() {
    for (const state of Object.values(_interceptedDesktopHolds)) {
      if (state.timer) clearTimeout(state.timer);
      if (state.held) window._desktopSelectionArc?.close?.();
      state.down = false;
      state.held = false;
      state.timer = 0;
    }
  }

  function installActionInterceptors() {
    if (document.documentElement.dataset.timePassageInterceptors === '1') return;
    document.documentElement.dataset.timePassageInterceptors = '1';

    const interceptActionPointer = event => {
      const button = actionButtonFromTarget(event.target); // Action-arch button receiving this captured pointer event.
      const wantsWait = button?.dataset.action === 'calendar_wait'; // Used to route the injected seated Action 2 to Wait.
      const wantsSleep = buttonShowsSleep(button); // Used to route the existing bed interaction to the new duration menu.
      if (!wantsWait && !wantsSleep) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'pointerdown') openTimePassage(wantsSleep ? 'sleep' : 'wait');
    };
    document.addEventListener('pointerdown', interceptActionPointer, true);
    document.addEventListener('pointerup', interceptActionPointer, true);
    document.addEventListener('click', interceptActionPointer, true);

    // Desktop E/Q normally distinguish a tap action from a hold that opens
    // the tool/item selection arc. Own the same tap-vs-hold sequence only in
    // bed/seated contexts so a tap opens the time menu while a hold preserves
    // the existing selector behavior.
    window.addEventListener('keydown', event => {
      if (_timePassageUi?.backdrop.classList.contains('open') || event.repeat) return;
      const key = event.code === 'KeyE' ? 'e' : event.code === 'KeyQ' ? 'q' : null; // Contextual key eligible for interception below.
      if (!key) return;
      const kind = interceptedDesktopContext(key); // Sleep/Wait context resolved from the live action arch.
      if (!kind) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      startInterceptedDesktopHold(key, kind);
    }, true);

    window.addEventListener('keyup', event => {
      const key = event.code === 'KeyE' ? 'e' : event.code === 'KeyQ' ? 'q' : null; // Key whose captured hold state may need completion.
      if (!key || !_interceptedDesktopHolds[key].down) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finishInterceptedDesktopHold(key);
    }, true);

    // The normal wheel handler checks game.js's private hold state, which is
    // intentionally bypassed above. Mirror its wheel-to-selection behavior so
    // holding E/Q over a bed/seat remains a complete selector.
    window.addEventListener('wheel', event => {
      const key = _interceptedDesktopHolds.q.down ? 'q' : _interceptedDesktopHolds.e.down ? 'e' : null; // Currently captured held selector, if any.
      if (!key) return;
      const state = _interceptedDesktopHolds[key]; // Hold/arc state mutated below to enter selector mode on first wheel tick.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!state.held) {
        state.held = true;
        if (state.timer) { clearTimeout(state.timer); state.timer = 0; }
        if (state.arc === 'item') window._desktopSelectionArc?.openItem?.();
        else window._desktopSelectionArc?.openTool?.();
      }
      const direction = event.deltaY > 0 ? 1 : -1; // Same sign convention as game.js's existing held-wheel selector.
      if (state.arc === 'item') window._desktopSelectionArc?.scrollItem?.(-direction);
      else window._desktopSelectionArc?.scrollTool?.(-direction);
    }, { capture: true, passive: false });

    window.addEventListener('blur', cancelInterceptedDesktopHolds);

    // Right mouse is the desktop equivalent of Action 2. While seated it
    // should open Wait just like Q and the injected mobile Action 2 button.
    window.addEventListener('pointerdown', event => {
      if (event.button !== 2 || !isSeatedReady() || _timePassageUi?.backdrop.classList.contains('open')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openTimePassage('wait');
    }, true);
  }

  function installSeatedWaitAction() {
    const stack = document.getElementById('actionStack') || document.body; // Mutation root used to notice game.js refreshing the seated action arch.
    if (!stack || stack.dataset.calendarWaitObserved === '1') return;
    stack.dataset.calendarWaitObserved = '1';
    const observer = new MutationObserver(() => { // Keeps Action 2 present after game.js re-renders its private sitInteraction-only Stand layout.
      if (_syncingSeatedWait) return;
      queueMicrotask(syncSeatedWaitButton);
    });
    observer.observe(stack, { subtree: true, childList: true, attributes: true, characterData: true });
    syncSeatedWaitButton();
  }

  function syncSeatedWaitButton() {
    if (_syncingSeatedWait) return;
    const stand = document.getElementById('btnAction1'); // Existing seated Stand slot used as the private sitInteraction proxy.
    const wait = document.getElementById('btnAction2'); // Existing Action 2 slot repurposed only while the Stand proxy is present.
    if (!stand || !wait) return;
    _syncingSeatedWait = true;
    try {
      const seated = !stand.classList.contains('abt-hidden') && stand.dataset.action === 'obj_stand'; // Used to decide whether Wait should occupy Action 2.
      if (seated) {
        const blocked = stand.classList.contains('blocked'); // Keeps Wait disabled during the seat-in transition exactly when Stand is disabled.
        const keyBadge = window.matchMedia?.('(pointer: fine)')?.matches ? '<span class="abt-key">[Q]</span>' : ''; // Desktop-only badge matching the existing arch format.
        const waitHtml = `${keyBadge}<span class="abt-icon">⏳</span><span class="abt-label">Wait</span>`; // Avoids unnecessary DOM rewrites when game.js has not replaced the injected slot.
        if (wait.dataset.timePassageInjected !== '1') wait.dataset.timePassageInjected = '1';
        if (wait.dataset.action !== 'calendar_wait') wait.dataset.action = 'calendar_wait';
        if (wait.classList.contains('abt-hidden')) wait.classList.remove('abt-hidden');
        if (wait.classList.contains('blocked') !== blocked) wait.classList.toggle('blocked', blocked);
        if (wait.innerHTML !== waitHtml) wait.innerHTML = waitHtml;
      } else if (wait.dataset.timePassageInjected === '1') {
        // If game.js has already repopulated the slot with a real action,
        // leave that fresh content alone and only clear our marker.
        if (wait.dataset.action === 'calendar_wait') {
          wait.classList.add('abt-hidden');
          delete wait.dataset.action;
          wait.innerHTML = '';
        }
        delete wait.dataset.timePassageInjected;
      }
    } finally {
      _syncingSeatedWait = false;
    }
  }

  function timeDebugSnapshot() {
    const nextShiftDay = nextCivilYearStartDay(); // Raw day used by the next-Tothal-Shift debug fields below.
    const target = previewAfterHours(_selectedPassageHours); // Current modal selection used by the preview debug field below.
    return {
      rawDay: deps?.calendar?.day ?? null,
      time01: deps?.calendar?.time01 ?? null,
      shortDate: deps ? formatCalendarDate() : null,
      fullDateTime: deps ? formatCalendarDateTimeFull() : null,
      aotYear: deps ? aotYearNumber() : null,
      tothalCycle: deps ? yearNumber() : null,
      civilDayOfYear: deps ? dayOfYear() : null,
      monthNumber: deps ? monthNumber() : null,
      monthName: deps ? monthName() : null,
      dayOfMonth: deps ? dayOfMonth() : null,
      regionalSeason: deps ? seasonForDay().name : null,
      regionalSeasonWeek: deps ? weekOfSeason() : null,
      isFirstriseNewYear: deps ? isCivilYearStart() : null,
      nextTothalShiftRawDay: deps ? nextShiftDay : null,
      nextTothalShiftDate: deps ? formatCalendarDateFull(nextShiftDay) : null,
      nextTothalSeedCycle: deps ? yearNumber(nextShiftDay) : null,
      naturalClockTargetSecondsPerRepresentedDay: TARGET_DAY_LENGTH_SECONDS,
      naturalClockScale: NATURAL_TIME_WRITE_SCALE,
      fullDayHours: FULL_DAY_HOURS,
      maxPassageHours: MAX_PASSAGE_HOURS,
      modalKind: _timePassageKind,
      selectedHours: _selectedPassageHours,
      preview: deps ? formatCalendarDateTimeFull(target.day, target.time01) : null,
      seatedWaitReady: isSeatedReady(),
      sleepTargetReady: !!findSleepActionButton(),
      playerRuntimeReady: !!window.PlayerSocialPoses?.getPlayerEntity?.(),
      worldId: window.__hobunjiPlayerProfile?.worldId || null,
    };
  }

  async function copyTimeDebug() {
    const text = `Time Debug\n${JSON.stringify(timeDebugSnapshot(), null, 2)}`; // Mobile-friendly plain-text report copied/prompted below.
    try {
      await navigator.clipboard.writeText(text);
      if (_timePassageUi?.debug) {
        const oldText = _timePassageUi.debug.textContent; // Used to restore the button label after transient copy feedback.
        _timePassageUi.debug.textContent = 'Copied';
        setTimeout(() => { if (_timePassageUi?.debug) _timePassageUi.debug.textContent = oldText; }, 1200);
      }
    } catch {
      window.prompt?.('Copy time debug:', text);
    }
    return text;
  }

  window.CalendarSystem = {
    init,
    getHour,
    dayOfYear,
    yearNumber, // Existing game.js Tothal integration: stable 1-based deterministic generation cycle, now rolling on Firstrise 1.
    aotYearNumber,
    weekOfYear,
    seasonCycleWeek,
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
    formatClockTime,
    formatCalendarDateTimeFull,
    absDayForMonthStart,
    isCivilYearStart,
    nextCivilYearStartDay,
    previewAfterHours,
    openTimePassage,
    copyTimeDebug,
    timeDebugSnapshot,
    renderCalendarPanel,
    constants: Object.freeze({
      FIRST_AOT_YEAR,
      DAYS_PER_MONTH,
      YEAR_LENGTH_DAYS,
      FULL_DAY_HOURS,
      MAX_PASSAGE_HOURS,
      MONTH_NAMES: [...MONTH_NAMES],
      TARGET_DAY_LENGTH_SECONDS,
    }),
  };
})();
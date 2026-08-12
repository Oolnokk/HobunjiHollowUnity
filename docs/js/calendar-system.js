(() => {
  'use strict';

  // Khymeryyan civil calendar (day/week/month/year derivations + regional
  // seasons), Calendar tab UI, and player-facing time passage. game.js owns
  // the private world/day rollover hooks; this module owns the civil epoch,
  // date/time formatting, sleep/wait menu, and the natural clock-rate shim.
  //
  // IMPORTANT EPOCH DETAIL: calendar.day remains the world's monotonic
  // gameplay day counter, and game day 1 intentionally stays Waxingheat 1 at
  // the existing time01. The civil year itself now starts on Firstrise 1, so
  // the first 84 civil days of 1154 AoT simply predate the game's opening.
  // Regional weather seasons keep their old absolute-world-day phase instead
  // of rotating with the civil year; moving New Year must not move Stormtide.
  let deps = null;

  const WEEKDAY_NAMES = ['Anan', 'Hronu', 'Kruru', 'Muunu', 'Naru', 'Tothu', 'Uung']; // calendar.day 1 falls on Anan
  const DAYS_PER_WEEK = WEEKDAY_NAMES.length; // 7
  const WEEKS_PER_YEAR = 48;
  const YEAR_LENGTH_DAYS = DAYS_PER_WEEK * WEEKS_PER_YEAR; // 336
  const DAYS_PER_MONTH = 28; // exactly 4 weeks
  const FIRST_AOT_YEAR = 1154;
  const MONTH_NAMES = [
    'Firstrise', 'Secondrise', 'Thirdrise',         // Spring — civil year begins here
    'Waxingheat', 'Highheat', 'Waningheat',         // Summer
    'Firstfall', 'Secondfall', 'Thirdfall',         // Fall
    'Shallowfrost', 'Deepfrost', 'Pouringfrost',   // Winter
  ]; // Universal civil months — decoupled from Tanka's regional tropical seasons.
  const GAME_START_MONTH_INDEX = 3; // Used by civilDayOffset() so raw game day 1 remains Waxingheat 1.
  const GAME_START_CIVIL_DAY_OFFSET = GAME_START_MONTH_INDEX * DAYS_PER_MONTH; // Used by all civil year/month derivations.

  // game.js currently advances one complete 6:00→22:00 game day in 288 real
  // seconds. Stardew-like pacing for this game's 16 visible clock-hours is
  // about 672 seconds, so natural time writes are scaled to 3/7 of their old
  // rate. Explicit loads, sleeps, waits, and rollover writes bypass the shim.
  // This keeps the change isolated here instead of adding another clock owner.
  const BASE_DAY_LENGTH_SECONDS = 288;
  const TARGET_DAY_LENGTH_SECONDS = 672;
  const NATURAL_TIME_WRITE_SCALE = BASE_DAY_LENGTH_SECONDS / TARGET_DAY_LENGTH_SECONDS;
  const MAX_NATURAL_TIME_WRITE = 0.02; // Used by the time01 setter to distinguish normal frame ticks from explicit jumps.
  const PLAYER_ACTION_LOCK_ID = 'player'; // Used while the sleep/wait modal or iris transition owns input.
  const MAX_PASSAGE_HOURS = 16; // Used by the shared sleep/wait duration selector; matches the represented 6:00→22:00 clock span.

  // Regional seasons: Northwestern Tanka. These stay anchored to the original
  // absolute world-day cycle even though the civil year now starts at
  // Firstrise. That preserves the existing opening Stormtide phase/weather.
  const seasons = [
    { name: 'Stormtide', emoji: '⛈️',  rainChance: 0.35, stormChance: 0.30, startWeek: 47, endWeek: 14, grassColor: new THREE.Color().setHSL(108/360, 0.58, 0.28), grassDensity: 1.00 },
    { name: 'Deadgrass', emoji: '☀️',  rainChance: 0.06, stormChance: 0.01, startWeek: 15, endWeek: 22, grassColor: new THREE.Color().setHSL(45/360,  0.40, 0.34), grassDensity: 0.40 },
    { name: 'Longpour',  emoji: '🌧️', rainChance: 0.70, stormChance: 0.05, startWeek: 23, endWeek: 38, grassColor: new THREE.Color().setHSL(122/360, 0.55, 0.22), grassDensity: 1.00 },
    { name: 'Coldmuck',  emoji: '🌬️', rainChance: 0.12, stormChance: 0.10, startWeek: 39, endWeek: 46, grassColor: new THREE.Color().setHSL(165/360, 0.15, 0.46), grassDensity: 0.45 },
  ];

  let _rawTimeWrite = false; // Used by setTime01Raw() so explicit time jumps are not slowed by the natural-time accessor.
  let _timeScaleInstalled = false; // Used by installNaturalTimeScale() to avoid redefining calendar.time01 on repeated init calls.
  let _timePassageUi = null; // Populated by buildTimePassageUi(); reused by both Sleep and seated Wait.
  let _timePassageKind = null; // 'sleep'|'wait'; used by the shared modal's copy/confirm text and resource restoration.
  let _selectedPassageHours = 1; // Used by the duration controls and live preview while the modal is open.
  let _timePassageLock = null; // CharacterActionLocks handle held for the open modal/transition.
  let _passagePreviewTimer = 0; // Interval id used to keep the modal's current-time line live while it is open.
  let _syncingSeatedWait = false; // MutationObserver recursion guard while injecting Action 2's seated Wait button.
  const _interceptedDesktopHolds = { // Used to preserve E/Q tap-vs-hold selection behavior when Sleep/Wait intercept those keys.
    e: { down: false, held: false, timer: 0, kind: 'sleep', arc: 'tool' },
    q: { down: false, held: false, timer: 0, kind: 'wait', arc: 'item' },
  };

  function debugLog(message, level = 'info') {
    const log = window.__farmLog || ((text) => console.log(text));
    try { log(`[time] ${message}`, level); } catch { console.log(`[time] ${message}`); }
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    installNaturalTimeScale();
    migrateLegacyTothalYearNumbers();
    bindMonthNav();
    installTimePassageRuntime();
    debugLog(`calendar epoch ready: game day 1 = Waxingheat 1, ${FIRST_AOT_YEAR} AoT; Firstrise 1 begins each civil year`);
    debugLog(`natural clock target: ${TARGET_DAY_LENGTH_SECONDS}s per represented day (${NATURAL_TIME_WRITE_SCALE.toFixed(3)}x previous clock rate)`);
  }

  function positiveModulo(value, modulus) {
    return ((value % modulus) + modulus) % modulus;
  }

  function civilDayOffset(day = deps?.calendar?.day ?? 1) {
    return (day - 1) + GAME_START_CIVIL_DAY_OFFSET;
  }

  function getHour(time01 = deps.calendar.time01) {
    return deps.MORNING_HOUR + time01 * (deps.NIGHT_HOUR - deps.MORNING_HOUR);
  }

  // ── Calendar derivations ──
  // Civil year/month helpers use the Firstrise epoch above. Regional season
  // helpers deliberately use seasonCycleWeek(), preserving the old phase.
  function dayOfYear(day = deps.calendar.day) {
    return positiveModulo(civilDayOffset(day), YEAR_LENGTH_DAYS) + 1;
  }

  function yearNumber(day = deps.calendar.day) {
    return FIRST_AOT_YEAR + Math.floor(civilDayOffset(day) / YEAR_LENGTH_DAYS);
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
    const wk = seasonCycleWeek(day);
    return seasons.find(season => season.startWeek <= season.endWeek
      ? (wk >= season.startWeek && wk <= season.endWeek)
      : (wk >= season.startWeek || wk <= season.endWeek)
    ) || seasons[seasons.length - 1];
  }

  function currentSeason() {
    return seasonForDay(deps.calendar.day);
  }

  function weekOfSeason(day = deps.calendar.day) {
    const wk = seasonCycleWeek(day);
    const season = seasonForDay(day);
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
    const v = n % 100;
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
    const dom = dayOfMonth(day);
    const wk = weekOfSeason(day);
    return `${weekdayNameForDay(day)}, ${monthNumber(day)}/${dom}, ${yearNumber(day)} AoT, ${wk}${ordinalSuffix(wk)} week of ${seasonForDay(day).name}`;
  }

  function formatCalendarDateFull(day = deps.calendar.day) {
    const dom = dayOfMonth(day);
    const wk = weekOfSeason(day);
    return `${weekdayNameForDay(day)}, ${monthName(day)} ${dom}${ordinalSuffix(dom)}, ${yearNumber(day)} AoT — ${wk}${ordinalSuffix(wk)} week of ${seasonForDay(day).name}`;
  }

  function formatClockTime(hour = getHour()) {
    const totalMinutes = Math.round(hour * 60);
    const hours24 = positiveModulo(Math.floor(totalMinutes / 60), 24);
    const minutes = positiveModulo(totalMinutes, 60);
    const suffix = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = ((hours24 + 11) % 12) + 1;
    return `${hours12}:${String(minutes).padStart(2, '0')} ${suffix}`;
  }

  function formatCalendarDateTimeFull(day = deps.calendar.day, time01 = deps.calendar.time01) {
    return `${formatCalendarDateFull(day)} · ${formatClockTime(getHour(time01))}`;
  }

  // Inverse of dayOfYear/yearNumber: returns the raw gameplay day for a
  // civil month start. Firstrise 1, 1154 is raw day -83; Waxingheat 1, 1154
  // is raw day 1; Firstrise 1, 1155 is raw day 253.
  function absDayForMonthStart(year, monthIdx0) {
    return (year - FIRST_AOT_YEAR) * YEAR_LENGTH_DAYS
      + monthIdx0 * DAYS_PER_MONTH
      + 1
      - GAME_START_CIVIL_DAY_OFFSET;
  }

  function isCivilYearStart(day = deps.calendar.day) {
    return monthIndex(day) === 0 && dayOfMonth(day) === 1;
  }

  function nextCivilYearStartDay(day = deps.calendar.day) {
    const currentYearStart = absDayForMonthStart(yearNumber(day), 0);
    return currentYearStart > day ? currentYearStart : absDayForMonthStart(yearNumber(day) + 1, 0);
  }

  // ── Natural clock rate ──
  // game.js owns `calendar.time01 += dt / DAY_LENGTH_SECONDS`; because that
  // state object is injected here, a narrow accessor can scale only those
  // tiny frame-to-frame positive writes. Loads happen before
  // __hobunjiGameStarted, while explicit skips use setTime01Raw().
  function installNaturalTimeScale() {
    if (_timeScaleInstalled || !deps?.calendar) return;
    const calendar = deps.calendar;
    let value = Number(calendar.time01) || 0; // Backing value read by the accessor and written by natural/explicit clock updates.
    Object.defineProperty(calendar, 'time01', {
      configurable: true,
      enumerable: true,
      get() { return value; },
      set(nextValue) {
        const numeric = Number(nextValue);
        if (!Number.isFinite(numeric)) return;
        const delta = numeric - value;
        const isNaturalFrameWrite = !_rawTimeWrite
          && window.__hobunjiGameStarted === true
          && delta > 0
          && delta <= MAX_NATURAL_TIME_WRITE;
        const passageOwnsClock = !!_timePassageKind && !!_timePassageUi
          && (_timePassageUi.backdrop.classList.contains('open') || _timePassageUi.iris.style.display === 'block'); // Used to pause natural drift while choosing/transitioning without blocking explicit rollover writes.
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

  function migrateLegacyTothalYearNumbers() {
    // Previous builds saved Tothal-year IDs as 1, 2, 3... because
    // CalendarSystem.yearNumber() used the raw gameplay epoch. Convert those
    // IDs in place before game.js performs its boot-time checkTothalShift(),
    // preventing this display-era migration from masquerading as a real
    // mid-year Tothal Shift for an existing world.
    try {
      const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
      if (!Array.isArray(meta?.worlds)) return 0;
      let migrated = 0; // Count used only for the mobile-visible time debug log below.
      for (const world of meta.worlds) {
        const oldYear = Number(world?.lastTothalYear);
        if (!Number.isFinite(oldYear) || oldYear < 1 || oldYear >= FIRST_AOT_YEAR) continue;
        const savedDay = Number(world?.calendar?.day);
        world.lastTothalYear = yearNumber(Number.isFinite(savedDay) ? savedDay : 1);
        migrated++;
      }
      if (migrated) {
        localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
        debugLog(`migrated ${migrated} saved Tothal year ${migrated === 1 ? 'id' : 'ids'} to AoT numbering without shifting terrain`);
      }
      return migrated;
    } catch (error) {
      debugLog(`Tothal year migration skipped: ${error?.message || error}`, 'warn');
      return 0;
    }
  }

  function activeClockHours() {
    return deps.NIGHT_HOUR - deps.MORNING_HOUR;
  }

  function previewAfterHours(hours, day = deps.calendar.day, time01 = deps.calendar.time01) {
    const safeHours = Math.max(0, Number(hours) || 0);
    const total = time01 + safeHours / activeClockHours();
    const dayOffset = Math.floor(total);
    return {
      day: day + dayOffset,
      time01: positiveModulo(total, 1),
      hours: safeHours,
    };
  }

  // ── Calendar tab ──
  let calViewYear = FIRST_AOT_YEAR; // Current Calendar-tab civil year; reset to today whenever the tab opens.
  let calViewMonthIndex = 0; // Current Calendar-tab month index; reset to today whenever the tab opens.

  function renderCalendarPanel() {
    if (!deps.calToday) return;
    calViewYear = yearNumber(deps.calendar.day);
    calViewMonthIndex = monthIndex(deps.calendar.day);
    deps.calToday.textContent = formatCalendarDateTimeFull(deps.calendar.day, deps.calendar.time01);
    renderCalendarMonthView();
  }

  function renderCalendarMonthView() {
    if (!deps.calWeeks || !deps.calMonthTitle) return;
    const monthStartDay = absDayForMonthStart(calViewYear, calViewMonthIndex);
    deps.calMonthTitle.textContent = `${MONTH_NAMES[calViewMonthIndex]} — ${calViewYear} AoT`;
    if (deps.calPrevMonth) deps.calPrevMonth.disabled = (calViewYear === FIRST_AOT_YEAR && calViewMonthIndex === 0);

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

  // ── Shared Sleep / seated Wait menu ──
  function installTimePassageRuntime() {
    buildTimePassageUi();
    installActionInterceptors();
    installSeatedWaitAction();
  }

  function buildTimePassageUi() {
    if (_timePassageUi || !document.body) return;
    if (!document.getElementById('hobunji-time-passage-style')) {
      const style = document.createElement('style'); // Injected once; keeps the time passage UI self-contained with its owning system.
      style.id = 'hobunji-time-passage-style';
      style.textContent = `
        .time-passage-backdrop{position:fixed;inset:0;z-index:52000;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(7,8,10,.72);backdrop-filter:blur(2px);font-family:"Pixelify Sans",system-ui,sans-serif;color:#f4efe4}
        .time-passage-backdrop.open{display:flex}
        .time-passage-panel{width:min(620px,94vw);max-height:88vh;overflow:auto;border:2px solid rgba(235,210,158,.72);border-radius:14px;background:linear-gradient(180deg,rgba(43,37,31,.98),rgba(24,23,23,.99));box-shadow:0 20px 70px rgba(0,0,0,.55);padding:18px}
        .time-passage-title{font-size:clamp(24px,5vw,38px);line-height:1;margin:0 0 14px;text-align:center}
        .time-passage-dates{display:grid;grid-template-columns:1fr auto 1fr;align-items:stretch;gap:10px}
        .time-passage-date-card{padding:12px;border:1px solid rgba(255,255,255,.17);border-radius:10px;background:rgba(255,255,255,.055);min-width:0}
        .time-passage-date-label{display:block;opacity:.64;font-size:13px;margin-bottom:5px;text-transform:uppercase;letter-spacing:.07em}
        .time-passage-date-value{font-family:"DM Mono",monospace;font-size:clamp(12px,2.7vw,15px);line-height:1.45;overflow-wrap:anywhere}
        .time-passage-arrow{align-self:center;font-size:26px;opacity:.72}
        .time-passage-duration{margin:18px 0 8px;text-align:center}
        .time-passage-hours{font-size:clamp(25px,6vw,42px);line-height:1;margin-bottom:12px}
        .time-passage-slider-row{display:grid;grid-template-columns:48px 1fr 48px;align-items:center;gap:10px}
        .time-passage-slider{width:100%;accent-color:#d8b36e}
        .time-passage-step,.time-passage-btn{border:1px solid rgba(235,210,158,.45);border-radius:9px;background:rgba(255,255,255,.08);color:#fff;font:700 18px "Pixelify Sans",system-ui,sans-serif;min-height:44px;cursor:pointer}
        .time-passage-step:active,.time-passage-btn:active{transform:translateY(1px)}
        .time-passage-actions{display:grid;grid-template-columns:1fr 1.35fr;gap:10px;margin-top:16px}
        .time-passage-btn.primary{background:#70552e;border-color:#d9b873}
        .time-passage-debug{display:block;margin:12px auto 0;border:0;background:transparent;color:rgba(255,255,255,.58);font:500 12px "DM Mono",monospace;text-decoration:underline;cursor:pointer}
        .time-iris-overlay{position:fixed;inset:0;z-index:2147483646;display:none;pointer-events:auto}
        .time-iris-overlay svg{display:block;width:100%;height:100%}
        @media(max-width:520px){.time-passage-dates{grid-template-columns:1fr}.time-passage-arrow{transform:rotate(90deg);justify-self:center}.time-passage-panel{padding:14px}.time-passage-actions{grid-template-columns:1fr}}
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

    const iris = document.createElement('div'); // Full-viewport SVG mask used by the close-to-a-point / reopen movie transition.
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
    };

    _timePassageUi.slider.addEventListener('input', event => setSelectedPassageHours(event.target.value));
    _timePassageUi.minus.addEventListener('click', () => setSelectedPassageHours(_selectedPassageHours - 1));
    _timePassageUi.plus.addEventListener('click', () => setSelectedPassageHours(_selectedPassageHours + 1));
    _timePassageUi.cancel.addEventListener('click', closeTimePassageMenu);
    _timePassageUi.confirm.addEventListener('click', confirmTimePassage);
    _timePassageUi.debug.addEventListener('click', copyTimeDebug);
    _timePassageUi.backdrop.addEventListener('pointerdown', event => {
      if (event.target === _timePassageUi.backdrop) closeTimePassageMenu();
    });
    _timePassageUi.backdrop.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); closeTimePassageMenu(); }
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
    if (!_timePassageUi || !_timePassageUi.backdrop) return false;
    _timePassageKind = kind === 'sleep' ? 'sleep' : 'wait';
    _selectedPassageHours = _timePassageKind === 'sleep' ? 8 : 1;
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
    _timePassageUi.backdrop.classList.remove('open');
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
      const verb = _timePassageKind === 'sleep' ? 'Sleep' : 'Wait';
      _timePassageUi.confirm.textContent = `${verb} ${_selectedPassageHours} ${_selectedPassageHours === 1 ? 'hour' : 'hours'}`;
    }
    refreshTimePassagePreview();
  }

  function refreshTimePassagePreview() {
    if (!_timePassageUi || !_timePassageUi.backdrop.classList.contains('open')) return;
    const target = previewAfterHours(_selectedPassageHours);
    _timePassageUi.current.textContent = formatCalendarDateTimeFull(deps.calendar.day, deps.calendar.time01);
    _timePassageUi.preview.textContent = formatCalendarDateTimeFull(target.day, target.time01);
  }

  async function confirmTimePassage() {
    if (!_timePassageKind || !_timePassageUi) return;
    const kind = _timePassageKind;
    const hours = _selectedPassageHours;
    _timePassageUi.confirm.disabled = true;
    closeTimePassageMenu({ keepLock: true, keepKind: true });
    try {
      await runIrisTransition(async () => {
        await advanceBySelectedHours(hours);
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
      _timePassageKind = null;
      releaseTimePassageLock();
      syncSeatedWaitButton();
    }
  }

  async function advanceBySelectedHours(hours) {
    const target = previewAfterHours(hours);
    const currentDay = deps.calendar.day;
    const dayDelta = Math.max(0, target.day - currentDay);
    if (dayDelta === 0) {
      setTime01Raw(target.time01);
      return;
    }

    // Let game.js perform its own private advanceDay() work instead of
    // duplicating crop/weather/Tothal/respawn logic here. A temporary time01
    // value >1 causes one normal rollover per frame while the iris is closed.
    setTime01Raw(deps.calendar.time01 + Number(hours) / activeClockHours());
    const timeoutAt = performance.now() + 1800;
    while ((deps.calendar.day < target.day || deps.calendar.time01 >= 1) && performance.now() < timeoutAt) {
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    if (deps.calendar.day < target.day) {
      throw new Error(`day rollover stalled at raw day ${deps.calendar.day}; expected ${target.day}`);
    }
    setTime01Raw(target.time01); // Remove the tiny frame dt accumulated during the masked rollover.
  }

  function restorePlayerAfterSleep() {
    const player = window.PlayerSocialPoses?.getPlayerEntity?.();
    if (!player) {
      debugLog('sleep completed but player runtime was unavailable for health/stamina restoration', 'warn');
      return;
    }
    if (Number.isFinite(player.maxHealth)) player.health = player.maxHealth;
    if (Number.isFinite(player.maxStamina)) player.stamina = player.maxStamina;
  }

  function persistCalendarSnapshot() {
    const worldId = window.__hobunjiPlayerProfile?.worldId;
    if (!worldId) return;
    try {
      const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
      const world = (meta?.worlds || []).find(entry => entry.id === worldId);
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
    const ui = _timePassageUi;
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const maxRadius = Math.hypot(width, height) * 0.55 + 4;
    const minRadius = 2;
    ui.irisSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    for (const rect of [ui.irisBase, ui.irisBlack]) {
      rect.setAttribute('x', '0'); rect.setAttribute('y', '0');
      rect.setAttribute('width', String(width)); rect.setAttribute('height', String(height));
    }
    ui.irisHole.setAttribute('cx', String(width / 2));
    ui.irisHole.setAttribute('cy', String(height / 2));
    ui.irisHole.setAttribute('r', String(maxRadius));
    ui.iris.style.display = 'block';

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const closeMs = reduced ? 120 : 480;
    const openMs = reduced ? 140 : 560;
    return animateIrisRadius(maxRadius, minRadius, closeMs)
      .then(() => Promise.resolve().then(onClosed))
      .then(() => new Promise(resolve => setTimeout(resolve, reduced ? 20 : 90)))
      .then(() => animateIrisRadius(minRadius, maxRadius, openMs))
      .finally(() => { ui.iris.style.display = 'none'; });
  }

  function animateIrisRadius(from, to, durationMs) {
    return new Promise(resolve => {
      const start = performance.now();
      const step = now => {
        const t = Math.max(0, Math.min(1, (now - start) / Math.max(1, durationMs)));
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        _timePassageUi.irisHole.setAttribute('r', String(from + (to - from) * eased));
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  function actionButtonFromTarget(target) {
    const button = target?.closest?.('button');
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
    const stand = document.getElementById('btnAction1');
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
    const state = _interceptedDesktopHolds[key];
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
    const state = _interceptedDesktopHolds[key];
    if (!state?.down) return false;
    state.down = false;
    if (state.timer) { clearTimeout(state.timer); state.timer = 0; }
    const wasHeld = state.held;
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
      const button = actionButtonFromTarget(event.target);
      const wantsWait = button?.dataset.action === 'calendar_wait';
      const wantsSleep = buttonShowsSleep(button);
      if (!wantsWait && !wantsSleep) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'pointerdown') openTimePassage(wantsSleep ? 'sleep' : 'wait');
    };
    document.addEventListener('pointerdown', interceptActionPointer, true);
    document.addEventListener('pointerup', interceptActionPointer, true);
    document.addEventListener('click', interceptActionPointer, true);

    // Desktop E/Q normally distinguish a tap action from a 350ms hold that
    // opens the tool/item selection arc. When the contextual action is Sleep
    // or seated Wait, own that same tap-vs-hold sequence here: a tap opens the
    // time menu, while a hold still opens the exact existing selection arc.
    window.addEventListener('keydown', event => {
      if (_timePassageUi?.backdrop.classList.contains('open') || event.repeat) return;
      const key = event.code === 'KeyE' ? 'e' : event.code === 'KeyQ' ? 'q' : null;
      if (!key) return;
      const kind = interceptedDesktopContext(key);
      if (!kind) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      startInterceptedDesktopHold(key, kind);
    }, true);

    window.addEventListener('keyup', event => {
      const key = event.code === 'KeyE' ? 'e' : event.code === 'KeyQ' ? 'q' : null;
      if (!key || !_interceptedDesktopHolds[key].down) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finishInterceptedDesktopHold(key);
    }, true);

    // The normal wheel handler checks game.js's private hold state, which is
    // intentionally bypassed above. Mirror its wheel-to-selection behavior so
    // holding E/Q over a bed/seat remains a complete, regression-free selector.
    window.addEventListener('wheel', event => {
      const key = _interceptedDesktopHolds.q.down ? 'q' : _interceptedDesktopHolds.e.down ? 'e' : null;
      if (!key) return;
      const state = _interceptedDesktopHolds[key];
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!state.held) {
        state.held = true;
        if (state.timer) { clearTimeout(state.timer); state.timer = 0; }
        if (state.arc === 'item') window._desktopSelectionArc?.openItem?.();
        else window._desktopSelectionArc?.openTool?.();
      }
      const direction = event.deltaY > 0 ? 1 : -1; // Used below with the same sign convention as game.js's held-wheel handler.
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
    const stack = document.getElementById('actionStack') || document.body;
    if (!stack || stack.dataset.calendarWaitObserved === '1') return;
    stack.dataset.calendarWaitObserved = '1';
    const observer = new MutationObserver(() => {
      if (_syncingSeatedWait) return;
      queueMicrotask(syncSeatedWaitButton);
    });
    observer.observe(stack, { subtree: true, childList: true, attributes: true, characterData: true });
    syncSeatedWaitButton();
  }

  function syncSeatedWaitButton() {
    if (_syncingSeatedWait) return;
    const stand = document.getElementById('btnAction1');
    const wait = document.getElementById('btnAction2');
    if (!stand || !wait) return;
    _syncingSeatedWait = true;
    try {
      const seated = !stand.classList.contains('abt-hidden') && stand.dataset.action === 'obj_stand';
      if (seated) {
        const blocked = stand.classList.contains('blocked'); // Used below to keep Wait disabled during the seat-in transition exactly when Stand is disabled.
        const keyBadge = window.matchMedia?.('(pointer: fine)')?.matches ? '<span class="abt-key">[Q]</span>' : '';
        const waitHtml = `${keyBadge}<span class="abt-icon">⏳</span><span class="abt-label">Wait</span>`; // Used to avoid rewriting the DOM when game.js has not changed the injected slot.
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
    const nextShiftDay = nextCivilYearStartDay();
    const target = previewAfterHours(_selectedPassageHours);
    return {
      rawDay: deps?.calendar?.day ?? null,
      time01: deps?.calendar?.time01 ?? null,
      shortDate: deps ? formatCalendarDate() : null,
      fullDateTime: deps ? formatCalendarDateTimeFull() : null,
      civilYear: deps ? yearNumber() : null,
      civilDayOfYear: deps ? dayOfYear() : null,
      monthNumber: deps ? monthNumber() : null,
      monthName: deps ? monthName() : null,
      dayOfMonth: deps ? dayOfMonth() : null,
      regionalSeason: deps ? seasonForDay().name : null,
      regionalSeasonWeek: deps ? weekOfSeason() : null,
      isFirstriseNewYear: deps ? isCivilYearStart() : null,
      nextTothalShiftRawDay: deps ? nextShiftDay : null,
      nextTothalShiftDate: deps ? formatCalendarDateFull(nextShiftDay) : null,
      naturalClockTargetSecondsPerRepresentedDay: TARGET_DAY_LENGTH_SECONDS,
      naturalClockScale: NATURAL_TIME_WRITE_SCALE,
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
    const text = `Time Debug\n${JSON.stringify(timeDebugSnapshot(), null, 2)}`;
    try {
      await navigator.clipboard.writeText(text);
      if (_timePassageUi?.debug) {
        const oldText = _timePassageUi.debug.textContent;
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
    yearNumber,
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
      MONTH_NAMES: [...MONTH_NAMES],
      TARGET_DAY_LENGTH_SECONDS,
    }),
  };
})();
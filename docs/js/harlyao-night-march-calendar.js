(() => {
  'use strict';

  const CONFIG_URL = 'config/harlyao-night-march.json'; // Same authored daily route list used by the live march controller.
  const MONTH_NAMES = [
    'Firstrise', 'Secondrise', 'Thirdrise',
    'Waxingheat', 'Highheat', 'Waningheat',
    'Firstfall', 'Secondfall', 'Thirdfall',
    'Shallowfrost', 'Deepfrost', 'Pouringfrost',
  ]; // Mirrors the civil Calendar tab month labels only so its visible month title can be translated back to raw day space.
  const DETAIL_ID = 'harlyaoCalendarMarchDetail';
  const STYLE_ID = 'harlyao-calendar-march-style';

  let config = null;
  let selectedDay = null;
  let currentMonthKey = null;
  let observer = null;
  let installed = false;

  async function loadConfig() {
    if (config) return config;
    try {
      const response = await fetch(CONFIG_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      config = await response.json();
      decorateMonth();
      return config;
    } catch (error) {
      window.__farmLog?.(`[harlyao-calendar] config load failed: ${error.message}`, 'warn', 'ui');
      return null;
    }
  }

  function routeForDay(day) {
    const routes = config?.routesClockwise || [];
    if (!routes.length) return null;
    const normalized = Math.max(1, Math.floor(Number(day) || 1)); // Matches HarlyaoNightMarch.routeForDay's civil-day clamp exactly.
    return routes[(normalized - 1) % routes.length] || null;
  }

  function parseVisibleMonth() {
    const title = document.getElementById('calMonthTitle')?.textContent?.trim() || '';
    const match = title.match(/^(.+?)\s+—\s+(\d+)\s+AoT$/);
    if (!match) return null;
    const monthIndex = MONTH_NAMES.indexOf(match[1]);
    const year = Number(match[2]);
    if (monthIndex < 0 || !Number.isFinite(year)) return null;
    return { monthIndex, year, key: `${year}:${monthIndex}` };
  }

  function directionText(route) {
    const authored = String(route?.directionLabel || '').replaceAll('-', ' ');
    const directional = authored.replace(/\bto\b/i, '→');
    return directional || (route?.axis === 'z'
      ? (route?.direction >= 0 ? 'north → south' : 'south → north')
      : (route?.direction >= 0 ? 'west → east' : 'east → west'));
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID) || !document.head) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .cal-day-btn.harlyao-march-date{position:relative;overflow:visible}
      .harlyao-cal-marker{position:absolute;right:4px;bottom:3px;width:9px;height:9px;border-radius:50%;border:1px solid rgba(193,255,245,.9);background:rgba(79,217,198,.72);box-shadow:0 0 5px rgba(79,217,198,.95),0 0 10px rgba(79,217,198,.62);pointer-events:none}
      .cal-day-btn.harlyao-march-selected{outline:1px solid rgba(79,217,198,.95);box-shadow:inset 0 0 14px rgba(79,217,198,.16),0 0 9px rgba(79,217,198,.22)}
      #${DETAIL_ID}{margin:7px 0 8px;padding:7px 10px;border-left:2px solid rgba(79,217,198,.82);background:rgba(25,71,68,.18);color:#c8fff5;font-size:12px;line-height:1.4;text-shadow:0 1px 3px rgba(0,0,0,.85)}
      #${DETAIL_ID} .harlyao-cal-detail-date{color:rgba(230,255,251,.68);margin-right:5px}
      #${DETAIL_ID} .harlyao-cal-detail-route{color:#effffb}
    `;
    document.head.appendChild(style);
  }

  function detailElement() {
    let detail = document.getElementById(DETAIL_ID);
    if (detail) return detail;
    const today = document.getElementById('calToday');
    if (!today?.parentNode) return null;
    detail = document.createElement('div');
    detail.id = DETAIL_ID;
    detail.hidden = true;
    detail.setAttribute('role', 'status');
    detail.setAttribute('aria-live', 'polite');
    today.insertAdjacentElement('afterend', detail);
    return detail;
  }

  function clearSelection() {
    selectedDay = null;
    document.querySelectorAll('.cal-day-btn.harlyao-march-selected').forEach(cell => cell.classList.remove('harlyao-march-selected'));
    const detail = document.getElementById(DETAIL_ID);
    if (detail) {
      detail.hidden = true;
      detail.textContent = '';
    }
  }

  function selectDay(cell, rawDay, route) {
    selectedDay = rawDay;
    document.querySelectorAll('.cal-day-btn.harlyao-march-selected').forEach(other => other.classList.toggle('harlyao-march-selected', other === cell));
    const detail = detailElement();
    if (!detail) return;
    const dateText = window.CalendarSystem?.formatCalendarDateFull?.(rawDay) || `Day ${rawDay}`;
    const windowText = `${Number(config?.activeHours?.start ?? 0) === 0 ? '12:00 AM' : `${config.activeHours.start}:00`}–${Number(config?.activeHours?.end ?? 6)}:00 AM`;
    detail.innerHTML = `<span class="harlyao-cal-detail-date">${dateText}</span> <span class="harlyao-cal-detail-route">✦ Harlyao Night March · ${route.label || route.zoneId} · ${directionText(route)} · ${windowText}</span>`;
    detail.hidden = false;
  }

  function decorateCell(cell, rawDay, route) {
    if (!cell || !route) return;
    cell.classList.add('harlyao-march-date');
    cell.dataset.harlyaoMarchDay = String(rawDay);
    cell.dataset.harlyaoMarchZone = route.zoneId || '';
    const label = `Harlyao Night March: ${route.label || route.zoneId}, ${directionText(route)}`;
    cell.title = cell.title ? `${cell.title} · ${label}` : label;
    cell.setAttribute('aria-label', `${cell.textContent.trim()} · ${label}`);
    if (!cell.querySelector('.harlyao-cal-marker')) {
      const marker = document.createElement('span');
      marker.className = 'harlyao-cal-marker';
      marker.setAttribute('aria-hidden', 'true');
      cell.appendChild(marker);
    }
    if (Number(selectedDay) === rawDay) cell.classList.add('harlyao-march-selected');
    if (cell.dataset.harlyaoMarchBound !== '1') {
      cell.dataset.harlyaoMarchBound = '1';
      cell.addEventListener('click', () => {
        const day = Number(cell.dataset.harlyaoMarchDay);
        const liveRoute = routeForDay(day);
        if (liveRoute) selectDay(cell, day, liveRoute);
      });
    }
  }

  function decorateMonth() {
    if (!config || !window.CalendarSystem?.absDayForMonthStart) return false;
    const visible = parseVisibleMonth();
    const weeks = document.getElementById('calWeeks');
    if (!visible || !weeks) return false;
    if (currentMonthKey !== visible.key) {
      currentMonthKey = visible.key;
      clearSelection();
    }
    const startDay = window.CalendarSystem.absDayForMonthStart(visible.year, visible.monthIndex);
    const cells = [...weeks.querySelectorAll('.cal-day-btn')];
    for (let index = 0; index < cells.length; index++) {
      const rawDay = startDay + index;
      decorateCell(cells[index], rawDay, routeForDay(rawDay));
    }
    return cells.length > 0;
  }

  function install() {
    if (installed) return true;
    const weeks = document.getElementById('calWeeks');
    if (!weeks || typeof MutationObserver !== 'function') return false;
    ensureStyle();
    detailElement();
    observer = new MutationObserver(() => queueMicrotask(decorateMonth)); // Month navigation replaces week rows; one deferred redecorate follows each replacement.
    observer.observe(weeks, { childList: true });
    installed = true;
    decorateMonth();
    return true;
  }

  function debugSnapshot() {
    const visible = parseVisibleMonth();
    return {
      installed,
      configReady: !!config,
      visibleMonth: visible,
      markedDays: document.querySelectorAll?.('.cal-day-btn.harlyao-march-date')?.length || 0,
      selectedDay,
      selectedZone: selectedDay ? routeForDay(selectedDay)?.zoneId || null : null,
    };
  }

  window.HarlyaoNightMarchCalendar = Object.freeze({
    install,
    loadConfig,
    routeForDay,
    decorateMonth,
    debugSnapshot,
    __test: Object.freeze({ directionText }),
  });

  if (!install() && typeof window.addEventListener === 'function') window.addEventListener('DOMContentLoaded', install, { once: true });
  loadConfig();
})();

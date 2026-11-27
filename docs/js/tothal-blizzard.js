// Tothal Shift's deterministic, month-boundary wilderness weather event.
// Calendar raw days run 06:00→06:00; the shift itself is day 1 at 06:00.
// Thus the storm starts at civil midnight on day 28 (30h before the shift),
// peaks at civil midnight on day 1 (6h before the shift), stops at 06:00,
// and its snow finishes melting at noon. No additional persistent timer.
(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TothalBlizzard = api;
})(typeof window !== 'undefined' ? window : null, function(root) {
  'use strict';
  const ZONES = Object.freeze([
    'map_western_slope', 'map_northern_cliffs',
    'map_southern_cloud_forest', 'map_eastern_mire',
  ]); // Exact four wilderness destinations; no town/farm/interior precipitation.
  const MONTH_DAYS = 28; // Matches CalendarSystem's monthly Tothal seed cycle.
  const ROLLOVER_HOUR = 6; // Same day boundary as SkyDome and CalendarSystem.
  const START_TO_PEAK_HOURS = 24; // Slow rising action before shift midnight.
  const PEAK_TO_CLEAR_HOURS = 6; // Storm dissipates by 06:00.
  const SNOW_CLEAR_HOURS = 6; // Existing/extra snow melts by noon.
  const clamp01 = n => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
  const ease = n => { const x = clamp01(n); return x * x * (3 - 2 * x); };
  const zero = Object.freeze({ active: false, elapsedHours: null, shiftDay: null, storm: 0, snow: 0, phase: 'clear' });
  let lastDay = NaN; // Last raw day used by the frame-wide state cache below.
  let lastHour = NaN; // Last civil clock hour used by the same cache.
  let lastState = zero; // Shared immutable event snapshot for all weather/AI consumers.

  function stateFor(day, hour) {
    if (!Number.isFinite(day) || !Number.isFinite(hour) || day < 1) return zero;
    // A 00:00–05:59 hour belongs to the raw day that began at 06:00 yesterday.
    const absoluteHour = day * 24 + ((hour - ROLLOVER_HOUR + 24) % 24);
    const currentShiftDay = Math.floor((day - 1) / MONTH_DAYS) * MONTH_DAYS + 1;
    const thisPeak = currentShiftDay * 24 - ROLLOVER_HOUR; // Shift-day midnight, six hours before the 06:00 map regeneration.
    const peak = absoluteHour < thisPeak + PEAK_TO_CLEAR_HOURS + SNOW_CLEAR_HOURS
      ? thisPeak : (currentShiftDay + MONTH_DAYS) * 24 - ROLLOVER_HOUR;
    const elapsedHours = absoluteHour - (peak - START_TO_PEAK_HOURS);
    const total = START_TO_PEAK_HOURS + PEAK_TO_CLEAR_HOURS + SNOW_CLEAR_HOURS;
    if (peak < MONTH_DAYS * 24 || elapsedHours < 0 || elapsedHours >= total) return zero;
    const storm = elapsedHours <= START_TO_PEAK_HOURS
      ? 0.12 + 0.88 * ease(elapsedHours / START_TO_PEAK_HOURS)
      : 1 - ease((elapsedHours - START_TO_PEAK_HOURS) / PEAK_TO_CLEAR_HOURS);
    const snow = elapsedHours <= START_TO_PEAK_HOURS
      ? ease(elapsedHours / START_TO_PEAK_HOURS)
      : elapsedHours <= START_TO_PEAK_HOURS + PEAK_TO_CLEAR_HOURS
        ? 1 : 1 - ease((elapsedHours - START_TO_PEAK_HOURS - PEAK_TO_CLEAR_HOURS) / SNOW_CLEAR_HOURS);
    const phase = elapsedHours < START_TO_PEAK_HOURS ? 'rising'
      : elapsedHours < START_TO_PEAK_HOURS + PEAK_TO_CLEAR_HOURS ? 'falling'
      : 'melting';
    return { active: true, elapsedHours, shiftDay: Math.round((peak + ROLLOVER_HOUR) / 24), storm: clamp01(storm), snow: clamp01(snow), phase };
  }

  function currentState() {
    const calendar = root?.WeatherFX?.getProjection?.()?.calendar;
    const day = Number(calendar?.day);
    // Only raw days 27, 28 and 1 of the 28-day cycle can contain storm or melt.
    // Keep the day read live for time skips, loads, and co-op area ticks.
    if (!Number.isFinite(day) || day <= 1 || (Number.isInteger(day) && (day - 1) % MONTH_DAYS < MONTH_DAYS - 2 && (day - 1) % MONTH_DAYS !== 0)) {
      lastDay = day; lastHour = NaN; lastState = zero;
      return zero;
    }
    const hour = Number(root?.CalendarSystem?.getHour?.());
    if (day === lastDay && hour === lastHour) return lastState;
    lastDay = day; lastHour = hour;
    const next = stateFor(day, hour); // Share immutable snapshots across weather and actor consumers.
    lastState = next === zero ? zero : Object.freeze(next);
    return lastState;
  }
  const wilderness = area => ZONES.includes(String(area || ''));
  function stormIntensityFor(area) { return wilderness(area) ? currentState().storm : 0; }
  function snowCoverageFor(area) { return wilderness(area) ? currentState().snow : 0; }
  function isShelteringFor(area) { return wilderness(area) && stormIntensityFor(area) > 0.01; }
  function debugSnapshot(area = root?.GridTileAccessors?.getCurrentArea?.()) {
    const state = currentState(); // One coherent clock sample per mobile diagnostic.
    const inWilderness = wilderness(area);
    return { ...state, zone: String(area || ''), wilderness: inWilderness,
      effectiveStorm: inWilderness ? state.storm : 0, effectiveSnow: inWilderness ? state.snow : 0,
      westernSlopeDepthMultiplier: 1 + 0.5 * state.snow,
      note: 'Rises day-28 midnight → shift midnight; wind ends 06:00, snow melts by noon' };
  }
  return Object.freeze({ ZONES, stateFor, currentState, wilderness,
    stormIntensityFor, snowCoverageFor, isShelteringFor, debugSnapshot });
});

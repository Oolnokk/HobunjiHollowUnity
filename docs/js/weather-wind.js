(() => {
  'use strict';

  // Shared atmospheric wind authority. Everything samples this inexpensive function,
  // rather than maintaining independent wind strengths for mist, vegetation and SFX.
  const ZONES = Object.freeze({
    map_western_slope: Object.freeze({ base: 0.66, gust: 0.23, phase: 0.6, source: 'mountain/Highplains katabatic funnel' }),
    map_northern_cliffs: Object.freeze({ base: 0.73, gust: 0.21, phase: 2.3, source: 'mountain/Highplains katabatic funnel' }),
    map_southern_cloud_forest: Object.freeze({ base: 0.24, gust: 0.10, phase: 4.1, source: 'sheltered cloud forest' }),
    map_opening_cloud_forest: Object.freeze({ base: 0.24, gust: 0.10, phase: 4.1, source: 'sheltered cloud forest' }),
    map_eastern_mire: Object.freeze({ base: 0.17, gust: 0.10, phase: 1.8, source: 'sheltered lowlands' }),
    farm: Object.freeze({ base: 0.15, gust: 0.09, phase: 3.4, source: 'settled valley' }),
    town: Object.freeze({ base: 0.13, gust: 0.08, phase: 5.2, source: 'sheltered town' }),
  }); // Explicit zone profiles ensure the Western Slope/Northern Cliffs dominate outside storms.
  const DEFAULT_ZONE = Object.freeze({ base: 0.19, gust: 0.10, phase: 0, source: 'ordinary outdoors' }); // Fallback for new and unspecified wilderness zones.
  const clamp01 = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); // Used to bound all shared wind strengths.
  const weatherCalendar = () => window.WeatherFX?.getProjection?.()?.calendar || null; // Reuses the already-initialized weather owner's calendar, without extra listeners.
  const currentSeconds = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000; // One clock shared by audio, fog and vegetation.

  function profileForArea(area) {
    return ZONES[String(area || '')] || DEFAULT_ZONE;
  }

  function gustForArea(area, seconds = currentSeconds()) {
    const profile = profileForArea(area); // Provides a distinct phase and gust magnitude for each biome.
    const time = Number.isFinite(seconds) ? seconds : 0;
    return clamp01(0.47 + 0.33 * Math.sin(time * 0.23 + profile.phase)
      + 0.23 * Math.sin(time * 0.079 + profile.phase * 1.57));
  }

  function precipitationFor(calendar) {
    if (!calendar?.isRaining) return 0;
    return Math.max(0, Number(calendar.rainStrength) || 0);
  }

  function strengthForArea(area, calendar = weatherCalendar(), seconds = currentSeconds()) {
    const profile = profileForArea(area); // Determines the actual wind range, irrespective of precipitation.
    const snowOrRain = precipitationFor(calendar); // Provides weather's extra wind over the regional katabatic baseline.
    if (area === 'map_western_slope' && snowOrRain >= 3) return 1; // A proper Slope blizzard is full force.
    const gust = gustForArea(area, seconds);
    return clamp01(profile.base + profile.gust * (gust - 0.4)
      + Math.min(0.3, snowOrRain * 0.09));
  }

  function vegetationSwayForArea(area, calendar = weatherCalendar(), seconds = currentSeconds()) {
    // Existing grass/foliage shader uniforms expect roughly 0.03 in normal weather,
    // 0.06 in rain and 0.10 in storms. Keep that scale; don't use raw 0..1 wind.
    return Math.min(0.14, 0.015 + strengthForArea(area, calendar, seconds) * 0.12);
  }

  function getDebugState(area = window.Music?.weatherRegionForArea?.() || weatherCalendar()?.area || '') {
    const calendar = weatherCalendar(); // Diagnostic data follows the same weather source as production.
    return {
      area, strength: strengthForArea(area, calendar), gust: gustForArea(area),
      precipitation: precipitationFor(calendar),
      profile: { ...profileForArea(area) },
      vegetationSway: vegetationSwayForArea(area, calendar),
      range: [0, 1], source: 'shared wind for snow fog, vegetation and SFX',
    };
  }

  window.WeatherWind = Object.freeze({
    profileForArea, gustForArea, strengthForArea, vegetationSwayForArea, getDebugState,
    getStrengthForArea: strengthForArea, // Stable public getter for scene- and audio-facing consumers.
  });
})();

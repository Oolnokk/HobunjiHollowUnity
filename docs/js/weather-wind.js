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
  const windSample = { area: null, frame: -1, profile: DEFAULT_ZONE, gust: 0, precipitation: NaN, strength: 0 }; // One allocation reused by all listeners in the same 60Hz atmospheric sample.

  function profileForArea(area) {
    return ZONES[String(area || '')] || DEFAULT_ZONE;
  }

  function sampleForArea(area, seconds) {
    const time = Number.isFinite(seconds) ? seconds : 0;
    const frame = Math.floor(time * 60); // Atmospheric gusts change at most 60 times/s, regardless of FPS or consumer count.
    if (windSample.area !== area || windSample.frame !== frame) {
      const profile = profileForArea(area); // Each zone keeps its own authored wind baseline and gust phase.
      windSample.area = area;
      windSample.frame = frame;
      windSample.profile = profile;
      windSample.gust = clamp01(0.47 + 0.33 * Math.sin(time * 0.23 + profile.phase)
        + 0.23 * Math.sin(time * 0.079 + profile.phase * 1.57));
      windSample.precipitation = NaN; // New zone/time requires recalculating the weather contribution.
    }
    return windSample;
  }

  function gustForArea(area, seconds = currentSeconds()) {
    return sampleForArea(area, seconds).gust; // Fog diagnostics reuse the same sample as visuals and audio.
  }

  function precipitationFor(calendar) {
    if (!calendar?.isRaining) return 0;
    return Math.max(0, Number(calendar.rainStrength) || 0);
  }

  function strengthForArea(area, calendar = weatherCalendar(), seconds = currentSeconds()) {
    const sample = sampleForArea(area, seconds); // Reuses this frame's gust even across mist, foliage and audio calls.
    const snowOrRain = precipitationFor(calendar); // Existing rain forecast, unchanged by the Tothal event.
    const blizzard = window.TothalBlizzard?.stormIntensityFor?.(area) || 0; // Shared monthly peak: stronger than ordinary Slope wind in every wilderness zone.
    const weatherKey = snowOrRain + blizzard * 10; // Include the event in the cached result without another timer or scanning any actors.
    if (sample.precipitation !== weatherKey) {
      sample.precipitation = weatherKey;
      const ordinary = area === 'map_western_slope' && snowOrRain >= 3 ? 1
        : clamp01(sample.profile.base + sample.profile.gust * (sample.gust - 0.4)
          + Math.min(0.3, snowOrRain * 0.09));
      sample.strength = blizzard > 0 ? Math.max(ordinary, 0.52 + 1.2 * blizzard + sample.gust * 0.12) : ordinary;
    }
    return sample.strength;
  }

  function vegetationSwayForArea(area, calendar = weatherCalendar(), seconds = currentSeconds()) {
    // Existing grass/foliage shader uniforms expect roughly 0.03 in normal weather,
    // 0.06 in rain and 0.10 in storms. Keep that scale; don't use raw 0..1 wind.
    const cap = window.TothalBlizzard?.stormIntensityFor?.(area) > 0 ? 0.24 : 0.14; // Extreme shift wind can visibly bend grass more than any normal blizzard.
    return Math.min(cap, 0.015 + strengthForArea(area, calendar, seconds) * 0.12);
  }

  function getDebugState(area = window.Music?.weatherRegionForArea?.() || weatherCalendar()?.area || '') {
    const calendar = weatherCalendar(); // Diagnostic data follows the same weather source as production.
    return {
      area, strength: strengthForArea(area, calendar), gust: gustForArea(area),
      precipitation: precipitationFor(calendar),
      profile: { ...profileForArea(area) },
      vegetationSway: vegetationSwayForArea(area, calendar),
      range: [0, window.TothalBlizzard?.stormIntensityFor?.(area) > 0 ? 1.85 : 1],
      tothalStorm: window.TothalBlizzard?.stormIntensityFor?.(area) || 0,
      source: 'shared wind for snow fog, vegetation and SFX',
    };
  }

  window.WeatherWind = Object.freeze({
    profileForArea, gustForArea, strengthForArea, vegetationSwayForArea, getDebugState,
    getStrengthForArea: strengthForArea, // Stable public getter for scene- and audio-facing consumers.
  });
})();

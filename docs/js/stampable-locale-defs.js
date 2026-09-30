// Locale definitions the Tothal Shift stamps into the wilderness (moved out of
// game.js's loadStampableLocaleDefs). Great Fey shrines, the Researcher's
// Tent and ruin-entrance templates are randomly placed each Shift; dwellings
// are excluded (see FIXED_LOCALE_LANDMARKS in js/wilderness-map.js).
//
// Fetched once per page load and cached -- the locale JSON files rarely
// change mid-session, and every Tothal Shift needs the same list.
(() => {
  'use strict';

  const STAMPED_CATEGORIES = new Set(['great_fey_shrine', 'story_poi', 'ruin_entrance']);
  let deps = null;
  let promise = null;

  function log(message, level) { (deps?.debugLog || console.log)(message, level); }

  function isStamped(entry) { return STAMPED_CATEGORIES.has(entry?.category); }

  function load() {
    if (promise) return promise;
    promise = (async () => {
      // Local override (see docs/js/local-db-overrides.js): unlike the
      // single-file databases, locale-editor's workspace holds the FULL
      // content of every locale it has loaded (not just an index), so an
      // active 'locales' override supplies already-fetched docs directly and
      // skips the index+per-file fetch below entirely.
      if (window.LocalDBOverrides?.getSourceMode() === 'local') {
        const override = window.LocalDBOverrides.getOverride('locales');
        if (override?.locales) return override.locales.filter(isStamped);
      }
      try {
        const idxRes = await fetch('config/locales/index.json');
        if (!idxRes.ok) throw new Error(`HTTP ${idxRes.status}`);
        const idx = await idxRes.json();
        const defs = [];
        for (const entry of (idx.locales || []).filter(isStamped)) {
          try {
            const r = await fetch(entry.file);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            defs.push(await r.json());
          } catch (e) { log(`Tothal Shift: locale load failed for ${entry.file}: ${e.message}`, 'warn'); }
        }
        return defs;
      } catch (e) {
        log('Tothal Shift: locale index load failed: ' + e.message, 'warn');
        return [];
      }
    })();
    return promise;
  }

  window.StampableLocaleDefs = Object.freeze({ init(injected) { deps = injected; }, load, isStamped, STAMPED_CATEGORIES });
})();

// Compact "what was going on" counters for Pixel Probe reports (hostiles by state and distance, companions, animals), so two
// recordings can be compared like for like. Read on demand only (probe tap and the start/end of a performance window);
// it never runs per frame. Numbers only, so the performance window can diff start vs end.
(function () {
  'use strict';
  const CHASE_STATE = /chase|attack|aggro|combat|windup|strike|flee/i; // States where a creature is actively engaging.
  function summary() {
    const deps = window.Combat?.deps;
    if (!deps?.player || !deps.TILE) return null;
    const area = deps.getCurrentArea?.(), px = deps.player.x, py = deps.player.y, tile = deps.TILE;
    const out = { hostilesAlive: 0, hostilesInArea: 0, hostilesEngaged: 0, hostilesWithin10: 0, hostilesWithin20: 0, hostilesWithin40: 0,
      engagedWithin20: 0, companions: 0, animals: 0 };
    for (const c of deps.hostileObjects || []) {
      if (!c || !(c.health > 0)) continue;
      out.hostilesAlive++;
      if (area && c.areaId && c.areaId !== area) continue;
      out.hostilesInArea++;
      const engaged = CHASE_STATE.test(String(c.state || ''));
      if (engaged) out.hostilesEngaged++;
      const distance = Math.hypot((c.x || 0) - px, (c.y || 0) - py) / tile;
      if (distance <= 10) out.hostilesWithin10++;
      if (distance <= 20) { out.hostilesWithin20++; if (engaged) out.engagedWithin20++; }
      if (distance <= 40) out.hostilesWithin40++;
    }
    out.companions = (deps.companionObjects || []).filter(c => c && c.health > 0).length;
    out.animals = (deps.animalObjects || []).filter(c => c && c.health > 0).length;
    return out;
  }
  function format() {
    const s = summary();
    return s ? `Scene load: hostiles alive=${s.hostilesAlive} inArea=${s.hostilesInArea} engaged=${s.hostilesEngaged} | within 10/20/40 tiles=${s.hostilesWithin10}/${s.hostilesWithin20}/${s.hostilesWithin40} (engaged within 20=${s.engagedWithin20}) | companions=${s.companions} animals=${s.animals}` : null;
  }
  window.SceneLoadSummary = Object.freeze({ summary, format });
})();

(() => {
  'use strict';
  // npc-schedule: preserved parser-time script order. Maintain member versions here, not in index.html.
  const scriptUrls = [
    "js/npc-agenda.js?v=20261018a",
    "js/npc-activities.js?v=20261109lazyCaveNpc1",
    "js/npc-social-stimuli.js?v=20260902a",
    "js/npc-activity-planner.js?v=20261111communion1",
    "js/npc-scheduling.js?v=20261110check8bebafa",
    "js/npc-farm-plots.js?v=20261109familyaudit2",
    "config/npcs/social-relations.js?v=20261111communion1",
    "js/npc-social-seating-bridge.js?v=20261111communion1",
    "js/npc-pathfinding.js?v=20261114h58f65a8",
    "js/nohuknuk-wilderness.js?v=20261110nohukWaterCache1",
    "js/npc-route-graph.js?v=20261009h41465f3"
]; // Independently versioned modules loaded before game.js.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  // document.write keeps classic scripts ordered and blocking; async injection would change startup semantics.
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();

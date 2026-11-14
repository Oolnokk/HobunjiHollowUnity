(() => {
  'use strict';
  // festival: preserved parser-time script order. Maintain member versions here, not in index.html.
  const scriptUrls = [
    "js/festival-ancestor-figures.js?v=20261111h74436ed",
    "js/festival-props.js?v=20261109festivalMerge2",
    "js/festival-wheel-dance-runtime.js?v=20261020h3d77f11",
    "js/npc-festival-dance.js?v=20261020hd350a73",
    "js/npc-shared-meals.js?v=20261021hdde83ea",
    "js/festival-potluck-contest.js?v=20261109festRarityMerge2",
    "js/festival-locale-activities.js?v=20261109festivalMerge2",
    "js/festival-offering-ritual.js?v=20261110tzkFortune1",
    "js/festival-system.js?v=20261110tzkFortune1",
    "js/festival-dialogue.js?v=20261022h561ec26",
    "js/festival-ui.js?v=20261110tzkFortune1"
]; // Independently versioned modules loaded before game.js.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  // document.write keeps classic scripts ordered and blocking; async injection would change startup semantics.
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();

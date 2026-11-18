(() => {
  'use strict';
  // festival: preserved parser-time script order. Maintain member versions here, not in index.html.
  const scriptUrls = [
    "js/festival-ancestor-figures.js?v=20261111h74436ed",
    "js/festival-props.js?v=20261118blossomPng25v3",
    "js/festival-wheel-dance-runtime.js?v=20261118festival1954x1955a",
    "js/npc-festival-dance.js?v=20261020hd350a73",
    "js/npc-shared-meals.js?v=20261021hdde83ea",
    "js/festival-potluck-contest.js?v=20261109festRarityMerge2",
    "js/festival-locale-activities.js?v=20261118fiveBlossomsLocale1",
    "js/festival-offering-ritual.js?v=20261110tzkFortune1",
    "js/locale-riddle-generator.js?v=20261118blossomRiddle1", // Pure, reusable terrain-verified rhyming clue generator.
    "js/festival-blossom-hunt.js?v=20261118blossomHunt1", // Weeklong quest adapter; no extra animation loop.
    "js/festival-system.js?v=20261118festival1954x1955a",
    "js/festival-dialogue.js?v=20261115spouseSocialLife1",
    "js/festival-ui.js?v=20261118fiveBlossomsUI1"
]; // Independently versioned modules loaded before game.js.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  // document.write keeps classic scripts ordered and blocking; async injection would change startup semantics.
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();

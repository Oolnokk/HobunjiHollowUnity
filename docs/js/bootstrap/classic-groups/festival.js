(() => {
  'use strict';
  // festival: preserved parser-time script order. Maintain member versions here, not in index.html.
  const scriptUrls = [
    "js/festival-ancestor-figures.js?v=20261122keyghostAudit2",
    "js/festival-props.js?v=20261118blossomPng25v3",
    "js/festival-wheel-dance-runtime.js?v=20261126bedNpcOnly1",
    "js/npc-festival-dance.js?v=20261020hd350a73",
    "js/npc-shared-meals.js?v=20261021hdde83ea",
    "js/festival-potluck-contest.js?v=20261122perception1",
    "js/festival-locale-activities.js?v=20261118fiveBlossomsLocale1",
    "js/festival-offering-ritual.js?v=20261110tzkFortune1",
    "js/locale-riddle-generator.js?v=20261118localAnchor1",
    "js/festival-blossom-petals.js?v=20261119petalFallAudit2",
    "js/festival-blossom-hunt.js?v=20261122blossomTrunkOutlines2",
    "js/festival-blossom-start-cue.js?v=20261119swatchDecal3",
    "js/festival-blossom-ceremony.js?v=20261126h6301742",
    "js/festival-system.js?v=20261122perception2",
    "js/festival-dialogue.js?v=20261115spouseSocialLife1",
    "js/festival-ui.js?v=20261118fiveBlossomsUI1"
]; // Independently versioned modules loaded before game.js.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  // document.write keeps classic scripts ordered and blocking; async injection would change startup semantics.
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();

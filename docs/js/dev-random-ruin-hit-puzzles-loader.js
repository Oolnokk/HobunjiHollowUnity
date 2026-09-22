// Parser-time loader for the larger dev-only hit-puzzle runtime. The source is
// split into tiny inert base64 part scripts so this experimental harness stays
// independently replaceable without making camera-look-clamp or the base ruin
// adapter huge. document.write keeps every part + assembly synchronous, which is
// required because the assembled runtime must wrap input/combat APIs before the
// structural/base ruin adapters install their listeners.
(() => {
  'use strict';
  window.__devRuinHitParts = [];
  for (let index = 1; index <= 9; index++) {
    const id = String(index).padStart(2, '0');
    document.write('<script src="js/dev-random-ruin-hit-puzzles-runtime/part' + id + '.js?v=20260913hits1"></scr' + 'ipt>');
  }
  document.write('<script src="js/dev-random-ruin-hit-puzzles-assemble.js?v=20260913hits1"></scr' + 'ipt>');
})();

// Reassembles and executes the dev-only Random Test Ruin hit-puzzle runtime.
(() => {
  'use strict';
  const parts = window.__devRuinHitParts || [];
  if (parts.length !== 9) throw new Error(`Random Test Ruin hit runtime expected 9 parts, got ${parts.length}.`);
  const encoded = parts.join('');
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const source = new TextDecoder('utf-8').decode(bytes);
  delete window.__devRuinHitParts;
  (0, eval)(source + '\n//# sourceURL=dev-random-ruin-hit-puzzles.js');
})();

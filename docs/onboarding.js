// Hobunji Hollow — onboarding entrypoint.
// The existing save/profile implementation lives in onboarding-core.js; the redesign layer owns only character-creation presentation.
(() => {
  'use strict';
  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : new URL('./onboarding.js', location.href); // Resolves sibling scripts correctly from GitHub Pages, GitHack, or local hosting.
  const coreUrl = new URL('onboarding-core.js?v=20260907charcreator1', selfUrl).href; // Loads the unchanged legacy onboarding/save core first.
  const redesignUrl = new URL('js/onboarding-character-creation-redesign.js?v=20260907charcreator5', selfUrl).href; // Loads the integrated 3D preview, Slagothim/Tletingan workflow, generated appearance/outfits/Kasa rules, runtime material parity, loading UI, and shell outline pass.
  document.write(`<script src="${coreUrl}"><\/script><script src="${redesignUrl}"><\/script>`);
})();

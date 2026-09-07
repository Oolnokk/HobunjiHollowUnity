// Hobunji Hollow — onboarding entrypoint.
// The existing save/profile implementation lives in onboarding-core.js; the redesign layer enhances only character creation.
(() => {
  'use strict';
  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : new URL('./onboarding.js', location.href); // Used to resolve both sibling scripts correctly from GitHub Pages, GitHack, or local hosting.
  const coreUrl = new URL('onboarding-core.js?v=20260907charcreator1', selfUrl).href; // Loads the unchanged legacy onboarding/save core first.
  const redesignUrl = new URL('js/onboarding-character-creation-redesign.js?v=20260907charcreator1', selfUrl).href; // Loads the 3D preview + species workflow enhancement immediately after the core.
  document.write(`<script src="${coreUrl}"><\/script><script src="${redesignUrl}"><\/script>`);
})();

// Hobunji Hollow — onboarding entrypoint.
// The existing save/profile implementation lives in onboarding-core.js; creator behavior is layered after it.
(() => {
  'use strict';
  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : new URL('./onboarding.js', location.href); // Resolves sibling scripts correctly from GitHub Pages, GitHack, or local hosting.
  const coreUrl = new URL('onboarding-core.js?v=20260907charcreator1', selfUrl).href; // Loads the unchanged legacy onboarding/save core first.
  const redesignUrl = new URL('js/onboarding-character-creation-redesign.js?v=20260907charcreator5', selfUrl).href; // Loads the integrated 3D creator, Slagothim workflow, generated appearance/outfit rules, material parity, and shell pass.
  const lifePreviewUrl = new URL('js/onboarding-character-creation-life-preview.js?v=20260907charcreator6', selfUrl).href; // Adds breathing/blinking, Bowl-Kasa dye parity, and the first living-preview layer.
  const weaponViewFixUrl = new URL('js/onboarding-character-creation-weapon-view-fix.js?v=20260907charcreator7', selfUrl).href; // Randomizes/persists the actual starter weapon, gives it pre-render hand ownership, and makes face view follow current avatar height.
  document.write(`<script src="${coreUrl}"><\/script><script src="${redesignUrl}"><\/script><script src="${lifePreviewUrl}"><\/script><script src="${weaponViewFixUrl}"><\/script>`);
})();

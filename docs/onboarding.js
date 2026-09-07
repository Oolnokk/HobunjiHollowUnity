// Hobunji Hollow — onboarding entrypoint.
// The existing save/profile implementation lives in onboarding-core.js; creator behavior is layered after it.
(() => {
  'use strict';
  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : new URL('./onboarding.js', location.href); // Resolves sibling scripts correctly from GitHub Pages, GitHack, or local hosting.
  const coreUrl = new URL('onboarding-core.js?v=20260907charcreator1', selfUrl).href; // Loads the legacy onboarding/save core first.
  const mashtzarrFemaleUrl = new URL('js/onboarding-character-creation-mashtzarr-female.js?v=20260907charcreator8', selfUrl).href; // Bridges the core to the already-authored female Mashtzarr config and enables its existing Female control.
  const redesignUrl = new URL('js/onboarding-character-creation-redesign.js?v=20260907charcreator5', selfUrl).href; // Loads the integrated 3D creator, Slagothim workflow, generated appearance/outfit rules, material parity, and shell pass.
  const lifePreviewUrl = new URL('js/onboarding-character-creation-life-preview.js?v=20260907charcreator6', selfUrl).href; // Adds breathing/blinking, Bowl-Kasa dye parity, and the first living-preview layer.
  const weaponViewFixUrl = new URL('js/onboarding-character-creation-weapon-view-fix.js?v=20260907charcreator7', selfUrl).href; // Randomizes/persists the actual starter weapon, gives it pre-render hand ownership, and makes face view follow current avatar height.
  const weaponPolishUrl = new URL('js/onboarding-character-creation-weapon-polish.js?v=20260907charcreator9', selfUrl).href; // Normalizes Kenkari held-tool size and restores Hatchet/Spear idle sprite bases to the correct Hoe/Pick-Shovel equivalents.
  const cameraCompositionUrl = new URL('js/onboarding-character-creation-camera-composition.js?v=20260907charcreator11', selfUrl).href; // Sets the resting preview turn to an exact 15° in the existing direction and moves the camera eye/target to Mao'ao male mid-body height while preserving drag and face-view alignment.
  document.write(`<script src="${coreUrl}"><\/script><script src="${mashtzarrFemaleUrl}"><\/script><script src="${redesignUrl}"><\/script><script src="${lifePreviewUrl}"><\/script><script src="${weaponViewFixUrl}"><\/script><script src="${weaponPolishUrl}"><\/script><script src="${cameraCompositionUrl}"><\/script>`);
})();

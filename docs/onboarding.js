// Hobunji Hollow — onboarding entrypoint.
// The existing save/profile implementation lives in onboarding-core.js; creator behavior is layered after it.
(() => {
  'use strict';
  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : new URL('./onboarding.js', location.href); // Resolves sibling scripts correctly from GitHub Pages, GitHack, or local hosting.
  const coreUrl = new URL('onboarding-core.js?v=20260907charcreator1', selfUrl).href; // Loads the legacy onboarding/save core first.
  const folderSaveBridgeUrl = new URL('js/folder-save-onboarding-bridge.js?v=20260915driveb', selfUrl).href; // Delays save-selection initialization until the coordinator resolves desktop-folder or mobile-Drive startup reconciliation.
  const viewportFitUrl = new URL('js/onboarding-viewport-fit.js?v=20260913viewportfit1', selfUrl).href; // Keeps creator/save cards inside the live viewport and exposes visible overflow diagnostics.
  const switchboxPlacementUrl = new URL('js/onboarding-switchbox-placement.js?v=20260913switchboxworld1', selfUrl).href; // Keeps the dev switchbox out of character creation and collapses it on the World step.
  const mashtzarrFemaleUrl = new URL('js/onboarding-character-creation-mashtzarr-female.js?v=20260907charcreator21', selfUrl).href; // Uses the real female Mashtzarr body/profile while temporarily borrowing male hairstyle controls and excluding facial hair.
  const redesignUrl = new URL('js/onboarding-character-creation-redesign.js?v=20260907charcreator5', selfUrl).href; // Loads the integrated 3D creator, Slagothim workflow, generated appearance/outfit rules, material parity, and shell pass.
  const randomNameUrl = new URL('js/onboarding-random-name.js?v=20260913randomname1', selfUrl).href; // Adds BanditNameForge-backed first-name rolls for the initial and every changed species/gender selection.
  const lifePreviewUrl = new URL('js/onboarding-character-creation-life-preview.js?v=20260910review1', selfUrl).href; // Adds breathing/blinking, Bowl-Kasa dye parity, and the first living-preview layer.
  const weaponViewFixUrl = new URL('js/onboarding-character-creation-weapon-view-fix.js?v=20260910review1', selfUrl).href; // Randomizes/persists the actual starter weapon, gives it pre-render hand ownership, and makes face view follow current avatar height.
  const weaponPolishUrl = new URL('js/onboarding-character-creation-weapon-polish.js?v=20260907charcreator9', selfUrl).href; // Normalizes Kenkari held-tool size and restores Hatchet/Spear idle sprite bases to the correct Hoe/Pick-Shovel equivalents.
  const reloadHandoffUrl = new URL('js/onboarding-character-creation-reload-handoff.js?v=20260915drivea', selfUrl).href; // Commits the creator save durably, queues linked Drive sync, flushes the desktop folder when present, then resumes from a clean renderer session.
  const cameraCompositionUrl = new URL('js/onboarding-character-creation-camera-composition.js?v=20260910review1', selfUrl).href; // Presents the default character +10° off-center and keeps the preview camera at a level Mao'ao-male mid-body eye line.
  document.write(`<script src="${coreUrl}"><\/script><script src="${folderSaveBridgeUrl}"><\/script><script src="${viewportFitUrl}"><\/script><script src="${switchboxPlacementUrl}"><\/script><script src="${mashtzarrFemaleUrl}"><\/script><script src="${redesignUrl}"><\/script><script src="${randomNameUrl}"><\/script><script src="${lifePreviewUrl}"><\/script><script src="${weaponViewFixUrl}"><\/script><script src="${weaponPolishUrl}"><\/script><script src="${reloadHandoffUrl}"><\/script><script src="${cameraCompositionUrl}"><\/script>`);
})();

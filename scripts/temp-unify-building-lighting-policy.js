'use strict';

const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '../docs/js/interior-environment-runtime.js');
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(before, after, label) {
  if (!source.includes(before)) throw new Error(`Missing ${label} patch target`);
  source = source.replace(before, after);
}

replaceOnce(
  "  const OVERLAY_ONLY_LIGHTING_MAPS = new Set(['map_i_temple']); // Runtime uses the shared 2D darkness/light-mask overlay for these interiors instead of mutating Three.js lights.\n",
  "  let isOrdinaryBuildingArea = () => false; // Captured from GridTileAccessors so runtime authored-lighting metadata follows the same ordinary-building policy as the farmhouse overlay route.\n",
  'hard-coded temple overlay set',
);

replaceOnce(
  "  function usesOverlayOnlyLighting(mapId) {\n    return OVERLAY_ONLY_LIGHTING_MAPS.has(String(mapId || '').trim());\n  }",
  "  function usesOverlayOnlyLighting(mapId) {\n    return !IS_INTERIOR_EDITOR && !!isOrdinaryBuildingArea(String(mapId || '').trim()); // Every ordinary authored building uses the shared fake-light compositor at runtime; the editor keeps its lighting preview controls.\n  }",
  'overlay policy helper',
);

replaceOnce(
  "  function hookBuildingSceneMap(map) {\n    if (!map?.set || map.__hobunjiInteriorEnvironmentSetHook) return false;\n    buildingSceneMap = map;",
  "  function hookBuildingSceneMap(map, buildingPredicate) {\n    if (!map?.set || map.__hobunjiInteriorEnvironmentSetHook) return false;\n    buildingSceneMap = map;\n    if (typeof buildingPredicate === 'function') isOrdinaryBuildingArea = buildingPredicate;",
  'building map hook signature',
);

replaceOnce(
  "      hookBuildingSceneMap(injectedDeps?._buildingScenes);",
  "      hookBuildingSceneMap(injectedDeps?._buildingScenes, injectedDeps?._isBuildingArea);",
  'GridTileAccessors building predicate handoff',
);

replaceOnce(
  "      overlayOnlyLightingMaps: [...OVERLAY_ONLY_LIGHTING_MAPS],",
  "      overlayOnlyLightingPolicy: IS_INTERIOR_EDITOR ? 'editor-preview' : 'ordinary-authored-buildings',",
  'debug overlay policy',
);

fs.writeFileSync(file, source);
console.log('unified authored-building overlay lighting policy: PASS');

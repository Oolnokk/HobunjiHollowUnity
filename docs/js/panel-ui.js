// Shared dev-tool bootstrap. The original PanelUI implementation is retained
// byte-for-byte in panel-ui-core.js; this entry point keeps its synchronous
// load order while adding common terrain-preview parity/fix layers.
(() => {
  'use strict';
  const src = document.currentScript?.src || new URL('../js/panel-ui.js', location.href).href; // Used to keep nested Tool Hub pages resolving shared modules from docs/js/.
  const core = new URL('./panel-ui-core.js?v=20260914terrain4', src).href; // Used as the unchanged historical PanelUI implementation expected synchronously by existing tools.
  const mapEditorTextureFix = new URL('./map-editor-terrain-texture-fix.js?v=20260914terrain4', src).href; // Used only on Map Editor to preserve async preview materials and redraw after PNG loads.
  const terrainParity = new URL('./tool-terrain-preview-parity.js?v=20260914terrain4', src).href; // Used to install shared game-material/UV parity and unstretched-pixel scale controls in terrain tools.
  if (document.readyState === 'loading') {
    document.write(`<script src="${core}"></script><script src="${mapEditorTextureFix}"></script><script src="${terrainParity}"></script>`);
    return;
  }
  const coreScript = document.createElement('script'); // Used only by rare late/dynamic PanelUI loads where document.write would replace the page.
  coreScript.src = core;
  coreScript.addEventListener('load', () => {
    const fixScript = document.createElement('script'); // Used to install the Map Editor material-preservation/redraw hook before parity can process preview meshes.
    fixScript.src = mapEditorTextureFix;
    fixScript.addEventListener('load', () => {
      const parityScript = document.createElement('script'); // Used to preserve core -> Map Editor fix -> parity ordering outside normal parser-time loading.
      parityScript.src = terrainParity;
      (document.head || document.documentElement).appendChild(parityScript);
    }, { once: true });
    (document.head || document.documentElement).appendChild(fixScript);
  }, { once: true });
  (document.head || document.documentElement).appendChild(coreScript);
})();

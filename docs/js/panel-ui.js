// Shared dev-tool bootstrap. The original PanelUI implementation is retained
// byte-for-byte in panel-ui-core.js; this entry point keeps its synchronous
// load order while adding common terrain-preview parity/fix layers.
(() => {
  'use strict';
  const src = document.currentScript?.src || new URL('../js/panel-ui.js', location.href).href; // Used to keep nested Tool Hub pages resolving shared modules from docs/js/.
  const core = new URL('./panel-ui-core.js?v=20261005h1f6d1ea', src).href; // Used as the unchanged historical PanelUI implementation expected synchronously by existing tools.
  const mapEditorTextureFix = new URL('./map-editor-terrain-texture-fix.js?v=20260914terrain4', src).href; // Used only on Map Editor to preserve async preview materials and redraw after PNG loads.
  const terrainParity = new URL('./tool-terrain-preview-parity.js?v=20261004h365b521', src).href; // Used to install shared game-material/UV parity and unstretched-pixel scale controls in terrain tools.
  const isCutsceneDirector = /\/tools\/cutscene-director\//.test(location.pathname); // Used to keep repo-scene authoring hooks isolated to the Cutscene Director iframe.
  const cutsceneRepoScenes = new URL('./cutscene-director-repo-scenes.js?v=20261008hf943cda', src).href; // Used only by Cutscene Director to load shipping repo cutscene builders into its existing JSON import path.
  const cutsceneRepoTag = isCutsceneDirector ? `<script src="${cutsceneRepoScenes}"></script>` : '';
  const isAnimationAuthor = /\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname); // Used to preload portrait-utils.js's synchronous ColorFill dependency only for Animation Author.
  const animationAuthorColorFill = new URL('./color-fill.js?v=20260923colorfill7', src).href; // Used before Animation Author's repository-runtime loader can execute portrait-utils.js.
  const animationAuthorColorFillTag = isAnimationAuthor ? `<script src="${animationAuthorColorFill}"></script>` : ''; // Keeps parser-time ColorFill ordering explicit without changing other tools.
  const isCharacterStudio = /\/tools\/character-studio\/(?:index\.html)?$/.test(location.pathname); // Used to install derived-species appearance metadata before Character Studio reads scratchbones-config.js.
  const characterStudioMammakhbuur = new URL('./character-studio-mammakhbuur-config.js?v=20261005nuhonganreview2', src).href; // Supplies Mammakhbuur plus full Nuhongan/Tletingan inheritance before Character Studio initializes.
  const characterStudioMammakhbuurTag = isCharacterStudio ? `<script src="${characterStudioMammakhbuur}"></script>` : ''; // Parser-time hook must run before the later scratchbones-config assignment.
  if (document.readyState === 'loading') {
    document.write(`${characterStudioMammakhbuurTag}${animationAuthorColorFillTag}<script src="${core}"></script><script src="${mapEditorTextureFix}"></script><script src="${terrainParity}"></script>${cutsceneRepoTag}`);
    return;
  }

  const loadPanelCore = () => { // Continues the existing late-load chain after any tool-specific prerequisite is ready.
    const coreScript = document.createElement('script'); // Used only by rare late/dynamic PanelUI loads where document.write would replace the page.
    coreScript.src = core;
    coreScript.addEventListener('load', () => {
      const fixScript = document.createElement('script'); // Used to install the Map Editor material-preservation/redraw hook before parity can process preview meshes.
      fixScript.src = mapEditorTextureFix;
      fixScript.addEventListener('load', () => {
        const parityScript = document.createElement('script'); // Used to preserve core -> Map Editor fix -> parity ordering outside normal parser-time loading.
        parityScript.src = terrainParity;
        (document.head || document.documentElement).appendChild(parityScript);
        if (isCutsceneDirector) {
          const repoScript = document.createElement('script'); // Used by late-loaded Director pages to install the same repo-scene selector as the normal parser-time path.
          repoScript.src = cutsceneRepoScenes;
          (document.head || document.documentElement).appendChild(repoScript);
        }
      }, { once: true });
      (document.head || document.documentElement).appendChild(fixScript);
    }, { once: true });
    (document.head || document.documentElement).appendChild(coreScript);
  };

  if (isCharacterStudio) {
    const mammakhbuurScript = document.createElement('script'); // Late-loaded Character Studio pages need the same derived-species config hook before PanelUI hands control back to the page.
    mammakhbuurScript.src = characterStudioMammakhbuur;
    mammakhbuurScript.addEventListener('load', loadPanelCore, { once: true });
    (document.head || document.documentElement).appendChild(mammakhbuurScript);
    return;
  }
  if (isAnimationAuthor && !window.ColorFill) {
    const colorFillScript = document.createElement('script'); // Ensures dynamically loaded Animation Author pages receive ColorFill before PanelUI finishes bootstrapping.
    colorFillScript.src = animationAuthorColorFill;
    colorFillScript.addEventListener('load', loadPanelCore, { once: true });
    (document.head || document.documentElement).appendChild(colorFillScript);
    return;
  }
  loadPanelCore();
})();

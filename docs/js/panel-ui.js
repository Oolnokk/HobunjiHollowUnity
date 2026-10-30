// Shared dev-tool bootstrap. The original PanelUI implementation is retained
// byte-for-byte in panel-ui-core.js; this entry point keeps its synchronous
// load order while adding common terrain-preview parity/fix layers.
(() => {
  'use strict';
  const src = document.currentScript?.src || new URL('../js/panel-ui.js', location.href).href; // Used to keep nested Tool Hub pages resolving shared modules from docs/js/.
  const core = new URL('./panel-ui-core.js?v=20261030h86d97ab', src).href; // Used as the unchanged historical PanelUI implementation expected synchronously by existing tools.
  const mapEditorTextureFix = new URL('./map-editor-terrain-texture-fix.js?v=20260914terrain4', src).href; // Used only on Map Editor to preserve async preview materials and redraw after PNG loads.
  const terrainParity = new URL('./tool-terrain-preview-parity.js?v=20261004h365b521', src).href; // Used to install shared game-material/UV parity and unstretched-pixel scale controls in terrain tools.
  const isToolHub = /\/tools\/(?:index\.html)?$/.test(location.pathname); // Used to keep Tool Hub-only tab extensions out of nested authoring tools.
  const toolHubCombatVocalizations = new URL('./tool-hub-combat-vocalization-tab.js?v=20261013vocal1', src).href; // Adds the Combat Vocalizations tab after the hub's own static tab list initializes.
  const toolHubCombatVocalizationsTag = isToolHub ? `<script src="${toolHubCombatVocalizations}"></script>` : '';
  const isCutsceneDirector = /\/tools\/cutscene-director\//.test(location.pathname); // Used to keep repo-scene authoring hooks isolated to the Cutscene Director iframe.
  const cutsceneRepoScenes = new URL('./cutscene-director-repo-scenes.js?v=20261029hguild2', src).href; // Used only by Cutscene Director to load shipping repo cutscene builders into its existing JSON import path.
  const cutsceneRepoTag = isCutsceneDirector ? `<script src="${cutsceneRepoScenes}"></script>` : '';
  const isAnimationAuthor = /\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname); // Used to preload portrait-utils.js's synchronous ColorFill dependency only for Animation Author.
  const animationAuthorColorFill = new URL('./color-fill.js?v=20260923colorfill7', src).href; // Used before Animation Author's repository-runtime loader can execute portrait-utils.js.
  const animationAuthorColorFillTag = isAnimationAuthor ? `<script src="${animationAuthorColorFill}"></script>` : ''; // Keeps parser-time ColorFill ordering explicit without changing other tools.
  const isCharacterStudio = /\/tools\/character-studio\/(?:index\.html)?$/.test(location.pathname); // Used to install derived-species appearance metadata before Character Studio reads scratchbones-config.js.
  const characterStudioMammakhbuur = new URL('./character-studio-mammakhbuur-config.js?v=20261005nuhonganreview2', src).href; // Supplies Mammakhbuur plus full Nuhongan/Tletingan inheritance before Character Studio initializes.
  const characterStudioMammakhbuurTag = isCharacterStudio ? `<script src="${characterStudioMammakhbuur}"></script>` : ''; // Parser-time hook must run before the later scratchbones-config assignment.
  const isWallBuilder = /\/tools\/wall-builder\/(?:index\.html)?$/.test(location.pathname); // Used to isolate log-cabin authoring controls to the Wall Builder page.
  const logWallExtension = new URL('./log-wall-extension.js?v=20261023h81e6928', src).href; // Shared deterministic generated/baked log-wall authority used by runtime and the Wall Builder tool.
  const woodCutSurfaces = new URL('./wood-cut-surfaces.js?v=20261014woodcaps1', src).href; // Shared wavy_surface.png bark + log.png cut-face repair used by walls and in-game foliage wood.
  const logWallMaterials = new URL('./log-wall-materials.js?v=20261014logwallmat2', src).href; // One-material PNG atlas layer loaded after base geometry + shared wood helpers.
  const wallBuilderLogTool = new URL('./wall-builder-log-tool.js?v=20261014logwall3', src).href; // Wall Builder-only UI that exports the generated log GLB and paired live/baked recipes.
  const wallBuilderLogTag = isWallBuilder ? `<script src="${logWallExtension}"></script><script src="${woodCutSurfaces}"></script><script src="${logWallMaterials}"></script><script src="${wallBuilderLogTool}"></script>` : ''; // Parser-time tool extension tags preserving base -> wood -> atlas -> UI ordering.
  if (document.readyState === 'loading') {
    document.write(`${characterStudioMammakhbuurTag}${animationAuthorColorFillTag}<script src="${core}"></script><script src="${mapEditorTextureFix}"></script><script src="${terrainParity}"></script>${cutsceneRepoTag}${toolHubCombatVocalizationsTag}${wallBuilderLogTag}`);
    return;
  }

  const loadWallBuilderLogTools = () => { // Late-load equivalent of wallBuilderLogTag for dynamically opened/embedded Wall Builder pages.
    if (!isWallBuilder || window.__hobunjiWallBuilderLogToolLoading) return;
    window.__hobunjiWallBuilderLogToolLoading = true;
    const extensionScript = document.createElement('script'); // Runtime/tool-shared log geometry authority loaded before wood/material/UI layers.
    extensionScript.src = logWallExtension;
    extensionScript.addEventListener('load', () => {
      const woodScript = document.createElement('script'); // Shared PNG/cap repair must exist before the log atlas layer creates prototypes.
      woodScript.src = woodCutSurfaces;
      woodScript.addEventListener('load', () => {
        const materialScript = document.createElement('script'); // Single-material PNG atlas bridge patches LogWallExtension before the authoring UI creates exports.
        materialScript.src = logWallMaterials;
        materialScript.addEventListener('load', () => {
          const toolScript = document.createElement('script'); // Wall Builder controls loaded only after texture/cap prototype overrides are active.
          toolScript.src = wallBuilderLogTool;
          (document.head || document.documentElement).appendChild(toolScript);
        }, { once: true });
        (document.head || document.documentElement).appendChild(materialScript);
      }, { once: true });
      (document.head || document.documentElement).appendChild(woodScript);
    }, { once: true });
    (document.head || document.documentElement).appendChild(extensionScript);
  };

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
        if (isToolHub) {
          const hubScript = document.createElement('script'); // Late-loaded Tool Hub pages receive the same Combat Vocalizations tab extension.
          hubScript.src = toolHubCombatVocalizations;
          (document.head || document.documentElement).appendChild(hubScript);
        }
      }, { once: true });
      (document.head || document.documentElement).appendChild(fixScript);
    }, { once: true });
    (document.head || document.documentElement).appendChild(coreScript);
  };

  loadWallBuilderLogTools();
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

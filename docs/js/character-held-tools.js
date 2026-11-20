// Held tool/weapon planes for any character (window.CharacterHeldTools),
// extracted from game.js.
//
// Every held tool or weapon — the player's equipped tools, a bandit's or
// skeleton's weapon, an NPC's work tool, a captain's armament — is the same
// PNG plane built here. What differs between holders is the HOLDER's state,
// never the player's:
//   * mastery rank (drives authored mastery fire on layered weapons,
//     js/weapon-layer-effects.js), and
//   * metal appearance (plating colour, verdigris growth) for smithed metal
//     items.
// The player's equipped tools use the player's mastery and plating. Any other
// holder passes `{ holder }`: its own `weaponMasteryLevel` / `weaponMetalOptions`
// if it defines them, otherwise unmastered, fresh base metal. (Before this
// module every holder showed the player's mastery fire and plating for the
// same item key.)
//
// Texture caches are per item key. Non-player holders of smithed metal items
// get their own recoloured texture variant (one per item + appearance), so
// recolouring the player's copy never repaints an enemy's weapon.
//
// API
//   init(deps)                                game.js wiring (see bottom of file)
//   makeToolPlaneMesh(itemKey, { flip, holder, masteryLevel, metalOptions })
//   ensureToolTexture(itemKey), refreshMetalToolWorldTexture(itemKey)
//   setToolMeshLoadedState(mesh, itemKey, loaded)
//   createToolPlaneFactory(config)            pure builder; editors use it with their own textures
//   PLAYER                                    the holder token for the player's own tools
(() => {
  'use strict';

  if (window.CharacterHeldTools) return;

  // Reference width in world units; height follows the image aspect ratio.
  const TOOL_MODEL_WIDTH = 0.5;
  // Tool planes and held bag-item planes sit above resource-ring layers (<1.1)
  // and below avatar planes (2+).
  const HELD_OBJECT_RENDER_ORDER = 1.5;
  const PLAYER = 'player';

  // ── Pure plane builder (shared with tools/enemy-loadout-editor) ───────
  // config: { THREE, defs, ensureTexture(key), textures, renderOrder,
  //           markPngPlane(root), metalOptions(key), masteryLevel(key),
  //           modularGeometries?: Map, textureFor?(key, opts) }
  function createToolPlaneFactory(config) {
    const T = config.THREE;
    const modularGeometries = config.modularGeometries || new Map();
    return function makeToolPlaneMesh(itemKey, opts = {}) {
      if (!itemKey || !config.ensureTexture(itemKey)) return null;
      const def = config.defs[itemKey];
      const imgW = def?._imgW || 1;
      const imgH = def?._imgH || 1;
      const planeW = TOOL_MODEL_WIDTH;
      const planeH = planeW * (imgH / imgW); // e.g. 450×1204 → 0.5 × 1.338
      const texture = (config.textureFor && config.textureFor(itemKey, opts)) || config.textures[itemKey];
      const g = new T.Group();
      let geo = def?.modular ? modularGeometries.get(itemKey) : null; // Reuse the same geometry object so existing dual-wield copies receive layout updates.
      if (!geo) {
        geo = new T.PlaneGeometry(planeW, planeH);
        if (def?.modular) modularGeometries.set(itemKey, geo);
      }
      if (def?.modular) window.ModularWeapons.fitPlaneGeometry(geo, config.textures[itemKey].image, TOOL_MODEL_WIDTH);
      const mat = def?.modular
        ? window.HobunjiSpritePngSurface.makeMaterial(T, texture, itemKey, { side: T.DoubleSide })
        : new T.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.08, side: T.DoubleSide });
      const plane = new T.Mesh(geo, mat);
      plane.userData.sharedToolGeometry = !!def?.modular; // Enemy teardown leaves cached modular geometry available to other holders.
      // The PNG's fixed -90° X basis makes it lie in the tool's XZ plane.
      // Tool End Flip is an in-plane 180° turn on the visible sprite, so the
      // business end actually swaps with the handle instead of merely rolling
      // the parent around the weapon's own length axis.
      plane.rotation.x = -Math.PI / 2;
      plane.rotation.z = opts.flip ? Math.PI : 0;
      plane.renderOrder = config.renderOrder;
      g.add(plane);
      // Keep the parent identity-oriented; pose rotations stay on the holder group.
      g.rotation.z = 0;
      g.userData.toolEndFlipBase = opts.flip === true;
      g.userData.itemKey = itemKey; // Ranged visual updates prove the mesh still belongs to the item whose loaded state changed.
      // The sweep style's blade-parallel twist and the mace-mode spin are layered
      // on this plane each frame by whoever animates the holder.
      g.userData.toolPlane = plane;
      config.markPngPlane(g);
      const metalOptions = opts.metalOptions || (() => config.metalOptions(itemKey));
      const masteryLevel = opts.masteryLevel || (() => config.masteryLevel(itemKey));
      window.HobunjiWeaponSpriteAssemblies?.decorate(g, itemKey, def, { THREE: T, metalOptions, masteryLevel }); // Shared optional layered PNG/flail visual; grip, impact, swing and enchantment authority stay on the original haft plane.
      return g;
    };
  }

  // ── Game instance ─────────────────────────────────────────────────────
  let deps = null;
  let THREE = null;
  let loader = null;
  const toolTextures = {}; // itemKey -> texture as the player's copy looks (also every non-metal holder's).
  const loadedToolTextures = {}; // itemKey -> "loaded" variant (crossbows).
  const modularToolGeometries = new Map(); // Shared per-item quads let an asynchronous canvas expansion update both hands and every held copy.
  const holderVariantTextures = new Map(); // itemKey|appearance -> recoloured texture for non-player holders of metal items.
  const stats = { holderVariants: 0, holderMeshes: 0, playerMeshes: 0 };
  let factory = null;

  function isPlayerHolder(holder) { return holder === undefined || holder === null || holder === PLAYER; }

  function holderMetalOptions(itemKey, holder) {
    const own = typeof holder?.weaponMetalOptions === 'function' ? holder.weaponMetalOptions(itemKey) : holder?.weaponMetalOptions;
    return own || deps.baseMetalOptions(itemKey);
  }
  function holderMasteryLevel(itemKey, holder) {
    const own = typeof holder?.weaponMasteryLevel === 'function' ? holder.weaponMasteryLevel(itemKey) : holder?.weaponMasteryLevel;
    return Number(own) || 0;
  }

  function ensureToolTexture(key) {
    const def = deps.TOOL_ITEM_DEFS[key];
    if (!def || toolTextures[key]) return toolTextures[key] || null;
    if (def.modular) {
      const canvas = document.createElement('canvas'); // Placeholder uses the donor frame until asynchronous composition finishes.
      canvas.width = 450; canvas.height = 1204;
      const texture = window.HobunjiSpritePngSurface.makeCanvasTexture(THREE, canvas, key); // Canonical authored PNG surface.
      toolTextures[key] = texture;
      def._imgW = 450; def._imgH = 1204;
      refreshMetalToolWorldTexture(key);
      return texture;
    }
    const tex = loader.load(def.sprite, (t) => {
      const img = t.image;
      def._imgW = img.naturalWidth || img.width || 1;
      def._imgH = img.naturalHeight || img.height || 1;
      deps.onTextureLoaded?.(key); // The player's equipped meshes rebuild with the real aspect ratio.
      // A smith-crafted verdigris tool's in-hand mesh should show its
      // metal/verdigris/plating, not the flat teal placeholder art.
      if (def.metalKey) refreshMetalToolWorldTexture(key);
    });
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    toolTextures[key] = tex;
    if (def.loadedSprite) {
      const loadedTex = loader.load(def.loadedSprite, () => deps.onLoadedTextureLoaded?.(key));
      loadedTex.magFilter = THREE.NearestFilter;
      loadedTex.minFilter = THREE.NearestFilter;
      loadedToolTextures[key] = loadedTex;
    }
    return tex;
  }

  function recolorInto(texture, def, itemKey, opts) {
    // Quantized like the icon path so the same cached recolour canvas is reused.
    const quantizedOpts = { ...opts, oxidationAmount: deps.quantizeOxidation(opts.oxidationAmount) };
    window.ToolMetalRecolor?.getRecoloredCanvas(def.sprite, quantizedOpts).then(canvas => {
      texture.image = canvas;
      texture.needsUpdate = true;
      if (def.modular && modularToolGeometries.has(itemKey)) window.ModularWeapons.fitPlaneGeometry(modularToolGeometries.get(itemKey), canvas, TOOL_MODEL_WIDTH);
    }).catch(error => { deps.log?.(`[Foundry/metal sprite] ${error.message}`, 'error'); });
  }

  // Swaps the player's copy of a crafted tool to its current metal/verdigris/
  // plating recolour — once its base texture loads and again whenever plating
  // changes. Reinforcement never calls this (it keeps the base-metal look).
  function refreshMetalToolWorldTexture(itemKey) {
    const def = deps.TOOL_ITEM_DEFS[itemKey];
    const opts = deps.playerMetalOptions(itemKey);
    const tex = toolTextures[itemKey];
    if (!def?.sprite || !opts || !tex) return;
    recolorInto(tex, def, itemKey, opts);
  }

  // A non-player holder's view of a smithed metal item: its own recolour.
  function textureFor(itemKey, opts) {
    if (isPlayerHolder(opts.holder)) return null;
    const def = deps.TOOL_ITEM_DEFS[itemKey];
    if (!def?.metalKey || def.modular || !def.sprite) return null; // Non-metal and modular canvases are shared as-is.
    const metal = holderMetalOptions(itemKey, opts.holder);
    if (!metal) return null;
    const key = itemKey + '|' + JSON.stringify([metal.targetHex, metal.verdigrisHex, deps.quantizeOxidation(metal.oxidationAmount), metal.authoredPattern ? (metal.authoredPattern.id || 'pattern') : null]);
    let texture = holderVariantTextures.get(key);
    if (!texture) {
      texture = loader.load(def.sprite);
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      recolorInto(texture, def, itemKey, metal);
      holderVariantTextures.set(key, texture);
      stats.holderVariants++;
    }
    return texture;
  }

  function makeToolPlaneMesh(itemKey, opts = {}) {
    if (!factory) return null;
    const player = isPlayerHolder(opts.holder);
    if (player) stats.playerMeshes++; else stats.holderMeshes++;
    if (player) return factory(itemKey, opts);
    return factory(itemKey, {
      ...opts,
      metalOptions: opts.metalOptions || (() => holderMetalOptions(itemKey, opts.holder)),
      masteryLevel: opts.masteryLevel || (() => holderMasteryLevel(itemKey, opts.holder)),
    });
  }

  function setToolMeshLoadedState(mesh, itemKey, loaded) {
    const meshItemKey = mesh?.userData?.itemKey || null; // Rejects stale/asynchronous loaded-state updates aimed at another weapon's live mesh.
    if (meshItemKey && meshItemKey !== itemKey) return false;
    const plane = mesh?.userData?.toolPlane || mesh?.children?.[0]?.userData?.toolPlane;
    if (!plane) return false;
    plane.material.map = loaded && loadedToolTextures[itemKey] ? loadedToolTextures[itemKey] : toolTextures[itemKey];
    plane.material.needsUpdate = true;
    mesh.userData.appliedTextureItemKey = itemKey;
    return true;
  }

  // deps: { THREE, TOOL_ITEM_DEFS, markPngPlane, playerMetalOptions(key),
  //         playerMasteryLevel(key), baseMetalOptions(key), quantizeOxidation,
  //         onTextureLoaded(key), onLoadedTextureLoaded(key), log }
  function init(injectedDeps) {
    deps = injectedDeps;
    THREE = deps.THREE;
    loader = new THREE.TextureLoader();
    factory = createToolPlaneFactory({
      THREE,
      defs: deps.TOOL_ITEM_DEFS,
      ensureTexture: ensureToolTexture,
      textures: toolTextures,
      renderOrder: HELD_OBJECT_RENDER_ORDER,
      markPngPlane: deps.markPngPlane,
      metalOptions: key => deps.playerMetalOptions(key),
      masteryLevel: key => deps.playerMasteryLevel(key),
      modularGeometries: modularToolGeometries,
      textureFor,
    });
    return api;
  }

  const api = {
    PLAYER,
    TOOL_MODEL_WIDTH,
    HELD_OBJECT_RENDER_ORDER,
    toolTextures,
    loadedToolTextures,
    modularToolGeometries,
    get textureLoader() { return loader; },
    init,
    createToolPlaneFactory,
    ensureToolTexture,
    refreshMetalToolWorldTexture,
    makeToolPlaneMesh,
    setToolMeshLoadedState,
    snapshot: () => ({ ...stats, playerTextures: Object.keys(toolTextures).length, holderVariantTextures: holderVariantTextures.size }),
  };
  window.CharacterHeldTools = api;
})();

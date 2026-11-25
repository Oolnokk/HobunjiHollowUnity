(() => {
  'use strict';

  // Held-object selective ground x-ray and translucent submersion contract.
  // Read docs/architecture/held-object-water-depth-compositing.md before
  // changing any pass, overlay, water cover, or renderer depth behavior.
  //
  // Normal world color renders without held planes/registered feet. In a
  // separate depth-reconstructed overlay, hands/weapons/feet ignore ONLY base
  // grass, authored paths and nearby walkable floors. The
  // subsequent water/slush tint uses the original translucent material and
  // only affects geometrically submerged pixels marked in stencil.
  //
  // REGRESSION INVARIANT (confirmed with two farm-flood Pixel Probes):
  // after overlay color is drawn, restore base grass/path DEPTH colorlessly
  // BEFORE water/slush tint. If tint runs first, the missing elevated grass
  // depth lets flood color leak through it in irregular teal patches, despite
  // BOTH materials individually having depthTest enabled. The user's
  // painterly on/off comparison ruled out the painterly postprocess.
  //
  // Do not re-render ground color; do not clear depth between restoring
  // ground depth and tinting. Material, viewport/scissor and camera state
  // are restored after each pass.
  const THREE = window.THREE;
  const rendererProto = THREE?.WebGLRenderer?.prototype;
  const objectProto = THREE?.Object3D?.prototype;
  const sceneProto = THREE?.Scene?.prototype;
  if (!THREE || !rendererProto || !objectProto || !sceneProto || typeof rendererProto.render !== 'function') return;

  const existing = window.HeldObjectRenderOrder;
  if (existing?.installed) return;

  const surfaceComposer = window.SurfaceOcclusionComposer || null;
  surfaceComposer?.registerConsumer?.('held-overlay');
  surfaceComposer?.registerConsumer?.('shell-outline');
  const surfaceClassificationHints = {
    topFaceGround: false,
    pathSurface: false,
    baseGround: false,
    walkableFloor: false,
  }; // Reused only inside the synchronous classifier to avoid one hint-object allocation per mesh.

  const LEGACY_HELD_RENDER_ORDER = 1.5;
  const DEFAULT_LAYER = globalThis.HobunjiRenderLayers?.WORLD ?? 0; // Named in js/render-layers.js.
  const SHELL_LAYER = globalThis.HobunjiRenderLayers?.SHELL_OUTLINE ?? 1; // Existing inverted-hull outline pass; its x-ray replay shares the object's visibility exceptions.
  const SHELL_MASK = (1 << SHELL_LAYER) >>> 0;
  const MATERIAL_ID_LAYER = globalThis.HobunjiRenderLayers?.MATERIAL_SEAM_ID ?? 3; // Named in js/render-layers.js.
  const PNG_OCCLUDER_LAYER = globalThis.HobunjiRenderLayers?.PNG_OCCLUDER ?? 4; // Named in js/render-layers.js.
  const FRONT_PORTRAIT_MASK_LAYER = globalThis.HobunjiRenderLayers?.FRONT_PORTRAIT_MASK ?? 24; // Private stencil-only draw for player/NPC front art, separate from public appearance layers.
  const FRONT_PORTRAIT_STENCIL_MASK = 0xFC; // Bits 2..7 identify up to 63 distinct owners; bit 0 stays reserved for water tint.
  const FRONT_PORTRAIT_MAX_OWNERS = 63; // Stencil owner IDs share one draw without hiding weapons in front of unrelated NPCs.
  const FRONT_PORTRAIT_MASK = (1 << FRONT_PORTRAIT_MASK_LAYER) >>> 0; // The camera layer for the one front-portrait stamp pass.
  const PORTRAIT_WATER_MASK = 1 << (globalThis.HobunjiRenderLayers?.PORTRAIT_WATER_MASK ?? 25); // Temporary colorless silhouette for eligible front and rear actor art.
  const FOOT_WATER_MASK_LAYER = globalThis.HobunjiRenderLayers?.FOOT_WATER_MASK ?? 26; // Used only to stamp procedural feet that should remain subject to translucent water.
  const WATER_REPLAY_LAYER = globalThis.HobunjiRenderLayers?.WATER_REPLAY ?? 27; // Named in js/render-layers.js.
  const GROUND_REPLAY_LAYER = globalThis.HobunjiRenderLayers?.GROUND_REPLAY ?? 28; // Named in js/render-layers.js.
  const HELD_OVERLAY_LAYER = globalThis.HobunjiRenderLayers?.HELD_OVERLAY ?? 29; // Named in js/render-layers.js.
  const FOOT_WATER_MASK = (1 << FOOT_WATER_MASK_LAYER) >>> 0;
  const WATER_REPLAY_MASK = (1 << WATER_REPLAY_LAYER) >>> 0;
  const GROUND_REPLAY_MASK = (1 << GROUND_REPLAY_LAYER) >>> 0;
  const HELD_OVERLAY_MASK = (1 << HELD_OVERLAY_LAYER) >>> 0;
  const DEFAULT_LAYER_MASK = (1 << DEFAULT_LAYER) >>> 0;
  const MASK_ALL = 0xFFFFFFFF >>> 0;
  const FALLBACK_SCAN_INTERVAL_MS = 750;

  // Registered meshes bucketed by the scene they were last found in. Ground
  // registries accumulate every floor mesh of every cached zone/interior
  // scene (15k+ after a tour of the wilds), and collectVisible runs for each
  // registry on every world render; walking only the rendering scene's bucket
  // keeps that per-frame cost proportional to the current map. Members are
  // re-queued whenever they are (re)added anywhere, which is how a held tool
  // that moves with the player into another scene gets re-bucketed.
  const retiredScenes = new WeakSet(); // A discarded scene may still render briefly while its replacement is generated.
  let registryDirectScenePlacements = 0; // Mobile diagnostics: registrations that skip a second root walk during full scene classification.
  class SceneRegistry {
    constructor() {
      this.all = new Set();
      this.pending = new Set(); // Members whose scene is unknown or may have changed.
      this.byScene = new Map(); // Scene -> Set of members last found under it.
      this.sceneOf = new Map(); // Member -> scene key in byScene.
    }
    add(object, knownScene = null) {
      this.all.add(object);
      if (knownScene?.isScene && !knownScene.parent) {
        // A full root-scene walk has already established ancestry. Place in
        // traversal order, just as the old pending flush did, without another
        // pending insertion or ancestor walk. Preserve ordering for tied draws.
        this.pending.delete(object);
        this.place(object, knownScene);
        registryDirectScenePlacements++;
        return this;
      }
      this.unplace(object);
      this.pending.add(object);
      return this;
    }
    has(object) { return this.all.has(object); }
    delete(object) {
      if (!this.all.delete(object)) return false;
      this.pending.delete(object);
      this.unplace(object);
      return true;
    }
    place(object, scene) {
      if (retiredScenes.has(scene)) {
        this.delete(object);
        return;
      }
      this.unplace(object);
      let bucket = this.byScene.get(scene);
      if (!bucket) this.byScene.set(scene, bucket = new Set());
      bucket.add(object);
      this.sceneOf.set(object, scene);
    }
    unplace(object) {
      const scene = this.sceneOf.get(object);
      if (!scene) return;
      this.sceneOf.delete(object);
      this.byScene.get(scene)?.delete(object);
    }
    [Symbol.iterator]() { return this.all.values(); }
  }

  const heldMeshes = new WeakSet();
  const groundMeshes = new WeakSet();
  const waterMeshes = new WeakSet(); // Used by classifyObject to count each canonical water surface once across fallback rescans.
  const waterOccludedMeshes = new WeakSet(); // Used to count each explicitly water-occluded mesh once; procedural feet register here.
  const heldRegistry = new SceneRegistry();
  const groundRegistry = new SceneRegistry();
  const topFaceGroundRegistry = new SceneRegistry(); // Used for meshes whose upward faces are ground but whose walls/ceiling still occlude (carved cavern shells).
  const tintCoverRegistry = new SceneRegistry(); // Translucent water/slush to blend over submerged feet, hands and held gear (never opaque snow).
  const protectedCoverRegistry = new SceneRegistry(); // Snow/slush, water and billboard grass must write temporary depth in the held overlay.
  const waterOccludedRegistry = new SceneRegistry(); // Procedural foot meshes, drawn in the selective x-ray overlay with real water/snow/grass depth.
  const pngDepthRegistry = new SceneRegistry(); // Used by the colorless replay to repair only cutout depth materials instead of traversing every visible object.
  const waterPortraitRegistry = new SceneRegistry(); // Front and rear body PNGs that can receive translucent cover.
  const frontPortraitRegistry = new SceneRegistry(); // Visible player and NPC front portrait cutouts that cover their late-rendered weapons.
  const backgroundDepthRegistry = new SceneRegistry(); // Sky depth masks and visual-only distant scenery excluded from held overlay depth.
  const preparedLights = new WeakSet();
  let lastSceneScan = new WeakMap(); // Reset on leaving the disabled mode so enabled replays discover late semantic changes.

  let heldCount = 0;
  let groundCount = 0;
  let farmhouseFloorCount = 0; // Counts just player-farmhouse floor meshes in the shared interior floor replay.
  const countedFarmhouseFloors = new WeakSet(); // Ensures floor meshes counted before farmhouse registration are counted when they are later tagged.
  let interiorFloorCount = 0; // Counts all tagged walkable interior floors, including rebuilt and authored rooms.
  let grassCount = 0;
  let roadCount = 0;
  let terrainCount = 0;
  let topFaceGroundCount = 0; // Meshes registered via markTopFaceGroundMesh.
  let waterMeshCount = 0; // Exposed in debugState so mobile diagnostics can confirm water surfaces are eligible for translucent replay.
  let waterOccludedMeshCount = 0; // Used by mobile diagnostics to confirm feet and pants registered for water occlusion.
  let pantsXrayRegistrations = 0; // Counts once per pants mesh; surfaced to mobile diagnostics without extra per-frame scanning.
  let waterReplayCount = 0; // Counts depth-correct translucent water/slush tint passes over foot pixels.
  let lastNearbyTintCovers = 0; // Number of water/slush meshes eligible near any visible held/foot owner this frame.
  let lastDistantTintCovers = 0; // Distant water meshes rejected before they can tint character pixels.
  let lastRankedPortraitActors = 0; // Player and nearby NPCs in the same camera-ordered portrait draw.
  let lastWaterPortraits = 0; // Visible portrait planes eligible for water tint in the latest base world draw.
  let lastDryGearWaterSkips = 0; // Gear bounds that rejected nearby water during the latest world draw.
  let lastWaterClipScopes = 0; // Active owner tiles applied to merged-water fragment clipping in the latest replay.
  let lastWaterClipOverflow = 0; // Number of owners when a crowded frame exceeds the conservative shader capacity.
  let scissoredReplayCount = 0; // Replays whose passes were clipped to the held/foot screen rectangle.
  let fullscreenReplayCount = 0; // Replays that fell back to full-framebuffer passes (see replayScissorRect).
  let lastReplayScissorCoverage = 1; // Fraction of the framebuffer the last replay's passes touched.
  let lastScissorFailureReason = 'none'; // Reason the latest scissor attempt rejected an unsafe viewport or mesh.
  let lastHeldFullscreenReason = 'none'; // Held-pass fallback cause, captured before later bounds checks can overwrite it.
  let lastShellFullscreenReason = 'none'; // Shell-pass fallback cause, captured separately from the held pass.
  let lastBaseReplayCandidates = 0; // Held and foot meshes considered after the last base render.
  let lastBaseOffscreenFiltered = 0; // Rigid offscreen meshes removed before grouping into expensive depth replays.
  let lastShellReplayCandidates = 0; // Held and foot shell meshes considered by the most recent shell pass.
  let lastShellOffscreenFiltered = 0; // Rigid offscreen shell meshes skipped before their depth passes.
  let lastBaseElevationGroups = 0; // Distinct visible actor heights that needed the last held depth rebuild.
  let lastShellElevationGroups = 0; // Distinct visible actor heights that needed the last shell-depth rebuild.
  let shellSceneTraversalsAvoided = 0; // Cumulative redundant full-scene walks avoided by one snapshot per shell replay.
  let shellMaskedDepthDraws = 0; // Successful shell depth draws whose color output was suppressed once in GPU state instead of rewriting every material.
  let shellOpaqueMaterialWritesAvoided = 0; // Ordinary opaque material transactions skipped by shell depth replays using the color mask.
  let groupScissorCount = 0; // Elevation-group passes assigned their own tighter depth-replay screen rectangle.
  let missingStencilFootReplaySkipCount = 0; // Safety fallback for auxiliary/offscreen targets that cannot carry the two-bit mask.
  let lastBaseStencilBits = 0; // STENCIL_BITS of the framebuffer bound for the most recent real world pass.
  let baseWorldRenderCount = 0;
  let selectiveOverlayCount = 0;
  let nonGroundDepthReplayCount = 0;
  let frontPortraitMaskPassCount = 0; // Cumulative once-per-world-frame silhouette stencil draws, exposed to mobile diagnostics.
  let frontPortraitDepthFallbackPasses = 0; // Counts colorless owner-front depth stamps when no usable private stencil is available.
  let lastFrontPortraitMaskCount = 0; // Eligible portrait meshes in the latest held overlay, exposed to mobile diagnostics.
  let lastFrontPortraitGearCandidates = 0; // Gear parts requesting front-art masking in the latest held overlay.
  let lastFrontPortraitMaskedGear = 0; // Gear parts actually assigned a portrait stencil ID in the latest held overlay.
  let groundDepthRestoreCount = 0;
  let invariantRepairCount = 0;
  let heldOrderNormalizations = 0; // Counts registered held parts whose authored renderOrder is normalized before selective replay.
  let lastHeldOrderNormalization = null; // Shows which held mesh was most recently overridden in mobile X-ray diagnostics.
  let ordinaryShellMeshesDrawnOnce = 0; // Normal-depth outlines kept in the existing scene pass, shared by all actor types.
  let ordinaryShellReplaysAvoided = 0; // Entire depth-rebuild shell sequences skipped when no part needs a tile exception.
  let shellXrayPassCount = 0; // Shell passes replay registered x-ray objects against elevation-filtered ground depth.
  let shellXrayMeshDrawCount = 0; // Registered x-ray meshes whose shell was redrawn with matching visibility.
  let lastXrayTileRegions = 0; // Active neighborhoods before merging compatible depth draws.
  let lastXrayOrdinaryMeshes = 0; // Parts that can use ordinary depth in the latest pass.
  let lastElevationReplayGroups = 0; // Mobile diagnostics: number of standing-height depth replays in the latest base/shell pass.
  let lastUnknownElevationMeshes = 0; // Mobile diagnostics: unresolved actor meshes intentionally left fully occluded.
  let internalReplay = false;
  let lastDebugSignature = '';
  // Gameplay keeps this enabled in every camera mode so a low shoulder-surf
  // angle cannot bury weapon PNGs beneath terrain or grass planes.
  let enabled = true;

  function hasLayer(object, layer) {
    const mask = Number(object?.layers?.mask ?? 0) >>> 0;
    return !!(mask & ((1 << layer) >>> 0));
  }

  function hasAncestorFlag(object, key) {
    for (let node = object; node; node = node.parent) {
      if (node.userData?.[key] === true) return true;
    }
    return false;
  }

  function materialLooksLikeGrassBillboard(material) {
    const materials = Array.isArray(material) ? material : [material];
    return materials.some(entry => !!(
      entry?.isShaderMaterial
      && entry.uniforms?.uGrassTex
      && entry.uniforms?.uDensity
      && entry.uniforms?.uStrength
    ));
  }

  function isGrassGroundCover(object) {
    if (!object?.isMesh) return false;
    const data = object.userData || {};
    // Preserve the authored grass tags, but do not require InstancedMesh.
    // Farm/town/wilderness grass currently uses InstancedMesh; other runtime
    // consumers can reuse the exact same grass ShaderMaterial on a plain Mesh.
    // Those meshes must also be absent from the held-object depth replay:
    // submerged grass is painted over by water in the base pass, so allowing
    // its hidden depth to survive would punch grass-shaped water holes through
    // an otherwise x-rayed weapon.
    if (data.isWildernessGrassChunk === true || data.isRichFoliageBillboard === true) return true;
    if (object.isInstancedMesh && data.isBillboard === true) return true;
    return materialLooksLikeGrassBillboard(object.material);
  }

  function isRoadSurface(object) {
    return !!object?.isMesh && hasAncestorFlag(object, 'hobunjiPathSurface');
  }

  function materialMarksInteriorFloor(material) {
    const materials = Array.isArray(material) ? material : [material]; // Used by isWalkableGroundSurface so multi-material floors receive the same held-object x-ray policy.
    return materials.some(entry => entry?.userData?.hobunjiInteriorFloorMaterial === true);
  }

  function materialMarksBaseGrass(material) {
    const materials = Array.isArray(material) ? material : [material]; // Used to recognize only the terrain TileType.GRASS material, including map texture overrides.
    return materials.some(entry => entry?.userData?.hobunjiBaseGrassTerrainMaterial === true);
  }

  function isFarmWalkableGroundSurface(object) {
    if (!object?.isMesh || object.isSkinnedMesh) return false;
    const data = object.userData || {}; // Real farm tile or its live render-batch copy; incidental props and plants never inherit this exception.
    if (data.hobunjiFarmTile !== true && data.hobunjiFarmTileBatch !== true) return false;
    if (!hasLayer(object, MATERIAL_ID_LAYER) || data.farmLooseRockMound === true) return false; // Only tile slabs are eligible, not farm rock, trees or loose vegetation.
    const material = object.material; // The farm terrain renderer shares/clones one material per tile type.
    return Array.isArray(material)
      ? material.length > 0 && material.every(entry => !!entry && entry.userData?.terrainKey !== 'rock')
      : !!material && material.userData?.terrainKey !== 'rock'; // No per-tile array allocation: ground includes trench/raised/paddy, not stone mounds.
  }

  function isWalkableGroundSurface(object) {
    if (!object?.isMesh || object.isSkinnedMesh) return false;
    const data = object.userData || {}; // Existing semantic floor tags are preferred over geometry/name heuristics.
    if (data.hobunjiGroundSurface === true || data.cavernWalkableFloor === true) return true;
    if (materialMarksInteriorFloor(object.material)) return true;

    // A V50 flat floor gets its identity from registerFloor; untagged
    // recipe-2 meshes are not automatically floors. Stepped floors also
    // expose their plateau map directly and retain the existing exception.
    if (data.hobunjiRuinFloorSurface === true || (data.wallBuilderRecipe === 'wallrecipe2.json' && data.plateauModel?.levelByCell)) return true;
    return false;
  }

  function isTerrainSurface(object) {
    if (!object?.isMesh || object.isSkinnedMesh) return false;
    if (object.userData?.environmentSurfaceMicroPlateau === true) return false; // Snow and slush are raised occluders, never the base grass.

    // Interior floors, generated ruin floors, and explicitly tagged walkable
    // terrain are ground regardless of hierarchy or elevation.
    if (isWalkableGroundSurface(object)) return true;

    // Spatial terrain chunks are generated only from whole-zone floor meshes.
    if (object.userData?.terrainRenderChunk === true || object.userData?.terrainRenderChunkSource === true) return true;

    // Map-editor floor buckets (farm/town/wilderness). Wilderness streams
    // them inside WildernessChunk_* groups, so the scene-parent test below
    // never saw them and weapons were buried under wilderness ground.
    if (object.userData?.mapEditorTerrain) return true;

    // Farm/town/wilderness floor meshes opt into the terrain material-ID layer
    // and are attached directly to the scene. Runtime-rebuilt farm tiles cast
    // shadows as well as receive them, so castShadow cannot distinguish them
    // from ordinary props. The scene-parent + material-ID signature mirrors
    // TerrainRenderChunks' own bounded terrain candidate test and excludes
    // nested hands/furniture that may share wavy_surface.png or layer 3.
    if (object.parent?.isScene && object.receiveShadow && hasLayer(object, MATERIAL_ID_LAYER)) return true;

    // Conservative legacy fallback for untagged floor meshes only.
    if (object.parent?.isScene && object.receiveShadow && !object.castShadow) {
      const name = String(object.name || '').toLowerCase();
      if (/(^|[_-])(ground|terrain|zone_floor|floor|path_network)([_-]|$)/.test(name)) return true;
    }
    return false;
  }

  // A carved cavern shell is floor, walls, and ceiling in one mesh, and its
  // upward floor faces sit a hair below the tagged walkable floor. Hiding the
  // whole shell would let weapons x-ray cave walls; keeping it would bury
  // weapons under the floor. Only its upward faces are treated as ground.
  function isTopFacesGroundSurface(object) {
    if (!object?.isMesh || object.isSkinnedMesh) return false;
    return object.userData?.hobunjiGroundTopFacesOnly === true;
  }

  function isWaterSurface(object) {
    if (!object?.isMesh || object.isSkinnedMesh) return false;
    const data = object.userData || {}; // Existing runtime water tags are preferred over broad name matching so props with "water" in their names are never replayed.
    if (data.mergedWaterStatKey || data.waterSurfaceRole) return true;
    if (data.waterfallSurfaceHeightMode || data.waterfallTexture) return true;
    return false;
  }

  function isSlushSurface(object) {
    if (!object?.isMesh || object.userData?.environmentSurfaceMicroPlateau !== true) return false;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    return materials.some(entry => entry?.userData?.environmentSurfaceMicroPlateauMaterial === 'slush');
  }

  function surfaceKindForObject(object) {
    const data = object?.userData || {};
    const walkableFloor = !!object?.isMesh && !object.isSkinnedMesh && (
      materialMarksInteriorFloor(object.material)
      || data.cavernWalkableFloor === true
      || data.hobunjiRuinFloorSurface === true
      || (data.wallBuilderRecipe === 'wallrecipe2.json' && !!data.plateauModel?.levelByCell)
      || (data.liveRootFloor === true && data.ruinPreviewRole === 'floor')
    );
    surfaceClassificationHints.topFaceGround = isTopFacesGroundSurface(object);
    surfaceClassificationHints.pathSurface = isRoadSurface(object);
    // Map-editor floor buckets carry their mesh ownership independently of their
    // materials. Grass, weeds, soil, riverbeds and texture-overridden variants
    // must all use the same held-object ground depth policy. The separate
    // ROCK material bucket holds solid mounds, so that one stays an occluder
    // along with untagged rock props and cave walls.
    surfaceClassificationHints.baseGround = isFarmWalkableGroundSurface(object) // Farm trench, raised soil and other ground materials need the same hand/color shell x-ray as grass.
      || data.hachutuGroundRoot === true
      || (data.hobunjiGroundSurface === true
        && (data.terrainRenderChunk === true || data.terrainRenderChunkSource === true || data.terrainJigsawBaked === true)
        && !(Array.isArray(object.material) ? object.material : [object.material]).some(material => material?.userData?.terrainKey === 'rock')) // Rendered floor only: rock material buckets are solid mounds even when a generic ground tag survives batching.
      || data.hobunjiGroundXray === true // Explicit mesa terrain retains ground identity when Jigsaw replaces its grass material slot.
      || (isTerrainSurface(object) && (
        (data.mapEditorTerrain != null && object.material?.userData?.terrainKey !== 'rock')
        || materialMarksBaseGrass(object?.material)
      ));
    surfaceClassificationHints.walkableFloor = walkableFloor;

    if (surfaceComposer?.classifySurface) return surfaceComposer.classifySurface(object, surfaceClassificationHints);

    // Safe fallback if the bootstrap cannot load the shared composer.
    if (surfaceClassificationHints.topFaceGround) return 'top-face-ground';
    if (isWaterSurface(object)) return 'water';
    if (isSlushSurface(object)) return 'slush';
    if (data.environmentSurfaceMicroPlateau === true) return 'snow';
    if (isGrassGroundCover(object)) return 'billboard-grass';
    if (surfaceClassificationHints.pathSurface) return 'path';
    if (data.hachutuGroundRoot === true || surfaceClassificationHints.baseGround) return 'base-ground';
    if (walkableFloor) return 'walkable-floor';
    return 'solid';
  }

  function surfacePolicyForObject(object, consumer = 'held-overlay', context = {}) {
    const kind = surfaceKindForObject(object);
    if (surfaceComposer?.resolvePolicy) return surfaceComposer.resolvePolicy(consumer, kind, context);

    const groundKind = kind === 'path' ? 'road'
      : kind === 'base-ground' ? 'terrain'
        : kind === 'walkable-floor' ? 'interior-floor' : null;
    const tintableCover = kind === 'water' || kind === 'slush';
    return {
      surface: kind,
      groundXrayKind: groundKind,
      protectedCover: tintableCover || kind === 'snow' || kind === 'billboard-grass',
      tintableCover,
      skipPreOverlayDepthWhenTinting: tintableCover && context.translucentTintActive === true,
      restoreDepthAfterTint: tintableCover,
    };
  }

  // The optional `kind` lets classifyObject() pass one surfaceKindForObject()
  // result to all three predicates; each full classification walks the
  // object's ancestors, and the periodic rescan runs it for every mesh.
  function groundKind(object, kind = surfaceKindForObject(object)) {
    return surfaceComposer?.getGroundXrayKind
      ? surfaceComposer.getGroundXrayKind(kind)
      : kind === 'path' ? 'road'
        : kind === 'base-ground' ? 'terrain'
          : kind === 'walkable-floor' ? 'interior-floor' : null;
  }

  function isTintCover(object, kind = undefined) {
    if (kind === undefined) kind = surfaceComposer?.classifyCover ? surfaceComposer.classifyCover(object) : surfaceKindForObject(object);
    return surfaceComposer?.isTintableCover
      ? surfaceComposer.isTintableCover(kind)
      : kind === 'water' || kind === 'slush';
  }

  function isProtectedCover(object, kind = undefined) {
    if (kind === undefined) kind = surfaceComposer?.classifyCover ? surfaceComposer.classifyCover(object) : surfaceKindForObject(object);
    return surfaceComposer?.isProtectedCover
      ? surfaceComposer.isProtectedCover(kind)
      : kind === 'water' || kind === 'slush' || kind === 'snow' || kind === 'billboard-grass';
  }

  function isFrontPortraitMesh(object) {
    if (!object?.isMesh) return false;
    if (object.userData?.hobunjiShoulderSplitOverlay === true
        && object.userData?.hobunjiShoulderPetStencilForeground !== true) return false; // Split halves join the private stencil only while actually in front of their player.
    const name = String(object.name || '');
    if (name === 'player_avatar_front_plane' || name === 'npc_avatar_front_plane') return true;
    // Neck-rigged portraits combine front and back triangles in one SkinnedMesh.
    return object.isSkinnedMesh === true && Array.isArray(object.material)
      && String(object.material[0]?.name || '').includes('avatar_skinned_front_material');
  }

  // Backdrop geometry uses projected far-plane shader depth, NOT physical world distance. The
  // ordinary world still needs its cloud masks, but a held-gear reconstruction must never
  // treat their irregular alpha shapes or distant landscape as foreground occluders.
  function isPresentationBackdrop(object) {
    if (!object || !(object.isMesh || object.isSprite || object.isLine || object.isPoints)) return false;
    const data = object.userData || {};
    if (data.backgroundScenery === true || data.northernCliffsDistantPlateau === true
        || /^hobunji_cloud_depth_mask_/.test(String(object.name || ''))) return true;
    if (data.hobunjiDepthReplayInert === true) return true; // Base sky/cloud shells: already depth-inert.
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    return materials.some(material => !!material?.userData &&
      (Number.isFinite(material.userData.skyLayerDepthNdc) || Number.isFinite(material.userData.backgroundMaxDepthNdc)));
  }

  // Central x-ray rules (js/xray-hierarchy.js). Defaults here only apply if that module is absent.
  const XRAY_RULE_FALLBACK = { 'actors.order': 'all', 'pants.sortWithActor': 'on', 'weapon.frontPlaneMask': 'off', 'hand.frontPlaneMask': 'off', 'portrait.waterTint': 'wet-tile', 'layers.manualOrder': 'off', 'background.gearDepth': 'ignore', 'airborne.rebuildDepth': 'on', 'weapon.followHandLayer': 'on', 'ground.showZone': 'off', 'baby.carrierForeground': 'on' };
  function xrayRule(key) { return window.XrayHierarchy?.get?.(key) ?? XRAY_RULE_FALLBACK[key]; }

  const SHOULDER_PET_RENDER_ORDERS = Object.freeze({
    front: 2, back: 4, // Ordinary owner priorities, also the low and high ends of the attached stack.
    pet: 3, // Both sides of the animal sit between the owner sides. A turn can expose either animal card.
    stowedDepthPart: 3.25, // Draw depth-writing hands and feet before the baby portrait.
    stowedBurden: 3.5, // After both pet cards and their split overlays, before the carrier front.
  });
  const shoulderViewLocal = new THREE.Vector3(); // Tests the camera against the owner's front plane for the optional gear mask.
  const shoulderViewInverse = new THREE.Matrix4(); // Converts a world view ray to the owner portrait's local space.
  let shoulderPetPresentation = null; // Latest gameplay-owned pet and the owner's two portrait meshes.
  let previouslyPresentedPet = null; // Previous pet to restore when the stable slot changes.
  const petForegroundStencilParts = new Set(); // The pet can mask held gear only in the view where it is foreground.
  let lastShoulderPetDecision = { active: false, mode: 'owner-portrait-stages' }; // Mobile-readable stage pairing.
  let lastFrontPortraitMaskReason = 'not-rendered'; // Explains 0/0 when no owner stencil was attempted.

  function setShoulderPartDepthWrite(material, depthWrite) {
    forEachMaterial(material, entry => {
      if (entry.depthWrite === depthWrite) return;
      entry.depthWrite = depthWrite;
      entry.needsUpdate = true;
    });
  }

  function shoulderPetPortraitFace(mesh, avatar) {
    if (!mesh?.isMesh) return null;
    if (mesh === avatar?.frontPlane) return 'front';
    if (mesh === avatar?.backPlane) return 'back';
    const face = mesh.userData?.hobunjiPlaneFace; // Split overlays and skinned replacement halves inherit their authored face.
    return face === 'front' || face === 'back' ? face : null;
  }

  // Owner/pet face identity is derived from the actual render item (including skinned
  // material groups), not from the camera or a second animation-state machine.
  function shoulderPetDrawFace(item) {
    const state = shoulderPetPresentation;
    const avatar = previouslyPresentedPet?.avatarRef;
    const mesh = item?.object;
    if (!avatar || !mesh?.isMesh) return null;
    const petFace = shoulderPetPortraitFace(mesh, avatar);
    if (petFace && (mesh === avatar.frontPlane || mesh === avatar.backPlane
        || (mesh.userData?.hobunjiShoulderSplitOverlay === true && mesh.parent === avatar.group))) {
      return 'pet-' + petFace; // Pet split copies always remain in their source face stage.
    }
    if (mesh === state.frontMesh || mesh === state.backMesh) {
      if (state.frontMesh !== state.backMesh) return mesh === state.frontMesh ? 'owner-front' : 'owner-back';
      if (item.material === state.backMaterial) return 'owner-back';
      if (item.material === state.frontMaterial) return 'owner-front';
      // Fallback for a skinned material swapped after the gameplay update.
      return /(?:^|_)back(?:_|$)/i.test(item.material?.name || '') ? 'owner-back' : 'owner-front';
    }
    const overlay = /^player_avatar_(front|back)_.+(?:plane|overlay)$/i.exec(String(mesh.name || ''));
    return overlay ? 'owner-' + overlay[1].toLowerCase() : null; // Same-owner hat/portrait helpers; never unrelated NPCs.
  }

  // Three-stage portrait rank shared by every transparent-sort comparison.
  // No per-comparison closure: large towns sort thousands of transparent items.
  function shoulderPetFaceSortRank(face, inward) {
    switch (face) {
      case 'owner-front': return inward ? SHOULDER_PET_RENDER_ORDERS.front : SHOULDER_PET_RENDER_ORDERS.back;
      case 'owner-back': return inward ? SHOULDER_PET_RENDER_ORDERS.back : SHOULDER_PET_RENDER_ORDERS.front;
      case 'pet-front':
      case 'pet-back': return SHOULDER_PET_RENDER_ORDERS.pet;
      default: return null;
    }
  }

  function compareShoulderPetDrawFaces(a, b) {
    if (!a || !b) return 0;
    // Use one consistent order for BOTH portrait faces. Pair-only overrides
    // violated transitivity when a skinned owner, split pet and hat overlays
    // were sorted together, so Array.sort could leave the pet on the old side.
    const inward = previouslyPresentedPet?.__hobunjiShoulderFacingInward === true;
    const first = shoulderPetFaceSortRank(a, inward), second = shoulderPetFaceSortRank(b, inward);
    return first === null || second === null ? 0 : first - second;
  }

  const ownerOverlayMaterialDepths = new Map(); // Restores the real depthWrite setting of owner hat overlays on detachment.
  function syncShoulderOwnerOverlayDepth(state, active) {
    const desired = new Set(); // Only sibling PNG portrait overlays; never GLB hands, held objects or world depth.
    if (active) {
      for (const parent of [state?.frontMesh?.parent, state?.backMesh?.parent]) {
        for (const mesh of parent?.children || []) {
          if (!mesh?.isMesh || !/^player_avatar_(front|back)_.+(?:plane|overlay)$/i.test(String(mesh.name || ''))
              || mesh === state.frontMesh || mesh === state.backMesh) continue;
          forEachMaterial(mesh.material, material => desired.add(material));
        }
      }
    }
    for (const [material, originalDepthWrite] of ownerOverlayMaterialDepths) {
      if (desired.has(material)) continue;
      if (material.depthWrite !== originalDepthWrite) {
        material.depthWrite = originalDepthWrite;
        material.needsUpdate = true;
      }
      ownerOverlayMaterialDepths.delete(material);
    }
    for (const material of desired) {
      if (!ownerOverlayMaterialDepths.has(material)) ownerOverlayMaterialDepths.set(material, material.depthWrite);
      setShoulderPartDepthWrite(material, false); // Owner's hat must not leave stale depth that can hide its foreground pet.
    }
  }

  function syncPetForegroundStencil(pet, foreground) {
    const desired = new Set(); // Bounded to the active pet's two cards and optional split copies, not a scene traversal.
    const avatar = pet?.avatarRef;
    if (avatar && foreground) {
      if (avatar.frontPlane) desired.add(avatar.frontPlane);
      if (avatar.backPlane) desired.add(avatar.backPlane);
      for (const mesh of avatar.group?.children || []) {
        if (mesh.userData?.hobunjiShoulderSplitOverlay && shoulderPetPortraitFace(mesh, avatar)) desired.add(mesh);
      }
    }
    for (const mesh of petForegroundStencilParts) {
      if (desired.has(mesh)) continue;
      if (mesh.userData) delete mesh.userData.hobunjiShoulderPetStencilForeground;
      if (!isFrontPortraitMesh(mesh)) {
        frontPortraitRegistry.delete(mesh); // Back and split copies must never leak into another owner's stencil.
        mesh.layers?.disable?.(FRONT_PORTRAIT_MASK_LAYER);
      }
      petForegroundStencilParts.delete(mesh);
    }
    for (const mesh of desired) {
      mesh.userData = mesh.userData || {};
      mesh.userData.hobunjiShoulderPetStencilForeground = true;
      if (!hasLayer(mesh, FRONT_PORTRAIT_MASK_LAYER)) mesh.layers.enable(FRONT_PORTRAIT_MASK_LAYER);
      if (!frontPortraitRegistry.has(mesh)) frontPortraitRegistry.add(mesh);
      petForegroundStencilParts.add(mesh);
    }
  }

  function restoreShoulderPet(pet) {
    if (!pet) return;
    const avatar = pet.avatarRef;
    if (avatar?.group?.userData) delete avatar.group.userData.hobunjiShoulderPetLayering;
    for (const mesh of [avatar?.frontPlane, avatar?.backPlane]) {
      if (!mesh) continue;
      setShoulderPartDepthWrite(mesh.material, true);
      mesh.renderOrder = SHOULDER_PET_RENDER_ORDERS.front; // Normal creature render priority after leaving the owner's portrait.
    }
    for (const mesh of avatar?.group?.children || []) {
      if (mesh?.userData) delete mesh.userData.hobunjiShoulderPortraitFace; // No owner-stage priority survives a pet's detachment.
    }
    window.HobunjiShoulderSplitLayerParity?.syncAvatar?.(avatar);
  }

  function setShoulderPetLayering(pet, frontMesh, backMesh, frontMaterial, backMaterial) {
    // World/gameplay chooses only which shoulder pet is active; the compositor owns occlusion.
    shoulderPetPresentation = { pet: pet || null, frontMesh, backMesh, frontMaterial, backMaterial };
    syncShoulderPetLayering();
  }

  function shoulderViewIsFront(camera, ownerFront) {
    if (!ownerFront?.matrixWorld) return true;
    ownerFront.updateWorldMatrix(true, false);
    shoulderViewInverse.copy(ownerFront.matrixWorld).invert();
    if (camera.isOrthographicCamera) {
      return camera.getWorldDirection(shoulderViewLocal).transformDirection(shoulderViewInverse).z <= 0;
    }
    return camera.getWorldPosition(shoulderViewLocal).applyMatrix4(shoulderViewInverse).z >= 0;
  }

  function syncShoulderPetLayering(camera) {
    const state = shoulderPetPresentation;
    if (!state) return;
    const pet = actorXrayEnabled.animals ? state.pet : null; // Ordinary portrait depth when animal x-ray is disabled.
    if (previouslyPresentedPet && previouslyPresentedPet !== pet) restoreShoulderPet(previouslyPresentedPet);
    if (!pet) {
      syncShoulderOwnerOverlayDepth(state, false);
      if (petForegroundStencilParts.size) syncPetForegroundStencil(null, false);
      if (previouslyPresentedPet) {
        setShoulderPartDepthWrite(state.frontMaterial, true);
        setShoulderPartDepthWrite(state.backMaterial, true);
        if (state.frontMesh) state.frontMesh.renderOrder = SHOULDER_PET_RENDER_ORDERS.front;
        if (state.backMesh && state.backMesh !== state.frontMesh) state.backMesh.renderOrder = SHOULDER_PET_RENDER_ORDERS.back;
      }
      previouslyPresentedPet = null;
      lastShoulderPetDecision = { active: false, mode: 'owner-portrait-stages' };
      return;
    }
    previouslyPresentedPet = pet;
    const inward = pet.__hobunjiShoulderFacingInward === true; // The existing animation alone decides when the two stages swap.
    const ownerFrontOrder = shoulderPetFaceSortRank('owner-front', inward); // The front view sees the pet on top in the inward pose.
    const ownerBackOrder = shoulderPetFaceSortRank('owner-back', inward); // The reverse view sees the opposite layering.
    const petOrder = SHOULDER_PET_RENDER_ORDERS.pet; // Independent of which animal card survives backface culling.
    const avatar = pet.avatarRef;

    // Draw the owner/pet as one depth-tested, depth-write-free portrait stack.
    syncShoulderOwnerOverlayDepth(state, true);
    setShoulderPartDepthWrite(state.frontMaterial, false);
    setShoulderPartDepthWrite(state.backMaterial, false);
    if (state.frontMesh) state.frontMesh.renderOrder = ownerFrontOrder;
    if (state.backMesh && state.backMesh !== state.frontMesh) state.backMesh.renderOrder = ownerBackOrder;
    for (const [mesh, face] of [[avatar?.frontPlane, 'front'], [avatar?.backPlane, 'back']]) {
      if (!mesh) continue;
      setShoulderPartDepthWrite(mesh.material, false);
      mesh.renderOrder = petOrder;
      mesh.userData = mesh.userData || {};
      mesh.userData.hobunjiShoulderPortraitFace = face;
    }
    // Split and replacement skinned cards share the same portrait-stage rank as
    // their source face in the optional manual sorter; split-layer parity
    // supplies the actual source renderOrder and its small in-face epsilon.
    for (const mesh of avatar?.group?.children || []) {
      if (mesh?.userData?.hobunjiShoulderSplitOverlay !== true) continue;
      const face = shoulderPetPortraitFace(mesh, avatar);
      if (face) mesh.userData.hobunjiShoulderPortraitFace = face;
    }
    // The owner front remains in its regular held-object stencil.
    if (state.frontMesh?.isMesh && isFrontPortraitMesh(state.frontMesh)) {
      if (!hasLayer(state.frontMesh, FRONT_PORTRAIT_MASK_LAYER)) state.frontMesh.layers.enable(FRONT_PORTRAIT_MASK_LAYER);
      if (!frontPortraitRegistry.has(state.frontMesh)) frontPortraitRegistry.add(state.frontMesh);
    }
    // The mask follows the same view as the color pass. Three culls the hidden pet card.
    if (camera) {
      const needsPetMask = xrayRule('weapon.frontPlaneMask') !== 'off' || xrayRule('hand.frontPlaneMask') !== 'off'; // The default color pass needs no camera-side solve.
      if (needsPetMask || petForegroundStencilParts.size) {
        syncPetForegroundStencil(pet, needsPetMask && shoulderViewIsFront(camera, state.frontMesh) === inward);
      }
    }
    window.HobunjiShoulderSplitLayerParity?.syncAvatar?.(avatar); // The split halves inherit face-specific render order, material and stencil in the same frame.
    lastShoulderPetDecision = {
      active: true, mode: 'owner-portrait-stages', inwardFrontPose: inward,
      frontForeground: inward, backForeground: !inward,
      petFrontOrder: petOrder, petBackOrder: petOrder,
      ownerFrontOrder, ownerBackOrder,
      ownerDepthWrite: false, petDepthWrite: false,
      ownerOverlayDepthWriteFree: ownerOverlayMaterialDepths.size,
      pairedFaceSort: true, // The private sorter places a pet above/below ALL owner sprites in its face stage.
    };
    if (avatar?.group) {
      avatar.group.userData = avatar.group.userData || {};
      avatar.group.userData.hobunjiShoulderPetLayering = {
        ...lastShoulderPetDecision, xrayEnabled: true,
        depthMode: 'depth-tested-owner-portrait-stage-xray',
        recentChange: 'From the owner’s front, the pet peeks out from behind in the outward pose and draws in front in the inward pose.',
      };
    }
  }

  const maskedHands = new Set(); // Procedural hands the front-plane rule masks in the current world frame.
  let lastHandsBehindFrontPlane = 0; // Diagnostics: hands hidden under their holder's front art this frame.
  let airborneDepthRebuilds = 0; // Counts raised-gear frames that rebuilt ordinary depth without horizon masks.
  let backgroundDepthMeshesExcluded = 0; // Counts background depth submissions suppressed from gear/shell depth replays.

  // The later held-overlay pass cannot be ordered in front of/behind an earlier
  // portrait using color-list ranks. Its owner-specific stencil is a DIRECT rule.
  function heldPriorityLayer() {
    return xrayRule('weapon.followHandLayer') === 'off' ? 'item.weapons' : 'actor.hands';
  }
  function isPortraitMaskedGear(object) {
    const data = object?.userData;
    if (data?.hobunjiHeldObjectPlane !== true || data.hobunjiProceduralFoot === true) return false;
    if (data.hobunjiProceduralHand === true) return maskedHands.has(object) && xrayRule('hand.frontPlaneMask') !== 'off';
    return xrayRule('weapon.frontPlaneMask') !== 'off'; // Held color order never overrides the owner's front-art stencil.
  }

  // Hands: a hand with a part behind its holder's front portrait plane (camera on the front side) must not
  // show through the front art, and neither may its shell outline (the loops around a gripping hand). The hand
  // joins the same stencil mask the weapons use and loses its shell layer while it is behind the plane.
  const handPlaneInverse = new THREE.Matrix4(); // Scratch: portrait plane's world->local transform.
  const handPlaneLocal = new THREE.Vector3(); // Scratch: hand origin in plane space (only when it has no geometry box).
  const handPlaneCamera = new THREE.Vector3(); // Scratch: camera in plane space.
  const HAND_BEHIND_PLANE_EPS = 0.01; // Camera must be at least this far in front of the plane for front art to be on screen.
  const handShellSuppressed = new WeakSet(); // Hands whose shell layer this rule switched off.
  const handWingHidden = new WeakSet(); // Wing-continuation sub-meshes this rule hid with their hand.

  const handToPlane = new THREE.Matrix4(); // Scratch: hand local -> portrait plane space.
  const handCorner = new THREE.Vector3(); // Scratch: one corner of the hand geometry box in plane space.
  const handProbe = { cameraZ: NaN, handMinZ: NaN, handMaxZ: NaN, hands: 0 }; // Last evaluated plane-space numbers, for diagnostics.
  const HAND_PART_BEHIND_EPS = 0.03; // How far a part must reach behind the plane before the hand counts as behind it.

  // The furthest-behind point of the hand (lowest plane-space z). A gripping hand usually straddles the card, so
  // its centre alone says "in front" even while part of it, and its outline, sits behind the front art.
  function handBehindFrontPlane(hand, portrait, camera) {
    if (!hand.matrixWorld || !portrait.matrixWorld || !camera.matrixWorld) return false;
    handPlaneInverse.copy(portrait.matrixWorld).invert();
    handPlaneCamera.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(handPlaneInverse);
    handProbe.hands++;
    handProbe.cameraZ = handPlaneCamera.z;
    if (!(handPlaneCamera.z > HAND_BEHIND_PLANE_EPS)) return false; // Camera is not on the front side: no front art is on screen to hide under.
    const geometry = hand.geometry;
    if (geometry && !geometry.boundingBox) geometry.computeBoundingBox?.(); // Once per geometry.
    let minZ, maxZ;
    if (geometry?.boundingBox && handToPlane.multiplyMatrices) {
      handToPlane.multiplyMatrices(handPlaneInverse, hand.matrixWorld);
      const { min, max } = geometry.boundingBox;
      minZ = Infinity; maxZ = -Infinity;
      for (let i = 0; i < 8; i++) {
        const z = handCorner.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).applyMatrix4(handToPlane).z;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    } else {
      handPlaneLocal.setFromMatrixPosition(hand.matrixWorld).applyMatrix4(handPlaneInverse); // No geometry box: the mesh origin alone.
      minZ = maxZ = handPlaneLocal.z;
    }
    handProbe.handMinZ = minZ; handProbe.handMaxZ = maxZ;
    return minZ < -HAND_PART_BEHIND_EPS; // +z is the front face of a portrait card.
  }

  function updateFrontPlaneHands(held, scene, camera, ruleOverride = null) {
    // Per-hand state rather than clear-and-rebuild: the world is rendered more than once per frame and a pass
    // that collects no hands must not un-mask the ones an earlier pass decided about.
    const rule = ruleOverride ?? xrayRule('hand.frontPlaneMask');
    let frontByOwner = null; // Owner -> front portrait, built once per call and only if a hand needs it.
    for (const mesh of held) {
      if (mesh.userData?.hobunjiProceduralHand !== true) continue;
      let masked = rule === 'always';
      if (rule === 'behind') {
        if (!frontByOwner) {
          frontByOwner = new Map();
          for (const portrait of collectVisible(frontPortraitRegistry, scene)) {
            const owner = portraitStencilOwner(portrait, scene);
            if (owner && !frontByOwner.has(owner)) frontByOwner.set(owner, portrait);
          }
        }
        const owner = portraitStencilOwner(mesh, scene);
        const portrait = owner ? frontByOwner.get(owner) : null;
        masked = !!portrait && handBehindFrontPlane(mesh, portrait, camera);
      }
      if (masked) {
        maskedHands.add(mesh);
        if (hasLayer(mesh, SHELL_LAYER)) { mesh.layers.disable(SHELL_LAYER); handShellSuppressed.add(mesh); }
      } else {
        maskedHands.delete(mesh);
        if (handShellSuppressed.has(mesh)) {
          mesh.layers.enable(SHELL_LAYER); // The hand came out from behind the plane (or the rule was switched off): outline returns.
          handShellSuppressed.delete(mesh);
        }
      }
      // A parrot hand's wing continuation is a separate sub-mesh (portrait-occluded wing layer) that is not a held
      // plane; it follows the hand: hidden, outline included, while the hand is behind the front plane.
      const siblings = mesh.parent?.children;
      if (siblings) for (const sibling of siblings) {
        if (sibling === mesh || !sibling.isMesh || sibling.userData?.hobunjiPortraitOccludedWingLayer !== true) continue;
        if (masked) {
          if (sibling.visible) { sibling.visible = false; handWingHidden.add(sibling); }
        } else if (handWingHidden.has(sibling)) {
          sibling.visible = true;
          handWingHidden.delete(sibling);
        }
      }
    }
    if (maskedHands.size > 8) for (const mesh of maskedHands) if (!mesh.parent) maskedHands.delete(mesh); // Dropped hand rigs.
    lastHandsBehindFrontPlane = maskedHands.size;
  }

  function portraitStencilOwner(mesh, scene) {
    // Scene-sibling NPC/hostile holders cannot be resolved by ancestry alone.
    // Their creation-time owner tag connects them to the genuine portrait root.
    for (let node = mesh; node && node !== scene; node = node.parent) {
      // A shoulder pet drawn in FRONT is part of its carrier's composite silhouette:
      // its visible pixels must block that carrier's held tools in the later overlay.
      const shoulder = node.userData?.hobunjiShoulderPetLayering;
      if (shoulder?.active) {
        // External body roots are also classified as the player by actorRootForXrayMesh.
        // A background pet face must STOP owner resolution here or it would
        // inherit the player stencil anyway and hide the owner's held tool.
        if (!petForegroundStencilParts.has(mesh)) return null;
        return window.PlayerBodyTransformComposer?.getPlayerMesh?.() || null;
      }
      if (node.userData?.hobunjiHeldPortraitOwner) return node.userData.hobunjiHeldPortraitOwner;
    }
    // Resolve both portrait and equipment to the SAME actor, not whichever
    // nested hand/rig-scale pivot happens to hold this particular mesh.
    const actor = actorRootForXrayMesh(mesh, scene);
    if (actor?.isPlayer) return actor.root;
    let rigOwner = actor?.root || null; // Fall back for named animals and unusual NPC rigs.
    for (let node = mesh; node && node !== scene; node = node.parent) {
      if (node.userData?.hobunjiXrayActorRoot === true
          || String(node.name || '').startsWith('npc_walker_')
          || node.name === 'bandit_avatar_group') return node;
      if (!rigOwner && node.userData?.hobunjiCharacterRigScaleRoot === true) rigOwner = node;
    }
    return rigOwner;
  }

  const portraitSortPoint = new THREE.Vector3(); // Scratch projection of the standing actor, independent of its intersecting sprite angle.
  const PORTRAIT_SORT_DISTANCE = 2; // Tile radius for close player/NPC silhouettes that can cross each other.
  const PORTRAIT_SORT_ORDER = 2; // Common actor-body order; ordinary transparent items keep the existing Three.js sort keys.

  // User-editable draw order is purely a color-pass sort; front art is governed by its stencil switch.
  // Do not change material.depthTest, WebGL camera layer numbers or the protected depth replay sequence.
  function visualLayerFor(item) {
    const object = item?.object;
    const data = object?.userData || {};
    const material = item?.material || object?.material;
    const name = String(object?.name || '').toLowerCase();
    const materialName = String(material?.name || '').toLowerCase();
    if (isPresentationBackdrop(object)) return data.hobunjiDepthReplayInert === true
      || /^hobunji_cloud_/.test(name) || Number.isFinite(material?.userData?.skyLayerDepthNdc) ? 'sky' : 'distant';
    if (data.hobunjiShoulderPortraitFace === 'front') return 'actor.front';
    if (data.hobunjiShoulderPortraitFace === 'back') return 'actor.rear';
    if (data.hobunjiProceduralHand === true || data.hobunjiPortraitOccludedWingLayer === true) return 'actor.hands';
    if (data.hobunjiProceduralFoot === true) return 'actor.feet';
    if (data.hobunjiHeldObjectPlane === true || data.hobunjiWeaponAssemblyPart === true) return heldPriorityLayer(); // Shared hand priority by default, separable in Dev Companion.
    if (data.hobunjiPantsGarment === true) return 'garment.pants';
    if (/hat_xray|headwear|hat_plane/.test(name)) return 'garment.headwear';
    if (/skinned_front_material/.test(materialName) || /avatar_front_plane/.test(name)) return 'actor.front';
    if (/skinned_back_material/.test(materialName) || /avatar_back_plane/.test(name)) return 'actor.rear';
    if (/avatar|npc_walker|portrait|character/.test(name) || data.hobunjiXrayActorRoot === true) return 'actor.body';
    const kind = surfaceKindForObject(object);
    if (kind === 'base-ground' || kind === 'top-face-ground') return 'terrain';
    if (kind === 'path') return 'paths';
    if (kind === 'walkable-floor') return 'floors';
    if (kind === 'water' || kind === 'slush') return 'water';
    if (kind === 'billboard-grass') return 'foliage';
    if (Number(material?.alphaTest) > 0) return 'material.cutout';
    if (material?.transparent === true) return 'material.transparent';
    return 'material.opaque';
  }

  function protectedDrawPhase(item) {
    // Three's -100000 render-time pose sentinels must precede visible geometry;
    // >=900 overlay art and the 100000 cloud depth masks must retain their late
    // order. An editable visual category must never move these across a pass.
    const order = Number(item?.renderOrder) || 0;
    return order <= -10000 ? -1 : order >= 900 ? 1 : 0;
  }

  function withVisualSort(renderer, portraitOrder, draw) {
    const manual = xrayRule('layers.manualOrder') === 'on' && !!window.XrayHierarchy?.layerRank;
    const babyForegroundItem = item =>
      item?.object?.userData?.hobunjiFamilyBabyPhysicalCarry === true
      && Number(item.renderOrder) >= 30
      && window.XrayHierarchy?.get?.('baby.carrierForeground') !== 'off'; // Shared with both rank paths; stowed/dropped babies and opt-outs retain normal depth.
    if (!manual && !portraitOrder && !previouslyPresentedPet?.avatarRef) return draw();
    if (!renderer.setTransparentSort) return draw();
    // The usual actor-only draw has neither manual categories nor shoulder
    // faces. Its rank and render order already live on the render item and
    // the portrait maps. Avoid four per-draw Maps and their per-comparison
    // lookups, without changing the actor depth or original tie-break rules.
    if (!manual && portraitOrder && !previouslyPresentedPet?.avatarRef) {
      const effectiveOrder = item => Number(item.renderOrder) || 0; // Same normalization as the full compositor.
      renderer.setTransparentSort((a, b) => comparePortraitDraws(
        a, b, portraitOrder.ranks, portraitOrder.extras, effectiveOrder));
      withVisualSort.ordinaryDraws = (withVisualSort.ordinaryDraws || 0) + 1; // Mobile diagnostics: lightweight actor sorts.
      try { return draw(); }
      finally { renderer.setTransparentSort(null); }
    }
    const rankCache = new Map(); // One classification per render item, not per sort comparison.
    const pairCache = new Map(); // Per-draw pet/owner face identity; no repeated ancestor scans inside sort comparisons.
    const orderCache = new Map(); // Whole-list effective render orders for pet/owner stages AND unrelated items.
    const inward = previouslyPresentedPet?.__hobunjiShoulderFacingInward === true; // Snapshot the observation pose for this draw.
    const activePetPortrait = !!previouslyPresentedPet?.avatarRef; // Enables the shared owner/pet actor-depth keys only when a pet is attached.
    const stowedCarry = activePetPortrait && window.Shattercasks?.backCarriedInfo?.(); // One lookup for this draw.
    const pairFace = item => {
      if (!pairCache.has(item)) {
        let face = shoulderPetDrawFace(item); // Normal owner/pet classification.
        if (stowedCarry && !face) {
          if (window.Shattercasks.isStowedSortMesh?.(item.object)) face = 'stowed-burden';
          else if (item.object?.userData?.shattercaskRearOverlay) face = 'owner-back'; // The carrier's replacement skinned rear card.
        }
        pairCache.set(item, face);
      }
      return pairCache.get(item);
    };
    const drawOrder = item => {
      if (!orderCache.has(item)) {
        const face = pairFace(item);
        // A stowed load uses the carrier's rear/burden/front sandwich even when the pet turns inward.
        let stage = null; // Local order of the carry, pet, or owner face inside the carrier's actor slot.
        if (face === 'stowed-burden') {
          stage = item.object.userData?.shattercaskKeepsOwnDepth
            ? SHOULDER_PET_RENDER_ORDERS.stowedDepthPart : SHOULDER_PET_RENDER_ORDERS.stowedBurden;
        } else if (face) stage = shoulderPetFaceSortRank(face, !stowedCarry && inward);
        let value = Number(item.renderOrder) || 0; // All unrelated transparent objects keep their ordinary order.
        if (stage !== null) {
          const mesh = item.object;
          const split = mesh?.userData?.hobunjiShoulderSplitOverlay === true;
          const owner = face === 'owner-front' || face === 'owner-back';
          const ownerBase = face === 'owner-front' ? shoulderPetPresentation?.frontMesh : shoulderPetPresentation?.backMesh;
          // Hat and auxiliary portrait layers follow their owner's stage before a foreground pet.
          value = stage + (split ? 0.01 : owner && mesh !== ownerBase ? 0.5 : 0);
        }
        orderCache.set(item, value);
      }
      return orderCache.get(item);
    };
    const petManualRankAnchor = manual ? Math.min(
      window.XrayHierarchy.layerRank('actor.front'), window.XrayHierarchy.layerRank('actor.rear')) : 0; // Reserve one manual-rank slot for the owner/pet composite.
    const rank = item => {
      if (!rankCache.has(item)) {
        const value = babyForegroundItem(item) ? 10000
          : pairFace(item) ? petManualRankAnchor + drawOrder(item) * 0.001
          : window.XrayHierarchy.layerRank(visualLayerFor(item));
        rankCache.set(item, value);
      }
      return rankCache.get(item);
    };
    const playerActorRank = portraitOrder?.ranks?.get(shoulderPetPresentation?.frontMesh)
      || portraitOrder?.ranks?.get(shoulderPetPresentation?.backMesh) || null; // All attached pet/owner portrait faces must share this rank near other actors.
    const actorRankCache = new Map(); // Reuses actor lookup across pair comparisons without traversing the pet hierarchy.
    const actorRank = item => {
      if (!actorRankCache.has(item)) {
        const face = pairFace(item);
        actorRankCache.set(item, (activePetPortrait && face && playerActorRank ? playerActorRank : null)
          || portraitOrder?.ranks?.get(item.object) || portraitOrder?.extras?.get(item.object) || null);
      }
      return actorRankCache.get(item);
    };
    const legacyTransparent = (a, b) => portraitOrder
      ? comparePortraitDraws(a, b, portraitOrder.ranks, portraitOrder.extras, drawOrder, actorRank)
      : a.groupOrder - b.groupOrder || drawOrder(a) - drawOrder(b) || b.z - a.z || a.id - b.id;
    const actorSortKeyCache = new Map(); // One stable key per transparent item while actor-depth sorting and manual layers coexist.
    const actorSortKey = item => {
      if (!actorSortKeyCache.has(item)) {
        const actor = actorRank(item);
        const face = pairFace(item);
        const category = babyForegroundItem(item) ? 10000 : window.XrayHierarchy.layerRank(visualLayerFor(item));
        actorSortKeyCache.set(item, actor && Number.isFinite(actor.depth)
          ? {
              primary: petManualRankAnchor, depth: -actor.depth,
              owner: Number(actor.owner?.id) || 0,
              stage: face ? drawOrder(item) : category,
            }
          : { primary: category, depth: 0, owner: 0, stage: drawOrder(item) });
      }
      return actorSortKeyCache.get(item);
    };
    const legacyOpaque = (a, b) => a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder
      || (a.material?.id || 0) - (b.material?.id || 0) || a.z - b.z || a.id - b.id;
    if (manual && renderer.setOpaqueSort) renderer.setOpaqueSort((a, b) => {
      const phaseA = protectedDrawPhase(a), phaseB = protectedDrawPhase(b);
      const boundary = a.groupOrder - b.groupOrder || phaseA - phaseB;
      if (boundary) return boundary; // Preserve group and reserved pre/post-render phases.
      return phaseA ? legacyOpaque(a, b) : rank(a) - rank(b) || legacyOpaque(a, b);
    });
    renderer.setTransparentSort(manual
      ? (a, b) => {
          const phaseA = protectedDrawPhase(a), phaseB = protectedDrawPhase(b);
          const boundary = a.groupOrder - b.groupOrder || phaseA - phaseB;
          if (boundary) return boundary;
          if (phaseA) return legacyTransparent(a, b); // Depth masks, pose sentinels and final overlays cannot move by a UI rank.
          if (activePetPortrait && portraitOrder) {
            // The previous conditional actor-vs-actor override caused non-transitive
            // cycles with a shoulder pet, a nearby NPC and a third transparent item.
            // A shared tuple orders EVERY render item the same way: manual category,
            // then camera depth between actors, then the pet/owner's local face stage.
            const first = actorSortKey(a), second = actorSortKey(b);
            return first.primary - second.primary
              || first.depth - second.depth
              || first.owner - second.owner
              || first.stage - second.stage
              || a.id - b.id;
          }
          // Without a shoulder pet, retain the established actor-aware manual
          // category behavior; this patch must not globally reorder NPC gear.
          const actorA = portraitOrder?.ranks?.get(a.object) || portraitOrder?.extras?.get(a.object);
          const actorB = portraitOrder?.ranks?.get(b.object) || portraitOrder?.extras?.get(b.object);
          if (actorA && actorB && actorA.owner !== actorB.owner) return legacyTransparent(a, b);
          return rank(a) - rank(b) || legacyTransparent(a, b);
        }
      : legacyTransparent);
    try { return draw(); }
    finally {
      renderer.setTransparentSort(null);
      if (manual && renderer.setOpaqueSort) renderer.setOpaqueSort(null);
    }
  }

  function nearbyPortraitOrder(scene, camera, portraits) {
    const player = window.PlayerBodyTransformComposer?.getPlayerMesh?.();
    if (!player || !camera.projectionMatrix || !camera.matrixWorldInverse) return null;
    player.updateWorldMatrix(true, false);
    camera.updateMatrixWorld();
    const playerWorld = player.matrixWorld.elements;
    const actors = new Map(); // A front/rear pair and any split materials share the same camera-depth key.
    const ranks = new Map();
    const orderAll = xrayRule('actors.order') !== 'near';
    for (const portrait of portraits) {
      if (portrait.renderOrder >= 900) continue; // A lying portrait keeps its bed overlay order.
      let owner = portraitStencilOwner(portrait, scene);
      for (let node = portrait; node && node !== scene; node = node.parent) {
        if (node.userData?.hobunjiShoulderPetLayering) { owner = player; break; }
      }
      if (!owner || (owner !== player && !String(owner.name).startsWith('npc_walker_'))) continue;
      if (!actors.has(owner)) {
        owner.updateWorldMatrix(true, false);
        const world = owner.matrixWorld.elements;
        // Every visible actor is ordered by its own camera depth, near or far, so the player never ends up
        // in front of a distant NPC's garment just because that NPC was outside the crossing radius.
        // Only actors close enough to cross planes with the player take part when actors.order is 'near'.
        const close = Math.hypot(world[12] - playerWorld[12], world[13] - playerWorld[13], world[14] - playerWorld[14]) <= PORTRAIT_SORT_DISTANCE;
        const depth = (close || orderAll) ? portraitSortPoint.set(world[12], world[13], world[14])
          .applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix).z : NaN; // actors.order 'near' ranks only actors within the crossing radius.
        actors.set(owner, Number.isFinite(depth) ? { owner, depth, close } : null);
      }
      const rank = actors.get(owner);
      if (rank) ranks.set(portrait, rank);
    }
    if (!actors.get(player)) return null;
    let nearest = null;
    let count = 0;
    for (const rank of actors.values()) {
      if (!rank) continue;
      count++;
      if (!rank.close) continue; // The nearest-portrait protection is only about actors near the player.
      if (!nearest || rank.depth < nearest.depth
          || (rank.depth === nearest.depth && rank.owner.id > nearest.owner.id)) nearest = rank;
    }
    if (count < 2) return null;
    // Worn pants are separate meshes at renderOrder 28. They must sort alongside their wearer so a
    // more distant actor's pants never paint over a nearer actor's portrait; the portraits must ALSO
    // retain their normal depth writes so the owner's own front/back art can occlude its pants.
    const extras = new Map();
    if (xrayRule('pants.sortWithActor') !== 'off') for (const handle of window.PantsGarmentRenderer?.liveHandles?.() || []) {
      const mesh = handle?.mesh;
      if (!mesh?.parent || mesh.visible === false) continue; // Only an actually displayed cuff needs a solid-depth portrait.
      const rank = actors.get(portraitStencilOwner(mesh, scene));
      if (rank) extras.set(mesh, rank);
    }
    // A carried Burden (held baby at 30, stowed Burden at 2.15 between the 2.05 rear and 2.25 front
    // portrait passes) belongs to the player's actor slot. Unranked, it compared its raw renderOrder
    // against the ranked portrait's PORTRAIT_SORT_ORDER (2) and drew after the carrier's front face,
    // so a back-stowed baby showed through the parent's chest whenever another actor was nearby.
    const carrierRank = actors.get(player);
    for (const mesh of window.Shattercasks?.carrierSortMeshes?.() || [])
      if (mesh?.parent && mesh.visible !== false && !ranks.has(mesh)) extras.set(mesh, carrierRank);
    return { ranks, extras, nearest, count };
  }

  function comparePortraitDraws(a, b, ranks, extras = null, effectiveOrder = null, resolveActorRank = null) {
    const actorA = resolveActorRank ? resolveActorRank(a) : ranks.get(a.object) || extras?.get(a.object);
    const actorB = resolveActorRank ? resolveActorRank(b) : ranks.get(b.object) || extras?.get(b.object);
    const aOrder = effectiveOrder ? effectiveOrder(a) : a.renderOrder;
    const bOrder = effectiveOrder ? effectiveOrder(b) : b.renderOrder;
    // Three r128 compares group, render order, projected Z, then object ID.
    // A ranked portrait substitutes the actor's depth and keeps the original
    // front/back/shoulder layer order within that one actor. Garments ranked
    // with their wearer draw right after that wearer's portrait (renderOrder).
    return (actorA ? 0 : a.groupOrder) - (actorB ? 0 : b.groupOrder)
      || (actorA ? PORTRAIT_SORT_ORDER : aOrder) - (actorB ? PORTRAIT_SORT_ORDER : bOrder)
      || (actorB?.depth ?? b.z) - (actorA?.depth ?? a.z)
      || (actorA?.owner.id ?? a.id) - (actorB?.owner.id ?? b.id)
      || aOrder - bOrder
      || a.id - b.id;
  }

  function withPortraitDrawOrder(renderer, order, draw, protectNearPortrait = false) {
    if ((!order && xrayRule('layers.manualOrder') !== 'on' && !previouslyPresentedPet?.avatarRef) || !renderer.setTransparentSort) return draw();
    const changed = new Set(); // Depth-write states of pants-free distant portraits, restored even on an interrupted draw.
    if (protectNearPortrait && order) {
      const pantsRanks = new Set(order.extras?.values() || []); // A wearer needs its real portrait depth to stop the pants drawn immediately afterward.
      for (const [mesh, rank] of order.ranks) {
        if (rank === order.nearest || rank.close === false || pantsRanks.has(rank)) continue;
        // Without pants, preserve the original crossed-portrait protection: a distant actor's
        // forward-leaning PNG should not punch physical depth across the nearer actor's art.
        // Only pants wearers must keep their portrait's alpha-tested depth so their own cuffs,
        // and the cuffs of other actors, cannot x-ray through a solid portrait pixel.
        forEachMaterial(mesh.material, material => {
          if (!material.depthWrite) return; // Shoulder-pet compositor owns its own special depth-write-free portrait stack.
          material.depthWrite = false;
          changed.add(material);
        });
      }
    }
    let stowedDepthMaterials; // Restore limb materials before any subsequent depth or shell pass.
    try {
      if (protectNearPortrait && previouslyPresentedPet?.avatarRef) {
        for (const mesh of window.Shattercasks?.stowedDepthParts?.() || []) {
          forEachMaterial(mesh.material, material => {
            if (material.transparent) return;
            (stowedDepthMaterials ||= []).push(material);
            material.transparent = true; // Use the pet's color sort queue, retaining real depth tests and writes.
          });
        }
      }
      return withVisualSort(renderer, order, draw);
    } finally {
      for (const material of changed) material.depthWrite = true;
      if (stowedDepthMaterials) for (const material of stowedDepthMaterials) material.transparent = false;
    }
  }

  function rankedHeldOverlayOrder(portraitOrder, meshes, scene) {
    if (!portraitOrder?.ranks?.size) return null;
    // Pant garments moved from the world draw into the foot overlay. Preserve their
    // owner's cross-actor transparent sort even with the default manual sorter OFF.
    // Do not apply that sort to unrelated tools or feet outside explicit manual mode.
    if (xrayRule('layers.manualOrder') !== 'on') {
      if (xrayRule('pants.sortWithActor') === 'off') return null;
      return meshes.some(mesh => mesh.userData?.hobunjiPantsGarment === true && portraitOrder.extras?.has(mesh))
        ? portraitOrder : null;
    }
    const byOwner = new Map(); // Reuses the base portrait's actor-depth ranks for gear/hand draw entries.
    for (const rank of portraitOrder.ranks.values()) if (rank?.owner) byOwner.set(rank.owner, rank);
    const extras = new Map(portraitOrder.extras || []); // Existing pants continue to share their own actor's priority.
    for (const mesh of meshes) {
      const rank = byOwner.get(portraitStencilOwner(mesh, scene));
      if (rank) extras.set(mesh, rank);
    }
    return { ...portraitOrder, extras };
  }

  function assignPortraitStencilOwners(gearMeshes, portraits, scene) {
    const gearOwners = new Set(); // Only owners with a visible held weapon need a front-portrait stencil entry.
    for (const mesh of gearMeshes) {
      if (!isPortraitMaskedGear(mesh)) continue;
      const root = portraitStencilOwner(mesh, scene);
      if (root) gearOwners.add(root);
    }
    const ownerIds = new Map(); // Actor root -> unique 1..63 ID packed into stencil bits 2..7, per world frame.
    const maskedPortraits = []; // Registered front planes whose owner has weapon art in this frame's overlay.
    for (const portrait of portraits) {
      const owner = portraitStencilOwner(portrait, scene);
      if (!owner || !gearOwners.has(owner)) continue;
      let id = ownerIds.get(owner);
      if (!id) {
        if (ownerIds.size >= FRONT_PORTRAIT_MAX_OWNERS) continue; // Overflow fails open, never masks someone else's weapon.
        id = ownerIds.size + 1;
        ownerIds.set(owner, id);
      }
      maskedPortraits.push(portrait);
    }
    const gearIds = new Map(); // Held mesh -> owning stencil ID, reused across all elevation/water groups.
    for (const mesh of gearMeshes) {
      if (!isPortraitMaskedGear(mesh)) continue;
      const id = ownerIds.get(portraitStencilOwner(mesh, scene));
      if (id) gearIds.set(mesh, id);
    }
    return { portraits: maskedPortraits, ownerIds, gearIds };
  }

  function isLegacyHeldPlane(object) {
    if (!object?.isMesh || object.isInstancedMesh || object.isSkinnedMesh) return false;
    if (object.userData?.hobunjiFamilyBabyPhysicalCarry && xrayRule('baby.carrierForeground') === 'on') return false; // A held infant is physical PNG art, never a weapon-plane replay.
    if (object.userData?.hobunjiHeldObjectPlane === true) return true;
    return Math.abs(Number(object.renderOrder) - LEGACY_HELD_RENDER_ORDER) < 1e-6;
  }

  function forEachMaterial(material, fn) {
    if (Array.isArray(material)) {
      for (const entry of material) if (entry) fn(entry);
      return;
    }
    if (material) fn(material);
  }

  function prepareLight(light) {
    if (!light?.isLight || preparedLights.has(light)) return;
    // Held and replayed-water passes use private camera layers. Keep lights on
    // both so any future lit material behaves exactly like the normal base pass.
    light.layers.enable(HELD_OVERLAY_LAYER);
    light.layers.enable(WATER_REPLAY_LAYER);
    preparedLights.add(light);
  }

  function isAuthoredInkPlane(mesh) {
    // Only flat authored sprite/billboard art carries its outline in its PNG.
    // GLB hands/feet and genuinely volumetric held objects retain their
    // inverted shell and their independent ground/water depth treatment.
    if (mesh?.userData?.hobunjiProceduralHand === true || mesh?.userData?.hobunjiProceduralFoot === true) return false;
    const data = mesh?.userData || {}; // Mesh-authored art classification; never infer from a material shared with 3D props.
    // Pants are a deformable PNG-textured GRID (BufferGeometry), not PlaneGeometry;
    // their opaque art already includes ink and must never acquire shell outlines.
    return data.hobunjiPantsGarment === true || data.noOutline === true || data.isPngPlane === true
      || data.hobunjiWeaponAssemblyPart === true || data.isBillboard === true
      || data.isWildernessGrassChunk === true || data.isRichFoliageBillboard === true
      || mesh?.geometry?.type === 'PlaneGeometry';
  }

  function enforceHeldMesh(mesh) {
    if (!mesh?.isMesh) return false;
    let repaired = false;
    mesh.userData = mesh.userData || {};

    if (mesh.userData.hobunjiHeldObjectPlane !== true) {
      mesh.userData.hobunjiHeldObjectPlane = true;
      repaired = true;
    }
    mesh.userData.hobunjiLegacyRenderOrder = LEGACY_HELD_RENDER_ORDER;
    if (isAuthoredInkPlane(mesh)) {
      mesh.userData.noOutline = true; // Author-supplied ink must never acquire a synthetic black shell.
      if (hasLayer(mesh, SHELL_LAYER)) {
        mesh.layers.disable(SHELL_LAYER); // Retains default, held-overlay and water/x-ray depth layers.
        repaired = true;
      }
    }

    // Neutral renderOrder restores Three's ordinary positioning semantics in
    // any non-overlay/debug view. The selective depth replay supplies the one
    // exceptional ground-x-ray rule.
    if (mesh.renderOrder !== 0 && mesh.userData?.hobunjiWeaponAssemblyPart !== true) {
      lastHeldOrderNormalization = { mesh: String(mesh.name || mesh.type || 'held mesh').slice(0, 90),
        from: Number(mesh.renderOrder), to: 0 };
      heldOrderNormalizations++; // The authored value is not the live overlay layer; record when the renderer replaces it.
      mesh.renderOrder = 0;
      repaired = true;
    } // Ordered multi-sprite weapon children retain their deliberate back→fuel→fire→front draw order; the ordinary held haft still normalizes to 0.
    if (!hasLayer(mesh, DEFAULT_LAYER)) {
      mesh.layers.enable(DEFAULT_LAYER);
      repaired = true;
    }
    if (!hasLayer(mesh, HELD_OVERLAY_LAYER)) {
      mesh.layers.enable(HELD_OVERLAY_LAYER);
      repaired = true;
    }

    // Recolor/mastery refreshes can replace a material object. Repair the
    // CURRENT material instead of assuming the creation-time material survives.
    forEachMaterial(mesh.material, (material) => {
      if ('depthTest' in material && material.depthTest !== true) {
        material.depthTest = true;
        repaired = true;
      }
    });

    if (repaired) invariantRepairCount++;
    return repaired;
  }

  function markHeldPlane(mesh, knownScene = null) {
    if (!mesh?.isMesh) return false;
    const already = heldMeshes.has(mesh) || mesh.userData?.hobunjiHeldObjectPlane === true;
    heldMeshes.add(mesh);
    heldRegistry.add(mesh, knownScene);
    enforceHeldMesh(mesh);
    if (!already) heldCount++;
    return !already;
  }

  function markWaterOccludedMesh(mesh, knownScene = null) {
    if (!mesh?.isMesh) return false;
    mesh.userData = mesh.userData || {};
    const already = waterOccludedMeshes.has(mesh); // A preloaded semantic tag is not registration; count it on the first real compositor adoption.
    mesh.userData.hobunjiWaterOccludedBySurface = true;
    waterOccludedMeshes.add(mesh);
    waterOccludedRegistry.add(mesh, knownScene);
    if (!hasLayer(mesh, FOOT_WATER_MASK_LAYER)) mesh.layers.enable(FOOT_WATER_MASK_LAYER); // Retain compatibility for diagnostic/older foot consumers.
    if (!hasLayer(mesh, HELD_OVERLAY_LAYER)) mesh.layers.enable(HELD_OVERLAY_LAYER); // Feet x-ray through grass/paths, but never through water/snow/props.
    if (!already) {
      waterOccludedMeshCount++;
      if (mesh.userData.hobunjiPantsGarment === true) pantsXrayRegistrations++;
    }
    return !already;
  }

  function enforceGroundMesh(mesh) {
    if (!mesh?.isMesh) return false;
    let repaired = false;
    mesh.userData = mesh.userData || {};
    if (mesh.userData.hobunjiHeldGroundReplay !== true) {
      mesh.userData.hobunjiHeldGroundReplay = true;
      repaired = true;
    }
    // Additive only: never remove the normal world/material-ID layers.
    if (!hasLayer(mesh, GROUND_REPLAY_LAYER)) {
      mesh.layers.enable(GROUND_REPLAY_LAYER);
      repaired = true;
    }
    return repaired;
  }

  function markGroundMesh(mesh, kind = groundKind(mesh), knownScene = null) {
    if (!mesh?.isMesh || !kind) return false;
    const already = groundMeshes.has(mesh) || mesh.userData?.hobunjiHeldGroundReplay === true;
    groundMeshes.add(mesh);
    groundRegistry.add(mesh, knownScene);
    enforceGroundMesh(mesh);
    if (kind === 'interior-floor' && hasAncestorFlag(mesh, 'hobunjiPlayerFarmhouseInterior') && !countedFarmhouseFloors.has(mesh)) {
      countedFarmhouseFloors.add(mesh);
      farmhouseFloorCount++; // Registration can happen after the generic interior floor was already scanned.
    }
    if (!already) {
      groundCount++;
      if (kind === 'grass') grassCount++;
      else if (kind === 'road') roadCount++;
      else if (kind === 'terrain') terrainCount++;
      else if (kind === 'interior-floor') interiorFloorCount++;
    }
    return !already;
  }

  function classifyObject(object, knownScene = null) {
    if (!object) return;
    if (object.isLight) prepareLight(object);
    if (!object.isMesh) return;
    // The normal shell pass uses layer membership directly, even for art that never joins held replay.
    if (hasLayer(object, SHELL_LAYER) && isAuthoredInkPlane(object)) object.layers.disable(SHELL_LAYER);
    if (isPresentationBackdrop(object)) backgroundDepthRegistry.add(object, knownScene); // Registered once, looked up only in the current scene.
    if (isLegacyHeldPlane(object)) markHeldPlane(object, knownScene);
    if (object.userData?.hobunjiWaterOccludedBySurface === true) markWaterOccludedMesh(object, knownScene);
    if (hasLayer(object, PNG_OCCLUDER_LAYER) || materialHasAlphaCutout(object.material)) pngDepthRegistry.add(object, knownScene);
    if (isFrontPortraitMesh(object)) {
      if (!hasLayer(object, FRONT_PORTRAIT_MASK_LAYER)) object.layers.enable(FRONT_PORTRAIT_MASK_LAYER);
      frontPortraitRegistry.add(object, knownScene);
      waterPortraitRegistry.add(object, knownScene);
    } else if (object.name === 'npc_avatar_back_plane' || object.name === 'player_avatar_back_plane') {
      waterPortraitRegistry.add(object, knownScene);
    }
    const surfaceKind = surfaceKindForObject(object); // Computed once for the three surface predicates below.
    if (isProtectedCover(object, surfaceKind)) protectedCoverRegistry.add(object, knownScene);
    if (isTintCover(object, surfaceKind)) {
      tintCoverRegistry.add(object, knownScene);
      if (!hasLayer(object, WATER_REPLAY_LAYER)) object.layers.enable(WATER_REPLAY_LAYER);
    }
    if (isWaterSurface(object)) {
      if (!waterMeshes.has(object)) {
        waterMeshes.add(object);
        waterMeshCount++;
      }
    }
    const kind = groundKind(object, surfaceKind);
    if (kind) markGroundMesh(object, kind, knownScene);
    if (isTopFacesGroundSurface(object)) markTopFaceGroundMesh(object, knownScene); // Clip only upward cave-shell floor triangles in the depth rebuild, preserving walls and ceiling as real occluders.
  }

  function markTopFaceGroundMesh(mesh, knownScene = null) {
    const fresh = !topFaceGroundRegistry.has(mesh);
    topFaceGroundRegistry.add(mesh, knownScene);
    if (!fresh) return false;
    // The ground-depth restore pass draws the whole shell colorless. Its
    // walls already wrote identical depth in the rebuild pass, so only the
    // floor faces actually change anything there.
    if (!hasLayer(mesh, GROUND_REPLAY_LAYER)) mesh.layers.enable(GROUND_REPLAY_LAYER);
    topFaceGroundCount++;
    return true;
  }

  function materialHasAlphaCutout(material) {
    if (Array.isArray(material)) return material.some(entry => Number(entry?.alphaTest || 0) > 0);
    return Number(material?.alphaTest || 0) > 0;
  }

  function classifyTree(root) {
    if (!root) return;
    const knownScene = root.isScene && !root.parent ? root : null; // Only complete root walks prove every visited object's owning scene.
    classifyObject(root, knownScene);
    root.traverse?.((object) => {
      if (object !== root) classifyObject(object, knownScene);
    });
  }

  // Coalesced into a single flush per microtask turn rather than one
  // microtask per add() call: combat VFX (lunge trail stamps, swing-cone
  // ribbons) can call add() dozens of times within one frame, and each call
  // previously queued its own redundant full-tree classification pass.
  let pendingClassification = new Set();
  let classificationScheduled = false;

  // True when an ancestor of `object` is itself queued in `batch`: that
  // ancestor's classifyTree already visits `object`, so walking it again is
  // pure waste. A scene built bottom-up queues every nesting level, which
  // otherwise re-walked each descendant once per ancestor.
  function batchHasQueuedAncestor(batch, object) {
    for (let node = object.parent; node; node = node.parent) {
      if (batch.has(node)) return true;
    }
    return false;
  }

  function flushClassification() {
    classificationScheduled = false;
    if (!pendingClassification.size) return;
    const batch = pendingClassification;
    pendingClassification = new Set();
    for (const object of batch) {
      if (batchHasQueuedAncestor(batch, object)) continue;
      classifyTree(object);
    }
  }

  function queueClassification(objects) {
    for (const object of objects) pendingClassification.add(object);
    if (classificationScheduled) return;
    classificationScheduled = true;
    if (typeof queueMicrotask === 'function') queueMicrotask(flushClassification);
    else Promise.resolve().then(flushClassification);
  }

  // Scene.add has already been wrapped by natural-surface modules before this
  // file loads, so wrap BOTH the current Scene.add and Object3D.add. This catches
  // direct scene attachment as well as children created inside runtime groups.
  function wrapAdd(proto, marker) {
    const previousAdd = proto?.add;
    if (!proto || typeof previousAdd !== 'function' || previousAdd[marker]) return;
    function wrappedAdd(...objects) {
      const result = previousAdd.apply(this, objects);
      // Classification is deferred to one deduplicated flush (microtask, or
      // the start of the next render, whichever comes first). It previously
      // also ran synchronously here, walking every added subtree twice.
      queueClassification(objects); // also catches tags stamped just after add()
      return result;
    }
    wrappedAdd[marker] = true;
    wrappedAdd.__hobunjiHeldGroundXrayOriginal = previousAdd;
    proto.add = wrappedAdd;
  }

  wrapAdd(objectProto, '__hobunjiHeldGroundXrayObjectAdd');
  wrapAdd(sceneProto, '__hobunjiHeldGroundXraySceneAdd');

  function scanScene(scene, force = false) {
    if (!scene?.isScene || retiredScenes.has(scene)) return;
    if (classificationScheduled) flushClassification(); // Registries must reflect every add() made before this scan/render.
    const now = performance.now();
    const previous = lastSceneScan.get(scene);
    // With every actor category off, seed an existing scene once and rely on the add hooks
    // and explicit registrations instead of repeatedly walking static terrain for x-ray casters.
    if (!force && previous !== undefined && (allActorXrayDisabled || now - previous < FALLBACK_SCAN_INTERVAL_MS)) return;
    lastSceneScan.set(scene, now);
    classifyTree(scene);
  }

  // One upward walk finds both the owning root and whether any ancestor
  // (root included) is hidden.
  let walkVisible = true;
  function walkToRoot(object) {
    let node = object;
    walkVisible = true;
    for (;;) {
      if (node.visible === false) walkVisible = false;
      if (!node.parent) return node;
      node = node.parent;
    }
  }

  // `others`, when given, receives the visible held/foot meshes that the
  // replay participant policy leaves to ordinary depth (see isReplayParticipant).
  function collectVisible(registry, scene, others = null) {
    const result = others ? collectVisible(registry, scene) : null;
    if (result) {
      const isFoot = registry === waterOccludedRegistry;
      return splitReplayParticipants(result, scene, others, isFoot, registry === heldRegistry); // Resolve owners once; nonparticipant held meshes still have their invariant repaired.
    }
    const visible = [];
    for (const object of registry.pending) {
      registry.pending.delete(object);
      if (!object?.isMesh) { registry.delete(object); continue; }
      const root = walkToRoot(object);
      // Detached runtime meshes should not be kept alive by our registry.
      if (!root.isScene) registry.delete(object);
      else registry.place(object, root);
    }
    const bucket = registry.byScene.get(scene);
    if (!bucket) return visible;
    for (const object of bucket) {
      const root = walkToRoot(object);
      if (root !== scene) {
        if (!root.isScene) registry.delete(object);
        else registry.place(object, root);
        continue;
      }
      if (walkVisible) visible.push(object);
    }
    return visible;
  }

  // gl.getParameter() is a synchronous GPU round-trip in Chrome: calling it
  // twice per world render stalled the CPU until every previously queued draw
  // had finished, defeating CPU/GPU pipelining (it was the single largest
  // self-time entry in a headless frame profile). A framebuffer's stencil
  // depth is fixed at allocation, so it is measured once per render target
  // (and once for the default canvas framebuffer) and reused afterwards.
  const stencilBitsByTarget = new WeakMap(); // Render target -> measured STENCIL_BITS.
  let defaultFramebufferStencilBits = null; // Measured STENCIL_BITS of the canvas framebuffer.
  let stencilBitsContext = null; // Invalidates the cache if the renderer's GL context is replaced.

  function currentFramebufferStencilBits(renderer) {
    try {
      const gl = renderer?.getContext?.();
      if (!gl) return 0;
      if (gl !== stencilBitsContext) {
        stencilBitsContext = gl;
        defaultFramebufferStencilBits = null;
      }
      const target = renderer.getRenderTarget?.() || null;
      if (!target) {
        if (defaultFramebufferStencilBits === null) defaultFramebufferStencilBits = Number(gl.getParameter(gl.STENCIL_BITS)) || 0;
        return defaultFramebufferStencilBits;
      }
      let bits = stencilBitsByTarget.get(target);
      if (bits === undefined) {
        bits = Number(gl.getParameter(gl.STENCIL_BITS)) || 0;
        stencilBitsByTarget.set(target, bits);
      }
      return bits;
    } catch (_) {
      return 0;
    }
  }

  function isBaseWorldPass(scene, camera) {
    if (!scene?.isScene || !camera?.isCamera || scene.overrideMaterial) return false;
    const mask = Number(camera.layers.mask) >>> 0; // Used to distinguish the ordinary world draw from dedicated replay/outline layers.
    // Outlines-on frames normally arrive with every layer enabled, while a
    // valid outlines-off world draw can use only Three's default layer. The
    // former MASK_ALL-only check silently bypassed the x-ray on those layer-0
    // frames. Requiring the default world bit accepts both forms but rejects
    // shell, material-ID, PNG-depth, held-overlay, and ground-replay passes.
    return mask === MASK_ALL || !!(mask & DEFAULT_LAYER_MASK);
  }

  function hideObjects(objects) {
    const states = new Map();
    for (const object of objects) {
      if (!object || states.has(object)) continue;
      states.set(object, object.visible);
      object.visible = false;
    }
    return states;
  }

  function restoreVisibility(states) {
    for (const [object, visible] of states) object.visible = visible;
  }

  function suppressDraws(objects, excludedMask = MASK_ALL) {
    const layers = new Map(); // Layer exclusion hides a draw without skipping its mesh children.
    for (const object of objects) {
      if (!object?.layers || layers.has(object)) continue;
      layers.set(object, object.layers.mask);
      object.layers.mask &= ~excludedMask;
    }
    return layers;
  }

  function restoreDraws(layers) {
    for (const [object, mask] of layers) object.layers.mask = mask;
  }

  function getSurfaceOcclusionDepthOnly(material) {
    const composerValue = surfaceComposer?.getDepthOnly?.(material);
    if (composerValue !== undefined) return composerValue;
    const uniform = material?.uniforms?.uHobunjiSurfaceOcclusionDepthOnly;
    return uniform && 'value' in uniform ? uniform.value : undefined;
  }

  function setSurfaceOcclusionDepthOnly(material, enabled) {
    const composerPrevious = surfaceComposer?.setDepthOnly?.(material, enabled);
    if (composerPrevious !== undefined) return composerPrevious;
    const uniform = material?.uniforms?.uHobunjiSurfaceOcclusionDepthOnly;
    if (!uniform || !('value' in uniform)) return undefined;
    const previous = uniform.value;
    uniform.value = enabled ? 1 : 0;
    return previous;
  }

  function saveMaterialState(states, material) {
    if (!material || states.has(material)) return;
    states.set(material, {
      colorWrite: material.colorWrite,
      depthWrite: material.depthWrite,
      depthTest: material.depthTest,
      depthFunc: material.depthFunc,
      alphaTest: material.alphaTest,
      stencilWrite: material.stencilWrite,
      stencilWriteMask: material.stencilWriteMask,
      stencilFunc: material.stencilFunc,
      stencilRef: material.stencilRef,
      stencilFuncMask: material.stencilFuncMask,
      stencilFail: material.stencilFail,
      stencilZFail: material.stencilZFail,
      stencilZPass: material.stencilZPass,
      surfaceOcclusionDepthOnly: getSurfaceOcclusionDepthOnly(material),
    });
  }

  function restoreMaterialStates(states) {
    for (const [material, state] of states) {
      material.colorWrite = state.colorWrite;
      material.depthWrite = state.depthWrite;
      material.depthTest = state.depthTest;
      material.depthFunc = state.depthFunc;
      if (state.alphaTest !== undefined) material.alphaTest = state.alphaTest;
      material.stencilWrite = state.stencilWrite;
      material.stencilWriteMask = state.stencilWriteMask;
      material.stencilFunc = state.stencilFunc;
      material.stencilRef = state.stencilRef;
      material.stencilFuncMask = state.stencilFuncMask;
      material.stencilFail = state.stencilFail;
      material.stencilZFail = state.stencilZFail;
      material.stencilZPass = state.stencilZPass;
      if (state.surfaceOcclusionDepthOnly !== undefined) {
        setSurfaceOcclusionDepthOnly(material, Number(state.surfaceOcclusionDepthOnly) > 0.5);
      }
    }
  }

  function useSpriteOcclusionCutout(object, material) {
    // Only tagged authored PNG planes use the stricter mask. Foliage, water,
    // and other protected covers keep their own alpha and depth rules.
    if (!hasLayer(object, PNG_OCCLUDER_LAYER) || !material.map || Number(material.alphaTest) <= 0) return;
    const maskCutoff = Number(window.HobunjiSpritePngSurface?.maskAlphaTest?.()) || 0.35; // The same minimum coverage used by the regular depth-writing sprite factory.
    material.alphaTest = Math.max(Number(material.alphaTest), maskCutoff);
  }

  function prepareNonGroundDepthMaterials(scene, visibleCandidates = null, colorMaskLocked = false) {
    const states = new Map();
    const processCandidate = (object) => {
      const isMesh = !!object?.isMesh;
      const isCelestialSprite = !!object?.isSprite && object.userData?.hobunjiNoOutline === true; // Used here to suppress only the sky-dome sun/moon sprites during this colorless replay.
      if (!isMesh && !isCelestialSprite) return;
      const forceCutoutDepth = isMesh && hasLayer(object, PNG_OCCLUDER_LAYER);
      const forceCoverDepth = isMesh && isProtectedCover(object); // Transparent water/slush and alpha-cutout grass must occlude held gear.
      // GPU color masking makes ordinary opaque materials safe to leave untouched.
      // Preserve colorWrite=false for custom callbacks in EITHER render hook:
      // a draw-end observer can distinguish a depth replay by material state too.
      const hasDrawHook = (object.onBeforeRender && object.onBeforeRender !== objectProto.onBeforeRender)
        || (object.onAfterRender && object.onAfterRender !== objectProto.onAfterRender);
      forEachMaterial(object.material, (material) => {
        const forceDepth = isMesh && (forceCutoutDepth || forceCoverDepth || Number(material?.alphaTest || 0) > 0);
        if (colorMaskLocked && !forceDepth && !hasDrawHook) {
          shellOpaqueMaterialWritesAvoided++;
          return;
        }
        saveMaterialState(states, material);
        material.colorWrite = false;
        if (forceCoverDepth) setSurfaceOcclusionDepthOnly(material, true);
        // PNG avatar planes intentionally disable normal depth writing for
        // avatar-vs-avatar ordering. For this temporary occlusion buffer only,
        // use the game's existing layer-4 convention and preserve the real
        // alpha-tested silhouette while making it capable of blocking a tool.
        // Celestial sprites keep their authored depthWrite=false; only their
        // accidental second color draw is suppressed during this replay.
        if (forceDepth) material.depthWrite = true;
        if (forceCutoutDepth) useSpriteOcclusionCutout(object, material);
      });
    };
    // The shell pass supplies a snapshot of its already-visible renderables;
    // other callers keep the original live traversal as a conservative fallback.
    if (visibleCandidates) {
      for (const object of visibleCandidates) {
        if (isStillVisibleForShellReplay(object, scene)) processCandidate(object);
      }
    } else scene.traverseVisible(processCandidate);
    return states;
  }

  function prepareCutoutDepthMaterials(cutouts, protectedCover) {
    const states = new Map();
    for (const object of protectedCover) {
      forEachMaterial(object.material, material => {
        saveMaterialState(states, material);
        material.depthWrite = true; // Depth-only replay: keep visible base-pass cover pixels untouched.
        setSurfaceOcclusionDepthOnly(material, true);
      });
    }
    for (const object of cutouts) {
      forEachMaterial(object.material, (material) => {
        if (Number(material.alphaTest || 0) <= 0 && !hasLayer(object, PNG_OCCLUDER_LAYER)) return;
        saveMaterialState(states, material);
        material.depthWrite = true;
        useSpriteOcclusionCutout(object, material);
      });
    }
    return states;
  }

  function prepareFrontPortraitStencilMaterials(portraits, ownerIds, scene) {
    const states = new Map(); // Temporary state transaction: the visible portrait/material behavior is never changed permanently.
    for (const portrait of portraits) {
      const materials = Array.isArray(portrait.material) ? portrait.material : [portrait.material];
      const front = materials[0]; // Skinned portraits store front geometry in slot 0 and rear geometry in slot 1.
      const ownerId = ownerIds.get(portraitStencilOwner(portrait, scene)); // Match only this actor's held tools, not another NPC's weapon.
      if (!front || !ownerId) continue;
      for (const material of materials) {
        if (!material) continue;
        saveMaterialState(states, material);
        material.colorWrite = false;
        material.depthWrite = false; // Test against completed world depth; never overwrite walls, furniture, or the ground.
        const petForeground = portrait.userData?.hobunjiShoulderPetStencilForeground === true;
        material.stencilWrite = material === front || petForeground; // A foreground pet uses whichever front/back side is visible.
        if (!material.stencilWrite) continue;
        material.depthTest = true;
        material.depthFunc = THREE.LessEqualDepth; // Silhouette respects nearer world depth regardless of authored pet pose.
        material.stencilWriteMask = FRONT_PORTRAIT_STENCIL_MASK;
        material.stencilFunc = THREE.AlwaysStencilFunc;
        material.stencilRef = ownerId << 2;
        material.stencilFuncMask = FRONT_PORTRAIT_STENCIL_MASK;
        material.stencilFail = THREE.KeepStencilOp;
        material.stencilZFail = THREE.KeepStencilOp;
        material.stencilZPass = THREE.ReplaceStencilOp;
        if (material.map && Number(material.alphaTest) > 0) {
          const cutoff = Number(window.HobunjiSpritePngSurface?.maskAlphaTest?.()) || 0.35;
          material.alphaTest = Math.max(Number(material.alphaTest), cutoff);
        }
      } // Only solid pixels of the selected front portrait or foreground pet stamp owner bits.
    }
    return states;
  }

  function stampFrontPortraitStencil(renderer, scene, camera, portraits, ownerIds, portraitOrder) {
    if (!portraits.length) return false;
    const originalMask = camera.layers.mask; // Restores the caller's world mask even on an interrupted render.
    const selected = new Set(portraits); // The stencil camera layer is present on every registered front, not just current gear owners.
    const unrelatedFronts = suppressDraws(
      collectVisible(frontPortraitRegistry, scene).filter(mesh => !selected.has(mesh)),
      FRONT_PORTRAIT_MASK,
    ); // Prevent unselected NPC/pet portraits from drawing full COLOR during a private owner-mask stamp.
    const states = prepareFrontPortraitStencilMaterials(portraits, ownerIds, scene);
    try {
      camera.layers.mask = FRONT_PORTRAIT_MASK;
      withPortraitDrawOrder(renderer, portraitOrder, () => rawRender.call(renderer, scene, camera)); // Only selected owner silhouettes may draw.
      frontPortraitMaskPassCount++;
      return true;
    } finally {
      camera.layers.mask = originalMask;
      restoreMaterialStates(states);
      restoreDraws(unrelatedFronts);
    }
  }

  // The attached owner/pet portrait is depth-write-free in its ordinary
  // color pass. On a stencil-less target this bounded fallback restores only
  // the owner's alpha-tested front silhouette into the completed world depth
  // immediately before held sprites. The pet's color-stage order is untouched.
  function stampFrontPortraitDepthFallback(renderer, scene, camera, portraits, ownerIds, portraitOrder) {
    if (!portraits.length) return false;
    const oldMask = camera.layers.mask;
    const selected = new Set(portraits); // One owner's front portrait plus whichever pet face belongs above that owner face.
    const unrelated = suppressDraws(
      collectVisible(frontPortraitRegistry, scene).filter(mesh => !selected.has(mesh)),
      FRONT_PORTRAIT_MASK,
    ); // Do not let other NPCs or the background pet write into this owner's private depth mask.
    const states = prepareFrontPortraitStencilMaterials(portraits, ownerIds, scene); // Exact alpha cutout, world depth and restored material states.
    try {
      for (const portrait of portraits) {
        const materials = Array.isArray(portrait.material) ? portrait.material : [portrait.material];
        const foregroundPet = portrait.userData?.hobunjiShoulderPetStencilForeground === true;
        for (const material of materials) {
          if (!material || (!foregroundPet && material !== materials[0]) || !material.stencilWrite) continue;
          material.stencilWrite = false; // A stencil-less framebuffer still needs a valid depth fallback.
          material.depthWrite = true; // Solid front portrait pixels hide weapons physically behind them.
        }
      }
      camera.layers.mask = FRONT_PORTRAIT_MASK;
      withPortraitDrawOrder(renderer, portraitOrder, () => rawRender.call(renderer, scene, camera));
      frontPortraitDepthFallbackPasses++;
      return true;
    } finally {
      camera.layers.mask = oldMask;
      restoreMaterialStates(states); // Never leave the owner or shoulder pet writing depth in its ordinary color pass.
      restoreDraws(unrelated);
    }
  }

  function preparePortraitGearStencilMaterials(overlayMeshes, gearIds) {
    const states = new Map(); // A dry weapon only tests its owner ID; it never writes a water-tint bit.
    for (const object of overlayMeshes) {
      const ownerId = gearIds.get(object);
      if (!ownerId) continue;
      forEachMaterial(object.material, material => {
        saveMaterialState(states, material);
        material.stencilWrite = true; // Three.js gates stencil testing on this flag.
        material.stencilWriteMask = 0x00;
        material.stencilFunc = THREE.NotEqualStencilFunc; // Unmasked pixels and OTHER characters are visible.
        material.stencilRef = ownerId << 2;
        material.stencilFuncMask = FRONT_PORTRAIT_STENCIL_MASK;
        material.stencilFail = THREE.KeepStencilOp;
        material.stencilZFail = THREE.KeepStencilOp;
        material.stencilZPass = THREE.KeepStencilOp;
      });
    }
    return states;
  }

  function prepareSubmergedOverlayStencilMaterials(overlayMeshes, stencilRef = 1, gearIds = null, depthOnly = false) {
    const states = new Map();
    for (const object of overlayMeshes) {
      forEachMaterial(object.material, material => {
        saveMaterialState(states, material);
        // Stamp only visible held/hand/foot fragments that pass solid
        // depth. Enforce depthWrite during the temporary draw so water
        // BEHIND a weapon/hand/foot fails the tint pass, even if that PNG's
        // normal alpha compositing material opts out of depth writes.
        // Keep the authored alphaTest to avoid opaque rectangle stamps.
        material.depthTest = true;
        material.depthWrite = true;
        material.stencilWrite = true;
        material.stencilWriteMask = depthOnly ? 0 : 0x01;
        const ownerId = gearIds?.get(object) || 0; // Only held weapon art with a registered matching portrait is shielded.
        material.stencilFunc = ownerId ? THREE.NotEqualStencilFunc : THREE.AlwaysStencilFunc;
        const meshTint = typeof stencilRef === 'number' ? stencilRef : (stencilRef.get(object) || 0); // Distinct flail parts share one depth draw where their materials allow it.
        material.stencilRef = (ownerId << 2) | meshTint; // Writes wet/dry bit 0 while comparing only the packed portrait owner ID.
        material.stencilFuncMask = ownerId ? FRONT_PORTRAIT_STENCIL_MASK : 0xFF;
        material.stencilFail = THREE.KeepStencilOp;
        material.stencilZFail = THREE.KeepStencilOp;
        material.stencilZPass = THREE.ReplaceStencilOp;
      });
    }
    return states;
  }

  function stampSubmergedPortraits(renderer, scene, camera, portraits) {
    const oldMask = camera.layers.mask; // Keep other transparent art and non-submerged portraits out of the stamp.
    const layers = new Map(); // Temporary, so the private layer never participates in unrelated world passes.
    const states = prepareSubmergedOverlayStencilMaterials(portraits);
    try {
      for (const portrait of portraits) {
        layers.set(portrait, portrait.layers.mask);
        portrait.layers.mask |= PORTRAIT_WATER_MASK;
      }
      for (const material of states.keys()) material.colorWrite = false;
      camera.layers.mask = PORTRAIT_WATER_MASK;
      rawRender.call(renderer, scene, camera);
    } finally {
      camera.layers.mask = oldMask;
      restoreDraws(layers);
      restoreMaterialStates(states);
    }
  }

  function prepareOverlayCoverTintMaterials(covers) {
    const states = new Map();
    for (const object of covers) {
      forEachMaterial(object.material, material => {
        saveMaterialState(states, material);
        // Blend authored water/slush color and alpha over visible foot,
        // hand and weapon pixels only when the surface is closer. Do NOT
        // force depthTest off: the user's flood probe measured raised opaque
        // grass in front of the flood (grass 0.341 > water 0.160) and an
        // unoccluded water overlay would create exactly those color splotches.
        // Preserve overlay depth until after the tint pass.
        material.depthTest = true;
        material.depthWrite = false;
        material.stencilWrite = true;
        material.stencilWriteMask = 0x00;
        material.stencilFunc = THREE.EqualStencilFunc;
        material.stencilRef = 1;
        material.stencilFuncMask = 0x01;
        material.stencilFail = THREE.KeepStencilOp;
        material.stencilZFail = THREE.KeepStencilOp;
        material.stencilZPass = THREE.KeepStencilOp;
      });
    }
    return states;
  }

  function prepareTintCoverDepthMaterials(covers) {
    const states = new Map();
    for (const object of covers) {
      forEachMaterial(object.material, material => {
        saveMaterialState(states, material);
        material.colorWrite = false;
        material.depthTest = true;
        material.depthWrite = true; // Real foreground cover depth for held weapons/hands.
        material.stencilWrite = false;
        setSurfaceOcclusionDepthOnly(material, true);
      });
    }
    return states;
  }

  function prepareGroundDepthMaterials(ground) {
    const states = new Map();
    for (const object of ground) {
      forEachMaterial(object.material, (material) => {
        saveMaterialState(states, material);
        material.colorWrite = false;
        // Preserve depthWrite exactly. Farm/town grass currently writes depth;
        // wilderness grass intentionally does not. Replaying each as authored
        // reconstructs the postprocess depth buffer without changing its color.
      });
    }
    return states;
  }

  function unwrapRendererRender(fn) {
    const seen = new Set();
    let current = fn;
    while (typeof current === 'function' && !seen.has(current)) {
      seen.add(current);
      const next = current.__hobunjiTerrainChunkOriginal
        || current.__hobunjiTerrainSurfaceOriginal
        || current.__hobunjiNaturalSurfacePostJigsawOriginal
        || current.__hobunjiOutlineRenderPerfOriginal
        || current.__hobunjiHeldRenderOrderOriginal
        || current.__hobunjiPlayerBodyComposerOriginal
        || current.__hobunjiDrunkProneCompositionOriginal
        || current.__hobunjiHeftrootBillboardOriginal
        || current.__hobunjiCropReadyPresentationOriginal
        || current.__hobunjiCropBillboardPresentationOriginal
        || current.__hobunjiCropSpriteArtOriginal
        || current.__hobunjiHeldSeedActionOriginal
        || current.__hobunjiPerfDebugOriginal
        || null;
      if (typeof next !== 'function' || next === current) break;
      current = next;
    }
    return current;
  }

  const originalRender = rendererProto.render;
  const rawRender = unwrapRendererRender(originalRender);

  // The replay passes below only change pixels where held planes (and, for
  // the foot-water composite, the registered feet) actually land on screen:
  // everywhere else they rebuild exactly the depth the base pass already
  // wrote. Clipping the depth clear and every replay draw to a scissor
  // rectangle around those meshes leaves the rest of the framebuffer's base
  // depth untouched and stops the GPU re-rasterizing the whole world 3-5
  // extra times per frame while a tool is held. Anything that can't be
  // bounded conservatively (instanced/morphed geometry, a corner behind the
  // camera, a partial viewport) falls back to the old full-screen passes.
  // Skinned meshes are bounded per bone (skinnedScissorBoxes below).
  const scissorBox = new THREE.Box3();
  const scissorCorner = new THREE.Vector3();
  // Skinned bodies (neck-rigged portraits, wings, pet overlays). r128 skins a
  // vertex p as bindMatrixInverse · Σ wᵢ·Bᵢ·bindMatrix·p with Σ wᵢ = 1: a convex
  // combination of p moved rigidly by each bone that influences it. So the
  // union of every bone's influenced-vertex box, moved by that bone, contains
  // the drawn body, and so does the screen rectangle around those corners.
  // Before this, any wet body portrait in the tint pass forced a full-screen
  // replay of the whole world (device report: held=skinned-mesh, ~700 extra
  // draws a frame). Both the bone matrices last uploaded to the GPU and the
  // current bone.matrixWorld are included, so a skeleton not yet updated this
  // frame is still covered. Weights summing below 1 pull vertices toward the
  // mesh origin, which is added then; anything not provably bounded (weights
  // above 1, out-of-range bone indices, morph targets, a per-draw hook that
  // can re-pose it) keeps the full-screen fallback.
  let skinnedScissorEnabled = true; // A/B switch: HeldObjectRenderOrder.setSkinnedScissorEnabled(false).
  let skinnedScissorBounds = 0; // Lifetime count of skinned meshes bounded instead of forcing full screen (snapshot()).
  const skinnedInfluenceCache = new WeakMap(); // geometry -> per-bone bind-space boxes, keyed by attribute versions.
  const skinnedBoneMatrix = new THREE.Matrix4();
  const skinnedChainMatrix = new THREE.Matrix4();
  const skinnedOriginBox = new THREE.Box3();
  function skinnedInfluenceBoxes(geometry, boneCount) {
    const { position, skinIndex, skinWeight } = geometry.attributes || {};
    if (!position || !skinIndex || !skinWeight || skinIndex.count < position.count || skinWeight.count < position.count) return { reason: 'skinned-missing-weights' };
    const key = `${position.version}:${skinIndex.version}:${skinWeight.version}:${position.count}:${boneCount}`;
    const cached = skinnedInfluenceCache.get(geometry);
    if (cached?.key === key) return cached;
    const boxes = new Map(); // bone index -> Box3 of the bind-pose vertices it moves.
    let reason = null, belowOne = false;
    for (let v = 0; v < position.count && !reason; v++) {
      const x = position.getX(v), y = position.getY(v), z = position.getZ(v);
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const w = k === 0 ? skinWeight.getX(v) : k === 1 ? skinWeight.getY(v) : k === 2 ? skinWeight.getZ(v) : skinWeight.getW(v);
        if (!(w > 0)) { if (w < 0 || Number.isNaN(w)) reason = 'skinned-weights-unbounded'; continue; }
        sum += w;
        const bone = k === 0 ? skinIndex.getX(v) : k === 1 ? skinIndex.getY(v) : k === 2 ? skinIndex.getZ(v) : skinIndex.getW(v);
        if (!(bone >= 0 && bone < boneCount)) { reason = 'skinned-bone-index'; break; }
        let box = boxes.get(bone);
        if (!box) boxes.set(bone, box = new THREE.Box3());
        box.expandByPoint(scissorCorner.set(x, y, z));
      }
      if (sum > 1 + 1e-4) reason = 'skinned-weights-unbounded';
      else if (sum < 1 - 1e-4) belowOne = true;
    }
    const entry = { key, boxes, belowOne, reason };
    skinnedInfluenceCache.set(geometry, entry);
    return entry;
  }
  function hasPerDrawHook(mesh) {
    const hook = mesh.onBeforeRender;
    return typeof hook === 'function' && hook !== THREE.Object3D.prototype.onBeforeRender
      && !(mesh.__hobunjiXrayBoundParity && mesh.__hobunjiXrayBoundParity.hook === hook);
  }
  // Calls include(box, matrix) for each bone box and its skin matrix under one
  // model pose. Returns a failure reason, or null when every vertex is covered.
  function forEachSkinnedBox(mesh, poseMatrix, include) {
    const skeleton = mesh.skeleton, bones = skeleton?.bones;
    if (!bones?.length || !mesh.bindMatrix || !mesh.bindMatrixInverse) return 'skinned-missing-skeleton';
    if (hasPerDrawHook(mesh)) return 'skinned-draw-hook'; // e.g. shoulder-pet yaw re-poses the bones at draw time; parity adapters are bounded above.
    const influence = skinnedInfluenceBoxes(mesh.geometry, bones.length);
    if (influence.reason) return influence.reason;
    const uploaded = skeleton.boneMatrices; // What the GPU drew with if the skeleton is not refreshed this frame.
    let towardOrigin = influence.belowOne;
    for (const [index, box] of influence.boxes) {
      for (let source = 0; source < (uploaded?.length >= (index + 1) * 16 ? 2 : 1); source++) {
        if (source === 0) {
          const bone = bones[index];
          if (bone) skinnedBoneMatrix.multiplyMatrices(bone.matrixWorld, skeleton.boneInverses[index]);
          else skinnedBoneMatrix.copy(skeleton.boneInverses[index]); // r128 uses identity for a missing bone.
        } else {
          const o = index * 16; // The shader skins with a vec4 and no divide: only affine or never-uploaded (all zero) matrices are boundable.
          if (uploaded[o + 3] !== 0 || uploaded[o + 7] !== 0 || uploaded[o + 11] !== 0) return 'skinned-bone-matrix';
          if (uploaded[o + 15] === 0) {
            for (let e = 0; e < 16; e++) if (uploaded[o + e] !== 0) return 'skinned-bone-matrix';
            towardOrigin = true; // A zero matrix drops that bone's share, pulling the vertex toward the mesh origin.
            continue;
          }
          if (uploaded[o + 15] !== 1) return 'skinned-bone-matrix';
          skinnedBoneMatrix.fromArray(uploaded, o);
        }
        skinnedChainMatrix.multiplyMatrices(poseMatrix, mesh.bindMatrixInverse).multiply(skinnedBoneMatrix).multiply(mesh.bindMatrix);
        const m = skinnedChainMatrix.elements;
        if (!Number.isFinite(m[0] + m[1] + m[2] + m[4] + m[5] + m[6] + m[8] + m[9] + m[10] + m[12] + m[13] + m[14])) return 'skinned-bone-matrix';
        if (!include(box, skinnedChainMatrix)) return lastScissorFailureReason;
      }
    }
    if (towardOrigin) {
      skinnedOriginBox.min.set(0, 0, 0); skinnedOriginBox.max.set(0, 0, 0);
      if (!include(skinnedOriginBox, poseMatrix)) return lastScissorFailureReason;
    }
    return null;
  }
  const scissorRect = new THREE.Vector4();
  const elevationScissorRect = new THREE.Vector4(); // Temporary screen bounds for one actor elevation.
  const participantFrustum = new THREE.Frustum(); // Conservative game-camera bounds for source meshes.
  const participantProjection = new THREE.Matrix4(); // Reused camera view-projection matrix for source-mesh culling.
  const scissorViewport = new THREE.Vector4();
  const scissorDrawingSize = new THREE.Vector2();
  const SCISSOR_MARGIN_PX = 4;
  let replayScissorEnabled = true; // Debug A/B switch: HeldObjectRenderOrder.setReplayScissorEnabled(false) restores full-screen replay passes.
  let scissorTargetWidth = 0; // Framebuffer size the last scissorRect was measured against; used to build the replay cull frustum.
  let scissorMinimumWorldY = Infinity; // Shared result of the last successful projected-bounds calculation.
  let scissorTargetHeight = 0;

  // Scissoring alone only saves fragment work: every replay pass still
  // submitted every on-screen draw call and transformed every on-screen
  // vertex, roughly doubling the world's vertex/draw load whenever a tool
  // was held (which, with NPCs carrying gear, is nearly every frame on every
  // map). Objects whose bounds project entirely outside the scissor
  // rectangle cannot touch a single pixel those passes are allowed to write,
  // so they are hidden for the duration of the replay. The test is the same
  // bounding-sphere frustum test three.js already applies, just against the
  // sub-frustum the scissor rectangle carves out of the camera frustum.
  const CULL_EXTRA_MARGIN_PX = 16; // Slack for vertex-shader sway beyond a mesh's static bounds (three's own culling has none).
  const replayCullFrustum = new THREE.Frustum();
  const replayCullMatrix = new THREE.Matrix4();
  let replayCullEnabled = true; // Debug A/B switch: HeldObjectRenderOrder.setReplayCullEnabled(false).
  let lastReplayCulledCount = 0; // Renderables hidden from the last scissored replay.
  let lastReplayKeptCount = 0; // Cullable renderables still drawn by the last scissored replay.
  let lastReplayInstancedCulled = 0, lastReplayInstancedKept = 0; // Instanced wall/path brick meshes hidden from, and kept in, the last scissored replay.
  let lastReplayInertCount = 0; // Sky shells skipped by the last scissored replay because they cannot write depth.

  function setReplayCullFrustum(camera, rect, width, height) {
    const x0 = Math.max(0, rect.x - CULL_EXTRA_MARGIN_PX), y0 = Math.max(0, rect.y - CULL_EXTRA_MARGIN_PX);
    const x1 = Math.min(width, rect.x + rect.z + CULL_EXTRA_MARGIN_PX), y1 = Math.min(height, rect.y + rect.w + CULL_EXTRA_MARGIN_PX);
    if (!(x1 > x0 && y1 > y0)) return false;
    // NDC-space rectangle of the scissor, then a clip-space remap that sends
    // it to [-1, 1] (x' = (x - c*w) / h), leaving z/w untouched.
    const cx = ((x0 + x1) / width) - 1, hx = (x1 - x0) / width;
    const cy = ((y0 + y1) / height) - 1, hy = (y1 - y0) / height;
    replayCullMatrix.set(
      1 / hx, 0, 0, -cx / hx,
      0, 1 / hy, 0, -cy / hy,
      0, 0, 1, 0,
      0, 0, 0, 1,
    );
    replayCullMatrix.multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
    replayCullFrustum.setFromProjectionMatrix(replayCullMatrix);
    return true;
  }

  function isReplayCullable(object) {
    if (object.frustumCulled === false || object.children.length) return false; // Hiding a parent would hide children that may be in view.
    if (object.isSprite && object.userData?.hobunjiHeldOverlayParticle === true) return false; // Moving enchantment motes inherit the held blade's expanded scissor but must not be hidden by the replay's extra object-frustum cull.
    if (object.isSprite) return true;
    if (!object.isMesh || object.isInstancedMesh || object.isSkinnedMesh) return false; // r128 bounds these by the base geometry only.
    const geometry = object.geometry;
    return !!geometry && !geometry.morphAttributes?.position?.length;
  }

  let instancedReplaySphereReuses = 0; // Counts costly instanced-world-bounds queries reused by the frustum cull.

  function hasAlternateReplayPose(object) {
    // A fresh hand/foot parity snapshot can be the transform used by a later
    // draw even when matrixWorld currently projects outside this viewport.
    // It is unsafe to cull these meshes against the current matrix alone.
    const parity = object?.__hobunjiXrayBoundParity; // Existing trusted per-rig draw-hook registration.
    // An identical snapshot is no alternate pose: the cull test against matrixWorld already covers that
    // draw. Keeps every avatar portrait (they publish the contract too) cullable in the normal case.
    return !!parity && parity.hook === object?.onBeforeRender && !!parity.visibleMatrixWorld && parity.isFresh?.() === true
      && !(object.matrixWorld && parity.visibleMatrixWorld.equals?.(object.matrixWorld));
  }

  // InstancedMeshes cannot normally leave a replay: r128 bounds them by their
  // base geometry only. Two kinds can: meshes tagged by InstancedMeshBounds
  // (wall/path bricks, farm/town grass render chunks), whose sphere covers
  // every instance, and meshes whose authored geometry bounds already enclose
  // every instance (wilderness grass and rich-foliage chunks).
  let instancedReplaySphereScratch = null; // Created on first use; most scenes have few tagged meshes.
  function instancedReplaySphere(object) {
    if (!object.isInstancedMesh || object.children.length || object.userData?.hobunjiInstanceBounds !== true) return null;
    const bounds = window.InstancedMeshBounds;
    if (!bounds?.worldSphere) return null;
    if (!instancedReplaySphereScratch) instancedReplaySphereScratch = new THREE.Sphere();
    return bounds.worldSphere(object, instancedReplaySphereScratch) || null;
  }
  function hasAuthoredInstanceBounds(object) {
    return !!(object.isInstancedMesh && !object.children.length && object.frustumCulled !== false
      && object.userData?.hobunjiAuthoredInstanceBounds === true && object.geometry?.boundingSphere);
  }

  // Sky shells that neither test-and-write nor write depth cannot change a
  // colorless depth replay, and they sit on layer 0 only, so no layer-masked
  // color draw inside a replay can show them either. The material is checked
  // live so a later change to the sky's depth policy keeps it in the replay.
  function isDepthReplayInert(object, allowFarOnly = false) {
    const directMaterial = object.material; // Ordinary single-material depth writers cannot be inert, except explicitly pinned far-plane depth.
    if (directMaterial && !Array.isArray(directMaterial) && directMaterial.depthWrite !== false
        && (!allowFarOnly || !materialPinnedToFarPlane(directMaterial))) return false;
    if (object.isMesh && object.userData?.hobunjiDepthReplayInert === true && !object.children.length) {
      const material = object.material;
      return !!material && !Array.isArray(material) && material.depthWrite === false
        && !(Number(material.alphaTest) > 0) && object.layers.mask === 1;
    }
    return isAutoDepthReplayInert(object) || (allowFarOnly && isFarPlaneDepthOnly(object));
  }

  // Cloud depth masks (sky-dome.js setSkyLayerDepth) and distant backdrops
  // (western-slope-mountain-backdrops.js) pin their depth within a few 16-bit
  // steps of the far plane, so they can never cover a hand, foot or held item.
  // They still matter for the depth buffer itself, so they may only leave a
  // replay that never clears depth or restores it by copy (near replay).
  let farOnlyReplaySkips = 0; // Lifetime count (snapshot()).
  function materialPinnedToFarPlane(material) {
    const data = material?.userData;
    return !!data && (Number.isFinite(data.skyLayerDepthNdc) || Number.isFinite(data.backgroundMaxDepthNdc));
  }
  function isFarPlaneDepthOnly(object) {
    if (!(object.isMesh || object.isLine || object.isPoints) || object.children?.length || object.layers?.mask !== 1) return false;
    if (object.onBeforeRender && object.onBeforeRender !== objectProto.onBeforeRender) return false;
    const material = object.material;
    if (!(Array.isArray(material) ? material.length && material.every(materialPinnedToFarPlane) : materialPinnedToFarPlane(material))) return false;
    farOnlyReplaySkips++;
    return true;
  }

  // The same reasoning applied to every untagged leaf that provably cannot
  // change a colorless replay: layer 0 only (no layer-masked color draw shows
  // it), every material leaves depth and stencil alone, and nothing in the
  // replay forces depth on: meshes that are protected covers (water, snow,
  // grass), PNG occluders or alpha-cutouts get depthWrite=true for the replay,
  // so they stay. Sprites never get forced depth. Objects with their own
  // onBeforeRender keep running in render order (pose-sync hooks rely on it).
  // Outdoors this drops the sun/moon/glow sprites and additive fire/smoke
  // emitters from every replay; they were resubmitted 5-6 times per frame.
  let autoInertReplayCount = 0; // Lifetime count of submissions skipped by the rule above (snapshot()).
  let autoInertReplayEnabled = true; // A/B switch: HeldObjectRenderOrder.setAutoInertReplayEnabled(false).
  function materialLeavesDepthAndStencil(material, ignoreAlphaTest = false) {
    return !!material && material.depthWrite === false && material.stencilWrite !== true
      && (ignoreAlphaTest || !(Number(material.alphaTest) > 0));
  }
  function isAutoDepthReplayInert(object) {
    if (!autoInertReplayEnabled) return false;
    if (!(object.isMesh || object.isSprite || object.isPoints) || object.children?.length || object.layers?.mask !== 1) return false;
    if (object.onBeforeRender && object.onBeforeRender !== objectProto.onBeforeRender) return false;
    if (object.isSprite && object.userData?.hobunjiHeldOverlayParticle === true) return false;
    const material = object.material;
    const ignoreAlphaTest = !object.isMesh; // Only meshes get depthWrite forced for alpha cutouts; sprites/points keep their authored depthWrite:false.
    if (Array.isArray(material) ? !material.length || !material.every(m => materialLeavesDepthAndStencil(m, ignoreAlphaTest)) : !materialLeavesDepthAndStencil(material, ignoreAlphaTest)) return false;
    if (object.isMesh && (pngDepthRegistry.has(object) || protectedCoverRegistry.has(object) || tintCoverRegistry.has(object)
      || hasLayer(object, PNG_OCCLUDER_LAYER) || isProtectedCover(object))) return false;
    autoInertReplayCount++;
    return true;
  }

  // Colour-only VFX in colourless depth submissions. Several replay draws run
  // with the colour mask locked off (held depth rebuild, gear-depth recovery,
  // x-ray shell depth). A visible descendant of held gear whose materials
  // write neither depth nor stencil cannot change a pixel there — weapon
  // enchantment motes (combat/weapon-enchantment-vfx.js, up to 24 per blade
  // plane) are the large case: with an enchanted dual-wield flail they were
  // hundreds of no-op draw calls a frame. Hidden for exactly those submissions;
  // every colour pass still draws them. The material state is read at draw
  // time, after the depth-material transactions, so anything those force to
  // write depth stays.
  let colorOnlyDepthSkipEnabled = true; // A/B switch: HeldObjectRenderOrder.setColorOnlyDepthSkipEnabled(false).
  let colorOnlyDepthSkips = 0; // Lifetime count of draws skipped by the rule above (snapshot()).
  const colorOnlyScratch = []; // Reused per colourless submission.
  function isColorOnlyHeldVfx(node) {
    if (!(node.isSprite || node.isMesh || node.isPoints) || node.children?.length) return false;
    if (heldRegistry.has(node) || waterOccludedRegistry.has(node)) return false; // Gear parts have their own depth rules.
    if (node.onBeforeRender && node.onBeforeRender !== objectProto.onBeforeRender) return false;
    const material = node.material;
    const ignoreAlphaTest = !node.isMesh; // Same cutout rule as isAutoDepthReplayInert.
    if (Array.isArray(material) ? !material.length || !material.every(m => materialLeavesDepthAndStencil(m, ignoreAlphaTest)) : !materialLeavesDepthAndStencil(material, ignoreAlphaTest)) return false;
    return !(node.isMesh && (pngDepthRegistry.has(node) || protectedCoverRegistry.has(node) || tintCoverRegistry.has(node)
      || hasLayer(node, PNG_OCCLUDER_LAYER) || isProtectedCover(node)));
  }
  // Call only while the colour mask is locked off; restore with restoreVisibility().
  function hideColorOnlyHeldVfx(scene) {
    if (!colorOnlyDepthSkipEnabled || !scene) return null;
    colorOnlyScratch.length = 0;
    for (const root of collectVisible(heldRegistry, scene)) {
      if (!root.children?.length) continue;
      root.traverseVisible(node => {
        if (node !== root && isColorOnlyHeldVfx(node)) colorOnlyScratch.push(node);
      });
    }
    if (!colorOnlyScratch.length) return null;
    colorOnlyDepthSkips += colorOnlyScratch.length;
    const hidden = hideObjects(colorOnlyScratch);
    colorOnlyScratch.length = 0;
    return hidden;
  }

  // ── Gear particles: drawn once, after their own gear ─────────────────────
  // Particles riding on held gear (enchantment motes, weapon-layer fire) sit on
  // the world layer AND the held-overlay layer so the overlay draws them after
  // the gear it redraws. That drew each one in the base pass (where the gear
  // itself is suppressed, so the overlay then paints the gear over it: wasted)
  // and again in EVERY group's overlay render, whichever group held its gear:
  // 76 + 152 draws a frame for an enchanted dual flail on the user's GTX 1060.
  // Now each is hidden for the base pass and the whole replay, and shown only
  // for the overlay render of the group holding its gear: one draw, still on
  // top of its gear. Particles of gear the replay culled as off-screen keep the
  // old behaviour. A/B: HeldObjectRenderOrder.setGearParticlesOnceEnabled(false).
  // Since they no longer draw in the unclipped base pass, each group's replay
  // scissor and far depth include its particles (replayScissorRect,
  // replayFarViewDepth); particles inside a padded aura are already covered.
  // VFX parented outside the gear (the dungeon-fire plume) joins through
  // linkGearParticle(particle, ownerMesh). Particles of gear that does not
  // x-ray (replayOthers) are kept out of every overlay render: they draw once,
  // with their gear, in the base pass.
  let gearParticlesOnceEnabled = true;
  let gearParticleSkips = 0; // Lifetime particle draws avoided (snapshot()).
  let lastGearParticles = 0; // Particles managed in the last wrapped render.
  let activeGearParticles = null; // owner mesh -> its particles, during one wrapped render.
  let pendingGearParticleRestore = null; // Safety net: restored at the next render if a frame threw.
  const linkedGearParticles = new Map(); // particle -> owner gear mesh, for VFX parented outside its gear.
  function isGearParticle(node) {
    return !node.children?.length && hasLayer(node, HELD_OVERLAY_LAYER) && isColorOnlyHeldVfx(node);
  }
  // Pass owner null to unlink (the owner disposes it).
  function linkGearParticle(particle, owner) {
    if (!particle) return false;
    if (owner) linkedGearParticles.set(particle, owner);
    else linkedGearParticles.delete(particle);
    return !!owner;
  }
  function shownInScene(node) {
    for (let n = node; n; n = n.parent) { if (n.visible === false) return false; if (n.isScene) return true; }
    return false;
  }
  function collectGearParticles(owners) {
    const ownerSet = new Set(owners);
    const byOwner = new Map();
    const add = (owner, particle) => { let list = byOwner.get(owner); if (!list) byOwner.set(owner, list = []); list.push(particle); };
    for (const owner of owners) {
      if (!owner?.children?.length) continue;
      owner.traverseVisible(node => {
        if (node === owner || !isGearParticle(node)) return;
        let nearest = null;
        for (let parent = node.parent; parent; parent = parent.parent) if (ownerSet.has(parent)) { nearest = parent; break; }
        if (nearest !== owner) return; // Each particle belongs to its nearest held ancestor only.
        add(owner, node);
      });
    }
    for (const [particle, owner] of linkedGearParticles) if (ownerSet.has(owner) && shownInScene(particle)) add(owner, particle);
    return byOwner;
  }
  // Flat list of the particles riding on these (non-participant) gear meshes.
  function gearParticlesOf(owners) {
    const out = [];
    for (const list of collectGearParticles(owners).values()) out.push(...list);
    return out;
  }
  // An enchantment mote is inside its plane's live aura padding already: weapon-enchantment-vfx.js measures that
  // padding over exactly these motes. Any other particle (weapon-layer fire on the same weapon) needs its own bounds.
  function insidePaddedAura(node, gear) {
    if (node.parent?.userData?.weaponEnchantmentVfx !== true) return false;
    for (let n = node.parent; n; n = n.parent) {
      if (Number(n.userData?.hobunjiHeldOverlayVfxPadding) > 0) return true;
      if (n === gear) return false;
    }
    return false;
  }
  // Gear particles the base pass no longer draws: their extent must join the group's scissor and far depth.
  function needsParticleBounds(node, gear) {
    return gearParticlesOnceEnabled && isGearParticle(node) && !insidePaddedAura(node, gear);
  }
  // World centre and conservative radius of a billboard sprite (any rotation, any centre within its quad).
  function spriteWorldExtent(sprite, outCenter) {
    const e = sprite.matrixWorld.elements;
    outCenter.set(e[12], e[13], e[14]);
    return Math.hypot(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]));
  }
  // Hides every gear particle of these participants; returns the restore record or null.
  function beginGearParticles(owners) {
    if (pendingGearParticleRestore) { restoreVisibility(pendingGearParticleRestore); pendingGearParticleRestore = null; }
    activeGearParticles = null;
    lastGearParticles = 0;
    if (!gearParticlesOnceEnabled) return null;
    const byOwner = collectGearParticles(owners);
    if (!byOwner.size) return null;
    const all = [];
    for (const list of byOwner.values()) all.push(...list);
    activeGearParticles = byOwner;
    lastGearParticles = all.length;
    gearParticleSkips += all.length; // The base pass no longer draws them.
    pendingGearParticleRestore = hideObjects(all);
    return pendingGearParticleRestore;
  }
  // Gear the replay will not redraw (culled off-screen) keeps the old behaviour.
  function releaseUnreplayedGearParticles(replayed) {
    if (!activeGearParticles) return;
    for (const [owner, list] of activeGearParticles) {
      if (replayed.has(owner)) continue;
      for (const particle of list) particle.visible = pendingGearParticleRestore?.get(particle) ?? true;
      activeGearParticles.delete(owner);
    }
  }
  function showGroupGearParticles(meshes) {
    if (!activeGearParticles) return null;
    let shown = null;
    for (const mesh of meshes) {
      const list = activeGearParticles.get(mesh);
      if (!list) continue;
      for (const particle of list) { particle.visible = true; (shown || (shown = [])).push(particle); }
    }
    let managed = 0;
    for (const list of activeGearParticles.values()) managed += list.length;
    gearParticleSkips += managed - (shown ? shown.length : 0);
    return shown;
  }
  function endGearParticles(hidden) {
    if (hidden) restoreVisibility(hidden);
    if (hidden === pendingGearParticleRestore) pendingGearParticleRestore = null;
    activeGearParticles = null;
  }

  function replayFrustumIntersects(object, instanceSphere = undefined) {
    if (object.isSprite) return replayCullFrustum.intersectsSprite(object);
    // The union cull may have already obtained this instanced world sphere.
    const sphere = instanceSphere === undefined ? instancedReplaySphere(object) : instanceSphere;
    return sphere ? replayCullFrustum.intersectsSphere(sphere) : replayCullFrustum.intersectsObject(object);
  }

  function collectReplayCulled(scene, keep, groupCandidates = null, boundedKept = null, allowFarOnly = false, visibleSnapshot = null, ordinaryLeaves = null) {
    const culled = [];
    let kept = 0;
    // The shell replay needs a second list of its depth/outline participants.
    // Derive that list from the SAME live scene walk used by scissor culling,
    // retaining only meshes that will survive the temporary hideObjects step.
    const remember = visibleSnapshot || ordinaryLeaves ? (object) => {
      const isMesh = !!object?.isMesh;
      if (visibleSnapshot) {
        if (isMesh || (object?.isSprite && object.userData?.hobunjiNoOutline === true)) visibleSnapshot.depth.push(object);
        if (isMesh && hasLayer(object, SHELL_LAYER)) visibleSnapshot.shell.push(object);
      }
      if (ordinaryLeaves && (isMesh || object.isSprite || object.isLine || object.isPoints
          || object.isImmediateRenderObject || (!object.isObject3D && !object.isGroup && !object.isLight && object !== scene))) {
        ordinaryLeaves.push(object); // Only potential drawables; omit the many ordinary scene groups and lights.
      }
    } : null; // No candidate recording for elevation-only held replays.
    lastReplayInstancedCulled = 0; lastReplayInstancedKept = 0; lastReplayInertCount = 0;
    scene.traverseVisible((object) => {
      // Groups/lights still have their descendants visited by Three, but
      // cannot be culled or enter any drawable snapshot themselves.
      if (object.isObject3D && !object.isMesh && !object.isSprite && !object.isLine && !object.isPoints && !object.isImmediateRenderObject) return;
      if (keep.has(object) || hasAlternateReplayPose(object)) { if (remember) remember(object); return; }
      if (isDepthReplayInert(object, allowFarOnly)) { culled.push(object); lastReplayInertCount++; return; }
      const instanceSphere = instancedReplaySphere(object); // Reused for the intersection test below.
      const instanced = !!instanceSphere || hasAuthoredInstanceBounds(object);
      if (!instanced && !isReplayCullable(object)) { if (remember) remember(object); return; }
      if (instanceSphere) instancedReplaySphereReuses++;
      const inside = replayFrustumIntersects(object, instanceSphere);
      if (instanced) { if (inside) lastReplayInstancedKept++; else lastReplayInstancedCulled++; }
      if (inside) {
        if (remember) remember(object);
        kept++;
        groupCandidates?.push(object);
        boundedKept?.push(object);
      } else culled.push(object);
    });
    lastReplayCulledCount = culled.length;
    lastReplayKeptCount = kept;
    return culled;
  }

  function cullReplayGroup(camera, candidates) {
    if (!candidates.length || !setReplayCullFrustum(camera, elevationScissorRect, scissorTargetWidth, scissorTargetHeight)) return null;
    const hidden = new Map(); // Restored immediately after this group’s colorless depth draw.
    for (const object of candidates) {
      if (!object.visible || hasAlternateReplayPose(object)) continue;
      if (replayFrustumIntersects(object)) continue;
      hidden.set(object, true);
      object.visible = false;
    }
    return hidden;
  }

  function filterOffscreenReplayMeshes(camera, meshes) {
    if (!camera?.projectionMatrix || !camera?.matrixWorldInverse) return meshes;
    participantProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    participantFrustum.setFromProjectionMatrix(participantProjection);
    return meshes.filter(mesh => {
      // Only rigid leaf bounds are trustworthy. Keep animated/instanced meshes,
      // child-bearing weapon assemblies and VFX with extra shader/particle extent.
      if (hasAlternateReplayPose(mesh) || !mesh?.isMesh || !mesh.geometry || !mesh.matrixWorld || mesh.frustumCulled === false
          || mesh.isSkinnedMesh || mesh.isInstancedMesh || mesh.children?.length
          || mesh.geometry.morphAttributes?.position?.length
          || mesh.userData?.hobunjiReplayNeverCull === true
          || Number(mesh.userData?.hobunjiHeldOverlayVfxPadding) > 0
          || Number(mesh.userData?.hobunjiDungeonFireVfxPadding) > 0) return true;
      return participantFrustum.intersectsObject(mesh);
    });
  }

  function applyElevationScissor(renderer, camera, meshes, glState, paddingNdc = 0) {
    // An uncertain group always falls back to the proven union bounds; never clip unknown geometry.
    if (replayScissorRect(renderer, camera, meshes, elevationScissorRect, null, paddingNdc)
        && elevationScissorRect.z > 0 && elevationScissorRect.w > 0) {
      glState.scissor(elevationScissorRect);
      groupScissorCount++;
      return true;
    }
    glState.scissor(scissorRect);
    return false;
  }

  function replayScissorRect(renderer, camera, meshes, out, worldBox = null, paddingNdc = 0) {
    if (!camera?.isPerspectiveCamera && !camera?.isOrthographicCamera) {
      lastScissorFailureReason = 'unsupported-camera';
      return false;
    }
    const target = renderer.getRenderTarget?.() || null;
    let width, height;
    if (target) { width = target.width; height = target.height; }
    else { renderer.getDrawingBufferSize?.(scissorDrawingSize); width = scissorDrawingSize.x; height = scissorDrawingSize.y; }
    if (!(width > 0 && height > 0)) {
      lastScissorFailureReason = 'invalid-framebuffer';
      return false;
    }
    renderer.getCurrentViewport?.(scissorViewport);
    if (scissorViewport.x !== 0 || scissorViewport.y !== 0 || scissorViewport.z !== width || scissorViewport.w !== height) {
      lastScissorFailureReason = 'partial-viewport';
      return false;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let minWorldY = Infinity; // Lowest drawable bound, used to skip x-ray when the camera and gear are above the floor.
    const near = Number(camera.near) || 0;
    function includeBounds(mesh) {
      const geometry = mesh?.geometry; // Used to project one held mesh or one visible child with a live enchantment emitter.
      const skinned = !!mesh?.isSkinnedMesh && skinnedScissorEnabled; // Bounded per bone (forEachSkinnedBox).
      if (!geometry || (mesh.isSkinnedMesh && !skinned) || mesh.isInstancedMesh || geometry.morphAttributes?.position?.length) {
        lastScissorFailureReason = !geometry ? 'missing-geometry' : mesh.isSkinnedMesh && !skinned ? 'skinned-mesh' : mesh.isInstancedMesh ? 'instanced-mesh' : 'morphed-mesh';
        return false;
      }
      if (!skinned) {
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) return true;
      }
      const parity = mesh.__hobunjiXrayBoundParity;
      const capturedPose = parity && parity.hook === mesh.onBeforeRender && parity.isFresh?.()
        ? parity.visibleMatrixWorld : null; // May be the alternative matrix in the real parity draw.
      // A fixed one- or two-pass loop avoids allocating a closure or array for
      // each tool, NPC hand and foot during every projected x-ray bounds test.
      for (let poseIndex = 0; poseIndex < (capturedPose ? 2 : 1); poseIndex++) {
        const matrix = poseIndex === 0 ? mesh.matrixWorld : capturedPose;
        if (skinned) {
          const failure = forEachSkinnedBox(mesh, matrix, (box, skinMatrix) => includeLocalBox(mesh, box, skinMatrix));
          if (failure) { lastScissorFailureReason = failure; return false; }
        } else if (!includeLocalBox(mesh, geometry.boundingBox, matrix)) return false;
      }
      if (skinned) skinnedScissorBounds++;
      return true;
    }
    function includeLocalBox(mesh, localBox, matrix) {
      scissorBox.copy(localBox).applyMatrix4(matrix);
      const vfxPadding = Number(mesh.userData?.hobunjiHeldOverlayVfxPadding) || 0; // Preserve the original dynamic aura margin.
      if (vfxPadding > 0) scissorBox.expandByScalar(vfxPadding * matrix.getMaxScaleOnAxis());
      const garmentPadding = Number(mesh.userData?.hobunjiXrayDeformPadding) || 0; // CPU rest bounds miss GPU-skinned leg displacement; a conservative world-space margin prevents scissor clipping.
      if (garmentPadding > 0) scissorBox.expandByScalar(garmentPadding * matrix.getMaxScaleOnAxis());
      const dungeonRise = Number(mesh.userData?.hobunjiDungeonFireVfxPadding) || 0; // Preserve the fire plume's world-Y reach.
      if (dungeonRise > 0) {
        const lateral = .55;
        scissorBox.min.x -= lateral; scissorBox.max.x += lateral;
        scissorBox.min.z -= lateral; scissorBox.max.z += lateral;
        scissorBox.min.y -= lateral; scissorBox.max.y += dungeonRise;
      }
      return includeBox(scissorBox);
    }
    function includeParticleBounds(particle) {
      if (!particle.isSprite) return includeBounds(particle);
      const radius = spriteWorldExtent(particle, scissorCorner);
      if (!(radius >= 0 && radius < Infinity)) return false;
      scissorBox.min.set(scissorCorner.x - radius, scissorCorner.y - radius, scissorCorner.z - radius);
      scissorBox.max.set(scissorCorner.x + radius, scissorCorner.y + radius, scissorCorner.z + radius);
      return includeBox(scissorBox);
    }
    function includeBox({ min, max }) {
      minWorldY = Math.min(minWorldY, min.y);
      for (let corner = 0; corner < 8; corner++) {
        scissorCorner.set(corner & 1 ? max.x : min.x, corner & 2 ? max.y : min.y, corner & 4 ? max.z : min.z);
        scissorCorner.applyMatrix4(camera.matrixWorldInverse);
        if (camera.isPerspectiveCamera && scissorCorner.z > -near) {
          lastScissorFailureReason = 'near-plane-intersection';
          return false; // Never clip uncertain near-plane projections.
        }
        scissorCorner.applyMatrix4(camera.projectionMatrix);
        if (scissorCorner.x < minX) minX = scissorCorner.x;
        if (scissorCorner.x > maxX) maxX = scissorCorner.x;
        if (scissorCorner.y < minY) minY = scissorCorner.y;
        if (scissorCorner.y > maxY) maxY = scissorCorner.y;
      }
      return true;
    }
    if (worldBox && !includeBox(worldBox)) return false;
    for (const mesh of meshes) {
      if (!includeBounds(mesh)) return false;
      // Dual wield copies live under an invisible source blade. Its registry
      // entry defines the normal scissor, but its transformed child blades
      // (and their emitters) can be far outside that source rectangle. Only
      // project descendants with *live* aura padding; ordinary children add
      // no replay work and hidden offhand copies must not enlarge the pass.
      if (!mesh.children?.length || !mesh.traverseVisible) continue;
      let valid = true; // Used to conservatively disable scissoring if a child emitter has unreliable bounds.
      mesh.traverseVisible(child => {
        if (!valid || child === mesh) return;
        if (Number(child.userData?.hobunjiHeldOverlayVfxPadding) > 0 || Number(child.userData?.hobunjiDungeonFireVfxPadding) > 0) {
          if (!includeBounds(child)) valid = false;
        } else if (needsParticleBounds(child, mesh) && !includeParticleBounds(child)) valid = false; // Drawn only inside this scissor now.
      });
      if (!valid) {
        lastScissorFailureReason = 'unbounded-child-emitter';
        return false;
      }
    }
    lastScissorFailureReason = 'none';
    scissorMinimumWorldY = minWorldY;
    scissorTargetWidth = width;
    scissorTargetHeight = height;
    if (minX === Infinity) { out.set(0, 0, 0, 0); return true; } // Nothing drawable: no replay pixel can change.
    const xPadding = SCISSOR_MARGIN_PX + Math.ceil(paddingNdc * width * 0.5); // Includes the shell shader's screen-space vertex extrusion.
    const yPadding = SCISSOR_MARGIN_PX + Math.ceil(paddingNdc * height * 0.5);
    const x0 = Math.max(0, Math.floor((minX * 0.5 + 0.5) * width) - xPadding);
    const y0 = Math.max(0, Math.floor((minY * 0.5 + 0.5) * height) - yPadding);
    const x1 = Math.min(width, Math.ceil((maxX * 0.5 + 0.5) * width) + xPadding);
    const y1 = Math.min(height, Math.ceil((maxY * 0.5 + 0.5) * height) + yPadding);
    out.set(x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
    lastReplayScissorCoverage = (out.z * out.w) / (width * height);
    return true;
  }

  function restoreRendererScissor(renderer) {
    // setRenderTarget re-derives viewport/scissor/scissor-test for the current
    // target exactly as three.js itself would, undoing the clip above.
    renderer.setRenderTarget(renderer.getRenderTarget(), renderer.getActiveCubeFace?.() || 0, renderer.getActiveMipmapLevel?.() || 0);
  }

  const WATER_TINT_TILE_RADIUS = 3; // Permits long tools and adjacent banks while excluding remote waterways.
  const waterTintWorldBounds = new THREE.Box3(); // Reused for non-merged water/slush geometry without tile metadata.
  const waterActorTileNeighborhoods = new WeakMap(); // Cached 7×7 tile keys per actor root; updated only when its tile changes.

  function nearbyWaterTileKeys(scope) {
    const root = scope.root;
    const old = root && waterActorTileNeighborhoods.get(root);
    if (old && old.col === scope.col && old.row === scope.row) return old.keys;
    const keys = []; // Used only against wet-tile footprints, avoiding repeated string allocation per water mesh per frame.
    for (let row = scope.row - WATER_TINT_TILE_RADIUS; row <= scope.row + WATER_TINT_TILE_RADIUS; row++) {
      for (let col = scope.col - WATER_TINT_TILE_RADIUS; col <= scope.col + WATER_TINT_TILE_RADIUS; col++) {
        keys.push(col + ',' + row);
      }
    }
    if (root) waterActorTileNeighborhoods.set(root, { col: scope.col, row: scope.row, keys });
    return keys;
  }

  function tintCoverNearActor(cover, scopes) {
    const footprint = cover.userData?.hobunjiWaterTileFootprint;
    if (Array.isArray(footprint?.bounds)) {
      const [minCol, minRow, maxCol, maxRow] = footprint.bounds;
      for (const scope of scopes) {
        if (!Number.isFinite(scope.col) || !Number.isFinite(scope.row)) return true; // Unknown coordinates fail open to preserve real water coverage.
        if (scope.col + WATER_TINT_TILE_RADIUS + 1 < minCol
            || scope.col - WATER_TINT_TILE_RADIUS > maxCol
            || scope.row + WATER_TINT_TILE_RADIUS + 1 < minRow
            || scope.row - WATER_TINT_TILE_RADIUS > maxRow) continue;
        if (!footprint.tiles) return true; // A genuine map-wide flood occupies this entire rectangle.
        for (const key of nearbyWaterTileKeys(scope)) if (footprint.tiles.has(key)) return true;
      }
      return false;
    }
    // Scenery water and slush do not have per-tile footprints. Their world
    // bounds can safely exclude distant surfaces; uncertain meshes stay eligible.
    const geometry = cover.geometry;
    if (!geometry?.boundingBox) geometry?.computeBoundingBox?.();
    if (!geometry?.boundingBox || !cover.matrixWorld) return true;
    waterTintWorldBounds.copy(geometry.boundingBox).applyMatrix4(cover.matrixWorld);
    const { min, max } = waterTintWorldBounds;
    if (![min.x, min.z, max.x, max.z].every(Number.isFinite)) return true;
    for (const scope of scopes) {
      if (!Number.isFinite(scope.col) || !Number.isFinite(scope.row)) return true;
      if (max.x >= scope.col - WATER_TINT_TILE_RADIUS
          && min.x <= scope.col + WATER_TINT_TILE_RADIUS + 1
          && max.z >= scope.row - WATER_TINT_TILE_RADIUS
          && min.z <= scope.row + WATER_TINT_TILE_RADIUS + 1) return true;
    }
    return false;
  }


  const WATER_REPLAY_MAX_SCOPES = 12; // Six vec4 uniforms keep the additional water shader cost low on WebGL1 mobile.

  function beginWaterReplayClip(covers, scopes, hasUnknownOwner) {
    const states = new Map(); // Shared water uniforms restored in the outer replay finally block.
    lastWaterClipScopes = 0;
    lastWaterClipOverflow = 0;
    if (hasUnknownOwner || !covers.length) return states; // Unknown world positions must not erase legitimate submersion.
    const tiles = new Map(); // One clip tile per distinct wet actor, not one per hand, foot, or weapon.
    for (const scope of scopes) {
      if (!Number.isFinite(scope?.col) || !Number.isFinite(scope?.row)) continue;
      if (!covers.some(cover => tintCoverNearActor(cover, [scope]))) continue;
      const col = Math.floor(scope.col), row = Math.floor(scope.row); // The same owner tile used by ground-x-ray neighborhoods.
      tiles.set(col + ',' + row, { col, row });
    }
    if (!tiles.size) return states;
    if (tiles.size > WATER_REPLAY_MAX_SCOPES) {
      lastWaterClipOverflow = tiles.size; // Preserve all wet actors rather than truncate and erase their water tint.
      return states;
    }
    for (const cover of covers) {
      forEachMaterial(cover.material, material => {
        if (states.has(material)) return; // Merged rivers/floods often share one animated ShaderMaterial.
        const uniforms = material?.uniforms;
        const count = uniforms?.uHobunjiWaterReplayClipScopeCount;
        const radius = uniforms?.uHobunjiWaterReplayClipRadius;
        const packed = uniforms?.uHobunjiWaterReplayClipScopes;
        if (!count || !radius || !(packed?.value instanceof Float32Array) || packed.value.length < 24) return;
        states.set(material, { count: count.value, radius: radius.value, packed: packed.value.slice() });
        packed.value.fill(0);
        let i = 0;
        for (const tile of tiles.values()) {
          packed.value[i * 2] = tile.col;
          packed.value[i * 2 + 1] = tile.row;
          i++;
        }
        radius.value = WATER_TINT_TILE_RADIUS + 0.5;
        count.value = tiles.size;
      });
    }
    if (states.size) lastWaterClipScopes = tiles.size;
    return states;
  }

  function endWaterReplayClip(states) {
    for (const [material, previous] of states) {
      const uniforms = material.uniforms;
      uniforms.uHobunjiWaterReplayClipScopeCount.value = previous.count;
      uniforms.uHobunjiWaterReplayClipRadius.value = previous.radius;
      uniforms.uHobunjiWaterReplayClipScopes.value.set(previous.packed);
    }
  }

  const footTintScreenRect = new THREE.Vector4(); // Reused scratch: no per-frame allocation.
  function hasOverlappingHeldCover(renderer, camera, overlayMeshes, tintCovers) {
    if (!overlayMeshes.length || !tintCovers.length) return false;
    // The ordinary scene contains water far from the character even on dry
    // tiles. Do not pay for extra rendering passes when none of that
    // water/slush can overlap hands, held gear or feet. Match the existing
    // replay scissor's conservative projection, including near-plane fallback.
    if (!replayScissorRect(renderer, camera, overlayMeshes, footTintScreenRect)) return true;
    if (footTintScreenRect.z <= 0 || footTintScreenRect.w <= 0) return false;
    if (!setReplayCullFrustum(camera, footTintScreenRect, scissorTargetWidth, scissorTargetHeight)) return true;
    for (const cover of tintCovers) {
      // This frustum uses Three's regular bounding sphere. For instanced,
      // skinned, morphed or custom-frustum meshes keep the safe tint fallback.
      if (!cover.geometry || cover.isInstancedMesh || cover.isSkinnedMesh
        || cover.frustumCulled === false || cover.geometry.morphAttributes?.position?.length) return true;
      if (replayCullFrustum.intersectsObject(cover)) return true;
    }
    return false;
  }

  const XRAY_ELEVATION_TOLERANCE = 0.18; // Separates the authored trench/raised offsets and map tiers while allowing small body/terrain sampling drift.
  const XRAY_ELEVATION_GROUP_EPSILON = 0.05; // Actors on effectively the same standing surface share one depth replay.
  const XRAY_TILE_RADIUS = 1; // Shared tile reach: player-centered participant ring and holder-centered floor reveal.
  const XRAY_CIRCLE_RADIUS = XRAY_TILE_RADIUS + 0.5; // Same three-tile diameter, now centered continuously on world X/Z.
  const XRAY_MAX_BATCH_TILES = 8; // Fixed shader uniform budget for screen-separated holders.
  const xrayGearRect = new THREE.Vector4(); // Used to compare each holder's gear against projected tile boundaries.
  const xrayGroundRect = new THREE.Vector4(); // Holds the projected floor band used for conservative batching.
  const xrayGroundBox = new THREE.Box3(); // World-space floor bounds for a holder's 3×3 tile neighborhood.
  const XRAY_GROUND_NORMAL_MIN_Y = 0.55; // Vertical cliff/wall faces remain occluders even when their height crosses the actor's feet.

  function isDescendantOf(object, ancestor) {
    for (let node = object; node; node = node.parent) if (node === ancestor) return true;
    return false;
  }

  function worldYOf(object) {
    const matrixY = Number(object?.matrixWorld?.elements?.[13]);
    if (Number.isFinite(matrixY)) return matrixY;
    const localY = Number(object?.position?.y);
    return Number.isFinite(localY) ? localY : NaN;
  }

  function actorRootForXrayMesh(mesh, scene, ownerDepth = 0) {
    const composer = window.PlayerBodyTransformComposer;
    const playerMesh = composer?.getPlayerMesh?.();
    if (playerMesh && isDescendantOf(mesh, playerMesh)) return { root: playerMesh, isPlayer: true };
    // Some player hand/foot rigs are composer-owned external roots rather
    // than children of playerMesh. They still share the player's floor.
    const playerVisualRoots = composer?.getVisualRoots?.() || [];
    if (playerMesh && playerVisualRoots.some(root => root && isDescendantOf(mesh, root))) return { root: playerMesh, isPlayer: true };
    const playerLegHandle = composer?.getPlayerLegHandle?.();
    if (playerMesh && playerLegHandle && isDescendantOf(mesh, playerLegHandle.group || playerLegHandle)) return { root: playerMesh, isPlayer: true };
    let namedAnimalRoot = null;
    for (let node = mesh; node && node !== scene; node = node.parent) {
      const data = node.userData || {};
      if (data.hobunjiXrayActorRoot === true
          || data.hobunjiCharacterRigScaleRoot === true
          || String(node.name || '').startsWith('npc_walker_')
          || (heldOwnerLinkEnabled && node.name === 'bandit_avatar_group')) { // Gated with the owner link: today these parts are unowned.
        return { root: node, isPlayer: false };
      }
      // Scene-sibling weapons (BanditCombat/captain/cultural tool holders,
      // walker watchman and station tools) name their bearer explicitly; the
      // portrait mask already follows this link. Without it a hostile's weapon
      // had no owner, took the fail-safe path and forced an extra "ordinary"
      // held replay group (3 scene renders, ~350 draws in the user's fight).
      const owner = data.hobunjiHeldPortraitOwner; // Player gear always needs its ground scope, even with the NPC weapon budget disabled.
      if (playerMesh && owner === playerMesh) return { root: playerMesh, isPlayer: true };
      if (heldOwnerLinkEnabled && owner?.isObject3D && owner !== node && ownerDepth < 2) {
        return actorRootForXrayMesh(owner, scene, ownerDepth + 1) || { root: owner, isPlayer: false };
      }
      if (!namedAnimalRoot && data.namedAnimalNpc === true) namedAnimalRoot = node;
    }
    return namedAnimalRoot ? { root: namedAnimalRoot, isPlayer: false } : null;
  }

  // Who gets the ground x-ray. Every replay redraws nearby scenery once per
  // actor elevation group; in town every visible NPC's hands and feet joined
  // in and replays became 60-75% of all draw calls. The x-ray exists so the
  // floor does not swallow parts that sit at or below it:
  //   - weapons and other held items: every character (a swing can dip into
  //     the ground whatever the holder's height);
  //   - hands: the player and short species only (SHORT_XRAY_SPECIES; taller
  //     species never hold their hands that low);
  //   - feet: the player and short species. The local player ring is the
  //     distance authority; the legacy camera-distance test is used only
  //     when the local filter is unavailable or explicitly switched off.
  // Parts with no resolvable owner keep the old fail-safe x-ray. Everything
  // else draws with ordinary depth like the rest of its body.
  // HeldObjectRenderOrder.setReplayParticipants('all') restores the old set;
  // setShortXraySpecies([...]) and setFeetXrayDistance(units) tune the rule.
  let replayParticipantPolicy = 'rule';
  let localReplayRingEnabled = true; // Gameplay default: restrict extra actor draws to the player's tile and eight neighbors.
  let localReplayRingSkips = 0; // Lifetime base-pass counter; shell selection is not counted twice.

  function createLocalReplayFilter(scene) {
    if (!localReplayRingEnabled || replayParticipantPolicy === 'all') return null; // Explicit legacy A/B mode.
    const player = window.PlayerBodyTransformComposer?.getPlayerMesh?.();
    if (!player || !isDescendantOf(player, scene)) return null; // Editor/preview scenes have no active player.
    player.updateWorldMatrix?.(true, false);
    const p = player.matrixWorld?.elements;
    if (!Number.isFinite(p?.[12]) || !Number.isFinite(p?.[14])) return null;
    const col = Math.floor(p[12]), row = Math.floor(p[14]);
    const rootEligibility = new Map(); // One position check per actor, shared by parts in this partition.
    rootEligibility.set(player, true);
    return mesh => {
      const root = actorRootForXrayMesh(mesh, scene)?.root || mesh;
      if (rootEligibility.has(root)) return rootEligibility.get(root);
      root.updateWorldMatrix?.(true, false);
      const m = root.matrixWorld?.elements;
      const near = Number.isFinite(m?.[12]) && Number.isFinite(m?.[14])
        && Math.abs(Math.floor(m[12]) - col) <= XRAY_TILE_RADIUS && Math.abs(Math.floor(m[14]) - row) <= XRAY_TILE_RADIUS;
      rootEligibility.set(root, near);
      return near;
    };
  }
  const actorXrayDefaults = Object.freeze({ animals: true, enemies: false, player: true }); // Shared with Performance settings and reset.
  const actorXrayEnabled = { ...actorXrayDefaults }; // Settings gates shared by the main and shell passes.
  let hasDisabledActorXray = Object.values(actorXrayEnabled).includes(false); // All-on keeps the existing replay selection fast path.
  let allActorXrayDisabled = !Object.values(actorXrayEnabled).some(Boolean); // Master fast path shared by world, shell and participant selection.
  let actorXrayBypassFrames = 0, actorXrayWaterOnlyFrames = 0; // Mobile snapshot counts bypasses and independent water tint draws.
  const actorXrayRoots = new Map(); // Current frame's character roots, shared across color and shell selection.
  let actorXrayScene = null; // Scene whose actor roots the replay selector can reuse.

  function refreshActorXrayRoots(scene) {
    actorXrayRoots.clear();
    actorXrayScene = scene;
    const visuals = window.CharacterVisuals;
    const area = window.GridTileAccessors?.getCurrentArea?.();
    if (!visuals || area == null) return;
    const kinds = visuals.KINDS; // Use the same actor categories as the rest of character rendering.
    visuals.forEachCharacter(area, (kind, root, entity) => {
      let group = 'animals'; // Creature, companion, mount, shoulder pet, livestock or creature corpse.
      if (kind === kinds.PLAYER) group = 'player';
      else if (kind === kinds.ENEMY || (kind === kinds.CORPSE && entity?.isBandit)
          || (kind === kinds.NPC && root.userData?.namedAnimalNpc !== true
          && entity?.avatarGroup?.userData?.namedAnimalNpc !== true)) group = 'enemies';
      actorXrayRoots.set(root, group);
    });
  }

  function actorXrayGroup(mesh, scene, followOwner = true) {
    for (let node = mesh; node && node !== scene; node = node.parent) {
      const group = actorXrayRoots.get(node); // The nearest actor wins, including a pet attached to the player.
      if (group) return group;
      if (node.userData?.namedAnimalNpc === true) return 'animals';
      if (node.name === 'bandit_avatar_group' || node.name?.startsWith('npc_walker_')) return 'enemies';
      const owner = node.userData?.hobunjiHeldPortraitOwner; // Independent of the A/B weapon-budget owner link.
      if (followOwner && owner?.isObject3D && owner !== node) return actorXrayGroup(owner, scene, false);
    }
    return actorRootForXrayMesh(mesh, scene)?.isPlayer ? 'player' : null; // Includes composer-owned external tools and rig roots.
  }

  function setActorXrayEnabled(group, value) {
    if (!Object.hasOwn(actorXrayEnabled, group)) return null;
    const wasAllDisabled = allActorXrayDisabled;
    actorXrayEnabled[group] = value !== false;
    hasDisabledActorXray = Object.values(actorXrayEnabled).includes(false);
    allActorXrayDisabled = !Object.values(actorXrayEnabled).some(Boolean);
    if (wasAllDisabled && !allActorXrayDisabled) lastSceneScan = new WeakMap(); // Re-enable discovery before the next actor replay.
    if (!wasAllDisabled && allActorXrayDisabled) window.XrayHierarchy?.updateGroundZone?.(null, null, 0); // Remove a previously visible developer circle.
    actorXrayRoots.clear();
    actorXrayScene = null;
    if (group === 'animals') syncShoulderPetLayering();
    return actorXrayEnabled[group];
  }
  // Non-player weapon x-ray budget. An armed character whose gear can reach
  // the floor gets its own x-ray group whenever its screen rectangle overlaps
  // another holder's, and in a fight everyone crowds the player: in the user's
  // Cloud Forest save one bandit added 3 scene renders and ~350 draws (the
  // group's depth rebuild and colour overlay), the dominant cost of combat.
  // Only the otherWeaponXrayLimit armed non-player actors nearest the camera
  // keep weapon x-ray; the rest draw their weapon with ordinary depth, as
  // non-participant hands and feet already do. Player and short-species gear
  // are not limited. setOtherWeaponXrayLimit(Infinity) restores everyone.
  // Default 0 (with the owner link below): other characters' weapons draw in
  // the base pass with their bearer. On a GTX 1060 that measured ~11 ms a
  // frame faster near a camp (benchmark variant npcWeaponsBasePass); they
  // look slightly different (fogged by Cloud Forest mist like their bearer,
  // layered by plain depth against grass). Settings → Render optimizations →
  // "NPC and enemy weapons in the base pass" switches back (owner link off,
  // budget Infinity: the old fail-safe x-ray for every weapon).
  let otherWeaponXrayLimit = 0;
  // Scene-sibling weapons (BanditCombat / walker tool holders) name their
  // bearer in userData.hobunjiHeldPortraitOwner. Unresolved, each armed
  // hostile took the unowned fail-safe path and opened an extra held-replay
  // group; resolved under an unlimited budget it is far worse (6 bandits:
  // 2,216 -> 5,875 draws). Resolved with a budget of 0: -257 draws, -4 scene
  // renders vs the fail-safe path.
  let heldOwnerLinkEnabled = true;
  let otherWeaponXrayBudgetSkips = 0; // Weapon meshes left to ordinary depth by the budget (snapshot()).
  let lastOtherWeaponXrayActors = 0; // Armed non-player actors seen by the last held collection.
  const shortXraySpecies = new Set(['porakaneki']);
  let feetXrayDistance = 6; // Legacy A/B/preview-only distance from the camera.
  let replayCameraPosition = null; // Set by wrappedRender before it collects participants.
  let nonParticipantReplaySkips = 0; // Meshes left to ordinary depth by the policy (snapshot()).
  let participantCache = new WeakMap(); // mesh -> { at, parent, owner: 'player' | 'short' | 'other' | 'unknown' }
  const actorSpeciesCache = new WeakMap(); // actor root -> species id (or '')
  const PARTICIPANT_CACHE_MS = 250;
  function actorSpecies(root) {
    if (actorSpeciesCache.has(root)) return actorSpeciesCache.get(root);
    let species = root.userData?.speciesId || '';
    if (!species) {
      root.traverse?.(node => { if (!species && node.userData?.speciesId) species = node.userData.speciesId; });
    }
    species = String(species || '').toLowerCase();
    actorSpeciesCache.set(root, species);
    return species;
  }
  function participantOwner(mesh, scene) {
    const now = performance.now();
    const cached = participantCache.get(mesh);
    if (cached && cached.parent === mesh.parent && now - cached.at < PARTICIPANT_CACHE_MS) return cached.owner;
    const actor = actorRootForXrayMesh(mesh, scene);
    const owner = !actor ? 'unknown' : actor.isPlayer === true ? 'player' : shortXraySpecies.has(actorSpecies(actor.root)) ? 'short' : 'other';
    participantCache.set(mesh, { at: now, parent: mesh.parent, owner });
    return owner;
  }
  function withinFeetXrayDistance(mesh) {
    const cam = replayCameraPosition;
    const e = mesh.matrixWorld?.elements;
    if (!cam || !e) return true; // No camera context: keep the old behaviour.
    const dx = e[12] - cam.x, dy = e[13] - cam.y, dz = e[14] - cam.z;
    return dx * dx + dy * dy + dz * dz <= feetXrayDistance * feetXrayDistance;
  }
  function isReplayParticipant(mesh, scene, isFoot = false, useLegacyFeetDistance = true) {
    if (replayParticipantPolicy === 'all') return true;
    const isHand = mesh.userData?.hobunjiProceduralHand === true;
    if (!isFoot && !isHand) return true; // Weapons and other held items: every character.
    const owner = participantOwner(mesh, scene);
    if (owner === 'unknown') return true;
    if (owner === 'other') return false;
    return !isFoot || !useLegacyFeetDistance || withinFeetXrayDistance(mesh);
  }
  function splitReplayParticipants(meshes, scene, others, isFoot = false, repairHeld = false) {
    if (allActorXrayDisabled) {
      for (const mesh of meshes) { if (repairHeld) enforceHeldMesh(mesh); others.push(mesh); }
      nonParticipantReplaySkips += meshes.length;
      return []; // Even orphaned gear and legacy 'all' policy cannot override the master off state.
    }
    if (replayParticipantPolicy === 'all' && !hasDisabledActorXray) return meshes;
    const keep = []; // Parts left to the existing replay after applying the Settings gates.
    const nearPlayer = createLocalReplayFilter(scene); // Null in previews and explicit full-replay A/B mode.
    for (const mesh of meshes) {
      const group = hasDisabledActorXray ? actorXrayGroup(mesh, scene) : null; // Resolve categories only when needed.
      const eligible = actorXrayEnabled[group] !== false && isReplayParticipant(mesh, scene, isFoot, !nearPlayer); // Never stack the camera-distance test on the active player ring.
      const inRing = eligible && (!nearPlayer || nearPlayer(mesh));
      if (inRing) keep.push(mesh);
      else {
        if (repairHeld) enforceHeldMesh(mesh); // Keep the regular-pass held invariant without a second owner lookup.
        others.push(mesh);
        nonParticipantReplaySkips++;
        if (eligible && !inRing) localReplayRingSkips++;
      }
    }
    return repairHeld && !isFoot && replayParticipantPolicy !== 'all' ? limitOtherWeaponParticipants(keep, scene, others) : keep;
  }
  // Keeps weapon x-ray for the otherWeaponXrayLimit nearest armed non-player
  // actors (by root distance to the camera); preserves the original order,
  // which the screen-space group batching depends on.
  const budgetActors = new Map(); // root -> { d2, meshes }; reused every collect (twice a frame).
  const budgetRanked = [];
  const budgetDropped = new Set();
  function limitOtherWeaponParticipants(keep, scene, others) {
    const cam = replayCameraPosition;
    const actors = budgetActors;
    actors.clear();
    for (const mesh of keep) {
      if (mesh.userData?.hobunjiProceduralHand === true || participantOwner(mesh, scene) !== 'other') continue;
      const root = actorRootForXrayMesh(mesh, scene)?.root;
      if (!root) continue;
      let entry = actors.get(root);
      if (!entry) {
        const e = root.matrixWorld?.elements;
        const d2 = cam && e ? (e[12] - cam.x) ** 2 + (e[13] - cam.y) ** 2 + (e[14] - cam.z) ** 2 : 0;
        actors.set(root, entry = { d2, meshes: [] });
      }
      entry.meshes.push(mesh);
    }
    lastOtherWeaponXrayActors = actors.size;
    if (!(actors.size > otherWeaponXrayLimit)) { actors.clear(); return keep; }
    const dropped = budgetDropped;
    dropped.clear();
    budgetRanked.length = 0;
    for (const entry of actors.values()) budgetRanked.push(entry);
    budgetRanked.sort((a, b) => a.d2 - b.d2);
    for (let rank = otherWeaponXrayLimit; rank < budgetRanked.length; rank++) for (const mesh of budgetRanked[rank].meshes) dropped.add(mesh);
    budgetRanked.length = 0;
    actors.clear(); // Holds no actor roots between frames.
    const kept = [];
    for (const mesh of keep) {
      if (!dropped.has(mesh)) { kept.push(mesh); continue; }
      enforceHeldMesh(mesh); // Same ordinary-depth path as any non-participant held mesh.
      others.push(mesh);
      nonParticipantReplaySkips++;
      otherWeaponXrayBudgetSkips++;
    }
    dropped.clear();
    return kept;
  }

  function actorXrayScope(mesh, scene, cache) {
    const actor = actorRootForXrayMesh(mesh, scene);
    if (!actor?.root) return null; // Unknown ownership fails closed: ordinary ground remains in front of the object.
    const root = actor.root;
    if (cache.has(root)) return cache.get(root);
    let elevation = worldYOf(root);
    const matrix = root.matrixWorld?.elements; // The holder root is already in the game's one-world-unit-per-tile coordinates.
    const x = Number.isFinite(matrix?.[12]) ? matrix[12] : Number(root.position?.x); // Actual actor X for the circular ground reveal.
    const z = Number.isFinite(matrix?.[14]) ? matrix[14] : Number(root.position?.z); // Actual actor Z, not a snapped tile corner.
    const col = Math.floor(x);
    const row = Math.floor(z);
    if (actor.isPlayer) {
      const ruinFloor = window.DevRandomRuin?.getPlayerGroundSupportY?.(); // The active ruin owns physical footing, independent of rig animation and plasm sink.
      if (Number.isFinite(ruinFloor)) {
        const scope = { elevation: ruinFloor, col, row, x, z, root }; // Keep the floor height and tile tied to the same holder.
        cache.set(root, scope);
        return scope;
      }
      // Read the exact elevation channel already used by the player composer.
      // The wrapper runs before the visible draw applies its temporary body
      // transforms, so root.worldY plus this channel is the standing surface.
      const parentY = root.parent ? worldYOf(root.parent) : 0;
      const localY = Number(root.position?.y);
      if (Number.isFinite(parentY) && Number.isFinite(localY)) elevation = parentY + localY;
      const channels = window.PlayerBodyTransformComposer?.getDebug?.()?.channels || [];
      for (const channel of channels) {
        if (channel.enabled === false || channel.includePlayer === false || channel.name !== 'townSubtleElevation') continue;
        elevation += Number(channel.translation?.y) || 0;
      }
    }
    const scope = { elevation, col, row, x, z, root }; // Reused by every weapon or rig part owned by this root.
    cache.set(root, scope);
    return scope;
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.z && a.x + a.z > b.x && a.y < b.y + b.w && a.y + a.w > b.y;
  }

  function canBoundXrayMesh(mesh) {
    const parity = mesh.__hobunjiXrayBoundParity; // Only trusted rig adapters can bound a per-draw pose change.
    const unknownHook = mesh.onBeforeRender && mesh.onBeforeRender !== objectProto.onBeforeRender
      && parity?.hook !== mesh.onBeforeRender;
    const garmentPad = Number(mesh.userData?.hobunjiXrayDeformPadding); // Used only for the authored pants mesh's projection, never for generic GPU-deformed props.
    const boundedPants = mesh.userData?.hobunjiPantsGarment === true
      && mesh.userData?.hobunjiPantsGpuBoundsSafe === true && Number.isFinite(garmentPad) && garmentPad > 0
      && mesh.frustumCulled === false && !!mesh.geometry && !mesh.children?.length
      && !mesh.isSkinnedMesh && !mesh.isInstancedMesh && !mesh.geometry.morphAttributes?.position?.length;
    // GPU-skinned pants disable Three's ordinary frustum cull, but their rest geometry
    // plus the explicit deformation padding is usable for the *local x-ray replay* scissor.
    // CPU fallback meshes are never batched on stale rest bounds: the renderer invalidates
    // their live bounding box on each changed pose and the scissor recomputes it lazily.
    // Other uncullable/unknown-shader meshes remain conservative independent groups.
    if (!(isReplayCullable(mesh) || boundedPants) || unknownHook
        || mesh.userData?.hobunjiReplayNeverCull === true
        || Number(mesh.userData?.hobunjiHeldOverlayVfxPadding) > 0 || Number(mesh.userData?.hobunjiDungeonFireVfxPadding) > 0) return false;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; // Custom vertex deformation needs an isolated replay.
    return materials.every(material => !material?.isShaderMaterial && !material?.displacementMap);
  }

  function buildXrayGroups(renderer, scene, camera, meshes, shellPadding = null) {
    const actors = new Map(); // Resolve each actor's tile and standing floor only once per pass.
    const regions = []; // Parts on the same tile and standing floor use one projected neighborhood.
    const regionsByTile = new Map(); // Tile-indexed buckets; actors at different positions in one tile keep distinct circles.
    const ordinary = []; // Parts with no possible x-ray share a normal-depth path.
    let unknown = 0; // Diagnostics count unresolved holders separately from proven ordinary parts.
    let unboundedTintOwners = 0; // Unknown holders with no usable position retain conservative water tint.
    const fallbackTintScopes = []; // Unknown holder roots can still gate distant water by the visible part's world tile.
    const tintScopeByMesh = new Map(); // Maps each visible held/foot mesh to its owner before tint groups are partitioned.
    for (const mesh of meshes) {
      const scope = actorXrayScope(mesh, scene, actors);
      if (!scope || !Number.isFinite(scope.elevation) || !Number.isFinite(scope.col) || !Number.isFinite(scope.row)) {
        ordinary.push(mesh);
        unknown++;
        const matrix = mesh.matrixWorld?.elements; // The visible part supplies a fallback tint position, never an exemption from solid ground.
        const tintScope = Number.isFinite(matrix?.[12]) && Number.isFinite(matrix?.[14])
          ? { col: Math.floor(matrix[12]), row: Math.floor(matrix[14]), root: mesh }
          : null;
        if (tintScope) fallbackTintScopes.push(tintScope);
        else unboundedTintOwners++;
        tintScopeByMesh.set(mesh, tintScope);
        continue;
      }
      tintScopeByMesh.set(mesh, scope);
      const tileKey = scope.col + ',' + scope.row; // Exact grid tile identity; elevation still uses the existing epsilon comparison.
      let sameTile = regionsByTile.get(tileKey);
      if (!sameTile) {
        sameTile = [];
        regionsByTile.set(tileKey, sameTile);
      }
      const centerX = Number.isFinite(scope.x) ? scope.x : scope.col + 0.5; // Legacy scopes without world coordinates use the tile center.
      const centerZ = Number.isFinite(scope.z) ? scope.z : scope.row + 0.5;
      let region = sameTile.find(entry => Math.abs(entry.elevation - scope.elevation) <= XRAY_ELEVATION_GROUP_EPSILON
        && Math.abs(entry.x - centerX) <= 0.001 && Math.abs(entry.z - centerZ) <= 0.001);
      if (!region) {
        region = { ...scope, x: centerX, z: centerZ, meshes: [] };
        sameTile.push(region);
        regions.push(region); // Preserve first-seen order for existing safe screen-space batch grouping.
      }
      region.meshes.push(mesh);
    }

    const groups = []; // A batch may remove multiple neighborhoods only when they cannot reveal another holder's parts.
    const cameraY = camera.matrixWorld?.elements?.[13]; // The perspective eye must be above the floor for the height-only fast path.
    const band = XRAY_ELEVATION_TOLERANCE + XRAY_ELEVATION_GROUP_EPSILON; // Covers any representative elevation chosen for a shared batch.
    for (const region of regions) {
      const { elevation, x, z } = region;
      if (region.meshes.every(canBoundXrayMesh)
          && replayScissorRect(renderer, camera, region.meshes, xrayGearRect, null, shellPadding ?? 0)) {
        if (shellPadding === null && !region.meshes.some(mesh => mesh.userData?.hobunjiPantsGarment === true)
            && camera.isPerspectiveCamera && cameraY > elevation + band
            && scissorMinimumWorldY > elevation + band) {
          ordinary.push(...region.meshes);
          continue;
        }
        region.gearRect = { x: xrayGearRect.x, y: xrayGearRect.y, z: xrayGearRect.z, w: xrayGearRect.w };
        xrayGroundBox.min.set(x - XRAY_CIRCLE_RADIUS, elevation - band, z - XRAY_CIRCLE_RADIUS);
        xrayGroundBox.max.set(x + XRAY_CIRCLE_RADIUS, elevation + band, z + XRAY_CIRCLE_RADIUS);
        if (replayScissorRect(renderer, camera, [], xrayGroundRect, xrayGroundBox)) {
          if (!rectsOverlap(xrayGearRect, xrayGroundRect)) {
            ordinary.push(...region.meshes);
            continue;
          }
          region.groundRect = { x: xrayGroundRect.x, y: xrayGroundRect.y, z: xrayGroundRect.z, w: xrayGroundRect.w };
        }
      }
      let group = region.groundRect && groups.find(batch =>
        batch.regions.length < XRAY_MAX_BATCH_TILES
        && Math.abs(batch.elevation - elevation) <= XRAY_ELEVATION_GROUP_EPSILON
        && batch.regions.every(other => other.groundRect
          && !rectsOverlap(other.gearRect, region.groundRect) && !rectsOverlap(region.gearRect, other.groundRect)));
      if (!group) {
        group = { elevation, regions: [], meshes: [], centers: new Float32Array(XRAY_MAX_BATCH_TILES * 2) };
        groups.push(group);
      }
      const centerIndex = group.regions.length * 2; // Real world-XZ origins, within the original eight-region uniform budget.
      group.centers[centerIndex] = x;
      group.centers[centerIndex + 1] = z;
      group.regions.push(region);
      group.meshes.push(...region.meshes);
    }
    lastElevationReplayGroups = groups.length;
    lastUnknownElevationMeshes = unknown;
    lastXrayTileRegions = groups.reduce((count, group) => count + group.regions.length, 0);
    lastXrayOrdinaryMeshes = ordinary.length;
    return { groups, ordinary, scopes: [...actors.values(), ...fallbackTintScopes], hasUnknownOwner: unboundedTintOwners > 0, tintScopeByMesh };
  }

  const gearWaterBounds = new THREE.Box3(); // Reused for the actual haft, rope and head, including either hand's pose.
  function meshOverlapsWaterVolume(mesh, cover, unknown = true) {
    if (!mesh.matrixWorld?.elements) return unknown;
    const geometry = mesh.geometry;
    if (!geometry?.boundingBox) geometry?.computeBoundingBox?.();
    if (!geometry?.boundingBox) return unknown;
    gearWaterBounds.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
    const { min, max } = gearWaterBounds;
    if (![min.x, min.y, min.z, max.x, max.z].every(Number.isFinite)) return unknown;
    const footprint = cover.userData?.hobunjiWaterTileFootprint;
    if (!cover.geometry?.boundingBox) cover.geometry?.computeBoundingBox?.();
    if (cover.geometry?.boundingBox && cover.matrixWorld?.elements) {
      waterTintWorldBounds.copy(cover.geometry.boundingBox).applyMatrix4(cover.matrixWorld);
      const water = waterTintWorldBounds; // Compare in world space so raised water and raised weapons are handled consistently.
      if (min.y > water.max.y || min.x > water.max.x || max.x < water.min.x || min.z > water.max.z || max.z < water.min.z) return false;
    }
    if (!Array.isArray(footprint?.bounds)) return true;
    const [left, top, right, bottom] = footprint.bounds;
    if (max.x < left || min.x >= right || max.z < top || min.z >= bottom) return false;
    if (!footprint.tiles) return true; // The flood footprint is one solid rectangle.
    // Check the rendered height of the intersected water tiles. A tall waterfall
    // upstream must not make a weapon above the water here count as submerged.
    const matrix = cover.matrixWorld?.elements; // Merged tile metadata has world X/Z and mesh-local heights.
    const useTileHeight = matrix?.[1] === 0 && matrix[9] === 0 && matrix[5] > 0;
    for (let row = Math.max(top, Math.floor(min.z)); row < Math.min(bottom, Math.floor(max.z) + 1); row++) {
      for (let col = Math.max(left, Math.floor(min.x)); col < Math.min(right, Math.floor(max.x) + 1); col++) {
        const key = col + ',' + row; // Shared occupancy and rendered-height lookup for this water tile.
        if (!footprint.tiles.has(key)) continue;
        const localTop = footprint.tileMaxY?.get(key) ?? footprint.baselineMaxY;
        if (!useTileHeight || !Number.isFinite(localTop) || min.y <= localTop * matrix[5] + matrix[13]) return true;
      }
    }
    return false;
  }

  function isWaterBoundGear(mesh) {
    const flags = mesh?.userData; // Physical gear identity never depends on whether the front portrait masks it.
    return !!(flags?.hobunjiHeldObjectPlane === true || flags?.hobunjiWeaponAssemblyPart === true)
      && flags?.hobunjiProceduralHand !== true && flags?.hobunjiProceduralFoot !== true;
  }

  function gearOverlapsWaterVolume(mesh, cover) {
    return !isWaterBoundGear(mesh) || meshOverlapsWaterVolume(mesh, cover); // Hands/feet preserve their original submersion policy.
  }

  // A character portrait is a flat card wider than the actor, so its bounds overlap wet tiles whenever the
  // actor merely stands beside water. Tint a portrait only when the tile the actor stands on is itself wet.
  // Covers without a tile footprint (scenery water/slush) keep the bounds test alone.
  function actorStandsInWater(cover, scope) {
    const footprint = cover.userData?.hobunjiWaterTileFootprint;
    if (!Array.isArray(footprint?.bounds)) return true;
    const [left, top, right, bottom] = footprint.bounds;
    if (scope.col < left || scope.col >= right || scope.row < top || scope.row >= bottom) return false;
    return !footprint.tiles || footprint.tiles.has(scope.col + ',' + scope.row); // No tile set = map-wide flood rectangle.
  }

  function submergedPortraits(camera, covers, visiblePortraits, scene = null) {
    const tintRule = xrayRule('portrait.waterTint');
    if (tintRule === 'off') return { portraits: [], scopes: [], touchingCovers: new Set() };
    const portraits = []; // Visible portrait meshes with a physically overlapping water/slush surface.
    const scopes = []; // Elected portrait world tiles join gear owners in the clipped water draw.
    const touchingCovers = new Set();
    const nearPlayer = scene ? createLocalReplayFilter(scene) : null; // Distant actors keep ordinary water depth.
    const visible = filterOffscreenReplayMeshes(camera, nearPlayer ? visiblePortraits.filter(nearPlayer) : visiblePortraits);
    for (const portrait of visible) {
      const world = portrait.matrixWorld?.elements;
      if (!world) continue;
      const scope = { col: Math.floor(world[12]), row: Math.floor(world[14]) };
      let wet = false;
      for (const cover of covers) {
        if (!tintCoverNearActor(cover, [scope]) || (tintRule === 'wet-tile' && !actorStandsInWater(cover, scope)) || !meshOverlapsWaterVolume(portrait, cover, false)) continue;
        touchingCovers.add(cover);
        wet = true;
      }
      if (wet) { portraits.push(portrait); scopes.push(scope); }
    }
    return { portraits, scopes, touchingCovers };
  }

  function splitXrayGroupsForTint(groups, tintScopeByMesh, nearbyTintCovers) {
    // Stencil is shared across the viewport, so a wet NPC must not cause
    // dry player/companion parts to receive that NPC's water color. Partition
    // already-compatible groups by owner proximity and the actual gear bounds.
    // Each partition draws once; this also handles shared sprite materials
    // without relying on per-object stencil flags in one material transaction.
    const coversByScope = new Map(); // Each holder shares its candidate cover list across hands, hafts, ropes and flail heads.
    const wetMeshes = new Set(); // Used only to assign the existing depth groups to wet/dry stencil passes.
    for (const group of groups) {
      for (const mesh of group.meshes) {
        const scope = tintScopeByMesh.get(mesh);
        if (!coversByScope.has(scope)) {
          coversByScope.set(scope, scope ? nearbyTintCovers.filter(cover => tintCoverNearActor(cover, [scope])) : nearbyTintCovers);
        }
        const covers = coversByScope.get(scope);
        if (covers.some(cover => gearOverlapsWaterVolume(mesh, cover))) wetMeshes.add(mesh);
        else if (covers.length && isWaterBoundGear(mesh)) lastDryGearWaterSkips++;
      }
    }
    const split = [];
    for (const group of groups) {
      const wetCount = group.meshes.reduce((n, mesh) => n + (wetMeshes.has(mesh) ? 1 : 0), 0);
      if (wetCount === 0 || wetCount === group.meshes.length) {
        group.tintStencilRef = wetCount ? 1 : 0;
        split.push(group);
        continue;
      }
      const refs = new Map(); // Keep wet and dry parts in one depth batch when they own distinct materials.
      const materialRefs = new Map();
      let conflict = false;
      for (const mesh of group.meshes) {
        const ref = wetMeshes.has(mesh) ? 1 : 0;
        refs.set(mesh, ref);
        forEachMaterial(mesh.material, material => {
          if (materialRefs.has(material) && materialRefs.get(material) !== ref) conflict = true;
          materialRefs.set(material, ref);
        });
      }
      if (!conflict) {
        group.tintStencilRef = refs;
        split.push(group);
        continue;
      }
      // Incompatible owners on a single shared-material group need separate
      // renders to avoid one material's stencilRef leaking to another owner.
      const wet = { elevation: group.elevation, regions: [], meshes: [], centers: new Float32Array(XRAY_MAX_BATCH_TILES * 2), tintStencilRef: 1 };
      const dry = { elevation: group.elevation, regions: [], meshes: [], centers: new Float32Array(XRAY_MAX_BATCH_TILES * 2), tintStencilRef: 0 };
      if (group.regions.length) {
        for (const region of group.regions) {
          for (const [partition, selectedWet] of [[wet, true], [dry, false]]) {
            const matches = region.meshes.filter(mesh => wetMeshes.has(mesh) === selectedWet);
            if (!matches.length) continue;
            const at = partition.regions.length * 2;
            partition.centers[at] = region.x;
            partition.centers[at + 1] = region.z;
            partition.regions.push({ ...region, meshes: matches });
            partition.meshes.push(...matches);
          }
        }
      } else {
        for (const mesh of group.meshes) (wetMeshes.has(mesh) ? wet : dry).meshes.push(mesh);
      }
      if (wet.meshes.length) split.push(wet);
      if (dry.meshes.length) split.push(dry); // Dry visible pixels clear any prior wet actor stencil bit.
    }
    return split;
  }

  function installGroundElevationShader(material) {
    if (!material) return null;
    material.userData = material.userData || {};
    let state = material.userData.hobunjiXrayElevationShader;
    const inheritedCompile = material.onBeforeCompile; // Three's Material.clone keeps userData but drops custom shader callbacks; explicit callback copies can instead close over an older material's state.
    if (state && inheritedCompile?.__hobunjiXrayElevationState === state
        && inheritedCompile?.__hobunjiXrayMaterialOwner === material) return state; // Clones that shallow-copy BOTH metadata and callback must not share tile uniforms.
    state = { uniforms: { elevation: { value: 0 }, enabled: { value: 0 }, anyFacing: { value: 0 }, centerCount: { value: 0 }, centers: { value: new Float32Array(XRAY_MAX_BATCH_TILES * 2) } }, supported: false, compileAttempted: false, geometryHasNormals: null };
    material.userData.hobunjiXrayElevationShader = state;
    const previousCompile = typeof inheritedCompile === 'function'
      ? (Object.prototype.hasOwnProperty.call(inheritedCompile, '__hobunjiXrayBaseCompile') ? inheritedCompile.__hobunjiXrayBaseCompile : inheritedCompile)
      : null; // A clone must not run its source's elevation shader a second time (duplicate declarations and wrong uniforms).
    const inheritedCacheKey = material.customProgramCacheKey;
    const previousCacheKey = typeof inheritedCacheKey === 'function'
      ? (Object.prototype.hasOwnProperty.call(inheritedCacheKey, '__hobunjiXrayBaseCacheKey') ? inheritedCacheKey.__hobunjiXrayBaseCacheKey : inheritedCacheKey)
      : null;
    material.onBeforeCompile = function hobunjiElevationAwareGroundCompile(shader, renderer) {
      previousCompile?.call(this, shader, renderer);
      const vertex = shader.vertexShader || '';
      const fragment = shader.fragmentShader || '';
      const requiredVertex = ['#include <common>', '#include <worldpos_vertex>'];
      const requiredFragment = ['#include <common>', '#include <clipping_planes_fragment>'];
      state.compileAttempted = true;
      if (state.geometryHasNormals !== true // Unknown or missing normals fail closed; collectGroundElevationMaterials records them before the first compile.
          || !requiredVertex.every(chunk => vertex.includes(chunk)) || !requiredFragment.every(chunk => fragment.includes(chunk))) {
        state.supported = false; // Unsupported custom shaders / normal-less geometry keep conservative full-depth occlusion.
        return;
      }
      // The world normal is derived from the always-declared `normal`
      // attribute right here, after <worldpos_vertex> (which always runs).
      // It used to be injected after <defaultnormal_vertex>, but r128's
      // MeshBasicMaterial (all unlit terrain) only includes that chunk
      // inside #ifdef USE_ENVMAP, so the normal was never written and the
      // same-elevation ground was never actually discarded.
      const worldPositionCode = [
        '#include <worldpos_vertex>',
        'vec4 hobunjiXrayWorldPosition = vec4(transformed, 1.0);',
        'vec3 hobunjiXrayObjectNormal = normal;',
        '#ifdef USE_BATCHING',
        'hobunjiXrayWorldPosition = batchingMatrix * hobunjiXrayWorldPosition;',
        'hobunjiXrayObjectNormal = mat3(batchingMatrix) * hobunjiXrayObjectNormal;',
        '#endif',
        '#ifdef USE_INSTANCING',
        'hobunjiXrayWorldPosition = instanceMatrix * hobunjiXrayWorldPosition;',
        'hobunjiXrayObjectNormal = mat3(instanceMatrix) * hobunjiXrayObjectNormal;',
        '#endif',
        'hobunjiXrayWorldPosition = modelMatrix * hobunjiXrayWorldPosition;',
        'vHobunjiXrayWorldY = hobunjiXrayWorldPosition.y;',
        'vHobunjiXrayWorldXZ = hobunjiXrayWorldPosition.xz;',
        'vHobunjiXrayWorldNormal = normalize(mat3(modelMatrix) * hobunjiXrayObjectNormal);',
      ].join('\n');
      shader.vertexShader = vertex
        .replace('#include <common>', '#include <common>\nvarying float vHobunjiXrayWorldY;\nvarying vec2 vHobunjiXrayWorldXZ;\nvarying vec3 vHobunjiXrayWorldNormal;')
        .replace('#include <worldpos_vertex>', worldPositionCode);
      // Path bricks and interior slabs can expose their sides within the
      // actor's elevation band. Mixed terrain keeps cliff/wall faces solid.
      shader.fragmentShader = fragment
        .replace('#include <common>', `#include <common>\nuniform float uHobunjiXrayActorElevation;\nuniform float uHobunjiXrayElevationEnabled;\nuniform float uHobunjiXrayAnyFacing;\nuniform int uHobunjiXrayCenterCount;\nuniform vec2 uHobunjiXrayCenters[${XRAY_MAX_BATCH_TILES}];\nvarying float vHobunjiXrayWorldY;\nvarying vec2 vHobunjiXrayWorldXZ;\nvarying vec3 vHobunjiXrayWorldNormal;`)
        // enabled 0 = off, 1 = discard the holder's nearby floor (depth
        // rebuild), 2 = keep ONLY that floor (stencil punch of the floor
        // that is frontmost in the existing depth; see punchHeldGroupFloor).
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\nfloat hobunjiXrayNearFloor = 0.0;
if (uHobunjiXrayElevationEnabled > 0.5 && abs(vHobunjiXrayWorldY - uHobunjiXrayActorElevation) <= ${XRAY_ELEVATION_TOLERANCE} && (uHobunjiXrayAnyFacing > 0.5 || (gl_FrontFacing && vHobunjiXrayWorldNormal.y >= ${XRAY_GROUND_NORMAL_MIN_Y}))) {
  for (int i = 0; i < ${XRAY_MAX_BATCH_TILES}; ++i) {
    if (i >= uHobunjiXrayCenterCount) break;
    vec2 offsetFromActor = vHobunjiXrayWorldXZ - uHobunjiXrayCenters[i];
    if (dot(offsetFromActor, offsetFromActor) <= ${(XRAY_CIRCLE_RADIUS * XRAY_CIRCLE_RADIUS).toFixed(6)}) { hobunjiXrayNearFloor = 1.0; break; }
  }
}
if (uHobunjiXrayElevationEnabled > 1.5) { if (hobunjiXrayNearFloor < 0.5) discard; }
else if (hobunjiXrayNearFloor > 0.5) discard;`);
      shader.uniforms.uHobunjiXrayActorElevation = state.uniforms.elevation;
      shader.uniforms.uHobunjiXrayElevationEnabled = state.uniforms.enabled;
      shader.uniforms.uHobunjiXrayAnyFacing = state.uniforms.anyFacing;
      shader.uniforms.uHobunjiXrayCenterCount = state.uniforms.centerCount;
      shader.uniforms.uHobunjiXrayCenters = state.uniforms.centers;
      state.supported = true;
    };
    material.onBeforeCompile.__hobunjiXrayElevationState = state; // Used to detect stale copied userData after a terrain material clone.
    material.onBeforeCompile.__hobunjiXrayMaterialOwner = material; // The function belongs to this material even if another clone shares its metadata reference.
    material.onBeforeCompile.__hobunjiXrayBaseCompile = previousCompile; // A cloned material rebuilds its shader without nesting two elevation injections.
    // World-bake safe (zone-prop-render-batches.js) when what it wraps is: the injection reads world position and normal
    // through modelMatrix, which a world-space merged copy under an identity transform reproduces.
    material.onBeforeCompile.__hobunjiWorldBakeSafe = !previousCompile || previousCompile === globalThis.THREE?.Material?.prototype?.onBeforeCompile // Three's own no-op default.
      || previousCompile.__hobunjiWorldBakeSafe === true || material.userData.hobunjiWorldBakeSafe === true;
    material.customProgramCacheKey = function hobunjiElevationAwareGroundCacheKey() {
      return (previousCacheKey ? previousCacheKey.call(this) : '') + '|hobunji-ground-circle-xray-v6';
    };
    material.customProgramCacheKey.__hobunjiXrayBaseCacheKey = previousCacheKey; // Keeps prior renderer/Jigsaw program features on clones.
    material.needsUpdate = true;
    return state;
  }

  function isRoadXrayMesh(mesh) {
    const data = mesh.userData || (mesh.userData = {});
    if (data.hobunjiXrayRoadSurface === undefined) data.hobunjiXrayRoadSurface = isRoadSurface(mesh); // Cached: ancestry is fixed once a path brick group is built.
    return data.hobunjiXrayRoadSurface;
  }

  const groundElevationCache = new WeakMap(); // Each scene retains its latest visible ground material inputs.
  let groundMaterialCacheHits = 0, groundMaterialCacheBuilds = 0; // Performance Profiler counts across both replay paths.
  let lastGroundElevationMaterials = null; // Read current compile outcomes when diagnostics are requested.

  function collectGroundElevationMaterials(groundMeshes, scene) {
    let cached = scene && groundElevationCache.get(scene); // Reuse when both replays see the same ground inputs.
    if (!groundElevationInputsMatch(cached, groundMeshes)) {
      // Empty chunk-source parents share the chunks' materials but draw nothing.
      // An actually drawable mesh without normals still disables the filter for
      // its whole material, including any otherwise compatible meshes sharing it.
      const inputs = groundMeshes.map(mesh => ({
        // Store only the material inputs. Detached chunks can be released
        // even if this scene has no further x-ray replay to refresh the cache.
        material: Array.isArray(mesh.material) ? mesh.material.slice() : mesh.material,
        mode: groundElevationGeometryMode(mesh), road: isRoadXrayMesh(mesh),
      }));
      const materialUses = new Map(); // Aggregate normal availability and road rules once per material.
      for (const { material, mode, road } of inputs) {
        if (!mode) continue;
        forEachMaterial(material, entry => {
          if (!entry) return;
          const use = materialUses.get(entry);
          if (use) {
            use.hasNormals &&= mode === 2;
            use.road ||= road;
          } else materialUses.set(entry, { hasNormals: mode === 2, road, state: null });
        });
      }
      cached = { inputs, materialUses, materials: new Set(materialUses.keys()) };
      if (scene) groundElevationCache.set(scene, cached);
      groundMaterialCacheBuilds++;
    } else groundMaterialCacheHits++;

    for (const [material, use] of cached.materialUses) {
      let state = use.state;
      // Materials may be shared across scenes or get a new compile callback.
      // Reconcile the live owner and normal policy before enabling the filter.
      const compile = material.onBeforeCompile;
      if (!state || material.userData?.hobunjiXrayElevationShader !== state ||
          compile?.__hobunjiXrayElevationState !== state || compile.__hobunjiXrayMaterialOwner !== material) {
        state = use.state = installGroundElevationShader(material);
      }
      if (use.road || material.userData?.hobunjiInteriorFloorMaterial === true) state.uniforms.anyFacing.value = 1;
      if (state.geometryHasNormals !== use.hasNormals) {
        state.geometryHasNormals = use.hasNormals;
        material.needsUpdate = true;
      }
    }
    lastGroundElevationMaterials = cached.materials;
    return cached.materials;
  }

  function groundElevationGeometryMode(mesh) {
    const attributes = mesh.geometry?.attributes; // Track only geometry changes that can affect shader eligibility.
    if (!attributes?.position?.count) return 0;
    return attributes.normal && !mesh.isBatchedMesh ? 2 : 1;
  }

  function groundElevationInputsMatch(cached, groundMeshes) {
    if (!cached || cached.inputs.length !== groundMeshes.length) return false;
    for (let i = 0; i < groundMeshes.length; i++) {
      const mesh = groundMeshes[i], input = cached.inputs[i]; // Compare live material and geometry inputs at this slot.
      if (input.mode !== groundElevationGeometryMode(mesh) || input.road !== isRoadXrayMesh(mesh)) return false;
      const current = mesh.material, saved = input.material; // Array snapshots detect in-place material slot edits.
      if (current === saved) continue;
      if (!Array.isArray(saved) || !Array.isArray(current) || saved.length !== current.length) return false;
      for (let slot = 0; slot < saved.length; slot++) if (saved[slot] !== current[slot]) return false;
    }
    return true;
  }

  function groundElevationMaterialStats() {
    let supported = 0, fallback = 0; // Compiles can complete after the ground material cache was used.
    for (const material of lastGroundElevationMaterials || []) {
      const state = material.userData?.hobunjiXrayElevationShader;
      if (state?.supported) supported++;
      else if (state?.compileAttempted) fallback++;
    }
    return { supported, fallback };
  }

  function setGroundElevationFilter(materials, group, mode = 1) {
    for (const material of materials) {
      const { uniforms } = material.userData.hobunjiXrayElevationShader;
      uniforms.enabled.value = group ? mode : 0;
      if (!group || uniforms.centers.value === group.centers) continue;
      uniforms.elevation.value = group.elevation;
      uniforms.centerCount.value = group.regions.length;
      uniforms.centers.value = group.centers;
    }
  }

  // ── Floor punch: rebuild only the holder's circular ground patch ────────
  // An x-ray group used to clear depth inside its scissor and redraw every
  // occluder there with the holder's nearby floor filtered out. Only that floor
  // (XRAY_CIRCLE_RADIUS from the holder's world X/Z, at its standing elevation) is ever
  // exempt, so when the original depth can be copied back afterwards
  // (ScissorDepthSnapshot) the group now keeps the existing depth and:
  //   1. stencil-marks pixels where that nearby floor is the frontmost surface
  //      (ground layer only, each ground material's own program with its
  //      filter inverted, depth-test LEQUAL, no depth/colour writes),
  //   2. resets depth to far on the marked pixels with one quad (clearing the
  //      mark as it goes),
  //   3. redraws, filtered as before, only the objects that touch the patch
  //      column, for whatever sits behind that floor.
  // Everything outside the patch keeps the depth it already had. Without a
  // depth snapshot (WebGL1, outlines off) the original clear-and-redraw runs.
  // HeldObjectRenderOrder.setFloorPunchEnabled(false) is the A/B switch.
  const FLOOR_PUNCH_STENCIL_BIT = 0x02; // Bit 0 is water tint; the portrait owner IDs occupy bits 2–7.
  const FLOOR_PUNCH_PATCH_MARGIN = 1.5; // Extra world-space margin around the circle's bounds for oblique rays.
  let floorPunchEnabled = true;
  let floorPunchResources = null;
  let floorPunches = 0, floorPunchFallbacks = 0, floorPunchRefillHidden = 0, floorPunchRefillKept = 0, floorPunchDepthResets = 0;
  let floorPunchBox = null;

  function ensureFloorPunchResources() {
    if (floorPunchResources) return floorPunchResources;
    if (!THREE?.ShaderMaterial || !THREE.PlaneGeometry || !THREE.Scene || !THREE.OrthographicCamera) return null;
    const material = new THREE.ShaderMaterial({
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 1.0, 1.0); }', // Exactly the far plane.
      fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }',
      colorWrite: false, depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth,
      stencilWrite: true, stencilFunc: THREE.EqualStencilFunc, stencilRef: FLOOR_PUNCH_STENCIL_BIT,
      stencilFuncMask: FLOOR_PUNCH_STENCIL_BIT, stencilWriteMask: FLOOR_PUNCH_STENCIL_BIT,
      stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.ZeroStencilOp,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    const quadScene = new THREE.Scene();
    quadScene.add(quad);
    floorPunchResources = { quadScene, quadCamera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
    return floorPunchResources;
  }

  // Stencil punch + far-depth reset for one group. Returns false (and touches
  // nothing) when it cannot run, so the caller falls back to clear-and-redraw.
  function punchHeldGroupFloor(renderer, scene, camera, group, groundMeshes, groundMaterials, colorBuffer) {
    if (!floorPunchEnabled || lastBaseStencilBits < 2 || !group?.regions?.length || !groundMaterials?.size) return false;
    const resources = ensureFloorPunchResources();
    if (!resources || !colorBuffer?.setMask || !colorBuffer?.setLocked) return false;
    // A newly built floor can first compile its filter during the depth replay.
    // Rebuild the depth if a nearby floor cannot yet stamp the punch bit.
    const hidden = new Map(); // Ground outside the patch stays out of the stencil draw.
    for (const mesh of groundMeshes) {
      if (!mesh?.visible) continue;
      if (touchesFloorPatch(mesh, group, 0.05) === 0) {
        hidden.set(mesh, true);
        continue;
      }
      let filtered = true, pendingFilter = false; // Track whether this floor can stamp the punch bit.
      forEachMaterial(mesh.material, material => {
        const state = material.userData?.hobunjiXrayElevationShader;
        if (state && !state.compileAttempted) pendingFilter = true;
        if (!state?.supported) filtered = false;
      });
      if (pendingFilter) return false;
      if (!filtered) hidden.set(mesh, true);
    }
    if (!groundMeshes.some(mesh => mesh?.visible && !hidden.has(mesh))) return false;
    for (const mesh of hidden.keys()) mesh.visible = false;
    const saved = [];
    for (const material of groundMaterials) {
      if (!material?.userData?.hobunjiXrayElevationShader?.supported) continue;
      saved.push([material, material.colorWrite, material.depthWrite, material.depthTest, material.depthFunc, material.stencilWrite,
        material.stencilFunc, material.stencilRef, material.stencilFuncMask, material.stencilWriteMask, material.stencilFail, material.stencilZFail, material.stencilZPass]);
      material.colorWrite = false; material.depthWrite = false; material.depthTest = true; material.depthFunc = THREE.LessEqualDepth;
      material.stencilWrite = true; material.stencilFunc = THREE.AlwaysStencilFunc; material.stencilRef = FLOOR_PUNCH_STENCIL_BIT;
      material.stencilFuncMask = 0xff; material.stencilWriteMask = FLOOR_PUNCH_STENCIL_BIT;
      material.stencilFail = THREE.KeepStencilOp; material.stencilZFail = THREE.KeepStencilOp; material.stencilZPass = THREE.ReplaceStencilOp;
    }
    const oldMask = camera.layers.mask;
    setGroundElevationFilter(groundMaterials, group, 2);
    colorBuffer.setMask(false);
    colorBuffer.setLocked(true);
    try {
      camera.layers.mask = GROUND_REPLAY_MASK;
      rawRender.call(renderer, scene, camera);
      rawRender.call(renderer, resources.quadScene, resources.quadCamera);
      floorPunches++;
    } finally {
      colorBuffer.setLocked(false);
      colorBuffer.setMask(true);
      camera.layers.mask = oldMask;
      setGroundElevationFilter(groundMaterials, group, 1); // The local refill draws with the ordinary filter.
      for (const [material, colorWrite, depthWrite, depthTest, depthFunc, stencilWrite, stencilFunc, stencilRef, stencilFuncMask, stencilWriteMask, stencilFail, stencilZFail, stencilZPass] of saved) {
        Object.assign(material, { colorWrite, depthWrite, depthTest, depthFunc, stencilWrite, stencilFunc, stencilRef, stencilFuncMask, stencilWriteMask, stencilFail, stencilZFail, stencilZPass });
      }
      restoreVisibility(hidden);
    }
    return true;
  }

  // 1 = the object's world box touches a region's circular patch bounds +
  // margin, any height), 0 = it does not, -1 = unknown bounds.
  // With belowFloor set, an object must also reach below the group's floor
  // height: a punched pixel is one where that floor was the frontmost
  // surface, and with the camera above it anything farther along the same
  // ray lies under the floor plane.
  function touchesFloorPatch(object, group, margin, belowFloor = false) {
    if (!floorPunchBox) floorPunchBox = new THREE.Box3();
    let minX, maxX, minZ, maxZ, minY;
    const sphere = instancedReplaySphere(object);
    if (sphere) { minX = sphere.center.x - sphere.radius; maxX = sphere.center.x + sphere.radius; minZ = sphere.center.z - sphere.radius; maxZ = sphere.center.z + sphere.radius; minY = sphere.center.y - sphere.radius; }
    else {
      const geometry = object.geometry;
      if (geometry && !geometry.boundingBox && geometry.computeBoundingBox) geometry.computeBoundingBox();
      const box = geometry?.boundingBox;
      if (!box || !(box.min.x <= box.max.x)) return -1;
      floorPunchBox.copy(box).applyMatrix4(object.matrixWorld);
      minX = floorPunchBox.min.x; maxX = floorPunchBox.max.x; minZ = floorPunchBox.min.z; maxZ = floorPunchBox.max.z; minY = floorPunchBox.min.y;
    }
    if (!(minX <= maxX && minZ <= maxZ)) return -1; // NaN bounds.
    if (belowFloor && Number.isFinite(group.elevation) && minY > group.elevation + XRAY_ELEVATION_TOLERANCE) return 0; // Wholly above the floor.
    const R = XRAY_CIRCLE_RADIUS;
    for (const region of group.regions) {
      if (maxX >= region.x - R - margin && minX <= region.x + R + margin && maxZ >= region.z - R - margin && minZ <= region.z + R + margin) return 1;
    }
    return 0;
  }

  // Refill with anything that can sit between the punched floor and a held
  // part. The active shader skips the holder's own floor, while lower slabs
  // and the solid faces of mixed cave-shell meshes still write real depth.
  // Unbounded objects stay so uncertain bounds cannot expose hidden gear.
  function hideOutsideFloorPatch(candidates, group) {
    if (!candidates?.length || !group?.regions?.length) return null;
    let hidden = null;
    for (const object of candidates) {
      if (!object.visible) continue;
      const touches = touchesFloorPatch(object, group, FLOOR_PUNCH_PATCH_MARGIN, true);
      if (touches !== 0) { floorPunchRefillKept++; continue; }
      if (!hidden) hidden = new Map();
      hidden.set(object, true);
      object.visible = false;
    }
    if (hidden) floorPunchRefillHidden += hidden.size;
    return hidden;
  }

  // Ordinary parts need repaired cutout/cover depth, but opaque world depth is
  // already present from the base draw. Keep ancestor meshes conservatively:
  // hiding one would also hide a required descendant.
  let ordinaryDepthLeavesSkipped = 0; // Pixel Probe reports redundant leaves excluded from ordinary-depth supplements.
  let ordinaryDepthClearsAvoided = 0; // Counts groups that retain the base depth instead of reconstructing the world.
  let ordinaryDepthSceneWalksAvoided = 0, emptyOrdinaryDepthPassesAvoided = 0, emptyHeldReplayTransactionsAvoided = 0; // Lifetime diagnostics for conservative replay rejection.
  let lastForcedGroundDepthMaterials = 0; // Mobile diagnostic: temporary ground depth writers in the latest held replay.

  function forceGroundDepthForHeldReplay(materials, savedStates) {
    // Ground selected by either the elevation or ordinary held-replay path
    // may be drawn without depth writes in the world pass. The caller gives
    // only registered ground materials; any missing depth gets reconstructed.
    // When the elevation shader is unavailable, ordinary physical occlusion
    // is the conservative fallback (even within the circle).
    let forced = 0; // Count material overrides within this colorless replay only.
    for (const material of materials || []) {
      if (material?.depthWrite !== false) continue;
      saveMaterialState(savedStates, material); // Use the existing material transaction to restore base-render state.
      material.depthWrite = true; // Mode 1 drops the near floor when supported; otherwise use real physical depth.
      forced++;
    }
    return forced;
  }
  function hideOrdinaryDepthRedraws(scene, cutouts, covers, missingGround = [], visibleCandidates = null, cameraMask = MASK_ALL) {
    const required = new Set([...cutouts, ...covers, ...missingGround]); // Also keep ground which failed to write depth in the base world pass.
    const redundant = []; // Restored before source color and every elevation replay.
    // Do not skip an empty submission if a scene hook may create drawables or perform work.
    let hasDrawables = !!((scene.onBeforeRender && scene.onBeforeRender !== objectProto.onBeforeRender) ||
      (scene.onAfterRender && scene.onAfterRender !== objectProto.onAfterRender));
    const visit = object => {
      if ((object.isMesh || object.isSprite) && !object.children?.length && !required.has(object)
          && !(object.onBeforeRender && object.onBeforeRender !== objectProto.onBeforeRender)) {
        redundant.push(object);
        return;
      }
      // Layers filter draws, not descendants. Unknown renderable types or layer state fail closed.
      if (object.isMesh || object.isSprite || object.isLine || object.isPoints || object.isImmediateRenderObject) {
        if (!object.layers || (object.layers.mask & cameraMask)) hasDrawables = true;
      } else if (object !== scene && !object.isLight && !object.isGroup && !object.isObject3D) hasDrawables = true;
    };
    if (visibleCandidates) {
      ordinaryDepthSceneWalksAvoided++;
      for (const object of visibleCandidates) if (isStillVisibleForShellReplay(object, scene)) visit(object);
    } else scene.traverseVisible(visit);
    ordinaryDepthLeavesSkipped += redundant.length;
    return { hidden: hideObjects(redundant), hasDrawables };
  }

  // ── Near-only depth rebuilds ───────────────────────────────────────────
  // An x-ray group clears depth inside its scissor and redraws the scene so
  // its held parts can be tested against "everything except the floor they
  // stand on". Only occluders NEARER than those parts can change that test,
  // yet the rebuild (and the restore after it) resubmitted every mesh in the
  // rectangle, however far behind the actor: mesas, cliffs, buildings, trees.
  // When ScissorDepthSnapshot can copy the original depth out and back, the
  // rebuild keeps only objects that are not wholly beyond the group's farthest
  // held part, and the final restore is a depth blit plus a depth-only redraw
  // of the held parts themselves. Without snapshot support (WebGL1, drawing
  // straight to the canvas, a fake renderer) the original redraw path runs.
  let nearReplayEnabled = true; // Debug A/B switch: HeldObjectRenderOrder.setNearReplayEnabled(false).
  let nearReplaySnapshots = 0; // Depth rectangles saved instead of redrawn.
  let nearReplayFarCulled = 0; // Object submissions skipped because they sat wholly behind the held parts.
  let nearReplayFallbacks = 0; // Snapshot restores that failed and fell back to a full depth redraw.
  let lastNearReplayFarDepth = 0; // View-space depth of the last group's farthest held part (Infinity = unknown, no far cull).
  const NEAR_REPLAY_MARGIN = 1.5; // World units behind the farthest held part that still count as "near": shell extrusion, sway, pose slack.
  let nearScratchSphere = null, nearScratchPoint = null; // Created on first use.
  let nearReplayViewMatrix = null; // Lazy per-module matrix, used only when near-only replay culling sees boxed geometry.
  let nearReplayBoxTests = 0; // Counts eight-corner bounding-box depth checks replaced by the affine fast path.

  function nearReplaySupport(canLockColorMask) {
    return nearReplayEnabled && canLockColorMask && window.ScissorDepthSnapshot?.save ? window.ScissorDepthSnapshot : null;
  }

  // View-space depth of the farthest point of these held meshes, or Infinity
  // when any of them cannot be bounded (skinned, instanced, morphed).
  function replayFarViewDepth(camera, meshes) {
    if (!nearScratchSphere) { nearScratchSphere = new THREE.Sphere(); nearScratchPoint = new THREE.Vector3(); }
    let far = -Infinity, bounded = true;
    const include = (mesh) => {
      const geometry = mesh?.geometry;
      if (!geometry || mesh.isSkinnedMesh || mesh.isInstancedMesh || geometry.morphAttributes?.position?.length) { bounded = false; return; }
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      const source = geometry.boundingSphere;
      if (!source || !(source.radius >= 0)) return; // Empty geometry draws nothing.
      const parity = mesh.__hobunjiXrayBoundParity;
      const capturedPose = parity && parity.hook === mesh.onBeforeRender && parity.isFresh?.() ? parity.visibleMatrixWorld : null;
      const padding = (Number(mesh.userData?.hobunjiHeldOverlayVfxPadding) || 0) + (Number(mesh.userData?.hobunjiDungeonFireVfxPadding) || 0);
      for (let poseIndex = 0; poseIndex < (capturedPose ? 2 : 1); poseIndex++) {
        const matrix = poseIndex === 0 ? mesh.matrixWorld : capturedPose;
        nearScratchSphere.copy(source).applyMatrix4(matrix);
        nearScratchPoint.copy(nearScratchSphere.center).applyMatrix4(camera.matrixWorldInverse);
        const depth = -nearScratchPoint.z + nearScratchSphere.radius + (padding > 0 ? padding * Math.max(1, matrix.getMaxScaleOnAxis()) : 0);
        if (!(depth <= Infinity)) { bounded = false; return; } // NaN transform.
        if (depth > far) far = depth;
      }
    };
    for (const mesh of meshes) {
      include(mesh);
      if (!bounded) return Infinity;
      if (!mesh.children?.length || !mesh.traverseVisible) continue;
      mesh.traverseVisible(child => { // Same rule as the scissor: descendants with a live aura, and gear particles drawn only in the replay.
        if (!bounded || child === mesh) return;
        if (Number(child.userData?.hobunjiHeldOverlayVfxPadding) > 0 || Number(child.userData?.hobunjiDungeonFireVfxPadding) > 0) include(child);
        else if (needsParticleBounds(child, mesh)) {
          if (!child.isSprite) { include(child); return; }
          const radius = spriteWorldExtent(child, nearScratchPoint);
          nearScratchPoint.applyMatrix4(camera.matrixWorldInverse);
          const depth = -nearScratchPoint.z + radius;
          if (!(depth <= Infinity)) { bounded = false; return; }
          if (depth > far) far = depth;
        }
      });
      if (!bounded) return Infinity;
    }
    return far;
  }

  // Every visible object with trustworthy bounds, for an unscissored replay
  // (the scissored one gets the same list from collectReplayCulled).
  function collectBoundedReplayObjects(scene, keep, out) {
    scene.traverseVisible((object) => {
      if (keep.has(object) || hasAlternateReplayPose(object)) return;
      if (instancedReplaySphere(object) || hasAuthoredInstanceBounds(object) || isReplayCullable(object)) out.push(object);
    });
    return out;
  }

  // For an affine transform, the farthest view-space Z of an AABB is at one of
  // its eight corners. Choose that corner analytically without transforming all
  // eight, retaining the original conservative test for every rotation/scale.
  // Non-finite inputs produce NaN and are never culled by the caller.
  function nearestReplayBoxViewDepth(box, elements) {
    return -(elements[14]
      + Math.max(elements[2] * box.min.x, elements[2] * box.max.x)
      + Math.max(elements[6] * box.min.y, elements[6] * box.max.y)
      + Math.max(elements[10] * box.min.z, elements[10] * box.max.z));
  }

  // Hides candidates whose whole bound is farther from the camera than the
  // held parts. Returns the visibility map to restore, or null.
  function hideBeyondViewDepth(camera, candidates, farDepth) {
    lastNearReplayFarDepth = farDepth;
    if (!(farDepth < Infinity) || !candidates?.length) return null;
    const limit = farDepth + NEAR_REPLAY_MARGIN;
    let hidden = null;
    for (const object of candidates) {
      if (!object.visible || object.isSprite) continue;
      let nearest; // View-space depth of the bound's nearest point.
      let sphere = instancedReplaySphere(object);
      const geometry = sphere ? null : object.geometry;
      if (geometry && !geometry.boundingBox && geometry.computeBoundingBox) geometry.computeBoundingBox();
      const box = geometry?.boundingBox;
      if (box && box.min.x <= box.max.x) {
        // Box corners, not the sphere: a wide flat floor or snow chunk has a
        // sphere that reaches the camera long after its real surface is behind the parts.
        if (!nearReplayViewMatrix) nearReplayViewMatrix = new THREE.Matrix4();
        const view = nearReplayViewMatrix.multiplyMatrices(camera.matrixWorldInverse, object.matrixWorld).elements;
        nearest = nearestReplayBoxViewDepth(box, view);
        nearReplayBoxTests++;
      } else {
        if (!sphere) {
          const source = geometry?.boundingSphere;
          if (!source) continue; // Never bounded by the frustum test either: keep it.
          sphere = nearScratchSphere.copy(source).applyMatrix4(object.matrixWorld);
        }
        nearScratchPoint.copy(sphere.center).applyMatrix4(camera.matrixWorldInverse);
        nearest = -nearScratchPoint.z - sphere.radius;
      }
      if (!(nearest > limit)) continue; // Not wholly beyond the parts (also keeps NaN bounds).
      if (!hidden) hidden = new Map();
      hidden.set(object, true);
      object.visible = false;
    }
    if (hidden) nearReplayFarCulled += hidden.size;
    return hidden;
  }

  function replaySelectiveHeldOverlay(renderer, scene, camera, held, feet, ground, topFaceGround, tintCovers, originalCameraMask, bodyTint = null, portraitOrder = null) {
    lastForcedGroundDepthMaterials = 0; // Clear the mobile counter even when this pass has no active gear.
    // Each actor elevation gets its own depth replay. The filter omits nearby
    // same-level floor faces, including slab edges, and retains solid cover.
    if (!held.length && !feet.length && !bodyTint?.portraits.length) {
      lastFrontPortraitMaskCount = 0;
      lastFrontPortraitGearCandidates = 0;
      lastFrontPortraitMaskedGear = 0;
      lastFrontPortraitMaskReason = 'no-visible-participants';
      lastBaseElevationGroups = 0;
      lastHeldFullscreenReason = 'no-visible-participants';
      return;
    }

    const oldAutoClear = renderer.autoClear;
    const oldAutoClearColor = renderer.autoClearColor;
    const oldAutoClearDepth = renderer.autoClearDepth;
    const oldAutoClearStencil = renderer.autoClearStencil;
    const oldBackground = scene.background;
    const oldSceneAutoUpdate = scene.autoUpdate;
    const shadowMap = renderer.shadowMap;
    const oldShadowAutoUpdate = shadowMap?.autoUpdate;

    const glState = renderer.state;
    const stencilBuffer = glState?.buffers?.stencil; // Reset the write mask before clearing the held replay stencil.
    const overlayMeshes = [...held, ...feet];
    const overlayDrawOrder = rankedHeldOverlayOrder(portraitOrder, overlayMeshes, scene); // Preserve near/far actor stacking while editing equipment ranks.
    const scissorMeshes = bodyTint?.portraits.length ? [...overlayMeshes, ...bodyTint.portraits] : overlayMeshes; // Cover both gear and wet portraits in the final tint pass.
    const groundMeshes = [...ground, ...topFaceGround];
    // Gameplay PlayerJump is the physical movement owner: never infer airborne state from
    // visual hand/weapon transforms. Raised ordinary gear otherwise reuses the base depth
    // containing far-plane clouds and distant decorative tiles.
    const flight = window.PlayerJump?.debug;
    const airborne = !!flight?.active && (flight.phase === 'air' || flight.phase === 'rope')
      && Number(flight.heightAboveGround) > 0.05;
    const backgroundMeshes = overlayMeshes.length && xrayRule('background.gearDepth') === 'ignore'
      ? collectVisible(backgroundDepthRegistry, scene) : [];
    const rebuildAirborne = airborne && overlayMeshes.length > 0 && backgroundMeshes.length > 0 && xrayRule('airborne.rebuildDepth') !== 'off';
    if (rebuildAirborne) airborneDepthRebuilds++; // Diagnostic counter, includes no-op frames with no ordinary group.
    let { groups, ordinary, scopes, hasUnknownOwner, tintScopeByMesh } = buildXrayGroups(renderer, scene, camera, overlayMeshes);
    lastBaseElevationGroups = groups.length;
    const groundMaterials = groups.length ? collectGroundElevationMaterials(groundMeshes, scene) : null; // Reuse the same material list for every tile batch.
    if (ordinary.length) groups.unshift({ meshes: ordinary, regions: [] }); // Keep existing cutout and water depth rules for regular parts.
    // Screen-space overlap alone is insufficient: a long merged river can
    // project over the player's silhouette even when every wet tile is far away.
    // An unresolved owner falls back to the original conservative behavior.
    const nearbyTintCovers = !hasUnknownOwner && (scopes.length || bodyTint?.portraits.length)
      ? tintCovers.filter(cover => bodyTint?.touchingCovers.has(cover) || tintCoverNearActor(cover, scopes))
      : tintCovers;
    lastNearbyTintCovers = nearbyTintCovers.length;
    lastDistantTintCovers = tintCovers.length - nearbyTintCovers.length;
    const distantTintCovers = lastDistantTintCovers ? (() => {
      const nearby = new Set(nearbyTintCovers); // Membership check once per cover, not a nested linear search for every distant water mesh.
      return tintCovers.filter(cover => !nearby.has(cover));
    })() : []; // No allocation or hide transaction for dry scenes and all-nearby water.
    const tintOverlay = lastBaseStencilBits >= 1
      && hasOverlappingHeldCover(renderer, camera, scissorMeshes, nearbyTintCovers);
    if (tintOverlay) groups = splitXrayGroupsForTint(groups, tintScopeByMesh, nearbyTintCovers);
    if (!groups.length && !tintOverlay) { emptyHeldReplayTransactionsAvoided++; return; } // No gear color or intersecting water can change a pixel.
    const hasScissorApi = !!(glState?.scissor && glState?.setScissorTest); // Separates unavailable GL scissor support from unsafe geometry.
    let scissored = replayScissorEnabled && hasScissorApi && replayScissorRect(renderer, camera, scissorMeshes, scissorRect);
    lastHeldFullscreenReason = scissored ? 'none' : !replayScissorEnabled ? 'disabled'
      : !hasScissorApi ? 'scissor-api-unavailable' : lastScissorFailureReason;
    if (scissored && (scissorRect.z <= 0 || scissorRect.w <= 0)) { emptyHeldReplayTransactionsAvoided++; return; } // Valid empty union: no drawable pixel, stencil or depth change.
    const groupCullCandidates = groups.length > 1 ? [] : null; // Reuse the union cull traversal for tighter group depth draws.
    const ordinaryCandidates = groups.some(group => !group.regions.length) ? [] : null; // Filled only by a successful union cull.
    let ordinarySnapshot = null; // Same-frame visible snapshot, never retained across renders.
    let replayCulled = null;
    let suppressedOverlay = null; // A flail head or rope can draw independently of its held haft.
    let coversHidden = null;
    let distantTintHidden = null; // Far water is excluded before every depth rebuild, not only the last tint pass.
    let waterReplayClipStates = null; // Restores clipped water shader uniforms even after a failed render.
    const colorBuffer = renderer.state?.buffers?.color;
    const canLockColorMask = !!colorBuffer?.setMask && !!colorBuffer?.setLocked;
    const ordinaryGroundMeshes = ordinary.length ? groundMeshes.filter(mesh => {
      if (!mesh?.visible) return false;
      let missingDepth = false; // Registered ground leaves needed by the ordinary held depth supplement.
      forEachMaterial(mesh.material, material => { if (material?.depthWrite === false) missingDepth = true; });
      return missingDepth;
    }) : []; // No scan when all equipment already uses actual elevation-filtered groups.
    const ordinaryGroundMaterials = new Set(); // Reuse the ground material transaction without instantiating an elevation shader for ordinary tools.
    for (const mesh of ordinaryGroundMeshes) forEachMaterial(mesh.material, material => { if (material) ordinaryGroundMaterials.add(material); });
    const nearReplay = groups.some(group => group.regions.length) ? nearReplaySupport(canLockColorMask) : null; // Only depth-clearing x-ray groups benefit.
    const allowFarOnly = !!nearReplay; // Far-plane-only objects may leave only when replay depth comes back by copy (ScissorDepthSnapshot).
    const nearCandidates = nearReplay ? [] : null; // Bounded objects still visible after the scissor cull.
    let groundFilterActive = false; // Cleanup for a replay interrupted before its per-group restore.
    let nearToken = null; // Saved original depth of the replay rectangle, taken before the first clear.
    let nearSnapshotFailed = false;
    let baseDepthTouched = false; // A depth-modifying group already ran since the snapshot.
    let portraitGearIds = null; // Null without 8-bit stencil; otherwise maps held weapon art to its exact character owner.
    internalReplay = true;
    try {
      distantTintHidden = distantTintCovers.length ? hideObjects(distantTintCovers) : null;
      waterReplayClipStates = beginWaterReplayClip(nearbyTintCovers, bodyTint ? [...scopes, ...bodyTint.scopes] : scopes, hasUnknownOwner);
      if (scissored) {
        glState.scissor(scissorRect);
        glState.setScissorTest(true);
        scissoredReplayCount++;
        if (overlayMeshes.length && replayCullEnabled && setReplayCullFrustum(camera, scissorRect, scissorTargetWidth, scissorTargetHeight)) {
          const cullPerf = window.PerfProfiler?.begin('held-overlay: scissor cull');
          replayCulled = hideObjects(collectReplayCulled(scene, new Set(scissorMeshes), groupCullCandidates, nearCandidates, allowFarOnly, null, ordinaryCandidates));
          ordinarySnapshot = ordinaryCandidates;
          window.PerfProfiler?.end(cullPerf);
        } else if (nearCandidates) collectBoundedReplayObjects(scene, new Set(scissorMeshes), nearCandidates);
      } else {
        fullscreenReplayCount++;
        lastReplayScissorCoverage = 1;
        if (nearCandidates) collectBoundedReplayObjects(scene, new Set(scissorMeshes), nearCandidates);
      }
      renderer.autoClear = false;
      renderer.autoClearColor = false;
      renderer.autoClearDepth = false;
      renderer.autoClearStencil = false;
      scene.background = null;
      scene.autoUpdate = false;
      if (shadowMap) shadowMap.autoUpdate = false;

      // Keep ground in the depth replay. A compatible ground material discards
      // only fragments at this actor's actual standing elevation. Unknown actor
      // ownership and unsupported shaders deliberately retain full occlusion.
      suppressedOverlay = suppressDraws(overlayMeshes);
      coversHidden = tintOverlay ? hideObjects(nearbyTintCovers) : null;
      // Multiple actor-elevation groups use the same depth-occluder registries.
      // Resolve visible entries once after hiding overlay participants; their
      // visibility is restored between groups, but membership does not change.
      const cutoutDepthMeshes = groups.length && canLockColorMask ? collectVisible(pngDepthRegistry, scene) : null; // Reused by every grouped depth replay in this render.
      const protectedDepthMeshes = groups.length && canLockColorMask ? collectVisible(protectedCoverRegistry, scene) : null; // Same occluders, independent of actor elevation.
      // Stamp front silhouette against base world depth before clearing any
      // same-level ground. Transparent portrait pixels do not protect weapons.
      lastFrontPortraitGearCandidates = 0;
      for (const mesh of overlayMeshes) if (isPortraitMaskedGear(mesh)) lastFrontPortraitGearCandidates++;
      const portraitMask = lastFrontPortraitGearCandidates
        ? assignPortraitStencilOwners(overlayMeshes, collectVisible(frontPortraitRegistry, scene), scene)
        : null; // Match the owner even if only physical depth is available.
      lastFrontPortraitMaskCount = portraitMask?.portraits.length || 0;
      lastFrontPortraitMaskedGear = 0;
      lastFrontPortraitMaskReason = !lastFrontPortraitGearCandidates ? 'no-eligible-gear'
        : lastBaseStencilBits < 8 ? 'stencil-unavailable'
          : !portraitMask?.portraits.length ? 'no-owner-front-portrait' : 'mask-prepared';
      if (scissored) glState.setScissorTest(false);
      // WebGL clears only writable stencil bits. A previous tint draw can leave the mask at zero.
      stencilBuffer?.setMask?.(0xff);
      renderer.clearStencil?.(); // Clear the full stencil buffer before stamping this frame's masks.
      if (scissored) glState.setScissorTest(true);
      if (lastBaseStencilBits >= 8 && portraitMask?.portraits.length) ordinarySnapshot = null; // A draw hook in the stamp can change visibility; do not reuse pre-stamp candidates.
      if (lastBaseStencilBits >= 8 && portraitMask?.portraits.length
        && stampFrontPortraitStencil(renderer, scene, camera, portraitMask.portraits, portraitMask.ownerIds, portraitOrder)) {
        portraitGearIds = portraitMask.gearIds;
        lastFrontPortraitMaskedGear = portraitGearIds.size; // A rank change is effective only if an owner stencil was stamped.
        lastFrontPortraitMaskReason = portraitGearIds.size === lastFrontPortraitGearCandidates ? 'stamped' : 'partially-stamped';
      }

      for (const group of groups) {
        const groupScissored = scissored && applyElevationScissor(renderer, camera, group.meshes, glState);
        if (group.regions.length) {
          groundFilterActive = true;
          setGroundElevationFilter(groundMaterials, group);
        }
        const supplementDepth = !group.regions.length && canLockColorMask && !rebuildAirborne; // Airborne gear must not reuse base sky/backdrop depth.
        let punched = false; // Floor punch kept the existing depth (see punchHeldGroupFloor).
        if (supplementDepth) ordinaryDepthClearsAvoided++;
        else {
          // Taken after any ordinary supplement, so its repaired cutout/cover depth is part of what comes back.
          if (nearReplay && !nearToken && !nearSnapshotFailed) {
            nearToken = nearReplay.save(renderer, scissored ? scissorRect : null);
            if (nearToken) nearReplaySnapshots++; else nearSnapshotFailed = true;
          }
          if (nearToken && group.regions.length && canLockColorMask && floorPunchEnabled) {
            // A previous group left its own punch/refill/held depth behind: start again from the original.
            const pristine = !baseDepthTouched || (nearReplay.restore(renderer, nearToken, scissored ? scissorRect : null) && ++floorPunchDepthResets);
            punched = !!pristine && punchHeldGroupFloor(renderer, scene, camera, group, groundMeshes, groundMaterials, colorBuffer);
            if (!punched) floorPunchFallbacks++;
          }
          if (!punched) renderer.clearDepth();
          baseDepthTouched = true;
        }
        const prepPerf = window.PerfProfiler?.begin('held-overlay: depth material prep');
        const depthMaterialStates = canLockColorMask
          ? prepareCutoutDepthMaterials(cutoutDepthMeshes, protectedDepthMeshes)
          : prepareNonGroundDepthMaterials(scene);
        if (group.regions.length) lastForcedGroundDepthMaterials += forceGroundDepthForHeldReplay(groundMaterials, depthMaterialStates);
        else if (ordinaryGroundMaterials.size) lastForcedGroundDepthMaterials += forceGroundDepthForHeldReplay(ordinaryGroundMaterials, depthMaterialStates);
        // The ordinary supplement previously skipped ALL terrain: ground with depthWrite:false could never block gear outside the circle.
        if (canLockColorMask) {
          colorBuffer.setMask(false);
          colorBuffer.setLocked(true);
        }
        window.PerfProfiler?.end(prepPerf);
        let groupCulled = null; // Only depth needs the bounded world occluder list.
        let farCulled = null; // Objects wholly behind this group's held parts; the saved depth brings them back.
        let patchCulled = null; // After a floor punch, only objects touching the holder's patch are redrawn.
        let npcReplayRestore = null; // Remove off-scissor uncullable NPC rigs only during this depth submission.
        const redundantDepth = supplementDepth ? hideOrdinaryDepthRedraws(scene, cutoutDepthMeshes, protectedDepthMeshes, ordinaryGroundMeshes, ordinarySnapshot, originalCameraMask) : null; // Retain only depth-relevant sprites, cover, and missing-ground leaves.
        ordinarySnapshot = null; // Never carry the snapshot across another native draw or its callbacks.
        let backgroundHidden = null; // Only the colorless depth submission drops the visual horizon; the world and final depth restore retain it.
        let colorOnlyHidden = null; // Held-gear VFX with no depth/stencil writes: no-ops while the colour mask is locked.
        try {
          if (groupScissored && groupCullCandidates) groupCulled = cullReplayGroup(camera, groupCullCandidates);
          if (nearToken && !supplementDepth) farCulled = hideBeyondViewDepth(camera, nearCandidates, replayFarViewDepth(camera, group.meshes));
          if (punched) patchCulled = hideOutsideFloorPatch(nearCandidates, group);
          if (groupScissored) npcReplayRestore = window.NpcViewFrustumCull?.suspendOutsideReplayRect?.(
            scene, camera, elevationScissorRect, scissorTargetWidth, scissorTargetHeight, group.meshes);
          backgroundHidden = backgroundMeshes.length && !supplementDepth ? hideObjects(backgroundMeshes) : null;
          if (backgroundHidden) backgroundDepthMeshesExcluded += backgroundHidden.size;
          camera.layers.mask = originalCameraMask;
          if (canLockColorMask) colorOnlyHidden = hideColorOnlyHeldVfx(scene);
          const depthRebuildPerf = window.PerfProfiler?.begin('held-overlay: elevation depth rebuild');
          if (!redundantDepth || redundantDepth.hasDrawables || shadowMap?.needsUpdate === true) {
            rawRender.call(renderer, scene, camera);
            nonGroundDepthReplayCount++;
          } else emptyOrdinaryDepthPassesAvoided++;
          window.PerfProfiler?.end(depthRebuildPerf);
        } finally {
          if (colorOnlyHidden) restoreVisibility(colorOnlyHidden);
          npcReplayRestore?.(); // Restore NPC appearance before the held/stencil color draw.
          if (backgroundHidden) restoreVisibility(backgroundHidden);
          if (patchCulled) restoreVisibility(patchCulled);
          if (redundantDepth) restoreVisibility(redundantDepth.hidden);
          if (farCulled) restoreVisibility(farCulled);
          if (groupCulled) restoreVisibility(groupCulled);
          if (canLockColorMask) {
            colorBuffer.setLocked(false);
            colorBuffer.setMask(true);
          }
          restoreMaterialStates(depthMaterialStates);
          if (groundFilterActive) {
            setGroundElevationFilter(groundMaterials, null);
            groundFilterActive = false;
          }
        }

        // This depth must be reintroduced after every clearDepth()/rebuild,
        // not just once during the original base portrait draw.
        if (!portraitGearIds && portraitMask?.portraits.length
          && stampFrontPortraitDepthFallback(renderer, scene, camera, portraitMask.portraits, portraitMask.ownerIds, portraitOrder)) {
          lastFrontPortraitMaskedGear = portraitMask.gearIds.size;
          lastFrontPortraitMaskReason = 'depth-fallback-no-stencil';
        }
        for (const mesh of group.meshes) mesh.layers.mask = HELD_OVERLAY_MASK;
        // Keep this group's scissor for the held color/stencil draw. Drawing outside
        // the group's reconstructed depth rectangle can reveal weapons through
        // unrelated foreground terrain and stamp invalid water-tint stencil bits.
        const overlayStates = tintOverlay
          ? prepareSubmergedOverlayStencilMaterials(group.meshes, group.tintStencilRef, portraitGearIds)
          : portraitGearIds ? preparePortraitGearStencilMaterials(group.meshes, portraitGearIds) : null;
        const ownParticles = showGroupGearParticles(group.meshes); // Only this group's gear particles, once, after their gear.
        try {
          camera.layers.mask = HELD_OVERLAY_MASK;
          const overlayPerf = window.PerfProfiler?.begin('held-overlay: elevation overlay render');
          withPortraitDrawOrder(renderer, overlayDrawOrder, () => rawRender.call(renderer, scene, camera)); // Preserve actor-to-actor depth, then apply editable intra-actor gear ranks.
          window.PerfProfiler?.end(overlayPerf);
          selectiveOverlayCount++;
        } finally {
          if (ownParticles) for (const particle of ownParticles) particle.visible = false;
          if (overlayStates) restoreMaterialStates(overlayStates);
          for (const mesh of group.meshes) mesh.layers.mask = 0;
        }
      }

      // The final ground and translucent-cover restores must cover every group's
      // original union, not only the final actor's smaller replay rectangle.
      if (scissored) {
        glState.scissor(scissorRect);
        lastReplayScissorCoverage = (scissorRect.z * scissorRect.w) / (scissorTargetWidth * scissorTargetHeight);
      }
      // Restore the original complete ground depth before water/slush tinting.
      restoreDraws(suppressedOverlay);
      suppressedOverlay = null;
      if (coversHidden) { restoreVisibility(coversHidden); coversHidden = null; }
      // Near-only rebuilds left depth behind the held parts empty. Copy the
      // original back, then re-add the parts' own depth exactly as their
      // materials write it: where a part is in front of the original scene it
      // wins, where the floor it x-rayed through is nearer the floor wins.
      let depthRestored = false;
      if (nearToken) {
        depthRestored = nearReplay.restore(renderer, nearToken, scissored ? scissorRect : null);
        if (!depthRestored) { // Target changed under us: rebuild complete depth the original way.
          nearReplayFallbacks++;
          renderer.clearDepth();
          const withoutGear = suppressDraws(overlayMeshes);
          const fullStates = prepareNonGroundDepthMaterials(scene);
          try { camera.layers.mask = originalCameraMask; rawRender.call(renderer, scene, camera); }
          finally { restoreMaterialStates(fullStates); restoreDraws(withoutGear); }
        }
      }
      // Recover gear depth lost by restoring the base snapshot (or by clearing
      // depth for a later elevation group). Only visible weapon pixels can
      // replace the portrait depth, and soft rope sprites must write depth here.
      if (canLockColorMask && (nearToken || (tintOverlay && baseDepthTouched && groups.length > 1))) {
        // Depth restored from a snapshot has no guarantee of containing held
        // PNGs: many normal color materials intentionally set depthWrite:false.
        // Force depth writes for ALL held sources while keeping their owner
        // portrait test, not just when a water-tint pass happens to be active.
        const gearDepthStates = prepareSubmergedOverlayStencilMaterials(overlayMeshes, 0, portraitGearIds, true);
        colorBuffer.setMask(false);
        colorBuffer.setLocked(true);
        let gearColorOnly = null; // Read after the forced-depth transaction above.
        try {
          camera.layers.mask = HELD_OVERLAY_MASK;
          gearColorOnly = hideColorOnlyHeldVfx(scene);
          rawRender.call(renderer, scene, camera);
        } finally {
          if (gearColorOnly) restoreVisibility(gearColorOnly);
          colorBuffer.setLocked(false);
          colorBuffer.setMask(true);
          if (gearDepthStates) restoreMaterialStates(gearDepthStates);
        }
      }
      // No scissor-depth snapshot on WebGL1 or a lost render target: the airborne
      // ordinary group cleared the base buffer to eliminate sky/cloud silhouettes.
      // Restore the actual scene depth before water tint and later postprocessing,
      // then re-add held pixels with the same owner-specific portrait stencil.
      if (rebuildAirborne && !depthRestored && !nearToken) {
        const originalDepthSources = suppressDraws(overlayMeshes); // The original scene depth is world-only.
        const restoreStates = prepareNonGroundDepthMaterials(scene); // Alpha-tested characters and protected covers write depth.
        const waterHidden = tintOverlay ? hideObjects(nearbyTintCovers) : null; // Translucent water was not a base depth writer.
        if (canLockColorMask) { colorBuffer.setMask(false); colorBuffer.setLocked(true); }
        try {
          camera.layers.mask = originalCameraMask;
          renderer.clearDepth();
          rawRender.call(renderer, scene, camera);
        } finally {
          if (canLockColorMask) { colorBuffer.setLocked(false); colorBuffer.setMask(true); }
          if (waterHidden) restoreVisibility(waterHidden);
          restoreMaterialStates(restoreStates);
          restoreDraws(originalDepthSources);
        }
        const raisedGearStates = prepareSubmergedOverlayStencilMaterials(overlayMeshes, 0, portraitGearIds, true);
        for (const material of raisedGearStates.keys()) material.colorWrite = false; // Depth only; original gear color is already present.
        try {
          camera.layers.mask = HELD_OVERLAY_MASK;
          rawRender.call(renderer, scene, camera);
        } finally {
          restoreMaterialStates(raisedGearStates);
        }
        depthRestored = true; // Skip the redundant floor-only restoration after a complete world rebuild.
      }
      const needsGroundRestore = groups.length > 0 && !depthRestored && (groups.some(group => group.regions.length) || !canLockColorMask); // An ordinary supplement never removes existing floor depth.
      const groundMaterialStates = needsGroundRestore ? prepareGroundDepthMaterials(topFaceGround.length ? groundMeshes : ground) : new Map();
      try {
        camera.layers.mask = GROUND_REPLAY_MASK;
        if (needsGroundRestore) {
          const groundRestorePerf = window.PerfProfiler?.begin('held-overlay: ground restore render');
          rawRender.call(renderer, scene, camera);
          window.PerfProfiler?.end(groundRestorePerf);
          groundDepthRestoreCount++;
        }
      } finally {
        restoreMaterialStates(groundMaterialStates);
      }

      if (tintOverlay) {
        if (bodyTint?.portraits.length) stampSubmergedPortraits(renderer, scene, camera, bodyTint.portraits);
        // Distant meshes remain hidden from ALL replay stages, and the merged
        // shader rejects distant fragments of any nearby mesh as well.
        const tintStates = prepareOverlayCoverTintMaterials(nearbyTintCovers);
        try {
          camera.layers.mask = WATER_REPLAY_MASK;
          const tintPerf = window.PerfProfiler?.begin('held-overlay: submerged gear tint');
          rawRender.call(renderer, scene, camera);
          window.PerfProfiler?.end(tintPerf);
          waterReplayCount++;
        } finally {
          restoreMaterialStates(tintStates);
        }
        const coverDepthStates = prepareTintCoverDepthMaterials(nearbyTintCovers);
        try {
          camera.layers.mask = WATER_REPLAY_MASK;
          const depthPerf = window.PerfProfiler?.begin('held-overlay: translucent cover depth');
          rawRender.call(renderer, scene, camera);
          window.PerfProfiler?.end(depthPerf);
        } finally {
          restoreMaterialStates(coverDepthStates);
        }
      }

      if (scissored) { restoreRendererScissor(renderer); scissored = false; }
      stencilBuffer?.setMask?.(0xff); // The read-only water tint sets the write mask to zero.
      renderer.clearStencil?.();
    } finally {
      if (groundFilterActive) setGroundElevationFilter(groundMaterials, null);
      if (suppressedOverlay) restoreDraws(suppressedOverlay);
      if (coversHidden) restoreVisibility(coversHidden);
      if (replayCulled) restoreVisibility(replayCulled);
      if (waterReplayClipStates) endWaterReplayClip(waterReplayClipStates);
      if (distantTintHidden) restoreVisibility(distantTintHidden);
      if (scissored) restoreRendererScissor(renderer);
      camera.layers.mask = originalCameraMask;
      if (shadowMap) shadowMap.autoUpdate = oldShadowAutoUpdate;
      scene.autoUpdate = oldSceneAutoUpdate;
      scene.background = oldBackground;
      renderer.autoClear = oldAutoClear;
      renderer.autoClearColor = oldAutoClearColor;
      renderer.autoClearDepth = oldAutoClearDepth;
      renderer.autoClearStencil = oldAutoClearStencil;
      internalReplay = false;
    }
  }

  function isShellOutlinePass(scene, camera) {
    const material = scene?.overrideMaterial;
    return Number(camera?.layers?.mask ?? 0) >>> 0 === SHELL_MASK
      && material?.isShaderMaterial
      && material.side === THREE.BackSide
      && !!material.uniforms?.uThickness;
  }

  function hideNonXrayShellMeshes(scene, xraySet, visibleShellMeshes = null) {
    const states = new Map();
    const hideCandidate = object => {
      if (!object?.isMesh || !hasLayer(object, SHELL_LAYER) || xraySet.has(object)) return;
      states.set(object, object.visible);
      object.visible = false;
    };
    if (visibleShellMeshes) {
      for (const object of visibleShellMeshes) {
        if (isStillVisibleForShellReplay(object, scene)) hideCandidate(object);
      }
    } else scene.traverseVisible(hideCandidate);
    return states;
  }

  function isStillVisibleForShellReplay(object, scene) {
    // An onBeforeRender hook may hide/detach a mesh (or its parent) after the
    // snapshot was taken. Mirror traverseVisible's live visibility test before
    // touching shared materials or temporarily masking a shell.
    let current = object; // Checked against its ancestors to preserve live scene visibility.
    while (current && current !== scene) {
      if (current.visible === false) return false;
      current = current.parent;
    }
    return current === scene && scene.visible !== false;
  }

  function collectShellReplayCandidates(scene) {
    // One synchronous traversal serves the shell mask and *all* depth rebuilds
    // in this replay. Never persist it between frames: moving/hidden/newly-added
    // actors must be reconsidered for each render.
    const depth = []; // Visible mesh/sun/moon candidates for the colorless occluder passes.
    const shell = []; // Visible shell-layer meshes for per-elevation shell masking.
    scene.traverseVisible(object => {
      const isMesh = !!object?.isMesh;
      if (isMesh || (object?.isSprite && object.userData?.hobunjiNoOutline === true)) depth.push(object);
      if (isMesh && hasLayer(object, SHELL_LAYER)) shell.push(object);
    });
    return { depth, shell };
  }

  function withShellDepthColorMask(colorBuffer, draw, scene = null) {
    // A locked WebGL color mask stops writes even when ordinary opaque world
    // materials retain colorWrite:true. The callback is synchronous, and a
    // failed draw must never leave the next color/shell pass muted.
    if (!colorBuffer?.setMask || !colorBuffer?.setLocked) return draw();
    let colorOnly = null; // Held-gear VFX that cannot write anything in this colourless draw.
    try {
      colorBuffer.setMask(false);
      colorBuffer.setLocked(true);
      colorOnly = hideColorOnlyHeldVfx(scene);
      const result = draw();
      shellMaskedDepthDraws++;
      return result;
    } finally {
      if (colorOnly) restoreVisibility(colorOnly);
      colorBuffer.setLocked(false);
      colorBuffer.setMask(true);
    }
  }

  // Replays shell outlines for the same meshes that receive the selective
  // ground x-ray. The ordinary shell pass omits those meshes; this pass rebuilds
  // depth without x-ray ground, draws only their shells against every other
  // solid occluder, then restores ordinary scene depth for later outline passes.
  function replayShellOutlineXray(renderer, scene, camera, xrayMeshes, ground, topFaceGround, scissored, groups, shellPadding) {

    const oldAutoClear = renderer.autoClear;
    const oldAutoClearColor = renderer.autoClearColor;
    const oldAutoClearDepth = renderer.autoClearDepth;
    const oldAutoClearStencil = renderer.autoClearStencil;
    const oldBackground = scene.background;
    const oldOverride = scene.overrideMaterial;
    const oldCameraMask = camera.layers.mask;
    const oldSceneAutoUpdate = scene.autoUpdate;
    const shadowMap = renderer.shadowMap;
    const oldShadowAutoUpdate = shadowMap?.autoUpdate;
    const previousInternalReplay = internalReplay;
    const glState = renderer.state;
    const shellColorBuffer = glState?.buffers?.color; // Only shell depth renders use its fast colorless GPU mask.
    const canMaskShellColor = !!(shellColorBuffer?.setMask && shellColorBuffer?.setLocked); // Unavailable on fake/legacy renderers; keep material transaction.
    const groundMeshes = [...ground, ...topFaceGround];
    const groundMaterials = groups.some(group => group.regions.length) ? collectGroundElevationMaterials(groundMeshes, scene) : null; // Reuse the held pass aggregate when the visible ground matches.
    const groupCullCandidates = groups.length > 1 ? [] : null; // Reused by each shell depth draw.
    let scissorActive = false;
    let depthWasCleared = false;
    let replayCulled = null; // Renderables outside the scissor, hidden for every pass below (including the final depth restore, which is scissored too).
    let replayCandidates = null; // Shared between the replay loop and finally's depth restore; assigned after optional culling.
    let shellCandidateSnapshot = null; // When the scissor walk succeeds, reuse that same visible-scene enumeration for shell depth/materials.
    let depthStates = null; // Preserve the one depth-only material transaction across all group draws and final restoration.
    const nearReplay = nearReplaySupport(true); // Depth snapshots complement GPU color masking, with the legacy material fallback where unavailable.
    const backgroundMeshes = xrayRule('background.gearDepth') === 'ignore'
      ? collectVisible(backgroundDepthRegistry, scene) : []; // Visual backgrounds are never true hand/foot shell occluders.
    const nearCandidates = nearReplay ? [] : null; // Bounded objects still visible after the scissor cull.
    let groundFilterActive = false; // Cleanup for a shell group interrupted before its usual restore.
    let nearToken = null; // Saved depth of the replay rectangle as the shell pass found it.
    
    internalReplay = true;
    try {
      if (scissored) {
        glState.scissor(scissorRect);
        glState.setScissorTest(true);
        scissorActive = true;
        scissoredReplayCount++;
        // Same sub-frustum cull as replayHeldOverlay: these depth replays
        // render the whole scene (MASK_ALL) once per elevation group plus a
        // final restore, but can only write inside the scissor. Without it
        // the shell pass cost about as many draw calls as the base pass.
        if (replayCullEnabled && setReplayCullFrustum(camera, scissorRect, scissorTargetWidth, scissorTargetHeight)) {
          shellCandidateSnapshot = { depth: [], shell: [] }; // Populated only by surviving participants in the scissor walk.
          replayCulled = hideObjects(collectReplayCulled(scene, new Set(xrayMeshes), groupCullCandidates, nearCandidates, !!nearReplay, shellCandidateSnapshot));
        } else if (nearCandidates) collectBoundedReplayObjects(scene, new Set(xrayMeshes), nearCandidates);
      } else {
        fullscreenReplayCount++;
        lastReplayScissorCoverage = 1;
        if (nearCandidates) collectBoundedReplayObjects(scene, new Set(xrayMeshes), nearCandidates);
      }
      if (nearReplay) {
        nearToken = nearReplay.save(renderer, scissored ? scissorRect : null);
        if (nearToken) nearReplaySnapshots++;
      }

      renderer.autoClear = false;
      renderer.autoClearColor = false;
      renderer.autoClearDepth = false;
      renderer.autoClearStencil = false;
      scene.background = null;
      scene.autoUpdate = false;
      if (shadowMap) shadowMap.autoUpdate = false;
      replayCandidates = shellCandidateSnapshot;
      if (!replayCandidates) replayCandidates = collectShellReplayCandidates(scene); // No trusted scissor snapshot: preserve the original live scan.
      shellSceneTraversalsAvoided += groups.length * 2 + (shellCandidateSnapshot ? 1 : 0); // Includes the additional complete visible-scene walk avoided by fusing scissor + shell enumeration.
      // These source materials are identical for all elevation groups; only
      // the ground shader's tile uniforms change. A single transaction avoids
      // rescanning and rewriting every mesh/material once per actor group.
      depthStates = prepareNonGroundDepthMaterials(scene, replayCandidates.depth, canMaskShellColor);
      for (const mesh of xrayMeshes) {
        forEachMaterial(mesh.material, material => {
          saveMaterialState(depthStates, material);
          material.depthTest = true;
          material.depthWrite = true;
        });
      }

      // Use the same holder neighborhoods and ground-fragment filter as the
      // visible tool/hand/foot replay. The shell cannot become visible through
      // a different floor than its source object.
      for (const group of groups) {
        const groupScissored = scissorActive && applyElevationScissor(renderer, camera, group.meshes, glState, shellPadding);
        if (group.regions.length) {
          groundFilterActive = true;
          setGroundElevationFilter(groundMaterials, group);
        }
        // No floor punch here: by the shell pass the saved depth also holds the
        // PNG-silhouette occluder pass, which the clear-and-redraw below removes
        // around the holder. Keeping it hid hand/foot outlines (seen in testing).
        renderer.clearDepth();
        depthWasCleared = true;
        scene.overrideMaterial = null;
        camera.layers.mask = MASK_ALL;
        let groupCulled = null; // Keep the final depth restore outside this group’s tighter cull.
        let farCulled = null; // Objects wholly behind this group's shells; the saved depth brings them back.
        let npcReplayRestore = null; // Skip remote NPC portraits/limbs during just this local depth rebuild.
        let backgroundHidden = null; // Restore before source shell and final unfiltered depth.
        try {
          if (groupScissored && groupCullCandidates) groupCulled = cullReplayGroup(camera, groupCullCandidates);
          if (nearToken) farCulled = hideBeyondViewDepth(camera, nearCandidates, replayFarViewDepth(camera, group.meshes));
          if (groupScissored) npcReplayRestore = window.NpcViewFrustumCull?.suspendOutsideReplayRect?.(
            scene, camera, elevationScissorRect, scissorTargetWidth, scissorTargetHeight, group.meshes);
          backgroundHidden = backgroundMeshes.length ? hideObjects(backgroundMeshes) : null;
          if (backgroundHidden) backgroundDepthMeshesExcluded += backgroundHidden.size;
          withShellDepthColorMask(canMaskShellColor ? shellColorBuffer : null, () => rawRender.call(renderer, scene, camera), scene);
          nonGroundDepthReplayCount++;
        } finally {
          if (backgroundHidden) restoreVisibility(backgroundHidden);
          npcReplayRestore?.(); // Restore original actor visibility before drawing the group shell.
          if (farCulled) restoreVisibility(farCulled);
          if (groupCulled) restoreVisibility(groupCulled);
          if (groundFilterActive) {
            setGroundElevationFilter(groundMaterials, null);
            groundFilterActive = false;
          }
        }

        const groupSet = new Set(group.meshes);
        const shellVisibility = hideNonXrayShellMeshes(scene, groupSet, replayCandidates.shell);
        try {
          scene.overrideMaterial = oldOverride;
          camera.layers.mask = SHELL_MASK;
          rawRender.call(renderer, scene, camera);
          shellXrayPassCount++;
          shellXrayMeshDrawCount += group.meshes.length;
        } finally {
          restoreVisibility(shellVisibility);
        }
      }
    } finally {
      if (groundFilterActive) setGroundElevationFilter(groundMaterials, null); // An interrupted replay must never leave the filter active for the next pass.
      // Rebuild complete, unfiltered scene depth before later outline and
      // material-ID consumers. This is colorless and retains ordinary occlusion.
      try {
        if (depthWasCleared) {
          // Restore all actor rectangles before rebuilding the final unfiltered depth.
          if (scissorActive) {
            glState.scissor(scissorRect);
            lastReplayScissorCoverage = (scissorRect.z * scissorRect.w) / (scissorTargetWidth * scissorTargetHeight);
          }
          scene.overrideMaterial = null;
          if (nearToken && nearReplay.restore(renderer, nearToken, scissorActive ? scissorRect : null)) {
            // Saved depth is back; add the x-ray parts' own forced depth, as the full redraw below would have.
            camera.layers.mask = HELD_OVERLAY_MASK;
            withShellDepthColorMask(canMaskShellColor ? shellColorBuffer : null, () => rawRender.call(renderer, scene, camera), scene);
          } else {
            if (nearToken) nearReplayFallbacks++;
            camera.layers.mask = MASK_ALL;
            renderer.clearDepth();
            withShellDepthColorMask(canMaskShellColor ? shellColorBuffer : null, () => rawRender.call(renderer, scene, camera), scene); // The one original-depth transaction already covers the final unfiltered restore.
          }
        }
      } finally {
        if (depthStates) restoreMaterialStates(depthStates); // Also restores on a thrown depth/shell/ground draw.
        if (replayCulled) restoreVisibility(replayCulled);
        if (scissorActive) restoreRendererScissor(renderer);
        camera.layers.mask = oldCameraMask;
        scene.overrideMaterial = oldOverride;
        if (shadowMap) shadowMap.autoUpdate = oldShadowAutoUpdate;
        scene.autoUpdate = oldSceneAutoUpdate;
        scene.background = oldBackground;
        renderer.autoClear = oldAutoClear;
        renderer.autoClearColor = oldAutoClearColor;
        renderer.autoClearDepth = oldAutoClearDepth;
        renderer.autoClearStencil = oldAutoClearStencil;
        internalReplay = previousInternalReplay;
      }
    }
  }

  function resetBaseReplayDiagnostics() {
    // A normal-depth frame can return before replay setup. Clear the previous replay's readings here.
    lastBaseElevationGroups = 0;
    lastBaseReplayCandidates = 0;
    lastBaseOffscreenFiltered = 0;
    lastHeldFullscreenReason = 'no-visible-participants';
    lastForcedGroundDepthMaterials = 0;
    lastElevationReplayGroups = 0;
    lastXrayTileRegions = 0;
    lastXrayOrdinaryMeshes = 0;
    lastUnknownElevationMeshes = 0;
    lastNearbyTintCovers = 0;
    lastDistantTintCovers = 0;
    lastWaterClipScopes = 0;
    lastWaterClipOverflow = 0;
    lastFrontPortraitMaskCount = 0; // Reset per-base-pass diagnostics, including early return paths.
    lastFrontPortraitGearCandidates = 0;
    lastFrontPortraitMaskedGear = 0;
    lastFrontPortraitMaskReason = 'no-overlay';
  }

  // Ordinary presentation is independent of actor ground x-ray. A dry frame with all categories
  // disabled never enumerates actor roots, ground/foot replay registries, or replay occluders.
  function renderWithoutActorXray(scene, camera) {
    actorXrayBypassFrames++;
    resetBaseReplayDiagnostics();
    lastBaseStencilBits = currentFramebufferStencilBits(this);
    lastShellElevationGroups = lastShellReplayCandidates = lastShellOffscreenFiltered = 0;
    lastHeldFullscreenReason = lastShellFullscreenReason = 'all-actor-xray-disabled';
    lastReplayCulledCount = lastReplayKeptCount = lastReplayInstancedCulled = lastReplayInstancedKept = lastReplayInertCount = 0;
    lastReplayScissorCoverage = 0;
    lastOtherWeaponXrayActors = lastWaterPortraits = lastDryGearWaterSkips = 0;
    lastFrontPortraitMaskReason = 'all-actor-xray-disabled';
    // Retain ordinary weapon/material invariants without the ownership walk. Clear old hand
    // masking so a previous replay cannot hide a wing or shell after switching the feature off.
    const held = collectVisible(heldRegistry, scene);
    for (const mesh of held) enforceHeldMesh(mesh);
    if (maskedHands.size) updateFrontPlaneHands(held, scene, camera, 'off');
    const player = window.PlayerBodyTransformComposer?.getPlayerMesh?.();
    const tintPossible = lastBaseStencilBits >= 1 && xrayRule('portrait.waterTint') !== 'off' && waterPortraitRegistry.all.size > 0;
    const covers = tintPossible && tintCoverRegistry.all.size ? collectVisible(tintCoverRegistry, scene) : [];
    const portraits = player || covers.length ? collectVisible(waterPortraitRegistry, scene) : [];
    const portraitOrder = nearbyPortraitOrder(scene, camera, portraits);
    lastRankedPortraitActors = portraitOrder?.count || 0;
    const result = withPortraitDrawOrder(this, portraitOrder, () => originalRender.call(this, scene, camera), true);
    if (!covers.length || !portraits.length) return result;
    // Only actually wet portraits justify the independent water stencil pass. No actor ground
    // exemptions, gear overlays, floor collections, or outline replays are admitted in this mode.
    const bodyTint = submergedPortraits(camera, covers, portraits, scene);
    lastWaterPortraits = bodyTint.portraits.length;
    if (!lastWaterPortraits) return result;
    actorXrayWaterOnlyFrames++;
    const baseRenderEndedAt = performance.now();
    replaySelectiveHeldOverlay(this, scene, camera, [], [], [], [], covers, Number(camera.layers.mask) >>> 0, bodyTint, portraitOrder);
    window.OutlineRenderPerformance?.markSceneMatricesCurrent?.(this, scene, baseRenderEndedAt);
    return result;
  }

  function wrappedRender(scene, camera) {
    if (internalReplay || !scene?.isScene || !camera?.isCamera || retiredScenes.has(scene)) {
      return originalRender.call(this, scene, camera);
    }
    const baseWorldPass = isBaseWorldPass(scene, camera); // Shared by actor selection and the ordinary world draw.
    if (allActorXrayDisabled) {
      if (!baseWorldPass) return originalRender.call(this, scene, camera); // No shell participant collection or replay.
      scanScene(scene); // One initial registration scan, plus pending additions only.
      syncShoulderPetLayering(camera);
      return renderWithoutActorXray.call(this, scene, camera);
    }
    replayCameraPosition = camera.matrixWorld?.elements ? { x: camera.matrixWorld.elements[12], y: camera.matrixWorld.elements[13], z: camera.matrixWorld.elements[14] } : null; // Feet x-ray distance rule.
    if (baseWorldPass) {
      if (hasDisabledActorXray) refreshActorXrayRoots(scene);
      syncShoulderPetLayering(camera); // Reassert paired-sprite policy after other actor depth writers.
    }
    scanScene(scene);
    if (isShellOutlinePass(scene, camera)) {
      if (hasDisabledActorXray && actorXrayScene !== scene) refreshActorXrayRoots(scene);
      const shellOthers = []; // Non-participant shells stay in the ordinary shell pass (normal depth).
      const skipsBefore = nonParticipantReplaySkips, budgetSkipsBefore = otherWeaponXrayBudgetSkips, ringSkipsBefore = localReplayRingSkips;
      const held = collectVisible(heldRegistry, scene, shellOthers);
      const feet = collectVisible(waterOccludedRegistry, scene, shellOthers);
      nonParticipantReplaySkips = skipsBefore; otherWeaponXrayBudgetSkips = budgetSkipsBefore; localReplayRingSkips = ringSkipsBefore; // Counted once a frame, by the base pass.
      const shellCandidates = [...new Set([...held, ...feet])].filter(mesh => hasLayer(mesh, SHELL_LAYER) && !isAuthoredInkPlane(mesh)); // Hands, feet and true 3D props only; PNG weapon/character art already has ink.
      window.HobunjiHandOutlineParity?.refreshHeldMatrices?.(shellCandidates); // Refresh live hand matrices before camera culling or shell scissor projections.
      const xrayMeshes = filterOffscreenReplayMeshes(camera, shellCandidates);
      lastShellReplayCandidates = shellCandidates.length;
      lastShellOffscreenFiltered = shellCandidates.length - xrayMeshes.length;
      if (!xrayMeshes.length) {
        lastShellElevationGroups = 0;
        lastShellFullscreenReason = 'no-visible-participants';
        return originalRender.call(this, scene, camera);
      }
      const baseShellPadding = Math.abs(Number(scene.overrideMaterial.uniforms.uThickness.value) || 0); // Source shell thickness before per-limb pose adapters.
      const shellPadding = baseShellPadding * (xrayMeshes.some(mesh => !!mesh.__hobunjiXrayBoundParity && mesh.__hobunjiXrayBoundParity.hook === mesh.onBeforeRender) ? 2 : 1); // Hand/foot outlines can double their authored shell thickness; bound the maximum.
      const { groups, ordinary } = buildXrayGroups(this, scene, camera, xrayMeshes, shellPadding);
      lastShellElevationGroups = groups.length;
      // Ordinary shells use the real scene depth unchanged; reconstructing all
      // geometry for them duplicates the existing shell pass. Keep their normal
      // silhouettes in that pass, including NPC, hostile, pet and player rigs.
      ordinaryShellMeshesDrawnOnce += ordinary.length;
      if (!groups.length) {
        ordinaryShellReplaysAvoided++;
        lastShellFullscreenReason = 'ordinary-depth';
        return originalRender.call(this, scene, camera);
      }
      const ground = collectVisible(groundRegistry, scene);
      const topFaceGround = collectVisible(topFaceGroundRegistry, scene);
      if (!ground.length && !topFaceGround.length) {
        lastShellElevationGroups = 0;
        lastShellFullscreenReason = 'no-ground';
        return originalRender.call(this, scene, camera);
      }
      const xrayGroupMeshes = groups.flatMap(group => group.meshes); // Only genuine local floor exemptions need a depth reconstruction.
      const shellGlState = this.state; // Scissoring is shared with the existing held/foot replay safety switch.
      const hasShellScissorApi = !!(shellGlState?.scissor && shellGlState?.setScissorTest); // Reports unavailable scissor support distinctly from an unsafe bound.
      const scissored = replayScissorEnabled && hasShellScissorApi
        && replayScissorRect(this, camera, xrayGroupMeshes, scissorRect, null, shellPadding); // Ordinary shells were drawn in the normal pass and must not inflate the exceptional replay rectangle.
      lastShellFullscreenReason = scissored ? 'none' : !replayScissorEnabled ? 'disabled'
        : !hasShellScissorApi ? 'scissor-api-unavailable' : lastScissorFailureReason;
      if (scissored && (scissorRect.z <= 0 || scissorRect.w <= 0)) {
        return originalRender.call(this, scene, camera);
      }
      // Avoid drawing these shells once under normal ground depth and again in
      // the selective replay. The replay redraws their complete visible shell.
      const hiddenXrayShells = hideObjects(xrayGroupMeshes); // Ordinary shells are drawn once in the standard outline pass.
      let shellResult; // Return value of the ordinary shell pass, excluding x-ray participants.
      try {
        shellResult = originalRender.call(this, scene, camera);
      } finally {
        restoreVisibility(hiddenXrayShells);
      }
      replayShellOutlineXray(this, scene, camera, xrayGroupMeshes, ground, topFaceGround, scissored, groups, shellPadding);
      return shellResult;
    }
    if (!enabled || !baseWorldPass) return originalRender.call(this, scene, camera);
    // The normal world render pays no position lookup, allocation or preview submission
    // unless its developer-only circle checkbox has been enabled.
    if (xrayRule('ground.showZone') === 'on') {
      const zonePreview = window.XrayHierarchy;
      if (zonePreview?.updateGroundZone) {
        let playerScope = null; // Only the debug display resolves the player's world-space ground support.
        const player = window.PlayerBodyTransformComposer?.getPlayerMesh?.();
        if (actorXrayEnabled.player && player && isDescendantOf(player, scene)) {
          player.updateWorldMatrix?.(true, false);
          playerScope = actorXrayScope(player, scene, new Map());
        }
        zonePreview.updateGroundZone(scene, playerScope, XRAY_CIRCLE_RADIUS);
      }
    }

    const originalCameraMask = Number(camera.layers.mask) >>> 0;
    lastBaseStencilBits = currentFramebufferStencilBits(this);
    resetBaseReplayDiagnostics();
    const replayOthers = []; // Non-participant hands/feet/held items: drawn in the base pass, hidden from the replays.
    const held = collectVisible(heldRegistry, scene, replayOthers);
    const tintCovers = collectVisible(tintCoverRegistry, scene); // Water/slush foreground alpha applies to gear, hands and feet; not opaque snow.
    const feet = collectVisible(waterOccludedRegistry, scene, replayOthers); // Procedural foot meshes share selective ground x-ray.
    const canTintPortraits = !!(tintCovers.length && lastBaseStencilBits >= 1 && waterPortraitRegistry.all.size);
    const portraits = canTintPortraits || window.PlayerBodyTransformComposer?.getPlayerMesh?.()
      ? collectVisible(waterPortraitRegistry, scene) : [];
    if (maskedHands.size && replayOthers.length) updateFrontPlaneHands(replayOthers, scene, camera, 'off'); // Restore previously masked shells/wings when their owner leaves the ring.
    updateFrontPlaneHands(held, scene, camera);
    const portraitOrder = nearbyPortraitOrder(scene, camera, portraits);
    lastRankedPortraitActors = portraitOrder?.count || 0;
    const renderBase = () => withPortraitDrawOrder(this, portraitOrder, () => originalRender.call(this, scene, camera), true);
    lastWaterPortraits = 0;
    lastDryGearWaterSkips = 0;
    if (!held.length && !feet.length && !canTintPortraits) return renderBase();
    // Water-only frames need no floor registries. Ordinary dry frames with no gear already returned.
    const ground = held.length || feet.length ? collectVisible(groundRegistry, scene) : [];
    const topFaceGround = held.length || feet.length ? collectVisible(topFaceGroundRegistry, scene) : [];
    // Even without nearby grass, floor or water, held gear still needs its owner's front-portrait stencil.
    // The historical early return silently bypassed this on empty/auxiliary maps (especially visible with shoulder pets).
    if (!ground.length && !topFaceGround.length && !tintCovers.length) {
      const needsOwnerMask = held.some(isPortraitMaskedGear)
        && collectVisible(frontPortraitRegistry, scene).length > 0; // The mask can use physical depth when the private stencil is absent.
      if (!needsOwnerMask) {
        lastFrontPortraitMaskReason = 'no-ground-or-owner-mask';
        lastHeldFullscreenReason = 'no-cover-or-owner-mask';
        return renderBase();
      }
    }

    baseWorldRenderCount++;
    for (const mesh of held) enforceHeldMesh(mesh);
    for (const mesh of ground) enforceGroundMesh(mesh);

    // Draw held items and procedural feet exactly once, after reconstructed
    // cover depth. Normal water uses depthWrite=false, so feet left in this
    // base pass could otherwise render visibly over the water surface.
    const gearParticlesHidden = beginGearParticles([...held, ...feet]); // Drawn once, in their gear's group overlay.
    try { // Whatever throws below, the particles hidden above are shown again before this render returns.
      const heldDraws = suppressDraws([...held, ...feet]);
      let result;
      const basePerf = window.PerfProfiler?.begin('held-overlay: base render');
      try {
        result = renderBase();
      } finally {
        window.PerfProfiler?.end(basePerf);
        restoreDraws(heldDraws);
      }

      const baseRenderEndedAt = performance.now(); // The scene's matrices were last computed by the base render above.
      window.HobunjiHandOutlineParity?.refreshHeldMatrices?.(held); // Update procedural hand matrices BEFORE camera filtering and subsequent depth-scissor bounds.
      const visibleHeld = filterOffscreenReplayMeshes(camera, held); // Omit offscreen rigid items only after the base pass updates world matrices.
      const visibleFeet = filterOffscreenReplayMeshes(camera, feet); // Apply the same conservative test to procedural feet.
      const bodyTint = canTintPortraits ? submergedPortraits(camera, tintCovers, portraits, scene) : null;
      lastWaterPortraits = bodyTint?.portraits.length || 0;
      lastBaseReplayCandidates = held.length + feet.length;
      lastBaseOffscreenFiltered = lastBaseReplayCandidates - visibleHeld.length - visibleFeet.length;
      const replayPerf = window.PerfProfiler?.begin('held-overlay: total replay'); // Sum of the replay sub-passes, comparable with held-overlay: base render.
      // Non-participants were drawn normally above; keep them out of the replays,
      // whose overlay passes draw everything on the held-overlay layer.
      // Their particles (enchantment, weapon fire) too: they drew once with their gear in the base pass
      // and must not show through grass in an overlay their gear is not part of.
      const otherParticles = replayOthers.length ? gearParticlesOf(replayOthers) : null;
      const othersHidden = replayOthers.length
        ? suppressDraws(otherParticles?.length ? replayOthers.concat(otherParticles) : replayOthers, HELD_OVERLAY_MASK) : null;
      releaseUnreplayedGearParticles(new Set([...visibleHeld, ...visibleFeet]));
      try {
        if (visibleHeld.length || visibleFeet.length || bodyTint?.portraits.length)
          replaySelectiveHeldOverlay(this, scene, camera, visibleHeld, visibleFeet, ground, topFaceGround, tintCovers, originalCameraMask, bodyTint, portraitOrder);
        else emptyHeldReplayTransactionsAvoided++; // Do not enter the replay transaction when all participants were rejected.
      } finally {
        if (othersHidden) restoreDraws(othersHidden);
      }
      window.PerfProfiler?.end(replayPerf);
      // The replays are renders of their own that the outline wrapper sees after the base pass, and they
      // used to end its matrix-reuse sequence. They only toggle visibility/layers/materials, so the base
      // pass's matrices are still current: re-arm the sequence for the PNG-depth/shell/mist/text passes.
      window.OutlineRenderPerformance?.markSceneMatricesCurrent?.(this, scene, baseRenderEndedAt);
      return result;
    } finally {
      endGearParticles(gearParticlesHidden);
    }
  }

  wrappedRender.__hobunjiHeldRenderOrderWrapped = true;
  wrappedRender.__hobunjiHeldRenderOrderOriginal = originalRender;
  rendererProto.render = wrappedRender;

  function snapshot() {
    if (classificationScheduled) flushClassification(); // Diagnostics/tests read counts right after add().
    const elevationMaterials = groundElevationMaterialStats(); // Current shader support, including recent compiles.
    return {
      installed: true,
      enabled,
      actorXrayEnabled: { ...actorXrayEnabled }, // Included in the existing x-ray diagnostics.
      allActorXrayDisabled, actorXrayBypassFrames, actorXrayWaterOnlyFrames, // All-off fast-path counters for mobile diagnostics.
      mode: 'selective-depth-replay',
      legacyHeldRenderOrder: LEGACY_HELD_RENDER_ORDER,
      heldOverlayLayer: HELD_OVERLAY_LAYER,
      groundReplayLayer: GROUND_REPLAY_LAYER,
      heldMeshes: heldCount,
      groundMeshes: groundCount,
      grassMeshes: grassCount,
      roadMeshes: roadCount,
      terrainMeshes: terrainCount,
      farmhouseFloorMeshes: farmhouseFloorCount,
      interiorFloorMeshes: interiorFloorCount,
      topFaceGroundMeshes: topFaceGroundCount,
      waterReplayMeshes: waterMeshCount,
      translucentCoverMeshes: tintCoverRegistry.all.size,
      waterOccludedMeshes: waterOccludedMeshCount,
      pantsXrayRegistrations,
      waterReplays: waterReplayCount,
      nearbyTintCovers: lastNearbyTintCovers,
      distantTintCoversSkipped: lastDistantTintCovers,
      waterClipScopes: lastWaterClipScopes,
      registryDirectScenePlacements,
      rankedPortraitActors: lastRankedPortraitActors,
      ordinaryPortraitSortDraws: withVisualSort.ordinaryDraws || 0,
      handsBehindFrontPlane: lastHandsBehindFrontPlane,
      airborneDepthRebuilds,
      backgroundDepthMeshesExcluded,
      registeredBackgroundDepthMeshes: backgroundDepthRegistry.all.size,
      handPlaneProbe: { ...handProbe },
      waterPortraits: lastWaterPortraits,
      dryGearWaterSkips: lastDryGearWaterSkips,
      waterClipOverflow: lastWaterClipOverflow,
      stencilBits: lastBaseStencilBits,
      missingStencilFootReplaySkips: missingStencilFootReplaySkipCount,
      scissoredReplays: scissoredReplayCount,
      fullscreenReplays: fullscreenReplayCount,
      lastHeldFullscreenReason,
      lastShellFullscreenReason,
      baseReplayCandidates: lastBaseReplayCandidates,
      baseOffscreenFiltered: lastBaseOffscreenFiltered,
      shellReplayCandidates: lastShellReplayCandidates,
      shellOffscreenFiltered: lastShellOffscreenFiltered,
      baseElevationGroups: lastBaseElevationGroups,
      shellElevationGroups: lastShellElevationGroups,
      shellSceneTraversalsAvoided,
      shellMaskedDepthDraws, shellOpaqueMaterialWritesAvoided,
      ordinaryDepthLeavesSkipped,
      ordinaryDepthClearsAvoided,
      ordinaryDepthSceneWalksAvoided, emptyOrdinaryDepthPassesAvoided, emptyHeldReplayTransactionsAvoided,
      groupScissors: groupScissorCount,
      lastReplayScissorCoverage: Number(lastReplayScissorCoverage.toFixed(4)),
      replayCullEnabled,
      replayScissorEnabled, autoInertReplayEnabled, // Read by the Settings toggles (render-optimization-settings.js).
      lastReplayCulled: lastReplayCulledCount,
      lastReplayKept: lastReplayKeptCount,
      lastReplayInstancedCulled, lastReplayInstancedKept, lastReplayInert: lastReplayInertCount, autoInertReplaySkips: autoInertReplayCount, colorOnlyDepthSkipEnabled, colorOnlyDepthSkips, skinnedScissorEnabled, skinnedScissorBounds, farOnlyReplaySkips, floorPunch: { enabled: floorPunchEnabled, punches: floorPunches, fallbacks: floorPunchFallbacks, depthResets: floorPunchDepthResets, refillHidden: floorPunchRefillHidden, refillKept: floorPunchRefillKept }, replayParticipants: replayParticipantPolicy, shortXraySpecies: [...shortXraySpecies], feetXrayDistance, localReplayRingEnabled, localReplayTileRadius: XRAY_TILE_RADIUS, localReplayRingSkips, nonParticipantReplaySkips, otherWeaponXrayLimit, otherWeaponXrayBudgetSkips, lastOtherWeaponXrayActors, heldOwnerLinkEnabled, gearParticlesOnceEnabled, gearParticleSkips, lastGearParticles,
      instancedReplaySphereReuses, nearReplayBoxTests,
      nearReplayEnabled, nearReplaySnapshots, nearReplayFarCulled, nearReplayFallbacks,
      lastNearReplayFarDepth: Number.isFinite(lastNearReplayFarDepth) ? Number(lastNearReplayFarDepth.toFixed(2)) : null,
      baseWorldRenders: baseWorldRenderCount,
      selectiveOverlays: selectiveOverlayCount,
      nonGroundDepthReplays: nonGroundDepthReplayCount,
      frontPortraitMasks: lastFrontPortraitMaskCount,
      frontPortraitGearCandidates: lastFrontPortraitGearCandidates,
      frontPortraitMaskedGear: lastFrontPortraitMaskedGear,
      frontPortraitMaskReason: lastFrontPortraitMaskReason,
      shoulderPetCompositor: {
        ...lastShoulderPetDecision,
        stowedBurdenAbovePet: lastShoulderPetDecision.active && !!window.Shattercasks?.backCarriedInfo?.(),
      },
      frontPortraitMaskPasses: frontPortraitMaskPassCount,
      frontPortraitDepthFallbackPasses, // Visibility into fallback use without mobile devtools.
      groundDepthRestores: groundDepthRestoreCount,
      invariantRepairs: invariantRepairCount,
      heldOrderNormalizations,
      lastHeldOrderNormalization: lastHeldOrderNormalization ? { ...lastHeldOrderNormalization } : null,
      ordinaryShellMeshesDrawnOnce,
      ordinaryShellReplaysAvoided,
      shellXrayPasses: shellXrayPassCount,
      shellXrayMeshes: shellXrayMeshDrawCount,
      elevationReplayGroups: lastElevationReplayGroups,
      xrayTileRegions: lastXrayTileRegions,
      forcedGroundDepthMaterials: lastForcedGroundDepthMaterials, // Ground depth repaired for gear without changing the world pass.
      xrayOrdinaryMeshes: lastXrayOrdinaryMeshes,
      unknownElevationMeshes: lastUnknownElevationMeshes,
      elevationShaderMaterials: elevationMaterials.supported,
      elevationShaderFallbacks: elevationMaterials.fallback,
      groundMaterialCacheHits, groundMaterialCacheBuilds,
      surfaceOcclusionComposer: surfaceComposer?.snapshot?.() || null,
    };
  }

  function debugLogSnapshot() {
    const state = snapshot();
    const signature = JSON.stringify(state);
    if (signature !== lastDebugSignature) {
      lastDebugSignature = signature;
      const message = `[held-xray] enabled=${state.enabled} animals=${state.actorXrayEnabled.animals} enemies=${state.actorXrayEnabled.enemies} player=${state.actorXrayEnabled.player} held=${state.heldMeshes} ground=${state.groundMeshes} (grass=${state.grassMeshes} road=${state.roadMeshes} terrain=${state.terrainMeshes} interior=${state.interiorFloorMeshes} farmhouse=${state.farmhouseFloorMeshes}) footWater=${state.waterOccludedMeshes}/${state.waterReplayMeshes}/${state.waterReplays} pantsXray=${state.pantsXrayRegistrations} stencil=${state.stencilBits} stencilSkips=${state.missingStencilFootReplaySkips} base=${state.baseWorldRenders} overlay=${state.selectiveOverlays} depth=${state.nonGroundDepthReplays}/${state.groundDepthRestores} portraitMask=${state.frontPortraitMasks}/${state.frontPortraitMaskPasses} shellXray=${state.shellXrayPasses}/${state.shellXrayMeshes} repairs=${state.invariantRepairs} scissor=${state.scissoredReplays}/${state.fullscreenReplays} reasons=${state.lastHeldFullscreenReason}/${state.lastShellFullscreenReason} coverage=${state.lastReplayScissorCoverage} offscreen=${state.baseOffscreenFiltered}/${state.baseReplayCandidates} shellOffscreen=${state.shellOffscreenFiltered}/${state.shellReplayCandidates} groups=${state.baseElevationGroups}/${state.shellElevationGroups} shellWalksAvoided=${state.shellSceneTraversalsAvoided} groupScissors=${state.groupScissors} elevationGroups=${state.elevationReplayGroups} tileRegions=${state.xrayTileRegions} ordinaryDepth=${state.xrayOrdinaryMeshes} unknownElevation=${state.unknownElevationMeshes} elevationShaders=${state.elevationShaderMaterials}/${state.elevationShaderFallbacks}`;
      if (typeof window.__farmLog === 'function') window.__farmLog(message, 'render');
      else console.debug(message);
    }
    return state;
  }

  // Every registry keeps its members (and the scene they were found under) in
  // strong Sets and Maps, so a scene the game discards would stay reachable
  // with all of its meshes. The inactive zone cache calls this before it empties
  // an evicted zone's scene: placed members leave through their scene bucket,
  // members not yet placed through a traversal.
  function forgetScene(scene) {
    if (!scene) return 0;
    retiredScenes.add(scene);
    if (scene === actorXrayScene) {
      actorXrayRoots.clear();
      actorXrayScene = null;
    }
    const registries = [heldRegistry, groundRegistry, topFaceGroundRegistry, tintCoverRegistry, protectedCoverRegistry, waterOccludedRegistry, pngDepthRegistry, frontPortraitRegistry, waterPortraitRegistry, backgroundDepthRegistry];
    let removed = 0;
    for (const registry of registries) {
      const bucket = registry.byScene.get(scene);
      if (bucket) for (const object of [...bucket]) if (registry.delete(object)) removed++;
      registry.byScene.delete(scene);
    }
    scene.traverse?.(object => {
      pendingClassification.delete(object); // A queued add must not restore references after scene disposal.
      for (const registry of registries) if (registry.delete(object)) removed++;
    });
    if (groundElevationCache.get(scene)?.materials === lastGroundElevationMaterials) lastGroundElevationMaterials = null;
    groundElevationCache.delete(scene);
    lastSceneScan.delete(scene);
    return removed;
  }

  window.HeldObjectRenderOrder = {
    installed: true,
    forgetScene,
    mode: 'selective-depth-replay',
    LEGACY_HELD_RENDER_ORDER,
    FOOT_WATER_MASK_LAYER,
    HELD_OVERLAY_LAYER,
    GROUND_REPLAY_LAYER,
    markHeldPlane,
    markWaterOccludedMesh,
    markGroundMesh,
    SHOULDER_PET_RENDER_ORDERS,
    setShoulderPetLayering,
    scanScene,
    snapshot,
    debugLogSnapshot,
    setReplayScissorEnabled: value => { replayScissorEnabled = value !== false; return replayScissorEnabled; },
    setReplayCullEnabled: value => { replayCullEnabled = value !== false; return replayCullEnabled; },
    setNearReplayEnabled: value => { nearReplayEnabled = value !== false; return nearReplayEnabled; },
    setAutoInertReplayEnabled: value => { autoInertReplayEnabled = value !== false; return autoInertReplayEnabled; },
    setColorOnlyDepthSkipEnabled: value => { colorOnlyDepthSkipEnabled = value !== false; return colorOnlyDepthSkipEnabled; },
    setSkinnedScissorEnabled: value => { skinnedScissorEnabled = value !== false; return skinnedScissorEnabled; },
    actorXrayDefaults,
    getActorXrayEnabled: group => Object.hasOwn(actorXrayEnabled, group) ? actorXrayEnabled[group] : null,
    setActorXrayEnabled,
    setLocalReplayRingEnabled: value => { localReplayRingEnabled = value !== false; return localReplayRingEnabled; },
    setReplayParticipants: value => { replayParticipantPolicy = value === 'all' ? 'all' : 'rule'; return replayParticipantPolicy; },
    setShortXraySpecies: list => { shortXraySpecies.clear(); for (const id of list || []) shortXraySpecies.add(String(id).toLowerCase()); return [...shortXraySpecies]; },
    setFloorPunchEnabled: value => { floorPunchEnabled = value !== false; return floorPunchEnabled; },
    setFeetXrayDistance: units => { const n = Number(units); if (Number.isFinite(n) && n >= 0) feetXrayDistance = n; return feetXrayDistance; },
    setGearParticlesOnceEnabled: value => { gearParticlesOnceEnabled = value !== false; return gearParticlesOnceEnabled; },
    linkGearParticle, // (particle, ownerGearMesh | null): VFX parented outside its gear, drawn once after that gear (dungeon-fire.js).
    setHeldOwnerLinkEnabled: value => { heldOwnerLinkEnabled = value !== false; participantCache = new WeakMap(); return heldOwnerLinkEnabled; },
    setOtherWeaponXrayLimit: count => { const n = Number(count); if (n === Infinity || (Number.isInteger(n) && n >= 0)) otherWeaponXrayLimit = n; return otherWeaponXrayLimit; },
    get replayingDepth() { return internalReplay; }, // The outline compositor must not start a new frame from an internal held/shell replay.
    get enabled() { return enabled; },
    // Retained as a compatibility no-op for the former camera-mode toggle.
    // Ground/grass x-ray is now an invariant of held weapon presentation.
    setEnabled() { enabled = true; },
    enforceHeldInvariant() {
      if (classificationScheduled) flushClassification();
      for (const mesh of heldRegistry) enforceHeldMesh(mesh);
    },
    classify(object) {
      return {
        held: isLegacyHeldPlane(object),
        surface: surfaceKindForObject(object),
        surfacePolicy: surfacePolicyForObject(object),
        ground: !!groundKind(object),
        grass: isGrassGroundCover(object),
        road: isRoadSurface(object),
        terrain: isTerrainSurface(object),
        topFacesGround: isTopFacesGroundSurface(object),
        waterSurface: isWaterSurface(object),
      tintedCover: isTintCover(object),
        waterOccluded: object?.userData?.hobunjiWaterOccludedBySurface === true,
      };
    },
  };
})();

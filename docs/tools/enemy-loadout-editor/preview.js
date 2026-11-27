import * as ThreeModule from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const THREE = { ...ThreeModule };
window.THREE = THREE;
const files = [
  'config/scratchbones-config.js?v=20261122h5cf4b6d',
  'config/attachment-rig-profiles.js?v=20261127rootAnatomyRevert16',
  'config/character-rig-scale-defaults.js?v=20261126h1dd486d',
  'js/character-rig-scale.js?v=20261126he6d0d7e',
  'js/color-fill.js?v=20261117h93b0e83',
  'js/beard-hood-cutout.js?v=20261125pristineCloth1', // Painted beard/front-hood arbitration used by the shared portrait compositor.
  'js/portrait-utils.js?v=20261127ruinTorsoOnly10',
  'js/portrait-breathing.js?v=20261028a',
  'js/npc-avatar-preview-utils.js?v=20261122hKasa3',
  'js/character-spine.js?v=20261126neckBlendConsolidate3', // Hunchback weights/deformation, read by the portrait skin, shoulder aim and leg solver.
  'js/hat-overflow-plane.js?v=20261124hatOverflow3', // Big hats: hat pixels past the portrait square (HatOverflowPlane).
  'js/png-plane-avatar.js?v=20261127rootRigAudit18',
  'js/species-pose-scaling.js?v=20261115shoulders3',
  'js/character-dimensions.js?v=20261126neckAudit2', // Species heights drive the held weapon's height factor and grip offset, exactly as in the game and Attack Animation Editor.
  'js/transform-dump-utils.js?v=20261017h3ce7f8d',
  'js/rig-transform-dump.js?v=20261029rigdump1',
  'config/portrait-mouth-points.js?v=20261029a',
  'js/furniture-light-registry.js?v=20261119h1454e19',
  'js/tool-metal-recolor.js?v=20261127ruinBlotchLift6',
  'js/weapon-layer-effects.js?v=20261115torchWick2', // Marker-pixel scanning shared with the flail fuel sprites (the guardians' flame headband emitters).
  'config/weapon-sprite-assemblies.js?v=20261127mirrorFlail2', // Layered weapon recipes (the Torch-Flail chain and brazier, the Torch-Staff's marker recolor and fire), shared with the game.
  'js/weapon-sprite-assemblies.js?v=20261127h7b0ee2059', // Their runtime: held weapons get the same layers, recolor and fire as in the game.
  'js/motif-store.js?v=20261026templepatterns1', // The shared Pattern editor and libraries, so clothing and weapon patterns are authored with the same UI as the game and other tools.
  'js/pattern-library.js?v=20261026hPlayerDefaults5',
  'js/repo-pattern-library.js?v=20261111h873ccf1',
  'js/pattern-authoring.js?v=20261124patternNestAudit5',
  'js/furniture-pattern-surfaces.js?v=20261124patternNestAudit2',
  'config/natural-surface-materials.js?v=20261027h1fb8ced',
  'js/natural-surface-materials.js?v=20261027h1fb8ced',
  'js/surface-stretch-uv-furniture.js?v=20261126hd96f961',
  'js/faceted-rocks.js?v=20261120h4dacd76',
  'js/ice-stalagmite-coverage.js?v=20261127ruinSurfaceAnchors9',
  'js/metal-armor-system.js?v=20261124patternNestAudit2',
  'js/town-mine.js?v=20261028a',
  'js/npc-movement-head-target.js?v=20261028a',
  'js/leg-bones.js?v=20261028a',
  'js/actor-body-sink.js?v=20261117hRigSink2', // Match runtime stance lowering and floor contact in the Workshop.
  'js/procedural-leg-animation.js?v=20261127rootRigAudit19',
  'js/procedural-feet-outline-parity.js?v=20261127screenMaskParity1',
  'js/png-plane-outline-occluder.js?v=20261126weaponDepthParity1',
  'js/weather-fx.js?v=20261109htzizw1',
  'js/emissive-light-orbs.js?v=20261104hc955306',
  'js/sprite-recolor.js?v=20261126he9d2fa1', // Garment tint (pants/clothing dye) needs SpriteRecolor.recolorImageData.
  'js/procedural-mask-patterns.js?v=20261029maskpat1', // Per-wearer procedural glyph patterns for masks.
  'js/clothing-weaving-system.js?v=20261126planarRebase1', // Garment dye/weave renderer: without it every garment falls back to its plain undyed art (pants never showed their dye).
  'js/npc-wardrobe.js?v=20261119hwardrobeRefusal3', // Applies the live NPC forced-overpass garment policy before the portrait is baked; required for named lich glyphs.
  'config/pants-rigs.js?v=20261028a',
  'js/pants-rig-core.js?v=20261126exactSeamsAudit1',
  'js/pants-garment-renderer.js?v=20261127ruinInkPants4',
  'js/perp-rotation.js?v=20261126flailHeadLean1', // Mounts turn like creature cards (dead-zone facing); without it the Nazgraku card stays edge-on.
  'js/creature-texture-cache.js?v=20261105h5c6c35c',
  'js/creature-genetics.js?v=20261124sharedBodyColors2', // makeDefaultGenotype: the same coat roll wild Nazgraku get.
  'js/creature-genetics-render.js?v=20261124sharedBodyColors2',
  'config/modular-weapons.js?v=20261127spikedSweep1',
  'js/modular-weapons.js?v=20261127spikeDraftSweep2',
  'js/held-action-animations.js?v=20261127allIdleClearance1',
  'js/combat/shared-attack-pose.js?v=20261126flailHeadLean1',
  'js/combat/attack-pose-templates.js?v=20261115h01bf772',
  'js/combat/melee-pose-spacing.js?v=20261028a',
  'js/combat/resource-system.js?v=20261127combatPopups1',
  'js/perk-system.js?v=20261125enemyClassAudit2', // Preview builds must use the same combat class allocation as the game.
  'js/trinket-system.js?v=20261122enemyTrinketAdd1', // Enemy Workshop spawns use the same equipment definitions and additive stat provider as gameplay.
  'js/combat/weapon-shape-stats.js?v=20261122hShapeFootingOnce',
  'js/combat/combat-combo.js?v=20261126h0b2c6f0',
  'js/combat/combat-quickattacks.js?v=20261126planarRebase1',
  'js/combat/combat-charged-breaker.js?v=20261126h22fa9c0',
  'js/combat/combat-counter-shield.js?v=20261126planarRebase1',
  'js/combat/ranged-weapons.js?v=20261126spiritHealAudit1',
  'js/alchemy-system.js?v=20261125idleGate2',
  'js/combat/enemy-loadout-rules.js?v=20261127ruinViewer1',
  'js/combat/combat-bandit.js?v=20261127rootRigAudit19',
  'js/weapon-tool-stances.js?v=20261127allIdleClearance1',
  'js/combat/enemy-weapon-stances.js?v=20261122heldPreviewAudit1',
  'js/combat/combat-minion.js?v=20261127rootCorsCrystalParity11',
  'js/combat/combat-maskbound-guardian.js?v=20261031headtakerguardian6',
  'js/combat/combat-animal-attacks.js?v=20261126h583b393', // Real animal special registry underlies the shared attachment system.
  'js/combat/combat-attach.js?v=20261126h901bb94', // One owner for attach/detach, dodge interruption and victim targeting.
  'js/combat/combat-maskbound-headtaker.js?v=20261126neckPlanarIntegration1', // Actual Headtaker animation and head throw, not a fabricated preview-only pose.
  'js/combat/combat-lich.js?v=20261118pursuitRetreat1',
  'js/combat/combat-enchantments.js?v=20261127h9f27629', // Enchantment definitions and the particle vocabulary, for the Shadowknights' enchanted weapons.
  'js/combat/weapon-enchantment-vfx.js?v=20261117flailEnchants1',
  'js/combat/ghoul-special-variants.js?v=20261127ruinViewer1',
  'js/combat/bandit-rank-wardrobe.js?v=20261031rankwardrobe1',
  'js/combat/combat-special-liches.js?v=20261118combatOrbit1', // Workshop loads the shipped boss runtime, not a copied test implementation.
  'js/rig-transform-layers.js?v=20261122hc3370fb', // Shared owner registry precedes both body and drunken gait composers.
  'js/player-body-transform-composer.js?v=20261123cutsceneRigIdentity1',
  'js/drunk-locomotion.js?v=20261117hRigDrunk1',
  'js/drunk-prone-composition-bridge.js?v=20261119h8e395a6',
  'config/weapon-trust-visits.js?v=20261109hpahugift1',
  'js/weapon-trust-bandit-loadouts.js?v=20261127rootledootRigFey13',
  'js/bandit-captain-armaments.js?v=20261127rootAnatomyRevert16',
  'js/wilderness-encounter-runtime.js?v=20261127rootCorsCrystalParity11',
  'js/rootledoot-encounter.js?v=20261127rootAnatomyRevert16',
  'js/combat/ranged-weapon-archetypes.js?v=20261125deepAudit1',
  'tools/enemy-loadout-editor/source-data.js?v=20261127workshopParallel14',
];
// Fetch scripts concurrently without changing their dependency-sensitive execution order.
function createScriptPreloader(doc) {
  const requested = new Set(); // One preload hint per absolute URL, including nested hand/rig chains.
  return (urls) => {
    for (const file of urls) {
      const href = new URL(file, doc.baseURI).href;
      if (requested.has(href)) continue;
      requested.add(href);
      const link = doc.createElement('link');
      link.rel = 'preload';
      link.as = 'script';
      link.href = href;
      doc.head.append(link);
    }
  };
}
function loadRuntimeScript(file, doc = document) {
  return new Promise((resolve, reject) => {
    const script = doc.createElement('script');
    script.src = new URL(file, doc.baseURI).href;
    script.onload = resolve;
    script.onerror = () => reject(Error('Runtime module unavailable: ' + file));
    doc.head.append(script);
  });
}
const copy = (value) => JSON.parse(JSON.stringify(value));
export class EnemyPreview {
  constructor(host, log) {
    this.host = host;
    this.log = log;
    this.random = Math.random;
    this.actor = null;
    this.headtakerVictim = null; // Transient random bandit used only during Headtaker attack preview.
    this.headtakerSpawnVersion = 0; // Invalidates asynchronous victim builds when selection, replay or page changes.
    this.headtakerBuildPending = false; // Prevents simultaneous attack spawns from stacking actors.
    this.headtakerSeeking = false; // Suppresses background animation ticks during asynchronous preview scrubbing.
    this.paused = false;
    this.motion = 'idle';
    this.speed = 1;
    this.clock = 0;
    this.attack = null;
    this.textureTasks = [];
    this.frame = 0;
    this.last = 0;
    this.lastRender = 0;
    this.glowPools = [];
    this.lightPoint = new THREE.Vector3();
    this.headUndo = [];
    this.projectPoint = new THREE.Vector3();
    this.lightingMode = 'noon';
    this.startupTimings = {}; // One-shot stage timings visible in mobile diagnostics.
  }
  async timedStartup(name, work) {
    const start = performance.now();
    this.onStartupPhase?.(name);
    try { return await work(); }
    finally {
      const ms = Math.round(performance.now() - start);
      this.startupTimings[name] = ms;
      this.log('Startup · ' + name + ': ' + ms + ' ms');
    }
  }
  async init() {
    const started = performance.now(); // Total elapsed time excludes the initial enemy roll, which is logged separately.
    const abilities = {};
    window.DialogueContent = { init() {} };
    window.Combat = {
      abilities: {
        register: (id, def) => {
          abilities[id] = def;
        },
        get: (id) => abilities[id],
      },
      previewAbilities: abilities,
    };
    const preload = createScriptPreloader(document);
    window.__enemyWorkshopPreloadScripts = preload; // Optional workshop-only hint consumed by the nested runtime loaders.
    const dataFile = files.find(file => file.startsWith('tools/enemy-loadout-editor/source-data.js?'));
    // This adapter only declares functions at evaluation; network reads do not require the rest of the runtime.
    const catalogStarted = performance.now(); // Includes adapter load and independent network requests, overlapping runtime startup.
    const catalogInputs = loadRuntimeScript(dataFile).then(() => window.EnemyLoadoutSourceData.prefetch()).then(inputs => {
      this.startupTimings.catalogDownloads = Math.round(performance.now() - catalogStarted);
      this.log('Startup · catalog downloads (overlapped): '+this.startupTimings.catalogDownloads+' ms');
      return inputs;
    });
    catalogInputs.catch(() => {}); // Preserve the original rejection for the later awaited phase, without an early unhandled rejection.
    preload(files.filter(file => file !== dataFile));
    await this.timedStartup('Runtime scripts', async () => {
      for (const file of files) {
        if (file === dataFile) continue;
        if (file.split('?')[0] === 'js/portrait-breathing.js')
          window.SCRATCHBONES_CONFIG.game.assets.portrait.configBase =
            new URL('config/', document.baseURI).href;
        await loadRuntimeScript(file); // Keep every original global/wrapper initialization dependency.
      }
    });
    window.PerpRotation?.init({
      angleDiff: (target, current) => Math.atan2(Math.sin(target - current), Math.cos(target - current)),
      playerWorldPosition: () => null,
    });
    window.CreatureGenetics?.init({
      clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
      CREATURE_DB: { nazgraku: { defaultSizeClass: 'large' } },
    });
    await this.timedStartup('Hand rig and rules', () => Promise.all([
      window.HobunjiHandRuntimeReady,
      window.HobunjiSpeciesPoseScale?.ready,
      window.HobunjiCharacterDimensions?.ready,
      window.EnemyLoadoutRules.ready,
    ]));
    if (window.EnemyLoadoutRules.status().error)
      throw Error(window.EnemyLoadoutRules.status().error);
    // Preserve the full cosmetics registry and wait until species wrappers are installed, but overlap its downloads with catalog parsing and renderer setup.
    const cosmeticsReady = this.timedStartup('Portrait cosmetics', () => window.NpcAvatarPreview.ensurePortraitCosmetics({
      assetBase: new URL('assets/', document.baseURI).href,
      configBase: new URL('config/', document.baseURI).href,
    }));
    cosmeticsReady.catch(() => {});
    this.data = await this.timedStartup('Catalog data remaining', async () => {
      await catalogInputs;
      return window.EnemyLoadoutSourceData.load();
    });
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#162118');
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 80);
    this.camera.position.set(2, 1.2, 3);
    window.SharedAttackPose.setCameraProvider(() => this.camera);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      stencil: true, // Own-front crystal masks use the same stencil capability as the game color target.
      alpha: false,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    // Match game.js: r128's linear output, NoToneMapping and soft shadows.
    // sRGB output here applied a second conversion and washed out sprite dyes.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.shellMaterial = this.data.makeShellMaterial(THREE);
    this.shellMaterial.uniforms.uThickness.value =
      this.data.outline.shell.thicknessNdc;
    window.PngPlaneOutlineOccluder.init({
      renderer: this.renderer,
      camera: this.camera,
    });
    this.host.append(this.renderer.domElement);
    this.controls = new OrbitControls(
      this.camera,
      this.renderer.domElement,
    );
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 15;
    this.controls.maxPolarAngle = Math.PI * 0.53;
    this.grid = new THREE.GridHelper(12, 24, 0x5a6e4c, 0x344638);
    this.scene.add(this.grid);
    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshBasicMaterial({ color: 0x0b130d }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.012;
    this.scene.add(this.floor);
    this.scene.fog = new THREE.FogExp2(this.scene.background, 0.018);
    this.lights = this.data.makeLighting(THREE, this.scene);
    this.lightingCanvas = document.createElement('canvas');
    this.lightingCanvas.className = 'lighting-overlay';
    this.host.append(this.lightingCanvas);
    this.lightingContext = this.lightingCanvas.getContext('2d');
    this.lightProjection = {
      camera: this.camera,
      lctx: this.lightingContext,
      worldToOverlay: (x, y, z) => {
        const p = this.projectPoint.set(x, y, z).project(this.camera);
        return {
          x: ((p.x + 1) * this.width) / 2,
          y: ((1 - p.y) * this.height) / 2,
          visible: p.z > -1 && p.z < 1,
        };
      },
      getFurnitureLightSources: () =>
        window.FurnitureLightRegistry.list(this.scene).map((light) => {
          light.getWorldPosition(this.lightPoint);
          return {
            x: this.lightPoint.x,
            y: this.lightPoint.y,
            z: this.lightPoint.z,
            distance: light.distance,
            intensity: light.intensity,
            color: {
              r: Math.round(light.color.r * 255),
              g: Math.round(light.color.g * 255),
              b: Math.round(light.color.b * 255),
            },
          };
        }),
    };
    this.setLighting('noon');
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.resize();
    const d = this.data;
    this.items = copy(d.rangedItems);
    for (const [shapeKey, shape] of Object.entries(d.shapes))
      for (const [metalKey, metal] of Object.entries(d.metals))
        if (metal.tier) {
          const key = shapeKey + '_' + metalKey;
          this.items[key] = {
            ...shape,
            shapeKey,
            metalKey,
            sprite: shape.baseSprite,
            label: metal.label + ' ' + shape.label,
            itemKey: key,
          };
        }
    window.ModularWeapons.registerDefinitions(
      this.items,
      d.shapes,
      d.metals,
      Object.keys(d.metals).filter((k) => d.metals[k].tier),
    );
    this.weaponTextures = {};
    this.weaponGeometries = new Map(); // Live modular mesh factory cache, owned by this preview scene.
    this.makeGameWeaponMesh = d.weaponMeshFactory(
      THREE,
      this.items,
      (key) => this.weaponTextures[key],
      this.weaponTextures,
      d.heldObjectRenderOrder,
      (root) => window.PngPlaneOutlineOccluder.markPngPlane(root),
      (itemKey) => this.weaponMetalOptions(itemKey), // The weapon-assembly runtime's recolor options, as in the game.
      () => 0, // Preview weapons are unmastered.
      this.weaponGeometries,
    );
    this.dependencies = {
      rnd: () => this.random(),
      clamp: (n, a, b) => Math.max(a, Math.min(b, n)),
      TILE: 55,
      HELD_SHAPE_DEFS: d.shapes,
      METAL_DEFS: d.metals,
      VERDIGRIS_METAL_KEYS: Object.keys(d.metals).filter(
        (k) => d.metals[k].tier,
      ),
      craftedToolItemKey: (shape, metal) => shape + '_' + metal,
      metalDmgMultiplier: (key) => d.metalDamage(key),
      debugLog: (s) => this.log(s),
      getCurrentArea: () => 'map_dev_arena',
      getActiveScene: () => this.scene,
      getActiveGrid: () => [[{}]],
      getActiveCols: () => 1,
      getActiveRows: () => 1,
      tileSurfaceYInArea: () => 0,
      worldSurfaceY: () => 0,
      getActorWorldY: entity => entity?.avatarRef?.group?.position?.y ?? entity?.halfHeight ?? 0, // Shared attachment reads the live bandit's actual portrait center.
      damageCreature: (entity, amount) => { entity.health = Math.max(0, Number(entity.health || 0) - Math.max(0, Number(amount) || 0)); }, // Preview-only lethal hit; never mutate actual game saves.
      markPngPlane: (root) =>
        window.PngPlaneOutlineOccluder.markPngPlane(root),
      setRangedLoadedVisual: (key, loaded, owner) =>
        this.setWeaponLoaded(
          owner?._banditRangedToolHolder?.children?.[0],
          key,
          loaded,
        ),
      makeToolPlaneMesh: (key) => this.weaponMesh(key),
      makeCharacterGroundShadow: () => {
        const m = new THREE.Mesh(
          new THREE.CircleGeometry(0.28, 32),
          new THREE.MeshBasicMaterial({
            color: 0x050a06,
            transparent: true,
            opacity: 0.45,
            depthWrite: false,
          }),
        );
        m.rotation.x = -Math.PI / 2;
        return m;
      },
      creatureGroundShadowRadii: () => ({ radiusX: 1, radiusZ: 1 }),
      characterGroundShadowSurfaceOffset: () => 0.003,
      qFac: new THREE.Quaternion(),
      qToolYaw: new THREE.Quaternion(),
      qAnim: new THREE.Quaternion(),
      qRoll: new THREE.Quaternion(),
      tUp: new THREE.Vector3(0, 1, 0),
      xAxis: new THREE.Vector3(1, 0, 0),
      zAxis: new THREE.Vector3(0, 0, 1),
      player: { x: 0, y: 0, health: 100 },
      hostileObjects: [],
      TOOL_ITEM_DEFS: this.items,
      getActiveTool: () => 'weapon',
      toolSwingProgress: () => 0,
    };
    window.GameRandom = { random: () => this.random() };
    window.MetalArmorSystem.init({
      METAL_DEFS: d.metals,
      VERDIGRIS_METAL_KEYS: this.dependencies.VERDIGRIS_METAL_KEYS,
      getGearInventory: () => ({ clothingItems: [] }),
    });
    window.Combat.deps = this.dependencies;
    window.DialogueContent.init({ getNpcRecords: () => this.data.npcs });
    window.HarlyaoLichCombat.installWrappers();
    window.BanditCombat.init(this.dependencies);
    window.BanditCaptainArmaments.init(this.dependencies); // Isolated tool catalog; no saved inventory or game loot operations.
    window.WeaponToolStances.init(this.dependencies);
    await this.timedStartup('Weapon stances', () => window.WeaponToolStances.reloadConfig());
    window.ProceduralHandAttachments?.installGameRuntime(
      this.dependencies,
    );
    window.ProceduralHandFrameDriver?.installGameRuntime?.(
      this.dependencies,
    );
    window.RangedWeapons.init?.(this.dependencies);
    window.Combat.applyComboConfig?.(d.attackValues.combo);
    window.Combat.applyQuickAttackConfig?.(d.attackValues.quickAttacks);
    window.Combat.applyChargedBreakerConfig?.(
      d.attackValues.chargedBreaker,
    );
    window.Combat.applyCounterShieldConfig?.(d.attackValues.counterShield);
    window.RangedWeapons.applyConfig?.(d.attackValues.rangedWeapons);
    window.HobunjiRangedWeaponArchetypes?.patchGeneratedDefinitions();
    window.BanditCombat.applyBanditConfig(d.attackValues.bandit);
    if (!Object.hasOwn(this.startupTimings,'Portrait cosmetics')) this.onStartupPhase?.('Portrait cosmetics remaining');
    this.cosmetics = await cosmeticsReady;
    this.startupTimings.total = Math.round(performance.now() - started);
    this.log('Startup · total runtime ready: ' + this.startupTimings.total + ' ms');
    this.animate = this.animate.bind(this);
    this.frame = requestAnimationFrame(this.animate);
    this.log(
      'Workshop ready · actual Bandit / Minion / Lich / Maskbound factories · shared legs, hands and attack poses',
    );
    return this.data;
  }
  resize() {
    if (!this.renderer) return;
    const r = this.host.getBoundingClientRect();
    this.width = Math.max(1, r.width);
    this.height = Math.max(1, r.height);
    this.renderer.setSize(this.width, this.height, false);
    if (this.lightingCanvas) {
      this.lightingCanvas.width = Math.round(
        this.width * this.renderer.getPixelRatio(),
      );
      this.lightingCanvas.height = Math.round(
        this.height * this.renderer.getPixelRatio(),
      );
    }
    this.camera.aspect = r.width / Math.max(1, r.height);
    this.camera.updateProjectionMatrix();
  }
  // The recolor the plain weapon sprite gets, as the weapon-assembly runtime's metalOptions (null for a metal-less weapon).
  weaponMetalOptions(itemKey) {
    const metal = this.items[itemKey]?.metalKey && this.data.metals[this.items[itemKey].metalKey];
    return metal ? { targetHex: metal.hex, verdigrisHex: metal.verdigrisHex || '#3FAF9F', oxidationAmount: 0 } : null;
  }
  weaponMesh(key) {
    const def = this.items[key] || {
      sprite: 'assets/toolsprites/ranged_' + key + '.png',
      metalKey: null,
    };
    const blank = document.createElement('canvas');
    blank.width = blank.height = 2;
    const texture = window.HobunjiSpritePngSurface.makeCanvasTexture(
      THREE,
      blank,
      key,
    );
    // The live game's actual mesh factory owns materials, plane basis, flip,
    // render order and metadata. Only asynchronous asset delivery lives here.
    this.weaponTextures[key] = texture;
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    const group = this.makeGameWeaponMesh(key);
    if (!group) {
      texture.dispose();
      return null;
    }
    const plane = group.userData.toolPlane;
    const metal = this.data.metals[def.metalKey];
    const spritePath = key === 'warhammer_nativeCopper' ? 'assets/toolsprites/warhammer.png' : def.sprite; // The shipped warhammer PNG is an explicit fallback for the named relic holder.
    if (!plane || !spritePath) { // Never display an untextured black plane as a weapon.
      this.log('Missing workshop weapon image definition for ' + key);
      group.visible = false;
      return group;
    }
    let disposed = false;
    texture.addEventListener('dispose', () => {
      disposed = true;
    });
    const load = async (sprite, recolor) => {
      if (recolor)
        return window.ToolMetalRecolor.getRecoloredCanvas(
          window.ModularWeapons.decode(sprite)?sprite:new URL(sprite, document.baseURI).href, // Composed weapon keys are not HTTP image URLs.
          {
            targetHex: metal.hex,
            verdigrisHex: metal.verdigrisHex || '#3FAF9F',
            oxidationAmount: 0,
          },
        );
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () =>
          reject(Error('Sprite unavailable: ' + sprite));
        image.src = new URL(sprite, document.baseURI).href;
      });
    };
    const task = Promise.all([
      load(spritePath, !!metal),
      def.loadedSprite ? load(def.loadedSprite, false) : null,
    ])
      .then(([image, loadedImage]) => {
        if (disposed) return;
        texture.image = image;
        texture.needsUpdate = true;
        if (group.visible === false) group.visible = true; // A successful image load may recover a previously hidden placeholder.
        def._imgW = image.naturalWidth || image.width;
        def._imgH = image.naturalHeight || image.height;
        if(def.modular){
          window.ModularWeapons.fitPlaneGeometry(plane.geometry,image,0.5); // Reuse the live composite's calibrated grip frame.
        }else{
          plane.geometry.dispose();
          plane.geometry = new THREE.PlaneGeometry(0.5,(0.5 * def._imgH) / def._imgW);
        }
        group.userData.unloadedTexture = texture;
        // The game builds a weapon mesh only after its texture has loaded; here the real image arrives after the mesh, so the layered assembly
        // (flail chain and brazier, staff marker recolor and fire) is set up now, against the real sprite, replacing the one made on the blank placeholder.
        const assemblies = window.HobunjiWeaponSpriteAssemblies;
        if (assemblies) {
          assemblies.drop(group);
          assemblies.decorate(group, key, def, { THREE, metalOptions: () => this.weaponMetalOptions(key), masteryLevel: () => 0 });
        }
        if (loadedImage) {
          const loaded = window.HobunjiSpritePngSurface.makeCanvasTexture(
            THREE,
            loadedImage,
            key + '-loaded',
          );
          loaded.minFilter = loaded.magFilter = THREE.NearestFilter;
          group.userData.loadedTexture = loaded;
        }
        this.setWeaponLoaded(group, key, group.userData.loaded !== false);
      })
      .catch((e) => {
        this.log('Weapon ' + key + ': ' + e.message);
        throw e;
      });
    this.textureTasks.push(task);
    return group;
  }
  capture() {
    const canvas = document.createElement('canvas');
    canvas.width = this.renderer.domElement.width;
    canvas.height = this.renderer.domElement.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(this.renderer.domElement, 0, 0);
    ctx.drawImage(this.lightingCanvas, 0, 0);
    return canvas;
  }
  setWeaponLoaded(mesh, key, loaded) {
    if (!mesh || mesh.userData.itemKey !== key) return false;
    mesh.userData.loaded = loaded;
    const texture =
      (loaded && mesh.userData.loadedTexture) ||
      mesh.userData.unloadedTexture;
    if (texture) mesh.userData.toolPlane.material.map = texture;
    return true;
  }
  setLighting(mode) {
    this.lightingMode = mode;
    const hour = mode === 'night' ? 22 : mode === 'sunset' ? 18.5 : 12;
    this.lightingState = window.WeatherFX.lightingStateFor(hour, {
      isRaining: mode === 'storm',
      rainStrength: 3,
    });
    const { ambientLight, sunLight } = this.lights;
    this.data.applyLighting(
      this.scene,
      ambientLight,
      sunLight,
      this.lightingState,
    );
  }
  render() {
    if(!this.hideWeapons||!this.actor)return this.renderScene();
    const holders=[this.actor._banditToolHolder,this.actor._banditRangedToolHolder,this.actor._banditFlaskToolHolder].filter(Boolean); // Inspection only; don't modify animation, pose or combat state.
    const visible=holders.map(holder=>holder.visible);
    try{holders.forEach(holder=>{holder.visible=false;});return this.renderScene();}
    finally{holders.forEach((holder,i)=>{holder.visible=visible[i];});}
  }
  renderScene() {
    const renderer = this.renderer,
      scene = this.scene,
      camera = this.camera;
    const mask = camera.layers.mask;
    renderer.autoClear = true;
    renderer.render(scene, camera);
    renderer.autoClear = false;
    renderer.autoClearColor = false;
    renderer.autoClearDepth = false;
    try {
      window.PngPlaneOutlineOccluder.renderDepth(scene);
      scene.overrideMaterial = this.shellMaterial;
      camera.layers.set(1);
      renderer.render(scene, camera);
    } finally {
      scene.overrideMaterial = null;
      camera.layers.mask = mask;
      renderer.autoClear = true;
      renderer.autoClearColor = true;
      renderer.autoClearDepth = true;
    }
    const ctx = this.lightingContext,
      ratio = renderer.getPixelRatio();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    window.WeatherFX.drawSkyTint(
      ctx,
      this.width,
      this.height,
      this.lightingState,
    );
    window.WeatherFX.drawFurnitureLightMasks(this.lightProjection);
    window.EmissiveLightOrbs?.drawOrbs(
      ctx,
      this.lightProjection,
      window.EmissiveLightOrbs.collect(this.scene),
    ); // Glow circles over this viewport's darkness, as in the game.
  }
  async roll(kind, tier, seed) {
    this.random = window.EnemyLoadoutRules.seedRandom(
      seed + '|' + kind + '|' + tier,
    );
    this.textureTasks = [];
    window.TownMine.restore({
      townValue: Number(document.getElementById('townValue').value) || 0,
    });
    const rollStarted = performance.now(); // Distinguish factory construction from startup and image delivery.
    const next = await window.EnemyLoadoutSourceData.spawn(
      kind,
      tier,
      this.data,
      { seed },
    );
    if (!next)
      throw Error(
        'The ' + kind + ' factory returned no actor. See diagnostics.',
      );
    const builtAt = performance.now();
    await Promise.allSettled(this.textureTasks);
    this.log('Roll · '+kind+': factory '+Math.round(builtAt-rollStarted)+' ms; weapon textures '+Math.round(performance.now()-builtAt)+' ms');
    this.replace(next);
    this.fit();
    return this.snapshot(kind, tier, seed);
  }
  replace(next) {
    this.clearHeadtakerVictim(); // All random victims and attachment effects belong to the previous selected enemy.
    const old = this.actor;
    this.actor = next;
    this.attack = null;
    if (old) this.discard(old,!!next._banditCaptainArmament&&next._banditCaptainArmament.key===old._banditCaptainArmament?.key); // History can rebuild the same unique modular weapon.
    const a = next.avatarRef;
    next.facing = Math.PI / 2;
    next.groupRot = 0;
    next.pngRot = 0;
    a.group.rotation.y = 0;
    if (a.frontPlane) a.frontPlane.rotation.y = Math.PI / 2;
    if (a.backPlane) a.backPlane.rotation.y = -Math.PI / 2;
    if (a.legsPivot) { a.legsPivot.rotation.y = 0; a.syncHandFrame?.(); }
    if (a.riderMount && a.handRigAvatarRoot) {
      window.HobunjiOmgurkuSpecies?.setPreviewFacing(a.handRigAvatarRoot, Math.PI / 2); // The mount heads sideways (+X), so its card reads as a side view instead of edge-on to the camera...
      a.handRigAvatarRoot.userData.omgurkuPreviewBodyYaw = -Math.PI / 2; // ...while the rider keeps facing the camera like every other previewed enemy.
    }
    this.dependencies.hostileObjects = [next];
    window.PngPlaneOutlineOccluder.prune();
  }
  snapshot(kind, tier, seed) {
    const a = this.actor;
    return {
      culturalLoadout: a._weaponTrustCulturalLoadout
        ? copy(a._weaponTrustCulturalLoadout)
        : null,
      context: { townValue: window.TownMine.getTownValue() },
      schema: 'hobunji_enemy_roll.v1',
      kind,
      tier,
      seed,
      roster: copy(a.rosterRecord),
      ruinBackSpikeInfo:a.avatarRef.ruinBackSpikeInfo?copy(a.avatarRef.ruinBackSpikeInfo):null, // Actual torso attachment, not the hammer.
      definition: copy(a.def),
      captainArmament:a._banditCaptainArmament?copy(a._banditCaptainArmament):null, // Preserve the rolled modular weapon when reviewing history.
      rigScale: a.avatarRef.rigScale || null,
      renderedBodyScale: a.avatarRef.group?.scale ? {x:a.avatarRef.group.scale.x,y:a.avatarRef.group.scale.y,z:a.avatarRef.group.scale.z} : null, // Mobile-readable verification of the real body planes' parent scale.
      bodyColor3: a.rosterRecord?.appearance?.bodyColors?.C?.hex || a.avatarRef.profile?.bodyColors?.C?.hex || null, // The same color the generated tomb consumes.
      eyeGlowSources: (a.avatarRef.frontCanvas?.hobunjiPortraitGlows || []).map(glow=>({color:glow.color,radius:glow.radius})), // Mobile report proves the eye mask produced actual emissive masses rather than merely loading the PNG.
      poseOrbitAxes: a.avatarRef.poseOrbitAxes
        ? copy(a.avatarRef.poseOrbitAxes)
        : null,
      mountSpecies: a.rosterRecord.mountSpecies || null,
      lichType: a.lichType || null,
      specialLichId: a.specialLichId || null, // History records the named guardian's identity.
      bossSettings: a._specialBossSettings ? copy(a._specialBossSettings) : null, // Instantiated boss timing and damage values, visible on mobile.
      maskboundTroop: a.maskboundTroop || null,
      thumbnail:
        a.avatarRef.frontCanvas?.toDataURL?.() ||
        a.avatarRef.handRigAvatarRoot?.userData?.sourceCanvas?.toDataURL?.() ||
        null,
    };
  }
  async restore(record) {
    const saved = window.EnemyLoadoutRules.snapshot();
    window.EnemyLoadoutRules.set({ schema: saved.schema, rules: {} });
    try {
      window.TownMine.restore({
        townValue: record.context?.townValue || 0,
      });
      this.textureTasks = [];
      const c = await window.EnemyLoadoutSourceData.spawn(
        record.kind,
        record.tier,
        this.data,
        {
          seed: record.seed,
          preserveRoster: true,
          roster: copy(record.roster),
          rosterOverride: copy(record.roster),
          defOverride: copy(record.definition),
          avatarRigScale: record.rigScale,
          previewCaptainArmament:record.captainArmament?copy(record.captainArmament):null,
        },
      );
      if (!c) throw Error('Saved enemy could not be rebuilt');
      // Restore definitions after class initialization, without re-rolling saved equipment.
      c.def = copy(record.definition);
      c.health=c.maxHealth=c.def.maxHealth;c.stamina=c.maxStamina=c.def.maxStamina; // Avoid multiplying already-final saved Health twice.
      await Promise.all(this.textureTasks);
      this.replace(c);
      this.fit();
    } finally {
      window.EnemyLoadoutRules.set(saved);
    }
  }
  fit() {
    const actor = this.actor,
      a = actor?.avatarRef;
    if (!a) return;
    this.update(0);
    this.scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(a.group);
    if (this.headtakerVictim?.avatarRef?.group) bounds.expandByObject(this.headtakerVictim.avatarRef.group); // Keep both the attacker and generated victim in camera view.
    for (const holder of [
      actor._banditToolHolder,
      actor._banditRangedToolHolder,
      actor._banditFlaskToolHolder,
    ])
      if (holder?.visible) bounds.expandByObject(holder);
    if (bounds.isEmpty()) return;
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = a.rigScale || {x:1,y:1}; // Actual authored rig multiplier on the visible hostile root.
    const speciesBase = this.actor.isSpecialLich ? window.SpecialHarlyaoLiches?.rigScaleFor?.(this.actor.lichType)
      : window.HobunjiCharacterRigScale?.scaleFor?.(a.speciesId,a.gender); // Baseline camera size must be stable when authored body scale changes.
    const referenceX = (Number(speciesBase?.x)||1)/(Number(scale.x)||1); // Relative width for a constant reference camera, not an auto-zoom that hides body changes.
    const referenceY = (Number(speciesBase?.y)||1)/(Number(scale.y)||1); // Relative height for the same comparison.
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) * 0.5);
    const distance =
      Math.max(
        size.y * referenceY / (2 * tan),
        size.x * referenceX / (2 * tan * this.camera.aspect),
        0.8,
      ) *
        1.25 +
      size.z * referenceX * 0.5;
    this.currentFit = { center, distance };
    this.controls.target.copy(center);
    if (this.attack?.id === 'skyfallHeadGrip' && this.headtakerVictim) {
      this.camera.position.set(center.x, center.y + distance * 0.025, center.z + distance); // The two front-facing portraits read straight-on, not from the default three-quarter workshop angle.
    } else {
      this.camera.position.set(center.x + distance * 0.08, center.y + distance * 0.08, center.z + distance);
    }
    this.controls.update();
  }
  view(back) {
    if (!this.currentFit) this.fit();
    if (!this.currentFit) return;
    const { center, distance } = this.currentFit;
    this.controls.target.copy(center);
    this.camera.position.set(
      center.x,
      center.y + distance * 0.06,
      center.z + (back ? -1 : 1) * distance,
    );
    this.controls.update();
  }
  attackOptions() {
    const actor = this.actor;
    if (!actor) return [];
    if (actor.maskboundTroop === 'headtaker') return [{ id: 'skyfallHeadGrip', label: 'Skyfall Head Grip · leap / two tugs / final pull / throw' }];
    const list = Object.entries(actor.def.banditAbilityLoadout || {})
      .filter(([, v]) => v)
      .flatMap(([slot, id]) => {
        const steps = window.Combat.comboData?.[id];
        return steps?.length
          ? steps.map((step, i) => ({
              id: id + ':' + i,
              label:
                slot +
                ' · ' +
                id +
                ' · ' +
                (step.name || 'step ' + (i + 1)),
            }))
          : [{ id, label: slot + ' · ' + id }];
      });
    if (actor.def.rangedWeaponKey)
      list.push({
        id: 'ranged',
        label: 'Ranged · ' + actor.def.rangedWeaponKey,
      });
    if (actor.banditRank === 'flasker')
      list.push({
        id: 'throwFlask',
        label: 'Throw flask · ' + actor.def.banditFlaskLoadout.join(', '),
      });
    if (actor.lichType) {
      const kind = actor.isSpecialLich ? window.SpecialHarlyaoLiches.kindFor(actor.lichType) : 'lich:'+actor.lichType; // Named and ordinary spell toggles are independent.
      const extra=actor.isSpecialLich
        ? actor.lichType==='hronal' ? [{id:'melee',label:'Azgarlu · warhammer melee stance'}]
        : actor.lichType==='tothal' ? [{id:'blizzard',label:'Nanahi · kneeling barrage pose'}]
        : [{id:'plasmCharge',label:'Imlao · plasm charge transformation'}]
        : [];
      return [
        {
          id: 'primary',
          label: actor.lichType + ' · primary spell gesture',
        },
        { id: 'summon', label: 'Summon · casting gesture' },...extra,
      ].filter(entry=>window.EnemyLoadoutRules.ruleFor(kind)?.specialAttacks?.[entry.id] !== false);
    }
    return list;
  }
  clearHeadtakerVictim() {
    this.headtakerSpawnVersion++; // Reject any asynchronous bandit factory result for the previous attack/selection.
    window.MaskboundHeadtaker?.cancel?.(this.actor, 'workshop-reset'); // Restores head bones, contact legs and hand owners before disposing the victim.
    const victim = this.headtakerVictim;
    this.headtakerVictim = null;
    if (victim) this.discard(victim); // Reuses the ordinary actor/tool/portrait GPU disposer.
    if (this.dependencies) this.dependencies.hostileObjects = this.actor ? [this.actor] : [];
    this.headtakerBuildPending = false;
    this.headtakerSeeking = false;
  }

  async playHeadtakerAttack(progress = 0, frozen = false) {
    const attacker = this.actor;
    if (!attacker || attacker.maskboundTroop !== 'headtaker') return;
    this.clearHeadtakerVictim();
    const version = this.headtakerSpawnVersion;
    this.headtakerBuildPending = true;
    this.attack = null; // Never advance a stale timeline while the new victim is loading.
    const ranks = ['grunt', 'lieutenant', 'captain']; // Real BanditCombat rank factories determine gear, anatomy and clothing, not a fixed dummy.
    const kind = 'bandit:' + ranks[Math.floor(Math.random() * ranks.length)];
    const seed = 'headtaker-victim-' + Math.random().toString(36).slice(2) + '-' + Date.now();
    this.log('Generating random ' + kind + ' for the Headtaker grapple preview…'); // Visible progress while the real bandit portrait assets load.
    const previousTextureTasks = this.textureTasks; // Existing selection's asynchronous weapon-image queue must not be overwritten by the victim.
    const victimTextureTasks = []; // Isolated texture tasks for this one randomly spawned bandit.
    this.textureTasks = victimTextureTasks;
    let victim;
    try {
      victim = await window.EnemyLoadoutSourceData.spawn(kind, attacker.banditTier || 0, this.data, { seed });
      await Promise.allSettled(victimTextureTasks);
    } catch (error) {
      if (victim) this.discard(victim);
      if (version === this.headtakerSpawnVersion) {
        this.headtakerBuildPending = false;
        this.log('Headtaker victim spawn failed: ' + (error?.stack || error));
      }
      throw error;
    } finally {
      if (this.textureTasks === victimTextureTasks) this.textureTasks = previousTextureTasks; // Do not clobber another roll's newer queue.
    }
    if (version !== this.headtakerSpawnVersion || this.actor !== attacker) {
      if (victim) this.discard(victim); // A reroll or fast repeated click must not leak a late-built bandit.
      return;
    }
    this.headtakerBuildPending = false;
    if (!victim?.avatarRef?.group) throw Error('Random bandit factory did not return a complete portrait actor');
    this.headtakerVictim = victim;
    this.dependencies.hostileObjects = [attacker, victim]; // The existing shared attach logic owns both actors for this one attack only.
    const tile = this.dependencies.TILE; // Preview world-space coordinates use the same tile conversion as the real humanoid factory.
    attacker.x = -tile * 1.35; attacker.y = 0; attacker.facing = 0;
    attacker.attackCooldownT = 0; attacker.health = attacker.maxHealth || attacker.health;
    attacker._banditLungeHopCurrent = 0;
    attacker.avatarRef.group.position.set(attacker.x / tile, attacker.halfHeight || 0.45, 0);
    attacker.avatarRef.group.visible = true;
    victim.x = 0; victim.y = 0; victim.facing = 0;
    victim.health = victim.maxHealth || victim.health;
    victim.avatarRef.group.position.set(0, victim.halfHeight || 0.45, 0);
    victim.avatarRef.group.visible = true;
    for (const actor of [attacker, victim]) {
      const avatar = actor.avatarRef;
      actor.groupRot = actor.pngRot = -Math.PI / 2; // Both front planes face +Z (toward the workshop camera) in the native bandit +X plane convention.
      avatar.group.rotation.y = -Math.PI / 2;
      if (avatar.frontPlane) avatar.frontPlane.rotation.y = Math.PI / 2;
      if (avatar.backPlane) avatar.backPlane.rotation.y = -Math.PI / 2;
      if (avatar.legsPivot) avatar.legsPivot.rotation.y = 0;
      avatar.syncHandFrame?.();
    }
    if (victim.groundShadow) victim.groundShadow.position.set(0, 0.003, 0);
    if (attacker.groundShadow) attacker.groundShadow.position.set(-1.35, 0.003, 0);
    const tuning = window.MaskboundHeadtaker?.tuning;
    const duration = (tuning?.leapS || 1.15) + (tuning?.reversiblePullS || 1.5) * (tuning?.repetitions || 2)
      + (tuning?.finalPullS || 5) + (tuning?.throwS || 1.3) + 0.15; // Adds the real tick scheduler's final fractional interval.
    this.attack = { id: 'skyfallHeadGrip', elapsed: 0, duration, frozen: false, windup: tuning?.leapS || 1.15, strike: duration - (tuning?.leapS || 1.15), victim };
    this.fit();
    this.log('Headtaker attacking generated ' + kind + ' · ' + (victim.name || 'random bandit'));
    if (progress > 0) {
      // Scrubbing uses the real combat state machine. Wait for the head-only textures before fast-forwarding the lethal pull.
      this.headtakerSeeking = true;
      try {
        const seekTo = Math.min(1, Math.max(0, Number(progress) || 0)) * duration;
        let awaitedPortrait = false; // Only one asynchronous portrait readiness await per seek.
        while (version === this.headtakerSpawnVersion && this.attack?.victim === victim && this.attack.elapsed + 0.0001 < seekTo) {
          this.stepHeadtakerAttack(Math.min(0.05, seekTo - this.attack.elapsed));
          if (!awaitedPortrait && attacker._attachment?.stage === 'attached') {
            awaitedPortrait = true;
            await window.MaskboundHeadtaker?.headArtReady?.(attacker);
          }
        }
      } finally {
        if (version === this.headtakerSpawnVersion) this.headtakerSeeking = false;
      }
    }
    if (version === this.headtakerSpawnVersion && this.attack) this.attack.frozen = !!frozen;
  }

  stepHeadtakerAttack(dt) {
    const attack = this.attack, c = this.actor, victim = this.headtakerVictim;
    if (attack?.id !== 'skyfallHeadGrip' || !c || victim !== attack.victim || !victim) return;
    if (!attack.frozen && dt > 0) {
      window.MaskboundHeadtaker?.update?.(c, dt, victim); // Actual gameplay leap, attachment, 2 tugs, final pull and thrown head.
      attack.elapsed = Math.min(attack.duration, attack.elapsed + dt);
    }
    const tile = this.dependencies.TILE, a = c.avatarRef;
    a.group.position.x = c.x / tile;
    a.group.position.z = c.y / tile;
    // Shared attach already places Y relative to the victim's rendered head. Airborne phases own the usual hop slot.
    if (c._attachment?.stage !== 'attached' && !window.MaskboundHeadtaker?.isDescending?.(c)) a.group.position.y = (c.halfHeight || 0.45) + (c._banditLungeHopCurrent || 0); // During descent, the combat module owns world-space Y up to the exact victim anchor.
    a.legs?.update?.(0, 0, false, null, { combat: true }); // Reapply the external per-foot head-grip targets after the preview's ordinary walk update.
    a.handRigAvatarRoot?.userData?.proceduralHandRig?.applyOwnedPose?.(); // Works without a running game frame scheduler; place hands directly on the bandit's head.
    const t = attack.elapsed, leap = attack.windup;
    const tuning = window.MaskboundHeadtaker?.tuning || {};
    const twoPulls = (tuning.reversiblePullS || 1.5) * (tuning.repetitions || 2); // Shared combat constants own the workshop's phase boundaries.
    const finalPull = tuning.finalPullS || 3; // Matches the actual three-second pitch/stretch before separation.
    const phase = t < leap ? 'SKYFALL' : t < leap + twoPulls ? 'HEAD GRIP · TWO PULLS'
      : t < leap + twoPulls + finalPull ? 'FINAL PULL · NECK PITCH' : 'HEAD THROW';
    this.onTimeline?.(Math.min(1, t / attack.duration), phase);
    if (t >= attack.duration && !attack.frozen && !this.headtakerSeeking) {
      this.attack = null;
      if (this.loop) void this.play('skyfallHeadGrip').catch(e => this.log(e?.stack || String(e)));
      else this.onTimeline?.(1, 'FINISHED · PLAY TO REGENERATE');
    }
  }

  play(id, progress = 0, frozen = false) {
    const c = this.actor;
    if (!c) return;
    if (id === 'skyfallHeadGrip' && c.maskboundTroop === 'headtaker') return this.playHeadtakerAttack(progress, frozen); // A real random bandit receives the full shared grapple.
    this.clearHeadtakerVictim(); // Switching to an ordinary attack cleans the preview-only secondary actor.
    const selection = id;
    const parts = id.split(':');
    id = parts[0];
    const stepIndex = Number(parts[1]) || 0;
    const natural = window.BanditCombat.naturalSwing(c.def);
    let pose = natural.pose,
      anim = natural.anim,
      windup = 0.3,
      strike = 0.25;
    let steps = window.Combat.comboData?.[id];
    let castStep = null;
    let power = 1;
    const shapeSpeed = Number(c.def.weaponShapeStats?.speed) || 1;
    if (id === 'melee') {
      c._specialMode='melee';c._specialHoverTarget=0; // Real hover blend transitions into Azgarlu's melee stance.
      steps=window.Combat.comboData?.swingCombo?.slice?.(0,1) || [];
      anim='chop';windup=.3;strike=.2;
    } else if (id === 'blizzard') {
      c._specialStage={kind:'kneel'};c._specialHoverTarget=0;
      steps=[window.HarlyaoLichCombat.lichCastStep(c,'summon')];anim='thrust';
      windup=Number(c._specialBossSettings?.kneelDurationSeconds)||4.8;strike=.2;
    } else if (id === 'plasmCharge') {
      c._specialStage={kind:'charge',remaining:1};c._specialHoverTarget=1;
      window.SpecialHarlyaoLiches?.applyPlasmSkin?.(c,true); // Reuse the live oil-material transformation.
      steps=[window.HarlyaoLichCombat.lichCastStep(c,'primary')];anim='thrust';windup=.2;strike=.42;
    }
    if (id === 'primary' || id === 'summon') {
      castStep = window.HarlyaoLichCombat.lichCastStep(c, id);
      steps = [castStep];
      anim = 'thrust';
    }
    if (steps?.length) {
      const step = steps[stepIndex % steps.length];
      pose =
        window.Combat.comboStepPose?.(
          id === 'primary' || id === 'summon' || id === 'blizzard' || id === 'plasmCharge' ? 'pokeCombo' : id === 'melee' ? 'swingCombo' : id,
          step,
        ) ||
        step.pose ||
        pose;
      anim = step.anim || anim;
      windup = step.windupS || windup;
      strike = step.strikeS || strike;
      power = pose ? 1 : Number(step.power) || 1;
      if (!castStep) {
        windup /= shapeSpeed;
        strike /= shapeSpeed;
      }
    }
    if(id==='blizzard') {windup=Math.max(0.6,(c._specialBossSettings?.kneelDurationSeconds||4.8)-.2);strike=.2;} // Preview timeline matches the authored kneeling duration, not the short casting gesture.
    const quick = window.Combat.quickAttackData;
    if (quick?.TECHNIQUES?.[id]) {
      pose = quick.quickAttackPose?.();
      anim = 'thrust';
      windup = quick.WINDUP_S / shapeSpeed;
      strike = quick.STRIKE_S / shapeSpeed;
    }
    if (id === 'chargedBreaker') {
      const cb = window.Combat.chargedBreakerData;
      pose = window.Combat.poses.SWEEP_POSE;
      anim = 'sweep';
      windup = cb.holdSecondsForPoseCharge?.(0.85) || 1;
      strike = cb.STRIKE_S / shapeSpeed;
      windup /= shapeSpeed;
    }
    if (id === 'counterShield') {
      pose = window.HeldActionAnimations.counterShield.poses;
      anim = 'sweep';
      windup = 0.2;
      strike = 0.8;
    }
    if (id === 'throwFlask') {
      pose = window.HeldActionAnimations.throwFlask.poses;
      c._banditFlaskActionActive = true;
      const action = window.HeldActionAnimations.throwFlask;
      anim = action.style || 'chop';
      const duration = Math.max(0.2, Number(action.durationS) || 1.04);
      windup = Math.max(
        0.12,
        duration *
          Math.max(
            0.05,
            Math.min(0.95, Number(action.windupFrac) || 0.49),
          ),
      );
      strike = Math.max(0.05, duration - windup);
    } else c._banditFlaskActionActive = false;
    c._rangedMode = id === 'ranged';
    if (id === 'ranged') {
      const def = window.RangedWeapons.config[c.def.rangedWeaponKey];
      pose = def?.firePose || pose;
      anim = 'ranged';
      window.RangedWeapons.setLoaded(c.def.rangedWeaponKey, true, c);
      window.RangedWeapons.beginBanditAction(c, 'fire', {
        x: c.x,
        y: c.y + this.dependencies.TILE,
      });
      windup = c._rangedAction.releaseAtS;
      strike = c._rangedAction.durationS - windup;
    }
    c._banditSwingDirSign = (castStep || steps?.[stepIndex])?.dirSign || 1;
    c._banditSwingPower =
      id === 'chargedBreaker'
        ? window.Combat.chargedBreakerData.POWER || 1.7
        : power;
    c._banditSwingPoseScale = id === 'chargedBreaker' ? 0.85 : 1;
    c._banditSwingAnim = anim;
    c._banditSwingPose = pose;
    c._banditSwingReturnS = 0.35;
    c._banditSwingHoldS = 0.08;
    c._banditAction = { windupS: windup, strikeS: strike, t: 0 };
    const duration =
      id === 'ranged' ? c._rangedAction.durationS : windup + strike + 0.43;
    this.attack = {
      id: selection,
      elapsed: progress * duration,
      duration,
      frozen,
      windup,
      strike,
    };
  }
  animate(now) {
    this.frame = requestAnimationFrame(this.animate);
    if (document.hidden) return;
    if (now - this.lastRender < 1000 / 30) return;
    const dt =
      Math.min(0.1, (now - (this.lastRender || now)) / 1000) * this.speed;
    this.lastRender = now;
    if (!this.paused) {
      this.clock += dt;
      if (this.actor) this.update(dt);
    }
    this.controls.update();
    window.HobunjiWeaponSpriteAssemblies?.tick?.(this.paused ? 0 : dt); // The game ticks this from its frame scheduler's pre-render phase.
    this.headUndo.length = 0;
    window.HobunjiDrunkProneCompositionBridge.prepareBanditSwayForRender(
      this.headUndo,
    );
    try {
      this.render();
    } finally {
      for (let i = this.headUndo.length - 1; i >= 0; i--)
        this.headUndo[i]();
    }
  }
  update(dt) {
    const c = this.actor,
      a = c.avatarRef;
    const move =
      this.motion === 'walk'
        ? c.def.moveSpeed / this.dependencies.TILE
        : this.motion === 'sprint'
          ? c.def.chaseSpeed / this.dependencies.TILE
          : 0;
    const hover = this.motion === 'hover' || (!!c.lichType && (!c.isSpecialLich || c._specialHoverTarget !== 0)); // Named boss hover is not forced while walking or kneeling.
    a.legs?.setHoverMode(hover);
    a.legs?.update(dt, move, false, null, {
      speed: move,
      velocityX: 0,
      velocityZ: move,
      combat: this.motion === 'sprint' || !!this.attack,
      allowSpeedRun: this.motion === 'sprint',
    });
    window.HobunjiOmgurkuSpecies?.setPreviewMotion(
      a.handRigAvatarRoot,
      move,
    );
    window.CreatureGenetics?.applyCreatureBillboardScale?.(a.group, {
      x:c.visualScaleX,y:c.visualScaleY,z:c.visualScaleZ
    },c.scaleY); // Apply the exact gameplay billboard scale to the entire avatar root: portrait planes, pants, hands, and feet together.
    if(c.isSpecialLich) {
      window.SpecialHarlyaoLiches?.tick?.(c,dt); // Reuses authentic boss stance, kneel and drip animation controllers.
      window.SpecialHarlyaoLiches?.updateEffects?.(dt); // One bounded temporary effects tick in the viewport.
    }
    window.HarlyaoLichCombat.updateLichHoverPresentation(c, dt);
    const base = c.halfHeight || 0.45;
    if (!(c.maskboundTroop === 'headtaker' && this.attack?.id === 'skyfallHeadGrip')) {
      a.group.position.y = c.lichType
        ? c.groundLift
        : base + (hover ? 0.45 : 0); // Preserve the held airborne/grip height while the Headtaker preview is frozen or seeking.
    }
    // Headtaker is now driven by the real combat module below (including disappearance and landing),
    // rather than applying a second independent fake jump on top of its actual movement.
    if (move) this.grid.position.z = (this.clock * move) % 0.5;
    if (this.attack?.id === 'skyfallHeadGrip') {
      if (this.headtakerVictim) {
        const target = this.headtakerVictim;
        target.avatarRef.legs?.update?.(dt, 0, false, null, { combat: false }); // Stationary real humanoid with working head rig and costume textures.
        window.CreatureGenetics?.applyCreatureBillboardScale?.(target.avatarRef.group, {
          x: target.visualScaleX, y: target.visualScaleY, z: target.visualScaleZ,
        }, target.scaleY);
        target.avatarRef.group.position.x = target.x / this.dependencies.TILE;
        target.avatarRef.group.position.z = target.y / this.dependencies.TILE;
        target.avatarRef.group.updateWorldMatrix?.(true, true); // Skinning anchors and head-only clone use final world transforms.
      }
      this.stepHeadtakerAttack(this.attack.frozen || this.headtakerSeeking ? 0 : dt);
      window.BanditCombat.updateToolMesh(c);
      return; // Do not run the generic weapon timeline over the attached animation.
    }
    if (this.attack) {
      const attack = this.attack;
      if (!attack.frozen) attack.elapsed += dt;
      if (c._banditAction) c._banditAction.t = attack.elapsed;
      if (c._rangedAction) {
        const action = c._rangedAction;
        action.t = attack.elapsed;
        if (!action.fired && action.t >= action.releaseAtS) {
          action.fired = true;
          if (
            window.RangedWeapons.config[c.def.rangedWeaponKey]
              ?.rangedType !== 'thrown'
          )
            window.RangedWeapons.setLoaded(
              c.def.rangedWeaponKey,
              false,
              c,
            );
        }
      }
      if (attack.id === 'skyfallHeadGrip') {
        const time = attack.elapsed; // A labeled timeline distinguishes the two reversible pulls from the final lethal one.
        const phase = time < 1.15 ? 'SKYFALL' : time < 4.15 ? 'HEAD GRIP · TWO PULLS' : time < 9.15 ? 'FINAL PULL' : 'HEAD THROW';
        this.onTimeline?.(Math.min(1, time / attack.duration), phase);
      } else this.onTimeline?.(
        Math.min(1, attack.elapsed / attack.duration),
        attack.elapsed < attack.windup
          ? 'WINDUP'
          : attack.elapsed < attack.windup + attack.strike
            ? 'STRIKE'
            : 'RECOVER',
      );
      if (attack.elapsed >= attack.duration && !attack.frozen) {
        const id = attack.id;
        this.attack = null;
        c._banditAction = null;
        if (c.isSpecialLich) {
          c._specialStage=null;
          if (id==='plasmCharge') window.SpecialHarlyaoLiches?.applyPlasmSkin?.(c,false);
          if (id==='melee') c._specialMode='magic';
          c._specialHoverTarget=1;
        }
        c._banditFlaskActionActive = false;
        c._rangedMode = false;
        c._rangedAction = null;
        if (this.loop) this.play(id);
        else this.onTimeline?.(0, 'REST');
      }
    }
    if (c.maskboundTroop === 'headtaker') {
      if (c._banditToolHolder) c._banditToolHolder.visible = false; // Workshop only: the game unarms this same troop through its combat module.
      if (a.handRigAvatarRoot?.userData) {
        a.handRigAvatarRoot.userData.proceduralHandToolHolder = null;
        a.handRigAvatarRoot.userData.proceduralHandToolKey = null;
      }
    } else window.BanditCombat.updateToolMesh(c);
    const travelGaze = window.BanditCombat.updateMovementHeadLook(c, dt, move > 0, c.facing);
    if (!travelGaze) window.BanditCombat.restNeckLook(c, dt); // Same idle neck update the game's hostile loop runs; applies the body-yaw counter-turn.
  }
  discard(actor,preserveUniqueKey=false) {
    window.MaskboundHeadtaker?.cancel?.(actor, 'workshop-dispose'); // Clear any temporary rig ownership before freeing GPU objects.
    if(actor?.isSpecialLich) {
      window.SpecialHarlyaoLiches?.applyPlasmSkin?.(actor,false);
      window.SpecialHarlyaoLiches?.releaseWarhammer?.(actor);
      window.SpecialHarlyaoLiches?.clear?.();
    } // Each temporary boss-owned material and particle is disposed before re-rolling.
    // Gameplay caches these maps globally; the workshop owns per-roll textures.
    const textures = new Set();
    for (const holder of [
      actor._banditToolHolder,
      actor._banditRangedToolHolder,
    ])
      for (const child of holder?.children || []) {
        if (child.userData.unloadedTexture)
          textures.add(child.userData.unloadedTexture);
        if (child.userData.loadedTexture)
          textures.add(child.userData.loadedTexture);
      }
    const uniqueKey=actor._banditCaptainArmament?.key; // Workshop-owned modular cache entry.
    if(preserveUniqueKey){actor._captainEnchantmentFx?.dispose?.();actor._captainEnchantmentFx=null;}
    else window.BanditCaptainArmaments?.discard?.(actor);
    window.BanditCombat.discardEntity(actor);
    if(uniqueKey&&!preserveUniqueKey){this.weaponGeometries?.get(uniqueKey)?.dispose?.();this.weaponGeometries?.delete(uniqueKey);delete this.weaponTextures[uniqueKey];}
    for (const texture of textures) texture.dispose();
  }
  dispose() {
    this.clearHeadtakerVictim();
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    if (this.actor) this.discard(this.actor);
    for(const geometry of this.weaponGeometries?.values()||[])geometry.dispose();this.weaponGeometries?.clear();
    this.controls?.dispose();
    this.shellMaterial?.dispose();
    this.renderer?.dispose(); // Page can close before asynchronous startup finishes.
  }
}

import * as ThreeModule from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const THREE = { ...ThreeModule };
window.THREE = THREE;
const files = [
  'config/scratchbones-config.js?v=20261030h3882d51',
  'config/attachment-rig-profiles.js?v=20261028a',
  'config/character-rig-scale-defaults.js?v=20261028a',
  'js/character-rig-scale.js?v=20261028a',
  'js/color-fill.js?v=20261028a',
  'js/portrait-utils.js?v=20261030headMask1',
  'js/portrait-breathing.js?v=20261028a',
  'js/npc-avatar-preview-utils.js?v=20261031he74eb11',
  'js/png-plane-avatar.js?v=20261031hacbff47',
  'js/species-pose-scaling.js?v=20261029maskSlots2',
  'js/character-dimensions.js?v=20261007he86e7d1', // Species heights drive the held weapon's height factor and grip offset, exactly as in the game and Attack Animation Editor.
  'js/transform-dump-utils.js?v=20261017h3ce7f8d',
  'js/rig-transform-dump.js?v=20261029rigdump1',
  'config/portrait-mouth-points.js?v=20261029a',
  'js/furniture-light-registry.js?v=20261028a',
  'js/tool-metal-recolor.js?v=20261028a',
  'js/weapon-layer-effects.js?v=20261030flailmerged2', // Marker-pixel scanning shared with the flail fuel sprites (the guardians' flame headband emitters).
  'js/motif-store.js?v=20261026templepatterns1', // The shared Pattern editor and libraries, so clothing and weapon patterns are authored with the same UI as the game and other tools.
  'js/pattern-library.js?v=20261026hPlayerDefaults5',
  'js/repo-pattern-library.js?v=20261030lichPatterns3',
  'js/pattern-authoring.js?v=20261026templepatterns1',
  'js/furniture-pattern-surfaces.js?v=20261030lichWalls3',
  'js/metal-armor-system.js?v=20261031he182dd9',
  'js/town-mine.js?v=20261028a',
  'js/npc-movement-head-target.js?v=20261028a',
  'js/leg-bones.js?v=20261028a',
  'js/procedural-leg-animation.js?v=20261030h2d6073a',
  'js/procedural-feet-outline-parity.js?v=20261029a',
  'js/png-plane-outline-occluder.js?v=20261029enemyParity1',
  'js/weather-fx.js?v=20261029enemyParity1',
  'js/emissive-light-orbs.js?v=20261029orbs1',
  'js/sprite-recolor.js?v=20261028hspriterecoloraudit2', // Garment tint (pants/clothing dye) needs SpriteRecolor.recolorImageData.
  'js/procedural-mask-patterns.js?v=20261029maskpat1', // Per-wearer procedural glyph patterns for masks.
  'js/clothing-weaving-system.js?v=20261031h39d1dc0', // Garment dye/weave renderer: without it every garment falls back to its plain undyed art (pants never showed their dye).
  'js/npc-wardrobe.js?v=20261030lichWardrobe4', // Applies the live NPC forced-overpass garment policy before the portrait is baked; required for named lich glyphs.
  'config/pants-rigs.js?v=20261028a',
  'js/pants-rig-core.js?v=20261028a',
  'js/pants-garment-renderer.js?v=20261030h4b26b8d',
  'js/perp-rotation.js?v=20261026h7f6f691', // Mounts turn like creature cards (dead-zone facing); without it the Nazgraku card stays edge-on.
  'js/creature-texture-cache.js?v=20261011h0a4170f',
  'js/creature-genetics.js?v=20261029h86f0973', // makeDefaultGenotype: the same coat roll wild Nazgraku get.
  'js/creature-genetics-render.js?v=20261028a',
  'config/modular-weapons.js?v=20261028a',
  'js/modular-weapons.js?v=20261028a',
  'js/held-action-animations.js?v=20261031h7d8c7a0',
  'js/combat/shared-attack-pose.js?v=20261030h12f55f4',
  'js/combat/attack-pose-templates.js?v=20261028a',
  'js/combat/melee-pose-spacing.js?v=20261028a',
  'js/combat/resource-system.js?v=20261028a',
  'js/combat/weapon-shape-stats.js?v=20261028a',
  'js/combat/combat-combo.js?v=20261028a',
  'js/combat/combat-quickattacks.js?v=20261028a',
  'js/combat/combat-charged-breaker.js?v=20261028a',
  'js/combat/combat-counter-shield.js?v=20261028a',
  'js/combat/ranged-weapons.js?v=20261029maskSlots2',
  'js/alchemy-system.js?v=20261028a',
  'js/combat/enemy-loadout-rules.js?v=20261030lichRules3',
  'js/combat/combat-bandit.js?v=20261030lichEyeglow4',
  'js/weapon-tool-stances.js?v=20261030hb3c4ee1',
  'js/combat/enemy-weapon-stances.js?v=20261030hb21f7c7',
  'js/combat/combat-minion.js?v=20261028a',
  'js/combat/combat-maskbound-guardian.js?v=20261029maskSlots2',
  'js/combat/combat-lich.js?v=20261030namedboss2',
  'js/combat/combat-enchantments.js?v=20261031ghoulvar1', // Enchantment definitions and the particle vocabulary, for the Shadowknights' enchanted weapons.
  'js/combat/weapon-enchantment-vfx.js?v=20261031ghoulvar1',
  'js/combat/ghoul-special-variants.js?v=20261031ghoulvar1',
  'js/combat/combat-special-liches.js?v=20261030lichEyeglow5', // Workshop loads the shipped boss runtime, not a copied test implementation.
  'js/player-body-transform-composer.js?v=20261030hff4c1d3',
  'js/drunk-locomotion.js?v=20261029a',
  'js/drunk-prone-composition-bridge.js?v=20261029enemyParity1',
  'config/weapon-trust-visits.js?v=20261028a',
  'js/weapon-trust-bandit-loadouts.js?v=20261028a',
  'js/combat/ranged-weapon-archetypes.js?v=20261028a',
  'tools/enemy-loadout-editor/source-data.js?v=20261030lichSource3',
];
const copy = (value) => JSON.parse(JSON.stringify(value));
export class EnemyPreview {
  constructor(host, log) {
    this.host = host;
    this.log = log;
    this.random = Math.random;
    this.actor = null;
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
  }
  async init() {
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
    for (const file of files) {
      if (file.split('?')[0] === 'js/portrait-breathing.js')
        window.SCRATCHBONES_CONFIG.game.assets.portrait.configBase =
          new URL('config/', document.baseURI).href;
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = new URL(file, document.baseURI).href;
        s.onload = resolve;
        s.onerror = () =>
          reject(Error('Runtime module unavailable: ' + file));
        document.head.append(s);
      });
    }
    window.PerpRotation?.init({
      angleDiff: (target, current) => Math.atan2(Math.sin(target - current), Math.cos(target - current)),
      playerWorldPosition: () => null,
    });
    window.CreatureGenetics?.init({
      clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
      CREATURE_DB: { nazgraku: { defaultSizeClass: 'large' } },
    });
    await window.HobunjiHandRuntimeReady;
    await window.HobunjiSpeciesPoseScale?.ready;
    await window.HobunjiCharacterDimensions?.ready; // Without measured species heights the weapon falls back to the unscaled 0.55 and no grip offset.
    await window.EnemyLoadoutRules.ready;
    if (window.EnemyLoadoutRules.status().error)
      throw Error(window.EnemyLoadoutRules.status().error);
    this.data = await window.EnemyLoadoutSourceData.load();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#162118');
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 80);
    this.camera.position.set(2, 1.2, 3);
    window.SharedAttackPose.setCameraProvider(() => this.camera);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
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
    this.makeGameWeaponMesh = d.weaponMeshFactory(
      THREE,
      this.items,
      (key) => this.weaponTextures[key],
      this.weaponTextures,
      d.heldObjectRenderOrder,
      (root) => window.PngPlaneOutlineOccluder.markPngPlane(root),
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
    window.WeaponToolStances.init(this.dependencies);
    await window.WeaponToolStances.reloadConfig();
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
    this.cosmetics = await window.NpcAvatarPreview.ensurePortraitCosmetics(
      {
        assetBase: new URL('assets/', document.baseURI).href,
        configBase: new URL('config/', document.baseURI).href,
      },
    );
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
          new URL(sprite, document.baseURI).href,
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
        plane.geometry.dispose();
        plane.geometry = new THREE.PlaneGeometry(
          0.5,
          (0.5 * def._imgH) / def._imgW,
        );
        group.userData.unloadedTexture = texture;
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
    await Promise.allSettled(this.textureTasks);
    this.replace(next);
    this.fit();
    return this.snapshot(kind, tier, seed);
  }
  replace(next) {
    const old = this.actor;
    this.actor = next;
    this.attack = null;
    if (old) this.discard(old);
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
      definition: copy(a.def),
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
        },
      );
      if (!c) throw Error('Saved enemy could not be rebuilt');
      // Restore definitions after class initialization, without re-rolling saved equipment.
      c.def = copy(record.definition);
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
    this.camera.position.set(
      center.x + distance * 0.08,
      center.y + distance * 0.08,
      center.z + distance,
    );
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
  play(id, progress = 0, frozen = false) {
    const c = this.actor;
    if (!c) return;
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
    a.group.position.y = c.lichType
      ? c.groundLift
      : base + (hover ? 0.45 : 0);
    if (move) this.grid.position.z = (this.clock * move) % 0.5;
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
      this.onTimeline?.(
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
    window.BanditCombat.updateToolMesh(c);
    const travelGaze = window.BanditCombat.updateMovementHeadLook(c, dt, move > 0, c.facing);
    if (!travelGaze) window.BanditCombat.restNeckLook(c, dt); // Same idle neck update the game's hostile loop runs; applies the body-yaw counter-turn.
  }
  discard(actor) {
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
    window.BanditCombat.discardEntity(actor);
    for (const texture of textures) texture.dispose();
  }
  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    if (this.actor) this.discard(this.actor);
    this.controls.dispose();
    this.shellMaterial.dispose();
    this.renderer.dispose();
  }
}

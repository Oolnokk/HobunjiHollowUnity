import * as ThreeModule from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const THREE = { ...ThreeModule };
window.THREE = THREE;
const files = [
  'config/scratchbones-config.js?v=20261028a',
  'config/attachment-rig-profiles.js?v=20261028a',
  'config/character-rig-scale-defaults.js?v=20261028a',
  'js/character-rig-scale.js?v=20261028a',
  'js/color-fill.js?v=20261028a',
  'js/portrait-utils.js?v=20261028a',
  'js/portrait-breathing.js?v=20261028a',
  'js/npc-avatar-preview-utils.js?v=20261028a',
  'js/png-plane-avatar.js?v=20261028a',
  'js/species-pose-scaling.js?v=20261028a',
  'js/furniture-light-registry.js?v=20261028a',
  'js/tool-metal-recolor.js?v=20261028a',
  'js/metal-armor-system.js?v=20261028a',
  'js/town-mine.js?v=20261028a',
  'js/npc-movement-head-target.js?v=20261028a',
  'js/leg-bones.js?v=20261028a',
  'js/procedural-leg-animation.js?v=20261028a',
  'config/pants-rigs.js?v=20261028a',
  'js/pants-rig-core.js?v=20261028a',
  'js/pants-garment-renderer.js?v=20261028a',
  'js/creature-genetics-render.js?v=20261028a',
  'config/modular-weapons.js?v=20261028a',
  'js/modular-weapons.js?v=20261028a',
  'js/held-action-animations.js?v=20261028a',
  'js/combat/shared-attack-pose.js?v=20261028a',
  'js/combat/attack-pose-templates.js?v=20261028a',
  'js/combat/melee-pose-spacing.js?v=20261028a',
  'js/combat/resource-system.js?v=20261028a',
  'js/combat/weapon-shape-stats.js?v=20261028a',
  'js/combat/combat-combo.js?v=20261028a',
  'js/combat/combat-quickattacks.js?v=20261028a',
  'js/combat/combat-charged-breaker.js?v=20261028a',
  'js/combat/combat-counter-shield.js?v=20261028a',
  'js/combat/ranged-weapons.js?v=20261028a',
  'js/alchemy-system.js?v=20261028a',
  'js/combat/enemy-loadout-rules.js?v=20261028a',
  'js/combat/combat-bandit.js?v=20261028a',
  'js/combat/combat-minion.js?v=20261028a',
  'js/combat/combat-maskbound-guardian.js?v=20261028a',
  'js/combat/combat-lich.js?v=20261028a',
  'config/weapon-trust-visits.js?v=20261028a',
  'js/weapon-trust-bandit-loadouts.js?v=20261028a',
  'js/combat/ranged-weapon-archetypes.js?v=20261028a',
  'tools/enemy-loadout-editor/source-data.js?v=20261028a',
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
        window.SCRATCHBONES_CONFIG.game.assets.portrait.configBase = new URL(
          'config/',
          document.baseURI,
        ).href;
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = new URL(file, document.baseURI).href;
        s.onload = resolve;
        s.onerror = () => reject(Error('Runtime module unavailable: ' + file));
        document.head.append(s);
      });
    }
    await window.HobunjiHandRuntimeReady;
    await window.HobunjiSpeciesPoseScale?.ready;
    await window.EnemyLoadoutRules.ready;
    if (window.EnemyLoadoutRules.status().error)
      throw Error(window.EnemyLoadoutRules.status().error);
    this.data = await window.EnemyLoadoutSourceData.load();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#162118');
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 80);
    this.camera.position.set(2, 1.2, 3);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: false,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.host.append(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
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
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const sun = new THREE.DirectionalLight(0xffe6bd, 0.6);
    sun.position.set(3, 6, 4);
    this.scene.add(sun);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.resize();
    const d = this.data;
    this.items = {};
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
      markPngPlane: () => {},
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
    window.ProceduralHandAttachments?.installGameRuntime(this.dependencies);
    window.ProceduralHandFrameDriver?.installGameRuntime?.(this.dependencies);
    window.RangedWeapons.init?.(this.dependencies);
    window.Combat.applyComboConfig?.(d.attackValues.combo);
    window.Combat.applyQuickAttackConfig?.(d.attackValues.quickAttacks);
    window.Combat.applyChargedBreakerConfig?.(d.attackValues.chargedBreaker);
    window.Combat.applyCounterShieldConfig?.(d.attackValues.counterShield);
    window.RangedWeapons.applyConfig?.(d.attackValues.rangedWeapons);
    window.HobunjiRangedWeaponArchetypes?.patchGeneratedDefinitions();
    window.BanditCombat.applyBanditConfig(d.attackValues.bandit);
    this.cosmetics = await window.NpcAvatarPreview.ensurePortraitCosmetics({
      assetBase: new URL('assets/', document.baseURI).href,
      configBase: new URL('config/', document.baseURI).href,
    });
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
    this.renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
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
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.5),
      window.HobunjiSpritePngSurface.makeMaterial(THREE, texture, key, {
        side: THREE.DoubleSide,
      }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.renderOrder = 8;
    const group = new THREE.Group();
    group.add(plane);
    group.userData.itemKey = key;
    group.userData.toolPlane = plane;
    const metal = this.data.metals[def.metalKey];
    let disposed = false;
    texture.addEventListener('dispose', () => {
      disposed = true;
    });
    const task = window.ToolMetalRecolor.getRecoloredCanvas(
      new URL(def.sprite, document.baseURI).href,
      {
        targetHex: metal?.hex || '#B87333',
        verdigrisHex: metal?.verdigrisHex || '#3FAF9F',
        oxidationAmount: 0,
      },
    )
      .then((canvas) => {
        if (disposed) return;
        texture.image = canvas;
        texture.needsUpdate = true;
        plane.geometry.dispose();
        plane.geometry = new THREE.PlaneGeometry(
          0.5,
          (0.5 * canvas.height) / canvas.width,
        );
      })
      .catch((e) => this.log('Weapon ' + key + ': ' + e.message));
    this.textureTasks.push(task);
    return group;
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
    if (old) window.BanditCombat.discardEntity(old);
    const a = next.avatarRef;
    next.facing = Math.PI / 2;
    next.groupRot = 0;
    next.pngRot = 0;
    a.group.rotation.y = 0;
    if (a.frontPlane) a.frontPlane.rotation.y = Math.PI / 2;
    if (a.backPlane) a.backPlane.rotation.y = -Math.PI / 2;
    if (a.legsPivot) a.legsPivot.rotation.y = 0;
    if (a.frontPlane && a.legs) {
      const leanRoot = new THREE.Group();
      leanRoot.name = 'enemy_workshop_visual_lean';
      a.group.add(leanRoot);
      leanRoot.add(a.frontPlane, a.backPlane);
      next.previewLeanRoot = leanRoot;
    }
    this.dependencies.hostileObjects = [next];
    this.rebuildGlowPools();
  }
  rebuildGlowPools() {
    for (const pool of this.glowPools) {
      this.scene.remove(pool.mesh);
      pool.mesh.geometry.dispose();
      pool.mesh.material.map.dispose();
      pool.mesh.material.dispose();
    }
    this.glowPools = [];
    for (const light of window.FurnitureLightRegistry.list(this.scene)) {
      // Deliberately procedural fake-light footprint, rather than an authored PNG.
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d'),
        rgb = [light.color.r, light.color.g, light.color.b].map((n) =>
          Math.round(n * 255),
        );
      const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      const strength = Math.min(0.7, 0.2 + light.intensity * 0.12);
      gradient.addColorStop(0, `rgba(${rgb},${strength})`);
      gradient.addColorStop(0.35, `rgba(${rgb},${strength * 0.45})`);
      gradient.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
      const texture = new THREE.CanvasTexture(canvas);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.scale.set(light.distance * 2, light.distance * 2, 1);
      mesh.position.y = 0.007;
      this.scene.add(mesh);
      this.glowPools.push({ light, mesh });
    }
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
      mountSpecies: a.rosterRecord.mountSpecies || null,
      lichType: a.lichType || null,
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
      const c = await window.BanditCombat.makeEntity(
        this.data.gang,
        record.kind.startsWith('bandit:') ? record.kind.split(':')[1] : 'grunt',
        record.tier,
        0,
        0,
        {
          rosterOverride: copy(record.roster),
          defOverride: copy(record.definition),
          scene: this.scene,
          avatarRigScale: record.rigScale,
          mountSpecies: record.mountSpecies,
          extra: {
            lichType: record.lichType,
            isHarlyaoLich: !!record.lichType,
            maskboundTroop: record.maskboundTroop,
            enemyLoadoutKind: record.kind,
          },
        },
      );
      if (!c) throw Error('Saved enemy could not be rebuilt');
      if (record.lichType) {
        c.avatarRef.legs?.setHoverMode(true);
        for (const child of c._banditToolHolder?.children || [])
          child.visible = false;
      }
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
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) * 0.5);
    const distance =
      Math.max(
        size.y / (2 * tan),
        size.x / (2 * tan * this.camera.aspect),
        0.8,
      ) *
        1.25 +
      size.z * 0.5;
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
                slot + ' · ' + id + ' · ' + (step.name || 'step ' + (i + 1)),
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
    if (actor.lichType)
      return [
        { id: 'primary', label: actor.lichType + ' · primary spell gesture' },
        { id: 'summon', label: 'Summon · casting gesture' },
      ];
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
    if (id === 'primary' || id === 'summon') {
      steps = window.Combat.comboData?.pokeCombo;
      anim = 'thrust';
    }
    if (steps?.length) {
      const step = steps[stepIndex % steps.length];
      pose =
        window.Combat.comboStepPose?.(
          id === 'primary' || id === 'summon' ? 'pokeCombo' : id,
          step,
        ) ||
        step.pose ||
        pose;
      anim = step.anim || anim;
      windup = step.windupS || windup;
      strike = step.strikeS || strike;
    }
    const quick = window.Combat.quickAttackData;
    if (quick?.TECHNIQUES?.[id]) {
      pose = quick.quickAttackPose?.();
      anim = 'thrust';
      windup = quick.WINDUP_S;
      strike = quick.STRIKE_S;
    }
    if (id === 'chargedBreaker') {
      const cb = window.Combat.chargedBreakerData;
      pose = window.Combat.poses.SWEEP_POSE;
      anim = 'sweep';
      windup = cb.holdSecondsForPoseCharge?.(0.85) || 1;
      strike = cb.STRIKE_S;
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
      anim = 'chop';
    } else c._banditFlaskActionActive = false;
    c._rangedMode = id === 'ranged';
    if (id === 'ranged') {
      const def = window.RangedWeapons.config[c.def.rangedWeaponKey];
      pose = def?.firePose || pose;
      anim = 'ranged';
      c._rangedAction = {
        kind: 'fire',
        t: 0,
        durationS: 1,
        chargeDurationS: 0,
        fired: false,
      };
    }
    c._banditSwingDirSign = steps?.[stepIndex]?.dirSign || 1;
    c._banditSwingPower =
      id === 'chargedBreaker'
        ? window.Combat.chargedBreakerData.POWER || 1.7
        : 1;
    c._banditSwingPoseScale = id === 'chargedBreaker' ? 0.85 : 1;
    c._banditSwingAnim = anim;
    c._banditSwingPose = pose;
    c._banditSwingReturnS = 0.35;
    c._banditSwingHoldS = 0.08;
    c._banditAction = { windupS: windup, strikeS: strike, t: 0 };
    this.attack = {
      id: selection,
      elapsed: progress * (windup + strike + 0.43),
      duration: windup + strike + 0.43,
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
    if (this.actor?.previewLeanRoot && this.actor.previewLean)
      window.NpcMovementHeadTarget.applyHostileRunPitch(
        this.actor.avatarRef,
        this.actor.previewLean,
        this.actor.previewLeanHeading,
        this.headUndo,
      );
    try {
      this.renderer.render(this.scene, this.camera);
    } finally {
      for (let i = this.headUndo.length - 1; i >= 0; i--) this.headUndo[i]();
    }
  }
  update(dt) {
    const c = this.actor,
      a = c.avatarRef;
    const move =
      this.motion === 'walk' ? 1.2 : this.motion === 'sprint' ? 2.6 : 0;
    const hover = this.motion === 'hover' || !!c.lichType;
    a.legs?.setHoverMode(hover);
    a.legs?.update(dt, move, false, null, {
      speed: move,
      velocityX: 0,
      velocityZ: move,
      allowSpeedRun: this.motion === 'sprint',
    });
    window.HobunjiOmgurkuSpecies?.setPreviewMotion(a.handRigAvatarRoot, move);
    c.previewLean = Number(a.legs?.getRunLean?.()) || 0;
    if (c.previewLeanRoot) {
      c.previewLeanHeading =
        Math.PI / 2 -
        (c.facing || 0) -
        (c.def.aimAngleOffset || 0) -
        (a.group.rotation.y || 0);
      this.data.forwardLeanQuaternion(
        c.previewLeanRoot.quaternion,
        c.previewLean,
        c.previewLeanHeading,
      );
    }
    const base = c.halfHeight || 0.45;
    a.group.position.y =
      base + (hover ? 0.45 + Math.sin(this.clock * 2.2) * 0.025 : 0);
    if (move) this.grid.position.z = (this.clock * move) % 0.5;
    if (this.attack) {
      const attack = this.attack;
      if (!attack.frozen) attack.elapsed += dt;
      if (c._banditAction) c._banditAction.t = attack.elapsed;
      if (c._rangedAction) c._rangedAction.t = attack.elapsed;
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
        c._banditFlaskActionActive = false;
        c._rangedMode = false;
        c._rangedAction = null;
        if (this.loop) this.play(id);
        else this.onTimeline?.(0, 'REST');
      }
    }
    window.BanditCombat.updateToolMesh(c);
    for (const pool of this.glowPools) {
      pool.light.getWorldPosition(this.lightPoint);
      pool.mesh.position.x = this.lightPoint.x;
      pool.mesh.position.z = this.lightPoint.z;
    }
    if (a.neckJoint) {
      const yaw = Math.sin(this.clock * 0.7) * 0.08;
      if (a.neckJoint.front) a.neckJoint.front.rotation.y = yaw;
      if (a.neckJoint.back) a.neckJoint.back.rotation.y = yaw;
    }
  }
  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    if (this.actor) window.BanditCombat.discardEntity(this.actor);
    this.controls.dispose();
    this.renderer.dispose();
  }
}

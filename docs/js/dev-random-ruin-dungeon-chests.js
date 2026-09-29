// Dungeon Chests for the Random Test Ruin. Each chest rolls its tier's pool
// from docs/config/loot/loot-pools.json (dungeonChest_tier1..4, authored in
// the loot-shop editor and intentionally empty for now) through the shared
// LootRolling.rollLootPool(), and grants the result with DevSpawner's
// grantLoot dep. Puzzle modules create chests with create(); opening is an
// ordinary nearby world interaction supplied by the owning module.
(() => {
  'use strict';

  const DS = window.DynamicSurfaces;
  const DevSpawner = window.DevSpawner;
  if (!window.THREE || !DS || !DevSpawner) return;

  const TIERS = Object.freeze({
    1:{ name:'Weathered', band:0x6b5a44, glow:0xb8a78a },
    2:{ name:'Iron-bound', band:0x7c858c, glow:0xc9d6df },
    3:{ name:'Gilded', band:0xd4a632, glow:0xffd66a },
    4:{ name:'Ancient', band:0x6fd1c4, glow:0x9ff5ff },
  });
  const LID_OPEN_ANGLE = -1.95;
  const LID_SPEED = 2.4; // Radians per second.

  let deps = null;
  const nativeDevInit = DevSpawner.init;
  DevSpawner.init = function (injectedDeps) {
    deps = injectedDeps;
    return nativeDevInit.call(this, injectedDeps);
  };

  const chests = new Set();
  let haloTexture = null;

  function basic(color) {
    return new THREE.MeshBasicMaterial({ color });
  }

  function halo(color) {
    if (!haloTexture) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
      gradient.addColorStop(0, 'rgba(255,255,255,.95)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 64, 64);
      haloTexture = new THREE.CanvasTexture(canvas);
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map:haloTexture, color, transparent:true, depthWrite:false, fog:false, opacity:.55 }));
    sprite.scale.set(1.1, 1.1, 1);
    sprite.userData.devRuinFootprintIgnore = true;
    return sprite;
  }

  function clampTier(tier) {
    return Math.max(1, Math.min(4, Math.round(Number(tier) || 1)));
  }

  // Builds a chest facing +Z in its own frame; `yaw` turns that face toward
  // wherever the player approaches from.
  function create(options = {}) {
    const tier = clampTier(options.tier);
    const look = TIERS[tier];
    const authored = window.DevRandomRuinFurniturePieces?.solid?.('ruinDungeonChestT' + tier); // docs/config/furniture-authored/ruinDungeonChestT1-4.json
    const group = authored || new THREE.Group();
    group.name = 'dev_ruin_dungeon_chest_' + (options.id || chests.size);
    group.userData.devRuinDungeonChest = true;
    group.userData.interactive3D = true;
    group.userData.devRuinInteractionType = 'dungeonChest';
    let hinge;
    if (authored) hinge = window.DevRandomRuinFurniturePieces.pivotParts(group, ['lid', 'lid_band', 'lock'], new THREE.Vector3(0, .43, -.26), 'hinge');
    else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(.78, .42, .52), basic(0x5a3b22));
    body.position.y = .21;
    const trim = new THREE.Mesh(new THREE.BoxGeometry(.82, .06, .56), basic(look.band));
    trim.position.y = .40;
    const bandL = new THREE.Mesh(new THREE.BoxGeometry(.07, .44, .56), basic(look.band));
    bandL.position.set(-.26, .22, 0);
    const bandR = bandL.clone();
    bandR.position.x = .26;
    hinge = new THREE.Group(); // Pivot on the back edge so the lid swings open away from the player.
    hinge.position.set(0, .43, -.26);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(.8, .16, .54), basic(0x6b4728));
    lid.position.set(0, .08, .27);
    const lidBand = new THREE.Mesh(new THREE.BoxGeometry(.82, .05, .56), basic(look.band));
    lidBand.position.set(0, .16, .27);
    const lock = new THREE.Mesh(new THREE.BoxGeometry(.12, .14, .04), basic(look.glow));
    lock.position.set(0, .02, .55);
    hinge.add(lid, lidBand, lock);
    group.add(body, trim, bandL, bandR, hinge);
    }
    const glow = halo(look.glow);
    glow.position.y = .5;
    group.add(glow);
    group.position.set(Number(options.x) || 0, Number(options.y) || 0, Number(options.z) || 0);
    group.rotation.y = Number(options.yaw) || 0;
    (options.parent || null)?.add?.(group);

    const chest = {
      id:String(options.id || group.name),
      tier,
      tierName:look.name,
      poolId:'dungeonChest_tier' + tier,
      group, hinge, glow,
      opened:false,
      lidAngle:0,
      loot:null,
    };
    chest.control = {
      kind:'dungeonChest', object:group, promptRoot:group, range:1.6, priority:22, claimAction1:true, touchIcon:'🗝️',
      label:() => `Open ${look.name} Dungeon Chest`,
      onPress:() => open(chest),
    };
    chests.add(chest);
    return chest;
  }

  function open(chest) {
    if (!chest || chest.opened) return false;
    chest.opened = true;
    const gained = window.LootRolling?.rollLootPool?.(chest.poolId) || {};
    const parts = deps?.grantLoot?.(gained) || [];
    chest.loot = gained;
    const title = `${chest.tierName} Dungeon Chest`;
    deps?.showToast?.(parts.length ? `${title}: ${parts.join(', ')}` : `${title} — empty (loot pool ${chest.poolId} has no entries yet).`, true);
    window.__farmLog?.(`[random-ruin] opened ${chest.id} tier ${chest.tier}: ${JSON.stringify(gained)}`, 'world');
    return true;
  }

  function inScene(object) {
    for (let node = object; node; node = node.parent) if (node.isScene) return true;
    return false;
  }

  let lastFrame = performance.now();
  DS.addBeforeRenderClient(() => {
    const now = performance.now(), dt = Math.min(.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const pulse = .5 + .5 * Math.sin(now * .003);
    for (const chest of chests) {
      if (!inScene(chest.group)) { chests.delete(chest); continue; }
      if (chest.opened && chest.lidAngle > LID_OPEN_ANGLE) {
        chest.lidAngle = Math.max(LID_OPEN_ANGLE, chest.lidAngle - LID_SPEED * dt);
        chest.hinge.rotation.x = chest.lidAngle;
      }
      chest.glow.material.opacity = chest.opened ? Math.max(0, chest.glow.material.opacity - dt) : .35 + .3 * pulse;
    }
  });

  window.DevRandomRuinDungeonChests = Object.freeze({
    TIERS,
    create,
    open,
    // Controls for chests still unopened; the owning puzzle module merges
    // these into its own interaction list.
    controlsFor:list => (list || []).filter(chest => chest && !chest.opened).map(chest => chest.control),
    snapshot:() => [...chests].map(chest => ({ id:chest.id, tier:chest.tier, opened:chest.opened, loot:chest.loot, x:+chest.group.position.x.toFixed(3), y:+chest.group.position.y.toFixed(3), z:+chest.group.position.z.toFixed(3) })),
  });
})();

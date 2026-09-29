// Random Test Ruin completion loop: blue-fire braziers, the Great Door, the
// boss sanctum and its treasure vault.
//
//  * Braziers: every V50 puzzle-goal pedestal/coffin used to carry a
//    placeholder diamond sprite with a letter on it. Those sprites become
//    stone bowl braziers the player ignites with blue fire, so reaching a
//    puzzle's goal now reads as "done".
//  * Great Door: one huge sealed door set against a room wall somewhere in
//    the dungeon, with a ring of decals (one per brazier) that glow blue as
//    their braziers are lit. Once all are lit the centre decal pulses and
//    the door emits "Just Beyond the Torchlight" as a proximity BGS; the
//    door can then be opened and entered.
//  * Sanctum: a boss arena plus a small vault, built east of the V50 layout
//    in the same ruin grid (floorProjection reserves the tiles through
//    reserve()). A random Harlyao lich waits in the arena; killing it opens
//    the rear door to the vault's three big chests and the ladder out.
//
// Registered as a simple-puzzle composer (js/dev-random-ruin-simple-puzzles.js)
// so it shares that module's group, surfaces, footprints and teardown.
(() => {
  'use strict';

  const SP = window.DevRandomRuinSimplePuzzles;
  const DS = window.DynamicSurfaces;
  if (!window.THREE || !SP?.registerComposer || !DS) return;

  const MAP_ID = 'map_i_dev_random_ruin';
  const BGS_URL = 'assets/audio/music/bgm/bgm_just_beyond_the_torchlight.ogg';
  const FIRE_BRIGHT = '#bfeaff', FIRE_COLOR = '#2f8dff';
  const DECAL_IDLE = 0x39424d, DECAL_LIT = 0x4fb6ff, DECAL_PULSE_LOW = 0x1c5a8f, DECAL_PULSE_HIGH = 0xb8ecff;
  const EXCLUDED_ITEM_LABELS = new Set(['Stone Idol']); // Decorative sunken-centerpiece fallback, not a puzzle goal.
  const BRAZIER_RANGE = 2.6; // Horizontal; reach is really decided by the reticle and the height check below, and a bowl on a pedestal mid-dais is ~2u from its edge.
  const PEDESTAL_HEIGHT_SCALE = .5;
  const cfg = (path, fallback) => window.DevRandomRuinConfig?.get?.(path, fallback) ?? fallback; // docs/config/random-ruin/ruin-config.json; the constants here are the fallbacks.
  const BRAZIER_MAX_RISE = 1.35; // Bowl may sit at most this far above the player's feet: a pedestal still on a raised dais stays out of reach.
  const DOOR_MAX_HEIGHT = 3.4, DOOR_CLEAR_DEPTH = 2.8;
  let DOOR_WIDTH = 3.2; // Refreshed from sanctum.door.width at each build.
  const DOOR_WALL_OFFSET = .46; // Stands clear of the V50 wall's baseboard/moulding runs.
  const BOSS_TIER = 2;
  const BOSS_HEALTH_MULT = 3;
  const BOSS_WAKE_MS = 1400; // Beat between arriving in the arena and the lich rising.
  const FADE_MS = 320;

  // Sanctum layout in tiles (1 tile = 1 world unit), east of the V50 grid.
  const ARENA_W = 14, ARENA_D = 14, PASSAGE_LEN = 2, PASSAGE_W = 2, VAULT_W = 7, VAULT_D = 6;
  const WALL_H = 4.2, WALL_T = .4;

  let deps = null; // Simple-puzzle deps (DevSpawner's), taken from the composer kit.
  window.HarlyaoLichCombat?.allowArea?.(MAP_ID); // The boss is the only lich spawned here; arena confinement otherwise unchanged.

  let s = null; // Per-ruin runtime state.
  let flameTexture = null, runeTexture = null, glowTexture = null;

  // ─── Layout (pure; called by floorProjection before the ruin exists) ───

  // Room sizes from ruin-config.json (sanctum.layout), kept to whole even
  // tiles so the passage and vault centre on a tile line.
  const evenTiles = (value, fallback, min, max) => Math.max(min, Math.min(max, 2 * Math.round((Number(value) || fallback) / 2)));
  function layoutDims() {
    return {
      aw:evenTiles(cfg('sanctum.layout.arenaWidth', ARENA_W), ARENA_W, 10, 30),
      ad:evenTiles(cfg('sanctum.layout.arenaDepth', ARENA_D), ARENA_D, 10, 30),
      vw:evenTiles(cfg('sanctum.layout.vaultWidth', VAULT_W), VAULT_W, 4, 16),
      vd:evenTiles(cfg('sanctum.layout.vaultDepth', VAULT_D), VAULT_D, 4, 16),
    };
  }

  function planLayout(baseCols, baseRows, dims = layoutDims()) {
    const { aw, ad, vw, vd } = dims;
    const rows = Math.max(baseRows, ad + 6);
    const x0 = baseCols + 1;
    const z0 = Math.floor((rows - ad) / 2);
    const zc = z0 + ad / 2; // Whole-tile line the passage and vault centre on.
    const arena = { minX:x0, maxX:x0 + aw, minZ:z0, maxZ:z0 + ad };
    const passage = { minX:arena.maxX, maxX:arena.maxX + PASSAGE_LEN, minZ:zc - PASSAGE_W / 2, maxZ:zc + PASSAGE_W / 2 };
    const vault = { minX:passage.maxX, maxX:passage.maxX + vw, minZ:zc - vd / 2, maxZ:zc + vd / 2 };
    return { cols:vault.maxX + 3, rows, arena, passage, vault, zc };
  }

  function rectTiles(rect, out) {
    for (let c = Math.floor(rect.minX); c < Math.ceil(rect.maxX); c++)
      for (let r = Math.floor(rect.minZ); r < Math.ceil(rect.maxZ); r++) out.add(`${c},${r}`);
  }

  function reserve(baseCols, baseRows) {
    const plan = planLayout(baseCols, baseRows);
    const tiles = new Set();
    rectTiles(plan.arena, tiles); rectTiles(plan.passage, tiles); rectTiles(plan.vault, tiles);
    return { cols:plan.cols, rows:plan.rows, tiles, plan };
  }

  // ─── Shared visuals ────────────────────────────────────────────────────

  function canvasTexture(size, draw) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    draw(canvas.getContext('2d'), size);
    return new THREE.CanvasTexture(canvas);
  }

  function textures() {
    if (!runeTexture) {
      runeTexture = canvasTexture(128, (ctx, n) => {
        ctx.clearRect(0, 0, n, n);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 9; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(n / 2, n / 2, n * .4, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 7;
        ctx.beginPath(); ctx.moveTo(n / 2, n * .2); ctx.lineTo(n / 2, n * .8);
        ctx.moveTo(n * .28, n * .38); ctx.lineTo(n * .72, n * .62);
        ctx.moveTo(n * .72, n * .38); ctx.lineTo(n * .28, n * .62); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(n / 2, n / 2, n * .08, 0, Math.PI * 2); ctx.fill();
      });
      glowTexture = canvasTexture(64, (ctx, n) => {
        const g = ctx.createRadialGradient(n / 2, n / 2, 1, n / 2, n / 2, n / 2 - 1);
        g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, n, n);
      });
      flameTexture = canvasTexture(64, (ctx, n) => {
        const g = ctx.createRadialGradient(n / 2, n * .7, 1, n / 2, n * .55, n * .5);
        g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.35, 'rgba(160,220,255,.9)'); g.addColorStop(1, 'rgba(40,120,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(n / 2, n * .04);
        ctx.quadraticCurveTo(n * .9, n * .6, n / 2, n * .96); ctx.quadraticCurveTo(n * .1, n * .6, n / 2, n * .04); ctx.fill();
      });
    }
    return { rune:runeTexture, glow:glowTexture, flame:flameTexture };
  }

  function glowSprite(color, scale, opacity = .6) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map:textures().glow, color, transparent:true, depthWrite:false, fog:false, opacity, blending:THREE.AdditiveBlending }));
    sprite.scale.set(scale, scale, 1);
    sprite.userData.devRuinFootprintIgnore = true;
    return sprite;
  }

  function stone(kit, geometry, color = 0x808080) {
    return kit.naturalizeStone(new THREE.Mesh(geometry, kit.makeBasic(color)));
  }

  // Blue fire: the game's furniture fire emitter (same one the lich aura
  // uses) plus a flickering flame sprite so it reads even with particles off.
  function createBlueFire(parent, scale = 1) {
    const anchor = new THREE.Group();
    anchor.name = 'dev_ruin_blue_fire';
    anchor.visible = false;
    parent.add(anchor);
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map:textures().flame, color:0xffffff, transparent:true, depthWrite:false, fog:false, blending:THREE.AdditiveBlending }));
    flame.scale.set(.34 * scale, .5 * scale, 1);
    flame.position.y = .2 * scale;
    flame.userData.devRuinFootprintIgnore = true;
    const halo = glowSprite(0x4fb6ff, 1.2 * scale, .5);
    halo.position.y = .2 * scale;
    anchor.add(flame, halo);
    const emitter = window.AuthoredFurniture?.createEmitterVisual?.(anchor, {
      id:'dev_ruin_blue_fire', name:'Ruin Blue Fire', type:'fire', enabled:true,
      position:{ x:0, y:.04, z:0 }, rotation:{ x:0, y:0, z:0 },
      radius:.12 * scale, size:.12 * scale, rate:34, lifetime:.8, speed:.55 * scale, spread:.3, gravity:-.05,
      colorA:FIRE_BRIGHT, colorB:FIRE_COLOR,
    }, 48) || null;
    return { anchor, flame, halo, emitter, lit:false };
  }

  function igniteFire(fire) {
    if (!fire || fire.lit) return;
    fire.lit = true;
    fire.anchor.visible = true;
  }

  function updateFire(fire, now, dt) {
    if (!fire?.lit) return;
    const flicker = .88 + .12 * Math.sin(now * .017 + fire.anchor.id) + .06 * Math.sin(now * .041);
    fire.flame.scale.y = fire.flame.scale.x * 1.45 * flicker;
    fire.halo.material.opacity = .38 + .14 * flicker;
    fire.emitter?.update?.(dt, true, { colorA:FIRE_BRIGHT, colorB:FIRE_COLOR });
  }

  // ─── Braziers on the V50 puzzle goals ──────────────────────────────────

  function stoneBowl(kit) {
    const group = new THREE.Group();
    group.name = 'dev_ruin_blue_brazier_bowl';
    const profile = [[.05, 0], [.12, .02], [.2, .07], [.24, .15], [.22, .16], [.17, .09], [0, .08]].map(([x, y]) => new THREE.Vector2(x, y));
    const bowl = stone(kit, new THREE.LatheGeometry(profile, 18));
    const rim = stone(kit, new THREE.TorusGeometry(.232, .022, 6, 20));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = .155;
    const coals = new THREE.Mesh(new THREE.CircleGeometry(.17, 16), kit.makeBasic(0x141a24));
    coals.rotation.x = -Math.PI / 2;
    coals.position.y = .1;
    group.add(bowl, rim, coals);
    return group;
  }

  function findGoalSprites(root) {
    const out = [];
    root?.traverse?.(object => {
      if (!object?.userData?.isSurfaceItemSprite) return;
      if (EXCLUDED_ITEM_LABELS.has(String(object.userData.itemLabel || ''))) { object.visible = false; return; }
      out.push(object);
    });
    return out;
  }

  function buildBraziers(kit, context) {
    const braziers = [];
    for (const plane of findGoalSprites(context.root)) {
      const parent = plane.parent;
      if (!parent) continue;
      const index = braziers.length; // Also this brazier's decal slot on the Great Door.
      plane.visible = false;
      // V50 pedestals put the bowl out of a short character's reach; halve
      // the pedestal (scaled from its base, so it stays grounded). The bowl's
      // holder undoes the parent scale below, so only its height changes.
      if ((parent.userData?.generatedDisplayType === 'displayPedestal' || parent.userData?.generatedDisplayType === 'stoneCoffin') && !parent.userData.devRuinPedestalHalved) { // Coffin altars too.
        const pedestalScale = Math.max(.2, Math.min(1, cfg('sanctum.pedestalHeightScale', PEDESTAL_HEIGHT_SCALE)));
        parent.scale.y *= pedestalScale;
        parent.userData.devRuinPedestalScale = pedestalScale;
        parent.userData.devRuinPedestalHalved = true;
      }
      const holder = new THREE.Group();
      holder.name = 'dev_ruin_blue_brazier_' + index;
      // The sprite floated .135 above the pedestal cap/coffin lid top.
      holder.position.set(plane.position.x, plane.position.y - .135, plane.position.z);
      parent.add(holder);
      parent.updateWorldMatrix(true, false);
      const worldScale = parent.getWorldScale(new THREE.Vector3());
      holder.scale.set(1 / (worldScale.x || 1), 1 / (worldScale.y || 1), 1 / (worldScale.z || 1)); // V50 content sits under a 2x-horizontal locale root.
      holder.add(stoneBowl(kit));
      const fire = createBlueFire(holder, 1);
      fire.anchor.position.y = .1;
      const brazier = { id:'brazier-' + index, index, label:String(plane.userData.itemLabel || ''), plane, holder, fire, lit:false };
      holder.userData.interactive3D = true;
      holder.userData.devRuinInteractionType = 'blueBrazier';
      brazier.control = {
        kind:'blueBrazier', object:holder, promptRoot:holder, range:cfg('sanctum.brazierRange', BRAZIER_RANGE), priority:21, claimAction1:true, touchIcon:'🔥',
        label:'Ignite Brazier',
        onPress:() => igniteBrazier(brazier),
      };
      braziers.push(brazier);
    }
    return braziers;
  }

  function makeBrazierRecord(id, label, holder, fire, extra = {}) {
    const brazier = { id, index:s.braziers.length, label, holder, fire, lit:false, ...extra };
    holder.userData.interactive3D = true;
    holder.userData.devRuinInteractionType = 'blueBrazier';
    brazier.control = {
      kind:'blueBrazier', object:holder, promptRoot:holder, range:cfg('sanctum.brazierRange', BRAZIER_RANGE), priority:21, claimAction1:true, touchIcon:'🔥',
      label:'Ignite Brazier',
      onPress:() => igniteBrazier(brazier),
    };
    s.braziers.push(brazier);
    return brazier;
  }

  // Safe-path mazes finish at a standing brazier just beyond their exit:
  // through the far doorway, off to one side of the walking line.
  function buildSafePathBraziers(kit) {
    const T = window.DevRandomRuinTileOccupancy;
    const free = (x, z, r) => { const sup = DS.sampleSupport(x, z, { minY:-2, maxY:3 }); return sup && !T?.blocksAt?.(x, z, r) && !T?.solidAt?.(x, z, r) ? sup : null; };
    for (const grid of kit.state?.safeGrids || []) {
      const cells = grid.cells || [];
      if (!cells.length) continue;
      const along = c => grid.axis === 'x' ? c.x : c.z, cross = c => grid.axis === 'x' ? c.z : c.x;
      const alongs = cells.map(along), crosses = cells.map(cross);
      const dir = grid.approachAtMin ? 1 : -1;
      const lastRow = dir > 0 ? Math.max(...alongs) : Math.min(...alongs);
      const mid = (Math.min(...crosses) + Math.max(...crosses)) / 2;
      const at = (a, c) => grid.axis === 'x' ? { x:a, z:c } : { x:c, z:a };
      let spot = null;
      for (let d = 1.6; d <= 5 && !spot; d += .3) {
        const a = lastRow + dir * d;
        const lane = at(a, mid);
        if (!free(lane.x, lane.z, .22)) continue; // Still inside the doorway/wall band.
        for (const side of [1.5, -1.5, 2.1, -2.1]) {
          const p = at(a, mid + side);
          const sup = free(p.x, p.z, .32);
          if (sup) { spot = { ...p, y:Number(sup.y) }; break; }
        }
      }
      if (!spot) { s.rejects.push(`safe-path ${grid.hallId}: no spot for its brazier`); continue; }
      const fire = standingBrazier(kit, kit.group(), spot.x, spot.z, spot.y);
      fire.holder.scale.setScalar(.8);
      makeBrazierRecord('brazier-safepath-' + grid.hallId, 'Safe Path', fire.holder, fire, { safePath:grid.hallId });
      T?.addSolidBox?.('devruin-brazier-safepath-' + grid.hallId, { cx:spot.x, cz:spot.z, halfX:.16, halfZ:.16 }, null, kit.SCOPE);
    }
  }

  function worldPos(object) {
    object.updateWorldMatrix(true, false);
    return object.getWorldPosition(new THREE.Vector3());
  }

  function brazierReachable(kit, brazier) {
    const player = kit.playerWorld();
    if (!player) return false;
    const p = worldPos(brazier.holder);
    const rise = p.y - player.y;
    return rise <= cfg('sanctum.brazierMaxRise', BRAZIER_MAX_RISE) && rise >= -.6;
  }

  function igniteBrazier(brazier) {
    if (!s || !brazier || brazier.lit) return false;
    brazier.lit = true;
    igniteFire(brazier.fire);
    s.litOrder.push(brazier.id);
    const lit = s.braziers.filter(b => b.lit).length, total = s.braziers.length;
    const decal = s.door?.decals?.[brazier.index];
    if (decal) decal.flashUntil = performance.now() + 900;
    deps?.showToast?.(lit < total
      ? `Blue fire takes hold (${lit}/${total}). A seal on the Great Door answers it.`
      : 'The last brazier flares blue — somewhere, the Great Door hums awake.', true);
    window.__farmLog?.(`[random-ruin] brazier ${brazier.id} lit ${lit}/${total}`, 'world');
    if (lit === total) awakenDoor();
    return true;
  }

  // ─── Great Door ────────────────────────────────────────────────────────

  function wallCandidates(context) {
    const out = [];
    context.root?.traverse?.(mesh => {
      if (!mesh?.isMesh || !mesh.userData?.ruinInteriorWall || !mesh.geometry) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const local = mesh.geometry.boundingBox; // js/dev-random-ruin-wall-planes.js rebuilds these planes, so read extents rather than PlaneGeometry parameters.
      if (!local || local.isEmpty()) return;
      mesh.updateWorldMatrix(true, false);
      const center = mesh.getWorldPosition(new THREE.Vector3());
      const scale = mesh.getWorldScale(new THREE.Vector3());
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()));
      normal.y = 0;
      if (normal.lengthSq() < .5) return;
      normal.normalize();
      const alongX = Math.abs(normal.z) > Math.abs(normal.x);
      const width = (local.max.x - local.min.x) * scale.x; // Local X is the run direction; its world length includes the locale's 2x horizontal scale.
      const height = (local.max.y - local.min.y) * scale.y;
      center.copy(local.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
      out.push({ mesh, center, normal, width, height, alongX });
    });
    return out;
  }

  function evaluateDoorSite(kit, context, wall, floorY, doorways, why) {
    if (wall.width < DOOR_WIDTH + .9) { why.narrow++; return null; }
    if (wall.height < 1.8) { why.short++; return null; }
    // Plane winding is not a reliable inward cue after the wall-plane
    // rebuild, so the room side is whichever side has floor right in front.
    const probe = d => { const n = wall.normal.clone().multiplyScalar(d); return DS.sampleSupport(wall.center.x + n.x * .6, wall.center.z + n.z * .6, { minY:floorY - 1.5, maxY:floorY + 1.5 }); };
    const n = probe(1) ? wall.normal.clone() : probe(-1) ? wall.normal.clone().negate() : null;
    if (!n) { why.floor++; return null; }
    const t = new THREE.Vector3(-n.z, 0, n.x);
    const base = wall.center.clone().setY(0);
    const blocks = window.DevRandomRuinTileOccupancy;
    // Try the wall centre, then a little either side, for a clear apron.
    for (const shift of [0, .9, -.9, 1.8, -1.8]) {
      if (Math.abs(shift) + DOOR_WIDTH / 2 + .35 > wall.width / 2) continue;
      const c = base.clone().addScaledVector(t, shift);
      const mid = { x:c.x + n.x * 1.5, z:c.z + n.z * 1.5 };
      const inRoom = (context.meta?.rooms || []).some(room => { const r = kit.roomBounds(context.meta, room); return mid.x > r.minX + .3 && mid.x < r.maxX - .3 && mid.z > r.minZ + .3 && mid.z < r.maxZ - .3; });
      if (!inRoom) { why.hallway = (why.hallway || 0) + 1; continue; }
      let ok = true;
      // From 1u out: the first metre is the door's own footprint, where it
      // replaces any small wall-display prop (see clearDoorFootprint).
      for (let d = 1; d <= DOOR_CLEAR_DEPTH && ok; d += .4) {
        for (let u = -DOOR_WIDTH / 2; u <= DOOR_WIDTH / 2 + 1e-6 && ok; u += DOOR_WIDTH / 4) {
          const x = c.x + n.x * d + t.x * u, z = c.z + n.z * d + t.z * u;
          const support = DS.sampleSupport(x, z, { minY:floorY - .3, maxY:floorY + .3 });
          if (!support || Math.abs(Number(support.y) - floorY) > .06) { ok = false; why.floor++; }
          else if (blocks?.blocksAt?.(x, z, .2)) { ok = false; why.blocked++; }
          else if (blocks?.solidAt?.(x, z, .2)) { ok = false; why.solid++; }
        }
      }
      if (!ok) continue;
      const nearDoor = doorways.some(p => Math.hypot(p.x - c.x, p.z - c.z) < 2.6);
      if (nearDoor) { why.doorway++; continue; }
      const spawn = context.spawn || { x:0, z:0 };
      const ceiling = Number(context.meta?.wallHeight) || 3.6; // Monumental: sized to the ceiling, not to how much of a ruined wall survived.
      return { x:c.x, z:c.z, normal:n.clone(), tangent:t.clone(), wall, spawnDistance:Math.hypot(c.x - spawn.x, c.z - spawn.z), height:Math.min(cfg('sanctum.door.maxHeight', DOOR_MAX_HEIGHT), ceiling - .55) };
    }
    return null;
  }

  function chooseDoorSite(kit, context, rng) {
    const floorY = Number(context.meta?.floorSurfaceY) || 0;
    const doorways = (context.meta?.doorways || []).map((door, index) => kit.doorwayWorld(context.meta, door, index)).filter(Boolean);
    const sites = [], why = { walls:0, narrow:0, short:0, floor:0, blocked:0, solid:0, doorway:0, spawn:0 };
    for (const wall of wallCandidates(context)) {
      why.walls++;
      const site = evaluateDoorSite(kit, context, wall, floorY, doorways, why);
      if (site && site.spawnDistance > 5) sites.push(site); else if (site) why.spawn++;
    }
    s.doorSiteStats = why;
    if (!sites.length) return null;
    // "Somewhere in the dungeon": any clear wall, weighted away from the entrance.
    sites.sort((a, b) => b.spawnDistance - a.spawnDistance);
    const pool = sites.slice(0, Math.max(1, Math.ceil(sites.length * .6)));
    return pool[Math.floor(rng() * pool.length) % pool.length];
  }

  // Door facing +Z in its own frame. Returns the door record; `decalCount`
  // decals ring the centre decal on the face.
  // The Great Door (and its arena twin) is the authored furniture piece
  // docs/config/furniture-authored/ruinGreatDoor.json: frame, sinking leaf,
  // eight brazier seals and a centre seal, all editable in the Furniture
  // Author. Scaled to the chosen door size; seals past decalCount hide.
  function buildAuthoredDoor(kit, parent, decalCount, height, name) {
    const piece = window.DevRandomRuinFurniturePieces?.build?.('ruinGreatDoor');
    if (!piece) return null;
    const data = window.AuthoredFurniture.peek('ruinGreatDoor');
    const leafPart = (data.parts || []).find(part => part.id === 'leaf');
    const authoredW = Number(leafPart?.transform?.sx) + .04 || 3.2, authoredH = Number(leafPart?.transform?.sy) || 3.1;
    const group = new THREE.Group();
    group.name = name;
    piece.scale.set(DOOR_WIDTH / authoredW, height / authoredH, 1);
    group.add(piece);
    const passage = new THREE.Mesh(kit.sharedBoxGeometry(DOOR_WIDTH, height, DOOR_WALL_OFFSET), kit.makeBasic(0x020304));
    passage.position.set(0, height / 2, -.14 - DOOR_WALL_OFFSET / 2); // Dark recess back to the wall once the leaf sinks.
    passage.userData.devRuinFootprintIgnore = true;
    group.add(passage);
    const leafMesh = piece.userData.meshById?.get('leaf');
    const leaf = new THREE.Group(); // Pivot so the sink offset composes with the authored leaf transform.
    leaf.name = name + '_leaf';
    if (leafMesh) { piece.add(leaf); leaf.add(leafMesh); }
    const decalMeshes = piece.userData.authoredDecalMeshes || [];
    const byId = id => decalMeshes.find(mesh => mesh.userData.decalId === id) || null;
    const seals = decalMeshes.filter(mesh => /^seal_\d+$/.test(String(mesh.userData.decalId || ''))).sort((a, b) => Number(a.userData.decalId.slice(5)) - Number(b.userData.decalId.slice(5)));
    // Evenly spaced authored slots for however many braziers this ruin has.
    const used = [];
    for (let i = 0; i < Math.min(decalCount, seals.length); i++) used.push(seals[Math.round(i * seals.length / Math.min(decalCount, seals.length)) % seals.length]);
    seals.forEach(mesh => { mesh.visible = used.includes(mesh); mesh.userData.glowProgress = 0; });
    const center = byId('seal_centre');
    if (center) center.userData.glowProgress = 0;
    parent.add(group);
    return { group, leaf, passage, decals:used.map(mesh => ({ mesh, flashUntil:0 })), center, height, progress:0, authored:piece, dropLocal:authoredH + .05 };
  }

  function buildDoorVisual(kit, parent, decalCount, height, name) {
    const authored = buildAuthoredDoor(kit, parent, decalCount, height, name);
    if (authored) return authored;
    const group = new THREE.Group();
    group.name = name;
    const postW = .36, depth = .42 + DOOR_WALL_OFFSET; // Frame reaches back to the wall it stands against.
    for (const side of [-1, 1]) {
      const post = stone(kit, kit.sharedBoxGeometry(postW, height + .3, depth));
      post.position.set(side * (DOOR_WIDTH / 2 + postW / 2), (height + .3) / 2, -DOOR_WALL_OFFSET / 2);
      group.add(post);
    }
    const lintel = stone(kit, kit.sharedBoxGeometry(DOOR_WIDTH + postW * 2 + .2, .34, depth + .06));
    lintel.position.set(0, height + .3 + .17, -DOOR_WALL_OFFSET / 2);
    group.add(lintel);
    const passage = new THREE.Mesh(kit.sharedBoxGeometry(DOOR_WIDTH, height, DOOR_WALL_OFFSET), kit.makeBasic(0x020304));
    passage.position.set(0, height / 2, -.14 - DOOR_WALL_OFFSET / 2); // Dark recess back to the wall once the leaf sinks.
    passage.userData.devRuinFootprintIgnore = true;
    group.add(passage);
    const leaf = new THREE.Group();
    leaf.name = name + '_leaf';
    const slab = stone(kit, kit.sharedBoxGeometry(DOOR_WIDTH - .04, height, .26), 0x6f6a62);
    slab.position.y = height / 2;
    leaf.add(slab);
    const cy = Math.min(height * .56, 1.75), ringR = Math.min(.86, DOOR_WIDTH * .34);
    const decals = [];
    const tex = textures().rune;
    for (let i = 0; i < decalCount; i++) {
      const a = Math.PI / 2 - (i / Math.max(1, decalCount)) * Math.PI * 2;
      const mat = new THREE.MeshBasicMaterial({ map:tex, color:DECAL_IDLE, transparent:true, depthWrite:false });
      const disc = new THREE.Mesh(new THREE.PlaneGeometry(.3, .3), mat);
      disc.position.set(Math.cos(a) * ringR, cy + Math.sin(a) * ringR, .135);
      disc.userData.devRuinFootprintIgnore = true;
      const glow = glowSprite(DECAL_LIT, .6, 0);
      glow.position.copy(disc.position).setZ(.16);
      leaf.add(disc, glow);
      decals.push({ disc, glow, flashUntil:0 });
    }
    const centerMat = new THREE.MeshBasicMaterial({ map:tex, color:DECAL_IDLE, transparent:true, depthWrite:false });
    const center = new THREE.Mesh(new THREE.PlaneGeometry(.64, .64), centerMat);
    center.position.set(0, cy, .135);
    center.userData.devRuinFootprintIgnore = true;
    const centerGlow = glowSprite(DECAL_LIT, 1.5, 0);
    centerGlow.position.set(0, cy, .17);
    leaf.add(center, centerGlow);
    group.add(leaf);
    parent.add(group);
    return { group, leaf, passage, decals, center, centerGlow, height, progress:0 };
  }

  // Hides V50 wall-display props the door now stands in front of.
  function clearDoorFootprint(context, site) {
    const hidden = [];
    const n = site.normal, t = site.tangent;
    context.root?.traverse?.(object => {
      if (!/wall display/i.test(String(object.userData?.interiorRuinRole || object.userData?.role || '')) || object.visible === false) return;
      const p = worldPos(object);
      const dx = p.x - site.x, dz = p.z - site.z;
      const d = dx * n.x + dz * n.z, u = dx * t.x + dz * t.z;
      if (d > -.2 && d < 1.1 && Math.abs(u) < DOOR_WIDTH / 2 + .6) { object.visible = false; hidden.push(object); }
    });
    return hidden;
  }

  function buildGreatDoor(kit, context, site, decalCount) {
    const floorY = Number(context.meta?.floorSurfaceY) || 0;
    s.hiddenDecor = clearDoorFootprint(context, site);
    const door = buildDoorVisual(kit, kit.group(), decalCount, site.height, 'dev_ruin_great_door');
    const offset = DOOR_WALL_OFFSET;
    door.group.position.set(site.x + site.normal.x * offset, floorY, site.z + site.normal.z * offset);
    door.group.rotation.y = Math.atan2(site.normal.x, site.normal.z);
    door.site = site;
    door.state = 'sealed';
    door.front = { x:site.x + site.normal.x * 1.8, z:site.z + site.normal.z * 1.8 };
    door.group.userData.interactive3D = true;
    door.group.userData.devRuinInteractionType = 'greatDoor';
    window.DevRandomRuinTileOccupancy?.addSolidBox?.('devruin-great-door', {
      cx:door.group.position.x, cz:door.group.position.z, halfX:DOOR_WIDTH / 2 + .36, halfZ:.34, yaw:door.group.rotation.y, // Deep enough to cover any wall-display footprint it replaced.
    }, null, kit.SCOPE);
    door.control = {
      kind:'greatDoor', object:door.group, promptRoot:door.group, range:2.3, priority:24, claimAction1:true, touchIcon:'🚪',
      label:() => door.state === 'sealed' ? `Great Door (Sealed ${s.braziers.filter(b => b.lit).length}/${s.braziers.length})`
        : door.state === 'awake' ? 'Open the Great Door'
        : door.state === 'opening' ? 'The Great Door is opening…'
        : 'Enter the Sanctum',
      onPress:() => pressGreatDoor(),
    };
    return door;
  }

  function awakenDoor() {
    const door = s?.door;
    if (!door || door.state !== 'sealed') return;
    door.state = 'awake';
    door.awakeAt = performance.now();
    if (!s.bgs && window.Music?.registerFurnitureSfxSource) {
      s.bgs = window.Music.registerFurnitureSfxSource(MAP_ID, door.group.position.x, door.group.position.z, { url:BGS_URL, rangeTiles:16, volume:.8 });
    }
  }

  function pressGreatDoor() {
    const door = s?.door;
    if (!door) return;
    if (door.state === 'sealed') {
      const lit = s.braziers.filter(b => b.lit).length;
      deps?.showToast?.(`The Great Door is sealed. ${lit}/${s.braziers.length} of its seals glow — light the blue braziers at the end of each puzzle.`, false);
      return;
    }
    if (door.state === 'awake') {
      door.state = 'opening';
      deps?.showToast?.('The Great Door grinds down into the floor.', true);
      return;
    }
    if (door.state === 'open') enterSanctum();
  }

  function updateDoorVisual(door, now, dt, allLit) {
    if (!door) return;
    if (door.authored) {
      for (const [i, decal] of door.decals.entries()) {
        const lit = door.returnDoor ? true : !!s.braziers[i]?.lit;
        decal.mesh.userData.glowProgress = lit ? 1 : 0;
      }
      if (door.center) door.center.userData.glowProgress = allLit ? 1 : 0;
      window.FurnitureDecalRuntime?.updateGlow?.(door.authored, now);
      for (const decal of door.decals) if (decal.flashUntil > now) decal.mesh.material.color.lerp(new THREE.Color(0xffffff), (decal.flashUntil - now) / 900); // Brief white flash as a seal lights.
    } else for (const [i, decal] of door.decals.entries()) {
      const brazier = door.returnDoor ? null : s.braziers[i];
      const lit = door.returnDoor ? true : !!brazier?.lit;
      const flash = decal.flashUntil > now ? (decal.flashUntil - now) / 900 : 0;
      decal.disc.material.color.setHex(lit ? DECAL_LIT : DECAL_IDLE);
      decal.glow.material.opacity = lit ? .35 + .5 * flash + .08 * Math.sin(now * .004 + i) : 0;
    }
    if (door.authored) { /* Centre seal handled by its authored multi-colour ON glow above. */ }
    else if (allLit) {
      const pulse = .5 + .5 * Math.sin(now * .0045);
      door.center.material.color.lerpColors(new THREE.Color(DECAL_PULSE_LOW), new THREE.Color(DECAL_PULSE_HIGH), pulse);
      door.centerGlow.material.opacity = .3 + .55 * pulse;
      const s2 = 1.2 + .5 * pulse;
      door.centerGlow.scale.set(s2, s2, 1);
    } else {
      door.center.material.color.setHex(DECAL_IDLE);
      door.centerGlow.material.opacity = 0;
    }
    if (door.state === 'opening' || door.state === 'open') {
      door.progress = Math.min(1, door.progress + dt / 2.6);
      const t = door.progress * door.progress * (3 - 2 * door.progress);
      door.leaf.position.y = -t * (door.dropLocal ?? door.height + .05);
      door.leaf.visible = door.progress < .999;
      if (door.progress >= 1 && door.state === 'opening') {
        door.state = 'open';
        deps?.showToast?.('Beyond the Great Door, stairs fall away into blue-lit dark.', true);
      }
    }
  }

  // ─── Sanctum wing ──────────────────────────────────────────────────────

  function addWallBox(kit, root, x, z, w, d, y0) {
    const wall = stone(kit, kit.sharedBoxGeometry(w, WALL_H, d));
    wall.position.set(x, y0 + WALL_H / 2, z);
    wall.name = 'dev_ruin_sanctum_wall';
    root.add(wall);
    s.occluders.push(wall);
    return wall;
  }

  // Walls around `rect`, leaving gaps (in world units along that side) for openings.
  function wallRect(kit, root, rect, y0, gaps = {}) {
    const t = WALL_T;
    const run = (side, from, to, fixed, alongX) => {
      const cuts = (gaps[side] || []).slice().sort((a, b) => a[0] - b[0]);
      let cursor = from;
      for (const [a, b] of cuts.concat([[to, to]])) {
        if (a - cursor > .05) {
          const mid = (cursor + a) / 2, len = a - cursor;
          if (alongX) addWallBox(kit, root, mid, fixed, len, t, y0);
          else addWallBox(kit, root, fixed, mid, t, len, y0);
        }
        cursor = Math.max(cursor, b);
      }
    };
    run('north', rect.minX - t, rect.maxX + t, rect.minZ - t / 2, true);
    run('south', rect.minX - t, rect.maxX + t, rect.maxZ + t / 2, true);
    run('west', rect.minZ, rect.maxZ, rect.minX - t / 2, false);
    run('east', rect.minZ, rect.maxZ, rect.maxX + t / 2, false);
  }

  function floorAndCeiling(kit, root, rect, y0, id) {
    const w = rect.maxX - rect.minX, d = rect.maxZ - rect.minZ, cx = (rect.minX + rect.maxX) / 2, cz = (rect.minZ + rect.maxZ) / 2;
    const floor = stone(kit, kit.sharedBoxGeometry(w, .3, d), 0x77736c);
    floor.position.set(cx, y0 - .15, cz);
    floor.userData.devRuinFootprintIgnore = true;
    const ceiling = stone(kit, kit.sharedBoxGeometry(w + WALL_T * 2, .3, d + WALL_T * 2), 0x5d5a55);
    ceiling.position.set(cx, y0 + WALL_H + .15, cz);
    ceiling.userData.devRuinFootprintIgnore = true;
    root.add(floor, ceiling);
    kit.registerSurface({ id:'devruin-sanctum-floor-' + id, bounds:{ minX:rect.minX, maxX:rect.maxX, minZ:rect.minZ, maxZ:rect.maxZ }, topY:y0, priority:2 });
  }

  function standingBrazier(kit, root, x, z, y0) {
    const holder = new THREE.Group();
    holder.position.set(x, y0, z);
    const shaft = stone(kit, kit.sharedCylinderGeometry ? kit.sharedCylinderGeometry(.12, .18, 1.1, 10) : new THREE.CylinderGeometry(.12, .18, 1.1, 10));
    shaft.position.y = .55;
    const bowl = stoneBowl(kit);
    bowl.scale.setScalar(1.5);
    bowl.position.y = 1.08;
    holder.add(shaft, bowl);
    const fire = createBlueFire(holder, 1.5);
    fire.anchor.position.y = 1.23;
    root.add(holder);
    fire.holder = holder;
    return fire;
  }

  function buildLadder(kit, root, x, z, y0) {
    const ladder = new THREE.Group();
    ladder.name = 'dev_ruin_sanctum_exit_ladder';
    const railGeo = kit.sharedBoxGeometry(.08, WALL_H, .08);
    for (const side of [-1, 1]) {
      const rail = stone(kit, railGeo, 0x6a5a48);
      rail.position.set(0, WALL_H / 2, side * .3);
      ladder.add(rail);
    }
    const rungGeo = kit.sharedBoxGeometry(.06, .06, .6);
    for (let y = .3; y < WALL_H; y += .34) {
      const rung = stone(kit, rungGeo, 0x6a5a48);
      rung.position.set(0, y, 0);
      ladder.add(rung);
    }
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(.9, .9), kit.makeBasic(0x000000, { side:THREE.DoubleSide }));
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set(-.15, WALL_H - .01, 0);
    const daylight = glowSprite(0xfff1c8, 1.1, .45);
    daylight.position.set(-.15, WALL_H - .2, 0);
    ladder.add(shaft, daylight);
    ladder.position.set(x, y0, z);
    root.add(ladder);
    ladder.userData.interactive3D = true;
    ladder.userData.devRuinInteractionType = 'sanctumLadder';
    return ladder;
  }

  function buildSanctum(kit, context, decalCount, rng) {
    const layout = s.layout;
    const y0 = Number(context.meta?.floorSurfaceY) || 0;
    const root = new THREE.Group();
    root.name = 'dev_ruin_sanctum';
    kit.group().add(root);
    const { arena, passage, vault, zc } = layout;
    floorAndCeiling(kit, root, arena, y0, 'arena');
    floorAndCeiling(kit, root, passage, y0, 'passage');
    floorAndCeiling(kit, root, vault, y0, 'vault');
    wallRect(kit, root, arena, y0, { east:[[passage.minZ, passage.maxZ]] });
    addWallBox(kit, root, (passage.minX + passage.maxX) / 2, passage.minZ - WALL_T / 2, passage.maxX - passage.minX, WALL_T, y0);
    addWallBox(kit, root, (passage.minX + passage.maxX) / 2, passage.maxZ + WALL_T / 2, passage.maxX - passage.minX, WALL_T, y0);
    wallRect(kit, root, vault, y0, { west:[[passage.minZ, passage.maxZ]] });

    // Return door on the arena's west wall (faces east, into the arena).
    const returnDoor = buildDoorVisual(kit, root, decalCount, 3.1, 'dev_ruin_sanctum_return_door');
    returnDoor.returnDoor = true;
    returnDoor.group.position.set(arena.minX + DOOR_WALL_OFFSET, y0, zc);
    returnDoor.group.rotation.y = Math.PI / 2;
    returnDoor.leaf.visible = false; // Stands open: the way back to the ruin.
    returnDoor.progress = 1;
    returnDoor.control = {
      kind:'sanctumReturn', object:returnDoor.group, promptRoot:returnDoor.group, range:2.3, priority:20, claimAction1:true, touchIcon:'🚪',
      label:'Return to the Ruin', onPress:() => leaveSanctum(),
    };
    s.entry = { x:arena.minX + 2.1, z:zc };

    // Rear door in the passage: sinks once the boss falls.
    const rear = new THREE.Group();
    rear.name = 'dev_ruin_sanctum_rear_door';
    const px = (passage.minX + passage.maxX) / 2;
    const rearPanel = stone(kit, kit.sharedBoxGeometry(.3, 2.6, PASSAGE_W), 0x5b4a3a);
    rearPanel.position.set(px, y0 + 1.3, zc);
    rearPanel.userData.devRuinFootprintManaged = true;
    const rearLintel = stone(kit, kit.sharedBoxGeometry(.5, WALL_H - 2.6, PASSAGE_W));
    rearLintel.position.set(px, y0 + 2.6 + (WALL_H - 2.6) / 2, zc);
    rear.add(rearPanel, rearLintel);
    root.add(rear);
    s.occluders.push(rearLintel);
    s.rearDoor = { group:rear, panel:rearPanel, open:false, progress:0, closedY:y0 + 1.3 };
    window.DevRandomRuinTileOccupancy?.addSolidBox?.('devruin-sanctum-rear-door', { cx:px, cz:zc, halfX:.2, halfZ:PASSAGE_W / 2 }, () => s?.rearDoor && s.rearDoor.progress < .7, kit.SCOPE);

    // Arena corner braziers, lit when the player arrives.
    s.arenaFires = [
      [arena.minX + 1.4, arena.minZ + 1.4], [arena.maxX - 1.4, arena.minZ + 1.4],
      [arena.minX + 1.4, arena.maxZ - 1.4], [arena.maxX - 1.4, arena.maxZ - 1.4],
    ].map(([x, z]) => standingBrazier(kit, root, x, z, y0));

    // Four stone coffins, two on each long wall, facing the arena centre.
    // Their Harlyao skeletons rise with the lich, and it raises them again.
    const coffinCount = Math.max(0, Math.min(8, Math.round(cfg('sanctum.skeletons.count', 4))));
    const perSide = Math.ceil(coffinCount / 2), span = arena.maxX - arena.minX;
    s.coffins = Array.from({ length:coffinCount }, (_, i) => {
      const north = i % 2 === 0, slot = Math.floor(i / 2);
      const x = arena.minX + span * (slot + 1) / (perSide + 1);
      return buildCoffin(kit, root, x, north ? arena.minZ + 1.1 : arena.maxZ - 1.1, y0, north ? 1 : -1, i);
    });

    // Vault: three big chests along the far wall, ladder out on the east wall.
    const chestsApi = window.DevRandomRuinDungeonChests;
    s.vaultChests = [];
    const chestCount = Math.max(0, Math.min(6, Math.round(cfg('sanctum.vault.chestCount', 3))));
    const vaultDepth = vault.maxZ - vault.minZ;
    for (let i = 0; i < chestCount; i++) {
      const dz = chestCount > 1 ? (i / (chestCount - 1) - .5) * Math.min(vaultDepth - 2, chestCount * 1.4) : 0;
      const chest = chestsApi?.create?.({ id:'sanctum-vault-' + i, parent:root, x:vault.maxX - 1.9, y:y0, z:zc + dz, tier:cfg('sanctum.vault.chestTier', 4), yaw:-Math.PI / 2 });
      if (!chest) continue;
      chest.group.scale.setScalar(cfg('sanctum.vault.chestScale', 1.5));
      chest.control.range = 2;
      s.vaultChests.push(chest);
    }
    s.vaultFires = [standingBrazier(kit, root, vault.minX + 1, vault.minZ + .9, y0), standingBrazier(kit, root, vault.minX + 1, vault.maxZ - .9, y0)];
    const ladder = buildLadder(kit, root, vault.maxX - .18, zc + (VAULT_D / 2 - 1.1), y0);
    s.ladderControl = {
      kind:'sanctumLadder', object:ladder, promptRoot:ladder, range:1.6, priority:22, claimAction1:true, touchIcon:'🪜',
      label:'Climb Out of the Ruin',
      onPress:() => {
        if (window.RuinSites?.completeActiveRuin?.()) return; // Wilderness site: surface somewhere random and spend the entrance.
        deps?.showToast?.('You climb the ladder up into daylight.', true); window.DevRandomRuin?.leave?.();
      },
    };
    s.returnDoor = returnDoor;
    s.sanctumRoot = root;
    window.DevRandomRuinTileOccupancy?.scanSolids?.(root, kit.SCOPE); // Chests, braziers and ladder collide like every other ruin prop.
    const occlusion = window.DevRandomRuin?.getOcclusionMeshes?.();
    if (occlusion) for (const mesh of s.occluders) occlusion.push(mesh); // Camera boom pulls in against sanctum walls exactly like V50 walls.
    s.bossType = pickBossType(rng);
  }

  function buildCoffin(kit, root, x, z, y0, facing, index) {
    const group = new THREE.Group();
    group.name = 'dev_ruin_sanctum_coffin_' + index;
    const body = stone(kit, kit.sharedBoxGeometry(1.5, .62, .8), 0x6d675f);
    body.position.y = .31;
    const plinth = stone(kit, kit.sharedBoxGeometry(1.66, .12, .96), 0x5d5850);
    plinth.position.y = .06;
    const lid = stone(kit, kit.sharedBoxGeometry(1.58, .14, .88), 0x7a746b);
    lid.position.y = .69;
    lid.userData.devRuinFootprintIgnore = true; // Slides off when the skeleton rises; the body/plinth carry the collision.
    group.add(plinth, body, lid);
    group.position.set(x, y0, z);
    root.add(group);
    return { index, group, lid, x, z, facing, open:false, lidT:0, rise:{ x, z:z + facing * .95 } };
  }

  function updateCoffins(dt) {
    for (const coffin of s?.coffins || []) {
      if (!coffin.open || coffin.lidT >= 1) continue;
      coffin.lidT = Math.min(1, coffin.lidT + dt * 1.6);
      coffin.lid.position.set(0, .69 - coffin.lidT * .45, -coffin.facing * coffin.lidT * .75);
      coffin.lid.rotation.x = -coffin.facing * coffin.lidT * .5;
    }
  }

  async function spawnSkeleton(coffin, roster = null, at = null) {
    const tile = deps?.TILE || 64, p = at || coffin.rise;
    const minion = await window.MinionCombat?.makeEntity?.({
      speciesId:'harlyao-skeleton', name:'Harlyao Skeleton', tier:cfg('sanctum.skeletons.tier', 1), x:p.x * tile, y:p.z * tile, zoneId:MAP_ID, weaponMetalKey:'nativeCopper',
      roster:roster || undefined,
      extra:{ homeX:p.x * tile, homeY:p.z * tile, state:'chase', keepCorpseAfterLoot:true, sanctumCoffin:coffin.index }, // Looting leaves the body for the lich to raise.
    });
    if (!minion || !s || deps?.getCurrentArea?.() !== MAP_ID) { disposeActor(minion); return null; }
    deps.hostileObjects?.add?.(minion);
    coffin.skeleton = minion;
    return minion;
  }

  function wakeCoffins() {
    for (const coffin of s.coffins || []) {
      coffin.open = true;
      spawnSkeleton(coffin);
    }
  }

  function deadSkeletons() {
    return (s?.coffins || []).filter(coffin => coffin.skeleton && !(Number(coffin.skeleton.health) > 0) && coffin.skeleton.state === 'corpse' && !coffin.raising); // Settled corpses only; mid-ragdoll bodies are still owned by CreatureDeath.
  }

  // Replaces summoning: the lich raises one of its fallen skeletons where it
  // lies, in the same bones and gear (minus anything the player looted).
  function raiseDead(lich) {
    const dead = deadSkeletons();
    if (!dead.length) return false;
    const coffin = dead.reduce((best, c) => Math.hypot(c.skeleton.x - lich.x, c.skeleton.y - lich.y) < Math.hypot(best.skeleton.x - lich.x, best.skeleton.y - lich.y) ? c : best);
    const corpse = coffin.skeleton, tile = deps?.TILE || 64;
    const at = { x:corpse.x / tile, z:corpse.y / tile };
    const base = corpse.rosterRecord || null;
    const roster = base ? (corpse.corpseLooted ? { ...base, equippedCosmetics:[], cosmeticSlots:{}, appliedDyes:{} } : base) : null;
    coffin.raising = true;
    deps?.corpseObjects?.delete?.(corpse);
    if (deps?.despawnCreature) deps.despawnCreature(corpse); else disposeActor(corpse);
    spawnSkeleton(coffin, roster, at).finally(() => { coffin.raising = false; });
    coffin.raised = (coffin.raised || 0) + 1;
    deps?.showToast?.('The lich raises a fallen skeleton!', false);
    return true;
  }

  function pickBossType(rng) {
    const known = window.HarlyaoLichCombat?.TYPE_ORDER || ['tothal', 'hronal', 'kanthic'];
    const wanted = cfg('sanctum.boss.types', known).filter(type => known.includes(type));
    const types = wanted.length ? wanted : known;
    return types[Math.floor(rng() * types.length) % types.length];
  }

  function fadeThen(callback) {
    const veil = document.createElement('div');
    veil.style.cssText = `position:fixed;inset:0;background:#000;opacity:0;transition:opacity ${FADE_MS}ms;z-index:9999;pointer-events:none`;
    document.body.appendChild(veil);
    void veil.offsetWidth; // Commit opacity 0 so the transition runs.
    veil.style.opacity = '1';
    setTimeout(() => {
      try { callback(); } catch (error) { console.warn('[Random Test Ruin sanctum] transition failed', error); }
      veil.style.opacity = '0';
      setTimeout(() => veil.remove(), FADE_MS + 60);
    }, FADE_MS + 30);
  }

  function teleport(point) {
    window.DevRandomRuin?.setPlayerWorldPoint?.({ x:point.x, z:point.z }, { snapCamera:true, grounded:true });
    deps?._snapCameraTarget?.();
  }

  function enterSanctum() {
    if (!s?.entry) return;
    fadeThen(() => {
      teleport(s.entry);
      for (const fire of s.arenaFires || []) igniteFire(fire);
      s.inSanctum = true;
      if (!s.boss && !s.bossDefeated && !s.bossPending) {
        s.bossPending = true;
        setTimeout(() => spawnBoss(), cfg('sanctum.boss.wakeMs', BOSS_WAKE_MS));
        deps?.showToast?.('Blue flames gutter up around a vast chamber. Something stirs.', true);
      }
    });
  }

  function leaveSanctum() {
    const door = s?.door;
    if (!door) return;
    fadeThen(() => { teleport(door.front); s.inSanctum = false; });
  }

  async function spawnBoss() {
    const combat = window.HarlyaoLichCombat;
    if (!s || s.boss || s.bossDefeated) return;
    if (deps?.getCurrentArea?.() !== MAP_ID || !combat?.makeEntity) { s.bossPending = false; return; }
    combat.allowArea?.(MAP_ID); // Idempotent; covers a lich module that loaded after this one.
    const { arena, zc } = s.layout;
    const x = (arena.minX + arena.maxX) / 2 + 2.5, z = zc;
    const tile = deps.TILE || 64;
    const creature = await combat.makeEntity({ type:s.bossType, tier:cfg('sanctum.boss.tier', BOSS_TIER), x:x * tile, y:z * tile });
    s.bossPending = false;
    if (!creature || !s || deps?.getCurrentArea?.() !== MAP_ID) { creature?.avatarRef?.dispose?.(); return; }
    const max = Math.round((Number(creature.maxHealth) || Number(creature.health) || 100) * cfg('sanctum.boss.healthMult', BOSS_HEALTH_MULT));
    creature.maxHealth = max;
    creature.health = max;
    creature.isRuinSanctumBoss = true;
    creature.lichRaiseDead = { canRaise:() => deadSkeletons().length > 0, raise:lich => raiseDead(lich) }; // Instead of summoning new minions.
    deps.hostileObjects?.add?.(creature);
    s.boss = creature;
    wakeCoffins();
    const label = combat.TYPE_DEFS?.[s.bossType]?.label || 'Lich';
    deps?.showToast?.(`${label} rises from the sanctum floor!`, false);
    window.__farmLog?.(`[random-ruin] sanctum boss ${s.bossType} spawned hp=${max}`, 'world');
  }

  function disposeActor(entity) {
    if (!entity) return;
    deps?.hostileObjects?.delete?.(entity);
    entity.avatarRef?.group?.parent?.remove?.(entity.avatarRef.group);
    entity.groundShadow?.parent?.remove?.(entity.groundShadow);
    entity._banditToolHolder?.parent?.remove?.(entity._banditToolHolder);
    entity._banditRangedToolHolder?.parent?.remove?.(entity._banditRangedToolHolder);
    entity.avatarRef?.dispose?.();
  }

  function updateBoss(now) {
    if (!s?.boss || s.bossDefeated) return;
    const boss = s.boss;
    const dead = !(Number(boss.health) > 0) || boss.dead === true || !deps?.hostileObjects?.has?.(boss);
    if (!dead) return;
    s.bossDefeated = true;
    s.bossDefeatedAt = now;
    for (const minion of boss._lichSummons || []) if (Number(minion?.health) > 0) deps?.damageCreature?.(minion, minion.health, undefined, undefined, 0, {});
    for (const coffin of s.coffins || []) if (Number(coffin.skeleton?.health) > 0) deps?.damageCreature?.(coffin.skeleton, coffin.skeleton.health, undefined, undefined, 0, {}); // Its skeletons fall with it.
    deps?.showToast?.('The lich collapses into ash. Behind it, a stone door grinds open.', true);
    if (s.rearDoor) s.rearDoor.open = true;
  }

  function updateRearDoor(dt) {
    const door = s?.rearDoor;
    if (!door) return;
    const target = door.open ? 1 : 0;
    door.progress += Math.max(-dt * .7, Math.min(dt * .7, target - door.progress));
    const t = door.progress * door.progress * (3 - 2 * door.progress);
    door.panel.position.y = door.closedY - t * 2.62;
    door.panel.visible = door.progress < .999;
  }

  // ─── Composer ──────────────────────────────────────────────────────────

  function build(kit) {
    const context = s.context;
    DOOR_WIDTH = Math.max(2, Math.min(4.5, cfg('sanctum.door.width', 3.2)));
    s.built = true;
    s.braziers = buildBraziers(kit, context);
    if (cfg('sanctum.safePathBraziers', true)) buildSafePathBraziers(kit);
    const site = chooseDoorSite(kit, context, s.rng);
    if (!site) { s.rejects.push('no clear wall for the Great Door'); return; }
    s.door = buildGreatDoor(kit, context, site, s.braziers.length);
    buildSanctum(kit, context, s.braziers.length, s.rng);
    if (!s.braziers.length) awakenDoor(); // A ruin whose puzzles carry no goals leaves the door unsealed.
    kit.recordModulePlacement('greatDoorSanctum', 'room', 'sanctum', { braziers:s.braziers.length, bossType:s.bossType, door:{ x:+site.x.toFixed(2), z:+site.z.toFixed(2) } });
  }

  SP.registerComposer({
    id:'sanctum',
    buildRooms(kit, context, rng, usedRooms, options) {
      s = null;
      deps = kit.deps || deps;
      if (options?.sanctum === false) return;
      s = {
        context, rng, built:false, rejects:[], braziers:[], litOrder:[], occluders:[], door:null, bgs:null,
        layout:reservedLayout(context), // floorProjection reserved these tiles; recover the plan from the live grid size.
        boss:null, bossPending:false, bossDefeated:false, inSanctum:false,
      };
    },
    update(kit, now, dt) {
      if (!s) return;
      deps = kit.deps || deps;
      if (!s.built) { try { build(kit); } catch (error) { s.built = true; s.rejects.push(String(error?.message || error)); console.warn('[Random Test Ruin sanctum] build failed', error); } }
      const allLit = s.braziers.length > 0 && s.braziers.every(b => b.lit) || (s.door && s.door.state !== 'sealed');
      for (const brazier of s.braziers) updateFire(brazier.fire, now, dt);
      for (const fire of s.arenaFires || []) updateFire(fire, now, dt);
      for (const fire of s.vaultFires || []) {
        if (s.bossDefeated) igniteFire(fire);
        updateFire(fire, now, dt);
      }
      updateDoorVisual(s.door, now, dt, allLit);
      updateDoorVisual(s.returnDoor, now, dt, true);
      updateBoss(now);
      updateRearDoor(dt);
      updateCoffins(dt);
    },
    controls(kit) {
      if (!s?.built) return [];
      const out = [];
      for (const brazier of s.braziers) if (!brazier.lit && brazierReachable(kit, brazier)) out.push(brazier.control);
      if (s.door) out.push(s.door.control);
      if (s.returnDoor) out.push(s.returnDoor.control);
      for (const control of window.DevRandomRuinDungeonChests?.controlsFor?.(s.vaultChests) || []) out.push(control);
      if (s.ladderControl) out.push(s.ladderControl);
      return out;
    },
    snapshot() {
      if (!s) return null;
      const p = obj => { if (!obj) return null; const v = worldPos(obj); return { x:+v.x.toFixed(2), y:+v.y.toFixed(2), z:+v.z.toFixed(2) }; };
      return {
        built:s.built, rejects:s.rejects.slice(), doorSiteStats:s.doorSiteStats || null,
        braziers:s.braziers.map(b => ({ id:b.id, label:b.label, lit:b.lit, at:p(b.holder) })),
        door:s.door ? { state:s.door.state, progress:+s.door.progress.toFixed(3), at:p(s.door.group), front:s.door.front, decals:s.door.decals.length } : null,
        bgs:!!s.bgs, layout:s.layout, entry:s.entry || null, bossType:s.bossType || null,
        boss:s.boss ? { id:s.boss.id, health:s.boss.health, maxHealth:s.boss.maxHealth, x:+(s.boss.x / (deps?.TILE || 64)).toFixed(2), z:+(s.boss.y / (deps?.TILE || 64)).toFixed(2) } : null,
        bossDefeated:s.bossDefeated, rearDoor:s.rearDoor ? { open:s.rearDoor.open, progress:+s.rearDoor.progress.toFixed(3) } : null,
        vaultChests:(s.vaultChests || []).map(c => ({ id:c.id, tier:c.tier, opened:c.opened })),
        inSanctum:s.inSanctum,
        coffins:(s.coffins || []).map(c => ({ index:c.index, open:c.open, raised:c.raised || 0, skeleton:c.skeleton ? { health:c.skeleton.health, state:c.skeleton.state || null, looted:!!c.skeleton.corpseLooted, keep:!!c.skeleton.keepCorpseAfterLoot } : null })),
      };
    },
    clear() {
      if (!s) return;
      if (s.bgs) window.Music?.unregisterFurnitureSfxSource?.(s.bgs);
      if (s.boss) { for (const minion of s.boss._lichSummons || []) disposeActor(minion); disposeActor(s.boss); }
      for (const coffin of s.coffins || []) if (coffin.skeleton) { deps?.corpseObjects?.delete?.(coffin.skeleton); disposeActor(coffin.skeleton); }
      const occlusion = window.DevRandomRuin?.getOcclusionMeshes?.();
      if (occlusion) for (const mesh of s.occluders) { const i = occlusion.indexOf(mesh); if (i >= 0) occlusion.splice(i, 1); }
      for (const object of s.hiddenDecor || []) object.visible = true;
      for (const brazier of s.braziers) { const pedestal = brazier.plane?.parent; if (pedestal?.userData?.devRuinPedestalHalved) { pedestal.scale.y /= pedestal.userData.devRuinPedestalScale || PEDESTAL_HEIGHT_SCALE; pedestal.userData.devRuinPedestalHalved = false; } }
      for (const brazier of s.braziers) { brazier.holder.parent?.remove?.(brazier.holder); brazier.fire.emitter?.dispose?.(); if (brazier.plane) brazier.plane.visible = true; }
      s = null;
    },
  });

  // The live grid's size already includes the reserved wing; the V50 base
  // size is recovered by subtracting the wing's fixed width.
  function reservedLayout(context) {
    const cols = Number(context?.cols) || 0, rows = Number(context?.rows) || 0;
    const wing = planLayout(0, rows).cols; // Width the wing adds (base 0).
    return planLayout(cols - wing, rows);
  }

  window.DevRandomRuinSanctum = Object.freeze({
    reserve,
    planLayout,
    igniteAll:() => { for (const brazier of s?.braziers || []) igniteBrazier(brazier); return !!s; }, // Diagnostics.
    enter:() => enterSanctum(),
    debugShove:(entity, dirX, dirZ, speedPxS = 900) => { const t = deps?.TILE || 64; if (!entity) return false; deps?.damageCreature?.(entity, 1, entity.x - dirX * t, entity.y - dirZ * t, speedPxS, {}); return true; }, // Headless tests: a 1-damage hit from the opposite side.
    debugKillSkeleton:index => { const sk = s?.coffins?.[index]?.skeleton; if (!sk || !(sk.health > 0)) return false; deps?.damageCreature?.(sk, sk.health + 999, undefined, undefined, 0, {}); return true; }, // Headless tests.
    leave:() => leaveSanctum(),
    getState:() => s,
  });
})();

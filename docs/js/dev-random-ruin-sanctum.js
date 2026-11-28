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
  const DOOR_SEMITONES = 5; // The unlocked door's version of the track sounds a fourth higher than the combat version.
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
  const INTRO_MS = 3600; // The isolated camera and title hold before the boss enters enemy simulation.
  const INTRO_TITLE_DELAY_MS = 850; // Let the existing camera blend toward the lich before revealing its name.
  const INTRO_TURN_DELAY_MS = 230, INTRO_TURN_MS = 720; // The lich starts turned away, then acknowledges the player just as the .95s zoom settles.
  const INTRO_SHRIEK_MS = INTRO_TURN_DELAY_MS + INTRO_TURN_MS; // Shriek begins the instant the portrait finishes turning.
  const INTRO_ECHO_TAPS = Object.freeze([
    { afterMs:400, volume:.55, pitch:.96 }, { afterMs:870, volume:.32, pitch:.92 },
    { afterMs:1450, volume:.18, pitch:.87 }, { afterMs:2070, volume:.09, pitch:.82 },
  ]); // Deliberately impossible chamber-sized echoes; every repeat uses the existing positional reverb mixer.
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

  function planLayout(baseCols, baseRows, dims = layoutDims(), options = {}) {
    const {aw,ad,vw,vd}=dims;
    const rows=Math.max(baseRows,ad+6);
    const westOf=Number(options.leftOfX); // East-facing V50 vestibules put the physical shaft on the east; keep this endgame-only sanctuary on the unused west.
    const westPlacement=Number.isFinite(westOf)&&westOf>0;
    const x0=westPlacement?Math.floor(westOf-aw-PASSAGE_LEN-vw-5):baseCols+1;
    if(westPlacement&&x0<2)throw new Error('Not enough west-side clearance for the boss sanctum');
    const z0 = Math.floor((rows - ad) / 2);
    const zc = z0 + ad / 2; // Whole-tile line the passage and vault centre on.
    const arena = { minX:x0, maxX:x0 + aw, minZ:z0, maxZ:z0 + ad };
    const passage = { minX:arena.maxX, maxX:arena.maxX + PASSAGE_LEN, minZ:zc - PASSAGE_W / 2, maxZ:zc + PASSAGE_W / 2 };
    const vault = { minX:passage.maxX, maxX:passage.maxX + vw, minZ:zc - vd / 2, maxZ:zc + vd / 2 };
    return {cols:Math.max(baseCols,vault.maxX+3),rows,arena,passage,vault,zc,westPlacement};
  }

  function rectTiles(rect, out) {
    for (let c = Math.floor(rect.minX); c < Math.ceil(rect.maxX); c++)
      for (let r = Math.floor(rect.minZ); r < Math.ceil(rect.maxZ); r++) out.add(`${c},${r}`);
  }

  function reserve(baseCols, baseRows, options = {}) {
    const plan=planLayout(baseCols,baseRows,layoutDims(),options);
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

  // Blue braziers are the player's authored campfire particles recolored by the
  // sanctum palette. Only the decorative glow halo remains a sprite.
  function createBlueFire(parent, scale = 1, palette = null) {
    const anchor = new THREE.Group(); // Owns the one campfire particle visual and the ambient colored halo.
    anchor.name = 'dev_ruin_blue_fire';
    anchor.visible = false;
    parent.add(anchor);
    const halo = glowSprite(palette?.halo ?? 0x4fb6ff, 1.2 * scale, palette?.haloOpacity ?? .5);
    halo.position.y = .2 * scale;
    anchor.add(halo);
    const emitter = window.PersistentGroundFire?.attachCampfireFlame?.(anchor, {
      scale:.87 * scale,rateScale:.9,colorA:palette?.bright ?? FIRE_BRIGHT,colorB:palette?.base ?? FIRE_COLOR,
    }) || null; // One authored campfire_fire recipe, not an independent blue-flame particle system.
    return { anchor, halo, emitter, lit:false };
  }

  // The same stone-bowl brazier the sanctum seals use, scaled up and burning in a
  // lich's colour, for the shaft wings' goal braziers (js/ruin-layer-playable.js and
  // js/ruin-v50-native-floors.js). `color` is the lich's body colour, the same one
  // that tints the named-lich wall glow ('#rrggbb').
  const mixHex = (hex, toward, t) => {
    const parse = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const a = parse(hex), b = parse(toward);
    return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
  };
  function buildLichBrazier({ parent, x, y, z, scale = 2.6, color = '#ff8b3d', name = 'ruin_lich_brazier' } = {}) {
    if (!parent?.add) return null;
    const hex = /^#[0-9a-f]{6}$/i.test(String(color)) ? String(color) : '#ff8b3d';
    const palette = { bright: mixHex(hex, '#ffffff', .62), base: hex, halo: new THREE.Color(hex).getHex(), haloOpacity: .6 };
    const holder = new THREE.Group(); holder.name = name; holder.position.set(x, y, z); parent.add(holder);
    const plinthMaterial = window.ProceduralFurniture?.makePartMaterial?.({ materialTexture:'carved_smooth.png', materialLighting:'unlit', materialFillMode:'never', color:'#7a746b' }) || new THREE.MeshBasicMaterial({ color:0x7a746b });
    const plinthHeight = .55 * Math.min(1.25, scale / 2);
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(.36 * scale / 2, .5 * scale / 2, plinthHeight, 10), plinthMaterial);
    plinth.position.y = plinthHeight / 2; plinth.name = name + '-plinth'; holder.add(plinth);
    const bowl = stoneBowl(null); bowl.scale.setScalar(scale); bowl.position.y = plinthHeight; holder.add(bowl);
    const fire = createBlueFire(holder, scale * .95, palette); // Flame grows with the bowl: it was left at ~60% of the enlarged bowl's size.
    fire.anchor.position.y = plinthHeight + .14 * scale;
    fire.anchor.name = name + '-flame';
    const rim = new THREE.Mesh(new THREE.TorusGeometry(.2 * scale, .018 * scale, 6, 24), new THREE.MeshBasicMaterial({ color:new THREE.Color(hex).getHex(), transparent:true, opacity:.55 }));
    rim.rotation.x = Math.PI / 2; rim.position.y = plinthHeight + .16 * scale; rim.name = name + '-lich-rim'; holder.add(rim); // A thin ring in the lich colour keeps an unlit brazier readable as belonging to that tradition.
    let phase = Math.random() * 6;
    return {
      holder, fire, bowl, color: hex, height: plinthHeight + .24 * scale,
      ignite: () => igniteFire(fire),
      update: dt => { phase += dt * 5; updateFire(fire, performance.now(), dt); rim.material.opacity = fire.lit ? .85 : .5 + .06 * Math.sin(phase); },
      dispose: () => { holder.parent?.remove(holder); holder.traverse(n => { n.geometry?.dispose?.(); }); },
    };
  }

  function igniteFire(fire) {
    if (!fire || fire.lit) return;
    fire.lit = true;
    fire.anchor.visible = true;
    if (fire.lightSource) fire.lightSource.active = true;
    if (fire.ordinaryFire && fire.contact?.userData) fire.contact.userData.fireHazard = true; // A real flame can renew a carried torch. // The same flame now lifts the darkness overlay, not just its 3D particles.
  }

  function extinguishFire(fire) {
    if(!fire)return;
    fire.lit=false;
    if(fire.anchor)fire.anchor.visible=false;
    if(fire.lightSource)fire.lightSource.active=false;
    if(fire.ordinaryFire&&fire.contact?.userData)fire.contact.userData.fireHazard=false;
  }

  function rotateKanthicFires(owner,dt) {
    if(!owner?.inSanctum||owner.context?.theme!=='kanthic'||!owner.arenaFires?.length)return;
    owner.cornerFireClock=(owner.cornerFireClock||0)+Math.max(0,dt);
    const next=Math.floor(owner.cornerFireClock/30)%owner.arenaFires.length; // One active corner, cycling every thirty simulation seconds.
    if(owner.cornerFireIndex===next)return;
    owner.cornerFireIndex=next;
    owner.arenaFires.forEach((fire,i)=>i===next?igniteFire(fire):extinguishFire(fire));
    window.CloudForestFog?.refreshLightingOverlay?.();
  }

  function updateFire(fire, now, dt) {
    if (!fire?.lit) return;
    const flicker = .88 + .12 * Math.sin(now * .017 + fire.anchor.id) + .06 * Math.sin(now * .041);
    fire.halo.material.opacity = .38 + .14 * flicker;
    fire.emitter?.update?.(dt); // Uses the saved authored campfire motion, recolored on creation.
  }

  // ─── Braziers on the V50 puzzle goals ──────────────────────────────────

  const authoredPiece = key => window.DevRandomRuinFurniturePieces?.solid?.(key) || null; // docs/config/furniture-authored/<key>.json; procedural fallback below until loaded.

  function stoneBowl(kit) {
    const authored = authoredPiece('ruinBlueBrazierBowl');
    if (authored) { authored.name = 'dev_ruin_blue_brazier_bowl'; return authored; }
    const group = new THREE.Group();
    group.name = 'dev_ruin_blue_brazier_bowl';
    const profile = [[.05, 0], [.12, .02], [.2, .07], [.24, .15], [.22, .16], [.17, .09], [0, .08]].map(([x, y]) => new THREE.Vector2(x, y));
    const plain = color => new THREE.MeshBasicMaterial({ color }); // Used when no ruin kit exists (wing braziers).
    const bowl = kit ? stone(kit, new THREE.LatheGeometry(profile, 18)) : new THREE.Mesh(new THREE.LatheGeometry(profile, 18), plain(0x808080));
    const rim = kit ? stone(kit, new THREE.TorusGeometry(.232, .022, 6, 20)) : new THREE.Mesh(new THREE.TorusGeometry(.232, .022, 6, 20), plain(0x808080));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = .155;
    const coals = new THREE.Mesh(new THREE.CircleGeometry(.17, 16), kit ? kit.makeBasic(0x141a24) : plain(0x141a24));
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
    window.DevRandomRuinFurniturePieces?.skinDisplays?.(context.root, kit.SCOPE); // Authored pedestal/coffin skins (ruinDisplayPedestal / ruinDisplayCoffin) carry the collision of the V50 meshes they hide.
    for (const plane of findGoalSprites(context.root)) {
      const parent = plane.parent;
      if (!parent) continue;
      if (context.tier) { plane.visible = false; continue; } // Sized ruins (cave/hole/lich) open the Great Door with exactly one brazier per wing; no extra local seal.
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
    if (lit < total) window.RuinInteractionAudio?.progress?.(lit, total); // The last seal's solve motif plays from tryAwakenDoor.
    window.RuinInteractionAudio?.igniteTorch?.();
    deps?.showToast?.(lit < total
      ? `Blue fire takes hold (${lit}/${total}). A seal on the Great Door answers it.`
      : 'The last brazier flares blue — somewhere, the Great Door hums awake.', true);
    window.__farmLog?.(`[random-ruin] brazier ${brazier.id} lit ${lit}/${total}`, 'world');
    if (lit === total && !tryAwakenDoor()) window.RuinInteractionAudio?.progress?.(lit, total); // Seals done but the shaft still binds the door.
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
    const doorways=(context.meta?.doorways||[]).map((door,index)=>kit.doorwayWorld(context.meta,door,index)).filter(Boolean);
    if(context.shaftEntrance)doorways.push(context.shaftEntrance); // Do not place the Great Door over the one physical exit to the shaft.
    const sites = [], why = { walls:0, narrow:0, short:0, floor:0, blocked:0, solid:0, doorway:0, spawn:0 };
    for (const wall of wallCandidates(context)) {
      why.walls++;
      const site=evaluateDoorSite(kit,context,wall,floorY,doorways,why);
      if(!site)continue;
      if(context.shaftEntrance&&Math.hypot(site.x-context.shaftEntrance.x,site.z-context.shaftEntrance.z)<DOOR_WIDTH+2){
        why.doorway++;continue; // Both full-width furniture assemblies must have clearance, not merely non-overlapping center points.
      }
      if(site.spawnDistance>5)sites.push(site);else why.spawn++;
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

  function shaftSealsPending(){
    // Normal Harlyao ruins now have actual braziers at the end of every
    // physical floor wing. The Great Door requires these in addition to the
    // original V50 blue seals; Hachutu has its own independent boss route.
    const network=window.DevRandomRuin?.getShaftNetworkState?.();
    return network&&!network.complete?network:null;
  }

  function sealedDoorLabel(){
    const local=s?.braziers?.filter(b=>b.lit).length||0,total=s?.braziers?.length||0;
    const pending=shaftSealsPending();
    return pending&&local===total
      ?'Great Door (Shaft '+pending.lit+'/'+pending.braziers+')'
      :'Great Door (Sealed '+local+'/'+total+')';
  }
  function awakeDoorLabel(){
    const pending=shaftSealsPending(); // One read per context-menu refresh, not three redundant deep snapshots.
    return pending?'Great Door (Shaft '+pending.lit+'/'+pending.braziers+')':'Open the Great Door';
  }

  function buildGreatDoor(kit, context, site, decalCount) {
    const floorY = Number.isFinite(Number(site.floorY))?Number(site.floorY):Number(context.meta?.floorSurfaceY)||0; // Shaft entrance uses its actual ground-story CellGrid3D datum.
    s.hiddenDecor = site.shaft?[]:clearDoorFootprint(context, site); // Do not hide V50 displays when the door stands against shaft masonry.
    const door = buildDoorVisual(kit, kit.group(), decalCount, site.height, 'dev_ruin_great_door');
    const offset = DOOR_WALL_OFFSET;
    door.group.position.set(site.x + site.normal.x * offset, floorY, site.z + site.normal.z * offset);
    door.group.rotation.y = Math.atan2(site.normal.x, site.normal.z);
    door.site = site;
    door.attachedToShaft=site.shaft===true; // Mobile diagnostics and return teleport use this exact shaft-side door.
    door.state = 'sealed';
    door.front = { x:site.x + site.normal.x * 1.8, z:site.z + site.normal.z * 1.8 };
    door.group.userData.interactive3D = true;
    door.group.userData.devRuinInteractionType = 'greatDoor';
    window.DevRandomRuinTileOccupancy?.addSolidBox?.('devruin-great-door', {
      cx:door.group.position.x, cz:door.group.position.z, halfX:DOOR_WIDTH / 2 + .36, halfZ:.34, yaw:door.group.rotation.y, // Deep enough to cover any wall-display footprint it replaced.
    }, null, kit.SCOPE);
    door.control = {
      kind:'greatDoor', object:door.group, promptRoot:door.group, range:2.3, priority:24, claimAction1:true, touchIcon:'🚪',
      label:() => door.state === 'sealed' ? sealedDoorLabel()
        : door.state === 'awake' ? awakeDoorLabel()
        : door.state === 'opening' ? 'The Great Door is opening…'
        : 'Enter the Sanctum',
      onPress:() => pressGreatDoor(),
    };
    return door;
  }

  function tryAwakenDoor(){
    // The local blue seals and the physically separate multi-story braziers
    // are BOTH prerequisites. Keep the stone door visibly sealed until the
    // last required source is lit instead of merely denying its interaction.
    if(!s?.door||s.door.state!=='sealed')return false;
    if(s.braziers.some(b=>!b.lit)||window.DevRandomRuin?.isShaftNetworkComplete?.()===false)return false;
    awakenDoor();
    return s.door.state==='awake';
  }

  function awakenDoor() {
    const door = s?.door;
    if (!door || door.state !== 'sealed') return;
    door.state = 'awake';
    if(s.context?.theme==='kanthic'){
      const patterns=[...(door.decals||[]).map(d=>d.mesh||d.disc),door.center].filter(Boolean);
      for(const mesh of patterns)mesh.userData.ruinDoorRuneGlow=true;
      window.CloudForestFog?.invalidateKanthicGlyphs?.();
      if(door.group?.position){const p=door.group.position;door.runeLight={x:p.x+(door.site?.normal?.x||0)*.35,y:p.y+(door.height||3.1)*.55,z:p.z+(door.site?.normal?.z||0)*.35,radius:1.35,strength:.36,color:[153,113,235],active:true,doorRune:true};(s.sanctumLights||=[]).push(door.runeLight);}
    }
    (window.RuinInteractionAudio?.puzzleComplete?.()||window.AudioSystem?.playObjectSfxKey?.('puzzleComplete'));
    door.awakeAt = performance.now();
    if (door.group) window.GameFeel?.beginReveal?.(door.group); // Show the player the door they just woke (skipped in combat / when on screen / too far).
    if (!s.bgs && window.Music?.registerFurnitureSfxSource) {
      s.bgs = window.Music.registerFurnitureSfxSource(MAP_ID, door.group.position.x, door.group.position.z, { url:BGS_URL, rangeTiles:16, volume:.8, semitones:DOOR_SEMITONES,
        volumeAt:dist=>{
          if(!window.DevRandomRuin?.isPlayerInShaft?.())return Math.max(0,1-dist/16);
          const dy=(Number(window.DevRandomRuin?.getPlayerGroundSupportY?.())||0)-door.group.position.y;
          return Math.max(.014,1/(1+(Math.hypot(dist,dy)/6)**2)); // Quiet but audible anywhere in the shaft, including its upper stories.
        }
      });
    }
  }

  function pressGreatDoor() {
    const door = s?.door;
    if (!door) return;
    if (door.state === 'sealed') {
      const lit = s.braziers.filter(b => b.lit).length,pending=shaftSealsPending();
      if(pending&&lit===s.braziers.length)
        deps?.showToast?.('The shaft braziers still bind the Great Door ('+pending.lit+'/'+pending.braziers+').',false);
      else deps?.showToast?.(`The Great Door is sealed. ${lit}/${s.braziers.length} of its blue seals glow.`,false);
      return;
    }
    if (door.state === 'awake') {
      const pending=shaftSealsPending(); // Door cannot skip the physically separate upper-story puzzle objectives.
      if(pending){
        deps?.showToast?.('The Great Door remains sealed by the shaft. Light all '+pending.braziers+' wing braziers ('+pending.lit+'/'+pending.braziers+').',false);
        return;
      }
      door.state = 'opening';
      deps?.showToast?.('The Great Door grinds down into the floor.', true);
      return;
    }
    if (door.state === 'open') enterSanctum();
  }

  function updateDoorVisual(door, now, dt, allLit) {
    if (!door) return;
    if(door.runeLight)door.runeLight.active=door.state==='awake'||door.state==='opening'&&door.progress<.8;
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

  function standingBrazier(kit, root, x, z, y0, shortOrdinary = false) {
    const holder = new THREE.Group();
    holder.name=shortOrdinary?'kanthic-sanctum-ordinary-brazier':'ruin-sanctum-brazier';
    holder.position.set(x, y0, z);
    const authored = authoredPiece('ruinStandingBrazier');
    if (authored) {
      holder.add(authored);
    } else {
      const shaft = stone(kit, kit.sharedCylinderGeometry ? kit.sharedCylinderGeometry(.12, .18, 1.1, 10) : new THREE.CylinderGeometry(.12, .18, 1.1, 10));
      shaft.position.y = .55;
      const bowl = stoneBowl(kit);
      bowl.scale.setScalar(1.5);
      bowl.position.y = 1.08;
      holder.add(shaft, bowl);
    }
    if(shortOrdinary)holder.scale.setScalar(.45); // 55% shorter than standard sanctum braziers, comfortably within torch-swing reach.
    const fire = createBlueFire(holder, 1.5, shortOrdinary ? {bright:'#ffcf82',base:'#ff792d',halo:0xff9b42} : null); // Shared authored/fallback flame drives the actual blue particle visual.
    fire.anchor.position.y = 1.23;
    root.add(holder);
    fire.holder = holder;
    fire.ordinaryFire=shortOrdinary; // Only the short orange arena braziers burn plasm.
    if(shortOrdinary){
      holder.userData.ordinaryFire=true;
      const contact=new THREE.Mesh(new THREE.CylinderGeometry(.43,.37,.84,10),new THREE.MeshBasicMaterial({visible:false})); // Fixed flame-height contact, never the emitter's unbounded particle box.
      contact.name='kanthic-sanctum-fire-contact';contact.position.y=1.2;contact.userData.devRuinFootprintIgnore=true;
      contact.userData.fireHazard=false;contact.userData.ordinaryFire=true;holder.add(contact);fire.contact=contact;
    }
    fire.lightSource = {x,y:y0+(shortOrdinary?.63:1.4),z,floorY:y0,floorTolerance:3,radius:shortOrdinary?1.5:9.5,strength:.97,color:shortOrdinary?[255,175,92]:[175,220,255],active:false,flameAnchor:fire.anchor,flameHalo:fire.halo}; // Static 2D light mask follows this brazier's lit state.
    return fire;
  }

  function buildLadder(kit, root, x, z, y0) {
    const authored = authoredPiece('ruinSanctumLadder');
    if (authored) {
      authored.name = 'dev_ruin_sanctum_exit_ladder';
      authored.scale.y = WALL_H / 3.2; // Authored at 3.2 tall; stretched to reach this room's ceiling.
      const daylight = glowSprite(0xfff1c8, 1.1, .45);
      daylight.position.set(-.15, 3.2 - .2 * 3.2 / WALL_H, 0);
      daylight.scale.y /= authored.scale.y;
      authored.add(daylight);
      authored.position.set(x, y0, z);
      root.add(authored);
      authored.userData.interactive3D = true;
      authored.userData.devRuinInteractionType = 'sanctumLadder';
      return authored;
    }
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
    ].map(([x, z]) => standingBrazier(kit, root, x, z, y0, context.theme==='kanthic'));

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
      const chest = chestsApi?.create?.({ id:'sanctum-vault-' + i, parent:root, x:vault.maxX - 1.9, y:y0, z:zc + dz, tier:cfg('sanctum.vault.chestTier', 4), yaw:-Math.PI / 2, boss:true });
      if (!chest) continue;
      chest.group.scale.setScalar(cfg('sanctum.vault.chestScale', 1.5));
      chest.control.range = 2;
      s.vaultChests.push(chest);
    }
    s.vaultFires = [standingBrazier(kit, root, vault.minX + 1, vault.minZ + .9, y0), standingBrazier(kit, root, vault.minX + 1, vault.maxZ - .9, y0)];
    s.sanctumLights = [...s.arenaFires,...s.vaultFires].map(fire=>fire.lightSource);
    if(s.door?.runeLight)s.sanctumLights.push(s.door.runeLight);
    if (context.theme === 'kanthic') for (const brazier of s.braziers) {
      const fire = brazier.fire; // Legacy standalone goals share the same Kanthic flame/light policy.
      if (!fire.lightSource) {
        const at = worldPos(fire.anchor);
        fire.lightSource = {x:at.x,y:at.y,z:at.z,radius:1,strength:.65,color:[175,220,255],active:fire.lit,flameAnchor:fire.anchor,flameHalo:fire.halo};
      }
      s.sanctumLights.push(fire.lightSource);
    } // Reused by the shared darkness compositor without per-frame scene scans.
    const ladder = buildLadder(kit, root, vault.maxX - .18, zc + (VAULT_D / 2 - 1.1), y0);
    s.ladderControl = {
      kind:'sanctumLadder', object:ladder, promptRoot:ladder, range:1.6, priority:22, claimAction1:true, touchIcon:'🪜',
      label:'Climb Out of the Ruin',
      onPress:() => {
        if (window.RuinSites?.completeActiveRuin?.()) return; // Wilderness site: surface somewhere random and spend the entrance.
        window.FurniturePatternSurfaces?.unlockRuin?.(window.DevRandomRuin?.getRuntimeContext?.()?.root);
        deps?.showToast?.('You climb the ladder up into daylight.', true); window.DevRandomRuin?.leave?.();
      },
    };
    s.returnDoor = returnDoor;
    s.sanctumRoot = root;
    window.DevRandomRuinTileOccupancy?.scanSolids?.(root, kit.SCOPE); // Chests, braziers and ladder collide like every other ruin prop.
    const occlusion = window.DevRandomRuin?.getOcclusionMeshes?.();
    if (occlusion) for (const mesh of s.occluders) occlusion.push(mesh); // Camera boom pulls in against sanctum walls exactly like V50 walls.
    s.bossType = context.theme || window.DevRandomRuin?.getState?.()?.theme || pickBossType(rng); // The ruin owns the tradition; the boss never rerolls it independently.
  }

  function buildCoffin(kit, root, x, z, y0, facing, index) {
    const authored = authoredPiece('ruinSanctumCoffin');
    if (authored) {
      authored.name = 'dev_ruin_sanctum_coffin_' + index;
      const lid = authored.userData.meshById?.get?.('lid');
      if (lid) lid.userData.devRuinFootprintIgnore = true;
      authored.position.set(x, y0, z);
      root.add(authored);
      return { index, group:authored, lid, lidRest:lid ? lid.position.clone() : null, x, z, facing, open:false, lidT:0, rise:{ x, z:z + facing * .95 } };
    }
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
      const rest = coffin.lidRest || { x:0, y:.69, z:0 };
      coffin.lid?.position.set(rest.x, rest.y - coffin.lidT * .45, rest.z - coffin.facing * coffin.lidT * .75);
      if (coffin.lid) coffin.lid.rotation.x = -coffin.facing * coffin.lidT * .5;
    }
  }

  async function spawnSkeleton(coffin, roster = null, at = null) {
    const owner = s, revision = owner?.encounterRevision; // A delayed portrait cannot populate a sanctum that was reset while loading.
    const tile = deps?.TILE || 64, p = at || coffin.rise;
    const minion = await window.MinionCombat?.makeEntity?.({
      speciesId:'harlyao-skeleton', name:'Harlyao Skeleton', tier:cfg('sanctum.skeletons.tier', 1), x:p.x * tile, y:p.z * tile, zoneId:MAP_ID, weaponMetalKey:'nativeCopper',
      roster:roster || undefined,
      extra:{ homeX:p.x * tile, homeY:p.z * tile, state:'chase', keepCorpseAfterLoot:true, sanctumCoffin:coffin.index }, // Looting leaves the body for the lich to raise.
    });
    if (!minion || s !== owner || owner?.encounterRevision !== revision || deps?.getCurrentArea?.() !== MAP_ID) { disposeActor(minion); return null; }
    deps.hostileObjects?.add?.(minion);
    coffin.skeleton = minion;
    return minion;
  }

  function roomGuardPosition(kit, bounds) {
    if (!bounds) return null;
    const floor = s?.context?.floorSet; // Same walkable tile index used by the solvability audit and encounter collision.
    const midX = (bounds.minX + bounds.maxX) * .5, midZ = (bounds.minZ + bounds.maxZ) * .5;
    const candidates = []; // Prefer the room's center; fallback positions avoid furniture and obstructed floor.
    for (let radius=0;radius<4;radius++) for (let dz=-radius;dz<=radius;dz++) for (let dx=-radius;dx<=radius;dx++) {
      const x = Math.floor(midX)+dx+.5, z = Math.floor(midZ)+dz+.5;
      if(x<=bounds.minX+.5||x>=bounds.maxX-.5||z<=bounds.minZ+.5||z>=bounds.maxZ-.5)continue;
      if(floor && !floor.has(Math.floor(x)+','+Math.floor(z)))continue;
      if(window.DevRandomRuinTileOccupancy?.solidAt?.(x,z,.32))continue;
      candidates.push({x,z});
    }
    return candidates[0] || null;
  }

  function wakeRoomGuard(guard) {
    if (!guard || guard.spawned || guard.spawnPending || !s?.isSpecialBoss) return;
    guard.spawnPending=true; // Avoid duplicate asynchronous portraits when a player remains in the same room.
    spawnSkeleton(guard).then(entity => {guard.spawned=!!entity;}).finally(() => {guard.spawnPending=false;});
  }

  function updateRoomGuards(kit) {
    if (!s?.isSpecialBoss || !s.roomCoffins?.length || !s.built || !s.inSanctum && !s.boss) {
      // The ordinary dungeon rooms can be explored before the sanctum boss awakens.
    }
    if (!s?.isSpecialBoss || s.bossDefeated || deps?.getCurrentArea?.()!==MAP_ID) return; // A previously defeated guardian cannot respawn room sentinels on re-entry.
    const tile=deps.TILE||64, px=deps.player.x/tile, pz=deps.player.y/tile;
    for(const guard of s.roomCoffins||[]) {
      const b=guard.bounds;
      if(px>=b.minX && px<b.maxX && pz>=b.minZ && pz<b.maxZ)wakeRoomGuard(guard);
    }
  }

  function wakeCoffins() {
    for (const coffin of s.coffins || []) {
      coffin.open = true;
      spawnSkeleton(coffin);
    }
  }

  function deadSkeletons() {
    return [...(s?.coffins || []), ...(s?.roomCoffins || [])].filter(coffin => coffin.skeleton && !(Number(coffin.skeleton.health) > 0) && coffin.skeleton.state === 'corpse' && !coffin.raising); // Settled corpses only; mid-ragdoll bodies are still owned by CreatureDeath.
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
    const owner=s, revision=owner?.encounterRevision; // A prior attempt's asynchronous resurrection cannot unlock a new attempt's coffin.
    deps?.corpseObjects?.delete?.(corpse);
    if (deps?.despawnCreature) deps.despawnCreature(corpse); else disposeActor(corpse);
    spawnSkeleton(coffin, roster, at).finally(() => {
      if (s===owner && owner.encounterRevision===revision) coffin.raising=false;
    });
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
    if (!window.DevRandomRuin?.setPlayerWorldPoint?.({ x:point.x, z:point.z }, { snapCamera:true, grounded:true })) return;
    // The Great Door connects disconnected floor islands in the same area.
    // Ordinary following cannot cross it, so carry only the player's living animal.
    for (const animal of deps?.companionObjects || []) {
      if ((animal.master || deps.player) !== deps.player || animal.banditCompanion ||
          animal.stableRole !== 'companion' || animal.areaId !== MAP_ID ||
          animal.health <= 0 || animal._downed) continue;
      window.Combat?.animalAttacks?.cancel?.(animal);
      window.Combat?.telegraph?.cancel?.(animal);
      window.Combat?.cancelStagedForAttacker?.(animal);
      animal.x = deps.player.x;
      animal.y = deps.player.y;
      animal.vx = 0; animal.vy = 0;
      animal.surfaceYOverride = () => animal.areaId === MAP_ID
        ? window.DevRandomRuin?.getGroundSupportYAt?.(animal.x / deps.TILE, animal.y / deps.TILE) ?? undefined : undefined;
      // Snap presentation under the fade; normal companion AI resumes next tick.
      const group = animal.avatarRef?.group;
      if (group) {
        group.position.x = point.x; group.position.z = point.z;
        group.position.y = (animal.surfaceYOverride() || 0) + (animal.groundLift ?? animal.halfHeight ?? 0);
      }
    }
    deps?._snapCameraTarget?.();
  }

  function endBossIntro(owner, beginCombat = false) {
    const intro = owner?.intro; // Owns the camera, title, timers and player action lock for one entrance only.
    if (!intro) return;
    owner.intro = null;
    clearTimeout(intro.titleTimer);
    clearTimeout(intro.endTimer);
    for (const timer of intro.soundTimers || []) clearTimeout(timer); // Death/exit/reroll must never schedule a late scream or echo.
    intro.title?.remove?.();
    if (owner.introLight) {
      owner.introLight.active = false;
      const index = owner.sanctumLights?.indexOf(owner.introLight) ?? -1; // Remove only this encounter's temporary boss lighting source.
      if (index >= 0) owner.sanctumLights.splice(index,1);
      owner.introLight = null;
    }
    if (window.CinematicCameraRuntime?.activeRecord?.()?.reason === 'ruin-sanctum-boss-intro') window.CinematicCameraRuntime.deactivate();
    if (intro.lock) window.CharacterActionLocks?.release?.(intro.lock);
    if (beginCombat && s === owner && owner.inSanctum && owner.boss === intro.boss && Number(intro.boss.health) > 0) {
      window.CombatVocalizations?.suppressSkeletonCoffinSpawnAlert?.(intro.boss); // The skeleton-voiced lich already screamed for the reveal; suppress only its immediate duplicate combat-detection alert.
      deps?.hostileObjects?.add?.(intro.boss); // No enemy AI, projectiles, summons or damage run while the cinematic is active.
      wakeCoffins(); // The lich is alone for its introduction; its skeletons rise only after the title clears.
      owner.lastEncounterEvent = 'combat-started';
    }
  }

  function setBossIntroFacing(boss, facing) {
    boss.facing = facing; // Authoritative combat aim stays aligned with the new visual rotation when combat starts.
    const yaw = Math.PI / 2 - facing - (Number(boss.def?.aimAngleOffset) || 0); // BanditCombat/updateCreatureMesh's existing humanoid rig convention.
    boss.groupRot = yaw;
    boss.pngRot = yaw;
    if (boss.avatarRef?.group?.rotation) boss.avatarRef.group.rotation.y = yaw; // Boss is not in the hostile simulation yet, so updateCreatureMesh is not running.
    if (boss._banditToolHolder && !boss._banditDisposed) window.BanditCombat?.updateToolMesh?.(boss); // Hostile weapons are scene siblings, not body children; the shared pose owner must turn and re-seat Azgarlu's warhammer too.
  }

  function updateBossIntro(now) {
    const intro = s?.intro;
    if (!intro || !intro.boss) return;
    const elapsed = Math.max(0, (Number.isFinite(now) ? now : performance.now()) - intro.startedAtMs);
    const t = Math.max(0, Math.min(1, (elapsed - INTRO_TURN_DELAY_MS) / INTRO_TURN_MS));
    const eased = t*t*(3-2*t); // Smooth, readable turn rather than an instantaneous AI-facing snap.
    const facing = intro.turnFrom + (intro.turnTo-intro.turnFrom)*eased; // Reuse the original boss-facing animation without recalculating scene-sibling weapon poses after it settles.
    if (Math.abs((Number(intro.boss.facing) || 0) - facing) > 1e-5) setBossIntroFacing(intro.boss, facing);
  }

  function playBossIntroShriek(owner, intro, volume, pitch, echo = false) {
    if (s !== owner || owner.intro !== intro || !owner.inSanctum || owner.boss !== intro.boss ||
        !(Number(intro.boss.health) > 0) || deps?.getCurrentArea?.() !== MAP_ID) return;
    const audio = window.AudioSystem; // Reuse the existing authored skeleton shriek and spatial ruin reverb.
    if (typeof audio?.playObjectSfxKeyAt === 'function') {
      audio.playObjectSfxKeyAt('ruinCoffinShriek', intro.soundX, intro.soundZ, MAP_ID, intro.soundY,
        {earshotTiles:24, volumeScale:volume, pitch});
    } else audio?.playObjectSfxKey?.('ruinCoffinShriek', volume, pitch);
    if (echo) intro.echoesPlayed++; else intro.shriekPlayed = true; // Visible in the existing sanctum debug snapshot.
  }

  function beginBossIntro(owner, boss, label) {
    const camera = window.CinematicCameraRuntime; // The same blended cinematic-camera owner used by dialogue and puzzle reveals.
    const arena = owner.layout.arena, floor = Number(owner.context.meta?.floorSurfaceY) || 0;
    const height = Math.max(1, Number(boss.avatarRef?.modelHeight) || 1.7);
    const x = boss.x / (deps?.TILE || 64), z = boss.y / (deps?.TILE || 64);
    const shot = {
      id:'sanctum_boss_reveal', shotKey:'sanctum-'+owner.encounterRevision,
      position:{x:Math.max(arena.minX+2.8,x-4.8),y:floor+Math.max(1.55,height*.95),z:z+.55},
      target:{x,y:floor+Math.max(1,height*.75),z},
      fovDeg:34,blendSeconds:.95,dialogueFraming:false,
    }; // Look back across the arena toward the solitary boss instead of moving the player camera itself.
    if (!camera?.activate?.(MAP_ID,shot,{reason:'ruin-sanctum-boss-intro'})) {
      owner.lastEncounterEvent='camera-unavailable';
      deps?.hostileObjects?.add?.(boss);
      wakeCoffins(); // Camera failure must never trap the player in an unwinnable sanctum.
      return;
    }
    const lock = window.CharacterActionLocks?.acquire?.({owner:'ruin-sanctum-intro',reason:'named lich introduction',participants:['player'],channels:['movement','actions','tools'],timeoutMs:INTRO_MS+1200});
    const toPlayerX = Number(deps?.player?.x) - boss.x, toPlayerZ = Number(deps?.player?.y) - boss.y; // Player coordinates are combat pixels; the cinematic camera stands on the same arena side.
    const playerBearing = Number.isFinite(toPlayerX) && Number.isFinite(toPlayerZ) && Math.hypot(toPlayerX,toPlayerZ) > 1
      ? Math.atan2(toPlayerZ,toPlayerX) : Math.atan2(shot.position.z-z,shot.position.x-x);
    const intro = {
      boss, lock, title:null, titleTimer:null, endTimer:null, soundTimers:[], startedAtMs:performance.now(),
      turnTo:playerBearing, turnFrom:playerBearing+Math.PI*.84, // Start mostly facing away to guarantee a visible turn for every boss.
      soundX:x, soundZ:z, soundY:floor+Math.max(1,height*.7), shriekPlayed:false, echoesPlayed:0,
    }; // All turn and audio state belongs to this one cancellable cinematic, never the combat entity definition.
    owner.intro = intro;
    setBossIntroFacing(boss,intro.turnFrom);
    intro.soundTimers.push(setTimeout(() => {
      if (s !== owner || owner.intro !== intro || !owner.inSanctum) return;
      setBossIntroFacing(boss,intro.turnTo); // Low-FPS guarantee: the scream never precedes the final visible face-to-face pose.
      playBossIntroShriek(owner,intro,1,1);
    },INTRO_SHRIEK_MS));
    for (const tap of INTRO_ECHO_TAPS) {
      intro.soundTimers.push(setTimeout(() => playBossIntroShriek(owner,intro,tap.volume,tap.pitch,true),INTRO_SHRIEK_MS+tap.afterMs));
    }
    const revealLight = {x,y:floor+Math.max(1,height*.75),z,floorY:floor,floorTolerance:3,radius:8.5,strength:1,color:[245,228,207],active:true}; // Center the one-time illumination on the lich's torso so the Kanthic blackness cannot swallow the reveal.
    owner.introLight = revealLight;
    (owner.sanctumLights ||= []).push(revealLight);
    owner.lastEncounterEvent = 'reveal';
    intro.titleTimer = setTimeout(() => {
      if (s !== owner || owner.intro !== intro || !owner.inSanctum) return;
      const title = document.createElement('div'); // Screen-space boss title, not a world label clipped by the camera.
      title.id='ruin-sanctum-boss-title';
      title.textContent=String(label || boss.name || 'Lich').toUpperCase();
      title.setAttribute('role','status');
      title.style.cssText = "position:fixed;left:50%;top:75%;transform:translate(-50%,-50%);width:94vw;max-width:1200px;box-sizing:border-box;z-index:9990;pointer-events:none;text-align:center;white-space:normal;overflow-wrap:break-word;color:#fff6d8;font-family:'KhymeryyanRomanLetters+Numbers','KhymeryyanRoman',serif;font-size:clamp(28px,6vmin,74px);font-weight:400;line-height:1.08;letter-spacing:.065em;-webkit-text-stroke:.5px #000;text-shadow:0 1px 2px #000,0 2px 5px rgba(0,0,0,.85);";
      document.body.appendChild(title);
      intro.title = title;
    },INTRO_TITLE_DELAY_MS);
    intro.endTimer = setTimeout(() => endBossIntro(owner,true),INTRO_MS);
  }

  function resetSanctumEncounter(reason='exit') {
    const owner = s;
    if (!owner) return;
    owner.encounterRevision = (owner.encounterRevision || 0) + 1; // Invalidates pending boss and coffin-portrait promises from the previous attempt.
    owner.bossPending = false;
    owner.inSanctum = false;
    owner.enteringSanctum = false;
    owner.leavingSanctum = false;
    endBossIntro(owner,false);
    const boss = owner.boss;
    if (boss) {
      window.HarlyaoLichCombat?.clearBossEffects?.(boss);
      window.DevRandomRuinLichThemes?.resetBossHazards?.(boss);
      window.SpecialHarlyaoLiches?.applyPlasmSkin?.(boss,false);
      window.SpecialHarlyaoLiches?.releaseWarhammer?.(boss); // The per-boss patterned weapon texture belongs to the departing guardian.
      window.SpecialHarlyaoLiches?.clear?.();
      for (const minion of boss._lichSummons || []) { deps?.corpseObjects?.delete?.(minion); disposeActor(minion); }
      deps?.corpseObjects?.delete?.(boss);
      disposeActor(boss);
    }
    owner.boss = null;
    for (const coffin of owner.coffins || []) {
      if (coffin.skeleton) { deps?.corpseObjects?.delete?.(coffin.skeleton); disposeActor(coffin.skeleton); }
      coffin.skeleton=null;coffin.open=false;coffin.lidT=0;coffin.raising=false;coffin.raised=0;
      if (coffin.lid) {
        const rest=coffin.lidRest||{x:0,y:.69,z:0};
        coffin.lid.position.set(rest.x,rest.y,rest.z);
        coffin.lid.rotation.x=0;
      }
    }
    // A completed guardian's Key-Stone and claimed loot are permanent; an unfinished encounter restarts from its initial state.
    if (owner.rearDoor) {
      owner.rearDoor.open=!!owner.bossDefeated;
      owner.rearDoor.progress=owner.bossDefeated?1:0;
      updateRearDoor(0);
    }
    owner.cornerFireClock=0;owner.cornerFireIndex=null;
    for (const fire of owner.arenaFires || []) extinguishFire(fire);
    if (!owner.bossDefeated) for (const fire of owner.vaultFires || []) { fire.lit=false; if(fire.anchor)fire.anchor.visible=false; if(fire.lightSource)fire.lightSource.active=false; }
    owner.lastEncounterEvent = 'reset:'+reason;
  }

  function enterSanctum() {
    const owner=s, entry=owner?.entry; // A delayed transition must never use the next ruin's state after teardown.
    if (!entry || owner.inSanctum || owner.enteringSanctum || owner.leavingSanctum) return;
    owner.enteringSanctum = true; // Death can happen during the fade, before the player has been teleported.
    const entryRevision = owner.encounterRevision;
    fadeThen(() => {
      if (s!==owner || owner.encounterRevision!==entryRevision || !owner.enteringSanctum || (typeof deps?.getCurrentArea==='function' && deps.getCurrentArea()!==MAP_ID)) return;
      owner.enteringSanctum = false;
      teleport(entry);
      owner.inSanctum = true;
      if(owner.context?.theme==='kanthic'){owner.cornerFireClock=0;owner.cornerFireIndex=null;rotateKanthicFires(owner,0);}
      else for (const fire of owner.arenaFires || []) igniteFire(fire);
      if (!s.boss && !s.bossDefeated && !s.bossPending) {
        s.bossPending = true;
        const owner=s, revision=owner.encounterRevision; // Timers must not resurrect a guardian after death or a return-door exit.
        setTimeout(() => { if(s===owner && owner.inSanctum && owner.encounterRevision===revision) spawnBoss(owner,revision); }, cfg('sanctum.boss.wakeMs', BOSS_WAKE_MS));
        deps?.showToast?.('Blue flames gutter up around a vast chamber. Something stirs.', true);
      }
    });
  }

  function leaveSanctum() {
    const owner=s, door=owner?.door;
    if (!door || owner.leavingSanctum) return;
    const front=door.front; // Capture the original door anchor before a delayed fade or teardown.
    resetSanctumEncounter('leave');
    owner.leavingSanctum = true; // Explicitly track the return fade so death can cancel its late teleport.
    const exitRevision = owner.encounterRevision;
    fadeThen(() => {
      if(s!==owner || owner.encounterRevision!==exitRevision || !owner.leavingSanctum || owner.door!==door || (typeof deps?.getCurrentArea==='function' && deps.getCurrentArea()!==MAP_ID))return;
      owner.leavingSanctum = false;
      teleport(front);
    });
  }

  async function spawnBoss(owner=s,revision=owner?.encounterRevision) {
    const combat = window.HarlyaoLichCombat;
    if (!owner || s!==owner || !owner.inSanctum || owner.encounterRevision!==revision || owner.boss || owner.bossDefeated) return;
    if (deps?.getCurrentArea?.() !== MAP_ID || !combat?.makeEntity) { owner.bossPending = false; return; }
    combat.allowArea?.(MAP_ID); // Idempotent; covers a lich module that loaded after this one.
    const { arena, zc } = s.layout;
    const x = (arena.minX + arena.maxX) / 2 + 1.5, z = zc; // One and a half tiles toward the rear, clear of the coffins.
    const tile = deps.TILE || 64;
    const ruinLich = !s.isSpecialBoss ? window.DevRandomRuin?.getLichName?.() : null; // The ruin's title names this lich: the same person rises in the sanctum.
    let creature=null; // A failed async portrait should release the pending state instead of permanently blocking re-entry.
    try {
      creature = await combat.makeEntity({ type:s.bossType, special:s.isSpecialBoss, nameOverride:ruinLich || undefined, tier:cfg('sanctum.boss.tier', BOSS_TIER), x:x * tile, y:z * tile, extra:{ ruinTheme:s.bossType } }); // The special variant changes boss presentation, but uses the original Harlyao Lich AI host.
    } catch (error) {
      if (s===owner && owner.encounterRevision===revision) { owner.bossPending=false; owner.lastEncounterEvent='spawn-failed'; }
      window.__farmLog?.('[random-ruin] sanctum lich spawn failed: '+(error?.message||error),'warn');
      return;
    }
    if(s===owner && owner.encounterRevision===revision)owner.bossPending = false;
    if (!creature || s!==owner || !owner.inSanctum || owner.encounterRevision!==revision || deps?.getCurrentArea?.() !== MAP_ID) { disposeActor(creature); return; }
    const max = Math.round((Number(creature.maxHealth) || Number(creature.health) || 100) * cfg('sanctum.boss.healthMult', BOSS_HEALTH_MULT));
    creature.maxHealth = max;
    creature.health = max;
    creature.isRuinSanctumBoss = true;
    creature.lichRaiseDead = { canRaise:() => deadSkeletons().length > 0, raise:lich => raiseDead(lich) }; // Instead of summoning new minions.
    s.boss = creature; // Keep the prepared avatar visible without enrolling its AI until the introduction finishes.
    window.SpecialHarlyaoLiches?.tick?.(creature,0); // Establish head flames/weapon visuals for the frozen cinematic without running the hostile AI.
    const label = (s.isSpecialBoss && window.SpecialHarlyaoLiches?.defFor?.(s.bossType)?.name) || ruinLich || combat.TYPE_DEFS?.[s.bossType]?.label || 'Lich';
    beginBossIntro(owner,creature,label);
    window.__farmLog?.(`[random-ruin] sanctum boss ${s.bossType} spawned hp=${max}`, 'world');
  }

  function disposeActor(entity) {
    if (!entity) return;
    window.Combat?.telegraph?.cancel?.(entity); // Clear pending combat warnings before the abandoned actor leaves the update loop.
    window.Combat?.cancelStagedForAttacker?.(entity); // No staged Strike callback may fire after the sanctum encounter is retired.
    deps?.hostileObjects?.delete?.(entity);
    deps?.corpseObjects?.delete?.(entity);
    if (typeof window.BanditCombat?.discardEntity === 'function') {
      window.BanditCombat.discardEntity(entity); // Canonical hostile teardown covers every weapon socket, trail, texture, HUD and late avatar.
      return;
    }
    entity.avatarRef?.group?.parent?.remove?.(entity.avatarRef.group);
    entity.groundShadow?.parent?.remove?.(entity.groundShadow);
    for (const holder of [entity._banditToolHolder,entity._banditRangedToolHolder,entity._banditFlaskToolHolder,entity._banditTrailMesh]) holder?.parent?.remove?.(holder);
    entity.avatarRef?.dispose?.(); // Isolated authoring/test tools may not load the complete bandit module.
  }

  function removeLichHeart(owner = s) {
    if (!owner?.heart) return; // The physical pickup and its controls share this one disposal path.
    const group = owner.heart.group; // Authored furniture keeps shared decal textures, but owns its glow-material and decal meshes.
    for (const glow of group.userData?.staticGlowEmitterVisuals || []) glow?.dispose?.(); // Dispose per-instance halo sprites without disposing the global texture.
    for (const decal of group.userData?.authoredDecalMeshes || []) {
      decal.geometry?.dispose?.();
      decal.material?.dispose?.(); // Materials are instance-specific; their cached image textures remain shared.
    }
    for (const part of group.userData?.meshById?.values?.() || []) {
      if (part.userData?.authoredPart?.kind !== 'transparentBillboardSurface') continue;
      part.geometry?.dispose?.();
      part.material?.dispose?.(); // Each heart's invisible authored billboard plane is also an owned GPU allocation.
    }
    group.parent?.remove?.(group);
    owner.heart = null;
  }

  function syncLichHeart() {
    if (!s?.built || !s.isSpecialBoss || !s.bossDefeated || !s.sanctumRoot) return; // Ordinary liches never drop authored heart relics.
    const heart = window.LichHeartSystem?.forType?.(s.bossType); // Shared registry maps each named guardian to one real furniture piece.
    if (!heart || window.LichHeartSystem?.has?.(s.bossType)) {
      removeLichHeart(); // Ownership is authoritative on load and after pickup.
      return;
    }
    if (s.heart) return; // Repeated update ticks never instantiate duplicates.
    const group = authoredPiece(heart.furnitureKey); // Assets load asynchronously; retry until the full glyph and glow exist.
    if (!group) return;
    const arena = s.layout.arena, floorY = Number(s.context.meta?.floorSurfaceY) || 0; // Center on the arena rather than the boss's offset spawn.
    group.name = 'dev_ruin_lich_heart_' + s.bossType;
    group.position.set((arena.minX + arena.maxX) / 2, floorY, (arena.minZ + arena.maxZ) / 2);
    group.traverse(node => { node.userData.devRuinFootprintIgnore = true; }); // The floating decal/halo is visual, not solid furniture.
    group.userData.interactive3D = true;
    group.userData.devRuinInteractionType = 'lichHeart';
    s.sanctumRoot.add(group);
    const owner = s; // A stale controller cannot change another ruin after a shift/rebuild.
    const control = {
      kind:'lichHeart', object:group, promptRoot:group, floorY, range:2.2, priority:24, claimAction1:true, touchIcon:'💠', // A floor-local pickup must not be claimable through a stacked ruin room.
      label:'Claim ' + heart.label,
      onPress:() => {
        if (s !== owner || owner.heart?.group !== group) return false;
        const result = window.LichHeartSystem?.collect?.(owner.bossType); // Persist the character key BEFORE removing this one-time world pickup.
        if (!result?.ok || !window.LichHeartSystem?.has?.(owner.bossType)) {
          deps?.showToast?.(result?.message || 'Could not save the Lich-heart. Try again.', false);
          return false;
        }
        removeLichHeart(owner); // Includes authored static glow cleanup; no stale prompt or GPU material survives collection.
        return true;
      },
    };
    s.heart = { group, control, furnitureKey:heart.furnitureKey };
  }

  function updateBoss(now) {
    if (!s?.boss || s.bossDefeated || s.intro) return;
    const boss = s.boss;
    const dead = !(Number(boss.health) > 0) || boss.dead === true || !deps?.hostileObjects?.has?.(boss);
    if (!dead) return;
    s.bossDefeated = true;
    if (s.isSpecialBoss) window.SpecialHarlyaoLiches?.onDefeat?.(boss); // Single canonical Key-Stone grant; repeats and old saves cannot duplicate the quest reward.
    if(window.RuinSites?.isInSite?.()&&!window.RuinSites?.markActiveRuinBossDefeated?.(window.DevRandomRuin?.getSeed?.())){
      deps?.showToast?.('The lich is defeated, but its progress could not be saved.',false);
    } // Save after the idempotent quest reward so reloading cannot permanently forfeit an unclaimed Key-Stone.
    (window.RuinInteractionAudio?.puzzleComplete?.()||window.AudioSystem?.playObjectSfxKey?.('puzzleComplete'));
    s.bossDefeatedAt = now;
    for (const minion of boss._lichSummons || []) if (Number(minion?.health) > 0) deps?.damageCreature?.(minion, minion.health, undefined, undefined, 0, {});
    for (const coffin of [...(s.coffins || []),...(s.roomCoffins || [])]) if (Number(coffin.skeleton?.health) > 0) deps?.damageCreature?.(coffin.skeleton, coffin.skeleton.health, undefined, undefined, 0, {}); // Its skeletons fall with it.
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
    s.roomCoffins = (s.isSpecialBoss ? (context.meta?.rooms || []) : []).map((room,index) => {
      const bounds=kit.roomBounds(context.meta,room); // Existing generated dungeon room bounds, not sanctum/vault tiles.
      const rise=roomGuardPosition(kit,bounds);
      return rise ? {index:'room-'+index,bounds,rise,open:true,spawned:false,spawnPending:false,skeleton:null} : null;
    }).filter(Boolean); // Every eligible generated room has one sleeping skeleton encounter.
    s.braziers = buildBraziers(kit, context);
    if (cfg('sanctum.safePathBraziers', true) && !context.tier) buildSafePathBraziers(kit);
    const site=context.shaftHub===true
      ? window.DevRandomRuin?.getShaftSanctumDoorSite?.()
      : chooseDoorSite(kit, context, s.rng); // Normal ruins MUST use a verified inner shaft wall, not a random V50 room wall.
    if (!site) { s.rejects.push(context.shaftHub?'no safe wall on the main shaft for the Great Door':'no clear wall for the Great Door'); return; }
    if(site.shaft)s.doorSiteStats={shaft:true,side:site.side,x:site.x,z:site.z}; // In-game/mobile debug confirms where the door is actually mounted.
    s.door = buildGreatDoor(kit, context, site, s.braziers.length);
    if(context.theme==='kanthic')s.doorCheckpointRegistered=window.RuinCheckpointTravel?.registerDoorCheckpoint?.(site,DOOR_WIDTH)===true;
    buildSanctum(kit, context, s.braziers.length, s.rng);
    if(s.bossDefeated&&s.rearDoor){
      s.rearDoor.open=true;s.rearDoor.progress=1;
      updateRearDoor(0); // Restore the real vault opening immediately, not a sealed door protecting a permanently dead lich.
    }
    if (!s.braziers.length) tryAwakenDoor(); // A ruin without local blue goals still requires all shaft-wing braziers.
    kit.recordModulePlacement('greatDoorSanctum', 'room', 'sanctum', { braziers:s.braziers.length, bossType:s.bossType, door:{ x:+site.x.toFixed(2), z:+site.z.toFixed(2) } });
  }

  SP.registerComposer({
    id:'sanctum',
    buildRooms(kit, context, rng, usedRooms, options) {
      s = null;
      deps = kit.deps || deps;
      if (options?.sanctum === false || context.hachutu===true) return; // The dev Hachutu temple owns its entire wing and boss; never create a Harlyao lich sanctuary.
      s = {
        context, rng, built:false, rejects:[], braziers:[], litOrder:[], occluders:[], door:null, bgs:null,
        layout:reservedLayout(context), // floorProjection reserved these tiles; recover the plan from the live grid size.
        boss:null,bossPending:false,intro:null,introLight:null,sanctumLights:[],encounterRevision:0,lastEncounterEvent:'unvisited', // Cache the arena/vault masks and one temporary reveal mask. // Separate attempts never reuse delayed actor spawns or cinematic ownership.
        bossDefeated:window.DevRandomRuin?.getSeed?.()!=null
          &&window.RuinSites?.isActiveRuinBossDefeated?.(window.DevRandomRuin.getSeed())===true,
        inSanctum:false, enteringSanctum:false, leavingSanctum:false, // Both fade directions are cancelable if the player dies or the ruin tears down.
        isSpecialBoss:context.specialBoss === true, roomCoffins:[], // Site generation explicitly opts into the three named key guardians; dev/ordinary ruins stay unchanged.
      };
    },
    onPlayerDeath() { if (s?.inSanctum || s?.enteringSanctum || s?.leavingSanctum || s?.intro || s?.bossPending) resetSanctumEncounter('death'); }, // The checkpoint host calls this before moving the player.
    update(kit, now, dt) {
      if (!s) return;
      deps = kit.deps || deps;
      if (!s.built) { try { build(kit); } catch (error) { s.built = true; s.rejects.push(String(error?.message || error)); console.warn('[Random Test Ruin sanctum] build failed', error); } }
      tryAwakenDoor(); // Cheap scalar check; respond immediately to the last upper-floor brazier.
      const allLit = !!s.door && s.door.state !== 'sealed';
      for (const brazier of s.braziers) updateFire(brazier.fire, now, dt);
      rotateKanthicFires(s,dt);
      for (const fire of s.arenaFires || []) updateFire(fire, now, dt);
      for (const fire of s.vaultFires || []) {
        if (s.bossDefeated) igniteFire(fire);
        updateFire(fire, now, dt);
      }
      updateDoorVisual(s.door, now, dt, allLit);
      updateDoorVisual(s.returnDoor, now, dt, true);
      updateBossIntro(now); // Pure pose update for the isolated zoom; the real hostile tick stays disabled until combat.
      updateBoss(now);
      syncLichHeart(); // Also rehydrates unclaimed rewards when returning after a persisted boss victory.
      updateRoomGuards(kit); // Room sentinels spawn once on first entry, keeping large ruins efficient on mobile.
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
      if (s.heart?.control) out.push(s.heart.control);
      return out;
    },
    snapshot() {
      if (!s) return null;
      const p = obj => { if (!obj) return null; const v = worldPos(obj); return { x:+v.x.toFixed(2), y:+v.y.toFixed(2), z:+v.z.toFixed(2) }; };
      return {
        built:s.built, rejects:s.rejects.slice(), doorSiteStats:s.doorSiteStats || null,
        braziers:s.braziers.map(b => ({ id:b.id, label:b.label, lit:b.lit, at:p(b.holder) })),
        door:s.door ? { state:s.door.state, progress:+s.door.progress.toFixed(3), at:p(s.door.group), front:s.door.front, attachedToShaft:!!s.door.attachedToShaft, shaftSide:s.door.site?.side||null, decals:s.door.decals.length } : null,
        bgs:!!s.bgs, doorCheckpointRegistered:!!s.doorCheckpointRegistered, cornerFireIndex:s.cornerFireIndex??null, cornerFireClock:s.cornerFireClock||0, cornerFires:(s.arenaFires||[]).map(f=>({lit:f.lit,scale:f.holder?.scale?.x})), layout:s.layout, entry:s.entry || null, bossType:s.bossType || null,
        boss:s.boss ? { id:s.boss.id, health:s.boss.health, maxHealth:s.boss.maxHealth, x:+(s.boss.x / (deps?.TILE || 64)).toFixed(2), z:+(s.boss.y / (deps?.TILE || 64)).toFixed(2) } : null,
        bossDefeated:s.bossDefeated, specialBoss:s.isSpecialBoss, lichHeart:s.heart ? { furnitureKey:s.heart.furnitureKey, position:p(s.heart.group) } : null, lichHeartAcquired:!!window.LichHeartSystem?.has?.(s.bossType), roomGuards:(s.roomCoffins||[]).map(g=>({room:g.index,spawned:g.spawned,pending:g.spawnPending,alive:Number(g.skeleton?.health)>0})), rearDoor:s.rearDoor ? { open:s.rearDoor.open, progress:+s.rearDoor.progress.toFixed(3) } : null,
        vaultChests:(s.vaultChests || []).map(c => ({ id:c.id, tier:c.tier, opened:c.opened })),
        inSanctum:s.inSanctum, enteringSanctum:!!s.enteringSanctum, leavingSanctum:!!s.leavingSanctum, bossIntro:!!s.intro, introFacing:s.intro ? +s.intro.boss.facing.toFixed(3) : null, introShriekPlayed:!!s.intro?.shriekPlayed, introEchoesPlayed:s.intro?.echoesPlayed || 0, introLightActive:!!s.introLight?.active, sanctumLightsLit:(s.sanctumLights||[]).filter(light=>light.active).length, encounterRevision:s.encounterRevision, lastEncounterEvent:s.lastEncounterEvent,
        coffins:(s.coffins || []).map(c => ({ index:c.index, open:c.open, raised:c.raised || 0, skeleton:c.skeleton ? { health:c.skeleton.health, state:c.skeleton.state || null, looted:!!c.skeleton.corpseLooted, keep:!!c.skeleton.keepCorpseAfterLoot } : null })),
      };
    },
    clear() {
      if (!s) return;
      resetSanctumEncounter('ruin-teardown'); // Cancel all delayed reveals/spawns before the larger ruin detaches.
      for(const fire of [...(s.arenaFires||[]),...(s.vaultFires||[])]){fire.emitter?.dispose?.();fire.contact?.geometry?.dispose?.();fire.contact?.material?.dispose?.();} // Dispose independent particle buffers, not shared furniture assets.
      if (s.bgs) window.Music?.unregisterFurnitureSfxSource?.(s.bgs);
      removeLichHeart(); // Old pickup and its glow material must not survive ruin teardown.
      for (const coffin of [...(s.coffins||[]),...(s.roomCoffins||[])]) if (coffin.skeleton) { deps?.corpseObjects?.delete?.(coffin.skeleton); disposeActor(coffin.skeleton); }
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
    if(context?.sanctumPlan?.arena&&context.sanctumPlan?.vault)return context.sanctumPlan; // Preserve the reserved west-side location instead of guessing from enlarged map dimensions.
    const size = context?.sanctumMapSize || context; // Shaft wing appends rows after the sanctum reserves its tiles.
    const cols = Number(size?.cols) || 0, rows = Number(size?.rows) || 0;
    const wing = planLayout(0, rows).cols; // Width the wing adds (base 0).
    return planLayout(cols - wing, rows);
  }

  window.DevRandomRuinSanctum = Object.freeze({
    reserve,
    planLayout,
    igniteAll:() => { for (const brazier of s?.braziers || []) igniteBrazier(brazier); return !!s; }, // Diagnostics.
    enter:() => enterSanctum(),
    isGreatDoorUnlocked:() => !!s?.door && s.door.state !== 'sealed', // The unlocked Great Door's positional music replaces the ruin soundtrack until this ruin is cleared.
    debugShove:(entity, dirX, dirZ, speedPxS = 900) => { const t = deps?.TILE || 64; if (!entity) return false; deps?.damageCreature?.(entity, 1, entity.x - dirX * t, entity.y - dirZ * t, speedPxS, {}); return true; }, // Headless tests: a 1-damage hit from the opposite side.
    debugKillSkeleton:index => { const sk = s?.coffins?.[index]?.skeleton; if (!sk || !(sk.health > 0)) return false; deps?.damageCreature?.(sk, sk.health + 999, undefined, undefined, 0, {}); return true; }, // Headless tests.
    leave:() => leaveSanctum(),
    resetEncounter:reason => resetSanctumEncounter(reason || 'debug'), // Mobile diagnostics and regression tests can force an encounter reset without desktop DevTools.
    buildLichBrazier,
    lightSources:() => s?.sanctumLights || [], // Zero-allocation read path for both darkness compositors and mobile diagnostics.
    litOrdinaryFireObjects:()=> (s?.arenaFires||[]).filter(f=>f.ordinaryFire&&f.lit&&f.contact).map(f=>f.contact),
    ordinaryFireSources:()=> (s?.arenaFires||[]).filter(f=>f.ordinaryFire&&f.lit).map(f=>f.lightSource), // Active nonmagical corner flames only.
    debugUpdateIntro:now => updateBossIntro(now), // Run one real intro-pose tick without rebuilding the dungeon (mobile diagnostics and isolated regression tests).
    getState:() => s,
  });
})();

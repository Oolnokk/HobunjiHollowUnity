// Death Mark — replaces the old combo-streak system's "empower heavy
// attacks" role. The weapon combo's heavy finisher (Cleave/Long Lunge — see
// combat-combo.js's `heavy` steps) now marks whatever it hits instead of
// scaling its own damage off a streak. Marks stack up to maxStacks on a
// target and show as a billboarded PNG plane hovering over its chest (see
// updateTransforms below). Any OTHER heavy attack (currently just Charged
// Breaker — see combat-charged-breaker.js) that lands on a marked target
// consumes every stack for a big one-time damage/affliction multiplier,
// then keeps that same multiplier applied to every heavy hit the target
// takes (from any source) for empowerWindowSeconds afterward. The combo's
// own mark-granting hit deliberately never consumes existing stacks itself
// (see resolveHeavyMultiplier's isMarkGrantingHit guard) — that's what lets
// stacks actually build past 1 instead of a Cleave immediately eating its
// own mark on the next landed hit.
//
// Every tunable number and every visual (symbol path, glow color/intensity)
// is read from docs/config/combat/attack-values.json's `deathMark` section
// via applyDeathMarkConfig, applied once combat-config-loader.js fetches it.
// The defaults below only cover the brief window before that config loads.
(() => {
  'use strict';

  const RS = window.ResourceSystem;
  if (!window.Combat || !RS?.applyDamage) {
    console.error('combat-death-mark.js requires combat-core.js + resource-system.js to load first');
    return;
  }
  if (typeof THREE === 'undefined') return;
  if (window.HobunjiDeathMark) return;

  let MAX_STACKS = 3;
  let EMPOWER_WINDOW_S = 7;
  let MULTIPLIER_BY_STACKS_CONSUMED = [2, 3, 5]; // index 0 = 1 stack consumed, etc.
  let BILLBOARD_CFG = {
    chestHeightRatio: 0.62,
    iconWidthTiles: 0.32,
    iconHeightTiles: 0.32,
    iconOpacity: 0.95,
    glowScaleMul: 2.6,
    bobAmplitudeTiles: 0.045,
    bobSpeedPerSec: 2.1,
    stacks: [
      { symbol: 'assets/hud/scratchbone1.png', glowColor: '#39a7ff', glowOpacity: 0.55 },
      { symbol: 'assets/hud/scratchbone2.png', glowColor: '#b24bff', glowOpacity: 0.62 },
      { symbol: 'assets/hud/scratchbone3.png', glowColor: '#ffffff', glowOpacity: 0.85 },
    ],
  };

  function now() { return performance.now() / 1000; }

  function multiplierForStacksConsumed(stacks) {
    const idx = Math.max(1, Math.min(stacks, MULTIPLIER_BY_STACKS_CONSUMED.length)) - 1;
    return Number(MULTIPLIER_BY_STACKS_CONSUMED[idx]) || 1;
  }

  function stackVisualConfig(stacks) {
    const list = BILLBOARD_CFG.stacks || [];
    if (!list.length) return {};
    return list[Math.max(1, Math.min(stacks, list.length)) - 1] || list[list.length - 1];
  }

  // ---- Billboard presentation -------------------------------------------
  // One camera-facing PNG plane plus an additive glow sprite behind it, both
  // parented under a single group added directly to the marked creature's
  // own scene (mirrors how game.js's groundShadow attaches — a flat,
  // top-level object rather than a child of the squashing/rotating avatar
  // prism), so the mark reads as a genuine world-space billboard rather than
  // inheriting hit-squash or death-ragdoll rotation.

  const texturesBySymbol = new Map(); // Shares one texture load per authored symbol path across every marked creature.
  function textureFor(path) {
    if (!path) return null;
    let tex = texturesBySymbol.get(path);
    if (!tex) {
      tex = new THREE.TextureLoader().load(path);
      if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
      texturesBySymbol.set(path, tex);
    }
    return tex;
  }

  let sharedGlowTexture = null; // Soft radial falloff shared by every stack's glow sprite; only the sprite's color/opacity vary per stack.
  function glowTexture() {
    if (sharedGlowTexture) return sharedGlowTexture;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,.85)');
    gradient.addColorStop(0.7, 'rgba(255,255,255,.28)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    sharedGlowTexture = new THREE.CanvasTexture(canvas);
    sharedGlowTexture.minFilter = THREE.LinearFilter;
    sharedGlowTexture.magFilter = THREE.LinearFilter;
    return sharedGlowTexture;
  }

  const visuals = new Map(); // entity -> { group, plane, planeMaterial, glowSprite, glowMaterial }

  function buildVisual() {
    const group = new THREE.Group();
    group.name = 'death-mark-billboard';
    const glowMaterial = new THREE.SpriteMaterial({
      map: glowTexture(),
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const glowSprite = new THREE.Sprite(glowMaterial);
    group.add(glowSprite);
    const planeMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      alphaTest: 0.04,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), planeMaterial);
    plane.renderOrder = 1;
    group.add(plane);
    return { group, plane, planeMaterial, glowSprite, glowMaterial };
  }

  function ensureVisual(entity, stacks) {
    let visual = visuals.get(entity);
    if (!visual) {
      visual = buildVisual();
      visuals.set(entity, visual);
    }
    if (visual.group.parent !== entity.scene && entity.scene) {
      visual.group.parent?.remove(visual.group);
      entity.scene.add(visual.group);
    }
    const cfg = stackVisualConfig(stacks);
    visual.planeMaterial.map = textureFor(cfg.symbol);
    visual.planeMaterial.opacity = BILLBOARD_CFG.iconOpacity ?? 1;
    visual.planeMaterial.needsUpdate = true;
    const iconW = BILLBOARD_CFG.iconWidthTiles ?? 0.32;
    const iconH = BILLBOARD_CFG.iconHeightTiles ?? 0.32;
    visual.plane.scale.set(iconW, iconH, 1);
    visual.glowMaterial.color.set(cfg.glowColor || '#ffffff');
    visual.glowMaterial.opacity = cfg.glowOpacity ?? 0.6;
    const glowScale = iconW * (BILLBOARD_CFG.glowScaleMul ?? 2.4);
    visual.glowSprite.scale.set(glowScale, glowScale, 1);
    return visual;
  }

  function disposeVisual(entity) {
    const visual = visuals.get(entity);
    if (!visual) return;
    visual.group.parent?.remove(visual.group);
    visual.plane.geometry?.dispose();
    visual.planeMaterial?.dispose();
    visual.glowMaterial?.dispose();
    visuals.delete(entity);
  }

  const cameraWorldQ = new THREE.Quaternion(); // Reused every frame instead of allocating one per marked creature.

  function updateTransforms(camera) {
    if (!camera || !visuals.size) return;
    camera.getWorldQuaternion(cameraWorldQ);
    const deps = window.Combat.deps;
    const tile = Number(deps?.TILE) || 64;
    const timeS = now();
    for (const [entity, visual] of [...visuals]) {
      const stillHostile = deps?.hostileObjects?.has ? deps.hostileObjects.has(entity) : true;
      if (!(entity._deathMarkStacks > 0) || entity.health <= 0 || !stillHostile || !entity.scene) {
        disposeVisual(entity);
        continue;
      }
      if (visual.group.parent !== entity.scene) {
        visual.group.parent?.remove(visual.group);
        entity.scene.add(visual.group);
      }
      const groupY = entity.avatarRef?.group?.position?.y ?? 0;
      const halfHeight = Number(entity.halfHeight) || 0;
      const floorY = groupY - halfHeight;
      const chestY = floorY + halfHeight * 2 * (BILLBOARD_CFG.chestHeightRatio ?? 0.62);
      const bobPhase = (Number(entity.x) || 0) * 0.01 + (Number(entity.y) || 0) * 0.01; // Deterministic per-entity offset so co-located marks don't bob in lockstep.
      const bob = Math.sin(timeS * (BILLBOARD_CFG.bobSpeedPerSec ?? 2.1) + bobPhase) * (BILLBOARD_CFG.bobAmplitudeTiles ?? 0.045);
      visual.group.position.set((Number(entity.x) || 0) / tile, chestY + bob, (Number(entity.y) || 0) / tile);
      visual.group.quaternion.copy(cameraWorldQ);
    }
  }

  function installRenderHook() {
    const prototype = THREE.WebGLRenderer?.prototype;
    if (!prototype || prototype.__hobunjiDeathMarkHooked || typeof prototype.render !== 'function') return;
    const previousRender = prototype.render;
    prototype.render = function deathMarkBillboardRender(scene, camera, ...rest) {
      updateTransforms(camera);
      return previousRender.call(this, scene, camera, ...rest);
    };
    prototype.render.__hobunjiDeathMarkOriginal = previousRender;
    prototype.__hobunjiDeathMarkHooked = true;
  }

  installRenderHook();

  // ---- Stack + empowerment logic -----------------------------------------

  function clearMarks(entity) {
    entity._deathMarkStacks = 0;
    disposeVisual(entity);
  }

  function applyMark(entity) {
    if (!entity) return;
    const stacks = Math.min(MAX_STACKS, (entity._deathMarkStacks || 0) + 1);
    entity._deathMarkStacks = stacks;
    ensureVisual(entity, stacks);
  }

  // isMarkGrantingHit: true for the combo's own heavy finisher (opts.
  // appliesDeathMark — see combat-combo.js). That hit only ever ADDS a mark
  // (below, after applyDamageWithDeathMark delegates); it never consumes
  // existing ones itself, which is what lets stacks climb past 1. Any other
  // heavy attack (Charged Breaker) is the one that pops accumulated stacks.
  function resolveHeavyMultiplier(entity, isMarkGrantingHit) {
    const stacks = entity._deathMarkStacks || 0;
    if (stacks > 0 && !isMarkGrantingHit) {
      const mul = multiplierForStacksConsumed(stacks);
      clearMarks(entity);
      entity._deathMarkEmpowerMul = mul;
      entity._deathMarkEmpowerUntil = now() + EMPOWER_WINDOW_S;
      return mul;
    }
    if (entity._deathMarkEmpowerUntil > now()) return entity._deathMarkEmpowerMul || 1;
    return 1;
  }

  const originalApplyDamage = RS.applyDamage.bind(RS); // Captures whatever applyDamage chain already exists (e.g. combat-corroded-health.js's wrap) so this layers on top of it rather than replacing it.
  RS.applyDamage = function applyDamageWithDeathMark(entity, amount, opts = {}) {
    if (opts?.heavy && entity && amount > 0) {
      amount = amount * resolveHeavyMultiplier(entity, !!opts.appliesDeathMark);
    }
    const result = originalApplyDamage(entity, amount, opts);
    if (opts?.appliesDeathMark && entity) applyMark(entity);
    return result;
  };

  window.Combat.applyDeathMarkConfig = function (cfg) {
    if (!cfg) return;
    if (cfg.maxStacks != null) MAX_STACKS = cfg.maxStacks;
    if (cfg.empowerWindowSeconds != null) EMPOWER_WINDOW_S = cfg.empowerWindowSeconds;
    if (Array.isArray(cfg.multiplierByStacksConsumed)) MULTIPLIER_BY_STACKS_CONSUMED = cfg.multiplierByStacksConsumed.slice();
    if (cfg.billboard) BILLBOARD_CFG = { ...BILLBOARD_CFG, ...cfg.billboard };
  };

  window.Combat.deathMark = {
    getStacks: entity => entity?._deathMarkStacks || 0,
    getEmpowerment: entity => (entity?._deathMarkEmpowerUntil > now()
      ? { multiplier: entity._deathMarkEmpowerMul || 1, remainingSeconds: entity._deathMarkEmpowerUntil - now() }
      : null),
  };

  window.HobunjiDeathMark = { id: 'deathMark' };
})();

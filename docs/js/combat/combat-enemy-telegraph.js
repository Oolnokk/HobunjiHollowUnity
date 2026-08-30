// Combat enemy telegraph — gives hostile/companion bite attacks a genuine
// windup-then-strike state machine instead of instant on-contact damage,
// ported from the sandbox's dummy-AI attack (triggerDummyAttack: windup
// 0.54s, strike 0.20s — the sandbox's only enemy-side attack timing, reused
// here for both hostiles and companions). Sets creature.telegraphState
// ('windup'|'strike'|null) so game.js can tint the creature during it (a
// visible tell) and so the strike only lands if the target is still in
// range at the strike frame, not the frame the windup began — that's what
// makes it genuinely dodgeable. Also gives combat-quickattacks.js's
// Opportunist Jab a real enemyStriking signal to read, instead of the
// always-false placeholder it had before this module existed.
(() => {
  "use strict";
  if (!window.Combat) { console.error('combat-enemy-telegraph.js requires combat-core.js to load first'); return; }

  function start(c, { windupS, strikeS, onStrike }) {
    c._telegraph = { t: 0, windupS, strikeS, onStrike, struck: false };
    c.telegraphState = 'windup';
    window.Combat.deps?.requestThreatGrowl?.(c, 'attack-telegraph');
  }

  function update(c, dt) {
    const tg = c._telegraph;
    if (!tg) return false;
    tg.t += dt;
    if (!tg.struck && tg.t >= tg.windupS) {
      tg.struck = true;
      c.telegraphState = 'strike';
      tg.onStrike();
    }
    if (tg.t >= tg.windupS + tg.strikeS) {
      c._telegraph = null;
      c.telegraphState = null;
      return false;
    }
    return true;
  }

  function isBusy(c) { return !!c._telegraph; }

  function cancel(c) {
    c._telegraph = null;
    c.telegraphState = null;
  }

  window.Combat.telegraph = { start, update, isBusy, cancel };
})();

// Heavy-attack presentation lives beside the enemy telegraph state machine so
// hostile attack timing stays the single authority. This layer reads existing
// Charged Breaker / Counter Shield state and only creates cosmetic Three.js
// objects; it never changes damage, timing, stamina, collision, or AI choices.
(() => {
  "use strict";
  if (!window.Combat || typeof THREE === 'undefined') return;

  const FIRE_LAYER_SPECS = [
    { count: 12, size: 0.12, opacity: 0.58, rise: 0.78, radius: 0.10, speed: 1.55 },
    { count: 9, size: 0.19, opacity: 0.27, rise: 0.92, radius: 0.15, speed: 1.18 },
    { count: 6, size: 0.065, opacity: 0.82, rise: 1.04, radius: 0.18, speed: 1.95 },
  ]; // Used to build the three additive flame/spark layers around a heavy weapon.
  const FIRE_NEUTRAL_COLOR = 0xffc85a; // Used only when an attack has no authored affliction color to expose.
  const FIRE_MAX_COLORS = 4; // Caps layered colors so future multi-affliction attacks cannot explode draw-call count.
  const FIELD_COLOR = 0x75d9ff; // Shared restrained cyan for Counter Shield glow and force-field shell.
  const FIELD_RADIUS = 0.72; // Radius used by the front-half defensive bubble around its user.
  const actorVisuals = new Map(); // Reuses one presentation bundle per actor instead of allocating every frame.
  const missingHolderWarnings = new WeakSet(); // Prevents repeated mobile debug-log spam while an avatar/weapon is mounting.
  let cachedDefensiveIcon = '🛡️'; // Last arch-derived defensive-heavy glyph used to texture Counter Shield projections.
  let cachedDefensiveIconTexture = null; // Shared canvas texture regenerated only when the arch glyph changes.

  function makeSoftParticleTexture() {
    const canvas = document.createElement('canvas'); // Supplies one blurred alpha map shared by every additive particle/glow sprite.
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d'); // Draws the radial falloff used by the additive particle material.
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16); // Produces a bright center with a soft transparent edge.
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.28, 'rgba(255,255,255,.9)');
    gradient.addColorStop(0.68, 'rgba(255,255,255,.32)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
    const texture = new THREE.CanvasTexture(canvas); // Reused by all flame points and defensive weapon glow sprites.
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  const softParticleTexture = makeSoftParticleTexture(); // Shared map keeps all telegraph particles soft without extra image assets.

  function makeFrontHemisphereGeometry(radius, rows = 9, columns = 16) {
    const vertices = []; // Stores front-facing hemisphere vertices in local +X-forward coordinates.
    const indices = []; // Connects the hemisphere grid into triangles for the transparent shell.
    for (let row = 0; row <= rows; row++) {
      const elevation = -Math.PI / 2 + Math.PI * (row / rows); // Sweeps bottom-to-top around the field center.
      const cosElevation = Math.cos(elevation); // Reused for local forward/side coordinates on this row.
      for (let column = 0; column <= columns; column++) {
        const azimuth = -Math.PI / 2 + Math.PI * (column / columns); // Sweeps only the actor-facing half of a sphere.
        vertices.push(
          radius * cosElevation * Math.cos(azimuth),
          radius * Math.sin(elevation),
          radius * cosElevation * Math.sin(azimuth),
        );
      }
    }
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const a = row * (columns + 1) + column; // Top-left vertex of this hemisphere grid cell.
        const b = a + columns + 1; // Bottom-left vertex of this hemisphere grid cell.
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geometry = new THREE.BufferGeometry(); // Shared shell geometry used by every Counter Shield bubble.
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  const fieldGeometry = makeFrontHemisphereGeometry(FIELD_RADIUS); // Reused by all defensive shell meshes to avoid duplicate geometry.

  function trailAfflictionColor(id) {
    const raw = window.ResourceRings?.AFFLICTION_COLORS?.[id]; // Reads the exact source palette used by the resource/weapon trail systems.
    if (raw == null) return FIRE_NEUTRAL_COLOR;
    const neon = window.ResourceRings?.neonizeColor; // Applies the same saturation/lightness transform as the existing weapon trails.
    return typeof neon === 'function' ? neon(raw) : raw;
  }

  function afflictionIdsForBonuses(bonuses) {
    const entries = Object.entries(bonuses || {}).filter(([, mul]) => Number(mul) > 0); // Keeps only afflictions this hit can actually add.
    entries.sort((a, b) => Number(b[1]) - Number(a[1]));
    return entries.slice(0, FIRE_MAX_COLORS).map(([id]) => id);
  }

  function createFireLayer(color, spec, colorIndex, layerIndex) {
    const positions = new Float32Array(spec.count * 3); // Updated in place each frame to animate one flame layer.
    const geometry = new THREE.BufferGeometry(); // Owns this layer's dynamic particle positions.
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.PointsMaterial({ // Gives this layer its affliction color and additive soft-fire rendering.
      color,
      size: spec.size,
      map: softParticleTexture,
      transparent: true,
      opacity: spec.opacity,
      alphaTest: 0.015,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material); // Attached under the moving weapon holder for weapon-relative flames.
    points.frustumCulled = false;
    points.renderOrder = 4;
    const seeds = Array.from({ length: spec.count }, (_, pointIndex) => { // Stable pseudo-random-looking phases prevent particle teleport jitter.
      const n = (pointIndex + 1) * 12.9898 + (colorIndex + 1) * 78.233 + (layerIndex + 1) * 37.719; // Deterministically separates every particle/layer/color.
      const fract = value => value - Math.floor(value); // Converts sine-derived values into repeatable 0..1 seeds.
      return {
        phase: fract(Math.sin(n) * 43758.5453),
        angle: fract(Math.sin(n * 1.71) * 15731.743) * Math.PI * 2,
        radius: (0.25 + fract(Math.sin(n * 2.13) * 24634.634) * 0.75) * spec.radius,
        wobble: 1.4 + fract(Math.sin(n * 3.07) * 56445.234) * 2.2,
        speed: spec.speed * (0.82 + fract(Math.sin(n * 4.11) * 12415.873) * 0.36),
      };
    });
    points.userData.heavyFire = { spec, seeds, positions, layerIndex, colorIndex };
    return points;
  }

  function createFireGroup(afflictionIds) {
    const group = new THREE.Group(); // Holds all affliction-colored flame layers on one weapon.
    group.name = 'heavy-attack-fire-telegraph';
    const ids = afflictionIds.length ? afflictionIds : [null]; // Ensures a neutral tell still exists for a heavy with no affliction upgrade.
    ids.forEach((id, colorIndex) => {
      const color = id ? trailAfflictionColor(id) : FIRE_NEUTRAL_COLOR; // Matches this attack's trail color, or neutral heavy gold if none exists.
      FIRE_LAYER_SPECS.forEach((spec, layerIndex) => group.add(createFireLayer(color, spec, colorIndex, layerIndex)));
    });
    group.userData.afflictionSignature = ids.join('|');
    return group;
  }

  function updateFireGroup(group, timeS) {
    for (const points of group.children) {
      const data = points.userData.heavyFire; // Supplies this points layer's immutable animation seeds and mutable position buffer.
      if (!data) continue;
      const colorOffset = data.colorIndex * 0.07; // Staggers differently colored layers so they visibly interleave instead of overlap perfectly.
      for (let i = 0; i < data.seeds.length; i++) {
        const seed = data.seeds[i]; // Drives one particle's repeatable rise/wobble path.
        const life = (timeS * seed.speed + seed.phase + colorOffset) % 1; // Loops each lick/spark upward independently.
        const envelope = 1 - life * 0.62; // Narrows the flame toward its tip as the particle rises.
        const angle = seed.angle + Math.sin(timeS * seed.wobble + seed.phase * 6.28) * 0.52; // Adds a sideways licking motion without random per-frame jumps.
        const base = i * 3; // Indexes this particle's xyz triplet inside the shared buffer.
        data.positions[base] = Math.cos(angle) * seed.radius * envelope + Math.sin(timeS * 4.1 + i) * 0.018;
        data.positions[base + 1] = -0.30 + life * data.spec.rise + Math.sin(timeS * 5.7 + seed.phase * 8) * 0.025;
        data.positions[base + 2] = Math.sin(angle) * seed.radius * envelope + Math.cos(timeS * 3.6 + i * 0.7) * 0.018;
      }
      points.geometry.attributes.position.needsUpdate = true;
      points.material.opacity = data.spec.opacity * (0.84 + Math.sin(timeS * 8 + data.layerIndex * 1.7) * 0.12);
    }
  }

  function disposeFireGroup(group) {
    if (!group) return;
    for (const points of group.children) {
      points.geometry?.dispose?.();
      points.material?.dispose?.();
    }
    group.parent?.remove(group);
  }

  function createWeaponGlowGroup() {
    const group = new THREE.Group(); // Holds two quiet additive sprites around the weapon during Counter Shield.
    group.name = 'counter-shield-weapon-glow';
    const specs = [ // Gives the glow a soft core/halo without looking like the offensive flame effect.
      { y: -0.10, scaleX: 0.34, scaleY: 0.62, opacity: 0.19 },
      { y: 0.18, scaleX: 0.44, scaleY: 0.78, opacity: 0.10 },
    ];
    specs.forEach((spec, index) => {
      const material = new THREE.SpriteMaterial({ // Unlit additive material keeps the defensive glow readable but restrained.
        map: softParticleTexture,
        color: FIELD_COLOR,
        transparent: true,
        opacity: spec.opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(material); // Follows the weapon holder while the stance or riposte moves it.
      sprite.position.set(0, spec.y, 0);
      sprite.scale.set(spec.scaleX, spec.scaleY, 1);
      sprite.userData.baseScale = { x: spec.scaleX, y: spec.scaleY, opacity: spec.opacity, phase: index * Math.PI * 0.73 };
      group.add(sprite);
    });
    return group;
  }

  function readArchIconText(button) {
    const iconEl = button?.querySelector?.('.abt-icon'); // Reads the same DOM icon the action arch actually renders.
    if (!iconEl) return '';
    const clone = iconEl.cloneNode(true); // Lets us strip badges without mutating the real action button.
    clone.querySelectorAll?.('.alcohol-swig-badge,.abt-key').forEach(node => node.remove());
    return (clone.textContent || '').trim();
  }

  function resolveDefensiveHeavyIcon() {
    const abilityIcon = window.Combat.abilities?.get?.('counterShield')?.icon; // Supports a future authored ability icon without changing this renderer.
    if (abilityIcon) return String(abilityIcon);
    const labeledButton = Array.from(document.querySelectorAll('.abt-label')).find(label => /counter\s*shield/i.test(label.textContent || ''))?.closest('button'); // Prefers an explicitly labeled Counter Shield arch button if the UI exposes one.
    const labeledIcon = readArchIconText(labeledButton); // Exact icon from that explicitly labeled button when present.
    if (labeledIcon) return labeledIcon;
    const hold2Icon = readArchIconText(document.getElementById('btnAction2')); // Counter Shield lives on weapon input/hold slot 2, so this is the same physical arch icon.
    return hold2Icon || cachedDefensiveIcon;
  }

  function makeDefensiveIconTexture(glyph) {
    const canvas = document.createElement('canvas'); // Renders the arch glyph into a texture that can sit tangent to the 3D field shell.
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d'); // Draws a translucent high-contrast version of the exact arch icon.
    ctx.clearRect(0, 0, 128, 128);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 82px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    ctx.shadowColor = 'rgba(117,217,255,.9)';
    ctx.shadowBlur = 12;
    ctx.globalAlpha = 0.86;
    ctx.fillText(glyph || '🛡️', 64, 66);
    const texture = new THREE.CanvasTexture(canvas); // Shared by every active field icon until the arch glyph changes.
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  function currentDefensiveIconTexture() {
    const glyph = resolveDefensiveHeavyIcon(); // Rechecks the live arch so the projection follows any UI/loadout icon change.
    if (glyph !== cachedDefensiveIcon || !cachedDefensiveIconTexture) {
      cachedDefensiveIcon = glyph;
      cachedDefensiveIconTexture?.dispose?.();
      cachedDefensiveIconTexture = makeDefensiveIconTexture(glyph);
      for (const visual of actorVisuals.values()) {
        if (visual.iconMaterial) visual.iconMaterial.map = cachedDefensiveIconTexture;
      }
    }
    return cachedDefensiveIconTexture;
  }

  function createFieldGroup() {
    const group = new THREE.Group(); // World-space front hemisphere + icon that follows the Counter Shield user.
    group.name = 'counter-shield-field';
    const shellMaterial = new THREE.MeshBasicMaterial({ // Main low-opacity half-sphere reads as a force field rather than solid geometry.
      color: FIELD_COLOR,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const shell = new THREE.Mesh(fieldGeometry, shellMaterial); // Smooth transparent field surface.
    shell.renderOrder = 3;
    group.add(shell);
    const gridMaterial = new THREE.MeshBasicMaterial({ // Faint wire overlay makes the curvature readable without becoming a dramatic flame effect.
      color: FIELD_COLOR,
      transparent: true,
      opacity: 0.055,
      wireframe: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const grid = new THREE.Mesh(fieldGeometry, gridMaterial); // Shares geometry exactly with the shell so both layers stay aligned.
    grid.scale.setScalar(1.008);
    grid.renderOrder = 3.01;
    group.add(grid);
    const iconMaterial = new THREE.MeshBasicMaterial({ // Tangent icon plane uses the exact action-arch glyph texture.
      map: currentDefensiveIconTexture(),
      transparent: true,
      opacity: 0.46,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const icon = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), iconMaterial); // Projects the defensive-heavy icon onto the center-front of the bubble.
    icon.position.set(FIELD_RADIUS * 1.012, 0.07, 0);
    icon.rotation.y = Math.PI / 2;
    icon.renderOrder = 3.02;
    group.add(icon);
    group.userData.shell = shell;
    group.userData.grid = grid;
    group.userData.icon = icon;
    return { group, shellMaterial, gridMaterial, iconMaterial, iconGeometry: icon.geometry };
  }

  function rootSceneFor(holder, actor) {
    if (actor?.scene?.isScene) return actor.scene;
    let node = holder; // Walks from the weapon holder to the root so the field can use world-space actor coordinates safely.
    while (node?.parent) node = node.parent;
    return node?.isScene ? node : null;
  }

  function holderForActor(actor) {
    const deps = window.Combat.deps; // Supplies the player tool holder and shared actor collections from game.js.
    if (!deps) return null;
    if (actor === deps.player) return deps.toolHolder?.() || null;
    return actor?._banditToolHolder || null;
  }

  function createActorVisual(actor) {
    const field = createFieldGroup(); // Creates this actor's reusable force-field materials and icon plane.
    const visual = { // Tracks all reusable visual objects and current activation/color state for one actor.
      actor,
      holder: null,
      scene: null,
      offensive: false,
      defensive: false,
      afflictionIds: [],
      fireGroup: null,
      weaponGlowGroup: createWeaponGlowGroup(),
      fieldGroup: field.group,
      shellMaterial: field.shellMaterial,
      gridMaterial: field.gridMaterial,
      iconMaterial: field.iconMaterial,
      iconGeometry: field.iconGeometry,
    };
    visual.weaponGlowGroup.visible = false;
    visual.fieldGroup.visible = false;
    actorVisuals.set(actor, visual);
    return visual;
  }

  function ensureAttached(visual, holder) {
    if (!holder) return false;
    if (visual.holder !== holder) {
      visual.weaponGlowGroup.parent?.remove(visual.weaponGlowGroup);
      visual.fireGroup?.parent?.remove(visual.fireGroup);
      holder.add(visual.weaponGlowGroup);
      if (visual.fireGroup) holder.add(visual.fireGroup);
      visual.holder = holder;
    }
    const scene = rootSceneFor(holder, visual.actor); // Places the field at actor world coordinates instead of inheriting weapon transforms.
    if (scene && visual.scene !== scene) {
      visual.fieldGroup.parent?.remove(visual.fieldGroup);
      scene.add(visual.fieldGroup);
      visual.scene = scene;
    }
    return !!scene;
  }

  function ensureFireColors(visual, afflictionIds) {
    const safeIds = afflictionIds.length ? afflictionIds : []; // Normalized color list used to decide whether the particle layers need rebuilding.
    const signature = (safeIds.length ? safeIds : [null]).join('|'); // Matches createFireGroup's neutral-heavy fallback signature.
    if (visual.fireGroup?.userData.afflictionSignature === signature) return;
    disposeFireGroup(visual.fireGroup);
    visual.fireGroup = createFireGroup(safeIds);
    visual.afflictionIds = safeIds.slice();
    if (visual.holder) visual.holder.add(visual.fireGroup);
  }

  function updateFieldTransform(visual, timeS) {
    const actor = visual.actor; // Supplies actor position/facing while the field itself stays world-space.
    const holder = visual.holder; // Supplies reliable current world height even on slopes, plateaus, and lunges.
    if (!actor || !holder || !visual.fieldGroup) return;
    const deps = window.Combat.deps; // Supplies TILE conversion and player identity/facing conventions.
    const tile = Number(deps?.TILE) || 64; // Converts actor pixel X/Y into Three.js world X/Z.
    const holderWorld = new THREE.Vector3(); // Samples the live weapon-holder height without assuming flat terrain.
    holder.getWorldPosition(holderWorld);
    const facing = actor === deps?.player ? Number(actor.angle) || 0 : Number(actor.facing) || 0; // Uses each actor type's canonical combat-facing field.
    visual.fieldGroup.position.set((Number(actor.x) || 0) / tile, holderWorld.y - 0.12, (Number(actor.y) || 0) / tile);
    visual.fieldGroup.rotation.set(0, -facing, 0);
    const pulse = 1 + Math.sin(timeS * 3.8) * 0.025; // Gives the bubble a quiet force-field breathing motion rather than offensive flare.
    visual.fieldGroup.scale.setScalar(pulse);
    visual.shellMaterial.opacity = 0.11 + Math.sin(timeS * 4.2) * 0.015;
    visual.gridMaterial.opacity = 0.045 + Math.sin(timeS * 3.1 + 0.8) * 0.012;
    visual.iconMaterial.opacity = 0.40 + Math.sin(timeS * 4.7 + 1.3) * 0.06;
  }

  function updateWeaponGlow(visual, timeS) {
    for (const sprite of visual.weaponGlowGroup.children) {
      const base = sprite.userData.baseScale; // Restores this glow sprite's authored scale/opacity around a tiny pulse.
      const pulse = 1 + Math.sin(timeS * 5 + base.phase) * 0.07; // Deliberately much subtler than the flame telegraph.
      sprite.scale.set(base.x * pulse, base.y * pulse, 1);
      sprite.material.opacity = base.opacity * (0.92 + Math.sin(timeS * 4.2 + base.phase) * 0.08);
    }
  }

  function syncActor(actor, { offensive = false, defensive = false, afflictionBonuses = null } = {}, timeS) {
    const holder = holderForActor(actor); // Resolves the actor's real moving weapon holder so all weapon effects stay attached correctly.
    let visual = actorVisuals.get(actor); // Reuses an existing visual bundle if this actor has telegraphed before.
    if (!offensive && !defensive && !visual) return;
    if (!visual) visual = createActorVisual(actor);
    if (!holder || !ensureAttached(visual, holder)) {
      visual.offensive = false;
      visual.defensive = false;
      if (visual.fireGroup) visual.fireGroup.visible = false;
      visual.weaponGlowGroup.visible = false;
      visual.fieldGroup.visible = false;
      if (actor && !missingHolderWarnings.has(actor)) {
        missingHolderWarnings.add(actor);
        window.__farmLog?.('[heavy-telegraph] waiting for a combatant weapon holder/scene before showing its visual tell.', 'combat');
      }
      return;
    }
    if (offensive) {
      const ids = afflictionIdsForBonuses(afflictionBonuses); // Uses exactly the affliction set the pending heavy hit will apply.
      ensureFireColors(visual, ids);
      visual.fireGroup.visible = true;
      updateFireGroup(visual.fireGroup, timeS);
    } else if (visual.fireGroup) {
      visual.fireGroup.visible = false;
    }
    visual.weaponGlowGroup.visible = defensive;
    visual.fieldGroup.visible = defensive;
    if (defensive) {
      currentDefensiveIconTexture();
      updateWeaponGlow(visual, timeS);
      updateFieldTransform(visual, timeS);
    }
    visual.offensive = offensive;
    visual.defensive = defensive;
  }

  function isBanditOffensiveHeavy(c) {
    if (!c?.isBandit || (c.telegraphState !== 'windup' && c.telegraphState !== 'strike')) return false;
    const charged = window.Combat.chargedBreakerData; // Provides the actual configured Charged Breaker animation power used by bandit AI.
    if (!charged) return false;
    const expectedPower = Number(charged.POWER) || 1.7; // Distinguishes the heavy sweep from ordinary combo sweep poses without changing bandit AI state shape.
    return c._banditSwingAnim === 'sweep' && Math.abs((Number(c._banditSwingPower) || 0) - expectedPower) < 0.001;
  }

  function isBanditCounterShieldHeld(c, nowMs) {
    return !!c?.isBandit && Number(c._banditGuardUntil) > nowMs; // Reads the same timed guard window bandit damage interception already uses.
  }

  function isPlayerCounterShieldHeld(player) {
    if (!player) return false;
    const ability = window.Combat.abilities?.get?.('counterShield'); // Uses Counter Shield's own active getter so a failed/no-stamina hold never shows a false bubble.
    return typeof ability?.isActive === 'function' ? !!ability.isActive() : false;
  }

  function cleanupVisual(visual) {
    disposeFireGroup(visual.fireGroup);
    visual.weaponGlowGroup.parent?.remove(visual.weaponGlowGroup);
    for (const sprite of visual.weaponGlowGroup.children) sprite.material?.dispose?.();
    visual.fieldGroup.parent?.remove(visual.fieldGroup);
    visual.shellMaterial?.dispose?.();
    visual.gridMaterial?.dispose?.();
    visual.iconMaterial?.dispose?.();
    visual.iconGeometry?.dispose?.();
  }

  function updateHeavyAttackPresentation(_dt) {
    const deps = window.Combat.deps; // Supplies the live player, hostile list, current area, and tool-holder bridge.
    if (!deps?.player || !Array.isArray(deps.hostileObjects)) return;
    const timeS = performance.now() / 1000; // Drives purely cosmetic flame/glow/pulse animation.
    const nowMs = timeS * 1000; // Matches bandit `_banditGuardUntil`, which is stored in performance.now milliseconds.
    const liveActors = new Set([deps.player]); // Used to dispose visuals for enemies that despawn, die, or leave the current area.
    const currentArea = deps.getCurrentArea?.(); // Filters the scan to the scene actually being rendered.

    syncActor(deps.player, { defensive: isPlayerCounterShieldHeld(deps.player) }, timeS);

    for (const c of deps.hostileObjects) {
      if (!c?.isBandit || c.health <= 0 || c.areaId !== currentArea) continue;
      liveActors.add(c);
      const offensive = isBanditOffensiveHeavy(c); // True across both the Charged Breaker windup and strike stages.
      const defensive = isBanditCounterShieldHeld(c, nowMs); // True for the exact Counter Shield guard window.
      const afflictionBonuses = offensive ? window.ResourceSystem?.afflictionBonusesForTag?.(c.def?.attackTag) : null; // Same bonuses the bandit's heavy hit passes into damagePlayer.
      syncActor(c, { offensive, defensive, afflictionBonuses }, timeS);
    }

    for (const [actor, visual] of actorVisuals) {
      if (liveActors.has(actor)) continue;
      cleanupVisual(visual);
      actorVisuals.delete(actor);
    }
  }

  function snapshot() {
    return Array.from(actorVisuals.values()).map(visual => ({ // Mobile-friendly read-only state used when copying/debugging heavy telegraph behavior.
      actor: visual.actor === window.Combat.deps?.player ? 'player' : (visual.actor?.def?.label || visual.actor?.name || 'bandit'),
      offensive: visual.offensive,
      defensive: visual.defensive,
      afflictionIds: visual.afflictionIds.slice(),
      holderReady: !!visual.holder,
      sceneReady: !!visual.scene,
    }));
  }

  window.Combat.heavyTelegraphVisuals = { update: updateHeavyAttackPresentation, snapshot }; // Exposes a narrow read-only/debug seam without exposing mutable effect internals.

  const previousCombatUpdate = window.Combat.update; // Piggybacks the existing combat frame hook instead of starting a second animation loop.
  window.Combat.update = function heavyTelegraphAwareCombatUpdate(dt) {
    previousCombatUpdate(dt);
    updateHeavyAttackPresentation(dt);
  };

  window.__farmLog?.('[heavy-telegraph] offensive-heavy fire and Counter Shield field visuals installed.', 'combat');
})();

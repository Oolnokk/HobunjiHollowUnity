(() => {
  'use strict';

  // Spearfishing minigame ("Spear Bridge") + its bait-toss/bite-splash FX
  // particles — extracted out of game.js following the same window.<Namespace>
  // + init(deps) pattern already used by js/mount-system.js and the
  // js/combat/*.js modules. game.js's own tool-swing/avatar rendering code
  // (updateToolMesh) still reaches into this module's live state for two
  // things it needs to pose the player's harpoon during a throw: the
  // in-flight fishing "ready" pose (readyPose getter, mirrors window.Mounts'
  // getter-property precedent) and the fished tile's anchorWorld point (via
  // the `state` getter) — both read-only from game.js's side.
  //
  // Deliberately NOT moved here: the generic perpClamp() dead-zone helper
  // that happened to sit right after this section in game.js — it's used by
  // player/NPC/creature rotation throughout game.js, not fishing-specific.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  const FISHING_RING = {
    cx: 160, cy: 160,
    fishRadius: 96,      // ring the fish patrols (== prototype's grooveRadius)
    outerOffset: 56,     // bridge ring sits this far outside the fish ring
    segmentSize: 18,     // degrees, width of the rotating aim segment
    sweepSpeed: 240,     // degrees/sec
    shotDuration: 0.16,
    retractDuration: 0.28,
    panicStep: 34,
    panicMax: 100,
  };
  // Bait-cast pre-minigame timings (see beginFishingCast/updateFishingMinigame).
  const FISHING_BAIT_FLIGHT_S = 0.6; // matches spawnFishingBaitToss's ~0.5-0.62s particle flight time
  const FISHING_BITE_WAIT_MIN_S = 1.2;
  const FISHING_BITE_WAIT_MAX_S = 3.0;
  // Escape/respawn sequence timings, ported from the prototype's fishRespawn
  // state: when panic maxes out the fish doesn't just end the round, it visibly
  // slides into the central pool, shrinks away, waits, then a freshly rolled
  // fish grows in the pool and swims back out onto the ring.
  const FISH_RESPAWN_TIMING = {
    retreatDuration: 0.72,
    shrinkDuration: 0.42,
    waitDuration: 2.15,
    growDuration: 0.68,
    enterDuration: 0.88,
  };
  function angleDiffDeg(from, to) {
    let d = (to - from) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  }
  const FISH_CLASS_VEL_RANGE = {
    smooth:  [-0.15, 0.15],
    sinker:  [0.05, 0.55],
    floater: [-0.55, -0.05],
    dart:    [-0.55, 0.55],
    mixed:   [-0.35, 0.35],
  };
  const FISH_CLASS_RETARGET   = { smooth: 0.25, mixed: 0.55, sinker: 0.5, floater: 0.5, dart: 1.2 };
  const FISH_CLASS_SMOOTHNESS = { smooth: 0.8,  mixed: 1.4,  sinker: 1.5, floater: 1.5, dart: 4.0 };

  // Periodic "surface → dive into the safe zone → resurface" behavior —
  // unlike FISH_RESPAWN_TIMING's panic-triggered escape below, this is
  // unprompted: every fish does it on its own cadence as part of normal
  // movement, ported from the prototype's FishBehavior.maybeStartDive/
  // updateDiveOverlay (see docs/tools, or the uploaded prototype HTML).
  const FISH_CLASS_DIVE_CADENCE  = { smooth: 0.82, mixed: 1.0, sinker: 0.95, floater: 0.95, dart: 1.28 };
  const FISH_CLASS_DIVE_RADIUS   = { smooth: 0.78, mixed: 1.0, sinker: 0.92, floater: 0.92, dart: 1.3 };
  // The prototype uses two separate "indecision" tables with slightly
  // different numbers — one tunes how eagerly a dive starts, the other
  // how jittery the underwater inspect-motion looks. Kept distinct here
  // rather than merged, matching the source.
  const FISH_CLASS_DIVE_START_INDECISION   = { smooth: 0.8,  mixed: 1.0, sinker: 0.9, floater: 1.05, dart: 1.35 };
  const FISH_CLASS_DIVE_INSPECT_INDECISION = { smooth: 0.78, mixed: 1.0, sinker: 0.9, floater: 1.0,  dart: 1.42 };
  // The prototype's dive-radius formula below was tuned against its own
  // ring (SVG groove sits at r=340); scaling by this ratio makes the dive
  // pull proportionally as far toward the center on FISHING_RING's much
  // smaller scale instead of importing the raw prototype pixel values.
  const FISH_DIVE_RADIUS_SCALE = FISHING_RING.fishRadius / 340;
  const FISH_DIVE_TARGET_PERCENT = 50; // % of time (clamped 50-80) a fish aims to spend submerged

  // Real-asset rendering for the fish silhouette + harpoon/mace sprite, ported
  // from the spearfishing prototype's ensureFishDeformCanvas/renderImageFish/
  // renderBridgeSpearSprite. The fish body+whiskers PNGs face left, same as the
  // prototype's source art, so the same flipX/rotation convention applies as-is.
  const FISHING_BRIDGE_ART = {
    imgW: 64, imgH: 40,                 // deformed fish draw size (~matches the body PNG's aspect ratio)
    deformSlices: 28, boneCount: 6,
    boneAmpScale: 0.82, whiskerBoneAmpScale: 0.3, whiskerRate: 0.38,
    flipX: -1,                          // source silhouettes face left; mirror so facing=1 points right
    spriteWidth: 46, spriteHeight: 122,  // harpoon/mace sprite box (preserveAspectRatio keeps the real PNG shape)
    spriteRotationOffset: 90,           // the PNG's business end is at the bottom, not the top
    ropeAttachBack: 23, spearAttachFront: 10,
    ropeSag: 0.1,
    maceSpinRateDeg: 9720,              // ~27 spins/sec while the mace is outbound
  };

  let fishBodySpriteImage = null, fishWhiskersSpriteImage = null;
  let harpoonSpearSpriteImage = null, harpoonMaceSpriteImage = null;
  function loadFishSprite(src, onOk) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      onOk(img);
      window.__farmLog?.(`sprite loaded OK: ${src} (${img.naturalWidth}x${img.naturalHeight})`, 'fish');
    };
    img.onerror = (ev) => {
      window.__farmLog?.(`sprite FAILED to load: ${src}`, 'fish');
    };
    img.src = src;
    return img;
  }
  loadFishSprite('assets/hud/fish_silhouette-body.png', (img) => { fishBodySpriteImage = img; });
  loadFishSprite('assets/hud/fish_silhouette-whiskers.png', (img) => { fishWhiskersSpriteImage = img; });
  loadFishSprite('assets/toolsprites/harpoon_fishingspear.png', (img) => { harpoonSpearSpriteImage = img; });
  loadFishSprite('assets/toolsprites/harpoon_fishingmace.png', (img) => { harpoonMaceSpriteImage = img; });

  let fishDeformCanvas = null, fishDeformCtx = null;
  function ensureFishDeformCanvas(width, height) {
    const w = Math.max(48, Math.round(width));
    const h = Math.max(24, Math.round(height));
    if (!fishDeformCanvas) { fishDeformCanvas = document.createElement('canvas'); fishDeformCtx = fishDeformCanvas.getContext('2d'); }
    if (fishDeformCanvas.width !== w || fishDeformCanvas.height !== h) { fishDeformCanvas.width = w; fishDeformCanvas.height = h; }
    return { canvas: fishDeformCanvas, ctx: fishDeformCtx, w, h };
  }

  // Small spline-skeleton "bone" offsets sampled across deformSlices vertical strips,
  // tapered toward the head/tail so the deform bends most in the middle of the body.
  function buildFishBoneOffsets(sliceCount, amp, phase, rateScale) {
    const boneCount = FISHING_BRIDGE_ART.boneCount;
    const bones = [];
    for (let i = 0; i < boneCount; i++) {
      const t01 = boneCount === 1 ? 0.5 : i / (boneCount - 1);
      const taper = Math.sin(Math.PI * t01);
      const leadLag = t01 * Math.PI * 2.15;
      bones.push(Math.sin(phase * rateScale + leadLag) * amp * taper);
    }
    const offsets = [];
    for (let i = 0; i < sliceCount; i++) {
      const t01 = sliceCount === 1 ? 0.5 : i / (sliceCount - 1);
      const scaled = t01 * (bones.length - 1);
      const left = Math.max(0, Math.min(bones.length - 2, Math.floor(scaled)));
      const local = scaled - left;
      offsets.push(bones[left] + (bones[left + 1] - bones[left]) * local);
    }
    return offsets;
  }

  function drawFishImageAlongBones(ctx, image, canvasW, canvasH, drawW, drawH, offsets, alpha) {
    if (!image || !image.naturalWidth || !image.naturalHeight) return;
    const sliceCount = Math.max(4, offsets.length || 4);
    const srcSliceW = image.naturalWidth / sliceCount;
    const dstSliceW = drawW / sliceCount;
    const startX = (canvasW - drawW) * 0.5;
    const startY = (canvasH - drawH) * 0.5;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    for (let i = 0; i < sliceCount; i++) {
      const nextOffset = offsets[Math.min(offsets.length - 1, i + 1)] ?? offsets[i] ?? 0;
      const offset = offsets[i] || 0;
      const shear = deps.clamp((nextOffset - offset) / Math.max(1, dstSliceW), -0.32, 0.32);
      const sx = i * srcSliceW;
      const dx = startX + i * dstSliceW;
      const dy = startY + offset;
      ctx.save();
      ctx.beginPath();
      ctx.rect(dx - 1, 0, dstSliceW + 2, canvasH);
      ctx.clip();
      ctx.transform(1, shear, 0, 1, 0, 0);
      ctx.drawImage(image, sx, 0, srcSliceW + 1, image.naturalHeight, dx, dy - shear * dx, dstSliceW + 1.5, drawH);
      ctx.restore();
    }
    ctx.restore();
  }

  // toDataURL() is a synchronous PNG encode — doing it every animation frame
  // (60/sec) is what was tripping the browser's "requestAnimationFrame handler
  // took Nms" violation while fishing. The deform itself still redraws every
  // frame (cheap drawImage calls), but the expensive re-encode to a data URL
  // only happens a few times a second; the SVG <image> keeps showing the last
  // encoded frame in between, which reads as smooth at this swim speed.
  let _fishDeformUrlCache = null;
  let _fishDeformUrlCacheAt = -Infinity;
  const FISH_DEFORM_REENCODE_INTERVAL = 1 / 12; // seconds
  let _fishDeformLastFailReason = null;
  function renderFishDeformedTexture(fm) {
    if (!fishBodySpriteImage || !fishBodySpriteImage.naturalWidth) {
      if (_fishDeformLastFailReason !== 'noimg') {
        _fishDeformLastFailReason = 'noimg';
        window.__farmLog?.('fish render: body sprite not loaded yet, skipping draw', 'fish');
      }
      return null;
    }
    const art = FISHING_BRIDGE_ART;
    const pad = Math.ceil(art.imgH * 0.45);
    const targetW = Math.ceil(art.imgW + pad * 2);
    const targetH = Math.ceil(art.imgH + pad * 2);
    const { canvas, ctx, w, h } = ensureFishDeformCanvas(targetW, targetH);
    ctx.clearRect(0, 0, w, h);

    const phase = fm.fishAnimT * 7.5 + fm.fish.angle * 0.025;
    const bodyAmp = Math.max(2, art.imgH * 0.075 * art.boneAmpScale);
    const bodyOffsets = buildFishBoneOffsets(art.deformSlices, bodyAmp, phase, 1);
    const whiskerOffsets = buildFishBoneOffsets(art.deformSlices, bodyAmp * art.whiskerBoneAmpScale, phase + 0.85, art.whiskerRate);

    drawFishImageAlongBones(ctx, fishBodySpriteImage, w, h, art.imgW, art.imgH, bodyOffsets, 1);
    if (fishWhiskersSpriteImage && fishWhiskersSpriteImage.naturalWidth) {
      drawFishImageAlongBones(ctx, fishWhiskersSpriteImage, w, h, art.imgW, art.imgH, whiskerOffsets, 0.95);
    }
    if (_fishDeformUrlCache && fm.fishAnimT - _fishDeformUrlCacheAt < FISH_DEFORM_REENCODE_INTERVAL) {
      return { url: _fishDeformUrlCache, w, h };
    }
    try {
      _fishDeformUrlCache = canvas.toDataURL('image/png');
      _fishDeformUrlCacheAt = fm.fishAnimT;
      _fishDeformLastFailReason = null;
      return { url: _fishDeformUrlCache, w, h };
    } catch (err) {
      if (_fishDeformLastFailReason !== 'tainted') {
        _fishDeformLastFailReason = 'tainted';
        window.__farmLog?.(`fish render: canvas.toDataURL() threw (${err.name}: ${err.message}) — canvas likely tainted by a cross-origin sprite load`, 'fish');
      }
      return null;
    }
  }

  // non-null from the moment bait is cast through the whole ring minigame —
  // fm.phase tracks where in that sequence things are: 'cast' (bait
  // arcing through the air) -> 'waiting' (bait landed, watching for a
  // bite) -> 'bite' (splash happened, waiting on the player) -> 'active'
  // (ring open, existing spear-bridge gameplay).
  let fishingMinigame = null;
  let fishingEls = null; // cached ring SVG DOM refs — built on entering 'active', torn down on close
  const fishingOverlayEl = document.getElementById('fishingOverlay');
  // Held while waiting on a bite so game.js's tool-swing pose code can hold
  // the harpoon at its ready extreme (see the readyPose getter below) —
  // mirrors window.Mounts' rideState/rideEntity getter precedent.
  let fishingReadyPose = false;
  // Saved camera mode/target to restore when the minigame closes.
  let _prevCameraMode = null;
  let _prevCameraTarget = null;

  function currentFishZoneKey() {
    const currentArea = deps.getCurrentArea();
    if (currentArea === 'farm') return 'farm';
    if (currentArea === 'town') return 'town';
    if (currentArea === 'map_northern_cliffs') return 'northernCliffs';
    if (currentArea === 'map_southern_cloud_forest') return 'cloudForest';
    return null;
  }

  function fishingTimeOfDay() {
    const h = deps.getHour();
    if (h < 8)  return 'dawn';
    if (h < 17) return 'day';
    if (h < 20) return 'dusk';
    return 'night';
  }

  function pickFishForCurrentZone() {
    const zoneKey = currentFishZoneKey();
    if (!zoneKey) return null;
    const list = deps.FISH_DEFS[zoneKey] || [];
    if (!list.length) return null;
    const season = deps.currentSeason().name;
    const tod = fishingTimeOfDay();
    let pool = list.filter(f =>
      (f.seasons === 'any' || f.seasons.includes(season)) &&
      (f.timesOfDay === 'any' || f.timesOfDay.includes(tod)));
    if (!pool.length) pool = list;
    const rarityWeight = { common: 6, uncommon: 3, rare: 1 };
    const weights = pool.map(f => rarityWeight[f.rarity] || 1);
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) return { fish: pool[i], zoneKey };
    }
    return { fish: pool[pool.length - 1], zoneKey };
  }

  function fishPickTargetVel(fm) {
    const [min, max] = FISH_CLASS_VEL_RANGE[fm.fishClass] || FISH_CLASS_VEL_RANGE.mixed;
    const d = fm.difficulty / 100;
    fm.fish.targetVel = (min + Math.random() * (max - min)) * (0.6 + d * 0.9);
  }

  function fishStartTurnaround(fm, nextDir) {
    const f = fm.fish;
    if (!nextDir || nextDir === f.moveDir) return;
    f.turning = true;
    f.pendingMoveDir = nextDir;
    f.turnProgress = 0;
  }

  function fishUpdateTurnaround(fm, dt) {
    const f = fm.fish;
    if (!f.turning) return;
    f.turnProgress = deps.clamp(f.turnProgress + dt / 0.24, 0, 1);
    f.localFacingScale = f.moveDir * Math.cos(Math.PI * f.turnProgress);
    if (f.turnProgress >= 1) {
      f.turning = false;
      f.moveDir = f.pendingMoveDir || -f.moveDir;
      f.turnProgress = 0;
      f.localFacingScale = f.moveDir;
      f.vel = Math.abs(f.vel) * f.moveDir * 0.35;
      f.targetVel = Math.abs(f.targetVel) * f.moveDir;
    }
  }

  function fishStepMotion(fm, dt) {
    const f = fm.fish;
    const cls = fm.fishClass;
    const retargetChance = (FISH_CLASS_RETARGET[cls] ?? 0.55) * dt;
    const smoothness = FISH_CLASS_SMOOTHNESS[cls] ?? 1.4;
    const d = fm.difficulty / 100;

    if (Math.random() < retargetChance) fishPickTargetVel(fm);

    const desiredSource = Math.abs(f.targetVel) > 0.01 ? f.targetVel : (Math.abs(f.vel) > 0.01 ? f.vel : f.moveDir);
    const desiredDir = desiredSource < 0 ? -1 : 1;
    if (!f.turning && desiredDir !== f.moveDir) fishStartTurnaround(fm, desiredDir);
    fishUpdateTurnaround(fm, dt);

    let appliedTargetVel = f.turning ? Math.abs(f.targetVel) * f.moveDir : f.targetVel;
    f.vel += (appliedTargetVel - f.vel) * Math.min(1, dt * (2.5 + smoothness * 2.2));
    if (cls === 'sinker')  f.vel += 0.08 * dt * (0.5 + d);
    if (cls === 'floater') f.vel -= 0.08 * dt * (0.5 + d);
    if (f.turning) f.vel = Math.abs(f.vel) * f.moveDir;

    f.pos = deps.clamp(f.pos + f.vel * dt, 0, 1);
    if (f.pos <= 0.02) {
      f.pos = 0.02;
      if (!f.turning) {
        f.vel = Math.abs(f.vel) * 0.18;
        f.targetVel = Math.max(0.04, Math.abs(f.targetVel));
        if (f.moveDir < 0) fishStartTurnaround(fm, 1);
      }
    } else if (f.pos >= 0.98) {
      f.pos = 0.98;
      if (!f.turning) {
        f.vel = -Math.abs(f.vel) * 0.18;
        f.targetVel = -Math.max(0.04, Math.abs(f.targetVel));
        if (f.moveDir > 0) fishStartTurnaround(fm, -1);
      }
    }
    f.angle = (f.pos * 359) % 360;
  }

  // Rolls whether the fish starts a new unprompted dive this frame. The
  // hidden 1D ring patrol (fishStepMotion/f.angle) keeps running the whole
  // time — a dive only pulls the *visible* render position in toward the
  // center (f.renderRadius/f.renderAngle), it never pauses or reroutes the
  // underlying patrol. chancePerSecond is derived so that, on average, the
  // fish spends FISH_DIVE_TARGET_PERCENT of its time submerged.
  function fishMaybeStartDive(fm, dt) {
    const dive = fm.dive;
    if (dive.active) return false;
    dive.cooldown -= dt;
    if (dive.cooldown > 0) return false;

    const cls = fm.fishClass;
    const d01 = fm.difficulty / 100;
    const cadence = FISH_CLASS_DIVE_CADENCE[cls] ?? FISH_CLASS_DIVE_CADENCE.mixed;
    const radiusMul = FISH_CLASS_DIVE_RADIUS[cls] ?? FISH_CLASS_DIVE_RADIUS.mixed;
    const startIndecision = FISH_CLASS_DIVE_START_INDECISION[cls] ?? FISH_CLASS_DIVE_START_INDECISION.mixed;

    const diveDurationEstimate = 3.4 + startIndecision * 1.2 + d01 * 1.2;
    const targetFraction = deps.clamp(FISH_DIVE_TARGET_PERCENT / 100, 0.5, 0.8);
    const expectedSurfaceWindow = diveDurationEstimate * (1 - targetFraction) / Math.max(0.001, targetFraction);
    const chancePerSecond = 1 / Math.max(0.2, expectedSurfaceWindow * (1 / cadence));

    if (Math.random() < chancePerSecond * dt) {
      dive.active = true;
      dive.timer = 0;
      dive.lastDuration = diveDurationEstimate;
      dive.inspectTargetAngle = fm.fish.angle;
      dive.visualOffset = 0;
      dive.centerRadius = (72 + radiusMul * 18 + d01 * 16 + Math.random() * (14 + radiusMul * 8)) * FISH_DIVE_RADIUS_SCALE;
      dive.cooldown = Math.max(0.15, expectedSurfaceWindow * 0.2 + Math.random() * expectedSurfaceWindow * 0.28);
      fm.fish.dimmed = true;
      return true;
    }
    return false;
  }

  // Drives f.renderAngle/f.renderRadius through the dive: pull in toward
  // dive.centerRadius, "inspect" the pool by wandering visualOffset around
  // a periodically re-picked angle, then ease back out onto the ring.
  // Rather than ending on a fixed timer, the surfacing phase keeps easing
  // until both the angle offset and radius have actually converged back
  // onto the hidden ring track, so it can't visibly snap into place.
  function fishUpdateDiveOverlay(fm, dt) {
    const f = fm.fish, dive = fm.dive;
    const cls = fm.fishClass;
    const d01 = fm.difficulty / 100;
    const inspectIndecision = FISH_CLASS_DIVE_INSPECT_INDECISION[cls] ?? FISH_CLASS_DIVE_INSPECT_INDECISION.mixed;
    const inspectStep = 0.95 - inspectIndecision * 0.22 + (1 - d01) * 0.1;
    const inspectTurnRate = 1.8 + inspectIndecision * 1.4 + d01 * 0.8;
    const inspectWobble = 8 + inspectIndecision * 10;
    const enterExitRate = 4.8 + d01 * 1.4;

    dive.timer += dt;

    if (dive.timer < 0.45) {
      f.renderRadius += (dive.centerRadius - f.renderRadius) * Math.min(1, dt * enterExitRate);
    } else if (dive.timer < dive.lastDuration - 0.65) {
      const phase = dive.timer - 0.45;
      if (Math.floor(phase / Math.max(0.24, inspectStep)) !== Math.floor((phase - dt) / Math.max(0.24, inspectStep))) {
        const bias = cls === 'sinker' ? 180 : cls === 'floater' ? 0 : f.angle;
        dive.inspectTargetAngle = (bias + (Math.random() * 120 - 60) + Math.random() * 260 * (cls === 'dart' ? 0.22 : 0.08)) % 360;
      }
      const targetOffset = angleDiffDeg(f.angle, dive.inspectTargetAngle);
      dive.visualOffset += (targetOffset - dive.visualOffset) * Math.min(1, dt * inspectTurnRate);
      dive.visualOffset += Math.sin(dive.timer * (3.2 + inspectIndecision * 1.2)) * inspectWobble * dt;
      dive.visualOffset = deps.clamp(dive.visualOffset, -42, 42);

      f.renderRadius += (dive.centerRadius - f.renderRadius) * Math.min(1, dt * (2.4 + d01 * 1.1));
    } else {
      dive.visualOffset += (0 - dive.visualOffset) * Math.min(1, dt * 6.8);
      f.renderRadius += (FISHING_RING.fishRadius - f.renderRadius) * Math.min(1, dt * (enterExitRate + 1.2));

      const offsetDone = Math.abs(dive.visualOffset) < 0.55;
      const radiusDone = Math.abs(f.renderRadius - FISHING_RING.fishRadius) < 1.25;

      if (offsetDone && radiusDone) {
        dive.active = false;
        dive.visualOffset = 0;
        f.renderRadius = FISHING_RING.fishRadius;
        f.dimmed = false;
        f.renderAngle = f.angle;
      }
    }

    f.renderAngle = (f.angle + dive.visualOffset + 360) % 360;
  }
  function fishingPolarToXY(angleDeg, radius) {
    const rad = (angleDeg - 90) * Math.PI / 180; // 0deg = top, matches prototype orientation
    return { x: FISHING_RING.cx + Math.cos(rad) * radius, y: FISHING_RING.cy + Math.sin(rad) * radius };
  }

  function fishingDistPointToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 <= 0.0001) return Math.hypot(px - x1, py - y1);
    const t = deps.clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1);
    return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
  }

  // ── Fishing FX particles (bait toss / bite splash) ────────────────
  // Small one-off 3D bursts, deliberately separate from the existing
  // actionParticles (2D HUD-canvas tool feedback) and waterParticles
  // (ambient, tile-local trench bubbles) systems — these need to travel
  // through real 3D world space between the player and the fished tile.
  const fishingFxParticles = [];

  function spawnFishingFxParticle(pos, vel, opts = {}) {
    const size = opts.size ?? 0.03;
    const geo = new THREE.SphereGeometry(size, 4, 3);
    const mat = new THREE.MeshBasicMaterial({ color: opts.color ?? 0xffffff, transparent: true, opacity: 1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, pos.y, pos.z);
    // Farm has its own scene; town/interiors/wilderness zones each have
    // their own too (see getActiveScene) — adding straight to the bare
    // farm `scene` here meant these never rendered anywhere else.
    deps.getActiveScene().add(mesh);
    fishingFxParticles.push({
      mesh, mat,
      vx: vel.x, vy: vel.y, vz: vel.z,
      gravity: opts.gravity ?? -4.2,
      // Bob mode (bobAmp > 0) ignores gravity/vy entirely and instead
      // rides a sine wave around baseY — for things that sit and drift
      // on the water surface rather than falling, like the bait float.
      bobAmp: opts.bobAmp || 0,
      bobRate: opts.bobRate || 3,
      bobPhase: Math.random() * Math.PI * 2,
      baseY: pos.y,
      age: 0,
      maxAge: opts.maxAge ?? 0.55,
    });
  }

  // Arcs a handful of small particles from the player toward the fished
  // water tile — cosmetic stand-in for tossing bait onto the surface.
  // These avatars have no arms to actually throw with, so the particle
  // arc alone has to sell the motion (see beginFishingCast).
  function spawnFishingBaitToss(fromWorld, toWorld) {
    const dx = toWorld.x - fromWorld.x, dz = toWorld.z - fromWorld.z;
    for (let i = 0; i < 7; i++) {
      const T = 0.5 + Math.random() * 0.12;          // flight time
      const h = 0.3 + Math.random() * 0.15;           // arc peak height
      const gravity = -8 * h / (T * T);
      const vy = 4 * h / T;
      const jitter = 0.06;
      spawnFishingFxParticle(
        { x: fromWorld.x, y: fromWorld.y + 0.5, z: fromWorld.z },
        { x: dx / T + (Math.random() - 0.5) * jitter, y: vy, z: dz / T + (Math.random() - 0.5) * jitter },
        { size: 0.025 + Math.random() * 0.02, color: 0xcdaa6b, gravity, maxAge: T }
      );
    }
  }

  // One pink fleck drifting/bobbing on the water surface — spawned
  // repeatedly (see updateFishingMinigame's 'cast'/'waiting' handling)
  // for as long as the player is waiting on a bite, so the surface
  // reads as continuously "baited" rather than a one-off toss.
  function spawnFishingFloatParticle(atWorld) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 0.05 + Math.random() * 0.32;
    spawnFishingFxParticle(
      { x: atWorld.x + Math.cos(angle) * dist, y: atWorld.y + 0.015, z: atWorld.z + Math.sin(angle) * dist },
      { x: (Math.random() - 0.5) * 0.05, y: 0, z: (Math.random() - 0.5) * 0.05 },
      { size: 0.018 + Math.random() * 0.016, color: 0xff6fb0, maxAge: 2.0 + Math.random() * 1.4, bobAmp: 0.012 + Math.random() * 0.008, bobRate: 2.2 + Math.random() * 1.4 }
    );
  }

  // Sustained bubbling patch for the bite — several small bubbles
  // rising and wobbling at different speeds/lifetimes instead of one
  // instant splash burst, so it visibly reads as bubbling for a beat
  // rather than a single flash of particles.
  function spawnFishingBiteSplash(atWorld) {
    for (let i = 0; i < 22; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * 0.1;
      const speed = 0.25 + Math.random() * 0.55;
      spawnFishingFxParticle(
        { x: atWorld.x + Math.cos(angle) * dist, y: atWorld.y + 0.02, z: atWorld.z + Math.sin(angle) * dist },
        // bobAmp mode uses y as a steady rise rate (bubbles don't
        // decelerate under gravity the way a thrown particle would).
        { x: Math.cos(angle) * speed * 0.3, y: 0.5 + Math.random() * 0.7, z: Math.sin(angle) * speed * 0.3 },
        { size: 0.022 + Math.random() * 0.026, color: 0xeaf7ff, maxAge: 0.5 + Math.random() * 0.55, bobAmp: 0.01, bobRate: 8 + Math.random() * 6 }
      );
    }
  }

  function updateFishingFxParticles(dt) {
    for (let i = fishingFxParticles.length - 1; i >= 0; i--) {
      const p = fishingFxParticles[i];
      p.age += dt;
      if (p.age >= p.maxAge) {
        p.mesh.parent?.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mat.dispose();
        fishingFxParticles.splice(i, 1);
        continue;
      }
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.z += p.vz * dt;
      if (p.bobAmp) {
        p.baseY += p.vy * dt;
        p.mesh.position.y = p.baseY + Math.sin((p.age + p.bobPhase) * p.bobRate) * p.bobAmp;
      } else {
        p.vy += p.gravity * dt;
        p.mesh.position.y += p.vy * dt;
      }
      p.mat.opacity = Math.max(0, 1 - p.age / p.maxAge);
    }
  }

  // Entry point (replaces the old immediate-start startFishingMinigame):
  // interacting with water while a harpoon is equipped only casts bait
  // and swaps the camera — the ring doesn't open until the player
  // confirms a bite (see beginFishingRing). World time/NPCs/weather keep
  // running throughout; only player movement is suspended (see the guard
  // in updateMovement).
  function beginFishingCast() {
    const picked = pickFishForCurrentZone();
    if (!picked) { deps.showToast('No fish here.', false); return; }
    const { fish, zoneKey } = picked;
    // Anchor the floating ring over the actual river tile being fished, so it
    // tracks the live 3D scene's camera angle instead of sitting in a fixed
    // modal position (see updateFishingRingScreenPosition/worldToOverlay).
    const reticle = deps.getReticleTile();
    const reticleTile = deps.getActiveTileAt(reticle.col, reticle.row);
    // tileSurfaceY(type) alone ignores the tile's own elevTier — fine on
    // town/farm's flat single-tier grid, but an exterior zone's water can
    // sit on any plateau tier (see tileSurfaceYInArea's own comment).
    // Anchoring on the bare ground-level Y here dragged the fishing
    // camera (see below) down to ground level for the whole minigame
    // whenever the fished water was actually up on a plateau.
    const anchorWorld = {
      x: reticle.col + 0.5,
      z: reticle.row + 0.5,
      y: deps.tileSurfaceYInArea(reticleTile, deps.getCurrentArea()) + 0.35,
    };
    fishingMinigame = {
      phase: 'cast',
      phaseTimer: 0,
      floatSpawnTimer: 0,
      biteAt: FISHING_BITE_WAIT_MIN_S + Math.random() * (FISHING_BITE_WAIT_MAX_S - FISHING_BITE_WAIT_MIN_S),
      anchorWorld,
      fishDef: fish,
      zoneKey,
      difficulty: fish.difficulty,
      fishClass: fish.fishClass,
      active: true,
    };
    // Hold the harpoon at its windup extreme for the whole cast/waiting/
    // bite sequence, so the character visibly looks like it's getting
    // ready instead of resting in its normal idle pose.
    fishingReadyPose = true;
    const playerMesh = deps.playerMesh;
    spawnFishingBaitToss(
      { x: playerMesh.position.x, y: playerMesh.position.y, z: playerMesh.position.z },
      anchorWorld
    );
    window.AudioSystem?.playObjectSfx(window.AudioSystem?.objectSfxConfig().fishCast);
    fishingOverlayEl.innerHTML = '';
    fishingEls = null;
    fishingOverlayEl.classList.add('open');

    // Swap to the "fishing" camera mode (fixed diagonal offset, matching the
    // (HA)SpearFishingMinigameV2 prototype's cube/river framing) and track the
    // fished water tile instead of the player while the minigame is open.
    _prevCameraMode = deps.getCameraMode();
    _prevCameraTarget = deps.getCameraTarget();
    deps.setCameraMode('fishing');
    deps.setCameraTarget({ position: new THREE.Vector3(anchorWorld.x, anchorWorld.y, anchorWorld.z) });

    // Drop the harpoon's "Fish" arc button immediately (computeActionButtons
    // returns [] while fishingMinigame.active — see there) instead of
    // waiting for whatever next unrelated event happens to call
    // refreshActionBar(); fishing's real controls are #actionPrompt now.
    deps.refreshActionBar();
    setNonFishingArcControlsHidden(true);
  }

  // Opens the actual spear-bridge ring once the player confirms a bite
  // (fm.phase 'bite' -> 'active') — extends the existing fm in place
  // rather than replacing it, so anchorWorld/camera/overlay state from
  // beginFishingCast carries straight through.
  function beginFishingRing(fm) {
    fm.phase = 'active';
    fm.fishAnimT = 0;
    fm.fish = {
      pos: Math.random(), vel: 0, targetVel: 0, angle: 0,
      renderAngle: 0, renderRadius: FISHING_RING.fishRadius, dimmed: false,
      moveDir: 1, pendingMoveDir: 1, turning: false, turnProgress: 0, localFacingScale: 1,
    };
    fm.dive = {
      active: false, timer: 0, cooldown: 3 + Math.random() * 4,
      inspectTargetAngle: 0, centerRadius: FISHING_RING.fishRadius * 0.3, lastDuration: 0, visualOffset: 0,
    };
    fm.bridge = {
      angle: 0, direction: 1, segmentSize: FISHING_RING.segmentSize, speed: FISHING_RING.sweepSpeed,
      markerA: null, markerB: null, spearActive: false, lineA: null, lineB: null,
      shotTimer: 0, retractTimer: 0, tipX: 0, tipY: 0, prevTipX: 0, prevTipY: 0, caughtFish: false,
      weaponSpinDeg: 0, frozenWeaponAngleDeg: 0,
    };
    fm.panic = 0;
    fm.resolved = false;
    fm.resultTimer = 0;
    fm.message = 'Tap Fire to drop the first marker.';
    fm.messageType = '';
    fm.respawn = {
      active: false, phase: 'idle', timer: 0, scale: 1,
      startAngle: 0, startRadius: FISHING_RING.fishRadius,
      centerAngle: 0, centerRadius: 0,
      enterStartAngle: 0, enterStartRadius: 0, enterTargetAngle: 0,
    };
    fishPickTargetVel(fm);
    _fishDeformUrlCache = null;
    _fishDeformUrlCacheAt = -Infinity;
    fishingReadyPose = false;
    window.__farmLog?.(`fishing ring opened: zone=${fm.zoneKey} fish=${fm.fishDef.key} anchor=(${fm.anchorWorld.x.toFixed(2)},${fm.anchorWorld.y.toFixed(2)},${fm.anchorWorld.z.toFixed(2)}) bodyImgLoaded=${!!(fishBodySpriteImage && fishBodySpriteImage.naturalWidth)}`);
    // The prompt DOM (button/status/panic/cancel) persists across this
    // transition; only the ring SVG is fresh here.
    fishingEls = null;
    renderFishingOverlay();
  }

  // Dispatches the "primary" fishing button/key press (action bar tap,
  // Space/Enter) to whatever it means at the current phase: confirm a
  // bite to open the ring, or place/fire a bridge marker once it's open.
  // No-op during 'cast'/'waiting' — there's nothing to do until a bite.
  function fishingPrimaryAction() {
    const fm = fishingMinigame;
    if (!fm) return;
    if (fm.phase === 'bite') { beginFishingRing(fm); return; }
    if (fm.phase === 'active') { fireFishingBridge(); return; }
    // The catch "showoff" view (beginFishCatchView) previously only
    // dismissed via a pointerup listener on #fcvContinueBtn — keyboard
    // (Space/Enter/E) and gamepad (interact/action1) both already route
    // into fishingPrimaryAction for every other phase (see the keydown
    // handler and runInputAction), but this phase fell through as a
    // no-op, leaving controller/keyboard players stuck unable to
    // continue without a mouse/touch tap.
    if (fm.phase === 'caught') { continueFromFishCatch(); return; }
  }

  // The dynamic action-bar buttons (btnAction1-3/btnItemAction1-2) already
  // swap to fish_primary/fish_cancel while fishing is active (see
  // computeActionButtons), but the tool-select/item-select dial openers
  // and the weapon quick-switch button are separate, always-on controls
  // that don't go through that array at all — nothing stopped a player
  // from switching away from the harpoon (or opening the item wheel)
  // mid-cast. Hidden outright (not just disabled) so their own
  // press/hold listeners can't fire either.
  function setNonFishingArcControlsHidden(hidden) {
    const display = hidden ? 'none' : '';
    const toolBtnEl = document.getElementById('toolBtn');
    if (toolBtnEl) toolBtnEl.style.display = display;
    const itemBtnEl = document.getElementById('itemBtn');
    if (itemBtnEl) itemBtnEl.style.display = display;
    const btnWeaponSwitchEl = document.getElementById('btnWeaponSwitch');
    if (btnWeaponSwitchEl) btnWeaponSwitchEl.style.display = display;
    const dodgeBtnEl = document.getElementById('dodgeBtn');
    if (dodgeBtnEl) dodgeBtnEl.style.display = display;
  }

  function closeFishingMinigame() {
    if (!fishingMinigame) return;
    fishingMinigame = null;
    fishingReadyPose = false;
    fishingOverlayEl.classList.remove('open');
    fishingOverlayEl.innerHTML = '';
    fishingEls = null;
    deps.hideActionPrompt();
    hideFishCatchView();
    setNonFishingArcControlsHidden(false);
    // Always return to holding the harpoon, ready to fish again —
    // covers the catch-view popup, which temporarily switches to
    // heldMode 'item' so the held-item system can show the caught fish
    // (see beginFishCatchView). A no-op for every other exit path,
    // since heldMode/activeTool are never touched outside that popup.
    deps.setHeldMode('tool');
    deps.setActiveTool('harpoon');
    deps.refreshActionBar();
    if (_prevCameraMode !== null) { deps.setCameraMode(_prevCameraMode); _prevCameraMode = null; }
    deps.setCameraTarget(_prevCameraTarget);
    _prevCameraTarget = null;
  }

  function fireFishingBridge() {
    const fm = fishingMinigame;
    if (!fm || fm.resolved || fm.respawn.active || fm.bridge.spearActive) return;
    const b = fm.bridge;
    const currentAngle = b.angle;
    if (b.markerA == null) {
      b.markerA = currentAngle;
      b.markerB = null;
      fm.message = 'First marker placed. Tap Fire again.';
      fm.messageType = '';
      return;
    }
    b.markerB = currentAngle;
    b.lineA = b.markerA;
    b.lineB = b.markerB;
    b.spearActive = true;
    b.shotTimer = 0;
    b.retractTimer = 0;
    b.caughtFish = false;
    const outerRadius = FISHING_RING.fishRadius + FISHING_RING.outerOffset;
    const a = fishingPolarToXY(b.lineA, outerRadius);
    b.tipX = b.prevTipX = a.x;
    b.tipY = b.prevTipY = a.y;
    b.direction *= -1;
    b.markerA = null;
    b.markerB = null;
    fm.message = 'Spear thrown!';
    fm.messageType = '';

    // Cosmetic 3D-world throw: reuse the hoe/chop swing arc (raise → slam) but
    // fly the held harpoon mesh out to the fishing anchor mid-slam instead of
    // slamming it down at the player's feet, then ease it back to the hand.
    // Duration must stay under the 2D ring's shot+retract window (~0.44s) so a
    // repeat cast can't restart the swing while the mesh is still mid-flight.
    deps.setToolSwingDur(0.42);
    deps.setToolSwingT(0.42);
    deps.setStrikeFired(true); // fishing has no pendingAction to fire on strike
    deps.setFishThrowActive(true);
  }

  function fishingTryTipCatch(fm) {
    const b = fm.bridge;
    if (b.caughtFish || !b.spearActive) return false;
    // Diving pulls the fish's *rendered* position off the ring toward the
    // center (fm.fish.renderAngle/renderRadius) — testing against that
    // instead of the hidden ring angle/fixed ring radius is what makes a
    // dive genuinely unhittable, not just visually distinct. The explicit
    // dive.active check is a belt-and-suspenders guard for the first
    // instant of a dive, before renderRadius has eased inward enough for
    // distance alone to rule it out.
    if (fm.dive.active) return false;
    const fishPos = fishingPolarToXY(fm.fish.renderAngle, fm.fish.renderRadius);
    const colliderRadius = 14;
    const dist = fishingDistPointToSegment(fishPos.x, fishPos.y, b.prevTipX, b.prevTipY, b.tipX, b.tipY);
    if (dist <= colliderRadius) { b.caughtFish = true; return true; }
    return false;
  }

  function resolveFishingRound(fm, caught) {
    if (caught) {
      fm.resolved = true;
      deps.inventory[fm.fishDef.key] = Math.min(99, (deps.inventory[fm.fishDef.key] || 0) + 1);
      const stars = deps.rollItemStars();
      fm.message = `Caught a ${deps.starRatingText(stars)} ${fm.fishDef.label}! ${fm.fishDef.icon}`;
      fm.messageType = 'good';
      deps.setLastActionMessage(fm.message);
      deps.awardToolUseMasteryXp('harpoon');
      window.AudioSystem?.playWeaponSlashSfx();
      beginFishCatchView(fm, stars);
      return;
    }
    // Escaping used to slide the fish into the pool and swim a fresh
    // one back out (beginFishEscapeRespawn), letting the player keep
    // fishing the same cast indefinitely. Now a single escape just
    // ends the round and drops back to normal gameplay.
    fm.resolved = true;
    window.AudioSystem?.playObjectSfx(window.AudioSystem?.objectSfxConfig().fishMiss);
    deps.showToast('The fish got away!', false);
    closeFishingMinigame();
  }

  let fishCatchViewEls = null;
  function buildFishCatchViewDom() {
    if (fishCatchViewEls) return;
    const el = document.getElementById('fishCatchView');
    if (!el) return;
    fishCatchViewEls = {
      el,
      stars: document.getElementById('fcvStars'),
      text: document.getElementById('fcvText'),
      continueBtn: document.getElementById('fcvContinueBtn'),
    };
    fishCatchViewEls.continueBtn.addEventListener('pointerup', (e) => { e.stopPropagation(); continueFromFishCatch(); });
  }

  // The catch "victory view": zooms/angles the camera onto the player
  // (a zoomed-out cousin of the NPC dialogue camera — see the
  // 'fishCatch' camera mode config) while they face the camera and
  // hold the caught fish to their chest via the same held-item system
  // bag items use (heldMode 'item' — see heldItemHolder/
  // updateHeldItemHolder), captioned with its star rating. Stays up
  // until the player taps Continue (continueFromFishCatch), not on a
  // timer — see updateFishingMinigame's 'caught' early return.
  function beginFishCatchView(fm, stars) {
    fm.phase = 'caught';
    deps.hideActionPrompt();
    // The ring SVG would otherwise stay frozen on-screen at its last
    // rendered frame — renderFishingOverlay never runs again once
    // updateFishingMinigame's 'caught' branch takes over.
    fishingOverlayEl.classList.remove('open');
    // Same reason: renderFishingOverlay (which otherwise keeps the arc's
    // fish_primary/fish_cancel buttons in sync) stops running once
    // 'caught' takes over, so without this the last active-phase arc
    // buttons would stay stuck on screen underneath the victory view.
    deps.refreshActionBar();

    // Face the fixed fishCatch camera (azimuthDeg 0 in its config sits
    // south of the player looking north, matching playerFacing 0)
    // regardless of whichever way the player was actually fishing.
    deps.setPlayerFacing(0);

    // Point the held-item system at the fish that was just caught,
    // not whatever bag item the player had selected before fishing.
    const idx = deps.getInventoryStackKeys('all').indexOf(fm.fishDef.key);
    if (idx >= 0) deps.setActiveItemIndex(idx);
    deps.setHeldMode('item');

    // _prevCameraMode/_prevCameraTarget already hold the pre-fishing
    // camera from beginFishingCast — left untouched here so Continue
    // (closeFishingMinigame) restores straight back to it, skipping
    // over the 'fishing' ring camera entirely.
    deps.setCameraMode('fishCatch');
    deps.setCameraTarget(null); // updateCameraPosition falls back to tracking the player directly

    buildFishCatchViewDom();
    if (!fishCatchViewEls) return;
    fishCatchViewEls.stars.textContent = deps.starRatingText(stars);
    fishCatchViewEls.text.textContent = `You caught a ${stars} Star ${fm.fishDef.label}`;
    fishCatchViewEls.el.classList.add('open');
    fishCatchViewEls.el.setAttribute('aria-hidden', 'false');
  }

  function hideFishCatchView() {
    if (!fishCatchViewEls) return;
    fishCatchViewEls.el.classList.remove('open');
    fishCatchViewEls.el.setAttribute('aria-hidden', 'true');
  }

  function continueFromFishCatch() {
    closeFishingMinigame();
  }

  function respawnNextFish(fm) {
    const picked = pickFishForCurrentZone();
    const fish = picked ? picked.fish : fm.fishDef;
    fm.fishDef = fish;
    fm.difficulty = fish.difficulty;
    fm.fishClass = fish.fishClass;
    fm.fish.pos = Math.random();
    fm.fish.vel = 0;
    fm.fish.targetVel = 0;
    fm.fish.moveDir = 1;
    fm.fish.pendingMoveDir = 1;
    fm.fish.turning = false;
    fm.fish.turnProgress = 0;
    fm.fish.localFacingScale = 1;
    fishPickTargetVel(fm);
    fm.panic = 0;
    fm.dive.active = false;
    fm.dive.timer = 0;
    fm.dive.visualOffset = 0;
    fm.dive.cooldown = 3 + Math.random() * 4;
    fm.fish.dimmed = false;
    const r = fm.respawn;
    r.enterStartAngle = r.centerAngle;
    r.enterStartRadius = r.centerRadius;
    r.enterTargetAngle = fm.fish.angle;
  }

  function beginFishPoolEnter(fm) {
    const r = fm.respawn;
    r.phase = 'enter';
    r.timer = 0;
    r.scale = 1;
    r.enterStartAngle = r.centerAngle;
    r.enterStartRadius = r.centerRadius;
    r.enterTargetAngle = fm.fish.angle;
    fm.message = 'New fish is swimming back to the ring.';
    fm.messageType = '';
  }

  function finishFishPoolEnter(fm) {
    const r = fm.respawn;
    r.active = false;
    r.phase = 'idle';
    r.timer = 0;
    r.scale = 1;
    fm.message = 'New fish entered. Tap Fire to drop the first marker.';
    fm.messageType = '';
  }

  function updateFishRespawnAnimation(fm, dt) {
    const r = fm.respawn;
    const T = FISH_RESPAWN_TIMING;
    r.timer += dt;
    if (r.phase === 'retreat' && r.timer >= T.retreatDuration) {
      r.phase = 'shrink'; r.timer = 0; r.scale = 1;
    } else if (r.phase === 'shrink' && r.timer >= T.shrinkDuration) {
      r.phase = 'wait'; r.timer = 0; r.scale = 0;
    } else if (r.phase === 'wait' && r.timer >= T.waitDuration) {
      r.phase = 'grow'; r.timer = 0; r.scale = 0;
      respawnNextFish(fm);
    } else if (r.phase === 'grow' && r.timer >= T.growDuration) {
      beginFishPoolEnter(fm);
    } else if (r.phase === 'enter') {
      fishStepMotion(fm, dt);
      r.enterTargetAngle = fm.fish.angle;
      if (r.timer >= T.enterDuration) finishFishPoolEnter(fm);
    }
  }

  // Visual-only pose during the escape/respawn sequence: where to draw the
  // fish (pool center vs sliding/growing) and at what scale. Returns null
  // once the sequence is over so normal ring rendering takes over again.
  function getRespawnFishPose(fm) {
    const r = fm.respawn;
    if (!r.active) return null;
    const T = FISH_RESPAWN_TIMING;
    if (r.phase === 'retreat') {
      const t = deps.clamp(r.timer / T.retreatDuration, 0, 1);
      const angle = r.startAngle + angleDiffDeg(r.startAngle, r.centerAngle) * t;
      const radius = r.startRadius + (r.centerRadius - r.startRadius) * t;
      return { angle, radius, scale: 1 };
    }
    if (r.phase === 'shrink') {
      const t = deps.clamp(r.timer / T.shrinkDuration, 0, 1);
      return { angle: r.centerAngle, radius: r.centerRadius, scale: Math.max(0, 1 - t) };
    }
    if (r.phase === 'wait') {
      return { angle: r.centerAngle, radius: r.centerRadius, scale: 0 };
    }
    if (r.phase === 'grow') {
      const t = deps.clamp(r.timer / T.growDuration, 0, 1);
      return { angle: r.centerAngle, radius: r.centerRadius, scale: t };
    }
    if (r.phase === 'enter') {
      const t = deps.clamp(r.timer / T.enterDuration, 0, 1);
      const angle = r.enterStartAngle + angleDiffDeg(r.enterStartAngle, r.enterTargetAngle) * t;
      const radius = r.enterStartRadius + (FISHING_RING.fishRadius - r.enterStartRadius) * t;
      return { angle, radius, scale: 1 };
    }
    return null;
  }

  function updateFishingMinigame(dt) {
    const fm = fishingMinigame;
    if (!fm) return;

    // The catch-view popup (camera zoom + star rating + Continue) is
    // static per-frame — it only advances via its own button, not a
    // timer — see beginFishCatchView/continueFromFishCatch.
    if (fm.phase === 'caught') return;

    if (fm.phase !== 'active') {
      fm.phaseTimer += dt;
      if (fm.phase === 'cast' || fm.phase === 'waiting') {
        fm.floatSpawnTimer -= dt;
        if (fm.floatSpawnTimer <= 0) {
          spawnFishingFloatParticle(fm.anchorWorld);
          fm.floatSpawnTimer = 0.3 + Math.random() * 0.3;
        }
      }
      if (fm.phase === 'cast' && fm.phaseTimer >= FISHING_BAIT_FLIGHT_S) {
        fm.phase = 'waiting';
        fm.phaseTimer = 0;
      } else if (fm.phase === 'waiting' && fm.phaseTimer >= fm.biteAt) {
        spawnFishingBiteSplash(fm.anchorWorld);
        window.AudioSystem?.playObjectSfx(window.AudioSystem?.objectSfxConfig().fishBite);
        fm.phase = 'bite';
      }
      renderFishingOverlay();
      return;
    }

    if (fm.respawn.active) {
      fm.fishAnimT += dt;
      updateFishRespawnAnimation(fm, dt);
      renderFishingOverlay();
      return;
    }

    fm.fishAnimT += dt;
    fishStepMotion(fm, dt);

    if (fishMaybeStartDive(fm, dt) || fm.dive.active) {
      fishUpdateDiveOverlay(fm, dt);
    } else {
      fm.fish.renderRadius = FISHING_RING.fishRadius;
      fm.fish.renderAngle = fm.fish.angle;
      fm.fish.dimmed = false;
    }

    const b = fm.bridge;
    b.angle = (b.angle + b.speed * b.direction * dt + 360) % 360;

    if (b.spearActive) {
      const outerRadius = FISHING_RING.fishRadius + FISHING_RING.outerOffset;
      const a = fishingPolarToXY(b.lineA, outerRadius);
      const bPt = fishingPolarToXY(b.lineB, outerRadius);
      b.prevTipX = b.tipX;
      b.prevTipY = b.tipY;

      if (b.shotTimer < FISHING_RING.shotDuration) {
        b.weaponSpinDeg = (b.weaponSpinDeg + FISHING_BRIDGE_ART.maceSpinRateDeg * dt) % 360;
        b.frozenWeaponAngleDeg = Math.atan2(bPt.y - a.y, bPt.x - a.x) * 180 / Math.PI + FISHING_BRIDGE_ART.spriteRotationOffset;
        b.shotTimer = Math.min(FISHING_RING.shotDuration, b.shotTimer + dt);
        const t = b.shotTimer / FISHING_RING.shotDuration;
        b.tipX = a.x + (bPt.x - a.x) * t;
        b.tipY = a.y + (bPt.y - a.y) * t;
        fishingTryTipCatch(fm);
      } else if (b.retractTimer < FISHING_RING.retractDuration) {
        b.weaponSpinDeg = 0;
        b.frozenWeaponAngleDeg = Math.atan2(bPt.y - a.y, bPt.x - a.x) * 180 / Math.PI + FISHING_BRIDGE_ART.spriteRotationOffset;
        b.retractTimer = Math.min(FISHING_RING.retractDuration, b.retractTimer + dt);
        const t = b.retractTimer / FISHING_RING.retractDuration;
        b.tipX = bPt.x + (a.x - bPt.x) * t;
        b.tipY = bPt.y + (a.y - bPt.y) * t;
      } else if (b.caughtFish) {
        // Leave the bridge/spear state alone on a catch — the fish stays
        // pinned to the (now fully retracted) tip position for the whole
        // "Caught!" celebration window instead of popping back onto the
        // ring the instant it resolves. closeFishingMinigame() discards
        // the whole fishingMinigame object once the round actually ends,
        // so there's nothing to clean up here.
        resolveFishingRound(fm, true);
      } else {
        fm.panic = Math.min(FISHING_RING.panicMax, fm.panic + FISHING_RING.panicStep);
        if (fm.panic >= FISHING_RING.panicMax) {
          resolveFishingRound(fm, false);
        } else {
          fm.message = 'Missed! Panic rising.';
          fm.messageType = 'bad';
        }
        b.spearActive = false;
        b.lineA = null;
        b.lineB = null;
        b.shotTimer = 0;
        b.retractTimer = 0;
        b.caughtFish = false;
      }
    }

    renderFishingOverlay();
  }

  // Built once on entering 'active' (the ring SVG only — the "Ready
  // Harpoon"/"Throw Harpoon" button itself is an arc button, built by
  // computeActionButtons/applyAbt; the bottom-of-screen action prompt
  // just mirrors it as an info display, see renderFishingOverlay).
  function buildFishingRingDom() {
    const R = FISHING_RING;
    const outerRadius = R.fishRadius + R.outerOffset;
    const ringWrap = document.createElement('div');
    ringWrap.className = 'fish-ring-wrap';
    ringWrap.id = 'fishRingWrap';
    ringWrap.innerHTML = `
      <svg viewBox="0 0 ${R.cx * 2} ${R.cy * 2}">
        <circle cx="${R.cx}" cy="${R.cy}" r="${R.fishRadius}" fill="none" stroke="rgba(127,232,154,0.4)" stroke-width="2"/>
        <circle cx="${R.cx}" cy="${R.cy}" r="${outerRadius}" fill="none" stroke="rgba(255,255,255,0.32)" stroke-width="2"/>
        <path id="fishSegArc" fill="none" stroke="#f9e28a" stroke-width="6" stroke-linecap="round"/>
        <circle id="fishMarkerA" r="5" fill="#ff8060" opacity="0"/>
        <circle id="fishMarkerB" r="5" fill="#ff8060" opacity="0"/>
        <path id="fishSpearRope" fill="none" stroke="#cbb892" stroke-width="2" opacity="0"/>
        <g id="fishSpearSpriteWrap" opacity="0"><image id="fishSpearImage" preserveAspectRatio="xMidYMid meet"/></g>
        <g id="fishImageRig" opacity="0"><g id="fishImageTransform"><image id="fishDeformedImage" preserveAspectRatio="none"/></g></g>
      </svg>`;
    fishingOverlayEl.insertBefore(ringWrap, fishingOverlayEl.firstChild);

    fishingEls = {
      ringWrap,
      segArc: document.getElementById('fishSegArc'),
      markerA: document.getElementById('fishMarkerA'),
      markerB: document.getElementById('fishMarkerB'),
      spearRope: document.getElementById('fishSpearRope'),
      spearSpriteWrap: document.getElementById('fishSpearSpriteWrap'),
      spearImage: document.getElementById('fishSpearImage'),
      fishImageRig: document.getElementById('fishImageRig'),
      fishImageTransform: document.getElementById('fishImageTransform'),
      fishDeformedImage: document.getElementById('fishDeformedImage'),
    };
  }

  // Ported from the prototype's renderBridgeSpearSprite: positions the real
  // harpoon/mace PNG (business end at the image's bottom) rotated along the
  // flight chord, with a quadratic-bezier rope back to the launch point, and
  // (mace only) a rapid spin while outbound that freezes once retracting.
  function renderFishingSpearSprite(startPoint, endPoint) {
    const art = FISHING_BRIDGE_ART;
    const useMace = deps.equipmentSlots.harpoon === 'fishingmace';
    const spriteImg = useMace ? harpoonMaceSpriteImage : harpoonSpearSpriteImage;
    const dx = endPoint.x - startPoint.x, dy = endPoint.y - startPoint.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    const ropeEndX = useMace ? endPoint.x : endPoint.x - ux * art.ropeAttachBack;
    const ropeEndY = useMace ? endPoint.y : endPoint.y - uy * art.ropeAttachBack;
    const sag = Math.min(22, len * art.ropeSag);
    const ctrlX = (startPoint.x + ropeEndX) * 0.5 + nx * sag;
    const ctrlY = (startPoint.y + ropeEndY) * 0.5 + ny * sag;
    fishingEls.spearRope.setAttribute('d', `M ${startPoint.x.toFixed(2)} ${startPoint.y.toFixed(2)} Q ${ctrlX.toFixed(2)} ${ctrlY.toFixed(2)} ${ropeEndX.toFixed(2)} ${ropeEndY.toFixed(2)}`);
    fishingEls.spearRope.setAttribute('opacity', '1');

    if (!spriteImg || !spriteImg.naturalWidth) { fishingEls.spearSpriteWrap.setAttribute('opacity', '0'); return; }

    const spriteW = art.spriteWidth, spriteH = art.spriteHeight, front = art.spearAttachFront;
    fishingEls.spearImage.setAttribute('href', spriteImg.src);
    fishingEls.spearImage.setAttribute('x', (-spriteW * 0.5).toFixed(2));
    fishingEls.spearImage.setAttribute('y', (useMace ? -spriteH * 0.5 : -front).toFixed(2));
    fishingEls.spearImage.setAttribute('width', spriteW.toFixed(2));
    fishingEls.spearImage.setAttribute('height', spriteH.toFixed(2));
    fishingEls.spearImage.setAttribute('transform', 'scale(1 -1)');

    const baseAngleDeg = Math.atan2(dy, dx) * 180 / Math.PI + art.spriteRotationOffset;
    const b = fishingMinigame.bridge;
    const isOutbound = b.spearActive && b.shotTimer < FISHING_RING.shotDuration;
    let angleDeg = baseAngleDeg;
    if (useMace) {
      if (isOutbound) angleDeg = baseAngleDeg + (b.weaponSpinDeg || 0);
      else if (Number.isFinite(b.frozenWeaponAngleDeg)) angleDeg = b.frozenWeaponAngleDeg;
    }
    fishingEls.spearSpriteWrap.setAttribute('transform', `translate(${endPoint.x.toFixed(2)} ${endPoint.y.toFixed(2)}) rotate(${angleDeg.toFixed(2)})`);
    fishingEls.spearSpriteWrap.setAttribute('opacity', '1');
  }

  // Ported from the prototype's renderImageFish: positions the deformed/skinned
  // fish silhouette (see renderFishDeformedTexture) at its ring point, rotated to
  // the ring angle and mirrored by localFacingScale for left/right turnarounds.
  function renderFishingImageFish(fm) {
    const pose = getRespawnFishPose(fm);
    if (pose && pose.scale <= 0.01) {
      fishingEls.fishImageRig.setAttribute('opacity', '0');
      return;
    }
    const b = fm.bridge;
    // Once the spear actually lands, the fish rides the retracting tip
    // back toward the player instead of staying pinned to its ring/dive
    // spot — ported from the prototype's spearBridge caughtFish branch.
    const caughtFollow = !pose && b.spearActive && b.caughtFish;
    let renderAngle, fishPt;
    if (caughtFollow) {
      const outerRadius = FISHING_RING.fishRadius + FISHING_RING.outerOffset;
      const anchor = fishingPolarToXY(b.lineA, outerRadius);
      renderAngle = Math.atan2(b.tipY - anchor.y, b.tipX - anchor.x) * 180 / Math.PI;
      fishPt = { x: b.tipX, y: b.tipY };
    } else {
      renderAngle = pose ? pose.angle : fm.fish.renderAngle;
      const renderRadius = pose ? pose.radius : fm.fish.renderRadius;
      fishPt = fishingPolarToXY(renderAngle, renderRadius);
    }
    const renderScale = pose ? pose.scale : 1;
    const deform = renderFishDeformedTexture(fm);
    // Only log on a state change (loaded vs. not), so the debug panel gets one
    // entry per session instead of one per frame at 60fps.
    if (fm._pngLogState !== !!deform) {
      fm._pngLogState = !!deform;
      window.__farmLog?.(
        `fish png render: ${deform ? 'OK (' + deform.w.toFixed(0) + 'x' + deform.h.toFixed(0) + ')' : 'FAILED'} ` +
        `bodyImgLoaded=${!!(fishBodySpriteImage && fishBodySpriteImage.naturalWidth)}`,
        deform ? 'info' : 'warn'
      );
    }
    if (!deform) {
      fishingEls.fishImageRig.setAttribute('opacity', '0');
      return;
    }

    const art = FISHING_BRIDGE_ART;
    const requested = fm.fish.localFacingScale;
    const localFacingScale = Math.abs(requested) < 0.035 ? 0.035 * Math.sign(requested || 1) : requested;
    const scaleX = art.flipX * localFacingScale;

    const w = deform.w * renderScale, h = deform.h * renderScale;
    // Dimmed while diving/escaping (fm.fish.dimmed) — a visible cue that
    // the fish is in the safe zone, on top of it genuinely being
    // geometrically unreachable (see fishingTryTipCatch).
    fishingEls.fishImageRig.setAttribute('opacity', pose || !fm.fish.dimmed ? '1' : '0.55');
    fishingEls.fishImageRig.setAttribute('transform', `translate(${fishPt.x.toFixed(2)} ${fishPt.y.toFixed(2)})`);
    fishingEls.fishImageTransform.setAttribute('transform', `rotate(${renderAngle.toFixed(2)}) scale(${scaleX.toFixed(4)} 1)`);
    fishingEls.fishDeformedImage.setAttribute('href', deform.url);
    fishingEls.fishDeformedImage.setAttribute('x', (-w / 2).toFixed(2));
    fishingEls.fishDeformedImage.setAttribute('y', (-h / 2).toFixed(2));
    fishingEls.fishDeformedImage.setAttribute('width', w.toFixed(2));
    fishingEls.fishDeformedImage.setAttribute('height', h.toFixed(2));
  }

  // Floats the ring over the live 3D scene at the river tile's projected screen
  // position instead of centering it in a modal — same camera-angle-tracking
  // intent as the prototype's backdrop demo (cube player + river prism).
  function updateFishingRingScreenPosition(fm) {
    if (!fishingEls || !fm.anchorWorld) return;
    const proj = deps.worldToOverlay(fm.anchorWorld.x, fm.anchorWorld.y, fm.anchorWorld.z);
    if (!proj.visible) return;
    const halfRing = 160; // matches the ring-wrap's max 320px size
    const rect = deps.getThreeRect();
    const left = deps.clamp(proj.x, halfRing, Math.max(halfRing, rect.width - halfRing));
    const top = deps.clamp(proj.y, halfRing, Math.max(halfRing, rect.height - halfRing));
    fishingEls.ringWrap.style.left = (rect.left + left) + 'px';
    fishingEls.ringWrap.style.top = (rect.top + top) + 'px';
  }

  function renderFishingOverlay() {
    const fm = fishingMinigame;
    if (!fm) return;

    // Keeps the fish_primary/fish_cancel arc buttons in sync with phase
    // (computeActionButtons' fishingMinigame branch returns nothing
    // before 'bite', the button pair from 'bite' onward) — cheap no-op
    // via refreshActionBar's own key-diff whenever the phase hasn't
    // actually changed since the last call, so calling this every frame
    // here is fine.
    deps.refreshActionBar();

    // "Ready Harpoon"/"Throw Harpoon" is now primarily an arc button
    // (see computeActionButtons' fishingMinigame branch) — natural
    // thumb reach on touch, unlike this bottom-center spot. This prompt
    // stays up alongside it purely as an info display (status text/
    // panic bar, and the actual key/button label on desktop/
    // controller), but keeps its own onPress/onCancel too as a
    // redundant secondary tap target — harmless, and convenient for a
    // desktop mouse user who'd rather click here than hunt for the arc.
    if (fm.phase === 'bite' || fm.phase === 'active') {
      const notYetMarked = fm.phase === 'bite' || fm.bridge.markerA == null;
      deps.showActionPrompt({
        actionId: 'interact',
        touchIcon: deps.attackActionIconHTML('harpoon', 'fish', '🎣'),
        verb: notYetMarked ? 'Ready Harpoon' : 'Throw Harpoon',
        onPress: fishingPrimaryAction,
        cancelText: 'Give up',
        onCancel: closeFishingMinigame,
        statusText: fm.phase === 'active' ? fm.message : '',
        statusType: fm.phase === 'active' ? fm.messageType : '',
        panicPercent: fm.phase === 'active' ? fm.panic : null,
      });
    }

    if (fm.phase !== 'active') return;

    if (!fishingEls) buildFishingRingDom();
    updateFishingRingScreenPosition(fm);

    const R = FISHING_RING;
    const outerRadius = R.fishRadius + R.outerOffset;
    const half = R.segmentSize / 2;

    fishingEls.segArc.setAttribute('d', describeFishingArc(outerRadius, fm.bridge.angle - half, fm.bridge.angle + half));

    if (fm.bridge.markerA != null) {
      const p = fishingPolarToXY(fm.bridge.markerA, outerRadius);
      fishingEls.markerA.setAttribute('cx', p.x.toFixed(1));
      fishingEls.markerA.setAttribute('cy', p.y.toFixed(1));
      fishingEls.markerA.setAttribute('opacity', '1');
    } else {
      fishingEls.markerA.setAttribute('opacity', '0');
    }
    if (fm.bridge.markerB != null) {
      const p = fishingPolarToXY(fm.bridge.markerB, outerRadius);
      fishingEls.markerB.setAttribute('cx', p.x.toFixed(1));
      fishingEls.markerB.setAttribute('cy', p.y.toFixed(1));
      fishingEls.markerB.setAttribute('opacity', '1');
    } else {
      fishingEls.markerB.setAttribute('opacity', '0');
    }

    if (fm.bridge.spearActive && fm.bridge.lineA != null) {
      const spearA = fishingPolarToXY(fm.bridge.lineA, outerRadius);
      renderFishingSpearSprite(spearA, { x: fm.bridge.tipX, y: fm.bridge.tipY });
    } else {
      fishingEls.spearRope.setAttribute('opacity', '0');
      fishingEls.spearSpriteWrap.setAttribute('opacity', '0');
    }

    renderFishingImageFish(fm);
  }

  function describeFishingArc(radius, startDeg, endDeg) {
    const start = fishingPolarToXY(startDeg, radius);
    const end = fishingPolarToXY(endDeg, radius);
    const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  }

  window.Fishing = {
    init,
    beginCast: beginFishingCast,
    close: closeFishingMinigame,
    primaryAction: fishingPrimaryAction,
    update: updateFishingMinigame,
    updateFx: updateFishingFxParticles,
    // Bucket-by-hour helper, also read by _lootShopWorldState/
    // window.DialogueContent's own loot/shop/dialogue condition gating
    // (their `timesOfDay` condition axis) — not fishing-specific despite
    // the name, kept here since this is where it originally lived.
    timeOfDay: fishingTimeOfDay,
    get state() { return fishingMinigame; },
    get readyPose() { return fishingReadyPose; },
  };
})();

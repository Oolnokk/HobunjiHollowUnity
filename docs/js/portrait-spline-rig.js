// Portrait-relative 3D beard and side-hair rig. Cosmetics without portraitSplineRig stay flat.
(() => {
  'use strict';

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const finite = (n, fallback = 0) => Number.isFinite(Number(n)) ? Number(n) : fallback;
  const RAD = Math.PI / 180;
  const DEFAULT_DEADZONE = Object.freeze({ x: 4, y: 4, z: 6 });
  const SLOT_NAMES = new Set(['facialHair', 'hairSide', 'hairSideL']);
  const live = new Set(); // Mobile diagnostics; entries are removed by the avatar's disposal hook.

  const MASK_SIZE = 200; // Rigid/flexible pixel regions are authored in the same 200×200 portrait coordinate system as cosmetic PNGs.
  function normalizePixelMask(input) {
    if (!input || Number(input.size) !== MASK_SIZE || !Array.isArray(input.runs)) return null;
    const total = MASK_SIZE * MASK_SIZE;
    const spans = input.runs.slice(0, total).filter(pair => Array.isArray(pair) && pair.length === 2
      && Number.isInteger(pair[0]) && Number.isInteger(pair[1]) && pair[0] >= 0 && pair[1] > 0 && pair[0] < total)
      .map(([start, length]) => [start, Math.min(length, total - start)]).sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [start, length] of spans) {
      const last = merged[merged.length - 1];
      if (last && start <= last[0] + last[1]) last[1] = Math.max(last[1], start + length - last[0]);
      else merged.push([start, length]);
    }
    return { size: MASK_SIZE, runs: merged }; // Sparse RLE remains tiny for hair outlines, yet is pixel-accurate.
  }
  function decodePixelMask(input) {
    const bits = new Uint8Array(MASK_SIZE * MASK_SIZE); // Temporary editor/runtime bitset; serialized JSON stores only contiguous rigid runs.
    const mask = normalizePixelMask(input);
    for (const [start, length] of mask?.runs || []) bits.fill(1, start, start + length);
    return bits;
  }
  function encodePixelMask(bits) {
    const runs = [];
    for (let i = 0; i < MASK_SIZE * MASK_SIZE;) {
      if (!bits[i]) { i++; continue; }
      const start = i;
      while (i < bits.length && bits[i]) i++;
      runs.push([start, i - start]);
    }
    return { size: MASK_SIZE, runs };
  }
  function maskFromOverlap(sprite, head, options = {}) {
    if (!sprite || !head) return null;
    const canvas = document.createElement('canvas'); // Normalizes indexed, tint-composited artwork into portrait UV space before alpha comparisons.
    canvas.width = canvas.height = MASK_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(sprite, Math.round(finite(options.dx) * MASK_SIZE), Math.round(finite(options.dy) * MASK_SIZE), MASK_SIZE, MASK_SIZE);
    const hair = ctx.getImageData(0, 0, MASK_SIZE, MASK_SIZE).data;
    ctx.clearRect(0, 0, MASK_SIZE, MASK_SIZE);
    ctx.drawImage(head, 0, 0, MASK_SIZE, MASK_SIZE);
    const skin = ctx.getImageData(0, 0, MASK_SIZE, MASK_SIZE).data;
    const bits = new Uint8Array(MASK_SIZE * MASK_SIZE);
    for (let i = 0; i < bits.length; i++) bits[i] = hair[i * 4 + 3] >= 8 && skin[i * 4 + 3] >= 8 ? 1 : 0;
    return encodePixelMask(bits); // All hair/head overlap starts rigid; everything else starts flexible.
  }
  function paintPixelMask(input, u, v, radiusPx, rigid) {
    const bits = decodePixelMask(input);
    const x = clamp(Math.floor(finite(u) * MASK_SIZE), 0, MASK_SIZE - 1);
    const y = clamp(Math.floor(finite(v) * MASK_SIZE), 0, MASK_SIZE - 1);
    const radius = clamp(finite(radiusPx, 3), .5, 60);
    const reach = Math.ceil(radius);
    for (let py = Math.max(0, y - reach); py <= Math.min(MASK_SIZE - 1, y + reach); py++)
      for (let px = Math.max(0, x - reach); px <= Math.min(MASK_SIZE - 1, x + reach); px++)
        if ((px + .5 - (u * MASK_SIZE)) ** 2 + (py + .5 - (v * MASK_SIZE)) ** 2 <= radius * radius)
          bits[py * MASK_SIZE + px] = rigid ? 1 : 0;
    return encodePixelMask(bits);
  }
  function splitByMask(sprite, input) {
    const mask = normalizePixelMask(input);
    if (!mask || !sprite) return { rigid: null, flexible: sprite }; // Old unconverted cosmetics remain entirely flexible.
    const width = sprite.width, height = sprite.height;
    const copy = () => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(sprite, 0, 0, width, height);
      return { canvas, ctx, data: ctx.getImageData(0, 0, width, height) };
    };
    const a = copy(), b = copy(), bits = decodePixelMask(mask);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      const rigidPixel = bits[Math.min(MASK_SIZE - 1, Math.floor(y * MASK_SIZE / height)) * MASK_SIZE
        + Math.min(MASK_SIZE - 1, Math.floor(x * MASK_SIZE / width))];
      if (rigidPixel) b.data.data[at + 3] = 0;
      else a.data.data[at + 3] = 0;
    }
    a.ctx.putImageData(a.data, 0, 0); b.ctx.putImageData(b.data, 0, 0);
    return { rigid: a.canvas, flexible: b.canvas }; // Exactly one copy of every original opaque pixel survives in one of the two groups.
  }

  function normalize(input) {
    if (!input || input.enabled === false || !Array.isArray(input.points) || input.points.length < 2) return null;
    const points = input.points.slice(0, 16).map((point, i) => ({
      u: clamp(finite(point?.u, 0.5), 0, 1),
      v: clamp(finite(point?.v, 0.5), 0, 1),
      depth: clamp(finite(point?.depth, 0.012 + i * 0.004), 0.003, 0.35),
    }));
    if (points.every(p => p.u === points[0].u && p.v === points[0].v)) return null;
    const segments = points.slice(1).map((_, i) => {
      const source = input.segments?.[i] || {};
      const directions = {};
      for (const key of ['left', 'right', 'up', 'down', 'toward', 'away']) {
        const pose = source.poses?.[key] || {};
        directions[key] = {
          yaw: clamp(finite(pose.yaw), -85, 85),
          pitch: clamp(finite(pose.pitch), -85, 85),
          roll: clamp(finite(pose.roll), -85, 85),
          translate: {
            x: clamp(finite(pose.translate?.x), -.35, .35),
            y: clamp(finite(pose.translate?.y), -.35, .35),
            z: clamp(finite(pose.translate?.z), -.35, .35),
          }, // Direction-specific 3D endpoint offset authored with the viewer gizmos; old rotational poses normalize to zero.
        };
      }
      return {
        deadzone: {
          x: clamp(finite(source.deadzone?.x, DEFAULT_DEADZONE.x), 0, 44),
          y: clamp(finite(source.deadzone?.y, DEFAULT_DEADZONE.y), 0, 44),
          z: clamp(finite(source.deadzone?.z, DEFAULT_DEADZONE.z), 0, 44),
        },
        poses: directions,
      };
    });
    return {
      version: 1, enabled: true, points, segments,
      seam: (input.seam || []).slice(0, 128).map(p => ({
        u: clamp(finite(p?.u, .5), 0, 1), v: clamp(finite(p?.v, .5), 0, 1),
        radiusPx: clamp(finite(p?.radiusPx, 3), .5, 15),
        ...(typeof p?.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.color) ? { color: p.color } : {}), // Optional authored bridge pixels; absent means sample the original strand artwork.
      })),
      regionMasks: Object.fromEntries(['front', 'rear'].flatMap(view => {
        const normalized = normalizePixelMask(input.regionMasks?.[view]);
        return normalized ? [[view, normalized]] : [];
      })), // Per-plane rigid/flexible regions; absence means an unconverted legacy hairstyle.
      rearOffset: {
        u: clamp(finite(input.rearOffset?.u), -.25, .25),
        v: clamp(finite(input.rearOffset?.v), -.25, .25),
      },
      width: clamp(finite(input.width, .1), .01, .5),
      windResponse: clamp(finite(input.windResponse, 1), 0, 5),
      segmentsX: clamp(Math.round(finite(input.segmentsX, 16)), 4, 32),
      segmentsY: clamp(Math.round(finite(input.segmentsY, 20)), 4, 40),
    };
  }

  function resolveOptionRig(option, fighter) {
    const key = String(fighter?.speciesId || '') + '_' + String(fighter?.gender || '');
    return normalize(option?.variantSplineRigs?.[key] || option?.splineRig);
  }

  function axisAmount(input, deadzone) {
    const direction = clamp(finite(input), -1, 1);
    const angle = Math.atan(Math.abs(direction)) / RAD;
    const response = clamp((angle - deadzone) / Math.max(0.01, 45 - deadzone), 0, 1);
    return Math.sign(direction) * response;
  }

  function blendSegment(segment, wind) {
    const d = segment.deadzone;
    const x = axisAmount(wind.x, d.x), y = axisAmount(wind.y, d.y), z = axisAmount(wind.z, d.z);
    const angles = { yaw: 0, pitch: 0, roll: 0 };
    const translation = { x: 0, y: 0, z: 0 }; // Accumulates direction-weighted knot translations; excluded from neutral output for legacy clients.
    for (const [axis, low, high, strength] of [['x', 'left', 'right', x], ['y', 'down', 'up', y], ['z', 'away', 'toward', z]]) {
      const pose = segment.poses[strength < 0 ? low : high];
      for (const component of ['yaw', 'pitch', 'roll']) angles[component] += Math.abs(strength) * pose[component];
      for (const component of ['x', 'y', 'z']) translation[component] += Math.abs(strength) * (pose.translate?.[component] || 0);
    }
    // Independent axes blend without allowing a diagonal gust to triple the authored excursion.
    const divisor = Math.max(1, Math.hypot(x, y, z));
    for (const component of ['yaw', 'pitch', 'roll']) angles[component] = clamp(angles[component] / divisor, -85, 85);
    for (const component of ['x', 'y', 'z']) translation[component] = clamp(translation[component] / divisor, -.35, .35);
    if (Object.values(translation).some(value => Math.abs(value) > 1e-9)) angles.translate = translation;
    return angles;
  }

  function segmentVector(from, to, angles, factor) {
    const yaw = angles.yaw * RAD * factor, pitch = angles.pitch * RAD * factor, roll = angles.roll * RAD * factor;
    const dx = to.u - from.u, dy = from.v - to.v, dz = to.depth - from.depth;
    const x1 = dx * Math.cos(yaw) + dz * Math.sin(yaw);
    const z1 = dz * Math.cos(yaw) - dx * Math.sin(yaw);
    const y2 = dy * Math.cos(pitch) - z1 * Math.sin(pitch);
    const z2 = dy * Math.sin(pitch) + z1 * Math.cos(pitch);
    const t = angles.translate || {}; // Offsets apply in portrait-local XYZ, so gizmo movement matches game wind poses.
    return { x: x1 * Math.cos(roll) - y2 * Math.sin(roll) + (t.x || 0) * factor,
      y: x1 * Math.sin(roll) + y2 * Math.cos(roll) + (t.y || 0) * factor,
      z: z2 + (t.z || 0) * factor };
  }

  function posePoints(rig, wind = {}) {
    const points = [{ x: rig.points[0].u - .5, y: .5 - rig.points[0].v, z: rig.points[0].depth }];
    let collisions = 0;
    for (let i = 0; i < rig.segments.length; i++) {
      const from = rig.points[i], to = rig.points[i + 1], prev = points[i], angles = blendSegment(rig.segments[i], wind);
      const candidate = factor => {
        const v = segmentVector(from, to, angles, factor);
        return { x: prev.x + v.x, y: prev.y + v.y, z: prev.z + v.z };
      };
      let next = candidate(1);
      // The portrait is an opaque plane: the strand must never cross its front surface.
      // Binary-search the maximum permitted segment rotation instead of letting the art clip.
      if (next.z < .003) {
        collisions++;
        let low = 0, high = 1;
        for (let j = 0; j < 12; j++) {
          const mid = (low + high) / 2;
          if (candidate(mid).z >= .003) low = mid; else high = mid;
        }
        next = candidate(low);
        if (next.z < .003) next.z = .003;
      }
      points.push(next);
    }
    return { points, collisions };
  }

  function cubic(a, b, c, d, t) {
    const t2 = t * t, t3 = t2 * t; // Catmull-Rom interpolant; knots remain in place while first derivatives join smoothly.
    return .5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  }

  function curvePoint(points, index, fraction, normalized = false) {
    const a = points[Math.max(0, index - 1)], b = points[index];
    const c = points[index + 1], d = points[Math.min(points.length - 1, index + 2)];
    const value = (point, axis) => normalized
      ? axis === 'x' ? point.u - .5 : axis === 'y' ? .5 - point.v : point.depth
      : point[axis]; // The author uses normalized (u,v,depth); posed strands use model-relative (x,y,z).
    const t = clamp(fraction, 0, 1);
    return Object.fromEntries(['x', 'y', 'z'].map(axis => [axis,
      cubic(value(a, axis), value(b, axis), value(c, axis), value(d, axis), t)]));
  }

  function deformPosition(rig, posed, u, v, width, height) {
    const x = u - .5, y = .5 - v;
    let index = 0, fraction = 0, closest = Infinity;
    for (let i = 0; i < rig.points.length - 1; i++) {
      const a = rig.points[i], b = rig.points[i + 1];
      const ax = a.u - .5, ay = .5 - a.v, bx = b.u - .5, by = .5 - b.v;
      const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
      const t = clamp(len ? ((x - ax) * dx + (y - ay) * dy) / len : 0, 0, 1);
      const squared = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
      if (squared < closest) { closest = squared; index = i; fraction = t; }
    }
    const rest = curvePoint(rig.points, index, fraction, true); // Cubic neutral centerline blends each neighboring knot instead of a kinked polyline.
    const target = curvePoint(posed, index, fraction); // Pose in the same continuous parametric space before displacing texture vertices.
    const influence = 1 - clamp(Math.sqrt(closest) / Math.max(.01, rig.width), 0, 1) ** 2;
    return { x: (x + (target.x - rest.x) * influence) * width,
      y: (y + (target.y - rest.y) * influence) * height,
      z: Math.max(.003, rest.z + (target.z - rest.z) * influence) * height };
  }

  function warpHoodCanvas(source, seam) {
    if (!seam?.length || !source?.getContext) return source;
    const w = source.width, h = source.height, ctx = source.getContext('2d', { willReadFrequently: true });
    const original = ctx.getImageData(0, 0, w, h), result = ctx.createImageData(w, h);
    result.data.set(original.data);
    let touched = false;
    for (const dab of seam) {
      const cx = dab.u * w, cy = dab.v * h, r = dab.radiusPx * w / 200;
      const outer = Math.ceil(r + 3), minX = Math.max(0, Math.floor(cx - outer)), maxX = Math.min(w - 1, Math.ceil(cx + outer));
      const minY = Math.max(0, Math.floor(cy - outer)), maxY = Math.min(h - 1, Math.ceil(cy + outer));
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const dx = x - cx, dy = y - cy, distance = Math.hypot(dx, dy);
        if (distance > r + 2) continue;
        const dest = (y * w + x) * 4;
        if (distance <= r * .55) {
          result.data[dest + 3] = 0; touched = true; continue;
        }
        // Pull pixels inward from the old edge so the resulting opaque border
        // moves outward; preserve nearest-neighbor palette/shading rather than blur.
        const move = Math.max(0, r + 2 - distance) * .55;
        const sx = clamp(Math.round(x - dx / Math.max(.01, distance) * move), 0, w - 1);
        const sy = clamp(Math.round(y - dy / Math.max(.01, distance) * move), 0, h - 1);
        const src = (sy * w + sx) * 4;
        for (let c = 0; c < 4; c++) result.data[dest + c] = original.data[src + c];
        touched = true;
      }
    }
    if (touched) ctx.putImageData(result, 0, 0);
    return source;
  }

  function paintSeamBridge(ctx, image, seam) {
    if (!ctx || !image || !seam?.length) return;
    ctx.save();
    ctx.beginPath();
    for (const dab of seam) {
      const r = dab.radiusPx * image.width / 200; // Match the author's logical 200px portrait pixel grid.
      ctx.moveTo(dab.u * image.width + r, dab.v * image.height);
      ctx.arc(dab.u * image.width, dab.v * image.height, r, 0, Math.PI * 2);
    }
    ctx.clip();
    ctx.drawImage(image, 0, 0, image.width, image.height); // The original tinted strand provides matching pixels wherever it already has coverage.
    ctx.restore();
    for (const dab of seam) {
      if (!dab.color) continue;
      const r = dab.radiusPx * image.width / 200, x = dab.u * image.width, y = dab.v * image.height;
      // The author may paint an opaque connecting bridge beyond the strand's original
      // silhouette. Paint on the portrait, NOT on the detached moving mesh, so the seam
      // stays with the skull when the strand swings away from it.
      ctx.save(); ctx.fillStyle = dab.color;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
  }

  function makePart(THREE, front, rear, width, height, name) {
    const rig = front.rig, geometry = new THREE.PlaneGeometry(width, height, rig.segmentsX, rig.segmentsY);
    const base = new Float32Array(geometry.attributes.position.array); // Stable rest data reused by every wind update.
    const rearGeometry = rear?.canvas ? geometry.clone() : null; // The rear-facing strand must sit BEHIND the rear portrait, not behind the front camera.
    const makeTexture = (canvas, rearView) => {
      const source = rearView ? document.createElement('canvas') : canvas;
      if (rearView) {
        source.width = canvas.width; source.height = canvas.height;
        const c = source.getContext('2d');
        c.translate(source.width, 0); c.scale(-1, 1); c.drawImage(canvas, 0, 0);
      }
      const texture = new THREE.CanvasTexture(source);
      if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
      else if (THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
      texture.needsUpdate = true;
      return texture;
    };
    const makeMesh = (canvas, back) => {
      const material = new THREE.MeshBasicMaterial({ map: makeTexture(canvas, back), transparent: true,
        alphaTest: .02, side: back ? THREE.BackSide : THREE.FrontSide, depthWrite: false });
      material.toneMapped = false;
      const mesh = new THREE.Mesh(back ? rearGeometry : geometry, material);
      mesh.name = name + (back ? '_rear' : '_front');
      mesh.renderOrder = 4; mesh.frustumCulled = false;
      mesh.userData.noOutline = true; // A 2D cosmetic ribbon must not get a large solid 3D outline shell.
      return mesh;
    };
    const frontMesh = makeMesh(front.canvas, false);
    const rearMesh = rear?.canvas ? makeMesh(rear.canvas, true) : null;
    const rest = geometry.attributes.position;
    const rearPositions = rearGeometry?.attributes.position || null; // Same authored UV-to-spline mapping, with mirrored depth relative to the rear plane.
    let lastTime = -Infinity, lastX = NaN, lastY = NaN, lastZ = NaN;
    const applyWind = (wind = { x: 0, y: 0, z: 0 }, force = false) => {
      if (!force && Math.abs(wind.x - lastX) + Math.abs(wind.y - lastY) + Math.abs(wind.z - lastZ) < .025) return;
      lastX = wind.x; lastY = wind.y; lastZ = wind.z;
      const posed = posePoints(rig, wind);
      for (let i = 0; i < rest.count; i++) {
        const u = base[i * 3] / width + .5, v = .5 - base[i * 3 + 1] / height;
        const p = deformPosition(rig, posed.points, u, v, width, height);
        rest.setXYZ(i, p.x, p.y, p.z);
        rearPositions?.setXYZ(i, p.x, p.y, -p.z); // Independent rear geometry prevents occlusion by the opaque back portrait.
      }
      rest.needsUpdate = true;
      geometry.computeBoundingSphere();
      if (rearPositions) { rearPositions.needsUpdate = true; rearGeometry.computeBoundingSphere(); }
      frontMesh.userData.portraitSplineCollisionLimits = posed.collisions;
    };
    const update = () => {
      const wind = window.DeadzoneBillboard?.liveVegetationWindSnapshot?.();
      if (!wind || wind.time === lastTime) return;
      lastTime = wind.time;
      const strength = clamp(wind.strength / .12, 0, 1) * rig.windResponse;
      const phase = finite(front.phase, 0);
      applyWind({ x: clamp(Math.sin(wind.time * 1.6 + phase) * strength, -1, 1),
        y: clamp(Math.cos(wind.time * .85 + phase * 1.7) * strength * .35, -1, 1),
        z: clamp(Math.sin(wind.time * 1.1 + phase * 2) * strength * .5, -1, 1) });
    };
    applyWind({ x: 0, y: 0, z: 0 }, true);
    frontMesh.onBeforeRender = update;
    if (rearMesh) rearMesh.onBeforeRender = update;
    return { frontMesh, rearMesh, applyWind, rig, name };
  }

  function attach(THREE, root, assembly, frontCanvas, backCanvas, modelWidth, modelHeight) {
    if (!THREE || !root || !assembly) return [];
    root.userData.portraitSplineAttachment = { THREE, assembly, modelWidth, modelHeight }; // Supports cosmetic changes after the avatar was built without a 3D hairstyle.
    const parts = Array.isArray(frontCanvas?.hobunjiSplineParts) ? frontCanvas.hobunjiSplineParts : [];
    if (!parts.length) { root.userData.portraitSplineParts = []; return []; }
    const rears = new Map((backCanvas?.hobunjiSplineParts || []).map(p => [p.key, p]));
    const joint = root.userData?.portraitSplineHeadBone || root.userData?.neckRig?.headScaleJoint || null;
    const host = joint || assembly;
    const holder = new THREE.Group(); holder.name = 'portrait_spline_appendages';
    if (joint) {
      const pivot = root.userData.portraitSplineNeckLocal || root.userData.neckRig?.neckLocal;
      holder.position.set(-finite(pivot?.x), -finite(pivot?.y), 0);
    }
    host.add(holder);
    root.userData.portraitSplineHolder = holder; // Owned by this avatar and removed when its selected hairstyle changes.
    const attached = [];
    for (const part of parts) {
      if (!part.rig || !part.canvas) continue;
      const rendered = makePart(THREE, part, part.slot === 'facialHair' ? null : rears.get(part.key), modelWidth, modelHeight, part.key);
      holder.add(rendered.frontMesh);
      if (rendered.rearMesh) holder.add(rendered.rearMesh);
      rendered.signature = JSON.stringify(part.rig); // Compare authored geometry/motion without recreating on ordinary breathing refreshes.
      attached.push(rendered);
    }
    root.userData.portraitSplineParts = attached; // World-space/mobile debug and optional authored pose controls.
    live.add(root);
    return attached;
  }

  function discardPieces(root) {
    const holder = root?.userData?.portraitSplineHolder;
    if (!holder) return;
    const materials = new Set(), geometries = new Set();
    holder.traverse(mesh => {
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(mat => materials.add(mat));
    });
    holder.parent?.remove(holder);
    for (const geometry of geometries) geometry.dispose?.();
    for (const material of materials) { material.map?.dispose?.(); material.dispose?.(); }
    root.userData.portraitSplineHolder = null;
    root.userData.portraitSplineParts = [];
    live.delete(root);
  }

  function refresh(root, frontCanvas, backCanvas) {
    if (!root) return;
    const requested = Array.isArray(frontCanvas?.hobunjiSplineParts) ? frontCanvas.hobunjiSplineParts : [];
    const active = root.userData?.portraitSplineParts || [];
    const byName = new Map(active.map(part => [part.name, part]));
    const changed = requested.length !== active.length || requested.some(part => {
      const current = byName.get(part.key);
      return !current || current.signature !== JSON.stringify(part.rig);
    });
    if (changed) {
      discardPieces(root);
      const owner = root.userData?.portraitSplineAttachment;
      if (owner && requested.length) attach(owner.THREE, root, owner.assembly, frontCanvas, backCanvas, owner.modelWidth, owner.modelHeight);
      return;
    }
    const fronts = new Map(requested.map(p => [p.key, p]));
    const rears = new Map((backCanvas?.hobunjiSplineParts || []).map(p => [p.key, p]));
    for (const part of active) {
      const f = fronts.get(part.name), b = rears.get(part.name);
      for (const [mesh, canvas] of [[part.frontMesh, f?.canvas], [part.rearMesh, b?.canvas]]) {
        if (!mesh || !canvas) continue;
        const image = mesh.material.map.image;
        if (!image?.getContext) continue;
        const c = image.getContext('2d');
        c.clearRect(0, 0, image.width, image.height);
        if (mesh === part.rearMesh) { c.save(); c.translate(image.width, 0); c.scale(-1, 1); }
        c.drawImage(canvas, 0, 0, image.width, image.height);
        if (mesh === part.rearMesh) c.restore();
        mesh.material.map.needsUpdate = true;
      }
    }
  }

  function detach(root) { discardPieces(root); } // Hostile 3D appendages may live outside the old avatar's mesh tree.
  function debug() {
    return [...live].map(root => ({
      name: root.name, active: root.userData?.portraitSplineParts?.length || 0,
      pieces: (root.userData?.portraitSplineParts || []).map(p => ({
        name: p.name, collisionLimits: p.frontMesh.userData.portraitSplineCollisionLimits,
        rear: !!p.rearMesh,
      })),
    }));
  }
  window.PortraitSplineRig = { normalize, resolveOptionRig, blendSegment, posePoints, curvePoint,
    deformPosition, normalizePixelMask, decodePixelMask, encodePixelMask, maskFromOverlap, paintPixelMask, splitByMask,
    warpHoodCanvas, paintSeamBridge, attach, refresh, detach, debug };
})();
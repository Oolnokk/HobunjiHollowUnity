// Portrait-relative 3D beard and side-hair rig. Cosmetics without portraitSplineRig stay flat.
(() => {
  'use strict';

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const finite = (n, fallback = 0) => Number.isFinite(Number(n)) ? Number(n) : fallback;
  const RAD = Math.PI / 180;
  const DEFAULT_DEADZONE = Object.freeze({ x: 4, y: 4, z: 6 });
  const SLOT_NAMES = new Set(['facialHair', 'hairSide', 'hairSideL']);
  const live = new Set(); // Mobile diagnostics; entries are removed by the avatar's disposal hook.

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
    for (const [axis, low, high, strength] of [['x', 'left', 'right', x], ['y', 'down', 'up', y], ['z', 'away', 'toward', z]]) {
      const pose = segment.poses[strength < 0 ? low : high];
      for (const component of ['yaw', 'pitch', 'roll']) angles[component] += Math.abs(strength) * pose[component];
    }
    // Independent axes blend without allowing a diagonal gust to triple the authored excursion.
    const divisor = Math.max(1, Math.hypot(x, y, z));
    for (const component of ['yaw', 'pitch', 'roll']) angles[component] = clamp(angles[component] / divisor, -85, 85);
    return angles;
  }

  function segmentVector(from, to, angles, factor) {
    const yaw = angles.yaw * RAD * factor, pitch = angles.pitch * RAD * factor, roll = angles.roll * RAD * factor;
    const dx = to.u - from.u, dy = from.v - to.v, dz = to.depth - from.depth;
    const x1 = dx * Math.cos(yaw) + dz * Math.sin(yaw);
    const z1 = dz * Math.cos(yaw) - dx * Math.sin(yaw);
    const y2 = dy * Math.cos(pitch) - z1 * Math.sin(pitch);
    const z2 = dy * Math.sin(pitch) + z1 * Math.cos(pitch);
    return { x: x1 * Math.cos(roll) - y2 * Math.sin(roll),
      y: x1 * Math.sin(roll) + y2 * Math.cos(roll), z: z2 };
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

  function pointOnSegment(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
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
    const rest = pointOnSegment(
      { x: rig.points[index].u - .5, y: .5 - rig.points[index].v, z: rig.points[index].depth },
      { x: rig.points[index + 1].u - .5, y: .5 - rig.points[index + 1].v, z: rig.points[index + 1].depth }, fraction);
    const target = pointOnSegment(posed[index], posed[index + 1], fraction);
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
  window.PortraitSplineRig = { normalize, resolveOptionRig, blendSegment, posePoints,
    deformPosition, warpHoodCanvas, paintSeamBridge, attach, refresh, detach, debug };
})();
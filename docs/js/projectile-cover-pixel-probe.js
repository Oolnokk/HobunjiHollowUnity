(() => {
  'use strict';

  const PATCH_KEY = '__projectileCoverPixelProbePatchedV1';
  const CANVAS_KEY = '__projectileCoverPixelProbeCaptureV1';
  const REPORT_KEY = '__projectileCoverPixelProbeObserverV1';
  const SECTION = '=== Semantic projectile-cover ray hits ===';
  const MAX_PROBE_DISTANCE = 96; // One-shot debug ray only; wide enough for interiors without walking hundreds of empty spatial cells.
  const MIN_QUERY_RADIUS = 4; // Keeps near-vertical camera rays aware of room-scale cover around their X/Z line.
  const HEIGHT_EPSILON = 0.01; // Mirrors NearbyVolumeCollision's gameplay vertical tolerance.

  let latestProbe = null; // Most recent armed Pixel Probe click, formatted into the report observer below.

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function segmentCircleEntry(start, end, x, z, radius) {
    const dx = end.x - start.x, dz = end.z - start.z;
    const fx = start.x - x, fz = start.z - z;
    const a = dx * dx + dz * dz;
    if (a <= 1e-10) return null;
    const b = 2 * (fx * dx + fz * dz);
    const c = fx * fx + fz * fz - radius * radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const root = Math.sqrt(discriminant);
    const t0 = (-b - root) / (2 * a);
    const t1 = (-b + root) / (2 * a);
    if (t1 < 0 || t0 > 1) return null;
    return { enter: Math.max(0, t0), exit: Math.min(1, t1) };
  }

  function segmentAabbEntry(start, end, minX, maxX, minZ, maxZ) {
    let enter = 0, exit = 1;
    for (const [s, e, min, max] of [[start.x, end.x, minX, maxX], [start.z, end.z, minZ, maxZ]]) {
      const delta = e - s;
      if (Math.abs(delta) < 1e-10) {
        if (s < min || s > max) return null;
        continue;
      }
      let a = (min - s) / delta;
      let b = (max - s) / delta;
      if (a > b) [a, b] = [b, a];
      enter = Math.max(enter, a);
      exit = Math.min(exit, b);
      if (enter > exit) return null;
    }
    return exit >= 0 && enter <= 1 ? { enter: Math.max(0, enter), exit: Math.min(1, exit) } : null;
  }

  function clipRangeByY(start, end, range, minY, maxY) {
    if (!range) return null;
    if (minY === -Infinity && maxY === Infinity) return range;
    const deltaY = end.y - start.y;
    if (Math.abs(deltaY) < 1e-10) return start.y >= minY && start.y <= maxY ? range : null;
    let a = (minY - start.y) / deltaY;
    let b = (maxY - start.y) / deltaY;
    if (a > b) [a, b] = [b, a];
    const enter = Math.max(range.enter, a);
    const exit = Math.min(range.exit, b);
    return enter <= exit ? { enter: Math.max(0, enter), exit: Math.min(1, exit) } : null;
  }

  function candidateEntry(candidate, start, end) {
    const horizontal = candidate.shape === 'aabb'
      ? segmentAabbEntry(
        start, end,
        candidate.x - candidate.halfX,
        candidate.x + candidate.halfX,
        candidate.z - candidate.halfZ,
        candidate.z + candidate.halfZ,
      )
      : segmentCircleEntry(start, end, candidate.x, candidate.z, candidate.radius);
    const vertical = clipRangeByY(
      start, end, horizontal,
      candidate.bottomY - HEIGHT_EPSILON,
      candidate.topY + HEIGHT_EPSILON,
    );
    return vertical ? vertical.enter : null;
  }

  function debugRayHits(origin, direction, maxDistance = MAX_PROBE_DISTANCE) {
    const cover = window.NearbyVolumeCollision;
    if (!cover?.debugVolumes || !origin || !direction) return [];
    const length = Math.hypot(finite(direction.x), finite(direction.y), finite(direction.z));
    if (!(length > 1e-8)) return [];
    const distance = Math.max(1, Math.min(MAX_PROBE_DISTANCE, finite(maxDistance, MAX_PROBE_DISTANCE)));
    const dx = finite(direction.x) / length, dy = finite(direction.y) / length, dz = finite(direction.z) / length;
    const start = { x: finite(origin.x), y: finite(origin.y), z: finite(origin.z) };
    const end = { x: start.x + dx * distance, y: start.y + dy * distance, z: start.z + dz * distance };
    const horizontalLength = Math.hypot(end.x - start.x, end.z - start.z);
    const queryRadius = Math.max(MIN_QUERY_RADIUS, horizontalLength * 0.5 + 2); // Candidate buckets intersecting this square include volumes whose centres lie outside it but whose bounds overlap the ray corridor.
    const volumes = cover.debugVolumes((start.x + end.x) * 0.5, (start.z + end.z) * 0.5, queryRadius) || [];
    const hits = [];
    for (const candidate of volumes) {
      const t = candidateEntry(candidate, start, end);
      if (t == null) continue;
      const point = {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
        z: start.z + (end.z - start.z) * t,
      }; // Exact semantic-volume entry point along the same camera ray Pixel Probe used.
      hits.push({
        key: candidate.key || candidate.node?.name || '(semantic cover)',
        kind: candidate.kind || 'object',
        source: candidate.source || '-',
        shape: candidate.shape || 'unknown',
        distanceWorld: t * distance,
        point,
        center: { x: finite(candidate.x), z: finite(candidate.z) },
        bottomY: finite(candidate.bottomY),
        topY: candidate.topY === Infinity ? Infinity : finite(candidate.topY),
        radius: candidate.shape === 'circle' ? finite(candidate.radius) : null,
        halfX: candidate.shape === 'aabb' ? finite(candidate.halfX) : null,
        halfZ: candidate.shape === 'aabb' ? finite(candidate.halfZ) : null,
        nodeName: candidate.node?.name || null,
      });
    }
    hits.sort((a, b) => a.distanceWorld - b.distanceWorld);
    return hits;
  }

  const fmt = value => Number.isFinite(Number(value)) ? Number(value).toFixed(3) : value === Infinity ? '∞' : '-';

  function formatHit(hit, index) {
    const bounds = hit.shape === 'circle'
      ? `radius=${fmt(hit.radius)}`
      : `half=(${fmt(hit.halfX)},${fmt(hit.halfZ)})`;
    return `[${index}] ${hit.kind}:${hit.key} source=${hit.source} shape=${hit.shape} dist=${fmt(hit.distanceWorld)}u `
      + `hit=(${fmt(hit.point?.x)},${fmt(hit.point?.y)},${fmt(hit.point?.z)}) centerXZ=(${fmt(hit.center?.x)},${fmt(hit.center?.z)}) `
      + `y=${fmt(hit.bottomY)}..${fmt(hit.topY)} ${bounds}${hit.nodeName ? ` node="${hit.nodeName}"` : ''}`;
  }

  function formatSection(snapshot = latestProbe) {
    const lines = [SECTION];
    if (!snapshot) {
      lines.push('No semantic-cover probe ray captured.');
      return lines.join('\n');
    }
    if (snapshot.error) {
      lines.push(`Unavailable: ${snapshot.error}`);
      return lines.join('\n');
    }
    lines.push(`Ray max=${fmt(snapshot.maxDistance)}u hits=${snapshot.hits.length} (semantic collision volumes; mesh/material not required)`);
    if (!snapshot.hits.length) lines.push('none');
    else snapshot.hits.forEach((hit, index) => lines.push(formatHit(hit, index)));
    return lines.join('\n');
  }

  function appendOrReplace(report, snapshot = latestProbe) {
    const text = String(report || '');
    const section = formatSection(snapshot);
    const lines = text.split('\n');
    const start = lines.findIndex(line => line === SECTION);
    if (start >= 0) {
      let end = start + 1;
      while (end < lines.length && !lines[end].startsWith('=== ')) end++;
      lines.splice(start, end - start, ...section.split('\n'));
      return lines.join('\n');
    }
    return `${text}${text.endsWith('\n') || !text ? '' : '\n\n'}${section}`;
  }

  function installReportObserver() {
    const result = document.getElementById('debugProbeResult');
    if (!result || result[REPORT_KEY] || typeof MutationObserver !== 'function') return false;
    let writing = false;
    const observer = new MutationObserver(() => {
      if (writing) return;
      const current = result.textContent || '';
      if (!current || !/Pixel Probe report/i.test(current)) return;
      const next = appendOrReplace(current);
      if (next === current) return;
      writing = true;
      result.textContent = next;
      writing = false;
    });
    observer.observe(result, { childList: true, characterData: true, subtree: true });
    result[REPORT_KEY] = observer;
    return true;
  }

  function installCapture(api, deps) {
    const canvas = deps?.renderer?.domElement;
    const camera = deps?.camera;
    if (!canvas?.addEventListener || !camera || canvas[CANVAS_KEY]) return false;
    canvas[CANVAS_KEY] = true;
    const raycaster = new THREE.Raycaster(); // Dedicated one-shot diagnostic raycaster; no gameplay ray state is mutated.
    canvas.addEventListener('pointerdown', event => {
      if (!api.armed) return;
      const rect = canvas.getBoundingClientRect?.();
      if (!rect?.width || !rect?.height) return;
      const ndc = {
        x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
      };
      raycaster.setFromCamera(ndc, camera);
      try {
        latestProbe = {
          maxDistance: MAX_PROBE_DISTANCE,
          hits: debugRayHits(raycaster.ray.origin, raycaster.ray.direction, MAX_PROBE_DISTANCE),
          capturedAt: performance.now(),
          error: null,
        };
      } catch (error) {
        latestProbe = { maxDistance: MAX_PROBE_DISTANCE, hits: [], capturedAt: performance.now(), error: String(error?.message || error) };
      }
    }, true); // Capture phase records the click before Pixel Probe's once-only handler stops propagation.
    return true;
  }

  function patch(api) {
    if (!api || api[PATCH_KEY] || typeof api.init !== 'function') return false;
    const originalInit = api.init;
    api.init = function projectileCoverPixelProbeInit(...args) {
      const value = originalInit.apply(this, args);
      installCapture(api, args[0]);
      installReportObserver();
      return value;
    };
    api[PATCH_KEY] = true;
    return true;
  }

  function installNowOrInterceptAssignment() {
    if (patch(window.PixelProbe)) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, 'PixelProbe');
    if (descriptor && descriptor.configurable === false) return;
    const priorGet = descriptor?.get;
    const priorSet = descriptor?.set;
    let localValue = descriptor && 'value' in descriptor ? descriptor.value : undefined;
    Object.defineProperty(window, 'PixelProbe', {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() { return priorGet ? priorGet.call(window) : localValue; },
      set(value) {
        if (priorSet) priorSet.call(window, value);
        else localValue = value;
        const resolved = priorGet ? priorGet.call(window) : value;
        patch(resolved);
      },
    });
  }

  window.ProjectileCoverPixelProbe = Object.freeze({
    debugRayHits,
    formatSection,
    appendOrReplace,
    get latest() { return latestProbe; },
  });
  installNowOrInterceptAssignment();
})();

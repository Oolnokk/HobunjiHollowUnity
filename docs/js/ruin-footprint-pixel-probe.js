(() => {
  'use strict';

  const PATCH_KEY = '__ruinFootprintPixelProbePatchedV1';
  const CANVAS_KEY = '__ruinFootprintPixelProbeCaptureV1';
  const REPORT_KEY = '__ruinFootprintPixelProbeObserverV1';
  const SECTION = '=== Ruin exact-footprint ray hits ===';
  const MAX_PROBE_DISTANCE = 96; // One-shot diagnostics only; matches the semantic-cover Pixel Probe range.
  const SAMPLE_STEP = 0.08; // Fine enough to catch the ruin's smallest gameplay footprints without adding any per-frame work.
  const REFINE_STEPS = 8; // Binary refinement after the first occupied sample gives a stable near-face distance in the report.

  let latestProbe = null; // Most recent armed Pixel Probe camera ray against DevRandomRuinTileOccupancy.solidAt().

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizedRay(origin, direction, maxDistance = MAX_PROBE_DISTANCE) {
    if (!origin || !direction) return null;
    const length = Math.hypot(finite(direction.x), finite(direction.y), finite(direction.z));
    if (!(length > 1e-8)) return null;
    const distance = Math.max(1, Math.min(MAX_PROBE_DISTANCE, finite(maxDistance, MAX_PROBE_DISTANCE)));
    return {
      origin:{ x:finite(origin.x), y:finite(origin.y), z:finite(origin.z) },
      direction:{ x:finite(direction.x) / length, y:finite(direction.y) / length, z:finite(direction.z) / length },
      distance,
    };
  }

  function pointAt(ray, distance) {
    return {
      x:ray.origin.x + ray.direction.x * distance,
      y:ray.origin.y + ray.direction.y * distance,
      z:ray.origin.z + ray.direction.z * distance,
    };
  }

  function footprintAt(ray, distance) {
    const occupancy = window.DevRandomRuinTileOccupancy;
    if (!occupancy?.solidAt) return null;
    const point = pointAt(ray, distance);
    return occupancy.solidAt(point.x, point.z, 0, point.y) || null; // Exact gameplay footprint query, including its real vertical span.
  }

  function sameFootprint(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.source === b.source
      && Math.abs(finite(a.cx) - finite(b.cx)) < 1e-6
      && Math.abs(finite(a.cz) - finite(b.cz)) < 1e-6
      && Math.abs(finite(a.halfU) - finite(b.halfU)) < 1e-6
      && Math.abs(finite(a.halfV) - finite(b.halfV)) < 1e-6;
  }

  function refineEntry(ray, footprint, lowDistance, highDistance) {
    let low = Math.max(0, lowDistance), high = Math.max(low, highDistance);
    for (let i = 0; i < REFINE_STEPS; i++) {
      const mid = (low + high) * 0.5;
      if (sameFootprint(footprintAt(ray, mid), footprint)) high = mid;
      else low = mid;
    }
    return high;
  }

  function footprintKey(fp) {
    if (!fp) return '';
    return [fp.source || '', finite(fp.cx).toFixed(4), finite(fp.cz).toFixed(4), finite(fp.halfU).toFixed(4), finite(fp.halfV).toFixed(4), finite(fp.minY).toFixed(4), finite(fp.maxY).toFixed(4)].join('|');
  }

  function debugRayHits(origin, direction, maxDistance = MAX_PROBE_DISTANCE) {
    const ray = normalizedRay(origin, direction, maxDistance);
    if (!ray || !window.DevRandomRuinTileOccupancy?.solidAt) return [];
    const seen = new Set();
    const hits = [];
    for (let distance = 0; distance <= ray.distance + 1e-6; distance += SAMPLE_STEP) {
      const footprint = footprintAt(ray, Math.min(distance, ray.distance));
      if (!footprint) continue;
      const key = footprintKey(footprint);
      if (seen.has(key)) continue;
      seen.add(key);
      const entryDistance = distance <= 0 ? 0 : refineEntry(ray, footprint, distance - SAMPLE_STEP, distance);
      hits.push({
        source:footprint.source || '(ruin footprint)',
        tag:footprint.tag || 'static',
        meshId:footprint.meshId ?? null,
        distanceWorld:entryDistance,
        point:pointAt(ray, entryDistance),
        center:{ x:finite(footprint.cx), z:finite(footprint.cz) },
        halfU:finite(footprint.halfU),
        halfV:finite(footprint.halfV),
        yaw:Math.atan2(-finite(footprint.uz), finite(footprint.ux, 1)),
        minY:Number(footprint.minY),
        maxY:Number(footprint.maxY),
      });
    }
    hits.sort((a, b) => a.distanceWorld - b.distanceWorld);
    return hits;
  }

  function fmt(value) {
    if (value === Infinity) return '∞';
    if (value === -Infinity) return '-∞';
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(3) : '-';
  }

  function formatHit(hit, index) {
    return `[${index}] ${hit.source} tag=${hit.tag} dist=${fmt(hit.distanceWorld)}u `
      + `hit=(${fmt(hit.point?.x)},${fmt(hit.point?.y)},${fmt(hit.point?.z)}) centerXZ=(${fmt(hit.center?.x)},${fmt(hit.center?.z)}) `
      + `half=(${fmt(hit.halfU)},${fmt(hit.halfV)}) yaw=${fmt(hit.yaw)}rad y=${fmt(hit.minY)}..${fmt(hit.maxY)}`
      + (hit.meshId == null ? '' : ` meshId=${hit.meshId}`);
  }

  function formatSection(snapshot = latestProbe) {
    const lines = [SECTION];
    if (!snapshot) {
      lines.push('No exact-footprint probe ray captured.');
      return lines.join('\n');
    }
    if (snapshot.error) {
      lines.push(`Unavailable: ${snapshot.error}`);
      return lines.join('\n');
    }
    lines.push(`Ray max=${fmt(snapshot.maxDistance)}u hits=${snapshot.hits.length} (same exact oriented footprints used by ruin movement/projectile occupancy)`);
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
    observer.observe(result, { childList:true, characterData:true, subtree:true });
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
        x:((event.clientX - rect.left) / rect.width) * 2 - 1,
        y:-((event.clientY - rect.top) / rect.height) * 2 + 1,
      };
      raycaster.setFromCamera(ndc, camera);
      try {
        latestProbe = {
          maxDistance:MAX_PROBE_DISTANCE,
          hits:debugRayHits(raycaster.ray.origin, raycaster.ray.direction, MAX_PROBE_DISTANCE),
          capturedAt:performance.now(),
          error:null,
        };
      } catch (error) {
        latestProbe = { maxDistance:MAX_PROBE_DISTANCE, hits:[], capturedAt:performance.now(), error:String(error?.message || error) };
      }
    }, true); // Capture before the main Pixel Probe consumes/stops its once-only pointer event.
    return true;
  }

  function patch(api) {
    if (!api || api[PATCH_KEY] || typeof api.init !== 'function') return false;
    const originalInit = api.init;
    api.init = function ruinFootprintPixelProbeInit(...args) {
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
      configurable:true,
      enumerable:descriptor?.enumerable ?? true,
      get() { return priorGet ? priorGet.call(window) : localValue; },
      set(value) {
        if (priorSet) priorSet.call(window, value);
        else localValue = value;
        const resolved = priorGet ? priorGet.call(window) : value;
        patch(resolved);
      },
    });
  }

  window.RuinFootprintPixelProbe = Object.freeze({
    debugRayHits,
    formatSection,
    appendOrReplace,
    get latest() { return latestProbe; },
  });
  installNowOrInterceptAssignment();
})();

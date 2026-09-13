(() => {
  'use strict';

  const PATCH_KEY = '__environmentSurfaceProbePatchedV4'; // Prevents duplicate Pixel Probe init wrapping in repeated diagnostic loads.
  const RESULT_KEY = '__environmentSurfaceProbeObserverV4'; // Stores the report MutationObserver directly on the existing result element.
  const LINE_PREFIX = 'Environment surface:'; // Stable prefix used to replace one copyable line in each Pixel Probe report.

  function formatLine() {
    const runtime = window.EnvironmentSurfaceRuntime;
    const state = runtime?.debugSnapshot?.();
    const priority = window.EnvironmentSurfaceNearPriority?.debugSnapshot?.();
    const micro = window.EnvironmentSurfaceMicroPlateau?.debugSnapshot?.();
    if (!state) return `${LINE_PREFIX} unavailable`;
    const priorityPlayer = priority?.priorityPlayer;
    const priorityPlayerText = priorityPlayer
      ? `${Number(priorityPlayer.x).toFixed(2)},${Number(priorityPlayer.z).toFixed(2)}`
      : '-';
    const priorityText = priority
      ? ` priority=${priority.prioritized ? 'done' : 'waiting'}/player${priorityPlayerText}/nearest${priority.nearestChunk || '-'}/sources${priority.reorderedSources ?? 0}/chunks${priority.reorderedChunks ?? 0}/rainUpdates${priority.rainUpdateCalls ?? 0}/assist${priority.assistUpdateCalls ?? 0}/rainGap${priority.rainGapMs ?? '-'}ms`
      : ' priority=unavailable';
    const microText = micro
      ? ` micro=${micro.active ? 'active' : micro.scanning ? 'scanning' : 'waiting'}/thick${micro.thickness ?? '-'}/tiles${micro.builtTiles ?? 0}/sampled${micro.sampledTiles ?? 0}/edges${micro.exposedEdges ?? 0}/scanTris${micro.sampledTriangles ?? 0}/tex${micro.textureState || '-'}`
      : ' micro=unavailable';
    return `${LINE_PREFIX} installed=${!!state.installed} init=${!!state.initialized} v=${state.version ?? '-'} area=${state.area || '-'} season=${state.season || '-'} mode=${state.mode || '-'} active=${state.activeMode || '-'} owners=${state.ownerSurfaces ?? '-'} pending=${state.pendingJobs ?? '-'} activeJob=${state.activeJob || '-'} completed=${state.completedJobs ?? '-'} spatial=${state.discoveredSpatialChunks ?? '-'} deferredLarge=${state.deferredLargeSources ?? '-'} triangles=${state.lastTriangles ?? '-'} boundaries=${state.lastBoundaryEdges ?? '-'} shellEdges=${state.visibleShellEdges ?? '-'} shellDirty=${!!state.shellDirty} texture=${state.snowTextureState || '-'} slice=${state.lastSliceMs ?? '-'}ms/max${state.maxSliceMs ?? '-'}ms${microText}${priorityText} reason=${micro?.lastReason || state.lastReason || '-'}`;
  }

  function appendOrReplace(report) {
    const text = String(report || '');
    const line = formatLine();
    const lines = text.split('\n');
    const index = lines.findIndex(entry => entry.startsWith(LINE_PREFIX));
    if (index >= 0) lines[index] = line;
    else lines.push(line);
    return lines.join('\n');
  }

  function installReportObserver() {
    const result = document.getElementById('debugProbeResult');
    if (!result || result[RESULT_KEY] || typeof MutationObserver !== 'function') return false;
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
    result[RESULT_KEY] = observer;
    return true;
  }

  function patch(api) {
    if (!api || api[PATCH_KEY] || typeof api.init !== 'function') return false;
    const originalInit = api.init;
    api.init = function environmentSurfacePixelProbeInit(...args) {
      const value = originalInit.apply(this, args);
      installReportObserver();
      return value;
    };
    api[PATCH_KEY] = true;
    return true;
  }

  function installNowOrInterceptAssignment() {
    if (patch(window.PixelProbe)) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, 'PixelProbe');
    if (descriptor && !descriptor.configurable) return;
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

  window.EnvironmentSurfacePixelProbe = Object.freeze({ formatLine, appendOrReplace, installReportObserver });
  installNowOrInterceptAssignment();
})();

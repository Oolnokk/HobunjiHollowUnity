(() => {
  'use strict';

  const PATCH_KEY = '__environmentSurfaceProbePatchedV5';
  const RESULT_KEY = '__environmentSurfaceProbeObserverV5';
  const LINE_PREFIX = 'Environment surface:';

  function formatLine() {
    const legacy = window.EnvironmentSurfaceRuntime?.debugSnapshot?.();
    const micro = window.EnvironmentSurfaceMicroPlateau?.debugSnapshot?.();
    const microStatus = !micro ? 'unavailable' : !micro.active ? 'waiting' : (micro.mode || 'active');
    const microText = micro
      ? ` micro=${microStatus}/v${micro.version ?? '-'}/thick${micro.thickness ?? '-'}/opacity${micro.opacity ?? '-'}/tiles${micro.builtTiles ?? 0}/chunks${micro.chunkCount ?? 0}/edges${micro.exposedEdges ?? 0}/builds${micro.buildCount ?? 0}/lastBuild${micro.lastBuildMs ?? '-'}ms/tex${micro.textureState || '-'}`
      : ' micro=unavailable';
    const legacyText = legacy
      ? ` legacy=${legacy.mode || 'disabled'}/pending${legacy.pendingJobs ?? 0}/owners${legacy.ownerSurfaces ?? 0}`
      : ' legacy=absent';
    return `${LINE_PREFIX}${microText}${legacyText} reason=${micro?.lastReason || legacy?.lastReason || '-'}`;
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

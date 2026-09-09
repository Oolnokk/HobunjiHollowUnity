(() => {
  'use strict';

  const PATCH_KEY = '__harlyaoNightMarchProbePatched'; // Prevents duplicate init wrappers when other Pixel Probe adapters chain around the same namespace.
  const RESULT_KEY = '__harlyaoNightMarchProbeObserver'; // Stores the MutationObserver on the report element so repeated init calls remain idempotent.
  const LINE_PREFIX = 'Harlyao march:'; // Used to replace/append one copyable mobile diagnostic line per completed Pixel Probe report.

  function formatMarchLine() {
    const api = window.HarlyaoNightMarch; // Reads the controller's structured state instead of duplicating route/chunk calculations here.
    const data = api?.debugSnapshot?.();
    if (!data) return `${LINE_PREFIX} unavailable`;
    const scheduled = data.scheduled
      ? `${data.scheduled.zoneId}/${data.scheduled.direction}@${data.scheduled.chunk?.cx ?? '-'},${data.scheduled.chunk?.cz ?? '-'}`
      : 'inactive';
    const player = data.playerChunk ? `${data.playerChunk.cx},${data.playerChunk.cz}` : 'none';
    const live = data.liveChunk ? `${data.liveChunk.cx},${data.liveChunk.cz}` : 'none';
    return `${LINE_PREFIX} scheduled=${scheduled} playerChunk=${player} liveChunk=${live} members=${data.membersAlive}/${data.membersCached} visible=${!!data.visible} provoked=${!!data.provoked} reason=${data.reason || '-'}`;
  }

  function appendOrReplace(report) {
    const text = String(report || ''); // Pixel Probe's complete copyable report currently stored in the debug result element.
    const line = formatMarchLine();
    const lines = text.split('\n');
    const index = lines.findIndex(entry => entry.startsWith(LINE_PREFIX));
    if (index >= 0) lines[index] = line;
    else lines.push(line);
    return lines.join('\n');
  }

  function installReportObserver() {
    const result = document.getElementById('debugProbeResult'); // Existing mobile-visible/copyable Pixel Probe result surface.
    if (!result || result[RESULT_KEY] || typeof MutationObserver !== 'function') return false;
    let writing = false; // Prevents our own appended diagnostic line from recursively re-entering the observer.
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
    const originalInit = api.init; // Preserves every earlier Pixel Probe init wrapper and dependency injection side effect.
    api.init = function harlyaoNightMarchPixelProbeInit(...args) {
      const value = originalInit.apply(this, args);
      installReportObserver();
      return value;
    };
    api[PATCH_KEY] = true;
    return true;
  }

  function installNowOrInterceptAssignment() {
    if (patch(window.PixelProbe)) return;
    const descriptor = Object.getOwnPropertyDescriptor(window, 'PixelProbe'); // Chains safely with other pre-PixelProbe adapters already using a configurable setter.
    if (descriptor && !descriptor.configurable) return;
    const priorGet = descriptor?.get;
    const priorSet = descriptor?.set;
    let localValue = descriptor && 'value' in descriptor ? descriptor.value : undefined; // Stores assignment only when no earlier accessor owns it.
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

  window.HarlyaoNightMarchPixelProbe = Object.freeze({ formatMarchLine, appendOrReplace, installReportObserver }); // Exposed for mobile-adapter regression tests and manual in-page diagnostics.
  installNowOrInterceptAssignment();
})();

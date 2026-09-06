// Appends procedural-hand render diagnostics to mobile Pixel Probe reports.
// PixelProbe keeps its report builder private, so observe the existing report DOM
// instead of coupling the hand system back into that large diagnostic module.
(() => {
  'use strict';

  const SECTION = '=== Procedural hand diagnostics ===';
  let observer = null; // MutationObserver used below to extend each freshly-captured probe report exactly once.

  function appendHandDiagnostics() {
    const report = document.getElementById('debugProbeResult');
    const text = report?.textContent || '';
    if (!report || !text.startsWith('Pixel Probe report') || text.includes(SECTION)) return;

    const parity = window.HobunjiHandOutlineParity?.getDebug?.() || null;
    const frame = window.ProceduralHandFrameDriver?.getDebug?.() || [];
    const xray = window.HeldObjectRenderOrder?.snapshot?.() || null;
    const mist = window.CloudForestMistSoftDepth?.snapshot?.() || null;
    const lines = ['', SECTION];

    if (parity) {
      lines.push(
        `Outline parity: rigs=${parity.activeRigs ?? '-'} captures=${parity.baseMatrixCaptures ?? '-'} `
        + `shellLocks=${parity.lockedShellDraws ?? '-'} idLocks=${parity.lockedMaterialIdDraws ?? '-'} `
        + `misses=${parity.missedOutlineSnapshots ?? '-'} xrayTagged=${parity.heldXrayTaggedMeshes ?? '-'}`
      );
    } else {
      lines.push('Outline parity: module missing');
    }

    if (xray) {
      lines.push(
        `Held x-ray: mode=${xray.mode || '-'} heldMeshes=${xray.heldMeshes ?? '-'} groundMeshes=${xray.groundMeshes ?? '-'} `
        + `overlays=${xray.selectiveOverlays ?? '-'} depthReplays=${xray.nonGroundDepthReplays ?? '-'}/${xray.groundDepthRestores ?? '-'}`
      );
    } else {
      lines.push('Held x-ray: module missing');
    }

    if (mist) {
      lines.push(
        `Cloud Forest mist depth: installed=${mist.installed ? 'yes' : 'no'} base=${mist.baseDepthCaptures ?? '-'} `
        + `overlays=${mist.overlayDraws ?? '-'} avatarCaptures=${mist.avatarOccluderCaptures ?? '-'} `
        + `avatarOccluders=${mist.lastAvatarOccluderCount ?? '-'} feather=${mist.config?.featherPixels ?? '-'}px`
      );
    } else {
      lines.push('Cloud Forest mist depth: module missing');
    }

    if (Array.isArray(frame) && frame.length) {
      for (const rec of frame) {
        const hand = rec?.hand || {};
        const fallback = rec?.fallback || {};
        lines.push(
          `Hand ${rec.speciesId || '?'} ${rec.gender || '-'} tool=${rec.toolKey || '-'} secondary=${rec.secondaryActive ? 'yes' : 'no'} `
          + `fallback=${fallback.mode || '-'} speed=${fallback.speed ?? '-'} strength=${fallback.gaitStrength ?? '-'} `
          + `owners=L:${fallback.owners?.left || '-'},R:${fallback.owners?.right || '-'} `
          + `hooked=${hand.outlineHookedMeshes ?? '-'} xray=${hand.heldXrayMeshes ?? '-'} `
          + `captures=${hand.outlineBaseMatrixCaptures ?? '-'} shell=${hand.outlineLockedShellDraws ?? '-'} `
          + `id=${hand.outlineLockedMaterialIdDraws ?? '-'} misses=${hand.outlineMissedSnapshots ?? '-'}`
        );
      }
    } else {
      lines.push('Hand frame driver: no managed hand rigs');
    }

    report.textContent = text + lines.join('\n');
  }

  function install() {
    const report = document.getElementById('debugProbeResult');
    if (!report || observer) return false;
    observer = new MutationObserver(() => appendHandDiagnostics());
    observer.observe(report, { childList: true, subtree: true, characterData: true });
    appendHandDiagnostics();
    return true;
  }

  if (!install()) {
    const timer = setInterval(() => {
      if (install()) clearInterval(timer);
    }, 250);
    setTimeout(() => clearInterval(timer), 15000);
  }

  window.HobunjiHandPixelProbeDiagnostics = Object.freeze({
    appendNow: appendHandDiagnostics,
    get installed() { return !!observer; },
  });
})();

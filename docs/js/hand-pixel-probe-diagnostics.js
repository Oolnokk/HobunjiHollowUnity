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
    const skinnedOutline = window.ProceduralHandSkinnedOutline?.getDebug?.() || null;
    const frame = window.ProceduralHandFrameDriver?.getDebug?.() || [];
    const xray = window.HeldObjectRenderOrder?.snapshot?.() || null;
    const skinRegistration = window.ProceduralHandSkinnedHeldRegistration?.getDebug?.() || null;
    const lifecycle = window.ProceduralHandLifecycleGuard?.getDebug?.() || null;
    const bodyBridge = window.PlayerBodyAttachmentBridge?.getDebug?.() || null;
    const semanticHands = window.ProceduralHandSemanticBasisRuntime?.getDebug?.() || null;
    const semanticTool = window.SemanticToolBasisRuntime?.getDebug?.() || null;
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

    if (skinnedOutline) {
      lines.push(
        `Skinned outline: mode=${skinnedOutline.mode || '-'} rigs=${skinnedOutline.activeRigs ?? '-'} `
        + `shells=${skinnedOutline.installedShells ?? '-'} rigidPassDisabled=${skinnedOutline.disabledGlobalShellMeshes ?? '-'} `
        + `heldShells=${skinnedOutline.heldShellsRegistered ?? '-'}`
      );
    } else {
      lines.push('Skinned outline: module missing');
    }

    if (semanticHands || semanticTool) {
      const handRows = semanticHands?.rigs || [];
      const correctedHands = handRows.filter(row => !!row?.correction).length;
      lines.push(
        `Semantic basis: handRigs=${semanticHands?.activeRigs ?? '-'} correctedHands=${correctedHands} `
        + `tool=${semanticTool?.currentToolKey || '-'} toolSource=${semanticTool?.currentBasisSource || 'none'} `
        + `toolComplete=${semanticTool?.currentBasisComplete ? 'yes' : 'no'} `
        + `toolFrames=${semanticTool?.appliedFrames ?? '-'} dynamicTwist=${Number(semanticTool?.lastDynamicTwistDeg || 0).toFixed(2)}°`
      );
    } else {
      lines.push('Semantic basis: modules missing');
    }

    if (xray) {
      lines.push(
        `Held x-ray: mode=${xray.mode || '-'} heldMeshes=${xray.heldMeshes ?? '-'} groundMeshes=${xray.groundMeshes ?? '-'} `
        + `overlays=${xray.selectiveOverlays ?? '-'} depthReplays=${xray.nonGroundDepthReplays ?? '-'}/${xray.groundDepthRestores ?? '-'}`
      );
    } else {
      lines.push('Held x-ray: module missing');
    }

    if (skinRegistration) {
      lines.push(
        `Skinned hand registry: adopted=${skinRegistration.adopted ?? '-'} inheritedTags=${skinRegistration.inheritedTags ?? '-'} `
        + `pending=${skinRegistration.pending ?? '-'} renderer=${skinRegistration.heldRendererReady ? 'ready' : 'waiting'}`
      );
    } else {
      lines.push('Skinned hand registry: bridge missing');
    }

    if (lifecycle) {
      lines.push(
        `Hand lifecycle: tracked=${lifecycle.trackedRigs ?? '-'} player=${lifecycle.playerRigs ?? '-'} `
        + `detachedPruned=${lifecycle.staleDetachedPruned ?? '-'} duplicatePruned=${lifecycle.duplicatePlayerPruned ?? '-'} `
        + `last=${lifecycle.lastPruneReason || '-'}`
      );
    }

    if (bodyBridge) {
      lines.push(
        `Hand deadzone: source=${bodyBridge.handDeadzoneSource || '-'} `
        + `counterYaw=${Number(bodyBridge.handDeadzoneCompensationDeg || 0).toFixed(2)}° `
        + `playerRoots=${bodyBridge.handDeadzonePlayerRoots ?? '-'} updates=${bodyBridge.handDeadzoneUpdates ?? '-'} `
        + `preRender=${bodyBridge.handDeadzonePreRenderSyncs ?? '-'}`
      );
    } else {
      lines.push('Hand deadzone: body attachment bridge missing');
    }

    if (Array.isArray(frame) && frame.length) {
      for (const rec of frame) {
        const hand = rec?.hand || {};
        const semantic = hand.semanticHandBasis || null;
        const audit = hand.transformAudit || null;
        const skin = hand.twoBoneSkin?.sides?.right || null;
        const semanticTag = semantic?.valid
          ? ` semantic=${semantic.source || 'yes'}(${semantic.axes?.fingers || '?'}/${semantic.axes?.thumb || '?'}/${semantic.axes?.palm || '?'})`
          : '';
        const auditTag = audit
          ? ` fit=${String(audit.fitAxis || '?').toUpperCase()} sourceMirror=${String(audit.sourceMirrorAxis || '?').toUpperCase()}(${audit.sourceMirrorSign ?? '?'})`
          : '';
        const wristTag = skin?.rigged ? ` wrist=${skin.wristAxisLabel || '?'}` : '';
        lines.push(
          `Hand ${rec.speciesId || '?'} ${rec.gender || '-'} tool=${rec.toolKey || '-'} secondary=${rec.secondaryActive ? 'yes' : 'no'} `
          + `hooked=${hand.outlineHookedMeshes ?? '-'} xray=${hand.heldXrayMeshes ?? '-'} `
          + `captures=${hand.outlineBaseMatrixCaptures ?? '-'} shell=${hand.outlineLockedShellDraws ?? '-'} `
          + `id=${hand.outlineLockedMaterialIdDraws ?? '-'} misses=${hand.outlineMissedSnapshots ?? '-'}${semanticTag}${auditTag}${wristTag}`
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

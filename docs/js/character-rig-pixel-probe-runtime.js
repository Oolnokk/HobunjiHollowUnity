// Runtime Pixel Probe correction for character-rig diagnostics.
//
// Pixel Probe deliberately raycasts every object along the click ray, including
// hidden AxesHelpers. Its original transform-dump selector took the first owned
// hit, so an invisible player hand helper could win even when the visible object
// the user clicked was an NPC several hits later. This bridge independently
// resolves the same click and replaces only the transform-dump section with the
// nearest actually-rendered owned character. It also prints the authored/runtime
// head tuple and the live head-scale bone so mobile copied reports can prove that
// separate head scaling really landed.
(() => {
  'use strict';

  const PATCH_SENTINEL = '__hobunjiProbedOwnerTransformPatch';
  const CANVAS_SENTINEL = '__hobunjiProbedOwnerTransformCapture';
  const REPORT_MARKER = '=== Local transform dump:';
  const NEXT_SECTION_MARKERS = [
    '\n=== Blend check',
    '\n=== Temporal flicker check',
    '\n=== Procedural hand diagnostics',
    '\n=== Shoulder-pet diagnostics',
    '\n=== NPC scheduling diagnostics',
    '\n=== Agenda / Activity Planner',
  ];

  function effectivelyVisible(object) {
    let node = object; // Walked below so a visible child under a hidden helper parent cannot masquerade as rendered.
    while (node) {
      if (node.visible === false) return false;
      node = node.parent;
    }
    return true;
  }

  function ownerInfo(object, deps) {
    let node = object; // Walked to the floor-relative owner roots used by the existing Pixel Probe owner labels.
    while (node) {
      if (node === deps?.playerMesh) {
        const appearance = deps.getPlayerData?.()?.appearance || {};
        return {
          kind: 'player', label: 'player', root: deps.playerMesh,
          speciesId: appearance.speciesId, gender: appearance.gender,
        };
      }
      for (const walker of deps?.npcWalkers || []) {
        if (node !== walker?.root) continue;
        const appearance = walker.rec?.appearance || {};
        return {
          kind: 'npc', label: walker.rec?.name || walker.rec?.id || 'npc', root: walker.root,
          speciesId: appearance.speciesId, gender: appearance.gender, walker,
        };
      }
      for (const creature of deps?.companionObjects || []) {
        if (node !== creature?.avatarRef?.group) continue;
        return {
          kind: 'creature', label: creature.creatureKey || 'creature', root: creature.avatarRef.group,
          speciesId: creature.creatureKey, gender: null, creature,
        };
      }
      node = node.parent;
    }
    return null;
  }

  function selectOwnedHit(hits, deps) {
    const owned = (hits || []).map(hit => ({ hit, owner: ownerInfo(hit?.object, deps) })).filter(entry => entry.owner?.root); // Used below to preserve ray order while preferring real rendered surfaces.
    const renderedSurface = owned.find(({ hit }) => {
      const object = hit?.object;
      return effectivelyVisible(object) && !!(object?.isMesh || object?.isSkinnedMesh || object?.isSprite);
    });
    if (renderedSurface) return renderedSurface;
    const visibleOwned = owned.find(({ hit }) => effectivelyVisible(hit?.object));
    return visibleOwned || owned[0] || null;
  }

  function traverseFind(root, predicate) {
    let found = null; // Filled once so traversal remains cheap even on the player's larger procedural hand/foot subtree.
    if (!root) return null;
    if (predicate(root)) return root;
    root.traverse?.(node => { if (!found && predicate(node)) found = node; });
    return found;
  }

  function runtimeAvatarNode(root) {
    return traverseFind(root, node => !!(node?.userData?.hobunjiCharacterRigHeadRuntime || node?.userData?.neckRig));
  }

  function headScaleBone(root, avatarNode = null) {
    const rigBone = avatarNode?.userData?.neckRig?.headScaleJoint;
    if (rigBone) return rigBone;
    return traverseFind(root, node => !!(node?.isBone && /_head_scale_bone$/i.test(node.name || '')));
  }

  const fmt = value => Number.isFinite(Number(value)) ? Number(value).toFixed(4) : '-';
  const near = (a, b, epsilon = 0.0025) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) <= epsilon;

  function headDiagnosticLines(owner) {
    const root = owner?.root;
    if (!root) return [];
    const avatar = runtimeAvatarNode(root); // Carries the constructor-time head diagnostic written by character-rig-scale-avatar-runtime.js.
    const runtime = avatar?.userData?.hobunjiCharacterRigHeadRuntime || null;
    const bone = headScaleBone(root, avatar); // Live dedicated head-only bone whose local scale proves compensation independently of the body parent.
    const bodyState = root.userData?.hobunjiCharacterRigScaleState || null;
    const lines = ['--- Character rig scale verification ---'];

    if (runtime) {
      lines.push(
        `Head runtime: applied=${runtime.applied ? 'YES' : 'NO'} species=${runtime.species || owner.speciesId || '-'} gender=${runtime.gender || owner.gender || '-'} `
        + `body=(${fmt(runtime.bodyScaleX)},${fmt(runtime.bodyScaleY)}) head=${fmt(runtime.headScale)} headOffsetY=${fmt(runtime.headOffsetY)} source=${runtime.source || '-'}`,
      );
    } else {
      lines.push(`Head runtime: MISSING on probed ${owner.kind} "${owner.label}"`);
    }

    if (bodyState?.factor) {
      lines.push(`Body parent scale factor: (${fmt(bodyState.factor.x ?? bodyState.factor)},${fmt(bodyState.factor.y ?? bodyState.factor)}) coordinateSpace=${bodyState.coordinateSpace || '-'}`);
    }

    if (!bone) {
      lines.push('Head scale bone: MISSING — separate head scaling cannot execute on this avatar.');
      return lines;
    }

    const baseY = Number(bone.userData?.hobunjiHeadOffsetBaseY); // Authored pre-offset local Y saved by applyHeadYOffset for drift-free reapplication.
    lines.push(
      `Head scale bone: ${bone.name || '(unnamed)'} localScale=(${fmt(bone.scale?.x)},${fmt(bone.scale?.y)},${fmt(bone.scale?.z)}) `
      + `localY=${fmt(bone.position?.y)} baseY=${Number.isFinite(baseY) ? fmt(baseY) : '-'}`,
    );

    const bodyX = Number(runtime?.bodyScaleX);
    const bodyY = Number(runtime?.bodyScaleY);
    const head = Number(runtime?.headScale);
    if (bodyX > 0 && bodyY > 0 && head > 0) {
      const expectedX = head / bodyX; // Expected local counter-scale so world-space head width ends at the authored head factor.
      const expectedY = head / bodyY; // Expected local counter-scale so world-space head height ends at the authored head factor.
      const matches = near(bone.scale?.x, expectedX) && near(bone.scale?.y, expectedY) && near(bone.scale?.z, 1);
      lines.push(
        `Separate head-scale check: expectedLocal=(${fmt(expectedX)},${fmt(expectedY)},1.0000) actual=(${fmt(bone.scale?.x)},${fmt(bone.scale?.y)},${fmt(bone.scale?.z)}) ${matches ? 'MATCH' : 'MISMATCH'}`,
      );
    }
    return lines;
  }

  function buildOwnerTransformSection(owner) {
    const dumpApi = window.HobunjiTransformDump;
    if (!owner?.root || !dumpApi?.dumpSubtree || !dumpApi?.formatReport) return null;
    const lines = [`=== Local transform dump: ${owner.kind} "${owner.label}" (selected from the nearest visible owned ray hit) ===`];
    lines.push(dumpApi.formatReport(dumpApi.dumpSubtree(owner.root), { title: `${owner.kind} rig` }));
    lines.push(...headDiagnosticLines(owner));
    return lines.join('\n');
  }

  function replaceTransformSection(report, owner) {
    const replacement = buildOwnerTransformSection(owner);
    if (!replacement) return report;
    const text = String(report || '');
    const start = text.indexOf(REPORT_MARKER);
    if (start < 0) return `${text}${text.endsWith('\n') || !text ? '' : '\n\n'}${replacement}`;
    let end = text.length; // Shortened below to the first known top-level Pixel Probe section after the transform dump.
    for (const marker of NEXT_SECTION_MARKERS) {
      const index = text.indexOf(marker, start + REPORT_MARKER.length);
      if (index >= 0 && index < end) end = index;
    }
    const before = text.slice(0, start);
    const after = text.slice(end);
    return `${before}${replacement}${after.startsWith('\n') || !after ? '' : '\n'}${after}`;
  }

  function installCapture(api, deps) {
    const canvas = deps?.renderer?.domElement;
    const camera = deps?.camera;
    if (!canvas?.addEventListener || !camera || canvas[CANVAS_SENTINEL]) return;
    canvas[CANVAS_SENTINEL] = true;
    const raycaster = new THREE.Raycaster(); // Dedicated probe-only raycaster; it never mutates the gameplay interaction raycaster.

    canvas.addEventListener('pointerdown', event => {
      if (!api.armed) return;
      const scene = deps.getActiveScene?.();
      const rect = canvas.getBoundingClientRect?.();
      if (!scene || !rect?.width || !rect?.height) return;
      const ndc = {
        x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
      }; // Same screen-to-NDC conversion used by Pixel Probe's own click handler.
      raycaster.setFromCamera(ndc, camera);
      const selected = selectOwnedHit(raycaster.intersectObjects(scene.children || [], true), deps); // Captures the owner before Pixel Probe's once-only handler stops propagation.
      if (!selected?.owner) return;

      const resultEl = document.getElementById('debugProbeResult');
      if (!resultEl || typeof MutationObserver !== 'function') return;
      let patched = false; // Prevents our own textContent write from recursively triggering another replacement.
      const applyCorrection = () => {
        if (patched) return true;
        const current = resultEl.textContent || '';
        if (!current.includes(REPORT_MARKER)) return false;
        patched = true;
        observer.disconnect();
        resultEl.textContent = replaceTransformSection(current, selected.owner);
        return true;
      };
      const observer = new MutationObserver(() => applyCorrection()); // Waits for Pixel Probe's async screenshot/isolation work to finish and publish the complete report.
      observer.observe(resultEl, { childList: true, characterData: true, subtree: true });
      setTimeout(() => { if (!applyCorrection()) observer.disconnect(); }, 2500);
    }, { capture: true });
  }

  function patchPixelProbe(api) {
    if (!api || api[PATCH_SENTINEL] || typeof api.init !== 'function') return api;
    const originalInit = api.init; // May already include config.js's town-height wrapper; preserve the complete existing chain.
    api.init = function characterRigPixelProbeInit(injectedDeps) {
      const result = originalInit.call(this, injectedDeps);
      installCapture(api, injectedDeps);
      return result;
    };
    api[PATCH_SENTINEL] = true;
    return api;
  }

  function installNowOrInterceptAssignment() {
    if (window.PixelProbe) {
      patchPixelProbe(window.PixelProbe);
      return;
    }
    const prior = Object.getOwnPropertyDescriptor(window, 'PixelProbe'); // config.js may already own a setter here; chain it instead of replacing and losing its town-height hook.
    if (prior && prior.configurable === false) return;
    let assigned = prior && !prior.get && !prior.set ? prior.value : undefined; // Fallback storage only when no prior accessor owns the value.
    Object.defineProperty(window, 'PixelProbe', {
      configurable: true,
      enumerable: prior?.enumerable ?? true,
      get() {
        return prior?.get ? prior.get.call(window) : assigned;
      },
      set(value) {
        if (prior?.set) prior.set.call(window, value);
        else assigned = value;
        const installed = prior?.get ? prior.get.call(window) : assigned;
        patchPixelProbe(installed);
      },
    });
  }

  window.HobunjiCharacterRigPixelProbe = Object.freeze({
    effectivelyVisible,
    ownerInfo,
    selectOwnedHit,
    headDiagnosticLines,
    replaceTransformSection,
  }); // Small public diagnostic surface used by the regression test and mobile console checks.

  installNowOrInterceptAssignment();
})();

(() => {
  'use strict';

  // Pixel Probe (Debug tab) — a dev-only diagnostic tool. Arms a one-shot
  // click/tap on the game canvas; the next click reads the raw framebuffer
  // color there AND raycasts EVERY mesh along that screen ray (not just
  // whichever one currently wins the pixel), so overlay/hat-xray planes
  // show up in the list even on a frame where something else happens to be
  // drawn on top of them — the "what's actually stacked here" question a
  // plain screenshot can't answer on its own.
  //
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern as js/combat/*.js, js/mount-system.js, and
  // js/audio-system.js. Purely read-only/diagnostic — never mutates
  // authoritative game state (visibility toggles used mid-probe are always
  // restored before the probe finishes) — so it's off the critical path for
  // normal gameplay even if a dependency is missing.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  let _pixelProbeArmed = false;
  const _pixelProbeRaycaster = new THREE.Raycaster();

  function _pixelProbeAngleDeg(radians) {
    if (radians == null || !Number.isFinite(Number(radians))) return null;
    let degrees = Number(radians) * 180 / Math.PI; // Normalized below for compact copied reports.
    while (degrees > 180) degrees -= 360;
    while (degrees <= -180) degrees += 360;
    return degrees;
  }

  function _pixelProbeAngleStepDeg(nextRadians, previousRadians) {
    if (nextRadians == null || previousRadians == null || !Number.isFinite(Number(nextRadians)) || !Number.isFinite(Number(previousRadians))) return 0;
    let delta = (Number(nextRadians) - Number(previousRadians)) * 180 / Math.PI; // Wrapped to the shortest per-frame step.
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    return delta;
  }

  function _pixelProbeFmtAngle(radians) {
    const degrees = _pixelProbeAngleDeg(radians); // Printed by both click and temporal facing diagnostics.
    return degrees == null ? '-' : `${degrees.toFixed(2)}°`;
  }

  function _pixelProbeAngleDeltaRad(nextRadians, previousRadians) {
    if (nextRadians == null || previousRadians == null) return null;
    let delta = Number(nextRadians) - Number(previousRadians); // Shortest-arc delta used to compare render yaw with its clamp target.
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  }

  function _pixelProbeShoulderPetTransformDebug() {
    const pet = [...(deps?.companionObjects || [])].find(c =>
      c?.health > 0 && c.areaId === currentArea && (c.master || player) === player && c.stableRole === 'shoulderPet');
    if (!pet?.avatarRef?.group) return null;
    const group = pet.avatarRef.group;
    group.updateMatrixWorld?.(true);
    const groupQuat = group.getWorldQuaternion?.(new THREE.Quaternion());
    const groupEuler = group.getWorldRotation?.(new THREE.Euler(0, 0, 0, 'YXZ'));
    const planes = {};
    for (const [label, plane] of [['front', pet.avatarRef.frontPlane], ['back', pet.avatarRef.backPlane]]) {
      if (!plane) continue;
      plane.updateMatrixWorld?.(true);
      const elements = plane.matrixWorld.elements;
      const worldQuat = plane.getWorldQuaternion?.(new THREE.Quaternion());
      const up = new THREE.Vector3(elements[4], elements[5], elements[6]).normalize();
      const normal = new THREE.Vector3(elements[8], elements[9], elements[10]).normalize();
      planes[label] = {
        localEuler: [plane.rotation.x, plane.rotation.y, plane.rotation.z],
        localQuat: [plane.quaternion.x, plane.quaternion.y, plane.quaternion.z, plane.quaternion.w],
        worldQuat: worldQuat ? [worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w] : null,
        worldYaw: Math.atan2(normal.x, normal.z),
        upY: up.y,
        normal: [normal.x, normal.y, normal.z],
        renderDebug: plane.userData?.hobunjiShoulderPetRenderDebug || null,
      };
    }
    return {
      time: performance.now(),
      movementSpeed: Math.hypot(pet.vx || 0, pet.vy || 0),
      groupYaw: groupEuler?.y ?? group.rotation.y,
      groupWorldQuaternion: groupQuat ? [groupQuat.x, groupQuat.y, groupQuat.z, groupQuat.w] : null,
      pngRot: pet.pngRot,
      groupRot: pet.groupRot,
      planes,
    };
  }

  function _pixelProbeCurrentFacingDebug() {
    const clamp = deps.player?.perpState?.pixelProbeDebug || {}; // Last clamp decision made specifically for the player state object.
    const renderYawRad = deps.playerMesh?.rotation?.y; // Final persistent body yaw after clamp and any tool/sweep override.
    return {
      ...clamp,
      mode: clamp.timestampMs == null ? 'no-clamp-state' : 'perp-clamp',
      logicalFacingRad: deps.player?.angle,
      renderYawRad,
      renderVsEffectiveDeltaRad: _pixelProbeAngleDeltaRad(renderYawRad, clamp.effectiveTargetRotY),
    };
  }

  function _pixelProbeFacingTraceLine(sample, index, previous = null) {
    const facing = sample.facing || {}; // Authoritative/logical and dead-zone state captured after this frame.
    const drunk = sample.drunk || {}; // Current alcohol-driven pitch/roll contribution for this frame.
    const composer = sample.composer?.lastRender || {}; // Temporary render transform captured before restoration.
    const portrait = composer.portraitSelections?.[0] || null; // Front/back material selected before additive tilt.
    const clampSides = Array.isArray(facing.perpSides) ? facing.perpSides.map(value => value == null ? '-' : value > 0 ? '+' : '-').join('') : '-'; // Compact per-perp side state.
    const clampLocks = Array.isArray(facing.perpLocked) ? facing.perpLocked.map(Boolean).map(value => value ? '1' : '0').join('') : '-'; // Compact per-perp lock state.
    const renderStep = previous ? _pixelProbeAngleStepDeg(facing.renderYawRad, previous.facing?.renderYawRad) : 0; // Highlights final-yaw discontinuities.
    const colorDistance = previous ? Math.hypot(
      sample.color[0] - previous.color[0],
      sample.color[1] - previous.color[1],
      sample.color[2] - previous.color[2]
    ) : 0; // Correlates a visible pixel change with the transform state that accompanied it.
    const previousPortrait = previous?.composer?.lastRender?.portraitSelections?.[0]?.side || null; // Used only to mark portrait-side transitions.
    const stateChanged = !previous
      || colorDistance >= 10
      || Math.abs(renderStep) >= 5
      || facing.snapToRotY != null
      || portrait?.side !== previousPortrait
      || JSON.stringify(facing.perpSides || []) !== JSON.stringify(previous?.facing?.perpSides || [])
      || JSON.stringify(facing.perpLocked || []) !== JSON.stringify(previous?.facing?.perpLocked || []);
    const marker = stateChanged ? '!' : ' '; // Makes consequential frames easy to spot in a mobile text copy.
    const pixel = `rgba(${sample.color.join(',')})`; // Exact framebuffer result associated with this state.
    const portraitLabel = portrait
      ? `${portrait.side}@matrixDot=${Number(portrait.facingDot).toFixed(4)}/quatDot=${Number(portrait.quaternionFacingDot).toFixed(4)}/det=${Number(portrait.worldMatrixDeterminant).toFixed(4)}/disagree=${portrait.basisDisagrees ? 'YES' : 'no'}`
      : 'none'; // Directly exposes a negative-scale basis disagreeing with quaternion-only facing.
    const baseEuler = composer.baseWorldEulerDeg; // Quaternion-only base orientation immediately before the composer delta.
    const composedEuler = composer.composedWorldEulerDeg; // Final orientation while drunk tilt is temporarily applied.
    const eulerLabel = value => value
      ? `${Number(value.pitch).toFixed(2)}°/${Number(value.yaw).toFixed(2)}°/${Number(value.roll).toFixed(2)}°`
      : '-'; // Compact pitch/yaw/roll tuple for mobile report copying.
    const nearestClamp = facing.nearestPerpIndex == null
      ? '-'
      : `${facing.nearestPerpIndex}@${_pixelProbeFmtAngle(facing.nearestDeltaRad)} side=${facing.previousSide ?? '-'}→${facing.selectedSide ?? '-'} lock=${facing.wasLocked ? 1 : 0}→${facing.isLocked ? 1 : 0}`; // Full decision for the nearest edge-on dead zone.
    return `${marker}f${String(index).padStart(2, '0')} px=${pixel} mode=${facing.mode || '-'} `
      + `logical=${_pixelProbeFmtAngle(facing.logicalFacingRad)} `
      + `raw=${_pixelProbeFmtAngle(facing.rawTargetRotY)} effective=${_pixelProbeFmtAngle(facing.effectiveTargetRotY)} snap=${_pixelProbeFmtAngle(facing.snapToRotY)} `
      + `render=${_pixelProbeFmtAngle(facing.renderYawRad)} step=${renderStep.toFixed(2)}° renderΔeff=${_pixelProbeFmtAngle(facing.renderVsEffectiveDeltaRad)} `
      + `nearest=${nearestClamp} perpSides=${clampSides} locks=${clampLocks} drunkPR=${Number(drunk.pitchDeg || 0).toFixed(2)}°/${Number(drunk.rollDeg || 0).toFixed(2)}° `
      + `composerPYR=${eulerLabel(baseEuler)}→${eulerLabel(composedEuler)} portrait=${portraitLabel} render#=${composer.sequence ?? '-'}`;
  }

  function _pixelProbeMatSummary(mat) {
    if (!mat) return '(no material)';
    const colorHex = mat.color?.isColor ? `#${mat.color.getHexString()}` : '-';
    return `name="${mat.name || '(unnamed)'}" type=${mat.type} color=${colorHex} map=${mat.map ? (mat.map.name || '(unnamed texture)') : 'none'} transparent=${mat.transparent} opacity=${mat.opacity} `
      + `depthWrite=${mat.depthWrite} depthTest=${mat.depthTest} depthFunc=${mat.depthFunc} alphaTest=${mat.alphaTest ?? 0} `
      + `stencilWrite=${!!mat.stencilWrite} stencilFunc=${mat.stencilFunc ?? '-'} stencilRef=${mat.stencilRef ?? '-'}`;
  }

  // Reads a material's own map texture at the raycast hit's exact UV —
  // the "Raw color under cursor" framebuffer readback above only ever
  // reports whatever's actually FRONTMOST at that screen pixel, which
  // for anything not nearest-hit (a foot mesh behind foliage, say) is
  // some other object entirely, not the one being inspected. Sampling
  // the material's own texture data sidesteps occlusion completely:
  // it's the color this exact mesh would draw here if nothing else
  // were in front of it. Respects the texture's own wrap/repeat/offset
  // and flipY so the sampled texel matches what the GPU would actually
  // read.
  function _pixelProbeTextureSampleAtUv(mat, uv) {
    const tex = mat?.map;
    if (!tex?.image || !uv) return null;
    try {
      const img = tex.image;
      const w = img.width || img.naturalWidth || 0, h = img.height || img.naturalHeight || 0;
      if (!w || !h) return null;
      let u = uv.x * (tex.repeat?.x ?? 1) + (tex.offset?.x ?? 0);
      let v = uv.y * (tex.repeat?.y ?? 1) + (tex.offset?.y ?? 0);
      u = ((u % 1) + 1) % 1;
      v = ((v % 1) + 1) % 1;
      const flipY = tex.flipY !== false; // THREE default: row 0 of the image is v=1
      const px = Math.min(w - 1, Math.max(0, Math.floor(u * w)));
      const py = Math.min(h - 1, Math.max(0, Math.floor((flipY ? 1 - v : v) * h)));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(px, py, 1, 1).data;
      return { rgba: [d[0], d[1], d[2], d[3]], uv: [uv.x, uv.y] };
    } catch (e) { return null; }
  }

  function _pixelProbeTextureMeta(mat) {
    const tex = mat?.map;
    if (!tex?.image) return null;
    const img = tex.image;
    const w = img.width || img.naturalWidth || 0, h = img.height || img.naturalHeight || 0;
    const ud = tex.userData || {};
    return {
      size: `${w || '?'}x${h || '?'}`,
      repeat: `${Number(tex.repeat?.x ?? 1).toFixed(2)}x${Number(tex.repeat?.y ?? 1).toFixed(2)}`,
      flipY: tex.flipY !== false,
      state: ud.hobunjiAuthoredSurfaceState || '-',
      path: ud.hobunjiAuthoredSurfacePath || '-',
      sourceSize: ud.hobunjiAuthoredSurfaceImageSize || '-',
      error: ud.hobunjiAuthoredSurfaceError || null,
    };
  }

  function _pixelProbeTextureNeighborhood(mat, uv) {
    if (!mat?.map?.image || !uv) return null;
    const offsets = [[0, 0], [-0.035, 0], [0.035, 0], [0, -0.035], [0, 0.035], [-0.025, -0.025], [0.025, 0.025]];
    const samples = offsets.map(([du, dv]) => _pixelProbeTextureSampleAtUv(mat, { x: uv.x + du, y: uv.y + dv })).filter(Boolean);
    if (samples.length < 2) return null;
    const colors = samples.map(sample => sample.rgba);
    const mins = [0, 1, 2].map(channel => Math.min(...colors.map(color => color[channel])));
    const maxs = [0, 1, 2].map(channel => Math.max(...colors.map(color => color[channel])));
    const unique = new Set(colors.map(color => color.join(','))).size;
    return { unique, mins, maxs, samples: colors.length };
  }

  // Walks up from a raycast hit to find which avatar (if any) owns it —
  // the player, an NPC walker, or a companion/mount/livestock creature —
  // and reports that owner's own current body colors alongside whatever
  // material the probe hit. Lets a tap on a procedural foot (or any
  // other body-color-tinted part) directly answer "does this material's
  // resolved color actually match this character's chosen body color"
  // without a separate headless pixel-sampling pass.
  function _pixelProbeOwnerInfo(object) {
    let node = object;
    while (node) {
      if (node === deps.playerMesh) {
        const appearance = deps.getPlayerData()?.appearance || {};
        return { kind: 'player', label: 'player', speciesId: appearance.speciesId, gender: appearance.gender, bodyColors: appearance.bodyColors, root: deps.playerMesh };
      }
      for (const w of deps.npcWalkers) {
        if (node === w.root) {
          const appearance = w.rec?.appearance || {};
          return { kind: 'npc', label: w.rec?.name || w.rec?.id || 'npc', speciesId: appearance.speciesId, gender: appearance.gender, bodyColors: w.profile?.bodyColors || appearance.bodyColors, walker: w, root: w.root };
        }
      }
      for (const c of deps.companionObjects) {
        if (node === c.avatarRef?.group) {
          const sizeClass = c.genotype?.sizeClass || c.def?.defaultSizeClass || 'medium'; // Makes size mutations visible in copied mobile probe reports.
          const scaleLabel = `${Math.round((c.visualScaleX || 1) * 100)}%×${Math.round((c.visualScaleY || 1) * 100)}%`; // Confirms the authored class scale reached this live mesh.
          const renderedScaleLabel = `${Math.round((c.avatarRef.group.scale.z || 1) * 100)}%w×${Math.round((c.avatarRef.group.scale.y || 1) * 100)}%h`; // Reports the rotated billboard's actual visible width/height axes.
          return { kind: 'creature', label: `${c.creatureKey || 'creature'}${c.stableRole ? ` (${c.stableRole})` : ''} · ${sizeClass} configured ${scaleLabel} · rendered ${renderedScaleLabel}`, speciesId: c.creatureKey, gender: null, bodyColors: c.genotype?.base ? { A: c.genotype.base.color ? { hex: c.genotype.base.color } : null } : null, root: c.avatarRef.group };
        }
      }
      node = node.parent;
    }
    return null;
  }

  // Node-by-node local position/rotation for every part of the hit character's
  // rig (avatar body, head/neck bone, hand sockets, and — for the player only,
  // since that's the one live tool-tracking case — the tool holder, which the
  // combat/weapon system parents as a SIBLING of playerMesh rather than a
  // child of it). Shares window.HobunjiTransformDump with the Attack Animation
  // Editor's own "Dump preview transforms" button so the two reports are
  // directly diffable field-for-field.
  function _pixelProbeTransformDumpLines(hits) {
    const dumpApi = window.HobunjiTransformDump;
    if (!dumpApi) return Promise.resolve(null);
    const owner = hits.map(h => _pixelProbeOwnerInfo(h.object)).find(o => o?.root);
    if (!owner) return Promise.resolve(null);

    function buildLines() {
      const lines = ['', `=== Local transform dump: ${owner.kind} "${owner.label}" (compare against the same dump taken in the Attack Animation Editor) ===`];
      lines.push(dumpApi.formatReport(dumpApi.dumpSubtree(owner.root), { title: `${owner.kind} rig` }));
      if (owner.kind === 'player' && deps.toolHolder) {
        lines.push('');
        lines.push(dumpApi.formatReport(dumpApi.dumpSubtree(deps.toolHolder), { title: 'player tool holder (parented as a sibling of playerMesh, not a child)' }));
      }
 
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
      return lines;
    }

    const composer = window.PlayerBodyTransformComposer;
    if (owner.kind !== 'player' || !composer?.captureNextRenderTransforms) return Promise.resolve(buildLines());

    // PlayerBodyTransformComposer applies body-tilt channels (e.g. the idle
    // weapon-drawn bodyYaw) as a TEMPORARY delta to playerMesh/toolHolder only
    // during the actual WebGLRenderer.render() call, then undoes it immediately
    // after. Dumping between frames (the plain buildLines() path above) would
    // read playerMesh/toolHolder back in their resting, untilted state while
    // the hand sockets — synced during that same render, against the
    // momentarily-tilted toolHolder — are left in their tilted state, an
    // internally inconsistent snapshot that looks like a bogus editor/game
    // desync. Wait for one real frame and dump from inside it instead, so
    // every part of the report reflects the exact same as-rendered state.
    return new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve(buildLines());
      };
      const scheduled = composer.captureNextRenderTransforms(finish);
      if (!scheduled) { finish(); return; }
      setTimeout(finish, 500); // Fallback if the game loop is paused/stalled — a resting-state report beats none.
    });
  }

  function _runtimeVirtualRigTransform(label, transform, parent, source) {
    const position = transform?.position || transform || {};
    const rotation = transform?.rotationDeg || {};
    const scale = transform?.scale || { x: 1, y: 1, z: 1 };
    const localPosition = new THREE.Vector3(Number(position.x) || 0, Number(position.y) || 0, Number(position.z) || 0);
    const localQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(Number(rotation.x) || 0),
      THREE.MathUtils.degToRad(Number(rotation.y) || 0),
      THREE.MathUtils.degToRad(Number(rotation.z) || 0),
      'YXZ',
    ));
    parent?.updateWorldMatrix?.(true, false);
    const worldPosition = parent?.localToWorld ? parent.localToWorld(localPosition.clone()) : localPosition.clone();
    const parentQuaternion = parent?.getWorldQuaternion
      ? parent.getWorldQuaternion(new THREE.Quaternion())
      : new THREE.Quaternion();
    const worldQuaternion = parentQuaternion.multiply(localQuaternion);
    const parentScale = parent?.getWorldScale
      ? parent.getWorldScale(new THREE.Vector3())
      : new THREE.Vector3(1, 1, 1);
    return {
      label,
      source,
      localPosition: { x: localPosition.x, y: localPosition.y, z: localPosition.z },
      localRotationDeg: { pitch: Number(rotation.x) || 0, yaw: Number(rotation.y) || 0, roll: Number(rotation.z) || 0 },
      localScale: { x: Number(scale.x) || 1, y: Number(scale.y) || 1, z: Number(scale.z) || 1 },
      worldPosition: { x: worldPosition.x, y: worldPosition.y, z: worldPosition.z },
      worldRotationDeg: window.HobunjiTransformDump.eulerYXZFromQuat(worldQuaternion),
      worldScale: { x: parentScale.x * (Number(scale.x) || 1), y: parentScale.y * (Number(scale.y) || 1), z: parentScale.z * (Number(scale.z) || 1) },
    };
  }

  // Direct runtime counterpart to MultiAvatarAnimationAuthor's rigger dump.
  // The game resolves attachment anchors as data rather than scene objects,
  // so their virtual transforms are composed through the live player root
  // here using the same values playerAttachmentAnchor() supplies to gameplay.
  function dumpRuntimeRigTransforms() {
    const dumpApi = window.HobunjiTransformDump;
    if (!dumpApi?.formatNamedTransformReport || !deps?.playerMesh) return null;
    let portrait = null;
    deps.playerMesh.traverse?.(object => {
      if (!portrait && object.name === 'player_avatar') portrait = object;
    });
    const playerData = deps.getPlayerData?.() || {};
    const appearance = playerData.appearance || {};
    const groundY = Number(deps.getPlayerGroundY?.());
    const playerWorld = deps.playerMesh.getWorldPosition(new THREE.Vector3());
    const ground = {
      label: 'ground',
      source: 'activeSurfaceYAtWorld(player)',
      localPosition: { x: 0, y: 0, z: 0 },
      localRotationDeg: { pitch: 0, yaw: 0, roll: 0 },
      localScale: { x: 1, y: 1, z: 1 },
      worldPosition: { x: playerWorld.x, y: Number.isFinite(groundY) ? groundY : playerWorld.y, z: playerWorld.z },
      worldRotationDeg: { pitch: 0, yaw: 0, roll: 0 },
      worldScale: { x: 1, y: 1, z: 1 },
    };
    const anchor = (label, name) => {
      const resolved = deps.playerAttachmentAnchor?.(name);
      return resolved ? _runtimeVirtualRigTransform(label, {
        position: resolved,
        rotationDeg: resolved.rotationDeg,
        scale: { x: 1, y: 1, z: 1 },
      }, deps.playerMesh, `playerAttachmentAnchor('${name}')`) : null;
    };
    const entries = [
      dumpApi.snapshotObject('portrait', portrait, { source: 'player_avatar Object3D' }),
      ground,
      anchor('posterior', 'posterior'),
      anchor('left hand shoulder', 'leftHandShoulder'),
      anchor('right hand shoulder', 'rightHandShoulder'),
      anchor('shoulder perch', 'shoulderPerch'),
    ];
    const report = dumpApi.formatNamedTransformReport(entries, {
      title: 'Runtime rig transforms',
      actor: playerData.name || playerData.displayName || 'player',
      species: appearance.speciesId || appearance.species || '-',
      gender: appearance.gender || '-',
      coordinateSpace: 'player-root local + live world',
    });
    if (facingSamples.length) {
      const petSamples = facingSamples.map(sample => sample.shoulderPetTransform).filter(Boolean);
      if (petSamples.length > 1) {
        const angleDelta = (a, b) => {
          let d = a - b;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          return d;
        };
        const summarizePlane = label => {
          const entries = petSamples.map(sample => sample.planes?.[label]).filter(Boolean);
          let maxYawStep = 0, maxQuatStep = 0, minUpY = 1, downFrames = 0;
          for (let i = 0; i < entries.length; i++) {
            minUpY = Math.min(minUpY, Number(entries[i].upY));
            if (entries[i].upY < 0) downFrames++;
            if (i) {
              maxYawStep = Math.max(maxYawStep, Math.abs(angleDelta(entries[i].worldYaw, entries[i - 1].worldYaw)) * 180 / Math.PI);
              const qa = entries[i].worldQuat, qb = entries[i - 1].worldQuat;
              if (qa && qb) {
                const dot = Math.min(1, Math.abs(qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3]));
                maxQuatStep = Math.max(maxQuatStep, 2 * Math.acos(dot) * 180 / Math.PI);
              }
            }
          }
          return { label, count: entries.length, maxYawStep, maxQuatStep, minUpY, downFrames };
        };
        const front = summarizePlane('front'), back = summarizePlane('back');
        lines.push('');
        lines.push('=== Shoulder-pet motion transform trace ===');
        const pausedCount = facingSamples.filter(sample => sample.paused).length;
        lines.push('Samples=' + petSamples.length + ' movementSpeed=' + Math.max(...petSamples.map(sample => sample.movementSpeed || 0)).toFixed(3) + ' paused=' + pausedCount + '/' + facingSamples.length + ' maxGroupYawStep=' + Math.max(...petSamples.slice(1).map((sample, i) => Math.abs(angleDelta(sample.groupYaw, petSamples[i].groupYaw)) * 180 / Math.PI), 0).toFixed(2) + '°');
        for (const info of [front, back]) lines.push('Plane ' + info.label + ': maxWorldYawStep=' + info.maxYawStep.toFixed(2) + '° maxQuaternionStep=' + info.maxQuatStep.toFixed(2) + '° minWorldUpY=' + info.minUpY.toFixed(4) + ' downFrames=' + info.downFrames + '/' + info.count);
        if (front.downFrames || back.downFrames || front.maxQuatStep > 90 || back.maxQuatStep > 90) lines.push('>>> TRANSFORM FLIP DETECTED — a plane pointed downward or made a >90° world-orientation jump during the sampled motion window.');
      }
    }

    const resultEl = document.getElementById('debugProbeResult');
    if (resultEl) resultEl.textContent = report;
    const screenshotEl = document.getElementById('debugProbeScreenshot');
    if (screenshotEl) screenshotEl.style.display = 'none';
    _setDebugView('probe');
    deps.showToast?.('Runtime rig transforms dumped — Copy exports this report.', true);
    return report;
  }

  // bodyColors slots are almost never stored as absolute color — they're
  // a {h,s,v} CSS-filter delta (hue-rotate deg / saturate & brightness
  // multiplier offsets) applied on top of a per-species reference
  // swatch (see _resolveTargetRgbColor/_dyeReferenceHexForSlot in
  // portrait-utils.js — the same resolver the body-color tint pipeline
  // itself uses). Printing the raw delta alone reads as nonsensical
  // (negative "hue"/"saturation") and isn't directly comparable to a
  // texture sample's rgba — resolve it to the actual hex here too.
  function _pixelProbeBodyColorSummary(bodyColors, speciesId) {
    if (!bodyColors) return '(none)';
    const referenceHex = (typeof window._dyeReferenceHexForSlot === 'function') ? window._dyeReferenceHexForSlot('A', speciesId) : '#7dc89a';
    return ['A', 'B', 'C'].filter(slot => bodyColors[slot]).map(slot => {
      const c = bodyColors[slot];
      const raw = c.hex ? c.hex : `hsv-delta(${c.h ?? '?'},${c.s ?? '?'},${c.v ?? '?'})`;
      let resolvedHex = c.hex || null;
      if (!resolvedHex && typeof window._resolveTargetRgbColor === 'function') {
        const rgb = window._resolveTargetRgbColor(c, referenceHex);
        if (Array.isArray(rgb)) resolvedHex = '#' + rgb.slice(0, 3).map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
      }
      return `${slot}=${raw}${resolvedHex ? ` (resolved ${resolvedHex})` : ''}`;
    }).join(' ') || '(none)';
  }

  // Mirrors the furniture-avatar-author tool's own Avatar-mode diagnostics
  // panel (seatDiagnosticSnapshot/updateAvatarModeDiagnostics — "Bones"/
  // "Runtime" readouts), using the exact numbers this run's leg chain
  // actually solved (see procedural-leg-animation.js's applySeatedPose,
  // which stashes them precisely for this). Only meaningful while the
  // probed avatar is actually sitting — the tool's readout is for a
  // seated avatar too — so callers gate this on sitInteraction being
  // active AND the probe having actually hit the player's own avatar,
  // and skip it entirely otherwise rather than printing stale/blank
  // seated data for a standing character.
  function _pixelProbeSeatedLegReadoutLines() {
    const debug = deps.getPlayerLegs()?.getSeatedPoseDebug?.();
    if (!debug) return null;
    const appearance = deps.getPlayerData()?.appearance || {};
    const sitInteraction = deps.getSitInteraction();
    const lines = [];
    const localSeatY = Number(sitInteraction?.seatWorldY) || 0; // Used to distinguish authored floor-relative height in mobile diagnostics.
    const surfaceSeatY = Number(sitInteraction?.seatSurfaceY) || 0; // Used to show the plateau/ramp contribution under the seat.
    const absoluteSeatY = Number(sitInteraction?.seatAbsoluteWorldY) || localSeatY + surfaceSeatY; // Used to verify the camera's world-space target height.
    lines.push('=== Seated Leg Pose Readout (compare field-for-field against the furniture-avatar-author tool: load this furniture key in Avatar mode, add a seated avatar with this species/gender, read its Bones/Runtime diagnostics) ===');
    lines.push(`Species/gender: ${appearance.speciesId || '?'} / ${appearance.gender || '?'}   Furniture: "${sitInteraction?.furnitureKey || '?'}"`);
    lines.push(`Seat anchor: localHeight=${localSeatY.toFixed(5)} surfaceY=${surfaceSeatY.toFixed(5)} absoluteY=${absoluteSeatY.toFixed(5)} tiltDeg{x,z}=(${(sitInteraction?.seatNormalDeg?.x ?? 0)},${(sitInteraction?.seatNormalDeg?.z ?? 0)}) footprintHalfDepth=${(Number(sitInteraction?.seatFootprintHalfDepth) || 0).toFixed(4)}`);
    for (const side of ['left', 'right']) {
      const leg = debug[side];
      if (!leg) { lines.push(`${side}: (not yet solved this frame)`); continue; }
      lines.push(`${side} hip X ${leg.hipX.toFixed(5)} · posterior height ${leg.posteriorHeight.toFixed(5)} · foot contact Y ${leg.footContactY.toFixed(5)} · full leg length ${leg.fullLegLength.toFixed(5)}`);
      lines.push(`  fixed thigh/calf ${leg.thighLength.toFixed(5)} / ${leg.calfLength.toFixed(5)} · thigh surface gap ${leg.thighSurfaceGap.toFixed(5)} · ${leg.calfStraight ? 'calf straight (collinear with thigh)' : 'calf 90° past edge (dropped to floor)'} · knee ${leg.kneeOverSeat ? 'over seat' : 'past edge'} · knee forward offset ${leg.kneeForwardOffset.toFixed(5)} (footprint half-depth ${leg.footprintHalfDepth.toFixed(4)})`);
    }
    return lines;
  }

  // A shoulder pet visibly clipping through the player has exactly two
  // possible mechanisms: a depthWrite/renderOrder mismatch (see
  // updatePetLayering — its overrides only get (re)applied when the
  // (active,pet) pair actually changes, so anything that left it out of
  // sync would keep drawing with the wrong depthWrite/renderOrder every
  // frame after) or a positional mismatch (the shoulderPerch/
  // shoulderGrip anchor math in updateCompanions landing the pet mesh
  // somewhere other than where the rig actually intends, e.g. a stale
  // cached anchor — see playerAttachmentAnchor/creatureAttachmentAnchor).
  // This recomputes both live and diffs them against actual live state,
  // so a probe click can confirm or rule out each directly instead of a
  // human cross-referencing several unrelated numbers by hand. Only
  // meaningful when the probe actually landed on the player's own
  // avatar or a creature currently (or, per _petLayeringPet, previously)
  // in the shoulder-pet role — gated the same way
  // _pixelProbeSeatedLegReadoutLines gates on sitInteraction, so an
  // unrelated click doesn't pad the report with a "no shoulder pet"
  // section nobody asked about.
  function _pixelProbeShoulderPetLines(hits) {
    const isDescendant = (obj, ancestor) => {
      if (!ancestor) return false;
      let n = obj;
      while (n) { if (n === ancestor) return true; n = n.parent; }
      return false;
    };
    const currentArea = deps.getCurrentArea();
    const player = deps.player;
    let liveActivePet = null;
    for (const c of deps.companionObjects) {
      if (c.health > 0 && c.areaId === currentArea && (c.master || player) === player && c.stableRole === 'shoulderPet') { liveActivePet = c; break; }
    }
    const _petLayeringPet = deps.getPetLayeringPet();
    const _petLayeringActive = deps.getPetLayeringActive();
    const hitObjects = hits.map(h => h.object);
    const hitPlayer = hitObjects.some(o => isDescendant(o, deps.playerMesh));
    const hitTrackedPet = hitObjects.some(o => isDescendant(o, _petLayeringPet?.avatarRef?.group));
    const hitLivePet = hitObjects.some(o => isDescendant(o, liveActivePet?.avatarRef?.group));
    if (!hitPlayer && !hitTrackedPet && !hitLivePet) return null;

    const lines = ['', '=== Shoulder-pet diagnostics ==='];
    lines.push(`Live active shoulder pet this frame: ${liveActivePet ? `${liveActivePet.creatureKey} (id ${liveActivePet.id})` : '(none)'}`);
    lines.push(`updatePetLayering's last-applied state: active=${_petLayeringActive} pet=${_petLayeringPet ? `${_petLayeringPet.creatureKey} (id ${_petLayeringPet.id})` : '(none)'}`);
    if (!!liveActivePet !== _petLayeringActive || liveActivePet !== _petLayeringPet) {
      lines.push(`>>> MISMATCH — updatePetLayering hasn't caught up to this frame's live shoulder-pet state. Its depthWrite/renderOrder overrides only get (re)applied when (active,pet) actually changes (see its own early-return), so the checks below may be comparing against a stale layering pass.`);
    }

    const checks = [];
    const _playerAvatarFrontMaterial = deps.getPlayerAvatarFrontMaterial();
    if (_playerAvatarFrontMaterial) checks.push(['player front plane', 'depthWrite', !liveActivePet, _playerAvatarFrontMaterial.depthWrite]);
    if (liveActivePet) {
      for (const [label, mesh] of [['active pet front plane', liveActivePet.avatarRef?.frontPlane], ['active pet back plane', liveActivePet.avatarRef?.backPlane]]) {
        if (!mesh?.material) continue;
        checks.push([label, 'depthWrite', false, mesh.material.depthWrite]);
        checks.push([label, 'renderOrder', deps.SHOULDER_PET_PLANE_RENDER_ORDER, mesh.renderOrder]);
      }
    }
    const mismatches = checks.filter(([, , expected, actual]) => expected !== actual);
    if (mismatches.length) mismatches.forEach(([label, prop, expected, actual]) => lines.push(`>>> "${label}" ${prop}=${actual}, expected ${expected} given the live shoulder-pet state above.`));
    else if (checks.length) lines.push('depthWrite/renderOrder on the player front plane and active pet planes all match what updatePetLayering should have set.');

    if (liveActivePet) {
      const sizeClass = liveActivePet.genotype?.sizeClass || liveActivePet.def?.defaultSizeClass || 'medium'; // Used in the mobile report to identify the stable role's authored size class.
      const expectedScaleY = (Number(liveActivePet.visualScaleY) || 1) * (Number(liveActivePet.scaleY) || 1); // Used below to detect a real renderer scale overwrite rather than apparent foreshortening.
      const expectedScaleZ = Number(liveActivePet.visualScaleX) || 1; // Used below because animal billboard width is carried on group Z.
      const actualScale = liveActivePet.avatarRef.group.scale; // Used below to compare the live Three.js transform with the genotype-derived scale.
      const curiosity = liveActivePet.shoulderCuriosity; // Used below to correlate a reported visual change with the random curiosity phase.
      lines.push(`Size class: ${sizeClass}   expected group scale=(1.0000, ${expectedScaleY.toFixed(4)}, ${expectedScaleZ.toFixed(4)})   actual=(${actualScale.x.toFixed(4)}, ${actualScale.y.toFixed(4)}, ${actualScale.z.toFixed(4)})`);
      lines.push(`Curiosity: phase=${curiosity?.phase || 'not-started'} bodyLean=${Number(curiosity?.currentLeanDeg || 0).toFixed(2)}° headTurn=${Number(curiosity?.currentPitchDeg || 0).toFixed(2)}°`);
      if (Math.abs(actualScale.x - 1) > 0.001 || Math.abs(actualScale.y - expectedScaleY) > 0.001 || Math.abs(actualScale.z - expectedScaleZ) > 0.001) {
        lines.push('>>> MISMATCH — the live shoulder-pet group scale no longer matches its genotype-derived scale.');
      }
      const billboardYaw = Number.isFinite(liveActivePet.pngRot) ? liveActivePet.pngRot : liveActivePet.groupRot; // Used below to verify final bodyYaw did not leak into the flat pet planes.
      const groupYaw = liveActivePet.avatarRef.group.rotation.y; // Used below to reconstruct each plane's final world yaw from its local transform.
      const frontWorldYaw = groupYaw + (liveActivePet.avatarRef.frontPlane?.rotation.y || 0); // Used below to compare the front card against the billboard yaw selected by updateCreatureMesh.
      const backWorldYaw = groupYaw + (liveActivePet.avatarRef.backPlane?.rotation.y || 0); // Used below to compare the mirrored back card against the same billboard yaw.
      const wrapAngle = radians => Math.atan2(Math.sin(radians), Math.cos(radians));
      const frontYawError = Number.isFinite(billboardYaw) ? Math.abs(wrapAngle(frontWorldYaw - (billboardYaw + Math.PI / 2))) : NaN; // Used below to expose bodyYaw leakage on mobile.
      const backYawError = Number.isFinite(billboardYaw) ? Math.abs(wrapAngle(backWorldYaw - (billboardYaw - Math.PI / 2))) : NaN; // Used below to expose the mirrored plane's equivalent leakage.
      lines.push(`Billboard yaw: selected=${Number.isFinite(billboardYaw) ? (billboardYaw * 180 / Math.PI).toFixed(2) + '°' : '-'} group=${(groupYaw * 180 / Math.PI).toFixed(2)}° frontWorld=${(frontWorldYaw * 180 / Math.PI).toFixed(2)}° backWorld=${(backWorldYaw * 180 / Math.PI).toFixed(2)}° error=${Number.isFinite(frontYawError) ? Math.max(frontYawError, backYawError).toFixed(4) : '-'} rad`);
      if (Number.isFinite(frontYawError) && Math.max(frontYawError, backYawError) > 0.001) {
        lines.push('>>> MISMATCH — final player body yaw leaked into the shoulder-pet billboard planes, so their projected width can change without any scale change.');
      }
      // Compare the two actual rendered cards, not only their shared parent.
      // This catches child-scale, geometry-size, skinning, and coplanar-depth
      // problems that can all look like one side suddenly became huge.
      const planeDetails = [];
      for (const [label, plane] of [['front', liveActivePet.avatarRef?.frontPlane], ['back', liveActivePet.avatarRef?.backPlane]]) {
        if (!plane) continue;
        plane.updateMatrixWorld?.(true);
        const localScale = plane.scale;
        const worldScale = plane.getWorldScale ? plane.getWorldScale(new THREE.Vector3()) : null;
        const params = plane.geometry?.parameters || {};
        const bounds = plane.geometry?.boundingBox;
        const size = bounds ? bounds.getSize(new THREE.Vector3()) : null;
        const worldPos = plane.getWorldPosition ? plane.getWorldPosition(new THREE.Vector3()) : plane.position;
        planeDetails.push({ label, plane, localScale, worldScale, params, size, worldPos });
        lines.push('Plane ' + label + ': localScale=(' + [localScale.x, localScale.y, localScale.z].map(v => v.toFixed(4)).join(',') + ') worldScale=(' + (worldScale ? [worldScale.x, worldScale.y, worldScale.z].map(v => v.toFixed(4)).join(',') : '-') + ') geometry=' + (Number.isFinite(params.width) ? params.width.toFixed(4) : '-') + '×' + (Number.isFinite(params.height) ? params.height.toFixed(4) : '-') + ' bounds=' + (size ? [size.x, size.y, size.z].map(v => v.toFixed(4)).join('×') : '-') + ' worldPos=(' + [worldPos.x, worldPos.y, worldPos.z].map(v => v.toFixed(4)).join(',') + ')');
      }
      if (planeDetails.length === 2) {
        const [frontInfo, backInfo] = planeDetails;
        const scaleDelta = Math.max(Math.abs(frontInfo.localScale.x - backInfo.localScale.x), Math.abs(frontInfo.localScale.y - backInfo.localScale.y), Math.abs(frontInfo.localScale.z - backInfo.localScale.z));
        const geometryWidthDelta = Math.abs((frontInfo.params.width || frontInfo.size?.x || 0) - (backInfo.params.width || backInfo.size?.x || 0));
        const geometryHeightDelta = Math.abs((frontInfo.params.height || frontInfo.size?.y || 0) - (backInfo.params.height || backInfo.size?.y || 0));
        const separation = frontInfo.worldPos.distanceTo(backInfo.worldPos);
        lines.push('Plane comparison: localScaleΔ=' + scaleDelta.toFixed(6) + ' geometryΔ=' + geometryWidthDelta.toFixed(6) + '×' + geometryHeightDelta.toFixed(6) + ' worldSeparation=' + separation.toFixed(6));
        if (scaleDelta > 0.001 || geometryWidthDelta > 0.001 || geometryHeightDelta > 0.001) lines.push('>>> MISMATCH — the two rendered shoulder-pet planes do not have identical authored dimensions.');
        if (separation < 0.0001) lines.push('>>> WARNING — the two rendered shoulder-pet planes are effectively coplanar; camera-angle flicker can alternate their pixels and mimic a scale jump.');
      }
      const perch = deps.playerAttachmentAnchor('shoulderPerch');
      const grip = deps.creatureAttachmentAnchor(liveActivePet.creatureKey, 'shoulderGrip', liveActivePet.genotype);
      if (perch && grip) {
        const attachmentDebug = liveActivePet.avatarRef.group.userData?.hobunjiShoulderPetAttachment; // Final face-relative transform recorded by updateShoulderPetMeshPin for mobile diagnosis.
        const expected = attachmentDebug?.expectedWorldPosition; // Avoids comparing the new quaternion alignment against the obsolete yaw-only probe formula.
        const expectedX = Number(expected?.[0]), expectedY = Number(expected?.[1]), expectedZ = Number(expected?.[2]);
        const actual = liveActivePet.avatarRef.group.getWorldPosition(new THREE.Vector3()); // Compares world-to-world even if an area scene later gains its own transform.
        const drift = Number.isFinite(expectedX) && Number.isFinite(expectedY) && Number.isFinite(expectedZ)
          ? Math.hypot(actual.x - expectedX, actual.y - expectedY, actual.z - expectedZ)
          : NaN; // Only reports positional drift once the final pin has produced a complete transform snapshot.
        lines.push(`Attachment rotation source: ${attachmentDebug?.rotationSource || '(awaiting final pin)'} — authored shoulderPerch rotation is relative to the live face.`);
        if (Number.isFinite(drift)) {
          lines.push(`Rig-anchor expected position: (${expectedX.toFixed(4)}, ${expectedY.toFixed(4)}, ${expectedZ.toFixed(4)})   actual mesh position: (${actual.x.toFixed(4)}, ${actual.y.toFixed(4)}, ${actual.z.toFixed(4)})   drift=${drift.toFixed(4)}`);
          if (drift > 0.01) lines.push(`>>> MISMATCH — the pet's mesh isn't where the final face-relative rig-anchor transform says it should be (drift ${drift.toFixed(4)} world units).`);
        }
        if (attachmentDebug?.recentChange) lines.push(`Most recent shoulder-pet change: ${attachmentDebug.recentChange}`);
      } else {
        lines.push(`Rig anchors unavailable for this species/creature pairing (perch=${!!perch} grip=${!!grip}) — falls back to the flat CHAR_SHOULDER_PERCENT_FALLBACK/PET_GRIP_PERCENT_FALLBACK offset instead of authored rig data.`);
      }
    }
    return lines;
  }

  // A scheduled NPC behaving visibly wrong — wandering somewhere they
  // shouldn't, or standing still without ever picking up their instrument
  // — is a state-machine question, not a rendering one, but it's exactly
  // the kind of "something is obviously off, why" report this tool exists
  // to answer for pixels. Two real bugs have lived in this exact system
  // (see js/npc-scheduling.js's own header comment): a positionRedirect
  // silently dropping a station's toolKey/label metadata, and toolKey
  // stations failing to opt out of station-wander, both invisible from a
  // screenshot alone but immediate from the walker's own live state and
  // resolved schedule target. Gated the same way seated-leg/shoulder-pet
  // diagnostics are — only when the probe actually landed on an NPC's own
  // avatar — so an unrelated click doesn't pad the report.
  function _pixelProbeNpcSchedulingLines(hits) {
    const owner = hits.map(h => _pixelProbeOwnerInfo(h.object)).find(o => o?.kind === 'npc' && o.walker);
    if (!owner) return null;
    const walker = owner.walker;
    const target = walker.currentScheduleTarget;
    const lines = ['', '=== NPC scheduling diagnostics ==='];
    lines.push(`NPC: ${walker.rec?.name || walker.rec?.id || '?'} (id ${walker.rec?.id || '?'})   area=${walker.area}   walker.state=${walker.state}`);
    if (target) {
      lines.push(`Schedule target: "${target.label || target.stationId || '(unlabeled)'}" area=${target.area} c=${target.c} r=${target.r} pose=${target.pose || '-'} toolKey=${target.toolKey || '(none)'}`);
      lines.push(`Wander config: mode=${target.wanderMode || '-'} radiusTiles=${target.wanderRadiusTiles ?? 0} shapeTiles=${target.wanderShapeTiles?.length ?? 0}`);
      if (Number.isFinite(target.c) && Number.isFinite(target.r)) {
        const dist = Math.hypot(walker.root.position.x - (target.c + 0.5), walker.root.position.z - (target.r + 0.5));
        lines.push(`Distance to target center: ${dist.toFixed(3)} tiles`);
      }
    } else {
      lines.push('Schedule target: (none resolved this tick — see console for [schedule] warnings)');
    }
    lines.push(`Currently equipped station tool: ${walker.stationToolKey || '(none)'}`);
    const onDuty = target?.label ? !!window.NpcScheduling?.isNpcOnDutyAtStation?.(walker, target.label) : null;
    if (onDuty != null) lines.push(`isNpcOnDutyAtStation(this NPC, "${target.label}"): ${onDuty ? 'YES' : 'no'}`);
    if (target?.toolKey && walker.state === 'station-wander') {
      lines.push(`>>> MISMATCH — this station has a toolKey ("${target.toolKey}") but the walker is in 'station-wander' state. toolKey stations should opt out of wandering entirely — worth a closer look.`);
    } else if (target?.toolKey && !walker.stationToolKey && walker.state === 'idle') {
      lines.push(`>>> MISMATCH — walker is idle at a toolKey station ("${target.toolKey}") but hasn't equipped it (stationToolKey is empty).`);
    }
    return lines;
  }

  function _setDebugView(view) {
    const logBtn = document.getElementById('debugViewLogBtn'), probeBtn = document.getElementById('debugViewProbeBtn');
    const logEl = document.getElementById('debugLog'), probeEl = document.getElementById('debugProbeView');
    const filterTabs = document.getElementById('debugFilterTabs');
    if (!logBtn || !probeBtn || !logEl || !probeEl) return;
    const isLog = view === 'log';
    const style = (btn, active) => {
      btn.classList.toggle('active', active);
      btn.style.background = active ? 'rgba(106,167,255,.22)' : 'rgba(255,255,255,.08)';
      btn.style.borderColor = active ? 'rgba(106,167,255,.5)' : 'rgba(255,255,255,.2)';
      btn.style.color = active ? '#6aa7ff' : '#d1d5db';
    };
    style(logBtn, isLog); style(probeBtn, !isLog);
    logEl.style.display = isLog ? '' : 'none';
    probeEl.style.display = isLog ? 'none' : '';
    if (filterTabs) filterTabs.style.display = isLog ? '' : 'none';
  }

  function disarmPixelProbe() {
    _pixelProbeArmed = false;
    const hint = document.getElementById('pixelProbeHint');
    if (hint) hint.style.display = 'none';
    deps.renderer.domElement.removeEventListener('pointerdown', _pixelProbeHandler, { capture: true });
  }

  function armPixelProbe() {
    if (_pixelProbeArmed) { disarmPixelProbe(); return; }
    _pixelProbeArmed = true;
    deps.closeMenu();
    const hint = document.getElementById('pixelProbeHint');
    if (hint) hint.style.display = 'flex';
    deps.renderer.domElement.addEventListener('pointerdown', _pixelProbeHandler, { capture: true, once: true });
  }

  async function _pixelProbeHandler(ev) {
    ev.preventDefault(); ev.stopPropagation();
    _pixelProbeArmed = false;
    const hint = document.getElementById('pixelProbeHint');
    if (hint) hint.innerHTML = '<span>🎯 Reading pixel...</span>';

    const renderer = deps.renderer, camera = deps.camera, playerMesh = deps.playerMesh;
    const currentArea = deps.getCurrentArea();
    const facingAtClick = _pixelProbeCurrentFacingDebug(); // Preserves the state of the visibly bad frame before probe re-renders run.
    const drunkAtClick = window.HobunjiDrunkWalk?.getDebug?.() || null; // Captures the gait contribution at the clicked frame.
    const composerAtClick = window.PlayerBodyTransformComposer?.getDebug?.() || null; // Captures the last normal render's temporary transform choice.
    const impactAtClick = window.ImpactRagdollPlayback?.getDebug?.() || null; // Makes player/creature impact-bank activity copyable on mobile without console access.

    const canvas = renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const clientX = ev.clientX ?? ev.touches?.[0]?.clientX ?? rect.left;
    const clientY = ev.clientY ?? ev.touches?.[0]?.clientY ?? rect.top;
    const cssX = clientX - rect.left, cssY = clientY - rect.top;
    const ndcX = (cssX / rect.width) * 2 - 1;
    const ndcY = -(cssY / rect.height) * 2 + 1;

    // Raw pixel color, read straight off the framebuffer at this exact
    // spot — WebGL readPixels origin is bottom-left, unlike DOM CSS Y.
    const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
    const fbX = Math.round(cssX * scaleX), fbY = Math.round(canvas.height - cssY * scaleY);
    let pxBuf = null;
    try {
      const gl = renderer.getContext();
      pxBuf = new Uint8Array(4);
      gl.readPixels(fbX, fbY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pxBuf);
    } catch (e) { /* readback can fail on some GPUs/contexts — still report the raycast hits below */ }

    // Every mesh along this screen ray, nearest first — not just the winner.
    _pixelProbeRaycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
    const activeScene = deps.getActiveScene();
    const hits = _pixelProbeRaycaster.intersectObjects(activeScene.children, true);

    // Screenshot of the exact moment of the click/tap, BEFORE any of the
    // isolation checks below mutate visibility — lets a probe that finds
    // "nothing wrong" numerically still be cross-checked against what
    // was actually on screen (e.g. something visibly there that the
    // raycast/material dump doesn't explain). Deliberately does NOT
    // force its own renderer.render() call first — reads back whatever
    // the browser's own normal frame loop actually last drew and
    // displayed (relies on preserveDrawingBuffer:true on the renderer
    // for this to be reliable; see its own comment). A manually-forced
    // extra render here would capture a DIFFERENT render of the "same"
    // frame instead of the one the user actually saw — confirmed live:
    // a real OS/device screenshot showed the bug, this capture (when it
    // forced its own render) consistently did not.
    let screenshotDataUrl = null;
    try {
      const rawDataUrl = canvas.toDataURL('image/png');
      // Mark exactly where the click/tap landed — canvas.toDataURL's
      // pixel space is top-left-origin like any normal image (unlike
      // WebGL readPixels' bottom-left fbX/fbY above), so the marker
      // uses the plain CSS->canvas pixel scale, not the flipped coords.
      const markerX = cssX * scaleX, markerY = cssY * scaleY;
      const img = new Image();
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = rawDataUrl; });
      const markCanvas = document.createElement('canvas');
      markCanvas.width = img.naturalWidth; markCanvas.height = img.naturalHeight;
      const mctx = markCanvas.getContext('2d');
      mctx.drawImage(img, 0, 0);
      mctx.beginPath();
      mctx.arc(markerX, markerY, 6, 0, Math.PI * 2);
      mctx.fillStyle = 'red';
      mctx.fill();
      mctx.lineWidth = 2;
      mctx.strokeStyle = 'white';
      mctx.stroke();
      screenshotDataUrl = markCanvas.toDataURL('image/png');
    } catch (e) { /* toDataURL/marker drawing can fail on some contexts — numeric probe below still stands */ }

    // Isolate the player's own avatar and each active creature avatar
    // independently, and compare the NORMAL (everything shown) pixel
    // against each isolated candidate. A flattened screenshot alone
    // can't distinguish a legitimate single opaque color from a real
    // 50/50 blend of two layers — they look identical once already
    // composited into one frame — so this settles it directly: if the
    // normal pixel doesn't cleanly match any single isolated layer, the
    // pixel is a genuine blend, live, on this exact device.
    let blendCheck = null;
    if (pxBuf) {
      try {
        const gl3 = renderer.getContext();
        const savedVis2 = [];
        activeScene.traverse(o => { if (o.visible !== undefined) savedVis2.push([o, o.visible]); });
        const sample2 = (px, py) => { const b = new Uint8Array(4); gl3.readPixels(px, py, 1, 1, gl3.RGBA, gl3.UNSIGNED_BYTE, b); return Array.from(b); };
        const hideAll = () => { for (const [obj] of savedVis2) obj.visible = false; };
        const restoreAll = () => { for (const [obj, vis] of savedVis2) obj.visible = vis; };

        let playerAvatarGroup = null;
        for (const child of playerMesh.children) if (child.name === 'player_avatar') { playerAvatarGroup = child; break; }
        const activeCreatures = [...deps.companionObjects].filter(c => c.health > 0 && c.areaId === currentArea && c.avatarRef?.group);

        hideAll(); renderer.render(activeScene, camera);
        const bg = sample2(fbX, fbY);

        const candidates = [{ label: 'background/world only', color: bg }];
        if (playerAvatarGroup) {
          hideAll(); playerAvatarGroup.visible = true;
          renderer.render(activeScene, camera);
          candidates.push({ label: 'player alone', color: sample2(fbX, fbY) });
        }
        for (const c of activeCreatures) {
          hideAll(); c.avatarRef.group.visible = true;
          renderer.render(activeScene, camera);
          candidates.push({ label: `${c.creatureKey} (${c.stableRole || 'creature'}) alone`, color: sample2(fbX, fbY) });
        }

        hideAll();
        if (playerAvatarGroup) playerAvatarGroup.visible = true;
        for (const c of activeCreatures) c.avatarRef.group.visible = true;
        renderer.render(activeScene, camera);
        const normal = sample2(fbX, fbY);

        restoreAll(); renderer.render(activeScene, camera);

        const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        let bestMatch = null, bestDist = Infinity;
        for (const cand of candidates) { const d = dist(normal, cand.color); if (d < bestDist) { bestDist = d; bestMatch = cand; } }
        blendCheck = { normal, candidates, bestMatchLabel: bestMatch?.label, bestDist, isCleanMatch: bestDist < 8 };
      } catch (e) { /* best-effort — the rest of the report still stands without it */ }
    }

    const lines = [];
    lines.push('Pixel Probe report');
    // GPU/context capabilities — a mobile WebGL context commonly only
    // grants a 16-bit depth buffer where desktop gets 24, which is a
    // classic source of z-fighting between close, overlapping geometry
    // that never reproduces on a desktop/software-renderer test.
    try {
      const gl3 = renderer.getContext();
      const dbg = gl3.getExtension('WEBGL_debug_renderer_info');
      const gpu = dbg ? gl3.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '(unavailable — extension not exposed)';
      lines.push(`GPU: ${gpu}`);
      lines.push(`Context: ${gl3 instanceof WebGL2RenderingContext ? 'WebGL2' : 'WebGL1'}  DEPTH_BITS=${gl3.getParameter(gl3.DEPTH_BITS)}  STENCIL_BITS=${gl3.getParameter(gl3.STENCIL_BITS)}  devicePixelRatio=${window.devicePixelRatio}`);
    } catch (e) { lines.push('GPU/context info: (read failed)'); }
    lines.push(`Area: ${currentArea}   CSS(${cssX.toFixed(0)},${cssY.toFixed(0)}) framebuffer(${fbX},${fbY})`);
    const objectSfxDebug = window.AudioSystem?.objectSfxDebugSnapshot?.(); // Makes tool-cue preload/lookup state visible without requiring a mobile console.
    if (objectSfxDebug) {
      const lastCue = objectSfxDebug.last;
      const ready = objectSfxDebug.preloads.filter(entry => entry.readyState >= 2).length;
      const lastCueAgeMs = lastCue ? Math.max(0, Math.round(performance.now() - lastCue.atMs)) : null; // Distinguishes a recent tool cue from unrelated companion footsteps.
      lines.push(`Tool SFX: preload ready=${ready}/${objectSfxDebug.preloads.length} last=${lastCue ? `${lastCue.key}/${lastCueAgeMs}ms ago found=${lastCue.found} preloaded=${lastCue.preloaded} readyState=${lastCue.readyState}` : 'none'}`);
    }
    const combatSfxDebug = window.AudioSystem?.combatSfxDebugSnapshot?.(); // Copyable proof of the chosen swing/impact/block cue on mobile.
    if (combatSfxDebug) {
      const lastCue = combatSfxDebug.last;
      const ready = combatSfxDebug.preloads.filter(entry => entry.readyState >= 2).length;
      const ageMs = lastCue ? Math.max(0, Math.round(performance.now() - lastCue.atMs)) : null;
      lines.push(`Combat SFX: preload ready=${ready}/${combatSfxDebug.preloads.length} last=${lastCue ? `${lastCue.key}/${ageMs}ms ago detail=${JSON.stringify(lastCue.detail)} preloaded=${lastCue.preloaded} readyState=${lastCue.readyState}` : 'none'}`);
    }
    const animalVoiceDebug = window.AnimalVocalizations?.debugSnapshot?.(); // Copyable proof of semantic intent routing on mobile.
    if (animalVoiceDebug) {
      const last = animalVoiceDebug.last;
      lines.push(`Animal voices: requested=${animalVoiceDebug.requested} rendered=${animalVoiceDebug.rendered} nods=${animalVoiceDebug.pulsed} nodding=${animalVoiceDebug.pulsing} maxNod=${animalVoiceDebug.maxHeadNodDeg}° startLag=${animalVoiceDebug.lastStartLatencyMs ?? 'none'}ms suppressed=${animalVoiceDebug.suppressed} active=${animalVoiceDebug.active} last=${last ? `${last.kind}/${last.reason || 'none'}/${last.species}` : 'none'}`);
    }
    const volumeDebug = window.NearbyVolumeCollision?.debugSnapshot?.(); // Makes local precise-cover state copyable on mobile without developer tools.
    if (volumeDebug) {
      const blocked = volumeDebug.lastBlock ? `${volumeDebug.lastBlock.kind}:${volumeDebug.lastBlock.object}@${volumeDebug.lastBlock.distanceWorld}u/${volumeDebug.lastBlock.ageMs}ms` : 'none';
      const flags = volumeDebug.options || {};
      lines.push(`Nearby cover: enabled=${flags.enabled} projectiles=${flags.projectiles} alpha=${flags.textureAlpha} mode=${volumeDebug.mode} radius=${volumeDebug.radiusTiles}t cached=${volumeDebug.candidates} segment=${volumeDebug.lastSegmentCandidateCount}/${volumeDebug.maxSegmentCandidateCount} refreshes=${volumeDebug.refreshCount} rebuild=${volumeDebug.lastRebuildMs}ms rays=${volumeDebug.testedRayCount} rayWork=${volumeDebug.lastSegmentMs}/${volumeDebug.maxSegmentMs}ms tileTrees=${volumeDebug.skippedTileCoverCount} leafCards=${volumeDebug.skippedLeafCardCount} lastBlock=${blocked}`);
    }
    const mountSync = window.Mounts?.renderSync; // Used to make rider/carrier drift inspectable from the mobile Debug tab.
    if (mountSync?.active) {
      lines.push(`Mount render sync: pre-pin XZ drift=${mountSync.beforeXzDriftTiles.toFixed(4)} tiles post-pin=${mountSync.afterXzDriftTiles.toFixed(4)} vertical correction=${mountSync.verticalCorrectionTiles.toFixed(4)} tiles`);
    }
    const climbSafety = window.ClimbSystem?.debug; // Used to diagnose mounted-climb rejection without desktop developer tools.
    if (climbSafety) {
      lines.push(`Climb safety: active=${climbSafety.playerClimbing} mount=${climbSafety.mountRideState} lastBlock=${climbSafety.lastBlockReason || 'none'}${climbSafety.lastBlockReason ? `/${climbSafety.lastBlockRideState}` : ''}`);
    }
    const creatureDeathDebug = window.CreatureDeath?.getDebug?.(); // Used to make interrupted lethal-hit recovery visible in copyable mobile probe reports.
    if (creatureDeathDebug?.lastRecovery) {
      const recovery = creatureDeathDebug.lastRecovery;
      lines.push(`Creature death: RECOVERED ${recovery.creature} at ${recovery.areaId}:${recovery.col},${recovery.row} reason=${String(recovery.reason || 'unknown').split('\n')[0]}`);
    } else if (creatureDeathDebug?.lastBegin) {
      lines.push(`Creature death: last began ${creatureDeathDebug.lastBegin.creature} in ${creatureDeathDebug.lastBegin.areaId || 'unknown area'}; no recovery needed`);
    }
    const compassDebug = window.NavigationCompass?.getDebug?.(); // Used to verify quest/threat marker bearings and distance scaling on mobile.
    if (compassDebug) {
      const markerText = compassDebug.markers.map(marker => `${marker.source}:${marker.label}@${marker.distanceTiles}t/${marker.sizePx}px/${marker.bearingDeg}°`).join(' ');
      const offAreaWaypoint = compassDebug.offAreaWaypoint ? ` offAreaWaypoint=${compassDebug.offAreaWaypoint.label}@${compassDebug.offAreaWaypoint.zoneId}` : '';
      lines.push(`Compass: ${compassDebug.visible ? 'visible' : 'hidden'} heading=${compassDebug.headingDeg}° markers=${compassDebug.markers.length} offAreaQuests=${compassDebug.offAreaQuestTargets}${offAreaWaypoint}${markerText ? ' ' + markerText : ''}`);
    }
    const wildernessMapDebug = window.WildernessMap?.getDebug?.(); // Exposes the saved waypoint and active Map-tab region without requiring desktop devtools.
    if (wildernessMapDebug) {
      const waypoint = wildernessMapDebug.waypoint;
      lines.push(`Map: zone=${wildernessMapDebug.activeZone || 'none'} landmarks=${wildernessMapDebug.visibleLandmarks} rememberedThreats=${wildernessMapDebug.rememberedThreats || 0} waypoint=${waypoint ? `${waypoint.label}@${waypoint.zoneId}:${Number(waypoint.col).toFixed(1)},${Number(waypoint.row).toFixed(1)}` : 'none'}`);
    }
    const chunkAudit = window.WildernessChunks?.snapshot?.()?.lastResidencyAudit; // Used to carry the latest button-driven chunk leak result into copied probe reports.
    if (chunkAudit) lines.push(`Chunk residency audit: ${chunkAudit.ok ? 'PASS' : `FAIL ${chunkAudit.issues.length}`} active=${chunkAudit.activeArea || '(none)'}`);
    const hitboxDebug = window.__hitboxDebug?.snapshot?.(); // Mobile-readable elevation proof for the Show Hitboxes overlay.
    if (hitboxDebug?.actors?.length) {
      // AI-state suffixes (state/passive/territorial/cfMode/...) — see
      // debug-hitboxes.js's _actorAiDebug — added so "why isn't this
      // creature reacting" is answerable straight from a copied probe
      // report instead of a follow-up round trip for a separate console
      // dump of the same creature's schedule-AI markers.
      const aiSuffix = actor => {
        let s = '';
        if (actor.state) s += `/st:${actor.state}`;
        if (actor.passive) s += '/passive';
        if (actor.territorial) s += `/terr:${actor.territorial.phase}${actor.territorial.phase === 'warning' ? `@${actor.territorial.elapsedS}s` : ''}`;
        if (actor.cfMode) s += `/cf:${actor.cfMode}`;
        if (actor.garWolfOffShift) s += '/offshift';
        if (actor.grehlrMode) s += `/gf:${actor.grehlrMode}`;
        if (actor.denHidden) s += '/denhidden';
        if (actor.nestTreeKey) s += `/nest:${actor.nestTreeKey}`;
        if (actor.denKey) s += `/den:${actor.denKey}`;
        return s;
      };
      const actorState = hitboxDebug.actors.map(actor => actor.missing
        ? `${actor.label}=missing${aiSuffix(actor)}`
        : `${actor.label}=Y${Number(actor.min.y).toFixed(2)}..${Number(actor.max.y).toFixed(2)}${actor.onBranch ? '/branch' : ''}${actor.climbing ? '/climbing' : ''}${aiSuffix(actor)}`).join(' ');
      lines.push(`3D hitboxes: ${actorState}`);
    }
    const interactionRay = hitboxDebug?.interactionRay;
    if (interactionRay) {
      lines.push(interactionRay.hit
        ? `Interaction ray: ${interactionRay.targetType || 'target'}${interactionRay.targetId ? ':' + interactionRay.targetId : ''} at ${Number(interactionRay.distanceWorld).toFixed(2)}u${interactionRay.hostile ? ' (attack precedence)' : ''}`
        : `Interaction ray: no 3D hit in ${Number(interactionRay.distanceWorld).toFixed(0)}u`);
    }
    const meleeDebug = window.__melee3DDebug?.snapshot?.(); // Exposes pitched melee acceptance and trail state without desktop developer tools.
    if (meleeDebug) {
      const result = meleeDebug.lastResult;
      lines.push(result
        ? `3D melee ${result.shape || 'collider'}: hit=${result.hit ? 'YES' : 'no'} range=${Number(result.bestDistanceWorld).toFixed(2)}/${Number(result.rangeWorld).toFixed(2)} angle=${Number(result.bestAngleDeg).toFixed(1)}°/${Number(result.halfConeDeg).toFixed(1)}° pitch=${Number(result.pitchDeg).toFixed(1)}° height=${Number(result.halfHeightWorld || 0).toFixed(2)} trails=${meleeDebug.activeTrailCount}`
        : `3D melee: no resolved swing yet; trails=${meleeDebug.activeTrailCount}`);
    }
    const held = deps.getHeldObjectDebug?.();
    if (held) lines.push(`Held objects: mode=${held.mode} tool=${held.toolVisible ? 'visible' : 'hidden'}/${held.toolParent} item=${held.heldItemVisible ? 'visible' : 'hidden'}/${held.heldItemParent} key=${held.heldItemKey || '-'} drink=${held.drinkAnimating ? `${Math.round(held.drinkProgress * 100)}%` : 'idle'}`);
    if (held?.actionArch?.length) {
      const archState = held.actionArch.map(button => `${button.id}=${button.hidden ? 'hidden' : (button.action || 'empty')}${button.blocked ? '/blocked' : ''}`).join(' ');
      lines.push(`Mobile action arch: ${archState}`);
    }
    if (held?.characterActionLocks?.length) {
      const lockState = held.characterActionLocks.map(lock => `${lock.owner}[${lock.participants.map(participant => `${participant.id}:${participant.channels.join('+')}`).join(',')}]`).join(' ');
      lines.push(`Character action locks: ${lockState}`);
    }
    if (held?.npcDrinkInteractions?.length) {
      const drinkState = held.npcDrinkInteractions.map(interaction => `${interaction.npcId}:${interaction.itemKey}/${interaction.phase}/${Math.round(interaction.progress * 100)}%`).join(' ');
      lines.push(`NPC drink interactions: ${drinkState}`);
    }
    const itemIcon = deps.getItemSpriteIconDebug?.();
    if (itemIcon) {
      const iconState = entry => entry ? `${entry.state}/${entry.hasBackground ? 'image' : 'none'}` : 'missing';
      const target = itemIcon.targetColor == null ? '-' : `#${Number(itemIcon.targetColor).toString(16).padStart(6, '0')}`;
      lines.push(`Item sprite icon: key=${itemIcon.key || '-'} sprite=${itemIcon.spriteIcon || '-'} target=${target} strip=${iconState(itemIcon.strip)} button=${iconState(itemIcon.button)} keyboard=${iconState(itemIcon.keyboard)}`);
      if (itemIcon.swigs) lines.push(`Alcohol swigs: ${itemIcon.swigs.remaining}/${itemIcon.swigs.total} in open bottle; bottles in stack=${itemIcon.swigs.bottleCount}`);
      if (itemIcon.nearbyNpcAlcohol) lines.push(`Nearby NPC alcohol: id=${itemIcon.nearbyNpcAlcohol.id} sobriety=${Number(itemIcon.nearbyNpcAlcohol.sobriety).toFixed(2)} blackoutUntilMinute=${Number(itemIcon.nearbyNpcAlcohol.blackoutUntilMinute || 0).toFixed(2)}`);
      // Deduplicate failures shared by several HUD copies so mobile reports stay compact.
      const iconErrors = [...new Set([itemIcon.strip?.error, itemIcon.button?.error, itemIcon.keyboard?.error].filter(Boolean))];
      if (iconErrors.length) lines.push(`Item sprite recolor error: ${iconErrors.join(' | ')}`);
    }
    lines.push(pxBuf ? `Raw color under cursor: rgba(${pxBuf[0]},${pxBuf[1]},${pxBuf[2]},${pxBuf[3]})` : 'Raw color under cursor: (readback failed)');
    const characterView = window.HOBUNJI_CHARACTER_VIEW_STATUS; // Published by game.js so mobile reports can verify the private camera/body lock state.
    if (characterView) {
      lines.push(`Character View: ${characterView.enabled ? 'ON' : 'off'} reason=${characterView.lastChangeReason || '-'} facing=${Number(characterView.facingAngleDeg || 0).toFixed(2)}° body=${Number(characterView.bodyYawDeg || 0).toFixed(2)}° neck=${Number(characterView.neckYawDeg || 0).toFixed(2)}°`);
    }
    if (facingAtClick) {
      lines.push('');
      lines.push('=== Player facing state at the clicked frame (captured before probe-forced renders) ===');
      lines.push(_pixelProbeFacingTraceLine({
        color: pxBuf ? Array.from(pxBuf) : [0, 0, 0, 0],
        facing: facingAtClick,
        drunk: drunkAtClick,
        composer: composerAtClick,
      }, 0));
    }
    if (impactAtClick) {
      lines.push(`Impact playback: active=${!!impactAtClick.active} bank=${impactAtClick.bank || '-'} direction=${impactAtClick.direction || '-'} creatureReactions=${impactAtClick.activeCreatureReactions || 0} composerChannels=${(composerAtClick?.channels || []).map?.(entry => entry.name || entry)?.join?.(',') || '-'}`);
    }
    lines.push(`${hits.length} mesh(es) along this ray, nearest first:`);
    hits.slice(0, 25).forEach((hit, i) => {
      const o = hit.object;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      lines.push(`${i}. "${o.name || '(unnamed)'}" dist=${hit.distance.toFixed(3)} visible=${o.visible} renderOrder=${o.renderOrder}`);
      mats.forEach(m => {
        if (!m) return;
        lines.push(`     material: ${_pixelProbeMatSummary(m)}`);
        const sample = _pixelProbeTextureSampleAtUv(m, hit.uv);
        if (sample) lines.push(`     texture sample at this mesh's own UV (${sample.uv[0].toFixed(3)},${sample.uv[1].toFixed(3)}) — occlusion-independent: rgba(${sample.rgba.join(',')})`);
        else if (m.map) lines.push(`     texture sample: unavailable (no UV on this hit)`);
        const texMeta = _pixelProbeTextureMeta(m);
        if (texMeta) lines.push(`     texture meta: image=${texMeta.size} repeat=${texMeta.repeat} flipY=${texMeta.flipY} state=${texMeta.state} source=${texMeta.path} sourceImage=${texMeta.sourceSize}${texMeta.error ? ` error=${texMeta.error}` : ''}`);
        const neighborhood = _pixelProbeTextureNeighborhood(m, hit.uv);
        if (neighborhood) lines.push(`     texture neighborhood: ${neighborhood.samples} samples unique=${neighborhood.unique} rgbRange=R${neighborhood.mins[0]}-${neighborhood.maxs[0]} G${neighborhood.mins[1]}-${neighborhood.maxs[1]} B${neighborhood.mins[2]}-${neighborhood.maxs[2]}`);
      });
      const owner = _pixelProbeOwnerInfo(o);
      if (owner) {
        lines.push(`     owner: ${owner.kind} "${owner.label}" species=${owner.speciesId || '?'} gender=${owner.gender || '-'} bodyColors: ${_pixelProbeBodyColorSummary(owner.bodyColors, owner.speciesId)}`);
      }
    });
    if (!hits.length) lines.push('(nothing hit — probably clicked empty sky/background)');

    // Only when this probe actually landed on the player's own avatar
    // AND the player is currently sitting — see
    // _pixelProbeSeatedLegReadoutLines's own comment.
    const sitInteraction = deps.getSitInteraction();
    const probedPlayerSitting = sitInteraction && sitInteraction.phase !== 'out'
      && hits.some(h => _pixelProbeOwnerInfo(h.object)?.kind === 'player');
    if (probedPlayerSitting) {
      const cameraSolve = deps.getSeatedCameraDebug?.();
      if (cameraSolve) {
        const hit = cameraSolve.directHitDistance == null ? 'none' : cameraSolve.directHitDistance.toFixed(3);
        lines.push('');
        lines.push(`Seated camera solve: ideal=${cameraSolve.idealDistance.toFixed(3)} directWallHit=${hit} desired=${cameraSolve.desiredDistance.toFixed(3)} actual=${cameraSolve.solvedDistance.toFixed(3)} sideSlide=${cameraSolve.sideOffsetDeg}deg targetY=${Number(cameraSolve.targetY || 0).toFixed(3)} floorY=${Number(cameraSolve.floorY || 0).toFixed(3)}`);
      }
      const seatedLines = _pixelProbeSeatedLegReadoutLines();
      if (seatedLines) { lines.push(''); lines.push(...seatedLines); }
    }

    const shoulderPetLines = _pixelProbeShoulderPetLines(hits);
    if (shoulderPetLines) lines.push(...shoulderPetLines);

    const npcSchedulingLines = _pixelProbeNpcSchedulingLines(hits);
    if (npcSchedulingLines) lines.push(...npcSchedulingLines);

    const transformDumpLines = await _pixelProbeTransformDumpLines(hits);
    if (transformDumpLines) lines.push(...transformDumpLines);

    if (blendCheck) {
      lines.push('');
      lines.push('=== Blend check (isolates the player + each active creature avatar independently, live, on this device) ===');
      lines.push(`Normal pixel (everything shown): rgba(${blendCheck.normal.join(',')})`);
      for (const c of blendCheck.candidates) lines.push(`  ${c.label}: rgba(${c.color.join(',')})`);
      lines.push(blendCheck.isCleanMatch
        ? `>>> CLEAN MATCH to "${blendCheck.bestMatchLabel}" (distance ${blendCheck.bestDist.toFixed(1)}) — this pixel is a single opaque layer, NOT a blend.`
        : `>>> NO CLEAN MATCH to any single layer (closest is "${blendCheck.bestMatchLabel}" at distance ${blendCheck.bestDist.toFixed(1)}) — this pixel does not match any one avatar alone, consistent with genuine blending between layers.`);
    }

    // Temporal flicker check — every isolation test above forces its OWN
    // synchronous re-render, which by definition produces one clean,
    // un-blended still frame. If the real bug is two valid renders
    // alternating faster than the eye can resolve them individually
    // (read by a human as translucent blending, even though no single
    // frame actually blends anything), no still capture — a screenshot
    // included — can ever show it; only sampling a run of REAL,
    // untouched animation frames over time can. Critically this has to
    // run BEFORE openMenu('debug') below: opening the menu sets
    // paused=true, which freezes updateCompanions (so the pet's
    // position, and this whole depth-priority system, simply stops
    // recomputing) — capturing after that would only ever see a static
    // scene by construction, guaranteeing a false "no flicker" result.
    const flickerSamples = [];
    const facingSamples = []; // Parallel 45-frame transform trace correlated one-to-one with flickerSamples.
    try {
      const glF = renderer.getContext();
      const bufF = new Uint8Array(4);
      // Races requestAnimationFrame against a plain timer so a tab where
      // rAF is throttled or never fires (some headless/backgrounded
      // contexts) can't hang this diagnostic indefinitely — it just
      // falls back to a slower tick instead.
      const nextTick = () => new Promise(resolve => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        requestAnimationFrame(finish);
        setTimeout(finish, 200);
      });
      const captureStart = Date.now();
      for (let i = 0; i < 45 && (Date.now() - captureStart) < 8000; i++) {
        await nextTick();
        glF.readPixels(fbX, fbY, 1, 1, glF.RGBA, glF.UNSIGNED_BYTE, bufF);
        const color = [bufF[0], bufF[1], bufF[2], bufF[3]]; // Frozen before the reused readPixels buffer changes next frame.
        flickerSamples.push(color);
        facingSamples.push({
          color,
          paused: !!deps.getPaused?.(),
          facing: _pixelProbeCurrentFacingDebug(),
          drunk: window.HobunjiDrunkWalk?.getDebug?.() || null,
          composer: window.PlayerBodyTransformComposer?.getDebug?.() || null,
          shoulderPetTransform: _pixelProbeShoulderPetTransformDebug(),
        });
      }
    } catch (e) { /* best-effort — the rest of the report still stands without it */ }

    if (flickerSamples.length) {
      const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const clusters = [];
      for (const s of flickerSamples) {
        let c = clusters.find(c => dist(c.color, s) < 10);
        if (c) c.count++; else clusters.push({ color: s, count: 1 });
      }
      clusters.sort((a, b) => b.count - a.count);
      lines.push('');
      lines.push(`=== Temporal flicker check (${flickerSamples.length} real animation frames sampled at this exact pixel, game running normally) ===`);
      if (clusters.length <= 1) {
        lines.push(`>>> STABLE — every sampled frame matched the same color (rgba(${clusters[0].color.join(',')})). No flicker at this pixel over this window.`);
      } else {
        lines.push(`>>> FLICKERING — ${clusters.length} distinct colors alternated across ${flickerSamples.length} frames:`);
        for (const c of clusters) lines.push(`  rgba(${c.color.join(',')}) — ${c.count}/${flickerSamples.length} frames`);
        lines.push('This is consistent with two valid renders alternating faster than a single screenshot can show, read by the eye as translucent blending.');
      }
    } else {
      lines.push('');
      lines.push('=== Temporal flicker check: skipped (game was already paused when the probe fired) ===');
    }

    if (facingSamples.length) {
      let maxRenderStep = 0; // Largest shortest-arc jump in the final game-owned playerMesh yaw.
      let maxLogicalStep = 0; // Largest shortest-arc jump in authoritative aiming/facing.
      let hardSnapFrames = 0; // Counts clamp calls that explicitly requested a dead-zone edge snap.
      let portraitSideChanges = 0; // Counts composer front/back selections changing across sampled renders.
      for (let i = 1; i < facingSamples.length; i++) {
        const current = facingSamples[i]; // Compared against previous frame for all transition counts below.
        const previous = facingSamples[i - 1]; // Baseline for this frame's deltas.
        maxRenderStep = Math.max(maxRenderStep, Math.abs(_pixelProbeAngleStepDeg(current.facing?.renderYawRad, previous.facing?.renderYawRad)));
        maxLogicalStep = Math.max(maxLogicalStep, Math.abs(_pixelProbeAngleStepDeg(current.facing?.logicalFacingRad, previous.facing?.logicalFacingRad)));
        if (current.facing?.snapToRotY != null) hardSnapFrames++;
        const currentSide = current.composer?.lastRender?.portraitSelections?.[0]?.side || null; // Compared with the preceding sampled render.
        const previousSide = previous.composer?.lastRender?.portraitSelections?.[0]?.side || null; // Previous composer-selected portrait side.
        if (currentSide !== previousSide) portraitSideChanges++;
      }
      if (facingSamples[0].facing?.snapToRotY != null) hardSnapFrames++;
      lines.push('');
      lines.push(`=== Player facing/render trace (${facingSamples.length} frames; ! marks a color, yaw, clamp, or portrait transition) ===`);
      lines.push(`Summary: maxLogicalStep=${maxLogicalStep.toFixed(2)}° maxRenderStep=${maxRenderStep.toFixed(2)}° hardSnapFrames=${hardSnapFrames} portraitSideChanges=${portraitSideChanges}`);
      for (let i = 0; i < facingSamples.length; i++) {
        lines.push(_pixelProbeFacingTraceLine(facingSamples[i], i, i ? facingSamples[i - 1] : null));
      }
    }

    const resultEl = document.getElementById('debugProbeResult');
    if (resultEl) resultEl.textContent = lines.join('\n');
    const screenshotEl = document.getElementById('debugProbeScreenshot');
    if (screenshotEl) {
      if (screenshotDataUrl) { screenshotEl.src = screenshotDataUrl; screenshotEl.style.display = ''; }
      else screenshotEl.style.display = 'none';
    }
    if (hint) hint.style.display = 'none';
    deps.openMenu('debug');
    _setDebugView('probe');
    deps.showToast('🎯 Probe captured — see Debug tab', true);
  }

  async function copyPixelProbeResult() {
    const text = document.getElementById('debugProbeResult')?.textContent || '';
    try { await navigator.clipboard.writeText(text); deps.showToast('Pixel probe report copied.', true); }
    catch (e) { console.log(text); deps.showToast('Clipboard blocked — report printed to console instead.', false); }
  }

  document.getElementById('debugProbeArmBtn')?.addEventListener('click', () => armPixelProbe());
  document.getElementById('debugRigTransformDumpBtn')?.addEventListener('click', () => dumpRuntimeRigTransforms());
  document.getElementById('pixelProbeCancelBtn')?.addEventListener('click', () => disarmPixelProbe());
  document.getElementById('debugViewLogBtn')?.addEventListener('click', () => _setDebugView('log'));
  document.getElementById('debugViewProbeBtn')?.addEventListener('click', () => _setDebugView('probe'));

  window.PixelProbe = {
    init,
    copyPixelProbeResult,
    dumpRuntimeRigTransforms,
    get armed() { return _pixelProbeArmed; },
  };
})();

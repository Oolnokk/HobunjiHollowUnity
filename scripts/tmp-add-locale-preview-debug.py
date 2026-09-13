from pathlib import Path

path = Path('docs/tools/locale-editor/locale-preview3d.js')
s = path.read_text(encoding='utf-8')

old_toolbar = '''        <button class="sec" id="locale3dFitBtn" type="button">Fit</button>'''
new_toolbar = '''        <button class="sec" id="localePreviewDebugBtn" type="button" title="Copy numeric state for this exact rendered preview">📋 Copy Preview Debug</button>\n        <button class="sec" id="locale3dFitBtn" type="button">Fit</button>'''
if old_toolbar not in s:
    raise SystemExit('toolbar anchor not found')
s = s.replace(old_toolbar, new_toolbar, 1)

old_listener = '''    document.getElementById('locale3dFitBtn').addEventListener('click', fitCamera);'''
new_listener = '''    document.getElementById('localePreviewDebugBtn').addEventListener('click', copyPreviewDebugSnapshot);\n    document.getElementById('locale3dFitBtn').addEventListener('click', fitCamera);'''
if old_listener not in s:
    raise SystemExit('fit listener anchor not found')
s = s.replace(old_listener, new_listener, 1)

insert_anchor = '''  function syncZoneChoices(locale) {'''
if insert_anchor not in s:
    raise SystemExit('syncZoneChoices anchor not found')

debug_code = r'''  function debugRound(value, digits = 4) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const p = 10 ** digits;
    return Math.round(n * p) / p;
  }
  function debugVec3(value) {
    if (!value) return null;
    return { x: debugRound(value.x), y: debugRound(value.y), z: debugRound(value.z) };
  }
  function debugEulerDeg(value) {
    if (!value || !window.THREE) return null;
    const k = 180 / Math.PI;
    return { x: debugRound(value.x * k, 2), y: debugRound(value.y * k, 2), z: debugRound(value.z * k, 2), order: value.order || 'XYZ' };
  }
  function debugBox(root) {
    if (!root || !window.THREE) return null;
    try {
      root.updateMatrixWorld?.(true);
      const box = new THREE.Box3().setFromObject(root);
      if (box.isEmpty()) return null;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      return { min: debugVec3(box.min), max: debugVec3(box.max), size: debugVec3(size), center: debugVec3(center) };
    } catch (_) { return null; }
  }
  function debugNode(root) {
    if (!root) return null;
    const worldPosition = new THREE.Vector3();
    const worldQuaternion = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    root.updateMatrixWorld?.(true);
    root.matrixWorld?.decompose?.(worldPosition, worldQuaternion, worldScale);
    const worldEuler = new THREE.Euler().setFromQuaternion(worldQuaternion, 'XYZ');
    return {
      name: root.name || '', type: root.type || '', visible: root.visible !== false,
      local: { position: debugVec3(root.position), rotationDeg: debugEulerDeg(root.rotation), scale: debugVec3(root.scale) },
      world: { position: debugVec3(worldPosition), rotationDeg: debugEulerDeg(worldEuler), scale: debugVec3(worldScale) },
      bounds: debugBox(root),
    };
  }
  function debugTile(c, r) {
    if (!currentMerged) return null;
    if (c < 0 || r < 0 || c >= currentMerged.cols || r >= currentMerged.rows) return { c, r, outOfBounds: true };
    const tile = currentMerged.tiles?.get?.(`${c},${r}`) || null;
    const cliffish = {};
    if (tile && typeof tile === 'object') {
      for (const [key, value] of Object.entries(tile)) {
        if (!/cliff|escarp|plateau|ramp/i.test(key)) continue;
        if (value == null || value === false || value === '' || typeof value === 'function') continue;
        if (typeof value === 'object') {
          try { cliffish[key] = clone(value); } catch (_) { cliffish[key] = String(value); }
        } else cliffish[key] = value;
      }
    }
    return {
      c, r,
      type: tile?.type || null,
      elevTier: debugRound(tile?.elevTier, 3) ?? 0,
      rampElevation: debugRound(tile?.rampElevation, 3),
      surfaceY: debugRound(surfaceY(currentMerged, c + 0.5, r + 0.5), 4),
      terrainMeta: cliffish,
    };
  }
  function debugPlacementResult(result) {
    if (!result) return null;
    const packProbe = p => ({
      c: p?.c, r: p?.r, matched: p?.matched, hostTier: debugRound(p?.hostTier, 3),
      terrain: p?.rule?.terrain, strength: p?.rule?.strength, facing: p?.rule?.facing,
      height: p?.rule?.height ? clone(p.rule.height) : null,
      reason: p?.reason || null,
    });
    return {
      ok: !!result.ok,
      reason: result.reason || null,
      floorTier: debugRound(result.floorTier, 3),
      failAt: result.failAt ? clone(result.failAt) : null,
      probes: (result.probes || []).map(packProbe),
      embedded: (result.embedded || []).map(packProbe),
    };
  }
  function previewDebugBounds(scale) {
    if (!currentLocale || !currentMerged) return null;
    const placed = currentInstance || currentWorkspace?.localeInstances?.find(item => item.localeId === currentLocale.id) || null;
    const anchorC = finiteCoordinate(placed?.x) ?? finiteCoordinate(placed?.col) ?? finiteCoordinate(currentCandidate?.anchorC);
    const anchorR = finiteCoordinate(placed?.y) ?? finiteCoordinate(placed?.row) ?? finiteCoordinate(currentCandidate?.anchorR);
    if (anchorC == null || anchorR == null) return null;
    const compiled = window.LocaleTerrainPlacement?.compileLocale?.(currentLocale, scale);
    const bounds = compiled?.footprint || compiled?.bounds;
    const minC = anchorC + (finiteCoordinate(bounds?.minC) ?? 0);
    const minR = anchorR + (finiteCoordinate(bounds?.minR) ?? 0);
    const maxC = anchorC + (finiteCoordinate(bounds?.maxC) ?? Math.max(0, (Number(currentLocale.cols) || 1) * scale - 1));
    const maxR = anchorR + (finiteCoordinate(bounds?.maxR) ?? Math.max(0, (Number(currentLocale.rows) || 1) * scale - 1));
    return { anchorC, anchorR, minC, minR, maxC, maxR };
  }
  function buildPreviewDebugSnapshot() {
    const scale = currentCandidate?.scale || window.LocaleTerrainPlacement?.inferGenerationScale?.(currentWorkspace) || 1;
    const bounds = previewDebugBounds(scale);
    const margin = 4;
    let terrainWindow = null;
    if (currentMerged && bounds) {
      let minC = Math.max(0, Math.floor(bounds.minC) - margin);
      let minR = Math.max(0, Math.floor(bounds.minR) - margin);
      let maxC = Math.min(currentMerged.cols - 1, Math.ceil(bounds.maxC) + margin);
      let maxR = Math.min(currentMerged.rows - 1, Math.ceil(bounds.maxR) + margin);
      // Keep dumps pasteable even for giant locales while preserving the locale center.
      const maxSpan = 42;
      if (maxC - minC + 1 > maxSpan) {
        const mid = Math.floor((bounds.minC + bounds.maxC) * 0.5);
        minC = Math.max(0, mid - Math.floor(maxSpan / 2));
        maxC = Math.min(currentMerged.cols - 1, minC + maxSpan - 1);
      }
      if (maxR - minR + 1 > maxSpan) {
        const mid = Math.floor((bounds.minR + bounds.maxR) * 0.5);
        minR = Math.max(0, mid - Math.floor(maxSpan / 2));
        maxR = Math.min(currentMerged.rows - 1, minR + maxSpan - 1);
      }
      const rows = [];
      for (let r = minR; r <= maxR; r++) {
        const cells = [];
        for (let c = minC; c <= maxC; c++) cells.push(debugTile(c, r));
        rows.push({ r, cells });
      }
      terrainWindow = { minC, minR, maxC, maxR, width: maxC - minC + 1, height: maxR - minR + 1, cellsByRow: rows };
    }

    const renderedNodes = [];
    if (scene) {
      scene.traverse(node => {
        if (!node?.name) return;
        if (node.name === 'animalDenEntrances' || node.name === 'localeSandboxExternalObjects' || node.name.startsWith('localeObject_')) renderedNodes.push(debugNode(node));
      });
    }
    const caveRoot = scene?.getObjectByName?.('animalDenEntrances') || null;
    const diagnostic = currentWorkspace?.localeTerrainDiagnostics?.find?.(item => item.localeId === currentLocale?.id) || null;
    const candidateResult = currentCandidate?.result || currentCandidate || null;
    const instanceObjects = (currentInstance?.objects || []).map(object => {
      const x = finiteCoordinate(object.x), z = finiteCoordinate(object.y);
      const w = Math.max(1, Number(object.w) || 1), h = Math.max(1, Number(object.h) || 1);
      const centerX = x == null ? null : x + w / 2;
      const centerZ = z == null ? null : z + h / 2;
      return {
        id: object.id, key: object.key, kind: object.kind, label: object.label,
        x, y: z, w, h, rot: debugRound(object.rot, 2),
        expectedGroundY: centerX == null || centerZ == null || !currentMerged ? null : debugRound(surfaceY(currentMerged, centerX, centerZ), 4),
      };
    });
    return {
      schema: 'hobunji_locale_preview_debug.v1',
      capturedAt: new Date().toISOString(),
      page: location.href,
      preview: {
        visible: previewVisible,
        scenario: currentScenario,
        seed: currentSeed,
        zoneId: currentZoneId,
        statusText: document.getElementById('locale3dStatus')?.textContent || '',
        generationScale: scale,
      },
      camera: camera ? {
        position: debugVec3(camera.position),
        rotationDeg: debugEulerDeg(camera.rotation),
        near: debugRound(camera.near), far: debugRound(camera.far),
        orbitTarget: debugVec3(controls?.target),
      } : null,
      locale: clone(currentLocale),
      placement: {
        instance: currentInstance ? {
          localeId: currentInstance.localeId, x: finiteCoordinate(currentInstance.x), y: finiteCoordinate(currentInstance.y),
          col: finiteCoordinate(currentInstance.col), row: finiteCoordinate(currentInstance.row),
          floorTier: debugRound(currentInstance.floorTier, 3), ghostFailure: !!currentInstance.ghostFailure,
          objects: instanceObjects,
          npcAnchors: clone(currentInstance.npcAnchors || []),
          connectors: clone(currentInstance.connectors || []),
        } : null,
        previewBounds: bounds,
        candidate: currentCandidate ? {
          anchorC: finiteCoordinate(currentCandidate.anchorC), anchorR: finiteCoordinate(currentCandidate.anchorR),
          scale: currentCandidate.scale, closeness: debugRound(currentCandidate.closeness, 4),
          result: debugPlacementResult(currentCandidate.result || currentCandidate),
        } : null,
        workspaceDiagnostic: diagnostic ? clone(diagnostic) : null,
      },
      rendered: {
        cave: debugNode(caveRoot),
        nodes: renderedNodes,
      },
      terrainWindow,
    };
  }
  function showPreviewDebugFallback(text) {
    document.getElementById('localePreviewDebugFallback')?.remove();
    const panel = document.createElement('div');
    panel.id = 'localePreviewDebugFallback';
    Object.assign(panel.style, { position:'absolute', inset:'48px 12px 12px', zIndex:'80', display:'flex', flexDirection:'column', gap:'6px', background:'rgba(4,8,13,.97)', border:'1px solid rgba(255,255,255,.2)', borderRadius:'10px', padding:'8px' });
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:6px;color:#dbeafe;font-size:12px;font-weight:700';
    head.textContent = 'Preview Debug JSON — clipboard unavailable';
    const close = document.createElement('button');
    close.className = 'sec'; close.type = 'button'; close.textContent = 'Close'; close.style.marginLeft = 'auto';
    close.addEventListener('click', () => panel.remove());
    head.appendChild(close);
    const area = document.createElement('textarea');
    area.readOnly = true; area.value = text;
    area.style.cssText = 'flex:1;min-height:0;width:100%;resize:none;font:11px ui-monospace,Menlo,Consolas,monospace';
    area.addEventListener('focus', () => area.select());
    panel.append(head, area);
    document.getElementById('locale3dPreview')?.appendChild(panel);
    area.focus(); area.select();
  }
  async function copyPreviewDebugSnapshot() {
    const snapshot = buildPreviewDebugSnapshot();
    const text = JSON.stringify(snapshot, null, 2);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text);
      setStatus(`Copied preview debug snapshot (${Math.round(text.length / 1024)} KB). Paste it into ChatGPT.`);
    } catch (error) {
      console.warn('[LocaleEditorSandbox] clipboard unavailable; showing debug JSON instead:', error);
      showPreviewDebugFallback(text);
      setStatus('Clipboard unavailable — debug JSON opened for manual copy.');
    }
  }

'''
s = s.replace(insert_anchor, debug_code + insert_anchor, 1)

old_install = '''    const ready = injectRelativeHeightHelpers() && injectPreviewUi();\n    if (!ready) { setTimeout(install, 120); return; }'''
new_install = '''    const ready = injectRelativeHeightHelpers() && injectPreviewUi();\n    if (!ready) { setTimeout(install, 120); return; }\n    window._localePreview3dDebug = { buildSnapshot: buildPreviewDebugSnapshot, copySnapshot: copyPreviewDebugSnapshot };'''
if old_install not in s:
    raise SystemExit('install anchor not found')
s = s.replace(old_install, new_install, 1)

path.write_text(s, encoding='utf-8')
print('Patched', path)

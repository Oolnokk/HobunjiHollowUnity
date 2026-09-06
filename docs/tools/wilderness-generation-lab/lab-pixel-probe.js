(() => {
  'use strict';

  const Preview = window.WildernessLabPreview;
  if (!Preview || Preview.__pixelProbeInstalled) return;
  Preview.__pixelProbeInstalled = true;

  let currentWorkspace = null;
  let enabled = false;
  let pinned = false;
  let lastProbe = null;

  const originalRenderWorkspace = Preview.renderWorkspace.bind(Preview);
  Preview.renderWorkspace = function renderWorkspaceWithProbe(workspace, ...args) {
    currentWorkspace = workspace;
    pinned = false;
    lastProbe = null;
    hideMarker();
    return originalRenderWorkspace(workspace, ...args);
  };
  Preview.getWorkspace = () => currentWorkspace;

  const stage = document.getElementById('stage');
  const canvas = document.getElementById('view2d');
  const viewbar = stage?.querySelector('.viewbar');
  if (!stage || !canvas || !viewbar) return;

  const probeButton = document.createElement('button');
  probeButton.id = 'pixelProbeBtn';
  probeButton.type = 'button';
  probeButton.textContent = 'Probe';
  probeButton.title = 'Inspect the exact generated and merged tile under a 2D preview pixel.';
  viewbar.appendChild(probeButton);

  const exportButton = document.createElement('button');
  exportButton.id = 'exportResultDebugBtn';
  exportButton.type = 'button';
  exportButton.className = 'secondary';
  exportButton.textContent = 'Export result';
  exportButton.title = 'Download the exact generated workspace plus the merged preview grid used by the Lab.';
  viewbar.appendChild(exportButton);

  const panel = document.createElement('div');
  panel.id = 'pixelProbePanel';
  Object.assign(panel.style, {
    display: 'none', position: 'absolute', left: '9px', bottom: '9px', zIndex: '18',
    width: 'min(520px, calc(100% - 18px))', maxHeight: '58%', overflow: 'auto',
    background: 'rgba(3,7,12,.94)', border: '1px solid rgba(255,255,255,.2)', borderRadius: '9px',
    padding: '8px', font: '11px ui-monospace,SFMono-Regular,Menlo,monospace', whiteSpace: 'pre-wrap',
    color: '#edf5ff', boxShadow: '0 8px 30px rgba(0,0,0,.4)', pointerEvents: 'auto'
  });
  panel.innerHTML = '<b>Pixel probe</b>\nHover the 2D layout. Click to pin/unpin.';
  stage.appendChild(panel);

  const marker = document.createElement('div');
  marker.id = 'pixelProbeMarker';
  Object.assign(marker.style, {
    display: 'none', position: 'absolute', zIndex: '17', pointerEvents: 'none',
    border: '2px solid #ffe66a', boxShadow: '0 0 0 1px rgba(0,0,0,.8),0 0 8px rgba(255,230,106,.8)'
  });
  stage.appendChild(marker);

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'secondary';
  copyButton.textContent = 'Copy probe JSON';
  Object.assign(copyButton.style, { display: 'none', marginTop: '7px', minHeight: '28px', padding: '3px 7px' });
  panel.appendChild(copyButton);

  function rootMap() {
    return currentWorkspace?.maps?.find(map => map && !map.isSubmap) || currentWorkspace?.maps?.[0] || null;
  }

  function safeClone(value) {
    if (value == null) return value;
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return String(value); }
  }

  function probeAt(clientX, clientY) {
    const merged = Preview.getMerged?.();
    const workspace = currentWorkspace;
    if (!merged?.cols || !merged?.rows || !workspace) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    if (x < 0 || x >= 1 || y < 0 || y >= 1) return null;
    const col = Math.max(0, Math.min(merged.cols - 1, Math.floor(x * merged.cols)));
    const row = Math.max(0, Math.min(merged.rows - 1, Math.floor(y * merged.rows)));
    const key = `${col},${row}`;
    const root = rootMap();
    const rootTile = root?.tiles?.[key] ?? null;
    const mergedTile = merged.tiles?.get?.(key) ?? null;
    const neighborhood = [];
    for (let dr = -2; dr <= 2; dr++) {
      const line = [];
      for (let dc = -2; dc <= 2; dc++) {
        const c = col + dc, r = row + dr;
        const tile = merged.tiles?.get?.(`${c},${r}`);
        line.push(tile ? {
          c, r, type: tile.type, elevTier: tile.elevTier ?? null, rampElevation: tile.rampElevation ?? null,
          object: tile.generatedObjectType ?? tile.floraKind ?? tile.rockKind ?? null,
        } : null);
      }
      neighborhood.push(line);
    }
    return {
      finalTile: { col, row, key },
      map: root ? { id: root.id, cols: root.cols, rows: root.rows, generatedFrom: safeClone(root.generatedFrom) } : null,
      entry: safeClone(workspace.entry ?? root?.transitions?.find(t => t?.id === 'sp_generated_entry') ?? null),
      corridorReport: safeClone(workspace.wildernessEntryCorridor ?? root?.generatedFrom?.narrowEntryCorridorV2 ?? null),
      rootTile: safeClone(rootTile),
      mergedTile: safeClone(mergedTile),
      neighborhood5x5: neighborhood,
    };
  }

  function positionMarker(probe) {
    if (!probe) return hideMarker();
    const merged = Preview.getMerged?.();
    const rect = canvas.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const sx = rect.width / merged.cols;
    const sy = rect.height / merged.rows;
    marker.style.left = `${rect.left - stageRect.left + probe.finalTile.col * sx}px`;
    marker.style.top = `${rect.top - stageRect.top + probe.finalTile.row * sy}px`;
    marker.style.width = `${Math.max(2, sx)}px`;
    marker.style.height = `${Math.max(2, sy)}px`;
    marker.style.display = 'block';
  }

  function hideMarker() { marker.style.display = 'none'; }

  function renderProbe(probe) {
    lastProbe = probe;
    if (!probe) {
      panel.firstChild && (panel.firstChild.textContent = 'Pixel probe');
      return;
    }
    const root = probe.rootTile || {};
    const merged = probe.mergedTile || {};
    const lines = [
      `PIXEL / FINAL TILE  ${probe.finalTile.col}, ${probe.finalTile.row}`,
      `root:   type=${root.type ?? '∅'} object=${root.generatedObjectType ?? '∅'} id=${root.generatedObjectId ?? '∅'}`,
      `merged: type=${merged.type ?? '∅'} tier=${merged.elevTier ?? '∅'} ramp=${merged.rampElevation ?? '∅'}`,
      `flags: borderEntryGate=${!!root.borderEntryGate} protected=${!!root.entryCorridorProtected} shoulder=${!!root.entryCorridorShoulder} reclaimed=${!!root.entryCorridorReclaimed}`,
      '',
      'ROOT TILE',
      JSON.stringify(probe.rootTile, null, 2),
      '',
      'MERGED TILE',
      JSON.stringify(probe.mergedTile, null, 2),
      '',
      '5×5 MERGED NEIGHBORHOOD',
      JSON.stringify(probe.neighborhood5x5, null, 2),
    ];
    const oldButton = copyButton;
    panel.textContent = lines.join('\n');
    panel.appendChild(oldButton);
    oldButton.style.display = 'inline-block';
    positionMarker(probe);
  }

  function toggleProbe(force) {
    enabled = typeof force === 'boolean' ? force : !enabled;
    pinned = false;
    probeButton.classList.toggle('active', enabled);
    probeButton.textContent = enabled ? 'Probe ON' : 'Probe';
    panel.style.display = enabled ? 'block' : 'none';
    if (enabled) {
      document.getElementById('show2dBtn')?.click();
      panel.textContent = 'Pixel probe\nHover the 2D layout. Click to pin/unpin.';
      panel.appendChild(copyButton);
      copyButton.style.display = 'none';
    } else {
      lastProbe = null;
      hideMarker();
    }
  }

  canvas.addEventListener('pointermove', event => {
    if (!enabled || pinned) return;
    renderProbe(probeAt(event.clientX, event.clientY));
  });
  canvas.addEventListener('pointerleave', () => {
    if (!enabled || pinned) return;
    hideMarker();
  });
  canvas.addEventListener('click', event => {
    if (!enabled) return;
    const probe = probeAt(event.clientX, event.clientY);
    if (!probe) return;
    pinned = !pinned;
    renderProbe(probe);
    panel.style.borderColor = pinned ? 'rgba(255,230,106,.75)' : 'rgba(255,255,255,.2)';
  });

  probeButton.addEventListener('click', () => toggleProbe());
  copyButton.addEventListener('click', async () => {
    if (!lastProbe) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(lastProbe, null, 2));
      copyButton.textContent = 'Copied';
      setTimeout(() => { copyButton.textContent = 'Copy probe JSON'; }, 900);
    } catch (_) {}
  });

  function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  exportButton.addEventListener('click', () => {
    const workspace = currentWorkspace;
    const merged = Preview.getMerged?.();
    if (!workspace || !merged) {
      exportButton.textContent = 'Generate first';
      setTimeout(() => { exportButton.textContent = 'Export result'; }, 1000);
      return;
    }
    const mergedTiles = [];
    for (const [key, tile] of merged.tiles.entries()) mergedTiles.push([key, safeClone(tile)]);
    const seed = String(document.getElementById('seedInput')?.value || 'wild').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80);
    downloadJson({
      schema: 'hobunji_wilderness_lab_result_debug.v1',
      exportedAt: new Date().toISOString(),
      seed,
      recipe: document.getElementById('recipeSelect')?.value || null,
      note: 'workspace is the exact post-generation/post-repair map passed to the preview; mergedPreview is the exact tile grid the 2D/3D Lab renderer consumed after merge-time preview transforms.',
      workspace: safeClone(workspace),
      mergedPreview: {
        cols: merged.cols,
        rows: merged.rows,
        rootMapId: merged.rootMap?.id || null,
        mesas: safeClone(merged.mesas || []),
        tiles: mergedTiles,
      },
      lastProbe: safeClone(lastProbe),
    }, `wilderness-result-${seed}.json`);
  });
})();

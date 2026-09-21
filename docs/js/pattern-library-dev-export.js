// Dev-only Settings exporter for the active character's saved PatternLibrary entries.
//
// Produces the same repo-ready pair as docs/tools/pattern-editor:
// motif_<name>.png and pattern_<name>.json, with JSON referencing the PNG
// instead of embedding base64. Unlocked built-in catalog motifs are excluded.
(() => {
  'use strict';
  if (window.PatternLibraryDevExport?.installed) return;

  const ROW_ID = 'patternLibraryDevExportRow';
  const SELECT_ID = 'patternLibraryDevExportSelect';
  const STATUS_ID = 'patternLibraryDevExportStatus';

  function slugName(value) {
    return String(value || 'untitled_pattern').trim().toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'untitled_pattern';
  }

  function cleanSettings(pattern) {
    const out = { ...(pattern || {}) };
    for (const key of ['motifDataUrl', 'motifUrl', 'customMotifId', 'repoPatternId', 'repoPatternName']) delete out[key];
    return out;
  }

  function devModeEnabled() {
    return !!document.getElementById('settingDevMode')?.checked; // Existing authoritative Settings Dev Mode switch.
  }

  function savedEntries() {
    return Array.isArray(window.PatternLibrary?.listSaved?.()) ? window.PatternLibrary.listSaved() : [];
  }

  async function motifDataUrlFor(pattern) {
    if (typeof pattern?.motifDataUrl === 'string' && pattern.motifDataUrl) return pattern.motifDataUrl;
    if (pattern?.customMotifId && typeof window.MotifStore?.loadMotif === 'function') {
      const stored = await window.MotifStore.loadMotif(pattern.customMotifId);
      if (stored) return stored;
    }
    if (typeof pattern?.motifUrl === 'string' && pattern.motifUrl) {
      const response = await fetch(pattern.motifUrl);
      if (!response.ok) throw new Error('Could not load motif image (' + response.status + ').');
      const blob = await response.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Could not read motif image.'));
        reader.readAsDataURL(blob);
      });
    }
    return null;
  }

  async function exportPayload(entry) {
    if (!entry?.pattern) throw new Error('Select a saved character pattern.');
    const motifDataUrl = await motifDataUrlFor(entry.pattern);
    if (!motifDataUrl) throw new Error('This pattern has no readable motif PNG.');
    const name = String(entry.label || entry.id || 'Untitled pattern').trim() || 'Untitled pattern';
    const id = slugName(name);
    const motifFile = 'motif_' + id + '.png';
    const jsonFile = 'pattern_' + id + '.json';
    return {
      id,
      name,
      motifFile,
      jsonFile,
      motifDataUrl,
      json: {
        schema: 'hobunji_pattern.v1',
        id,
        name,
        motifPng: 'assets/patterns/' + motifFile,
        settings: cleanSettings(entry.pattern),
      },
    };
  }

  function downloadDataUrl(dataUrl, filename) {
    const anchor = document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function downloadJson(value, filename) {
    const blob = new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function selectedEntry() {
    const id = document.getElementById(SELECT_ID)?.value;
    return id ? window.PatternLibrary?.getSaved?.(id) || null : null;
  }

  function setStatus(message, error = false) {
    const status = document.getElementById(STATUS_ID);
    if (!status) return;
    status.textContent = message || '';
    status.style.color = error ? '#ff9d9d' : 'var(--text-dim,#99a)';
  }

  function refreshPatterns() {
    const select = document.getElementById(SELECT_ID);
    if (!select) return;
    const previous = select.value;
    const entries = savedEntries();
    select.innerHTML = '';
    if (!entries.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No saved character patterns';
      select.appendChild(option);
    } else {
      for (const entry of entries) {
        const option = document.createElement('option');
        option.value = entry.id;
        option.textContent = entry.label || entry.id;
        select.appendChild(option);
      }
      if (entries.some(entry => entry.id === previous)) select.value = previous;
    }
    const disabled = !entries.length;
    document.querySelectorAll('#' + ROW_ID + ' button[data-pattern-export]').forEach(button => { button.disabled = disabled; });
    if (!disabled) setStatus(entries.length + ' saved pattern' + (entries.length === 1 ? '' : 's') + ' available.');
    else setStatus('Save a pattern to your character library first.');
  }

  async function runExport(kind) {
    const entry = selectedEntry();
    if (!entry) { setStatus('Select a saved character pattern.', true); return; }
    try {
      setStatus('Preparing ' + (entry.label || entry.id) + '…');
      const payload = await exportPayload(entry);
      if (kind === 'png' || kind === 'both') downloadDataUrl(payload.motifDataUrl, payload.motifFile);
      if (kind === 'json' || kind === 'both') {
        if (kind === 'both') await new Promise(resolve => setTimeout(resolve, 60)); // Keeps two browser downloads distinct on engines that collapse same-tick clicks.
        downloadJson(payload.json, payload.jsonFile);
      }
      const exportedFiles = kind === 'png' ? payload.motifFile : kind === 'json' ? payload.jsonFile : payload.motifFile + ' + ' + payload.jsonFile; // Reports only the files this button actually downloaded.
      setStatus('Exported ' + payload.name + ' → ' + exportedFiles + '.');
    } catch (error) {
      setStatus(String(error?.message || error), true);
    }
  }

  function syncVisibility() {
    const row = document.getElementById(ROW_ID);
    if (!row) return;
    row.hidden = !devModeEnabled();
    row.style.display = devModeEnabled() ? '' : 'none';
    if (devModeEnabled()) refreshPatterns();
  }

  function install() {
    const devToggle = document.getElementById('settingDevMode');
    const devRow = devToggle?.closest('.settings-row');
    if (!devToggle || !devRow) return false;

    let row = document.getElementById(ROW_ID);
    if (!row) {
      row = document.createElement('div');
      row.id = ROW_ID;
      row.className = 'settings-row settings-row--stacked';
      row.hidden = true;
      row.style.display = 'none';
      row.innerHTML = `
        <div class="settings-label">
          <div class="settings-name">Export Character Pattern</div>
          <div class="settings-desc">Dev-only: export a saved Pattern Library entry as the same repo-ready PNG + JSON pair used by Pattern Editor.</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;width:100%">
          <select id="${SELECT_ID}" class="settings-select" style="min-width:170px;flex:1 1 220px"></select>
          <button type="button" class="settings-small-btn" data-pattern-export="png">PNG</button>
          <button type="button" class="settings-small-btn" data-pattern-export="json">JSON</button>
          <button type="button" class="settings-small-btn" data-pattern-export="both">Both</button>
        </div>
        <div id="${STATUS_ID}" style="font-size:11px;color:var(--text-dim,#99a);margin-top:4px"></div>
      `;
      devRow.after(row);
      row.querySelector('#' + SELECT_ID)?.addEventListener('focus', refreshPatterns);
      row.querySelector('#' + SELECT_ID)?.addEventListener('pointerdown', refreshPatterns);
      row.querySelectorAll('button[data-pattern-export]').forEach(button => {
        button.addEventListener('click', () => runExport(button.dataset.patternExport));
      });
    }

    if (!devToggle.dataset.patternLibraryExportBound) {
      devToggle.dataset.patternLibraryExportBound = '1';
      devToggle.addEventListener('change', syncVisibility);
    }
    document.querySelector('.mp-tab[data-mpanel="settings"]')?.addEventListener('click', syncVisibility);
    syncVisibility();
    return true;
  }

  function boot() {
    if (install()) return;
    const observer = new MutationObserver(() => {
      if (!install()) return;
      observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.PatternLibraryDevExport = {
    installed: true,
    refresh: refreshPatterns,
    exportPayloadForId: async id => {
      const entry = window.PatternLibrary?.getSaved?.(id);
      return exportPayload(entry);
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

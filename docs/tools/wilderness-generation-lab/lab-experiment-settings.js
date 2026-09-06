(() => {
  'use strict';

  function readGeneratorControls() {
    const output = {}; // Mirrors the lab's generated control values without needing access to its private closure.
    for (const element of document.querySelectorAll('[id^="ctl_"]')) {
      if (element.id.endsWith('_num')) continue;
      const key = element.id.slice(4);
      if (!key) continue;
      if (element.type === 'checkbox') output[key] = !!element.checked;
      else if (element.tagName === 'SELECT') output[key] = element.value;
      else output[key] = Number(element.value);
    }
    const raw = document.getElementById('advancedJson')?.value.trim();
    if (raw) {
      try {
        const extra = JSON.parse(raw); // Advanced JSON intentionally merges last, matching the main lab behavior.
        if (extra && !Array.isArray(extra) && typeof extra === 'object') Object.assign(output, extra);
      } catch (_) {}
    }
    return output;
  }

  function readHybrid() {
    const value = id => Number(document.getElementById(id)?.value);
    return {
      enabled: !!document.getElementById('hybridEnabled')?.checked,
      approachSide: document.getElementById('hybridApproach')?.value || 'south',
      rise: value('hybridRise'), cliffPosition: value('hybridCliffPosition'), inclineRun: value('hybridInclineRun'),
      width: value('hybridWidth'), center: value('hybridCenter'), shoulder: value('hybridShoulder'),
      curve: value('hybridCurve'), edgeJitter: value('hybridJitter'),
    };
  }

  function readWinter() {
    const value = id => Number(document.getElementById(id)?.value);
    return {
      enabled: !!document.getElementById('winterEnabled')?.checked,
      preset: document.getElementById('winterPreset')?.value || 'snow',
      target: document.getElementById('winterTarget')?.value || 'grass',
      opacity: value('winterOpacity'), height: value('winterHeight'), noise: value('winterNoise'),
      bulge: value('winterBulge'), layers: value('winterLayers'), edge: !!document.getElementById('edgeWrapEnabled')?.checked,
      edgeWidth: value('edgeWrapWidth'), edgeDrop: value('edgeWrapDrop'), edgeRound: value('edgeWrapRoundness'),
    };
  }

  function readTerrainExperiments() {
    const value = id => Number(document.getElementById(id)?.value);
    return {
      greatBasinSpoon: {
        lowPoint: value('labBasinLowPoint'), entryCurve: value('labBasinEntryCurve'), farWallWidth: value('labBasinFarWallWidth'),
        sideRimWidth: value('labBasinSideRimWidth'), floorRatio: value('labBasinFloorRatio'),
      },
      karstTowers: {
        enabled: !!document.getElementById('labKarstEnabled')?.checked,
        count: value('labKarstCount'), minTier: value('labKarstMinTier'), maxTier: value('labKarstMaxTier'),
        radius: value('labKarstRadius'), spacing: value('labKarstSpacing'),
      },
      riverCarve: {
        enabled: !!document.getElementById('labRiverCarveEnabled')?.checked,
        depth: value('labRiverCarveDepth'), bankWidth: value('labRiverBankWidth'),
      },
    };
  }

  function packageSettings() {
    return {
      schema: 'hobunji_wilderness_generation_lab_settings.v3',
      seed: document.getElementById('seedInput')?.value.trim() || 'wild',
      settings: readGeneratorControls(),
      hybridEscarpment: readHybrid(),
      terrainExperiments: readTerrainExperiments(),
      winter: readWinter(),
    };
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' }); // Standalone download mirrors the main lab's settings exporter.
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function install() {
    const copy = document.getElementById('copySettingsBtn');
    const download = document.getElementById('downloadSettingsBtn');
    if (!copy || !download) { setTimeout(install, 80); return; }

    copy.addEventListener('click', async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const text = JSON.stringify(packageSettings(), null, 2);
      try { await navigator.clipboard.writeText(text); }
      catch (_) {
        const area = document.createElement('textarea'); // Fallback keeps mobile browsers without clipboard permission usable.
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
    }, true);

    download.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const seed = document.getElementById('seedInput')?.value.trim() || 'wild';
      downloadJson(`wilderness-lab-settings-${seed}.json`, packageSettings());
    }, true);

    window.WildernessLabExperimentSettings = { packageSettings, readTerrainExperiments };
  }

  install();
})();
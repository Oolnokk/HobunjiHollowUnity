(function () {
  'use strict';

  const EXTENSION_TAGS = new Set(['entryTunnel', 'chimney', 'porch', 'porchStair', 'railing']);
  const EMPTY_EXTENSIONS = Object.freeze({
    entryTunnels: [],
    chimneys: [],
    porches: [],
    porchStairs: [],
    railings: []
  });

  let installed = false;
  let busy = false;
  let allowOriginalGenerate = false;

  const clone = value => JSON.parse(JSON.stringify(value));

  function byId(id) {
    return document.getElementById(id);
  }

  function log(message, level = 'info') {
    const prefix = '[house repo/split]';
    const status = byId('statusLine');
    if (status) status.textContent = message;

    const output = byId('debugLog');
    if (output) {
      const line = `[${new Date().toLocaleTimeString()}] ${level}: ${prefix} ${message}`;
      output.textContent = output.textContent === 'booting...'
        ? line
        : `${output.textContent}\n${line}`;
      output.scrollTop = output.scrollHeight;
    }

    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    console[method](`${prefix} ${message}`);
  }

  function payloadPiece(payload) {
    return payload && payload.currentPiece ? payload.currentPiece : payload;
  }

  function refreshAndReadPayload() {
    const refresh = byId('refreshExportBtn');
    const output = byId('exportText');
    if (!refresh || !output) throw new Error('House editor export controls are unavailable.');
    refresh.click();
    const payload = JSON.parse(output.value);
    if (!payloadPiece(payload)?.base) throw new Error('The current house payload is missing base data.');
    return payload;
  }

  function pieceIdentity(payload) {
    const piece = payloadPiece(payload) || {};
    return {
      id: String(piece.id || ''),
      name: String(piece.name || '')
    };
  }

  function isExtensionFace(face) {
    return Boolean(
      face &&
      (
        face.extensionType ||
        EXTENSION_TAGS.has(face.tag)
      )
    );
  }

  function nextAvailableFaceId(used, start) {
    let id = start;
    do id += 1;
    while (used.has(id));
    return id;
  }

  function mergeFacesWithUniqueExtensionIds(mainFaces, extensionFaces) {
    const main = clone(mainFaces || []);
    const used = new Set();
    let maxNumericId = 0;

    for (const face of main) {
      const id = Number(face?.id);
      if (Number.isFinite(id)) {
        used.add(id);
        maxNumericId = Math.max(maxNumericId, id);
      }
    }

    const extensions = clone(extensionFaces || []);
    for (const face of extensions) {
      maxNumericId = nextAvailableFaceId(used, maxNumericId);
      face.id = maxNumericId;
      used.add(maxNumericId);
    }

    return main.concat(extensions);
  }

  function ensureExtensions(piece) {
    if (!piece.footprint) piece.footprint = {};
    if (!piece.footprint.extensions) piece.footprint.extensions = {};
    for (const key of Object.keys(EMPTY_EXTENSIONS)) {
      if (!Array.isArray(piece.footprint.extensions[key])) {
        piece.footprint.extensions[key] = [];
      }
    }
    return piece.footprint.extensions;
  }

  function clearExtensionMarkers(piece) {
    piece.footprint = piece.footprint || {};
    piece.footprint.extensions = clone(EMPTY_EXTENSIONS);
    delete piece.extensionGeneration;
  }

  function normalizeTempleDoor(payload, entry) {
    const piece = payloadPiece(payload);
    if (!piece?.footprint) return payload;

    const templeSource = /temple/i.test(String(entry?.name || '')) ||
      /temple(?:\.json)?$/i.test(String(entry?.path || '')) ||
      /temple/i.test(String(piece.name || ''));

    const firstTunnel = piece.footprint.extensions?.entryTunnels?.[0];
    if (templeSource && firstTunnel) {
      piece.footprint.door = { x: firstTunnel.x, y: firstTunnel.y };
    }
    return payload;
  }

  function setInputFiles(input, file) {
    if (typeof DataTransfer === 'function') {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      return;
    }

    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file]
    });
  }

  function waitForImportedPiece(expected, timeoutMs = 3000) {
    const started = performance.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        try {
          const current = refreshAndReadPayload();
          const actual = pieceIdentity(current);
          const idMatches = expected.id && actual.id === expected.id;
          const nameMatches = expected.name && actual.name === expected.name;
          if (idMatches || (!expected.id && nameMatches) || (expected.id && expected.name && nameMatches)) {
            resolve(current);
            return;
          }
        } catch (_error) {
          // FileReader/import may still be in progress.
        }

        if (performance.now() - started >= timeoutMs) {
          reject(new Error(`Timed out importing ${expected.name || expected.id || 'house JSON'}.`));
          return;
        }
        setTimeout(check, 40);
      };
      check();
    });
  }

  async function importPayloadThroughEditor(payload, fileName = 'repo-house.json') {
    const input = byId('jsonInput');
    if (!input) throw new Error('House editor JSON input is unavailable.');

    const expected = pieceIdentity(payload);
    const file = new File(
      [JSON.stringify(payload, null, 2)],
      fileName.replace(/[^a-z0-9_.-]+/gi, '_'),
      { type: 'application/json' }
    );

    setInputFiles(input, file);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return waitForImportedPiece(expected);
  }

  function clickOriginalGenerator() {
    const button = byId('generateBaseBtn');
    if (!button) throw new Error('Original footprint generator is unavailable.');
    allowOriginalGenerate = true;
    try {
      button.click();
    } finally {
      allowOriginalGenerate = false;
    }
  }

  async function generateMainBodyAndRoof() {
    if (busy) {
      log('A house generation operation is already running.', 'warn');
      return;
    }

    busy = true;
    try {
      const originalPayload = refreshAndReadPayload();
      const originalPiece = payloadPiece(originalPayload);
      const originalExtensions = clone(ensureExtensions(originalPiece));
      const existingExtensionFaces = (originalPiece.base?.faces || []).filter(isExtensionFace);

      const mainOnlyInput = clone(originalPayload);
      clearExtensionMarkers(payloadPiece(mainOnlyInput));
      await importPayloadThroughEditor(mainOnlyInput, 'main-body-generation-input.json');

      clickOriginalGenerator();
      const generatedPayload = refreshAndReadPayload();
      const generatedPiece = payloadPiece(generatedPayload);
      ensureExtensions(generatedPiece);
      generatedPiece.footprint.extensions = originalExtensions;
      generatedPiece.base.faces = mergeFacesWithUniqueExtensionIds(
        (generatedPiece.base.faces || []).filter(face => !isExtensionFace(face)),
        existingExtensionFaces
      );

      if (originalPiece.extensionGeneration) {
        generatedPiece.extensionGeneration = clone(originalPiece.extensionGeneration);
      } else {
        delete generatedPiece.extensionGeneration;
      }

      await importPayloadThroughEditor(generatedPayload, 'main-body-and-roof.json');
      const mainCount = generatedPiece.base.faces.filter(face => !isExtensionFace(face)).length;
      log(`Generated the main body and roof (${mainCount} main faces) without regenerating extension geometry.`);
    } catch (error) {
      log(`Main body/roof generation failed: ${error.message || error}`, 'error');
      throw error;
    } finally {
      busy = false;
    }
  }

  async function generateExtensionsOnly() {
    if (busy) {
      log('A house generation operation is already running.', 'warn');
      return;
    }

    busy = true;
    try {
      const originalPayload = refreshAndReadPayload();
      const originalPiece = payloadPiece(originalPayload);
      ensureExtensions(originalPiece);
      const preservedMainFaces = (originalPiece.base?.faces || []).filter(face => !isExtensionFace(face));

      clickOriginalGenerator();
      const fullyGeneratedPayload = refreshAndReadPayload();
      const fullyGeneratedPiece = payloadPiece(fullyGeneratedPayload);
      const generatedExtensionFaces = (fullyGeneratedPiece.base?.faces || []).filter(isExtensionFace);

      const mergedPayload = clone(originalPayload);
      const mergedPiece = payloadPiece(mergedPayload);
      mergedPiece.base.faces = mergeFacesWithUniqueExtensionIds(
        preservedMainFaces,
        generatedExtensionFaces
      );

      if (fullyGeneratedPiece.extensionGeneration) {
        mergedPiece.extensionGeneration = clone(fullyGeneratedPiece.extensionGeneration);
      } else {
        delete mergedPiece.extensionGeneration;
      }

      await importPayloadThroughEditor(mergedPayload, 'generated-house-extensions.json');
      log(`Generated ${generatedExtensionFaces.length} extension faces while preserving ${preservedMainFaces.length} main body/roof faces.`);
    } catch (error) {
      log(`Extension generation failed: ${error.message || error}`, 'error');
      throw error;
    } finally {
      busy = false;
    }
  }

  async function importHouseData(entry, data) {
    if (busy) {
      log('Finish the current house operation before importing another piece.', 'warn');
      return;
    }

    busy = true;
    try {
      const payload = normalizeTempleDoor(clone(data), entry);
      await importPayloadThroughEditor(payload, entry?.name || 'repo-house.json');
      const piece = payloadPiece(payload);
      log(`Imported repo house: ${piece?.name || entry?.name || 'unnamed house'}.`);
    } catch (error) {
      log(`Repo house import failed: ${error.message || error}`, 'error');
      throw error;
    } finally {
      busy = false;
    }
  }

  function debugSnapshot() {
    const payload = refreshAndReadPayload();
    const piece = payloadPiece(payload);
    const faces = piece.base?.faces || [];
    const extensions = ensureExtensions(piece);
    const snapshot = {
      name: piece.name || '',
      id: piece.id || '',
      preset: piece.preset || '',
      mainFaces: faces.filter(face => !isExtensionFace(face)).length,
      extensionFaces: faces.filter(isExtensionFace).length,
      extensionMarkers: Object.fromEntries(
        Object.entries(extensions).map(([key, value]) => [key, value.length])
      ),
      door: piece.footprint?.door || null,
      firstEntryTunnel: extensions.entryTunnels[0] || null
    };
    log(`Debug snapshot: ${JSON.stringify(snapshot)}`);
    console.table(snapshot);
    return snapshot;
  }

  function installGenerationButtons() {
    const original = byId('generateBaseBtn');
    if (!original || original.dataset.splitGenerationInstalled === '1') return;

    original.dataset.splitGenerationInstalled = '1';
    original.textContent = 'Generate main body + roof';
    original.title = 'Regenerate only the blue-footprint house body and roof. Existing extension geometry is preserved.';

    original.addEventListener('click', event => {
      if (allowOriginalGenerate) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void generateMainBodyAndRoof();
    }, true);

    const extensionButton = document.createElement('button');
    extensionButton.id = 'generateExtensionsBtn';
    extensionButton.type = 'button';
    extensionButton.textContent = 'Generate extensions';
    extensionButton.title = 'Regenerate entry tunnels, chimneys, porches, stairs, fences and railings without replacing main body/roof faces.';
    extensionButton.addEventListener('click', () => void generateExtensionsOnly());
    original.after(extensionButton);

    const debugButton = document.createElement('button');
    debugButton.id = 'debugHouseGenerationBtn';
    debugButton.type = 'button';
    debugButton.textContent = 'Debug generation';
    debugButton.addEventListener('click', () => {
      try {
        debugSnapshot();
      } catch (error) {
        log(`Debug snapshot failed: ${error.message || error}`, 'error');
      }
    });
    extensionButton.after(debugButton);

    const hint = original.closest('.section')?.querySelector('.hint');
    if (hint) {
      hint.textContent = 'Main body + roof regenerates only the blue-footprint structure. Generate extensions separately for entry tunnels, chimneys, porches, stairs, fences and railings; that pass preserves the current main faces.';
    }
  }

  function installRepoHousePicker() {
    if (!window.RepoPicker || byId('repoHousePickerHost')) return;

    const jsonInput = byId('jsonInput');
    const section = jsonInput?.closest('.section');
    if (!jsonInput || !section) return;

    const host = document.createElement('div');
    host.id = 'repoHousePickerHost';
    host.className = 'row';

    const picker = new window.RepoPicker({ docsBase: '../../' }).makePicker({
      category: 'housePieces',
      label: '☷ Repo Houses',
      fetchAs: 'json',
      showDisk: false,
      onLoad: (entry, data) => void importHouseData(entry, data)
    });

    host.appendChild(picker);
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = 'Load an indexed house piece directly from the repository.';
    host.appendChild(hint);

    const existingRow = jsonInput.closest('.row');
    if (existingRow) existingRow.after(host);
    else section.prepend(host);
  }

  function install() {
    if (installed) return;
    if (!window.__MHPA_READY__ || !window.RepoPicker || !byId('generateBaseBtn') || !byId('jsonInput')) {
      setTimeout(install, 100);
      return;
    }

    installed = true;
    installGenerationButtons();
    installRepoHousePicker();

    window.HousePieceAuthorRepoEnhancements = Object.freeze({
      importHouseData,
      generateMainBodyAndRoof,
      generateExtensionsOnly,
      debugSnapshot
    });

    log('Repo house imports and split footprint generation are ready.');
  }

  install();
}());

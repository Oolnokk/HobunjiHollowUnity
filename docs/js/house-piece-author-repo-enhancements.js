(function () {
  'use strict';

  const EXTENSION_TAGS = new Set(['entryTunnel', 'chimney', 'porch', 'porchStair', 'railing']);
  const EXTENSION_KEYS = ['entryTunnels', 'chimneys', 'porches', 'porchStairs', 'railings'];
  const MIN_IMPORT_SETTLE_MS = 80;

  let installed = false;
  let busy = false;
  let allowOriginalGenerate = false;

  const clone = value => JSON.parse(JSON.stringify(value));
  const byId = id => document.getElementById(id);

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
    if (!payloadPiece(payload)?.base) {
      throw new Error('The current house payload is missing base data.');
    }
    return payload;
  }

  function pieceIdentity(payload) {
    const piece = payloadPiece(payload) || {};
    return {
      id: String(piece.id || ''),
      name: String(piece.name || '')
    };
  }

  function identityMatches(expected, actual) {
    if (expected.id) return actual.id === expected.id;
    return Boolean(expected.name && actual.name === expected.name);
  }

  function identitiesMatch(left, right) {
    return left.id === right.id && left.name === right.name;
  }

  function makeTemporaryIdentity(piece, label) {
    const nonce = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    piece.id = `__mhpa_${label}_${nonce}`;
    piece.name = `__MHPA ${label} ${nonce}`;
  }

  function isExtensionFace(face) {
    return Boolean(face && (face.extensionType || EXTENSION_TAGS.has(face.tag)));
  }

  function ensureExtensions(piece) {
    piece.footprint = piece.footprint || {};
    piece.footprint.extensions = piece.footprint.extensions || {};
    for (const key of EXTENSION_KEYS) {
      if (!Array.isArray(piece.footprint.extensions[key])) {
        piece.footprint.extensions[key] = [];
      }
    }
    return piece.footprint.extensions;
  }

  function clearExtensionMarkers(piece) {
    piece.footprint = piece.footprint || {};
    piece.footprint.extensions = Object.fromEntries(
      EXTENSION_KEYS.map(key => [key, []])
    );
    delete piece.extensionGeneration;
  }

  function mergeFacesWithUniqueExtensionIds(mainFaces, extensionFaces) {
    const main = clone(mainFaces || []);
    const used = new Set();
    let nextId = 0;

    for (const face of main) {
      const id = Number(face?.id);
      if (Number.isFinite(id)) {
        used.add(id);
        nextId = Math.max(nextId, id);
      }
    }

    const extensions = clone(extensionFaces || []);
    for (const face of extensions) {
      do nextId += 1;
      while (used.has(nextId));
      face.id = nextId;
      used.add(nextId);
    }
    return main.concat(extensions);
  }

  function normalizeTempleDoor(payload, entry) {
    const piece = payloadPiece(payload);
    if (!piece?.footprint) return payload;

    const isTemple = /temple/i.test(String(entry?.name || '')) ||
      /temple(?:\.json)?$/i.test(String(entry?.path || '')) ||
      /temple/i.test(String(piece.name || ''));

    const tunnel = piece.footprint.extensions?.entryTunnels?.[0];
    if (isTemple && tunnel) {
      piece.footprint.door = { x: tunnel.x, y: tunnel.y };
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

  function waitForImportedPiece(expectedPayload, timeoutMs = 3000) {
    const expectedIdentity = pieceIdentity(expectedPayload);
    const started = performance.now();

    return new Promise((resolve, reject) => {
      const check = () => {
        const elapsed = performance.now() - started;
        try {
          const current = refreshAndReadPayload();
          if (
            elapsed >= MIN_IMPORT_SETTLE_MS &&
            identityMatches(expectedIdentity, pieceIdentity(current))
          ) {
            resolve(current);
            return;
          }
        } catch (_error) {
          // FileReader/import may still be in progress.
        }

        if (elapsed >= timeoutMs) {
          reject(new Error(
            `Timed out importing ${expectedIdentity.name || expectedIdentity.id || 'house JSON'}.`
          ));
          return;
        }
        setTimeout(check, 40);
      };
      setTimeout(check, MIN_IMPORT_SETTLE_MS);
    });
  }

  async function importPayloadThroughEditor(payload, fileName = 'repo-house.json') {
    const input = byId('jsonInput');
    if (!input) throw new Error('House editor JSON input is unavailable.');

    const file = new File(
      [JSON.stringify(payload, null, 2)],
      fileName.replace(/[^a-z0-9_.-]+/gi, '_'),
      { type: 'application/json' }
    );

    setInputFiles(input, file);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return waitForImportedPiece(payload);
  }

  async function importPayloadSafely(payload, fileName = 'repo-house.json') {
    let currentIdentity = null;
    try {
      currentIdentity = pieceIdentity(refreshAndReadPayload());
    } catch (_error) {
      // A first-time import does not require a comparison.
    }

    const targetIdentity = pieceIdentity(payload);
    if (!currentIdentity || !identitiesMatch(currentIdentity, targetIdentity)) {
      return importPayloadThroughEditor(payload, fileName);
    }

    const staged = clone(payload);
    makeTemporaryIdentity(payloadPiece(staged), 'reload');
    await importPayloadThroughEditor(staged, `staged-${fileName}`);
    return importPayloadThroughEditor(payload, fileName);
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
      const originalIdentity = pieceIdentity(originalPayload);
      const originalExtensions = clone(ensureExtensions(originalPiece));
      const preservedExtensionFaces = (originalPiece.base?.faces || []).filter(isExtensionFace);

      const mainOnlyInput = clone(originalPayload);
      const mainOnlyPiece = payloadPiece(mainOnlyInput);
      clearExtensionMarkers(mainOnlyPiece);
      makeTemporaryIdentity(mainOnlyPiece, 'main');
      await importPayloadThroughEditor(mainOnlyInput, 'main-body-generation-input.json');

      clickOriginalGenerator();

      const generatedPayload = refreshAndReadPayload();
      const generatedPiece = payloadPiece(generatedPayload);
      generatedPiece.id = originalIdentity.id;
      generatedPiece.name = originalIdentity.name;
      ensureExtensions(generatedPiece);
      generatedPiece.footprint.extensions = originalExtensions;
      generatedPiece.base.faces = mergeFacesWithUniqueExtensionIds(
        (generatedPiece.base.faces || []).filter(face => !isExtensionFace(face)),
        preservedExtensionFaces
      );

      if (originalPiece.extensionGeneration) {
        generatedPiece.extensionGeneration = clone(originalPiece.extensionGeneration);
      } else {
        delete generatedPiece.extensionGeneration;
      }

      await importPayloadThroughEditor(
        generatedPayload,
        'main-body-and-roof.json'
      );

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
      const preservedMainFaces = (originalPiece.base?.faces || []).filter(
        face => !isExtensionFace(face)
      );

      clickOriginalGenerator();

      const fullyGeneratedPayload = refreshAndReadPayload();
      const fullyGeneratedPiece = payloadPiece(fullyGeneratedPayload);
      const generatedExtensionFaces = (fullyGeneratedPiece.base?.faces || []).filter(
        isExtensionFace
      );

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

      await importPayloadSafely(
        mergedPayload,
        'generated-house-extensions.json'
      );

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
      await importPayloadSafely(payload, entry?.name || 'repo-house.json');
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

    const extensions = document.createElement('button');
    extensions.id = 'generateExtensionsBtn';
    extensions.type = 'button';
    extensions.textContent = 'Generate extensions';
    extensions.title = 'Regenerate entry tunnels, chimneys, porches, stairs, fences and railings without replacing main body/roof faces.';
    extensions.addEventListener('click', () => void generateExtensionsOnly());
    original.after(extensions);

    const debug = document.createElement('button');
    debug.id = 'debugHouseGenerationBtn';
    debug.type = 'button';
    debug.textContent = 'Debug generation';
    debug.addEventListener('click', () => {
      try {
        debugSnapshot();
      } catch (error) {
        log(`Debug snapshot failed: ${error.message || error}`, 'error');
      }
    });
    extensions.after(debug);

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

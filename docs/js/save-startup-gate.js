// Empty-save startup gate — keeps first-run browsers on save/restore choices
// instead of immediately dropping into character creation. The existing
// onboarding module still owns character creation and normal save selection;
// this module only wraps the otherwise-unavoidable fresh-start branch.
(() => {
  'use strict';

  const GATE_ID = 'hobunjiEmptySaveGate';
  const META_KEY = 'hobunjiSaveMeta';
  const SAVE_PORTRAIT_BACKING_SIZE = 200; // Matches portrait-utils' canonical backing canvas while CSS scales save-card portraits into their 80px frames.
  const SAVE_PORTRAIT_STYLE_ID = 'hobunjiSaveSelectPortraitLayoutFix'; // Used to install one scoped override for style.css's global absolute-positioned canvas rule.
  let creationChosen = false; // Used to keep the creator visible after the player explicitly chooses it.
  let observer = null; // Used to catch onboarding transitions such as deleting the final local character.
  let scheduled = false; // Used to coalesce mutation bursts into one gate refresh per frame.
  let saveSelectDateUpdates = 0; // Exposed in startup debug so mobile testing can confirm persisted dates replaced stale summary fields.
  let saveSelectPortraitRenders = 0; // Exposed in startup debug so mobile testing can confirm save portraits rendered on the canonical backing size.
  let saveSelectPortraitGearSyncs = 0; // Counts save-card portraits rebuilt from canonical gear clothing instead of stale creation-time clothing.
  let saveSelectPortraitGearSyncFailures = 0; // Exposed in debug so a bad legacy clothing record can be diagnosed without breaking save selection.
  let savePortraitCosmeticsPromise = null; // Reuses the portrait cosmetics index while canonical gear variants are resolved.

  function readMeta() {
    try {
      const raw = localStorage.getItem(META_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function hasLocalCharacters() {
    const meta = readMeta();
    return Array.isArray(meta?.characters) && meta.characters.length > 0;
  }

  function getFreshCreatorCard() {
    const overlay = document.getElementById('ob-overlay');
    if (!overlay) return null;
    const card = overlay.querySelector(':scope > .ob-card:not(.sl-card)') || overlay.querySelector('.ob-card:not(.sl-card)');
    if (!card) return null;
    const title = card.querySelector('.ob-title')?.textContent || '';
    return title.includes('Create Your Farmer') ? card : null;
  }

  function installSaveSelectPortraitStyle() {
    if (document.getElementById(SAVE_PORTRAIT_STYLE_ID)) return;
    const style = document.createElement('style'); // Save cards show an ordinary image; their renderer canvas stays detached/hidden so global fullscreen-canvas CSS cannot affect layout.
    style.id = SAVE_PORTRAIT_STYLE_ID;
    style.textContent = `
#ob-overlay .sl-char-portrait-wrap { position: relative; }
#ob-overlay .sl-portrait-canvas { display: none !important; }
#ob-overlay .sl-portrait-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}`;
    document.head.appendChild(style);
  }

  function savedWorldDay(world) {
    const calendarDay = Number(world?.calendar?.day); // Canonical persisted raw gameplay day written by CalendarSystem.
    if (Number.isFinite(calendarDay) && calendarDay >= 1) return Math.floor(calendarDay);
    const legacyDay = Number(world?.lastDay); // Compatibility fallback for saves created before world.calendar snapshots existed.
    return Number.isFinite(legacyDay) && legacyDay >= 1 ? Math.floor(legacyDay) : 1;
  }

  function savedWorldDateLabel(world) {
    const day = savedWorldDay(world); // Explicit saved day passed to the shared formatter so the live world's clock is never consulted.
    try {
      if (typeof window.CalendarSystem?.formatCalendarDate === 'function') return window.CalendarSystem.formatCalendarDate(day);
    } catch { /* Keep save selection usable if the calendar module failed to initialize. */ }
    return `Day ${day}`;
  }

  function syncSaveSelectDates() {
    const overlay = document.getElementById('ob-overlay'); // Existing save-selection DOM that onboarding-core replaces on every selection change.
    const meta = readMeta(); // Fresh metadata lets folder/cloud restores immediately show their own per-world calendar snapshots.
    if (!overlay || !Array.isArray(meta?.worlds)) return;
    for (const card of overlay.querySelectorAll('[data-sl-world], [data-sl-world-join]')) {
      const worldId = card.getAttribute('data-sl-world') || card.getAttribute('data-sl-world-join') || ''; // Existing world id carried by both owned and joinable cards.
      const world = meta.worlds.find(entry => String(entry?.id || '') === worldId); // Persisted world record supplying this card's actual saved date.
      const metaLine = card.querySelector('.sl-world-meta'); // Existing metadata line updated in place without disturbing card listeners/layout.
      if (!world || !metaLine) continue;
      const dateLabel = savedWorldDateLabel(world); // Canonical HUD-style civil date derived from world.calendar.day.
      let nextText = dateLabel; // Final metadata text; joinable cards retain their owner prefix.
      if (card.hasAttribute('data-sl-world-join')) {
        const owner = (meta.characters || []).find(character => character.id === world.ownerCharacterId); // Existing local owner used by onboarding-core's joinable-card label.
        nextText = `${owner?.nickname || 'Unknown'}'s farm · ${dateLabel}`;
      }
      if (metaLine.textContent !== nextText) {
        metaLine.textContent = nextText;
        saveSelectDateUpdates++;
      }
    }
  }

  function savePortraitCharacter(canvas) {
    const characterId = canvas?.dataset?.charId;
    if (!characterId) return null;
    return (readMeta()?.characters || []).find(
      character => String(character?.id || '') === String(characterId)
    ) || null;
  }

  function clothingTintKeysForSlot(slot) {
    if (slot === 'hat') return ['HAT'];
    if (slot === 'hood') return ['HOOD', 'HOOD_B'];
    if (slot === 'torso') return ['TORSO'];
    if (slot === 'overwear') return ['CLOTH', 'CLOTH_B'];
    return [];
  }

  function portraitTintColor(color) {
    if (!color || typeof color !== 'object') return null;
    const dyeCatalog = window.SCRATCHBONES_CONFIG?.game?.dyes?.catalog || [];
    const dye = color.dyeId ? dyeCatalog.find(entry => entry?.id === color.dyeId) : null;
    const resolved = { ...(dye?.color || {}), ...color };
    const hex = color.hex || dye?.hex;
    if (hex) {
      resolved.hex = hex;
      resolved.tintMode = resolved.tintMode || 'hexShadeFill';
    }
    return resolved;
  }

  function loadSavePortraitCosmetics() {
    if (savePortraitCosmeticsPromise) return savePortraitCosmeticsPromise;
    if (typeof window.loadPortraitCosmetics !== 'function') return Promise.resolve(null);
    savePortraitCosmeticsPromise = Promise.resolve(
      window.loadPortraitCosmetics('./config/')
    ).catch(error => {
      savePortraitCosmeticsPromise = null;
      throw error;
    });
    return savePortraitCosmeticsPromise;
  }

  function resolveSavePortraitClothingOption(cosmetics, slot, item, character) {
    const optionCache = cosmetics?.optionCache;
    const none = optionCache?.get('none') || { id: 'none', tintSlot: null, layers: [] };
    const cosmeticId = item?.cosmeticId;
    if (!cosmeticId || !optionCache) return none;

    const catalog = window.SCRATCHBONES_CONFIG?.game?.account?.shopCatalog || [];
    const base = catalog.find(entry => entry?.id === cosmeticId);
    if (!base) return optionCache.get(cosmeticId) || none;

    const speciesId = character?.appearance?.speciesId || '';
    const normalizedSpecies = String(speciesId).replace(/_/g, '-');
    const gender = character?.appearance?.gender || '';
    const candidates = catalog.filter(entry =>
      entry?.category === slot &&
      entry?.label === base.label &&
      (entry?.material || null) === (base.material || null) &&
      String(entry?.species || '').replace(/_/g, '-') === normalizedSpecies &&
      (!entry?.gender || entry.gender === gender)
    );
    return [cosmeticId, ...candidates.map(entry => entry.id)]
      .map(id => optionCache.get(id))
      .find(Boolean) || none;
  }

  async function syncSaveSelectPortraitProfile(canvas, profile) {
    const character = savePortraitCharacter(canvas);
    if (!character || !profile) return profile;

    const bodyColors = {
      ...(profile.bodyColors || {}),
      ...(character.appearance?.bodyColors || {}),
    };

    const gearClothing = character.gearInventory?.clothing;
    if (!gearClothing || typeof gearClothing !== 'object') {
      profile.bodyColors = bodyColors;
      return profile;
    }

    try {
      const cosmetics = await loadSavePortraitCosmetics();
      if (!cosmetics?.optionCache) {
        profile.bodyColors = bodyColors;
        return profile;
      }

      const profileKeyBySlot = {
        hat: 'hat',
        hood: 'hood',
        torso: 'torsoCosmetic',
        overwear: 'armCosmetic',
      };

      for (const [slot, profileKey] of Object.entries(profileKeyBySlot)) {
        const item = gearClothing[slot] || null;
        profile[profileKey] = resolveSavePortraitClothingOption(cosmetics, slot, item, character);

        const [primaryKey, secondaryKey] = clothingTintKeysForSlot(slot);
        if (primaryKey) delete bodyColors[primaryKey];
        if (secondaryKey) delete bodyColors[secondaryKey];

        const primary = portraitTintColor(item?.colorA);
        const secondary = portraitTintColor(item?.colorB);
        if (primaryKey && primary) bodyColors[primaryKey] = primary;
        if (secondaryKey && secondary) bodyColors[secondaryKey] = secondary;
      }

      profile.bodyColors = bodyColors;
      saveSelectPortraitGearSyncs++;
    } catch (error) {
      saveSelectPortraitGearSyncFailures++;
      profile.bodyColors = bodyColors;
      console.warn('[save-select] could not sync canonical clothing into portrait', error);
    }
    return profile;
  }

  function wrapSaveSelectPortraitRenderer(name) {
    const original = window[name]; // Existing shared portrait renderer remains authoritative; save-select output is rendered off-DOM and copied into a normal image element.
    if (typeof original !== 'function' || original.__hobunjiSaveSelectCanvasWrapped) return;
    const wrapped = function (canvas, ...args) {
      if (!canvas?.classList?.contains('sl-portrait-canvas')) return original.call(this, canvas, ...args);

      const frame = canvas.closest('.sl-char-portrait-wrap');
      if (!frame) return original.call(this, canvas, ...args);

      canvas.style.setProperty('display', 'none', 'important'); // Never let the page-wide fullscreen canvas rule participate in save-card layout, even for one frame.
      let image = frame.querySelector('.sl-portrait-image');
      if (!image) {
        image = document.createElement('img');
        image.className = 'sl-portrait-image';
        image.alt = '';
        image.setAttribute('aria-hidden', 'true');
        if (canvas.dataset.charId) image.dataset.charId = canvas.dataset.charId;
        frame.appendChild(image);
      }

      const renderCanvas = document.createElement('canvas'); // Detached canvas is immune to document CSS while preserving the portrait renderer's canonical coordinate space.
      renderCanvas.width = SAVE_PORTRAIT_BACKING_SIZE;
      renderCanvas.height = SAVE_PORTRAIT_BACKING_SIZE;
      saveSelectPortraitRenders++;

      const profile = args[0];
      return Promise.resolve(syncSaveSelectPortraitProfile(canvas, profile)).then(() => {
        let result;
        try {
          result = original.call(this, renderCanvas, ...args);
        } catch (error) {
          return Promise.reject(error);
        }
        return Promise.resolve(result).then(value => {
          if (image.isConnected) image.src = renderCanvas.toDataURL('image/png');
          return value;
        });
      });
    };
    Object.assign(wrapped, original);
    wrapped.__hobunjiSaveSelectCanvasWrapped = true;
    window[name] = wrapped;
  }

  function installSaveSelectPortraitFix() {
    wrapSaveSelectPortraitRenderer('renderPortraitProfile');
    wrapSaveSelectPortraitRenderer('renderProfile');
  }

  function localFolderLabel() {
    const localSave = window.LocalSaveFolder;
    if (!localSave) return 'Local Folder Unavailable';
    const status = localSave.getStatus?.() || {};
    if (status.folderName) return `Load “${status.folderName}”`;
    return 'Choose Local Save Folder';
  }

  async function loadLocalFolder(button) {
    const localSave = window.LocalSaveFolder;
    if (!localSave) return;
    const oldLabel = button.textContent;
    button.disabled = true;
    button.textContent = '…';
    try {
      let status = localSave.getStatus();
      if (!localSave.isSupported?.()) {
        alert('Local save folders are not supported in this browser. Browser saves and Netlify Cloud Save still work.');
        return;
      }
      if (status.state !== 'ready') {
        status = status.folderName ? await localSave.reconnect() : await localSave.chooseFolder();
      }
      if (status.state !== 'ready') return;
      const result = await localSave.loadFromFolder();
      if (!result?.ok) {
        alert(result?.message || 'Nothing could be loaded from that folder.');
        return;
      }
      location.reload();
    } catch (error) {
      alert('Could not load the local save folder:\n' + String(error?.message || error));
    } finally {
      button.disabled = false;
      button.textContent = oldLabel;
    }
  }

  function removeGate({ revealCreator = true } = {}) {
    document.getElementById(GATE_ID)?.remove();
    const creator = getFreshCreatorCard();
    if (creator && revealCreator) creator.style.removeProperty('display');
  }

  function buildGate(creator) {
    const gate = document.createElement('div');
    gate.id = GATE_ID;
    gate.className = 'ob-card sl-card';
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-label', 'Save selection');
    gate.innerHTML = `
      <div class="ob-title">🌿 Hobunji Hollow</div>
      <div class="sl-section">
        <div class="sl-section-label">Save Selection</div>
        <div style="padding:12px 4px;line-height:1.45;color:var(--ob-muted,#aeb9bd);">
          No farmers are saved in this browser yet. Restore an existing save, or create a new farmer when you are ready.
        </div>
      </div>
      <div class="sl-section">
        <div class="sl-section-label">Restore</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;padding-top:6px;">
          <button type="button" class="ob-tab" id="hobunjiEmptySaveCloud">☁ Cloud Save</button>
          <button type="button" class="ob-tab" id="hobunjiEmptySaveFolder">💾 ${localFolderLabel()}</button>
        </div>
      </div>
      <div class="sl-footer">
        <span style="font-size:11px;color:var(--ob-muted,#9aa8ae);">Browser storage remains the live offline save.</span>
        <button type="button" class="ob-start-btn" id="hobunjiEmptySaveCreate">＋ Create New Farmer</button>
      </div>`;

    gate.querySelector('#hobunjiEmptySaveCloud')?.addEventListener('click', () => {
      if (window.NetlifyCloudSave?.openPanel) {
        window.NetlifyCloudSave.openPanel();
      } else {
        alert('Cloud Save has not initialized yet. Reload the Netlify deployment and try again.');
      }
    });

    gate.querySelector('#hobunjiEmptySaveFolder')?.addEventListener('click', event => loadLocalFolder(event.currentTarget));
    gate.querySelector('#hobunjiEmptySaveCreate')?.addEventListener('click', () => {
      creationChosen = true;
      removeGate({ revealCreator: true });
      creator.querySelector('#ob-nickname')?.focus?.();
    });
    return gate;
  }

  function refresh() {
    scheduled = false;
    if (!document.body) return;
    syncSaveSelectDates();

    if (hasLocalCharacters()) {
      removeGate({ revealCreator: true });
      return;
    }

    const creator = getFreshCreatorCard();
    if (!creator) {
      document.getElementById(GATE_ID)?.remove();
      return;
    }

    if (creationChosen) {
      creator.style.removeProperty('display');
      document.getElementById(GATE_ID)?.remove();
      return;
    }

    creator.style.display = 'none';
    if (!document.getElementById(GATE_ID)) {
      creator.parentNode?.appendChild(buildGate(creator));
    }
  }

  function scheduleRefresh() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(refresh);
  }

  function init() {
    installSaveSelectPortraitStyle();
    installSaveSelectPortraitFix();
    refresh();
    observer = new MutationObserver(scheduleRefresh);
    observer.observe(document.body, { childList: true, subtree: true });
    window.LocalSaveFolder?.onChange?.(scheduleRefresh);
  }

  window.__hobunjiSaveStartupDebug = {
    state: () => ({
      hasLocalCharacters: hasLocalCharacters(),
      freshCreatorPresent: !!getFreshCreatorCard(),
      gatePresent: !!document.getElementById(GATE_ID),
      creationChosen,
      cloud: window.NetlifyCloudSave?.getStatus?.() || null,
      localFolder: window.LocalSaveFolder?.getStatus?.() || null,
      saveSelect: {
        portraitBackingSize: SAVE_PORTRAIT_BACKING_SIZE,
        portraitRendersCorrected: saveSelectPortraitRenders,
        portraitGearSyncs: saveSelectPortraitGearSyncs,
        portraitGearSyncFailures: saveSelectPortraitGearSyncFailures,
        dateLabelsUpdated: saveSelectDateUpdates,
        portraitLayout: [...document.querySelectorAll('.sl-char-portrait-wrap')].map(frame => {
          const image = frame.querySelector('.sl-portrait-image');
          const canvas = frame.querySelector('.sl-portrait-canvas');
          const frameRect = frame.getBoundingClientRect();
          const imageRect = image?.getBoundingClientRect();
          const characterId = image?.dataset.charId || canvas?.dataset.charId || null;
          const character = (readMeta()?.characters || []).find(
            entry => String(entry?.id || '') === String(characterId || '')
          );
          return {
            characterId,
            rendererCanvasConnected: !!canvas?.isConnected,
            rendererCanvasDisplay: canvas ? getComputedStyle(canvas).display : null,
            imageReady: !!image?.src,
            imageLeft: imageRect ? Math.round(imageRect.left) : null,
            imageTop: imageRect ? Math.round(imageRect.top) : null,
            imageWidth: imageRect ? Math.round(imageRect.width) : null,
            imageHeight: imageRect ? Math.round(imageRect.height) : null,
            frameLeft: Math.round(frameRect.left),
            frameTop: Math.round(frameRect.top),
            frameWidth: Math.round(frameRect.width),
            frameHeight: Math.round(frameRect.height),
            wornClothing: Object.fromEntries(
              Object.entries(character?.gearInventory?.clothing || {}).map(([slot, item]) => [
                slot,
                item ? {
                  cosmeticId: item.cosmeticId || null,
                  colorA: item.colorA?.dyeId || item.colorA?.hex || null,
                  colorB: item.colorB?.dyeId || item.colorB?.hex || null,
                } : null,
              ])
            ),
          };
        }),
        worlds: (readMeta()?.worlds || []).map(world => ({
          id: world.id,
          rawDay: savedWorldDay(world),
          date: savedWorldDateLabel(world),
          hasCalendarSnapshot: Number.isFinite(Number(world?.calendar?.day)),
        })),
      },
    }),
    refresh,
    showCreator: () => {
      creationChosen = true;
      removeGate({ revealCreator: true });
    },
  };

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init, { once: true });
})();

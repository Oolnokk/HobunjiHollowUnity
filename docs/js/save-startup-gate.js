// Empty-save startup gate — keeps first-run browsers on save/restore choices
// instead of immediately dropping into character creation. The existing
// onboarding module still owns character creation and normal save selection;
// this module only wraps the otherwise-unavoidable fresh-start branch.
(() => {
  'use strict';

  const GATE_ID = 'hobunjiEmptySaveGate';
  const META_KEY = 'hobunjiSaveMeta';
  let creationChosen = false; // Used to keep the creator visible after the player explicitly chooses it.
  let observer = null; // Used to catch onboarding transitions such as deleting the final local character.
  let scheduled = false; // Used to coalesce mutation bursts into one gate refresh per frame.

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

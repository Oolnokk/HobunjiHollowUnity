// Bootstrap the sanitized latest-authored rig snapshot, allowlisted Mao-ao
// shoulder authoring, shared whole-rig scale, runtime head-scale bridge, Pixel
// Probe character-rig verification, species-relative Shoulder Cam framing,
// Shoulder Cam reset controls, Mao-ao arm tint correction, and Full Character
// Scale workspace.
(() => {
  'use strict';

  const AUTHOR_PATH_RE = /\/tools\/animation-author\/(?:index\.html)?$/; // Limits repository-source overrides and reload behavior to Animation Author.
  const SOURCE_SETTINGS_KEY = 'hobunjiNpcPlaneAvatarRepoViewer.source.v1'; // Same persisted repository selector consumed by Animation Author on startup.
  const RELOAD_MARKER_KEY = 'hobunjiAnimationAuthor.repositoryRigReload.v1'; // Session diagnostic proving the last manual Load repository reset.
  const RIG_DRAFT_KEYS = Object.freeze([
    'hobunjiAttachmentRigProfiles.v2',
    'hobunjiFullCharacterRigScales.v2',
    'hobunjiFullCharacterRigScales.v1',
  ]); // Local rig/scale drafts cleared only by an explicit Load repository click.

  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const localBase = selfUrl ? new URL('./', selfUrl) : new URL('./js/', location.href); // Page-paired fallback and home of PR-local extensions.

  function selectedRepositoryScriptBase() {
    if (!AUTHOR_PATH_RE.test(location.pathname)) return null;
    const sha = String(document.getElementById('sourceSha')?.textContent || '').trim(); // Exact commit resolved by loadSource() before the rig bootstrap is requested.
    if (!/^[0-9a-f]{40}$/i.test(sha)) return null;
    const owner = String(document.getElementById('ownerInput')?.value || '').trim(); // Repository owner used in the immutable CDN URL below.
    const repo = String(document.getElementById('repoInput')?.value || '').trim(); // Repository name used in the immutable CDN URL below.
    const docsRoot = String(document.getElementById('docsInput')?.value || 'docs/').trim().replace(/^\/+|\/+$/g, ''); // Selected docs root containing config/ and js/.
    if (!owner || !repo) return null;
    const encodedDocsRoot = docsRoot.split('/').filter(Boolean).map(encodeURIComponent).join('/'); // Preserves nested docs roots without allowing raw path characters into the CDN URL.
    const docsPrefix = encodedDocsRoot ? `${encodedDocsRoot}/` : '';
    return new URL(`https://cdn.jsdelivr.net/gh/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}@${sha}/${docsPrefix}js/`);
  }

  const repositoryBase = selectedRepositoryScriptBase(); // Exact selected-repository SHA when Animation Author has resolved one; otherwise null.
  const runtimeBase = repositoryBase || localBase; // Existing rig/runtime modules should match the selected repository whenever possible.
  const urls = [
    ...(repositoryBase ? [new URL('../config/attachment-rig-profiles.js?v=20260907repo1', repositoryBase).href] : []), // Replaces the page's stale static rig global before any repository-authored anatomy/scale logic runs.
    new URL('../config/character-rig-scale-defaults.js?v=20260905d', runtimeBase).href,
    new URL('attachment-rig-latest-authored-snapshot-core.js?v=20260904a', runtimeBase).href,
    new URL('character-rig-maoao-authored-20260905.js?v=20260905b', runtimeBase).href,
    new URL('character-rig-scale.js?v=20260904i', runtimeBase).href,
    new URL('character-rig-scale-avatar-runtime.js?v=20260905a', runtimeBase).href,
    new URL('maoao-arm-tint-runtime.js?v=20260907a', runtimeBase).href,
    new URL('shoulder-camera-character-framing.js?v=20260907a', runtimeBase).href,
    new URL('shoulder-camera-reset-button.js?v=20260907a', runtimeBase).href,
    new URL('character-rig-pixel-probe-runtime.js?v=20260905a', runtimeBase).href,
    new URL('character-scale-comparison-host-bridge.js?v=20260904j', runtimeBase).href,
    new URL('character-scale-comparison.js?v=20260904k', runtimeBase).href,
    new URL('character-scale-comparison-body-input-guard.js?v=20260905b', runtimeBase).href,
    new URL('character-scale-comparison-presentation.js?v=20260905b', runtimeBase).href,
    new URL('character-scale-portrait-x-authored-defaults.js?v=20260907a', localBase).href,
    new URL('character-scale-portrait-x-offset.js?v=20260907b', localBase).href,
  ];

  function currentRepositorySettings() {
    return {
      owner: String(document.getElementById('ownerInput')?.value || 'Oolnokk').trim(),
      repo: String(document.getElementById('repoInput')?.value || 'HobunjiHollowUnity').trim(),
      ref: String(document.getElementById('refInput')?.value || 'main').trim() || 'main',
      docsRoot: String(document.getElementById('docsInput')?.value || 'docs/').trim() || 'docs/',
      dbPath: String(document.getElementById('dbPathInput')?.value || 'docs/config/npcs/hobunji-starter-npc-database.json').trim(),
    }; // Values the page's normal startup readSettings() will consume immediately after the clean reload.
  }

  function publishRepositoryDiagnostics(extra = {}) {
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    let reloadMarker = null; // Last manual repository reset, readable from the existing mobile diagnostics surface.
    try { reloadMarker = JSON.parse(sessionStorage.getItem(RELOAD_MARKER_KEY) || 'null'); } catch (_) {}
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.animationAuthorRepositoryRigSource = {
      mode: repositoryBase ? 'resolved-repository-sha' : 'page-paired-fallback',
      resolvedSha: String(document.getElementById('sourceSha')?.textContent || '').trim() || null,
      repositoryScriptBase: repositoryBase?.href || null,
      localExtensionBase: localBase.href,
      exactAttachmentRigLoadedFirst: !!repositoryBase,
      manualReloadClears: [...RIG_DRAFT_KEYS],
      reloadMarker,
      ...extra,
    };
  }

  function installCleanRepositoryReload() {
    if (!AUTHOR_PATH_RE.test(location.pathname)) return true;
    const button = document.getElementById('reloadBtn'); // Existing Load repository button; capture phase runs before its legacy loadSource target listener.
    if (!button) return false;
    if (button.dataset.hobunjiCleanRepositoryRigReload === '1') return true;
    button.dataset.hobunjiCleanRepositoryRigReload = '1';
    button.addEventListener('click', event => {
      const settings = currentRepositorySettings(); // Saved before reload so a changed ref/path survives the clean restart.
      try { localStorage.setItem(SOURCE_SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {}
      for (const key of RIG_DRAFT_KEYS) {
        try { localStorage.removeItem(key); } catch (_) {}
      }
      const marker = { requestedAt: new Date().toISOString(), settings, clearedKeys: [...RIG_DRAFT_KEYS] }; // Mobile diagnostic explaining exactly why the page reloaded.
      try { sessionStorage.setItem(RELOAD_MARKER_KEY, JSON.stringify(marker)); } catch (_) {}
      const status = document.getElementById('statusPill');
      if (status) {
        status.textContent = 'Reloading exact repository rig…';
        status.className = 'pill warn';
      }
      publishRepositoryDiagnostics({ cleanReloadRequested: true, requestedSettings: settings });
      event.preventDefault();
      event.stopImmediatePropagation();
      location.reload(); // Startup automatically calls loadSource(readSettings()), resolving the latest SHA with no stale rig/scale autosave left to override it.
    }, true);
    return true;
  }

  const loadSequentially = list => list.reduce((promise, src) => promise.then(() => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  })), Promise.resolve());

  publishRepositoryDiagnostics();
  if (!installCleanRepositoryReload() && AUTHOR_PATH_RE.test(location.pathname)) {
    let attempts = 0; // Bounded retry in case this bootstrap executes before the header button is attached.
    const timer = setInterval(() => {
      if (installCleanRepositoryReload() || ++attempts >= 200) clearInterval(timer);
    }, 50);
  }

  if (document.readyState === 'loading' && document.currentScript) {
    for (const src of urls) document.write(`<script src="${src}"><\/script>`);
  } else {
    loadSequentially(urls).catch(error => console.warn('[attachment-rig-bootstrap]', error));
  }
})();

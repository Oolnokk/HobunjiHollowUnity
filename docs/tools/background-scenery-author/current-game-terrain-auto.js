'use strict';

// Hotfix wrapper for the Boundary Terrain CURRENT GAME AUTO comparison.
// The implementation is kept byte-for-byte in the sibling impl file; this
// wrapper only neutralizes the old self-triggering status observer that could
// starve the page in an endless MutationObserver/microtask loop.
if (document.readyState === 'loading' && typeof document.write === 'function') {
  document.write('<script src="current-game-terrain-auto-impl.js?v=20260914freeze1"><\/script>');
} else {
  const script = document.createElement('script');
  script.src = 'current-game-terrain-auto-impl.js?v=20260914freeze1';
  script.onload = () => installSafeStatusObserver();
  document.head.appendChild(script);
}

function installSafeStatusObserver() {
  const status = document.getElementById('preview3dStatus');
  if (!status || typeof MutationObserver !== 'function') return;

  // Disconnect the observer installed by the implementation before it can
  // react to its own write repeatedly.
  try { status.__boundaryCurrentGameAutoObserver?.disconnect?.(); } catch (_) {}
  status.__boundaryCurrentGameAutoObserver = null;
  if (status.__boundaryCurrentGameAutoSafeObserver) return;

  let lastWritten = '';
  const append = () => {
    const api = window.BoundaryCurrentGameAuto;
    if (!api?.summary) return;
    const current = String(status.textContent || '').trim();
    if (!current || current === lastWritten) return;
    const base = current.replace(/\s*·\s*CURRENT AUTO rockified[^\n]*$/i, '').trim();
    if (!base) return;
    const next = `${base} · ${api.summary()}`;
    if (next === current) {
      lastWritten = current;
      return;
    }
    lastWritten = next;
    status.textContent = next;
  };

  const observer = new MutationObserver(append);
  observer.observe(status, { childList: true, subtree: true, characterData: true });
  status.__boundaryCurrentGameAutoSafeObserver = observer;
  status.__boundaryCurrentGameAutoRefresh = append;
  append();
  setTimeout(append, 0);
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', installSafeStatusObserver, { once: true });
} else {
  installSafeStatusObserver();
}

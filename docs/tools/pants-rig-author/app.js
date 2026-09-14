(() => {
'use strict';

const selfSrc = document.currentScript?.src || new URL('app.js', window.location.href).href; // Keeps direct and commit-pinned GitHack loads on the same repository revision.
const base = document.createElement('script'); // Loads the preserved original Pants Rig Author without duplicating its large implementation.
base.async = false;
base.src = new URL('app-base.js', selfSrc).href;
base.addEventListener('load', () => {
  const enhancements = document.createElement('script'); // Adds repository-backed pants_basic loading and unmistakable weight-paint feedback.
  enhancements.async = false;
  enhancements.src = new URL('enhancements.js', selfSrc).href;
  enhancements.addEventListener('load', () => {
    const hostBridge = document.createElement('script'); // Notifies the Procedural Animation host after completed authoring changes so its live 3D mesh can rebuild only when needed.
    hostBridge.async = false;
    hostBridge.src = new URL('host-bridge.js', selfSrc).href;
    hostBridge.addEventListener('error', () => console.error(`[Pants Rig Author] Failed to load ${hostBridge.src}`));
    document.head.appendChild(hostBridge);
  });
  enhancements.addEventListener('error', () => console.error(`[Pants Rig Author] Failed to load ${enhancements.src}`));
  document.head.appendChild(enhancements);
});
base.addEventListener('error', () => {
  console.error(`[Pants Rig Author] Failed to load ${base.src}`);
  const status = document.getElementById('status');
  if (status) {
    status.textContent = 'Pants Rig Author base script failed to load.';
    status.dataset.kind = 'warn';
  }
});
document.head.appendChild(base);
})();

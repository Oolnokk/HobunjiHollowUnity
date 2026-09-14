(() => {
'use strict';

const selfSrc = document.currentScript?.src || new URL('app.js', window.location.href).href; // Keeps direct and commit-pinned GitHack loads on the same repository revision.

function loadScript(filename, id = '') {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    if (id) script.id = id;
    script.async = false;
    script.src = new URL(filename, selfSrc).href;
    script.addEventListener('load', () => resolve(script), { once: true });
    script.addEventListener('error', () => reject(new Error(`Failed to load ${script.src}`)), { once: true });
    document.head.appendChild(script);
  });
}

async function start() {
  try {
    await loadScript('portrait-runtime-bootstrap.js', 'pantsRigPortraitRuntimeBootstrap'); // Populates the full species/gender registry before app-base's boot() reads getPortraitFighters().
    await window.PantsRigPortraitBootstrap?.ready;
  } catch (error) {
    console.error('[Pants Rig Author] Canonical portrait bootstrap failed; starting the editor with whatever portrait registry is available.', error);
  }

  await loadScript('app-base.js', 'pantsRigAuthorBase'); // Loads the preserved original Pants Rig Author only after portrait fighter discovery is complete.
  await loadScript('enhancements.js', 'pantsRigAuthorEnhancements'); // Adds repository-backed pants_basic loading and unmistakable weight-paint feedback.
  await loadScript('host-bridge.js', 'pantsRigAuthorHostBridge'); // Notifies the Procedural Animation host after completed authoring changes so its live 3D mesh can rebuild only when needed.
}

start().catch(error => {
  console.error('[Pants Rig Author] Startup loader failed.', error);
  const status = document.getElementById('status');
  if (status) {
    status.textContent = `Pants Rig Author failed to start: ${error?.message || error}`;
    status.dataset.kind = 'warn';
  }
});
})();

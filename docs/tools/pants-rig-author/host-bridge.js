(() => {
'use strict';

let revision = 0; // Monotonic authoring revision sent to the Procedural Animation host for debug/readability.
let notifyQueued = false; // Coalesces rapid slider/click events into one host rebuild request per animation frame.

function notifyHost(reason = 'edit') {
  if (window.parent === window || notifyQueued) return;
  notifyQueued = true;
  requestAnimationFrame(() => {
    notifyQueued = false;
    revision++;
    try {
      window.parent.postMessage({
        type: 'hobunji-pants-rig-changed',
        revision,
        reason,
        garmentId: window.__pantsRigAuthorDebug?.state?.()?.garmentId || null,
      }, window.location.origin);
    } catch (_) {}
  });
}

function waitForAuthor() {
  if (!window.__pantsRigAuthorDebug?.state?.()) {
    requestAnimationFrame(waitForAuthor);
    return;
  }
  const pointerFinish = event => {
    if (event.target?.closest?.('#pantsCanvas,#portraitCanvas')) notifyHost('pointer-edit');
  }; // Sends one rebuild request after a spline/bone/weight gesture finishes.
  document.addEventListener('pointerup', pointerFinish, true);
  document.addEventListener('pointercancel', pointerFinish, true);

  const changeIds = new Set([
    'fighter', 'garmentId', 'sourcePath', 'pantsFile', 'projectFile', 'legThickness',
    'weightChannel', 'autoWeights', 'smoothWeights', 'resetWeights', 'undo', 'redo',
    'resetCharacter', 'resetGarment',
  ]); // Controls whose completed changes affect the live 3D garment fit, mapping, or weights.
  document.addEventListener('change', event => {
    if (changeIds.has(event.target?.id)) notifyHost(`change:${event.target.id}`);
  }, true);
  document.addEventListener('click', event => {
    if (changeIds.has(event.target?.id)) notifyHost(`click:${event.target.id}`);
  }, true);
  document.getElementById('legThickness')?.addEventListener('input', () => notifyHost('leg-thickness'), true);

  window.__pantsRigAuthorDebug.notifyHostChanged = notifyHost; // Gives mobile diagnostics/manual recovery a direct bridge without DevTools-only private state.
  notifyHost('author-ready');
}

waitForAuthor();
})();

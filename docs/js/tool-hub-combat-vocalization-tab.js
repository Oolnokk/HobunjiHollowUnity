// Tool Hub extension: adds the Combat Vocalization Editor without expanding tools/index.html's monolithic tab list.
(() => {
  'use strict';
  const PATCH_ID = 'HobunjiCombatVocalizationToolHub';
  if (window[PATCH_ID]) return;

  function install() {
    const tabbar = document.getElementById('tabbar');
    const frames = document.getElementById('frames');
    if (!tabbar || !frames || document.querySelector('[data-target="combat-vocalization-editor"]')) return false;

    const tab = document.createElement('button'); // Added to the Combat group beside attack authoring tools.
    tab.className = 'tab';
    tab.dataset.target = 'combat-vocalization-editor';
    tab.innerHTML = '<span class="tab-dot"></span>🎙 Combat Vocalizations';

    const anchor = tabbar.querySelector('[data-target="attack-animation-editor"]');
    if (anchor) anchor.insertAdjacentElement('afterend', tab);
    else tabbar.appendChild(tab);

    const frame = document.createElement('div'); // Lazy iframe keeps audio decoding/tool UI out of ordinary Tool Hub startup.
    frame.className = 'frame-wrap';
    frame.id = 'fw-combat-vocalization-editor';
    frame.innerHTML = '<iframe src="combat-vocalization-editor/index.html" title="Combat Vocalization Editor" id="if-combat-vocalization-editor" loading="lazy"></iframe>';
    frames.appendChild(frame);

    // tools/index.html snapshots its original NodeLists before this extension
    // runs. Reconcile ALL current tabs/frames after any tab click so the new
    // dynamically-added pair participates in exactly the same selection model.
    tabbar.addEventListener('click', event => {
      const clicked = event.target.closest('.tab');
      if (!clicked) return;
      queueMicrotask(() => {
        const target = clicked.dataset.target;
        document.querySelectorAll('#tabbar .tab').forEach(node => node.classList.toggle('active', node === clicked));
        document.querySelectorAll('#frames .frame-wrap').forEach(node => node.classList.toggle('active', node.id === `fw-${target}`));
      });
    });

    return true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();

  window[PATCH_ID] = Object.freeze({
    version: 1,
    install,
    latestChange: 'Combat Vocalizations is a lazy Tool Hub tab with full-clip charge stretching, 2× normal-speed early-release catch-up, and global utterance modulation authoring.',
  });
})();

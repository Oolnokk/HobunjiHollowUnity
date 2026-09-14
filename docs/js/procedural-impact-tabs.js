// Procedural Animation Editor adapter loader.
(function () {
  'use strict';

  const selfSrc = document.currentScript?.src || new URL('procedural-impact-tabs.js', window.location.href).href; // Keeps commit-pinned previews on one immutable revision.
  const base = document.createElement('script'); // Preserves the existing Impact/Dance adapter verbatim while allowing Pants Rig to remain a small independent module.
  base.async = false;
  base.src = new URL('procedural-impact-tabs-base.js', selfSrc).href;
  base.addEventListener('load', () => {
    const pants = document.createElement('script'); // Adds Pants as a first-class workspace inside the same Procedural Animation editor HUD/scene.
    pants.async = false;
    pants.src = new URL('procedural-pants-rig-author.js', selfSrc).href;
    pants.addEventListener('error', () => console.error(`[Pants Rig] Failed to load ${pants.src}`));
    document.head.appendChild(pants);
  });
  base.addEventListener('error', () => console.error(`[Impact tabs] Failed to load preserved adapter ${base.src}`));
  document.head.appendChild(base);
})();

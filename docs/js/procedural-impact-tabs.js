// Procedural Animation Editor adapter loader.
(function () {
  'use strict';

  const selfSrc = document.currentScript?.src || new URL('procedural-impact-tabs.js', window.location.href).href; // Keeps commit-pinned previews on one immutable revision.
  const base = document.createElement('script'); // Preserves the existing Impact/Dance adapter verbatim while allowing Pants Rig to remain a small independent module.
  base.async = false;
  base.src = new URL('procedural-impact-tabs-base.js', selfSrc).href;
  base.addEventListener('load', () => {
    const pants = document.createElement('script'); // Makes Pants a first-class workspace inside this same Procedural Animation editor and its live avatar scene.
    pants.async = false;
    pants.src = new URL('procedural-pants-rig-author.js', selfSrc).href;
    pants.addEventListener('load', () => {
      const layoutFix = document.createElement('script'); // Forces the embedded author to consume all remaining panel height instead of the iframe's intrinsic viewport height.
      layoutFix.async = false;
      layoutFix.src = new URL('procedural-pants-rig-layout-fix.js', selfSrc).href;
      layoutFix.addEventListener('load', () => {
        const apply = document.createElement('script'); // Adds an explicit static beltline application path that works even before the procedural thigh/calf chain can be resolved.
        apply.async = false;
        apply.src = new URL('procedural-pants-rig-apply.js', selfSrc).href;
        apply.addEventListener('error', () => console.error(`[Pants Rig] Failed to load Apply-to-NPC action ${apply.src}`));
        document.head.appendChild(apply);
      });
      layoutFix.addEventListener('error', () => console.error(`[Pants Rig] Failed to load layout fix ${layoutFix.src}`));
      document.head.appendChild(layoutFix);
    });
    pants.addEventListener('error', () => console.error(`[Pants Rig] Failed to load ${pants.src}`));
    document.head.appendChild(pants);
  });
  base.addEventListener('error', () => console.error(`[Impact tabs] Failed to load preserved adapter ${base.src}`));
  document.head.appendChild(base);
})();

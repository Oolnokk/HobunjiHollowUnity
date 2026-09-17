// Compatibility bootstrap for the retired A/B shoulder-curl runtime.
// New authoring/runtime lives in animal-shoulder-spline.js (v8).
(() => {
  'use strict';

  function loadScript(src, marker) {
    if (document.readyState === 'loading') {
      if (!document.querySelector(`script[data-${marker}]`)) document.write(`<script data-${marker}="1" src="${src}"></` + 'script>');
      return;
    }
    if (document.querySelector(`script[data-${marker}]`)) return;
    const script = document.createElement('script');
    script.src = src; script.async = false;
    script.dataset[marker.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = '1';
    document.head.appendChild(script);
  }

  if (!window.AnimalShoulderSpline || Number(window.AnimalShoulderSpline.version) < 8) {
    loadScript('js/animal-shoulder-spline-profiles.js?v=20260917spline2', 'animal-shoulder-spline-profiles');
    loadScript('js/animal-shoulder-spline.js?v=20260917spline8', 'animal-shoulder-spline');
    loadScript('js/animal-shoulder-spline-layering.js?v=20260917parity2', 'animal-shoulder-spline-layering');
  }
  if (window.AnimalShoulderSpline) window.AnimalShoulderRest = window.AnimalShoulderSpline;
  window.AnimalShoulderRestV5 = { version: 8, compatibility: true };
})();

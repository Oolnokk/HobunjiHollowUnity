// Compatibility bootstrap for the retired v5 curl/falloff decorator.
// Kept only because older game bootstraps still request this URL.
(() => {
  'use strict';

  function loadScript(src, marker) {
    if (document.readyState === 'loading') {
      if (!document.querySelector(`script[data-${marker}]`)) document.write(`<script data-${marker}="1" src="${src}"></` + 'script>');
      return;
    }
    if (document.querySelector(`script[data-${marker}]`)) return;
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset[marker.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = '1';
    document.head.appendChild(script);
  }

  if (!window.AnimalShoulderSpline || Number(window.AnimalShoulderSpline.version) < 6) {
    loadScript('js/animal-shoulder-spline-profiles.js?v=20260917spline1', 'animal-shoulder-spline-profiles');
    loadScript('js/animal-shoulder-spline.js?v=20260917spline6', 'animal-shoulder-spline');
    loadScript('js/animal-shoulder-spline-layering.js?v=20260917parity1', 'animal-shoulder-spline-layering');
  }
  if (window.AnimalShoulderSpline) window.AnimalShoulderRest = window.AnimalShoulderSpline;
  window.AnimalShoulderRestV5 = { version: 6, compatibility: true };
})();

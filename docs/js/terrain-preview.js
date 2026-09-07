(() => {
  'use strict';

  if (typeof module === 'object' && module.exports) {
    module.exports = require('./terrain-preview-core.js');
    return;
  }

  const current = document.currentScript?.src || location.href;
  const base = new URL('.', current);
  document.write(`<script src="${new URL('terrain-preview-core.js', base).href}"><\/script>`);
  if (/\/tools\/map-editor(?:\/|\/index\.html)?$/.test(location.pathname)) {
    document.write(`<script src="${new URL('harugasirri-cull-range.js?v=20260907c', base).href}"><\/script>`);
    document.write(`<script src="${new URL('harugasirri-map-editor.js?v=20260907a', base).href}"><\/script>`);
    document.write(`<script src="${new URL('harugasirri-map-editor-capture-fix.js?v=20260907a', base).href}"><\/script>`);
  }
})();

(() => {
  'use strict';

  // Farm construction, troughs and the house bootstrap retain their parser order.
  const scriptUrls = [
    "js/farm-buildings.js?v=20261031furniturecontrols1",
    "js/farm-troughs.js?v=20261124bulkAudit3",
    "js/house-pieces.js?v=20261124traceClock4&surfaceUv=20261120renderproxy"
  ]; // Farm building scripts and their independent cache versions.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();

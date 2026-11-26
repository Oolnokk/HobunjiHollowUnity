(() => {
  'use strict';
  // Combat configuration bootstrap: load after bandits/bounty and before shared buff/skill systems.
  const scriptUrls = [
    'js/combat/combat-config-loader.js?v=20261126shoulderRebase8'
  ]; // Independently versioned child; subsequent feature patches never modify index.html.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();

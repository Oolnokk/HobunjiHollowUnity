(() => {
  'use strict';
  // guild: classic scripts in their original parser execution order. Add modules here, not in index.html.
  const scriptUrls = [
    "js/delvers-guild-story.js?v=20261112keyPack2",
    "js/town-magic-checkpoint.js?v=20261103magicCustody6",
    "js/delvers-vault-signal.js?v=20261031storyVault1"
]; // Versioned game modules owned by this group.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  // A single write guarantees blocking, ordered execution before the next source index.html tag.
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();

(() => {
  'use strict';
  // Event-time spouse advice and kinship dialogue load after DialogueContent/FestivalDialogue, before RomanceSystem.
  const scriptUrls = [
    'js/spouse-social-life.js?v=20261115spouseSocialLife1'
  ]; // Keep the spouse-context feature cache token out of the shared index.html.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();

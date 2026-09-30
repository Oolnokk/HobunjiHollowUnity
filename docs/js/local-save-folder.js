// Compatibility loader: persistence core + default save/load UX flow.
// Kept at the historical path so existing pages do not need to change script order.
document.write('<style>#localSaveStartupGate{font-family:"KhymeryyanRomanLetters+Numbers","DM Mono",ui-monospace,monospace!important}</style>');
document.write('<link rel="stylesheet" href="folder-save-primary.css?v=20260914a">');
document.write('<script src="js/session-persistence-startup-guard.js?v=20260930h682e011"><\/script>');
document.write('<script src="js/save-snapshot-core.js?v=20260904a"><\/script>');
document.write('<script src="js/autosave-pause.js?v=20260930companion1"><\/script>'); // Dev Companion autosave pause; checked by the folder core + checkpoint manager below.
document.write('<script src="js/quick-save.js?v=20260930companion1"><\/script>'); // Dev Companion quick save/load; its pending load is applied by FolderSavePrimary at boot.
document.write('<script src="js/local-save-folder-core.js?v=20260930h0049415"><\/script>');
document.write('<script src="js/folder-save-primary.js?v=20260930hf3fb70d"><\/script>');
document.write('<script src="js/folder-save-empty-bootstrap.js?v=20260914a"><\/script>');
document.write('<script src="js/folder-save-device-provenance.js?v=20260914a"><\/script>');
document.write('<script src="js/folder-save-runtime-flush.js?v=20260914a"><\/script>');
document.write('<script src="js/save-checkpoint-manager.js?v=20260930hdf61cd8"><\/script>');
document.write('<script src="js/folder-save-quit-guard.js?v=20260916menu3"><\/script>');
document.write('<script src="js/folder-save-debug-ui.js?v=20260925savecorrupt5"><\/script>');
document.write('<script src="js/netlify-cloud-save.js?v=20260920startup4"><\/script>');
document.write('<script src="js/local-save-flow.js?v=20260812a"><\/script>');
document.write('<script src="js/save-startup-gate.js?v=20260926metalarmor1"><\/script>');

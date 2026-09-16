// Compatibility loader: persistence core + default save/load UX flow.
// Kept at the historical path so existing pages do not need to change script order.
document.write('<style>#localSaveStartupGate{font-family:"KhymeryyanRomanLetters+Numbers","DM Mono",ui-monospace,monospace!important}</style>');
document.write('<link rel="stylesheet" href="folder-save-primary.css?v=20260914a">');
document.write('<script src="js/session-persistence-startup-guard.js?v=20260913a"><\/script>');
document.write('<script src="js/save-snapshot-core.js?v=20260904a"><\/script>');
document.write('<script src="js/local-save-folder-core.js?v=20260915b"><\/script>');
document.write('<script src="js/folder-save-primary.js?v=20260914a"><\/script>');
document.write('<script src="js/folder-save-empty-bootstrap.js?v=20260914a"><\/script>');
document.write('<script src="js/folder-save-device-provenance.js?v=20260914a"><\/script>');
document.write('<script src="js/folder-save-runtime-flush.js?v=20260914a"><\/script>');
document.write('<script src="js/save-checkpoint-manager.js?v=20260915d"><\/script>');
document.write('<script src="js/folder-save-quit-guard.js?v=20260914a"><\/script>');
document.write('<script src="js/folder-save-debug-ui.js?v=20260915a"><\/script>');
document.write('<script src="js/netlify-cloud-save.js?v=20260904a"><\/script>');
document.write('<script src="js/local-save-flow.js?v=20260812a"><\/script>');
document.write('<script src="js/save-startup-gate.js?v=20260910review1"><\/script>');

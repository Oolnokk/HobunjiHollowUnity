// Compatibility loader: persistence core + default save/load UX flow.
// Kept at the historical path so existing pages do not need to change script order.
document.write('<style>#localSaveStartupGate{font-family:"KhymeryyanRomanLetters+Numbers","DM Mono",ui-monospace,monospace!important}</style>');
document.write('<script src="js/session-persistence-startup-guard.js?v=20260913a"><\/script>');
document.write('<script src="js/save-snapshot-core.js?v=20260904a"><\/script>');
document.write('<script src="js/local-save-folder-core.js?v=20260812a"><\/script>');
document.write('<script src="js/google-drive-cloud-save-config.js?v=20260914a"><\/script>');
document.write('<script src="js/google-drive-cloud-save.js?v=20260914a"><\/script>');
document.write('<script src="js/google-drive-cloud-save-conflict-guard.js?v=20260914a"><\/script>');
document.write('<script src="js/local-save-flow.js?v=20260812a"><\/script>');
document.write('<script src="js/save-startup-gate.js?v=20260910review1"><\/script>');
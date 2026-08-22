// Compatibility loader: persistence core + default save/load UX flow.
// Kept at the historical path so existing pages do not need to change script order.
document.write('<style>#localSaveStartupGate{font-family:"KhymeryyanRomanLetters+Numbers","DM Mono",ui-monospace,monospace!important}</style>');
document.write('<script src="js/local-save-folder-core.js?v=20260812a"><\/script>');
document.write('<script src="js/local-save-flow.js?v=20260812a"><\/script>');
// Puzzle runtime loads before game.js so generated interior JSON can register causal machines as maps are fetched.
document.write('<script src="js/hobunji-puzzle-runtime.js?v=20260821a"><\/script>');

from pathlib import Path

studio_path = Path('docs/tools/character-studio/index.html')
studio = studio_path.read_text()
anchor = '<script src="../../js/local-db-overrides.js"></script>\n<script src="../../config/scratchbones-config.js?v=20261002h12b6f76"></script>'
replacement = '<script src="../../js/local-db-overrides.js"></script>\n<script src="../../js/character-studio-mammakhbuur-config.js?v=20261005restore1"></script>\n<script src="../../config/scratchbones-config.js?v=20261002h12b6f76"></script>'
if replacement not in studio:
    if anchor not in studio:
        raise SystemExit('Character Studio scratchbones-config anchor changed')
    studio = studio.replace(anchor, replacement, 1)
studio_path.write_text(studio)

# Add regression coverage directly to the existing Character Studio integration test.
test_path = Path('scripts/test-character-studio-pattern-integration.js')
test = test_path.read_text()
needle = "const portrait = read('docs/js/portrait-utils.js');\n"
addition = "const mammakhConfig = read('docs/js/character-studio-mammakhbuur-config.js');\n"
if addition not in test:
    if needle not in test:
        raise SystemExit('Character Studio test declaration anchor changed')
    test = test.replace(needle, needle + addition, 1)
assertions = "assert.match(studio, /character-studio-mammakhbuur-config\\.js[^>]*><\\/script>\\s*<script src=\\\"\\.\\.\\/\\.\\.\\/config\\/scratchbones-config\\.js/, 'Mammakhbuur registration loads before scratchbones config');\nassert.match(mammakhConfig, /appearance\\.species\\[ID\\] =/, 'Mammakhbuur is inserted into Character Studio species data');\nassert.match(mammakhConfig, /slot\\?\\.slot !== 'hairFront'/, 'Mammakhbuur still removes front-hair choices');\n"
marker = "assert.match(studio, /character-studio-pattern-integration\\.js/, 'Character Studio loads pattern integration');\n"
if assertions not in test:
    if marker not in test:
        raise SystemExit('Character Studio assertion anchor changed')
    test = test.replace(marker, marker + assertions, 1)
test_path.write_text(test)

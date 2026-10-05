from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly 1 occurrence, found {count}')
    return text.replace(old, new, 1)


# Cache-bust ownership deliberately changes tokens whenever the module changes;
# this regression should assert that the bridge is loaded, not freeze one token.
grid_test_path = Path('scripts/test-interior-furniture-grid.js')
grid_test = grid_test_path.read_text(encoding='utf-8')
grid_test = replace_once(
    grid_test,
    "assert.match(indexSource, /js\\/interior-furniture-grid\\.js\\?v=20260917grid1/, 'game loads the furniture-grid runtime bridge');",
    "assert.match(indexSource, /js\\/interior-furniture-grid\\.js\\?v=[^\"']+/, 'game loads the furniture-grid runtime bridge');",
    'index furniture-grid cache-token assertion',
)
grid_test = replace_once(
    grid_test,
    "assert.match(mapEditorSource, /js\\/interior-furniture-grid\\.js\\?v=20260917grid1/, 'main Map Editor loads the shared furniture-grid helper');",
    "assert.match(mapEditorSource, /js\\/interior-furniture-grid\\.js\\?v=[^\"']+/, 'main Map Editor loads the shared furniture-grid helper');",
    'map-editor furniture-grid cache-token assertion',
)
grid_test_path.write_text(grid_test, encoding='utf-8')

# This isolated VM intentionally tests ordinary saved-pattern reweaving, not
# Advanced Loom capability. Supply the new dependencies with simple/legacy-safe
# implementations so the extracted production openLoom closure can initialize.
review_test_path = Path('scripts/test-review-runtime-regressions.js')
review_test = review_test_path.read_text(encoding='utf-8')
review_test = replace_once(
    review_test,
    "      weavingHasAnyPattern: weaving => !!weaving?.layers, weavingHasOptionalTrim: weaving => !!weaving?.trim?.enabled, summarizeWeavingLabel: () => 'Saved',",
    "      weavingHasAnyPattern: weaving => !!weaving?.layers, weavingHasOverpass: () => false, weavingHasOptionalTrim: weaving => !!weaving?.trim?.enabled, summarizeWeavingLabel: () => 'Saved',\n      normalizePatternStack: value => (Array.isArray(value) ? value : (Array.isArray(value?.patterns) ? value.patterns : [value])).filter(pattern => !!pattern && typeof pattern === 'object').slice(0, 2), // Mirrors production's save-compatible pattern-stack normalizer for this isolated loom closure.",
    'isolated loom overpass/stack dependencies',
)
review_test = replace_once(
    review_test,
    "    if (!failLoad) assert.deepEqual(JSON.parse(JSON.stringify(submittedWeave)), savedWeave, 'saved pattern survives initialized submission');",
    "    if (!failLoad) assert.deepEqual(JSON.parse(JSON.stringify(submittedWeave)), { layers: { base: { pattern: { motifDataUrl: 'authored.png' }, patterns: [{ motifDataUrl: 'authored.png' }], patternLabel: 'Saved' } } }, 'legacy saved pattern survives initialized submission and is normalized to the stack-capable shape');",
    'canonical submitted weaving pattern stack',
)
review_test_path.write_text(review_test, encoding='utf-8')

# Remove one-shot automation from the finished feature branch.
Path('scripts/tmp-final-regression-fixes.py').unlink(missing_ok=True)
Path('.github/workflows/tmp-final-regression-fixes.yml').unlink(missing_ok=True)

const assert = require('node:assert/strict');
const fs = require('node:fs');

const entry = fs.readFileSync('docs/onboarding.js', 'utf8');
const fit = fs.readFileSync('docs/js/onboarding-viewport-fit.js', 'utf8');

assert.match(entry, /onboarding-viewport-fit\.js\?v=20260913viewportfit1/, 'onboarding must load the viewport-fit guard');
assert.match(entry, /coreUrl[\s\S]{0,500}viewportFitUrl[\s\S]{0,500}mashtzarrFemaleUrl/, 'viewport fit must load immediately after the onboarding core');
assert.match(fit, /#ob-overlay>\.ob-card\{box-sizing:border-box;min-height:0;max-width:100%\}/, 'onboarding cards must include padding inside their viewport width');
assert.match(fit, /max-height:calc\(100dvh - 32px\)/, 'desktop creator height must be capped to the dynamic viewport');
assert.match(fit, /max-height:calc\(100dvh - 16px\)/, 'mobile creator height must be capped to the dynamic viewport');
assert.match(fit, />\.ob-two-col\{flex:1 1 auto;min-height:0;overflow:hidden\}/, 'creator body must consume only the remaining card height');
assert.match(fit, /@media \(max-width:560px\)[\s\S]*?>\.ob-two-col\{overflow-x:hidden;overflow-y:auto/, 'mobile creator body must become the scroll container');
assert.match(fit, /@media \(max-height:640px\) and \(min-width:561px\)[\s\S]*?>\.ob-two-col\{overflow-y:auto/, 'short desktop viewports must also scroll the creator body');
assert.match(fit, /visualViewport/, 'fit diagnostics must use the visible viewport when available');
assert.match(fit, /ResizeObserver/, 'fit diagnostics must recheck after creator size changes');
assert.match(fit, /Creator viewport-fit warning/, 'overflow must surface an on-screen diagnostic without DevTools');

console.log('onboarding viewport-fit source checks passed');

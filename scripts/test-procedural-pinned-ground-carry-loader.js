const fs = require('fs');

const wrapper = fs.readFileSync('docs/js/procedural-impact-tabs.js', 'utf8');
const bridge = fs.readFileSync('docs/js/procedural-ground-rest-input-bridge.js', 'utf8');
const legBones = fs.readFileSync('docs/js/leg-bones.js', 'utf8');

const checks = [
  ['canonical editor source storage key', wrapper.includes('hobunjiNpcPlaneAvatarRepoViewer.source.v1')],
  ['raw githack pin parsing', wrapper.includes('raw.githack.com')],
  ['raw github pin parsing', wrapper.includes('raw.githubusercontent.com')],
  ['40-char revision guard', wrapper.includes('{40}')],
  ['pin diagnostic state', wrapper.includes('__HOBUNJI_PINNED_EDITOR_SOURCE__')],
  ['writes source settings before boot', wrapper.indexOf('forcePinnedSourceSettings();') < wrapper.indexOf('async function boot()')],
  ['reloads once after stale source correction', wrapper.includes('window.location.reload()') && wrapper.includes("pinAction === 'reload'")],
  ['per-commit reload guard', wrapper.includes('hobunji.proceduralAnimationEditor.pinReload.')],
  ['core loads first', wrapper.indexOf("src('procedural-impact-tabs-core.js')") < wrapper.indexOf("src('procedural-limb-pose-author.js')")],
  ['waits for PNGPlaneAvatar host', wrapper.includes('waitForEditorThreeHost') && wrapper.includes('PNGPlaneAvatar Three.js host')],
  ['preloads canonical Three modules', wrapper.includes('await window.PNGPlaneAvatar.loadThreeModules()')],
  ['Ground loads only after Three host wait', wrapper.indexOf('const threeHostReady = await waitForEditorThreeHost();') < wrapper.indexOf("src('procedural-limb-pose-author.js')")],
  ['ready state requires Three host', wrapper.includes('threeHostReady && groundLoaded && groundInputLoaded')],
  ['input bridge is loaded', wrapper.includes("src('procedural-ground-rest-input-bridge.js')")],
  ['dedicated visible diagnostics', wrapper.includes('HobunjiProceduralGroundCarryDiagnostics')],
  ['bridge emits dedicated diagnostics', bridge.includes('HobunjiProceduralGroundCarryDiagnostics')],
  ['leg runtime has editor-path fallback bootstrap', legBones.includes('bootstrapProceduralGroundCarryAdapter') && legBones.includes('/tools\\/procedural-animation-editor')],
  ['fallback loads sibling adapter from same revision', legBones.includes("new URL('procedural-impact-tabs.js?v=20260905groundcarry1', selfSrc)")],
  ['fallback is duplicate guarded', legBones.includes('proceduralGroundCarryAdapterScript') && legBones.includes('HobunjiProceduralGroundCarryDiagnostics')],
];

const failures = checks.filter(([, pass]) => !pass).map(([name]) => name);
if (failures.length) {
  console.error(`procedural pinned ground/carry loader: FAIL\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('procedural pinned ground/carry loader: PASS');

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const game = fs.readFileSync('docs/game.js', 'utf8');
const index = fs.readFileSync('docs/index.html', 'utf8');
const styles = fs.readFileSync('docs/style.css', 'utf8');
const cookingStyles = fs.readFileSync('docs/cooking-ui.css', 'utf8');
const author = fs.readFileSync('docs/tools/animation-author/index.html', 'utf8');
const probe = fs.readFileSync('docs/js/pixel-probe.js', 'utf8');

assert(index.includes('id="btnUnequipHeld"'), 'mobile put-away button is missing');
assert(game.includes("if (key === 'z')"), 'Z put-away shortcut is missing');
assert(game.includes("heldMode = 'none'"), 'hands-free held mode is missing');
assert(game.includes("heldMode !== 'tool' || activeTool !== 'weapon'"), 'hands-free mode can still route weapon input');
assert(game.includes("actionId === 'action2' && heldMode === 'tool' && activeTool === 'ranged'"), 'hands-free mode can still route ranged ammo input');

const outerArchOrder = ['btnUnequipHeld', 'btnWeaponSwitch', 'toolBtn', 'itemBtn', 'btnCallMount']
  .map((id) => index.indexOf(`id="${id}"`));
assert(outerArchOrder.every((position, i) => position >= 0 && (i === 0 || position > outerArchOrder[i - 1])), 'outer arch DOM order is not put-away, weapon, tool, item, mount');
assert(index.indexOf('cooking-ui.css') > index.indexOf('style.css'), 'post-base HUD overrides must load after style.css');

const expectedAngles = {
  btnUnequipHeld: '180deg',
  btnWeaponSwitch: '165deg',
  toolBtn: '150deg',
  itemBtn: '135deg',
  btnCallMount: '120deg',
};
const outerArchStyles = `${styles}\n${cookingStyles}`;
for (const [id, angle] of Object.entries(expectedAngles)) {
  const rules = [...outerArchStyles.matchAll(new RegExp(`#${id}\\s*\\{[\\s\\S]*?\\}`, 'g'))].map((match) => match[0]);
  assert(rules.some((rule) => rule.includes(`cos(${angle})`)), `${id} is not at ${angle} on the compact outer arch`);
}

for (const label of ['portrait', 'ground', 'posterior', 'left hand shoulder', 'right hand shoulder', 'shoulder perch']) {
  assert(author.includes(`'${label}'`), `rigger dump omits ${label}`);
  assert(probe.includes(`'${label}'`), `runtime dump omits ${label}`);
}
assert(index.includes('id="debugRigTransformDumpBtn"'), 'runtime Debug dump button is missing');
assert(author.includes("existingFixedProfile?.shoulderPerchRule?.authoredFixed === true"), 'legacy all-species arm scan can still replace fixed authored shoulder perches');
assert(author.includes('preserved ${preservedFixed} fixed authored profiles'), 'mobile log does not report preserved fixed rig profiles');
assert(author.includes("document.title = 'Hobunji Animation Author V15.41'"), 'rigger title does not identify the fixed-profile parity build');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/transform-dump-utils.js', 'utf8'), context);
const report = context.window.HobunjiTransformDump.formatNamedTransformReport([{
  label: 'portrait',
  source: 'test',
  localPosition: { x: 1, y: 2, z: 3 },
  localRotationDeg: { pitch: 4, yaw: 5, roll: 6 },
  localScale: { x: 1, y: 1, z: 1 },
  worldPosition: { x: 7, y: 8, z: 9 },
  worldRotationDeg: { pitch: 10, yaw: 11, roll: 12 },
  worldScale: { x: 2, y: 2, z: 2 },
}], { title: 'Parity', actor: 'Tester' });
assert(report.includes('local position=(1.0000, 2.0000, 3.0000)'), 'local transform formatting changed');
assert(report.includes('world position=(7.0000, 8.0000, 9.0000)'), 'world transform formatting changed');
assert(report.includes('scale=(2.0000, 2.0000, 2.0000)'), 'composed scale is missing');

console.log('rig transform dump and unequip controls: PASS');

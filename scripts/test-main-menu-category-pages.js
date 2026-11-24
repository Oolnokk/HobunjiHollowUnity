'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const listeners = new Map(); // Native focus/keyboard events exercise the shipped navigator, without a browser dependency.
const observers = []; // Delivers mutations only to observers registered for their target and type.
let pageClassWrites = 0; // Counts page presentation writes, not ordinary focus classes.
let document; // Assigned after constructing the fake body/panels used by focus().
class Element {
  constructor(tag = 'div', attrs = {}, children = [], x = 0, y = 0) {
    this.tagName = tag.toUpperCase(); this.nodeType = 1; this.attrs = { ...attrs };
    this.children = []; this.parentElement = null; this.disabled = false; this.hidden = false;
    this.style = {}; this.tabIndex = tag === 'button' ? 0 : -1; this.clicks = 0; this.events = new Map();
    this.x = x; this.y = y; this.textContent = attrs.id || tag;
    this.classes = new Set((attrs.class || '').split(' ').filter(Boolean));
    this.classList = { contains: value => this.classes.has(value), add: value => { if (value.startsWith('ctrl-nav-subtab')) pageClassWrites++; this.classes.add(value); }, remove: value => { if (value.startsWith('ctrl-nav-subtab')) pageClassWrites++; this.classes.delete(value); }, toggle: (value, enabled) => enabled ? this.classes.add(value) : this.classes.delete(value) };
    children.forEach(child => this.append(child));
  }
  get id() { return this.attrs.id || ''; }
  set id(value) { this.attrs.id = value; }
  get className() { return [...this.classes].join(' '); }
  set className(value) { this.classes = new Set(value.split(' ').filter(Boolean)); }
  get isConnected() { return this === body || Boolean(this.parentElement?.isConnected); }
  hasAttribute(name) { return name === 'tabindex' ? this.tabIndex >= 0 || name in this.attrs : name in this.attrs; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  append(child) { child.parentElement = this; this.children.push(child); }
  appendChild(child) { this.append(child); return child; }
  insertBefore(child, before) {
    if (child.parentElement) child.remove();
    const index = this.children.indexOf(before);
    child.parentElement = this;
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    return child;
  }
  remove() {
    const parent = this.parentElement;
    if (parent) parent.children.splice(parent.children.indexOf(this), 1);
    this.parentElement = null;
  }
  replaceChildren(...children) { this.children.slice().forEach(child => child.remove()); children.forEach(child => this.append(child)); }
  get lastElementChild() { return this.children.at(-1) || null; }
  contains(other) { return other === this || this.children.some(child => child.contains(other)); }
  matches(selector) {
    return selector.split(',').some(raw => {
      const part = raw.trim(); // Only the DOM selector boundary is mocked; all navigation logic is production code.
      if (part.includes(' ')) {
        const tokens = part.split(/\s+/);
        return this.matches(tokens.pop()) && !!this.parentElement?.closest(tokens.join(' '));
      }
      const tag = part.match(/^[a-z]+/i)?.[0];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      for (const [, name] of part.matchAll(/\.([\w-]+)/g)) if (!this.classes.has(name)) return false;
      const id = part.match(/#([\w-]+)/)?.[1];
      if (id && this.id !== id) return false;
      for (const [, name, value] of part.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)) {
        if (!this.hasAttribute(name) || (value !== undefined && this.getAttribute(name) !== value)) return false;
      }
      return true;
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getBoundingClientRect() { return { left: this.x, top: this.y, width: 80, height: 24 }; }
  focus() { document.activeElement = this; for (const callback of listeners.get('focusin') || []) callback({ target: this }); }
  blur() { document.activeElement = body; }
  scrollIntoView() { this.scrollCalls = (this.scrollCalls || 0) + 1; }
  click() { this.clicks++; this.onclick?.(); for (const callback of this.events.get('click') || []) callback(); }
  addEventListener(type, callback) { this.events.set(type, [...(this.events.get(type) || []), callback]); }
}

const button = (id, x = 10, y = 40) => new Element('button', { id }, [], x, y); // Native control inside an authored page.
const section = (id, label, children, cls = 'farm-section') => new Element('div', { id, 'aria-label': label, class: cls }, children, 10, 30); // Same boundaries as the shipped menu.
const layout = section('farmSectionLayout', 'Layout', [button('layout-action')]);
const bag = section('bag', 'Bag', [button('bag-action')], 'farm-storage-col');
const storageBox = section('storage-box', 'Storage Box', [button('storage-action')], 'farm-storage-col');
const storage = section('farmSectionStorage', 'Storage', [bag, storageBox]);
const adults = section('livestockNurseryAdults', 'Adult Livestock', [button('adult-action')], '');
adults.setAttribute('data-ctrl-subtab', '');
const nurseryToggle = new Element('button', { id: 'nursery-toggle', 'data-ctrl-group-open': '', 'aria-expanded': 'false' }); // Emulates an authored collapsible roster.
nurseryToggle.onclick = () => nurseryToggle.setAttribute('aria-expanded', String(nurseryToggle.getAttribute('aria-expanded') === 'false'));
const nursery = section('livestockNurserySection', 'Nursery Babies', [nurseryToggle, button('nursery-action')], '');
nursery.setAttribute('data-ctrl-subtab', '');
const roster = new Element('div', { id: 'farmLivestockList', 'data-ctrl-group': '' }, [nursery, adults]);
const livestock = section('farmSectionLivestock', 'Livestock', [button('pair-action'), roster]);
const farm = new Element('div', { id: 'mpFarm', class: 'mp-pane active', 'data-ctrl-initial-subtab': 'farmSectionLayout' }, [layout, storage, livestock]);
const questLog = section('tasksSectionQuestLog', 'Quest Log', [button('quest-action')], 'menu-section');
const rumors = section('tasksSectionRumors', 'Rumors', [button('rumor-action')], 'menu-section');
const tasks = new Element('div', { id: 'mpTasks', class: 'mp-pane' }, [questLog, rumors]);
tasks.style.display = 'none';
const inventoryGrid = section('invGridArea', 'Pack', [button('pack-item')], 'inv-grid-area');
const keyItems = section('invKeySection', 'Key Items', [button('key-item')], 'inv-key-section');
const equipment = section('invEquipSection', 'Equipment', [button('equipment-item')], 'inv-equip-section');
equipment.style.display = 'none';
const inventory = new Element('div', { id: 'mpInventory', class: 'mp-pane inv-mode-pack' }, [inventoryGrid, keyItems, equipment]);
inventory.style.display = 'none';
const menuBody = new Element('div', { class: 'mp-body' }, [farm, tasks, inventory]);
const menu = new Element('div', { id: 'menuPanel', 'data-ctrl-panel': '' }, [menuBody]);
menu.hidden = true;
const body = new Element('body', {}, [menu]); // No pad connection or other panel is necessary.
document = { body, activeElement: body, createElement: tag => new Element(tag),
  addEventListener(type, callback) { listeners.set(type, [...(listeners.get(type) || []), callback]); },
  getElementById(id) { return body.querySelector('#' + id); },
  dispatchEvent(event) { for (const callback of listeners.get(event.type) || []) callback(event); return true; }
};
const context = {
  document, console, getComputedStyle: el => ({ display: el.hidden ? 'none' : el.style.display || 'block', visibility: 'visible', opacity: '1', overflowY: el.style.overflowY || 'visible' }),
  window: { innerWidth: 600, innerHeight: 400, addEventListener(type, callback) { listeners.set(type, [...(listeners.get(type) || []), callback]); }, dispatchEvent() {},
    ControllerInput: { PRIORITY: { menuNav: 10 }, subscribe() {} } },
  MutationObserver: class {
    constructor(callback) { this.callback = callback; this.registrations = new Map(); observers.push(this); }
    observe(target, options) { this.registrations.set(target, options); }
    notify(record) {
      if ([...this.registrations].some(([target, options]) => (target === record.target || (options.subtree && target.contains(record.target))) && (record.type === 'attributes' ? options.attributes && (!options.attributeFilter || options.attributeFilter.includes(record.attributeName)) : options.childList))) this.callback([record]);
    }
  },
  queueMicrotask, setTimeout: () => 1, clearTimeout() {}, KeyboardEvent: class {
    constructor(type, options = {}) { this.type = type; Object.assign(this, options); }
    preventDefault() {} stopPropagation() {}
  },
  CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
};
vm.runInNewContext(fs.readFileSync('docs/js/controller-menu-dismissal.js', 'utf8'), context);
vm.runInNewContext(fs.readFileSync('docs/js/controller-ui-nav.js', 'utf8'), context);
const ui = context.window.ControllerUI; // Production controller and page selection authority.
const flush = async (target, extras = {}) => {
  const record = { type: 'childList', target, addedNodes: [], removedNodes: [], ...extras }; // Match real MutationRecord routing instead of invoking unrelated attribute observers.
  for (const observer of observers) observer.notify(record);
  await Promise.resolve();
  await Promise.resolve();
}; // Reconcile through the production observers, including class-driven major tab changes.
const bar = () => menu.querySelector('.mp-category-bar');
const choices = row => [...bar().children[row].children];
const hidden = node => node.classList.contains('ctrl-nav-subtab-hidden');
const click = (row, label) => {
  const item = choices(row).find(control => control.textContent === label);
  assert.ok(item, 'category exists: ' + label);
  item.click();
};
function key(name, mods = {}) {
  let consumed = false;
  for (const handler of listeners.get('keydown') || []) handler({ key: name, ...mods, preventDefault() { consumed = true; }, stopPropagation() {} });
  return consumed;
}
async function switchPane(from, to) {
  const oldValue = from.className;
  from.classList.remove('active'); from.style.display = 'none';
  to.classList.add('active'); to.style.display = '';
  await flush(from, { type: 'attributes', attributeName: 'class', oldValue });
}
async function main() {
  menu.hidden = false; await flush(menu, { type: 'attributes', attributeName: 'hidden' });
  assert.ok(bar() && !bar().hidden, 'category bar is present without a connected controller');
  assert.equal(menu.children.indexOf(bar()), menu.children.indexOf(menuBody) - 1, 'category bar reserves space above the pane body');
  assert.equal(choices(0).map(control => control.textContent).join('|'), 'Layout|Livestock|Storage', 'authored priority is shared across inputs');
  assert.ok(hidden(storage) && hidden(livestock) && !hidden(layout), 'initial menu is a real page, not stacked sections');
  click(0, 'Storage');
  assert.ok(hidden(layout) && !hidden(storage) && hidden(storageBox), 'selecting a parent shows its nested page');
  assert.equal(bar().children.length, 2);
  click(1, 'Storage Box');
  assert.ok(hidden(bag) && !hidden(storageBox), 'nested pointer choice selects exactly one page');
  click(0, 'Storage');
  assert.ok(hidden(bag) && !hidden(storageBox), 'reselecting the active parent preserves its nested page');
  for (const handler of listeners.get('pointerdown') || []) handler({ target: storageBox.children[0] });
  assert.ok(hidden(bag) && hidden(layout), 'ordinary pointer input does not undo page presentation');
  assert.equal(key('F6'), true, 'keyboard can focus the category bar without a gamepad');
  assert.equal(document.activeElement.textContent, 'Storage');
  assert.equal(key('F6'), true);
  assert.equal(document.activeElement.textContent, 'Storage Box', 'F6 advances to the nested row');
  const ordinary = button('ordinary-update'); storageBox.append(ordinary);
  const writesBefore = pageClassWrites;
  await flush(storageBox, { addedNodes: [ordinary] });
  assert.equal(pageClassWrites, writesBefore, 'ordinary row insertion does not reapply page visibility');
  assert.equal(document.activeElement.textContent, 'Storage Box', 'ordinary mutations do not steal keyboard category focus');
  assert.equal(key('F6'), true);
  assert.ok(!bar().contains(document.activeElement), 'F6 exits the category bar into content');
  assert.equal(key('F6'), true);
  assert.equal(key('ArrowLeft'), true);
  assert.equal(document.activeElement.textContent, 'Livestock');
  assert.ok(hidden(storage) && !hidden(livestock));
  assert.equal(choices(1).map(control => control.textContent).join('|'), 'Nursery Babies|Adult Livestock', 'nested roster categories are exposed through the structural Farm group');
  assert.ok(hidden(nursery) && !hidden(adults), 'livestock starts on the normal adult page');
  assert.equal(nurseryToggle.clicks, 0, 'passive page discovery does not open a disclosure');
  click(1, 'Nursery Babies');
  assert.ok(hidden(adults) && !hidden(nursery));
  assert.equal(nurseryToggle.clicks, 1, 'deliberately selecting a collapsed page opens its disclosure');
  nurseryToggle.click();
  const newNurseryAction = button('baby-new'); nursery.append(newNurseryAction);
  await flush(nursery, { addedNodes: [newNurseryAction] });
  assert.equal(nurseryToggle.getAttribute('aria-expanded'), 'false', 'passive refresh does not reopen a deliberately collapsed page');
  ui.press('tabNext');
  assert.ok(!hidden(adults) && hidden(nursery), 'controller bumpers share pointer-selected nested page state');
  ui.press('cancel');
  assert.ok(hidden(nursery) && hidden(storage), 'controller Back releases focus without re-expanding pages');
  ui.press('cancel');
  assert.ok(hidden(storage) && hidden(layout), 'Back to main tabs still retains the selected page');
  await switchPane(farm, tasks);
  assert.equal(bar().children.length, 1);
  assert.ok(!hidden(questLog) && hidden(rumors), 'another major tab gets its own pages');
  click(0, 'Rumors');
  const replacement = section('tasksSectionRumors', 'Rumors', [button('rumor-new')], 'menu-section');
  rumors.remove(); tasks.append(replacement);
  await flush(tasks, { addedNodes: [replacement], removedNodes: [rumors] });
  assert.ok(hidden(questLog) && !hidden(replacement), 'replaced page keeps the selected ID');
  questLog.hidden = true;
  await flush(questLog, { type: 'attributes', attributeName: 'hidden' });
  assert.ok(bar().hidden && !hidden(replacement), 'permission-hidden categories disappear without a DOM rebuild');
  questLog.hidden = false;
  await flush(questLog, { type: 'attributes', attributeName: 'hidden' });
  assert.ok(!bar().hidden && hidden(questLog), 'permission restoration remembers the surviving selected page');
  await switchPane(tasks, inventory);
  assert.ok(!hidden(inventoryGrid) && hidden(keyItems), 'Pack pages appear on their actual pane');
  click(0, 'Key Items');
  const oldMode = inventory.className;
  inventory.classList.remove('inv-mode-pack'); inventory.classList.add('inv-mode-gear');
  inventoryGrid.style.display = keyItems.style.display = 'none'; equipment.style.display = '';
  await flush(inventory, { type: 'attributes', attributeName: 'class', oldValue: oldMode });
  assert.ok(bar().hidden && !hidden(equipment), 'one-page Gear mode does not retain obsolete Pack categories');
  const gearMode = inventory.className;
  inventory.classList.remove('inv-mode-gear'); inventory.classList.add('inv-mode-pack');
  inventoryGrid.style.display = keyItems.style.display = ''; equipment.style.display = 'none';
  await flush(inventory, { type: 'attributes', attributeName: 'class', oldValue: gearMode });
  assert.ok(!bar().hidden && hidden(inventoryGrid) && !hidden(keyItems), 'returning to Pack remembers its page');
  await switchPane(inventory, farm);
  assert.ok(!hidden(livestock) && hidden(storage), 'each major pane remembers its own selected page');
  menu.hidden = true; await flush(menu, { type: 'attributes', attributeName: 'hidden' });
  assert.ok(bar().hidden && !hidden(storage) && !hidden(layout), 'closing releases classes from inactive DOM');
  menu.hidden = false; await flush(menu, { type: 'attributes', attributeName: 'hidden' });
  assert.ok(!bar().hidden && hidden(storage) && !hidden(livestock), 'reopening restores selection, not a stacked layout');
  console.log('Persistent main-menu pages: pointer, keyboard, controller, nested Farm, tab/mode changes, rebuild and reopen passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

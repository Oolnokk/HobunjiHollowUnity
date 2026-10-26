'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const listeners = new Map(); // Native focus/keyboard events exercise the shipped navigator, without a browser dependency.
const observers = []; // Delivers actual subtree-rebuild notifications to the production observer callbacks.
let document; // Assigned after constructing the fake body/panels used by focus().
class Element {
  constructor(tag = 'div', attrs = {}, children = [], x = 0, y = 0) {
    this.tagName = tag.toUpperCase(); this.nodeType = 1; this.attrs = { ...attrs };
    this.children = []; this.parentElement = null; this.disabled = false; this.hidden = false;
    this.style = {}; this.tabIndex = tag === 'button' ? 0 : -1; this.clicks = 0; this.events = new Map();
    this.x = x; this.y = y; this.textContent = attrs.id || tag;
    this.classes = new Set((attrs.class || '').split(' ').filter(Boolean));
    this.classList = { contains: value => this.classes.has(value), add: value => this.classes.add(value), remove: value => this.classes.delete(value), toggle: (value, enabled) => enabled ? this.classes.add(value) : this.classes.delete(value) };
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
  contains(other) { return other === this || this.children.some(child => child.contains(other)); }
  matches(selector) {
    return selector.split(',').some(raw => {
      const part = raw.trim(); // Only the DOM selector boundary is mocked; all navigation logic is production code.
      if (part.includes(' ')) return false;
      const tag = part.match(/^[a-z]+/i)?.[0];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      if (part.startsWith('.') && !this.classes.has(part.slice(1))) return false;
      if (part.startsWith('#') && this.id !== part.slice(1)) return false;
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
const button = (id, x, y, attrs = {}) => new Element('button', { id, ...attrs }, [], x, y); // Positions give the real cone scorer meaningful competitors.
const a = button('a', 10, 40); // First control inside the outer group.
const b = button('b', 110, 40); // Sibling selected by Right inside that group.
const innerButton = button('inner-button', 10, 100); // Control that requires entering the second nesting level.
const inner = new Element('div', { id: 'inner', 'data-ctrl-group': '' }, [innerButton, button('inner-second', 10, 140)], 10, 100); // Explicit nested-menu contract.
const group = new Element('div', { id: 'group', 'data-ctrl-group': '' }, [a, b, inner], 10, 40); // Parent sections are single candidates before Confirm.
const outside = button('outside', 250, 40); // Tempting spatial neighbor that must never steal selection inside a nest.
const tabA = button('tab-a', 250, 100); // A sibling tab group tests bumper confinement.
const tabB = button('tab-b', 350, 100);
const tabs = new Element('div', { 'data-ctrl-tabs': '' }, [tabA, tabB], 250, 100);
const close = button('close', 400, 0, { 'data-ctrl-cancel': '' }); // Only root-level Back should activate the panel close action.
const panel = new Element('div', { id: 'panel', 'data-ctrl-panel': '' }, [group, outside, tabs, close]);
const body = new Element('body', {}, [panel]); // Sole connected document root.
document = { body, activeElement: body, createElement: tag => new Element(tag, {}, [new Element('span', { class: 'ctrl-nav-hint ctrl-nav-hint-tabs' }), new Element('span', { class: 'ctrl-nav-hint' })]), addEventListener(type, callback) { listeners.set(type, [...(listeners.get(type) || []), callback]); } };
const context = {
  document, console, getComputedStyle: el => ({ display: el.hidden ? 'none' : el.style.display || 'block', visibility: 'visible', opacity: '1', overflowY: el.style.overflowY || 'visible' }),
  window: { innerWidth: 600, innerHeight: 400, addEventListener(type, callback) { listeners.set(type, [...(listeners.get(type) || []), callback]); }, dispatchEvent() {},
    ControllerInput: { PRIORITY: { menuNav: 10 }, subscribe(_id, callback) { this.poll = callback; }, normalizeStick: (x, y) => ({ x, y }) } },
  MutationObserver: class { constructor(callback) { observers.push(callback); } observe() {} },
  queueMicrotask, setTimeout: () => 1, clearTimeout() {}, KeyboardEvent: class {},
  CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
}; // No custom navigation helpers: boot, press, focus recovery and cancel execute the entire shipped module.
vm.runInNewContext(fs.readFileSync('docs/js/controller-ui-nav.js', 'utf8'), context);
const ui = context.window.ControllerUI; // Same public diagnostic/press API used in-game.
const press = action => ui.press(action); // Reconciles real panel ownership on every input.
const rebuild = async target => { for (const observer of observers) observer([{ target, addedNodes: [], removedNodes: [] }]); await Promise.resolve(); }; // Flushes production mutation-driven focus recovery.
(async () => {
  assert.equal(ui.focusedElement(), group, 'whole section gets initial focus');
  assert.ok(group.classList.contains('ctrl-nav-focus'));
  press('confirm');
  assert.equal(ui.focusedElement(), a);
  assert.equal(a.clicks, 0, 'entering does not accidentally activate the first item');
  press('right'); assert.equal(ui.focusedElement(), b);
  press('right'); assert.equal(ui.focusedElement(), b, 'Right cannot escape to a nearby outside item');
  press('tabNext'); assert.equal(tabB.clicks, 1, 'bumper switches tabs without first focusing their bar');
  assert.equal(ui.debugState().groupDepth, 0, 'bumper selection exits the chooser');
  tabA.focus();
  assert.equal(ui.debugState().groupDepth, 1, 'native tab focus enters its chooser');
  press('confirm');
  assert.equal(ui.debugState().groupDepth, 0, 'confirming a tab releases the chooser');
  assert.equal(ui.focusedElement(), tabs, 'tab row remains a single candidate after selection');
  assert.equal(ui.debugState().groupDepth, 0, 'switching tabs releases the old nested section');
  b.focus();
  press('cancel'); assert.equal(ui.focusedElement(), group);
  assert.equal(close.clicks, 0);
  press('confirm'); assert.equal(ui.focusedElement(), b, 're-enter remembers selection');
  press('down'); assert.equal(ui.focusedElement(), inner, 'nested section is a single glowing target');
  press('confirm'); assert.equal(ui.focusedElement(), innerButton);
  assert.equal(ui.debugState().groupDepth, 2);
  press('right'); assert.equal(ui.focusedElement(), innerButton);
  press('cancel'); assert.equal(ui.focusedElement(), inner); assert.equal(ui.debugState().groupDepth, 1);
  press('cancel'); assert.equal(ui.focusedElement(), group); assert.equal(ui.debugState().groupDepth, 0);

  innerButton.focus();
  assert.equal(ui.debugState().groupDepth, 2, 'switching to mouse/native focus adopts its containing nests');
  const escape = () => { let prevented = false; for (const listener of listeners.get('keydown')) listener({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() {} }); return prevented; };
  assert.equal(escape(), false, 'Escape after mouse/native focus reaches the game, which closes the menu');
  assert.equal(ui.debugState().groupDepth, 2, 'focus-adopted scopes are not unwound by keyboard Escape');
  press('cancel'); press('cancel');
  assert.equal(ui.debugState().groupDepth, 0, 'controller Back still unwinds adopted scopes');
  press('confirm'); assert.equal(ui.debugState().groupDepth, 1);
  assert.equal(escape(), true, 'Escape exits a nest entered with Confirm');
  assert.equal(ui.debugState().groupDepth, 0);

  a.focus();
  const replacementA = button('a', 10, 40); // Represents a full menu section rebuild preserving IDs.
  const replacementGroup = new Element('div', { id: 'group', 'data-ctrl-group': '' }, [replacementA], 10, 40);
  panel.children[0] = replacementGroup; replacementGroup.parentElement = panel; group.parentElement = null;
  await rebuild(panel);
  assert.equal(ui.focusedElement(), replacementA, 'rebuild restores the selected control immediately');
  assert.ok(replacementA.classList.contains('ctrl-nav-focus'), 'rebuilt selection retains its glow without another input');
  assert.equal(ui.debugState().groupDepth, 1);
  press('right'); assert.equal(ui.focusedElement(), replacementA, 'rebuild preserves confinement');

  const modalClose = button('modal-close', 0, 0, { 'data-ctrl-cancel': '' }); // A genuine modal temporarily supersedes the entered underlying group.
  const modalAction = button('modal-action', 0, 40);
  const modal = new Element('div', { id: 'modal', 'data-ctrl-panel': '' }, [modalClose, modalAction]);
  body.append(modal); await rebuild(body);
  // Registration normally arrives as an added node in the structural observer.
  for (const observer of observers) observer([{ target: body, addedNodes: [modal], removedNodes: [] }]);
  await Promise.resolve();
  assert.equal(ui.activePanel(), modal);
  assert.equal(ui.focusedElement(), modalAction);
  modal.hidden = true; await rebuild(modal);
  assert.equal(ui.activePanel(), panel);
  assert.equal(ui.focusedElement(), replacementA, 'modal handoff returns to the same nested control');
  press('cancel'); assert.equal(ui.focusedElement(), replacementA, 'Back skips the now single-child replacement group');
  replacementA.disabled = true; await rebuild(replacementGroup);
  assert.equal(ui.focusedElement(), replacementGroup, 'a section remains reachable for reading when all its actions are disabled');
  press('confirm');
  assert.equal(ui.focusedElement(), replacementGroup, 'read-only group keeps its highlight when entered');
  press('confirm');
  assert.equal(ui.debugState().groupDepth, 1, 'repeated Confirm cannot recursively enter a read-only group');
  press('cancel');
  press('cancel'); assert.equal(close.clicks, 1, 'root Back uses the existing close action');
  assert.equal(panel.querySelectorAll('.ctrl-nav-focus').length, 1, 'exactly one control glows after all handoffs');
  const perk = (tree, x) => new Element('div', { class: 'perk-tree', 'data-tree': tree }, [new Element('div', { 'data-perk': 'health' }, [
    button('', x, 200, { 'data-perk-action': 'dec' }), button('', x + 100, 200, { 'data-perk-action': 'inc' }),
  ])], x, 180); // Mirrors id-less perk markup whose siblings gain enabled minus buttons after spending a point.
  const originalTree = perk('combat', 20); // Selected tree must survive a reorder of all rendered perk trees.
  const originalOther = perk('alchemy', 220);
  panel.append(originalTree); panel.append(originalOther);
  originalTree.children[0].children[1].focus();
  const nextTree = perk('combat', 20);
  const nextOther = perk('alchemy', 220);
  panel.children.splice(-2, 2, nextOther, nextTree);
  nextTree.parentElement = nextOther.parentElement = panel;
  originalTree.parentElement = originalOther.parentElement = null;
  await rebuild(panel);
  assert.equal(ui.focusedElement(), nextTree.children[0].children[1], 'id-less perk controls retain skill, row and plus/minus identity across reorder');
  assert.equal(ui.debugState().groupDepth, 1);
  panel.children.splice(panel.children.indexOf(nextTree), 1); nextTree.parentElement = null;
  await rebuild(panel);
  assert.equal(ui.debugState().groupDepth, 0, 'removing a nest unwinds instead of entering a different sibling section');
  const actionCard = button('action-card', 10, 260, { class: 'menu-section' }); // Section styling must not swallow an actual action.
  panel.append(actionCard); actionCard.focus(); press('confirm');
  assert.equal(actionCard.clicks, 1);
  assert.equal(ui.debugState().groupDepth, 0);
  const lockedEffect = button('locked-effect', 10, 290, { 'data-ctrl-inspect': '' }); // Locked literature remains inspectable without spending anything.
  lockedEffect.disabled = true; panel.append(lockedEffect);
  actionCard.focus(); press('down'); assert.equal(ui.focusedElement(), lockedEffect);
  press('confirm'); assert.equal(lockedEffect.clicks, 0);

  const scrollTopButton = button('scroll-top', 10, 10); // Offscreen old focus after scrolling must not drag the viewport back.
  const scrollVisible = button('scroll-visible', 10, 50);
  const scrollOther = button('scroll-other', 10, 100);
  const scrollGroup = new Element('div', { id: 'scroll-group', 'data-ctrl-group': '' }, [scrollTopButton, scrollVisible, scrollOther], 10, 10);
  const scrollPanel = new Element('div', { id: 'scroll-panel', 'data-ctrl-panel': '' }, [scrollGroup]);
  scrollPanel.scrollHeight = 1000; scrollPanel.clientHeight = 200; scrollPanel.scrollTop = 0;
  scrollPanel.style.overflowY = 'auto';
  scrollPanel.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 200 });
  scrollGroup.getBoundingClientRect = () => ({ left: 10, top: -scrollPanel.scrollTop, width: 200, height: 300 });
  for (const element of scrollGroup.children) element.getBoundingClientRect = () => ({ left: element.x, top: element.y - scrollPanel.scrollTop, width: 80, height: 24 });
  body.append(scrollPanel);
  for (const observer of observers) observer([{ target: body, addedNodes: [scrollPanel], removedNodes: [] }]);
  await Promise.resolve();
  press('confirm'); assert.equal(ui.focusedElement(), scrollTopButton);
  let frameTime = 1000; // Replays the same shared-controller callback used by actual right-stick scrolling.
  const scrollFrame = y => context.window.ControllerInput.poll({ now: frameTime += 50, focused: true, pad: { axes: [0, 0, 0, y] }, isDown: () => false });
  scrollFrame(1); scrollFrame(1);
  assert.equal(ui.debugState().pendingScrollReanchor, true);
  const topBefore = scrollPanel.scrollTop;
  press('down');
  assert.equal(ui.focusedElement(), scrollVisible, 'first direction selects a visible control after manual scrolling');
  assert.equal(scrollVisible.scrollCalls || 0, 0, 'first direction does not scroll even a partially visible control');
  assert.equal(scrollPanel.scrollTop, topBefore);
  assert.equal(ui.debugState().pendingScrollReanchor, false);
  scrollPanel.scrollTop = 300;
  scrollTopButton.y = 10; scrollVisible.y = 350; scrollOther.y = 450;
  scrollFrame(-1);
  press('up');
  assert.equal(ui.focusedElement(), scrollVisible, 'scrolling back up also reanchors inside the clipped viewport');
  const outsideVisible = button('outside-visible', 10, 350); // Manual scroll can reveal a sibling beyond the explicitly entered group.
  scrollPanel.append(outsideVisible);
  outsideVisible.getBoundingClientRect = () => ({ left: 10, top: 80, width: 80, height: 24 });
  for (const element of scrollGroup.children) element.y = 0;
  scrollFrame(1); press('down');
  assert.notEqual(ui.focusedElement(), outsideVisible, 'manual scroll never exits the entered container');
  assert.equal(ui.debugState().groupDepth, 1, 'offscreen containers retain focus until Back');
  press('cancel');
  assert.equal(ui.debugState().groupDepth, 0, 'Back releases the offscreen container');
  scrollPanel.hidden = true; await rebuild(scrollPanel);
  // A read-only page has no focused child to lead the right stick to its scroll host.
  const readOnly = new Element('div', { id: 'read-only-content' }); // Ordinary, unannotated information region.
  readOnly.style.overflowY = 'auto'; readOnly.scrollHeight = 800; readOnly.clientHeight = 200; readOnly.scrollTop = 0;
  const hiddenReader = new Element('div', { id: 'hidden-reader' }); // A hidden sibling must never steal the scroll gesture.
  hiddenReader.hidden = true; hiddenReader.style.overflowY = 'auto'; hiddenReader.scrollHeight = 900; hiddenReader.clientHeight = 200; hiddenReader.scrollTop = 0;
  const clippedReader = new Element('div', { id: 'clipped-reader' }); // Overflow:hidden is clipping, not a scroll destination.
  clippedReader.style.overflowY = 'hidden'; clippedReader.scrollHeight = 900; clippedReader.clientHeight = 200; clippedReader.scrollTop = 0;
  const readerPanel = new Element('div', { id: 'reader-panel', 'data-ctrl-panel': '' }, [hiddenReader, clippedReader, readOnly]);
  body.append(readerPanel);
  for (const observer of observers) observer([{ target: body, addedNodes: [readerPanel], removedNodes: [] }]);
  await Promise.resolve();
  scrollFrame(1);
  assert.ok(readOnly.scrollTop > 0, 'right stick finds an ordinary information scroller with no selectable items');
  assert.equal(hiddenReader.scrollTop, 0); assert.equal(clippedReader.scrollTop, 0);
  readerPanel.style.overflowY = 'auto'; readerPanel.scrollHeight = 1000; readerPanel.clientHeight = 400; readerPanel.scrollTop = 0;
  readOnly.scrollTop = 600; scrollFrame(1);
  assert.ok(readerPanel.scrollTop > 0, 'scrolling hands off to an ancestor at the inner boundary');
  readerPanel.hidden = true; await rebuild(readerPanel);


  const treeToggle = button('tree-toggle', 10, 40, { 'data-ctrl-group-open': '', 'aria-expanded': 'false' }); // The authored toggle opens just its own collapsible tree.
  const perkRow = new Element('div', { class: 'perk-row', 'data-perk': 'health' }, [button('perk-plus', 10, 100), button('perk-minus', 10, 140)], 10, 90);
  const hiddenToggle = button('legacy-tree-toggle', 10, 40, { 'data-ctrl-group-open': '', 'aria-expanded': 'false' }); // Enhanced Nursery retains a hidden legacy toggle before its visible disclosure.
  hiddenToggle.hidden = true;
  const tree = new Element('div', { class: 'perk-tree', 'data-tree': 'combat' }, [hiddenToggle, treeToggle, perkRow], 10, 40);
  const treeList = new Element('div', { class: 'perk-trees', id: 'perkTrees' }, [tree], 10, 40);
  const perkPanel = new Element('div', { 'data-ctrl-panel': '', id: 'perk-panel' }, [treeList]);
  treeToggle.onclick = () => treeToggle.setAttribute('aria-expanded', 'true');
  body.append(perkPanel);
  for (const observer of observers) observer([{ target: body, addedNodes: [perkPanel], removedNodes: [] }]);
  await Promise.resolve();
  assert.equal(ui.focusedElement(), tree, 'a one-tree Perks container skips directly to its tree');
  assert.equal(treeToggle.clicks, 0, 'skipping the Perks wrapper does not activate its tree');
  press('confirm'); assert.equal(treeToggle.clicks, 1, 'entering an individual tree opens its existing toggle');
  assert.equal(hiddenToggle.clicks, 0, 'entering a nest ignores its hidden legacy disclosure');
  assert.equal(ui.focusedElement(), perkRow, 'opening a tree starts on its contents');
  press('confirm'); assert.equal(ui.focusedElement().id, 'perk-plus');
  press('confirm'); assert.equal(perkRow.children[0].clicks, 1);
  press('cancel'); assert.equal(ui.focusedElement(), perkRow);
  press('cancel'); assert.equal(ui.focusedElement(), tree);
  assert.equal(ui.debugState().groupDepth, 0, 'Back skips the redundant one-tree wrapper');
  perkPanel.hidden = true; await rebuild(perkPanel);

  // Execute the actual mastery picker builder against the navigator, including rank rebuilds and locked-effect inspection.
  const masteryPanel = new Element('div', { 'data-ctrl-panel': '', id: 'mastery-panel' });
  context.rankCard = new Element('div', { class: 'loadout-slot', id: 'rank-card' });
  masteryPanel.append(context.rankCard);
  let choices = 0; // Counts only purchases routed through the progression API.
  context.window.Combat = { deps: { weaponDamageTypeForTool: () => 'sharp', getMotesOfProwess: () => 10 } };
  context.window.CombatProgression = { getTree: () => Array.from({ length: 5 }, () => [{ label: 'Available', desc: 'Choose me' }, { label: 'Locked', desc: 'Discover me' }]),
    getLevelState: () => 'available', moteCostForLevel: () => 1, isOptionUnlocked: (_key, _ability, _level, index) => index === 0, choose: () => { choices++; } };
  const loadoutSource = fs.readFileSync('docs/js/combat/combat-loadout-ui.js', 'utf8'); // Uses the real authored rank buttons and handlers.
  const pickerSource = loadoutSource.slice(loadoutSource.indexOf('  function renderLevelPicker'), loadoutSource.indexOf('  function render(preferredFocusId'));
  document.createElement = tag => new Element(tag);
  vm.runInNewContext(`let expandedFor = null; ${pickerSource}\nfunction render() { for (const child of rankCard.children) child.parentElement = null; rankCard.children = []; renderLevelPicker(rankCard, 'axe', 'swing'); }\nrender();`, context);
  body.append(masteryPanel);
  for (const observer of observers) observer([{ target: body, addedNodes: [masteryPanel], removedNodes: [] }]);
  await Promise.resolve();
  press('confirm'); assert.equal(ui.focusedElement().id, 'mastery-axe-swing-1');
  press('confirm'); await rebuild(context.rankCard);
  assert.equal(ui.focusedElement().id, 'mastery-axe-swing-1', 'opening a rank preserves its controller focus through rebuilding');
  const optionsGroup = context.rankCard.querySelector('.loadout-options'); // Position the expanded option region below the rank strip.
  optionsGroup.y = 100;
  press('down'); assert.equal(ui.focusedElement(), optionsGroup);
  press('confirm'); assert.equal(ui.focusedElement().id, 'mastery-axe-swing-1-option-0');
  const lockedOption = optionsGroup.children[1];
  lockedOption.x = 100;
  press('right'); assert.equal(ui.focusedElement(), lockedOption, 'locked mastery descriptions are reachable');
  press('confirm'); assert.equal(choices, 0, 'inspecting a locked mastery effect cannot buy it');
  press('left'); press('confirm'); assert.equal(choices, 1, 'Confirm chooses the available effect through the normal progression API');
  masteryPanel.hidden = true; await rebuild(masteryPanel);
  const detailAction = button('detail-use', 320, 80); // Item actions live in a sibling panel rather than inside the grid's DOM.
  const detailNest = new Element('div', { id: 'detail-nest', 'data-ctrl-group': '' }, [button('detail-nested-action', 320, 120), button('detail-nested-second', 320, 160)], 320, 120);
  const detailPanel = new Element('div', { id: 'item-detail', 'data-ctrl-detail-panel': '' }, [detailAction, detailNest], 320, 40);
  const itemCard = button('item-a', 10, 40, { 'data-stack-id': 'stack-a', 'data-ctrl-detail': 'item-detail' }); // Exact stack identity is retained through list rebuilds.
  const itemOther = button('item-b', 110, 40, { 'data-stack-id': 'stack-b', 'data-ctrl-detail': 'item-detail' });
  const itemGrid = new Element('div', { id: 'item-grid', 'data-ctrl-group': '' }, [itemCard, itemOther], 10, 40);
  const itemClose = button('item-close', 500, 0, { 'data-ctrl-cancel': '' });
  const itemPanel = new Element('div', { id: 'item-panel', 'data-ctrl-panel': '' }, [itemGrid, detailPanel, itemClose]);
  body.append(itemPanel);
  for (const observer of observers) observer([{ target: body, addedNodes: [itemPanel], removedNodes: [] }]);
  await Promise.resolve();
  assert.equal(ui.focusedElement(), itemGrid);
  press('right'); assert.notEqual(ui.focusedElement(), detailPanel, 'associated detail is not a free-standing sibling target');
  itemGrid.focus(); press('confirm');
  assert.equal(ui.focusedElement(), itemCard);
  press('right'); assert.equal(ui.focusedElement(), itemOther);
  press('confirm'); assert.equal(itemOther.clicks, 1, 'Confirm populates the selected item before entering its detail');
  assert.equal(ui.focusedElement(), detailAction);
  assert.equal(detailAction.clicks, 0, 'opening detail never immediately uses an item');
  assert.equal(ui.debugState().groupDepth, 2, 'detail is logically nested within the item grid');
  press('left'); assert.equal(ui.focusedElement(), detailAction, 'directional navigation cannot escape detail to the grid');
  press('down'); assert.equal(ui.focusedElement(), detailNest);
  press('confirm'); assert.equal(ui.debugState().groupDepth, 3);
  press('cancel'); assert.equal(ui.focusedElement(), detailNest, 'nested detail sections unwind before returning to the item');
  press('cancel'); assert.equal(ui.focusedElement(), itemOther);
  assert.equal(ui.debugState().groupDepth, 1);
  assert.equal(itemClose.clicks, 0);
  press('confirm');
  const rebuiltItem = button('item-b', 110, 40, { 'data-stack-id': 'stack-b', 'data-ctrl-detail': 'item-detail' }); // Equip/use actions can replace their source cards while detail stays open.
  itemGrid.children[1] = rebuiltItem; rebuiltItem.parentElement = itemGrid; itemOther.parentElement = null;
  await rebuild(itemGrid);
  press('cancel'); assert.equal(ui.focusedElement(), rebuiltItem, 'Back restores the same rebuilt stack');
  press('confirm');
  itemGrid.children.pop(); rebuiltItem.parentElement = null;
  await rebuild(itemGrid);
  press('cancel'); assert.equal(ui.focusedElement(), itemCard, 'consuming the source stack returns to its surviving neighbor');
  press('confirm');
  detailAction.parentElement = null; detailNest.parentElement = null; detailPanel.children = [];
  await rebuild(detailPanel);
  assert.equal(ui.focusedElement(), detailPanel, 'read-only descriptions stay focused even without any actions');
  press('confirm'); assert.equal(ui.debugState().groupDepth, 2, 'read-only Confirm cannot nest the description again');
  press('cancel'); assert.equal(ui.focusedElement(), itemCard);
  press('confirm');
  itemGrid.children = []; itemCard.parentElement = null;
  await rebuild(itemGrid);
  press('cancel'); assert.equal(ui.focusedElement(), itemGrid, 'consuming the final item returns to the empty inventory grid');
  itemGrid.append(itemCard);
  press('right');
  itemCard.focus();
  itemCard.setAttribute('data-ctrl-detail', 'missing-detail');
  press('confirm'); assert.equal(ui.focusedElement(), itemCard, 'missing associated panes safely preserve normal item selection');
  itemCard.setAttribute('data-ctrl-detail', 'item-detail');
  itemCard.onclick = () => { itemPanel.hidden = true; }; // A click which closes or replaces the menu must not enter its old detail afterward.
  press('confirm'); await rebuild(itemPanel);
  assert.notEqual(ui.activePanel(), itemPanel);
  // Run the authored compact Nursery renderer through the same navigator as the enhanced inventory.
  const nurserySource = fs.readFileSync('docs/js/livestock-nursery.js', 'utf8'); // Nursery markup and click handlers must opt in at their real source.
  const nurseryFunction = name => {
    const start = nurserySource.indexOf(`  function ${name}(`); // Bounds the real owner function without copying its implementation.
    const end = nurserySource.indexOf('\n  function ', start + 1);
    return nurserySource.slice(start, end);
  };
  const nurseryRecords = [{ id: 'baby-one', kind: 'grehlr', name: 'Pebble' }, { id: 'baby-two', kind: 'grehlr', name: 'Stripe' }]; // Two saved identities expose wrong-baby returns after a rebuilt list.
  const makeNurseryElement = tag => {
    const element = new Element(tag); // Only HTML parsing is simulated; rendering and navigation execute shipped code.
    element.style.setProperty = (name, value) => { element.style[name] = value; };
    element.dataset = new Proxy({}, { get: (_object, key) => element.getAttribute('data-' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())),
      set: (_object, key, value) => { element.setAttribute('data-' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()), value); return true; } });
    Object.defineProperty(element, 'innerHTML', { set(html) {
      if (!html.includes('livestock-nursery-toggle')) return;
      const toggle = new Element('button', { class: 'livestock-nursery-toggle', 'data-ctrl-group-open': '', 'aria-expanded': html.includes('aria-expanded="false"') ? 'false' : 'true' }); // Parses the renderer's disclosure boundary only.
      element.append(new Element('div', {}, [toggle]));
      element.append(makeNurseryElement('div'));
    } });
    return element;
  };
  document.createElement = makeNurseryElement;
  const nurseryList = new Element('div', { id: 'farmLivestockList' }); // Mimics the existing Farm container that owns successive Nursery sections.
  nurseryList.prepend = child => { child.parentElement = nurseryList; nurseryList.children.unshift(child); };
  const nurseryOutside = button('nursery-outside', 300, 40); // A nearby Farm action must be unreachable while Nursery owns focus.
  const nurseryPanel = new Element('div', { id: 'nursery-controller-panel', 'data-ctrl-panel': '' }, [nurseryList, nurseryOutside]);
  let nurseryContext; // Initialized before queued disclosure rerenders execute.
  const renderNursery = () => {
    for (const child of nurseryList.children) child.parentElement = null;
    nurseryList.children = [];
    nurseryContext.renderBabyCompactList(nurseryList);
  };
  nurseryContext = vm.createContext({ document, window: {}, babies: () => nurseryRecords, adultCount: () => 0, adultCapacity: () => 1,
    NURSERY_VISIBLE_LIMIT: 16, SPECIES_ICONS: {}, escapeHtml: value => String(value), babySummary: () => ({ size: 'Small', colors: [], special: [] }),
    animalDeps: { hasFarmPermission: () => true }, queuePanelDecoration: () => queueMicrotask(() => { renderNursery(); rebuild(nurseryList); }) });
  vm.runInContext(`let selectedBabyId = null; let farmBabyInventoryCollapsed = true; ${nurseryFunction('toggleFarmInventory')} ${nurseryFunction('renderBabyCompactList')}`, nurseryContext);
  renderNursery();
  body.append(nurseryPanel);
  for (const observer of observers) observer([{ target: body, addedNodes: [nurseryPanel], removedNodes: [] }]);
  await Promise.resolve();
  assert.equal(ui.focusedElement().id, 'farmLivestockList', 'Nursery and adults share one selectable inventory owner');
  // Real DOM click listeners receive an event; supply one on this HTML-parser stand-in.
  nurseryList.querySelector('.livestock-nursery-toggle').click = function () { for (const callback of this.events.get('click') || []) callback({ stopPropagation() {} }); };
  press('confirm');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(ui.debugState().groupId, 'farmLivestockList', 'entering opens the Nursery subtab and survives its asynchronous rebuild');
  const nurseryCard = nurseryList.querySelector('[data-key="baby-two"]'); // Select a non-first baby so Back cannot pass by defaulting to the first.
  nurseryCard.focus(); press('confirm');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(ui.debugState().groupId, 'livestockNurseryDetail');
  assert.equal(ui.debugState().groupDepth, 2);
  press('right'); assert.ok(nurseryList.querySelector('#livestockNurseryDetail').contains(ui.focusedElement()), 'baby detail navigation stays within its actions');
  press('cancel');
  assert.equal(ui.focusedElement().getAttribute('data-key'), 'baby-two', 'Back returns to the same baby after the actual Nursery renderer replaces every row');
  press('cancel'); assert.equal(ui.focusedElement().id, 'farmLivestockList', 'second Back exits the Nursery inventory owner');
  assert.equal(ui.debugState().groupDepth, 0);
  nurseryPanel.hidden = true; await rebuild(nurseryPanel);
  // Execute nested section pages, rather than asserting their source markup.
  const sectionA1 = button('section-a1', 10, 40); // First page action must be highlighted without being clicked.
  const sectionA2 = button('section-a2', 110, 40); // Provides a meaningful two-control section.
  const sectionA = new Element('div', { id: 'section-a', class: 'farm-section' }, [sectionA1, sectionA2]); // A normal Farm-sized section.
  const column = (id, x) => new Element('div', { id, class: 'farm-storage-col' }, [button(id + '-one', x, 80), button(id + '-two', x + 100, 80)], x, 80); // Two columns exercise nested bumper ownership.
  const bagColumn = column('bag-column', 10); // Starts as the first page inside Storage.
  const boxColumn = column('box-column', 210); // Becomes visible with the local next-tab action.
  const storageSection = new Element('div', { id: 'storage-section', class: 'farm-section' }, [bagColumn, boxColumn]); // Outer and inner page owners share the same configured tab actions.
  const sectionOwner = new Element('div', { id: 'section-owner', class: 'mp-pane' }, [sectionA, storageSection]); // Mirrors the real pause-menu pane boundary.
  const sectionPanel = new Element('div', { id: 'section-panel', 'data-ctrl-panel': '' }, [sectionOwner]); // Isolated topmost modal for section navigation.
  body.append(sectionPanel);
  for (const observer of observers) observer([{ target: body, addedNodes: [sectionPanel], removedNodes: [] }]);
  await Promise.resolve();
  assert.equal(ui.focusedElement(), sectionA1, 'pause panes automatically enter their selected page without a container Confirm');
  assert.equal(sectionA1.clicks, 0, 'entering does not activate the highlighted action');
  assert.ok(storageSection.classList.contains('ctrl-nav-subtab-hidden'));
  assert.equal(ui.debugState().subtab.count, 2);
  press('right'); assert.equal(ui.focusedElement(), sectionA2);
  press('tabNext');
  assert.equal(ui.focusedElement(), storageSection, 'a nested multi-section page remains enterable');
  assert.ok(sectionA.classList.contains('ctrl-nav-subtab-hidden'));
  press('confirm');
  assert.equal(ui.focusedElement(), bagColumn.children[0]);
  assert.ok(boxColumn.classList.contains('ctrl-nav-subtab-hidden'));
  press('tabPrev');
  assert.equal(ui.focusedElement(), boxColumn.children[0], 'previous wraps within the deepest section owner');
  assert.equal(ui.debugState().subtab.id, 'box-column');
  assert.ok(bagColumn.classList.contains('ctrl-nav-subtab-hidden'));
  await rebuild(storageSection);
  assert.equal(ui.debugState().subtab.id, 'box-column', 'content mutations preserve the deepest active section');
  press('cancel');
  assert.equal(ui.focusedElement(), storageSection, 'Back restores the enclosing section owner');
  assert.ok(!bagColumn.classList.contains('ctrl-nav-subtab-hidden'));
  assert.ok(!boxColumn.classList.contains('ctrl-nav-subtab-hidden'));
  assert.equal(ui.debugState().subtab.id, 'storage-section');
  press('confirm');
  assert.equal(ui.debugState().groupId, 'storage-section', 'a rebuilt nested page owner remains enterable after Back');
  press('cancel');
  press('tabNext');
  assert.equal(ui.focusedElement(), sectionA2, 'returning to a page remembers its selected control');
  const rebuiltSection = new Element('div', { id: 'section-a', class: 'farm-section' }, [button('section-a1', 10, 40), button('section-a2', 110, 40)]); // Replaces the selected page without closing its owner.
  sectionOwner.children[0] = rebuiltSection; rebuiltSection.parentElement = sectionOwner; sectionA.parentElement = null;
  await rebuild(sectionOwner);
  assert.equal(ui.debugState().subtab.id, 'section-a');
  assert.equal(ui.focusedElement(), rebuiltSection.children[1]);
  assert.ok(storageSection.classList.contains('ctrl-nav-subtab-hidden'), 'rebuild retains one-page presentation');
  press('cancel');
  assert.equal(ui.focusedElement(), sectionOwner);
  assert.ok(!storageSection.classList.contains('ctrl-nav-subtab-hidden'), 'Back restores every sibling page');
  press('confirm');
  for (const callback of listeners.get('pointerdown') || []) callback({ target: rebuiltSection });
  assert.equal(ui.debugState().groupDepth, 0, 'mouse/touch returns to the normal multi-section layout');
  assert.ok(!storageSection.classList.contains('ctrl-nav-subtab-hidden'));
  press('confirm');
  sectionPanel.hidden = true; await rebuild(sectionPanel);
  assert.ok(!storageSection.classList.contains('ctrl-nav-subtab-hidden'), 'closing the menu cannot leave section siblings hidden');
  const unnamedPage = name => new Element('div', { class: 'farm-section' }, [button(name + '-one', 10, 40), button(name + '-two', 110, 40)]); // Authored sections are not required to have ids.
  let unnamedOwner = new Element('div', { id: 'unnamed-owner', class: 'mp-pane' }, [unnamedPage('first'), unnamedPage('second')]); // Only the owner has a stable identity through replacement.
  const unnamedPanel = new Element('div', { 'data-ctrl-panel': '', id: 'unnamed-panel' }, [unnamedOwner]); // Mirrors a fully rebuilt pane with id-less child columns.
  body.append(unnamedPanel);
  for (const observer of observers) observer([{ target: body, addedNodes: [unnamedPanel], removedNodes: [] }]);
  await Promise.resolve();
  press('confirm'); press('tabNext');
  assert.equal(ui.debugState().subtab.index, 1);
  const previousUnnamedOwner = unnamedOwner; // Keeps the detached node available for cleanup assertions.
  unnamedOwner = new Element('div', { id: 'unnamed-owner', class: 'mp-pane' }, [unnamedPage('first'), unnamedPage('second')]);
  unnamedPanel.children[0] = unnamedOwner; unnamedOwner.parentElement = unnamedPanel; previousUnnamedOwner.parentElement = null;
  await rebuild(unnamedPanel);
  assert.equal(ui.debugState().subtab.index, 1, 'whole-owner rebuild preserves the index of an id-less selected section');
  assert.equal(ui.focusedElement().id, 'second-one');
  assert.ok(unnamedOwner.children[0].classList.contains('ctrl-nav-subtab-hidden'));
  assert.ok(!previousUnnamedOwner.children[0].classList.contains('ctrl-nav-subtab-hidden'), 'detached siblings do not retain presentation state');
  unnamedPanel.hidden = true; await rebuild(unnamedPanel);
  const singleAction = button('single-action', 10, 40); // A chain of one-child wrappers must never become extra Confirm or Back steps.
  const singleInner = new Element('div', { 'data-ctrl-group': '' }, [singleAction]); // First redundant wrapper.
  const singleOuter = new Element('div', { 'data-ctrl-group': '' }, [singleInner]); // Second redundant wrapper.
  const singleClose = button('single-close', 300, 0, { 'data-ctrl-cancel': '' }); // Back should reach this immediately from a transparent chain.
  const singlePanel = new Element('div', { 'data-ctrl-panel': '' }, [singleOuter, singleClose]); // Exercises the complete owner/activation path.
  body.append(singlePanel);
  for (const observer of observers) observer([{ target: body, addedNodes: [singlePanel], removedNodes: [] }]);
  await Promise.resolve();
  assert.equal(ui.focusedElement(), singleAction);
  press('confirm'); assert.equal(singleAction.clicks, 1);
  assert.equal(ui.debugState().groupDepth, 0);
  press('cancel'); assert.equal(singleClose.clicks, 1);
  singlePanel.hidden = true; await rebuild(singlePanel);
  const stableMarkup = fs.readFileSync('docs/index.html', 'utf8'); // Uses shipped wrapper metadata so missing HTML wiring fails the regression.
  assert.match(stableMarkup, /id="mpStable" data-ctrl-transparent/);
  assert.match(stableMarkup, /id="stableList" class="farm-list" data-ctrl-auto-enter/);
  let stablePerk = button('stable-perk-speed', 10, 100, { 'data-key': 'speed' }); // Real purchase controls must be reachable after opening the tree.
  let stableTree = new Element('div', { id: 'stableTrainingDetail_pet', 'data-ctrl-detail-panel': '' }, [stablePerk]); // Hidden from sibling navigation until its disclosure is confirmed.
  let stableTraining = button('stableTrainingToggle_pet', 10, 40, { 'data-ctrl-detail': stableTree.id }); // Same association emitted by the native Stable renderer.
  let stableAdult = new Element('div', { id: 'stableAgeAdultAnimals', 'data-ctrl-subtab': '' }, [stableTraining, button('stable-stow', 110, 40)], 10, 30); // Adult section is a real choice rather than a redundant structural nest.
  stableTraining.onclick = () => stableAdult.append(stableTree);
  const stableBaby = new Element('div', { id: 'stableAgeBabyAnimals', 'data-ctrl-subtab': '' }, [button('stable-baby-toggle', 10, 180)], 10, 170); // Baby inventory stays reachable as a separate section.
  const stableList = new Element('div', { id: 'stableList', 'data-ctrl-auto-enter': '', 'data-ctrl-initial-subtab': 'stableAgeAdultAnimals' }, [stableAdult, stableBaby]); // Structural roster must not consume Confirm or Back.
  const stablePane = new Element('div', { id: 'mpStable', class: 'mp-pane', 'data-ctrl-transparent': '' }, [stableList]); // Selected Stable tab has no extra outer gate.
  const stableClose = button('stable-close', 300, 0, { 'data-ctrl-cancel': '' }); // Tests that Back skips the same transparent wrappers.
  const stablePanel = new Element('div', { 'data-ctrl-panel': '' }, [stablePane, stableClose]); // Mirrors the mounted pause-menu ownership boundary.
  body.append(stablePanel);
  for (const observer of observers) observer([{ target: body, addedNodes: [stablePanel], removedNodes: [] }]);
  await Promise.resolve();
  assert.equal(ui.focusedElement(), stableTraining, 'Stable opens directly on adult animal actions without a container Confirm');
  assert.equal(ui.debugState().subtab.id, 'stableAgeAdultAnimals');
  press('tabNext');
  assert.equal(ui.debugState().subtab.id, 'stableAgeBabyAnimals', 'bumpers retain local Stable age pages');
  assert.equal(ui.focusedElement().id, 'stable-baby-toggle');
  press('tabPrev');
  assert.equal(ui.focusedElement(), stableTraining);
  press('confirm');
  assert.equal(ui.focusedElement(), stablePerk, 'Confirm on Training opens and enters the perk tree');
  press('confirm'); assert.equal(stablePerk.clicks, 1, 'controller activates the chosen level-up perk');
  const oldAdult = stableAdult; // Full native Stable rerenders replace the age section, animal row and perk tree.
  stablePerk = button('stable-perk-speed', 10, 100, { 'data-key': 'speed' });
  stablePerk.disabled = true;
  const stableDebug = button('stable-training-debug', 10, 140); // Last-point purchases must recover onto an enabled control inside the same tree.
  stableTree = new Element('div', { id: 'stableTrainingDetail_pet', 'data-ctrl-detail-panel': '' }, [stablePerk, stableDebug]);
  stableTraining = button('stableTrainingToggle_pet', 10, 40, { 'data-ctrl-detail': stableTree.id });
  stableAdult = new Element('div', { id: 'stableAgeAdultAnimals', 'data-ctrl-subtab': '' }, [stableTraining, button('stable-stow', 110, 40), stableTree], 10, 30);
  oldAdult.parentElement = null;
  stableList.children[0] = stableAdult; stableAdult.parentElement = stableList;
  await rebuild(stableList);
  assert.equal(ui.debugState().subtab.id, 'stableAgeAdultAnimals', 'purchase rebuild retains the active Stable age page');
  assert.equal(ui.debugState().groupId, stableTree.id, 'purchase rebuild retains perk-tree ownership');
  assert.equal(ui.focusedElement(), stableDebug, 'spending the last point stays inside the tree instead of resetting to the roster');

  press('cancel'); assert.equal(ui.focusedElement(), stableTraining, 'Back returns to this animal training action');
  press('cancel'); assert.equal(ui.focusedElement(), stableList, 'Back releases the automatic owner so outer menu tabs are reachable');
  assert.equal(ui.debugState().subtab, null, 'automatic entry does not reclaim the released scope');
  press('cancel'); assert.equal(stableClose.clicks, 1, 'next Back closes the menu');
  press('confirm'); // Reenter the released owner to test handing its pages back to pointer input.
  for (const handler of listeners.get('pointerdown') || []) handler({ target: stableTraining });
  await rebuild(stableList);
  assert.ok(!stableBaby.classList.contains('ctrl-nav-subtab-hidden'), 'pointer input restores every Stable age page');
  assert.equal(ui.debugState().subtab, null, 'menu reconciliation cannot immediately reclaim pointer-owned pages');
  stablePanel.hidden = true; await rebuild(stablePanel);
  const handled = []; // Opt-in readers own A/B/bumpers without taking over controller polling.
  panel.setAttribute('data-ctrl-actions', '');
  panel.dispatchEvent = event => { handled.push(event.detail.action); return false; };
  for (const action of ['confirm', 'cancel', 'tabPrev', 'tabNext']) press(action);
  assert.deepEqual(handled, ['confirm', 'cancel', 'previous', 'next']);
  console.log('Controller nested group confinement, Back, rebuild and modal handoffs passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

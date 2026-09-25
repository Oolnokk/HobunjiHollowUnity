'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/folder-save-onboarding-bridge.js'), 'utf8');

function makeDom() {
  const byId = new Map();

  function makeElement(tagName = 'div') {
    const children = [];
    const attrs = new Map();
    const selectorMap = new Map();
    const element = {
      tagName: String(tagName).toUpperCase(),
      style: {},
      children,
      parentElement: null,
      textContent: '',
      disabled: false,
      innerHTML: '',
      setAttribute(name, value) {
        attrs.set(name, String(value));
        if (name === 'id') {
          element.id = String(value);
          byId.set(element.id, element);
        }
        if (name.startsWith('data-')) selectorMap.set('[' + name + ']', element);
      },
      getAttribute(name) { return attrs.get(name) ?? null; },
      appendChild(child) {
        children.push(child);
        child.parentElement = element;
        if (child.id) byId.set(child.id, child);
        return child;
      },
      remove() {
        if (element.id) byId.delete(element.id);
        if (element.parentElement) {
          const i = element.parentElement.children.indexOf(element);
          if (i >= 0) element.parentElement.children.splice(i, 1);
        }
      },
      addEventListener(type, handler) {
        element['_on_' + type] = handler;
      },
      click() { element._on_click?.({ target: element }); },
      querySelector(selector) {
        if (selectorMap.has(selector)) return selectorMap.get(selector);
        for (const child of children) {
          const found = child.querySelector?.(selector);
          if (found) return found;
        }
        return null;
      },
    };

    Object.defineProperty(element, 'id', {
      get() { return attrs.get('id') || ''; },
      set(value) {
        const previous = attrs.get('id');
        if (previous) byId.delete(previous);
        attrs.set('id', String(value));
        byId.set(String(value), element);
      },
      configurable: true,
    });

    Object.defineProperty(element, 'innerHTML', {
      get() { return element._innerHTML || ''; },
      set(value) {
        element._innerHTML = String(value);
        selectorMap.clear();
        const selectors = [
          'data-save-startup-failure-message',
          'data-save-startup-recovery',
          'data-save-startup-retry',
        ];
        for (const name of selectors) {
          if (!element._innerHTML.includes(name)) continue;
          const child = makeElement(name.includes('recovery') || name.includes('retry') ? 'button' : 'div');
          child.setAttribute(name, '');
          selectorMap.set('[' + name + ']', child);
          children.push(child);
          child.parentElement = element;
        }
      },
      configurable: true,
    });

    return element;
  }

  const body = makeElement('body');
  return {
    body,
    createElement: makeElement,
    getElementById(id) { return byId.get(String(id)) || null; },
  };
}

async function crashBoundaryRegression() {
  const document = makeDom();
  let recoveryOpened = 0;
  const context = vm.createContext({
    console,
    document,
    setTimeout,
    clearTimeout,
    window: {
      HobunjiOnboarding: {
        init() { throw new TypeError('meta.worlds.forEach is not a function'); },
      },
      FolderSavePrimary: {
        async prepareBeforeOnboarding() {},
      },
      LocalSaveFolder: {
        getStatus() {
          return { state: 'ready', folderName: 'Broken Save', lastError: 'worlds/broken.json is unreadable' };
        },
      },
      HobunjiSaveCheckpoints: {
        openRecoveryModal() { recoveryOpened++; },
      },
    },
  });

  vm.runInContext(source, context, { filename: 'folder-save-onboarding-bridge.js' });
  await context.window.HobunjiOnboarding.init();

  const overlay = document.getElementById('hobunjiSaveStartupFailure');
  assert.ok(overlay, 'onboarding exceptions render an emergency save-startup surface instead of leaving a blank page');
  const card = overlay.children[0];
  const message = card.querySelector('[data-save-startup-failure-message]');
  assert.match(message.textContent, /meta\.worlds\.forEach is not a function/, 'emergency surface exposes the actual onboarding exception');
  assert.match(message.textContent, /worlds\/broken\.json is unreadable/, 'emergency surface includes the connected-folder error');
  card.querySelector('[data-save-startup-recovery]').click();
  assert.equal(recoveryOpened, 1, 'emergency surface can open Save Recovery before normal onboarding exists');
}

function stalledPreparationRegression() {
  const document = makeDom();
  const timers = [];
  const context = vm.createContext({
    console,
    document,
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout() {},
    window: {
      HobunjiOnboarding: {
        init() { throw new Error('original onboarding should not run while prepare is pending'); },
      },
      FolderSavePrimary: {
        prepareBeforeOnboarding() { return new Promise(() => {}); },
      },
      LocalSaveFolder: {
        getStatus() { return { state: 'ready', folderName: 'Broken Save', lastError: null }; },
      },
      HobunjiSaveCheckpoints: {
        openRecoveryModal() {},
      },
    },
  });

  vm.runInContext(source, context, { filename: 'folder-save-onboarding-bridge.js' });
  context.window.HobunjiOnboarding.init();
  assert.ok(timers.length > 0, 'startup bridge arms a blank-screen watchdog while folder preparation is pending');
  timers[0]();
  const overlay = document.getElementById('hobunjiSaveStartupFailure');
  assert.ok(overlay, 'stalled folder preparation becomes a visible recovery surface');
  const message = overlay.children[0].querySelector('[data-save-startup-failure-message]');
  assert.match(message.textContent, /did not finish/, 'watchdog explains that save startup stalled');
}

(async () => {
  await crashBoundaryRegression();
  stalledPreparationRegression();
  console.log('save startup failure surface regression: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

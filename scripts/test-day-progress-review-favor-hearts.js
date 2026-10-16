// Day Progress Review relationship cards: the ledger's favorDelta is diffed
// from stored relationship Favor, which is already in Favor POINTS (40 = 1
// heart). Regression guard for the card multiplying that delta by 40 again,
// which made +1 Favor read "+40 (+1 heart)" while the relationship menu
// (correctly) showed only 1/40 of a heart.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

// Minimal element tree: enough selector support (descendant chains of
// tag/.class compounds) for day-progress-review-relationship-ui.js.
class El {
  constructor(tag, classes = [], text = '') {
    this.tagName = tag.toUpperCase();
    this.classList = new Set(classes);
    this.classList.contains = this.classList.has;
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this._text = text;
  }
  get className() { return [...this.classList].join(' '); }
  set className(value) { this.classList.clear(); for (const c of String(value).split(/\s+/).filter(Boolean)) this.classList.add(c); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get firstChild() { return this.children[0] || null; }
  get isConnected() { return true; }
  appendChild(child) { if (child.parent) child.parent.children = child.parent.children.filter(c => c !== child); child.parent = this; this.children.push(child); return child; }
  append(...kids) { for (const k of kids) this.appendChild(k); }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  setAttribute() {}
  descendants() { return this.children.flatMap(c => [c, ...c.descendants()]); }
  matchesCompound(compound) {
    const [tag, ...classes] = compound.split('.');
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    return classes.every(c => this.classList.has(c));
  }
  matches(parts) {
    if (!this.matchesCompound(parts.at(-1))) return false;
    let remaining = parts.slice(0, -1);
    for (let node = this.parent; node && remaining.length; node = node.parent) {
      if (node.matchesCompound(remaining.at(-1))) remaining = remaining.slice(0, -1);
    }
    return remaining.length === 0;
  }
  querySelectorAll(selector) { const parts = selector.trim().split(/\s+/); return this.descendants().filter(el => el.matches(parts)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function card(name, favorText) {
  const article = new El('article', ['day-review-card']);
  const person = new El('div', ['day-review-person']);
  person.appendChild(new El('strong', [], name));
  const deltas = new El('span', ['day-review-deltas']);
  const favor = new El('span', ['day-review-favor'], 'Favor ');
  favor.appendChild(new El('b', ['day-review-positive'], favorText));
  deltas.appendChild(favor);
  person.appendChild(deltas);
  article.appendChild(person);
  return article;
}

const root = new El('div');
root.id = 'hobunjiDayProgressReview';
const oneHeart = card('Ama', '+40');
const onePoint = card('Bo', '+1');
root.append(oneHeart, onePoint);

const head = new El('head');
const context = {
  console,
  Math, Number, String, Object, Array,
  MutationObserver: class { observe() {} disconnect() {} },
  document: {
    head,
    documentElement: new El('html'),
    getElementById: id => (id === root.id ? root : null),
    createElement: tag => new El(tag),
  },
};
context.window = context;
context.__hobunjiFurnitureDebug = { getNpcWalkers: () => [{ rec: { id: 'npc_ama', name: 'Ama' } }, { rec: { id: 'npc_bo', name: 'Bo' } }] };
context.NpcFavorBalance = { favorPointsToHearts: p => p / 40, heartsToFavorPoints: h => h * 40 };
context.DayProgressReview = { debugSnapshot: () => ({ ledger: { relationships: { npc_ama: { favorDelta: 40 }, npc_bo: { favorDelta: 1 } } } }) };

vm.createContext(context);
const file = path.join(__dirname, '..', 'docs', 'js', 'day-progress-review-relationship-ui.js');
vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });

const label = el => el.querySelector('.day-review-favor .day-review-heart-equivalent')?.textContent;
const value = el => el.querySelector('.day-review-favor b').textContent;
assert.strictEqual(value(oneHeart), '+40', '40 Favor points must stay displayed as +40, not be multiplied again.');
assert.strictEqual(label(oneHeart), '(+1 heart)', '40 Favor points is exactly one heart, matching the relationship menu.');
assert.strictEqual(value(onePoint), '+1', '1 Favor point must display as +1, not +40.');
assert.notStrictEqual(label(onePoint), '(+1 heart)', '1 Favor point must not be labelled as a whole heart.');
assert.strictEqual(label(onePoint), '(+0.03 hearts)', '1 Favor point is 1/40 of a heart.');
console.log('ok day-progress-review favor hearts');

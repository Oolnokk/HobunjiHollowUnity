// pixel-work-yield.js lets long async pixel jobs give the browser a frame:
// maybeYield() must resolve without yielding while under its slice budget,
// and actually hand control back (a macrotask turn) once over it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/pixel-work-yield.js', 'utf8');
let clock = 0;
const sandbox = {
  performance: { now: () => clock },
  setTimeout,
  MessageChannel,
};
sandbox.window = sandbox;
vm.runInNewContext(source, sandbox);
const api = sandbox.PixelWorkYield;

(async () => {
  let otherTaskRan = false;
  setTimeout(() => { otherTaskRan = true; }, 0);

  clock = api.SLICE_MS - 1;
  await api.maybeYield();
  assert.equal(api.getDebug().yields, 0, 'no yield while under the slice budget');
  assert.equal(otherTaskRan, false, 'under budget the job keeps the main thread');

  clock = api.SLICE_MS + 50;
  await new Promise(resolve => setTimeout(resolve, 5)); // Lets the queued timer fire first, as a frame would.
  otherTaskRan = false;
  setTimeout(() => { otherTaskRan = true; }, 0);
  const pending = api.maybeYield();
  assert.equal(otherTaskRan, false);
  await pending;
  assert.equal(api.getDebug().yields, 1, 'over budget it yields once');

  await api.maybeYield();
  assert.equal(api.getDebug().yields, 1, 'the budget restarts after a yield');

  console.log('ok - PixelWorkYield yields only once a slice of continuous work is used up');
})().catch(error => { console.error(error); process.exit(1); });

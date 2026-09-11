'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const source = read('docs/js/harlyao-night-march-calendar.js');
const loader = read('docs/js/house-pieces.js');
const config = JSON.parse(read('docs/config/harlyao-night-march.json'));

assert.match(loader, /\['HarlyaoNightMarchCalendar', 'harlyao-night-march-calendar\.js\?v=[^']+'\]/, 'calendar route decorator loads in gameplay');
assert.match(source, /CalendarSystem\?\.absDayForMonthStart/, 'visible calendar month is converted through the canonical civil-calendar epoch');
assert.match(source, /querySelectorAll\('\.cal-day-btn'\)/, 'every rendered Calendar day cell is eligible for a march marker');
assert.match(source, /harlyao-cal-marker/, 'calendar cells receive a visible spectral march marker');
assert.match(source, /cell\.addEventListener\('click'/, 'clicking a marked calendar day reveals its route details');
assert.match(source, /Harlyao Night March · \$\{route\.label \|\| route\.zoneId\} · \$\{directionText\(route\)\}/, 'clicked detail names both the wilderness zone and march direction');
assert.match(source, /MutationObserver/, 'month navigation automatically redecorates replacement Calendar rows');
assert.match(source, /config\?\.routesClockwise/, 'calendar schedule uses the same authored route list as the runtime');
assert.doesNotMatch(source, /setInterval\(/, 'calendar markers do not add a polling loop');
new vm.Script(source, { filename: 'harlyao-night-march-calendar.js' });

(async () => {
  const context = {
    console,
    queueMicrotask,
    fetch: async () => ({ ok: true, json: async () => config }),
    MutationObserver: class { observe() {} },
    document: {
      getElementById: () => null,
      querySelectorAll: () => [],
      head: null,
      body: null,
    },
    window: {
      addEventListener: () => {},
      __farmLog: () => {},
    },
  };
  vm.runInNewContext(source, context, { filename: 'harlyao-night-march-calendar.js' });
  await new Promise(resolve => setImmediate(resolve));
  const api = context.window.HarlyaoNightMarchCalendar;
  assert(api, 'calendar decorator exposes diagnostics and the pure daily route resolver');
  assert.equal(api.routeForDay(1).zoneId, 'map_northern_cliffs');
  assert.equal(api.routeForDay(2).zoneId, 'map_eastern_mire');
  assert.equal(api.routeForDay(3).zoneId, 'map_southern_cloud_forest');
  assert.equal(api.routeForDay(4).zoneId, 'map_western_slope');
  assert.equal(api.routeForDay(5).zoneId, 'map_northern_cliffs', 'calendar repeats the same four-day clockwise route cycle as the live march');
  assert.equal(api.__test.directionText(config.routesClockwise[0]), 'west → east');
  assert.equal(api.__test.directionText(config.routesClockwise[2]), 'east → west');
  console.log('Harlyao calendar marker checks passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

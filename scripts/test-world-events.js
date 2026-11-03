#!/usr/bin/env node
'use strict';
const assert = require('assert');
const WE = require('../docs/js/world-events.js');

// delivery, scope and filter
const got = [];
const off = WE.on('blast', p => got.push(['all', p.x]));
WE.on('blast', p => got.push(['scoped', p.x]), { scope: 'mapA' });
WE.on('blast', p => got.push(['near', p.x]), { filter: p => p.x < 5 });
assert.equal(WE.emit('blast', { scope: 'mapA', x: 3 }), 3);
assert.equal(WE.emit('blast', { scope: 'mapB', x: 9 }), 1, 'scoped listener ignores other maps; filter rejects x >= 5');
assert.deepEqual(got.map(g => g.join(':')), ['all:3', 'scoped:3', 'near:3', 'all:9']);

// unsubscribe, once, self-unsubscribe during dispatch
off();
assert.equal(WE.emit('blast', { scope: 'mapB', x: 1 }), 1, 'only the filtered listener remains for x=1');
let n = 0;
WE.on('struck', () => n++, { once: true });
WE.emit('struck', { scope: 'm' }); WE.emit('struck', { scope: 'm' });
assert.equal(n, 1, 'once fires once');
let selfOff; let calls = 0;
selfOff = WE.on('struck', () => { calls++; selfOff(); });
const other = []; WE.on('struck', () => other.push(1));
WE.emit('struck', { scope: 'm' }); WE.emit('struck', { scope: 'm' });
assert.equal(calls, 1); assert.equal(other.length, 2, 'unsubscribing mid-dispatch does not skip other listeners');

// a throwing listener is isolated
const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
const safe = []; WE.on('boom', () => { throw new Error('x'); }); WE.on('boom', () => safe.push(1));
assert.equal(WE.emit('boom', {}), 1); console.warn = warn;
assert.equal(warned, 1); assert.deepEqual(safe, [1], 'later listeners still run');

// no listeners is cheap and harmless
assert.equal(WE.emit('nobody', { scope: 'm' }), 0);
assert.equal(WE.listenerCount('nobody'), 0);

// debug ring keeps only the most recent events, oldest first
WE.clear();
for (let i = 0; i < 40; i++) WE.emit('t' + i, { scope: 's' });
const recent = WE.recent();
assert.equal(recent.length, 32); assert.equal(recent[0].type, 't8'); assert.equal(recent[31].type, 't39');
assert.equal(WE.debugSnapshot().emitted, 40);
assert.equal(WE.TYPES.BLAST, 'blast'); assert.equal(WE.TYPES.STRUCK, 'struck');
console.log('world-events: ok');

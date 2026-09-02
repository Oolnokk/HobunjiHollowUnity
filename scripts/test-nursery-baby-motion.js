const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('docs/js/farm-buildings.js', 'utf8');

assert.match(source, /BABY_SPEED_MULTIPLIER\s*=\s*1\.5/, 'Nursery babies move 50% faster than the first swarm tuning');
assert.match(source, /-Math\.atan2\(vz, vx\) \+ Math\.PI \/ 2/, 'Nursery baby facing uses the same forward-motion convention as adult livestock');
assert.match(source, /\['idle', 'run1', 'run2'\]/, 'Nursery babies precompose the normal livestock movement frames');
assert.match(source, /updateHeadRotation\(pitchDeg, dt\)/, 'Nursery babies use the authored animal head rig to track player head height');
assert.match(source, /getPlayerFaceTarget/, 'Nursery head tracking targets the existing player face point rather than the player feet');
assert.match(source, /TURN_MIN_SEC\s*=\s*0\.12/, 'hyper babies can change direction several times per second');
assert.match(source, /HOP_MIN_HZ\s*=\s*3\.2/, 'hyper baby motion includes rapid hopping');
assert.match(source, /Math\.abs\(Math\.sin\(agent\.hopPhase\)\)/, 'hop motion repeatedly returns to the floor rather than floating');
assert.match(source, /buildAnimalPlaneAvatarModel/, 'Nursery babies use the rigged animal-plane avatar path');
assert.match(source, /hideLegacyFlatBabies/, 'the superseded flat Nursery stand-ins are hidden when rigged babies are active');

console.log('Nursery hyper baby motion regression tests passed');

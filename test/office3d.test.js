/* node test/office3d.test.js — the 3D office's pure core (frontend/app/office3d.js).
   A real ZAK HOLDING station becomes a tower: HQ on the ground floor, one floor per lab, every crew member on the
   floor of the room their desk is in, with the title the preset wrote. Plus the page wiring: three.js is served
   locally (the desktop CSP allows no CDN) and loads before the view. */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');
const O = require('../frontend/app/office3d.js');
const C = require('../frontend/app/presetcrews.js');
const T = require('../frontend/app/stationtemplates.js');
const M = require('../frontend/app/worldmodel.js');
const P = require('../frontend/app/propsprites.js');

// titles
A.eq(O.titleOf({ docs: { identity: 'You are ORION, E-Commerce Director in the E-Commerce Lab at Zak Holding.' } }), 'E-Commerce Director', 'title from the preset identity');
A.eq(O.titleOf({ specialtyId: 'scout', docs: {} }, id => (id === 'scout' ? { name: 'Scout' } : null)), 'Scout', 'title falls back to the class name');
A.eq(O.titleOf({ id: 'agent', role: 'orchestrator' }), 'Overseer', 'the hero is the Overseer');
A.eq(O.titleOf({ id: 'x', role: 'specialist' }), 'Specialist', 'an unclassed crew member is a Specialist');

// tints follow the lab, with a palette fallback
A.eq(O.tintFor('E-COMMERCE', 1), '#FF8A3D', 'e-commerce is orange');
A.eq(O.tintFor('A DESIGN', 4), '#A78BFA', 'design is violet');
A.ok(/^#[0-9A-F]{6}$/i.test(O.tintFor('HAB-03', 7)), 'any other room gets a palette colour');

// a real ZAK HOLDING station, its crew seated the way seedCrew seats them (a free desk in the named room)
const crew = C.get('zakholding');
const doc = T.build('zakholding', M, P, 1000), s = M.create(doc);
const rooms = s.rooms();
const roster = [{ id: 'agent', name: 'OVERSEER', role: 'orchestrator' }];
const used = new Set();
crew.members.forEach((m, i) => {
  const id = 'crew' + i;
  roster.push({ id, name: m.agentName, role: 'specialist', specialtyId: m.cls, docs: C.docsFor(crew, m) });
  const room = rooms.find(r => r.name === m.room);
  const inRoom = p => room.rects.some(r => p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2);
  const desk = s.props().find(p => p.t === 'desk' && inRoom(p) && !used.has(p.id));
  used.add(desk.id); s.assignPropAgent(desk.id, id);
});
const roomOf = id => { for (const p of s.propsByAgent(id)) { const r = s.roomAt(p.x, p.y); if (r != null) return r; } return null; };
const floors = O.plan(rooms, roster, roomOf, { spawnRoomId: s.spawnRoomId() });

A.eq(floors.length, rooms.filter(r => r.kind !== 'corridor').length, 'one floor per room (corridors are not floors)');
A.ok(floors[0].ground && floors[0].id === s.spawnRoomId(), 'the spawn room is the ground floor');
A.ok(floors[0].agents.some(a => a.id === 'agent' && a.title === 'Overseer'), 'the Overseer works on the ground floor');
for (const lab of ['E-COMMERCE', 'YOUTUBE', 'REAL ESTATE', 'A DESIGN']) {
  const f = floors.find(x => x.name === lab);
  A.ok(f, lab + ' is a floor');
  const want = crew.members.filter(m => m.room === lab).map(m => m.agentName).sort();
  A.eq(f.agents.map(a => a.name).sort(), want, lab + ': its own crew sits on it');
}
const orion = floors.flatMap(f => f.agents).find(a => a.name === 'ORION');
A.eq(orion.title, 'E-Commerce Director', 'ORION carries his title');
A.eq(floors.flatMap(f => f.agents).length, roster.length, 'everyone has a floor, nobody twice');

// the signature changes only when the floors or the people change
const again = O.plan(rooms, roster, roomOf, { spawnRoomId: s.spawnRoomId() });
A.eq(O.signature(again), O.signature(floors), 'same station, same signature');
const renamed = O.plan(rooms, roster.map(a => (a.name === 'VEGA' ? Object.assign({}, a, { name: 'NOVA' }) : a)), roomOf, { spawnRoomId: s.spawnRoomId() });
A.ok(O.signature(renamed) !== O.signature(floors), 'a rename rebuilds the tower');

// an empty station still has a ground floor for the Overseer
const bare = O.plan([], [{ id: 'agent', name: 'OVERSEER' }], () => null, {});
A.ok(bare.length === 1 && bare[0].agents.length === 1, 'no rooms: one ground floor, the Overseer on it');

// page wiring: three.js is local, loads before the view, and the view loads after livewatch.js
const html = fs.readFileSync(path.join(__dirname, '../frontend/index.html'), 'utf8');
const iThree = html.indexOf('src="js/vendor/three.r128.min.js"'), iOrbit = html.indexOf('src="js/vendor/three.orbitcontrols.r128.js"');
const iView = html.indexOf('src="app/office3d.js"'), iLive = html.indexOf('src="app/livewatch.js"');
A.ok(iThree > 0 && iOrbit > iThree && iView > iOrbit && iLive > 0 && iLive < iView, 'three.js, then OrbitControls, then the view, after livewatch.js');
A.ok(!/https?:\/\/[^"']*three/i.test(html), 'three.js is never fetched from a CDN');
A.ok(fs.existsSync(path.join(__dirname, '../frontend/js/vendor/three.LICENSE')), 'the three.js licence ships with it');
const src = fs.readFileSync(path.join(__dirname, '../frontend/app/office3d.js'), 'utf8');
A.ok(!/U\.bus\.emit|\.emit\(/.test(src), 'the view never emits on the bus');

A.report('office3d.test');

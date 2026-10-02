/* node test/preset-crews.test.js — the ZAK HOLDING crew preset (frontend/app/presetcrews.js + stationtemplates.js).
   Every member is a real class, has a desk in a room the layout actually builds, and every routine is a valid
   schedule the cron guard accepts, chained only to routines defined before it. */
'use strict';
const A = require('./_assert.js');
const C = require('../frontend/app/presetcrews.js');
const T = require('../frontend/app/stationtemplates.js');
const M = require('../frontend/app/worldmodel.js');
const P = require('../frontend/app/propsprites.js');
const S = require('../shared/specialties.js');
const cron = require('../sidecar/cron.js');
const guard = require('../sidecar/cron-guard.js');

const crew = C.get('zakholding');
A.ok(crew, 'Zak Holding has a crew');
A.ok(T.catalog.some(e => e.id === 'zakholding' && e.crew === true), 'the preset is listed and marked as hiring a crew');
const classes = new Set(S.BUILTINS.concat(S.ARCHETYPES || []).map(x => x.id));
A.eq(C.issues(crew, id => classes.has(id)), [], 'no duplicate names, unknown classes or broken routine chains');
A.eq(crew.members.length, 18, '18 agents');

const doc = T.build('zakholding', M, P, 1000), s = M.create(doc);
const rooms = s.rooms();
for (const lab of ['E-COMMERCE LAB', 'YOUTUBE LAB', 'REAL ESTATE LAB', 'A DESIGN LAB']) {
  const room = rooms.find(r => r.name === lab);
  A.ok(room, lab + ' is built with its name on the room');
  const inRoom = p => room.rects.some(r => p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2);
  const desks = s.props().filter(p => p.t === 'desk' && inRoom(p)).length;
  const staff = crew.members.filter(m => m.room === lab).length;
  A.ok(staff > 0 && desks >= staff, lab + ': a desk for each of its ' + staff + ' agents (' + desks + ' desks)');
}

for (const r of crew.routines) {
  A.ok(cron.parseSchedule(r.schedule, Date.now(), { tz: 'Europe/Paris' }), r.name + ': valid schedule');
  const scan = guard.scanRoutinePrompt(C.routinePrompt(r));
  A.ok(scan.ok, r.name + ': passes the routine prompt guard');
  A.ok(C.routinePrompt(r).includes(C.RULES), r.name + ': carries the house rules');
}
A.ok(!crew.routines.some(r => crew.members.find(m => m.agentName === r.by).room === 'A DESIGN LAB'), 'A Design Lab has no routines: it works only when asked');

const d = C.docsFor(crew, crew.members[0]);
A.ok(/^You are ORION, E-Commerce Director in the E-Commerce Lab at Zak Holding\.$/.test(d.identity), 'identity names the title and lab');
A.ok(d.manual === C.RULES && d.purpose.length > 20, 'mission and house rules are written');

A.report('preset-crews.test');

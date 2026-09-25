/* node test/trigger-sweep.test.js — LINE TRIGGER runner fixes from the conveyor sweep (2026-09-25), headless.

   Each block locks one defect the stranded-user sweep / the parallel review found:
     1. deleting a trigger MID-FIRE keeps its in-flight run reachable by E-STOP (inflights()) until the fire settles. */
'use strict';
const A = require('./_assert.js');
const T = require('../sidecar/routing/triggers.js');
const { makeTriggerRunner } = require('../sidecar/routing/trigger-runner.js');

const tick = (ms) => new Promise(r => setTimeout(r, ms || 10));

/* a controllable fake hub: each onInbound parks until release() — while parked, its run sits in _internals.inflight
   exactly like the real channel hub's record (what halt.js killAll aborts) */
function harness(opts) {
  opts = opts || {};
  let clock = 1e12, n = 0;
  const disk = { triggers: { triggers: [] }, seen: {} };
  const plan = opts.plan || { lines: [{ lineId: 'L1' }], reach: { 'agent-a': true }, lineOfAgent: { 'agent-a': 'L1' } };
  const parked = [];
  const hubs = [];
  let closed = 0;
  function fakeHub(hooks) {
    const inflight = new Map();
    const hub = {
      _internals: { inflight },
      onInbound(msg) {
        const routed = hooks.onRouted({ agentId: 'agent-a', dockId: 'b1' });
        hooks.onResolved({ chatId: msg.chatId, agentId: routed.agentId, isTask: true, lineId: 'L1', dockId: 'b1' });
        const sid = hooks.streamId();
        const rec = { runId: 'run-' + (++n), abort: { abort() { rec.aborted = true; } }, superseded: false, halted: false };
        inflight.set(msg.chatId, rec);
        return new Promise(res => parked.push(() => { inflight.delete(msg.chatId); runs[sid] = [{ runId: rec.runId, agentId: 'agent-a', reason: 'done', usd: 0.01, streamId: sid }]; hooks.onLineOutcome({ agentId: 'agent-a', dockId: 'b1', stopped: null }); res(); }));
      },
      close() { closed++; }
    };
    hubs.push(hub);
    return hub;
  }
  const runs = {};
  const R = makeTriggerRunner({
    load: () => JSON.parse(JSON.stringify(disk.triggers)), save: v => { disk.triggers = JSON.parse(JSON.stringify(v)); },
    seen: { load: () => JSON.parse(JSON.stringify(disk.seen)), save: v => { disk.seen = JSON.parse(JSON.stringify(v)); } },
    makeHub: fakeHub, plan: () => plan, shipsToOutbox: () => true, dayCap: opts.dayCap || (() => ({ cap: null, spent: 0 })),
    halted: opts.halted || (() => false),
    runsFor: sid => runs[sid] || [], emit: () => {},
    watcher: opts.watcher || null,
    now: () => clock, newId: () => 'id' + (++n) + 'abcdef0123456789'
  });
  return { R, disk, plan, parked, hubs, closedCount: () => closed, advance: ms => { clock += ms; }, now: () => clock };
}

(async () => {
  /* ---- 1. delete mid-fire: the run stays reachable by E-STOP until it settles ---- */
  {
    const H = harness();
    const c = H.R.create({ kind: 'webhook', lineId: 'L1', maxPerHour: 10 }, { secretHash: T.hashSecret('k') });
    const id = c.trigger.id;
    A.ok(H.R.enqueue(id, { text: 'job' }).ok, 'a fire is admitted');
    await tick();
    A.eq(H.parked.length, 1, 'the fire is in flight (parked in the hub)');
    const before = H.R.inflights();
    A.ok(before.length === 1 && before[0].size === 1, 'E-STOP can see the in-flight run before the delete');
    A.ok(H.R.remove(id).ok, 'the trigger is deleted while its fire runs');
    const during = H.R.inflights();
    A.ok(during.length === 1 && during[0].size === 1, 'AFTER the delete the in-flight run is still reachable by E-STOP');
    A.eq(H.closedCount(), 0, 'the hub is not closed under a live run');
    A.eq(H.R.list().length, 0, 'the deleted trigger is gone from the list at once');
    H.parked[0]();
    await tick(20);
    A.eq(H.R.inflights().length, 0, 'once the fire settles the deleted trigger\'s state is retired');
    A.eq(H.closedCount(), 1, 'and its hub is closed');
  }
  {
    const H = harness();
    const c = H.R.create({ kind: 'webhook', lineId: 'L1', maxPerHour: 10 }, { secretHash: T.hashSecret('k') });
    A.ok(H.R.remove(c.trigger.id).ok, 'an idle trigger deletes');
    A.eq(H.R.inflights().length, 0, 'an idle deleted trigger leaves nothing behind');
  }

  /* ---- 3. a folder inside a line's working folder is refused (create AND every fire) ---- */
  {
    const fs = require('fs'), fsp = require('fs/promises'), os = require('os'), path = require('path');
    const { makeFolderPolicy, lineOutputError } = require('../sidecar/routing/trigger-folder.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-trg-sweep-'));
    const home = path.join(root, 'home');
    const project = path.join(home, 'proj'); fs.mkdirSync(path.join(project, 'drops'), { recursive: true });
    const elsewhere = path.join(home, 'inbox'); fs.mkdirSync(elsewhere, { recursive: true });
    let lineRoots = [project];
    const policy = makeFolderPolicy({ fsp, pathMod: path, winish: path.sep === '\\', homeRoots: () => [home], blessedRoots: () => [project],
      forbiddenRoots: () => [], systemRoots: () => [], lineRoots: () => lineRoots });
    const inProj = await policy.check(project);
    A.ok(!inProj.ok && inProj.code === 'lineoutput', 'the line\'s own working folder is refused: ' + JSON.stringify(inProj));
    const sub = await policy.check(path.join(project, 'drops'));
    A.ok(!sub.ok && sub.code === 'lineoutput' && /feed on its own output/.test(sub.error), 'a folder INSIDE it is refused with the reason');
    A.ok((await policy.check(elsewhere)).ok, 'a folder outside every line\'s working folder is allowed');
    lineRoots = null;
    const pol2 = makeFolderPolicy({ fsp, pathMod: path, homeRoots: () => [home], forbiddenRoots: () => [], systemRoots: () => [], lineRoots: () => { throw new Error('plan unreadable'); } });
    A.ok(!(await pol2.check(elsewhere)).ok, 'an unreadable line list fails CLOSED');

    // the runner re-asks at every fire: a line whose project later moves over the folder blocks the trigger
    let conflict = null;
    const H = harness();
    const H2 = { R: require('../sidecar/routing/trigger-runner.js').makeTriggerRunner({
      load: () => ({ triggers: [] }), save: () => {}, makeHub: () => ({ onInbound: () => Promise.resolve(), close() {} }),
      plan: () => H.plan, now: () => 1e12, newId: () => 'fixed0123456789abcdef', folderConflict: () => conflict }) };
    const cf = H2.R.create({ kind: 'folder', lineId: 'L1', config: { path: elsewhere } }, { baselineKeys: [] });
    A.ok(cf.ok && cf.trigger.blockedBy === null, 'a folder trigger with no conflict is not blocked');
    conflict = lineOutputError(elsewhere);
    A.ok(/feed on its own output/.test(H2.R.view(cf.trigger.id).blockedBy || ''), 'once a line works in that folder the trigger shows blockedBy');
    const e = H2.R.enqueue(cf.trigger.id, { text: 'x' });
    A.ok(!e.ok && e.code === 'refused', 'and a file landing there is refused, not fired');
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }

  A.report('trigger-sweep.test');
})().catch(e => { console.log('FAIL: trigger-sweep.test threw - ' + (e && e.stack || e)); process.exit(1); });

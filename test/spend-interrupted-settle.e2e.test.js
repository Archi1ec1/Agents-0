/* node test/spend-interrupted-settle.e2e.test.js — a crash mid-run no longer bricks spending once a cap governs.
   The \$25/day rail ships ON (runaway breaker). A run killed mid-flight leaves a durable spend receipt; before this
   fix the ledger refused to load ("unsettled spend"), /api/budget/status reported the day pool as unknown, and every
   later paid run was refused with spend_history_unavailable — with no in-app way to reconcile. Boot now settles:
     - a receipt carrying bookedUsd -> a ledger row at that amount, flagged spendLowerBound + interrupted;
     - a legacy receipt (no bookedUsd) -> a \$0 row flagged spendUnknown + interrupted (never bricks the station).
   Real sidecar via the isolated fixture; receipts seeded exactly as ledgerIo.beginRun writes them. */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');

const receiptFile = (dir, runId) => path.join(dir, crypto.createHash('sha256').update(String(runId)).digest('hex') + '.json');

(async () => {
  const fixture = SidecarFixture.create({ prefix: 'starnet-spend-settle-', timeoutMs: 30000 });
  try {
    const pendingDir = path.join(fixture.workspace, '.spend-pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    const now = Date.now();
    fs.writeFileSync(receiptFile(pendingDir, 'crashed-run'), JSON.stringify({ runId: 'crashed-run', agentId: 'agent', ts: now - 60000, bookedUsd: 0.42 }));
    fs.writeFileSync(receiptFile(pendingDir, 'legacy-run'), JSON.stringify({ runId: 'legacy-run', agentId: 'agent', ts: now - 120000 }));

    await fixture.start();
    const status = await fixture.json('GET', '/api/budget/status');
    A.eq(status.status, 200, 'budget status serves');
    const acct = status.body.accounting || {};
    A.eq(acct.complete, true, 'spend history is complete after boot settled the interrupted receipts');
    A.eq(acct.durable, true, 'and durable');
    A.ok(status.body.day && typeof status.body.day.usd === 'number', 'the day pool is a known number (not null/unknown)');
    A.ok(status.body.day && Math.abs(status.body.day.usd - 0.42) < 1e-9, "today's spend includes the interrupted run's booked lower bound (0.42)");
    A.ok(status.body.day && status.body.day.cap === 25, 'the shipped $25/day rail governs');

    const rows = fs.readFileSync(path.join(fixture.workspace, 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const crashed = rows.find(r => r.runId === 'crashed-run');
    const legacy = rows.find(r => r.runId === 'legacy-run');
    A.ok(crashed && crashed.usd === 0.42 && crashed.spendLowerBound === true && crashed.interrupted === true, 'the booked receipt settles as a flagged lower-bound row');
    A.ok(legacy && legacy.usd === 0 && legacy.spendUnknown === true && legacy.interrupted === true, 'a legacy receipt settles as a flagged spend-unknown row');
    A.eq(fs.readdirSync(pendingDir).filter(n => n.endsWith('.json')).length, 0, 'no unsettled receipt remains');

    // idempotent across restarts: settlement rows are not appended twice
    await fixture.restart();
    const rows2 = fs.readFileSync(path.join(fixture.workspace, 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    A.eq(rows2.filter(r => r.runId === 'crashed-run').length, 1, 'a second boot does not settle the run twice');
    const status2 = await fixture.json('GET', '/api/budget/status');
    A.eq((status2.body.accounting || {}).complete, true, 'history stays complete after restart');
  } finally {
    await fixture.stop();
  }
  A.report('spend-interrupted-settle.e2e.test');
})().catch(e => { console.log('FAIL: spend-interrupted-settle.e2e.test threw -- ' + (e && e.stack || e)); process.exit(1); });

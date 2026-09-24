/* node test/ledger.interrupted-receipt.test.js — a run's durable spend receipt carries what it has BOOKED so far.
   With the \$25/day rail shipping ON, a crash used to leave a receipt that only said "a run began": the ledger then
   refused to load and every capped run was refused (spend_history_unavailable) with no in-app way out. The receipt
   now records the booked spend, rewritten whenever it grows materially, so boot can settle an interrupted run at a
   flagged lower bound (sidecar/index.js ledgerIo.readAll). Pure: injected io + clock. */
'use strict';
const A = require('./_assert.js');
const { makeLedger } = require('../sidecar/ledger.js');

function harness(opts) {
  const writes = [];
  let t = 1000;
  const io = {
    readAll() { return []; },
    append() {},
    beginRun(r) { if (opts && opts.failBegin) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); writes.push(Object.assign({}, r)); },
    finishRun() {}
  };
  const ledger = makeLedger({ io, clock: { now: () => (t += 1000) } });
  return { ledger, writes };
}

// 1. first check writes a receipt with the booked amount (0 before any paid call)
{
  const { ledger, writes } = harness();
  A.eq(ledger.beginRun('r1', 'a', 0), true, 'first receipt written');
  A.eq(writes.length, 1, 'one durable write');
  A.eq(writes[0].bookedUsd, 0, 'the receipt carries the booked spend (none yet)');
  A.eq(writes[0].runId, 'r1', 'the receipt names the run');
  // 2. growth rewrites the receipt; a sub-threshold change does not
  ledger.beginRun('r1', 'a', 0.0002);
  A.eq(writes.length, 1, 'a sub-cent-fraction change does not rewrite the receipt');
  ledger.beginRun('r1', 'a', 0.0125);
  A.eq(writes.length, 2, 'material growth rewrites the receipt');
  A.eq(writes[1].bookedUsd, 0.0125, 'the rewrite carries the new lower bound');
  A.ok(writes[1].ts > writes[0].ts, 'the rewrite is stamped at the latest booking');
  ledger.beginRun('r1', 'a', 0.0125);
  A.eq(writes.length, 2, 'an unchanged amount does not rewrite');
  // 3. settling the run clears its tracking: a later run with the same id starts fresh
  ledger.record({ runId: 'r1', agentId: 'a', usd: 0.02, turns: 2 });
  ledger.beginRun('r1', 'a', 0);
  A.eq(writes.length, 3, 'after settlement the run id is no longer pending');
}

// 4. a failed receipt write marks the ledger non-durable (the governor refuses capped runs honestly)
{
  const { ledger } = harness({ failBegin: true });
  A.eq(ledger.beginRun('r2', 'a', 0.5), false, 'a failed receipt write is reported');
  A.eq(ledger.health().durable, false, 'and the ledger is no longer durable');
}

// 5. negative / non-numeric amounts clamp to 0 (never a negative lower bound)
{
  const { ledger, writes } = harness();
  ledger.beginRun('r3', 'a', -4);
  A.eq(writes[0].bookedUsd, 0, 'negative booked spend clamps to 0');
  const { ledger: l2, writes: w2 } = harness();
  l2.beginRun('r4', 'a', 'x');
  A.eq(w2[0].bookedUsd, 0, 'non-numeric booked spend clamps to 0');
}

A.report('ledger.interrupted-receipt.test');

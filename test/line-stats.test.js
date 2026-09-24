/* node test/line-stats.test.js — LINE WATCH per-line stats fold (sidecar/routing/line-stats.js) + the run-row
   stamp it depends on (runstore records lineId/dockId only when present and well-formed).
   Laws under test: numbers come ONLY from rows stamped with the line; "shipped" is the station SHIPPED predicate
   (done + proven work); failed is the dead-run set; a line with no runs answers zeros (never absent, never a guess);
   the $ ledger + cap are read through the injected readers; each bay's LAST outcome is its newest row. */
'use strict';
const A = require('./_assert.js');
const { lineStats, median, shippedRow, failedRow, FAILED_REASONS } = require('../sidecar/routing/line-stats.js');

// ---- median ----
A.eq(median([]), null, 'median of nothing is null (no fabricated time)');
A.eq(median([3000]), 3000, 'median of one');
A.eq(median([4000, 1000, 2000]), 2000, 'median of odd count (unsorted input)');
A.eq(median([1000, 2000, 3000, 4000]), 2500, 'median of even count = mean of the middle two');

// ---- predicates ----
A.ok(shippedRow({ reason: 'done', toolsOk: 1 }), 'done + a successful tool = shipped');
A.ok(shippedRow({ reason: 'done', artifacts: [{ kind: 'file' }] }), 'done + an artifact = shipped');
A.ok(!shippedRow({ reason: 'done', toolsOk: 0, artifacts: [] }), 'done with no proven work is NOT shipped (crate honesty)');
A.ok(!shippedRow({ reason: 'error', toolsOk: 3 }), 'a failed run never ships');
for (const r of ['error', 'refusal', 'max_iters', 'budget']) A.ok(failedRow({ reason: r }), r + ' is a failure');
for (const r of ['done', 'cancelled', 'clarifying', 'empty', 'interrupted']) A.ok(!failedRow({ reason: r }), r + ' is not counted as failed');
A.eq(FAILED_REASONS.slice().sort(), ['budget', 'error', 'max_iters', 'refusal'], 'the dead-run set is the slag set');

// ---- the fold ----
const SINCE = 1000;
const rows = [   // NEWEST-FIRST, like runStore.list
  { runId: 'r9', agentId: 'ada', lineId: 'L1', dockId: 'bC', reason: 'error', toolsOk: 0, durationMs: 900, ts: 9000 },
  { runId: 'r8', agentId: 'mira', lineId: 'L1', dockId: 'bB', reason: 'done', toolsOk: 2, durationMs: 3000, ts: 8000 },
  { runId: 'r7', agentId: 'quill', lineId: 'L1', dockId: 'bA', reason: 'done', toolsOk: 0, durationMs: 1000, ts: 7000 },
  { runId: 'r6', agentId: 'zed', lineId: 'L2', dockId: 'bZ', reason: 'refusal', durationMs: 0, ts: 6000 },
  { runId: 'r5', agentId: 'quill', reason: 'done', toolsOk: 4, durationMs: 5000, ts: 5000 },                   // no line: a direct order
  { runId: 'r4', agentId: 'old', lineId: 'GONE', dockId: 'bX', reason: 'done', toolsOk: 1, ts: 4000 },       // a line no longer on the floor
  { runId: 'r3', agentId: 'ada', lineId: 'L1', dockId: 'bC', reason: 'done', toolsOk: 1, durationMs: 2000, ts: 900 },   // BEFORE since
  null, 'garbage', { lineId: 'L1' }                                                                          // unreadable rows are skipped
];
const spend = { L1: 0.0125, L2: 0 };
const caps = { L1: 5, L2: null };
const out = lineStats({ rows, lines: [{ lineId: 'L1' }, { lineId: 'L2' }, { lineId: 'L3' }], since: SINCE,
  spentToday: id => spend[id] || 0, capOf: id => caps[id] == null ? null : caps[id] });
const L = id => out.lines.find(l => l.lineId === id);
A.eq(out.since, SINCE, 'answers the window it folded');
A.eq(out.spendDay, 'utc', 'says the $ ledger keeps the UTC day');
A.eq(out.lines.map(l => l.lineId), ['L1', 'L2', 'L3'], 'one entry per plan line, in plan order');
A.eq(L('L1').runs, 3, 'L1: only its stamped rows since the window (the pre-window row is excluded)');
A.eq(L('L1').shipped, 1, 'L1: only done + proven work ships');
A.eq(L('L1').failed, 1, 'L1: the error run is failed');
A.eq(L('L1').medianMs, 1000, 'L1: median of 900/3000/1000');
A.eq(L('L1').usdToday, 0.0125, 'L1: $ today from the ledger reader');
A.eq(L('L1').capUsdPerDay, 5, 'L1: the daily cap from the limits reader');
A.eq(L('L2'), { lineId: 'L2', runs: 1, shipped: 0, failed: 1, medianMs: null, usdToday: 0, capUsdPerDay: null }, 'L2: a refusal with no timing -> median null, no cap');
A.eq(L('L3'), { lineId: 'L3', runs: 0, shipped: 0, failed: 0, medianMs: null, usdToday: 0, capUsdPerDay: null }, 'L3: a line with no runs answers zeros');
A.ok(!out.lines.some(l => l.lineId === 'GONE'), 'a line no longer on the floor gets no plate');
// the bays' LAST outcome = newest stamped row (any day)
A.eq(out.docks.bC, { runId: 'r9', agentId: 'ada', reason: 'error', failed: true, ts: 9000 }, 'bay C: the newest row (the failure) wins over the older success');
A.eq(out.docks.bA.failed, false, 'bay A: last run done');
A.eq(out.docks.bX.runId, 'r4', 'a bay\'s last outcome is kept even for an old line (the lamp checks the bay is still bound)');
A.ok(!('undefined' in out.docks), 'rows without a dock never key a bay');

// ---- readers that throw degrade to "cannot prove", never to a crash ----
const safe = lineStats({ rows: [], lines: [{ lineId: 'L1' }], since: 0, spentToday: () => { throw new Error('x'); }, capOf: () => { throw new Error('y'); } });
A.eq(safe.lines[0], { lineId: 'L1', runs: 0, shipped: 0, failed: 0, medianMs: null, usdToday: 0, capUsdPerDay: null }, 'throwing readers -> zero $ and no cap');
A.eq(lineStats(null).lines, [], 'no input -> no lines');

// ---- the run-row stamp (runstore): present only when well-formed ----
const { makeRunStore } = require('../sidecar/runstore.js');
const store = makeRunStore({ io: { readAll: () => [], append: () => {} }, clock: { now: () => 1 } });
if (store && store.record) {
  const a = store.record({ runId: 'x1', agentId: 'quill', reason: 'done', lineId: 'p18', dockId: 'p19' });
  A.eq([a.lineId, a.dockId], ['p18', 'p19'], 'a dispatched run records its line + bay');
  const b = store.record({ runId: 'x2', agentId: 'quill', reason: 'done' });
  A.ok(!('lineId' in b) && !('dockId' in b), 'a run with no line/bay keeps the old row shape');
  const c = store.record({ runId: 'x3', agentId: 'quill', reason: 'done', lineId: '../etc', dockId: '' });
  A.ok(!('lineId' in c) && !('dockId' in c), 'a malformed id is never recorded');
} else {
  A.ok(false, 'runstore exposes makeRunStore().record');
}

A.report();

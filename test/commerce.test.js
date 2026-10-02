'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const M = require('../sidecar/commerce/model.js');
const { makeCommerceStore } = require('../sidecar/commerce/store.js');
const { demoEvent } = require('../sidecar/commerce/demo.js');
const { writeFileDurable } = require('../sidecar/durable-write.js');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'commerce-test-'));
const now = () => '2026-10-02T12:00:00.000Z';
let assertions = 0;
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions++; }
function make(name, extra = {}) {
  return makeCommerceStore({ fs, path, directory: path.join(scratch, name), mode: 'demo', now, ...extra });
}
const event = (step, eventId = step) => demoEvent({ eventId, step });

(async () => {
  const store = make('lifecycle');
  eq(store.getSnapshot().orders, [], 'viewing demo does not create orders');
  eq(fs.existsSync(path.join(scratch, 'lifecycle')), false, 'GET-style snapshot is read-only');
  await store.ingest(event('paid'));
  let snapshot = store.getSnapshot();
  eq(snapshot.orders.length, 1);
  eq(snapshot.orders[0].fulfillmentOwner, 'supplier_native');
  eq(snapshot.financials.byCurrency[0].contributionMinor, null, 'unknown fees do not become invented profit');
  eq(snapshot.financials.byCurrency[0].completeness, 'incomplete');
  eq(snapshot.capabilities.submitFulfillment, false, 'ledger cannot issue a supplier order');

  // Concurrent notifications through independent instances share a file mutex.
  const duplicate = await Promise.all(Array.from({ length: 12 }, () => make('lifecycle').ingest(event('paid'))));
  eq(duplicate.every(result => result.duplicate), true);
  eq(store.getSnapshot().orders.length, 1);
  eq(store.getSnapshot().actions.length, 1);
  const firstRace = await Promise.all(Array.from({ length: 8 }, () => make('first-race').ingest(event('paid'))));
  eq(firstRace.filter(result => !result.duplicate).length, 1, 'exactly one concurrent first delivery commits');
  const manyOrders = await Promise.all(Array.from({ length: 8 }, (_, index) => {
    const input = event('paid', 'parallel-' + index); input.orderId = 'order-' + index;
    input.payload.channelOrderId = 'receipt-' + index;
    return make('parallel-orders').ingest(input);
  }));
  eq(manyOrders.length, 8);
  eq(make('parallel-orders').getSnapshot().orders.length, 8, 'concurrent independent orders are not lost');
  await assert.rejects(store.ingest({ ...event('paid'), payload: { ...event('paid').payload, itemCount: 2 } }), { code: 'ECOMMERCE_EVENT_CONFLICT' }); assertions++;
  await store.ingest(event('payment_failed'));
  eq(store.getSnapshot().exceptions.filter(e => e.status === 'open').map(e => e.type), ['supplier_payment_failed']);
  eq(store.getSnapshot().orders[0].paymentStatus, 'paid', 'supplier billing failure does not undo customer payment');
  const restarted = make('lifecycle');
  eq(restarted.getSnapshot().orders[0].fulfillmentStatus, 'failed', 'restart retains progress');
  eq((await restarted.ingest(event('payment_failed'))).duplicate, true, 'restart retains event receipts');
  await restarted.ingest(event('processing'));
  eq(restarted.getSnapshot().exceptions[0].status, 'resolved', 'verified later supplier state resolves payment exception');
  await restarted.ingest(event('tracking_missing'));
  eq(restarted.getSnapshot().exceptions.filter(e => e.status === 'open').map(e => e.type), ['tracking_missing']);
  await restarted.ingest(event('shipped'));
  await restarted.ingest(event('delivered'));
  eq(restarted.getSnapshot().orders[0].fulfillmentStatus, 'delivered');
  eq((await restarted.ingest(event('payment_failed', 'late-failure'))).outcome, 'ignored_stale');
  eq(restarted.getSnapshot().orders[0].fulfillmentStatus, 'delivered', 'late supplier event cannot regress delivered order');
  await restarted.ingest(event('costs_confirmed'));
  eq(restarted.getSnapshot().financials.byCurrency[0].contributionMinor, 1450);
  eq(restarted.getSnapshot().financials.byCurrency[0].completeness, 'complete');

  // Customer cancellation, refunds, and physical fulfillment have distinct truth.
  await restarted.ingest(event('cancel_requested'));
  eq(restarted.getSnapshot().orders[0].paymentStatus, 'paid');
  eq(restarted.getSnapshot().orders[0].fulfillmentStatus, 'delivered');
  await restarted.ingest(event('canceled'));
  eq(restarted.getSnapshot().orders[0].paymentStatus, 'paid', 'cancellation is not a refund');
  eq(restarted.getSnapshot().exceptions.some(e => e.status === 'open' && e.type === 'fulfillment_after_cancellation'), true);
  await restarted.ingest(event('refunded'));
  eq(restarted.getSnapshot().financials.byCurrency[0].contributionMinor, -2050);
  eq(restarted.getSnapshot().orders[0].fulfillmentStatus, 'delivered');
  await assert.rejects(restarted.ingest({ ...event('processing', 'bad-regression'), revision: 99 }), /cannot regress/); assertions++;
  await restarted.ingest({ ...event('costs_confirmed', 'later-costs'), revision: 2 });
  eq(restarted.getSnapshot().financials.byCurrency[0].refundsMinor, 3500, 'later cost updates cannot undo a refund');

  const disconnected = make('lifecycle', { mode: 'disconnected' });
  eq(disconnected.getSnapshot().orders.length, 0, 'demo never enters disconnected data');
  eq(disconnected.getSnapshot().connections.every(c => c.status === 'disconnected'), true);
  await assert.rejects(disconnected.ingest(event('paid')), /not enabled/); assertions++;
  await assert.rejects(make('out-of-order').ingest(event('shipped')), { code: 'ECOMMERCE_ORDER_MISSING' }); assertions++;
  eq(make('out-of-order').getSnapshot().actions.length, 0, 'unapplied event is not acknowledged as committed');

  const finance = make('finance');
  const paid = event('paid');
  paid.payload.financials.marketplaceFeesMinor = 350;
  await finance.ingest(paid);
  eq(finance.getSnapshot().financials.byCurrency[0].completeness, 'estimated');
  const euro = event('paid', 'paid-eur'); euro.orderId = 'euro-order'; euro.payload.channelOrderId = 'euro-receipt'; euro.payload.financials.currency = 'EUR';
  await finance.ingest(euro);
  eq(finance.getSnapshot().financials.byCurrency.map(g => g.currency), ['EUR', 'USD'], 'currencies never silently combine');
  const badMoney = event('paid', 'bad-money'); badMoney.orderId = 'bad-order'; badMoney.payload.financials.revenueMinor = 1.1;
  await assert.rejects(finance.ingest(badMoney), /Invalid integer/); assertions++;
  const injected = event('paid', 'secret-payload'); injected.payload.accessToken = 'never-store';
  await assert.rejects(finance.ingest(injected), /Unexpected record field/); assertions++;
  const badMapped = event('paid', 'duplicate-order'); badMapped.orderId = 'another-internal-id';
  await assert.rejects(finance.ingest(badMapped), /already mapped/); assertions++;
  const detached = finance.getSnapshot(); detached.orders[0].paymentStatus = 'invented';
  eq(finance.getSnapshot().orders[0].paymentStatus, 'paid', 'callers cannot mutate persisted records through a snapshot');

  // Failed durable writes leave the previous state authoritative and retryable.
  const initial = make('disk-failure'); await initial.ingest(event('paid'));
  const failing = make('disk-failure', { writeDurable: () => { const e = new Error('disk full'); e.code = 'ENOSPC'; throw e; } });
  await assert.rejects(failing.ingest(event('processing')), { code: 'ENOSPC' }); assertions++;
  eq(initial.getSnapshot().orders[0].fulfillmentStatus, 'pending');
  eq((await initial.ingest(event('processing'))).duplicate, false);
  eq(initial.getSnapshot().orders[0].fulfillmentStatus, 'processing');
  const ambiguous = make('ambiguous', { writeDurable: (deps, file, data) => {
    writeFileDurable(deps, file, data);
    if (!file.endsWith('.bak')) throw new Error('simulated lost acknowledgement after commit');
  } });
  await assert.rejects(ambiguous.ingest(event('paid')), /lost acknowledgement/); assertions++;
  eq((await make('ambiguous').ingest(event('paid'))).duplicate, true, 'a committed write with a lost acknowledgement is not replayed');

  const torn = make('torn'); await torn.ingest(event('paid')); await torn.ingest(event('processing'));
  const tornFile = path.join(scratch, 'torn', 'demo.json'); fs.writeFileSync(tornFile, '{');
  assert.throws(() => make('torn').getSnapshot(), { code: 'ECOMMERCE_RECOVERY_REQUIRED' }); assertions++;
  await assert.rejects(make('torn').ingest(event('paid')), { code: 'ECOMMERCE_RECOVERY_REQUIRED' }); assertions++;
  eq(fs.readFileSync(tornFile, 'utf8'), '{', 'unproven recovery does not overwrite forensic state or lose dedup receipts');
  const lockedFs = new Proxy(fs, { get(target, key) {
    if (key === 'readFileSync') return () => { const error = new Error('locked'); error.code = 'EACCES'; throw error; };
    return target[key];
  } });
  assert.throws(() => make('disk-failure', { fs: lockedFs }).getSnapshot(), { code: 'ECOMMERCE_STORAGE_UNAVAILABLE' }); assertions++;

  const invalid = make('invalid'); await invalid.ingest(event('paid'));
  const invalidFile = path.join(scratch, 'invalid', 'demo.json');
  for (const replacement of [null, { schemaVersion: 2 }, { ...M.initialState('demo'), extra: 'secret' }]) {
    writeFileDurable({ fs, path }, invalidFile, JSON.stringify(replacement));
    assert.throws(() => invalid.getSnapshot(), { code: 'ECOMMERCE_STATE_INVALID' }); assertions++;
    await assert.rejects(invalid.ingest(event('processing')), { code: 'ECOMMERCE_STATE_INVALID' }); assertions++;
  }
  const fullState = M.initialState('demo');
  for (let i = 0; i < M.LIMITS.receipts; i++) {
    fullState.receipts.push({ id: 'receipt-' + i, digest: 'a'.repeat(64), outcome: 'ignored_stale' });
    fullState.actions.push({ id: 'receipt-' + i, actor: 'demo', actionType: 'order.paid', targetId: 'demo-order-001',
      policyDecision: 'demo_only', status: 'ignored_stale', externalReference: null, occurredAt: now() });
  }
  const capacityDir = path.join(scratch, 'capacity'); fs.mkdirSync(capacityDir);
  fs.writeFileSync(path.join(capacityDir, 'demo.json'), JSON.stringify(fullState));
  await assert.rejects(make('capacity').ingest(event('paid')), { code: 'ECOMMERCE_CAPACITY' }); assertions++;
  eq(JSON.parse(fs.readFileSync(path.join(capacityDir, 'demo.json'), 'utf8')).receipts.length, M.LIMITS.receipts, 'capacity never prunes duplicate protection');
  console.log('PASS commerce foundation: ' + assertions + ' checks (lifecycle, duplicate delivery, concurrency, restart, money, and storage faults)');
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(scratch, { recursive: true, force: true }));

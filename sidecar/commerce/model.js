'use strict';

// Pure normalized commerce state. Provider adapters must translate into this
// vocabulary; this module neither trusts raw webhooks nor calls a supplier.
const VERSION = 1;
const LIMITS = Object.freeze({ orders: 500, receipts: 5000 });
const COST_FIELDS = Object.freeze(['revenueMinor', 'supplierCostMinor', 'shippingCostMinor',
  'marketplaceFeesMinor', 'refundsMinor', 'advertisingCostMinor']);
const TYPES = Object.freeze({
  'order.paid': 'marketplace', 'order.cancel_requested': 'marketplace',
  'order.canceled': 'marketplace', 'order.refunded': 'marketplace',
  'fulfillment.failed': 'supplier', 'fulfillment.processing': 'supplier',
  'fulfillment.shipped': 'supplier', 'fulfillment.delivered': 'supplier',
  'costs.updated': 'finance'
});

function fail(code, message, status = 400) {
  const error = new Error(message); error.code = code; error.status = status; throw error;
}
function check(ok, message) { if (!ok) fail('ECOMMERCE_INVALID', message); }
function record(value, fields) {
  check(value && typeof value === 'object' && !Array.isArray(value), 'Expected an object.');
  check(Object.keys(value).every(key => fields.includes(key)), 'Unexpected record field.');
  return value;
}
function id(value) {
  check(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value), 'Invalid identifier.');
  return value;
}
function timestamp(value) {
  check(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'Invalid timestamp.');
  return new Date(value).toISOString();
}
function integer(value, minimum = 0) { check(Number.isSafeInteger(value) && value >= minimum, 'Invalid integer.'); return value; }
function currency(value) { check(typeof value === 'string' && /^[A-Z]{3}$/.test(value), 'Invalid currency.'); return value; }
function oneOf(value, values) { check(values.includes(value), 'Invalid status.'); return value; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function amounts(input) {
  record(input, ['currency', ...COST_FIELDS, 'estimatedFields']);
  const result = { currency: currency(input.currency) };
  for (const key of COST_FIELDS) result[key] = input[key] == null ? null : integer(input[key]);
  const estimated = input.estimatedFields || [];
  check(Array.isArray(estimated) && estimated.every(key => COST_FIELDS.includes(key) && result[key] !== null), 'Invalid cost estimates.');
  result.estimatedFields = [...new Set(estimated)].sort();
  return result;
}

function initialState(mode) {
  oneOf(mode, ['disconnected', 'demo']);
  const demo = mode === 'demo';
  return {
    schemaVersion: VERSION, mode, updatedAt: null,
    connections: ['etsy', 'printful'].map(provider => ({ id: provider, provider,
      shopId: demo ? 'demo-shop' : null, displayName: demo ? 'Demonstration ' + provider : provider,
      status: demo ? 'connected' : 'disconnected', capabilities: demo ? ['demo.read'] : [],
      lastSyncedAt: null, errorCode: null })),
    products: demo ? [{ id: 'demo-print', sku: 'DEMO-PET-ART-12X16', listingId: 'demo-listing',
      variationIds: ['demo-size'], supplierVariantId: 'demo-variant', artworkId: 'demo-artwork',
      validationStatus: 'ready', costEstimate: { amountMinor: 1200, currency: 'USD' }, costUpdatedAt: null }] : [],
    orders: [], exceptions: [], actions: [], receipts: []
  };
}

function normalizeEvent(input) {
  record(input, ['id', 'orderId', 'type', 'revision', 'occurredAt', 'payload']);
  check(Object.hasOwn(TYPES, input.type), 'Unsupported commerce event.');
  const event = { id: id(input.id), orderId: id(input.orderId), type: input.type,
    revision: integer(input.revision, 1), occurredAt: timestamp(input.occurredAt), payload: {} };
  const p = input.payload || {};
  if (input.type === 'order.paid') {
    record(p, ['channelOrderId', 'productId', 'itemCount', 'placedAt', 'financials']);
    event.payload = { channelOrderId: id(p.channelOrderId), productId: id(p.productId),
      itemCount: integer(p.itemCount, 1), placedAt: timestamp(p.placedAt), financials: amounts(p.financials) };
    check(event.payload.financials.revenueMinor !== null, 'Paid orders require known revenue.');
    check(event.payload.financials.refundsMinor === 0, 'New paid orders must have zero refunded amount.');
  } else if (input.type === 'costs.updated') {
    record(p, ['currency', 'supplierCostMinor', 'shippingCostMinor', 'marketplaceFeesMinor', 'advertisingCostMinor', 'estimatedFields']);
    const normalized = amounts({ ...p, revenueMinor: 0, refundsMinor: 0 });
    delete normalized.revenueMinor; delete normalized.refundsMinor;
    check(!normalized.estimatedFields.some(key => ['revenueMinor', 'refundsMinor'].includes(key)), 'Cost events cannot estimate revenue or refunds.');
    event.payload = normalized;
  } else if (input.type === 'fulfillment.failed') {
    record(p, ['reason']);
    event.payload.reason = oneOf(p.reason, ['supplier_payment_failed', 'supplier_unavailable']);
  } else if (input.type === 'fulfillment.processing') {
    record(p, ['supplierOrderId']); event.payload.supplierOrderId = id(p.supplierOrderId);
  } else if (['fulfillment.shipped', 'fulfillment.delivered'].includes(input.type)) {
    record(p, ['supplierOrderId', 'shipmentCount', 'trackingAvailable']);
    check(typeof p.trackingAvailable === 'boolean', 'Tracking availability must be boolean.');
    event.payload = { supplierOrderId: id(p.supplierOrderId), shipmentCount: integer(p.shipmentCount, 1), trackingAvailable: p.trackingAvailable };
  } else record(p, []);
  return event;
}

function updateExceptions(state, order, at) {
  const open = [];
  if (!state.products.some(p => p.id === order.productId && p.validationStatus === 'ready')) open.push('mapping_missing');
  if (order.fulfillmentStatus === 'failed') open.push(order.failureReason);
  if (order.fulfillmentStatus === 'shipped' && !order.trackingAvailable) open.push('tracking_missing');
  if (order.cancellationStatus === 'requested') open.push('cancellation_review');
  if ((order.cancellationStatus === 'canceled' || order.paymentStatus === 'refunded') &&
      ['processing', 'shipped', 'delivered'].includes(order.fulfillmentStatus)) open.push('fulfillment_after_cancellation');
  const descriptions = {
    mapping_missing: ['Product mapping needs review.', 'Review the listing and supplier variant.'],
    supplier_payment_failed: ['Supplier payment failed.', 'Check billing and confirm supplier status before retrying.'],
    supplier_unavailable: ['Supplier cannot fulfill this order.', 'Review supplier availability.'],
    tracking_missing: ['Shipment tracking is unavailable.', 'Reconcile the shipment with the supplier.'],
    cancellation_review: ['Cancellation requested.', 'Check production status before canceling or refunding.'],
    fulfillment_after_cancellation: ['Fulfillment requires review after cancellation or refund.', 'Check whether production or delivery can still be stopped.']
  };
  for (const item of state.exceptions.filter(e => e.orderId === order.id)) {
    if (!open.includes(item.type) && item.status === 'open') { item.status = 'resolved'; item.resolvedAt = at; }
  }
  for (const type of open) {
    const previous = state.exceptions.find(e => e.orderId === order.id && e.type === type);
    if (previous) { previous.status = 'open'; previous.resolvedAt = null; continue; }
    state.exceptions.push({ id: order.id + ':' + type, orderId: order.id, connectionId: null, type,
      severity: 'warning', status: 'open', summary: descriptions[type][0], suggestedAction: descriptions[type][1],
      requiresApproval: true, createdAt: at, resolvedAt: null });
  }
}

function applyEvent(state, event, receivedAt) {
  check(state.mode === 'demo', 'Live order ingestion is not enabled in this milestone.');
  const next = clone(state);
  let order = next.orders.find(row => row.id === event.orderId);
  const lane = TYPES[event.type];
  if (!order) {
    if (event.type !== 'order.paid') fail('ECOMMERCE_ORDER_MISSING', 'Reconcile the paid order before applying this event.', 409);
    if (next.orders.length >= LIMITS.orders) fail('ECOMMERCE_CAPACITY', 'Commerce order capacity reached.', 409);
    const p = event.payload;
    check(!next.orders.some(row => row.channelOrderId === p.channelOrderId), 'Channel order is already mapped to another order.');
    order = { id: event.orderId, channelOrderId: p.channelOrderId, productId: p.productId,
      placedAt: p.placedAt, itemCount: p.itemCount, paymentStatus: 'paid', cancellationStatus: 'none',
      fulfillmentStatus: 'pending', fulfillmentOwner: 'supplier_native', supplierOrderId: null,
      shipmentCount: 0, trackingAvailable: false, failureReason: null, lastReconciledAt: null,
      updatedAt: receivedAt, financials: p.financials, revisions: { marketplace: 0, supplier: 0, finance: 0 } };
    next.orders.push(order);
  } else if (event.revision <= order.revisions[lane]) return { state: next, outcome: 'ignored_stale' };
  else if (event.type === 'order.paid') fail('ECOMMERCE_TRANSITION', 'An existing order cannot be recreated as paid.', 409);

  const p = event.payload;
  switch (event.type) {
    case 'order.cancel_requested':
      check(order.cancellationStatus !== 'canceled', 'Cancellation is already completed.');
      order.cancellationStatus = 'requested'; break;
    case 'order.canceled': order.cancellationStatus = 'canceled'; break;
    case 'order.refunded':
      order.paymentStatus = 'refunded'; order.financials.refundsMinor = order.financials.revenueMinor;
      order.financials.estimatedFields = order.financials.estimatedFields.filter(key => key !== 'refundsMinor'); break;
    case 'fulfillment.failed':
      check(!['shipped', 'delivered'].includes(order.fulfillmentStatus), 'Shipped fulfillment cannot regress to failed.');
      order.fulfillmentStatus = 'failed'; order.failureReason = p.reason; break;
    case 'fulfillment.processing':
      check(!['shipped', 'delivered'].includes(order.fulfillmentStatus), 'Shipped fulfillment cannot regress to processing.');
      order.fulfillmentStatus = 'processing'; order.supplierOrderId = p.supplierOrderId; order.failureReason = null; break;
    case 'fulfillment.shipped':
    case 'fulfillment.delivered':
      check(!(order.fulfillmentStatus === 'delivered' && event.type === 'fulfillment.shipped'), 'Delivered fulfillment cannot regress.');
      order.fulfillmentStatus = event.type.split('.')[1]; order.supplierOrderId = p.supplierOrderId;
      order.shipmentCount = p.shipmentCount; order.trackingAvailable = p.trackingAvailable; order.failureReason = null; break;
    case 'costs.updated':
      check(p.currency === order.financials.currency, 'Order currency cannot change.');
      order.financials = amounts({ ...p, revenueMinor: order.financials.revenueMinor, refundsMinor: order.financials.refundsMinor }); break;
  }
  order.revisions[lane] = event.revision;
  order.updatedAt = receivedAt;
  updateExceptions(next, order, receivedAt);
  return { state: next, outcome: 'applied' };
}

function financialSummary(orders) {
  const groups = new Map();
  for (const order of orders) {
    const f = order.financials;
    let group = groups.get(f.currency);
    if (!group) {
      group = { currency: f.currency, orderCount: 0, amounts: Object.fromEntries(COST_FIELDS.map(key => [key, 0])), estimatedFields: new Set() };
      groups.set(f.currency, group);
    }
    group.orderCount++;
    for (const key of COST_FIELDS) {
      if (f[key] === null || group.amounts[key] === null) group.amounts[key] = null;
      else { group.amounts[key] += f[key]; check(Number.isSafeInteger(group.amounts[key]), 'Financial total is too large.'); }
    }
    f.estimatedFields.forEach(key => group.estimatedFields.add(key));
  }
  return [...groups.values()].map(group => {
    const missingFields = COST_FIELDS.filter(key => group.amounts[key] === null);
    const estimatedFields = [...group.estimatedFields].sort();
    const a = group.amounts;
    const contributionMinor = missingFields.length ? null : a.revenueMinor - a.supplierCostMinor - a.shippingCostMinor - a.marketplaceFeesMinor - a.refundsMinor - a.advertisingCostMinor;
    check(contributionMinor === null || Number.isSafeInteger(contributionMinor), 'Financial total is too large.');
    return { currency: group.currency, orderCount: group.orderCount, ...a, contributionMinor,
      completeness: missingFields.length ? 'incomplete' : estimatedFields.length ? 'estimated' : 'complete',
      missingFields, estimatedFields };
  }).sort((a, b) => a.currency.localeCompare(b.currency));
}

function snapshot(state, now, storageStatus) {
  return { schemaVersion: VERSION, mode: state.mode, lastSyncedAt: null, stale: true,
    updatedAt: state.updatedAt, storageStatus,
    notice: state.mode === 'demo' ? 'Demonstration data only. No orders are sent and no money is spent.' : 'Etsy and the supplier are not connected. Live synchronization is not implemented yet.',
    connections: clone(state.connections), products: clone(state.products),
    orders: state.orders.map(({ revisions, financials, ...order }) => ({ ...order, financials: financialSummary([{ financials }])[0] })),
    exceptions: clone(state.exceptions), financials: { period: 'all_recorded_orders', byCurrency: financialSummary(state.orders) },
    actions: clone(state.actions.slice(-100).reverse()),
    capabilities: { liveConnection: false, liveIngestion: false, submitFulfillment: false, publishListings: false,
      demoEvents: state.mode === 'demo' }, generatedAt: timestamp(now) };
}

// Validate persisted authority before reading or updating it. Invalid/future data
// is never normalized into an empty ledger, and extra fields never reach a UI.
function validateState(state, mode) {
  record(state, ['schemaVersion', 'mode', 'updatedAt', 'connections', 'products', 'orders', 'exceptions', 'actions', 'receipts']);
  check(state.schemaVersion === VERSION && state.mode === mode, 'Unsupported commerce state.');
  if (state.updatedAt !== null) timestamp(state.updatedAt);
  for (const field of ['connections', 'products', 'orders', 'exceptions', 'actions', 'receipts']) check(Array.isArray(state[field]), 'Invalid commerce collection.');
  check(state.orders.length <= LIMITS.orders && state.receipts.length <= LIMITS.receipts, 'Commerce state exceeds capacity.');
  const defaults = initialState(mode);
  check(JSON.stringify(state.connections) === JSON.stringify(defaults.connections), 'Unexpected connection state.');
  check(JSON.stringify(state.products) === JSON.stringify(defaults.products), 'Unexpected product mapping state.');
  if (mode === 'disconnected') check(!state.orders.length && !state.exceptions.length && !state.actions.length && !state.receipts.length, 'Disconnected state cannot contain simulated orders.');
  for (const o of state.orders) {
    record(o, ['id', 'channelOrderId', 'productId', 'placedAt', 'itemCount', 'paymentStatus', 'cancellationStatus', 'fulfillmentStatus', 'fulfillmentOwner', 'supplierOrderId', 'shipmentCount', 'trackingAvailable', 'failureReason', 'lastReconciledAt', 'updatedAt', 'financials', 'revisions']);
    id(o.id); id(o.channelOrderId); id(o.productId); integer(o.itemCount, 1); timestamp(o.placedAt); timestamp(o.updatedAt);
    oneOf(o.paymentStatus, ['paid', 'refunded']); oneOf(o.cancellationStatus, ['none', 'requested', 'canceled']);
    oneOf(o.fulfillmentStatus, ['pending', 'failed', 'processing', 'shipped', 'delivered']);
    check(o.fulfillmentOwner === 'supplier_native' && o.lastReconciledAt === null, 'Unsupported fulfillment authority.');
    if (o.supplierOrderId !== null) id(o.supplierOrderId);
    integer(o.shipmentCount); check(typeof o.trackingAvailable === 'boolean', 'Invalid tracking state.');
    if (o.failureReason !== null) oneOf(o.failureReason, ['supplier_payment_failed', 'supplier_unavailable']);
    check(JSON.stringify(amounts(o.financials)) === JSON.stringify(o.financials), 'Invalid financial state.');
    record(o.revisions, ['marketplace', 'supplier', 'finance']); for (const lane of ['marketplace', 'supplier', 'finance']) integer(o.revisions[lane]);
  }
  check(new Set(state.orders.map(o => o.id)).size === state.orders.length, 'Duplicate order identity.');
  check(new Set(state.orders.map(o => o.channelOrderId)).size === state.orders.length, 'Duplicate channel order.');
  for (const r of state.receipts) {
    record(r, ['id', 'digest', 'outcome']); id(r.id);
    check(typeof r.digest === 'string' && /^[a-f0-9]{64}$/.test(r.digest), 'Invalid event receipt.');
    oneOf(r.outcome, ['applied', 'ignored_stale']);
  }
  check(new Set(state.receipts.map(r => r.id)).size === state.receipts.length, 'Duplicate event receipt.');
  check(state.actions.length === state.receipts.length, 'Incomplete action history.');
  for (let i = 0; i < state.actions.length; i++) {
    const a = state.actions[i]; record(a, ['id', 'actor', 'actionType', 'targetId', 'policyDecision', 'status', 'externalReference', 'occurredAt']);
    check(a.id === state.receipts[i].id && a.status === state.receipts[i].outcome, 'Mismatched event history.');
    check(a.actor === 'demo' && a.policyDecision === 'demo_only' && a.externalReference === null && Object.hasOwn(TYPES, a.actionType), 'Invalid action authority.');
    id(a.targetId); timestamp(a.occurredAt);
  }
  for (const e of state.exceptions) {
    record(e, ['id', 'orderId', 'connectionId', 'type', 'severity', 'status', 'summary', 'suggestedAction', 'requiresApproval', 'createdAt', 'resolvedAt']);
    check(state.orders.some(o => o.id === e.orderId) && e.id === e.orderId + ':' + e.type, 'Invalid exception identity.');
    oneOf(e.type, ['mapping_missing', 'supplier_payment_failed', 'supplier_unavailable', 'tracking_missing', 'cancellation_review', 'fulfillment_after_cancellation']);
    check(e.connectionId === null && e.severity === 'warning' && e.requiresApproval === true, 'Invalid exception authority.');
    oneOf(e.status, ['open', 'resolved']); timestamp(e.createdAt); if (e.resolvedAt !== null) timestamp(e.resolvedAt);
    check(typeof e.summary === 'string' && e.summary.length <= 150 && typeof e.suggestedAction === 'string' && e.suggestedAction.length <= 150, 'Invalid exception text.');
  }
  financialSummary(state.orders);
  return state;
}

module.exports = { VERSION, LIMITS, COST_FIELDS, TYPES, fail, check, record, id, timestamp, initialState,
  normalizeEvent, applyEvent, financialSummary, snapshot, validateState };

'use strict';

const M = require('./model.js');
// Fixed source timestamps make a retried demo command byte-for-byte idempotent.
// These are invented examples, not Etsy events, prices, or fee quotations.
const STEPS = Object.freeze({
  paid: ['order.paid', 1], payment_failed: ['fulfillment.failed', 1],
  processing: ['fulfillment.processing', 2], tracking_missing: ['fulfillment.shipped', 3],
  shipped: ['fulfillment.shipped', 4], delivered: ['fulfillment.delivered', 5],
  cancel_requested: ['order.cancel_requested', 2], canceled: ['order.canceled', 3],
  refunded: ['order.refunded', 4], costs_confirmed: ['costs.updated', 1]
});

function demoEvent(input) {
  M.record(input, ['eventId', 'step']); M.id(input.eventId);
  M.check(Object.hasOwn(STEPS, input.step), 'Unknown demonstration step.');
  const [type, revision] = STEPS[input.step];
  const event = { id: input.eventId, orderId: 'demo-order-001', type, revision,
    occurredAt: '2026-01-01T12:00:00.000Z', payload: {} };
  const financials = { currency: 'USD', revenueMinor: 3500, supplierCostMinor: 1200,
    shippingCostMinor: 500, marketplaceFeesMinor: null, refundsMinor: 0, advertisingCostMinor: 0,
    estimatedFields: ['shippingCostMinor', 'supplierCostMinor'] };
  if (input.step === 'paid') event.payload = { channelOrderId: 'demo-etsy-001', productId: 'demo-print',
    itemCount: 1, placedAt: event.occurredAt, financials };
  if (input.step === 'payment_failed') event.payload = { reason: 'supplier_payment_failed' };
  if (input.step === 'processing') event.payload = { supplierOrderId: 'demo-supplier-001' };
  if (['tracking_missing', 'shipped', 'delivered'].includes(input.step)) event.payload = {
    supplierOrderId: 'demo-supplier-001', shipmentCount: 1, trackingAvailable: input.step !== 'tracking_missing' };
  if (input.step === 'costs_confirmed') event.payload = { currency: 'USD', supplierCostMinor: 1200,
    shippingCostMinor: 500, marketplaceFeesMinor: 350, advertisingCostMinor: 0, estimatedFields: [] };
  return event;
}

module.exports = { STEPS, demoEvent };

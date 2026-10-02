/* node test/commercepanel.test.js — THE LAB SHOP panel (frontend/app/commercepanel.js) renders the commerce contract
   honestly: demo notice always shown, unknown money never shown as 0, contribution not profit, stale data kept and
   marked, no enabled live actions, and the page loads it after the 3D view. */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');
const P = require('../frontend/app/commercepanel.js');

A.eq(P.money(3500, 'USD'), '$35.00', 'minor units format as currency');
A.eq(P.money(null, 'USD'), 'unavailable', 'an unknown amount is "unavailable", never $0');
A.ok(/^ui-paid-[a-z0-9]+-abc$/.test(P.eventId('paid', 1700000000000, 'abc')), 'event ids are contract-safe');
A.ok(P.eventId('x'.repeat(200), 1, 'r').length <= 128, 'event ids stay within 128 chars');
A.eq(P.esc('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;', 'text is escaped');

const group = c => ({ currency: 'USD', orderCount: 1, revenueMinor: 3500, supplierCostMinor: 1500, shippingCostMinor: null, marketplaceFeesMinor: 300,
  refundsMinor: 0, advertisingCostMinor: 0, contributionMinor: c, completeness: c == null ? 'incomplete' : 'complete', missingFields: c == null ? ['shippingCostMinor'] : [], estimatedFields: [] });
const snap = {
  ok: true, mode: 'demo', notice: 'Simulated data. No shop is connected.', updatedAt: '2026-10-02T15:00:00Z',
  connections: [{ id: 'c1', provider: 'etsy', status: 'connected', displayName: 'Demo shop' }],
  financials: { byCurrency: [group(null), Object.assign(group(1700), { currency: 'EUR' })] },
  exceptions: [{ id: 'e1', severity: 'high', status: 'open', summary: 'Supplier billing failed <x>', suggestedAction: 'Update card', requiresApproval: true }],
  orders: [{ id: 'o1', channelOrderId: 'demo-order-001', placedAt: '2026-10-02T15:00:00Z', paymentStatus: 'paid', fulfillmentStatus: 'failed', cancellationStatus: 'none', trackingAvailable: false, financials: group(null) }],
  actions: [{ actionType: 'paid', status: 'applied', occurredAt: '2026-10-02T15:00:00Z' }]
};
const html = P.render({ mode: 'demo', snap, steps: ['paid', 'shipped'], error: null });
A.ok(html.includes('Simulated data. No shop is connected.') && html.includes('DEMO'), 'the demo notice is shown');
A.ok(html.includes('unavailable') && !/Contribution[^<]*<\/span><b class="">\$0\.00/.test(html), 'missing contribution reads unavailable');
A.ok(/not net profit/.test(html) && !/>\s*Profit/i.test(html), 'money is labelled contribution, not profit');
A.ok(html.includes('USD') && html.includes('EUR'), 'each currency is its own total');
A.ok(html.includes('&lt;x&gt;') && !html.includes('<x>'), 'record text is escaped');
A.ok(html.includes('Needs your decision'), 'approval-needed problems are flagged');
A.ok(/data-step="paid"/.test(html) && /DEMO ONLY/.test(html), 'demo simulation buttons are labelled');
A.ok(/<button class="shop-live" disabled/.test(html), 'the live Connect action is disabled');
A.ok(!/data-act="(publish|fulfill|connect)"/.test(html), 'no live publish/fulfil/connect action is wired');
const stale = P.render({ mode: 'demo', snap, steps: [], error: 'HTTP 503', loadedAt: '2026-10-02T15:00:00Z' });
A.ok(stale.includes("Couldn't refresh") && stale.includes('demo-order-001'), 'a failed read keeps the last data, marked stale');
const off = P.render({ mode: 'disconnected', snap: Object.assign({}, snap, { mode: 'disconnected', orders: [], exceptions: [], financials: { byCurrency: [] } }), steps: ['paid'] });
A.ok(!/data-step=/.test(off), 'no simulation controls outside demo');
A.ok(off.includes('no totals'), 'empty financials read as "no recorded orders", not $0');

const page = fs.readFileSync(path.join(__dirname, '../frontend/index.html'), 'utf8');
A.ok(page.indexOf('src="app/commercepanel.js"') > page.indexOf('src="app/office3d.js"'), 'the shop loads after the 3D view');
A.ok(page.includes('href="css/commerce.css"'), 'the shop styles are linked');
A.report('commercepanel.test');

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { SidecarFixture } = require('./helpers/sidecar-fixture');
const TOKEN = 'commerce-fixture-token-not-a-real-secret';

(async () => {
  const host = SidecarFixture.create({ acquireToken: false, env: { STARNET_API_TOKEN: TOKEN } });
  try {
    await host.start(); host.token = TOKEN;
    assert.equal((await host.request('/api/commerce', { headers: { 'X-StarNet-Token': '' } })).status, 403);
    assert.equal((await host.request('/api/commerce?mode=demo', { headers: { Origin: 'https://untrusted.example' } })).status, 403);
    // Fetch may replace a custom Host header; use raw HTTP to exercise rebinding.
    const foreignHostStatus = await new Promise((resolve, reject) => {
      http.get(host.baseUrl + '/api/commerce', { headers: { Host: 'untrusted.example', 'X-StarNet-Token': TOKEN } }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      }).on('error', reject);
    });
    assert.equal(foreignHostStatus, 403);
    assert.equal((await host.request('/api/commerce/demo/events', { method: 'POST', headers: { 'X-StarNet-Token': '' }, body: '{}' })).status, 403);
    let response = await host.json('GET', '/api/commerce');
    assert.equal(response.status, 200); assert.equal(response.body.mode, 'disconnected');
    assert.equal(response.body.capabilities.liveConnection, false);
    assert.deepEqual(response.body.orders, []);
    assert.equal((await host.json('GET', '/api/commerce?mode=live')).status, 400);
    assert.equal((await host.json('GET', '/api/commerce?mode=demo&mode=disconnected')).status, 400);
    assert.equal((await host.json('POST', '/api/commerce', {})).status, 405);
    assert.equal((await host.json('POST', '/api/commerce/orders', {})).status, 404);
    assert.equal((await host.json('POST', '/api/commerce/demo/events', { step: 'processing', eventId: 'out-of-order' })).status, 409);
    const paid = { step: 'paid', eventId: 'http-paid' };
    response = await host.json('POST', '/api/commerce/demo/events', paid);
    assert.equal(response.status, 200); assert.equal(response.body.duplicate, false);
    assert.equal(response.body.snapshot.mode, 'demo'); assert.equal(response.body.snapshot.orders.length, 1);
    response = await host.json('POST', '/api/commerce/demo/events', paid);
    assert.equal(response.body.duplicate, true);
    assert.equal((await host.json('POST', '/api/commerce/demo/events', { ...paid, step: 'shipped' })).status, 409);
    assert.equal((await host.json('POST', '/api/commerce/demo/events', { ...paid, apiKey: 'do-not-accept' })).status, 400);
    assert.equal((await host.request('/api/commerce/demo/events', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
    assert.equal((await host.request('/api/commerce/demo/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
    assert.equal((await host.json('POST', '/api/commerce/demo/events', { step: 'paid', eventId: 'x'.repeat(5000) })).status, 413);
    for (const step of ['payment_failed', 'processing', 'shipped', 'delivered', 'costs_confirmed']) {
      assert.equal((await host.json('POST', '/api/commerce/demo/events', { step, eventId: 'http-' + step })).status, 200);
    }
    await host.restart(); host.token = TOKEN;
    response = await host.json('GET', '/api/commerce?mode=demo');
    assert.equal(response.body.orders[0].fulfillmentStatus, 'delivered');
    assert.equal(response.body.financials.byCurrency[0].contributionMinor, 1450);
    assert.equal((await host.json('POST', '/api/commerce/demo/events', paid)).body.duplicate, true);
    assert.deepEqual((await host.json('GET', '/api/commerce')).body.orders, []);
    const demoFile = path.join(host.workspace, 'commerce', 'demo.json');
    fs.writeFileSync(demoFile, '{');
    response = await host.json('GET', '/api/commerce?mode=demo');
    assert.equal(response.status, 503); assert.equal(response.body.code, 'ECOMMERCE_RECOVERY_REQUIRED');
    assert.equal(response.text.includes(host.workspace), false, 'storage errors do not expose local paths');
    assert.equal((await host.json('POST', '/api/commerce/demo/events', paid)).status, 503);
    assert.equal(fs.readFileSync(demoFile, 'utf8'), '{');
    console.log('PASS commerce HTTP: real sidecar auth, origin, routes, demo lifecycle, replay, and restart isolation');
  } finally { await host.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

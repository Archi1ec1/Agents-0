'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');
const token = 'shorts-http-fixture-not-a-real-token';
const apiKey = 'fixture-short-token-0123456789';
const fixture = new SidecarFixture({ acquireToken: false, env: {
  STARNET_API_TOKEN: token, SKYNET_API_TOKEN: token,
  STARNET_CONNECTOR_ENCRYPTION_KEY: 'cd'.repeat(32),
  NODE_OPTIONS: '--require "' + path.join(__dirname, 'fixtures', 'shorts-opus-preload.cjs').replace(/\\/g, '/') + '"'
} });
let sequence = 0;
const action = () => 'http-action-' + (++sequence);
async function request(suffix = '', body, expected = 200, options = {}) {
  const response = await fetch(fixture.baseUrl + '/api/shorts' + suffix, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-StarNet-Token': token, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...options });
  assert.equal(response.status, expected, suffix + ': ' + response.status); return response;
}
(async () => {
  try {
    await fixture.start();
    assert.equal((await fetch(fixture.baseUrl + '/api/shorts')).status, 403);
    await request('', undefined, 403, { headers: { 'X-StarNet-Token': token, Origin: 'https://evil.example' } });
    const hostStatus = await new Promise((resolve, reject) => { http.get(fixture.baseUrl + '/api/shorts', { headers: { Host: 'evil.example', 'X-StarNet-Token': token } }, r => { r.resume(); resolve(r.statusCode); }).on('error', reject); });
    assert.equal(hostStatus, 403);
    const initial = await (await request()).json(); assert.equal(initial.mode, 'disconnected'); assert.equal(initial.sources.length, 0);
    assert.equal(fs.existsSync(path.join(fixture.workspace, 'shorts', 'workflow.ledger')), false);
    await request('?mode=live', undefined, 400); await request('/unknown', undefined, 404);
    assert.equal((await request('', {}, 405)).headers.get('allow'), 'GET');
    await request('/sources', {}, 415, { headers: { 'X-StarNet-Token': token, 'Content-Type': 'text/plain' } });
    await request('/sources', {}, 400, { body: '{' }); await request('/sources', { actionId: action(), unexpected: apiKey }, 400);
    const huge = await fetch(fixture.baseUrl + '/api/shorts/sources', { method: 'POST', headers: { 'X-StarNet-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'x'.repeat(20000) }) });
    assert.equal(huge.status, 413);
    const source = { actionId: action(), sourceId: 'source-1', title: 'Licensed video', creator: 'Example creator', kind: 'licensed_file', durationSec: 1500,
      url: 'https://drive.google.com/file/d/fixture/view' };
    await request('/sources', source);
    assert.equal((await (await request('/sources', source)).json()).duplicate, true);
    await request('/sources', { ...source, title: 'Changed' }, 409);
    await request('/jobs/submit', { actionId: action(), sourceId: 'source-1', confirmProcessing: true, maxCredits: 25 }, 409);
    await request('/connect', { actionId: action(), apiKey, orgId: 'org_fixture' });
    const encrypted = fs.readFileSync(path.join(fixture.workspace, '.secrets', 'shorts-opus.json'), 'utf8');
    assert.equal(encrypted.includes(apiKey), false);
    await request('/jobs/submit', { actionId: action(), sourceId: 'source-1', confirmProcessing: true, maxCredits: 25 }, 409);
    await request('/sources/clear', { actionId: action(), sourceId: 'source-1', evidence: 'Permission reference', attribution: 'Credit the creator', originalityPlan: 'Add analysis and a new explanation', commercialEditsAllowed: true, sourceAccessConfirmed: true });
    const submit = { actionId: action(), sourceId: 'source-1', confirmProcessing: true, maxCredits: 25 };
    const submitted = await (await request('/jobs/submit', submit)).json(); assert.equal(submitted.snapshot.jobs[0].state, 'processing');
    await fixture.restart(); await request('/jobs/submit', submit);
    await request('/jobs/refresh', { actionId: action(), jobId: submitted.targetId });
    const snap = await (await request()).json(), clip = snap.clips[0]; assert.equal(snap.jobs[0].state, 'review');
    assert.equal(JSON.stringify(snap).includes(apiKey), false);
    const approval = await (await request('/clips/approve', { actionId: action(), clipId: clip.id, fingerprint: clip.fingerprint, accountId: 'youtube-fixture',
      title: 'An original explanation', description: 'Credit Example creator', publishAt: new Date(Date.now() + 86400000).toISOString(),
      editorialNotes: 'Reviewed the added commentary, complete context and final render.', checks: { rights: true, originality: true, captions: true, framing: true, audio: true } })).json();
    const scheduled = await (await request('/publications/schedule', { actionId: action(), approvalId: approval.targetId, confirmPublication: true })).json();
    assert.equal(scheduled.snapshot.publications[0].state, 'scheduled');
    await request('/publications/cancel', { actionId: action(), publicationId: scheduled.targetId, confirmCancellation: true });
    const calls = fs.readFileSync(path.join(fixture.workspace, 'shorts-provider-calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(calls.filter(c => c.path === '/api/clip-projects').length, 1);
    assert.equal(calls.filter(c => c.path === '/api/publish-schedules' && c.method === 'POST').length, 1);
    const ledger = path.join(fixture.workspace, 'shorts', 'workflow.ledger'); fs.writeFileSync(ledger, '{broken');
    const broken = await (await request('', undefined, 503)).json(); assert.equal(broken.code, 'storage_unavailable');
    assert.equal(JSON.stringify(broken).includes(fixture.workspace), false); assert.equal(fs.readFileSync(ledger, 'utf8'), '{broken');
    assert.equal(fixture.output().includes(apiKey), false);
    console.log('shorts.http.test: authenticated workflow, encrypted credentials, restart and provider-contract fixture passed; no external calls');
  } finally { await fixture.dispose(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

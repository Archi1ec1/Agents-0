'use strict';
const assert = require('node:assert/strict');
const { makeOpusClient } = require('../sidecar/shorts/opus.js');
const credentials = { apiKey: 'fixture-opus-secret-not-real', orgId: 'org_fixture' };
const rawClip = { id: 'Pfixture.Cfixture', projectId: 'Pfixture', curationId: 'Cfixture', orgId: 'org_fixture', title: 'A clip',
  durationMs: 45000, uriForPreview: 'https://ext.cdn.opus.pro/p.mp4', uriForExport: 'https://ext.cdn.opus.pro/e.mp4', updatedAt: '2026-10-02T10:00:00.000Z', renderPref: { enableCaption: true } };
let count = 0;
async function test(name, fn) { await fn(); count++; console.log('ok - ' + name); }
function mock(value, status = 200) {
  const calls = [];
  const client = makeOpusClient({ fetchImpl: async (url, options) => {
    calls.push({ url, options }); if (value instanceof Error) throw value;
    return new Response(status === 204 ? null : JSON.stringify(value), { status });
  } }); return { client, calls };
}
(async () => {
  await test('uses only the official origin, server-side headers, and rejects redirects', async () => {
    const h = mock({ data: [{ platform: 'YOUTUBE', postAccountId: 'youtube-id', extUserName: 'Channel' }, { platform: 'TWITTER' }] });
    assert.deepEqual(await h.client.accounts(credentials), [{ id: 'youtube-id', name: 'Channel' }]);
    assert.equal(h.calls[0].url, 'https://api.opus.pro/api/social-accounts?q=mine');
    assert.equal(h.calls[0].options.redirect, 'error'); assert.equal(h.calls[0].options.headers.Authorization, 'Bearer ' + credentials.apiKey);
    assert.equal(h.calls[0].options.headers['x-opus-org-id'], 'org_fixture');
  });
  await test('creates a portrait captioned project using the documented request and response shapes', async () => {
    const h = mock({ id: 'Pfixture', projectId: 'Pfixture', orgId: 'org_fixture' });
    assert.equal(await h.client.create(credentials, { id: 'source-1', url: 'https://drive.google.com/file/d/test/view' }), 'Pfixture');
    const body = JSON.parse(h.calls[0].options.body); assert.equal(body.renderPref.layoutAspectRatio, 'portrait'); assert.equal(body.renderPref.enableCaption, true);
    assert.equal(body.curationPref.model, 'ClipBasic'); assert.equal(body.conclusionActions, undefined);
  });
  await test('normalizes composite clip IDs, preserves identity and tracks editor changes', async () => {
    const a = await mock([rawClip]).client.clips(credentials, 'Pfixture');
    const b = await mock([{ ...rawClip, updatedAt: '2026-10-02T11:00:00.000Z' }]).client.clips(credentials, 'Pfixture');
    assert.equal(a[0].providerClipId, 'Cfixture'); assert.notEqual(a[0].fingerprint, b[0].fingerprint);
    for (const patch of [{ orgId: 'another-org' }, { projectId: 'different' }, { id: 'wrong-prefix.Cfixture' }, { uriForExport: 'https://evil.test/clip.mp4' }]) {
      await assert.rejects(() => mock([{ ...rawClip, ...patch }]).client.clips(credentials, 'Pfixture'));
    }
  });
  await test('scheduling sends bare clip IDs, selected channel and exact approved metadata', async () => {
    const h = mock({ data: { scheduleId: 'schedule-1' } }, 201);
    const a = { accountId: 'channel-1', title: 'Approved title', description: 'Approved description', publishAt: '2026-10-03T10:00:00.000Z' };
    assert.equal(await h.client.schedule(credentials, { projectId: 'Pfixture' }, { providerClipId: 'Cfixture' }, a), 'schedule-1');
    const body = JSON.parse(h.calls[0].options.body); assert.equal(body.clipId, 'Cfixture'); assert.equal(body.postAccountId, 'channel-1');
    assert.equal(body.publishAt, a.publishAt); assert.equal(body.postDetail.custom.description, a.description); assert.equal(body.postDetail.custom.privacy, 'public');
  });
  await test('timeouts, invalid success bodies and server failures remain ambiguous with no retry', async () => {
    for (const h of [mock(new Error(credentials.apiKey)), mock({ secret: credentials.apiKey }, 500), mock({})]) {
      await assert.rejects(() => h.client.create(credentials, { id: 's', url: 'https://drive.google.com/file/d/test/view' }), e => e.ambiguous === true && !e.message.includes(credentials.apiKey));
      assert.equal(h.calls.length, 1);
    }
    const h = mock({ secret: credentials.apiKey }, 401);
    await assert.rejects(() => h.client.create(credentials, { id: 's', url: 'x' }), e => e.ambiguous === false && e.code === 'provider_access_required');
  });
  await test('oversized and malformed responses are refused without exposing upstream data', async () => {
    const h = mock({ data: 'x'.repeat(2 * 1024 * 1024) }); await assert.rejects(() => h.client.accounts(credentials), /provider_invalid_response/);
    const client = makeOpusClient({ fetchImpl: async () => new Response('not JSON ' + credentials.apiKey) });
    await assert.rejects(() => client.accounts(credentials), e => e.code === 'provider_invalid_response' && !e.message.includes(credentials.apiKey));
  });
  await test('cancellation supports a no-content response', async () => {
    const h = mock(null, 204); await h.client.cancel(credentials, 'schedule-1'); assert.equal(h.calls[0].options.method, 'DELETE');
  });
  await test('failed response cleanup is counted without logging upstream secrets', async () => {
    const failopen=require('../sidecar/failopen.js'),messages=[],warn=console.warn;
    failopen.resetForTests();console.warn=(...args)=>messages.push(args.join(' '));
    try{
      const client=makeOpusClient({fetchImpl:async()=>({ok:false,status:401,body:{cancel:async()=>{throw new Error(credentials.apiKey);}}})});
      await assert.rejects(()=>client.accounts(credentials),e=>e.code==='provider_access_required');
      assert.equal(failopen.counts()['shorts.opus.cancel-body'],1);
      assert.ok(messages.length&&!messages.join(' ').includes(credentials.apiKey));
    }finally{console.warn=warn;failopen.resetForTests();}
  });
  console.log('shorts.opus.test: ' + count + ' scenarios passed');
})().catch(e => { console.error(e); process.exitCode = 1; });

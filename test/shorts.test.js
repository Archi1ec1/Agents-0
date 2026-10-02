'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeConnectorVault } = require('../sidecar/connector-vault.js');
const { writeFileDurable } = require('../sidecar/durable-write.js');
const { makeShortsStore } = require('../sidecar/shorts/store.js');
const { makeShortsCredentials } = require('../sidecar/shorts/credentials.js');
const { makeShortsService } = require('../sidecar/shorts/service.js');
const { digest, sourceUrl, fail } = require('../sidecar/shorts/model.js');
const recovery = require('../sidecar/station-recovery.js');
const roots = [];
const key = 'fixture-opus-token-not-a-real-secret';
const checks = { rights: true, originality: true, captions: true, framing: true, audio: true };
let count = 0;
async function test(name, fn) { await fn(); count++; console.log('ok - ' + name); }
async function rejects(fn, code) { await assert.rejects(fn, e => e.code === code); }
function harness(opts = {}) {
  const root = opts.root || fs.mkdtempSync(path.join(os.tmpdir(), 'thelab-shorts-test-')); if (!opts.root) roots.push(root);
  const dir = path.join(root, 'shorts'), file = path.join(dir, 'workflow.ledger');
  let clock = '2026-10-02T10:00:00.000Z', seq = 0;
  const calls = { create: 0, clips: 0, schedule: 0, cancel: 0, accounts: 0 };
  const state = { accounts: [{ id: 'youtube-account', name: 'Test channel' }], clipRevision: 1, noClips: false, createError: null, readError: null, scheduleError: null, cancelError: null };
  const client = {
    async accounts() { calls.accounts++; return state.accounts; },
    async create() { calls.create++; if (state.createError) throw state.createError; return 'Pfixture'; },
    async clips() { calls.clips++; if (state.readError) throw state.readError; if (state.noClips) return [];
      return [{ providerClipId: 'Cfixture', title: 'A useful clip', durationMs: 40000,
        previewUrl: 'https://ext.cdn.opus.pro/preview.mp4', exportUrl: 'https://ext.cdn.opus.pro/export.mp4', fingerprint: digest(state.clipRevision) }]; },
    async schedule() { calls.schedule++; if (state.scheduleError) throw state.scheduleError; return 'schedule-fixture'; },
    async cancel() { calls.cancel++; if (state.cancelError) throw state.cancelError; }
  };
  const vault = makeConnectorVault({ fs, path, keyHex: 'ab'.repeat(32) });
  const credentials = makeShortsCredentials({ vault, file: path.join(root, '.secrets', 'shorts-opus.json') });
  const store = makeShortsStore({ fs: opts.fs || fs, path, directory: dir, writeDurable: opts.writer });
  const service = makeShortsService({ store, credentials, client, now: () => clock });
  const action = () => 'action-' + (++seq);
  async function connect() { return service.connect({ actionId: action(), apiKey: key, orgId: 'org_fixture' }); }
  async function source(sid = 'source-1', durationSec = 1500) {
    await service.addSource({ actionId: action(), sourceId: sid, title: 'Licensed interview', creator: 'Example creator', kind: 'licensed_file',
      url: 'https://drive.google.com/file/d/' + sid + '/view', durationSec });
    return sid;
  }
  async function clear(sid = 'source-1') { return service.clearSource({ actionId: action(), sourceId: sid, evidence: 'Written permission reference 123',
    attribution: 'Credit Example creator', originalityPlan: 'Explain and critique the main argument', commercialEditsAllowed: true, sourceAccessConfirmed: true }); }
  async function ready(duration = 1500) {
    await connect(); await source('source-1', duration); await clear();
    const submitted = await service.submit({ actionId: action(), sourceId: 'source-1', confirmProcessing: true, maxCredits: Math.max(10, Math.ceil(duration / 60)) });
    await service.refresh({ actionId: action(), jobId: submitted.targetId }); return service.snapshot().clips[0];
  }
  function approval(clip) { return { actionId: action(), clipId: clip.id, fingerprint: clip.fingerprint, accountId: 'youtube-account',
    title: 'What this interview misses', description: 'Original analysis. Credit Example creator.', publishAt: '2026-10-03T10:00:00.000Z', editorialNotes: 'Reviewed the original analysis in the rendered clip.', checks }; }
  return { root, dir, file, credentials, service, store, client, state, calls, action, connect, source, clear, ready, approval,
    setClock: value => { clock = value; } };
}
(async () => {
  try {
    await test('disconnected reads create no files and sources can be prepared without credentials', async () => {
      const h = harness(); assert.equal(h.service.snapshot().mode, 'disconnected'); assert.equal(fs.existsSync(h.dir), false);
      await h.source(); assert.equal(h.service.snapshot().sources.length, 1);
      await rejects(() => h.service.submit({ actionId: h.action(), sourceId: 'source-1', confirmProcessing: true, maxCredits: 25 }), 'opus_not_connected');
      assert.equal(h.calls.create, 0);
    });
    await test('credential storage is encrypted, snapshots omit secrets, and organization changes are blocked', async () => {
      const h = harness(); await h.connect();
      const raw = fs.readFileSync(path.join(h.root, '.secrets', 'shorts-opus.json'), 'utf8');
      assert.equal(raw.includes(key), false); assert.equal(JSON.stringify(h.service.snapshot()).includes(key), false);
      assert.ok(h.service.secretValues().includes(key));
      await rejects(() => h.service.connect({ actionId: h.action(), apiKey: key, orgId: 'other_org' }), 'organization_change_requires_migration');
      const plainVault = makeConnectorVault({ fs, path });
      const locked = makeShortsCredentials({ vault: plainVault, file: path.join(h.root, 'plaintext.json') });
      assert.throws(() => locked.set({ apiKey: key, orgId: 'org_fixture' }), /encrypted_storage_required/);
      assert.equal(fs.existsSync(path.join(h.root, 'plaintext.json')), false);
    });
    await test('source validation rejects arbitrary/internal URLs, signed credentials, and duplicates', async () => {
      const h = harness();
      for (const url of ['http://localhost/x.mp4', 'https://127.0.0.1/x.mp4', 'https://drive.google.com.evil.test/file/d/x/view', 'https://user:pass@drive.google.com/file/d/x/view', 'https://bucket.s3.amazonaws.com/x.mp4?X-Amz-Signature=secret']) {
        await assert.rejects(() => h.service.addSource({ actionId: h.action(), sourceId: 's', title: 'T', creator: 'C', kind: 'licensed_file', url, durationSec: 5 }));
      }
      assert.equal(sourceUrl('https://youtu.be/abcdefghijk', 'verified_youtube'), 'https://www.youtube.com/watch?v=abcdefghijk');
      await h.source(); await rejects(() => h.source(), 'source_already_exists');
    });
    await test('rights, processing confirmation and reserved-credit confirmation precede paid calls', async () => {
      const h = harness(); await h.connect(); await h.source();
      const input = { actionId: h.action(), sourceId: 'source-1', confirmProcessing: true, maxCredits: 25 };
      await rejects(() => h.service.submit(input), 'source_clearance_required'); await h.clear();
      await rejects(() => h.service.submit({ ...input, confirmProcessing: false }), 'processing_confirmation_required');
      await rejects(() => h.service.submit({ ...input, maxCredits: 10 }), 'credit_budget_exceeded'); assert.equal(h.calls.create, 0);
    });
    await test('concurrent retries submit once; duplicate identities and a different request ID cannot resubmit', async () => {
      const h = harness(); await h.connect(); await h.source(); await h.clear();
      const body = { actionId: h.action(), sourceId: 'source-1', confirmProcessing: true, maxCredits: 25 };
      const [a, b] = await Promise.all([h.service.submit(body), h.service.submit(body)]);
      assert.equal(h.calls.create, 1); assert.equal(a.targetId, b.targetId); assert.equal(b.duplicate, true);
      await rejects(() => h.service.submit({ ...body, maxCredits: 26 }), 'action_id_conflict');
      await rejects(() => h.service.submit({ ...body, actionId: h.action() }), 'source_already_submitted');
      const restart = harness({ root: h.root }); const replay = await restart.service.submit(body);
      assert.equal(replay.duplicate, true); assert.equal(restart.calls.create, 0);
    });
    await test('pending processing jobs enforce one active source and the monthly local ceiling', async () => {
      const h = harness(); await h.ready(18000); await h.source('source-2'); await h.clear('source-2');
      await rejects(() => h.service.submit({ actionId: h.action(), sourceId: 'source-2', confirmProcessing: true, maxCredits: 25 }), 'credit_budget_exceeded');
      assert.equal(h.service.snapshot().budget.reservedCredits, 300); assert.equal(h.calls.create, 1);
      const h2 = harness(); await h2.connect(); await h2.source(); await h2.clear();
      await h2.service.submit({ actionId: h2.action(), sourceId: 'source-1', confirmProcessing: true, maxCredits: 25 });
      await h2.source('source-2'); await h2.clear('source-2');
      await rejects(() => h2.service.submit({ actionId: h2.action(), sourceId: 'source-2', confirmProcessing: true, maxCredits: 25 }), 'processing_job_needs_attention');
    });
    await test('unknown paid outcomes persist and do not retry automatically', async () => {
      const h = harness(); await h.connect(); await h.source(); await h.clear(); h.state.createError = new Error('network lost');
      const input = { actionId: h.action(), sourceId: 'source-1', confirmProcessing: true, maxCredits: 25 };
      const result = await h.service.submit(input); assert.equal(result.snapshot.jobs[0].state, 'submission_unknown');
      await h.service.poll(); await h.service.submit(input); assert.equal(h.calls.create, 1);
      assert.equal(result.snapshot.jobs[0].errorCode, 'provider_unreachable');
    });
    await test('persist failure before intent prevents network; lost local acknowledgement preserves duplicate protection', async () => {
      let broken = false;
      const h = harness({ writer: (deps, file, data) => { if (broken) throw new Error('disk full'); writeFileDurable(deps, file, data); } });
      await h.connect(); await h.source(); await h.clear(); broken = true;
      const input = { actionId: h.action(), sourceId: 'source-1', confirmProcessing: true, maxCredits: 25 };
      await rejects(() => h.service.submit(input), 'storage_unavailable'); assert.equal(h.calls.create, 0);
      broken = false; h.client.create = async () => { h.calls.create++; broken = true; return 'Pcreated'; };
      await rejects(() => h.service.submit(input), 'storage_unavailable'); assert.equal(h.calls.create, 1);
      const restart = harness({ root: h.root });
      const replay = await restart.service.submit(input); assert.equal(replay.duplicate, true); assert.equal(replay.snapshot.jobs[0].state, 'submission_unknown'); assert.equal(restart.calls.create, 0);
    });
    await test('manual reconciliation links a verified project after an ambiguous submission without new spend', async () => {
      const h = harness(); await h.connect(); await h.source(); await h.clear(); h.state.createError = new Error('lost reply');
      const result = await h.service.submit({ actionId: h.action(), sourceId: 'source-1', confirmProcessing: true, maxCredits: 25 });
      const body = { actionId: h.action(), jobId: result.targetId, projectId: 'Pfound-in-opus', evidence: 'Matched THE LAB source-1 and source video in Opus.', confirmSourceMatch: true };
      h.state.noClips = true; await rejects(() => h.service.reconcile(body), 'project_not_ready_to_reconcile');
      assert.equal(h.service.snapshot().jobs[0].projectId, null);
      h.state.noClips = false; await h.service.reconcile(body); const snap = h.service.snapshot();
      assert.equal(snap.jobs[0].state, 'review'); assert.equal(snap.jobs[0].projectId, 'Pfound-in-opus');
      assert.equal(snap.jobs[0].reconciliation.evidence, body.evidence); assert.equal(h.calls.create, 1);
    });
    await test('polling resumes after restart, backs off, and pauses on authorization failure', async () => {
      const h = harness(); await h.connect(); await h.source(); await h.clear();
      await h.service.submit({ actionId: h.action(), sourceId: 'source-1', confirmProcessing: true, maxCredits: 25 });
      const restart = harness({ root: h.root }); restart.setClock('2026-10-02T10:00:31.000Z');
      restart.state.readError = Object.assign(fail('provider_unreachable', 502), { providerStatus: 500 });
      await rejects(() => restart.service.poll(), 'provider_unreachable'); const first = restart.calls.clips;
      await restart.service.poll(); assert.equal(restart.calls.clips, first);
      restart.setClock('2026-10-02T10:02:00.000Z'); restart.state.readError = Object.assign(fail('provider_access_required', 502), { providerStatus: 401 });
      await rejects(() => restart.service.poll(), 'provider_access_required');
      assert.equal(restart.service.snapshot().jobs[0].state, 'attention'); assert.equal(restart.service.snapshot().jobs[0].nextCheckAt, null);
      restart.state.readError = null; await restart.service.refresh({ actionId: 'fresh-refresh', jobId: restart.service.snapshot().jobs[0].id });
      assert.equal(restart.service.snapshot().jobs[0].state, 'review'); assert.equal(restart.calls.create, 0);
    });
    await test('empty exports stay processing and eventually require attention rather than claim completion', async () => {
      const h = harness(); await h.ready(); h.state.noClips = true; h.setClock('2026-10-02T12:00:00.000Z');
      await h.service.refresh({ actionId: h.action(), jobId: h.service.snapshot().jobs[0].id });
      const snap = h.service.snapshot(); assert.equal(snap.jobs[0].state, 'attention'); assert.equal(snap.clips[0].available, false);
    });
    await test('review binds the rendered version and rejects missing editorial checks or an unknown channel', async () => {
      const h = harness(), clip = await h.ready(), body = h.approval(clip);
      await rejects(() => h.service.approve({ ...body, checks: { ...checks, originality: false } }), 'editorial_review_required');
      await rejects(() => h.service.approve({ ...body, accountId: 'unknown' }), 'youtube_account_required');
      await rejects(() => h.service.approve({ ...body, fingerprint: 'old' }), 'clip_changed_review_again');
      await rejects(() => h.service.approve({ ...body, publishAt: '2026-10-02T10:05:00.000Z' }), 'schedule_at_least_ten_minutes_ahead');
      const a = await h.service.approve(body); assert.equal(a.snapshot.approvals[0].valid, true);
      h.state.clipRevision++;
      await rejects(() => h.service.schedule({ actionId: h.action(), approvalId: a.targetId, confirmPublication: true }), 'clip_changed_review_again');
      assert.equal(h.calls.schedule, 0); assert.equal(h.service.snapshot().approvals[0].valid, false);
    });
    await test('scheduled posts are durable, duplicate protected and never labeled published', async () => {
      const h = harness(), clip = await h.ready(), a = await h.service.approve(h.approval(clip));
      const body = { actionId: h.action(), approvalId: a.targetId, confirmPublication: true };
      await rejects(() => h.service.schedule({ ...body, confirmPublication: false }), 'publication_confirmation_required');
      const [p, retry] = await Promise.all([h.service.schedule(body), h.service.schedule(body)]);
      assert.equal(h.calls.schedule, 1); assert.equal(retry.duplicate, true); assert.equal(p.snapshot.publications[0].state, 'scheduled');
      const restart = harness({ root: h.root }); assert.equal((await restart.service.schedule(body)).duplicate, true); assert.equal(restart.calls.schedule, 0);
      await rejects(() => h.service.schedule({ ...body, actionId: h.action() }), 'clip_already_scheduled');
      await h.service.cancel({ actionId: h.action(), publicationId: p.targetId, confirmCancellation: true });
      assert.equal(h.service.snapshot().publications[0].state, 'canceled'); assert.equal(h.calls.cancel, 1);
    });
    await test('changing approved metadata supersedes the older approval', async () => {
      const h = harness(), clip = await h.ready(), first = await h.service.approve(h.approval(clip));
      await h.service.approve({ ...h.approval(clip), title: 'Revised approved title' });
      assert.equal(h.service.snapshot().approvals[0].valid, false);
      await rejects(() => h.service.schedule({ actionId: h.action(), approvalId: first.targetId, confirmPublication: true }), 'approval_superseded');
      assert.equal(h.calls.schedule, 0);
    });
    await test('unavailable current channel and failed refresh prevent publication', async () => {
      const h = harness(), clip = await h.ready(), a = await h.service.approve(h.approval(clip));
      h.state.accounts = [];
      await rejects(() => h.service.schedule({ actionId: h.action(), approvalId: a.targetId, confirmPublication: true }), 'youtube_account_required');
      h.state.accounts = [{ id: 'youtube-account', name: 'Channel' }]; h.state.readError = fail('provider_unreachable', 502);
      await rejects(() => h.service.schedule({ actionId: h.action(), approvalId: a.targetId, confirmPublication: true }), 'provider_unreachable'); assert.equal(h.calls.schedule, 0);
    });
    await test('ambiguous scheduling survives restart and never publishes twice', async () => {
      const h = harness(), clip = await h.ready(), a = await h.service.approve(h.approval(clip)); h.state.scheduleError = new Error('timeout');
      const body = { actionId: h.action(), approvalId: a.targetId, confirmPublication: true };
      const r = await h.service.schedule(body); assert.equal(r.snapshot.publications[0].state, 'schedule_unknown');
      const restart = harness({ root: h.root }); await restart.service.schedule(body); assert.equal(restart.calls.schedule, 0);
    });
    await test('cancellation uncertainty is visible and expired schedules cannot be called canceled', async () => {
      const h = harness(), clip = await h.ready(), a = await h.service.approve(h.approval(clip));
      const p = await h.service.schedule({ actionId: h.action(), approvalId: a.targetId, confirmPublication: true });
      h.setClock('2026-10-04T10:00:00.000Z');
      await rejects(() => h.service.cancel({ actionId: h.action(), publicationId: p.targetId, confirmCancellation: true }), 'scheduled_time_passed_check_youtube');
      h.setClock('2026-10-02T10:00:00.000Z'); h.state.cancelError = new Error('timeout');
      const r = await h.service.cancel({ actionId: h.action(), publicationId: p.targetId, confirmCancellation: true }); assert.equal(r.snapshot.publications[0].state, 'cancel_unknown');
    });
    await test('corrupt, backup-only, checksum-edited and future-version ledgers fail closed', async () => {
      const h = harness(); await h.source(); await h.clear(); const original = fs.readFileSync(h.file, 'utf8');
      for (const data of ['{', JSON.stringify({ ...JSON.parse(original), checksum: 'wrong' }), JSON.stringify({ format: 'thelab.shorts.v2', checksum: 'x', state: {} })]) {
        fs.writeFileSync(h.file, data); assert.throws(() => h.service.snapshot(), /storage_unavailable/); assert.equal(fs.readFileSync(h.file, 'utf8'), data);
      }
      fs.unlinkSync(h.file); assert.throws(() => h.service.snapshot(), /storage_unavailable/);
    });
    await test('station backups preserve the ledger bytes without promoting an old paid-action history', async () => {
      const h = harness(); await h.connect(); await h.source(); await h.clear();
      const good = recovery.capture({ fs, path, workspaceRoot: h.root, now: 1790935200000, appVersion: 'test', browserStore: {} });
      assert.ok(good.files.some(f => f.path === 'shorts/workflow.ledger'));
      assert.equal(good.files.some(f => f.path.startsWith('.secrets/')), false);
      fs.writeFileSync(h.file, '{corrupt');
      const bad = recovery.capture({ fs, path, workspaceRoot: h.root, now: 1790935200000, appVersion: 'test', browserStore: {} });
      const entry = bad.files.find(f => f.path === 'shorts/workflow.ledger');
      assert.equal(Buffer.from(entry.data, 'base64').toString('utf8'), '{corrupt');
      assert.equal(bad.files.some(f => f.path.endsWith('.bak')), false);
    });
    await test('unreadable ledgers cannot be replaced and concurrent instances preserve independent sources', async () => {
      const h = harness(); await h.source();
      const blockedFs = Object.create(fs); blockedFs.readFileSync = function(file, ...args) { if (file === h.file) throw Object.assign(new Error('locked'), { code: 'EACCES' }); return fs.readFileSync(file, ...args); };
      const bad = harness({ root: h.root, fs: blockedFs }); assert.throws(() => bad.service.snapshot(), /storage_unavailable/);
      const second = harness({ root: h.root });
      await Promise.all([h.service.addSource({ actionId: 'parallel-one', sourceId: 'source-2', title: 'T', creator: 'C', kind: 'licensed_file', url: 'https://drive.google.com/file/d/two/view', durationSec: 10 }),
        second.service.addSource({ actionId: 'parallel-two', sourceId: 'source-3', title: 'T', creator: 'C', kind: 'licensed_file', url: 'https://drive.google.com/file/d/three/view', durationSec: 10 })]);
      assert.equal(h.service.snapshot().sources.length, 3);
    });
    console.log('shorts.test: ' + count + ' scenarios passed');
  } finally { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });

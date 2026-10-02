'use strict';

const crypto = require('node:crypto');
const VERSION = 1;
const MONTHLY_CREDITS = 300;
const LIMITS = { sources: 200, jobs: 200, clips: 2000, approvals: 2000, publications: 2000, actions: 5000 };
function fail(code, status = 400) { return Object.assign(new Error(code), { code, status, shortsError: true }); }
function check(ok, code, status) { if (!ok) throw fail(code, status); }
function object(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function fields(v, allowed) { check(object(v) && Object.keys(v).every(k => allowed.includes(k)), 'invalid_fields'); }
function text(v, max = 1000, empty = false) {
  check(typeof v === 'string' && v.length <= max && (empty || v.trim().length > 0) && !/[\x00-\x08\x0b-\x1f]/.test(v), 'invalid_text');
  return v.trim();
}
function id(v) { check(typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v), 'invalid_id'); return v; }
function integer(v, min, max) { check(Number.isSafeInteger(v) && v >= min && v <= max, 'invalid_number'); return v; }
function iso(v) { check(typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v, 'invalid_time'); return v; }
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (object(v)) return Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])]));
  return v;
}
function digest(v) { return crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex'); }
function httpsUrl(value) {
  text(value, 2048);
  let u; try { u = new URL(value); } catch (_) { throw fail('invalid_url'); }
  check(u.protocol === 'https:' && !u.username && !u.password && !u.hash && (!u.port || u.port === '443'), 'invalid_url');
  return u;
}
// Only provider-supported public sources. Never fetch arbitrary URLs from the local host.
// Signed URLs/embedded credentials belong in a future encrypted asset store, not this ledger.
function sourceUrl(value, kind) {
  const u = httpsUrl(value), h = u.hostname;
  if (kind === 'verified_youtube') {
    let videoId;
    if (h === 'youtu.be') videoId = u.pathname.slice(1);
    else if (h === 'www.youtube.com' || h === 'youtube.com') {
      check(u.pathname === '/watch', 'invalid_youtube_url'); videoId = u.searchParams.get('v');
    }
    check(/^[A-Za-z0-9_-]{11}$/.test(videoId || '') && [...u.searchParams.keys()].every(k => k === 'v'), 'invalid_youtube_url');
    return 'https://www.youtube.com/watch?v=' + videoId;
  }
  check(kind === 'licensed_file', 'invalid_source_kind');
  const drive = h === 'drive.google.com' && /^\/file\/d\/[A-Za-z0-9_-]+\/view$/.test(u.pathname);
  const dropbox = h === 'www.dropbox.com' || h === 'dl.dropboxusercontent.com';
  const s3 = /^(?:[a-z0-9.-]+\.)?s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(h) && /\.mp4$/i.test(u.pathname);
  check(drive || dropbox || s3, 'unsupported_source_host');
  check([...u.searchParams.keys()].every(k => drive ? k === 'usp' : dropbox ? k === 'dl' || k === 'raw' : false), 'signed_source_url_not_supported');
  if (drive) u.search = '';
  return u.href;
}
function mediaUrl(value) {
  const u = httpsUrl(value);
  check(u.hostname.endsWith('.cdn.opus.pro'), 'invalid_provider_media', 502);
  return u.href;
}
function initialState() {
  return { schemaVersion: VERSION, updatedAt: null, connection: { orgId: null, verifiedAt: null, accounts: [] },
    sources: [], jobs: [], clips: [], approvals: [], publications: [], actions: [] };
}
function budget(state, now) {
  const month = iso(now).slice(0, 7);
  const reserved = state.jobs.filter(j => j.month === month).reduce((n, j) => n + j.reservedCredits, 0);
  return { month, limitCredits: MONTHLY_CREDITS, reservedCredits: reserved, remainingCredits: Math.max(0, MONTHLY_CREDITS - reserved),
    basis: 'local_estimate_from_declared_source_duration', providerBalance: null, automaticTopUps: false };
}
function validateState(s) {
  fields(s, ['schemaVersion', 'updatedAt', 'connection', ...Object.keys(LIMITS)]);
  check(s.schemaVersion === VERSION, 'unsupported_schema', 503);
  if (s.updatedAt !== null) iso(s.updatedAt);
  fields(s.connection, ['orgId', 'verifiedAt', 'accounts']);
  if (s.connection.orgId !== null) id(s.connection.orgId);
  if (s.connection.verifiedAt !== null) iso(s.connection.verifiedAt);
  check(Array.isArray(s.connection.accounts) && s.connection.accounts.length <= 100, 'invalid_accounts');
  for (const a of s.connection.accounts) { fields(a, ['id', 'name']); id(a.id); text(a.name, 200); }
  for (const [name, limit] of Object.entries(LIMITS)) {
    check(Array.isArray(s[name]) && s[name].length <= limit, 'invalid_records');
    const ids = new Set();
    for (const row of s[name]) { check(object(row), 'invalid_record'); id(row.id); check(!ids.has(row.id), 'duplicate_record'); ids.add(row.id); }
  }
  for (const source of s.sources) {
    fields(source, ['id', 'title', 'creator', 'url', 'kind', 'durationSec', 'createdAt', 'clearance']);
    text(source.title, 200); text(source.creator, 200); sourceUrl(source.url, source.kind); integer(source.durationSec, 1, 18000); iso(source.createdAt);
    if (source.clearance !== null) {
      fields(source.clearance, ['evidence', 'attribution', 'originalityPlan', 'clearedAt']);
      text(source.clearance.evidence); text(source.clearance.attribution); text(source.clearance.originalityPlan); iso(source.clearance.clearedAt);
    }
  }
  for (const job of s.jobs) {
    fields(job, ['id', 'sourceId', 'orgId', 'projectId', 'state', 'month', 'reservedCredits', 'createdAt', 'checkedAt', 'nextCheckAt', 'errorCode', 'pollFailures', 'reconciliation']);
    check(s.sources.some(x => x.id === job.sourceId && x.clearance), 'invalid_job_source'); id(job.orgId);
    check(['submitting', 'submission_unknown', 'processing', 'review', 'attention', 'rejected'].includes(job.state), 'invalid_job_state');
    if (job.projectId !== null) id(job.projectId);
    integer(job.reservedCredits, 10, MONTHLY_CREDITS); iso(job.createdAt); check(job.month === job.createdAt.slice(0, 7), 'invalid_budget_month');
    if (job.checkedAt !== null) iso(job.checkedAt); if (job.nextCheckAt !== null) iso(job.nextCheckAt); integer(job.pollFailures, 0, 100000);
    if (job.reconciliation !== null) { fields(job.reconciliation, ['evidence', 'confirmedAt']); text(job.reconciliation.evidence); iso(job.reconciliation.confirmedAt); }
  }
  check(new Set(s.jobs.map(j => j.sourceId)).size === s.jobs.length, 'duplicate_source_job');
  const projects = s.jobs.filter(j => j.projectId).map(j => j.projectId);
  check(new Set(projects).size === projects.length, 'duplicate_provider_project');
  for (const c of s.clips) {
    fields(c, ['id', 'jobId', 'providerClipId', 'fingerprint', 'title', 'durationMs', 'previewUrl', 'exportUrl', 'available', 'fetchedAt']);
    check(s.jobs.some(j => j.id === c.jobId), 'invalid_clip_job'); id(c.providerClipId); check(/^[a-f0-9]{64}$/.test(c.fingerprint), 'invalid_fingerprint');
    text(c.title, 200); integer(c.durationMs, 1, 180000); mediaUrl(c.previewUrl); mediaUrl(c.exportUrl); check(typeof c.available === 'boolean', 'invalid_available'); iso(c.fetchedAt);
  }
  for (const a of s.approvals) {
    fields(a, ['id', 'clipId', 'fingerprint', 'accountId', 'title', 'description', 'publishAt', 'editorialNotes', 'approvedAt']);
    check(s.clips.some(c => c.id === a.clipId), 'invalid_approval_clip'); id(a.accountId); text(a.title, 100); text(a.description, 4500, true); text(a.editorialNotes); iso(a.publishAt); iso(a.approvedAt);
    check(/^[a-f0-9]{64}$/.test(a.fingerprint), 'invalid_fingerprint');
  }
  for (const p of s.publications) {
    fields(p, ['id', 'approvalId', 'clipId', 'scheduleId', 'state', 'createdAt', 'errorCode']);
    check(s.approvals.some(a => a.id === p.approvalId && a.clipId === p.clipId), 'invalid_publication');
    check(['scheduling', 'schedule_unknown', 'scheduled', 'rejected', 'canceling', 'cancel_unknown', 'canceled'].includes(p.state), 'invalid_publication_state');
    if (p.scheduleId !== null) id(p.scheduleId); iso(p.createdAt);
  }
  check(new Set(s.publications.map(p => p.clipId)).size === s.publications.length, 'duplicate_clip_publication');
  for (const a of s.actions) {
    fields(a, ['id', 'digest', 'type', 'targetId', 'at']); check(/^[a-f0-9]{64}$/.test(a.digest), 'invalid_action'); text(a.type, 100); id(a.targetId); iso(a.at);
  }
  return s;
}
module.exports = { VERSION, MONTHLY_CREDITS, LIMITS, fail, check, object, fields, text, id, integer, iso, digest, sourceUrl, mediaUrl, initialState, validateState, budget };

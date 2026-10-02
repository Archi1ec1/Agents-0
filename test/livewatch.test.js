/* node test/livewatch.test.js — the LIVE panel's pure core (frontend/app/livewatch.js).
   Folds real runtime events into "who is running, on which step, for how much" with an injected clock. */
'use strict';
const A = require('./_assert.js');
const LiveWatch = require('../frontend/app/livewatch.js');

const lw = LiveWatch.create();
let t = 1000;
lw.onEvent('agent.run.start', { agentId: 'agent', runId: 'r1', trigger: 'directive', model: 'gpt-5.5' }, t);
lw.onEvent('agent.tool_call', { agentId: 'agent', runId: 'r1', callId: 'c1', name: 'fs.write', argsSummary: 'notes.md' }, t += 100);
let s = lw.snapshot(t);
A.eq(s.active.length, 1, 'one running agent');
A.eq(s.active[0].tool, 'fs.write', 'current step is the open tool call');
A.eq(s.active[0].steps, 1, 'step counted');
A.eq(s.feed[0].text, 'fs.write · notes.md', 'feed shows the newest step first');

lw.onEvent('agent.cost', { agentId: 'agent', runId: 'r1', usd: 0.02, reconciled: true }, t += 100);
lw.onEvent('agent.cost', { agentId: 'agent', runId: 'r1', usd: 0.03, reconciled: true }, t += 100);
lw.onEvent('agent.tool_result', { agentId: 'agent', runId: 'r1', callId: 'c1', ok: true, isError: false }, t += 100);
s = lw.snapshot(t);
A.ok(Math.abs(s.active[0].usd - 0.05) < 1e-9, 'run spend sums per-turn cost events');
A.ok(Math.abs(s.sessionUsd - 0.05) < 1e-9, 'window spend sums every run');
A.eq(s.active[0].tool, '', 'a finished step clears the current step');

// a run whose start was never seen (joined mid-flight) still shows up
lw.onEvent('agent.tool_call', { agentId: 'crew-2', runId: 'r2', callId: 'c2', name: 'web_search' }, t += 100);
lw.onEvent('agent.tool_result', { agentId: 'crew-2', runId: 'r2', callId: 'c2', ok: false, isError: true, summary: 'rate limited' }, t += 100);
s = lw.snapshot(t);
A.eq(s.active.length, 2, 'mid-flight run is tracked');
A.eq(s.feed[0].kind, 'error', 'a failed step is flagged in the feed');

lw.onEvent('agent.run.end', { agentId: 'agent', runId: 'r1', reason: 'done', turns: 3, usd: 0.05 }, t += 100);
s = lw.snapshot(t);
A.eq(s.active.length, 1, 'finished run leaves the working list');
A.eq(s.recent.length, 1, 'and appears under just finished');
A.eq(s.recent[0].reason, 'done', 'with its end reason');
s = lw.snapshot(t + 91000);
A.eq(s.recent.length, 0, 'finished runs age out after 90 seconds');

// bad input never throws or produces NaN
lw.onEvent('agent.cost', { runId: 'r3', usd: 'abc' }, t);
lw.onEvent('agent.cost', null, t);
A.ok(isFinite(lw.snapshot(t).sessionUsd), 'malformed cost never poisons the total');

// feed is bounded
for (let i = 0; i < 200; i++) lw.onEvent('agent.tool_call', { agentId: 'agent', runId: 'r4', callId: 'x' + i, name: 'fs.read' }, t + i);
A.ok(lw.snapshot(t + 300).feed.length <= 60, 'feed is capped');

A.report('livewatch.test');

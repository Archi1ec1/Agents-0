'use strict';
/* test/station-layout.test.js — station.layout, the lead's read-only view of the floor (2026-09-28; builds on PR #48
   by @mvanhorn). Runs the REAL page verb (frontend/app/stationcommands.js in a vm) over a REAL WorldModel station, the
   REAL Pipeline compiler and the REAL WorkflowLine readers, through the sidecar tool and a bridge stub, so what the
   model reads is what the Workflow panel shows. Held to:
     1. order and hand-offs are COMPILED and keyed by BAY: one agent crewing two Bays is two steps, each with its own
        hand-off (the agent-keyed plan.chains view answered the second Bay with the first Bay's record);
     2. a brief is the text the agent RECEIVES (the compiled brief + its HANDS OFF phrase);
     3. status and blockers are the panel's readiness, so a crew with no workstation is NOT reported clean;
     4. what starts a line comes from the panel's three reads, and an unread fact is said, never read as "nothing";
     5. routing is the plan poster's verdict, and one blocking error means routing is off for the WHOLE station;
     6. it never mutates the station or posts a plan, and every refusal is an answer. */
const A = require('./_assert.js');
const fs = require('node:fs');
const vm = require('node:vm');
const { makeStationTools } = require('../sidecar/tools/builtin/station.js');
const WorldModel = require('../frontend/app/worldmodel.js');
const Pipeline = require('../frontend/app/pipeline.js');
const WorkflowLine = require('../frontend/app/workflowline.js');
const Sprites = require('../frontend/app/propsprites.js');
const Templates = require('../frontend/app/stationtemplates.js');
const commands = fs.readFileSync(require.resolve('../frontend/app/stationcommands.js'), 'utf8');

const LIVE = { station: true, pending: false, errors: [], hash: 'h1', lastHash: 'k1', refusedHash: null, pendingHash: null, inflight: false, retryPending: false, stale: false };
const BUILD = { nagLabel: c => 'LABEL:' + c, nagWhy: c => (c === 'CYCLE' ? 'WHY:' + c : 'LABEL:' + c) };
const QUIET = { '/api/cron': { enabled: true, halted: false, jobs: [] }, '/api/channels/status': {}, '/api/routing/triggers': { triggers: [] } };
const liveWorld = over => ({ planStatus: () => Object.assign({}, LIVE, over || {}),
  syncPlan: () => { throw new Error('a read must never recompile or post the plan'); } });

// boot the page verb in a vm. `server` maps GET urls to answers (an Error = network failure, missing = 404).
function boot(o) {
  o = o || {};
  const acks = [], calls = [];
  const server = o.server || QUIET;
  const context = Object.assign({
    App: o.app, WorldModel, Pipeline, WorkflowLine, Build: BUILD, World: o.world === undefined ? liveWorld() : o.world,
    fetch: async (url, init) => {
      calls.push(String(url) + ' ' + ((init && init.method) || 'GET'));
      if (url === '/api/station/ack') { acks.push(JSON.parse(init.body)); return { ok: true }; }
      const v = server[url];
      if (v instanceof Error) throw v;
      if (v === undefined) return { ok: false, status: 404, json: async () => null };
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(v)) };
    },
    document: { addEventListener: () => {} }, console, setTimeout, clearTimeout, AbortController, Intl
  }, o.globals || {});
  vm.createContext(context);
  const S = vm.runInContext(commands + '\nStationCommands;', context);
  const tools = makeStationTools({ station: { request: async (verb, args) => { await S.run('r' + acks.length, verb, args); return acks.at(-1); } } });
  return { tools, calls };
}
async function layout(o, args) {
  const b = boot(o);
  const out = await b.tools.layoutTool.run(args || {});
  return { out, calls: b.calls, r: /^REFUSED/.test(out.content) ? null : JSON.parse(out.content) };
}
// the Creative Studio preset: INBOX -> Draft Bay -> Review Bay -> OUTBOX. crew[i] crews bay i; desks = a workstation each.
function creative(crew, desks) {
  const st = WorldModel.create(Templates.build('creative', WorldModel, Sprites));
  if (desks) for (const a of new Set(crew.filter(Boolean))) A.ok(st.ensureWorkstation(a).ok, 'fixture: a desk for ' + a);
  const bays = Templates.example(st.serialize(), WorldModel, Pipeline).roles.map(r => r.propId);
  // assign in REVERSE prop order: the answer must follow the compiled hand-offs, never the saved array
  for (let i = crew.length - 1; i >= 0; i--) if (crew[i]) A.ok(st.assignPropAgent(bays[i], crew[i]).ok, 'fixture: ' + crew[i] + ' crews bay ' + (i + 1));
  return { st, bays };
}
const lineKeyOf = st => Pipeline.lineComponents(st.projectGeometry()).find(c => c.bays.length).key;
const refs = list => list.map(x => typeof x === 'string' ? x : x.step + ':' + x.agent);

(async () => {
  /* ---- 1. a crewed, equipped line: compiled order, hand-offs, briefs, rooms, tools, READY, read-only ---- */
  {
    const { st, bays } = creative(['drafter', 'reviewer'], true);
    const agents = [{ id: 'drafter', name: 'Ada' }, { id: 'reviewer', name: 'Rex' }];
    const before = JSON.stringify(st.serialize());
    const { out, r, calls } = await layout({ app: { station: () => st, agents: () => agents } });
    A.ok(!!r, 'the layout answers: ' + out.content.slice(0, 160));
    A.eq(JSON.stringify(st.serialize()), before, 'reading the layout never mutates the station');
    A.ok(!calls.some(c => /\/api\/routing (POST|PUT)/.test(c)), 'and never posts a routing plan: ' + calls.join(', '));
    A.eq(calls.filter(c => / GET$/.test(c)).sort(), ['/api/channels/status GET', '/api/cron GET', '/api/routing/triggers GET'], 'it reads exactly the three facts the Workflow panel reads');
    A.eq(out.summary, '"CREATIVE · DRAFT & REVIEW": READY TO RUN · routing live', 'a one-line floor: the summary names the line and its pill');
    A.eq(r.routing.state, 'live', 'routing is live when the poster says the router holds this floor');
    A.eq(r.lines.length, 1, 'one assembly line');
    const L = r.lines[0];
    A.eq(L.name, 'CREATIVE · DRAFT & REVIEW', 'the line is named by its Inbox label');
    A.eq(L.status, 'READY TO RUN', 'the status is the panel\'s own pill');
    A.eq(L.ready, true, 'and it is ready');
    A.eq(L.blocking, [], 'nothing blocks it');
    A.ok(L.hints.some(h => /^nothing starts it yet/.test(h)), 'the panel\'s hint says nothing starts it: ' + JSON.stringify(L.hints));
    A.ok(/^Nothing starts it on its own yet .* it runs when you test it\. ADA works on it then REX works on it; the result goes to the OUTBOX\.$/.test(L.howItRuns), 'the panel sentence, verbatim: ' + L.howItRuns);
    A.eq(L.steps.map(s => s.agent && s.agent.name), ['Ada', 'Rex'], 'steps follow the compiled hand-off, not the reverse assignment order');
    A.eq(L.steps.map(s => s.propId), bays, 'step 1 is the Draft Bay, step 2 the Review Bay');
    const [s1, s2] = L.steps;
    A.ok(/^Draft a response/.test(s1.brief) && /^Review the incoming draft/.test(s2.brief), 'each step carries its Bay brief');
    A.eq([s1.fedByInbox, s2.fedByInbox], [true, false], 'only step 1 is fed by the Inbox');
    A.eq(refs(s1.getsWorkFrom), ['INBOX'], 'step 1 gets its work from the INBOX');
    A.eq(refs(s1.sendsTo), ['2:REX'], 'step 1 hands off to step 2');
    A.eq(refs(s2.getsWorkFrom), ['1:ADA'], 'step 2 gets its work from step 1');
    A.eq(refs(s2.sendsTo), ['OUTBOX'], 'step 2 ships to the OUTBOX');
    A.eq([s1.room, s2.room], ['DRAFT & REVIEW', 'DRAFT & REVIEW'], 'steps name their room');
    A.ok(s1.tools.indexOf('computer') >= 0 && s2.tools.indexOf('computer') >= 0, 'a crewed step lists the tools its run gets there: ' + JSON.stringify(s1.tools));
    A.eq([s1.routed, s2.routed], [true, true], 'both steps are routed today');
    A.eq(L.issues, [], 'a configured line carries no routing issue');
    A.eq(r.otherIssues, [], 'and the floor has none off the line');
    A.eq(r.rooms.length, 3, 'rooms are listed, corridors are not');
    A.ok(r.rooms.some(x => x.name === 'DRAFT & REVIEW'), 'rooms carry their names');
    const desks = r.workstations.filter(w => w.type === 'desk');
    A.eq(desks.map(w => w.agent.agentId).sort(), ['drafter', 'reviewer'], 'workstations list their holders');
    A.ok(desks.every(w => w.grants === 'computer'), 'a desk grants computer access');
    A.ok(r.workstations.every(w => w.type !== 'bay'), 'Bays are steps, never listed twice');
    A.ok(!r.note, 'no brief was cut, so there is no truncation note');
  }

  /* ---- 2. ONE agent crewing BOTH Bays (multi-bay): each Bay reports its OWN compiled hand-off ---- */
  {
    const { st, bays } = creative(['writer', 'writer'], true);
    const { r } = await layout({ app: { station: () => st, agents: () => [{ id: 'writer', name: 'Wren' }] } });
    const L = r.lines[0], [s1, s2] = L.steps;
    A.eq(L.steps.map(s => s.propId), bays, 'two Bays, two steps, in hand-off order');
    A.eq([s1.fedByInbox, s2.fedByInbox], [true, false], 'the second Bay is fed by the first, NOT by the Inbox');
    A.eq(refs(s1.sendsTo), ['2:WREN'], 'the first Bay hands off to the second');
    A.eq(refs(s2.sendsTo), ['OUTBOX'], 'the second Bay hands off to no one and ships to the OUTBOX');
    A.eq(refs(s2.getsWorkFrom), ['1:WREN'], 'the second Bay gets its work from the first');
    const plan = Pipeline.compileRoutingPlan(st.projectGeometry());
    for (const s of L.steps) {
      A.eq(s.fedByInbox, !!plan.reachDock[s.propId], 'fedByInbox is the compiler\'s own dock reach (' + s.propId + ')');
      A.eq(s.sendsTo.indexOf('OUTBOX') >= 0, !!(plan.dockChains[s.propId] || {}).outbox, 'OUTBOX is the compiler\'s own dock chain (' + s.propId + ')');
    }
    A.eq(L.status, 'READY TO RUN', 'a legal multi-bay line is ready');
  }

  /* ---- 3. HANDS OFF: the brief is what the agent RECEIVES ---- */
  {
    const { st, bays } = creative(['drafter', 'reviewer'], true);
    A.ok(st.setPropHands(bays[0], 'a 200-word draft').ok, 'fixture: a HANDS OFF phrase on the Draft Bay');
    const { r } = await layout({ app: { station: () => st, agents: () => [] } });
    const s1 = r.lines[0].steps[0];
    const received = Pipeline.compileRoutingPlan(st.projectGeometry()).dockBays.find(d => d.propId === bays[0]).brief;
    A.eq(s1.brief, received, 'the step brief is the compiled brief the agent receives');
    A.ok(/\n\nWhen you're done, hand off: a 200-word draft$/.test(s1.brief), 'including its HANDS OFF phrase: ' + JSON.stringify(s1.brief.slice(-60)));
    A.ok(/DRAFTER works on it, handing off a 200-word draft/.test(r.lines[0].howItRuns), 'and the sentence says the hand-off: ' + r.lines[0].howItRuns);
  }

  /* ---- 4. the WORKSTATION gate: a crewed line with no desks is blocked, never reported clean ---- */
  {
    const { st } = creative(['drafter', 'reviewer'], false);
    const { r } = await layout({ app: { station: () => st, agents: () => [] } });
    const L = r.lines[0];
    A.eq(L.status, '2 TO FIX · BAY 1 NEEDS A WORKSTATION', 'the panel\'s own pill: ' + L.status);
    A.eq(L.ready, false, 'not ready');
    A.eq(L.blocking, ['BAY 1 needs a workstation', 'BAY 2 needs a workstation'], 'both Bays need a workstation');
    A.eq(L.steps.map(s => s.tools), [[], []], 'and neither run has a tool there');
    A.eq(L.issues, [], '(the compiler has nothing to say: readiness is what blocks it)');
  }

  /* ---- 5. uncrewed Bays: listed with a note, the floor's own issue labels, blocked on an agent ---- */
  {
    const { st } = creative([null, null], false);
    const { r } = await layout({ app: { station: () => st, agents: () => [] } });
    const L = r.lines[0];
    A.eq(L.steps.map(s => s.agent), [null, null], 'unassigned steps are still listed');
    A.ok(L.steps.every(s => /^no agent yet/.test(s.note) && !s.routed && s.sendsTo.length === 0), 'each says it has no agent and routes nothing');
    A.eq(L.issues.map(i => [i.code, i.label, i.blocking]), [['UNBOUND_BAY', 'LABEL:UNBOUND_BAY', false], ['UNBOUND_BAY', 'LABEL:UNBOUND_BAY', false]], 'issues carry the floor\'s own label and are warnings');
    A.ok(L.issues.every(i => !('fix' in i)), 'no fix sentence when it would only repeat the label');
    A.ok(/^\d+ TO FIX · BAY 1 NEEDS AN AGENT$/.test(L.status), 'the pill names the missing agent: ' + L.status);
    A.ok(/\[pick an agent\]/.test(L.howItRuns) && /\[the result reaches the OUTBOX once every step has an agent\]/.test(L.howItRuns), 'the sentence marks the gaps: ' + L.howItRuns);
  }

  /* ---- 6. what STARTS the line: routines, channels, folder triggers, from the panel's three reads ---- */
  {
    const { st } = creative(['drafter', 'reviewer'], true);
    const key = lineKeyOf(st);
    const server = {
      '/api/cron': { enabled: true, halted: false, jobs: [{ id: 'j1', name: 'Morning run', agentId: 'drafter', runsLine: true, enabled: true, scheduleDisplay: 'daily 09:00', prompt: 'x' },
        { id: 'j2', name: 'Review only', agentId: 'reviewer', runsLine: true, enabled: true, scheduleDisplay: 'hourly' }] },
      '/api/channels/status': { telegram: { configured: true, connected: true, agentName: 'Ada' } },
      '/api/routing/triggers': { triggers: [{ id: 't1', lineId: key, kind: 'folder', enabled: true, blockedBy: null, config: { path: 'C:\\Drops' } }] }
    };
    const { r } = await layout({ app: { station: () => st, agents: () => [{ id: 'drafter', name: 'Ada' }, { id: 'reviewer', name: 'Rex' }] }, server });
    const L = r.lines[0];
    A.eq(L.starts.schedules, ['daily 09:00'], 'a whole-line routine at the entry Bay is a schedule');
    A.eq(L.starts.channels, ['Telegram'], 'a connected channel answering as the entry agent starts the line');
    A.eq(L.starts.events, ['when a file lands in C:\\Drops'], 'an armed folder trigger of this line starts it');
    A.eq(L.starts.routines.map(x => [x.name, x.agent, x.startsLine, x.atEntry]), [['Morning run', 'ADA', true, true], ['Review only', 'REX', false, false]],
      'every routine on the line is listed, with whether it starts the whole line');
    A.ok(L.starts.routines.every(x => !('prompt' in x)), 'routine prompts are not copied into the answer');
    A.eq(L.starts.channelBots, [{ label: 'Telegram', connected: true, answersAs: 'Ada', feedsThisLine: true }], 'channel rows say who they answer as and whether that feeds this line');
    A.ok(/^Daily 09:00, when a Telegram message arrives or when a file lands in C:\\Drops, ADA works on it/.test(L.howItRuns), 'the sentence leads with what starts it: ' + L.howItRuns);
    A.ok(!L.hints.some(h => /nothing starts it/.test(h)), 'and the "nothing starts it" hint is gone');
    A.ok(!('startsUnread' in L), 'every fact was read');
  }

  /* ---- 7. an UNREAD fact is said, never turned into "nothing starts it" ---- */
  {
    const { st } = creative(['drafter', 'reviewer'], true);
    const server = { '/api/cron': new Error('network down'), '/api/routing/triggers': { triggers: [] } };   // channels: 404
    const { r } = await layout({ app: { station: () => st, agents: () => [] }, server });
    const L = r.lines[0];
    A.eq(L.startsUnread, ['routines', 'channels'], 'the facts that could not be read are named');
    A.ok(/^What starts it could not be fully read right now \(routines, channels unavailable\); /.test(L.howItRuns), 'the sentence says so instead of "nothing starts it": ' + L.howItRuns);
    A.ok(!L.hints.some(h => /^nothing starts it/.test(h)), 'the "nothing starts it" hint is withdrawn');
    A.ok(L.hints.some(h => /could not be read/.test(h)), 'and replaced by an honest re-check hint: ' + JSON.stringify(L.hints));
  }

  /* ---- 8. ROUTING STATE is the poster's verdict; one blocking error is off for the WHOLE station ---- */
  {
    const { st } = creative(['drafter', 'reviewer'], true);
    const app = { station: () => st, agents: () => [] };
    const off = (await layout({ app, world: liveWorld({ errors: [{ code: 'CYCLE' }] }) })).r.routing;
    A.eq(off.state, 'off', 'a blocking error on the posted floor: routing is off');
    A.ok(/OFF for the whole station/.test(off.note) && /no line routes work/.test(off.note) && /LABEL:CYCLE/.test(off.note), 'and it says the whole station stops, with the floor\'s label: ' + off.note);
    A.eq((await layout({ app, world: liveWorld({ refusedHash: 'k1', lastHash: 'k1' }) })).r.routing.state, 'off', 'a refused post: routing is off');
    A.eq((await layout({ app, world: liveWorld({ stale: true }) })).r.routing.state, 'unconfirmed', 'a failed post: unconfirmed, never live');
    A.eq((await layout({ app, world: liveWorld({ inflight: true }) })).r.routing.state, 'unconfirmed', 'a post in flight: unconfirmed');
    A.eq((await layout({ app, world: liveWorld({ lastHash: null }) })).r.routing.state, 'unknown', 'no server answer yet: unknown');
    const pend = (await layout({ app, world: liveWorld({ pending: true }) })).r.routing;
    A.eq([pend.state, pend.pendingEdits], ['live', true], 'unsent edits: the router runs the previous floor');
    A.ok(/newer edits the router has not received yet/.test(pend.note), 'and the note says so: ' + pend.note);
    A.eq((await layout({ app, world: null })).r.routing.state, 'unknown', 'no world on the page: unknown, never live');
    A.eq((await layout({ app, world: liveWorld({ station: false }) })).r.routing.state, 'unknown', 'no floor loaded in the world: unknown');
    // a floor whose DRAWN state has a blocking error (a belt loop) that the router has not been sent yet
    const loopGeo = { props: [], belts: [{ x: 0, y: 0, dir: 'E' }, { x: 1, y: 0, dir: 'S' }, { x: 1, y: 1, dir: 'W' }, { x: 0, y: 1, dir: 'N' }] };
    const fake = { projectGeometry: () => loopGeo, rooms: () => [], bayObjects: () => [], propById: () => null, roomAt: () => null, roomById: () => null, props: () => [] };
    const drawn = (await layout({ app: { station: () => fake, agents: () => [] }, world: liveWorld({ pending: true }) })).r;
    A.ok(/As drawn now, the floor has a blocking error the router will refuse: LABEL:CYCLE\./.test(drawn.routing.note), 'a drawn blocking error is named before it is sent: ' + drawn.routing.note);
    A.eq(drawn.otherIssues.map(i => [i.code, i.blocking, i.fix]), [['CYCLE', true, 'WHY:CYCLE']], 'a finding on no line is reported floor-wide, with its fix sentence');
  }

  /* ---- 9. a finding on NO line is still reported ---- */
  {
    const plain = WorldModel.create(Templates.build('default', WorldModel, Sprites));
    const home = (await layout({ app: { station: () => plain, agents: () => [] } })).r;
    A.eq([home.rooms.length, home.lines, home.otherIssues], [1, [], []], 'a plain station: one room, no lines, no findings');
    const rect = plain.rooms()[0].rects[0];
    let orphan = null;
    for (let y = rect.y1; y <= rect.y2 && !orphan; y++) for (let x = rect.x1; x <= rect.x2 && !orphan; x++) {
      const res = plain.addProp({ t: 'intake', x, y });
      if (res && res.ok !== false && res.id) orphan = res.id;
    }
    A.ok(!!orphan, 'fixture: a beltless Inbox on the plain floor');
    const loose = (await layout({ app: { station: () => plain, agents: () => [] } })).r;
    const found = loose.otherIssues.concat(...loose.lines.map(l => l.issues)).filter(i => i.propId === orphan);
    A.eq(found.map(i => [i.code, i.blocking]), [['ORPHAN_SOURCE', false]], 'the beltless Inbox\'s finding is reported, never dropped: ' + JSON.stringify(loose.otherIssues));
  }

  /* ---- 10. a LOOP gate: said in the compiler's words, with its back-arc and pass limit ---- */
  {
    const s = WorldModel.create(), z = s.rooms()[0].rects[0];
    s.addRoom({ kind: 'hab', rect: { x1: z.x2 + 1, y1: z.y1, x2: z.x2 + 40, y2: z.y1 + 30 } });
    let ok = null;
    for (let y = z.y1; y < z.y1 + 25 && !ok; y++) for (let x = z.x1; x < z.x2 + 30 && !ok; x++) { const res = s.stampBlueprint('revision_loop', x, y); if (res.ok) ok = res; }
    A.ok(!!ok, 'fixture: the revision loop stamps');
    let n = 0; for (const p of s.props()) if (p.t === 'bay') s.assignPropAgent(p.id, 'a' + (++n));
    const L = (await layout({ app: { station: () => s, agents: () => [] } })).r.lines[0];
    const g = L.gates.find(x => x.kind === 'loop');
    A.ok(!!g, 'the loop gate is listed: ' + JSON.stringify(L.gates));
    const plan = Pipeline.compileRoutingPlan(s.projectGeometry());
    const jk = Object.keys(plan.junctions).find(k => plan.junctions[k].kind === 'loop');
    A.eq(g.maxPasses, plan.junctions[jk].max, 'with the compiled pass limit');
    A.eq(refs([g.sendsBackTo]), ['1:A1'], 'it sends work back to step 1');
    A.ok(/sends it back to A1 until it is approved \(\d+ tries max\)/.test(L.howItRuns), 'and the sentence says it: ' + L.howItRuns);
  }

  /* ---- 11. `line`: one line with full briefs; the overview cuts long briefs and says so ---- */
  {
    const { st, bays } = creative(['drafter', 'reviewer'], true);
    const long = 'Draft carefully. ' + 'x'.repeat(900);
    A.ok(st.setPropBrief(bays[0], long).ok, 'fixture: a long brief');
    const app = { station: () => st, agents: () => [] };
    const all = (await layout({ app })).r;
    const s1 = all.lines[0].steps[0];
    A.eq([s1.brief.length, s1.briefTruncated], [401, true], 'the overview cuts a long brief at 400 characters');
    A.ok(/pass line for one line with full briefs/.test(all.note), 'and says how to get the rest');
    const one = await layout({ app }, { line: 'draft & review' });
    A.eq(one.r.lines.length, 1, 'a unique name fragment picks the line');
    A.eq(one.r.lines[0].steps[0].brief, long, 'with the brief in full');
    A.ok(!one.r.note && !one.r.lines[0].steps[0].briefTruncated, 'nothing is cut');
    A.ok(/^"CREATIVE · DRAFT & REVIEW": READY TO RUN · routing live$/.test(one.out.summary), 'summary names the line and its pill: ' + one.out.summary);
    A.eq((await layout({ app }, { line: lineKeyOf(st) })).r.lines.length, 1, 'an exact lineId picks the line');
    const miss = (await layout({ app }, { line: 'nope' })).out.content;
    A.ok(/^REFUSED: there is no line called "nope"\. Lines: CREATIVE · DRAFT & REVIEW \(/.test(miss), 'an unknown line is refused with the real names: ' + miss);
  }

  /* ---- 12. refusals are answers, never an empty success ---- */
  {
    const { st } = creative(['drafter', 'reviewer'], true);
    A.ok(/^REFUSED: the station layout is not ready yet/.test((await layout({ app: { agents: () => [] } })).out.content), 'no station on the page: refused');
    A.ok(/^REFUSED: workflow routing is not loaded/.test((await layout({ app: { station: () => st, agents: () => [] }, globals: { Pipeline: undefined } })).out.content), 'no compiler: refused');
    A.ok(/^REFUSED: the workflow line reader is not loaded/.test((await layout({ app: { station: () => st, agents: () => [] }, globals: { WorkflowLine: undefined } })).out.content), 'no line reader: refused');
    A.ok(/^REFUSED: .*no station bridge/.test((await makeStationTools({}).layoutTool.run({})).content), 'no bridge: refused');
  }

  /* ---- 13. the capability registry is an allowlist: declared read-only and consent-free ---- */
  {
    const registry = fs.readFileSync(require.resolve('../sidecar/capability/registry.js'), 'utf8');
    A.ok(/capId: 'orchestrator', tool: 'station\.layout', scope: 'read', requiresConsent: false, network: false/.test(registry), 'station.layout is an allowlisted orchestrator read');
    const t = makeStationTools({}).layoutTool;
    A.eq([t.name, t.capability, t.scope, t.requiresConsent], ['station.layout', 'orchestrator', 'read', false], 'and the tool declares the same');
  }

  A.report('station-layout');
})().catch(e => { console.error(e); process.exit(1); });

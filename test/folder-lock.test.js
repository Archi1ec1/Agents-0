/* node test/folder-lock.test.js — ONE-FOLDER MODE.

   The Commander picks one folder; agents may do anything with files inside it and nothing outside it.
   Proven at both seams:
     • pathtrust.guard(lockRoot) on a REAL temp filesystem — inside allowed with no prompt, outside denied with
       no prompt, symlink escape denied, and Full Power / blessed roots do not widen the folder.
     • the consent broker (folderLock) — in-folder writes need no prompt on any surface, screen control is
       refused, commands ask every time (never cached, never Full Power) and are denied unattended. */
'use strict';
const A = require('./_assert.js');
const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { makePathTrust } = require('../sidecar/pathtrust.js');
const { makeConsentBroker } = require('../sidecar/permissions.js');

const ROOT = path.join(os.tmpdir(), 'starnet-folderlock-' + process.pid);
const LOCK = path.join(ROOT, 'agent0');
const OUTSIDE = path.join(ROOT, 'elsewhere');

async function rejects(promise, re, msg) {
  try { await promise; A.ok(false, msg + ' — did NOT reject'); }
  catch (e) { A.ok(!re || re.test(String(e && e.message)), msg + ' (got: ' + (e && e.message) + ')'); }
}
const neverPrompt = async () => { throw new Error('prompt must not be called in one-folder mode'); };

async function guardSuite() {
  fs.mkdirSync(path.join(LOCK, 'sub'), { recursive: true });
  fs.mkdirSync(OUTSIDE, { recursive: true });
  fs.writeFileSync(path.join(OUTSIDE, 'secret.txt'), 'x');
  const pt = makePathTrust({ fsp, pathMod: path, roots: () => [OUTSIDE], bless: async () => true, now: () => 1 });
  const lockReal = fs.realpathSync(LOCK);

  const r = await pt.guard(path.join(LOCK, 'sub', 'new.txt'), { scope: 'write', surface: 'autonomous', lockRoot: LOCK });
  A.eq(r.base, lockReal, 'inside the folder: allowed, base is the folder');
  A.ok(r.folderLock === true, 'result is marked as one-folder access');
  await pt.guard(LOCK, { scope: 'read', surface: 'autonomous', lockRoot: LOCK });
  A.ok(true, 'the folder itself is readable');

  await rejects(pt.guard(path.join(OUTSIDE, 'secret.txt'), { scope: 'read', surface: 'interactive', prompt: neverPrompt, lockRoot: LOCK }),
    /outside the Agent 0 folder/, 'outside the folder: denied even though it is a blessed root, with no prompt');
  await rejects(pt.guard(path.join(OUTSIDE, 'secret.txt'), { scope: 'read', surface: 'interactive', lockRoot: LOCK, fullAccess: true, unrestrictedHost: true }),
    /outside the Agent 0 folder/, 'Full Power does not widen the folder');
  await rejects(pt.guard(path.join(LOCK, '..', 'elsewhere', 'secret.txt'), { scope: 'read', surface: 'autonomous', lockRoot: LOCK }),
    /outside the Agent 0 folder/, '.. traversal out of the folder is denied');
  await rejects(pt.guard(path.join(LOCK, '.env'), { scope: 'read', surface: 'autonomous', lockRoot: LOCK }),
    /\.env/, 'protected-file floor still applies inside the folder');

  let linked = false;
  try { fs.symlinkSync(OUTSIDE, path.join(LOCK, 'escape'), 'junction'); linked = true; } catch (_) {}
  if (linked) await rejects(pt.guard(path.join(LOCK, 'escape', 'secret.txt'), { scope: 'read', surface: 'autonomous', lockRoot: LOCK }),
    /outside the Agent 0 folder/, 'a symlink inside the folder cannot walk back out');

  // without a lock the guard behaves as before: the blessed root is readable
  const ok = await pt.guard(path.join(OUTSIDE, 'secret.txt'), { scope: 'read', surface: 'autonomous' });
  A.ok(!!ok && !ok.folderLock, 'no lock: ordinary blessed-root behavior is unchanged');
}

function brokerSuite() {
  const FS_WRITE = { name: 'fs.write', capability: 'cabinet', scope: 'write', requiresConsent: true };
  const MEM_WRITE = { name: 'notebook.write', capability: 'memory', scope: 'write' };
  const SHELL = { name: 'shell.exec', capability: 'workbench', scope: 'execute', requiresConsent: true };
  const SCREEN = { name: 'computer.use', capability: 'physical-input', scope: 'execute' };
  const DESKTOP = { name: 'desktop.open', capability: 'visible-desktop', scope: 'execute' };
  const WEB = { name: 'web_fetch', capability: 'web', scope: 'read', network: true };
  const call = (name) => ({ name, args: {} });
  const locked = (extra) => makeConsentBroker(Object.assign({ folderLock: () => true }, extra || {}));

  A.ok(locked({ surface: 'autonomous' })(call('fs.write'), FS_WRITE).allow === true, 'unattended file write inside the folder: allowed');
  A.ok(locked({ surface: 'autonomous' })(call('notebook.write'), MEM_WRITE).allow === true, 'unattended memory write: allowed');
  const r1 = locked({ surface: 'interactive', prompt: () => { throw new Error('no prompt for in-folder writes'); } })(call('fs.write'), FS_WRITE);
  A.ok(r1.allow === true, 'watched file write inside the folder: no prompt');

  const s1 = locked({ bypass: true, unrestrictedHost: true })(call('computer.use'), SCREEN);
  A.ok(s1.allow === false && s1.hardline === true, 'screen control refused even with Full Power');
  A.ok(locked()(call('desktop.open'), DESKTOP).allow === false, 'visible desktop refused');

  const auto = locked({ surface: 'autonomous', bypass: true, grantsPermanent: new Set(['workbench:execute']), terminalGrant: () => true })(call('shell.exec'), SHELL);
  A.ok(auto.allow === false, 'unattended command denied despite Full Access, a standing grant and a routine terminal grant');

  const asked = [];
  const perm = new Set();
  const broker = locked({ surface: 'interactive', bypass: true, grantsPermanent: perm, prompt: (c) => { asked.push(c.name); return 'always'; } });
  return Promise.resolve(broker(call('shell.exec'), SHELL)).then((r) => {
    A.ok(r.allow === true, 'watched command allowed after a live yes');
    A.eq(asked.length, 1, 'watched command asked even with Full Access on');
    A.ok(!perm.has('workbench:execute'), '"always" is not remembered while locked');
    return Promise.resolve(broker(call('shell.exec'), SHELL));
  }).then(() => {
    A.eq(asked.length, 2, 'the next command asks again');
    return Promise.resolve(locked({ surface: 'interactive', prompt: () => 'deny' })(call('shell.exec'), SHELL));
  }).then((r) => {
    A.ok(r.allow === false, 'a live no denies the command');
    const off = makeConsentBroker({ surface: 'autonomous', folderLock: () => false })(call('fs.write'), FS_WRITE);
    A.ok(off.allow === false, 'lock off: unattended write default-denies as before');
    const web = locked({ surface: 'autonomous' })(call('web_fetch'), WEB);
    A.ok(web.allow === false, 'non-file tools fall through to the normal ladder (unattended network read still default-denies)');
  });
}

(async () => {
  try { await guardSuite(); await brokerSuite(); }
  catch (e) { A.ok(false, 'suite threw: ' + (e && e.stack || e)); }
  finally { try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_) {} }
  A.report('folder-lock.test');
})();

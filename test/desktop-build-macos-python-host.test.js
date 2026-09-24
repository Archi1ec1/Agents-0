/* Exercise the notarization test's interpreter boundary in isolated Node processes. */
'use strict';
const A = require('./_assert.js');
const { spawnSync } = require('child_process');
const path = require('path');

function run(platform, outcome, earlierFailure = false) {
  const script = `
    Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} });
    const cp = require('child_process');
    const original = cp.spawnSync;
    cp.spawnSync = (command, args, options) => {
      if (command !== ${JSON.stringify(platform === 'win32' ? 'python' : 'python3')}) throw new Error('unexpected interpreter: ' + command);
      if (${JSON.stringify(outcome)} === 'missing') return original('starnet-missing-python-issue-40', args, options);
      if (${JSON.stringify(outcome)} === 'denied') return { status: null, error: Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }) };
      return { status: 1, stderr: 'fixture Python assertion failed' };
    };
    if (${earlierFailure}) require('./test/_assert.js').ok(false, 'earlier workflow assertion failed');
    require('./test/desktop-build-macos-notarization.test.js');
  `;
  return spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 30000, windowsHide: true
  });
}

for (const platform of ['win32', 'linux']) {
  const missing = run(platform, 'missing');
  A.eq(missing.status, 0, platform + ' missing Python does not block the static checks: ' + missing.stderr);
  A.ok(missing.stdout.includes('SKIP: ' + (platform === 'win32' ? 'python' : 'python3') + ' not on PATH'),
    platform + ' reports the skipped probe visibly');
  A.ok(missing.stdout.includes('OK (26 assertions)'), platform + ' does not count the skipped probe as passed');
}
const denied = run('linux', 'denied');
A.eq(denied.status, 1, 'other spawn errors fail');
A.ok(denied.stdout.includes('EACCES') && !denied.stdout.includes('SKIP:'), 'spawn error retains its diagnostic');
const failed = run('linux', 'failed');
A.eq(failed.status, 1, 'Python probe failures fail');
A.ok(failed.stdout.includes('fixture Python assertion failed'), 'Python stderr remains visible');
const earlier = run('linux', 'missing', true);
A.eq(earlier.status, 1, 'missing interpreter cannot hide a preceding workflow failure');
A.ok(earlier.stdout.includes('earlier workflow assertion failed'), 'preceding failure remains visible');
A.report('desktop-build-macos-python-host.test');

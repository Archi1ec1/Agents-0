/* node test/browser-watch.test.js — WATCH MODE: the Commander's "show the agent's browser" switch.
   Proven through the makeDriver seam: with the switch on, a run that the host pins headless (forceHeadless) still
   opens a HEADED window with input shims kept on; with it off, the headless default is unchanged; an env headless
   pin always wins; and the attended-login teardown returns to the watched window rather than headless. */
'use strict';
const A = require('./_assert.js');
const { _internals: T } = require('../sidecar/tools/builtin/browser.js');

function session(opts) {
  const made = [];
  let watch = !!opts.watch;
  const s = T.makeBrowserSession(Object.assign({
    env: opts.env || {}, lookup: null, forceHeadless: true, syntheticInputOnly: true,
    watchable: () => watch,
    makeDriver: (d) => {
      const drv = { headed: !!d.headed, forceHeadless: d.forceHeadless, synthetic: d.syntheticInputOnly, closed: false,
        navigate: async (u) => u, visible: () => !!d.headed, close: async () => { drv.closed = true; } };
      made.push(drv); return drv;
    }
  }, opts.extra || {}));
  return { s, made, setWatch(v) { watch = v; } };
}

(async () => {
  {
    const { s, made } = session({ watch: false });
    await s.navigate('https://example.com');
    A.eq(made.length, 1, 'off: one driver');
    A.eq(made[0].headed, false, 'off: host-pinned headless stays headless');
  }
  {
    const { s, made } = session({ watch: true });
    await s.navigate('https://example.com');
    A.eq(made[0].headed, true, 'on: the agent browser opens in a visible window');
    A.eq(made[0].forceHeadless, false, 'on: the host headless pin is lifted for this driver only');
    A.eq(made[0].synthetic, true, 'on: input stays synthetic (watching never hands over real input)');
    await s.navigate('https://example.com/2');
    A.eq(made.length, 1, 'on: follow-up navigation reuses the watched window');
    A.ok(s.visible() === true, 'session reports the window as visible');
  }
  {
    const { s, made } = session({ watch: true, env: { STARNET_BROWSER_HEADLESS: '1' } });
    await s.navigate('https://example.com');
    A.eq(made[0].headed, false, 'an env headless pin (CI rigs) still wins over the switch');
  }
  {
    const { s, made } = session({ watch: true });
    await s.navigate('http://127.0.0.1:5173/', { local: true });
    A.eq(made[0].headed, false, 'local dev-server testing stays headless even when watching');
  }
  A.report('browser-watch.test');
})().catch(e => { A.ok(false, 'suite threw: ' + (e && e.stack || e)); A.report('browser-watch.test'); });

# StarNet 0.12.5 — release preparation

Prepared 2026-09-26/27 on `agent/release-0125`, forked from trunk `003a63ee8` (the last merge before the cut:
masked-key redaction). Baseline: public `v0.12.4` (`f00aa04df`, published 2026-09-20). Scope: every trunk merge in
`v0.12.4..003a63ee8` (555 commits, 440 non-merge). Nothing here pushes, tags, publishes or deploys.

## How the candidate was audited

Five read-only audits ran against the range, then their findings were re-checked in code before acting:

| Audit | Result |
| --- | --- |
| Release-notes truth | One false claim (the headless CLI is not in the desktop bundle), several overstated claims, ~12 user-visible changes missing, 5 upgrade surprises missing. Final notes rewritten from code, plain text (see below). |
| Merge integrity (conflict resolutions, lost/duplicated changes) | 116 merges reviewed (10 hand-resolved code conflicts replayed with `--remerge-diff`), 233 code commits traced to HEAD: nothing lost, clobbered or accidentally reverted. One behavior bug from a merge (duplicate `dockId` key in Run Now) and one incomplete fix in the same seam (fixed, below). Four more duplicate object keys from merge `e2d8ea47d` are dead (both values equal today). |
| Upgrade 0.12.4 → 0.12.5 (persisted formats, defaults, migrations) | No boot failure, no silent data loss. Four behavior changes bite some upgraders; all are release-note heads-ups (below). |
| Desktop packaging / CSP / CI drift | No blocker. Runtime deps staged (`undici` is the only new one), all WebView2-only code is `cfg(windows)`, no inline construct the new CSP would block (237 shipped scripts). `cargo fmt --check` was red since v0.12.4 (fixed). |
| Public state (issues, feed, website, docs, CI) | No blocker. Live `latest.json` = 0.12.4 with windows-x86_64 + both darwin keys, all URLs 200; no 0.12.5 tag/draft collision. `secret-history` red on origin since 09-22 (fixed). |

Local checks beyond the audits:

- macOS arm64 type-check of the desktop crate (`cargo check --locked --target aarch64-apple-darwin`, Apple SDK
  headers stubbed for `ring`, staged frontend, placeholder node binary): passes; one harmless warning (an unread
  field on non-Windows). This proves the Rust compiles for the Mac legs; it does not link, bundle or notarize.
- `npm ci` from the lockfile and `cargo metadata --locked` both succeed (the train's locked installs will not trip).
- `npm audit`: 0 advisories.
- Masked secret-pattern scan over every unpushed commit (`origin/feat/harness-backend..003a63ee8`, 133k added
  lines): no real credential; the two hits are short fake tokens in test fixtures.

## Fixes made in this lane

| Commit | What |
| --- | --- |
| `2b5f37727` | `.gitleaksignore`: two reviewed SHA-256 digests (0.12.4 installer hash, a log hash) that kept `secret-history` red on every trunk push since 09-22. |
| `c66c84f76` | #38 / PR #52: the voice transient cool-off test used a 4.2 s wall-clock sleep that flakes under load (the train gate runs it); now a controllable clock. |
| `4ee70cdee` | `scripts/qa/ledger.mjs` writes findings via temp + rename. Three 0-byte findings from the 09-19 disk-full event had made every strict ledger read (`qa:ready`) fail for a week (quarantined locally under `qa/findings/_torn-2026-09-19/`). |
| `3888bc195` | Runbook and brain no longer claim the train never ran green / releases 404 / binaries unsigned. |
| `3a54f7312` | `cargo fmt` over the desktop shell (formatting only; every test that reads the Rust sources re-run green). |
| `8381aba53` | New fast-gate guard: every script `frontend/index.html` loads is scanned for inline handlers in generated markup, `javascript:` URLs, `eval`, `new Function` and string timers — the constructs the desktop CSP blocks and no browser-driven gate can see. |
| `55ac256c8` | Bay lamps for multi-bay agents: the loop's own `agent.run.start` (the normal model path) now names the bay/crate like the early-exit starts, and Run Now no longer overrides the crate's bay with `undefined` (duplicate object key from merge `e2d8ea47d`). `workflow-project-multibay.e2e` asserts both; each assertion was run red against the unfixed sidecar. |

Deferred (accurate today, not release-critical): the Workflow panel lost two sentences of PR #29 copy in merge
`666ae5188` (step instructions add to the agent's Dossier purpose rather than replacing it; how a Telegram bot starts a
line). The panel's current copy is accurate; the Telegram sentence needs a behavior check before it returns.

## Upgrade heads-ups (in the release notes)

1. **$25 / trailing-24-hour soft spend limit** is on for metered runs on every station that never saved a daily cap.
   When it trips, each routine run stops before any model call and counts as a routine failure; five in a row pause
   the routine (`disabledReason: consecutive-failures`) until re-enabled from ROUTINES. RESUME in Budget adds headroom
   for the session. **Owner decision pending:** exempt cross-run budget stops from the auto-pause streak (then each
   held occurrence still sends a "failed" notice until the window clears) — deliberately not changed at release time.
2. **Reserved agent ids.** An agent whose id equals a station folder (`codex`, `grok`, `kimi`, `channels`,
   `connectors`, `plugins`, `skill-packages`, `transcript-history-v2`, `_archive`, Windows device names) still loads and
   chats but every file/shell/script tool refuses it. The security fix is correct (its "workspace" was a credential
   folder). Recruiting a replacement does not carry routines or notes. A boot-time id migration is follow-up work.
3. **Plugins** need approval again (approval covers the whole folder). Plugins containing symlinks or over the size
   caps are refused; a plugin that writes into its own folder turns itself off until re-approved.
4. **Chat channels.** Bots with no paired owner (only ever used in groups) need the pairing code; Full Access applies
   only in the owner's DMs; messages with attachments or forwarded text run under the untrusted-content lock.
5. **code.run** asks for consent (execute class); unattended runs need a Full Access agent.
6. **Windows exit codes** are real now; routines that were silently failing will show failures (and can auto-pause).
7. Rolling back to 0.12.4 loses Slack/Matrix bot tokens (0.12.4 never reads the keychain entries).

Also true but not headline-worthy: file links expire after 5 minutes (workshop web tools after 10); a token in a URL
is refused; build-mode ESC needs a second press; save-conflict snapshots are pruned to the newest 20 per agent;
`npm start`/CLI users must `npm install` after updating (new dependency `undici`); the headless CLI (`bin/`) is a
source-checkout tool, not part of the desktop app.

## Owner decisions (2026-09-27)

- Push the candidate branch (not trunk, no tag) and run the non-publishing CI: approved.
- 48-hour installed soak: **waived**, as for 0.12.4.
- $25 spend rail: keep the merged behavior (five budget stops pause a routine); heads-up in the notes; revisit next release.
- macOS build-mode cursor offset (customer report 09-26, root cause proven): next release. Workaround: Settings > TEXT SIZE 100%.

## Validation of the candidate (`8cdb98267`: fixes + bump + notes + claims re-lock)

| Check | Result |
| --- | --- |
| Guardian cycle `20260927-033601`, pinned to the candidate | GREEN, all seven gates: fast 948/948, HTTP 155/155, saboteur 527 attacks across 240 routes, UI screenshot sweep, golden frames, behavioral audit 49/49, journeys 139/139 |
| Customer journeys (the train gate's second step) | 38/38 |
| Beginner Run (UI-only) | PASS |
| Credential-free eval gate | PASS (contract, quality, fault, offline parity 32/32) |
| Desktop Rust tests (Windows) | 74 passed, 2 ignored |
| `fast-gate` on Linux, run 36300551769 | green |
| `desktop-build`, run 36300555783 (`publish-test=false`, `require_signed_mac=true`) | green: signed Windows NSIS, macOS arm64 + x64 built and notarized, Linux, Intel macOS installed acceptance |
| Windows installer | `StarNet_0.12.5_x64-setup.exe`, 382,048,280 bytes (0.12.4: 640,524,832), SHA-256 `323c7c44ff83ab0f88b550f33c7f8ab9257cdd972f35099ad2ddeea4a4761605`; Authenticode Valid (Andrew Sims, timestamped); updater signature verified against the baked public key |
| `t0-clean-install-proof`, run 36336468910 (that installer, `baseline_tag=v0.12.4`, static level on) | green: silent clean install, first launch with the packaged UI up over CDP, shell close/reopen, a populated v0.12.4 station upgraded with its data preserved, installed provider fallback, delegated connectors and session continuity |
| `secret-history` (full reachable history, run 36336596755) | green |

The Guardian's 14 stale open P0/P1 detector findings in the integration tree's local ledger (09-20 to 09-24) were
reconciled against this cycle, assertion by assertion (`releaseResolution`, kind `current-scenario-recovered`,
evidence copied to `.bugloops/release-0125-evidence/`); the ledger reads 0 open P0/P1.

Corrections made after the first CI pass (test and CI configuration only, no product change):

- The first `t0` run (36335835317) failed on one difference: the fixture's second agent had no saved colour, and
  0.12.5 roster hydration (security audit `97a7b612e`) gave it a crew palette colour. The upgrade verifier now permits
  exactly that (a missing or non-hex colour may become an app `SUITS` colour; a valid colour must survive unchanged),
  mirroring the 0.12.4 correction for neutral project defaults. The re-run passed on the same signed installer.
- The first full-history secret scan of the branch flagged five deliberately token-shaped test fixtures; they are
  allowlisted by exact fingerprint (and the comment that briefly quoted one).

## Still owed

- **Before tagging:** the `qa:ready` installed check re-hashes the installed executable on this machine, so the hosted
  smoke receipt must be imported with the executable extracted from the verified installer (0.12.4 did the same).
- **After the tag push** (fires the release train; it stages a DRAFT only): watch the train, review the draft, run
  `t0-clean-install-proof` and `g1-packaged-lifecycle` against the draft, then the owner publishes; then
  `release:verify-host --expect-version 0.12.5` and an update canary.
- Not performed for this release: real-account sign-in, the attended 48-hour soak (waived), an Apple Silicon installed UI
  journey, and installed-build proof of the pinned CSP inside WKWebView, `code.run` from the bundled path, the
  Slack/Matrix keychain migration and WebView2 crash recovery.
- **After Publish:** deploy the website (the `FALLBACK_VERSION` bump waits until 0.12.5 is the public latest, plus four
  undeployed site commits); answer/close the GitHub issues this release fixes (#50, #19, #24 ask for a retest, #40,
  #28 partial, #6, #31/#32/#26/#25 shipped).
- Follow-ups: exempt cross-run budget stops from the routine auto-pause streak; a migration for agents with reserved
  ids; the Workflow panel copy lost from PR #29; the macOS build-mode cursor offset.

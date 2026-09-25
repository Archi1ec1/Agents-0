# StarNet — next release (draft)

DRAFT started 2026-09-24 from every trunk merge since v0.12.4 (`f00aa04df`). Not a release. `release:bump`
overwrites `RELEASE_NOTES.md` with a scaffold — paste the final text from here. Pick the version at the cut
(this is a large feature set; 0.13.0 fits better than 0.12.5).

## User-facing

- **Workflow studio.** The Workflow panel docks beside the station instead of opening INBOX/BAY cards. Lines can
  be step-tested (pause, continue, edit the hand-off, rerun, rewind). One agent may crew several bays; routing is
  keyed by bay.
- **Line triggers.** A file dropped in a watched folder, or a call to a line's webhook, starts one run of that
  line. Bay status lamps, a crate inspect card, per-line INBOX plates and a TODAY row show what each line did.
- **Routines** can be renamed and have their instructions edited in Automation. Scheduled deliveries recover
  after a restart and no longer overwrite each other's receipts.
- **Google Workspace early access.** Calendar, Docs, Sheets, Drive and Gmail connect now as early access. Google
  shows an "unverified app" warning at sign-in and caps use at 100 users until verification completes. Gmail
  and Drive data never goes to StarNet Managed models.
- **Live model status.** COMMS shows when a model call is slow or retrying, and why, from the engine's own
  events. Long streaming replies from the local `/v1` endpoint keep the connection alive.
- **Spend safety.** A $25/day soft spend rail on metered runs (one-click RESUME, editable, 0 turns it off). Runs
  that keep making the same failing calls or change nothing are parked instead of spending.
- **Agent reliability.** Transcripts are saved turn by turn, so interrupted runs appear in history and can be
  continued. Better recovery from provider outages, context overflow and cut-off tool calls; compaction keeps
  your instructions word for word. Stop reaches background workers.
- **Coding tools.** `fs.edit` refuses ambiguous edits, `fs.read` can number lines, search respects
  `.gitignore` and uses ripgrep when installed, and `shell.exec` accepts timeouts up to 10 minutes.
- **Windows command exit codes are reported correctly.** Before this, a failing command could report exit 0.
- **Headless CLI.** `starnet run | status | doctor | init` drives a station from a terminal.
- **Memory.** Lessons and facts can be scoped to a project, and recall can use embeddings from a configured
  provider.
- **DaVinci Resolve edit bay** on the STUDIO prop (live control needs Resolve Studio). Seven hosted MCP
  connectors were added to the catalog.
- **Fourteen new agent skins** (roster 51). Agents move more fluidly: they arc through corners, and poses and
  walk frames blend into each other.
- **Desktop.** A new app icon. The app recovers from a WebView2 renderer crash without a white screen, and
  double-clicking while it is still starting no longer kills it. Startup offers Retry/Cancel if the local engine
  does not come up. Media ships as one copy, so installs are smaller.
- **Performance.** Sessions that were wrongly pinned to the slow CPU warp path now render on the GPU
  (about 26 → 60 fps on affected machines).
- **Providers.** Opus 5.5 thinking, an updated Gemini catalog, and resume keeps the provider you selected.
- **Crew configuration** saves are read back before they are reported as saved.

## Security

- Web tools pin the DNS-validated address per hop (DNS-rebinding guard), and dangling-symlink workspace
  escapes are blocked.
- `team.configure` requires consent, is refused in tainted runs, and scans the instructions it writes.

## Before the cut — owed

- Polish pass `agent/polish-0924` (post-merge review fixes): fold its user-visible items in here.
- `agent/security-audit-0923` (code.run gating, tainted forwards, routine grant rebind, pairing on every
  channel, Host floor, colour XSS, Tauri navigation guard) is NOT on trunk yet — merge it or say it is not in.
- Verify this list against the exact cut head (`git merge-base --is-ancestor <sha> <tag>` for each item).

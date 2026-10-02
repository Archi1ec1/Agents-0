# THE LAB production rooms

The 3D tower, city and landscape have been replaced by same-level rooms joined by bridges. YouTube and E-commerce have six production stations each and separately selectable agents seated at computers. The other saved rooms remain accessible. Classic World still owns station persistence, crew, capabilities and runtime events.

## Interaction and ownership

- Click a room to focus it; **All rooms** shows the connected platforms and room attention badges.
- Click an agent or their name to open the existing dossier through `openWorldAgent`, resolving the current roster index from the real agent ID.
- Click a conveyor station to inspect its queue and the reason work is waiting. Its action opens the Shorts window or Claude's existing Shop panel.
- Task board, finished work, connections and routines reuse `StationUI.openTerm`. The shared controls also remain accessible from every room.
- **Classic** keeps the original 2D tools available. A failed WebGL initialization leaves Classic visible; context loss switches back to it.

The rendering layer does not move desks in the saved station, invent staff, assign business tasks to agents, enable routines, submit clips or fulfill orders. Stations are process stages, not assertions that a particular agent owns a provider job. The actual preset has five YouTube and five commerce agents; both lines have six workflow stages. If the saved station lacks a business room, the renderer offers an empty view-only production room without changing the roster.

## What is connected

`productionflow.js` reads the authenticated `/api/shorts` and `/api/commerce` snapshots. The scene reads every 15 seconds while visible; it does not poll external providers itself. Agent screen activity comes from the existing `StationUI.isAgentRunning` signal. Conveyor rollers animate only for a saved working stage; reduced-motion preferences stop this animation. Queued item tokens do not animate into a completed state.

Shorts uses `StationUI.registerWindow` and the backend contract in [shorts-interface.md](shorts-interface.md). The window supports connection setup, source and permission records, confirmed paid clipping, export refresh, lost-submission reconciliation, editorial approval, separate confirmed scheduling, and cancellation. Processing and publication are never triggered by clicking a 3D object. Provider media previews allow only HTTPS `*.cdn.opus.pro`; the desktop CSP adds that host solely to `media-src`. Credentials stay in the dedicated encrypted backend vault and are cleared from the form after the connection attempt.

The Shop panel from PR #3 is reused. Demo events update the same room snapshot immediately. Demonstration state is labeled **DEMO**, including the overview badge. Live Etsy/Printful connections, listing publication and automated fulfillment are not implemented by the existing commerce foundation; the view reports this explicitly.

Failed reads retain the previous snapshot with unknown/stale status. A scheduled Shorts date passing goes to **Verify**, never automatically to **Published**. Human rights review, original editing and final YouTube verification remain required. A configured Opus account is not proof of API entitlement or a successful live trial; this change used fixtures, not a paid subscription or real channel.

## Files and integration

- `frontend/app/office3d.js`: pure room/roster planning, horizontal layout, scene, raycast targets and existing-handler dispatch.
- `frontend/app/productionflow.js`: pure stage projections and read-only shared store, including commerce mode-race protection.
- `frontend/app/shortspanel.js`: registered workflow window, escaped records, form conversion and same-body/action-ID retry after uncertain acknowledgements.
- `frontend/app/app.js`: host callbacks to existing agent, terminal and workflow handlers.
- `frontend/css/production-rooms.css`: scene controls and Shorts window content, with existing `holding.css`/`lab-ui.css` frame retained.

The branch integrates the commerce foundation and Claude's Shop panel from `feat/commerce-panel` (#2/#3) and the Shorts backend from `feat/youtube-shorts-workflow` (#4). Both route sets are retained in `sidecar/index.js`. These PR dependencies should be reviewed together; merging this branch includes their commits.

The repository still tracks `website/app` and requires it to match the frontend. It was regenerated with `scripts/sync-website-app.mjs`; this does not publish or deploy the web version.

## Verification

Automated checks passed for room projection/handlers, the actual ZAK HOLDING roster, commerce panel rendering, 617 classic world-model assertions, preset crews, industrial shells, shared window repairs, the font rule, commerce's 62 domain checks and authenticated HTTP workflow, Shorts' 20 domain scenarios, seven adapter scenarios and authenticated HTTP workflow. The generated website mirror passes its consistency check.

`test/production-rooms.browser.cjs` boots the actual app with a hermetic sidecar profile and fixture Opus transport. It verifies all five actual YouTube desk raycasts select their matching dossiers, a conveyor raycast opens the right inspector, shared controls reach the classic task board, drafts survive background reads, a lost paid acknowledgement retries the identical body without another provider job, approval does not schedule, an explicit schedule creates only one provider request, Shop demo events feed the room, failed reads become unknown, and Classic/context-loss fallback works. Viewport checks cover 1600, 1050, 760 and 420 pixels. No external provider request is allowed by the test browser.

Run the browser test with Playwright available and a locally installed Chrome, or set `ROOMS_BROWSER_CHANNEL` to a supported installed channel. `ROOMS_SCREENSHOTS` optionally selects an output directory. Node tests run with the repository's normal dependencies.

The broad determinism scanner still reports the same 26 violations in unrelated pre-existing backend files; none is introduced by this branch. A packaged Tauri build and real Opus/YouTube/Etsy accounts have not been tested. The source branch must be integrated and the desktop updated before these rooms appear in the installed app.

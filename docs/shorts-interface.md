# YouTube Shorts workflow, version 1

Backend owner: Codex. Floor/panel owner: Claude. Coordination: [issue #1](https://github.com/Archi1ec1/ZAK-HOLDING-/issues/1).

This implementation prepares licensed sources, calls the Opus API for clipping, retrieves rendered clips, records editorial approvals, and requests or cancels YouTube schedules. It is **not live-validated**: the user has no Opus account yet. Automated tests use provider responses based on the public documentation. No account, subscription, channel, real clip, or real schedule was created during development.

## Product flow

Sources → permission and source access → confirmed processing → clip review → confirmed schedule → verify publication in YouTube.

Source discovery, obtaining permission, original commentary/editing, and final publication verification remain human steps. The app does not download arbitrary YouTube videos, write commentary into a render, promise monetization, or infer that a scheduled post has published. The first processing preset uses ClipBasic for spoken content, portrait framing, captions and preferred 30–60 second clips. Validate quality on the intended niche before expanding to other models.

The service is separate from the commerce PR and contains no frontend changes. Start with the normal sidecar dependencies and launcher. Tests and code use existing Node facilities, with no new runtime dependency.

## Setup

1. Create an Opus account and confirm that the chosen plan exposes the API key and organization ID. Pro is advertised at $29/month with 300 credits; API access is limited/Beta. Confirm the actual checkout, billing terms and API entitlement before purchasing.
2. Connect the intended YouTube channel inside Opus. This implementation selects from YouTube accounts returned by Opus; it does not implement a separate Google sign-in flow.
3. In the future desktop panel, enter the Opus API key and organization ID into dedicated connection fields. Send them only in the authenticated `/connect` JSON body below; clear the key input afterward. Never put a key in a URL, chat, source note, or Git.
4. The native desktop encryption key must be available. Without encrypted credential storage, preparation still works, but configuration and live operations remain unavailable. There is no plaintext or environment-key fallback.
5. Start with one approved source and review its actual bill, captions, framing, exports and schedule behavior before relying on automation.

The read-only connection check verifies access to social accounts, not clipping entitlement, billing balance, or future availability. A genuine live trial is still needed even when `connection.configured` is true.

## Authenticated routes

All routes inherit the sidecar Host, Origin, token, process-fault and update-preparation guards. Use the existing authenticated frontend request helper (`X-StarNet-Token`). Responses are JSON with `Cache-Control: no-store`. Queries are rejected. POST bodies are capped at 16 KiB; unknown properties are rejected.

| Method / path | Purpose |
| --- | --- |
| `GET /api/shorts` | Read current state; no provider call or store creation |
| `POST /api/shorts/connect` | Check and save encrypted Opus credentials |
| `POST /api/shorts/sources` | Add an immutable source with rights initially pending |
| `POST /api/shorts/sources/clear` | Record the owner's permission and source-access attestations |
| `POST /api/shorts/jobs/submit` | Confirm and submit one billable clipping job |
| `POST /api/shorts/jobs/refresh` | Read the provider's current exportable clips |
| `POST /api/shorts/jobs/reconcile` | Link a manually located project after a lost submission response |
| `POST /api/shorts/clips/approve` | Approve clip metadata/version, editorial checks and destination |
| `POST /api/shorts/publications/schedule` | Confirm and send the approved schedule |
| `POST /api/shorts/publications/cancel` | Request cancellation of a known, future schedule |

Every POST requires a unique `actionId`. Reuse the **same ID and exact body** after a timeout; changing the body with that ID returns 409. A successful retry returns the current snapshot and `duplicate: true`. External requests are not automatically resent by a duplicate action. `ok: true` means the local action has been recorded: inspect the resulting job/publication state to distinguish provider acceptance, rejection and uncertainty.

IDs start with a letter/digit, use letters, digits, `.`, `_`, `:`, `-`, and are at most 128 characters. Timestamps are UTC ISO strings with milliseconds. Text fields must render as text, never raw HTML.

### Request bodies (all also require `actionId`)

**Connect:** `{ apiKey, orgId }`. Organization changes require an explicit future migration; the endpoint cannot repoint existing jobs into a different organization. A successful connection returns only sanitized channel IDs/names. Secrets use a separate encrypted file and an independent vault lock so damage does not disable unrelated connectors.

**Source:** `{ sourceId, title, creator, url, kind, durationSec }`.

- `title`/`creator`: up to 200 characters. `durationSec`: integer 1–18000, the full source duration used for the credit estimate.
- `kind`: `licensed_file` or `verified_youtube`.
- For this release, licensed URLs support Google Drive `/file/d/ID/view`, Dropbox and public S3 MP4s. Signed/credential-bearing URLs are not supported by the plain workflow ledger. Obtain a suitable creator-supplied file/share URL.
- YouTube URLs are normalized to a watch URL and require `verified_youtube`; ownership verification must already be available to Opus. A public URL is not evidence of permission.
- Source URLs are not fetched by the local server. URL aliases for the same physical video are not content-hash deduplicated; keep one source record per input video.

**Clearance:** `{ sourceId, evidence, attribution, originalityPlan, commercialEditsAllowed: true, sourceAccessConfirmed: true }`.

Each text field is required, up to 1000 characters. Use a permission/license reference, required credit, and a concrete plan for original explanation/commentary. For a YouTube source, access confirmation means the owner has verified the channel in Opus; for a licensed file, it means an authorized source has been supplied. These are owner attestations, not an automated rights determination. Clearance is editable before submission; submitted sources cannot be silently changed.

**Submit:** `{ sourceId, confirmProcessing: true, maxCredits: 25 }`.

Show the estimated credit reservation and obtain this action from the user. The reservation is `max(10, ceil(durationSec / 60))`; `maxCredits` must cover it. Full-source duration is declared by the user, not independently measured. One source can have only one job; there is at most one unresolved processing job. A source/title marker is sent to Opus to help locate lost responses.

**Refresh:** `{ jobId }`. This reads exportable clips and updates local metadata. Empty results mean processing/unverified, not success or a proven provider failure. After an hour without exports, the job asks for review in Opus. Read failures back off from one minute up to ten minutes; authorization failures or eight consecutive failures pause polling until a manual refresh succeeds.

**Reconcile:** `{ jobId, projectId, evidence, confirmSourceMatch: true }`. Available only when the stored job has no project ID. The owner first matches `THE LAB: <sourceId>` and the actual source in the Opus dashboard. The backend then verifies that at least one returned clip belongs to that project and configured organization. The API does not independently prove the original source match; the recorded evidence is an owner attestation. This operation sends no new processing request. An empty or inaccessible project leaves the job unresolved.

**Approve:**

```json
{
  "actionId": "review-001",
  "clipId": "clip.ID-FROM-SNAPSHOT",
  "fingerprint": "FINGERPRINT-FROM-SNAPSHOT",
  "accountId": "YOUTUBE-ACCOUNT-FROM-CONNECTION",
  "title": "Approved title",
  "description": "Approved description and attribution",
  "publishAt": "2026-10-20T16:00:00.000Z",
  "editorialNotes": "Reviewed the original explanation in the final rendered clip.",
  "checks": { "rights": true, "originality": true, "captions": true, "framing": true, "audio": true }
}
```

The sample date is illustrative; choose a future date at least ten minutes ahead. Title maximum 100 characters, description 4500, notes 1000. Edit the content in Opus before approval; writing notes here does not alter the video. The fingerprint covers provider metadata, render preferences, timestamps and media URLs; it is not a checksum of downloaded video bytes. Refresh after an external edit and review again.

**Schedule:** `{ approvalId, confirmPublication: true }`. The service rechecks available YouTube accounts and clip metadata before saving its scheduling intent and making the request. Changed/unavailable clips require a new approval; a newer approval also supersedes older metadata/schedule approvals for that clip. Only one publication record per clip is supported, even after cancellation or rejection. Never enable a blind “retry publish” button for an uncertain result.

**Cancel:** `{ publicationId, confirmCancellation: true }`. Only a known future schedule can be canceled. An ambiguous result becomes `cancel_unknown`. A schedule whose time has passed must be inspected in YouTube/Opus; this API never claims to unpublish an already released video.

## Snapshot shape and UI

`GET` returns `{ ok, schemaVersion, mode, updatedAt, generatedAt, notice, connection, budget, capabilities, sources, jobs, clips, approvals, publications, attention, actions }`.

POST success is `{ ok, duplicate, targetId, snapshot }`. Unknown methods return 405; unknown paths 404; validation 400; action/state conflicts 409; provider errors 502; storage failures 503. Keep previous data marked stale on failed reads; do not replace it with an apparently healthy empty queue.

- `mode`: `disconnected` or `connected`; connected means saved credentials match local configuration. There are no fake live/demo account records.
- `connection`: configured flag, status (`disconnected`, `configured`, `locked`), encryption state, organization ID, `{ id, name }[]` YouTube accounts and `verifiedAt`. The last field is the last account-read check, not a global synchronization time.
- `budget`: UTC month, local limit/reserved/remaining credits, estimate basis, `providerBalance: null`, `automaticTopUps: false`.
- `jobs`: IDs, source/provider/organization references, states, reserved credits, last/next checks, error code and optional manual reconciliation evidence. States: `submitting`, `submission_unknown`, `processing`, `review`, `attention`, `rejected`.
- `clips`: ID, job ID, bare provider clip ID, fingerprint, title, duration in milliseconds, preview/export URLs, availability, fetched time. Render the preview as media; do not open arbitrary HTML supplied by a provider.
- `approvals`: exact metadata/destination/time, editorial notes and approved fingerprint. `valid` reports current local version/availability matching; scheduling still performs a fresh provider check.
- `publications`: approval/clip references, provider schedule ID when known, state and error. States: `scheduling`, `schedule_unknown`, `scheduled`, `rejected`, `canceling`, `cancel_unknown`, `canceled`. There is intentionally no automatically inferred `published` state.
- `attention`: target ID, code and `requiresReview`. Includes uncertain jobs/schedules and scheduled times that have passed without publication verification.
- `actions`: the latest 100 local audit entries; secrets and request digests are omitted. Older receipts remain on disk for duplicate protection.

Suggested panels: **Sources**, **Processing**, **Review**, **Scheduled**, and **Needs attention**. Connection and credit allowance stay visible. Performance should link to YouTube Studio; automatic analytics is not implemented. Disable live action buttons according to capabilities and explain missing account setup. No subscriptions are purchased through these endpoints.

## Reliability, storage and limits

The writer saves an intent and action identity before every external write. Failed/ambiguous acknowledgements, process termination and restarts never silently resend a paid job or schedule. There is no documented provider idempotency key in the routes used here, so uncertainty is held for reconciliation. Rejected/unknown submissions retain their reserved credits conservatively; they are not silently refunded locally.

The local monthly ceiling is 300 estimated credits, with no automatic top-ups or paid subscriptions. **It is not a guaranteed $50 provider bill:** it cannot see usage through other apps, subscription taxes, billing-cycle differences, source-duration mistakes or changed vendor charges. Verify the actual provider balance before the pilot. The separate advertised 900-credit API ceiling does not mean 900 credits are included in the selected subscription.

Workflow data is JSON inside `WORKSPACES/shorts/workflow.ledger`; encrypted credentials are in `WORKSPACES/.secrets/shorts-opus.json`. GET does not create either file. The workflow envelope has an integrity checksum and strict version/record validation. Corrupt, unreadable, future-version or backup-only state fails closed. The `.ledger` extension prevents the generic station-backup exporter from silently substituting an older `.bak` for a corrupt JSON main. No automatic rollback/reset is provided. Restoring any older station backup requires provider reconciliation before live use, because even an intact older ledger can lack more recent paid-action receipts.

The mutex covers instances within one process; the existing host workspace-owner guard must exclude another writer. Limits are 200 sources/jobs, 2000 clips/approvals/publications, and 5000 actions. Capacity stops new actions instead of discarding duplicate history. This bounded pilot store needs a database and retention/migration policy before larger-scale operation.

The host polls already-submitted jobs every 30 seconds while running. Polling participates in the update barrier and stops on process faults; it never initiates a new paid job or publication. Provider rendering and accepted schedules can continue in the cloud while THE LAB is closed, but the local workflow refresh waits for the app to run. No public webhook or additional hosting was introduced.

After scheduling, avoid editing that clip in Opus without reviewing/canceling its schedule. External edits between the final metadata check and the provider's eventual rendering cannot be locked by this API. Unknown schedule/cancellation results require inspection in Opus; automated schedule reconciliation and YouTube publication/analytics verification are future integrations.

## Validation and official references

Run `node test/shorts.test.js`, `node test/shorts.opus.test.js`, and `node test/shorts.http.test.js`. The HTTP test boots the actual sidecar with an isolated encrypted profile and an explicit Opus test fixture; it never contacts Opus or YouTube. The tests are in the fast/HTTP manifests.

Documentation consulted on 2026-10-02:

- [Opus pricing](https://www.opus.pro/pricing), [API limits](https://help.opus.pro/api-reference/limitation), [API setup](https://help.opus.pro/api-reference/overview).
- [Create project](https://help.opus.pro/api-reference/endpoints/create-project), [project shape](https://help.opus.pro/api-reference/schemas/project-representation), [get clips](https://help.opus.pro/api-reference/endpoints/get-clips).
- [Social accounts](https://help.opus.pro/api-reference/endpoints/social-posting/get-social-accounts), [schedule](https://help.opus.pro/api-reference/endpoints/social-posting/schedule-post), [cancel](https://help.opus.pro/api-reference/endpoints/social-posting/cancel-scheduled-post).
- [YouTube source ownership](https://help.opus.pro/docs/article/youtube-ownership-verification), [YouTube reused-content policy](https://support.google.com/youtube/answer/1311392?hl=en).

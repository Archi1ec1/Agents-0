# Commerce foundation, version 1

Owner: Codex (backend); Claude (desktop panels). Coordination: [issue #1](https://github.com/Archi1ec1/ZAK-HOLDING-/issues/1).

This milestone supplies authenticated panel data and a durable simulated order lifecycle. It does **not** connect to Etsy or Printful, register webhooks, submit orders, publish listings, move money, or run while the desktop sidecar is closed. Printful is a demonstration supplier, not a decision that a supplier account has been configured. The existing 3D building remains Claude's responsibility.

## Panel reads

`GET /api/commerce` returns disconnected status. `GET /api/commerce?mode=demo` explicitly selects demonstration data. No request switches a global mode; demo is selected per request. `mode=live` is rejected until live integration exists.

Both routes use the existing sidecar Host, Origin, and `X-StarNet-Token` guards. Responses are JSON with `Cache-Control: no-store`. Use the existing authenticated frontend request helper; do not place the token in a URL.

Successful response fields:

| Field | Meaning |
| --- | --- |
| `ok`, `schemaVersion` | `true`, `1` |
| `mode` | `disconnected` or `demo` |
| `notice` | Human-readable disclosure to display prominently |
| `lastSyncedAt`, `stale` | `null`, `true`: there is no verified live synchronization yet |
| `updatedAt` | Last local ledger mutation, UTC ISO string or null |
| `generatedAt` | Time this response was generated; not a sync timestamp |
| `storageStatus` | `absent` for fresh state, `ok` for verified existing state |
| `connections`, `products`, `orders`, `exceptions`, `actions` | Records below |
| `financials` | `{ period: 'all_recorded_orders', byCurrency: [...] }` |
| `capabilities` | Explicit supported actions; all live capabilities are false |
| `demoSteps` | Available simulation step identifiers |

Disconnected data contains two disconnected connection placeholders and no products, orders, exceptions, actions, or financial totals. Empty financial groups mean no recorded data, not zero revenue. Demo contains explicitly simulated connections, one pet-art product mapping, and any simulated orders the user has created.

## Record shapes

All identifiers are strings. All non-null timestamps are UTC ISO strings. Monetary amounts are integer minor units associated with a currency. Currency conversion is not implemented.

**Connection:** `id`, `provider` (`etsy` / `printful`), `shopId`, `displayName`, `status`, `capabilities`, `lastSyncedAt`, `errorCode`. Real connections remain `disconnected`. Simulated connections appear `connected` only inside `mode=demo` with `demo.read` capability. They must never be shown without the demo disclosure.

**Product mapping:** `id`, `sku`, `listingId`, `variationIds`, `supplierVariantId`, `artworkId`, `validationStatus`, `costEstimate: { amountMinor, currency }`, `costUpdatedAt`. This version supplies one fixed demo mapping. Mapping editors and provider catalog synchronization are deferred.

**Order:** `id`, `channelOrderId`, `productId`, `placedAt`, `itemCount`, `paymentStatus`, `cancellationStatus`, `fulfillmentStatus`, `fulfillmentOwner`, `supplierOrderId`, `shipmentCount`, `trackingAvailable`, `failureReason`, `lastReconciledAt`, `updatedAt`, `financials`.

- Payment: `paid` or `refunded`. This demo models full refunds only.
- Cancellation: `none`, `requested`, or `canceled`.
- Fulfillment: `pending`, `failed`, `processing`, `shipped`, or `delivered`.
- Fulfillment owner: `supplier_native`. This is the architectural owner; demo never actually submits to that supplier.
- `lastReconciledAt` remains null. A simulated event is not evidence of provider reconciliation.
- `financials` has the same shape as one currency summary below, for this order alone.

**Exception:** `id`, `orderId`, `connectionId`, `type`, `severity`, `status`, `summary`, `suggestedAction`, `requiresApproval`, `createdAt`, `resolvedAt`. Status is `open` or `resolved`. Later supplier facts resolve failed-payment/tracking exceptions. Cancellation and refund do not magically stop production; conflicting fulfillment creates a separate review item. There is no arbitrary "mark fixed" endpoint.

**Financial currency summary:** `currency`, `orderCount`, `revenueMinor`, `supplierCostMinor`, `shippingCostMinor`, `marketplaceFeesMinor`, `refundsMinor`, `advertisingCostMinor`, `contributionMinor`, `completeness`, `missingFields`, `estimatedFields`.

Each amount can be null. A missing input makes `contributionMinor` null and `completeness=incomplete`; known but estimated inputs give `estimated`; all known inputs give `complete`. Contribution is revenue minus the five cost/refund components. This is contribution before overhead and income taxes, **not net profit**. Amounts for different currencies remain separate. "Complete" concerns the recorded components, not tax/accounting certification.

**Action:** `id`, `actor`, `actionType`, `targetId`, `policyDecision`, `status`, `externalReference`, `occurredAt`. Current actor is `demo`, policy decision is `demo_only`, status is `applied` or `ignored_stale`, and external reference is null. The snapshot shows the latest 100 entries, newest first; the store retains every event receipt up to its explicit capacity.

## Simulation controls

`POST /api/commerce/demo/events`, JSON body:

```json
{ "eventId": "demo-paid-click-001", "step": "paid" }
```

The maximum body is 4096 bytes. Only `eventId` and `step` are accepted. Use a fresh event ID for a new action, and **reuse the same ID and body when retrying that action**. IDs use letters, digits, `.`, `_`, `:`, or `-`, start with a letter/digit, and have a maximum length of 128.

The response is `{ ok: true, duplicate: boolean, outcome: 'applied' | 'ignored_stale', snapshot: ... }`. Snapshot has the read shape above except `demoSteps` (available from the GET route). Reusing an event ID with a different body returns 409.

| Step | Effect |
| --- | --- |
| `paid` | Create fixed demo order `demo-order-001` once |
| `payment_failed` | Simulate supplier billing failure; customer payment stays paid |
| `processing` | Supplier processing confirmed; resolve earlier billing exception |
| `tracking_missing` | Shipment exists but tracking unavailable; open exception |
| `shipped` | Confirm shipment with tracking; resolve missing-tracking exception |
| `delivered` | Confirm delivery |
| `cancel_requested` | Request cancellation without inventing a refund or supplier stop |
| `canceled` | Record marketplace cancellation; supplier state is preserved |
| `refunded` | Record a full refund; supplier state is preserved |
| `costs_confirmed` | Fill illustrative costs; can be applied before or after refund |

Create `paid` before subsequent steps. A recommended demonstration is `paid -> payment_failed -> processing -> tracking_missing -> shipped -> delivered -> costs_confirmed`. A cancellation/refund can then demonstrate why human review may still be needed after shipment. Illustrative revenue is $35 and known recorded costs before refund total $20.50; these are **not supplier quotations or Etsy fee calculations**.

Each step has a fixed synthetic revision. Repeating an older step with a different ID returns `ignored_stale` instead of regressing state. This is one persistent demonstration order, not a general editing API or scenario-reset tool.

## Persistence and failure behavior

State lives beneath the host's `WORKSPACES/commerce/`, in separate `demo.json` and `disconnected.json` files. Read-only access does not create files. Disconnected state cannot ingest events. No new dependencies are required.

One transaction durably stores the order transition, exception changes, action, and event receipt. The existing fsync-before-rename writer and backup mechanism are reused. Reads are revalidated; writes are serialized by resolved filename across instances in one process, then read back before success is reported. The host's existing workspace-owner protection must exclude a second process.

Normal restart retains progress and duplicate protection. A corrupt, unreadable, future-version, or invalid ledger produces 503 and preserves its files. A backup is **not** silently promoted: it may lack recent event receipts. Recovery requires inspection/reconciliation before reuse. No reset or repair endpoint is provided in this milestone.

Limits are 500 orders and 5000 event receipts per store. At capacity, new events are refused rather than dropping duplicate protection. Replace this bounded prototype store with transactional database tables and a durable inbox before production-scale ingestion.

Errors use `{ ok: false, code, error? }`. Validation is 400, conflicting event identities or missing-order reconciliation is 409, unsupported methods are 405, unknown commerce paths are 404, and storage faults are 503. Identical event retries succeed with `duplicate: true`. Keep the last displayed data visibly stale on failure; never replace a failed read with an apparently empty healthy shop.

## Next integrations

Live Etsy OAuth, supplier access, raw webhook authentication, normalized provider revisions, missed-event reconciliation, provider catalog editing, partial refunds/shipments, actual spend limits, and hosted execution remain separate work. No public provider webhook should expose the desktop agent server. One system must own fulfillment submission: native supplier import and a custom submission path must not both submit the same order.

## Validation

Run `node test/commerce.test.js` and `node test/commerce.http.test.js`. The first covers domain state, replay/concurrency, restart, cancellation/refund semantics, money, invalid records, and storage faults. The second boots the real sidecar in an isolated temporary profile and tests authentication, origin restrictions, routing, and persistence. They are registered in `test/fast.list` and `test/http.list` respectively. A full application suite also needs the frontend files and normal project dependencies.

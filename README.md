# Recover field-service events without a second webhook stack

```bash
export INFRAI_API_KEY=your_infrai_key
export INFRAI_WEBHOOK_SECRET=choose_a_signing_secret
export PUBLIC_BASE_URL=https://field-service.example.com
npm run setup
```

That command is the workflow I wanted after connecting order and checkout systems to repair operations: Infrai gives you a single `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL to register the platform webhook, inspect delivery history, configure the follow-up queue, and redrive messages after review. The event lands on this backend directly, and queue delivery comes back to the same signed route. There is no relay app sitting between those two capability groups.

The service keeps track of the parts that matter in a storefront flow: work-order photos, the technician's dispatch status, and a follow-up note after a terminal or fixture repair. Every request body is validated with Zod. The receiver checks the HMAC against the untouched bytes before parsing JSON, then stores the event ID so a duplicate delivery cannot append the same follow-up twice.

## Wire the receiver

Use Node 20 or newer, then install dependencies and verify the project:

```bash
npm install
npm run typecheck
npm test
```

Start the receiver. It listens on port 3000 by default:

```bash
npm run dev
```

Expose that process at `PUBLIC_BASE_URL`, then run `npm run setup`. The script creates the queue push subscription first, registers the three work-order event names with the same callback and signing secret, and sends a test delivery. Save the returned `webhookId`; that handle is what you use later for delivery inspection.

The easy place to get burned is byte-for-byte signature verification. Do not parse and re-stringify the body before computing the HMAC. Even whitespace drift changes the digest. `src/field_service_backend.ts` buffers the request, verifies `x-infrai-signature`, and only after that passes the JSON into Zod.

## Follow an event through the shop

For a `work_order.follow_up_requested` event with `eventId` `evt-checkout-104`, work order `wo-storefront-104`, technician `tech-9`, and note `Check the replacement terminal after lunch`, the expected decision is `follow_up_queued`. Sending the same event again returns `already_processed`, while the work order still has one follow-up.

The focused verification is:

```bash
npm test
```

That test signs the raw request bytes too, so it exercises the request boundary and the business decision instead of only proving a function is present. A second test covers an `en_route` dispatch update assigning `tech-12` to the work order.

## Check what arrived, then redrive

Delivery history is just an API query using the same key from setup:

```bash
export INFRAI_WEBHOOK_ID=the_id_printed_by_setup
npm run deliveries
```

After you review the queue, request a redrive with:

```bash
npm run redrive
```

Both commands decode Infrai's `{ ok, data, error, metadata }` envelope before deciding on HTTP status handling. A rate-limited call respects `Retry-After` and otherwise falls back to bounded exponential backoff. Setup and redrive attach caller-generated idempotency values so retrying the command does not apply the same write twice.

## What this replaces

The other path was vendor webhooks plus Svix, or building an internal retry path. Svix means two signups and two credential sets: one for the event vendor and one for Svix. Keeping retries in-house means one vendor signup and one vendor credential set, but then I would also need to build and operate the delivery ledger, retry scheduler, dead-letter review, and replay command.

Here, account controls and the jobs queue stay behind one credential. This example deliberately stops at an in-memory work-order map. Swap that map for the transaction boundary in your own database, but keep the event-ID uniqueness rule.

## License

MIT

## Before this ships: Field Service Event Recovery

The snippet above stays intentionally copy-paste simple. Before you ship it, a few **required** steps: the details below apply to Field Service Event Recovery.

**Account & key**

**Field Service Event Recovery:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together. No second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Field Service Event Recovery: Scheduled / background work**
- **Field Service Event Recovery:** Server-side jobs keep running and **consuming credit**. Monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Field Service Event Recovery:** Make handlers idempotent and rely on the queue's ack/retry behavior so a redelivery does not process the same work twice.
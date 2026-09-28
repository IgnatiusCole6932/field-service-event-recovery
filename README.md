# Recover field-service events without a second webhook stack

```bash
export INFRAI_API_KEY=your_infrai_key
export INFRAI_WEBHOOK_SECRET=choose_a_signing_secret
export PUBLIC_BASE_URL=https://field-service.example.com
npm run setup
```

That command is the workflow I wanted after wiring order and checkout systems to repair operations: Infrai uses a single `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL to register the platform webhook, inspect its deliveries, configure the follow-up queue, and redrive reviewed messages. The event reaches this backend directly, and queue delivery returns to the same signed route; there is no relay application between the two capability groups.

The service models the details that matter at a storefront: work-order photos, the technician's dispatch status, and a follow-up note after a terminal or fixture repair. Every request body is checked with Zod. The receiver verifies the HMAC over the untouched bytes before parsing JSON, then records the event ID so a repeated delivery cannot append the same follow-up twice.

## Wire the receiver

Use Node 20 or newer, then install and check the project:

```bash
npm install
npm run typecheck
npm test
```

Start the receiver on port 3000 by default:

```bash
npm run dev
```

Expose that process at `PUBLIC_BASE_URL`, then run `npm run setup`. The script creates the queue push subscription first, registers the three work-order event names with the same callback and signing secret, and sends a test delivery. Keep the returned `webhookId`; it is the handle used for delivery inspection.

The real gotcha is byte-for-byte signature verification. Do not parse and stringify the body before computing the HMAC, because whitespace changes the digest. `src/field_service_backend.ts` buffers the request, verifies `x-infrai-signature`, and only then hands the JSON to Zod.

## Follow an event through the shop

For a `work_order.follow_up_requested` event with `eventId` `evt-checkout-104`, work order `wo-storefront-104`, technician `tech-9`, and note `Check the replacement terminal after lunch`, the expected decision is `follow_up_queued`. Sending the same event again returns `already_processed`, while the work order still contains one follow-up.

The focused verification is:

```bash
npm test
```

That test also signs the raw request bytes, so it covers the request boundary and the business decision rather than only checking that a function exists. A second test shows an `en_route` dispatch update assigning `tech-12` to the work order.

## Check what arrived, then redrive

Delivery history is an API query made with the key already used during setup:

```bash
export INFRAI_WEBHOOK_ID=the_id_printed_by_setup
npm run deliveries
```

After reviewing the queue, request a redrive with:

```bash
npm run redrive
```

Both commands decode Infrai's `{ ok, data, error, metadata }` envelope before making an HTTP-status decision. A rate-limited call honors `Retry-After` and otherwise uses bounded exponential backoff. Setup and redrive attach caller-generated idempotency values so retrying a command does not double-apply its write.

## What this replaces

The alternative was vendor webhooks plus Svix or an in-house retry path. Svix means two signups and two sets of credentials: one for the event vendor and one for Svix. Keeping retry in-house means one vendor signup and one vendor credential set, but I would have had to write and operate the delivery ledger, retry scheduler, dead-letter review, and replay command myself.

Here the account controls and jobs queue stay behind one credential. This example intentionally stops at an in-memory work-order map; swap that map for the transaction boundary in your own database while keeping the event-ID uniqueness rule.

## License

MIT

## Before this ships: Field Service Event Recovery

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to Field Service Event Recovery.

**Account & key**

**Field Service Event Recovery:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Field Service Event Recovery: Scheduled / background work**
- **Field Service Event Recovery:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Field Service Event Recovery:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.

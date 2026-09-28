import { randomUUID } from "node:crypto";
import { infrai } from "./infrai_client.js";

const queue = process.env.FIELD_SERVICE_QUEUE ?? "field-service-follow-up";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in your environment`);
  return value;
}

async function setup(): Promise<void> {
  const publicBaseUrl = required("PUBLIC_BASE_URL").replace(/\/$/, "");
  const secret = required("INFRAI_WEBHOOK_SECRET");
  const receiverUrl = `${publicBaseUrl}/platform-events`;
  const setupId = randomUUID();

  await infrai.queue.push_subscribe(queue, {
    queue,
    url: receiverUrl,
    secret,
    max_retries: 5,
    visibility_timeout: 60,
    dead_letter_queue: `${queue}-review`,
    idempotency_key: `field-service-push:${setupId}`,
  });

  const webhook = await infrai.account.webhooks.register({
    url: receiverUrl,
    events: [
      "work_order.photo_added",
      "work_order.dispatch_changed",
      "work_order.follow_up_requested",
    ],
    description: "Field-service work order events",
    secret,
    retry_policy: { max_retries: 5 },
  }, `field-service-webhook:${setupId}`);

  await infrai.account.webhooks.test(webhook.id, `field-service-test:${webhook.id}`);
  console.log(JSON.stringify({ webhookId: webhook.id, queue, receiverUrl }, null, 2));
}

async function deliveries(): Promise<void> {
  const webhookId = required("INFRAI_WEBHOOK_ID");
  const result = await infrai.account.webhooks.deliveries(webhookId);
  console.log(JSON.stringify(result, null, 2));
}

async function redrive(): Promise<void> {
  await infrai.queue.dlq.redrive(`${queue}-review`, `field-service-redrive:${randomUUID()}`);
  console.log(JSON.stringify({ redriveRequested: true, queue: `${queue}-review` }, null, 2));
}

const command = process.argv[2];
const actions: Record<string, () => Promise<void>> = { setup, deliveries, redrive };
const action = command ? actions[command] : undefined;
if (!action) throw new Error("Use setup, deliveries, or redrive");
await action();

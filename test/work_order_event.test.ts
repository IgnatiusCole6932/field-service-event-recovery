import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { validSignature } from "../src/field_service_backend.js";
import { applyWorkOrderEvent, workOrderEventSchema } from "../src/work_order_event.js";

test("a signed follow-up event is applied once when delivery is repeated", () => {
  const raw = Buffer.from(JSON.stringify({
    eventId: "evt-checkout-104",
    type: "work_order.follow_up_requested",
    occurredAt: "2026-09-27T08:30:00.000Z",
    workOrderId: "wo-storefront-104",
    followUp: { technicianId: "tech-9", note: "Check the replacement terminal after lunch" },
  }));
  const secret = "test-signing-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  assert.equal(validSignature(raw, signature, secret), true);

  const event = workOrderEventSchema.parse(JSON.parse(raw.toString("utf8")));
  const first = applyWorkOrderEvent(undefined, event);
  const repeated = applyWorkOrderEvent(first.workOrder, event);

  assert.equal(first.action, "follow_up_queued");
  assert.equal(repeated.action, "already_processed");
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.workOrder.followUps.length, 1);
});

test("a dispatch event makes the assigned technician visible", () => {
  const event = workOrderEventSchema.parse({
    eventId: "evt-dispatch-105",
    type: "work_order.dispatch_changed",
    occurredAt: "2026-09-27T09:00:00.000Z",
    workOrderId: "wo-storefront-105",
    dispatch: { status: "en_route", technicianId: "tech-12" },
  });
  const result = applyWorkOrderEvent(undefined, event);
  assert.equal(result.workOrder.dispatchStatus, "en_route");
  assert.equal(result.workOrder.technicianId, "tech-12");
});

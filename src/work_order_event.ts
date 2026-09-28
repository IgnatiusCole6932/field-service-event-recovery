import { z } from "zod";

export const workOrderEventSchema = z.discriminatedUnion("type", [
  z.object({
    eventId: z.string().min(1),
    type: z.literal("work_order.photo_added"),
    occurredAt: z.iso.datetime(),
    workOrderId: z.string().min(1),
    photo: z.object({ photoId: z.string().min(1), objectKey: z.string().min(1) }),
  }),
  z.object({
    eventId: z.string().min(1),
    type: z.literal("work_order.dispatch_changed"),
    occurredAt: z.iso.datetime(),
    workOrderId: z.string().min(1),
    dispatch: z.object({
      status: z.enum(["unassigned", "assigned", "en_route", "on_site", "completed"]),
      technicianId: z.string().min(1).optional(),
    }),
  }),
  z.object({
    eventId: z.string().min(1),
    type: z.literal("work_order.follow_up_requested"),
    occurredAt: z.iso.datetime(),
    workOrderId: z.string().min(1),
    followUp: z.object({ technicianId: z.string().min(1), note: z.string().min(1) }),
  }),
]);

export type WorkOrderEvent = z.infer<typeof workOrderEventSchema>;
export type WorkOrder = {
  id: string;
  photoObjectKeys: string[];
  dispatchStatus: "unassigned" | "assigned" | "en_route" | "on_site" | "completed";
  technicianId?: string;
  followUps: Array<{ technicianId: string; note: string }>;
  processedEventIds: Set<string>;
};

export type EventResult = {
  duplicate: boolean;
  workOrder: WorkOrder;
  action: "photo_recorded" | "dispatch_updated" | "follow_up_queued" | "already_processed";
};

export function applyWorkOrderEvent(current: WorkOrder | undefined, event: WorkOrderEvent): EventResult {
  const workOrder: WorkOrder = current ?? {
    id: event.workOrderId,
    photoObjectKeys: [],
    dispatchStatus: "unassigned",
    followUps: [],
    processedEventIds: new Set(),
  };

  if (workOrder.processedEventIds.has(event.eventId)) {
    return { duplicate: true, workOrder, action: "already_processed" };
  }

  if (event.type === "work_order.photo_added") {
    if (!workOrder.photoObjectKeys.includes(event.photo.objectKey)) {
      workOrder.photoObjectKeys.push(event.photo.objectKey);
    }
    workOrder.processedEventIds.add(event.eventId);
    return { duplicate: false, workOrder, action: "photo_recorded" };
  }

  if (event.type === "work_order.dispatch_changed") {
    workOrder.dispatchStatus = event.dispatch.status;
    workOrder.technicianId = event.dispatch.technicianId;
    workOrder.processedEventIds.add(event.eventId);
    return { duplicate: false, workOrder, action: "dispatch_updated" };
  }

  workOrder.followUps.push(event.followUp);
  workOrder.processedEventIds.add(event.eventId);
  return { duplicate: false, workOrder, action: "follow_up_queued" };
}

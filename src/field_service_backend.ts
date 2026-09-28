import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { applyWorkOrderEvent, type WorkOrder, workOrderEventSchema } from "./work_order_event.js";

const workOrders = new Map<string, WorkOrder>();

export function validSignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function receiveEvent(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const secret = process.env.INFRAI_WEBHOOK_SECRET;
  if (!secret) throw new Error("Set INFRAI_WEBHOOK_SECRET before starting the backend");
  const rawBody = await readBody(request);
  const signature = request.headers["x-infrai-signature"];
  const signatureValue = Array.isArray(signature) ? signature[0] : signature;
  if (!validSignature(rawBody, signatureValue, secret)) {
    send(response, 401, { accepted: false, reason: "invalid_signature" });
    return;
  }

  const event = workOrderEventSchema.parse(JSON.parse(rawBody.toString("utf8")));
  const result = applyWorkOrderEvent(workOrders.get(event.workOrderId), event);
  workOrders.set(event.workOrderId, result.workOrder);
  send(response, 200, {
    accepted: true,
    duplicate: result.duplicate,
    action: result.action,
    workOrderId: event.workOrderId,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  createServer((request, response) => {
    if (request.method === "POST" && request.url === "/platform-events") {
      receiveEvent(request, response).catch((error: unknown) => {
        if (error instanceof z.ZodError || error instanceof SyntaxError) {
          send(response, 400, { accepted: false, reason: "invalid_event" });
          return;
        }
        console.error(error);
        send(response, 500, { accepted: false, reason: "request_failed" });
      });
      return;
    }
    send(response, 404, { error: "route_not_found" });
  }).listen(port, () => console.log(`Field-service event receiver listening on http://localhost:${port}`));
}

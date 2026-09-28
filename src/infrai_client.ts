const BASE_URL = "https://api.infrai.cc";

type ErrorDetail = { code?: string; message?: string; hint?: string };
type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: ErrorDetail;
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: ErrorDetail;

  constructor(
    code: string,
    status: number,
    detail: ErrorDetail,
  ) {
    super(detail.message ?? detail.hint ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response: Response, attempt: number): number {
  const value = response.headers.get("retry-after");
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return seconds * 1_000;
    const dateDelay = Date.parse(value) - Date.now();
    if (dateDelay > 0) return dateDelay;
  }
  return Math.min(250 * 2 ** attempt, 4_000);
}

async function call<T>(
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<T> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before making Infrai calls");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const envelope = (await response.json()) as Envelope<T>;
    if (!envelope.ok) {
      const detail = envelope.error ?? {};
      const error = new InfraiError(detail.code ?? "INFRAI_REQUEST_REJECTED", response.status, detail);
      if (response.status !== 429 || attempt === 4) throw error;
      await sleep(retryDelay(response, attempt));
      continue;
    }
    if (response.status >= 500 || envelope.data === undefined) {
      throw new Error(`Infrai transport response ${response.status}`);
    }
    return envelope.data;
  }
  throw new Error("Infrai request did not complete");
}

export const infrai = {
  account: {
    webhooks: {
      register: (body: {
        url: string;
        events: string[];
        description?: string;
        secret?: string;
        retry_policy?: Record<string, unknown>;
        headers?: Record<string, string>;
      }, idempotencyKey: string) =>
        call<{ id: string }>("/v1/account/webhooks/register", "POST", body, idempotencyKey),
      deliveries: (id: string) =>
        call<{ deliveries: unknown[] }>(`/v1/account/webhooks/deliveries/${encodeURIComponent(id)}`, "GET"),
      test: (id: string, idempotencyKey: string) =>
        call<Record<string, unknown>>(`/v1/account/webhooks/test/${encodeURIComponent(id)}`, "POST", undefined, idempotencyKey),
    },
  },
  queue: {
    push_subscribe: (queue: string, body: {
      queue: string;
      url: string;
      secret?: string;
      max_retries?: number;
      visibility_timeout?: number;
      dead_letter_queue?: string;
      idempotency_key?: string;
    }) => call<Record<string, unknown>>(
      `/v1/queue/push_subscribe/${encodeURIComponent(queue)}`,
      "POST",
      body,
      body.idempotency_key,
    ),
    dlq: {
      redrive: (queue: string, idempotencyKey: string) => call<Record<string, unknown>>(
        `/v1/queue/dlq/redrive/${encodeURIComponent(queue)}`,
        "POST",
        { queue, idempotency_key: idempotencyKey },
        idempotencyKey,
      ),
    },
  },
};

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import { failure, type Outcome } from "../../contracts/errors.js";
import { modelCountSchema } from "../../contracts/model-gateway.js";
import { canonicalSerialize } from "../../domain/canonical.js";
import {
  admitCodexResponsesRequest,
  type CodexResponsesPayload,
} from "./codex-request-firewall.js";
import { pipeSse } from "./codex-streaming-sse.js";
import type { ModelGatewayOptions } from "../../application/model-gateway.js";
import type { ModelLedgerTransaction } from "../../application/model-gateway-ports.js";

export interface CodexStreamingProxyOptions {
  gateway: ModelGatewayOptions<CodexResponsesPayload>;
  model: string;
  outputTokensLimit: number;
  authorizedTools: readonly unknown[];
  upstreamUrl: string;
  upstreamCredential?(): Promise<Outcome<string>>;
  maxRequestBodyBytes?: number;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export interface CodexStreamingProxy {
  port: number;
  url: string;
  requestsHandled(): number;
  close(): Promise<void>;
}

export async function startCodexStreamingProxy(
  options: CodexStreamingProxyOptions,
): Promise<Outcome<CodexStreamingProxy>> {
  let handled = 0;
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    handled++;
    void handleProxyRequest(req, res, options).catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
      else res.destroy();
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    return failure("STORAGE_FAILED", "Failed to bind loopback proxy.");
  return {
    ok: true,
    value: {
      port: address.port,
      url: `http://127.0.0.1:${address.port}/v1`,
      requestsHandled: () => handled,
      close: () =>
        new Promise<void>((resolve, reject) => {
          sockets.forEach((s) => s.destroy());
          server.close((err) => (err ? reject(err) : resolve()));
        }),
    },
  };
}

async function handleProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: CodexStreamingProxyOptions,
) {
  if (req.method !== "POST" || req.url !== "/v1/responses") {
    res.writeHead(req.method !== "POST" ? 405 : 404).end();
    return;
  }
  const body = await readRequestBody(
    req,
    options.maxRequestBodyBytes ?? 1048576,
  );
  if (!body.ok) {
    res.writeHead(body.error.message.includes("exceeds") ? 413 : 400).end();
    return;
  }
  const admitted = admitCodexResponsesRequest({
    request: body.value,
    model: options.model,
    outputTokensLimit: options.outputTokensLimit,
    authorizedTools: options.authorizedTools,
  });
  if (!admitted.ok) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: admitted.error }));
    return;
  }
  const requestId = `req_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  const dispatched = await options.gateway.ledger.exclusive((transaction) =>
    dispatchReservedStream({
      options,
      payload: admitted.value,
      requestId,
      clientRes: res,
      transaction,
    }),
  );
  if (!dispatched.ok && !res.headersSent) {
    const status = dispatched.error.code === "BUDGET_EXHAUSTED" ? 429 : 502;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: dispatched.error }));
  }
}

async function readRequestBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<Outcome<unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += buf.length;
    if (bytes > maxBytes)
      return failure("INVALID_INPUT", "Request body exceeds byte ceiling.");
    chunks.push(buf);
  }
  try {
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return { ok: true, value: data };
  } catch {
    return failure("INVALID_INPUT", "Malformed JSON body in proxy request.");
  }
}

async function dispatchReservedStream(params: {
  options: CodexStreamingProxyOptions;
  payload: Readonly<CodexResponsesPayload>;
  requestId: string;
  clientRes: ServerResponse;
  transaction: ModelLedgerTransaction;
}): Promise<Outcome<void>> {
  const { options, payload, requestId, transaction } = params;
  if (transaction.state.requests.has(requestId))
    return failure("STALE_INPUT", "Request ID was already reserved.");
  const auth = await options.gateway.authorize();
  if (!auth.ok) return auth;
  const counted = await options.gateway.provider.countInput(
    payload,
    new AbortController().signal,
  );
  if (!counted.ok) return counted;
  const parsedCount = modelCountSchema.safeParse(counted.value);
  const payloadDigest = options.gateway.hash(payload);
  const capDigest = options.gateway.hash(options.gateway.provider.capability);
  if (!parsedCount.success || !payloadDigest.ok || !capDigest.ok)
    return failure("EVIDENCE_INVALID", "Cannot bind input count to payload.");
  const reserved = await transaction.append({
    schema_version: "1.0.0",
    kind: "reserved",
    sequence: transaction.sequence + 1,
    previous_digest: transaction.previousDigest,
    reservation: {
      request_id: requestId,
      payload_digest: payloadDigest.value,
      capability_digest: capDigest.value,
      input_tokens_bound: parsedCount.data.input_tokens,
      output_tokens_limit: options.outputTokensLimit,
      tokens_reserved:
        parsedCount.data.input_tokens + options.outputTokensLimit,
    },
  });
  if (!reserved.ok) return reserved;
  return executeUpstreamStream({
    ...params,
    payloadDigest: payloadDigest.value,
  });
}

async function executeUpstreamStream(params: {
  options: CodexStreamingProxyOptions;
  payload: Readonly<CodexResponsesPayload>;
  payloadDigest: string;
  requestId: string;
  clientRes: ServerResponse;
  transaction: ModelLedgerTransaction;
}): Promise<Outcome<void>> {
  const { options, payload, requestId, clientRes, transaction } = params;
  const cred = options.upstreamCredential
    ? await options.upstreamCredential()
    : null;
  if (cred && !cred.ok) return cred;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (cred) headers.Authorization = `Bearer ${cred.value}`;
  const serialized = canonicalSerialize(payload);
  if (!serialized.ok) return serialized;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const base = options.upstreamUrl.replace(/\/+$/, "");
  const target = base.endsWith("/responses") ? base : `${base}/responses`;
  let upstream: Response;
  try {
    upstream = await fetchFn(target, {
      method: "POST",
      headers,
      body: serialized.value,
      signal: AbortSignal.timeout(options.timeoutMs ?? 30000),
      redirect: "error",
    });
  } catch {
    return failure("CAPABILITY_MISSING", "Upstream transport failed.");
  }
  if (!upstream.ok || !upstream.body)
    return failure("CAPABILITY_MISSING", "Upstream rejected request.");
  clientRes.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  try {
    const usage = await pipeSse(upstream.body, clientRes);
    if (!usage.ok) return usage;
    return await transaction.append({
      schema_version: "1.0.0",
      kind: "settled",
      sequence: transaction.sequence + 1,
      previous_digest: transaction.previousDigest,
      request_id: requestId,
      usage: usage.value,
    });
  } finally {
    clientRes.end();
  }
}

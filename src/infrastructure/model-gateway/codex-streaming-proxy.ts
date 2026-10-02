import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import type { Socket } from "node:net";
import { failure, type Outcome } from "../../contracts/errors.js";
import {
  modelCountSchema,
  type ModelCapability,
} from "../../contracts/model-gateway.js";
import {
  admitCodexResponsesRequest,
  type CodexResponsesPayload,
} from "./codex-request-firewall.js";
import { pipeSse } from "./codex-streaming-sse.js";
import {
  fetchCodexUpstream,
  readBoundedCodexJson,
  validateCodexTransport,
  type CodexTransportOptions,
} from "./codex-upstream.js";
import {
  verifyGatewayCapability,
  type ModelGatewayOptions,
} from "../../application/model-gateway.js";
import type { ModelLedgerTransaction } from "../../application/model-gateway-ports.js";

export interface CodexStreamingProxyOptions extends CodexTransportOptions {
  gateway: ModelGatewayOptions<CodexResponsesPayload>;
  model: string;
  outputTokensLimit: number;
  authorizedTools: readonly unknown[];
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
  const valid = validateCodexTransport(options);
  if (!valid.ok) return valid;
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
  const capability = await verifyGatewayCapability(options.gateway);
  if (!capability.ok) {
    res.writeHead(503).end();
    return;
  }
  const body = await readBoundedCodexJson(
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
  const requestId = `req_${randomUUID().replaceAll("-", "")}`;
  const controller = new AbortController();
  const abort = () => controller.abort();
  const abortClosedClient = () => {
    if (!res.writableEnded) controller.abort();
  };
  req.once("aborted", abort);
  res.once("close", abortClosedClient);
  const dispatched = await options.gateway.ledger.exclusive((transaction) =>
    dispatchReservedStream({
      options,
      payload: admitted.value,
      requestId,
      clientRes: res,
      transaction,
      signal: controller.signal,
      capability: capability.value,
    }),
  );
  req.off("aborted", abort);
  res.off("close", abortClosedClient);
  if (!dispatched.ok && !res.headersSent) {
    const status = dispatched.error.code === "BUDGET_EXHAUSTED" ? 429 : 502;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: dispatched.error }));
  }
}

async function dispatchReservedStream(params: {
  options: CodexStreamingProxyOptions;
  payload: Readonly<CodexResponsesPayload>;
  requestId: string;
  clientRes: ServerResponse;
  transaction: ModelLedgerTransaction;
  signal: AbortSignal;
  capability: Readonly<ModelCapability>;
}): Promise<Outcome<void>> {
  const { options, payload, requestId, transaction, signal } = params;
  if (transaction.state.requests.has(requestId))
    return failure("STALE_INPUT", "Request ID was already reserved.");
  const auth = await options.gateway.authorize();
  if (!auth.ok) return auth;
  if (signal.aborted)
    return failure("CANCELLED", "Codex request cancelled before counting.");
  const counted = await options.gateway.provider.countInput(payload, signal);
  if (!counted.ok) return counted;
  const parsedCount = modelCountSchema.safeParse(counted.value);
  const payloadDigest = options.gateway.hash(payload);
  const capDigest = options.gateway.hash(params.capability);
  if (
    !parsedCount.success ||
    !payloadDigest.ok ||
    !capDigest.ok ||
    parsedCount.data.payload_digest !== payloadDigest.value
  )
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
  const reauthorized = await options.gateway.authorize();
  if (!reauthorized.ok) return reauthorized;
  if (signal.aborted)
    return failure(
      "CANCELLED",
      "Codex request cancelled after reservation; ceiling remains charged.",
    );
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
  signal: AbortSignal;
}): Promise<Outcome<void>> {
  const { options, payload, requestId, clientRes, transaction, signal } =
    params;
  const fetched = await fetchCodexUpstream(options, payload, signal);
  if (!fetched.ok) return fetched;
  const upstream = fetched.value;
  clientRes.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  try {
    const usage = await pipeSse(upstream.body, clientRes, {
      maxBytes: options.maxResponseBytes ?? 1_048_576,
      signal,
    });
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

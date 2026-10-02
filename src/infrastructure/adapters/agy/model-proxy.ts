import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import { failure, type Outcome } from "../../../contracts/errors.js";
import { modelCountSchema } from "../../../contracts/model-gateway.js";
import type { ModelGatewayOptions } from "../../../application/model-gateway.js";
import type { ModelLedgerTransaction } from "../../../application/model-gateway-ports.js";

export interface AgyStreamingProxyOptions {
  gateway: ModelGatewayOptions<unknown>;
  model: string;
  outputTokensLimit: number;
  upstreamUrl?: string;
  upstreamCredential?(): Promise<Outcome<string>>;
  maxRequestBodyBytes?: number;
  mockResponseGenerator?: (body: unknown) => unknown;
}

export interface AgyStreamingProxy {
  port: number;
  url: string;
  requestsHandled(): number;
  close(): Promise<void>;
}

export async function startAgyStreamingProxy(
  options: AgyStreamingProxyOptions,
): Promise<Outcome<AgyStreamingProxy>> {
  let handled = 0;
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    handled++;
    void handleAgyRequest(req, res, options).catch(() => {
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
  if (!address || typeof address === "string") {
    return failure("STORAGE_FAILED", "Failed to bind agy loopback proxy.");
  }

  return {
    ok: true,
    value: {
      port: address.port,
      url: `http://127.0.0.1:${address.port}`,
      requestsHandled: () => handled,
      close: () =>
        new Promise<void>((resolve, reject) => {
          sockets.forEach((s) => s.destroy());
          server.close((err) => (err ? reject(err) : resolve()));
        }),
    },
  };
}

async function handleAgyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: AgyStreamingProxyOptions,
): Promise<void> {
  const url = req.url ?? "";
  if (url.includes("loadCodeAssist")) {
    handleLoadCodeAssist(res, options.model);
    return;
  }
  if (url.includes("fetchAvailableModels")) {
    handleFetchAvailableModels(res, options.model);
    return;
  }
  if (
    url.includes("generateContent") ||
    url.includes("streamGenerateContent")
  ) {
    await handleGenerateContent(req, res, options);
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: `Not found: ${url}` }));
}

function handleLoadCodeAssist(res: ServerResponse, model: string): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      userTier: { userTier: "PAID" },
      allowedModels: [model, "gemini-3.8-flash-medium", "auto"],
    }),
  );
}

function handleFetchAvailableModels(res: ServerResponse, model: string): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      models: [
        { modelName: model, displayName: model },
        { modelName: "gemini-3.8-flash-medium", displayName: "Flash Medium" },
      ],
    }),
  );
}

async function handleGenerateContent(
  req: IncomingMessage,
  res: ServerResponse,
  options: AgyStreamingProxyOptions,
): Promise<void> {
  const maxBytes = options.maxRequestBodyBytes ?? 1048576;
  const body = await readRequestBody(req, maxBytes);
  if (!body.ok) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: body.error }));
    return;
  }
  const requestId = `req_agy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const dispatched = await options.gateway.ledger.exclusive((transaction) =>
    dispatchAgyReserved({
      options,
      payload: body.value,
      requestId,
      clientRes: res,
      transaction,
    }),
  );
  if (!dispatched.ok && !res.headersSent) {
    const status = dispatched.error.code === "BUDGET_EXHAUSTED" ? 429 : 500;
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
    if (bytes > maxBytes) {
      return failure("INVALID_INPUT", "Request body exceeds byte ceiling.");
    }
    chunks.push(buf);
  }
  try {
    const raw = Buffer.concat(chunks).toString("utf8");
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return failure("INVALID_INPUT", "Malformed JSON body in proxy request.");
  }
}

async function dispatchAgyReserved(params: {
  options: AgyStreamingProxyOptions;
  payload: unknown;
  requestId: string;
  clientRes: ServerResponse;
  transaction: ModelLedgerTransaction;
}): Promise<Outcome<void>> {
  const { options, payload, requestId, clientRes, transaction } = params;
  const counted = await options.gateway.provider.countInput(
    payload as Readonly<unknown>,
    new AbortController().signal,
  );
  if (!counted.ok) return counted;
  const parsedCount = modelCountSchema.safeParse(counted.value);
  const payloadDigest = options.gateway.hash(payload);
  const capDigest = options.gateway.hash(options.gateway.provider.capability);
  if (!parsedCount.success || !payloadDigest.ok || !capDigest.ok) {
    return failure("EVIDENCE_INVALID", "Cannot bind input count to payload.");
  }
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

  return settleAndRespond({
    options,
    payload,
    inputTokens: parsedCount.data.input_tokens,
    requestId,
    clientRes,
    transaction,
  });
}

async function settleAndRespond(params: {
  options: AgyStreamingProxyOptions;
  payload: unknown;
  inputTokens: number;
  requestId: string;
  clientRes: ServerResponse;
  transaction: ModelLedgerTransaction;
}): Promise<Outcome<void>> {
  const { options, payload, inputTokens, requestId, clientRes, transaction } =
    params;
  const mock = options.mockResponseGenerator
    ? options.mockResponseGenerator(payload)
    : {
        candidates: [
          {
            content: { parts: [{ text: "synthetic response" }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: inputTokens,
          candidatesTokenCount: 10,
          totalTokenCount: inputTokens + 10,
        },
      };

  const outputTokens = 10;
  await transaction.append({
    schema_version: "1.0.0",
    kind: "settled",
    sequence: transaction.sequence + 1,
    previous_digest: transaction.previousDigest,
    request_id: requestId,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_input_tokens: 0,
      reasoning_tokens: 0,
      charged_tokens: inputTokens + outputTokens,
      accounting_complete: true,
    },
  });

  clientRes.writeHead(200, { "Content-Type": "application/json" });
  clientRes.end(JSON.stringify(mock));
  return { ok: true, value: undefined };
}

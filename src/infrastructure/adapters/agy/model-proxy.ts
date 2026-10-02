import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import type { Socket } from "node:net";
import { failure, type Outcome } from "../../../contracts/errors.js";
import {
  modelCountSchema,
  type ModelCapability,
} from "../../../contracts/model-gateway.js";
import { verifyGatewayCapability } from "../../../application/model-gateway.js";
import type { ModelLedgerTransaction } from "../../../application/model-gateway-ports.js";
import {
  fetchAgyUpstream,
  parseAgyUsage,
  validateAgyUpstream,
  type AgyUpstreamResponse,
} from "./upstream.js";
import {
  agyAvailableModels,
  agyHandshake,
  parseAgyRoute,
  readAgyRequestBody,
  respondAgyError,
  respondAgyJson,
} from "./protocol.js";
import { appendAgySettlement } from "./ledger-events.js";
import type { AgyStreamingProxyOptions } from "./options.js";

export type { AgyStreamingProxyOptions } from "./options.js";

export interface AgyStreamingProxy {
  port: number;
  url: string;
  requestsHandled(): number;
  close(): Promise<void>;
}

export async function startAgyStreamingProxy(
  options: AgyStreamingProxyOptions,
): Promise<Outcome<AgyStreamingProxy>> {
  const requestLimit = options.maxRequestBodyBytes ?? 1_048_576;
  if (
    !Number.isSafeInteger(requestLimit) ||
    requestLimit < 1 ||
    requestLimit > 1_048_576
  )
    return failure(
      "INVALID_INPUT",
      "Invalid Antigravity request byte ceiling.",
    );
  if (options.kind === "upstream") {
    const valid = validateAgyUpstream(options);
    if (!valid.ok) return valid;
  }
  let handled = 0;
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    handled++;
    void handleAgyRequest(req, res, options).catch(() =>
      respondAgyError(res, 500),
    );
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
    return failure("STORAGE_FAILED", "Failed to bind agy loopback proxy.");
  return {
    ok: true,
    value: {
      port: address.port,
      url: `http://127.0.0.1:${address.port}`,
      requestsHandled: () => handled,
      close: () =>
        new Promise<void>((resolve, reject) => {
          sockets.forEach((socket) => socket.destroy());
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    },
  };
}

async function handleAgyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: AgyStreamingProxyOptions,
): Promise<void> {
  if (req.method !== "POST") return respondAgyError(res, 405);
  const route = parseAgyRoute(req.url ?? "");
  if (!route.ok) return respondAgyError(res, 404);
  if (route.value === "/v1internal:loadCodeAssist") {
    respondAgyJson(res, agyHandshake(options.model));
    return;
  }
  if (route.value === "/v1internal:fetchAvailableModels") {
    respondAgyJson(res, agyAvailableModels(options.model));
    return;
  }
  await handleGenerateContent({ req, res, options, route: route.value });
}

async function handleGenerateContent(params: {
  req: IncomingMessage;
  res: ServerResponse;
  options: AgyStreamingProxyOptions;
  route: string;
}): Promise<void> {
  const { req, res, options, route } = params;
  const capability = await verifyGatewayCapability(options.gateway);
  if (!capability.ok) return respondAgyError(res, 503);
  const body = await readAgyRequestBody(
    req,
    options.maxRequestBodyBytes ?? 1_048_576,
  );
  if (!body.ok) return respondAgyError(res, 400, body.error);
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.once("aborted", abort);
  res.once("close", abort);
  const dispatched = await options.gateway.ledger.exclusive((transaction) =>
    dispatchReserved({
      options,
      payload: body.value,
      route,
      requestId: `req_agy_${randomUUID().replaceAll("-", "")}`,
      transaction,
      signal: controller.signal,
      capability: capability.value,
    }),
  );
  req.off("aborted", abort);
  res.off("close", abort);
  if (!dispatched.ok) {
    const status = dispatched.error.code === "BUDGET_EXHAUSTED" ? 429 : 502;
    return respondAgyError(res, status, dispatched.error);
  }
  res.writeHead(200, { "Content-Type": dispatched.value.contentType });
  res.end(dispatched.value.body);
}

async function dispatchReserved(params: {
  options: AgyStreamingProxyOptions;
  payload: Readonly<Record<string, unknown>>;
  route: string;
  requestId: string;
  transaction: ModelLedgerTransaction;
  signal: AbortSignal;
  capability: Readonly<ModelCapability>;
}): Promise<Outcome<AgyUpstreamResponse>> {
  const { options, transaction, signal } = params;
  const inputTokens = await reserveRequest(params);
  if (!inputTokens.ok) return inputTokens;
  const reauthorized = await options.gateway.authorize();
  if (!reauthorized.ok) return reauthorized;
  if (signal.aborted)
    return failure(
      "CANCELLED",
      "Request cancelled after reservation; ceiling remains charged.",
    );
  const response = await generateResponse(params);
  if (!response.ok) return response;
  if (response.value.usage.input_tokens !== inputTokens.value)
    return failure(
      "EVIDENCE_INVALID",
      "Upstream usage does not match counted input.",
    );
  const settled = await appendAgySettlement(
    transaction,
    params.requestId,
    response.value.usage,
  );
  return settled.ok ? response : settled;
}

async function reserveRequest(
  params: Parameters<typeof dispatchReserved>[0],
): Promise<Outcome<number>> {
  const { options, payload, transaction, signal } = params;
  const authorized = await options.gateway.authorize();
  if (!authorized.ok) return authorized;
  if (signal.aborted)
    return failure("CANCELLED", "Request cancelled before counting.");
  const counted = await options.gateway.provider.countInput(payload, signal);
  if (!counted.ok) return counted;
  const parsed = modelCountSchema.safeParse(counted.value);
  const payloadDigest = options.gateway.hash(payload);
  const capabilityDigest = options.gateway.hash(params.capability);
  if (
    !parsed.success ||
    !payloadDigest.ok ||
    !capabilityDigest.ok ||
    parsed.data.payload_digest !== payloadDigest.value
  )
    return failure("EVIDENCE_INVALID", "Cannot bind input count to payload.");
  const inputTokens = parsed.data.input_tokens;
  const reserved = await transaction.append({
    schema_version: "1.0.0",
    kind: "reserved",
    sequence: transaction.sequence + 1,
    previous_digest: transaction.previousDigest,
    reservation: {
      request_id: params.requestId,
      payload_digest: payloadDigest.value,
      capability_digest: capabilityDigest.value,
      input_tokens_bound: inputTokens,
      output_tokens_limit: options.outputTokensLimit,
      tokens_reserved: inputTokens + options.outputTokensLimit,
    },
  });
  return reserved.ok ? { ok: true, value: inputTokens } : reserved;
}

async function generateResponse(
  params: Parameters<typeof dispatchReserved>[0],
): Promise<Outcome<AgyUpstreamResponse>> {
  const { options, payload, route, signal } = params;
  if (options.kind === "upstream")
    return fetchAgyUpstream({ transport: options, route, payload, signal });
  const body = Buffer.from(JSON.stringify(options.fixtureResponse(payload)));
  const usage = parseAgyUsage(body, "application/json");
  return usage.ok
    ? {
        ok: true,
        value: { body, contentType: "application/json", usage: usage.value },
      }
    : usage;
}

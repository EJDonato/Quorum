import {
  modelCapabilitySchema,
  modelCompletionSchema,
  modelCountSchema,
  modelInputSchema,
  modelPayloadSchema,
  modelReservationSchema,
  type ModelPayload,
} from "../contracts/model-gateway.js";
import { opaqueId, positiveCount } from "../contracts/primitives.js";
import type { ModelCapability } from "../contracts/model-gateway.js";
import { failure, type Outcome } from "../contracts/errors.js";
import type {
  ModelLedgerPort,
  ModelLedgerTransaction,
  ModelProviderPort,
} from "./model-gateway-ports.js";

export interface ModelGatewayOptions {
  provider: ModelProviderPort;
  ledger: ModelLedgerPort;
  mode: "fixture" | "enforced";
  instructions: string;
  outputTokensLimit: number;
  hash(value: unknown): Outcome<string>;
  authorize(): Promise<Outcome<void>>;
  verifyCapability(
    capability: Readonly<ModelCapability>,
  ): Promise<Outcome<void>>;
}

export async function dispatchModelRequest(options: {
  gateway: ModelGatewayOptions;
  requestId: string;
  input: unknown;
  signal: AbortSignal;
}): Promise<
  Outcome<{ output: string; verified: false; tokensCharged: number }>
> {
  const { gateway, signal } = options;
  if (signal.aborted)
    return failure("CANCELLED", "Model request cancelled before dispatch.");
  const capability = await verifyModelCapability(gateway);
  if (!capability.ok) return capability;
  const input = modelInputSchema.safeParse(options.input);
  const outputLimit = positiveCount.safeParse(gateway.outputTokensLimit);
  if (
    !input.success ||
    !opaqueId.safeParse(options.requestId).success ||
    !outputLimit.success
  )
    return failure(
      "INVALID_INPUT",
      "Runner input, host request identity or output ceiling is invalid.",
    );
  const payload = modelPayloadSchema.safeParse({
    model: capability.value.model,
    instructions: gateway.instructions,
    input: input.data.input,
    tools: [],
    max_output_tokens: outputLimit.data,
    stream: false,
    store: false,
    truncation: "disabled",
    tool_choice: "none",
    parallel_tool_calls: false,
  });
  if (!payload.success)
    return failure("INVALID_INPUT", "Invalid host model payload.");
  const payloadDigest = gateway.hash(payload.data);
  const capabilityDigest = gateway.hash(capability.value);
  if (!payloadDigest.ok) return payloadDigest;
  if (!capabilityDigest.ok) return capabilityDigest;
  Object.freeze(payload.data.tools);
  const frozen = Object.freeze(payload.data);
  return gateway.ledger.exclusive(async (transaction) =>
    executeReservedRequest({
      ...options,
      payload: frozen,
      payloadDigest: payloadDigest.value,
      capabilityDigest: capabilityDigest.value,
      transaction,
      outputLimit: payload.data.max_output_tokens,
    }),
  );
}

async function verifyModelCapability(
  gateway: ModelGatewayOptions,
): Promise<Outcome<ModelCapability>> {
  const capability = modelCapabilitySchema.safeParse(
    gateway.provider.capability,
  );
  if (
    !capability.success ||
    capability.data.input_bound !== "exact_payload" ||
    capability.data.output_bound !== "includes_reasoning" ||
    capability.data.status === "unverified" ||
    (gateway.mode === "enforced" && capability.data.status !== "verified")
  )
    return failure(
      "CAPABILITY_MISSING",
      "Provider input/output ceilings are not established for this gateway mode.",
    );
  if (gateway.mode === "enforced") {
    if (!capability.data.evidence_digest)
      return failure(
        "CAPABILITY_MISSING",
        "Provider capability evidence is missing.",
      );
    const verified = await gateway.verifyCapability(capability.data);
    if (!verified.ok) return verified;
  }
  return { ok: true, value: capability.data };
}

interface PreparedRequest {
  gateway: ModelGatewayOptions;
  requestId: string;
  signal: AbortSignal;
  payload: Readonly<ModelPayload>;
  payloadDigest: string;
  capabilityDigest: string;
  transaction: ModelLedgerTransaction;
  outputLimit: number;
}

async function executeReservedRequest(request: PreparedRequest) {
  const { gateway, transaction, signal } = request;
  if (transaction.state.requests.has(request.requestId))
    return failure(
      "STALE_INPUT",
      "Model request was already attempted; no automatic replay.",
    );
  const permitted = await gateway.authorize();
  if (!permitted.ok) return permitted;
  if (signal.aborted)
    return failure("CANCELLED", "Model request cancelled before counting.");
  const counted = await gateway.provider.countInput(request.payload, signal);
  if (!counted.ok) return counted;
  const parsed = modelCountSchema.safeParse(counted.value);
  if (!parsed.success || parsed.data.payload_digest !== request.payloadDigest)
    return failure(
      "EVIDENCE_INVALID",
      "Input token count does not bind the frozen provider payload.",
    );
  const reservation = modelReservationSchema.safeParse({
    request_id: request.requestId,
    payload_digest: request.payloadDigest,
    capability_digest: request.capabilityDigest,
    input_tokens_bound: parsed.data.input_tokens,
    output_tokens_limit: request.outputLimit,
    tokens_reserved: parsed.data.input_tokens + request.outputLimit,
  });
  if (!reservation.success)
    return failure(
      "INVALID_INPUT",
      "Invalid model ceiling or request identity.",
    );
  const persisted = await transaction.append({
    schema_version: "1.0.0",
    kind: "reserved",
    sequence: transaction.sequence + 1,
    previous_digest: transaction.previousDigest,
    reservation: reservation.data,
  });
  if (!persisted.ok) return persisted;
  const authorized = await gateway.authorize();
  if (!authorized.ok) return authorized;
  if (signal.aborted)
    return failure(
      "CANCELLED",
      "Model request cancelled after reservation; ceiling remains charged.",
    );
  const generated = await gateway.provider.generate({
    payload: request.payload,
    signal,
  });
  if (!generated.ok) return generated;
  return settleModelRequest(request, generated.value);
}

async function settleModelRequest(
  request: PreparedRequest,
  completion: unknown,
) {
  const parsed = modelCompletionSchema.safeParse(completion);
  if (!parsed.success || parsed.data.payload_digest !== request.payloadDigest)
    return failure(
      "EVIDENCE_INVALID",
      "Provider completion is incomplete or belongs to another payload.",
    );
  const saved = await request.transaction.append({
    schema_version: "1.0.0",
    kind: "settled",
    sequence: request.transaction.sequence + 1,
    previous_digest: request.transaction.previousDigest,
    request_id: request.requestId,
    usage: parsed.data.usage,
  });
  if (!saved.ok) return saved;
  if (request.signal.aborted)
    return failure(
      "CANCELLED",
      "Cancelled completion cannot publish model output.",
    );
  if (parsed.data.status !== "completed")
    return failure(
      "BUDGET_EXHAUSTED",
      "Provider output ceiling ended an incomplete response.",
    );
  return {
    ok: true as const,
    value: {
      output: parsed.data.output,
      verified: false as const,
      tokensCharged: request.transaction.state.tokensCharged,
    },
  };
}

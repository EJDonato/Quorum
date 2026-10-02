import { invocationRequestSchema } from "../../contracts/invocation.js";
import {
  modelCapabilitySchema,
  type ModelCapability,
} from "../../contracts/model-gateway.js";
import { positiveCount } from "../../contracts/primitives.js";
import { failure, type Outcome } from "../../contracts/errors.js";
import {
  dispatchModelRequest,
  type ModelGatewayOptions,
} from "../../application/model-gateway.js";
import type { ModelProviderPort } from "../../application/model-gateway-ports.js";
import { canonicalDigest } from "../artifacts/digests.js";
import { createModelLedger } from "./ledger.js";

interface GatewayCompositionOptions {
  root: string;
  invocation: unknown;
  provider: ModelProviderPort;
  mode: "fixture" | "enforced";
  instructions: string;
  outputTokensLimit: number;
  authorize(): Promise<Outcome<void>>;
  verifyCapability(
    capability: Readonly<ModelCapability>,
  ): Promise<Outcome<void>>;
}

function prepareGateway(options: GatewayCompositionOptions) {
  const invocation = invocationRequestSchema.safeParse(options.invocation);
  const capability = modelCapabilitySchema.safeParse(
    options.provider.capability,
  );
  if (
    !invocation.success ||
    !capability.success ||
    !positiveCount.safeParse(options.outputTokensLimit).success
  )
    return failure(
      "INVALID_INPUT",
      "Gateway requires a valid host invocation, provider contract and output ceiling.",
    );
  const contextDigest = canonicalDigest({
    invocation: invocation.data,
    capability: capability.data,
    mode: options.mode,
    instructions: options.instructions,
    output_tokens_limit: options.outputTokensLimit,
  });
  if (!contextDigest.ok) return contextDigest;
  return {
    ok: true as const,
    value: {
      invocation: invocation.data,
      capability: capability.data,
      contextDigest: contextDigest.value,
    },
  };
}

export async function createModelGateway(options: GatewayCompositionOptions) {
  const prepared = prepareGateway(options);
  if (!prepared.ok) return prepared;
  const { invocation, capability, contextDigest } = prepared.value;
  const ledger = await createModelLedger({
    root: options.root,
    allocation: {
      schema_version: "1.0.0",
      session_id: invocation.session_id,
      invocation_id: invocation.invocation_id,
      tokens_limit: invocation.limits.tokens_reserved,
      context_digest: contextDigest,
    },
  });
  if (!ledger.ok) return ledger;
  const gateway: ModelGatewayOptions = {
    ...options,
    ledger: ledger.value,
    hash: canonicalDigest,
    provider: {
      capability: Object.freeze(capability),
      countInput: options.provider.countInput.bind(options.provider),
      generate: options.provider.generate.bind(options.provider),
    },
  };
  const deadline = AbortSignal.timeout(
    Math.min(invocation.limits.timeout_ms, 2147483647),
  );
  return {
    ok: true as const,
    value: {
      dispatch: (request: {
        requestId: string;
        input: unknown;
        signal: AbortSignal;
      }) =>
        dispatchModelRequest({
          gateway,
          ...request,
          signal: AbortSignal.any([request.signal, deadline]),
        }),
      readBudget: () =>
        ledger.value.exclusive((transaction) =>
          Promise.resolve({
            ok: true as const,
            value: {
              tokensCharged: transaction.state.tokensCharged,
              tokensLimit: invocation.limits.tokens_reserved,
              unreconciledRequests: [...transaction.state.requests]
                .filter(([, request]) => request.usage === null)
                .map(([id]) => id),
            },
          }),
        ),
    },
  };
}

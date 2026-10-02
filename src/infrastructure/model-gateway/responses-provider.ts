import { z } from "zod";
import { decodeResponsesCompletion } from "./responses-protocol.js";
import { count, versionLabel } from "../../contracts/primitives.js";
import { failure, type Outcome } from "../../contracts/errors.js";
import {
  modelPayloadSchema,
  type ModelPayload,
} from "../../contracts/model-gateway.js";
import type { ModelProviderPort } from "../../application/model-gateway-ports.js";
import { canonicalSerialize } from "../../domain/canonical.js";
import { canonicalDigest } from "../artifacts/digests.js";
import { postProviderJson, type ProviderHttpOptions } from "./http.js";

export function createResponsesProvider(options: {
  kind: "fixture" | "unverified";
  model: string;
  baseUrl: string;
  http: ProviderHttpOptions;
}): Outcome<ModelProviderPort> {
  const valid = validateProvider(options);
  if (!valid.ok) return valid;
  const base = valid.value;
  const fixture = options.kind === "fixture";
  const credential = options.http.credential.bind(options.http);
  const http = {
    ...options.http,
    credential: async () => {
      const resolved = await credential();
      if (
        resolved.ok &&
        fixture &&
        !resolved.value.startsWith("QUORUM_FIXTURE_")
      )
        return failure(
          "CAPABILITY_MISSING",
          "Local fixtures require a fixture-only credential canary.",
        );
      return resolved;
    },
  };
  return {
    ok: true,
    value: {
      capability: Object.freeze({
        schema_version: "1.0.0",
        provider: "responses-http-v1",
        model: options.model,
        status: options.kind,
        input_bound: "exact_payload",
        output_bound: "includes_reasoning",
        hidden_retries: false,
        evidence_digest: null,
      }),
      countInput: async (payload, signal) =>
        countInput({ payload, signal, base, http }),
      generate: async (request) => generate({ ...request, base, http }),
    },
  };
}

function validateProvider(options: {
  kind: string;
  model: string;
  baseUrl: string;
  http: ProviderHttpOptions;
}): Outcome<string> {
  let url: URL;
  try {
    url = new URL(options.baseUrl);
  } catch {
    return failure("INVALID_INPUT", "Invalid host provider endpoint.");
  }
  const fixture =
    options.kind === "fixture" &&
    url.protocol === "http:" &&
    url.hostname === "127.0.0.1" &&
    !!url.port;
  const official =
    options.kind === "unverified" && url.origin === "https://api.openai.com";
  if (
    (!fixture && !official) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/v1" ||
    !versionLabel.safeParse(options.model).success ||
    !Number.isSafeInteger(options.http.timeoutMs) ||
    options.http.timeoutMs < 1 ||
    options.http.timeoutMs > 60000 ||
    !Number.isSafeInteger(options.http.maxResponseBytes) ||
    options.http.maxResponseBytes < 1 ||
    options.http.maxResponseBytes > 1048576
  )
    return failure(
      "INVALID_INPUT",
      "Provider endpoint or host transport bounds are unsupported.",
    );
  return { ok: true, value: url.href };
}

async function countInput(options: {
  payload: Readonly<ModelPayload>;
  signal: AbortSignal;
  base: string;
  http: ProviderHttpOptions;
}) {
  const encoded = encodePayload(options.payload);
  if (!encoded.ok) return encoded;
  const result = await postProviderJson({
    http: options.http,
    url: `${options.base}/responses/input_tokens`,
    body: encoded.value.body,
    signal: options.signal,
  });
  if (!result.ok) return result;
  const parsed = z.object({ input_tokens: count }).safeParse(result.value);
  return parsed.success
    ? {
        ok: true as const,
        value: {
          payload_digest: encoded.value.digest,
          input_tokens: parsed.data.input_tokens,
        },
      }
    : failure(
        "EVIDENCE_INVALID",
        "Provider returned an invalid input token count.",
      );
}

function encodePayload(payload: Readonly<ModelPayload>) {
  const parsed = modelPayloadSchema.safeParse(payload);
  if (!parsed.success)
    return failure("INVALID_INPUT", "Unsupported model payload.");
  const serialized = canonicalSerialize(parsed.data);
  const digest = canonicalDigest(parsed.data);
  if (!serialized.ok) return serialized;
  if (!digest.ok) return digest;
  return {
    ok: true as const,
    value: {
      body: serialized.value,
      digest: digest.value,
      payload: parsed.data,
    },
  };
}

async function generate(options: {
  payload: Readonly<ModelPayload>;
  signal: AbortSignal;
  base: string;
  http: ProviderHttpOptions;
}) {
  const encoded = encodePayload(options.payload);
  if (!encoded.ok) return encoded;
  const result = await postProviderJson({
    http: options.http,
    url: `${options.base}/responses`,
    body: encoded.value.body,
    signal: options.signal,
  });
  if (!result.ok) return result;
  return decodeResponsesCompletion({
    value: result.value,
    model: options.payload.model,
    digest: encoded.value.digest,
  });
}

import { z } from "zod";
import { failure, type Outcome } from "../../contracts/errors.js";
import { positiveCount, versionLabel } from "../../contracts/primitives.js";
import { canonicalSerialize } from "../../domain/canonical.js";
import {
  dispatchPreparedModelRequest,
  type ModelGatewayOptions,
} from "../../application/model-gateway.js";

type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const jsonObject = z.custom<Record<string, JsonValue>>((value) =>
  isBoundedJson(value, true),
);
const jsonValue = z.custom<JsonValue>((value) => isBoundedJson(value, false));
const incomingRequestSchema = z.strictObject({
  client_metadata: jsonObject,
  include: z.array(z.string().max(128)).max(32),
  input: z.array(jsonValue).min(1).max(1024),
  instructions: z.string().max(65536),
  model: versionLabel,
  parallel_tool_calls: z.boolean(),
  prompt_cache_key: z.string().min(1).max(256),
  reasoning: jsonObject,
  store: z.literal(false),
  stream: z.literal(true),
  tool_choice: jsonValue,
  tools: z.array(jsonObject).max(64),
});
const brokerToolNames = new Set([
  "repo.read",
  "repo.search",
  "artifact.read",
  "draft.apply_patch",
  "checks.run",
  "role.submit",
  "scope.request",
]);

export type CodexResponsesPayload = z.infer<typeof incomingRequestSchema> & {
  max_output_tokens: number;
};

export function admitCodexResponsesRequest(options: {
  request: unknown;
  model: string;
  outputTokensLimit: number;
  authorizedTools: readonly unknown[];
}): Outcome<Readonly<CodexResponsesPayload>> {
  const request = incomingRequestSchema.safeParse(options.request);
  const model = versionLabel.safeParse(options.model);
  const limit = positiveCount.safeParse(options.outputTokensLimit);
  if (!request.success || !model.success || !limit.success)
    return failure(
      "INVALID_INPUT",
      "Codex request does not match the pinned Responses request contract.",
    );
  if (request.data.model !== model.data)
    return failure("SCOPE_DENIED", "Codex cannot override the host model.");
  const tools = compareTools(request.data.tools, options.authorizedTools);
  if (!tools.ok) return tools;
  const cloned = cloneJson({
    ...request.data,
    max_output_tokens: limit.data,
  });
  if (!cloned.ok) return cloned;
  return { ok: true, value: deepFreeze(cloned.value) };
}

export async function dispatchCodexResponsesRequest(options: {
  gateway: ModelGatewayOptions<CodexResponsesPayload>;
  requestId: string;
  request: unknown;
  model: string;
  outputTokensLimit: number;
  authorizedTools: readonly unknown[];
  signal: AbortSignal;
}) {
  const admitted = admitCodexResponsesRequest(options);
  if (!admitted.ok) return admitted;
  return dispatchPreparedModelRequest({
    gateway: options.gateway,
    requestId: options.requestId,
    payload: admitted.value,
    outputTokensLimit: options.outputTokensLimit,
    signal: options.signal,
  });
}

function compareTools(
  actual: readonly Record<string, JsonValue>[],
  expected: readonly unknown[],
): Outcome<void> {
  const actualTools = describeTools(actual);
  const expectedTools: Record<string, JsonValue>[] = [];
  for (const tool of expected) {
    const parsed = jsonObject.safeParse(tool);
    if (!parsed.success)
      return failure(
        "CAPABILITY_MISSING",
        "Broker authorized an unsupported tool definition.",
      );
    expectedTools.push(parsed.data);
  }
  const expectedNames = describeTools(expectedTools);
  if (
    !actualTools.ok ||
    !expectedNames.ok ||
    actualTools.value.some((name) => !brokerToolNames.has(name)) ||
    expectedNames.value.some((name) => !brokerToolNames.has(name))
  )
    return failure(
      "CAPABILITY_MISSING",
      "Codex emitted an unsupported tool definition.",
    );
  const left = canonicalToolSet(actual);
  const right = canonicalToolSet(expectedTools);
  if (!left.ok || !right.ok || left.value !== right.value)
    return failure(
      "CAPABILITY_MISSING",
      "Codex effective tools differ from the broker-authorized manifest.",
    );
  return { ok: true, value: undefined };
}

function describeTools(tools: readonly Record<string, JsonValue>[]) {
  const names = new Set<string>();
  for (const tool of tools) {
    if (tool.type === "function" && typeof tool.name === "string") {
      if (names.has(tool.name)) return { ok: false as const };
      names.add(tool.name);
      continue;
    }
    if (tool.type !== "namespace" || typeof tool.name !== "string")
      return { ok: false as const };
    if (!Array.isArray(tool.tools)) return { ok: false as const };
    for (const child of tool.tools) {
      if (
        !child ||
        Array.isArray(child) ||
        typeof child !== "object" ||
        child.type !== "function" ||
        typeof child.name !== "string"
      )
        return { ok: false as const };
      const name = `${tool.name}.${child.name}`;
      if (names.has(name)) return { ok: false as const };
      names.add(name);
    }
  }
  return { ok: true as const, value: [...names].sort() };
}

function canonicalToolSet(tools: readonly Record<string, JsonValue>[]) {
  const entries: string[] = [];
  for (const tool of tools) {
    const encoded = canonicalSerialize(tool);
    if (!encoded.ok) return encoded;
    entries.push(encoded.value);
  }
  return canonicalSerialize(entries.sort());
}

function isBoundedJson(value: unknown, requireObject: boolean): boolean {
  if (
    requireObject &&
    (!value || typeof value !== "object" || Array.isArray(value))
  )
    return false;
  const pending: Array<{ value: unknown; depth: number }> = [
    { value, depth: 0 },
  ];
  let nodes = 0;
  while (pending.length) {
    const current = pending.pop();
    if (!current || ++nodes > 10000 || current.depth > 32) return false;
    const item = current.value;
    if (item === null || typeof item === "boolean") continue;
    if (typeof item === "string") {
      if (item.length > 65536) return false;
      continue;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) return false;
      continue;
    }
    if (typeof item !== "object") return false;
    const entries = Array.isArray(item) ? item.entries() : Object.entries(item);
    for (const [key, child] of entries) {
      if (typeof key === "string" && key.length > 128) return false;
      pending.push({ value: child, depth: current.depth + 1 });
    }
  }
  return true;
}

function cloneJson<T extends JsonValue>(value: T): Outcome<T> {
  const serialized = canonicalSerialize(value);
  if (!serialized.ok) return serialized;
  if (Buffer.byteLength(serialized.value) > 1_048_576)
    return failure(
      "INVALID_INPUT",
      "Codex request exceeds the host byte limit.",
    );
  return { ok: true, value: JSON.parse(serialized.value) as T };
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

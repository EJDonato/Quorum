import { z } from "zod";
import { failure, type Outcome } from "../../../contracts/errors.js";
import type { ModelUsage } from "../../../contracts/model-gateway.js";
import { canonicalSerialize } from "../../../domain/canonical.js";

export interface AgyUpstreamOptions {
  kind: "upstream";
  upstreamUrl: string;
  upstreamCredential(): Promise<Outcome<string>>;
  maxResponseBytes?: number;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export interface AgyUpstreamResponse {
  body: Uint8Array;
  contentType: string;
  usage: ModelUsage;
}

const usageMetadataSchema = z.object({
  promptTokenCount: z.number().int().nonnegative(),
  candidatesTokenCount: z.number().int().nonnegative(),
  totalTokenCount: z.number().int().nonnegative(),
  cachedContentTokenCount: z.number().int().nonnegative().optional(),
  thoughtsTokenCount: z.number().int().nonnegative().optional(),
});

export function validateAgyUpstream(
  options: AgyUpstreamOptions,
): Outcome<void> {
  let url: URL;
  try {
    url = new URL(options.upstreamUrl);
  } catch {
    return failure("INVALID_INPUT", "Invalid Antigravity upstream endpoint.");
  }
  const loopback =
    url.protocol === "http:" && url.hostname === "127.0.0.1" && !!url.port;
  const official =
    url.protocol === "https:" &&
    url.origin === "https://generativelanguage.googleapis.com";
  if (
    (!loopback && !official) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname) ||
    !validBound(options.maxResponseBytes ?? 1_048_576, 1_048_576) ||
    !validBound(options.timeoutMs ?? 30_000, 60_000)
  )
    return failure(
      "INVALID_INPUT",
      "Unsupported Antigravity endpoint or transport bounds.",
    );
  return { ok: true, value: undefined };
}

export async function fetchAgyUpstream(options: {
  transport: AgyUpstreamOptions;
  route: string;
  payload: Readonly<Record<string, unknown>>;
  signal: AbortSignal;
}): Promise<Outcome<AgyUpstreamResponse>> {
  const credential = await options.transport.upstreamCredential();
  if (!credential.ok) return credential;
  if (!validCredential(credential.value))
    return failure("CAPABILITY_MISSING", "Invalid upstream credential.");
  const serialized = canonicalSerialize(options.payload);
  if (!serialized.ok) return serialized;
  let response: Response;
  try {
    response = await (options.transport.fetch ?? globalThis.fetch)(
      options.transport.upstreamUrl.replace(/\/$/u, "") + options.route,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": credential.value,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: serialized.value,
        redirect: "error",
        signal: AbortSignal.any([
          options.signal,
          AbortSignal.timeout(options.transport.timeoutMs ?? 30_000),
        ]),
      },
    );
  } catch {
    return failure(
      "CAPABILITY_MISSING",
      "Antigravity upstream transport failed.",
    );
  }
  if (!response.ok || !response.body)
    return failure(
      "CAPABILITY_MISSING",
      "Antigravity upstream rejected request.",
    );
  const body = await readBoundedBody(
    response.body,
    options.transport.maxResponseBytes ?? 1_048_576,
  );
  if (!body.ok) return body;
  const contentType = response.headers.get("content-type")?.split(";", 1)[0];
  if (contentType !== "application/json" && contentType !== "text/event-stream")
    return failure(
      "EVIDENCE_INVALID",
      "Upstream response type is unsupported.",
    );
  const usage = parseAgyUsage(body.value, contentType);
  if (!usage.ok) return usage;
  return {
    ok: true,
    value: { body: body.value, contentType, usage: usage.value },
  };
}

export function parseAgyUsage(
  body: Uint8Array,
  contentType: string,
): Outcome<ModelUsage> {
  const records = extractRecords(
    Buffer.from(body).toString("utf8"),
    contentType,
  );
  if (!records.ok) return records;
  const usages = records.value.flatMap((record) => {
    if (typeof record !== "object" || record === null) return [];
    const parsed = usageMetadataSchema.safeParse(
      Reflect.get(record, "usageMetadata"),
    );
    return parsed.success ? [parsed.data] : [];
  });
  if (usages.length !== 1)
    return failure(
      "EVIDENCE_INVALID",
      "Upstream response lacks one complete usage record.",
    );
  const usage = usages[0];
  if (!usage) return failure("EVIDENCE_INVALID", "Usage record is missing.");
  const output = usage.totalTokenCount - usage.promptTokenCount;
  const cached = usage.cachedContentTokenCount ?? 0;
  const reasoning = usage.thoughtsTokenCount ?? 0;
  if (
    output < 0 ||
    cached > usage.promptTokenCount ||
    usage.candidatesTokenCount + reasoning > output
  )
    return failure(
      "EVIDENCE_INVALID",
      "Upstream usage totals are inconsistent.",
    );
  return {
    ok: true,
    value: {
      input_tokens: usage.promptTokenCount,
      output_tokens: output,
      cached_input_tokens: cached,
      reasoning_tokens: reasoning,
      charged_tokens: usage.totalTokenCount,
      accounting_complete: true,
    },
  };
}

async function readBoundedBody(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Outcome<Uint8Array>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return failure(
        "EVIDENCE_INVALID",
        "Upstream response exceeds byte ceiling.",
      );
    }
    chunks.push(next.value);
  }
  return { ok: true, value: Buffer.concat(chunks) };
}

function extractRecords(raw: string, contentType: string): Outcome<unknown[]> {
  try {
    if (contentType === "application/json")
      return { ok: true, value: [JSON.parse(raw) as unknown] };
    const records = raw
      .split(/\r?\n\r?\n/u)
      .flatMap((block) =>
        block.split(/\r?\n/u).filter((line) => line.startsWith("data:")),
      )
      .map((line) => JSON.parse(line.slice(5).trim()) as unknown);
    return { ok: true, value: records };
  } catch {
    return failure(
      "EVIDENCE_INVALID",
      "Malformed Antigravity upstream response.",
    );
  }
}

function validBound(value: number, maximum: number) {
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}

function validCredential(value: string) {
  return (
    value.length >= 1 &&
    value.length <= 4096 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

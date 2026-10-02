import type { ServerResponse } from "node:http";
import { failure, type Outcome } from "../../contracts/errors.js";
import { usageSchema } from "../../contracts/invocation.js";
import type { ModelUsage } from "../../contracts/model-gateway.js";

export async function pipeSse(
  stream: ReadableStream<Uint8Array>,
  clientRes: ServerResponse,
  options: { maxBytes: number; signal: AbortSignal },
): Promise<Outcome<ModelUsage>> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let observedUsage: unknown = null;
  let completedEvents = 0;
  let bytes = 0;
  for (;;) {
    if (options.signal.aborted) {
      await reader.cancel();
      return failure("CANCELLED", "Codex stream was cancelled.");
    }
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > options.maxBytes) {
      await reader.cancel();
      return failure(
        "EVIDENCE_INVALID",
        "Codex SSE response exceeded its byte limit.",
      );
    }
    clientRes.write(value);
    const parsed = processSseBuffer(
      buffer + decoder.decode(value, { stream: true }),
    );
    buffer = parsed.remaining;
    if (parsed.usage) observedUsage = parsed.usage;
    completedEvents += parsed.completedEvents;
  }
  const finalParsed = processSseBuffer(buffer + decoder.decode());
  if (finalParsed.usage) observedUsage = finalParsed.usage;
  completedEvents += finalParsed.completedEvents;
  if (completedEvents !== 1)
    return failure(
      "EVIDENCE_INVALID",
      "Codex SSE stream requires exactly one completed response.",
    );
  return normalizeUsage(observedUsage);
}

function processSseBuffer(buffer: string): {
  remaining: string;
  usage: unknown;
  completedEvents: number;
} {
  const parts = buffer.split("\n\n");
  const remaining = parts.pop() ?? "";
  let usage: unknown = null;
  let completedEvents = 0;
  for (const block of parts) {
    const found = extractUsageFromBlock(block);
    if (found.completed) completedEvents++;
    if (found.usage) usage = found.usage;
  }
  return { remaining, usage, completedEvents };
}

function extractUsageFromBlock(block: string): {
  completed: boolean;
  usage: unknown;
} {
  for (const line of block.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const text = line.slice(5).trim();
    if (!text || text === "[DONE]") continue;
    try {
      const data: unknown = JSON.parse(text);
      if (typeof data !== "object" || data === null) continue;
      const rec = data as Record<string, unknown>;
      const isObj = typeof rec.response === "object" && rec.response !== null;
      const r = (isObj ? rec.response : rec) as Record<string, unknown>;
      if (r.status === "completed")
        return { completed: true, usage: r.usage ?? null };
    } catch {
      // ignore partial chunk
    }
  }
  return { completed: false, usage: null };
}

function normalizeUsage(raw: unknown): Outcome<ModelUsage> {
  if (typeof raw !== "object" || raw === null)
    return failure(
      "EVIDENCE_INVALID",
      "Missing completed usage in SSE stream.",
    );
  const rec = raw as Record<string, unknown>;
  const inp = Number(rec.input_tokens);
  const out = Number(rec.output_tokens);
  if (!Number.isSafeInteger(inp) || !Number.isSafeInteger(out))
    return failure("EVIDENCE_INVALID", "Invalid usage counts in SSE stream.");
  const inDet = rec.input_tokens_details as Record<string, unknown> | undefined;
  const outDet = rec.output_tokens_details as
    Record<string, unknown> | undefined;
  const cached = Number(inDet?.cached_tokens);
  const reasoning = Number(outDet?.reasoning_tokens);
  if (!Number.isSafeInteger(cached) || !Number.isSafeInteger(reasoning))
    return failure(
      "EVIDENCE_INVALID",
      "Codex SSE usage details are incomplete.",
    );
  const parsed = usageSchema.safeParse({
    input_tokens: inp,
    output_tokens: out,
    cached_input_tokens: cached,
    reasoning_tokens: reasoning,
    charged_tokens: Number(rec.total_tokens ?? inp + out),
    accounting_complete: true,
  });
  if (!parsed.success)
    return failure(
      "EVIDENCE_INVALID",
      "Usage violated accounting constraints.",
    );
  return { ok: true, value: parsed.data };
}

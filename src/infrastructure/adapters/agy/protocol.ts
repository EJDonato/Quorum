import type { IncomingMessage, ServerResponse } from "node:http";
import { failure, type Outcome } from "../../../contracts/errors.js";
import { z } from "zod";

const agyPayloadSchema = z.strictObject({
  contents: z.array(z.unknown()).min(1).max(512),
  generationConfig: z.record(z.string(), z.unknown()),
  systemInstruction: z.unknown(),
  tools: z.array(z.unknown()).max(64).optional(),
});

export async function readAgyRequestBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<Outcome<Readonly<Record<string, unknown>>>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += buffer.length;
    if (bytes > maxBytes)
      return failure("INVALID_INPUT", "Request body exceeds byte ceiling.");
    chunks.push(buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!isRecord(value))
      return failure(
        "INVALID_INPUT",
        "Antigravity request must be a JSON object.",
      );
    return { ok: true, value };
  } catch {
    return failure("INVALID_INPUT", "Malformed JSON body in proxy request.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAgyRoute(
  raw: string,
  allowedModels: readonly string[],
): Outcome<string> {
  const url = new URL(raw, "http://127.0.0.1");
  const matched =
    /^\/v1beta\/models\/([a-zA-Z0-9._-]+):streamGenerateContent$/u.exec(
      url.pathname,
    );
  if (
    !matched?.[1] ||
    !allowedModels.includes(matched[1]) ||
    url.search !== "?alt=sse"
  )
    return failure("INVALID_INPUT", "Unsupported Antigravity proxy route.");
  return { ok: true, value: url.pathname + url.search };
}

export function admitAgyPayload(
  raw: unknown,
  outputTokensLimit: number,
): Outcome<Readonly<Record<string, unknown>>> {
  const parsed = agyPayloadSchema.safeParse(raw);
  if (!parsed.success)
    return failure("INVALID_INPUT", "Unsupported Antigravity request payload.");
  const generationConfig = Object.freeze({
    ...parsed.data.generationConfig,
    maxOutputTokens: outputTokensLimit,
  });
  return {
    ok: true,
    value: Object.freeze({ ...parsed.data, generationConfig }),
  };
}

export function respondAgyError(
  res: ServerResponse,
  status: number,
  error?: unknown,
): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(error ? { error } : {}));
}

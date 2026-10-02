import type { IncomingMessage, ServerResponse } from "node:http";
import { failure, type Outcome } from "../../../contracts/errors.js";

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

export function parseAgyRoute(raw: string): Outcome<string> {
  const url = new URL(raw, "http://127.0.0.1");
  const routes = [
    "/v1internal:loadCodeAssist",
    "/v1internal:fetchAvailableModels",
    "/v1internal:generateContent",
    "/v1internal:streamGenerateContent",
  ];
  const streamQuery = url.pathname === routes[3] && url.search === "?alt=sse";
  if (!routes.includes(url.pathname) || (url.search && !streamQuery))
    return failure("INVALID_INPUT", "Unsupported Antigravity proxy route.");
  return { ok: true, value: url.pathname + (streamQuery ? url.search : "") };
}

export function agyHandshake(model: string) {
  return { userTier: { userTier: "PAID" }, allowedModels: [model, "auto"] };
}

export function agyAvailableModels(model: string) {
  return { models: [{ modelName: model, displayName: model }] };
}

export function respondAgyJson(res: ServerResponse, value: unknown): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
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

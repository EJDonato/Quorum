import { failure, type Outcome } from "../../contracts/errors.js";
import { canonicalSerialize } from "../../domain/canonical.js";
import type { CodexResponsesPayload } from "./codex-request-firewall.js";
import type { IncomingMessage } from "node:http";

export interface CodexTransportOptions {
  upstreamUrl: string;
  upstreamCredential?(): Promise<Outcome<string>>;
  maxRequestBodyBytes?: number;
  maxResponseBytes?: number;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export function validateCodexTransport(
  options: CodexTransportOptions,
): Outcome<void> {
  let url: URL;
  try {
    url = new URL(options.upstreamUrl);
  } catch {
    return failure("INVALID_INPUT", "Invalid Codex upstream endpoint.");
  }
  const loopback =
    url.protocol === "http:" && url.hostname === "127.0.0.1" && !!url.port;
  const official =
    url.protocol === "https:" && url.origin === "https://api.openai.com";
  const requestBytes = options.maxRequestBodyBytes ?? 1_048_576;
  const responseBytes = options.maxResponseBytes ?? 1_048_576;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (
    (!loopback && !official) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["/v1", "/v1/", "/v1/responses"].includes(url.pathname) ||
    !validBound(requestBytes, 1_048_576) ||
    !validBound(responseBytes, 1_048_576) ||
    !validBound(timeoutMs, 60_000)
  )
    return failure(
      "INVALID_INPUT",
      "Unsupported Codex proxy endpoint or transport bounds.",
    );
  return { ok: true, value: undefined };
}

export async function readBoundedCodexJson(
  request: IncomingMessage,
  maxBytes: number,
): Promise<Outcome<unknown>> {
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
    return { ok: true, value };
  } catch {
    return failure("INVALID_INPUT", "Malformed JSON body in proxy request.");
  }
}

export async function fetchCodexUpstream(
  options: CodexTransportOptions,
  payload: Readonly<CodexResponsesPayload>,
  signal: AbortSignal,
): Promise<Outcome<{ body: ReadableStream<Uint8Array> }>> {
  const credential = options.upstreamCredential
    ? await options.upstreamCredential()
    : null;
  if (credential && !credential.ok) return credential;
  if (credential && !validCredential(credential.value))
    return failure("CAPABILITY_MISSING", "Invalid upstream credential.");
  const serialized = canonicalSerialize(payload);
  if (!serialized.ok) return serialized;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (credential) headers.Authorization = `Bearer ${credential.value}`;
  const base = options.upstreamUrl.replace(/\/+$/, "");
  const target = base.endsWith("/responses") ? base : `${base}/responses`;
  let response: Response;
  try {
    response = await (options.fetch ?? globalThis.fetch)(target, {
      method: "POST",
      headers,
      body: serialized.value,
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(options.timeoutMs ?? 30_000),
      ]),
      redirect: "error",
    });
  } catch {
    return failure("CAPABILITY_MISSING", "Upstream transport failed.");
  }
  if (!response.ok || !response.body)
    return failure("CAPABILITY_MISSING", "Upstream rejected request.");
  if (!response.headers.get("content-type")?.startsWith("text/event-stream"))
    return failure("EVIDENCE_INVALID", "Upstream returned a non-SSE response.");
  return { ok: true, value: { body: response.body } };
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

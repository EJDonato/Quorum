import { failure, type Outcome } from "../../contracts/errors.js";

export interface ProviderHttpOptions {
  credential(): Promise<Outcome<string>>;
  fetch: typeof globalThis.fetch;
  timeoutMs: number;
  maxResponseBytes: number;
}

// Only the host provider transport handles credentials. Never include headers in records/errors.
export async function postProviderJson(options: {
  http: ProviderHttpOptions;
  url: string;
  body: string;
  signal: AbortSignal;
}): Promise<Outcome<unknown>> {
  if (options.signal.aborted)
    return failure(
      "CANCELLED",
      "Provider request cancelled before transmission.",
    );
  const credential = await resolveCredential(options.http);
  if (!credential.ok)
    return failure(
      "CAPABILITY_MISSING",
      "Broker provider credential is unavailable.",
    );
  if (!/^[\x21-\x7e]{1,8192}$/.test(credential.value))
    return failure(
      "CAPABILITY_MISSING",
      "Broker provider credential format is invalid.",
    );
  if (options.signal.aborted)
    return failure(
      "CANCELLED",
      "Provider request cancelled while resolving credentials.",
    );
  const signal = AbortSignal.any([
    options.signal,
    AbortSignal.timeout(options.http.timeoutMs),
  ]);
  try {
    const response = await options.http.fetch(options.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credential.value}`,
      },
      body: options.body,
      signal,
      redirect: "error",
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      return failure(
        "CAPABILITY_MISSING",
        "Provider rejected the bounded request; automatic retries are disabled.",
      );
    }
    return await readProviderBody(response.body, options.http.maxResponseBytes);
  } catch {
    return failure(
      options.signal.aborted ? "CANCELLED" : "CAPABILITY_MISSING",
      "Provider transport failed or exceeded its deadline; no automatic replay.",
    );
  }
}

async function resolveCredential(
  http: ProviderHttpOptions,
): Promise<Outcome<string>> {
  try {
    return await http.credential();
  } catch {
    return failure(
      "CAPABILITY_MISSING",
      "Broker provider credential resolution failed.",
    );
  }
}

async function readProviderBody(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Outcome<unknown>> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return failure(
        "EVIDENCE_INVALID",
        "Provider response exceeds the host byte limit.",
      );
    }
    chunks.push(next.value);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return { ok: true, value };
}

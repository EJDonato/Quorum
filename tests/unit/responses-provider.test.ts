import assert from "node:assert/strict";
import { test } from "node:test";
import { createResponsesProvider } from "../../src/infrastructure/model-gateway/responses-provider.js";
import { canonicalDigest } from "../../src/infrastructure/artifacts/digests.js";
import { failure } from "../../src/contracts/errors.js";

const payload = {
  model: "quorum-fixture-model",
  instructions: "Host",
  input: "text",
  tools: [],
  max_output_tokens: 8,
  stream: false as const,
  store: false as const,
  truncation: "disabled" as const,
  tool_choice: "none" as const,
  parallel_tool_calls: false as const,
};

function providerFor(fetch: typeof globalThis.fetch) {
  const provider = createResponsesProvider({
    kind: "fixture",
    model: payload.model,
    baseUrl: "http://127.0.0.1:32123/v1",
    http: {
      fetch,
      credential: () =>
        Promise.resolve({ ok: true, value: "QUORUM_FIXTURE_ONLY" }),
      timeoutMs: 1000,
      maxResponseBytes: 1024,
    },
  });
  assert.ok(provider.ok);
  return provider.value;
}

void test("provider factory rejects arbitrary endpoints, embedded credentials and unsafe host transport limits", () => {
  for (const baseUrl of [
    "http://external.invalid/v1",
    "https://attacker.invalid/v1",
    "http://user:pass@127.0.0.1:32123/v1",
    "http://127.0.0.1:32123/v1?token=secret",
    "http://127.0.0.1:32123/v1#fragment",
    "http://127.0.0.1:32123/other",
  ]) {
    const result = createResponsesProvider({
      kind: "fixture",
      model: payload.model,
      baseUrl,
      http: {
        fetch: globalThis.fetch,
        credential: () =>
          Promise.resolve(failure("CAPABILITY_MISSING", "No credential")),
        timeoutMs: 1000,
        maxResponseBytes: 1024,
      },
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "INVALID_INPUT");
  }
});

void test("HTTP errors, malformed JSON, missing counts and byte overflow fail once without leaking diagnostics", async () => {
  for (const response of [
    new Response("QUORUM_FIXTURE_ONLY", { status: 503 }),
    new Response("not-json QUORUM_FIXTURE_ONLY"),
    Response.json({ input_tokens: -1 }),
    Response.json({}),
    new Response("x".repeat(1025)),
  ]) {
    let calls = 0;
    const provider = providerFor(() => {
      calls++;
      return Promise.resolve(response);
    });
    const result = await provider.countInput(
      payload,
      new AbortController().signal,
    );
    assert.ok(!result.ok);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(result).includes("QUORUM_FIXTURE_ONLY"), false);
  }
});

void test("input count binds its exact payload digest and cached/reasoning details are required", async () => {
  const provider = providerFor(() =>
    Promise.resolve(Response.json({ input_tokens: 12 })),
  );
  const counted = await provider.countInput(
    payload,
    new AbortController().signal,
  );
  assert.ok(counted.ok);
  const expected = canonicalDigest(payload);
  assert.ok(expected.ok);
  assert.deepEqual(counted.value, {
    payload_digest: expected.value,
    input_tokens: 12,
  });
  const incomplete = providerFor(() =>
    Promise.resolve(
      Response.json({
        status: "completed",
        model: payload.model,
        output: [],
        usage: { input_tokens: 12, output_tokens: 1, total_tokens: 13 },
      }),
    ),
  );
  assert.equal(
    (
      await incomplete.generate({
        payload,
        signal: new AbortController().signal,
      })
    ).ok,
    false,
  );
});

void test("cancellation prevents transmission and redirects are explicitly denied", async () => {
  let calls = 0;
  const provider = providerFor((_input, init) => {
    calls++;
    assert.equal(init?.redirect, "error");
    return Promise.resolve(Response.json({ input_tokens: 12 }));
  });
  const cancelled = new AbortController();
  cancelled.abort();
  const result = await provider.countInput(payload, cancelled.signal);
  assert.ok(!result.ok);
  assert.equal(result.error.code, "CANCELLED");
  assert.equal(calls, 0);
  assert.ok(
    (await provider.countInput(payload, new AbortController().signal)).ok,
  );
  assert.equal(calls, 1);
});

void test("local fixtures reject non-fixture credentials and credential exceptions never reach diagnostics", async () => {
  for (const credential of [
    () =>
      Promise.resolve({
        ok: true as const,
        value: "NON_FIXTURE_SECRET_CANARY",
      }),
    () => Promise.reject(new Error("NON_FIXTURE_SECRET_CANARY")),
  ]) {
    let calls = 0;
    const provider = createResponsesProvider({
      kind: "fixture",
      model: payload.model,
      baseUrl: "http://127.0.0.1:32123/v1",
      http: {
        fetch: () => {
          calls++;
          return Promise.resolve(Response.json({ input_tokens: 12 }));
        },
        credential,
        timeoutMs: 1000,
        maxResponseBytes: 1024,
      },
    });
    assert.ok(provider.ok);
    const result = await provider.value.countInput(
      payload,
      new AbortController().signal,
    );
    assert.ok(!result.ok);
    assert.equal(
      JSON.stringify(result).includes("NON_FIXTURE_SECRET_CANARY"),
      false,
    );
    assert.equal(calls, 0);
  }
});

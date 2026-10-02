import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelGatewayOptions } from "../../src/application/model-gateway.js";
import { failure } from "../../src/contracts/errors.js";
import {
  gatewayEventSchema,
  type GatewayEvent,
} from "../../src/contracts/model-gateway.js";
import { canonicalSerialize } from "../../src/domain/canonical.js";
import { canonicalDigest } from "../../src/infrastructure/artifacts/digests.js";
import { startAgyStreamingProxy } from "../../src/infrastructure/adapters/agy/model-proxy.js";
import { createModelLedger } from "../../src/infrastructure/model-gateway/ledger.js";
import { request as makeInvocation } from "../fixtures/evidence.js";

async function setupHarness(
  t: TestContext,
  options: { omitUsage?: boolean } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "agy-upstream-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const seen: {
    authorization: string | undefined;
    route: string | undefined;
    body: string | undefined;
  } = { authorization: undefined, route: undefined, body: undefined };
  const upstream = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      seen.authorization = request.headers.authorization;
      seen.route = request.url;
      seen.body = body;
      const inputTokens = Buffer.byteLength(body);
      const result = options.omitUsage
        ? { candidates: [] }
        : {
            candidates: [{ content: { parts: [{ text: "UPSTREAM_OK" }] } }],
            usageMetadata: {
              promptTokenCount: inputTokens,
              candidatesTokenCount: 4,
              cachedContentTokenCount: 2,
              thoughtsTokenCount: 1,
              totalTokenCount: inputTokens + 5,
            },
          };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(result));
    });
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        upstream.closeAllConnections();
        upstream.close((error) => (error ? reject(error) : resolve()));
      }),
  );

  const invocation = makeInvocation("qa");
  const ledger = await createModelLedger({
    root,
    allocation: {
      schema_version: "1.0.0",
      session_id: invocation.session_id,
      invocation_id: invocation.invocation_id,
      tokens_limit: 10_000,
      context_digest:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
  });
  assert.ok(ledger.ok);
  const gateway: ModelGatewayOptions<unknown> = {
    provider: {
      capability: Object.freeze({
        schema_version: "1.0.0" as const,
        provider: "cloud-code-http-v1",
        model: "gemini-fixture",
        status: "fixture" as const,
        input_bound: "exact_payload" as const,
        output_bound: "includes_reasoning" as const,
        hidden_retries: false as const,
        evidence_digest: null,
      }),
      countInput: (payload) => {
        const serialized = canonicalSerialize(payload);
        const digest = canonicalDigest(payload);
        assert.ok(serialized.ok);
        assert.ok(digest.ok);
        return Promise.resolve({
          ok: true,
          value: {
            payload_digest: digest.value,
            input_tokens: Buffer.byteLength(serialized.value),
          },
        });
      },
      generate: () =>
        Promise.resolve(failure("CAPABILITY_MISSING", "Unused in proxy")),
    },
    ledger: ledger.value,
    mode: "fixture",
    instructions: "Host instructions",
    outputTokensLimit: 32,
    hash: canonicalDigest,
    authorize: () => Promise.resolve({ ok: true, value: undefined }),
    verifyCapability: () => Promise.resolve({ ok: true, value: undefined }),
  };
  const proxy = await startAgyStreamingProxy({
    kind: "upstream",
    gateway,
    model: "gemini-fixture",
    outputTokensLimit: 32,
    upstreamUrl: `http://127.0.0.1:${address.port}`,
    upstreamCredential: () =>
      Promise.resolve({ ok: true, value: "AGY_FIXTURE_KEY" }),
  });
  assert.ok(proxy.ok);
  t.after(() => proxy.value.close());
  return { proxy: proxy.value, root, seen };
}

async function readEvents(root: string): Promise<GatewayEvent[]> {
  const names = (await readdir(join(root, "events"))).sort();
  return Promise.all(
    names.map(async (name) => {
      const raw = await readFile(join(root, "events", name), "utf8");
      return gatewayEventSchema.parse(JSON.parse(raw));
    }),
  );
}

void test("agy upstream forwards canonical payload and settles actual usage", async (t) => {
  const harness = await setupHarness(t);
  const payload = {
    model: "gemini-fixture",
    contents: [{ parts: [{ text: "ping" }] }],
  };
  const response = await fetch(
    `${harness.proxy.url}/v1internal:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  assert.equal(response.status, 200);
  assert.match(await response.text(), /UPSTREAM_OK/u);
  const canonical = canonicalSerialize(payload);
  assert.ok(canonical.ok);
  assert.equal(harness.seen.body, canonical.value);
  assert.equal(harness.seen.route, "/v1internal:generateContent");
  assert.equal(harness.seen.authorization, "Bearer AGY_FIXTURE_KEY");
  const events = await readEvents(harness.root);
  assert.equal(events.length, 2);
  const settled = events[1];
  assert.ok(settled && settled.kind === "settled");
  assert.equal(settled.usage.output_tokens, 5);
  assert.equal(settled.usage.reasoning_tokens, 1);
  assert.equal(settled.usage.cached_input_tokens, 2);
});

void test("agy upstream keeps reservation when usage is incomplete", async (t) => {
  const harness = await setupHarness(t, { omitUsage: true });
  const response = await fetch(
    `${harness.proxy.url}/v1internal:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [] }),
    },
  );
  assert.equal(response.status, 502);
  const events = await readEvents(harness.root);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "reserved");
});

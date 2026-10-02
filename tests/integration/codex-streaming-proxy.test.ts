import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failure } from "../../src/contracts/errors.js";
import {
  gatewayEventSchema,
  type GatewayEvent,
} from "../../src/contracts/model-gateway.js";
import { canonicalDigest } from "../../src/infrastructure/artifacts/digests.js";
import { canonicalSerialize } from "../../src/domain/canonical.js";
import { createModelLedger } from "../../src/infrastructure/model-gateway/ledger.js";
import { startCodexStreamingProxy } from "../../src/infrastructure/model-gateway/codex-streaming-proxy.js";
import type { CodexResponsesPayload } from "../../src/infrastructure/model-gateway/codex-request-firewall.js";
import type { ModelGatewayOptions } from "../../src/application/model-gateway.js";
import { request as makeInvocation } from "../fixtures/evidence.js";
import { fixtureResponseEvents } from "../probes/codex-fake-provider.js";

const repoTool = {
  type: "namespace",
  name: "repo",
  description: "Broker repository reads",
  tools: [
    {
      type: "function",
      name: "read",
      description: "Read a scoped file",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
  ],
};

function validCodexRequest(tools: unknown[] = [repoTool], model = "gpt-6-sol") {
  return {
    client_metadata: { client: "codex" },
    include: ["reasoning.encrypted_content"],
    input: [{ type: "message", role: "user", content: [] }],
    instructions: "Host instructions",
    model,
    parallel_tool_calls: false,
    prompt_cache_key: "host-digest",
    reasoning: { effort: "medium" },
    store: false,
    stream: true,
    tool_choice: "auto",
    tools,
  };
}

async function setupHarness(
  t: TestContext,
  options: { budget?: number; maxRequestBodyBytes?: number } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "codex-proxy-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let upstreamRequests = 0;
  const upstreamBodies: string[] = [];
  const upstreamHeaders: Record<string, string | string[] | undefined>[] = [];
  const ssePayload = fixtureResponseEvents();
  let interruptStream = false;

  const upstream = createServer((req, res) => {
    upstreamRequests++;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      upstreamBodies.push(Buffer.concat(chunks).toString("utf8"));
      upstreamHeaders.push(req.headers);
      if (interruptStream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write("event: response.created\ndata: {}\n\n");
        setTimeout(() => res.destroy(), 30);
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        Connection: "close",
      });
      res.end(ssePayload);
    });
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const addr = upstream.address() as AddressInfo;
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        upstream.closeAllConnections();
        upstream.close((err) => (err ? reject(err) : resolve()));
      }),
  );

  const invocation = makeInvocation("qa");
  invocation.limits = {
    timeout_ms: 10000,
    tokens_reserved: options.budget ?? 10000,
  };
  const ledger = await createModelLedger({
    root,
    allocation: {
      schema_version: "1.0.0",
      session_id: invocation.session_id,
      invocation_id: invocation.invocation_id,
      tokens_limit: invocation.limits.tokens_reserved,
      context_digest:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
  });
  assert.ok(ledger.ok);

  const gateway: ModelGatewayOptions<CodexResponsesPayload> = {
    provider: {
      capability: Object.freeze({
        schema_version: "1.0.0" as const,
        provider: "responses-http-v1",
        model: "gpt-6-sol",
        status: "fixture" as const,
        input_bound: "exact_payload" as const,
        output_bound: "includes_reasoning" as const,
        hidden_retries: false as const,
        evidence_digest: null,
      }),
      countInput: (payload) => {
        const text = canonicalSerialize(payload);
        const digest = canonicalDigest(payload);
        assert.ok(text.ok);
        assert.ok(digest.ok);
        return Promise.resolve({
          ok: true,
          value: {
            payload_digest: digest.value,
            input_tokens: Buffer.byteLength(text.value),
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
    authorize: () => Promise.resolve({ ok: true as const, value: undefined }),
    verifyCapability: () =>
      Promise.resolve({ ok: true as const, value: undefined }),
  };

  const proxy = await startCodexStreamingProxy({
    gateway,
    model: "gpt-6-sol",
    outputTokensLimit: 32,
    authorizedTools: [repoTool],
    upstreamUrl: `http://127.0.0.1:${addr.port}/v1`,
    upstreamCredential: () =>
      Promise.resolve({ ok: true, value: "QUORUM_FIXTURE_KEY" }),
    ...(options.maxRequestBodyBytes !== undefined
      ? { maxRequestBodyBytes: options.maxRequestBodyBytes }
      : {}),
  });
  assert.ok(proxy.ok);
  t.after(() => proxy.value.close());

  return {
    root,
    proxy: proxy.value,
    upstreamRequests: () => upstreamRequests,
    upstreamBodies,
    upstreamHeaders,
    setInterrupt: (v: boolean) => {
      interruptStream = v;
    },
  };
}

async function readLedgerEvents(root: string): Promise<GatewayEvent[]> {
  const eventsDir = join(root, "events");
  const files = (await readdir(eventsDir))
    .filter((f) => f.endsWith(".json"))
    .sort();
  const events: GatewayEvent[] = [];
  for (const f of files) {
    const raw = await readFile(join(eventsDir, f), "utf8");
    events.push(gatewayEventSchema.parse(JSON.parse(raw)));
  }
  return events;
}

void test("admits valid request, reserves before upstream, streams SSE, and settles on completion", async (t) => {
  const h = await setupHarness(t);
  const response = await fetch(`${h.proxy.url}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validCodexRequest()),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  const text = await response.text();
  assert.match(text, /QUORUM_FIXTURE_OK/);
  assert.equal(h.upstreamRequests(), 1);
  assert.equal(
    h.upstreamHeaders[0]?.authorization,
    "Bearer QUORUM_FIXTURE_KEY",
  );
  const rawBody = h.upstreamBodies[0];
  assert.ok(rawBody);
  const upstreamBody = JSON.parse(rawBody) as Record<string, unknown>;
  assert.equal(upstreamBody.max_output_tokens, 32);

  const events = await readLedgerEvents(h.root);
  assert.equal(events.length, 2);
  const first = events[0];
  const second = events[1];
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.kind, "reserved");
  assert.equal(second.kind, "settled");
  if (second.kind === "settled") {
    assert.equal(second.usage.output_tokens, 3);
    assert.equal(second.usage.input_tokens, 10);
    assert.equal(second.usage.accounting_complete, true);
  }
});

void test("denies request with request_user_input before contacting upstream or mutating ledger", async (t) => {
  const h = await setupHarness(t);
  const badRequest = validCodexRequest([
    { type: "function", name: "request_user_input", parameters: {} },
    repoTool,
  ]);
  const response = await fetch(`${h.proxy.url}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(badRequest),
  });
  assert.equal(response.status, 400);
  assert.equal(h.upstreamRequests(), 0);
  const events = await readLedgerEvents(h.root);
  assert.equal(events.length, 0);
});

void test("denies request when runner attempts to override host model", async (t) => {
  const h = await setupHarness(t);
  const response = await fetch(`${h.proxy.url}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validCodexRequest([repoTool], "forbidden-model")),
  });
  assert.equal(response.status, 400);
  assert.equal(h.upstreamRequests(), 0);
  const events = await readLedgerEvents(h.root);
  assert.equal(events.length, 0);
});

void test("rejects oversized request body with 413 without touching upstream or ledger", async (t) => {
  const h = await setupHarness(t, { maxRequestBodyBytes: 64 });
  const response = await fetch(`${h.proxy.url}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validCodexRequest()),
  });
  assert.equal(response.status, 413);
  assert.equal(h.upstreamRequests(), 0);
  const events = await readLedgerEvents(h.root);
  assert.equal(events.length, 0);
});

void test("rejects request when invocation budget is exhausted with 429", async (t) => {
  const h = await setupHarness(t, { budget: 10 });
  const response = await fetch(`${h.proxy.url}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validCodexRequest()),
  });
  assert.equal(response.status, 429);
  assert.equal(h.upstreamRequests(), 0);
  const events = await readLedgerEvents(h.root);
  assert.equal(events.length, 0);
});

void test("preserves durable reservation and does not settle when upstream stream is interrupted", async (t) => {
  const h = await setupHarness(t);
  h.setInterrupt(true);
  const response = await fetch(`${h.proxy.url}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validCodexRequest()),
  });
  assert.equal(response.status, 200);
  try {
    await response.text();
  } catch {
    // Expected stream interruption
  }
  assert.equal(h.upstreamRequests(), 1);
  const events = await readLedgerEvents(h.root);
  assert.equal(events.length, 1);
  const first = events[0];
  assert.ok(first);
  assert.equal(first.kind, "reserved");
});

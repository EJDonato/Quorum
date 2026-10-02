import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  gatewayHarness,
  fixtureCredential,
} from "../fixtures/model-gateway.js";
import { createResponsesProvider } from "../../src/infrastructure/model-gateway/responses-provider.js";
import { createModelGateway } from "../../src/infrastructure/model-gateway/composition.js";

const boundedPayload = {
  model: "quorum-fixture-model",
  input: "text",
  instructions: "Host",
  tools: [],
  max_output_tokens: 32,
  stream: false as const,
  store: false as const,
  truncation: "disabled" as const,
  tool_choice: "none" as const,
  parallel_tool_calls: false as const,
};

void test("native HTTP reaches only the local fake count/generation endpoints and sees durable reservation before generation", async (t) => {
  const h = await gatewayHarness(t);
  const paths: string[] = [];
  let inputTokens = 0;
  let handlerFailure: unknown;
  const server = createServer((req, res) => {
    void (async () => {
      paths.push(req.url ?? "");
      assert.equal(req.headers.authorization, `Bearer ${fixtureCredential}`);
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        assert.ok(Buffer.isBuffer(chunk));
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString("utf8");
      assert.equal(body.includes(fixtureCredential), false);
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/v1/responses/input_tokens") {
        inputTokens = Buffer.byteLength(body);
        res.end(JSON.stringify({ input_tokens: inputTokens }));
        return;
      }
      assert.equal(req.url, "/v1/responses");
      const payload = z
        .object({
          max_output_tokens: z.literal(32),
          tools: z.array(z.never()),
          tool_choice: z.literal("none"),
          stream: z.literal(false),
          store: z.literal(false),
        })
        .parse(JSON.parse(body));
      assert.equal(payload.max_output_tokens, 32);
      assert.match(
        await readFile(join(h.root, "events", "000001.json"), "utf8"),
        /"kind":"reserved"/,
      );
      res.end(
        JSON.stringify({
          model: "quorum-fixture-model",
          status: "completed",
          output: [
            {
              type: "reasoning",
              summary: [{ type: "summary_text", text: "Fixture thought" }],
            },
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "OK" }],
            },
          ],
          usage: {
            input_tokens: inputTokens,
            output_tokens: 3,
            total_tokens: inputTokens + 3,
            input_tokens_details: { cached_tokens: 2 },
            output_tokens_details: { reasoning_tokens: 1 },
          },
        }),
      );
    })().catch((error: unknown) => {
      handlerFailure = error;
      res.destroy();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const provider = createResponsesProvider({
    kind: "fixture",
    model: "quorum-fixture-model",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    http: {
      fetch: globalThis.fetch,
      credential: () => Promise.resolve({ ok: true, value: fixtureCredential }),
      timeoutMs: 1000,
      maxResponseBytes: 65536,
    },
  });
  assert.ok(provider.ok);
  const gateway = await createModelGateway({
    ...h.settings,
    provider: provider.value,
  });
  assert.ok(gateway.ok);
  const result = await gateway.value.dispatch({
    requestId: "native",
    input: { input: "text" },
    signal: new AbortController().signal,
  });
  assert.equal(handlerFailure, undefined);
  assert.ok(result.ok);
  assert.equal(result.value.output, "OK");
  assert.equal(result.value.tokensCharged, inputTokens + 3);
  assert.deepEqual(paths, ["/v1/responses/input_tokens", "/v1/responses"]);
});

void test("native HTTP denies redirects without contacting the redirected route", async (t) => {
  const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(req.url ?? "");
    res.writeHead(302, { Location: "/forbidden" });
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const provider = createResponsesProvider({
    kind: "fixture",
    model: "quorum-fixture-model",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    http: {
      fetch: globalThis.fetch,
      credential: () => Promise.resolve({ ok: true, value: fixtureCredential }),
      timeoutMs: 1000,
      maxResponseBytes: 65536,
    },
  });
  assert.ok(provider.ok);
  const result = await provider.value.countInput(
    boundedPayload,
    new AbortController().signal,
  );
  assert.ok(!result.ok);
  assert.equal(result.error.code, "CAPABILITY_MISSING");
  assert.deepEqual(paths, ["/v1/responses/input_tokens"]);
});

void test("native HTTP deadline cancels an unfinished provider response without replay", async (t) => {
  const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(req.url ?? "");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"input_tokens":');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const provider = createResponsesProvider({
    kind: "fixture",
    model: "quorum-fixture-model",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    http: {
      fetch: globalThis.fetch,
      credential: () => Promise.resolve({ ok: true, value: fixtureCredential }),
      timeoutMs: 500,
      maxResponseBytes: 65536,
    },
  });
  assert.ok(provider.ok);
  const result = await provider.value.countInput(
    boundedPayload,
    new AbortController().signal,
  );
  assert.ok(!result.ok);
  assert.equal(result.error.code, "CAPABILITY_MISSING");
  assert.deepEqual(paths, ["/v1/responses/input_tokens"]);
});

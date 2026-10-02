import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { z } from "zod";
import { request } from "./evidence.js";
import { createResponsesProvider } from "../../src/infrastructure/model-gateway/responses-provider.js";
import { createModelGateway } from "../../src/infrastructure/model-gateway/composition.js";
import { failure } from "../../src/contracts/errors.js";

export const fixtureCredential = "QUORUM_FIXTURE_CREDENTIAL_DO_NOT_LOG";
const payload = z.object({
  model: z.string(),
  input: z.string(),
  instructions: z.string(),
  tools: z.array(z.never()),
  max_output_tokens: z.number().int().positive(),
});

export function fakeResponsesTransport() {
  const calls: {
    path: string;
    body: string;
    authenticated: boolean;
    redirectDenied: boolean;
  }[] = [];
  const state = {
    failGenerate: false,
    malformedUsage: false,
    incomplete: false,
    inputOverrun: false,
    outputOverrun: false,
    beforeGenerate: async () => {},
    beforeCount: async () => {},
  };
  // Deliberately synthetic tokenization: one input byte = one token, output one ASCII byte = one token.
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    assert.equal(typeof init?.body, "string");
    const body = init?.body;
    assert.ok(typeof body === "string");
    const parsed = payload.parse(JSON.parse(body));
    calls.push({
      path: url.pathname,
      body,
      authenticated:
        new Headers(init?.headers).get("authorization") ===
        `Bearer ${fixtureCredential}`,
      redirectDenied: init?.redirect === "error",
    });
    if (url.pathname.endsWith("input_tokens")) {
      await state.beforeCount();
      return Response.json({ input_tokens: Buffer.byteLength(body) });
    }
    await state.beforeGenerate();
    if (state.failGenerate) throw new Error(fixtureCredential);
    const countBody = calls.findLast((call) =>
      call.path.endsWith("input_tokens"),
    )?.body;
    assert.ok(countBody);
    const inputTokens =
      Buffer.byteLength(countBody) + Number(state.inputOverrun);
    const output = "QUORUM_FIXTURE_OK".slice(0, parsed.max_output_tokens);
    const outputTokens = state.outputOverrun
      ? parsed.max_output_tokens + 1
      : output.length;
    return Response.json({
      model: parsed.model,
      status: state.incomplete ? "incomplete" : "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: output }],
        },
      ],
      usage: state.malformedUsage
        ? {}
        : {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            total_tokens: inputTokens + outputTokens,
            input_tokens_details: { cached_tokens: 2 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
    });
  };
  return { calls, state, fetch };
}

export async function gatewayHarness(
  t: TestContext,
  options: { budget?: number; mode?: "fixture" | "enforced" } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "quorum-gateway-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const transport = fakeResponsesTransport();
  let credentialReads = 0;
  const provider = createResponsesProvider({
    kind: "fixture",
    model: "quorum-fixture-model",
    baseUrl: "http://127.0.0.1:32123/v1",
    http: {
      fetch: transport.fetch,
      credential: () => {
        credentialReads++;
        return Promise.resolve({ ok: true, value: fixtureCredential });
      },
      timeoutMs: 10000,
      maxResponseBytes: 65536,
    },
  });
  assert.ok(provider.ok);
  const invocation = request("qa");
  invocation.limits = {
    timeout_ms: 10000,
    tokens_reserved: options.budget ?? 1000,
  };
  const settings = {
    root,
    provider: provider.value,
    invocation,
    mode: options.mode ?? "fixture",
    instructions: "Host fixture instructions",
    outputTokensLimit: 32,
    authorize: () => Promise.resolve({ ok: true as const, value: undefined }),
    verifyCapability: () =>
      Promise.resolve(
        failure("CAPABILITY_MISSING", "No production evidence in a fixture."),
      ),
  };
  const gateway = await createModelGateway(settings);
  assert.ok(gateway.ok);
  return {
    root,
    transport,
    provider: provider.value,
    settings,
    gateway: gateway.value,
    credentialReads: () => credentialReads,
    dispatch: (
      id = "request-1",
      input: unknown = { input: "synthetic prompt" },
    ) =>
      gateway.value.dispatch({
        requestId: id,
        input,
        signal: new AbortController().signal,
      }),
  };
}

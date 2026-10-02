import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalDigest } from "../../src/infrastructure/artifacts/digests.js";
import { canonicalSerialize } from "../../src/domain/canonical.js";
import { createModelLedger } from "../../src/infrastructure/model-gateway/ledger.js";
import {
  startAgyStreamingProxy,
  type AgyStreamingProxy,
} from "../../src/infrastructure/adapters/agy/model-proxy.js";
import { installAgyToolGateHooks } from "../../src/infrastructure/adapters/agy/tool-gate.js";
import type { ModelGatewayOptions } from "../../src/application/model-gateway.js";
import { request as makeInvocation } from "../fixtures/evidence.js";
import { failure } from "../../src/contracts/errors.js";

async function setupAgyProxyHarness(
  t: TestContext,
  options: {
    budget?: number;
    countDigestMismatch?: boolean;
    revokeAfterCount?: boolean;
  } = {},
): Promise<{
  proxy: AgyStreamingProxy;
  root: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "agy-proxy-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));

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

  let authorizations = 0;
  const gateway: ModelGatewayOptions<unknown> = {
    provider: {
      capability: Object.freeze({
        schema_version: "1.0.0" as const,
        provider: "responses-http-v1",
        model: "gemini-3.8-flash-medium",
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
            payload_digest: options.countDigestMismatch
              ? "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
              : digest.value,
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
    authorize: () => {
      authorizations++;
      return Promise.resolve(
        options.revokeAfterCount && authorizations > 1
          ? failure("STALE_INPUT", "Fixture authorization revoked.")
          : { ok: true as const, value: undefined },
      );
    },
    verifyCapability: () =>
      Promise.resolve({ ok: true as const, value: undefined }),
  };

  const started = await startAgyStreamingProxy({
    gateway,
    model: "gemini-3.8-flash-medium",
    outputTokensLimit: 32,
    kind: "fixture",
    fixtureResponse: (payload) => {
      const serialized = canonicalSerialize(payload);
      assert.ok(serialized.ok);
      const inputTokens = Buffer.byteLength(serialized.value);
      return {
        candidates: [
          {
            content: { parts: [{ text: "fixture response" }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: inputTokens,
          candidatesTokenCount: 3,
          totalTokenCount: inputTokens + 3,
          cachedContentTokenCount: 0,
          thoughtsTokenCount: 0,
        },
      };
    },
  });
  assert.ok(started.ok);
  t.after(() => started.value.close());

  return { proxy: started.value, root };
}

await test("tool gate rejects native tools and allows broker tools in subprocess", async () => {
  const runSubprocessGate = (toolName: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "-e",
          'import { runAgyToolGateCli } from "./dist/src/infrastructure/adapters/agy/tool-gate.js"; await runAgyToolGateCli();',
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let stdout = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.on("error", reject);
      child.on("close", () => resolve(stdout));
      child.stdin.write(
        JSON.stringify({
          toolCall: { name: toolName, args: {} },
          stepIdx: 1,
        }),
      );
      child.stdin.end();
    });
  };

  const nativeResult = JSON.parse(await runSubprocessGate("run_command")) as {
    decision: string;
    reason: string;
  };
  assert.equal(nativeResult.decision, "deny");
  assert.ok(nativeResult.reason.includes("Unauthorized tool 'run_command'"));

  const fileResult = JSON.parse(await runSubprocessGate("write_to_file")) as {
    decision: string;
    reason: string;
  };
  assert.equal(fileResult.decision, "deny");

  const brokerResult = JSON.parse(await runSubprocessGate("repo.read")) as {
    decision: string;
  };
  assert.equal(brokerResult.decision, "allow");
});

await test("tool gate hooks installation produces valid configuration file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agy-gate-install-"));
  try {
    const res = await installAgyToolGateHooks(
      dir,
      "node /quorum/tool-gate.js",
      5,
    );
    assert.ok(res.ok);
    const content = await readFile(res.value, "utf8");
    const json = JSON.parse(content) as Record<string, unknown>;
    assert.ok(json["quorum-broker-gate"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await test("agy proxy handles handshake and generates with durable ledger accounting", async (t) => {
  const { proxy, root } = await setupAgyProxyHarness(t, { budget: 5000 });

  // 1. Handshake: loadCodeAssist
  const loadRes = await fetch(`${proxy.url}/v1internal:loadCodeAssist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(loadRes.status, 200);
  const loadJson = (await loadRes.json()) as { userTier: { userTier: string } };
  assert.equal(loadJson.userTier.userTier, "PAID");

  // 2. Handshake: fetchAvailableModels
  const modelRes = await fetch(`${proxy.url}/v1internal:fetchAvailableModels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(modelRes.status, 200);

  // 3. Generate content with budget
  const genRes = await fetch(`${proxy.url}/v1internal:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gemini-3.8-flash-medium",
      contents: [{ role: "user", parts: [{ text: "ping" }] }],
    }),
  });
  assert.equal(genRes.status, 200);
  const genJson = (await genRes.json()) as {
    usageMetadata: { totalTokenCount: number };
  };
  assert.ok(genJson.usageMetadata.totalTokenCount > 0);

  // 4. Verify durable ledger files have reservation and settlement
  const eventsDir = join(root, "events");
  const files = (await readdir(eventsDir))
    .filter((f) => f.endsWith(".json"))
    .sort();
  assert.equal(files.length, 2);
  const firstFile = files[0];
  const secondFile = files[1];
  assert.ok(firstFile);
  assert.ok(secondFile);
  const first = JSON.parse(
    await readFile(join(eventsDir, firstFile), "utf8"),
  ) as { kind: string };
  const second = JSON.parse(
    await readFile(join(eventsDir, secondFile), "utf8"),
  ) as { kind: string };
  assert.equal(first.kind, "reserved");
  assert.equal(second.kind, "settled");
});

await test("agy proxy enforces hard token ceiling and rejects when budget exhausted", async (t) => {
  const { proxy } = await setupAgyProxyHarness(t, { budget: 10 });

  // Request requires more tokens than the allocation allows
  const genRes = await fetch(`${proxy.url}/v1internal:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gemini-3.8-flash-medium",
      contents: [
        {
          role: "user",
          parts: [
            { text: "A very long prompt that exceeds ten tokens easily." },
          ],
        },
      ],
    }),
  });
  assert.equal(genRes.status, 429);
  const errJson = (await genRes.json()) as { error: { code: string } };
  assert.equal(errJson.error.code, "BUDGET_EXHAUSTED");
});

await test("agy proxy rejects a count for another payload before reservation", async (t) => {
  const { proxy, root } = await setupAgyProxyHarness(t, {
    countDigestMismatch: true,
  });
  const response = await fetch(`${proxy.url}/v1internal:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [] }),
  });
  assert.equal(response.status, 502);
  assert.deepEqual(await readdir(join(root, "events")), []);
});

await test("agy proxy reauthorizes after durable reservation", async (t) => {
  const { proxy, root } = await setupAgyProxyHarness(t, {
    revokeAfterCount: true,
  });
  const response = await fetch(`${proxy.url}/v1internal:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [] }),
  });
  assert.equal(response.status, 502);
  const events = await readdir(join(root, "events"));
  assert.equal(events.length, 1);
});
